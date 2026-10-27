import { afterEach, describe, expect, it } from 'vitest';
import { Charturbo, WasmCharturboEngineBackend } from '../sdk/charturbo';

/**
 * Mock backend with a tiny line-data model standing in for the engine: per-series values / x,
 * `max_points` trimming, re-based global ids, and the read-back calls the SDK uses.
 */
function mockSdk(opts: { readBack?: boolean } = {}) {
  const readBack = opts.readBack ?? true;
  const calls: Record<string, unknown[][]> = {};
  let values: number[][] = [];
  let xs: number[][] | null = null;
  const record = (name: string, args: unknown[]) => (calls[name] ??= []).push(args);
  const split = (v: Float32Array, lengths: Uint32Array, x?: Float64Array) => {
    let at = 0;
    values = [];
    xs = x ? [] : null;
    for (const len of lengths) {
      values.push(Array.from(v.subarray(at, at + len)));
      xs?.push(Array.from(x!.subarray(at, at + len)));
      at += len;
    }
  };
  const locate = (id: number): [number, number] | null => {
    let acc = 0;
    for (let s = 0; s < values.length; s++) {
      if (id < acc + values[s].length) return [s, id - acc];
      acc += values[s].length;
    }
    return null;
  };
  const backend: WasmCharturboEngineBackend = {
    set_area_chart: (v: Float32Array, lengths: Uint32Array, x: Float64Array) => {
      split(v, lengths, x.length ? x : undefined);
      return v.length;
    },
    set_line_chart: (v: Float32Array, lengths: Uint32Array) => {
      split(v, lengths);
      return v.length;
    },
    set_line_chart_xy: (v: Float32Array, lengths: Uint32Array, x: Float64Array) => {
      split(v, lengths, x);
      return v.length;
    },
    set_chart_series_data: (s: number, v: Float32Array, x: Float64Array) => {
      record('set_chart_series_data', [s, v, x]);
      values[s] = Array.from(v);
      if (xs) xs[s] = Array.from(x);
      return v.length;
    },
    append_chart_series_data: (s: number, v: Float32Array, x: Float64Array, maxPoints: number) => {
      record('append_chart_series_data', [s, v, x, maxPoints]);
      if (xs && x.length && xs[s].length && x[0] < xs[s][xs[s].length - 1]) throw new Error('x goes back');
      values[s].push(...v);
      xs?.[s].push(...x);
      const drop = maxPoints > 0 ? Math.max(0, values[s].length - maxPoints) : 0;
      values[s].splice(0, drop);
      xs?.[s].splice(0, drop);
      return values[s].length;
    },
    append_area_data: (v: Float32Array, lengths: Uint32Array, x: Float64Array, maxPoints: number) => {
      record('append_area_data', [v, lengths, x, maxPoints]);
      if (x.includes(-1)) throw new Error('invalid x');
      let at = 0;
      return Uint32Array.from(lengths, (len, s) => {
        backend.append_chart_series_data!(s, v.subarray(at, at + len), x.subarray(at, at + len), maxPoints);
        at += len;
        return values[s].length;
      });
    },
    set_chart_y_domain: (...args: unknown[]) => record('set_chart_y_domain', args),
    chart_y_domain: () => new Float64Array([0, 50, 10]),
    ...(readBack
      ? {
          chart_series_values: (s: number) => {
            record('chart_series_values', [s]);
            return Float32Array.from(values[s] ?? []);
          },
          chart_series_x: (s: number) => Float64Array.from(xs?.[s] ?? []),
        }
      : {}),
    chart_sample: (id: number) => {
      const at = locate(id);
      if (!at) return new Float64Array(0);
      const [s, i] = at;
      return new Float64Array([s, i, values[s][i], 0, 0, 0, xs ? xs[s][i] : i]);
    },
    set_chart_hover_style: () => {},
    set_chart_frame_style: () => {},
    set_clear_color: () => {},
    set_chart_padding: () => {},
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
  const sdk = Charturbo.fromBackend(backend);
  live.push(sdk);
  return { sdk, calls };
}

const live: Charturbo[] = [];
afterEach(() => {
  // Clears pending throttled a11y refreshes
  live.splice(0).forEach((sdk) => sdk.dispose());
});

const attrs = (sdk: Charturbo, id: number) => sdk.getNodeDetails(id)?.metadata.attributes;

describe('line chart data updates', () => {
  it('replaces one series in place and re-bases ids', () => {
    const { sdk, calls } = mockSdk();
    sdk.renderLineChart([
      { name: 'A', values: [1, 2, 3] },
      { name: 'B', values: [10, 20] },
    ]);
    expect(sdk.setSeriesData(0, [5, 6, 7, 8, 9])).toBe(5);
    const [series, values, x] = calls.set_chart_series_data[0] as [number, Float32Array, Float64Array];
    expect(series).toBe(0);
    expect(Array.from(values)).toEqual([5, 6, 7, 8, 9]);
    expect(x.length).toBe(0);
    // B now starts at id 5
    expect(attrs(sdk, 5)?.series).toBe('B');
    expect(attrs(sdk, 5)?.value).toBe(10);
    expect(attrs(sdk, 4)?.value).toBe(9);
    expect(attrs(sdk, 4)?.delta).toBe('+1.000');
    expect(sdk.getNodeDetails(7)).toBeNull();
    // Index charts take no x; series must exist
    expect(() => sdk.setSeriesData(0, [1], [0])).toThrow(/no x/);
    expect(() => sdk.setSeriesData(2, [1])).toThrow(/out of range/);
  });

  it('streams with x, maxPoints trimming and reads streamed values back from the engine', () => {
    const { sdk, calls } = mockSdk();
    const t0 = Date.UTC(2026, 0, 1);
    sdk.renderLineChart(
      [
        { name: 'A', values: [1, 2], x: [t0, t0 + 1000] },
        { name: 'B', values: [7], x: [t0] },
      ],
      { axes: { x: { type: 'time' } } }
    );
    const len = sdk.appendSeriesData(0, new Float32Array([3, 4, 5]), [new Date(t0 + 2000), new Date(t0 + 3000), new Date(t0 + 4000)], {
      maxPoints: 4,
    });
    expect(len).toBe(4);
    const [, , x, maxPoints] = calls.append_chart_series_data[0] as [number, Float32Array, Float64Array, number];
    expect(Array.from(x)).toEqual([t0 + 2000, t0 + 3000, t0 + 4000]);
    expect(maxPoints).toBe(4);
    // Oldest sample dropped: id 0 = value 2 at t0 + 1s; B re-based to id 4
    expect(attrs(sdk, 0)?.value).toBe(2);
    expect(attrs(sdk, 3)?.value).toBe(5);
    expect(attrs(sdk, 3)?.delta).toBe('+1.000');
    expect(attrs(sdk, 4)?.series).toBe('B');
    // Tooltip / detail lookups went to the engine, not a TS copy
    expect(calls.chart_series_values).toBeUndefined();
    // a11y / exports re-read streamed series once
    const csv = sdk.exportChartCSV();
    expect(calls.chart_series_values).toHaveLength(1);
    expect(csv).toContain('5');
    expect(sdk.getChartSummary()).toContain('5 points');
    sdk.exportChartCSV();
    expect(calls.chart_series_values).toHaveLength(1);
    // x is required on an x chart and must match the values
    expect(() => sdk.appendSeriesData(0, [1, 2], [t0 + 5000])).toThrow(/x for 2 values/);
    expect(() => sdk.appendSeriesData(0, [1])).toThrow(/x for 1 values/);
  });

  it('mirrors appends in TS when the backend cannot read data back', () => {
    const { sdk } = mockSdk({ readBack: false });
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    sdk.appendSeriesData(0, [4, 5], undefined, { maxPoints: 4 });
    sdk.appendSeriesData(0, [6], undefined, { maxPoints: 4 });
    expect([0, 1, 2, 3].map((i) => attrs(sdk, i)?.value)).toEqual([3, 4, 5, 6]);
    expect(sdk.getChartSummary()).toContain('4 points');
    // Chunk longer than maxPoints keeps its tail only
    sdk.appendSeriesData(0, [7, 8, 9, 10, 11], undefined, { maxPoints: 4 });
    expect([0, 1, 2, 3].map((i) => attrs(sdk, i)?.value)).toEqual([8, 9, 10, 11]);

    // Without any append binding the meta still honours maxPoints
    const { sdk: bare } = mockSdk({ readBack: false });
    bare.renderLineChart([{ name: 'A', values: [1, 2] }]);
    (bare as unknown as { backend: Record<string, unknown> }).backend.append_chart_series_data = undefined;
    expect(bare.appendSeriesData(0, [3, 4, 5], undefined, { maxPoints: 3 })).toBe(3);
    expect([0, 1, 2].map((i) => attrs(bare, i)?.value)).toEqual([3, 4, 5]);
  });

  it('forwards y domain options and merges later changes', () => {
    const { sdk, calls } = mockSdk();
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    expect(calls.set_chart_y_domain).toBeUndefined();
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }], { axes: { y: { title: 'v', min: 0, autoscale: 'visible' } } });
    expect(calls.set_chart_y_domain[0]).toEqual([0, NaN, 1, true]);
    sdk.setYDomain({ nice: false });
    expect(calls.set_chart_y_domain[1]).toEqual([0, NaN, 1, false]);
    sdk.setYDomain({ min: undefined, autoscale: 'none', max: 9 });
    expect(calls.set_chart_y_domain[2]).toEqual([NaN, 9, 2, false]);
    expect(sdk.getYDomain()).toEqual([0, 50]);
  });
});

describe('area chart data updates', () => {
  it('streams overlap areas with FIFO and keeps details, CSV and summaries current', () => {
    const { sdk } = mockSdk();
    sdk.renderAreaChart([{ name: 'A', values: [10, 20] }, { name: 'B', values: [7, 8] }]);
    expect(sdk.appendSeriesData(0, [30, 40], undefined, { maxPoints: 3 })).toBe(3);
    expect(attrs(sdk, 0)?.value).toBe(20);
    expect(attrs(sdk, 3)?.series).toBe('B');
    expect(sdk.exportChartCSV()).toContain('40');
    expect(sdk.getChartSummary()).toContain('5 points');
    expect(sdk.setSeriesData(0, [5, 6])).toBe(2);
    expect(attrs(sdk, 2)?.series).toBe('B');
  });

  it.each(['stacked', 'percent'] as const)('replaces aligned %s values without recreating the chart', (mode) => {
    const { sdk, calls } = mockSdk();
    sdk.renderAreaChart([{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }], { mode });
    sdk.setSeriesVisible(1, false);
    expect(sdk.setSeriesData(0, [10, 20])).toBe(2);
    expect(calls.set_chart_series_data).toHaveLength(1);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    expect(attrs(sdk, 0)?.value).toBe(10);
  });

  it.each(['overlap', 'stacked', 'percent'] as const)('appends a %s batch and reads raw data back for CSV', (mode) => {
    const { sdk, calls } = mockSdk();
    const x = [new Date(1000), new Date(2000)];
    sdk.renderAreaChart([{ name: 'A', values: [1, 2], x }, { name: 'B', values: [3, 6], x }], { mode });
    const next = [new Date(3000), new Date(4000)];
    expect(sdk.appendAreaData([{ values: [3, 4], x: next }, { values: [9, 12], x: next }], { maxPoints: 3 })).toEqual([3, 3]);
    const [values, lengths, xs, max] = calls.append_area_data[0] as [Float32Array, Uint32Array, Float64Array, number];
    expect(Array.from(values)).toEqual([3, 4, 9, 12]);
    expect(Array.from(lengths)).toEqual([2, 2]);
    expect(Array.from(xs)).toEqual([3000, 4000, 3000, 4000]);
    expect(max).toBe(3);
    expect(attrs(sdk, 0)?.value).toBe(2);
    expect(attrs(sdk, 3)?.value).toBe(6);
    expect(sdk.exportChartCSV()).toContain('12');
    expect(sdk.getChartSummary()).toContain('6 points');
    expect(calls.chart_series_values).toHaveLength(2);
  });

  it('rejects a misaligned stack or invalid capacity before touching the backend', () => {
    const { sdk, calls } = mockSdk();
    sdk.renderAreaChart([{ name: 'A', values: [1, 2], x: [1, 2] }, { name: 'B', values: [3, 4], x: [1, 2] }], { mode: 'stacked' });
    expect(() => sdk.setSeriesData(0, [5], [1])).toThrow(/aligned/);
    expect(() => sdk.setSeriesData(0, [5, 6], [1, 3])).toThrow(/shared x/);
    expect(() => sdk.appendSeriesData(0, [5], [3])).toThrow(/appendAreaData/);
    expect(() => sdk.appendAreaData([{ values: [5], x: [3] }])).toThrow(/every series/);
    expect(() => sdk.appendAreaData([{ values: [5], x: [3] }, { values: [6, 7], x: [3, 4] }])).toThrow(/aligned/);
    expect(() => sdk.appendAreaData([{ values: [5], x: [3] }, { values: [6], x: [4] }])).toThrow(/shared x/);
    for (const maxPoints of [-1, 1.5, NaN, Infinity, 2 ** 32]) {
      expect(() => sdk.appendAreaData([{ values: [], x: [] }, { values: [], x: [] }], { maxPoints })).toThrow(/maxPoints/);
    }
    expect(calls.append_area_data).toBeUndefined();
    expect(calls.set_chart_series_data).toBeUndefined();
    expect(attrs(sdk, 0)?.value).toBe(1);
  });

  it('preserves SDK metadata when the engine rejects a batch', () => {
    const { sdk } = mockSdk();
    sdk.renderAreaChart([{ name: 'A', values: [1], x: [1] }, { name: 'B', values: [3], x: [1] }], { mode: 'stacked' });
    expect(() => sdk.appendAreaData([{ values: [2], x: [-1] }, { values: [6], x: [-1] }])).toThrow(/invalid x/);
    expect(attrs(sdk, 0)?.value).toBe(1);
    expect(attrs(sdk, 1)?.series).toBe('B');
    expect(sdk.getChartSummary()).toContain('2 points');
  });

  it('mirrors batch data for backends without readback but never fakes a missing batch binding', () => {
    const { sdk } = mockSdk({ readBack: false });
    sdk.renderAreaChart([{ name: 'A', values: [1] }, { name: 'B', values: [3] }], { mode: 'stacked' });
    sdk.appendAreaData([{ values: [2, 3] }, { values: [6, 9] }], { maxPoints: 2 });
    expect(attrs(sdk, 0)?.value).toBe(2);
    expect(attrs(sdk, 2)?.value).toBe(6);
    (sdk as unknown as { backend: WasmCharturboEngineBackend }).backend.append_area_data = undefined;
    expect(() => sdk.appendAreaData([{ values: [4] }, { values: [12] }])).toThrow(/backend/);
    expect(attrs(sdk, 0)?.value).toBe(2);
  });
});
