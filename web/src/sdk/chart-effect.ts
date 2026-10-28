/**
 * Frame clock of continuous chart effects (the scatter ripple). Unlike the opt-in enter / update
 * animations, a ripple loops for as long as it is shown: each frame sends the elapsed seconds to
 * the engine (only the point uniform changes) and renders; the loop ends by itself once the
 * engine reports nothing to animate (the chart was replaced). `prefers-reduced-motion: reduce`
 * freezes the rings in one static frame. Hidden tabs pause with `requestAnimationFrame`.
 */
import type { FrameScheduler } from './chart-events';
import { prefersReducedMotion } from './chart-animation';

/** Engine call of the clock (optional: older wasm builds have no effects). */
export interface EffectBackend {
  set_chart_effect_time?(seconds: number): boolean;
}

/** `requestAnimationFrame` only: without real frames the rings stay static. */
const rafScheduler: FrameScheduler = {
  request: (cb) => requestAnimationFrame(() => cb()),
  cancel: (h) => cancelAnimationFrame(h as number),
};

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

export class EffectClock {
  private handle: unknown = null;
  private start0 = 0;

  constructor(
    private readonly backend: EffectBackend,
    private readonly render: () => void,
    /** Default: `requestAnimationFrame` when the runtime has it */
    private readonly frames?: FrameScheduler | null,
    private readonly clock: () => number = now,
    private readonly reducedMotion: boolean = prefersReducedMotion()
  ) {}

  private get scheduler(): FrameScheduler | null {
    if (this.frames !== undefined) return this.frames;
    return typeof requestAnimationFrame === 'function' ? rafScheduler : null;
  }

  /** Shows the effect from t = 0 and keeps it running (no-op while running). */
  start(): void {
    if (this.handle !== null) return;
    this.start0 = this.clock();
    if (!this.backend.set_chart_effect_time?.(0)) return;
    this.render();
    if (!this.reducedMotion && this.scheduler) this.schedule();
  }

  private schedule(): void {
    this.handle = this.scheduler!.request(() => {
      this.handle = null;
      if (!this.backend.set_chart_effect_time?.((this.clock() - this.start0) / 1000)) return;
      this.schedule();
      this.render();
    });
  }

  stop(): void {
    if (this.handle !== null) this.scheduler?.cancel(this.handle);
    this.handle = null;
  }
}
