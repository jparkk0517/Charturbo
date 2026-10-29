/**
 * Framework-agnostic lifecycle of one chart component (React `CharturboChart` / Vue `CharturboChart`):
 * async `Charturbo.create` with dispose-before-ready safety, desired-state props (chart
 * type / data / options, theme, sync group, interactions) applied once the engine is ready, and
 * SDK events forwarded to the latest callbacks. No DOM / window access at import (SSR-safe).
 */
import {
  Charturbo,
  type AreaChartOptions,
  type BandSeriesDescriptor,
  type BandChartOptions,
  type BarChartItemDescriptor,
  type BarChartOptions,
  type CandlestickChartData,
  type CandlestickChartOptions,
  type OhlcChartData,
  type OhlcChartOptions,
  type GroupedBarChartData,
  type GroupedBarChartOptions,
  type HistogramChartOptions,
  type LineChartOptions,
  type LineSeriesDescriptor,
  type NodeInteractionOptions,
  type ScatterChartData,
  type ScatterChartOptions,
  type CharturboTheme,
  type CharturboThemeInput,
} from './charturbo';
import type { HeatmapChartData, HeatmapChartOptions } from './chart-heatmap';
import type { BoxPlotData, BoxPlotOptions } from './chart-boxplot';
import type { PieChartData, PieChartOptions, PieRingsData } from './chart-pie';
import type { ComboChartData, ComboChartOptions } from './chart-combo';
import type { RadarChartData, RadarChartOptions } from './chart-radar';
import type { GaugeChartData, GaugeChartOptions } from './chart-gauge';
import type { FunnelChartData, FunnelChartOptions } from './chart-funnel';
import type { ThemeRiverChartOptions, ThemeRiverDatum } from './chart-theme-river';
import type { WaterfallChartData, WaterfallChartOptions } from './chart-waterfall';
import type { CalendarHeatmapData, CalendarHeatmapOptions } from './chart-calendar';
import type { HierarchyData, SankeyChartData, SankeyChartOptions, SunburstChartOptions, TreemapChartOptions } from './chart-hierarchy';
import type { SparklineData, SparklineOptions } from './chart-sparkline';
import type { ChartSyncMemberOptions } from './chart-sync';
import type { CharturboEventMap } from './chart-events';
import type { ErrorBarSeriesDescriptor, ErrorBarChartOptions, ImpulseSeriesDescriptor, ImpulseChartOptions } from './chart-sparse';
import type { PointCloud3DSeries, Surface3DSeries, Scientific3DChartOptions } from './chart-scientific3d';

/** Data / options of each chart `type` (bar: an item array, or grouped / stacked series). */
export interface CharturboChartSpecMap {
  pointCloud3d: { data: PointCloud3DSeries[]; options: Scientific3DChartOptions };
  surface3d: { data: Surface3DSeries[]; options: Scientific3DChartOptions };
  line: { data: LineSeriesDescriptor[]; options: LineChartOptions };
  area: { data: LineSeriesDescriptor[]; options: AreaChartOptions };
  /** Streamgraph from `[x, value, name]` rows */
  themeRiver: { data: readonly ThemeRiverDatum[]; options: ThemeRiverChartOptions };
  band: { data: BandSeriesDescriptor[]; options: BandChartOptions };
  errorBar: { data: ErrorBarSeriesDescriptor[]; options: ErrorBarChartOptions };
  impulse: { data: ImpulseSeriesDescriptor[]; options: ImpulseChartOptions };
  bar: {
    data: BarChartItemDescriptor[] | GroupedBarChartData;
    options: BarChartOptions | GroupedBarChartOptions;
  };
  scatter: { data: ScatterChartData; options: ScatterChartOptions };
  candlestick: { data: CandlestickChartData; options: CandlestickChartOptions };
  ohlc: { data: OhlcChartData; options: OhlcChartOptions };
  histogram: { data: Float32Array | number[]; options: HistogramChartOptions };
  heatmap: { data: HeatmapChartData; options: HeatmapChartOptions };
  box: { data: BoxPlotData; options: BoxPlotOptions };
  pie: { data: PieChartData | PieRingsData; options: PieChartOptions };
  /** Bars + lines + areas on one plot (`series[].type`), optional right y axis */
  combo: { data: ComboChartData; options: ComboChartOptions };
  radar: { data: RadarChartData; options: RadarChartOptions };
  /** Changing only `data.value` re-renders; for live values call `sdk.setGaugeValue` (indicator only) */
  gauge: { data: GaugeChartData; options: GaugeChartOptions };
  funnel: { data: FunnelChartData; options: FunnelChartOptions };
  calendar: { data: CalendarHeatmapData; options: CalendarHeatmapOptions };
  waterfall: { data: WaterfallChartData; options: WaterfallChartOptions };
  treemap: { data: HierarchyData; options: TreemapChartOptions };
  sunburst: { data: HierarchyData; options: SunburstChartOptions };
  sankey: { data: SankeyChartData; options: SankeyChartOptions };
  /** Many sparklines on a page: pass `createOptions={{ device }}` (shared GPU device) and `interactions={false}` */
  sparkline: { data: SparklineData | Float32Array | number[]; options: SparklineOptions };
}

export type CharturboChartType = keyof CharturboChartSpecMap;
export type CharturboChartData<T extends CharturboChartType = CharturboChartType> = CharturboChartSpecMap[T]['data'];
export type CharturboChartOptions<T extends CharturboChartType = CharturboChartType> = CharturboChartSpecMap[T]['options'];
export type CharturboChartTheme = 'dark' | 'light' | CharturboTheme | CharturboThemeInput;
/** Sync group key, or full member options (`setSync`); `null` / `undefined` = not synced */
export type CharturboChartSync = string | ChartSyncMemberOptions | null | undefined;
/**
 * `enableNodeInteractions` options (tooltip, zoom / pan, touch, brush); `false` = none.
 * `autoRender` defaults to true here (components have no render loop).
 */
export type CharturboChartInteractions = NodeInteractionOptions | false;
export type CharturboCreateOptions = NonNullable<Parameters<typeof Charturbo.create>[1]>;

/** Component callbacks: SDK events plus the lifecycle (`ready` / `error`). */
export interface CharturboChartCallbacks {
  onReady?: (sdk: Charturbo) => void;
  /** `create` failed (`CharturboInitError` when the device lacks WebGPU / WebGL2) or a render threw */
  onError?: (error: unknown) => void;
  onHover?: (e: CharturboEventMap['hover']) => void;
  onClick?: (e: CharturboEventMap['click']) => void;
  onSelect?: (e: CharturboEventMap['select']) => void;
  onRangeChange?: (e: CharturboEventMap['rangechange']) => void;
  onLegendToggle?: (e: CharturboEventMap['legendtoggle']) => void;
  onThemeChange?: (e: CharturboEventMap['themechange']) => void;
  onResize?: (e: CharturboEventMap['resize']) => void;
  /** Treemap / sunburst drill-down / up */
  onDrill?: (e: CharturboEventMap['drill']) => void;
}

/** SDK event -> callback name (subscribed once; the binding reads the latest callbacks). */
export const CHARTURBO_CHART_EVENTS = {
  hover: 'onHover',
  click: 'onClick',
  select: 'onSelect',
  rangechange: 'onRangeChange',
  legendtoggle: 'onLegendToggle',
  themechange: 'onThemeChange',
  resize: 'onResize',
  drill: 'onDrill',
} as const satisfies { [K in keyof CharturboEventMap]: keyof CharturboChartCallbacks };

interface ChartSpec {
  type: CharturboChartType;
  data: CharturboChartData;
  options: CharturboChartOptions | undefined;
}

/** Renders `spec` with the matching `render*Chart` call. */
export function renderChartSpec(sdk: Charturbo, spec: ChartSpec): void {
  const { data, options } = spec;
  switch (spec.type) {
    case 'line':
      sdk.renderLineChart(data as LineSeriesDescriptor[], options as LineChartOptions);
      break;
    case 'area':
      sdk.renderAreaChart(data as LineSeriesDescriptor[], options as AreaChartOptions);
      break;
    case 'themeRiver':
      sdk.renderThemeRiverChart(data as readonly ThemeRiverDatum[], options as ThemeRiverChartOptions);
      break;
    case 'band':
      sdk.renderBandChart(data as BandSeriesDescriptor[], options as BandChartOptions);
      break;
    case 'errorBar':
      sdk.renderErrorBarChart(data as ErrorBarSeriesDescriptor[], options as ErrorBarChartOptions);
      break;
    case 'impulse':
      sdk.renderImpulseChart(data as ImpulseSeriesDescriptor[], options as ImpulseChartOptions);
      break;
    case 'pointCloud3d':
      sdk.renderPointCloud3D(data as PointCloud3DSeries[], options as Scientific3DChartOptions);
      break;
    case 'surface3d':
      sdk.renderSurface3D(data as Surface3DSeries[], options as Scientific3DChartOptions);
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
    case 'ohlc':
      sdk.renderOhlcChart(data as OhlcChartData, options as OhlcChartOptions);
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
      sdk.renderPieChart(data as PieChartData | PieRingsData, options as PieChartOptions);
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
    case 'calendar':
      sdk.renderCalendarHeatmap(data as CalendarHeatmapData, options as CalendarHeatmapOptions);
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

function syncOptions(sync: CharturboChartSync): ChartSyncMemberOptions | null {
  if (sync == null || sync === '') return null;
  return typeof sync === 'string' ? { key: sync } : sync;
}

/**
 * One engine on one canvas. Setters record the desired state; before the engine is ready they
 * only store it, afterwards they apply it (each setter touches only its own concern: a theme
 * change never re-renders the data). `dispose()` is safe at any time, including while `create`
 * is pending: the late engine is disposed on arrival and no callback fires.
 */
export class CharturboChartBinding {
  private engine: Charturbo | null = null;
  private disposed = false;
  private spec: ChartSpec | null = null;
  private theme: CharturboChartTheme | undefined;
  private sync: ChartSyncMemberOptions | null = null;
  private interactions: CharturboChartInteractions = DEFAULT_INTERACTIONS;
  private detachInteractions: (() => void) | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  /** Resolves with the engine, or `null` when disposed first / `create` failed */
  readonly ready: Promise<Charturbo | null>;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Read on every event: callers may swap callbacks without resubscribing */
    private readonly callbacks: () => CharturboChartCallbacks,
    createOptions?: CharturboCreateOptions
  ) {
    // Deferred one microtask: React StrictMode's synchronous mount -> unmount -> mount disposes
    // the first binding before it starts, so only one engine is ever created
    this.ready = Promise.resolve().then(() => this.start(createOptions));
  }

  /** The engine once ready (`null` before / after) */
  get sdk(): Charturbo | null {
    return this.engine;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  private async start(createOptions?: CharturboCreateOptions): Promise<Charturbo | null> {
    if (this.disposed) return null;
    let sdk: Charturbo;
    try {
      sdk = await Charturbo.create(this.canvas, createOptions);
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
    for (const event of Object.keys(CHARTURBO_CHART_EVENTS) as (keyof CharturboEventMap)[]) {
      const name = CHARTURBO_CHART_EVENTS[event];
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

  setChart<T extends CharturboChartType>(type: T, data: CharturboChartData<T>, options?: CharturboChartOptions<T>): void {
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

  setTheme(theme: CharturboChartTheme | undefined): void {
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

  setSync(sync: CharturboChartSync): void {
    const next = syncOptions(sync);
    if (sameSync(next, this.sync)) return;
    this.sync = next;
    this.engine?.setSync(next);
  }

  setInteractions(interactions: CharturboChartInteractions | undefined): void {
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
