import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VIZ_THEMES,
  VizEngineSDK,
  type ChartTooltipContext,
  type WasmVizEngineBackend,
} from '../sdk/viz-engine-sdk';
import { comboMeta, drawnAxes, encodeCombo, type ComboChartData } from '../sdk/chart-combo';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, keyboardHelp, pointAnnouncement } from '../sdk/chart-a11y';
import { renderChartSpec } from '../sdk/chart-binding';

// The SDK suites below replace the DOM-heavy a11y layer; the a11y helpers are imported unmocked
// through `vi.importActual` for the model tests.
vi.mock('../sdk/chart-a11y', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sdk/chart-a11y')>();
  return {
    ...actual,
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
  };
});

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

function mockBackend(calls: Calls, hit: () => Float64Array, axes: () => Float64Array): WasmVizEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let axesRevision = 0;
  return {
    set_combo_chart: record('set_combo_chart', 12),
    set_line_series_styles: record('set_line_series_styles', true),
    chart_combo_y_domain: (axis: number) => new Float64Array(axis === 0 ? [0, 50] : [0.1, 0.3]),
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
function hitOf(primary: number, items: [number, number, number, number][]): Float64Array {
  return new Float64Array([0, primary, items.length, ...items.flat()]);
}

const DATA: ComboChartData = {
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Revenue', type: 'bar', values: [10, 20, 30, 40] },
    { name: 'Cost', type: 'bar', values: new Float32Array([5, 5, 10, 10]) },
    { name: 'Margin', type: 'line', values: [0.12, 0.18, null as unknown as number, 0.3], yAxis: 'right', marker: true, dash: [4, 2] },
    { name: 'Trend', type: 'area', values: [8, 16, 24, 32], curve: 'monotone' },
  ],
};

describe('encodeCombo', () => {
  it('flattens series, kinds, axes, colors, layout and y domain options', () => {
    const palette = VIZ_THEMES.dark.palette;
    const enc = encodeCombo(DATA, { barMode: 'stacked', groupGap: 0.4, axes: { y: { min: 0 }, y2: { max: 1, nice: false } } }, palette, VIZ_THEMES.dark.baseline);
    expect(enc.n).toBe(4);
    expect(Array.from(enc.values.slice(0, 8))).toEqual([10, 20, 30, 40, 5, 5, 10, 10]);
    expect(Number.isNaN(enc.values[10])).toBe(true); // null = missing
    expect(Array.from(enc.kinds)).toEqual([0, 0, 1, 2]);
    expect(Array.from(enc.axes)).toEqual([0, 0, 1, 0]);
    expect(Array.from(enc.colors.slice(8, 12))).toEqual(Array.from(new Float32Array(palette[2])));
    expect(enc.x.length).toBe(0);
    expect(enc.layout[2]).toBe(1); // stacked
    expect(enc.layout[3]).toBeCloseTo(0.4);
    expect(enc.layout[7]).toBe(0); // no time x
    expect(Array.from(enc.yAxes.slice(0, 1))).toEqual([0]);
    expect(Number.isNaN(enc.yAxes[1])).toBe(true);
    expect([enc.yAxes[2], enc.yAxes[4], enc.yAxes[5]]).toEqual([1, 1, 0]);
    // Line styles go to the engine in line-local order (bars excluded)
    expect(enc.lineSeries.map((s) => s.name)).toEqual(['Margin', 'Trend']);
  });

  it('accepts Date x as a time axis and rejects bad input', () => {
    const t0 = Date.UTC(2026, 0, 1);
    const day = 86_400_000;
    const enc = encodeCombo(
      { x: [new Date(t0), new Date(t0 + day)], series: [{ name: 'a', type: 'bar', values: [1, 2] }] },
      undefined,
      VIZ_THEMES.dark.palette,
      VIZ_THEMES.dark.baseline
    );
    expect(Array.from(enc.x)).toEqual([t0, t0 + day]);
    expect(enc.timeX).toBe(true);
    expect(enc.layout[7]).toBe(1);
    expect(() =>
      encodeCombo({ series: [{ name: 'a', type: 'pie' as never, values: [1] }] }, undefined, [], [0, 0, 0, 1])
    ).toThrow(/unknown type 'pie'/);
    expect(() =>
      encodeCombo({ categories: ['a'], x: [1], series: [] }, undefined, [], [0, 0, 0, 1])
    ).toThrow(/not both/);
    // Fixed palette order: series past the palette get the neutral color
    const many = encodeCombo(
      { categories: ['a'], series: Array.from({ length: 3 }, (_, k) => ({ name: `s${k}`, type: 'bar' as const, values: [k] })) },
      undefined,
      [[1, 0, 0, 1]],
      [0.5, 0.5, 0.5, 1]
    );
    expect(many.rgba[2]).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it('mirrors the engine axis rules', () => {
    expect(drawnAxes(['bar', 'bar', 'line'], [1, 0, 0])).toEqual([1, 1, 0]);
    expect(drawnAxes(['line', 'line'], [1, 1])).toEqual([0, 0]);
    expect(drawnAxes(['bar', 'bar'], [1, 0])).toEqual([0, 0]);
  });
});

describe('Combo charts (SDK)', () => {
  let body: FakeEl;
  let container: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    body = new FakeEl('body');
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

  it('uploads the series, line styles, and builds legend, axes and details', () => {
    const calls: Calls = {};
    let axes = new Float64Array(0);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const res = sdk.renderComboChart(DATA, { barMode: 'stacked', title: 'Revenue', axes: { y2: { title: 'Margin' } } });
    expect(res).toEqual({ seriesCount: 4, categoryCount: 4, pointCount: 12 });
    const [values, count, kinds, seriesAxes, , widths, x, layout] = calls.set_combo_chart[0] as [
      Float32Array, number, Uint8Array, Uint8Array, Float32Array, Float32Array, Float64Array, Float32Array,
    ];
    expect([values.length, count, x.length, layout[2]]).toEqual([16, 4, 0, 1]);
    expect(Array.from(kinds)).toEqual([0, 0, 1, 2]);
    expect(Array.from(seriesAxes)).toEqual([0, 0, 1, 0]);
    expect(Array.from(widths)).toEqual([2, 2, 2, 2]);
    // 2 line-local style records (18 floats each): Margin marker + dash, Trend monotone curve
    const styles = calls.set_line_series_styles[0][0] as Float32Array;
    expect(styles.length).toBe(36);
    expect(styles[0]).toBe(0); // circle marker
    expect([styles[12], styles[13]]).toEqual([4, 2]);
    expect(styles[18 + 16]).toBe(4); // monotone
    // Title + legend on top, right axis margin
    expect(calls.set_chart_padding.at(-1)).toEqual([64, 76, 30, 56]);
    expect(sdk.handlesChartNavigation()).toBe(true);
    sdk.setChartBrush('x');
    expect(sdk.handlesChartBrush()).toBe(false);
    expect(sdk.getYDomain()).toEqual([0, 50]);
    expect(sdk.getY2Domain()).toEqual([0.1, 0.3]);

    // Legend swatches follow the mark: bar square, line stroke, area block
    const items = container.querySelectorAll('.viz-sdk-legend-item');
    expect(items.map((i) => i.children[1].textContent)).toEqual(['Revenue', 'Cost', 'Margin', 'Trend']);
    expect(items.map((i) => i.children[0].style.height)).toEqual(['10px', '10px', '3px', '8px']);
    items[1].fire('click');
    expect(calls.set_chart_series_visible).toEqual([[1, false]]);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    items[2].fire('pointerenter');
    expect(calls.set_chart_emphasis).toEqual([[2]]);

    // Point ids = series * categories + category
    const d = sdk.getNodeDetails(2 * 4 + 1);
    expect(d?.label).toBe('Margin · Q2');
    expect(d?.metadata.attributes).toEqual({ series: 'Margin', type: 'line', axis: 'right', category: 'Q2', value: 0.18 });
    expect(sdk.getNodeDetails(16)).toBeNull();

    // Category x labels; right-axis ticks use the y2 options
    axes = new Float64Array([56, 64, 600, 300, 3, 0, 2, 400, 364, 1, 50, 56, 200, 2, 0.2, 656, 200]);
    sdk.render();
    const ticks = container.querySelectorAll('.viz-sdk-axis-tick').map((t) => t.textContent);
    expect(ticks).toEqual(['Q3', '50', '0.2']);
  });

  it('tooltip lists bars and lines at the hovered category', () => {
    const calls: Calls = {};
    const hit = hitOf(1, [
      [0, 2, 30, 2],
      [1, 2, 10, 6],
      [2, 2, 0.15, 10],
    ]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    sdk.renderComboChart(DATA);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect(c.chartType).toBe('combo');
    expect(c.xLabel).toBe('Q3');
    expect(c.items.map((i) => [i.seriesName, i.value])).toEqual([
      ['Revenue', 30],
      ['Cost', 10],
      ['Margin', 0.15],
    ]);
    expect(c.details?.label).toBe('Cost · Q3');

    // Default tooltip renders one row per series; `shared: false` keeps the primary only
    const sdk2 = VizEngineSDK.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    sdk2.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { tooltip: { shared: false } });
    sdk2.renderComboChart(DATA);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const tips = body.querySelectorAll('.viz-sdk-node-tooltip');
    const html = tips[tips.length - 1].innerHTML;
    expect(html).toContain('Cost');
    expect(html).not.toContain('Margin');
  });

  it('numeric x labels the tooltip with the formatted x', () => {
    const calls: Calls = {};
    const hit = hitOf(0, [[0, 1, 2, 1]]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { formatChartTooltip: (c) => ((ctx = c), '') });
    sdk.renderComboChart(
      { x: [2000, 2010, 2020], series: [{ name: 'a', type: 'bar', values: [1, 2, 3] }, { name: 'b', type: 'line', values: [3, 2, 1] }] },
      { axes: { x: { format: (v) => `Y${v}` } } }
    );
    expect(Array.from((calls.set_combo_chart[0] as unknown[])[6] as Float64Array)).toEqual([2000, 2010, 2020]);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect([c.xLabel, c.x]).toEqual(['Y2010', 2010]);
  });

  it('dispatches through the framework binding', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    renderChartSpec(sdk, { type: 'combo', data: DATA, options: { barMode: 'grouped' } });
    expect(calls.set_combo_chart.length).toBe(1);
  });
});

describe('Combo chart a11y model', () => {
  const formatX = (v: number) => String(v);
  const enc = encodeCombo(DATA, undefined, VIZ_THEMES.dark.palette, VIZ_THEMES.dark.baseline);
  const meta = comboMeta(enc, DATA, 'stacked', formatX);
  const pres = { title: 'Quarterly', xAxis: { title: 'Quarter' }, yAxis: { title: 'USD' }, y2Axis: { title: 'Margin' } };
  const model = buildA11yModel(meta, pres)!;

  it('models rows = categories and one column per series', () => {
    expect(model.kind).toBe('combo');
    expect(model.length).toBe(4);
    expect(model.pointId(2, 1)).toBe(9);
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Quarter', 'Revenue', 'Cost', 'Margin', 'Trend']);
    expect(table.rows[2]).toEqual(['Q3', 30, 10, null, 24]);
    expect(table.rows[1][3]).toBeCloseTo(0.18);
  });

  it('summarizes kinds, axes, and announces focused points', () => {
    const summary = buildChartSummary(model);
    expect(summary).toContain('Quarterly. Combo chart, 4 categories, 4 series (bars: Revenue, Cost; line: Margin; area: Trend), two y axes');
    expect(summary).toContain('Revenue ranges 10–40');
    const desc = buildChartDescription(model);
    expect(desc).toContain('Left y axis: USD.');
    expect(desc).toContain('Right y axis: Margin.');
    expect(desc).toContain('bars stacked');
    expect(desc).toContain('Margin (line, right axis): highest Q4 0.3');
    expect(desc).toContain(keyboardHelp('combo'));
    expect(keyboardHelp('combo')).toContain('categories');
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('Q3, Revenue (bars, left axis) 30. 3 of 4.');
  });
});
