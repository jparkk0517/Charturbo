import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VIZ_THEMES,
  VizEngineSDK,
  type ChartTooltipContext,
  type WasmVizEngineBackend,
} from '../sdk/viz-engine-sdk';

// The a11y layer (canvas ARIA, live region, data table) has its own tests and needs a full DOM;
// this suite only checks bar layout / legend wiring, so it is replaced by an inert stand-in.
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    constructor(readonly host: () => unknown) {}
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

interface Mock {
  hit?: () => Float64Array;
  axes?: () => Float64Array;
  candle?: (i: number) => Float64Array;
  hist?: Float64Array;
}

function mockBackend(calls: Calls, m: Mock = {}): WasmVizEngineBackend {
  const hit = m.hit ?? (() => new Float64Array(0));
  const axes = m.axes ?? (() => new Float64Array(0));
  const candle = m.candle ?? (() => new Float64Array(0));
  const hist = m.hist ?? new Float64Array(0);
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let axesRevision = 0;
  return {
    set_candle_chart: record('set_candle_chart', 40),
    set_chart_candle_style: record('set_chart_candle_style'),
    chart_candle: (i: number) => candle(i),
    set_histogram_chart: record('set_histogram_chart', 4),
    chart_histogram: () => hist,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    chart_hover_at_ndc: () => hit(),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
    chart_axes_revision: () => ++axesRevision,
    chart_axes: () => axes(),
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

/** `chart_hover_at_ndc` layout: `[is_bar, primary, count, (series, index, value, global_id) * count]` */
function hitOf(index: number, value: number): Float64Array {
  return new Float64Array([0, 0, 1, 0, index, value, index]);
}

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

/** 10 daily candles: open 100 + i, close +/- 2 alternating, wicks +/- 5, volume 1000 + i. */
function ohlc(n = 10) {
  const open = Array.from({ length: n }, (_, i) => 100 + i);
  return {
    t: Array.from({ length: n }, (_, i) => new Date(T0 + i * DAY)),
    open,
    high: open.map((o) => o + 5),
    low: open.map((o) => o - 5),
    close: open.map((o, i) => o + (i % 2 === 0 ? 2 : -2)),
    volume: open.map((_, i) => 1000 + i),
  };
}

const f32 = (c: number[]) => Array.from(new Float32Array(c));

describe('Candlestick charts', () => {
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

  it('sends OHLC arrays, time x, and theme-default up / down colors to the engine', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const res = sdk.renderCandlestickChart(ohlc(), { title: 'ACME', hollowUp: false, wickWidth: 1.5 });
    expect(res).toEqual({ candleCount: 10 });
    const [t, open, high, low, close, volume, style, width, height, xKind] = calls.set_candle_chart[0] as [
      Float64Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, number, number, number,
    ];
    expect(t[3]).toBe(T0 + 3 * DAY);
    expect([open[2], high[2], low[2], close[2], volume[2]]).toEqual([102, 107, 97, 104, 1002]);
    expect(xKind).toBe(1); // Date t -> time axis
    expect([width, height]).toEqual([168, 86]);
    // Up = palette[0] (blue), down = palette[1] (orange); explicit options, NaN = engine default
    expect(Array.from(style.slice(0, 4))).toEqual(f32(VIZ_THEMES.dark.palette[0]));
    expect(Array.from(style.slice(4, 8))).toEqual(f32(VIZ_THEMES.dark.palette[1]));
    expect([style[8], style[9]]).toEqual([0, 1.5]);
    expect(Number.isNaN(style[10]) && Number.isNaN(style[12])).toBe(true);
    // Navigable like a line chart (wheel / drag zoom the x axis), no legend
    expect(sdk.handlesChartNavigation()).toBe(true);
    expect(container.querySelectorAll('.viz-sdk-legend-item').length).toBe(0);
    expect(calls.set_chart_padding.at(-1)).toEqual([36, 16, 30, 56]);
    // Details per candle id
    const d = sdk.getNodeDetails(2);
    expect(d?.metadata.attributes).toMatchObject({ open: 102, high: 107, low: 97, close: 104, volume: 1002 });
    expect(sdk.getNodeDetails(10)).toBeNull();
    // Candles have no toggleable series
    sdk.setSeriesVisible(0, false);
    expect(calls.set_chart_series_visible).toBeUndefined();
  });

  it('index placement and numeric x', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls));
    const { t: _t, ...noT } = ohlc();
    sdk.renderCandlestickChart(noT);
    expect((calls.set_candle_chart[0][0] as Float64Array).length).toBe(0);
    expect(calls.set_candle_chart[0][9]).toBe(0);
    expect((calls.set_candle_chart[0][5] as Float32Array).length).toBe(10);
    sdk.renderCandlestickChart({ ...ohlc(), t: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], volume: undefined }, { axes: { x: { type: 'numeric' } } });
    expect(calls.set_candle_chart[1][9]).toBe(0);
    expect((calls.set_candle_chart[1][5] as Float32Array).length).toBe(0);
    expect(() => sdk.renderCandlestickChart({ ...ohlc(), high: [1, 2] })).toThrow(/high has 2 values/);
  });

  it('tooltip shows O / H / L / C / V of the hovered candle or the aggregated bucket', () => {
    const calls: Calls = {};
    let bucket = new Float64Array([T0 + 7 * DAY, 107, 112, 102, 105, 1007, 7, 7]);
    const sdk = VizEngineSDK.fromBackend(
      mockBackend(calls, { hit: () => hitOf(7, 105), candle: () => bucket })
    );
    let ctx: ChartTooltipContext | null = null;
    sdk.on('hover', (e) => (ctx = e.chart));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    // UTC labels: the date below must not depend on the runner's zone
    sdk.renderCandlestickChart(ohlc(), { timeZone: 'UTC' });
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect(c.chartType).toBe('candlestick');
    expect(c.index).toBe(7);
    expect(c.ohlc).toEqual({ open: 107, high: 112, low: 102, close: 105, volume: 1007, x: T0 + 7 * DAY, xEnd: T0 + 7 * DAY, count: 1 });
    expect(c.items[0].seriesName).toBe('Close');
    const tip = body.querySelectorAll('.viz-sdk-node-tooltip')[0];
    for (const label of ['Open', 'High', 'Low', 'Close', 'Volume', '-1.87%']) expect(tip.innerHTML).toContain(label);
    // Falling candle: the change uses the down color
    expect(c.items[0].color).toBe('rgb(217, 89, 38)');

    // Zoomed out: the engine aggregates candles 4..=8 into one bucket
    bucket = new Float64Array([T0 + 4 * DAY, 104, 113, 98, 106, 5030, 4, 8]);
    canvas.fire('pointermove', { clientX: 402, clientY: 200, buttons: 0 });
    const tip2 = body.querySelectorAll('.viz-sdk-node-tooltip')[0];
    expect(tip2.innerHTML).toContain('5 candles');
    expect(tip2.innerHTML).toContain('Jan 9');
  });

  it('theme changes re-apply default candle colors only', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls));
    sdk.renderCandlestickChart(ohlc(), { downColor: '#ff0000' });
    sdk.setTheme('light');
    const style = calls.set_chart_candle_style.at(-1)![0] as Float32Array;
    expect(Array.from(style.slice(0, 4))).toEqual(f32(VIZ_THEMES.light.palette[0]));
    expect(Array.from(style.slice(4, 8))).toEqual(f32([1, 0, 0, 1]));
  });

  it('a11y model lists candles with O / H / L / C / V columns', async () => {
    const real = await vi.importActual<typeof import('../sdk/chart-a11y')>('../sdk/chart-a11y');
    const d = ohlc(3);
    const meta = {
      kind: 'candle',
      colors: [[0, 0, 1, 1]],
      t: Float64Array.from(d.t.map(Number)),
      open: d.open,
      high: d.high,
      low: d.low,
      close: d.close,
      volume: d.volume,
    };
    const model = real.buildA11yModel(meta, { xAxis: {}, yAxis: {}, formatX: (v: number) => String(v) })!;
    expect(model.series.map((s) => s.name)).toEqual(['Open', 'High', 'Low', 'Close', 'Volume']);
    expect(model.length).toBe(3);
    expect(model.xValue(1)).toBe(T0 + DAY);
    expect(real.buildChartSummary(model)).toMatch(/^Candlestick chart, 3 candles; Open ranges/);
    // Keyboard: one stop per candle, the engine hit (always series 0) is accepted
    expect(model.kind).toBe('candle');
    const focus = real.stepFocus(model, null, 'ArrowRight')!;
    expect(real.stepFocus(model, focus, 'ArrowDown')).toBeNull();
    expect(real.pointAnnouncement(model, focus)).toBe(`${T0}, open 100, high 105, low 95, close 102, volume 1,000. 1 of 3.`);
    expect(real.buildDataTable(model).columns).toEqual(['X', 'Open', 'High', 'Low', 'Close', 'Volume']);
  });

  it('a11y host tooltip hook returns the pointer OHLC tooltip (bucket aware)', () => {
    const calls: Calls = {};
    const bucket = new Float64Array([T0 + 4 * DAY, 104, 113, 98, 106, 5030, 4, 8]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, { candle: () => bucket }));
    sdk.renderCandlestickChart(ohlc());
    type Host = { chartTooltip(hit: Float64Array): ChartTooltipContext | null };
    const host = (sdk as unknown as { a11y: { host: () => Host } }).a11y.host();
    const ctx = host.chartTooltip(hitOf(6, 104))!;
    expect(ctx.chartType).toBe('candlestick');
    expect(ctx.ohlc).toEqual({ open: 104, high: 113, low: 98, close: 106, volume: 5030, x: T0 + 4 * DAY, xEnd: T0 + 8 * DAY, count: 5 });
    expect(host.chartTooltip(new Float64Array([0, 0, 0]))).toBeNull();
  });
});

describe('Histograms', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      body: new FakeEl('body'),
      head: new FakeEl('head'),
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** 4 bins over [0, 2]: `[bins, total, rule, edges, heights, counts]` */
  const HIST = new Float64Array([4, 10, 0, 0, 0.5, 1, 1.5, 2, 1, 4, 3, 2, 1, 4, 3, 2]);

  it('bins in the engine and labels bars with bin ranges on a numeric axis', () => {
    const calls: Calls = {};
    const container = new FakeEl('div');
    const canvas = container.appendChild(new FakeEl('canvas'));
    let axes = new Float64Array(0);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, { hist: HIST, axes: () => axes }));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const values = new Float32Array(10);
    const res = sdk.renderHistogram(values);
    const [sent, bins, lo, hi, density, color, , , radius, gap] = calls.set_histogram_chart[0] as [
      Float32Array, number, number, number, boolean, Float32Array, number, number, number, number,
    ];
    expect(sent).toBe(values); // no copy
    expect([bins, density, radius, gap]).toEqual([0, false, 0, 1]);
    expect(Number.isNaN(lo) && Number.isNaN(hi)).toBe(true);
    expect(Array.from(color)).toEqual(f32(VIZ_THEMES.dark.palette[0]));
    expect(res.binCount).toBe(4);
    expect(Array.from(res.edges)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(Array.from(res.counts)).toEqual([1, 4, 3, 2]);
    expect([res.total, res.rule]).toEqual([10, 'freedman-diaconis']);
    expect(sdk.getNodeDetails(1)?.label).toBe('0.5 – 1');
    expect(sdk.getNodeDetails(1)?.metadata.attributes).toEqual({ value: 4 });
    // x ticks receive bin edge values (numeric, not category labels)
    axes = new Float64Array([56, 16, 700, 300, 1, 0, 1.5, 400, 316]);
    sdk.render();
    expect(container.querySelectorAll('.viz-sdk-axis-tick')[0].textContent).toBe('1.5');

    sdk.renderHistogram([1, 2, 3], { bins: 12.7, range: [0, 5], density: true, barGap: 0 });
    const call = calls.set_histogram_chart[1];
    expect([call[1], call[2], call[3], call[4], call[9]]).toEqual([12, 0, 5, true, 0]);
    expect(sdk.getNodeDetails(0)?.metadata).toMatchObject({ category: 'Density', attributes: { count: 1 } });
  });

  it('throws on engines without histogram support', () => {
    const backend = mockBackend({});
    delete backend.set_histogram_chart;
    const sdk = VizEngineSDK.fromBackend(backend);
    expect(() => sdk.renderHistogram([1, 2])).toThrow(/histogram/);
  });
});
