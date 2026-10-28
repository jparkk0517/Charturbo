import { describe, expect, it } from 'vitest';
import { Charturbo, WasmCharturboEngineBackend } from '../sdk/charturbo';
import { buildA11yModel, buildChartDescription } from '../sdk/chart-a11y';
import { checkTrendlines, trendExpression, trendLegendLabel, type ScatterTrendlineFit } from '../sdk/chart-trendline';

/** Scatter backend recording trendline records and answering with canned fits. */
function trendBackend(seriesCount: number, fits: number[]) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const backend = {
    set_scatter_chart: record('set_scatter_chart', 0),
    chart_series_count: () => seriesCount,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_scatter_trendlines: (r: Float64Array) => ((calls.trendlines ??= []).push([Array.from(r)]), true),
    chart_scatter_trend_fits: () => Float64Array.from(fits),
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
  } as unknown as WasmCharturboEngineBackend;
  return { backend, calls };
}

const NAN7 = [NaN, NaN, NaN, NaN, NaN, NaN, NaN];
/** Engine fit record: used, skipped, R², coefficient count, 7 coefficients. */
const fitRecord = (used: number, skipped: number, r2: number, coeffs: number[]) => [used, skipped, r2, coeffs.length, ...coeffs, ...NAN7.slice(coeffs.length)];

describe('Scatter trendlines', () => {
  it('sends one record per fitted series and decodes the fits into the result', () => {
    const fits = [...fitRecord(4, 0, 0.9, [1, 2]), ...fitRecord(4, 0, 0.5, [0, 0, 0]), ...fitRecord(3, 1, 0.75, [2, -0.5, 0.25, 1])];
    const { backend, calls } = trendBackend(2, fits);
    const sdk = Charturbo.fromBackend(backend);
    const res = sdk.renderScatterChart(
      { x: [0, 1, 2, 3, 0, 1, 2, 3], y: [1, 3, 5, 7, 0, 1, 4, 9], clusters: [0, 0, 0, 0, 1, 1, 1, 1] },
      {
        seriesColors: ['#000000', '#ffffff'],
        seriesNames: ['A', 'B'],
        trendline: [{ type: 'linear' }, { type: 'polynomial', order: 3, series: [1], color: '#ff0000', width: 1.5, dash: [4] }],
      }
    );
    // linear on every series (series color, width 2, solid), then the cubic on series 1
    expect(calls.trendlines).toEqual([
      [
        [
          ...[0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 0, 0],
          ...[1, 0, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0],
          ...[1, 3, 3, 1, 0, 0, 1, 1.5, 4, 4, 0, 0],
        ],
      ],
    ]);
    expect(res.trendlines.map((t) => [t.type, t.series, t.expression, t.r2, t.points, t.skipped])).toEqual([
      ['linear', 0, 'y = 2x + 1', 0.9, 4, 0],
      ['linear', 1, 'y = 0', 0.5, 4, 0],
      ['polynomial', 1, 'y = x³ + 0.25x² − 0.5x + 2', 0.75, 3, 1],
    ]);
    expect(res.trendlines[2].order).toBe(3);
    expect(sdk.getScatterTrendlines()).toEqual(res.trendlines);
    // No trendlines: an empty record list clears them
    const plain = sdk.renderScatterChart({ x: [0, 1], y: [1, 2] });
    expect(plain.trendlines).toEqual([]);
    expect(calls.trendlines.at(-1)).toEqual([[]]);
  });

  it('rejects invalid options before touching the engine', () => {
    const { backend, calls } = trendBackend(1, []);
    const sdk = Charturbo.fromBackend(backend);
    const data = { x: [0, 1, 2], y: [1, 2, 3] };
    expect(() => sdk.renderScatterChart(data, { trendline: { type: 'cubic' as never } })).toThrow(/type must be/);
    expect(() => sdk.renderScatterChart(data, { trendline: { type: 'polynomial', order: 7 } })).toThrow(/order must be an integer from 2 to 6/);
    expect(() => sdk.renderScatterChart(data, { trendline: { type: 'polynomial', order: 2.5 } })).toThrow(RangeError);
    expect(() => sdk.renderScatterChart(data, { trendline: { type: 'linear', series: [-1] } })).toThrow(/series ids/);
    expect(() => sdk.renderScatterChart(data, { trendline: { type: 'linear', width: NaN } })).toThrow(/width/);
    expect(() => sdk.renderScatterChart(data, { trendline: { type: 'linear', dash: [4, -1] } })).toThrow(/dash/);
    expect(calls.set_scatter_chart).toBeUndefined();
    // order only matters for polynomials
    expect(checkTrendlines({ type: 'linear', order: 99 }, 'f')[0].order).toBe(1);
  });

  it('formats ecStat-style equations, R² and skipped points', () => {
    expect(trendExpression({ type: 'linear', coefficients: [-4.5, 1.23456] })).toBe('y = 1.235x − 4.5');
    expect(trendExpression({ type: 'exponential', coefficients: [2, 0.3] })).toBe('y = 2·e^(0.3x)');
    expect(trendExpression({ type: 'logarithmic', coefficients: [1.5, -2] })).toBe('y = 1.5 − 2·ln(x)');
    expect(trendExpression({ type: 'polynomial', coefficients: [1, 0, -1] })).toBe('y = −x² + 1');
    expect(trendExpression({ type: 'linear', coefficients: [] })).toBe('');
    const fit: ScatterTrendlineFit = {
      type: 'exponential',
      series: 0,
      coefficients: [2, 0.3],
      r2: 0.98765,
      points: 10,
      skipped: 2,
      expression: 'y = 2·e^(0.3x)',
      color: [0, 0, 0, 1],
      width: 2,
      dash: [],
    };
    expect(trendLegendLabel(fit, 'A')).toBe('A: y = 2·e^(0.3x) (R² = 0.9877; 2 points with y ≤ 0 skipped)');
    expect(trendLegendLabel({ ...fit, skipped: 0 }, null)).toBe('y = 2·e^(0.3x) (R² = 0.9877)');
    expect(trendLegendLabel({ ...fit, coefficients: [], points: 1, skipped: 0 }, null)).toBe('no exponential fit (1 point)');
  });

  it('the accessible description states each fit', () => {
    const fit: ScatterTrendlineFit = {
      type: 'polynomial',
      order: 2,
      series: 1,
      coefficients: [1, 0, -1],
      r2: 0.5,
      points: 3,
      skipped: 0,
      expression: 'y = −x² + 1',
      color: [0, 0, 0, 1],
      width: 2,
      dash: [],
    };
    const meta = { kind: 'scatter', x: [0, 1, 2, 3], y: [1, 2, 0, 1], series: [0, 0, 1, 1], names: ['A', 'B'], visible: [true, false], trendlines: [fit] };
    const text = buildChartDescription(buildA11yModel(meta, {})!);
    expect(text).toContain('B (hidden) polynomial (order 2) trend line: y = −x² + 1, R² = 0.5000, fitted to 3 points.');
  });
});
