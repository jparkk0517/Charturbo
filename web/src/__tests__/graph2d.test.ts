import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { encodeGraph, graphA11yModel, sendGraph, syncGraph, type GraphChartData } from '../sdk/chart-graph';
import { renderChartSpec } from '../sdk/chart-binding';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus } from '../sdk/chart-a11y';

/** Minimal DOM element: enough for the chart overlay, legend, labels and tooltip. */
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

/**
 * Alpha(0, category Core) -> Beta(1, category Edge) -> Gamma(2, no category, pinned at 1 / 2).
 * Link ends by id, name and index.
 */
const DATA: GraphChartData = {
  nodes: [
    { id: 'a', name: 'Alpha', value: 4, category: 'Core' },
    { name: 'Beta', value: 2, category: 1 },
    { name: 'Gamma', symbolSize: 20, fixed: true, x: 1, y: 2 },
  ],
  links: [
    { source: 'a', target: 'Beta' },
    { source: 1, target: 2, lineWidth: 3 },
  ],
  categories: ['Core', { name: 'Edge', color: '#00ff00' }],
};

interface MockState {
  hit: Float64Array;
  labelsRev: number;
  labels: number[];
  axes: number[];
}

function mockBackend(calls: Calls, st: MockState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_graph_chart: (...args: unknown[]) => {
      (calls.set_graph_chart ??= []).push(args);
      return (args[0] as Float64Array).length;
    },
    set_chart_hierarchy_style: record('set_chart_hierarchy_style'),
    chart_hierarchy_colors: () => Float32Array.from({ length: 12 }, (_, i) => (i % 4 === 3 ? 1 : 0.5)),
    chart_hierarchy_legend: () => new Float64Array([0, 1, 0, 0, 1, 1, 0, 1, 0, 1]),
    chart_hierarchy_labels: () => new Float64Array([st.labelsRev, st.labels.length / 6, ...st.labels]),
    chart_hover_hierarchy_item: (s: number, i: number) => {
      (calls.chart_hover_hierarchy_item ??= []).push([s, i]);
      return new Float64Array([0, 0, 1, s, i, 0, i]);
    },
    set_chart_emphasis: record('set_chart_emphasis'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_zoom_x: record('chart_zoom_x'),
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0, NaN]),
    project_node_to_ndc: () => new Float32Array([0.1, 0.2, 0.5]),
    chart_axes_revision: () => st.axes.length,
    chart_axes: () => new Float64Array([12, 60, 776, 328, st.axes.length / 4, ...st.axes]),
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
    sync_and_render: record('sync_and_render'),
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

function state(): MockState {
  return {
    hit: new Float64Array(0),
    labelsRev: 1,
    // Alpha right of its node; Gamma rotated (circular, left half: ends at its anchor)
    labels: [0, 100, 200, 0, 60, 1, 2, 300, 120, -Math.PI / 4, 60, -1],
    axes: [],
  };
}

type A11yHost = { a11y: { model(): ReturnType<typeof buildA11yModel> } };

describe('2D graph (SDK binding)', () => {
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

  it('renderGraph sends per-node values / positions / categories / sizes, links by id / name / index, and options', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, state()));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const res = sdk.renderGraph(DATA, {
      layout: 'circular',
      rotateLabel: true,
      curveness: 0.2,
      edgeSymbol: 'arrow',
      edgeSymbolSize: 10,
      lineWidth: 2,
      edgeColor: 'source',
      edgeOpacity: 0.5,
      symbol: 'diamond',
      force: { repulsion: 80, edgeLength: 40, gravity: 0.2, iterations: 100 },
      title: 'Net',
    });
    expect(res).toEqual({ nodeCount: 3, linkCount: 2 });
    const [values, x, y, cats, catCount, sizes, fixed, sources, targets, widths, labelPx, opts] = calls.set_graph_chart[0] as [
      Float64Array, Float64Array, Float64Array, Int32Array, number, Float32Array, Uint8Array, Uint32Array, Uint32Array, Float32Array, Float32Array, Float64Array,
    ];
    expect(Array.from(values)).toEqual([4, 2, NaN]);
    expect(Array.from(x)).toEqual([NaN, NaN, 1]);
    expect(Array.from(y)).toEqual([NaN, NaN, 2]);
    expect(Array.from(cats)).toEqual([0, 1, -1]);
    expect(catCount).toBe(2);
    expect(Array.from(sizes)).toEqual([NaN, NaN, 20]);
    expect(Array.from(fixed)).toEqual([0, 0, 1]);
    expect(Array.from(sources)).toEqual([0, 1]);
    expect(Array.from(targets)).toEqual([1, 2]);
    expect(Array.from(widths)).toEqual([NaN, 3]);
    expect(labelPx[0]).toBeCloseTo(5 * 6.8);
    expect(labelPx[1]).toBeCloseTo(4 * 6.8);
    expect(Array.from(opts)).toEqual([1, 2, 0.2, 1, 10, 1, 0.5, 2, 1, 1, 14, 100, 80, 40, 0.2, NaN, NaN, NaN, NaN, 0]);
    // Palette = theme palette with the category color over its slot
    const [palette, colors] = calls.set_chart_hierarchy_style[0] as Float32Array[];
    expect(Array.from(palette.slice(0, 4))).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.dark.palette[0])));
    expect(Array.from(palette.slice(4, 8))).toEqual([0, 1, 0, 1]);
    expect(colors.length).toBe(12);
    // Legend of the categories (toggle + emphasize), no axes
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.map((i) => i.children[1].textContent)).toEqual(['Core', 'Edge']);
    expect(sdk.handlesChartBrush()).toBe(false);

    // Defaults travel as NaN; symbolSize [min, max] scales by value; a number sizes every node
    sdk.renderGraph({ nodes: [{ name: 'p', value: 1 }, { name: 'q', value: 3 }, { name: 'r' }] }, { symbolSize: [10, 30] });
    const def = calls.set_graph_chart[1] as [Float64Array, Float64Array, Float64Array, Int32Array, number, Float32Array];
    expect(Array.from(def[5])).toEqual([10, 30, 10]);
    expect(def[4]).toBe(0);
    const defOpts = (calls.set_graph_chart[1] as unknown[])[11] as Float64Array;
    expect(defOpts[0]).toBe(0);
    expect([1, 2, 4, 6, 11, 12, 13, 14].every((k) => Number.isNaN(defOpts[k]))).toBe(true);
    expect([defOpts[3], defOpts[5], defOpts[7], defOpts[8], defOpts[9]]).toEqual([0, 0, 0, 1, 0]);
    sdk.renderGraph({ nodes: [{ name: 'p' }, { name: 'q', symbolSize: 4 }] }, { symbolSize: 16 });
    expect(Array.from((calls.set_graph_chart[2] as Float32Array[])[5])).toEqual([16, 4]);

    // The theme re-sends the palette
    sdk.renderGraph(DATA);
    sdk.setTheme('light');
    const last = calls.set_chart_hierarchy_style.at(-1) as Float32Array[];
    expect(Array.from(last[0].slice(0, 4))).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.light.palette[0])));
    expect(Array.from(last[0].slice(4, 8))).toEqual([0, 1, 0, 1]);
  });

  it('invalid input throws before the scene is cleared: the active graph stays', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, state()));
    sdk.renderGraph(DATA);
    const cleared = calls.clear_scene_objects.length;
    expect(() => sdk.renderGraph({ nodes: [] })).toThrow('graph needs at least one node');
    expect(() => sdk.renderGraph({ nodes: [{ name: 'a' }], links: [{ source: 'a', target: 'zz' }] })).toThrow('link 0: unknown node "zz"');
    expect(() => sdk.renderGraph({ nodes: [{ name: 'a' }] }, { layout: 'none' })).toThrow('node 0 ("a"): layout "none" needs x and y');
    expect(() => sdk.renderGraph({ nodes: [{ name: 'a', category: 3 }], categories: ['k'] })).toThrow('node 0 ("a"): category 3 out of range (1 categories)');
    expect(() => sdk.renderGraph({ nodes: [{ name: 'a', value: Infinity }] })).toThrow('node 0 ("a"): value is not finite');
    expect(() =>
      sdk.renderGraph({ nodes: [{ name: 'a', x: 'Q9', y: 1 }] }, { layout: 'cartesian', xAxis: { categories: ['Q1'] } })
    ).toThrow('node 0 ("a"): x "Q9" is not an x axis category');
    // The engine caps categories at 65,536: the SDK must refuse before clearing
    expect(() => sdk.renderGraph({ nodes: [{ name: 'a', category: 100000 }] })).toThrow('too many categories');
    expect(calls.clear_scene_objects.length).toBe(cleared);
    expect(calls.set_graph_chart.length).toBe(1);
    expect(sdk.getNodeDetails(1)?.metadata.label).toBe('Edge › Beta');
    // String categories missing from `categories` are appended; no categories: none needed
    const enc = encodeGraph({ nodes: [{ name: 'a', category: 'x' }, { name: 'b', category: 'y' }, { name: 'c', category: 'x' }] });
    expect(enc.categoryNames).toEqual(['x', 'y']);
    expect(Array.from(enc.categories)).toEqual([0, 1, 0]);
  });

  it('legend toggles and emphasizes categories; hover tooltip shows category › name and value; labels at engine anchors', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderGraph(DATA, { format: '$,.0f' });
    sdk.render();
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    items[1].fire('click');
    expect(calls.set_chart_series_visible).toEqual([[1, false]]);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    items[0].fire('pointerenter');
    items[0].fire('pointerleave');
    // Hiding a category clears any emphasis (the pointer still rests on its entry), as for pie
    expect(calls.set_chart_emphasis).toEqual([[-1], [0], [-1]]);

    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));
    st.hit = new Float64Array([0, 0, 1, 0, 1, 2, 1]);
    canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
    const ctx = seen.at(-1)!;
    expect(ctx.chartType).toBe('graph');
    expect(ctx.hierarchy).toMatchObject({ node: 1, name: 'Beta', path: ['Edge', 'Beta'], value: 2, children: 2 });
    expect(ctx.details?.metadata.label).toBe('Edge › Beta');
    expect(ctx.details?.metadata.attributes).toMatchObject({ name: 'Beta', category: 'Edge', value: 2, links: 2 });
    const tooltip = body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    expect(tooltip.innerHTML).toContain('Edge ›');
    expect(tooltip.innerHTML).toContain('$2');
    // No value, no category: just the name
    st.hit = new Float64Array([0, 0, 1, 0, 2, 0, 2]);
    canvas.fire('pointermove', { buttons: 0, clientX: 310, clientY: 200 });
    expect(seen.at(-1)!.hierarchy!.path).toEqual(['Gamma']);
    expect(tooltip.innerHTML).not.toContain('NaN');

    const labels = container.querySelectorAll('.charturbo-sdk-tree-label');
    expect(labels.map((l) => l.textContent)).toEqual(['Alpha', 'Gamma']);
    expect([labels[0].style.left, labels[0].style.top, labels[0].style.transform]).toEqual(['100px', '200px', 'translate(0, -50%)']);
    expect(labels[1].style.transform).toBe('rotate(-0.7854rad) translate(-100%, -50%)');
  });

  it('cartesian: value axes with category tick names, gridlines on', () => {
    const calls: Calls = {};
    const st = state();
    // x ticks at category 0 / 1, y tick at 5
    st.axes = [0, 0, 100, 388, 0, 1, 300, 388, 1, 5, 12, 200];
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderGraph(
      { nodes: [{ name: 'a', x: 'Q2', y: 3 }, { name: 'b', x: 0, y: 7 }], links: [{ source: 0, target: 1 }] },
      // `format` (values) also formats the y ticks unless `yAxis.format` is given
      { layout: 'cartesian', xAxis: { categories: ['Q1', 'Q2'] }, yAxis: { min: 0, max: 10, format: ',.0f' }, format: '$,.0f' }
    );
    sdk.render();
    const [, x, y, , , , , , , , , opts] = calls.set_graph_chart[0] as Float64Array[];
    expect(Array.from(x)).toEqual([1, 0]);
    expect(Array.from(y)).toEqual([3, 7]);
    expect(Array.from(opts.slice(15))).toEqual([NaN, NaN, 0, 10, 2]);
    expect(opts[0]).toBe(3);
    expect((calls.set_chart_frame_style.at(-1)![0] as Float32Array)[0]).toBe(1);
    // Every fake element is 800px wide, so collision thinning may hide x ticks: check text only
    const ticks = container.querySelectorAll('.charturbo-sdk-axis-tick');
    expect(ticks.map((t) => t.textContent)).toEqual(['Q1', 'Q2', '5']);
    // Numeric x with given range
    sdk.renderGraph({ nodes: [{ name: 'a', x: 2, y: 3 }] }, { layout: 'cartesian', xAxis: { min: -1, max: 9 } });
    const o2 = (calls.set_graph_chart[1] as Float64Array[])[11];
    expect(Array.from(o2.slice(15))).toEqual([-1, 9, NaN, NaN, 0]);
  });

  it('a11y: summary, node table, CSV, arrow keys walk nodes and links', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, state()));
    sdk.renderGraph(DATA, { title: 'Net', valueLabel: 'Weight' });
    const a11y = (sdk as unknown as A11yHost).a11y;
    const model = a11y.model()!;
    expect(model.kind).toBe('graph');
    expect(buildChartSummary(model)).toBe('Net. Network graph, 3 nodes in 2 categories, 2 links; most linked: Beta (2 links), Alpha (1 link), Gamma (1 link).');
    expect(buildChartDescription(model)).toContain('Right and Left for the next and previous linked node');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Node', 'Category', 'Weight', 'Links', 'Linked to']);
    expect(table.rows).toEqual([
      ['Alpha', 'Core', 4, 1, 'Beta'],
      ['Beta', 'Edge', 2, 2, 'Gamma'],
      ['Gamma', null, null, 1, null],
    ]);
    expect(sdk.exportChartCSV().split('\r\n')[1]).toBe('Alpha,Core,4,1,Beta');

    let f = stepFocus(model, null, 'ArrowDown')!;
    expect(f).toEqual({ series: 0, index: 0 });
    f = stepFocus(model, f, 'ArrowDown')!;
    expect(f.index).toBe(1);
    expect(stepFocus(model, f, 'End')!.index).toBe(2);
    expect(stepFocus(model, f, 'Home')!.index).toBe(0);
    // Right / Left: next / previous linked node by index (wrapping)
    expect(stepFocus(model, { series: 0, index: 0 }, 'ArrowRight')!.index).toBe(1);
    expect(stepFocus(model, f, 'ArrowRight')!.index).toBe(2);
    expect(stepFocus(model, { series: 0, index: 2 }, 'ArrowRight')!.index).toBe(1);
    expect(stepFocus(model, f, 'ArrowLeft')!.index).toBe(0);
    expect(pointAnnouncement(model, f)).toBe('Beta, Edge, 2. Node 2 of 3, 2 links: Alpha, Gamma.');
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('Gamma. Node 3 of 3, 1 link: Beta.');
    expect(Array.from(model.custom!.hover!({ series: 0, index: 1 })!)).toEqual([0, 0, 1, 0, 1, 0, 1]);

    // Hidden categories drop out of the walk
    sdk.setSeriesVisible(1, false);
    const m2 = a11y.model()!;
    expect(stepFocus(m2, { series: 0, index: 0 }, 'ArrowDown')!.index).toBe(2);
    expect(stepFocus(m2, { series: 0, index: 0 }, 'ArrowRight')!.index).toBe(0);
  });

  it('React / Vue spec type "graph" renders a graph', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, state()));
    renderChartSpec(sdk, { type: 'graph', data: DATA, options: { layout: 'force' } });
    expect(calls.set_graph_chart.length).toBe(1);
  });

  it('Korean and Chinese text: summary, announcement, table headers', () => {
    const backend = mockBackend({}, state());
    const common = { formatValue: (v: number) => String(v) };
    const meta = sendGraph(backend, encodeGraph(DATA, undefined, 'ko'), undefined, 'ko');
    syncGraph(backend, meta, 'ko');
    const ko = graphA11yModel(meta, { ...common, locale: 'ko' });
    expect(buildChartSummary(ko)).toContain('네트워크 그래프');
    expect(pointAnnouncement(ko, { series: 0, index: 1 })).toContain('연결 2개');
    expect(buildDataTable(ko).columns).toEqual(['노드', '범주', '값', '연결', '연결 대상']);
    // A language switch re-syncs the meta first (setLanguage → syncGraph)
    syncGraph(backend, meta, 'zh-CN');
    const zh = graphA11yModel(meta, { ...common, locale: 'zh-CN' });
    expect(buildChartSummary(zh)).toContain('关系图');
    expect(buildDataTable(zh).columns).toEqual(['节点', '类别', '数值', '连接', '连接到']);
  });
});
