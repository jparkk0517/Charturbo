/**
 * Axis breaks and extra y axes (3+). The engine owns the piecewise break mapping
 * (crates/charturbo-core/src/chart/axis_break.rs: geometry, ticks, hover, brush, zigzag marks,
 * SVG) and the per-axis domains / scales (multi_axis.rs); this module validates and flattens the
 * options and lays out the extra axes' label slots beside the plot.
 */

/** One collapsed value range of an axis, drawn as a small gap with zigzag marks. */
export interface ChartAxisBreak {
  /** First collapsed value (data units) */
  start: number;
  /** Last collapsed value (> `start`) */
  end: number;
  /**
   * Room the range keeps: data units, or `'<n>%'` of the axis' kept data span (data extent minus
   * the collapsed ranges). Default: `'2%'`
   */
  gap?: number | `${number}%`;
}

/** Value axis with breaks (linear scales only; at most 8, non-overlapping). */
export interface ChartAxisBreakOptions {
  breaks?: ChartAxisBreak[];
}

/** Placement of an extra y axis (`axes.extraY`). */
export interface ChartExtraAxisPlacement {
  /** Side of the plot (default: `'right'`); stacked outward after the axes already there */
  position?: 'left' | 'right';
  /** Extra CSS px between this axis and the previous one on its side (default: 0) */
  offset?: number;
}

export const MAX_AXIS_BREAKS = 8;
/** Left, right and 6 extra y axes */
export const MAX_Y_AXES = 8;
/** Engine tick / scale code of extra y axis `k >= 2` is `EXTRA_Y_CODE + k` */
export const EXTRA_Y_CODE = 16;
const DEFAULT_GAP = '2%';
const PERCENT = /^\s*(\d+(?:\.\d+)?)\s*%\s*$/;

/** Engine axis code of y axis `k` (0 = left -> 1, 1 = right -> 2, k >= 2 -> 16 + k). */
export function yAxisCode(k: number): number {
  return k < 2 ? k + 1 : EXTRA_Y_CODE + k;
}

/**
 * Throws (`where`: message prefix, e.g. `'renderBarChart: axes.y'`) unless `breaks` is a valid
 * break list: finite `start < end`, gap >= 0 (number or `'<n>%'`), at most 8, no overlapping or
 * touching ranges, and a linear scale (`log`).
 */
export function validateBreaks(breaks: readonly ChartAxisBreak[] | undefined, where: string, log: boolean): void {
  if (breaks === undefined) return;
  if (!Array.isArray(breaks)) throw new Error(`${where}: breaks must be an array`);
  if (breaks.length === 0) return;
  if (log) throw new Error(`${where}: breaks need a linear scale`);
  if (breaks.length > MAX_AXIS_BREAKS) throw new Error(`${where}: at most ${MAX_AXIS_BREAKS} breaks, got ${breaks.length}`);
  breaks.forEach((b, i) => {
    if (!b || typeof b.start !== 'number' || typeof b.end !== 'number' || !Number.isFinite(b.start) || !Number.isFinite(b.end)) {
      throw new Error(`${where}: break ${i} needs finite start / end`);
    }
    if (!(b.start < b.end)) throw new Error(`${where}: break ${i} needs start < end`);
    const g = b.gap;
    const ok = g === undefined || (typeof g === 'number' ? Number.isFinite(g) && g >= 0 : typeof g === 'string' && PERCENT.test(g));
    if (!ok) throw new Error(`${where}: break ${i} gap must be a number >= 0 or '<n>%'`);
  });
  const sorted = [...breaks].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start <= sorted[i - 1].end) throw new Error(`${where}: breaks overlap (${sorted[i - 1].start}..${sorted[i - 1].end}, ${sorted[i].start}..${sorted[i].end})`);
  }
}

/** Finite `[min, max]` of `values` (with 0 when `withZero`), or null. */
export function breakExtent(values: Iterable<ArrayLike<number>>, withZero = false): [number, number] | null {
  let lo = withZero ? 0 : Infinity;
  let hi = withZero ? 0 : -Infinity;
  let any = withZero;
  for (const v of values) {
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (typeof x !== 'number' || !Number.isFinite(x)) continue;
      any = true;
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
  }
  return any ? [lo, hi] : null;
}

/**
 * Flat `[start, end, gap]` triples for `set_chart_axis_breaks` (validated input). Percent gaps
 * are of the kept span of `extent` (its length minus the collapsed parts inside it), else of the
 * break's own length.
 */
export function resolveBreaks(breaks: readonly ChartAxisBreak[] | undefined, extent: [number, number] | null): Float64Array {
  if (!breaks?.length) return new Float64Array(0);
  let kept = 0;
  if (extent) {
    const [lo, hi] = extent;
    kept = hi - lo - breaks.reduce((s, b) => s + Math.max(0, Math.min(b.end, hi) - Math.max(b.start, lo)), 0);
  }
  const out = new Float64Array(breaks.length * 3);
  breaks.forEach((b, i) => {
    const g = b.gap ?? DEFAULT_GAP;
    const base = kept > 0 && Number.isFinite(kept) ? kept : b.end - b.start;
    out.set([b.start, b.end, typeof g === 'number' ? g : (Number(PERCENT.exec(g)?.[1] ?? 2) / 100) * base], i * 3);
  });
  return out;
}

/** y axis index of a series: `yAxisIndex`, else `yAxis` (`'right'` = 1), else 0. */
export function seriesAxisIndex(s: { yAxis?: 'left' | 'right'; yAxisIndex?: number }): number {
  if (s.yAxisIndex !== undefined) return s.yAxisIndex;
  return s.yAxis === 'right' ? 1 : 0;
}

/** Throws unless every `yAxisIndex` is an integer below `axisCount` (left + right + extra). */
export function validateSeriesAxisIndex(series: readonly { yAxisIndex?: number }[], axisCount: number, fn: string): void {
  series.forEach((s, i) => {
    const k = s.yAxisIndex;
    if (k === undefined) return;
    if (!Number.isInteger(k) || k < 0 || k >= Math.min(axisCount, MAX_Y_AXES)) {
      throw new Error(`${fn}: series ${i} yAxisIndex ${k} needs an axis (0 = y, 1 = y2, 2.. = axes.extraY[k - 2])`);
    }
  });
}

/** Label slot of extra y axis `k`: `dist` CSS px out from the plot edge on `side`, `width` wide. */
export interface ExtraAxisSlot {
  k: number;
  side: 'left' | 'right';
  dist: number;
  width: number;
}

/**
 * Stacks the extra axes outward after the left / right axis slots (`base`: their widths in CSS
 * px, 0 = none). Returns the slots and the total width of each side.
 */
export function layoutExtraAxes(
  extra: readonly (ChartExtraAxisPlacement & { show?: boolean; title?: string })[],
  base: { left: number; right: number }
): { slots: ExtraAxisSlot[]; left: number; right: number } {
  const edge = { left: base.left, right: base.right };
  const slots = extra.map((a, i): ExtraAxisSlot => {
    const side = a.position === 'left' ? 'left' : 'right';
    const offset = typeof a.offset === 'number' && Number.isFinite(a.offset) ? Math.max(0, a.offset) : 0;
    const width = (a.show === false ? 0 : 56) + (a.title ? 20 : 0);
    const dist = edge[side] + offset;
    edge[side] = dist + width;
    return { k: i + 2, side, dist, width };
  });
  return { slots, ...edge };
}
