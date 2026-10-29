import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { themeRiverLineOptions, themeRiverSeries, type ThemeRiverDatum } from '../sdk/chart-theme-river';
import { buildA11yModel, buildChartSummary, tooltipContext } from '../sdk/chart-a11y';

/** Minimal DOM element: enough for the chart overlay (legend, ticks, labels) and the tooltip. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  parentElement: FakeEl | null = null;
  className = '';
  classList = { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false };
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
  replaceChildren(): void {
    this.children = [];
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

function mockBackend(calls: Calls, hit: () => Float64Array, labels: () => Float64Array): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_theme_river_chart: record('set_theme_river_chart', 9),
    set_area_chart: record('set_area_chart', 9),
    set_line_chart: record('set_line_chart', 9),
    set_line_chart_xy: record('set_line_chart_xy', 9),
    set_line_series_styles: record('set_line_series_styles'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    chart_theme_river_labels: () => labels(),
    chart_hover_at_ndc: () => hit(),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
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

const DATA: ThemeRiverDatum[] = [
  [2, 3, 'B'],
  [0, 1, 'A'],
  [1, 2, 'A'],
  [0, 4, 'B'],
  [1, 5, 'C'],
  [1, 1, 'C'],
];

type RiverArgs = [Float32Array, Uint32Array, Float64Array, Float32Array, Float32Array, number, number, number, number, number, number];

describe('ThemeRiver charts', () => {
  let body: FakeEl;
  let container: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    body = new FakeEl('body');
    container = new FakeEl('div');
    canvas = container.appendChild(new FakeEl('canvas'));
    vi.stubGlobal('document', { body, head: new FakeEl('head'), createElement: (tag: string) => new FakeEl(tag), getElementById: () => null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('groups [x, value, name] rows into aligned streams (first-seen order, x union, missing = 0)', () => {
    const spec = themeRiverSeries(DATA, undefined);
    expect(spec.series.map((s) => s.name)).toEqual(['B', 'A', 'C']);
    expect(spec.x).toEqual([0, 1, 2]);
    // Rows sharing x and name are summed
    expect(spec.series.map((s) => Array.from(s.values))).toEqual([
      [4, 0, 3],
      [1, 2, 0],
      [0, 6, 0],
    ]);
    expect(spec.series.every((s) => s.curve === 'monotone')).toBe(true);
    expect(spec.time).toBe(false);
    expect(spec.meta).toEqual({ offset: 0, order: 0, labels: { show: true, minHeight: 12 } });

    const t = themeRiverSeries(
      [
        ['2026/01/02', 1, 'a'],
        [new Date(2026, 0, 1), 2, 'a'],
      ],
      { offset: 'silhouette', order: 'insideOut', smooth: false, labels: { minHeight: 4 }, colors: { a: '#ff0000' } }
    );
    expect(t.time).toBe(true);
    expect(t.x).toEqual([new Date(2026, 0, 1).getTime(), Date.parse('2026/01/02')]);
    expect(t.series[0]).toMatchObject({ curve: 'linear', color: '#ff0000' });
    expect(t.meta).toEqual({ offset: 1, order: 1, labels: { show: true, minHeight: 4 } });
    expect(themeRiverSeries([[0, 1, 'a']], { offset: 'zero', labels: false, colors: ['blue'] }).meta.labels.show).toBe(false);
  });

  it('keeps the whole river in the y domain: visible-window autoscale falls back to all data', () => {
    const spec = themeRiverSeries(DATA, undefined);
    // The engine's visible extent scans stream tops only, which would clip the moving baseline
    expect(themeRiverLineOptions({ axes: { y: { autoscale: 'visible' } } }, spec).axes?.y).toMatchObject({ show: false, autoscale: 'all' });
    expect(themeRiverLineOptions({ axes: { y: { autoscale: 'none', min: -5 } } }, spec).axes?.y).toMatchObject({ autoscale: 'none', min: -5 });
    expect(themeRiverLineOptions(undefined, spec).axes?.y).toEqual({ show: false });
  });

  it('rejects negative / non-finite values, bad x, bad rows and unknown layouts', () => {
    expect(() => themeRiverSeries([[0, -1, 'a']], undefined)).toThrow('renderThemeRiverChart: row 0 needs a finite value >= 0');
    expect(() => themeRiverSeries([[0, NaN, 'a']], undefined)).toThrow('finite value');
    expect(() => themeRiverSeries([['not a date', 1, 'a']], undefined)).toThrow('row 0 has an invalid x');
    expect(() => themeRiverSeries([[0, 1] as unknown as ThemeRiverDatum], undefined)).toThrow('row 0 is not [x, value, name]');
    expect(() => themeRiverSeries([], { offset: 'expand' as never })).toThrow("unknown offset 'expand'");
    expect(() => themeRiverSeries([], { order: 'reverse' as never })).toThrow("unknown order 'reverse'");
  });

  it('sends aligned streams, layout codes and the time x kind to the engine', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    const res = sdk.renderThemeRiverChart(DATA, { order: 'insideOut', offset: 'zero' });
    expect(res).toEqual({ totalPoints: 9, seriesCount: 3 });
    expect(calls.set_area_chart).toBeUndefined();
    const [values, lengths, xs, , widths, , , opacity, xKind, offset, order] = calls.set_theme_river_chart[0] as RiverArgs;
    expect(Array.from(values)).toEqual([4, 0, 3, 1, 2, 0, 0, 6, 0]);
    expect(Array.from(lengths)).toEqual([3, 3, 3]);
    expect(Array.from(xs)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    expect(Array.from(widths)).toEqual([1, 1, 1]);
    expect([opacity, xKind, offset, order]).toEqual([0.85, 0, 2, 1]);
    // Smooth edges by default (monotone curve in the line styles)
    expect(calls.set_line_series_styles).toHaveLength(1);

    sdk.renderThemeRiverChart([[new Date(Date.UTC(2026, 0, 1)), 1, 'a']], { fillOpacity: 0.5 });
    const [, , xs2, , , , , opacity2, xKind2, offset2, order2] = calls.set_theme_river_chart[1] as RiverArgs;
    expect([xs2[0], opacity2, xKind2, offset2, order2]).toEqual([Date.UTC(2026, 0, 1), 0.5, 1, 0, 0]);

    const bare = mockBackend({}, () => new Float64Array(0), () => new Float64Array(0));
    delete bare.set_theme_river_chart;
    expect(() => Charturbo.fromBackend(bare).renderThemeRiverChart(DATA)).toThrow('backend does not support ThemeRiver');
  });

  it('tooltip lists every stream at x with the total; legend toggles reach the engine', () => {
    const calls: Calls = {};
    // Pointer over stream C (primary) at x = 1: [series, index, value, id]
    const hit = new Float64Array([0, 2, 3, 0, 1, 0, 1, 1, 1, 2, 4, 2, 1, 6, 7]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    sdk.renderThemeRiverChart(DATA);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect(c.chartType).toBe('themeRiver');
    expect(c.areaMode).toBeUndefined();
    expect(c.items.map((i) => [i.seriesName, i.value])).toEqual([
      ['B', 0],
      ['A', 2],
      ['C', 6],
    ]);
    expect(c.details?.id).toBe(7);
    expect(c.total).toBe(8);
    expect(c.xLabel).toBe('1');

    sdk.setSeriesVisible(0, false);
    expect(calls.set_chart_series_visible.at(-1)).toEqual([0, false]);
  });

  it('labels the left end of each visible stream, skipping thin and overlapping ones', () => {
    // [revision, count, (series, x, y, height) * count]
    let labels = new Float64Array([1, 4, 0, 60, 100, 40, 1, 60, 108, 30, 2, 60, 200, 5, 3, 60, 300, 50]);
    const sdk = Charturbo.fromBackend(mockBackend({}, () => new Float64Array(0), () => labels));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderThemeRiverChart([...DATA, [0, 1, 'D']]);
    sdk.render();
    const shown = () =>
      container
        .querySelectorAll('.charturbo-sdk-theme-river-label')
        .filter((el) => el.style.display !== 'none')
        .map((el) => [el.textContent, el.style.left, el.style.top]);
    // Stream 1 overlaps the thicker stream 0, stream 2 is thinner than 12 px
    expect(shown()).toEqual([
      ['D', '64px', '300px'],
      ['B', '64px', '100px'],
    ]);
    labels = new Float64Array([2, 1, 1, 60, 150, 40]);
    sdk.render();
    expect(shown()).toEqual([['A', '64px', '150px']]);

    sdk.renderThemeRiverChart(DATA, { labels: false });
    sdk.render();
    expect(container.querySelectorAll('.charturbo-sdk-theme-river-labels')).toHaveLength(0);
  });

  it('a11y names the chart a ThemeRiver and keeps stacked totals', () => {
    const meta = {
      kind: 'line',
      names: ['A', 'B'],
      colors: [],
      values: [new Float32Array([1, 2]), new Float32Array([3, 4])],
      offsets: [0, 2],
      visible: [true, true],
      xPrefix: 'T',
      xs: null,
      area: 'stacked',
      themeRiver: { offset: 0, order: 0, labels: { show: true, minHeight: 12 } },
    };
    const model = buildA11yModel(meta, { xAxis: {}, yAxis: {}, legend: { show: true } } as never);
    expect(model?.kind === 'line' && model.themeRiver).toBe(true);
    expect(buildChartSummary(model!)).toMatch(/^ThemeRiver chart, 2 series/);
    // Keyboard tooltip: same chart type and column total as the pointer tooltip
    const k = tooltipContext(model!, { series: 1, index: 1 }, new Float64Array(0), () => null);
    expect(k.chartType).toBe('themeRiver');
    expect(k.areaMode).toBeUndefined();
    expect(k.total).toBe(6);
  });
});
