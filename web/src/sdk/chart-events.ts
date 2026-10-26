/**
 * Typed event emitter of `VizEngineSDK` (`sdk.on(...)`) and the rAF throttle behind
 * `'rangechange'`. DOM-free so it runs under the test runner as-is.
 */
import type { ChartTooltipContext, NodeDetails, VizTheme } from './viz-engine-sdk';
import type { VizSelection } from './chart-brush';
import type { VizDrillEvent } from './chart-hierarchy';

/** Visible chart range in data units (line x: series `x` or sample index; y: scatter only). */
export interface VizRange {
  xMin: number;
  xMax: number;
  yMin?: number;
  yMax?: number;
}

export interface VizHoverEvent {
  /** Hovered chart sample / bar / point (`null` = none); only set while a chart is shown */
  chart: ChartTooltipContext | null;
  /** Hovered graph node, or the primary hovered chart point's details (`null` = none) */
  node: NodeDetails | null;
  clientX: number;
  clientY: number;
}

export interface VizClickEvent {
  chart: ChartTooltipContext | null;
  node: NodeDetails | null;
  event: PointerEvent;
}

export interface VizEventMap {
  /** Hover target changed (needs `enableNodeInteractions`); `null`s when the pointer leaves */
  hover: VizHoverEvent;
  /** Click / tap without dragging (needs `enableNodeInteractions`) */
  click: VizClickEvent;
  /** Visible range changed (zoom / pan / reset / `setXRange`), at most once per animation frame */
  rangechange: VizRange;
  /** A series was shown / hidden (legend click or `setSeriesVisible`) */
  legendtoggle: { series: number; visible: boolean };
  themechange: VizTheme;
  /** Render target resized (physical px), by `resize()` or auto-resize */
  resize: { width: number; height: number };
  /**
   * Brush selection committed (drag release with `brush` enabled, or `selectChartRange`), or
   * cleared (Escape, click, `clearSelection`): then `xRange` is `null` and nothing is selected
   */
  select: VizSelection;
  /** Treemap / sunburst drilled into a node or back up (click, breadcrumb, Enter / Escape, `drillTo`) */
  drill: VizDrillEvent;
}

export type VizEventName = keyof VizEventMap;
export type VizEventHandler<K extends VizEventName> = (payload: VizEventMap[K]) => void;

export class VizEventEmitter<M extends object = VizEventMap> {
  private readonly handlers = new Map<keyof M, Set<(payload: never) => void>>();

  /** Subscribes `handler`; returns the unsubscribe function. */
  on<K extends keyof M>(event: K, handler: (payload: M[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler as (payload: never) => void);
    return () => this.off(event, handler);
  }

  off<K extends keyof M>(event: K, handler: (payload: M[K]) => void): void {
    this.handlers.get(event)?.delete(handler as (payload: never) => void);
  }

  /** True when `event` has a subscriber (lets callers skip building the payload). */
  has(event: keyof M): boolean {
    return (this.handlers.get(event)?.size ?? 0) > 0;
  }

  /**
   * Calls every handler of `event`. A throwing handler does not stop the others or the SDK code
   * that emitted: its error is rethrown asynchronously (reported like an uncaught error).
   */
  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const h of [...set]) {
      try {
        (h as (payload: M[K]) => void)(payload);
      } catch (err) {
        setTimeout(() => {
          throw err;
        });
      }
    }
  }

  clear(): void {
    this.handlers.clear();
  }
}

export interface FrameScheduler {
  request(cb: () => void): unknown;
  cancel(handle: unknown): void;
}

/** `requestAnimationFrame` in browsers, a 16 ms timer elsewhere. */
export const defaultFrameScheduler: FrameScheduler =
  typeof requestAnimationFrame === 'function'
    ? {
        request: (cb) => requestAnimationFrame(() => cb()),
        cancel: (h) => cancelAnimationFrame(h as number),
      }
    : {
        request: (cb) => setTimeout(cb, 16),
        cancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      };

/** Coalesces `request()` calls into one `fn()` per frame. */
export function frameThrottle(fn: () => void, scheduler: FrameScheduler = defaultFrameScheduler) {
  let handle: unknown = null;
  return {
    request(): void {
      if (handle !== null) return;
      handle = scheduler.request(() => {
        handle = null;
        fn();
      });
    },
    cancel(): void {
      if (handle !== null) scheduler.cancel(handle);
      handle = null;
    },
  };
}

/** Same range (exact; the engine reports identical numbers for an unchanged window). */
export function sameRange(a: VizRange | null, b: VizRange | null): boolean {
  if (!a || !b) return a === b;
  return a.xMin === b.xMin && a.xMax === b.xMax && a.yMin === b.yMin && a.yMax === b.yMax;
}
