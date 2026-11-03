/**
 * Offline previs render page. `scripts/previs-render.mjs` injects the doc as `window.__previsDoc`
 * (before this module runs, with `window.__previsModels` = model.src -> served URL), loads `render.html?backend=webgpu|webgl2[&aa=0]`, waits for
 * `window.__previs.done` and then pulls frames via `window.previs`:
 *
 *   window.previs.info()      -> { frames, fps, width, height, duration }
 *   window.previs.frame(i)    -> Promise<string>  PNG data URL of frame i (t = i / fps)
 *   window.previs.camera(i)   -> camera record of frame i (meters + engine-unit view / projection, see ./camera.ts)
 *   window.previs.measureFrame(i) -> { near_m, far_m } | null: foreground min / max planar depth (meters) of frame i, from a
 *                                'packed' depth render (SDK readDepthRange); null = no foreground pixel
 *   window.previs.frame(i, { depth: { encoding: 'inverse'|'linear', near_m, far_m } }) -> PNG of the depth pass of frame i
 *                                (gray R=G=B, near = white, background 0; range in meters, engine units = meters * worldScale)
 *
 * The depth pass needs MSAA off: entering it (frame with `depth`, measureFrame) calls `setAntialias(1)`; the next
 * `frame(i)` without `depth` restores beauty and the initial anti-aliasing (4 unless `aa=0`).
 *
 * The canvas is exactly doc.size CSS px == backing px (devicePixelRatio forced to 1). A frame is
 * rendered and copied in the same task by `toDataURL` (a WebGPU canvas loses its contents once
 * presented), with `pixelRatio: 1` so nothing is resized or scaled, and no DOM overlay.
 * `backend=webgl2` hides `navigator.gpu` before the engine starts (same as e2e/main.ts).
 */
import { Charturbo } from 'charturbo';
import { docDuration, evaluateFrame, frameCount } from '../src/previs/evaluate';
import { DEFAULT_WORLD_SCALE, engineCameraMatrices } from './camera';
import { loadPrevisPlayer } from '../src/previs/player';
import type { PrevisPlayer } from '../src/previs/player';
import type { Issue, PrevisDoc } from '../src/previs/types';
import { modelSrcsToLoad } from '../src/previs/models';
import { validateDoc } from '../src/previs/validate';
import { gltfExtensions, loadDecodersFor } from './decoders';

interface PrevisInfo {
  frames: number;
  fps: number;
  width: number;
  height: number;
  duration: number;
  worldScale: number;
}

interface DepthFrameOptions {
  encoding: 'inverse' | 'linear';
  near_m: number;
  far_m: number;
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
    /** model.src -> URL served by the dev server (relative paths already resolved against the doc file's dir) */
    __previsModels?: Record<string, string>;
    __previs?: PrevisState;
    previs?: {
      info(): PrevisInfo;
      frame(i: number, opts?: { depth?: DepthFrameOptions }): Promise<string>;
      camera(i: number): Record<string, unknown>;
      measureFrame(i: number): { near_m: number; far_m: number } | null;
    };
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
  const served = window.__previsModels ?? {};
  // Fetch each model once: its extensionsUsed pick the decoders (loaded only when needed); .glb bytes are reused
  const bytes = new Map<string, Uint8Array>();
  const exts = new Set<string>();
  for (const src of modelSrcsToLoad(doc)) {
    if (bytes.has(src)) continue;
    const url = src in served ? new URL(served[src], location.href).href : src;
    const res = await fetch(url);
    if (!res.ok) {
      bytes.set(src, new Uint8Array(0)); // not served: the player's own load reports it
      continue;
    }
    const b = new Uint8Array(await res.arrayBuffer());
    gltfExtensions(b).forEach((e) => exts.add(e));
    if (b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) bytes.set(src, b); // .gltf may load siblings: keep the URL
    else bytes.set(src, new Uint8Array(0));
  }
  const decoders = await loadDecodersFor(exts);
  const player: PrevisPlayer = await loadPrevisPlayer(sdk, doc, {
    resolveModel: (src) => (bytes.get(src)?.length ? bytes.get(src)! : src in served ? new URL(served[src], location.href).href : src),
    decoders,
  });
  const frames = frameCount(doc);
  const worldScale = doc.worldScale ?? DEFAULT_WORLD_SCALE;
  const info: PrevisInfo = { frames, fps: doc.fps, width, height, duration: docDuration(doc), worldScale };
  const checkFrame = (i: number) => {
    if (!Number.isInteger(i) || i < 0 || i >= frames) throw new RangeError(`frame ${i} outside 0..${frames - 1}`);
  };
  // Depth pass: MSAA off while on (WebGL2 cannot sample a multisampled depth buffer); beauty restores it
  let inDepth = false;
  const enterDepth = () => {
    if (!inDepth && sdk.getAntialias() > 1) sdk.setAntialias(1);
    inDepth = true;
  };
  const enterBeauty = () => {
    if (!inDepth) return;
    sdk.setRenderPass('beauty');
    if (antialias) sdk.setAntialias(4);
    inDepth = false;
  };

  const camState = { prev: null as ReturnType<typeof engineCameraMatrices> | null };
  window.previs = {
    info: () => info,
    camera(i) {
      if (!Number.isInteger(i) || i < 0 || i >= frames) throw new RangeError(`frame ${i} outside 0..${frames - 1}`);
      const t = i / doc.fps;
      const fs = evaluateFrame(doc, t);
      const m = engineCameraMatrices(fs.camera, doc.worldScale, width / height, camState.prev);
      camState.prev = m;
      return {
        frame: i,
        t,
        shot: fs.shotId,
        eye: fs.camera.eye,
        target: fs.camera.target,
        up: fs.camera.up,
        roll: fs.camera.roll,
        fovDeg: fs.camera.fovDeg,
        aspect: width / height,
        near: m.near,
        far: m.far,
        worldScale: m.worldScale,
        view: m.view,
        projection: m.projection,
      };
    },
    measureFrame(i) {
      checkFrame(i);
      enterDepth();
      sdk.setRenderPass('depth', { encoding: 'packed' });
      player.frame(i / doc.fps);
      const r = sdk.readDepthRange();
      return r ? { near_m: r.near / worldScale, far_m: r.far / worldScale } : null;
    },
    async frame(i, opts) {
      checkFrame(i);
      if (opts?.depth) {
        enterDepth();
        const d = opts.depth;
        sdk.setRenderPass('depth', { encoding: d.encoding, near: d.near_m * worldScale, far: d.far_m * worldScale });
      } else enterBeauty();
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
