import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NAV_LEFT_HANDLE,
  NAV_NONE,
  NAV_OUTSIDE,
  NAV_RIGHT_HANDLE,
  NAV_WINDOW,
  createNavigatorController,
  navigatorCursor,
  resolveNavigator,
  type NavigatorHooks,
} from '../sdk/chart-navigator';
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

import { Charturbo, type CharturboRange, type WasmCharturboEngineBackend } from '../sdk/charturbo';

/**
 * Engine stand-in: a 200 x 100 canvas whose bottom fifth (NDC y < -0.6) is the strip across the
 * full width; window `[w0, w1]` of a 0..100 x range; handles grab +-0.05 NDC around the edges.
 */
function navBackend() {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let w = [0, 1];
  let enabled = false;
  const t = (ndcX: number) => Math.min(1, Math.max(0, (ndcX + 1) / 2));
  const setWindow = (a: number, b: number) => {
    const span = b - a;
    const start = Math.min(Math.max(a, 0), 1 - span);
    w = [start, start + span];
  };
  const backend: WasmCharturboEngineBackend = {
    set_line_chart: record('set_line_chart', 0),
    set_bar_chart: record('set_bar_chart', 0),
    chart_series_count: () => 1,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: record('set_clear_color'),
    set_node_hover_style: record('set_node_hover_style'),
    set_chart_navigator: (on: boolean, h: number, style: Float32Array) => {
      record('set_chart_navigator')(on, h, style);
      enabled = on;
    },
    chart_navigator_rect: () => (enabled ? new Float32Array([0, 80, 200, 20]) : new Float32Array(0)),
    chart_navigator_hit: (x: number, y: number) => {
      record('chart_navigator_hit')(x, y);
      if (!enabled || y > -0.6) return NAV_NONE;
      const [a, b] = [w[0] * 2 - 1, w[1] * 2 - 1];
      if (Math.abs(x - a) <= 0.05) return NAV_LEFT_HANDLE;
      if (Math.abs(x - b) <= 0.05) return NAV_RIGHT_HANDLE;
      return x > a && x < b ? NAV_WINDOW : NAV_OUTSIDE;
    },
    chart_navigator_drag: (code: number, dx: number) => {
      record('chart_navigator_drag')(code, dx);
      const dt = dx / 2;
      if (code === NAV_WINDOW || code === NAV_OUTSIDE) setWindow(w[0] + dt, w[1] + dt);
      else if (code === NAV_LEFT_HANDLE) w = [Math.min(Math.max(0, w[0] + dt), w[1] - 0.01), w[1]];
      else if (code === NAV_RIGHT_HANDLE) w = [w[0], Math.max(Math.min(1, w[1] + dt), w[0] + 0.01)];
      return true;
    },
    chart_navigator_center: (x: number) => {
      record('chart_navigator_center')(x);
      const half = (w[1] - w[0]) / 2;
      setWindow(t(x) - half, t(x) + half);
      return true;
    },
    chart_navigator_zoom: (f: number, x: number) => {
      record('chart_navigator_zoom')(f, x);
      const a = Math.min(Math.max(t(x), w[0]), w[1]);
      setWindow(a - (a - w[0]) * f, a + (w[1] - a) * f);
      return true;
    },
    chart_zoom_x: record('chart_zoom_x'),
    chart_pan_x: record('chart_pan_x'),
    chart_reset_zoom: () => (w = [0, 1]),
    chart_range: () => new Float64Array([w[0] * 100, w[1] * 100, NaN, NaN]),
    chart_set_x_range: (lo: number, hi: number) => {
      w = [lo / 100, hi / 100];
      return true;
    },
    chart_hover_at_ndc: record('chart_hover_at_ndc', new Float64Array(0)),
    chart_clear_hover: record('chart_clear_hover'),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([56, 16, 200, 60, 0]),
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
  return { backend, calls, window: () => w, setWindow: (a: number, b: number) => (w = [a, b]) };
}

function fakeCanvas() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const captured: number[] = [];
  const canvas = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h),
    removeEventListener: (type: string) => delete handlers[type],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    setPointerCapture: (id: number) => captured.push(id),
  } as unknown as HTMLCanvasElement;
  return { canvas, handlers, captured };
}

/** Pointer event at canvas px (`y` 90 = on the strip). */
const ptr = (x: number, y: number, extra: Record<string, unknown> = {}) => ({
  pointerId: 1,
  pointerType: 'mouse',
  button: 0,
  buttons: 0,
  clientX: x,
  clientY: y,
  timeStamp: 0,
  shiftKey: false,
  preventDefault: () => {},
  ...extra,
});

function navSdk(navigator: boolean | { height?: number } = true) {
  const mock = navBackend();
  const sdk = Charturbo.fromBackend(mock.backend);
  sdk.renderLineChart([{ name: 'A', values: [1, 2, 3, 4] }], { navigator });
  const c = fakeCanvas();
  sdk.enableNodeInteractions(c.canvas, { builtInTooltip: false });
  return { sdk, ...mock, ...c };
}

describe('chart-navigator helpers', () => {
  it('resolves the option and maps regions to cursors', () => {
    expect(resolveNavigator(undefined)).toBeNull();
    expect(resolveNavigator(false)).toBeNull();
    expect(resolveNavigator(true)).toEqual({ height: 48 });
    expect(resolveNavigator({ height: 64 })).toEqual({ height: 64 });
    expect(resolveNavigator({ height: NaN })).toEqual({ height: 48 });
    expect(navigatorCursor(NAV_LEFT_HANDLE)).toBe('ew-resize');
    expect(navigatorCursor(NAV_RIGHT_HANDLE, true)).toBe('ew-resize');
    expect(navigatorCursor(NAV_WINDOW)).toBe('grab');
    expect(navigatorCursor(NAV_WINDOW, true)).toBe('grabbing');
    expect(navigatorCursor(NAV_OUTSIDE)).toBe('pointer');
    expect(navigatorCursor(NAV_NONE)).toBe('');
  });

  it('controller: grab, drag deltas in NDC, release; ignores other pointers and buttons', () => {
    const log: unknown[] = [];
    let code = NAV_RIGHT_HANDLE;
    const hooks: NavigatorHooks = {
      active: () => true,
      toNdc: (p) => [p.clientX / 100 - 1, 1 - p.clientY / 50],
      canvasWidth: () => 200,
      hit: () => code,
      drag: (c, dx) => log.push(['drag', c, dx]),
      center: (x) => log.push(['center', x]),
      zoom: (f, x) => log.push(['zoom', f, x]),
      setCursor: (c) => log.push(['cursor', c]),
      restoreCursor: () => log.push(['restore']),
      changed: () => {},
    };
    const nav = createNavigatorController(hooks);
    expect(nav.pointerDown({ pointerId: 1, clientX: 100, clientY: 90, button: 2 })).toBe(false);
    expect(nav.pointerDown({ pointerId: 1, clientX: 100, clientY: 90, button: 0 })).toBe(true);
    expect(nav.dragging()).toBe(true);
    expect(nav.pointerMove({ pointerId: 2, clientX: 150, clientY: 90 })).toBe(false);
    nav.pointerMove({ pointerId: 1, clientX: 120, clientY: 10 });
    expect(log).toContainEqual(['drag', NAV_RIGHT_HANDLE, 0.2]);
    expect(nav.pointerUp({ pointerId: 2, clientX: 0, clientY: 0 })).toBe(false);
    expect(nav.pointerUp({ pointerId: 1, clientX: 120, clientY: 10 })).toBe(true);
    expect(nav.dragging()).toBe(false);

    // Outside: centers first, then drags the window
    code = NAV_OUTSIDE;
    log.length = 0;
    nav.pointerDown({ pointerId: 3, clientX: 40, clientY: 90 });
    nav.pointerMove({ pointerId: 3, clientX: 30, clientY: 90 });
    expect(log).toEqual([
      ['center', -0.6],
      ['cursor', 'grabbing'],
      ['drag', NAV_WINDOW, -0.1],
    ]);
    nav.pointerUp({ pointerId: 3, clientX: 30, clientY: 90 });

    // Hover leaving the strip restores the default cursor once
    code = NAV_NONE;
    log.length = 0;
    nav.pointerMove({ pointerId: 1, clientX: 30, clientY: 20 });
    nav.pointerMove({ pointerId: 1, clientX: 31, clientY: 20 });
    expect(log).toEqual([['restore']]);
    expect(nav.pointerDown({ pointerId: 1, clientX: 30, clientY: 20 })).toBe(false);
    expect(nav.wheel({ clientX: 30, clientY: 20, deltaY: 100 })).toBe(false);
  });
});

describe('SDK navigator wiring', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('renderLineChart sends the option (height, theme colors); off by default and for 2.5D', () => {
    const { calls } = navSdk({ height: 64 });
    const [on, h, style] = calls.set_chart_navigator[0] as [boolean, number, Float32Array];
    expect(on).toBe(true);
    expect(h).toBe(64);
    expect(style.length).toBe(20);
    expect(Number.isNaN(style[0])).toBe(true); // background: engine default
    expect(style[7]).toBeCloseTo(0.6); // mask alpha over the surface color

    const plain = navBackend();
    const sdk = Charturbo.fromBackend(plain.backend);
    sdk.renderLineChart([{ name: 'A', values: [1, 2] }]);
    sdk.renderLineChart([{ name: 'A', values: [1, 2] }], { viewMode: '2.5d', navigator: true });
    expect(plain.calls.set_chart_navigator).toBeUndefined();
    expect(sdk.getNavigatorRect()).toBeNull();
  });

  it('getNavigatorRect and theme changes re-send the strip colors', () => {
    const { sdk, calls } = navSdk();
    expect(sdk.getNavigatorRect()).toEqual([0, 80, 200, 20]);
    sdk.setTheme('light');
    expect(calls.set_chart_navigator.length).toBe(2);
  });

  it('dragging the window moves it instead of panning and emits rangechange', () => {
    const { sdk, calls, handlers, captured, setWindow, window } = navSdk();
    setWindow(0.25, 0.5);
    const ranges: CharturboRange[] = [];
    sdk.on('rangechange', (r) => ranges.push(r));
    // Window spans canvas x 50..100; grab its middle on the strip
    handlers.pointerdown(ptr(75, 90));
    expect(captured).toEqual([1]);
    handlers.pointermove(ptr(95, 90, { buttons: 1 }));
    expect(calls.chart_pan_x).toBeUndefined();
    expect(calls.chart_navigator_drag.at(-1)).toEqual([NAV_WINDOW, 0.2]);
    expect(window()[0]).toBeCloseTo(0.35);
    handlers.pointerup(ptr(95, 90));
    vi.advanceTimersByTime(20);
    expect(ranges.length).toBe(1);
    expect(ranges[0].xMin).toBeCloseTo(35);

    // Same drag on the plot pans as before
    handlers.pointerdown(ptr(75, 30));
    handlers.pointermove(ptr(95, 30, { buttons: 1 }));
    expect(calls.chart_pan_x.length).toBe(1);
    handlers.pointerup(ptr(95, 30));
  });

  it('handles resize; a press outside centers the window; no click fires', () => {
    const { sdk, calls, handlers, window, setWindow } = navSdk();
    setWindow(0.25, 0.5);
    const clicks: unknown[] = [];
    sdk.on('click', (e) => clicks.push(e));
    handlers.pointerdown(ptr(100, 90)); // right edge
    handlers.pointermove(ptr(120, 90, { buttons: 1 }));
    expect(calls.chart_navigator_drag.at(-1)).toEqual([NAV_RIGHT_HANDLE, 0.2]);
    expect(window()[1]).toBeCloseTo(0.6);
    handlers.pointerup(ptr(120, 90));

    handlers.pointerdown(ptr(160, 90)); // outside, right of the window
    expect(calls.chart_navigator_center.at(-1)?.[0]).toBeCloseTo(0.6);
    expect(window()[0] + window()[1]).toBeCloseTo(1.6); // centered on t = 0.8
    handlers.pointerup(ptr(160, 90));
    expect(clicks).toEqual([]);
  });

  it('cursor follows the strip region; leaving restores it', () => {
    const { canvas, handlers, setWindow } = navSdk();
    setWindow(0.25, 0.5);
    handlers.pointermove(ptr(50, 90));
    expect(canvas.style.cursor).toBe('ew-resize');
    handlers.pointermove(ptr(75, 90));
    expect(canvas.style.cursor).toBe('grab');
    handlers.pointermove(ptr(170, 90));
    expect(canvas.style.cursor).toBe('pointer');
    handlers.pointermove(ptr(170, 20));
    expect(canvas.style.cursor).toBe('grab');
  });

  it('wheel over the strip zooms around the strip pointer; over the plot uses x zoom', () => {
    const { calls, handlers, window, setWindow } = navSdk();
    setWindow(0.25, 0.75);
    let prevented = 0;
    handlers.wheel(ptr(100, 90, { deltaY: -200, preventDefault: () => prevented++ }));
    expect(prevented).toBe(1);
    expect(calls.chart_navigator_zoom.length).toBe(1);
    expect(calls.chart_zoom_x).toBeUndefined();
    expect(window()[1] - window()[0]).toBeLessThan(0.5);
    handlers.wheel(ptr(100, 30, { deltaY: -200 }));
    expect(calls.chart_zoom_x.length).toBe(1);
  });

  it('touch drags on the strip bypass the gesture layer', () => {
    const { calls, handlers, setWindow, window } = navSdk();
    setWindow(0.25, 0.5);
    handlers.pointerdown(ptr(75, 90, { pointerType: 'touch', pointerId: 7 }));
    handlers.pointermove(ptr(65, 90, { pointerType: 'touch', pointerId: 7, buttons: 1 }));
    expect(calls.chart_navigator_drag.at(-1)).toEqual([NAV_WINDOW, -0.1]);
    expect(window()[0]).toBeCloseTo(0.2);
    handlers.pointerup(ptr(65, 90, { pointerType: 'touch', pointerId: 7 }));
    expect(calls.chart_pan_x).toBeUndefined();
  });

  it('double-click on the strip keeps the zoom; a lost release ends the drag', () => {
    const { handlers, setWindow, window, calls } = navSdk();
    setWindow(0.25, 0.5);
    handlers.dblclick(ptr(170, 90));
    expect(window()).toEqual([0.25, 0.5]);
    handlers.dblclick(ptr(170, 20));
    expect(window()).toEqual([0, 1]);

    setWindow(0.25, 0.5);
    handlers.pointerdown(ptr(75, 90));
    handlers.pointermove(ptr(85, 90, { buttons: 1 }));
    const drags = calls.chart_navigator_drag.length;
    // Button already up (release outside the window): hover, no more dragging
    handlers.pointermove(ptr(95, 90, { buttons: 0 }));
    expect(calls.chart_navigator_drag.length).toBe(drags);
    handlers.pointerdown(ptr(75, 90));
    handlers.lostpointercapture(ptr(75, 90));
    handlers.pointermove(ptr(95, 90, { buttons: 1 }));
    expect(calls.chart_navigator_drag.length).toBe(drags);
  });

  it('a chart without navigator never hit-tests one', () => {
    const { calls, handlers } = navSdk(false);
    handlers.pointerdown(ptr(75, 90));
    handlers.pointermove(ptr(95, 90, { buttons: 1 }));
    expect(calls.chart_navigator_hit).toBeUndefined();
    expect(calls.chart_pan_x.length).toBe(1);
  });
});
