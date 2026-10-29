import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { resolveTreeNode, sendTree, syncTree, treeA11yModel, treePath, type CharturboTreeToggleEvent, type TreeChartNode } from '../sdk/chart-tree';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus } from '../sdk/chart-a11y';

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
 * B(4) [b1(5)]. Values optional: only the leaves a1 / a2 carry one.
 */
const TREE: TreeChartNode = {
  name: 'Root',
  children: [
    { name: 'A', children: [{ name: 'a1', value: 6 }, { name: 'a2', value: 4 }] },
    { name: 'B', collapsed: true, children: [{ name: 'b1' }] },
  ],
};
const PARENT = [-1, 0, 1, 1, 0, 4];
const KIDS: Record<number, number[]> = { 0: [1, 4], 1: [2, 3], 4: [5] };

interface MockState {
  expanded: boolean[];
  hit: Float64Array;
  labelsRev: number;
  labels: number[];
}

function mockBackend(calls: Calls, st: MockState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const shown = (n: number) => {
    for (let v = PARENT[n]; v >= 0; v = PARENT[v]) if (!st.expanded[v]) return false;
    return true;
  };
  const setExpanded = (n: number, e: boolean) => {
    if (!KIDS[n] || !shown(n) || st.expanded[n] === e) return false;
    st.expanded[n] = e;
    st.labelsRev++;
    return true;
  };
  return {
    set_tree_chart: (...args: unknown[]) => {
      (calls.set_tree_chart ??= []).push(args);
      return 6;
    },
    set_chart_tree_expanded: (n: number, e: boolean) => {
      (calls.set_chart_tree_expanded ??= []).push([n, e]);
      return setExpanded(n, e);
    },
    chart_tree_toggle: (n: number) => {
      (calls.chart_tree_toggle ??= []).push([n]);
      return setExpanded(n, !st.expanded[n]);
    },
    chart_tree_expanded: () => Uint8Array.from(st.expanded, (e) => (e ? 1 : 0)),
    set_chart_hierarchy_style: record('set_chart_hierarchy_style'),
    chart_hierarchy_info: () => new Float64Array([6, 0, 0, 0]),
    chart_hierarchy_colors: () => Float32Array.from({ length: 24 }, (_, i) => (i % 4 === 3 ? 1 : 0.5)),
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

/** Engine state after `initialTreeDepth` 2 with B collapsed by its input flag */
function state(): MockState {
  return {
    expanded: [true, true, false, false, false, false],
    hit: new Float64Array(0),
    labelsRev: 1,
    // Root ends at its anchor; a1 rotated (radial), starts at its anchor
    // Root room = its width estimate less f32 rounding: still fits
    labels: [0, 100, 200, 0, 4 * 6.8 - 0.001, -1, 2, 300, 120, Math.PI / 4, 60, 1],
  };
}

type A11yHost = { a11y: { model(): ReturnType<typeof buildA11yModel> } };

describe('Tidy tree (SDK binding)', () => {
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

  it('renderTree sends parents, per-node collapsed state, label widths and options; no axes or brush', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, state()));
    const res = sdk.renderTree(TREE, {
      layout: 'radial',
      orient: 'BT',
      edgeShape: 'polyline',
      initialTreeDepth: 1,
      symbol: 'diamond',
      symbolSize: 9,
      lineWidth: 2,
      curvature: 0.3,
      colorBy: 'group',
      title: 'Org',
      colors: ['#ff0000'],
    });
    expect(res.nodeCount).toBe(6);
    const [parents, st, labelPx, opts] = calls.set_tree_chart[0] as [Int32Array, Uint8Array, Float32Array, Float64Array];
    expect(Array.from(parents)).toEqual(PARENT);
    // B carries `collapsed: true`; the others follow initialTreeDepth
    expect(Array.from(st)).toEqual([0, 0, 0, 0, 2, 0]);
    // One width per node plus the synthetic root slot
    expect(labelPx.length).toBe(7);
    expect(labelPx[0]).toBeCloseTo(4 * 6.8);
    expect(Array.from(opts)).toEqual([1, 3, 1, 1, 3, 9, 2, 0.3, 1, 1, 14]);
    const [palette, colors] = calls.set_chart_hierarchy_style[0] as Float32Array[];
    expect(Array.from(palette)).toEqual([1, 0, 0, 1]);
    expect(colors.length).toBe(24);
    // Title only on top: no legend, no breadcrumb, no axis margins
    expect(calls.set_chart_padding.at(-1)).toEqual([12 + 24, 16, 12, 12]);
    expect(sdk.handlesChartNavigation()).toBe(false);
    sdk.setChartBrush('x');
    expect(sdk.handlesChartBrush()).toBe(false);

    // Defaults travel as NaN; `collapsed: false` forces a node open
    sdk.renderTree({ name: 'r', collapsed: false, children: [{ name: 'c' }] });
    const [, st2, , def] = calls.set_tree_chart[1] as [Int32Array, Uint8Array, Float32Array, Float64Array];
    expect(Array.from(st2)).toEqual([1, 0]);
    expect(Array.from(def.slice(0, 3))).toEqual([0, 0, 0]);
    expect([3, 5, 6, 7].every((k) => Number.isNaN(def[k]))).toBe(true);
    expect(def[4]).toBe(0);
    // The theme re-sends the palette
    sdk.setTheme('light');
    const last = calls.set_chart_hierarchy_style.at(-1) as Float32Array[];
    expect(Array.from(last[0].slice(0, 4))).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.light.palette[0])));
  });

  it('flat rows with several roots hang under a synthetic root; collapsed flags follow row order', () => {
    const calls: Calls = {};
    const meta = sendTree(mockBackend(calls, state()), [
      { id: 'x', name: 'X' },
      { id: 'y', name: 'Y', collapsed: true },
      { id: 'y1', parent: 'y', value: 3 },
    ]);
    expect(Array.from(calls.set_tree_chart[0][1] as Uint8Array)).toEqual([0, 2, 0]);
    expect(meta.treeRoot).toBe(3);
    expect(meta.children[3]).toEqual([0, 1]);
    expect(meta.children[1]).toEqual([2]);
    expect(meta.nodeNames).toEqual(['X', 'Y', 'y1', 'All']);
    expect(Array.from(meta.depth)).toEqual([1, 1, 2, 0]);
    expect(resolveTreeNode(meta, 'y1')).toBe(2);
    expect(resolveTreeNode(meta, 'Y')).toBe(1);
    expect(resolveTreeNode(meta, 9)).toBe(-1);
    expect(treePath(meta, 2)).toEqual([1, 2]);
  });

  it('hover tooltip shows the path and value (none when missing); labels rotate at the engine anchors', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderTree(TREE, { format: '$,.0f' });
    sdk.render();
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));

    st.hit = new Float64Array([0, 0, 1, 0, 2, 6, 2]);
    canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
    const ctx = seen.at(-1)!;
    expect(ctx.chartType).toBe('tree');
    expect(ctx.hierarchy).toMatchObject({ node: 2, name: 'a1', path: ['Root', 'A', 'a1'], value: 6, depth: 2, children: 0 });
    expect(ctx.details?.metadata.label).toBe('Root › A › a1');
    const tooltip = body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    expect(tooltip.innerHTML).toContain('Root › A ›');
    expect(tooltip.innerHTML).toContain('$6');
    expect(tooltip.innerHTML).not.toContain('of parent');

    // No value: no number, no NaN
    st.hit = new Float64Array([0, 0, 1, 0, 1, 0, 1]);
    canvas.fire('pointermove', { buttons: 0, clientX: 310, clientY: 200 });
    expect(seen.at(-1)!.hierarchy!.name).toBe('A');
    expect(tooltip.innerHTML).not.toContain('NaN');

    const labels = container.querySelectorAll('.charturbo-sdk-tree-label');
    expect(labels.map((l) => l.textContent)).toEqual(['Root', 'a1']);
    expect([labels[0].style.left, labels[0].style.top, labels[0].style.transform]).toEqual(['100px', '200px', 'translate(-100%, -50%)']);
    expect(labels[1].style.transform).toBe('rotate(0.7854rad) translate(0, -50%)');
  });

  it('a click toggles a parent and emits treeToggle; leaves and expandAndCollapse: false do not toggle', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderTree(TREE);
    sdk.render();
    const toggles: CharturboTreeToggleEvent[] = [];
    sdk.on('treeToggle', (e) => toggles.push(e));

    // Click on A (expanded): collapse
    st.hit = new Float64Array([0, 0, 1, 0, 1, 0, 1]);
    canvas.fire('pointerdown', { button: 0, clientX: 300, clientY: 200 });
    canvas.fire('pointerup', { button: 0, clientX: 300, clientY: 200 });
    expect(calls.chart_tree_toggle).toEqual([[1]]);
    expect(toggles).toEqual([{ node: 1, id: undefined, name: 'A', path: ['Root', 'A'], expanded: false }]);
    // Click on a leaf: nothing
    st.hit = new Float64Array([0, 0, 1, 0, 5, 0, 5]);
    canvas.fire('pointerdown', { button: 0, clientX: 300, clientY: 200 });
    canvas.fire('pointerup', { button: 0, clientX: 300, clientY: 200 });
    expect(toggles.length).toBe(1);

    // API: by name; unchanged / leaf / unknown return false
    expect(sdk.setTreeNodeExpanded('B', true)).toBe(true);
    expect(toggles.at(-1)).toMatchObject({ name: 'B', expanded: true });
    expect(sdk.setTreeNodeExpanded('B', true)).toBe(false);
    expect(sdk.toggleTreeNode('b1')).toBe(false);
    expect(sdk.toggleTreeNode('nope')).toBe(false);
    expect(sdk.getNodeDetails(4)?.metadata.tags).toEqual(['tree', 'parent', 'expanded']);

    // expandAndCollapse: false keeps clicks inert
    const calls2: Calls = {};
    const st2 = state();
    const canvas2 = container.appendChild(new FakeEl('canvas'));
    const fixed = Charturbo.fromBackend(mockBackend(calls2, st2));
    fixed.enableNodeInteractions(canvas2 as unknown as HTMLCanvasElement);
    fixed.renderTree(TREE, { expandAndCollapse: false });
    fixed.render();
    st2.hit = new Float64Array([0, 0, 1, 0, 1, 0, 1]);
    canvas2.fire('pointerdown', { button: 0, clientX: 300, clientY: 200 });
    canvas2.fire('pointerup', { button: 0, clientX: 300, clientY: 200 });
    expect(calls2.chart_tree_toggle).toBeUndefined();
  });

  it('a11y: summary, node table, tree keys, Enter / Space toggle', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.renderTree(TREE, { title: 'Org', valueLabel: 'Headcount' });
    const a11y = (sdk as unknown as A11yHost).a11y;
    const model = a11y.model()!;
    expect(model.kind).toBe('tree');
    expect(buildChartSummary(model)).toBe('Org. Tree diagram, 6 nodes in 3 levels, 5 shown; root Root with A, B.');
    expect(buildChartDescription(model)).toContain('Enter or Space to expand or collapse');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Path', 'Headcount', 'Depth', 'State']);
    expect(table.rows).toEqual([
      ['Root', null, 0, 'expanded'],
      ['Root › A', null, 1, 'expanded'],
      ['Root › A › a1', 6, 2, 'leaf'],
      ['Root › A › a2', 4, 2, 'leaf'],
      ['Root › B', null, 1, 'collapsed'],
      ['Root › B › b1', null, 2, 'leaf'],
    ]);

    // Down / Up between siblings, Right into an expanded node, Left to the parent
    let f = stepFocus(model, null, 'ArrowDown')!;
    expect(f).toEqual({ series: 0, index: 0 });
    f = stepFocus(model, f, 'ArrowRight')!;
    expect(f.index).toBe(1);
    expect(stepFocus(model, f, 'ArrowDown')!.index).toBe(4);
    expect(stepFocus(model, f, 'ArrowUp')!.index).toBe(1);
    // B is collapsed: Right stays
    expect(stepFocus(model, { series: 0, index: 4 }, 'ArrowRight')!.index).toBe(4);
    f = stepFocus(model, f, 'ArrowRight')!;
    expect(f.index).toBe(2);
    expect(pointAnnouncement(model, f)).toBe('a1, 6. 1 of 2, level 2.');
    expect(stepFocus(model, f, 'End')!.index).toBe(3);
    expect(stepFocus(model, f, 'ArrowLeft')!.index).toBe(1);
    expect(pointAnnouncement(model, { series: 0, index: 4 })).toBe('B, collapsed, 1 child. 2 of 2, level 1. Press Enter to expand.');

    // Enter / Space toggle the focused parent; leaves fall through
    expect(model.custom!.key!({ series: 0, index: 4 }, ' ')).toEqual({ focus: { series: 0, index: 4 } });
    expect(st.expanded[4]).toBe(true);
    expect(a11y.model()!.custom!.key!({ series: 0, index: 4 }, 'Enter')).toEqual({ focus: { series: 0, index: 4 } });
    expect(st.expanded[4]).toBe(false);
    expect(a11y.model()!.custom!.key!({ series: 0, index: 2 }, 'Enter')).toBeNull();
    expect(a11y.model()!.custom!.key!(null, 'Escape')).toBeNull();
    expect(Array.from(model.custom!.hover!({ series: 0, index: 3 })!)).toEqual([0, 0, 1, 0, 3, 0, 3]);
  });

  it('Korean and Chinese text: summary, announcement, table headers', () => {
    const backend = mockBackend({}, state());
    const common = { formatValue: (v: number) => String(v) };
    const meta = sendTree(backend, TREE, undefined, 'ko');
    syncTree(backend, meta, 'ko');
    const ko = treeA11yModel(meta, { ...common, locale: 'ko' });
    expect(buildChartSummary(ko)).toContain('트리 다이어그램');
    expect(pointAnnouncement(ko, { series: 0, index: 4 })).toContain('접힘');
    expect(buildDataTable(ko).columns).toEqual(['경로', '값', '깊이', '상태']);
    const zh = treeA11yModel(meta, { ...common, locale: 'zh-CN' });
    expect(buildChartSummary(zh)).toContain('树图');
    expect(buildDataTable(zh).columns.slice(2)).toEqual(['深度', '状态']);
  });
});
