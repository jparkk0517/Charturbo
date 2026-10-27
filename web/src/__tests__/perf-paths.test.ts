import { describe, expect, it } from 'vitest';
import { seriesStats, withPassMemo } from '../sdk/chart-a11y';
import { readRenderStats } from '../sdk/chart-stats';
import { Charturbo, WasmCharturboEngineBackend } from '../sdk/charturbo';

/** Mock backend recording line chart calls (same pattern as line-x.test.ts). */
function mockSdk(extra: Partial<WasmCharturboEngineBackend> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const backend: WasmCharturboEngineBackend = {
    set_line_chart: record('set_line_chart', 0),
    set_line_chart_xy: record('set_line_chart_xy', 0),
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
    ...extra,
  };
  return { sdk: Charturbo.fromBackend(backend), calls };
}

describe('large-data render paths', () => {
  it('passes a single Float32Array series to the engine without a concatenated copy', () => {
    const { sdk, calls } = mockSdk();
    const values = new Float32Array([1, 2, 3, 4]);
    sdk.renderLineChart([{ name: 'A', values }]);
    expect(calls.set_line_chart[0][0]).toBe(values);

    // x given as Float64Array: passed as is too
    const x = new Float64Array([0, 1, 2, 3]);
    sdk.renderLineChart([{ name: 'A', values, x }]);
    const [v, , xs] = calls.set_line_chart_xy[0] as [Float32Array, Uint32Array, Float64Array];
    expect(v).toBe(values);
    expect(xs).toBe(x);
  });

  it('still concatenates several series (and number[] input) into one buffer', () => {
    const { sdk, calls } = mockSdk();
    sdk.renderLineChart([
      { name: 'A', values: new Float32Array([1, 2]) },
      { name: 'B', values: [3, 4, 5] },
    ]);
    const [v, lengths] = calls.set_line_chart[0] as [Float32Array, Uint32Array];
    expect(Array.from(v)).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(lengths)).toEqual([2, 3]);
    sdk.renderLineChart([{ name: 'A', values: [7, 8] }]);
    const [single] = calls.set_line_chart[1] as [Float32Array];
    expect(single).toBeInstanceOf(Float32Array);
    expect(Array.from(single)).toEqual([7, 8]);
  });

  it('memoizes O(n) series passes only inside one refresh', () => {
    const values = new Float32Array([1, 5, 3]);
    const [a, b, c] = withPassMemo(() => {
      const first = seriesStats(values);
      values[0] = 100; // changed in place mid-pass: the memo still answers
      return [first, seriesStats(values), seriesStats(values, true)];
    });
    expect(b).toBe(a);
    expect(a.max).toBe(5);
    // Different f32 flag = separate entry
    expect(c).not.toBe(a);
    expect(c.max).toBe(100);
    // Outside the scope every call sees the current data
    expect(seriesStats(values).max).toBe(100);
    expect(seriesStats(values)).not.toBe(seriesStats(values));
  });

  it('decodes engine render stats', () => {
    const raw = [1024, 48, 4096, 3, 10, 100, 0, 7, 12, 2, 65536];
    expect(readRenderStats({ render_stats: () => raw })).toEqual({
      gpuBytes: 1024,
      chartUploadBytes: 48,
      chartUploadTotal: 4096,
      chartUploads: 3,
      frames: 10,
      seriesSegments: 100,
      points: 0,
      bars: 7,
      fillVertices: 12,
      markers: 2,
      wasmMemoryBytes: 65536,
    });
    expect(readRenderStats({})).toBeNull();
    expect(readRenderStats({ render_stats: () => [1, 2] })).toBeNull();
    const { sdk } = mockSdk({ render_stats: () => new Float64Array(raw) });
    expect(sdk.getRenderStats()?.points).toBe(0);
    expect(mockSdk().sdk.getRenderStats()).toBeNull();
  });
});
