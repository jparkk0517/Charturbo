import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  VIZ_THEMES,
  VizEngineSDK,
  type ChartTooltipContext,
  type WasmVizEngineBackend,
} from '../sdk/viz-engine-sdk';
import { barErrorOf, barLabelTexts, encodeErrors, formatBarError, resolveBarLabels, type BarStyleState } from '../sdk/chart-bar-style';

// The a11y layer (canvas ARIA, live region, data table) has its own tests and needs a full DOM;
// this suite only checks bar layout / legend wiring, so it is replaced by an inert stand-in.
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

function mockBackend(
  calls: Calls,
  hit: () => Float64Array,
  axes: () => Float64Array,
  labels: () => Float64Array = () => new Float64Array(0)
): WasmVizEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let axesRevision = 0;
  return {
    set_bar_chart: record('set_bar_chart', 4),
    set_bar_chart_multi: record('set_bar_chart_multi', 12),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    set_bar_style: record('set_bar_style', true),
    set_bar_labels: record('set_bar_labels', true),
    chart_bar_labels: () => labels(),
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
  return new Float64Array([1, primary, items.length, ...items.flat()]);
}

const ITEMS = [
  { label: 'Alpha', value: 12, error: 2 },
  { label: 'Beta', value: -4, error: [1, 3] as [number, number] },
  { label: 'A much longer category', value: NaN },
];

const DATA = {
  categories: ['Q1', 'Q2'],
  series: [
    { name: 'North', values: [30, 10], error: [5, null] },
    { name: 'South', values: [10, 30] },
  ],
};

describe('chart-bar-style helpers', () => {
  it('resolves label options', () => {
    expect(resolveBarLabels(undefined)).toBeNull();
    expect(resolveBarLabels(false)).toBeNull();
    expect(resolveBarLabels({ show: false })).toBeNull();
    expect(resolveBarLabels(true)).toMatchObject({ mode: 1, position: 'outside' });
    expect(resolveBarLabels('auto')).toMatchObject({ mode: 2 });
    const r = resolveBarLabels({ position: 'insideBase', color: '#ff0000' });
    expect(r).toMatchObject({ mode: 1, position: 'insideBase', color: [1, 0, 0, 1] });
    expect(resolveBarLabels({ position: 'bogus' as never })?.position).toBe('outside');
  });

  it('encodes symmetric / asymmetric errors by bar id', () => {
    expect(encodeErrors([undefined, []], 3)).toEqual([null, null]);
    const [m, p] = encodeErrors([[2, [1, 3], null], undefined], 3) as [Float32Array, Float32Array];
    expect(m.length).toBe(6);
    expect([m[0], p[0], m[1], p[1]]).toEqual([2, 2, 1, 3]);
    expect(Number.isNaN(m[2]) && Number.isNaN(p[5])).toBe(true);
    const state: BarStyleState = { orientation: 'vertical', labels: null, errMinus: m, errPlus: p, errorBar: {}, texts: [] };
    expect(barErrorOf({ ...state }, 1)).toEqual([1, 3]);
    expect(barErrorOf({ ...state }, 2)).toBeUndefined();
    expect(formatBarError([2, 2], String)).toBe('±2');
    expect(formatBarError([1, 3], String)).toBe('+3 / −1');
  });

  it('formats label text: default, Intl spec, function, percent shares', () => {
    const src = {
      values: new Float32Array([1, 3, NaN, 1]),
      categories: 2,
      seriesCount: 2,
      percent: false,
      visible: [true, true],
      seriesName: (s: number) => ['A', 'B'][s],
      categoryLabel: (i: number) => ['x', 'y'][i],
      locale: 'en-US',
    };
    expect(barLabelTexts(resolveBarLabels(true)!, src)).toEqual(['1', '3', '', '1']);
    expect(barLabelTexts(resolveBarLabels({ format: { minimumFractionDigits: 1 } })!, src)).toEqual(['1.0', '3.0', '', '1.0']);
    // Spec strings (validated up front)
    expect(barLabelTexts(resolveBarLabels({ format: '.1f' })!, src)).toEqual(['1.0', '3.0', '', '1.0']);
    expect(() => resolveBarLabels({ format: 'nope' })).toThrow(TypeError);
    // No label format: the value axis format
    expect(barLabelTexts(resolveBarLabels(true)!, { ...src, valueFormat: (v) => `$${v}` })).toEqual(['$1', '$3', '', '$1']);
    const fn = barLabelTexts(resolveBarLabels({ format: (v, c) => `${c.seriesName}/${c.categoryLabel}=${v}` })!, src);
    expect(fn).toEqual(['A/x=1', 'A/y=3', '', 'B/y=1']);
    // Percent: share of the category's visible absolute sum; hidden series have no text
    const pct = barLabelTexts(resolveBarLabels(true)!, { ...src, percent: true });
    expect(pct).toEqual(['100%', '75%', '', '25%']);
    expect(barLabelTexts(resolveBarLabels(true)!, { ...src, percent: true, visible: [true, false] })).toEqual(['100%', '100%', '', '']);
  });
});

describe('Bar styling through the SDK (orientation, labels, error bars, legend)', () => {
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

  it('plain bar charts send no styling', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.renderBarChart(ITEMS.map(({ label, value }) => ({ label, value })));
    sdk.renderGroupedBarChart({ categories: DATA.categories, series: DATA.series.map(({ name, values }) => ({ name, values })) });
    expect(calls.set_bar_style).toBeUndefined();
    expect(calls.set_bar_labels).toBeUndefined();
  });

  it('horizontal bars: value axis on x, category labels on y, wider left margin, no brush', () => {
    const calls: Calls = {};
    let axes = new Float64Array(0);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { brush: 'x' });
    sdk.renderBarChart(ITEMS, { orientation: 'horizontal', axes: { x: { title: 'Score' } } });
    const [orientation, minus, plus, color] = calls.set_bar_style[0] as [number, Float32Array, Float32Array, Float32Array];
    expect(orientation).toBe(1);
    expect([minus[0], plus[0], minus[1], plus[1]]).toEqual([2, 2, 1, 3]);
    expect(color.length).toBe(4);
    // Left margin sized to the longest (truncated) category label, more than the default 56
    const [top, right, bottom, left] = calls.set_chart_padding.at(-1) as number[];
    expect([top, right]).toEqual([12, 16]);
    expect(bottom).toBe(50); // axis labels + x title
    expect(left).toBeGreaterThan(56);
    expect(sdk.handlesChartBrush()).toBe(false);

    // axis 0 = value ticks (numbers), axis 1 = categories
    axes = new Float64Array([90, 12, 600, 300, 2, 0, 1500, 400, 312, 1, 2, 90, 200]);
    sdk.render();
    const ticks = container.querySelectorAll('.viz-sdk-axis-tick').map((t) => t.textContent);
    expect(ticks).toEqual(['1,500', 'A much long…']);

    // Vertical charts keep the brush and default margins
    sdk.renderBarChart(ITEMS);
    expect(sdk.handlesChartBrush()).toBe(true);
    expect(calls.set_bar_style.length).toBe(2); // errors only
    expect(calls.set_bar_style[1][0]).toBe(0);
  });

  it('horizontal grouped percent bars format the x axis in percent', () => {
    const calls: Calls = {};
    let axes = new Float64Array(0);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderGroupedBarChart(DATA, { mode: 'percent', orientation: 'horizontal' });
    axes = new Float64Array([56, 40, 700, 300, 2, 0, 60, 400, 340, 1, 1, 56, 120]);
    sdk.render();
    expect(container.querySelectorAll('.viz-sdk-axis-tick').map((t) => t.textContent)).toEqual(['60%', 'Q2']);
  });

  it('data labels: measured texts go to the engine, DOM labels sit at its anchors', () => {
    const calls: Calls = {};
    let labels = new Float64Array([1, 2, 0, 100, 50, 0, 1, 200, 80, 1]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0), () => labels));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderBarChart(ITEMS, { labels: { show: 'auto', position: 'inside' }, color: '#fde047' });
    const [mode, position, widths, height] = calls.set_bar_labels[0] as [number, number, Float32Array, number];
    expect([mode, position, height]).toEqual([2, 1, 14]);
    expect(widths.length).toBe(3);
    expect(widths[0]).toBeGreaterThan(0);
    expect(Number.isNaN(widths[2])).toBe(true); // missing value: no label
    // Outside labels on vertical bars reserve room above the plot
    expect(calls.set_chart_padding.at(-1)?.[0]).toBe(12);
    sdk.render();
    const els = container.querySelectorAll('.viz-sdk-bar-label');
    expect(els.map((e) => [e.textContent, e.style.left, e.style.top])).toEqual([
      ['12', '100px', '50px'],
      ['-4', '200px', '80px'],
    ]);
    // Outside: theme text token; inside: dark text on the light yellow bar
    expect(els[0].style.color).toBe(VIZ_THEMES.dark.textSecondary);
    expect(els[1].style.color).toBe('#0b0b0b');
    // Same revision: untouched; fewer anchors hide the rest
    els[0].style.left = 'x';
    sdk.render();
    expect(els[0].style.left).toBe('x');
    labels = new Float64Array([2, 1, 1, 10, 20, 0]);
    sdk.render();
    expect(els.map((e) => e.style.display)).toEqual(['block', 'none']);
    expect(els[0].textContent).toBe('-4');

    // Outside position on vertical bars: extra top padding
    sdk.renderBarChart(ITEMS, { labels: true });
    expect(calls.set_chart_padding.at(-1)?.[0]).toBe(28);
    expect(calls.set_bar_labels.at(-1)?.[1]).toBe(0);
  });

  it('percent labels follow legend toggles', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderGroupedBarChart(DATA, { mode: 'percent', labels: { color: [1, 1, 1, 1] } });
    const widthsOf = () => Array.from(calls.set_bar_labels.at(-1)?.[2] as Float32Array).map((w) => Number.isFinite(w));
    expect(widthsOf()).toEqual([true, true, true, true]);
    sdk.setSeriesVisible(1, false);
    expect(calls.set_bar_labels.length).toBe(2);
    expect(widthsOf()).toEqual([true, true, false, false]);
  });

  it('tooltips show the error next to the value', () => {
    const calls: Calls = {};
    let hit = hitOf(0, [[0, 1, -4, 1]]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    sdk.renderBarChart(ITEMS);
    canvas.fire('pointermove', { clientX: 100, clientY: 100, buttons: 0 });
    expect((ctx as unknown as ChartTooltipContext).items[0].error).toEqual([1, 3]);

    // Default tooltip: ± text; grouped bars carry their series' errors
    const sdk2 = VizEngineSDK.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    const canvas2 = container.appendChild(new FakeEl('canvas'));
    sdk2.enableNodeInteractions(canvas2 as unknown as HTMLCanvasElement);
    sdk2.renderGroupedBarChart(DATA);
    hit = hitOf(0, [[0, 0, 30, 0]]);
    canvas2.fire('pointermove', { clientX: 100, clientY: 100, buttons: 0 });
    const tooltip = body.querySelectorAll('.viz-sdk-node-tooltip').at(-1)!;
    expect(tooltip.innerHTML).toContain('±5');
    hit = hitOf(0, [[1, 0, 10, 2]]);
    canvas2.fire('pointermove', { clientX: 110, clientY: 100, buttons: 0 });
    expect(tooltip.innerHTML).not.toContain('±');
    // Percent bars draw no error bars: no ± either
    sdk2.renderGroupedBarChart(DATA, { mode: 'percent' });
    hit = hitOf(0, [[0, 0, 30, 0]]);
    canvas2.fire('pointermove', { clientX: 120, clientY: 100, buttons: 0 });
    expect(body.querySelectorAll('.viz-sdk-node-tooltip').at(-1)!.innerHTML).not.toContain('±');
  });

  it('single-series legend: hidden by default, one static entry on request', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderBarChart(ITEMS);
    expect(container.querySelectorAll('.viz-sdk-legend-item').length).toBe(0);
    sdk.renderBarChart(ITEMS, { legend: true, seriesName: 'Score', title: 'T' });
    const items = container.querySelectorAll('.viz-sdk-legend-item');
    expect(items.map((i) => i.children[1].textContent)).toEqual(['Score']);
    expect(items[0].tag).toBe('span'); // nothing to toggle
    expect(calls.set_chart_padding.at(-1)?.[0]).toBe(64); // title + legend
    // 3D: no legend
    sdk.renderBarChart(ITEMS, { legend: true, viewMode: '3d' });
    expect(container.querySelectorAll('.viz-sdk-legend-item').length).toBe(0);
  });
});
