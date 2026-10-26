/**
 * `<VizChart :type :data :options :theme ... />`: a positioned `<div>` (overlay host; receives
 * `class` / `style`) around a full-size `<canvas>` driven by `useVizChart`. Events: `ready`,
 * `error`, `hover`, `click`, `select`, `rangeChange`, `legendToggle`, `themeChange`, `resize`.
 * The template ref exposes `sdk` (the engine, `null` until ready), `canvas`, `whenReady()`.
 */
import { defineComponent, h, shallowRef, type PropType } from 'vue';
import type { VizEngineSDK } from '../sdk/viz-engine-sdk';
import type { VizEventMap } from '../sdk/chart-events';
import type {
  VizChartData,
  VizChartInteractions,
  VizChartOptions,
  VizChartSync,
  VizChartTheme,
  VizChartType,
  VizCreateOptions,
} from '../sdk/chart-binding';
import { useVizChart } from './useVizChart';

/**
 * Template ref of `VizChart` (exposed refs are unwrapped):
 * `const chart = ref<VizChartInstance | null>(null)` -> `chart.value?.sdk?.setXRange(...)`.
 */
export interface VizChartInstance {
  /** `null` before the engine is ready and after unmount */
  readonly sdk: VizEngineSDK | null;
  readonly error: unknown;
  readonly canvas: HTMLCanvasElement | null;
  /** Resolves with the engine, or `null` when unmounted first / `create` failed */
  whenReady(): Promise<VizEngineSDK | null>;
}

const any = <V>() => null as unknown as PropType<V>;

export const VizChart = defineComponent({
  name: 'VizChart',
  props: {
    type: { type: String as PropType<VizChartType>, required: true },
    /** Typed arrays / descriptor arrays / objects: no runtime type check */
    data: { type: any<VizChartData>(), required: true },
    options: { type: Object as PropType<VizChartOptions>, default: undefined },
    theme: { type: [String, Object] as PropType<VizChartTheme>, default: undefined },
    syncGroup: { type: [String, Object] as PropType<VizChartSync>, default: undefined },
    interactions: { type: [Object, Boolean] as PropType<VizChartInteractions>, default: undefined },
    createOptions: { type: Object as PropType<VizCreateOptions>, default: undefined },
    canvasClass: { type: String, default: undefined },
  },
  emits: {
    ready: (_sdk: VizEngineSDK) => true,
    error: (_error: unknown) => true,
    hover: (_e: VizEventMap['hover']) => true,
    click: (_e: VizEventMap['click']) => true,
    select: (_e: VizEventMap['select']) => true,
    rangeChange: (_e: VizEventMap['rangechange']) => true,
    legendToggle: (_e: VizEventMap['legendtoggle']) => true,
    themeChange: (_e: VizEventMap['themechange']) => true,
    resize: (_e: VizEventMap['resize']) => true,
    drill: (_e: VizEventMap['drill']) => true,
  },
  setup(props, { emit, expose }) {
    const canvas = shallowRef<HTMLCanvasElement | null>(null);
    const { sdk, error, whenReady } = useVizChart(canvas, {
      type: () => props.type,
      data: () => props.data,
      options: () => props.options,
      theme: () => props.theme,
      syncGroup: () => props.syncGroup,
      interactions: () => props.interactions,
      createOptions: props.createOptions,
      onReady: (s) => emit('ready', s),
      onError: (err) => emit('error', err),
      onHover: (e) => emit('hover', e),
      onClick: (e) => emit('click', e),
      onSelect: (e) => emit('select', e),
      onRangeChange: (e) => emit('rangeChange', e),
      onLegendToggle: (e) => emit('legendToggle', e),
      onThemeChange: (e) => emit('themeChange', e),
      onResize: (e) => emit('resize', e),
      onDrill: (e) => emit('drill', e),
    });
    expose({ sdk, error, canvas, whenReady });
    return () =>
      h('div', { style: { position: 'relative' } }, [
        h('canvas', {
          ref: canvas,
          class: props.canvasClass,
          style: { display: 'block', width: '100%', height: '100%' },
        }),
      ]);
  },
});
