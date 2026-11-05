/**
 * Browser previs viewer: real-time playback of a previs doc (or a playlist of docs) in a canvas, no encoding.
 * Run: `npm run previs:viewer` in web/.
 *
 * SOURCES
 *   Server: the dev server root is web/previs, so web/previs/examples/** is served as static files. The doc menu
 *     lists examples/*.json and examples/film/*.json (vite `import.meta.glob`, names only, nothing is imported).
 *     A relative `model.src` resolves against the doc URL (`new URL(src, docUrl)`), so a .gltf loads its .bin /
 *     images by URL. `?doc=examples/film/s03-gate.json&look=textured` opens one directly.
 *   Drop / pick: a doc JSON (+ the model files). A node's `model.src` is matched against the dropped files by
 *     relative path (suffix match on the folder path when a folder was dropped), then by basename. Adding model
 *     files later reloads the current doc. Use .glb there (a .gltf with external .bin / images cannot resolve those
 *     from loose files). http(s)/data/blob URLs pass through in both sources.
 * PLAYLIST: a JSON `{ "title"?: string, "docs": ["s01.json", ...] }` (paths relative to the playlist file; dropped
 *   playlists match the dropped JSON files like models). The scenes play back to back on one timeline (seek bar =
 *   total length, scene boundaries marked).
 * LOOK: 'flat' | 'textured' (PrevisLoadOptions.look; lighting / look / retarget are the player's). Switching keeps
 *   the time: the current scene keeps playing in the old look until the new player is ready.
 * ENGINES: two engines (slots), each with its own canvas and its own texture budget (256 MiB per engine, see
 *   crates/charturbo-core/src/renderer/texture.rs). The visible slot plays the current scene; the hidden one
 *   preloads the next scene (or the current scene in a newly chosen look) and is swapped in at the boundary. When
 *   the scene at the clock is not loaded yet (seek, slow load), the clock holds on the last shown frame.
 * Anti-aliasing: MSAA x4 (`antialias: true`) in both looks, the render script's default (render.html without aa=0).
 * Automation hook: `window.__viewer` (state(), perf(), loads; used by the scratch browser checks).
 */
import { Charturbo } from 'charturbo';
import { docDuration } from '../src/previs/evaluate';
import { loadPrevisPlayer, type PrevisPlayer, type PrevisPlayerLook } from '../src/previs/player';
import { gltfExtensions, loadDecodersFor } from './decoders';
import type { GltfDecoders, GltfSource } from '../src/sdk/scene-gltf';
import type { Issue, PrevisDoc } from '../src/previs/types';
import { modelSrcsToLoad } from '../src/previs/models';
import { validateDoc } from '../src/previs/validate';

declare global {
  interface ImportMeta {
    glob(patterns: string | string[], options?: { query?: string }): Record<string, () => Promise<unknown>>;
  }
}

// Served example docs (keys only: './examples/film/s01-hall.json')
const SERVER_DOCS = Object.keys(import.meta.glob(['./examples/*.json', './examples/film/*.json'], { query: '?url' }))
  .map((k) => k.replace(/^\.\//, ''))
  .sort();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const drop = $('drop');
const issuesEl = $<HTMLUListElement>('issues');
const msgEl = $('msg');
const pickerEl = $('picker');
const stage = $('stage');
const loadingEl = $('loading');
const bar = $('bar');
const playBtn = $<HTMLButtonElement>('play');
const seek = $<HTMLInputElement>('seek');
const marksEl = $('marks');
const timeEl = $('time');
const sceneEl = $<HTMLSelectElement>('scene');
const shotEl = $('shot');
const perfEl = $('perf');
const loopEl = $<HTMLInputElement>('loop');
const speedEl = $<HTMLSelectElement>('speed');
const docsEl = $<HTMLSelectElement>('docs');
const lookBtn = $<HTMLButtonElement>('look');
const titleEl = $('title');

type Look = PrevisPlayerLook;
/** Where a model.src comes from: a URL (server doc, absolute URL) or a dropped file */
type ModelRef = { url: string } | { file: File };

interface Entry {
  label: string;
  doc: PrevisDoc;
  duration: number;
  /** Start on the show timeline (seconds) */
  start: number;
  model: (src: string) => ModelRef | null;
}

interface Show {
  id: number;
  title: string;
  entries: Entry[];
  total: number;
}

interface Slot {
  name: string;
  sdk: Charturbo | null;
  canvas: HTMLCanvasElement | null;
  backend: string;
  /** `${width}x${height}` of the engine canvas */
  size: string;
  player: PrevisPlayer | null;
  /** Key of the player or of the pending load (`${show}:${scene}:${look}`), null = empty */
  key: string | null;
  ready: boolean;
  error: string | null;
  gen: number;
  abort: AbortController | null;
  queue: Promise<void>;
}

const newSlot = (name: string): Slot => ({
  name,
  sdk: null,
  canvas: null,
  backend: '',
  size: '',
  player: null,
  key: null,
  ready: false,
  error: null,
  gen: 0,
  abort: null,
  queue: Promise.resolve(),
});

const slots: [Slot, Slot] = [newSlot('A'), newSlot('B')];
let active = 0;
let show: Show | null = null;
let showSeq = 0;
let look: Look = new URLSearchParams(location.search).get('look') === 'textured' ? 'textured' : 'flat';
const clock = { t: 0, playing: false, last: performance.now() };
let raf = 0;
/** Slot + time last drawn (redraw only on change) */
let drawn: { slot: Slot | null; key: string | null; t: number } = { slot: null, key: null, t: -1 };
let shownError: string | null = null;
/** Pointer held on the seek bar: the bar shows the dragged value, not the clock */
let scrubbing = false;
/** The scene at the clock failed to load and nothing can be shown: play is blocked */
let blocked = false;
const hasGpu = !!(navigator as Navigator & { gpu?: unknown }).gpu;

// ---------- perf ----------
const perf = { intervals: [] as number[], draws: [] as number[], lastFrame: 0 };
const loads: { key: string; ms: number; look: Look; label: string }[] = [];
function percentile(a: number[], p: number): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function perfSummary() {
  const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  return {
    frames: perf.draws.length,
    intervalAvg: avg(perf.intervals),
    intervalP95: percentile(perf.intervals, 95),
    intervalMax: perf.intervals.length ? Math.max(...perf.intervals) : 0,
    over42: perf.intervals.filter((x) => x > 1000 / 24).length,
    drawAvg: avg(perf.draws),
    drawP95: percentile(perf.draws, 95),
    drawMax: perf.draws.length ? Math.max(...perf.draws) : 0,
  };
}
let perfShownAt = 0;

// ---------- UI helpers ----------
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

function setPlaying(on: boolean): void {
  clock.playing = on;
  playBtn.textContent = on ? '일시정지' : '재생';
  clock.last = performance.now();
}

function updateLookBtn(): void {
  lookBtn.textContent = look === 'textured' ? 'look: textured' : 'look: flat';
  lookBtn.classList.toggle('on', look === 'textured');
}

function fit(): void {
  const s = slots[active];
  const c = s.canvas;
  if (!c || !show) return;
  const [w, h] = s.size.split('x').map(Number);
  const k = Math.min(stage.clientWidth / w, stage.clientHeight / h);
  c.style.width = `${Math.max(1, Math.floor(w * k))}px`;
  c.style.height = `${Math.max(1, Math.floor(h * k))}px`;
}

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

// ---------- engines / players ----------
async function createEngine(doc: PrevisDoc): Promise<{ sdk: Charturbo; canvas: HTMLCanvasElement; backend: string }> {
  const make = async (forceGl: boolean) => {
    if (forceGl) Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
    const canvas = document.createElement('canvas');
    canvas.width = doc.size.width;
    canvas.height = doc.size.height;
    canvas.hidden = true;
    stage.appendChild(canvas);
    try {
      // antialias true = MSAA x4: the render script's default for the beauty and textured passes
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

function releasePlayer(slot: Slot): void {
  const p = slot.player;
  slot.player = null;
  slot.ready = false;
  if (p) {
    try {
      p.dispose();
    } catch {
      // best effort
    }
  }
}

function destroyEngine(slot: Slot): void {
  releasePlayer(slot);
  try {
    slot.sdk?.dispose();
  } catch {
    // best effort
  }
  slot.canvas?.remove();
  slot.sdk = null;
  slot.canvas = null;
  slot.size = '';
}

const isUrl = (src: string) => /^(https?|data|blob):/i.test(src);
const isGlb = (b: Uint8Array) => b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;

/** Model bytes, read once per URL / file (reused by every load: look switch, replay, playlist loop) */
const urlBytes = new Map<string, Promise<Uint8Array>>();
const fileBytes = new WeakMap<File, Promise<Uint8Array>>();
function readRef(ref: ModelRef, src: string): Promise<Uint8Array> {
  if ('file' in ref) {
    let p = fileBytes.get(ref.file);
    if (!p) {
      fileBytes.set(ref.file, (p = ref.file.arrayBuffer().then((b) => new Uint8Array(b))));
      p.catch(() => fileBytes.delete(ref.file));
    }
    return p;
  }
  let p = urlBytes.get(ref.url);
  if (!p) {
    p = (async () => {
      let res: Response;
      try {
        res = await fetch(ref.url);
      } catch (err) {
        throw new Error(`모델을 가져오지 못했습니다: ${src} (${(err as Error).message})`);
      }
      if (!res.ok) throw new Error(`모델을 가져오지 못했습니다: ${src} -> ${ref.url} (HTTP ${res.status})`);
      return new Uint8Array(await res.arrayBuffer());
    })();
    urlBytes.set(ref.url, p);
    p.catch(() => urlBytes.delete(ref.url));
  }
  return p;
}

const decoderCache = new Map<string, Promise<GltfDecoders>>();
function decodersFor(exts: Set<string>): Promise<GltfDecoders> {
  const key = [...exts].sort().join(',');
  let p = decoderCache.get(key);
  if (!p) {
    decoderCache.set(key, (p = loadDecodersFor(exts)));
    p.catch(() => decoderCache.delete(key));
  }
  return p;
}

async function playerOptions(entry: Entry): Promise<{ resolveModel: (src: string) => GltfSource; decoders: GltfDecoders }> {
  const sources = new Map<string, GltfSource>();
  const exts = new Set<string>();
  for (const src of modelSrcsToLoad(entry.doc)) {
    if (sources.has(src)) continue;
    const ref = entry.model(src);
    if (!ref) throw new Error(`모델 파일 없음: ${src}`);
    const b = await readRef(ref, src);
    gltfExtensions(b).forEach((e) => exts.add(e));
    // A served .gltf loads by URL (its .bin / images resolve next to it); GLB bytes and dropped files load from memory
    sources.set(src, 'url' in ref && !isGlb(b) ? ref.url : b);
  }
  const decoders = await decodersFor(exts);
  return { resolveModel: (src) => sources.get(src) ?? src, decoders };
}

const keyOf = (s: Show, index: number, l: Look) => `${s.id}:${index}:${l}`;
const sceneOfKey = (key: string | null) => (key ? Number(key.split(':')[1]) : -1);

/** Loads scene `index` of the current show in `l` into `slot` (no-op when it holds / loads / failed that key) */
function request(slot: Slot, index: number, l: Look): void {
  const s = show;
  if (!s) return;
  const key = keyOf(s, index, l);
  if (slot.key === key) return;
  const gen = ++slot.gen;
  slot.abort?.abort();
  const abort = new AbortController();
  slot.abort = abort;
  slot.key = key;
  slot.ready = false;
  slot.error = null;
  const entry = s.entries[index];
  slot.queue = slot.queue.then(async () => {
    if (gen !== slot.gen) return;
    releasePlayer(slot);
    const t0 = performance.now();
    try {
      const size = `${entry.doc.size.width}x${entry.doc.size.height}`;
      if (!slot.sdk || slot.size !== size) {
        destroyEngine(slot);
        const e = await createEngine(entry.doc);
        slot.sdk = e.sdk;
        slot.canvas = e.canvas;
        slot.backend = e.backend;
        slot.size = size;
        if (e.backend === 'webgl2' && hasGpu) showMsg('WebGPU를 쓸 수 없어 WebGL2로 재생합니다.');
      }
      const opts = await playerOptions(entry);
      if (gen !== slot.gen) return;
      const player = await loadPrevisPlayer(slot.sdk, entry.doc, { ...opts, look: l, signal: abort.signal });
      if (gen !== slot.gen) {
        player.dispose();
        return;
      }
      slot.player = player;
      slot.ready = true;
      loads.push({ key, ms: performance.now() - t0, look: l, label: entry.label });
    } catch (err) {
      if (gen !== slot.gen) return;
      slot.error = `${entry.label} (${l}): ${(err as Error).message ?? String(err)}`;
    }
  });
}

/** Empties `slot` (frees its player; the engine stays for the next load) */
function cancel(slot: Slot): void {
  if (slot.key === null) return;
  const gen = ++slot.gen;
  slot.abort?.abort();
  slot.abort = null;
  slot.key = null;
  slot.ready = false;
  slot.error = null;
  slot.queue = slot.queue.then(() => {
    if (gen === slot.gen) releasePlayer(slot);
  });
}

function present(slot: Slot): void {
  for (const s of slots) if (s.canvas) s.canvas.hidden = s !== slot;
  fit();
}

// ---------- timeline ----------
function sceneAt(s: Show, t: number): number {
  for (let i = s.entries.length - 1; i > 0; i--) if (t >= s.entries[i].start) return i;
  return 0;
}

function draw(slot: Slot, t: number): void {
  const s = show!;
  const i = sceneOfKey(slot.key);
  const e = s.entries[i];
  const t0 = performance.now();
  const fs = slot.player!.frame(Math.min(Math.max(t - e.start, 0), e.duration));
  slot.sdk!.render();
  const dt = performance.now() - t0;
  if (perf.lastFrame) perf.intervals.push(t0 - perf.lastFrame);
  perf.lastFrame = t0;
  perf.draws.push(dt);
  if (perf.draws.length > 2000) {
    perf.draws.splice(0, 1000);
    perf.intervals.splice(0, 1000);
  }
  shotEl.textContent = fs.shotId;
  drawn = { slot, key: slot.key, t };
}

function updateBar(s: Show, t: number, idx: number): void {
  timeEl.textContent = `${fmt(t)} / ${fmt(s.total)}`;
  if (!scrubbing) seek.value = String(t);
  if (sceneEl.selectedIndex !== idx) sceneEl.selectedIndex = idx;
}

function tick(now: number): void {
  raf = requestAnimationFrame(tick);
  const s = show;
  if (!s) return;
  let t = clock.t;
  if (clock.playing) {
    t += ((now - clock.last) / 1000) * Number(speedEl.value);
    if (t >= s.total) {
      if (loopEl.checked && s.total > 0) t %= s.total;
      else {
        t = s.total;
        setPlaying(false);
      }
    }
  } else perf.lastFrame = 0;
  clock.last = now;

  const idx = sceneAt(s, t);
  const want = keyOf(s, idx, look);
  let A = slots[active];
  const B = slots[1 - active];
  if (!(A.ready && A.key === want) && B.ready && B.key === want) {
    active = 1 - active;
    present(B);
    A = B;
  }
  let target: Slot | null = null;
  let failed = false;
  if (A.ready && A.key === want) target = A;
  else {
    const other = slots[1 - active];
    if (other.key !== want) request(other, idx, look);
    if (other.error && other.key === want) {
      failed = true;
      // Paused while the scene at the clock failed (play stays blocked, see playBtn)
      if (clock.playing) setPlaying(false);
      if (shownError !== other.error) {
        shownError = other.error;
        showMsg(`재생을 시작하지 못했습니다: ${other.error}`);
      }
    }
    // Same scene in the old look (look switch): keep playing it until the new player is ready
    if (A.ready && sceneOfKey(A.key) === idx) target = A;
  }
  blocked = failed && !target;
  if (target) {
    clock.t = t;
    if (shownError !== null && target.key === want) {
      shownError = null;
      showMsg(null);
    }
  }
  // else: hold the clock (and the last shown frame) until the scene at the clock is loaded
  loadingEl.hidden = !!target || failed;
  if (target && (drawn.slot !== target || drawn.key !== target.key || drawn.t !== clock.t)) draw(target, clock.t);
  updateBar(s, clock.t, idx);

  // Settled on the wanted player: preload the next scene into the other slot, or free it
  if (target === A && A.key === want) {
    const n = s.entries.length;
    const next = idx + 1 < n ? idx + 1 : loopEl.checked && n > 1 ? 0 : -1;
    const other = slots[1 - active];
    if (next >= 0) request(other, next, look);
    else cancel(other);
  }

  if (now - perfShownAt > 500) {
    perfShownAt = now;
    const p = perfSummary();
    const recent = perf.intervals.slice(-60);
    const fps = recent.length ? 1000 / (recent.reduce((x, y) => x + y, 0) / recent.length) : 0;
    const pre = slots[1 - active];
    const pending = pre.key && !pre.ready && !pre.error ? ` · 로딩: ${s.entries[sceneOfKey(pre.key)]?.label ?? ''}` : '';
    perfEl.textContent = clock.playing && recent.length ? `${fps.toFixed(0)} fps · draw ${p.drawAvg.toFixed(1)} ms${pending}` : pending.slice(3);
  }
}

// ---------- shows ----------
function startShow(title: string, entries: Omit<Entry, 'start'>[]): void {
  for (const sl of slots) cancel(sl);
  let start = 0;
  const list: Entry[] = entries.map((e) => {
    const out = { ...e, start };
    start += e.duration;
    return out;
  });
  show = { id: ++showSeq, title, entries: list, total: start };
  shownError = null;
  blocked = false;
  drawn = { slot: null, key: null, t: -1 };
  showMsg(null);
  showIssues(null);
  pickerEl.hidden = true;
  titleEl.textContent = title;
  seek.max = String(show.total);
  seek.value = '0';
  marksEl.replaceChildren(
    ...list.slice(1).map((e) => {
      const m = document.createElement('i');
      m.style.left = `${(e.start / show!.total) * 100}%`;
      m.title = e.label;
      return m;
    }),
  );
  sceneEl.replaceChildren(
    ...list.map((e, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = `${i + 1}. ${e.label}`;
      return o;
    }),
  );
  sceneEl.hidden = list.length < 2;
  marksEl.hidden = list.length < 2;
  for (const sl of slots) if (sl.canvas) sl.canvas.hidden = true;
  document.body.classList.add('loaded');
  bar.hidden = false;
  clock.t = 0;
  setPlaying(true);
  perf.intervals.length = 0;
  perf.draws.length = 0;
  perf.lastFrame = 0;
  if (!raf) raf = requestAnimationFrame(tick);
}

function stopShow(): void {
  for (const sl of slots) cancel(sl);
  show = null;
  for (const sl of slots) if (sl.canvas) sl.canvas.hidden = true;
  bar.hidden = true;
  loadingEl.hidden = true;
  titleEl.textContent = '';
  document.body.classList.remove('loaded');
}

interface Playlist {
  title?: string;
  docs: string[];
}
function asPlaylist(json: unknown): Playlist | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.docs) || 'shots' in o) return null;
  return o as unknown as Playlist;
}
function playlistIssues(p: Playlist): Issue[] {
  const out: Issue[] = [];
  if (p.title !== undefined && typeof p.title !== 'string') out.push({ path: 'title', message: '문자열이어야 합니다' });
  if (!p.docs.length) out.push({ path: 'docs', message: '문서가 하나 이상 있어야 합니다' });
  p.docs.forEach((d, i) => typeof d !== 'string' && out.push({ path: `docs[${i}]`, message: '문자열(재생목록 기준 상대 경로)이어야 합니다' }));
  return out;
}

const baseName = (p: string) => p.slice(p.lastIndexOf('/') + 1);

function checkDoc(json: unknown, label: string, issues: Issue[]): PrevisDoc | null {
  const c = validateDoc(json);
  if (c.ok) return c.doc;
  for (const i of c.issues) issues.push({ path: `${label} ${i.path}`, message: i.message });
  return null;
}

let openSeq = 0;

/** Opens a served doc or playlist (path relative to the page, e.g. examples/film/s03-gate.json) */
async function openServer(path: string): Promise<void> {
  const seq = ++openSeq;
  stopShow();
  // Fresh model bytes per opened doc (files may have changed on disk); look switches / loops reuse them
  urlBytes.clear();
  showIssues(null);
  showMsg('불러오는 중…');
  try {
    const url = new URL(path, location.href).href;
    const getJson = async (u: string) => {
      const res = await fetch(u);
      if (!res.ok) throw new Error(`${u} (HTTP ${res.status})`);
      return (await res.json()) as unknown;
    };
    const json = await getJson(url);
    if (seq !== openSeq) return;
    const pl = asPlaylist(json);
    const items = pl ? pl.docs.map((d) => new URL(d, url).href) : [url];
    const bad = pl ? playlistIssues(pl) : [];
    if (bad.length) {
      showMsg(null);
      showIssues(bad.map((i) => ({ path: `${baseName(path)} ${i.path}`, message: i.message })));
      return;
    }
    const texts = pl ? await Promise.all(items.map(getJson)) : [json];
    if (seq !== openSeq) return;
    const issues: Issue[] = [];
    const entries: Omit<Entry, 'start'>[] = [];
    items.forEach((u, i) => {
      const label = decodeURIComponent(baseName(new URL(u).pathname)).replace(/\.json$/i, '');
      const doc = checkDoc(texts[i], label, issues);
      // Relative model.src resolves against the doc URL (a .gltf then finds its .bin / images by URL)
      if (doc) entries.push({ label, doc, duration: docDuration(doc), model: (src) => ({ url: isUrl(src) ? src : new URL(src, u).href }) });
    });
    showMsg(null);
    if (issues.length) return showIssues(issues);
    startShow(pl?.title ?? baseName(path).replace(/\.json$/i, ''), entries);
    const q = new URLSearchParams(location.search);
    q.set('doc', path);
    history.replaceState(null, '', `?${q}`);
  } catch (err) {
    if (seq === openSeq) showMsg(`불러오지 못했습니다: ${(err as Error).message}`);
  }
}

// ---------- dropped files ----------
/** Model / doc files by normalized relative path */
const pool = new Map<string, File>();
const jsonPool = new Map<string, File>();
/** Re-opens the current dropped doc (after more model files were added) */
let reopenDropped: (() => void) | null = null;

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

function findIn(map: Map<string, File>, src: string): File | null {
  const want = norm(src);
  const exact = map.get(want);
  if (exact) return exact;
  // dropped folder: keys carry the folder prefix ("examples/models/mug.glb")
  for (const [key, f] of map) if (key.endsWith('/' + want)) return f;
  const base = want.slice(want.lastIndexOf('/') + 1);
  for (const [key, f] of map) if (key.slice(key.lastIndexOf('/') + 1) === base) return f;
  return null;
}

const relPath = (f: File) => (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
const dropModel = (src: string): ModelRef | null => {
  if (isUrl(src)) return { url: src };
  const f = findIn(pool, src);
  return f && { file: f };
};

function addFiles(files: File[]): void {
  const jsons = files.filter((f) => /\.json$/i.test(f.name) || f.type === 'application/json');
  for (const f of files) (jsons.includes(f) ? jsonPool : pool).set(norm(relPath(f)), f);
  if (jsons.length > 1) showPicker(jsons);
  else if (jsons.length === 1) void openDropped(jsons[0]);
  else reopenDropped?.();
}

/** Several JSON files in one batch: let the user choose which one is the previs doc (or playlist) */
function showPicker(jsons: File[]): void {
  openSeq++;
  stopShow();
  showIssues(null);
  showMsg(null);
  reopenDropped = null;
  const label = document.createElement('p');
  label.textContent = 'JSON 파일이 여러 개입니다. 재생할 previs 문서(또는 재생목록)를 선택하세요.';
  const buttons = jsons.map((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = relPath(f);
    b.addEventListener('click', () => void openDropped(f));
    return b;
  });
  pickerEl.replaceChildren(label, ...buttons);
  pickerEl.hidden = false;
}

async function openDropped(f: File): Promise<void> {
  const seq = ++openSeq;
  pickerEl.hidden = true;
  stopShow();
  showMsg(null);
  showIssues(null);
  reopenDropped = null;
  // Read once (doc and playlist docs): a File handle can become unreadable later
  const read = async (file: File): Promise<unknown> => JSON.parse(await file.text());
  let json: unknown;
  try {
    json = await read(f);
  } catch (err) {
    if (seq === openSeq) showIssues([{ path: f.name, message: `JSON 읽기/파싱 실패: ${(err as Error).message}` }]);
    return;
  }
  const pl = asPlaylist(json);
  const issues: Issue[] = [];
  let raw: { label: string; json: unknown }[];
  if (pl) {
    issues.push(...playlistIssues(pl).map((i) => ({ path: `${f.name} ${i.path}`, message: i.message })));
    raw = [];
    if (!issues.length) {
      // Docs relative to the playlist file: match the dropped JSON files like model files
      const dir = relPath(f).includes('/') ? relPath(f).slice(0, relPath(f).lastIndexOf('/') + 1) : '';
      for (const d of pl.docs) {
        const file = findIn(jsonPool, dir + d) ?? findIn(jsonPool, d);
        if (!file) {
          issues.push({ path: `${f.name} docs`, message: `문서 파일 없음: ${d} (재생목록과 함께 선택하거나 끌어다 놓으세요)` });
          continue;
        }
        try {
          raw.push({ label: d.replace(/^.*\//, '').replace(/\.json$/i, ''), json: await read(file) });
        } catch (err) {
          issues.push({ path: d, message: `JSON 읽기/파싱 실패: ${(err as Error).message}` });
        }
      }
    }
  } else raw = [{ label: f.name.replace(/\.json$/i, ''), json }];
  if (seq !== openSeq) return;
  const title = pl?.title ?? f.name.replace(/\.json$/i, '');
  // More model files later: rebuild from the JSON parsed here (never re-read the File)
  reopenDropped = () => {
    openSeq++;
    stopShow();
    showMsg(null);
    showIssues(null);
    startDropped(title, raw, issues);
  };
  startDropped(title, raw, issues);
}

/** Validates parsed dropped docs, checks their model files and starts the show (or lists the issues) */
function startDropped(title: string, raw: { label: string; json: unknown }[], readIssues: Issue[]): void {
  const issues = [...readIssues];
  const entries: Omit<Entry, 'start'>[] = [];
  for (const r of raw) {
    const doc = checkDoc(r.json, r.label, issues);
    if (doc) entries.push({ label: r.label, doc, duration: docDuration(doc), model: dropModel });
  }
  const missing = [...new Set(entries.flatMap((e) => modelSrcsToLoad(e.doc).filter((src) => !dropModel(src))))];
  for (const src of missing) issues.push({ path: 'model.src', message: `모델 파일 없음: ${src} (이 파일을 함께 선택하거나 끌어다 놓으세요)` });
  if (issues.length) return showIssues(issues);
  startShow(title, entries);
  const q = new URLSearchParams(location.search);
  q.delete('doc');
  history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
  docsEl.value = '';
}

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

// ---------- wiring ----------
function fillDocMenu(): void {
  const groups = new Map<string, string[]>();
  for (const p of SERVER_DOCS) {
    const dir = p.slice(0, p.lastIndexOf('/'));
    groups.set(dir, [...(groups.get(dir) ?? []), p]);
  }
  const head = document.createElement('option');
  head.value = '';
  head.textContent = SERVER_DOCS.length ? '예제 선택…' : '(서버 예제 없음)';
  docsEl.replaceChildren(
    head,
    ...[...groups].map(([dir, list]) => {
      const g = document.createElement('optgroup');
      g.label = dir;
      g.append(
        ...list.map((p) => {
          const o = document.createElement('option');
          o.value = p;
          o.textContent = /(^|[/.])playlist\.json$/i.test(p) ? `${baseName(p)} (재생목록)` : baseName(p);
          return o;
        }),
      );
      return g;
    }),
  );
}

docsEl.addEventListener('change', () => {
  if (docsEl.value) {
    reopenDropped = null;
    void openServer(docsEl.value);
  }
  docsEl.blur();
});

lookBtn.addEventListener('click', () => {
  lookBtn.blur();
  look = look === 'flat' ? 'textured' : 'flat';
  updateLookBtn();
  shownError = null;
  showMsg(null);
  const q = new URLSearchParams(location.search);
  if (look === 'textured') q.set('look', 'textured');
  else q.delete('look');
  history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
});

playBtn.addEventListener('click', () => {
  const s = show;
  playBtn.blur();
  if (!s || (blocked && !clock.playing)) return;
  if (!clock.playing && clock.t >= s.total) clock.t = 0;
  setPlaying(!clock.playing);
});
seek.addEventListener('input', () => {
  clock.t = Number(seek.value);
  clock.last = performance.now();
});
// The bar follows the clock unless the pointer holds it; focus never sticks (shortcuts, thumb updates)
seek.addEventListener('pointerdown', () => (scrubbing = true));
const endScrub = () => {
  if (!scrubbing) return;
  scrubbing = false;
  seek.blur();
};
window.addEventListener('pointerup', endScrub);
window.addEventListener('pointercancel', endScrub);
seek.addEventListener('change', () => seek.blur());
sceneEl.addEventListener('change', () => {
  const e = show?.entries[Number(sceneEl.value)];
  if (e) clock.t = e.start;
  sceneEl.blur();
});
window.addEventListener('resize', fit);
window.addEventListener('keydown', (e) => {
  // Text fields and selects keep their keys; a focused range / button still gets the shortcuts
  const el = e.target;
  if (!show || e.ctrlKey || e.metaKey || e.altKey || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) return;
  if (el instanceof HTMLInputElement && !['range', 'button'].includes(el.type)) return;
  if (e.key === ' ') {
    e.preventDefault();
    playBtn.click();
  } else if (e.key === 't') lookBtn.click();
});

const fileEl = $<HTMLInputElement>('file');
fileEl.addEventListener('change', () => {
  const files = [...(fileEl.files ?? [])];
  fileEl.value = '';
  if (files.length) addFiles(files);
});
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
window.addEventListener('dragleave', () => drop.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (!e.dataTransfer) return;
  filesOfDrop(e.dataTransfer).then(
    (files) => files.length && addFiles(files),
    (err) => showMsg(`파일을 읽지 못했습니다: ${(err as Error).message ?? String(err)}`),
  );
});

// Automation hook (scratch browser checks): read-only state + perf counters
(window as unknown as { __viewer: unknown }).__viewer = {
  docs: SERVER_DOCS,
  loads,
  state: () => {
    const s = show;
    const A = slots[active];
    return {
      title: s?.title ?? null,
      t: clock.t,
      total: s?.total ?? 0,
      playing: clock.playing,
      look,
      scene: s ? sceneAt(s, clock.t) : -1,
      scenes: s?.entries.map((e) => ({ label: e.label, start: e.start, duration: e.duration })) ?? [],
      active: { key: A.key, ready: A.ready, backend: A.backend },
      other: { key: slots[1 - active].key, ready: slots[1 - active].ready, error: slots[1 - active].error },
      loading: !loadingEl.hidden,
      msg: msgEl.hidden ? null : msgEl.textContent,
      issues: issuesEl.hidden ? null : [...issuesEl.children].map((li) => li.textContent),
    };
  },
  perf: () => perfSummary(),
  resetPerf: () => {
    perf.intervals.length = 0;
    perf.draws.length = 0;
    perf.lastFrame = 0;
  },
};

fillDocMenu();
updateLookBtn();
const initial = new URLSearchParams(location.search).get('doc');
if (initial) {
  if (SERVER_DOCS.includes(initial)) docsEl.value = initial;
  void openServer(initial);
}
