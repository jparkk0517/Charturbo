/**
 * Vue 3 composable behind `VizChart`: one `VizEngineSDK` per mounted canvas (created in
 * `onMounted`, disposed in `onBeforeUnmount`; an unmount while `create` is pending disposes the
 * engine on arrival). Pass a template ref to a `<canvas>` whose parent is positioned.
 *
 * Watches are shallow (identity only, never deep): replace `data` / `options` to re-render
 * (`shallowRef` + new array / object; in-place mutation of a `reactive` array is not seen).
 * `theme` change -> `setTheme` only; `syncGroup` -> `setSync`; `interactions` -> re-bind
 * `enableNodeInteractions`. Values are unwrapped with `toRaw` before reaching the SDK.
 */
import { onBeforeUnmount, onMounted, shallowRef, toRaw, toValue, watch, type MaybeRefOrGetter, type Ref, type ShallowRef } from 'vue';
import type { VizEngineSDK } from '../sdk/viz-engine-sdk';
import {
  VizChartBinding,
  type VizChartCallbacks,
  type VizChartData,
  type VizChartInteractions,
  type VizChartOptions,
  type VizChartSync,
  type VizChartTheme,
  type VizChartType,
  type VizCreateOptions,
} from '../sdk/chart-binding';

export interface UseVizChartOptions<T extends VizChartType = VizChartType> extends VizChartCallbacks {
  type: MaybeRefOrGetter<T>;
  data: MaybeRefOrGetter<VizChartData<T>>;
  options?: MaybeRefOrGetter<VizChartOptions<T> | undefined>;
  theme?: MaybeRefOrGetter<VizChartTheme | undefined>;
  /** Cursor / zoom sync group key (or member options); `null` leaves */
  syncGroup?: MaybeRefOrGetter<VizChartSync>;
  /** Tooltip / zoom / pan / touch / brush options; `false` = static chart (default: SDK defaults) */
  interactions?: MaybeRefOrGetter<VizChartInteractions | undefined>;
  /** `VizEngineSDK.create` options (`autoResize` default true, `locale`, ...); read on mount */
  createOptions?: VizCreateOptions;
}

export interface UseVizChartResult {
  /** The engine once ready (`null` before and after unmount) */
  sdk: ShallowRef<VizEngineSDK | null>;
  /** Last `create` / render error (`VizInitError` without WebGPU / WebGL2) */
  error: ShallowRef<unknown>;
  /** Resolves with the engine, or `null` when unmounted first / `create` failed */
  whenReady(): Promise<VizEngineSDK | null>;
}

const raw = <V>(v: V): V => (v !== null && typeof v === 'object' ? toRaw(v) : v);

export function useVizChart<T extends VizChartType>(
  canvas: Ref<HTMLCanvasElement | null | undefined>,
  props: UseVizChartOptions<T>
): UseVizChartResult {
  const sdk = shallowRef<VizEngineSDK | null>(null);
  const error = shallowRef<unknown>(null);
  let binding: VizChartBinding | null = null;

  const callbacks = (): VizChartCallbacks => ({
    ...props,
    onReady: (s) => {
      error.value = null;
      sdk.value = s;
      props.onReady?.(s);
    },
    onError: (err) => {
      error.value = err;
      props.onError?.(err);
    },
  });

  const type = () => toValue(props.type);
  const data = () => raw(toValue(props.data));
  const options = () => raw(toValue(props.options));
  const theme = () => raw(toValue(props.theme));
  const sync = () => raw(toValue(props.syncGroup));
  const interactions = () => raw(toValue(props.interactions));

  onMounted(() => {
    const el = canvas.value;
    if (!el) return;
    binding = new VizChartBinding(el, callbacks, props.createOptions);
    binding.setChart(type(), data(), options());
    binding.setTheme(theme());
    binding.setSync(sync());
    binding.setInteractions(interactions());
  });

  // Multi-source: each value compared by identity (one call when several change in one tick)
  watch([type, data, options], ([t, d, o]) => binding?.setChart(t, d, o));
  watch(theme, (v) => binding?.setTheme(v));
  watch(sync, (v) => binding?.setSync(v));
  watch(interactions, (v) => binding?.setInteractions(v));

  onBeforeUnmount(() => {
    binding?.dispose();
    binding = null;
    sdk.value = null;
  });

  return { sdk, error, whenReady: () => binding?.ready ?? Promise.resolve(null) };
}
