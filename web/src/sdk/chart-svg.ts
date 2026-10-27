/**
 * Vector SVG export of the current 2D chart view (`exportChartSVG` / `downloadChartSVG`).
 *
 * Marks come from the engine (chart/svg.rs): the staged GPU instances of the last frame
 * (decimated lines stay decimated, points outside the plot are culled, a mark budget caps the
 * size) as `<path>` polylines / fills / rounded bars and `<circle>` points, clipped like the
 * canvas. The DOM overlay (title, legend, ticks, axis titles, labels) is walked like the PNG
 * export (chart-export.ts) and written as `<text>` / `<rect>` with the computed fonts, colors
 * and positions. Heatmaps embed their plot as a PNG `<image>` (the cells are a GPU texture);
 * charts without a vector writer (3D / 2.5D views, newer kinds) embed the whole canvas as a PNG
 * `<image>` under vector text, with a console warning.
 */
import type { CharturboTheme } from './charturbo';
import {
  collectOverlayOps,
  domEnv,
  fitText,
  rgbaCss,
  textAnchor,
  type ChartImageOptions,
  type OverlayDrawOp,
} from './chart-export';

export interface ChartSvgOptions {
  /**
   * Most marks (stroke segments, fill triangles, bars, points) written (default 200,000); points
   * beyond it are thinned evenly and a warning is logged
   */
  maxMarks?: number;
  /** `'theme'` (default), `'transparent'` (no background), or any CSS color */
  background?: ChartImageOptions['background'];
  /** Include the DOM overlay text (title, legend, axes); default true */
  overlay?: boolean;
}

/** What the SVG exporter needs from the SDK. */
export interface ChartSvgHost {
  canvas: HTMLCanvasElement | null;
  overlay: HTMLElement | null;
  theme: CharturboTheme;
  backend: { chart_export_svg?(maxMarks: number, id: string): string };
  /** `sdk.render()`: stages the current view (and draws it, for raster parts) */
  render: () => void;
  /** Chart kind for warnings */
  kind: string | null;
  /** Logs warnings (default `console.warn`) */
  warn?: (msg: string) => void;
}

/** Decoded `chart_export_svg` result. */
export interface EngineSvg {
  /** 0 = vector, 1 = raster plot (heatmap), 2 = raster */
  support: number;
  marks: number;
  truncated: boolean;
  /** Plot `[left, top, width, height]` in CSS px */
  plot: [number, number, number, number];
  body: string;
}

const HEADER = /^<!--viz:([^>]*)-->/;

/** Splits the engine output into its header fields and the markup. */
export function parseEngineSvg(s: string): EngineSvg | null {
  const m = HEADER.exec(s);
  if (!m) return null;
  const v = m[1].split(',').map(Number);
  return {
    support: v[0] ?? 2,
    marks: v[1] ?? 0,
    truncated: v[2] === 1,
    plot: [v[3] ?? 0, v[4] ?? 0, v[5] ?? 0, v[6] ?? 0],
    body: s.slice(m[0].length),
  };
}

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

/** `style weight size family` (the overlay op font) -> SVG font attributes. */
export function fontAttrs(font: string): string {
  const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(font.trim());
  if (!m) return ` font-family="${escapeXml(font)}"`;
  const [, style, weight, size, family] = m;
  let out = ` font-family="${escapeXml(family)}" font-size="${escapeXml(size)}"`;
  if (weight !== '400' && weight !== 'normal') out += ` font-weight="${escapeXml(weight)}"`;
  if (style !== 'normal') out += ` font-style="${escapeXml(style)}"`;
  return out;
}

/**
 * Overlay draw ops (chart-export.ts `collectOverlayOps`) as SVG: background boxes as `<rect>`,
 * texts as `<text>` anchored like the PNG export (left / middle, rotated about their center).
 * `measure` (a canvas `measureText`) applies `text-overflow: ellipsis` clipping when given.
 */
export function overlayOpsToSvg(ops: OverlayDrawOp[], measure?: (text: string, font: string) => number): string {
  let out = '';
  for (const op of ops) {
    const opacity = op.opacity < 0.999 ? ` opacity="${n(op.opacity)}"` : '';
    if (op.kind === 'rect') {
      const b = op.box;
      const rx = op.radius > 0 ? ` rx="${n(op.radius)}"` : '';
      out += `<rect x="${n(b.left)}" y="${n(b.top)}" width="${n(b.width)}" height="${n(b.height)}"${rx} fill="${escapeXml(op.color)}"${opacity}/>`;
      continue;
    }
    const text = measure ? fitText(op.text, op.maxWidth, (s) => measure(s, op.font)) : op.text;
    if (!text) continue;
    const at = textAnchor(op.box, op.angle);
    const rotate = at.align === 'center' && Math.abs(op.angle) > 1e-3 ? ` transform="rotate(${n((op.angle * 180) / Math.PI)} ${n(at.x)} ${n(at.y)})"` : '';
    const anchor = at.align === 'center' ? 'middle' : 'start';
    const deco = op.lineThrough ? ' text-decoration="line-through"' : '';
    out +=
      `<text x="${n(at.x)}" y="${n(at.y)}" dominant-baseline="central" text-anchor="${anchor}"` +
      `${fontAttrs(op.font)} fill="${escapeXml(op.color)}"${opacity}${deco}${rotate}>${escapeXml(text)}</text>`;
  }
  return out;
}

/** Assembles the document. */
export function svgDocument(parts: {
  width: number;
  height: number;
  /** Background fill (CSS color) or null */
  background: string | null;
  /** Embedded PNG `{ href, x, y, width, height }` under the marks */
  image?: { href: string; x: number; y: number; width: number; height: number } | null;
  marks: string;
  overlay: string;
}): string {
  const { width: w, height: h } = parts;
  let s =
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" ` +
    `width="${n(w)}" height="${n(h)}" viewBox="0 0 ${n(w)} ${n(h)}">`;
  if (parts.background) s += `<rect data-layer="background" x="0" y="0" width="${n(w)}" height="${n(h)}" fill="${escapeXml(parts.background)}"/>`;
  const img = parts.image;
  if (img) {
    s +=
      `<image data-layer="raster" x="${n(img.x)}" y="${n(img.y)}" width="${n(img.width)}" height="${n(img.height)}" ` +
      `preserveAspectRatio="none" href="${img.href}" xlink:href="${img.href}"/>`;
  }
  s += parts.marks;
  if (parts.overlay) s += `<g data-layer="overlay">${parts.overlay}</g>`;
  return s + '</svg>';
}

let exportCounter = 0;

/**
 * PNG data URL of a region (CSS px; whole canvas when omitted) of the GPU canvas. Renders and
 * copies in one synchronous block (the WebGPU frame is gone after the task); `null` when the
 * read back is unavailable.
 */
function canvasRegionPng(host: ChartSvgHost, region?: [number, number, number, number]): string | null {
  const canvas = host.canvas;
  if (!canvas || typeof document === 'undefined') return null;
  const cssW = canvas.clientWidth || canvas.getBoundingClientRect().width || canvas.width;
  const k = canvas.width / Math.max(1, cssW);
  const [l, t, w, h] = region ?? [0, 0, cssW, canvas.height / k];
  const sw = Math.max(1, Math.round(w * k));
  const sh = Math.max(1, Math.round(h * k));
  const out = document.createElement('canvas');
  out.width = sw;
  out.height = sh;
  const ctx = out.getContext('2d');
  if (!ctx) return null;
  try {
    host.render();
    ctx.drawImage(canvas, Math.round(l * k), Math.round(t * k), sw, sh, 0, 0, sw, sh);
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureText(text: string, font: string): number {
  if (measureCtx === undefined) {
    measureCtx = typeof document !== 'undefined' ? (document.createElement('canvas').getContext?.('2d') ?? null) : null;
  }
  if (!measureCtx) return 0;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

/** The chart as an SVG document string (see the module docs). Synchronous. */
export function chartToSvg(host: ChartSvgHost, opts: ChartSvgOptions = {}): string {
  const canvas = host.canvas;
  if (!canvas) throw new Error('exportChartSVG: no canvas (create the SDK with Charturbo.create)');
  const warn = host.warn ?? ((m: string) => console.warn(m));
  const cr = canvas.getBoundingClientRect();
  const cssW = canvas.clientWidth || cr.width || canvas.width;
  const cssH = canvas.height / (canvas.width / Math.max(1, cssW));
  // Stage the current view (data / zoom changes since the last frame)
  host.render();
  const id = `charturbo-svg-${++exportCounter}`;
  const raw = host.backend.chart_export_svg?.(Math.max(0, Math.floor(opts.maxMarks ?? 0)), id) ?? '';
  const engine = parseEngineSvg(raw);
  const kind = host.kind ?? 'scene';
  let image: { href: string; x: number; y: number; width: number; height: number } | null = null;
  let marks = '';
  if (!engine || engine.support === 2) {
    warn(`exportChartSVG: ${kind} charts have no vector export yet; embedding the canvas as a PNG <image>`);
    const href = canvasRegionPng(host);
    if (href) image = { href, x: 0, y: 0, width: cssW, height: cssH };
  } else {
    marks = engine.body;
    if (engine.support === 1) {
      const [l, t, w, h] = engine.plot;
      const href = w > 0 && h > 0 ? canvasRegionPng(host, engine.plot) : null;
      if (href) image = { href, x: l, y: t, width: w, height: h };
      else warn(`exportChartSVG: ${kind} plot image unavailable (canvas read back failed)`);
    }
    if (engine.truncated) {
      warn(`exportChartSVG: ${engine.marks} marks written; the rest were thinned out (raise maxMarks to keep more)`);
    }
  }
  // SVG takes any CSS color as is
  const bgOpt = opts.background;
  const background = !bgOpt || bgOpt === 'theme' ? rgbaCss(host.theme.surface) : bgOpt === 'transparent' ? null : bgOpt;
  let overlay = '';
  if (opts.overlay !== false && host.overlay) {
    const ops = collectOverlayOps(host.overlay, { left: cr.left + canvas.clientLeft, top: cr.top + canvas.clientTop }, domEnv);
    overlay = overlayOpsToSvg(ops, measureText);
  }
  return svgDocument({ width: cssW, height: cssH, background, image, marks, overlay });
}

/** Saves a blob through a temporary `<a download>`. */
export function saveBlob(blob: Blob, filename: string): void {
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

export function downloadChartSvg(host: ChartSvgHost, filename = 'chart.svg', opts?: ChartSvgOptions): void {
  saveBlob(new Blob([chartToSvg(host, opts)], { type: 'image/svg+xml' }), filename);
}
