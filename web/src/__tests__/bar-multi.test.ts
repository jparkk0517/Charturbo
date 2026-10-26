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

function mockBackend(calls: Calls, hit: () => Float64Array, axes: () => Float64Array): WasmVizEngineBackend {
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

const DATA = {
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'North', values: [10, 20, 30, 40] },
    { name: 'South', values: new Float32Array([5, -5, 15, 25]) },
    { name: 'West', values: [1, 2] }, // short: padded with NaN
  ],
};

describe('Multi-series bar charts (grouped / stacked / percent)', () => {
  let body: FakeEl;
  let container: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    body = new FakeEl('body');
    container = new FakeEl('div');
    canvas = container.appendChild(new FakeEl('canvas'));
    const head = new FakeEl('head');
    const byId = (id: string, root: FakeEl): FakeEl | null => {
      for (const c of root.children) {
        if (c.attrs.id === id || (c as unknown as { id?: string }).id === id) return c;
        const hit = byId(id, c);
        if (hit) return hit;
      }
      return null;
    };
    vi.stubGlobal('document', {
      body,
      head,
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: (id: string) => byId(id, head) ?? byId(id, body),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends flat series values to the engine and builds metadata, legend, and axes', () => {
    const calls: Calls = {};
    let axes = new Float64Array(0);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);

    const res = sdk.renderGroupedBarChart(DATA, { mode: 'stacked', barGap: 3, title: 'Revenue' });
    expect(res).toEqual({ barCount: 12, seriesCount: 3, categoryCount: 4 });
    const [values, seriesCount, colors, mode, , , barWidth, radius, groupGap, gapPx, viewMode] = calls
      .set_bar_chart_multi[0] as [
      Float32Array, number, Float32Array, number, number, number, number, number, number, number, number,
    ];
    expect(Array.from(values.slice(0, 8))).toEqual([10, 20, 30, 40, 5, -5, 15, 25]);
    expect(Array.from(values.slice(8, 10))).toEqual([1, 2]);
    expect(Number.isNaN(values[10]) && Number.isNaN(values[11])).toBe(true);
    expect(seriesCount).toBe(3);
    expect(Array.from(colors.slice(4, 8))).toEqual(Array.from(new Float32Array(VIZ_THEMES.dark.palette[1])));
    expect([mode, barWidth, radius, gapPx, viewMode]).toEqual([1, 0, 4, 3, 0]);
    expect(Number.isNaN(groupGap)).toBe(true); // engine default
    // Title (24) + legend (28) on top
    expect(calls.set_chart_padding.at(-1)).toEqual([64, 16, 30, 56]);
    expect(sdk.handlesChartNavigation()).toBe(false);

    // Point ids = series * categories + category
    const d = sdk.getNodeDetails(1 * 4 + 2);
    expect(d?.label).toBe('South · Q3');
    expect(d?.metadata.attributes).toEqual({ series: 'South', category: 'Q3', value: 15 });
    expect(d?.clusterId).toBe(1);
    expect(sdk.getNodeDetails(12)).toBeNull();

    // Category labels on the x axis
    axes = new Float64Array([56, 64, 700, 300, 2, 0, 2, 400, 364, 1, 50, 56, 200]);
    sdk.render();
    const ticks = container.querySelectorAll('.viz-sdk-axis-tick').map((t) => t.textContent);
    expect(ticks).toEqual(['Q3', '50']);
  });

  it('legend toggles and emphasizes bar series through the engine', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderGroupedBarChart(DATA, { mode: 'grouped' });

    const items = container.querySelectorAll('.viz-sdk-legend-item');
    expect(items.map((i) => i.children[1].textContent)).toEqual(['North', 'South', 'West']);
    expect(items[0].children[0].style.height).toBe('10px'); // square bar swatch
    items[1].fire('click');
    expect(calls.set_chart_series_visible).toEqual([[1, false]]);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    expect(items[1].attrs['aria-pressed']).toBe('false');
    items[1].fire('click');
    expect(sdk.isSeriesVisible(1)).toBe(true);
    items[2].fire('pointerenter');
    items[2].fire('pointerleave');
    expect(calls.set_chart_emphasis).toEqual([[2], [-1]]);
    sdk.setSeriesVisible(5, false); // out of range: ignored
    expect(calls.set_chart_series_visible.length).toBe(2);

    // Legend can be turned off; single-series bars have no series to toggle
    sdk.renderGroupedBarChart(DATA, { legend: false });
    expect(container.querySelectorAll('.viz-sdk-legend-item').length).toBe(0);
    expect(calls.set_chart_padding.at(-1)).toEqual([12, 16, 30, 56]);
    sdk.renderBarChart([{ label: 'A', value: 1 }]);
    sdk.setSeriesVisible(0, false);
    expect(calls.set_chart_series_visible.length).toBe(2);
    expect(calls.set_bar_chart.length).toBe(1);
  });

  it('stacked tooltip lists the whole column with its total; grouped shows the hovered bar', () => {
    const calls: Calls = {};
    let hit = hitOf(1, [
      [0, 2, 30, 2],
      [1, 2, 15, 6],
    ]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    sdk.renderGroupedBarChart(DATA, { mode: 'stacked' });
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect(c.chartType).toBe('bar');
    expect(c.xLabel).toBe('Q3');
    expect(c.items.map((i) => [i.seriesName, i.value])).toEqual([
      ['North', 30],
      ['South', 15],
    ]);
    expect(c.total).toBe(45);
    expect(c.details?.label).toBe('South · Q3'); // primary = segment under the pointer

    sdk.renderGroupedBarChart(DATA, { mode: 'grouped' });
    hit = hitOf(0, [[2, 1, 2, 9]]);
    canvas.fire('pointermove', { clientX: 410, clientY: 200, buttons: 0 });
    const g = ctx as unknown as ChartTooltipContext;
    expect(g.items.length).toBe(1);
    expect(g.total).toBeUndefined();
    expect(g.details?.label).toBe('West · Q2');
  });

  it('percent mode reports shares and formats the value axis in percent', () => {
    const calls: Calls = {};
    const hit = hitOf(0, [
      [0, 0, 10, 0],
      [1, 0, 5, 4],
      [2, 0, -5, 8],
    ]);
    let axes = new Float64Array(0);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => hit, () => axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderGroupedBarChart(DATA, { mode: 'percent' });
    expect(calls.set_bar_chart_multi[0][3]).toBe(2);

    canvas.fire('pointermove', { clientX: 100, clientY: 200, buttons: 0 });
    const tooltip = body.querySelectorAll('.viz-sdk-node-tooltip')[0];
    expect(tooltip.innerHTML).toContain('50.0%');
    expect(tooltip.innerHTML).toContain('25.0%');
    expect(tooltip.innerHTML).not.toContain('Total');

    axes = new Float64Array([56, 40, 700, 300, 1, 1, 60, 56, 100]);
    sdk.render();
    expect(container.querySelectorAll('.viz-sdk-axis-tick')[0].textContent).toBe('60%');
  });

  it('3D view sends only the first series and hides the legend', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const res = sdk.renderGroupedBarChart(DATA, { viewMode: '3d', mode: 'stacked' });
    expect(res).toEqual({ barCount: 4, seriesCount: 1, categoryCount: 4 });
    const [values, seriesCount, , , , , , , , , viewMode] = calls.set_bar_chart_multi[0] as [
      Float32Array, number, Float32Array, number, number, number, number, number, number, number, number,
    ];
    expect(values.length).toBe(4);
    expect([seriesCount, viewMode]).toEqual([1, 1]);
    expect(container.querySelectorAll('.viz-sdk-legend-item').length).toBe(0);
    expect(sdk.renderGroupedBarChart({ categories: [], series: [] }).barCount).toBe(0);
  });
});
