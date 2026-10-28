/**
 * Scatter trendlines (ECharts ecStat `regression`): option validation, the engine records of
 * `set_chart_scatter_trendlines` (lib_scatter.rs), fit decoding and the equation text the legend
 * and the accessible description show. The fits run in Rust (chart/regression.rs): ordinary least
 * squares (linear; logarithmic on ln x), ecStat's y-weighted log-linear fit (exponential) and a
 * Givens QR fit in centered / scaled x (polynomial).
 */
import { parseColor, type ColorInput, type RgbaTuple } from './color';
import { dashPattern } from './chart-linestyle';

export type ScatterTrendlineType = 'linear' | 'exponential' | 'logarithmic' | 'polynomial';

export interface ScatterTrendline {
  /**
   * Regression model: `'linear'` `y = a + bx`, `'exponential'` `y = a·e^(bx)` (fits `y > 0`
   * only), `'logarithmic'` `y = a + b·ln(x)` (fits `x > 0` only), `'polynomial'` of `order`
   */
  type: ScatterTrendlineType;
  /** Polynomial order, an integer 2-6 (default 2; Excel's polynomial trendline also ends at 6) */
  order?: number;
  /** Series ids to fit, one line each (default: every series, like one ecStat regression per data set) */
  series?: number[];
  /** Stroke color (default: the series color) */
  color?: ColorInput;
  /** Stroke width in CSS px (default 2) */
  width?: number;
  /** CSS-px dash lengths `[on, off]` or `[on, off, on, off]` (`[a]` = `[a, a]`); default solid */
  dash?: number[];
}

/** Least-squares fit of one drawn trendline. */
export interface ScatterTrendlineFit {
  type: ScatterTrendlineType;
  /** Polynomial order (polynomial fits only) */
  order?: number;
  /** Series id fitted */
  series: number;
  /**
   * Coefficients in data units: linear `[a, b]` (`y = a + bx`), exponential `[a, b]`
   * (`y = a·e^(bx)`), logarithmic `[a, b]` (`y = a + b·ln(x)`), polynomial `[c0, .., ck]`
   * (ascending powers of x). Empty when the series has too few distinct points to fit
   */
  coefficients: number[];
  /** `1 - SS_res / SS_tot` of the curve against the original y of the fitted points (NaN without a fit or when every y is equal) */
  r2: number;
  /** Points fitted */
  points: number;
  /** Finite points outside the model's domain, left out of the fit (`y <= 0` exponential, `x <= 0` logarithmic) */
  skipped: number;
  /** Equation, e.g. `y = 1.234x + 5.6` (empty without a fit) */
  expression: string;
  color: RgbaTuple;
  width: number;
  dash: number[];
}

/** f64 per engine record (lib_scatter.rs `TRENDLINE_STRIDE` / `TREND_FIT_STRIDE`). */
export const TRENDLINE_STRIDE = 12;
export const TREND_FIT_STRIDE = 11;
export const MAX_TREND_ORDER = 6;
const MODEL_CODES: Record<ScatterTrendlineType, number> = { linear: 0, exponential: 1, logarithmic: 2, polynomial: 3 };

/** Validated trendline options (before the series are known). */
export interface CheckedTrendline {
  type: ScatterTrendlineType;
  order: number;
  series?: number[];
  color?: RgbaTuple;
  width: number;
  dash: number[];
}

/** Validates `trendline` options (throws on invalid input); `undefined` = none. */
export function checkTrendlines(input: ScatterTrendline | ScatterTrendline[] | undefined, fn: string): CheckedTrendline[] {
  const list = input === undefined ? [] : Array.isArray(input) ? input : [input];
  return list.map((t, i) => {
    const at = `${fn}: trendline ${i}`;
    if (!t || !(t.type in MODEL_CODES)) throw new Error(`${at} type must be 'linear', 'exponential', 'logarithmic' or 'polynomial'`);
    const order = t.order ?? 2;
    if (t.type === 'polynomial' && !(Number.isInteger(order) && order >= 2 && order <= MAX_TREND_ORDER)) {
      throw new RangeError(`${at} order must be an integer from 2 to ${MAX_TREND_ORDER}`);
    }
    if (t.series && !t.series.every((s) => Number.isInteger(s) && s >= 0 && s <= 0xffff)) {
      throw new RangeError(`${at} series must be series ids (integers >= 0)`);
    }
    const width = t.width ?? 2;
    if (!Number.isFinite(width) || width < 0) throw new RangeError(`${at} width must be finite and >= 0`);
    if (t.dash?.some((d) => !Number.isFinite(d) || d < 0)) throw new RangeError(`${at} dash lengths must be finite and >= 0`);
    return {
      type: t.type,
      order: t.type === 'polynomial' ? order : 1,
      series: t.series ? [...t.series] : undefined,
      color: t.color === undefined ? undefined : parseColor(t.color),
      width,
      dash: dashPattern(t.dash ?? []),
    };
  });
}

/** One drawn line per (trendline, series): its engine records, in fit order. */
export function encodeTrendlines(
  lines: CheckedTrendline[],
  seriesCount: number,
  seriesColor: (series: number) => RgbaTuple
): { records: Float64Array; drawn: { line: CheckedTrendline; series: number; color: RgbaTuple }[] } {
  const drawn = lines.flatMap((line) =>
    (line.series ?? Array.from({ length: seriesCount }, (_, s) => s)).map((series) => ({ line, series, color: line.color ?? seriesColor(series) }))
  );
  const records = new Float64Array(drawn.length * TRENDLINE_STRIDE);
  drawn.forEach(({ line, series, color }, k) => {
    const dash = [0, 1, 2, 3].map((j) => line.dash[j] ?? 0);
    records.set([series, MODEL_CODES[line.type], line.order, ...color, line.width, ...dash], k * TRENDLINE_STRIDE);
  });
  return { records, drawn };
}

/** Fits of the drawn lines from `chart_scatter_trend_fits` (missing engine data = no fit). */
export function decodeTrendFits(
  fits: ArrayLike<number> | undefined,
  drawn: { line: CheckedTrendline; series: number; color: RgbaTuple }[]
): ScatterTrendlineFit[] {
  return drawn.map(({ line, series, color }, k) => {
    const at = k * TREND_FIT_STRIDE;
    const has = !!fits && fits.length >= at + TREND_FIT_STRIDE;
    const count = has ? fits[at + 3] : 0;
    const coefficients = Array.from({ length: count }, (_, j) => Number(fits![at + 4 + j]));
    const fit: ScatterTrendlineFit = {
      type: line.type,
      ...(line.type === 'polynomial' ? { order: line.order } : {}),
      series,
      coefficients,
      r2: has && count > 0 ? Number(fits[at + 2]) : NaN,
      points: has ? fits[at] : 0,
      skipped: has ? fits[at + 1] : 0,
      expression: '',
      color,
      width: line.width,
      dash: line.dash,
    };
    fit.expression = trendExpression(fit);
    return fit;
  });
}

const SUPERSCRIPT = ['', '', '²', '³', '⁴', '⁵', '⁶'];

/** Coefficient text: 4 significant digits, no trailing zeros. */
function coef(v: number): string {
  return String(Number(v.toPrecision(4)));
}

/** `y = ` and signed terms (`[coefficient, suffix]`, zero terms dropped; `1x` reads `x`). */
function terms(parts: [number, string][]): string {
  const shown = parts.filter(([c]) => c !== 0);
  if (!shown.length) return 'y = 0';
  return shown.reduce((out, [c, suffix], k) => {
    const mag = Math.abs(c);
    const text = suffix && Number(mag.toPrecision(4)) === 1 && !suffix.startsWith('·') ? suffix : `${coef(mag)}${suffix}`;
    const sign = c < 0 ? (k === 0 ? '−' : ' − ') : k === 0 ? '' : ' + ';
    return out + sign + text;
  }, 'y = ');
}

/** Equation of a fit (ecStat writes the same forms); empty without coefficients. */
export function trendExpression(fit: Pick<ScatterTrendlineFit, 'type' | 'coefficients'>): string {
  const c = fit.coefficients;
  if (!c.length) return '';
  switch (fit.type) {
    case 'linear':
      return terms([
        [c[1], 'x'],
        [c[0], ''],
      ]);
    case 'exponential':
      return `y = ${coef(c[0])}·e^(${coef(c[1])}x)`;
    case 'logarithmic':
      return terms([
        [c[0], ''],
        [c[1], '·ln(x)'],
      ]);
    default:
      return terms(c.map((v, k): [number, string] => [v, k === 0 ? '' : `x${SUPERSCRIPT[k] ?? `^${k}`}`]).reverse());
  }
}

/** `R² = 0.9523` (4 decimals, like spreadsheet trendline labels); `R² n/a` when undefined. */
export function r2Text(r2: number): string {
  return Number.isFinite(r2) ? `R² = ${r2.toFixed(4)}` : 'R² n/a';
}

const DOMAIN_NOTE: Partial<Record<ScatterTrendlineType, string>> = { exponential: 'y ≤ 0', logarithmic: 'x ≤ 0' };

/** Legend text of a fit: equation, R², and any points left out of the fit. */
export function trendLegendLabel(fit: ScatterTrendlineFit, seriesName: string | null): string {
  const head = seriesName ? `${seriesName}: ` : '';
  const skipped = fit.skipped > 0 ? `; ${fit.skipped} ${fit.skipped === 1 ? 'point' : 'points'} with ${DOMAIN_NOTE[fit.type]} skipped` : '';
  if (!fit.coefficients.length) return `${head}no ${fit.type} fit (${fit.points} ${fit.points === 1 ? 'point' : 'points'}${skipped})`;
  return `${head}${fit.expression} (${r2Text(fit.r2)}${skipped})`;
}

/** Sentence of the accessible description about a fit. */
export function trendDescription(fit: ScatterTrendlineFit, seriesName: string, hidden: boolean): string {
  const kind = fit.type === 'polynomial' ? `polynomial (order ${fit.order})` : fit.type;
  const head = `${seriesName}${hidden ? ' (hidden)' : ''} ${kind} trend line`;
  const pts = `${fit.points} ${fit.points === 1 ? 'point' : 'points'}`;
  const skipped = fit.skipped > 0 ? `; ${fit.skipped} ${fit.skipped === 1 ? 'point' : 'points'} with ${DOMAIN_NOTE[fit.type]} skipped` : '';
  if (!fit.coefficients.length) return `${head}: not enough points to fit (${pts}${skipped}).`;
  return `${head}: ${fit.expression}, ${r2Text(fit.r2)}, fitted to ${pts}${skipped}.`;
}
