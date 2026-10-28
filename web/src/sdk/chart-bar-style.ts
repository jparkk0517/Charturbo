/**
 * Bar chart styling binding: horizontal orientation, data labels, error bars and background
 * tracks. The engine owns the geometry (bar_style.rs): orientation re-mapping, error bar segments
 * and their share of the value domain, background tracks across the value axis, label anchors
 * with inside / outside fit tests and collision hiding (`'auto'`).
 * This module encodes the options, formats label text and measures it (the engine needs the
 * text boxes to test fit / collisions), and places DOM labels at the engine anchors.
 */
import { parseColor, parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import { createFormatter } from './chart-format';
import { textOn } from './chart-pie';
import type { CharturboTheme, WasmCharturboEngineBackend } from './charturbo';

export type BarOrientation = 'vertical' | 'horizontal';

/**
 * `'outside'`: beyond the data end (and its error bar); `'inside'`: inside against the data end;
 * `'insideBase'`: inside against the baseline; `'center'`: centered in the bar. Stacked segments
 * always sit inside (`'outside'` = `'center'`) and only show when the text fits.
 */
export type BarLabelPosition = 'outside' | 'inside' | 'insideBase' | 'center';

/** What a data label `format` function receives. */
export interface BarLabelContext {
  /** Bar id (`series * categories + category`; the bar index for single-series charts) */
  id: number;
  series: number;
  category: number;
  /** Series name (multi-series) */
  seriesName?: string;
  categoryLabel: string;
  /** Percent bars: share of the category's visible absolute sum (0-100) */
  percent?: number;
}

export interface BarLabelOptions {
  /**
   * `true` (default when the object is given): every label at its position. `'auto'`: inside
   * labels that do not fit move outside; labels that would leave the canvas, overlap another
   * label, or (outside) cover another bar are hidden. `false`: none
   */
  show?: boolean | 'auto';
  /** Default `'outside'` */
  position?: BarLabelPosition;
  /**
   * Label text: a function of the raw value, a format spec (`'.1f'`, `'$,.0f'`, `'.2s'`; see
   * chart-format.ts) or `Intl.NumberFormat` options (default: the value axis format, else a
   * locale number with up to 2 decimals). Percent bars format the share and append `%`
   */
  format?: ((value: number, ctx: BarLabelContext) => string) | string | Intl.NumberFormatOptions;
  /** Text color (default: theme secondary text outside, light / dark by bar luminance inside) */
  color?: ColorInput;
}

/** Error of one value: symmetric `±e`, or `[minus, plus]`; `null` / `NaN` = none. */
export type BarErrorValue = number | readonly [number, number] | null | undefined;

/** Look of error bars (drawn by the engine with caps). */
export interface BarErrorBarStyle {
  /** Default: theme secondary text color */
  color?: ColorInput;
  /** Stroke width in CSS px (default 1.25) */
  width?: number;
  /** Cap length as a fraction of the bar thickness (default 0.4; 0 = no caps) */
  cap?: number;
}

/**
 * Background tracks: one muted bar behind every bar slot (grouped) or category stack (stacked /
 * percent), spanning the whole value axis with the bar's width and corner radius (2D).
 */
export interface BarBackgroundOptions {
  /** Track color (default: theme `baseline` at 20% alpha, the alpha of ECharts' default track) */
  color?: ColorInput;
  /** Alpha multiplier of the color, 0-1 (default 1) */
  opacity?: number;
}

/** Resolved `background` option: explicit color (undefined = theme default) and opacity. */
export interface BarBackgroundState {
  color?: RgbaTuple;
  opacity: number;
}

/** Alpha of the default track color (ECharts `backgroundStyle.color` default `rgba(180, 180, 180, 0.2)`). */
const DEFAULT_TRACK_ALPHA = 0.2;

interface ResolvedBarLabels {
  mode: 1 | 2;
  position: BarLabelPosition;
  format?: BarLabelOptions['format'];
  color?: RgbaTuple;
}

/** Bar styling state kept in the chart meta. */
export interface BarStyleState {
  orientation: BarOrientation;
  labels: ResolvedBarLabels | null;
  /** Value-unit errors below / above by bar id (NaN = none), or null without errors */
  errMinus: Float32Array | null;
  errPlus: Float32Array | null;
  errorBar: BarErrorBarStyle;
  /** Current label text by bar id ('' = none) */
  texts: string[];
}

/** Font of data labels (also used to measure them). */
export const BAR_LABEL_FONT_PX = 11;
const BAR_LABEL_LINE_PX = 14;
const POSITION_CODES: Record<BarLabelPosition, number> = { outside: 0, inside: 1, insideBase: 2, center: 3 };

/** Normalizes the `labels` option (`true` / `'auto'` / object); null = no labels. */
export function resolveBarLabels(opt: boolean | 'auto' | BarLabelOptions | undefined): ResolvedBarLabels | null {
  if (opt === undefined || opt === false) return null;
  const o: BarLabelOptions = typeof opt === 'object' ? opt : { show: opt };
  const show = o.show ?? true;
  if (show === false) return null;
  // An invalid spec throws here (render call), like axis specs
  if (typeof o.format === 'string') createFormatter(o.format);
  return {
    mode: show === 'auto' ? 2 : 1,
    position: o.position && o.position in POSITION_CODES ? o.position : 'outside',
    format: o.format,
    color: parseOptionalColor(o.color),
  };
}

/** `[minus, plus]` of one error input (absolute values; NaN = none). */
function errorPair(e: BarErrorValue): [number, number] {
  if (e === null || e === undefined) return [NaN, NaN];
  if (typeof e === 'number') return [Math.abs(e), Math.abs(e)];
  return [Math.abs(Number(e[0])), Math.abs(Number(e[1]))];
}

/**
 * Flat minus / plus arrays by bar id from per-series error lists (`errors[s][category]`), or
 * nulls when no series has errors.
 */
export function encodeErrors(errors: (readonly BarErrorValue[] | undefined)[], n: number): [Float32Array, Float32Array] | [null, null] {
  if (!errors.some((list) => list?.some((e) => e !== null && e !== undefined))) return [null, null];
  const minus = new Float32Array(errors.length * n).fill(NaN);
  const plus = new Float32Array(errors.length * n).fill(NaN);
  errors.forEach((list, s) => {
    for (let i = 0; i < Math.min(n, list?.length ?? 0); i++) {
      const [m, p] = errorPair(list![i]);
      minus[s * n + i] = m;
      plus[s * n + i] = p;
    }
  });
  return [minus, plus];
}

/** `[minus, plus]` of bar `id` for tooltips, or undefined without an error. */
export function barErrorOf(state: BarStyleState | undefined, id: number): [number, number] | undefined {
  const m = state?.errMinus?.[id];
  const p = state?.errPlus?.[id];
  if (m === undefined || p === undefined || (!Number.isFinite(m) && !Number.isFinite(p))) return undefined;
  return [Number.isFinite(m) ? m : 0, Number.isFinite(p) ? p : 0];
}

/** Tooltip suffix of an error: `±e`, or `+p / −m` when asymmetric. */
export function formatBarError(err: [number, number], format: (v: number) => string): string {
  const [m, p] = err;
  return Math.abs(m - p) <= 1e-9 * Math.max(1, Math.abs(p)) ? `±${format(p)}` : `+${format(p)} / −${format(m)}`;
}

/** Uploads orientation + error bars (`set_bar_style`); no-op on engines without it. */
export function sendBarStyle(backend: WasmCharturboEngineBackend, state: BarStyleState, theme: CharturboTheme): void {
  const color = parseOptionalColor(state.errorBar.color) ?? parseColor(theme.textSecondary);
  backend.set_bar_style?.(
    state.orientation === 'horizontal' ? 1 : 0,
    state.errMinus ?? new Float32Array(0),
    state.errPlus ?? new Float32Array(0),
    Float32Array.from(color),
    state.errorBar.width ?? NaN,
    state.errorBar.cap ?? NaN
  );
}

/** Normalizes the `background` option (`true` / object); null = no tracks. */
export function resolveBarBackground(opt: boolean | BarBackgroundOptions | undefined): BarBackgroundState | null {
  if (!opt) return null;
  const o: BarBackgroundOptions = opt === true ? {} : opt;
  const opacity = typeof o.opacity === 'number' && Number.isFinite(o.opacity) ? Math.min(1, Math.max(0, o.opacity)) : 1;
  return { color: parseOptionalColor(o.color), opacity };
}

/** Uploads the track color (`set_chart_bar_background`); no-op on engines without it. */
export function sendBarBackground(backend: WasmCharturboEngineBackend, state: BarBackgroundState, theme: CharturboTheme): void {
  const b = theme.baseline;
  const [r, g, bl, a] = state.color ?? [b[0], b[1], b[2], b[3] * DEFAULT_TRACK_ALPHA];
  backend.set_chart_bar_background?.(Float32Array.of(r, g, bl, a * state.opacity));
}

/** Data the label text needs (values flat by bar id, as uploaded). */
export interface BarLabelSource {
  values: ArrayLike<number>;
  categories: number;
  seriesCount: number;
  percent: boolean;
  visible: boolean[];
  seriesName: (s: number) => string | undefined;
  categoryLabel: (i: number) => string;
  locale?: string;
  /** Default text of plain values (the value axis format); percent bars keep their share text */
  valueFormat?: (v: number) => string;
}

/** Label text by bar id ('' for missing values; percent bars show the visible share). */
export function barLabelTexts(labels: ResolvedBarLabels, src: BarLabelSource): string[] {
  const n = src.categories;
  const total = (i: number) => {
    let sum = 0;
    for (let s = 0; s < src.seriesCount; s++) {
      const v = src.values[s * n + i];
      if (src.visible[s] !== false && Number.isFinite(v)) sum += Math.abs(v);
    }
    return sum;
  };
  const totals = src.percent ? Array.from({ length: n }, (_, i) => total(i)) : [];
  const fmt = labels.format;
  const nf =
    typeof fmt === 'object' ? new Intl.NumberFormat(src.locale, fmt) : typeof fmt === 'string' ? createFormatter(fmt, src.locale) : null;
  const texts: string[] = [];
  for (let id = 0; id < src.seriesCount * n; id++) {
    const v = src.values[id];
    const [s, i] = [Math.floor(id / n), id % n];
    if (!Number.isFinite(v) || src.visible[s] === false) {
      texts.push('');
      continue;
    }
    const percent = src.percent ? (totals[i] > 0 ? (Math.abs(v) / totals[i]) * 100 : 0) : undefined;
    if (typeof fmt === 'function') {
      texts.push(
        fmt(v, { id, series: s, category: i, seriesName: src.seriesName(s), categoryLabel: src.categoryLabel(i), ...(percent !== undefined ? { percent } : {}) })
      );
    } else if (nf) {
      const text = nf instanceof Intl.NumberFormat ? nf.format(percent ?? v) : nf(percent ?? v);
      texts.push(text + (percent !== undefined ? '%' : ''));
    } else if (percent !== undefined) {
      texts.push(`${percent.toLocaleString(src.locale, { maximumFractionDigits: 1 })}%`);
    } else {
      texts.push(src.valueFormat ? src.valueFormat(v) : v.toLocaleString(src.locale, { maximumFractionDigits: 2 }));
    }
  }
  return texts;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;

/** Text width in CSS px: canvas `measureText` when a DOM exists, else ~0.6 em per character. */
export function measureLabel(text: string, fontFamily: string): number {
  if (measureCtx === undefined) {
    try {
      measureCtx = typeof document !== 'undefined' ? (document.createElement('canvas').getContext?.('2d') ?? null) : null;
    } catch {
      measureCtx = null;
    }
  }
  if (measureCtx && typeof measureCtx.measureText === 'function') {
    measureCtx.font = `500 ${BAR_LABEL_FONT_PX}px ${fontFamily}`;
    const w = measureCtx.measureText(text).width;
    if (Number.isFinite(w) && w > 0) return Math.ceil(w) + 2;
  }
  return Math.ceil(text.length * BAR_LABEL_FONT_PX * 0.6) + 2;
}

/** Widest label (CSS px; 0 without labels): room reserved beside horizontal bars. */
export function widestLabel(state: BarStyleState, fontFamily: string): number {
  return state.labels ? state.texts.reduce((w, t) => (t ? Math.max(w, measureLabel(t, fontFamily)) : w), 0) : 0;
}

/** Uploads label options + measured text sizes (`set_bar_labels`); mode 0 clears them. */
export function sendBarLabels(backend: WasmCharturboEngineBackend, state: BarStyleState, fontFamily: string): void {
  const l = state.labels;
  if (!l) {
    backend.set_bar_labels?.(0, 0, new Float32Array(0), 0, NaN);
    return;
  }
  const widths = Float32Array.from(state.texts, (t) => (t ? measureLabel(t, fontFamily) : NaN));
  backend.set_bar_labels?.(l.mode, POSITION_CODES[l.position], widths, BAR_LABEL_LINE_PX, NaN);
}

/**
 * DOM text of bar data labels: one element per engine anchor (box center), re-laid out only when
 * the engine's label revision changes (or after `invalidate`). Inside labels pick light / dark
 * text by the bar fill; outside labels use the theme's text token.
 */
export class BarLabelLayer {
  readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;

  constructor(
    parent: HTMLElement,
    private readonly state: BarStyleState,
    private readonly colorOf: (id: number) => RgbaTuple | undefined
  ) {
    this.root = document.createElement('div');
    this.root.className = 'charturbo-sdk-bar-labels';
    Object.assign(this.root.style, { position: 'absolute', left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible', pointerEvents: 'none' });
    parent.appendChild(this.root);
  }

  /** Forces a re-layout on the next `update` (texts / theme changed). */
  invalidate(): void {
    this.revision = -1;
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme): void {
    const a = backend.chart_bar_labels?.();
    if (!a || a.length < 2 || a[0] === this.revision) return;
    this.revision = a[0];
    const count = Math.min(a[1], Math.floor((a.length - 2) / 4));
    const fixed = this.state.labels?.color;
    let used = 0;
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 4;
      const id = a[at];
      const text = this.state.texts[id];
      if (!text) continue;
      let el = this.labels[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'charturbo-sdk-bar-label';
        Object.assign(el.style, {
          position: 'absolute',
          pointerEvents: 'none',
          whiteSpace: 'nowrap',
          fontSize: `${BAR_LABEL_FONT_PX}px`,
          fontWeight: '500',
          lineHeight: `${BAR_LABEL_LINE_PX}px`,
          fontVariantNumeric: 'tabular-nums',
          transform: 'translate(-50%, -50%)',
        });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      used++;
      el.textContent = text;
      const inside = a[at + 3] !== 0;
      el.style.display = 'block';
      el.style.left = `${a[at + 1]}px`;
      el.style.top = `${a[at + 2]}px`;
      el.style.color = fixed
        ? `rgba(${fixed.slice(0, 3).map((c) => Math.round(c * 255)).join(', ')}, ${fixed[3]})`
        : inside
          ? textOn(this.colorOf(id) ?? [0.5, 0.5, 0.5, 1])
          : theme.textSecondary;
    }
    for (let k = used; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
