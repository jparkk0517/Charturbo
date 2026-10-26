import { describe, expect, it } from 'vitest';
import { formatChartTime, VizEngineSDK, WasmVizEngineBackend } from '../sdk/viz-engine-sdk';

/** Mock backend recording chart calls (same pattern as benchmark-core.test.ts). */
function mockSdk(withXy = true) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const backend: WasmVizEngineBackend = {
    set_line_chart: record('set_line_chart', 0),
    ...(withXy ? { set_line_chart_xy: record('set_line_chart_xy', 0) } : {}),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
    set_clear_color: record('set_clear_color'),
    set_chart_padding: record('set_chart_padding'),
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
  return { sdk: VizEngineSDK.fromBackend(backend), calls };
}

type XyArgs = [Float32Array, Uint32Array, Float64Array, Float32Array, Float32Array, number, number, number, number];

// 2026-02-01T00:00:00Z
const FEB_1 = Date.UTC(2026, 1, 1);

describe('line charts with real x values', () => {
  it('packs Date x as epoch ms and selects the time scale', () => {
    const { sdk, calls } = mockSdk();
    const days = (n: number, from: number) => Array.from({ length: n }, (_, i) => new Date(from + i * 86_400_000));
    sdk.renderLineChart([
      { name: 'A', values: [1, 2, 3], x: days(3, FEB_1) },
      { name: 'B', values: [5, 6], x: days(2, FEB_1 + 3_600_000) },
    ]);
    expect(calls.set_line_chart).toBeUndefined();
    const [values, lengths, xs, , , , , viewMode, xKind] = calls.set_line_chart_xy[0] as XyArgs;
    expect(Array.from(values)).toEqual([1, 2, 3, 5, 6]);
    expect(Array.from(lengths)).toEqual([3, 2]);
    // Full f64 precision of epoch ms survives the packing
    expect(Array.from(xs)).toEqual([FEB_1, FEB_1 + 86_400_000, FEB_1 + 2 * 86_400_000, FEB_1 + 3_600_000, FEB_1 + 90_000_000]);
    expect(viewMode).toBe(0);
    expect(xKind).toBe(1);

    // Details / tooltip label use the real x, formatted in the chart zone (default: local)
    const d = sdk.getNodeDetails(4);
    expect(d?.metadata.attributes?.series).toBe('B');
    expect(d?.metadata.attributes?.index).toBe(1);
    expect(d?.metadata.attributes?.x).toBe(formatChartTime(FEB_1 + 90_000_000, undefined, undefined, 'local'));
    expect(d?.metadata.attributes?.stepIndex).toBeUndefined();
    expect(d?.label).toContain('B · ');
  });

  it('defaults numeric x to the numeric scale and honours an explicit type', () => {
    const { sdk, calls } = mockSdk();
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3], x: new Float64Array([0.5, 2, 40]) }]);
    expect((calls.set_line_chart_xy[0] as XyArgs)[8]).toBe(0);
    expect(sdk.getNodeDetails(2)?.metadata.attributes?.x).toBe('40');
    sdk.renderLineChart([{ name: 'A', values: [1, 2], x: [10_020, 10_040.125] }], { locale: 'en-US' });
    expect(sdk.getNodeDetails(1)?.metadata.attributes?.x).toBe('10,040.125');

    const t0 = 1_767_225_600_000;
    sdk.renderLineChart([{ name: 'A', values: [1, 2], x: [t0, t0 + 1] }], {
      axes: { x: { type: 'time', format: (v, g) => `${g ?? 'tooltip'}:${v - t0}` } },
    });
    expect((calls.set_line_chart_xy[2] as XyArgs)[8]).toBe(1);
    // User formatter: tooltip / details get no granularity, tick labels the engine's code
    expect(sdk.getNodeDetails(1)?.metadata.attributes?.x).toBe('tooltip:1');
    const presentation = (sdk as unknown as { chartPresentation: { formatX: (v: number, g?: number) => string } })
      .chartPresentation;
    expect(presentation.formatX(t0, 6)).toBe('month:0');
  });

  it('keeps index placement and the x prefix without x', () => {
    const { sdk, calls } = mockSdk();
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }], { xLabelPrefix: 'S' });
    expect(calls.set_line_chart_xy).toBeUndefined();
    expect(calls.set_line_chart).toHaveLength(1);
    expect(sdk.getNodeDetails(2)?.metadata.attributes?.stepIndex).toBe('S+2');
  });

  it('rejects x on some series only or with the wrong length', () => {
    const { sdk } = mockSdk();
    expect(() =>
      sdk.renderLineChart([
        { name: 'A', values: [1, 2], x: [0, 1] },
        { name: 'B', values: [1, 2] },
      ])
    ).toThrow(/every series or none/);
    expect(() => sdk.renderLineChart([{ name: 'A', values: [1, 2], x: [0] }])).toThrow(/1 x for 2 values/);
  });

  it('falls back to index placement on engines without set_line_chart_xy', () => {
    const { sdk, calls } = mockSdk(false);
    sdk.renderLineChart([{ name: 'A', values: [1, 2], x: [10, 20] }], { xLabelPrefix: 'T' });
    expect(calls.set_line_chart).toHaveLength(1);
    expect(sdk.getNodeDetails(1)?.metadata.attributes?.stepIndex).toBe('T+1');
  });

  it('formats time ticks by granularity in UTC', () => {
    const at = Date.UTC(2026, 1, 1, 14, 5, 9, 250);
    expect(formatChartTime(Date.UTC(2026, 0, 1), 'year', 'en-US')).toBe('2026');
    expect(formatChartTime(FEB_1, 'month', 'en-US')).toBe('Feb');
    expect(formatChartTime(FEB_1, 'day', 'en-US')).toBe('Feb 1');
    expect(formatChartTime(at, 'minute', 'en-US')).toBe('14:05');
    expect(formatChartTime(at, 'second', 'en-US')).toBe('14:05:09');
    expect(formatChartTime(at, 'millisecond', 'en-US')).toBe('14:05:09.250');
    // Without granularity (tooltip): full date + time; date only at UTC midnight
    expect(formatChartTime(FEB_1, undefined, 'en-US')).toBe('Feb 1, 2026');
    expect(formatChartTime(at, undefined, 'en-US')).toMatch(/Feb 1, 2026.*14:05:09\.250/);
    expect(formatChartTime(FEB_1, 'month', 'ko-KR')).toBe('2월');
    expect(formatChartTime(1e16, 'year')).toBe('10000000000000000');
  });
});
