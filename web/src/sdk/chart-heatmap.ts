/**
 * Heatmap / matrix chart binding. The engine owns the data: the grid is uploaded once as a float
 * texture and drawn as one quad, the colormap LUT, value scale, colorbar ticks, hover cell math
 * and cell colors all come from Rust. This module only encodes the input for the engine, builds
 * the colorbar DOM (solid slices, so PNG export paints it like any other overlay box), and
 * formats cell labels / tooltips.
 */
import { parseColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartAxisOptions, ChartHoverStyle, ChartPaddingOptions, ChartTooltipContext, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';

/** `'sequential'`: one hue light -> dark (flips on dark themes); `'diverging'`: two hues around a neutral `center`. */
export type HeatmapColorScale = 'sequential' | 'viridis' | 'magma' | 'diverging';

export interface HeatmapChartData {
  cols: number;
  rows: number;
  /** Row-major `cols x rows` values (`values[row * cols + col]`); NaN = empty cell. Up to 4096 x 4096. */
  values: Float32Array | number[];
  /** Column labels (categorical x axis; tick value = column index) */
  xLabels?: string[];
  /** Row labels (categorical y axis; tick value = row index) */
  yLabels?: string[];
  /** Numeric x axis instead: data x of the grid's left / right edges */
  xExtent?: [number, number];
  /** Numeric y axis instead: data y of the grid's bottom / top edges */
  yExtent?: [number, number];
}

export interface HeatmapColorbarOptions {
  /** Default: true */
  show?: boolean;
  /** Short label above the bar (default: `valueLabel`) */
  title?: string;
  /** Tick label text (default: compact numbers) */
  format?: (value: number) => string;
}

export interface HeatmapChartOptions {
  /** World size of the plot (aspect ratio of the framed plot; default: 160 x 90) */
  width?: number;
  height?: number;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  axes?: { x?: ChartAxisOptions; y?: ChartAxisOptions };
  padding?: ChartPaddingOptions;
  /** Default: `'sequential'` */
  colorScale?: HeatmapColorScale;
  /** Sequential hue source (default: the reference blue ramp) */
  color?: ColorInput;
  /** Flip the colormap end for end */
  reverse?: boolean;
  /** Value domain (default: data extent; diverging without min / max is symmetric around `center`) */
  min?: number;
  max?: number;
  /** Diverging midpoint (default: 0 when the data crosses it, else the middle of the domain) */
  center?: number;
  /** Color of NaN cells (default: transparent, the surface shows through) */
  emptyColor?: ColorInput;
  /** `'top-down'` (default): row 0 at the top, matrix order; `'bottom-up'`: row 0 at the bottom */
  rowOrder?: 'top-down' | 'bottom-up';
  colorbar?: HeatmapColorbarOptions | boolean;
  /** Tooltip / colorbar name of the value (default: `Value`) */
  valueLabel?: string;
  /** Cell outline on hover: `markerRingColor` (outer ring), `barHighlightColor` (inner ring), `marker: false` disables */
  hover?: ChartHoverStyle;
}

/** Display state the SDK keeps for a heatmap (values stay shared with the engine input). */
export interface HeatmapChartMeta {
  kind: 'heatmap';
  cols: number;
  rows: number;
  values: Float32Array;
  xLabels: string[] | null;
  yLabels: string[] | null;
  xExtent: [number, number] | null;
  yExtent: [number, number] | null;
  rowTop: boolean;
  valueLabel: string;
  colormap: { scale: HeatmapColorScale; color?: ColorInput; reverse: boolean; emptyColor?: ColorInput };
  colorbar: Required<Omit<HeatmapColorbarOptions, 'format'>> & { format?: (v: number) => string };
}

/** `set_chart_heatmap_colormap` kind codes. */
export const HEATMAP_SCALE_CODES: Record<HeatmapColorScale, number> = { sequential: 0, viridis: 1, magma: 2, diverging: 3 };

const EMPTY_F32 = new Float32Array(0);
const EMPTY_F64 = new Float64Array(0);

/** Finite, distinct `[a, b]` or null. */
function extentOf(e?: [number, number]): [number, number] | null {
  return e && Number.isFinite(e[0]) && Number.isFinite(e[1]) && e[0] !== e[1] ? [e[0], e[1]] : null;
}

/** Builds the display meta (no data copy for `Float32Array` input). */
export function heatmapMeta(data: HeatmapChartData, options?: HeatmapChartOptions): HeatmapChartMeta {
  const cols = Math.max(0, Math.floor(data.cols));
  const rows = Math.max(0, Math.floor(data.rows));
  const values = data.values instanceof Float32Array ? data.values : Float32Array.from(data.values);
  const bar = typeof options?.colorbar === 'boolean' ? { show: options.colorbar } : (options?.colorbar ?? {});
  const valueLabel = options?.valueLabel ?? 'Value';
  return {
    kind: 'heatmap',
    cols,
    rows,
    values,
    xLabels: data.xLabels ?? null,
    yLabels: data.yLabels ?? null,
    xExtent: extentOf(data.xExtent),
    yExtent: extentOf(data.yExtent),
    rowTop: (options?.rowOrder ?? 'top-down') === 'top-down',
    valueLabel,
    colormap: {
      scale: options?.colorScale ?? 'sequential',
      color: options?.color,
      reverse: options?.reverse ?? false,
      emptyColor: options?.emptyColor,
    },
    colorbar: { show: bar.show ?? true, title: bar.title ?? valueLabel, format: bar.format },
  };
}

/** Uploads the grid (`set_heatmap_chart`); the engine validates the shape. */
export function sendHeatmap(backend: WasmCharturboEngineBackend, meta: HeatmapChartMeta, options?: HeatmapChartOptions): number {
  return (
    backend.set_heatmap_chart?.(
      meta.cols,
      meta.rows,
      meta.values,
      options?.width ?? NaN,
      options?.height ?? NaN,
      meta.rowTop,
      meta.xExtent ? Float64Array.from(meta.xExtent) : EMPTY_F64,
      meta.yExtent ? Float64Array.from(meta.yExtent) : EMPTY_F64
    ) ?? 0
  );
}

/** Applies the colormap under `theme` (the surface decides the sequential / diverging anchors). */
export function sendHeatmapColormap(backend: WasmCharturboEngineBackend, meta: HeatmapChartMeta, theme: CharturboTheme): void {
  const c = meta.colormap;
  backend.set_chart_heatmap_colormap?.(
    HEATMAP_SCALE_CODES[c.scale] ?? 0,
    c.color !== undefined ? Float32Array.from(parseColor(c.color)) : EMPTY_F32,
    c.reverse,
    Float32Array.from(theme.surface),
    c.emptyColor !== undefined ? Float32Array.from(parseColor(c.emptyColor)) : EMPTY_F32
  );
}

/** Label of column / row `index`: its category label, else the numeric cell center. */
export function heatmapAxisLabel(
  labels: string[] | null,
  extent: [number, number] | null,
  count: number,
  index: number,
  format: (v: number) => string
): string {
  if (extent) return format(extent[0] + ((index + 0.5) * (extent[1] - extent[0])) / Math.max(1, count));
  return labels?.[index] ?? String(index);
}

/** y extent runs bottom -> top; a top-down grid's row 0 is the top row. */
export function heatmapRowLabel(meta: HeatmapChartMeta, row: number, format: (v: number) => string): string {
  const k = meta.yExtent && meta.rowTop ? meta.rows - 1 - row : row;
  return heatmapAxisLabel(meta.yLabels, meta.yExtent, meta.rows, k, format);
}

export interface HeatmapColorbarData {
  lo: number;
  hi: number;
  /** Diverging midpoint (null = sequential) */
  center: number | null;
  /** `t` = position along the colormap in [0, 1] */
  ticks: { value: number; t: number }[];
}

/** Decodes `chart_heatmap_colorbar` (`null` without a heatmap). */
export function decodeColorbar(a: ArrayLike<number> | undefined): HeatmapColorbarData | null {
  if (!a || a.length < 4) return null;
  const count = Math.min(a[3], Math.floor((a.length - 4) / 2));
  const ticks: HeatmapColorbarData['ticks'] = [];
  for (let k = 0; k < count; k++) ticks.push({ value: a[4 + k * 2], t: a[5 + k * 2] });
  return { lo: a[0], hi: a[1], center: Number.isFinite(a[2]) ? a[2] : null, ticks };
}

/** RGBA8 bytes -> CSS `rgb()` / `rgba()`. */
export function bytesToCss(b: ArrayLike<number>, at = 0): string {
  const a = b[at + 3] ?? 255;
  return a >= 255 ? `rgb(${b[at]}, ${b[at + 1]}, ${b[at + 2]})` : `rgba(${b[at]}, ${b[at + 1]}, ${b[at + 2]}, ${(a / 255).toFixed(3)})`;
}

/** Colorbar slices (high at the top) and the CSS px gap between bar and plot. */
const SLICES = 64;
const BAR_WIDTH = 12;
const BAR_GAP = 14;
/** Right padding that fits the colorbar + its tick labels. */
export const COLORBAR_RESERVE_PX = 84;

/** Minimum vertical distance between colorbar labels (CSS px; 11px text). */
const COLORBAR_LABEL_GAP_PX = 15;

/**
 * Vertical colorbar right of the plot: `SLICES` solid boxes sampled from the engine LUT (export
 * paints solid boxes only), tick labels from the engine's nice ticks, and the domain ends when no
 * tick sits near them.
 */
export class HeatmapColorbarLayer {
  readonly root: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly labels: HTMLDivElement;
  private data: HeatmapColorbarData | null = null;

  constructor(parent: HTMLElement, private readonly meta: HeatmapChartMeta) {
    const div = (className: string, style: Partial<CSSStyleDeclaration>) => {
      const el = document.createElement('div');
      el.className = className;
      Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', ...style });
      return el;
    };
    this.root = div('charturbo-sdk-heatmap-colorbar', { left: '0px', top: '0px', width: '0px', height: '0px' });
    this.root.setAttribute('role', 'img');
    this.title = div('charturbo-sdk-heatmap-colorbar-title', { fontSize: '11px', whiteSpace: 'nowrap', transform: 'translate(0, -100%)' });
    this.bar = div('charturbo-sdk-heatmap-colorbar-bar', { left: '0px', top: '0px', width: `${BAR_WIDTH}px`, overflow: 'hidden', borderRadius: '2px' });
    this.labels = div('charturbo-sdk-heatmap-colorbar-labels', { left: `${BAR_WIDTH + 4}px`, top: '0px' });
    this.root.append(this.title, this.bar, this.labels);
    parent.appendChild(this.root);
  }

  /** Re-reads the LUT / ticks from the engine (after a colormap / domain / theme change). */
  refresh(backend: WasmCharturboEngineBackend, theme: CharturboTheme, locale?: string): void {
    this.data = decodeColorbar(backend.chart_heatmap_colorbar?.());
    const lut = backend.chart_heatmap_lut?.();
    this.bar.replaceChildren();
    if (lut && lut.length >= 4) {
      const n = lut.length / 4;
      for (let k = 0; k < SLICES; k++) {
        const t = 1 - (k + 0.5) / SLICES;
        const i = Math.min(n - 1, Math.round(t * (n - 1)));
        const s = document.createElement('div');
        Object.assign(s.style, {
          position: 'absolute',
          left: '0px',
          width: '100%',
          top: `${(k * 100) / SLICES}%`,
          // Slight overlap hides seams between slices
          height: `${100 / SLICES + 0.4}%`,
          backgroundColor: bytesToCss(lut, i * 4),
        });
        this.bar.appendChild(s);
      }
    }
    this.title.textContent = this.meta.colorbar.title;
    this.title.style.color = theme.textSecondary;
    const d = this.data;
    if (d) {
      const fmt = this.format(locale);
      const mid = d.center !== null ? `, midpoint ${fmt(d.center)}` : '';
      this.root.setAttribute('aria-label', `${this.meta.colorbar.title} color scale from ${fmt(d.lo)} to ${fmt(d.hi)}${mid}`);
    }
    this.labels.style.color = theme.textMuted;
  }

  private format(locale?: string): (v: number) => string {
    return (
      this.meta.colorbar.format ??
      ((v: number) =>
        Math.abs(v) >= 10_000
          ? v.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: 1 })
          : v.toLocaleString(locale, { maximumFractionDigits: 4 }))
    );
  }

  /** Places the bar beside the plot rectangle (CSS px) and lays out its labels. */
  layout(plot: [number, number, number, number], locale?: string): void {
    const [l, t, w, h] = plot;
    const show = this.meta.colorbar.show && h > 0;
    this.root.style.display = show ? 'block' : 'none';
    if (!show) return;
    this.root.style.left = `${l + w + BAR_GAP}px`;
    this.root.style.top = `${t}px`;
    this.bar.style.height = `${h}px`;
    this.title.style.left = '0px';
    this.title.style.top = '-4px';
    const d = this.data;
    this.labels.replaceChildren();
    if (!d) return;
    const fmt = this.format(locale);
    // Domain ends (the actual extremes) always get a label; ticks closer than a label height
    // (11px text + gap) to an end are dropped so the two never overlap
    const ends = [
      { value: d.hi, y: 0 },
      { value: d.lo, y: h },
    ];
    const marks = d.ticks
      .map((k) => ({ value: k.value, y: (1 - k.t) * h }))
      .filter((m) => ends.every((e) => Math.abs(m.y - e.y) >= COLORBAR_LABEL_GAP_PX && m.value !== e.value));
    marks.push(...ends);
    // Bottom (low) to top, like the tick order
    marks.sort((a, b) => b.y - a.y);
    for (const m of marks) {
      const el = document.createElement('div');
      el.className = 'charturbo-sdk-heatmap-colorbar-tick';
      Object.assign(el.style, {
        position: 'absolute',
        left: '0px',
        top: `${m.y}px`,
        transform: 'translate(0, -50%)',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      });
      el.textContent = fmt(m.value);
      this.labels.appendChild(el);
    }
  }

  remove(): void {
    this.root.remove();
  }
}

/** Default heatmap tooltip: column / row labels and the cell value with its displayed color. */
export function heatmapTooltipHtml(ctx: ChartTooltipContext, theme: CharturboTheme, formatValue: (v: number) => string): string {
  const it = ctx.items[0];
  const cell = ctx.cell;
  if (!it || !cell) return '';
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;flex:none;background:${it.color};"></span>`;
  return `
        <div style="color:${theme.textMuted};font-size:11px;margin-bottom:4px;">${esc(cell.yLabel)} · ${esc(cell.xLabel)}</div>
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
          <span style="display:flex;align-items:center;color:${theme.textSecondary};">${swatch}${esc(it.seriesName)}</span>
          <span style="color:${theme.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${esc(formatValue(it.value))}</span>
        </div>`;
}

/** RGBA [0, 1] tuple of an RGBA8 engine color (gray when unavailable). */
export function bytesToRgba(b: ArrayLike<number> | undefined): RgbaTuple {
  return b && b.length >= 4 ? [b[0] / 255, b[1] / 255, b[2] / 255, b[3] / 255] : [0.5, 0.5, 0.5, 1];
}
