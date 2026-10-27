// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_BOX_PX,
  WHEEL_BURST_MS,
  ZOOM_HISTORY_MAX,
  createZoomController,
  readHistory,
  validateZoomAxis,
  validateZoomMode,
  wheelAxes,
  wheelDelta,
  zoomShortcut,
  type ZoomBackend,
  type ZoomControllerHost,
} from '../sdk/chart-zoom';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import type { CharturboRange } from '../sdk/chart-events';

vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    showDataTable(): void {}
    hideDataTable(): void {}
    getDataTable(): null {
      return null;
    }
    exportCSV(): string {
      return '';
    }
    summary(): string {
      return '';
    }
  },
}));

type Calls = Record<string, unknown[][]>;

function recorder(calls: Calls) {
  return (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
}

/** Zoom backend with a Rust-like history: push / undo / redo over a numeric "zoom level". */
function historyBackend(calls: Calls) {
  const rec = recorder(calls);
  let level = 0;
  const undo: number[] = [];
  const redo: number[] = [];
  const backend: ZoomBackend & { level(): number } = {
    level: () => level,
    chart_zoom_x: (...a) => {
      rec('chart_zoom_x')(...a);
      level++;
    },
    chart_zoom_y: (...a) => {
      rec('chart_zoom_y')(...a);
      level++;
      return true;
    },
    chart_zoom_box: (...a) => {
      rec('chart_zoom_box')(...a);
      level += 10;
      return true;
    },
    chart_brush: (...a) => {
      rec('chart_brush')(...a);
      return true;
    },
    chart_clear_selection: rec('chart_clear_selection'),
    chart_clear_hover: rec('chart_clear_hover'),
    chart_zoom_history_push: () => {
      rec('chart_zoom_history_push')();
      if (undo.at(-1) !== level) undo.push(level);
      if (undo.length > ZOOM_HISTORY_MAX) undo.shift();
      redo.length = 0;
    },
    chart_zoom_undo: () => {
      while (undo.length) {
        const s = undo.pop()!;
        if (s !== level) {
          redo.push(level);
          level = s;
          return true;
        }
      }
      return false;
    },
    chart_zoom_redo: () => {
      const s = redo.pop();
      if (s === undefined) return false;
      undo.push(level);
      level = s;
      return true;
    },
    chart_zoom_history: () => new Uint32Array([undo.length, redo.length]),
    chart_zoom_history_trim: () => {
      rec('chart_zoom_history_trim')();
      while (undo.at(-1) === level) undo.pop();
    },
    chart_zoom_history_clear: () => {
      undo.length = 0;
      redo.length = 0;
    },
  };
  return backend;
}

function controller(backend: ZoomBackend, over: Partial<ZoomControllerHost> = {}) {
  let t = 0;
  const host: ZoomControllerHost = {
    backend,
    axis: 'x',
    mode: 'pan',
    navigating: () => true,
    boxable: () => true,
    yZoomable: () => true,
    toNdc: (e) => [e.clientX / 100 - 1, 1 - e.clientY / 100],
    changeRange: (f) => f(),
    changed: () => {},
    clock: () => t,
    ...over,
  };
  return { zoom: createZoomController(host), tick: (ms: number) => (t += ms) };
}

describe('zoom option helpers', () => {
  it('validates options and maps wheel / keys', () => {
    expect(validateZoomAxis(undefined)).toBe('x');
    expect(validateZoomAxis('xy')).toBe('xy');
    expect(() => validateZoomAxis('z')).toThrow(/zoom/);
    expect(validateZoomMode(undefined)).toBe('pan');
    expect(() => validateZoomMode('lasso')).toThrow(/zoomMode/);
    expect(wheelAxes('x', {})).toEqual({ x: true, y: false });
    expect(wheelAxes('xy', {})).toEqual({ x: true, y: true });
    expect(wheelAxes('x', { shiftKey: true })).toEqual({ x: false, y: true });
    expect(wheelDelta({ deltaY: 0, deltaX: 30 })).toBe(30); // Shift + wheel turned sideways
    expect(zoomShortcut({ key: 'z', ctrlKey: true })).toBe('undo');
    expect(zoomShortcut({ key: 'Z', metaKey: true, shiftKey: true })).toBe('redo');
    expect(zoomShortcut({ key: 'y', ctrlKey: true })).toBe('redo');
    expect(zoomShortcut({ key: 'z' })).toBeNull();
    expect(zoomShortcut({ key: 'z', ctrlKey: true, altKey: true })).toBeNull();
    expect(readHistory({})).toEqual({ undo: 0, redo: 0, max: 50 });
  });
});

describe('zoom controller', () => {
  it("Shift + wheel zooms y; 'xy' zooms both; one history step per wheel burst", () => {
    const calls: Calls = {};
    const b = historyBackend(calls);
    const { zoom, tick } = controller(b);
    // Plain wheel on the default x axis stays with the caller
    expect(zoom.wheel({ deltaY: 100, clientX: 100, clientY: 50 })).toBe(false);
    expect(zoom.wheel({ deltaY: 0, deltaX: -100, shiftKey: true, clientX: 100, clientY: 50 })).toBe(true);
    const [factor, ny] = calls.chart_zoom_y[0] as [number, number];
    expect(factor).toBeCloseTo(Math.exp(-0.15));
    expect(ny).toBeCloseTo(0.5);
    tick(50);
    zoom.wheel({ deltaY: -100, shiftKey: true, clientX: 100, clientY: 50 });
    expect(calls.chart_zoom_history_push.length).toBe(1); // same burst
    tick(WHEEL_BURST_MS + 1);
    zoom.wheel({ deltaY: -100, shiftKey: true, clientX: 100, clientY: 50 });
    expect(calls.chart_zoom_history_push.length).toBe(2);

    const xy = controller(historyBackend(calls), { axis: 'xy' }).zoom;
    xy.wheel({ deltaY: 100, clientX: 150, clientY: 50 });
    expect(calls.chart_zoom_x.at(-1)?.[1]).toBeCloseTo(0.5);
    // Charts without a y zoom (candles) keep the wheel on the caller's x path
    const noY = controller(historyBackend(calls), { yZoomable: () => false }).zoom;
    expect(noY.wheel({ deltaY: 1, shiftKey: true, clientX: 0, clientY: 0 })).toBe(false);
    // Not navigating: nothing
    const off = controller(historyBackend(calls), { navigating: () => false }).zoom;
    expect(off.wheel({ deltaY: 1, shiftKey: true, clientX: 0, clientY: 0 })).toBe(false);
  });

  it('Ctrl / Cmd + drag draws the box with the brush layer and zooms to it on release', () => {
    const calls: Calls = {};
    const b = historyBackend(calls);
    const { zoom } = controller(b);
    expect(zoom.pointerDown({ button: 0, clientX: 20, clientY: 20 })).toBe(false); // plain drag pans
    expect(zoom.pointerDown({ button: 0, clientX: 20, clientY: 20, ctrlKey: true })).toBe(true);
    expect(zoom.boxing()).toBe(true);
    expect(zoom.pointerMove({ clientX: 21, clientY: 21 })).toBe(true); // below the threshold: nothing drawn
    expect(calls.chart_brush).toBeUndefined();
    zoom.pointerMove({ clientX: 120, clientY: 80 });
    const r2 = (a: unknown[] | undefined) => (a as number[]).map((v) => Math.round(v * 100) / 100);
    expect(r2(calls.chart_brush.at(-1))).toEqual([1, -0.8, 0.8, 0.2, 0.2]);
    expect(zoom.pointerUp({ clientX: 120, clientY: 80 })).toBe(true);
    expect(calls.chart_zoom_history_push.length).toBe(1);
    expect(r2(calls.chart_zoom_box[0])).toEqual([-0.8, 0.8, 0.2, 0.2]);
    expect(b.level()).toBe(10);
    // A box that does not move the view leaves no undo step
    b.chart_zoom_box = (...a: unknown[]) => {
      (calls.chart_zoom_box ??= []).push(a);
      return false;
    };
    zoom.pointerDown({ button: 0, clientX: 20, clientY: 20, ctrlKey: true });
    zoom.pointerMove({ clientX: 120, clientY: 80 });
    zoom.pointerUp({ clientX: 120, clientY: 80 });
    expect(calls.chart_zoom_history_trim.length).toBe(1);
    expect(readHistory(b).undo).toBe(1);
    calls.chart_zoom_box.pop();
    // A click-sized box is not a zoom
    zoom.pointerDown({ button: 0, clientX: 20, clientY: 20, metaKey: true });
    expect(zoom.pointerUp({ clientX: 20 + MIN_BOX_PX - 1, clientY: 20 })).toBe('click');
    expect(calls.chart_zoom_box.length).toBe(1);
    // Escape cancels a live box
    zoom.pointerDown({ button: 0, clientX: 20, clientY: 20, ctrlKey: true });
    zoom.pointerMove({ clientX: 80, clientY: 80 });
    expect(zoom.cancel()).toBe(true);
    expect(zoom.boxing()).toBe(false);
    expect(calls.chart_clear_selection.length).toBeGreaterThan(0);
    expect(zoom.pointerUp({ clientX: 80, clientY: 80 })).toBe(false);
  });

  it("zoomMode 'box': plain drag boxes, Alt + drag pans", () => {
    const calls: Calls = {};
    const { zoom } = controller(historyBackend(calls), { mode: 'box' });
    expect(zoom.pointerDown({ button: 0, clientX: 0, clientY: 0, altKey: true })).toBe(false);
    expect(zoom.pointerDown({ button: 2, clientX: 0, clientY: 0 })).toBe(false);
    expect(zoom.pointerDown({ button: 0, clientX: 0, clientY: 0 })).toBe(true);
    zoom.pointerMove({ clientX: 50, clientY: 50 });
    zoom.pointerUp({ clientX: 50, clientY: 50 });
    expect(calls.chart_zoom_box.length).toBe(1);
    // Charts without a data frame never start one
    const nobox = controller(historyBackend(calls), { mode: 'box', boxable: () => false }).zoom;
    expect(nobox.pointerDown({ button: 0, clientX: 0, clientY: 0 })).toBe(false);
  });

  it('keyboard undo / redo walk the history', () => {
    const calls: Calls = {};
    const b = historyBackend(calls);
    const { zoom } = controller(b);
    zoom.panStart();
    b.chart_zoom_x!(0.5, 0); // level 1
    zoom.panStart();
    b.chart_zoom_x!(0.5, 0); // level 2
    const prevent = vi.fn();
    expect(zoom.keyDown({ key: 'z', ctrlKey: true, preventDefault: prevent })).toBe(true);
    expect(prevent).toHaveBeenCalled();
    expect(b.level()).toBe(1);
    zoom.keyDown({ key: 'z', metaKey: true });
    expect(b.level()).toBe(0);
    expect(readHistory(b)).toEqual({ undo: 0, redo: 2, max: 50 });
    zoom.keyDown({ key: 'y', ctrlKey: true });
    zoom.keyDown({ key: 'z', ctrlKey: true, shiftKey: true });
    expect(b.level()).toBe(2);
    expect(zoom.keyDown({ key: 'a', ctrlKey: true })).toBe(false);
  });
});

/** Line chart backend for the SDK binding (jsdom canvas). */
function lineBackend(calls: Calls) {
  const rec = recorder(calls);
  const hist = historyBackend(calls);
  let range = [0, 100, 0, 10];
  return {
    setRange: (r: number[]) => (range = r),
    backend: {
      ...hist,
      set_line_chart: rec('set_line_chart', 3),
      sync_and_render: rec('sync_and_render'),
      chart_range: () => new Float64Array(range),
      chart_reset_zoom: rec('chart_reset_zoom'),
      clear_scene_objects: () => {},
      set_rigid_physics: () => {},
      set_graph_visible: () => {},
      set_scene_helpers: () => {},
      clear_selection: () => {},
      pick_node_at_ndc: () => -1,
      chart_hover_at_ndc: () => new Float64Array(0),
    } as unknown as WasmCharturboEngineBackend,
  };
}

describe('SDK zoom binding', () => {
  let canvas: HTMLCanvasElement;
  beforeEach(() => {
    canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
  });
  afterEach(() => {
    canvas.remove();
    vi.unstubAllGlobals();
  });

  const pointer = (type: string, init: MouseEventInit) => {
    const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(e, 'pointerId', { value: 1 });
    Object.defineProperty(e, 'pointerType', { value: 'mouse' });
    return e;
  };

  it("wheel ('y' option / Shift), Ctrl + drag box, Ctrl + Z, double-click reset clear history", () => {
    const calls: Calls = {};
    const { backend } = lineBackend(calls);
    const sdk = Charturbo.fromBackend(backend);
    sdk.enableNodeInteractions(canvas, { zoom: 'y', builtInTooltip: false });
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, clientX: 100, clientY: 25, cancelable: true }));
    expect(calls.chart_zoom_y?.length).toBe(1);
    expect(calls.chart_zoom_x).toBeUndefined();
    expect(calls.chart_zoom_y[0][1]).toBeCloseTo(0.5);
    expect(sdk.zoomHistory).toEqual({ undo: 1, redo: 0, max: 50 });

    canvas.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 20, clientY: 20, ctrlKey: true }));
    canvas.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 150, clientY: 80, ctrlKey: true }));
    expect(calls.chart_brush?.at(-1)?.[0]).toBe(1);
    canvas.dispatchEvent(pointer('pointerup', { button: 0, clientX: 150, clientY: 80 }));
    expect(calls.chart_zoom_box?.length).toBe(1);
    expect(sdk.zoomHistory.undo).toBe(2);

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true }));
    expect(sdk.zoomHistory).toEqual({ undo: 1, redo: 1, max: 50 });
    expect(sdk.redoZoom()).toBe(true);
    expect(sdk.undoZoom()).toBe(true);

    canvas.dispatchEvent(new MouseEvent('dblclick', { clientX: 50, clientY: 50 }));
    expect(calls.chart_reset_zoom?.length).toBe(1);
    expect(sdk.zoomHistory).toEqual({ undo: 0, redo: 0, max: 50 });
  });

  it("programmatic y / box zoom and 'rangechange' with y", async () => {
    const calls: Calls = {};
    const { backend, setRange } = lineBackend(calls);
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    const ranges: CharturboRange[] = [];
    sdk.on('rangechange', (r) => ranges.push(r));
    expect(sdk.zoomChartY(0.5, 0.25)).toBe(true);
    setRange([0, 100, 2, 6]);
    await new Promise((r) => setTimeout(r, 30));
    expect(ranges.at(-1)).toEqual({ xMin: 0, xMax: 100, yMin: 2, yMax: 6 });
    expect(sdk.getYRange()).toEqual([2, 6]);
    expect(sdk.zoomChartBox(-0.5, 0.5, 0.5, -0.5)).toBe(true);
    expect(calls.chart_zoom_box[0]).toEqual([-0.5, 0.5, 0.5, -0.5]);
    expect(sdk.zoomHistory.undo).toBe(1);
    sdk.clearZoomHistory();
    expect(sdk.zoomHistory.undo).toBe(0);
  });
});
