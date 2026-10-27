/**
 * Vue 3 bindings of Charturbo (`charturbo/vue`): `CharturboChart` component + `useCharturboChart`.
 * Vue is an optional peer dependency; the core entry never imports it.
 *
 * @packageDocumentation
 * @module charturbo/vue
 */
export { CharturboChart, type CharturboChartInstance } from './CharturboChart';
export { useCharturboChart, type UseCharturboChartOptions, type UseCharturboChartResult } from './useCharturboChart';
export type {
  CharturboChartCallbacks,
  CharturboChartData,
  CharturboChartInteractions,
  CharturboChartOptions,
  CharturboChartSpecMap,
  CharturboChartSync,
  CharturboChartTheme,
  CharturboChartType,
  CharturboCreateOptions,
} from '../sdk/chart-binding';
