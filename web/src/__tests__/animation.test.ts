// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AnimationDriver,
  DEFAULT_ANIMATION_MS,
  easingCode,
  resolveAnimation,
  sameAnimation,
  type AnimationBackend,
} from '../sdk/chart-animation';
import type { FrameScheduler } from '../sdk/chart-events';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

// The a11y layer is covered by its own suite
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    showDataTable(): void {}
    hideDataTable(): void {}
    getDataTable(): null {
      return null;
    }
    exportCSV(): string {
      return '';
    }
    summary(): string {
      return '';
    }
  },
}));

/** Manual frame scheduler: `flush()` runs the queued frame callbacks once. */
function manualScheduler() {
  let queue: (() => void)[] = [];
  const s: FrameScheduler & { flush(): number; pending(): number } = {
    request: (cb) => {
      queue.push(cb);
      return queue.length;
    },
    cancel: () => {
      queue = [];
    },
    flush: () => {
      const q = queue;
      queue = [];
      q.forEach((cb) => cb());
      return q.length;
    },
    pending: () => queue.length,
  };
  return s;
}

/** Engine stand-in with the Rust clock semantics: the first tick starts it, `duration` ends it. */
function fakeEngine(duration = 100) {
  const state = { phase: false, start: null as number | null, ticks: 0, finished: 0 };
  const backend: AnimationBackend & { start(): void } = {
    start: () => {
      state.phase = true;
      state.start = null;
    },
    chart_animating: () => state.phase,
    chart_animation_tick: (now: number) => {
      if (!state.phase) return false;
      state.ticks++;
      state.start ??= now;
      if (now - state.start >= duration) {
        state.phase = false;
        return false;
      }
      return true;
    },
    chart_finish_animation: () => {
      state.finished++;
      state.phase = false;
    },
  };
  return { backend, state };
}

describe('resolveAnimation', () => {
  it('resolves true / options / false and validates', () => {
    expect(resolveAnimation(true, false)).toEqual({ duration: DEFAULT_ANIMATION_MS, easing: 'ease-out' });
    expect(resolveAnimation({ duration: 250, easing: 'linear' }, false)).toEqual({ duration: 250, easing: 'linear' });
    expect(resolveAnimation(false, false)).toBeNull();
    expect(resolveAnimation(undefined, false)).toBeNull();
    expect(resolveAnimation({ duration: 0 }, false)).toBeNull();
    expect(() => resolveAnimation({ duration: -1 }, false)).toThrow(/duration/);
    expect(() => resolveAnimation({ duration: NaN }, false)).toThrow(/duration/);
    expect(() => resolveAnimation({ easing: 'bounce' as never }, false)).toThrow(/easing/);
    expect(easingCode('linear')).toBe(0);
    expect(easingCode('ease-in-out')).toBe(2);
    expect(sameAnimation({ duration: 1, easing: 'linear' }, { duration: 1, easing: 'linear' })).toBe(true);
    expect(sameAnimation(null, { duration: 1, easing: 'linear' })).toBe(false);
  });

  it('prefers-reduced-motion turns animations off', () => {
    expect(resolveAnimation(true, true)).toBeNull();
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce') }));
    expect(resolveAnimation(true)).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('AnimationDriver', () => {
  it('ticks + renders once per frame while the engine animates, then stops (no idle loop)', () => {
    const { backend, state } = fakeEngine(100);
    const sched = manualScheduler();
    let now = 0;
    const renders: number[] = [];
    const driver = new AnimationDriver(backend, () => {
      renders.push(now);
      driver.kick(); // render() kicks: must not start a second loop
    }, sched, () => now);

    driver.kick();
    expect(driver.running).toBe(false); // nothing animates
    expect(sched.pending()).toBe(0);

    backend.start();
    driver.kick();
    expect(driver.running).toBe(true);
    for (const t of [16, 33, 50, 66, 83]) {
      now = t;
      expect(sched.flush()).toBe(1);
    }
    expect(renders).toEqual([16, 33, 50, 66, 83]);
    now = 100;
    sched.flush(); // final frame: tick reports the end, the staged layers are rendered
    expect(renders.at(-1)).toBe(100);
    expect(driver.running).toBe(false);
    expect(sched.pending()).toBe(0);
    // Idle: later kicks do nothing
    driver.kick();
    now = 200;
    expect(sched.flush()).toBe(0);
    expect(state.ticks).toBe(7);
  });

  it('finishes immediately without frames (no rAF / hidden tab) and on finish()', () => {
    const { backend, state } = fakeEngine();
    const noFrames = new AnimationDriver(backend, () => {}, null);
    backend.start();
    noFrames.kick();
    expect(state.finished).toBe(1);
    expect(state.phase).toBe(false);

    const sched = manualScheduler();
    const driver = new AnimationDriver(backend, () => {}, sched, () => 0);
    backend.start();
    driver.kick();
    expect(driver.running).toBe(true);
    driver.finish();
    expect(driver.running).toBe(false);
    expect(state.phase).toBe(false);
    expect(sched.pending()).toBe(0);
    driver.dispose();
    backend.start();
    driver.kick();
    expect(driver.running).toBe(false);
  });
});

function sdkWith(extra: Partial<WasmCharturboEngineBackend> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const backend = {
    set_line_chart: record('set_line_chart', 3),
    set_bar_chart: record('set_bar_chart', 3),
    set_chart_animation: record('set_chart_animation'),
    sync_and_render: record('sync_and_render'),
    clear_scene_objects: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    set_scene_helpers: () => {},
    clear_selection: () => {},
    ...extra,
  } as unknown as WasmCharturboEngineBackend;
  return { sdk: Charturbo.fromBackend(backend), calls };
}

describe('SDK animation wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('is off by default: no engine calls, no frame loop', () => {
    const animating = vi.fn(() => true);
    const { sdk, calls } = sdkWith({ chart_animating: animating });
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    sdk.render();
    expect(calls.set_chart_animation).toBeUndefined();
    expect(animating).not.toHaveBeenCalled();
    expect(sdk.getAnimation()).toBeNull();
  });

  it('setAnimation applies the SDK default; a chart option overrides it for that chart only', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { sdk, calls } = sdkWith();
    sdk.setAnimation({ duration: 300, easing: 'linear' });
    expect(calls.set_chart_animation).toEqual([[300, 0]]);
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    expect(calls.set_chart_animation.length).toBe(1); // unchanged: no re-send
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }], { animation: false });
    expect(calls.set_chart_animation.at(-1)?.[0]).toBeNaN();
    // The next chart without an option is back on the SDK default
    sdk.renderBarChart([{ label: 'A', value: 1 }]);
    expect(calls.set_chart_animation.at(-1)).toEqual([300, 0]);
    sdk.renderBarChart([{ label: 'A', value: 1 }], { animation: { duration: 900, easing: 'ease-in' } });
    expect(calls.set_chart_animation.at(-1)).toEqual([900, 3]);
    expect(() => sdk.renderBarChart([{ label: 'A', value: 1 }], { animation: { duration: -5 } })).toThrow(/duration/);
  });

  it('reduced motion keeps the engine off even when enabled', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const { sdk, calls } = sdkWith();
    sdk.setAnimation(true);
    sdk.renderLineChart([{ name: 'A', values: [1, 2] }], { animation: true });
    expect(calls.set_chart_animation).toBeUndefined();
  });

  it('render() starts the rAF loop only while the engine animates and stops after', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const flush = () => {
      const f = frames;
      frames = [];
      f.forEach((cb) => cb(now));
      return f.length;
    };
    const { backend, state } = fakeEngine(50);
    const { sdk, calls } = sdkWith(backend as Partial<WasmCharturboEngineBackend>);
    sdk.setAnimation({ duration: 50 });
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    backend.start(); // the engine armed the enter animation
    sdk.render();
    expect(sdk.isAnimating()).toBe(true);
    const before = calls.sync_and_render.length;
    let n = 0;
    while (n < 20) {
      now += 16;
      if (flush() === 0) break;
      n++;
    }
    expect(n).toBe(4); // 16, 32, 48 run on; 64 ends it
    expect(state.phase).toBe(false);
    expect(calls.sync_and_render.length).toBe(before + 4);
    sdk.render();
    expect(frames.length).toBe(0); // idle: one render, no loop
    expect(sdk.isAnimating()).toBe(false);
    vi.restoreAllMocks();
  });
});
