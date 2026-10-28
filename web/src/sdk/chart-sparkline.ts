/**
 * Sparkline preset (`Charturbo.renderSparkline`): a line / area / bar / win-loss chart with
 * zero chrome — no axes, grid, legend, title, overlay DOM, zoom or tooltip (opt-in). The
 * last / min / max markers, the reference band and the win / loss zero line are engine marks
 * (Rust annotation layers, rebuilt on data updates); the trend summary comes from the engine
 * too. This module resolves options into an engine-ready spec and builds the aria-label; the
 * SDK hook only renders the underlying chart and hands the canvas a `role="img"` label.
 */

import { parseColor, type ColorInput, type RgbaTuple } from './color';
import type { CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { formatCount, formatNumber, getMessages } from './i18n';

export type SparklineType = 'line' | 'area' | 'bar' | 'winloss';

export interface SparklineData {
  /** Samples (`NaN` = gap); win / loss: sign of each value (> 0 win, < 0 loss, 0 tie) */
  values: Float32Array | number[];
  /** x of each sample (line / area only; same rules as `LineSeriesDescriptor.x`) */
  x?: Float64Array | number[] | Date[];
}

export interface SparklineOptions {
  /** `'line'` (default), `'area'`, `'bar'` or `'winloss'` (equal up / down bars by sign) */
  type?: SparklineType;
  /** Series / bar / win color (default: first theme palette color) */
  color?: ColorInput;
  /** Loss bars of `'winloss'` (default: second theme palette color) */
  negativeColor?: ColorInput;
  /** Stroke width in CSS px (default 1.5) */
  lineWidth?: number;
  /** Marker on the last sample, in the series color (default false) */
  showLast?: boolean;
  /** Markers on the minimum and maximum (default false; ignored by `'winloss'`) */
  showMinMax?: boolean;
  /** Marker radius in CSS px (default 2.5) */
  markerRadius?: number;
  lastColor?: ColorInput;
  /** Min / max marker color (default: theme secondary text color) */
  minMaxColor?: ColorInput;
  /** Reference band `[lo, hi]` in data units (e.g. a target range), beneath the series */
  band?: [number, number];
  /** Band color (default: theme muted text color at 15% alpha); its alpha is used as is */
  bandColor?: ColorInput;
  /** Area fill alpha multiplier (default 0.2) */
  fillOpacity?: number;
  /**
   * Plot size in world units; only the aspect matters (the plot fills the canvas). Default:
   * the canvas CSS size minus padding — re-fitted on resize while neither is given.
   */
  width?: number;
  height?: number;
  /** CSS px around the plot (default 2, or marker radius + 1 when markers are shown) */
  padding?: number;
  /** Built-in hover tooltip (default false: no tooltip DOM, no pointer listeners) */
  tooltip?: boolean;
  /** Name used in the aria-label and tooltip, e.g. `'Revenue'` */
  label?: string;
  /** Accessible name of the canvas; replaces the generated trend summary */
  description?: string;
  /** Number format of the aria-label / tooltip values (default: locale, up to 2 decimals) */
  formatValue?: (v: number) => string;
}

/** Trend of the first series (engine `chart_sparkline_summary`). */
export interface SparklineSummary {
  count: number;
  first: number;
  last: number;
  min: number;
  max: number;
  firstIndex: number;
  lastIndex: number;
  minIndex: number;
  maxIndex: number;
  /** Change first -> last in percent of `|first|` (NaN when first is 0) */
  changePct: number;
}

export interface SparklineResult {
  pointCount: number;
  summary: SparklineSummary | null;
  /** aria-label given to the canvas */
  label: string;
}

/** Resolved sparkline kept by the SDK (re-render on resize, a11y label). */
export interface SparklineSpec {
  type: SparklineType;
  /** Values as rendered (win / loss: -1 / 1 / NaN) */
  values: Float32Array;
  /** Values as given (win / loss summary counts their signs) */
  raw: Float32Array;
  x?: Float64Array | number[] | Date[];
  color: RgbaTuple;
  negativeColor: RgbaTuple;
  lineWidth: number;
  fillOpacity: number;
  padding: { top: number; right: number; bottom: number; left: number };
  width: number;
  height: number;
  /** width / height follow the canvas (re-fit on resize) */
  autoSize: boolean;
  last: RgbaTuple | null;
  min: RgbaTuple | null;
  max: RgbaTuple | null;
  markerRadius: number;
  band: [number, number] | null;
  bandColor: RgbaTuple;
  zeroLine: RgbaTuple | null;
  tooltip: boolean;
  name: string;
  description?: string;
  format: (v: number) => string;
  /** Original input (re-render on resize) */
  input: { data: SparklineData; options?: SparklineOptions };
}

const EMPTY_F32 = new Float32Array(0);
const EMPTY_F64 = new Float64Array(0);

function color(c: ColorInput | undefined, fallback: RgbaTuple): RgbaTuple {
  if (c === undefined) return fallback;
  try {
    return parseColor(c);
  } catch {
    return fallback;
  }
}

/** Win / loss bar heights: 1 win, -1 loss, NaN tie / gap (no bar). */
export function winLossValues(values: ArrayLike<number>): Float32Array {
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    out[i] = v > 0 ? 1 : v < 0 ? -1 : NaN;
  }
  return out;
}

/** Normalizes `renderSparkline` input (`values` array or `{ values, x }`). */
export function sparklineData(data: SparklineData | Float32Array | number[]): SparklineData {
  return Array.isArray(data) || data instanceof Float32Array ? { values: data } : data;
}

/** Resolves options against the theme and the canvas CSS size `[w, h]`. */
export function resolveSparkline(
  data: SparklineData,
  options: SparklineOptions | undefined,
  theme: CharturboTheme,
  canvasCss: [number, number],
  locale?: string
): SparklineSpec {
  const o = options ?? {};
  const type: SparklineType = o.type ?? 'line';
  const raw = data.values instanceof Float32Array ? data.values : Float32Array.from(data.values, Number);
  const winloss = type === 'winloss';
  const seriesColor = color(o.color, theme.palette[0]);
  const neutral = color(theme.textSecondary, theme.baseline);
  const last = o.showLast && !winloss ? color(o.lastColor, seriesColor) : null;
  const minMax = o.showMinMax && !winloss ? color(o.minMaxColor, neutral) : null;
  const markerRadius = o.markerRadius ?? 2.5;
  const marks = last || minMax;
  const p = o.padding ?? (marks ? Math.ceil(markerRadius + 1) : 2);
  const padding = { top: p, right: p, bottom: p, left: p };
  const autoSize = o.width === undefined && o.height === undefined;
  const width = o.width ?? Math.max(1, canvasCss[0] - 2 * p);
  const height = o.height ?? Math.max(1, canvasCss[1] - 2 * p);
  const muted = color(theme.textMuted, theme.grid);
  const band = o.band && Number.isFinite(o.band[0]) && Number.isFinite(o.band[1]) ? o.band : null;
  const fmt = o.formatValue ?? ((v: number) => formatNumber(v, locale, 2));
  return {
    type,
    values: winloss ? winLossValues(raw) : raw,
    raw,
    x: winloss || type === 'bar' ? undefined : data.x,
    color: seriesColor,
    negativeColor: color(o.negativeColor, theme.palette[1] ?? seriesColor),
    lineWidth: o.lineWidth ?? 1.5,
    fillOpacity: o.fillOpacity ?? 0.2,
    padding,
    width,
    height,
    autoSize,
    last,
    min: minMax,
    max: minMax,
    markerRadius,
    band,
    bandColor: o.bandColor !== undefined ? color(o.bandColor, muted) : [muted[0], muted[1], muted[2], 0.15],
    zeroLine: winloss ? theme.baseline : null,
    tooltip: o.tooltip ?? false,
    name: o.label ?? getMessages(locale).common.kind.sparkline,
    description: o.description,
    format: fmt,
    input: { data, options },
  };
}

/** Bar items of a `'bar'` / `'winloss'` sparkline (one per value, colored by sign for win / loss). */
export function sparklineBarItems(spec: SparklineSpec): { label: string; value: number; color: RgbaTuple }[] {
  const items: { label: string; value: number; color: RgbaTuple }[] = [];
  for (let i = 0; i < spec.values.length; i++) {
    const v = spec.values[i];
    items.push({ label: String(i + 1), value: v, color: spec.type === 'winloss' && v < 0 ? spec.negativeColor : spec.color });
  }
  return items;
}

/** Sends the marks (markers, band, zero line) to the engine. */
export function applySparklineMarks(backend: WasmCharturboEngineBackend, spec: SparklineSpec): void {
  const c = (v: RgbaTuple | null) => (v ? new Float32Array(v) : EMPTY_F32);
  backend.set_chart_sparkline?.(
    c(spec.last),
    c(spec.min),
    c(spec.max),
    spec.markerRadius,
    spec.band ? new Float64Array(spec.band) : EMPTY_F64,
    spec.band ? new Float32Array(spec.bandColor) : EMPTY_F32,
    c(spec.zeroLine)
  );
}

/** Shortest decimal of an f32 value (engine summaries are f32). */
function shortF32(v: number): number {
  for (let p = 1; p <= 9; p++) {
    const s = Number(v.toPrecision(p));
    if (Math.fround(s) === Math.fround(v)) return s;
  }
  return v;
}

/** Engine summary, or computed here from `values` when the engine has no sparkline binding. */
export function readSparklineSummary(backend: WasmCharturboEngineBackend, values: ArrayLike<number>): SparklineSummary | null {
  const a = backend.chart_sparkline_summary?.();
  if (a) {
    if (a.length < 10) return null;
    return {
      count: a[0],
      first: shortF32(a[1]),
      last: shortF32(a[2]),
      min: shortF32(a[3]),
      max: shortF32(a[4]),
      firstIndex: a[5],
      lastIndex: a[6],
      minIndex: a[7],
      maxIndex: a[8],
      changePct: a[9],
    };
  }
  let s: SparklineSummary | null = null;
  for (let i = 0; i < values.length; i++) {
    const v = Number(values[i]);
    if (!Number.isFinite(v)) continue;
    s ??= { count: 0, first: v, last: v, min: v, max: v, firstIndex: i, lastIndex: i, minIndex: i, maxIndex: i, changePct: NaN };
    s.count++;
    s.last = v;
    s.lastIndex = i;
    if (v < s.min) [s.min, s.minIndex] = [v, i];
    if (v > s.max) [s.max, s.maxIndex] = [v, i];
  }
  if (s) s.changePct = s.first === 0 ? NaN : ((s.last - s.first) / Math.abs(s.first)) * 100;
  return s;
}

/**
 * aria-label of a sparkline, e.g. `Revenue: trend up 12% from 100 to 112, min 95, max 120`;
 * win / loss: `Results: 7 wins, 3 losses, last: win`.
 */
export function sparklineLabel(spec: SparklineSpec, s: SparklineSummary | null, locale?: string): string {
  if (spec.description) return spec.description;
  const m = getMessages(locale);
  const t = m.sparkline;
  // The default name follows the label's locale (it may have changed since `resolveSparkline`)
  const label = (text: string) => t.labelled(spec.input.options?.label ?? m.common.kind.sparkline, text);
  if (spec.type === 'winloss') {
    let [wins, losses, ties, last] = [0, 0, 0, ''];
    for (let i = 0; i < spec.raw.length; i++) {
      const v = spec.raw[i];
      if (!Number.isFinite(v)) continue;
      if (v > 0) wins++;
      else if (v < 0) losses++;
      else ties++;
      last = v > 0 ? t.win : v < 0 ? t.loss : t.tie;
    }
    const count = (k: number) => formatCount(k, locale);
    const parts = [t.wins(wins, count(wins)), t.losses(losses, count(losses))];
    if (ties) parts.push(t.ties(ties, count(ties)));
    const tally = parts.join(m.common.listSeparator);
    return label(last ? t.winLossLast(tally, last) : tally);
  }
  if (!s) return label(m.common.noData);
  const f = spec.format;
  if (s.count === 1 || s.last === s.first) return label(s.count > 1 ? t.flatRange(f(s.last), f(s.min), f(s.max)) : t.flat(f(s.last)));
  const change = Math.abs(s.changePct);
  const pct = Number.isFinite(change) ? formatNumber(change, locale, change < 10 ? 1 : 0) : null;
  const trend = s.last > s.first ? t.trendUp : t.trendDown;
  return label(trend(pct, f(s.first), f(s.last), f(s.min), f(s.max)));
}

/** An auto-sized sparkline whose canvas aspect changed by more than 1% (re-render to refit). */
export function sparklineNeedsRefit(spec: SparklineSpec, canvasCss: [number, number]): boolean {
  if (!spec.autoSize) return false;
  const p = spec.padding;
  const w = Math.max(1, canvasCss[0] - p.left - p.right);
  const h = Math.max(1, canvasCss[1] - p.top - p.bottom);
  return Math.abs(w / h / (spec.width / spec.height) - 1) > 0.01;
}
