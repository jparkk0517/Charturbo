/** Standalone dual-Y bands share the native line axis / navigation engine. */
import { encodeLineStyles, numericSamples } from './chart-linestyle';
import { parseOptionalColor } from './color';
import type { LineChartOptions, LineSeriesDescriptor } from './charturbo';

export interface BandSeriesDescriptor extends Pick<LineSeriesDescriptor, 'name' | 'x' | 'color' | 'yAxis' | 'curve'> {
  /** First edge; the name is conventional: crossings with `upper` are preserved. */
  lower: Float32Array | number[];
  /** Second edge, with one value per first-edge sample. Non-finite pairs leave a gap. */
  upper: Float32Array | number[];
  /** CSS-pixel boundary strokes (default 0: fill only). */
  lowerLineWidth?: number;
  upperLineWidth?: number;
  /** Series color alpha multiplier (default 0.25). */
  fillOpacity?: number;
  /** Bridge missing pairs (default false). */
  connectNulls?: boolean;
}

export interface BandChartOptions extends Omit<LineChartOptions, 'viewMode' | 'lineWidth' | 'nulls' | 'animation'> {
  lowerLineWidth?: number;
  upperLineWidth?: number;
  fillOpacity?: number;
  connectNulls?: boolean;
}

export interface EncodedBand {
  line: LineSeriesDescriptor;
  lower: Float32Array;
  upper: Float32Array;
  opacity: number;
  widths: [number, number];
}

/** Validate the entire request before the SDK replaces a live chart. */
export function encodeBands(series: BandSeriesDescriptor[], options?: BandChartOptions): EncodedBand[] {
  const fn = 'renderBandChart';
  const withX = series.filter((s) => s.x !== undefined).length;
  if (withX && withX !== series.length) throw new Error(`${fn}: give x for every series or none`);
  const finite = (v: number, max: number, what: string) => {
    if (!Number.isFinite(Math.fround(v)) || v < 0 || v > max) throw new Error(`${fn}: ${what} must be finite in [0, ${max}]`);
    return v;
  };
  return series.map((s, i) => {
    const n = s.lower.length;
    if (s.upper.length !== n || (s.x && s.x.length !== n)) throw new Error(`${fn}: series ${i} needs equal lower, upper and x lengths`);
    if (s.x) for (let j = 0; j < n; j++) {
      const x = Number(s.x[j]);
      if (!Number.isFinite(x) || (j > 0 && x < Number(s.x[j - 1]))) throw new Error(`${fn}: series ${i} x must be finite and non-decreasing`);
    }
    parseOptionalColor(s.color);
    const lower = Float32Array.from(numericSamples(s.lower));
    const upper = Float32Array.from(numericSamples(s.upper));
    const values = Float32Array.from(lower, (v, j) => Number.isFinite(v) && Number.isFinite(upper[j]) ? v * 0.5 + upper[j] * 0.5 : NaN);
    const line: LineSeriesDescriptor = {
      name: s.name, x: s.x, color: s.color, yAxis: s.yAxis, curve: s.curve, values,
      lineWidth: 0, nulls: (s.connectNulls ?? options?.connectNulls) ? 'connect' : 'gap',
    };
    encodeLineStyles([line], undefined, fn);
    return {
      line, lower, upper,
      opacity: finite(s.fillOpacity ?? options?.fillOpacity ?? 0.25, 1, 'fillOpacity'),
      widths: [finite(s.lowerLineWidth ?? options?.lowerLineWidth ?? 0, Number.MAX_VALUE, 'lowerLineWidth'),
        finite(s.upperLineWidth ?? options?.upperLineWidth ?? 0, Number.MAX_VALUE, 'upperLineWidth')],
    };
  });
}
