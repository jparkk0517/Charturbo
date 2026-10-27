import initWasm, { WasmCharturboEngine } from '../wasm-pkg/charturbo_core';
import { createTouchGestures, isGesturePointer, type TouchInteractionOptions } from './chart-gestures';
import { createCameraControls, resolveCameraControls, type CameraControlOptions } from './camera-controls';
export type { CameraControlOptions } from './camera-controls';

export type { TouchInteractionOptions } from './chart-gestures';
import { ChartA11y, type ChartDataTable, type DataTableOptions } from './chart-a11y';
import { parseColor, parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import { CharturboEventEmitter, frameThrottle, sameRange, type CharturboEventMap, type CharturboRange } from './chart-events';
import { createNavigatorController, resolveNavigator, type NavigatorOption } from './chart-navigator';
import { packAreaAppend, type SeriesDataChunk } from './chart-stream';
export type { SeriesDataChunk } from './chart-stream';
import { CharturboInitError, classifyInitError, hasWebGl2, isRenderingSupported, observeCanvasPixelSize } from './charturbo-init';

export { parseColor, type ColorInput, type RgbaTuple } from './color';
export type { CharturboEventMap, CharturboEventName, CharturboHoverEvent, CharturboClickEvent, CharturboRange } from './chart-events';
export { CharturboInitError, type CharturboInitErrorReason } from './charturbo-init';
import { CharturboDevice, type CharturboDeviceOptions } from './charturbo-device';
import {
  applySparklineMarks,
  readSparklineSummary,
  resolveSparkline,
  sparklineBarItems,
  sparklineData,
  sparklineLabel,
  sparklineNeedsRefit,
  type SparklineData,
  type SparklineOptions,
  type SparklineResult,
  type SparklineSpec,
} from './chart-sparkline';
export type { SparklineData, SparklineOptions, SparklineResult, SparklineSummary, SparklineType } from './chart-sparkline';
export { CharturboDevice, type CharturboDeviceBackend, type CharturboDeviceOptions, type WasmGpuDeviceBackend } from './charturbo-device';
import {
  captureChartCanvas,
  chartToBlob,
  chartToDataURL,
  downloadChartImage,
  type ChartExportHost,
  type ChartImageOptions,
} from './chart-export';
import { AnnotationLabelLayer, encodeAnnotations, type ChartAnnotation } from './chart-annotations';
import {
  AnimationDriver,
  applyAnimation,
  prefersReducedMotion,
  resolveAnimation,
  sameAnimation,
  type AnimationBackend,
  type ChartAnimationInput,
  type ResolvedAnimation,
} from './chart-animation';
export type { AnimationBackend, ChartAnimationInput, ChartAnimationOptions, ChartEasing, ResolvedAnimation } from './chart-animation';
import {
  createZoomController,
  readHistory,
  validateZoomAxis,
  validateZoomMode,
  type ChartZoomAxis,
  type ChartZoomMode,
  type ZoomBackend,
  type ZoomHistoryState,
} from './chart-zoom';
export type { ChartZoomAxis, ChartZoomMode, ZoomBackend, ZoomHistoryState } from './chart-zoom';
import { chartToSvg, downloadChartSvg, saveBlob, type ChartSvgOptions } from './chart-svg';
export type { ChartSvgOptions } from './chart-svg';
import { readRenderStats, type RenderStatsBackend, type CharturboRenderStats } from './chart-stats';
export type { RenderStatsBackend, CharturboRenderStats } from './chart-stats';
import { canCopyImage, canvasToPdf, copyPngToClipboard } from './chart-pdf';
import { thinCenteredLabels } from './chart-labels';
import {
  buildTimeZoneTable,
  intlTimeZone,
  isLocalMidnight,
  timeZoneKey,
  validateTimeZone,
  type CharturboTimeZone,
} from './chart-timezone';
export type { CharturboTimeZone } from './chart-timezone';
import { encodeBands, type BandSeriesDescriptor, type BandChartOptions, type EncodedBand } from './chart-band';
export type { BandSeriesDescriptor, BandChartOptions } from './chart-band';
import { encodeErrors as encodeErrorBars, encodeImpulses, sparseTooltip, type ErrorBarSeriesDescriptor, type ErrorBarChartOptions, type ImpulseSeriesDescriptor, type ImpulseChartOptions, type EncodedSparse, type SparseMeta } from './chart-sparse';
export type { ErrorBarSeriesDescriptor, ErrorBarChartOptions, ErrorBarMode, ErrorBarDirection, ImpulseSeriesDescriptor, ImpulseChartOptions } from './chart-sparse';
import {
  applyLineStyles,
  lineBandAt,
  numericSamples,
  streamedBand,
  validateLineBands,
  type LineBandMeta,
  type LineNullPolicy,
  type LineStyleInput,
} from './chart-linestyle';
export type {
  LineBandOptions,
  LineCurve,
  LineMarkerOptions,
  LineMarkerShape,
  LineNullPolicy,
  LineStyleInput,
} from './chart-linestyle';
import {
  connectCharts,
  joinSyncGroup,
  leaveSyncGroup,
  syncMembership,
  type ChartSyncMemberOptions,
  type ChartSyncOptions,
} from './chart-sync';

export type { ChartSyncMemberOptions, ChartSyncOptions } from './chart-sync';
import {
  brushModeCode,
  decodeSelection,
  emptySelection,
  encodeBrushStyle,
  type BrushMode,
  type BrushStyleOptions,
  type CharturboSelection,
} from './chart-brush';
export type { BrushMode, BrushStyleOptions, CharturboSelection, CharturboSelectionRange } from './chart-brush';
import {
  AXIS_CODES,
  decodeScale,
  encodeScale,
  encodeSeriesAxes,
  hasScaleOptions,
  type ChartAxisName,
  type ChartScaleOptions,
} from './chart-scales';
export type { ChartAxisName, ChartScaleOptions, ChartScaleType } from './chart-scales';
import {
  COLORBAR_RESERVE_PX,
  HeatmapColorbarLayer,
  bytesToCss,
  bytesToRgba,
  heatmapAxisLabel,
  heatmapMeta,
  heatmapRowLabel,
  heatmapTooltipHtml,
  sendHeatmap,
  sendHeatmapColormap,
  type HeatmapChartData,
  type HeatmapChartMeta,
  type HeatmapChartOptions,
  type HeatmapColorScale,
} from './chart-heatmap';

export type { HeatmapChartData, HeatmapChartOptions, HeatmapColorScale, HeatmapColorbarOptions } from './chart-heatmap';
import {
  boxTooltipHtml,
  boxTooltipOf,
  encodeBoxLayout,
  encodeBoxOptions,
  encodeBoxPlot,
  type BoxChartMeta,
  type BoxPlotData,
  type BoxPlotOptions,
  type ChartBoxTooltip,
} from './chart-boxplot';
export type {
  BoxPlotData,
  BoxPlotOptions,
  BoxPlotSeries,
  BoxPlotViolinOptions,
  ChartBoxStats,
  ChartBoxTooltip,
} from './chart-boxplot';
import {
  PieLabelLayer,
  pieMeta,
  pieTooltipContext,
  pieTooltipHtml,
  sendPie,
  sendPieStyle,
  syncPieSlices,
  type PieChartData,
  type PieChartMeta,
  type PieChartOptions,
} from './chart-pie';
export type { PieChartData, PieChartOptions, PieLabelMode } from './chart-pie';
import {
  comboMeta,
  comboPointMetadata,
  comboSwatch,
  comboTickLabel,
  comboTooltipContext,
  encodeCombo,
  type ComboChartData,
  type ComboChartMeta,
  type ComboChartOptions,
} from './chart-combo';
export type {
  ComboChartData,
  ComboChartOptions,
  ComboSeriesDescriptor,
  ComboSeriesType,
  ComboXAxisOptions,
  ComboYAxisOptions,
} from './chart-combo';
import {
  businessPointMetadata,
  businessTooltipContext,
  businessTooltipHtml,
  createBusinessLabelLayer,
  hasStaticSeries,
  isBusinessKind,
  isBusinessMeta,
  sendBusinessTheme,
  type BusinessChartMeta,
} from './chart-business';
import { esc, type BusinessLabelLayer } from './chart-business-util';
import { graphTooltipHtml } from './graph-tooltip';
export { esc as escapeHtml } from './chart-business-util';
import { radarMeta, sendRadar, type ChartRadarTooltip, type RadarChartData, type RadarChartOptions } from './chart-radar';
import { gaugeMeta, sendGauge, type ChartGaugeTooltip, type GaugeChartData, type GaugeChartOptions } from './chart-gauge';
import { funnelLabelSpace, funnelMeta, sendFunnel, type ChartFunnelTooltip, type FunnelChartData, type FunnelChartOptions } from './chart-funnel';
import {
  sendWaterfall,
  sendWaterfallLabels,
  waterfallMeta,
  type ChartWaterfallTooltip,
  type WaterfallChartData,
  type WaterfallChartOptions,
} from './chart-waterfall';
export type { ChartRadarTooltip, RadarChartData, RadarChartOptions, RadarSeries } from './chart-radar';
export type { ChartGaugeTooltip, GaugeBandOptions, GaugeChartData, GaugeChartOptions, GaugeStatus } from './chart-gauge';
export type { ChartFunnelTooltip, FunnelChartData, FunnelChartOptions, FunnelConversion } from './chart-funnel';
export type { ChartWaterfallTooltip, WaterfallChartData, WaterfallChartOptions, WaterfallItemKind } from './chart-waterfall';
import {
  HierarchyLabelLayer,
  drillEvent,
  hierarchyDetails,
  hierarchyParent,
  hierarchyTooltipContext,
  hierarchyTooltipHtml,
  resolveHierarchyNode,
  sankeyTooltipContext,
  sendHierarchy,
  sendHierarchyStyle,
  sendSankey,
  syncHierarchy,
  syncSankey,
  type ChartFlowTooltip,
  type ChartHierarchyTooltip,
  type HierarchyChartMeta,
  type HierarchyData,
  type SankeyChartData,
  type SankeyChartMeta,
  type SankeyChartOptions,
  type SunburstChartOptions,
  type TreemapChartOptions,
} from './chart-hierarchy';
export type {
  ChartFlowTooltip,
  ChartHierarchyTooltip,
  HierarchyChartOptions,
  HierarchyData,
  HierarchyFlatNode,
  HierarchyNode,
  SankeyChartData,
  SankeyChartOptions,
  SankeyLinkInput,
  SankeyNodeInput,
  SunburstChartOptions,
  TreemapChartOptions,
  CharturboDrillEvent,
} from './chart-hierarchy';
import { resolveFormat, resolveFormatLive, type ChartFormatSpec, type ChartValueFormat } from './chart-format';
export { createFormatter, formatNumber, type ChartFormatOptions, type ChartFormatSpec, type ChartValueFormat } from './chart-format';
import { presentTooltipContext, tooltipValueFormatter, type ChartTooltipOptions } from './chart-tooltip';
export type { ChartTooltipOptions } from './chart-tooltip';
import {
  BarLabelLayer,
  barErrorOf,
  barLabelTexts,
  encodeErrors,
  formatBarError,
  measureLabel,
  resolveBarLabels,
  sendBarLabels,
  sendBarStyle,
  widestLabel,
  type BarErrorBarStyle,
  type BarErrorValue,
  type BarLabelOptions,
  type BarOrientation,
  type BarStyleState,
} from './chart-bar-style';
export type {
  BarErrorBarStyle,
  BarErrorValue,
  BarLabelContext,
  BarLabelOptions,
  BarLabelPosition,
  BarOrientation,
} from './chart-bar-style';

export interface RawGraphData {
  /** Flat [x0, y0, z0, x1, y1, z1, ...] coordinates (length = 3 * N) */
  positions: Float32Array;
  /** Optional node masses [m0, m1, ...] (length = N, defaults to 1.0) */
  masses?: Float32Array;
  /** Optional node RGBA colors [r0, g0, b0, a0, ...] in [0, 1] (length = 4 * N) */
  colors?: Float32Array;
  /** Optional node cluster IDs [c0, c1, ...] (length = N) */
  clusters?: Uint16Array;
  /** Flat edge endpoint index pairs [src0, dst0, src1, dst1, ...] (length = 2 * E) */
  edges?: Uint32Array;
  /** Optional edge weights [w0, w1, ...] (length = E, defaults to 1.0) */
  edgeWeights?: Float32Array;
}

export interface ForceOptions {
  repulsionStrength: number;
  springStiffness: number;
  springRestLength: number;
  centerGravity: number;
  damping: number;
  theta: number;
}

export const DEFAULT_SDK_FORCE_OPTIONS: ForceOptions = {
  repulsionStrength: 25.0,
  springStiffness: 0.08,
  springRestLength: 8.0,
  centerGravity: 0.03,
  damping: 0.88,
  theta: 0.75,
};

export type PrimitiveShape = 'box' | 'sphere' | 'plane' | 'cylinder';
export type RigidBodyType = 'static' | 'dynamic' | 'kinematic';
export type Vec3Tuple = [number, number, number];

/** `focusNode` default distance as a fraction of the overview (`fitToView`) distance */
const FOCUS_DISTANCE_RATIO = 0.4;
export type LayoutPresetMode = 'cluster-sphere' | 'radial-shells' | 'helix' | 'grid-3d';
export type EmbeddingProjectionMode = 'pca' | 'pca-umap' | 'random-projection';

export interface HighDimEmbeddingOptions {
  /** Embedding vector dimension D (supports any D >= 3, e.g., 64, 128, 384, 768, 1024, 1536, 3072, 4096+) */
  dimensions: number;
  /** Dimensionality reduction mode from R^D -> R^3 (default: 'pca-umap') */
  projection?: EmbeddingProjectionMode;
  /** Number of top cosine-similar neighbors to connect as edges per vector (default: 5) */
  kNeighbors?: number;
  /** Minimum cosine similarity in [-1, 1] required to create an edge (default: 0.35) */
  similarityThreshold?: number;
  /** Optional pre-assigned cluster IDs (length = N). If omitted, Rust runs Spherical K-Means in D-dim space */
  clusters?: Uint16Array;
  /** Physics warmup ticks when projection is 'pca-umap' (default: 35) */
  umapWarmupTicks?: number;
  /** Target 3D bounding sphere radius (default: 85) */
  spaceRadius?: number;
}

export interface CosineSimilarityMatch {
  nodeId: number;
  cosineSimilarity: number;
  label: string;
}

export interface LineSeriesDescriptor extends LineStyleInput {
  name: string;
  /** Sample values; `NaN` / `null` / `undefined` are missing (see `nulls`) */
  values: Float32Array | number[];
  /**
   * x of each sample (same length as `values`, finite, sorted ascending; irregular spacing is
   * fine). Give it for every series or none; without it samples are spaced evenly by index.
   * Numbers are plain values or epoch ms (`axes.x.type: 'time'`); `Date[]` implies a time axis.
   */
  x?: Float64Array | number[] | Date[];
  /** `[r, g, b, a]` in 0..1 or a CSS color (`'#3b82f6'`, `'rgb(...)'`, `'hsl(...)'`, named) */
  color?: ColorInput;
  /** Stroke width in CSS pixels for this series (overrides `LineChartOptions.lineWidth`) */
  lineWidth?: number;
  /**
   * y axis of this series (2D line charts): any `'right'` series opts the chart into a second y
   * axis with its own domain / scale / ticks (`axes.y2`); gridlines follow the left axis
   * (default: `'left'`; ignored by area charts)
   */
  yAxis?: 'left' | 'right';
  /** @deprecated Ignored: series depth is laid out by the engine */
  zOffset?: number;
  /** @deprecated Use `marker: { size }` (mapped to it when `marker` is not given) */
  pointSize?: number;
  /**
   * Data point markers (`true` = defaults: 6 px circles in the series color, shown while points
   * are >= 8 px apart). Engine marks, decimated with the line.
   */
  marker?: LineStyleInput['marker'];
  /** Dash pattern in CSS px (`[6, 3]`); the pattern runs on continuously along the line */
  dash?: number[];
  /** `'linear'` (default), `'step'` / `'stepBefore'` / `'stepAfter'`, or `'monotone'` (smooth, no overshoot) */
  curve?: LineStyleInput['curve'];
  /** Missing samples of this series (overrides the chart's `nulls`) */
  nulls?: LineNullPolicy;
  /**
   * Range band (error band / confidence interval) filled beneath the line in the series color;
   * shares the legend entry, tooltips show `lower – upper`, the data table adds its columns
   */
  band?: LineStyleInput['band'];
}

export interface LineChartOptions {
  width?: number;
  height?: number;
  viewMode?: '2d' | '2.5d';
  /** Horizontal gridlines + baseline (default: true). See `grid` for styling. */
  showBackdropGrid?: boolean;
  grid?: ChartGridStyle;
  /** Prefix of the default x tick / tooltip label without series `x`, e.g. `T` -> `T+120` */
  xLabelPrefix?: string;
  title?: string;
  legend?: ChartLegendOptions | boolean;
  /** `y2`: right y axis, used only when a series has `yAxis: 'right'` (line charts) */
  axes?: { x?: LineXAxisOptions; y?: LineYAxisOptions; y2?: LineYAxisOptions };
  /**
   * Locale of this chart's default number / time labels and tooltip values (`Intl`); default:
   * the SDK locale (`setLocale`), else the runtime locale
   */
  locale?: string;
  /**
   * Time zone of a time x axis: tick boundaries (midnight, month start, hours on DST days) and
   * labels / tooltips / a11y text / CSV (default: the SDK zone, `setTimeZone`, else `'local'`)
   */
  timeZone?: CharturboTimeZone;
  padding?: ChartPaddingOptions;
  /** Stroke width in CSS pixels for every series; constant at any zoom (default: 2) */
  lineWidth?: number;
  /**
   * Missing samples (`NaN` / `null` / `undefined`): `'gap'` breaks the line / area (default),
   * `'connect'` joins the neighbours (stacked areas interpolate), `'zero'` draws them at 0.
   * Series `nulls` override it.
   */
  nulls?: LineNullPolicy;
  /** Hover layer style (crosshair, point markers). See `ChartHoverStyle`. */
  hover?: ChartHoverStyle;
  /** Accessible name of the canvas; replaces the auto summary (which moves to the description) */
  description?: string;
  /**
   * Range selector strip below the plot (2D only): an overview of every visible series over the
   * full x range with a draggable / resizable zoom window (click outside it to jump, wheel to
   * zoom). `true` or `{ height }` in CSS px (default 48). Emits `'rangechange'` like zoom / pan.
   */
  navigator?: NavigatorOption;
  /** Enter / update animation of this chart (default: the SDK setting, `setAnimation`) */
  animation?: ChartAnimationInput;
}

/** Area chart: line options (2D only) plus the stacking mode and fill opacity. */
export interface AreaChartOptions extends Omit<LineChartOptions, 'viewMode'> {
  /**
   * `'overlap'`: every series filled down to zero (default). `'stacked'`: series stacked on each
   * other. `'percent'`: stacked, each x normalized to 100%. Stacked modes need series of equal
   * length (and identical `x` when given); `NaN` leaves a gap and counts as 0 for the series above.
   */
  mode?: 'overlap' | 'stacked' | 'percent';
  /** Fill alpha multiplier of the series color (default: 0.2 overlap, 0.8 stacked / percent) */
  fillOpacity?: number;
}

export interface BarChartItemDescriptor {
  label: string;
  value: number;
  /** Error bar: `±e` or `[minus, plus]` in value units (2D; tooltip shows it) */
  error?: BarErrorValue;
  category?: string;
  color?: ColorInput;
  /** @deprecated Ignored: the 3D matrix layout is computed by the engine */
  row?: number;
  /** @deprecated Ignored: the 3D matrix layout is computed by the engine */
  col?: number;
  attributes?: Record<string, string | number | boolean>;
}

export interface BarChartOptions {
  /** Enter / update animation of this chart (default: the SDK setting, `setAnimation`) */
  animation?: ChartAnimationInput;
  viewMode?: '2d' | '3d';
  width?: number;
  maxBarHeight?: number;
  /** Bar width in world units (default: 72% of the slot) */
  barThickness?: number;
  /** Radius of the rounded data-end corners in CSS pixels, 2D only (default: 4) */
  cornerRadius?: number;
  /** Default bar color when an item has none (default: first palette color) */
  color?: ColorInput;
  grid?: ChartGridStyle;
  title?: string;
  axes?: { x?: ChartAxisOptions; y?: ChartAxisOptions };
  padding?: ChartPaddingOptions;
  /** Hover style (`barHighlightColor`). See `ChartHoverStyle`. */
  hover?: ChartHoverStyle;
  /** Accessible name of the canvas; replaces the auto summary (which moves to the description) */
  description?: string;
  /**
   * `'horizontal'`: categories down the left axis, bars growing right (negative values left);
   * `axes.x` is then the value axis and `axes.y` the category axis. 2D only (default `'vertical'`)
   */
  orientation?: BarOrientation;
  /** Data labels on the bars: `true`, `'auto'` (hide what does not fit / collides) or options (2D) */
  labels?: boolean | 'auto' | BarLabelOptions;
  /** Look of error bars (values come from `error` on items / series) */
  errorBars?: BarErrorBarStyle;
  /**
   * Legend. Multi-series: series toggle (re-stacks) / hover emphasis, shown for 2+ series in 2D.
   * Single series (on request, static): a key of the item `category` values (color of each
   * category's first bar) when items have categories, else one entry named `seriesName`
   */
  legend?: ChartLegendOptions | boolean;
  /** Single-series charts: series name of the legend entry (default `'Value'`) */
  seriesName?: string;
}

/** One series of a multi-series bar chart: one value per category (`NaN` = missing). */
export interface BarSeriesDescriptor {
  name: string;
  values: Float32Array | number[];
  /** Error bar per category: `±e` or `[minus, plus]` in value units (`null` = none) */
  error?: BarErrorValue[];
  /** Default: theme palette in series order */
  color?: ColorInput;
}

export interface GroupedBarChartData {
  /** Category (x axis) labels; every series has one value per category */
  categories: string[];
  series: BarSeriesDescriptor[];
}

export interface GroupedBarChartOptions extends BarChartOptions {
  /**
   * `'grouped'`: series side by side in each category (default). `'stacked'`: positive values
   * stack up and negative values stack down. `'percent'`: stacked, each category normalized to 100%.
   */
  mode?: 'grouped' | 'stacked' | 'percent';
  /** Empty fraction of each category slot between groups (default: 0.28; ignored with `barThickness`) */
  groupGap?: number;
  /** CSS pixels between the bars of a group / between stacked segments (default: 2) */
  barGap?: number;
}

/** Hover layer of line / bar / scatter charts, rendered by the engine on the GPU. */
export interface ChartHoverStyle {
  /**
   * Line charts: `'index'` snaps to the hovered x and shows every series there (default);
   * `'nearest'` shows only the closest data point. The 2.5D view always uses `'nearest'`.
   */
  mode?: 'index' | 'nearest';
  /** Vertical guide line at the hovered x on 2D line charts (default: true) */
  crosshair?: boolean;
  /** Crosshair color (default: `[0.58, 0.64, 0.72, 0.55]`) */
  crosshairColor?: ColorInput;
  /** Crosshair width in CSS pixels (default: 1) */
  crosshairWidth?: number;
  /** Point markers on hovered values, filled with the series color (default: true) */
  marker?: boolean;
  /** Marker radius in CSS pixels, excluding the ring (default: 4) */
  markerRadius?: number;
  /** Ring separating the marker from the line; use the chart background (default: `[0.035, 0.045, 0.08, 1]`) */
  markerRingColor?: ColorInput;
  /** Ring width in CSS pixels (default: 2) */
  markerRingWidth?: number;
  /** Color of the hovered bar (default: the bar color lightened by 22%) */
  barHighlightColor?: ColorInput;
  /** `'nearest'` mode pick radius in CSS pixels (default: 24) */
  hitRadius?: number;
}

/** Gridlines drawn behind chart marks. */
export interface ChartGridStyle {
  /** Number of horizontal grid intervals (default: 5 for line, 5 for bar) */
  rows?: number;
  color?: ColorInput;
  baselineColor?: ColorInput;
  /** Stroke width in CSS pixels (default: 1) */
  strokeWidth?: number;
}

/** One chart axis (2D views). */
export interface ChartAxisOptions {
  /** Show tick labels (default: true) */
  show?: boolean;
  /** Axis title drawn beside the tick labels */
  title?: string;
  /**
   * Tick label text. Line x ticks receive the series `x` value (or the sample index without
   * `x`), bar x ticks the bar / category index, y ticks the data value (percent for
   * `'percent'` bar charts). Time x ticks also receive the calendar boundary the tick lands on;
   * the line tooltip calls it without one. Also a number format spec (`'.2f'`, `',.0f'`, `'.1%'`,
   * `'.2s'`, `'$,.2f'`, `'compact'`, `'bytes'`) or `Intl.NumberFormatOptions` (chart-format.ts),
   * compiled once for the chart locale (time axes: the spec formats epoch ms as a number).
   */
  format?: ChartFormatSpec | ((value: number, granularity?: ChartTimeGranularity) => string);
}

/** x axis of a line chart. */
export interface LineXAxisOptions extends ChartAxisOptions, ChartScaleOptions {
  /**
   * Scale of series `x`: `'numeric'` nice 1 / 2 / 5 x 10^n ticks, `'time'` epoch-ms ticks on
   * calendar boundaries of the chart's time zone (`timeZone`, default `'local'`), labelled in
   * that zone (default: `'time'` when `x` is `Date[]`).
   */
  type?: 'numeric' | 'time';
}

/** y domain of a line chart (derived by the engine; see `setYDomain`). */
export interface LineYDomainOptions {
  /** Fixed bottom of the domain (default: from the data) */
  min?: number;
  /** Fixed top of the domain (default: from the data) */
  max?: number;
  /**
   * `'all'` (default): extent of all data, re-derived when data changes. `'visible'`: extent of
   * the visible series inside the x zoom window, re-derived on zoom / pan / data updates with
   * hysteresis (kept until the data leaves the domain or spans < 60% of it). `'none'`: derived
   * once, then kept while data changes.
   */
  autoscale?: 'none' | 'visible' | 'all';
  /** Expand data-derived ends to whole tick steps; fixed `min` / `max` stay exact (default: true) */
  nice?: boolean;
}

/** y axis of a line chart. */
export interface LineYAxisOptions extends ChartAxisOptions, LineYDomainOptions, ChartScaleOptions {}

/** Streaming options of `appendSeriesData` and `appendAreaData`. */
export interface AppendSeriesOptions {
  /**
   * Keep only the newest `maxPoints` samples of the series (sliding window; default: unlimited).
   * Trimming re-bases data point ids: index 0 is always the oldest kept sample.
   */
  maxPoints?: number;
}

/** Coarsest calendar boundary (in the chart time zone) a time tick lands on (picks its label format). */
export type ChartTimeGranularity = 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'month' | 'year';

/** Legend shown above the plot (line / multi-series bar charts with 2+ series by default). */
export interface ChartLegendOptions {
  /** Default: true when there are 2+ series */
  show?: boolean;
  /** Click toggles series visibility (default: true) */
  toggle?: boolean;
  /** Hover fades the other series (default: true) */
  emphasize?: boolean;
}

/** Plot margins in CSS px; unspecified sides are derived from the title / legend / axes. */
export interface ChartPaddingOptions {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

/** Color tokens shared by the GPU marks and the DOM overlay (labels, legend, tooltip). */
export interface CharturboTheme {
  name: string;
  /** Canvas clear color */
  surface: RgbaTuple;
  /** Categorical series order */
  palette: RgbaTuple[];
  grid: RgbaTuple;
  baseline: RgbaTuple;
  crosshair: RgbaTuple;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  tooltipBackground: string;
  tooltipBorder: string;
  fontFamily: string;
}

/** `CharturboTheme` as accepted by `setTheme`: the GPU color tokens may also be CSS color strings. */
export interface CharturboThemeInput extends Omit<CharturboTheme, 'surface' | 'palette' | 'grid' | 'baseline' | 'crosshair'> {
  surface: ColorInput;
  palette: ColorInput[];
  grid: ColorInput;
  baseline: ColorInput;
  crosshair: ColorInput;
}

/** Node hover look of graph / point-cloud views. */
export interface NodeHoverStyle {
  /** Enlarge + tint the hovered node (default: true) */
  enabled?: boolean;
  /** Radius multiplier (default: 1.6) */
  scale?: number;
  /** Fixed hover color; omit to brighten the node's own color */
  color?: ColorInput;
}

/** OHLC data of a candlestick chart: one entry per candle in every array. */
export interface CandlestickChartData {
  /**
   * x of each candle (finite, sorted ascending): epoch ms or `Date` for a time axis, or plain
   * numbers (`axes.x.type: 'numeric'`). Omit to place candles by index.
   */
  t?: Float64Array | number[] | Date[];
  /** A candle with a non-finite open / high / low / close is a gap */
  open: Float32Array | number[];
  high: Float32Array | number[];
  low: Float32Array | number[];
  close: Float32Array | number[];
  /** Optional volume: bars in a bottom pane with their own scale */
  volume?: Float32Array | number[];
}

/** OHLC bars use the same ordered financial samples as candlesticks. */
export type OhlcChartData = CandlestickChartData;

export interface OhlcChartOptions extends Omit<CandlestickChartOptions, 'hollowUp' | 'wickWidth' | 'bodyWidth' | 'cornerRadius'> {
  /** Stem and tick stroke width in CSS px (0.25–8; default 1). */
  lineWidth?: number;
  /** Combined left/right tick span as a fraction of bar spacing (0.05–1; default 0.7). */
  tickWidth?: number;
}

export interface CandlestickChartOptions {
  /** Enter / update animation of this chart (default: the SDK setting, `setAnimation`) */
  animation?: ChartAnimationInput;
  /** World size of the plot (aspect ratio of the framed plot; default: 168 x 86) */
  width?: number;
  height?: number;
  title?: string;
  /** Accessible name of the canvas; replaces the auto summary (which moves to the description) */
  description?: string;
  /** Locale of default labels / tooltip values (default: the SDK locale) */
  locale?: string;
  /** Time zone of the time axis and its labels (default: the SDK zone, `setTimeZone`) */
  timeZone?: CharturboTimeZone;
  padding?: ChartPaddingOptions;
  /** `x.type` defaults to `'time'` when `t` is given (epoch ms / `Date`) */
  axes?: { x?: LineXAxisOptions; y?: ChartAxisOptions };
  /** Rising candle color (close >= open; default: theme palette[0], blue) */
  upColor?: ColorInput;
  /** Falling candle color (default: theme palette[1], orange). Blue / orange stay distinct under color-vision deficiency */
  downColor?: ColorInput;
  /** Rising candles drawn as outlines, a shape cue besides color (default: true; narrow candles are filled) */
  hollowUp?: boolean;
  /** Wick / outline width in CSS px (default: 1) */
  wickWidth?: number;
  /** Body width as a fraction of the candle spacing (default: 0.7) */
  bodyWidth?: number;
  /** Rounded body corners in CSS px, 0..1 (default: 0) */
  cornerRadius?: number;
  /** Volume pane when `volume` is given (default: true) */
  showVolume?: boolean;
  /** Volume bar opacity (default: 0.45) */
  volumeOpacity?: number;
  /** Volume pane height as a fraction of the plot (default: 0.2) */
  volumeHeight?: number;
  /** `'visible'`: the price axis fits the visible candles on zoom / pan (default); `'all'`: every candle */
  yFit?: 'visible' | 'all';
  /** Crosshair style (vertical at the candle, horizontal at the pointer) */
  hover?: ChartHoverStyle;
  showBackdropGrid?: boolean;
  grid?: ChartGridStyle;
}

/** Histogram options: binning runs in the engine (O(n), 1M+ values). */
export interface HistogramChartOptions {
  /** `'auto'` (default): Freedman–Diaconis, Sturges when the IQR is 0 (max 1000 bins); or a bin count (max 10000) */
  bins?: 'auto' | number;
  /** Binned range; values outside are ignored (default: the finite data extent) */
  range?: [number, number];
  /** Bar heights are densities integrating to 1 instead of counts (default: false) */
  density?: boolean;
  width?: number;
  maxBarHeight?: number;
  /** Bar color (default: theme palette[0]) */
  color?: ColorInput;
  /** CSS px between bars (default: 1) */
  barGap?: number;
  /** Rounded bar tops in CSS px (default: 0) */
  cornerRadius?: number;
  title?: string;
  description?: string;
  locale?: string;
  /** x ticks land on bin edges and receive the edge value */
  axes?: { x?: ChartAxisOptions; y?: ChartAxisOptions };
  padding?: ChartPaddingOptions;
  hover?: ChartHoverStyle;
  grid?: ChartGridStyle;
}

/** Bins computed by the engine for `renderHistogram`. */
export interface HistogramResult {
  binCount: number;
  /** `binCount + 1` ascending edges */
  edges: Float64Array;
  counts: Float64Array;
  /** Bar heights (counts, or densities with `density`) */
  heights: Float64Array;
  /** Finite values inside the range */
  total: number;
  rule: 'freedman-diaconis' | 'sturges' | 'fixed';
}

/** Hovered candle (or the bucket aggregate drawn while zoomed out). */
export interface ChartOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
  /** Bucket sum; undefined without volume data */
  volume?: number;
  /** x of the first / last candle in the bucket (`t`, else the index) */
  x: number;
  xEnd: number;
  /** Candles aggregated into the hovered mark (1 = a single candle) */
  count: number;
}

export interface ChartTooltipItem {
  seriesName: string;
  value: number;
  /** Series color as a CSS `rgb()` string */
  color: string;
  nodeId: number;
  /**
   * `'percent'` bar charts: share of the category's absolute sum (0-100). `'percent'` area
   * charts: share of the positive sum at the hovered x
   */
  percent?: number;
  /** Bar error bar of this value: `[minus, plus]` in value units */
  error?: [number, number];
  /** Line series with a `band`: its lower / upper edge at the hovered sample */
  band?: { lower: number; upper: number };
  errorBar?: { low: number; high: number; direction: 'vertical' | 'horizontal' };
  baseline?: number;
}

export interface ChartTooltipContext {
  /** `'combo'`: bar / line / area series of a combo chart (items = every series at the category) */
  chartType:
    | 'line' | 'band' | 'errorBar' | 'impulse' | 'bar' | 'scatter' | 'candlestick' | 'ohlc' | 'heatmap' | 'box' | 'pie' | 'combo'
    | 'radar' | 'gauge' | 'funnel' | 'waterfall' | 'treemap' | 'sunburst' | 'sankey';
  /**
   * Hovered sample / bar / point index (heatmap: column; box plot: category; pie: displayed slice;
   * radar: axis; gauge: 0 = value, `1 + k` = band; funnel: stage; waterfall: bar; treemap /
   * sunburst: node; sankey: node or link)
   */
  index: number;
  /** Hovered radar axis */
  radar?: ChartRadarTooltip;
  /** Gauge value, range and band */
  gauge?: ChartGaugeTooltip;
  /** Hovered funnel stage and its conversion rates */
  funnel?: ChartFunnelTooltip;
  /** Hovered waterfall bar: change and running totals */
  waterfall?: ChartWaterfallTooltip;
  /** Hovered treemap / sunburst node: path, value, shares of its parent and of the total */
  hierarchy?: ChartHierarchyTooltip;
  /** Hovered sankey link (`A → B`, share of A) or node (inflow / outflow) */
  flow?: ChartFlowTooltip;
  /** Hovered pie slice: share of the visible total (0-100); "Other" lists the folded names */
  slice?: { label: string; value: number; percent: number; members?: string[] };
  /** Hovered heatmap cell and its axis labels */
  cell?: { row: number; col: number; xLabel: string; yLabel: string };
  /** Series `x` value of the primary hovered sample (line charts with `x` only) */
  x?: number;
  /**
   * x-axis label for line charts (e.g. `T+120` or the formatted `x`), bar / category label for
   * bar charts, formatted x for scatter
   */
  xLabel: string;
  /** Data coordinates of the hovered scatter point */
  point?: { x: number; y: number };
  /**
   * One entry per series at the hovered x (line index mode, stacked bars) or the single hovered
   * point / bar (nearest mode, single / grouped bars)
   */
  items: ChartTooltipItem[];
  /** `'stacked'` bar / area charts: sum of every visible series at the hovered category / x */
  total?: number;
  /** Area charts (`chartType: 'line'`): stacking mode of the chart */
  areaMode?: 'overlap' | 'stacked' | 'percent';
  /** Candlestick charts: open / high / low / close / volume of the hovered candle or bucket */
  ohlc?: ChartOhlc;
  /** Box plots: statistics of the hovered group (and the hovered outlier value) */
  box?: ChartBoxTooltip;
  /** Full details of the primary hovered point (closest to the pointer) */
  details: NodeDetails | null;
}

export interface ScatterChartData {
  x: Float32Array | number[];
  y: Float32Array | number[];
  /** @deprecated Ignored: the native scatter chart is 2D */
  z?: Float32Array | number[];
  /** Per-point radius in CSS pixels (bubble chart); default `ScatterChartOptions.pointRadius` */
  sizes?: Float32Array | number[];
  /** Per-point series id: legend entry, palette color, visibility toggle */
  clusters?: Uint16Array | number[];
  /** Per-point RGBA (`4 * N`); overrides the series color */
  colors?: Float32Array | number[];
}

export interface ScatterChartOptions {
  /** Enter / update animation of this chart (default: the SDK setting, `setAnimation`) */
  animation?: ChartAnimationInput;
  /** World size of the plot (aspect ratio of the framed plot; default: 168 x 94) */
  width?: number;
  height?: number;
  /** @deprecated Only `'2d'` is supported */
  viewMode?: '2d' | '3d';
  title?: string;
  /** Accessible name of the canvas; replaces the auto summary (which moves to the description) */
  description?: string;
  axes?: { x?: ChartAxisOptions & ChartScaleOptions; y?: ChartAxisOptions & ChartScaleOptions };
  /** Legend of series ids (default: shown with 2+ series) */
  legend?: ChartLegendOptions | boolean;
  padding?: ChartPaddingOptions;
  /** Hover style; scatter always picks the nearest point (default `hitRadius`: 12) */
  hover?: ChartHoverStyle;
  /** Horizontal gridlines + baseline (default: true) */
  showBackdropGrid?: boolean;
  grid?: ChartGridStyle;
  /** Vertical gridlines at the x ticks (default: true) */
  verticalGrid?: boolean;
  /** Legend / tooltip name of each series id (default: `Series <id>`) */
  seriesNames?: string[];
  /** Color of each series id (default: theme palette, wrapping around) */
  seriesColors?: ColorInput[];
  /** Point radius in CSS pixels when `sizes` is not given (default: 3) */
  pointRadius?: number;
  /** Fill alpha multiplier; lower values reveal density (default: 0.85) */
  opacity?: number;
  /** Ring in the chart surface color around each point, CSS px (default: 1 with `sizes`, else 0) */
  pointRing?: number;
}

export interface NodeMetadata {
  label?: string;
  category?: string;
  description?: string;
  tags?: string[];
  attributes?: Record<string, string | number | boolean>;
}

/** Orbit camera pose (`getCameraState`). */
export interface CharturboCameraState {
  /** Point the camera orbits around and looks at */
  target: Vec3Tuple;
  /** Eye position */
  eye: Vec3Tuple;
  /** Eye-to-target distance (world units) */
  distance: number;
  /** Rotation around the world y axis (rad) */
  yaw: number;
  /** Elevation of the eye above the target (rad, within ±π/2) */
  pitch: number;
  /** Vertical field of view (rad) */
  fovY: number;
  /** Viewport width / height */
  aspect: number;
}

export interface FocusNodeOptions {
  /**
   * Camera distance after focusing. Default: 40 % of the overview distance (the last `fitToView`
   * / `setCameraPose` framing), never farther than the current distance; `false` keeps the
   * distance (target only). Needs an engine build with `camera_state`, else only the target moves.
   */
  distance?: number | false;
}

export interface NodeDetails {
  id: number;
  label: string;
  position: Vec3Tuple;
  mass: number;
  clusterId: number;
  color: RgbaTuple;
  degree: number;
  selected: boolean;
  pinned: boolean;
  neighbors: number[];
  metadata: NodeMetadata;
}

export interface NodeInteractionOptions {
  /** Render a built-in floating tooltip when hovering over a 3D node (default: true) */
  builtInTooltip?: boolean;
  /** Optional container to mount the floating tooltip (defaults to canvas.parentElement or document.body) */
  tooltipContainer?: HTMLElement;
  /** Hop count to highlight when clicking a node (default: 1; set 0 to disable) */
  highlightNeighborsOnClick?: number;
  /** Focus camera on double-clicked node (default: true) */
  focusOnDoubleClick?: boolean;
  /** Automatically call sdk.render() on hover/click changes (default: false) */
  autoRender?: boolean;
  /** Optional custom HTML formatter for the floating tooltip (graph / point-cloud nodes) */
  formatTooltip?: (details: NodeDetails) => string;
  /** Optional custom HTML formatter for line / bar / scatter chart tooltips */
  formatChartTooltip?: (ctx: ChartTooltipContext) => string;
  /**
   * Built-in chart tooltip: row `sort`, `shared` (all series at x vs the nearest one), click
   * `pin`, `valueFormatter` (chart-tooltip.ts). `sort` / `shared` also shape the context passed
   * to `formatChartTooltip`; `valueFormatter` applies to the default tooltip only
   */
  tooltip?: ChartTooltipOptions;
  /** Extra CSS class(es) added to the tooltip element (base class: `charturbo-sdk-node-tooltip`) */
  tooltipClassName?: string;
  /** Inline style overrides merged over the default tooltip style */
  tooltipStyle?: Partial<CSSStyleDeclaration>;
  /**
   * 2D line charts: wheel zooms the x axis, drag pans it; scatter charts zoom / pan both axes;
   * double-click resets (default: true)
   */
  chartNavigation?: boolean;
  /**
   * Touch / pen gestures (Pointer Events; mouse is unaffected). Line charts: pinch / drag navigate
   * the x axis, tap pins the tooltip, long-press scrubs, double-tap resets. Graph / 3D: drag orbits,
   * pinch zooms, two-finger drag pans, tap selects, double-tap focuses. `false` disables (default: all on).
   */
  touch?: false | TouchInteractionOptions;
  /**
   * Built-in camera controls of graph / point-cloud / scene views (no chart shown). Mouse: left
   * drag orbits, Shift + left / right / middle drag pans, wheel zooms (dolly). The same switches
   * gate the camera moves of touch gestures (drag orbit, two-finger pan, pinch zoom).
   * `{ orbit: false }` makes a left drag pan (2D-style navigation); `false` turns every built-in
   * camera move off (hosts driving the camera themselves). Charts keep their own wheel / drag
   * navigation either way (default: all on).
   */
  cameraControls?: false | CameraControlOptions;
  /**
   * Brush / box selection on 2D charts (mouse): `'x'` selects an x interval (time range), `'xy'`
   * a rectangle (bars always brush x). While enabled, drag draws the brush and Alt + drag pans;
   * wheel zoom and double-click reset keep working. Release emits `'select'`; Escape or a click
   * clears it. Same as `setChartBrush` (default: unchanged, i.e. off)
   */
  brush?: BrushMode | false;
  /** Brush rectangle look (see `setChartBrush`) */
  brushStyle?: BrushStyleOptions;
  /**
   * Axes the wheel zooms on navigable 2D charts: `'x'` (default), `'y'`, or `'xy'`; Shift + wheel
   * always zooms y. A y zoom pins the line y domain (autoscale pauses) until double-click / reset.
   */
  zoom?: ChartZoomAxis;
  /**
   * Plain drag: `'pan'` (default; Ctrl / Cmd + drag box-zooms) or `'box'` (drag box-zooms x + y,
   * Alt + drag pans). Each gesture records an undo step (Ctrl / Cmd + Z, `undoZoom`).
   */
  zoomMode?: ChartZoomMode;
  /** Fired whenever the hovered node changes */
  onNodeHover?: (
    details: NodeDetails | null,
    pointer: { clientX: number; clientY: number }
  ) => void;
  /** Fired when a node is clicked (or null when empty space is clicked without dragging) */
  onNodeClick?: (details: NodeDetails | null, event: PointerEvent) => void;
}

export interface ObjectTransformDescriptor {
  position?: Vec3Tuple;
  rotation?: Vec3Tuple; // Euler radians [rx, ry, rz]
  scale?: Vec3Tuple;
  parentId?: number | null;
}

export interface ObjectMaterialDescriptor {
  color?: RgbaTuple;
  metallic?: number;
  roughness?: number;
  emissive?: number;
}

export interface ObjectPhysicsDescriptor {
  bodyType?: RigidBodyType;
  velocity?: Vec3Tuple;
  /** World-space angular velocity [wx, wy, wz], in radians per second. */
  angularVelocity?: Vec3Tuple;
  mass?: number;
  restitution?: number;
}

export interface PrimitiveObjectDescriptor {
  name?: string;
  shape: PrimitiveShape;
  position?: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
  color?: RgbaTuple;
  metallic?: number;
  roughness?: number;
  emissive?: number;
  bodyType?: RigidBodyType;
  velocity?: Vec3Tuple;
  /** Initial world-space spin in radians per second; collisions and friction also generate spin. */
  angularVelocity?: Vec3Tuple;
  mass?: number;
  restitution?: number;
  parentId?: number | null;
}

export interface CustomMeshObjectDescriptor {
  name?: string;
  positions: Float32Array | number[];
  normals?: Float32Array | number[];
  indices: Uint32Array | number[];
  position?: Vec3Tuple;
  rotation?: Vec3Tuple;
  scale?: Vec3Tuple;
  color?: RgbaTuple;
  metallic?: number;
  roughness?: number;
  emissive?: number;
  bodyType?: RigidBodyType;
  velocity?: Vec3Tuple;
  /** Initial world-space spin in radians per second; physics uses the mesh's bounding box. */
  angularVelocity?: Vec3Tuple;
  mass?: number;
  restitution?: number;
  parentId?: number | null;
}

export interface SceneLightingDescriptor {
  ambientIntensity?: number;
  directionalDirection?: Vec3Tuple;
  directionalIntensity?: number;
  pointPosition?: Vec3Tuple;
  pointIntensity?: number;
}

export interface SceneHelpersDescriptor {
  showGrid?: boolean;
  gridSize?: number;
  gridDivisions?: number;
  showAxes?: boolean;
  axesLength?: number;
}

export interface SceneObjectRecord {
  id: number;
  name: string;
  kind: 'primitive' | 'custom';
  shape?: PrimitiveShape;
  customMesh?: {
    positions: number[];
    normals: number[];
    indices: number[];
  };
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  color: RgbaTuple;
  metallic: number;
  roughness: number;
  emissive: number;
  bodyType: RigidBodyType;
  velocity: Vec3Tuple;
  angularVelocity: Vec3Tuple;
  mass: number;
  restitution: number;
  parentId: number | null;
}

export interface SceneDescriptor {
  lighting?: SceneLightingDescriptor;
  helpers?: SceneHelpersDescriptor;
  rigidPhysics?: {
    enabled: boolean;
    gravity: Vec3Tuple;
  };
  graphVisible?: boolean;
  objects: Array<
    | ({ kind: 'primitive' } & PrimitiveObjectDescriptor)
    | ({ kind: 'custom' } & CustomMeshObjectDescriptor)
  >;
}

export interface WasmCharturboEngineBackend extends AnimationBackend, ZoomBackend, RenderStatsBackend {
  /** SVG of the last frame (chart/svg.rs; header comment + markup) */
  chart_export_svg?(maxMarks: number, id: string): string;
  reload_dataset(seed: number, nodeCount: number, edgeCount: number, clusterCount: number): void;
  load_raw_dataset(
    positions: Float32Array,
    masses: Float32Array,
    colors: Float32Array,
    clusters: Uint16Array,
    edges: Uint32Array,
    edgeWeights: Float32Array
  ): void;
  export_positions(): Float32Array;
  import_positions(positions: Float32Array): void;
  warmup(ticks: number, dt: number): number;
  step_physics(dt: number): number;
  supports_gpu_physics?(): boolean;
  request_gpu_physics?(dt: number): Promise<[number, Float32Array | number]>;
  complete_gpu_physics?(ticket: number, forces: Float32Array): number;
  set_auto_sleep(enabled: boolean, sleepThreshold: number): void;
  is_sleeping(): boolean;
  wake_up(): void;
  set_force_params(
    repulsionStrength: number,
    springStiffness: number,
    springRestLength: number,
    centerGravity: number,
    damping: number,
    theta: number
  ): void;
  set_frustum_culling(enabled: boolean): void;
  sync_and_render(): void;
  rotate_camera(deltaYaw: number, deltaPitch: number): void;
  zoom_camera(delta: number): void;
  pan_camera(deltaRight: number, deltaUp: number): void;
  fit_to_view(): void;
  focus_on_node(nodeId: number): boolean;
  /** `[target x, y, z, distance, yaw, pitch, fov y, aspect]` of the orbit camera */
  camera_state?(): Float32Array;
  resize(width: number, height: number): void;
  pick_node_at_ndc(ndcX: number, ndcY: number): number;
  select_box_ndc(minNdcX: number, minNdcY: number, maxNdcX: number, maxNdcY: number): Uint32Array;
  query_radius(x: number, y: number, z: number, radius: number, maxResults: number): Uint32Array;
  select_node_and_neighbors(nodeId: number, hops: number): Uint32Array;
  select_cluster(clusterId: number): Uint32Array;
  clear_selection(): void;
  set_node_pinned(nodeId: number, pinned: boolean): boolean;
  move_node_to(nodeId: number, x: number, y: number, z: number): boolean;
  get_node_info?(nodeId: number): Float32Array;
  get_node_neighbors?(nodeId: number): Uint32Array;
  project_node_to_ndc?(nodeId: number): Float32Array;
  select_shortest_path?(startId: number, endId: number): Uint32Array;
  set_node_style?(
    nodeId: number,
    r: number,
    g: number,
    b: number,
    a: number,
    mass: number,
    clusterId: number
  ): boolean;
  apply_preset_layout?(layoutKind: number, spaceRadius: number): void;
  load_high_dim_embeddings?(
    vectors: Float32Array,
    dim: number,
    projectionMode: number,
    kNeighbors: number,
    similarityThreshold: number,
    clusters: Uint16Array,
    warmupTicks: number,
    spaceRadius: number
  ): void;
  query_cosine_similar?(nodeId: number, topK: number): Float32Array;
  query_cosine_similar_f64?(nodeId: number, topK: number): Float64Array;
  project_nodes_to_ndc?(ids: Uint32Array): Float32Array;
  embedding_dim?(): number;
  node_count(): number;
  edge_count(): number;

  // 3D Scene & Spatial World extensions
  set_graph_visible?(visible: boolean): void;
  move_camera_local?(forwardDelta: number, rightDelta: number, upDelta: number): void;
  rotate_camera_look?(deltaYaw: number, deltaPitch: number): void;
  set_camera_pose?(
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    targetX: number,
    targetY: number,
    targetZ: number
  ): void;
  add_primitive?(
    kind: number,
    px: number,
    py: number,
    pz: number,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    g: number,
    b: number,
    a: number,
    bodyType: number
  ): number;
  add_custom_mesh?(
    positions: Float32Array,
    normals: Float32Array,
    indices: Uint32Array,
    px: number,
    py: number,
    pz: number,
    sx: number,
    sy: number,
    sz: number,
    r: number,
    g: number,
    b: number,
    a: number,
    bodyType: number
  ): number;
  remove_object?(objectId: number): boolean;
  clear_scene_objects?(): void;
  object_count?(): number;
  set_object_transform?(
    objectId: number,
    px: number,
    py: number,
    pz: number,
    rx: number,
    ry: number,
    rz: number,
    sx: number,
    sy: number,
    sz: number
  ): boolean;
  get_object_transform?(objectId: number): Float32Array;
  set_object_material?(
    objectId: number,
    r: number,
    g: number,
    b: number,
    a: number,
    metallic: number,
    roughness: number,
    emissive: number
  ): boolean;
  set_object_physics?(
    objectId: number,
    bodyType: number,
    vx: number,
    vy: number,
    vz: number,
    mass: number,
    restitution: number
  ): boolean;
  set_object_angular_velocity?(objectId: number, wx: number, wy: number, wz: number): boolean;
  set_object_parent?(objectId: number, parentId: number): boolean;
  set_scene_lighting?(
    ambientIntensity: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    dirIntensity: number,
    pointX: number,
    pointY: number,
    pointZ: number,
    pointIntensity: number
  ): void;
  set_scene_helpers?(
    showGrid: boolean,
    gridSize: number,
    gridDivisions: number,
    showAxes: boolean,
    axesLength: number
  ): void;
  set_rigid_physics?(enabled: boolean, gx: number, gy: number, gz: number): void;
  pick_object_at_ndc?(ndcX: number, ndcY: number): number;
  raycast_object_at_ndc?(ndcX: number, ndcY: number): Float32Array;
  select_object?(objectId: number): void;

  // Native charts & view styling
  set_pixel_ratio?(ratio: number): void;
  set_node_hover_style?(
    enabled: boolean,
    scale: number,
    r: number,
    g: number,
    b: number,
    a: number,
    useColor: boolean
  ): void;
  set_line_chart?(
    values: Float32Array,
    lengths: Uint32Array,
    colors: Float32Array,
    widthsPx: Float32Array,
    width: number,
    height: number,
    viewMode: number
  ): number;
  /** `set_line_chart` with concatenated per-sample x; `xKind` 0 = numeric, 1 = time (epoch ms) */
  set_line_chart_xy?(
    values: Float32Array,
    lengths: Uint32Array,
    xs: Float64Array,
    colors: Float32Array,
    widthsPx: Float32Array,
    width: number,
    height: number,
    viewMode: number,
    xKind: number
  ): number;
  /**
   * 2D area chart laid out like `set_line_chart_xy` (`xs` empty = index placement). `mode` 0 =
   * overlap, 1 = stacked, 2 = percent; `fillOpacity` NaN = mode default; `xKind` 0 = numeric, 1 = time
   */
  set_area_chart?(
    values: Float32Array,
    lengths: Uint32Array,
    xs: Float64Array,
    colors: Float32Array,
    widthsPx: Float32Array,
    width: number,
    height: number,
    mode: number,
    fillOpacity: number,
    xKind: number
  ): number;
  set_bar_chart?(
    values: Float32Array,
    colors: Float32Array,
    width: number,
    maxHeight: number,
    barWidth: number,
    cornerRadiusPx: number,
    viewMode: number
  ): number;
  set_bar_chart_multi?(
    values: Float32Array,
    seriesCount: number,
    colors: Float32Array,
    mode: number,
    width: number,
    maxHeight: number,
    barWidth: number,
    cornerRadiusPx: number,
    groupGap: number,
    gapPx: number,
    viewMode: number
  ): number;
  set_scatter_chart?(
    xs: Float32Array,
    ys: Float32Array,
    sizes: Float32Array,
    seriesIds: Uint16Array,
    colors: Float32Array,
    seriesColors: Float32Array,
    width: number,
    height: number,
    radiusPx: number,
    opacity: number,
    ringPx: number,
    gridX: boolean
  ): number;
  /**
   * Candlestick chart: `t` empty = index placement; `volume` empty = none; `style` = `[up rgba,
   * down rgba, hollowUp, wickPx, bodyRatio, cornerRadiusPx, showVolume, volumeAlpha,
   * volumeFraction, fitVisible]` (NaN = default); `xKind` 0 = numeric, 1 = time
   */
  set_candle_chart?(
    t: Float64Array,
    open: Float32Array,
    high: Float32Array,
    low: Float32Array,
    close: Float32Array,
    volume: Float32Array,
    style: Float32Array,
    width: number,
    height: number,
    xKind: number
  ): number;
  set_chart_candle_style?(style: Float32Array): void;
  /** OHLC bars: same layout as set_candle_chart; style slot 16 = 1. */
  set_ohlc_chart?: WasmCharturboEngineBackend['set_candle_chart'];
  /** `[x, open, high, low, close, volume, first, last]` of a candle / its drawn bucket */
  chart_candle?(index: number): Float64Array;
  /** `bins` 0 = auto; range NaN = data extent; returns the bin count */
  set_histogram_chart?(
    values: Float32Array,
    bins: number,
    rangeMin: number,
    rangeMax: number,
    density: boolean,
    color: Float32Array,
    width: number,
    maxHeight: number,
    cornerRadiusPx: number,
    gapPx: number
  ): number;
  /** `[bins, total, rule, edges (bins + 1), heights (bins), counts (bins)]` */
  chart_histogram?(): Float64Array;
  clear_chart?(): void;
  chart_series_count?(): number;
  chart_hover_at_ndc?(ndcX: number, ndcY: number): Float64Array;
  chart_clear_hover?(): void;
  set_chart_line_width?(series: number, widthPx: number): void;
  set_chart_hover_style?(params: Float32Array): void;
  set_chart_frame_style?(params: Float32Array): void;
  chart_sample?(globalId: number): Float64Array;
  chart_fit_view?(): void;
  set_clear_color?(r: number, g: number, b: number, a: number): void;
  set_chart_padding?(top: number, right: number, bottom: number, left: number): void;
  set_chart_series_visible?(series: number, visible: boolean): void;
  set_chart_emphasis?(series: number): void;
  chart_zoom_x?(factor: number, anchorNdcX: number): void;
  chart_pan_x?(deltaNdcX: number): void;
  chart_zoom_xy?(factor: number, anchorNdcX: number, anchorNdcY: number): void;
  chart_pan_xy?(deltaNdcX: number, deltaNdcY: number): void;
  chart_reset_zoom?(): void;
  /** Replaces one line series in place (`xs` empty without x); returns its new length */
  set_chart_series_data?(series: number, values: Float32Array, xs: Float64Array): number;
  /** Appends to one line series (`maxPoints` 0 = unlimited); returns its new length */
  append_chart_series_data?(series: number, values: Float32Array, xs: Float64Array, maxPoints: number): number;
  /** Atomically appends to all area series; returns their new lengths. */
  append_area_data?(values: Float32Array, lengths: Uint32Array, xs: Float64Array, maxPoints: number): Uint32Array;
  /** `min` / `max` NaN = from the data; `autoscale` 0 = all, 1 = visible, 2 = none */
  set_chart_y_domain?(min: number, max: number, autoscale: number, nice: boolean): void;
  /** `[min, max, step]` of the line y domain */
  chart_y_domain?(): Float64Array;
  /** `axis` 0 = x, 1 = left y, 2 = right y; `kind` 0 = linear, 1 = log; `tickCount` 0 = default */
  set_chart_axis_scale?(axis: number, kind: number, reverse: boolean, tickCount: number): void;
  /** `[kind, reverse, tickCount]` of one axis, or empty */
  chart_axis_scale?(axis: number): Float64Array;
  /** y axis per line series: 0 = left, 1 = right */
  set_chart_series_axes?(axes: Uint8Array): void;
  /** Right y domain (arguments as `set_chart_y_domain`) */
  set_chart_y2_domain?(min: number, max: number, autoscale: number, nice: boolean): void;
  /** `[min, max, step]` of the right y domain, or empty */
  chart_y2_domain?(): Float64Array;
  /** y axis per annotation (0 = left, 1 = right), after `set_chart_annotations` */
  set_chart_annotation_y_axes?(axes: Uint8Array): void;
  /** Live samples / absolute x of a line series (after appends and trims) */
  chart_series_values?(series: number): Float32Array;
  chart_series_x?(series: number): Float64Array;
  chart_axes_revision?(): number;
  chart_axes?(): Float64Array;
  /** UTC-offset table of the time x axis (lib_timezone.rs); empty arrays = UTC */
  set_chart_time_zone?(transitionsMs: Float64Array, offsetsMin: Float32Array): void;
  /** Full `[lo, hi]` epoch-ms domain of a time x axis, empty without one */
  chart_time_domain?(): Float64Array;
  /** Visible `[xMin, xMax, yMin, yMax]` in data units (line y = the y domain; empty without one) */
  chart_range?(): Float64Array;
  chart_set_x_range?(lo: number, hi: number): boolean;
  chart_set_y_range?(lo: number, hi: number): boolean;
  /** Cursor sync: hover at a data x (same layout as `chart_hover_at_ndc`) */
  chart_hover_at_data_x?(x: number): Float64Array;
  /** Data x of the current hover's primary point (NaN = none) */
  chart_hover_x?(): number;
  /** Range selector strip: `style` = 5 rgba (background, mask, window, outline, handle; NaN = default) */
  set_chart_navigator?(enabled: boolean, heightPx: number, style: Float32Array): void;
  /** 0 none, 1 window, 2 left handle, 3 right handle, 4 strip outside the window */
  chart_navigator_hit?(ndcX: number, ndcY: number): number;
  chart_navigator_drag?(code: number, deltaNdcX: number): boolean;
  chart_navigator_center?(ndcX: number): boolean;
  chart_navigator_zoom?(factor: number, ndcX: number): boolean;
  /** `[left, top, width, height]` CSS px, empty without a navigator */
  chart_navigator_rect?(): Float32Array;
  set_chart_annotations?(
    kinds: Uint8Array,
    coords: Float64Array,
    colors: Float32Array,
    widths: Float32Array,
    dash: Float32Array,
    opacity: Float32Array,
    layers: Uint8Array,
    labelPositions: Uint8Array
  ): void;
  clear_chart_annotations?(): void;
  chart_annotation_labels_revision?(): number;
  /** `[count, (id, x_css, y_css, visible) * count]` */
  chart_annotation_labels?(): Float64Array;
  /** Live brush from NDC (ax, ay) to (bx, by); `mode` 0 = x, 1 = xy; false outside 2D charts */
  chart_brush?(mode: number, ax: number, ay: number, bx: number, by: number): boolean;
  /** Commits the live brush; selection encoding as `chart_selection` */
  chart_brush_end?(): Float64Array;
  /** Selects a data rectangle (NaN y = x interval); selection encoding as `chart_selection` */
  chart_select_range?(x0: number, x1: number, y0: number, y1: number): Float64Array;
  /** `[kind, mode, x0, x1, y0, y1, count, n, (series, start, end) * n]` or empty */
  chart_selection?(): Float64Array;
  /** Selected scatter point ids / bar categories */
  chart_selection_ids?(): Uint32Array;
  chart_clear_selection?(): void;
  /** `[fill rgba, border rgba, border_px, dash_px]` (NaN = default) */
  set_chart_brush_style?(params: Float32Array): void;
  /** Heatmap grid (row-major, NaN = empty); `xExtent` / `yExtent` empty = categorical (see chart-heatmap.ts) */
  set_heatmap_chart?(
    cols: number,
    rows: number,
    values: Float32Array,
    width: number,
    height: number,
    row0Top: boolean,
    xExtent: Float64Array,
    yExtent: Float64Array
  ): number;
  /** `kind` 0 sequential, 1 viridis, 2 magma, 3 diverging; empty `hue` / `empty` = defaults */
  set_chart_heatmap_colormap?(kind: number, hue: Float32Array, reverse: boolean, surface: Float32Array, empty: Float32Array): void;
  /** NaN = from the data */
  set_chart_heatmap_domain?(min: number, max: number, center: number): void;
  /** `[lo, hi, center (NaN = sequential), count, (value, t) * count]` */
  chart_heatmap_colorbar?(): Float64Array;
  /** `256 * 4` RGBA8 bytes, low -> high */
  chart_heatmap_lut?(): Uint8Array;
  /** RGBA8 of the displayed color of `value` */
  chart_heatmap_color?(value: number): Uint8Array;
  /**
   * Sparkline marks (chart-sparkline.ts): RGBA of the last / min / max markers (empty = none),
   * radius CSS px (NaN = 3), band `[lo, hi]` + RGBA (empty = none), y = 0 line RGBA (empty = none)
   */
  set_chart_sparkline?(
    last: Float32Array,
    min: Float32Array,
    max: Float32Array,
    radiusPx: number,
    band: Float64Array,
    bandColor: Float32Array,
    zeroLine: Float32Array
  ): void;
  clear_chart_sparkline?(): void;
  /** Line / area series styles, 18 floats per series (chart-linestyle.ts / lib_linestyle.rs) */
  set_line_series_styles?(styles: Float32Array): boolean;
  /** Range band of a line series: lower / upper per sample, fill opacity (NaN = 0.2) */
  set_line_series_band?(series: number, lower: Float32Array, upper: Float32Array, opacity: number): void;
  set_band_series?(series: number, lower: Float32Array, upper: Float32Array, opacity: number, lowerWidth: number, upperWidth: number): void;
  set_error_bar_series?(series: number, low: Float32Array, high: Float32Array, style: Float32Array): void;
  set_impulse_series?(series: number, baseline: number, showMarker: boolean, symbolSize: number): void;
  clear_line_series_band?(series: number): void;
  /** `[lower, upper]` of a series band at a live sample index, or empty */
  chart_line_band_at?(series: number, index: number): Float64Array;
  /** `[count, first, last, min, max, firstIndex, lastIndex, minIndex, maxIndex, changePct]` or empty */
  chart_sparkline_summary?(): Float64Array;
  /** Combo chart (chart-combo.ts / lib_combo.rs): flat values, kinds 0 bar / 1 line / 2 area, axes 0 left / 1 right */
  set_combo_chart?(
    values: Float32Array,
    seriesCount: number,
    kinds: Uint8Array,
    axes: Uint8Array,
    colors: Float32Array,
    widths: Float32Array,
    x: Float64Array,
    layout: Float32Array,
    yAxes: Float64Array
  ): number;
  /** `[min, max]` of a combo y axis (0 left, 1 right), or empty */
  chart_combo_y_domain?(axis: number): Float64Array;
  /** Box plot: group `g` owns `counts[g]` samples of `values` (see chart-boxplot.ts / lib_boxplot.rs) */
  set_box_chart?(
    values: Float32Array,
    counts: Uint32Array,
    seriesCount: number,
    categories: number,
    colors: Float32Array,
    layout: Float32Array,
    options: Float64Array
  ): number;
  /** `[n, min, q1, median, q3, max, mean, std, whiskerLo, whiskerHi, outliers] * groups` */
  chart_box_stats?(): Float64Array;
  /** Drawn (sampled) outliers of a group, ascending */
  chart_box_outliers?(group: number): Float32Array;
  /** `[lo, hi, bandwidth, density * 128]` of a violin group */
  chart_box_kde?(group: number): Float64Array;
  /** Pie / donut (chart-pie.ts): values >= 0; `maxSlices` < 0 = default, 0 = no folding; `labels` 0 none, 1 outside, 2 inside */
  set_pie_chart?(
    values: Float64Array,
    sort: number,
    maxSlices: number,
    startAngleDeg: number,
    clockwise: boolean,
    innerRatio: number,
    labels: number,
    labelMinAngleDeg: number,
    labelLinePx: number,
    labelSpaceX: number,
    labelSpaceY: number
  ): number;
  /** RGBA floats: palette (display order), per-value colors (NaN = palette), other / leader / surface */
  set_chart_pie_style?(palette: Float32Array, colors: Float32Array, other: Float32Array, leader: Float32Array, surface: Float32Array): void;
  /** 8 per slice: `[source (-1 = Other), value, percent, visible, r, g, b, a]` */
  chart_pie_slices?(): Float64Array;
  /** Input indices folded into "Other" */
  chart_pie_other?(): Uint32Array;
  /** `[revision, count, (slice, x, y, side) * count]` (CSS px) */
  chart_pie_labels?(): Float64Array;
  /** `[cx, cy, outer r, inner r, visible total, hovered (-1)]` (CSS px) */
  chart_pie_layout?(): Float64Array;
  /** Radar (chart-radar.ts): values flat `[series * axes + axis]` (NaN = missing); NaN = default for optional floats */
  set_radar_chart?(
    axes: number,
    series: number,
    values: Float64Array,
    colors: Float32Array,
    max: number,
    axisMax: Float64Array,
    rings: number,
    fillOpacity: number,
    strokePx: number,
    markerRadiusPx: number,
    startAngleDeg: number,
    grid: number,
    labelSpaceX: number,
    labelSpaceY: number
  ): number;
  set_chart_radar_colors?(colors: Float32Array): void;
  /** `[max, step, ring count, rings..., axis max...]` */
  chart_radar_scale?(): Float64Array;
  /** `[revision, count, (kind, index, value, x, y, h_align, v_align) * count]` */
  chart_radar_labels?(): Float64Array;
  /** `[cx, cy, r, hovered axis (-1)]` */
  chart_radar_layout?(): Float64Array;
  /** Gauge (chart-gauge.ts): bands `[from, to] * n`, RGBA * n, labeled flags; style = track, progress, needle, surface RGBA */
  set_gauge_chart?(
    value: number,
    min: number,
    max: number,
    startAngleDeg: number,
    endAngleDeg: number,
    thickness: number,
    indicator: number,
    bandRanges: Float64Array,
    bandColors: Float32Array,
    bandLabeled: Uint8Array,
    style: Float32Array,
    labelSpaceX: number,
    labelSpaceY: number
  ): number;
  set_chart_gauge_value?(value: number): boolean;
  set_chart_gauge_style?(style: Float32Array): void;
  /** Band colors by input index (RGBA * n) */
  set_chart_gauge_band_colors?(colors: Float32Array): void;
  /** `[(input index, from, to) * bands]` in drawing order */
  chart_gauge_bands?(): Float64Array;
  /** `[revision, count, (kind, index, x, y, h_align, v_align) * count]` (kind 0 min, 1 max, 2 value, 3 band) */
  chart_gauge_labels?(): Float64Array;
  /** `[cx, cy, outer r, inner r, value, angle deg, band (-1), hovered id (-1)]` */
  chart_gauge_layout?(): Float64Array;
  /** Funnel (chart-funnel.ts): orientation 0 / 1, shape 0 trapezoid / 1 bar */
  set_funnel_chart?(values: Float64Array, colors: Float32Array, orientation: number, shape: number, minWidth: number, labelSpace: number): number;
  set_chart_funnel_colors?(colors: Float32Array): void;
  /** `[(value, % of first, % of previous) * stages]` */
  chart_funnel_stages?(): Float64Array;
  /** `[revision, count, (stage, x, y, h_align, v_align) * count]` */
  chart_funnel_labels?(): Float64Array;
  /** Waterfall (chart-waterfall.ts): totals 1 = total bar; style = increase, decrease, total, connector RGBA */
  set_waterfall_chart?(
    values: Float64Array,
    totals: Uint8Array,
    orientation: number,
    connectors: boolean,
    cornerRadiusPx: number,
    style: Float32Array,
    connectorDashPx: number,
    width: number,
    height: number
  ): number;
  set_chart_waterfall_style?(style: Float32Array, connectorDashPx: number): void;
  /** `[(kind 0 increase / 1 decrease / 2 total, value, start, end) * items]` */
  chart_waterfall_items?(): Float64Array;
  /** Treemap / sunburst (chart-hierarchy.ts / lib_hierarchy.rs): parent per node (-1 root), leaf values; options NaN = default */
  set_treemap_chart?(parents: Int32Array, values: Float64Array, options: Float64Array): number;
  set_sunburst_chart?(parents: Int32Array, values: Float64Array, options: Float64Array): number;
  /** Sankey: links by node index; columns / groups empty or one per node (< 0 = auto / none) */
  set_sankey_chart?(
    nodeCount: number,
    sources: Uint32Array,
    targets: Uint32Array,
    values: Float64Array,
    columns: Int32Array,
    groups: Int32Array,
    options: Float64Array
  ): number;
  /** RGBA floats: palette, per-node colors (NaN = auto), other / surface / highlight; value colormap code */
  set_chart_hierarchy_style?(palette: Float32Array, colors: Float32Array, other: Float32Array, surface: Float32Array, highlight: Float32Array, colormap: number): void;
  /** `[node count, tree root, virtual root (0 / 1), current root]` */
  chart_hierarchy_info?(): Float64Array;
  chart_hierarchy_values?(): Float64Array;
  /** Shown children of a node, largest first */
  chart_hierarchy_children?(node: number): Uint32Array;
  /** 4 floats per node */
  chart_hierarchy_colors?(): Float32Array;
  /** 5 per entry: `[group node (-1 = Other), r, g, b, a]` */
  chart_hierarchy_legend?(): Float64Array;
  /** `[revision, count, (node, x, y, w, h, flags) * count]` (CSS px) */
  chart_hierarchy_labels?(): Float64Array;
  /** `[root, plot l, t, w, h, center x, y, r, hovered series (-1), hovered index]` */
  chart_hierarchy_layout?(): Float64Array;
  chart_hierarchy_drill_target?(node: number): number;
  set_chart_hierarchy_root?(node: number): boolean;
  /** Hovers node (series 0) / sankey link (series 1) directly; `chart_hover_at_ndc` layout */
  chart_hover_hierarchy_item?(series: number, index: number): Float64Array;
  /** 8 per node: `[column, value, inflow, outflow, x0, y0, x1, y1]` */
  chart_sankey_nodes?(): Float64Array;
  /** 4 per link: `[source, target, value, percent of source]` */
  chart_sankey_links?(): Float64Array;
  /** Bars (chart-bar-style.ts): orientation 0 / 1, errors by bar id (NaN = none), RGBA, width px, cap (NaN = default) */
  set_bar_style?(
    orientation: number,
    errorMinus: Float32Array,
    errorPlus: Float32Array,
    errorColor: Float32Array,
    errorWidthPx: number,
    errorCap: number
  ): boolean;
  /** Bar data labels: mode 0 off / 1 show / 2 auto, position code, text width per bar id (NaN = none), height, pad */
  set_bar_labels?(mode: number, position: number, widths: Float32Array, height: number, padPx: number): boolean;
  /** `[revision, count, (bar id, x, y, inside) * count]` (CSS px, text box centers) */
  chart_bar_labels?(): Float64Array;
  /** Releases the WASM engine (wasm-bindgen) */
  free?(): void;
}

/** One shared module instantiation: concurrent `create()` / `CharturboDevice.create()` await it */
let wasmInit: Promise<unknown> | null = null;

/**
 * Where the WebAssembly module is loaded from: a URL (`string` / `URL` / `Request`), a fetch
 * `Response` (or a promise of one), the module bytes, or a compiled `WebAssembly.Module`.
 */
export type CharturboWasmSource = string | URL | Request | Response | Promise<Response> | BufferSource | WebAssembly.Module;

/** `undefined` = `charturbo_core_bg.wasm` next to the ES module (`new URL(..., import.meta.url)`) */
let wasmSource: CharturboWasmSource | (() => CharturboWasmSource) | undefined;

/**
 * Overrides where the WASM module is loaded from (e.g. a CDN URL, or bytes for a bundler that
 * does not emit `new URL('...', import.meta.url)` assets). Call before the first `create()` /
 * `CharturboDevice.create()`; ignored once the module is loaded. The `charturbo/inline` entry and
 * the UMD build embed the module and need no source. A `Response` is single-use: after a failed
 * load, call `setWasmSource` again before retrying (URLs, bytes and modules are reused as is).
 */
export function setWasmSource(source: CharturboWasmSource): void {
  wasmSource = source;
}

/** Internal (the `/inline` entry): a source resolved on first load, not at import. */
export function setWasmSourceLazy(source: () => CharturboWasmSource): void {
  wasmSource = source;
}

function initArgs(): { module_or_path: CharturboWasmSource } | undefined {
  const source = typeof wasmSource === 'function' ? wasmSource() : wasmSource;
  return source === undefined ? undefined : { module_or_path: source };
}

/** Loads the WASM module once (reset on failure so a later call can retry). */
export async function loadWasm(): Promise<void> {
  try {
    await (wasmInit ??= initWasm(initArgs()));
  } catch (err) {
    wasmInit = null;
    throw new CharturboInitError('wasm', `Failed to load the WebAssembly module: ${err instanceof Error ? err.message : String(err)}`, err);
  }
}

const EMPTY_F32 = new Float32Array(0);
const EMPTY_U16 = new Uint16Array(0);
const EMPTY_U32 = new Uint32Array(0);
const EMPTY_F64 = new Float64Array(0);

/** `set_chart_y_domain` autoscale codes. */
const Y_AUTOSCALE_CODES: Record<NonNullable<LineYDomainOptions['autoscale']>, number> = { all: 0, visible: 1, none: 2 };

/** Series `x` input as f64 (`Date` = epoch ms). */
function toF64(x: Float64Array | number[] | Date[]): Float64Array {
  if (x instanceof Float64Array) return x;
  const out = new Float64Array(x.length);
  for (let k = 0; k < x.length; k++) out[k] = Number(x[k]);
  return out;
}


const hex = (h: string, a = 1): RgbaTuple => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};

/**
 * Built-in themes. Series palettes are validated for color-vision deficiency against their own
 * surface (dark steps vs the dark surface, light steps vs the light surface).
 */
export const CHARTURBO_THEMES: Record<'dark' | 'light', CharturboTheme> = {
  dark: {
    name: 'dark',
    surface: [0.035, 0.045, 0.08, 1],
    palette: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'].map((c) => hex(c)),
    grid: [0.13, 0.17, 0.24, 1],
    baseline: [0.36, 0.42, 0.52, 1],
    crosshair: [0.58, 0.64, 0.72, 0.55],
    textPrimary: '#f0efec',
    textSecondary: '#c3c2b7',
    textMuted: '#8b8a84',
    tooltipBackground: 'rgba(10, 15, 28, 0.94)',
    tooltipBorder: 'rgba(148, 163, 184, 0.35)',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  light: {
    name: 'light',
    surface: hex('#fcfcfb'),
    palette: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'].map((c) => hex(c)),
    grid: hex('#e7e6e1'),
    baseline: hex('#a3a29c'),
    crosshair: hex('#52514e', 0.45),
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    textMuted: '#7c7b76',
    tooltipBackground: 'rgba(255, 255, 255, 0.97)',
    tooltipBorder: 'rgba(11, 11, 11, 0.14)',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
};

/** DOM layer over the canvas: title, legend, axis labels and titles. */
interface ChartOverlay {
  root: HTMLDivElement;
  title: HTMLDivElement;
  legend: HTMLDivElement;
  xTitle: HTMLDivElement;
  yTitle: HTMLDivElement;
  /** Right y axis title (dual-axis line charts) */
  y2Title: HTMLDivElement | null;
  ticks: HTMLDivElement[];
  /** Axes revision the labels were laid out for (-1 = never) */
  axesRevision: number;
  /** Annotation labels (chart-annotations.ts) */
  annotations: AnnotationLabelLayer;
  /** Heatmap colorbar (chart-heatmap.ts) */
  colorbar?: HeatmapColorbarLayer;
  /** Pie slice labels / donut center (chart-pie.ts) */
  pie?: PieLabelLayer;
  /** Treemap / sunburst / sankey labels, breadcrumb, sunburst center (chart-hierarchy.ts) */
  hierarchy?: HierarchyLabelLayer;
  /** Bar data labels (chart-bar-style.ts) */
  bars?: BarLabelLayer;
  /** Radar / gauge / funnel / waterfall labels (chart-business.ts) */
  business?: BusinessLabelLayer;
}

/** Overlay content the SDK keeps for the active chart. */
interface ChartPresentation {
  title?: string;
  xAxis: ChartAxisOptions;
  yAxis: ChartAxisOptions;
  /** Right y axis (dual-axis 2D line charts only) */
  y2Axis?: ChartAxisOptions;
  legend: Required<ChartLegendOptions>;
  /** 2D line chart: wheel / drag navigate the x axis */
  navigable: boolean;
  /** Scatter: navigation zooms / pans the y axis too */
  zoomY?: boolean;
  /** `granularity`: engine time-tick code (0 = not a time tick) */
  formatX: (value: number, granularity?: number) => string;
  /** Author description for assistive tech (see chart-a11y.ts) */
  description?: string;
  /** Chart-level locale override (line `locale` option); else the SDK locale */
  locale?: string;
  /** Chart-level time zone override (`timeZone` option); else the SDK zone */
  timeZone?: CharturboTimeZone;
}

/** Display metadata the SDK keeps for tooltips; the data itself lives in the engine. */
interface LineChartMeta {
  kind: 'line';
  names: string[];
  colors: RgbaTuple[];
  /**
   * Series values for tooltips / a11y: the caller's arrays (render / `setSeriesData`), or, for
   * series in `stale` (streamed by `appendSeriesData`), re-read from the engine on demand.
   */
  values: (Float32Array | number[])[];
  /** Global id of each series' first sample (re-based by every data update) */
  offsets: number[];
  /** Current sample count of each series */
  lengths: number[];
  /** Series whose data lives only in the engine until `syncedChartMeta` re-reads it */
  stale: Set<number>;
  xPrefix: string;
  /** Series `x` (null = index placement) and its tooltip / details label */
  xs: Float64Array[] | null;
  /** Current y domain options (`setYDomain` merges into them) */
  yDomain: LineYDomainOptions;
  /** Right y domain options (`setY2Domain` merges into them) */
  y2Domain: LineYDomainOptions;
  formatXValue: (x: number) => string;
  visible: boolean[];
  /** Area charts: stacking mode (tooltips add totals / shares); `values` stay the raw input */
  area?: 'overlap' | 'stacked' | 'percent';
  /** Range band arrays per series (`null` = none); tooltips read the engine's live copy */
  bands?: (LineBandMeta | null)[];
  standaloneBand?: boolean;
  sparse?: SparseMeta;
}

interface BarChartMeta {
  kind: 'bar';
  colors: RgbaTuple[];
  metadata: NodeMetadata[];
  /** `legend` option: distinct item categories and their first bar color */
  legendKey?: { name: string; color: RgbaTuple }[];
  /** Uploaded values (data labels) */
  values?: Float32Array;
  /** Orientation, labels, error bars (chart-bar-style.ts) */
  barStyle?: BarStyleState;
  /** Static legend entry of a single-series chart */
  legendEntry?: { name: string; color: RgbaTuple };
}

/** Multi-series bars: ids = series * categories.length + category. */
interface MultiBarChartMeta {
  kind: 'bar-multi';
  mode: 'grouped' | 'stacked' | 'percent';
  names: string[];
  colors: RgbaTuple[];
  categories: string[];
  /** Flat `[series * categories.length + category]` */
  values: Float32Array;
  visible: boolean[];
  /** The engine ignores series visibility in the 3D matrix view */
  viewMode: '2d' | '3d';
  /** Orientation, labels, error bars (chart-bar-style.ts) */
  barStyle?: BarStyleState;
}

interface ScatterChartMeta {
  kind: 'scatter';
  /** Name / color / visibility per series id */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  x: Float32Array;
  y: Float32Array;
  series: Uint16Array | null;
  /** Per-point RGBA (`4 * N`) or null */
  pointColors: Float32Array | null;
}

/** Candlestick chart: candle id = index; the OHLC arrays are the caller's (or converted copies). */
interface CandleChartMeta {
  kind: 'candle';
  mode: 'candlestick' | 'ohlc';
  /** One pseudo-series (legend / visibility APIs treat it as a fixed single series) */
  names: string[];
  /** `[up, down]` */
  colors: RgbaTuple[];
  visible: boolean[];
  /** Candle x (null = index placement) */
  t: Float64Array | null;
  open: ArrayLike<number>;
  high: ArrayLike<number>;
  low: ArrayLike<number>;
  close: ArrayLike<number>;
  volume: ArrayLike<number> | null;
  /** Tooltip / details label of an x value */
  formatXValue: (x: number) => string;
  /** Up / down colors follow the theme (not given by the caller) */
  themedColors: { up: boolean; down: boolean };
  /** Style array last sent to the engine (theme re-applies it with new colors) */
  style: Float32Array;
}

type ChartMeta =
  | LineChartMeta
  | BarChartMeta
  | MultiBarChartMeta
  | ScatterChartMeta
  | CandleChartMeta
  | HeatmapChartMeta
  | BoxChartMeta
  | PieChartMeta
  | ComboChartMeta
  | BusinessChartMeta
  | HierarchyChartMeta
  | SankeyChartMeta;

/** Fill of scatter point `i`: its own color, else its series color. */
function scatterPointColor(meta: ScatterChartMeta, i: number): RgbaTuple {
  const c = meta.pointColors;
  if (c) return [c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3]];
  const s = meta.series?.[i] ?? 0;
  return meta.colors[s] ?? meta.colors[0];
}

/** Brush selection kind of a chart mode (`null`: no brush, e.g. pies and hierarchy charts). */
function selectionKind(mode: Charturbo['chartMode']): CharturboSelection['kind'] | null {
  return mode === null || mode === 'pie' || mode === 'treemap' || mode === 'sunburst' || mode === 'sankey' ? null : mode;
}

function rgbaToCss(c: RgbaTuple): string {
  const [r, g, b] = c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255));
  return `rgb(${r}, ${g}, ${b})`;
}

/** Distinct `category` values of single-series bar items with their first bar color. */
function barLegendKey(items: BarChartItemDescriptor[], colors: RgbaTuple[]): { name: string; color: RgbaTuple }[] {
  const seen = new Map<string, RgbaTuple>();
  items.forEach((item, i) => {
    if (item.category !== undefined && !seen.has(item.category)) seen.set(item.category, colors[i]);
  });
  return [...seen].map(([name, color]) => ({ name, color }));
}

/** Default tooltip value (`locale`: `setLocale`; default: the runtime locale). */
function formatChartValue(v: number, locale?: string): string {
  return v.toLocaleString(locale, { maximumFractionDigits: 2 });
}

/** `chart_axes` granularity codes (0 = not a time tick). */
const TIME_GRANULARITIES: (ChartTimeGranularity | undefined)[] = [
  undefined,
  'millisecond',
  'second',
  'minute',
  'hour',
  'day',
  'month',
  'year',
];

const TIME_LABEL_FORMATS: Record<ChartTimeGranularity | 'full' | 'fullMs' | 'date', Intl.DateTimeFormatOptions> = {
  millisecond: { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23' },
  second: { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
  minute: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  hour: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
  day: { month: 'short', day: 'numeric' },
  month: { month: 'short' },
  year: { year: 'numeric' },
  date: { year: 'numeric', month: 'short', day: 'numeric' },
  full: { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' },
  fullMs: {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hourCycle: 'h23',
  },
};

const timeFormatCache = new Map<string, Intl.DateTimeFormat>();

/**
 * Default time label of epoch ms `ms` in `timeZone` (default `'UTC'`; charts pass their zone,
 * whose boundaries the engine aligns ticks to): by tick granularity (`HH:mm`, `MMM d`, `MMM`,
 * `yyyy`, ...), or the full date + time without one (date only at local midnight, milliseconds
 * only when present).
 */
export function formatChartTime(
  ms: number,
  granularity?: ChartTimeGranularity,
  locale?: string,
  timeZone: CharturboTimeZone = 'UTC'
): string {
  // Outside the ECMAScript Date range Intl throws: show the raw number instead
  if (!(Math.abs(ms) <= 8.64e15)) return String(ms);
  const key: keyof typeof TIME_LABEL_FORMATS =
    granularity ?? (isLocalMidnight(timeZone, ms) ? 'date' : ms % 1000 !== 0 ? 'fullMs' : 'full');
  const cacheKey = `${locale ?? ''}|${key}|${timeZone}`;
  let fmt = timeFormatCache.get(cacheKey);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { ...TIME_LABEL_FORMATS[key], timeZone: intlTimeZone(timeZone) });
    timeFormatCache.set(cacheKey, fmt);
  }
  return fmt.format(ms);
}

/** Default y tick label: compact for large magnitudes (12K, 3.4M). */
function formatTickValue(v: number, locale?: string): string {
  return Math.abs(v) >= 10_000
    ? v.toLocaleString(locale, { notation: 'compact', maximumFractionDigits: 1 })
    : v.toLocaleString(locale, { maximumFractionDigits: 4 });
}

/** `CharturboThemeInput` with every GPU color token parsed to a tuple. */
function resolveTheme(t: CharturboTheme | CharturboThemeInput): CharturboTheme {
  return {
    ...t,
    surface: parseColor(t.surface),
    palette: t.palette.map(parseColor),
    grid: parseColor(t.grid),
    baseline: parseColor(t.baseline),
    crosshair: parseColor(t.crosshair),
  };
}

/** Flat parameter layout of `set_chart_hover_style` (NaN = engine default). */
function encodeHoverStyle(h: ChartHoverStyle = {}): Float32Array {
  const flag = (v: boolean | undefined) => (v === undefined ? NaN : v ? 1 : 0);
  const color = (c: ColorInput | undefined) => parseOptionalColor(c) ?? [NaN, NaN, NaN, NaN];
  return new Float32Array([
    h.mode === 'nearest' ? 1 : 0,
    flag(h.crosshair),
    ...color(h.crosshairColor),
    h.crosshairWidth ?? NaN,
    flag(h.marker),
    h.markerRadius ?? NaN,
    ...color(h.markerRingColor),
    h.markerRingWidth ?? NaN,
    h.barHighlightColor ? 1 : 0,
    ...color(h.barHighlightColor),
    h.hitRadius ?? NaN,
  ]);
}

/** Flat parameter layout of `set_chart_frame_style` (NaN = engine default). */
function encodeGridStyle(show: boolean, g: ChartGridStyle = {}): Float32Array {
  const color = (c: ColorInput | undefined) => parseOptionalColor(c) ?? [NaN, NaN, NaN, NaN];
  return new Float32Array([
    show ? 1 : 0,
    g.rows ?? NaN,
    ...color(g.color),
    ...color(g.baselineColor),
    g.strokeWidth ?? NaN,
  ]);
}

function encodePrimitiveShape(shape: PrimitiveShape): number {
  switch (shape) {
    case 'box':
      return 0;
    case 'sphere':
      return 1;
    case 'plane':
      return 2;
    case 'cylinder':
      return 3;
  }
}

function encodeBodyType(bodyType: RigidBodyType): number {
  switch (bodyType) {
    case 'static':
      return 0;
    case 'dynamic':
      return 1;
    case 'kinematic':
      return 2;
  }
}

function encodeLayoutPreset(mode: LayoutPresetMode): number {
  switch (mode) {
    case 'cluster-sphere':
      return 0;
    case 'radial-shells':
      return 1;
    case 'helix':
      return 2;
    case 'grid-3d':
      return 3;
  }
}

/**
 * High-performance 3D Scene, Physics, Graph & Point-Cloud Engine SDK powered by Rust + wgpu (WebAssembly).
 */
export class Charturbo {
  private readonly backend: WasmCharturboEngineBackend;
  private physicsPending = false;
  private disposed = false;
  private forceOptions: ForceOptions = { ...DEFAULT_SDK_FORCE_OPTIONS };
  private objectRecords = new Map<number, SceneObjectRecord>();
  private nodeMetadataMap = new Map<number, NodeMetadata>();
  private lightingState: Required<SceneLightingDescriptor> = {
    ambientIntensity: 0.32,
    directionalDirection: [0.45, 0.85, 0.55],
    directionalIntensity: 0.95,
    pointPosition: [0, 45, 25],
    pointIntensity: 0.65,
  };
  private helpersState: Required<SceneHelpersDescriptor> = {
    showGrid: false,
    gridSize: 200,
    gridDivisions: 20,
    showAxes: false,
    axesLength: 60,
  };
  private rigidPhysicsState: { enabled: boolean; gravity: Vec3Tuple } = {
    enabled: true,
    gravity: [0, -40, 0],
  };
  private graphVisibleState = true;
  /** Set by chart renderers; switches tooltip / click handling from graph to chart semantics. */
  private chartMode:
    | 'line' | 'band' | 'errorBar' | 'impulse' | 'bar' | 'scatter' | 'candlestick' | 'ohlc' | 'heatmap' | 'box' | 'pie' | 'combo'
    | BusinessChartMeta['kind'] | 'treemap' | 'sunburst' | 'sankey' | null = null;
  private chartMeta: ChartMeta | null = null;
  /** Hide stale tooltips when the chart / scene is replaced. */
  private hoverResetHooks = new Set<() => void>();
  /** Restyle live DOM (tooltips) when the theme changes. */
  private themeHooks = new Set<() => void>();
  /** Detach functions of every `enableNodeInteractions` call (run by `dispose`). */
  private disposers = new Set<() => void>();
  /** Live `enableNodeInteractions` bindings that own touch / pen gestures */
  private touchGestureOwners = 0;
  /** Live `enableNodeInteractions` bindings with built-in camera controls (graph / 3D views) */
  private cameraControlOwners = 0;
  /** Camera distance of the overview framing (`fitToView` / `setCameraPose`): `focusNode` zooms relative to it */
  private overviewDistance: number | null = null;
  /** Camera faces the XY plane (2D scatter / bar): one-finger touch drag pans instead of orbiting */
  private flatCameraView = false;
  private canvas: HTMLCanvasElement | null = null;
  private theme: CharturboTheme = CHARTURBO_THEMES.dark;
  private chartOverlay: ChartOverlay | null = null;
  private chartPresentation: ChartPresentation | null = null;
  /** Annotations of the active chart (reset when the chart is replaced) */
  private chartAnnotations: ChartAnnotation[] = [];
  /** Brush selection mode of chart drags (`false` = drag navigates) */
  private chartBrushMode: BrushMode | false = false;
  private chartBrushStyle: BrushStyleOptions | undefined;
  /** Range selector of the active 2D line / area chart (`null` = none) */
  private chartNavigator: { height: number } | null = null;
  private chartPadding: Required<ChartPaddingOptions> = { top: 16, right: 16, bottom: 32, left: 56 };
  private chartHover: ChartHoverStyle | undefined;
  private chartGrid: ChartGridStyle | undefined;
  private chartGridShown = true;
  /** Locale of default number / time labels and tooltip values (`undefined` = runtime locale) */
  private locale: string | undefined;
  /** Zone of time axes (`setTimeZone`); charts may override it */
  private timeZone: CharturboTimeZone = 'local';
  /**
   * Zone key + UTC range the engine's offset table covers, for the chart whose presentation is
   * `owner` (every chart render makes a new one; the engine starts each chart in UTC)
   */
  private tzCoverage: { key: string; lo: number; hi: number; owner: ChartPresentation | null } | null = null;
  private readonly events = new CharturboEventEmitter<CharturboEventMap>();
  /** Last range seen by `'rangechange'` (null = not captured for the current chart yet) */
  private lastRange: CharturboRange | null = null;
  private readonly rangeFrame = frameThrottle(() => this.flushRangeChange());
  /** SDK-wide animation (`create({ animation })` / `setAnimation`; chart-animation.ts) */
  private animationDefault: ResolvedAnimation | null = null;
  /** Animation the engine currently applies to new charts */
  private animationApplied: ResolvedAnimation | null = null;
  /** rAF loop while the engine animates (created on first use) */
  private animDriverRef: AnimationDriver | null = null;
  /** Set by `enableNodeInteractions`: shows / hides the tooltip of a synced cursor hit */
  private syncTooltip: ((hit: Float64Array | null) => void) | null = null;
  /** Disconnects the `autoResize` observer */
  private stopAutoResize: (() => void) | null = null;
  /** Pending throttled a11y refresh after data updates (streaming) */
  private a11yRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Active sparkline (chart-sparkline.ts): no overlay DOM, label-only a11y */
  private sparkline: SparklineSpec | null = null;
  /** `renderSparkline` is building its chart: `exitChartMode` keeps `sparkline` */
  private sparklineBuilding = false;
  /** Detaches the opt-in sparkline tooltip (`enableNodeInteractions`) */
  private sparklineInteractions: (() => void) | null = null;
  /** Canvas ARIA, keyboard navigation, data table (chart-a11y.ts); reads chart state lazily */
  private readonly a11y = new ChartA11y(() => ({
    canvas: this.canvas,
    overlay: this.chartOverlay?.root ?? null,
    meta: this.syncedChartMeta(),
    presentation: this.chartPresentation,
    locale: this.chartLocale(),
    theme: this.theme,
    backend: this.backend,
    details: (id: number) => this.getNodeDetails(id),
    render: () => this.render(),
    chartTooltip: (hit: Float64Array) => this.a11yChartTooltip(hit),
    label: this.sparkline ? this.sparklineAriaLabel() : null,
  }));

  private constructor(backend: WasmCharturboEngineBackend) {
    this.backend = backend;
  }

  /**
   * Loads the WASM module and starts the engine on `canvas` (WebGPU, else WebGL2). Throws a
   * `CharturboInitError` whose `reason` says what is missing (see `isSupported()` to check first).
   */
  static async create(
    canvas: HTMLCanvasElement,
    options?: {
      seed?: number;
      nodeCount?: number;
      edgeCount?: number;
      clusterCount?: number;
      /**
       * Keep `canvas.width` / `height` at its CSS size x device pixel ratio (ResizeObserver +
       * DPR changes) and call `resize()` + `render()` on change (default: true). Disable when
       * the host sizes the canvas itself.
       */
      autoResize?: boolean;
      /** Locale of default number / time labels and tooltip values (see `setLocale`) */
      locale?: string;
      /** Zone of time axes, labels, and tooltips (see `setTimeZone`; default `'local'`) */
      timeZone?: CharturboTimeZone;
      /** Joins a cursor / zoom sync group (see `setSync`) */
      sync?: ChartSyncMemberOptions;
      /** Chart enter / update animations (default off; see `setAnimation`) */
      animation?: ChartAnimationInput;
      /**
       * Shared GPU device (`CharturboDevice.create()`): no adapter / device request, cached pipelines,
       * compact buffers — use it for pages with many charts. Graph defaults are 0 nodes / edges
       * on this path. WebGL2 devices need a canvas without a context (see charturbo-device.ts).
       */
      device?: CharturboDevice;
    }
  ): Promise<Charturbo> {
    // Before any engine exists: a bad zone must not leave one behind
    if (options?.timeZone !== undefined) validateTimeZone(options.timeZone);
    if (options?.device) return Charturbo.createOnDevice(canvas, options.device, options);
    await loadWasm();
    let engine: WasmCharturboEngine;
    try {
      engine = await WasmCharturboEngine.create(
        canvas,
        options?.seed ?? 42,
        options?.nodeCount ?? 1000,
        options?.edgeCount ?? 2000,
        options?.clusterCount ?? 8
      );
    } catch (err) {
      const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      if (!gpu && !hasWebGl2()) {
        throw new CharturboInitError('no-webgpu', 'Neither WebGPU nor WebGL2 is available', err);
      }
      throw classifyInitError(err);
    }
    return Charturbo.attach(engine, canvas, options);
  }

  /** Engine on a shared `CharturboDevice` (see `create`'s `device` option). */
  private static createOnDevice(
    canvas: HTMLCanvasElement,
    device: CharturboDevice,
    options: {
      seed?: number;
      nodeCount?: number;
      edgeCount?: number;
      clusterCount?: number;
      autoResize?: boolean;
      locale?: string;
      timeZone?: CharturboTimeZone;
      sync?: ChartSyncMemberOptions;
      animation?: ChartAnimationInput;
    }
  ): Charturbo {
    const engine = device.createEngine(canvas, {
      seed: options.seed ?? 42,
      nodeCount: options.nodeCount ?? 0,
      edgeCount: options.edgeCount ?? 0,
      clusterCount: options.clusterCount ?? 1,
    });
    return Charturbo.attach(engine, canvas, options);
  }

  private static attach(
    engine: WasmCharturboEngineBackend,
    canvas: HTMLCanvasElement,
    options?: { autoResize?: boolean; locale?: string; timeZone?: CharturboTimeZone; sync?: ChartSyncMemberOptions; animation?: ChartAnimationInput }
  ): Charturbo {
    const sdk = new Charturbo(engine);
    if (options?.animation !== undefined) sdk.setAnimation(options.animation);
    sdk.canvas = canvas;
    sdk.locale = options?.locale;
    if (options?.timeZone !== undefined) sdk.setTimeZone(options.timeZone);
    if (options?.sync) sdk.setSync(options.sync);
    if (options?.autoResize ?? true) {
      sdk.stopAutoResize = observeCanvasPixelSize(canvas, (w, h) => {
        sdk.resize(w, h);
        sdk.render();
      });
    }
    return sdk;
  }

  /** Shared GPU device for many engines: same as `CharturboDevice.create(options)`. */
  static createDevice(options?: CharturboDeviceOptions): Promise<CharturboDevice> {
    return CharturboDevice.create(options);
  }

  static fromBackend(backend: WasmCharturboEngineBackend): Charturbo {
    return new Charturbo(backend);
  }

  /**
   * True when this browser can run the engine: a WebGPU adapter is available, or WebGL2 (the
   * engine's fallback backend). `create()` may still fail on a device-level error.
   */
  static isSupported(): Promise<boolean> {
    return isRenderingSupported();
  }

  /**
   * Subscribes to an SDK event (`'hover'`, `'click'`, `'rangechange'`, `'legendtoggle'`,
   * `'themechange'`, `'resize'`); returns the unsubscribe function. Pointer events need
   * `enableNodeInteractions`. Existing option callbacks keep working alongside.
   */
  on<K extends keyof CharturboEventMap>(event: K, handler: (payload: CharturboEventMap[K]) => void): () => void {
    return this.events.on(event, handler);
  }

  off<K extends keyof CharturboEventMap>(event: K, handler: (payload: CharturboEventMap[K]) => void): void {
    this.events.off(event, handler);
  }

  /** Locale of default number / time labels and tooltip values (`undefined` = runtime locale). */
  setLocale(locale: string | undefined): void {
    this.locale = locale;
    const o = this.chartOverlay;
    if (o) {
      // Re-format the tick labels with the new locale
      o.axesRevision = -1;
      o.pie?.invalidate();
      o.business?.invalidate();
      o.hierarchy?.invalidate();
      this.syncBarLabels();
      // Waterfall label texts (and their measured widths) follow the locale
      if (this.chartMeta?.kind === 'waterfall') sendWaterfallLabels(this.backend, this.chartMeta, this.theme.fontFamily);
      this.updateChartOverlay();
    }
  }

  getLocale(): string | undefined {
    return this.locale;
  }

  /** Locale of the active chart's labels: its own override, else the SDK locale. */
  private chartLocale(): string | undefined {
    return this.chartPresentation?.locale ?? this.locale;
  }

  /**
   * Zone of time axes: `'local'` (default, the viewer's zone), `'UTC'`, or an IANA name
   * (`'America/New_York'`). Tick boundaries (local midnight / month start, hours on 23 h / 25 h
   * DST days, +05:30 / +05:45 offsets) and every time label — ticks, tooltips, a11y text, data
   * table / CSV — follow it; a chart's own `timeZone` option wins. Re-renders the active chart.
   * Throws a `RangeError` for a zone the runtime does not know.
   */
  setTimeZone(timeZone: CharturboTimeZone): void {
    validateTimeZone(timeZone);
    this.timeZone = timeZone;
    if (!this.chartMode) return;
    if (this.chartOverlay) this.chartOverlay.axesRevision = -1;
    this.render();
    this.a11y.refresh();
  }

  getTimeZone(): CharturboTimeZone {
    return this.timeZone;
  }

  /** Zone of the active chart's time axis: its own override, else the SDK zone. */
  private chartTimeZone(): CharturboTimeZone {
    return this.chartPresentation?.timeZone ?? this.timeZone;
  }

  /**
   * Keeps the engine's offset table on the chart's zone and covering its time domain (sent on
   * the first frame of a chart, when the zone changes, and when streaming grows the domain past
   * the covered years; zoom / pan stay inside the domain).
   */
  private syncChartTimeZone(): void {
    if (!this.chartMode || !this.backend.set_chart_time_zone) return;
    const tz = this.chartTimeZone();
    const key = timeZoneKey(tz);
    const owner = this.chartPresentation;
    const c = this.tzCoverage?.owner === owner && this.tzCoverage.key === key ? this.tzCoverage : null;
    if (c && c.lo === -Infinity) return;
    const d = this.backend.chart_time_domain?.();
    if (!d || d.length < 2) {
      // No time axis (it never gains one): stop asking for this chart
      this.tzCoverage = { key, lo: -Infinity, hi: Infinity, owner };
      return;
    }
    if (c && d[0] >= c.lo && d[1] < c.hi) return;
    const table = buildTimeZoneTable(tz, d[0], d[1]);
    this.backend.set_chart_time_zone(table.transitions, table.offsets);
    // A table clamped to MAX_YEARS still counts as covering this domain (no per-frame rebuild)
    this.tzCoverage = { key, lo: Math.min(table.lo, d[0]), hi: Math.max(table.hi, d[1] + 1), owner };
  }

  /**
   * Procedural 3D Torus mesh generator for testing/spawning custom indexed meshes.
   */
  static createTorusMesh(
    majorRadius = 8,
    minorRadius = 2.6,
    radialSegments = 18,
    tubularSegments = 32
  ): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);

      for (let i = 0; i <= tubularSegments; i++) {
        const u = (i / tubularSegments) * Math.PI * 2;
        const cosU = Math.cos(u);
        const sinU = Math.sin(u);

        const x = (majorRadius + minorRadius * cosV) * cosU;
        const y = minorRadius * sinV;
        const z = (majorRadius + minorRadius * cosV) * sinU;
        positions.push(x, y, z);

        const nx = cosV * cosU;
        const ny = sinV;
        const nz = cosV * sinU;
        normals.push(nx, ny, nz);
      }
    }

    for (let j = 1; j <= radialSegments; j++) {
      for (let i = 1; i <= tubularSegments; i++) {
        const a = (tubularSegments + 1) * j + i - 1;
        const b = (tubularSegments + 1) * (j - 1) + i - 1;
        const c = (tubularSegments + 1) * (j - 1) + i;
        const d = (tubularSegments + 1) * j + i;
        indices.push(a, b, d, b, c, d);
      }
    }

    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
    };
  }

  get rawBackend(): WasmCharturboEngineBackend {
    return this.backend;
  }

  /**
   * Bulk loads a custom 3D graph or embedding point cloud from flat TypedArrays.
   */
  loadDataset(data: RawGraphData): void {
    this.exitChartMode();
    // New data: the next fitToView / setCameraPose (or first focus) sets the overview again
    this.overviewDistance = null;
    this.backend.load_raw_dataset(
      data.positions,
      data.masses ?? EMPTY_F32,
      data.colors ?? EMPTY_F32,
      data.clusters ?? EMPTY_U16,
      data.edges ?? EMPTY_U32,
      data.edgeWeights ?? EMPTY_F32
    );
  }

  /** The engine drops the chart whenever graph data is (re)loaded; mirror that here. */
  private exitChartMode(): void {
    // The engine drops the old chart's brush selection with it: tell 'select' listeners
    const brushKind = selectionKind(this.chartMode);
    if (brushKind && this.events.has('select') && (this.backend.chart_selection?.()?.length ?? 0) > 0) {
      this.events.emit('select', emptySelection(brushKind));
    }
    this.chartMode = null;
    this.chartMeta = null;
    if (!this.sparklineBuilding) {
      this.sparkline = null;
      // The opt-in sparkline tooltip binding (no chart navigation) must not outlive it
      this.sparklineInteractions?.();
      this.sparklineInteractions = null;
    }
    this.lastRange = null;
    this.rangeFrame.cancel();
    this.tzCoverage = null;
    this.chartPresentation = null;
    this.chartAnnotations = [];
    this.chartNavigator = null;
    this.flatCameraView = false;
    this.removeChartOverlay();
    // The next chart animates per the SDK setting unless its options override it
    this.applyChartAnimation(undefined);
    this.a11y.refresh();
  }

  reloadSeededDataset(seed: number, nodeCount: number, edgeCount: number, clusterCount: number): void {
    this.exitChartMode();
    // New data: the next fitToView / setCameraPose (or first focus) sets the overview again
    this.overviewDistance = null;
    this.backend.reload_dataset(seed, nodeCount, edgeCount, clusterCount);
  }

  exportPositions(): Float32Array {
    return this.backend.export_positions();
  }

  importPositions(positions: Float32Array): void {
    this.backend.import_positions(positions);
  }

  warmup(ticks = 60, dt = 0.016): number {
    return this.backend.warmup(ticks, dt);
  }

  stepPhysics(dt = 0.016): number {
    return this.backend.step_physics(dt);
  }

  /** Whether this device supports the opt-in hybrid GPU graph solver. */
  supportsGpuPhysics(): boolean {
    return !this.disposed && !!this.backend.supports_gpu_physics?.();
  }

  /**
   * Opt-in hybrid graph step: GPU Barnes-Hut repulsion, CPU springs/integration and spatial
   * index. Includes asynchronous GPU readback; after await, picking/export see current positions.
   * Uses CPU physics on WebGL2/older backends. The synchronous stepPhysics() stays CPU-only.
   * Await each step before starting another. Data/force edits during GPU work reject the stale
   * result; camera movement and rendering can continue. Does not render automatically.
   */
  async stepPhysicsAsync(dt = 0.016): Promise<number> {
    if (this.disposed) throw new Error('Engine is disposed');
    if (this.physicsPending) throw new Error('A physics step is already pending');
    if (!this.backend.request_gpu_physics || !this.backend.complete_gpu_physics) return this.stepPhysics(dt);
    this.physicsPending = true;
    try {
      const [ticket, result] = await this.backend.request_gpu_physics(dt);
      if (this.disposed) throw new Error('Engine was disposed during GPU physics');
      return ticket === 0 ? result as number : this.backend.complete_gpu_physics(ticket, result as Float32Array);
    } finally {
      this.physicsPending = false;
    }
  }

  render(): void {
    this.syncChartTimeZone();
    this.backend.sync_and_render();
    this.updateChartOverlay();
    // A new chart / data update may have started an animation: drive it (no idle loop)
    if (this.animationApplied) this.animDriver().kick();
  }

  /**
   * Chart enter / update animations (off by default): `true` / `{ duration, easing }` / `false`.
   * Enter: lines reveal left to right, bars grow from the baseline, points and pie slices fade
   * and scale in. Update (`setSeriesData`, or re-rendering data of the same shape): values,
   * bar heights and pie angles tween. Interpolation runs in the engine over the staged
   * (decimated) marks; charts with more than 50k staged marks skip it. Applies to charts
   * rendered from now on (and the current one); `prefers-reduced-motion: reduce` turns it off.
   * Charts override it with their own `animation` option.
   */
  setAnimation(animation: ChartAnimationInput): void {
    this.animationDefault = resolveAnimation(animation);
    this.applyChartAnimation(undefined);
  }

  /** The SDK-wide animation setting (`null` = off). */
  getAnimation(): ResolvedAnimation | null {
    return this.animationDefault;
  }

  /** True while a chart animation runs. */
  isAnimating(): boolean {
    return !!this.animationApplied && (this.backend.chart_animating?.() ?? false);
  }

  /** Jumps a running chart animation to its final frame (call `render()` to show it). */
  finishAnimation(): void {
    this.animDriverRef?.finish();
  }

  private animDriver(): AnimationDriver {
    return (this.animDriverRef ??= new AnimationDriver(this.backend, () => this.render()));
  }

  /** Engine animation for the next chart: its own option, else the SDK setting. */
  private applyChartAnimation(input: ChartAnimationInput | undefined): void {
    const anim = input === undefined ? this.animationDefault : resolveAnimation(input);
    const next = anim && !prefersReducedMotion() ? anim : null;
    if (sameAnimation(next, this.animationApplied)) return;
    this.animationApplied = next;
    applyAnimation(this.backend, next);
    if (!next) this.animDriverRef?.finish();
  }

  /**
   * Stops the force simulation once the layout is at rest. `sleepThreshold` = mean kinetic
   * energy per (unpinned) node; the layout sleeps after 30 consecutive calm steps (default 0.05).
   */
  setAutoSleep(enabled: boolean, sleepThreshold = 0.05): void {
    this.backend.set_auto_sleep(enabled, sleepThreshold);
  }

  isSleeping(): boolean {
    return this.backend.is_sleeping();
  }

  wakeUp(): void {
    this.backend.wake_up();
  }

  setForceOptions(options: Partial<ForceOptions>): void {
    this.forceOptions = { ...this.forceOptions, ...options };
    const f = this.forceOptions;
    this.backend.set_force_params(
      f.repulsionStrength,
      f.springStiffness,
      f.springRestLength,
      f.centerGravity,
      f.damping,
      f.theta
    );
  }

  setFrustumCulling(enabled: boolean): void {
    this.backend.set_frustum_culling(enabled);
  }

  rotateCamera(deltaYaw: number, deltaPitch: number): void {
    this.backend.rotate_camera(deltaYaw, deltaPitch);
  }

  zoomCamera(delta: number): void {
    this.backend.zoom_camera(delta);
  }

  panCamera(deltaRight: number, deltaUp: number): void {
    this.backend.pan_camera(deltaRight, deltaUp);
  }

  moveCameraLocal(forwardDelta: number, rightDelta: number, upDelta: number): void {
    this.backend.move_camera_local?.(forwardDelta, rightDelta, upDelta);
  }

  rotateCameraLook(deltaYaw: number, deltaPitch: number): void {
    this.backend.rotate_camera_look?.(deltaYaw, deltaPitch);
  }

  setCameraPose(eye: Vec3Tuple, target: Vec3Tuple): void {
    this.backend.set_camera_pose?.(eye[0], eye[1], eye[2], target[0], target[1], target[2]);
    this.overviewDistance = this.getCameraState()?.distance ?? null;
  }

  /**
   * Frames every node: centers the camera on them and sets the distance at which they fill the
   * view from the current direction (the engine fits horizontally and vertically, so wide and
   * tall canvases both fill). Also the overview distance `focusNode` zooms relative to.
   */
  fitToView(): void {
    this.backend.fit_to_view();
    this.overviewDistance = this.getCameraState()?.distance ?? null;
  }

  /**
   * Centers the camera on a node (a chart data point in chart mode) and, in graph / 3D views,
   * moves it closer: by default to 40 % of the overview distance (`fitToView` / `setCameraPose`),
   * never farther than it is (`options.distance` overrides; `false` keeps it). The move is
   * immediate. Returns false for an unknown id.
   */
  focusNode(nodeId: number, options?: FocusNodeOptions): boolean {
    const before = this.chartMode || options?.distance === false ? null : this.getCameraState();
    if (!this.backend.focus_on_node(nodeId)) return false;
    if (!before) return true;
    // No framing yet (camera set by the engine / a host): the current distance is the overview
    this.overviewDistance ??= before.distance;
    const want = options?.distance;
    const goal = typeof want === 'number' ? want : Math.min(before.distance, this.overviewDistance * FOCUS_DISTANCE_RATIO);
    if (Number.isFinite(goal) && goal > 0 && goal !== before.distance) this.backend.zoom_camera(goal - before.distance);
    return true;
  }

  /**
   * Orbit camera pose: target, eye, distance, yaw / pitch, field of view and aspect. `null` on
   * engine builds without the `camera_state` binding.
   */
  getCameraState(): CharturboCameraState | null {
    const c = this.backend.camera_state?.();
    if (!c || c.length < 8) return null;
    const [tx, ty, tz, distance, yaw, pitch, fovY, aspect] = c;
    const cp = Math.cos(pitch);
    return {
      target: [tx, ty, tz],
      eye: [tx + distance * cp * Math.sin(yaw), ty + distance * Math.sin(pitch), tz + distance * cp * Math.cos(yaw)],
      distance,
      yaw,
      pitch,
      fovY,
      aspect,
    };
  }

  resize(width: number, height: number): void {
    this.backend.resize(width, height);
    // Auto-sized sparklines re-fit their plot to the new canvas aspect
    const sp = this.sparkline;
    if (sp && sparklineNeedsRefit(sp, this.canvasCssSize())) this.refitSparkline(sp);
    this.events.emit('resize', { width, height });
  }

  pickNodeAtNdc(ndcX: number, ndcY: number): number | null {
    const id = this.backend.pick_node_at_ndc(ndcX, ndcY);
    return id >= 0 ? id : null;
  }

  boxSelect(minNdcX: number, minNdcY: number, maxNdcX: number, maxNdcY: number): Uint32Array {
    return this.backend.select_box_ndc(minNdcX, minNdcY, maxNdcX, maxNdcY);
  }

  queryRadius(x: number, y: number, z: number, radius: number, maxResults = 100): Uint32Array {
    return this.backend.query_radius(x, y, z, radius, maxResults);
  }

  highlightNeighbors(nodeId: number, hops = 1): Uint32Array {
    return this.backend.select_node_and_neighbors(nodeId, hops);
  }

  selectCluster(clusterId: number): Uint32Array {
    return this.backend.select_cluster(clusterId);
  }

  /** Clears the graph selection and, with a chart shown, its brush selection (see `clearChartSelection`). */
  clearSelection(): void {
    this.backend.clear_selection();
    if (this.chartMode) this.clearChartSelection();
  }

  pinNode(nodeId: number, pinned: boolean): boolean {
    return this.backend.set_node_pinned(nodeId, pinned);
  }

  moveNode(nodeId: number, x: number, y: number, z: number): boolean {
    return this.backend.move_node_to(nodeId, x, y, z);
  }

  nodeCount(): number {
    return this.backend.node_count();
  }

  edgeCount(): number {
    return this.backend.edge_count();
  }

  // ---------------------------------------------------------------------------
  // Graph Node Data Inspection, Metadata, Analytics & Interactive Tooltip API
  // ---------------------------------------------------------------------------

  /**
   * Attaches custom business/domain metadata to nodes by ID.
   */
  setNodeMetadata(
    metadata: Record<number, NodeMetadata> | Map<number, NodeMetadata> | NodeMetadata[]
  ): void {
    this.nodeMetadataMap.clear();
    if (Array.isArray(metadata)) {
      metadata.forEach((meta, idx) => {
        if (meta) this.nodeMetadataMap.set(idx, { ...meta });
      });
    } else if (metadata instanceof Map) {
      for (const [id, meta] of metadata.entries()) {
        this.nodeMetadataMap.set(id, { ...meta });
      }
    } else {
      for (const [key, meta] of Object.entries(metadata)) {
        const id = Number(key);
        if (!Number.isNaN(id) && meta) {
          this.nodeMetadataMap.set(id, { ...meta });
        }
      }
    }
  }

  /**
   * Updates or sets metadata for a single node ID.
   */
  setSingleNodeMetadata(nodeId: number, metadata: NodeMetadata): void {
    const existing = this.nodeMetadataMap.get(nodeId) ?? {};
    this.nodeMetadataMap.set(nodeId, { ...existing, ...metadata });
  }

  /**
   * Retrieves stored metadata for a node ID (or a default generated label if none was registered).
   */
  getNodeMetadata(nodeId: number): NodeMetadata {
    return (
      this.nodeMetadataMap.get(nodeId) ?? {
        label: `Node #${nodeId}`,
      }
    );
  }

  /**
   * Populates realistic domain metadata for all current nodes in the graph (useful for demos or quick inspection).
   */
  generateDefaultMetadata(prefix = 'Service-Node'): void {
    this.nodeMetadataMap.clear();
    const total = this.nodeCount();
    const categories = [
      'API Gateway',
      'Auth Service',
      'Vector DB',
      'Redis Cache',
      'Worker Pod',
      'ML Inference',
      'Event Broker',
      'Storage Shard',
    ];
    const regions = ['ap-northeast-2', 'us-east-1', 'eu-central-1', 'ap-Tokyo-1'];

    for (let id = 0; id < total; id++) {
      const cat = categories[id % categories.length];
      const region = regions[id % regions.length];
      this.nodeMetadataMap.set(id, {
        label: `${prefix}-${String(id).padStart(4, '0')}`,
        category: cat,
        description: `${cat} instance deployed in ${region} cluster mesh`,
        tags: [cat.toLowerCase().replace(/\s+/g, '-'), region, id % 5 === 0 ? 'critical' : 'active'],
        attributes: {
          region,
          latencyMs: Number((1.2 + ((id * 17) % 45) * 0.35).toFixed(2)),
          throughputRps: 120 + ((id * 131) % 4800),
          uptime: `${(99.2 + ((id * 7) % 8) * 0.09).toFixed(2)}%`,
        },
      });
    }
  }

  /**
   * Returns complete live 3D state, topology connectivity, and custom metadata for `nodeId`.
   */
  getNodeDetails(nodeId: number): NodeDetails | null {
    if (this.chartMeta) {
      return this.chartPointDetails(nodeId);
    }
    if (nodeId < 0 || nodeId >= this.nodeCount()) {
      return null;
    }
    const raw = this.backend.get_node_info?.(nodeId);
    const neighborsArr = this.backend.get_node_neighbors?.(nodeId);
    const neighbors = neighborsArr ? Array.from(neighborsArr) : [];
    const meta = this.getNodeMetadata(nodeId);

    if (raw && raw.length >= 12) {
      const clusterId = Math.round(raw[4]);
      return {
        id: nodeId,
        label: meta.label ?? `Node #${nodeId}`,
        position: [raw[0], raw[1], raw[2]],
        mass: raw[3],
        clusterId,
        color: [raw[5], raw[6], raw[7], raw[8]],
        degree: Math.round(raw[9]),
        selected: raw[10] > 0.5,
        pinned: raw[11] > 0.5,
        neighbors,
        metadata: {
          ...meta,
          label: meta.label ?? `Node #${nodeId}`,
          category: meta.category ?? `Cluster ${clusterId}`,
        },
      };
    }

    // Fallback when using a minimal mock backend in unit tests
    const positions = this.exportPositions();
    const base = nodeId * 3;
    const pos: Vec3Tuple =
      base + 2 < positions.length
        ? [positions[base], positions[base + 1], positions[base + 2]]
        : [0, 0, 0];
    return {
      id: nodeId,
      label: meta.label ?? `Node #${nodeId}`,
      position: pos,
      mass: 1.0,
      clusterId: 0,
      color: [0.35, 0.75, 1.0, 1.0],
      degree: neighbors.length,
      selected: false,
      pinned: false,
      neighbors,
      metadata: {
        ...meta,
        label: meta.label ?? `Node #${nodeId}`,
      },
    };
  }

  /** Details of a chart data point (`nodeId` = series offset + sample index, or bar index). */
  private chartPointDetails(id: number): NodeDetails | null {
    const meta = this.chartMeta;
    if (!meta || id < 0) return null;
    const sample = this.backend.chart_sample?.(id);
    const position: Vec3Tuple =
      sample && sample.length >= 6 ? [sample[3], sample[4], sample[5]] : [0, 0, 0];

    let series = 0;
    let metadata: NodeMetadata;
    let color: RgbaTuple;
    if (meta.kind === 'line') {
      while (series + 1 < meta.offsets.length && meta.offsets[series + 1] <= id) series++;
      const index = id - meta.offsets[series];
      const point = this.lineSample(meta, series, index);
      if (!point) return null;
      const name = meta.names[series];
      const value = point.value;
      const prev = index > 0 ? this.lineSample(meta, series, index - 1) : null;
      const delta = prev ? value - prev.value : 0;
      const xs = meta.xs !== null && point.x !== undefined;
      const xText = xs ? meta.formatXValue(point.x!) : `${meta.xPrefix}+${index}`;
      color = meta.colors[series];
      metadata = {
        label: `${name} · ${xText}`,
        category: `Line Series: ${name}`,
        description: xs
          ? `${name} 시계열의 x = ${xText} 샘플 데이터 포인트입니다.`
          : `${name} 시계열의 ${index.toLocaleString()}번째 샘플 데이터 포인트입니다.`,
        tags: [meta.sparse ? `${meta.sparse.kind}-chart` : meta.standaloneBand ? 'band-chart' : 'line-chart', name.toLowerCase()],
        attributes: {
          series: name,
          ...(xs ? { x: xText, index } : { stepIndex: xText }),
          value: Number(value.toFixed(3)),
          delta: `${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`,
        },
      };
      if (meta.standaloneBand) {
        metadata.category = `Band Series: ${name}`;
        metadata.attributes = { series: name, ...(xs ? { x: xText, index } : { stepIndex: xText }),
          ...lineBandAt(this.backend, meta.bands, series, index) };
      }
      if (meta.sparse) {
        metadata.category = `${meta.sparse.kind} Series: ${name}`;
        const info = sparseTooltip(meta.sparse, series, index);
        metadata.attributes = { ...metadata.attributes, ...(info.errorBar ?? { baseline: info.baseline! }) };
      }
    } else if (meta.kind === 'bar-multi') {
      const n = meta.categories.length;
      series = Math.floor(id / n);
      if (series >= meta.names.length) return null;
      const name = meta.names[series];
      const category = meta.categories[id % n];
      const value = meta.values[id];
      color = meta.colors[series];
      metadata = {
        label: `${name} · ${category}`,
        category: name,
        description: `${category} 항목의 ${name} 시리즈 값입니다.`,
        tags: ['bar-chart', meta.mode, name.toLowerCase()],
        attributes: { series: name, category, value: Number(value.toFixed(2)) },
      };
    } else if (meta.kind === 'bar') {
      if (id >= meta.metadata.length) return null;
      metadata = meta.metadata[id];
      color = meta.colors[id];
    } else if (meta.kind === 'candle') {
      if (id >= meta.close.length) return null;
      const num = (v: number) => Number(Number(v).toFixed(4));
      const [o, h, l, c] = [meta.open[id], meta.high[id], meta.low[id], meta.close[id]];
      const xText = meta.formatXValue(meta.t ? meta.t[id] : id);
      color = meta.colors[c >= o ? 0 : 1];
      metadata = {
        label: `Candle · ${xText}`,
        category: 'Candlestick',
        tags: [`${meta.mode}-chart`, c >= o ? 'up' : 'down'],
        attributes: {
          x: xText,
          open: num(o),
          high: num(h),
          low: num(l),
          close: num(c),
          ...(meta.volume ? { volume: num(meta.volume[id]) } : {}),
        },
      };
    } else if (meta.kind === 'box') {
      const b = sample && sample.length >= 3 ? boxTooltipOf(meta, sample[0], sample[1], sample[2], id) : null;
      if (!b) return null;
      series = b.series;
      color = meta.colors[b.series];
      const num = (v: number) => Number(v.toFixed(4));
      metadata = {
        label: `${b.seriesName} · ${b.categoryLabel}${b.outlier !== undefined ? ' · outlier' : ''}`,
        category: b.seriesName,
        tags: [meta.violin ? 'violin-chart' : 'box-plot', b.outlier !== undefined ? 'outlier' : 'box'],
        attributes: {
          series: b.seriesName,
          category: b.categoryLabel,
          ...(b.outlier !== undefined ? { value: num(b.outlier) } : {}),
          n: b.n,
          min: num(b.min),
          q1: num(b.q1),
          median: num(b.median),
          q3: num(b.q3),
          max: num(b.max),
          mean: num(b.mean),
          outliers: b.outliers,
        },
      };
    } else if (meta.kind === 'combo') {
      const c = comboPointMetadata(meta, id);
      if (!c) return null;
      ({ series, color, metadata } = c);
    } else if (meta.kind === 'pie') {
      if (id >= meta.names.length) return null;
      const name = meta.names[id];
      color = meta.colors[id];
      series = id;
      metadata = {
        label: name,
        category: meta.valueLabel,
        tags: ['pie-chart', ...(meta.sources[id] < 0 ? ['other'] : [])],
        attributes: {
          value: Number(meta.values[id].toPrecision(6)),
          percent: Number.isFinite(meta.percents[id]) ? Number(meta.percents[id].toFixed(2)) : 'hidden',
          ...(meta.sources[id] < 0 ? { slices: meta.other.length } : {}),
        },
      };
    } else if (isBusinessMeta(meta)) {
      const d = businessPointMetadata(meta, id);
      if (!d) return null;
      ({ series, color, metadata } = d);
    } else if (meta.kind === 'treemap' || meta.kind === 'sunburst' || meta.kind === 'sankey') {
      const d = hierarchyDetails(meta, id);
      if (!d) return null;
      color = d.color;
      series = d.series;
      metadata = { label: d.label, category: meta.valueLabel, tags: d.tags, attributes: d.attributes };
    } else if (meta.kind === 'heatmap') {
      if (id >= meta.cols * meta.rows) return null;
      const cell = this.heatmapCell(meta, Math.floor(id / meta.cols), id % meta.cols);
      const value = meta.values[id];
      series = cell.row;
      color = bytesToRgba(this.backend.chart_heatmap_color?.(value));
      metadata = {
        label: `${cell.yLabel} · ${cell.xLabel}`,
        category: meta.valueLabel,
        tags: ['heatmap'],
        attributes: { row: cell.row, col: cell.col, x: cell.xLabel, y: cell.yLabel, value: Number.isFinite(value) ? Number(value.toFixed(4)) : 'empty' },
      };
    } else {
      if (id >= meta.x.length) return null;
      series = meta.series?.[id] ?? 0;
      const name = meta.names[series] ?? `Series ${series}`;
      const own = this.nodeMetadataMap.get(id);
      color = scatterPointColor(meta, id);
      metadata = {
        label: `${name} #${id}`,
        category: name,
        tags: ['scatter-chart', name.toLowerCase()],
        ...own,
        attributes: {
          series: name,
          x: Number(meta.x[id].toFixed(4)),
          y: Number(meta.y[id].toFixed(4)),
          ...(own?.attributes ?? {}),
        },
      };
    }
    return {
      id,
      label: metadata.label ?? `#${id}`,
      position,
      mass: 1,
      clusterId: series,
      color,
      degree: 0,
      selected: false,
      pinned: false,
      neighbors: [],
      metadata,
    };
  }

  /**
   * Projects a 3D node's world position into 2D canvas pixel coordinates `{ x, y, ndcZ }`.
   * Returns `null` if the node is behind the camera or out of bounds.
   */
  projectNodeToScreen(
    nodeId: number,
    canvasWidth: number,
    canvasHeight: number
  ): { x: number; y: number; ndcZ: number } | null {
    const ndc = this.backend.project_node_to_ndc?.(nodeId);
    if (!ndc || ndc.length < 3) {
      return null;
    }
    const [ndcX, ndcY, ndcZ] = [ndc[0], ndc[1], ndc[2]];
    const x = (ndcX * 0.5 + 0.5) * canvasWidth;
    const y = (1.0 - (ndcY * 0.5 + 0.5)) * canvasHeight;
    return { x, y, ndcZ };
  }

  /**
   * Batch version of `projectNodeToScreen` (one WASM call for many labels).
   * Returns `[x0, y0, x1, y1, ...]` in canvas pixels; `NaN` for points behind the camera.
   */
  projectNodesToScreen(nodeIds: Uint32Array | number[], canvasWidth: number, canvasHeight: number): Float32Array {
    const ids = nodeIds instanceof Uint32Array ? nodeIds : Uint32Array.from(nodeIds);
    const out = new Float32Array(ids.length * 2);
    const ndc = this.backend.project_nodes_to_ndc?.(ids);
    for (let i = 0; i < ids.length; i++) {
      let nx: number;
      let ny: number;
      if (ndc) {
        nx = ndc[i * 3];
        ny = ndc[i * 3 + 1];
      } else {
        const p = this.projectNodeToScreen(ids[i], canvasWidth, canvasHeight);
        out[i * 2] = p ? p.x : NaN;
        out[i * 2 + 1] = p ? p.y : NaN;
        continue;
      }
      out[i * 2] = (nx * 0.5 + 0.5) * canvasWidth;
      out[i * 2 + 1] = (1 - (ny * 0.5 + 0.5)) * canvasHeight;
    }
    return out;
  }

  /**
   * Computes and highlights the undirected shortest path between `startNodeId` and `endNodeId` via BFS.
   * Returns the ordered sequence of node IDs along the path.
   */
  highlightShortestPath(startNodeId: number, endNodeId: number): Uint32Array {
    return this.backend.select_shortest_path?.(startNodeId, endNodeId) ?? EMPTY_U32;
  }

  /**
   * Dynamically updates a single node's visual style (`color`, `mass`, `clusterId`).
   */
  setNodeStyle(
    nodeId: number,
    style: { color?: RgbaTuple; mass?: number; clusterId?: number }
  ): boolean {
    const current = this.getNodeDetails(nodeId);
    if (!current) return false;
    const c = style.color ?? current.color;
    const m = style.mass ?? current.mass;
    const cluster = style.clusterId ?? current.clusterId;
    return (
      this.backend.set_node_style?.(nodeId, c[0], c[1], c[2], c[3], m, cluster) ?? true
    );
  }

  /**
   * Applies an instant 3D spatial layout preset (`cluster-sphere`, `radial-shells`, `helix`, `grid-3d`).
   */
  applyLayout(mode: LayoutPresetMode, spaceRadius = 85): void {
    this.backend.apply_preset_layout?.(encodeLayoutPreset(mode), spaceRadius);
  }

  /**
   * Generates a realistic multi-cluster `D`-dimensional embedding matrix (`Float32Array` of length `nodeCount * dimensions`)
   * for any dimension `D >= 3` (e.g., 128D, 384D, 768D, 1024D, 1536D, 3072D).
   */
  static generateSyntheticHighDimEmbeddings(
    nodeCount: number,
    dimensions: number,
    clusterCount = 8,
    seed = 42
  ): { vectors: Float32Array; clusters: Uint16Array } {
    const dim = Math.max(3, Math.floor(dimensions));
    const n = Math.max(1, Math.floor(nodeCount));
    const cCount = Math.max(1, Math.floor(clusterCount));
    const vectors = new Float32Array(n * dim);
    const clusters = new Uint16Array(n);

    // Deterministic XorShift32 PRNG
    let state = (seed | 0) !== 0 ? seed >>> 0 : 0x6d2b79f5;
    const nextRand = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return ((state >>> 0) / 4294967296) * 2 - 1;
    };

    // 1. Create cCount distinct D-dimensional semantic prototype vectors
    const prototypes = new Float32Array(cCount * dim);
    for (let c = 0; c < cCount; c++) {
      const base = c * dim;
      for (let d = 0; d < dim; d++) {
        // Give each cluster strong activation in its own frequency band + random subspace
        const bandBoost = d % cCount === c ? 1.85 : 0.0;
        prototypes[base + d] = nextRand() * 0.45 + bandBoost * (nextRand() >= 0 ? 1 : -1);
      }
    }

    // 2. Sample each document vector around its cluster prototype in R^D
    for (let i = 0; i < n; i++) {
      const c = i % cCount;
      clusters[i] = c;
      const protoBase = c * dim;
      const vecBase = i * dim;
      // First vector of each cluster is the exact centroid prototype
      const noiseScale = i < cCount ? 0.02 : 0.28 + ((i * 17) % 10) * 0.025;

      let normSq = 0;
      for (let d = 0; d < dim; d++) {
        const val = prototypes[protoBase + d] + nextRand() * noiseScale;
        vectors[vecBase + d] = val;
        normSq += val * val;
      }
      const invNorm = normSq > 1e-12 ? 1 / Math.sqrt(normSq) : 1;
      for (let d = 0; d < dim; d++) {
        vectors[vecBase + d] *= invNorm;
      }
    }

    return { vectors, clusters };
  }

  /**
   * Projects an arbitrary `D`-dimensional embedding matrix (`vectors.length === N * options.dimensions`,
   * supporting 64D, 128D, 384D, 768D, 1024D, 1536D, 3072D, 4096D+) into 3D space `(x, y, z)`
   * and constructs a cosine-similarity k-NN graph inside Rust WASM.
   */
  loadEmbeddings(
    vectors: Float32Array,
    options: HighDimEmbeddingOptions
  ): { nodeCount: number; edgeCount: number; dimensions: number; elapsedMs: number } {
    const dim = Math.max(3, Math.floor(options.dimensions));
    if (vectors.length === 0 || vectors.length % dim !== 0) {
      throw new Error(`vectors length (${vectors.length}) must be a non-zero multiple of dimensions (${dim})`);
    }
    const proj = options.projection ?? 'pca-umap';
    const projCode = proj === 'random-projection' ? 1 : 0;
    const warmupTicks =
      proj === 'pca-umap' ? (options.umapWarmupTicks ?? 35) : 0;
    const kNeighbors = options.kNeighbors ?? 5;
    const simThreshold = options.similarityThreshold ?? 0.35;
    const clusters = options.clusters ?? EMPTY_U16;
    const radius = options.spaceRadius ?? 85;

    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.exitChartMode();
    // New data: the next fitToView / setCameraPose (or first focus) sets the overview again
    this.overviewDistance = null;
    this.backend.load_high_dim_embeddings?.(
      vectors,
      dim,
      projCode,
      kNeighbors,
      simThreshold,
      clusters,
      warmupTicks,
      radius
    );
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

    return {
      nodeCount: this.nodeCount(),
      edgeCount: this.edgeCount(),
      dimensions: dim,
      elapsedMs,
    };
  }

  /**
   * Queries the top `topK` most similar nodes to `nodeId` using exact `D`-dimensional Cosine Similarity
   * computed directly in the original high-dimensional embedding space (`R^D`).
   */
  queryCosineSimilar(nodeId: number, topK = 8): CosineSimilarityMatch[] {
    // f64 variant keeps ids exact beyond 2^24 nodes
    const raw =
      this.backend.query_cosine_similar_f64?.(nodeId, topK) ??
      this.backend.query_cosine_similar?.(nodeId, topK);
    if (!raw || raw.length < 2) {
      return [];
    }
    const matches: CosineSimilarityMatch[] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const id = Math.round(raw[i]);
      const sim = raw[i + 1];
      const meta = this.getNodeMetadata(id);
      matches.push({
        nodeId: id,
        cosineSimilarity: Number(sim.toFixed(4)),
        label: meta.label ?? `Node #${id}`,
      });
    }
    return matches;
  }

  /**
   * Returns the active high-dimensional embedding dimension `D` (`0` if dataset was loaded as raw 3D coordinates).
   */
  embeddingDimension(): number {
    return this.backend.embedding_dim?.() ?? 0;
  }

  /**
   * Searches nodes by ID, label, category, tag, or attribute value.
   */
  searchNodes(query: string, limit = 25): NodeDetails[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const total = this.nodeCount();
    const matches: NodeDetails[] = [];

    // Direct numeric ID match first
    const directId = Number(q.replace(/^#/, ''));
    if (Number.isInteger(directId) && directId >= 0 && directId < total) {
      const d = this.getNodeDetails(directId);
      if (d) matches.push(d);
    }

    for (let id = 0; id < total && matches.length < limit; id++) {
      if (matches.some((m) => m.id === id)) continue;
      const meta = this.nodeMetadataMap.get(id);
      const label = (meta?.label ?? `Node #${id}`).toLowerCase();
      const category = (meta?.category ?? '').toLowerCase();
      const desc = (meta?.description ?? '').toLowerCase();
      const tagsMatch = meta?.tags?.some((t) => t.toLowerCase().includes(q)) ?? false;

      if (label.includes(q) || category.includes(q) || desc.includes(q) || tagsMatch) {
        const d = this.getNodeDetails(id);
        if (d) matches.push(d);
      }
    }
    return matches;
  }

  /**
   * Binds pointer hover & click interactions to `canvas` so users can immediately inspect node data
   * via a floating tooltip and click callbacks without writing manual raycast/NDC boilerplate.
   * Returns a cleanup function `() => void` to detach listeners and remove the tooltip.
   */
  enableNodeInteractions(
    canvas: HTMLCanvasElement,
    options?: NodeInteractionOptions
  ): () => void {
    this.canvas ??= canvas;
    const showTooltip = options?.builtInTooltip ?? true;
    const chartNavigation = options?.chartNavigation ?? true;
    const neighborHops = options?.highlightNeighborsOnClick ?? 1;
    const focusOnDblClick = options?.focusOnDoubleClick ?? true;
    const autoRender = options?.autoRender ?? false;

    let tooltipEl: HTMLDivElement | null = null;
    if (showTooltip && typeof document !== 'undefined') {
      tooltipEl = document.createElement('div');
      tooltipEl.className = ['charturbo-sdk-node-tooltip', options?.tooltipClassName].filter(Boolean).join(' ');
      Object.assign(
        tooltipEl.style,
        {
          position: 'fixed',
          zIndex: '9999',
          pointerEvents: 'none',
          display: 'none',
          padding: '8px 11px',
          borderRadius: '8px',
          background: this.theme.tooltipBackground,
          border: `1px solid ${this.theme.tooltipBorder}`,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.35)',
          color: this.theme.textPrimary,
          fontFamily: this.theme.fontFamily,
          fontSize: '12px',
          lineHeight: '1.45',
          maxWidth: '280px',
          backdropFilter: 'blur(8px)',
        },
        options?.tooltipStyle ?? {}
      );
      const host = options?.tooltipContainer ?? document.body;
      host.appendChild(tooltipEl);
    }

    const tooltipOptions = options?.tooltip;
    // Invalid `valueFormatter` specs throw here rather than on every hover
    tooltipValueFormatter(tooltipOptions, this.chartLocale());
    /** `tooltip.pin: 'click'`: the tooltip (and the engine hover) stays put until unpinned */
    let clickPinned = false;
    /** Pinned when the current press started (the click toggles the pin off) */
    let pinnedAtDown = false;
    // A press outside the canvas unpins (tooltip pin)
    const onDocPointerDown = (e: Event) => {
      if (e.target !== canvas) releasePinnedHover();
    };
    /** Unpin: hide the tooltip and end the frozen hover (engine, `'hover'` / `onNodeHover` consumers) */
    const releasePinnedHover = () => {
      hideTooltip();
      if (this.chartMode) this.backend.chart_clear_hover?.();
      if (lastHoveredId !== null) {
        lastHoveredId = null;
        canvas.style.cursor = brushing() ? 'crosshair' : 'grab';
        options?.onNodeHover?.(null, lastHoverPointer);
      }
      emitHover(null, null, null);
      if (autoRender) this.render();
    };
    const setClickPinned = (on: boolean) => {
      if (clickPinned === on) return;
      clickPinned = on;
      if (tooltipEl) {
        if (on) tooltipEl.dataset.pinned = 'true';
        else delete tooltipEl.dataset.pinned;
      }
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        if (on) document.addEventListener('pointerdown', onDocPointerDown, true);
        else document.removeEventListener('pointerdown', onDocPointerDown, true);
      }
    };
    const hideTooltip = () => {
      setClickPinned(false);
      if (tooltipEl) tooltipEl.style.display = 'none';
    };
    const restyleTooltip = () => {
      if (!tooltipEl) return;
      Object.assign(
        tooltipEl.style,
        {
          background: this.theme.tooltipBackground,
          border: `1px solid ${this.theme.tooltipBorder}`,
          color: this.theme.textPrimary,
          fontFamily: this.theme.fontFamily,
        },
        options?.tooltipStyle ?? {}
      );
      // The content carries the old theme's inline colors: the next hover renders it again (a
      // pinned tooltip also releases its frozen engine hover)
      if (clickPinned) releasePinnedHover();
      else hideTooltip();
    };
    this.themeHooks.add(restyleTooltip);
    // Scene / chart replaced: drop the stale tooltip
    this.hoverResetHooks.add(hideTooltip);

    let downPos: { x: number; y: number } | null = null;
    let lastHoveredId: number | null = null;
    /** Hover target last reported to `'hover'` listeners (separate: leaving resets it) */
    let lastEmittedHoverId: number | null = null;
    let lastHoverPointer = { clientX: 0, clientY: 0 };
    // Scene / chart replaced: the hovered target is gone
    const resetHoverEvent = () => emitHover(null, null, null);
    this.hoverResetHooks.add(resetHoverEvent);
    const emitHover = (
      id: number | null,
      chart: ChartTooltipContext | null,
      node: NodeDetails | null,
      pointer: { clientX: number; clientY: number } = lastHoverPointer
    ) => {
      if (id === lastEmittedHoverId) return;
      lastEmittedHoverId = id;
      lastHoverPointer = { clientX: pointer.clientX, clientY: pointer.clientY };
      this.events.emit('hover', { chart, node, ...lastHoverPointer });
    };
    let lastPointerType = 'mouse';
    /** Tooltip placed by a touch / pen tap or scrub: survives the pointer leaving */
    let tooltipPinned = false;
    /** Last pointer x while dragging a navigable chart (null = not panning) */
    let panLastX: number | null = null;
    let panLastY = 0;
    const navigating = () => chartNavigation && this.handlesChartNavigation();
    /** Brush mode before this binding set one (restored on detach) */
    const prevBrushMode = options?.brush !== undefined ? this.chartBrushMode : undefined;
    if (options?.brush !== undefined) this.setChartBrush(options.brush, options.brushStyle);
    else if (options?.brushStyle) this.chartBrushStyle = options.brushStyle;
    /** Brush drag start in NDC (null = the drag is not a brush) */
    let brushFrom: [number, number] | null = null;
    /** The brush drag passed the click threshold and drew a rectangle */
    let brushLive = false;
    const brushing = () => this.handlesChartBrush();

    const toNdc = (e: { clientX: number; clientY: number }): [number, number] => {
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
      const ndcY = 1 - ((e.clientY - rect.top) / Math.max(1, rect.height)) * 2;
      return [ndcX, ndcY];
    };

    /** y / box zoom and zoom history (chart-zoom.ts): wheel axes, box drags, Ctrl / Cmd + Z */
    const zoom = createZoomController({
      backend: this.backend,
      axis: validateZoomAxis(options?.zoom),
      mode: validateZoomMode(options?.zoomMode),
      navigating,
      // Heatmaps have no data frame to box
      // Combo y domains are fixed: no box zoom (x wheel / pan / history only)
      boxable: () => this.chartMode !== 'heatmap' && this.chartMode !== 'combo',
      // Candles fit their price axis to the visible candles
      yZoomable: () => this.chartMode === 'line' || this.chartMode === 'band' || this.chartMode === 'errorBar' || this.chartMode === 'impulse' || this.chartMode === 'scatter',
      toNdc,
      changeRange: (apply) => this.changeRange(apply),
      setCursor: (c) => (canvas.style.cursor = c),
      changed: () => {
        if (autoRender) this.render();
      },
      prepareBox: () => {
        if (this.chartBrushStyle) this.backend.set_chart_brush_style?.(encodeBrushStyle(this.chartBrushStyle));
      },
    });
    /** The current drag pan recorded its undo step */
    let panRecorded = false;

    /** Range selector strip (chart-navigator.ts): grabs presses / wheel over it before panning */
    const nav = createNavigatorController({
      active: () => this.chartNavigator !== null && navigating(),
      toNdc,
      canvasWidth: () => canvas.getBoundingClientRect().width,
      hit: (x, y) => this.backend.chart_navigator_hit?.(x, y) ?? 0,
      drag: (code, dx) => this.changeRange(() => this.backend.chart_navigator_drag?.(code, dx)),
      center: (x) => this.changeRange(() => this.backend.chart_navigator_center?.(x)),
      zoom: (f, x) => this.changeRange(() => this.backend.chart_navigator_zoom?.(f, x)),
      setCursor: (c) => (canvas.style.cursor = c),
      restoreCursor: () =>
        (canvas.style.cursor = lastHoveredId !== null ? 'pointer' : brushing() ? 'crosshair' : 'grab'),
      changed: () => {
        if (autoRender) this.render();
      },
      capture: (id) => {
        try {
          canvas.setPointerCapture?.(id);
        } catch {
          // Synthetic / already released pointers cannot be captured
        }
      },
    });
    const resetNav = () => nav.reset();
    this.hoverResetHooks.add(resetNav);

    /** Mouse orbit / pan / wheel zoom of graph / 3D views (camera-controls.ts) */
    const cameraOptions = resolveCameraControls(options?.cameraControls);
    const cameraOwned = cameraOptions.orbit || cameraOptions.pan || cameraOptions.zoom;
    const camera = createCameraControls({
      options: cameraOptions,
      active: () => !this.chartMode,
      rotate: (yaw, pitch) => this.rotateCamera(yaw, pitch),
      pan: (r, u) => this.panCamera(r, u),
      zoom: (d) => this.zoomCamera(d),
      unitsPerPixel: () => {
        const c = this.getCameraState();
        // View-plane height at the target depth / viewport height: the content tracks the pointer
        return c ? (2 * c.distance * Math.tan(c.fovY / 2)) / Math.max(1, canvas.getBoundingClientRect().height) : null;
      },
      distance: () => this.getCameraState()?.distance ?? null,
      viewHeight: () => canvas.getBoundingClientRect().height,
      capture: (id) => {
        try {
          canvas.setPointerCapture?.(id);
        } catch {
          // Synthetic / already released pointers cannot be captured
        }
      },
      setCursor: (c) => (canvas.style.cursor = c),
      changed: () => {
        if (autoRender) this.render();
      },
    });

    /**
     * Places the tooltip next to the pointer, flipping sides near the viewport edges.
     * `aboveFinger`: touch puts it above the contact point so the finger does not cover it.
     */
    const placeTooltip = (clientX: number, clientY: number, aboveFinger = false) => {
      if (!tooltipEl) return;
      tooltipEl.style.display = 'block';
      const w = tooltipEl.offsetWidth;
      const h = tooltipEl.offsetHeight;
      const vw = typeof window !== 'undefined' ? window.innerWidth : Infinity;
      const vh = typeof window !== 'undefined' ? window.innerHeight : Infinity;
      const left = clientX + 14 + w > vw ? clientX - 14 - w : clientX + 14;
      const top = aboveFinger
        ? clientY - 40 - h < 0 ? clientY + 40 : clientY - 40 - h
        : clientY + 14 + h > vh ? clientY - 14 - h : clientY + 14;
      tooltipEl.style.left = `${Math.max(0, left)}px`;
      tooltipEl.style.top = `${Math.max(0, top)}px`;
    };

    const defaultChartTooltip = (ctx: ChartTooltipContext): string => {
      const t = this.theme;
      /** `tooltip.valueFormatter`, else `fallback` (the chart's own value format) */
      const userValue = tooltipValueFormatter(tooltipOptions, this.chartLocale());
      // Formatted values and every data-derived string (series / category names, x labels,
      // attributes, axis titles) are HTML-escaped: they come from user data
      // (raw here: the chart modules' own tooltip builders escape what they interpolate)
      const valueFmt = (fallback: (v: number) => string) => userValue ?? fallback;
      const escFmt = (f: (v: number) => string) => (v: number) => esc(f(v));
      const num = (v: number) => formatChartValue(v, this.chartLocale());
      const yFmt = valueFmt(resolveFormat(this.chartPresentation?.yAxis.format, this.chartLocale()) ?? num);
      const swatch = (color: string) =>
        `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;flex:none;background:${color};"></span>`;
      const rows = ctx.items
        .map(
          (it) => `
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
          <span style="display:flex;align-items:center;color:${t.textSecondary};">${swatch(it.color)}${esc(it.seriesName)}</span>
          <span style="color:${t.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${ctx.chartType === 'band' ? '' : escFmt(valueFmt(num))(it.value)}${
            it.error
              ? ` <span style="color:${t.textMuted};font-weight:400;">${esc(formatBarError(it.error, valueFmt(num)))}</span>`
              : ''
          }${
            it.percent !== undefined ? ` <span style="color:${t.textMuted};font-weight:400;">${it.percent.toFixed(1)}%</span>` : ''
          }${
            it.band
              ? ` <span style="color:${t.textMuted};font-weight:400;">${escFmt(valueFmt(num))(it.band.lower)} – ${escFmt(valueFmt(num))(it.band.upper)}</span>`
              : ''
          }${
            it.errorBar ? ` <span style="color:${t.textMuted};font-weight:400;">[${escFmt(valueFmt(num))(it.errorBar.low)} – ${escFmt(valueFmt(num))(it.errorBar.high)}]</span>`
              : it.baseline !== undefined ? ` <span style="color:${t.textMuted};font-weight:400;">baseline ${escFmt(valueFmt(num))(it.baseline)}</span>` : ''
          }</span>
        </div>`
        )
        .join('');
      if (ctx.ohlc) {
        const o = ctx.ohlc;
        const fy = escFmt(yFmt);
        const row = (label: string, v: string, color = t.textPrimary) => `
        <div style="display:flex;gap:12px;justify-content:space-between;">
          <span style="color:${t.textMuted};">${label}</span>
          <span style="color:${color};font-weight:600;font-variant-numeric:tabular-nums;">${v}</span>
        </div>`;
        const change = o.open !== 0 ? ((o.close - o.open) / Math.abs(o.open)) * 100 : 0;
        const dir = ctx.items[0]?.color ?? t.textPrimary;
        return `
        <div style="color:${t.textMuted};font-size:11px;margin-bottom:4px;">${esc(ctx.xLabel)}${
          o.count > 1 ? ` · ${o.count.toLocaleString(this.chartLocale())} ${ctx.chartType === 'ohlc' ? 'bars' : 'candles'}` : ''
        }</div>
        ${row('Open', fy(o.open))}
        ${row('High', fy(o.high))}
        ${row('Low', fy(o.low))}
        ${row('Close', `${fy(o.close)} <span style="color:${dir};font-weight:400;">${change >= 0 ? '+' : ''}${change.toFixed(2)}%</span>`)}
        ${o.volume !== undefined ? row('Volume', formatTickValue(o.volume, this.chartLocale())) : ''}
      `;
      }
      if (ctx.chartType === 'heatmap') {
        return heatmapTooltipHtml(ctx, t, valueFmt(num));
      }
      if (ctx.chartType === 'box') {
        return boxTooltipHtml(ctx, t, yFmt, (v) => v.toLocaleString(this.chartLocale()));
      }
      if (ctx.chartType === 'pie') {
        return pieTooltipHtml(ctx, t, valueFmt((v) => this.pieValueText(v)), this.chartLocale());
      }
      const business = this.chartMeta;
      if (isBusinessMeta(business)) {
        const html = businessTooltipHtml(ctx, business, t, valueFmt(business.format), this.chartLocale());
        if (html !== null) return html;
      }
      if (ctx.chartType === 'treemap' || ctx.chartType === 'sunburst' || ctx.chartType === 'sankey') {
        return hierarchyTooltipHtml(ctx, t, valueFmt((v) => this.hierValueText(v)), this.chartLocale());
      }
      if (ctx.chartType === 'scatter' && ctx.point) {
        const p = this.chartPresentation;
        const coord = (label: string, v: string) => `
        <div style="display:flex;gap:12px;justify-content:space-between;">
          <span style="color:${t.textMuted};">${label}</span>
          <span style="color:${t.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${v}</span>
        </div>`;
        const fx = escFmt(resolveFormat(p?.xAxis.format, this.chartLocale()) ?? num);
        const fy = escFmt(yFmt);
        const head = ctx.items[0];
        return `
        <div style="display:flex;align-items:center;color:${t.textSecondary};margin-bottom:4px;">${head ? swatch(head.color) + esc(head.seriesName) : ''}</div>
        ${coord(esc(p?.xAxis.title ?? 'x'), fx(ctx.point.x))}
        ${coord(esc(p?.yAxis.title ?? 'y'), fy(ctx.point.y))}
      `;
      }
      const total =
        ctx.total !== undefined
          ? `<div style="display:flex;gap:12px;justify-content:space-between;margin-top:4px;padding-top:4px;border-top:1px solid ${t.tooltipBorder};">
          <span style="color:${t.textMuted};">Total</span>
          <span style="color:${t.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${escFmt(valueFmt(num))(ctx.total)}</span>
        </div>`
          : '';
      // Single-series bars list their item attributes; multi-series bars list the column instead
      const extra =
        ctx.chartType === 'bar' && this.chartMeta?.kind === 'bar' && ctx.details
          ? Object.entries(ctx.details.metadata.attributes ?? {})
              .filter(([k]) => k !== 'value')
              .map(
                ([k, v]) =>
                  `<div style="color:${t.textMuted};font-size:11px;">${esc(k)}: <span style="color:${t.textSecondary};">${esc(String(v))}</span></div>`
              )
              .join('')
          : '';
      return `
        <div style="color:${t.textMuted};font-size:11px;margin-bottom:4px;">${esc(ctx.xLabel)}</div>
        ${rows}
        ${total}
        ${extra ? `<div style="margin-top:4px;">${extra}</div>` : ''}
      `;
    };

    /** Tooltip HTML: rows ordered / filtered by `tooltip`, then the user or default formatter. */
    const chartTooltipHtml = (raw: ChartTooltipContext): string => {
      const ctx = presentTooltipContext(raw, tooltipOptions);
      return options?.formatChartTooltip ? options.formatChartTooltip(ctx) : defaultChartTooltip(ctx);
    };

    // Keyboard chart navigation (chart-a11y.ts) shows the same tooltip at the focused point
    this.a11y.tooltip = (ctx, x, y) => {
      if (!ctx || !tooltipEl) return hideTooltip();
      // Keyboard focus moves replace a pinned tooltip
      setClickPinned(false);
      tooltipEl.innerHTML = chartTooltipHtml(ctx);
      placeTooltip(x, y);
    };
    // Synced cursor (`hoverAtX` with `tooltip`): the tooltip sits at the primary point
    this.syncTooltip = (hit) => {
      const ctx = chartHoverContext(hit ?? undefined);
      const id = ctx?.items[Math.min(hit?.[1] ?? 0, ctx.items.length - 1)]?.nodeId;
      const ndc = id !== undefined ? this.backend.project_node_to_ndc?.(id) : undefined;
      // A pinned tooltip ignores the synced cursor
      if (clickPinned) return;
      if (!ctx || !tooltipEl || !ndc || ndc.length < 2) return hideTooltip();
      tooltipEl.innerHTML = chartTooltipHtml(ctx);
      const rect = canvas.getBoundingClientRect();
      placeTooltip(rect.left + (ndc[0] * 0.5 + 0.5) * rect.width, rect.top + (0.5 - ndc[1] * 0.5) * rect.height);
    };

    // Data-derived text is escaped; fixed strings follow the locale (graph-tooltip.ts)
    const defaultFormatTooltip = (d: NodeDetails): string =>
      graphTooltipHtml(d, this.theme, this.chartLocale(), neighborHops > 0);

    /**
     * Chart hit-test runs in the engine (which also draws crosshair / markers / bar highlight);
     * this only turns the result into tooltip data.
     */
    const resolveChartHover = (e: { clientX: number; clientY: number }): ChartTooltipContext | null => {
      const [ndcX, ndcY] = toNdc(e);
      return chartHoverContext(this.backend.chart_hover_at_ndc?.(ndcX, ndcY));
    };

    /** Tooltip data of an engine hover result (pointer or synced cursor). */
    const chartHoverContext = (hit: Float64Array | undefined): ChartTooltipContext | null => {
      const meta = this.chartMeta;
      if (!meta || !hit || hit.length < 3) return null;
      const count = hit[2];
      if (count < 1) return null;
      if (meta.kind === 'candle') return this.candleTooltip(meta, hit[4]);
      if (meta.kind === 'heatmap') return this.heatmapTooltip(meta, hit);
      if (meta.kind === 'box') return this.boxTooltip(meta, hit);
      if (meta.kind === 'pie') return this.pieTooltip(meta, hit[4]);
      if (meta.kind === 'combo') return comboTooltipContext(meta, hit, rgbaToCss, (id) => this.getNodeDetails(id));
      if (isBusinessMeta(meta)) return businessTooltipContext(meta, hit, (id) => this.getNodeDetails(id));
      if (meta.kind === 'treemap' || meta.kind === 'sunburst' || meta.kind === 'sankey') return this.hierarchyTooltip(meta, hit);

      const items: ChartTooltipItem[] = [];
      for (let k = 0; k < count; k++) {
        const at = 3 + k * 4;
        const series = hit[at];
        const index = hit[at + 1];
        const nodeId = hit[at + 3];
        if (meta.kind === 'scatter') {
          items.push({
            seriesName: meta.names[series] ?? `Series ${series}`,
            value: hit[at + 2],
            color: rgbaToCss(scatterPointColor(meta, index)),
            nodeId,
          });
        } else if (meta.kind !== 'bar') {
          const band = meta.kind === 'line' ? lineBandAt(this.backend, meta.bands, series, index) : undefined;
          items.push({
            seriesName: meta.names[series] ?? `Series ${series}`,
            value: hit[at + 2],
            color: rgbaToCss(meta.colors[series]),
            nodeId,
            ...(band ? { band } : {}),
            ...(meta.kind === 'line' ? sparseTooltip(meta.sparse, series, index) : {}),
          });
        } else {
          items.push({
            seriesName: meta.metadata[index]?.category ?? '',
            value: hit[at + 2],
            color: rgbaToCss(meta.colors[index]),
            nodeId,
          });
        }
      }
      const primarySlot = Math.min(hit[1], count - 1);
      const primarySeries = hit[3 + primarySlot * 4];
      const primaryIndex = hit[3 + primarySlot * 4 + 1];
      const details = this.getNodeDetails(items[primarySlot].nodeId);
      if (meta.kind === 'scatter') {
        const point = { x: meta.x[primaryIndex], y: meta.y[primaryIndex] };
        const fx = this.chartPresentation?.formatX ?? ((v: number) => formatChartValue(v, this.chartLocale()));
        return { chartType: 'scatter', index: primaryIndex, xLabel: fx(point.x), point, items, details };
      }
      const x = meta.kind === 'line' ? this.lineSample(meta, primarySeries, primaryIndex)?.x : undefined;
      // Error bars: the tooltip shows ± next to the value
      // (percent bars draw no error bars)
      if (meta.kind === 'bar' || (meta.kind === 'bar-multi' && meta.mode !== 'percent')) {
        for (const it of items) {
          const err = barErrorOf(meta.barStyle, it.nodeId);
          if (err) it.error = err;
        }
      }
      // Stacked bars: the engine returns the whole column; add its total / shares for display
      let total: number | undefined;
      if (meta.kind === 'bar-multi' && meta.mode === 'stacked') {
        total = items.reduce((sum, it) => sum + it.value, 0);
      } else if (meta.kind === 'bar-multi' && meta.mode === 'percent') {
        const abs = items.reduce((sum, it) => sum + Math.abs(it.value), 0);
        for (const it of items) it.percent = abs > 0 ? (Math.abs(it.value) / abs) * 100 : 0;
      }
      // Areas: the engine returns raw values; stacked series share sample indices, so the column
      // is summed over the visible series at the hovered index (also in 'nearest' hover mode).
      // Shares match the engine's percent stacking (missing / negative = 0).
      const area = meta.kind === 'line' ? meta.area : undefined;
      if (meta.kind === 'line' && (area === 'stacked' || area === 'percent')) {
        const col = (f: (v: number) => number) =>
          meta.names.reduce((sum, _, s) => {
            const x = this.lineSample(meta, s, primaryIndex)?.value;
            return meta.visible[s] && x !== undefined && Number.isFinite(x) ? sum + f(x) : sum;
          }, 0);
        if (area === 'stacked') {
          total = col((v) => v);
        } else {
          const pos = col((v) => Math.max(0, v));
          for (const it of items) it.percent = pos > 0 ? (Math.max(0, it.value) / pos) * 100 : 0;
        }
      }
      return {
        chartType: meta.kind === 'line' ? (meta.sparse?.kind ?? (meta.standaloneBand ? 'band' : 'line')) : 'bar',
        index: primaryIndex,
        x,
        xLabel:
          meta.kind === 'line'
            ? x !== undefined
              ? meta.formatXValue(x)
              : `${meta.xPrefix}+${primaryIndex}`
            : meta.kind === 'bar-multi'
              ? (meta.categories[primaryIndex] ?? `#${primaryIndex}`)
              : (meta.metadata[primaryIndex]?.label ?? `#${primaryIndex}`),
        items,
        ...(total !== undefined ? { total } : {}),
        ...(area ? { areaMode: area } : {}),
        details,
      };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (nav.dragging()) {
        nav.pointerMove(e);
        return;
      }
      if (gestures?.pointerMove(e)) return;
      // Ignored extra finger (3rd touch) must not reach the mouse drag path
      if (gestures && isGesturePointer(e) && e.buttons !== 0) return;
      // Skip raycast while dragging; a navigable chart pans its x axis instead of the camera
      if (e.buttons !== 0) {
        hideTooltip();
        // Graph / 3D view: orbit or pan
        if (camera.pointerMove(e)) return;
        // Live box zoom rectangle
        if (zoom.pointerMove(e)) return;
        if (brushFrom && this.chartBrushMode) {
          // Past the click threshold only, so a jittery click does not drop the selection
          if (!brushLive && downPos && Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) <= 5) return;
          if (!brushLive) {
            // A release outside the canvas still commits the brush
            try {
              canvas.setPointerCapture?.(e.pointerId);
            } catch {
              // Synthetic / already released pointers cannot be captured
            }
            if (this.chartBrushStyle) this.backend.set_chart_brush_style?.(encodeBrushStyle(this.chartBrushStyle));
            this.backend.chart_clear_hover?.();
            emitHover(null, null, null, e);
          }
          const [x, y] = toNdc(e);
          const mode = brushModeCode(this.chartBrushMode);
          brushLive = this.backend.chart_brush?.(mode, brushFrom[0], brushFrom[1], x, y) ?? false;
          if (autoRender) this.render();
          return;
        }
        if (panLastX !== null && navigating()) {
          // One undo step per drag pan
          if (!panRecorded) {
            panRecorded = true;
            zoom.panStart();
          }
          const rect = canvas.getBoundingClientRect();
          const dx = ((e.clientX - panLastX) / Math.max(1, rect.width)) * 2;
          if (this.chartPresentation?.zoomY) {
            this.panChartXY(dx, -((e.clientY - panLastY) / Math.max(1, rect.height)) * 2);
          } else {
            this.panChartX(dx);
          }
          panLastX = e.clientX;
          panLastY = e.clientY;
          if (autoRender) this.render();
        }
        return;
      }
      hoverAt(e);
      // Cursor over the navigator strip (ew-resize / grab / pointer)
      nav.pointerMove(e);
    };

    /** Hover hit-test + tooltip at a pointer position (mouse hover, touch tap / scrub). */
    const hoverAt = (e: { clientX: number; clientY: number }, aboveFinger = false) => {
      // Click-pinned chart tooltip: the hover state stays frozen until unpinned
      if (clickPinned && this.chartMode) return;
      tooltipPinned = aboveFinger;
      let pickedId: number | null;
      let details: NodeDetails | null = null;
      let chartCtx: ChartTooltipContext | null = null;
      if (this.chartMode) {
        const ctx = (chartCtx = resolveChartHover(e));
        details = ctx?.details ?? null;
        pickedId = details?.id ?? null;
        if (ctx && tooltipEl) {
          tooltipEl.innerHTML = chartTooltipHtml(ctx);
          placeTooltip(e.clientX, e.clientY, aboveFinger);
        } else {
          hideTooltip();
        }
      } else {
        const [ndcX, ndcY] = toNdc(e);
        pickedId = this.pickNodeAtNdc(ndcX, ndcY);
        if (pickedId !== null) {
          details = this.getNodeDetails(pickedId);
          if (tooltipEl && details) {
            tooltipEl.innerHTML = options?.formatTooltip
              ? options.formatTooltip(details)
              : defaultFormatTooltip(details);
            placeTooltip(e.clientX, e.clientY, aboveFinger);
          }
        } else {
          hideTooltip();
        }
      }

      if (pickedId !== lastHoveredId) {
        lastHoveredId = pickedId;
        canvas.style.cursor = pickedId !== null ? 'pointer' : brushing() ? 'crosshair' : 'grab';
        options?.onNodeHover?.(details, { clientX: e.clientX, clientY: e.clientY });
        if (autoRender) this.render();
      }
      emitHover(pickedId, chartCtx, details, e);
    };

    const onPointerDown = (e: PointerEvent) => {
      lastPointerType = e.pointerType;
      pinnedAtDown = clickPinned;
      // Another finger while the strip is dragged: ignore (no pan / pinch under the drag)
      if (nav.dragging()) return;
      if (nav.pointerDown(e)) {
        // The strip owns this pointer: no pan, click, or touch gesture
        gestures?.stopFling();
        hideTooltip();
        if (this.chartMode) this.backend.chart_clear_hover?.();
        panLastX = null;
        downPos = null;
        return;
      }
      if (gestures?.pointerDown(e)) return;
      gestures?.stopFling();
      panRecorded = false;
      // Box zoom (`zoomMode: 'box'` drag, or Ctrl / Cmd + drag) owns the press
      if (zoom.pointerDown(e)) {
        hideTooltip();
        panLastX = null;
        brushFrom = null;
        downPos = null;
        try {
          canvas.setPointerCapture?.(e.pointerId);
        } catch {
          // Synthetic / already released pointers cannot be captured
        }
        return;
      }
      // Graph / 3D view: a camera drag may start (a release within 5 px is still a click)
      camera.pointerDown(e);
      if (e.button === 0) {
        downPos = { x: e.clientX, y: e.clientY };
        // Brush mode: plain drag brushes, Alt + drag navigates
        brushFrom = brushing() && !e.altKey ? toNdc(e) : null;
        brushLive = false;
        // Shift + drag stays a camera gesture (tilt)
        panLastX = navigating() && !e.shiftKey && !brushFrom ? e.clientX : null;
        panLastY = e.clientY;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      // A camera drag (past its slop) is never a click, wherever it is released
      const orbited = camera.dragging();
      camera.pointerUp();
      if (nav.pointerUp(e)) return;
      if (gestures?.pointerUp(e)) return;
      if (orbited) {
        downPos = null;
        panLastX = null;
        // Hover state is from before the drag; the next move updates it
        canvas.style.cursor = lastHoveredId !== null ? 'pointer' : brushing() ? 'crosshair' : 'grab';
        return;
      }
      const boxed = zoom.pointerUp(e);
      if (boxed === 'click') {
        // A box press too small to zoom is a plain click (node click, tooltip pin)
        panLastX = null;
        if (e.button === 0) clickAt(e);
        return;
      }
      if (boxed) {
        panLastX = null;
        return;
      }
      panLastX = null;
      const brushed = brushFrom !== null && brushLive;
      brushFrom = null;
      brushLive = false;
      if (e.button !== 0 || !downPos) return;
      const dist = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      downPos = null;
      if (brushed) {
        this.commitBrush();
        if (autoRender) this.render();
        return;
      }
      // Treat as a click only if pointer moved less than 5px (not an orbit/box-select drag)
      if (dist > 5) return;
      clickAt(e);
    };

    /** Click semantics shared by mouse clicks and touch taps. */
    const clickAt = (e: PointerEvent) => {
      if (this.chartMode) {
        // A click clears the brush selection (like Plotly / ECharts)
        if (brushing()) this.clearChartSelection();
        const ctx = resolveChartHover(e);
        // Treemap / sunburst: a click drills into the clicked group / arc (sunburst center: up)
        if (this.hierarchyClick(ctx)) hideTooltip();
        if (tooltipOptions?.pin === 'click') {
          // A drag may already have unpinned it (pan / brush hide the tooltip)
          const wasPinned = clickPinned || pinnedAtDown;
          pinnedAtDown = false;
          setClickPinned(false);
          if (!wasPinned && ctx && tooltipEl) {
            tooltipEl.innerHTML = chartTooltipHtml(ctx);
            // Touch taps keep the tooltip above the finger
            placeTooltip(e.clientX, e.clientY, lastPointerType !== 'mouse');
            setClickPinned(true);
          } else {
            hoverAt(e);
          }
        }
        options?.onNodeClick?.(ctx?.details ?? null, e);
        this.events.emit('click', { chart: ctx, node: ctx?.details ?? null, event: e });
        if (autoRender) this.render();
        return;
      }

      const [ndcX, ndcY] = toNdc(e);
      const pickedId = this.pickNodeAtNdc(ndcX, ndcY);
      if (pickedId !== null) {
        if (neighborHops > 0) {
          this.highlightNeighbors(pickedId, neighborHops);
        }
        const details = this.getNodeDetails(pickedId);
        options?.onNodeClick?.(details, e);
        this.events.emit('click', { chart: null, node: details, event: e });
      } else {
        options?.onNodeClick?.(null, e);
        this.events.emit('click', { chart: null, node: null, event: e });
      }
      if (autoRender) this.render();
    };

    const onDblClick = (e: MouseEvent) => {
      // Touch / pen double-taps are recognized by the gesture layer (the browser may also fire dblclick)
      if (gestures && lastPointerType !== 'mouse') return;
      // Two quick presses on the navigator strip are jumps, not a zoom reset
      if (nav.over(e)) return;
      doubleClickAt(e);
    };

    /** Double-click semantics shared by mouse and touch double-tap. */
    const doubleClickAt = (e: { clientX: number; clientY: number }) => {
      // Charts: double-click resets the x zoom; focus is a graph / point-cloud gesture
      if (this.chartMode) {
        if (navigating()) {
          this.resetChartZoom();
          // A reset starts over: no undo steps across it
          this.clearZoomHistory();
          if (autoRender) this.render();
        }
        return;
      }
      if (!focusOnDblClick) return;
      const [ndcX, ndcY] = toNdc(e);
      const pickedId = this.pickNodeAtNdc(ndcX, ndcY);
      if (pickedId !== null) {
        this.focusNode(pickedId);
        if (autoRender) this.render();
      }
    };

    const onPointerLeave = (e: PointerEvent) => {
      // A tapped (pinned) touch / pen tooltip outlives the finger or pen lifting off
      if (tooltipPinned && e.pointerType !== 'mouse') return;
      // So does a click-pinned one
      if (clickPinned) return;
      hideTooltip();
      emitHover(null, null, null, e);
      if (this.chartMode) {
        this.backend.chart_clear_hover?.();
        if (autoRender) this.render();
      }
    };

    const onLostCapture = (e: PointerEvent) => {
      camera.pointerUp();
      nav.pointerUp(e);
      // A box whose release never arrives must not swallow the next drag
      zoom.cancel();
    };
    const onPointerCancel = (e: PointerEvent) => {
      camera.pointerUp();
      zoom.cancel();
      if (nav.pointerUp(e)) return;
      gestures?.pointerCancel(e);
    };
    // Android long-press would otherwise open the context menu mid-scrub; a right-button
    // drag pans a graph / 3D view
    const onContextMenu = (e: Event) => {
      if (lastPointerType !== 'mouse' ? gestures !== null : camera.wantsContextMenuBlocked()) e.preventDefault();
    };

    /** Touch / pen gestures (chart-gestures.ts); mouse keeps the handlers above. */
    const touchOptions = options?.touch;
    const gestures =
      touchOptions === false
        ? null
        : createTouchGestures<PointerEvent>(
            {
              navMode: () =>
                this.handlesChartNavigation()
                  ? chartNavigation ? (this.chartPresentation?.zoomY ? 'chart-xy' : 'chart') : 'none'
                  : // Fixed 2D layouts (no zoom / reset): a drag must not pan the framing camera
                    this.sparkline || this.chartMode === 'pie' || this.chartMode === 'box' || isBusinessKind(this.chartMode) || this.isHierarchyChart()
                    ? 'none'
                    : this.flatCameraView ? 'flat'
                      // Graph / 3D view with `cameraControls.orbit` off: a drag pans
                      : this.chartMode || cameraOptions.orbit ? 'orbit' : 'flat',
              canvasWidth: () => canvas.getBoundingClientRect().width,
              canvasHeight: () => canvas.getBoundingClientRect().height,
              toNdcX: (clientX) => toNdc({ clientX, clientY: 0 })[0],
              toNdcY: (clientY) => toNdc({ clientX: 0, clientY })[1],
              panChartX: (d) => this.panChartX(d),
              zoomChartX: (f, ndcX) => this.zoomChartX(f, ndcX),
              panChartXY: (dx, dy) => this.panChartXY(dx, dy),
              zoomChartXY: (f, ndcX, ndcY) => this.zoomChartXY(f, ndcX, ndcY),
              // `cameraControls` switches gate the graph / 3D view camera (3D charts keep orbiting)
              rotateCamera: (yaw, pitch) => {
                if (this.chartMode || cameraOptions.orbit) this.rotateCamera(yaw, pitch);
              },
              panCamera: (r, u) => {
                if (this.chartMode || cameraOptions.pan) this.panCamera(r, u);
              },
              zoomCamera: (d) => {
                if (this.chartMode || cameraOptions.zoom) this.zoomCamera(d);
              },
              showTooltipAt: (clientX, clientY) => hoverAt({ clientX, clientY }, true),
              clearTooltip: () => {
                tooltipPinned = false;
                hideTooltip();
                emitHover(null, null, null);
                if (this.chartMode) this.backend.chart_clear_hover?.();
              },
              click: clickAt,
              doubleClick: doubleClickAt,
              changed: () => {
                if (autoRender) this.render();
              },
            },
            touchOptions
          );

    // Wheel zooms the x axis of a navigable chart around the pointer (the page must not scroll)
    const onWheel = (e: WheelEvent) => {
      // Graph / 3D view: dolly the camera (the page must not scroll)
      if (camera.wheel(e)) {
        e.preventDefault();
        gestures?.stopFling();
        hideTooltip();
        return;
      }
      if (!navigating()) return;
      e.preventDefault();
      gestures?.stopFling();
      hideTooltip();
      // Over the navigator strip: zoom around the strip pointer
      if (nav.wheel(e)) return;
      // y / xy wheel zoom (`zoom` option, Shift + wheel)
      if (zoom.wheel(e)) return;
      zoom.wheelStep();
      const [ndcX, ndcY] = toNdc(e);
      const factor = Math.exp(e.deltaY * 0.0015);
      if (this.chartPresentation?.zoomY) this.zoomChartXY(factor, ndcX, ndcY);
      else this.zoomChartX(factor, ndcX);
      if (autoRender) this.render();
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('pointerleave', onPointerLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // Escape drops the brush (live or committed); the canvas is focusable (chart-a11y.ts)
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl / Cmd + Z undoes a zoom, Ctrl / Cmd + Shift + Z / Ctrl + Y redoes it
      if (this.chartMode && navigating() && zoom.keyDown(e)) return;
      if (e.key !== 'Escape' || !this.chartMode) return;
      // A live box zoom is cancelled first
      if (zoom.cancel()) return;
      if (clickPinned) releasePinnedHover();
      brushFrom = null;
      brushLive = false;
      this.clearChartSelection();
      if (autoRender) this.render();
    };
    canvas.addEventListener('keydown', onKeyDown);
    canvas.addEventListener('lostpointercapture', onLostCapture);
    // Touch / pen: the SDK owns every gesture, so the browser must not pan / zoom the page
    const prevTouchAction = canvas.style.touchAction;
    const stopFling = () => gestures?.stopFling();
    if (gestures) {
      canvas.style.touchAction = 'none';
      canvas.addEventListener('pointercancel', onPointerCancel);
      // Scene / chart replaced: an old fling must not move the new view
      this.hoverResetHooks.add(stopFling);
      this.touchGestureOwners++;
    }
    const blocksContextMenu = gestures !== null || cameraOptions.pan;
    if (blocksContextMenu) canvas.addEventListener('contextmenu', onContextMenu);
    if (cameraOwned) this.cameraControlOwners++;

    let detached = false;
    const detach = () => {
      if (detached) return;
      detached = true;
      if (prevBrushMode !== undefined) this.chartBrushMode = prevBrushMode;
      if (gestures) {
        this.hoverResetHooks.delete(stopFling);
        gestures.reset();
        canvas.style.touchAction = prevTouchAction;
        canvas.removeEventListener('pointercancel', onPointerCancel);
        this.touchGestureOwners--;
      }
      if (blocksContextMenu) canvas.removeEventListener('contextmenu', onContextMenu);
      if (cameraOwned) this.cameraControlOwners--;
      if (camera.dragging()) canvas.style.cursor = '';
      camera.reset();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('lostpointercapture', onLostCapture);
      setClickPinned(false);
      zoom.reset();
      this.hoverResetHooks.delete(hideTooltip);
      this.hoverResetHooks.delete(resetHoverEvent);
      this.hoverResetHooks.delete(resetNav);
      nav.reset();
      this.themeHooks.delete(restyleTooltip);
      this.a11y.tooltip = null;
      this.syncTooltip = null;
      this.disposers.delete(detach);
      if (this.chartMode) this.backend.chart_clear_hover?.();
      tooltipEl?.parentElement?.removeChild(tooltipEl);
    };
    this.disposers.add(detach);
    // Late canvas registration (fromBackend): build the overlay of an already rendered chart
    if (this.chartPresentation && !this.chartOverlay) this.rebuildChartOverlay();
    return detach;
  }

  // ---------------------------------------------------------------------------
  // Three.js-style 3D Scene / Object / Physics / Lighting API
  // ---------------------------------------------------------------------------

  setGraphVisible(visible: boolean): void {
    this.graphVisibleState = visible;
    this.backend.set_graph_visible?.(visible);
  }

  isGraphVisible(): boolean {
    return this.graphVisibleState;
  }

  addPrimitive(desc: PrimitiveObjectDescriptor): number {
    const pos: Vec3Tuple = desc.position ? [...desc.position] : [0, 0, 0];
    const rot: Vec3Tuple = desc.rotation ? [...desc.rotation] : [0, 0, 0];
    const scale: Vec3Tuple = desc.scale ? [...desc.scale] : [10, 10, 10];
    const color: RgbaTuple = desc.color ? [...desc.color] : [0.35, 0.68, 0.98, 1.0];
    const bodyType: RigidBodyType = desc.bodyType ?? 'static';

    const id =
      this.backend.add_primitive?.(
        encodePrimitiveShape(desc.shape),
        pos[0],
        pos[1],
        pos[2],
        scale[0],
        scale[1],
        scale[2],
        color[0],
        color[1],
        color[2],
        color[3],
        encodeBodyType(bodyType)
      ) ?? this.objectRecords.size + 1;

    const record: SceneObjectRecord = {
      id,
      name: desc.name ?? `${desc.shape.toUpperCase()}_${id}`,
      kind: 'primitive',
      shape: desc.shape,
      position: pos,
      rotation: rot,
      scale,
      color,
      metallic: desc.metallic ?? 0.15,
      roughness: desc.roughness ?? 0.45,
      emissive: desc.emissive ?? 0.0,
      bodyType,
      velocity: desc.velocity ? [...desc.velocity] : [0, 0, 0],
      angularVelocity: desc.angularVelocity ? [...desc.angularVelocity] : [0, 0, 0],
      mass: desc.mass ?? Math.max(0.2, Math.abs(scale[0] * scale[1] * scale[2]) * 0.01),
      restitution: desc.restitution ?? 0.55,
      parentId: desc.parentId ?? null,
    };

    this.objectRecords.set(id, record);
    this.applyRecordDetails(record);
    return id;
  }

  addBox(desc?: Omit<PrimitiveObjectDescriptor, 'shape'>): number {
    return this.addPrimitive({ shape: 'box', ...desc });
  }

  addSphere(desc?: Omit<PrimitiveObjectDescriptor, 'shape'>): number {
    return this.addPrimitive({ shape: 'sphere', ...desc });
  }

  addPlane(desc?: Omit<PrimitiveObjectDescriptor, 'shape'>): number {
    return this.addPrimitive({
      shape: 'plane',
      scale: [200, 2, 200],
      color: [0.16, 0.21, 0.31, 1.0],
      ...desc,
    });
  }

  addCylinder(desc?: Omit<PrimitiveObjectDescriptor, 'shape'>): number {
    return this.addPrimitive({ shape: 'cylinder', ...desc });
  }

  addCustomMesh(desc: CustomMeshObjectDescriptor): number {
    const posArr =
      desc.positions instanceof Float32Array ? desc.positions : new Float32Array(desc.positions);
    const normArr = desc.normals
      ? desc.normals instanceof Float32Array
        ? desc.normals
        : new Float32Array(desc.normals)
      : EMPTY_F32;
    const idxArr =
      desc.indices instanceof Uint32Array ? desc.indices : new Uint32Array(desc.indices);

    const pos: Vec3Tuple = desc.position ? [...desc.position] : [0, 0, 0];
    const rot: Vec3Tuple = desc.rotation ? [...desc.rotation] : [0, 0, 0];
    const scale: Vec3Tuple = desc.scale ? [...desc.scale] : [1, 1, 1];
    const color: RgbaTuple = desc.color ? [...desc.color] : [0.85, 0.45, 0.95, 1.0];
    const bodyType: RigidBodyType = desc.bodyType ?? 'static';

    const id =
      this.backend.add_custom_mesh?.(
        posArr,
        normArr,
        idxArr,
        pos[0],
        pos[1],
        pos[2],
        scale[0],
        scale[1],
        scale[2],
        color[0],
        color[1],
        color[2],
        color[3],
        encodeBodyType(bodyType)
      ) ?? this.objectRecords.size + 1;

    const record: SceneObjectRecord = {
      id,
      name: desc.name ?? `MESH_${id}`,
      kind: 'custom',
      customMesh: {
        positions: Array.from(posArr),
        normals: Array.from(normArr),
        indices: Array.from(idxArr),
      },
      position: pos,
      rotation: rot,
      scale,
      color,
      metallic: desc.metallic ?? 0.35,
      roughness: desc.roughness ?? 0.3,
      emissive: desc.emissive ?? 0.0,
      bodyType,
      velocity: desc.velocity ? [...desc.velocity] : [0, 0, 0],
      angularVelocity: desc.angularVelocity ? [...desc.angularVelocity] : [0, 0, 0],
      mass: desc.mass ?? 2.0,
      restitution: desc.restitution ?? 0.6,
      parentId: desc.parentId ?? null,
    };

    this.objectRecords.set(id, record);
    this.applyRecordDetails(record);
    return id;
  }

  private applyRecordDetails(record: SceneObjectRecord): void {
    this.backend.set_object_transform?.(
      record.id,
      record.position[0],
      record.position[1],
      record.position[2],
      record.rotation[0],
      record.rotation[1],
      record.rotation[2],
      record.scale[0],
      record.scale[1],
      record.scale[2]
    );
    this.backend.set_object_material?.(
      record.id,
      record.color[0],
      record.color[1],
      record.color[2],
      record.color[3],
      record.metallic,
      record.roughness,
      record.emissive
    );
    this.backend.set_object_physics?.(
      record.id,
      encodeBodyType(record.bodyType),
      record.velocity[0],
      record.velocity[1],
      record.velocity[2],
      record.mass,
      record.restitution
    );
    this.backend.set_object_angular_velocity?.(
      record.id,
      record.angularVelocity[0],
      record.angularVelocity[1],
      record.angularVelocity[2]
    );
    if (record.parentId !== null) {
      this.backend.set_object_parent?.(record.id, record.parentId);
    }
  }

  setObjectTransform(objectId: number, transform: ObjectTransformDescriptor): boolean {
    const rec = this.objectRecords.get(objectId);
    if (!rec) return false;
    // Sync latest live position/rotation from WASM before applying partial update
    this.syncRecordTransformFromBackend(rec);

    if (transform.position) rec.position = [...transform.position];
    if (transform.rotation) rec.rotation = [...transform.rotation];
    if (transform.scale) rec.scale = [...transform.scale];
    if (transform.parentId !== undefined) {
      rec.parentId = transform.parentId;
      this.backend.set_object_parent?.(objectId, transform.parentId ?? -1);
    }

    return (
      this.backend.set_object_transform?.(
        objectId,
        rec.position[0],
        rec.position[1],
        rec.position[2],
        rec.rotation[0],
        rec.rotation[1],
        rec.rotation[2],
        rec.scale[0],
        rec.scale[1],
        rec.scale[2]
      ) ?? true
    );
  }

  getObjectTransform(
    objectId: number
  ): { position: Vec3Tuple; rotation: Vec3Tuple; scale: Vec3Tuple } | null {
    const rec = this.objectRecords.get(objectId);
    if (!rec) return null;
    this.syncRecordTransformFromBackend(rec);
    return {
      position: [...rec.position],
      rotation: [...rec.rotation],
      scale: [...rec.scale],
    };
  }

  private syncRecordTransformFromBackend(rec: SceneObjectRecord): void {
    const raw = this.backend.get_object_transform?.(rec.id);
    if (raw && raw.length === 9) {
      rec.position = [raw[0], raw[1], raw[2]];
      rec.rotation = [raw[3], raw[4], raw[5]];
      rec.scale = [raw[6], raw[7], raw[8]];
    }
  }

  setObjectMaterial(objectId: number, mat: ObjectMaterialDescriptor): boolean {
    const rec = this.objectRecords.get(objectId);
    if (!rec) return false;
    if (mat.color) rec.color = [...mat.color];
    if (mat.metallic !== undefined) rec.metallic = mat.metallic;
    if (mat.roughness !== undefined) rec.roughness = mat.roughness;
    if (mat.emissive !== undefined) rec.emissive = mat.emissive;

    return (
      this.backend.set_object_material?.(
        objectId,
        rec.color[0],
        rec.color[1],
        rec.color[2],
        rec.color[3],
        rec.metallic,
        rec.roughness,
        rec.emissive
      ) ?? true
    );
  }

  setObjectPhysics(objectId: number, phys: ObjectPhysicsDescriptor): boolean {
    const rec = this.objectRecords.get(objectId);
    if (!rec) return false;
    if (phys.bodyType !== undefined) rec.bodyType = phys.bodyType;
    if (phys.velocity !== undefined) rec.velocity = [...phys.velocity];
    if (phys.angularVelocity !== undefined) {
      rec.angularVelocity = [...phys.angularVelocity];
      this.backend.set_object_angular_velocity?.(
        objectId,
        rec.angularVelocity[0],
        rec.angularVelocity[1],
        rec.angularVelocity[2]
      );
    }
    if (phys.mass !== undefined) rec.mass = phys.mass;
    if (phys.restitution !== undefined) rec.restitution = phys.restitution;

    return (
      this.backend.set_object_physics?.(
        objectId,
        encodeBodyType(rec.bodyType),
        rec.velocity[0],
        rec.velocity[1],
        rec.velocity[2],
        rec.mass,
        rec.restitution
      ) ?? true
    );
  }

  setObjectParent(objectId: number, parentId: number | null): boolean {
    const rec = this.objectRecords.get(objectId);
    if (!rec) return false;
    rec.parentId = parentId;
    return this.backend.set_object_parent?.(objectId, parentId ?? -1) ?? true;
  }

  removeObject(objectId: number): boolean {
    this.objectRecords.delete(objectId);
    return this.backend.remove_object?.(objectId) ?? true;
  }

  // ---------------------------------------------------------------------------
  // Theme, chart overlay (title / legend / axes), navigation, lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Switches the color theme of the canvas, chart marks, labels, legend, and tooltips. Custom
   * themes may give the GPU color tokens as CSS colors (`getTheme()` returns them as tuples).
   */
  setTheme(theme: 'dark' | 'light' | CharturboTheme | CharturboThemeInput): void {
    this.theme = typeof theme === 'string' ? CHARTURBO_THEMES[theme] : resolveTheme(theme);
    const t = this.theme;
    this.backend.set_clear_color?.(t.surface[0], t.surface[1], t.surface[2], t.surface[3]);
    for (const hook of this.themeHooks) hook();
    if (this.chartMode) {
      // Re-apply theme-derived defaults to the live chart
      this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(this.chartHover)));
      this.backend.set_chart_frame_style?.(
        encodeGridStyle(this.chartGridShown, this.themedGrid(this.chartGrid))
      );
      // Default annotation colors follow the theme
      if (this.chartAnnotations.length) this.syncAnnotations();
      if (this.chartNavigator) this.syncNavigator();
      this.restyleCandles();
      // Sequential / diverging anchors flip with the surface lightness
      if (this.chartMeta?.kind === 'heatmap') sendHeatmapColormap(this.backend, this.chartMeta, t);
      // Default error bar color / label font follow the theme
      const bars = this.chartMeta?.kind === 'bar' || this.chartMeta?.kind === 'bar-multi' ? this.chartMeta.barStyle : undefined;
      if (bars?.errMinus && !bars.errorBar.color) sendBarStyle(this.backend, bars, t);
      this.syncBarLabels();
      // Pie palette follows the theme (fixed display order)
      if (this.chartMeta?.kind === 'pie') {
        sendPieStyle(this.backend, this.chartMeta, t);
        syncPieSlices(this.backend, this.chartMeta);
      }
      // Business charts: palette / track / needle / surface colors follow the theme
      if (isBusinessMeta(this.chartMeta)) {
        sendBusinessTheme(this.backend, this.chartMeta, t);
        if (this.chartMeta.kind === 'waterfall') sendWaterfallLabels(this.backend, this.chartMeta, t.fontFamily);
      }
      // Hierarchy palettes / surface-derived header and fade colors follow the theme
      if (this.chartMeta?.kind === 'treemap' || this.chartMeta?.kind === 'sunburst') {
        sendHierarchyStyle(this.backend, this.chartMeta, t);
        syncHierarchy(this.backend, this.chartMeta);
      } else if (this.chartMeta?.kind === 'sankey') {
        sendHierarchyStyle(this.backend, this.chartMeta, t);
        syncSankey(this.backend, this.chartMeta);
      }
      this.rebuildChartOverlay();
    }
    this.events.emit('themechange', this.theme);
  }

  getTheme(): CharturboTheme {
    return this.theme;
  }

  /**
   * Shows / hides a line or multi-series bar series (same as clicking its legend entry). Bar
   * stacks / groups are re-laid out by the engine; the value axis stays fixed.
   */
  setSeriesVisible(seriesIndex: number, visible: boolean): void {
    const meta = this.chartMeta;
    if (!meta || meta.kind === 'bar' || meta.kind === 'candle' || meta.kind === 'heatmap' || seriesIndex < 0 || seriesIndex >= meta.visible.length) return;
    // Gauge / funnel / waterfall: a fixed series (static legend)
    if (hasStaticSeries(meta)) return;
    // Hierarchy legends only emphasize (groups cannot be hidden)
    if (meta.kind === 'treemap' || meta.kind === 'sunburst' || meta.kind === 'sankey') return;
    // 3D bar matrix: the engine keeps every bar, so the legend / a11y state must not change
    if (meta.kind === 'bar-multi' && meta.viewMode === '3d') return;
    const changed = meta.visible[seriesIndex] !== visible;
    meta.visible[seriesIndex] = visible;
    this.backend.set_chart_series_visible?.(seriesIndex, visible);
    // Bar labels: hidden series drop their text, percent shares change
    if (meta.kind === 'bar-multi') this.syncBarLabels();
    // Pie: the engine re-laid out the angles and percents
    if (meta.kind === 'pie') {
      syncPieSlices(this.backend, meta);
      this.chartOverlay?.pie?.invalidate();
      // The pointer still rests on the legend item: a hidden slice must not keep the rest faded
      if (!visible) this.emphasizeSeries(null);
    }
    this.syncLegendState();
    this.a11y.refresh();
    if (changed) this.events.emit('legendtoggle', { series: seriesIndex, visible });
  }

  isSeriesVisible(seriesIndex: number): boolean {
    const meta = this.chartMeta;
    return meta && meta.kind !== 'bar' && meta.kind !== 'heatmap' ? (meta.visible[seriesIndex] ?? false) : false;
  }

  /** Fades every series but `seriesIndex` (`null` clears). */
  emphasizeSeries(seriesIndex: number | null): void {
    this.backend.set_chart_emphasis?.(seriesIndex ?? -1);
  }

  /** Zooms the x axis of a 2D line chart (`factor` < 1 zooms in) around `anchorNdcX` (-1..1). */
  zoomChartX(factor: number, anchorNdcX = 0): void {
    this.changeRange(() => this.backend.chart_zoom_x?.(factor, anchorNdcX));
  }

  /** Pans the x axis of a 2D line chart by a canvas-relative NDC delta. */
  panChartX(deltaNdcX: number): void {
    this.changeRange(() => this.backend.chart_pan_x?.(deltaNdcX));
  }

  /**
   * Changes how the line chart's y domain is derived; `options` are merged into the current
   * ones (pass `min: undefined` to free an end). Axes, gridlines and hover follow on the next
   * frame.
   */
  setYDomain(options: LineYDomainOptions): void {
    const meta = this.chartMeta;
    if (meta?.kind !== 'line') return;
    const y = { ...meta.yDomain, ...options };
    meta.yDomain = y;
    this.backend.set_chart_y_domain?.(y.min ?? NaN, y.max ?? NaN, Y_AUTOSCALE_CODES[y.autoscale ?? 'all'] ?? 0, y.nice ?? true);
  }

  /** Current `[min, max]` of the line chart's y domain, or null. */
  getYDomain(): [number, number] | null {
    const kind = this.chartMeta?.kind;
    const d = kind === 'line' ? this.backend.chart_y_domain?.() : kind === 'combo' ? this.backend.chart_combo_y_domain?.(0) : undefined;
    return d && d.length >= 2 ? [d[0], d[1]] : null;
  }

  /** Like `setYDomain`, for the right y axis of a dual-axis line chart. */
  setY2Domain(options: LineYDomainOptions): void {
    const meta = this.chartMeta;
    if (meta?.kind !== 'line') return;
    const y = { ...meta.y2Domain, ...options };
    meta.y2Domain = y;
    this.backend.set_chart_y2_domain?.(y.min ?? NaN, y.max ?? NaN, Y_AUTOSCALE_CODES[y.autoscale ?? 'all'] ?? 0, y.nice ?? true);
  }

  /** Current `[min, max]` of the right y domain, or null (no right-axis series). */
  getY2Domain(): [number, number] | null {
    const kind = this.chartMeta?.kind;
    const d = kind === 'line' ? this.backend.chart_y2_domain?.() : kind === 'combo' ? this.backend.chart_combo_y_domain?.(1) : undefined;
    return d && d.length >= 2 ? [d[0], d[1]] : null;
  }

  /**
   * Changes the scale of one axis of the active 2D line / area / scatter chart: `'x'`, `'y'`
   * (left), or `'y2'` (right axis of a dual-axis line chart); `options` are merged into the
   * current ones. Log needs positive values (line x: numeric `x`; index / time x stay linear).
   * A changed mapping resets that axis's zoom; ticks, gridlines, annotations and hover follow on
   * the next frame.
   */
  setAxisScale(axis: ChartAxisName, options: ChartScaleOptions): void {
    const kind = this.chartMeta?.kind;
    if (kind !== 'line' && kind !== 'scatter') return;
    const o = { ...(this.getAxisScale(axis) ?? {}), ...options };
    this.changeRange(() => this.backend.set_chart_axis_scale?.(AXIS_CODES[axis], ...encodeScale(o)));
  }

  /** Current scale options of one axis, or null (no line / area / scatter chart). */
  getAxisScale(axis: ChartAxisName): Required<ChartScaleOptions> | null {
    return decodeScale(this.backend.chart_axis_scale?.(AXIS_CODES[axis]));
  }

  /** Sends the scale options of every axis that sets any (others keep the engine default). */
  private applyAxisScales(axes: Partial<Record<ChartAxisName, ChartScaleOptions>>): void {
    for (const name of Object.keys(axes) as ChartAxisName[]) {
      const o = axes[name];
      if (hasScaleOptions(o)) this.backend.set_chart_axis_scale?.(AXIS_CODES[name], ...encodeScale(o));
    }
  }

  /**
   * Replaces the data of one line / area series without re-rendering the chart. Stacked / percent
   * areas require the same length and x coordinates as the other series. Styles, legend state
   * and the zoom window are kept (a window touching the right edge stays pinned to the latest
   * data). `x` is required iff the chart was rendered with `x`. Data point ids of every series
   * are re-based (offsets follow the new lengths). Like `renderLineChart`, `values` is kept by
   * reference for tooltips / a11y: do not mutate it afterwards. Returns the new sample count.
   */
  setSeriesData(seriesIndex: number, values: Float32Array | number[], x?: Float64Array | number[] | Date[]): number {
    const meta = this.lineMetaFor(seriesIndex, 'setSeriesData', x);
    const v = values instanceof Float32Array ? values : Float32Array.from(numericSamples(values));
    const xv = meta.xs && x ? toF64(x) : EMPTY_F64;
    if (meta.xs && xv.length !== v.length) {
      throw new Error(`setSeriesData: ${xv.length} x for ${v.length} values`);
    }
    if (meta.area && meta.area !== 'overlap' && meta.names.length > 1) {
      const peer = seriesIndex === 0 ? 1 : 0;
      if (v.length !== meta.lengths[peer]) throw new Error('setSeriesData: stacked areas need aligned samples');
      const peerX = meta.stale.has(peer) ? this.backend.chart_series_x?.(peer) : meta.xs?.[peer];
      if (peerX && (xv.length !== peerX.length || xv.some((x, i) => x !== peerX[i]))) {
        throw new Error('setSeriesData: stacked areas need shared x');
      }
    }
    if (meta.area && !this.backend.set_chart_series_data) throw new Error('setSeriesData: backend does not support area updates');
    const len = this.backend.set_chart_series_data?.(seriesIndex, v, xv) ?? v.length;
    meta.values[seriesIndex] = values;
    if (meta.xs) meta.xs[seriesIndex] = xv;
    meta.stale.delete(seriesIndex);
    // The engine keeps a band only while the length matches (chart-linestyle.ts)
    if (meta.bands?.[seriesIndex] && meta.bands[seriesIndex]!.lower.length !== len) meta.bands[seriesIndex] = null;
    this.onLineDataChanged(meta, seriesIndex, len);
    return len;
  }

  /**
   * Streams samples onto one line / overlap area series. Stacked / percent areas use
   * `appendAreaData` instead. `x` (required iff the chart
   * has `x`) must not go back before the series' last x. With `maxPoints` the oldest samples
   * beyond it are dropped and ids are re-based. Amortized O(appended) in the engine plus a
   * rebuild of the visible window on the next frame; the SDK keeps no copy of streamed data
   * (tooltips / a11y read it back from the engine). Returns the new sample count.
   */
  appendSeriesData(
    seriesIndex: number,
    values: Float32Array | number[],
    x?: Float64Array | number[] | Date[],
    options?: AppendSeriesOptions
  ): number {
    const meta = this.lineMetaFor(seriesIndex, 'appendSeriesData', x);
    if (meta.area && meta.area !== 'overlap') throw new Error('appendSeriesData: use appendAreaData for aligned stacked updates');
    if (meta.area && !this.backend.append_chart_series_data) throw new Error('appendSeriesData: backend does not support area updates');
    const v = values instanceof Float32Array ? values : Float32Array.from(numericSamples(values));
    const xv = meta.xs && x ? toF64(x) : EMPTY_F64;
    if (meta.xs && xv.length !== v.length) {
      throw new Error(`appendSeriesData: ${xv.length} x for ${v.length} values`);
    }
    const maxPoints = Math.max(0, Math.floor(options?.maxPoints ?? 0));
    const append = this.backend.append_chart_series_data;
    let len: number;
    if (append && this.backend.chart_series_values) {
      len = append.call(this.backend, seriesIndex, v, xv, maxPoints);
      meta.stale.add(seriesIndex);
    } else {
      // Backends without read-back: mirror the data here (O(length) per call)
      len = append
        ? append.call(this.backend, seriesIndex, v, xv, maxPoints)
        : Math.min(meta.lengths[seriesIndex] + v.length, maxPoints || Infinity);
      this.mirrorAppend(meta, seriesIndex, v, xv, len);
    }
    // Streamed band: tooltips read the engine's copy; the static table copy no longer lines up
    if (meta.bands?.[seriesIndex]) meta.bands[seriesIndex] = streamedBand();
    this.onLineDataChanged(meta, seriesIndex, len);
    return len;
  }

  /**
   * Atomically appends one chunk per area series, in render order. Stacked / percent chunks
   * must have equal lengths and identical x; overlap chunks may differ. Validation failure
   * leaves every series unchanged. `maxPoints` trims each series to its newest samples.
   * Styles, visibility and the zoom window are preserved. Returns the retained lengths.
   * Stacks recompute cumulative tops in O(retained samples); overlap uses the line FIFO path.
   */
  appendAreaData(chunks: readonly SeriesDataChunk[], options?: AppendSeriesOptions): number[] {
    const meta = this.chartMeta;
    if (meta?.kind !== 'line' || !meta.area) throw new Error('appendAreaData: no area chart is rendered');
    const batch = packAreaAppend(chunks, meta.names.length, meta.xs !== null, meta.area !== 'overlap', options?.maxPoints);
    const append = this.backend.append_area_data;
    if (!append) throw new Error('appendAreaData: backend does not support atomic area updates');
    const lengths = Array.from(append.call(this.backend, batch.values, batch.lengths, batch.xs, batch.maxPoints));
    let at = 0;
    lengths.forEach((len, s) => {
      const end = at + batch.lengths[s];
      if (this.backend.chart_series_values) meta.stale.add(s);
      else this.mirrorAppend(meta, s, batch.values.subarray(at, end), batch.xs.subarray(at, end), len);
      meta.lengths[s] = len;
      at = end;
    });
    // Rebase ids and invalidate dependent UI once, after the entire batch commits.
    if (lengths.length) this.onLineDataChanged(meta, 0, lengths[0]);
    return lengths;
  }

  private lineMetaFor(seriesIndex: number, fn: string, x: unknown): LineChartMeta {
    const meta = this.chartMeta;
    if (meta?.kind === 'line' && meta.standaloneBand) throw new Error(`${fn}: band charts require both edges; use renderBandChart`);
    if (meta?.kind === 'line' && meta.sparse) throw new Error(`${fn}: replace all channels with ${meta.sparse.kind === 'errorBar' ? 'renderErrorBarChart' : 'renderImpulseChart'}`);
    if (meta?.kind !== 'line') throw new Error(`${fn}: no line chart is rendered`);
    if (!Number.isInteger(seriesIndex) || seriesIndex < 0 || seriesIndex >= meta.names.length) {
      throw new Error(`${fn}: series ${seriesIndex} out of range`);
    }
    if (!meta.xs && x !== undefined) throw new Error(`${fn}: the chart has no x; pass values only`);
    return meta;
  }

  /** Fallback for backends without `chart_series_values`: concatenates and trims in TS. */
  private mirrorAppend(meta: LineChartMeta, s: number, v: Float32Array, xv: Float64Array, len: number): void {
    const join = <T extends Float32Array | Float64Array>(a: T, b: T, out: T): T => {
      out.set(a.subarray(Math.max(0, a.length + b.length - len)));
      out.set(b.subarray(Math.max(0, b.length - len)), Math.max(0, len - b.length));
      return out;
    };
    const old = meta.values[s];
    meta.values[s] = join(old instanceof Float32Array ? old : Float32Array.from(old), v, new Float32Array(len));
    if (meta.xs) meta.xs[s] = join(meta.xs[s], xv, new Float64Array(len));
  }

  private onLineDataChanged(meta: LineChartMeta, s: number, len: number): void {
    meta.lengths[s] = len;
    let acc = 0;
    meta.lengths.forEach((n, i) => {
      meta.offsets[i] = acc;
      acc += n;
    });
    this.scheduleA11yRefresh();
    // New data can move the visible range (follow-latest, growing x domain)
    if (this.events.has('rangechange')) {
      this.lastRange ??= this.readRange();
      this.rangeFrame.request();
    }
  }

  /** Streaming calls this every frame: re-sync summaries / data table at most 4x per second. */
  private scheduleA11yRefresh(): void {
    if (this.a11yRefreshTimer !== null) return;
    this.a11yRefreshTimer = setTimeout(() => {
      this.a11yRefreshTimer = null;
      this.a11y.refresh();
    }, 250);
  }

  /** Chart meta with streamed line series re-read from the engine (for a11y / exports). */
  private syncedChartMeta(): ChartMeta | null {
    const meta = this.chartMeta;
    if (meta?.kind === 'line' && meta.stale.size > 0) {
      for (const s of meta.stale) {
        meta.values[s] = this.backend.chart_series_values?.(s) ?? meta.values[s];
        if (meta.xs) meta.xs[s] = this.backend.chart_series_x?.(s) ?? meta.xs[s];
      }
      meta.stale.clear();
    }
    return meta;
  }

  /** Value and x of a line sample: SDK arrays, or the engine for streamed series. */
  private lineSample(meta: LineChartMeta, series: number, index: number): { value: number; x?: number } | null {
    if (index < 0 || index >= (meta.lengths[series] ?? 0)) return null;
    if (!meta.stale.has(series)) {
      const values = meta.values[series];
      if (!values || index >= values.length) return null;
      return { value: Number(values[index]), x: meta.xs?.[series]?.[index] };
    }
    const s = this.backend.chart_sample?.(meta.offsets[series] + index);
    if (!s || s.length < 3) return null;
    return { value: s[2], x: meta.xs && s.length >= 7 ? s[6] : undefined };
  }

  /** Zooms both axes of a scatter chart (`factor` < 1 zooms in) around an NDC anchor (-1..1). */
  zoomChartXY(factor: number, anchorNdcX = 0, anchorNdcY = 0): void {
    this.changeRange(() => this.backend.chart_zoom_xy?.(factor, anchorNdcX, anchorNdcY));
  }

  /** Pans both axes of a scatter chart by a canvas-relative NDC delta (+y = up). */
  panChartXY(deltaNdcX: number, deltaNdcY: number): void {
    this.changeRange(() => this.backend.chart_pan_xy?.(deltaNdcX, deltaNdcY));
  }

  resetChartZoom(): void {
    this.changeRange(() => this.backend.chart_reset_zoom?.());
  }

  /**
   * Zooms the y axis (`factor` < 1 zooms in) around `anchorNdcY` (-1..1): line / area charts pin
   * their y domain there (autoscale pauses until `resetChartZoom`), scatter charts zoom y.
   * Returns true when the view moved.
   */
  zoomChartY(factor: number, anchorNdcY = 0): boolean {
    let changed = false;
    this.changeRange(() => (changed = this.backend.chart_zoom_y?.(factor, anchorNdcY) ?? false));
    return changed;
  }

  /**
   * Box zoom: zooms x and y to the canvas rectangle between two NDC corners (-1..1, +y up),
   * clamped to the plot (line / area / scatter / candlestick). Records an undo step; true when
   * the view moved.
   */
  zoomChartBox(x0: number, y0: number, x1: number, y1: number): boolean {
    this.backend.chart_zoom_history_push?.();
    let changed = false;
    this.changeRange(() => (changed = this.backend.chart_zoom_box?.(x0, y0, x1, y1) ?? false));
    if (!changed) this.backend.chart_zoom_history_trim?.();
    return changed;
  }

  /** Records the current zoom as an undo step (wheel / drag / box gestures do it themselves). */
  pushZoomHistory(): void {
    this.backend.chart_zoom_history_push?.();
  }

  /** Back to the zoom before the last gesture; true when the view moved. */
  undoZoom(): boolean {
    let changed = false;
    this.changeRange(() => (changed = this.backend.chart_zoom_undo?.() ?? false));
    return changed;
  }

  /** Re-applies the last undone zoom; true when the view moved. */
  redoZoom(): boolean {
    let changed = false;
    this.changeRange(() => (changed = this.backend.chart_zoom_redo?.() ?? false));
    return changed;
  }

  /** Undo / redo depth of the zoom history (at most 50 steps; cleared by a new chart). */
  get zoomHistory(): ZoomHistoryState {
    return readHistory(this.backend);
  }

  clearZoomHistory(): void {
    this.backend.chart_zoom_history_clear?.();
  }

  /**
   * Brush selection mode of chart mouse drags: `'x'` (x interval), `'xy'` (rectangle), or `false`
   * (drag navigates; default). Needs an `enableNodeInteractions` binding. `style` sets the brush
   * look (kept across charts).
   */
  setChartBrush(mode: BrushMode | false, style?: BrushStyleOptions): void {
    this.chartBrushMode = mode;
    if (style) this.chartBrushStyle = style;
  }

  getChartBrush(): BrushMode | false {
    return this.chartBrushMode;
  }

  /** Committed brush selection of the active chart (re-queried after data / legend changes), or `null`. */
  getSelection(): CharturboSelection | null {
    return this.readSelection(this.backend.chart_selection?.());
  }

  /**
   * Selects a data rectangle like a brush release (x: sample index / x value / `Date`, category
   * index for bars; `y` omitted = x interval). Emits `'select'`; returns the selection, `null`
   * outside 2D charts.
   */
  selectChartRange(x: [number | Date, number | Date], y?: [number, number]): CharturboSelection | null {
    const sel = this.readSelection(
      this.backend.chart_select_range?.(Number(x[0]), Number(x[1]), y ? y[0] : NaN, y ? y[1] : NaN)
    );
    if (sel) this.events.emit('select', sel);
    return sel;
  }

  /** Removes the brush and its selection; emits an empty `'select'` when something was selected. */
  clearChartSelection(): void {
    const had = (this.backend.chart_selection?.()?.length ?? 0) > 0;
    this.backend.chart_clear_selection?.();
    const kind = selectionKind(this.chartMode);
    if (had && kind) this.events.emit('select', emptySelection(kind));
  }

  /** Commits the live brush (drag release) and emits `'select'`. */
  private commitBrush(): CharturboSelection | null {
    const sel = this.readSelection(this.backend.chart_brush_end?.());
    if (sel) this.events.emit('select', sel);
    return sel;
  }

  private readSelection(header: Float64Array | undefined): CharturboSelection | null {
    const kind = header && header.length >= 8 ? header[0] : -1;
    // Line selections are index runs only: skip the id copy (bar / scatter / candle carry ids)
    const selection = decodeSelection(header, kind >= 1 ? this.backend.chart_selection_ids?.() : undefined);
    if (selection?.kind === 'candlestick' && this.chartMode === 'ohlc') selection.kind = 'ohlc';
    if (selection?.kind === 'line' && this.chartMode === 'band') selection.kind = 'band';
    if (selection?.kind === 'line' && (this.chartMode === 'errorBar' || this.chartMode === 'impulse')) selection.kind = this.chartMode;
    return selection;
  }

  /**
   * Visible x range in data units: line charts the series `x` (epoch ms on time axes) or the
   * sample index, scatter charts x values. `null` for bar charts / without a chart.
   */
  getXRange(): [number, number] | null {
    const r = this.readRange();
    return r ? [r.xMin, r.xMax] : null;
  }

  /** Visible y range in data units: the line / area y domain (autoscaled or zoomed), scatter y (`null` otherwise). */
  getYRange(): [number, number] | null {
    const r = this.readRange();
    return r && r.yMin !== undefined && r.yMax !== undefined ? [r.yMin, r.yMax] : null;
  }

  /**
   * Zooms the x axis to `[min, max]` in data units (2D line / scatter charts; `Date`s on time
   * axes), clamped to the data and the zoom limit like wheel zoom. Returns true when the view
   * moved; call `render()` to draw it.
   */
  setXRange(min: number | Date, max: number | Date): boolean {
    let changed = false;
    this.changeRange(() => (changed = this.backend.chart_set_x_range?.(Number(min), Number(max)) ?? false));
    return changed;
  }

  /**
   * Zooms the y axis to `[min, max]` in data units (see `setXRange`): scatter charts zoom y,
   * line / area charts pin the y domain (until `resetChartZoom`).
   */
  setYRange(min: number, max: number): boolean {
    let changed = false;
    this.changeRange(() => (changed = this.backend.chart_set_y_range?.(min, max) ?? false));
    return changed;
  }

  /**
   * Data x of the current chart hover's primary point (line: series `x` or sample index; bar:
   * category index; scatter: x), `null` without one. What synced charts hover at.
   */
  getHoverX(): number | null {
    const x = this.chartMode ? this.backend.chart_hover_x?.() : undefined;
    return x !== undefined && Number.isFinite(x) ? x : null;
  }

  /**
   * Hovers the chart at data `x` like a pointer resting there in index mode (crosshair + markers
   * of every series at that x; bars: the category at `round(x)`), without `'hover'` events.
   * `null` / out of range clears. `tooltip` also shows the built-in tooltip (needs
   * `enableNodeInteractions`). Returns true when something is hovered; call `render()` to draw.
   */
  hoverAtX(x: number | Date | null, options?: { tooltip?: boolean }): boolean {
    if (!this.chartMode) return false;
    const v = x === null ? NaN : Number(x);
    const hit = Number.isFinite(v) ? this.backend.chart_hover_at_data_x?.(v) : undefined;
    if (!hit) this.backend.chart_clear_hover?.();
    const hovered = !!hit && hit.length >= 3 && hit[2] >= 1;
    this.syncTooltip?.(hovered && options?.tooltip ? hit : null);
    return hovered;
  }

  /**
   * Joins the cursor / zoom sync group `options.key` (leaving any previous one), or leaves with
   * `null`. Members share the hovered data x (`cursor`, needs `enableNodeInteractions` on the
   * hovered chart) and the visible x range (`x`) in data units; see `Charturbo.connect`.
   */
  setSync(options: ChartSyncMemberOptions | null): void {
    if (options) joinSyncGroup(this, options);
    else leaveSyncGroup(this);
  }

  /** Sync group key and effective flags of this instance (`null` when not synced). */
  getSync(): ChartSyncMemberOptions | null {
    return syncMembership(this);
  }

  /**
   * Synchronizes crosshair / hover (`cursor`, default true) and x zoom / pan (`x`, default true)
   * across charts, each with its own canvas and engine. An array forms a new group; a key sets
   * the options of the instances that joined it with `sync: { key }`. Positions travel in data
   * units (epoch ms on time axes, sample / category index otherwise), are clamped by each chart
   * to its own domain, and are applied at most once per animation frame (followers re-render).
   * Followers show crosshair + markers only unless `tooltip` is set. Returns the disconnect.
   */
  static connect(group: string | readonly Charturbo[], options?: ChartSyncOptions): () => void {
    return connectCharts(group, options);
  }

  /** Visible chart range from the engine (`null` without a line / scatter chart). */
  private readRange(): CharturboRange | null {
    const a = this.chartMode ? this.backend.chart_range?.() : undefined;
    if (!a || a.length < 2) return null;
    return Number.isFinite(a[2]) && Number.isFinite(a[3])
      ? { xMin: a[0], xMax: a[1], yMin: a[2], yMax: a[3] }
      : { xMin: a[0], xMax: a[1] };
  }

  /** Sends the navigator strip (theme-derived colors) to the engine; it re-frames the plot. */
  private syncNavigator(): void {
    const nav = this.chartNavigator;
    if (!nav) return;
    const t = this.theme;
    const rgb = (c: RgbaTuple, a: number) => [c[0], c[1], c[2], a];
    const style = new Float32Array([
      NaN, NaN, NaN, NaN,
      ...rgb(t.surface, 0.6),
      ...rgb(t.crosshair, 0.12),
      ...rgb(t.baseline, 0.9),
      ...rgb(t.crosshair, 1),
    ]);
    this.backend.set_chart_navigator?.(true, nav.height, style);
  }

  /** Navigator strip `[left, top, width, height]` in CSS px (`null` without one). */
  getNavigatorRect(): [number, number, number, number] | null {
    const r = this.chartNavigator ? this.backend.chart_navigator_rect?.() : undefined;
    return r && r.length >= 4 ? [r[0], r[1], r[2], r[3]] : null;
  }

  /** Runs a zoom / pan; `'rangechange'` listeners hear about it on the next frame. */
  private changeRange(apply: () => void): void {
    if (!this.events.has('rangechange')) return apply();
    // Baseline to compare against (captured lazily: no engine call without listeners)
    this.lastRange ??= this.readRange();
    apply();
    this.rangeFrame.request();
  }

  private flushRangeChange(): void {
    const r = this.readRange();
    if (sameRange(r, this.lastRange)) return;
    this.lastRange = r;
    if (r) this.events.emit('rangechange', r);
  }

  /**
   * Replaces the annotations of the active 2D chart: reference lines (`hline` / `vline`), bands
   * (`yband` / `xband`), point markers, and text, in data units (line: sample index or `x`
   * value; bar: category index; scatter: x / y). They follow zoom / pan, are clipped to the plot,
   * and are cleared when a new chart is rendered. Labels are DOM pills in the chart overlay.
   */
  setAnnotations(list: readonly ChartAnnotation[]): void {
    // Encode first: an invalid color throws without leaving a bad entry behind
    this.syncAnnotations([...list]);
  }

  /** Appends one annotation; returns its index. */
  addAnnotation(annotation: ChartAnnotation): number {
    this.syncAnnotations([...this.chartAnnotations, annotation]);
    return this.chartAnnotations.length - 1;
  }

  clearAnnotations(): void {
    this.chartAnnotations = [];
    this.backend.clear_chart_annotations?.();
    this.chartOverlay?.annotations.invalidate();
  }

  getAnnotations(): ChartAnnotation[] {
    return [...this.chartAnnotations];
  }

  /** Sends `next` (default: the current list) to the engine and commits it once encoded. */
  private syncAnnotations(next: ChartAnnotation[] = this.chartAnnotations): void {
    const e = encodeAnnotations(next, this.theme);
    this.chartAnnotations = next;
    this.backend.set_chart_annotations?.(
      e.kinds,
      e.coords,
      e.colors,
      e.widths,
      e.dash,
      e.opacity,
      e.layers,
      e.labelPositions
    );
    if (e.yAxes.includes(1)) this.backend.set_chart_annotation_y_axes?.(e.yAxes);
    this.chartOverlay?.annotations.invalidate();
  }

  /** Accessible `<table>` of the active chart's data (caption, scoped headers); see chart-a11y.ts. */
  showDataTable(container?: HTMLElement, options?: DataTableOptions): HTMLTableElement | null {
    return this.a11y.showDataTable(container, options);
  }

  hideDataTable(): void {
    this.a11y.hideDataTable();
  }

  /**
   * Chart data as `{ columns, rows }` (line: x rows x series columns; bar: categories; heatmap:
   * grid rows x columns). Full by default; `maxRows` / `maxColumns` downsample evenly (first /
   * last kept, `sampledRows` / `sampledColumns` set). A full 4096 x 4096 heatmap is 16M cells:
   * cap it, or use `exportChartCSV()`, which streams rows.
   */
  getChartDataTable(options?: DataTableOptions): ChartDataTable | null {
    return this.a11y.getDataTable(options);
  }

  /** `getChartDataTable()` as RFC 4180 CSV (CRLF rows). */
  exportChartCSV(): string {
    return this.a11y.exportCSV();
  }

  /**
   * Chart image: the canvas re-rendered (at `pixelRatio`, default the current one) with the DOM
   * overlay (title, legend, axis labels) composited on top; see chart-export.ts.
   */
  toImage(options?: ChartImageOptions): Promise<Blob> {
    return chartToBlob(this.exportHost(), options);
  }

  /** `toImage` as a `data:` URL. */
  toDataURL(options?: ChartImageOptions): Promise<string> {
    return chartToDataURL(this.exportHost(), options);
  }

  /** Downloads `toImage` (format from the extension unless `options.format` is given). */
  downloadImage(filename = 'chart.png', options?: ChartImageOptions): Promise<void> {
    return downloadChartImage(this.exportHost(), filename, options);
  }

  /**
   * The current 2D chart view as a vector SVG document (chart-svg.ts): engine marks as paths /
   * rects / circles (decimated lines stay decimated; `maxMarks` caps points), clipped like the
   * canvas, plus the DOM overlay as `<text>`. Heatmaps embed their plot as a PNG; 3D views and
   * kinds without a vector writer embed the canvas (with a console warning).
   */
  exportChartSVG(options?: ChartSvgOptions): string {
    return chartToSvg(this.svgHost(), options);
  }

  /** Downloads `exportChartSVG()`. */
  downloadChartSVG(filename = 'chart.svg', options?: ChartSvgOptions): void {
    downloadChartSvg(this.svgHost(), filename, options);
  }

  /** One-page PDF of the chart image (`toImage`, PNG): raster; use `exportChartSVG` for vector. */
  async toPDF(options?: Omit<ChartImageOptions, 'format' | 'quality'>): Promise<Blob> {
    const canvas = this.canvas;
    if (!canvas) throw new Error('toPDF: no canvas (create the SDK with Charturbo.create)');
    const cssW = canvas.clientWidth || canvas.getBoundingClientRect().width || canvas.width;
    const cssH = canvas.height / (canvas.width / Math.max(1, cssW));
    const image = await captureChartCanvas(this.exportHost(), { ...options, format: 'png' });
    return canvasToPdf(image, cssW, cssH, this.chartPresentation?.title);
  }

  /** Downloads `toPDF()`. */
  async downloadChartPDF(filename = 'chart.pdf', options?: Omit<ChartImageOptions, 'format' | 'quality'>): Promise<void> {
    saveBlob(await this.toPDF(options), filename);
  }

  /**
   * Copies the chart image (PNG, `toImage`) to the clipboard. Resolves false when the browser
   * has no `ClipboardItem` / `clipboard.write` or refuses (call it from a user gesture).
   */
  copyChartImage(options?: Omit<ChartImageOptions, 'format' | 'quality'>): Promise<boolean> {
    if (!canCopyImage()) return Promise.resolve(false);
    return copyPngToClipboard(this.toImage({ ...options, format: 'png' }));
  }

  private svgHost() {
    // Exports show the final frame, not a running animation
    this.animDriverRef?.finish();
    return {
      canvas: this.canvas,
      overlay: this.chartOverlay?.root ?? null,
      theme: this.theme,
      backend: this.backend,
      render: () => this.render(),
      kind: this.chartMode,
    };
  }

  private exportHost(): ChartExportHost {
    // Exports show the final frame, not a running animation
    this.animDriverRef?.finish();
    return {
      canvas: this.canvas,
      overlay: this.chartOverlay?.root ?? null,
      theme: this.theme,
      backend: this.backend,
      render: () => this.render(),
    };
  }

  /**
   * GPU buffer / texture bytes, chart upload bytes, staged mark counts and the WebAssembly
   * memory size of this engine (chart-stats.ts); null on backends without counters.
   */
  getRenderStats(): CharturboRenderStats | null {
    return readRenderStats(this.backend);
  }

  /** Short text summary of the active chart (the canvas `aria-label`). */
  getChartSummary(): string {
    return this.sparkline ? this.sparklineAriaLabel() : this.a11y.summary();
  }

  /** True when the active chart handles wheel / drag itself (2D line chart navigation). */
  handlesChartNavigation(): boolean {
    return !!this.chartPresentation?.navigable;
  }

  /**
   * True while chart mouse drags draw a brush (`setChartBrush` on and a chart shown): hosts should
   * skip their own drag handling unless Alt is held (Alt + drag navigates).
   */
  handlesChartBrush(): boolean {
    // 2D charts with a data frame only (no 3D bars / 2.5D lines / heatmaps / box plots / pies)
    return (
      this.chartBrushMode !== false &&
      this.chartMode !== null &&
      this.flatCameraView &&
      this.chartMode !== 'heatmap' &&
      this.chartMode !== 'box' &&
      this.chartMode !== 'pie' &&
      this.chartMode !== 'combo' &&
      !isBusinessKind(this.chartMode) &&
      !this.isHierarchyChart() &&
      // Horizontal bars: categories run along y, no x brush
      !((this.chartMeta?.kind === 'bar' || this.chartMeta?.kind === 'bar-multi') && this.chartMeta.barStyle?.orientation === 'horizontal')
    );
  }

  /** True while an `enableNodeInteractions` binding owns touch / pen gestures (hosts should skip their own). */
  handlesTouchGestures(): boolean {
    return this.touchGestureOwners > 0;
  }

  /**
   * True while built-in camera controls (`enableNodeInteractions` `cameraControls`) drive the
   * camera of the current graph / 3D view: hosts should skip their own camera drag / wheel handling.
   */
  handlesCameraControls(): boolean {
    return this.cameraControlOwners > 0 && !this.chartMode;
  }

  /** Detaches every interaction, removes overlay DOM, and releases the WASM engine. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    leaveSyncGroup(this);
    this.stopAutoResize?.();
    this.stopAutoResize = null;
    this.rangeFrame.cancel();
    this.animDriverRef?.dispose();
    this.events.clear();
    for (const detach of [...this.disposers]) detach();
    this.disposers.clear();
    // The a11y layer's pending refresh reads the sparkline summary from the engine: drop it first
    this.sparkline = null;
    this.sparklineInteractions = null;
    this.removeChartOverlay();
    if (this.a11yRefreshTimer !== null) clearTimeout(this.a11yRefreshTimer);
    this.a11yRefreshTimer = null;
    this.a11y.dispose();
    this.chartMode = null;
    this.chartMeta = null;
    this.backend.free?.();
  }

  private themedHover(h: ChartHoverStyle = {}): ChartHoverStyle {
    const t = this.theme;
    return { crosshairColor: t.crosshair, markerRingColor: t.surface, ...h };
  }

  private themedGrid(g: ChartGridStyle = {}): ChartGridStyle {
    const t = this.theme;
    return { color: t.grid, baselineColor: t.baseline, ...g };
  }

  /** Derives plot padding from the overlay content, then applies user overrides. */
  private applyChartPadding(p: ChartPresentation, hasLegend: boolean, overrides?: ChartPaddingOptions): void {
    // Every 2D render passes here: invalid axis format specs throw from the render call, not later
    for (const a of [p.xAxis, p.yAxis, p.y2Axis]) resolveFormat(a?.format, this.chartLocale());
    const top = 12 + (p.title ? 24 : 0) + (hasLegend ? 28 : 0);
    const left = (p.yAxis.show === false ? 12 : 56) + (p.yAxis.title ? 20 : 0);
    const bottom = (p.xAxis.show === false ? 12 : 30) + (p.xAxis.title ? 20 : 0);
    const right = p.y2Axis ? (p.y2Axis.show === false ? 12 : 56) + (p.y2Axis.title ? 20 : 0) : 16;
    const pad = { top, right, bottom, left, ...overrides };
    this.backend.set_chart_padding?.(pad.top, pad.right, pad.bottom, pad.left);
    this.chartPadding = pad;
  }

  private removeChartOverlay(): void {
    this.chartOverlay?.root.remove();
    this.chartOverlay = null;
  }

  /** (Re)creates the overlay DOM for the active chart. Needs a canvas (`create` / interactions). */
  private rebuildChartOverlay(): void {
    this.removeChartOverlay();
    // Sparklines draw everything on the GPU: no overlay DOM at all
    if (this.sparkline) return this.a11y.refresh();
    const p = this.chartPresentation;
    const canvas = this.canvas;
    if (!p || !canvas || typeof document === 'undefined') return this.a11y.refresh();
    const t = this.theme;

    const div = (style: Partial<CSSStyleDeclaration>, className: string) => {
      const el = document.createElement('div');
      el.className = className;
      Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', ...style });
      return el;
    };
    const root = div(
      {
        left: '0px',
        top: '0px',
        width: '0px',
        height: '0px',
        overflow: 'visible',
        zIndex: '5',
        fontFamily: t.fontFamily,
        color: t.textSecondary,
      },
      'charturbo-sdk-chart-overlay'
    );
    const pad = this.chartPadding;
    const title = div(
      {
        left: `${pad.left}px`,
        right: `${pad.right}px`,
        top: '10px',
        fontSize: '14px',
        fontWeight: '600',
        color: t.textPrimary,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      },
      'charturbo-sdk-chart-title'
    );
    title.textContent = p.title ?? '';
    title.style.display = p.title ? 'block' : 'none';

    const legend = div(
      {
        left: `${pad.left}px`,
        right: `${pad.right}px`,
        top: `${p.title ? 36 : 10}px`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 14px',
        fontSize: '12px',
        pointerEvents: 'auto',
      },
      'charturbo-sdk-chart-legend'
    );
    legend.setAttribute('role', 'group');
    legend.setAttribute('aria-label', 'Chart legend');
    const meta = this.chartMeta;
    if (meta && meta.kind !== 'bar' && meta.kind !== 'heatmap' && p.legend.show) {
      const bars = meta.kind === 'bar-multi' || meta.kind === 'box' || meta.kind === 'pie' || meta.kind === 'waterfall' || meta.kind === 'treemap' || meta.kind === 'sunburst' || meta.kind === 'sankey';
      // Scatter series read as dots
      const dot = meta.kind === 'scatter';
      meta.names.forEach((name, i) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'charturbo-sdk-legend-item';
        item.dataset.series = String(i);
        Object.assign(item.style, {
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '2px 0',
          border: 'none',
          background: 'none',
          font: 'inherit',
          color: t.textSecondary,
          cursor: p.legend.toggle ? 'pointer' : 'default',
        });
        const swatch = document.createElement('span');
        // Line series: a stroke; bar series: a filled square; scatter series: a dot
        Object.assign(swatch.style, {
          width: dot ? '8px' : bars ? '10px' : '12px',
          height: dot ? '8px' : bars ? '10px' : '3px',
          borderRadius: dot ? '50%' : '2px',
          background: rgbaToCss(meta.colors[i]),
          flex: 'none',
        });
        // Combo: each series keeps the swatch of its mark
        if (meta.kind === 'combo') Object.assign(swatch.style, comboSwatch(meta.types[i], rgbaToCss(meta.colors[i])));
        const label = document.createElement('span');
        label.textContent = name;
        label.style.whiteSpace = 'nowrap';
        item.append(swatch, label);
        if (p.legend.toggle) {
          item.addEventListener('click', () => this.setSeriesVisible(i, !meta.visible[i]));
        }
        if (p.legend.emphasize) {
          item.addEventListener('pointerenter', () => meta.visible[i] && this.emphasizeSeries(i));
          item.addEventListener('pointerleave', () => this.emphasizeSeries(null));
          item.addEventListener('focus', () => meta.visible[i] && this.emphasizeSeries(i));
          item.addEventListener('blur', () => this.emphasizeSeries(null));
        }
        legend.appendChild(item);
      });
    } else if (meta?.kind === 'bar' && p.legend.show) {
      // Single-series bars: a static category color key (nothing to toggle)
      for (const k of meta.legendKey ?? []) {
        const item = div({ position: 'static', display: 'inline-flex', alignItems: 'center', gap: '6px', color: t.textSecondary }, 'charturbo-sdk-legend-item');
        const swatch = document.createElement('span');
        Object.assign(swatch.style, { width: '10px', height: '10px', borderRadius: '2px', background: rgbaToCss(k.color), flex: 'none' });
        const label = document.createElement('span');
        label.textContent = k.name;
        label.style.whiteSpace = 'nowrap';
        item.append(swatch, label);
        legend.appendChild(item);
      }
    }

    if (meta?.kind === 'bar' && meta.legendEntry && p.legend.show) {
      // Single-series bars: one static entry (nothing to toggle)
      const item = document.createElement('span');
      item.className = 'charturbo-sdk-legend-item';
      Object.assign(item.style, { display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 0', color: t.textSecondary });
      const swatch = document.createElement('span');
      Object.assign(swatch.style, { width: '10px', height: '10px', borderRadius: '2px', background: rgbaToCss(meta.legendEntry.color), flex: 'none' });
      const label = document.createElement('span');
      label.textContent = meta.legendEntry.name;
      label.style.whiteSpace = 'nowrap';
      item.append(swatch, label);
      legend.appendChild(item);
    }

    const xTitle = div(
      { fontSize: '12px', color: t.textSecondary, transform: 'translate(-50%, 0)', whiteSpace: 'nowrap' },
      'charturbo-sdk-axis-title'
    );
    xTitle.textContent = p.xAxis.title ?? '';
    const yTitle = div(
      { fontSize: '12px', color: t.textSecondary, transform: 'translate(-50%, -50%) rotate(-90deg)', whiteSpace: 'nowrap' },
      'charturbo-sdk-axis-title'
    );
    yTitle.textContent = p.yAxis.title ?? '';
    let y2Title: HTMLDivElement | null = null;
    if (p.y2Axis) {
      y2Title = div(
        { fontSize: '12px', color: t.textSecondary, transform: 'translate(-50%, -50%) rotate(90deg)', whiteSpace: 'nowrap' },
        'charturbo-sdk-axis-title'
      );
      y2Title.textContent = p.y2Axis.title ?? '';
    }

    root.append(title, legend, xTitle, yTitle);
    if (y2Title) root.append(y2Title);
    (canvas.parentElement ?? document.body).appendChild(root);
    this.chartOverlay = {
      root,
      title,
      legend,
      xTitle,
      yTitle,
      y2Title,
      ticks: [],
      axesRevision: -1,
      annotations: new AnnotationLabelLayer(root),
    };
    if (meta?.kind === 'heatmap' && meta.colorbar.show) {
      const colorbar = new HeatmapColorbarLayer(root, meta);
      colorbar.refresh(this.backend, t, this.chartLocale());
      this.chartOverlay.colorbar = colorbar;
    }
    if (meta?.kind === 'pie') this.chartOverlay.pie = new PieLabelLayer(root, meta);
    if (isBusinessMeta(meta)) this.chartOverlay.business = createBusinessLabelLayer(root, meta);
    if (meta?.kind === 'treemap' || meta?.kind === 'sunburst' || meta?.kind === 'sankey') {
      // Breadcrumb clicks drill up (and re-render: there is no pointer event behind them)
      const crumbs = { left: this.chartPadding.left, top: (p.title ? 36 : 10) + (p.legend.show ? 28 : 0) };
      this.chartOverlay.hierarchy = new HierarchyLabelLayer(
        root,
        meta,
        (node) => {
          if (this.drillTo(node)) this.render();
        },
        crumbs
      );
    }
    if ((meta?.kind === 'bar' || meta?.kind === 'bar-multi') && meta.barStyle?.labels) {
      const n = meta.kind === 'bar-multi' ? Math.max(1, meta.categories.length) : 1;
      this.chartOverlay.bars = new BarLabelLayer(root, meta.barStyle, (id) =>
        meta.kind === 'bar' ? meta.colors[id] : meta.colors[Math.floor(id / n)]
      );
    }
    this.syncLegendState();
    this.updateChartOverlay();
    this.a11y.refresh();
  }

  private syncLegendState(): void {
    const meta = this.chartMeta;
    const legend = this.chartOverlay?.legend;
    if (!meta || meta.kind === 'bar' || meta.kind === 'heatmap' || !legend) return;
    legend.querySelectorAll<HTMLButtonElement>('.charturbo-sdk-legend-item').forEach((item) => {
      const on = meta.visible[Number(item.dataset.series)];
      item.setAttribute('aria-pressed', String(on));
      item.style.opacity = on ? '1' : '0.45';
      item.style.textDecoration = on ? 'none' : 'line-through';
    });
  }

  /** Keeps the overlay over the canvas and re-lays out tick labels when the engine moved them. */
  private updateChartOverlay(): void {
    const o = this.chartOverlay;
    const p = this.chartPresentation;
    const canvas = this.canvas;
    if (!o || !p || !canvas) return;
    // Overlay box = canvas box, so title / legend can size against it
    o.root.style.left = `${canvas.offsetLeft}px`;
    o.root.style.top = `${canvas.offsetTop}px`;
    o.root.style.width = `${canvas.offsetWidth}px`;
    o.root.style.height = `${canvas.offsetHeight}px`;
    o.annotations.update(this.backend, this.chartAnnotations, this.theme);
    o.pie?.update(this.backend, this.theme, (v) => this.pieValueText(v), this.chartLocale());
    o.hierarchy?.update(this.backend, this.theme, (v) => this.hierValueText(v), this.chartLocale());
    o.bars?.update(this.backend, this.theme);
    o.business?.update(this.backend, this.theme, this.chartLocale());

    const rev = this.backend.chart_axes_revision?.() ?? 0;
    if (rev === o.axesRevision) return;
    o.axesRevision = rev;
    const a = this.backend.chart_axes?.();
    if (!a || a.length < 5) return;
    const [plotL, plotT, plotW, plotH, count] = a;
    // Optional trailing block: one time granularity code per tick (older engines omit it)
    const granAt = a.length >= 5 + count * 5 ? 5 + count * 4 : -1;
    const t = this.theme;

    let used = 0;
    /** x labels in tick order with their anchor x (for collision thinning below) */
    const xLabels: { el: HTMLDivElement; x: number; value: number }[] = [];
    for (let k = 0; k < count; k++) {
      const axis = a[5 + k * 4];
      const value = a[6 + k * 4];
      const x = a[7 + k * 4];
      const y = a[8 + k * 4];
      // axis 2 = right y (dual-axis line charts)
      const opts = axis === 0 ? p.xAxis : axis === 2 ? (p.y2Axis ?? { show: false }) : p.yAxis;
      if (opts.show === false) continue;
      let el = o.ticks[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'charturbo-sdk-axis-tick';
        Object.assign(el.style, {
          position: 'absolute',
          fontSize: '11px',
          whiteSpace: 'nowrap',
          fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none',
        });
        o.root.appendChild(el);
        o.ticks.push(el);
      }
      used++;
      el.style.display = 'block';
      el.style.color = t.textMuted;
      el.textContent =
        axis === 0
          ? p.formatX(value, granAt < 0 ? 0 : a[granAt + k])
          : (resolveFormat(opts.format, this.chartLocale()) ?? ((v: number) => formatTickValue(v, this.chartLocale())))(value);
      if (axis === 0) {
        el.style.left = `${x}px`;
        el.style.top = `${y + 6}px`;
        el.style.transform = 'translate(-50%, 0)';
        xLabels.push({ el, x, value });
      } else if (axis === 2) {
        el.style.left = `${x + 8}px`;
        el.style.top = `${y}px`;
        el.style.transform = 'translate(0, -50%)';
      } else {
        el.style.left = `${x - 8}px`;
        el.style.top = `${y}px`;
        el.style.transform = 'translate(-100%, -50%)';
      }
    }
    for (let k = used; k < o.ticks.length; k++) o.ticks[k].style.display = 'none';
    thinCenteredLabels(xLabels, [0, canvas.offsetWidth]);

    o.xTitle.style.left = `${plotL + plotW / 2}px`;
    o.xTitle.style.top = `${plotT + plotH + (p.xAxis.show === false ? 6 : 24)}px`;
    const meta = this.chartMeta;
    const horizontalBars = (meta?.kind === 'bar' || meta?.kind === 'bar-multi') && meta.barStyle?.orientation === 'horizontal';
    // Horizontal bars size the left margin to the category labels: the title sits at its edge
    const yTitleGap = horizontalBars && p.yAxis.show !== false ? Math.max(62, plotL - 10) : p.yAxis.show === false ? 14 : 62;
    o.yTitle.style.left = `${plotL - yTitleGap}px`;
    o.yTitle.style.top = `${plotT + plotH / 2}px`;
    if (o.y2Title) {
      o.y2Title.style.left = `${plotL + plotW + (p.y2Axis?.show === false ? 14 : 62)}px`;
      o.y2Title.style.top = `${plotT + plotH / 2}px`;
    }
    o.colorbar?.layout([plotL, plotT, plotW, plotH], this.chartLocale());
  }

  /** Removes every scene object and the active chart. */
  clearScene(): void {
    this.objectRecords.clear();
    this.backend.clear_scene_objects?.();
    this.exitChartMode();
    this.overviewDistance = null;
    for (const hook of this.hoverResetHooks) hook();
  }

  /**
   * Changes the stroke width (CSS pixels) of the current line chart.
   * Pass `seriesIndex` to change a single series; omit it to change every series.
   */
  setLineWidth(widthPx: number, seriesIndex?: number): void {
    this.backend.set_chart_line_width?.(seriesIndex ?? -1, widthPx);
  }

  /** Updates the hover layer style of the current chart (crosshair, markers, bar highlight). */
  setChartHoverStyle(style: ChartHoverStyle): void {
    this.backend.set_chart_hover_style?.(encodeHoverStyle(style));
  }

  /** Updates the gridlines of the current chart. */
  setChartGrid(show: boolean, style?: ChartGridStyle): void {
    this.backend.set_chart_frame_style?.(encodeGridStyle(show, style));
  }

  /** Re-frames the camera on the current chart. */
  fitChartToView(): void {
    this.changeRange(() => this.backend.chart_fit_view?.());
  }

  /** How graph / point-cloud views mark the hovered node. */
  setNodeHoverStyle(style: NodeHoverStyle): void {
    const c = parseOptionalColor(style.color) ?? [1, 1, 1, 1];
    this.backend.set_node_hover_style?.(
      style.enabled ?? true,
      style.scale ?? 1.6,
      c[0],
      c[1],
      c[2],
      c[3],
      style.color !== undefined
    );
  }

  /**
   * Physical pixels per CSS pixel used for chart strokes and markers. The engine derives it from
   * the canvas on `resize()`; call this only to override it.
   */
  setPixelRatio(ratio: number): void {
    this.backend.set_pixel_ratio?.(ratio);
  }

  objectCount(): number {
    return this.backend.object_count?.() ?? this.objectRecords.size;
  }

  getObjects(): SceneObjectRecord[] {
    for (const rec of this.objectRecords.values()) {
      this.syncRecordTransformFromBackend(rec);
    }
    return Array.from(this.objectRecords.values());
  }

  getObjectRecord(objectId: number): SceneObjectRecord | null {
    const rec = this.objectRecords.get(objectId);
    if (!rec) return null;
    this.syncRecordTransformFromBackend(rec);
    return { ...rec };
  }

  setLighting(lighting: SceneLightingDescriptor): void {
    this.lightingState = {
      ...this.lightingState,
      ...lighting,
    };
    const l = this.lightingState;
    this.backend.set_scene_lighting?.(
      l.ambientIntensity,
      l.directionalDirection[0],
      l.directionalDirection[1],
      l.directionalDirection[2],
      l.directionalIntensity,
      l.pointPosition[0],
      l.pointPosition[1],
      l.pointPosition[2],
      l.pointIntensity
    );
  }

  getLighting(): Required<SceneLightingDescriptor> {
    return { ...this.lightingState };
  }

  setHelpers(helpers: SceneHelpersDescriptor): void {
    this.helpersState = {
      ...this.helpersState,
      ...helpers,
    };
    const h = this.helpersState;
    this.backend.set_scene_helpers?.(
      h.showGrid,
      h.gridSize,
      h.gridDivisions,
      h.showAxes,
      h.axesLength
    );
  }

  getHelpers(): Required<SceneHelpersDescriptor> {
    return { ...this.helpersState };
  }

  setRigidPhysics(enabled: boolean, gravity?: Vec3Tuple): void {
    this.rigidPhysicsState.enabled = enabled;
    if (gravity) {
      this.rigidPhysicsState.gravity = [...gravity];
    }
    const g = this.rigidPhysicsState.gravity;
    this.backend.set_rigid_physics?.(enabled, g[0], g[1], g[2]);
  }

  getRigidPhysics(): { enabled: boolean; gravity: Vec3Tuple } {
    return {
      enabled: this.rigidPhysicsState.enabled,
      gravity: [...this.rigidPhysicsState.gravity],
    };
  }

  pickObjectAtNdc(ndcX: number, ndcY: number): number | null {
    const id = this.backend.pick_object_at_ndc?.(ndcX, ndcY) ?? -1;
    return id > 0 ? id : null;
  }

  raycastObjectAtNdc(
    ndcX: number,
    ndcY: number
  ): { objectId: number; point: Vec3Tuple } | null {
    const res = this.backend.raycast_object_at_ndc?.(ndcX, ndcY);
    if (res && res.length === 4 && res[0] > 0) {
      return {
        objectId: Math.round(res[0]),
        point: [res[1], res[2], res[3]],
      };
    }
    return null;
  }

  selectObject(objectId: number | null): void {
    this.backend.select_object?.(objectId ?? -1);
  }

  /**
   * Declaratively loads an entire 3D Scene from a `SceneDescriptor` (clearing existing objects).
   */
  loadScene(descriptor: SceneDescriptor): number[] {
    this.clearScene();
    if (descriptor.lighting) {
      this.setLighting(descriptor.lighting);
    }
    if (descriptor.helpers) {
      this.setHelpers(descriptor.helpers);
    }
    if (descriptor.rigidPhysics) {
      this.setRigidPhysics(descriptor.rigidPhysics.enabled, descriptor.rigidPhysics.gravity);
    }
    if (descriptor.graphVisible !== undefined) {
      this.setGraphVisible(descriptor.graphVisible);
    }

    const createdIds: number[] = [];
    for (const item of descriptor.objects) {
      if (item.kind === 'primitive') {
        createdIds.push(this.addPrimitive(item));
      } else {
        createdIds.push(this.addCustomMesh(item));
      }
    }
    return createdIds;
  }

  /**
   * Exports the current 3D Scene (objects, transforms, materials, physics, lighting, helpers) as a serializable `SceneDescriptor`.
   */
  exportScene(): SceneDescriptor {
    const objects = this.getObjects().map((rec) => {
      if (rec.kind === 'primitive') {
        return {
          kind: 'primitive' as const,
          name: rec.name,
          shape: rec.shape ?? 'box',
          position: [...rec.position] as Vec3Tuple,
          rotation: [...rec.rotation] as Vec3Tuple,
          scale: [...rec.scale] as Vec3Tuple,
          color: [...rec.color] as RgbaTuple,
          metallic: rec.metallic,
          roughness: rec.roughness,
          emissive: rec.emissive,
          bodyType: rec.bodyType,
          velocity: [...rec.velocity] as Vec3Tuple,
          angularVelocity: [...rec.angularVelocity] as Vec3Tuple,
          mass: rec.mass,
          restitution: rec.restitution,
          parentId: rec.parentId,
        };
      }
      return {
        kind: 'custom' as const,
        name: rec.name,
        positions: rec.customMesh?.positions ?? [],
        normals: rec.customMesh?.normals ?? [],
        indices: rec.customMesh?.indices ?? [],
        position: [...rec.position] as Vec3Tuple,
        rotation: [...rec.rotation] as Vec3Tuple,
        scale: [...rec.scale] as Vec3Tuple,
        color: [...rec.color] as RgbaTuple,
        metallic: rec.metallic,
        roughness: rec.roughness,
        emissive: rec.emissive,
        bodyType: rec.bodyType,
        velocity: [...rec.velocity] as Vec3Tuple,
        angularVelocity: [...rec.angularVelocity] as Vec3Tuple,
        mass: rec.mass,
        restitution: rec.restitution,
        parentId: rec.parentId,
      };
    });

    return {
      lighting: this.getLighting(),
      helpers: this.getHelpers(),
      rigidPhysics: this.getRigidPhysics(),
      graphVisible: this.graphVisibleState,
      objects,
    };
  }

  // ---------------------------------------------------------------------------
  // High-Volume 2D / 2.5D / 3D Chart Builders (Line, Bar, Scatter/Bubble)
  // ---------------------------------------------------------------------------

  /**
   * Positions the camera either dead-on perpendicular to the XY plane (`'2d'`)
   * for crisp flat 2D charts, or at an isometric perspective angle (`'3d'`).
   */
  setChartViewMode(mode: '2d' | '3d', distance = 152): void {
    this.flatCameraView = mode === '2d';
    if (mode === '2d') {
      this.setCameraPose([0, 0, distance], [0, 0, 0]);
    } else {
      this.setCameraPose([68, 52, distance * 0.88], [0, 0, 0]);
    }
  }

  /**
   * Renders a multi-series line chart natively (Rust + WebGPU): screen-resolution M4 decimation,
   * constant-pixel strokes, nice-tick axes, legend, x zoom / pan, and GPU hover overlays.
   * Handles 1,000,000+ points at 60 FPS. Data point ids = series offset + sample index.
   */
  renderLineChart(
    seriesList: LineSeriesDescriptor[],
    options?: LineChartOptions
  ): { totalPoints: number; seriesCount: number } {
    return this.renderLineLike(seriesList, options, null);
  }

  /** Two independent curves filled between their edges (no center line required).
   * Shares numeric / time axes, dual-edge LOD, legend, zoom, brush and vector export.
   * Replace both channels together by calling this method again.
   */
  renderBandChart(series: BandSeriesDescriptor[], options?: BandChartOptions): { totalPoints: number; seriesCount: number } {
    const bands = encodeBands(series, options);
    if (!this.backend.set_band_series || (series.some((s) => s.x !== undefined) ? !this.backend.set_line_chart_xy : !this.backend.set_line_chart)) {
      throw new Error('renderBandChart: backend does not support standalone bands');
    }
    return this.renderLineLike(bands.map((b) => b.line), { ...options, viewMode: '2d' }, null, bands);
  }

  /** Independent high/low whiskers around each center; all channels are replaced atomically. */
  renderErrorBarChart(series: ErrorBarSeriesDescriptor[], options?: ErrorBarChartOptions): { totalPoints: number; seriesCount: number } {
    const sparse = encodeErrorBars(series, options);
    return this.renderSparse(sparse, options);
  }

  /** Independent stems from each series baseline to its samples, with optional tip markers. */
  renderImpulseChart(series: ImpulseSeriesDescriptor[], options?: ImpulseChartOptions): { totalPoints: number; seriesCount: number } {
    return this.renderSparse(encodeImpulses(series, options), options);
  }

  private renderSparse(sparse: EncodedSparse, options?: LineChartOptions): { totalPoints: number; seriesCount: number } {
    const fn = sparse.meta.kind === 'errorBar' ? 'renderErrorBarChart' : 'renderImpulseChart';
    const supported = sparse.meta.kind === 'errorBar' ? this.backend.set_error_bar_series : this.backend.set_impulse_series;
    if (!supported || (sparse.lines.some(s => s.x) ? !this.backend.set_line_chart_xy : !this.backend.set_line_chart)) {
      throw new Error(`${fn}: backend does not support ${sparse.meta.kind}`);
    }
    return this.renderLineLike(sparse.lines, { ...options, viewMode: '2d' }, null, undefined, sparse);
  }

  /**
   * Renders a 2D area chart natively: overlapping areas filled to zero, stacked areas, or
   * percent-stacked areas (`options.mode`). Strokes, M4 decimation, axes (index / numeric / time
   * x), legend (toggle re-stacks), zoom / pan, and hover work like `renderLineChart`; tooltips
   * show the raw series values plus the total (stacked) or each share (percent).
   */
  renderAreaChart(
    seriesList: LineSeriesDescriptor[],
    options?: AreaChartOptions
  ): { totalPoints: number; seriesCount: number } {
    return this.renderLineLike(seriesList, { ...options, viewMode: '2d' }, {
      mode: options?.mode ?? 'overlap',
      fillOpacity: options?.fillOpacity ?? NaN,
    });
  }

  /**
   * Renders a sparkline: a line / area / bar / win-loss chart with zero chrome (no axes, grid,
   * legend, title or overlay DOM; ~2 px padding; no zoom; tooltip opt-in). Last / min / max
   * markers and the reference band are engine marks; the canvas gets `role="img"` and a trend
   * aria-label (`'Revenue: trend up 12% from 100 to 112, min 95, max 120'`). Pair with a shared
   * `CharturboDevice` for pages with hundreds of sparklines. Data updates (`setSeriesData`) move the
   * markers. See chart-sparkline.ts.
   */
  renderSparkline(data: SparklineData | Float32Array | number[], options?: SparklineOptions): SparklineResult {
    const spec = resolveSparkline(sparklineData(data), options, this.theme, this.canvasCssSize(), this.chartLocale());
    const bars = spec.type === 'bar' || spec.type === 'winloss';
    const padding = spec.padding;
    const hidden = { show: false };
    this.sparkline = spec;
    this.sparklineBuilding = true;
    try {
      if (bars) {
        this.renderBarChart(sparklineBarItems(spec), {
          width: spec.width,
          maxBarHeight: spec.height,
          cornerRadius: 1,
          color: spec.color,
          padding,
          axes: { x: hidden, y: hidden },
          description: spec.description,
        });
        // Bars keep their 2D grid by default: sparklines have none
        this.chartGridShown = false;
        this.backend.set_chart_frame_style?.(encodeGridStyle(false, this.themedGrid(this.chartGrid)));
      } else {
        const series = [{ name: spec.name, values: spec.values, x: spec.x, color: spec.color, lineWidth: spec.lineWidth }];
        this.renderLineLike(
          series,
          {
            width: spec.width,
            height: spec.height,
            legend: false,
            showBackdropGrid: false,
            padding,
            // Tight y domain: the line spans the full height
            axes: { x: hidden, y: { show: false, nice: false } },
            description: spec.description,
          },
          spec.type === 'area' ? { mode: 'overlap', fillOpacity: spec.fillOpacity } : null
        );
      }
    } catch (err) {
      this.sparkline = null;
      throw err;
    } finally {
      this.sparklineBuilding = false;
    }
    if (this.chartPresentation) this.chartPresentation.navigable = false;
    applySparklineMarks(this.backend, spec);
    if (spec.tooltip && !this.sparklineInteractions && this.canvas) {
      this.sparklineInteractions = this.enableNodeInteractions(this.canvas, { chartNavigation: false, autoRender: true });
    } else if (!spec.tooltip && this.sparklineInteractions) {
      this.sparklineInteractions();
      this.sparklineInteractions = null;
    }
    this.a11y.refresh();
    return {
      pointCount: spec.values.length,
      summary: readSparklineSummary(this.backend, spec.values),
      label: this.sparklineAriaLabel(),
    };
  }

  /** Re-renders an auto-sized sparkline for a new canvas aspect, keeping streamed line data. */
  private refitSparkline(sp: SparklineSpec): void {
    let data = sp.input.data;
    const meta = this.syncedChartMeta();
    if (meta?.kind === 'line' && (sp.type === 'line' || sp.type === 'area')) {
      const x0 = data.x?.[0];
      const xs = meta.xs?.[0];
      data = {
        values: meta.values[0],
        x: xs ? (x0 instanceof Date ? Array.from(xs, (v) => new Date(v)) : xs) : undefined,
      };
    }
    this.renderSparkline(data, sp.input.options);
  }

  private sparklineAriaLabel(): string {
    const sp = this.sparkline;
    if (!sp) return '';
    return sparklineLabel(sp, readSparklineSummary(this.backend, sp.values), this.chartLocale());
  }

  /** Canvas CSS size (client box, else backing size / DPR, else 120 x 30). */
  private canvasCssSize(): [number, number] {
    const c = this.canvas;
    if (!c) return [120, 30];
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const w = c.clientWidth || c.width / dpr || 120;
    const h = c.clientHeight || c.height / dpr || 30;
    return [w, h];
  }

  /** Line and area charts share data packing, axes, legend, and tooltip metadata. */
  private renderLineLike(
    seriesList: LineSeriesDescriptor[],
    options: LineChartOptions | undefined,
    area: { mode: 'overlap' | 'stacked' | 'percent'; fillOpacity: number } | null,
    standaloneBands?: EncodedBand[],
    sparse?: EncodedSparse
  ): { totalPoints: number; seriesCount: number } {
    const fn = standaloneBands ? 'renderBandChart' : area ? 'renderAreaChart' : 'renderLineChart';
    // Unknown zones throw here, not on a later frame
    if (options?.timeZone !== undefined) validateTimeZone(options.timeZone);
    this.clearScene();
    this.applyChartAnimation(options?.animation);
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const palette = this.theme.palette;
    const lineWidth = options?.lineWidth ?? 2;
    const lengths = new Uint32Array(seriesList.length);
    const colors = new Float32Array(seriesList.length * 4);
    const widths = new Float32Array(seriesList.length);
    const offsets: number[] = [];
    let totalPoints = 0;
    seriesList.forEach((s, i) => {
      offsets.push(totalPoints);
      lengths[i] = s.values.length;
      totalPoints += s.values.length;
      colors.set(parseOptionalColor(s.color) ?? palette[i % palette.length], i * 4);
      widths[i] = s.lineWidth ?? lineWidth;
    });
    // A single Float32Array series is passed as is (no concatenated copy of large data)
    const single = seriesList.length === 1 ? numericSamples(seriesList[0].values) : null;
    const values = single instanceof Float32Array ? single : new Float32Array(totalPoints);
    if (values !== single) seriesList.forEach((s, i) => values.set(numericSamples(s.values), offsets[i]));

    // Optional per-sample x, concatenated like `values` (validated by the engine)
    const withX = seriesList.filter((s) => s.x).length;
    if (withX !== 0 && withX !== seriesList.length) {
      throw new Error(`${fn}: give \`x\` for every series or none`);
    }
    let xs: Float64Array | null = null;
    if (withX !== 0 && (area ? this.backend.set_area_chart : this.backend.set_line_chart_xy)) {
      const x0 = seriesList[0].x;
      xs = seriesList.length === 1 && x0 instanceof Float64Array ? x0 : new Float64Array(totalPoints);
      seriesList.forEach((s, i) => {
        const x = s.x!;
        if (x.length !== s.values.length) {
          throw new Error(`${fn}: series ${i} has ${x.length} x for ${s.values.length} values`);
        }
        if (x === xs) return;
        if (x instanceof Float64Array) xs!.set(x, offsets[i]);
        else for (let k = 0; k < x.length; k++) xs![offsets[i] + k] = Number(x[k]);
      });
    }
    if (!area) validateLineBands(seriesList, fn);
    const xAxisOpt = options?.axes?.x ?? {};
    const dateX = seriesList.some((s) => s.x !== undefined && s.x.length > 0 && s.x[0] instanceof Date);
    const timeX = (xAxisOpt.type ?? (dateX ? 'time' : 'numeric')) === 'time';

    const viewMode = options?.viewMode ?? '2d';
    if (area) {
      this.backend.set_area_chart?.(
        values,
        lengths,
        xs ?? new Float64Array(0),
        colors,
        widths,
        options?.width ?? 168,
        options?.height ?? 86,
        { overlap: 0, stacked: 1, percent: 2 }[area.mode] ?? 0,
        area.fillOpacity,
        timeX ? 1 : 0
      );
    } else if (xs) {
      this.backend.set_line_chart_xy!(
        values,
        lengths,
        xs,
        colors,
        widths,
        options?.width ?? 168,
        options?.height ?? 86,
        viewMode === '2.5d' ? 1 : 0,
        timeX ? 1 : 0
      );
    } else {
      this.backend.set_line_chart?.(
        values,
        lengths,
        colors,
        widths,
        options?.width ?? 168,
        options?.height ?? 86,
        viewMode === '2.5d' ? 1 : 0
      );
    }
    // Markers / dashes / curves / null policies / bands (chart-linestyle.ts)
    const bands = applyLineStyles(this.backend, seriesList, options?.nulls, fn, area === null);
    standaloneBands?.forEach((b, i) => {
      this.backend.set_band_series!(i, b.lower, b.upper, b.opacity, ...b.widths);
      bands[i] = { lower: b.lower, upper: b.upper };
    });
    sparse?.styles.forEach((style, i) => {
      const error = sparse.meta.errors?.[i];
      if (error) this.backend.set_error_bar_series!(i, error.low, error.high, style);
      else this.backend.set_impulse_series!(i, style[0], style[1] !== 0, style[2]);
    });
    this.chartHover = options?.hover;
    this.chartGrid = options?.grid;
    this.chartGridShown = options?.showBackdropGrid ?? true;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));

    const xPrefix = options?.xLabelPrefix ?? 'T';
    // Chart option wins over the SDK locale (`setLocale`), read lazily so later changes apply
    const locale = () => this.chartLocale();
    const tz = () => this.chartTimeZone();
    const userFormatX = resolveFormatLive(xAxisOpt.format, locale);
    // Numeric x: full digits (no compact notation, which would merge nearby ticks like 10020 / 10040)
    const formatXNumber = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 6 });
    // Tick labels get the engine's granularity code; tooltip / details labels format the raw x
    const formatX: ChartPresentation['formatX'] =
      xs && timeX
        ? (v, g) => (userFormatX ?? ((ms, gn) => formatChartTime(ms, gn, locale(), tz())))(v, TIME_GRANULARITIES[g ?? 0])
        : (v) => (userFormatX ?? (xs ? formatXNumber : (i: number) => `${xPrefix}+${i.toLocaleString(locale())}`))(v);
    const formatXValue = !xs
      ? (v: number) => `${xPrefix}+${v}`
      : (userFormatX ?? (timeX ? (v: number) => formatChartTime(v, undefined, locale(), tz()) : formatXNumber));
    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const flat = viewMode === '2d';
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? seriesList.length >= 2,
      toggle: legendOpt.toggle ?? true,
      emphasize: legendOpt.emphasize ?? true,
    };
    this.chartMode = sparse?.meta.kind ?? (standaloneBands ? 'band' : 'line');
    this.chartMeta = {
      kind: 'line',
      names: seriesList.map((s) => s.name),
      colors: seriesList.map((_, i) => [colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]]),
      values: seriesList.map((s) => s.values),
      offsets,
      lengths: Array.from(lengths),
      stale: new Set(),
      xPrefix,
      xs: xs ? offsets.map((o, i) => xs!.subarray(o, o + lengths[i])) : null,
      yDomain: {},
      y2Domain: {},
      formatXValue: (v) => formatXValue(v),
      visible: seriesList.map(() => true),
      ...(area ? { area: area.mode } : {}),
      ...(bands.some((b) => b) ? { bands } : {}),
      ...(standaloneBands ? { standaloneBand: true } : {}),
      ...(sparse ? { sparse: sparse.meta } : {}),
    };
    // 2.5D is an angled view: one-finger touch orbits it
    this.flatCameraView = flat;
    const percentAxis: ChartAxisOptions =
      area?.mode === 'percent' ? { format: (v) => `${formatTickValue(v)}%` } : {};
    // Opt-in right y axis: only when a series asks for it (line charts)
    const seriesAxes = area ? null : encodeSeriesAxes(seriesList);
    // Axes are a 2D concept; the 2.5D view keeps legend + title only
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: flat ? xAxisOpt : { show: false },
      yAxis: flat ? { ...percentAxis, ...(options?.axes?.y ?? {}) } : { show: false },
      ...(seriesAxes && flat ? { y2Axis: options?.axes?.y2 ?? {} } : {}),
      legend,
      navigable: flat,
      formatX,
      locale: options?.locale,
      timeZone: options?.timeZone,
    };
    if (seriesAxes) this.backend.set_chart_series_axes?.(seriesAxes);
    this.applyAxisScales({ x: xAxisOpt, y: options?.axes?.y, ...(seriesAxes ? { y2: options?.axes?.y2 } : {}) });
    const y = options?.axes?.y;
    if (y && (y.min !== undefined || y.max !== undefined || y.autoscale !== undefined || y.nice !== undefined)) {
      this.setYDomain({ min: y.min, max: y.max, autoscale: y.autoscale, nice: y.nice });
    }
    const y2 = seriesAxes ? options?.axes?.y2 : undefined;
    if (y2 && (y2.min !== undefined || y2.max !== undefined || y2.autoscale !== undefined || y2.nice !== undefined)) {
      this.setY2Domain({ min: y2.min, max: y2.max, autoscale: y2.autoscale, nice: y2.nice });
    }
    this.applyChartPadding(this.chartPresentation, legend.show, options?.padding);
    this.chartNavigator = flat ? resolveNavigator(options?.navigator) : null;
    if (this.chartNavigator) this.syncNavigator();
    this.rebuildChartOverlay();
    return { totalPoints, seriesCount: seriesList.length };
  }

  /**
   * Renders a bar chart natively: flat 2D bars with rounded data ends and nice-tick axes, or a
   * lit 3D matrix. Negative values hang below the zero baseline. Hover highlights on the GPU.
   */
  renderBarChart(
    items: BarChartItemDescriptor[],
    options?: BarChartOptions
  ): { barCount: number } {
    this.clearScene();
    this.applyChartAnimation(options?.animation);
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);

    const viewMode = options?.viewMode ?? '2d';
    const n = items.length;
    if (n === 0) return { barCount: 0 };
    this.setHelpers(
      viewMode === '2d'
        ? { showGrid: false, showAxes: false }
        : { showGrid: true, gridSize: 165, gridDivisions: 16, showAxes: false }
    );

    const baseColor = parseOptionalColor(options?.color) ?? this.theme.palette[0];
    // Without a chart color, item categories pick palette colors in first-seen order (fixed, not
    // cycled: categories past the palette share the neutral baseline color)
    const palette = this.theme.palette;
    const categoryIndex = new Map<string, number>();
    const categoryColor = (category: string): RgbaTuple => {
      if (!categoryIndex.has(category)) categoryIndex.set(category, categoryIndex.size);
      const k = categoryIndex.get(category)!;
      return k < palette.length ? palette[k] : this.theme.baseline;
    };
    const values = new Float32Array(n);
    const colors = new Float32Array(n * 4);
    let maxVal = 0;
    let sumVal = 0;
    items.forEach((item, i) => {
      values[i] = item.value;
      const byCategory = options?.color === undefined && item.category !== undefined;
      colors.set(parseOptionalColor(item.color) ?? (byCategory ? categoryColor(item.category!) : baseColor), i * 4);
      maxVal = Math.max(maxVal, Math.abs(item.value));
      sumVal += Math.max(0, item.value);
    });

    this.backend.set_bar_chart?.(
      values,
      colors,
      options?.width ?? 164,
      options?.maxBarHeight ?? 78,
      options?.barThickness ?? 0,
      options?.cornerRadius ?? 4,
      viewMode === '3d' ? 1 : 0
    );
    const barStyle = viewMode === '2d' ? this.initBarStyle(options, encodeErrors([items.map((it) => it.error)], n)) : undefined;
    this.chartHover = options?.hover;
    this.chartGrid = options?.grid;
    this.chartGridShown = viewMode === '2d';
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));

    this.chartMode = 'bar';
    this.chartMeta = {
      kind: 'bar',
      colors: items.map((_, i) => [colors[i * 4], colors[i * 4 + 1], colors[i * 4 + 2], colors[i * 4 + 3]]),
      metadata: items.map((item) => ({
        label: item.label,
        category: item.category ?? (viewMode === '2d' ? '2D Bar / Histogram' : '3D Matrix Column'),
        description: `${item.label} 항목의 수치 및 전체 대비 비중 데이터입니다.`,
        tags: ['bar-chart', item.label.toLowerCase()],
        attributes: {
          value: Number(item.value.toFixed(2)),
          shareOfTotal: `${sumVal > 0 ? ((Math.max(0, item.value) / sumVal) * 100).toFixed(2) : '0.00'}%`,
          peakRatio: `${maxVal > 0 ? ((item.value / maxVal) * 100).toFixed(1) : '0.0'}%`,
          ...(item.attributes ?? {}),
        },
      })),
      values,
      barStyle,
    };
    const flat = viewMode === '2d';
    this.flatCameraView = flat;
    const truncate = (s: string) => (s.length > 12 ? `${s.slice(0, 11)}…` : s);
    const category = (i: number) => truncate(items[i]?.label ?? String(i));
    // Single series: a legend only on request, one static entry
    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legendShown = flat && (legendOpt.show ?? false);
    // Items with categories: a key of the categories; else one entry for the series
    const legendKey = barLegendKey(items, this.chartMeta.colors);
    if (legendShown && legendKey.length > 0) this.chartMeta.legendKey = legendKey;
    else if (legendShown) this.chartMeta.legendEntry = { name: options?.seriesName ?? 'Value', color: baseColor };
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      ...this.barAxes(flat, barStyle, options?.axes ?? {}, category, {}),
      legend: { show: legendShown, toggle: false, emphasize: false },
      navigable: false,
    };
    this.syncBarLabels();
    this.applyChartPadding(this.chartPresentation, legendShown, {
      ...this.barPadding(this.chartPresentation, legendShown, barStyle, items.map((_, i) => category(i))),
      ...options?.padding,
    });
    this.rebuildChartOverlay();
    return { barCount: n };
  }

  /** Orientation / error bars / label options of a fresh 2D bar chart (chart-bar-style.ts). */
  private initBarStyle(
    options: BarChartOptions | undefined,
    errors: [Float32Array, Float32Array] | [null, null]
  ): BarStyleState | undefined {
    const horizontal = options?.orientation === 'horizontal';
    const labels = resolveBarLabels(options?.labels);
    if (!horizontal && !labels && !errors[0]) return undefined;
    const state: BarStyleState = {
      orientation: horizontal ? 'horizontal' : 'vertical',
      labels,
      errMinus: errors[0],
      errPlus: errors[1],
      errorBar: options?.errorBars ?? {},
      texts: [],
    };
    if (horizontal || errors[0]) sendBarStyle(this.backend, state, this.theme);
    return state;
  }

  /**
   * Axis presentation of a bar chart: the category axis is x (vertical bars) or y (horizontal
   * bars, where `axes.x` describes the value axis). `valueAxis` holds value-axis defaults.
   */
  private barAxes(
    flat: boolean,
    style: BarStyleState | undefined,
    axes: { x?: ChartAxisOptions; y?: ChartAxisOptions },
    category: (i: number) => string,
    valueAxis: ChartAxisOptions
  ): Pick<ChartPresentation, 'xAxis' | 'yAxis' | 'formatX'> {
    if (!flat) return { xAxis: { show: false }, yAxis: { show: false }, formatX: (v) => category(v) };
    if (style?.orientation === 'horizontal') {
      const xAxis = { ...valueAxis, ...(axes.x ?? {}) };
      const formatValue = resolveFormatLive(xAxis.format, () => this.chartLocale());
      return {
        xAxis,
        yAxis: { ...(axes.y ?? {}), format: axes.y?.format ?? category },
        formatX: (v) => (formatValue ? formatValue(v) : formatTickValue(v, this.chartLocale())),
      };
    }
    // Category axis: no time granularity
    const formatCategory = resolveFormatLive(axes.x?.format, () => this.chartLocale());
    return {
      xAxis: axes.x ?? {},
      yAxis: { ...valueAxis, ...(axes.y ?? {}) },
      formatX: (v) => (formatCategory ? formatCategory(v) : category(v)),
    };
  }

  /**
   * Padding derived for bar styling: horizontal bars size the left margin to the category
   * labels and keep room for outside labels on the right; vertical outside labels get room above.
   */
  private barPadding(
    p: ChartPresentation,
    legend: boolean,
    style: BarStyleState | undefined,
    categories: string[]
  ): ChartPaddingOptions {
    if (!style) return {};
    const outside = style.labels !== null && style.labels.position === 'outside';
    const font = this.theme.fontFamily;
    if (style.orientation === 'horizontal') {
      const longest = categories.reduce((w, c) => Math.max(w, measureLabel(c, font)), 0);
      const left = p.yAxis.show === false ? 12 : Math.min(168, Math.max(48, longest + 16));
      return {
        left: left + (p.yAxis.title ? 20 : 0),
        right: 16 + (outside ? Math.min(120, widestLabel(style, font) + 6) : 0),
      };
    }
    return outside ? { top: 12 + (p.title ? 24 : 0) + (legend ? 28 : 0) + 16 } : {};
  }

  /** Re-formats and re-measures bar data labels (render, visibility toggles, theme). */
  private syncBarLabels(): void {
    const meta = this.chartMeta;
    if (meta?.kind !== 'bar' && meta?.kind !== 'bar-multi') return;
    const st = meta.barStyle;
    if (!st?.labels) return;
    const locale = this.chartLocale();
    // Without a label format, labels read like the value axis
    const p = this.chartPresentation;
    const valueAxis = st.orientation === 'horizontal' ? p?.xAxis : p?.yAxis;
    const valueFormat = resolveFormat(valueAxis?.format, locale);
    st.texts =
      meta.kind === 'bar'
        ? barLabelTexts(st.labels, {
            values: meta.values ?? [],
            categories: meta.metadata.length,
            seriesCount: 1,
            percent: false,
            visible: [true],
            seriesName: () => meta.legendEntry?.name,
            categoryLabel: (i) => meta.metadata[i]?.label ?? '',
            locale,
            valueFormat,
          })
        : barLabelTexts(st.labels, {
            values: meta.values,
            categories: meta.categories.length,
            seriesCount: meta.names.length,
            percent: meta.mode === 'percent',
            visible: meta.visible,
            seriesName: (s) => meta.names[s],
            categoryLabel: (i) => meta.categories[i] ?? '',
            locale,
            valueFormat,
          });
    sendBarLabels(this.backend, st, this.theme.fontFamily);
    this.chartOverlay?.bars?.invalidate();
  }

  /**
   * Renders a multi-series bar chart natively: `'grouped'` (side by side), `'stacked'` (positive
   * values stack up, negative values down) or `'percent'` (each category normalized to 100%).
   * Layout, stacking, hit-testing, and legend toggles (re-stacking) run in the engine. Stacked
   * hover reports every series of the category (tooltip adds the total / shares).
   * Data point ids = `seriesIndex * categories.length + categoryIndex`. The 3D matrix view
   * (`viewMode: '3d'`) shows the first series only.
   */
  renderGroupedBarChart(
    data: GroupedBarChartData,
    options?: GroupedBarChartOptions
  ): { barCount: number; seriesCount: number; categoryCount: number } {
    this.clearScene();
    this.applyChartAnimation(options?.animation);
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);

    const viewMode = options?.viewMode ?? '2d';
    const flat = viewMode === '2d';
    const n = data.categories.length;
    const seriesList = flat ? data.series : data.series.slice(0, 1);
    const s = seriesList.length;
    if (n === 0 || s === 0) return { barCount: 0, seriesCount: 0, categoryCount: 0 };
    this.setHelpers(
      flat
        ? { showGrid: false, showAxes: false }
        : { showGrid: true, gridSize: 165, gridDivisions: 16, showAxes: false }
    );

    // Flat [series * n + category]; short series are padded with NaN (missing)
    const palette = this.theme.palette;
    const values = new Float32Array(s * n).fill(NaN);
    const colors = new Float32Array(s * 4);
    seriesList.forEach((series, k) => {
      values.set(series.values.slice(0, n), k * n);
      colors.set(parseOptionalColor(series.color) ?? palette[k % palette.length], k * 4);
    });
    const mode = options?.mode ?? 'grouped';
    this.backend.set_bar_chart_multi?.(
      values,
      s,
      colors,
      mode === 'stacked' ? 1 : mode === 'percent' ? 2 : 0,
      options?.width ?? 164,
      options?.maxBarHeight ?? 78,
      options?.barThickness ?? 0,
      options?.cornerRadius ?? 4,
      options?.groupGap ?? NaN,
      options?.barGap ?? NaN,
      flat ? 0 : 1
    );
    const barStyle = flat ? this.initBarStyle(options, encodeErrors(seriesList.map((series) => series.error), n)) : undefined;
    this.chartHover = options?.hover;
    this.chartGrid = options?.grid;
    this.chartGridShown = flat;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));

    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? (flat && s >= 2),
      toggle: legendOpt.toggle ?? true,
      emphasize: legendOpt.emphasize ?? true,
    };
    this.chartMode = 'bar';
    this.chartMeta = {
      kind: 'bar-multi',
      mode,
      names: seriesList.map((series) => series.name),
      colors: seriesList.map((_, k) => [colors[k * 4], colors[k * 4 + 1], colors[k * 4 + 2], colors[k * 4 + 3]]),
      categories: [...data.categories],
      values,
      visible: seriesList.map(() => true),
      viewMode: flat ? '2d' : '3d',
      barStyle,
    };
    this.flatCameraView = flat;
    const truncate = (str: string) => (str.length > 12 ? `${str.slice(0, 11)}…` : str);
    const percentAxis: ChartAxisOptions = mode === 'percent' ? { format: (v) => `${formatTickValue(v, this.chartLocale())}%` } : {};
    const category = (i: number) => truncate(data.categories[i] ?? String(i));
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      ...this.barAxes(flat, barStyle, options?.axes ?? {}, category, percentAxis),
      legend,
      navigable: false,
    };
    this.syncBarLabels();
    this.applyChartPadding(this.chartPresentation, legend.show, {
      ...this.barPadding(this.chartPresentation, legend.show, barStyle, data.categories.map((_, i) => category(i))),
      ...options?.padding,
    });
    this.rebuildChartOverlay();
    return { barCount: s * n, seriesCount: s, categoryCount: n };
  }

  /**
   * Renders a 2D scatter / bubble chart natively (Rust + WebGPU): instanced px-sized points
   * uploaded once (1,000,000+ points at 60 FPS), nice-tick x / y axes, series legend, wheel zoom /
   * drag pan on both axes, and grid-hashed nearest-point hover. Data point ids = point index.
   */
  renderScatterChart(data: ScatterChartData, options?: ScatterChartOptions): { pointCount: number } {
    this.clearScene();
    this.applyChartAnimation(options?.animation);
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const n = Math.min(data.x.length, data.y.length);
    const f32 = (v: Float32Array | number[]) => (v instanceof Float32Array ? v : Float32Array.from(v)).subarray(0, n);
    const xs = f32(data.x);
    const ys = f32(data.y);
    const sizes = data.sizes && data.sizes.length >= n ? f32(data.sizes) : EMPTY_F32;
    const ids =
      data.clusters && data.clusters.length >= n
        ? (data.clusters instanceof Uint16Array ? data.clusters : Uint16Array.from(data.clusters)).subarray(0, n)
        : null;
    const pointColors =
      data.colors && data.colors.length >= n * 4
        ? (data.colors instanceof Float32Array ? data.colors : Float32Array.from(data.colors)).subarray(0, n * 4)
        : null;
    const palette = options?.seriesColors?.length ? options.seriesColors.map(parseColor) : this.theme.palette;
    const seriesColors = new Float32Array(palette.length * 4);
    palette.forEach((c, i) => seriesColors.set(c, i * 4));

    this.backend.set_scatter_chart?.(
      xs,
      ys,
      sizes,
      ids ?? EMPTY_U16,
      pointColors ?? EMPTY_F32,
      seriesColors,
      options?.width ?? 168,
      options?.height ?? 94,
      options?.pointRadius ?? 3,
      options?.opacity ?? 0.85,
      options?.pointRing ?? (sizes.length > 0 ? 1 : 0),
      options?.verticalGrid ?? true
    );
    // Scatter always picks the nearest point; a tighter default radius suits dense clouds
    this.chartHover = { hitRadius: 12, ...options?.hover, mode: 'nearest' };
    this.chartGrid = options?.grid;
    this.chartGridShown = options?.showBackdropGrid ?? true;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(this.chartHover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));

    const seriesCount = this.backend.chart_series_count?.() ?? (n > 0 ? 1 : 0);
    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? seriesCount >= 2,
      toggle: legendOpt.toggle ?? true,
      emphasize: legendOpt.emphasize ?? true,
    };
    this.chartMode = 'scatter';
    this.chartMeta = {
      kind: 'scatter',
      names: Array.from({ length: seriesCount }, (_, i) => options?.seriesNames?.[i] ?? `Series ${i}`),
      colors: Array.from({ length: seriesCount }, (_, i) => palette[i % palette.length]),
      visible: Array.from({ length: seriesCount }, () => true),
      x: xs,
      y: ys,
      series: ids,
      pointColors,
    };
    this.flatCameraView = true;
    const formatScatterX = resolveFormatLive(options?.axes?.x?.format, () => this.chartLocale());
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: options?.axes?.x ?? {},
      yAxis: options?.axes?.y ?? {},
      legend,
      navigable: true,
      zoomY: true,
      // Numeric x axis: no time granularity
      formatX: (v) => (formatScatterX ? formatScatterX(v) : formatTickValue(v, this.chartLocale())),
    };
    this.applyAxisScales({ x: options?.axes?.x, y: options?.axes?.y });
    this.applyChartPadding(this.chartPresentation, legend.show, options?.padding);
    this.rebuildChartOverlay();
    return { pointCount: n };
  }
  /**
   * Keyboard a11y tooltip (chart-a11y.ts) of an engine hit, same as the pointer path for candles
   * (OHLC / bucket) and heatmaps (displayed cell color); `null` = the a11y model builds it.
   */
  private a11yChartTooltip(hit: Float64Array): ChartTooltipContext | null {
    const meta = this.chartMeta;
    if (!meta || hit.length < 7 || hit[2] < 1) return null;
    if (meta.kind === 'candle') return this.candleTooltip(meta, hit[4]);
    if (meta.kind === 'heatmap') return this.heatmapTooltip(meta, hit);
    if (meta.kind === 'box') return this.boxTooltip(meta, hit);
    if (meta.kind === 'pie') return this.pieTooltip(meta, hit[4]);
    if (isBusinessMeta(meta)) return businessTooltipContext(meta, hit, (id) => this.getNodeDetails(id));
    if (meta.kind === 'treemap' || meta.kind === 'sunburst' || meta.kind === 'sankey') return this.hierarchyTooltip(meta, hit);
    return null;
  }

  /** Tooltip data of a box plot hit (box: value = median; outlier ids follow the boxes). */
  private boxTooltip(meta: BoxChartMeta, hit: ArrayLike<number>): ChartTooltipContext | null {
    const [series, category, value, id] = [hit[3], hit[4], hit[5], hit[6]];
    const box = boxTooltipOf(meta, series, category, value, id);
    if (!box) return null;
    return {
      chartType: 'box',
      index: category,
      xLabel: box.categoryLabel,
      items: [{ seriesName: box.seriesName, value, color: rgbaToCss(meta.colors[series] ?? [0.5, 0.5, 0.5, 1]), nodeId: id }],
      box,
      details: this.getNodeDetails(id),
    };
  }

  /** Tooltip data of a heatmap hit (engine item: series = row, index = column). */
  private heatmapTooltip(meta: HeatmapChartMeta, hit: ArrayLike<number>): ChartTooltipContext {
    const cell = this.heatmapCell(meta, hit[3], hit[4]);
    const value = hit[5];
    const color = this.backend.chart_heatmap_color?.(value);
    return {
      chartType: 'heatmap',
      index: cell.col,
      xLabel: cell.xLabel,
      cell,
      items: [{ seriesName: meta.valueLabel, value, color: color ? bytesToCss(color) : 'rgb(128, 128, 128)', nodeId: hit[6] }],
      details: this.getNodeDetails(hit[6]),
    };
  }

  /** Tooltip data of candle `index`: the engine's bucket aggregate while zoomed out, else the candle. */
  private candleTooltip(meta: CandleChartMeta, index: number): ChartTooltipContext | null {
    if (index < 0 || index >= meta.close.length) return null;
    const a = this.backend.chart_candle?.(index);
    const xOf = (i: number) => (meta.t ? meta.t[i] : i);
    const vol = (v: number) => (meta.volume && Number.isFinite(v) ? v : undefined);
    const ohlc: ChartOhlc =
      a && a.length >= 8
        ? { open: a[1], high: a[2], low: a[3], close: a[4], volume: vol(a[5]), x: a[0], xEnd: xOf(a[7]), count: a[7] - a[6] + 1 }
        : {
            open: Number(meta.open[index]),
            high: Number(meta.high[index]),
            low: Number(meta.low[index]),
            close: Number(meta.close[index]),
            volume: vol(Number(meta.volume?.[index])),
            x: xOf(index),
            xEnd: xOf(index),
            count: 1,
          };
    const up = ohlc.close >= ohlc.open;
    const xLabel =
      ohlc.count > 1 ? `${meta.formatXValue(ohlc.x)} – ${meta.formatXValue(ohlc.xEnd)}` : meta.formatXValue(ohlc.x);
    return {
      chartType: meta.mode,
      index,
      x: ohlc.x,
      xLabel,
      items: [{ seriesName: 'Close', value: ohlc.close, color: rgbaToCss(meta.colors[up ? 0 : 1]), nodeId: index }],
      ohlc,
      details: this.getNodeDetails(index),
    };
  }

  /** `set_candle_chart` style array for the current theme (theme defaults where not given). */
  private candleStyle(options: CandlestickChartOptions | undefined, mode: 'candlestick' | 'ohlc'): Float32Array {
    const up = parseOptionalColor(options?.upColor) ?? this.theme.palette[0];
    const down = parseOptionalColor(options?.downColor) ?? this.theme.palette[1 % this.theme.palette.length];
    const flag = (v: boolean | undefined) => (v === undefined ? NaN : v ? 1 : 0);
    return new Float32Array([
      ...up,
      ...down,
      flag(options?.hollowUp),
      options?.wickWidth ?? NaN,
      options?.bodyWidth ?? NaN,
      options?.cornerRadius ?? NaN,
      flag(options?.showVolume),
      options?.volumeOpacity ?? NaN,
      options?.volumeHeight ?? NaN,
      options?.yFit === undefined ? NaN : options.yFit === 'visible' ? 1 : 0,
      mode === 'ohlc' ? 1 : 0,
    ]);
  }

  /** Default candle colors follow theme changes. */
  private restyleCandles(): void {
    const meta = this.chartMeta;
    if (meta?.kind !== 'candle' || (!meta.themedColors.up && !meta.themedColors.down)) return;
    const p = this.theme.palette;
    if (meta.themedColors.up) {
      meta.colors[0] = p[0];
      meta.style.set(p[0], 0);
    }
    if (meta.themedColors.down) {
      meta.colors[1] = p[1 % p.length];
      meta.style.set(p[1 % p.length], 4);
    }
    this.backend.set_chart_candle_style?.(meta.style);
  }

  /**
   * Renders a candlestick (OHLC) chart natively: bodies + wicks on the GPU, per-pixel-column OHLC
   * aggregation in the engine once candles get narrower than ~2 px (open = first, high = max,
   * low = min, close = last; 1,000,000+ candles stay interactive), optional volume pane, x zoom /
   * pan (wheel / drag / pinch) with the price axis fitting the visible candles, a crosshair, and
   * an O/H/L/C/V tooltip. Rising candles default to the theme's first palette color and hollow
   * bodies, falling ones to the second color (blue / orange: not red / green alone).
   * Data point ids = candle index.
   */
  renderCandlestickChart(data: CandlestickChartData, options?: CandlestickChartOptions): { candleCount: number } {
    return { candleCount: this.renderFinancialChart(data, options, 'candlestick') };
  }

  /** High–low stem, left open tick and right close tick; shares candle LOD, volume and navigation. */
  renderOhlcChart(data: OhlcChartData, options?: OhlcChartOptions): { barCount: number } {
    return { barCount: this.renderFinancialChart(data, {
      ...options, wickWidth: options?.lineWidth, bodyWidth: options?.tickWidth,
    }, 'ohlc') };
  }

  private renderFinancialChart(data: CandlestickChartData, options: CandlestickChartOptions | undefined, mode: 'candlestick' | 'ohlc'): number {
    const method = mode === 'ohlc' ? 'renderOhlcChart' : 'renderCandlestickChart';
    const render = mode === 'ohlc' ? this.backend.set_ohlc_chart : this.backend.set_candle_chart;
    if (!render) throw new Error(`${method}: backend does not support ${mode} charts`);
    if (options?.timeZone !== undefined) validateTimeZone(options.timeZone);

    const n = data.close.length;
    for (const [name, arr] of [['open', data.open], ['high', data.high], ['low', data.low]] as const) {
      if (arr.length !== n) throw new Error(`${method}: ${name} has ${arr.length} values for ${n} samples`);
    }
    if (data.t && data.t.length !== n) throw new Error(`${method}: t has ${data.t.length} values for ${n} samples`);
    if (data.volume && data.volume.length !== n) {
      throw new Error(`${method}: volume has ${data.volume.length} values for ${n} samples`);
    }
    const f32 = (v: Float32Array | number[]) => (v instanceof Float32Array ? v : Float32Array.from(v));
    const [open, high, low, close] = [f32(data.open), f32(data.high), f32(data.low), f32(data.close)];
    const volume = data.volume ? f32(data.volume) : null;
    const t = data.t ? toF64(data.t) : null;
    if (t) for (let i = 0; i < t.length; i++) {
      if (!Number.isFinite(t[i]) || (i > 0 && t[i] < t[i - 1])) {
        throw new Error(`${method}: t must be finite and sorted ascending`);
      }
    }
    this.clearScene();
    this.applyChartAnimation(options?.animation);
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });
    const xAxisOpt = options?.axes?.x ?? {};
    // `t` is epoch ms / Date unless the x axis says numeric
    const timeX = !!t && (xAxisOpt.type ?? 'time') === 'time';
    const style = this.candleStyle(options, mode);
    render.call(this.backend,
      t ?? EMPTY_F64,
      open,
      high,
      low,
      close,
      volume ?? EMPTY_F32,
      style,
      options?.width ?? 168,
      options?.height ?? 86,
      timeX ? 1 : 0
    );
    this.chartHover = { marker: false, ...options?.hover };
    this.chartGrid = options?.grid;
    this.chartGridShown = options?.showBackdropGrid ?? true;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(this.chartHover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));

    const locale = () => this.chartLocale();
    const tz = () => this.chartTimeZone();
    const userFormatX = resolveFormatLive(xAxisOpt.format, locale);
    const formatXNumber = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 6 });
    const formatX: ChartPresentation['formatX'] = timeX
      ? (v, g) => (userFormatX ?? ((ms, gn) => formatChartTime(ms, gn, locale(), tz())))(v, TIME_GRANULARITIES[g ?? 0])
      : (v) => (userFormatX ?? (t ? formatXNumber : (i: number) => `#${i.toLocaleString(locale())}`))(v);
    const formatXValue = userFormatX
      ? (v: number) => userFormatX(v)
      : timeX
        ? (v: number) => formatChartTime(v, undefined, locale(), tz())
        : t
          ? formatXNumber
          : (i: number) => `#${i}`;
    this.chartMode = mode;
    this.chartMeta = {
      kind: 'candle',
      mode,
      names: ['Price'],
      colors: [
        [style[0], style[1], style[2], style[3]],
        [style[4], style[5], style[6], style[7]],
      ],
      visible: [true],
      t,
      open,
      high,
      low,
      close,
      volume,
      formatXValue,
      themedColors: { up: options?.upColor === undefined, down: options?.downColor === undefined },
      style,
    };
    this.flatCameraView = true;
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: xAxisOpt,
      yAxis: options?.axes?.y ?? {},
      legend: { show: false, toggle: false, emphasize: false },
      navigable: true,
      formatX,
      locale: options?.locale,
      timeZone: options?.timeZone,
    };
    this.applyChartPadding(this.chartPresentation, false, options?.padding);
    this.rebuildChartOverlay();
    return n;
  }

  /**
   * Renders a histogram of raw values: the engine bins them in O(n) (Freedman–Diaconis with a
   * Sturges fallback, or `bins` equal-width bins; 1,000,000+ values) and draws zero-gap bars on
   * a numeric x axis ticked at bin edges. Hover shows the bin range and its count / density.
   * Data point ids = bin index.
   */
  renderHistogram(values: Float32Array | number[], options?: HistogramChartOptions): HistogramResult {
    if (!this.backend.set_histogram_chart || !this.backend.chart_histogram) {
      throw new Error('renderHistogram: the engine has no histogram support (set_histogram_chart)');
    }
    this.clearScene();
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const v = values instanceof Float32Array ? values : Float32Array.from(values);
    const bins = options?.bins === undefined || options.bins === 'auto' ? 0 : Math.max(1, Math.floor(options.bins));
    const color = parseOptionalColor(options?.color) ?? this.theme.palette[0];
    const density = options?.density ?? false;
    this.backend.set_histogram_chart(
      v,
      bins,
      options?.range?.[0] ?? NaN,
      options?.range?.[1] ?? NaN,
      density,
      new Float32Array(color),
      options?.width ?? 164,
      options?.maxBarHeight ?? 78,
      options?.cornerRadius ?? 0,
      options?.barGap ?? 1
    );
    const h = this.backend.chart_histogram();
    const k = h.length >= 3 ? h[0] : 0;
    const result: HistogramResult = {
      binCount: k,
      edges: h.slice(3, 4 + k),
      heights: h.slice(4 + k, 4 + 2 * k),
      counts: h.slice(4 + 2 * k, 4 + 3 * k),
      total: h[1] ?? 0,
      rule: (['freedman-diaconis', 'sturges', 'fixed'] as const)[h[2]] ?? 'fixed',
    };
    this.chartHover = options?.hover;
    this.chartGrid = options?.grid;
    this.chartGridShown = true;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(true, this.themedGrid(options?.grid)));

    const locale = () => this.chartLocale();
    const userFx = resolveFormatLive(options?.axes?.x?.format, locale);
    const fx = (x: number) => (userFx ?? ((e: number) => formatTickValue(e, locale())))(x);
    const unit = density ? 'Density' : 'Count';
    this.chartMode = 'bar';
    this.chartMeta = {
      kind: 'bar',
      colors: Array.from({ length: k }, () => color),
      metadata: Array.from({ length: k }, (_, i) => ({
        label: `${fx(result.edges[i])} – ${fx(result.edges[i + 1])}`,
        category: unit,
        tags: ['histogram'],
        attributes: {
          value: Number(result.heights[i].toPrecision(6)),
          ...(density ? { count: result.counts[i] } : {}),
        },
      })),
    };
    this.flatCameraView = true;
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: options?.axes?.x ?? {},
      yAxis: options?.axes?.y ?? {},
      legend: { show: false, toggle: false, emphasize: false },
      navigable: false,
      // Ticks receive bin edge values
      formatX: (x) => fx(x),
      locale: options?.locale,
    };
    this.applyChartPadding(this.chartPresentation, false, options?.padding);
    this.rebuildChartOverlay();
    return result;
  }

  /**
   * Renders a heatmap / matrix natively: the `cols x rows` grid is uploaded once as a float
   * texture and drawn as ONE quad (4096 x 4096 cells stay interactive), colored through a
   * 256-entry LUT built by the engine (sequential single hue, viridis, magma, or diverging
   * around `center`). Wheel / drag zoom and pan both axes; hover outlines the cell under the
   * pointer. A colorbar is drawn right of the plot. Data point ids = `row * cols + col`.
   */
  renderHeatmap(data: HeatmapChartData, options?: HeatmapChartOptions): { cellCount: number } {
    this.clearScene();
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const meta = heatmapMeta(data, options);
    const cellCount = sendHeatmap(this.backend, meta, options);
    sendHeatmapColormap(this.backend, meta, this.theme);
    this.backend.set_chart_heatmap_domain?.(options?.min ?? NaN, options?.max ?? NaN, options?.center ?? NaN);
    // Cells fill the plot: no gridlines; the outline ring uses the surface color
    this.chartHover = options?.hover;
    this.chartGrid = undefined;
    this.chartGridShown = false;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(false, this.themedGrid()));

    this.chartMode = 'heatmap';
    this.chartMeta = meta;
    this.flatCameraView = true;
    const truncate = (str: string) => (str.length > 12 ? `${str.slice(0, 11)}…` : str);
    const userX = options?.axes?.x;
    const userY = options?.axes?.y;
    const userFx = resolveFormatLive(userX?.format, () => this.chartLocale());
    const num = (v: number) => formatTickValue(v, this.chartLocale());
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: userX ?? {},
      // Categorical rows: tick value = row index
      yAxis: {
        ...userY,
        format: userY?.format ?? (meta.yExtent ? undefined : (v: number) => truncate(meta.yLabels?.[v] ?? String(v))),
      },
      legend: { show: false, toggle: false, emphasize: false },
      navigable: true,
      zoomY: true,
      formatX: (v) => (userFx ? userFx(v) : meta.xExtent ? num(v) : truncate(meta.xLabels?.[v] ?? String(v))),
    };
    const reserve = meta.colorbar.show ? { right: COLORBAR_RESERVE_PX } : {};
    this.applyChartPadding(this.chartPresentation, false, { ...reserve, ...options?.padding });
    this.rebuildChartOverlay();
    return { cellCount };
  }

  /** Switches the colormap of the current heatmap (re-uploads only the 1 KB LUT). */
  setHeatmapColorScale(
    scale: HeatmapColorScale,
    options?: { color?: ColorInput; reverse?: boolean; emptyColor?: ColorInput }
  ): void {
    const meta = this.chartMeta;
    if (meta?.kind !== 'heatmap') return;
    // Explicit `undefined` keeps the stored setting
    const set = Object.fromEntries(Object.entries(options ?? {}).filter(([, v]) => v !== undefined));
    meta.colormap = { ...meta.colormap, ...set, scale };
    sendHeatmapColormap(this.backend, meta, this.theme);
    this.chartOverlay?.colorbar?.refresh(this.backend, this.theme, this.chartLocale());
    this.updateChartOverlayColorbar();
  }

  /** Value domain of the current heatmap (omitted = from the data; uniform-only update). */
  setHeatmapDomain(domain: { min?: number; max?: number; center?: number }): void {
    if (this.chartMeta?.kind !== 'heatmap') return;
    this.backend.set_chart_heatmap_domain?.(domain.min ?? NaN, domain.max ?? NaN, domain.center ?? NaN);
    this.chartOverlay?.colorbar?.refresh(this.backend, this.theme, this.chartLocale());
    this.updateChartOverlayColorbar();
  }

  /** Re-lays out the colorbar labels at the current plot rectangle. */
  private updateChartOverlayColorbar(): void {
    const a = this.backend.chart_axes?.();
    if (a && a.length >= 4) this.chartOverlay?.colorbar?.layout([a[0], a[1], a[2], a[3]], this.chartLocale());
  }

  /**
   * Renders a pie / donut chart natively. The engine validates the values (finite and >= 0, else
   * this throws), folds the smallest slices beyond `maxSlices` (default 8) into "Other", sorts,
   * lays out the angles and tessellates the slices with 2 px surface gaps and anti-aliased edges;
   * hover explodes the slice under the pointer (O(log n) angle search). Outside labels get leader
   * lines and per-side collision nudging from the engine; the SDK only places the DOM text.
   * Legend click hides a slice (the rest re-lay out). Data point ids = displayed slice index.
   */
  renderPieChart(data: PieChartData, options?: PieChartOptions): { sliceCount: number } {
    this.clearScene();
    this.applyChartAnimation(options?.animation);
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const meta = pieMeta(data, options);
    const sliceCount = sendPie(this.backend, data, meta, options);
    sendPieStyle(this.backend, meta, this.theme);
    syncPieSlices(this.backend, meta);
    // No gridlines: leader lines use the frame layer
    this.chartHover = undefined;
    this.chartGrid = undefined;
    this.chartGridShown = false;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover()));
    this.backend.set_chart_frame_style?.(encodeGridStyle(false, this.themedGrid()));

    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? meta.names.length >= 2,
      toggle: legendOpt.toggle ?? true,
      emphasize: legendOpt.emphasize ?? true,
    };
    this.chartMode = 'pie';
    this.chartMeta = meta;
    this.flatCameraView = true;
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: { show: false },
      yAxis: { show: false },
      legend,
      navigable: false,
      formatX: (v) => meta.names[v] ?? String(v),
    };
    this.applyChartPadding(this.chartPresentation, legend.show, options?.padding);
    this.rebuildChartOverlay();
    return { sliceCount };
  }

  /** Pie value text: the chart `format`, else a locale number. */
  private pieValueText(v: number): string {
    const meta = this.chartMeta;
    return meta?.kind === 'pie' && meta.format ? meta.format(v) : formatChartValue(v, this.chartLocale());
  }

  /**
   * Renders a squarified treemap natively (Bruls et al.): nested levels with inner padding and a
   * header strip per parent, 2 px surface gaps, colors by top-level group (palette in fixed
   * order, groups beyond it fold into a neutral "Other") or by value. Layout, aggregation of
   * subtrees too small to show, hit-testing and label fitting run in the engine (100k leaves
   * lay out in milliseconds). Hover shows the path (A › B › C), value and shares; a click drills
   * into the clicked top-level group (breadcrumb / Escape go back up; `'drill'` event). Tree
   * input `{ name, value?, children? }` or flat rows `{ id, parent, value }`; leaf values must
   * be finite and >= 0 and cycles throw. Data point ids = node index (depth-first for trees).
   */
  renderTreemap(data: HierarchyData, options?: TreemapChartOptions): { nodeCount: number } {
    return this.renderHierarchy('treemap', data, options);
  }

  /**
   * Renders a sunburst natively: radial partition with one ring per depth (pie tessellation:
   * anti-aliased arcs, 2 px gaps). The center is the current root; a click drills into the arc,
   * the center goes back up. Hover highlights the path; labels sit at arcs that fit them. Same
   * input as `renderTreemap`.
   */
  renderSunburst(data: HierarchyData, options?: SunburstChartOptions): { nodeCount: number } {
    return this.renderHierarchy('sunburst', data, options);
  }

  private renderHierarchy(kind: 'treemap' | 'sunburst', data: HierarchyData, options?: TreemapChartOptions): { nodeCount: number } {
    this.clearScene();
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const meta = sendHierarchy(this.backend, kind, data, options);
    this.bindHierarchyEngine(meta);
    sendHierarchyStyle(this.backend, meta, this.theme);
    syncHierarchy(this.backend, meta);
    return this.presentHierarchy(meta, options, meta.names.length >= 2, true);
  }

  /**
   * Renders a sankey diagram natively (d3-sankey layout in the engine): nodes in columns
   * (longest path, `align`, or explicit `column`), breadth by value, `iterations` rounds of
   * relaxation with collision resolution (nodes in a column never overlap), cubic bezier
   * ribbons as wide as their value. Hover highlights the connected flows; the tooltip reads
   * `A → B: value (x% of A)`. Links forming a cycle throw (the message names the nodes). Data
   * point ids: node index, then node count + link index.
   */
  renderSankey(data: SankeyChartData, options?: SankeyChartOptions): { nodeCount: number; linkCount: number } {
    this.clearScene();
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const meta = sendSankey(this.backend, data, options);
    this.bindHierarchyEngine(meta);
    sendHierarchyStyle(this.backend, meta, this.theme);
    syncSankey(this.backend, meta);
    const { nodeCount } = this.presentHierarchy(meta, options, meta.names.length >= 2, false);
    return { nodeCount, linkCount: meta.sources.length };
  }

  /** Chart mode, presentation (no axes), padding and overlay of a hierarchy / flow chart. */
  private presentHierarchy(
    meta: HierarchyChartMeta | SankeyChartMeta,
    options: TreemapChartOptions | SankeyChartOptions | undefined,
    legendDefault: boolean,
    breadcrumb: boolean
  ): { nodeCount: number } {
    // No gridlines or axes
    this.chartHover = undefined;
    this.chartGrid = undefined;
    this.chartGridShown = false;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover()));
    this.backend.set_chart_frame_style?.(encodeGridStyle(false, this.themedGrid()));
    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? legendDefault,
      toggle: false,
      emphasize: meta.kind !== 'sankey' && (legendOpt.emphasize ?? true),
    };
    this.chartMode = meta.kind;
    this.chartMeta = meta;
    this.flatCameraView = true;
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: { show: false },
      yAxis: { show: false, format: options?.format },
      legend,
      navigable: false,
      formatX: (v) => meta.nodeNames[v] ?? String(v),
    };
    // Room for the drill breadcrumb above the plot
    const top = 12 + (options?.title ? 24 : 0) + (legend.show ? 28 : 0) + (breadcrumb ? 24 : 0);
    this.applyChartPadding(this.chartPresentation, legend.show, { top, ...options?.padding });
    this.rebuildChartOverlay();
    return { nodeCount: meta.kind === 'sankey' ? meta.nodeNames.length : meta.parents.length };
  }

  /** Engine hooks of a hierarchy meta: cached children order, direct hover, drill. */
  private bindHierarchyEngine(meta: HierarchyChartMeta | SankeyChartMeta): void {
    const children = new Map<number, number[]>();
    meta.engine = {
      children: (n) => {
        let c = children.get(n);
        if (!c) children.set(n, (c = Array.from(this.backend.chart_hierarchy_children?.(n) ?? [])));
        return c;
      },
      hover: (series, index) => this.backend.chart_hover_hierarchy_item?.(series, index),
      drill: (n) => this.drillTo(n),
    };
  }

  /**
   * Treemap / sunburst: shows the subtree of `target` (node index, flat input `id`, or node
   * name). Returns false when unchanged or not drillable (leaves). Emits `'drill'`; call
   * `render()` afterwards (pointer, keyboard and breadcrumb drills render themselves).
   */
  drillTo(target: number | string): boolean {
    const meta = this.chartMeta;
    if (meta?.kind !== 'treemap' && meta?.kind !== 'sunburst') return false;
    const node = resolveHierarchyNode(meta, target);
    if (node < 0 || !this.backend.set_chart_hierarchy_root?.(node)) return false;
    const info = this.backend.chart_hierarchy_info?.();
    meta.root = info && info.length >= 4 ? info[3] : node;
    this.chartOverlay?.hierarchy?.invalidate();
    this.a11y.refresh();
    this.events.emit('drill', drillEvent(meta, meta.root));
    return true;
  }

  /** Treemap / sunburst: back up one level. Returns false at the top. */
  drillUp(): boolean {
    const meta = this.chartMeta;
    if (meta?.kind !== 'treemap' && meta?.kind !== 'sunburst') return false;
    const p = hierarchyParent(meta, meta.root);
    return p >= 0 && this.drillTo(p);
  }

  /** Click on a treemap / sunburst node: drill to the engine's target. */
  private hierarchyClick(ctx: ChartTooltipContext | null): boolean {
    const meta = this.chartMeta;
    if (!ctx?.hierarchy || (meta?.kind !== 'treemap' && meta?.kind !== 'sunburst')) return false;
    const target = this.backend.chart_hierarchy_drill_target?.(ctx.hierarchy.node) ?? -1;
    return target >= 0 && this.drillTo(target);
  }

  private isHierarchyChart(): boolean {
    return this.chartMode === 'treemap' || this.chartMode === 'sunburst' || this.chartMode === 'sankey';
  }

  /** Hierarchy / flow value text: the chart `format`, else a locale number. */
  private hierValueText(v: number): string {
    const f = resolveFormat(this.chartPresentation?.yAxis.format, this.chartLocale());
    return f ? f(v) : formatChartValue(v, this.chartLocale());
  }

  /** Tooltip data of a hierarchy / flow hit (engine item: series 0 = node, 1 = sankey link). */
  private hierarchyTooltip(meta: HierarchyChartMeta | SankeyChartMeta, hit: ArrayLike<number>): ChartTooltipContext | null {
    const [series, index, id] = [hit[3], hit[4], hit[6]];
    const ctx = meta.kind === 'sankey' ? sankeyTooltipContext(meta, series, index, rgbaToCss) : hierarchyTooltipContext(meta, index, rgbaToCss);
    if (ctx) ctx.details = this.getNodeDetails(id);
    return ctx;
  }

  /** Tooltip data of displayed pie slice `k` (engine item index). */
  private pieTooltip(meta: PieChartMeta, k: number): ChartTooltipContext | null {
    const ctx = pieTooltipContext(meta, k, rgbaToCss);
    if (ctx) ctx.details = this.getNodeDetails(k);
    return ctx;
  }

  /** Row / column of a heatmap cell with their axis labels (category label or numeric center). */
  private heatmapCell(meta: HeatmapChartMeta, row: number, col: number): NonNullable<ChartTooltipContext['cell']> {
    const p = this.chartPresentation;
    const num = (v: number) => formatChartValue(v, this.chartLocale());
    const fx = (meta.xExtent && resolveFormat(p?.xAxis.format, this.chartLocale())) || num;
    const fy = (meta.yExtent && resolveFormat(p?.yAxis.format, this.chartLocale())) || num;
    return {
      row,
      col,
      xLabel: heatmapAxisLabel(meta.xLabels, meta.xExtent, meta.cols, col, fx),
      yLabel: heatmapRowLabel(meta, row, fy),
    };
  }

  /**
   * Renders a combo chart natively: bar, line and area series (`type` per series) on one plot
   * sharing a category axis (`categories`) or numeric / time `x`, with an optional right y axis
   * (`yAxis: 'right'`). Bars (`barMode` grouped / stacked / percent) sit on category slots and
   * line points on the slot centers; layout, restacking on legend toggles, both y domains, area
   * fills, hover (every series at the hovered category: bars tinted, line markers) and x zoom /
   * pan run in the engine. Line / area series take the line styles (`marker`, `dash`, `curve`,
   * `nulls`). Data point ids = `seriesIndex * categoryCount + categoryIndex`.
   */
  renderComboChart(
    data: ComboChartData,
    options?: ComboChartOptions
  ): { seriesCount: number; categoryCount: number; pointCount: number } {
    const fn = 'renderComboChart';
    if (options?.timeZone !== undefined) validateTimeZone(options.timeZone);
    this.clearScene();
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const enc = encodeCombo(data, options, this.theme.palette, this.theme.baseline, fn);
    const s = enc.names.length;
    if (enc.n === 0 || s === 0) return { seriesCount: 0, categoryCount: 0, pointCount: 0 };
    const pointCount =
      this.backend.set_combo_chart?.(enc.values, s, enc.kinds, enc.axes, enc.colors, enc.widths, enc.x, enc.layout, enc.yAxes) ?? 0;
    // Markers / dashes / curves / null policies of the line / area series (line-local order)
    applyLineStyles(this.backend, enc.lineSeries, options?.nulls, fn, false);
    this.chartHover = options?.hover;
    this.chartGrid = options?.grid;
    this.chartGridShown = options?.showBackdropGrid ?? true;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));

    const locale = () => this.chartLocale();
    const tz = () => this.chartTimeZone();
    const xAxisOpt = options?.axes?.x ?? {};
    const userFormatX = resolveFormatLive(xAxisOpt.format, locale);
    const formatXNumber = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: 6 });
    const formatXValue = (v: number) => (userFormatX ? userFormatX(v) : enc.timeX ? formatChartTime(v, undefined, locale(), tz()) : formatXNumber(v));
    const barMode = options?.barMode ?? 'grouped';
    const meta = comboMeta(enc, data, barMode, formatXValue);
    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? s >= 2,
      toggle: legendOpt.toggle ?? true,
      emphasize: legendOpt.emphasize ?? true,
    };
    this.chartMode = 'combo';
    this.chartMeta = meta;
    this.flatCameraView = true;
    // Percent bars: their axis reads in percent
    const barAxis = meta.axes[meta.types.indexOf('bar')];
    const percent: ChartAxisOptions = barMode === 'percent' ? { format: (v) => `${formatTickValue(v, locale())}%` } : {};
    const hasRight = meta.axes.includes(1);
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: xAxisOpt,
      yAxis: { ...(barAxis === 0 ? percent : {}), ...(options?.axes?.y ?? {}) },
      ...(hasRight ? { y2Axis: { ...(barAxis === 1 ? percent : {}), ...(options?.axes?.y2 ?? {}) } } : {}),
      legend,
      navigable: true,
      formatX: (v, g) =>
        comboTickLabel(meta, v, TIME_GRANULARITIES[g ?? 0], userFormatX, (x, gn) =>
          enc.timeX ? formatChartTime(x, gn, locale(), tz()) : formatXNumber(x)
        ),
      locale: options?.locale,
      timeZone: options?.timeZone,
    };
    this.applyChartPadding(this.chartPresentation, legend.show, options?.padding);
    this.rebuildChartOverlay();
    return { seriesCount: s, categoryCount: enc.n, pointCount };
  }

  /**
   * Renders a box plot (or violins with `violin`) natively: one distribution per category and
   * series, series side by side like grouped bars. Quartiles (numpy linear interpolation),
   * whiskers (`'tukey'` 1.5 IQR, `'minmax'`, or a percentile pair), outlier counts, a capped
   * outlier sample and the violin KDE are computed in the engine in O(n) per group; the
   * samples are uploaded once and not kept. Hover reports a group's statistics, or the value
   * of the outlier under the pointer. Data point ids: box = `series * categories + category`,
   * outliers follow (`chart_box_outliers`).
   */
  renderBoxPlot(
    data: BoxPlotData,
    options?: BoxPlotOptions
  ): { boxCount: number; seriesCount: number; categoryCount: number; sampleCount: number } {
    this.clearScene();
    this.applyChartAnimation(options?.animation);
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });

    const n = data.categories.length;
    if (n === 0 || data.series.length === 0) return { boxCount: 0, seriesCount: 0, categoryCount: 0, sampleCount: 0 };
    const enc = encodeBoxPlot(data, this.theme.palette, this.theme.baseline, options?.colors);
    const s = enc.names.length;
    const sampleCount =
      this.backend.set_box_chart?.(enc.values, enc.counts, s, n, enc.colors, encodeBoxLayout(options), encodeBoxOptions(options)) ?? 0;
    this.chartHover = options?.hover;
    this.chartGrid = options?.grid;
    this.chartGridShown = options?.showBackdropGrid ?? true;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));

    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? s >= 2,
      toggle: legendOpt.toggle ?? true,
      emphasize: legendOpt.emphasize ?? true,
    };
    this.chartMode = 'box';
    this.chartMeta = {
      kind: 'box',
      names: enc.names,
      colors: enc.rgba,
      categories: [...data.categories],
      visible: enc.names.map(() => true),
      stats: this.backend.chart_box_stats?.() ?? new Float64Array(0),
      violin: !!options?.violin,
      whiskers: options?.whiskers ?? 'tukey',
      iqrFactor: options?.iqrFactor !== undefined && options.iqrFactor >= 0 ? options.iqrFactor : 1.5,
      valueLabel: options?.valueLabel ?? 'Value',
    };
    this.flatCameraView = true;
    const truncate = (str: string) => (str.length > 12 ? `${str.slice(0, 11)}…` : str);
    const formatCategory = resolveFormatLive(options?.axes?.x?.format, () => this.chartLocale());
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: options?.axes?.x ?? {},
      yAxis: options?.axes?.y ?? {},
      legend,
      navigable: false,
      // Category axis: no time granularity
      formatX: (v) => (formatCategory ? formatCategory(v) : truncate(data.categories[v] ?? String(v))),
    };
    this.applyChartPadding(this.chartPresentation, legend.show, options?.padding);
    this.rebuildChartOverlay();
    return { boxCount: s * n, seriesCount: s, categoryCount: n, sampleCount };
  }

  /** Shared setup of the business charts (no scene, flat camera, theme hover / grid styles). */
  private beginBusinessChart(): void {
    this.clearScene();
    this.clearSelection();
    this.setRigidPhysics(false);
    this.setGraphVisible(true);
    this.setHelpers({ showGrid: false, showAxes: false });
  }

  /** Value text of a business chart `format` option (follows `setLocale`; default: locale number). */
  private businessFormat(format: ChartValueFormat | undefined): (v: number) => string {
    return resolveFormatLive(format, () => this.chartLocale()) ?? ((v: number) => formatChartValue(v, this.chartLocale()));
  }

  /** Activates a business chart meta with a presentation without axes. */
  private showBusinessChart(
    mode: BusinessChartMeta['kind'],
    meta: BusinessChartMeta,
    options: { title?: string; description?: string; padding?: ChartPaddingOptions } | undefined,
    legend: Required<ChartLegendOptions>,
    padding: ChartPaddingOptions,
    grid = false
  ): void {
    this.chartHover = undefined;
    this.chartGrid = undefined;
    this.chartGridShown = grid;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover()));
    this.backend.set_chart_frame_style?.(encodeGridStyle(grid, this.themedGrid()));
    this.chartMode = mode;
    this.chartMeta = meta;
    this.flatCameraView = true;
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      xAxis: { show: false },
      yAxis: { show: false },
      legend,
      navigable: false,
      formatX: (v) => String(v),
    };
    this.applyChartPadding(this.chartPresentation, legend.show, { ...padding, ...options?.padding });
    this.rebuildChartOverlay();
  }

  /**
   * Renders a radar (spider) chart natively: one closed polygon per series (1 to 8) over `axes`
   * (at least 3) on a shared nice radial scale (`max` fixes it, or gives one max per axis), with
   * translucent fills, strokes, vertex markers and a concentric grid. Hover picks the axis
   * nearest to the pointer and lists every visible series there; the legend toggles / emphasizes
   * series. Throws for invalid values (negative / infinite) or shapes. Point ids =
   * `series * axes + axis`.
   */
  renderRadarChart(data: RadarChartData, options?: RadarChartOptions): { axisCount: number; seriesCount: number } {
    this.beginBusinessChart();
    const meta = radarMeta(data, options, this.businessFormat(options?.format));
    sendRadar(this.backend, meta, options, this.theme);
    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend: Required<ChartLegendOptions> = {
      show: legendOpt.show ?? meta.names.length >= 2,
      toggle: legendOpt.toggle ?? true,
      emphasize: legendOpt.emphasize ?? true,
    };
    this.showBusinessChart('radar', meta, options, legend, {}, options?.showGrid ?? true);
    return { axisCount: meta.axes.length, seriesCount: meta.names.length };
  }

  /**
   * Renders a gauge natively: an arc from `min` to `max` (default 0-100, -120 to 120 degrees)
   * with threshold `bands` (status bands use the reserved good / warning / serious / critical
   * colors with an icon + label), a needle (default with bands) or a progress arc, min / max
   * labels and the formatted value in the center. Throws for an invalid range or band. Use
   * `setGaugeValue` for live values (only the indicator is rebuilt). Point ids: 0 = value,
   * `1 + k` = band `k` in drawing order (sorted by `from`).
   */
  renderGauge(data: GaugeChartData, options?: GaugeChartOptions): { bandCount: number } {
    this.beginBusinessChart();
    const meta = gaugeMeta(data, options, this.businessFormat(options?.format));
    sendGauge(this.backend, meta, options, this.theme);
    const legend = { show: false, toggle: false, emphasize: false };
    this.showBusinessChart('gauge', meta, options, legend, { left: 16, right: 16, bottom: 12 });
    return { bandCount: meta.bands.length };
  }

  /**
   * Moves the current gauge to `value` (cheap: the band geometry and label layout are kept; only
   * the needle / progress arc and the value text change). Returns false without a gauge or for
   * an infinite value.
   */
  setGaugeValue(value: number): boolean {
    const meta = this.chartMeta;
    if (meta?.kind !== 'gauge') return false;
    const v = Number(value);
    if (!(this.backend.set_chart_gauge_value?.(v) ?? false)) return false;
    meta.value = v;
    // The engine keeps a hovered value item (with the new value); the DOM tooltip refreshes on the next pointer move
    this.updateChartOverlay();
    this.a11y.refresh();
    return true;
  }

  /**
   * Renders a funnel chart natively: stages from the largest to the smallest share of the widest
   * stage (trapezoids narrowing to the next stage, or centered bars), 2 px surface gaps, labels
   * with value and conversion rate (of the first / previous stage, computed in the engine), and
   * a hover tooltip with both rates. Values must be finite and >= 0. Point ids = stage index.
   */
  renderFunnelChart(data: FunnelChartData, options?: FunnelChartOptions): { stageCount: number } {
    this.beginBusinessChart();
    const meta = funnelMeta(data, options, this.businessFormat(options?.format));
    const stageCount = sendFunnel(this.backend, meta, options, this.theme);
    const legend = { show: false, toggle: false, emphasize: false };
    const space = funnelLabelSpace(meta);
    const pad = meta.orientation === 'horizontal' ? { left: 16, right: 16, bottom: 12 + space } : { left: 16, right: 16 + space };
    this.showBusinessChart('funnel', meta, options, legend, pad);
    return { stageCount };
  }

  /**
   * Renders a waterfall chart natively on the 2D bar chart: each change floats from the running
   * total before it to the total after it, `totals` (and `options.total`) are full bars from zero,
   * dashed connectors join the bar ends, and value labels carry the sign. Increase / decrease /
   * total use palette slots and a neutral (never red / green alone). Horizontal orientation,
   * axes, gridlines and label collision handling are the bar chart's. Point ids = item index.
   */
  renderWaterfallChart(data: WaterfallChartData, options?: WaterfallChartOptions): { itemCount: number } {
    this.beginBusinessChart();
    const meta = waterfallMeta(data, options, this.businessFormat(options?.format));
    const itemCount = sendWaterfall(this.backend, meta, options, this.theme);
    sendWaterfallLabels(this.backend, meta, this.theme.fontFamily);
    this.chartHover = options?.hover;
    this.chartGrid = options?.grid;
    this.chartGridShown = options?.showBackdropGrid ?? true;
    this.backend.set_chart_hover_style?.(encodeHoverStyle(this.themedHover(options?.hover)));
    this.backend.set_chart_frame_style?.(encodeGridStyle(this.chartGridShown, this.themedGrid(options?.grid)));
    const legendOpt = typeof options?.legend === 'boolean' ? { show: options.legend } : (options?.legend ?? {});
    const legend = { show: legendOpt.show ?? meta.names.length >= 2, toggle: false, emphasize: false };
    this.chartMode = 'waterfall';
    this.chartMeta = meta;
    this.flatCameraView = true;
    const truncate = (str: string) => (str.length > 12 ? `${str.slice(0, 11)}…` : str);
    const category = (i: number) => truncate(meta.categories[i] ?? String(i));
    // Without an axis format the value axis reads like the labels
    const valueAxis: ChartAxisOptions = { format: options?.format };
    this.chartPresentation = {
      title: options?.title,
      description: options?.description,
      ...this.barAxes(true, meta.barStyle, options?.axes ?? {}, category, valueAxis),
      legend,
      navigable: false,
    };
    this.applyChartPadding(this.chartPresentation, legend.show, {
      ...this.barPadding(this.chartPresentation, legend.show, meta.barStyle, meta.categories.map((_, i) => category(i))),
      ...options?.padding,
    });
    this.rebuildChartOverlay();
    return { itemCount };
  }
}
