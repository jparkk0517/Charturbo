/**
 * Decal pattern fills (ECharts `aria.decal` / `itemStyle.decal`): a pattern of small symbols
 * drawn over bars, pie slices, areas, treemap / sunburst cells and funnel stages so series stay
 * distinguishable without color. The engine draws the patterns procedurally in a second pass
 * (chart/decal.rs, no textures); this module validates and resolves the options and encodes
 * one spec per mark key. Patterns are anchored in screen space: tiles start at the canvas
 * top-left and stay put when marks move or animate (like CSS `background-attachment: fixed`).
 */
import { parseColor, type ColorInput, type RgbaTuple } from './color';

/** Pattern symbol (`'none'`: no pattern for this mark). */
export type DecalSymbol = 'rect' | 'circle' | 'triangle' | 'diamond' | 'line' | 'cross' | 'none';

/** Pattern of one series / item; missing fields come from the automatic pattern. */
export interface DecalOptions {
  /** Symbol tiled over the mark (`'line'`: stripes, `symbolSize` thick) */
  symbol?: DecalSymbol;
  /** Symbol size in CSS px (0 < size <= 512) */
  symbolSize?: number;
  /** Tile size in CSS px: distance between symbol centers (1..1024) */
  spacing?: number;
  /** Pattern rotation in degrees, clockwise on screen (SVG `rotate`) */
  rotation?: number;
  /** Symbol color; `'auto'` (default): black on light marks, white on dark ones */
  color?: ColorInput | 'auto';
  /** Symbol opacity 0..1 (times the color alpha and the mark alpha; default 0.45) */
  opacity?: number;
}

/**
 * Chart-level decals: `true` gives every series / category its own automatic pattern; an
 * object applies its fields over the automatic patterns. Default off.
 */
export type ChartDecalInput = boolean | DecalOptions;

/** Per-series / item decal: options over the chart-level pattern, or `false` for none. */
export type DecalOverride = DecalOptions | false | null | undefined;

/** A resolved pattern (`color` null = auto contrast). */
export interface ResolvedDecal {
  symbol: Exclude<DecalSymbol, 'none'>;
  symbolSize: number;
  spacing: number;
  rotation: number;
  color: RgbaTuple | null;
  opacity: number;
}

/** Floats per spec in `set_chart_decals` (decal.rs `DECAL_SPEC_STRIDE`). */
export const DECAL_SPEC_STRIDE = 8;

const SYMBOL_CODES: Record<DecalSymbol, number> = { none: 0, rect: 1, circle: 2, triangle: 3, diamond: 4, line: 5, cross: 6 };

type AutoDecal = Omit<ResolvedDecal, 'color' | 'opacity'>;

/** Automatic patterns, cycled by series / category index (distinct symbol or angle each). */
export const AUTO_DECALS: readonly AutoDecal[] = [
  { symbol: 'line', symbolSize: 2, spacing: 8, rotation: 45 },
  { symbol: 'circle', symbolSize: 3, spacing: 8, rotation: 0 },
  { symbol: 'rect', symbolSize: 3, spacing: 8, rotation: 0 },
  { symbol: 'cross', symbolSize: 6, spacing: 10, rotation: 45 },
  { symbol: 'line', symbolSize: 2, spacing: 8, rotation: -45 },
  { symbol: 'triangle', symbolSize: 5, spacing: 10, rotation: 0 },
  { symbol: 'diamond', symbolSize: 5, spacing: 10, rotation: 0 },
  { symbol: 'line', symbolSize: 2, spacing: 8, rotation: 0 },
];

const DEFAULT_OPACITY = 0.45;

/** Throws for invalid decal options (`where` prefixes the message). */
export function validateDecal(input: unknown, where: string): void {
  if (input === undefined || input === null || typeof input === 'boolean') return;
  if (typeof input !== 'object') throw new Error(`${where}: decal must be a boolean or an object`);
  const d = input as DecalOptions;
  if (d.symbol !== undefined && !Object.prototype.hasOwnProperty.call(SYMBOL_CODES, d.symbol)) {
    throw new Error(`${where}: decal.symbol "${String(d.symbol)}" is not one of ${Object.keys(SYMBOL_CODES).join(', ')}`);
  }
  const num = (name: string, v: unknown, ok: (x: number) => boolean, range: string) => {
    if (v !== undefined && !(typeof v === 'number' && Number.isFinite(v) && ok(v))) {
      throw new Error(`${where}: decal.${name} ${String(v)} must be ${range}`);
    }
  };
  num('symbolSize', d.symbolSize, (x) => x > 0 && x <= 512, 'in (0, 512]');
  num('spacing', d.spacing, (x) => x >= 1 && x <= 1024, 'in [1, 1024]');
  num('rotation', d.rotation, () => true, 'a finite number of degrees');
  num('opacity', d.opacity, (x) => x >= 0 && x <= 1, 'in [0, 1]');
  if (d.color !== undefined && d.color !== 'auto') {
    try {
      parseColor(d.color);
    } catch {
      throw new Error(`${where}: decal.color ${JSON.stringify(d.color)} is not a color`);
    }
  }
}

/** Validates a chart-level decal and a list of per-mark overrides (before the scene is cleared). */
export function validateDecals(chart: unknown, overrides: Iterable<unknown>, where: string): void {
  validateDecal(chart, where);
  let i = 0;
  for (const o of overrides) {
    if (o !== false) validateDecal(o, `${where} [${i}]`);
    i++;
  }
}

/**
 * Pattern of one mark: off unless the chart decal is on or the mark has its own options; own
 * options apply over the chart-level ones, which apply over automatic pattern `auto`.
 */
export function resolveDecal(chart: ChartDecalInput | undefined, own: DecalOverride, auto: number): ResolvedDecal | null {
  if (own === false) return null;
  const chartOn = chart === true || (typeof chart === 'object' && chart !== null);
  if (!chartOn && !own) return null;
  const base = AUTO_DECALS[((auto % AUTO_DECALS.length) + AUTO_DECALS.length) % AUTO_DECALS.length];
  // Explicit `undefined` fields keep the value below them
  const defined = (o: object | null | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
  const merged: DecalOptions = { ...base, ...defined(typeof chart === 'object' ? chart : null), ...defined(own || null) };
  if (merged.symbol === 'none') return null;
  const color = merged.color === undefined || merged.color === 'auto' ? null : parseColor(merged.color);
  return {
    symbol: merged.symbol as ResolvedDecal['symbol'],
    symbolSize: merged.symbolSize!,
    spacing: merged.spacing!,
    rotation: merged.rotation!,
    color,
    opacity: merged.opacity ?? DEFAULT_OPACITY,
  };
}

/**
 * Patterns of `count` mark keys (`own(key)` / `auto(key)`: override and automatic pattern
 * index); null when every key is off (nothing to send).
 */
export function resolveDecals(
  chart: ChartDecalInput | undefined,
  count: number,
  own: (key: number) => DecalOverride,
  auto: (key: number) => number
): (ResolvedDecal | null)[] | null {
  const out: (ResolvedDecal | null)[] = [];
  for (let k = 0; k < count; k++) out.push(resolveDecal(chart, own(k), auto(k)));
  return out.some((d) => d) ? out : null;
}

/** Engine specs `[symbol, size, spacing, rotation rad, r, g, b, opacity]` per key (r = -1: auto). */
export function encodeDecals(list: readonly (ResolvedDecal | null)[] | null): Float32Array {
  if (!list) return new Float32Array(0);
  const out = new Float32Array(list.length * DECAL_SPEC_STRIDE);
  list.forEach((d, k) => {
    if (!d) return;
    const [r, g, b, a] = d.color ?? [-1, 0, 0, 1];
    out.set([SYMBOL_CODES[d.symbol], d.symbolSize, d.spacing, (d.rotation * Math.PI) / 180, r, g, b, d.opacity * a], k * DECAL_SPEC_STRIDE);
  });
  return out;
}

/** Symbol color over a mark of color `base` (decal.rs `decal_paint`): `[r, g, b, a]` in 0..1. */
export function decalPaint(d: ResolvedDecal, base: RgbaTuple): RgbaTuple {
  if (d.color) return [d.color[0], d.color[1], d.color[2], d.opacity * d.color[3] * base[3]];
  const lum = 0.2126 * base[0] + 0.7152 * base[1] + 0.0722 * base[2];
  const v = lum > 0.5 ? 0 : 1;
  return [v, v, v, d.opacity * base[3]];
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);
const css = (c: RgbaTuple) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${fmt(c[3])})`;

/** SVG shape of the symbol centered at `(c, c)` (chart/svg.rs `svg_pattern`). */
function symbolShape(d: ResolvedDecal, c: number, fill: string): string {
  const r = d.symbolSize / 2;
  switch (d.symbol) {
    case 'rect':
      return `<rect x="${fmt(c - r)}" y="${fmt(c - r)}" width="${fmt(2 * r)}" height="${fmt(2 * r)}" fill="${fill}"/>`;
    case 'circle':
      return `<circle cx="${fmt(c)}" cy="${fmt(c)}" r="${fmt(r)}" fill="${fill}"/>`;
    case 'triangle': {
      // Equilateral, apex up, inscribed radius r / 2 (the shader's distance)
      const h = r / 2;
      return `<path d="M${fmt(c)} ${fmt(c - 2 * h)}L${fmt(c + h * Math.sqrt(3))} ${fmt(c + h)}L${fmt(c - h * Math.sqrt(3))} ${fmt(c + h)}Z" fill="${fill}"/>`;
    }
    case 'diamond':
      return `<path d="M${fmt(c)} ${fmt(c - r)}L${fmt(c + r)} ${fmt(c)}L${fmt(c)} ${fmt(c + r)}L${fmt(c - r)} ${fmt(c)}Z" fill="${fill}"/>`;
    case 'line':
      return `<rect x="0" y="${fmt(c - r)}" width="${fmt(2 * c)}" height="${fmt(2 * r)}" fill="${fill}"/>`;
    case 'cross': {
      const t = Math.max(0.5, 0.25 * r);
      return `<path d="M${fmt(c - r)} ${fmt(c - t)}H${fmt(c + r)}V${fmt(c + t)}H${fmt(c - r)}ZM${fmt(c - t)} ${fmt(c - r)}H${fmt(c + t)}V${fmt(c + r)}H${fmt(c - t)}Z" fill="${fill}"/>`;
    }
    default:
      return '';
  }
}

/** Standalone SVG of the pattern over a `width` x `height` box of color `base` (legend swatches). */
export function decalSwatchSvg(d: ResolvedDecal, base: RgbaTuple, width: number, height: number): string {
  const s = d.spacing;
  const rot = d.rotation ? ` patternTransform="rotate(${fmt(d.rotation)})"` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<defs><pattern id="d" patternUnits="userSpaceOnUse" width="${fmt(s)}" height="${fmt(s)}"${rot}>${symbolShape(d, s / 2, css(decalPaint(d, base)))}</pattern></defs>` +
    `<rect width="100%" height="100%" fill="${css(base)}"/><rect width="100%" height="100%" fill="url(#d)"/></svg>`
  );
}

/** CSS `background-image` of a legend swatch with the pattern over the mark color. */
export function decalSwatchCss(d: ResolvedDecal, base: RgbaTuple, width: number, height: number): string {
  return `url("data:image/svg+xml,${encodeURIComponent(decalSwatchSvg(d, base, width, height))}")`;
}
