import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildA11yModel, buildDataTable, tableToCSV } from '../sdk/chart-a11y';
import { LINE_STYLE_STRIDE, encodeLinePieces, encodeLineStyles, numericSamples, resolveMarker } from '../sdk/chart-linestyle';
import {
  Charturbo,
  type ChartTooltipContext,
  type LineSeriesDescriptor,
  type WasmCharturboEngineBackend,
} from '../sdk/charturbo';

// The a11y DOM layer has its own tests; the pure table builder is tested directly below
vi.mock('../sdk/chart-a11y', async (orig) => {
  const real = await orig<typeof import('../sdk/chart-a11y')>();
  return {
    ...real,
    ChartA11y: class {
      tooltip: unknown = null;
      refresh(): void {}
      dispose(): void {}
      showDataTable(): void {}
      hideDataTable(): void {}
      getDataTable(): null {
        return null;
      }
      exportCSV(): string {
        return '';
      }
      summary(): string {
        return '';
      }
    },
  };
});

/** Minimal DOM element: enough for the chart overlay and the tooltip. */
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

  constructor(readonly tag: string) {}

  appendChild(c: FakeEl): FakeEl {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    cs.forEach((c) => this.appendChild(c));
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
  fire(type: string, e: unknown = {}): void {
    this.listeners[type]?.forEach((f) => f(e));
  }
}

type Calls = Record<string, unknown[][]>;

function mockBackend(
  calls: Calls,
  hit: () => Float64Array,
  band?: (s: number, i: number) => Float64Array,
  pieceColor?: (s: number, i: number) => Float32Array
): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_area_chart: record('set_area_chart', 8),
    set_line_chart: record('set_line_chart', 8),
    set_line_chart_xy: record('set_line_chart_xy', 8),
    set_line_series_styles: record('set_line_series_styles', true),
    set_line_series_band: record('set_line_series_band'),
    set_band_series: record('set_band_series'),
    set_error_bar_series: record('set_error_bar_series'),
    set_impulse_series: record('set_impulse_series'),
    chart_line_band_at: band,
    set_line_series_pieces: record('set_line_series_pieces'),
    chart_line_piece_color: pieceColor
      ? (s: number, i: number) => {
          (calls.chart_line_piece_color ??= []).push([s, i]);
          return pieceColor(s, i);
        }
      : undefined,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    chart_hover_at_ndc: () => hit(),
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
    clear_scene_objects: () => {},
  };
}

const record = (styles: Float32Array, s: number) => Array.from(styles.subarray(s * LINE_STYLE_STRIDE, (s + 1) * LINE_STYLE_STRIDE));

describe('line style encoding', () => {
  it('plain series need no style upload', () => {
    expect(encodeLineStyles([{}, { dash: [] }, { marker: false }], undefined, 'f')).toBeNull();
    expect(encodeLineStyles([{}], 'gap', 'f')).toBeNull();
  });

  it('encodes markers, dashes, curves and null policies (series override the chart)', () => {
    const styles = encodeLineStyles(
      [
        { marker: { shape: 'diamond', size: 9, fill: '#ff0000', stroke: [0, 0, 0, 1], strokeWidth: 2, show: 'always' } },
        { dash: [6, 3], curve: 'stepAfter', nulls: 'connect' },
        { marker: true, curve: 'monotone' },
      ],
      'zero',
      'renderLineChart'
    )!;
    expect(styles.length).toBe(3 * LINE_STYLE_STRIDE);
    const r0 = record(styles, 0);
    expect(r0.slice(0, 2)).toEqual([2, 9]);
    expect(r0.slice(2, 6)).toEqual([1, 0, 0, 1]);
    expect(r0.slice(6, 12)).toEqual([0, 0, 0, 1, 2, 1]);
    expect(r0.slice(12)).toEqual([0, 0, 0, 0, 0, 2]); // solid, linear, chart nulls 'zero'
    const r1 = record(styles, 1);
    expect(Number.isNaN(r1[0])).toBe(true); // no markers
    expect(r1.slice(12)).toEqual([6, 3, 0, 0, 3, 1]);
    const r2 = record(styles, 2);
    expect(r2[0]).toBe(0); // circle
    expect(Number.isNaN(r2[1]) && Number.isNaN(r2[2]) && Number.isNaN(r2[6])).toBe(true); // engine defaults
    expect(r2[16]).toBe(4);
  });

  it('maps the deprecated pointSize to marker size; shape none turns markers off', () => {
    expect(resolveMarker({ pointSize: 5 })).toEqual({ size: 5 });
    expect(resolveMarker({ pointSize: 5, marker: false })).toBeNull();
    expect(resolveMarker({ marker: { shape: 'none' } })).toBeNull();
    expect(resolveMarker({})).toBeNull();
    const styles = encodeLineStyles([{ pointSize: 4 }], undefined, 'f')!;
    expect(record(styles, 0).slice(0, 2)).toEqual([0, 4]);
  });

  it('encodes pieces as [lo, gte, hi, lte, r, g, b, a]: gte wins over gt, lte over lt (ECharts), open ends NaN', () => {
    const enc = encodeLinePieces([{ lt: 50, color: '#00ff00' }, { gt: 50, gte: 60, lt: 90, lte: 80, color: [0, 0, 1, 0.5] }], 'f', 0);
    expect(Array.from(enc).map((v) => (Number.isNaN(v) ? 'NaN' : v))).toEqual([
      'NaN', 0, 50, 0, 0, 1, 0, 1,
      60, 1, 80, 1, 0, 0, 1, 0.5,
    ]);
    expect(encodeLinePieces([{ color: '#ff0000' }], 'f', 0).length).toBe(8);
  });

  it('rejects malformed pieces', () => {
    expect(() => encodeLinePieces([{ gt: NaN, color: '#ff0000' }], 'f', 1)).toThrow('f: series 1 piece 0 bounds must be numbers (not NaN)');
    expect(() => encodeLinePieces([{ lt: 1 } as never], 'f', 0)).toThrow('f: series 0 piece 0 needs a color');
    expect(() => encodeLinePieces('x' as never, 'f', 0)).toThrow('f: series 0 pieces must be an array');
  });

  it('rejects unknown options and bad dash lengths', () => {
    expect(() => encodeLineStyles([{ curve: 'bezier' as never }], undefined, 'renderLineChart')).toThrow(
      "renderLineChart: unknown curve 'bezier'"
    );
    expect(() => encodeLineStyles([{}], 'skip' as never, 'f')).toThrow('unknown nulls policy');
    expect(() => encodeLineStyles([{ dash: [4, -1] }], undefined, 'f')).toThrow('dash lengths');
  });

  it('expands single dash lengths like CSS; zero ink / gap is sent as is (engine: solid)', () => {
    const r = (dash: number[]) => record(encodeLineStyles([{ dash }], undefined, 'f')!, 0).slice(12, 16);
    expect(r([5])).toEqual([5, 5, 0, 0]);
    expect(r([5, 2, 1])).toEqual([5, 2, 0, 0]);
    expect(r([4, 0])).toEqual([4, 0, 0, 0]);
  });

  it('null / undefined samples become NaN (not 0)', () => {
    const v = numericSamples([1, null, undefined, 4] as unknown as number[]);
    expect(Array.from(v).map((x) => (Number.isNaN(x) ? 'NaN' : x))).toEqual([1, 'NaN', 'NaN', 4]);
    const f = new Float32Array([1, 2]);
    expect(numericSamples(f)).toBe(f);
  });
});

describe('line styles in the SDK', () => {
  let body: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    body = new FakeEl('body');
    const container = new FakeEl('div');
    canvas = container.appendChild(new FakeEl('canvas'));
    const head = new FakeEl('head');
    vi.stubGlobal('document', {
      body,
      head,
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const SERIES: LineSeriesDescriptor[] = [
    {
      name: 'Forecast',
      values: [10, null as unknown as number, 30],
      dash: [4, 2],
      band: { lower: [8, 18, 25], upper: [12, 22, 35], opacity: 0.3 },
    },
    { name: 'Actual', values: new Float32Array([9, 21, 29]), marker: true, curve: 'monotone' },
  ];

  it('renders standalone bands from two channels with one logical series and stable sample ids', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0)));
    const result = sdk.renderBandChart([
      { name: 'Range', lower: [8, 22, NaN], upper: [12, 18, 4], x: [10, 20, 30], lowerLineWidth: 2, upperLineWidth: 3 },
    ], { fillOpacity: 0.4, connectNulls: true });
    expect(result).toEqual({ totalPoints: 3, seriesCount: 1 });
    expect(Array.from(calls.set_line_chart_xy[0][0] as Float32Array)).toEqual([10, 20, NaN]);
    expect(calls.set_band_series[0]).toEqual([0, new Float32Array([8, 22, NaN]), new Float32Array([12, 18, 4]), 0.4, 2, 3]);
    expect(calls.set_line_series_band).toBeUndefined();
    expect(record(calls.set_line_series_styles[0][0] as Float32Array, 0)[17]).toBe(1);
    expect(sdk.getNodeDetails(1)?.metadata).toMatchObject({ tags: ['band-chart', 'range'], attributes: { lower: 22, upper: 18 } });
    expect(() => sdk.appendSeriesData(0, [10], [40])).toThrow(/band/i);
    expect(() => sdk.setSeriesData(0, [10], [40])).toThrow(/band/i);
    sdk.dispose();
  });

  it('renders ErrorBar with normalized endpoints and preserves the center in tooltip and details', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array([0, 0, 1, 0, 1, 20, 1])));
    let ctx: ChartTooltipContext | undefined;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { formatChartTooltip: c => { ctx = c; return ''; } });
    expect(sdk.renderErrorBarChart([{ name: 'E', values: [10, 20], low: [8, 23], high: [12, 17], x: [1, 2] }]))
      .toEqual({ totalPoints: 2, seriesCount: 1 });
    expect(Array.from(calls.set_line_chart_xy[0][0] as Float32Array)).toEqual([10, 20]);
    expect(calls.set_error_bar_series[0].slice(0, 3)).toEqual([0, new Float32Array([8, 17]), new Float32Array([12, 23])]);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    expect(ctx?.chartType).toBe('errorBar');
    expect(ctx?.items[0]).toMatchObject({ value: 20, errorBar: { low: 17, high: 23, direction: 'vertical' } });
    expect(sdk.getNodeDetails(1)?.metadata).toMatchObject({ tags: ['errorBar-chart', 'e'], attributes: { low: 17, high: 23 } });
    expect(() => sdk.appendSeriesData(0, [5], [3])).toThrow(/renderErrorBarChart/);
    sdk.dispose();
  });

  it('renders impulse baselines, marker defaults and rejects invalid requests atomically', () => {
    const calls: Calls = {};
    const backend = mockBackend(calls, () => new Float64Array(0));
    const sdk = Charturbo.fromBackend(backend);
    expect(sdk.renderImpulseChart([{ name: 'I', values: [-2, 0, 3], baseline: 1, showMarker: false }]))
      .toEqual({ totalPoints: 3, seriesCount: 1 });
    expect(calls.set_impulse_series[0]).toEqual([0, 1, false, 6]);
    expect(sdk.getNodeDetails(0)?.metadata.tags).toContain('impulse-chart');
    const cleared = vi.spyOn(backend, 'clear_scene_objects');
    expect(() => sdk.renderImpulseChart([{ name: 'Bad', values: [1], baseline: Infinity }])).toThrow(/baseline/);
    expect(() => sdk.renderErrorBarChart([{ name: 'Bad', values: [1, 2], low: [0], high: [3] }])).toThrow(/length/);
    expect(() => sdk.renderErrorBarChart([{ name: 'Bad', values: [1], error: 1, capWidth: 'oops' as never }])).toThrow(/capWidth/);
    delete backend.set_impulse_series;
    expect(() => sdk.renderImpulseChart([{ name: 'I', values: [1] }])).toThrow(/backend/);
    expect(cleared).not.toHaveBeenCalled();
    sdk.dispose();
  });

  it('rejects malformed bands and unavailable bindings before clearing the current chart', () => {
    const calls: Calls = {};
    const backend = mockBackend(calls, () => new Float64Array(0));
    backend.clear_scene_objects = vi.fn();
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderLineChart([{ name: 'Existing', values: [1, 2] }]);
    vi.mocked(backend.clear_scene_objects!).mockClear();
    const valid = { name: 'B', lower: [1, 2], upper: [3, 4] };
    for (const bad of [
      { ...valid, upper: [3] }, { ...valid, x: [2, 1] }, { ...valid, x: [1, Infinity] },
      { ...valid, lowerLineWidth: -1 }, { ...valid, fillOpacity: 2 }, { ...valid, curve: 'invalid' as never },
    ]) expect(() => sdk.renderBandChart([bad])).toThrow(/renderBandChart/);
    delete backend.set_band_series;
    expect(() => sdk.renderBandChart([valid])).toThrow(/backend/);
    expect(backend.clear_scene_objects).not.toHaveBeenCalled();
    expect(sdk.getNodeDetails(0)?.metadata.tags).toContain('line-chart');
    sdk.dispose();
  });

  it('band hover exposes both original edges and its own chart type after a theme change', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array([0, 0, 1, 0, 1, 20, 1])));
    let ctx: ChartTooltipContext | undefined;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, { formatChartTooltip: (c) => { ctx = c; return ''; } });
    sdk.renderBandChart([{ name: 'B', lower: [8, 22], upper: [12, 18] }]);
    sdk.setTheme('light');
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    expect(ctx?.chartType).toBe('band');
    expect(ctx?.items[0].band).toEqual({ lower: 22, upper: 18 });
    sdk.dispose();
  });

  it('uploads styles and bands after the chart; missing samples are NaN', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0)));
    sdk.renderLineChart(SERIES, { nulls: 'connect' });
    const values = calls.set_line_chart[0][0] as Float32Array;
    expect(Number.isNaN(values[1])).toBe(true);
    const styles = calls.set_line_series_styles[0][0] as Float32Array;
    expect(record(styles, 0).slice(12)).toEqual([4, 2, 0, 0, 0, 1]);
    expect(record(styles, 1)[0]).toBe(0);
    expect(calls.set_line_series_band.length).toBe(1);
    const [series, lower, upper, opacity] = calls.set_line_series_band[0] as [number, Float32Array, Float32Array, number];
    expect([series, Array.from(lower), Array.from(upper), opacity]).toEqual([0, [8, 18, 25], [12, 22, 35], 0.3]);

    // Areas take the same series styles
    sdk.renderAreaChart([{ name: 'A', values: [1, NaN, 2], curve: 'step' }], { nulls: 'zero' });
    const area = calls.set_line_series_styles[1][0] as Float32Array;
    expect(record(area, 0).slice(16)).toEqual([1, 2]);

    // Plain charts skip the style upload entirely
    sdk.renderLineChart([{ name: 'P', values: [1, 2] }]);
    expect(calls.set_line_series_styles.length).toBe(2);

    // Bad bands are rejected before the engine builds the chart
    const built = calls.set_line_chart.length;
    expect(() =>
      sdk.renderLineChart([{ name: 'B', values: [1, 2], band: { lower: [0], upper: [3, 4] } }])
    ).toThrow('renderLineChart: series 0 band needs 2 lower / upper values (got 1 / 2)');
    expect(calls.set_line_chart.length).toBe(built);

    // Area charts ignore bands
    const bands = calls.set_line_series_band.length;
    sdk.renderAreaChart([{ name: 'A', values: [1, 2], band: { lower: [0, 0], upper: [3, 4] } }]);
    expect(calls.set_line_series_band.length).toBe(bands);
  });

  it('streamed null samples are missing, not 0', () => {
    const calls: Calls = {};
    const backend = mockBackend(calls, () => new Float64Array(0));
    backend.append_chart_series_data = (...args: unknown[]) => {
      (calls.append ??= []).push(args);
      return 4;
    };
    backend.set_chart_series_data = (...args: unknown[]) => {
      (calls.set ??= []).push(args);
      return 2;
    };
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderLineChart([{ name: 'S', values: [1, 2] }]);
    sdk.appendSeriesData(0, [3, null as unknown as number]);
    expect(Number.isNaN((calls.append[0][1] as Float32Array)[1])).toBe(true);
    sdk.setSeriesData(0, [null as unknown as number, 1]);
    expect(Number.isNaN((calls.set[0][1] as Float32Array)[0])).toBe(true);
  });

  it('tooltips show the band range of the hovered sample', () => {
    const calls: Calls = {};
    const hit = new Float64Array([0, 0, 2, 0, 2, 30, 2, 1, 2, 29, 5]);
    const sdk = Charturbo.fromBackend(
      mockBackend(calls, () => hit, (s, i) => (s === 0 ? new Float64Array([25 + i, 35 + i]) : new Float64Array(0)))
    );
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart(SERIES);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const tooltip = body.querySelectorAll('.charturbo-sdk-node-tooltip')[0];
    // Engine copy (follows streamed data): index 2 -> [27, 37]
    expect(tooltip.innerHTML).toContain('27 – 37');

    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    canvas.fire('pointermove', { clientX: 410, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect(c.items[0].band).toEqual({ lower: 27, upper: 37 });
    expect(c.items[1].band).toBeUndefined();
  });

  it('uploads pieces after the chart (y by default, x on request); bad pieces throw before the chart', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0)));
    sdk.renderLineChart([
      { name: 'AQI', values: [40, 120, 220], pieces: [{ lte: 50, color: '#00e400' }, { gt: 50, lte: 100, color: [1, 1, 0, 1] }] },
      { name: 'Plain', values: [1, 2, 3] },
    ]);
    expect(calls.set_line_series_pieces.length).toBe(1);
    const [series, by, enc] = calls.set_line_series_pieces[0] as [number, number, Float64Array];
    expect([series, by]).toEqual([0, 0]);
    expect(Array.from(enc).map((v) => (Number.isNaN(v) ? 'NaN' : v))).toEqual(['NaN', 0, 50, 1, 0, 228 / 255, 0, 1, 50, 0, 100, 1, 1, 1, 0, 1]);
    // Areas share them; x pieces
    sdk.renderAreaChart([{ name: 'A', values: [1, 2, 3], piecesBy: 'x', pieces: [{ gte: 1, lt: 2, color: '#ff0000' }] }]);
    expect((calls.set_line_series_pieces[1] as unknown[]).slice(0, 2)).toEqual([0, 1]);
    // Empty pieces upload nothing
    sdk.renderLineChart([{ name: 'E', values: [1, 2], pieces: [] }]);
    expect(calls.set_line_series_pieces.length).toBe(2);
    const built = calls.set_line_chart.length;
    expect(() => sdk.renderLineChart([{ name: 'B', values: [1, 2], piecesBy: 'z' as never, pieces: [{ color: '#ff0000' }] }])).toThrow(
      "renderLineChart: series 0 piecesBy must be 'y' or 'x'"
    );
    expect(() => sdk.renderLineChart([{ name: 'B', values: [1, 2], pieces: [{ lt: NaN, color: '#ff0000' }] }])).toThrow(
      'renderLineChart: series 0 piece 0 bounds must be numbers (not NaN)'
    );
    expect(calls.set_line_chart.length).toBe(built);
  });

  it('tooltip swatches take the piece color of the hovered sample', () => {
    const calls: Calls = {};
    const hit = new Float64Array([0, 0, 2, 0, 2, 220, 2, 1, 2, 3, 5]);
    const sdk = Charturbo.fromBackend(
      mockBackend(calls, () => hit, undefined, (s) => (s === 0 ? new Float32Array([1, 0, 0, 1]) : new Float32Array(0)))
    );
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    sdk.renderLineChart([
      { name: 'AQI', values: [40, 120, 220], color: '#0000ff', pieces: [{ gt: 200, color: '#ff0000' }] },
      { name: 'Plain', values: [1, 2, 3], color: '#00ff00' },
    ]);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    const c = ctx as unknown as ChartTooltipContext;
    expect(c.items.map((it) => it.color)).toEqual(['rgb(255, 0, 0)', 'rgb(0, 255, 0)']);
    // Only series with pieces ask the engine
    expect(calls.chart_line_piece_color).toEqual([[0, 2]]);
  });

  it('samples without band edges (streamed after the band) show no range', () => {
    const calls: Calls = {};
    const hit = new Float64Array([0, 0, 1, 0, 2, 30, 2]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => hit, () => new Float64Array([NaN, NaN])));
    let ctx: ChartTooltipContext | null = null;
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement, {
      formatChartTooltip: (c) => {
        ctx = c;
        return '';
      },
    });
    sdk.renderLineChart(SERIES);
    canvas.fire('pointermove', { clientX: 400, clientY: 200, buttons: 0 });
    expect((ctx as unknown as ChartTooltipContext).items[0].band).toBeUndefined();
  });
});

describe('line band data table', () => {
  const meta = {
    kind: 'line',
    names: ['Forecast', 'Actual'],
    colors: [
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ],
    values: [new Float32Array([10, NaN, 30]), [9, 21, 29]],
    offsets: [0, 3],
    xPrefix: 'T',
    visible: [true, true],
    bands: [{ lower: new Float32Array([8, 18.1, 25]), upper: new Float32Array([12, 22, 35]) }, null],
  };
  const pres = { xAxis: {}, yAxis: {}, formatX: (v: number) => `T+${v}` };

  it('adds lower / upper columns after the banded series', () => {
    const model = buildA11yModel(meta, pres)!;
    expect(model.series[0].band).toBeDefined();
    const t = buildDataTable(model);
    expect(t.columns).toEqual(['X', 'Forecast', 'Forecast lower', 'Forecast upper', 'Actual']);
    expect(t.rows[1]).toEqual(['T+1', null, 18.1, 22, 21]);
    expect(tableToCSV(t).split('\r\n')[1]).toBe('T+0,10,8,12,9');
  });

  it('merged x rows look the band up at the same sample', () => {
    const model = buildA11yModel({ ...meta, xs: [new Float64Array([0, 1, 2]), new Float64Array([0, 2, 4])] }, pres)!;
    const t = buildDataTable(model);
    expect(t.columns.length).toBe(5);
    expect(t.rows.map((r) => r.slice(1, 4))).toEqual([
      [10, 8, 12],
      [null, 18.1, 22],
      [30, 25, 35],
      [null, null, null],
    ]);
  });
});
