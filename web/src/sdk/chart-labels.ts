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
  const fits = everyPair((a, b) => Math.abs(cx[b] - cx[a]) - (widths[a] + widths[b]) / 2 >= X_LABEL_GAP_PX);
  let keep = kept(labels, 1);
  if (!fits(keep)) {
    // Only an edge label slid into its neighbour: drop it rather than halving every label
    const inBox = keep.filter((i) => cx[i] === labels[i].x);
    if (inBox.length >= keep.length - 2 && inBox.length > 1 && fits(inBox)) keep = inBox;
    else keep = thinnest(labels, fits);
  }
  show(labels, keep);
}

/** Line box of an upright x tick label that the default bottom padding holds (CSS px). */
export const X_LABEL_LINE_PX = 14;

/**
 * Tick label rotation in degrees like ECharts `axisLabel.rotate` (positive = anticlockwise),
 * clamped to its documented -90..90 range; 0 = upright (also for a missing / invalid value).
 */
export function labelRotation(deg: number | undefined): number {
  return typeof deg === 'number' && Number.isFinite(deg) ? Math.min(90, Math.max(-90, deg)) : 0;
}

/**
 * Style of an x tick label rotated by `deg` around its anchor (the tick, below the axis): the
 * text ends at the tick (positive angles) or starts there (negative), vertically centered, as
 * ECharts lays out rotated bottom axis labels.
 */
export function rotatedLabelStyle(deg: number): { transform: string; transformOrigin: string } {
  return deg > 0
    ? { transform: `translate(-100%, -50%) rotate(${-deg}deg)`, transformOrigin: '100% 50%' }
    : { transform: `translate(0, -50%) rotate(${-deg}deg)`, transformOrigin: '0 50%' };
}

/**
 * Extra bottom room (CSS px) x tick labels of `[width, height]` rotated by `deg` need beyond the
 * upright row: a label hangs `w * |sin| + h / 2 * cos` below its anchor.
 */
export function rotatedLabelReserve(sizes: [number, number][], deg: number): number {
  const a = (deg * Math.PI) / 180;
  const depth = sizes.reduce((d, [w, h]) => Math.max(d, w * Math.abs(Math.sin(a)) + (h / 2) * Math.abs(Math.cos(a))), 0);
  return Math.max(0, Math.ceil(depth - X_LABEL_LINE_PX - 1e-6));
}

/**
 * Rotates x axis labels by `deg` (see `rotatedLabelStyle`) and hides the ones that would overlap,
 * keeping every k-th label like `thinCenteredLabels`. Neighbours are parallel strips: they clear
 * each other when the anchor distance `d` gives `d * sin >= line + gap` across the text, or
 * `d * cos >= width + gap` along it (the right label's width for positive angles, which extend
 * left; the left one's for negative angles). Sizes are the unrotated layout boxes.
 */
export function thinRotatedLabels(labels: { el: HTMLElement; x: number; value: number }[], deg: number): void {
  const style = rotatedLabelStyle(deg);
  for (const l of labels) {
    l.el.style.transform = style.transform;
    l.el.style.transformOrigin = style.transformOrigin;
  }
  if (labels.length < 2) return;
  const sizes = labels.map((l) => [l.el.offsetWidth ?? 0, l.el.offsetHeight ?? 0]);
  // No layout (detached / hidden root): leave every label as placed
  if (sizes.every(([w, h]) => w === 0 && h === 0)) return;
  const a = (deg * Math.PI) / 180;
  const [sin, cos] = [Math.abs(Math.sin(a)), Math.abs(Math.cos(a))];
  const fits = everyPair((i, j) => {
    const d = Math.abs(labels[j].x - labels[i].x);
    if (d * sin >= (sizes[i][1] + sizes[j][1]) / 2 + X_LABEL_GAP_PX) return true;
    const [left, right] = labels[i].x <= labels[j].x ? [i, j] : [j, i];
    return d * cos >= sizes[deg > 0 ? right : left][0] + X_LABEL_GAP_PX;
  });
  show(labels, thinnest(labels, fits));
}

type TickLabel = { el: HTMLElement; value: number };

/** Every k-th label by tick value (`round(value / step) % k`, stable while panning). */
function kept(labels: TickLabel[], k: number): number[] {
  const diffs = labels
    .slice(1)
    .map((l, i) => Math.abs(l.value - labels[i].value))
    .sort((a, b) => a - b);
  const step = diffs[diffs.length >> 1];
  const slot = (i: number) => (step > 0 ? Math.round(labels[i].value / step) : i);
  return labels.map((_, i) => i).filter((i) => ((slot(i) % k) + k) % k === 0);
}

/** Kept set of the smallest k whose neighbours all fit (every label when k = 1 fits). */
function thinnest(labels: TickLabel[], fits: (idx: number[]) => boolean): number[] {
  let k = 1;
  let keep = kept(labels, 1);
  while (k < labels.length && !fits(keep)) keep = kept(labels, ++k);
  return keep;
}

/** Whether every pair of consecutive indices passes `ok`. */
function everyPair(ok: (a: number, b: number) => boolean): (idx: number[]) => boolean {
  return (idx) => idx.every((b, j) => j === 0 || ok(idx[j - 1], b));
}

function show(labels: TickLabel[], keep: number[]): void {
  const shown = new Set(keep.length ? keep : [0]);
  labels.forEach((l, i) => (l.el.style.display = shown.has(i) ? 'block' : 'none'));
}
