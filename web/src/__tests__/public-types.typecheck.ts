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
  ChartAxisBreak,
  ChartAxisBreakOptions,
  ChartExtraAxisPlacement,
  ComboExtraYAxisOptions,
  ExtraYAxisOptions,
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
  CharturboCreateOptions,
  CharturboDeviceEngineFactory,
  CharturboSelection,
  CharturboSelectionRange,
  WasmGpuDeviceBackend,
} from '../index';
import { createFormatter, formatNumber } from '../index';
import type { ErrorBarSeriesDescriptor, ErrorBarChartOptions, ImpulseSeriesDescriptor, ImpulseChartOptions } from '../index';

export const scientificSeries: [ErrorBarSeriesDescriptor, ImpulseSeriesDescriptor] = [
  { name: 'Error', values: [2], errorLow: 1, errorHigh: [3], direction: 'horizontal' },
  { name: 'Impulse', values: [2], baseline: -1, showMarker: false },
];
export const scientificOptions: [ErrorBarChartOptions, ImpulseChartOptions] = [{ capWidth: '40%', errorMode: 'high' }, { baseline: 2 }];

export type PublicTypes = [
  AppendSeriesOptions,
  BrushMode,
  BrushStyleOptions,
  CandlestickChartData,
  CandlestickChartOptions,
  ChartAnnotation,
  ChartAnnotationBase,
  ChartAxisBreak,
  ChartAxisBreakOptions,
  ChartExtraAxisPlacement,
  ComboExtraYAxisOptions,
  ExtraYAxisOptions,
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
  CharturboCreateOptions,
  CharturboDeviceEngineFactory,
  CharturboSelection,
  CharturboSelectionRange,
  WasmGpuDeviceBackend,
];

// Option shapes accept what the docs promise
export const axisFormatSpecs: LineYAxisOptions[] = [{ format: '.2f' }, { format: { style: 'percent' } }, { format: (v) => `${v}` }];
export const tooltipOptions: ChartTooltipOptions = { sort: 'desc', shared: false, pin: 'click', valueFormatter: '$,.2f' };
export const formatters = [createFormatter('.1%'), (v: number) => formatNumber(v, 'compact', 'en-US')];
export const axisBreakOptions: [LineYAxisOptions, ExtraYAxisOptions, ComboExtraYAxisOptions] = [
  { breaks: [{ start: 30, end: 480, gap: '2%' }] },
  { position: 'left', offset: 8, color: '#f00', breaks: [{ start: 1, end: 2, gap: 0.5 }] },
  { min: 0, position: 'right' },
];
// React / Vue bindings take the same option shapes
export const bindingAxisOptions: [import('../react').CharturboChartOptions<'line'>, import('../react').CharturboChartOptions<'combo'>] = [
  { axes: { y: { breaks: [{ start: 1, end: 2 }] }, extraY: [{ title: 'Rain', position: 'right' }] } },
  { axes: { extraY: [{ breaks: [{ start: 1, end: 2 }] }] } },
];
