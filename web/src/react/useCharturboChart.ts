/**
 * React hook behind `CharturboChart`: one `Charturbo` per mounted canvas. Attach `canvasRef` to a
 * `<canvas>` whose parent is positioned (labels / legend / tooltip overlay mount there).
 *
 * Re-render rules (pass memoized values: `useMemo` / state / module constants):
 * - `type` / `data` / `options` identity change -> one `render*Chart` call (no deep compare).
 * - `theme` identity change -> `setTheme` only (data is not re-sent).
 * - `syncGroup` -> `setSync` when the key / flags change; `interactions` identity change ->
 *   re-binds `enableNodeInteractions`. `createOptions` is read once on mount.
 * - `loading` -> `showLoading` / `hideLoading`; `watermark` -> `setWatermark` (identity change).
 * - Callbacks (`onHover`, ...) may be inline: the latest ones are called, nothing resubscribes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Charturbo } from '../sdk/charturbo';
import type { ChartWatermarkOptions } from '../sdk/chart-watermark';
import {
  CharturboChartBinding,
  type CharturboChartCallbacks,
  type CharturboChartData,
  type CharturboChartInteractions,
  type CharturboChartLoading,
  type CharturboChartOptions,
  type CharturboChartSync,
  type CharturboChartTheme,
  type CharturboChartType,
  type CharturboCreateOptions,
} from '../sdk/chart-binding';

export interface UseCharturboChartOptions<T extends CharturboChartType = CharturboChartType> extends CharturboChartCallbacks {
  type: T;
  data: CharturboChartData<T>;
  options?: CharturboChartOptions<T>;
  theme?: CharturboChartTheme;
  /** Cursor / zoom sync group key (or member options); `null` leaves */
  syncGroup?: CharturboChartSync;
  /** Tooltip / zoom / pan / touch / brush options; `false` = static chart (default: SDK defaults) */
  interactions?: CharturboChartInteractions;
  /** `true` / `showLoading` options = loading indicator, falsy = hidden (rendering never hides it) */
  loading?: CharturboChartLoading;
  /** `setWatermark` options (absent / null = none) */
  watermark?: ChartWatermarkOptions | null;
  /** `Charturbo.create` options (`autoResize` default true, `locale`, ...); read on mount */
  createOptions?: CharturboCreateOptions;
}

export interface UseCharturboChartResult {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The engine once ready (`null` before and after unmount); changing it re-renders */
  sdk: Charturbo | null;
  /** Last `create` / render error (`CharturboInitError` without WebGPU / WebGL2) */
  error: unknown;
  /** Live engine (no re-render needed; e.g. inside `onReady` or after `whenReady`) */
  getSdk(): Charturbo | null;
  /**
   * Resolves with the engine, or `null` when unmounted first / `create` failed (also `null`
   * when called before the mount effect ran, e.g. from a parent's layout effect)
   */
  whenReady(): Promise<Charturbo | null>;
}

/** `useLayoutEffect` in the browser, `useEffect` during SSR (no warning, no window access). */
const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export function useCharturboChart<T extends CharturboChartType>(props: UseCharturboChartOptions<T>): UseCharturboChartResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bindingRef = useRef<CharturboChartBinding | null>(null);
  const propsRef = useRef(props);
  const [sdk, setSdk] = useState<Charturbo | null>(null);
  const [error, setError] = useState<unknown>(null);

  useIsomorphicLayoutEffect(() => {
    propsRef.current = props;
  });

  // Mount: one binding per canvas. StrictMode's mount -> unmount -> mount disposes the first
  // binding before its (microtask-deferred) create starts; an unmount while create is pending
  // disposes the engine on arrival.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const binding = new CharturboChartBinding(
      canvas,
      () => {
        const p = propsRef.current;
        return {
          ...p,
          onReady: (s) => {
            setError(null);
            setSdk(s);
            propsRef.current.onReady?.(s);
          },
          onError: (err) => {
            setError(err);
            propsRef.current.onError?.(err);
          },
        };
      },
      propsRef.current.createOptions
    );
    bindingRef.current = binding;
    return () => {
      binding.dispose();
      if (bindingRef.current === binding) bindingRef.current = null;
      setSdk(null);
    };
  }, []);

  // Declared after the mount effect: they run after it in the same commit (and again after a
  // StrictMode remount), so the new binding always receives the current props
  const { type, data, options, theme, syncGroup, interactions, loading, watermark } = props;
  useEffect(() => {
    bindingRef.current?.setChart(type, data, options);
  }, [type, data, options]);
  useEffect(() => {
    bindingRef.current?.setTheme(theme);
  }, [theme]);
  useEffect(() => {
    bindingRef.current?.setSync(syncGroup);
  }, [syncGroup]);
  useEffect(() => {
    bindingRef.current?.setInteractions(interactions);
  }, [interactions]);
  useEffect(() => {
    bindingRef.current?.setLoading(loading);
  }, [loading]);
  useEffect(() => {
    bindingRef.current?.setWatermark(watermark);
  }, [watermark]);

  const whenReady = useCallback(() => bindingRef.current?.ready ?? Promise.resolve(null), []);
  const getSdk = useCallback(() => bindingRef.current?.sdk ?? null, []);
  return { canvasRef, sdk, error, getSdk, whenReady };
}
