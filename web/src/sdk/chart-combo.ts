/**
 * Combo chart binding: bar, line and area series on one plot with a shared category / x axis and
 * an optional right y axis. The engine owns everything data-shaped (chart/combo.rs): bar layout
 * (grouped / stacked / percent, restacking on legend toggles), line M4 decimation and styles,
 * area fills, both y domains, hover hit-testing (every series at the hovered category), zoom /
 * pan. This module only validates and flattens the input, keeps the display meta, and builds
 * tooltip / details / a11y text (summary, description, announcements; the data table uses the
 * generic wide layout: rows = categories, one column per series).
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { A11yChartModel, A11yFocus, A11ySeries } from './chart-a11y';
import type { LineNullPolicy, LineStyleInput } from './chart-linestyle';
import type {
  ChartAxisOptions,
  ChartGridStyle,
  ChartHoverStyle,
  ChartLegendOptions,
  ChartPaddingOptions,
  ChartTooltipContext,
  ChartTooltipItem,
  ChartTimeGranularity,
  NodeDetails,
  NodeMetadata,
} from './charturbo';
import type { CharturboTimeZone } from './chart-timezone';

export type ComboSeriesType = 'bar' | 'line' | 'area';

/** One combo series: one value per category / x (`NaN` / `null` = missing). */
export interface ComboSeriesDescriptor extends LineStyleInput {
  name: string;
  /** `'bar'`, `'line'`, or `'area'` (a line filled down to zero, translucent) */
  type: ComboSeriesType;
  values: Float32Array | number[];
  /**
   * y axis of this series (default `'left'`). Any `'right'` series adds a second y axis with its
   * own domain and ticks (`axes.y2`); gridlines follow the left axis. Every bar series shares the
   * first bar series' axis (bars stack / group on one scale).
   */
  yAxis?: 'left' | 'right';
  /** Default: theme palette in series order */
  color?: ColorInput;
  /** Stroke width of line / area series in CSS px (default: `ComboChartOptions.lineWidth`, 2) */
  lineWidth?: number;
}

export interface ComboChartData {
  /** Category labels of a category x axis (one value per category in every series) */
  categories?: string[];
  /**
   * Or numeric / time x of each category (strictly increasing; epoch ms or `Date[]` for time).
   * Bars are as wide as 72% of the smallest x gap; line points sit on the bar centers.
   */
  x?: Float64Array | number[] | Date[];
  series: ComboSeriesDescriptor[];
}

/** y axis of a combo chart: labels plus a fixed domain (domains never autoscale). */
export interface ComboYAxisOptions extends ChartAxisOptions {
  /** Fixed bottom (default: from the data; the bar axis always includes 0) */
  min?: number;
  /** Fixed top (default: from the data) */
  max?: number;
  /** Expand data-derived ends to whole tick steps (default: true) */
  nice?: boolean;
}

export interface ComboXAxisOptions extends ChartAxisOptions {
  /** Explicit `x`: `'numeric'` (default) or `'time'` (calendar ticks; default for `Date[]`) */
  type?: 'numeric' | 'time';
}

export interface ComboChartOptions {
  /** Bar series layout: side by side (default), stacked, or stacked to 100% */
  barMode?: 'grouped' | 'stacked' | 'percent';
  /**
   * `y2`: right y axis, shown when a series has `yAxis: 'right'`. Dual axes invite readers to
   * compare unrelated scales: prefer two charts unless the series share a unit relationship.
   */
  axes?: { x?: ComboXAxisOptions; y?: ComboYAxisOptions; y2?: ComboYAxisOptions };
  title?: string;
  /** Accessible name of the canvas; replaces the auto summary (which moves to the description) */
  description?: string;
  /** Default: shown for 2+ series; click toggles (bars restack), hover emphasizes */
  legend?: ChartLegendOptions | boolean;
  padding?: ChartPaddingOptions;
  /** World size of the plot (default: 168 x 86) */
  width?: number;
  height?: number;
  /** Empty fraction of each category slot between bar groups (default: 0.28) */
  groupGap?: number;
  /** CSS px between grouped bars / stacked segments (default: 2) */
  barGap?: number;
  /** Rounded bar ends in CSS px (default: 4) */
  cornerRadius?: number;
  /** Fill alpha multiplier of area series (default: 0.2) */
  fillOpacity?: number;
  /** Stroke width of line / area series in CSS px (default: 2) */
  lineWidth?: number;
  /** Missing samples of line / area series (series `nulls` override it; default `'gap'`) */
  nulls?: LineNullPolicy;
  hover?: ChartHoverStyle;
  grid?: ChartGridStyle;
  /** Horizontal gridlines + baseline (default: true) */
  showBackdropGrid?: boolean;
  /** Locale of default number / time labels (default: the SDK locale) */
  locale?: string;
  /** Time zone of a time x axis (default: the SDK zone) */
  timeZone?: CharturboTimeZone;
}

/** Display state the SDK keeps for a combo chart (point id = `series * categories + category`). */
export interface ComboChartMeta {
  kind: 'combo';
  names: string[];
  colors: RgbaTuple[];
  types: ComboSeriesType[];
  /** y axis per series as drawn (0 = left, 1 = right; bars share one) */
  axes: number[];
  /** Per series, one value per category */
  values: Float32Array[];
  /** Category labels (category x axis), else `null` */
  categories: string[] | null;
  /** Explicit x per category, else `null` */
  xs: Float64Array | null;
  /** Tooltip / table label of category `i` */
  label: (i: number) => string;
  visible: boolean[];
  barMode: 'grouped' | 'stacked' | 'percent';
}

/** Engine input of `set_combo_chart` (see lib_combo.rs). */
export interface ComboEncoded {
  /** Categories */
  n: number;
  /** Flat `[series * n + category]` */
  values: Float32Array;
  kinds: Uint8Array;
  axes: Uint8Array;
  colors: Float32Array;
  widths: Float32Array;
  /** Explicit x or empty */
  x: Float64Array;
  timeX: boolean;
  layout: Float32Array;
  yAxes: Float64Array;
  names: string[];
  rgba: RgbaTuple[];
  types: ComboSeriesType[];
  /** Line / area series in engine (line-local) order, for `set_line_series_styles` */
  lineSeries: ComboSeriesDescriptor[];
}

const KIND_CODES: Record<ComboSeriesType, number> = { bar: 0, line: 1, area: 2 };
const BAR_MODES = { grouped: 0, stacked: 1, percent: 2 } as const;

/**
 * Validates and flattens the input. Series shorter than the category count are padded with
 * missing values (longer ones truncated). Colors: series `color`, else the theme palette in
 * series order (fixed, never cycled; series past the palette get `other`).
 */
export function encodeCombo(
  data: ComboChartData,
  options: ComboChartOptions | undefined,
  palette: RgbaTuple[],
  other: RgbaTuple,
  fn = 'renderComboChart'
): ComboEncoded {
  const series = data.series ?? [];
  const xIn = data.x;
  if (xIn && data.categories) throw new Error(`${fn}: give \`categories\` or \`x\`, not both`);
  const n = data.categories?.length ?? xIn?.length ?? series[0]?.values.length ?? 0;
  const s = series.length;
  const values = new Float32Array(s * n).fill(NaN);
  const kinds = new Uint8Array(s);
  const axes = new Uint8Array(s);
  const colors = new Float32Array(s * 4);
  const widths = new Float32Array(s);
  const rgba: RgbaTuple[] = [];
  series.forEach((d, k) => {
    const code = KIND_CODES[d.type];
    if (code === undefined) throw new Error(`${fn}: series ${k} has unknown type '${String(d.type)}' (bar | line | area)`);
    kinds[k] = code;
    axes[k] = d.yAxis === 'right' ? 1 : 0;
    const v = d.values;
    for (let i = 0; i < Math.min(n, v.length); i++) {
      const x = v[i] as unknown;
      values[k * n + i] = typeof x === 'number' ? x : NaN;
    }
    const c = parseOptionalColor(d.color) ?? palette[k] ?? other;
    rgba.push(c);
    colors.set(c, k * 4);
    widths[k] = d.lineWidth ?? options?.lineWidth ?? 2;
  });
  const dateX = !!xIn && xIn.length > 0 && xIn[0] instanceof Date;
  const timeX = !!xIn && (options?.axes?.x?.type ?? (dateX ? 'time' : 'numeric')) === 'time';
  const x = xIn ? Float64Array.from(xIn as ArrayLike<number | Date>, (v) => Number(v)) : new Float64Array(0);
  const o = options;
  const layout = new Float32Array([
    o?.width ?? NaN,
    o?.height ?? NaN,
    BAR_MODES[o?.barMode ?? 'grouped'] ?? 0,
    o?.groupGap ?? NaN,
    o?.barGap ?? NaN,
    o?.cornerRadius ?? NaN,
    o?.fillOpacity ?? NaN,
    timeX ? 1 : 0,
  ]);
  const nice = (a?: ComboYAxisOptions) => (a?.nice === false ? 0 : 1);
  const y = o?.axes?.y;
  const y2 = o?.axes?.y2;
  const yAxes = new Float64Array([y?.min ?? NaN, y?.max ?? NaN, nice(y), y2?.min ?? NaN, y2?.max ?? NaN, nice(y2)]);
  return {
    n,
    values,
    kinds,
    axes,
    colors,
    widths,
    x,
    timeX,
    layout,
    yAxes,
    names: series.map((d) => d.name),
    rgba,
    types: series.map((d) => d.type),
    lineSeries: series.filter((d) => d.type !== 'bar'),
  };
}

/**
 * Axis of each series as the engine draws it: bars share the first bar series' axis, then
 * all-right input moves to the left.
 */
export function drawnAxes(types: ComboSeriesType[], axes: ArrayLike<number>): number[] {
  const out = Array.from(axes, (a) => (a === 1 ? 1 : 0));
  const firstBar = types.indexOf('bar');
  if (firstBar >= 0) types.forEach((t, k) => t === 'bar' && (out[k] = out[firstBar]));
  if (!out.includes(0)) out.fill(0);
  return out;
}

/** Chart meta of an encoded combo chart. */
export function comboMeta(enc: ComboEncoded, data: ComboChartData, barMode: ComboChartMeta['barMode'], formatX: (x: number) => string): ComboChartMeta {
  const n = enc.n;
  const categories = data.categories ? [...data.categories] : null;
  const xs = data.x ? enc.x : null;
  return {
    kind: 'combo',
    names: enc.names,
    colors: enc.rgba,
    types: enc.types,
    axes: drawnAxes(enc.types, enc.axes),
    values: enc.names.map((_, k) => enc.values.subarray(k * n, (k + 1) * n)),
    categories,
    xs,
    label: (i) => (categories ? (categories[i] ?? `#${i + 1}`) : xs && i < xs.length ? formatX(xs[i]) : `#${i + 1}`),
    visible: enc.names.map(() => true),
    barMode,
  };
}

/** Legend swatch style of a series: bar = square, line = stroke, area = tinted block with a top edge. */
export function comboSwatch(type: ComboSeriesType, css: string): Partial<CSSStyleDeclaration> {
  if (type === 'line') return { width: '12px', height: '3px', borderRadius: '2px', background: css };
  if (type === 'area') {
    return { width: '12px', height: '8px', borderRadius: '1px', background: css.replace('rgb(', 'rgba(').replace(')', ', 0.35)'), borderTop: `2px solid ${css}`, boxSizing: 'border-box' };
  }
  return { width: '10px', height: '10px', borderRadius: '2px', background: css };
}

/** Tooltip data of an engine hit: every hovered series (bars and lines) at the category. */
export function comboTooltipContext(
  meta: ComboChartMeta,
  hit: ArrayLike<number>,
  css: (c: RgbaTuple) => string,
  details: (id: number) => NodeDetails | null
): ChartTooltipContext | null {
  const count = hit.length >= 3 ? hit[2] : 0;
  if (count < 1) return null;
  const items: ChartTooltipItem[] = [];
  for (let k = 0; k < count; k++) {
    const at = 3 + k * 4;
    const s = hit[at];
    items.push({ seriesName: meta.names[s] ?? `Series ${s + 1}`, value: hit[at + 2], color: css(meta.colors[s] ?? [0.5, 0.5, 0.5, 1]), nodeId: hit[at + 3] });
  }
  const primary = Math.min(hit[1], count - 1);
  const index = hit[3 + primary * 4 + 1];
  const x = meta.xs?.[index];
  return {
    chartType: 'combo',
    index,
    ...(x !== undefined ? { x } : {}),
    xLabel: meta.label(index),
    items,
    details: details(items[primary].nodeId),
  };
}

/** Details metadata of point `id` (`series * categories + category`). */
export function comboPointMetadata(meta: ComboChartMeta, id: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  const n = Math.max(1, meta.values[0]?.length ?? 0);
  const series = Math.floor(id / n);
  const i = id % n;
  if (series >= meta.names.length) return null;
  const name = meta.names[series];
  const value = meta.values[series][i];
  const where = meta.label(i);
  return {
    series,
    color: meta.colors[series],
    metadata: {
      label: `${name} · ${where}`,
      category: name,
      description: `${where} 항목의 ${name} 시리즈 값입니다.`,
      tags: ['combo-chart', meta.types[series], name.toLowerCase()],
      attributes: {
        series: name,
        type: meta.types[series],
        axis: meta.axes[series] === 1 ? 'right' : 'left',
        ...(meta.xs ? { x: where } : { category: where }),
        value: Number.isFinite(value) ? Number(value.toFixed(4)) : 'missing',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Accessibility (called by chart-a11y.ts)
// ---------------------------------------------------------------------------

/** Combo part of the a11y model. */
export interface A11yComboData {
  types: ComboSeriesType[];
  axes: number[];
  barMode: ComboChartMeta['barMode'];
  /** Right y axis title */
  y2Title?: string;
}

type Loose = Record<string, unknown>;
type Common = Pick<A11yChartModel, 'title' | 'description' | 'xTitle' | 'yTitle' | 'formatValue'>;

/** Normalizes a combo meta for the a11y model (focus: `series`, `index` = category). */
export function comboA11yModel(m: Loose, p: Loose, common: Common, gray: RgbaTuple): A11yChartModel {
  const names = (Array.isArray(m.names) ? m.names : []) as string[];
  const colors = (Array.isArray(m.colors) ? m.colors : []) as RgbaTuple[];
  const visible = (Array.isArray(m.visible) ? m.visible : []) as boolean[];
  const values = (Array.isArray(m.values) ? m.values : []) as Float32Array[];
  const types = (Array.isArray(m.types) ? m.types : []) as ComboSeriesType[];
  const axes = (Array.isArray(m.axes) ? m.axes : []) as number[];
  const label = typeof m.label === 'function' ? (m.label as (i: number) => string) : (i: number) => `#${i + 1}`;
  const xs = ArrayBuffer.isView(m.xs) ? (m.xs as Float64Array) : null;
  const series: A11ySeries[] = values.map((v, s) => ({
    name: names[s] ?? `Series ${s + 1}`,
    values: v,
    visible: visible[s] ?? true,
    f32: v instanceof Float32Array,
  }));
  const n = series.reduce((len, s) => Math.max(len, s.values.length), 0);
  const y2 = (p.y2Axis ?? {}) as Loose;
  const mode = m.barMode === 'stacked' || m.barMode === 'percent' ? m.barMode : 'grouped';
  return {
    kind: 'combo',
    ...common,
    series,
    length: n,
    combo: { types, axes, barMode: mode, ...(typeof y2.title === 'string' && y2.title ? { y2Title: y2.title } : {}) },
    xValue: (i) => (xs ? xs[i] : label(i)),
    xLabel: (i) => label(i),
    formatX: (x) => label(x),
    pointId: (s, i) => s * n + i,
    itemName: (s) => series[s]?.name ?? `Series ${s + 1}`,
    itemColor: (s) => colors[s] ?? gray,
  };
}

const enCount = (v: number) => v.toLocaleString('en-US');
const plural = (n: number, word: string, many = `${word}s`) => `${enCount(n)} ${n === 1 ? word : many}`;
const TYPE_WORD: Record<ComboSeriesType, string> = { bar: 'bars', line: 'line', area: 'area' };

/** Finite min / max / mean of a series with their category indices. */
function stats(values: ArrayLike<number>): { count: number; min: number; max: number; mean: number; minIndex: number; maxIndex: number } {
  let count = 0;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  let minIndex = -1;
  let maxIndex = -1;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) continue;
    count++;
    sum += v;
    if (v < min) [min, minIndex] = [v, i];
    if (v > max) [max, maxIndex] = [v, i];
  }
  return { count, min, max, mean: count ? sum / count : NaN, minIndex, maxIndex };
}

/** Series role, e.g. `bars, left axis` (axis only on dual-axis charts). */
function role(c: A11yComboData, s: number): string {
  const dual = c.axes.includes(1);
  const t = TYPE_WORD[c.types[s]] ?? 'line';
  return dual ? `${t}, ${c.axes[s] === 1 ? 'right' : 'left'} axis` : t;
}

/** Canvas `aria-label`, e.g. `Combo chart, 12 categories, 3 series (bars: Revenue, Cost; line: Margin); ...`. */
export function comboSummary(model: A11yChartModel): string {
  const c = model.combo!;
  const head = model.title ? `${model.title}. ` : '';
  const groups = (['bar', 'line', 'area'] as const)
    .map((t) => {
      const names = model.series.filter((_, s) => c.types[s] === t).map((s) => s.name);
      return names.length ? `${TYPE_WORD[t]}: ${names.join(', ')}` : '';
    })
    .filter(Boolean);
  const parts = model.series.slice(0, 5).map((s) => {
    const st = stats(s.values);
    return st.count ? `${s.name} ranges ${model.formatValue(st.min)}–${model.formatValue(st.max)}` : `${s.name} has no data`;
  });
  if (model.series.length > 5) parts.push(`and ${model.series.length - 5} more`);
  const dual = c.axes.includes(1) ? ', two y axes' : '';
  return (
    `${head}Combo chart, ${plural(model.length, 'category', 'categories')}, ${model.series.length} series ` +
    `(${groups.join('; ')})${dual}${parts.length ? `; ${parts.join('; ')}` : ''}.`
  );
}

/** Long description lines: axes, bar layout, per-series extremes with their role / axis. */
export function comboDescription(model: A11yChartModel): string[] {
  const c = model.combo!;
  const f = model.formatValue;
  const out: string[] = [];
  if (model.xTitle) out.push(`X axis: ${model.xTitle}.`);
  if (model.yTitle) out.push(`${c.axes.includes(1) ? 'Left y axis' : 'Y axis'}: ${model.yTitle}.`);
  if (c.y2Title) out.push(`Right y axis: ${c.y2Title}.`);
  const bars = c.types.filter((t) => t === 'bar').length;
  out.push(`${plural(model.length, 'category', 'categories')}${bars > 1 ? `, bars ${c.barMode}` : ''}.`);
  model.series.forEach((s, k) => {
    const st = stats(s.values);
    out.push(
      st.count
        ? `${s.name} (${role(c, k)})${s.visible ? '' : ' (hidden)'}: highest ${model.xLabel(st.maxIndex)} ${f(st.max)}, ` +
            `lowest ${model.xLabel(st.minIndex)} ${f(st.min)}, average ${f(st.mean)}.`
        : `${s.name} (${role(c, k)}): no data.`
    );
  });
  return out;
}

/** Live-region text of a focused point, e.g. `Q3, Margin (line) 15%. 3 of 4.`. */
export function comboAnnouncement(model: A11yChartModel, focus: A11yFocus, value: string): string {
  const c = model.combo!;
  const s = model.series[focus.series];
  return `${model.xLabel(focus.index)}, ${s?.name ?? ''} (${role(c, focus.series)}) ${value}. ${focus.index + 1} of ${model.length}.`;
}

/** Tick label of a combo x tick: category label (truncated) or formatted x. */
export function comboTickLabel(
  meta: Pick<ComboChartMeta, 'categories'>,
  value: number,
  granularity: ChartTimeGranularity | undefined,
  user: ((v: number, g?: ChartTimeGranularity) => string) | undefined,
  formatX: (x: number, g?: ChartTimeGranularity) => string
): string {
  if (user) return user(value, granularity);
  if (meta.categories) {
    const str = meta.categories[value] ?? String(value);
    return str.length > 12 ? `${str.slice(0, 11)}…` : str;
  }
  return formatX(value, granularity);
}
