import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { decodeScale, encodeScale, encodeSeriesAxes, hasScaleOptions } from '../sdk/chart-scales';
import { encodeAnnotations } from '../sdk/chart-annotations';
import { CHARTURBO_THEMES } from '../sdk/charturbo';

// Overlay-only suite: the a11y layer has its own tests and needs a full DOM.
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

/** Minimal DOM element: enough for the chart overlay (legend, ticks) and the tooltip. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  innerHTML = '';
  type = '';
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 800;
  offsetHeight = 400;

  constructor(readonly tag: string) {}

  appendChild(c: FakeEl): FakeEl {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    cs.forEach((c) => this.appendChild(c));
  }
  removeChild(c: FakeEl): void {
    this.children = this.children.filter((x) => x !== c);
    c.parentElement = null;
  }
  remove(): void {
    this.parentElement?.removeChild(this);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  /** Used by the a11y layer to place its hidden description next to the canvas */
  insertAdjacentElement(_where: string, el: FakeEl): FakeEl {
    return (this.parentElement ?? this).appendChild(el);
  }
  addEventListener(type: string, f: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(f);
  }
  removeEventListener(): void {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 400 };
  }
  /** Class selectors only (`.name`) */
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.slice(1);
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) =>
      el.children.forEach((c) => {
        if (c.className.split(' ').includes(cls)) out.push(c);
        walk(c);
      });
    walk(this);
    return out;
  }
  fire(type: string, e: unknown = {}): void {
    this.listeners[type]?.forEach((f) => f(e));
  }
}

type Calls = Record<string, unknown[][]>;

/** Mock backend recording chart calls; `scales` stands in for the engine's per-axis scale state. */
function mockBackend(calls: Calls, axes: () => Float64Array = () => new Float64Array(0)): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const scales = new Map<number, [number, boolean, number]>();
  let axesRevision = 0;
  return {
    set_line_chart: record('set_line_chart', 0),
    set_line_chart_xy: record('set_line_chart_xy', 0),
    set_area_chart: record('set_area_chart', 0),
    set_scatter_chart: record('set_scatter_chart', 0),
    set_bar_chart: record('set_bar_chart', 0),
    chart_series_count: () => 1,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_y_domain: record('set_chart_y_domain'),
    set_chart_y2_domain: record('set_chart_y2_domain'),
    chart_y2_domain: () => new Float64Array([1, 1000, 0]),
    set_chart_series_axes: record('set_chart_series_axes'),
    set_chart_y_axis_at: record('set_chart_y_axis_at'),
    set_chart_axis_breaks: record('set_chart_axis_breaks', true),
    set_chart_axis_scale: (axis: number, kind: number, reverse: boolean, ticks: number) => {
      (calls.set_chart_axis_scale ??= []).push([axis, kind, reverse, ticks]);
      scales.set(axis, [kind, reverse, ticks]);
    },
    chart_axis_scale: (axis: number) => {
      const s = scales.get(axis) ?? [0, false, 0];
      return new Float64Array([s[0], s[1] ? 1 : 0, s[2]]);
    },
    set_chart_annotations: record('set_chart_annotations'),
    set_chart_annotation_y_axes: record('set_chart_annotation_y_axes'),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
    chart_axes_revision: () => ++axesRevision,
    chart_axes: () => axes(),
    set_clear_color: record('set_clear_color'),
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
    clear_selection: () => {},
    set_node_pinned: () => true,
    move_node_to: () => true,
    node_count: () => 0,
    edge_count: () => 0,
    set_camera_pose: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    clear_scene_objects: record('clear_scene_objects'),
  };
}

const TEMP = { name: 'Temp', values: [10, 12, 11] };
const RAIN = { name: 'Rain', values: [1, 100, 1000], yAxis: 'right' as const };

describe('chart-scales encoding', () => {
  it('encodes scale options and per-series axes', () => {
    expect(hasScaleOptions(undefined)).toBe(false);
    expect(hasScaleOptions({ title: 'x' } as never)).toBe(false);
    expect(hasScaleOptions({ reverse: false })).toBe(true);
    expect(encodeScale({})).toEqual([0, false, 0]);
    expect(encodeScale({ scale: 'log', reverse: true, tickCount: 4.6 })).toEqual([1, true, 5]);
    expect(encodeScale({ tickCount: -3 })).toEqual([0, false, 0]);
    expect(encodeScale({ tickCount: NaN })).toEqual([0, false, 0]);
    expect(decodeScale(new Float64Array([1, 1, 6]))).toEqual({ scale: 'log', reverse: true, tickCount: 6 });
    expect(decodeScale(new Float64Array(0))).toBeNull();
    expect(decodeScale(undefined)).toBeNull();
    expect(encodeSeriesAxes([{}, { yAxis: 'left' }])).toBeNull();
    expect(Array.from(encodeSeriesAxes([{}, { yAxis: 'right' }, { yAxis: 'left' }])!)).toEqual([0, 1, 0]);
  });

  it('encodes annotation y axes (default left)', () => {
    const e = encodeAnnotations(
      [
        { type: 'hline', y: 5 },
        { type: 'hline', y: 500, yAxis: 'right' },
        { type: 'yband', from: 1, to: 2, yAxis: 'left' },
      ],
      CHARTURBO_THEMES.dark
    );
    expect(Array.from(e.yAxes)).toEqual([0, 1, 0]);
  });
});

describe('axis scales and dual y axes in the SDK', () => {
  let container: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    const body = new FakeEl('body');
    container = new FakeEl('div');
    canvas = container.appendChild(new FakeEl('canvas'));
    const head = new FakeEl('head');
    vi.stubGlobal('document', {
      body,
      head,
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('single-axis line charts stay opt-out: no series axes, no scale calls, default padding', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP, { ...RAIN, yAxis: 'left' }], { axes: { y2: { title: 'unused', scale: 'log' } } });
    expect(calls.set_chart_series_axes).toBeUndefined();
    expect(calls.set_chart_axis_scale).toBeUndefined();
    expect(calls.set_chart_y2_domain).toBeUndefined();
    expect(calls.set_chart_padding.at(-1)).toEqual([40, 16, 30, 56]);
  });

  it('sends series axes, per-axis scales and the right domain; pads and labels the right axis', () => {
    const calls: Calls = {};
    // Plot 56,40 600x300; one left y tick, one right y tick, one x tick
    const axes = () => new Float64Array([56, 40, 600, 300, 3, 0, 1, 100, 340, 1, 10, 56, 200, 2, 100, 656, 100]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart([TEMP, RAIN], {
      axes: {
        x: { reverse: true },
        y: { title: 'Temp', tickCount: 4 },
        y2: { title: 'Rain', scale: 'log', min: 1, format: (v) => `${v} mm` },
      },
    });
    expect(calls.set_chart_series_axes).toEqual([[new Uint8Array([0, 1])]]);
    expect(calls.set_chart_axis_scale).toEqual([
      [0, 0, true, 0],
      [1, 0, false, 4],
      [2, 1, false, 0],
    ]);
    expect(calls.set_chart_y2_domain).toEqual([[1, NaN, 0, true]]);
    expect(calls.set_chart_y_domain).toBeUndefined();
    // Right padding: tick labels (56) + title (20); legend (28) on top
    expect(calls.set_chart_padding.at(-1)).toEqual([40, 76, 30, 76]);
    expect(sdk.getY2Domain()).toEqual([1, 1000]);

    sdk.render();
    const ticks = container.querySelectorAll('.charturbo-sdk-axis-tick');
    expect(ticks.map((t) => t.textContent)).toEqual(['T+1', '10', '100 mm']);
    expect(ticks[2].style.left).toBe('664px');
    expect(ticks[2].style.transform).toBe('translate(0, -50%)');
    expect(ticks[1].style.transform).toBe('translate(-100%, -50%)');
    const titles = container.querySelectorAll('.charturbo-sdk-axis-title');
    expect(titles.map((t) => t.textContent)).toEqual(['', 'Temp', 'Rain']);
    expect(titles[2].style.left).toBe('718px');
    expect(titles[2].style.transform).toContain('rotate(90deg)');
  });

  it('hides right tick labels without a right axis presentation (2.5D)', () => {
    const calls: Calls = {};
    const axes = () => new Float64Array([56, 40, 600, 300, 1, 2, 100, 656, 100]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart([TEMP, RAIN], { viewMode: '2.5d' });
    expect(calls.set_chart_series_axes).toHaveLength(1);
    sdk.render();
    const shown = container.querySelectorAll('.charturbo-sdk-axis-tick').filter((t) => t.style.display !== 'none');
    expect(shown).toHaveLength(0);
    expect(container.querySelectorAll('.charturbo-sdk-axis-title')).toHaveLength(2);
  });

  it('setAxisScale merges into the engine state; setY2Domain merges its options', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP, RAIN]);
    sdk.setAxisScale('y2', { scale: 'log' });
    sdk.setAxisScale('y2', { reverse: true });
    expect(calls.set_chart_axis_scale.slice(-2)).toEqual([
      [2, 1, false, 0],
      [2, 1, true, 0],
    ]);
    expect(sdk.getAxisScale('y2')).toEqual({ scale: 'log', reverse: true, tickCount: 0 });
    sdk.setY2Domain({ min: 1 });
    sdk.setY2Domain({ autoscale: 'visible' });
    expect(calls.set_chart_y2_domain.at(-1)).toEqual([1, NaN, 1, true]);
  });

  it('applies scatter scales; area charts ignore right-axis series; bar charts ignore setAxisScale', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderScatterChart({ x: [1, 10, 100], y: [3, 2, 1] }, { axes: { x: { scale: 'log' }, y: { reverse: true, tickCount: 3 } } });
    expect(calls.set_chart_axis_scale).toEqual([
      [0, 1, false, 0],
      [1, 0, true, 3],
    ]);

    sdk.renderAreaChart([TEMP, RAIN], { axes: { y: { scale: 'log' } } });
    expect(calls.set_chart_series_axes).toBeUndefined();
    expect(calls.set_chart_axis_scale.at(-1)).toEqual([1, 1, false, 0]);
    expect(calls.set_chart_padding.at(-1)?.[1]).toBe(16);

    sdk.renderBarChart([{ label: 'a', value: 1 }]);
    const n = calls.set_chart_axis_scale.length;
    sdk.setAxisScale('y', { scale: 'log' });
    expect(calls.set_chart_axis_scale.length).toBe(n);
  });

  it('forwards annotation y axes only when an annotation uses the right axis', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP, RAIN]);
    sdk.setAnnotations([{ type: 'hline', y: 11 }]);
    expect(calls.set_chart_annotation_y_axes).toBeUndefined();
    sdk.addAnnotation({ type: 'hline', y: 500, yAxis: 'right' });
    expect(calls.set_chart_annotations).toHaveLength(2);
    expect(calls.set_chart_annotation_y_axes).toEqual([[new Uint8Array([0, 1])]]);
  });
});

describe('multiple y axes and axis breaks in the SDK', () => {
  let container: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    const body = new FakeEl('body');
    container = new FakeEl('div');
    canvas = container.appendChild(new FakeEl('canvas'));
    vi.stubGlobal('document', {
      body,
      head: new FakeEl('head'),
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const WIND = { name: 'Wind', values: [3, 4, 5], yAxisIndex: 2 };
  const PRESSURE = { name: 'Pressure', values: [1000, 990, 1010], yAxisIndex: 3 };

  it('extra y axes: series indices, per-axis scale / domain, stacked padding, labels, titles, axis lines', () => {
    const calls: Calls = {};
    // Plot 120,40 600x300; ticks: left, right, extra 2 (code 18), extra 3 (code 19); no breaks
    const axes = () =>
      new Float64Array([120, 40, 600, 300, 4, 1, 10, 120, 200, 2, 100, 720, 100, 18, 5, 120, 150, 19, 1000, 120, 120, 0, 0, 0, 0, 0]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart([TEMP, RAIN, WIND, PRESSURE], {
      axes: {
        y2: { title: 'Rain' },
        extraY: [
          { title: 'Wind', format: (v) => `${v} m/s`, min: 0, tickCount: 3, color: '#ff0000' },
          { position: 'left', offset: 8 },
        ],
      },
    });
    expect(calls.set_chart_series_axes).toEqual([[new Uint8Array([0, 1, 2, 3])]]);
    // a11y: series per axis on the meta
    expect((sdk as unknown as { chartMeta: { seriesAxes?: number[] } }).chartMeta.seriesAxes).toEqual([0, 1, 2, 3]);
    expect(calls.set_chart_axis_scale).toEqual([[18, 0, false, 3]]);
    expect(calls.set_chart_y_axis_at).toEqual([[2, 0, NaN, 0, true]]);
    // Left: y (56) + extra 3 (8 + 56); right: y2 (56 + 20) + extra 2 (56 + 20)
    expect(calls.set_chart_padding.at(-1)).toEqual([40, 152, 30, 120]);

    sdk.render();
    const ticks = container.querySelectorAll('.charturbo-sdk-axis-tick');
    expect(ticks.map((t) => t.textContent)).toEqual(['10', '100', '5 m/s', '1,000']);
    expect([ticks[2].style.left, ticks[2].style.transform, ticks[2].style.color]).toEqual(['804px', 'translate(0, -50%)', 'rgb(255, 0, 0)']);
    expect([ticks[3].style.left, ticks[3].style.transform]).toEqual(['48px', 'translate(-100%, -50%)']);
    const titles = container.querySelectorAll('.charturbo-sdk-axis-title');
    expect(titles.map((t) => t.textContent)).toEqual(['', '', 'Rain', 'Wind', '']);
    expect(titles[3].style.left).toBe('858px');
    expect(titles[3].style.color).toBe('rgb(255, 0, 0)');
    const lines = container.querySelectorAll('.charturbo-sdk-axis-line');
    // 2px wide: PNG / SVG export keep rects wider than 1px
    expect(lines.map((l) => l.style.width)).toEqual(['2px', '2px']);
    expect(lines.map((l) => [l.style.left, l.style.top, l.style.height])).toEqual([
      ['796px', '40px', '300px'],
      ['56px', '40px', '300px'],
    ]);
  });

  it('sends value-axis breaks with resolved gaps (line y / extra, bar value axis, scatter x)', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    const SPIKE = { name: 'Spike', values: [10, 20, 500] };
    // Kept span 490 - 450 = 40: default gap 2% = 0.8
    sdk.renderLineChart([SPIKE, { ...WIND, values: [0, 50, 100] }], {
      axes: { y: { breaks: [{ start: 30, end: 480 }] }, extraY: [{ breaks: [{ start: 10, end: 20, gap: '10%' }] }] },
    });
    const flat = (c: unknown[]) => [c[0], ...Array.from(c[1] as Float64Array).map((v) => +v.toFixed(6))];
    expect(calls.set_chart_axis_breaks.map(flat)).toEqual([
      [1, 30, 480, 0.8],
      [18, 10, 20, 9],
    ]);

    sdk.renderBarChart(
      [
        { label: 'a', value: 10 },
        { label: 'b', value: 500 },
      ],
      { axes: { y: { breaks: [{ start: 30, end: 480, gap: 5 }] } } }
    );
    expect(flat(calls.set_chart_axis_breaks.at(-1)!)).toEqual([1, 30, 480, 5]);
    // Horizontal bars: `axes.x` is the value axis
    sdk.renderBarChart([{ label: 'a', value: 500 }], { orientation: 'horizontal', axes: { x: { breaks: [{ start: 30, end: 480, gap: 4 }] } } });
    expect(flat(calls.set_chart_axis_breaks.at(-1)!)).toEqual([1, 30, 480, 4]);

    sdk.renderScatterChart({ x: [1, 2, 100], y: [3, 2, 1] }, { axes: { x: { breaks: [{ start: 5, end: 90, gap: 1 }] } } });
    expect(flat(calls.set_chart_axis_breaks.at(-1)!)).toEqual([0, 5, 90, 1]);
    // Breaks of an extra axis no series uses are skipped (the engine has no such axis)
    const before = calls.set_chart_axis_breaks.length;
    sdk.renderLineChart([SPIKE, { ...WIND, values: [0, 50, 100] }], {
      axes: { extraY: [{}, { breaks: [{ start: 10, end: 50 }] }] },
    });
    expect(calls.set_chart_axis_breaks).toHaveLength(before);
    // Charts without breaks never call the engine
    const n = calls.set_chart_axis_breaks.length;
    sdk.renderLineChart([SPIKE]);
    sdk.renderBarChart([{ label: 'a', value: 1 }]);
    expect(calls.set_chart_axis_breaks).toHaveLength(n);
  });

  it('validates breaks and yAxisIndex before clearing the current chart', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP]);
    const cleared = calls.clear_scene_objects.length;
    expect(() => sdk.renderLineChart([TEMP], { axes: { y: { breaks: [{ start: 5, end: 1 }] } } })).toThrow(/renderLineChart: axes\.y: break 0/);
    expect(() => sdk.renderLineChart([TEMP], { axes: { y: { scale: 'log', breaks: [{ start: 1, end: 5 }] } } })).toThrow(/linear/);
    expect(() => sdk.renderLineChart([TEMP, WIND])).toThrow(/series 1 yAxisIndex 2/);
    expect(() =>
      sdk.renderLineChart([TEMP], { axes: { extraY: [{ breaks: [{ start: 1, end: 3 }, { start: 2, end: 4 }] }] } })
    ).toThrow(/axes\.extraY\[0\]: breaks overlap/);
    expect(() => sdk.renderBarChart([{ label: 'a', value: 1 }], { axes: { y: { breaks: [{ start: 1, end: NaN }] } } })).toThrow(
      /renderBarChart: axes\.y/
    );
    // Error bars are drawn in linear data units: not combinable with breaks yet
    expect(() =>
      sdk.renderBarChart([{ label: 'a', value: 1, error: 0.5 }], { axes: { y: { breaks: [{ start: 2, end: 3 }] } } })
    ).toThrow(/renderBarChart: axes\.y: breaks do not support error bars/);
    expect(() =>
      sdk.renderGroupedBarChart(
        { categories: ['a'], series: [{ name: 's', values: [1], error: [0.5] }] },
        { axes: { y: { breaks: [{ start: 2, end: 3 }] } } }
      )
    ).toThrow(/renderGroupedBarChart: axes\.y: breaks do not support error bars/);
    expect(() => sdk.renderScatterChart({ x: [1], y: [1] }, { axes: { x: { scale: 'log', breaks: [{ start: 1, end: 2 }] } } })).toThrow(
      /renderScatterChart: axes\.x: breaks need a linear scale/
    );
    expect(calls.clear_scene_objects).toHaveLength(cleared);
    expect(calls.set_line_chart).toHaveLength(1);
    expect(calls.set_bar_chart).toBeUndefined();
    expect(calls.set_scatter_chart).toBeUndefined();
  });

  it('setAxisScale rejects log on an axis with breaks', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP, RAIN], { axes: { y: { breaks: [{ start: 1, end: 5 }] } } });
    const n = calls.set_chart_axis_scale?.length ?? 0;
    expect(() => sdk.setAxisScale('y', { scale: 'log' })).toThrow(/setAxisScale: axes\.y: breaks need a linear scale/);
    expect(calls.set_chart_axis_scale?.length ?? 0).toBe(n);
    // Other options and axes without breaks still apply
    sdk.setAxisScale('y', { reverse: true });
    sdk.setAxisScale('y2', { scale: 'log' });
    expect(calls.set_chart_axis_scale).toHaveLength(n + 2);
  });
});
