/**
 * Browser previs viewer: pick/drop a previs JSON (+ glTF model files it references) -> validateDoc ->
 * real-time playback in a canvas (no encoding). Run: `npm run previs:viewer` in web/.
 *
 * Models: a node's `model.src` is matched against the dropped/selected files by relative path
 * (suffix match on the folder path when a folder was dropped), then by basename. Add model files at
 * any time; the current doc reloads. http(s)/data/blob URLs are passed through. Use .glb (a .gltf
 * with external .bin/images cannot resolve those from loose files).
 */
import { Charturbo } from 'charturbo';
import { docDuration } from '../src/previs/evaluate';
import { loadPrevisPlayer } from '../src/previs/player';
import { gltfExtensions, loadDecodersFor } from './decoders';
import type { PrevisPlayer } from '../src/previs/player';
import type { PrevisDoc } from '../src/previs/types';
import { validateDoc } from '../src/previs/validate';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const drop = $('drop');
const issuesEl = $<HTMLUListElement>('issues');
const msgEl = $('msg');
const pickerEl = $('picker');
const stage = $('stage');
const bar = $('bar');
const playBtn = $<HTMLButtonElement>('play');
const seek = $<HTMLInputElement>('seek');
const timeEl = $('time');
const shotEl = $('shot');
const loopEl = $<HTMLInputElement>('loop');
const speedEl = $<HTMLSelectElement>('speed');

interface Session {
  doc: PrevisDoc;
  duration: number;
  sdk: Charturbo;
  player: PrevisPlayer;
  canvas: HTMLCanvasElement;
  t: number;
  playing: boolean;
  raf: number;
  last: number;
  dead: boolean;
}

let session: Session | null = null;
/** Last doc file (reloaded when model files are added) and the model files by normalized path */
let docFile: File | null = null;
/** Snapshot of the doc text taken at pick time (a File handle can become unreadable later) */
let docText: string | null = null;
const pool = new Map<string, File>();
let loadToken = 0;
const hasGpu = !!(navigator as Navigator & { gpu?: unknown }).gpu;

function showMsg(text: string | null): void {
  msgEl.hidden = text === null;
  msgEl.textContent = text ?? '';
}

function showIssues(list: { path: string; message: string }[] | null): void {
  issuesEl.hidden = list === null;
  issuesEl.replaceChildren(
    ...(list ?? []).map((i) => {
      const li = document.createElement('li');
      li.textContent = `${i.path}: ${i.message}`;
      return li;
    }),
  );
}

function destroySession(): void {
  const s = session;
  session = null;
  if (!s) return;
  s.dead = true;
  cancelAnimationFrame(s.raf);
  try {
    s.player.dispose();
  } catch {
    // best effort
  }
  try {
    s.sdk.dispose();
  } catch {
    // best effort
  }
  s.canvas.remove();
  bar.hidden = true;
  document.body.classList.remove('loaded');
}

function fit(s: Session): void {
  const { width, height } = s.doc.size;
  const k = Math.min(stage.clientWidth / width, stage.clientHeight / height);
  s.canvas.style.width = `${Math.max(1, Math.floor(width * k))}px`;
  s.canvas.style.height = `${Math.max(1, Math.floor(height * k))}px`;
}

async function createEngine(doc: PrevisDoc): Promise<{ sdk: Charturbo; canvas: HTMLCanvasElement; backend: string }> {
  const make = async (forceGl: boolean) => {
    if (forceGl) Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
    const canvas = document.createElement('canvas');
    canvas.width = doc.size.width;
    canvas.height = doc.size.height;
    stage.appendChild(canvas);
    try {
      const sdk = await Charturbo.create(canvas, { autoResize: false, nodeCount: 0, edgeCount: 0, antialias: true });
      return { sdk, canvas, backend: canvas.getContext('webgl2') ? 'webgl2' : 'webgpu' };
    } catch (err) {
      canvas.remove();
      throw err;
    }
  };
  try {
    return await make(false);
  } catch (err) {
    if (!hasGpu) throw err;
    console.warn('WebGPU init failed, falling back to WebGL2', err);
    return await make(true);
  }
}

function draw(s: Session): void {
  const fs = s.player.frame(s.t);
  s.sdk.render();
  timeEl.textContent = `${s.t.toFixed(2)} / ${s.duration.toFixed(2)}`;
  shotEl.textContent = fs.shotId;
  seek.value = String(s.t);
}

function setPlaying(s: Session, on: boolean): void {
  s.playing = on;
  playBtn.textContent = on ? '일시정지' : '재생';
  s.last = performance.now();
}

function tick(s: Session, now: number): void {
  if (s.dead) return;
  if (s.playing) {
    s.t += ((now - s.last) / 1000) * Number(speedEl.value);
    if (s.t >= s.duration) {
      if (loopEl.checked && s.duration > 0) s.t %= s.duration;
      else {
        s.t = s.duration;
        setPlaying(s, false);
      }
    }
    draw(s);
  }
  s.last = now;
  s.raf = requestAnimationFrame((n) => tick(s, n));
}

const isUrl = (src: string) => /^(https?|data|blob):/i.test(src);

/** Lowercased, forward slashes, no `./` or query/hash */
function norm(p: string): string {
  let q = p.replace(/[?#].*$/, '').replace(/\\/g, '/');
  try {
    q = decodeURIComponent(q);
  } catch {
    // keep as is
  }
  const parts: string[] = [];
  for (const seg of q.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/').toLowerCase();
}

function findModelFile(src: string): File | null {
  const want = norm(src);
  const exact = pool.get(want);
  if (exact) return exact;
  // dropped folder: keys carry the folder prefix ("examples/models/mug.glb")
  for (const [key, f] of pool) if (key.endsWith('/' + want)) return f;
  const base = want.slice(want.lastIndexOf('/') + 1);
  for (const [key, f] of pool) if (key.slice(key.lastIndexOf('/') + 1) === base) return f;
  return null;
}

function missingModels(doc: PrevisDoc): string[] {
  const out = new Set<string>();
  for (const n of doc.nodes) {
    const src = n.model?.src;
    if (!src || isUrl(src)) continue;
    // pure-pivot nodes never load their model (see hasShape in src/previs/player.ts)
    if (n.visible === false && !n.tracks?.visible?.some((k) => k.v)) continue;
    if (!findModelFile(src)) out.add(src);
  }
  return [...out];
}

function addFiles(files: File[]): void {
  const jsons = files.filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
  for (const f of files) {
    if (jsons.includes(f)) continue;
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    pool.set(norm(rel), f);
  }
  if (jsons.length > 1) showPicker(jsons);
  else if (jsons.length === 1) openDoc(jsons[0]);
  else if (docFile && docText !== null) void load(docFile);
}

function openDoc(f: File): void {
  pickerEl.hidden = true;
  docFile = f;
  docText = null;
  void f.text().then(
    (t) => {
      if (docFile === f) {
        docText = t;
        void load(f);
      }
    },
    (err) => {
      if (docFile === f) showIssues([{ path: f.name, message: `파일 읽기 실패: ${(err as Error).message}` }]);
    },
  );
}

/** Several JSON files in one batch: let the user choose which one is the previs doc */
function showPicker(jsons: File[]): void {
  loadToken++;
  destroySession();
  showIssues(null);
  showMsg(null);
  docFile = null;
  docText = null;
  const label = document.createElement('p');
  label.textContent = 'JSON 파일이 여러 개입니다. 재생할 previs 문서를 선택하세요.';
  const buttons = jsons.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    b.addEventListener('click', () => openDoc(f));
    return b;
  });
  pickerEl.replaceChildren(label, ...buttons);
  pickerEl.hidden = false;
}

async function load(file: File): Promise<void> {
  const token = ++loadToken;
  destroySession();
  showIssues(null);
  showMsg(null);
  pickerEl.hidden = true;
  let json: unknown;
  try {
    json = JSON.parse(docText ?? (await file.text()));
  } catch (err) {
    showIssues([{ path: file.name, message: `JSON 파싱 실패: ${(err as Error).message}` }]);
    return;
  }
  const checked = validateDoc(json);
  if (!checked.ok) {
    showIssues(checked.issues);
    return;
  }
  const doc = checked.doc;
  const missing = missingModels(doc);
  if (missing.length) {
    showIssues(missing.map((src) => ({ path: 'model.src', message: `모델 파일 없음: ${src} (이 파일을 함께 선택하거나 끌어다 놓으세요)` })));
    return;
  }
  try {
    const { sdk, canvas, backend } = await createEngine(doc);
    if (token !== loadToken) {
      sdk.dispose();
      canvas.remove();
      return;
    }
    const duration = docDuration(doc);
    let player: PrevisPlayer;
    try {
      // Read each model file once: its extensionsUsed pick the decoders (loaded only when needed)
      const bytes = new Map<string, Uint8Array>();
      const exts = new Set<string>();
      const urlSeen = new Set<string>();
      for (const n of doc.nodes) {
        const src = n.model?.src;
        if (!src || bytes.has(src) || urlSeen.has(src)) continue;
        if (isUrl(src)) {
          // Fetched once for the extension sniff; a GLB's bytes are reused, a .gltf is loaded by URL (sibling files)
          urlSeen.add(src);
          let res: Response;
          try {
            res = await fetch(src);
          } catch (err) {
            throw new Error(`모델을 가져오지 못했습니다: ${src} (${(err as Error).message})`);
          }
          if (!res.ok) throw new Error(`모델을 가져오지 못했습니다: ${src} (HTTP ${res.status})`);
          const b = new Uint8Array(await res.arrayBuffer());
          gltfExtensions(b).forEach((e) => exts.add(e));
          if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) bytes.set(src, b);
          continue;
        }
        const f = findModelFile(src);
        if (!f) continue;
        const b = new Uint8Array(await f.arrayBuffer());
        gltfExtensions(b).forEach((e) => exts.add(e));
        bytes.set(src, b);
      }
      const decoders = await loadDecodersFor(exts);
      player = await loadPrevisPlayer(sdk, doc, {
        resolveModel: (src) => bytes.get(src) ?? (isUrl(src) ? src : (findModelFile(src) ?? Promise.reject(new Error(`model file not found: ${src}`)))),
        decoders,
      });
    } catch (err) {
      sdk.dispose();
      canvas.remove();
      throw err;
    }
    if (token !== loadToken) {
      player.dispose();
      sdk.dispose();
      canvas.remove();
      return;
    }
    const s: Session = {
      doc,
      duration,
      sdk,
      canvas,
      player,
      t: 0,
      playing: false,
      raf: 0,
      last: performance.now(),
      dead: false,
    };
    session = s;
    seek.max = String(duration);
    document.body.classList.add('loaded');
    bar.hidden = false;
    if (backend === 'webgl2' && hasGpu) showMsg('WebGPU를 쓸 수 없어 WebGL2로 재생합니다.');
    fit(s);
    draw(s);
    setPlaying(s, true);
    s.raf = requestAnimationFrame((n) => tick(s, n));
  } catch (err) {
    if (token !== loadToken) return;
    showMsg(`재생을 시작하지 못했습니다: ${(err as Error).message}`);
  }
}

playBtn.addEventListener('click', () => {
  const s = session;
  if (!s) return;
  if (!s.playing && s.t >= s.duration) s.t = 0;
  setPlaying(s, !s.playing);
});
seek.addEventListener('input', () => {
  const s = session;
  if (!s) return;
  s.t = Number(seek.value);
  draw(s);
});
window.addEventListener('resize', () => session && fit(session));

for (const id of ['file', 'file2']) {
  const el = $<HTMLInputElement>(id);
  el.addEventListener('change', () => {
    const files = [...(el.files ?? [])];
    el.value = '';
    if (files.length) addFiles(files);
  });
}
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
window.addEventListener('dragleave', () => drop.classList.remove('over'));

/** Files of a drop, descending into dropped folders (relative paths kept via a name override) */
async function filesOfDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.() ?? null);
  if (!entries.some((e) => e?.isDirectory)) return [...dt.files];
  const out: File[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      const rel = prefix + f.name;
      out.push(prefix ? Object.defineProperty(new File([f], f.name, { type: f.type }), 'webkitRelativePath', { value: rel }) : f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const e of entries) if (e) await walk(e, '');
  return out;
}

window.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (!e.dataTransfer) return;
  filesOfDrop(e.dataTransfer).then(
    (files) => files.length && addFiles(files),
    (err) => showMsg(`파일을 읽지 못했습니다: ${(err as Error).message ?? String(err)}`),
  );
});
