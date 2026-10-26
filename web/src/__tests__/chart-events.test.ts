import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VizEventEmitter, frameThrottle, sameRange, type FrameScheduler } from '../sdk/chart-events';
import { VizInitError, classifyInitError, isRenderingSupported, observeCanvasPixelSize } from '../sdk/viz-init';
// The a11y layer has its own tests and needs a full DOM: replaced by an inert stand-in
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));

import {
  VIZ_THEMES,
  VizEngineSDK,
  type VizHoverEvent,
  type VizRange,
  type WasmVizEngineBackend,
} from '../sdk/viz-engine-sdk';

/** Backend whose zoom calls move a data-unit range the way the engine would (x only for lines). */
function rangeBackend(kind: 'line' | 'scatter' = 'line') {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const full = { x: [0, 100], y: kind === 'scatter' ? [-10, 10] : [NaN, NaN] };
  let x = [...full.x];
  let y = [...full.y];
  let hit = new Float64Array(0);
  const backend: WasmVizEngineBackend = {
    set_line_chart: record('set_line_chart', 0),
    set_scatter_chart: record('set_scatter_chart', 0),
    chart_series_count: () => 2,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_clear_color: record('set_clear_color'),
    set_node_hover_style: record('set_node_hover_style'),
    chart_zoom_x: (factor: number) => {
      record('chart_zoom_x')(factor);
      const mid = (x[0] + x[1]) / 2;
      const half = ((x[1] - x[0]) * factor) / 2;
      x = [mid - half, mid + half];
    },
    chart_pan_x: (d: number) => {
      record('chart_pan_x')(d);
      // Already at the left edge: the engine clamps, nothing moves
      if (d > 0 && x[0] <= full.x[0]) return;
      x = x.map((v) => v - d * 10);
    },
    chart_reset_zoom: () => {
      x = [...full.x];
      y = [...full.y];
    },
    chart_range: () => new Float64Array([x[0], x[1], y[0], y[1]]),
    chart_set_x_range: (lo: number, hi: number) => {
      record('chart_set_x_range')(lo, hi);
      const changed = lo !== x[0] || hi !== x[1];
      x = [lo, hi];
      return changed;
    },
    chart_set_y_range: (lo: number, hi: number) => {
      record('chart_set_y_range')(lo, hi);
      if (kind !== 'scatter') return false;
      y = [lo, hi];
      return true;
    },
    chart_hover_at_ndc: () => hit,
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([56, 16, 200, 100, 1, 1, 12345.5, 56, 50, 0]),
    reload_dataset: () => {},
    load_raw_dataset: () => {},
    export_positions: () => new Float32Array(0),
    import_positions: () => {},
    warmup: () => 0,
    step_physics: () => 0,
    set_auto_sleep: () => {},
    is_sleeping: () => false,
    wake_up: () => {},
    set_force_params: () => {},
    set_frustum_culling: () => {},
    sync_and_render: () => {},
    rotate_camera: () => {},
    zoom_camera: () => {},
    pan_camera: () => {},
    fit_to_view: () => {},
    focus_on_node: () => true,
    resize: record('resize'),
    pick_node_at_ndc: () => -1,
    select_box_ndc: () => new Uint32Array(0),
    query_radius: () => new Uint32Array(0),
    select_node_and_neighbors: () => new Uint32Array(0),
    select_cluster: () => new Uint32Array(0),
    clear_selection: () => {},
    set_node_pinned: () => true,
    move_node_to: () => true,
    node_count: () => 0,
    edge_count: () => 0,
    set_camera_pose: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    clear_scene_objects: () => {},
  };
  return { backend, calls, setHit: (h: number[]) => (hit = new Float64Array(h)) };
}

function lineSdk() {
  const mock = rangeBackend('line');
  const sdk = VizEngineSDK.fromBackend(mock.backend);
  sdk.renderLineChart([
    { name: 'A', values: [1, 2, 3] },
    { name: 'B', values: [4, 5, 6] },
  ]);
  return { sdk, ...mock };
}

function fakeCanvas() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const canvas = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h),
    removeEventListener: (type: string) => delete handlers[type],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, handlers };
}

describe('VizEventEmitter', () => {
  it('on returns an unsubscribe; off removes; has reports listeners', () => {
    const em = new VizEventEmitter<{ ping: number }>();
    const seen: number[] = [];
    const h = (v: number) => seen.push(v);
    expect(em.has('ping')).toBe(false);
    const unsub = em.on('ping', h);
    em.on('ping', (v) => seen.push(v * 10));
    expect(em.has('ping')).toBe(true);
    em.emit('ping', 1);
    unsub();
    em.emit('ping', 2);
    em.off('ping', h); // already gone: no-op
    expect(seen).toEqual([1, 10, 20]);
    em.clear();
    expect(em.has('ping')).toBe(false);
  });

  it('a throwing handler does not stop the others (rethrown asynchronously)', () => {
    vi.useFakeTimers();
    try {
      const em = new VizEventEmitter<{ ping: number }>();
      const seen: number[] = [];
      em.on('ping', () => {
        throw new Error('boom');
      });
      em.on('ping', (v) => seen.push(v));
      expect(() => em.emit('ping', 3)).not.toThrow();
      expect(seen).toEqual([3]);
      expect(() => vi.runAllTimers()).toThrow('boom');
    } finally {
      vi.useRealTimers();
    }
  });

  it('frameThrottle coalesces requests into one call per frame', () => {
    const frames: (() => void)[] = [];
    const scheduler: FrameScheduler = { request: (cb) => frames.push(cb), cancel: () => frames.pop() };
    let n = 0;
    const t = frameThrottle(() => n++, scheduler);
    t.request();
    t.request();
    t.request();
    expect(frames.length).toBe(1);
    frames.shift()!();
    expect(n).toBe(1);
    t.request();
    t.cancel();
    expect(frames.length).toBe(0);
    t.request(); // cancel cleared the pending flag
    expect(frames.length).toBe(1);
  });

  it('sameRange compares every field', () => {
    expect(sameRange({ xMin: 0, xMax: 1 }, { xMin: 0, xMax: 1 })).toBe(true);
    expect(sameRange({ xMin: 0, xMax: 1 }, { xMin: 0, xMax: 1, yMin: 0, yMax: 1 })).toBe(false);
    expect(sameRange(null, null)).toBe(true);
    expect(sameRange(null, { xMin: 0, xMax: 1 })).toBe(false);
  });
});

describe('SDK events', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("'rangechange' fires once per frame after zoom / pan / reset, only when the range moved", () => {
    const { sdk } = lineSdk();
    const ranges: VizRange[] = [];
    sdk.on('rangechange', (r) => ranges.push(r));

    sdk.zoomChartX(0.5);
    sdk.zoomChartX(0.5);
    expect(ranges).toEqual([]); // throttled to the next frame
    vi.advanceTimersByTime(20);
    expect(ranges).toEqual([{ xMin: 37.5, xMax: 62.5 }]); // line: no y range

    sdk.panChartX(-1);
    vi.advanceTimersByTime(20);
    expect(ranges.at(-1)).toEqual({ xMin: 47.5, xMax: 72.5 });

    sdk.resetChartZoom();
    vi.advanceTimersByTime(20);
    expect(ranges.at(-1)).toEqual({ xMin: 0, xMax: 100 });

    // Clamped pan at the edge: the range did not move, so no event
    sdk.panChartX(1);
    vi.advanceTimersByTime(20);
    expect(ranges.length).toBe(3);
  });

  it('getXRange / setXRange round-trip data units; scatter also has a y range', () => {
    const { sdk, calls } = lineSdk();
    expect(sdk.getXRange()).toEqual([0, 100]);
    expect(sdk.getYRange()).toBeNull();
    const ranges: VizRange[] = [];
    sdk.on('rangechange', (r) => ranges.push(r));
    expect(sdk.setXRange(10, 30)).toBe(true);
    expect(sdk.getXRange()).toEqual([10, 30]);
    // Dates pass as epoch ms
    sdk.setXRange(new Date(5), new Date(25));
    expect(calls.chart_set_x_range.at(-1)).toEqual([5, 25]);
    vi.advanceTimersByTime(20);
    expect(ranges).toEqual([{ xMin: 5, xMax: 25 }]);

    const scatter = rangeBackend('scatter');
    const s = VizEngineSDK.fromBackend(scatter.backend);
    s.renderScatterChart({ x: [0, 1], y: [0, 1] });
    expect(s.getYRange()).toEqual([-10, 10]);
    expect(s.setYRange(-2, 2)).toBe(true);
    expect(s.getYRange()).toEqual([-2, 2]);
  });

  it('no chart / bar chart: ranges are null and no events', () => {
    const { backend } = rangeBackend('line');
    const sdk = VizEngineSDK.fromBackend(backend);
    expect(sdk.getXRange()).toBeNull();
    const ranges: VizRange[] = [];
    sdk.on('rangechange', (r) => ranges.push(r));
    sdk.zoomChartX(0.5);
    vi.advanceTimersByTime(20);
    expect(ranges).toEqual([]);
  });

  it("'legendtoggle', 'themechange', 'resize'", () => {
    const { sdk, calls } = lineSdk();
    const toggles: unknown[] = [];
    sdk.on('legendtoggle', (e) => toggles.push(e));
    sdk.setSeriesVisible(1, false);
    sdk.setSeriesVisible(1, false); // unchanged: no event
    sdk.setSeriesVisible(1, true);
    expect(toggles).toEqual([
      { series: 1, visible: false },
      { series: 1, visible: true },
    ]);

    const themes: string[] = [];
    sdk.on('themechange', (t) => themes.push(t.name));
    sdk.setTheme('light');
    expect(themes).toEqual(['light']);

    const sizes: unknown[] = [];
    const off = sdk.on('resize', (e) => sizes.push(e));
    sdk.resize(800, 600);
    off();
    sdk.resize(10, 10);
    expect(sizes).toEqual([{ width: 800, height: 600 }]);
    expect(calls.resize.length).toBe(2);
  });

  it("'hover' / 'click' carry the chart context; leaving emits nulls; callbacks still work", () => {
    const { sdk, setHit } = lineSdk();
    const { canvas, handlers } = fakeCanvas();
    const legacy: unknown[] = [];
    sdk.enableNodeInteractions(canvas, { onNodeHover: (d) => legacy.push(d?.id ?? null) });
    const hovers: VizHoverEvent[] = [];
    sdk.on('hover', (e) => hovers.push(e));
    const clicks: unknown[] = [];
    sdk.on('click', (e) => clicks.push(e.chart?.index));

    // Engine hit: primary slot 0, 1 item: series 1, sample 2, value 6, global id 5
    setHit([0, 0, 1, 1, 2, 6, 5]);
    handlers.pointermove({ buttons: 0, clientX: 150, clientY: 25 });
    handlers.pointermove({ buttons: 0, clientX: 151, clientY: 25 }); // same target: no event
    expect(hovers.length).toBe(1);
    expect(hovers[0].chart?.items[0]).toMatchObject({ seriesName: 'B', value: 6 });
    expect(hovers[0].node?.id).toBe(5);
    expect([hovers[0].clientX, hovers[0].clientY]).toEqual([150, 25]);
    expect(legacy).toEqual([5]);

    handlers.pointerdown({ button: 0, clientX: 150, clientY: 25 });
    handlers.pointerup({ button: 0, clientX: 150, clientY: 25 });
    expect(clicks).toEqual([2]);

    handlers.pointerleave({ pointerType: 'mouse' });
    expect(hovers.at(-1)).toMatchObject({ chart: null, node: null });
    expect(hovers.length).toBe(2);
  });

  it('dispose drops every listener', () => {
    const { sdk } = lineSdk();
    const themes: string[] = [];
    sdk.on('themechange', (t) => themes.push(t.name));
    sdk.dispose();
    sdk.setTheme(VIZ_THEMES.light);
    expect(themes).toEqual([]);
  });
});

describe('Locale', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Minimal DOM element: enough for the chart overlay ticks and the tooltip */
  class El {
    style: Record<string, string> = {};
    dataset: Record<string, string> = {};
    children: El[] = [];
    parentElement: El | null = null;
    className = '';
    textContent = '';
    innerHTML = '';
    offsetLeft = 0;
    offsetTop = 0;
    offsetWidth = 400;
    offsetHeight = 200;
    handlers: Record<string, (e: unknown) => void> = {};
    appendChild(c: El): El {
      c.parentElement = this;
      this.children.push(c);
      return c;
    }
    append(...cs: El[]): void {
      cs.forEach((c) => this.appendChild(c));
    }
    remove(): void {
      if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    }
    removeChild(c: El): void {
      c.remove();
    }
    setAttribute(): void {}
    addEventListener(type: string, h: (e: unknown) => void): void {
      this.handlers[type] = h;
    }
    removeEventListener(): void {}
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 200, height: 100 };
    }
    querySelectorAll(sel: string): El[] {
      const out: El[] = [];
      const walk = (el: El) =>
        el.children.forEach((c) => {
          if (c.className.split(' ').includes(sel.slice(1))) out.push(c);
          walk(c);
        });
      walk(this);
      return out;
    }
  }

  function setup(lineOptions?: { locale?: string }) {
    const body = new El();
    const container = new El();
    const canvas = container.appendChild(new El());
    vi.stubGlobal('document', { body, createElement: () => new El() });
    let rev = 0;
    const mock = rangeBackend('line');
    // One y tick at 1234.5
    mock.backend.chart_axes_revision = () => ++rev;
    mock.backend.chart_axes = () => new Float64Array([56, 16, 200, 100, 1, 1, 1234.5, 56, 50, 0]);
    const sdk = VizEngineSDK.fromBackend(mock.backend);
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 6.5] }], lineOptions);
    const tick = () => container.querySelectorAll('.viz-sdk-axis-tick')[0]?.textContent;
    const tooltip = () => body.children.find((c) => c.className.includes('viz-sdk-node-tooltip'))!;
    return { sdk, canvas, tick, tooltip, ...mock };
  }

  it('setLocale re-formats default tick labels and tooltip values', () => {
    const { sdk, canvas, tick, tooltip, setHit } = setup();
    sdk.setLocale('en-US');
    expect(tick()).toBe('1,234.5');
    sdk.setLocale('de-DE');
    expect(sdk.getLocale()).toBe('de-DE');
    expect(tick()).toBe('1.234,5');
    setHit([0, 0, 1, 0, 2, 6.5, 2]);
    canvas.handlers.pointermove({ buttons: 0, clientX: 10, clientY: 10 });
    expect(tooltip().innerHTML).toContain('6,5');
  });

  it('the line chart locale option overrides the SDK locale', () => {
    const { sdk, tick } = setup({ locale: 'en-US' });
    sdk.setLocale('de-DE');
    expect(tick()).toBe('1,234.5');
  });
});

describe('Auto-resize', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sizes the canvas from device-pixel boxes, falls back to CSS x DPR, and disconnects', () => {
    let cb: (entries: unknown[]) => void = () => {};
    const observed: unknown[] = [];
    let disconnected = false;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(f: (entries: unknown[]) => void) {
          cb = f;
        }
        observe(_el: unknown, opts: unknown) {
          observed.push(opts);
        }
        disconnect() {
          disconnected = true;
        }
      }
    );
    const media: { listeners: (() => void)[]; removed: number } = { listeners: [], removed: 0 };
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    vi.stubGlobal('matchMedia', () => ({
      addEventListener: (_t: string, f: () => void) => media.listeners.push(f),
      removeEventListener: () => media.removed++,
    }));
    const canvas = { width: 300, height: 150, clientWidth: 0, clientHeight: 0 } as HTMLCanvasElement;
    const sizes: number[][] = [];
    const stop = observeCanvasPixelSize(canvas, (w, h) => sizes.push([w, h]));
    expect(observed).toEqual([{ box: 'device-pixel-content-box' }]);

    cb([{ contentBoxSize: [{ inlineSize: 400, blockSize: 200 }], devicePixelContentBoxSize: [{ inlineSize: 801, blockSize: 399 }] }]);
    expect([canvas.width, canvas.height]).toEqual([801, 399]);
    cb([{ contentBoxSize: [{ inlineSize: 400, blockSize: 200 }], devicePixelContentBoxSize: [{ inlineSize: 801, blockSize: 399 }] }]);
    expect(sizes).toEqual([[801, 399]]); // idempotent: same size, no callback

    // No device-pixel box (Safari): CSS box x DPR; a DPR change re-applies it
    cb([{ contentBoxSize: [{ inlineSize: 100, blockSize: 50 }] }]);
    expect(sizes.at(-1)).toEqual([200, 100]);
    vi.stubGlobal('window', { devicePixelRatio: 3 });
    media.listeners.at(-1)!();
    expect(sizes.at(-1)).toEqual([300, 150]);

    // Huge boxes are capped at 8192 px per side, aspect kept
    cb([{ contentBoxSize: [{ inlineSize: 6000, blockSize: 3000 }], devicePixelContentBoxSize: [{ inlineSize: 12000, blockSize: 6000 }] }]);
    expect(sizes.at(-1)).toEqual([8192, 4096]);

    stop();
    expect(disconnected).toBe(true);
    expect(media.removed).toBeGreaterThan(0);
  });
});

describe('Auto-resize feedback', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a canvas without CSS size gets its CSS box pinned instead of growing forever', () => {
    let cb: (entries: unknown[]) => void = () => {};
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(f: (entries: unknown[]) => void) {
          cb = f;
        }
        observe() {}
        disconnect() {}
      }
    );
    vi.stubGlobal('window', { devicePixelRatio: 2 });
    const canvas = { width: 800, height: 600, clientWidth: 800, clientHeight: 600, style: {} } as unknown as HTMLCanvasElement;
    const sizes: number[][] = [];
    observeCanvasPixelSize(canvas, (w, h) => sizes.push([w, h]));
    const box = (w: number, h: number) => cb([{ contentBoxSize: [{ inlineSize: w, blockSize: h }] }]);
    box(800, 600);
    expect(sizes).toEqual([[1600, 1200]]);
    // The CSS box followed the new attributes: pin it, do not double again
    box(1600, 1200);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    box(800, 600);
    expect(sizes).toEqual([[1600, 1200]]);
  });
});

describe('Init helpers', () => {
  it('classifies engine start-up failures', () => {
    expect(classifyInitError('Failed to request device: OutOfMemory').reason).toBe('device');
    expect(classifyInitError(new Error('No suitable GPU adapter found')).reason).toBe('adapter');
    expect(classifyInitError('Failed to create wgpu surface: X').reason).toBe('no-webgpu');
    const e = new VizInitError('wasm', 'x');
    expect(classifyInitError(e)).toBe(e);
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('VizInitError');
  });

  it('isSupported is false without WebGPU / WebGL2 (node)', async () => {
    expect(await isRenderingSupported()).toBe(false);
    expect(await VizEngineSDK.isSupported()).toBe(false);
  });

  it('isSupported checks the WebGPU adapter', async () => {
    vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => ({}) } });
    try {
      expect(await VizEngineSDK.isSupported()).toBe(true);
      vi.stubGlobal('navigator', { gpu: { requestAdapter: async () => null } });
      expect(await VizEngineSDK.isSupported()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
