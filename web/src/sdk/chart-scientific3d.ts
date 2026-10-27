/** Independent Y-up scientific charts. Geometry and picking live in Rust. */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartGridStyle, ChartHoverStyle, ChartLegendOptions, ChartTooltipContext, NodeDetails, Vec3Tuple } from './charturbo';
import type { A11yChartModel, A11yFocus } from './chart-a11y';
import { rgbCss, type A11yCommon } from './chart-business-util';

export type PointCloud3DData = Float32Array | Float64Array | readonly (readonly [number, number, number] | { x: number; y: number; z: number } | null)[]
  | { x: ArrayLike<number>; y: ArrayLike<number>; z: ArrayLike<number> };
export interface Scientific3DStyle {
  name?: string;
  color?: ColorInput;
  visible?: boolean;
  opacity?: number;
}
export type Scientific3DColormap = 'viridis' | 'magma';
export interface PointCloud3DSeries extends Scientific3DStyle {
  data: PointCloud3DData;
  /** Billboard diameter in CSS pixels (default 3). */
  size?: number;
  colorBy?: { values: ArrayLike<number>; colormap?: Scientific3DColormap; min?: number; max?: number };
}
export interface Surface3DGridData {
  columns: number;
  rows: number;
  xStart: number;
  xStep: number;
  zStart: number;
  zStep: number;
  /** Row-major Y heights: y[row * columns + column]. Nonfinite values make holes. */
  y: ArrayLike<number>;
}
export interface Surface3DSeries extends Scientific3DStyle {
  data: Surface3DGridData;
  colormap?: Scientific3DColormap;
  yMin?: number;
  yMax?: number;
  wireframe?: boolean;
  /** Flat diffuse lighting, 0..1 (default 0.65). */
  lighting?: number;
}
export interface PointCloud3DAppendOptions {
  /** Keep the newest samples. Zero / omitted means unbounded (up to the chart limit). */
  maxPoints?: number;
  /** Required iff the rendered series uses colorBy; one scalar per appended point. */
  colorValues?: ArrayLike<number>;
}
/** Height updates preserve camera, style and visibility. Scroll defaults to true. */
export type Surface3DUpdate =
  | { mode: 'replaceY'; y: ArrayLike<number>; yMin?: number; yMax?: number }
  | { mode: 'appendColumns'; columns: number; y: ArrayLike<number>; scrollX?: boolean }
  | { mode: 'appendRows'; rows: number; y: ArrayLike<number>; scrollZ?: boolean };
export interface Scientific3DChartOptions {
  title?: string;
  description?: string;
  legend?: boolean | ChartLegendOptions;
  grid?: ChartGridStyle;
  showGrid?: boolean;
  hover?: ChartHoverStyle;
  /** Perspective camera in normalized render space, each data axis maps to [-60,60]. */
  camera?: { eye: Vec3Tuple; target?: Vec3Tuple };
}
export interface Scientific3DMeta {
  kind: 'scientific3d';
  mode: 'pointCloud3d' | 'surface3d';
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  xyz: Float32Array;
  pointColors: Float32Array;
  offsets: Uint32Array;
  shapes: Uint32Array;
  /** Owned snapshots for incremental updates; never retain caller-owned arrays. */
  clouds?: PointCloud3DSeries[];
  surfaces?: Surface3DSeries[];
}
export interface EncodedScientific3D {
  xyz: Float32Array;
  colors: Float32Array;
  offsets: Uint32Array;
  styles: Float32Array;
  shapes: Uint32Array;
  meta: Scientific3DMeta;
}

const MAX_SAMPLES = 4_000_000;
function finite(v: number, name: string, min = -Infinity, max = Infinity): number {
  if (!Number.isFinite(Math.fround(v)) || v < min || v > max) throw new Error(`3D chart: invalid ${name}`);
  return v;
}
function count(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_SAMPLES) throw new Error(`3D chart: length must be at most ${MAX_SAMPLES}`);
  return n;
}
export function validateScientific3DOptions(o?: Scientific3DChartOptions): void {
  if (o?.camera) {
    for (const p of [o.camera.eye, o.camera.target ?? [0, 0, 0]]) {
      if (p.length !== 3) throw new Error('3D chart: camera needs three coordinates');
      p.forEach(v => finite(v, 'camera'));
    }
    if (Math.hypot(...o.camera.eye.map((v, i) => v - (o.camera!.target?.[i] ?? 0))) < 5) throw new Error('3D chart: camera eye must be at least 5 units from target');
  }
}
function cloud(data: PointCloud3DData): Float32Array {
  if (data instanceof Float32Array || data instanceof Float64Array) {
    if (data.length % 3) throw new Error('3D chart: XYZ length must be divisible by 3');
    count(data.length / 3); return Float32Array.from(data);
  }
  if ('x' in data) {
    const n = count(data.x.length);
    if (data.y.length !== n || data.z.length !== n) throw new Error('3D chart: XYZ length mismatch');
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) out.set([data.x[i], data.y[i], data.z[i]], i * 3);
    return out;
  }
  const out = new Float32Array(count(data.length) * 3);
  for (let i = 0; i < data.length; i++) {
    const p = data[i];
    const xyz = p == null ? [NaN, NaN, NaN] : 'x' in p ? [p.x, p.y, p.z] : p;
    if (xyz.length !== 3 || !Array.from(xyz).every(v => typeof v === 'number')) throw new Error('3D chart: each point needs three numeric coordinates');
    out.set(xyz, i * 3);
  }
  return out;
}
function grid(d: Surface3DGridData): Float32Array {
  count(d.columns); count(d.rows);
  if (d.columns < 2 || d.rows < 2 || count(d.columns * d.rows) !== d.y.length) throw new Error('3D chart: surface shape / length mismatch');
  finite(d.xStart, 'xStart'); finite(d.zStart, 'zStart'); finite(d.xStep, 'xStep'); finite(d.zStep, 'zStep');
  if (!d.xStep || !d.zStep) throw new Error('3D chart: grid step must not be zero');
  finite(d.xStart + (d.columns - 1) * d.xStep, 'x extent'); finite(d.zStart + (d.rows - 1) * d.zStep, 'z extent');
  const xyz = new Float32Array(d.y.length * 3);
  for (let i = 0; i < d.y.length; i++) xyz.set([d.xStart + (i % d.columns) * d.xStep, d.y[i], d.zStart + Math.floor(i / d.columns) * d.zStep], i * 3);
  return xyz;
}
const ramps = {
  viridis: [[0.267, 0.005, 0.329], [0.23, 0.322, 0.546], [0.128, 0.567, 0.551], [0.369, 0.789, 0.383], [0.993, 0.906, 0.144]],
  magma: [[0.001, 0, 0.014], [0.316, 0.071, 0.485], [0.716, 0.215, 0.475], [0.987, 0.536, 0.382], [0.987, 0.991, 0.75]],
};
function rampColors(values: ArrayLike<number>, map: Scientific3DColormap, alpha: number, min?: number, max?: number): Float32Array {
  if (!(map in ramps)) throw new Error('3D chart: invalid colormap');
  if (min !== undefined) finite(min, 'color min'); if (max !== undefined) finite(max, 'color max');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i])) { lo = Math.min(lo, values[i]); hi = Math.max(hi, values[i]); }
  lo = min ?? (Number.isFinite(lo) ? lo : 0); hi = max ?? (Number.isFinite(hi) ? hi : 1);
  if (lo > hi) throw new Error('3D chart: reversed color domain');
  const out = new Float32Array(values.length * 4), ramp = ramps[map];
  for (let i = 0; i < values.length; i++) {
    const t = Number.isFinite(values[i]) ? hi === lo ? 2 : Math.max(0, Math.min(4, (values[i] - lo) / (hi - lo) * 4)) : 0;
    const k = Math.min(3, Math.floor(t)), f = t - k;
    out.set([0, 1, 2].map(c => ramp[k][c] * (1 - f) + ramp[k + 1][c] * f).concat(alpha), i * 4);
  }
  return out;
}
function encode(series: (PointCloud3DSeries | Surface3DSeries)[], palette: RgbaTuple[], surface: boolean): EncodedScientific3D {
  const chunks: Float32Array[] = [], colors: Float32Array[] = [], shapes: number[] = [], offsets = [0], styles: number[] = [];
  const names: string[] = [], swatches: RgbaTuple[] = [];
  const clouds: PointCloud3DSeries[] = [], surfaces: Surface3DSeries[] = [];
  series.forEach((s, i) => {
    const xyz = surface ? grid((s as Surface3DSeries).data) : cloud((s as PointCloud3DSeries).data);
    const n = xyz.length / 3; count(offsets[i] + n); offsets.push(offsets[i] + n); chunks.push(xyz);
    const color: RgbaTuple = [...(parseOptionalColor(s.color) ?? palette[i % palette.length] ?? [0.2, 0.6, 1, 1])];
    names.push(s.name ?? `Series ${i + 1}`); swatches.push(color);
    const alpha = finite(s.opacity ?? 1, 'opacity', 0, 1) * color[3];
    const solid = () => { const c = new Float32Array(n * 4); for (let j = 0; j < n; j++) c.set([color[0], color[1], color[2], alpha], j * 4); return c; };
    if (surface) {
      const v = s as Surface3DSeries;
      shapes.push(v.data.columns, v.data.rows); styles.push(0, finite(v.lighting ?? 0.65, 'lighting', 0, 1), v.wireframe ? 1 : 0);
      colors.push(s.color !== undefined && !v.colormap ? solid() : rampColors(v.data.y, v.colormap ?? 'viridis', alpha, v.yMin, v.yMax));
      surfaces.push({ ...v, color: s.color === undefined ? undefined : color, data: { ...v.data, y: Float32Array.from(v.data.y) } });
    } else {
      const v = s as PointCloud3DSeries;
      shapes.push(0, 0); styles.push(finite(v.size ?? 3, 'size', 0, 1024), 0, 0);
      if (v.colorBy) {
        if (v.colorBy.values.length !== n) throw new Error('3D chart: color values length mismatch');
        colors.push(rampColors(v.colorBy.values, v.colorBy.colormap ?? 'viridis', alpha, v.colorBy.min, v.colorBy.max));
      } else colors.push(solid());
      clouds.push({ ...v, color, data: xyz, colorBy: v.colorBy ? { ...v.colorBy, values: Float64Array.from(v.colorBy.values) } : undefined });
    }
  });
  const concat = (chunks: Float32Array[], n: number) => { const out = new Float32Array(n); let at = 0; for (const a of chunks) { out.set(a, at); at += a.length; } return out; };
  const xyz = concat(chunks, offsets.at(-1)! * 3), rgba = concat(colors, offsets.at(-1)! * 4);
  const boundaries = Uint32Array.from(offsets), shape = Uint32Array.from(shapes);
  return { xyz, colors: rgba, offsets: boundaries, shapes: shape, styles: Float32Array.from(styles),
    meta: { kind: 'scientific3d', mode: surface ? 'surface3d' : 'pointCloud3d', names, colors: swatches, visible: series.map(s => s.visible !== false), xyz, pointColors: rgba, offsets: boundaries, shapes: shape,
      ...(surface ? { surfaces } : { clouds }) } };
}
export const encodePointCloud3D = (s: PointCloud3DSeries[], palette: RgbaTuple[]): EncodedScientific3D => encode(s, palette, false);
export const encodeSurface3D = (s: Surface3DSeries[], palette: RgbaTuple[]): EncodedScientific3D => encode(s, palette, true);

/** Prepare a single-series upload and a complete metadata commit, without mutating live state. */
function replacement(m: Scientific3DMeta, s: number, e: EncodedScientific3D): EncodedScientific3D {
  const before = m.offsets[s], after = m.offsets[s + 1], n = e.xyz.length / 3;
  const total = count(m.xyz.length / 3 - (after - before) + n);
  const splice = (old: Float32Array, chunk: Float32Array, stride: number) => {
    const out = new Float32Array(total * stride);
    out.set(old.subarray(0, before * stride)); out.set(chunk, before * stride);
    out.set(old.subarray(after * stride), (before + n) * stride);
    return out;
  };
  const offsets = m.offsets.slice(), shapes = m.shapes.slice();
  for (let i = s + 1; i < offsets.length; i++) offsets[i] += n - (after - before);
  shapes.set(e.shapes, s * 2);
  const clouds = m.clouds?.slice(), surfaces = m.surfaces?.slice();
  if (clouds) clouds[s] = e.meta.clouds![0];
  if (surfaces) surfaces[s] = e.meta.surfaces![0];
  return { ...e, meta: { ...m, xyz: splice(m.xyz, e.xyz, 3), pointColors: splice(m.pointColors, e.colors, 4), offsets, shapes, clouds, surfaces } };
}
function seriesIndex(m: Scientific3DMeta, s: number, mode: Scientific3DMeta['mode']): void {
  if (m.mode !== mode) throw new Error(`3D chart: ${mode} is not rendered`);
  if (!Number.isInteger(s) || s < 0 || s >= m.names.length) throw new Error('3D chart: series index out of range');
}
export function prepareCloudAppend(m: Scientific3DMeta, s: number, data: PointCloud3DData, options?: PointCloud3DAppendOptions): EncodedScientific3D {
  seriesIndex(m, s, 'pointCloud3d');
  const max = options?.maxPoints ?? 0;
  if (!Number.isSafeInteger(max) || max < 0 || max > MAX_SAMPLES) throw new Error('3D chart: invalid maxPoints');
  const source = m.clouds![s], incoming = cloud(data), old = source.data as Float32Array;
  const added = incoming.length / 3, len = count(Math.min(old.length / 3 + added, max || Infinity));
  if (source.colorBy ? options?.colorValues?.length !== added : options?.colorValues !== undefined) throw new Error('3D chart: color values must match appended points and the original colorBy mode');
  count(m.xyz.length / 3 - old.length / 3 + len);
  const xyz = new Float32Array(len * 3), oldKept = Math.max(0, len - added);
  xyz.set(old.subarray(old.length - oldKept * 3));
  xyz.set(incoming.subarray(Math.max(0, added - len) * 3), oldKept * 3);
  let colorBy = source.colorBy;
  if (colorBy) {
    const values = new Float64Array(len), previous = colorBy.values as Float64Array;
    values.set(previous.subarray(previous.length - oldKept));
    for (let i = oldKept; i < len; i++) values[i] = options!.colorValues![added - (len - i)];
    colorBy = { ...colorBy, values };
  }
  return replacement(m, s, encodePointCloud3D([{ ...source, data: xyz, colorBy }], [m.colors[s]]));
}
export function prepareSurfaceUpdate(m: Scientific3DMeta, s: number, update: Surface3DUpdate): EncodedScientific3D {
  seriesIndex(m, s, 'surface3d');
  const source = m.surfaces![s], d = source.data;
  let next: Surface3DSeries;
  if (update.mode === 'replaceY') {
    if (update.y.length !== d.columns * d.rows) throw new Error('3D chart: surface length mismatch');
    next = { ...source, yMin: update.yMin ?? source.yMin, yMax: update.yMax ?? source.yMax, data: { ...d, y: update.y } };
  } else if (update.mode === 'appendColumns' || update.mode === 'appendRows') {
    const column = update.mode === 'appendColumns';
    const added = count(column ? update.columns : update.rows);
    const oldSize = column ? d.columns : d.rows, cross = column ? d.rows : d.columns;
    if (count(added * cross) !== update.y.length) throw new Error('3D chart: surface append length mismatch');
    const scroll = column ? update.scrollX !== false : update.scrollZ !== false;
    const size = scroll ? oldSize : oldSize + added;
    const length = count(size * cross);
    count(m.xyz.length / 3 - d.columns * d.rows + length);
    const columns = column ? size : d.columns, rows = column ? d.rows : size;
    const dropped = scroll ? added : 0;
    const xStart = d.xStart + (column ? dropped * d.xStep : 0), zStart = d.zStart + (column ? 0 : dropped * d.zStep);
    finite(xStart, 'xStart'); finite(zStart, 'zStart');
    finite(xStart + (columns - 1) * d.xStep, 'x extent'); finite(zStart + (rows - 1) * d.zStep, 'z extent');
    const y = new Float32Array(length);
    for (let r = 0; r < rows; r++) for (let c = 0; c < columns; c++) {
      const at = (column ? c : r) + dropped;
      y[r * columns + c] = at < oldSize
        ? d.y[column ? r * d.columns + at : at * d.columns + c]
        : update.y[column ? (at - oldSize) * d.rows + r : (at - oldSize) * d.columns + c];
    }
    next = { ...source, data: { ...d, columns, rows, xStart, zStart, y } };
  } else throw new Error('3D chart: invalid surface update mode');
  return replacement(m, s, encodeSurface3D([next], [m.colors[s]]));
}
export function scientificSample(m: Scientific3DMeta, id: number): { series: number; index: number; point: Vec3Tuple; color: RgbaTuple } | null {
  if (!Number.isInteger(id) || id < 0 || id >= m.xyz.length / 3) return null;
  let s = 0; while (s + 1 < m.names.length && m.offsets[s + 1] <= id) s++;
  const point: Vec3Tuple = [m.xyz[id * 3], m.xyz[id * 3 + 1], m.xyz[id * 3 + 2]];
  if (!point.every(Number.isFinite)) return null;
  return { series: s, index: id - m.offsets[s], point, color: Array.from(m.pointColors.subarray(id * 4, id * 4 + 4)) as RgbaTuple };
}
export function scientificTooltip(m: Scientific3DMeta, id: number, details: NodeDetails | null, hit?: ArrayLike<number>): ChartTooltipContext | null {
  const p = scientificSample(m, id); if (!p) return null;
  if (!hit || hit.length < 5) hit = undefined;
  const xyz: Vec3Tuple = hit && hit.length >= 5 ? [hit[0], hit[1], hit[2]] : p.point;
  const cols = m.shapes[p.series * 2];
  return { chartType: m.mode, index: p.index, xLabel: m.names[p.series], point3d: { x: xyz[0], y: xyz[1], z: xyz[2],
    ...(cols ? { column: hit ? hit[3] : p.index % cols, row: hit ? hit[4] : Math.floor(p.index / cols) } : {}) },
    items: [{ seriesName: m.names[p.series], value: xyz[1], color: rgbCss(p.color), nodeId: id }], details };
}
export function scientificA11yModel(m: Scientific3DMeta, common: A11yCommon): A11yChartModel {
  const n = m.xyz.length / 3, label = m.mode === 'pointCloud3d' ? '3D point cloud' : '3D surface';
  const idOf = (f: A11yFocus) => m.offsets[f.series] + f.index;
  const focusOf = (id: number): A11yFocus | null => { const p = scientificSample(m, id); return p ? { series: p.series, index: p.index } : null; };
  const valid = (id: number) => { const p = scientificSample(m, id); return !!p && m.visible[p.series]; };
  return {
    kind: 'scientific3d', ...common, length: n,
    series: m.names.map((name, s) => ({ name, values: [], visible: m.visible[s], f32: true })),
    xValue: i => i, xLabel: i => String(i), formatX: String, pointId: (s, i) => m.offsets[s] + i,
    itemName: s => m.names[s], itemColor: s => m.colors[s],
    custom: {
      kindLabel: label, summary: () => `${common.title ? common.title + '. ' : ''}${label}, ${n} samples, ${m.names.length} series.`,
      description: () => ['Y-up coordinates. Nonfinite samples are gaps.'],
      help: 'Drag to orbit, right-drag to pan, wheel to zoom. Arrow keys navigate samples; Home/End move to the first/last sample.',
      step(focus, key) {
        if (!['Home', 'End', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown'].includes(key)) return null;
        const dir = ['End', 'ArrowLeft', 'ArrowUp', 'PageDown'].includes(key) ? -1 : 1;
        let id = !focus || key === 'Home' || key === 'End' ? key === 'End' ? n - 1 : 0 : Math.max(0, Math.min(n - 1, idOf(focus) + dir * (key.startsWith('Page') ? 10 : 1)));
        while (id >= 0 && id < n) { if (valid(id)) return focusOf(id); id += dir; }
        return focus && valid(idOf(focus)) ? focus : null;
      },
      announce(f) { const p = scientificSample(m, idOf(f)); return p ? `${m.names[p.series]}, X ${common.formatValue(p.point[0])}, Y ${common.formatValue(p.point[1])}, Z ${common.formatValue(p.point[2])}.` : ''; },
      hover(f) { const id = idOf(f), p = scientificSample(m, id); return p ? new Float64Array([0, 0, 1, p.series, p.index, p.point[1], id]) : undefined; },
      table(pick) {
        const rows = pick(n).map(id => { const p = scientificSample(m, id); return p ? [m.names[p.series], ...p.point] : ['', null, null, null]; });
        return { columns: ['Series', 'X', 'Y', 'Z'], rows, totalRows: n, sampled: rows.length < n };
      },
    },
  };
}
