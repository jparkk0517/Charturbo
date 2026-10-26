/**
 * Built-in mouse camera controls of graph / point-cloud / scene views (`enableNodeInteractions`
 * `cameraControls`): left drag orbits the camera around its target, Shift + left / right /
 * middle drag pans the target in the view plane (left drag pans when `orbit: false`), the wheel
 * dollies toward / away from the target. The engine owns the camera (rotate / pan / zoom); this
 * controller only maps mouse events to those calls. Touch / pen stay with chart-gestures.ts
 * (the SDK applies the same `orbit` / `pan` / `zoom` switches to its camera actions). Charts are
 * not affected: their wheel / drag navigate the data. DOM-free: runs under the test runner as-is.
 */
import { TOUCH_ORBIT_RAD_PER_PX, TOUCH_PAN_UNITS_PER_PX } from './chart-gestures';

export interface CameraControlOptions {
  /** Left drag orbits the camera around its target (default: true; off: left drag pans) */
  orbit?: boolean;
  /** Shift + left / right / middle drag pans the target in the view plane (default: true) */
  pan?: boolean;
  /** Wheel dollies toward / away from the target (default: true) */
  zoom?: boolean;
}

/** Orbit gain (rad / px), same as touch. */
export const MOUSE_ORBIT_RAD_PER_PX = TOUCH_ORBIT_RAD_PER_PX;
/** Pan gain (world units / px) when the engine does not report the camera distance. */
export const MOUSE_PAN_UNITS_PER_PX = TOUCH_PAN_UNITS_PER_PX;
/** Additive dolly (world units) per wheel pixel when the camera distance is unknown. */
export const WHEEL_ZOOM_UNITS_PER_PX = 0.18;
/** Distance factor per wheel pixel: `distance * exp(deltaY * k)` (one 100 px notch ≈ ×1.16). */
export const WHEEL_ZOOM_RATE = 0.0015;
/** Press-to-move distance (px) before a drag moves the camera; a release after that is never a click. */
export const CAMERA_DRAG_SLOP_PX = 3;

/** Resolved switches (`false` = all off). */
export interface ResolvedCameraControls {
  orbit: boolean;
  pan: boolean;
  zoom: boolean;
}

export function resolveCameraControls(input: false | CameraControlOptions | undefined): ResolvedCameraControls {
  if (input === false) return { orbit: false, pan: false, zoom: false };
  return { orbit: input?.orbit ?? true, pan: input?.pan ?? true, zoom: input?.zoom ?? true };
}

/** Hooks the SDK injects. */
export interface CameraControlsHost {
  options: ResolvedCameraControls;
  /** Mouse camera controls apply now (a graph / 3D view: no chart shown) */
  active(): boolean;
  rotate(deltaYaw: number, deltaPitch: number): void;
  pan(deltaRight: number, deltaUp: number): void;
  zoom(delta: number): void;
  /**
   * World units per CSS pixel at the target depth (`null` = unknown: fixed gains), so a pan keeps
   * the content under the pointer and the wheel zooms by a constant factor
   */
  unitsPerPixel(): number | null;
  /** Current target distance (`null` = unknown) */
  distance(): number | null;
  /** Viewport height in CSS px (wheel page units) */
  viewHeight(): number;
  capture(pointerId: number): void;
  setCursor(cursor: string): void;
  /** Something visible changed (auto-render) */
  changed(): void;
}

type DragMode = 'orbit' | 'pan';

export interface CameraControls {
  /** Mouse press: true when it may start a camera drag (the caller still treats a small move as a click) */
  pointerDown(e: { button: number; pointerId: number; pointerType?: string; shiftKey?: boolean; clientX: number; clientY: number }): boolean;
  /** Mouse move with buttons held: true when it belongs to a camera drag (moved or within the slop) */
  pointerMove(e: { buttons: number; pointerType?: string; clientX: number; clientY: number }): boolean;
  /** Release / capture lost / cancel: ends the drag */
  pointerUp(): void;
  /** Wheel: true when it zoomed the camera (the caller prevents page scroll) */
  wheel(e: { deltaY: number; deltaX?: number; deltaMode?: number }): boolean;
  /** Right-button drags pan: true when the context menu should be suppressed */
  wantsContextMenuBlocked(): boolean;
  dragging(): boolean;
  reset(): void;
}

export function createCameraControls(host: CameraControlsHost): CameraControls {
  const o = host.options;
  let drag: { mode: DragMode; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;

  const end = () => {
    if (drag?.moved) host.setCursor('grab');
    drag = null;
  };

  return {
    pointerDown(e) {
      drag = null;
      if ((e.pointerType ?? 'mouse') !== 'mouse' || !host.active()) return false;
      // Left = orbit (pan with Shift, or when orbit is off); middle / right = pan
      const mode: DragMode | null =
        e.button === 0 ? (e.shiftKey || !o.orbit ? (o.pan ? 'pan' : null) : 'orbit') : e.button === 1 || e.button === 2 ? (o.pan ? 'pan' : null) : null;
      if (!mode) return false;
      drag = { mode, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false };
      // The release lands on the canvas even outside it
      host.capture(e.pointerId);
      return true;
    },
    pointerMove(e) {
      if (!drag) return false;
      // Released outside without capture (or capture refused): the drag is over
      if (e.buttons === 0 || (e.pointerType ?? 'mouse') !== 'mouse') {
        end();
        return false;
      }
      if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) <= CAMERA_DRAG_SLOP_PX) return true;
      if (!drag.moved) host.setCursor('grabbing');
      drag.moved = true;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;
      if (drag.mode === 'orbit') {
        host.rotate(-dx * MOUSE_ORBIT_RAD_PER_PX, dy * MOUSE_ORBIT_RAD_PER_PX);
      } else {
        // Content follows the pointer: the target moves opposite to the drag
        const k = host.unitsPerPixel() ?? MOUSE_PAN_UNITS_PER_PX;
        host.pan(-dx * k, dy * k);
      }
      host.changed();
      return true;
    },
    pointerUp: end,
    wheel(e) {
      if (!o.zoom || !host.active()) return false;
      const raw = e.deltaY !== 0 ? e.deltaY : (e.deltaX ?? 0);
      if (raw === 0) return true;
      // Line / page wheels (Firefox, some mice): normalize to pixels
      const px = e.deltaMode === 1 ? raw * 16 : e.deltaMode === 2 ? raw * Math.max(1, host.viewHeight()) : raw;
      const d = host.distance();
      host.zoom(d !== null && d > 0 ? d * (Math.exp(px * WHEEL_ZOOM_RATE) - 1) : px * WHEEL_ZOOM_UNITS_PER_PX);
      host.changed();
      return true;
    },
    wantsContextMenuBlocked() {
      return o.pan && host.active();
    },
    dragging() {
      return drag?.moved ?? false;
    },
    reset() {
      drag = null;
    },
  };
}
