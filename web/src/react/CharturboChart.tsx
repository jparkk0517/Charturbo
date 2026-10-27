/**
 * `<CharturboChart type data options theme ... />`: a positioned `<div>` (overlay host) around a
 * full-size `<canvas>` driven by `useCharturboChart`. Size the chart through `className` / `style`
 * (the canvas follows the div via the SDK's auto-resize). The ref exposes the SDK instance.
 */
import { forwardRef, useImperativeHandle, type CSSProperties, type ReactElement, type Ref } from 'react';
import type { Charturbo } from '../sdk/charturbo';
import type { CharturboChartType } from '../sdk/chart-binding';
import { useCharturboChart, type UseCharturboChartOptions } from './useCharturboChart';

export interface CharturboChartProps<T extends CharturboChartType = CharturboChartType> extends UseCharturboChartOptions<T> {
  className?: string;
  style?: CSSProperties;
  canvasClassName?: string;
  canvasStyle?: CSSProperties;
}

/** Imperative handle (`ref`): the engine for calls the props don't cover (`setXRange`, export, ...). */
export interface CharturboChartHandle {
  /** `null` before the engine is ready and after unmount */
  readonly sdk: Charturbo | null;
  readonly canvas: HTMLCanvasElement | null;
  /** Resolves with the engine, or `null` when unmounted first / `create` failed */
  whenReady(): Promise<Charturbo | null>;
}

const CANVAS_STYLE: CSSProperties = { display: 'block', width: '100%', height: '100%' };

function CharturboChartImpl<T extends CharturboChartType>(props: CharturboChartProps<T>, ref: Ref<CharturboChartHandle>) {
  const { className, style, canvasClassName, canvasStyle, ...options } = props;
  const chart = useCharturboChart(options as UseCharturboChartOptions<T>);
  const { canvasRef, getSdk, whenReady } = chart;
  useImperativeHandle(
    ref,
    () => ({
      get sdk() {
        return getSdk();
      },
      get canvas() {
        return canvasRef.current;
      },
      whenReady,
    }),
    [canvasRef, getSdk, whenReady]
  );
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <canvas
        ref={canvasRef}
        className={canvasClassName}
        style={canvasStyle ? { ...CANVAS_STYLE, ...canvasStyle } : CANVAS_STYLE}
      />
    </div>
  );
}

/** Generic over `type` (data / options are typed per chart kind). */
export const CharturboChart = forwardRef(CharturboChartImpl) as <T extends CharturboChartType>(
  props: CharturboChartProps<T> & { ref?: Ref<CharturboChartHandle> }
) => ReactElement | null;
