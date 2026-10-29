/**
 * Pictorial bars (ECharts `pictorialBar`): a 2D bar chart whose bars are drawn as symbols.
 * `renderPictorialBarChart` renders the bar chart (axes, categories, orientation, stacking,
 * hover, labels, background tracks as shadow bars) and then hands the engine one symbol record
 * per bar (pictorial.rs places, repeats, clips and tessellates the symbols on the GPU side).
 * This module validates and encodes the symbol options; it never touches the scene, so invalid
 * input throws before the current chart is cleared.
 */
import type { BarChartItemDescriptor, BarSeriesDescriptor, GroupedBarChartOptions } from './charturbo';

/** Built-in symbol names, or SVG path data after `path://` (`image://` is not supported). */
export type PictorialSymbol =
  | 'circle'
  | 'rect'
  | 'roundRect'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'arrow'
  | 'pin'
  | 'none'
  | `path://${string}`;

/** CSS pixels, or a percent string (`'50%'`) of a reference length. */
export type PictorialLength = number | `${number}%`;

/** Symbol options of a pictorial bar (chart default, series or item; the most specific wins). */
export interface PictorialSymbolOptions {
  /** Default `'circle'`. `path://` paths are scaled to the symbol box (aspect not kept) */
  symbol?: PictorialSymbol;
  /**
   * `[width, height]` on screen, or one value for both (default `['100%', '100%']`). Percents:
   * of the bar thickness on the category axis; on the value axis of the bar length (or of the
   * `symbolBoundingData` length), or of the bar thickness when repeating
   */
  symbolSize?: PictorialLength | readonly [PictorialLength, PictorialLength];
  /**
   * `false` (default): one symbol. `true`: repeated over the bar length. A number: that many.
   * `'fixed'`: as many as fit the bounding length (plot edge / `symbolBoundingData`), whatever
   * the value (combine with `symbolClip` for a "fill level" look)
   */
  symbolRepeat?: boolean | number | 'fixed';
  /**
   * Gap on each side of a repeated symbol, px or percent of its value-axis size (default
   * `'15%'`); the gaps are re-spread so the run fills its length. A trailing `!` (`'10%!'`)
   * keeps gaps at both ends of the run too
   */
  symbolMargin?: PictorialLength | `${number}!` | `${number}%!`;
  /** Clip the symbols at the data value (default false) */
  symbolClip?: boolean;
  /** Where a single symbol / the repeated run sits along the bar (default `'start'`) */
  symbolPosition?: 'start' | 'end' | 'center';
  /** Screen `[right, down]` offset, px or percent of the symbol size; one value for both */
  symbolOffset?: PictorialLength | readonly [PictorialLength, PictorialLength];
  /** Rotation in degrees, positive = anticlockwise (default 0) */
  symbolRotate?: number;
  /**
   * Value the symbols are laid out against instead of the bar value: one value, or
   * `[negative, positive]` bounds for negative / positive bars
   */
  symbolBoundingData?: number | readonly [number, number];
}

/** One bar of a single-series pictorial bar chart. */
export interface PictorialBarItem extends BarChartItemDescriptor, PictorialSymbolOptions {}

/** One series of a multi-series pictorial bar chart. */
export interface PictorialBarSeries extends BarSeriesDescriptor, PictorialSymbolOptions {}

export interface PictorialBarChartData {
  categories: string[];
  series: PictorialBarSeries[];
}

/** Bar chart options (2D only; `mode` / `groupGap` / `barGap` apply to series data) plus symbol defaults. */
export interface PictorialBarChartOptions extends GroupedBarChartOptions, PictorialSymbolOptions {}

/** Floats per bar in `set_chart_bar_pictorial` records (pictorial.rs `PICTORIAL_STRIDE`). */
export const PICTORIAL_STRIDE = 19;
/** Repeat count limit (pictorial.rs `MAX_PICTORIAL_REPEAT`). */
const MAX_REPEAT = 1000;

const BUILT_IN = new Set(['circle', 'rect', 'roundRect', 'square', 'triangle', 'diamond', 'arrow', 'pin', 'none']);
const POSITIONS = { start: 0, end: 1, center: 2 } as const;
const SYMBOL_KEYS = [
  'symbol',
  'symbolSize',
  'symbolRepeat',
  'symbolMargin',
  'symbolClip',
  'symbolPosition',
  'symbolOffset',
  'symbolRotate',
  'symbolBoundingData',
] as const;

/** `[value, isPercent]` of a length, or `null` when it is not one. */
function length(v: unknown): [number, 0 | 1] | null {
  if (typeof v === 'number') return Number.isFinite(v) ? [v, 0] : null;
  if (typeof v !== 'string') return null;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(%?)\s*$/.exec(v);
  return m ? [Number(m[1]), m[2] ? 1 : 0] : null;
}

function pair(v: unknown): [unknown, unknown] {
  return Array.isArray(v) ? [v[0], v[1]] : [v, v];
}

/** The symbol options of `o` that are set (an item's `value` / `label` are not options). */
function pick(o: PictorialSymbolOptions | undefined): PictorialSymbolOptions {
  const out: Record<string, unknown> = {};
  if (o) for (const k of SYMBOL_KEYS) if (o[k] !== undefined) out[k] = o[k];
  return out as PictorialSymbolOptions;
}

/**
 * Engine records of the bars `perBar` (by bar id) over the chart `defaults`. `valid` checks a
 * symbol with the engine (`path://` data); throws `fn: …` for any invalid option.
 */
export function encodePictorial(
  perBar: readonly (PictorialSymbolOptions | undefined)[],
  defaults: PictorialSymbolOptions | undefined,
  valid: (symbol: string) => boolean,
  fn = 'renderPictorialBarChart'
): { symbols: string; records: Float32Array } {
  const base = pick(defaults);
  const symbols: string[] = [];
  const index = new Map<string, number>();
  const checked = new Map<string, boolean>();
  const records = new Float32Array(perBar.length * PICTORIAL_STRIDE);
  perBar.forEach((item, i) => {
    const o = { ...base, ...pick(item) };
    const where = perBar.length > 1 ? ` (bar ${i})` : '';
    const fail = (key: string, why: string): never => {
      throw new Error(`${fn}: ${key}${where} ${why}`);
    };

    const raw = o.symbol ?? 'circle';
    if (typeof raw !== 'string') fail('symbol', 'must be a string');
    // One line per symbol in the engine's list: path data whitespace (newlines) is one space
    const symbol = raw.startsWith('path://') ? raw.replace(/\s+/g, ' ').trim() : raw;
    if (symbol.startsWith('image://')) fail('symbol', 'uses image://: image:// symbols are not supported (use a built-in name or path://)');
    if (!index.has(symbol)) {
      if (symbol.startsWith('path://')) {
        if (!checked.has(symbol)) checked.set(symbol, valid(symbol));
        if (!checked.get(symbol)) fail('symbol', `is an invalid path: '${symbol.slice(0, 40)}'`);
      } else if (!BUILT_IN.has(symbol)) {
        fail('symbol', `'${symbol}' is not a built-in symbol (${[...BUILT_IN].join(', ')}) or path://`);
      }
      index.set(symbol, symbols.length);
      symbols.push(symbol);
    }

    const r = records.subarray(i * PICTORIAL_STRIDE, (i + 1) * PICTORIAL_STRIDE);
    r[0] = index.get(symbol)!;

    const repeat = o.symbolRepeat ?? false;
    if (repeat === true) r[1] = 1;
    else if (repeat === 'fixed') r[1] = 2;
    else if (typeof repeat === 'number') {
      if (!Number.isInteger(repeat) || repeat < 0 || repeat > MAX_REPEAT) fail('symbolRepeat', `must be an integer 0..${MAX_REPEAT}`);
      r[1] = 3;
      r[2] = repeat;
    } else if (repeat !== false) fail('symbolRepeat', "must be a boolean, a count or 'fixed'");

    const [w, h] = pair(o.symbolSize ?? '100%').map(length);
    if (!w || !h || w[0] < 0 || h[0] < 0) fail('symbolSize', "must be lengths >= 0 (px or '50%')");
    r.set([...w!, ...h!], 3);

    const rawMargin = o.symbolMargin ?? '15%';
    const endGap = typeof rawMargin === 'string' && rawMargin.trim().endsWith('!');
    const margin = length(endGap ? (rawMargin as string).trim().slice(0, -1) : rawMargin);
    if (!margin) fail('symbolMargin', "must be a length (px or '15%', '!' suffix = end gaps)");
    r.set([...margin!, endGap ? 1 : 0], 7);

    if (o.symbolClip !== undefined && typeof o.symbolClip !== 'boolean') fail('symbolClip', 'must be a boolean');
    r[10] = o.symbolClip ? 1 : 0;

    const position = POSITIONS[(o.symbolPosition ?? 'start') as keyof typeof POSITIONS];
    if (position === undefined) fail('symbolPosition', "must be 'start', 'end' or 'center'");
    r[11] = position;

    const [ox, oy] = pair(o.symbolOffset ?? 0).map(length);
    if (!ox || !oy) fail('symbolOffset', "must be lengths (px or '50%')");
    r.set([...ox!, ...oy!], 12);

    const rotate = o.symbolRotate ?? 0;
    if (typeof rotate !== 'number' || !Number.isFinite(rotate)) fail('symbolRotate', 'must be a finite number of degrees');
    r[16] = rotate;

    const bounds = o.symbolBoundingData;
    if (bounds === undefined) {
      r[17] = NaN;
      r[18] = NaN;
    } else {
      const [a, b] = pair(bounds);
      if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
        fail('symbolBoundingData', 'must be a finite value or [negative, positive]');
      }
      r[17] = Math.min(a as number, b as number);
      r[18] = Math.max(a as number, b as number);
    }
  });
  return { symbols: symbols.join('\n'), records };
}

/** Symbol options of every bar id of `data` (`series * categories + category` for series data). */
export function pictorialPerBar(data: readonly PictorialBarItem[] | PictorialBarChartData): (PictorialSymbolOptions | undefined)[] {
  if (Array.isArray(data)) return data as PictorialBarItem[];
  const d = data as PictorialBarChartData;
  const n = d.categories?.length ?? 0;
  return (d.series ?? []).flatMap((s) => Array.from({ length: n }, () => s));
}
