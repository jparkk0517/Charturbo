/**
 * Vue 3 bindings of VizEngineSDK (`viz-engine-sdk/vue`): `VizChart` component + `useVizChart`.
 * Vue is an optional peer dependency; the core entry never imports it.
 *
 * @packageDocumentation
 * @module viz-engine-sdk/vue
 */
export { VizChart, type VizChartInstance } from './VizChart';
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
