/**
 * Waterfall chart binding. The engine computes the running totals (waterfall.rs) and draws the
 * floating bars through the 2D bar chart (value domain, gridlines, axes, hover, horizontal
 * orientation, data-label anchors with fit / collision tests) plus dashed connectors. This
 * module encodes the input, keeps the items for the legend / tooltip / a11y, and formats the
 * signed value labels (placed by the bar label layer at the engine anchors). Increase /
 * decrease / total use palette slots and a neutral, never red / green alone: the sign is in
 * every label and tooltip.
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { A11yChartModel } from './chart-a11y';
import {
  BarLabelLayer,
  measureLabel,
  resolveBarLabels,
  type BarLabelOptions,
  type BarOrientation,
  type BarStyleState,
} from './chart-bar-style';
import type {
  ChartAxisOptions,
  ChartGridStyle,
  ChartHoverStyle,
  ChartLegendOptions,
  ChartPaddingOptions,
  ChartTooltipContext,
  NodeMetadata,
  VizTheme,
  WasmVizEngineBackend,
} from './viz-engine-sdk';
import { esc, plural, rgbCss, stepSingle, tooltipHeader, tooltipRow, type A11yCommon, type A11yCustomModel, type BusinessLabelLayer } from './chart-business-util';

export interface WaterfallChartData {
  /** Category names, one per value */
  labels: string[];
  /** Changes (finite); total items may be `null` (their value is the running total) */
  values: (number | null)[] | Float64Array;
  /** Subtotal / total items: their indices, or one flag per value */
  totals?: number[] | boolean[];
}

export type WaterfallItemKind = 'increase' | 'decrease' | 'total';

export interface WaterfallChartOptions {
  /** Appends a final total bar: `true` (named `'Total'`) or its name */
  total?: boolean | string;
  /** `'vertical'` (default) or `'horizontal'` (categories down the left axis) */
  orientation?: BarOrientation;
  /** Dashed lines from each bar's end level to the next bar (default: true) */
  connectors?: boolean;
  /** Colors (default: first / second palette slots and the theme's neutral baseline color) */
  colors?: { increase?: ColorInput; decrease?: ColorInput; total?: ColorInput; connector?: ColorInput };
  /** Legend / tooltip names of the kinds (default `Increase` / `Decrease` / `Total`) */
  names?: { increase?: string; decrease?: string; total?: string };
  /**
   * Value labels: `'auto'` (default: hidden where they collide), `true`, `false`, or bar label
   * options. Changes carry their sign (`+1,200`, `−300`); totals show the running total
   */
  labels?: boolean | 'auto' | Omit<BarLabelOptions, 'format'>;
  /** Data-end corner radius in CSS px (default 0) */
  cornerRadius?: number;
  axes?: { x?: ChartAxisOptions; y?: ChartAxisOptions };
  /** Value gridlines + baseline (default: true) */
  showBackdropGrid?: boolean;
  grid?: ChartGridStyle;
  /** Hovered bar highlight */
  hover?: ChartHoverStyle;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  /** Legend of the kinds present (default: shown with 2+ kinds; static) */
  legend?: ChartLegendOptions | boolean;
  padding?: ChartPaddingOptions;
  /** Tooltip / table name of the changes (default `'Change'`) */
  valueLabel?: string;
  /** Value text of labels, tooltip and a11y (spec, Intl options or function; default: locale number) */
  format?: ChartValueFormat;
}

export interface WaterfallItemMeta {
  kind: WaterfallItemKind;
  /** The change, or the running total of a total item */
  value: number;
  start: number;
  end: number;
}

/** Display state the SDK keeps for a waterfall. */
export interface WaterfallChartMeta {
  kind: 'waterfall';
  categories: string[];
  /** Input changes (NaN on total items) and total flags, after `options.total` */
  values: Float64Array;
  totals: boolean[];
  items: WaterfallItemMeta[];
  /** Legend: the kinds present (static) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  kindColors: Record<WaterfallItemKind, RgbaTuple>;
  kindNames: Record<WaterfallItemKind, string>;
  barStyle: BarStyleState;
  valueLabel: string;
  format: (value: number) => string;
  colorInputs: WaterfallChartOptions['colors'];
}

/** Hovered waterfall bar. */
export interface ChartWaterfallTooltip {
  kind: WaterfallItemKind;
  /** The change (a total item: the running total) */
  change: number;
  start: number;
  end: number;
}

const KIND_CODES: WaterfallItemKind[] = ['increase', 'decrease', 'total'];

/** Normalizes the input (totals, appended total) and builds the display meta. */
export function waterfallMeta(
  data: WaterfallChartData,
  options: WaterfallChartOptions | undefined,
  format: (v: number) => string
): WaterfallChartMeta {
  const n = data.labels.length;
  if (data.values.length !== n) throw new RangeError(`waterfall: ${data.values.length} values for ${n} labels`);
  const totals = new Array<boolean>(n).fill(false);
  const t = data.totals ?? [];
  if (t.length && typeof t[0] === 'boolean') (t as boolean[]).forEach((on, i) => i < n && (totals[i] = !!on));
  else (t as number[]).forEach((i) => Number.isInteger(i) && i >= 0 && i < n && (totals[i] = true));
  const categories = [...data.labels];
  const values = Array.from(data.values, (v) => (v === null || v === undefined ? NaN : Number(v)));
  if (options?.total) {
    categories.push(typeof options.total === 'string' ? options.total : 'Total');
    values.push(NaN);
    totals.push(true);
  }
  const labels = resolveBarLabels(options?.labels === undefined ? 'auto' : (options.labels as boolean | 'auto' | BarLabelOptions));
  return {
    kind: 'waterfall',
    categories,
    values: Float64Array.from(values),
    totals,
    items: [],
    names: [],
    colors: [],
    visible: [],
    kindColors: { increase: [0, 0, 0, 1], decrease: [0, 0, 0, 1], total: [0, 0, 0, 1] },
    kindNames: {
      increase: options?.names?.increase ?? 'Increase',
      decrease: options?.names?.decrease ?? 'Decrease',
      total: options?.names?.total ?? 'Total',
    },
    barStyle: {
      orientation: options?.orientation === 'horizontal' ? 'horizontal' : 'vertical',
      labels,
      errMinus: null,
      errPlus: null,
      errorBar: {},
      texts: [],
    },
    valueLabel: options?.valueLabel ?? 'Change',
    format,
    colorInputs: options?.colors,
  };
}

function styleArray(meta: WaterfallChartMeta, theme: VizTheme): Float32Array {
  const c = meta.colorInputs ?? {};
  meta.kindColors = {
    increase: parseOptionalColor(c.increase) ?? theme.palette[0],
    decrease: parseOptionalColor(c.decrease) ?? theme.palette[1] ?? theme.palette[0],
    total: parseOptionalColor(c.total) ?? theme.baseline,
  };
  const connector = parseOptionalColor(c.connector) ?? theme.baseline;
  return Float32Array.from([...meta.kindColors.increase, ...meta.kindColors.decrease, ...meta.kindColors.total, ...connector]);
}

/** Legend entries of the kinds present, in increase / decrease / total order. */
function syncLegend(meta: WaterfallChartMeta): void {
  const present = KIND_CODES.filter((k) => meta.items.some((it) => it.kind === k));
  meta.names = present.map((k) => meta.kindNames[k]);
  meta.colors = present.map((k) => meta.kindColors[k]);
  meta.visible = present.map(() => true);
}

/** Uploads the waterfall (`set_waterfall_chart`) and reads the running totals back. */
export function sendWaterfall(
  backend: WasmVizEngineBackend,
  meta: WaterfallChartMeta,
  options: WaterfallChartOptions | undefined,
  theme: VizTheme
): number {
  const n =
    backend.set_waterfall_chart?.(
      meta.values,
      Uint8Array.from(meta.totals, (t) => (t ? 1 : 0)),
      meta.barStyle.orientation === 'horizontal' ? 1 : 0,
      options?.connectors ?? true,
      options?.cornerRadius ?? 0,
      styleArray(meta, theme),
      NaN,
      NaN,
      NaN
    ) ?? 0;
  const a = backend.chart_waterfall_items?.() ?? new Float64Array(0);
  meta.items = [];
  for (let k = 0; k + 3 < a.length; k += 4) meta.items.push({ kind: KIND_CODES[a[k]] ?? 'increase', value: a[k + 1], start: a[k + 2], end: a[k + 3] });
  syncLegend(meta);
  return n;
}

export function sendWaterfallStyle(backend: WasmVizEngineBackend, meta: WaterfallChartMeta, theme: VizTheme): void {
  backend.set_chart_waterfall_style?.(styleArray(meta, theme), NaN);
  syncLegend(meta);
}

/** Signed change text (`+1,200`, `−300`) or the plain total. */
export function waterfallValueText(meta: WaterfallChartMeta, item: WaterfallItemMeta): string {
  if (item.kind === 'total') return meta.format(item.value);
  const sign = item.value > 0 ? '+' : item.value < 0 ? '−' : '';
  return `${sign}${meta.format(Math.abs(item.value))}`;
}

/** Label texts + measured sizes for the engine (`set_bar_labels`; bar id = item). */
export function sendWaterfallLabels(backend: WasmVizEngineBackend, meta: WaterfallChartMeta, fontFamily: string): void {
  const st = meta.barStyle;
  const l = st.labels;
  st.texts = l ? meta.items.map((it) => waterfallValueText(meta, it)) : [];
  if (!l) {
    backend.set_bar_labels?.(0, 0, new Float32Array(0), 0, NaN);
    return;
  }
  const codes = { outside: 0, inside: 1, insideBase: 2, center: 3 } as const;
  const widths = Float32Array.from(st.texts, (t) => (t ? measureLabel(t, fontFamily) : NaN));
  backend.set_bar_labels?.(l.mode, codes[l.position], widths, 14, NaN);
}

export function waterfallTooltipContext(meta: WaterfallChartMeta, i: number, details: (id: number) => ChartTooltipContext['details']): ChartTooltipContext | null {
  const it = meta.items[i];
  if (!it) return null;
  return {
    chartType: 'waterfall',
    index: i,
    xLabel: meta.categories[i] ?? `#${i + 1}`,
    items: [{ seriesName: meta.kindNames[it.kind], value: it.value, color: rgbCss(meta.kindColors[it.kind]), nodeId: i }],
    waterfall: { kind: it.kind, change: it.value, start: it.start, end: it.end },
    details: details(i),
  };
}

export function waterfallTooltipHtml(ctx: ChartTooltipContext, theme: VizTheme, formatValue: (v: number) => string): string {
  const w = ctx.waterfall;
  const it = ctx.items[0];
  if (!w || !it) return '';
  if (w.kind === 'total') return `${tooltipHeader(theme, ctx.xLabel)}${tooltipRow(theme, it.seriesName, esc(formatValue(w.end)), it.color)}`;
  const sign = w.change > 0 ? '+' : w.change < 0 ? '−' : '';
  return `${tooltipHeader(theme, ctx.xLabel)}${tooltipRow(theme, it.seriesName, esc(`${sign}${formatValue(Math.abs(w.change))}`), it.color)}${tooltipRow(
    theme,
    'Running total',
    esc(formatValue(w.end))
  )}`;
}

export function waterfallPointMetadata(meta: WaterfallChartMeta, i: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  const it = meta.items[i];
  if (!it) return null;
  return {
    series: 0,
    color: meta.kindColors[it.kind],
    metadata: {
      label: meta.categories[i] ?? `#${i + 1}`,
      category: meta.kindNames[it.kind],
      tags: ['waterfall-chart', it.kind],
      attributes: { kind: it.kind, change: it.value, start: it.start, end: it.end },
    },
  };
}

/** A11y model: one stop per bar; table columns change and running total. */
export function waterfallA11yModel(meta: WaterfallChartMeta, c: A11yCommon): A11yChartModel {
  const n = meta.items.length;
  const f = c.formatValue;
  const label = (i: number) => meta.categories[i] ?? `#${i + 1}`;
  const signed = (v: number) => (v > 0 ? `+${f(v)}` : v < 0 ? `−${f(-v)}` : f(v));
  const changes = meta.items.map((it) => (it.kind === 'total' ? NaN : it.value));
  const ends = meta.items.map((it) => it.end);
  const extreme = (dir: 1 | -1) => {
    let k = -1;
    changes.forEach((v, i) => {
      if (Number.isFinite(v) && v * dir > 0 && (k < 0 || v * dir > changes[k] * dir)) k = i;
    });
    return k;
  };
  const custom: A11yCustomModel = {
    kindLabel: 'Waterfall',
    summary: () => {
      const head = c.title ? `${c.title}. ` : '';
      const parts: string[] = [];
      const up = extreme(1);
      const down = extreme(-1);
      if (up >= 0) parts.push(`largest increase ${label(up)} ${signed(changes[up])}`);
      if (down >= 0) parts.push(`largest decrease ${label(down)} ${signed(changes[down])}`);
      const final = n ? `, ending at ${f(ends[n - 1])}` : '';
      return `${head}Waterfall chart, ${plural(n, 'item')}${final}${parts.length ? `; ${parts.join('; ')}` : ''}.`;
    },
    description: () =>
      meta.items.map((it, i) =>
        it.kind === 'total' ? `${label(i)}: ${meta.kindNames.total.toLowerCase()} ${f(it.end)}.` : `${label(i)}: ${signed(it.value)}, running total ${f(it.end)}.`
      ),
    help: 'Keyboard: focus the chart, then use Left and Right arrows to move between bars, Home and End for the first and last bar, and Escape to clear.',
    announce: (focus) => {
      const i = focus.index;
      const it = meta.items[i];
      if (!it) return '';
      const text = it.kind === 'total' ? `${meta.kindNames.total} ${f(it.end)}` : `${signed(it.value)}, running total ${f(it.end)}`;
      return `${label(i)}, ${text}. ${i + 1} of ${n}.`;
    },
    step: (focus, key) => stepSingle(focus, key, n),
  };
  return {
    kind: 'waterfall',
    ...c,
    series: [
      { name: meta.valueLabel, values: changes, visible: true, f32: false },
      { name: 'Running total', values: ends, visible: true, f32: false },
    ],
    length: n,
    custom,
    xValue: label,
    xLabel: label,
    formatX: label,
    pointId: (_s, i) => i,
    itemName: (_s, i) => meta.kindNames[meta.items[i]?.kind ?? 'increase'],
    itemColor: (_s, i) => meta.kindColors[meta.items[i]?.kind ?? 'increase'],
  };
}

/** Value labels: the bar label layer reads the engine anchors (`chart_bar_labels`). */
export class WaterfallLabelLayer implements BusinessLabelLayer {
  private readonly bars: BarLabelLayer;

  constructor(parent: HTMLElement, meta: WaterfallChartMeta) {
    this.bars = new BarLabelLayer(parent, meta.barStyle, (id) => meta.kindColors[meta.items[id]?.kind ?? 'increase']);
  }

  invalidate(): void {
    this.bars.invalidate();
  }

  update(backend: WasmVizEngineBackend, theme: VizTheme): void {
    this.bars.update(backend, theme);
  }

  remove(): void {
    this.bars.remove();
  }
}
