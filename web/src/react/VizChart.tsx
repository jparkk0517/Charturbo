/**
 * `<VizChart type data options theme ... />`: a positioned `<div>` (overlay host) around a
 * full-size `<canvas>` driven by `useVizChart`. Size the chart through `className` / `style`
 * (the canvas follows the div via the SDK's auto-resize). The ref exposes the SDK instance.
 */
import { forwardRef, useImperativeHandle, type CSSProperties, type ReactElement, type Ref } from 'react';
import type { VizEngineSDK } from '../sdk/viz-engine-sdk';
import type { VizChartType } from '../sdk/chart-binding';
import { useVizChart, type UseVizChartOptions } from './useVizChart';

export interface VizChartProps<T extends VizChartType = VizChartType> extends UseVizChartOptions<T> {
  className?: string;
  style?: CSSProperties;
  canvasClassName?: string;
  canvasStyle?: CSSProperties;
}

/** Imperative handle (`ref`): the engine for calls the props don't cover (`setXRange`, export, ...). */
export interface VizChartHandle {
  /** `null` before the engine is ready and after unmount */
  readonly sdk: VizEngineSDK | null;
  readonly canvas: HTMLCanvasElement | null;
  /** Resolves with the engine, or `null` when unmounted first / `create` failed */
  whenReady(): Promise<VizEngineSDK | null>;
}

const CANVAS_STYLE: CSSProperties = { display: 'block', width: '100%', height: '100%' };

function VizChartImpl<T extends VizChartType>(props: VizChartProps<T>, ref: Ref<VizChartHandle>) {
  const { className, style, canvasClassName, canvasStyle, ...options } = props;
  const chart = useVizChart(options as UseVizChartOptions<T>);
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
export const VizChart = forwardRef(VizChartImpl) as <T extends VizChartType>(
  props: VizChartProps<T> & { ref?: Ref<VizChartHandle> }
) => ReactElement | null;
