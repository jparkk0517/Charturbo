import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIZ_THEMES, VizEngineSDK, type ChartTooltipContext, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';
import { BOX_STATS_STRIDE, boxStatsAt, encodeBoxOptions, encodeBoxPlot, type BoxChartMeta } from '../sdk/chart-boxplot';

// The SDK paths need no a11y DOM here; the real a11y model is tested below via importActual
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    constructor(readonly host: () => unknown) {}
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
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
  replaceChildren(...cs: FakeEl[]): void {
    this.children.forEach((c) => (c.parentElement = null));
    this.children = [];
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

/** One group's engine stats row: n, min, q1, median, q3, max, mean, std, wlo, whi, outliers. */
const row = (median: number, outliers = 0): number[] => [10, 1, median - 2, median, median + 2, 100, median + 1, 3, 1, median + 5, outliers];

/** 2 series x 3 categories; group (1, 2) is empty. */
const STATS = new Float64Array([
  ...row(5, 1),
  ...row(6),
  ...row(7),
  ...row(8),
  ...row(9, 2),
  0,
  ...new Array(BOX_STATS_STRIDE - 1).fill(NaN),
]);

function mockBackend(calls: Calls, hit: () => Float64Array): WasmVizEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_box_chart: record('set_box_chart', 50),
    chart_box_stats: () => STATS,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    set_clear_color: () => {},
    chart_hover_at_ndc: () => hit(),
    // [series, index, value, x, y, z, dataX]
    chart_sample: (id: number) => (id < 6 ? new Float64Array([Math.floor(id / 3), id % 3, 5, 1, 2, 0, NaN]) : new Float64Array([0, 0, 100, 1, 9, 0, NaN])),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array(0),
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
    clear_scene_objects: () => {},
  };
}

const DATA = {
  categories: ['A', 'B', 'C'],
  series: [
    { name: 'Control', values: [[1, 2, 3], new Float32Array([4, 5]), [6]] },
    { name: 'Treated', values: [[7], [8, 9], []] },
  ],
};

describe('Native box plot (SDK binding)', () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('flattens the groups once and sends options, palette colors and the legend padding', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0)));
    const res = sdk.renderBoxPlot(DATA, { title: 'Latency', whiskers: [5, 95], showMean: true });
    expect(res).toEqual({ boxCount: 6, seriesCount: 2, categoryCount: 3, sampleCount: 50 });
    const [values, counts, s, n, colors, layout, opts] = calls.set_box_chart[0] as [
      Float32Array, Uint32Array, number, number, Float32Array, Float32Array, Float64Array,
    ];
    expect(Array.from(values)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(Array.from(counts)).toEqual([3, 2, 1, 1, 2, 0]);
    expect([s, n]).toEqual([2, 3]);
    // Theme palette in fixed order
    expect(Array.from(colors.subarray(0, 4))).toEqual(Array.from(new Float32Array(VIZ_THEMES.dark.palette[0])));
    expect(Array.from(colors.subarray(4, 8))).toEqual(Array.from(new Float32Array(VIZ_THEMES.dark.palette[1])));
    expect(Array.from(layout).every(Number.isNaN)).toBe(true);
    expect([opts[0], opts[1], opts[2], opts[4], opts[7]]).toEqual([2, 0.05, 0.95, 1, 0]);
    // Title + legend on top (2 series)
    expect(calls.set_chart_padding.at(-1)).toEqual([64, 16, 30, 56]);
    expect(sdk.handlesChartNavigation()).toBe(false);
    // No brush on box plots
    sdk.setChartBrush('xy');
    expect(sdk.handlesChartBrush()).toBe(false);
  });

  it('encodes violin / whisker options and folds more than 8 series into Other', () => {
    const v = encodeBoxOptions({ violin: { bandwidth: 0.5, showBox: false, scale: 'width', opacity: 0.5 }, whiskers: 'minmax' });
    expect([v[0], v[7], v[8], v[9], v[10], v[11]]).toEqual([1, 1, 0.5, 0, 1, 0.5]);
    const t = encodeBoxOptions({ iqrFactor: 3, showOutliers: false });
    expect([t[0], t[1], t[3]]).toEqual([0, 3, 0]);
    expect(Number.isNaN(t[4])).toBe(true); // engine default

    const palette = VIZ_THEMES.light.palette;
    const many = {
      categories: ['x'],
      series: Array.from({ length: 10 }, (_, k) => ({ name: `S${k}`, values: [[k, k + 0.5]] })),
    };
    const enc = encodeBoxPlot(many, palette, VIZ_THEMES.light.baseline);
    expect(enc.names).toEqual(['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'Other']);
    // "Other" pools the samples of S7..S9 and gets the neutral color
    expect(Array.from(enc.counts)).toEqual([2, 2, 2, 2, 2, 2, 2, 6]);
    expect(Array.from(enc.values.subarray(14))).toEqual([7, 7.5, 8, 8.5, 9, 9.5]);
    expect(enc.rgba[7]).toEqual(VIZ_THEMES.light.baseline);
    expect(enc.rgba[0]).toEqual(palette[0]);
    // Explicit colors: no folding
    expect(encodeBoxPlot(many, palette, palette[0], many.series.map(() => '#ff0000')).names.length).toBe(10);
  });

  it('hover resolves boxes into stats and outliers into their value', () => {
    const calls: Calls = {};
    // Engine hit: is_bar, primary, count, (series, index, value, id)
    let hit = new Float64Array([1, 0, 1, 1, 1, 9, 4]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => hit));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderBoxPlot(DATA);
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));

    canvas.fire('pointermove', { buttons: 0, clientX: 400, clientY: 200 });
    const ctx = seen.at(-1)!;
    expect(ctx.chartType).toBe('box');
    expect(ctx.xLabel).toBe('B');
    expect(ctx.box).toMatchObject({ series: 1, category: 1, seriesName: 'Treated', categoryLabel: 'B', median: 9, q1: 7, q3: 11, n: 10, outliers: 2 });
    expect(ctx.box?.outlier).toBeUndefined();
    const tooltip = body.children.find((c) => c.className.includes('viz-sdk-node-tooltip'))!;
    for (const text of ['Treated', 'Median', 'Q1', 'Q3', 'Mean', 'Outliers', 'Whiskers']) expect(tooltip.innerHTML).toContain(text);

    // Outlier ids follow the 6 boxes
    hit = new Float64Array([0, 0, 1, 0, 0, 100, 6]);
    canvas.fire('pointermove', { buttons: 0, clientX: 410, clientY: 120 });
    const out = seen.at(-1)!;
    expect(out.box?.outlier).toBe(100);
    expect(out.items[0]).toMatchObject({ seriesName: 'Control', value: 100, nodeId: 6 });
    expect(tooltip.innerHTML).toContain('Outlier');
    expect(sdk.getNodeDetails(6)?.metadata.tags).toContain('outlier');
    expect(sdk.getNodeDetails(4)?.metadata.attributes).toMatchObject({ series: 'Treated', category: 'B', median: 9, n: 10 });

    // Empty group: no tooltip
    hit = new Float64Array([1, 0, 1, 1, 2, NaN, 5]);
    canvas.fire('pointermove', { buttons: 0, clientX: 600, clientY: 200 });
    expect(seen.at(-1)).toBeNull();

    // Keyboard a11y path: the host hook gives the same tooltip as the pointer
    type Host = { chartTooltip(hit: Float64Array): ChartTooltipContext | null };
    const host = (sdk as unknown as { a11y: { host: () => Host } }).a11y.host();
    expect(host.chartTooltip(new Float64Array([1, 0, 1, 0, 2, 7, 2]))?.box).toMatchObject({ category: 2, median: 7 });

    // Legend toggles the series in the engine
    sdk.setSeriesVisible(1, false);
    expect(calls.set_chart_series_visible.at(-1)).toEqual([1, false]);
    expect(sdk.isSeriesVisible(1)).toBe(false);
  });

  it('builds the a11y model: summary, stats table per category x series, announcements, focus', async () => {
    const a11y = await vi.importActual<typeof import('../sdk/chart-a11y')>('../sdk/chart-a11y');
    const meta: BoxChartMeta = {
      kind: 'box',
      names: ['Control', 'Treated'],
      colors: [VIZ_THEMES.dark.palette[0], VIZ_THEMES.dark.palette[1]],
      categories: ['A', 'B', 'C'],
      visible: [true, true],
      stats: STATS,
      violin: false,
      whiskers: 'tukey',
      iqrFactor: 1.5,
      valueLabel: 'ms',
    };
    const model = a11y.buildA11yModel(meta, { title: 'Latency', yAxis: { title: 'ms' } })!;
    expect(model.kind).toBe('box');
    expect(a11y.buildChartSummary(model)).toBe(
      'Latency. Box plot, 3 categories, 2 series, 50 samples (3 outliers); Control medians 5–7; Treated medians 8–9.'
    );
    const desc = a11y.buildChartDescription(model);
    expect(desc).toContain('whiskers at 1.5 IQR');
    expect(desc).toContain('Treated: highest median B 9, lowest median A 8, 20 samples, 2 outliers.');
    expect(desc).toContain('Left and Right arrows to move between categories');

    const table = a11y.buildDataTable(model);
    expect(table.columns).toEqual(['Category', 'Series', 'n', 'Min', 'Q1', 'Median', 'Q3', 'Max', 'Mean', 'Lower whisker', 'Upper whisker', 'Outliers']);
    expect(table.totalRows).toBe(6);
    expect(table.rows[0]).toEqual(['A', 'Control', 10, 1, 3, 5, 7, 100, 6, 1, 10, 1]);
    expect(table.rows[5]).toEqual(['C', 'Treated', null, null, null, null, null, null, null, null, null, null]);
    expect(a11y.tableToCSV(table).split('\r\n')[2]).toBe('A,Treated,10,1,6,8,10,100,9,1,13,0');

    // Focus walks categories (Left / Right) and series (Up / Down)
    let focus = a11y.stepFocus(model, null, 'ArrowRight')!;
    expect(focus).toEqual({ series: 0, index: 0 });
    focus = a11y.stepFocus(model, focus, 'ArrowRight')!;
    focus = a11y.stepFocus(model, focus, 'ArrowDown')!;
    expect(focus).toEqual({ series: 1, index: 1 });
    expect(model.pointId(focus.series, focus.index)).toBe(4);
    expect(a11y.pointAnnouncement(model, focus)).toBe(
      'B, Treated: median 9, quartiles 7 to 11, whiskers 1 to 14, mean 10, 10 samples, 2 outliers. 2 of 3.'
    );
    expect(a11y.pointAnnouncement(model, { series: 1, index: 2 })).toBe('C, Treated: no data. 3 of 3.');
    expect(boxStatsAt(STATS, 5)).toBeNull();
  });
});
