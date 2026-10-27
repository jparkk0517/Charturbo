/** One visible-only clock. Explicit pause survives tab and viewport changes. */
export function createDemoPlayback(element: Element, tick: (deltaMs: number) => void) {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let paused = motion.matches;
  let visible = typeof IntersectionObserver === 'undefined';
  let disposed = false;
  let frame: number | undefined;
  let previous: number | undefined;
  const running = () => !disposed && !paused && visible && !document.hidden;
  const advance = (time: number) => {
    frame = undefined;
    if (!running()) return;
    const delta = previous === undefined ? 0 : Math.min(100, Math.max(0, time - previous));
    previous = time;
    tick(delta);
    reconcile();
  };
  const reconcile = () => {
    if (running()) {
      if (frame === undefined) frame = requestAnimationFrame(advance);
    } else {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = previous = undefined;
    }
  };
  const preferenceChanged = () => {
    if (motion.matches) paused = true;
    reconcile();
  };
  const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    reconcile();
  });
  observer?.observe(element);
  document.addEventListener('visibilitychange', reconcile);
  motion.addEventListener('change', preferenceChanged);
  reconcile();
  return {
    get paused() { return paused; },
    setPaused(value: boolean) { paused = value; reconcile(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      reconcile();
      observer?.disconnect();
      document.removeEventListener('visibilitychange', reconcile);
      motion.removeEventListener('change', preferenceChanged);
    },
  };
}
