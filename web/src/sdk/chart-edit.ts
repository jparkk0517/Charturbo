/**
 * Point editing on 2D line and scatter charts (ECharts draggable points): pointer drag of a data
 * point (mouse, touch and pen through Pointer Events), click on an empty part of the plot to add a
 * point, and Shift / Alt + arrow keys on the keyboard-focused point. The SDK copy of the data is
 * updated in place through the existing data paths (line: `setSeriesData`, scatter: an in-place
 * engine move / append), so zoom, legend and style state are kept.
 */

/** Which data axes a drag moves. */
export type ChartEditAxis = 'x' | 'y' | 'xy';

export interface ChartEditOptions {
  /** Pointer / keyboard drag of existing points (default: true) */
  drag?: boolean;
  /**
   * Axes a drag moves: `'y'` (line default), `'x'` or `'xy'` (scatter default). Lines move x only
   * when they have `x` values, and never past their neighbours (x stays sorted)
   */
  dragAxis?: ChartEditAxis;
  /** y clamp (data units), intersected with the visible y range */
  min?: number;
  max?: number;
  /** x clamp (data units), intersected with the visible x range */
  xMin?: number;
  xMax?: number;
  /** Click / tap on an empty part of the plot adds a point (default: false) */
  addOnClick?: boolean;
  /** Editable series (line series index / scatter series id; default: all) */
  series?: number[];
  /** Series that click-to-add appends to (default: 0) */
  addSeries?: number;
  /** Grab distance from a point's center in CSS px (default: 10) */
  hitRadius?: number;
}

export interface ChartPointValue {
  x: number;
  y: number;
}

/** `pointDrag` (while dragging) / `pointDragEnd` (commit or cancel) payload. */
export interface CharturboPointDragEvent {
  chartType: 'line' | 'scatter';
  /** Line series index / scatter series id */
  series: number;
  /** Line: sample index; scatter: point index in the input arrays */
  index: number;
  /** Value before the drag (line `x` = sample index on charts without x) */
  oldValue: ChartPointValue;
  newValue: ChartPointValue;
  source: 'pointer' | 'keyboard';
  /** `pointDragEnd` only: Escape / pointer cancel restored `oldValue` */
  cancelled?: boolean;
}

/** `pointAdd` payload (click to add). */
export interface CharturboPointAddEvent {
  chartType: 'line' | 'scatter';
  series: number;
  /** Index of the new point (line: sorted position; later samples shift by one) */
  index: number;
  value: ChartPointValue;
}

export interface ResolvedChartEdit {
  drag: boolean;
  /** `null` = chart default */
  dragAxis: ChartEditAxis | null;
  min: number;
  max: number;
  xMin: number;
  xMax: number;
  addOnClick: boolean;
  series: Set<number> | null;
  addSeries: number;
  hitRadius: number;
}

const AXES: readonly ChartEditAxis[] = ['x', 'y', 'xy'];

function bound(name: string, v: number | undefined, def: number): number {
  if (v === undefined) return def;
  if (typeof v !== 'number' || Number.isNaN(v)) throw new Error(`editable.${name} must be a number`);
  return v;
}

/** Validates `editable` options (`false` / `undefined` = off); throws before any state changes. */
export function resolveChartEdit(o: ChartEditOptions | boolean | undefined): ResolvedChartEdit | null {
  if (o === undefined || o === false) return null;
  const opts: ChartEditOptions = o === true ? {} : o;
  if (typeof opts !== 'object' || opts === null) throw new Error('editable must be a boolean or an options object');
  if (opts.dragAxis !== undefined && !AXES.includes(opts.dragAxis)) {
    throw new Error(`editable.dragAxis must be 'x', 'y' or 'xy' (got ${String(opts.dragAxis)})`);
  }
  const min = bound('min', opts.min, -Infinity);
  const max = bound('max', opts.max, Infinity);
  const xMin = bound('xMin', opts.xMin, -Infinity);
  const xMax = bound('xMax', opts.xMax, Infinity);
  if (min > max) throw new Error('editable.min must not exceed editable.max');
  if (xMin > xMax) throw new Error('editable.xMin must not exceed editable.xMax');
  const hitRadius = bound('hitRadius', opts.hitRadius, 10);
  if (!(hitRadius > 0) || !Number.isFinite(hitRadius)) throw new Error('editable.hitRadius must be a positive number');
  const addSeries = opts.addSeries ?? 0;
  if (!Number.isInteger(addSeries) || addSeries < 0) throw new Error('editable.addSeries must be a series index');
  if (opts.series !== undefined && (!Array.isArray(opts.series) || opts.series.some((s) => !Number.isInteger(s) || s < 0))) {
    throw new Error('editable.series must be an array of series indices');
  }
  return {
    drag: opts.drag ?? true,
    dragAxis: opts.dragAxis ?? null,
    min,
    max,
    xMin,
    xMax,
    addOnClick: opts.addOnClick ?? false,
    series: opts.series ? new Set(opts.series) : null,
    addSeries,
    hitRadius,
  };
}

/** Clamps `v` into `[lo, hi]`; an empty interval (`lo > hi`) clamps to the nearer end of the data range. */
export function clampValue(v: number, lo: number, hi: number): number {
  if (lo > hi) return v < lo ? Math.max(v, hi) : Math.min(v, lo);
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Inserts `(x, y)` keeping `xs` sorted (after equal x); without `xs`, inserts at index
 * `round(x)` clamped to `[0, values.length]`. Returns new arrays and the insertion index.
 */
export function insertSortedPoint(
  values: ArrayLike<number>,
  xs: ArrayLike<number> | null,
  x: number,
  y: number
): { values: Float32Array; xs: Float64Array | null; index: number } {
  const n = values.length;
  let index: number;
  if (xs) {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid + 1;
      else hi = mid;
    }
    index = lo;
  } else {
    index = Math.min(n, Math.max(0, Math.round(x)));
  }
  const v = new Float32Array(n + 1);
  for (let i = 0; i < index; i++) v[i] = values[i];
  v[index] = y;
  for (let i = index; i < n; i++) v[i + 1] = values[i];
  let nx: Float64Array | null = null;
  if (xs) {
    nx = new Float64Array(n + 1);
    for (let i = 0; i < index; i++) nx[i] = xs[i];
    nx[index] = x;
    for (let i = index; i < n; i++) nx[i + 1] = xs[i];
  }
  return { values: v, xs: nx, index };
}

/** One editable chart (built per gesture from the SDK chart meta). */
export interface PointEditTarget {
  chartType: 'line' | 'scatter';
  /** Series is visible and editable */
  editable(series: number): boolean;
  /** y axis of a series (0 left, 1 right) */
  axisOf(series: number): number;
  /** Default drag axes */
  defaultAxis: ChartEditAxis;
  /** The series can move along x (scatter; lines with x values) */
  movesX(series: number): boolean;
  /** Engine global id of a point (hover / projection) */
  idOf(series: number, index: number): number;
  value(series: number, index: number): ChartPointValue | null;
  /** x interval the point may move in (line neighbours) */
  xLimits(series: number, index: number): [number, number];
  set(series: number, index: number, v: ChartPointValue): void;
  /** Adds a point; the series / index it landed at, or null */
  add(series: number, v: ChartPointValue): { series: number; index: number } | null;
  /** Gesture start / end (line: freezes the y domain while dragging) */
  begin(): void;
  end(): void;
}

export interface PointEditBackend {
  chart_hover_at_ndc?(ndcX: number, ndcY: number): Float64Array;
  project_node_to_ndc?(nodeId: number): Float32Array;
  chart_ndc_to_data?(ndcX: number, ndcY: number, axis: number): Float64Array;
}

export interface PointEditHost {
  options(): ResolvedChartEdit | null;
  target(): PointEditTarget | null;
  backend(): PointEditBackend;
  /** Canvas client rect */
  rect(): { left: number; top: number; width: number; height: number } | null;
  emitDrag(e: CharturboPointDragEvent): void;
  emitDragEnd(e: CharturboPointDragEvent): void;
  emitAdd(e: CharturboPointAddEvent): void;
  /** Data changed (a11y refresh, autoRender) */
  changed(): void;
}

interface PointerLike {
  clientX: number;
  clientY: number;
  pointerId?: number;
  button?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

interface Drag {
  pointerId: number | undefined;
  target: PointEditTarget;
  series: number;
  index: number;
  old: ChartPointValue;
  last: ChartPointValue;
  axis: ChartEditAxis;
  /** NDC offset point - pointer at press (the point does not jump under the pointer) */
  offset: [number, number];
  down: [number, number];
  /** Clamp box `[x0, x1, y0, y1]` (visible range intersected with the options) */
  box: [number, number, number, number];
  live: boolean;
}

/** Drag slop in CSS px: a smaller move is a click / tap. */
const DRAG_SLOP_PX = 3;

export interface PointEditor {
  /** Press on an editable point: the editor owns this pointer (no pan / brush / gesture). */
  pointerDown(e: PointerLike): boolean;
  /** True while the editor owns the pointer (the move is consumed). */
  pointerMove(e: PointerLike): boolean;
  /** `'drag'`: committed; `'click'`: owned press that never moved (caller runs its click); `false`: not ours. */
  pointerUp(e: PointerLike): 'drag' | 'click' | false;
  /** Escape / pointer cancel: restores the value of a live drag. True when something was cancelled. */
  cancel(): boolean;
  /** Pointer capture lost without a release: commits. */
  commit(): void;
  /** Chart replaced / scene cleared: drops a drag without writing or events (its target is gone). */
  reset(): void;
  /** Click to add; true when a point was added. */
  click(e: PointerLike): boolean;
  /** Keyboard step of a focused point; the new value, or null when not handled. */
  key(series: number, index: number, key: string, fine: boolean): ChartPointValue | null;
  dragging(): boolean;
}

export function createPointEditor(host: PointEditHost): PointEditor {
  let drag: Drag | null = null;

  const toNdc = (e: PointerLike): [number, number] | null => {
    const r = host.rect();
    if (!r) return null;
    return [((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1, 1 - ((e.clientY - r.top) / Math.max(1, r.height)) * 2];
  };
  const toData = (ndc: [number, number], axis: number): Float64Array | null => {
    const d = host.backend().chart_ndc_to_data?.(ndc[0], ndc[1], axis);
    return d && d.length >= 6 ? d : null;
  };

  /** Nearest editable point within the hit radius of the pointer. */
  const pick = (t: PointEditTarget, o: ResolvedChartEdit, e: PointerLike) => {
    const ndc = toNdc(e);
    const r = host.rect();
    const b = host.backend();
    if (!ndc || !r) return null;
    const hit = b.chart_hover_at_ndc?.(ndc[0], ndc[1]);
    if (!hit || hit.length < 3) return null;
    let best: { series: number; index: number; ndc: [number, number]; d: number } | null = null;
    for (let k = 0; k < hit[2]; k++) {
      const series = hit[3 + k * 4];
      const index = hit[4 + k * 4];
      if (!t.editable(series) || (o.series && !o.series.has(series))) continue;
      const p = b.project_node_to_ndc?.(t.idOf(series, index));
      if (!p || p.length < 2) continue;
      const dx = ((p[0] - ndc[0]) / 2) * r.width;
      const dy = ((p[1] - ndc[1]) / 2) * r.height;
      const d = Math.hypot(dx, dy);
      if (d <= o.hitRadius && (!best || d < best.d)) best = { series, index, ndc: [p[0], p[1]], d };
    }
    return best;
  };

  const axisFor = (t: PointEditTarget, o: ResolvedChartEdit, series: number): ChartEditAxis => {
    const a = o.dragAxis ?? t.defaultAxis;
    if (t.movesX(series)) return a;
    return 'y';
  };

  const clampBox = (o: ResolvedChartEdit, range: Float64Array | null, xl: [number, number]): Drag['box'] => {
    const [vx0, vx1, vy0, vy1] = range ? [range[2], range[3], range[4], range[5]] : [-Infinity, Infinity, -Infinity, Infinity];
    return [Math.max(vx0, o.xMin, xl[0]), Math.min(vx1, o.xMax, xl[1]), Math.max(vy0, o.min), Math.min(vy1, o.max)];
  };

  const apply = (d: Drag, v: ChartPointValue): ChartPointValue => {
    const next = {
      x: d.axis === 'y' ? d.old.x : clampValue(v.x, d.box[0], d.box[1]),
      y: d.axis === 'x' ? d.old.y : clampValue(v.y, d.box[2], d.box[3]),
    };
    if (next.x !== d.last.x || next.y !== d.last.y) {
      d.target.set(d.series, d.index, next);
      d.last = next;
    }
    return next;
  };

  const payload = (d: Drag, source: 'pointer' | 'keyboard', newValue: ChartPointValue): CharturboPointDragEvent => ({
    chartType: d.target.chartType,
    series: d.series,
    index: d.index,
    oldValue: { ...d.old },
    newValue: { ...newValue },
    source,
  });

  const finish = (cancelled: boolean) => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.live) return;
    if (cancelled) apply(d, d.old);
    d.target.end();
    host.emitDragEnd({ ...payload(d, 'pointer', d.last), cancelled });
    host.changed();
  };

  return {
    pointerDown(e) {
      if (drag) finish(true);
      const o = host.options();
      if (!o?.drag || (e.button !== undefined && e.button !== 0) || e.ctrlKey || e.metaKey) return false;
      const t = host.target();
      if (!t) return false;
      const p = pick(t, o, e);
      const ndc = toNdc(e);
      if (!p || !ndc) return false;
      const old = t.value(p.series, p.index);
      if (!old) return false;
      const range = toData(ndc, t.axisOf(p.series));
      if (!range) return false;
      drag = {
        pointerId: e.pointerId,
        target: t,
        series: p.series,
        index: p.index,
        old,
        last: old,
        axis: axisFor(t, o, p.series),
        offset: [p.ndc[0] - ndc[0], p.ndc[1] - ndc[1]],
        down: [e.clientX, e.clientY],
        box: clampBox(o, range, t.xLimits(p.series, p.index)),
        live: false,
      };
      return true;
    },

    pointerMove(e) {
      const d = drag;
      if (!d || (d.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== d.pointerId)) return false;
      if (!d.live) {
        if (Math.hypot(e.clientX - d.down[0], e.clientY - d.down[1]) < DRAG_SLOP_PX) return true;
        d.live = true;
        d.target.begin();
      }
      const ndc = toNdc(e);
      const data = ndc && toData([ndc[0] + d.offset[0], ndc[1] + d.offset[1]], d.target.axisOf(d.series));
      if (!data) return true;
      const v = apply(d, { x: data[0], y: data[1] });
      host.emitDrag(payload(d, 'pointer', v));
      host.changed();
      return true;
    },

    pointerUp(e) {
      const d = drag;
      if (!d || (d.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== d.pointerId)) return false;
      if (!d.live) {
        drag = null;
        return 'click';
      }
      finish(false);
      return 'drag';
    },

    cancel() {
      if (!drag) return false;
      const live = drag.live;
      finish(true);
      return live;
    },

    commit() {
      finish(false);
    },

    reset() {
      drag = null;
    },

    click(e) {
      const o = host.options();
      if (!o?.addOnClick || e.ctrlKey || e.metaKey) return false;
      const t = host.target();
      if (!t || (o.series && !o.series.has(o.addSeries)) || !t.editable(o.addSeries)) return false;
      // A click on (or next to) an existing point is not an add
      if (pick(t, o, e)) return false;
      const ndc = toNdc(e);
      const data = ndc && toData(ndc, t.axisOf(o.addSeries));
      if (!data) return false;
      const [x, y, x0, x1, y0, y1] = data;
      // Inside the plot only (axes, legend and padding clicks are not adds)
      if (!(x >= x0 && x <= x1 && y >= y0 && y <= y1)) return false;
      const v = { x: clampValue(x, Math.max(x0, o.xMin), Math.min(x1, o.xMax)), y: clampValue(y, Math.max(y0, o.min), Math.min(y1, o.max)) };
      const at = t.add(o.addSeries, v);
      if (!at) return false;
      host.emitAdd({ chartType: t.chartType, series: at.series, index: at.index, value: v });
      host.changed();
      return true;
    },

    key(series, index, key, fine) {
      const o = host.options();
      if (!o?.drag || drag || (o.series && !o.series.has(series))) return null;
      const t = host.target();
      if (!t || !t.editable(series)) return null;
      const old = t.value(series, index);
      const range = toData([0, 0], t.axisOf(series));
      if (!old || !range) return null;
      const axis = axisFor(t, o, series);
      const vertical = key === 'ArrowUp' || key === 'ArrowDown';
      const horizontal = key === 'ArrowLeft' || key === 'ArrowRight';
      if (!(vertical && axis !== 'x') && !(horizontal && axis !== 'y')) return null;
      const sign = key === 'ArrowUp' || key === 'ArrowRight' ? 1 : -1;
      const span = vertical ? range[5] - range[4] : range[3] - range[2];
      const step = (sign * span) / (fine ? 500 : 50);
      const d: Drag = {
        pointerId: undefined,
        target: t,
        series,
        index,
        old,
        last: old,
        axis: vertical ? 'y' : 'x',
        offset: [0, 0],
        down: [0, 0],
        box: clampBox(o, range, t.xLimits(series, index)),
        live: true,
      };
      // Values already outside the clamp box stay put rather than jumping to its edge
      const v = apply(d, vertical ? { x: old.x, y: old.y + step } : { x: old.x + step, y: old.y });
      if (v.x === old.x && v.y === old.y) return null;
      host.emitDrag(payload(d, 'keyboard', v));
      host.emitDragEnd({ ...payload(d, 'keyboard', v), cancelled: false });
      host.changed();
      return v;
    },

    dragging: () => drag?.live === true,
  };
}

// ---------------------------------------------------------------------------
// Targets of the SDK chart metas (structural subsets of charturbo.ts' metas)
// ---------------------------------------------------------------------------

export interface LineEditMeta {
  kind: 'line';
  names: string[];
  visible: boolean[];
  offsets: number[];
  xs: Float64Array[] | null;
  area?: 'overlap' | 'stacked' | 'percent';
  sparse?: unknown;
  standaloneBand?: boolean;
  themeRiver?: unknown;
  seriesAxes?: number[];
}

export interface LineEditDeps {
  /** Current samples of a series (streamed series re-read from the engine) */
  read(series: number): { values: ArrayLike<number>; xs: ArrayLike<number> | null };
  /** `setSeriesData` */
  write(series: number, values: Float32Array, xs: Float64Array | null): void;
  /** Freeze the y domain(s) at their current extent / restore the configured options */
  freezeY(): void;
  restoreY(): void;
}

/** Line / overlap area target; `null` for stacked / percent areas, bands, sparse and ThemeRiver charts. */
export function lineEditTarget(meta: LineEditMeta, deps: LineEditDeps): PointEditTarget | null {
  if ((meta.area && meta.area !== 'overlap') || meta.sparse || meta.standaloneBand || meta.themeRiver) return null;
  const axisOf = (s: number) => meta.seriesAxes?.[s] ?? 0;
  /**
   * Working copies per series for the current gesture (written back through `write`). `seen` is
   * what `read` returned after the last write: anything else means the data was set from outside
   * (e.g. streaming) and the copy is taken again.
   */
  const work = new Map<number, { values: Float32Array; xs: Float64Array | null; seen: ArrayLike<number> | null }>();
  const copy = (s: number) => {
    const r = deps.read(s);
    let w = work.get(s);
    if (!w || r.values !== w.seen) {
      w = { values: Float32Array.from(r.values), xs: r.xs ? Float64Array.from(r.xs) : null, seen: null };
      work.set(s, w);
    }
    return w;
  };
  return {
    chartType: 'line',
    defaultAxis: 'y',
    editable: (s) => s >= 0 && s < meta.names.length && meta.visible[s] !== false && axisOf(s) <= 1,
    axisOf,
    movesX: (s) => !!meta.xs?.[s],
    idOf: (s, i) => (meta.offsets[s] ?? 0) + i,
    value(s, i) {
      const r = deps.read(s);
      if (!Number.isInteger(i) || i < 0 || i >= r.values.length) return null;
      return { x: r.xs ? Number(r.xs[i]) : i, y: Number(r.values[i]) };
    },
    xLimits(s, i) {
      const xs = deps.read(s).xs;
      if (!xs) return [-Infinity, Infinity];
      return [i > 0 ? Number(xs[i - 1]) : -Infinity, i + 1 < xs.length ? Number(xs[i + 1]) : Infinity];
    },
    set(s, i, v) {
      const w = copy(s);
      w.values[i] = v.y;
      if (w.xs) w.xs[i] = v.x;
      deps.write(s, w.values, w.xs);
      w.seen = deps.read(s).values;
    },
    add(s, v) {
      const r = deps.read(s);
      const next = insertSortedPoint(r.values, r.xs, v.x, v.y);
      work.delete(s);
      deps.write(s, next.values, next.xs);
      return { series: s, index: next.index };
    },
    begin: () => deps.freezeY(),
    end() {
      work.clear();
      deps.restoreY();
    },
  };
}

export interface ScatterEditMeta {
  kind: 'scatter';
  names: string[];
  visible: boolean[];
  x: Float32Array;
  y: Float32Array;
  series: Uint16Array | null;
  pointColors: Float32Array | null;
}

export interface ScatterEditBackend {
  set_chart_scatter_point?(index: number, x: number, y: number): boolean;
  append_chart_scatter_point?(x: number, y: number, series: number): number;
}

/** Arrays the editor already copied (the input arrays may be the caller's). */
const owned = new WeakSet<object>();

function ownF32(a: Float32Array): Float32Array {
  if (owned.has(a)) return a;
  const c = Float32Array.from(a);
  owned.add(c);
  return c;
}

/** Scatter target (needs the engine's in-place point calls). */
export function scatterEditTarget(meta: ScatterEditMeta, backend: ScatterEditBackend): PointEditTarget | null {
  if (!backend.set_chart_scatter_point) return null;
  const n = () => Math.min(meta.x.length, meta.y.length);
  const seriesOf = (i: number) => meta.series?.[i] ?? 0;
  return {
    chartType: 'scatter',
    defaultAxis: 'xy',
    editable: (s) => meta.visible[s] !== false && (s < Math.max(1, meta.names.length)),
    axisOf: () => 0,
    movesX: () => true,
    idOf: (_s, i) => i,
    value: (_s, i) => (Number.isInteger(i) && i >= 0 && i < n() ? { x: meta.x[i], y: meta.y[i] } : null),
    xLimits: () => [-Infinity, Infinity],
    set(_s, i, v) {
      if (!backend.set_chart_scatter_point?.(i, v.x, v.y)) return;
      meta.x = ownF32(meta.x);
      meta.y = ownF32(meta.y);
      meta.x[i] = v.x;
      meta.y[i] = v.y;
    },
    add(s, v) {
      const index = backend.append_chart_scatter_point?.(v.x, v.y, s) ?? -1;
      if (index < 0) return null;
      const len = n();
      const grow = <T extends Float32Array | Uint16Array>(a: T, make: (len: number) => T, value: number, stride = 1): T => {
        const out = make((len + 1) * stride);
        out.set(a.subarray(0, len * stride));
        out.fill(value, len * stride);
        return out;
      };
      meta.x = grow(meta.x, (l) => new Float32Array(l), v.x);
      meta.y = grow(meta.y, (l) => new Float32Array(l), v.y);
      owned.add(meta.x);
      owned.add(meta.y);
      if (meta.series || s !== 0) meta.series = grow(meta.series ?? new Uint16Array(len), (l) => new Uint16Array(l), s);
      if (meta.pointColors) {
        const from = Array.from({ length: len }, (_, i) => i).find((i) => seriesOf(i) === s) ?? 0;
        const c = meta.pointColors.slice(from * 4, from * 4 + 4);
        const out = new Float32Array((len + 1) * 4);
        out.set(meta.pointColors.subarray(0, len * 4));
        out.set(c.length === 4 ? c : [0, 0, 0, 1], len * 4);
        meta.pointColors = out;
      }
      return { series: s, index };
    },
    begin() {},
    end() {},
  };
}
