import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Module load only: engines come from a mock `VizDevice` factory
vi.mock('../wasm-pkg/viz_core', () => ({
  default: vi.fn(async () => ({})),
  WasmVizEngine: { create: vi.fn(), create_with_device: vi.fn() },
  WasmGpuDevice: { create: vi.fn() },
}));

import { VIZ_THEMES, VizDevice, VizEngineSDK, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';
import {
  readSparklineSummary,
  resolveSparkline,
  sparklineLabel,
  sparklineNeedsRefit,
  winLossValues,
  type SparklineSpec,
} from '../sdk/chart-sparkline';

/** Minimal DOM element: canvas attributes, listeners, the chart overlay and tooltip. */
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
  id = '';
  type = '';
  tabIndex = -1;
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 124;
  offsetHeight = 34;
  clientWidth = 124;
  clientHeight = 34;
  width = 248;
  height = 68;
  classList = { add: () => {}, remove: () => {}, contains: () => false };

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
  removeEventListener(type: string, f: (e: unknown) => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((g) => g !== f);
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 124, height: 34 };
  }
  querySelectorAll(): FakeEl[] {
    return [];
  }
}

type Calls = Record<string, unknown[][]>;

/** Engine stand-in; `summary` = what `chart_sparkline_summary` returns (null = no binding). */
function mockBackend(calls: Calls, summary: (() => Float64Array) | null, onFree?: () => void): WasmVizEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const backend: WasmVizEngineBackend = {
    set_line_chart: record('set_line_chart', 1),
    set_line_chart_xy: record('set_line_chart_xy', 1),
    set_area_chart: record('set_area_chart', 1),
    set_bar_chart: record('set_bar_chart', 1),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_y_domain: record('set_chart_y_domain'),
    set_chart_sparkline: record('set_chart_sparkline'),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
    chart_axes_revision: () => 0,
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
    sync_and_render: record('sync_and_render'),
    rotate_camera: () => {},
    zoom_camera: () => {},
    pan_camera: () => {},
    fit_to_view: () => {},
    focus_on_node: () => true,
    resize: record('resize'),
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
    free: () => onFree?.(),
  };
  if (summary) backend.chart_sparkline_summary = summary;
  return backend;
}

/** `[count, first, last, min, max, firstIndex, lastIndex, minIndex, maxIndex, changePct]` */
const TREND = new Float64Array([5, 100, 112, 95, 120, 0, 4, 1, 3, 12]);

/** Device whose engines record into `calls` (one shared record per engine index). */
function mockDevice(calls: Calls[], summary: (() => Float64Array) | null = () => TREND) {
  let live = 0;
  const handle = { backend: () => 'webgpu', engine_count: () => live, pipeline_sets: () => (live > 0 ? 1 : 0), free: vi.fn() };
  const factory = vi.fn(() => {
    live++;
    const c: Calls = {};
    calls.push(c);
    return mockBackend(c, summary, () => live--);
  });
  return { device: VizDevice.fromBackend(handle, factory), factory, handle };
}

describe('renderSparkline', () => {
  let body: FakeEl;
  let container: FakeEl;
  let canvas: FakeEl;
  let created: string[];

  beforeEach(() => {
    body = new FakeEl('body');
    container = body.appendChild(new FakeEl('div'));
    canvas = container.appendChild(new FakeEl('canvas'));
    created = [];
    vi.stubGlobal('document', {
      body,
      head: new FakeEl('head'),
      createElement: (tag: string) => {
        created.push(tag);
        return new FakeEl(tag);
      },
      getElementById: () => null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function sparklineSdk(calls: Calls[], summary?: (() => Float64Array) | null) {
    const { device } = mockDevice(calls, summary === undefined ? () => TREND : summary);
    const sdk = await VizEngineSDK.create(canvas as unknown as HTMLCanvasElement, { device, autoResize: false });
    return { sdk, calls: calls[calls.length - 1] };
  }

  it('renders a line with zero chrome and no overlay DOM', async () => {
    const { sdk, calls } = await sparklineSdk([]);
    const res = sdk.renderSparkline([100, 95, 104, 120, 112], { label: 'Revenue' });
    sdk.render();

    // Plot = canvas CSS box minus 2 px padding on every side
    const line = calls.set_line_chart![0];
    expect(line.slice(4, 6)).toEqual([120, 30]);
    expect(calls.set_chart_padding!.at(-1)).toEqual([2, 2, 2, 2]);
    // No gridlines, tight (non-nice) y domain
    expect((calls.set_chart_frame_style!.at(-1)![0] as Float32Array)[0]).toBe(0);
    expect(calls.set_chart_y_domain!.at(-1)![3]).toBe(false);
    // No markers / band by default
    const marks = calls.set_chart_sparkline![0] as Float32Array[];
    expect([marks[0].length, marks[1].length, marks[2].length, marks[4].length, marks[6].length]).toEqual([0, 0, 0, 0, 0]);

    // Nothing created in the DOM, nothing next to the canvas, no zoom / pointer handling
    expect(created).toEqual([]);
    expect(container.children).toEqual([canvas]);
    expect(sdk.handlesChartNavigation()).toBe(false);
    expect(canvas.listeners.pointermove ?? []).toHaveLength(0);
    expect(canvas.listeners.wheel ?? []).toHaveLength(0);

    // a11y: label only, not focusable
    const label = 'Revenue: trend up 12% from 100 to 112, min 95, max 120';
    expect(canvas.attrs.role).toBe('img');
    expect(canvas.attrs['aria-label']).toBe(label);
    expect(canvas.attrs.tabindex).toBeUndefined();
    expect(res).toMatchObject({ pointCount: 5, label, summary: { first: 100, last: 112, minIndex: 1, maxIndex: 3 } });
    expect(sdk.getChartSummary()).toBe(label);
  });

  it('sends last / min / max markers, the band and padding that fits the markers', async () => {
    const { sdk, calls } = await sparklineSdk([]);
    sdk.renderSparkline(
      { values: [1, 3, 2] },
      { color: '#ff0000', showLast: true, showMinMax: true, minMaxColor: [0, 0, 1, 1], markerRadius: 3, band: [1.5, 2.5] }
    );
    const [last, min, max, radius, band, bandColor, zero] = calls.set_chart_sparkline![0] as [
      Float32Array,
      Float32Array,
      Float32Array,
      number,
      Float64Array,
      Float32Array,
      Float32Array,
    ];
    expect(Array.from(last)).toEqual([1, 0, 0, 1]);
    expect(Array.from(min)).toEqual([0, 0, 1, 1]);
    expect(Array.from(max)).toEqual([0, 0, 1, 1]);
    expect(radius).toBe(3);
    expect(Array.from(band)).toEqual([1.5, 2.5]);
    expect(bandColor[3]).toBeCloseTo(0.15);
    expect(zero.length).toBe(0);
    // Markers are not cut by the plot edge: padding = radius + 1
    expect(calls.set_chart_padding!.at(-1)).toEqual([4, 4, 4, 4]);
    expect(created).toEqual([]);
  });

  it('area sparkline fills with the given opacity', async () => {
    const { sdk, calls } = await sparklineSdk([]);
    sdk.renderSparkline([1, 2, 3], { type: 'area', fillOpacity: 0.35 });
    const area = calls.set_area_chart![0];
    // mode 0 = overlap, fill opacity
    expect(area.slice(7, 9)).toEqual([0, 0.35]);
    expect(created).toEqual([]);
  });

  it('win / loss bars: equal up / down bars by sign, zero line, no grid, count label', async () => {
    const { sdk, calls } = await sparklineSdk([], null);
    sdk.renderSparkline([3, -1, 0, 2, -5, 4], { type: 'winloss', showLast: true, label: 'Results' });
    const [values, colors] = calls.set_bar_chart![0] as [Float32Array, Float32Array];
    expect(Array.from(values)).toEqual([1, -1, NaN, 1, -1, 1]);
    const palette = VIZ_THEMES.dark.palette;
    expect(Array.from(colors.subarray(0, 4))).toEqual(palette[0].map(Math.fround));
    expect(Array.from(colors.subarray(4, 8))).toEqual(palette[1].map(Math.fround));
    // The bar chart's 2D grid is turned off again
    expect((calls.set_chart_frame_style!.at(-1)![0] as Float32Array)[0]).toBe(0);
    const marks = calls.set_chart_sparkline![0] as Float32Array[];
    expect(marks[0].length).toBe(0); // no last marker on win / loss
    expect(marks[6].length).toBe(4); // zero line
    expect(canvas.attrs['aria-label']).toBe('Results: 3 wins, 2 losses, 1 tie, last: win');
    expect(created).toEqual([]);
  });

  it('tooltip is opt-in and the next regular chart gets its overlay back', async () => {
    const { sdk } = await sparklineSdk([]);
    sdk.renderSparkline([1, 2, 3], { tooltip: true });
    expect(created).toContain('div'); // the tooltip element
    expect(canvas.listeners.pointermove?.length ?? 0).toBeGreaterThan(0);
    created.length = 0;

    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    expect(created.length).toBeGreaterThan(0); // overlay DOM again
    expect(sdk.getChartSummary()).not.toContain('trend');
  });

  it('re-fits an auto-sized sparkline when the canvas aspect changes', async () => {
    const { sdk, calls } = await sparklineSdk([]);
    sdk.renderSparkline([1, 2, 3]);
    canvas.clientWidth = 204;
    sdk.resize(408, 68);
    expect(calls.set_line_chart!.at(-1)!.slice(4, 6)).toEqual([200, 30]);
    // Same aspect: no re-render
    const n = calls.set_line_chart!.length;
    sdk.resize(408, 68);
    expect(calls.set_line_chart!.length).toBe(n);
  });

  it('refit keeps updated data; a failed build leaves no sparkline behind', async () => {
    const { sdk, calls } = await sparklineSdk([]);
    sdk.renderSparkline([1, 2, 3]);
    sdk.setSeriesData(0, [5, 6, 7, 8]);
    canvas.clientWidth = 204;
    sdk.resize(408, 68);
    expect(Array.from(calls.set_line_chart!.at(-1)![0] as Float32Array)).toEqual([5, 6, 7, 8]);

    expect(() => sdk.renderSparkline({ values: [1, 2], x: [1] })).toThrow();
    canvas.clientWidth = 124;
    expect(() => sdk.resize(248, 68)).not.toThrow();
    expect(sdk.getChartSummary()).not.toContain('trend');
  });

  it('the opt-in tooltip binding goes away with the sparkline', async () => {
    const { sdk } = await sparklineSdk([]);
    sdk.renderSparkline([1, 2, 3], { tooltip: true });
    expect(canvas.listeners.pointermove?.length ?? 0).toBeGreaterThan(0);
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    expect(canvas.listeners.pointermove ?? []).toHaveLength(0);
  });

  it('200 sparklines on one shared device build no DOM', async () => {
    const calls: Calls[] = [];
    const { device, factory } = mockDevice(calls);
    const sdks: VizEngineSDK[] = [];
    for (let i = 0; i < 200; i++) {
      const c = container.appendChild(new FakeEl('canvas'));
      const sdk = await VizEngineSDK.create(c as unknown as HTMLCanvasElement, { device, autoResize: false });
      sdk.renderSparkline({ values: [i, i + 1, i % 7, i + 2] }, { showLast: true });
      sdk.render();
      sdks.push(sdk);
    }
    expect(factory).toHaveBeenCalledTimes(200);
    expect(device.engineCount).toBe(200);
    expect(device.pipelineSets).toBe(1);
    expect(created).toEqual([]);
    expect(container.children.every((c) => c.tag === 'canvas')).toBe(true);
    sdks.forEach((s) => s.dispose());
    expect(device.engineCount).toBe(0);
  });
});

describe('sparkline helpers', () => {
  const theme = VIZ_THEMES.dark;
  const spec = (values: number[], label?: string): SparklineSpec =>
    resolveSparkline({ values }, { label }, theme, [124, 34], 'en-US');

  it('labels up / down / flat / empty trends', () => {
    const none = { chart_sparkline_summary: undefined } as unknown as WasmVizEngineBackend;
    const label = (v: number[]) => {
      const s = spec(v, 'CPU');
      return sparklineLabel(s, readSparklineSummary(none, s.values), 'en-US');
    };
    expect(label([50, 40, 45])).toBe('CPU: trend down 10% from 50 to 45, min 40, max 50');
    expect(label([10, 12.5])).toBe('CPU: trend up 25% from 10 to 12.5, min 10, max 12.5');
    expect(label([0, 3])).toBe('CPU: trend up from 0 to 3, min 0, max 3');
    expect(label([7, 9, 7])).toBe('CPU: flat at 7, min 7, max 9');
    expect(label([7])).toBe('CPU: flat at 7');
    expect(label([NaN])).toBe('CPU: no data');
    // description replaces the generated label
    const s = resolveSparkline({ values: [1, 2] }, { description: 'Custom' }, theme, [124, 34]);
    expect(sparklineLabel(s, null)).toBe('Custom');
  });

  it('reads the engine summary (f32 values shortened) and maps win / loss signs', () => {
    const backend = { chart_sparkline_summary: () => new Float64Array([2, Math.fround(0.1), Math.fround(0.3), 0.1, 0.3, 0, 1, 0, 1, 200]) };
    const s = readSparklineSummary(backend as unknown as WasmVizEngineBackend, [])!;
    expect([s.first, s.last, s.changePct]).toEqual([0.1, 0.3, 200]);
    expect(readSparklineSummary({ chart_sparkline_summary: () => new Float64Array(0) } as unknown as WasmVizEngineBackend, [1])).toBeNull();
    expect(Array.from(winLossValues([2, -0.5, 0, NaN]))).toEqual([1, -1, NaN, NaN]);
  });

  it('refits only auto-sized specs whose aspect moved', () => {
    const s = spec([1, 2]);
    expect(sparklineNeedsRefit(s, [124, 34])).toBe(false);
    expect(sparklineNeedsRefit(s, [204, 34])).toBe(true);
    const fixed = resolveSparkline({ values: [1] }, { width: 10, height: 10 }, theme, [124, 34]);
    expect(sparklineNeedsRefit(fixed, [400, 34])).toBe(false);
  });
});
