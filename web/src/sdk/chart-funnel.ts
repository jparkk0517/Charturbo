/**
 * Funnel chart binding. The engine owns the data logic (funnel.rs): validation, stage widths,
 * conversion rates (of the first and the previous stage), trapezoid / bar tessellation with 2 px
 * surface gaps and anti-aliased edges, the hover hit test and the label anchors. This module
 * encodes the input, mirrors the stages for the tooltip / a11y, and places the DOM labels
 * (name, value, conversion) at the engine anchors.
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { A11yChartModel } from './chart-a11y';
import type { ChartPaddingOptions, ChartTooltipContext, NodeMetadata, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import {
  enNumber,
  esc,
  overlayDiv,
  percentText,
  placeAt,
  plural,
  rgbCss,
  stepSingle,
  tooltipHeader,
  tooltipRow,
  type A11yCommon,
  type A11yCustomModel,
  type BusinessLabelLayer,
} from './chart-business-util';

export interface FunnelChartData {
  /** Stage names, first stage first */
  labels: string[];
  /** Finite values >= 0 (anything else is rejected by the engine) */
  values: Float64Array | number[];
}

/** Which conversion the stage labels show (the tooltip always shows both). */
export type FunnelConversion = 'first' | 'previous' | 'both' | 'none';

export interface FunnelChartOptions {
  /** `'vertical'` (default: first stage on top, labels to the right) or `'horizontal'` */
  orientation?: 'vertical' | 'horizontal';
  /** `'trapezoid'` (default: each stage narrows to the next) or `'bar'` (centered bars) */
  shape?: 'trapezoid' | 'bar';
  /** One color for every stage (default: the first palette slot: one series, one hue) */
  color?: ColorInput;
  /** Per-stage colors (e.g. an ordinal ramp); missing entries use `color` */
  colors?: (ColorInput | null | undefined)[];
  /** Narrowest stage as a fraction of the widest (default 0.02) */
  minWidth?: number;
  /** Conversion shown in the labels (default `'first'`) */
  conversion?: FunnelConversion;
  /** Stage labels (default: true) */
  labels?: boolean;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  padding?: ChartPaddingOptions;
  /** Tooltip / table name of the values (default `'Value'`) */
  valueLabel?: string;
  /** Value text of labels, tooltip and a11y (spec, Intl options or function; default: locale number) */
  format?: ChartValueFormat;
}

/** Display state the SDK keeps for a funnel. */
export interface FunnelChartMeta {
  kind: 'funnel';
  stages: string[];
  values: number[];
  /** Percent of the first / previous stage (engine; NaN = undefined) */
  pctFirst: number[];
  pctPrev: number[];
  stageColors: RgbaTuple[];
  orientation: 'vertical' | 'horizontal';
  conversion: FunnelConversion;
  showLabels: boolean;
  /** No legend (one series) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  valueLabel: string;
  format: (value: number) => string;
  colorInputs: { color?: ColorInput; colors?: (ColorInput | null | undefined)[] };
}

/** Hovered funnel stage with its conversion rates. */
export interface ChartFunnelTooltip {
  stage: string;
  value: number;
  /** Percent of the first / previous stage (NaN = undefined) */
  ofFirst: number;
  ofPrevious: number;
}

export function funnelMeta(data: FunnelChartData, options: FunnelChartOptions | undefined, format: (v: number) => string): FunnelChartMeta {
  return {
    kind: 'funnel',
    stages: [...data.labels],
    values: Array.from(data.values, Number),
    pctFirst: [],
    pctPrev: [],
    stageColors: [],
    orientation: options?.orientation ?? 'vertical',
    conversion: options?.conversion ?? 'first',
    showLabels: options?.labels ?? true,
    names: [],
    colors: [],
    visible: [true],
    valueLabel: options?.valueLabel ?? 'Value',
    format,
    colorInputs: { color: options?.color, colors: options?.colors },
  };
}

function stageColors(meta: FunnelChartMeta, theme: CharturboTheme): RgbaTuple[] {
  const base = parseOptionalColor(meta.colorInputs.color) ?? theme.palette[0];
  return meta.values.map((_, i) => {
    const c = meta.colorInputs.colors?.[i];
    return (c === null ? undefined : parseOptionalColor(c)) ?? base;
  });
}

function colorArray(colors: RgbaTuple[]): Float32Array {
  const a = new Float32Array(colors.length * 4);
  colors.forEach((c, i) => a.set(c, i * 4));
  return a;
}

/** Stage label text, e.g. `Signups  4,200 · 42.0%`. */
export function funnelLabelParts(meta: FunnelChartMeta, i: number, locale?: string): { name: string; value: string; conversion: string } {
  const first = percentText(meta.pctFirst[i], locale);
  const prev = percentText(meta.pctPrev[i], locale);
  // Horizontal stages are narrow: compact wording on its own line
  const ofPrev = meta.orientation === 'horizontal' ? 'prev.' : 'of previous';
  const conversion =
    meta.conversion === 'none' || i === 0
      ? ''
      : meta.conversion === 'previous'
        ? `${prev} ${ofPrev}`
        : meta.conversion === 'both'
          ? `${first} · ${prev} ${ofPrev}`
          : first;
  return { name: meta.stages[i] ?? `#${i + 1}`, value: meta.format(meta.values[i]), conversion };
}

/** Label room right of a vertical funnel (~6.5 px per character) / below a horizontal one. */
export function funnelLabelSpace(meta: FunnelChartMeta): number {
  if (!meta.showLabels) return 0;
  // Name, value and conversion lines (15 px each)
  if (meta.orientation === 'horizontal') return meta.conversion === 'none' ? 40 : 56;
  const longest = meta.values.reduce((w, _, i) => {
    const p = funnelLabelParts(meta, i);
    return Math.max(w, Math.max(p.name.length, p.value.length + p.conversion.length + 3));
  }, 0);
  return Math.min(220, Math.max(64, longest * 6.5 + 20));
}

/** Uploads the funnel (`set_funnel_chart`) and reads the conversion rates back. */
export function sendFunnel(backend: WasmCharturboEngineBackend, meta: FunnelChartMeta, options: FunnelChartOptions | undefined, theme: CharturboTheme): number {
  meta.stageColors = stageColors(meta, theme);
  const n =
    backend.set_funnel_chart?.(
      Float64Array.from(meta.values),
      colorArray(meta.stageColors),
      meta.orientation === 'horizontal' ? 1 : 0,
      options?.shape === 'bar' ? 1 : 0,
      options?.minWidth ?? NaN,
      0
    ) ?? 0;
  syncFunnelStages(backend, meta);
  return n;
}

/** Reads `[(value, % of first, % of previous) * stages]` from the engine. */
export function syncFunnelStages(backend: WasmCharturboEngineBackend, meta: FunnelChartMeta): void {
  const a = backend.chart_funnel_stages?.();
  if (!a) return;
  meta.pctFirst = [];
  meta.pctPrev = [];
  for (let k = 0; k + 2 < a.length; k += 3) {
    meta.pctFirst.push(a[k + 1]);
    meta.pctPrev.push(a[k + 2]);
  }
}

export function sendFunnelColors(backend: WasmCharturboEngineBackend, meta: FunnelChartMeta, theme: CharturboTheme): void {
  meta.stageColors = stageColors(meta, theme);
  backend.set_chart_funnel_colors?.(colorArray(meta.stageColors));
}

export function funnelTooltipContext(meta: FunnelChartMeta, i: number, details: (id: number) => ChartTooltipContext['details']): ChartTooltipContext | null {
  if (i < 0 || i >= meta.values.length) return null;
  const stage = meta.stages[i] ?? `#${i + 1}`;
  return {
    chartType: 'funnel',
    index: i,
    xLabel: stage,
    items: [{ seriesName: meta.valueLabel, value: meta.values[i], color: rgbCss(meta.stageColors[i]), nodeId: i, percent: meta.pctFirst[i] }],
    funnel: { stage, value: meta.values[i], ofFirst: meta.pctFirst[i], ofPrevious: meta.pctPrev[i] },
    details: details(i),
  };
}

export function funnelTooltipHtml(ctx: ChartTooltipContext, theme: CharturboTheme, formatValue: (v: number) => string, locale?: string): string {
  const f = ctx.funnel;
  if (!f) return '';
  return `${tooltipHeader(theme, f.stage)}${tooltipRow(theme, ctx.items[0]?.seriesName ?? 'Value', esc(formatValue(f.value)), ctx.items[0]?.color)}${
    ctx.index > 0 ? `${tooltipRow(theme, 'Of first stage', percentText(f.ofFirst, locale))}${tooltipRow(theme, 'Of previous stage', percentText(f.ofPrevious, locale))}` : ''
  }`;
}

export function funnelPointMetadata(meta: FunnelChartMeta, i: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  if (i < 0 || i >= meta.values.length) return null;
  const pct = (p: number) => (Number.isFinite(p) ? Number(p.toFixed(2)) : 'n/a');
  return {
    series: 0,
    color: meta.stageColors[i] ?? [0.5, 0.5, 0.5, 1],
    metadata: {
      label: meta.stages[i] ?? `#${i + 1}`,
      category: meta.valueLabel,
      tags: ['funnel-chart'],
      attributes: { value: meta.values[i], ofFirst: pct(meta.pctFirst[i]), ofPrevious: pct(meta.pctPrev[i]) },
    },
  };
}

/** A11y model: one stop per stage; table columns value, % of first, % of previous. */
export function funnelA11yModel(meta: FunnelChartMeta, c: A11yCommon): A11yChartModel {
  const n = meta.values.length;
  const f = c.formatValue;
  const label = (i: number) => meta.stages[i] ?? `#${i + 1}`;
  const pct = (a: number[]) => a.map((p) => (Number.isFinite(p) ? Math.round(p * 100) / 100 : NaN));
  const pctFmt = (p: number) => (Number.isFinite(p) ? `${enNumber(p, 1)}%` : 'n/a');
  const custom: A11yCustomModel = {
    kindLabel: 'Funnel',
    xHeader: 'Stage',
    summary: () => {
      const head = c.title ? `${c.title}. ` : '';
      const last = n - 1;
      const conv = n > 1 ? `; ${label(last)} is ${pctFmt(meta.pctFirst[last])} of ${label(0)}` : '';
      return `${head}Funnel chart, ${plural(n, 'stage')}, from ${f(meta.values[0] ?? NaN)} to ${f(meta.values[last] ?? NaN)}${conv}.`;
    },
    description: () =>
      meta.values.map((v, i) => `${label(i)}: ${f(v)}${i > 0 ? `, ${pctFmt(meta.pctFirst[i])} of first, ${pctFmt(meta.pctPrev[i])} of previous` : ''}.`),
    help: 'Keyboard: focus the chart, then use Left and Right arrows to move between stages, Home and End for the first and last stage, and Escape to clear.',
    announce: (focus) => {
      const i = focus.index;
      const conv = i > 0 ? ` ${pctFmt(meta.pctFirst[i])} of first, ${pctFmt(meta.pctPrev[i])} of previous.` : '';
      return `${label(i)}, ${f(meta.values[i])}.${conv} ${i + 1} of ${n}.`;
    },
    step: (focus, key) => stepSingle(focus, key, n),
  };
  return {
    kind: 'funnel',
    ...c,
    series: [
      { name: meta.valueLabel, values: meta.values, visible: true, f32: false },
      { name: '% of first', values: pct(meta.pctFirst), visible: true, f32: false, format: pctFmt },
      { name: '% of previous', values: pct(meta.pctPrev), visible: true, f32: false, format: pctFmt },
    ],
    length: n,
    custom,
    xValue: label,
    xLabel: label,
    formatX: label,
    pointId: (_s, i) => i,
    itemName: () => meta.valueLabel,
    itemColor: (_s, i) => meta.stageColors[i] ?? [0.5, 0.5, 0.5, 1],
  };
}

/** DOM labels of the stages (name, value, conversion) at the engine anchors. */
export class FunnelLabelLayer implements BusinessLabelLayer {
  private readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;

  constructor(
    parent: HTMLElement,
    private readonly meta: FunnelChartMeta
  ) {
    this.root = overlayDiv('charturbo-sdk-funnel-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

  invalidate(): void {
    this.revision = -1;
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, locale?: string): void {
    const meta = this.meta;
    if (!meta.showLabels) return;
    const a = backend.chart_funnel_labels?.();
    if (!a || a.length < 2 || a[0] === this.revision) return;
    this.revision = a[0];
    const count = Math.min(a[1], Math.floor((a.length - 2) / 5));
    const horizontal = meta.orientation === 'horizontal';
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 5;
      const [stage, x, y, ha, va] = [a[at], a[at + 1], a[at + 2], a[at + 3], a[at + 4]];
      let el = this.labels[k];
      if (!el) {
        el = overlayDiv('charturbo-sdk-funnel-label', { fontSize: '11px', lineHeight: '15px', fontVariantNumeric: 'tabular-nums' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      const p = funnelLabelParts(meta, stage, locale);
      el.replaceChildren();
      const name = document.createElement('div');
      name.textContent = p.name;
      Object.assign(name.style, { color: theme.textSecondary, fontWeight: '500' });
      const value = document.createElement('div');
      const v = document.createElement('span');
      v.textContent = p.value;
      v.style.color = theme.textPrimary;
      value.appendChild(v);
      if (p.conversion) {
        const conv = document.createElement('span');
        conv.textContent = p.conversion;
        // Margin, not a leading space: PNG export trims text nodes but keeps their boxes
        Object.assign(conv.style, { color: theme.textMuted, marginLeft: '6px' });
        value.appendChild(conv);
      }
      el.append(name, value);
      if (horizontal && p.conversion) {
        // Own line under the value (stage columns are narrow)
        const conv = value.children[1] as HTMLElement;
        conv.style.marginLeft = '0px';
        const line = document.createElement('div');
        line.appendChild(conv);
        el.appendChild(line);
      }
      el.style.display = 'block';
      el.style.textAlign = horizontal ? 'center' : 'left';
      placeAt(el, x, y, ha, va);
    }
    for (let k = count; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
