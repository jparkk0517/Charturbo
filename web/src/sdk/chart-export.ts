/**
 * Chart image export (PNG / JPEG / WebP): the GPU canvas plus the DOM overlay (title, legend,
 * axis ticks / titles, annotation labels, ...) composited into one 2D canvas.
 *
 * Capture: a WebGPU canvas only holds its frame until the task that rendered it ends (after
 * presentation the drawing buffer is swapped out, like WebGL without `preserveDrawingBuffer`).
 * So every capture renders and `drawImage`s the canvas in the same synchronous block; a blank
 * (all transparent) read back is retried on the next animation frame.
 *
 * Overlay: a generic DOM walk of the overlay root, so future overlay elements export too. Each
 * visible element paints its background box (legend swatches, label chips) and its own text
 * nodes, at the laid-out position (`getBoundingClientRect`, so CSS translate / flex layout are
 * already applied) with the computed font / color / opacity / line-through. Rotations
 * (`rotate(-90deg)` y axis title) are read from the computed transform and drawn around the box
 * center. Mark an element `data-charturbo-export="false"` to leave it out.
 */
import type { RgbaTuple, CharturboTheme } from './charturbo';

export type ChartImageFormat = 'png' | 'jpeg' | 'webp';

export interface ChartImageOptions {
  /** Default `'png'` */
  format?: ChartImageFormat;
  /** JPEG / WebP quality 0-1 (browser default when omitted) */
  quality?: number;
  /** Output pixels per CSS pixel (default: the canvas' current ratio). Re-renders at that size. */
  pixelRatio?: number;
  /**
   * `'theme'` (default): the theme surface; `'transparent'`: alpha background (JPEG flattens it
   * to black); any CSS color.
   */
  background?: 'theme' | 'transparent' | string;
  /** Composite the DOM overlay (title, legend, axes); default true */
  overlay?: boolean;
}

/** What the exporter needs from the SDK (read lazily per export). */
export interface ChartExportHost {
  canvas: HTMLCanvasElement | null;
  overlay: HTMLElement | null;
  theme: CharturboTheme;
  backend: {
    resize(width: number, height: number): void;
    set_clear_color?(r: number, g: number, b: number, a: number): void;
  };
  /** `sdk.render()`: draw a frame (and keep the overlay in sync) */
  render: () => void;
  /** Paints the watermark over a `cssW x cssH` frame at `scale` (under the overlay) */
  watermark?: (ctx: CanvasRenderingContext2D, cssW: number, cssH: number, scale: number) => void;
}

/** WebGPU's guaranteed `maxTextureDimension2D` */
export const MAX_EXPORT_DIM = 8192;
const BLANK_RETRIES = 2;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export interface ParsedTransform {
  /** Clockwise rotation in radians (CSS convention, y down) */
  angle: number;
  /** Translation: `px` absolute, `pct` of the element's own box */
  tx: { px: number; pct: number };
  ty: { px: number; pct: number };
}

function parseLength(s: string): { px: number; pct: number } {
  const v = parseFloat(s);
  if (!Number.isFinite(v)) return { px: 0, pct: 0 };
  return s.trim().endsWith('%') ? { px: 0, pct: v / 100 } : { px: v, pct: 0 };
}

function parseAngle(s: string): number {
  const v = parseFloat(s);
  if (!Number.isFinite(v)) return 0;
  const t = s.trim();
  if (t.endsWith('grad')) return (v * Math.PI) / 200;
  if (t.endsWith('rad')) return v;
  if (t.endsWith('turn')) return v * 2 * Math.PI;
  return (v * Math.PI) / 180;
}

/**
 * CSS `transform` -> rotation + translation. Handles the computed `matrix(a, b, c, d, e, f)` form
 * and the authored `translate(-50%, -100%) rotate(-90deg)` forms (functions compose in order).
 */
export function parseTransform(s: string | null | undefined): ParsedTransform {
  const out: ParsedTransform = { angle: 0, tx: { px: 0, pct: 0 }, ty: { px: 0, pct: 0 } };
  if (!s || s === 'none') return out;
  const re = /([a-zA-Z0-9]+)\(([^)]*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const fn = m[1];
    const args = m[2].split(/[\s,]+/).filter(Boolean);
    switch (fn) {
      case 'matrix': {
        const [a, b, , , e, f] = args.map(Number);
        out.angle += Math.atan2(b, a);
        out.tx.px += e || 0;
        out.ty.px += f || 0;
        break;
      }
      case 'translate': {
        const x = parseLength(args[0] ?? '0');
        const y = parseLength(args[1] ?? '0');
        out.tx.px += x.px;
        out.tx.pct += x.pct;
        out.ty.px += y.px;
        out.ty.pct += y.pct;
        break;
      }
      case 'translateX': {
        const x = parseLength(args[0] ?? '0');
        out.tx.px += x.px;
        out.tx.pct += x.pct;
        break;
      }
      case 'translateY': {
        const y = parseLength(args[0] ?? '0');
        out.ty.px += y.px;
        out.ty.pct += y.pct;
        break;
      }
      case 'rotate':
      case 'rotateZ':
        out.angle += parseAngle(args[0] ?? '0');
        break;
    }
  }
  return out;
}

/** `#rgb[a]`, `#rrggbb[aa]`, `rgb[a](r, g, b[, a])` / `rgb(r g b / a)` -> 0-1 RGBA. */
export function parseCssColor(s: string): RgbaTuple | null {
  const t = s.trim().toLowerCase();
  if (t === 'transparent') return [0, 0, 0, 0];
  const hexM = /^#([0-9a-f]{3,8})$/.exec(t);
  if (hexM) {
    let h = hexM[1];
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), h.length === 8 ? n(6) : 1];
  }
  const fnM = /^rgba?\(([^)]*)\)$/.exec(t);
  if (fnM) {
    const parts = fnM[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const ch = (p: string) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / 255);
    const alpha = parts[3] === undefined ? 1 : parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
    const c: RgbaTuple = [ch(parts[0]), ch(parts[1]), ch(parts[2]), alpha];
    return c.every(Number.isFinite) ? (c.map((v) => Math.min(1, Math.max(0, v))) as RgbaTuple) : null;
  }
  return null;
}

export function rgbaCss(c: RgbaTuple): string {
  const [r, g, b] = c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, c[3]))})`;
}

export type ResolvedBackground =
  | { mode: 'theme'; color: RgbaTuple }
  /** Opaque color: rendered as the GPU clear color */
  | { mode: 'color'; color: RgbaTuple }
  /** Alpha background; `under` = translucent CSS color painted beneath the marks */
  | { mode: 'transparent'; under: string | null };

/**
 * Export background. `normalize` turns any CSS color (names, hsl, ...) into hex / rgb() (the
 * browser does it via a 2D context `fillStyle`); unknown colors fall back to the theme.
 */
export function resolveBackground(
  bg: ChartImageOptions['background'],
  theme: CharturboTheme,
  normalize: (css: string) => string = (c) => c
): ResolvedBackground {
  if (!bg || bg === 'theme') return { mode: 'theme', color: theme.surface };
  if (bg === 'transparent') return { mode: 'transparent', under: null };
  const c = parseCssColor(normalize(bg)) ?? parseCssColor(bg);
  if (!c) return { mode: 'theme', color: theme.surface };
  if (c[3] >= 1) return { mode: 'color', color: c };
  return { mode: 'transparent', under: c[3] > 0 ? rgbaCss(c) : null };
}

/** Output size in device pixels, scaled down to fit `maxDim` per side. */
export function exportSize(cssW: number, cssH: number, ratio: number, maxDim = MAX_EXPORT_DIM): { width: number; height: number; ratio: number } {
  let r = Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
  const longest = Math.max(cssW, cssH, 1) * r;
  if (longest > maxDim) r *= maxDim / longest;
  return { width: Math.max(1, Math.round(cssW * r)), height: Math.max(1, Math.round(cssH * r)), ratio: r };
}

/**
 * Exact alpha from the same frame rendered over black and over white:
 * `onBlack = a * c`, `onWhite = a * c + (1 - a)` -> `a = 1 - (white - black)`, `c = black / a`.
 * Writes straight (non-premultiplied) RGBA into `out` (may alias `onBlack`).
 */
export function unmixAlpha(onBlack: Uint8ClampedArray, onWhite: Uint8ClampedArray, out: Uint8ClampedArray = onBlack): Uint8ClampedArray {
  for (let i = 0; i < onBlack.length; i += 4) {
    const br = onBlack[i];
    const bgc = onBlack[i + 1];
    const bb = onBlack[i + 2];
    // Mean over channels absorbs per-channel rounding
    const d = (onWhite[i] - br + (onWhite[i + 1] - bgc) + (onWhite[i + 2] - bb)) / 3;
    const a = Math.min(255, Math.max(0, 255 - d));
    if (a <= 0) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    const k = 255 / a;
    out[i] = br * k;
    out[i + 1] = bgc * k;
    out[i + 2] = bb * k;
    out[i + 3] = a;
  }
  return out;
}

/** `n x n` probe grid (pixel centers) over a `w x h` image for blank detection. */
export function probePoints(w: number, h: number, n = 5): [number, number][] {
  const pts: [number, number][] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pts.push([Math.min(w - 1, Math.floor(((i + 0.5) / n) * w)), Math.min(h - 1, Math.floor(((j + 0.5) / n) * h))]);
    }
  }
  return pts;
}

/** True when every probe pixel is fully transparent (the GPU frame was already gone). */
export function isBlankCapture(alphaAt: (x: number, y: number) => number, w: number, h: number): boolean {
  return probePoints(w, h).every(([x, y]) => alphaAt(x, y) === 0);
}

/** Box in CSS px relative to the canvas' top-left. */
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type OverlayDrawOp =
  | { kind: 'rect'; box: Box; color: string; radius: number; opacity: number }
  | {
      kind: 'text';
      text: string;
      /** Laid-out box of the text (rotated texts: its axis-aligned bounds) */
      box: Box;
      font: string;
      color: string;
      opacity: number;
      angle: number;
      lineThrough: boolean;
      /** Clip width for `text-overflow: ellipsis` (Infinity = none) */
      maxWidth: number;
    };

/** Canvas `fillText` anchor of a text box: left / middle when upright, centered when rotated. */
export function textAnchor(box: Box, angle: number): { x: number; y: number; align: 'left' | 'center' } {
  const cy = box.top + box.height / 2;
  if (Math.abs(angle) < 1e-3) return { x: box.left, y: cy, align: 'left' };
  return { x: box.left + box.width / 2, y: cy, align: 'center' };
}

/** `text` shortened with an ellipsis to `maxWidth` (as `text-overflow: ellipsis` shows it). */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (!Number.isFinite(maxWidth) || measure(text) <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measure(text.slice(0, mid) + '…') <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}

/** Corner radius in px of a computed `border-radius` (first value) for a `w x h` box. */
export function borderRadiusPx(s: string | undefined, w: number, h: number): number {
  if (!s) return 0;
  const first = s.trim().split(/\s+/)[0] ?? '';
  const v = parseFloat(first);
  if (!Number.isFinite(v) || v <= 0) return 0;
  const r = first.endsWith('%') ? (v / 100) * Math.min(w, h) : v;
  return Math.min(r, Math.min(w, h) / 2);
}

/** Subset of `CSSStyleDeclaration` the walk reads. */
export interface OverlayStyle {
  display: string;
  visibility: string;
  opacity: string;
  color: string;
  backgroundColor: string;
  borderRadius?: string;
  fontStyle: string;
  fontWeight: string;
  fontSize: string;
  fontFamily: string;
  transform: string;
  textDecorationLine?: string;
  textDecoration?: string;
  overflow?: string;
  textOverflow?: string;
  clip?: string;
}

/** Layout queries (the browser: `getComputedStyle` / `getBoundingClientRect` / `Range`). */
export interface OverlayEnv {
  style(el: Element): OverlayStyle;
  /** Viewport rect of an element */
  rect(el: Element): Box;
  /** Viewport rect of a text node (falls back to its element's) */
  textRect(node: Text, el: Element): Box;
}

function isTransparentColor(c: string): boolean {
  if (!c || c === 'transparent') return true;
  const p = parseCssColor(c);
  return !p || p[3] <= 0;
}

/**
 * Draw ops of every visible element under `root`, in paint (document) order, with boxes
 * relative to `origin` (the canvas' viewport position).
 */
export function collectOverlayOps(root: Element, origin: { left: number; top: number }, env: OverlayEnv): OverlayDrawOp[] {
  const ops: OverlayDrawOp[] = [];
  const rel = (b: Box): Box => ({ left: b.left - origin.left, top: b.top - origin.top, width: b.width, height: b.height });

  const visit = (el: Element, opacity: number, angle: number, strike: boolean) => {
    if (el.getAttribute?.('data-charturbo-export') === 'false') return;
    const s = env.style(el);
    if (s.display === 'none') return;
    const o = opacity * (s.opacity === '' || s.opacity === undefined ? 1 : parseFloat(s.opacity));
    if (!(o > 0)) return;
    const box = env.rect(el);
    // Visually hidden (screen-reader only) content
    if (s.clip && /rect\(\s*0(px)?[\s,]+0(px)?[\s,]+0(px)?[\s,]+0(px)?\s*\)/.test(s.clip)) return;
    const a = angle + parseTransform(s.transform).angle;
    const deco = s.textDecorationLine ?? s.textDecoration ?? '';
    const st = strike || deco.includes('line-through');
    const visible = s.visibility !== 'hidden' && s.visibility !== 'collapse';

    if (visible && box.width > 1 && box.height > 1 && !isTransparentColor(s.backgroundColor)) {
      ops.push({
        kind: 'rect',
        box: rel(box),
        color: s.backgroundColor,
        radius: borderRadiusPx(s.borderRadius, box.width, box.height),
        opacity: o,
      });
    }
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 3) {
        const text = (child.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!visible || !text) continue;
        const tb = env.textRect(child as Text, el);
        if (tb.width <= 0 && tb.height <= 0) continue;
        const clipped = s.textOverflow === 'ellipsis' && s.overflow !== undefined && s.overflow !== 'visible';
        ops.push({
          kind: 'text',
          text,
          box: rel(tb),
          font: `${s.fontStyle || 'normal'} ${s.fontWeight || '400'} ${s.fontSize || '12px'} ${s.fontFamily || 'sans-serif'}`,
          color: s.color,
          opacity: o,
          angle: a,
          lineThrough: st,
          maxWidth: clipped ? box.left + box.width - tb.left : Infinity,
        });
      } else if (child.nodeType === 1) {
        visit(child as Element, o, a, st);
      }
    }
  };
  visit(root, 1, 0, false);
  return ops;
}

/** The 2D context calls `paintOverlay` makes (lets tests record them). */
export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'scale'
  | 'translate'
  | 'rotate'
  | 'beginPath'
  | 'rect'
  | 'fill'
  | 'fillRect'
  | 'fillText'
  | 'measureText'
  | 'moveTo'
  | 'lineTo'
  | 'arcTo'
  | 'closePath'
  | 'stroke'
  | 'clip'
> & {
  font: string;
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  globalAlpha: number;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
};

function roundedRect(ctx: PaintContext, b: Box, r: number): void {
  ctx.beginPath();
  if (r <= 0) {
    ctx.rect(b.left, b.top, b.width, b.height);
    return;
  }
  const { left: x, top: y, width: w, height: h } = b;
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Paints overlay ops at `scale` device px per CSS px, clipped to the `cssW x cssH` canvas box. */
export function paintOverlay(ctx: PaintContext, ops: OverlayDrawOp[], scale: number, cssW: number, cssH: number): void {
  ctx.save();
  ctx.scale(scale, scale);
  ctx.beginPath();
  ctx.rect(0, 0, cssW, cssH);
  ctx.clip();
  for (const op of ops) {
    ctx.globalAlpha = op.opacity;
    if (op.kind === 'rect') {
      ctx.fillStyle = op.color;
      roundedRect(ctx, op.box, op.radius);
      ctx.fill();
      continue;
    }
    ctx.font = op.font;
    ctx.fillStyle = op.color;
    ctx.textBaseline = 'middle';
    const text = fitText(op.text, op.maxWidth, (s) => ctx.measureText(s).width);
    if (!text) continue;
    const at = textAnchor(op.box, op.angle);
    ctx.save();
    ctx.translate(at.x, at.y);
    if (at.align === 'center') ctx.rotate(op.angle);
    ctx.textAlign = at.align;
    ctx.fillText(text, 0, 0);
    if (op.lineThrough) {
      const w = ctx.measureText(text).width;
      const x0 = at.align === 'center' ? -w / 2 : 0;
      ctx.strokeStyle = op.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x0, 0.5);
      ctx.lineTo(x0 + w, 0.5);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

export function mimeOf(format: ChartImageFormat | undefined): string {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}

/** Format implied by a file name's extension (`.jpg` / `.jpeg` / `.webp`, else png). */
export function formatFromFilename(name: string): ChartImageFormat {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'webp' ? 'webp' : 'png';
}

// ---------------------------------------------------------------------------
// Browser capture
// ---------------------------------------------------------------------------

export const domEnv: OverlayEnv = {
  style: (el) => getComputedStyle(el) as unknown as OverlayStyle,
  rect: (el) => el.getBoundingClientRect(),
  textRect: (node, el) => {
    if (typeof document.createRange === 'function') {
      const r = document.createRange();
      r.selectNodeContents(node);
      const b = r.getBoundingClientRect();
      if (b.width > 0 || b.height > 0) return b;
    }
    return el.getBoundingClientRect();
  },
};

function normalizeCssColor(css: string): string {
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return css;
  ctx.fillStyle = '#00000000';
  ctx.fillStyle = css;
  return String(ctx.fillStyle);
}

function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('toImage: 2D canvas unavailable');
  return ctx;
}

/**
 * One synchronous capture of the GPU canvas into a new 2D canvas (null = blank read back).
 * Render and `drawImage` stay in the same task; size / clear color are restored afterwards.
 */
function captureFrame(host: ChartExportHost, opts: ChartImageOptions): HTMLCanvasElement | null {
  const canvas = host.canvas;
  if (!canvas) throw new Error('toImage: no canvas (create the SDK with Charturbo.create)');
  const cr = canvas.getBoundingClientRect();
  // The engine's CSS size: width from the canvas box (as `resize` derives the pixel ratio), height
  // from the backing store at that ratio. Overlay labels are laid out in these units, so the export
  // keeps the backing store's aspect even when the host let the CSS box drift from it.
  const cssW = canvas.clientWidth || cr.width || canvas.width;
  const current = canvas.width / cssW;
  const cssH = canvas.height / current;
  const size = exportSize(cssW, cssH, opts.pixelRatio ?? current);
  const prev = { width: canvas.width, height: canvas.height };
  const resized = size.width !== prev.width || size.height !== prev.height;
  const bg = resolveBackground(opts.background, host.theme, normalizeCssColor);
  const setClear = host.backend.set_clear_color?.bind(host.backend);
  // Without a clear color hook the frame keeps the theme surface
  const mode = setClear ? bg.mode : 'theme';

  const out = document.createElement('canvas');
  out.width = size.width;
  out.height = size.height;
  const ctx = context2d(out);
  let white: HTMLCanvasElement | null = null;

  try {
    if (resized) {
      canvas.width = size.width;
      canvas.height = size.height;
      host.backend.resize(size.width, size.height);
    }
    if (mode === 'color' && bg.mode === 'color') setClear!(...bg.color);
    if (mode === 'transparent') setClear!(0, 0, 0, 1);
    host.render();
    ctx.drawImage(canvas, 0, 0, size.width, size.height);
    if (mode === 'transparent') {
      setClear!(1, 1, 1, 1);
      host.render();
      white = document.createElement('canvas');
      white.width = size.width;
      white.height = size.height;
      context2d(white).drawImage(canvas, 0, 0, size.width, size.height);
    }
  } finally {
    const t = host.theme.surface;
    if (mode !== 'theme') setClear!(t[0], t[1], t[2], t[3]);
    if (resized) {
      canvas.width = prev.width;
      canvas.height = prev.height;
      host.backend.resize(prev.width, prev.height);
    }
    // Resizing clears the on-screen canvas; repaint it
    if (resized || mode !== 'theme') host.render();
  }

  if (isBlankCapture((x, y) => ctx.getImageData(x, y, 1, 1).data[3], size.width, size.height)) return null;
  if (white && bg.mode === 'transparent') {
    const img = ctx.getImageData(0, 0, size.width, size.height);
    unmixAlpha(img.data, context2d(white).getImageData(0, 0, size.width, size.height).data);
    ctx.putImageData(img, 0, 0);
    if (bg.under) {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = bg.under;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.restore();
    }
  }
  host.watermark?.(ctx, cssW, cssH, size.width / cssW);
  if (opts.overlay !== false && host.overlay) {
    const ops = collectOverlayOps(host.overlay, { left: cr.left + canvas.clientLeft, top: cr.top + canvas.clientTop }, domEnv);
    paintOverlay(ctx, ops, size.width / cssW, cssW, cssH);
  }
  return out;
}

const nextFrame = () =>
  new Promise<void>((resolve) =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => resolve()) : setTimeout(resolve, 16)
  );

/** Composited chart image as a 2D canvas (retries a blank GPU read back on later frames). */
export async function captureChartCanvas(host: ChartExportHost, opts: ChartImageOptions = {}): Promise<HTMLCanvasElement> {
  for (let attempt = 0; ; attempt++) {
    const out = captureFrame(host, opts);
    if (out) return out;
    if (attempt >= BLANK_RETRIES) throw new Error('toImage: canvas read back blank (GPU frame unavailable)');
    await nextFrame();
  }
}

export async function chartToBlob(host: ChartExportHost, opts: ChartImageOptions = {}): Promise<Blob> {
  const out = await captureChartCanvas(host, opts);
  return new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('toImage: encoding failed'))), mimeOf(opts.format), opts.quality)
  );
}

export async function chartToDataURL(host: ChartExportHost, opts: ChartImageOptions = {}): Promise<string> {
  const out = await captureChartCanvas(host, opts);
  return out.toDataURL(mimeOf(opts.format), opts.quality);
}

/** Saves the image through a temporary `<a download>` (format from the extension by default). */
export async function downloadChartImage(host: ChartExportHost, filename = 'chart.png', opts: ChartImageOptions = {}): Promise<void> {
  const blob = await chartToBlob(host, { ...opts, format: opts.format ?? formatFromFilename(filename) });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
