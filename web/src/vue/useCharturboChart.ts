/**
 * Vue 3 composable behind `CharturboChart`: one `Charturbo` per mounted canvas (created in
 * `onMounted`, disposed in `onBeforeUnmount`; an unmount while `create` is pending disposes the
 * engine on arrival). Pass a template ref to a `<canvas>` whose parent is positioned.
 *
 * Watches are shallow (identity only, never deep): replace `data` / `options` to re-render
 * (`shallowRef` + new array / object; in-place mutation of a `reactive` array is not seen).
 * `theme` change -> `setTheme` only; `syncGroup` -> `setSync`; `interactions` -> re-bind
 * `enableNodeInteractions`. Values are unwrapped with `toRaw` before reaching the SDK.
 */
import { onBeforeUnmount, onMounted, shallowRef, toRaw, toValue, watch, type MaybeRefOrGetter, type Ref, type ShallowRef } from 'vue';
import type { Charturbo } from '../sdk/charturbo';
import {
  CharturboChartBinding,
  type CharturboChartCallbacks,
  type CharturboChartData,
  type CharturboChartInteractions,
  type CharturboChartOptions,
  type CharturboChartSync,
  type CharturboChartTheme,
  type CharturboChartType,
  type CharturboCreateOptions,
} from '../sdk/chart-binding';

export interface UseCharturboChartOptions<T extends CharturboChartType = CharturboChartType> extends CharturboChartCallbacks {
  type: MaybeRefOrGetter<T>;
  data: MaybeRefOrGetter<CharturboChartData<T>>;
  options?: MaybeRefOrGetter<CharturboChartOptions<T> | undefined>;
  theme?: MaybeRefOrGetter<CharturboChartTheme | undefined>;
  /** Cursor / zoom sync group key (or member options); `null` leaves */
  syncGroup?: MaybeRefOrGetter<CharturboChartSync>;
  /** Tooltip / zoom / pan / touch / brush options; `false` = static chart (default: SDK defaults) */
  interactions?: MaybeRefOrGetter<CharturboChartInteractions | undefined>;
  /** `Charturbo.create` options (`autoResize` default true, `locale`, ...); read on mount */
  createOptions?: CharturboCreateOptions;
}

export interface UseCharturboChartResult {
  /** The engine once ready (`null` before and after unmount) */
  sdk: ShallowRef<Charturbo | null>;
  /** Last `create` / render error (`CharturboInitError` without WebGPU / WebGL2) */
  error: ShallowRef<unknown>;
  /** Resolves with the engine, or `null` when unmounted first / `create` failed */
  whenReady(): Promise<Charturbo | null>;
}

const raw = <V>(v: V): V => (v !== null && typeof v === 'object' ? toRaw(v) : v);

export function useCharturboChart<T extends CharturboChartType>(
  canvas: Ref<HTMLCanvasElement | null | undefined>,
  props: UseCharturboChartOptions<T>
): UseCharturboChartResult {
  const sdk = shallowRef<Charturbo | null>(null);
  const error = shallowRef<unknown>(null);
  let binding: CharturboChartBinding | null = null;

  const callbacks = (): CharturboChartCallbacks => ({
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
    binding = new CharturboChartBinding(el, callbacks, props.createOptions);
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
