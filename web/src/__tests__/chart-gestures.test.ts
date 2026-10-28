import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TOUCH_ORBIT_RAD_PER_PX,
  TouchGestureRecognizer,
  createTouchGestures,
  type GesturePointer,
  type TouchGestureActions,
  type TouchGestureCallbacks,
  type TouchGestureConfig,
  type TouchNavMode,
} from '../sdk/chart-gestures';

const pt = (pointerId: number, clientX: number, clientY: number, timeStamp = 0, pointerType = 'touch'): GesturePointer => ({
  pointerId,
  pointerType,
  clientX,
  clientY,
  timeStamp,
});

function spies() {
  return {
    onGestureStart: vi.fn(),
    onDrag: vi.fn(),
    onPinch: vi.fn(),
    onTwoFingerPan: vi.fn(),
    onTap: vi.fn(),
    onDoubleTap: vi.fn(),
    onScrubStart: vi.fn(),
    onScrub: vi.fn(),
    onScrubEnd: vi.fn(),
  } satisfies TouchGestureCallbacks;
}

function make(config: Partial<TouchGestureConfig> = {}) {
  const cb = spies();
  const rec = new TouchGestureRecognizer(cb, { inertia: false, ...config });
  return { cb, rec };
}

describe('TouchGestureRecognizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ignores mouse pointers but consumes touch and pen', () => {
    const { rec } = make();
    expect(rec.pointerDown(pt(1, 0, 0, 0, 'mouse'))).toBe(false);
    expect(rec.pointerMove(pt(1, 5, 0, 0, 'mouse'))).toBe(false);
    expect(rec.pointerUp(pt(1, 5, 0, 0, 'mouse'))).toBe(false);
    expect(rec.pointerDown(pt(2, 0, 0, 0, 'pen'))).toBe(true);
    expect(rec.pointerDown(pt(3, 0, 0, 0, 'touch'))).toBe(true);
    expect(rec.pointerCount).toBe(2);
  });

  it('untracked pen hover moves fall through to the mouse path', () => {
    const { rec } = make();
    expect(rec.pointerMove(pt(7, 10, 10, 0, 'pen'))).toBe(false);
  });

  it('tap: release within slop fires onTap only', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100, 0));
    rec.pointerMove(pt(1, 104, 103, 30));
    rec.pointerUp(pt(1, 104, 103, 60));
    expect(cb.onTap).toHaveBeenCalledTimes(1);
    expect(cb.onTap.mock.calls[0][0]).toMatchObject({ clientX: 104, clientY: 103 });
    expect(cb.onDrag).not.toHaveBeenCalled();
    expect(cb.onGestureStart).not.toHaveBeenCalled();
  });

  it('drag: moving past the slop becomes a drag (first delta covers the whole travel), no tap', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 0, 0, 0));
    rec.pointerMove(pt(1, 6, 0, 10)); // within 8 px slop
    expect(cb.onDrag).not.toHaveBeenCalled();
    rec.pointerMove(pt(1, 12, 1, 20));
    expect(cb.onGestureStart).toHaveBeenCalledWith('drag');
    expect(cb.onDrag).toHaveBeenLastCalledWith(12, 1, false);
    rec.pointerMove(pt(1, 20, 1, 30));
    expect(cb.onDrag).toHaveBeenLastCalledWith(8, 0, false);
    rec.pointerUp(pt(1, 20, 1, 40));
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it('pinch: factor = prevDist / curDist anchored at the midpoint', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100));
    rec.pointerDown(pt(2, 200, 100));
    expect(cb.onGestureStart).toHaveBeenCalledWith('pinch');
    rec.pointerMove(pt(2, 300, 100)); // dist 100 -> 200, mid 150 -> 200
    expect(cb.onPinch).toHaveBeenCalledTimes(1);
    const [factor, midX, midY] = cb.onPinch.mock.calls[0];
    expect(factor).toBeCloseTo(0.5);
    expect(midX).toBe(200);
    expect(midY).toBe(100);
    expect(cb.onTwoFingerPan).toHaveBeenLastCalledWith(50, 0);

    rec.pointerMove(pt(1, 200, 100)); // dist 200 -> 100: pinch in
    expect(cb.onPinch.mock.calls[1][0]).toBeCloseTo(2);
    expect(cb.onPinch.mock.calls[1][1]).toBe(250);

    rec.pointerUp(pt(1, 200, 100));
    rec.pointerMove(pt(2, 400, 100)); // remaining finger is ignored until all lift
    rec.pointerUp(pt(2, 400, 100));
    expect(cb.onDrag).not.toHaveBeenCalled();
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it('two-finger pan: parallel movement pans without zooming', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100));
    rec.pointerDown(pt(2, 200, 100));
    rec.pointerMove(pt(1, 130, 120));
    rec.pointerMove(pt(2, 230, 120));
    const total = cb.onTwoFingerPan.mock.calls.reduce(
      (acc, [dx, dy]) => [acc[0] + dx, acc[1] + dy],
      [0, 0]
    );
    expect(total).toEqual([30, 20]);
    // Only the intermediate (non-parallel) step changes the distance; the end distance is unchanged
    const product = cb.onPinch.mock.calls.reduce((acc, [f]) => acc * f, 1);
    expect(product).toBeCloseTo(1);
  });

  it('pinchZoom: false keeps two-finger pan only', () => {
    const { cb, rec } = make({ pinchZoom: false });
    rec.pointerDown(pt(1, 100, 100));
    rec.pointerDown(pt(2, 200, 100));
    rec.pointerMove(pt(2, 300, 100));
    expect(cb.onPinch).not.toHaveBeenCalled();
    expect(cb.onTwoFingerPan).toHaveBeenCalledWith(50, 0);
  });

  it('a second finger cancels the pending tap and long-press', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100, 0));
    rec.pointerDown(pt(2, 150, 100, 50));
    vi.advanceTimersByTime(1000);
    rec.pointerUp(pt(2, 150, 100, 100));
    rec.pointerUp(pt(1, 100, 100, 120));
    expect(cb.onScrubStart).not.toHaveBeenCalled();
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it('long-press (450 ms) enters scrub: moves scrub instead of dragging, release ends it', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100, 0));
    rec.pointerMove(pt(1, 103, 100, 100)); // jitter within slop keeps the timer
    vi.advanceTimersByTime(449);
    expect(cb.onScrubStart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cb.onScrubStart).toHaveBeenCalledWith(103, 100);
    expect(rec.isScrubbing).toBe(true);

    rec.pointerMove(pt(1, 180, 140, 600));
    expect(cb.onScrub).toHaveBeenLastCalledWith(180, 140);
    expect(cb.onDrag).not.toHaveBeenCalled();
    rec.pointerUp(pt(1, 180, 140, 700));
    expect(cb.onScrubEnd).toHaveBeenCalledWith(180, 140);
    expect(cb.onTap).not.toHaveBeenCalled();
  });

  it('moving past the slop before 450 ms cancels the long-press', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100, 0));
    vi.advanceTimersByTime(200);
    rec.pointerMove(pt(1, 130, 100, 200));
    vi.advanceTimersByTime(1000);
    expect(cb.onScrubStart).not.toHaveBeenCalled();
    expect(cb.onDrag).toHaveBeenCalledWith(30, 0, false);
  });

  it('longPressScrub: false turns a long still touch into a tap', () => {
    const { cb, rec } = make({ longPressScrub: false });
    rec.pointerDown(pt(1, 100, 100, 0));
    vi.advanceTimersByTime(800);
    rec.pointerUp(pt(1, 100, 100, 800));
    expect(cb.onScrubStart).not.toHaveBeenCalled();
    expect(cb.onTap).toHaveBeenCalledTimes(1);
  });

  it('double-tap: second tap within 300 ms and 32 px', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100, 0));
    rec.pointerUp(pt(1, 100, 100, 50));
    rec.pointerDown(pt(2, 110, 105, 200));
    rec.pointerUp(pt(2, 110, 105, 250));
    expect(cb.onTap).toHaveBeenCalledTimes(1);
    expect(cb.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(cb.onDoubleTap.mock.calls[0][0]).toMatchObject({ clientX: 110, clientY: 105 });

    // A third tap right after starts a new sequence (no triple = double)
    rec.pointerDown(pt(3, 110, 105, 300));
    rec.pointerUp(pt(3, 110, 105, 330));
    expect(cb.onTap).toHaveBeenCalledTimes(2);
    expect(cb.onDoubleTap).toHaveBeenCalledTimes(1);
  });

  it('taps too slow or too far apart are two single taps', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100, 0));
    rec.pointerUp(pt(1, 100, 100, 40));
    rec.pointerDown(pt(2, 100, 100, 400));
    rec.pointerUp(pt(2, 100, 100, 440)); // 400 ms gap
    rec.pointerDown(pt(3, 200, 100, 500));
    rec.pointerUp(pt(3, 200, 100, 540)); // 100 px away
    expect(cb.onTap).toHaveBeenCalledTimes(3);
    expect(cb.onDoubleTap).not.toHaveBeenCalled();
  });

  it('pointercancel drops the touch without a tap and ends a scrub', () => {
    const { cb, rec } = make();
    rec.pointerDown(pt(1, 100, 100, 0));
    expect(rec.pointerCancel(pt(1, 100, 100, 50))).toBe(true);
    expect(cb.onTap).not.toHaveBeenCalled();

    rec.pointerDown(pt(2, 50, 50, 1000));
    vi.advanceTimersByTime(450);
    rec.pointerCancel(pt(2, 50, 50, 1500));
    expect(cb.onScrubEnd).toHaveBeenCalledWith(50, 50);
    expect(rec.pointerCount).toBe(0);
  });

  it('fling: fast release keeps dragging with decaying velocity; a new touch stops it', () => {
    const frames: (() => void)[] = [];
    let now = 0;
    const cb = spies();
    const rec = new TouchGestureRecognizer(cb, {
      inertia: true,
      now: () => now,
      requestFrame: (f) => frames.push(f),
      cancelFrame: () => frames.splice(0),
    });
    rec.pointerDown(pt(1, 0, 0, 0));
    rec.pointerMove(pt(1, 20, 0, 16));
    rec.pointerMove(pt(1, 40, 0, 32));
    rec.pointerUp(pt(1, 40, 0, 32)); // 1.25 px/ms
    expect(frames).toHaveLength(1);

    const step = () => {
      now += 16;
      frames.shift()!();
    };
    step();
    const first = cb.onDrag.mock.lastCall!;
    expect(first[2]).toBe(true);
    expect(first[0]).toBeGreaterThan(0);
    step();
    expect(cb.onDrag.mock.lastCall![0]).toBeLessThan(first[0]);

    rec.pointerDown(pt(2, 0, 0, 100));
    expect(frames).toHaveLength(0);
    // The touch that caught the fling is not a tap
    rec.pointerUp(pt(2, 0, 0, 140));
    expect(cb.onTap).not.toHaveBeenCalled();
    rec.pointerDown(pt(3, 0, 0, 1000));
    rec.pointerUp(pt(3, 0, 0, 1040));
    expect(cb.onTap).toHaveBeenCalledTimes(1);
  });

  it('stopFling() cancels a running fling from outside (mouse / view change)', () => {
    const frames: (() => void)[] = [];
    const cb = spies();
    const rec = new TouchGestureRecognizer(cb, {
      inertia: true,
      now: () => 0,
      requestFrame: (f) => frames.push(f),
      cancelFrame: () => frames.splice(0),
    });
    rec.pointerDown(pt(1, 0, 0, 0));
    rec.pointerMove(pt(1, 40, 0, 16));
    rec.pointerUp(pt(1, 40, 0, 16));
    expect(frames).toHaveLength(1);
    rec.stopFling();
    expect(frames).toHaveLength(0);
  });

  it('slow release does not fling', () => {
    const frames: (() => void)[] = [];
    const cb = spies();
    const rec = new TouchGestureRecognizer(cb, { inertia: true, requestFrame: (f) => frames.push(f) });
    rec.pointerDown(pt(1, 0, 0, 0));
    rec.pointerMove(pt(1, 20, 0, 200));
    rec.pointerUp(pt(1, 20, 0, 400));
    expect(frames).toHaveLength(0);
  });
});

describe('createTouchGestures (SDK action mapping)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function actions(mode: TouchNavMode) {
    return {
      navMode: () => mode,
      canvasWidth: () => 400,
      canvasHeight: () => 200,
      toNdcX: (x: number) => (x / 400) * 2 - 1,
      toNdcY: (y: number) => 1 - (y / 200) * 2,
      panChartX: vi.fn(),
      zoomChartX: vi.fn(),
      panChartXY: vi.fn(),
      zoomChartXY: vi.fn(),
      rotateCamera: vi.fn(),
      panCamera: vi.fn(),
      zoomCamera: vi.fn(),
      showTooltipAt: vi.fn(),
      clearTooltip: vi.fn(),
      click: vi.fn(),
      doubleClick: vi.fn(),
      changed: vi.fn(),
    } satisfies TouchGestureActions;
  }

  it('line chart: pinch zooms x at the midpoint NDC, drag pans x in NDC', () => {
    const a = actions('chart');
    const rec = createTouchGestures(a, {}, { inertia: false });
    rec.pointerDown(pt(1, 100, 50));
    rec.pointerDown(pt(2, 200, 50));
    rec.pointerMove(pt(2, 300, 50));
    expect(a.zoomChartX).toHaveBeenCalledTimes(1);
    expect(a.zoomChartX.mock.calls[0][0]).toBeCloseTo(0.5);
    expect(a.zoomChartX.mock.calls[0][1]).toBeCloseTo(0); // mid x 200 of 400 px
    expect(a.panChartX).toHaveBeenLastCalledWith(0.25); // 50 px / 400 px * 2
    expect(a.clearTooltip).toHaveBeenCalled();
    rec.pointerUp(pt(1, 100, 50));
    rec.pointerUp(pt(2, 300, 50));

    rec.pointerDown(pt(3, 100, 50, 1000));
    rec.pointerMove(pt(3, 140, 90, 1010));
    expect(a.panChartX).toHaveBeenLastCalledWith(0.2);
    expect(a.rotateCamera).not.toHaveBeenCalled();
  });

  it('line chart: tap pins the tooltip and clicks; long-press scrubs; double-tap resets', () => {
    const a = actions('chart');
    const rec = createTouchGestures(a, {}, { inertia: false });
    rec.pointerDown(pt(1, 120, 60, 0));
    rec.pointerUp(pt(1, 120, 60, 40));
    expect(a.showTooltipAt).toHaveBeenCalledWith(120, 60);
    expect(a.click).toHaveBeenCalledTimes(1);

    rec.pointerDown(pt(2, 122, 60, 150));
    rec.pointerUp(pt(2, 122, 60, 190));
    expect(a.doubleClick).toHaveBeenCalledTimes(1);
    expect(a.clearTooltip).toHaveBeenCalledTimes(1); // pinned tooltip dropped on zoom reset

    rec.pointerDown(pt(3, 50, 60, 2000));
    vi.advanceTimersByTime(450);
    rec.pointerMove(pt(3, 300, 60, 2600));
    expect(a.showTooltipAt).toHaveBeenLastCalledWith(300, 60);
    expect(a.panChartX).not.toHaveBeenCalled();
  });

  it('options: tapTooltip / longPressScrub / pinchZoom false', () => {
    const a = actions('chart');
    const rec = createTouchGestures(a, { tapTooltip: false, longPressScrub: false, pinchZoom: false }, { inertia: false });
    rec.pointerDown(pt(1, 120, 60, 0));
    vi.advanceTimersByTime(600);
    rec.pointerUp(pt(1, 120, 60, 600));
    expect(a.showTooltipAt).not.toHaveBeenCalled();
    expect(a.click).toHaveBeenCalledTimes(1);

    rec.pointerDown(pt(2, 100, 50, 5000));
    rec.pointerDown(pt(3, 200, 50, 5000));
    rec.pointerMove(pt(3, 300, 50, 5010));
    expect(a.zoomChartX).not.toHaveBeenCalled();
    expect(a.panChartX).toHaveBeenCalledWith(0.25);
  });

  it('3D graph: drag orbits, pinch zooms the camera, two-finger drag pans', () => {
    const a = actions('orbit');
    const rec = createTouchGestures(a, {}, { inertia: false });
    rec.pointerDown(pt(1, 0, 0));
    rec.pointerMove(pt(1, 20, 10));
    expect(a.rotateCamera).toHaveBeenCalledWith(-20 * TOUCH_ORBIT_RAD_PER_PX, 10 * TOUCH_ORBIT_RAD_PER_PX);
    rec.pointerUp(pt(1, 20, 10));

    rec.pointerDown(pt(2, 100, 100, 1000));
    rec.pointerDown(pt(3, 200, 100, 1000));
    rec.pointerMove(pt(3, 300, 100, 1010)); // spread: zoom in = negative distance delta
    expect(a.zoomCamera).toHaveBeenCalledTimes(1);
    expect(a.zoomCamera.mock.calls[0][0]).toBeLessThan(0);
    expect(a.panCamera).toHaveBeenCalled();
    expect(a.zoomChartX).not.toHaveBeenCalled();
  });

  it('3D camera: known distance scales two-finger pan and pinch with the zoom level', () => {
    const at = (distance: number) => {
      const a = { ...actions('orbit'), cameraUnitsPerPixel: () => distance / 100, cameraDistance: () => distance };
      const rec = createTouchGestures(a, {}, { inertia: false });
      rec.pointerDown(pt(1, 100, 100));
      rec.pointerDown(pt(2, 200, 100));
      // Both fingers move 30 px right: a pure pan (no pinch)
      rec.pointerMove(pt(1, 130, 100));
      rec.pointerMove(pt(2, 230, 100));
      const pan = a.panCamera.mock.calls.reduce((sum, [r]) => sum + r, 0);
      rec.pointerMove(pt(2, 330, 100)); // spread 100 -> 200 px: zoom in
      return { pan, zoom: a.zoomCamera.mock.calls.at(-1)![0] };
    };
    const near = at(50);
    const far = at(500);
    expect(near.pan).toBeLessThan(0); // content follows the fingers: target moves opposite
    expect(far.pan / near.pan).toBeCloseTo(10);
    expect(far.zoom / near.zoom).toBeCloseTo(10);
    expect(near.zoom).toBeCloseTo(50 * (100 / 200 - 1));
  });

  it('scatter (chart-xy): drag pans both axes (finger up = +y), pinch zooms both at the midpoint', () => {
    const a = actions('chart-xy');
    const rec = createTouchGestures(a, {}, { inertia: false });
    rec.pointerDown(pt(1, 100, 100));
    rec.pointerMove(pt(1, 140, 80)); // right 40 px, up 20 px
    expect(a.panChartXY).toHaveBeenLastCalledWith(0.2, 0.2); // 40/400*2, -(-20)/200*2
    rec.pointerMove(pt(1, 140, 130)); // down 50 px
    expect(a.panChartXY).toHaveBeenLastCalledWith(0, -0.5);
    expect(a.panChartX).not.toHaveBeenCalled();
    rec.pointerUp(pt(1, 140, 130));

    rec.pointerDown(pt(2, 100, 50, 1000));
    rec.pointerDown(pt(3, 200, 50, 1000));
    rec.pointerMove(pt(3, 300, 150, 1010)); // spread + midpoint moves to (200, 100)
    expect(a.zoomChartXY).toHaveBeenCalledTimes(1);
    const [factor, ax, ay] = a.zoomChartXY.mock.calls[0];
    expect(factor).toBeCloseTo(100 / Math.hypot(200, 100));
    expect(ax).toBeCloseTo(0); // mid x 200 of 400
    expect(ay).toBeCloseTo(0); // mid y 100 of 200
    // Two-finger midpoint moved right 50, down 50 px
    expect(a.panChartXY).toHaveBeenLastCalledWith(0.25, -0.5);
    expect(a.zoomChartX).not.toHaveBeenCalled();
    rec.pointerUp(pt(2, 100, 50, 1100));
    rec.pointerUp(pt(3, 300, 150, 1100));

    // Double-tap resets the zoom: the pinned tooltip is dropped like on line charts
    a.clearTooltip.mockClear();
    rec.pointerDown(pt(4, 50, 50, 3000));
    rec.pointerUp(pt(4, 50, 50, 3020));
    rec.pointerDown(pt(5, 52, 50, 3100));
    rec.pointerUp(pt(5, 52, 50, 3120));
    expect(a.doubleClick).toHaveBeenCalledTimes(1);
    expect(a.clearTooltip).toHaveBeenCalledTimes(1);
  });

  it('flat 2D camera: one-finger drag pans instead of orbiting; none ignores navigation', () => {
    const flat = actions('flat');
    const rec = createTouchGestures(flat, {}, { inertia: false });
    rec.pointerDown(pt(1, 0, 0));
    rec.pointerMove(pt(1, 20, 0));
    expect(flat.panCamera).toHaveBeenCalled();
    expect(flat.rotateCamera).not.toHaveBeenCalled();

    const none = actions('none');
    const rec2 = createTouchGestures(none, {}, { inertia: false });
    rec2.pointerDown(pt(1, 0, 0));
    rec2.pointerMove(pt(1, 20, 0));
    expect(none.panChartX).not.toHaveBeenCalled();
    expect(none.panCamera).not.toHaveBeenCalled();
    expect(none.rotateCamera).not.toHaveBeenCalled();
  });
});
