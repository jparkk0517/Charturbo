/**
 * Color inputs of the SDK: linear `[r, g, b, a]` tuples in 0..1 (what the engine consumes) or
 * CSS color strings. `parseColor` resolves hex / `rgb()` / `rgba()` / `hsl()` / `hsla()` itself
 * (works without a DOM); any other CSS color (named colors, `color()`, `oklch()`, ...) goes
 * through a 2D canvas context when `document` exists.
 */

export type RgbaTuple = [number, number, number, number];
/** `[r, g, b, a]` in 0..1, or a CSS color string (`'#3b82f6'`, `'#3b82f680'`, `'rgb(59 130 246 / 50%)'`, `'tomato'`) */
export type ColorInput = RgbaTuple | string;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`. */
function parseHex(s: string): RgbaTuple | null {
  if (!/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s)) return null;
  let h = s.slice(1);
  if (h.length <= 4) h = [...h].map((c) => c + c).join('');
  const byte = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
  return [byte(0), byte(2), byte(4), h.length === 8 ? byte(6) : 1];
}

/** Number or percentage (`pct` = the value of 100%). */
function parseComponent(tok: string, pct: number): number {
  const v = parseFloat(tok);
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?%?$/i.test(tok)) return NaN;
  return tok.endsWith('%') ? (v / 100) * pct : v;
}

/** Hue in degrees from `deg` / `rad` / `grad` / `turn` / unitless. */
function parseHue(tok: string): number {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(deg|rad|grad|turn)?$/i.exec(tok);
  if (!m) return NaN;
  const v = parseFloat(m[1]);
  switch (m[2]?.toLowerCase()) {
    case 'rad':
      return (v * 180) / Math.PI;
    case 'grad':
      return v * 0.9;
    case 'turn':
      return v * 360;
    default:
      return v;
  }
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 30;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + hue) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** `rgb()` / `rgba()` / `hsl()` / `hsla()`, legacy comma or modern space + `/ alpha` syntax. */
function parseFunctional(s: string): RgbaTuple | null {
  const m = /^(rgba?|hsla?)\(\s*(.*?)\s*\)$/i.exec(s);
  if (!m) return null;
  const body = m[2];
  let parts: string[];
  let alphaTok: string | undefined;
  if (body.includes(',')) {
    parts = body.split(/\s*,\s*/);
    if (parts.length === 4) alphaTok = parts.pop();
  } else {
    const [main, alpha, ...rest] = body.split(/\s*\/\s*/);
    if (rest.length) return null;
    parts = main.split(/\s+/);
    alphaTok = alpha;
  }
  if (parts.length !== 3) return null;
  const alpha = alphaTok === undefined ? 1 : parseComponent(alphaTok, 1);
  let rgb: [number, number, number];
  if (m[1].toLowerCase().startsWith('rgb')) {
    rgb = parts.map((p) => parseComponent(p, 255) / 255) as [number, number, number];
  } else {
    const h = parseHue(parts[0]);
    // Percent signs are optional in the modern syntax (bare 0..100)
    const pct = (p: string) => (p.endsWith('%') ? parseComponent(p, 1) : parseComponent(p, 1) / 100);
    rgb = hslToRgb(h, clamp01(pct(parts[1])), clamp01(pct(parts[2])));
  }
  const out = [...rgb, alpha];
  if (out.some((v) => !Number.isFinite(v))) return null;
  return out.map(clamp01) as RgbaTuple;
}

let ctx2d: CanvasRenderingContext2D | null | undefined;

/** Any other CSS color, resolved by the browser (named colors, `color()`, `oklch()`, ...). */
function parseWithCanvas(s: string): RgbaTuple | null {
  if (ctx2d === undefined) {
    ctx2d = null;
    try {
      if (typeof document !== 'undefined') {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        ctx2d = canvas.getContext('2d', { willReadFrequently: true });
      }
    } catch {
      ctx2d = null;
    }
  }
  const ctx = ctx2d;
  if (!ctx) return null;
  // Invalid strings leave `fillStyle` unchanged: probe with two different sentinels
  ctx.fillStyle = '#000';
  ctx.fillStyle = s;
  const a = String(ctx.fillStyle);
  ctx.fillStyle = '#fff';
  ctx.fillStyle = s;
  if (String(ctx.fillStyle) !== a) return null;
  // Serialized as `#rrggbb` / `rgba(...)` in sRGB; wide-gamut forms are read back as pixels
  const parsed = parseHex(a) ?? parseFunctional(a);
  if (parsed) return parsed;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  // `getImageData` returns non-premultiplied sRGB bytes
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
}

const cache = new Map<string, RgbaTuple>();
const CACHE_LIMIT = 512;

/**
 * Resolves a `ColorInput` to `[r, g, b, a]` in 0..1. Tuples pass through; strings are parsed
 * (cached). Throws `TypeError` for an unrecognized string.
 */
export function parseColor(input: ColorInput): RgbaTuple {
  if (typeof input !== 'string') return input;
  const key = input.trim().toLowerCase();
  const hit = cache.get(key);
  if (hit) return [...hit];
  const out = key === 'transparent' ? ([0, 0, 0, 0] as RgbaTuple) : (parseHex(key) ?? parseFunctional(key) ?? parseWithCanvas(key));
  if (!out) throw new TypeError(`Invalid color: "${input}"`);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(key, out);
  return [...out];
}

/** `parseColor` of an optional input (`undefined` stays `undefined`). */
export function parseOptionalColor(input: ColorInput | undefined): RgbaTuple | undefined {
  return input === undefined ? undefined : parseColor(input);
}

/** CSS `rgb()` / `rgba()` text of a color (channels clamped, alpha rounded to 3 decimals). */
export function cssColor(input: ColorInput): string {
  const c = parseColor(input).map((v) => Math.min(1, Math.max(0, v)));
  const [r, g, b] = c.map((v) => Math.round(v * 255));
  const a = Math.round(c[3] * 1000) / 1000;
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${a})`;
}
