/**
 * Offline previs render page. `scripts/previs-render.mjs` injects the doc as `window.__previsDoc`
 * (before this module runs), loads `render.html?backend=webgpu|webgl2[&aa=0]`, waits for
 * `window.__previs.done` and then pulls frames via `window.previs`:
 *
 *   window.previs.info()      -> { frames, fps, width, height, duration }
 *   window.previs.frame(i)    -> Promise<string>  PNG data URL of frame i (t = i / fps)
 *
 * The canvas is exactly doc.size CSS px == backing px (devicePixelRatio forced to 1). A frame is
 * rendered and copied in the same task by `toDataURL` (a WebGPU canvas loses its contents once
 * presented), with `pixelRatio: 1` so nothing is resized or scaled, and no DOM overlay.
 * `backend=webgl2` hides `navigator.gpu` before the engine starts (same as e2e/main.ts).
 */
import { Charturbo } from 'charturbo';
import { docDuration, frameCount } from '../src/previs/evaluate';
import { createPrevisPlayer } from '../src/previs/player';
import type { PrevisPlayer } from '../src/previs/player';
import type { Issue, PrevisDoc } from '../src/previs/types';
import { validateDoc } from '../src/previs/validate';

interface PrevisInfo {
  frames: number;
  fps: number;
  width: number;
  height: number;
  duration: number;
}

interface PrevisState {
  done: boolean;
  ok: boolean;
  requestedBackend: string;
  backend?: string;
  issues?: Issue[];
  error?: string;
}

declare global {
  interface Window {
    __previsDoc?: unknown;
    __previs?: PrevisState;
    previs?: { info(): PrevisInfo; frame(i: number): Promise<string> };
  }
}

const query = new URLSearchParams(location.search);
const requested = query.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const antialias = query.get('aa') !== '0';

Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 1 });
if (requested === 'webgl2') {
  Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
}

async function run(): Promise<PrevisState> {
  const state: PrevisState = { done: true, ok: false, requestedBackend: requested };
  const checked = validateDoc(window.__previsDoc);
  if (!checked.ok) return { ...state, issues: checked.issues, error: 'invalid previs document' };
  const doc: PrevisDoc = checked.doc;
  const { width, height } = doc.size;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  document.body.appendChild(canvas);

  const sdk = await Charturbo.create(canvas, {
    autoResize: false,
    nodeCount: 0,
    edgeCount: 0,
    ...(antialias ? { antialias: true } : {}),
  });
  const player: PrevisPlayer = createPrevisPlayer(sdk, doc);
  const frames = frameCount(doc);
  const info: PrevisInfo = { frames, fps: doc.fps, width, height, duration: docDuration(doc) };

  window.previs = {
    info: () => info,
    async frame(i) {
      if (!Number.isInteger(i) || i < 0 || i >= frames) throw new RangeError(`frame ${i} outside 0..${frames - 1}`);
      player.frame(i / doc.fps);
      sdk.render();
      return sdk.toDataURL({ overlay: false, pixelRatio: 1, format: 'png' });
    },
  };
  return { ...state, ok: true, backend: canvas.getContext('webgl2') ? 'webgl2' : 'webgpu' };
}

run().then(
  (s) => (window.__previs = s),
  (err: unknown) =>
    (window.__previs = {
      done: true,
      ok: false,
      requestedBackend: requested,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    }),
);
