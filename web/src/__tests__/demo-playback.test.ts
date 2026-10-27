// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoPlayback } from '../../examples/src/demo-playback';

describe('landing demo playback lifecycle', () => {
  let intersect: IntersectionObserverCallback;
  let motion: EventTarget & { matches: boolean };
  let hidden: boolean;
  let frames: Map<number, FrameRequestCallback>;
  let nextId: number;
  const disconnect = vi.fn();
  const cleanups: Array<() => void> = [];
  const visible = (value: boolean) => intersect([{ isIntersecting: value } as IntersectionObserverEntry], {} as IntersectionObserver);
  const frame = (time: number) => {
    const current = [...frames.values()];
    frames.clear();
    current.forEach((callback) => callback(time));
  };
  const mount = () => {
    const tick = vi.fn();
    const demo = createDemoPlayback(document.createElement('div'), tick);
    cleanups.push(demo.dispose);
    return { demo, tick };
  };

  beforeEach(() => {
    hidden = false;
    frames = new Map();
    nextId = 0;
    motion = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal('matchMedia', () => motion);
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextId, callback); return nextId; });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { intersect = callback; }
      observe() {}
      disconnect = disconnect;
    });
  });
  afterEach(() => {
    cleanups.splice(0).forEach((dispose) => dispose());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    disconnect.mockClear();
  });

  it('only advances visible demos and never schedules duplicate loops', () => {
    const { demo, tick } = mount();
    expect(frames.size).toBe(0);
    visible(true);
    visible(true);
    demo.setPaused(false);
    expect(frames.size).toBe(1);
    frame(100);
    frame(150);
    expect(tick.mock.calls).toEqual([[0], [50]]);
    visible(false);
    expect(frames.size).toBe(0);
    frame(200);
    expect(tick).toHaveBeenCalledTimes(2);
  });

  it('pauses explicitly and resumes without accumulating skipped time', () => {
    const { demo, tick } = mount();
    visible(true);
    frame(100);
    demo.setPaused(true);
    expect(demo.paused).toBe(true);
    expect(frames.size).toBe(0);
    demo.setPaused(false);
    frame(60_000);
    expect(tick).toHaveBeenLastCalledWith(0);
    frame(65_000);
    expect(tick).toHaveBeenLastCalledWith(100); // bounded after a slow frame
  });

  it('stops hidden tabs and does not restart a user-paused demo on return', () => {
    const { demo } = mount();
    visible(true);
    hidden = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
    demo.setPaused(true);
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(frames.size).toBe(0);
  });

  it('respects reduced motion on mount and preference changes, with explicit opt-in', () => {
    motion.matches = true;
    const { demo } = mount();
    visible(true);
    expect(demo.paused).toBe(true);
    expect(frames.size).toBe(0);
    demo.setPaused(false);
    expect(frames.size).toBe(1);
    motion.dispatchEvent(new Event('change'));
    expect(demo.paused).toBe(true);
    expect(frames.size).toBe(0);
  });

  it('disposes observers and pending frames permanently', () => {
    const { demo, tick } = mount();
    visible(true);
    demo.dispose();
    demo.dispose();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(frames.size).toBe(0);
    visible(true);
    demo.setPaused(false);
    motion.dispatchEvent(new Event('change'));
    document.dispatchEvent(new Event('visibilitychange'));
    frame(100);
    expect(tick).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });
});
