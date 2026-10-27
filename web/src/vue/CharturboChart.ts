/**
 * `<CharturboChart :type :data :options :theme ... />`: a positioned `<div>` (overlay host; receives
 * `class` / `style`) around a full-size `<canvas>` driven by `useCharturboChart`. Events: `ready`,
 * `error`, `hover`, `click`, `select`, `rangeChange`, `legendToggle`, `themeChange`, `resize`.
 * The template ref exposes `sdk` (the engine, `null` until ready), `canvas`, `whenReady()`.
 */
import { defineComponent, h, shallowRef, type PropType } from 'vue';
import type { Charturbo } from '../sdk/charturbo';
import type { CharturboEventMap } from '../sdk/chart-events';
import type {
  CharturboChartData,
  CharturboChartInteractions,
  CharturboChartOptions,
  CharturboChartSync,
  CharturboChartTheme,
  CharturboChartType,
  CharturboCreateOptions,
} from '../sdk/chart-binding';
import { useCharturboChart } from './useCharturboChart';

/**
 * Template ref of `CharturboChart` (exposed refs are unwrapped):
 * `const chart = ref<CharturboChartInstance | null>(null)` -> `chart.value?.sdk?.setXRange(...)`.
 */
export interface CharturboChartInstance {
  /** `null` before the engine is ready and after unmount */
  readonly sdk: Charturbo | null;
  readonly error: unknown;
  readonly canvas: HTMLCanvasElement | null;
  /** Resolves with the engine, or `null` when unmounted first / `create` failed */
  whenReady(): Promise<Charturbo | null>;
}

const any = <V>() => null as unknown as PropType<V>;

export const CharturboChart = defineComponent({
  name: 'CharturboChart',
  props: {
    type: { type: String as PropType<CharturboChartType>, required: true },
    /** Typed arrays / descriptor arrays / objects: no runtime type check */
    data: { type: any<CharturboChartData>(), required: true },
    options: { type: Object as PropType<CharturboChartOptions>, default: undefined },
    theme: { type: [String, Object] as PropType<CharturboChartTheme>, default: undefined },
    syncGroup: { type: [String, Object] as PropType<CharturboChartSync>, default: undefined },
    interactions: { type: [Object, Boolean] as PropType<CharturboChartInteractions>, default: undefined },
    createOptions: { type: Object as PropType<CharturboCreateOptions>, default: undefined },
    canvasClass: { type: String, default: undefined },
  },
  emits: {
    ready: (_sdk: Charturbo) => true,
    error: (_error: unknown) => true,
    hover: (_e: CharturboEventMap['hover']) => true,
    click: (_e: CharturboEventMap['click']) => true,
    select: (_e: CharturboEventMap['select']) => true,
    rangeChange: (_e: CharturboEventMap['rangechange']) => true,
    legendToggle: (_e: CharturboEventMap['legendtoggle']) => true,
    themeChange: (_e: CharturboEventMap['themechange']) => true,
    resize: (_e: CharturboEventMap['resize']) => true,
    drill: (_e: CharturboEventMap['drill']) => true,
  },
  setup(props, { emit, expose }) {
    const canvas = shallowRef<HTMLCanvasElement | null>(null);
    const { sdk, error, whenReady } = useCharturboChart(canvas, {
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
