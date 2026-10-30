/**
 * Axis scales (linear / log10, reversed axes, tick-count hints) and the opt-in right y axis of
 * 2D line charts. The engine maps values, builds ticks / gridlines and hit-tests in scale space
 * (crates/charturbo-core/src/chart/scale.rs); this module only encodes the options for it.
 */
import { seriesAxisIndex } from './chart-axes';

/** Value scale of an axis. `'log'`: log10, decade ticks; zero / negative values are not drawn. */
export type ChartScaleType = 'linear' | 'log';

/** Scale options of one axis (line x: log needs numeric `x`; index / time x stay linear). */
export interface ChartScaleOptions {
  /** Default: `'linear'` */
  scale?: ChartScaleType;
  /** Inverted axis: values grow downward (y) / leftward (x) (default: false) */
  reverse?: boolean;
  /** Target tick count (default: chart density, grid rows for y, ~1 per 90 px for x) */
  tickCount?: number;
}

/** `'y2'` = right y axis of a dual-axis line chart. */
export type ChartAxisName = 'x' | 'y' | 'y2';

/** Engine axis codes (`set_chart_axis_scale`). */
export const AXIS_CODES: Record<ChartAxisName, number> = { x: 0, y: 1, y2: 2 };

/** True when `o` sets any scale option (charts without one skip the engine call). */
export function hasScaleOptions(o?: ChartScaleOptions): o is ChartScaleOptions {
  return !!o && (o.scale !== undefined || o.reverse !== undefined || o.tickCount !== undefined);
}

/** `[kind, reverse, tickCount]` arguments of `set_chart_axis_scale`. */
export function encodeScale(o: ChartScaleOptions): [number, boolean, number] {
  const ticks = o.tickCount !== undefined && Number.isFinite(o.tickCount) ? Math.max(0, Math.round(o.tickCount)) : 0;
  return [o.scale === 'log' ? 1 : 0, o.reverse === true, ticks];
}

/** Engine `chart_axis_scale` result as options (null = no such axis). */
export function decodeScale(a: Float64Array | undefined): Required<ChartScaleOptions> | null {
  if (!a || a.length < 3) return null;
  return { scale: a[0] === 1 ? 'log' : 'linear', reverse: a[1] === 1, tickCount: a[2] };
}

/**
 * Per-series y axis indices (0 = left, 1 = right, 2.. = extra; `yAxisIndex` wins over `yAxis`),
 * or null when every series uses the left axis.
 */
export function encodeSeriesAxes(series: readonly { yAxis?: 'left' | 'right'; yAxisIndex?: number }[]): Uint8Array | null {
  const axes = Uint8Array.from(series, (s) => seriesAxisIndex(s));
  return axes.some((a) => a !== 0) ? axes : null;
}
