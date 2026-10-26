/**
 * Shared plumbing of the business charts (radar, gauge, funnel, waterfall): the meta union the
 * SDK stores, dispatchers for tooltips / point details / a11y models / theme / DOM labels, and
 * small DOM helpers. Each chart lives in its own module (chart-radar.ts, chart-gauge.ts,
 * chart-funnel.ts, chart-waterfall.ts); the engine owns every bit of geometry, layout, hit
 * testing and label anchoring (crates/viz-core/src/chart/{radar,gauge,funnel,waterfall}.rs).
 */
import type { RgbaTuple } from './color';
import type { A11yChartModel } from './chart-a11y';
import type { ChartTooltipContext, NodeMetadata, VizTheme, WasmVizEngineBackend } from './viz-engine-sdk';
import type { A11yCommon, BusinessLabelLayer } from './chart-business-util';
import {
  radarA11yModel,
  radarPointMetadata,
  radarTooltipContext,
  radarTooltipHtml,
  RadarLabelLayer,
  sendRadarColors,
  type RadarChartMeta,
} from './chart-radar';
import {
  gaugeA11yModel,
  gaugePointMetadata,
  gaugeTooltipContext,
  gaugeTooltipHtml,
  GaugeLabelLayer,
  sendGaugeStyle,
  type GaugeChartMeta,
} from './chart-gauge';
import {
  funnelA11yModel,
  funnelPointMetadata,
  funnelTooltipContext,
  funnelTooltipHtml,
  FunnelLabelLayer,
  sendFunnelColors,
  type FunnelChartMeta,
} from './chart-funnel';
import {
  waterfallA11yModel,
  waterfallPointMetadata,
  waterfallTooltipContext,
  waterfallTooltipHtml,
  WaterfallLabelLayer,
  sendWaterfallStyle,
  type WaterfallChartMeta,
} from './chart-waterfall';

export type BusinessChartMeta = RadarChartMeta | GaugeChartMeta | FunnelChartMeta | WaterfallChartMeta;
export type BusinessChartKind = BusinessChartMeta['kind'];

const KINDS: ReadonlySet<string> = new Set<BusinessChartKind>(['radar', 'gauge', 'funnel', 'waterfall']);

export function isBusinessKind(kind: unknown): kind is BusinessChartKind {
  return typeof kind === 'string' && KINDS.has(kind);
}

export function isBusinessMeta(meta: { kind: string } | null | undefined): meta is BusinessChartMeta {
  return !!meta && KINDS.has(meta.kind);
}

/** Business charts with a fixed legend (nothing to toggle): gauge, funnel, waterfall. */
export function hasStaticSeries(meta: { kind: string }): boolean {
  return meta.kind === 'gauge' || meta.kind === 'funnel' || meta.kind === 'waterfall';
}

export function createBusinessLabelLayer(parent: HTMLElement, meta: BusinessChartMeta): BusinessLabelLayer {
  switch (meta.kind) {
    case 'radar':
      return new RadarLabelLayer(parent, meta);
    case 'gauge':
      return new GaugeLabelLayer(parent, meta);
    case 'funnel':
      return new FunnelLabelLayer(parent, meta);
    case 'waterfall':
      return new WaterfallLabelLayer(parent, meta);
  }
}

/** Re-sends the theme-derived colors of a business chart. */
export function sendBusinessTheme(backend: WasmVizEngineBackend, meta: BusinessChartMeta, theme: VizTheme): void {
  switch (meta.kind) {
    case 'radar':
      return sendRadarColors(backend, meta, theme);
    case 'gauge':
      return sendGaugeStyle(backend, meta, theme);
    case 'funnel':
      return sendFunnelColors(backend, meta, theme);
    case 'waterfall':
      return sendWaterfallStyle(backend, meta, theme);
  }
}

/**
 * Tooltip data of an engine hover result `[is_bar, primary, count, (series, index, value, id) *
 * count]` (pointer, keyboard focus).
 */
export function businessTooltipContext(
  meta: BusinessChartMeta,
  hit: ArrayLike<number>,
  details: (id: number) => ChartTooltipContext['details']
): ChartTooltipContext | null {
  if (hit.length < 7 || hit[2] < 1) return null;
  switch (meta.kind) {
    case 'radar':
      return radarTooltipContext(meta, hit, details);
    case 'gauge':
      return gaugeTooltipContext(meta, hit[6], details);
    case 'funnel':
      return funnelTooltipContext(meta, hit[4], details);
    case 'waterfall':
      return waterfallTooltipContext(meta, hit[4], details);
  }
}

/** Default tooltip HTML (null = not a business tooltip). `formatValue` = tooltip value format. */
export function businessTooltipHtml(
  ctx: ChartTooltipContext,
  meta: BusinessChartMeta,
  theme: VizTheme,
  formatValue: (v: number) => string,
  locale?: string
): string | null {
  if (ctx.chartType !== meta.kind) return null;
  switch (meta.kind) {
    case 'radar':
      return radarTooltipHtml(ctx, theme, formatValue);
    case 'gauge':
      return gaugeTooltipHtml(ctx, meta, theme, formatValue);
    case 'funnel':
      return funnelTooltipHtml(ctx, theme, formatValue, locale);
    case 'waterfall':
      return waterfallTooltipHtml(ctx, theme, formatValue);
  }
}

/** Point details (`getNodeDetails`) of a business chart point. */
export function businessPointMetadata(meta: BusinessChartMeta, id: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  switch (meta.kind) {
    case 'radar':
      return radarPointMetadata(meta, id);
    case 'gauge':
      return gaugePointMetadata(meta, id);
    case 'funnel':
      return funnelPointMetadata(meta, id);
    case 'waterfall':
      return waterfallPointMetadata(meta, id);
  }
}

/**
 * A11y model of a business chart meta (typed loosely like every `buildA11yModel` input), or
 * null when the meta is not one.
 */
export function businessA11yModel(m: Record<string, unknown>, common: A11yCommon): A11yChartModel | null {
  const fmt = typeof m.format === 'function' ? (m.format as (v: number) => string) : null;
  const c: A11yCommon = { ...common, formatValue: (v) => (Number.isFinite(v) ? (fmt ? fmt(v) : common.formatValue(v)) : 'no data') };
  switch (m.kind) {
    case 'radar':
      return radarA11yModel(m as unknown as RadarChartMeta, c);
    case 'gauge':
      return gaugeA11yModel(m as unknown as GaugeChartMeta, c);
    case 'funnel':
      return funnelA11yModel(m as unknown as FunnelChartMeta, c);
    case 'waterfall':
      return waterfallA11yModel(m as unknown as WaterfallChartMeta, c);
    default:
      return null;
  }
}
