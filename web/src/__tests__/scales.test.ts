import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VizEngineSDK, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';
import { decodeScale, encodeScale, encodeSeriesAxes, hasScaleOptions } from '../sdk/chart-scales';
import { encodeAnnotations } from '../sdk/chart-annotations';
import { VIZ_THEMES } from '../sdk/viz-engine-sdk';

// Overlay-only suite: the a11y layer has its own tests and needs a full DOM.
vi.mock('../sdk/chart-a11y', () => ({
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
}));

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
  /** Used by the a11y layer to place its hidden description next to the canvas */
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

/** Mock backend recording chart calls; `scales` stands in for the engine's per-axis scale state. */
function mockBackend(calls: Calls, axes: () => Float64Array = () => new Float64Array(0)): WasmVizEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const scales = new Map<number, [number, boolean, number]>();
  let axesRevision = 0;
  return {
    set_line_chart: record('set_line_chart', 0),
    set_line_chart_xy: record('set_line_chart_xy', 0),
    set_area_chart: record('set_area_chart', 0),
    set_scatter_chart: record('set_scatter_chart', 0),
    set_bar_chart: record('set_bar_chart', 0),
    chart_series_count: () => 1,
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_y_domain: record('set_chart_y_domain'),
    set_chart_y2_domain: record('set_chart_y2_domain'),
    chart_y2_domain: () => new Float64Array([1, 1000, 0]),
    set_chart_series_axes: record('set_chart_series_axes'),
    set_chart_axis_scale: (axis: number, kind: number, reverse: boolean, ticks: number) => {
      (calls.set_chart_axis_scale ??= []).push([axis, kind, reverse, ticks]);
      scales.set(axis, [kind, reverse, ticks]);
    },
    chart_axis_scale: (axis: number) => {
      const s = scales.get(axis) ?? [0, false, 0];
      return new Float64Array([s[0], s[1] ? 1 : 0, s[2]]);
    },
    set_chart_annotations: record('set_chart_annotations'),
    set_chart_annotation_y_axes: record('set_chart_annotation_y_axes'),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
    chart_axes_revision: () => ++axesRevision,
    chart_axes: () => axes(),
    set_clear_color: record('set_clear_color'),
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

const TEMP = { name: 'Temp', values: [10, 12, 11] };
const RAIN = { name: 'Rain', values: [1, 100, 1000], yAxis: 'right' as const };

describe('chart-scales encoding', () => {
  it('encodes scale options and per-series axes', () => {
    expect(hasScaleOptions(undefined)).toBe(false);
    expect(hasScaleOptions({ title: 'x' } as never)).toBe(false);
    expect(hasScaleOptions({ reverse: false })).toBe(true);
    expect(encodeScale({})).toEqual([0, false, 0]);
    expect(encodeScale({ scale: 'log', reverse: true, tickCount: 4.6 })).toEqual([1, true, 5]);
    expect(encodeScale({ tickCount: -3 })).toEqual([0, false, 0]);
    expect(encodeScale({ tickCount: NaN })).toEqual([0, false, 0]);
    expect(decodeScale(new Float64Array([1, 1, 6]))).toEqual({ scale: 'log', reverse: true, tickCount: 6 });
    expect(decodeScale(new Float64Array(0))).toBeNull();
    expect(decodeScale(undefined)).toBeNull();
    expect(encodeSeriesAxes([{}, { yAxis: 'left' }])).toBeNull();
    expect(Array.from(encodeSeriesAxes([{}, { yAxis: 'right' }, { yAxis: 'left' }])!)).toEqual([0, 1, 0]);
  });

  it('encodes annotation y axes (default left)', () => {
    const e = encodeAnnotations(
      [
        { type: 'hline', y: 5 },
        { type: 'hline', y: 500, yAxis: 'right' },
        { type: 'yband', from: 1, to: 2, yAxis: 'left' },
      ],
      VIZ_THEMES.dark
    );
    expect(Array.from(e.yAxes)).toEqual([0, 1, 0]);
  });
});

describe('axis scales and dual y axes in the SDK', () => {
  let container: FakeEl;
  let canvas: FakeEl;

  beforeEach(() => {
    const body = new FakeEl('body');
    container = new FakeEl('div');
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

  it('single-axis line charts stay opt-out: no series axes, no scale calls, default padding', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP, { ...RAIN, yAxis: 'left' }], { axes: { y2: { title: 'unused', scale: 'log' } } });
    expect(calls.set_chart_series_axes).toBeUndefined();
    expect(calls.set_chart_axis_scale).toBeUndefined();
    expect(calls.set_chart_y2_domain).toBeUndefined();
    expect(calls.set_chart_padding.at(-1)).toEqual([40, 16, 30, 56]);
  });

  it('sends series axes, per-axis scales and the right domain; pads and labels the right axis', () => {
    const calls: Calls = {};
    // Plot 56,40 600x300; one left y tick, one right y tick, one x tick
    const axes = () => new Float64Array([56, 40, 600, 300, 3, 0, 1, 100, 340, 1, 10, 56, 200, 2, 100, 656, 100]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart([TEMP, RAIN], {
      axes: {
        x: { reverse: true },
        y: { title: 'Temp', tickCount: 4 },
        y2: { title: 'Rain', scale: 'log', min: 1, format: (v) => `${v} mm` },
      },
    });
    expect(calls.set_chart_series_axes).toEqual([[new Uint8Array([0, 1])]]);
    expect(calls.set_chart_axis_scale).toEqual([
      [0, 0, true, 0],
      [1, 0, false, 4],
      [2, 1, false, 0],
    ]);
    expect(calls.set_chart_y2_domain).toEqual([[1, NaN, 0, true]]);
    expect(calls.set_chart_y_domain).toBeUndefined();
    // Right padding: tick labels (56) + title (20); legend (28) on top
    expect(calls.set_chart_padding.at(-1)).toEqual([40, 76, 30, 76]);
    expect(sdk.getY2Domain()).toEqual([1, 1000]);

    sdk.render();
    const ticks = container.querySelectorAll('.viz-sdk-axis-tick');
    expect(ticks.map((t) => t.textContent)).toEqual(['T+1', '10', '100 mm']);
    expect(ticks[2].style.left).toBe('664px');
    expect(ticks[2].style.transform).toBe('translate(0, -50%)');
    expect(ticks[1].style.transform).toBe('translate(-100%, -50%)');
    const titles = container.querySelectorAll('.viz-sdk-axis-title');
    expect(titles.map((t) => t.textContent)).toEqual(['', 'Temp', 'Rain']);
    expect(titles[2].style.left).toBe('718px');
    expect(titles[2].style.transform).toContain('rotate(90deg)');
  });

  it('hides right tick labels without a right axis presentation (2.5D)', () => {
    const calls: Calls = {};
    const axes = () => new Float64Array([56, 40, 600, 300, 1, 2, 100, 656, 100]);
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart([TEMP, RAIN], { viewMode: '2.5d' });
    expect(calls.set_chart_series_axes).toHaveLength(1);
    sdk.render();
    const shown = container.querySelectorAll('.viz-sdk-axis-tick').filter((t) => t.style.display !== 'none');
    expect(shown).toHaveLength(0);
    expect(container.querySelectorAll('.viz-sdk-axis-title')).toHaveLength(2);
  });

  it('setAxisScale merges into the engine state; setY2Domain merges its options', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP, RAIN]);
    sdk.setAxisScale('y2', { scale: 'log' });
    sdk.setAxisScale('y2', { reverse: true });
    expect(calls.set_chart_axis_scale.slice(-2)).toEqual([
      [2, 1, false, 0],
      [2, 1, true, 0],
    ]);
    expect(sdk.getAxisScale('y2')).toEqual({ scale: 'log', reverse: true, tickCount: 0 });
    sdk.setY2Domain({ min: 1 });
    sdk.setY2Domain({ autoscale: 'visible' });
    expect(calls.set_chart_y2_domain.at(-1)).toEqual([1, NaN, 1, true]);
  });

  it('applies scatter scales; area charts ignore right-axis series; bar charts ignore setAxisScale', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls));
    sdk.renderScatterChart({ x: [1, 10, 100], y: [3, 2, 1] }, { axes: { x: { scale: 'log' }, y: { reverse: true, tickCount: 3 } } });
    expect(calls.set_chart_axis_scale).toEqual([
      [0, 1, false, 0],
      [1, 0, true, 3],
    ]);

    sdk.renderAreaChart([TEMP, RAIN], { axes: { y: { scale: 'log' } } });
    expect(calls.set_chart_series_axes).toBeUndefined();
    expect(calls.set_chart_axis_scale.at(-1)).toEqual([1, 1, false, 0]);
    expect(calls.set_chart_padding.at(-1)?.[1]).toBe(16);

    sdk.renderBarChart([{ label: 'a', value: 1 }]);
    const n = calls.set_chart_axis_scale.length;
    sdk.setAxisScale('y', { scale: 'log' });
    expect(calls.set_chart_axis_scale.length).toBe(n);
  });

  it('forwards annotation y axes only when an annotation uses the right axis', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls));
    sdk.renderLineChart([TEMP, RAIN]);
    sdk.setAnnotations([{ type: 'hline', y: 11 }]);
    expect(calls.set_chart_annotation_y_axes).toBeUndefined();
    sdk.addAnnotation({ type: 'hline', y: 500, yAxis: 'right' });
    expect(calls.set_chart_annotations).toHaveLength(2);
    expect(calls.set_chart_annotation_y_axes).toEqual([[new Uint8Array([0, 1])]]);
  });
});
