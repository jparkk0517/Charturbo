/**
 * React bindings of VizEngineSDK (`viz-engine-sdk/react`): `VizChart` component + `useVizChart`.
 * React is an optional peer dependency; the core entry never imports it.
 *
 * @packageDocumentation
 * @module viz-engine-sdk/react
 */
export { VizChart, type VizChartProps, type VizChartHandle } from './VizChart';
export { useVizChart, type UseVizChartOptions, type UseVizChartResult } from './useVizChart';
export type {
  VizChartCallbacks,
  VizChartData,
  VizChartInteractions,
  VizChartOptions,
  VizChartSpecMap,
  VizChartSync,
  VizChartTheme,
  VizChartType,
  VizCreateOptions,
} from '../sdk/chart-binding';
