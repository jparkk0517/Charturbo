/**
 * Gauge binding. The engine owns the geometry (gauge.rs): arc and band tessellation (2 px gaps,
 * anti-aliased edges), needle / progress indicator, the band of the value, hover hit tests and
 * the label anchors (min / max / value / bands). `setGaugeValue` only moves the indicator: the
 * cached band geometry and the label anchors stay. This module encodes the input, resolves the
 * reserved status colors, and places DOM text (value, caption, status, band labels).
 */
import { parseColor, parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { A11yChartModel, ChartDataTable } from './chart-a11y';
import type { ChartPaddingOptions, ChartTooltipContext, NodeMetadata, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import {
  esc,
  overlayDiv,
  placeAt,
  rgbCss,
  stepSingle,
  tooltipHeader,
  tooltipRow,
  type A11yCommon,
  type A11yCustomModel,
  type BusinessLabelLayer,
} from './chart-business-util';
import { formatCount, getMessages } from './i18n';

/** Reserved status scale (dataviz status palette; never themed, never used for series). */
export type GaugeStatus = 'good' | 'warning' | 'serious' | 'critical';

export const GAUGE_STATUS_COLORS: Record<GaugeStatus, string> = {
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
};

/**
 * Status shapes shown beside the (localized) status name: a status color never carries the
 * meaning alone.
 */
export const GAUGE_STATUS_ICONS: Record<GaugeStatus, string> = {
  good: '✓',
  warning: '▲',
  serious: '◆',
  critical: '✖',
};

export interface GaugeBandOptions {
  from: number;
  to: number;
  /** Status band: reserved status color + icon + label */
  status?: GaugeStatus;
  /** Band color (default: the status color, else the theme palette slot) */
  color?: ColorInput;
  /** Label beside the band and in tooltips (default: the status name in the chart locale) */
  label?: string;
}

export interface GaugeChartData {
  /** Current value (`NaN` = no value); values outside `[min, max]` pin to the ends */
  value: number;
}

export interface GaugeChartOptions {
  /** Default 0 */
  min?: number;
  /** Default 100 */
  max?: number;
  /** Threshold ranges in value units (clipped to the range; where bands overlap, the one starting later wins) */
  bands?: GaugeBandOptions[];
  /** `'needle'` (default with bands) or `'progress'` (filled arc; default without bands) */
  indicator?: 'needle' | 'progress';
  /** Arc start / end in degrees clockwise from 12 o'clock (default -120 / 120) */
  startAngle?: number;
  endAngle?: number;
  /** Ring thickness as a fraction of the radius (default 0.2) */
  thickness?: number;
  /** Labels beside the bands (default: true when a band has a label or status) */
  bandLabels?: boolean;
  /** Min / max labels at the arc ends (default: true) */
  showMinMax?: boolean;
  /** Caption under the value (e.g. the unit or metric name) */
  label?: string;
  /** Unfilled arc color (default: theme grid color) */
  trackColor?: ColorInput;
  /** Progress color when the value is in no band (default: first palette slot) */
  color?: ColorInput;
  /** Needle color (default: theme primary text color) */
  needleColor?: ColorInput;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  padding?: ChartPaddingOptions;
  /** Tooltip / table name of the value (default: `'Value'` in the chart locale) */
  valueLabel?: string;
  /** Value / min / max text (spec, Intl options or function; default: locale number) */
  format?: ChartValueFormat;
}

/** One band in drawing order (sorted by `from`, clipped). */
export interface GaugeBandMeta {
  from: number;
  to: number;
  color: RgbaTuple;
  label: string;
  status?: GaugeStatus;
  /** Index in `options.bands` */
  source: number;
}

/** Display state the SDK keeps for a gauge. */
export interface GaugeChartMeta {
  kind: 'gauge';
  value: number;
  min: number;
  max: number;
  bands: GaugeBandMeta[];
  indicator: 'needle' | 'progress';
  caption: string;
  showMinMax: boolean;
  /** No legend (fixed single series) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  valueLabel: string;
  format: (value: number) => string;
  inputs: Pick<GaugeChartOptions, 'trackColor' | 'color' | 'needleColor'>;
  /** Input bands (colors follow the theme for palette-colored bands) */
  bandInputs: GaugeBandOptions[];
  /** Locale of the default names (`localizeGaugeMeta`) */
  locale?: string;
  /** Value label as given (absent = the localized default) */
  valueLabelInput?: string;
}

/** Gauge tooltip: the value, range, and the band under the pointer / containing the value. */
export interface ChartGaugeTooltip {
  value: number;
  min: number;
  max: number;
  band?: { label: string; from: number; to: number; status?: GaugeStatus };
}

/** Builds the display meta (bands are filled from the engine by `sendGauge`). */
export function gaugeMeta(
  data: GaugeChartData,
  options: GaugeChartOptions | undefined,
  format: (v: number) => string,
  locale?: string
): GaugeChartMeta {
  const bands = options?.bands ?? [];
  const meta: GaugeChartMeta = {
    kind: 'gauge',
    value: Number(data.value),
    min: options?.min ?? 0,
    max: options?.max ?? 100,
    bands: [],
    indicator: options?.indicator ?? (bands.length ? 'needle' : 'progress'),
    caption: options?.label ?? '',
    showMinMax: options?.showMinMax ?? true,
    names: [],
    colors: [],
    visible: [true],
    valueLabel: '',
    format,
    inputs: { trackColor: options?.trackColor, color: options?.color, needleColor: options?.needleColor },
    bandInputs: bands,
    valueLabelInput: options?.valueLabel,
  };
  localizeGaugeMeta(meta, locale);
  return meta;
}

/** Default value label / status band names in `locale` (labels given in the options win). */
export function localizeGaugeMeta(meta: GaugeChartMeta, locale: string | undefined): void {
  meta.locale = locale;
  meta.valueLabel = meta.valueLabelInput ?? getMessages(locale).common.value;
  for (const b of meta.bands) b.label = bandLabel(meta.bandInputs[b.source], locale);
}

function bandColor(b: GaugeBandOptions, k: number, theme: CharturboTheme): RgbaTuple {
  return parseOptionalColor(b.color) ?? (b.status ? parseColor(GAUGE_STATUS_COLORS[b.status]) : (theme.palette[k] ?? theme.baseline));
}

function bandLabel(b: GaugeBandOptions, locale: string | undefined): string {
  return b.label ?? (b.status ? getMessages(locale).business.status[b.status] : '');
}

function styleArray(meta: GaugeChartMeta, theme: CharturboTheme): Float32Array {
  const track = parseOptionalColor(meta.inputs.trackColor) ?? theme.grid;
  const progress = parseOptionalColor(meta.inputs.color) ?? theme.palette[0];
  const needle = parseOptionalColor(meta.inputs.needleColor) ?? parseColor(theme.textPrimary);
  return Float32Array.from([...track, ...progress, ...needle, ...theme.surface]);
}

/** Uploads the gauge (`set_gauge_chart`; the engine throws on an invalid range / band). */
export function sendGauge(backend: WasmCharturboEngineBackend, meta: GaugeChartMeta, options: GaugeChartOptions | undefined, theme: CharturboTheme): number {
  const inputs = meta.bandInputs;
  const ranges = new Float64Array(inputs.length * 2);
  const colors = new Float32Array(inputs.length * 4);
  const label = (b: GaugeBandOptions) => bandLabel(b, meta.locale);
  const showBandLabels = options?.bandLabels ?? inputs.some((b) => label(b));
  const labeled = Uint8Array.from(inputs, (b) => (showBandLabels && label(b) ? 1 : 0));
  inputs.forEach((b, k) => {
    ranges[k * 2] = Number(b.from);
    ranges[k * 2 + 1] = Number(b.to);
    colors.set(bandColor(b, k, theme), k * 4);
  });
  const longest = Math.max(0, ...inputs.filter((_, k) => labeled[k]).map((b) => label(b).length));
  const beside = longest > 0 ? Math.min(160, longest * 6.5 + 28) : 0;
  const n =
    backend.set_gauge_chart?.(
      meta.value,
      meta.min,
      meta.max,
      options?.startAngle ?? NaN,
      options?.endAngle ?? NaN,
      options?.thickness ?? NaN,
      meta.indicator === 'progress' ? 1 : 0,
      ranges,
      colors,
      labeled,
      styleArray(meta, theme),
      beside,
      longest > 0 ? 20 : meta.showMinMax ? 18 : 0
    ) ?? 0;
  syncGaugeBands(backend, meta, theme);
  return n;
}

/** Drawing-order bands (clipped / sorted by the engine) with their colors and labels. */
export function syncGaugeBands(backend: WasmCharturboEngineBackend, meta: GaugeChartMeta, theme: CharturboTheme): void {
  const a = backend.chart_gauge_bands?.();
  if (!a) return;
  meta.bands = [];
  for (let k = 0; k + 2 < a.length; k += 3) {
    const src = a[k];
    const b = meta.bandInputs[src];
    if (!b) continue;
    meta.bands.push({ from: a[k + 1], to: a[k + 2], color: bandColor(b, src, theme), label: bandLabel(b, meta.locale), ...(b.status ? { status: b.status } : {}), source: src });
  }
}

/** Theme change: track / needle / surface follow the theme (bands keep their colors). */
export function sendGaugeStyle(backend: WasmCharturboEngineBackend, meta: GaugeChartMeta, theme: CharturboTheme): void {
  backend.set_chart_gauge_style?.(styleArray(meta, theme));
  // Palette-colored bands follow the theme (status / explicit colors are fixed)
  const colors = new Float32Array(meta.bandInputs.length * 4);
  meta.bandInputs.forEach((b, k) => colors.set(bandColor(b, k, theme), k * 4));
  backend.set_chart_gauge_band_colors?.(colors);
  for (const b of meta.bands) b.color = bandColor(meta.bandInputs[b.source], b.source, theme);
}

/**
 * Band containing the value (the last one where bands overlap), drawing order. Values outside
 * the range pin to its ends like the indicator.
 */
export function gaugeBandOf(meta: GaugeChartMeta, value: number): number {
  if (!Number.isFinite(value)) return -1;
  const v = Math.min(meta.max, Math.max(meta.min, value));
  for (let k = meta.bands.length - 1; k >= 0; k--) if (v >= meta.bands[k].from && v <= meta.bands[k].to) return k;
  return -1;
}

/** Band label, else the localized `Band k` */
const bandName = (b: GaugeBandMeta, k: number, locale: string | undefined) =>
  b.label || getMessages(locale).business.bandName(formatCount(k + 1, locale));

/** Tooltip of gauge point `id` (0 = value, `1 + k` = band `k`). */
export function gaugeTooltipContext(meta: GaugeChartMeta, id: number, details: (id: number) => ChartTooltipContext['details']): ChartTooltipContext | null {
  const k = id === 0 ? gaugeBandOf(meta, meta.value) : id - 1;
  const b = meta.bands[k];
  if (id > meta.bands.length || (id > 0 && !b)) return null;
  const band = b ? { band: { label: bandName(b, k, meta.locale), from: b.from, to: b.to, ...(b.status ? { status: b.status } : {}) } } : {};
  const name = id === 0 ? meta.valueLabel : bandName(b, k, meta.locale);
  return {
    chartType: 'gauge',
    index: id,
    xLabel: name,
    items: [{ seriesName: name, value: id === 0 ? meta.value : b.to, color: rgbCss(b?.color ?? [0.5, 0.5, 0.5, 1]), nodeId: id }],
    gauge: { value: meta.value, min: meta.min, max: meta.max, ...band },
    details: details(id),
  };
}

export function gaugeTooltipHtml(
  ctx: ChartTooltipContext,
  meta: GaugeChartMeta,
  theme: CharturboTheme,
  formatValue: (v: number) => string,
  locale?: string
): string {
  const g = ctx.gauge;
  if (!g) return '';
  const m = getMessages(locale).business;
  const status = (b: NonNullable<ChartGaugeTooltip['band']>) => {
    const icon = b.status ? `<span style="color:${ctx.items[0]?.color};margin-right:4px;">${GAUGE_STATUS_ICONS[b.status]}</span>` : '';
    return `${icon}${esc(b.label)}`;
  };
  const range = (from: number, to: number) => `${esc(formatValue(from))} – ${esc(formatValue(to))}`;
  if (ctx.index === 0) {
    return `${tooltipHeader(theme, meta.valueLabel)}${tooltipRow(theme, meta.valueLabel, esc(Number.isFinite(g.value) ? formatValue(g.value) : m.noValue))}${
      g.band ? tooltipRow(theme, m.statusLabel, status(g.band)) : ''
    }${tooltipRow(theme, m.range, range(g.min, g.max))}`;
  }
  return g.band ? `${tooltipHeader(theme, m.band)}${tooltipRow(theme, status(g.band), range(g.band.from, g.band.to), ctx.items[0]?.color, true)}` : '';
}

export function gaugePointMetadata(meta: GaugeChartMeta, id: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  if (id === 0) {
    const k = gaugeBandOf(meta, meta.value);
    return {
      series: 0,
      color: meta.bands[k]?.color ?? [0.5, 0.5, 0.5, 1],
      metadata: {
        label: meta.valueLabel,
        category: 'gauge',
        tags: ['gauge'],
        attributes: { value: Number.isFinite(meta.value) ? meta.value : 'none', min: meta.min, max: meta.max, ...(k >= 0 ? { band: bandName(meta.bands[k], k, meta.locale) } : {}) },
      },
    };
  }
  const b = meta.bands[id - 1];
  if (!b) return null;
  return {
    series: 0,
    color: b.color,
    metadata: { label: bandName(b, id - 1, meta.locale), category: 'gauge band', tags: ['gauge', ...(b.status ? [b.status] : [])], attributes: { from: b.from, to: b.to } },
  };
}

/** A11y model: one stop for the value, then one per band (Left / Right). */
export function gaugeA11yModel(meta: GaugeChartMeta, c: A11yCommon): A11yChartModel {
  const f = c.formatValue;
  const count = 1 + meta.bands.length;
  const locale = c.locale ?? meta.locale;
  const { common: cm, business: bm } = getMessages(locale);
  const num = (v: number) => formatCount(v, locale);
  const name = (k: number) => bandName(meta.bands[k], k, locale);
  const label = (i: number) => (i === 0 ? meta.valueLabel : name(i - 1));
  /** Name of the band containing the value (`''` = none) */
  const statusOf = (k: number) => (k >= 0 ? name(k) : '');
  const valueText = () => (Number.isFinite(meta.value) ? f(meta.value) : bm.noValue);
  const custom: A11yCustomModel = {
    kindLabel: cm.kind.gauge,
    summary: () => {
      const n = meta.bands.length;
      const text = bm.gaugeSummary(valueText(), statusOf(gaugeBandOf(meta, meta.value)), f(meta.min), f(meta.max), n, num(n));
      return c.title ? bm.titled(c.title, text) : text;
    },
    description: () => meta.bands.map((b, k) => bm.gaugeBand(name(k), f(b.from), f(b.to))),
    help: bm.gaugeHelp,
    announce: (focus) => {
      const i = focus.index;
      const position = cm.position(num(i + 1), num(count));
      if (i === 0) return bm.gaugeValueAnnounce(meta.valueLabel, valueText(), statusOf(gaugeBandOf(meta, meta.value)), position);
      const b = meta.bands[i - 1];
      return b ? bm.gaugeBandAnnounce(name(i - 1), f(b.from), f(b.to), position) : '';
    },
    step: (focus, key) => stepSingle(focus, key, count),
    table: (pick): ChartDataTable => {
      const rows = pick(count).map((i) => {
        if (i === 0) return [meta.valueLabel, Number.isFinite(meta.value) ? meta.value : null, meta.min, meta.max];
        const b = meta.bands[i - 1];
        return [name(i - 1), null, b.from, b.to];
      });
      return { columns: [bm.item, cm.value, bm.from, bm.to], rows, totalRows: count, sampled: rows.length < count };
    },
  };
  const values = [meta.value, ...meta.bands.map((b) => b.to)];
  return {
    kind: 'gauge',
    ...c,
    locale,
    series: [{ name: meta.valueLabel, values, visible: true, f32: false }],
    length: count,
    custom,
    xValue: label,
    xLabel: label,
    formatX: label,
    pointId: (_s, i) => i,
    itemName: (_s, i) => label(i),
    itemColor: (_s, i) => (i === 0 ? (meta.bands[gaugeBandOf(meta, meta.value)]?.color ?? [0.5, 0.5, 0.5, 1]) : (meta.bands[i - 1]?.color ?? [0.5, 0.5, 0.5, 1])),
  };
}

/**
 * DOM text of a gauge: min / max at the arc ends, the value (with its caption and the status of
 * its band) in the center, and band labels beside the arc. Re-laid out when the label revision,
 * the value or its band changes.
 */
export class GaugeLabelLayer implements BusinessLabelLayer {
  private readonly root: HTMLDivElement;
  private readonly value: HTMLDivElement;
  private readonly valueText: HTMLDivElement;
  private readonly caption: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private key = '';

  constructor(
    parent: HTMLElement,
    private readonly meta: GaugeChartMeta
  ) {
    this.root = overlayDiv('charturbo-sdk-gauge-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    this.value = overlayDiv('charturbo-sdk-gauge-value', { textAlign: 'center', display: 'none' });
    this.valueText = overlayDiv('charturbo-sdk-gauge-value-text', { position: 'static', fontSize: '28px', fontWeight: '600', fontVariantNumeric: 'tabular-nums', lineHeight: '32px' });
    this.caption = overlayDiv('charturbo-sdk-gauge-caption', { position: 'static', fontSize: '11px', lineHeight: '15px' });
    this.status = overlayDiv('charturbo-sdk-gauge-status', { position: 'static', fontSize: '11px', lineHeight: '15px', marginTop: '2px' });
    this.value.append(this.valueText, this.caption, this.status);
    this.root.append(this.value);
    parent.appendChild(this.root);
  }

  invalidate(): void {
    this.key = '';
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, locale?: string): void {
    const a = backend.chart_gauge_labels?.();
    if (!a || a.length < 2) return;
    const meta = this.meta;
    const key = `${a[0]}|${meta.value}`;
    if (key === this.key) return;
    this.key = key;
    const count = Math.min(a[1], Math.floor((a.length - 2) / 6));
    let used = 0;
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 6;
      const [kind, index, x, y, ha, va] = [a[at], a[at + 1], a[at + 2], a[at + 3], a[at + 4], a[at + 5]];
      if (kind === 2) {
        this.layoutValue(theme, x, y, va, locale);
        continue;
      }
      if (kind !== 3 && !meta.showMinMax) continue;
      let el = this.labels[used];
      if (!el) {
        el = overlayDiv('charturbo-sdk-gauge-label', { fontSize: '11px', fontVariantNumeric: 'tabular-nums' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      used++;
      el.style.display = 'block';
      el.replaceChildren();
      if (kind === 3) {
        const b = meta.bands[index];
        if (b?.status) {
          const icon = document.createElement('span');
          icon.textContent = GAUGE_STATUS_ICONS[b.status];
          // The shape beside the text carries the status color; the text stays in text tokens
          Object.assign(icon.style, { color: rgbCss(b.color), marginRight: '4px' });
          el.appendChild(icon);
        }
        const t = document.createElement('span');
        t.textContent = b ? b.label : '';
        el.appendChild(t);
        el.style.color = theme.textSecondary;
      } else {
        el.textContent = meta.format(kind === 0 ? meta.min : meta.max);
        el.style.color = theme.textMuted;
      }
      placeAt(el, x, y, ha, va);
    }
    for (let k = used; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  private layoutValue(theme: CharturboTheme, x: number, y: number, va: number, locale: string | undefined): void {
    const meta = this.meta;
    this.value.style.display = 'block';
    this.valueText.textContent = Number.isFinite(meta.value) ? meta.format(meta.value) : getMessages(locale).common.dash;
    this.valueText.style.color = theme.textPrimary;
    this.caption.textContent = meta.caption;
    this.caption.style.display = meta.caption ? 'block' : 'none';
    this.caption.style.color = theme.textMuted;
    const k = gaugeBandOf(meta, meta.value);
    const b = meta.bands[k];
    this.status.replaceChildren();
    if (b && b.label) {
      if (b.status) {
        const icon = document.createElement('span');
        icon.textContent = GAUGE_STATUS_ICONS[b.status];
        Object.assign(icon.style, { color: rgbCss(b.color), marginRight: '4px' });
        this.status.appendChild(icon);
      }
      const t = document.createElement('span');
      t.textContent = b.label;
      this.status.appendChild(t);
    }
    this.status.style.display = b && b.label ? 'block' : 'none';
    this.status.style.color = theme.textSecondary;
    placeAt(this.value, x, y, 0, va);
  }

  remove(): void {
    this.root.remove();
  }
}
