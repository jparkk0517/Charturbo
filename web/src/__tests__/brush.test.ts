import { describe, expect, it, vi } from 'vitest';
import { brushModeCode, decodeSelection, emptySelection, encodeBrushStyle } from '../sdk/chart-brush';
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

import { Charturbo, type CharturboSelection, type WasmCharturboEngineBackend } from '../sdk/charturbo';

/** Engine selection encoding: `[kind, mode, x0, x1, y0, y1, count, n, (series, start, end) * n]`. */
const LINE_SEL = [0, 0, 10, 20, NaN, NaN, 15, 2, 0, 10, 21, 1, 5, 9];
const SCATTER_SEL = [2, 1, 1, 2, -3, 4, 3, 0];

/** Mock engine: records calls; the brush / selection methods keep a selection like the engine. */
function brushBackend(kind: 'line' | 'scatter' = 'line') {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let selection = new Float64Array(0);
  let live = false;
  const committed = new Float64Array(kind === 'line' ? LINE_SEL : SCATTER_SEL);
  const backend: WasmCharturboEngineBackend = {
    set_line_chart: record('set_line_chart', 0),
    set_scatter_chart: record('set_scatter_chart', 0),
    chart_series_count: () => 2,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_clear_color: record('set_clear_color'),
    set_node_hover_style: record('set_node_hover_style'),
    chart_pan_x: record('chart_pan_x'),
    chart_pan_xy: record('chart_pan_xy'),
    chart_zoom_x: record('chart_zoom_x'),
    chart_clear_hover: record('chart_clear_hover'),
    chart_hover_at_ndc: () => new Float64Array(0),
    chart_range: () => new Float64Array([0, 100, NaN, NaN]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([56, 16, 200, 100, 0]),
    chart_brush: (...args: number[]) => {
      record('chart_brush')(...args);
      live = true;
      selection = new Float64Array(0); // a new drag drops the old selection
      return true;
    },
    chart_brush_end: () => {
      record('chart_brush_end')();
      if (!live) return new Float64Array(0);
      live = false;
      return (selection = committed);
    },
    chart_select_range: (...args: number[]) => {
      record('chart_select_range')(...args);
      return (selection = committed);
    },
    chart_selection: () => selection,
    chart_selection_ids: () => {
      record('chart_selection_ids')();
      return new Uint32Array([4, 8, 15]);
    },
    chart_clear_selection: () => {
      record('chart_clear_selection')();
      selection = new Float64Array(0);
      live = false;
    },
    set_chart_brush_style: record('set_chart_brush_style'),
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
    resize: () => {},
    pick_node_at_ndc: () => -1,
    select_box_ndc: () => new Uint32Array(0),
    query_radius: () => new Uint32Array(0),
    select_node_and_neighbors: () => new Uint32Array(0),
    select_cluster: () => new Uint32Array(0),
    clear_selection: record('clear_selection'),
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
  return { backend, calls };
}

function chartSdk(kind: 'line' | 'scatter' = 'line') {
  const mock = brushBackend(kind);
  const sdk = Charturbo.fromBackend(mock.backend);
  if (kind === 'line') {
    sdk.renderLineChart([
      { name: 'A', values: [1, 2, 3] },
      { name: 'B', values: [4, 5, 6] },
    ]);
  } else {
    sdk.renderScatterChart({ x: [0, 1, 2], y: [0, 1, 2] });
  }
  const selects: CharturboSelection[] = [];
  sdk.on('select', (s) => selects.push(s));
  return { sdk, selects, ...mock };
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

const mouse = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({
  pointerType: 'mouse',
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...extra,
});

describe('chart-brush encoding', () => {
  it('decodes line runs, scatter ids and y ranges', () => {
    expect(decodeSelection(new Float64Array(0), undefined)).toBeNull();
    expect(decodeSelection(undefined, undefined)).toBeNull();
    const line = decodeSelection(new Float64Array(LINE_SEL), undefined)!;
    expect(line).toMatchObject({ kind: 'line', mode: 'x', xRange: [10, 20], yRange: null, count: 15 });
    expect(line.ranges).toEqual([
      { series: 0, start: 10, end: 21 },
      { series: 1, start: 5, end: 9 },
    ]);
    expect(line.ids.length).toBe(0);
    const ids = new Uint32Array([1, 2, 3]);
    const scatter = decodeSelection(new Float64Array(SCATTER_SEL), ids)!;
    expect(scatter).toMatchObject({ kind: 'scatter', mode: 'xy', xRange: [1, 2], yRange: [-3, 4], ranges: [] });
    expect(scatter.ids).toBe(ids);
    expect(decodeSelection(new Float64Array([1, 0, 2, 5, NaN, NaN, 4, 0]), new Uint32Array([2, 3, 4, 5]))!.kind).toBe('bar');
  });

  it('empty selections, mode codes and brush style parameters', () => {
    expect(emptySelection('bar')).toMatchObject({ kind: 'bar', xRange: null, yRange: null, ranges: [], count: 0 });
    expect([brushModeCode('x'), brushModeCode('xy')]).toEqual([0, 1]);
    const p = encodeBrushStyle({ color: '#ff0000', fillOpacity: 0.5, borderWidth: 2 });
    expect(Array.from(p.slice(0, 9))).toEqual([1, 0, 0, 0.5, 1, 0, 0, 1, 2]);
    expect(Number.isNaN(p[9])).toBe(true);
    // Nothing given: engine defaults everywhere
    expect(Array.from(encodeBrushStyle({})).every(Number.isNaN)).toBe(true);
  });
});

describe('SDK brush selection', () => {
  it('selectChartRange passes data units (NaN y = x interval) and emits select', () => {
    const { sdk, selects, calls } = chartSdk('line');
    const sel = sdk.selectChartRange([new Date(10), 20])!;
    expect(calls.chart_select_range[0]).toEqual([10, 20, NaN, NaN]);
    expect(sel.ranges.length).toBe(2);
    expect(selects).toEqual([sel]);
    // Line selections never copy ids
    expect(calls.chart_selection_ids).toBeUndefined();
    expect(sdk.getSelection()).toEqual(sel);
  });

  it('scatter selections read ids; clear emits an empty select once', () => {
    const { sdk, selects, calls } = chartSdk('scatter');
    sdk.selectChartRange([1, 2], [-3, 4]);
    expect(calls.chart_select_range[0]).toEqual([1, 2, -3, 4]);
    expect(Array.from(sdk.getSelection()!.ids)).toEqual([4, 8, 15]);
    sdk.clearChartSelection();
    sdk.clearChartSelection(); // nothing selected anymore: no second event
    expect(selects.length).toBe(2);
    expect(selects[1]).toMatchObject({ kind: 'scatter', xRange: null, count: 0 });
    expect(sdk.getSelection()).toBeNull();
    // clearSelection clears the graph selection and the chart brush
    sdk.selectChartRange([1, 2]);
    const graphClears = calls.clear_selection?.length ?? 0;
    sdk.clearSelection();
    expect(calls.clear_selection.length).toBe(graphClears + 1);
    expect(calls.chart_clear_selection.length).toBe(3);
    expect(selects.at(-1)!.xRange).toBeNull();
  });

  it('brush mode: drag draws the brush, release commits, Alt + drag pans', () => {
    const { sdk, selects, calls } = chartSdk('line');
    const { canvas, handlers } = fakeCanvas();
    sdk.enableNodeInteractions(canvas, { brush: 'x', brushStyle: { color: '#00ff00' } });
    expect(sdk.getChartBrush()).toBe('x');
    expect(sdk.handlesChartBrush()).toBe(true);

    handlers.pointerdown(mouse(50, 50));
    handlers.pointermove(mouse(52, 51)); // within the click threshold: nothing yet
    expect(calls.chart_brush).toBeUndefined();
    handlers.pointermove(mouse(150, 75));
    // NDC of (50, 50) -> (150, 75) on a 200 x 100 canvas
    expect(calls.chart_brush.at(-1)).toEqual([0, -0.5, 0, 0.5, -0.5]);
    expect(calls.set_chart_brush_style.length).toBe(1);
    expect(calls.chart_clear_hover.length).toBeGreaterThan(0);
    expect(calls.chart_pan_x).toBeUndefined(); // the brush owns plain drags
    handlers.pointerup(mouse(150, 75, { buttons: 0 }));
    expect(calls.chart_brush_end.length).toBe(1);
    expect(selects.length).toBe(1);
    expect(selects[0]).toMatchObject({ kind: 'line', xRange: [10, 20] });

    // Alt + drag navigates instead
    handlers.pointerdown(mouse(50, 50, { altKey: true }));
    handlers.pointermove(mouse(80, 50, { altKey: true }));
    handlers.pointerup(mouse(80, 50, { altKey: true, buttons: 0 }));
    expect(calls.chart_pan_x.length).toBe(1);
    expect(calls.chart_brush.length).toBe(1);
    expect(calls.chart_brush_end.length).toBe(1);
    expect(selects.length).toBe(1);

    // A click clears the selection
    handlers.pointerdown(mouse(60, 50));
    handlers.pointerup(mouse(60, 50, { buttons: 0 }));
    expect(selects.length).toBe(2);
    expect(selects[1].xRange).toBeNull();
  });

  it('Escape clears; brush off restores drag navigation', () => {
    const { sdk, selects, calls } = chartSdk('line');
    const { canvas, handlers } = fakeCanvas();
    const detach = sdk.enableNodeInteractions(canvas);
    expect(sdk.getChartBrush()).toBe(false);
    handlers.pointerdown(mouse(50, 50));
    handlers.pointermove(mouse(90, 50));
    expect(calls.chart_pan_x.length).toBe(1);
    expect(calls.chart_brush).toBeUndefined();
    handlers.pointerup(mouse(90, 50, { buttons: 0 }));

    sdk.setChartBrush('xy');
    handlers.pointerdown(mouse(20, 20));
    handlers.pointermove(mouse(120, 80));
    expect(calls.chart_brush.at(-1)?.[0]).toBe(1);
    handlers.pointerup(mouse(120, 80, { buttons: 0 }));
    expect(selects.length).toBe(1);
    handlers.keydown({ key: 'a' });
    expect(selects.length).toBe(1);
    handlers.keydown({ key: 'Escape' });
    expect(selects.length).toBe(2);
    expect(sdk.getSelection()).toBeNull();

    sdk.setChartBrush(false);
    expect(sdk.handlesChartBrush()).toBe(false);
    detach();
    expect(handlers.keydown).toBeUndefined();
  });

  it('candle selections read ids; a replaced chart clears; 2.5D charts do not brush; detach restores', () => {
    expect(decodeSelection(new Float64Array([3, 0, 5, 9, NaN, NaN, 3, 0]), new Uint32Array([5, 6, 7]))!.kind).toBe('candlestick');
    const { sdk, selects, calls, backend } = chartSdk('line');
    // Engine reports a candle selection (kind 3): ids are copied
    const selectRange = backend.chart_select_range!;
    backend.chart_select_range = (...args: number[]) => {
      (calls.chart_select_range ??= []).push(args);
      return new Float64Array([3, 0, 5, 9, NaN, NaN, 3, 0]);
    };
    expect(Array.from(sdk.selectChartRange([5, 9])!.ids)).toEqual([4, 8, 15]);

    // Replacing the chart drops the committed selection: listeners hear an empty select
    backend.chart_select_range = selectRange;
    sdk.selectChartRange([1, 2]);
    const before = selects.length;
    sdk.renderLineChart([{ name: 'C', values: [1, 2] }], { viewMode: '2.5d' });
    expect(selects.length).toBe(before + 1);
    expect(selects.at(-1)!.xRange).toBeNull();

    // A binding's brush mode is not active on a 2.5D line, and detach restores the old mode
    const { canvas } = fakeCanvas();
    const detach = sdk.enableNodeInteractions(canvas, { brush: 'xy' });
    expect(sdk.getChartBrush()).toBe('xy');
    expect(sdk.handlesChartBrush()).toBe(false);
    sdk.renderLineChart([{ name: 'D', values: [1, 2] }]);
    expect(sdk.handlesChartBrush()).toBe(true);
    detach();
    expect(sdk.getChartBrush()).toBe(false);
    expect(sdk.handlesChartBrush()).toBe(false);
  });
});
