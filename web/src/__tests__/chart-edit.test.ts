import { describe, expect, it, vi } from 'vitest';
import {
  clampValue,
  createPointEditor,
  insertSortedPoint,
  resolveChartEdit,
  type CharturboPointAddEvent,
  type CharturboPointDragEvent,
  type PointEditTarget,
} from '../sdk/chart-edit';
// The a11y layer has its own tests and needs a full DOM: replaced by an inert stand-in
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dataChanged(): void {}
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));

import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

/**
 * Fake engine with a flat plot over the whole 200 x 100 canvas: data x 0..10 (line: sample
 * index or x), y 0..100. Hover returns the sample of every series nearest in x (line) or the
 * nearest point (scatter); projections follow the current data.
 */
function editBackend(kind: 'line' | 'scatter', init: { values?: number[][]; xs?: number[][]; x?: number[]; y?: number[] }) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const series = (init.values ?? []).map((v, s) => ({ values: [...v], xs: init.xs?.[s] ? [...init.xs[s]] : null }));
  const pts = { x: [...(init.x ?? [])], y: [...(init.y ?? [])] };
  const toNdc = (x: number, y: number) => new Float32Array([(x / 10) * 2 - 1, (y / 100) * 2 - 1, 0]);
  const toData = (nx: number, ny: number) => [((nx + 1) / 2) * 10, ((ny + 1) / 2) * 100];
  const lineOf = (id: number): [number, number] => {
    let acc = 0;
    for (let s = 0; s < series.length; s++) {
      if (id < acc + series[s].values.length) return [s, id - acc];
      acc += series[s].values.length;
    }
    return [-1, -1];
  };
  const backend: WasmCharturboEngineBackend = {
    set_line_chart: record('set_line_chart', 0),
    set_line_chart_xy: record('set_line_chart_xy', 0),
    set_scatter_chart: record('set_scatter_chart', 0),
    chart_series_count: () => (kind === 'line' ? series.length : 1),
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
    chart_hover_at_ndc: (nx: number, ny: number) => {
      const [x, y] = toData(nx, ny);
      if (kind === 'line') {
        const out = [0, 0, series.length];
        let offset = 0;
        series.forEach((s, k) => {
          const xs = s.xs ?? s.values.map((_, i) => i);
          let best = 0;
          xs.forEach((v, i) => {
            if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
          });
          out.push(k, best, s.values[best], offset + best);
          offset += s.values.length;
        });
        return new Float64Array(out);
      }
      let best = -1;
      pts.x.forEach((px, i) => {
        if (best < 0 || Math.hypot(px - x, pts.y[i] - y) < Math.hypot(pts.x[best] - x, pts.y[best] - y)) best = i;
      });
      return best < 0 ? new Float64Array(0) : new Float64Array([0, 0, 1, 0, best, pts.y[best], best]);
    },
    project_node_to_ndc: (id: number) => {
      if (kind === 'scatter') return toNdc(pts.x[id], pts.y[id]);
      const [s, i] = lineOf(id);
      return toNdc(series[s].xs?.[i] ?? i, series[s].values[i]);
    },
    chart_ndc_to_data: (nx: number, ny: number) => new Float64Array([...toData(nx, ny), 0, 10, 0, 100]),
    set_chart_series_data: (s: number, v: Float32Array, xs: Float64Array) => {
      record('set_chart_series_data')(s, Array.from(v), Array.from(xs));
      series[s].values = Array.from(v);
      if (xs.length) series[s].xs = Array.from(xs);
      return v.length;
    },
    set_chart_scatter_point: (i: number, x: number, y: number) => {
      record('set_chart_scatter_point')(i, x, y);
      pts.x[i] = x;
      pts.y[i] = y;
      return true;
    },
    append_chart_scatter_point: (x: number, y: number, s: number) => {
      record('append_chart_scatter_point')(x, y, s);
      pts.x.push(x);
      pts.y.push(y);
      return pts.x.length - 1;
    },
    chart_y_domain: () => new Float64Array([0, 100, 20]),
    set_chart_y_domain: record('set_chart_y_domain'),
    chart_range: () => new Float64Array([0, 10, 0, 100]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([0, 0, 200, 100, 0]),
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
  return { backend, calls, series, pts };
}

function fakeCanvas() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const canvas = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h),
    removeEventListener: (type: string) => delete handlers[type],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    setPointerCapture: () => {},
  } as unknown as HTMLCanvasElement;
  return { canvas, handlers };
}

const mouse = (clientX: number, clientY: number, extra: Record<string, unknown> = {}) => ({
  pointerType: 'mouse',
  pointerId: 1,
  button: 0,
  buttons: 1,
  clientX,
  clientY,
  ...extra,
});
/** Client px of data `(x, y)` on the fake plot. */
const px = (x: number, y: number): [number, number] => [(x / 10) * 200, 100 - y];

function lineSdk(values = [[10, 50, 30]], xs?: number[][], editable: unknown = true) {
  const mock = editBackend('line', { values, xs });
  const sdk = Charturbo.fromBackend(mock.backend);
  sdk.renderLineChart(values.map((v, s) => ({ name: `S${s}`, values: v, ...(xs ? { x: xs[s] } : {}) })));
  const { canvas, handlers } = fakeCanvas();
  // `null`: the option is not given at all
  sdk.enableNodeInteractions(canvas, editable === null ? {} : { editable: editable as never });
  const drags: CharturboPointDragEvent[] = [];
  const ends: CharturboPointDragEvent[] = [];
  const adds: CharturboPointAddEvent[] = [];
  sdk.on('pointDrag', (e) => drags.push(e));
  sdk.on('pointDragEnd', (e) => ends.push(e));
  sdk.on('pointAdd', (e) => adds.push(e));
  return { sdk, handlers, drags, ends, adds, ...mock };
}

describe('chart-edit helpers', () => {
  it('validates options before anything changes', () => {
    expect(resolveChartEdit(undefined)).toBeNull();
    expect(resolveChartEdit(false)).toBeNull();
    expect(resolveChartEdit(true)).toMatchObject({ drag: true, dragAxis: null, addOnClick: false, hitRadius: 10, addSeries: 0 });
    expect(resolveChartEdit({ dragAxis: 'x', min: 0, max: 5, series: [1] })!.series!.has(1)).toBe(true);
    expect(() => resolveChartEdit({ dragAxis: 'z' as never })).toThrow(/dragAxis/);
    expect(() => resolveChartEdit({ min: 5, max: 1 })).toThrow(/min/);
    expect(() => resolveChartEdit({ hitRadius: -1 })).toThrow(/hitRadius/);
    expect(() => resolveChartEdit({ series: [-1] })).toThrow(/series/);
    expect(() => resolveChartEdit({ min: NaN })).toThrow(/min/);
  });

  it('clamps and inserts sorted by x (index lines insert at the rounded index)', () => {
    expect(clampValue(5, 0, 3)).toBe(3);
    expect(clampValue(-1, 0, 3)).toBe(0);
    const a = insertSortedPoint([1, 2, 3], [0, 10, 20], 15, 9);
    expect([Array.from(a.values), Array.from(a.xs!), a.index]).toEqual([[1, 2, 9, 3], [0, 10, 15, 20], 2]);
    const b = insertSortedPoint([1, 2, 3], null, 0.6, 9);
    expect([Array.from(b.values), b.xs, b.index]).toEqual([[1, 9, 2, 3], null, 1]);
    expect(insertSortedPoint([1], [5], 99, 2).index).toBe(1);
  });

  it('keyboard steps move the value by a fiftieth (fine: a five-hundredth) of the visible span', () => {
    let value = { x: 2, y: 50 };
    const target: PointEditTarget = {
      chartType: 'line',
      defaultAxis: 'y',
      editable: () => true,
      axisOf: () => 0,
      movesX: () => false,
      idOf: (_s, i) => i,
      value: () => value,
      xLimits: () => [-Infinity, Infinity],
      set: (_s, _i, v) => (value = v),
      add: () => null,
      begin: () => {},
      end: () => {},
    };
    const events: CharturboPointDragEvent[] = [];
    const editor = createPointEditor({
      options: () => resolveChartEdit({ max: 51 }),
      target: () => target,
      backend: () => ({ chart_ndc_to_data: () => new Float64Array([5, 50, 0, 10, 0, 100]) }),
      rect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
      emitDrag: (e) => events.push(e),
      emitDragEnd: (e) => events.push(e),
      emitAdd: () => {},
      changed: () => {},
    });
    expect(editor.key(0, 2, 'ArrowDown', false)).toEqual({ x: 2, y: 48 });
    expect(editor.key(0, 2, 'ArrowUp', true)).toEqual({ x: 2, y: 48.2 });
    // Clamped at max; x does not move on an index line
    expect(editor.key(0, 2, 'ArrowUp', false)).toEqual({ x: 2, y: 50.2 });
    expect(editor.key(0, 2, 'ArrowUp', false)).toEqual({ x: 2, y: 51 });
    expect(editor.key(0, 2, 'ArrowUp', false)).toBeNull();
    expect(editor.key(0, 2, 'ArrowLeft', false)).toBeNull();
    expect(events.map((e) => e.source)).toEqual(Array(8).fill('keyboard'));
    expect(events[1]).toMatchObject({ oldValue: { x: 2, y: 50 }, newValue: { x: 2, y: 48 }, cancelled: false });
  });
});

describe('SDK point editing', () => {
  it('drags a line point in y: live updates, y domain frozen then restored, no pan', () => {
    const { sdk, handlers, drags, ends, calls } = lineSdk();
    const [x, y] = px(1, 50);
    handlers.pointerdown(mouse(x + 2, y + 1));
    handlers.pointermove(mouse(x + 6, y - 19)); // y + 20 data units; x is ignored on a y drag
    expect(calls.chart_pan_x).toBeUndefined();
    expect(calls.set_chart_series_data.at(-1)).toEqual([0, [10, 70, 30], []]);
    // Frozen at the current domain (fixed ends, autoscale none) for the drag
    expect(calls.set_chart_y_domain.at(-1)).toEqual([0, 100, 2, true]);
    expect(drags.at(-1)).toMatchObject({ chartType: 'line', series: 0, index: 1, oldValue: { x: 1, y: 50 }, newValue: { x: 1, y: 70 }, source: 'pointer' });
    handlers.pointerup(mouse(x + 6, y - 19, { buttons: 0 }));
    expect(ends).toEqual([expect.objectContaining({ newValue: { x: 1, y: 70 }, cancelled: false })]);
    // Configured options re-applied (autoscale all)
    expect(calls.set_chart_y_domain.at(-1)).toEqual([NaN, NaN, 0, true]);
    expect(sdk.getSeriesData(0)).toEqual({ x: [0, 1, 2], y: [10, 70, 30] });
  });

  it('clamps to the visible range and options; Escape restores the value', () => {
    const { sdk, handlers, ends, drags } = lineSdk([[10, 50, 30]], undefined, { max: 80 });
    const [x, y] = px(1, 50);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(x, y - 45));
    expect(drags.at(-1)!.newValue.y).toBe(80);
    handlers.pointermove(mouse(x, 150)); // below the plot
    expect(drags.at(-1)!.newValue.y).toBe(0);
    handlers.keydown({ key: 'Escape' });
    expect(ends).toEqual([expect.objectContaining({ newValue: { x: 1, y: 50 }, cancelled: true })]);
    expect(sdk.getSeriesData(0)!.y).toEqual([10, 50, 30]);
    // The release after a cancel is not a second commit
    handlers.pointerup(mouse(x, 150, { buttons: 0 }));
    expect(ends.length).toBe(1);
  });

  it('a chart replaced mid-drag drops the drag without writing into the new chart', () => {
    const { sdk, handlers, drags, ends, calls } = lineSdk();
    const [x, y] = px(1, 50);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(x, y - 20));
    sdk.renderLineChart([{ name: 'New', values: [1, 2, 3] }]);
    const writes = calls.set_chart_series_data.length;
    handlers.pointermove(mouse(x, y - 30));
    handlers.pointerup(mouse(x, y - 30, { buttons: 0 }));
    expect(calls.set_chart_series_data.length).toBe(writes);
    expect(drags.length).toBe(1);
    expect(ends.length).toBe(0);
    expect(sdk.getSeriesData(0)!.y).toEqual([1, 2, 3]);
  });

  it('data set from outside mid-drag is kept; only the dragged value is written over it', () => {
    const { sdk, handlers, calls } = lineSdk();
    const [x, y] = px(1, 50);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(x, y - 20));
    sdk.setSeriesData(0, [1, 2, 3]); // e.g. a streaming update
    handlers.pointermove(mouse(x, y - 30));
    expect(calls.set_chart_series_data.at(-1)).toEqual([0, [1, 80, 3], []]);
    handlers.pointerup(mouse(x, y - 30, { buttons: 0 }));
    expect(sdk.getSeriesData(0)!.y).toEqual([1, 80, 3]);
  });

  it('x drags stay between the neighbours of a line with x', () => {
    const { sdk, handlers, drags } = lineSdk([[10, 50, 30]], [[0, 4, 8]], { dragAxis: 'xy' });
    const [x, y] = px(4, 50);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(px(9.5, 0)[0], y));
    expect(drags.at(-1)!.newValue).toEqual({ x: 8, y: 50 });
    handlers.pointerup(mouse(px(9.5, 0)[0], y, { buttons: 0 }));
    expect(sdk.getSeriesData(0)).toEqual({ x: [0, 8, 8], y: [10, 50, 30] });
  });

  it('without editable a press on a point still pans; a press away from points pans too', () => {
    const { handlers, calls } = lineSdk([[10, 50, 30]], undefined, null);
    const [x, y] = px(1, 50);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(x + 30, y));
    expect(calls.chart_pan_x.length).toBe(1);
    expect(calls.set_chart_series_data).toBeUndefined();
    handlers.pointerup(mouse(x + 30, y, { buttons: 0 }));

    const edit = lineSdk();
    edit.handlers.pointerdown(mouse(px(1, 0)[0], 5)); // 45 px above the point
    edit.handlers.pointermove(mouse(px(1, 0)[0] + 30, 5));
    expect(edit.calls.chart_pan_x.length).toBe(1);
    expect(edit.drags.length).toBe(0);
  });

  it('a press on a point without moving is a click (no edit events)', () => {
    const { sdk, handlers, drags, ends } = lineSdk();
    const clicks: unknown[] = [];
    sdk.on('click', (e) => clicks.push(e));
    const [x, y] = px(1, 50);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(x + 1, y));
    handlers.pointerup(mouse(x + 1, y, { buttons: 0 }));
    expect([drags.length, ends.length, clicks.length]).toEqual([0, 0, 1]);
  });

  it('click to add inserts a line point sorted by x', () => {
    const { sdk, handlers, adds } = lineSdk([[10, 50, 30]], [[0, 4, 8]], { addOnClick: true });
    const [x, y] = px(6, 40);
    handlers.pointerdown(mouse(x, y));
    handlers.pointerup(mouse(x, y, { buttons: 0 }));
    expect(adds).toEqual([{ chartType: 'line', series: 0, index: 2, value: { x: 6, y: 40 } }]);
    expect(sdk.getSeriesData(0)).toEqual({ x: [0, 4, 6, 8], y: [10, 50, 40, 30] });
  });

  it('scatter: xy drag moves the point in place; click to add appends to the add series', () => {
    const mock = editBackend('scatter', { x: [2, 6], y: [20, 60] });
    const sdk = Charturbo.fromBackend(mock.backend);
    sdk.renderScatterChart({ x: [2, 6], y: [20, 60] });
    const { canvas, handlers } = fakeCanvas();
    sdk.enableNodeInteractions(canvas, { editable: { addOnClick: true } });
    const ends: CharturboPointDragEvent[] = [];
    const adds: CharturboPointAddEvent[] = [];
    sdk.on('pointDragEnd', (e) => ends.push(e));
    sdk.on('pointAdd', (e) => adds.push(e));
    const [x, y] = px(6, 60);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(px(7, 0)[0], px(0, 70)[1]));
    handlers.pointerup(mouse(px(7, 0)[0], px(0, 70)[1], { buttons: 0 }));
    const [, mx, my] = mock.calls.set_chart_scatter_point.at(-1) as number[];
    expect([mx, my].map((v) => Math.round(v * 1e4) / 1e4)).toEqual([7, 70]);
    expect(mock.calls.set_scatter_chart.length).toBe(1); // no re-render
    expect(ends[0]).toMatchObject({ chartType: 'scatter', series: 0, index: 1, oldValue: { x: 6, y: 60 }, newValue: { x: expect.closeTo(7, 4), y: expect.closeTo(70, 4) } });
    const [ax, ay] = px(9, 10);
    handlers.pointerdown(mouse(ax, ay));
    handlers.pointerup(mouse(ax, ay, { buttons: 0 }));
    expect(adds).toEqual([{ chartType: 'scatter', series: 0, index: 2, value: { x: expect.closeTo(9, 6), y: expect.closeTo(10, 6) } }]);
    const data = sdk.getSeriesData(0)!;
    expect([data.x.map(Math.round), data.y.map(Math.round), data.index]).toEqual([[2, 7, 9], [20, 70, 10], [0, 1, 2]]);
  });

  it('setChartEditable validates first and can turn editing off', () => {
    const { sdk, handlers, drags } = lineSdk();
    expect(() => sdk.setChartEditable({ dragAxis: 'q' as never })).toThrow(/dragAxis/);
    expect(sdk.getChartEditable()).toMatchObject({ drag: true });
    sdk.setChartEditable(false);
    expect(sdk.getChartEditable()).toBeNull();
    const [x, y] = px(1, 50);
    handlers.pointerdown(mouse(x, y));
    handlers.pointermove(mouse(x, y - 20));
    expect(drags.length).toBe(0);
  });
});
