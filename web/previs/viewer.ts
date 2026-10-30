/**
 * Browser previs viewer: pick/drop a previs JSON -> validateDoc -> real-time playback in a canvas
 * (no encoding). Run: `npm run previs:viewer` in web/.
 */
import { Charturbo } from 'charturbo';
import { docDuration } from '../src/previs/evaluate';
import { createPrevisPlayer } from '../src/previs/player';
import type { PrevisPlayer } from '../src/previs/player';
import type { PrevisDoc } from '../src/previs/types';
import { validateDoc } from '../src/previs/validate';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const drop = $('drop');
const issuesEl = $<HTMLUListElement>('issues');
const msgEl = $('msg');
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
let loadToken = 0;
const hasGpu = !!(navigator as Navigator & { gpu?: unknown }).gpu;
// test hook: drawn-frame counter + chosen backend
const hook = { frames: 0, backend: '', session: (): Session | null => session };
(window as unknown as { __viewer: typeof hook }).__viewer = hook;

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
  hook.frames++;
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

async function load(file: File): Promise<void> {
  const token = ++loadToken;
  destroySession();
  showIssues(null);
  showMsg(null);
  let json: unknown;
  try {
    json = JSON.parse(await file.text());
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
  try {
    const { sdk, canvas, backend } = await createEngine(doc);
    if (token !== loadToken) {
      sdk.dispose();
      canvas.remove();
      return;
    }
    const duration = docDuration(doc);
    const s: Session = {
      doc,
      duration,
      sdk,
      canvas,
      player: createPrevisPlayer(sdk, doc),
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
    hook.backend = backend;
    if (backend === 'webgl2' && hasGpu) showMsg('WebGPU를 쓸 수 없어 WebGL2로 재생합니다.');
    fit(s);
    draw(s);
    setPlaying(s, true);
    s.raf = requestAnimationFrame((n) => tick(s, n));
  } catch (err) {
    showMsg(`WebGPU/WebGL2 모두 초기화하지 못했습니다: ${(err as Error).message}`);
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
    const f = el.files?.[0];
    el.value = '';
    if (f) void load(f);
  });
}
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
window.addEventListener('dragleave', () => drop.classList.remove('over'));
window.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const f = e.dataTransfer?.files[0];
  if (f) void load(f);
});
