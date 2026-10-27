/**
 * Per-series line styles of line / area charts: point markers, dash patterns, step / monotone
 * curves, null policies, and range bands (error bands). The engine builds every mark from its
 * M4-decimated picks (chart/linestyle.rs, lib_linestyle.rs); this module only validates and
 * encodes the options and reads band values back for tooltips and the data table.
 */
import { parseOptionalColor, type ColorInput } from './color';
import type { WasmCharturboEngineBackend } from './charturbo';

export type LineMarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'none';
export type LineCurve = 'linear' | 'step' | 'stepBefore' | 'stepAfter' | 'monotone';
/** Missing samples (`NaN` / `undefined` / `null`): break the line, join the neighbours, or draw 0 */
export type LineNullPolicy = 'gap' | 'connect' | 'zero';

export interface LineMarkerOptions {
  /** Default: `'circle'`; `'none'` turns markers off */
  shape?: LineMarkerShape;
  /** Diameter in CSS px (default: 6) */
  size?: number;
  /** Default: the series color */
  fill?: ColorInput;
  /** Separating outline (default: the chart surface color) */
  stroke?: ColorInput;
  /** Outline width in CSS px (default: 1) */
  strokeWidth?: number;
  /**
   * `'auto'` (default): only while the visible points are at least 8 CSS px apart after
   * decimation (zooming in reveals them); `'always'`; `'never'`
   */
  show?: 'auto' | 'always' | 'never';
}

/** Range area around a series (confidence interval, min / max envelope). */
export interface LineBandOptions {
  /** Lower edge per sample (same length as `values`; `NaN` = missing) */
  lower: Float32Array | number[];
  /** Upper edge per sample */
  upper: Float32Array | number[];
  /** Fill alpha multiplier of the series color (default: 0.2) */
  opacity?: number;
}

/** Style fields of a `LineSeriesDescriptor`. */
export interface LineStyleInput {
  marker?: LineMarkerOptions | boolean;
  /** CSS-px dash lengths `[on, off]` or `[on, off, on, off]` (`[a]` = `[a, a]`); empty = solid */
  dash?: number[];
  curve?: LineCurve;
  nulls?: LineNullPolicy;
  band?: LineBandOptions;
  /** Deprecated alias of `marker: { size }` */
  pointSize?: number;
}

/** Band arrays kept for tooltips / the data table. */
export interface LineBandMeta {
  lower: ArrayLike<number>;
  upper: ArrayLike<number>;
}

/** Floats per series of `set_line_series_styles` (see lib_linestyle.rs). */
export const LINE_STYLE_STRIDE = 18;

const SHAPES: Record<Exclude<LineMarkerShape, 'none'>, number> = { circle: 0, square: 1, diamond: 2, triangle: 3 };
const SHOW: Record<string, number> = { auto: 0, always: 1, never: 2 };
const CURVES: Record<LineCurve, number> = { linear: 0, step: 1, stepBefore: 2, stepAfter: 3, monotone: 4 };
const NULLS: Record<LineNullPolicy, number> = { gap: 0, connect: 1, zero: 2 };

/** Effective marker options of a series (`null` = no markers); `pointSize` maps to `marker.size`. */
export function resolveMarker(s: LineStyleInput): LineMarkerOptions | null {
  const m = s.marker;
  if (m === false) return null;
  if (m === undefined) return s.pointSize !== undefined && s.pointSize > 0 ? { size: s.pointSize } : null;
  const opts = m === true ? {} : m;
  return opts.shape === 'none' ? null : opts;
}

function code<K extends string>(table: Record<K, number>, value: string | undefined, what: string, fn: string): number {
  if (value === undefined) return 0;
  const c = (table as Record<string, number>)[value];
  if (c === undefined) throw new Error(`${fn}: unknown ${what} '${value}' (${Object.keys(table).join(' | ')})`);
  return c;
}

/**
 * Encodes the styles of every series (`chartNulls` = chart-level null policy, overridden per
 * series) for `set_line_series_styles`; `null` when every series is a plain line.
 */
export function encodeLineStyles(series: LineStyleInput[], chartNulls: LineNullPolicy | undefined, fn: string): Float32Array | null {
  const out = new Float32Array(series.length * LINE_STYLE_STRIDE).fill(NaN);
  let styled = false;
  series.forEach((s, i) => {
    const r = out.subarray(i * LINE_STYLE_STRIDE, (i + 1) * LINE_STYLE_STRIDE);
    const marker = resolveMarker(s);
    if (marker) {
      styled = true;
      r[0] = code(SHAPES, marker.shape ?? 'circle', 'marker shape', fn);
      r[1] = marker.size ?? NaN;
      const fill = parseOptionalColor(marker.fill);
      if (fill) r.set(fill, 2);
      const stroke = parseOptionalColor(marker.stroke);
      if (stroke) r.set(stroke, 6);
      r[10] = marker.strokeWidth ?? NaN;
      r[11] = code(SHOW, marker.show, 'marker show', fn);
    }
    const dash = dashPattern(s.dash ?? []);
    if (s.dash?.some((d) => !Number.isFinite(d) || d < 0)) throw new Error(`${fn}: series ${i} dash lengths must be finite and >= 0`);
    if (dash.length > 0) styled = true;
    for (let k = 0; k < 4; k++) r[12 + k] = dash[k] ?? 0;
    r[16] = code(CURVES, s.curve, 'curve', fn);
    r[17] = code(NULLS, s.nulls ?? chartNulls, 'nulls policy', fn);
    if (r[16] !== 0 || r[17] !== 0) styled = true;
  });
  return styled ? out : null;
}

/** `[on, off(, on, off)]` of a dash option: `[a]` = `[a, a]`, three values use the first two. */
export function dashPattern(dash: number[]): number[] {
  if (dash.length === 1) return [dash[0], dash[0]];
  if (dash.length === 3) return dash.slice(0, 2);
  return dash.slice(0, 4);
}

/** Throws when a series band does not have one lower / upper value per sample. */
export function validateLineBands(series: (LineStyleInput & { values: ArrayLike<unknown> })[], fn: string): void {
  series.forEach((s, i) => {
    const b = s.band;
    const n = s.values.length;
    if (b && (b.lower.length !== n || b.upper.length !== n)) {
      throw new Error(`${fn}: series ${i} band needs ${n} lower / upper values (got ${b.lower.length} / ${b.upper.length})`);
    }
  });
}

/** Band meta of a streamed series: the engine has the live band, the table copy is dropped. */
export function streamedBand(): LineBandMeta {
  return { lower: [], upper: [] };
}

/** Numeric copy of a band edge (`undefined` / `null` -> NaN). */
function edge(v: Float32Array | number[]): Float32Array {
  if (v instanceof Float32Array) return v;
  return Float32Array.from(v as ArrayLike<number | null | undefined>, (x) => (typeof x === 'number' ? x : NaN));
}

/**
 * Uploads series styles and bands of a freshly built line / area chart. Returns the band arrays
 * per series (`null` = none) for the chart meta. Throws on malformed bands.
 */
export function applyLineStyles(
  backend: WasmCharturboEngineBackend,
  series: (LineStyleInput & { values: ArrayLike<unknown> })[],
  chartNulls: LineNullPolicy | undefined,
  fn: string,
  bandsAllowed = true
): (LineBandMeta | null)[] {
  const styles = encodeLineStyles(series, chartNulls, fn);
  if (styles) backend.set_line_series_styles?.(styles);
  // Bands are a line chart feature (area charts ignore them)
  if (!bandsAllowed) return series.map(() => null);
  validateLineBands(series, fn);
  return series.map((s, i) => {
    const b = s.band;
    if (!b) return null;
    const lower = edge(b.lower);
    const upper = edge(b.upper);
    backend.set_line_series_band?.(i, lower, upper, b.opacity ?? NaN);
    return { lower, upper };
  });
}

/** Band edges of a hovered sample, read from the engine (follows streamed data); `undefined` without a band. */
export function lineBandAt(
  backend: WasmCharturboEngineBackend,
  bands: (LineBandMeta | null)[] | undefined,
  series: number,
  index: number
): { lower: number; upper: number } | undefined {
  if (!bands?.[series]) return undefined;
  const b = backend.chart_line_band_at?.(series, index);
  const m = bands[series]!;
  const [lower, upper] =
    b && b.length === 2 ? [b[0], b[1]] : index < m.lower.length ? [Number(m.lower[index]), Number(m.upper[index])] : [NaN, NaN];
  // Samples without a band edge (e.g. streamed after the band was set) show no range
  return Number.isFinite(lower) && Number.isFinite(upper) ? { lower, upper } : undefined;
}

/** Sample values as numbers: `null` / `undefined` / non-numbers become `NaN` (a typed-array copy would turn `null` into 0). */
export function numericSamples(values: Float32Array | ArrayLike<unknown>): Float32Array | ArrayLike<number> {
  if (values instanceof Float32Array) return values;
  for (let i = 0; i < values.length; i++) {
    if (typeof values[i] !== 'number') return Float32Array.from(values, (v) => (typeof v === 'number' ? v : NaN));
  }
  return values as ArrayLike<number>;
}
