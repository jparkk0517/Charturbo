/**
 * Framework-agnostic lifecycle of one chart component (React `VizChart` / Vue `VizChart`):
 * async `VizEngineSDK.create` with dispose-before-ready safety, desired-state props (chart
 * type / data / options, theme, sync group, interactions) applied once the engine is ready, and
 * SDK events forwarded to the latest callbacks. No DOM / window access at import (SSR-safe).
 */
import {
  VizEngineSDK,
  type AreaChartOptions,
  type BarChartItemDescriptor,
  type BarChartOptions,
  type CandlestickChartData,
  type CandlestickChartOptions,
  type GroupedBarChartData,
  type GroupedBarChartOptions,
  type HistogramChartOptions,
  type LineChartOptions,
  type LineSeriesDescriptor,
  type NodeInteractionOptions,
  type ScatterChartData,
  type ScatterChartOptions,
  type VizTheme,
  type VizThemeInput,
} from './viz-engine-sdk';
import type { HeatmapChartData, HeatmapChartOptions } from './chart-heatmap';
import type { BoxPlotData, BoxPlotOptions } from './chart-boxplot';
import type { PieChartData, PieChartOptions } from './chart-pie';
import type { ComboChartData, ComboChartOptions } from './chart-combo';
import type { RadarChartData, RadarChartOptions } from './chart-radar';
import type { GaugeChartData, GaugeChartOptions } from './chart-gauge';
import type { FunnelChartData, FunnelChartOptions } from './chart-funnel';
import type { WaterfallChartData, WaterfallChartOptions } from './chart-waterfall';
import type { HierarchyData, SankeyChartData, SankeyChartOptions, SunburstChartOptions, TreemapChartOptions } from './chart-hierarchy';
import type { SparklineData, SparklineOptions } from './chart-sparkline';
import type { ChartSyncMemberOptions } from './chart-sync';
import type { VizEventMap } from './chart-events';

/** Data / options of each chart `type` (bar: an item array, or grouped / stacked series). */
export interface VizChartSpecMap {
  line: { data: LineSeriesDescriptor[]; options: LineChartOptions };
  area: { data: LineSeriesDescriptor[]; options: AreaChartOptions };
  bar: {
    data: BarChartItemDescriptor[] | GroupedBarChartData;
    options: BarChartOptions | GroupedBarChartOptions;
  };
  scatter: { data: ScatterChartData; options: ScatterChartOptions };
  candlestick: { data: CandlestickChartData; options: CandlestickChartOptions };
  histogram: { data: Float32Array | number[]; options: HistogramChartOptions };
  heatmap: { data: HeatmapChartData; options: HeatmapChartOptions };
  box: { data: BoxPlotData; options: BoxPlotOptions };
  pie: { data: PieChartData; options: PieChartOptions };
  /** Bars + lines + areas on one plot (`series[].type`), optional right y axis */
  combo: { data: ComboChartData; options: ComboChartOptions };
  radar: { data: RadarChartData; options: RadarChartOptions };
  /** Changing only `data.value` re-renders; for live values call `sdk.setGaugeValue` (indicator only) */
  gauge: { data: GaugeChartData; options: GaugeChartOptions };
  funnel: { data: FunnelChartData; options: FunnelChartOptions };
  waterfall: { data: WaterfallChartData; options: WaterfallChartOptions };
  treemap: { data: HierarchyData; options: TreemapChartOptions };
  sunburst: { data: HierarchyData; options: SunburstChartOptions };
  sankey: { data: SankeyChartData; options: SankeyChartOptions };
  /** Many sparklines on a page: pass `createOptions={{ device }}` (shared GPU device) and `interactions={false}` */
  sparkline: { data: SparklineData | Float32Array | number[]; options: SparklineOptions };
}

export type VizChartType = keyof VizChartSpecMap;
export type VizChartData<T extends VizChartType = VizChartType> = VizChartSpecMap[T]['data'];
export type VizChartOptions<T extends VizChartType = VizChartType> = VizChartSpecMap[T]['options'];
export type VizChartTheme = 'dark' | 'light' | VizTheme | VizThemeInput;
/** Sync group key, or full member options (`setSync`); `null` / `undefined` = not synced */
export type VizChartSync = string | ChartSyncMemberOptions | null | undefined;
/**
 * `enableNodeInteractions` options (tooltip, zoom / pan, touch, brush); `false` = none.
 * `autoRender` defaults to true here (components have no render loop).
 */
export type VizChartInteractions = NodeInteractionOptions | false;
export type VizCreateOptions = NonNullable<Parameters<typeof VizEngineSDK.create>[1]>;

/** Component callbacks: SDK events plus the lifecycle (`ready` / `error`). */
export interface VizChartCallbacks {
  onReady?: (sdk: VizEngineSDK) => void;
  /** `create` failed (`VizInitError` when the device lacks WebGPU / WebGL2) or a render threw */
  onError?: (error: unknown) => void;
  onHover?: (e: VizEventMap['hover']) => void;
  onClick?: (e: VizEventMap['click']) => void;
  onSelect?: (e: VizEventMap['select']) => void;
  onRangeChange?: (e: VizEventMap['rangechange']) => void;
  onLegendToggle?: (e: VizEventMap['legendtoggle']) => void;
  onThemeChange?: (e: VizEventMap['themechange']) => void;
  onResize?: (e: VizEventMap['resize']) => void;
  /** Treemap / sunburst drill-down / up */
  onDrill?: (e: VizEventMap['drill']) => void;
}

/** SDK event -> callback name (subscribed once; the binding reads the latest callbacks). */
export const VIZ_CHART_EVENTS = {
  hover: 'onHover',
  click: 'onClick',
  select: 'onSelect',
  rangechange: 'onRangeChange',
  legendtoggle: 'onLegendToggle',
  themechange: 'onThemeChange',
  resize: 'onResize',
  drill: 'onDrill',
} as const satisfies { [K in keyof VizEventMap]: keyof VizChartCallbacks };

interface ChartSpec {
  type: VizChartType;
  data: VizChartData;
  options: VizChartOptions | undefined;
}

/** Renders `spec` with the matching `render*Chart` call. */
export function renderChartSpec(sdk: VizEngineSDK, spec: ChartSpec): void {
  const { data, options } = spec;
  switch (spec.type) {
    case 'line':
      sdk.renderLineChart(data as LineSeriesDescriptor[], options as LineChartOptions);
      break;
    case 'area':
      sdk.renderAreaChart(data as LineSeriesDescriptor[], options as AreaChartOptions);
      break;
    case 'bar':
      if (Array.isArray(data)) sdk.renderBarChart(data as BarChartItemDescriptor[], options as BarChartOptions);
      else sdk.renderGroupedBarChart(data as GroupedBarChartData, options as GroupedBarChartOptions);
      break;
    case 'scatter':
      sdk.renderScatterChart(data as ScatterChartData, options as ScatterChartOptions);
      break;
    case 'candlestick':
      sdk.renderCandlestickChart(data as CandlestickChartData, options as CandlestickChartOptions);
      break;
    case 'histogram':
      sdk.renderHistogram(data as Float32Array | number[], options as HistogramChartOptions);
      break;
    case 'heatmap':
      sdk.renderHeatmap(data as HeatmapChartData, options as HeatmapChartOptions);
      break;
    case 'box':
      sdk.renderBoxPlot(data as BoxPlotData, options as BoxPlotOptions);
      break;
    case 'pie':
      sdk.renderPieChart(data as PieChartData, options as PieChartOptions);
      break;
    case 'combo':
      sdk.renderComboChart(data as ComboChartData, options as ComboChartOptions);
      break;
    case 'radar':
      sdk.renderRadarChart(data as RadarChartData, options as RadarChartOptions);
      break;
    case 'gauge':
      sdk.renderGauge(data as GaugeChartData, options as GaugeChartOptions);
      break;
    case 'funnel':
      sdk.renderFunnelChart(data as FunnelChartData, options as FunnelChartOptions);
      break;
    case 'waterfall':
      sdk.renderWaterfallChart(data as WaterfallChartData, options as WaterfallChartOptions);
      break;
    case 'treemap':
      sdk.renderTreemap(data as HierarchyData, options as TreemapChartOptions);
      break;
    case 'sunburst':
      sdk.renderSunburst(data as HierarchyData, options as SunburstChartOptions);
      break;
    case 'sankey':
      sdk.renderSankey(data as SankeyChartData, options as SankeyChartOptions);
      break;
    case 'sparkline':
      sdk.renderSparkline(data as SparklineData | Float32Array | number[], options as SparklineOptions);
      break;
  }
}

/** `interactions` unset: tooltip + navigation with the SDK defaults */
const DEFAULT_INTERACTIONS: NodeInteractionOptions = {};

function syncOptions(sync: VizChartSync): ChartSyncMemberOptions | null {
  if (sync == null || sync === '') return null;
  return typeof sync === 'string' ? { key: sync } : sync;
}

/**
 * One engine on one canvas. Setters record the desired state; before the engine is ready they
 * only store it, afterwards they apply it (each setter touches only its own concern: a theme
 * change never re-renders the data). `dispose()` is safe at any time, including while `create`
 * is pending: the late engine is disposed on arrival and no callback fires.
 */
export class VizChartBinding {
  private engine: VizEngineSDK | null = null;
  private disposed = false;
  private spec: ChartSpec | null = null;
  private theme: VizChartTheme | undefined;
  private sync: ChartSyncMemberOptions | null = null;
  private interactions: VizChartInteractions = DEFAULT_INTERACTIONS;
  private detachInteractions: (() => void) | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  /** Resolves with the engine, or `null` when disposed first / `create` failed */
  readonly ready: Promise<VizEngineSDK | null>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Read on every event: callers may swap callbacks without resubscribing */
    private readonly callbacks: () => VizChartCallbacks,
    createOptions?: VizCreateOptions
  ) {
    // Deferred one microtask: React StrictMode's synchronous mount -> unmount -> mount disposes
    // the first binding before it starts, so only one engine is ever created
    this.ready = Promise.resolve().then(() => this.start(createOptions));
  }

  /** The engine once ready (`null` before / after) */
  get sdk(): VizEngineSDK | null {
    return this.engine;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private async start(createOptions?: VizCreateOptions): Promise<VizEngineSDK | null> {
    if (this.disposed) return null;
    let sdk: VizEngineSDK;
    try {
      sdk = await VizEngineSDK.create(this.canvas, createOptions);
    } catch (err) {
      if (!this.disposed) this.notify(() => this.callbacks().onError?.(err));
      return null;
    }
    if (this.disposed) {
      // Unmounted while the engine was loading
      sdk.dispose();
      return null;
    }
    this.engine = sdk;
    for (const event of Object.keys(VIZ_CHART_EVENTS) as (keyof VizEventMap)[]) {
      const name = VIZ_CHART_EVENTS[event];
      this.unsubscribers.push(
        sdk.on(event, (payload) => (this.callbacks()[name] as ((p: typeof payload) => void) | undefined)?.(payload))
      );
    }
    this.guard(() => {
      if (this.theme !== undefined) sdk.setTheme(this.theme);
      if (this.sync) sdk.setSync(this.sync);
      if (this.spec) renderChartSpec(sdk, this.spec);
    });
    // Bound even when the first render threw (bad data): a later valid `setChart` keeps them
    this.guard(() => this.applyInteractions());
    this.guard(() => sdk.render());
    this.notify(() => this.callbacks().onReady?.(sdk));
    return sdk;
  }

  /** Runs an SDK call; a throw (bad data, missing engine feature) goes to `onError`. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.notify(() => this.callbacks().onError?.(err));
    }
  }

  /**
   * Calls a user callback; a throw is rethrown asynchronously (reported like an uncaught error)
   * so it never rejects `ready` or interrupts the binding.
   */
  private notify(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      setTimeout(() => {
        throw err;
      });
    }
  }

  setChart<T extends VizChartType>(type: T, data: VizChartData<T>, options?: VizChartOptions<T>): void {
    const wasSparkline = this.spec?.type === 'sparkline';
    this.spec = { type, data, options };
    const sdk = this.engine;
    if (!sdk) return;
    this.guard(() => {
      renderChartSpec(sdk, this.spec!);
      sdk.render();
    });
    // Default interactions depend on the type (off for sparklines)
    if (wasSparkline !== (type === 'sparkline') && this.interactions === DEFAULT_INTERACTIONS) {
      this.guard(() => this.applyInteractions());
    }
  }

  setTheme(theme: VizChartTheme | undefined): void {
    if (theme === this.theme) return;
    this.theme = theme;
    const sdk = this.engine;
    // `undefined` keeps the current theme (the SDK has no "unset")
    if (!sdk || theme === undefined) return;
    this.guard(() => {
      sdk.setTheme(theme);
      sdk.render();
    });
  }

  setSync(sync: VizChartSync): void {
    const next = syncOptions(sync);
    if (sameSync(next, this.sync)) return;
    this.sync = next;
    this.engine?.setSync(next);
  }

  setInteractions(interactions: VizChartInteractions | undefined): void {
    const next = interactions ?? DEFAULT_INTERACTIONS;
    if (next === this.interactions) return;
    this.interactions = next;
    if (this.engine) this.guard(() => this.applyInteractions());
  }

  private applyInteractions(): void {
    this.detachInteractions?.();
    this.detachInteractions = null;
    // Sparklines bind their own opt-in tooltip (`options.tooltip`): no default interactions
    const opts = this.interactions === DEFAULT_INTERACTIONS && this.spec?.type === 'sparkline' ? false : this.interactions;
    if (!this.engine || opts === false) return;
    this.detachInteractions = this.engine.enableNodeInteractions(this.canvas, { autoRender: true, ...opts });
  }

  /** Detaches interactions and frees the engine (once). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unsubscribers.splice(0)) off();
    this.detachInteractions?.();
    this.detachInteractions = null;
    this.engine?.dispose();
    this.engine = null;
  }
}

function sameSync(a: ChartSyncMemberOptions | null, b: ChartSyncMemberOptions | null): boolean {
  if (!a || !b) return a === b;
  return a.key === b.key && a.cursor === b.cursor && a.x === b.x && a.tooltip === b.tooltip;
}
