import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus, tableToCSV } from '../sdk/chart-a11y';
import { polarMeta } from '../sdk/chart-polar';
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
  /** `chart_polar_axes` */
  axes: number[];
  colors: number[];
}

function mockBackend(calls: Calls, st: EngineState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_polar_chart: (...args: unknown[]) => {
      record('set_polar_chart')(...args);
      return (args[1] as Float64Array).length / 9;
    },
    chart_polar_axes: () => {
      record('chart_polar_axes')();
      return new Float64Array(st.axes);
    },
    set_chart_hierarchy_style: record('set_chart_hierarchy_style'),
    chart_hierarchy_colors: () => new Float32Array(st.colors),
    chart_hierarchy_labels: () => new Float64Array([1, st.labels.length / 6, ...st.labels]),
    chart_hover_hierarchy_item: (series: number, index: number) => {
      record('chart_hover_hierarchy_item')(series, index);
      return st.hit;
    },
    set_chart_heatmap_colormap: record('set_chart_heatmap_colormap'),
    set_chart_heatmap_domain: record('set_chart_heatmap_domain'),
    chart_heatmap_colorbar: () => {
      record('chart_heatmap_colorbar')();
      return new Float64Array([0, 10, NaN, 0]);
    },
    chart_heatmap_lut: () => new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
    chart_heatmap_color: () => new Uint8Array([10, 20, 30, 255]),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0, NaN]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([100, 40, 600, 120, 0]),
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

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu'];
/** Two radial bar series on a category angle axis */
const BARS = {
  series: [
    { type: 'bar' as const, name: 'Sales', data: [3, 1, null, 2] },
    { type: 'bar' as const, name: 'Cost', data: [1, 2, 3, 4], roundCap: true },
  ],
};
/** Engine axes of BARS: angle = 4 categories, radius 0..4 with ticks 0..4 */
const AXES = [0, 4, 4, 0, 4, 0, 4, 0, 1, 2, 3, 5, 0, 1, 2, 3, 4];
const COLORS = [1, 0, 0, 1, 0, 1, 0, 1];
const rows = (a: Float64Array, n: number) => Array.from({ length: a.length / n }, (_, k) => Array.from(a.subarray(k * n, k * n + n)));

describe('Polar chart (SDK binding)', () => {
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
    const st: EngineState = { hit: new Float64Array(0), labels: [], axes: AXES, colors: COLORS };
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));
    const tooltip = () => body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    const hover = (hit: number[]) => {
      st.hit = new Float64Array(hit);
      canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
      return seen.at(-1)!;
    };
    const sent = (k = -1) => {
      const [o, s, d] = calls.set_polar_chart.at(k) as [Float64Array, Float64Array, Float64Array];
      return { o: Array.from(o), series: rows(s, 9), data: rows(d, 3) };
    };
    return { calls, sdk, st, tooltip, hover, sent };
  }

  it('uploads radial bars: values on the radius, category index on the angle; legend per series', () => {
    const { calls, sdk, sent } = setup();
    const res = sdk.renderPolarChart(BARS, { angleAxis: { data: DAYS } });
    expect(res).toEqual({ seriesCount: 2, itemCount: 8 });
    const { o, series, data } = sent();
    // start 0, clockwise, no hole, gaps 0.2 / 0.3, label room, line 14
    expect(o.slice(0, 5)).toEqual([0, 1, 0, 0.2, 0.3]);
    expect(o[5]).toBeGreaterThan(0);
    expect(o[6]).toBe(14);
    // Angle axis: 4 categories, defaults; radius axis: value axis
    expect(o.slice(7, 13)).toEqual([4, NaN, NaN, 5, 1, 1]);
    expect(o.slice(13, 19)).toEqual([0, NaN, NaN, 5, 1, 1]);
    expect(series).toEqual([
      [0, -1, 0, 0, 0, 0, NaN, NaN, 4],
      [0, -1, 1, 0, 0, 0, NaN, NaN, 4],
    ]);
    expect(data.slice(0, 4)).toEqual([
      [3, 0, NaN],
      [1, 1, NaN],
      [NaN, 2, NaN],
      [2, 3, NaN],
    ]);
    // No heatmap series: no colormap
    expect(calls.set_chart_heatmap_colormap).toBeUndefined();
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.map((i) => i.textContent)).toEqual(['Sales', 'Cost']);
    expect(container.querySelectorAll('.charturbo-sdk-heatmap-colorbar')).toHaveLength(0);
  });

  it('encodes stacks, line styles and axis options; category radius axis puts the value on the angle', () => {
    const { sdk, sent } = setup();
    sdk.renderPolarChart(
      {
        series: [
          { type: 'bar', data: [5, 3], stack: 'a' },
          { type: 'bar', data: [2, 1], stack: 'a' },
          { type: 'line', data: [4, 6], stack: 'b', smooth: true, area: true, closed: true, symbolSize: 6, lineWidth: 3 },
        ],
      },
      {
        radiusAxis: { data: ['A', 'B'] },
        angleAxis: { min: 0, max: 10, splitNumber: 4, labels: false, splitLine: false },
        startAngle: 90,
        clockwise: false,
        innerRadius: 0.2,
        barCategoryGap: 0.4,
        barGap: 0.1,
      }
    );
    const { o, series, data } = sent();
    expect(o[0]).toBeCloseTo(Math.PI / 2, 9);
    expect(o.slice(1, 5)).toEqual([0, 0.2, 0.4, 0.1]);
    // No angle labels: no room reserved
    expect(o[5]).toBe(0);
    expect(o.slice(7, 13)).toEqual([0, 0, 10, 4, 0, 0]);
    expect(o[13]).toBe(2);
    expect(series).toEqual([
      [0, 0, 0, 0, 0, 0, NaN, NaN, 2],
      [0, 0, 0, 0, 0, 0, NaN, NaN, 2],
      [1, 1, 0, 1, 1, 1, 6, 3, 2],
    ]);
    expect(data.slice(0, 2)).toEqual([
      [0, 5, NaN],
      [1, 3, NaN],
    ]);
  });

  it('heatmap cells and scatter points take [radius, angle(, value)] with category names; colormap + colorbar', () => {
    const { calls, sdk, sent } = setup();
    sdk.renderPolarChart(
      {
        series: [
          {
            type: 'heatmap',
            name: 'Load',
            data: [
              ['r1', 'a2', 5],
              [0, 0, 1],
              [1, 'a1', null],
            ],
          },
        ],
      },
      { angleAxis: { data: ['a1', 'a2', 'a3'] }, radiusAxis: { data: ['r1', 'r2'] }, colorScale: 'viridis', min: 0, max: 10 }
    );
    const { series, data } = sent();
    expect(series).toEqual([[3, -1, 0, 0, 0, 0, NaN, NaN, 3]]);
    expect(data).toEqual([
      [0, 1, 5],
      [0, 0, 1],
      [1, 0, NaN],
    ]);
    expect(calls.set_chart_heatmap_colormap.at(-1)![0]).toBe(1);
    expect(calls.set_chart_heatmap_domain.at(-1)).toEqual([0, 10, NaN]);
    expect(container.querySelectorAll('.charturbo-sdk-heatmap-colorbar')).toHaveLength(1);

    sdk.renderPolarChart({
      series: [
        {
          type: 'scatter',
          data: [
            [1, 30],
            [2, 90],
          ],
        },
      ],
    });
    expect(sent().data).toEqual([
      [1, 30, NaN],
      [2, 90, NaN],
    ]);
    expect(sent().o[7]).toBe(0);
    expect(sent().o[13]).toBe(0);
  });

  it('legend toggle of a heatmap series re-reads the colorbar (domain follows visible series)', () => {
    const { calls, sdk } = setup();
    sdk.renderPolarChart(
      {
        series: [
          { type: 'heatmap', name: 'A', data: [[0, 0, 1]] },
          { type: 'heatmap', name: 'B', data: [[1, 1, 50]] },
        ],
      },
      { angleAxis: { data: ['a1', 'a2'] }, radiusAxis: { data: ['r1', 'r2'] } }
    );
    const before = calls.chart_heatmap_colorbar?.length ?? 0;
    sdk.setSeriesVisible(1, false);
    expect(calls.chart_heatmap_colorbar?.length ?? 0).toBeGreaterThan(before);
  });

  it('validates input before the current chart is torn down', () => {
    const { calls, sdk } = setup();
    sdk.renderPolarChart(BARS, { angleAxis: { data: DAYS } });
    const cleared = calls.clear_scene_objects?.length ?? 0;
    const cat = { angleAxis: { data: DAYS } };
    const bad: [unknown, unknown, RegExp][] = [
      [{ series: [] }, cat, /at least one series/],
      [{}, cat, /series/],
      [{ series: [{ type: 'pie', data: [1] }] }, cat, /type/],
      [{ series: [{ type: 'bar', data: [1] }] }, {}, /exactly one category axis/],
      [{ series: [{ type: 'heatmap', data: [[0, 0, 1]] }] }, cat, /category angle and radius/],
      [{ series: [{ type: 'bar', data: [1, 2, 3, 4, 5] }] }, cat, /categor/],
      [{ series: [{ type: 'bar', data: [[1, 'Sun']] }] }, cat, /unknown/],
      [{ series: [{ type: 'bar', data: [1, Infinity] }] }, cat, /finite/],
      [{ series: [{ type: 'scatter', data: [1, 2] }] }, {}, /\[radius, angle\]/],
      [{ series: [{ type: 'line', data: [1], symbolSize: -1 }] }, cat, /symbolSize/],
      [{ series: [{ type: 'bar', data: [1], color: 'nope' }] }, cat, /color/i],
      [BARS, { angleAxis: { data: DAYS }, radiusAxis: { min: 5, max: 1 } }, /min must be below max/],
      [BARS, { ...cat, innerRadius: 0.95 }, /innerRadius/],
      [BARS, { ...cat, palette: ['#00f', 'nope'] }, /color/i],
    ];
    for (const [data, opts, re] of bad) expect(() => sdk.renderPolarChart(data as never, opts as never)).toThrow(re);
    expect(calls.set_polar_chart).toHaveLength(1);
    expect(calls.clear_scene_objects?.length ?? 0).toBe(cleared);
    expect(sdk.getNodeDetails(0)?.metadata.label).toBe('Sales · Mon');
  });

  it('tooltip: series, angle and radius labels (heatmap: the cell value)', () => {
    const { sdk, hover, tooltip } = setup();
    sdk.renderPolarChart(BARS, { angleAxis: { data: DAYS, name: 'Day' }, radiusAxis: { name: 'Units' } });
    const ctx = hover([0, 0, 1, 0, 1, 1, 1]);
    expect(ctx.chartType).toBe('polar');
    expect(ctx.polar).toEqual({ series: 0, seriesName: 'Sales', type: 'bar', index: 1, angle: 'Tue', radius: '1', value: 1 });
    expect(ctx.items[0]).toMatchObject({ seriesName: 'Sales', value: 1, color: 'rgb(255, 0, 0)' });
    expect(tooltip().innerHTML).toContain('Tue');
    expect(tooltip().innerHTML).toContain('Units');
    // Global id = series offset + index
    const c = hover([0, 0, 1, 1, 2, 3, 6]);
    expect(c.polar).toMatchObject({ series: 1, seriesName: 'Cost', angle: 'Wed', value: 3 });
    expect(sdk.getNodeDetails(6)?.metadata).toMatchObject({ label: 'Cost · Wed', attributes: { angle: 'Wed', radius: 3, value: 3 } });
    expect(sdk.getNodeDetails(99)).toBeNull();

    sdk.renderPolarChart(
      { series: [{ type: 'heatmap', name: 'Load', data: [['r1', 'a2', 5]] }] },
      { angleAxis: { data: ['a1', 'a2'] }, radiusAxis: { data: ['r1'] }, valueLabel: 'Jobs' }
    );
    const h = hover([0, 0, 1, 0, 0, 5, 0]);
    expect(h.polar).toMatchObject({ type: 'heatmap', angle: 'a2', radius: 'r1', value: 5 });
    expect(tooltip().innerHTML).toContain('Jobs');
  });

  it('legend toggle hides a series in the engine and re-reads the axes', () => {
    const { calls, sdk, st } = setup();
    sdk.renderPolarChart(BARS, { angleAxis: { data: DAYS } });
    const before = calls.chart_polar_axes.length;
    st.axes = [0, 4, 4, 0, 3, 0, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3];
    container.querySelectorAll('.charturbo-sdk-legend-item')[1].fire('click', {});
    expect(calls.set_chart_series_visible.at(-1)).toEqual([1, false]);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    expect(calls.chart_polar_axes.length).toBeGreaterThan(before);
    const model = buildA11yModel((sdk as unknown as { chartMeta: Record<string, unknown> }).chartMeta, {})!;
    expect(buildChartSummary(model)).toContain('0 to 3');
    sdk.setSeriesVisible(1, true);
    expect(calls.set_chart_series_visible.at(-1)).toEqual([1, true]);
  });

  it('labels: angle categories outside the rim, radius ticks beside the axis', () => {
    const { st, sdk } = setup();
    st.labels = [0, 100, 50, 0, 27, 1, 1, 300, 20, 0, 27, 2, 65536, 400, 210, 0, 27, -1, 65538, 410, 150, 0, 27, -1];
    sdk.renderPolarChart(BARS, { angleAxis: { data: DAYS } });
    sdk.render();
    const shown = () => container.querySelectorAll('.charturbo-sdk-polar-label').filter((l) => l.style.display !== 'none');
    expect(shown().map((l) => l.textContent)).toEqual(['Mon', 'Tue', '0', '2']);
    expect(shown()[0].style.transform).toBe('translate(0, -50%)');
    expect(shown()[1].style.transform).toBe('translate(-50%, -100%)');
    expect(shown()[2].style.transform).toBe('translate(-100%, -50%)');
    expect(shown()[0].style.left).toBe('100px');
    // New tick values after a legend toggle re-label without a new anchor revision
    st.axes = [0, 4, 4, 0, 8, 0, 4, 0, 1, 2, 3, 5, 0, 2, 4, 6, 8];
    sdk.setSeriesVisible(0, false);
    sdk.render();
    expect(shown().map((l) => l.textContent)).toEqual(['Mon', 'Tue', '0', '4']);
  });

  it('a11y: summary, table / CSV, item / series keys, engine hover by id, locales', () => {
    const meta = polarMeta(BARS, { angleAxis: { data: DAYS } }, (v) => `${v}`);
    meta.radiusAxis.lo = 0;
    meta.radiusAxis.hi = 4;
    const hovers: number[][] = [];
    meta.engine = { hover: (s, i) => (hovers.push([s, i]), new Float64Array([0, 0, 1, s, i, 1, i])) };
    const model = buildA11yModel(meta, { title: 'Week' })!;
    expect(buildChartSummary(model)).toBe('Week. Polar chart, 2 series; angle axis: 4 categories; radius axis: 0 to 4.');
    expect(buildChartDescription(model)).toContain('Sales (bar): 3 items, 1 to 3.');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Series', 'Angle', 'Radius']);
    expect(table.rows.slice(0, 3)).toEqual([
      ['Sales', 'Mon', 3],
      ['Sales', 'Tue', 1],
      ['Sales', 'Wed', ''],
    ]);
    expect(table.rows).toHaveLength(8);
    expect(tableToCSV(table).split(/\r?\n/)[1]).toBe('Sales,Mon,3');
    expect(stepFocus(model, null, 'ArrowRight')).toEqual({ series: 0, index: 0 });
    expect(stepFocus(model, { series: 0, index: 0 }, 'ArrowRight')).toEqual({ series: 0, index: 1 });
    expect(stepFocus(model, { series: 0, index: 3 }, 'ArrowRight')).toEqual({ series: 0, index: 3 });
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowDown')).toEqual({ series: 1, index: 1 });
    expect(stepFocus(model, { series: 1, index: 1 }, 'ArrowUp')).toEqual({ series: 0, index: 1 });
    expect(stepFocus(model, { series: 1, index: 0 }, 'End')).toEqual({ series: 1, index: 3 });
    expect(pointAnnouncement(model, { series: 0, index: 0 })).toBe('Sales: Angle Mon, Radius 3. 1 of 4.');
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('Sales: Angle Wed, Radius no data. 3 of 4.');
    expect(model.pointId(1, 2)).toBe(6);
    model.custom!.hover!({ series: 1, index: 2 });
    expect(hovers.at(-1)).toEqual([1, 2]);
    // Hidden series are skipped by Up / Down
    meta.visible[1] = false;
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowDown')).toEqual({ series: 0, index: 1 });
    expect(buildChartSummary(buildA11yModel(meta, { locale: 'ko' })!)).toContain('극좌표');
    expect(buildChartSummary(buildA11yModel(meta, { locale: 'zh-CN' })!)).toContain('极坐标');
  });

  it('React / Vue dispatch', () => {
    const sdk = { renderPolarChart: vi.fn() } as unknown as Charturbo;
    renderChartSpec(sdk, { type: 'polar', data: BARS, options: { angleAxis: { data: DAYS } } });
    expect((sdk.renderPolarChart as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([BARS, { angleAxis: { data: DAYS } }]);
  });
});

