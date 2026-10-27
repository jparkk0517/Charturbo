/**
 * Brush / box selection on 2D charts (`enableNodeInteractions({ brush: 'x' | 'xy' })`). The
 * engine maps the drag rectangle to data units, draws it, runs the selection query (line sample
 * runs, scatter point ids via its spatial hash, bar categories) and highlights scatter points;
 * this module only decodes its flat result and builds brush style parameters. DOM-free.
 */
import { parseColor, type ColorInput } from './color';

/** Brush shape: `'x'` = x interval over the full height (time range), `'xy'` = rectangle. */
export type BrushMode = 'x' | 'xy';

/** Run of selected samples `[start, end)` of one line / area series (live sample indices). */
export interface CharturboSelectionRange {
  series: number;
  start: number;
  end: number;
}

/** Brush selection (`'select'` event payload, `getSelection()`). */
export interface CharturboSelection {
  /** Area charts report `'line'` */
  /** Heatmaps / box plots / pies / combo / radar / gauge / funnel / waterfall charts have no brush: their `'select'` payloads are always empty */
  kind: 'line' | 'band' | 'errorBar' | 'impulse' | 'bar' | 'scatter' | 'candlestick' | 'ohlc' | 'heatmap' | 'box' | 'pie' | 'combo' | 'radar' | 'gauge' | 'funnel' | 'waterfall';
  /** Bars always brush x */
  mode: BrushMode;
  /** Brushed x range in data units (sample index / x value / category index); `null` = cleared */
  xRange: [number, number] | null;
  /** Brushed y range (`'xy'` mode); `null` = whole y range or cleared */
  yRange: [number, number] | null;
  /** Line / area: selected sample runs per visible series */
  ranges: CharturboSelectionRange[];
  /** Scatter: selected point ids (ascending, visible series only); bars: category indices; candles: candle indices */
  ids: Uint32Array;
  /** Selected samples / points / categories */
  count: number;
}

const KINDS: CharturboSelection['kind'][] = ['line', 'bar', 'scatter', 'candlestick', 'heatmap'];
const EMPTY_IDS = new Uint32Array(0);

export function brushModeCode(mode: BrushMode): number {
  return mode === 'xy' ? 1 : 0;
}

/** Selection payload of a cleared brush. */
export function emptySelection(kind: CharturboSelection['kind'], mode: BrushMode = 'x'): CharturboSelection {
  return { kind, mode, xRange: null, yRange: null, ranges: [], ids: EMPTY_IDS, count: 0 };
}

/**
 * Decodes the engine selection `[kind, mode, x0, x1, y0, y1, count, n, (series, start, end) * n]`
 * (empty = none) plus the scatter / bar ids.
 */
export function decodeSelection(header: Float64Array | undefined, ids: Uint32Array | undefined): CharturboSelection | null {
  if (!header || header.length < 8) return null;
  const n = header[7];
  const ranges: CharturboSelectionRange[] = [];
  for (let k = 0; k < n; k++) {
    const at = 8 + k * 3;
    ranges.push({ series: header[at], start: header[at + 1], end: header[at + 2] });
  }
  const hasY = Number.isFinite(header[4]) && Number.isFinite(header[5]);
  return {
    kind: KINDS[header[0]] ?? 'line',
    mode: header[1] === 1 ? 'xy' : 'x',
    xRange: [header[2], header[3]],
    yRange: hasY ? [header[4], header[5]] : null,
    ranges,
    ids: ids ?? EMPTY_IDS,
    count: header[6],
  };
}

export interface BrushStyleOptions {
  /** Border color; the fill is the same color at `fillOpacity` (default: engine blue-gray) */
  color?: ColorInput;
  /** Fill alpha multiplier of `color` (default 0.15) */
  fillOpacity?: number;
  /** Border width in CSS px (default 1; 0 = none) */
  borderWidth?: number;
}

/** `set_chart_brush_style` parameters (NaN = engine default). */
export function encodeBrushStyle(style: BrushStyleOptions): Float32Array {
  const out = new Float32Array(10).fill(NaN);
  if (style.color !== undefined) {
    const c = parseColor(style.color);
    const fill = style.fillOpacity ?? 0.15;
    out.set([c[0], c[1], c[2], c[3] * fill, c[0], c[1], c[2], c[3]], 0);
  }
  if (style.borderWidth !== undefined) out[8] = style.borderWidth;
  return out;
}
