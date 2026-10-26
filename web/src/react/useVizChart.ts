/**
 * React hook behind `VizChart`: one `VizEngineSDK` per mounted canvas. Attach `canvasRef` to a
 * `<canvas>` whose parent is positioned (labels / legend / tooltip overlay mount there).
 *
 * Re-render rules (pass memoized values: `useMemo` / state / module constants):
 * - `type` / `data` / `options` identity change -> one `render*Chart` call (no deep compare).
 * - `theme` identity change -> `setTheme` only (data is not re-sent).
 * - `syncGroup` -> `setSync` when the key / flags change; `interactions` identity change ->
 *   re-binds `enableNodeInteractions`. `createOptions` is read once on mount.
 * - Callbacks (`onHover`, ...) may be inline: the latest ones are called, nothing resubscribes.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
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
  type: T;
  data: VizChartData<T>;
  options?: VizChartOptions<T>;
  theme?: VizChartTheme;
  /** Cursor / zoom sync group key (or member options); `null` leaves */
  syncGroup?: VizChartSync;
  /** Tooltip / zoom / pan / touch / brush options; `false` = static chart (default: SDK defaults) */
  interactions?: VizChartInteractions;
  /** `VizEngineSDK.create` options (`autoResize` default true, `locale`, ...); read on mount */
  createOptions?: VizCreateOptions;
}

export interface UseVizChartResult {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The engine once ready (`null` before and after unmount); changing it re-renders */
  sdk: VizEngineSDK | null;
  /** Last `create` / render error (`VizInitError` without WebGPU / WebGL2) */
  error: unknown;
  /** Live engine (no re-render needed; e.g. inside `onReady` or after `whenReady`) */
  getSdk(): VizEngineSDK | null;
  /**
   * Resolves with the engine, or `null` when unmounted first / `create` failed (also `null`
   * when called before the mount effect ran, e.g. from a parent's layout effect)
   */
  whenReady(): Promise<VizEngineSDK | null>;
}

/** `useLayoutEffect` in the browser, `useEffect` during SSR (no warning, no window access). */
const useIsomorphicLayoutEffect = typeof document !== 'undefined' ? useLayoutEffect : useEffect;

export function useVizChart<T extends VizChartType>(props: UseVizChartOptions<T>): UseVizChartResult {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bindingRef = useRef<VizChartBinding | null>(null);
  const propsRef = useRef(props);
  const [sdk, setSdk] = useState<VizEngineSDK | null>(null);
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
    const binding = new VizChartBinding(
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
  const { type, data, options, theme, syncGroup, interactions } = props;
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

  const whenReady = useCallback(() => bindingRef.current?.ready ?? Promise.resolve(null), []);
  const getSdk = useCallback(() => bindingRef.current?.sdk ?? null, []);
  return { canvasRef, sdk, error, getSdk, whenReady };
}
