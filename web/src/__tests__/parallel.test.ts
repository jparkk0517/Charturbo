import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus, tableToCSV } from '../sdk/chart-a11y';
import { parallelMeta, type CharturboParallelBrushEvent, type ParallelChartData } from '../sdk/chart-parallel';
import { renderChartSpec } from '../sdk/chart-binding';

/** Minimal DOM element: enough for the chart overlay, legend, labels and the tooltip. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  parentElement: FakeEl | null = null;
  className = '';
  private text = '';
  innerHTML = '';
  type = '';
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 800;
  offsetHeight = 400;
  id = '';
  tabIndex = -1;
  classList = { add: () => {}, remove: () => {} };

  constructor(readonly tag: string) {}

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.children = [];
    this.text = v;
  }
  appendChild(c: FakeEl): FakeEl {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    cs.forEach((c) => this.appendChild(c));
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children.forEach((c) => (c.parentElement = null));
    this.children = [];
    this.text = '';
    this.append(...cs);
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

interface EngineState {
  hit: Float64Array;
  labels: number[];
  axisHit: number[];
  valueAt: number;
  active: number;
  activeRows: number[];
}

function mockBackend(calls: Calls, st: EngineState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_parallel_chart: (...args: unknown[]) => {
      record('set_parallel_chart')(...args);
      return (args[4] as Float64Array).length / (args[0] as Uint8Array).length;
    },
    set_chart_parallel_style: record('set_chart_parallel_style'),
    set_chart_parallel_brush: (flat: Float64Array) => {
      record('set_chart_parallel_brush')(flat);
      return st.active;
    },
    chart_parallel_active_count: () => st.active,
    chart_parallel_active_rows: () => Uint32Array.from(st.activeRows),
    chart_parallel_axis_hit: () => new Float64Array(st.axisHit),
    chart_parallel_value_at: () => st.valueAt,
    chart_parallel_labels: () => new Float64Array([1, st.labels.length / 8, ...st.labels]),
    chart_hover_parallel_row: (row: number) => {
      record('chart_hover_parallel_row')(row);
      return new Float64Array([0, 0, 1, 0, row, 0, row]);
    },
    project_node_to_ndc: () => new Float32Array([0.1, 0.2, 0.5]),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_heatmap_colormap: record('set_chart_heatmap_colormap'),
    set_chart_heatmap_domain: record('set_chart_heatmap_domain'),
    chart_heatmap_color: () => new Uint8Array([10, 20, 30, 255]),
    chart_heatmap_colorbar: () => new Float64Array([1, 9, NaN, 2, 1, 0, 9, 1]),
    chart_heatmap_lut: () => new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0, NaN]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([100, 40, 600, 300, 0]),
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

const f32 = (c: number[]) => Array.from(new Float32Array(c));
const Y1975 = Date.UTC(1975, 0, 1);
const Y1978 = Date.UTC(1978, 0, 1);
const Y1980 = Date.UTC(1980, 0, 1);

const CARS: ParallelChartData = {
  dimensions: ['MPG', { name: 'Origin', categories: ['US', 'EU', 'JP'] }, { name: 'Year', type: 'time' }, { name: 'Weight', inverse: true, min: 0, max: 5000 }],
  series: [
    {
      name: 'Sedan',
      data: [
        [30, 'JP', '1980-01-01', 2000],
        [18, 'US', Y1975, 4000],
      ],
    },
    { name: 'Truck', data: [[null, 'EU', new Date(Y1978), 4500]] },
  ],
};

type A11yHost = { a11y: { model(): ReturnType<typeof buildA11yModel> } };

describe('Parallel coordinates (SDK binding)', () => {
  let body: FakeEl;
  let container: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    body = new FakeEl('body');
    container = new FakeEl('div');
    canvas = container.appendChild(new FakeEl('canvas'));
    vi.stubGlobal('document', {
      body,
      head: new FakeEl('head'),
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: () => null,
    });
    vi.stubGlobal('queueMicrotask', (f: () => void) => f());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function setup() {
    const st: EngineState = { hit: new Float64Array(0), labels: [], axisHit: [], valueAt: NaN, active: 3, activeRows: [0, 1, 2] };
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));
    const brushes: CharturboParallelBrushEvent[] = [];
    sdk.on('parallelBrush', (e) => brushes.push(e));
    const tooltip = () => body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    const hover = (hit: number[]) => {
      st.hit = new Float64Array(hit);
      canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
      return seen.at(-1)!;
    };
    const lastBrush = () => Array.from(calls.set_chart_parallel_brush.at(-1)![0] as Float64Array);
    const a11y = (sdk as unknown as A11yHost).a11y;
    return { calls, sdk, st, tooltip, hover, brushes, lastBrush, a11y };
  }

  it('uploads axes, row-major values and series; infers category / time axes', () => {
    const { calls, sdk } = setup();
    expect(sdk.renderParallelChart(CARS)).toEqual({ rowCount: 3, dimensionCount: 4, seriesCount: 2 });
    const [kinds, ranges, inverse, cats, values, series, opts] = calls.set_parallel_chart[0] as [Uint8Array, Float64Array, Uint8Array, Uint32Array, Float64Array, Uint32Array, Float64Array];
    expect(Array.from(kinds)).toEqual([0, 1, 2, 0]);
    expect(Array.from(ranges)).toEqual([NaN, NaN, NaN, NaN, NaN, NaN, 0, 5000]);
    expect(Array.from(inverse)).toEqual([0, 0, 0, 1]);
    expect(Array.from(cats)).toEqual([0, 3, 0, 0]);
    expect(Array.from(values)).toEqual([30, 2, Y1980, 2000, 18, 0, Y1975, 4000, NaN, 1, Y1978, 4500]);
    expect(Array.from(series)).toEqual([0, 0, 1]);
    // orient, line width, opacity, smooth, color dim (-1 = by series), series count
    expect(Array.from(opts)).toEqual([0, 1, 0.45, 0, -1, 2]);

    // Plain rows: strings infer a category axis in first-seen order, Dates a time axis
    sdk.renderParallelChart(
      {
        dimensions: ['a', 'b', 'c'],
        rows: [
          ['x', 1, new Date(Y1975)],
          ['y', 2, new Date(Y1978)],
          ['x', 3, null],
        ],
      },
      { orient: 'vertical', lineWidth: 2, opacity: 0.8, smooth: true }
    );
    const b = calls.set_parallel_chart[1] as [Uint8Array, Float64Array, Uint8Array, Uint32Array, Float64Array, Uint32Array, Float64Array];
    expect(Array.from(b[0])).toEqual([1, 0, 2]);
    expect(Array.from(b[3])).toEqual([2, 0, 0]);
    expect(Array.from(b[4])).toEqual([0, 1, Y1975, 1, 2, Y1978, 0, 3, NaN]);
    expect(Array.from(b[5])).toEqual([0, 0, 0]);
    expect(Array.from(b[6]).map((v) => Math.round(v * 100) / 100)).toEqual([1, 2, 0.8, 1, -1, 1]);
  });

  it('validates input before the active chart is torn down', () => {
    const { calls, sdk } = setup();
    sdk.renderParallelChart(CARS);
    const cleared = calls.clear_scene_objects.length;
    expect(() => sdk.renderParallelChart({ dimensions: ['a'], rows: [[1]] })).toThrow(/dimension/);
    expect(() => sdk.renderParallelChart({ dimensions: [{ name: 'o', categories: ['US'] }, 'b'], rows: [['EU', 1]] })).toThrow(/category/);
    expect(() => sdk.renderParallelChart({ dimensions: ['a', 'b'], rows: [[1, 2], [3]] })).toThrow(/row 1/);
    expect(() => sdk.renderParallelChart({ dimensions: ['a', 'b'], rows: [[1, 'z']], series: [] })).toThrow();
    expect(() => sdk.renderParallelChart({ dimensions: ['a', { name: 'b', type: 'value' }], rows: [[1, 'abc']] })).toThrow(/number/);
    expect(() => sdk.renderParallelChart({ dimensions: ['a', { name: 't', type: 'time' }], rows: [[1, 'soon']] })).toThrow(/time/);
    expect(() => sdk.renderParallelChart(CARS, { colorBy: 'Nope' })).toThrow(/dimension/);
    expect(() => sdk.renderParallelChart(CARS, { colorBy: 'Origin' })).toThrow(/value/);
    // An empty axis range and invalid colors are caught here too (not by the engine / style upload)
    expect(() => sdk.renderParallelChart({ dimensions: [{ name: 'a', min: 5, max: 5 }, 'b'], rows: [[5, 1]] })).toThrow(/min/);
    expect(() => sdk.renderParallelChart({ dimensions: ['a', { name: 't', type: 'time', min: '1980-01-01', max: '1975-01-01' }], rows: [[1, Y1978]] })).toThrow(/min/);
    expect(() => sdk.renderParallelChart(CARS, { axisColor: 'not-a-color' })).toThrow(/color/i);
    expect(() => sdk.renderParallelChart(CARS, { brushColor: 'not-a-color' })).toThrow(/color/i);
    expect(() => sdk.renderParallelChart(CARS, { inactiveColor: 'not-a-color' })).toThrow(/color/i);
    expect(() => sdk.renderParallelChart(CARS, { colorBy: 'MPG', color: 'not-a-color' })).toThrow(/color/i);
    expect(() => sdk.renderParallelChart({ dimensions: ['a', 'b'], series: [{ data: [[1, 2]], color: 'not-a-color' }] })).toThrow(/color/i);
    expect(calls.clear_scene_objects.length).toBe(cleared);
    expect(calls.set_parallel_chart).toHaveLength(1);
  });

  it('style: series palette, axis / brush / inactive tones from the theme; colorBy uses the heatmap colormap', () => {
    const { calls, sdk, a11y } = setup();
    sdk.renderParallelChart(CARS, { inactiveOpacity: 0.1 });
    const s = calls.set_chart_parallel_style.at(-1)!;
    const dark = CHARTURBO_THEMES.dark;
    expect(Array.from(s[0] as Float32Array)).toEqual(f32([...dark.palette[0], ...dark.palette[1]]));
    expect(Array.from(s[1] as Float32Array)).toEqual(f32(dark.baseline));
    expect(s[6]).toBeCloseTo(0.1);
    // Legend: two series, toggles hide their rows
    expect(container.querySelectorAll('.charturbo-sdk-legend-item')).toHaveLength(2);
    sdk.setSeriesVisible(1, false);
    expect(calls.set_chart_series_visible.at(-1)).toEqual([1, false]);
    expect(buildChartSummary(a11y.model()!)).toContain('3 rows');
    sdk.setTheme('light');
    expect(Array.from(calls.set_chart_parallel_style.at(-1)![1] as Float32Array)).toEqual(f32(CHARTURBO_THEMES.light.baseline));

    // Series color option wins over the palette
    sdk.renderParallelChart({ ...CARS, series: [{ ...CARS.series![0], color: '#ff0000' }, CARS.series![1]] });
    expect(Array.from(calls.set_chart_parallel_style.at(-1)![0] as Float32Array).slice(0, 4)).toEqual([1, 0, 0, 1]);

    // Color by a dimension: colormap, domain, colorbar room, no legend
    sdk.renderParallelChart(CARS, { colorBy: 'Weight', colorScale: 'viridis', colorRange: [1000, 5000] });
    expect((calls.set_parallel_chart.at(-1)![6] as Float64Array)[4]).toBe(3);
    expect(calls.set_chart_heatmap_colormap.at(-1)![0]).toBe(1);
    expect(calls.set_chart_heatmap_domain.at(-1)!.slice(0, 2)).toEqual([1000, 5000]);
    expect(container.querySelectorAll('.charturbo-sdk-heatmap-colorbar')).toHaveLength(1);
    expect((calls.set_chart_padding.at(-1) as number[])[1]).toBeGreaterThanOrEqual(84);
    expect(container.querySelectorAll('.charturbo-sdk-legend-item')).toHaveLength(0);
  });

  it('labels: value / category / time ticks and axis names at the engine anchors', () => {
    const { st, sdk } = setup();
    // kind, axis, value, x, y, h_align, v_align, granularity
    st.labels = [0, 1, 2, 300, 60, -1, 0, 0, 0, 2, Y1980, 400, 60, -1, 0, 7, 0, 3, 5000, 500, 60, -1, 0, 0, 1, 0, 0, 100, 30, 0, -1, 0];
    sdk.renderParallelChart(CARS);
    sdk.render();
    const texts = () => container.querySelectorAll('.charturbo-sdk-parallel-label').filter((l) => l.style.display !== 'none');
    expect(texts().map((l) => l.textContent)).toEqual(['JP', '1980', '5,000', 'MPG']);
    expect(texts()[0].style.transform).toBe('translate(-100%, -50%)');
    expect(texts()[3].style.transform).toBe('translate(-50%, -100%)');
    expect(texts()[3].style.fontWeight).toBe('600');
    // Per-dimension tick format
    sdk.renderParallelChart({ ...CARS, dimensions: [...CARS.dimensions.slice(0, 3), { name: 'Weight', format: (v: number) => `${v / 1000}t` }] });
    sdk.render();
    expect(texts()[2].textContent).toBe('5t');
  });

  it('brush API: names / dates resolve to axis values; event, read back, clear; invalid input throws', () => {
    const { calls, sdk, brushes, lastBrush, st } = setup();
    sdk.renderParallelChart(CARS);
    st.active = 1;
    expect(sdk.setParallelBrush([{ dimension: 'Origin', range: ['EU', 'JP'] }, { dimension: 0, range: [35, 20] }])).toBe(1);
    expect(lastBrush()).toEqual([0, 20, 35, 1, 1, 2]);
    const intervals = [
      { dimension: 0, name: 'MPG', range: [20, 35] },
      { dimension: 1, name: 'Origin', range: [1, 2], categories: ['EU', 'JP'] },
    ];
    expect(brushes.at(-1)).toEqual({ intervals, activeCount: 1, total: 3, source: 'api' });
    expect(sdk.getParallelBrush()).toEqual(intervals);
    sdk.setParallelBrush([{ dimension: 'Year', range: ['1976-01-01', new Date(Y1980)] }]);
    expect(lastBrush()).toEqual([2, Date.UTC(1976, 0, 1), Y1980]);

    const sent = calls.set_chart_parallel_brush.length;
    expect(() => sdk.setParallelBrush([{ dimension: 'Nope', range: [0, 1] }])).toThrow(/dimension/);
    expect(() => sdk.setParallelBrush([{ dimension: 'Origin', range: ['EU', 'Mars'] }])).toThrow(/category/);
    expect(() => sdk.setParallelBrush([{ dimension: 0, range: [NaN, 1] }])).toThrow(/finite/);
    expect(calls.set_chart_parallel_brush).toHaveLength(sent);

    sdk.clearParallelBrush();
    expect(lastBrush()).toEqual([]);
    expect(brushes.at(-1)).toMatchObject({ intervals: [], source: 'api' });
    const n = brushes.length;
    sdk.clearParallelBrush();
    expect(brushes).toHaveLength(n);
    // Escape (pointer interaction keyboard) clears the brush too
    sdk.setParallelBrush([{ dimension: 0, range: [20, 30] }]);
    canvas.fire('keydown', { key: 'Escape', preventDefault: () => {} });
    expect(lastBrush()).toEqual([]);
    expect(brushes.at(-1)).toMatchObject({ intervals: [], source: 'keyboard' });

    // Initial brush option (no event)
    const before = brushes.length;
    sdk.renderParallelChart(CARS, { brush: [{ dimension: 'MPG', range: [20, 40] }] });
    expect(lastBrush()).toEqual([0, 20, 40]);
    expect(sdk.getParallelBrush()).toHaveLength(1);
    expect(brushes).toHaveLength(before);
    expect(() => sdk.renderParallelChart(CARS, { brush: [{ dimension: 9, range: [0, 1] }] })).toThrow(/dimension/);
  });

  it('pointer brush: drag on an axis selects, Shift adds, a click clears the axis', () => {
    const { sdk, st, brushes, lastBrush, calls } = setup();
    sdk.renderParallelChart(CARS);
    const down = (x: number, y: number, extra: object = {}) =>
      canvas.fire('pointerdown', { button: 0, buttons: 1, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', ...extra });
    const move = (x: number, y: number) => canvas.fire('pointermove', { buttons: 1, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
    const up = (x: number, y: number) => canvas.fire('pointerup', { button: 0, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse' });
    st.axisHit = [1, 0.4];
    st.valueAt = 1.6;
    down(300, 200);
    move(300, 150);
    expect(lastBrush()).toEqual([1, 0.4, 1.6]);
    expect(brushes.at(-1)).toMatchObject({ source: 'pointer', intervals: [{ dimension: 1, range: [0.4, 1.6], categories: ['EU'] }] });
    up(300, 150);
    // Shift + drag adds an interval on another axis (and keeps axis 1)
    st.axisHit = [0, 10];
    st.valueAt = 15;
    down(100, 200, { shiftKey: true });
    move(100, 180);
    up(100, 180);
    expect(lastBrush()).toEqual([0, 10, 15, 1, 0.4, 1.6]);
    // Shift + drag on the same axis adds a second interval; a plain drag replaces the axis
    st.axisHit = [0, 20];
    st.valueAt = 25;
    down(100, 100, { shiftKey: true });
    move(100, 80);
    up(100, 80);
    expect(lastBrush()).toEqual([0, 10, 15, 0, 20, 25, 1, 0.4, 1.6]);
    down(100, 100);
    move(100, 80);
    up(100, 80);
    expect(lastBrush()).toEqual([0, 20, 25, 1, 0.4, 1.6]);
    // A click on an axis clears its intervals
    down(100, 100);
    up(100, 100);
    expect(lastBrush()).toEqual([1, 0.4, 1.6]);
    // Shift + drag past the 16 intervals of an axis keeps the brush (no throw per pointermove)
    sdk.setParallelBrush(Array.from({ length: 16 }, (_, k) => ({ dimension: 0, range: [k, k + 0.5] as [number, number] })));
    const full = calls.set_chart_parallel_brush.length;
    st.axisHit = [0, 30];
    st.valueAt = 31;
    down(100, 100, { shiftKey: true });
    expect(() => move(100, 80)).not.toThrow();
    up(100, 80);
    expect(calls.set_chart_parallel_brush).toHaveLength(full);
    sdk.setParallelBrush([{ dimension: 1, range: [0.4, 1.6] }]);
    // Off any axis: no brush change
    st.axisHit = [];
    const sent = calls.set_chart_parallel_brush.length;
    down(200, 100);
    move(200, 50);
    up(200, 50);
    expect(calls.set_chart_parallel_brush).toHaveLength(sent);
    // brushable: false turns pointer brushing off
    sdk.renderParallelChart(CARS, { brushable: false });
    st.axisHit = [0, 1];
    down(100, 100);
    move(100, 50);
    up(100, 50);
    expect(calls.set_chart_parallel_brush).toHaveLength(sent);
    // ...and keyboard brushing: Escape keeps an initial brush
    sdk.renderParallelChart(CARS, { brushable: false, brush: [{ dimension: 'MPG', range: [20, 40] }] });
    canvas.fire('keydown', { key: 'Escape', preventDefault: () => {} });
    expect(sdk.getParallelBrush()).toHaveLength(1);
  });

  it('tooltip: every dimension of the hovered row; point details', () => {
    const { sdk, hover, tooltip } = setup();
    sdk.renderParallelChart(CARS);
    const ctx = hover([0, 0, 1, 1, 2, NaN, 2]);
    expect(ctx.chartType).toBe('parallel');
    expect(ctx.index).toBe(2);
    expect(ctx.parallel).toEqual({
      row: 2,
      series: 1,
      seriesName: 'Truck',
      values: [
        { dimension: 'MPG', value: NaN, text: '—' },
        { dimension: 'Origin', value: 1, text: 'EU' },
        { dimension: 'Year', value: Y1978, text: 'Jan 1, 1978' },
        { dimension: 'Weight', value: 4500, text: '4,500' },
      ],
    });
    expect(ctx.items).toHaveLength(4);
    const html = tooltip().innerHTML;
    for (const t of ['Truck', 'MPG', 'EU', 'Jan 1, 1978', '4,500']) expect(html).toContain(t);
    expect(sdk.getNodeDetails(0)?.metadata).toMatchObject({ label: 'Sedan · Row 1', attributes: { MPG: 30, Origin: 'JP', Year: '1980-01-01', Weight: 2000 } });
  });

  it('a11y: summary, description, data table / CSV (all or active rows), axis keys', () => {
    const meta = parallelMeta(CARS, undefined, (v) => `${v}`);
    const model = buildA11yModel(meta, { title: 'Cars' })!;
    expect(model.kind).toBe('parallel');
    expect(buildChartSummary(model)).toBe('Cars. Parallel coordinates, 3 rows over 4 dimensions in 2 series.');
    const desc = buildChartDescription(model);
    expect(desc).toContain('MPG: 18 to 30.');
    expect(desc).toContain('Origin: 3 categories, US, EU, JP.');
    expect(desc).toContain('Shift');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Series', 'MPG', 'Origin', 'Year', 'Weight']);
    expect(table.rows).toEqual([
      ['Sedan', 30, 'JP', '1980-01-01', 2000],
      ['Sedan', 18, 'US', '1975-01-01', 4000],
      ['Truck', null, 'EU', '1978-01-01', 4500],
    ]);
    expect(tableToCSV(table).split(/\r?\n/)[1]).toBe('Sedan,30,JP,1980-01-01,2000');
    // Up / Down: next row by value on the focused axis (missing values last), Left / Right: axis
    expect(stepFocus(model, null, 'ArrowUp')).toEqual({ series: 0, index: 1 });
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowUp')).toEqual({ series: 0, index: 0 });
    expect(stepFocus(model, { series: 0, index: 0 }, 'ArrowDown')).toEqual({ series: 0, index: 1 });
    expect(stepFocus(model, { series: 0, index: 1 }, 'End')).toEqual({ series: 1, index: 2 });
    expect(pointAnnouncement(model, { series: 0, index: 0 })).toBe('MPG 30. Sedan, row 1 of 3: MPG 30, Origin JP, Year Jan 1, 1980, Weight 2000.');
    expect(stepFocus(model, { series: 0, index: 0 }, 'ArrowRight')).toEqual({ series: 0, index: 0 });
    expect(pointAnnouncement(model, { series: 0, index: 0 })).toMatch(/^Origin JP\./);
    // Weight is inverted: Up moves to lighter cars
    stepFocus(model, { series: 0, index: 0 }, 'ArrowRight');
    stepFocus(model, { series: 0, index: 0 }, 'ArrowRight');
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowUp')).toEqual({ series: 0, index: 0 });
    // Korean / Chinese text
    expect(buildChartSummary(buildA11yModel(meta, { locale: 'ko' })!)).toContain('평행 좌표');
    expect(buildDataTable(buildA11yModel(meta, { locale: 'ko' })!).columns[0]).toBe('시리즈');
    expect(buildChartSummary(buildA11yModel(meta, { locale: 'zh-CN' })!)).toContain('平行坐标');
  });

  it('keyboard brush: Shift + Up / Down extends from the anchor, Delete clears the axis', () => {
    const { sdk, a11y, lastBrush, brushes, st } = setup();
    sdk.renderParallelChart(CARS);
    const key = (k: string, shiftKey = false) => canvas.fire('keydown', { key: k, shiftKey, preventDefault: () => {} });
    // First Shift + Up focuses the lowest MPG row (the anchor), the next one extends
    key('ArrowUp', true);
    key('ArrowUp', true);
    expect(lastBrush()).toEqual([0, 18, 30]);
    expect(brushes.at(-1)).toMatchObject({ source: 'keyboard', intervals: [{ dimension: 0, range: [18, 30] }] });
    // The summary takes the active count from the engine (no per-row scan on each brush change)
    st.active = 1;
    sdk.setParallelBrush([{ dimension: 0, range: [17, 31] }]);
    expect(buildChartSummary(a11y.model()!)).toContain('1 row inside the brush');
    st.active = 3;
    // A plain move drops the anchor; Delete clears the focused axis
    expect(a11y.model()!.custom!.key!({ series: 0, index: 0 }, 'Delete', false)).toEqual({ focus: { series: 0, index: 0 } });
    expect(lastBrush()).toEqual([]);
    expect(a11y.model()!.custom!.key!({ series: 0, index: 0 }, 'Enter', false)).toBeNull();
    // Hidden series rows are skipped by the keyboard
    sdk.setSeriesVisible(0, false);
    st.active = 1;
    expect(stepFocus(a11y.model()!, null, 'ArrowUp')).toEqual({ series: 1, index: 2 });
  });

  it('CSV export: every row, or only the brushed ones', () => {
    const { sdk, st } = setup();
    sdk.renderParallelChart(CARS);
    const all = sdk.exportParallelCSV().split('\r\n');
    expect(all).toEqual(['Series,MPG,Origin,Year,Weight', 'Sedan,30,JP,1980-01-01,2000', 'Sedan,18,US,1975-01-01,4000', 'Truck,,EU,1978-01-01,4500']);
    expect(sdk.exportChartCSV()).toBe(all.join('\r\n'));
    st.activeRows = [0, 2];
    expect(sdk.exportParallelCSV({ activeOnly: true }).split('\r\n')).toEqual([all[0], all[1], all[3]]);
    expect(sdk.getParallelActiveRows()).toEqual([0, 2]);
  });

  it('React / Vue dispatch', () => {
    const sdk = { renderParallelChart: vi.fn() } as unknown as Charturbo;
    renderChartSpec(sdk, { type: 'parallel', data: CARS, options: { smooth: true } });
    expect((sdk.renderParallelChart as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([CARS, { smooth: true }]);
  });
});
