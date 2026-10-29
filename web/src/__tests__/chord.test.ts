import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus, tableToCSV } from '../sdk/chart-a11y';
import { chordMeta } from '../sdk/chart-chord';
import { renderChartSpec } from '../sdk/chart-binding';

/** Minimal DOM element: enough for the chart overlay, legend, labels and the tooltip. */
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

interface EngineState {
  hit: Float64Array;
  labels: number[];
  /** `[start, end, value, visible] * n` */
  groups: number[];
  /** `[source, start, end, value, target, start, end, value] * chords` */
  chords: number[];
  colors: number[];
}

function mockBackend(calls: Calls, st: EngineState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_chord_chart: (...args: unknown[]) => {
      record('set_chord_chart')(...args);
      return Math.round(Math.sqrt((args[0] as Float64Array).length));
    },
    chart_chord_groups: () => new Float64Array(st.groups),
    chart_chord_chords: () => new Float64Array(st.chords),
    set_chart_hierarchy_style: record('set_chart_hierarchy_style'),
    chart_hierarchy_colors: () => new Float32Array(st.colors),
    chart_hierarchy_labels: () => new Float64Array([1, st.labels.length / 6, ...st.labels]),
    chart_hover_hierarchy_item: (series: number, index: number) => {
      record('chart_hover_hierarchy_item')(series, index);
      return st.hit;
    },
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0, NaN]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([100, 40, 600, 120, 0]),
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
    clear_scene_objects: record('clear_scene_objects'),
  };
}

/** Flow matrix of the Rust tests: A→B 4, A→C 1, B→A 2, B→C 2, C→A 3. */
const M = [
  [0, 4, 1],
  [2, 0, 2],
  [3, 0, 0],
];
/** d3 `chord()` of M: groups A 5, B 4, C 3; chords A→B (4 / 2), C→A (3 / 1), B→C (2 / 0) */
const GROUPS = [0, 1, 5, 1, 1, 2, 4, 1, 2, 3, 3, 1];
const CHORDS = [0, 0, 0, 4, 1, 0, 0, 2, 2, 0, 0, 3, 0, 0, 0, 1, 1, 0, 0, 2, 2, 0, 0, 0];
const COLORS = [1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 1];

describe('Chord diagram (SDK binding)', () => {
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

  function setup() {
    const st: EngineState = { hit: new Float64Array(0), labels: [], groups: GROUPS, chords: CHORDS, colors: COLORS };
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));
    const tooltip = () => body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    const hover = (hit: number[]) => {
      st.hit = new Float64Array(hit);
      canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
      return seen.at(-1)!;
    };
    return { calls, sdk, st, tooltip, hover };
  }

  it('uploads the matrix and encoded options; names / colors / legend come from the data', () => {
    const { calls, sdk } = setup();
    const res = sdk.renderChordChart({ matrix: M, names: ['A', 'B', 'C'] }, { colors: ['#ff0000'] });
    expect(res).toEqual({ groupCount: 3, chordCount: 3 });
    const [matrix, opts] = calls.set_chord_chart[0] as [Float64Array, Float64Array];
    expect(Array.from(matrix)).toEqual(M.flat());
    const o = Array.from(opts);
    // pad 3 deg, start 0, clockwise, no sorts, undirected, source colors, opacity 0.6, arc 14, labels, no rotate
    expect(o[0]).toBeCloseTo((3 * Math.PI) / 180, 9);
    expect(o.slice(1, 12)).toEqual([0, 1, 0, 0, 0, 0, 0, 0.6, 14, 1, 0]);
    // Label room fits the longest name
    expect(o[12]).toBeGreaterThan(0);
    // Own colors per group (NaN = palette)
    const style = calls.set_chart_hierarchy_style.at(-1)!;
    const own = Array.from(style[1] as Float32Array);
    expect(own.slice(0, 4)).toEqual([1, 0, 0, 1]);
    expect(own.slice(4).every(Number.isNaN)).toBe(true);
    // Legend: one toggle per group
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.map((i) => i.textContent)).toEqual(['A', 'B', 'C']);

    sdk.renderChordChart(
      { matrix: M },
      {
        padAngle: 5,
        startAngle: 90,
        clockwise: false,
        sortGroups: 'descending',
        sortSubgroups: 'ascending',
        sortChords: 'descending',
        directed: true,
        ribbonColor: 'gradient',
        ribbonOpacity: 0.5,
        arcWidth: 20,
        labels: false,
        labelRotate: true,
      }
    );
    const b = Array.from((calls.set_chord_chart[1] as [Float64Array, Float64Array])[1]);
    expect(b[0]).toBeCloseTo((5 * Math.PI) / 180, 9);
    expect(b[1]).toBeCloseTo(Math.PI / 2, 9);
    expect(b.slice(2, 12)).toEqual([0, 2, 1, 2, 1, 2, 0.5, 20, 0, 1]);
    expect(b[12]).toBe(0);
    // Default names
    expect(sdk.getNodeDetails(1)?.metadata.label).toBe('Group 2');
  });

  it('converts ECharts-style nodes / links (names or indices; repeated links add up)', () => {
    const { calls, sdk } = setup();
    sdk.renderChordChart({
      nodes: ['A', { name: 'B', color: '#00ff00' }, 'C'],
      links: [
        { source: 'A', target: 'B', value: 3 },
        { source: 'A', target: 'B', value: 1 },
        { source: 0, target: 2, value: 1 },
        { source: 'B', target: 'A', value: 2 },
        { source: 'B', target: 'C', value: 2 },
        { source: 2, target: 'A', value: 3 },
      ],
    });
    expect(Array.from((calls.set_chord_chart[0] as Float64Array[])[0])).toEqual(M.flat());
    const own = Array.from(calls.set_chart_hierarchy_style.at(-1)![1] as Float32Array);
    expect(own.slice(4, 8)).toEqual([0, 1, 0, 1]);
    expect(sdk.getNodeDetails(2)?.metadata.label).toBe('C');
  });

  it('validates input before the current chart is torn down', () => {
    const { calls, sdk } = setup();
    sdk.renderChordChart({ matrix: M, names: ['A', 'B', 'C'] });
    const cleared = calls.clear_scene_objects?.length ?? 0;
    const bad: [unknown, RegExp][] = [
      [{ matrix: [] }, /at least one group/],
      [{ matrix: [[1, 2], [3]] }, /square/],
      [{ matrix: [[1, -1], [0, 0]] }, /finite and >= 0/],
      [{ matrix: [[1, NaN], [0, 0]] }, /finite and >= 0/],
      [{ matrix: [[0, 0], [0, 0]] }, /> 0/],
      [{ matrix: M, names: ['A'] }, /names/],
      [{ nodes: ['A', 'B'], links: [{ source: 'A', target: 'Z', value: 1 }] }, /unknown node/],
      [{ nodes: ['A', 'A'], links: [] }, /duplicate/],
      [{}, /matrix/],
    ];
    for (const [data, re] of bad) expect(() => sdk.renderChordChart(data as never)).toThrow(re);
    expect(() => sdk.renderChordChart({ matrix: M }, { padAngle: -1 })).toThrow(/padAngle/);
    expect(() => sdk.renderChordChart({ matrix: M }, { ribbonOpacity: 2 })).toThrow(/ribbonOpacity/);
    expect(() => sdk.renderChordChart({ matrix: M }, { sortGroups: 'up' as never })).toThrow(/sortGroups/);
    expect(() => sdk.renderChordChart({ matrix: M }, { ribbonColor: 'red' as never })).toThrow(/ribbonColor/);
    // Colors are parsed before teardown too (sendChordStyle would throw after the clear)
    expect(() => sdk.renderChordChart({ matrix: M }, { colors: ['nope'] })).toThrow(/color/i);
    expect(() => sdk.renderChordChart({ matrix: M }, { palette: ['#00f', 'nope'] })).toThrow(/color/i);
    expect(() => sdk.renderChordChart({ nodes: [{ name: 'A', color: 'nope' }, 'B'], links: [{ source: 'A', target: 'B', value: 1 }] })).toThrow(/color/i);
    expect(calls.set_chord_chart).toHaveLength(1);
    expect(calls.clear_scene_objects?.length ?? 0).toBe(cleared);
    expect(sdk.getNodeDetails(0)?.metadata.label).toBe('A');
  });

  it('tooltip: group totals; ribbons show source → target and the reverse flow when present', () => {
    const { sdk, hover, tooltip } = setup();
    sdk.renderChordChart({ matrix: M, names: ['A', 'B', 'C'] }, { valueLabel: 'Trips' });
    const g = hover([0, 0, 1, 0, 0, 5, 0]);
    expect(g.chartType).toBe('chord');
    expect(g.chord).toEqual({ kind: 'group', source: 0, target: 0, sourceName: 'A', targetName: 'A', value: 5 });
    expect(g.items[0]).toMatchObject({ seriesName: 'A', value: 5, color: 'rgb(255, 0, 0)' });
    expect(tooltip().innerHTML).toContain('Trips');

    const r = hover([0, 1, 1, 1, 1, 4, 4]);
    expect(r.chord).toEqual({ kind: 'ribbon', source: 0, target: 1, sourceName: 'A', targetName: 'B', value: 4, reverse: 2 });
    expect(tooltip().innerHTML).toContain('A → B');
    expect(tooltip().innerHTML).toContain('B → A');
    // B → C has no flow back
    const one = hover([0, 5, 1, 1, 5, 2, 8]);
    expect(one.chord).toMatchObject({ source: 1, target: 2, value: 2 });
    expect(one.chord?.reverse).toBeUndefined();
    expect(tooltip().innerHTML).not.toContain('C → B');
    expect(sdk.getNodeDetails(4)?.metadata).toMatchObject({ label: 'A → B', attributes: { source: 'A', target: 'B', value: 4, reverse: 2 } });
    expect(sdk.getNodeDetails(99)).toBeNull();
  });

  it('legend toggle hides a group in the engine and re-reads the layout', () => {
    const { calls, sdk, st } = setup();
    sdk.renderChordChart({ matrix: M, names: ['A', 'B', 'C'] });
    st.groups = [0, 1, 5, 1, 1, 1, 0, 0, 1, 3, 3, 1];
    st.chords = CHORDS.slice(8, 16);
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    items[1].fire('click', {});
    expect(calls.set_chart_series_visible.at(-1)).toEqual([1, false]);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    // a11y reads the re-laid out chords: only C → A is left
    const model = buildA11yModel((sdk as unknown as { chartMeta: Record<string, unknown> }).chartMeta, {})!;
    expect(buildChartSummary(model)).toContain('1 chord');
    // Hidden groups are not counted
    expect(buildChartSummary(model)).toContain('2 groups');
    sdk.setSeriesVisible(1, true);
    expect(calls.set_chart_series_visible.at(-1)).toEqual([1, true]);
  });

  it('labels: group names outside the ring at the engine anchors, rotated on request', () => {
    const { st, sdk } = setup();
    st.labels = [0, 100, 50, 0, 72, 1, 1, 300, 20, 0, 72, 2, 2, 400, 30, 0.5, 72, -1];
    sdk.renderChordChart({ matrix: M, names: ['A', 'B', 'C'] });
    sdk.render();
    const shown = () => container.querySelectorAll('.charturbo-sdk-chord-label').filter((l) => l.style.display !== 'none');
    expect(shown().map((l) => l.textContent)).toEqual(['A', 'B', 'C']);
    expect(shown()[0].style.transform).toBe('translate(0, -50%)');
    expect(shown()[1].style.transform).toBe('translate(-50%, -100%)');
    expect(shown()[2].style.transform).toBe('rotate(0.5000rad) translate(-100%, -50%)');
    expect(shown()[0].style.left).toBe('100px');
  });

  it('a11y: summary, matrix table / CSV, group / chord keys, engine hover by id', () => {
    const meta = chordMeta({ matrix: M, names: ['A', 'B', 'C'] }, { valueLabel: 'Trips' }, (v) => `${v}`);
    meta.groups = [5, 4, 3];
    meta.chords = [
      { source: 0, target: 1, value: 4, reverse: 2 },
      { source: 1, target: 2, value: 2, reverse: 0 },
      { source: 2, target: 0, value: 3, reverse: 1 },
    ];
    const hovers: number[][] = [];
    meta.engine = { hover: (s, i) => (hovers.push([s, i]), new Float64Array([0, i, 1, s, i, 1, i])) };
    const model = buildA11yModel(meta, { title: 'Flows' })!;
    expect(buildChartSummary(model)).toBe('Flows. Chord diagram, 3 groups, 3 chords; largest: A → B 4, C → A 3, B → C 2.');
    expect(buildChartDescription(model)).toContain('A: total 5.');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['From \\ To', 'A', 'B', 'C']);
    expect(table.rows).toEqual([
      ['A', 0, 4, 1],
      ['B', 2, 0, 2],
      ['C', 3, 0, 0],
    ]);
    expect(tableToCSV(table).split(/\r?\n/)[1]).toBe('A,0,4,1');
    // Left / Right within groups or chords (sorted by key); Down: a group's first chord, Up: a chord's source
    expect(stepFocus(model, null, 'ArrowRight')).toEqual({ series: 0, index: 0 });
    expect(stepFocus(model, { series: 0, index: 0 }, 'ArrowRight')).toEqual({ series: 0, index: 1 });
    expect(stepFocus(model, { series: 0, index: 2 }, 'ArrowRight')).toEqual({ series: 0, index: 2 });
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowDown')).toEqual({ series: 1, index: 0 });
    expect(stepFocus(model, { series: 0, index: 2 }, 'ArrowDown')).toEqual({ series: 1, index: 1 });
    expect(stepFocus(model, { series: 1, index: 0 }, 'End')).toEqual({ series: 1, index: 2 });
    expect(stepFocus(model, { series: 1, index: 2 }, 'ArrowUp')).toEqual({ series: 0, index: 2 });
    expect(pointAnnouncement(model, { series: 0, index: 0 })).toBe('A, total 5. 1 of 3.');
    expect(pointAnnouncement(model, { series: 1, index: 0 })).toBe('A → B 4, B → A 2. 1 of 3.');
    expect(pointAnnouncement(model, { series: 1, index: 1 })).toBe('B → C 2. 2 of 3.');
    // Point ids: groups, then n + source * n + target
    expect(model.pointId(0, 2)).toBe(2);
    expect(model.pointId(1, 1)).toBe(3 + 5);
    model.custom!.hover!({ series: 1, index: 2 });
    expect(hovers.at(-1)).toEqual([1, 6]);
    // Stale chord focus (chords shrank after a legend toggle): no id, no engine hover
    expect(model.pointId(1, 99)).toBe(-1);
    const before = hovers.length;
    model.custom!.hover!({ series: 1, index: 99 });
    expect(hovers.length).toBe(before);
    // Built-in text follows the chart locale
    expect(buildChartSummary(buildA11yModel(meta, { locale: 'ko' })!)).toContain('코드 다이어그램');
    expect(buildChartSummary(buildA11yModel(meta, { locale: 'zh-CN' })!)).toContain('和弦图');
  });

  it('React / Vue dispatch', () => {
    const sdk = { renderChordChart: vi.fn() } as unknown as Charturbo;
    renderChartSpec(sdk, { type: 'chord', data: { matrix: M }, options: { directed: true } });
    expect((sdk.renderChordChart as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([{ matrix: M }, { directed: true }]);
  });
});
