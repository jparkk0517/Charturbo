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
 *   window.previs.contact(spec) -> Promise<string>  PNG data URL of a contact sheet: tiles of the given frames, each with a label
 *                                bar below (`t=<seconds> <shotId>`), composed on a 2D canvas (see scripts/previs-render.mjs --contact)
 *   window.previs.frame(i, { depth: { encoding: 'inverse'|'linear', near_m, far_m } }) -> PNG of the depth pass of frame i
 *                                (gray R=G=B, near = white, background 0; range in meters, engine units = meters * worldScale)
 *
 * Inspect mode (`window.__previsInspect = { src }` instead of `__previsDoc`): loads one model like the player does and
 * stores `window.__previs.inspect` = { nodes: [{ index, name, depth, mesh, skinned, joint }], clips, bounds }; no doc, no frames.
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
  inspect?: InspectResult;
}

interface InspectResult {
  nodes: { index: number; name: string; depth: number; mesh: boolean; skinned: boolean; joint: boolean }[];
  clips: { index: number; name: string; duration: number }[];
  bounds: { min: number[]; max: number[]; size: number[] } | null;
}

interface ContactSpec {
  frames: number[];
  times: number[];
  cols: number;
  rows: number;
  tileW: number;
  tileH: number;
  labelH: number;
}

declare global {
  interface Window {
    __previsDoc?: unknown;
    /** model.src -> URL served by the dev server (relative paths already resolved against the doc file's dir) */
    __previsModels?: Record<string, string>;
    __previsInspect?: { src: string };
    __previs?: PrevisState;
    previs?: {
      info(): PrevisInfo;
      frame(i: number, opts?: { depth?: DepthFrameOptions }): Promise<string>;
      camera(i: number): Record<string, unknown>;
      measureFrame(i: number): { near_m: number; far_m: number } | null;
      contact(spec: ContactSpec): Promise<string>;
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

interface GltfJson {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: { name?: string; children?: number[]; mesh?: number; skin?: number }[];
  skins?: { joints?: number[] }[];
}

/** JSON part of a GLB (first chunk) or a .gltf text; null when unreadable. */
function gltfJson(b: Uint8Array): GltfJson | null {
  try {
    let text: string;
    if (b.length >= 20 && b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46) {
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      text = new TextDecoder().decode(b.subarray(20, 20 + dv.getUint32(12, true)));
    } else text = new TextDecoder().decode(b);
    return JSON.parse(text) as GltfJson;
  } catch {
    return null;
  }
}

async function runInspect(state: PrevisState, src: string): Promise<PrevisState> {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  document.body.appendChild(canvas);
  const sdk = await Charturbo.create(canvas, { autoResize: false, nodeCount: 0, edgeCount: 0 });
  const url = new URL(src, location.href).href;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`model not served (${res.status})`);
  const b = new Uint8Array(await res.arrayBuffer());
  const decoders = await loadDecodersFor(gltfExtensions(b));
  const isGlb = b[0] === 0x67 && b[1] === 0x6c && b[2] === 0x54 && b[3] === 0x46;
  const r = await sdk.loadGltf(isGlb ? b : url, { animations: true, textures: false, decoders });
  const json = gltfJson(b);
  if (!json) throw new Error('cannot read the glTF JSON');
  const nodes = json.nodes ?? [];
  const joints = new Set<number>();
  for (const s of json.skins ?? []) for (const j of s.joints ?? []) joints.add(j);
  const hasParent = new Set<number>();
  for (const n of nodes) for (const c of n.children ?? []) hasParent.add(c);
  const roots = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !hasParent.has(i));
  const out: InspectResult['nodes'] = [];
  const walk = (i: number, depth: number, seen: Set<number>): void => {
    const n = nodes[i];
    if (!n || seen.has(i)) return;
    seen.add(i);
    out.push({ index: i, name: n.name ?? `(node ${i})`, depth, mesh: n.mesh !== undefined, skinned: n.skin !== undefined, joint: joints.has(i) });
    for (const c of n.children ?? []) walk(c, depth + 1, seen);
  };
  const seen = new Set<number>();
  for (const i of roots) walk(i, 0, seen);
  const { min, max } = r.bounds;
  const finite = [...min, ...max].every((v) => Number.isFinite(v));
  const inspect: InspectResult = {
    nodes: out,
    clips: r.animations.map((a, index) => ({ index, name: a.name, duration: a.duration })),
    bounds: finite ? { min: [...min], max: [...max], size: [0, 1, 2].map((k) => max[k] - min[k]) } : null,
  };
  sdk.disposeGltf(r);
  return { ...state, ok: true, backend: canvas.getContext('webgl2') ? 'webgl2' : 'webgpu', inspect };
}

async function run(): Promise<PrevisState> {
  const state: PrevisState = { done: true, ok: false, requestedBackend: requested };
  if (window.__previsInspect) return runInspect(state, window.__previsInspect.src);
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
    async contact(spec) {
      const { cols, rows, tileW, tileH, labelH } = spec;
      const sheet = document.createElement('canvas');
      sheet.width = cols * tileW;
      sheet.height = rows * (tileH + labelH);
      const g = sheet.getContext('2d');
      if (!g) throw new Error('2D canvas unavailable');
      g.fillStyle = '#1a1a1a';
      g.fillRect(0, 0, sheet.width, sheet.height);
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = 'high';
      g.font = '14px sans-serif';
      g.textBaseline = 'middle';
      for (let k = 0; k < spec.frames.length; k++) {
        const i = spec.frames[k];
        checkFrame(i);
        enterBeauty();
        player.frame(i / doc.fps);
        sdk.render();
        const img = new Image();
        img.src = await sdk.toDataURL({ overlay: false, pixelRatio: 1, format: 'png' });
        await img.decode();
        const x = (k % cols) * tileW;
        const y = Math.floor(k / cols) * (tileH + labelH);
        g.drawImage(img, x, y, tileW, tileH);
        g.fillStyle = '#2b2b2b';
        g.fillRect(x, y + tileH, tileW, labelH);
        g.fillStyle = '#eeeeee';
        const shot = evaluateFrame(doc, i / doc.fps).shotId ?? '-';
        g.fillText(`t=${spec.times[k].toFixed(2)} ${shot}`, x + 6, y + tileH + labelH / 2, tileW - 12);
      }
      return sheet.toDataURL('image/png');
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
