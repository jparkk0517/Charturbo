/**
 * Pie / donut chart binding. The engine owns the data logic: validation, "Other" folding,
 * sorting, angles, percents, tessellation (2 px surface gaps, anti-aliased edges), the
 * O(log n) hover hit test and explode, label anchors with leader lines and per-side collision
 * nudging. This module only encodes the input, mirrors the displayed slices for the legend /
 * tooltip / a11y, and places DOM text: slice labels at the engine anchors and the donut center
 * label (total, or the hovered slice).
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartLegendOptions, ChartPaddingOptions, ChartTooltipContext, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import type { ChartAnimationInput } from './chart-animation';

export interface PieChartData {
  /** One name per value (legend, labels, tooltip, a11y table) */
  labels: string[];
  /** Finite values >= 0 (anything else is rejected by the engine) */
  values: Float64Array | number[];
}

/** `'outside'`: name + percent with leader lines; `'percent'`: percent inside the slice. */
export type PieLabelMode = 'outside' | 'percent' | 'none';

/**
 * Nightingale rose: the slice radius encodes the value, keeping each slice's area (ring area for
 * donuts) proportional to it. `'radius'`: angles still follow the shares; `'area'`: equal angles.
 */
export type PieRoseMode = 'radius' | 'area';

export interface PieChartOptions {
  /** Enter / update animation of this chart (default: the SDK setting, `setAnimation`) */
  animation?: ChartAnimationInput;
  /** Donut hole radius / outer radius (0 or omitted = pie; up to 0.95) */
  donut?: number;
  /** `'none'` (default): input order; `'desc'`: largest first. "Other" stays last */
  sort?: 'none' | 'desc';
  /** Displayed slices including "Other" (default 8); smaller ones fold into "Other". `0` / `false` disables folding */
  maxSlices?: number | false;
  /** Degrees clockwise from 12 o'clock where the first slice starts (default 0) */
  startAngle?: number;
  /**
   * Degrees clockwise from 12 o'clock where the last slice ends (default: a full turn), e.g.
   * `startAngle: -90, endAngle: 90` for a top half donut. The slices share the sweep along
   * `direction`; an end at or before the start is a full turn. The chart is framed to the sweep
   */
  endAngle?: number;
  /** Default `'clockwise'` */
  direction?: 'clockwise' | 'counterclockwise';
  /** Nightingale rose chart (default: off, every slice reaches the full radius) */
  rose?: PieRoseMode;
  /** Color per input value (default: theme palette in fixed display order) */
  colors?: (ColorInput | null | undefined)[];
  /** Color of the "Other" slice (default: the theme's neutral baseline color) */
  otherColor?: ColorInput;
  /** Name of the folded slice (default `'Other'`) */
  otherLabel?: string;
  /** Default `'outside'` */
  labels?: PieLabelMode;
  /** Slices narrower than this many degrees get no label (legend / tooltip only; default 6) */
  labelMinAngle?: number;
  /**
   * Donut center text: the visible total (the hovered slice while hovering). `true` (default for
   * donuts, not roses) captions it `Total`, a string replaces the caption, `false` hides it
   */
  centerLabel?: boolean | string;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  /** Legend of the displayed slices (default: shown); click toggles a slice, hover emphasizes it */
  legend?: ChartLegendOptions | boolean;
  padding?: ChartPaddingOptions;
  /** Tooltip / table name of the values (default `'Value'`) */
  valueLabel?: string;
  /** Value text of labels, tooltip and center (default: locale number) */
  format?: (value: number) => string;
}

/** Display state the SDK keeps for a pie (mirrors the engine's displayed slices). */
export interface PieChartMeta {
  kind: 'pie';
  /** Displayed slice names (the folded slice is `otherLabel`) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  values: number[];
  /** Share of the visible total (0-100); NaN while hidden */
  percents: number[];
  /** Input index per displayed slice (-1 = "Other") */
  sources: number[];
  /** Input indices folded into "Other" */
  other: number[];
  inputLabels: string[];
  valueLabel: string;
  otherLabel: string;
  labelMode: PieLabelMode;
  donut: number;
  center: { show: boolean; caption: string };
  format?: (value: number) => string;
  colorInputs?: (ColorInput | null | undefined)[];
  otherColor?: ColorInput;
}

const LABEL_CODES: Record<PieLabelMode, number> = { none: 0, outside: 1, percent: 2 };
const ROSE_CODES: Record<PieRoseMode, number> = { radius: 1, area: 2 };
/** Label line height (CSS px): the engine keeps outside labels this far apart. */
const LABEL_LINE_PX = 16;

/** Builds the display meta; slice fields are filled from the engine by `syncPieSlices`. */
export function pieMeta(data: PieChartData, options?: PieChartOptions): PieChartMeta {
  const donut = Math.min(0.95, Math.max(0, Number(options?.donut) || 0));
  // A rose hole is usually too small for the total: off unless asked for
  const center = options?.centerLabel ?? (donut > 0 && !options?.rose);
  return {
    kind: 'pie',
    names: [],
    colors: [],
    visible: [],
    values: [],
    percents: [],
    sources: [],
    other: [],
    inputLabels: [...data.labels],
    valueLabel: options?.valueLabel ?? 'Value',
    otherLabel: options?.otherLabel ?? 'Other',
    labelMode: options?.labels ?? 'outside',
    donut,
    center: { show: center !== false && donut > 0, caption: typeof center === 'string' ? center : 'Total' },
    format: options?.format,
    colorInputs: options?.colors,
    otherColor: options?.otherColor,
  };
}

/** Name of input `i` (falls back to `#n`). */
function inputName(meta: PieChartMeta, i: number): string {
  return meta.inputLabels[i] ?? `#${i + 1}`;
}

/**
 * Horizontal room for outside labels: the longest name plus a percent at ~6.5 px per character
 * (11-12 px UI font), clamped so the pie keeps most of the plot.
 */
export function pieLabelSpace(labels: string[], otherLabel: string, mode: PieLabelMode): [number, number] {
  if (mode !== 'outside') return [0, 0];
  const longest = Math.max(otherLabel.length, ...labels.map((l) => l.length), 0);
  return [Math.min(180, Math.max(64, (longest + 7) * 6.5 + 28)), LABEL_LINE_PX + 4];
}

/** Uploads the values and layout options (`set_pie_chart`); returns the displayed slice count. */
export function sendPie(backend: WasmCharturboEngineBackend, data: PieChartData, meta: PieChartMeta, options?: PieChartOptions): number {
  const values = data.values instanceof Float64Array ? data.values : Float64Array.from(data.values);
  const max = options?.maxSlices === false ? 0 : (options?.maxSlices ?? -1);
  const [sx, sy] = pieLabelSpace(meta.inputLabels, meta.otherLabel, meta.labelMode);
  return (
    backend.set_pie_chart?.(
      values,
      options?.sort === 'desc' ? 1 : 0,
      Number.isFinite(max) ? Math.floor(max) : -1,
      options?.startAngle ?? 0,
      (options?.direction ?? 'clockwise') === 'clockwise',
      meta.donut,
      LABEL_CODES[meta.labelMode] ?? 1,
      options?.labelMinAngle ?? NaN,
      LABEL_LINE_PX,
      sx,
      sy,
      options?.rose ? (ROSE_CODES[options.rose] ?? 0) : 0,
      options?.endAngle ?? NaN
    ) ?? 0
  );
}

/** Palette (fixed order), per-value colors, "Other" / leader colors and the surface under `theme`. */
export function sendPieStyle(backend: WasmCharturboEngineBackend, meta: PieChartMeta, theme: CharturboTheme): void {
  const palette = new Float32Array(theme.palette.length * 4);
  theme.palette.forEach((c, k) => palette.set(c, k * 4));
  const inputs = meta.colorInputs ?? [];
  const colors = new Float32Array(inputs.length * 4).fill(NaN);
  inputs.forEach((c, i) => {
    const rgba = c === null ? undefined : parseOptionalColor(c);
    if (rgba) colors.set(rgba, i * 4);
  });
  const other = parseOptionalColor(meta.otherColor) ?? theme.baseline;
  backend.set_chart_pie_style?.(palette, colors, Float32Array.from(other), Float32Array.from(theme.baseline), Float32Array.from(theme.surface));
}

/** Re-reads the displayed slices (names, colors, values, percents, visibility) from the engine. */
export function syncPieSlices(backend: WasmCharturboEngineBackend, meta: PieChartMeta): void {
  const a = backend.chart_pie_slices?.();
  if (!a) return;
  const n = Math.floor(a.length / 8);
  meta.names = [];
  meta.colors = [];
  meta.visible = [];
  meta.values = [];
  meta.percents = [];
  meta.sources = [];
  for (let k = 0; k < n; k++) {
    const at = k * 8;
    const source = a[at];
    meta.sources.push(source);
    meta.names.push(source < 0 ? meta.otherLabel : inputName(meta, source));
    meta.values.push(a[at + 1]);
    meta.percents.push(a[at + 2]);
    meta.visible.push(a[at + 3] !== 0);
    meta.colors.push([a[at + 4], a[at + 5], a[at + 6], a[at + 7]]);
  }
  meta.other = Array.from(backend.chart_pie_other?.() ?? []);
}

/** Names of the inputs folded into "Other" (tooltip / a11y). */
export function pieOtherMembers(meta: PieChartMeta): string[] {
  return meta.other.map((i) => inputName(meta, i));
}

/** Percent text, e.g. `12.5%`. */
export function formatPercent(p: number, locale?: string): string {
  return Number.isFinite(p) ? `${p.toLocaleString(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%` : '—';
}

/** Tooltip context of displayed slice `k` (`nodeId` = slice index). */
export function pieTooltipContext(meta: PieChartMeta, k: number, cssColor: (c: RgbaTuple) => string): ChartTooltipContext | null {
  if (k < 0 || k >= meta.names.length) return null;
  const name = meta.names[k];
  const percent = meta.percents[k];
  return {
    chartType: 'pie',
    index: k,
    xLabel: name,
    items: [{ seriesName: name, value: meta.values[k], color: cssColor(meta.colors[k]), nodeId: k, percent }],
    slice: {
      label: name,
      value: meta.values[k],
      percent,
      ...(meta.sources[k] < 0 ? { members: pieOtherMembers(meta) } : {}),
    },
    details: null,
  };
}

/** Default pie tooltip: swatch + name, value, percent; "Other" lists what it folds. */
export function pieTooltipHtml(ctx: ChartTooltipContext, theme: CharturboTheme, formatValue: (v: number) => string, locale?: string): string {
  const it = ctx.items[0];
  const s = ctx.slice;
  if (!it || !s) return '';
  const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;flex:none;background:${it.color};"></span>`;
  const members = s.members?.length
    ? `<div style="color:${theme.textMuted};font-size:11px;margin-top:4px;max-width:220px;white-space:normal;">${esc(
        s.members.slice(0, 6).join(', ') + (s.members.length > 6 ? `, +${s.members.length - 6}` : '')
      )}</div>`
    : '';
  return `
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
          <span style="display:flex;align-items:center;color:${theme.textSecondary};">${swatch}${esc(s.label)}</span>
          <span style="color:${theme.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${esc(formatValue(s.value))} <span style="color:${theme.textMuted};font-weight:400;">${formatPercent(s.percent, locale)}</span></span>
        </div>${members}`;
}

/** WCAG relative luminance of an RGBA tuple (sRGB 0-1). */
function luminance(c: RgbaTuple): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Text color with the better contrast on a slice fill (inside labels). */
export function textOn(c: RgbaTuple): string {
  // Contrast vs white (1.05 / (L + 0.05)) beats contrast vs near-black when L < ~0.18
  return luminance(c) < 0.18 ? '#ffffff' : '#0b0b0b';
}

/**
 * DOM text of a pie: one element per engine label anchor (outside: name + percent beyond the
 * leader line; inside: percent centered on the slice) and the donut center label. Re-laid out
 * only when the engine's label revision or the hovered slice changes.
 */
export class PieLabelLayer {
  readonly root: HTMLDivElement;
  private readonly center: HTMLDivElement;
  private readonly centerValue: HTMLDivElement;
  private readonly centerCaption: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;
  private centerKey = '';

  constructor(
    parent: HTMLElement,
    private readonly meta: PieChartMeta
  ) {
    const div = (className: string, style: Partial<CSSStyleDeclaration>) => {
      const el = document.createElement('div');
      el.className = className;
      Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', ...style });
      return el;
    };
    this.root = div('charturbo-sdk-pie-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    this.center = div('charturbo-sdk-pie-center', { transform: 'translate(-50%, -50%)', textAlign: 'center', display: 'none' });
    this.centerValue = div('charturbo-sdk-pie-center-value', {
      position: 'static',
      fontSize: '20px',
      fontWeight: '600',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    });
    this.centerCaption = div('charturbo-sdk-pie-center-caption', {
      position: 'static',
      fontSize: '11px',
      whiteSpace: 'nowrap',
    });
    this.center.append(this.centerValue, this.centerCaption);
    this.root.append(this.center);
    parent.appendChild(this.root);
  }

  /** Forces a re-layout on the next `update` (theme / locale / visibility change). */
  invalidate(): void {
    this.revision = -1;
    this.centerKey = '';
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, formatValue: (v: number) => string, locale?: string): void {
    const meta = this.meta;
    const a = backend.chart_pie_labels?.();
    if (a && a.length >= 2 && a[0] !== this.revision) {
      this.revision = a[0];
      const count = Math.min(a[1], Math.floor((a.length - 2) / 4));
      for (let k = 0; k < count; k++) {
        const at = 2 + k * 4;
        const slice = a[at];
        const [x, y, side] = [a[at + 1], a[at + 2], a[at + 3]];
        let el = this.labels[k];
        if (!el) {
          el = document.createElement('div');
          el.className = 'charturbo-sdk-pie-label';
          Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });
          this.root.appendChild(el);
          this.labels.push(el);
        }
        el.style.display = 'block';
        el.style.top = `${y}px`;
        const pct = formatPercent(meta.percents[slice], locale);
        el.replaceChildren();
        if (side === 0) {
          // Inside: percent only, contrast color on the slice fill
          el.textContent = pct;
          Object.assign(el.style, {
            left: `${x}px`,
            transform: 'translate(-50%, -50%)',
            fontSize: '11px',
            fontWeight: '600',
            color: textOn(meta.colors[slice] ?? [0.5, 0.5, 0.5, 1]),
          });
        } else {
          const name = document.createElement('span');
          name.textContent = meta.names[slice] ?? '';
          name.style.color = theme.textSecondary;
          const share = document.createElement('span');
          // Margin, not a leading space: PNG export trims text nodes but keeps their boxes
          share.textContent = pct;
          share.style.color = theme.textMuted;
          share.style.marginLeft = '4px';
          el.append(name, share);
          Object.assign(el.style, {
            left: `${side > 0 ? x + 4 : x - 4}px`,
            transform: side > 0 ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
            fontSize: '11px',
            fontWeight: '400',
            color: theme.textSecondary,
          });
        }
      }
      for (let k = count; k < this.labels.length; k++) this.labels[k].style.display = 'none';
    }

    const l = backend.chart_pie_layout?.();
    if (!meta.center.show || !l || l.length < 6) {
      this.center.style.display = 'none';
      return;
    }
    const [cx, cy, , , total, hovered] = l;
    const k = hovered >= 0 && hovered < meta.names.length ? hovered : -1;
    const key = `${cx}|${cy}|${total}|${k}`;
    if (key === this.centerKey) return;
    this.centerKey = key;
    Object.assign(this.center.style, { display: 'block', left: `${cx}px`, top: `${cy}px` });
    this.centerValue.style.color = theme.textPrimary;
    this.centerCaption.style.color = theme.textMuted;
    if (k >= 0) {
      this.centerValue.textContent = formatValue(meta.values[k]);
      // Long names are shortened in JS (CSS ellipsis would clip differently in the PNG export)
      const name = meta.names[k] ?? '';
      const short = name.length > 18 ? `${name.slice(0, 17)}…` : name;
      this.centerCaption.textContent = `${short} · ${formatPercent(meta.percents[k], locale)}`;
    } else {
      this.centerValue.textContent = formatValue(total);
      this.centerCaption.textContent = meta.center.caption;
    }
  }

  remove(): void {
    this.root.remove();
  }
}
