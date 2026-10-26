/**
 * Compile-time check (`tsc --noEmit`, not a vitest file): the public types consumers name in
 * option objects, event handlers and return values import from the package entry. Removing one
 * of these exports from src/index.ts fails the type check.
 */
import type {
  AppendSeriesOptions,
  BrushMode,
  BrushStyleOptions,
  CandlestickChartData,
  CandlestickChartOptions,
  ChartAnnotation,
  ChartAnnotationBase,
  ChartDataTable,
  ChartFormatOptions,
  ChartFormatSpec,
  ChartOhlc,
  ChartSyncMemberOptions,
  ChartSyncOptions,
  ChartTooltipContext,
  ChartTooltipOptions,
  ChartValueFormat,
  DataTableOptions,
  HeatmapChartData,
  HeatmapChartOptions,
  HeatmapColorbarOptions,
  HeatmapColorScale,
  HistogramChartOptions,
  HistogramResult,
  LineYAxisOptions,
  LineYDomainOptions,
  NavigatorOption,
  SparklineSummary,
  VizCreateOptions,
  VizDeviceEngineFactory,
  VizSelection,
  VizSelectionRange,
  WasmGpuDeviceBackend,
} from '../index';
import { createFormatter, formatNumber } from '../index';

export type PublicTypes = [
  AppendSeriesOptions,
  BrushMode,
  BrushStyleOptions,
  CandlestickChartData,
  CandlestickChartOptions,
  ChartAnnotation,
  ChartAnnotationBase,
  ChartDataTable,
  ChartFormatOptions,
  ChartFormatSpec,
  ChartOhlc,
  ChartSyncMemberOptions,
  ChartSyncOptions,
  ChartTooltipContext,
  ChartTooltipOptions,
  ChartValueFormat,
  DataTableOptions,
  HeatmapChartData,
  HeatmapChartOptions,
  HeatmapColorbarOptions,
  HeatmapColorScale,
  HistogramChartOptions,
  HistogramResult,
  LineYAxisOptions,
  LineYDomainOptions,
  NavigatorOption,
  SparklineSummary,
  VizCreateOptions,
  VizDeviceEngineFactory,
  VizSelection,
  VizSelectionRange,
  WasmGpuDeviceBackend,
];

// Option shapes accept what the docs promise
export const axisFormatSpecs: LineYAxisOptions[] = [{ format: '.2f' }, { format: { style: 'percent' } }, { format: (v) => `${v}` }];
export const tooltipOptions: ChartTooltipOptions = { sort: 'desc', shared: false, pin: 'click', valueFormatter: '$,.2f' };
export const formatters = [createFormatter('.1%'), (v: number) => formatNumber(v, 'compact', 'en-US')];
