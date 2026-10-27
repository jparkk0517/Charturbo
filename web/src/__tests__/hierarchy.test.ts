import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { encodeHierarchy, fitText, hierarchyTooltipHtml, nameEngineError } from '../sdk/chart-hierarchy';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus } from '../sdk/chart-a11y';
import type { CharturboDrillEvent } from '../sdk/chart-hierarchy';

/** Minimal DOM element: enough for the chart overlay, legend, labels, breadcrumb and tooltip. */
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
 * Tree of the mock engine (depth-first input order): Root(0) -> A(1) [a1(2) = 6, a2(3) = 4],
 * B(4) [b1(5) = 12]. Children largest first (B before A), like the engine.
 */
const TREE = {
  name: 'Root',
  children: [
    { name: 'A', children: [{ name: 'a1', value: 6 }, { name: 'a2', value: 4 }] },
    { name: 'B', children: [{ name: 'b1', value: 12 }] },
  ],
};
const VALUES = [22, 10, 6, 4, 12, 12];
const CHILDREN: Record<number, number[]> = { 0: [4, 1], 1: [2, 3], 4: [5] };
const PARENT = [-1, 0, 1, 1, 0, 4];

interface MockState {
  root: number;
  hit: Float64Array;
  hovered: [number, number];
  labelsRev: number;
  labels: number[];
  /** Engine error of the next set_* call */
  error?: string;
}

function mockBackend(calls: Calls, st: MockState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const set =
    (name: string, ret: number) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      if (st.error) throw st.error;
      return ret;
    };
  const childOfRoot = (n: number) => {
    let v = n;
    while (v >= 0 && PARENT[v] !== st.root) v = PARENT[v];
    return v;
  };
  return {
    set_treemap_chart: set('set_treemap_chart', 6),
    set_sunburst_chart: set('set_sunburst_chart', 6),
    set_sankey_chart: set('set_sankey_chart', 5),
    set_chart_hierarchy_style: record('set_chart_hierarchy_style'),
    chart_hierarchy_info: () => new Float64Array([6, 0, 0, st.root]),
    chart_hierarchy_values: () => new Float64Array(VALUES),
    chart_hierarchy_children: (n: number) => new Uint32Array(CHILDREN[n] ?? []),
    chart_hierarchy_colors: () => Float32Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 1 : i % 4 === 0 ? 0.1 : 0.5)),
    // Legend: B, A (value order)
    chart_hierarchy_legend: () => new Float64Array([4, 1, 0, 0, 1, 1, 0, 0, 1, 1]),
    chart_hierarchy_labels: () => new Float64Array([st.labelsRev, st.labels.length / 6, ...st.labels]),
    chart_hierarchy_layout: () => new Float64Array([st.root, 12, 60, 776, 328, 400, 220, 60, ...st.hovered]),
    chart_hierarchy_drill_target: (n: number) => {
      const c = childOfRoot(n);
      return c >= 0 && CHILDREN[c] ? c : -1;
    },
    set_chart_hierarchy_root: (n: number) => {
      (calls.set_chart_hierarchy_root ??= []).push([n]);
      if (n === st.root || !CHILDREN[n]) return false;
      st.root = n;
      return true;
    },
    chart_hover_hierarchy_item: (s: number, i: number) => {
      (calls.chart_hover_hierarchy_item ??= []).push([s, i]);
      return new Float64Array([0, 0, 1, s, i, s === 0 ? VALUES[i] : 5, i]);
    },
    // Sankey: Coal(0), Gas(1) -> Power(2) -> Homes(3), Industry(4)
    chart_sankey_nodes: () =>
      new Float64Array([
        0, 30, 0, 30, 0, 0, 0, 0, 0, 20, 0, 20, 0, 0, 0, 0, 1, 50, 50, 50, 0, 0, 0, 0, 2, 35, 35, 0, 0, 0, 0, 0, 2, 15, 15, 0, 0, 0, 0, 0,
      ]),
    chart_sankey_links: () => new Float64Array([0, 2, 30, 100, 1, 2, 20, 100, 2, 3, 35, 70, 2, 4, 15, 30]),
    set_chart_emphasis: record('set_chart_emphasis'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_zoom_x: record('chart_zoom_x'),
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([0, id, VALUES[id] ?? 0, 1, 2, 0, NaN]),
    project_node_to_ndc: () => new Float32Array([0.1, 0.2, 0.5]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([12, 60, 776, 328, 0]),
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
    clear_scene_objects: () => {},
  };
}

function state(): MockState {
  return {
    root: 0,
    hit: new Float64Array(0),
    hovered: [-1, -1],
    labelsRev: 1,
    // Header of A, leaf a1 with a value line
    labels: [1, 20, 70, 300, 20, 1, 2, 20, 94, 140, 60, 2],
  };
}

const SANKEY = {
  nodes: [{ id: 'coal', name: 'Coal' }, { id: 'gas', name: 'Gas' }, { id: 'power', name: 'Power' }, { id: 'homes', name: 'Homes' }, { id: 'industry', name: 'Industry' }],
  links: [
    { source: 'coal', target: 'power', value: 30 },
    { source: 'gas', target: 'power', value: 20 },
    { source: 'power', target: 'homes', value: 35 },
    { source: 'power', target: 'industry', value: 15 },
  ],
};

describe('Hierarchy / flow charts (SDK binding)', () => {
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

  it('encodes nested trees depth-first and flat rows by id; engine errors name the nodes', () => {
    const tree = encodeHierarchy(TREE);
    expect(tree.names).toEqual(['Root', 'A', 'a1', 'a2', 'B', 'b1']);
    expect(Array.from(tree.parents)).toEqual([-1, 0, 1, 1, 0, 4]);
    expect(Array.from(tree.values).map((v) => (Number.isNaN(v) ? null : v))).toEqual([null, null, 6, 4, null, 12]);

    const flat = encodeHierarchy([
      { id: 'r' },
      { id: 'x', parent: 'r', value: 3, name: 'Ex' },
      { id: 7, parent: 'x', value: 1 },
    ]);
    expect(Array.from(flat.parents)).toEqual([-1, 0, 1]);
    expect(flat.names).toEqual(['r', 'Ex', '7']);
    expect(flat.ids).toEqual(['r', 'x', 7]);
    expect(() => encodeHierarchy([{ id: 'a' }, { id: 'a' }])).toThrow('duplicate node id "a"');
    expect(() => encodeHierarchy([{ id: 'a', parent: 'zz' }])).toThrow('unknown parent "zz"');
    // Shared child objects would form a cycle in the flattened tree
    const loop: { name: string; children: unknown[] } = { name: 'loop', children: [] };
    loop.children.push(loop);
    expect(() => encodeHierarchy(loop as never)).toThrow('cycle');
    // A shared object in two places is not a cycle
    const leaf = { name: 'x', value: 1 };
    expect(encodeHierarchy({ name: 'r', children: [leaf, { name: 'y', children: [leaf] }] }).names).toEqual(['r', 'x', 'y', 'x']);

    expect(nameEngineError('hierarchy has a cycle: node 1 -> node 2 -> node 1', ['r', 'x', 'y']).message).toBe(
      'Hierarchy has a cycle: "x" -> "y" -> "x"'
    );
    expect(fitText('abcdefghij', 6.8 * 5)).toBe('abcd…');
    expect(fitText('abc', 100)).toBe('abc');
  });

  it('renderTreemap sends the tree, options and theme palette; no axes, brush or navigation', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, state()));
    const res = sdk.renderTreemap(TREE, { maxDepth: 2, innerPadding: 3, headerHeight: 18, colorBy: 'group', labels: false, title: 'Sales', colors: ['#ff0000'] });
    expect(res.nodeCount).toBe(6);
    const [parents, values, opts] = calls.set_treemap_chart[0] as [Int32Array, Float64Array, Float64Array];
    expect(parents).toBeInstanceOf(Int32Array);
    expect(Array.from(parents)).toEqual([-1, 0, 1, 1, 0, 4]);
    expect(values).toBeInstanceOf(Float64Array);
    expect(Array.from(opts)).toEqual([2, 3, 18, 1, 0]);
    const [palette, colors, other, surface] = calls.set_chart_hierarchy_style[0] as Float32Array[];
    expect(Array.from(palette)).toEqual([1, 0, 0, 1]);
    expect(colors.length).toBe(24);
    expect(Number.isNaN(colors[0])).toBe(true);
    expect(Array.from(other)).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.dark.baseline)));
    expect(Array.from(surface)).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.dark.surface)));
    // Title + legend (2 groups) + breadcrumb row on top; no axis margins
    expect(calls.set_chart_padding.at(-1)).toEqual([12 + 24 + 28 + 24, 16, 12, 12]);
    expect(sdk.handlesChartNavigation()).toBe(false);
    sdk.setChartBrush('x');
    expect(sdk.handlesChartBrush()).toBe(false);

    // Defaults travel as NaN; the theme re-sends the palette
    sdk.renderSunburst(TREE);
    const sun = calls.set_sunburst_chart[0][2] as Float64Array;
    expect(Number.isNaN(sun[0]) && sun[1] === 0 && sun[2] === 1).toBe(true);
    sdk.setTheme('light');
    const last = calls.set_chart_hierarchy_style.at(-1) as Float32Array[];
    expect(Array.from(last[0].slice(0, 4))).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.light.palette[0])));

    // Engine validation errors are rethrown with node names
    const st = state();
    st.error = 'hierarchy has a cycle: node 0 -> node 1 -> node 0';
    const bad = Charturbo.fromBackend(mockBackend({}, st));
    expect(() => bad.renderTreemap([{ id: 'p', parent: 'q' }, { id: 'q', parent: 'p' }])).toThrow('Hierarchy has a cycle: "p" -> "q" -> "p"');
  });

  it('hover tooltip shows path, value and shares; a click drills, the breadcrumb goes back up', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderTreemap(TREE, { format: '$,.0f' });
    sdk.render();
    const seen: (ChartTooltipContext | null)[] = [];
    const drills: CharturboDrillEvent[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));
    sdk.on('drill', (e) => drills.push(e));

    // Engine hit: node a1 (2), value 6
    st.hit = new Float64Array([0, 0, 1, 0, 2, 6, 2]);
    canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
    const ctx = seen.at(-1)!;
    expect(ctx.chartType).toBe('treemap');
    expect(ctx.hierarchy).toMatchObject({ node: 2, name: 'a1', path: ['Root', 'A', 'a1'], value: 6, percentOfParent: 60, depth: 2, children: 0 });
    expect(ctx.hierarchy!.percentOfTotal).toBeCloseTo((6 / 22) * 100);
    expect(ctx.details?.metadata.label).toBe('Root › A › a1');
    const tooltip = body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    expect(tooltip.innerHTML).toContain('Root › A ›');
    expect(tooltip.innerHTML).toContain('$6');
    expect(tooltip.innerHTML).toContain('60.0% of parent');
    expect(tooltip.innerHTML).toContain('27.3% of total');

    // Labels at the engine anchors: header (name only), cell with a value line
    const labels = container.querySelectorAll('.charturbo-sdk-hierarchy-label');
    expect(labels.length).toBe(2);
    expect([labels[0].style.left, labels[0].style.top, labels[0].style.width]).toEqual(['20px', '70px', '300px']);
    expect(labels[0].textContent).toBe('A');
    expect(labels[1].textContent).toBe('a1$6');

    // Breadcrumb: the current root only
    const [crumbs] = container.querySelectorAll('.charturbo-sdk-breadcrumb');
    expect(crumbs.textContent).toBe('Root');

    // Click on a1: the engine's drill target is A
    canvas.fire('pointerdown', { button: 0, clientX: 300, clientY: 200 });
    canvas.fire('pointerup', { button: 0, clientX: 300, clientY: 200 });
    expect(calls.set_chart_hierarchy_root).toEqual([[1]]);
    expect(drills).toEqual([{ kind: 'treemap', node: 1, id: undefined, name: 'A', path: ['Root', 'A'] }]);
    sdk.render();
    expect(crumbs.textContent).toBe('Root›A');
    const up = container.querySelectorAll('.charturbo-sdk-breadcrumb-item');
    expect(up.map((b) => b.textContent)).toEqual(['Root']);
    up[0].fire('click');
    expect(st.root).toBe(0);
    expect(drills.at(-1)!.path).toEqual(['Root']);
    // API: drill by name, then up; leaves do not drill
    expect(sdk.drillTo('B')).toBe(true);
    expect(sdk.drillUp()).toBe(true);
    expect(sdk.drillUp()).toBe(false);
    expect(sdk.drillTo('b1')).toBe(false);

    // Legend lists the top-level groups (engine order); hover emphasizes, no toggling
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.map((i) => i.textContent)).toEqual(['B', 'A']);
    items[1].fire('pointerenter');
    expect(calls.set_chart_emphasis.at(-1)).toEqual([1]);
    items[1].fire('click');
    expect(calls.set_chart_series_visible).toBeUndefined();
  });

  it('sunburst center shows the current root, or the hovered node with its share', () => {
    const calls: Calls = {};
    const st = state();
    st.labels = [1, 300, 180, 80, 14, 0];
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderSunburst(TREE);
    sdk.render();
    const [center] = container.querySelectorAll('.charturbo-sdk-sunburst-center');
    expect([center.style.left, center.style.top, center.style.display]).toEqual(['400px', '220px', 'block']);
    expect(center.textContent).toBe('22Root');
    st.hovered = [0, 4];
    sdk.render();
    expect(center.textContent).toBe('12B · 54.5%');
    const [label] = container.querySelectorAll('.charturbo-sdk-hierarchy-label');
    expect([label.textContent, label.style.transform]).toEqual(['A', 'translate(-50%, -50%)']);
  });

  it('treemap a11y: summary, node table, sibling keys, Enter drills and Escape goes up', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.renderTreemap(TREE, { title: 'Sales', valueLabel: 'Revenue' });
    const a11y = (sdk as unknown as { a11y: { model(): ReturnType<typeof buildA11yModel> } }).a11y;
    const model = a11y.model()!;
    expect(model.kind).toBe('treemap');
    expect(buildChartSummary(model)).toBe('Sales. Treemap, 6 nodes, total 22; largest: B 54.5%, A 45.5%.');
    expect(buildChartDescription(model)).toContain('A: 10 (45.5%), 2 children.');
    expect(buildChartDescription(model)).toContain('Enter to drill');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Path', 'Revenue', 'Share of parent', 'Share of total']);
    expect(table.rows[0]).toEqual(['Root', 22, null, 100]);
    expect(table.rows[2]).toEqual(['Root › A › a1', 6, 60, 27.27]);
    expect(buildDataTable(model, 2).sampled).toBe(true);

    // Arrows move between siblings (engine order: B, A), Down / Up between levels
    let f = stepFocus(model, null, 'ArrowRight')!;
    expect(f).toEqual({ series: 0, index: 4 });
    f = stepFocus(model, f, 'ArrowRight')!;
    expect(f.index).toBe(1);
    expect(stepFocus(model, f, 'ArrowRight')!.index).toBe(1);
    f = stepFocus(model, f, 'ArrowDown')!;
    expect(f.index).toBe(2);
    expect(pointAnnouncement(model, f)).toBe('a1, 6, 60% of A. 1 of 2, level 2.');
    expect(stepFocus(model, f, 'End')!.index).toBe(3);
    expect(stepFocus(model, f, 'ArrowUp')!.index).toBe(1);

    // Enter drills into the focused node and focuses its first child; Escape goes back up
    const drilled = model.custom!.key!({ series: 0, index: 1 }, 'Enter');
    expect(drilled).toEqual({ focus: { series: 0, index: 2 } });
    expect(st.root).toBe(1);
    const back = a11y.model()!.custom!.key!({ series: 0, index: 2 }, 'Escape');
    expect(back).toEqual({ focus: { series: 0, index: 1 } });
    expect(st.root).toBe(0);
    // At the top Escape falls through (clears focus); leaves do not drill
    expect(a11y.model()!.custom!.key!(null, 'Escape')).toBeNull();
    expect(a11y.model()!.custom!.key!({ series: 0, index: 5 }, 'Enter')).toBeNull();
    // Keyboard hover goes straight to the engine item
    expect(Array.from(model.custom!.hover!({ series: 0, index: 3 })!)).toEqual([0, 0, 1, 0, 3, 4, 3]);
  });

  it('renderSankey encodes flows by node index; tooltip reads A → B (x% of A); a11y rows are links', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const res = sdk.renderSankey(
      { ...SANKEY, nodes: SANKEY.nodes.map((n, i) => (i === 2 ? { ...n, column: 1, group: 'hub' } : n)) },
      { nodeWidth: 10, align: 'left', linkColor: 'target', linkOpacity: 0.5, iterations: 8, title: 'Energy', format: ',.0f' }
    );
    expect(res).toEqual({ nodeCount: 5, linkCount: 4 });
    const [n, sources, targets, values, columns, groups, opts] = calls.set_sankey_chart[0] as [number, Uint32Array, Uint32Array, Float64Array, Int32Array, Int32Array, Float64Array];
    expect(n).toBe(5);
    expect(Array.from(sources)).toEqual([0, 1, 2, 2]);
    expect(Array.from(targets)).toEqual([2, 2, 3, 4]);
    expect(Array.from(values)).toEqual([30, 20, 35, 15]);
    expect(Array.from(columns)).toEqual([-1, -1, 1, -1, -1]);
    expect(Array.from(groups)).toEqual([-1, -1, 0, -1, -1]);
    expect(Array.from(opts.slice(0, 7))).toEqual([10, NaN, 8, 1, 1, 0.5, 1].map((v) => v));
    // No breadcrumb row
    expect(calls.set_chart_padding.at(-1)).toEqual([12 + 24, 16, 12, 12]);

    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));
    // Link 2: Power -> Homes
    st.hit = new Float64Array([0, 0, 1, 1, 2, 35, 7]);
    canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
    const ctx = seen.at(-1)!;
    expect(ctx.chartType).toBe('sankey');
    expect(ctx.flow).toEqual({ kind: 'link', source: 'Power', target: 'Homes', value: 35, percentOfSource: 70 });
    expect(ctx.details?.metadata.attributes).toMatchObject({ source: 'Power', target: 'Homes', value: 35 });
    const tooltip = body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    expect(tooltip.innerHTML).toContain('Power → Homes');
    expect(tooltip.innerHTML).toContain('(70.0% of Power)');
    // Node hover: inflow / outflow
    st.hit = new Float64Array([0, 0, 1, 0, 2, 50, 2]);
    canvas.fire('pointermove', { buttons: 0, clientX: 310, clientY: 200 });
    expect(seen.at(-1)!.flow).toEqual({ kind: 'node', source: 'Power', value: 50, inflow: 50, outflow: 50 });
    // Clicks do not drill a sankey
    canvas.fire('pointerdown', { button: 0, clientX: 310, clientY: 200 });
    canvas.fire('pointerup', { button: 0, clientX: 310, clientY: 200 });
    expect(calls.set_chart_hierarchy_root).toBeUndefined();

    const model = (sdk as unknown as { a11y: { model(): ReturnType<typeof buildA11yModel> } }).a11y.model()!;
    expect(buildChartSummary(model)).toBe('Energy. Sankey diagram, 5 nodes in 3 columns, 4 links; largest flows: Power to Homes 35, Coal to Power 30, Gas to Power 20.');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Source', 'Target', 'Value', 'Share of source']);
    expect(table.rows[2]).toEqual(['Power', 'Homes', 35, 70]);
    let f = stepFocus(model, null, 'ArrowRight')!;
    expect(f).toEqual({ series: 1, index: 0 });
    f = stepFocus(model, f, 'End')!;
    expect(pointAnnouncement(model, f)).toBe('Power to Industry: 15, 30% of Power. Link 4 of 4.');
    model.custom!.hover!(f);
    expect(calls.chart_hover_hierarchy_item.at(-1)).toEqual([1, 3]);

    // Input errors
    expect(() => sdk.renderSankey({ nodes: [{ id: 'a' }], links: [{ source: 'a', target: 'zz', value: 1 }] })).toThrow('unknown target "zz"');
    const bad = state();
    bad.error = 'sankey links form a cycle: node 0 -> node 1 -> node 0';
    const sdk2 = Charturbo.fromBackend(mockBackend({}, bad));
    expect(() =>
      sdk2.renderSankey({
        nodes: [{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }],
        links: [
          { source: 'a', target: 'b', value: 1 },
          { source: 'b', target: 'a', value: 1 },
        ],
      })
    ).toThrow('Sankey links form a cycle: "Alpha" -> "Beta" -> "Alpha"');
  });

  it('default tooltip html escapes names', () => {
    const ctx: ChartTooltipContext = {
      chartType: 'sankey',
      index: 0,
      xLabel: '',
      items: [{ seriesName: '<b>', value: 1, color: 'red', nodeId: 0 }],
      flow: { kind: 'link', source: '<b>', target: 'x', value: 1, percentOfSource: 50 },
      details: null,
    };
    const html = hierarchyTooltipHtml(ctx, CHARTURBO_THEMES.dark, (v) => String(v), 'en-US');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&#60;b&#62; → x');
  });
});
