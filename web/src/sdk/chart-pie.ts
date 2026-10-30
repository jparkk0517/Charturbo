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
import type { ChartDecalInput, DecalOverride } from './chart-decal';
import { formatCount, getMessages, resolveLocale } from './i18n';
import { measureRichText, parseRichText, renderRichText, validateRichLabel, type RichLabelOptions } from './chart-rich-text';

export interface PieChartData {
  /** One name per value (legend, labels, tooltip, a11y table) */
  labels: string[];
  /** Finite values >= 0 (anything else is rejected by the engine) */
  values: Float64Array | number[];
}

/**
 * One ring of a multi-ring pie (ECharts "nested pies"). Rings are drawn inside out in the given
 * order; slices with the same name share a color, a legend entry and the legend emphasis.
 */
export interface PieRingData {
  /** Ring name (tooltip, data table) */
  name?: string;
  labels: string[];
  values: Float64Array | number[];
  /**
   * `[inner, outer]` radius as fractions of the full radius (0 <= inner < outer <= 1). Default:
   * ring `k` of `n` takes the `k`-th equal share of the band from `donut` to the rim, with a small
   * gap between neighbours
   */
  radius?: [number, number];
  /** Label mode (default: `'percent'` for inner rings, the chart `labels` for the outermost) */
  label?: PieLabelMode;
  /** Default: the chart `maxSlices` */
  maxSlices?: number | false;
  /** Default: the chart `sort` */
  sort?: 'none' | 'desc';
}

/** Multi-ring pie data: percents, angles and "Other" folding are per ring. */
export interface PieRingsData {
  rings: PieRingData[];
}

/** Gap between rings with default radii (fraction of the full radius). */
const RING_GAP = 0.06;

/** `'outside'`: name + percent with leader lines; `'percent'`: percent inside the slice. */
export type PieLabelMode = 'outside' | 'percent' | 'none';

/** Input of a pie `label.formatter` (one displayed slice). */
export interface PieLabelContext {
  /** Slice name (`otherLabel` for the folded slice) */
  name: string;
  value: number;
  /** Share of the visible total (0-100) */
  percent: number;
  /** Displayed slice index */
  index: number;
  /** Ring name (multi-ring pies) */
  ring?: string;
}

/**
 * Nightingale rose: the slice radius encodes the value, keeping each slice's area (ring area for
 * donuts) proportional to it. `'radius'`: angles still follow the shares; `'area'`: equal angles.
 */
export type PieRoseMode = 'radius' | 'area';

export interface PieChartOptions {
  // Multi-ring data (`{ rings }`): `colors` index the concatenated values of every ring
  /**
   * Pattern fills over the marks (accessibility, ECharts `aria.decal`): `true` gives each slice (multi-ring pies: each name)
   * its own automatic pattern; options apply over the automatic patterns (default off). The folded "Other" slice has none
   */
  decal?: ChartDecalInput;
  /**
   * Per-slice decal over `decal` by input index (`false`: none); multi-ring pies: the first
   * value of each name decides
   */
  decals?: DecalOverride[];
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
  /**
   * Angular gap between slices in degrees (default 0, at most 45), on top of the 2 px surface
   * gap. Slices narrower than it are not drawn (legend / tooltip / table still list them)
   */
  padAngle?: number;
  /** Rounds every slice corner by this many CSS px (default 0), shrunk per slice so corners never cross; a pie's center stays sharp */
  cornerRadius?: number;
  /** Default `'clockwise'` */
  direction?: 'clockwise' | 'counterclockwise';
  /** Nightingale rose chart (default: off, every slice reaches the full radius) */
  rose?: PieRoseMode;
  /** Color per input value (default: theme palette in fixed display order) */
  colors?: (ColorInput | null | undefined)[];
  /** Color of the "Other" slice (default: the theme's neutral baseline color) */
  otherColor?: ColorInput;
  /** Name of the folded slice (default: `'Other'` in the chart language) */
  otherLabel?: string;
  /** Default `'outside'` */
  labels?: PieLabelMode;
  /** Slices narrower than this many degrees get no label (legend / tooltip only; default 6) */
  labelMinAngle?: number;
  /**
   * Label text of every shown slice label (outside and inside), e.g.
   * `{ formatter: (c) => \`{name|${c.name}}\\n{pct|${c.percent.toFixed(1)}%}\`, rich: { name: { fontWeight: 600 } } }`
   * (rich text, see chart-rich-text.ts). Default: name + percent outside, percent inside
   */
  label?: RichLabelOptions<PieLabelContext>;
  /**
   * Donut center text: the visible total (the hovered slice while hovering). `true` (default for
   * donuts, not roses) captions it `Total` (in the chart language), a string replaces the caption, `false` hides it
   */
  centerLabel?: boolean | string;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  /** Legend of the displayed slices (default: shown); click toggles a slice, hover emphasizes it */
  legend?: ChartLegendOptions | boolean;
  padding?: ChartPaddingOptions;
  /** Tooltip / table name of the values (default: `'Value'` in the chart language) */
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
  /** Ring per displayed slice (all 0 for a single pie) */
  ring: number[];
  /** Ring names (`Ring n` when unnamed); one entry for a single pie */
  ringNames: string[];
  /** Ring per input value */
  inputRings: number[];
  /** Several rings: legend entries by name, each with its displayed slices */
  groups?: { name: string; slices: number[] }[];
  valueLabel: string;
  otherLabel: string;
  labelMode: PieLabelMode;
  donut: number;
  center: { show: boolean; caption: string };
  format?: (value: number) => string;
  label?: RichLabelOptions<PieLabelContext>;
  colorInputs?: (ColorInput | null | undefined)[];
  otherColor?: ColorInput;
}

const LABEL_CODES: Record<PieLabelMode, number> = { none: 0, outside: 1, percent: 2 };
const ROSE_CODES: Record<PieRoseMode, number> = { radius: 1, area: 2 };
/** Label line height (CSS px): the engine keeps outside labels this far apart. */
const LABEL_LINE_PX = 16;

/** Flat input of a single or multi-ring pie (`rings` null = classic single pie). */
interface PieInput {
  values: Float64Array;
  labels: string[];
  rings: PieRingData[] | null;
}

function pieInput(data: PieChartData | PieRingsData): PieInput {
  if (!('rings' in data)) {
    return { values: data.values instanceof Float64Array ? data.values : Float64Array.from(data.values), labels: [...data.labels], rings: null };
  }
  const values: number[] = [];
  const labels: string[] = [];
  for (const r of data.rings) {
    values.push(...Array.from(r.values));
    labels.push(...r.labels);
  }
  return { values: Float64Array.from(values), labels, rings: data.rings };
}

/**
 * Builds the display meta; slice fields are filled from the engine by `syncPieSlices`.
 * `locale`: default value / "Other" / center / ring names.
 */
export function pieMeta(data: PieChartData | PieRingsData, options?: PieChartOptions, locale?: string): PieChartMeta {
  const msg = getMessages(locale);
  const m = msg.common;
  const donut = Math.min(0.95, Math.max(0, Number(options?.donut) || 0));
  const input = pieInput(data);
  // A rose hole is usually too small for the total, and several rings have several totals: off
  // unless asked for
  const center = options?.centerLabel ?? (donut > 0 && !options?.rose && !input.rings);
  const outside = input.rings ? ringLabelModes(input.rings, options).includes('outside') : (options?.labels ?? 'outside') === 'outside';
  return {
    kind: 'pie',
    names: [],
    colors: [],
    visible: [],
    values: [],
    percents: [],
    sources: [],
    other: [],
    inputLabels: input.labels,
    ring: [],
    ringNames: input.rings ? input.rings.map((r, k) => r.name ?? msg.core.ringName(k + 1)) : [''],
    inputRings: input.rings ? input.rings.flatMap((r, k) => r.labels.map(() => k)) : input.labels.map(() => 0),
    valueLabel: options?.valueLabel ?? m.value,
    otherLabel: options?.otherLabel ?? m.other,
    labelMode: input.rings ? (outside ? 'outside' : 'percent') : (options?.labels ?? 'outside'),
    donut,
    center: { show: center !== false && donut > 0, caption: typeof center === 'string' ? center : m.total },
    format: options?.format,
    ...(options?.label ? { label: options.label } : {}),
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

/** Base font of slice labels (rich runs inherit it). */
const PIE_LABEL_BASE = { fontSize: 11, fontWeight: '400', fontFamily: 'sans-serif', lineHeight: LABEL_LINE_PX };

/** Throws for a malformed `label` option (before the chart is replaced). */
export function validatePieLabel(label: PieChartOptions['label']): void {
  validateRichLabel(label, 'renderPieChart');
}

/**
 * `[line px, side room]` of formatter labels, measured from each input's text with its share of
 * the input total (the engine's displayed shares are not known yet); null without a formatter.
 */
function richPieLabelSpace(input: PieInput, meta: PieChartMeta): [number, number] | null {
  const f = meta.label?.formatter;
  if (!f) return null;
  const total = input.values.reduce((a, v) => a + (v > 0 ? v : 0), 0);
  let [w, h] = [0, LABEL_LINE_PX];
  input.values.forEach((value, index) => {
    const name = input.labels[index] ?? `#${index + 1}`;
    const m = measureRichText(parseRichText(f({ name, value, percent: total > 0 ? (value / total) * 100 : 0, index }), meta.label?.rich), meta.label?.rich, PIE_LABEL_BASE);
    w = Math.max(w, m.width);
    h = Math.max(h, Math.ceil(m.height));
  });
  return [h, meta.labelMode === 'outside' ? Math.min(240, Math.max(64, Math.ceil(w) + 28)) : 0];
}

/** Label mode per ring: inner rings default to inside percents, the outermost to the chart's. */
function ringLabelModes(rings: PieRingData[], options?: PieChartOptions): PieLabelMode[] {
  return rings.map((r, k) => r.label ?? (k === rings.length - 1 ? (options?.labels ?? 'outside') : 'percent'));
}

/** `maxSlices` option as the engine code (< 0 = default, 0 = no folding). */
function maxSlicesCode(v: number | false | undefined): number {
  const max = v === false ? 0 : (v ?? -1);
  return Number.isFinite(max) ? Math.floor(max) : -1;
}

/**
 * Packed ring layout `[count, inner, outer, labels, maxSlices, sort]` per ring (default radius:
 * the ring's equal share of the band from `donut` to the rim) and name groups (first appearance
 * order).
 */
export function encodePieRings(rings: PieRingData[], donut: number, options?: PieChartOptions): { rings: Float32Array; groups: Uint32Array } {
  const n = rings.length;
  const band = (1 - donut) / Math.max(1, n);
  const modes = ringLabelModes(rings, options);
  const out = new Float32Array(n * 6);
  rings.forEach((r, k) => {
    if (r.labels.length !== r.values.length) throw new Error(`pie ring ${k}: ${r.labels.length} labels for ${r.values.length} values`);
    const [inner, outer] = (r.radius ?? [donut + k * band + (k > 0 ? RING_GAP / 2 : 0), donut + (k + 1) * band - (k < n - 1 ? RING_GAP / 2 : 0)]).map(Number);
    if (!(inner >= 0 && inner < outer && outer <= 1)) throw new Error(`pie ring ${k} radius ${inner}..${outer} (need 0 <= inner < outer <= 1)`);
    out.set([r.values.length, inner, outer, LABEL_CODES[modes[k]] ?? 1, maxSlicesCode(r.maxSlices ?? options?.maxSlices), (r.sort ?? options?.sort) === 'desc' ? 1 : 0], k * 6);
  });
  const ids = new Map<string, number>();
  const groups = rings.flatMap((r) => r.labels.map((name) => ids.get(name) ?? (ids.set(name, ids.size), ids.size - 1)));
  return { rings: out, groups: Uint32Array.from(groups) };
}

/** Uploads the values and layout options (`set_pie_chart`); returns the displayed slice count. */
export function sendPie(backend: WasmCharturboEngineBackend, data: PieChartData | PieRingsData, meta: PieChartMeta, options?: PieChartOptions): number {
  const input = pieInput(data);
  const values = input.values;
  const packed = input.rings ? encodePieRings(input.rings, meta.donut, options) : { rings: new Float32Array(0), groups: new Uint32Array(0) };
  const max = maxSlicesCode(options?.maxSlices);
  const rich = richPieLabelSpace(input, meta);
  const [sx, sy] = rich ? [rich[1], rich[0] + 4] : pieLabelSpace(meta.inputLabels, meta.otherLabel, meta.labelMode);
  return (
    backend.set_pie_chart?.(
      values,
      options?.sort === 'desc' ? 1 : 0,
      max,
      options?.startAngle ?? 0,
      (options?.direction ?? 'clockwise') === 'clockwise',
      meta.donut,
      LABEL_CODES[meta.labelMode] ?? 1,
      options?.labelMinAngle ?? NaN,
      rich ? rich[0] : LABEL_LINE_PX,
      sx,
      sy,
      options?.rose ? (ROSE_CODES[options.rose] ?? 0) : 0,
      options?.endAngle ?? NaN,
      options?.padAngle ?? 0,
      options?.cornerRadius ?? 0,
      packed.rings,
      packed.groups
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
  const n = Math.floor(a.length / 9);
  meta.names = [];
  meta.colors = [];
  meta.visible = [];
  meta.values = [];
  meta.percents = [];
  meta.sources = [];
  meta.ring = [];
  for (let k = 0; k < n; k++) {
    const at = k * 9;
    const source = a[at];
    meta.sources.push(source);
    meta.names.push(source < 0 ? meta.otherLabel : inputName(meta, source));
    meta.values.push(a[at + 1]);
    meta.percents.push(a[at + 2]);
    meta.visible.push(a[at + 3] !== 0);
    meta.colors.push([a[at + 4], a[at + 5], a[at + 6], a[at + 7]]);
    meta.ring.push(a[at + 8]);
  }
  meta.other = Array.from(backend.chart_pie_other?.() ?? []);
  meta.groups = undefined;
  if (meta.ringNames.length > 1) {
    const byName = new Map<string, number[]>();
    meta.names.forEach((name, k) => (byName.get(name) ?? byName.set(name, []).get(name)!).push(k));
    meta.groups = [...byName].map(([name, slices]) => ({ name, slices }));
  }
}

/** Ring name of displayed slice `k` (undefined for a single pie). */
export function pieRingName(meta: PieChartMeta, k: number): string | undefined {
  return meta.ringNames.length > 1 ? meta.ringNames[meta.ring[k]] : undefined;
}

/** Names of the inputs folded into "Other" (tooltip / a11y); `k` = an "Other" slice of a ring. */
export function pieOtherMembers(meta: PieChartMeta, k?: number): string[] {
  const other = k === undefined ? meta.other : meta.other.filter((i) => meta.inputRings[i] === meta.ring[k]);
  return other.map((i) => inputName(meta, i));
}

/** Percent text, e.g. `12.5%`. */
export function formatPercent(p: number, locale?: string): string {
  return Number.isFinite(p)
    ? `${p.toLocaleString(resolveLocale(locale), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`
    : getMessages(locale).common.dash;
}

/** Tooltip context of displayed slice `k` (`nodeId` = slice index). */
export function pieTooltipContext(meta: PieChartMeta, k: number, cssColor: (c: RgbaTuple) => string): ChartTooltipContext | null {
  if (k < 0 || k >= meta.names.length) return null;
  const name = meta.names[k];
  const percent = meta.percents[k];
  const ring = pieRingName(meta, k);
  return {
    chartType: 'pie',
    index: k,
    xLabel: name,
    items: [{ seriesName: name, value: meta.values[k], color: cssColor(meta.colors[k]), nodeId: k, percent }],
    slice: {
      label: name,
      value: meta.values[k],
      percent,
      ...(meta.sources[k] < 0 ? { members: pieOtherMembers(meta, k) } : {}),
      ...(ring !== undefined ? { ring } : {}),
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
  const m = getMessages(locale).common;
  // Up to 6 names, then "and N more"
  const shown = s.members && [...s.members.slice(0, 6), ...(s.members.length > 6 ? [m.andMore(formatCount(s.members.length - 6, locale))] : [])];
  const members = shown?.length
    ? `<div style="color:${theme.textMuted};font-size:11px;margin-top:4px;max-width:220px;white-space:normal;">${esc(shown.join(m.listSeparator))}</div>`
    : '';
  const ring = s.ring ? `<div style="color:${theme.textMuted};font-size:11px;margin-bottom:2px;">${esc(s.ring)}</div>` : '';
  return `${ring}
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
        const f = meta.label?.formatter;
        if (f) {
          const ring = pieRingName(meta, slice);
          const ctx: PieLabelContext = { name: meta.names[slice] ?? '', value: meta.values[slice], percent: meta.percents[slice], index: slice, ...(ring !== undefined ? { ring } : {}) };
          renderRichText(el, parseRichText(f(ctx), meta.label?.rich), meta.label?.rich);
          Object.assign(el.style, {
            left: `${side === 0 ? x : side > 0 ? x + 4 : x - 4}px`,
            transform: side === 0 ? 'translate(-50%, -50%)' : side > 0 ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
            fontSize: '11px',
            fontWeight: side === 0 ? '600' : '400',
            lineHeight: `${LABEL_LINE_PX}px`,
            color: side === 0 ? textOn(meta.colors[slice] ?? [0.5, 0.5, 0.5, 1]) : theme.textSecondary,
          });
        } else if (side === 0) {
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
