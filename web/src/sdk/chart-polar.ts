/**
 * Polar coordinate system binding (ECharts `polar` + `angleAxis` / `radiusAxis`). The engine
 * owns the layout (polar.rs): axis scales and ticks, radial / ring bars (stacked, round caps),
 * lines (open / closed, smooth, area), scatter points, heatmap cells, grid circles / spokes,
 * hover hit test, legend toggle re-layout and label anchors. This module validates and encodes
 * the series, mirrors items / axes for tooltip and a11y, and places the axis labels.
 */
import { parseColor, parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { A11yChartModel, ChartDataTable } from './chart-a11y';
import type { ChartLegendOptions, ChartPaddingOptions, ChartTooltipContext, NodeMetadata, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { esc, overlayDiv, rgbCss, tooltipHeader, tooltipRow, type A11yCommon, type A11yCustomModel, type BusinessLabelLayer } from './chart-business-util';
import { bytesToRgba, HEATMAP_SCALE_CODES, type HeatmapColorbarOptions, type HeatmapColorScale } from './chart-heatmap';
import { formatCount, getMessages } from './i18n';

/** polar.rs limits */
const MAX_SERIES = 64;
const MAX_ITEMS = 200_000;
const MAX_CATEGORIES = 10_000;
/** Label `node` of radius tick `j` = `RADIUS_LABEL + j` (polar.rs `POLAR_RADIUS_LABEL`) */
const RADIUS_LABEL = 1 << 16;
/** Values per series / axis in `set_polar_chart` */
const SERIES_STRIDE = 9;
/** Average label glyph width (CSS px, 11 px text) */
const CHAR_PX = 6.8;
const DEG = Math.PI / 180;

export type PolarSeriesType = 'bar' | 'line' | 'scatter' | 'heatmap';
/** Coordinate on an axis: a value, or a category name / index (`null` = missing value). */
export type PolarCoord = number | string | null;

export interface PolarSeriesOptions {
  type: PolarSeriesType;
  name?: string;
  /**
   * Bar / line with exactly one category axis: one value per category (`null` = gap), or
   * `[radius, angle]` pairs. Scatter: `[radius, angle]`. Heatmap: `[radius, angle, value]`
   * cells. Category coordinates are names or indices.
   */
  data: ArrayLike<number | null> | ReadonlyArray<ReadonlyArray<PolarCoord>>;
  /** Series with the same stack name pile up (bar / line) */
  stack?: string;
  /** Own color (default: the palette); heatmap cells use the colormap */
  color?: ColorInput;
  /** Bar: rounded ends */
  roundCap?: boolean;
  /** Line: Catmull-Rom curve */
  smooth?: boolean;
  /** Line: filled toward the center */
  area?: boolean;
  /** Line: joins the last point to the first */
  closed?: boolean;
  /** Line / scatter marker diameter in CSS px (line default 0 = none) */
  symbolSize?: number;
  /** Line width in CSS px (default 2) */
  lineWidth?: number;
}

export interface PolarChartData {
  series: PolarSeriesOptions[];
}

export interface PolarAxisOptions {
  /** Default: `'category'` with `data`, else `'value'` */
  type?: 'category' | 'value';
  /** Category names (category axis) */
  data?: string[];
  /** Value axis bounds (default: nice data extent; the radius axis starts at 0) */
  min?: number;
  max?: number;
  /** Value axis tick count hint (default 5) */
  splitNumber?: number;
  /** Tick / category labels (default true) */
  labels?: boolean;
  /** Split circles (radius) / spokes (angle) (default true) */
  splitLine?: boolean;
  /** Tooltip / table / a11y name (default `'Angle'` / `'Radius'` in the chart locale) */
  name?: string;
}

export interface PolarChartOptions {
  angleAxis?: PolarAxisOptions;
  radiusAxis?: PolarAxisOptions;
  /** Where the angle axis starts, degrees clockwise from 12 o'clock (default 0) */
  startAngle?: number;
  /** Angle axis runs clockwise (default true) */
  clockwise?: boolean;
  /** Hole of the radius axis as a fraction of the outer radius, 0-0.9 (default 0) */
  innerRadius?: number;
  /** Gap between categories as a fraction of a category band, 0-0.95 (default 0.2) */
  barCategoryGap?: number;
  /** Gap between bars of a category as a fraction of a bar (default 0.3; negative overlaps) */
  barGap?: number;
  /** Series palette (default: the theme palette) */
  palette?: ColorInput[];
  /** Grid circles / spokes (default true) */
  showGrid?: boolean;
  legend?: ChartLegendOptions | boolean;
  /** Heatmap colormap as in `renderHeatmap` (default `'sequential'`) */
  colorScale?: HeatmapColorScale;
  color?: ColorInput;
  reverse?: boolean;
  /** Heatmap value domain (default: data extent) */
  min?: number;
  max?: number;
  center?: number;
  /** Heatmap cells without a value (default: the theme grid tone) */
  emptyColor?: ColorInput;
  /** Heatmap colorbar (default: shown with a heatmap series) */
  colorbar?: HeatmapColorbarOptions | boolean;
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  padding?: ChartPaddingOptions;
  /** Tooltip / table / colorbar name of heatmap values (default: `'Value'` in the chart locale) */
  valueLabel?: string;
  /** Value text of tooltip, labels and a11y (spec, Intl options or function; default: locale number) */
  format?: ChartValueFormat;
}

/** Hovered polar item. */
export interface ChartPolarTooltip {
  series: number;
  seriesName: string;
  type: PolarSeriesType;
  /** Item index in the series */
  index: number;
  /** Angle / radius coordinate text (category name or formatted value) */
  angle: string;
  radius: string;
  /** Heatmap: the cell value; else the value-axis coordinate (radius when both are values) */
  value: number;
}

/** Axis state the SDK mirrors (bounds / ticks from the engine). */
export interface PolarAxisMeta {
  /** Category names (null = value axis) */
  categories: string[] | null;
  lo: number;
  hi: number;
  /** Label values in label order: category index or tick value */
  ticks: number[];
  name: string;
  nameInput?: string;
}

/** Display state the SDK keeps for a polar chart. */
export interface PolarChartMeta {
  kind: 'polar';
  types: PolarSeriesType[];
  /** `[radius, angle, value]` per item, series after series */
  data: Float64Array;
  /** First item of each series, then the total */
  offsets: number[];
  /** Item value per global id (heatmap value, else the value coordinate) */
  values: Float64Array;
  /** Encoded engine options / series (`set_polar_chart`) */
  options: Float64Array;
  seriesInfo: Float64Array;
  angleAxis: PolarAxisMeta;
  radiusAxis: PolarAxisMeta;
  heat: boolean;
  names: string[];
  namesInput: (string | undefined)[];
  colors: RgbaTuple[];
  inputColors: (ColorInput | undefined)[];
  palette?: ColorInput[];
  visible: boolean[];
  colormap: { scale: HeatmapColorScale; color?: ColorInput; reverse: boolean; emptyColor?: ColorInput };
  domain: { min?: number; max?: number; center?: number };
  colorbar: { show: boolean; title: string; format?: (v: number) => string };
  colorbarTitleInput?: string;
  /** Displayed color of a heatmap value (engine colormap; set by `sendPolar`) */
  colorOf: (v: number) => RgbaTuple;
  /** Bumped when the axes are re-read (labels re-text without a new anchor revision) */
  axesRev: number;
  valueLabel: string;
  valueLabelInput?: string;
  format: (value: number) => string;
  locale?: string;
  engine?: { hover(series: number, index: number): Float64Array | undefined };
}

const TYPES: Record<PolarSeriesType, number> = { bar: 0, line: 1, scatter: 2, heatmap: 3 };

function axisMeta(o: PolarAxisOptions | undefined, which: string): PolarAxisMeta {
  const type = o?.type ?? (o?.data !== undefined ? 'category' : 'value');
  if (type !== 'category' && type !== 'value') throw new Error(`Polar ${which} axis type must be 'category' or 'value', got ${JSON.stringify(type)}`);
  let categories: string[] | null = null;
  if (type === 'category') {
    if (!Array.isArray(o?.data) || o.data.length < 1) throw new Error(`Polar ${which} category axis needs data (category names)`);
    if (o.data.length > MAX_CATEGORIES) throw new Error(`Polar ${which} axis supports at most ${MAX_CATEGORIES} categories, got ${o.data.length}`);
    categories = o.data.map((s) => String(s));
  } else {
    for (const v of [o?.min, o?.max]) if (v !== undefined && !Number.isFinite(v)) throw new Error(`Polar ${which} axis min / max must be finite, got ${v}`);
    if (o?.min !== undefined && o?.max !== undefined && !(o.min < o.max)) throw new Error(`Polar ${which} axis min must be below max, got ${o.min} >= ${o.max}`);
  }
  const split = o?.splitNumber;
  if (split !== undefined && !(Number.isFinite(split) && split >= 1 && split <= 100)) throw new Error(`Polar ${which} axis splitNumber must be from 1 to 100, got ${split}`);
  return { categories, lo: NaN, hi: NaN, ticks: [], name: '', nameInput: o?.name };
}

function encodeAxis(a: PolarAxisMeta, o: PolarAxisOptions | undefined): number[] {
  const value = a.categories === null;
  return [a.categories?.length ?? 0, value ? (o?.min ?? NaN) : NaN, value ? (o?.max ?? NaN) : NaN, Math.round(o?.splitNumber ?? 5), o?.labels === false ? 0 : 1, o?.splitLine === false ? 0 : 1];
}

/** Engine coordinate of `x` on an axis (category index, or value; null = NaN). */
function coord(x: unknown, axis: PolarAxisMeta, index: Map<string, number> | null, which: string, where: string): number {
  if (axis.categories) {
    const n = axis.categories.length;
    const i = typeof x === 'string' ? (index!.get(x) ?? -1) : typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n ? x : -2;
    if (i === -1) throw new Error(`Polar ${where}: unknown ${which} category ${JSON.stringify(x)}`);
    if (i < 0) throw new Error(`Polar ${where}: ${which} category index must be an integer in 0..${n}, got ${JSON.stringify(x)}`);
    return i;
  }
  if (x === null || x === undefined) return NaN;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`Polar ${where}: ${which} value must be a finite number (null = missing), got ${JSON.stringify(x === Infinity ? 'Infinity' : x)}`);
  return x;
}

function nameIndex(axis: PolarAxisMeta): Map<string, number> | null {
  if (!axis.categories) return null;
  const m = new Map<string, number>();
  axis.categories.forEach((s, i) => {
    if (!m.has(s)) m.set(s, i);
  });
  return m;
}

/** Builds the display meta (validates data and options; nothing is sent). */
export function polarMeta(data: PolarChartData, options: PolarChartOptions | undefined, format: (v: number) => string, locale?: string): PolarChartMeta {
  const o = options ?? {};
  const list = data && typeof data === 'object' ? (data as PolarChartData).series : undefined;
  if (!Array.isArray(list)) throw new Error('Polar chart data needs a series array');
  if (list.length < 1) throw new Error('Polar chart needs at least one series');
  if (list.length > MAX_SERIES) throw new Error(`Polar chart supports at most ${MAX_SERIES} series, got ${list.length}`);
  const angle = axisMeta(o.angleAxis, 'angle');
  const radius = axisMeta(o.radiusAxis, 'radius');
  const start = o.startAngle ?? 0;
  if (!Number.isFinite(start)) throw new Error(`Polar startAngle must be finite degrees, got ${start}`);
  const inner = o.innerRadius ?? 0;
  if (!(Number.isFinite(inner) && inner >= 0 && inner <= 0.9)) throw new Error(`Polar innerRadius must be from 0 to 0.9, got ${inner}`);
  const catGap = o.barCategoryGap ?? 0.2;
  if (!(Number.isFinite(catGap) && catGap >= 0 && catGap <= 0.95)) throw new Error(`Polar barCategoryGap must be from 0 to 0.95, got ${catGap}`);
  const barGap = o.barGap ?? 0.3;
  if (!(Number.isFinite(barGap) && barGap >= -1 && barGap <= 10)) throw new Error(`Polar barGap must be from -1 to 10, got ${barGap}`);
  const scale = o.colorScale ?? 'sequential';
  if (!(scale in HEATMAP_SCALE_CODES)) throw new Error(`Polar colorScale must be one of ${Object.keys(HEATMAP_SCALE_CODES).join(', ')}, got ${JSON.stringify(scale)}`);
  for (const v of [o.min, o.max, o.center]) if (v !== undefined && !Number.isFinite(v)) throw new Error(`Polar heatmap min / max / center must be finite, got ${v}`);
  const ac = angle.categories !== null;
  const rc = radius.categories !== null;
  // Value axis of number-only data: [radius, angle] index of the value (-1 = no single category axis)
  const valueAt = ac !== rc ? (ac ? 0 : 1) : -1;
  const [ai, ri] = [nameIndex(angle), nameIndex(radius)];
  const stacks = new Map<string, number>();
  const types: PolarSeriesType[] = [];
  const seriesInfo = new Float64Array(list.length * SERIES_STRIDE);
  const chunks: number[][] = [];
  let total = 0;
  list.forEach((s, k) => {
    const type = s?.type;
    if (!(typeof type === 'string' && type in TYPES)) throw new Error(`Polar series ${k} type must be one of ${Object.keys(TYPES).join(', ')}, got ${JSON.stringify(type)}`);
    if (type === 'bar' && valueAt < 0) throw new Error(`Polar bar series ${k} needs exactly one category axis (angle or radius)`);
    if (type === 'heatmap' && !(ac && rc)) throw new Error(`Polar heatmap series ${k} needs category angle and radius axes`);
    const items = s.data;
    if (!items || typeof items !== 'object' || typeof items.length !== 'number') throw new Error(`Polar series ${k} data must be an array`);
    total += items.length;
    if (total > MAX_ITEMS) throw new Error(`Polar chart supports at most ${MAX_ITEMS} items`);
    for (const [key, v] of [
      ['symbolSize', s.symbolSize],
      ['lineWidth', s.lineWidth],
    ] as const) {
      if (v !== undefined && !(Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error(`Polar series ${k} ${key} must be from 0 to 100 CSS px, got ${v}`);
    }
    if (s.stack !== undefined && typeof s.stack !== 'string') throw new Error(`Polar series ${k} stack must be a string`);
    const out: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const d = (items as ArrayLike<unknown>)[i];
      const where = `series ${k} item ${i}`;
      if (Array.isArray(d)) {
        if (d.length < (type === 'heatmap' ? 3 : 2)) throw new Error(`Polar ${where} must be ${type === 'heatmap' ? '[radius, angle, value]' : '[radius, angle]'}, got ${d.length} values`);
        const r = coord(d[0], radius, ri, 'radius', where);
        const a = coord(d[1], angle, ai, 'angle', where);
        let v = NaN;
        if (type === 'heatmap' && d[2] !== null && d[2] !== undefined) {
          if (typeof d[2] !== 'number' || !Number.isFinite(d[2])) throw new Error(`Polar ${where}: heatmap value must be finite (null = empty), got ${JSON.stringify(d[2])}`);
          v = d[2];
        }
        out.push(r, a, v);
        continue;
      }
      if (type === 'heatmap' || type === 'scatter' || valueAt < 0) {
        throw new Error(`Polar ${where} must be a [radius, angle] pair${type === 'heatmap' ? ' with a value' : ''} (plain values need exactly one category axis)`);
      }
      const cats = (valueAt === 0 ? angle : radius).categories!;
      if (i >= cats.length) throw new Error(`Polar series ${k} has ${items.length} values but the ${valueAt === 0 ? 'angle' : 'radius'} axis has ${cats.length} categories`);
      if (d !== null && d !== undefined && !(typeof d === 'number' && Number.isFinite(d))) throw new Error(`Polar ${where}: value must be finite (null = missing), got ${String(d)}`);
      const v = d === null || d === undefined ? NaN : (d as number);
      out.push(valueAt === 0 ? v : i, valueAt === 0 ? i : v, NaN);
    }
    chunks.push(out);
    types.push(type);
    let stack = -1;
    if (s.stack !== undefined) {
      if (!stacks.has(s.stack)) stacks.set(s.stack, stacks.size);
      stack = stacks.get(s.stack)!;
    }
    seriesInfo.set(
      [TYPES[type], stack, s.roundCap ? 1 : 0, s.smooth ? 1 : 0, s.area ? 1 : 0, s.closed ? 1 : 0, s.symbolSize ?? NaN, s.lineWidth ?? NaN, items.length],
      k * SERIES_STRIDE
    );
  });
  const flat = new Float64Array(total * 3);
  const offsets = [0];
  chunks.forEach((c) => {
    flat.set(c, offsets[offsets.length - 1] * 3);
    offsets.push(offsets[offsets.length - 1] + c.length / 3);
  });
  const values = new Float64Array(total);
  types.forEach((t, k) => {
    for (let g = offsets[k]; g < offsets[k + 1]; g++) values[g] = t === 'heatmap' ? flat[g * 3 + 2] : flat[g * 3 + (valueAt < 0 ? 0 : valueAt)];
  });
  const heat = types.includes('heatmap');
  const bar = typeof o.colorbar === 'boolean' ? { show: o.colorbar } : (o.colorbar ?? {});
  const meta: PolarChartMeta = {
    kind: 'polar',
    types,
    data: flat,
    offsets,
    values,
    options: new Float64Array(19),
    seriesInfo,
    angleAxis: angle,
    radiusAxis: radius,
    heat,
    names: [],
    namesInput: list.map((s) => (s.name === undefined ? undefined : String(s.name))),
    colors: [],
    inputColors: list.map((s) => s.color),
    palette: o.palette,
    visible: new Array<boolean>(list.length).fill(true),
    colormap: { scale, color: o.color, reverse: o.reverse ?? false, emptyColor: o.emptyColor },
    domain: { min: o.min, max: o.max, center: o.center },
    colorbar: { show: heat && (bar.show ?? true), title: '', format: bar.format },
    colorbarTitleInput: bar.title,
    colorOf: () => [0.5, 0.5, 0.5, 1],
    axesRev: 0,
    valueLabel: '',
    valueLabelInput: o.valueLabel,
    format,
  };
  if (o.palette !== undefined && !Array.isArray(o.palette)) throw new Error('Polar palette must be an array of colors');
  // Parse every color now: sendPolarStyle runs after the current chart is cleared
  for (const c of [...meta.inputColors, ...(meta.palette ?? []), o.color, o.emptyColor]) if (c !== undefined) parseOptionalColor(c);
  localizePolarMeta(meta, locale);
  // Room for the longest angle label outside the rim (the engine thins colliding labels)
  const labels = o.angleAxis?.labels !== false;
  const longest = angle.categories ? Math.max(0, ...angle.categories.map((s) => s.length)) : 6;
  const room = labels ? Math.min(160, Math.max(24, Math.ceil(longest * CHAR_PX) + 6)) : 0;
  meta.options.set([
    // One turn: the engine works in f32, where a huge angle loses its fraction
    (((start % 360) + 360) % 360) * DEG,
    o.clockwise === false ? 0 : 1,
    inner,
    catGap,
    barGap,
    room,
    14,
    ...encodeAxis(angle, o.angleAxis),
    ...encodeAxis(radius, o.radiusAxis),
  ]);
  return meta;
}

/** Default series / axis names, value label and colorbar title in `locale` (options win). */
export function localizePolarMeta(meta: PolarChartMeta, locale: string | undefined): void {
  const { common: cm, polar: pm } = getMessages(locale);
  meta.locale = locale;
  meta.names = meta.namesInput.map((s, i) => s ?? pm.seriesName(i + 1));
  meta.angleAxis.name = meta.angleAxis.nameInput ?? pm.angle;
  meta.radiusAxis.name = meta.radiusAxis.nameInput ?? pm.radius;
  meta.valueLabel = meta.valueLabelInput ?? cm.value;
  meta.colorbar.title = meta.colorbarTitleInput ?? meta.valueLabel;
}

/** Uploads the polar chart (`set_polar_chart`), its colors / colormap and the axes mirror. */
export function sendPolar(backend: WasmCharturboEngineBackend, meta: PolarChartMeta, theme: CharturboTheme): number {
  const n = backend.set_polar_chart?.(meta.options, meta.seriesInfo, meta.data) ?? 0;
  if (meta.heat) {
    const d = meta.domain;
    backend.set_chart_heatmap_domain?.(d.min ?? NaN, d.max ?? NaN, d.center ?? NaN);
  }
  sendPolarStyle(backend, meta, theme);
  meta.colorOf = (v) => bytesToRgba(backend.chart_heatmap_color?.(v));
  syncPolar(backend, meta);
  return n;
}

/** Series palette / own colors, theme surface (dimmed series) and the heatmap colormap. */
export function sendPolarStyle(backend: WasmCharturboEngineBackend, meta: PolarChartMeta, theme: CharturboTheme): void {
  const own = (meta.palette ?? []).map((c) => parseOptionalColor(c)).filter((c): c is RgbaTuple => !!c);
  const pal = own.length ? own : theme.palette;
  const palette = new Float32Array(pal.length * 4);
  pal.forEach((c, k) => palette.set(c, k * 4));
  const n = meta.types.length;
  const colors = new Float32Array(n * 4).fill(NaN);
  meta.inputColors.forEach((c, i) => {
    const rgba = c === undefined ? undefined : parseOptionalColor(c);
    if (rgba) colors.set(rgba, i * 4);
  });
  const highlight = parseOptionalColor(theme.textPrimary) ?? [1, 1, 1, 1];
  backend.set_chart_hierarchy_style?.(palette, colors, Float32Array.from(theme.baseline), Float32Array.from(theme.surface), Float32Array.from(highlight), 0);
  const c = backend.chart_hierarchy_colors?.();
  meta.colors = Array.from({ length: n }, (_, i): RgbaTuple =>
    c && c.length >= (i + 1) * 4 ? [c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3]] : (parseOptionalColor(meta.inputColors[i]) ?? pal[i % pal.length])
  );
  if (!meta.heat) return;
  const m = meta.colormap;
  backend.set_chart_heatmap_colormap?.(
    HEATMAP_SCALE_CODES[m.scale] ?? 0,
    m.color !== undefined ? Float32Array.from(parseColor(m.color)) : new Float32Array(0),
    m.reverse,
    Float32Array.from(theme.surface),
    Float32Array.from(parseOptionalColor(m.emptyColor) ?? theme.grid)
  );
}

/** Re-reads the resolved axes (bounds and label values; after a legend toggle). */
export function syncPolar(backend: WasmCharturboEngineBackend, meta: PolarChartMeta): void {
  const a = backend.chart_polar_axes?.();
  if (!a || a.length < 8) return;
  const na = a[6];
  const nr = a[7 + na];
  if (!(na >= 0 && nr >= 0 && a.length >= 8 + na + nr)) return;
  Object.assign(meta.angleAxis, { lo: a[0], hi: a[1], ticks: Array.from(a.subarray(7, 7 + na)) });
  Object.assign(meta.radiusAxis, { lo: a[3], hi: a[4], ticks: Array.from(a.subarray(8 + na, 8 + na + nr)) });
  meta.axesRev++;
}

/** Text of coordinate `v` on `axis` (category name or formatted value). */
function coordText(axis: PolarAxisMeta, v: number, format: (v: number) => string): string {
  return axis.categories ? (axis.categories[v] ?? '') : format(v);
}

/** Series and index of global id `g` (null when out of range). */
function locate(meta: PolarChartMeta, g: number): { series: number; index: number } | null {
  const o = meta.offsets;
  if (!Number.isInteger(g) || g < 0 || g >= o[o.length - 1]) return null;
  let s = 0;
  while (o[s + 1] <= g) s++;
  return { series: s, index: g - o[s] };
}

/** Global id of `(series, index)` (-1 when out of range). */
function globalId(meta: PolarChartMeta, s: number, i: number): number {
  const o = meta.offsets;
  return s >= 0 && s < o.length - 1 && i >= 0 && o[s] + i < o[s + 1] ? o[s] + i : -1;
}

/** `Series · category` label of item `g` (both axes categories: `angle / radius`; no category axis: its position). */
function itemLabel(meta: PolarChartMeta, s: number, g: number, format: (v: number) => string): string {
  const parts: string[] = [];
  if (meta.angleAxis.categories) parts.push(coordText(meta.angleAxis, meta.data[g * 3 + 1], format));
  if (meta.radiusAxis.categories) parts.push(coordText(meta.radiusAxis, meta.data[g * 3], format));
  return `${meta.names[s] ?? ''} · ${parts.length ? parts.join(' / ') : String(g - meta.offsets[s] + 1)}`;
}

function itemColor(meta: PolarChartMeta, s: number, g: number): RgbaTuple {
  return meta.types[s] === 'heatmap' ? meta.colorOf(meta.values[g]) : (meta.colors[s] ?? [0.5, 0.5, 0.5, 1]);
}

/** Tooltip of an engine hit `[.., series, index, value, id]`. */
export function polarTooltipContext(meta: PolarChartMeta, hit: ArrayLike<number>, details: (id: number) => ChartTooltipContext['details']): ChartTooltipContext | null {
  const [series, index, value, id] = [hit[3], hit[4], hit[5], hit[6]];
  const g = globalId(meta, series, index);
  if (g < 0) return null;
  const name = meta.names[series];
  const angle = coordText(meta.angleAxis, meta.data[g * 3 + 1], meta.format);
  const radius = coordText(meta.radiusAxis, meta.data[g * 3], meta.format);
  return {
    chartType: 'polar',
    index,
    xLabel: itemLabel(meta, series, g, meta.format),
    items: [{ seriesName: name, value, color: rgbCss(itemColor(meta, series, g)), nodeId: id }],
    polar: { series, seriesName: name, type: meta.types[series], index, angle, radius, value },
    details: details(id),
  };
}

export function polarTooltipHtml(ctx: ChartTooltipContext, meta: PolarChartMeta, theme: CharturboTheme, formatValue: (v: number) => string): string {
  const p = ctx.polar;
  if (!p) return '';
  const color = ctx.items[0]?.color;
  const heat = p.type === 'heatmap' ? tooltipRow(theme, meta.valueLabel, esc(formatValue(p.value)), color) : '';
  return `${tooltipHeader(theme, p.seriesName)}${tooltipRow(theme, meta.angleAxis.name, esc(p.angle), p.type === 'heatmap' ? undefined : color)}${tooltipRow(theme, meta.radiusAxis.name, esc(p.radius))}${heat}`;
}

/** Point details: id = series offset + item index. */
export function polarPointMetadata(meta: PolarChartMeta, id: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  const at = locate(meta, id);
  if (!at) return null;
  const s = at.series;
  const cell = (axis: PolarAxisMeta, v: number) => (axis.categories ? (axis.categories[v] ?? '') : v);
  return {
    series: s,
    color: itemColor(meta, s, id),
    metadata: {
      label: itemLabel(meta, s, id, meta.format),
      category: meta.names[s],
      tags: ['polar', meta.types[s], ...(meta.visible[s] ? [] : ['hidden'])],
      attributes: {
        angle: cell(meta.angleAxis, meta.data[id * 3 + 1]),
        radius: cell(meta.radiusAxis, meta.data[id * 3]),
        value: meta.values[id],
        type: meta.types[s],
      },
    },
  };
}

/**
 * A11y model: one a11y series per polar series (items in input order); Left / Right step
 * within a series, Up / Down change to the previous / next visible series at the same index.
 * The table lists every item: series, angle, radius (and the heatmap value).
 */
export function polarA11yModel(meta: PolarChartMeta, c: A11yCommon): A11yChartModel {
  const f = c.formatValue;
  const locale = c.locale ?? meta.locale;
  const { common: cm, business: bm, polar: pm } = getMessages(locale);
  const num = (v: number) => formatCount(v, locale);
  const n = meta.types.length;
  const len = (s: number) => meta.offsets[s + 1] - meta.offsets[s];
  const total = meta.offsets[n];
  const text = (axis: PolarAxisMeta, v: number) => coordText(axis, v, f);
  const axisText = (axis: PolarAxisMeta) => (axis.categories ? pm.categories(axis.categories.length, num(axis.categories.length)) : pm.range(f(axis.lo), f(axis.hi)));
  const typeName = (s: number) => pm.type[meta.types[s]];
  const pairs = (s: number, g: number) => {
    const out = [pm.pair(meta.angleAxis.name, text(meta.angleAxis, meta.data[g * 3 + 1])), pm.pair(meta.radiusAxis.name, text(meta.radiusAxis, meta.data[g * 3]))];
    if (meta.types[s] === 'heatmap') out.push(pm.pair(meta.valueLabel, f(meta.values[g])));
    return out.join(cm.listSeparator);
  };
  const shownSeries = () => meta.visible.map((v, s) => (v && len(s) > 0 ? s : -1)).filter((s) => s >= 0);
  const custom: A11yCustomModel = {
    kindLabel: cm.kind.polar,
    xHeader: cm.series,
    summary: () => {
      const shown = meta.visible.filter(Boolean).length;
      const t = pm.summary(cm.kind.polar, cm.seriesCount(shown, num(shown)), axisText(meta.angleAxis), axisText(meta.radiusAxis));
      return c.title ? bm.titled(c.title, t) : t;
    },
    description: () =>
      meta.names.slice(0, 30).map((name, s) => {
        if (!meta.visible[s]) return pm.seriesHidden(name, typeName(s));
        let [lo, hi, count] = [Infinity, -Infinity, 0];
        for (let g = meta.offsets[s]; g < meta.offsets[s + 1]; g++) {
          const v = meta.values[g];
          if (!Number.isFinite(v)) continue;
          count++;
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        return pm.seriesText(name, typeName(s), cm.items(count, num(count)), count ? pm.range(f(lo), f(hi)) : null);
      }),
    help: pm.help,
    announce: (focus) => {
      const g = globalId(meta, focus.series, focus.index);
      if (g < 0) return '';
      return pm.announce(meta.names[focus.series] ?? '', pairs(focus.series, g), cm.position(num(focus.index + 1), num(len(focus.series))));
    },
    step: (focus, key) => {
      const order = shownSeries();
      if (!order.length) return null;
      if (!focus || !order.includes(focus.series)) {
        const s = order[0];
        return { series: s, index: key === 'End' ? len(s) - 1 : 0 };
      }
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const at = order.indexOf(focus.series) + (key === 'ArrowDown' ? 1 : -1);
        if (at < 0 || at >= order.length) return focus;
        const s = order[at];
        return { series: s, index: Math.min(focus.index, len(s) - 1) };
      }
      const count = len(focus.series);
      const i = focus.index;
      const next =
        key === 'ArrowLeft' ? i - 1
        : key === 'ArrowRight' ? i + 1
        : key === 'PageUp' ? i - 10
        : key === 'PageDown' ? i + 10
        : key === 'Home' ? 0
        : key === 'End' ? count - 1
        : i;
      return { series: focus.series, index: Math.max(0, Math.min(count - 1, next)) };
    },
    table: (pick): ChartDataTable => {
      const cell = (axis: PolarAxisMeta, v: number) => (axis.categories ? (axis.categories[v] ?? '') : Number.isFinite(v) ? v : '');
      const rows = pick(total).map((g) => {
        const s = locate(meta, g)!.series;
        const row: (string | number)[] = [meta.names[s] ?? '', cell(meta.angleAxis, meta.data[g * 3 + 1]), cell(meta.radiusAxis, meta.data[g * 3])];
        if (meta.heat) row.push(meta.types[s] === 'heatmap' && Number.isFinite(meta.values[g]) ? meta.values[g] : '');
        return row;
      });
      const columns = [cm.series, meta.angleAxis.name, meta.radiusAxis.name, ...(meta.heat ? [meta.valueLabel] : [])];
      return { columns, rows, totalRows: total, sampled: rows.length < total };
    },
    hover: (focus) => (globalId(meta, focus.series, focus.index) >= 0 ? meta.engine?.hover(focus.series, focus.index) : undefined),
  };
  const xName = (i: number) => String(i + 1);
  return {
    kind: 'polar',
    ...c,
    locale,
    series: meta.names.map((name, s) => ({ name, values: meta.values.subarray(meta.offsets[s], meta.offsets[s + 1]), visible: meta.visible[s], f32: false })),
    length: Math.max(0, ...meta.names.map((_, s) => len(s))),
    custom,
    xValue: xName,
    xLabel: xName,
    formatX: xName,
    pointId: (s, i) => globalId(meta, s, i),
    itemName: (s, i) => {
      const g = globalId(meta, s, i);
      return g < 0 ? '' : itemLabel(meta, s, g, f);
    },
    itemColor: (s, i) => {
      const g = globalId(meta, s, i);
      return g < 0 ? [0.5, 0.5, 0.5, 1] : itemColor(meta, s, g);
    },
  };
}

/** Text cut to `px` CSS px with an ellipsis. */
function fitText(text: string, px: number): string {
  const max = Math.floor(px / CHAR_PX);
  if (text.length <= max) return text;
  return max < 2 ? '' : `${text.slice(0, max - 1)}…`;
}

/**
 * DOM axis labels at the engine anchors (`chart_hierarchy_labels`: node, x, y, rotation rad,
 * room px, flags 1 = text starts at the anchor, -1 = ends there, 2 = centered above, 3 =
 * centered below). Node `j` = angle label `j`, `RADIUS_LABEL + j` = radius label `j`.
 */
export class PolarLabelLayer implements BusinessLabelLayer {
  private readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private key = '';

  constructor(
    parent: HTMLElement,
    private readonly meta: PolarChartMeta
  ) {
    this.root = overlayDiv('charturbo-sdk-polar-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

  invalidate(): void {
    this.key = '';
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, locale?: string): void {
    const a = backend.chart_hierarchy_labels?.();
    if (!a || a.length < 2) return;
    // Tick values change with a legend toggle even when the anchors do not
    const key = `${a[0]}|${this.meta.axesRev}|${theme.name}|${locale ?? ''}`;
    if (key === this.key) return;
    this.key = key;
    const count = Math.min(a[1], Math.floor((a.length - 2) / 6));
    let used = 0;
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 6;
      const [node, x, y, rot, room, flags] = [a[at], a[at + 1], a[at + 2], a[at + 3], a[at + 4], a[at + 5]];
      const radial = node >= RADIUS_LABEL;
      const axis = radial ? this.meta.radiusAxis : this.meta.angleAxis;
      const v = axis.ticks[radial ? node - RADIUS_LABEL : node];
      if (v === undefined) continue;
      // Radius labels sit inside the plot: no rim room limits them
      const text = fitText(coordText(axis, v, this.meta.format), radial ? Math.max(room, 96) : room + 0.5);
      if (!text) continue;
      let el = this.labels[used];
      if (!el) {
        el = overlayDiv('charturbo-sdk-polar-label', { fontSize: '11px', lineHeight: '14px', transformOrigin: '0 0' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      used++;
      const shift = flags === 2 ? 'translate(-50%, -100%)' : flags === 3 ? 'translate(-50%, 0)' : `translate(${flags < 0 ? '-100%' : '0'}, -50%)`;
      Object.assign(el.style, {
        display: 'block',
        left: `${x}px`,
        top: `${y}px`,
        color: theme.textSecondary,
        transform: rot ? `rotate(${rot.toFixed(4)}rad) ${shift}` : shift,
      });
      el.textContent = text;
    }
    for (let k = used; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
