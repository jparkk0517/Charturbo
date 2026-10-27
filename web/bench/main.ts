/**
 * Benchmark page (`npm run bench`, bench/run-bench.mjs drives it over the DevTools Protocol):
 * `index.html?scenario=<id>&lib=<viz|uplot|echarts|chartjs|plotly|chartgpu|scichart|highcharts
 * |three|deckgl|cosmos|forcegraph3d>&backend=webgpu|webgl2&reps=N&warmup=W&duration=ms` runs one
 * scenario in a fresh page and publishes `window.__bench` (`{ done, ok, result | error }`).
 *
 * Phases: data generation (not timed) -> library init -> W warmup + N timed full renders
 * (time to first frame) -> N GPU-synced renders (pixel read-back) -> memory snapshot after GC ->
 * steady phase (zoom / pan schedule, hover sweep or streaming over `duration` ms) -> hover
 * latency probe. `backend=webgl2` hides `navigator.gpu` so wgpu falls back to WebGL2.
 * 3D graph scenarios (`graph-*`) run `runGraph` instead (physics + orbit).
 */

import { VizEngineSDK } from '../src/index';
import type { VizRenderStats } from '../src/index';
import { createAdapter, compareData } from './others';
import type { Domain, LibAdapter, LibName } from './others';
import { COMPARE_IDS, OUR_SCENARIOS } from './ours';
import type { CompareId, Interaction, OurScenario } from './ours';
import { GRAPH_IDS, createGraphAdapter, graphData, graphSpec } from './graph';
import type { GraphId, GraphLib } from './graph';

const q = new URLSearchParams(location.search);
const scenarioId = q.get('scenario') ?? '';
const lib = (q.get('lib') ?? 'viz') as LibName;
const backend = q.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu';
const REPS = Math.max(1, Number(q.get('reps') ?? 5) | 0);
const WARMUP = Math.max(0, Number(q.get('warmup') ?? 1) | 0);
const DURATION = Math.max(200, Number(q.get('duration') ?? 3000));
/** Comparison mode: window set through each library's range API (same schedule for all) */
const COMPARE = q.has('compare');
const W = 960;
const H = 540;
const FRAME_MS = 1000 / 60;
/** Time budget of the repeated-render and hover phases (slow libraries on huge data) */
const PHASE_BUDGET_MS = 30_000;

if (backend === 'webgl2') {
  Object.defineProperty(Navigator.prototype, 'gpu', { configurable: true, get: () => undefined });
}

declare global {
  interface Window {
    __bench?: { done: boolean; ok: boolean; result?: unknown; error?: string };
    __benchList?: { ours: string[]; compare: readonly string[] };
    /** Current phase (the runner names it when a page times out) */
    __benchPhase?: string;
    gc?: () => void;
  }
}
window.__benchList = { ours: OUR_SCENARIOS.map((s) => s.id), compare: [...COMPARE_IDS, ...GRAPH_IDS] };

const card = document.getElementById('card') as HTMLElement;
const raf = () => new Promise<number>((r) => requestAnimationFrame(r));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/**
 * Resolves after the next frame's rendering update (rAF, then a task queued from it runs after
 * that frame's paint / commit): the frame holding the new canvas content was handed to the
 * compositor. GPU execution is asynchronous beyond that (see the `pixels` metric).
 */
/**
 * Phase marker for the runner (CDP binding `__benchSignal`): it samples the renderer's main-
 * thread task / script / layout time (Performance.getMetrics) at both ends of the steady phase.
 * The binding is asynchronous: wait a little so the sample lands before the phase starts / ends.
 */
async function signal(phase: string) {
  const bind = (window as unknown as { __benchSignal?: (p: string) => void }).__benchSignal;
  if (!bind) return;
  bind(phase);
  await sleep(100);
}

const phase = (name: string) => (window.__benchPhase = name);

const committed = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 0)));

export interface Summary {
  n: number;
  median: number;
  p95: number;
  max: number;
  mean: number;
}

function summarize(v: number[]): Summary {
  if (v.length === 0) return { n: 0, median: NaN, p95: NaN, max: NaN, mean: NaN };
  const s = [...v].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  const round = (x: number) => Math.round(x * 100) / 100;
  return { n: s.length, median: round(at(0.5)), p95: round(at(0.95)), max: round(s[s.length - 1]), mean: round(s.reduce((a, b) => a + b, 0) / s.length) };
}

/** 1 x 1 CPU-backed 2D canvas: drawing a GPU canvas into it waits for the GPU to finish. */
const probe = (() => {
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  return c.getContext('2d', { willReadFrequently: true })!;
})();

function gpuSync(): void {
  for (const c of card.querySelectorAll('canvas')) {
    if (c.width === 0 || c.height === 0) continue;
    probe.drawImage(c, c.width >> 1, c.height >> 1, 1, 1, 0, 0, 1, 1);
  }
  probe.getImageData(0, 0, 1, 1);
}

/** Shared full-render timing: `render` resolves when the library reports it drew. */
async function timeRenders(render: () => Promise<void> | void) {
  phase('ttff');
  for (let i = 0; i < WARMUP; i++) {
    await render();
    await committed();
  }
  const call: number[] = [];
  const frame: number[] = [];
  const pixels: number[] = [];
  // Slow libraries on 10M samples: at least 3 samples, then stop once over the phase budget
  const budget = performance.now() + PHASE_BUDGET_MS;
  const more = (i: number) => i < REPS && (i < 3 || performance.now() < budget);
  for (let i = 0; more(i); i++) {
    await sleep(30);
    // Start at a frame boundary (like an input-driven update), so the vsync phase does not vary;
    // the first rAF after idle fires off the vsync grid, the second one on it
    await raf();
    await raf();
    performance.mark(`render-${i}`);
    const t0 = performance.now();
    await render();
    call.push(performance.now() - t0);
    await committed();
    frame.push(performance.now() - t0);
    performance.measure(`ttff-${i}`, `render-${i}`);
  }
  phase('pixels');
  const budget2 = performance.now() + PHASE_BUDGET_MS;
  for (let i = 0; i < REPS && (i < 3 || performance.now() < budget2); i++) {
    await sleep(30);
    await raf();
    await raf();
    const t0 = performance.now();
    await render();
    gpuSync();
    pixels.push(performance.now() - t0);
    await committed();
  }
  const r2 = (v: number[]) => v.map((x) => Math.round(x * 100) / 100);
  return { call: summarize(call), frame: summarize(frame), pixels: summarize(pixels), samples: { call: r2(call), frame: r2(frame), pixels: r2(pixels) } };
}

/** JS heap after a forced GC (`--js-flags=--expose-gc`), plus the full UA memory where available. */
async function memory() {
  phase('memory');
  window.gc?.();
  await raf();
  window.gc?.();
  const pm = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  let uaBytes: number | null = null;
  const measure = (performance as unknown as { measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }> }).measureUserAgentSpecificMemory;
  if (crossOriginIsolated && measure) {
    try {
      const r = await Promise.race([measure.call(performance), sleep(15_000).then(() => null)]);
      uaBytes = r ? r.bytes : null;
    } catch {
      uaBytes = null;
    }
  }
  return { jsHeapBytes: pm?.usedJSHeapSize ?? null, uaBytes };
}

/** Zoom-in / pan / zoom-out window over `p` in [0, 1] (fractions of the full domain). */
function scheduleWindow(p: number, d: Domain, xy: boolean): Domain {
  const minW = 0.01;
  let w: number;
  let c = 0.5;
  if (p < 0.4) w = Math.pow(minW, p / 0.4);
  else if (p < 0.7) {
    w = minW;
    c = 0.5 + 0.3 * Math.sin(((p - 0.4) / 0.3) * Math.PI * 2);
  } else w = Math.pow(minW, (1 - p) / 0.3);
  const lo = Math.max(0, Math.min(1 - w, c - w / 2));
  const x0 = d.x0 + (d.x1 - d.x0) * lo;
  const x1 = x0 + (d.x1 - d.x0) * w;
  if (!xy) return { x0, x1, y0: d.y0, y1: d.y1 };
  const y0 = d.y0 + (d.y1 - d.y0) * lo;
  return { x0, x1, y0, y1: y0 + (d.y1 - d.y0) * w };
}

/**
 * rAF loop for `DURATION` ms: `step(p, frame)` runs at the start of each frame. Frame interval
 * = rAF delta; work = time spent in `step`; dropped = intervals beyond one 60 Hz vsync.
 */
async function frameLoop(step: (p: number, frame: number) => void | Promise<void>) {
  phase('steady');
  await signal('steady-start');
  const intervals: number[] = [];
  const work: number[] = [];
  let dropped = 0;
  let last = await raf();
  const t0 = last;
  let k = 0;
  for (;;) {
    const t = await raf();
    const dt = t - last;
    last = t;
    intervals.push(dt);
    dropped += Math.max(0, Math.round(dt / FRAME_MS) - 1);
    const p = (t - t0) / DURATION;
    if (p >= 1) break;
    const w0 = performance.now();
    const pending = step(p, k++);
    if (pending) await pending;
    work.push(performance.now() - w0);
  }
  await signal('steady-end');
  return { frames: k, interval: summarize(intervals), work: summarize(work), dropped, fps: Math.round((intervals.length / ((last - t0) / 1000)) * 10) / 10 };
}

function pointer(target: Element, type: string, x: number, y: number, buttons = 0, extra: Record<string, unknown> = {}) {
  const init = { clientX: x, clientY: y, bubbles: true, cancelable: true, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true, ...extra };
  if (type.startsWith('pointer')) target.dispatchEvent(new PointerEvent(type, init));
  else if (type === 'wheel') target.dispatchEvent(new WheelEvent('wheel', init));
  else target.dispatchEvent(new MouseEvent(type, init));
}

/** Pointer + mouse move (libraries listen to either). */
function moveTo(target: Element, x: number, y: number) {
  pointer(target, 'pointermove', x, y);
  pointer(target, 'mousemove', x, y);
}

/** Plot-area point at fraction `fx`, `fy` of the card (inside typical margins). */
function plotPoint(target: Element, fx: number, fy: number): [number, number] {
  const r = target.getBoundingClientRect();
  return [r.left + 70 + (r.width - 100) * fx, r.top + 40 + (r.height - 80) * fy];
}

/**
 * Hover latency: one pointer move per frame for `count` frames. `sync` = the event dispatch
 * (handlers that hit-test inline); `interval` = rAF interval while hovering, which also catches
 * work a library defers to a timer / the next frame (a slow deferred hover shows as long frames).
 */
async function hoverProbe(target: Element | null, count = 40) {
  if (!target) return null;
  phase('hover');
  const sync: number[] = [];
  const intervals: number[] = [];
  let dropped = 0;
  await raf();
  let last = await raf();
  const budget = last + PHASE_BUDGET_MS / 3;
  for (let i = 0; i < count && last < budget; i++) {
    const [x, y] = plotPoint(target, (i + 0.5) / count, 0.5 + 0.3 * Math.sin(i));
    const t0 = performance.now();
    moveTo(target, x, y);
    sync.push(performance.now() - t0);
    const t = await raf();
    intervals.push(t - last);
    dropped += Math.max(0, Math.round((t - last) / FRAME_MS) - 1);
    last = t;
  }
  return { sync: summarize(sync), interval: summarize(intervals), dropped };
}

/** Scripted wheel zoom at the plot center, drag pan, wheel zoom out (SDK gesture path). */
function gestureStep(canvas: HTMLCanvasElement) {
  let dragging = false;
  let dx = 0;
  return (p: number) => {
    const [cx, cy] = plotPoint(canvas, 0.5, 0.5);
    if (p < 0.35 || p >= 0.65) {
      if (dragging) {
        pointer(canvas, 'pointerup', cx + dx, cy, 0);
        dragging = false;
      }
      pointer(canvas, 'wheel', cx, cy, 0, { deltaY: p < 0.35 ? -60 : 60, deltaMode: 0 });
      return;
    }
    if (!dragging) {
      dx = 0;
      pointer(canvas, 'pointerdown', cx, cy, 1, { button: 0 });
      dragging = true;
    }
    // Right then back left: 6 px per frame
    dx += p < 0.5 ? 6 : -6;
    pointer(canvas, 'pointermove', cx + dx, cy, 1);
  };
}

function hoverSweepStep(target: Element) {
  return (p: number) => {
    const [x, y] = plotPoint(target, (p * 7) % 1, 0.3 + 0.4 * Math.abs(Math.sin(p * 13)));
    moveTo(target, x, y);
  };
}

function statsOf(sdk: VizEngineSDK): VizRenderStats | null {
  return sdk.getRenderStats();
}

async function runOurs(s: OurScenario) {
  const tGen = performance.now();
  const draw = s.prepare();
  const genMs = performance.now() - tGen;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  Object.assign(canvas.style, { width: `${W}px`, height: `${H}px`, display: 'block' });
  card.appendChild(canvas);
  const tInit = performance.now();
  const sdk = await VizEngineSDK.create(canvas, { autoResize: false, locale: 'en-US', timeZone: 'UTC', nodeCount: 0, edgeCount: 0 });
  const initMs = performance.now() - tInit;
  const gl = !!canvas.getContext('webgl2');
  sdk.setTheme('light');
  sdk.enableNodeInteractions(canvas, { autoRender: true });

  const ttff = await timeRenders(() => {
    draw(sdk);
    sdk.render();
  });
  const afterRender = statsOf(sdk);
  const mem = await memory();

  const interaction: Interaction = s.interaction;
  let steady;
  let uploadPerFrame: number | null = null;
  const before = statsOf(sdk);
  if (interaction === 'stream') {
    steady = await frameLoop((_, k) => {
      s.stream!(sdk, k);
      sdk.render();
    });
  } else if (interaction === 'hover' || !sdk.handlesChartNavigation()) {
    steady = await frameLoop(hoverSweepStep(canvas));
  } else {
    steady = await frameLoop(gestureStep(canvas));
  }
  const after = statsOf(sdk);
  if (before && after && after.frames > before.frames) {
    uploadPerFrame = Math.round((after.chartUploadTotal - before.chartUploadTotal) / (after.frames - before.frames));
  }
  // Fresh view for the hover probe (zoom ended at the full window; streaming stays live)
  sdk.resetChartZoom();
  sdk.render();
  const hover = await hoverProbe(canvas);
  return {
    lib: 'viz',
    scenario: s.id,
    size: s.size,
    backend: gl ? 'webgl2' : 'webgpu',
    interaction: interaction === 'stream' ? 'stream' : interaction === 'hover' || !sdk.handlesChartNavigation() ? 'hover-sweep' : 'wheel+drag',
    genMs: Math.round(genMs),
    initMs: Math.round(initMs),
    ttff,
    memory: { ...mem, wasmBytes: after?.wasmMemoryBytes ?? null, gpuBytes: afterRender?.gpuBytes ?? null },
    stats: afterRender,
    steady: { ...steady, uploadBytesPerFrame: uploadPerFrame },
    hover,
  };
}

async function runCompare(id: CompareId) {
  const tGen = performance.now();
  const data = compareData(id);
  const genMs = performance.now() - tGen;
  let vizSdk: VizEngineSDK | null = null;
  phase('init');
  const tInit = performance.now();
  const adapter: LibAdapter = await createAdapter(lib, card, data, W, H, (sdk) => (vizSdk = sdk));
  const initMs = performance.now() - tInit;
  const ttff = await timeRenders(() => adapter.render());
  const mem = await memory();
  const xy = !!data.scatter;
  const steady = adapter.zoomable
    ? await frameLoop((p) => adapter.setWindow(scheduleWindow(p, data.domain, xy)))
    : await frameLoop(hoverSweepStep(adapter.hoverTarget() ?? card));
  if (adapter.zoomable) {
    adapter.setWindow(data.domain);
    await raf();
    await raf();
  }
  const hover = await hoverProbe(adapter.hoverTarget());
  const stats = vizSdk ? (vizSdk as VizEngineSDK).getRenderStats() : null;
  const gl = card.querySelector('canvas')?.getContext('webgl2') ? 'webgl2' : 'webgpu';
  return {
    lib,
    scenario: id,
    backend: adapter.backend?.() ?? (lib === 'viz' ? gl : lib === 'plotly' ? 'webgl' : lib === 'chartgpu' ? 'webgpu' : lib === 'highcharts' ? 'webgl' : 'canvas2d'),
    interaction: adapter.zoomable ? 'range-api' : 'hover-sweep',
    genMs: Math.round(genMs),
    initMs: Math.round(initMs),
    ttff,
    methodologyVersion: 2,
    memory: { ...mem, wasmBytes: stats?.wasmMemoryBytes ?? null, gpuBytes: stats?.gpuBytes ?? null },
    steady,
    hover,
  };
}

/** Fixed step for the matched viz/three engines; other libraries use their own integrators. */
const GRAPH_DT = 0.016;
/** Camera orbit over the steady phase: half a turn, driven by elapsed time (not frame count) */
const GRAPH_ORBIT = Math.PI;

/**
 * 3D graph comparison (bench/graph.ts): cold = first dataset load + first presented frame on a
 * fresh engine (three.js compiles its shaders here; viz builds its pipelines at engine creation,
 * i.e. in initMs); TTFF = warm reload of the same buffers
 * + first presented frame; steady = adapter-specific layout + buffer sync + draw.
 * deck.gl is render-only; cosmos is 2D without orbit. Memory follows the steady phase and GC.
 */
async function runGraph(id: GraphId) {
  const graphLib = lib as GraphLib;
  if (!(graphLib === 'viz' || graphLib === 'vizgpu' || graphLib === 'three' || graphLib === 'deckgl' || graphLib === 'cosmos' || graphLib === 'forcegraph3d')) {
    throw new Error(`unsupported: ${lib} has no graph renderer`);
  }
  const spec = graphSpec(id);
  const tGen = performance.now();
  const raw = graphData(spec);
  const genMs = performance.now() - tGen;
  phase('init');
  const tInit = performance.now();
  const g = await createGraphAdapter(graphLib, card, W, H);
  const initMs = performance.now() - tInit;
  const load = async () => {
    g.adapter.loadRawDataset!(raw);
    await g.loaded?.();
  };
  phase('cold');
  const c0 = performance.now();
  await load();
  await committed();
  const coldMs = performance.now() - c0;
  const ttff = await timeRenders(load);
  const physicsValidation = await g.validatePhysics?.();
  const physics: number[] = [];
  const render: number[] = [];
  let lastP = 0;
  const steady = await frameLoop((p) => {
    g.adapter.rotateCamera((p - lastP) * GRAPH_ORBIT, 0);
    lastP = p;
    const record = (t: import('../src/adapters/engine-adapter').EngineStepTiming) => {
      physics.push(t.physicsTimeMs);
      render.push(t.renderTimeMs);
    };
    if (g.tickAsync) return g.tickAsync(GRAPH_DT, true).then(record);
    record(g.adapter.tick(GRAPH_DT, true));
  });
  const mem = await memory();
  return {
    lib,
    scenario: id,
    nodes: g.adapter.nodeCount(),
    edges: g.adapter.edgeCount(),
    backend: g.backend(),
    interaction: graphLib === 'deckgl' ? 'render+orbit' : graphLib === 'cosmos' ? '2d-layout' : 'physics+orbit',
    methodologyVersion: 3,
    physicsTiming: graphLib === 'vizgpu' ? 'wall-time including GPU readback, CPU integration and index rebuild' : 'CPU execution/submission only',
    physicsValidation,
    genMs: Math.round(genMs),
    initMs: Math.round(initMs),
    coldMs: Math.round(coldMs * 100) / 100,
    ttff,
    memory: { ...mem, wasmBytes: g.wasmBytes(), gpuBytes: g.gpuBytes() },
    steady: { ...steady, physics: summarize(physics), render: summarize(render) },
    hover: null,
  };
}

/** Capability probe: WebGPU adapter info and the WebGL2 renderer string. */
async function probeGpu() {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<{ info?: Record<string, string> } | null> } }).gpu;
  let adapter: Record<string, string> | null = null;
  try {
    const a = await gpu?.requestAdapter();
    adapter = a ? { vendor: a.info?.vendor ?? '', architecture: a.info?.architecture ?? '', description: a.info?.description ?? '' } : null;
  } catch {
    adapter = null;
  }
  const gl = document.createElement('canvas').getContext('webgl2');
  const ext = gl?.getExtension('WEBGL_debug_renderer_info');
  const webgl2 = gl ? String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : null;
  return { webgpu: adapter, webgl2, crossOriginIsolated, dpr: devicePixelRatio, userAgent: navigator.userAgent };
}

async function run() {
  if (q.has('probe')) return probeGpu();
  // rAF cadence with no work: the frame-time floor of this browser / display
  if (scenarioId === 'idle') return { scenario: 'idle', steady: await frameLoop(() => {}) };
  if (!scenarioId) return null;
  if (COMPARE) {
    if ((GRAPH_IDS as readonly string[]).includes(scenarioId)) return runGraph(scenarioId as GraphId);
    if (!(COMPARE_IDS as readonly string[]).includes(scenarioId)) throw new Error(`unknown compare scenario ${scenarioId}`);
    return runCompare(scenarioId as CompareId);
  }
  const s = OUR_SCENARIOS.find((x) => x.id === scenarioId);
  if (!s) throw new Error(`unknown scenario ${scenarioId}`);
  return runOurs(s);
}

run().then(
  (result) => (window.__bench = { done: true, ok: true, result }),
  (err) => (window.__bench = { done: true, ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) })
);
