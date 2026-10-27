import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { presentTooltipContext } from '../sdk/chart-tooltip';
import {
  CHARTURBO_THEMES,
  Charturbo,
  type ChartTooltipContext,
  type LineSeriesDescriptor,
  type CharturboHoverEvent,
  type WasmCharturboEngineBackend,
} from '../sdk/charturbo';

// The a11y layer has its own tests and needs a full DOM; replaced by an inert stand-in here.
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
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
  offsetWidth = 120;
  offsetHeight = 60;

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
  insertAdjacentElement(_where: string, el: FakeEl): FakeEl {
    return (this.parentElement ?? this).appendChild(el);
  }
  addEventListener(type: string, f: (e: unknown) => void): void {
    (this.listeners[type] ??= []).push(f);
  }
  removeEventListener(type: string, f: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((x) => x !== f);
  }
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
    set_line_chart: record('set_line_chart', 9),
    set_bar_chart: record('set_bar_chart'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    chart_clear_hover: record('chart_clear_hover'),
    chart_hover_at_ndc: () => hit(),
    chart_sample: (id: number) => new Float64Array([Math.floor(id / 3), id % 3, 0, 1, 2, 3]),
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
  { name: 'North', values: [10, 20, 30] },
  { name: 'South', values: [50, 5, 15] },
  { name: 'East', values: [30, 40, 35] },
];

/** Index 1 of every series; the pointer is closest to South (slot 1, id 4) */
const HIT_AT_1 = hitOf(1, [
  [0, 1, 20, 1],
  [1, 1, 5, 4],
  [2, 1, 40, 7],
]);

const mouse = (clientX: number, clientY = 200) => ({ clientX, clientY, button: 0, buttons: 0, pointerType: 'mouse', pointerId: 1 });

describe('presentTooltipContext', () => {
  const ctx = (values: number[]): ChartTooltipContext => ({
    chartType: 'line',
    index: 0,
    xLabel: 'x',
    items: values.map((value, i) => ({ seriesName: `S${i}`, value, color: 'red', nodeId: i * 10 })),
    details: { id: 10 } as ChartTooltipContext['details'],
  });

  it('sorts by value (NaN last) without mutating the engine context', () => {
    const c = ctx([3, NaN, 1, 2]);
    expect(presentTooltipContext(c, { sort: 'asc' }).items.map((i) => i.value)).toEqual([1, 2, 3, NaN]);
    expect(presentTooltipContext(c, { sort: 'desc' }).items.map((i) => i.value)).toEqual([3, 2, 1, NaN]);
    expect(c.items.map((i) => i.value)).toEqual([3, NaN, 1, 2]);
    expect(presentTooltipContext(c, { sort: 'none' })).toBe(c);
    expect(presentTooltipContext(c, undefined)).toBe(c);
  });

  it('shared: false drops a column total with the other rows', () => {
    const c = { ...ctx([3, 4, 5]), total: 12 };
    expect(presentTooltipContext(c, { shared: false }).total).toBeUndefined();
    expect(presentTooltipContext(c, { sort: 'asc' }).total).toBe(12);
  });

  it('shared: false keeps the primary item (line / bar only)', () => {
    expect(presentTooltipContext(ctx([3, 4, 5]), { shared: false }).items.map((i) => i.seriesName)).toEqual(['S1']);
    const scatter = { ...ctx([3, 4]), chartType: 'scatter' as const };
    expect(presentTooltipContext(scatter, { shared: false }).items.length).toBe(2);
    // No details: the first item stands in
    expect(presentTooltipContext({ ...ctx([3, 4]), details: null }, { shared: false }).items[0].seriesName).toBe('S0');
  });
});

describe('Chart tooltip options and format specs (SDK)', () => {
  let body: FakeEl;
  let container: FakeEl;
  let canvas: FakeEl;
  let docListeners: Record<string, ((e: unknown) => void)[]>;

  beforeEach(() => {
    body = new FakeEl('body');
    container = new FakeEl('div');
    canvas = container.appendChild(new FakeEl('canvas'));
    docListeners = {};
    vi.stubGlobal('document', {
      body,
      head: new FakeEl('head'),
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: () => null,
      addEventListener: (type: string, f: (e: unknown) => void) => (docListeners[type] ??= []).push(f),
      removeEventListener: (type: string, f: (e: unknown) => void) =>
        (docListeners[type] = (docListeners[type] ?? []).filter((x) => x !== f)),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const tooltipOf = () => body.querySelectorAll('.charturbo-sdk-node-tooltip')[0];
  const ticks = () => container.querySelectorAll('.charturbo-sdk-axis-tick').map((t) => t.textContent);

  it('axis `format` accepts spec strings / Intl options and follows setLocale', () => {
    const calls: Calls = {};
    // One x tick (value 2) and two y ticks
    const axes = new Float64Array([56, 40, 700, 300, 3, 0, 2, 100, 340, 1, 1234.5, 56, 100, 1, 0.25, 56, 200, 0, 0, 0]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => axes));
    sdk.setLocale('en-US');
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart(SERIES, { axes: { x: { format: '.1f' }, y: { format: ',.1f' } } });
    expect(ticks()).toEqual(['2.0', '1,234.5', '0.3']);
    sdk.setLocale('de-DE');
    expect(ticks()).toEqual(['2,0', '1.234,5', '0,3']);

    sdk.setLocale('en-US');
    sdk.renderLineChart(SERIES, { axes: { y: { format: { style: 'percent', maximumFractionDigits: 0 } } } });
    expect(ticks().slice(1)).toEqual(['123,450%', '25%']);
    // Functions keep working
    sdk.renderLineChart(SERIES, { axes: { y: { format: (v) => `<${v}>` } } });
    expect(ticks().slice(1)).toEqual(['<1234.5>', '<0.25>']);
    // Invalid specs fail at render time (any axis); invalid tooltip specs when binding
    expect(() => sdk.renderLineChart(SERIES, { axes: { x: { format: 'bogus' } } })).toThrow(TypeError);
    expect(() => sdk.renderLineChart(SERIES, { axes: { y: { format: 'bogus' } } })).toThrow(TypeError);
    expect(() =>
      sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { tooltip: { valueFormatter: '.2q' } })
    ).toThrow(TypeError);
  });

  it('valueFormatter formats default tooltip values; formatChartTooltip still wins', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => HIT_AT_1, () => new Float64Array(0)));
    sdk.setLocale('en-US');
    const off = sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { tooltip: { valueFormatter: '$,.2f' } });
    sdk.renderLineChart(SERIES);
    canvas.fire('pointermove', mouse(100));
    expect(tooltipOf().innerHTML).toContain('$20.00');
    expect(tooltipOf().innerHTML).toContain('$40.00');
    off();

    let seen: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      tooltip: { valueFormatter: '$,.2f', sort: 'desc' },
      formatChartTooltip: (c) => {
        seen = c;
        return 'custom';
      },
    });
    canvas.fire('pointermove', mouse(110));
    expect(tooltipOf().innerHTML).toBe('custom');
    // The override receives the sorted rows
    expect((seen as unknown as ChartTooltipContext).items.map((i) => i.value)).toEqual([40, 20, 5]);
  });

  it('sort / shared shape the tooltip rows; hover events keep the engine order', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => HIT_AT_1, () => new Float64Array(0)));
    let seen: ChartTooltipContext | null = null;
    const hovers: CharturboHoverEvent[] = [];
    sdk.on('hover', (e) => hovers.push(e));
    const off = sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      tooltip: { sort: 'asc' },
      formatChartTooltip: (c) => {
        seen = c;
        return '';
      },
    });
    sdk.renderLineChart(SERIES);
    canvas.fire('pointermove', mouse(100));
    expect((seen as unknown as ChartTooltipContext).items.map((i) => i.seriesName)).toEqual(['South', 'North', 'East']);
    expect(hovers[0].chart?.items.map((i) => i.seriesName)).toEqual(['North', 'South', 'East']);
    off();

    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { tooltip: { shared: false } });
    canvas.fire('pointermove', mouse(120));
    const html = tooltipOf().innerHTML;
    expect(html).toContain('South');
    expect(html).not.toContain('North');
    expect(html).not.toContain('East');
  });

  it("pin: 'click' freezes the tooltip until the next click, Escape, or a press outside", () => {
    const calls: Calls = {};
    let hit = HIT_AT_1;
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { tooltip: { pin: 'click' } });
    sdk.renderLineChart(SERIES);
    const tip = tooltipOf();
    const click = (x: number) => {
      canvas.fire('pointerdown', mouse(x));
      canvas.fire('pointerup', mouse(x));
    };

    canvas.fire('pointermove', mouse(100));
    expect(tip.innerHTML).toContain('North');
    click(100);
    expect(tip.dataset.pinned).toBe('true');
    expect(tip.style.left).toBe('114px');
    const pinnedHtml = tip.innerHTML;

    // Hover elsewhere / leaving the canvas: frozen
    hit = hitOf(0, [[0, 2, 30, 2]]);
    const hoverCalls = () => (calls.chart_clear_hover ?? []).length;
    const cleared = hoverCalls();
    canvas.fire('pointermove', mouse(300));
    canvas.fire('pointerleave', mouse(900));
    expect(tip.innerHTML).toBe(pinnedHtml);
    expect(tip.style.display).toBe('block');
    expect(hoverCalls()).toBe(cleared);

    // Next click unpins and the tooltip follows the pointer again
    click(300);
    expect(tip.dataset.pinned).toBeUndefined();
    expect(tip.innerHTML).not.toBe(pinnedHtml);
    expect(tip.style.left).toBe('314px');
    canvas.fire('pointermove', mouse(310));
    expect(tip.style.left).toBe('324px');

    // Escape unpins + hides
    click(310);
    expect(tip.dataset.pinned).toBe('true');
    canvas.fire('keydown', { key: 'Escape' });
    expect(tip.dataset.pinned).toBeUndefined();
    expect(tip.style.display).toBe('none');

    // A press outside the canvas unpins; one on the canvas does not go through the document hook
    canvas.fire('pointermove', mouse(310));
    click(310);
    expect(docListeners.pointerdown?.length).toBe(1);
    docListeners.pointerdown[0]({ target: canvas });
    expect(tip.dataset.pinned).toBe('true');
    const hovers: CharturboHoverEvent[] = [];
    sdk.on('hover', (e) => hovers.push(e));
    docListeners.pointerdown[0]({ target: body });
    expect(tip.dataset.pinned).toBeUndefined();
    // Unpinning ends the frozen hover for event consumers too
    expect(hovers.at(-1)?.chart).toBeNull();
    expect(tip.style.display).toBe('none');
    expect(docListeners.pointerdown.length).toBe(0);

    // A click on empty space does not pin
    hit = new Float64Array(0);
    click(500);
    expect(tip.dataset.pinned).toBeUndefined();
  });

  it('without pin, clicks leave the tooltip following the pointer', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => HIT_AT_1, () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart(SERIES);
    canvas.fire('pointerdown', mouse(100));
    canvas.fire('pointerup', mouse(100));
    expect(tooltipOf().dataset.pinned).toBeUndefined();
    canvas.fire('pointermove', mouse(200));
    expect(tooltipOf().style.left).toBe('214px');
  });

  it('single-series bar `legend`: static key of the item categories', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const items = [
      { label: 'A', value: 3, category: 'Fruit', color: '#ff0000' },
      { label: 'B', value: 5, category: 'Veg', color: '#00ff00' },
      { label: 'C', value: 2, category: 'Fruit', color: '#0000ff' },
      { label: 'D', value: 1 },
    ];
    const legendItems = () => container.querySelectorAll('.charturbo-sdk-legend-item');

    sdk.renderBarChart(items);
    expect(legendItems()).toEqual([]);

    sdk.renderBarChart(items, { legend: true });
    const key = legendItems();
    expect(key.map((i) => i.children[1].textContent)).toEqual(['Fruit', 'Veg']);
    expect(key.map((i) => i.children[0].style.background)).toEqual(['rgb(255, 0, 0)', 'rgb(0, 255, 0)']);
    expect(key[0].tag).toBe('div'); // not a toggle button
    // Room for the legend row above the plot
    const padTop = (calls.set_chart_padding.at(-1) as number[])[0];
    sdk.renderBarChart(items, { legend: { show: false } });
    expect(legendItems()).toEqual([]);
    expect((calls.set_chart_padding.at(-1) as number[])[0]).toBeLessThan(padTop);

    // No item / chart colors: categories pick palette colors in first-seen order
    sdk.renderBarChart(
      items.map(({ color: _c, ...rest }) => rest),
      { legend: true }
    );
    const css = (c: readonly number[]) => `rgb(${c.slice(0, 3).map((v) => Math.round(v * 255)).join(', ')})`;
    expect(legendItems().map((i) => i.children[0].style.background)).toEqual([
      css(CHARTURBO_THEMES.dark.palette[0]),
      css(CHARTURBO_THEMES.dark.palette[1]),
    ]);

    // 3D view: no key; items without categories: one entry for the series (`seriesName`)
    sdk.renderBarChart(items, { legend: true, viewMode: '3d' });
    expect(legendItems()).toEqual([]);
    sdk.renderBarChart([{ label: 'x', value: 1 }], { legend: true, seriesName: 'Sales' });
    expect(legendItems().map((i) => i.children[1].textContent)).toEqual(['Sales']);
  });
});
