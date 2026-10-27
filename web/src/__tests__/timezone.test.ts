import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatChartTime, Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import {
  buildTimeZoneTable,
  isLocalMidnight,
  timeZoneOffset,
  validateTimeZone,
} from '../sdk/chart-timezone';

const H = 3_600_000;
const DAY = 24 * H;

/** `[utcMs, offsetMin]` rows of a table (for readable expectations). */
function rows(t: { transitions: Float64Array; offsets: Float32Array }): [number, number][] {
  return Array.from(t.transitions, (v, i) => [v, t.offsets[i]]);
}

describe('offset table builder (Intl)', () => {
  it('finds the 2026 US and EU DST transitions to the second', () => {
    const ny = buildTimeZoneTable('America/New_York', Date.UTC(2026, 3, 1), Date.UTC(2026, 5, 1));
    // One year either side of the domain, whole UTC years
    expect(ny.lo).toBe(Date.UTC(2025, 0, 1));
    expect(ny.hi).toBe(Date.UTC(2028, 0, 1));
    const r = rows(ny);
    expect(r[0]).toEqual([Date.UTC(2025, 0, 1), -300]);
    // Mar 8 2026 02:00 EST -> 03:00 EDT; Nov 1 2026 02:00 EDT -> 01:00 EST
    expect(r).toContainEqual([Date.UTC(2026, 2, 8, 7), -240]);
    expect(r).toContainEqual([Date.UTC(2026, 10, 1, 6), -300]);
    // Year starts do not repeat the running offset: exactly 2 transitions per year
    expect(r).toHaveLength(1 + 2 * 3);

    const be = rows(buildTimeZoneTable('Europe/Berlin', Date.UTC(2026, 0, 1), Date.UTC(2026, 11, 31)));
    // Mar 29 2026 01:00 UTC CET -> CEST; Oct 25 2026 01:00 UTC CEST -> CET
    expect(be).toContainEqual([Date.UTC(2026, 2, 29, 1), 120]);
    expect(be).toContainEqual([Date.UTC(2026, 9, 25, 1), 60]);
  });

  it('gives fixed half / quarter hour offsets one row and UTC an empty table', () => {
    expect(rows(buildTimeZoneTable('Asia/Kolkata', Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1)))).toEqual([
      [Date.UTC(2025, 0, 1), 330],
    ]);
    expect(rows(buildTimeZoneTable('Asia/Kathmandu', Date.UTC(2026, 0, 1), Date.UTC(2026, 6, 1)))[0][1]).toBe(345);
    const utc = buildTimeZoneTable('UTC', 0, 1e12);
    expect(utc.transitions.length + utc.offsets.length).toBe(0);
    expect([utc.lo, utc.hi]).toEqual([-Infinity, Infinity]);
  });

  it('reads offsets of IANA zones and the runtime zone', () => {
    expect(timeZoneOffset('America/New_York', Date.UTC(2026, 0, 15))).toBe(-300);
    expect(timeZoneOffset('America/New_York', Date.UTC(2026, 6, 15))).toBe(-240);
    expect(timeZoneOffset('Asia/Kathmandu', Date.UTC(2026, 6, 15))).toBe(345);
    const t = Date.UTC(2026, 6, 15, 12);
    expect(timeZoneOffset('local', t)).toBe(-new Date(t).getTimezoneOffset());
    expect(isLocalMidnight('America/New_York', Date.UTC(2026, 2, 8, 5))).toBe(true);
    expect(isLocalMidnight('America/New_York', Date.UTC(2026, 2, 8))).toBe(false);
    expect(() => validateTimeZone('Mars/Olympus_Mons')).toThrow(RangeError);
    expect(() => validateTimeZone('Asia/Seoul')).not.toThrow();
  });
});

describe('formatChartTime with a time zone', () => {
  it('formats labels in the given zone (default UTC)', () => {
    const newYear = Date.UTC(2026, 0, 1);
    expect(formatChartTime(newYear, 'day', 'en-US')).toBe('Jan 1');
    expect(formatChartTime(newYear, 'day', 'en-US', 'America/New_York')).toBe('Dec 31');
    expect(formatChartTime(newYear, 'hour', 'en-US', 'America/New_York')).toBe('19:00');
    expect(formatChartTime(newYear, 'minute', 'en-US', 'Asia/Kolkata')).toBe('05:30');
    expect(formatChartTime(newYear, 'minute', 'en-US', 'Asia/Kathmandu')).toBe('05:45');
    // Tooltip form: date only at local midnight of the zone
    expect(formatChartTime(Date.UTC(2026, 2, 8, 5), undefined, 'en-US', 'America/New_York')).toBe('Mar 8, 2026');
    expect(formatChartTime(newYear, undefined, 'en-US', 'America/New_York')).toMatch(/Dec 31, 2025.*19:00:00/);
    // Both 01:00 of the fall-back day read 01:00
    expect(formatChartTime(Date.UTC(2026, 10, 1, 5), 'hour', 'en-US', 'America/New_York')).toBe('01:00');
    expect(formatChartTime(Date.UTC(2026, 10, 1, 6), 'hour', 'en-US', 'America/New_York')).toBe('01:00');
  });
});

/** Minimal DOM element: enough for the chart overlay (ticks), tooltip, and a11y nodes. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  innerHTML = '';
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 800;
  offsetHeight = 400;
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
  addEventListener(): void {}
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
}

type Calls = Record<string, unknown[][]>;

/** Line backend with a time domain and one x tick at `tick` (granularity code `gran`). */
function mockBackend(calls: Calls, domain: () => number[], tick: number, gran: number): WasmCharturboEngineBackend {
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  let axesRevision = 0;
  return {
    set_line_chart: record('set_line_chart', 0),
    set_line_chart_xy: record('set_line_chart_xy', 0),
    set_candle_chart: record('set_candle_chart', 0),
    set_chart_hover_style: record('set_chart_hover_style'),
    set_chart_frame_style: record('set_chart_frame_style'),
    set_chart_padding: record('set_chart_padding'),
    set_chart_time_zone: record('set_chart_time_zone'),
    chart_time_domain: () => new Float64Array(domain()),
    chart_sample: (id: number) => new Float64Array([0, id, 0, 1, 2, 3]),
    chart_axes_revision: () => ++axesRevision,
    // plot rect, 1 tick: (axis 0, value, x, y), then its granularity
    chart_axes: () => new Float64Array([50, 10, 700, 300, 1, 0, tick, 400, 310, gran]),
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
    sync_and_render: record('sync_and_render'),
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

const T0 = Date.UTC(2026, 0, 1);
const SERIES = [{ name: 'A', values: [1, 2, 3], x: [T0, T0 + DAY, T0 + 2 * DAY] }];

describe('SDK time zones', () => {
  let canvas: FakeEl;

  beforeEach(() => {
    const body = new FakeEl('body');
    const container = body.appendChild(new FakeEl('div'));
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

  const tickText = () => canvas.parentElement!.querySelectorAll('.charturbo-sdk-axis-tick')[0]?.textContent;
  const lastTable = (calls: Calls) => calls.set_chart_time_zone.at(-1) as [Float64Array, Float32Array];

  it('defaults to the local zone and sends its offset table once per covered domain', () => {
    const calls: Calls = {};
    let domain = [T0, T0 + 2 * DAY];
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => domain, T0, 5));
    expect(sdk.getTimeZone()).toBe('local');
    sdk.setTimeZone('America/New_York');
    sdk.renderLineChart(SERIES, { axes: { x: { type: 'time' } } });
    sdk.render();
    const [tr, off] = lastTable(calls);
    expect(Array.from(off)).toContain(-240);
    expect(Array.from(tr)).toContain(Date.UTC(2026, 2, 8, 7));
    // Same zone, domain still covered: nothing re-sent
    sdk.render();
    expect(calls.set_chart_time_zone).toHaveLength(1);
    // Streaming grows the domain past the covered years: the table is extended
    domain = [T0, Date.UTC(2031, 5, 1)];
    sdk.render();
    expect(calls.set_chart_time_zone).toHaveLength(2);
    expect(Array.from(lastTable(calls)[0])).toContain(Date.UTC(2031, 2, 9, 7));
    // UTC: empty table, sent once
    sdk.setTimeZone('UTC');
    expect(lastTable(calls)[0]).toHaveLength(0);
    sdk.render();
    expect(calls.set_chart_time_zone).toHaveLength(3);
    expect(() => sdk.setTimeZone('Nowhere/City')).toThrow(/Unknown time zone/);
    expect(sdk.getTimeZone()).toBe('UTC');
    // Chart options are checked up front too
    expect(() => sdk.renderLineChart(SERIES, { timeZone: 'Nowhere/City' })).toThrow(/Unknown time zone/);
    expect(() =>
      sdk.renderCandlestickChart({ open: [1], high: [1], low: [1], close: [1] }, { timeZone: 'Nowhere/City' })
    ).toThrow(/Unknown time zone/);
  });

  it('does not rebuild every frame when the domain exceeds the table span', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => [0, 1e15], 0, 7));
    sdk.setTimeZone('Europe/Berlin');
    sdk.renderLineChart(SERIES, { axes: { x: { type: 'time' } } });
    sdk.render();
    sdk.render();
    expect(calls.set_chart_time_zone).toHaveLength(1);
  });

  it('resends the table for every new chart (the engine starts each one in UTC)', () => {
    const calls: Calls = {};
    let domain: number[] = [T0, T0 + 2 * DAY];
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => domain, T0, 5));
    sdk.setTimeZone('Europe/Berlin');
    for (let k = 0; k < 2; k++) {
      sdk.renderLineChart(SERIES, { axes: { x: { type: 'time' } } });
      sdk.render();
      sdk.render();
    }
    expect(calls.set_chart_time_zone).toHaveLength(2);
    // Numeric / non-time charts: asked once, nothing sent
    domain = [];
    sdk.renderLineChart(SERIES, { axes: { x: { type: 'numeric' } } });
    sdk.render();
    sdk.render();
    expect(calls.set_chart_time_zone).toHaveLength(2);
  });

  it('re-renders tick labels, tooltips, and data table text in the new zone', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => [T0, T0 + 2 * DAY], T0, 4));
    sdk.setLocale('en-US');
    sdk.setTimeZone('UTC');
    sdk.enableNodeInteractions(canvas as unknown as HTMLCanvasElement);
    sdk.renderLineChart(SERIES, { axes: { x: { type: 'time' } } });
    sdk.render();
    expect(tickText()).toBe('00:00');
    expect(sdk.getNodeDetails(1)?.metadata.attributes?.x).toBe('Jan 2, 2026');

    const renders = calls.sync_and_render.length;
    sdk.setTimeZone('Asia/Kolkata');
    expect(calls.sync_and_render.length).toBe(renders + 1);
    expect(tickText()).toBe('05:30');
    expect(sdk.getNodeDetails(1)?.metadata.attributes?.x).toMatch(/Jan 2, 2026.*05:30:00/);
    expect(sdk.getChartDataTable()?.rows[0][0]).toMatch(/Jan 1, 2026.*05:30:00/);
    expect(sdk.exportChartCSV()).toContain('05:30:00');
    expect(Array.from(lastTable(calls)[1])).toEqual([330]);
  });

  it('chart option timeZone wins over the SDK zone (line and candlestick)', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls, () => [T0, T0 + 2 * DAY], T0, 5));
    sdk.setTimeZone('UTC');
    sdk.renderLineChart(SERIES, { locale: 'en-US', timeZone: 'America/New_York', axes: { x: { type: 'time' } } });
    sdk.render();
    expect(Array.from(lastTable(calls)[1])).toContain(-300);
    expect(sdk.getNodeDetails(0)?.metadata.attributes?.x).toMatch(/Dec 31, 2025.*19:00:00/);

    sdk.renderCandlestickChart(
      { t: SERIES[0].x, open: [1, 2, 3], high: [2, 3, 4], low: [0, 1, 2], close: [2, 3, 4] },
      { locale: 'en-US', timeZone: 'Asia/Kathmandu' }
    );
    sdk.render();
    expect(Array.from(lastTable(calls)[1])).toEqual([345]);
    // New chart without an override: back to the SDK zone (UTC: empty table)
    sdk.renderLineChart(SERIES, { locale: 'en-US', axes: { x: { type: 'time' } } });
    sdk.render();
    expect(lastTable(calls)[0]).toHaveLength(0);
    expect(sdk.getNodeDetails(0)?.metadata.attributes?.x).toBe('Jan 1, 2026');
  });
});
