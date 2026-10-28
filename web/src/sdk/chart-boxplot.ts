/**
 * Box plot / violin chart binding. The engine owns the statistics: quartiles (O(n) selection,
 * numpy's linear interpolation), whiskers (Tukey / min-max / percentiles), outlier counts and a
 * capped outlier sample, and the binned KDE of violins are all computed in Rust; the raw samples
 * are not kept there. This module only flattens the input for the engine, decodes the stats
 * array, and formats tooltips / a11y text (summary, description, data table rows).
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { A11yChartModel, A11yFocus, ChartDataCell, ChartDataTable } from './chart-a11y';
import type {
  ChartAxisOptions,
  ChartGridStyle,
  ChartHoverStyle,
  ChartLegendOptions,
  ChartPaddingOptions,
  ChartTooltipContext,
  CharturboTheme,
} from './charturbo';
import type { ChartAnimationInput } from './chart-animation';
import { formatCount, formatNumber, getMessages } from './i18n';

/** One series: one sample array per category (empty / missing = no box). */
export interface BoxPlotSeries {
  name: string;
  values: (Float32Array | number[] | null | undefined)[];
  /** Default: theme palette in series order */
  color?: ColorInput;
}

export interface BoxPlotData {
  /** Category (x axis) labels */
  categories: string[];
  series: BoxPlotSeries[];
}

export interface BoxPlotViolinOptions {
  /** Gaussian kernel bandwidth in data units (default: Silverman's rule per group) */
  bandwidth?: number;
  /** Inner box (whisker line, IQR bar, median dot); false = median line only (default: true) */
  showBox?: boolean;
  /** `'area'`: one density scale, every violin encloses the same area (default); `'width'`: each violin reaches full width */
  scale?: 'area' | 'width';
  /** Fill opacity of the violin body (default: 0.3) */
  opacity?: number;
}

export interface BoxPlotOptions {
  /** Enter / update animation of this chart (default: the SDK setting, `setAnimation`) */
  animation?: ChartAnimationInput;
  /** Violins (KDE) instead of boxes */
  violin?: boolean | BoxPlotViolinOptions;
  /**
   * Whisker ends: `'tukey'` = last sample within 1.5 IQR of the quartiles (default),
   * `'minmax'` = data extremes (no outliers), `[p0, p1]` = percentiles 0-100 (e.g. `[5, 95]`)
   */
  whiskers?: 'tukey' | 'minmax' | [number, number];
  /** Tukey IQR factor (default: 1.5) */
  iqrFactor?: number;
  /** Outliers as points (box mode; default: true) */
  showOutliers?: boolean;
  /** Mean as a hollow dot (default: false) */
  showMean?: boolean;
  /** Boxes as outlines instead of filled bars (default: false) */
  outline?: boolean;
  /** Drawn outliers per group; more are sampled evenly, the count stays exact (default: 10,000) */
  maxOutliers?: number;
  /** Series colors (default: theme palette in order; more than 8 series fold into "Other") */
  colors?: ColorInput[];
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  axes?: { x?: ChartAxisOptions; y?: ChartAxisOptions };
  padding?: ChartPaddingOptions;
  /** Default: shown for 2+ series */
  legend?: ChartLegendOptions | boolean;
  /** World size of the plot (default: 164 x 80) */
  width?: number;
  height?: number;
  /** Empty fraction of each category slot between groups (default: 0.3) */
  groupGap?: number;
  /** CSS px surface gap between the boxes of a group (default: 2) */
  boxGap?: number;
  /** Rounded box ends in CSS px (default: 4) */
  cornerRadius?: number;
  /** Whisker / outline stroke width in CSS px (default: 1.5) */
  whiskerWidth?: number;
  /** Outlier dot radius in CSS px (default: 3) */
  outlierRadius?: number;
  /** Tooltip / table name of the values (default: `Value`) */
  valueLabel?: string;
  hover?: ChartHoverStyle;
  grid?: ChartGridStyle;
  /** Horizontal gridlines + baseline (default: true) */
  showBackdropGrid?: boolean;
}

/** Stats of one group (engine `chart_box_stats`). */
export interface ChartBoxStats {
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  mean: number;
  std: number;
  whiskerLo: number;
  whiskerHi: number;
  /** Samples beyond the whiskers (exact, also when only a sample of them is drawn) */
  outliers: number;
}

/** Tooltip payload of a box plot hit (`ChartTooltipContext.box`). */
export interface ChartBoxTooltip extends ChartBoxStats {
  series: number;
  category: number;
  seriesName: string;
  categoryLabel: string;
  /** Hovered outlier value (outlier hits only) */
  outlier?: number;
  /** Violin plot: no outlier points are drawn */
  violin: boolean;
}

/** Display state the SDK keeps for a box plot (box id = `series * categories + category`). */
export interface BoxChartMeta {
  kind: 'box';
  names: string[];
  colors: RgbaTuple[];
  categories: string[];
  visible: boolean[];
  /** `chart_box_stats`: `BOX_STATS_STRIDE` values per group */
  stats: Float64Array;
  violin: boolean;
  whiskers: 'tukey' | 'minmax' | [number, number];
  /** Tukey IQR factor */
  iqrFactor: number;
  valueLabel: string;
}

/** Values per group in `chart_box_stats`. */
export const BOX_STATS_STRIDE = 11;
/** Series kept before the tail folds into "Other" (palette size). */
const MAX_BOX_SERIES = 8;

/** Engine input: every group's samples back to back (group `s * categories + i`). */
export interface BoxEncoded {
  values: Float32Array;
  counts: Uint32Array;
  colors: Float32Array;
  names: string[];
  rgba: RgbaTuple[];
}

/**
 * Flattens the series (one copy of the samples) and resolves colors. Without explicit colors,
 * more series than palette entries fold into an "Other" series (pooled samples, neutral color,
 * named in `locale`).
 */
export function encodeBoxPlot(data: BoxPlotData, palette: RgbaTuple[], other: RgbaTuple, colors?: ColorInput[], locale?: string): BoxEncoded {
  const n = data.categories.length;
  let series: { name: string; color?: RgbaTuple; groups: ArrayLike<number>[][] }[] = data.series.map((s, k) => ({
    name: s.name,
    color: parseOptionalColor(colors?.[k]) ?? parseOptionalColor(s.color),
    groups: Array.from({ length: n }, (_, i) => (s.values[i] ? [s.values[i]!] : [])),
  }));
  const limit = Math.min(MAX_BOX_SERIES, palette.length || MAX_BOX_SERIES);
  if (series.length > limit && !colors) {
    const tail = series.slice(limit - 1);
    series = [
      ...series.slice(0, limit - 1),
      { name: getMessages(locale).common.other, color: other, groups: Array.from({ length: n }, (_, i) => tail.flatMap((s) => s.groups[i])) },
    ];
  }
  const counts = new Uint32Array(series.length * n);
  series.forEach((s, k) => s.groups.forEach((g, i) => (counts[k * n + i] = g.reduce((sum, a) => sum + a.length, 0))));
  const values = new Float32Array(counts.reduce((sum, c) => sum + c, 0));
  let at = 0;
  for (const s of series) {
    for (const g of s.groups) {
      for (const a of g) {
        values.set(a, at);
        at += a.length;
      }
    }
  }
  const rgba = series.map((s, k) => s.color ?? palette[k] ?? other);
  const flat = new Float32Array(series.length * 4);
  rgba.forEach((c, k) => flat.set(c, k * 4));
  return { values, counts, colors: flat, names: series.map((s) => s.name), rgba };
}

/** `set_box_chart` layout array (NaN = engine default). */
export function encodeBoxLayout(o?: BoxPlotOptions): Float32Array {
  return new Float32Array([
    o?.width ?? NaN,
    o?.height ?? NaN,
    o?.groupGap ?? NaN,
    o?.boxGap ?? NaN,
    o?.cornerRadius ?? NaN,
    o?.whiskerWidth ?? NaN,
    o?.outlierRadius ?? NaN,
  ]);
}

/** `set_box_chart` options array (see `lib_boxplot.rs`). */
export function encodeBoxOptions(o?: BoxPlotOptions): Float64Array {
  const flag = (v: boolean | undefined) => (v === undefined ? NaN : v ? 1 : 0);
  const w = o?.whiskers ?? 'tukey';
  const [kind, a, b] = Array.isArray(w) ? [2, w[0] / 100, w[1] / 100] : w === 'minmax' ? [1, NaN, NaN] : [0, o?.iqrFactor ?? NaN, NaN];
  const v = o?.violin;
  const vo: BoxPlotViolinOptions = typeof v === 'object' && v ? v : {};
  return new Float64Array([
    kind,
    a,
    b,
    flag(o?.showOutliers),
    flag(o?.showMean),
    flag(o?.outline),
    o?.maxOutliers ?? NaN,
    v ? 1 : 0,
    vo.bandwidth ?? NaN,
    flag(vo.showBox),
    vo.scale === 'width' ? 1 : 0,
    vo.opacity ?? NaN,
  ]);
}

/** Stats of group `g` from the engine array (`null` for an empty / missing group). */
export function boxStatsAt(stats: ArrayLike<number>, g: number): ChartBoxStats | null {
  const at = g * BOX_STATS_STRIDE;
  if (g < 0 || at + BOX_STATS_STRIDE > stats.length || !(stats[at] > 0)) return null;
  const v = (k: number) => Number(stats[at + k]);
  return {
    n: v(0),
    min: v(1),
    q1: v(2),
    median: v(3),
    q3: v(4),
    max: v(5),
    mean: v(6),
    std: v(7),
    whiskerLo: v(8),
    whiskerHi: v(9),
    outliers: v(10),
  };
}

/** Tooltip payload of an engine hit item (`series`, `category`, `value`, `id`). */
export function boxTooltipOf(meta: BoxChartMeta, series: number, category: number, value: number, id: number, locale?: string): ChartBoxTooltip | null {
  const n = meta.categories.length;
  const st = boxStatsAt(meta.stats, series * n + category);
  if (!st) return null;
  const t = getMessages(locale).common;
  return {
    ...st,
    series,
    category,
    seriesName: meta.names[series] ?? t.seriesName(series + 1),
    categoryLabel: meta.categories[category] ?? t.itemName(category + 1),
    violin: meta.violin,
    // Ids past the boxes are outliers
    ...(id >= meta.names.length * n ? { outlier: value } : {}),
  };
}

/** Whisker rule in words (`'1.5 IQR'`, `'min / max'`, `'5th–95th percentile'`). */
export function whiskerLabel(w: BoxChartMeta['whiskers'], iqrFactor = 1.5, locale?: string): string {
  const t = getMessages(locale).box;
  const num = (v: number) => formatNumber(v, locale, 6);
  if (w === 'minmax') return t.whiskersMinMax;
  if (Array.isArray(w)) return t.whiskersPercentile(w[0], w[1], num(w[0]), num(w[1]));
  return t.whiskersIqr(num(iqrFactor));
}

/** Default tooltip HTML of a box / outlier hit (labels in `locale`). */
export function boxTooltipHtml(
  ctx: ChartTooltipContext,
  theme: CharturboTheme,
  format: (v: number) => string,
  count: (v: number) => string,
  locale?: string
): string {
  const b = ctx.box;
  const it = ctx.items[0];
  if (!b || !it) return '';
  const { common: c, box: t } = getMessages(locale);
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const fmt = (v: number) => esc(format(v));
  const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;flex:none;background:${it.color};"></span>`;
  const row = (label: string, v: string) => `
        <div style="display:flex;gap:12px;justify-content:space-between;">
          <span style="color:${theme.textMuted};">${label}</span>
          <span style="color:${theme.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${v}</span>
        </div>`;
  const head = `
        <div style="color:${theme.textMuted};font-size:11px;margin-bottom:4px;">${esc(b.categoryLabel)}</div>
        <div style="display:flex;align-items:center;color:${theme.textSecondary};margin-bottom:4px;">${swatch}${esc(b.seriesName)}</div>`;
  if (b.outlier !== undefined) return `${head}${row(esc(t.outlier), fmt(b.outlier))}${row(esc(c.median), fmt(b.median))}`;
  // Violins span min..max: no whiskers / outlier points to describe
  const whiskers =
    !b.violin && (b.whiskerLo !== b.min || b.whiskerHi !== b.max)
      ? row(esc(t.whiskers), c.range(fmt(b.whiskerLo), fmt(b.whiskerHi)))
      : '';
  return `${head}
        ${row(esc(c.max), fmt(b.max))}
        ${row(esc(t.q3), fmt(b.q3))}
        ${row(esc(c.median), fmt(b.median))}
        ${row(esc(t.q1), fmt(b.q1))}
        ${row(esc(c.min), fmt(b.min))}
        ${row(esc(c.mean), fmt(b.mean))}
        ${whiskers}
        ${row(esc(t.n), esc(count(b.n)))}
        ${b.violin ? '' : row(esc(t.outliers), esc(count(b.outliers)))}`;
}

// ---------------------------------------------------------------------------
// Accessibility (called by chart-a11y.ts)
// ---------------------------------------------------------------------------

/** Box plot part of the a11y model (focus: `series`, `index` = category). */
export interface A11yBoxData {
  categories: string[];
  violin: boolean;
  whiskers: BoxChartMeta['whiskers'];
  iqrFactor: number;
  valueLabel: string;
  stats(series: number, category: number): ChartBoxStats | null;
}

/** Normalizes a box meta for the a11y model (medians are the per-series values; default value label in `locale`). */
export function boxA11yData(m: Record<string, unknown>, locale?: string): { box: A11yBoxData; medians: Float64Array[]; names: string[] } {
  const categories = (Array.isArray(m.categories) ? m.categories : []) as string[];
  const names = (Array.isArray(m.names) ? m.names : []) as string[];
  const stats = (ArrayBuffer.isView(m.stats) ? m.stats : new Float64Array(0)) as Float64Array;
  const n = categories.length;
  const at = (s: number, i: number) => (i >= 0 && i < n ? boxStatsAt(stats, s * n + i) : null);
  const medians = names.map((_, s) => Float64Array.from({ length: n }, (_, i) => at(s, i)?.median ?? NaN));
  const w = m.whiskers;
  return {
    box: {
      categories,
      violin: m.violin === true,
      whiskers: w === 'minmax' || Array.isArray(w) ? (w as BoxChartMeta['whiskers']) : 'tukey',
      iqrFactor: typeof m.iqrFactor === 'number' && Number.isFinite(m.iqrFactor) ? m.iqrFactor : 1.5,
      valueLabel: typeof m.valueLabel === 'string' && m.valueLabel ? m.valueLabel : getMessages(locale).common.value,
      stats: at,
    },
    medians,
    names,
  };
}

/** Locale of the a11y text: explicit, else the model's chart locale. */
const textLocale = (model: A11yChartModel, locale?: string): string | undefined => locale ?? model.locale;

/** Every non-empty group of a series. */
function seriesGroups(box: A11yBoxData, s: number): { i: number; st: ChartBoxStats }[] {
  const out: { i: number; st: ChartBoxStats }[] = [];
  box.categories.forEach((_, i) => {
    const st = box.stats(s, i);
    if (st) out.push({ i, st });
  });
  return out;
}

/**
 * Canvas `aria-label`, e.g. `Box plot, 3 categories, 2 series, 30,000 samples; A medians 4.1–9.3; ...`
 * (`locale`: default the model's).
 */
export function boxSummary(model: A11yChartModel, locale?: string): string {
  const box = model.box!;
  const f = model.formatValue;
  const loc = textLocale(model, locale);
  const { common: c, box: t } = getMessages(loc);
  let samples = 0;
  let outliers = 0;
  const parts = model.series.slice(0, 5).map((s, k) => {
    const groups = seriesGroups(box, k);
    if (!groups.length) return t.seriesNoData(s.name);
    const meds = groups.map((g) => g.st.median);
    return t.seriesMedians(s.name, c.range(f(Math.min(...meds)), f(Math.max(...meds))));
  });
  if (model.series.length > 5) parts.push(c.andMore(formatCount(model.series.length - 5, loc)));
  model.series.forEach((_, k) =>
    seriesGroups(box, k).forEach(({ st }) => {
      samples += st.n;
      outliers += st.outliers;
    })
  );
  const categories = box.categories.length;
  const overview = t.overview(
    box.violin ? t.violinPlot : t.boxPlot,
    c.categories(categories, formatCount(categories, loc)),
    c.seriesCount(model.series.length, formatCount(model.series.length, loc)),
    t.samples(samples, formatCount(samples, loc)),
    !box.violin && outliers > 0 ? t.outlierCount(outliers, formatCount(outliers, loc)) : undefined
  );
  return t.summary(model.title, overview, parts);
}

/** Long description lines: axes, whisker rule, per-series median extremes (`locale`: default the model's). */
export function boxDescription(model: A11yChartModel, locale?: string): string[] {
  const box = model.box!;
  const f = model.formatValue;
  const loc = textLocale(model, locale);
  const { common: c, box: t } = getMessages(loc);
  const out: string[] = [];
  if (model.xTitle) out.push(t.xAxisTitle(model.xTitle));
  if (model.yTitle) out.push(t.yAxisTitle(model.yTitle));
  const categories = c.categories(box.categories.length, formatCount(box.categories.length, loc));
  const whiskers = whiskerLabel(box.whiskers, box.iqrFactor, loc);
  out.push(box.violin ? t.layoutViolin(categories, whiskers) : t.layoutBox(categories, whiskers));
  model.series.forEach((s, k) => {
    const groups = seriesGroups(box, k);
    if (!groups.length) {
      out.push(t.seriesEmpty(s.name));
      return;
    }
    const hi = groups.reduce((a, b) => (b.st.median > a.st.median ? b : a));
    const lo = groups.reduce((a, b) => (b.st.median < a.st.median ? b : a));
    const n = groups.reduce((sum, g) => sum + g.st.n, 0);
    const outliers = groups.reduce((sum, g) => sum + g.st.outliers, 0);
    out.push(
      t.seriesDetail(
        s.visible ? s.name : t.hiddenName(s.name),
        box.categories[hi.i],
        f(hi.st.median),
        box.categories[lo.i],
        f(lo.st.median),
        t.samples(n, formatCount(n, loc)),
        box.violin ? undefined : t.outlierCount(outliers, formatCount(outliers, loc))
      )
    );
  });
  return out;
}

/** Live-region text of a focused group (`locale`: default the model's). */
export function boxAnnouncement(model: A11yChartModel, focus: A11yFocus, locale?: string): string {
  const box = model.box!;
  const f = model.formatValue;
  const loc = textLocale(model, locale);
  const { common: c, box: t } = getMessages(loc);
  const name = model.series[focus.series]?.name ?? '';
  const category = box.categories[focus.index] ?? c.itemName(focus.index + 1);
  const st = box.stats(focus.series, focus.index);
  const pos = c.position(formatCount(focus.index + 1, loc), formatCount(box.categories.length, loc));
  if (!st) return `${t.announceEmpty(category, name)} ${pos}`;
  const text = t.announce(
    category,
    name,
    f(st.median),
    f(st.q1),
    f(st.q3),
    f(st.whiskerLo),
    f(st.whiskerHi),
    f(st.mean),
    t.samples(st.n, formatCount(st.n, loc)),
    box.violin ? undefined : t.outlierCount(st.outliers, formatCount(st.outliers, loc))
  );
  return `${text} ${pos}`;
}

/**
 * Data table: one row per category x series with every statistic (cells raw, formats per column;
 * headers and counts in `locale`, default the model's).
 */
export function boxDataTable(model: A11yChartModel, pick: (n: number) => number[], locale?: string): ChartDataTable {
  const box = model.box!;
  const s = model.series.length;
  const total = box.categories.length * s;
  const value = model.formatValue;
  const loc = textLocale(model, locale);
  const { common: c, box: t } = getMessages(loc);
  const count = (v: number) => formatCount(v, loc);
  const cols: [string, keyof ChartBoxStats, (v: number) => string][] = [
    [t.n, 'n', count],
    [c.min, 'min', value],
    [t.q1, 'q1', value],
    [c.median, 'median', value],
    [t.q3, 'q3', value],
    [c.max, 'max', value],
    [c.mean, 'mean', value],
    [t.lowerWhisker, 'whiskerLo', value],
    [t.upperWhisker, 'whiskerHi', value],
    [t.outliers, 'outliers', count],
  ];
  const indices = pick(total);
  const rows = indices.map((r) => {
    const i = Math.floor(r / Math.max(1, s));
    const k = r % Math.max(1, s);
    const st = box.stats(k, i);
    const row: ChartDataCell[] = [box.categories[i] ?? c.itemName(i + 1), model.series[k]?.name ?? c.seriesName(k + 1)];
    for (const [, key] of cols) row.push(st && Number.isFinite(st[key]) ? st[key] : null);
    return row;
  });
  return {
    columns: [model.xTitle ?? c.category, c.series, ...cols.map((col) => col[0])],
    rows,
    totalRows: total,
    sampled: indices.length < total,
    formats: [undefined, undefined, ...cols.map((col) => col[2])],
  };
}
