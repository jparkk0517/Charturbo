/**
 * y-axis zoom, box zoom and zoom history of 2D charts (`enableNodeInteractions({ zoom,
 * zoomMode })`). The engine owns the math (chart/zoom.rs): y windows in data units (a manual y
 * zoom pins the line y domain until reset), NDC box -> data ranges, and the undo / redo stack
 * (at most 50 steps). This controller only maps pointer / wheel / key events to engine calls:
 *
 * - wheel zooms x (default `zoom: 'x'`), y (`'y'`, or Shift + wheel), or both (`'xy'`)
 * - box zoom: `zoomMode: 'box'` drag, or Ctrl / Cmd + drag in pan mode, draws the rectangle with
 *   the brush layer and zooms x + y to it on release (Escape cancels)
 * - Ctrl / Cmd + Z undoes, Ctrl / Cmd + Shift + Z or Ctrl + Y redoes (canvas focused)
 * - every mouse gesture (wheel burst, drag pan, box) records one history step first (touch
 *   gestures do not)
 *
 * DOM-free: runs under the test runner as-is.
 */

/** Axes the mouse wheel zooms. */
export type ChartZoomAxis = 'x' | 'y' | 'xy';
/** What a plain drag does on a navigable chart: pan (default) or box zoom. */
export type ChartZoomMode = 'pan' | 'box';

/** Zoom history depth (`zoomHistory`). */
export interface ZoomHistoryState {
  /** Steps `undoZoom()` can go back */
  undo: number;
  /** Steps `redoZoom()` can go forward */
  redo: number;
  /** Steps kept at most */
  max: number;
}

export const ZOOM_HISTORY_MAX = 50;
/** Wheel events closer than this belong to one gesture (one history step). */
export const WHEEL_BURST_MS = 400;
/** A box smaller than this (CSS px) on either side is a click, not a zoom. */
export const MIN_BOX_PX = 4;

export interface ZoomBackend {
  chart_zoom_x?(factor: number, anchorNdcX: number): void;
  chart_zoom_y?(factor: number, anchorNdcY: number): boolean;
  chart_zoom_box?(ax: number, ay: number, bx: number, by: number): boolean;
  chart_zoom_history_push?(): void;
  /** Drops trailing undo steps equal to the current zoom (gesture that did not move it) */
  chart_zoom_history_trim?(): void;
  chart_zoom_undo?(): boolean;
  chart_zoom_redo?(): boolean;
  chart_zoom_history?(): Uint32Array | number[];
  chart_zoom_history_clear?(): void;
  /** Live rectangle (brush layer): mode 1 = xy */
  chart_brush?(mode: number, ax: number, ay: number, bx: number, by: number): boolean;
  chart_clear_selection?(): void;
  chart_clear_hover?(): void;
}

export function validateZoomAxis(v: unknown): ChartZoomAxis {
  if (v === undefined) return 'x';
  if (v === 'x' || v === 'y' || v === 'xy') return v;
  throw new Error(`zoom: expected 'x' | 'y' | 'xy' (got ${String(v)})`);
}

export function validateZoomMode(v: unknown): ChartZoomMode {
  if (v === undefined) return 'pan';
  if (v === 'pan' || v === 'box') return v;
  throw new Error(`zoomMode: expected 'pan' | 'box' (got ${String(v)})`);
}

/** Wheel axes of an event: Shift forces y (browsers may turn Shift + wheel into deltaX). */
export function wheelAxes(axis: ChartZoomAxis, e: { shiftKey?: boolean }): { x: boolean; y: boolean } {
  if (e.shiftKey) return { x: false, y: true };
  return { x: axis !== 'y', y: axis !== 'x' };
}

/** Wheel delta in px (vertical, or horizontal when Shift turned it sideways). */
export function wheelDelta(e: { deltaY: number; deltaX?: number }): number {
  return e.deltaY !== 0 ? e.deltaY : (e.deltaX ?? 0);
}

export function readHistory(backend: ZoomBackend): ZoomHistoryState {
  const h = backend.chart_zoom_history?.();
  return { undo: h?.[0] ?? 0, redo: h?.[1] ?? 0, max: ZOOM_HISTORY_MAX };
}

/** Undo / redo shortcut of a key event (`null` = none). */
export function zoomShortcut(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean }): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (k === 'y' && !e.shiftKey) return 'redo';
  return null;
}

export interface ZoomControllerHost {
  backend: ZoomBackend;
  axis: ChartZoomAxis;
  mode: ChartZoomMode;
  /** Chart wheel / drag navigation is active (2D line / area / scatter / candles) */
  navigating(): boolean;
  /** Box zoom is possible on the current chart (2D chart with a data frame) */
  boxable(): boolean;
  /** The y axis can zoom (line / area / scatter); else y wheels stay with the caller */
  yZoomable(): boolean;
  toNdc(e: { clientX: number; clientY: number }): [number, number];
  /** Runs a range change (`'rangechange'` bookkeeping) */
  changeRange(apply: () => void): void;
  setCursor?(cursor: string): void;
  /** Something visible changed (auto-render) */
  changed(): void;
  /** Applies the brush look before drawing the live box */
  prepareBox?(): void;
  clock?(): number;
}

export interface ZoomController {
  /** Wheel event: true when handled here (y / xy zoom); x-only wheels stay with the caller */
  wheel(e: { deltaY: number; deltaX?: number; shiftKey?: boolean; clientX: number; clientY: number }): boolean;
  /** Before the caller's own wheel x zoom: records the history step of a new wheel burst */
  wheelStep(): void;
  /** Primary button down: true when a box zoom starts (the caller skips pan / brush) */
  pointerDown(e: { button: number; clientX: number; clientY: number; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean;
  /** Drag move: true when it belongs to a box zoom */
  pointerMove(e: { clientX: number; clientY: number }): boolean;
  /** Release: true when it ended a box zoom (zoomed, or cancelled as a click) */
  /** `true` = the box press was handled (zoomed), `'click'` = too small to zoom: treat as a click, `false` = no box */
  pointerUp(e: { clientX: number; clientY: number }): boolean | 'click';
  /** A drag pan starts moving: records one history step */
  panStart(): void;
  /** Ctrl / Cmd + Z / Y: true when handled */
  keyDown(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean; preventDefault?(): void }): boolean;
  /** Escape: drops a live box; true when there was one */
  cancel(): boolean;
  boxing(): boolean;
  reset(): void;
}

export function createZoomController(host: ZoomControllerHost): ZoomController {
  const clock = host.clock ?? (() => Date.now());
  let lastWheel = -Infinity;
  let box: { from: [number, number]; x: number; y: number; live: boolean } | null = null;

  const push = () => host.backend.chart_zoom_history_push?.();
  const wheelStep = () => {
    const t = clock();
    if (t - lastWheel > WHEEL_BURST_MS) push();
    lastWheel = t;
  };

  return {
    wheel(e) {
      if (!host.navigating()) return false;
      const axes = wheelAxes(host.axis, e);
      if (!axes.y || !host.yZoomable()) return false;
      wheelStep();
      const [nx, ny] = host.toNdc(e);
      const factor = Math.exp(wheelDelta(e) * 0.0015);
      let moved = false;
      host.changeRange(() => {
        moved = host.backend.chart_zoom_y?.(factor, ny) ?? false;
        // 'xy': both axes in one range change
        if (axes.x) host.backend.chart_zoom_x?.(factor, nx);
      });
      // At the zoom limit: no undo step for a gesture that moved nothing
      if (!moved && !axes.x) host.backend.chart_zoom_history_trim?.();
      host.changed();
      return true;
    },
    wheelStep,
    pointerDown(e) {
      if (e.button !== 0 || !host.navigating() || !host.boxable()) return false;
      const modifier = !!(e.ctrlKey || e.metaKey);
      const wants = host.mode === 'box' ? !e.altKey : modifier;
      if (!wants) return false;
      box = { from: host.toNdc(e), x: e.clientX, y: e.clientY, live: false };
      return true;
    },
    pointerMove(e) {
      if (!box) return false;
      if (!box.live && Math.max(Math.abs(e.clientX - box.x), Math.abs(e.clientY - box.y)) < MIN_BOX_PX) return true;
      if (!box.live) {
        host.prepareBox?.();
        host.backend.chart_clear_hover?.();
        host.setCursor?.('crosshair');
      }
      const [x, y] = host.toNdc(e);
      box.live = host.backend.chart_brush?.(1, box.from[0], box.from[1], x, y) ?? false;
      host.changed();
      return true;
    },
    pointerUp(e) {
      if (!box) return false;
      const b = box;
      box = null;
      const big = Math.abs(e.clientX - b.x) >= MIN_BOX_PX && Math.abs(e.clientY - b.y) >= MIN_BOX_PX;
      if (b.live || big) {
        const [x, y] = host.toNdc(e);
        push();
        let moved = false;
        host.changeRange(() => (moved = host.backend.chart_zoom_box?.(b.from[0], b.from[1], x, y) ?? false));
        if (!moved) host.backend.chart_zoom_history_trim?.();
        // A box too thin to zoom still leaves no rectangle behind
        host.backend.chart_clear_selection?.();
        host.changed();
        return true;
      }
      return 'click';
    },
    panStart: push,
    keyDown(e) {
      const action = zoomShortcut(e);
      if (!action) return false;
      e.preventDefault?.();
      host.changeRange(() => (action === 'undo' ? host.backend.chart_zoom_undo?.() : host.backend.chart_zoom_redo?.()));
      host.changed();
      return true;
    },
    cancel() {
      if (!box) return false;
      const live = box.live;
      box = null;
      if (live) {
        host.backend.chart_clear_selection?.();
        host.changed();
      }
      return true;
    },
    boxing: () => box !== null,
    reset() {
      box = null;
      lastWheel = -Infinity;
    },
  };
}
