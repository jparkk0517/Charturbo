/**
 * Watermarks: a text or an image tiled (or centered once) over the canvas box, above the plot
 * and under the chart overlay and tooltips. The layer is aria-hidden and click-through. Image /
 * SVG / PDF exports draw it too unless `export: false` (the export hooks call `paint` /
 * `watermarkSvg`; the DOM layer itself is marked `data-charturbo-export="false"`).
 */
import { cssColor, parseColor, type ColorInput } from './color';
import type { CharturboTheme } from './charturbo';
import { escapeXml } from './chart-svg';

export interface ChartWatermarkOptions {
  /** Text of each mark (text or image is required, not both) */
  text?: string;
  /** Image URL of each mark; loaded with `crossOrigin = 'anonymous'` so exports can read it */
  image?: string;
  /** Image mark size in CSS px (default 80 x 40; the image keeps its aspect ratio inside) */
  imageWidth?: number;
  imageHeight?: number;
  /** 0..1 (default 0.15) */
  opacity?: number;
  /** Degrees, positive = anticlockwise (default 30) */
  rotate?: number;
  /** Text size in CSS px (default 14) */
  fontSize?: number;
  /** Default: the theme font */
  fontFamily?: string;
  /** Default `'400'` */
  fontWeight?: string | number;
  /** Text color (default: theme muted text) */
  color?: ColorInput;
  /** Space between marks in CSS px, one number or `[x, y]` (default `[80, 60]`) */
  gap?: number | [number, number];
  /** Tile the area (default true); false = one centered mark */
  repeat?: boolean;
  /** Draw in image / SVG / PDF exports (default true) */
  export?: boolean;
}

export interface ResolvedWatermark {
  text?: string;
  image?: string;
  imageWidth: number;
  imageHeight: number;
  opacity: number;
  rotate: number;
  fontSize: number;
  fontFamily?: string;
  fontWeight: string;
  color?: ColorInput;
  gap: [number, number];
  repeat: boolean;
  export: boolean;
}

const W = 'setWatermark';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validates and fills defaults; throws before anything changes. */
export function resolveWatermark(o: ChartWatermarkOptions): ResolvedWatermark {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) throw new TypeError(`${W}: expected an options object or null`);
  const hasText = o.text !== undefined;
  const hasImage = o.image !== undefined;
  if (hasText === hasImage) throw new TypeError(`${W}: expected text or image (one of them)`);
  if (hasText && typeof o.text !== 'string') throw new TypeError(`${W}: text: expected a string`);
  if (hasImage && (typeof o.image !== 'string' || !o.image)) throw new TypeError(`${W}: image: expected a URL string`);
  const pos = (key: 'imageWidth' | 'imageHeight' | 'fontSize', def: number): number => {
    const v = o[key];
    if (v === undefined) return def;
    if (!isNum(v) || v <= 0) throw new RangeError(`${W}: ${key}: expected a positive number`);
    return v;
  };
  const opacity = o.opacity ?? 0.15;
  if (!isNum(opacity) || opacity < 0 || opacity > 1) throw new RangeError(`${W}: opacity: expected a number in 0..1`);
  const rotate = o.rotate ?? 30;
  if (!isNum(rotate)) throw new RangeError(`${W}: rotate: expected a finite number of degrees`);
  const g = o.gap ?? [80, 60];
  const gap: [number, number] = typeof g === 'number' ? [g, g] : Array.isArray(g) && g.length === 2 ? [g[0], g[1]] : [NaN, NaN];
  if (!gap.every((v) => isNum(v) && v >= 0)) throw new RangeError(`${W}: gap: expected a non-negative number or [x, y]`);
  if (o.repeat !== undefined && typeof o.repeat !== 'boolean') throw new TypeError(`${W}: repeat: expected a boolean`);
  if (o.export !== undefined && typeof o.export !== 'boolean') throw new TypeError(`${W}: export: expected a boolean`);
  if (o.fontFamily !== undefined && typeof o.fontFamily !== 'string') throw new TypeError(`${W}: fontFamily: expected a string`);
  if (o.fontWeight !== undefined && typeof o.fontWeight !== 'string' && !isNum(o.fontWeight)) {
    throw new TypeError(`${W}: fontWeight: expected a string or number`);
  }
  if (o.color !== undefined) {
    try {
      parseColor(o.color);
    } catch {
      throw new TypeError(`${W}: color: invalid color ${JSON.stringify(o.color)}`);
    }
  }
  return {
    ...(hasText ? { text: o.text } : { image: o.image }),
    imageWidth: pos('imageWidth', 80),
    imageHeight: pos('imageHeight', 40),
    opacity,
    rotate,
    fontSize: pos('fontSize', 14),
    ...(o.fontFamily !== undefined ? { fontFamily: o.fontFamily } : {}),
    fontWeight: String(o.fontWeight ?? '400'),
    ...(o.color !== undefined ? { color: o.color } : {}),
    gap,
    repeat: o.repeat ?? true,
    export: o.export ?? true,
  };
}

/**
 * Mark centers: one at the middle without `repeat`; otherwise rows of `(tile + gap)` cells,
 * odd rows shifted by half a cell, reaching one cell past every edge (rotated marks stay whole).
 */
export function watermarkTiles(cssW: number, cssH: number, tileW: number, tileH: number, gap: [number, number], repeat: boolean): [number, number][] {
  if (!repeat) return [[cssW / 2, cssH / 2]];
  const cw = Math.max(1, tileW + gap[0]);
  const ch = Math.max(1, tileH + gap[1]);
  const out: [number, number][] = [];
  const rows = Math.ceil(cssH / ch);
  const cols = Math.ceil(cssW / cw);
  for (let r = -1; r <= rows; r++) {
    const off = ((r % 2) + 2) % 2 === 1 ? cw / 2 : 0;
    for (let c = -1; c <= cols; c++) out.push([cw / 2 + c * cw + off, ch / 2 + r * ch]);
  }
  return out;
}

const fontOf = (w: ResolvedWatermark, t: CharturboTheme) => `${w.fontWeight} ${w.fontSize}px ${w.fontFamily ?? t.fontFamily}`;
const colorOf = (w: ResolvedWatermark, t: CharturboTheme) => (w.color !== undefined ? cssColor(w.color) : t.textMuted);
const num = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** `[w, h]` of one mark (text: measured width x font size). */
function tileSize(w: ResolvedWatermark, measure: (text: string, font: string) => number, font: string): [number, number] {
  return w.text !== undefined ? [Math.max(1, measure(w.text, font) || w.text.length * w.fontSize * 0.6), w.fontSize] : [w.imageWidth, w.imageHeight];
}

/** SVG group of the marks ('' with `export: false`); `measure(text, font)` gives text widths. */
export function watermarkSvg(w: ResolvedWatermark, theme: CharturboTheme, cssW: number, cssH: number, measure: (text: string, font: string) => number): string {
  if (!w.export) return '';
  const font = fontOf(w, theme);
  const [tw, th] = tileSize(w, measure, font);
  let body = '';
  for (const [x, y] of watermarkTiles(cssW, cssH, tw, th, w.gap, w.repeat)) {
    const tr = ` transform="translate(${num(x)} ${num(y)}) rotate(${num(-w.rotate)})"`;
    if (w.text !== undefined) {
      body +=
        `<text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-family="${escapeXml(w.fontFamily ?? theme.fontFamily)}" ` +
        `font-size="${num(w.fontSize)}" font-weight="${escapeXml(w.fontWeight)}" fill="${escapeXml(colorOf(w, theme))}"${tr}>${escapeXml(w.text)}</text>`;
    } else {
      const href = escapeXml(w.image!);
      body +=
        `<image x="${num(-tw / 2)}" y="${num(-th / 2)}" width="${num(tw)}" height="${num(th)}" preserveAspectRatio="xMidYMid meet" ` +
        `href="${href}" xlink:href="${href}"${tr}/>`;
    }
  }
  return `<g data-layer="watermark" opacity="${num(w.opacity)}" aria-hidden="true">${body}</g>`;
}

/**
 * The watermark of one chart: a 2D canvas over the chart canvas box (`canvas()` locates it).
 * `paint` also draws onto export canvases.
 */
export class ChartWatermarkLayer {
  private w: ResolvedWatermark | null = null;
  private el: HTMLDivElement | null = null;
  private img: HTMLImageElement | null = null;
  private size = '';

  constructor(
    private readonly canvas: () => HTMLCanvasElement | null,
    private readonly theme: () => CharturboTheme
  ) {}

  get(): ResolvedWatermark | null {
    return this.w;
  }

  /** Replaces (null removes) the watermark; options must be resolved (`resolveWatermark`). */
  set(w: ResolvedWatermark | null): void {
    this.w = w;
    if (!w) {
      this.el?.remove();
      this.el = null;
      this.img = null;
      return;
    }
    if (w.image !== undefined && this.img?.dataset.src !== w.image) {
      const img = typeof Image === 'function' ? new Image() : null;
      if (img) {
        img.crossOrigin = 'anonymous';
        img.dataset.src = w.image;
        img.onload = () => {
          if (this.img === img) this.repaint();
        };
        img.src = w.image;
      }
      this.img = img;
    } else if (w.image === undefined) this.img = null;
    this.size = '';
    this.layout();
  }

  /** Repaints with the current theme. */
  restyle(): void {
    this.size = '';
    this.layout();
  }

  /** Keeps the layer on the canvas box; repaints after size changes. */
  layout(): void {
    const canvas = this.canvas();
    const parent = canvas?.parentElement;
    if (!this.w || !canvas || !parent) return;
    if (!this.el || this.el.parentElement !== parent) {
      this.el?.remove();
      const el = parent.ownerDocument.createElement('div');
      el.className = 'charturbo-sdk-watermark';
      el.setAttribute('aria-hidden', 'true');
      el.dataset.charturboExport = 'false';
      // Above the plot, under the chart overlay (5) and tooltips
      Object.assign(el.style, { position: 'absolute', zIndex: '4', pointerEvents: 'none', overflow: 'hidden' });
      const c = parent.ownerDocument.createElement('canvas');
      Object.assign(c.style, { display: 'block', width: '100%', height: '100%' });
      el.appendChild(c);
      parent.appendChild(el);
      this.el = el;
      this.size = '';
    }
    const [l, t, cw, ch] = [canvas.offsetLeft, canvas.offsetTop, canvas.offsetWidth, canvas.offsetHeight];
    Object.assign(this.el.style, { left: `${l}px`, top: `${t}px`, width: `${cw}px`, height: `${ch}px` });
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const key = `${cw}x${ch}@${dpr}`;
    if (key !== this.size) {
      this.size = key;
      this.repaint();
    }
  }

  dispose(): void {
    this.set(null);
  }

  private repaint(): void {
    const c = this.el?.firstElementChild as HTMLCanvasElement | null | undefined;
    const canvas = this.canvas();
    if (!c || !canvas) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cw = canvas.offsetWidth;
    const ch = canvas.offsetHeight;
    c.width = Math.max(1, Math.round(cw * dpr));
    c.height = Math.max(1, Math.round(ch * dpr));
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = c.getContext('2d');
    } catch {
      ctx = null;
    }
    if (ctx) this.paint(ctx, cw, ch, dpr);
  }

  /** Draws the marks over a `cssW x cssH` area at `scale` device px per CSS px. */
  paint(ctx: CanvasRenderingContext2D, cssW: number, cssH: number, scale: number): void {
    const w = this.w;
    if (!w) return;
    const img = this.img;
    // An image that has not loaded (or failed) draws nothing
    if (w.image !== undefined && !(img && img.complete && img.naturalWidth > 0)) return;
    const theme = this.theme();
    const font = fontOf(w, theme);
    ctx.save();
    ctx.scale(scale, scale);
    ctx.globalAlpha = w.opacity;
    ctx.fillStyle = colorOf(w, theme);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const [tw, th] = tileSize(w, (text) => ctx.measureText(text).width, font);
    // Image fitted inside the mark box, aspect kept
    let iw = tw;
    let ih = th;
    if (img && w.image !== undefined) {
      const k = Math.min(tw / img.naturalWidth, th / img.naturalHeight);
      iw = img.naturalWidth * k;
      ih = img.naturalHeight * k;
    }
    for (const [x, y] of watermarkTiles(cssW, cssH, tw, th, w.gap, w.repeat)) {
      ctx.save();
      ctx.translate(x, y);
      // Canvas angles turn clockwise; `rotate` is anticlockwise
      ctx.rotate((-w.rotate * Math.PI) / 180);
      if (w.text !== undefined) ctx.fillText(w.text, 0, 0);
      else if (img) ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();
    }
    ctx.restore();
  }
}
