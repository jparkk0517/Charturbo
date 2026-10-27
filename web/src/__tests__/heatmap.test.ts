import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHARTURBO_THEMES,
  Charturbo,
  type ChartTooltipContext,
  type WasmCharturboEngineBackend,
} from '../sdk/charturbo';
import { decodeColorbar, heatmapAxisLabel, heatmapMeta, heatmapRowLabel } from '../sdk/chart-heatmap';

// The a11y layer needs a full DOM and has its own tests (chart-a11y.test.ts, incl. heatmaps)
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    constructor(readonly host: () => unknown) {}
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));

/** Minimal DOM element: enough for the chart overlay (ticks, colorbar) and the tooltip. */
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
  replaceChildren(...cs: FakeEl[]): void {
    this.children.forEach((c) => (c.parentElement = null));
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

/** 4-entry ramp: black -> red -> green -> white (RGBA8). */
const LUT = new Uint8Array([0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 255, 255, 255, 255]);

function mockBackend(calls: Calls, hit: () => Float64Array, axes: () => Float64Array): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let axesRevision = 0;
  return {
    set_heatmap_chart: record('set_heatmap_chart', 12),
    set_chart_heatmap_colormap: record('set_chart_heatmap_colormap'),
    set_chart_heatmap_domain: record('set_chart_heatmap_domain'),
    // lo 0, hi 10, sequential, ticks 0 / 5 / 10
    chart_heatmap_colorbar: () => new Float64Array([0, 10, NaN, 3, 0, 0, 5, 0.5, 10, 1]),
    chart_heatmap_lut: () => LUT,
    chart_heatmap_color: (v: number) => (Number.isFinite(v) ? new Uint8Array([10, 20, 30, 255]) : new Uint8Array([0, 0, 0, 0])),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_zoom_xy: record('chart_zoom_xy'),
    chart_pan_xy: record('chart_pan_xy'),
    chart_zoom_x: record('chart_zoom_x'),
    chart_hover_at_ndc: () => hit(),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0]),
    chart_axes_revision: () => ++axesRevision,
    chart_axes: () => axes(),
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

/** 4 x 3 grid, value = row * 10 + col, cell (1, 2) empty. */
function grid(): number[] {
  const v = Array.from({ length: 12 }, (_, i) => Math.floor(i / 4) * 10 + (i % 4));
  v[6] = NaN;
  return v;
}

const LABELS = { xLabels: ['Mon', 'Tue', 'Wed', 'Thu'], yLabels: ['A', 'B', 'C'] };

describe('Native heatmap (SDK binding)', () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the grid as one typed array plus colormap / domain codes', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => new Float64Array(0)));
    const res = sdk.renderHeatmap({ cols: 4, rows: 3, values: grid(), ...LABELS }, { title: 'Load' });
    expect(res.cellCount).toBe(12);
    const [cols, rows, values, w, h, rowTop, xExt, yExt] = calls.set_heatmap_chart[0] as [
      number, number, Float32Array, number, number, boolean, Float64Array, Float64Array,
    ];
    expect([cols, rows, rowTop]).toEqual([4, 3, true]);
    expect(values).toBeInstanceOf(Float32Array);
    expect(values[5]).toBe(11);
    expect(Number.isNaN(values[6])).toBe(true);
    expect(Number.isNaN(w) && Number.isNaN(h)).toBe(true); // engine default size
    expect([xExt.length, yExt.length]).toEqual([0, 0]); // categorical axes

    // Sequential default, dark surface, no custom hue / empty color
    const [kind, hue, reverse, surface, empty] = calls.set_chart_heatmap_colormap[0] as [
      number, Float32Array, boolean, Float32Array, Float32Array,
    ];
    expect([kind, hue.length, reverse, empty.length]).toEqual([0, 0, false, 0]);
    expect(Array.from(surface)).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.dark.surface)));
    expect((calls.set_chart_heatmap_domain[0] as number[]).every(Number.isNaN)).toBe(true);
    // Title on top, colorbar reserve on the right, no legend
    expect(calls.set_chart_padding.at(-1)).toEqual([36, 84, 30, 56]);
    expect(sdk.handlesChartNavigation()).toBe(true);

    // Float32Array input is passed through without a copy
    const f32 = new Float32Array(16);
    sdk.renderHeatmap(
      { cols: 4, rows: 4, values: f32, xExtent: [0, 100], yExtent: [-1, 1] },
      { colorScale: 'diverging', center: 0.5, min: -2, rowOrder: 'bottom-up', colorbar: false, color: '#ff0000', reverse: true }
    );
    const second = calls.set_heatmap_chart[1];
    expect(second[2]).toBe(f32);
    expect(second[5]).toBe(false);
    expect(Array.from(second[6] as Float64Array)).toEqual([0, 100]);
    expect(Array.from(second[7] as Float64Array)).toEqual([-1, 1]);
    const cm = calls.set_chart_heatmap_colormap[1];
    expect([cm[0], cm[2]]).toEqual([3, true]);
    expect(Array.from(cm[1] as Float32Array)).toEqual([1, 0, 0, 1]);
    const dom = calls.set_chart_heatmap_domain[1] as number[];
    expect([dom[0], Number.isNaN(dom[1]), dom[2]]).toEqual([-2, true, 0.5]);
    expect(calls.set_chart_padding.at(-1)).toEqual([12, 16, 30, 56]);
  });

  it('hover resolves the engine cell into labels, value, and the displayed color', () => {
    const calls: Calls = {};
    // Engine hit: row 2 (series), col 1 (index), value 21, id 9
    let hit = new Float64Array([0, 0, 1, 2, 1, 21, 9]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => hit, () => new Float64Array(0)));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderHeatmap({ cols: 4, rows: 3, values: grid(), ...LABELS }, { valueLabel: 'Load' });
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));

    canvas.fire('pointermove', { buttons: 0, clientX: 400, clientY: 200 });
    const ctx = seen.at(-1)!;
    expect(ctx.chartType).toBe('heatmap');
    expect(ctx.cell).toEqual({ row: 2, col: 1, xLabel: 'Tue', yLabel: 'C' });
    expect(ctx.items[0]).toMatchObject({ seriesName: 'Load', value: 21, color: 'rgb(10, 20, 30)', nodeId: 9 });
    expect(ctx.details?.metadata.attributes).toEqual({ row: 2, col: 1, x: 'Tue', y: 'C', value: 21 });
    const tooltip = body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    expect(tooltip.innerHTML).toContain('C · Tue');
    expect(tooltip.innerHTML).toContain('21');

    // Empty cells / outside the plot: the engine reports nothing
    hit = new Float64Array(0);
    canvas.fire('pointermove', { buttons: 0, clientX: 10, clientY: 10 });
    expect(seen.at(-1)).toBeNull();
    expect(sdk.getNodeDetails(6)?.metadata.attributes?.value).toBe('empty');
    expect(sdk.getNodeDetails(12)).toBeNull();

    // Keyboard a11y path: the host hook gives the same tooltip as the pointer
    type Host = { chartTooltip(hit: Float64Array): ChartTooltipContext | null };
    const host = (sdk as unknown as { a11y: { host: () => Host } }).a11y.host();
    const keyCtx = host.chartTooltip(new Float64Array([0, 0, 1, 2, 1, 21, 9]))!;
    expect(keyCtx.cell).toEqual({ row: 2, col: 1, xLabel: 'Tue', yLabel: 'C' });
    expect(keyCtx.items[0]).toMatchObject({ seriesName: 'Load', value: 21, color: 'rgb(10, 20, 30)', nodeId: 9 });

    // Wheel / drag navigate both axes
    canvas.fire('wheel', { deltaY: -100, clientX: 400, clientY: 200, preventDefault: () => {} });
    expect(calls.chart_zoom_xy.length).toBe(1);
    expect(calls.chart_zoom_x).toBeUndefined();
  });

  it('builds a solid-slice colorbar from the engine LUT and ticks beside the plot', () => {
    const calls: Calls = {};
    const axes = new Float64Array([56, 36, 600, 300, 0]);
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => new Float64Array(0), () => axes));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderHeatmap({ cols: 4, rows: 3, values: grid() }, { colorbar: { title: 'ms' } });
    sdk.render();

    const [bar] = container.querySelectorAll('.charturbo-sdk-heatmap-colorbar');
    expect(bar.style.left).toBe(`${56 + 600 + 14}px`);
    expect(bar.attrs['aria-label']).toBe('ms color scale from 0 to 10');
    const slices = container.querySelectorAll('.charturbo-sdk-heatmap-colorbar-bar')[0].children;
    expect(slices.length).toBe(64);
    // High values on top: first slice = last LUT entry, last slice = first
    expect(slices[0].style.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(slices[63].style.backgroundColor).toBe('rgb(0, 0, 0)');
    const ticks = container.querySelectorAll('.charturbo-sdk-heatmap-colorbar-tick');
    expect(ticks.map((t) => [t.textContent, t.style.top])).toEqual([
      ['0', '300px'],
      ['5', '150px'],
      ['10', '0px'],
    ]);
    expect(container.querySelectorAll('.charturbo-sdk-heatmap-colorbar-title')[0].textContent).toBe('ms');

    // Theme switch re-sends the colormap with the new surface and rebuilds the bar
    sdk.setTheme('light');
    const last = calls.set_chart_heatmap_colormap.at(-1)!;
    expect(Array.from(last[3] as Float32Array)).toEqual(Array.from(new Float32Array(CHARTURBO_THEMES.light.surface)));
    expect(container.querySelectorAll('.charturbo-sdk-heatmap-colorbar').length).toBe(1);

    // Colormap / domain changes are thin engine calls
    sdk.setHeatmapColorScale('magma');
    sdk.setHeatmapDomain({ max: 50 });
    expect(calls.set_chart_heatmap_colormap.at(-1)![0]).toBe(2);
    const d = calls.set_chart_heatmap_domain.at(-1) as number[];
    expect([Number.isNaN(d[0]), d[1], Number.isNaN(d[2])]).toEqual([true, 50, true]);
  });

  it('labels cells by category or numeric cell center and decodes the colorbar', () => {
    const fmt = (v: number) => v.toFixed(1);
    expect(heatmapAxisLabel(['a', 'b'], null, 2, 1, fmt)).toBe('b');
    expect(heatmapAxisLabel(null, null, 2, 1, fmt)).toBe('1');
    expect(heatmapAxisLabel(null, [0, 10], 5, 0, fmt)).toBe('1.0');
    // y extent runs bottom -> top: in a top-down grid row 0 is the top cell
    const meta = heatmapMeta({ cols: 1, rows: 4, values: [1, 2, 3, 4], yExtent: [0, 4] });
    expect(heatmapRowLabel(meta, 0, fmt)).toBe('3.5');
    expect(heatmapRowLabel({ ...meta, rowTop: false }, 0, fmt)).toBe('0.5');
    expect(heatmapMeta({ cols: 1, rows: 1, values: [1], xExtent: [3, 3] }).xExtent).toBeNull();

    expect(decodeColorbar(new Float64Array([-1, 1, 0, 1, 0, 0.5]))).toEqual({
      lo: -1,
      hi: 1,
      center: 0,
      ticks: [{ value: 0, t: 0.5 }],
    });
    expect(decodeColorbar(new Float64Array(0))).toBeNull();
  });
});
