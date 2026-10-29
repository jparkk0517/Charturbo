/**
 * Parallel coordinates binding. The engine owns the geometry (parallel.rs): one polyline per row
 * across the axes (horizontal or vertical layout, optional smoothing), the axis scales and nice
 * ticks, the brush row flags (only the flags are re-uploaded on a brush change), the hover hit
 * test and the label anchors. This module parses the cells (category names, dates, numbers) into
 * axis values, resolves brush intervals, mirrors the rows for the tooltip / a11y / CSV, places the
 * tick / axis name labels at the engine anchors and drives the pointer / keyboard brush.
 */
import { parseColor, parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import { resolveFormatLive, type ChartValueFormat } from './chart-format';
import type { A11yChartModel, A11yFocus, ChartDataCell, ChartDataTable } from './chart-a11y';
import type { ChartLegendOptions, ChartPaddingOptions, ChartTooltipContext, NodeMetadata, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { esc, overlayDiv, placeAt, rgbCss, tooltipHeader, tooltipRow, type A11yCommon, type A11yCustomModel, type BusinessLabelLayer } from './chart-business-util';
import { bytesToRgba, HEATMAP_SCALE_CODES, type HeatmapColorbarOptions, type HeatmapColorScale } from './chart-heatmap';
import { formatCount, getMessages, resolveLocale } from './i18n';

const DAY_MS = 86_400_000;
/** Engine limits (parallel.rs) */
const MAX_DIMS = 64;
const MAX_ROWS = 1_000_000;
const MAX_SEGMENTS = 4_000_000;
const MAX_INTERVALS = 16;
const KIND_CODES = { value: 0, category: 1, time: 2 } as const;

export type ParallelAxisType = 'value' | 'category' | 'time';

/** A cell: a number, a category name, a date (`Date`, epoch ms on time axes, or a date string); null = missing. */
export type ParallelCell = number | string | Date | null | undefined;

export interface ParallelDimension {
  name: string;
  /** Default: inferred from the first cell (string = category, `Date` = time, else value) */
  type?: ParallelAxisType;
  /** Axis range (default: the data extent with nice ends); dates on time axes */
  min?: number | string | Date;
  max?: number | string | Date;
  /** Larger values toward the axis start (bottom / left) */
  inverse?: boolean;
  /** Category names in axis order (default: first-seen order of the cells) */
  categories?: string[];
  /** Tick / tooltip / a11y text of a value axis (spec, Intl options or function) */
  format?: ChartValueFormat;
}

export interface ParallelSeries {
  name?: string;
  /** One row per item: one cell per dimension */
  data: ParallelCell[][];
  color?: ColorInput;
}

export interface ParallelChartData {
  /** Axes in order (at least 2, at most 64); a string is a value-axis name */
  dimensions: (string | ParallelDimension)[];
  /** Rows of one series (give `rows` or `series`) */
  rows?: ParallelCell[][];
  /** Rows grouped by series (legend / color per series) */
  series?: ParallelSeries[];
}

/** Brush interval on one axis: category names, dates or numbers. */
export interface ParallelBrushInterval {
  /** Index or name of the axis */
  dimension: number | string;
  range: [ParallelCell, ParallelCell];
}

/** Resolved brush interval (`range` in axis values: category index, epoch ms, number). */
export interface ParallelBrushRange {
  dimension: number;
  name: string;
  range: [number, number];
  /** Category axes: the names inside the range */
  categories?: string[];
}

export interface CharturboParallelBrushEvent {
  /** Every interval, by dimension (several on one axis = union, several axes = intersection) */
  intervals: ParallelBrushRange[];
  /** Visible rows inside the brush (every visible row without one) */
  activeCount: number;
  total: number;
  source: 'pointer' | 'keyboard' | 'api';
}

export interface ParallelChartOptions {
  /** `'horizontal'` (default: axes side by side, values up) or `'vertical'` (axes stacked, values right) */
  orient?: 'horizontal' | 'vertical';
  /** Line width in CSS px (default 1) */
  lineWidth?: number;
  /** Line opacity 0-1 (default 0.45) */
  opacity?: number;
  /** Smooth curves through the axes (default: false) */
  smooth?: boolean;
  /** Color the rows by a value / time dimension (index or name) through the heatmap colormap */
  colorBy?: number | string;
  /** Colormap of `colorBy` (default `'viridis'`) */
  colorScale?: HeatmapColorScale;
  color?: ColorInput;
  reverse?: boolean;
  /** Color domain of `colorBy` (default: the dimension's data extent) */
  colorRange?: [number, number];
  /** Colorbar of `colorBy` (default: shown) */
  colorbar?: HeatmapColorbarOptions | boolean;
  /** Initial brush (no `'parallelBrush'` event) */
  brush?: ParallelBrushInterval[];
  /** Pointer / keyboard brushing (default: true) */
  brushable?: boolean;
  /** Opacity of brushed-out rows relative to `opacity` (default 0.25) */
  inactiveOpacity?: number;
  /** Tone brushed-out rows fade to (default: the theme grid tone) */
  inactiveColor?: ColorInput;
  /** Brush band color (default: the theme crosshair tone, 25% alpha) */
  brushColor?: ColorInput;
  /** Axis line color (default: the theme baseline) */
  axisColor?: ColorInput;
  /** Default: shown with 2+ series (not with `colorBy`) */
  legend?: ChartLegendOptions | boolean;
  title?: string;
  description?: string;
  padding?: ChartPaddingOptions;
  /** Value text of value axes without their own `format` (tooltip, a11y, ticks) */
  format?: ChartValueFormat;
}

/** Hovered row: every dimension. */
export interface ChartParallelTooltip {
  row: number;
  series: number;
  seriesName: string;
  values: { dimension: string; value: number; text: string }[];
}

interface ParallelDim {
  name: string;
  type: ParallelAxisType;
  categories: string[];
  min: number;
  max: number;
  inverse: boolean;
  format?: (v: number) => string;
  /** Data extent `[lo, hi]` (Infinity / -Infinity without data) */
  extent: [number, number];
}

interface BrushInterval {
  axis: number;
  lo: number;
  hi: number;
}

/** Display state the SDK keeps for a parallel coordinates chart. */
export interface ParallelChartMeta {
  kind: 'parallel';
  dims: ParallelDim[];
  /** Row-major `rows x dims` axis values (NaN = missing) */
  values: Float64Array;
  /** Series of each row */
  rowSeries: Uint32Array;
  rowCount: number;
  orient: 'horizontal' | 'vertical';
  lineWidth: number;
  opacity: number;
  smooth: boolean;
  /** Color dimension (-1 = by series) */
  colorDim: number;
  colormap: { scale: HeatmapColorScale; color?: ColorInput; reverse: boolean };
  colorRange?: [number, number];
  colorbar: { show: boolean; title: string; format?: (v: number) => string };
  brush: BrushInterval[];
  brushable: boolean;
  inactiveOpacity: number;
  inactiveColor?: ColorInput;
  brushColor?: ColorInput;
  axisColor?: ColorInput;
  /** Series names / colors / visibility (legend) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  colorInputs: (ColorInput | undefined)[];
  nameInputs: (string | undefined)[];
  format: (value: number) => string;
  /** Value text of value ticks without a dimension format */
  tickFormat: (value: number) => string;
  /** Displayed color of a colorBy value (engine colormap; set by `sendParallel`) */
  colorOf: (value: number) => RgbaTuple;
  locale?: string;
  /** Keyboard state: focused axis, Shift-brush anchor value, cached value orders */
  nav: { axis: number; anchor: number | null; orders: Map<string, { order: Int32Array; rank: Int32Array }> };
  /** SDK hooks (set by `renderParallelChart`) */
  engine?: {
    setBrush(intervals: BrushInterval[], source: CharturboParallelBrushEvent['source']): number;
    hover(row: number): Float64Array | undefined;
    /** Visible rows inside the brush (engine flags); undefined = count in the SDK */
    activeCount?(): number | undefined;
  };
}

function cellText(cell: unknown): string {
  return cell instanceof Date ? String(cell) : JSON.stringify(cell);
}

/** Epoch ms of a time cell (`Date`, number, date string); NaN when invalid. */
function timeOf(cell: ParallelCell): number {
  if (cell instanceof Date) return cell.getTime();
  if (typeof cell === 'number') return cell;
  if (typeof cell === 'string' && cell.trim()) return Date.parse(cell);
  return NaN;
}

/** Axis value of `cell` on `dim` (NaN for null / undefined); throws for an invalid cell. */
function axisValue(dim: ParallelDim, cell: ParallelCell, where: string, grow: boolean): number {
  if (cell === null || cell === undefined) return NaN;
  if (dim.type === 'category') {
    if (typeof cell === 'number') {
      if (Number.isInteger(cell) && cell >= 0 && cell < dim.categories.length) return cell;
      throw new Error(`Parallel ${where}: ${cell} is not a category index of "${dim.name}" (0..${dim.categories.length - 1})`);
    }
    const name = String(cell);
    let k = dim.categories.indexOf(name);
    if (k < 0 && grow) k = dim.categories.push(name) - 1;
    if (k < 0) throw new Error(`Parallel ${where}: ${cellText(cell)} is not a category of "${dim.name}"`);
    return k;
  }
  if (dim.type === 'time') {
    const t = timeOf(cell);
    if (!(Math.abs(t) <= 8.64e15)) throw new Error(`Parallel ${where}: ${cellText(cell)} is not a valid time (Date, epoch ms or date string)`);
    return t;
  }
  const v = cell instanceof Date ? NaN : Number(cell);
  if (!Number.isFinite(v)) throw new Error(`Parallel ${where}: ${cellText(cell)} is not a number`);
  return v;
}

function boundOf(dim: ParallelDim, b: number | string | Date | undefined, what: string): number {
  if (b === undefined || dim.type === 'category') return NaN;
  const v = dim.type === 'time' ? timeOf(b) : typeof b === 'number' ? b : NaN;
  if (!Number.isFinite(v)) throw new Error(`Parallel dimension "${dim.name}" ${what} must be ${dim.type === 'time' ? 'a valid date' : 'a finite number'}`);
  return v;
}

/** Index of a dimension by index or name; throws when there is none. */
function dimIndex(dims: { name: string }[], d: number | string | undefined, what: string): number {
  const i = typeof d === 'number' ? (Number.isInteger(d) && d >= 0 && d < dims.length ? d : -1) : dims.findIndex((x) => x.name === d);
  if (i < 0) throw new Error(`Parallel ${what}: no dimension ${JSON.stringify(d)}`);
  return i;
}

/** Resolves brush intervals against the axes (sorted by axis, `lo <= hi`); throws for an invalid one. */
export function resolveParallelBrush(dims: ParallelDim[], intervals: readonly ParallelBrushInterval[] | undefined): BrushInterval[] {
  if (intervals === undefined) return [];
  if (!Array.isArray(intervals)) throw new Error('Parallel brush must be an array of { dimension, range }');
  const out = intervals.map((iv, k) => {
    const axis = dimIndex(dims, iv?.dimension, `brush interval ${k}`);
    const r = iv.range;
    if (!Array.isArray(r) || r.length !== 2) throw new Error(`Parallel brush interval ${k} range must be [from, to]`);
    const dim = dims[axis];
    const [a, b] = r.map((c) => {
      if (typeof c === 'number' && !Number.isFinite(c)) throw new Error(`Parallel brush interval ${k} range must be finite`);
      if (c === null || c === undefined) throw new Error(`Parallel brush interval ${k} range must be finite`);
      // A number on a category axis may sit between categories (pointer brush)
      if (dim.type === 'category' && typeof c === 'number') return c;
      return axisValue(dim, c, `brush interval ${k}`, false);
    });
    return { axis, lo: Math.min(a, b), hi: Math.max(a, b) };
  });
  return sortBrush(out);
}

function sortBrush(list: BrushInterval[]): BrushInterval[] {
  const sorted = list.map((iv, k) => ({ iv, k })).sort((x, y) => x.iv.axis - y.iv.axis || x.k - y.k);
  const out = sorted.map((x) => x.iv);
  for (let a = 0; a < out.length; a++) {
    if (out.filter((iv) => iv.axis === out[a].axis).length > MAX_INTERVALS) throw new Error(`Parallel brush: at most ${MAX_INTERVALS} intervals per dimension`);
  }
  return out;
}

export function encodeParallelBrush(list: BrushInterval[]): Float64Array {
  return Float64Array.from(list.flatMap((iv) => [iv.axis, iv.lo, iv.hi]));
}

function sameBrush(a: BrushInterval[], b: BrushInterval[]): boolean {
  return a.length === b.length && a.every((x, k) => x.axis === b[k].axis && x.lo === b[k].lo && x.hi === b[k].hi);
}

/** Public form of the brush intervals. */
export function parallelBrushRanges(meta: ParallelChartMeta): ParallelBrushRange[] {
  return meta.brush.map((iv) => {
    const dim = meta.dims[iv.axis];
    const out: ParallelBrushRange = { dimension: iv.axis, name: dim.name, range: [iv.lo, iv.hi] };
    if (dim.type === 'category') out.categories = dim.categories.filter((_, k) => k >= iv.lo && k <= iv.hi);
    return out;
  });
}

/** Builds the display meta (validates every dimension, cell and option). */
export function parallelMeta(data: ParallelChartData, options: ParallelChartOptions | undefined, format: (v: number) => string, locale?: string): ParallelChartMeta {
  const specs = data?.dimensions;
  if (!Array.isArray(specs) || specs.length < 2 || specs.length > MAX_DIMS) {
    throw new Error(`Parallel coordinates need 2 to ${MAX_DIMS} dimensions, got ${Array.isArray(specs) ? specs.length : 'none'}`);
  }
  if (data.rows !== undefined && data.series !== undefined) throw new Error('Parallel data takes either rows or series, not both');
  const groups: { name?: string; color?: ColorInput; data: ParallelCell[][] }[] = data.series ?? [{ data: data.rows ?? [] }];
  if (!Array.isArray(groups)) throw new Error('Parallel series must be an array');
  const n = specs.length;
  let total = 0;
  groups.forEach((g, s) => {
    if (!g || !Array.isArray(g.data)) throw new Error(`Parallel series ${s} needs a data array of rows`);
    total += g.data.length;
  });
  if (total > MAX_ROWS) throw new Error(`Parallel coordinates take at most ${MAX_ROWS} rows, got ${total}`);
  if (total * (n - 1) > MAX_SEGMENTS) throw new Error(`Parallel coordinates take at most ${MAX_SEGMENTS} segments (rows x (dimensions - 1)), got ${total * (n - 1)}`);
  const firstCell = (d: number): ParallelCell => {
    for (const g of groups) for (const r of g.data) if (Array.isArray(r) && r[d] !== null && r[d] !== undefined) return r[d];
    return undefined;
  };
  // Live locale for the dimension formats; a format spec is checked before `meta` exists
  let built = false;
  const currentLocale = () => (built ? meta.locale : locale);
  const dims: ParallelDim[] = specs.map((sp, d) => {
    const spec: ParallelDimension = typeof sp === 'string' ? { name: sp } : sp;
    if (!spec || typeof spec.name !== 'string') throw new Error(`Parallel dimension ${d} needs a name`);
    if (spec.type !== undefined && !(spec.type in KIND_CODES)) throw new Error(`Parallel dimension "${spec.name}" type must be value, category or time`);
    if (spec.categories !== undefined && !Array.isArray(spec.categories)) throw new Error(`Parallel dimension "${spec.name}" categories must be an array of names`);
    const first = firstCell(d);
    const type: ParallelAxisType =
      spec.type ?? (spec.categories ? 'category' : typeof first === 'string' ? 'category' : first instanceof Date ? 'time' : 'value');
    const dim: ParallelDim = {
      name: spec.name,
      type,
      categories: spec.categories ? spec.categories.map(String) : [],
      min: NaN,
      max: NaN,
      inverse: spec.inverse === true,
      format: resolveFormatLive(spec.format, currentLocale),
      extent: [Infinity, -Infinity],
    };
    dim.min = boundOf(dim, spec.min, 'min');
    dim.max = boundOf(dim, spec.max, 'max');
    if (dim.min >= dim.max) throw new Error(`Parallel dimension "${dim.name}" min must be below max`);
    return dim;
  });
  const grow = dims.map((dim, d) => dim.type === 'category' && !(typeof specs[d] === 'object' && (specs[d] as ParallelDimension).categories));
  const values = new Float64Array(total * n);
  const rowSeries = new Uint32Array(total);
  let row = 0;
  groups.forEach((g, s) => {
    g.data.forEach((r, i) => {
      const where = data.series ? `series ${s} row ${i}` : `row ${i}`;
      if (!Array.isArray(r) || r.length !== n) throw new Error(`Parallel ${where} has ${Array.isArray(r) ? r.length : 0} cells (expected ${n})`);
      for (let d = 0; d < n; d++) {
        const v = axisValue(dims[d], r[d], `${where}, dimension "${dims[d].name}"`, grow[d]);
        values[row * n + d] = v;
        const e = dims[d].extent;
        if (v < e[0]) e[0] = v;
        if (v > e[1]) e[1] = v;
      }
      rowSeries[row++] = s;
    });
  });
  dims.forEach((dim) => {
    if (dim.type === 'category' && dim.categories.length === 0) dim.categories.push('');
  });
  const o = options ?? {};
  const lineWidth = o.lineWidth ?? 1;
  if (!(Number.isFinite(lineWidth) && lineWidth > 0)) throw new Error(`Parallel lineWidth must be > 0, got ${lineWidth}`);
  const opacity = o.opacity ?? 0.45;
  if (!(opacity >= 0 && opacity <= 1)) throw new Error(`Parallel opacity must be 0 to 1, got ${opacity}`);
  const inactiveOpacity = o.inactiveOpacity ?? 0.25;
  if (!(inactiveOpacity >= 0 && inactiveOpacity <= 1)) throw new Error(`Parallel inactiveOpacity must be 0 to 1, got ${inactiveOpacity}`);
  let colorDim = -1;
  if (o.colorBy !== undefined) {
    colorDim = dimIndex(dims, o.colorBy, 'colorBy');
    if (dims[colorDim].type === 'category') throw new Error(`Parallel colorBy needs a value or time dimension ("${dims[colorDim].name}" is a category axis)`);
  }
  if (o.colorRange !== undefined && !(Array.isArray(o.colorRange) && o.colorRange.length === 2 && o.colorRange.every(Number.isFinite))) {
    throw new Error('Parallel colorRange must be [min, max] finite numbers');
  }
  if (o.colorScale !== undefined && !(o.colorScale in HEATMAP_SCALE_CODES)) throw new Error(`Parallel colorScale ${JSON.stringify(o.colorScale)} is unknown`);
  // Colors are parsed here so an invalid one throws before the active chart is torn down
  for (const c of [o.color, o.inactiveColor, o.brushColor, o.axisColor, ...groups.map((g) => g.color)]) parseOptionalColor(c);
  const bar = typeof o.colorbar === 'boolean' ? { show: o.colorbar } : (o.colorbar ?? {});
  const meta: ParallelChartMeta = {
    kind: 'parallel',
    dims,
    values,
    rowSeries,
    rowCount: total,
    orient: o.orient === 'vertical' ? 'vertical' : 'horizontal',
    lineWidth,
    opacity,
    smooth: o.smooth === true,
    colorDim,
    colormap: { scale: o.colorScale ?? 'viridis', color: o.color, reverse: o.reverse ?? false },
    colorRange: o.colorRange ? [o.colorRange[0], o.colorRange[1]] : undefined,
    colorbar: { show: colorDim >= 0 && (bar.show ?? true), title: bar.title ?? (colorDim >= 0 ? dims[colorDim].name : ''), format: bar.format },
    brush: resolveParallelBrush(dims, o.brush),
    brushable: o.brushable ?? true,
    inactiveOpacity,
    inactiveColor: o.inactiveColor,
    brushColor: o.brushColor,
    axisColor: o.axisColor,
    names: [],
    colors: groups.map(() => [0.5, 0.5, 0.5, 1] as RgbaTuple),
    visible: groups.map(() => true),
    colorInputs: groups.map((g) => g.color),
    nameInputs: groups.map((g) => g.name),
    format,
    tickFormat: o.format !== undefined ? format : (v) => tickText(v, meta.locale),
    colorOf: () => [0.5, 0.5, 0.5, 1],
    nav: { axis: 0, anchor: null, orders: new Map() },
  };
  built = true;
  localizeParallelMeta(meta, locale);
  return meta;
}

/** Default series names in `locale` (names given in the data are kept). */
export function localizeParallelMeta(meta: ParallelChartMeta, locale: string | undefined): void {
  meta.locale = locale;
  const cm = getMessages(locale).common;
  meta.names = meta.nameInputs.map((n, s) => n ?? cm.seriesName(s + 1));
}

/** Default value tick text: compact for large magnitudes. */
function tickText(v: number, locale?: string): string {
  const tag = resolveLocale(locale);
  return Math.abs(v) >= 10_000 ? v.toLocaleString(tag, { notation: 'compact', maximumFractionDigits: 1 }) : v.toLocaleString(tag, { maximumFractionDigits: 4 });
}

const TIME_FORMATS: Record<string, Intl.DateTimeFormatOptions> = {
  1: { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23' },
  2: { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
  3: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  4: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  5: { month: 'short', day: 'numeric' },
  6: { month: 'short' },
  7: { year: 'numeric' },
  date: { year: 'numeric', month: 'short', day: 'numeric' },
  full: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
};
const timeFormats = new Map<string, Intl.DateTimeFormat>();

/** UTC time text: granularity code of an engine tick (1 ms .. 7 year), else the date (and time off midnight). */
export function parallelTimeText(ms: number, locale?: string, gran = 0): string {
  if (!(Math.abs(ms) <= 8.64e15)) return String(ms);
  const key = gran >= 1 && gran <= 7 ? String(gran) : ms % DAY_MS === 0 ? 'date' : 'full';
  const tag = resolveLocale(locale);
  let f = timeFormats.get(`${tag}|${key}`);
  if (!f) timeFormats.set(`${tag}|${key}`, (f = new Intl.DateTimeFormat(tag, { ...TIME_FORMATS[key], timeZone: 'UTC' })));
  return f.format(ms);
}

/** ISO text of a time value: the date at UTC midnight, else the full instant. */
function isoTime(ms: number): string {
  const s = new Date(ms).toISOString();
  return ms % DAY_MS === 0 ? s.slice(0, 10) : s;
}

/** Display text of an axis value (`fmt`: value axes without a dimension format). */
function valueText(meta: ParallelChartMeta, d: number, v: number, fmt: (v: number) => string, locale?: string): string {
  if (!Number.isFinite(v)) return getMessages(locale ?? meta.locale).common.dash;
  const dim = meta.dims[d];
  if (dim.type === 'category') return dim.categories[Math.round(v)] ?? '';
  if (dim.type === 'time') return parallelTimeText(v, locale ?? meta.locale);
  return (dim.format ?? fmt)(v);
}

/** Table / CSV cell of an axis value: category name, ISO date, number. */
function tableCell(meta: ParallelChartMeta, d: number, v: number): ChartDataCell {
  if (!Number.isFinite(v)) return null;
  const dim = meta.dims[d];
  if (dim.type === 'category') return dim.categories[Math.round(v)] ?? null;
  if (dim.type === 'time') return isoTime(v);
  return v;
}

const value = (meta: ParallelChartMeta, row: number, d: number) => meta.values[row * meta.dims.length + d];

/** Visible and inside the brush (mirrors the engine row flags). */
export function parallelRowActive(meta: ParallelChartMeta, row: number): boolean {
  if (!(meta.visible[meta.rowSeries[row]] ?? true)) return false;
  const byAxis = new Map<number, BrushInterval[]>();
  for (const iv of meta.brush) byAxis.set(iv.axis, [...(byAxis.get(iv.axis) ?? []), iv]);
  for (const [axis, list] of byAxis) {
    const v = value(meta, row, axis);
    if (!list.some((iv) => v >= iv.lo && v <= iv.hi)) return false;
  }
  return true;
}

/** Uploads the chart (`set_parallel_chart`), its colormap / domain, style and initial brush; returns the row count. */
export function sendParallel(backend: WasmCharturboEngineBackend, meta: ParallelChartMeta, theme: CharturboTheme): number {
  const dims = meta.dims;
  const n =
    backend.set_parallel_chart?.(
      Uint8Array.from(dims.map((d) => KIND_CODES[d.type])),
      Float64Array.from(dims.flatMap((d) => [d.min, d.max])),
      Uint8Array.from(dims.map((d) => (d.inverse ? 1 : 0))),
      Uint32Array.from(dims.map((d) => (d.type === 'category' ? d.categories.length : 0))),
      meta.values,
      meta.rowSeries,
      Float64Array.from([meta.orient === 'vertical' ? 1 : 0, meta.lineWidth, meta.opacity, meta.smooth ? 1 : 0, meta.colorDim, Math.max(1, meta.names.length)])
    ) ?? 0;
  if (meta.colorDim >= 0) {
    const r = meta.colorRange;
    backend.set_chart_heatmap_domain?.(r ? r[0] : NaN, r ? r[1] : NaN, NaN);
  }
  sendParallelStyle(backend, meta, theme);
  if (meta.brush.length) backend.set_chart_parallel_brush?.(encodeParallelBrush(meta.brush));
  meta.colorOf = (v) => bytesToRgba(backend.chart_heatmap_color?.(v));
  return n;
}

/** Series / axis / brush / inactive colors (and the colormap of `colorBy`) under `theme`. */
export function sendParallelStyle(backend: WasmCharturboEngineBackend, meta: ParallelChartMeta, theme: CharturboTheme): void {
  const pal = theme.palette;
  meta.colors = meta.colorInputs.map((c, s) => parseOptionalColor(c) ?? pal[s % pal.length] ?? [0.5, 0.5, 0.5, 1]);
  if (meta.colorDim >= 0) {
    const c = meta.colormap;
    backend.set_chart_heatmap_colormap?.(
      HEATMAP_SCALE_CODES[c.scale] ?? 1,
      c.color !== undefined ? Float32Array.from(parseColor(c.color)) : new Float32Array(0),
      c.reverse,
      Float32Array.from(theme.surface),
      Float32Array.from(theme.grid)
    );
  }
  const brush = parseOptionalColor(meta.brushColor) ?? [theme.crosshair[0], theme.crosshair[1], theme.crosshair[2], 0.25];
  const inactive = parseOptionalColor(meta.inactiveColor) ?? theme.grid;
  backend.set_chart_parallel_style?.(
    Float32Array.from(meta.colors.flat()),
    Float32Array.from(parseOptionalColor(meta.axisColor) ?? theme.baseline),
    1,
    Float32Array.from(brush),
    14,
    Float32Array.from([inactive[0], inactive[1], inactive[2], 1]),
    meta.inactiveOpacity,
    Math.max(3, meta.lineWidth + 2)
  );
}

/** Displayed color of a row (series color, or the colormap of `colorBy`). */
function rowColor(meta: ParallelChartMeta, row: number): RgbaTuple {
  return meta.colorDim >= 0 ? meta.colorOf(value(meta, row, meta.colorDim)) : (meta.colors[meta.rowSeries[row]] ?? [0.5, 0.5, 0.5, 1]);
}

function rowLabel(meta: ParallelChartMeta, row: number, locale?: string): string {
  const s = meta.rowSeries[row];
  return getMessages(locale ?? meta.locale).parallel.rowLabel(meta.names.length > 1 ? (meta.names[s] ?? null) : null, formatCount(row + 1, locale ?? meta.locale));
}

export function parallelTooltipContext(meta: ParallelChartMeta, row: number, details: (id: number) => ChartTooltipContext['details']): ChartTooltipContext | null {
  if (!Number.isInteger(row) || row < 0 || row >= meta.rowCount) return null;
  const series = meta.rowSeries[row];
  const color = rgbCss(rowColor(meta, row));
  const values = meta.dims.map((dim, d) => {
    const v = value(meta, row, d);
    return { dimension: dim.name, value: v, text: valueText(meta, d, v, meta.format) };
  });
  return {
    chartType: 'parallel',
    index: row,
    xLabel: rowLabel(meta, row),
    items: values.map((v) => ({ seriesName: v.dimension, value: v.value, color, nodeId: row })),
    parallel: { row, series, seriesName: meta.names[series] ?? '', values },
    details: details(row),
  };
}

export function parallelTooltipHtml(ctx: ChartTooltipContext, theme: CharturboTheme): string {
  const p = ctx.parallel;
  if (!p) return '';
  const swatch = ctx.items[0]?.color;
  return `${tooltipHeader(theme, ctx.xLabel ?? '')}${p.values.map((v, k) => tooltipRow(theme, v.dimension, esc(v.text), k === 0 ? swatch : undefined)).join('')}`;
}

export function parallelPointMetadata(meta: ParallelChartMeta, row: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  if (!Number.isInteger(row) || row < 0 || row >= meta.rowCount) return null;
  const attributes: Record<string, string | number> = {};
  meta.dims.forEach((dim, d) => {
    const c = tableCell(meta, d, value(meta, row, d));
    if (c !== null) attributes[dim.name] = c;
  });
  return {
    series: meta.rowSeries[row],
    color: rowColor(meta, row),
    metadata: { label: rowLabel(meta, row), category: meta.names[meta.rowSeries[row]], tags: ['parallel'], attributes },
  };
}

/** Data table of `rows` (all rows by default): a Series column with 2+ series, then one per dimension. */
export function parallelTable(meta: ParallelChartMeta, rows: ArrayLike<number>, locale?: string, totalRows = rows.length): ChartDataTable {
  const series = meta.names.length > 1;
  const columns = [...(series ? [getMessages(locale ?? meta.locale).common.series] : []), ...meta.dims.map((d) => d.name)];
  const out: ChartDataCell[][] = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    const cells: ChartDataCell[] = series ? [meta.names[meta.rowSeries[r]] ?? ''] : [];
    for (let d = 0; d < meta.dims.length; d++) cells.push(tableCell(meta, d, value(meta, r, d)));
    out.push(cells);
  }
  return { columns, rows: out, totalRows, sampled: out.length < totalRows };
}

/** Rows of visible series ordered by value on `axis` (missing values last), with each row's rank (-1 = hidden). */
function axisOrder(meta: ParallelChartMeta, axis: number): { order: Int32Array; rank: Int32Array } {
  const key = `${axis}|${meta.visible.map((v) => (v ? 1 : 0)).join('')}`;
  let o = meta.nav.orders.get(key);
  if (o) return o;
  const rows: number[] = [];
  for (let r = 0; r < meta.rowCount; r++) if (meta.visible[meta.rowSeries[r]] ?? true) rows.push(r);
  rows.sort((a, b) => {
    const va = value(meta, a, axis);
    const vb = value(meta, b, axis);
    const na = Number.isNaN(va);
    const nb = Number.isNaN(vb);
    return na || nb ? Number(na) - Number(nb) || a - b : va - vb || a - b;
  });
  const order = Int32Array.from(rows);
  const rank = new Int32Array(meta.rowCount).fill(-1);
  order.forEach((r, k) => (rank[r] = k));
  // One cached order per axis / visibility state
  if (meta.nav.orders.size > 2 * meta.dims.length) meta.nav.orders.clear();
  meta.nav.orders.set(key, (o = { order, rank }));
  return o;
}

/**
 * A11y model: one stop per row (ids = row index), ordered by value on the focused axis. Along
 * the axes (Up / Down horizontal, Left / Right vertical) moves by value, across changes the axis;
 * Shift extends a brush on the focused axis, Delete clears it.
 */
export function parallelA11yModel(meta: ParallelChartMeta, c: A11yCommon): A11yChartModel {
  const n = meta.rowCount;
  const f = c.formatValue;
  const locale = c.locale ?? meta.locale;
  const { common: cm, parallel: t } = getMessages(locale);
  const num = (v: number) => formatCount(v, locale);
  const vertical = meta.orient === 'vertical';
  const [lower, higher] = vertical ? ['ArrowLeft', 'ArrowRight'] : ['ArrowDown', 'ArrowUp'];
  const [prevAxis, nextAxis] = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
  const text = (row: number, d: number) => valueText(meta, d, value(meta, row, d), f, locale);
  const clampAxis = (a: number) => Math.max(0, Math.min(meta.dims.length - 1, a));
  meta.nav.axis = clampAxis(meta.nav.axis);
  const focusOf = (row: number): A11yFocus => ({ series: meta.rowSeries[row], index: row });
  /** Next stop for `key` (no anchor change) */
  const move = (focus: A11yFocus | null, key: string): A11yFocus | null => {
    const axis = meta.nav.axis;
    const { order, rank } = axisOrder(meta, axis);
    if (!order.length) return null;
    const at = focus ? (rank[focus.index] ?? -1) : -1;
    if (at < 0) return focusOf(order[key === 'End' ? order.length - 1 : 0]);
    if (key === prevAxis || key === nextAxis) {
      meta.nav.axis = clampAxis(axis + (key === nextAxis ? 1 : -1));
      return focus;
    }
    // Visually up / right is the larger value unless the axis is inverted
    const dir = meta.dims[axis].inverse ? -1 : 1;
    const step =
      key === higher ? dir
      : key === lower ? -dir
      : key === 'PageUp' ? 10 * dir
      : key === 'PageDown' ? -10 * dir
      : 0;
    const k = key === 'Home' ? 0 : key === 'End' ? order.length - 1 : at + step;
    return focusOf(order[Math.max(0, Math.min(order.length - 1, k))]);
  };
  const setAxisBrush = (axis: number, interval: BrushInterval | null) => {
    const list = meta.brush.filter((iv) => iv.axis !== axis);
    if (interval) list.push(interval);
    meta.engine?.setBrush(list, 'keyboard');
  };
  let lo = 0;
  const custom: A11yCustomModel = {
    kindLabel: cm.kind.parallel,
    summary: () => {
      const brushed = meta.brush.length > 0;
      if (brushed) {
        const counted = meta.engine?.activeCount?.();
        if (counted !== undefined) lo = counted;
        else {
          lo = 0;
          for (let r = 0; r < n; r++) if (parallelRowActive(meta, r)) lo++;
        }
      }
      const text = t.summary(
        cm.kind.parallel,
        t.rows(n, num(n)),
        t.dimensions(meta.dims.length, num(meta.dims.length)),
        meta.names.length > 1 ? cm.seriesCount(meta.names.length, num(meta.names.length)) : null,
        brushed ? t.rows(lo, num(lo)) : null
      );
      return c.title ? getMessages(locale).business.titled(c.title, text) : text;
    },
    description: () => {
      const out = meta.dims.map((dim, d) => {
        if (dim.type === 'category') {
          const shown = dim.categories.slice(0, 10).join(cm.listSeparator);
          const more = dim.categories.length > 10 ? `${cm.listSeparator}${cm.andMore(num(dim.categories.length - 10))}` : '';
          return t.dimCategories(dim.name, cm.categories(dim.categories.length, num(dim.categories.length)), shown + more);
        }
        const [a, b] = dim.extent;
        if (!Number.isFinite(a)) return t.dimEmpty(dim.name);
        return t.dimRange(dim.name, valueText(meta, d, a, f, locale), valueText(meta, d, b, f, locale));
      });
      meta.dims.forEach((dim, d) => {
        const ranges = meta.brush.filter((iv) => iv.axis === d);
        if (ranges.length) {
          const r = ranges.map((iv) => cm.range(valueText(meta, d, dim.type === 'category' ? Math.ceil(iv.lo) : iv.lo, f, locale), valueText(meta, d, dim.type === 'category' ? Math.floor(iv.hi) : iv.hi, f, locale)));
          out.push(t.brushed(dim.name, r.join(cm.listSeparator)));
        }
      });
      return out;
    },
    help: t.help(vertical),
    announce: (focus) => {
      const row = focus.index;
      if (row < 0 || row >= n) return '';
      const axis = meta.nav.axis;
      const all = meta.dims.map((dim, d) => t.pair(dim.name, text(row, d))).join(cm.listSeparator);
      const series = meta.names.length > 1 ? (meta.names[meta.rowSeries[row]] ?? null) : null;
      return t.announce(t.pair(meta.dims[axis].name, text(row, axis)), series, num(row + 1), num(n), all, meta.brush.length > 0 && !parallelRowActive(meta, row));
    },
    step: (focus, key) => {
      // A plain move ends a Shift brush
      meta.nav.anchor = null;
      return move(focus, key);
    },
    key: (focus, key, shift) => {
      if (!meta.brushable || !meta.engine) return null;
      const axis = meta.nav.axis;
      if (key === 'Delete' || key === 'Backspace') {
        meta.nav.anchor = null;
        if (meta.brush.some((iv) => iv.axis === axis)) setAxisBrush(axis, null);
        return { focus };
      }
      if (!shift || (key !== lower && key !== higher && key !== 'Home' && key !== 'End' && key !== 'PageUp' && key !== 'PageDown')) return null;
      const from = focus && axisOrder(meta, axis).rank[focus.index] >= 0 ? value(meta, focus.index, axis) : NaN;
      const anchor = meta.nav.anchor ?? (Number.isFinite(from) ? from : null);
      const next = move(focus, key);
      if (!next) return null;
      const v = value(meta, next.index, axis);
      if (anchor === null) {
        // First stop: it becomes the anchor
        meta.nav.anchor = Number.isFinite(v) ? v : null;
        return { focus: next };
      }
      meta.nav.anchor = anchor;
      if (Number.isFinite(v)) setAxisBrush(axis, { axis, lo: Math.min(anchor, v), hi: Math.max(anchor, v) });
      return { focus: next };
    },
    hover: (focus) => meta.engine?.hover(focus.index),
    table: (pick) => {
      const idx = pick(n);
      return parallelTable(meta, idx, locale, n);
    },
  };
  return {
    kind: 'parallel',
    ...c,
    locale,
    series: meta.names.map((name, s) => ({ name, values: new Float64Array(0), visible: meta.visible[s] ?? true, f32: false })),
    length: n,
    custom,
    xValue: (i) => rowLabel(meta, i, locale),
    xLabel: (i) => rowLabel(meta, i, locale),
    formatX: (i) => rowLabel(meta, i, locale),
    pointId: (_s, i) => i,
    itemName: (s) => meta.names[s] ?? '',
    itemColor: (_s, i) => rowColor(meta, i),
  };
}

/** DOM tick / axis name labels at the engine anchors (`chart_parallel_labels`). */
export class ParallelLabelLayer implements BusinessLabelLayer {
  private readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;

  constructor(
    parent: HTMLElement,
    private readonly meta: ParallelChartMeta
  ) {
    this.root = overlayDiv('charturbo-sdk-parallel-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

  invalidate(): void {
    this.revision = -1;
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, locale?: string): void {
    const a = backend.chart_parallel_labels?.();
    if (!a || a.length < 2 || a[0] === this.revision) return;
    this.revision = a[0];
    const meta = this.meta;
    const count = Math.min(a[1], Math.floor((a.length - 2) / 8));
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 8;
      const [kind, axis, v, x, y, ha, va, gran] = [a[at], a[at + 1], a[at + 2], a[at + 3], a[at + 4], a[at + 5], a[at + 6], a[at + 7]];
      let el = this.labels[k];
      if (!el) {
        el = overlayDiv('charturbo-sdk-parallel-label', { fontSize: '11px', lineHeight: '13px', whiteSpace: 'nowrap' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      const dim = meta.dims[axis];
      const name = kind === 1;
      el.textContent = !dim
        ? ''
        : name
          ? dim.name
          : dim.type === 'category'
            ? (dim.categories[Math.round(v)] ?? '')
            : dim.type === 'time'
              ? parallelTimeText(v, locale ?? meta.locale, gran)
              : (dim.format ?? meta.tickFormat)(v);
      Object.assign(el.style, { display: 'block', color: name ? theme.textSecondary : theme.textMuted, fontWeight: name ? '600' : '400' });
      placeAt(el, x, y, ha, va);
    }
    for (let k = count; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}

/**
 * Pointer brush: a press on an axis starts an interval there, a drag past 3 px sets it live
 * (Shift adds it to the axis' intervals, else it replaces them), a click clears the axis.
 */
export function createParallelBrushController(h: {
  active(): boolean;
  axisHit(ndc: [number, number]): [number, number] | null;
  valueAt(axis: number, ndc: [number, number]): number;
  current(): BrushInterval[];
  apply(list: BrushInterval[]): void;
  toNdc(e: { clientX: number; clientY: number }): [number, number];
  capture(pointerId: number): void;
  setCursor(cursor: string | null): void;
  vertical(): boolean;
}) {
  let drag: { axis: number; from: number; base: BrushInterval[]; x: number; y: number; live: boolean } | null = null;
  const apply = (make: () => BrushInterval[]) => {
    try {
      h.apply(make());
    } catch {
      // Over the per-axis interval limit: the brush stays as it was
    }
  };
  return {
    dragging: () => drag !== null,
    pointerDown(e: PointerEvent): boolean {
      if (e.button !== 0 || !h.active()) return false;
      const hit = h.axisHit(h.toNdc(e));
      if (!hit) return false;
      const [axis, from] = hit;
      const base = e.shiftKey ? h.current() : h.current().filter((iv) => iv.axis !== axis);
      drag = { axis, from, base, x: e.clientX, y: e.clientY, live: false };
      h.capture(e.pointerId);
      h.setCursor(h.vertical() ? 'ew-resize' : 'ns-resize');
      return true;
    },
    pointerMove(e: PointerEvent): boolean {
      if (!drag) return false;
      if (!drag.live && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= 3) return true;
      drag.live = true;
      const v = h.valueAt(drag.axis, h.toNdc(e));
      if (Number.isFinite(v)) apply(() => sortBrush([...drag!.base, { axis: drag!.axis, lo: Math.min(drag!.from, v), hi: Math.max(drag!.from, v) }]));
      return true;
    },
    pointerUp(): boolean {
      if (!drag) return false;
      const d = drag;
      drag = null;
      h.setCursor(null);
      if (!d.live) apply(() => h.current().filter((iv) => iv.axis !== d.axis));
      return true;
    },
    cancel(): void {
      if (drag) h.setCursor(null);
      drag = null;
    },
  };
}

export { sameBrush as sameParallelBrush, sortBrush as sortParallelBrush };
export type { BrushInterval as ParallelBrushInternal };
