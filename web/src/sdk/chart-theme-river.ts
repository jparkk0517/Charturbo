/**
 * ThemeRiver (streamgraph, ECharts `series.type: 'themeRiver'`): `[x, value, name]` rows become
 * one aligned stream per name, stacked around a moving baseline by the engine
 * (crates/charturbo-core/src/chart/theme_river.rs: d3 `stackOffsetWiggle` by default). Strokes,
 * fills, curves, zoom / pan, hover, legend (a toggle re-orders and recomputes the baseline),
 * streaming (`appendAreaData`), a11y, CSV and SVG are the stacked area chart's; this module adds
 * the input conversion and the stream name labels at the left end of each stream.
 */
import type { ColorInput } from './color';
import type { CharturboTheme, LineChartOptions, LineSeriesDescriptor, WasmCharturboEngineBackend } from './charturbo';
import { overlayDiv, placeAt } from './chart-business-util';

/** One row: `[x, value, name]`. `x` is a number, a `Date` or a date string (`Date.parse`). */
export type ThemeRiverDatum = readonly [x: number | Date | string, value: number, name: string];

export interface ThemeRiverLabelOptions {
  /** Default: true */
  show?: boolean;
  /** Streams thinner than this at the left edge get no label (CSS px; default 12) */
  minHeight?: number;
}

/** ThemeRiver options: 2D line options plus the stream layout. */
export interface ThemeRiverChartOptions extends Omit<LineChartOptions, 'viewMode' | 'nulls'> {
  /**
   * Baseline: `'wiggle'` (default; minimized weighted wiggle, d3 `stackOffsetWiggle`),
   * `'silhouette'` (centered on zero) or `'zero'` (a plain stack)
   */
  offset?: 'wiggle' | 'silhouette' | 'zero';
  /**
   * Stacking order: `'none'` (default: names in order of first appearance, first at the bottom)
   * or `'insideOut'` (d3 `stackOrderInsideOut`: early-peaking streams in the middle)
   */
  order?: 'none' | 'insideOut';
  /** Smooth (monotone) stream edges (default: true); `false` = straight segments */
  smooth?: boolean;
  /** Stream colors by name, or in stream order (default: the theme palette) */
  colors?: Record<string, ColorInput> | readonly ColorInput[];
  /** Fill alpha multiplier of the stream colors (default 0.85) */
  fillOpacity?: number;
  /** Stream name labels at the left end of each visible stream (default: shown) */
  labels?: boolean | ThemeRiverLabelOptions;
}

/** Engine codes and label settings kept with the chart. */
export interface ThemeRiverMeta {
  offset: number;
  order: number;
  labels: { show: boolean; minHeight: number };
}

export interface ThemeRiverSpec {
  series: LineSeriesDescriptor[];
  /** Sorted union of the x values */
  x: number[];
  /** Any x given as a Date / date string */
  time: boolean;
  meta: ThemeRiverMeta;
}

const OFFSETS = { wiggle: 0, silhouette: 1, zero: 2 } as const;
const ORDERS = { none: 0, insideOut: 1 } as const;

function xValue(x: unknown): { v: number; time: boolean } {
  if (x instanceof Date) return { v: x.getTime(), time: true };
  if (typeof x === 'string') return { v: Date.parse(x), time: true };
  return { v: typeof x === 'number' ? x : NaN, time: false };
}

/**
 * Groups `[x, value, name]` rows into aligned streams: names in order of first appearance, x =
 * the sorted union (a stream without a row at some x is 0 there), rows sharing x and name are
 * summed. Values must be finite and >= 0 (a stream is a magnitude); x finite.
 */
export function themeRiverSeries(data: readonly ThemeRiverDatum[], options: ThemeRiverChartOptions | undefined, fn = 'renderThemeRiverChart'): ThemeRiverSpec {
  if (!Array.isArray(data)) throw new Error(`${fn}: data must be an array of [x, value, name]`);
  const offset = OFFSETS[options?.offset ?? 'wiggle'];
  const order = ORDERS[options?.order ?? 'none'];
  if (offset === undefined) throw new Error(`${fn}: unknown offset '${options?.offset}'`);
  if (order === undefined) throw new Error(`${fn}: unknown order '${options?.order}'`);
  // Streams have no gaps (a missing x is 0); the type omits `nulls`, untyped callers get an error
  if ((options as { nulls?: unknown } | undefined)?.nulls !== undefined) throw new Error(`${fn}: 'nulls' is not supported (a missing x is 0)`);
  const names: string[] = [];
  const byName = new Map<string, Map<number, number>>();
  const xs = new Set<number>();
  let time = false;
  data.forEach((row, i) => {
    if (!Array.isArray(row) || row.length < 3) throw new Error(`${fn}: row ${i} is not [x, value, name]`);
    const { v: x, time: t } = xValue(row[0]);
    const value = row[1];
    const name = String(row[2]);
    if (!Number.isFinite(x)) throw new Error(`${fn}: row ${i} has an invalid x`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error(`${fn}: row ${i} needs a finite value >= 0`);
    }
    time ||= t;
    let m = byName.get(name);
    if (!m) {
      m = new Map();
      byName.set(name, m);
      names.push(name);
    }
    m.set(x, (m.get(x) ?? 0) + value);
    xs.add(x);
  });
  const x = [...xs].sort((a, b) => a - b);
  const colors = options?.colors;
  const colorOf = (name: string, k: number): ColorInput | undefined =>
    Array.isArray(colors) ? (colors as readonly ColorInput[])[k] : colors ? (colors as Record<string, ColorInput>)[name] : undefined;
  const curve = options?.smooth === false ? 'linear' : 'monotone';
  const series = names.map((name, k): LineSeriesDescriptor => {
    const m = byName.get(name)!;
    const values = new Float32Array(x.length);
    x.forEach((v, i) => (values[i] = m.get(v) ?? 0));
    const color = colorOf(name, k);
    return { name, values, x: Float64Array.from(x), curve, ...(color !== undefined ? { color } : {}) };
  });
  const lo = typeof options?.labels === 'object' ? options.labels : { show: options?.labels ?? true };
  return {
    series,
    x,
    time,
    meta: { offset, order, labels: { show: lo.show ?? true, minHeight: lo.minHeight ?? 12 } },
  };
}

/**
 * Line options of a ThemeRiver: no y axis, no gridlines, thin strokes unless asked for. y
 * autoscale `'visible'` becomes `'all'`: the visible extent scans the stream tops only and would
 * clip the moving baseline.
 */
export function themeRiverLineOptions(options: ThemeRiverChartOptions | undefined, spec: ThemeRiverSpec): LineChartOptions {
  const axes = options?.axes ?? {};
  const y = axes.y?.autoscale === 'visible' ? { ...axes.y, autoscale: 'all' as const } : axes.y;
  return {
    ...options,
    viewMode: '2d',
    lineWidth: options?.lineWidth ?? 1,
    showBackdropGrid: options?.showBackdropGrid ?? false,
    axes: {
      ...axes,
      x: { ...(spec.time ? { type: 'time' as const } : {}), ...(axes.x ?? {}) },
      y: { show: false, ...(y ?? {}) },
    },
  };
}

/** Stream name labels at the engine anchors (left end of each visible stream). */
export class ThemeRiverLabelLayer {
  private readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;

  constructor(
    parent: HTMLElement,
    private readonly names: readonly string[],
    private readonly options: ThemeRiverMeta['labels']
  ) {
    this.root = overlayDiv('charturbo-sdk-theme-river-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

  invalidate(): void {
    this.revision = -1;
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme): void {
    if (!this.options.show) return;
    const a = backend.chart_theme_river_labels?.();
    if (!a || a.length < 2 || a[0] === this.revision) return;
    this.revision = a[0];
    const count = Math.min(a[1], Math.floor((a.length - 2) / 4));
    // Greedy de-overlap: thickest streams first, a label is dropped when it would overlap one
    // already placed (11 px text, 14 px line box)
    const anchors = Array.from({ length: count }, (_, k) => ({
      series: a[2 + k * 4],
      x: a[3 + k * 4],
      y: a[4 + k * 4],
      h: a[5 + k * 4],
    }))
      .filter((l) => l.h >= this.options.minHeight && this.names[l.series] !== undefined)
      .sort((p, q) => q.h - p.h);
    const placed: number[] = [];
    let used = 0;
    for (const l of anchors) {
      if (placed.some((y) => Math.abs(y - l.y) < 14)) continue;
      placed.push(l.y);
      let el = this.labels[used];
      if (!el) {
        el = overlayDiv('charturbo-sdk-theme-river-label', { fontSize: '11px', lineHeight: '14px', fontWeight: '500' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      used++;
      el.textContent = this.names[l.series];
      el.dataset.series = String(l.series);
      el.style.color = theme.textPrimary;
      el.style.display = 'block';
      // Inside the stream, 4 px from its left end
      placeAt(el, l.x + 4, l.y, 1, 0);
    }
    for (let k = used; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
