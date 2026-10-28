import { describe, expect, it } from 'vitest';
import { EffectClock } from '../sdk/chart-effect';

/** Manual frame scheduler: `step()` runs the pending frame. */
function frames() {
  let pending: (() => void) | null = null;
  return {
    scheduler: {
      request: (cb: () => void) => ((pending = cb), 1),
      cancel: () => (pending = null),
    },
    step: () => {
      const cb = pending;
      pending = null;
      cb?.();
    },
    get pending() {
      return pending !== null;
    },
  };
}

describe('ripple effect clock', () => {
  it('ticks the engine clock and renders each frame while something ripples, then stops', () => {
    const f = frames();
    let rippling = true;
    const times: number[] = [];
    let renders = 0;
    let now = 1000;
    const backend = { set_chart_effect_time: (t: number) => (times.push(t), rippling) };
    const clock = new EffectClock(backend, () => renders++, f.scheduler, () => now, false);
    clock.start();
    // Seconds since start, one render per frame
    expect(times).toEqual([0]);
    expect(renders).toBe(1);
    now = 1500;
    f.step();
    expect(times.at(-1)).toBe(0.5);
    expect(renders).toBe(2);
    // start() while running does not double the loop
    clock.start();
    expect(times.length).toBe(2);
    // Nothing ripples any more (chart replaced): the loop ends
    rippling = false;
    f.step();
    expect(f.pending).toBe(false);
  });

  it('reduced motion freezes the rings (one static frame, no loop); stop() cancels', () => {
    const f = frames();
    const times: number[] = [];
    const backend = { set_chart_effect_time: (t: number) => (times.push(t), true) };
    const still = new EffectClock(backend, () => {}, f.scheduler, () => 0, true);
    still.start();
    expect(times).toEqual([0]);
    expect(f.pending).toBe(false);

    const moving = new EffectClock(backend, () => {}, f.scheduler, () => 0, false);
    moving.start();
    expect(f.pending).toBe(true);
    moving.stop();
    expect(f.pending).toBe(false);
  });
});
