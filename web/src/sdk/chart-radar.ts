/**
 * Radar (spider) chart binding. The engine owns the data logic (radar.rs): validation, the
 * shared nice radial scale and per-axis maxima, polygon / grid / marker geometry, the
 * nearest-axis hover hit test and the axis / ring label anchors. This module encodes the input,
 * keeps the names / colors / values for the legend, tooltip and a11y, and places DOM text at the
 * engine anchors.
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { A11yChartModel, A11ySeries } from './chart-a11y';
import type {
  ChartLegendOptions,
  ChartPaddingOptions,
  ChartTooltipContext,
  NodeMetadata,
  CharturboTheme,
  WasmCharturboEngineBackend,
} from './charturbo';
import {
  esc,
  overlayDiv,
  placeAt,
  plural,
  rgbCss,
  tooltipHeader,
  tooltipRow,
  type A11yCommon,
  type A11yCustomModel,
  type BusinessLabelLayer,
} from './chart-business-util';

export interface RadarSeries {
  name: string;
  /** One value per axis: finite and >= 0; `null` / NaN = missing */
  values: ArrayLike<number | null>;
  /** Default: theme palette slot of the series (fixed order) */
  color?: ColorInput;
}

export interface RadarChartData {
  /** Axis (category) names, clockwise from the start angle; at least 3 */
  axes: string[];
  /** 1 to 8 series */
  series: RadarSeries[];
}

export interface RadarChartOptions {
  /**
   * Radial max: one number shared by every axis (default: the nice max of the data), or one
   * per axis (`null` = the shared max). Ring labels show only on a shared scale
   */
  max?: number | (number | null | undefined)[];
  /** Target ring count (nice steps; default 4) */
  rings?: number;
  /** Polygon fill opacity (default 0.2; 0 = outlines only) */
  fillOpacity?: number;
  /** Polygon stroke width in CSS px (default 2) */
  strokeWidth?: number;
  /** Vertex markers: `true` (default, radius 3.5 px), `false`, or a radius in CSS px */
  markers?: boolean | number;
  /** Degrees clockwise from 12 o'clock of the first axis (default 0) */
  startAngle?: number;
  /** Concentric grid: `'polygon'` (default) or `'circle'` */
  grid?: 'polygon' | 'circle';
  /** Rings / spokes (default: true) */
  showGrid?: boolean;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  /** Legend of the series (default: shown with 2+ series); click toggles, hover emphasizes */
  legend?: ChartLegendOptions | boolean;
  padding?: ChartPaddingOptions;
  /** Tooltip / table name of the values (default `'Value'`) */
  valueLabel?: string;
  /** Value text of rings, tooltip and a11y (spec, Intl options or function; default: locale number) */
  format?: ChartValueFormat;
}

/** Display state the SDK keeps for a radar. */
export interface RadarChartMeta {
  kind: 'radar';
  axes: string[];
  /** Series names / colors / visibility (legend) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  /** Values per series (NaN = missing) */
  values: Float64Array[];
  /** Shared max, ring values and per-axis max from the engine */
  max: number;
  rings: number[];
  axisMax: number[];
  valueLabel: string;
  format: (value: number) => string;
  colorInputs: (ColorInput | undefined)[];
}

/** Hovered radar axis: the axis and its radial max (tooltip). */
export interface ChartRadarTooltip {
  axis: string;
  max: number;
}

export const MAX_RADAR_SERIES = 8;
const GRID_CODES = { polygon: 0, circle: 1 } as const;

/** Validates the shape (the engine validates values) and builds the display meta. */
export function radarMeta(data: RadarChartData, options: RadarChartOptions | undefined, format: (v: number) => string): RadarChartMeta {
  const n = data.axes.length;
  if (data.series.length < 1 || data.series.length > MAX_RADAR_SERIES) {
    throw new RangeError(`radar charts take 1 to ${MAX_RADAR_SERIES} series (got ${data.series.length})`);
  }
  const values = data.series.map((s, k) => {
    if (s.values.length !== n) throw new RangeError(`radar series ${k} has ${s.values.length} values for ${n} axes`);
    return Float64Array.from({ length: n }, (_, i) => {
      const v = s.values[i];
      return v === null || v === undefined ? NaN : Number(v);
    });
  });
  return {
    kind: 'radar',
    axes: [...data.axes],
    names: data.series.map((s, k) => s.name || `Series ${k + 1}`),
    colors: [],
    visible: data.series.map(() => true),
    values,
    max: NaN,
    rings: [],
    axisMax: [],
    valueLabel: options?.valueLabel ?? 'Value',
    format,
    colorInputs: data.series.map((s) => s.color),
  };
}

/** Series colors: own color, else the palette slot (fixed order, never cycled). */
function radarColors(meta: RadarChartMeta, theme: CharturboTheme): RgbaTuple[] {
  return meta.colorInputs.map((c, s) => parseOptionalColor(c) ?? theme.palette[s] ?? theme.palette[theme.palette.length - 1]);
}

/** Room for axis labels: the longest name at ~6.5 px per character (11 px UI font). */
export function radarLabelSpace(axes: string[]): [number, number] {
  const longest = Math.max(0, ...axes.map((a) => a.length));
  return [Math.min(160, Math.max(24, longest * 6.5 + 12)), 22];
}

/** Uploads the radar (`set_radar_chart`) and reads the radial scale back; returns the point count. */
export function sendRadar(backend: WasmCharturboEngineBackend, meta: RadarChartMeta, options: RadarChartOptions | undefined, theme: CharturboTheme): number {
  const n = meta.axes.length;
  const flat = new Float64Array(meta.values.length * n);
  meta.values.forEach((v, s) => flat.set(v, s * n));
  meta.colors = radarColors(meta, theme);
  const colors = new Float32Array(meta.colors.length * 4);
  meta.colors.forEach((c, s) => colors.set(c, s * 4));
  const max = options?.max;
  const shared = typeof max === 'number' ? max : NaN;
  const perAxis = Array.isArray(max) ? Float64Array.from({ length: n }, (_, k) => Number(max[k] ?? NaN)) : new Float64Array(0);
  const markers = options?.markers;
  const markerRadius = markers === false ? 0 : typeof markers === 'number' ? markers : NaN;
  const [sx, sy] = radarLabelSpace(meta.axes);
  const count =
    backend.set_radar_chart?.(
      n,
      meta.values.length,
      flat,
      colors,
      shared,
      perAxis,
      Math.max(0, Math.floor(options?.rings ?? 0)),
      options?.fillOpacity ?? NaN,
      options?.strokeWidth ?? NaN,
      markerRadius,
      options?.startAngle ?? 0,
      GRID_CODES[options?.grid ?? 'polygon'] ?? 0,
      sx,
      sy
    ) ?? 0;
  syncRadarScale(backend, meta);
  return count;
}

/** Re-sends the series colors under `theme` (palette slots follow the theme). */
export function sendRadarColors(backend: WasmCharturboEngineBackend, meta: RadarChartMeta, theme: CharturboTheme): void {
  meta.colors = radarColors(meta, theme);
  const colors = new Float32Array(meta.colors.length * 4);
  meta.colors.forEach((c, s) => colors.set(c, s * 4));
  backend.set_chart_radar_colors?.(colors);
}

/** Reads `[max, step, ring count, rings..., axis max...]` from the engine. */
export function syncRadarScale(backend: WasmCharturboEngineBackend, meta: RadarChartMeta): void {
  const a = backend.chart_radar_scale?.();
  if (!a || a.length < 3) return;
  const rings = a[2];
  meta.max = a[0];
  meta.rings = Array.from(a.subarray(3, 3 + rings));
  meta.axisMax = Array.from(a.subarray(3 + rings, 3 + rings + meta.axes.length));
}

/** Tooltip of a radar hit: every visible series at the hovered axis (engine item order). */
export function radarTooltipContext(
  meta: RadarChartMeta,
  hit: ArrayLike<number>,
  details: (id: number) => ChartTooltipContext['details']
): ChartTooltipContext | null {
  const count = hit[2];
  const axis = hit[4];
  if (axis < 0 || axis >= meta.axes.length) return null;
  const items = [];
  for (let k = 0; k < count; k++) {
    const at = 3 + k * 4;
    const s = hit[at];
    items.push({ seriesName: meta.names[s] ?? `Series ${s + 1}`, value: meta.values[s]?.[hit[at + 1]] ?? hit[at + 2], color: rgbCss(meta.colors[s]), nodeId: hit[at + 3] });
  }
  const primary = items[Math.min(hit[1], items.length - 1)];
  return {
    chartType: 'radar',
    index: axis,
    xLabel: meta.axes[axis],
    items,
    radar: { axis: meta.axes[axis], max: meta.axisMax[axis] ?? meta.max },
    details: primary ? details(primary.nodeId) : null,
  };
}

export function radarTooltipHtml(ctx: ChartTooltipContext, theme: CharturboTheme, formatValue: (v: number) => string): string {
  const rows = ctx.items.map((it) => tooltipRow(theme, it.seriesName, esc(formatValue(it.value)), it.color)).join('');
  return `${tooltipHeader(theme, ctx.xLabel)}${rows}`;
}

export function radarPointMetadata(meta: RadarChartMeta, id: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  const n = meta.axes.length;
  const [s, k] = [Math.floor(id / n), id % n];
  if (s >= meta.names.length) return null;
  const v = meta.values[s][k];
  return {
    series: s,
    color: meta.colors[s] ?? [0.5, 0.5, 0.5, 1],
    metadata: {
      label: `${meta.names[s]} · ${meta.axes[k]}`,
      category: meta.names[s],
      tags: ['radar-chart'],
      attributes: { series: meta.names[s], axis: meta.axes[k], value: Number.isFinite(v) ? Number(v.toPrecision(6)) : 'missing', max: meta.axisMax[k] ?? meta.max },
    },
  };
}

/** A11y model: series = radar series, index = axis (Left / Right axes, Up / Down series). */
export function radarA11yModel(meta: RadarChartMeta, c: A11yCommon): A11yChartModel {
  const series: A11ySeries[] = meta.names.map((name, s) => ({ name, values: meta.values[s] ?? [], visible: meta.visible[s] ?? true, f32: false }));
  const n = meta.axes.length;
  const label = (i: number) => meta.axes[i] ?? `#${i + 1}`;
  const f = c.formatValue;
  const best = (s: number) => {
    const v = meta.values[s];
    let k = -1;
    for (let i = 0; i < n; i++) if (Number.isFinite(v[i]) && (k < 0 || v[i] > v[k])) k = i;
    return k;
  };
  const custom: A11yCustomModel = {
    kindLabel: 'Radar',
    xHeader: 'Axis',
    summary: () => {
      const head = c.title ? `${c.title}. ` : '';
      const parts = meta.names
        .map((name, s) => ({ name, s, k: best(s) }))
        .filter((p) => meta.visible[p.s] !== false && p.k >= 0)
        .slice(0, 4)
        .map((p) => `${p.name} highest on ${label(p.k)} (${f(meta.values[p.s][p.k])})`);
      return `${head}Radar chart, ${plural(n, 'axis', 'axes')}, ${plural(meta.names.length, 'series', 'series')}${parts.length ? `; ${parts.join('; ')}` : ''}.`;
    },
    description: () => {
      const out: string[] = [`Axes: ${meta.axes.join(', ')}.`];
      const shared = meta.axisMax.every((m) => m === meta.max);
      out.push(shared ? `Radial scale from 0 to ${f(meta.max)}.` : `Each axis has its own maximum: ${meta.axes.map((a, k) => `${a} ${f(meta.axisMax[k])}`).join(', ')}.`);
      meta.names.forEach((name, s) => {
        const vals = meta.axes.map((a, k) => `${a} ${f(meta.values[s][k])}`).join(', ');
        out.push(`${name}${meta.visible[s] === false ? ' (hidden)' : ''}: ${vals}.`);
      });
      return out;
    },
    help:
      'Keyboard: focus the chart, then use Left and Right arrows to move between axes, Up and Down arrows to ' +
      'switch series, Home and End for the first and last axis, and Escape to clear.',
    announce: (focus) =>
      `${label(focus.index)}, ${meta.names[focus.series] ?? ''} ${f(meta.values[focus.series]?.[focus.index] ?? NaN)}. ${focus.index + 1} of ${n}.`,
  };
  return {
    kind: 'radar',
    ...c,
    series,
    length: n,
    custom,
    xValue: label,
    xLabel: label,
    formatX: label,
    pointId: (s, i) => s * n + i,
    itemName: (s) => meta.names[s] ?? `Series ${s + 1}`,
    itemColor: (s) => meta.colors[s] ?? [0.5, 0.5, 0.5, 1],
  };
}

/**
 * DOM text of a radar: axis names at the engine anchors (the hovered axis in the primary text
 * color) and ring values beside the first spoke. Re-laid out when the label revision or the
 * hovered axis changes.
 */
export class RadarLabelLayer implements BusinessLabelLayer {
  private readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private key = '';

  constructor(
    parent: HTMLElement,
    private readonly meta: RadarChartMeta
  ) {
    this.root = overlayDiv('charturbo-sdk-radar-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

  invalidate(): void {
    this.key = '';
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme): void {
    const a = backend.chart_radar_labels?.();
    if (!a || a.length < 2) return;
    const hovered = backend.chart_radar_layout?.()?.[3] ?? -1;
    const key = `${a[0]}|${hovered}`;
    if (key === this.key) return;
    this.key = key;
    const count = Math.min(a[1], Math.floor((a.length - 2) / 7));
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 7;
      const [kind, index, value, x, y, ha, va] = [a[at], a[at + 1], a[at + 2], a[at + 3], a[at + 4], a[at + 5], a[at + 6]];
      let el = this.labels[k];
      if (!el) {
        el = overlayDiv('charturbo-sdk-radar-label', { fontVariantNumeric: 'tabular-nums' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      el.style.display = 'block';
      if (kind === 0) {
        el.textContent = this.meta.axes[index] ?? '';
        Object.assign(el.style, {
          fontSize: '11px',
          fontWeight: index === hovered ? '600' : '400',
          color: index === hovered ? theme.textPrimary : theme.textSecondary,
          background: 'none',
          padding: '0',
        });
      } else {
        // Ring values sit inside the plot (over series fills / strokes): a surface backdrop keeps
        // them readable
        const [r, g, b] = theme.surface.map((c) => Math.round(Math.min(1, Math.max(0, c)) * 255));
        el.textContent = this.meta.format(value);
        Object.assign(el.style, {
          fontSize: '10px',
          fontWeight: '400',
          color: theme.textMuted,
          background: `rgba(${r}, ${g}, ${b}, 0.75)`,
          padding: '0 2px',
          borderRadius: '2px',
          lineHeight: '13px',
        });
      }
      placeAt(el, x, y, ha, va);
    }
    for (let k = count; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
