import { describe, expect, it } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, WasmCharturboEngineBackend, NodeDetails } from '../sdk/charturbo';

/** Minimal backend recording every native chart call. */
function mockBackend(seriesCount = 1) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let hit = new Float64Array(0);
  const backend: WasmCharturboEngineBackend = {
    set_scatter_chart: record('set_scatter_chart', 0),
    chart_series_count: () => seriesCount,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    chart_zoom_xy: record('chart_zoom_xy'),
    chart_pan_xy: record('chart_pan_xy'),
    chart_zoom_x: record('chart_zoom_x'),
    chart_hover_at_ndc: (x: number, y: number) => {
      record('chart_hover_at_ndc')(x, y);
      return hit;
    },
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0]),
    reload_dataset: () => {},
    load_raw_dataset: record('load_raw_dataset'),
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
  return { backend, calls, setHit: (h: number[]) => (hit = new Float64Array(h)) };
}

/** Canvas stand-in capturing the listeners `enableNodeInteractions` attaches. */
function fakeCanvas() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const canvas = {
    style: {} as CSSStyleDeclaration,
    addEventListener: (type: string, h: (e: unknown) => void) => (handlers[type] = h),
    removeEventListener: (type: string) => delete handlers[type],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
  } as unknown as HTMLCanvasElement;
  return { canvas, handlers };
}

describe('Native scatter chart (SDK binding)', () => {
  it('sends flat typed arrays and layout to the engine without loading graph nodes', () => {
    const { backend, calls } = mockBackend(3);
    const sdk = Charturbo.fromBackend(backend);
    const res = sdk.renderScatterChart(
      {
        x: [1, 2, 3, 4],
        y: new Float32Array([5, 6, 7, 8]),
        sizes: [2, 4, 6, 8],
        clusters: [0, 1, 2, 1],
        colors: [1, 0, 0, 1], // not 4 * N: ignored
      },
      { pointRadius: 5, opacity: 0.5, verticalGrid: false, seriesColors: [[0, 1, 0, 1]] }
    );
    expect(res.pointCount).toBe(4);
    expect(calls.load_raw_dataset).toBeUndefined();
    const [xs, ys, sizes, ids, colors, seriesColors, w, h, radius, opacity, ring, gridX] = calls
      .set_scatter_chart[0] as [
      Float32Array, Float32Array, Float32Array, Uint16Array, Float32Array, Float32Array,
      number, number, number, number, number, boolean,
    ];
    expect(xs).toBeInstanceOf(Float32Array);
    expect(Array.from(xs)).toEqual([1, 2, 3, 4]);
    expect(Array.from(ys)).toEqual([5, 6, 7, 8]);
    expect(Array.from(sizes)).toEqual([2, 4, 6, 8]);
    expect(ids).toBeInstanceOf(Uint16Array);
    expect(Array.from(ids)).toEqual([0, 1, 2, 1]);
    expect(colors.length).toBe(0);
    expect(Array.from(seriesColors)).toEqual([0, 1, 0, 1]);
    expect([w, h, radius, opacity, gridX]).toEqual([168, 94, 5, 0.5, false]);
    expect(ring).toBe(1); // bubbles get a separating ring by default

    // Scatter hover is always nearest with a 12 px default pick radius
    const hover = calls.set_chart_hover_style[0][0] as Float32Array;
    expect(hover[0]).toBe(1);
    expect(hover[19]).toBe(12);
    // 3 series -> legend shown: top padding = 12 + legend 28
    expect(calls.set_chart_padding[0]).toEqual([40, 16, 30, 56]);
    expect(sdk.handlesChartNavigation()).toBe(true);
  });

  it('defaults: no sizes means no ring, palette series colors, single series has no legend', () => {
    const { backend, calls } = mockBackend(1);
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderScatterChart({ x: new Float32Array(10), y: new Float32Array(12) });
    const args = calls.set_scatter_chart[0];
    expect((args[0] as Float32Array).length).toBe(10); // trimmed to the shorter axis
    expect((args[1] as Float32Array).length).toBe(10);
    expect((args[3] as Uint16Array).length).toBe(0);
    expect(args[10]).toBe(0);
    expect((args[5] as Float32Array).length).toBe(CHARTURBO_THEMES.dark.palette.length * 4);
    expect(calls.set_chart_padding[0]).toEqual([12, 16, 30, 56]);
  });

  it('point details carry x / y / series and merge user metadata', () => {
    const { backend } = mockBackend(2);
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderScatterChart(
      { x: [10, 20], y: [30, 40], clusters: [0, 1] },
      { seriesNames: ['Alpha', 'Beta'] }
    );
    sdk.setSingleNodeMetadata(1, { label: 'Custom', attributes: { score: 9 } });
    const d = sdk.getNodeDetails(1)!;
    expect(d.label).toBe('Custom');
    expect(d.clusterId).toBe(1);
    expect(d.metadata.attributes).toEqual({ series: 'Beta', x: 20, y: 40, score: 9 });
    expect(d.position).toEqual([1, 2, 0]);
    expect(sdk.getNodeDetails(0)?.metadata.category).toBe('Alpha');
    expect(sdk.getNodeDetails(2)).toBeNull();
  });

  it('legend visibility / emphasis and x+y navigation are thin engine calls', () => {
    const { backend, calls } = mockBackend(3);
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderScatterChart({ x: [0, 1, 2], y: [0, 1, 2], clusters: [0, 1, 2] });
    sdk.setSeriesVisible(2, false);
    sdk.setSeriesVisible(9, false); // out of range: ignored
    expect(sdk.isSeriesVisible(2)).toBe(false);
    expect(sdk.isSeriesVisible(0)).toBe(true);
    sdk.emphasizeSeries(1);
    sdk.zoomChartXY(0.5, 0.2, -0.4);
    sdk.panChartXY(0.1, 0.2);
    expect(calls.set_chart_series_visible).toEqual([[2, false]]);
    expect(calls.set_chart_emphasis).toEqual([[1]]);
    expect(calls.chart_zoom_xy).toEqual([[0.5, 0.2, -0.4]]);
    expect(calls.chart_pan_xy).toEqual([[0.1, 0.2]]);
  });

  it('pointer hover resolves engine hits; wheel / drag zoom and pan both axes', () => {
    const { backend, calls, setHit } = mockBackend(2);
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderScatterChart({ x: [1.5, 2.5, 3.5], y: [7, 8, 9], clusters: [0, 1, 1] }, { seriesNames: ['A', 'B'] });
    const { canvas, handlers } = fakeCanvas();
    const hovered: (NodeDetails | null)[] = [];
    sdk.enableNodeInteractions(canvas, { onNodeHover: (d) => hovered.push(d) });

    // Engine reports point 2 (series 1, y = 9)
    setHit([0, 0, 1, 1, 2, 9, 2]);
    handlers.pointermove({ buttons: 0, clientX: 150, clientY: 25 });
    expect(calls.chart_hover_at_ndc.at(-1)).toEqual([0.5, 0.5]);
    expect(hovered.at(-1)?.metadata.attributes).toMatchObject({ series: 'B', x: 3.5, y: 9 });

    // Wheel zooms both axes around the pointer
    const wheel = { deltaY: -100, clientX: 50, clientY: 75, preventDefault: () => {} };
    handlers.wheel(wheel);
    const [factor, ax, ay] = calls.chart_zoom_xy[0] as number[];
    expect(factor).toBeLessThan(1);
    expect([ax, ay]).toEqual([-0.5, -0.5]);
    expect(calls.chart_zoom_x).toBeUndefined();

    // Drag right / down pans: +x, -y in NDC
    handlers.pointerdown({ button: 0, clientX: 100, clientY: 50, shiftKey: false });
    handlers.pointermove({ buttons: 1, clientX: 120, clientY: 60 });
    expect(calls.chart_pan_xy[0]).toEqual([0.2, -0.2]);
  });
});
