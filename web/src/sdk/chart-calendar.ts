/**
 * Calendar heatmap binding. The engine owns the layout (calendar.rs): one cell per day in week
 * columns (or rows when vertical) per calendar range, month split lines, the hover hit test
 * (empty days included), label anchors, and the heatmap colormap / value scale / colorbar. This
 * module parses dates into civil day numbers (strings as written, instants in the chart time
 * zone), resolves the ranges, mirrors the days for the tooltip / a11y, and places the localized
 * weekday / month / year labels at the engine anchors.
 */
import { parseColor, parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { A11yChartModel, ChartDataTable } from './chart-a11y';
import type { ChartPaddingOptions, ChartTooltipContext, NodeMetadata, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { esc, overlayDiv, placeAt, rgbCss, tooltipHeader, tooltipRow, type A11yCommon, type A11yCustomModel, type BusinessLabelLayer } from './chart-business-util';
import { bytesToRgba, HEATMAP_SCALE_CODES, type HeatmapColorbarOptions, type HeatmapColorScale } from './chart-heatmap';
import { timeZoneOffset, validateTimeZone, type CharturboTimeZone } from './chart-timezone';
import { formatCount, getMessages, resolveLocale } from './i18n';

const DAY_MS = 86_400_000;
/** Most days over every range (calendar.rs `MAX_CALENDAR_DAYS`, about 109 years) */
const MAX_DAYS = 40_000;

/** `'YYYY-MM-DD'` (taken as written), epoch ms or a `Date` (the day in the chart time zone). */
export type CalendarDate = string | number | Date;

/** `[date, value]` per day; `null` / NaN = no data. A repeated day keeps its last value. */
export type CalendarHeatmapData = ArrayLike<readonly [CalendarDate, number | null | undefined]>;

/**
 * A year (`2023` or `'2023'`), a month (`'2023-02'`), a day, or `[start, end]` (inclusive; a year
 * / month end means its last day). Numbers below 10000 are years, larger ones epoch ms.
 */
export type CalendarRange = number | string | Date | readonly [CalendarDate, CalendarDate];

export interface CalendarLabelOptions {
  /** Default: true */
  show?: boolean;
  /** Own names: 7 weekdays from Sunday, or 12 months from January (default: the locale's short names) */
  names?: string[];
}

export interface CalendarSplitLineOptions {
  /** Default: true */
  show?: boolean;
  /** Default: the theme baseline */
  color?: ColorInput;
  /** CSS px (default 1) */
  width?: number;
}

export interface CalendarHeatmapOptions {
  /** One calendar (default: one per year of the data) */
  range?: CalendarRange;
  /** Several calendars, stacked (horizontal) or side by side (vertical); wins over `range` */
  ranges?: CalendarRange[];
  /** `'horizontal'` (default: weeks run left to right) or `'vertical'` (weeks run down) */
  orient?: 'horizontal' | 'vertical';
  /** Largest cell side in CSS px (default: fit the plot, at most 64) */
  cellSize?: number;
  /** Gap between cells in CSS px (default 2) */
  cellGap?: number;
  /** First day of the week: 0 = Sunday (default) to 6 = Saturday */
  firstDay?: number;
  /** Weekday labels beside the grid (default: true) */
  dayLabels?: boolean | CalendarLabelOptions;
  /** Month labels above / beside the grid (default: true) */
  monthLabels?: boolean | CalendarLabelOptions;
  /** Year label of each calendar (default: true) */
  yearLabel?: boolean;
  /** Month boundary lines (default: true) */
  splitLine?: boolean | CalendarSplitLineOptions;
  /** Colormap as in `renderHeatmap` (default `'sequential'`) */
  colorScale?: HeatmapColorScale;
  color?: ColorInput;
  reverse?: boolean;
  /** Value domain (default: data extent) */
  min?: number;
  max?: number;
  center?: number;
  /** Color of days without data (default: the theme grid tone) */
  emptyColor?: ColorInput;
  colorbar?: HeatmapColorbarOptions | boolean;
  /** Zone that turns epoch ms / `Date` into days (default: the SDK zone, `setTimeZone`) */
  timeZone?: CharturboTimeZone;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  padding?: ChartPaddingOptions;
  /** Tooltip / table / colorbar name of the values (default: `'Value'` in the chart locale) */
  valueLabel?: string;
  /** Value text of tooltip and a11y (spec, Intl options or function; default: locale number) */
  format?: ChartValueFormat;
}

/** Hovered calendar day. */
export interface ChartCalendarTooltip {
  /** `'YYYY-MM-DD'` */
  date: string;
  /** Days since 1970-01-01 */
  day: number;
  /** NaN = no data */
  value: number;
  /** Index of the calendar (range) */
  calendar: number;
}

/** Display state the SDK keeps for a calendar heatmap. */
export interface CalendarChartMeta {
  kind: 'calendar';
  /** `[start, end]` day per calendar */
  ranges: [number, number][];
  /** Global id of each range start */
  offsets: number[];
  /** One value per day over every range (NaN = no data); index = global id */
  values: Float64Array;
  /** Global ids with data, ascending */
  dataIds: number[];
  /** Input days / values as uploaded */
  inputDays: number[];
  inputValues: number[];
  orient: 'horizontal' | 'vertical';
  cellSize: number;
  cellGap: number;
  firstDay: number;
  dayLabels: { show: boolean; names?: string[] };
  monthLabels: { show: boolean; names?: string[] };
  yearLabel: boolean;
  split: { show: boolean; color?: ColorInput; width: number };
  colormap: { scale: HeatmapColorScale; color?: ColorInput; reverse: boolean; emptyColor?: ColorInput };
  domain: { min?: number; max?: number; center?: number };
  colorbar: { show: boolean; title: string; format?: (v: number) => string };
  /** No legend (one series) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  valueLabel: string;
  format: (value: number) => string;
  /** Displayed color of a value (engine colormap; set by `sendCalendar`) */
  colorOf: (value: number) => RgbaTuple;
  locale?: string;
  valueLabelInput?: string;
  colorbarTitleInput?: string;
}

function civilDay(y: number, m: number, d: number): number {
  const t = new Date(0);
  // setUTCFullYear keeps years 0..99 literal (Date.UTC maps them to 19xx)
  t.setUTCFullYear(y, m - 1, d);
  return Math.round(t.getTime() / DAY_MS);
}

function civilOf(day: number): { y: number; m: number; d: number } {
  const t = new Date(day * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

const daysInMonth = (y: number, m: number) => civilDay(y, m + 1, 1) - civilDay(y, m, 1);

function badDate(date: unknown): Error {
  return new Error(`Calendar date ${JSON.stringify(date instanceof Date ? String(date) : date)} is not a valid date (YYYY-MM-DD, epoch ms or Date)`);
}

function dayOfInstant(ms: number, tz: CharturboTimeZone, raw: unknown): number {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) throw badDate(raw);
  return Math.floor((ms + timeZoneOffset(tz, ms) * 60_000) / DAY_MS);
}

/**
 * Day number (since 1970-01-01) of a calendar date: `'YYYY-MM-DD'` strings as written, epoch ms /
 * `Date` / other date strings by their wall date in `timeZone`. Throws for an invalid date.
 */
export function parseCalendarDay(date: CalendarDate, timeZone: CharturboTimeZone): number {
  if (date instanceof Date) return dayOfInstant(date.getTime(), timeZone, date);
  if (typeof date === 'number') return dayOfInstant(date, timeZone, date);
  if (typeof date === 'string') {
    const m = /^\s*(-?\d{1,6})-(\d{1,2})-(\d{1,2})\s*$/.exec(date);
    if (m) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const day = civilDay(y, mo, d);
      // NaN day: a year beyond the `Date` range
      if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo) || !Number.isFinite(day)) throw badDate(date);
      return day;
    }
    // Only full dates with a time part: `Date.parse` reads bare `'2023'` / `'Jan 5'` loosely
    if (/^\s*\d{4}-\d{2}-\d{2}T/.test(date)) return dayOfInstant(Date.parse(date), timeZone, date);
  }
  throw badDate(date);
}

/** First / last day of a range bound (year, month, day). */
function boundDay(b: CalendarDate, end: boolean, tz: CharturboTimeZone): number {
  if (typeof b === 'number' && Number.isInteger(b) && Math.abs(b) < 10_000) return end ? civilDay(b, 12, 31) : civilDay(b, 1, 1);
  if (typeof b === 'string') {
    const y = /^\s*(\d{4})\s*$/.exec(b);
    if (y) return end ? civilDay(Number(y[1]), 12, 31) : civilDay(Number(y[1]), 1, 1);
    const m = /^\s*(\d{4})-(\d{1,2})\s*$/.exec(b);
    if (m) {
      const [yy, mm] = [Number(m[1]), Number(m[2])];
      if (mm < 1 || mm > 12) throw badDate(b);
      return end ? civilDay(yy, mm, daysInMonth(yy, mm)) : civilDay(yy, mm, 1);
    }
  }
  return parseCalendarDay(b, tz);
}

/**
 * `[start, end]` day pairs of the calendars: `ranges`, else `range`, else one per year spanned by
 * `days` (the current year without data). Throws for an invalid or reversed range.
 */
export function calendarRanges(
  options: Pick<CalendarHeatmapOptions, 'range' | 'ranges'> | undefined,
  days: ArrayLike<number>,
  tz: CharturboTimeZone
): [number, number][] {
  const list = options?.ranges?.length ? options.ranges : options?.range !== undefined ? [options.range] : null;
  if (list) {
    return list.map((r, i) => {
      const pair = Array.isArray(r) ? (r as readonly [CalendarDate, CalendarDate]) : null;
      if (pair && pair.length !== 2) throw new Error(`Calendar range ${i} must be [start, end]`);
      const start = boundDay(pair ? pair[0] : (r as CalendarDate), false, tz);
      const end = boundDay(pair ? pair[1] : (r as CalendarDate), true, tz);
      if (start > end) throw new Error(`Calendar range ${i} starts after it ends`);
      return [start, end];
    });
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = 0; k < days.length; k++) {
    lo = Math.min(lo, days[k]);
    hi = Math.max(hi, days[k]);
  }
  if (!Number.isFinite(lo)) lo = hi = dayOfInstant(Date.now(), tz, 'now');
  const out: [number, number][] = [];
  for (let y = civilOf(lo).y; y <= civilOf(hi).y && out.length <= 200; y++) out.push([civilDay(y, 1, 1), civilDay(y, 12, 31)]);
  return out;
}

function labelOption(v: boolean | CalendarLabelOptions | undefined, count: number, what: string): { show: boolean; names?: string[] } {
  if (typeof v === 'boolean' || v === undefined) return { show: v ?? true };
  if (v.names !== undefined && (!Array.isArray(v.names) || v.names.length !== count)) throw new Error(`Calendar ${what} names must list ${count} names`);
  return { show: v.show ?? true, names: v.names ? [...v.names] : undefined };
}

/** Builds the display meta (validates options and dates). `timeZone`: the SDK zone (an option wins). */
export function calendarMeta(
  data: CalendarHeatmapData,
  options: CalendarHeatmapOptions | undefined,
  format: (v: number) => string,
  locale?: string,
  timeZone: CharturboTimeZone = 'local'
): CalendarChartMeta {
  if (options?.timeZone !== undefined) validateTimeZone(options.timeZone);
  const tz = options?.timeZone ?? timeZone;
  const firstDay = options?.firstDay ?? 0;
  if (!Number.isInteger(firstDay) || firstDay < 0 || firstDay > 6) throw new Error(`Calendar firstDay must be an integer from 0 (Sunday) to 6 (Saturday), got ${firstDay}`);
  const cellSize = options?.cellSize ?? 0;
  if (!(Number.isFinite(cellSize) && cellSize >= 0)) throw new Error(`Calendar cellSize must be a CSS px size >= 0 (0 = fit), got ${cellSize}`);
  const cellGap = options?.cellGap ?? 2;
  if (!(Number.isFinite(cellGap) && cellGap >= 0)) throw new Error(`Calendar cellGap must be >= 0, got ${cellGap}`);
  const inputDays: number[] = [];
  const inputValues: number[] = [];
  const n0 = data?.length ?? 0;
  for (let i = 0; i < n0; i++) {
    const e = data[i];
    if (!e || typeof e !== 'object' || (e as ArrayLike<unknown>).length < 2) throw new Error(`Calendar data entry ${i} must be [date, value]`);
    inputDays.push(parseCalendarDay(e[0], tz));
    inputValues.push(e[1] == null ? NaN : Number(e[1]));
  }
  const ranges = calendarRanges(options, inputDays, tz);
  const offsets: number[] = [];
  let total = 0;
  for (const [s, e] of ranges) {
    offsets.push(total);
    total += e - s + 1;
  }
  if (total > MAX_DAYS) throw new Error(`Calendar ranges span ${total} days (at most ${MAX_DAYS})`);
  const values = new Float64Array(total).fill(NaN);
  inputDays.forEach((d, i) => {
    ranges.forEach(([s, e], b) => {
      if (d >= s && d <= e) values[offsets[b] + d - s] = Number.isFinite(inputValues[i]) ? inputValues[i] : NaN;
    });
  });
  const dataIds: number[] = [];
  values.forEach((v, i) => {
    if (Number.isFinite(v)) dataIds.push(i);
  });
  const split = typeof options?.splitLine === 'object' ? options.splitLine : { show: options?.splitLine ?? true };
  const bar = typeof options?.colorbar === 'boolean' ? { show: options.colorbar } : (options?.colorbar ?? {});
  const meta: CalendarChartMeta = {
    kind: 'calendar',
    ranges,
    offsets,
    values,
    dataIds,
    inputDays,
    inputValues,
    orient: options?.orient === 'vertical' ? 'vertical' : 'horizontal',
    cellSize,
    cellGap,
    firstDay,
    dayLabels: labelOption(options?.dayLabels, 7, 'day'),
    monthLabels: labelOption(options?.monthLabels, 12, 'month'),
    yearLabel: options?.yearLabel ?? true,
    split: { show: split.show ?? true, color: split.color, width: Number.isFinite(split.width) ? Math.max(0, split.width!) : 1 },
    colormap: { scale: options?.colorScale ?? 'sequential', color: options?.color, reverse: options?.reverse ?? false, emptyColor: options?.emptyColor },
    domain: { min: options?.min, max: options?.max, center: options?.center },
    colorbar: { show: bar.show ?? true, title: '', format: bar.format },
    names: [],
    colors: [],
    visible: [true],
    valueLabel: '',
    format,
    colorOf: () => [0.5, 0.5, 0.5, 1],
    valueLabelInput: options?.valueLabel,
    colorbarTitleInput: bar.title,
  };
  localizeCalendarMeta(meta, locale);
  return meta;
}

/** Default value label / colorbar title in `locale` (options win). */
export function localizeCalendarMeta(meta: CalendarChartMeta, locale: string | undefined): void {
  meta.locale = locale;
  meta.valueLabel = meta.valueLabelInput ?? getMessages(locale).common.value;
  meta.colorbar.title = meta.colorbarTitleInput ?? meta.valueLabel;
}

/** Label room (CSS px) `[year, day of week, month]` reserved by the engine (0 = hidden). */
function labelRoom(meta: CalendarChartMeta): Float32Array {
  const v = meta.orient === 'vertical';
  return Float32Array.from([meta.yearLabel ? (v ? 20 : 24) : 0, meta.dayLabels.show ? (v ? 18 : 32) : 0, meta.monthLabels.show ? (v ? 32 : 18) : 0]);
}

/** Uploads the calendar (`set_calendar_chart`) with its colormap / domain; returns the day count. */
export function sendCalendar(backend: WasmCharturboEngineBackend, meta: CalendarChartMeta, theme: CharturboTheme): number {
  const n =
    backend.set_calendar_chart?.(
      Float64Array.from(meta.ranges.flat()),
      Float64Array.from(meta.inputDays),
      Float64Array.from(meta.inputValues),
      meta.orient === 'vertical' ? 1 : 0,
      meta.cellSize,
      meta.cellGap,
      meta.firstDay,
      labelRoom(meta),
      splitColor(meta, theme),
      meta.split.show ? meta.split.width : 0
    ) ?? 0;
  const d = meta.domain;
  backend.set_chart_heatmap_domain?.(d.min ?? NaN, d.max ?? NaN, d.center ?? NaN);
  sendCalendarStyle(backend, meta, theme);
  meta.colorOf = (v) => bytesToRgba(backend.chart_heatmap_color?.(v));
  return n;
}

function splitColor(meta: CalendarChartMeta, theme: CharturboTheme): Float32Array {
  return Float32Array.from(parseOptionalColor(meta.split.color) ?? theme.baseline);
}

/** Colormap (theme surface / empty tone) and split line color under `theme`. */
export function sendCalendarStyle(backend: WasmCharturboEngineBackend, meta: CalendarChartMeta, theme: CharturboTheme): void {
  const c = meta.colormap;
  backend.set_chart_heatmap_colormap?.(
    HEATMAP_SCALE_CODES[c.scale] ?? 0,
    c.color !== undefined ? Float32Array.from(parseColor(c.color)) : new Float32Array(0),
    c.reverse,
    Float32Array.from(theme.surface),
    Float32Array.from(parseOptionalColor(c.emptyColor) ?? theme.grid)
  );
  backend.set_chart_calendar_split_line?.(splitColor(meta, theme), meta.split.show ? meta.split.width : 0);
}

/** Calendar index and day of global id `id` (null when out of range). */
function dayOfId(meta: CalendarChartMeta, id: number): { block: number; day: number } | null {
  if (!Number.isInteger(id) || id < 0 || id >= meta.values.length) return null;
  for (let b = meta.ranges.length - 1; b >= 0; b--) {
    if (id >= meta.offsets[b]) return { block: b, day: meta.ranges[b][0] + id - meta.offsets[b] };
  }
  return null;
}

/**
 * Global id of `day`: its cell; in a gap between calendars the start of the next one (`back`:
 * the end of the previous one), else the first / last day.
 */
function idOfDay(meta: CalendarChartMeta, day: number, back = false): number {
  for (let b = 0; b < meta.ranges.length; b++) {
    const [s, e] = meta.ranges[b];
    if (day < s) return back ? Math.max(0, meta.offsets[b] - 1) : meta.offsets[b];
    if (day <= e) return meta.offsets[b] + day - s;
  }
  return meta.values.length - 1;
}

/** `'YYYY-MM-DD'` of a day number. */
export function isoDay(day: number): string {
  const { y, m, d } = civilOf(day);
  const year = y < 0 ? `-${String(-y).padStart(4, '0')}` : String(y).padStart(4, '0');
  return `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function dateFormat(locale: string | undefined, key: string, opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const tag = resolveLocale(locale);
  const k = `${tag}|${key}`;
  let f = formatters.get(k);
  if (!f) {
    f = new Intl.DateTimeFormat(tag, { ...opts, timeZone: 'UTC' });
    formatters.set(k, f);
  }
  return f;
}

/** Date text of a day, e.g. `Mon, Jan 2, 2023` (`weekday: false`: `Jan 2, 2023`). */
export function calendarDateText(day: number, locale?: string, weekday = true): string {
  const opts: Intl.DateTimeFormatOptions = weekday
    ? { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' }
    : { year: 'numeric', month: 'short', day: 'numeric' };
  return dateFormat(locale, weekday ? 'wd' : 'd', opts).format(day * DAY_MS);
}

export function calendarTooltipContext(meta: CalendarChartMeta, id: number, details: (id: number) => ChartTooltipContext['details']): ChartTooltipContext | null {
  const at = dayOfId(meta, id);
  if (!at) return null;
  const value = meta.values[id];
  return {
    chartType: 'calendar',
    index: id,
    xLabel: calendarDateText(at.day, meta.locale),
    items: [{ seriesName: meta.valueLabel, value, color: rgbCss(meta.colorOf(value)), nodeId: id }],
    calendar: { date: isoDay(at.day), day: at.day, value, calendar: at.block },
    details: details(id),
  };
}

export function calendarTooltipHtml(ctx: ChartTooltipContext, theme: CharturboTheme, formatValue: (v: number) => string, locale?: string): string {
  const c = ctx.calendar;
  if (!c) return '';
  const { common: cm, business: bm } = getMessages(locale);
  const value = Number.isFinite(c.value) ? esc(formatValue(c.value)) : esc(bm.calendarNoData);
  return `${tooltipHeader(theme, calendarDateText(c.day, locale))}${tooltipRow(theme, ctx.items[0]?.seriesName ?? cm.value, value, ctx.items[0]?.color)}`;
}

export function calendarPointMetadata(meta: CalendarChartMeta, id: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  const at = dayOfId(meta, id);
  if (!at) return null;
  const v = meta.values[id];
  return {
    series: 0,
    color: meta.colorOf(v),
    metadata: {
      label: calendarDateText(at.day, meta.locale),
      category: meta.valueLabel,
      tags: ['calendar-heatmap'],
      attributes: { date: isoDay(at.day), value: Number.isFinite(v) ? v : 'empty', calendar: at.block },
    },
  };
}

/**
 * A11y model: one stop per day (empty days included; ids = global day ids), arrows by day /
 * week following the orientation, Page Up / Down by month; the table lists the days with data.
 */
export function calendarA11yModel(meta: CalendarChartMeta, c: A11yCommon): A11yChartModel {
  const n = meta.values.length;
  const f = c.formatValue;
  const locale = c.locale ?? meta.locale;
  const { common: cm, business: bm } = getMessages(locale);
  const num = (v: number) => formatCount(v, locale);
  const dayAt = (i: number) => dayOfId(meta, i)?.day ?? NaN;
  const label = (i: number) => (Number.isFinite(dayAt(i)) ? calendarDateText(dayAt(i), locale) : '');
  const iso = (i: number) => (Number.isFinite(dayAt(i)) ? isoDay(dayAt(i)) : '');
  const short = (day: number) => calendarDateText(day, locale, false);
  const vertical = meta.orient === 'vertical';
  let lo = Infinity;
  let hi = -Infinity;
  for (const i of meta.dataIds) {
    lo = Math.min(lo, meta.values[i]);
    hi = Math.max(hi, meta.values[i]);
  }
  const withData = (s: number, e: number) => meta.dataIds.filter((i) => i >= s && i <= e).length;
  const monthStep = (i: number, dir: number) => {
    const { y, m, d } = civilOf(dayAt(i));
    const [ty, tm] = m + dir < 1 ? [y - 1, 12] : m + dir > 12 ? [y + 1, 1] : [y, m + dir];
    return idOfDay(meta, civilDay(ty, tm, Math.min(d, daysInMonth(ty, tm))), dir < 0);
  };
  const custom: A11yCustomModel = {
    kindLabel: cm.kind.calendar,
    xHeader: bm.date,
    summary: () => {
      const first = meta.ranges[0]?.[0] ?? 0;
      const last = meta.ranges[meta.ranges.length - 1]?.[1] ?? 0;
      const has = meta.dataIds.length > 0;
      const text = bm.calendarSummary(n, num(n), short(first), short(last), num(meta.dataIds.length), has ? f(lo) : '', has ? f(hi) : '');
      return c.title ? bm.titled(c.title, text) : text;
    },
    description: () =>
      meta.ranges.length > 1
        ? meta.ranges.map(([s, e], b) => bm.calendarBlock(short(s), short(e), num(withData(meta.offsets[b], meta.offsets[b] + e - s))))
        : [],
    help: bm.calendarHelp(vertical),
    announce: (focus) => {
      const i = focus.index;
      const v = meta.values[i];
      const position = cm.position(num(i + 1), num(n));
      return Number.isFinite(v) ? bm.calendarAnnounce(label(i), meta.valueLabel, f(v), position) : bm.calendarAnnounceEmpty(label(i), position);
    },
    step: (focus, key) => {
      if (n < 1) return null;
      if (!focus) return { series: 0, index: key === 'End' ? n - 1 : 0 };
      const i = focus.index;
      const [dayBack, dayOn, weekBack, weekOn] = vertical
        ? ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']
        : ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
      const next =
        key === dayBack ? i - 1
        : key === dayOn ? i + 1
        : key === weekBack ? i - 7
        : key === weekOn ? i + 7
        : key === 'PageUp' ? monthStep(i, -1)
        : key === 'PageDown' ? monthStep(i, 1)
        : key === 'Home' ? 0
        : key === 'End' ? n - 1
        : i;
      return { series: 0, index: Math.max(0, Math.min(n - 1, next)) };
    },
    table: (pick): ChartDataTable => {
      const ids = meta.dataIds;
      const rows = pick(ids.length).map((k) => [iso(ids[k]), meta.values[ids[k]]]);
      return { columns: [bm.date, meta.valueLabel], rows, totalRows: ids.length, sampled: rows.length < ids.length };
    },
  };
  return {
    kind: 'calendar',
    ...c,
    locale,
    series: [{ name: meta.valueLabel, values: meta.values, visible: true, f32: false }],
    length: n,
    custom,
    xValue: iso,
    xLabel: label,
    formatX: label,
    pointId: (_s, i) => i,
    itemName: () => meta.valueLabel,
    itemColor: (_s, i) => meta.colorOf(meta.values[i]),
  };
}

/** DOM weekday / month / year labels at the engine anchors (`chart_calendar_labels`). */
export class CalendarLabelLayer implements BusinessLabelLayer {
  private readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;

  constructor(
    parent: HTMLElement,
    private readonly meta: CalendarChartMeta
  ) {
    this.root = overlayDiv('charturbo-sdk-calendar-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

  invalidate(): void {
    this.revision = -1;
  }

  private text(kind: number, a: number, b: number, locale: string | undefined, narrow: boolean): string {
    const meta = this.meta;
    if (kind === 0) {
      const style = narrow ? 'narrow' : 'short';
      return meta.dayLabels.names?.[a] ?? dateFormat(locale, `wd-${style}`, { weekday: style }).format(Date.UTC(2023, 0, 1 + a));
    }
    if (kind === 1) return meta.monthLabels.names?.[b - 1] ?? dateFormat(locale, 'ms', { month: 'short' }).format(Date.UTC(2000, b - 1, 1));
    return a === b ? String(a) : `${a}–${b}`;
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, locale?: string): void {
    const a = backend.chart_calendar_labels?.();
    if (!a || a.length < 2 || a[0] === this.revision) return;
    this.revision = a[0];
    const count = Math.min(a[1], Math.floor((a.length - 2) / 7));
    const horizontal = this.meta.orient === 'horizontal';
    // Position of a label along the weekday / month run (y of a horizontal weekday row, x of a
    // vertical weekday column; months run the other way)
    const along = (k: number) => a[2 + k * 7 + (horizontal === (a[2 + k * 7] === 0) ? 4 : 3)];
    // Cell pitch from two neighboring weekday labels: small cells get narrow names (vertical) or
    // every other / third weekday (horizontal), so the names never overlap
    const days = [...Array(count).keys()].filter((k) => a[2 + k * 7] === 0);
    const pitch = days.length > 1 ? Math.abs(along(days[1]) - along(days[0])) : Infinity;
    const narrow = !horizontal && pitch < 26;
    const room = horizontal ? 13 : narrow ? 9 : 26;
    const dayStep = Math.max(1, Math.ceil(room / Math.max(pitch, 1e-3)));
    let lastMonth = -Infinity;
    let dayIndex = 0;
    let prevKind = -1;
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 7;
      const [kind, x, y, ha, va] = [a[at], a[at + 3], a[at + 4], a[at + 5], a[at + 6]];
      let el = this.labels[k];
      if (!el) {
        el = overlayDiv('charturbo-sdk-calendar-label', { fontSize: '11px', lineHeight: '13px', whiteSpace: 'nowrap' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      const text = this.text(kind, a[at + 1], a[at + 2], locale, narrow);
      el.textContent = text;
      let show = true;
      if (kind === 0) {
        // Rows 1, 3, 5 at half density (Mon / Wed / Fri from Sunday), every third at a third
        show = dayIndex % 7 % dayStep === (dayStep - 1) % dayStep;
        dayIndex++;
      } else if (kind === 1) {
        // Skip a month whose label would run into the previous one (each calendar's months are
        // one run: weekdays, months, year per calendar)
        if (prevKind !== 1) lastMonth = -Infinity;
        const pos = along(k);
        const extent = horizontal ? text.length * 6.5 + 4 : 13;
        show = pos < lastMonth || pos >= lastMonth + extent;
        if (show) lastMonth = pos;
      }
      prevKind = kind;
      const year = kind === 2;
      Object.assign(el.style, { display: show ? 'block' : 'none', color: year ? theme.textSecondary : theme.textMuted, fontWeight: year ? '600' : '400' });
      placeAt(el, x, y, ha, va);
      // Horizontal: the year reads bottom to top beside its calendar
      if (year && horizontal) el.style.transform += ' rotate(-90deg)';
    }
    for (let k = count; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
