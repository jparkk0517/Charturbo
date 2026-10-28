/**
 * Touch / pen gesture recognizer for `Charturbo.enableNodeInteractions`.
 *
 * Pure logic: it consumes Pointer Events (or any `{ pointerId, pointerType, clientX, clientY,
 * timeStamp }` sample) and reports semantic gestures through injected callbacks, so the SDK maps
 * them to chart / camera actions and tests can drive it with synthetic sequences.
 *
 * - 1 pointer: tap, double-tap, drag (after `tapSlop` px), long-press scrub, optional fling
 * - 2 pointers: pinch (`factor = prevDist / curDist`, anchored at the midpoint) + two-finger pan
 *
 * Mouse pointers are ignored (the SDK keeps its mouse handlers unchanged).
 */

/** Minimal pointer sample; `PointerEvent` satisfies it. */
export interface GesturePointer {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
  /** Event time in ms (`PointerEvent.timeStamp`) */
  timeStamp: number;
}

export interface TouchGestureCallbacks<P extends GesturePointer = GesturePointer> {
  /** A one-finger drag or a two-finger gesture begins (tap / long-press are no longer possible). */
  onGestureStart?: (kind: 'drag' | 'pinch') => void;
  /** One-finger drag delta in CSS px (`inertial` = fling frame after release). */
  onDrag?: (dx: number, dy: number, inertial: boolean) => void;
  /** Pinch step: `factor` = prevDist / curDist (< 1 = fingers spread = zoom in), midpoint in client px. */
  onPinch?: (factor: number, midX: number, midY: number) => void;
  /** Two-finger midpoint movement in CSS px. */
  onTwoFingerPan?: (dx: number, dy: number) => void;
  onTap?: (pointer: P) => void;
  onDoubleTap?: (pointer: P) => void;
  /** Long-press scrub (client px): start, every move (no drag is reported meanwhile), release / cancel. */
  onScrubStart?: (x: number, y: number) => void;
  onScrub?: (x: number, y: number) => void;
  onScrubEnd?: (x: number, y: number) => void;
}

export interface TouchGestureConfig {
  /** Max travel (px) for a tap; beyond it a one-finger touch becomes a drag (default 8) */
  tapSlop: number;
  /** Max gap (ms) between two taps of a double-tap (default 300) */
  doubleTapMs: number;
  /** Max distance (px) between two taps of a double-tap (default 32) */
  doubleTapSlop: number;
  /** Hold time (ms) that turns a still touch into a scrub (default 450) */
  longPressMs: number;
  /** Two fingers zoom; when false they only pan (default true) */
  pinchZoom: boolean;
  /** Long-press scrub; when false a long still touch is a tap (default true) */
  longPressScrub: boolean;
  /** Fling inertia after a one-finger drag (default true) */
  inertia: boolean;
  /** Release speed (px/ms) that starts a fling (default 0.35) */
  flingMinSpeed: number;
  /** Fling velocity multiplier per 16 ms frame (default 0.92) */
  flingDecay: number;
  /** Clock for fling frames (ms) */
  now: () => number;
  /** Frame scheduler for fling (default `requestAnimationFrame`, `setTimeout` fallback) */
  requestFrame: (cb: () => void) => unknown;
  cancelFrame: (handle: unknown) => void;
}

const hasRaf = typeof requestAnimationFrame === 'function';

export const DEFAULT_TOUCH_GESTURE_CONFIG: TouchGestureConfig = {
  tapSlop: 8,
  doubleTapMs: 300,
  doubleTapSlop: 32,
  longPressMs: 450,
  pinchZoom: true,
  longPressScrub: true,
  inertia: true,
  flingMinSpeed: 0.35,
  flingDecay: 0.92,
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  requestFrame: (cb) => (hasRaf ? requestAnimationFrame(cb) : setTimeout(cb, 16)),
  cancelFrame: (h) => (hasRaf ? cancelAnimationFrame(h as number) : clearTimeout(h as ReturnType<typeof setTimeout>)),
};

/** Pointer types the recognizer owns (mouse keeps the SDK's classic handlers). */
export const isGesturePointer = (p: { pointerType: string }): boolean =>
  p.pointerType === 'touch' || p.pointerType === 'pen';

type Phase =
  /** Nothing down */
  | 'idle'
  /** One pointer down, still within tap slop */
  | 'pending'
  | 'drag'
  | 'scrub'
  | 'pinch'
  /** A multi-finger gesture ended with fingers still down: ignore them until all lift */
  | 'settle';

interface Track<P> {
  start: P;
  x: number;
  y: number;
}

/** Recent drag samples kept for the release velocity (ms window) */
const VELOCITY_WINDOW_MS = 100;

export class TouchGestureRecognizer<P extends GesturePointer = GesturePointer> {
  readonly config: TouchGestureConfig;
  private phase: Phase = 'idle';
  private tracks = new Map<number, Track<P>>();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTap: { x: number; y: number; t: number } | null = null;
  /** Two-finger state of the previous step */
  private pinchDist = 0;
  private pinchMid: [number, number] = [0, 0];
  private samples: { x: number; y: number; t: number }[] = [];
  private flingHandle: unknown = null;
  private suppressTap = false;

  constructor(
    private readonly callbacks: TouchGestureCallbacks<P>,
    config: Partial<TouchGestureConfig> = {}
  ) {
    this.config = { ...DEFAULT_TOUCH_GESTURE_CONFIG, ...config };
  }

  /** Number of tracked touch / pen pointers. */
  get pointerCount(): number {
    return this.tracks.size;
  }

  get isScrubbing(): boolean {
    return this.phase === 'scrub';
  }

  /** Returns true when the event is a touch / pen pointer the recognizer consumed. */
  pointerDown(p: P): boolean {
    if (!isGesturePointer(p)) return false;
    // A touch that catches a running fling only stops it (no tap)
    const caughtFling = this.flingHandle !== null;
    this.stopFling();
    if (this.tracks.size >= 2) return true; // a third finger is ignored
    this.tracks.set(p.pointerId, { start: p, x: p.clientX, y: p.clientY });

    if (this.tracks.size === 1) {
      this.phase = 'pending';
      this.suppressTap = caughtFling;
      this.samples = [{ x: p.clientX, y: p.clientY, t: p.timeStamp }];
      if (this.config.longPressScrub && this.callbacks.onScrubStart) {
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          const track = this.tracks.get(p.pointerId);
          if (this.phase !== 'pending' || !track) return;
          this.phase = 'scrub';
          this.callbacks.onScrubStart?.(track.x, track.y);
        }, this.config.longPressMs);
      }
      return true;
    }

    // Second finger: a scrub ends, anything else becomes a two-finger gesture
    this.clearLongPress();
    this.lastTap = null;
    if (this.phase === 'scrub') {
      const [first] = this.tracks.values();
      this.callbacks.onScrubEnd?.(first.x, first.y);
    }
    this.phase = 'pinch';
    this.callbacks.onGestureStart?.('pinch');
    [this.pinchDist, this.pinchMid] = this.twoFingerState();
    return true;
  }

  pointerMove(p: P): boolean {
    const track = this.tracks.get(p.pointerId);
    if (!track) return false;
    const dx = p.clientX - track.x;
    const dy = p.clientY - track.y;
    track.x = p.clientX;
    track.y = p.clientY;

    switch (this.phase) {
      case 'pending': {
        const travel = Math.hypot(p.clientX - track.start.clientX, p.clientY - track.start.clientY);
        if (travel <= this.config.tapSlop) break;
        this.clearLongPress();
        this.phase = 'drag';
        this.callbacks.onGestureStart?.('drag');
        // Apply the travel since touch-down so the content stays under the finger
        this.callbacks.onDrag?.(p.clientX - track.start.clientX, p.clientY - track.start.clientY, false);
        this.pushSample(p);
        break;
      }
      case 'drag':
        this.callbacks.onDrag?.(dx, dy, false);
        this.pushSample(p);
        break;
      case 'scrub':
        this.callbacks.onScrub?.(p.clientX, p.clientY);
        break;
      case 'pinch': {
        const [dist, mid] = this.twoFingerState();
        if (this.config.pinchZoom && this.pinchDist > 0 && dist > 0) {
          const factor = this.pinchDist / dist;
          if (factor !== 1) this.callbacks.onPinch?.(factor, mid[0], mid[1]);
        }
        const mdx = mid[0] - this.pinchMid[0];
        const mdy = mid[1] - this.pinchMid[1];
        if (mdx !== 0 || mdy !== 0) this.callbacks.onTwoFingerPan?.(mdx, mdy);
        this.pinchDist = dist;
        this.pinchMid = mid;
        break;
      }
    }
    return true;
  }

  /** Untracked touch / pen ups (e.g. an ignored third finger) are still consumed. */
  pointerUp(p: P): boolean {
    if (!this.tracks.delete(p.pointerId)) return isGesturePointer(p);
    this.clearLongPress();

    if (this.phase === 'pinch') {
      this.phase = this.tracks.size > 0 ? 'settle' : 'idle';
      return true;
    }
    if (this.tracks.size > 0) return true;

    const phase = this.phase;
    this.phase = 'idle';
    if (phase === 'scrub') {
      this.callbacks.onScrubEnd?.(p.clientX, p.clientY);
    } else if (phase === 'drag') {
      this.pushSample(p);
      this.maybeFling();
    } else if (phase === 'pending' && !this.suppressTap) {
      this.tap(p);
    }
    return true;
  }

  /** `pointercancel`: drops the pointer without a tap or fling. */
  pointerCancel(p: P): boolean {
    const track = this.tracks.get(p.pointerId);
    if (!track) return isGesturePointer(p);
    this.tracks.delete(p.pointerId);
    this.clearLongPress();
    if (this.phase === 'scrub') this.callbacks.onScrubEnd?.(track.x, track.y);
    this.phase = this.tracks.size > 0 ? 'settle' : 'idle';
    return true;
  }

  /** Clears timers / fling and forgets every pointer. */
  reset(): void {
    this.clearLongPress();
    this.stopFling();
    this.tracks.clear();
    this.phase = 'idle';
    this.lastTap = null;
  }

  private tap(p: P): void {
    const prev = this.lastTap;
    const isDouble =
      prev !== null &&
      p.timeStamp - prev.t <= this.config.doubleTapMs &&
      Math.hypot(p.clientX - prev.x, p.clientY - prev.y) <= this.config.doubleTapSlop;
    if (isDouble) {
      this.lastTap = null;
      this.callbacks.onDoubleTap?.(p);
    } else {
      this.lastTap = { x: p.clientX, y: p.clientY, t: p.timeStamp };
      this.callbacks.onTap?.(p);
    }
  }

  /** Distance and midpoint of the two tracked pointers. */
  private twoFingerState(): [number, [number, number]] {
    const [a, b] = [...this.tracks.values()];
    if (!a || !b) return [0, this.pinchMid];
    return [Math.hypot(a.x - b.x, a.y - b.y), [(a.x + b.x) / 2, (a.y + b.y) / 2]];
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) clearTimeout(this.longPressTimer);
    this.longPressTimer = null;
  }

  private pushSample(p: P): void {
    this.samples.push({ x: p.clientX, y: p.clientY, t: p.timeStamp });
    const cutoff = p.timeStamp - VELOCITY_WINDOW_MS;
    while (this.samples.length > 2 && this.samples[0].t < cutoff) this.samples.shift();
  }

  private maybeFling(): void {
    if (!this.config.inertia || !this.callbacks.onDrag || this.samples.length < 2) return;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = last.t - first.t;
    if (dt <= 0) return;
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    if (Math.hypot(vx, vy) < this.config.flingMinSpeed) return;

    let prevT = this.config.now();
    const step = () => {
      const t = this.config.now();
      const frameMs = Math.min(64, Math.max(1, t - prevT));
      prevT = t;
      const decay = Math.pow(this.config.flingDecay, frameMs / 16);
      vx *= decay;
      vy *= decay;
      if (Math.hypot(vx, vy) < 0.02) {
        this.flingHandle = null;
        return;
      }
      this.callbacks.onDrag?.(vx * frameMs, vy * frameMs, true);
      this.flingHandle = this.config.requestFrame(step);
    };
    this.flingHandle = this.config.requestFrame(step);
  }

  /** Stops a running fling (e.g. the view was replaced or the mouse took over). */
  stopFling(): void {
    if (this.flingHandle !== null) this.config.cancelFrame(this.flingHandle);
    this.flingHandle = null;
  }
}

// ---------------------------------------------------------------------------
// SDK binding: gesture -> chart / camera action mapping
// ---------------------------------------------------------------------------

export interface TouchInteractionOptions {
  /** Two-finger pinch zooms the chart x axis (both axes on scatter) / camera (default: true) */
  pinchZoom?: boolean;
  /** One-finger tap shows the tooltip at that point until the next tap (default: true) */
  tapTooltip?: boolean;
  /** Long-press (~450 ms) enters scrub mode: the tooltip follows the finger without panning (default: true) */
  longPressScrub?: boolean;
}

/**
 * What drags / pinches drive: `'chart'` = line chart x axis, `'chart-xy'` = both chart axes
 * (scatter), `'orbit'` = 3D camera, `'flat'` = 2D camera (pan instead of orbit), `'none'` = ignored.
 */
export type TouchNavMode = 'chart' | 'chart-xy' | 'orbit' | 'flat' | 'none';

/** Hooks the SDK injects; keeps this module free of engine / DOM specifics. */
export interface TouchGestureActions<P extends GesturePointer = GesturePointer> {
  navMode: () => TouchNavMode;
  /** Canvas width in CSS px (drag px -> NDC) */
  canvasWidth: () => number;
  /** Canvas height in CSS px (drag px -> NDC, `'chart-xy'`) */
  canvasHeight: () => number;
  /** Client x -> canvas NDC x (-1..1) */
  toNdcX: (clientX: number) => number;
  /** Client y -> canvas NDC y (-1..1, +1 = top) */
  toNdcY: (clientY: number) => number;
  panChartX: (deltaNdcX: number) => void;
  zoomChartX: (factor: number, anchorNdcX: number) => void;
  /** `'chart-xy'`: NDC deltas (+y = up) */
  panChartXY: (deltaNdcX: number, deltaNdcY: number) => void;
  zoomChartXY: (factor: number, anchorNdcX: number, anchorNdcY: number) => void;
  rotateCamera: (deltaYaw: number, deltaPitch: number) => void;
  panCamera: (deltaRight: number, deltaUp: number) => void;
  zoomCamera: (delta: number) => void;
  /**
   * World units per CSS pixel at the target depth (`null` / absent = unknown: fixed gain), so a
   * camera pan keeps the content under the fingers at any zoom
   */
  cameraUnitsPerPixel?: () => number | null;
  /** Current target distance (`null` / absent = unknown: additive pinch zoom) */
  cameraDistance?: () => number | null;
  /** Hit-test + tooltip at a client point (placed above the finger) */
  showTooltipAt: (clientX: number, clientY: number) => void;
  /** Drag / pinch started: drop the pinned tooltip and hover overlay */
  clearTooltip: () => void;
  /** Click / double-click semantics of the mouse path */
  click: (pointer: P) => void;
  doubleClick: (pointer: P) => void;
  /** Called after every view / tooltip change (e.g. autoRender) */
  changed: () => void;
}

/** Same gains as the showcase mouse controls (rad / px; world units / px when the camera distance is unknown). */
export const TOUCH_ORBIT_RAD_PER_PX = 0.006;
export const TOUCH_PAN_UNITS_PER_PX = 0.18;
/** Camera distance change per unit of ln(pinch factor) (the engine zoom is additive). */
export const TOUCH_PINCH_CAMERA_SCALE = 160;

/** Builds a recognizer whose gestures drive the SDK through `actions`. */
export function createTouchGestures<P extends GesturePointer>(
  actions: TouchGestureActions<P>,
  options: TouchInteractionOptions = {},
  config: Partial<TouchGestureConfig> = {}
): TouchGestureRecognizer<P> {
  const tapTooltip = options.tapTooltip ?? true;
  const scrub = options.longPressScrub ?? true;
  const pxToNdc = (dx: number) => (dx / Math.max(1, actions.canvasWidth())) * 2;
  const pxToNdcY = (dy: number) => (dy / Math.max(1, actions.canvasHeight())) * 2;
  const isChart = (mode: TouchNavMode) => mode === 'chart' || mode === 'chart-xy';

  const pan = (dx: number, dy: number) => {
    const mode = actions.navMode();
    if (mode === 'chart') actions.panChartX(pxToNdc(dx));
    // Screen y grows downward, NDC y upward: a finger moving up pans by +y
    else if (mode === 'chart-xy') actions.panChartXY(pxToNdc(dx), -pxToNdcY(dy));
    else if (mode !== 'none') {
      const k = actions.cameraUnitsPerPixel?.() ?? TOUCH_PAN_UNITS_PER_PX;
      actions.panCamera(-dx * k, dy * k);
    }
    if (mode !== 'none') actions.changed();
  };
  const scrubTo = (x: number, y: number) => {
    actions.showTooltipAt(x, y);
    actions.changed();
  };

  return new TouchGestureRecognizer<P>(
    {
      onGestureStart: () => {
        actions.clearTooltip();
        actions.changed();
      },
      onDrag: (dx, dy) => {
        // One finger orbits a 3D view; charts / flat views follow the finger
        if (actions.navMode() === 'orbit') {
          actions.rotateCamera(-dx * TOUCH_ORBIT_RAD_PER_PX, dy * TOUCH_ORBIT_RAD_PER_PX);
          actions.changed();
        } else {
          pan(dx, dy);
        }
      },
      onPinch: (factor, midX, midY) => {
        const mode = actions.navMode();
        if (mode === 'none') return;
        if (mode === 'chart') actions.zoomChartX(factor, actions.toNdcX(midX));
        else if (mode === 'chart-xy') actions.zoomChartXY(factor, actions.toNdcX(midX), actions.toNdcY(midY));
        else {
          // Known distance: the pinch scales it (constant feel at any zoom), like the wheel
          const d = actions.cameraDistance?.() ?? null;
          actions.zoomCamera(d !== null && d > 0 ? d * (factor - 1) : Math.log(factor) * TOUCH_PINCH_CAMERA_SCALE);
        }
        actions.changed();
      },
      onTwoFingerPan: pan,
      onTap: (p) => {
        if (tapTooltip) actions.showTooltipAt(p.clientX, p.clientY);
        actions.click(p);
        actions.changed();
      },
      onDoubleTap: (p) => {
        // The first tap pinned a tooltip at a data point the zoom reset moves away
        if (isChart(actions.navMode())) actions.clearTooltip();
        actions.doubleClick(p);
        actions.changed();
      },
      ...(scrub ? { onScrubStart: scrubTo, onScrub: scrubTo } : {}),
    },
    { pinchZoom: options.pinchZoom ?? true, longPressScrub: scrub, ...config }
  );
}
