/**
 * Opt-in chart animations (`Charturbo.create(canvas, { animation })`, `setAnimation`, or the
 * `animation` option of a chart): enter (lines reveal left -> right, bars grow from the
 * baseline, points / pie slices fade + scale in) and update (`setSeriesData`, or a chart
 * re-rendered with data of the same shape: y values / bar heights / pie angles tween). The
 * engine interpolates its staged GPU instances (chart/animation.rs); this module only resolves
 * the options and drives `requestAnimationFrame` while an animation runs (no idle loop).
 * Off by default; `prefers-reduced-motion: reduce` turns them off. DOM-light: runs under the
 * test runner as-is.
 */
import type { FrameScheduler } from './chart-events';

export type ChartEasing = 'linear' | 'ease-out' | 'ease-in-out' | 'ease-in';

export interface ChartAnimationOptions {
  /** Duration in ms (default 400) */
  duration?: number;
  /** Timing curve (default `'ease-out'`) */
  easing?: ChartEasing;
}

/** `true` = defaults, `false` = off, or the options. */
export type ChartAnimationInput = ChartAnimationOptions | boolean;

export interface ResolvedAnimation {
  duration: number;
  easing: ChartEasing;
}

export const DEFAULT_ANIMATION_MS = 400;

const EASING_CODES: Record<ChartEasing, number> = { linear: 0, 'ease-out': 1, 'ease-in-out': 2, 'ease-in': 3 };

export function easingCode(e: ChartEasing): number {
  return EASING_CODES[e] ?? 1;
}

/** True when the user asked the OS / browser for reduced motion. */
export function prefersReducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Animation settings of `input` (`null` = off). Throws on a bad duration / easing so mistakes
 * surface at the call site. `reducedMotion` (default: the media query) forces off.
 */
export function resolveAnimation(input: ChartAnimationInput | undefined | null, reducedMotion = prefersReducedMotion()): ResolvedAnimation | null {
  if (input === undefined || input === null || input === false) return null;
  const o: ChartAnimationOptions = input === true ? {} : input;
  const duration = o.duration ?? DEFAULT_ANIMATION_MS;
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) {
    throw new Error(`animation: duration must be a finite number >= 0 (got ${String(duration)})`);
  }
  const easing = o.easing ?? 'ease-out';
  if (!(easing in EASING_CODES)) throw new Error(`animation: unknown easing '${String(easing)}'`);
  if (reducedMotion || duration === 0) return null;
  return { duration, easing };
}

export function sameAnimation(a: ResolvedAnimation | null, b: ResolvedAnimation | null): boolean {
  return a === b || (!!a && !!b && a.duration === b.duration && a.easing === b.easing);
}

/** Engine calls the driver needs (optional: older wasm builds have no animations). */
export interface AnimationBackend {
  set_chart_animation?(durationMs: number, easing: number): void;
  chart_animation_tick?(nowMs: number): boolean;
  chart_animating?(): boolean;
  chart_finish_animation?(): void;
}

/** Sends `anim` to the engine (NaN duration = off). */
export function applyAnimation(backend: AnimationBackend, anim: ResolvedAnimation | null): void {
  backend.set_chart_animation?.(anim ? anim.duration : NaN, anim ? easingCode(anim.easing) : 1);
}

/** `requestAnimationFrame`, looked up per frame (`null` scheduler = none available). */
const rafScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (h) => cancelAnimationFrame(h as number),
};

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

/**
 * Runs one engine tick + render per animation frame while the engine reports a running
 * animation, then stops. `kick()` after every render: it starts the loop only when needed.
 */
export class AnimationDriver {
  private handle: unknown = null;
  private disposed = false;

  constructor(
    private readonly backend: AnimationBackend,
    private readonly render: () => void,
    /** Default: `requestAnimationFrame` when the runtime has it */
    private readonly frames?: FrameScheduler | null,
    private readonly clock: () => number = now
  ) {}

  private get scheduler(): FrameScheduler | null {
    if (this.frames !== undefined) return this.frames;
    return typeof requestAnimationFrame === 'function' ? rafScheduler : null;
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** Starts the frame loop if the engine animates (no-op while running). */
  kick(): void {
    if (this.disposed || this.handle !== null || !this.backend.chart_animating?.()) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!this.scheduler || hidden || !this.backend.chart_animation_tick) {
      // No frames to animate on (no rAF / background tab): show the final frame
      this.backend.chart_finish_animation?.();
      return;
    }
    this.backend.chart_animation_tick(this.clock());
    this.schedule();
  }

  private schedule(): void {
    this.handle = this.scheduler!.request(() => {
      this.handle = null;
      if (this.disposed) return;
      const more = this.backend.chart_animation_tick?.(this.clock()) ?? false;
      if (more) this.schedule();
      // Rendered after scheduling so the render's own `kick()` sees the loop running; the
      // final frame (more = false) uploads the staged layers
      this.render();
    });
  }

  /** Jumps to the final frame and stops the loop. */
  finish(): void {
    if (this.handle !== null) this.scheduler?.cancel(this.handle);
    this.handle = null;
    this.backend.chart_finish_animation?.();
  }

  dispose(): void {
    this.finish();
    this.disposed = true;
  }
}
