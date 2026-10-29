import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { encodePictorial, PICTORIAL_STRIDE, type PictorialSymbolOptions } from '../sdk/chart-pictorial';
import { buildA11yModel, buildChartSummary, stepFocus } from '../sdk/chart-a11y';
import { renderChartSpec } from '../sdk/chart-binding';

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
  id = '';
  tabIndex = -1;
  classList = { add: () => {}, remove: () => {} };

  constructor(readonly tag: string) {}

  appendChild(c: FakeEl): FakeEl {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    cs.forEach((c) => this.appendChild(c));
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children = [];
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
}

type Calls = Record<string, unknown[][]>;

function mockBackend(calls: Calls): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_bar_chart: record('set_bar_chart', 3),
    set_bar_chart_multi: record('set_bar_chart_multi', 4),
    set_chart_bar_pictorial: record('set_chart_bar_pictorial', true),
    // The engine validates path data (here: any path with an M command)
    pictorial_symbol_valid: (s: string) => !s.startsWith('path://') || /^path:\/\/\s*[Mm]/.test(s),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    set_bar_style: record('set_bar_style', true),
    set_chart_bar_background: record('set_chart_bar_background', true),
    chart_hover_at_ndc: () => new Float64Array(0),
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
    clear_scene_objects: record('clear_scene_objects'),
  };
}

const valid = (s: string) => !s.startsWith('path://') || /^path:\/\/\s*[Mm]/.test(s);
const rec = (records: Float32Array, i: number) => Array.from(records.subarray(i * PICTORIAL_STRIDE, (i + 1) * PICTORIAL_STRIDE));

describe('encodePictorial', () => {
  it('uses the ECharts defaults: circle, 100% x 100%, margin 15%, start, no repeat / clip / bounds', () => {
    const { symbols, records } = encodePictorial([undefined], undefined, valid);
    expect(PICTORIAL_STRIDE).toBe(19);
    expect(symbols).toBe('circle');
    const r = rec(records, 0);
    expect(r.slice(0, 17)).toEqual([0, 0, 0, 100, 1, 100, 1, 15, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(Number.isNaN(r[17]) && Number.isNaN(r[18])).toBe(true);
  });

  it('encodes sizes, margins, repeat, position, offset, rotation and bounds; items override the defaults', () => {
    const defaults: PictorialSymbolOptions = {
      symbol: 'rect',
      symbolSize: ['60%', 12],
      symbolRepeat: true,
      symbolMargin: '10%!',
      symbolClip: true,
      symbolPosition: 'end',
      symbolOffset: [4, '-50%'],
      symbolRotate: 30,
      symbolBoundingData: [80, -20],
    };
    const { symbols, records } = encodePictorial(
      [
        undefined,
        { symbol: 'path://M0 0 L1 0 L0 1 Z', symbolRepeat: 'fixed', symbolMargin: 3, symbolSize: 20, symbolBoundingData: 50 },
        { symbol: 'rect', symbolRepeat: 7, symbolPosition: 'center', symbolOffset: '25%', symbolRotate: -90 },
      ],
      defaults,
      valid
    );
    // Distinct symbols in first-use order
    expect(symbols).toBe('rect\npath://M0 0 L1 0 L0 1 Z');
    expect(rec(records, 0)).toEqual([0, 1, 0, 60, 1, 12, 0, 10, 1, 1, 1, 1, 4, 0, -50, 1, 30, -20, 80]);
    expect(rec(records, 1)).toEqual([1, 2, 0, 20, 0, 20, 0, 3, 0, 0, 1, 1, 4, 0, -50, 1, 30, 50, 50]);
    expect(rec(records, 2)).toEqual([0, 3, 7, 60, 1, 12, 0, 10, 1, 1, 1, 2, 25, 1, 25, 1, -90, -20, 80]);
  });

  it('rejects images, unknown symbols, invalid paths and out-of-range options with the option name', () => {
    const bad = (o: PictorialSymbolOptions) => () => encodePictorial([o], undefined, valid);
    expect(bad({ symbol: 'image://x.png' as never })).toThrow(/image:\/\/ symbols are not supported/);
    expect(bad({ symbol: 'star' as never })).toThrow(/symbol/);
    expect(bad({ symbol: 'path://L 1 1' })).toThrow(/invalid path/);
    expect(bad({ symbolSize: -2 })).toThrow(/symbolSize/);
    expect(bad({ symbolSize: '50px' as never })).toThrow(/symbolSize/);
    expect(bad({ symbolRepeat: 2.5 })).toThrow(/symbolRepeat/);
    expect(bad({ symbolRepeat: 5000 })).toThrow(/symbolRepeat/);
    expect(bad({ symbolPosition: 'middle' as never })).toThrow(/symbolPosition/);
    expect(bad({ symbolRotate: NaN })).toThrow(/symbolRotate/);
    expect(bad({ symbolBoundingData: [1, Infinity] as never })).toThrow(/symbolBoundingData/);
    expect(bad({ symbolMargin: 'wide' as never })).toThrow(/symbolMargin/);
  });
});

describe('renderPictorialBarChart', () => {
  let body: FakeEl;

  beforeEach(() => {
    body = new FakeEl('body');
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

  it('renders 2D bars, then turns them into symbols (single series: per-item options)', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    const out = sdk.renderPictorialBarChart(
      [
        { label: 'A', value: 10 },
        { label: 'B', value: 20, symbol: 'triangle' },
        { label: 'C', value: -5 },
      ],
      { symbol: 'roundRect', symbolRepeat: true, symbolSize: [24, 24], orientation: 'horizontal' }
    );
    expect(out).toEqual({ barCount: 3 });
    expect(calls.set_bar_chart.length).toBe(1);
    expect(calls.set_bar_style.length).toBe(1);
    const [symbols, records] = calls.set_chart_bar_pictorial.at(-1)! as [string, Float32Array];
    expect(symbols).toBe('roundRect\ntriangle');
    expect(records.length).toBe(3 * PICTORIAL_STRIDE);
    expect(rec(records, 1)[0]).toBe(1);
    type Meta = { chartMeta: { kind: string; pictorial?: boolean } };
    expect((sdk as unknown as Meta).chartMeta).toMatchObject({ kind: 'bar', pictorial: true });
  });

  it('grouped / stacked data: one record per bar id from the series options', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderPictorialBarChart(
      {
        categories: ['Q1', 'Q2'],
        series: [
          { name: 'North', values: [3, 4], symbol: 'circle' },
          { name: 'South', values: [5, 6], symbolRepeat: 3 },
        ],
      },
      { mode: 'stacked', symbol: 'rect' }
    );
    expect(calls.set_bar_chart_multi.length).toBe(1);
    const [symbols, records] = calls.set_chart_bar_pictorial.at(-1)! as [string, Float32Array];
    expect(symbols).toBe('circle\nrect');
    expect([0, 1, 2, 3].map((i) => rec(records, i).slice(0, 3))).toEqual([
      [0, 0, 0],
      [0, 0, 0],
      [1, 3, 3],
      [1, 3, 3],
    ]);
  });

  it('validates before clearing the current chart', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderPictorialBarChart([{ label: 'A', value: 1 }]);
    const cleared = calls.clear_scene_objects?.length ?? 0;
    expect(() => sdk.renderPictorialBarChart([{ label: 'A', value: 1, symbol: 'image://a.png' as never }])).toThrow(/image/);
    expect(() => sdk.renderPictorialBarChart([{ label: 'A', value: 1 }], { viewMode: '3d' })).toThrow(/2D/);
    expect(calls.clear_scene_objects?.length ?? 0).toBe(cleared);
    expect(calls.set_bar_chart.length).toBe(1);
  });

  it('a11y summary names the pictorial bar chart in every language', () => {
    const meta = { kind: 'bar', pictorial: true, colors: [], metadata: [{ label: 'A', attributes: { value: 1 } }] };
    expect(buildChartSummary(buildA11yModel(meta, {}, undefined, 'en')!)).toMatch(/^Pictorial bar chart/);
    expect(buildChartSummary(buildA11yModel(meta, {}, undefined, 'ko')!)).toMatch(/^픽토리얼 막대 차트/);
    expect(buildChartSummary(buildA11yModel(meta, {}, undefined, 'zh')!)).toMatch(/^象形柱图/);
    const multi = { kind: 'bar-multi', pictorial: true, mode: 'stacked', names: ['N'], colors: [], categories: ['Q1'], values: [1], visible: [true] };
    expect(buildChartSummary(buildA11yModel(multi, {}, undefined, 'en')!)).toMatch(/^Pictorial bar chart/);
  });

  it('normalizes whitespace of multi-line path:// symbols (the symbol list is newline-separated)', () => {
    const seen: string[] = [];
    const path = `path://M0 0
      L10 0
      L10 10 Z` as const;
    const { symbols } = encodePictorial([{ symbol: path }, { symbol: 'path://M0 0 L10 0 L10 10 Z' }], {}, (s) => (seen.push(s), true));
    expect(symbols).toBe('path://M0 0 L10 0 L10 10 Z');
    expect(seen).toEqual(['path://M0 0 L10 0 L10 10 Z']);
  });

  it('throws when the engine rejects the symbols or lacks pictorial support', () => {
    const rejecting = { ...mockBackend({}), set_chart_bar_pictorial: () => false };
    expect(() => Charturbo.fromBackend(rejecting).renderPictorialBarChart([{ label: 'A', value: 1 }])).toThrow(/rejected/);

    const calls: Calls = {};
    const old = mockBackend(calls);
    delete old.set_chart_bar_pictorial;
    delete old.pictorial_symbol_valid;
    const sdk = Charturbo.fromBackend(old);
    expect(() => sdk.renderPictorialBarChart([{ label: 'A', value: 1 }])).toThrow(/no pictorial bar support/);
    expect(calls.set_bar_chart).toBeUndefined();
  });

  it('keeps the bar data table, CSV export and keyboard focus', () => {
    const sdk = Charturbo.fromBackend(mockBackend({}));
    sdk.renderPictorialBarChart([
      { label: 'A', value: 3, symbol: 'circle' },
      { label: 'B', value: 5, symbol: 'diamond' },
    ]);
    // (values come from the mocked engine; the rows are the bars, one per item)
    expect(sdk.getChartDataTable()!.rows.map((r) => r[0])).toEqual(['A', 'B']);
    expect(sdk.exportChartCSV().split('\r\n').filter(Boolean)).toHaveLength(3);
    const model = buildA11yModel({ kind: 'bar', pictorial: true, colors: [], metadata: [{ label: 'A', attributes: { value: 3 } }, { label: 'B', attributes: { value: 5 } }] }, {}, undefined, 'en')!;
    expect(stepFocus(model, { series: 0, index: 0 }, 'ArrowRight')).toEqual({ series: 0, index: 1 });
  });

  it("the components' type 'pictorialBar' renders through renderPictorialBarChart", () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    renderChartSpec(sdk, { type: 'pictorialBar', data: [{ label: 'A', value: 2 }], options: { symbol: 'diamond' } });
    expect((calls.set_chart_bar_pictorial.at(-1)! as [string])[0]).toBe('diamond');
  });
});
