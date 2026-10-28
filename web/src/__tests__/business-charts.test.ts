import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { parseColor } from '../sdk/color';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus } from '../sdk/chart-a11y';
import { radarLabelSpace, radarMeta } from '../sdk/chart-radar';
import { GAUGE_STATUS_COLORS, gaugeBandOf } from '../sdk/chart-gauge';
import { funnelLabelParts, funnelMeta } from '../sdk/chart-funnel';
import { waterfallMeta, waterfallValueText } from '../sdk/chart-waterfall';
import { placeAt, stepSingle } from '../sdk/chart-business-util';
import { renderChartSpec } from '../sdk/chart-binding';

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

/** What the engine stand-in returns (set per test). */
interface EngineState {
  hit: Float64Array;
  labels: Record<string, number[]>;
  rev: number;
  radarScale: number[];
  radarHovered: number;
  gaugeBands: number[];
  funnelStages: number[];
  waterfallItems: number[];
}

function engineState(): EngineState {
  return { hit: new Float64Array(0), labels: {}, rev: 1, radarScale: [], radarHovered: -1, gaugeBands: [], funnelStages: [], waterfallItems: [] };
}

function mockBackend(calls: Calls, st: EngineState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const labels = (kind: string, stride: number) => () => {
    const l = st.labels[kind] ?? [];
    return new Float64Array([st.rev, l.length / stride, ...l]);
  };
  return {
    set_radar_chart: (...args: unknown[]) => (record('set_radar_chart')(...args), (args[0] as number) * (args[1] as number)),
    set_chart_radar_colors: record('set_chart_radar_colors'),
    chart_radar_scale: () => new Float64Array(st.radarScale),
    chart_radar_labels: labels('radar', 7),
    chart_radar_layout: () => new Float64Array([400, 200, 120, st.radarHovered]),
    set_gauge_chart: (...args: unknown[]) => (record('set_gauge_chart')(...args), 1 + st.gaugeBands.length / 3),
    set_chart_gauge_value: (...args: unknown[]) => (record('set_chart_gauge_value')(...args), Number.isFinite(args[0] as number) || Number.isNaN(args[0])),
    set_chart_gauge_style: record('set_chart_gauge_style'),
    set_chart_gauge_band_colors: record('set_chart_gauge_band_colors'),
    chart_gauge_bands: () => new Float64Array(st.gaugeBands),
    chart_gauge_labels: labels('gauge', 6),
    chart_gauge_layout: () => new Float64Array([400, 220, 150, 120, 0, 0, -1, -1]),
    set_funnel_chart: (...args: unknown[]) => (record('set_funnel_chart')(...args), (args[0] as Float64Array).length),
    set_chart_funnel_colors: record('set_chart_funnel_colors'),
    chart_funnel_stages: () => new Float64Array(st.funnelStages),
    chart_funnel_labels: labels('funnel', 5),
    set_waterfall_chart: (...args: unknown[]) => (record('set_waterfall_chart')(...args), (args[0] as Float64Array).length),
    set_chart_waterfall_style: record('set_chart_waterfall_style'),
    chart_waterfall_items: () => new Float64Array(st.waterfallItems),
    set_bar_labels: record('set_bar_labels', true),
    chart_bar_labels: labels('bars', 4),
    set_chart_series_visible: record('set_chart_series_visible'),
    set_chart_emphasis: record('set_chart_emphasis'),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_zoom_x: record('chart_zoom_x'),
    chart_zoom_xy: record('chart_zoom_xy'),
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0, NaN]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([100, 40, 600, 300, 0]),
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

const f32 = (c: number[]) => Array.from(new Float32Array(c));

describe('Business charts (SDK bindings)', () => {
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

  function setup(st = engineState()) {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, st));
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    const seen: (ChartTooltipContext | null)[] = [];
    sdk.on('hover', (e) => seen.push(e.chart));
    const tooltip = () => body.children.find((c) => c.className.includes('charturbo-sdk-node-tooltip'))!;
    const hover = (hit: number[]) => {
      st.hit = new Float64Array(hit);
      canvas.fire('pointermove', { buttons: 0, clientX: 300, clientY: 200 });
      return seen.at(-1)!;
    };
    return { calls, sdk, st, seen, tooltip, hover };
  }

  const RADAR = {
    axes: ['Speed', 'Range', 'Cost', 'Comfort', 'Safety'],
    series: [
      { name: 'Model A', values: [80, 60, null, 70, 90] },
      { name: 'Model B', values: [50, 90, 40, 60, 75], color: '#ff0000' },
    ],
  };

  it('radar: encodes values / palette / scale options, reads the scale, legend toggles, tooltip per axis', () => {
    const st = engineState();
    st.radarScale = [100, 25, 4, 25, 50, 75, 100, 100, 100, 100, 100, 100];
    // Axis 0 label above (centered), axis 1 right, ring label beside the first spoke
    st.labels.radar = [0, 0, NaN, 400, 70, 0, -1, 0, 1, NaN, 520, 160, 1, 0, 1, 2, 50, 404, 140, 1, -1];
    const { calls, sdk, hover, tooltip } = setup(st);
    const res = sdk.renderRadarChart(RADAR, { rings: 4, fillOpacity: 0.3, markers: false, grid: 'circle', format: '.0f', title: 'Cars' });
    expect(res).toEqual({ axisCount: 5, seriesCount: 2 });
    const a = calls.set_radar_chart[0] as [number, number, Float64Array, Float32Array, number, Float64Array, number, number, number, number, number, number, number, number];
    expect([a[0], a[1]]).toEqual([5, 2]);
    expect(Number.isNaN(a[2][2])).toBe(true);
    expect(a[2][5]).toBe(50);
    expect(Array.from(a[3].slice(0, 4))).toEqual(f32(CHARTURBO_THEMES.dark.palette[0]));
    expect(Array.from(a[3].slice(4, 8))).toEqual([1, 0, 0, 1]);
    expect(Number.isNaN(a[4]) && a[5].length === 0).toBe(true);
    expect([a[6], a[7], a[9], a[11]]).toEqual([4, 0.3, 0, 1]);
    expect(a[12]).toBeGreaterThan(24);
    // Per-axis max array
    sdk.renderRadarChart(RADAR, { max: [100, null, 50] });
    const b = calls.set_radar_chart[1];
    expect(Array.from(b[5] as Float64Array).slice(0, 3)).toEqual([100, NaN, 50]);
    sdk.renderRadarChart(RADAR, { max: 120, format: '.0f' });
    expect(calls.set_radar_chart[2][4]).toBe(120);
    sdk.render();

    // Labels at the anchors (ha / va -> translate), ring values formatted
    const labels = container.querySelectorAll('.charturbo-sdk-radar-label');
    expect(labels.map((l) => l.textContent)).toEqual(['Speed', 'Range', '50']);
    expect([labels[0].style.left, labels[0].style.top, labels[0].style.transform]).toEqual(['400px', '70px', 'translate(-50%, -100%)']);
    expect(labels[1].style.transform).toBe('translate(0, -50%)');
    expect(labels[2].style.color).toBe(CHARTURBO_THEMES.dark.textMuted);

    // Legend: two series, click toggles in the engine
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.map((i) => i.textContent)).toEqual(['Model A', 'Model B']);
    items[1].fire('click');
    expect(calls.set_chart_series_visible).toEqual([[1, false]]);

    // Hover at axis 1: both series, primary = series 1
    const ctx = hover([0, 1, 2, 0, 1, 60, 1, 1, 1, 90, 6]);
    expect(ctx.chartType).toBe('radar');
    expect(ctx.xLabel).toBe('Range');
    expect(ctx.radar).toEqual({ axis: 'Range', max: 100 });
    expect(ctx.items.map((i) => [i.seriesName, i.value, i.nodeId])).toEqual([
      ['Model A', 60, 1],
      ['Model B', 90, 6],
    ]);
    expect(ctx.details?.metadata.attributes).toMatchObject({ series: 'Model B', axis: 'Range', value: 90 });
    expect(tooltip().innerHTML).toContain('Range');
    expect(tooltip().innerHTML).toContain('90');

    // No brush, no navigation, theme re-sends the palette
    sdk.setChartBrush('x');
    expect(sdk.handlesChartBrush()).toBe(false);
    expect(sdk.handlesChartNavigation()).toBe(false);
    sdk.setTheme('light');
    expect(Array.from((calls.set_chart_radar_colors.at(-1)![0] as Float32Array).slice(0, 4))).toEqual(f32(CHARTURBO_THEMES.light.palette[0]));
    // Shape validation
    expect(() => sdk.renderRadarChart({ axes: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2] }] })).toThrow(/2 values for 3 axes/);
    const nine = Array.from({ length: 9 }, (_, k) => ({ name: `s${k}`, values: [1, 2, 3] }));
    expect(() => sdk.renderRadarChart({ axes: ['a', 'b', 'c'], series: nine })).toThrow(/1 to 8 series/);
  });

  it('radar a11y: summary, description, axis x series table, keyboard over axes and series', () => {
    const meta = radarMeta(RADAR, { valueLabel: 'Score' }, (v) => `${v}`);
    meta.colors = [
      [1, 0, 0, 1],
      [0, 0, 1, 1],
    ];
    meta.max = 100;
    meta.axisMax = [100, 100, 100, 100, 100];
    meta.rings = [25, 50, 75, 100];
    const model = buildA11yModel(meta, { title: 'Cars' })!;
    expect(model.kind).toBe('radar');
    expect(buildChartSummary(model)).toBe('Cars. Radar chart, 5 axes, 2 series; Model A highest on Safety (90); Model B highest on Range (90).');
    const desc = buildChartDescription(model);
    expect(desc).toContain('Radial scale from 0 to 100.');
    expect(desc).toContain('Model A: Speed 80, Range 60, Cost no data');
    expect(desc).toContain('Up and Down arrows to switch series');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Axis', 'Model A', 'Model B']);
    expect(table.rows[2]).toEqual(['Cost', null, 40]);
    let f = stepFocus(model, null, 'ArrowRight')!;
    expect(f).toEqual({ series: 0, index: 0 });
    f = stepFocus(model, f, 'ArrowDown')!;
    expect(f).toEqual({ series: 1, index: 0 });
    f = stepFocus(model, f, 'End')!;
    expect(pointAnnouncement(model, f)).toBe('Safety, Model B 75. 5 of 5.');
    expect(model.pointId(1, 4)).toBe(9);
    expect(radarLabelSpace(['x'.repeat(100)])[0]).toBe(160);
  });

  it('gauge: status bands, engine band order, labels, cheap value updates, tooltip and a11y', () => {
    const st = engineState();
    // Engine drawing order: input band 1 (0-60) first, then band 0 (60-80), band 2 (80-100)
    st.gaugeBands = [1, 0, 60, 0, 60, 80, 2, 80, 100];
    st.labels.gauge = [0, 0, 260, 330, 0, 1, 1, 0, 540, 330, 0, 1, 2, 0, 400, 240, 0, 1, 3, 1, 600, 150, 1, 0];
    const { calls, sdk, hover, tooltip } = setup(st);
    const bands = [
      { from: 60, to: 80, status: 'warning' as const },
      { from: 0, to: 60, status: 'good' as const, label: 'Normal' },
      { from: 80, to: 100, status: 'critical' as const },
    ];
    const res = sdk.renderGauge({ value: 72 }, { bands, format: '.0f', label: 'CPU %', title: 'Load' });
    expect(res).toEqual({ bandCount: 3 });
    const a = calls.set_gauge_chart[0] as unknown[];
    expect(a.slice(0, 3)).toEqual([72, 0, 100]);
    expect(a[6]).toBe(0); // needle by default with bands
    expect(Array.from(a[7] as Float64Array)).toEqual([60, 80, 0, 60, 80, 100]);
    const colors = a[8] as Float32Array;
    expect(Array.from(colors.slice(0, 4))).toEqual(f32(parseColor(GAUGE_STATUS_COLORS.warning)));
    expect(Array.from(colors.slice(8, 12))).toEqual(f32(parseColor(GAUGE_STATUS_COLORS.critical)));
    expect(Array.from(a[9] as Uint8Array)).toEqual([1, 1, 1]);
    // Track / needle from the theme
    const style = a[10] as Float32Array;
    expect(Array.from(style.slice(0, 4))).toEqual(f32(CHARTURBO_THEMES.dark.grid));
    expect(a[11] as number).toBeGreaterThan(28);
    // Without bands: progress indicator
    sdk.renderGauge({ value: 10 });
    expect(calls.set_gauge_chart[1][6]).toBe(1);
    st.gaugeBands = [1, 0, 60, 0, 60, 80, 2, 80, 100];
    sdk.renderGauge({ value: 72 }, { bands, format: '.0f', label: 'CPU %' });
    sdk.render();

    // Labels: min / max muted, band label with its status icon, value + caption + status
    const labels = container.querySelectorAll('.charturbo-sdk-gauge-label');
    expect(labels.map((l) => l.textContent)).toEqual(['0', '100', '▲Warning']);
    expect(labels[2].children[0].style.color).toBe('rgb(250, 178, 25)');
    expect(labels[2].style.color).toBe(CHARTURBO_THEMES.dark.textSecondary);
    const [value] = container.querySelectorAll('.charturbo-sdk-gauge-value');
    expect(value.textContent).toBe('72CPU %▲Warning');
    expect([value.style.left, value.style.top, value.style.transform]).toEqual(['400px', '240px', 'translate(-50%, 0)']);

    // Live value: only the engine indicator + the DOM text change
    expect(sdk.setGaugeValue(30)).toBe(true);
    expect(calls.set_chart_gauge_value).toEqual([[30]]);
    expect(calls.set_gauge_chart.length).toBe(3);
    expect(value.textContent).toBe('30CPU %✓Normal');

    // Tooltip: value with status; band item with its range
    let ctx = hover([0, 0, 1, 0, 0, 30, 0]);
    expect(ctx.chartType).toBe('gauge');
    expect(ctx.gauge).toEqual({ value: 30, min: 0, max: 100, band: { label: 'Normal', from: 0, to: 60, status: 'good' } });
    expect(tooltip().innerHTML).toContain('Normal');
    ctx = hover([0, 0, 1, 0, 3, 100, 3]);
    expect(ctx.gauge?.band?.label).toBe('Critical');
    expect(tooltip().innerHTML).toContain('80 – 100');
    // Static series: legend APIs are no-ops
    sdk.setSeriesVisible(0, false);
    expect(calls.set_chart_series_visible).toBeUndefined();

    // A11y
    const meta = (sdk as unknown as { chartMeta: unknown }).chartMeta;
    const model = buildA11yModel(meta, { title: 'Load' })!;
    expect(buildChartSummary(model)).toBe('Load. Gauge, 30 (Normal) on a scale from 0 to 100, 3 bands.');
    expect(buildDataTable(model).rows).toEqual([
      ['Value', 30, 0, 100],
      ['Normal', null, 0, 60],
      ['Warning', null, 60, 80],
      ['Critical', null, 80, 100],
    ]);
    const f = stepFocus(model, { series: 0, index: 0 }, 'ArrowRight')!;
    expect(pointAnnouncement(model, f)).toBe('Normal band, 0 to 60. 2 of 4.');
    expect(stepFocus(model, f, 'End')).toEqual({ series: 0, index: 3 });
    expect(gaugeBandOf(meta as never, 95)).toBe(2);
    expect(gaugeBandOf(meta as never, 150)).toBe(2);
    // Theme: track / needle restyled, band colors re-sent by input index (status colors fixed)
    sdk.setTheme('light');
    const bandColors = calls.set_chart_gauge_band_colors.at(-1)![0] as Float32Array;
    expect(Array.from(bandColors.slice(0, 4))).toEqual(f32(parseColor(GAUGE_STATUS_COLORS.warning)));
    expect(Array.from((calls.set_chart_gauge_style.at(-1)![0] as Float32Array).slice(0, 4))).toEqual(f32(CHARTURBO_THEMES.light.grid));
    expect(sdk.setGaugeValue(Infinity)).toBe(false);
  });

  it('funnel: stages, conversion labels, label room, tooltip with both rates, a11y table', () => {
    const st = engineState();
    st.funnelStages = [1000, 100, 100, 400, 40, 40, 100, 10, 25];
    st.labels.funnel = [0, 612, 80, 1, 0, 1, 612, 180, 1, 0, 2, 612, 280, 1, 0];
    const { calls, sdk, hover, tooltip } = setup(st);
    const data = { labels: ['Visits', 'Signups', 'Paid'], values: [1000, 400, 100] };
    expect(sdk.renderFunnelChart(data, { conversion: 'both', format: ',.0f', shape: 'bar' })).toEqual({ stageCount: 3 });
    const a = calls.set_funnel_chart[0] as unknown[];
    expect(Array.from(a[0] as Float64Array)).toEqual([1000, 400, 100]);
    expect(Array.from((a[1] as Float32Array).slice(0, 4))).toEqual(f32(CHARTURBO_THEMES.dark.palette[0]));
    expect(Array.from((a[1] as Float32Array).slice(8, 12))).toEqual(f32(CHARTURBO_THEMES.dark.palette[0]));
    expect([a[2], a[3]]).toEqual([0, 1]);
    // Labels to the right: padding keeps their room
    const pad = calls.set_chart_padding.at(-1) as number[];
    expect(pad[1]).toBeGreaterThan(80);
    sdk.render();
    const labels = container.querySelectorAll('.charturbo-sdk-funnel-label');
    expect(labels.map((l) => l.textContent)).toEqual(['Visits1,000', 'Signups40040.0% · 40.0% of previous', 'Paid10010.0% · 25.0% of previous']);
    expect(labels[1].style.transform).toBe('translate(0, -50%)');

    const ctx = hover([1, 0, 1, 0, 2, 100, 2]);
    expect(ctx.funnel).toEqual({ stage: 'Paid', value: 100, ofFirst: 10, ofPrevious: 25 });
    expect(tooltip().innerHTML).toContain('Of previous stage');
    expect(tooltip().innerHTML).toContain('25.0%');

    // Horizontal: room below; per-stage colors
    sdk.renderFunnelChart(data, { orientation: 'horizontal', colors: [null, '#00ff00'] });
    const b = calls.set_funnel_chart[1] as unknown[];
    expect(b[2]).toBe(1);
    expect(Array.from((b[1] as Float32Array).slice(4, 8))).toEqual([0, 1, 0, 1]);
    expect((calls.set_chart_padding.at(-1) as number[])[2]).toBeGreaterThan(40);

    const meta = funnelMeta(data, { valueLabel: 'Users' }, (v) => `${v}`);
    meta.pctFirst = [100, 40, 10];
    meta.pctPrev = [100, 40, 25];
    const model = buildA11yModel(meta, {})!;
    expect(buildChartSummary(model)).toBe('Funnel chart, 3 stages, from 1000 to 100; Paid is 10% of Visits.');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Stage', 'Users', '% of first', '% of previous']);
    expect(table.rows[2]).toEqual(['Paid', 100, 10, 25]);
    // Up / Down stay on the stage series
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowDown')).toEqual({ series: 0, index: 2 });
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('Paid, 100. 10% of first, 25% of previous. 3 of 3.');
    expect(funnelLabelParts({ ...meta, conversion: 'previous' }, 1).conversion).toBe('40.0% of previous');
    expect(funnelLabelParts({ ...meta, conversion: 'none' }, 1).conversion).toBe('');
  });

  it('waterfall: totals, signed labels through the bar label layer, legend of kinds, tooltip, a11y', () => {
    const st = engineState();
    st.waterfallItems = [0, 100, 0, 100, 0, 30, 100, 130, 1, -50, 130, 80, 2, 80, 0, 80];
    st.labels.bars = [0, 150, 90, 0, 1, 300, 60, 0, 2, 450, 140, 0, 3, 600, 120, 0];
    const { calls, sdk, hover, tooltip } = setup(st);
    const data = { labels: ['Start', 'Sales', 'Costs'], values: [100, 30, -50] };
    expect(sdk.renderWaterfallChart(data, { total: 'End', format: ',.0f' })).toEqual({ itemCount: 4 });
    const a = calls.set_waterfall_chart[0] as unknown[];
    const values = a[0] as Float64Array;
    expect(Array.from(values.slice(0, 3))).toEqual([100, 30, -50]);
    expect(Number.isNaN(values[3])).toBe(true);
    expect(Array.from(a[1] as Uint8Array)).toEqual([0, 0, 0, 1]);
    expect([a[2], a[3]]).toEqual([0, true]);
    const style = a[5] as Float32Array;
    expect(Array.from(style.slice(0, 4))).toEqual(f32(CHARTURBO_THEMES.dark.palette[0]));
    expect(Array.from(style.slice(4, 8))).toEqual(f32(CHARTURBO_THEMES.dark.palette[1]));
    expect(Array.from(style.slice(8, 12))).toEqual(f32(CHARTURBO_THEMES.dark.baseline));
    // Labels measured and sent like bar labels (auto mode)
    const [mode, , widths] = calls.set_bar_labels[0] as [number, number, Float32Array];
    expect(mode).toBe(2);
    expect(widths.length).toBe(4);
    sdk.render();
    const labels = container.querySelectorAll('.charturbo-sdk-bar-label');
    expect(labels.map((l) => l.textContent)).toEqual(['+100', '+30', '−50', '80']);
    expect(labels[0].style.color).toBe(CHARTURBO_THEMES.dark.textSecondary);
    // Static legend of the kinds present
    const items = container.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.map((i) => i.textContent)).toEqual(['Increase', 'Decrease', 'Total']);
    expect(items[0].children[0].style.height).toBe('10px');
    items[0].fire('click');
    expect(calls.set_chart_series_visible).toBeUndefined();

    let ctx = hover([1, 0, 1, 0, 2, 80, 2]);
    expect(ctx.chartType).toBe('waterfall');
    expect(ctx.waterfall).toEqual({ kind: 'decrease', change: -50, start: 130, end: 80 });
    expect(ctx.items[0].seriesName).toBe('Decrease');
    expect(tooltip().innerHTML).toContain('−50');
    expect(tooltip().innerHTML).toContain('Running total');
    ctx = hover([1, 0, 1, 0, 3, 80, 3]);
    expect(ctx.xLabel).toBe('End');
    expect(tooltip().innerHTML).not.toContain('Running total');
    expect(sdk.handlesChartBrush()).toBe(false);

    // Locale change re-formats and re-measures the labels
    const sent = calls.set_bar_labels.length;
    sdk.setLocale('de-DE');
    expect(calls.set_bar_labels.length).toBe(sent + 1);
    sdk.render();
    expect(container.querySelectorAll('.charturbo-sdk-bar-label')[0].textContent).toBe('+100');
    // Horizontal: value axis on x
    sdk.renderWaterfallChart(data, { orientation: 'horizontal', labels: false });
    expect(calls.set_waterfall_chart[1][2]).toBe(1);
    expect(calls.set_bar_labels.at(-1)![0]).toBe(0);
    // Theme switch re-sends colors and label sizes
    sdk.setTheme('light');
    expect(Array.from((calls.set_chart_waterfall_style.at(-1)![0] as Float32Array).slice(0, 4))).toEqual(f32(CHARTURBO_THEMES.light.palette[0]));

    // Meta helpers / a11y
    const meta = waterfallMeta({ labels: ['a', 'b', 'c'], values: [10, null, 5], totals: [1] }, { total: true }, (v) => `${v}`);
    expect(meta.totals).toEqual([false, true, false, true]);
    expect(meta.categories.at(-1)).toBe('Total');
    expect(waterfallMeta({ labels: ['a', 'b'], values: [1, 2], totals: [false, true] }, {}, String).totals).toEqual([false, true]);
    expect(() => waterfallMeta({ labels: ['a'], values: [1, 2] }, {}, String)).toThrow(RangeError);
    meta.items = [
      { kind: 'increase', value: 10, start: 0, end: 10 },
      { kind: 'total', value: 10, start: 0, end: 10 },
      { kind: 'decrease', value: -5, start: 10, end: 5 },
      { kind: 'total', value: 5, start: 0, end: 5 },
    ];
    expect(waterfallValueText(meta, meta.items[2])).toBe('−5');
    const model = buildA11yModel(meta, { title: 'P&L' })!;
    expect(buildChartSummary(model)).toBe('P&L. Waterfall chart, 4 items, ending at 5; largest increase a +10; largest decrease c −5.');
    expect(buildDataTable(model).rows).toEqual([
      ['a', 10, 10],
      ['b', null, 10],
      ['c', -5, 5],
      ['Total', null, 5],
    ]);
    expect(pointAnnouncement(model, { series: 0, index: 1 })).toBe('b, Total 10. 2 of 4.');
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('c, −5, running total 5. 3 of 4.');
    // Legend placement options reach the waterfall too
    sdk.renderWaterfallChart(data, { legend: { show: true, position: 'right' } });
    expect((sdk as unknown as { chartPresentation: { legend: { position?: string } } }).chartPresentation.legend.position).toBe('right');
  });

  it('helpers and React / Vue dispatch', () => {
    const el = new FakeEl('div') as unknown as HTMLElement;
    placeAt(el, 10, 20, -1, 1);
    expect([el.style.left, el.style.top, el.style.transform]).toEqual(['10px', '20px', 'translate(-100%, 0)']);
    expect(stepSingle(null, 'End', 4)).toEqual({ series: 0, index: 3 });
    expect(stepSingle({ series: 0, index: 1 }, 'PageUp', 4)).toEqual({ series: 0, index: 3 });
    expect(stepSingle({ series: 0, index: 0 }, 'Home', 0)).toBeNull();
    const sdk = {
      renderRadarChart: vi.fn(),
      renderGauge: vi.fn(),
      renderFunnelChart: vi.fn(),
      renderWaterfallChart: vi.fn(),
    } as unknown as Charturbo;
    renderChartSpec(sdk, { type: 'gauge', data: { value: 1 }, options: { max: 10 } });
    renderChartSpec(sdk, { type: 'waterfall', data: { labels: ['a'], values: [1] }, options: undefined });
    expect((sdk.renderGauge as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([{ value: 1 }, { max: 10 }]);
    expect(sdk.renderWaterfallChart).toHaveBeenCalledTimes(1);
  });
});
