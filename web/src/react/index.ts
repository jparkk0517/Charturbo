/**
 * React bindings of Charturbo (`charturbo/react`): `CharturboChart` component + `useCharturboChart`.
 * React is an optional peer dependency; the core entry never imports it.
 *
 * @packageDocumentation
 * @module charturbo/react
 */
export { CharturboChart, type CharturboChartProps, type CharturboChartHandle } from './CharturboChart';
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
