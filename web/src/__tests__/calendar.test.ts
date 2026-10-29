import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement, stepFocus, tableToCSV } from '../sdk/chart-a11y';
import { calendarMeta, calendarRanges, parseCalendarDay } from '../sdk/chart-calendar';
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

interface EngineState {
  hit: Float64Array;
  labels: number[];
  blocks: number[];
}

function mockBackend(calls: Calls, st: EngineState): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return {
    set_calendar_chart: (...args: unknown[]) => {
      record('set_calendar_chart')(...args);
      const r = args[0] as Float64Array;
      let n = 0;
      for (let k = 0; k + 1 < r.length; k += 2) n += r[k + 1] - r[k] + 1;
      return n;
    },
    set_chart_calendar_split_line: record('set_chart_calendar_split_line'),
    chart_calendar_labels: () => new Float64Array([1, st.labels.length / 7, ...st.labels]),
    chart_calendar_blocks: () => new Float64Array(st.blocks),
    set_chart_heatmap_colormap: record('set_chart_heatmap_colormap'),
    set_chart_heatmap_domain: record('set_chart_heatmap_domain'),
    chart_heatmap_color: (v: number) => (Number.isFinite(v) ? new Uint8Array([10, 20, 30, 255]) : new Uint8Array([200, 200, 200, 255])),
    chart_heatmap_colorbar: () => new Float64Array([1, 9, NaN, 2, 1, 0, 9, 1]),
    chart_heatmap_lut: () => new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255]),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_clear_color: () => {},
    chart_hover_at_ndc: () => st.hit,
    chart_clear_hover: () => {},
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 0, NaN]),
    chart_axes_revision: () => 1,
    chart_axes: () => new Float64Array([100, 40, 600, 120, 0]),
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

/** Days since 1970-01-01 of a civil date. */
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
const f32 = (c: number[]) => Array.from(new Float32Array(c));

describe('Calendar heatmap (SDK binding)', () => {
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

  function setup() {
    const st: EngineState = { hit: new Float64Array(0), labels: [], blocks: [] };
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
    return { calls, sdk, st, tooltip, hover };
  }

  it('parses dates as civil days: strings directly, instants in the chart time zone', () => {
    expect(parseCalendarDay('2023-01-01', 'UTC')).toBe(19358);
    expect(parseCalendarDay('2023-1-2', 'local')).toBe(19359);
    const lateNight = Date.UTC(2023, 0, 1, 23, 0);
    expect(parseCalendarDay(lateNight, 'UTC')).toBe(19358);
    expect(parseCalendarDay(lateNight, 'Asia/Seoul')).toBe(19359);
    expect(parseCalendarDay(new Date(Date.UTC(2023, 0, 1, 3, 0)), 'America/New_York')).toBe(19357);
    expect(() => parseCalendarDay('2023-02-30', 'UTC')).toThrow(/date/);
    expect(() => parseCalendarDay('soon', 'UTC')).toThrow(/date/);
    expect(() => parseCalendarDay(NaN, 'UTC')).toThrow(/date/);
    expect(() => parseCalendarDay('999999-01-01', 'UTC')).toThrow(/date/);
  });

  it('resolves ranges: years, months, [start, end], several calendars, default = data years', () => {
    expect(calendarRanges({ range: 2023 }, [], 'UTC')).toEqual([[day(2023, 1, 1), day(2023, 12, 31)]]);
    expect(calendarRanges({ range: '2024-02' }, [], 'UTC')).toEqual([[day(2024, 2, 1), day(2024, 2, 29)]]);
    expect(calendarRanges({ range: ['2023-01-15', '2023-03'] }, [], 'UTC')).toEqual([[day(2023, 1, 15), day(2023, 3, 31)]]);
    expect(calendarRanges({ ranges: [2022, '2023'] }, [], 'UTC')).toEqual([
      [day(2022, 1, 1), day(2022, 12, 31)],
      [day(2023, 1, 1), day(2023, 12, 31)],
    ]);
    expect(calendarRanges(undefined, [day(2021, 6, 1), day(2022, 3, 4)], 'UTC')).toEqual([
      [day(2021, 1, 1), day(2021, 12, 31)],
      [day(2022, 1, 1), day(2022, 12, 31)],
    ]);
    expect(() => calendarRanges({ range: ['2023-05-01', '2023-04-01'] }, [], 'UTC')).toThrow(/range/);
  });

  it('uploads days, values and layout options; colormap reuses the heatmap; colorbar room', () => {
    const { calls, sdk } = setup();
    const data: [string | number, number | null][] = [
      ['2023-01-01', 3],
      ['2023-01-02', 5],
      ['2023-03-01', null],
      [Date.UTC(2023, 11, 31, 12), 9],
    ];
    const res = sdk.renderCalendarHeatmap(data, { range: 2023, firstDay: 1, cellSize: 14, min: 0, max: 10, timeZone: 'UTC' });
    expect(res).toEqual({ dayCount: 365, calendarCount: 1 });
    const a = calls.set_calendar_chart[0] as unknown[];
    expect(Array.from(a[0] as Float64Array)).toEqual([19358, 19722]);
    expect(Array.from(a[1] as Float64Array)).toEqual([19358, 19359, day(2023, 3, 1), 19722]);
    const values = Array.from(a[2] as Float64Array);
    expect([values[0], values[1], values[3]]).toEqual([3, 5, 9]);
    expect(Number.isNaN(values[2])).toBe(true);
    // orient, cell size, gap, first day
    expect([a[3], a[4], a[6]]).toEqual([0, 14, 1]);
    // Year, day of week, month label room
    expect(Array.from(a[7] as Float32Array).every((v) => v > 0)).toBe(true);
    expect(a[9] as number).toBeGreaterThan(0);
    // Domain and colormap (empty days: a visible theme tone)
    expect(calls.set_chart_heatmap_domain.at(-1)!.slice(0, 2)).toEqual([0, 10]);
    const cm = calls.set_chart_heatmap_colormap.at(-1)!;
    expect(cm[0]).toBe(0);
    expect(Array.from(cm[4] as Float32Array)).toEqual(f32(CHARTURBO_THEMES.dark.grid));
    expect((calls.set_chart_padding.at(-1) as number[])[1]).toBeGreaterThanOrEqual(84);
    expect(container.querySelectorAll('.charturbo-sdk-heatmap-colorbar')).toHaveLength(1);

    // Vertical, no labels / split lines / colorbar; theme change re-sends the split color
    sdk.renderCalendarHeatmap(data, { range: 2023, orient: 'vertical', dayLabels: false, monthLabels: false, yearLabel: false, splitLine: false, colorbar: false });
    const b = calls.set_calendar_chart[1] as unknown[];
    expect(b[3]).toBe(1);
    expect(Array.from(b[7] as Float32Array)).toEqual([0, 0, 0]);
    expect(b[9]).toBe(0);
    expect(container.querySelectorAll('.charturbo-sdk-heatmap-colorbar')).toHaveLength(0);
    sdk.renderCalendarHeatmap(data, { range: 2023, splitLine: { color: '#ff0000', width: 2 } });
    sdk.setTheme('light');
    const split = calls.set_chart_calendar_split_line.at(-1)!;
    expect([Array.from(split[0] as Float32Array), split[1]]).toEqual([[1, 0, 0, 1], 2]);

    expect(() => sdk.renderCalendarHeatmap(data, { firstDay: 7 })).toThrow(/firstDay/);
    expect(() => sdk.renderCalendarHeatmap([['2023-13-01', 1]])).toThrow(/date/);
  });

  it('labels: localized weekday / month / year text at the engine anchors', () => {
    const { st, sdk } = setup();
    st.labels = [0, 1, 0, 90, 100, -1, 0, 1, 2023, 1, 100, 30, 1, -1, 2, 2023, 2023, 40, 80, 0, 0, 2, 2023, 2024, 40, 200, 0, 0];
    sdk.renderCalendarHeatmap([['2023-01-02', 1]], { range: 2023 });
    sdk.render();
    const texts = () => container.querySelectorAll('.charturbo-sdk-calendar-label').filter((l) => l.style.display !== 'none');
    expect(texts().map((l) => l.textContent)).toEqual(['Mon', 'Jan', '2023', '2023–2024']);
    expect(texts()[0].style.transform).toBe('translate(-100%, -50%)');
    // Horizontal year labels read bottom to top beside the grid
    expect(texts()[2].style.transform).toContain('rotate(-90deg)');

    sdk.renderCalendarHeatmap([['2023-01-02', 1]], { range: 2023, dayLabels: { names: ['S', 'M', 'T', 'W', 'T', 'F', 'S'] } });
    sdk.setLocale('ko');
    sdk.render();
    expect(texts().map((l) => l.textContent).slice(0, 2)).toEqual(['M', '1월']);
  });

  it('labels: small cells thin weekday rows / use narrow names; colliding months are skipped', () => {
    const { st, sdk } = setup();
    const label = (kind: number, a: number, b: number, x: number, y: number) => [kind, a, b, x, y, -1, 0];
    // Horizontal, 6 px rows: every third weekday; Feb 10 px after Jan collides, Mar does not;
    // the next calendar (x back at the start) restarts the run
    st.labels = [
      ...[0, 1, 2, 3, 4, 5, 6].flatMap((d) => label(0, d, 0, 90, 100 + d * 6)),
      ...label(1, 2023, 1, 100, 90),
      ...label(1, 2023, 2, 110, 90),
      ...label(1, 2023, 3, 130, 90),
      ...label(1, 2024, 1, 100, 190),
    ];
    sdk.renderCalendarHeatmap([['2023-01-02', 1]], { range: 2023, timeZone: 'UTC' });
    sdk.render();
    const texts = () =>
      container
        .querySelectorAll('.charturbo-sdk-calendar-label')
        .filter((l) => l.style.display !== 'none')
        .map((l) => l.textContent);
    expect(texts()).toEqual(['Tue', 'Fri', 'Jan', 'Mar', 'Jan']);
    // Vertical, 14 px columns: narrow weekday names, all shown
    st.labels = [0, 1, 2, 3, 4, 5, 6].flatMap((d) => label(0, d, 0, 100 + d * 14, 80));
    sdk.renderCalendarHeatmap([['2023-01-02', 1]], { range: 2023, orient: 'vertical' });
    sdk.render();
    expect(texts()).toEqual(['S', 'M', 'T', 'W', 'T', 'F', 'S']);
    // Side by side calendars: each one's months start a new run (same y)
    st.labels = [...label(1, 2024, 1, 90, 125), ...label(2, 2024, 2024, 120, 70), ...label(1, 2024, 3, 250, 125)];
    sdk.renderCalendarHeatmap([['2023-01-02', 1]], { range: 2023, orient: 'vertical' });
    sdk.render();
    expect(texts()).toEqual(['Jan', '2024', 'Mar']);
  });

  it('tooltip: date and value, empty days read "No data"', () => {
    const { sdk, hover, tooltip } = setup();
    sdk.renderCalendarHeatmap(
      [
        ['2023-01-01', 3],
        ['2023-01-02', 5],
      ],
      { range: 2023, valueLabel: 'Commits' }
    );
    const ctx = hover([0, 1, 1, 0, 1, 5, 1]);
    expect(ctx.chartType).toBe('calendar');
    expect(ctx.calendar).toEqual({ date: '2023-01-02', day: 19359, value: 5, calendar: 0 });
    expect(ctx.items[0]).toMatchObject({ seriesName: 'Commits', value: 5, color: 'rgb(10, 20, 30)' });
    expect(tooltip().innerHTML).toContain('Mon, Jan 2, 2023');
    expect(tooltip().innerHTML).toContain('Commits');
    hover([0, 40, 1, 0, 40, NaN, 40]);
    expect(tooltip().innerHTML).toContain('Feb 10, 2023');
    expect(tooltip().innerHTML).toContain('No data');
    expect(sdk.getNodeDetails(1)?.metadata.attributes).toMatchObject({ date: '2023-01-02', value: 5 });
  });

  it('a11y: summary, data table / CSV of the days with data, day / week / month keys', () => {
    const meta = calendarMeta(
      [
        ['2023-01-01', 3],
        ['2023-01-02', 5],
        ['2023-02-10', 1],
      ],
      { range: 2023, valueLabel: 'Commits', timeZone: 'UTC' },
      (v) => `${v}`
    );
    const model = buildA11yModel(meta, { title: 'Activity' })!;
    expect(buildChartSummary(model)).toBe('Activity. Calendar heatmap, 365 days from Jan 1, 2023 to Dec 31, 2023, 3 with data, from 1 to 5.');
    expect(buildChartDescription(model)).toContain('Page Up');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['Date', 'Commits']);
    expect(table.rows).toEqual([
      ['2023-01-01', 3],
      ['2023-01-02', 5],
      ['2023-02-10', 1],
    ]);
    expect(tableToCSV(table).split(/\r?\n/)[1]).toBe('2023-01-01,3');
    // Horizontal: Up / Down = day, Left / Right = week, Page = month
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowDown')).toEqual({ series: 0, index: 2 });
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowRight')).toEqual({ series: 0, index: 8 });
    expect(stepFocus(model, { series: 0, index: 1 }, 'ArrowLeft')).toEqual({ series: 0, index: 0 });
    expect(stepFocus(model, { series: 0, index: 30 }, 'PageDown')).toEqual({ series: 0, index: 58 });
    expect(stepFocus(model, null, 'End')).toEqual({ series: 0, index: 364 });
    expect(pointAnnouncement(model, { series: 0, index: 1 })).toBe('Mon, Jan 2, 2023, Commits 5. 2 of 365.');
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('Tue, Jan 3, 2023, no data. 3 of 365.');
    // Page Up / Down across the gap between calendars land on the nearest day of the next calendar
    const gap = buildA11yModel(calendarMeta([['2022-01-01', 3]], { ranges: [2022, 2024], timeZone: 'UTC' }, (x) => `${x}`), {})!;
    expect(stepFocus(gap, { series: 0, index: 379 }, 'PageUp')).toEqual({ series: 0, index: 364 });
    expect(stepFocus(gap, { series: 0, index: 364 }, 'PageUp')).toEqual({ series: 0, index: 333 });
    expect(stepFocus(gap, { series: 0, index: 348 }, 'PageDown')).toEqual({ series: 0, index: 365 });
    // Vertical: the arrows swap
    const v = buildA11yModel(calendarMeta([['2023-01-01', 3]], { range: 2023, orient: 'vertical' }, (x) => `${x}`), {})!;
    expect(stepFocus(v, { series: 0, index: 1 }, 'ArrowDown')).toEqual({ series: 0, index: 8 });
    // Built-in text follows the chart locale
    const ko = buildA11yModel(meta, { locale: 'ko' })!;
    expect(buildChartSummary(ko)).toContain('캘린더');
    expect(buildDataTable(ko).columns[0]).toBe('날짜');
    const zh = buildA11yModel(meta, { locale: 'zh-CN' })!;
    expect(buildChartSummary(zh)).toContain('日历');
  });

  it('React / Vue dispatch', () => {
    const sdk = { renderCalendarHeatmap: vi.fn() } as unknown as Charturbo;
    renderChartSpec(sdk, { type: 'calendar', data: [['2023-01-01', 1]], options: { range: 2023 } });
    expect((sdk.renderCalendarHeatmap as unknown as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([[['2023-01-01', 1]], { range: 2023 }]);
  });
});
