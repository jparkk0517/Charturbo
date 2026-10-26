// Axis label layout helpers (DOM only: label sizes are known after layout).

/** Gap kept between neighbouring x axis labels (CSS px). */
export const X_LABEL_GAP_PX = 8;

/**
 * Lays out centred axis labels: labels overhanging `bounds` (the overlay box, CSS px) slide
 * inward so the first / last tick label is never clipped (or are dropped when the slide makes
 * them collide), then labels that would overlap (long numbers, wide locale dates) are hidden,
 * keeping every k-th label for the smallest k without collisions. The kept set is anchored on tick values (`round(value / step) % k`), not list
 * positions, so it does not flicker while panning; works for reversed axes (x descending). One
 * batched width read per axes update.
 */
export function thinCenteredLabels(
  labels: { el: HTMLElement; x: number; value: number }[],
  bounds?: [number, number]
): void {
  if (labels.length === 0) return;
  const widths = labels.map((l) => l.el.getBoundingClientRect?.().width ?? 0);
  // No layout (detached / hidden root): leave every label as placed
  if (!widths.every(Number.isFinite) || widths.every((w) => w === 0)) return;
  // Centre after sliding inside the bounds (a label wider than the box stays centred)
  const cx = labels.map((l, i) => {
    if (!bounds) return l.x;
    const half = widths[i] / 2;
    const [lo, hi] = bounds;
    return hi - lo < widths[i] ? l.x : Math.min(Math.max(l.x, lo + half), hi - half);
  });
  labels.forEach((l, i) => {
    const dx = cx[i] - l.x;
    l.el.style.transform = dx === 0 ? 'translate(-50%, 0)' : `translate(calc(-50% + ${dx}px), 0)`;
  });
  if (labels.length < 2) return;
  const diffs = labels
    .slice(1)
    .map((l, i) => Math.abs(l.value - labels[i].value))
    .sort((a, b) => a - b);
  const step = diffs[diffs.length >> 1];
  const slot = (i: number) => (step > 0 ? Math.round(labels[i].value / step) : i);
  const kept = (k: number) => labels.map((_, i) => i).filter((i) => ((slot(i) % k) + k) % k === 0);
  const fits = (idx: number[]) => {
    for (let j = 1; j < idx.length; j++) {
      const [a, b] = [idx[j - 1], idx[j]];
      const gap = Math.abs(cx[b] - cx[a]) - (widths[a] + widths[b]) / 2;
      if (gap < X_LABEL_GAP_PX) return false;
    }
    return true;
  };
  let k = 1;
  let keep = kept(1);
  if (!fits(keep)) {
    // Only an edge label slid into its neighbour: drop it rather than halving every label
    const inBox = keep.filter((i) => cx[i] === labels[i].x);
    if (inBox.length >= keep.length - 2 && inBox.length > 1 && fits(inBox)) keep = inBox;
    else while (k < labels.length && !fits(keep)) keep = kept(++k);
  }
  const shown = new Set(keep.length ? keep : [0]);
  labels.forEach((l, i) => (l.el.style.display = shown.has(i) ? 'block' : 'none'));
}
