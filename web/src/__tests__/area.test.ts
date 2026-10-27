import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Charturbo,
  type ChartTooltipContext,
  type LineSeriesDescriptor,
  type WasmCharturboEngineBackend,
} from '../sdk/charturbo';

// The a11y layer has its own tests and needs a full DOM; replaced by an inert stand-in here.
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

function mockBackend(calls: Calls, hit: () => Float64Array, axes: () => Float64Array): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let axesRevision = 0;
  return {
    set_area_chart: record('set_area_chart', 8),
    set_line_chart: record('set_line_chart', 8),
    set_line_chart_xy: record('set_line_chart_xy', 8),
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

const SERIES: LineSeriesDescriptor[] = [
  { name: 'Search', values: [10, 20, 30] },
  { name: 'Social', values: new Float32Array([5, 15, 10]) },
  { name: 'Direct', values: [-2, 5, 0] },
];

const PERCENT: LineSeriesDescriptor[] = [
  { name: 'A', values: [10, 1] },
  { name: 'B', values: [30, 1] },
  { name: 'C', values: [-2, 1] },
];

describe('Area charts (overlap / stacked / percent)', () => {
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

  type AreaArgs = [
    Float32Array, Uint32Array, Float64Array, Float32Array, Float32Array, number, number, number, number, number,
  ];

  it('sends concatenated series, mode, and fill opacity to the engine (2D, navigable)', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);

    const res = sdk.renderAreaChart(SERIES, { mode: 'stacked', fillOpacity: 0.6, lineWidth: 1.5 });
    expect(res).toEqual({ totalPoints: 9, seriesCount: 3 });
    expect(calls.set_line_chart).toBeUndefined();
    const [values, lengths, xs, , widths, width, height, mode, opacity, xKind] = calls.set_area_chart[0] as AreaArgs;
    expect(Array.from(values)).toEqual([10, 20, 30, 5, 15, 10, -2, 5, 0]);
    expect(Array.from(lengths)).toEqual([3, 3, 3]);
    expect(xs.length).toBe(0); // index placement
    expect(Array.from(widths)).toEqual([1.5, 1.5, 1.5]);
    expect([width, height, mode, opacity, xKind]).toEqual([168, 86, 1, 0.6, 0]);
    expect(sdk.handlesChartNavigation()).toBe(true);
    // Raw values stay the data behind details / a11y (ids = series offset + index)
    expect(sdk.getNodeDetails(3 + 1)?.metadata.attributes?.value).toBe(15);

    // Defaults: overlap mode, engine-default opacity
    sdk.renderAreaChart(SERIES);
    const [, , , , , , , mode2, opacity2] = calls.set_area_chart[1] as AreaArgs;
    expect(mode2).toBe(0);
    expect(Number.isNaN(opacity2)).toBe(true);
    sdk.renderAreaChart(SERIES, { mode: 'percent' });
    expect((calls.set_area_chart[2] as AreaArgs)[7]).toBe(2);

    // Line charts keep their own binding
    sdk.renderLineChart(SERIES);
    expect(calls.set_line_chart.length).toBe(1);
    expect(calls.set_area_chart.length).toBe(3);
  });

  it('time x is sent as epoch ms with the time tick kind; mismatched x is rejected', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    const days = [0, 1, 2].map((d) => new Date(Date.UTC(2026, 0, 1 + d)));
    sdk.renderAreaChart(
      SERIES.map((s) => ({ ...s, x: days })),
      { mode: 'stacked' }
    );
    const [, , xs, , , , , , , xKind] = calls.set_area_chart[0] as AreaArgs;
    expect(xs.length).toBe(9);
    expect(xs[4]).toBe(Date.UTC(2026, 0, 2));
    expect(xKind).toBe(1);
    expect(() => sdk.renderAreaChart([{ ...SERIES[0], x: days }, SERIES[1]])).toThrow(
      'renderAreaChart: give `x` for every series or none'
    );
  });

  it('stacked tooltip lists raw values with their total; overlap has no total', () => {
    const calls: Calls = {};
    let hit = hitOf(1, [
      [0, 1, 20, 1],
      [1, 1, 15, 4],
      [2, 1, 5, 7],
    ]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    sdk.renderAreaChart(SERIES, { mode: 'stacked' });
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect(c.chartType).toBe('line');
    expect(c.areaMode).toBe('stacked');
    expect(c.xLabel).toBe('T+1');
    expect(c.items.map((i) => [i.seriesName, i.value])).toEqual([
      ['Search', 20],
      ['Social', 15],
      ['Direct', 5],
    ]);
    expect(c.total).toBe(40);

    sdk.renderAreaChart(SERIES, { mode: 'overlap' });
    hit = hitOf(0, [[0, 2, 30, 2]]);
    canvas.fire('pointermove', { clientX: 410, clientY: 200, buttons: 0 });
    const o = ctx as unknown as ChartTooltipContext;
    expect(o.areaMode).toBe('overlap');
    expect(o.total).toBeUndefined();
    expect(o.items[0].percent).toBeUndefined();
  });

  it('percent mode shows shares (negatives count as 0) and a percent value axis', () => {
    const calls: Calls = {};
    let hitNow = hitOf(0, [
      [0, 0, 10, 0],
      [1, 0, 30, 3],
      [2, 0, -2, 6],
    ]);
    let axes = new Float64Array(0);
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => hitNow, () => axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    // Column at index 0 of PERCENT: 10 + 30 + (-2 -> 0)
    sdk.renderAreaChart(PERCENT, { mode: 'percent' });

    canvas.fire('pointermove', { clientX: 100, clientY: 200, buttons: 0 });
    const tooltip = body.querySelectorAll('.charturbo-sdk-node-tooltip')[0];
    expect(tooltip.innerHTML).toContain('25.0%');
    expect(tooltip.innerHTML).toContain('75.0%');
    expect(tooltip.innerHTML).toContain('0.0%');
    expect(tooltip.innerHTML).not.toContain('Total');

    // 'nearest' hover returns one item: its share still uses the whole visible column
    sdk.renderAreaChart(SERIES, { mode: 'percent', hover: { mode: 'nearest' } });
    hitNow = hitOf(0, [[1, 1, 15, 4]]); // column at index 1: 20 + 15 + 5
    canvas.fire('pointermove', { clientX: 120, clientY: 200, buttons: 0 });
    expect(tooltip.innerHTML).toContain('37.5%');
    sdk.setSeriesVisible(0, false); // hidden series leave the column: 15 / 20
    canvas.fire('pointermove', { clientX: 130, clientY: 200, buttons: 0 });
    expect(tooltip.innerHTML).toContain('75.0%');

    axes = new Float64Array([56, 40, 700, 300, 1, 1, 60, 56, 100, 0]);
    sdk.render();
    expect(container.querySelectorAll('.charturbo-sdk-axis-tick')[0].textContent).toBe('60%');
  });

  it('legend toggles (engine re-stacks) and emphasizes area series', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderAreaChart(SERIES, { mode: 'stacked' });
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.map((i) => i.children[1].textContent)).toEqual(['Search', 'Social', 'Direct']);
    items[0].fire('click');
    expect(calls.set_chart_series_visible).toEqual([[0, false]]);
    expect(sdk.isSeriesVisible(0)).toBe(false);
    items[2].fire('pointerenter');
    items[2].fire('pointerleave');
    expect(calls.set_chart_emphasis).toEqual([[2], [-1]]);
  });

  it('streamed percent tooltips use retained raw values without copying the whole window', () => {
    const calls: Calls = {};
    const backend = mockBackend(calls, () => hitOf(0, [[1, 1, 30, 3]]), () => new Float64Array(0));
    backend.append_area_data = () => new Uint32Array([2, 2]);
    backend.chart_series_values = vi.fn(() => new Float32Array(0));
    backend.chart_sample = (id) => new Float64Array([Math.floor(id / 2), id % 2, [1, 90, 3, 30][id], 0, 0, 0]);
    const sdk = Charturbo.fromBackend(backend);
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderAreaChart([{ name: 'A', values: [1, 1] }, { name: 'B', values: [3, 3] }], { mode: 'percent', hover: { mode: 'nearest' } });
    sdk.appendAreaData([{ values: [90] }, { values: [30] }], { maxPoints: 2 });
    canvas.fire('pointermove', { clientX: 120, clientY: 200, buttons: 0 });
    expect(body.querySelectorAll('.charturbo-sdk-node-tooltip')[0].innerHTML).toContain('25.0%');
    expect(backend.chart_series_values).not.toHaveBeenCalled();
    sdk.dispose();
  });
});
