/** Standalone scientific whiskers and event stems. The native engine owns all geometry. */
import { numericSamples } from './chart-linestyle';
import { parseOptionalColor } from './color';
import type { LineChartOptions, LineSeriesDescriptor } from './charturbo';

export type ScientificSamples = Float32Array | number[];
export type ScientificSeriesDescriptor = Pick<LineSeriesDescriptor, 'name' | 'values' | 'x' | 'color' | 'lineWidth' | 'yAxis'>;
export type ErrorBarMode = 'both' | 'high' | 'low';
export type ErrorBarDirection = 'vertical' | 'horizontal';
export interface ErrorBarStyleOptions {
  /** Full cap length: CSS px or a fraction of mean category spacing (default '40%'). */
  capWidth?: number | `${number}%`;
  errorMode?: ErrorBarMode;
  direction?: ErrorBarDirection;
  drawWhiskers?: boolean;
  drawConnector?: boolean;
  showCenter?: boolean;
  symbolSize?: number;
}
/** Choose absolute endpoints OR symmetric/asymmetric relative errors (absolute offsets). */
export type ErrorBarSeriesDescriptor = ScientificSeriesDescriptor & ErrorBarStyleOptions & (
  | { low: ScientificSamples; high: ScientificSamples; error?: never; errorLow?: never; errorHigh?: never }
  | { error: number | ScientificSamples; low?: never; high?: never; errorLow?: never; errorHigh?: never }
  | { errorLow: number | ScientificSamples; errorHigh: number | ScientificSamples; low?: never; high?: never; error?: never }
);
export interface ImpulseStyleOptions {
  /** Stem floor in data units (default 0). */
  baseline?: number;
  /** Show a circular tip even for a zero-length stem (default true). */
  showMarker?: boolean;
  symbolSize?: number;
}
export interface ImpulseSeriesDescriptor extends ScientificSeriesDescriptor, ImpulseStyleOptions {}
export type SparseChartOptions = Omit<LineChartOptions, 'viewMode' | 'nulls' | 'animation'>;
export interface ErrorBarChartOptions extends SparseChartOptions, ErrorBarStyleOptions {}
export interface ImpulseChartOptions extends SparseChartOptions, ImpulseStyleOptions {}
export interface ErrorBarMeta { low: Float32Array; high: Float32Array; direction: ErrorBarDirection }
export interface SparseMeta {
  kind: 'errorBar' | 'impulse';
  errors?: ErrorBarMeta[];
  baselines?: number[];
}
export interface EncodedSparse {
  lines: LineSeriesDescriptor[];
  meta: SparseMeta;
  styles: Float32Array[];
}

function finite(v: number, name: string, fn: string, nonnegative = true): number {
  if (!Number.isFinite(Math.fround(v)) || (nonnegative && v < 0)) throw new Error(`${fn}: invalid ${name}`);
  return v;
}
function lines(series: ScientificSeriesDescriptor[], options: SparseChartOptions | undefined, fn: string): LineSeriesDescriptor[] {
  const withX = series.filter(s => s.x !== undefined).length;
  if (withX && withX !== series.length) throw new Error(`${fn}: give x for every series or none`);
  return series.map(s => {
    if (s.x && s.x.length !== s.values.length) throw new Error(`${fn}: x length mismatch`);
    if (s.x) for (let i = 0; i < s.x.length; i++) {
      if (!Number.isFinite(Number(s.x[i])) || (i > 0 && Number(s.x[i]) < Number(s.x[i - 1]))) throw new Error(`${fn}: x must be finite and non-decreasing`);
    }
    parseOptionalColor(s.color);
    return { name: s.name, x: s.x, values: Float32Array.from(numericSamples(s.values)), color: s.color, yAxis: s.yAxis,
      lineWidth: finite(s.lineWidth ?? options?.lineWidth ?? 1.5, 'lineWidth', fn) };
  });
}

export function encodeErrors(series: ErrorBarSeriesDescriptor[], options?: ErrorBarChartOptions): EncodedSparse {
  const fn = 'renderErrorBarChart';
  const encoded = lines(series, options, fn);
  const errors: ErrorBarMeta[] = [];
  const styles = series.map((s, k) => {
    const n = s.values.length;
    const absolute = s.low !== undefined || s.high !== undefined;
    const symmetric = s.error !== undefined;
    const asymmetric = s.errorLow !== undefined || s.errorHigh !== undefined;
    if (Number(absolute) + Number(symmetric) + Number(asymmetric) !== 1) throw new Error(`${fn}: choose one error representation`);
    const channel = (v: number | ScientificSamples | undefined, name: string) => {
      if (v === undefined || (typeof v !== 'number' && v.length !== n)) throw new Error(`${fn}: ${name} length mismatch`);
      return typeof v === 'number' ? new Float32Array(n).fill(v) : Float32Array.from(numericSamples(v));
    };
    const low = channel(absolute ? s.low : symmetric ? s.error : s.errorLow, 'low');
    const high = channel(absolute ? s.high : symmetric ? s.error : s.errorHigh, 'high');
    const direction = s.direction ?? options?.direction ?? 'vertical';
    const mode = s.errorMode ?? options?.errorMode ?? 'both';
    if (!['vertical', 'horizontal'].includes(direction) || !['both', 'high', 'low'].includes(mode)) throw new Error(`${fn}: invalid direction or errorMode`);
    // Match v0.4 relative HLC: offsets are based on y, also for horizontal bars.
    for (let i = 0; i < n; i++) {
      if (!absolute) { low[i] = Number(encoded[k].values[i]) - Math.abs(low[i]); high[i] = Number(encoded[k].values[i]) + Math.abs(high[i]); }
      if (low[i] > high[i]) [low[i], high[i]] = [high[i], low[i]];
      if ((mode !== 'high' && !Number.isFinite(low[i])) || (mode !== 'low' && !Number.isFinite(high[i]))) encoded[k].values[i] = NaN;
    }
    const cap = s.capWidth ?? options?.capWidth ?? '40%';
    let capValue: number;
    if (typeof cap === 'string') {
      if (!/^\d+(?:\.\d+)?%$/.test(cap.trim())) throw new Error(`${fn}: invalid capWidth`);
      capValue = Math.min(1, finite(Number(cap.trim().slice(0, -1)), 'capWidth', fn) / 100);
    } else capValue = finite(cap, 'capWidth', fn);
    errors.push({ low, high, direction });
    // Explicit x lets horizontal endpoint extents participate in the native x domain.
    if (!encoded[k].x) encoded[k].x = Float64Array.from({ length: n }, (_, i) => i);
    return new Float32Array([direction === 'horizontal' ? 1 : 0, { both: 0, high: 1, low: 2 }[mode], capValue,
      typeof cap === 'string' ? 1 : 0, (s.drawWhiskers ?? options?.drawWhiskers ?? true) ? 1 : 0,
      (s.drawConnector ?? options?.drawConnector ?? true) ? 1 : 0, (s.showCenter ?? options?.showCenter ?? false) ? 1 : 0,
      finite(s.symbolSize ?? options?.symbolSize ?? 6, 'symbolSize', fn)]);
  });
  return { lines: encoded, meta: { kind: 'errorBar', errors }, styles };
}

export function encodeImpulses(series: ImpulseSeriesDescriptor[], options?: ImpulseChartOptions): EncodedSparse {
  const fn = 'renderImpulseChart';
  const encoded = lines(series, options, fn);
  const baselines = series.map(s => finite(s.baseline ?? options?.baseline ?? 0, 'baseline', fn, false));
  const styles = series.map((s, i) => new Float32Array([baselines[i], (s.showMarker ?? options?.showMarker ?? true) ? 1 : 0,
    finite(s.symbolSize ?? options?.symbolSize ?? 6, 'symbolSize', fn)]));
  return { lines: encoded, meta: { kind: 'impulse', baselines }, styles };
}

export function sparseTooltip(meta: SparseMeta | undefined, series: number, index: number): {
  errorBar?: { low: number; high: number; direction: ErrorBarDirection }; baseline?: number;
} {
  const e = meta?.errors?.[series];
  if (e) return { errorBar: { low: e.low[index], high: e.high[index], direction: e.direction } };
  const baseline = meta?.baselines?.[series];
  return baseline === undefined ? {} : { baseline };
}
