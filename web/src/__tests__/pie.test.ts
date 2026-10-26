import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VIZ_THEMES, VizEngineSDK, type ChartTooltipContext, type WasmVizEngineBackend } from '../sdk/viz-engine-sdk';
import { formatPercent, pieLabelSpace, pieMeta, textOn } from '../sdk/chart-pie';
import {
  buildA11yModel,
  buildChartDescription,
  buildChartSummary,
  buildDataTable,
  pointAnnouncement,
  stepFocus,
  tooltipContext,
} from '../sdk/chart-a11y';

/** Minimal DOM element: enough for the chart overlay, legend, labels and the tooltip. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  parentElement: FakeEl | null = null;
  className = '';
  private text = '';
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

  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(v: string) {
    this.children = [];
    this.text = v;
  }
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
    this.text = '';
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

interface PieState {
  /** Displayed slices: source (-1 = Other), value, visible */
  slices: { source: number; value: number; visible: boolean }[];
  hit: Float64Array;
  hovered: number;
  labelsRev: number;
  labels: number[];
}

/** Engine stand-in: percents of the visible total, palette colors by display order. */
function mockBackend(calls: Calls, st: PieState): WasmVizEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_pie_chart: (...args: unknown[]) => {
      (calls.set_pie_chart ??= []).push(args);
      return st.slices.length;
    },
    set_chart_pie_style: record('set_chart_pie_style'),
    chart_pie_slices: () => {
      const total = st.slices.reduce((s, x) => (x.visible ? s + x.value : s), 0);
      const out: number[] = [];
      st.slices.forEach((s, k) => {
        out.push(s.source, s.value, s.visible ? (s.value / total) * 100 : NaN, s.visible ? 1 : 0, k / 10, 0.5, 0.5, 1);
      });
      return new Float64Array(out);
    },
    chart_pie_other: () => new Uint32Array([3, 4]),
    chart_pie_labels: () => new Float64Array([st.labelsRev, st.labels.length / 4, ...st.labels]),
    chart_pie_layout: () => new Float64Array([400, 210, 150, 75, st.slices.reduce((s, x) => (x.visible ? s + x.value : s), 0), st.hovered]),
    set_chart_series_visible: (k: number, v: boolean) => {
      (calls.set_chart_series_visible ??= []).push([k, v]);
      st.slices[k].visible = v;
      st.labelsRev++;
    },
    set_chart_emphasis: record('set_chart_emphasis'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_zoom_x: record('chart_zoom_x'),
    chart_zoom_xy: record('chart_zoom_xy'),
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([id, id, st.slices[id]?.value ?? 0, 1, 2, 0, NaN]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([250, 60, 300, 300, 0]),
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

const DATA = { labels: ['Search', 'Direct', 'Social', 'Email', 'Ads'], values: [50, 30, 12, 5, 3] };

/** Engine output for DATA with maxSlices 4: three kept slices + "Other" (Email + Ads). */
function state(): PieState {
  return {
    slices: [
      { source: 0, value: 50, visible: true },
      { source: 1, value: 30, visible: true },
      { source: 2, value: 12, visible: true },
      { source: -1, value: 8, visible: true },
    ],
    hit: new Float64Array(0),
    hovered: -1,
    labelsRev: 1,
    // Slice 0 right of the pie, slice 1 left, slice 3 inside
    labels: [0, 600, 120, 1, 1, 200, 300, -1, 3, 420, 230, 0],
  };
}

describe('Native pie chart (SDK binding)', () => {
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
    vi.stubGlobal('queueMicrotask', (f: () => void) => f());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends values and layout codes to the engine and the theme palette in fixed order', () => {
    const calls: Calls = {};
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, state()));
    const res = sdk.renderPieChart(DATA, {
      donut: 0.6,
      sort: 'desc',
      maxSlices: 4,
      startAngle: 90,
      direction: 'counterclockwise',
      labels: 'outside',
      colors: [undefined, '#ff0000'],
      title: 'Traffic',
    });
    expect(res.sliceCount).toBe(4);
    const [values, sort, max, start, clockwise, inner, labels, minAngle, line, sx, sy] = calls.set_pie_chart[0] as [
      Float64Array, number, number, number, boolean, number, number, number, number, number, number,
    ];
    expect(values).toBeInstanceOf(Float64Array);
    expect(Array.from(values)).toEqual(DATA.values);
    expect([sort, max, start, clockwise, inner, labels]).toEqual([1, 4, 90, false, 0.6, 1]);
    expect(Number.isNaN(minAngle)).toBe(true);
    expect(line).toBe(16);
    expect(sx).toBeGreaterThanOrEqual(64);
    expect(sy).toBeGreaterThan(0);

    const [palette, colors, other, leader, surface] = calls.set_chart_pie_style[0] as Float32Array[];
    expect(palette.length).toBe(VIZ_THEMES.dark.palette.length * 4);
    expect(Array.from(palette.slice(0, 4))).toEqual(Array.from(new Float32Array(VIZ_THEMES.dark.palette[0])));
    expect(Number.isNaN(colors[0])).toBe(true);
    expect(Array.from(colors.slice(4, 8))).toEqual([1, 0, 0, 1]);
    expect(Array.from(other)).toEqual(Array.from(new Float32Array(VIZ_THEMES.dark.baseline)));
    expect(leader.length).toBe(4);
    expect(Array.from(surface)).toEqual(Array.from(new Float32Array(VIZ_THEMES.dark.surface)));

    // No axes, no navigation, no brush (angular layout); legend + title reserve the top
    expect(sdk.handlesChartNavigation()).toBe(false);
    sdk.setChartBrush('x');
    expect(sdk.handlesChartBrush()).toBe(false);
    expect(calls.set_chart_padding.at(-1)).toEqual([12 + 24 + 28, 16, 12, 12]);

    // Folding off / no labels
    sdk.renderPieChart(DATA, { maxSlices: false, labels: 'none' });
    const second = calls.set_pie_chart[1];
    expect([second[1], second[2], second[6], second[9], second[10]]).toEqual([0, 0, 0, 0, 0]);
    // Theme switch re-sends the palette
    sdk.setTheme('light');
    const last = calls.set_chart_pie_style.at(-1) as Float32Array[];
    expect(Array.from(last[0].slice(0, 4))).toEqual(Array.from(new Float32Array(VIZ_THEMES.light.palette[0])));
  });

  it('hover tooltip shows label, value and percent; "Other" lists its members', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderPieChart(DATA, { maxSlices: 4, valueLabel: 'Visits' });
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));

    // Engine hit: slice 1 (series = index = 1), value 30
    st.hit = new Float64Array([0, 0, 1, 1, 1, 30, 1]);
    canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
    const ctx = seen.at(-1)!;
    expect(ctx.chartType).toBe('pie');
    expect(ctx.slice).toEqual({ label: 'Direct', value: 30, percent: 30 });
    expect(ctx.items[0]).toMatchObject({ seriesName: 'Direct', value: 30, percent: 30, nodeId: 1 });
    expect(ctx.details?.metadata.attributes).toEqual({ value: 30, percent: 30 });
    const tooltip = body.children.find((c) => c.className.includes('viz-sdk-node-tooltip'))!;
    expect(tooltip.innerHTML).toContain('Direct');
    expect(tooltip.innerHTML).toContain('30.0%');

    st.hit = new Float64Array([0, 0, 1, 3, 3, 8, 3]);
    canvas.fire('pointermove', { buttons: 0, clientX: 320, clientY: 200 });
    expect(seen.at(-1)!.slice).toEqual({ label: 'Other', value: 8, percent: 8, members: ['Email', 'Ads'] });
    expect(tooltip.innerHTML).toContain('Email, Ads');

    // Wheel does not zoom a pie
    canvas.fire('wheel', { deltaY: -100, clientX: 400, clientY: 200, preventDefault: () => {} });
    expect(calls.chart_zoom_x).toBeUndefined();
    expect(calls.chart_zoom_xy).toBeUndefined();

    // Keyboard a11y path gets the same tooltip
    type Host = { chartTooltip(hit: Float64Array): ChartTooltipContext | null };
    const host = (sdk as unknown as { a11y: { host: () => Host } }).a11y.host();
    expect(host.chartTooltip(new Float64Array([0, 0, 1, 1, 1, 30, 1]))!.slice?.label).toBe('Direct');
  });

  it('legend toggles slices through the engine and labels / center follow its anchors', () => {
    const calls: Calls = {};
    const st = state();
    const sdk = VizEngineSDK.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderPieChart(DATA, { maxSlices: 4, donut: 0.5, format: (v) => `${v} u` });
    sdk.render();

    const items = container.querySelectorAll('.viz-sdk-legend-item');
    expect(items.map((i) => i.textContent)).toEqual(['Search', 'Direct', 'Social', 'Other']);
    // Square swatches (fills), colors from the engine
    expect(items[0].children[0].style.height).toBe('10px');
    expect(items[1].children[0].style.background).toBe('rgb(26, 128, 128)');

    // Labels at the engine anchors: right side grows right, left side grows left, inside centered
    const labels = container.querySelectorAll('.viz-sdk-pie-label');
    expect(labels.length).toBe(3);
    expect([labels[0].style.left, labels[0].style.top, labels[0].style.transform]).toEqual(['604px', '120px', 'translate(0, -50%)']);
    expect(labels[0].textContent).toBe('Search50.0%');
    expect(labels[0].children[1].style.marginLeft).toBe('4px');
    expect([labels[1].style.left, labels[1].style.transform]).toEqual(['196px', 'translate(-100%, -50%)']);
    expect(labels[2].textContent).toBe('8.0%');
    expect(labels[2].style.transform).toBe('translate(-50%, -50%)');

    // Donut center: visible total, then the hovered slice
    const [center] = container.querySelectorAll('.viz-sdk-pie-center');
    expect([center.style.left, center.style.top, center.style.display]).toEqual(['400px', '210px', 'block']);
    expect(center.textContent).toBe('100 uTotal');
    st.hovered = 0;
    sdk.render();
    expect(center.textContent).toBe('50 uSearch · 50.0%');
    st.hovered = -1;

    // Click hides "Direct": engine re-layout, percents re-read, labels re-laid out
    const seen: unknown[] = [];
    sdk.on('legendtoggle', (e) => seen.push(e));
    items[1].fire('click');
    expect(calls.set_chart_series_visible).toEqual([[1, false]]);
    expect(calls.set_chart_emphasis.at(-1)).toEqual([-1]);
    expect(seen).toEqual([{ series: 1, visible: false }]);
    expect(sdk.isSeriesVisible(1)).toBe(false);
    expect(items[1].attrs['aria-pressed']).toBe('false');
    sdk.render();
    expect(labels[0].textContent).toBe('Search71.4%');
    expect(center.textContent).toBe('70 uTotal');
    // Legend hover emphasizes the slice in the engine
    items[2].fire('pointerenter');
    expect(calls.set_chart_emphasis.at(-1)).toEqual([2]);
  });

  it('a11y model: summary with top slices, table with percents, keyboard skips hidden slices', () => {
    const meta = {
      ...pieMeta(DATA, { donut: 0.5, valueLabel: 'Visits' }),
      names: ['Search', 'Direct', 'Social', 'Other'],
      values: [50, 30, 12, 8],
      percents: [50 / 0.7, NaN, 12 / 0.7, 8 / 0.7],
      visible: [true, false, true, true],
      colors: [
        [1, 0, 0, 1],
        [0, 1, 0, 1],
        [0, 0, 1, 1],
        [0.5, 0.5, 0.5, 1],
      ],
      sources: [0, 1, 2, -1],
      other: [3, 4],
    };
    const model = buildA11yModel(meta, { title: 'Traffic' })!;
    expect(model.kind).toBe('pie');
    expect(buildChartSummary(model)).toBe('Traffic. Donut chart, 4 slices (1 hidden), total 70; Search 71.4%; Social 17.1%; Other 11.4%.');
    const desc = buildChartDescription(model);
    expect(desc).toContain('Direct: 30 (hidden).');
    expect(desc).toContain('Other combines Email, Ads.');
    expect(desc).toContain('Left and Right arrows to move between slices');

    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Slice', 'Visits', 'Percent']);
    expect(table.rows).toEqual([
      ['Search', 50, 71.43],
      ['Direct', 30, null],
      ['Social', 12, 17.14],
      ['Other', 8, 11.43],
    ]);

    // Focus: first visible slice, skips the hidden one, clamps at the ends
    let f = stepFocus(model, null, 'ArrowRight')!;
    expect(f).toEqual({ series: 0, index: 0 });
    f = stepFocus(model, f, 'ArrowRight')!;
    expect(f.index).toBe(2);
    expect(stepFocus(model, f, 'End')!.index).toBe(3);
    expect(stepFocus(model, { series: 0, index: 3 }, 'ArrowRight')!.index).toBe(3);
    expect(stepFocus(model, f, 'Home')!.index).toBe(0);
    expect(pointAnnouncement(model, f)).toBe('Social, 12, 17.1%. 2 of 3.');

    const ctx = tooltipContext(model, { series: 0, index: 3 }, new Float64Array([0, 0, 1, 3, 3, 8, 3]), () => null);
    expect(ctx.chartType).toBe('pie');
    expect(ctx.slice).toEqual({ label: 'Other', value: 8, percent: 8 / 0.7, members: ['Email', 'Ads'] });
    expect(ctx.items[0].color).toBe('rgb(128, 128, 128)');
  });

  it('helpers: label room, percent text and contrast text color', () => {
    expect(pieLabelSpace(['a', 'b'], 'Other', 'none')).toEqual([0, 0]);
    const [x, y] = pieLabelSpace(['Search engines'], 'Other', 'outside');
    expect(x).toBeGreaterThan(64);
    expect(x).toBeLessThanOrEqual(180);
    expect(y).toBe(20);
    expect(pieLabelSpace(['x'.repeat(200)], 'Other', 'outside')[0]).toBe(180);
    expect(formatPercent(12.345, 'en-US')).toBe('12.3%');
    expect(formatPercent(NaN)).toBe('—');
    expect(textOn([0.05, 0.1, 0.4, 1])).toBe('#ffffff');
    expect(textOn([0.95, 0.85, 0.3, 1])).toBe('#0b0b0b');
    // Donut center defaults on for donuts only; a string replaces the caption
    expect(pieMeta(DATA).center.show).toBe(false);
    expect(pieMeta(DATA, { donut: 0.5 }).center).toEqual({ show: true, caption: 'Total' });
    expect(pieMeta(DATA, { donut: 0.5, centerLabel: 'Visits' }).center).toEqual({ show: true, caption: 'Visits' });
    expect(pieMeta(DATA, { donut: 0.5, centerLabel: false }).center.show).toBe(false);
    expect(pieMeta(DATA, { donut: 3 }).donut).toBe(0.95);
  });
});
