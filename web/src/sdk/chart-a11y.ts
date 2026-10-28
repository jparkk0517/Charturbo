/**
 * Chart accessibility: text summary / long description for the canvas, keyboard navigation of
 * data points (drives the engine hover through existing backend calls), an aria-live
 * announcer, and an accessible data table / CSV export.
 *
 * Everything that does not touch the DOM is a pure helper so it can be unit-tested in node.
 * The SDK only feeds the controller a snapshot of its chart state (`ChartA11yHostState`).
 */
import { heatmapAxisLabel, heatmapRowLabel, type HeatmapChartMeta } from './chart-heatmap';
import { createFormatter } from './chart-format';
import { formatCount, formatNumber, getMessages } from './i18n';
import { boxA11yData, boxAnnouncement, boxDataTable, boxDescription, boxSummary, type A11yBoxData } from './chart-boxplot';
import { comboA11yModel, comboAnnouncement, comboDescription, comboSummary, type A11yComboData } from './chart-combo';
import { businessA11yModel, isBusinessKind } from './chart-business';
import type { A11yCustomModel } from './chart-business-util';
import { hierarchyA11yModel } from './chart-hierarchy';
import { sparseTooltip, type SparseMeta } from './chart-sparse';
import { scientificA11yModel, type Scientific3DMeta } from './chart-scientific3d';
import type {
  ChartOhlc,
  ChartTooltipContext,
  ChartTooltipItem,
  NodeDetails,
  NodeMetadata,
  RgbaTuple,
  CharturboTheme,
  WasmCharturboEngineBackend,
} from './charturbo';

// ---------------------------------------------------------------------------
// Chart model (normalized view of the SDK chart meta / presentation)
// ---------------------------------------------------------------------------

export interface A11ySeries {
  name: string;
  /** Sample values; scatter: y of the series' points in x order (built lazily on first read) */
  values: ArrayLike<number>;
  visible: boolean;
  /** Values came from a `Float32Array`: print the shortest decimal that round-trips to f32 */
  f32: boolean;
  /** Navigable points when `values` is lazy (scatter); defaults to `values.length` */
  count?: number;
  /** Value text of this series instead of `formatValue` (candle volume: not a price) */
  format?: (value: number) => string;
  /** Line series range band (`band` option): lower / upper edge per sample; adds table columns */
  band?: { lower: ArrayLike<number>; upper: ArrayLike<number> };
}

export type A11yChartKind = 'scientific3d' | 'line' | 'bar' | 'bar-multi' | 'scatter' | 'candle' | 'heatmap' | 'box' | 'pie' | 'combo' | 'radar' | 'gauge' | 'funnel' | 'waterfall' | 'treemap' | 'sunburst' | 'sankey';

/** Pie slices (focus: `series` 0, `index` = displayed slice; point id = slice index). */
export interface A11yPieData {
  names: string[];
  values: number[];
  /** Share of the visible total (0-100); NaN while hidden */
  percents: number[];
  visible: boolean[];
  /** Sum of the visible slices */
  total: number;
  donut: boolean;
  /** Displayed index of the "Other" slice (-1 = none) and the names it folds */
  otherSlice: number;
  otherMembers: string[];
}

/** Finite value extent of a heatmap and its empty (NaN) cell count. */
export interface A11yHeatmapStats {
  min: number;
  max: number;
  /** Cell ids (`row * cols + col`) of the first min / max (-1 when every cell is empty) */
  minId: number;
  maxId: number;
  empty: number;
}

/** Heatmap grid (focus: `series` = row, `index` = column; point id = `row * cols + col`). */
export interface A11yHeatmapData {
  rows: number;
  cols: number;
  /** Row 0 is the top row (Up arrow = previous row) */
  rowTop: boolean;
  valueLabel: string;
  rowLabel(row: number): string;
  colLabel(col: number): string;
  /** Clean cell value (`NaN` = empty / out of range) */
  value(row: number, col: number): number;
  /** Computed on first use and cached per chart meta (one pass over the grid) */
  stats(): A11yHeatmapStats;
}

/** Scatter point arrays (point id = index into `x` / `y`). */
export interface A11yScatterData {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  /** Series id per point (`null` = one series) */
  series: ArrayLike<number> | null;
  /** Point count (`min(x.length, y.length)`) */
  length: number;
  f32: boolean;
}

/** Chart data in the shape the a11y helpers work on (built by `buildA11yModel`). */
export interface A11yChartModel {
  financialMode?: 'candlestick' | 'ohlc';
  kind: A11yChartKind;
  title?: string;
  description?: string;
  xTitle?: string;
  yTitle?: string;
  /** Chart locale of built-in text and numbers (`getMessages(locale)`); absent = page / browser language */
  locale?: string;
  series: A11ySeries[];
  /** Max series length (line) / category count (bar, bar-multi) / point count (scatter) */
  length: number;
  /** Multi-series bar layout */
  barMode?: 'grouped' | 'stacked' | 'percent';
  /** Line-kind model of an area chart (`renderAreaChart`) */
  areaMode?: 'overlap' | 'stacked' | 'percent';
  standaloneBand?: boolean;
  sparse?: SparseMeta;
  /** Line: per-series x arrays (`null` = index placement or one shared x array) */
  seriesX?: ArrayLike<number>[] | null;
  /** Line: samples carry real x values (tooltip `x`) */
  hasX?: boolean;
  scatter?: A11yScatterData;
  heatmap?: A11yHeatmapData;
  /** Box plot groups (series = medians per category) */
  box?: A11yBoxData;
  pie?: A11yPieData;
  /** Combo chart: kind / y axis of each series (rows = categories like bar-multi) */
  combo?: A11yComboData;
  /**
   * Radar / gauge / funnel / waterfall (chart-business.ts) and treemap / sunburst / sankey
   * (chart-hierarchy.ts): summary, description, announcements, navigation, table, direct hover
   */
  custom?: A11yCustomModel;
  /** Display label of a row / x position (`T+120`, bar label); scatter: index in the series' x order */
  xLabel(index: number, series?: number): string;
  /** Raw x value of a row for exports (x value or sample index for line, label for bar) */
  xValue(index: number, series?: number): number | string;
  /** Formats a raw x value like `xLabel` (line / scatter) */
  formatX(x: number): string;
  /** Value text used in announcements and the table */
  formatValue(value: number): string;
  /** Global id of a data point as understood by the engine (`project_node_to_ndc`, `chart_sample`) */
  pointId(series: number, index: number): number;
  /** Tooltip item name / color of a point (`index` = engine hit index: scatter point id) */
  itemName(series: number, index: number): string;
  itemColor(series: number, index: number): RgbaTuple;
}

type Loose = Record<string, unknown>;

const isArrayLike = (v: unknown): v is ArrayLike<unknown> =>
  !!v && typeof v === 'object' && typeof (v as ArrayLike<unknown>).length === 'number';

const isNumberArray = (v: unknown): v is ArrayLike<number> =>
  ArrayBuffer.isView(v) || (Array.isArray(v) && (v.length === 0 || typeof v[0] === 'number'));


/** Shortest decimal that rounds back to the same f32 (avoids `135.89999389648438`). */
export function f32ToShortest(v: number): number {
  if (!Number.isFinite(v)) return v;
  const f = Math.fround(v);
  // Every f32 integer below 2^24 is exact; round-trip is monotonic in the digit count
  // (the p-digit candidate is also a (p+1)-digit number), so binary search over 1..9 digits
  if (Number.isInteger(f) && Math.abs(f) < 16_777_216) return f;
  let lo = 1;
  let hi = 9;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (Math.fround(Number(f.toPrecision(mid))) === f) hi = mid;
    else lo = mid + 1;
  }
  const c = Number(f.toPrecision(lo));
  return Math.fround(c) === f ? c : f;
}

/**
 * Optional x values: other chart kinds may carry real x arrays (`xs` / `x` / `xValues`), either
 * shared by every series or one array per series. Falls back to the sample index.
 */
function pickX(meta: Loose): ((index: number, series: number) => number) | null {
  for (const key of ['xs', 'x', 'xValues']) {
    const v = meta[key];
    if (isNumberArray(v)) return (i) => Number(v[i]);
    if (Array.isArray(v) && v.some((s) => isNumberArray(s))) {
      return (i, s) => {
        const arr = (v[s] ?? v.find((a) => isNumberArray(a))) as ArrayLike<number> | undefined;
        return arr && i < arr.length ? Number(arr[i]) : i;
      };
    }
  }
  return null;
}

/** Per-series x arrays (`null` for index placement or one shared array). */
function pickSeriesX(meta: Loose, count: number): ArrayLike<number>[] | null {
  for (const key of ['xs', 'x', 'xValues']) {
    const v = meta[key];
    if (isNumberArray(v)) return null;
    if (Array.isArray(v) && v.some((s) => isNumberArray(s))) {
      const fallback = v.find((a) => isNumberArray(a)) as ArrayLike<number>;
      return Array.from({ length: count }, (_, s) => (isNumberArray(v[s]) ? (v[s] as ArrayLike<number>) : fallback));
    }
  }
  return null;
}

/** Per-meta scatter index: finite points per series and their x-sorted ids (built lazily). */
interface ScatterIndex {
  counts: number[];
  orders: (Uint32Array | undefined)[];
  ys: (Float64Array | undefined)[];
}
const scatterIndexCache = new WeakMap<object, ScatterIndex>();

const scatterValid = (d: A11yScatterData, i: number, seriesCount: number): boolean =>
  Number.isFinite(Number(d.x[i])) && Number.isFinite(Number(d.y[i])) && (d.series ? d.series[i] : 0) < seriesCount;

function scatterIndex(key: object, d: A11yScatterData, seriesCount: number): ScatterIndex {
  let idx = scatterIndexCache.get(key);
  if (idx) return idx;
  const counts = new Array<number>(seriesCount).fill(0);
  for (let i = 0; i < d.length; i++) if (scatterValid(d, i, seriesCount)) counts[d.series ? d.series[i] : 0]++;
  idx = { counts, orders: [], ys: [] };
  scatterIndexCache.set(key, idx);
  return idx;
}

/**
 * Point ids of one scatter series sorted by x (ties by id). Computed on first use and cached per
 * chart meta: O(n log n) once, e.g. a few hundred ms for 1,000,000 points.
 */
function scatterOrder(idx: ScatterIndex, d: A11yScatterData, series: number): Uint32Array {
  const cached = idx.orders[series];
  if (cached) return cached;
  const seriesCount = idx.counts.length;
  const order = new Uint32Array(idx.counts[series] ?? 0);
  let k = 0;
  for (let i = 0; i < d.length && k < order.length; i++) {
    if ((d.series ? d.series[i] : 0) === series && scatterValid(d, i, seriesCount)) order[k++] = i;
  }
  const x = d.x;
  order.sort((a, b) => Number(x[a]) - Number(x[b]) || a - b);
  idx.orders[series] = order;
  return order;
}

/**
 * Normalizes the SDK chart state. `meta` / `presentation` are typed loosely on purpose so new
 * chart fields do not break this module. Returns `null` for chart kinds it does not understand
 * or when there is no chart.
 *
 * `sample(id)` (backend `chart_sample`) supplies exact bar values when available.
 */
export function buildA11yModel(
  meta: unknown,
  presentation: unknown,
  sample?: (id: number) => ArrayLike<number> | undefined,
  /** Effective locale of spec formats (chart option, else `setLocale`) */
  locale?: string
): A11yChartModel | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Loose;
  const p = (presentation && typeof presentation === 'object' ? presentation : {}) as Loose;
  // Horizontal bars: the value axis is x, the category axis y (`xAxis` / `yAxis` below are the
  // category / value axis of every kind)
  const horizontal =
    (m.kind === 'bar' || m.kind === 'bar-multi') &&
    ((m.barStyle ?? {}) as Loose).orientation === 'horizontal';
  const xAxis = ((horizontal ? p.yAxis : p.xAxis) ?? {}) as Loose;
  const yAxis = ((horizontal ? p.xAxis : p.yAxis) ?? {}) as Loose;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  /** Axis `format`: function, or a spec / Intl options (chart-format.ts); invalid specs fall back */
  const axisFormat = (f: unknown): ((v: number) => string) | null => {
    if (typeof f === 'function') return f as (v: number) => string;
    if (typeof f !== 'string' && (!f || typeof f !== 'object')) return null;
    try {
      return createFormatter(f as string | Intl.NumberFormatOptions, locale ?? str(p.locale));
    } catch {
      return null;
    }
  };
  // Chart locale of built-in text and default number text
  const loc = locale ?? str(p.locale);
  const t = getMessages(loc).common;
  const num = (v: number, digits = 2) => formatNumber(v, loc, digits);
  const seriesName = (s: number) => t.seriesName(s + 1);
  const itemName = (i: number) => t.itemName(i + 1);
  const yFormat = axisFormat(yAxis.format);
  const formatXFn = typeof p.formatX === 'function' ? (p.formatX as (v: number) => string) : null;
  const formatValue = (v: number) => (Number.isFinite(v) ? (yFormat ? yFormat(v) : num(v)) : t.noData);
  const colors = (Array.isArray(m.colors) ? m.colors : []) as RgbaTuple[];
  const names = (Array.isArray(m.names) ? m.names : []) as string[];
  const visible = (Array.isArray(m.visible) ? m.visible : []) as boolean[];
  const gray: RgbaTuple = [0.5, 0.5, 0.5, 1];
  const common = {
    title: str(p.title),
    description: str(p.description),
    xTitle: str(xAxis.title),
    yTitle: str(yAxis.title),
    formatValue,
    ...(loc ? { locale: loc } : {}),
  };

  if (m.kind === 'treemap' || m.kind === 'sunburst' || m.kind === 'sankey') return hierarchyA11yModel(m, common);
  if (m.kind === 'scientific3d') return scientificA11yModel(m as unknown as Scientific3DMeta, common);

  if (m.kind === 'line') {
    const values = (Array.isArray(m.values) ? m.values : []) as ArrayLike<number>[];
    const offsets = (Array.isArray(m.offsets) ? m.offsets : []) as number[];
    const prefix = typeof m.xPrefix === 'string' ? m.xPrefix : 'T';
    const bands = (Array.isArray(m.bands) ? m.bands : []) as ({ lower: ArrayLike<number>; upper: ArrayLike<number> } | null)[];
    const series: A11ySeries[] = values.map((v, s) => ({
      name: names[s] ?? seriesName(s),
      values: isArrayLike(v) ? v : [],
      visible: visible[s] ?? true,
      f32: v instanceof Float32Array,
      ...(bands[s] ? { band: bands[s]! } : {}),
    }));
    const xOf = pickX(m);
    const xValue = (i: number, s = 0) => (xOf ? xOf(i, s) : i);
    const formatX = (x: number) => (formatXFn ? formatXFn(x) : `${prefix}+${num(x, 4)}`);
    const area = m.area;
    return {
      kind: 'line',
      ...common,
      ...(area === 'overlap' || area === 'stacked' || area === 'percent' ? { areaMode: area } : {}),
      ...(m.standaloneBand === true ? { standaloneBand: true } : {}),
      ...(m.sparse ? { sparse: m.sparse as SparseMeta } : {}),
      series,
      length: series.reduce((n, s) => Math.max(n, s.values.length), 0),
      seriesX: pickSeriesX(m, series.length),
      hasX: xOf !== null,
      xValue,
      formatX,
      xLabel: (i, s = 0) => formatX(xValue(i, s)),
      pointId: (s, i) => (offsets[s] ?? 0) + i,
      itemName: (s) => series[s]?.name ?? seriesName(s),
      itemColor: (s) => colors[s] ?? gray,
    };
  }

  if (m.kind === 'bar') {
    const metadata = (Array.isArray(m.metadata) ? m.metadata : []) as NodeMetadata[];
    const labels = metadata.map((d, i) => d?.label ?? itemName(i));
    const values = metadata.map((d, i) => {
      const exact = sample?.(i);
      if (exact && exact.length >= 3 && Number.isFinite(exact[2])) return f32ToShortest(exact[2]);
      const v = d?.attributes?.value;
      return typeof v === 'number' ? v : NaN;
    });
    return {
      kind: 'bar',
      ...common,
      series: [{ name: common.yTitle ?? t.value, values, visible: true, f32: false }],
      length: labels.length,
      xValue: (i) => labels[i] ?? String(i),
      xLabel: (i) => labels[i] ?? String(i),
      formatX: (x) => labels[x] ?? String(x),
      pointId: (_s, i) => i,
      itemName: (_s, i) => metadata[i]?.category ?? labels[i] ?? '',
      itemColor: (_s, i) => colors[i] ?? gray,
    };
  }

  if (m.kind === 'bar-multi') {
    const categories = (Array.isArray(m.categories) ? m.categories : []) as string[];
    const n = categories.length;
    const flat = isNumberArray(m.values) ? m.values : ([] as number[]);
    const seriesCount = Math.max(names.length, n > 0 ? Math.floor(flat.length / n) : 0);
    const f32 = flat instanceof Float32Array;
    const series: A11ySeries[] = Array.from({ length: n > 0 ? seriesCount : 0 }, (_, s) => ({
      name: names[s] ?? seriesName(s),
      values: ArrayBuffer.isView(flat)
        ? (flat as Float32Array).subarray(s * n, (s + 1) * n)
        : Array.prototype.slice.call(flat, s * n, (s + 1) * n),
      visible: visible[s] ?? true,
      f32,
    }));
    const label = (i: number) => categories[i] ?? itemName(i);
    const mode = m.mode === 'stacked' || m.mode === 'percent' ? m.mode : 'grouped';
    return {
      kind: 'bar-multi',
      ...common,
      series,
      length: n,
      barMode: mode,
      xValue: label,
      xLabel: label,
      formatX: label,
      pointId: (s, i) => s * n + i,
      itemName: (s) => series[s]?.name ?? seriesName(s),
      itemColor: (s) => colors[s] ?? gray,
    };
  }

  if (m.kind === 'combo') return comboA11yModel(m, p, common, gray);

  if (m.kind === 'candle') {
    // One row per candle; Open / High / Low / Close (/ Volume) are the table / CSV columns.
    // Keyboard focus moves per candle only (see `navigableSeries`): the engine hover reports
    // every candle as series 0, so the hit test ignores the series.
    const cols: [string, unknown][] = [
      [t.open, m.open],
      [t.high, m.high],
      [t.low, m.low],
      [t.close, m.close],
      ...(m.volume ? ([[t.volume, m.volume]] as [string, unknown][]) : []),
    ];
    const series: A11ySeries[] = cols.map(([name, v], k) => ({
      name,
      values: isNumberArray(v) ? v : [],
      visible: true,
      f32: v instanceof Float32Array,
      // Volume is a count, not a price: no y-axis format
      ...(k === CANDLE_VOLUME ? { format: (x: number) => (Number.isFinite(x) ? num(x) : t.noData) } : {}),
    }));
    const times = isNumberArray(m.t) ? m.t : null;
    const xValue = (i: number) => (times ? Number(times[i]) : i);
    const formatX = (x: number) => (formatXFn ? formatXFn(x) : num(x, 4));
    const up = colors[0] ?? gray;
    const down = colors[1] ?? up;
    const ohlcAt = (k: number, i: number) => modelValue(model, k, i);
    const model: A11yChartModel = {
      kind: 'candle',
      financialMode: m.mode === 'ohlc' ? 'ohlc' : 'candlestick',
      ...common,
      series,
      length: series[3]?.values.length ?? 0,
      seriesX: null,
      hasX: times !== null,
      xValue,
      formatX,
      xLabel: (i) => formatX(xValue(i)),
      pointId: (_s, i) => i,
      itemName: (s) => series[s]?.name ?? '',
      itemColor: (_s, i) => (ohlcAt(CANDLE_CLOSE, i) >= ohlcAt(0, i) ? up : down),
    };
    return model;
  }

  if (m.kind === 'heatmap') {
    const hm = m as unknown as HeatmapChartMeta;
    const rows = Math.max(0, Math.floor(Number(hm.rows) || 0));
    const cols = Math.max(0, Math.floor(Number(hm.cols) || 0));
    const values: ArrayLike<number> = isNumberArray(hm.values) ? hm.values : [];
    const f32 = values instanceof Float32Array;
    const num4 = (v: number) => num(v, 4);
    // Numeric axes use the author's tick format; categorical labels are shown in full
    const xFormat = axisFormat(xAxis.format);
    const fx = (hm.xExtent && xFormat) || num4;
    const fy = (hm.yExtent && yFormat) || num4;
    const meta: HeatmapChartMeta = {
      ...hm,
      rows,
      cols,
      xLabels: Array.isArray(hm.xLabels) ? hm.xLabels : null,
      yLabels: Array.isArray(hm.yLabels) ? hm.yLabels : null,
      xExtent: hm.xExtent ?? null,
      yExtent: hm.yExtent ?? null,
      rowTop: hm.rowTop !== false,
    };
    const colLabel = (c: number) => heatmapAxisLabel(meta.xLabels, meta.xExtent, cols, c, fx);
    const rowLabel = (r: number) => heatmapRowLabel(meta, r, fy);
    const value = (r: number, c: number) => {
      if (r < 0 || r >= rows || c < 0 || c >= cols) return NaN;
      const id = r * cols + c;
      const v = id < values.length ? Number(values[id]) : NaN;
      return f32 ? f32ToShortest(v) : v;
    };
    const heatmap: A11yHeatmapData = {
      rows,
      cols,
      rowTop: meta.rowTop,
      valueLabel: typeof hm.valueLabel === 'string' && hm.valueLabel ? hm.valueLabel : t.value,
      rowLabel,
      colLabel,
      value,
      stats: () => heatmapStats(m, values, rows * cols, f32),
    };
    return {
      kind: 'heatmap',
      ...common,
      // The y-axis format of a categorical heatmap maps row indices to labels, not values
      formatValue: (v) => (Number.isFinite(v) ? num4(v) : t.noData),
      series: [],
      length: rows * cols,
      heatmap,
      xValue: colLabel,
      xLabel: colLabel,
      formatX: colLabel,
      pointId: (r, c) => r * cols + c,
      itemName: () => heatmap.valueLabel,
      itemColor: () => gray,
    };
  }

  if (m.kind === 'box') {
    // One stop per (series, category) group; the series values are the group medians
    const { box, medians } = boxA11yData(m, loc);
    const series: A11ySeries[] = medians.map((v, s) => ({
      name: names[s] ?? seriesName(s),
      values: v,
      visible: visible[s] ?? true,
      f32: false,
    }));
    const n = box.categories.length;
    const label = (i: number) => box.categories[i] ?? itemName(i);
    return {
      kind: 'box',
      ...common,
      series,
      length: n,
      box,
      xValue: label,
      xLabel: label,
      formatX: label,
      pointId: (s, i) => s * n + i,
      itemName: (s) => series[s]?.name ?? seriesName(s),
      itemColor: (s) => colors[s] ?? gray,
    };
  }

  if (isBusinessKind(m.kind)) return businessA11yModel(m, common);

  if (m.kind === 'pie') {
    // Columns: value, then percent of the visible total (table / CSV; hidden = no percent)
    const values = (Array.isArray(m.values) ? m.values : []) as number[];
    const percents = (Array.isArray(m.percents) ? m.percents : []) as number[];
    const inputLabels = (Array.isArray(m.inputLabels) ? m.inputLabels : []) as string[];
    const other = (Array.isArray(m.other) ? m.other : []) as number[];
    const valueLabel = typeof m.valueLabel === 'string' && m.valueLabel ? m.valueLabel : t.value;
    const fmt = typeof m.format === 'function' ? (m.format as (v: number) => string) : null;
    const pie: A11yPieData = {
      names,
      values,
      percents,
      visible: names.map((_, k) => visible[k] ?? true),
      total: values.reduce((sum, v, k) => ((visible[k] ?? true) && Number.isFinite(v) ? sum + v : sum), 0),
      donut: Number(m.donut) > 0,
      otherSlice: (Array.isArray(m.sources) ? (m.sources as number[]) : []).indexOf(-1),
      otherMembers: other.map((i) => inputLabels[i] ?? itemName(i)),
    };
    const label = (i: number) => names[i] ?? itemName(i);
    return {
      kind: 'pie',
      ...common,
      formatValue: (v) => (Number.isFinite(v) ? (fmt ? fmt(v) : num(v)) : t.noData),
      series: [
        { name: valueLabel, values, visible: true, f32: false },
        {
          name: getMessages(loc).a11y.percentHeader,
          values: percents.map((p) => (Number.isFinite(p) ? Math.round(p * 100) / 100 : NaN)),
          visible: true,
          f32: false,
          format: (p) => (Number.isFinite(p) ? `${num(p, 1)}%` : t.hidden),
        },
      ],
      length: names.length,
      pie,
      xValue: label,
      xLabel: label,
      formatX: label,
      pointId: (_s, i) => i,
      itemName: (_s, i) => label(i),
      itemColor: (_s, i) => colors[i] ?? gray,
    };
  }

  if (m.kind === 'scatter') {
    if (!isNumberArray(m.x) || !isNumberArray(m.y)) return null;
    const ids = isNumberArray(m.series) ? m.series : null;
    const data: A11yScatterData = {
      x: m.x,
      y: m.y,
      series: ids,
      length: Math.min(m.x.length, m.y.length),
      f32: m.x instanceof Float32Array,
    };
    const seriesCount = Math.max(1, names.length);
    const idx = scatterIndex(m, data, seriesCount);
    const pointColors = isNumberArray(m.pointColors) ? m.pointColors : null;
    const fy = m.y instanceof Float32Array;
    const series: A11ySeries[] = Array.from({ length: seriesCount }, (_, s) => ({
      name: names[s] ?? seriesName(s),
      get values(): ArrayLike<number> {
        let ys = idx.ys[s];
        if (!ys) {
          const order = scatterOrder(idx, data, s);
          ys = new Float64Array(order.length);
          for (let k = 0; k < order.length; k++) ys[k] = Number(data.y[order[k]]);
          idx.ys[s] = ys;
        }
        return ys;
      },
      visible: visible[s] ?? true,
      f32: fy,
      count: idx.counts[s],
    }));
    const clean = (v: number) => (data.f32 ? f32ToShortest(v) : v);
    const formatX = (x: number) => (formatXFn ? formatXFn(x) : num(x, 4));
    const pointId = (s: number, i: number) => scatterOrder(idx, data, s)[i] ?? -1;
    return {
      kind: 'scatter',
      ...common,
      series,
      length: data.length,
      scatter: data,
      xValue: (i, s = 0) => clean(Number(data.x[pointId(s, i)])),
      xLabel: (i, s = 0) => formatX(clean(Number(data.x[pointId(s, i)]))),
      formatX,
      pointId,
      itemName: (s) => series[s]?.name ?? seriesName(s),
      itemColor: (s, id) =>
        pointColors && id * 4 + 3 < pointColors.length
          ? [pointColors[id * 4], pointColors[id * 4 + 1], pointColors[id * 4 + 2], pointColors[id * 4 + 3]]
          : (colors[s] ?? gray),
    };
  }
  return null;
}

/** Close column of a candle model (the series keyboard focus stays on). */
const CANDLE_CLOSE = 3;
/** Optional volume column of a candle model */
const CANDLE_VOLUME = 4;

const heatmapStatsCache = new WeakMap<object, A11yHeatmapStats>();

/** One pass over the grid per chart meta (16M cells: tens of ms, a11y text only). */
function heatmapStats(key: object, values: ArrayLike<number>, n: number, f32: boolean): A11yHeatmapStats {
  const cached = heatmapStatsCache.get(key);
  if (cached) return cached;
  let min = Infinity;
  let max = -Infinity;
  let minId = -1;
  let maxId = -1;
  let empty = Math.max(0, n - values.length);
  const end = Math.min(n, values.length);
  for (let i = 0; i < end; i++) {
    const v = values[i];
    if (!Number.isFinite(v)) {
      empty++;
      continue;
    }
    if (v < min) {
      min = v;
      minId = i;
    }
    if (v > max) {
      max = v;
      maxId = i;
    }
  }
  const clean = (v: number) => (f32 ? f32ToShortest(v) : v);
  const stats =
    minId < 0 ? { min: NaN, max: NaN, minId, maxId, empty } : { min: clean(min), max: clean(max), minId, maxId, empty };
  heatmapStatsCache.set(key, stats);
  return stats;
}

/** Navigable points of a series. */
const seriesLength = (s: A11ySeries | undefined): number => (s ? (s.count ?? s.values.length) : 0);

/** Reads one value of the model as a clean number (`NaN` = missing). */
export function modelValue(model: A11yChartModel, series: number, index: number): number {
  const s = model.series[series];
  if (!s || index < 0 || index >= seriesLength(s) || index >= s.values.length) return NaN;
  const v = Number(s.values[index]);
  return s.f32 ? f32ToShortest(v) : v;
}

/** Sum of the visible series at a category (stacked bars); `NaN` when none has a value. */
export function categoryTotal(model: A11yChartModel, index: number): number {
  let total = 0;
  let any = false;
  model.series.forEach((s, k) => {
    const v = modelValue(model, k, index);
    if (!s.visible || !Number.isFinite(v)) return;
    total += v;
    any = true;
  });
  return any ? total : NaN;
}

/** Finite min / max over arrays (`[NaN, NaN]` when empty). */
function extent(arrays: ArrayLike<number>[], clean: (v: number) => number = (v) => v): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      const v = Number(a[i]);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return min <= max ? [clean(min), clean(max)] : [NaN, NaN];
}

/** Line x extent over every series (sample indices for index placement). */
function lineXExtent(model: A11yChartModel): [number, number] {
  if (model.seriesX) return extent(model.seriesX);
  if (model.hasX) {
    const xs: number[] = [];
    for (let i = 0; i < model.length; i++) xs.push(Number(model.xValue(i)));
    return extent([xs]);
  }
  return model.length > 0 ? [0, model.length - 1] : [NaN, NaN];
}

// ---------------------------------------------------------------------------
// Summary / description text
// ---------------------------------------------------------------------------

export interface SeriesStats {
  /** Finite values */
  count: number;
  min: number;
  max: number;
  mean: number;
  minIndex: number;
  maxIndex: number;
  /** First / last finite value */
  first: number;
  last: number;
}

/**
 * Memo of the O(n) passes while one refresh builds the summary and the description (both read
 * the same series): `withPassMemo` scopes it, so data changed in place between refreshes is
 * never served stale. Keyed by the values array (and the f32 flag).
 */
let passMemo: WeakMap<object, Map<string, unknown>> | null = null;

function memoPass<T>(key: unknown, tag: string, compute: () => T): T {
  if (!passMemo || typeof key !== 'object' || key === null) return compute();
  let slots = passMemo.get(key);
  if (!slots) passMemo.set(key, (slots = new Map()));
  if (slots.has(tag)) return slots.get(tag) as T;
  const v = compute();
  slots.set(tag, v);
  return v;
}

/** Runs `fn` with the per-pass memo active (nested calls share the outer memo). */
export function withPassMemo<T>(fn: () => T): T {
  if (passMemo) return fn();
  passMemo = new WeakMap();
  try {
    return fn();
  } finally {
    passMemo = null;
  }
}

export function seriesStats(values: ArrayLike<number>, f32 = false): SeriesStats {
  return memoPass(values, f32 ? 'stats32' : 'stats', () => computeSeriesStats(values, f32));
}

function computeSeriesStats(values: ArrayLike<number>, f32: boolean): SeriesStats {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let minIndex = -1;
  let maxIndex = -1;
  let first = NaN;
  let last = NaN;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) continue;
    if (count === 0) first = v;
    last = v;
    count++;
    sum += v;
    if (v < min) {
      min = v;
      minIndex = i;
    }
    if (v > max) {
      max = v;
      maxIndex = i;
    }
  }
  const clean = (v: number) => (f32 ? f32ToShortest(v) : v);
  return count === 0
    ? { count: 0, min: NaN, max: NaN, mean: NaN, minIndex: -1, maxIndex: -1, first: NaN, last: NaN }
    : { count, min: clean(min), max: clean(max), mean: sum / count, minIndex, maxIndex, first: clean(first), last: clean(last) };
}

/** Built-in text in the model's locale. */
const messagesOf = (model: A11yChartModel) => getMessages(model.locale);

/** Share text with one decimal in the model's locale (`12.5%`). */
const percentText = (model: A11yChartModel, p: number) => `${formatNumber(p, model.locale, 1)}%`;

/** Series listed by name in the short summary before collapsing into "and N more". */
const SUMMARY_SERIES_LIMIT = 5;

/** Summary chart name of each multi-series bar layout. */
const BAR_MODE_CHART = { grouped: 'groupedBar', stacked: 'stackedBar', percent: 'percentBar' } as const;

/** Per-series fragments of the short summary, capped at `SUMMARY_SERIES_LIMIT`. */
function summaryParts(model: A11yChartModel, part: (s: A11ySeries, index: number) => string): string[] {
  const parts = model.series.slice(0, SUMMARY_SERIES_LIMIT).map(part);
  const more = model.series.length - SUMMARY_SERIES_LIMIT;
  if (more > 0) parts.push(messagesOf(model).common.andMore(formatCount(more, model.locale)));
  return parts;
}

/** Scatter extents over finite points of every series. */
function scatterExtent(model: A11yChartModel): { x: [number, number]; y: [number, number] } {
  return memoPass(model.scatter, 'extent', () => computeScatterExtent(model));
}

function computeScatterExtent(model: A11yChartModel): { x: [number, number]; y: [number, number] } {
  const d = model.scatter!;
  const seriesCount = model.series.length;
  let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < d.length; i++) {
    if (!scatterValid(d, i, seriesCount)) continue;
    const x = Number(d.x[i]);
    const y = Number(d.y[i]);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const c = (v: number) => (d.f32 ? f32ToShortest(v) : v);
  return x0 <= x1 ? { x: [c(x0), c(x1)], y: [c(y0), c(y1)] } : { x: [NaN, NaN], y: [NaN, NaN] };
}

/**
 * Short summary used as the canvas `aria-label`, e.g.
 * `Line chart, 4 series, 5,000 points; AI-Inference-RPS ranges 52.6–247.1; ...`
 */
export function buildChartSummary(model: A11yChartModel): string {
  if (model.custom) return model.custom.summary();
  if (model.kind === 'box' && model.box) return boxSummary(model);
  if (model.kind === 'combo' && model.combo) return comboSummary(model);
  const body = summaryBody(model);
  return model.title ? messagesOf(model).a11y.titled(model.title, body) : body;
}

/** Summary sentence of the built-in chart kinds (without the title). */
function summaryBody(model: A11yChartModel): string {
  const { common: c, a11y: t } = messagesOf(model);
  const n = (v: number) => formatCount(v, model.locale);
  const f = model.formatValue;
  if (model.kind === 'heatmap' && model.heatmap) {
    const h = model.heatmap;
    const st = h.stats();
    const values = Number.isFinite(st.min) ? t.valueRange(c.range(f(st.min), f(st.max))) : t.noValues;
    return t.sentence([
      t.chart.heatmap,
      t.gridSize(t.rows(h.rows, n(h.rows)), t.columns(h.cols, n(h.cols))),
      st.empty > 0 ? t.paren(values, t.emptyCells(st.empty, n(st.empty))) : values,
    ]);
  }
  if (model.kind === 'pie' && model.pie) {
    const p = model.pie;
    const shown = pieOrder(p);
    // Largest shares first (top 3)
    const top = [...shown].sort((a, b) => p.values[b] - p.values[a] || a - b).slice(0, 3);
    const parts = top.map((k) => `${p.names[k]} ${percentText(model, p.percents[k])}`);
    const more = shown.length - top.length;
    if (more > 0) parts.push(c.andMore(n(more)));
    const hidden = p.names.length - p.visible.filter(Boolean).length;
    const slices = t.slices(p.names.length, n(p.names.length));
    return t.sentence(
      [p.donut ? t.chart.donut : t.chart.pie, hidden > 0 ? t.paren(slices, t.hiddenCount(n(hidden))) : slices, t.total(f(p.total))],
      parts
    );
  }
  if (model.kind === 'line' || model.kind === 'candle') {
    const points = model.series.reduce((k, s) => k + s.values.length, 0);
    const parts = summaryParts(model, (s) => {
      if (model.standaloneBand && s.band) {
        const a = seriesStats(s.band.lower, true), b = seriesStats(s.band.upper, true);
        return a.count || b.count ? t.seriesRange(s.name, c.range(f(Math.min(a.min, b.min)), f(Math.max(a.max, b.max)))) : t.seriesNoData(s.name);
      }
      const st = seriesStats(s.values, s.f32);
      const fs = s.format ?? f;
      return st.count ? t.seriesRange(s.name, c.range(fs(st.min), fs(st.max))) : t.seriesNoData(s.name);
    });
    if (model.kind === 'candle') return model.financialMode === 'ohlc'
      ? t.sentence([t.chart.ohlc, t.bars(model.length, n(model.length))], parts)
      : t.sentence([t.chart.candlestick, t.candles(model.length, n(model.length))], parts);
    const kind = model.sparse ? (model.sparse.kind === 'errorBar' ? t.chart.errorBar : t.chart.impulse) : model.standaloneBand ? t.chart.band : model.areaMode ? t.chart[AREA_MODE_CHART[model.areaMode]] : t.chart.line;
    return t.sentence([kind, c.seriesCount(model.series.length, n(model.series.length)), c.points(points, n(points))], parts);
  }
  if (model.kind === 'bar-multi') {
    const parts = summaryParts(model, (s) => {
      const st = seriesStats(s.values, s.f32);
      return st.count ? t.seriesRange(s.name, c.range(f(st.min), f(st.max))) : t.seriesNoData(s.name);
    });
    return t.sentence(
      [
        t.chart[BAR_MODE_CHART[model.barMode ?? 'grouped']],
        c.categories(model.length, n(model.length)),
        c.seriesCount(model.series.length, n(model.series.length)),
      ],
      parts
    );
  }
  if (model.kind === 'scatter') {
    const points = model.series.reduce((k, s) => k + seriesLength(s), 0);
    const ext = scatterExtent(model);
    const range = Number.isFinite(ext.x[0])
      ? [t.scatterRange(c.range(model.formatX(ext.x[0]), model.formatX(ext.x[1])), c.range(f(ext.y[0]), f(ext.y[1])))]
      : [];
    const parts = model.series.length > 1 ? summaryParts(model, (s) => `${s.name} ${c.points(seriesLength(s), n(seriesLength(s)))}`) : [];
    return t.sentence(
      [t.chart.scatter, c.seriesCount(model.series.length, n(model.series.length)), c.points(points, n(points))],
      [...range, ...parts]
    );
  }
  const s = model.series[0];
  const st = seriesStats(s?.values ?? []);
  const range = st.count > 0 ? [t.barRange(f(st.min), model.xLabel(st.minIndex), f(st.max), model.xLabel(st.maxIndex))] : [];
  return t.sentence([t.chart.bar, c.categories(model.length, n(model.length))], range);
}

/** Keyboard help text per chart kind (`ohlc`: OHLC bars instead of candles). */
export function keyboardHelp(kind: A11yChartKind, locale?: string, ohlc = false): string {
  const k = getMessages(locale).a11y.keyboard;
  switch (kind) {
    case 'bar':
      return k.bar;
    case 'bar-multi':
    case 'box':
    case 'combo':
      return k.categories;
    case 'scatter':
      return k.scatter;
    case 'candle':
      return ohlc ? k.ohlc : k.candle;
    case 'pie':
      return k.pie;
    case 'heatmap':
      return k.heatmap;
    default:
      return k.default;
  }
}

/** Longer description (`aria-describedby`): axes, per-series statistics, keyboard help. */
export function buildChartDescription(model: A11yChartModel): string {
  const { common: c, a11y: t } = messagesOf(model);
  const n = (v: number) => formatCount(v, model.locale);
  const f = model.formatValue;
  const out: string[] = [];
  if (model.description) out.push(model.description);
  if (model.custom) {
    out.push(...model.custom.description(), model.custom.help);
    return t.join(out);
  }
  /** Series name, marked when hidden */
  const named = (s: A11ySeries) => (s.visible ? s.name : t.paren(s.name, c.hidden));
  if (model.kind === 'combo' && model.combo) {
    out.push(...comboDescription(model));
  } else if (model.kind === 'box' && model.box) {
    out.push(...boxDescription(model));
  } else if (model.kind === 'heatmap' && model.heatmap) {
    const h = model.heatmap;
    const st = h.stats();
    const cellName = (id: number) => t.cell(h.rowLabel(Math.floor(id / h.cols)), h.colLabel(id % h.cols));
    const rows = t.rows(h.rows, n(h.rows));
    const cols = t.columns(h.cols, n(h.cols));
    out.push(h.rows > 0 ? t.heatmapRows(rows, model.yTitle, h.rowLabel(0), h.rowLabel(h.rows - 1)) : t.heatmapRows(rows, model.yTitle));
    out.push(h.cols > 0 ? t.heatmapColumns(cols, model.xTitle, h.colLabel(0), h.colLabel(h.cols - 1)) : t.heatmapColumns(cols, model.xTitle));
    out.push(
      Number.isFinite(st.min)
        ? t.heatmapExtremes(h.valueLabel, f(st.min), cellName(st.minId), f(st.max), cellName(st.maxId))
        : t.labelled(h.valueLabel, c.noData)
    );
    if (st.empty > 0) out.push(t.sentence([t.emptyCells(st.empty, n(st.empty))]));
  } else if (model.kind === 'pie' && model.pie) {
    const p = model.pie;
    p.names.forEach((name, k) => {
      out.push(t.sliceLine(name, f(p.values[k]), p.visible[k] ? percentText(model, p.percents[k]) : c.hidden));
    });
    if (p.otherSlice >= 0) out.push(t.otherCombines(p.names[p.otherSlice], p.otherMembers.join(c.listSeparator)));
  } else if (model.kind === 'line' || model.kind === 'candle') {
    // Series may have different x arrays: the range spans every series
    const [x0, x1] = lineXExtent(model);
    out.push(Number.isFinite(x0) ? t.axisRange(c.xAxis, model.xTitle, model.formatX(x0), model.formatX(x1)) : t.axisRange(c.xAxis, model.xTitle));
    if (model.yTitle) out.push(t.axisTitle(c.yAxis, model.yTitle));
    model.series.forEach((s, k) => {
      const f = s.format ?? model.formatValue;
      if (model.standaloneBand && s.band) {
        const edge = (e: SeriesStats) => (e.count ? c.range(f(e.min), f(e.max)) : c.noData);
        out.push(t.bandEdges(named(s), edge(seriesStats(s.band.lower, true)), edge(seriesStats(s.band.upper, true))));
        return;
      }
      const st = seriesStats(s.values, s.f32);
      if (!st.count) {
        out.push(t.labelled(s.name, c.noData));
        return;
      }
      const trend = st.last > st.first ? t.trend.rising : st.last < st.first ? t.trend.falling : t.trend.flat;
      out.push(
        t.lineStats(
          named(s),
          t.values(st.count, n(st.count)),
          f(st.min),
          model.xLabel(st.minIndex, k),
          f(st.max),
          model.xLabel(st.maxIndex, k),
          f(st.mean),
          f(st.first),
          f(st.last),
          trend
        )
      );
    });
  } else if (model.kind === 'bar-multi') {
    if (model.xTitle) out.push(t.axisTitle(c.xAxis, model.xTitle));
    if (model.yTitle) out.push(t.axisTitle(c.yAxis, model.yTitle));
    out.push(t.barLayout(c.categories(model.length, n(model.length)), t.barMode[model.barMode ?? 'grouped']));
    model.series.forEach((s) => {
      const st = seriesStats(s.values, s.f32);
      out.push(
        st.count
          ? t.barStats(named(s), model.xLabel(st.maxIndex), f(st.max), model.xLabel(st.minIndex), f(st.min), f(st.mean))
          : t.labelled(s.name, c.noData)
      );
    });
  } else if (model.kind === 'scatter') {
    const ext = scatterExtent(model);
    out.push(Number.isFinite(ext.x[0]) ? t.axisRange(c.xAxis, model.xTitle, model.formatX(ext.x[0]), model.formatX(ext.x[1])) : t.axisRange(c.xAxis, model.xTitle));
    out.push(Number.isFinite(ext.y[0]) ? t.axisRange(c.yAxis, model.yTitle, f(ext.y[0]), f(ext.y[1])) : t.axisRange(c.yAxis, model.yTitle));
    model.series.forEach((s) => {
      out.push(t.labelled(named(s), c.points(seriesLength(s), n(seriesLength(s)))));
    });
  } else {
    const st = seriesStats(model.series[0]?.values ?? []);
    if (model.xTitle) out.push(t.axisTitle(c.xAxis, model.xTitle));
    if (model.yTitle) out.push(t.axisTitle(c.yAxis, model.yTitle));
    if (st.count) {
      out.push(
        t.barStats(c.categories(model.length, n(model.length)), model.xLabel(st.maxIndex), f(st.max), model.xLabel(st.minIndex), f(st.min), f(st.mean))
      );
    }
  }
  out.push(keyboardHelp(model.kind, model.locale, model.financialMode === 'ohlc'));
  return t.join(out);
}

// ---------------------------------------------------------------------------
// Keyboard navigation (pure step logic)
// ---------------------------------------------------------------------------

export interface A11yFocus {
  series: number;
  /** Sample / category index; scatter: rank in the series' x order */
  index: number;
}

/** Visible series that have at least one sample (bar: the single value series). */
function navigableSeries(model: A11yChartModel): number[] {
  // Candles: one stop per candle (focus stays on the Close column)
  if (model.kind === 'candle') return seriesLength(model.series[CANDLE_CLOSE]) > 0 ? [CANDLE_CLOSE] : [];
  const out: number[] = [];
  model.series.forEach((s, i) => {
    if (s.visible && seriesLength(s) > 0) out.push(i);
  });
  return out;
}

/**
 * Next focused point for `key` (`KeyboardEvent.key`), or `null` when the key is not handled.
 * Left / Right: ±1, PageUp / PageDown: ±10 (ARIA slider convention: PageUp moves forward),
 * Home / End: first / last, Up / Down: previous / next visible series (same index, clamped).
 * Hidden series are skipped; with no focus yet any handled key lands on the first point.
 */
export function stepFocus(model: A11yChartModel, focus: A11yFocus | null, key: string): A11yFocus | null {
  const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
  if (!handled.includes(key)) return null;
  if (model.kind === 'heatmap') return stepHeatmapFocus(model, focus, key);
  if (model.kind === 'pie') return stepPieFocus(model, focus, key);
  if (model.custom?.step) return model.custom.step(focus, key);
  const order = navigableSeries(model);
  if (order.length === 0) return null;
  let slot = focus ? order.indexOf(focus.series) : -1;
  if (slot < 0) {
    // No focus yet, or its series was hidden: start on the first visible series
    if (!focus) return { series: order[0], index: key === 'End' ? seriesLength(model.series[order[0]]) - 1 : 0 };
    slot = 0;
  }
  let series = order[slot];
  let index = focus ? focus.index : 0;
  switch (key) {
    case 'ArrowLeft':
      index -= 1;
      break;
    case 'ArrowRight':
      index += 1;
      break;
    case 'PageUp':
      index += 10;
      break;
    case 'PageDown':
      index -= 10;
      break;
    case 'Home':
      index = 0;
      break;
    case 'End':
      index = Infinity;
      break;
    case 'ArrowUp':
      if (order.length < 2) return null;
      series = order[(slot - 1 + order.length) % order.length];
      break;
    case 'ArrowDown':
      if (order.length < 2) return null;
      series = order[(slot + 1) % order.length];
      break;
  }
  const len = seriesLength(model.series[series]);
  return { series, index: Math.max(0, Math.min(len - 1, index)) };
}

/** Displayed slices that are visible and non-empty (drawing order). */
function pieOrder(p: A11yPieData): number[] {
  const out: number[] = [];
  p.names.forEach((_, k) => {
    if (p.visible[k] && p.values[k] > 0) out.push(k);
  });
  return out;
}

/** Pie slice focus (`index` = slice): Left / Right step over visible slices, Up / Down do too. */
function stepPieFocus(model: A11yChartModel, focus: A11yFocus | null, key: string): A11yFocus | null {
  const order = model.pie ? pieOrder(model.pie) : [];
  if (order.length === 0) return null;
  let slot = focus ? order.indexOf(focus.index) : -1;
  if (slot < 0) return { series: 0, index: order[key === 'End' ? order.length - 1 : 0] };
  switch (key) {
    case 'ArrowLeft':
    case 'ArrowUp':
      slot -= 1;
      break;
    case 'ArrowRight':
    case 'ArrowDown':
      slot += 1;
      break;
    case 'PageUp':
      slot += 10;
      break;
    case 'PageDown':
      slot -= 10;
      break;
    case 'Home':
      slot = 0;
      break;
    case 'End':
      slot = order.length - 1;
      break;
  }
  return { series: 0, index: order[Math.max(0, Math.min(order.length - 1, slot))] };
}

/** Heatmap cell focus (`series` = row, `index` = column); Up / Down follow the drawn row order. */
function stepHeatmapFocus(model: A11yChartModel, focus: A11yFocus | null, key: string): A11yFocus | null {
  const h = model.heatmap;
  if (!h || h.rows < 1 || h.cols < 1) return null;
  if (!focus) return { series: 0, index: key === 'End' ? h.cols - 1 : 0 };
  let row = focus.series;
  let col = focus.index;
  const up = h.rowTop ? -1 : 1;
  switch (key) {
    case 'ArrowLeft':
      col -= 1;
      break;
    case 'ArrowRight':
      col += 1;
      break;
    case 'PageUp':
      col += 10;
      break;
    case 'PageDown':
      col -= 10;
      break;
    case 'Home':
      col = 0;
      break;
    case 'End':
      col = h.cols - 1;
      break;
    case 'ArrowUp':
      row += up;
      break;
    case 'ArrowDown':
      row -= up;
      break;
  }
  const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  return { series: clamp(row, h.rows), index: clamp(col, h.cols) };
}

/** Summary chart name of each area mode. */
const AREA_MODE_CHART = { overlap: 'area', stacked: 'stackedArea', percent: 'percentArea' } as const;

/** Stacking mode of a model (stacked bars / stacked areas share totals and shares). */
function stackMode(model: A11yChartModel): 'stacked' | 'percent' | undefined {
  const mode = model.kind === 'bar-multi' ? model.barMode : model.kind === 'line' ? model.areaMode : undefined;
  return mode === 'stacked' || mode === 'percent' ? mode : undefined;
}

/** Live-region text for a point, e.g. `T+120, AI-Inference-RPS 135.9` / `Q3, 42`. */
export function pointAnnouncement(model: A11yChartModel, focus: A11yFocus): string {
  if (model.custom) return model.custom.announce(focus);
  if (model.kind === 'box' && model.box) return boxAnnouncement(model, focus);
  if (model.kind === 'combo' && model.combo) return comboAnnouncement(model, focus, model.formatValue(modelValue(model, focus.series, focus.index)));
  const { common: c, a11y: t } = messagesOf(model);
  /** Text followed by the 1-based position of `index` among `count` stops */
  const at = (text: string, index: number, count: number) =>
    t.join([text, c.position(formatCount(index + 1, model.locale), formatCount(count, model.locale))]);
  if (model.kind === 'heatmap' && model.heatmap) {
    const h = model.heatmap;
    const v = h.value(focus.series, focus.index);
    return t.labelled(t.cell(h.rowLabel(focus.series), h.colLabel(focus.index)), Number.isFinite(v) ? model.formatValue(v) : c.empty);
  }
  if (model.kind === 'pie' && model.pie) {
    const p = model.pie;
    const order = pieOrder(p);
    const k = focus.index;
    return at(t.slicePoint(p.names[k] ?? '', model.formatValue(p.values[k]), percentText(model, p.percents[k])), order.indexOf(k), order.length);
  }
  if (model.kind === 'candle') {
    const v = (k: number) => model.formatValue(modelValue(model, k, focus.index));
    const vol = model.series[CANDLE_VOLUME];
    const volume = vol ? (vol.format ?? model.formatValue)(modelValue(model, CANDLE_VOLUME, focus.index)) : undefined;
    return at(t.ohlcPoint(model.xLabel(focus.index), v(0), v(1), v(2), v(CANDLE_CLOSE), volume), focus.index, model.length);
  }
  const value = model.formatValue(modelValue(model, focus.series, focus.index));
  const s = model.series[focus.series];
  const name = s?.name ?? '';
  const x = model.xLabel(focus.index, focus.series);
  if (model.sparse) {
    const info = sparseTooltip(model.sparse, focus.series, focus.index);
    const e = info.errorBar;
    const text = e
      ? t.errorBarPoint(x, name, value, model.formatValue(e.low), model.formatValue(e.high), t.direction[e.direction])
      : t.impulsePoint(x, name, value, model.formatValue(info.baseline!));
    return at(text, focus.index, model.length);
  }
  if (model.standaloneBand && s?.band) {
    const lo = Number(s.band.lower[focus.index]), hi = Number(s.band.upper[focus.index]);
    return t.bandPoint(x, name, model.formatValue(lo), model.formatValue(hi));
  }
  if (model.kind === 'bar') return at(t.barPoint(model.xLabel(focus.index), value), focus.index, model.length);
  if (model.kind === 'scatter') {
    return at(t.scatterPoint(name, model.xTitle ?? 'x', x, model.yTitle ?? 'y', value), focus.index, seriesLength(s));
  }
  // Multi-series bars: stacked total; lines / areas: stacked area total
  const total = stackMode(model) === 'stacked' ? categoryTotal(model, focus.index) : NaN;
  const text = t.seriesPoint(x, name, value);
  const withTotal = Number.isFinite(total) ? t.join([text, t.totalPoint(model.formatValue(total))]) : text;
  return model.kind === 'bar-multi' ? at(withTotal, focus.index, model.length) : withTotal;
}

// ---------------------------------------------------------------------------
// Data table / CSV
// ---------------------------------------------------------------------------

export type ChartDataCell = string | number | null;

export interface ChartDataTable {
  /** Header row: x / category column first, then one column per series */
  columns: string[];
  rows: ChartDataCell[][];
  /** Rows before downsampling */
  totalRows: number;
  /** True when `rows` is an evenly spaced subset (see `maxRows`) */
  sampled: boolean;
  /** Heatmap: value columns before downsampling */
  totalColumns?: number;
  /** Heatmap: the value columns are an evenly spaced subset (see `maxColumns`) */
  sampledColumns?: boolean;
  /** Box plot: text of numeric cells per column (default: the value format) */
  formats?: (((value: number) => string) | undefined)[];
}

export interface DataTableOptions {
  /** Rendered table rows; longer data is downsampled evenly incl. first / last (default: 1000) */
  maxRows?: number;
  /** Heatmap value columns; wider grids are downsampled evenly incl. first / last (default: 50) */
  maxColumns?: number;
}

/** Evenly spaced row indices (first and last included); all indices when `n <= maxRows`. */
export function sampleRowIndices(n: number, maxRows: number): number[] {
  const m = Math.max(1, Math.floor(maxRows));
  if (n <= m) return Array.from({ length: n }, (_, i) => i);
  if (m === 1) return [0];
  const out: number[] = [];
  for (let k = 0; k < m; k++) out.push(Math.round((k * (n - 1)) / (m - 1)));
  return out;
}

/** Sorted unique finite x values over every array. */
export function mergeXAxis(arrays: ArrayLike<number>[]): Float64Array {
  let total = 0;
  for (const a of arrays) total += a.length;
  const all = new Float64Array(total);
  let k = 0;
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) {
      const v = Number(a[i]);
      if (Number.isFinite(v)) all[k++] = v;
    }
  }
  const sorted = all.subarray(0, k).sort();
  let m = 0;
  for (let i = 0; i < k; i++) if (m === 0 || sorted[i] !== sorted[m - 1]) sorted[m++] = sorted[i];
  return sorted.slice(0, m);
}

/** Index of the first sample at exactly `x` (-1 if none); binary search when `xs` is ascending. */
function xLookup(xs: ArrayLike<number>): (x: number) => number {
  // Non-finite x breaks the binary search: those arrays use the map
  let ascending = xs.length === 0 || Number.isFinite(Number(xs[0]));
  for (let i = 1; i < xs.length && ascending; i++) {
    const v = Number(xs[i]);
    ascending = Number.isFinite(v) && v >= Number(xs[i - 1]);
  }
  if (ascending) {
    return (x) => {
      let lo = 0;
      let hi = xs.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (Number(xs[mid]) < x) lo = mid + 1;
        else hi = mid;
      }
      return lo < xs.length && Number(xs[lo]) === x ? lo : -1;
    };
  }
  const map = new Map<number, number>();
  for (let i = xs.length - 1; i >= 0; i--) map.set(Number(xs[i]), i);
  return (x) => map.get(x) ?? -1;
}

/** True when every series has the same x values (rows can stay index-aligned). */
function sharedX(arrays: ArrayLike<number>[]): boolean {
  const a = arrays[0];
  return arrays.every((b) => {
    if (b === a) return true;
    if (b.length !== a.length) return false;
    for (let i = 0; i < a.length; i++) if (Number(a[i]) !== Number(b[i])) return false;
    return true;
  });
}

/**
 * Tabular view of the chart (wide format: one column per series).
 * - line: rows = x positions. With different x arrays per series the rows are the merged x
 *   axis (sorted union of every series' x); a series has a cell only where it has a sample at
 *   exactly that x (no interpolation / nearest matching; duplicate x keep the first sample).
 *   x cells hold the formatted x label (`T+120`).
 * - bar / bar-multi: rows = categories (stacked bars add a `Total` of the visible series).
 * - scatter: rows = points in data order; columns x, y (raw numbers), series name.
 * - heatmap: rows = grid rows (row label first), columns = grid columns (column labels).
 * Missing values are `null`; `maxRows` downsamples rows evenly (first / last kept), `maxColumns`
 * the heatmap columns (a 4096 x 4096 grid is never materialized for the DOM table).
 */
export function buildDataTable(model: A11yChartModel, maxRows = Infinity, maxColumns = Infinity): ChartDataTable {
  const pick = (n: number, max = maxRows) => sampleRowIndices(n, Number.isFinite(max) ? max : n || 1);
  const cell = (v: number): ChartDataCell => (Number.isFinite(v) ? v : null);
  const { common: c, a11y: t } = messagesOf(model);

  if (model.kind === 'heatmap' && model.heatmap) {
    const h = model.heatmap;
    const rowIdx = pick(h.rows);
    const colIdx = pick(h.cols, maxColumns);
    const columns = [model.yTitle ?? c.row, ...colIdx.map(h.colLabel)];
    const rows = rowIdx.map((r) => [h.rowLabel(r), ...colIdx.map((c) => cell(h.value(r, c)))]);
    return {
      columns,
      rows,
      totalRows: h.rows,
      sampled: rowIdx.length < h.rows,
      totalColumns: h.cols,
      sampledColumns: colIdx.length < h.cols,
    };
  }

  if (model.kind === 'box' && model.box) return boxDataTable(model, (n) => pick(n));
  if (model.custom?.table) return model.custom.table((n) => pick(n));

  if (model.kind === 'scatter' && model.scatter) {
    const d = model.scatter;
    const clean = (v: number) => (d.f32 ? f32ToShortest(v) : v);
    const fy = model.series[0]?.f32 ?? false;
    const indices = pick(d.length);
    const rows = indices.map((i) => {
      const s = d.series ? d.series[i] : 0;
      const y = Number(d.y[i]);
      return [cell(clean(Number(d.x[i]))), cell(fy ? f32ToShortest(y) : y), model.series[s]?.name ?? c.seriesName(s + 1)];
    });
    const columns = [model.xTitle ?? 'X', model.yTitle ?? 'Y', c.series];
    return { columns, rows, totalRows: d.length, sampled: indices.length < d.length };
  }

  const xHeader =
    model.xTitle ?? model.custom?.xHeader ?? (model.kind === 'line' || model.kind === 'candle' ? 'X' : model.kind === 'pie' ? t.sliceHeader : c.category);
  const total = stackMode(model) === 'stacked';
  // Band series add `lower` / `upper` columns right after their value column
  const columns = [
    xHeader,
    ...model.series.flatMap((s) => model.sparse ? [s.name, ...(model.sparse.kind === 'errorBar' ? [t.lowColumn(s.name), t.highColumn(s.name)] : [t.baselineColumn(s.name)])] : (s.band ? [...(model.standaloneBand ? [] : [s.name]), t.lowerColumn(s.name), t.upperColumn(s.name)] : [s.name])),
    ...(total ? [c.total] : []),
  ];
  const bandCells = (row: ChartDataCell[], s: number, i: number) => {
    if (model.sparse) {
      const info = sparseTooltip(model.sparse, s, i);
      if (info.errorBar) row.push(cell(f32ToShortest(info.errorBar.low)), cell(f32ToShortest(info.errorBar.high)));
      else row.push(i >= 0 && i < model.series[s].values.length ? cell(info.baseline!) : null);
      return;
    }
    const b = model.series[s]?.band;
    if (!b) return;
    const at = (a: ArrayLike<number>) => (i >= 0 && i < a.length ? cell(f32ToShortest(Number(a[i]))) : null);
    row.push(at(b.lower), at(b.upper));
  };

  const xs = model.kind === 'line' ? model.seriesX : null;
  if (xs && xs.length > 1 && !sharedX(xs)) {
    const merged = mergeXAxis(xs);
    const lookups = xs.map(xLookup);
    const indices = pick(merged.length);
    const rows = indices.map((u) => {
      const x = merged[u];
      const row: ChartDataCell[] = [model.formatX(x)];
      lookups.forEach((find, s) => {
        const i = find(x);
        if (!model.standaloneBand) row.push(cell(modelValue(model, s, i)));
        bandCells(row, s, i);
      });
      return row;
    });
    return { columns, rows, totalRows: merged.length, sampled: indices.length < merged.length };
  }

  const indices = pick(model.length);
  const rows = indices.map((i) => {
    const row: ChartDataCell[] = [model.xLabel(i)];
    model.series.forEach((_, s) => {
      if (!model.standaloneBand) row.push(cell(modelValue(model, s, i)));
      bandCells(row, s, i);
    });
    if (total) row.push(cell(categoryTotal(model, i)));
    return row;
  });
  return { columns, rows, totalRows: model.length, sampled: indices.length < model.length };
}

/** RFC 4180 field; text that a spreadsheet would run as a formula gets a leading `'`. */
export function csvField(v: ChartDataCell): string {
  if (v === null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = v;
  if (/^[=+\-@\t\r]/.test(s) && !Number.isFinite(Number(s))) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tableToCSV(table: Pick<ChartDataTable, 'columns' | 'rows'>): string {
  return [table.columns, ...table.rows].map((r) => r.map(csvField).join(',')).join('\r\n');
}

/** Full heatmap CSV (same layout as `buildDataTable`), written row by row without a cell table. */
export function heatmapToCSV(model: A11yChartModel): string {
  const h = model.heatmap;
  if (!h) return '';
  const header = [model.yTitle ?? messagesOf(model).common.row];
  for (let c = 0; c < h.cols; c++) header.push(h.colLabel(c));
  const lines = [header.map(csvField).join(',')];
  for (let r = 0; r < h.rows; r++) {
    let line = csvField(h.rowLabel(r));
    for (let c = 0; c < h.cols; c++) {
      const v = h.value(r, c);
      line += Number.isFinite(v) ? `,${v}` : ',';
    }
    lines.push(line);
  }
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// DOM controller
// ---------------------------------------------------------------------------

/** Snapshot of SDK state the controller reads lazily (the SDK owns all of it). */
export interface ChartA11yHostState {
  canvas: HTMLCanvasElement | null;
  /** Chart overlay root (legend lives inside) */
  overlay: HTMLElement | null;
  meta: unknown;
  presentation: unknown;
  /** Effective chart locale (spec formats in a11y text / tables) */
  locale?: string;
  theme: CharturboTheme;
  backend: Pick<WasmCharturboEngineBackend, 'project_node_to_ndc' | 'chart_hover_at_ndc' | 'chart_clear_hover' | 'chart_sample'>;
  details(id: number): NodeDetails | null;
  /**
   * Pointer-path tooltip of an engine hit for charts whose keyboard tooltip is the same
   * (candlestick: OHLC of the candle or zoomed-out bucket; heatmap: cell with its displayed
   * color). `null` / absent = built from the model (`tooltipContext`).
   */
  chartTooltip?(hit: Float64Array): ChartTooltipContext | null;
  render(): void;
  /**
   * Compact charts (sparklines): the canvas only gets `role="img"` + this `aria-label`; no
   * description / live region DOM, not focusable. `null` / absent = full chart a11y.
   */
  label?: string | null;
}

/** Tooltip hook installed by `enableNodeInteractions` (`null` ctx hides it). */
export type ChartA11yTooltipHook = (ctx: ChartTooltipContext | null, clientX: number, clientY: number) => void;

let a11yIdSeq = 0;
const STYLE_ID = 'charturbo-sdk-a11y-style';

/** Focus ring + forced-colors (Windows High Contrast) rules; no transitions or animations. */
const A11Y_CSS = `
.charturbo-sdk-a11y-canvas:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
@media (forced-colors: active) {
  .charturbo-sdk-a11y-canvas:focus-visible { outline-color: Highlight; }
  .charturbo-sdk-legend-item { color: CanvasText; }
  .charturbo-sdk-legend-swatch { forced-color-adjust: none; border: 1px solid CanvasText; }
  .charturbo-sdk-legend-item[aria-pressed="false"] .charturbo-sdk-legend-swatch { border-style: dashed; }
  .charturbo-sdk-node-tooltip { border: 1px solid CanvasText !important; }
  .charturbo-sdk-data-table th, .charturbo-sdk-data-table td { border: 1px solid CanvasText !important; }
}`;

const SR_ONLY: Partial<CSSStyleDeclaration> = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  padding: '0',
  margin: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: '0',
};

export function forcedColorsActive(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(forced-colors: active)').matches;
}

const CANVAS_ATTRS = ['role', 'aria-label', 'aria-describedby', 'tabindex'] as const;

export class ChartA11y {
  /** Set by `enableNodeInteractions`: shows the built-in tooltip at a keyboard-focused point */
  tooltip: ChartA11yTooltipHook | null = null;

  private canvas: HTMLCanvasElement | null = null;
  /** Canvas attributes before the controller touched them (restored on exit / dispose) */
  private savedAttrs = new Map<string, string | null>();
  private descEl: HTMLDivElement | null = null;
  private liveEl: HTMLDivElement | null = null;
  private focus: A11yFocus | null = null;
  /** The engine hover / tooltip currently show the keyboard-focused point */
  private pointShown = false;
  /** Deferred chart-exit cleanup is queued (see `refresh`) */
  private exitPending = false;
  private focusMeta: unknown = null;
  private table: { wrap: HTMLDivElement; container?: HTMLElement; options?: DataTableOptions } | null = null;

  constructor(private readonly host: () => ChartA11yHostState) {}

  /** Current normalized chart model (`null` when no chart is active). */
  model(): A11yChartModel | null {
    const h = this.host();
    return buildA11yModel(h.meta, h.presentation, (id) => h.backend.chart_sample?.(id), h.locale);
  }

  summary(): string {
    const m = this.model();
    return m ? buildChartSummary(m) : '';
  }

  getDataTable(options?: DataTableOptions): ChartDataTable | null {
    const m = this.model();
    return m ? buildDataTable(m, options?.maxRows ?? Infinity, options?.maxColumns ?? Infinity) : null;
  }

  exportCSV(): string {
    const m = this.model();
    if (!m) return '';
    return m.kind === 'heatmap' ? heatmapToCSV(m) : tableToCSV(buildDataTable(m));
  }

  /** Re-syncs canvas ARIA, description, legend decoration and an open data table. */
  refresh(): void {
    const h = this.host();
    const model = this.model();
    if (h.canvas !== this.canvas) this.bindCanvas(h.canvas);
    if (h.meta !== this.focusMeta) {
      this.focus = null;
      this.focusMeta = h.meta;
    }
    if (!model) {
      if (this.pointShown) {
        this.pointShown = false;
        this.tooltip?.(null, 0, 0);
      }
      // `render*Chart` exits the old chart right before building the new one: stripping
      // `tabindex` in between would blur a focused canvas, so clean up only if no chart follows
      if (!this.exitPending) {
        this.exitPending = true;
        queueMicrotask(() => {
          this.exitPending = false;
          if (this.model()) return;
          this.restoreCanvas();
          if (this.table) this.table.wrap.style.display = 'none';
        });
      }
      return;
    }
    if (typeof document === 'undefined') return;
    if (this.table) this.renderTable(model, h.theme);
    const canvas = this.canvas;
    if (!canvas) return;
    if (h.label != null) {
      this.saveAttrs(canvas);
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', h.label);
      canvas.removeAttribute('aria-describedby');
      canvas.removeAttribute('tabindex');
      if (this.descEl) this.descEl.textContent = '';
      return;
    }
    this.ensureDom(canvas);
    // Summary + description share their O(n) passes over the data
    const [summary, description] = withPassMemo(() => [buildChartSummary(model), buildChartDescription(model)]);
    this.descEl!.textContent = model.description ? messagesOf(model).a11y.join([summary, description]) : description;
    this.saveAttrs(canvas);
    canvas.classList.add('charturbo-sdk-a11y-canvas');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', model.description ?? summary);
    canvas.setAttribute('aria-describedby', this.descEl!.id);
    canvas.setAttribute('tabindex', '0');
    this.decorateLegend(h.overlay);
  }

  /** Renders (or re-renders) an accessible `<table>` of the chart data. */
  showDataTable(container?: HTMLElement, options?: DataTableOptions): HTMLTableElement | null {
    if (typeof document === 'undefined') return null;
    const model = this.model();
    const h = this.host();
    if (this.table && this.table.container !== container) this.hideDataTable();
    if (!this.table) {
      const wrap = document.createElement('div');
      wrap.className = 'charturbo-sdk-data-table';
      wrap.id = `charturbo-sdk-data-table-${++a11yIdSeq}`;
      wrap.setAttribute('role', 'region');
      // Scrollable region must be keyboard reachable
      wrap.tabIndex = 0;
      Object.assign(wrap.style, { maxHeight: '360px', overflow: 'auto', margin: '8px 0' });
      if (container) container.appendChild(wrap);
      else {
        const canvas = h.canvas;
        const anchor = canvas?.parentElement && canvas.parentElement !== document.body ? canvas.parentElement : canvas;
        if (anchor) anchor.insertAdjacentElement('afterend', wrap);
        else document.body.appendChild(wrap);
      }
      this.table = { wrap, container, options };
    }
    this.table.options = options ?? this.table.options;
    if (!model) {
      this.table.wrap.style.display = 'none';
      return null;
    }
    return this.renderTable(model, h.theme);
  }

  hideDataTable(): void {
    this.table?.wrap.remove();
    this.table = null;
  }

  dispose(): void {
    this.hideDataTable();
    this.bindCanvas(null);
    this.tooltip = null;
  }

  // -- internals -------------------------------------------------------------

  private bindCanvas(canvas: HTMLCanvasElement | null): void {
    if (this.canvas) {
      this.canvas.removeEventListener('keydown', this.onKeyDown);
      this.canvas.removeEventListener('blur', this.onBlur);
      this.restoreCanvas();
      this.descEl?.remove();
      this.liveEl?.remove();
      this.descEl = null;
      this.liveEl = null;
    }
    this.canvas = canvas;
    this.focus = null;
    if (canvas) {
      canvas.addEventListener('keydown', this.onKeyDown);
      canvas.addEventListener('blur', this.onBlur);
    }
  }

  private ensureDom(canvas: HTMLCanvasElement): void {
    const make = (cls: string) => {
      const el = document.createElement('div');
      el.className = cls;
      el.id = `${cls}-${++a11yIdSeq}`;
      Object.assign(el.style, SR_ONLY);
      canvas.insertAdjacentElement('afterend', el);
      return el;
    };
    this.descEl ??= make('charturbo-sdk-chart-description');
    if (!this.liveEl) {
      this.liveEl = make('charturbo-sdk-chart-live');
      this.liveEl.setAttribute('aria-live', 'polite');
      this.liveEl.setAttribute('aria-atomic', 'true');
    }
    if (!document.getElementById(STYLE_ID) && document.head) {
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = A11Y_CSS;
      document.head.appendChild(style);
    }
  }

  private saveAttrs(canvas: HTMLCanvasElement): void {
    if (this.savedAttrs.size) return;
    for (const a of CANVAS_ATTRS) this.savedAttrs.set(a, canvas.getAttribute(a));
  }

  private restoreCanvas(): void {
    const canvas = this.canvas;
    if (!canvas || !this.savedAttrs.size) return;
    for (const [a, v] of this.savedAttrs) {
      if (v === null) canvas.removeAttribute(a);
      else canvas.setAttribute(a, v);
    }
    canvas.classList.remove('charturbo-sdk-a11y-canvas');
    this.savedAttrs.clear();
    if (this.descEl) this.descEl.textContent = '';
  }

  /** Legend swatches get a class (forced-colors CSS) and an inline border when it is active. */
  private decorateLegend(overlay: HTMLElement | null): void {
    if (!overlay) return;
    const forced = forcedColorsActive();
    overlay.querySelectorAll<HTMLElement>('.charturbo-sdk-legend-item > span:first-child').forEach((sw) => {
      sw.classList.add('charturbo-sdk-legend-swatch');
      sw.setAttribute('aria-hidden', 'true');
      if (forced) {
        sw.style.setProperty('forced-color-adjust', 'none');
        sw.style.border = '1px solid CanvasText';
      }
    });
  }

  private onBlur = (): void => {
    if (this.pointShown) this.clearPoint();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    // Treemap / sunburst: Enter drills into the focused node, Escape goes back up
    const custom = e.key === 'Enter' || e.key === 'Escape' ? this.model() : null;
    const drilled = custom?.custom?.key?.(this.focus, e.key);
    if (custom && drilled) {
      e.preventDefault();
      this.focus = drilled.focus;
      if (drilled.focus) {
        // The drilled chart is a new layout: let it lay out before the focused node is hovered
        this.host().render();
        const model = this.model() ?? custom;
        this.announce(pointAnnouncement(model, drilled.focus));
        this.hoverPoint(model, drilled.focus);
      } else this.clearPoint();
      return;
    }
    if (e.key === 'Escape') {
      if (this.focus) {
        this.focus = null;
        this.clearPoint();
        e.preventDefault();
      }
      return;
    }
    const model = this.model();
    if (!model) return;
    const next = stepFocus(model, this.focus, e.key);
    if (!next) return;
    e.preventDefault();
    this.focus = next;
    this.announce(pointAnnouncement(model, next));
    this.hoverPoint(model, next);
  };

  private announce(text: string): void {
    if (this.liveEl) this.liveEl.textContent = text;
  }

  private clearPoint(): void {
    this.pointShown = false;
    this.tooltip?.(null, 0, 0);
    const h = this.host();
    if (!buildA11yModel(h.meta, h.presentation, undefined, h.locale)) return;
    h.backend.chart_clear_hover?.();
    h.render();
  }

  /**
   * Hovers the focused point through the engine: project its global id to NDC, then hit-test
   * there (the engine draws crosshair / markers / bar highlight). Points outside the visible
   * x window (zoomed) only get announced.
   */
  private hoverPoint(model: A11yChartModel, focus: A11yFocus): void {
    const h = this.host();
    const b = h.backend;
    const id = model.pointId(focus.series, focus.index);
    const ndc = b.project_node_to_ndc?.(id);
    let hit: Float64Array | undefined;
    if (model.custom?.hover) {
      // Hierarchy / flow items are hovered by id (cells may be aggregated, ribbons overlap)
      const r = model.custom.hover(focus);
      hit = r && r.length >= 7 && r[2] >= 1 ? r : undefined;
      if (hit && !(ndc && ndc.length >= 2)) {
        this.pointShown = true;
        this.tooltip?.(null, 0, 0);
        h.render();
        return;
      }
    } else if (ndc && ndc.length >= 2 && Math.abs(ndc[0]) <= 1 && Math.abs(ndc[1]) <= 1) {
      const bars = model.kind === 'bar' || model.kind === 'bar-multi' || model.kind === 'combo';
      // Bar tops sit on the hit boundary (3D raycast): retry slightly inside the bar
      for (const dy of bars ? [0, -0.01, 0.01, -0.04, 0.04] : [0]) {
        const r = b.chart_hover_at_ndc?.(ndc[0], ndc[1] + dy);
        // Scatter: the focused point or an exact duplicate of it (same x / y) may win the
        // nearest-point test; another point means the focused one is outside the zoom window
        const ok =
          model.kind === 'scatter'
            ? !!r && r.length >= 7 && r[2] >= 1 && sameScatterPoint(model, r[4], id)
            : // Candles: the engine reports every candle as series 0
              // Pie: the engine reports the slice as both series and index
              !!r && hitIncludes(r, focus.index, model.kind === 'bar' || model.kind === 'candle' || model.kind === 'pie' ? undefined : focus.series);
        if (ok) {
          hit = r;
          break;
        }
      }
    }
    if (!hit || !ndc) {
      this.clearPoint();
      return;
    }
    this.pointShown = true;
    if (this.tooltip && h.canvas) {
      const ctx = h.chartTooltip?.(hit) ?? tooltipContext(model, focus, hit, h.details);
      const rect = h.canvas.getBoundingClientRect();
      this.tooltip(ctx, rect.left + (ndc[0] * 0.5 + 0.5) * rect.width, rect.top + (0.5 - ndc[1] * 0.5) * rect.height);
    }
    h.render();
  }

  private renderTable(model: A11yChartModel, theme: CharturboTheme): HTMLTableElement {
    const state = this.table!;
    const wrap = state.wrap;
    const maxRows = state.options?.maxRows ?? 1000;
    const data = buildDataTable(model, maxRows, state.options?.maxColumns ?? 50);
    wrap.replaceChildren();
    wrap.style.display = 'block';
    Object.assign(wrap.style, { color: theme.textPrimary, fontFamily: theme.fontFamily });
    const { common: c, a11y: t } = messagesOf(model);
    const kinds = c.kind;
    const kindLabel = {
      scientific3d: model.custom?.kindLabel ?? kinds['3d'],
      line: kinds.line,
      bar: kinds.bar,
      'bar-multi': kinds.bar,
      scatter: kinds.scatter,
      candle: model.financialMode === 'ohlc' ? kinds.ohlc : kinds.candlestick,
      heatmap: kinds.heatmap,
      box: model.box?.violin ? kinds.violin : kinds.box,
      pie: model.pie?.donut ? kinds.donut : kinds.pie,
      combo: kinds.combo,
      radar: kinds.radar,
      gauge: kinds.gauge,
      funnel: kinds.funnel,
      waterfall: kinds.waterfall,
      treemap: kinds.treemap,
      sunburst: kinds.sunburst,
      sankey: kinds.sankey,
    }[model.kind];
    const caption = model.title ?? t.tableCaption(kindLabel);
    wrap.setAttribute('aria-label', t.tableLabel(caption));

    const table = document.createElement('table');
    Object.assign(table.style, { borderCollapse: 'collapse', fontSize: '12px', fontVariantNumeric: 'tabular-nums' });
    const cap = document.createElement('caption');
    cap.textContent = caption;
    Object.assign(cap.style, { textAlign: 'left', fontWeight: '600', padding: '4px 0', color: theme.textPrimary });
    table.appendChild(cap);

    const cellStyle = (el: HTMLElement, header: boolean) =>
      Object.assign(el.style, {
        padding: '3px 10px',
        textAlign: header ? 'left' : 'right',
        borderBottom: `1px solid ${theme.tooltipBorder}`,
        color: header ? theme.textSecondary : theme.textPrimary,
        fontWeight: header ? '600' : '400',
        whiteSpace: 'nowrap',
      });
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    data.columns.forEach((c) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      cellStyle(th, true);
      hr.appendChild(th);
    });
    thead.appendChild(hr);
    const tbody = document.createElement('tbody');
    for (const row of data.rows) {
      const tr = document.createElement('tr');
      row.forEach((cell, k) => {
        const el = document.createElement(k === 0 ? 'th' : 'td');
        if (k === 0) (el as HTMLTableCellElement).scope = 'row';
        // Numeric row headers are scatter x values
        el.textContent =
          typeof cell === 'number'
            ? k === 0
              ? model.formatX(cell)
              : (data.formats?.[k] ?? model.series[k - 1]?.format ?? model.formatValue)(cell)
            : (cell ?? c.dash);
        cellStyle(el, k === 0);
        tr.appendChild(el);
      });
      tbody.appendChild(tr);
    }
    table.append(thead, tbody);
    wrap.appendChild(table);
    if (data.sampled || data.sampledColumns) {
      const note = document.createElement('p');
      note.id = `${wrap.id}-note`;
      const n = (v: number) => formatCount(v, model.locale);
      const shown: string[] = [];
      if (data.sampled) shown.push(t.sampledRows(n(data.rows.length), n(data.totalRows)));
      if (data.sampledColumns) shown.push(t.sampledColumns(n(data.columns.length - 1), n(data.totalColumns ?? 0)));
      note.textContent = t.sampledNote(shown);
      Object.assign(note.style, { margin: '4px 0', fontSize: '11px', color: theme.textMuted });
      wrap.appendChild(note);
      table.setAttribute('aria-describedby', note.id);
    }
    return table;
  }
}

/** True when scatter points `a` and `b` are the same point or exact duplicates. */
function sameScatterPoint(model: A11yChartModel, a: number, b: number): boolean {
  const d = model.scatter;
  if (a === b) return true;
  return !!d && a >= 0 && a < d.length && Number(d.x[a]) === Number(d.x[b]) && Number(d.y[a]) === Number(d.y[b]);
}

/** True when a `chart_hover_at_ndc` result contains the point (`series` omitted = any series). */
export function hitIncludes(hit: ArrayLike<number>, index: number, series?: number): boolean {
  const count = hit.length >= 3 ? hit[2] : 0;
  for (let k = 0; k < count; k++) {
    const at = 3 + k * 4;
    if (hit[at + 1] === index && (series === undefined || hit[at] === series)) return true;
  }
  return false;
}

/** Same tooltip data the pointer path builds, with the keyboard-focused point as primary. */
export function tooltipContext(
  model: A11yChartModel,
  focus: A11yFocus,
  hit: ArrayLike<number>,
  details: (id: number) => NodeDetails | null
): ChartTooltipContext {
  const css = (c: RgbaTuple) => {
    const [r, g, b] = c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
    return `rgb(${r}, ${g}, ${b})`;
  };
  const id = model.pointId(focus.series, focus.index);
  if (model.kind === 'candle') {
    const v = (k: number) => modelValue(model, k, focus.index);
    const x = Number(model.xValue(focus.index));
    const volume = model.series.length > 4 ? v(4) : NaN;
    const ohlc: ChartOhlc = {
      open: v(0),
      high: v(1),
      low: v(2),
      close: v(CANDLE_CLOSE),
      ...(Number.isFinite(volume) ? { volume } : {}),
      x,
      xEnd: x,
      count: 1,
    };
    return {
      chartType: model.financialMode ?? 'candlestick',
      index: focus.index,
      x,
      xLabel: model.xLabel(focus.index),
      items: [{ seriesName: messagesOf(model).common.close, value: ohlc.close, color: css(model.itemColor(0, focus.index)), nodeId: id }],
      ohlc,
      details: details(id),
    };
  }
  if (model.kind === 'heatmap' && model.heatmap) {
    const h = model.heatmap;
    const cell = { row: focus.series, col: focus.index, xLabel: h.colLabel(focus.index), yLabel: h.rowLabel(focus.series) };
    return {
      chartType: 'heatmap',
      index: cell.col,
      xLabel: cell.xLabel,
      cell,
      items: [{ seriesName: h.valueLabel, value: h.value(cell.row, cell.col), color: css(model.itemColor(0, id)), nodeId: id }],
      details: details(id),
    };
  }
  if (model.kind === 'pie' && model.pie) {
    const p = model.pie;
    const k = focus.index;
    const name = p.names[k] ?? '';
    const color = css(model.itemColor(0, k));
    const members = k === p.otherSlice ? { members: p.otherMembers } : {};
    return {
      chartType: 'pie',
      index: k,
      xLabel: name,
      items: [{ seriesName: name, value: p.values[k], color, nodeId: id, percent: p.percents[k] }],
      slice: { label: name, value: p.values[k], percent: p.percents[k], ...members },
      details: details(id),
    };
  }
  if (model.kind === 'scatter' && model.scatter) {
    const d = model.scatter;
    const clean = (v: number) => (d.f32 ? f32ToShortest(v) : v);
    const point = { x: clean(Number(d.x[id])), y: modelValue(model, focus.series, focus.index) };
    return {
      chartType: 'scatter',
      index: id,
      xLabel: model.formatX(point.x),
      point,
      items: [
        { seriesName: model.itemName(focus.series, id), value: point.y, color: css(model.itemColor(focus.series, id)), nodeId: id },
      ],
      details: details(id),
    };
  }
  const items: ChartTooltipItem[] = [];
  const count = hit.length >= 3 ? hit[2] : 0;
  for (let k = 0; k < count; k++) {
    const at = 3 + k * 4;
    const series = hit[at];
    const index = hit[at + 1];
    const band = model.kind === 'line' ? model.series[series]?.band : undefined;
    items.push({
      seriesName: model.itemName(series, index),
      value: hit[at + 2],
      color: css(model.itemColor(series, index)),
      nodeId: hit[at + 3],
      ...sparseTooltip(model.sparse, series, index),
      ...(band && index < band.lower.length && Number.isFinite(Number(band.lower[index])) && Number.isFinite(Number(band.upper[index]))
        ? { band: { lower: Number(band.lower[index]), upper: Number(band.upper[index]) } }
        : {}),
    });
  }
  // Stacked / percent bars and areas: same total / shares as the pointer tooltip
  let total: number | undefined;
  const stacking = stackMode(model);
  if (stacking === 'stacked') {
    total = model.kind === 'line' ? categoryTotal(model, focus.index) : items.reduce((sum, it) => sum + it.value, 0);
  } else if (stacking === 'percent') {
    const abs = items.reduce((sum, it) => sum + Math.abs(it.value), 0);
    for (const it of items) it.percent = abs > 0 ? (Math.abs(it.value) / abs) * 100 : 0;
  }
  const x = model.kind === 'line' && model.hasX ? Number(model.xValue(focus.index, focus.series)) : undefined;
  return {
    chartType: model.kind === 'line' ? (model.sparse?.kind ?? (model.standaloneBand ? 'band' : 'line')) : model.kind === 'combo' ? 'combo' : 'bar',
    index: focus.index,
    ...(x !== undefined ? { x } : {}),
    xLabel: model.xLabel(focus.index, focus.series),
    items,
    ...(total !== undefined ? { total } : {}),
    ...(model.areaMode ? { areaMode: model.areaMode } : {}),
    details: details(id),
  };
}
