/**
 * Pointer binding of the native range selector (navigator) strip of 2D line / area charts.
 *
 * The engine draws the strip, hit-tests it and moves / resizes the zoom window
 * (`chart_navigator_*`); this only routes pointer events: a press on the strip grabs the region
 * under it (window, handle, or outside = center the window there, then drag it), moves forward
 * NDC deltas, the wheel over the strip zooms around the pointer, and the cursor follows the
 * region. Works for mouse, touch and pen (it runs before the touch gesture layer).
 */

/** `chart_navigator_hit` region codes. */
export const NAV_NONE = 0;
export const NAV_WINDOW = 1;
export const NAV_LEFT_HANDLE = 2;
export const NAV_RIGHT_HANDLE = 3;
export const NAV_OUTSIDE = 4;

/** Default strip height in CSS px (matches the engine). */
export const DEFAULT_NAVIGATOR_HEIGHT = 48;

/** `LineChartOptions.navigator`. */
export type NavigatorOption = boolean | { height?: number };

/** Resolved navigator option (`null` = off). */
export function resolveNavigator(opt: NavigatorOption | undefined): { height: number } | null {
  if (!opt) return null;
  const h = typeof opt === 'object' ? opt.height : undefined;
  return { height: h !== undefined && Number.isFinite(h) && h > 0 ? h : DEFAULT_NAVIGATOR_HEIGHT };
}

/** Cursor of a hovered / grabbed region. */
export function navigatorCursor(code: number, dragging = false): string {
  switch (code) {
    case NAV_LEFT_HANDLE:
    case NAV_RIGHT_HANDLE:
      return 'ew-resize';
    case NAV_WINDOW:
      return dragging ? 'grabbing' : 'grab';
    case NAV_OUTSIDE:
      return dragging ? 'grabbing' : 'pointer';
    default:
      return '';
  }
}

/** Minimal pointer sample; `PointerEvent` satisfies it. */
export interface NavigatorPointer {
  pointerId: number;
  clientX: number;
  clientY: number;
  button?: number;
  /** Pressed buttons; a move with 0 ends a drag whose release was lost */
  buttons?: number;
}

export interface NavigatorHooks {
  /** A navigator is shown and chart navigation is on */
  active(): boolean;
  toNdc(p: { clientX: number; clientY: number }): [number, number];
  /** Canvas width in CSS px (client px -> NDC deltas) */
  canvasWidth(): number;
  hit(ndcX: number, ndcY: number): number;
  /** Wrappers of the engine calls that report `'rangechange'` */
  drag(code: number, deltaNdcX: number): void;
  center(ndcX: number): void;
  zoom(factor: number, ndcX: number): void;
  setCursor(cursor: string): void;
  /** The navigator released the cursor (pointer left the strip): restore the default one */
  restoreCursor(): void;
  /** Something moved: redraw (auto render) */
  changed(): void;
  /** Optional: keep receiving moves outside the canvas while dragging */
  capture?(pointerId: number): void;
}

export interface NavigatorController {
  /** Pointer down: true when it grabbed the navigator (callers skip their own handling). */
  pointerDown(e: NavigatorPointer): boolean;
  /** Pointer move: true while dragging, or when hovering the strip (cursor set). */
  pointerMove(e: NavigatorPointer): boolean;
  pointerUp(e: NavigatorPointer): boolean;
  /** The pointer is over the strip (e.g. double-click there must not reset the zoom). */
  over(e: { clientX: number; clientY: number }): boolean;
  /** Wheel: true when it zoomed (pointer over the strip). */
  wheel(e: { clientX: number; clientY: number; deltaY: number }): boolean;
  /** A drag is in progress */
  dragging(): boolean;
  reset(): void;
}

export function createNavigatorController(h: NavigatorHooks): NavigatorController {
  let drag: { id: number; code: number; lastX: number } | null = null;
  /** The cursor currently shows a navigator region */
  let cursorOwned = false;

  const setCursor = (code: number, dragging: boolean) => {
    const c = navigatorCursor(code, dragging);
    if (c) {
      h.setCursor(c);
      cursorOwned = true;
    } else if (cursorOwned) {
      cursorOwned = false;
      h.restoreCursor();
    }
  };

  return {
    pointerDown(e) {
      if (drag || (e.button !== undefined && e.button !== 0) || !h.active()) return false;
      const [x, y] = h.toNdc(e);
      let code = h.hit(x, y);
      if (code === NAV_NONE) return false;
      if (code === NAV_OUTSIDE) {
        // Click outside: jump the window there, then the drag carries it
        h.center(x);
        code = NAV_WINDOW;
        h.changed();
      }
      drag = { id: e.pointerId, code, lastX: e.clientX };
      h.capture?.(e.pointerId);
      setCursor(code, true);
      return true;
    },
    pointerMove(e) {
      if (drag && e.pointerId === drag.id && e.buttons === 0) {
        // Release missed (window blur, lost capture): end the drag, treat as hover
        drag = null;
      }
      if (drag) {
        if (e.pointerId !== drag.id) return false;
        const dx = ((e.clientX - drag.lastX) / Math.max(1, h.canvasWidth())) * 2;
        drag.lastX = e.clientX;
        if (dx !== 0) {
          h.drag(drag.code, dx);
          h.changed();
        }
        return true;
      }
      if (!h.active()) {
        setCursor(NAV_NONE, false);
        return false;
      }
      const [x, y] = h.toNdc(e);
      const code = h.hit(x, y);
      setCursor(code, false);
      return code !== NAV_NONE;
    },
    pointerUp(e) {
      if (!drag || e.pointerId !== drag.id) return false;
      const code = drag.code;
      drag = null;
      setCursor(code, false);
      return true;
    },
    over(e) {
      if (!h.active()) return false;
      const [x, y] = h.toNdc(e);
      return h.hit(x, y) !== NAV_NONE;
    },
    wheel(e) {
      if (!h.active()) return false;
      const [x, y] = h.toNdc(e);
      if (h.hit(x, y) === NAV_NONE) return false;
      h.zoom(Math.exp(e.deltaY * 0.0015), x);
      h.changed();
      return true;
    },
    dragging: () => drag !== null,
    reset() {
      drag = null;
      if (cursorOwned) {
        cursorOwned = false;
        h.restoreCursor();
      }
    },
  };
}
