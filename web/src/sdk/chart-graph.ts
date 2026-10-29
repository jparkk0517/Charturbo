/**
 * 2D graph (ECharts `graph`) bindings. The engine owns the layout (graph2d.rs: force-directed in
 * the plane on the shared CPU simulator, circular by value, given positions, or value axes),
 * edges (width, curveness, arrows), category colors and legend fades, hover adjacency, hit-testing
 * and label anchors that do not overlap. This module resolves the input (link ends by id / name /
 * index, categories by name / index, x axis categories), validates it before anything is
 * replaced, mirrors names / values / adjacency for the tooltip, a11y model and data table, and
 * places DOM labels at the engine anchors (`TreeLabelLayer`).
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { A11yChartModel, ChartDataCell } from './chart-a11y';
import type { A11yCommon } from './chart-business-util';
import { nameEngineError, type A11yCustom, type ChartHierarchyTooltip, type HierarchyChartOptions } from './chart-hierarchy';
import type { ChartFormatSpec } from './chart-format';
import type { ChartLegendOptions, ChartTooltipContext, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { formatCount, getMessages } from './i18n';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GraphNodeInput {
  /** Link end key (default: the name, then the index) */
  id?: string | number;
  name?: string;
  /** Node value (tooltip, circular slice size, `symbolSize: [min, max]`) */
  value?: number;
  /** Layout `'none'` / `'cartesian'` position (required there); force: start position (`fixed`: kept) */
  x?: number | string;
  y?: number;
  /** Category index or name (names missing from `categories` are appended) */
  category?: number | string;
  /** Symbol diameter in CSS px (overrides `symbolSize`) */
  symbolSize?: number;
  /** Force layout: stay at `x` / `y` */
  fixed?: boolean;
  color?: ColorInput;
}

export interface GraphLinkInput {
  /** Node `id`, `name`, or index */
  source: string | number;
  target: string | number;
  value?: number;
  /** Width in CSS px (default `lineWidth`) */
  lineWidth?: number;
}

export interface GraphCategoryInput {
  name: string;
  color?: ColorInput;
}

export interface GraphChartData {
  nodes: GraphNodeInput[];
  links?: GraphLinkInput[];
  /** Alias of `links` (ECharts) */
  edges?: GraphLinkInput[];
  categories?: (GraphCategoryInput | string)[];
}

export interface GraphAxisOptions {
  /** Range ends (default: nice bounds of the data) */
  min?: number;
  max?: number;
  title?: string;
  format?: ChartFormatSpec;
  /** x only: category axis (nodes give `x` as a name or index) */
  categories?: string[];
}

export interface GraphChartOptions extends Pick<HierarchyChartOptions, 'title' | 'description' | 'colors' | 'format' | 'labels' | 'padding' | 'valueLabel'> {
  /** `'force'` (default), `'circular'`, `'none'` (given x / y), `'cartesian'` (x / y on value axes) */
  layout?: 'force' | 'circular' | 'none' | 'cartesian';
  force?: { repulsion?: number; edgeLength?: number; gravity?: number; iterations?: number };
  /** Circular: labels run outward along the radius */
  rotateLabel?: boolean;
  symbol?: 'circle' | 'rect' | 'diamond' | 'triangle';
  /** Diameter in CSS px (default 10), or `[min, max]` scaled linearly by value */
  symbolSize?: number | [number, number];
  /** Edge width in CSS px (default 1) */
  lineWidth?: number;
  /** Edge bend 0-1 (default 0: straight) */
  curveness?: number;
  /** `'arrow'`: arrowheads at the targets */
  edgeSymbol?: 'none' | 'arrow';
  /** Arrow length in CSS px (default 8) */
  edgeSymbolSize?: number;
  /** Edge color: neutral (default), the source node's or the target node's */
  edgeColor?: 'neutral' | 'source' | 'target';
  edgeOpacity?: number;
  xAxis?: GraphAxisOptions;
  yAxis?: Omit<GraphAxisOptions, 'categories'>;
  /** Category legend (default: shown with categories); click toggles, hover emphasizes */
  legend?: ChartLegendOptions | boolean;
}

/** Display state of a 2D graph (names, values, adjacency mirror the input). */
export interface GraphChartMeta {
  kind: 'graph';
  /** Category names (legend) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  nodeNames: string[];
  ids: (string | number | undefined)[];
  /** Input value per node (NaN = none) */
  values: Float64Array;
  /** Category per node (-1 = none) */
  categories: Int32Array;
  sources: Uint32Array;
  targets: Uint32Array;
  /** Linked nodes per node (ascending, unique) */
  neighbours: number[][];
  /** Incident links per node */
  degree: Int32Array;
  nodeColors: Float32Array;
  inputColors: (ColorInput | undefined)[];
  categoryColors: (ColorInput | undefined)[];
  palette?: ColorInput[];
  valueLabel: string;
  labels: boolean;
  layout: NonNullable<GraphChartOptions['layout']>;
  xCategories?: string[];
  labelOptions: { valueLabel?: string; defaultCategories: boolean };
  engine?: { hover(series: number, index: number): Float64Array | undefined };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/** Validated input, ready for `set_graph_chart`. */
export interface EncodedGraph {
  names: string[];
  ids: (string | number | undefined)[];
  values: Float64Array;
  x: Float64Array;
  y: Float64Array;
  categories: Int32Array;
  categoryNames: string[];
  categoryColors: (ColorInput | undefined)[];
  defaultCategories: boolean;
  sizes: Float32Array;
  fixed: Uint8Array;
  sources: Uint32Array;
  targets: Uint32Array;
  widths: Float32Array;
  labelPx: Float32Array;
  inputColors: (ColorInput | undefined)[];
  options: Float64Array;
  layout: NonNullable<GraphChartOptions['layout']>;
  xCategories?: string[];
  labels: boolean;
}

const LAYOUT: Record<string, number> = { force: 0, circular: 1, none: 2, cartesian: 3 };
const SYMBOL: Record<string, number> = { circle: 0, rect: 1, diamond: 2, triangle: 3 };
const EDGE_COLOR: Record<string, number> = { neutral: 0, source: 1, target: 2 };
const opt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
/** Label width estimate of 11 px UI text (matches `fitText`) */
const CHAR_PX = 6.8;
const MAX_LABEL_PX = 160;
/** Engine limits of `set_graph_chart` (category count, x axis categories) */
const MAX_CATEGORIES = 1 << 16;
const MAX_X_CATEGORIES = 1 << 20;

/**
 * Resolves and validates graph input (throws with the node / link named; nothing is sent).
 * Called before the current chart is cleared, so an invalid call keeps it.
 */
export function encodeGraph(data: GraphChartData, options?: GraphChartOptions, locale?: string): EncodedGraph {
  const o = options ?? {};
  const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
  const n = nodes.length;
  if (n === 0) throw new Error('graph needs at least one node');
  const layout = o.layout && o.layout in LAYOUT ? o.layout : 'force';
  const msg = getMessages(locale).graph;
  const names = nodes.map((d, i) => (d?.name !== undefined ? String(d.name) : d?.id !== undefined ? String(d.id) : getMessages(locale).common.itemName(i + 1)));
  const who = (i: number) => `node ${i} ("${names[i]}")`;

  // Categories: given list, then names first seen on nodes
  const given = Array.isArray(data.categories) ? data.categories : [];
  const categoryNames = given.map((c) => (typeof c === 'string' ? c : String(c?.name ?? '')));
  const categoryColors = given.map((c) => (typeof c === 'string' ? undefined : c?.color));
  const byCategory = new Map(categoryNames.map((c, k) => [c, k]));
  const categories = new Int32Array(n).fill(-1);
  let maxIndex = -1;
  nodes.forEach((d, i) => {
    const c = d?.category;
    if (c === undefined || c === null) return;
    if (typeof c === 'string') {
      let k = byCategory.get(c);
      if (k === undefined) {
        k = categoryNames.length;
        byCategory.set(c, k);
        categoryNames.push(c);
        categoryColors.push(undefined);
      }
      categories[i] = k;
      return;
    }
    if (!Number.isInteger(c) || c < 0) throw new Error(`${who(i)}: category ${String(c)} is not a category index or name`);
    if (given.length && c >= given.length) throw new Error(`${who(i)}: category ${c} out of range (${given.length} categories)`);
    categories[i] = c;
    maxIndex = Math.max(maxIndex, c);
  });
  // Numeric categories without a list: default names
  const defaultCategories = !given.length && maxIndex >= 0;
  if (defaultCategories && byCategory.size) {
    throw new Error('graph categories: use either names or indices when `categories` is not given');
  }
  // Engine caps (`set_graph_chart`): refuse here, before the scene is cleared
  const categoryCount = Math.max(categoryNames.length, maxIndex + 1);
  if (categoryCount > MAX_CATEGORIES) throw new Error(`graph: too many categories (${categoryCount}, at most ${MAX_CATEGORIES})`);
  for (let k = categoryNames.length; k <= maxIndex; k++) {
    categoryNames.push(msg.categoryName(k + 1));
    categoryColors.push(undefined);
  }

  const xCats = layout === 'cartesian' && Array.isArray(o.xAxis?.categories) ? o.xAxis.categories.map(String) : undefined;
  if (xCats && xCats.length > MAX_X_CATEGORIES) throw new Error(`graph: too many x axis categories (${xCats.length}, at most ${MAX_X_CATEGORIES})`);
  const values = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const sizes = new Float32Array(n).fill(NaN);
  const fixed = new Uint8Array(n);
  const needXY = layout === 'none' || layout === 'cartesian';
  nodes.forEach((d, i) => {
    const v = d?.value;
    if (typeof v === 'number' && !Number.isNaN(v) && !Number.isFinite(v)) throw new Error(`${who(i)}: value is not finite`);
    values[i] = opt(v);
    let xv = d?.x;
    if (typeof xv === 'string') {
      const k = xCats ? xCats.indexOf(xv) : -1;
      if (k < 0) throw new Error(`${who(i)}: x "${xv}" is not an x axis category`);
      xv = k;
    }
    for (const [axis, raw, out] of [
      ['x', xv, x],
      ['y', d?.y, y],
    ] as const) {
      if (typeof raw === 'number' && !Number.isNaN(raw) && !Number.isFinite(raw)) throw new Error(`${who(i)}: ${axis} is not finite`);
      out[i] = opt(raw);
    }
    if (needXY && (Number.isNaN(x[i]) || Number.isNaN(y[i]))) throw new Error(`${who(i)}: layout "${layout}" needs x and y`);
    if (xCats && (x[i] < 0 || x[i] > xCats.length - 1)) throw new Error(`${who(i)}: x ${x[i]} is outside the ${xCats.length} x axis categories`);
    fixed[i] = d?.fixed ? 1 : 0;
  });

  // Sizes: per node, else `symbolSize` (a number, or [min, max] by value)
  const ss = o.symbolSize;
  if (Array.isArray(ss) && ss.length === 2 && ss.every((s) => Number.isFinite(s))) {
    let lo = Infinity;
    let hi = -Infinity;
    values.forEach((v) => {
      if (Number.isFinite(v)) {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
    });
    values.forEach((v, i) => {
      sizes[i] = !Number.isFinite(v) ? ss[0] : hi > lo ? ss[0] + ((v - lo) / (hi - lo)) * (ss[1] - ss[0]) : (ss[0] + ss[1]) / 2;
    });
  } else if (typeof ss === 'number' && Number.isFinite(ss)) {
    sizes.fill(ss);
  }
  nodes.forEach((d, i) => {
    if (typeof d?.symbolSize === 'number' && Number.isFinite(d.symbolSize)) sizes[i] = d.symbolSize;
  });

  // Link ends: id, then name, then index
  const byId = new Map<string, number>();
  const byName = new Map<string, number>();
  nodes.forEach((d, i) => {
    if (d?.id !== undefined && !byId.has(String(d.id))) byId.set(String(d.id), i);
    if (!byName.has(names[i])) byName.set(names[i], i);
  });
  const links = Array.isArray(data.links) ? data.links : Array.isArray(data.edges) ? data.edges : [];
  const sources = new Uint32Array(links.length);
  const targets = new Uint32Array(links.length);
  const widths = new Float32Array(links.length);
  const end = (e: number, key: unknown): number => {
    const k = String(key);
    const hit = byId.get(k) ?? byName.get(k);
    if (hit !== undefined) return hit;
    if (typeof key === 'number' && Number.isInteger(key) && key >= 0 && key < n) return key;
    throw new Error(`link ${e}: unknown node "${k}"`);
  };
  links.forEach((l, e) => {
    sources[e] = end(e, l?.source);
    targets[e] = end(e, l?.target);
    widths[e] = opt(l?.lineWidth);
  });

  const labelPx = Float32Array.from(names, (s) => Math.min(MAX_LABEL_PX, s.length * CHAR_PX));
  const f = o.force ?? {};
  const labels = o.labels ?? true;
  return {
    names,
    ids: nodes.map((d) => d?.id),
    values,
    x,
    y,
    categories,
    categoryNames,
    categoryColors,
    defaultCategories,
    sizes,
    fixed,
    sources,
    targets,
    widths,
    labelPx,
    inputColors: nodes.map((d) => d?.color),
    layout,
    xCategories: xCats,
    labels,
    options: new Float64Array([
      LAYOUT[layout],
      opt(o.lineWidth),
      opt(o.curveness),
      o.edgeSymbol === 'arrow' ? 1 : 0,
      opt(o.edgeSymbolSize),
      EDGE_COLOR[o.edgeColor ?? 'neutral'] ?? 0,
      opt(o.edgeOpacity),
      SYMBOL[o.symbol ?? 'circle'] ?? 0,
      labels ? 1 : 0,
      o.rotateLabel ? 1 : 0,
      14,
      typeof f.iterations === 'number' && Number.isFinite(f.iterations) ? Math.max(0, Math.floor(f.iterations)) : NaN,
      opt(f.repulsion),
      opt(f.edgeLength),
      opt(f.gravity),
      layout === 'cartesian' && !xCats ? opt(o.xAxis?.min) : NaN,
      layout === 'cartesian' && !xCats ? opt(o.xAxis?.max) : NaN,
      layout === 'cartesian' ? opt(o.yAxis?.min) : NaN,
      layout === 'cartesian' ? opt(o.yAxis?.max) : NaN,
      xCats?.length ?? 0,
    ]),
  };
}

/** Uploads an encoded graph; returns the meta (colors / legend filled by `syncGraph`). */
export function sendGraph(backend: WasmCharturboEngineBackend, enc: EncodedGraph, options?: GraphChartOptions, locale?: string): GraphChartMeta {
  const o = options ?? {};
  try {
    backend.set_graph_chart?.(
      enc.values,
      enc.x,
      enc.y,
      enc.categories,
      enc.categoryNames.length,
      enc.sizes,
      enc.fixed,
      enc.sources,
      enc.targets,
      enc.widths,
      enc.labelPx,
      enc.options
    );
  } catch (e) {
    throw nameEngineError(e, enc.names);
  }
  const n = enc.names.length;
  const sets = Array.from({ length: n }, () => new Set<number>());
  const degree = new Int32Array(n);
  for (let e = 0; e < enc.sources.length; e++) {
    const [s, t] = [enc.sources[e], enc.targets[e]];
    degree[s]++;
    if (t !== s) degree[t]++;
    if (s !== t) {
      sets[s].add(t);
      sets[t].add(s);
    }
  }
  return {
    kind: 'graph',
    names: enc.categoryNames,
    colors: [],
    visible: enc.categoryNames.map(() => true),
    nodeNames: enc.names,
    ids: enc.ids,
    values: enc.values,
    categories: enc.categories,
    sources: enc.sources,
    targets: enc.targets,
    neighbours: sets.map((s) => [...s].sort((a, b) => a - b)),
    degree,
    nodeColors: new Float32Array(0),
    inputColors: enc.inputColors,
    categoryColors: enc.categoryColors,
    palette: o.colors,
    valueLabel: o.valueLabel ?? getMessages(locale).common.value,
    labels: enc.labels,
    layout: enc.layout,
    xCategories: enc.xCategories,
    labelOptions: { valueLabel: o.valueLabel, defaultCategories: enc.defaultCategories },
  };
}

/** Palette (options / theme, with category colors over their slots) and per-node colors. */
export function sendGraphStyle(backend: WasmCharturboEngineBackend, meta: GraphChartMeta, theme: CharturboTheme): void {
  const own = (meta.palette ?? []).map((c) => parseOptionalColor(c)).filter((c): c is RgbaTuple => !!c);
  const base = own.length ? own : theme.palette;
  const k = Math.max(base.length, meta.categoryColors.length);
  const palette = new Float32Array(k * 4);
  for (let i = 0; i < k; i++) {
    const c = meta.categoryColors[i];
    palette.set((c !== undefined ? parseOptionalColor(c) : undefined) ?? base[i % base.length], i * 4);
  }
  const colors = new Float32Array(meta.inputColors.length * 4).fill(NaN);
  meta.inputColors.forEach((c, i) => {
    const rgba = c === undefined ? undefined : parseOptionalColor(c);
    if (rgba) colors.set(rgba, i * 4);
  });
  const highlight = parseOptionalColor(theme.textPrimary) ?? [1, 1, 1, 1];
  backend.set_chart_hierarchy_style?.(palette, colors, Float32Array.from(theme.baseline), Float32Array.from(theme.surface), Float32Array.from(highlight), 0);
}

/** Re-reads node / legend colors; default value and category names follow `locale`. */
export function syncGraph(backend: WasmCharturboEngineBackend, meta: GraphChartMeta, locale?: string): void {
  const m = getMessages(locale);
  meta.valueLabel = meta.labelOptions.valueLabel ?? m.common.value;
  if (meta.labelOptions.defaultCategories) meta.names = meta.names.map((_, k) => m.graph.categoryName(k + 1));
  meta.nodeColors = backend.chart_hierarchy_colors?.() ?? meta.nodeColors;
  const legend = backend.chart_hierarchy_legend?.() ?? new Float64Array(0);
  const colors: RgbaTuple[] = meta.names.map(() => [0.5, 0.5, 0.5, 1]);
  for (let at = 0; at + 4 < legend.length; at += 5) {
    const k = legend[at];
    if (k >= 0 && k < colors.length) colors[k] = [legend[at + 1], legend[at + 2], legend[at + 3], legend[at + 4]];
  }
  meta.colors = colors;
}

const rgbaAt = (a: ArrayLike<number>, i: number): RgbaTuple =>
  a.length > i * 4 + 3 ? [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]] : [0.5, 0.5, 0.5, 1];

const nodeName = (meta: GraphChartMeta, v: number, locale?: string) => meta.nodeNames[v] ?? getMessages(locale).common.itemName(v + 1);
const categoryOf = (meta: GraphChartMeta, v: number): string | null => {
  const c = meta.categories[v];
  return c >= 0 ? (meta.names[c] ?? null) : null;
};

/** Shown: no category, or a visible one. */
export function graphNodeShown(meta: GraphChartMeta, v: number): boolean {
  const c = meta.categories[v];
  return v >= 0 && v < meta.nodeNames.length && (c < 0 || meta.visible[c] !== false);
}

/** Tooltip data (`hierarchy` context: path = category › name, `children` = incident links). */
export function graphNodeInfo(meta: GraphChartMeta, node: number): ChartHierarchyTooltip | null {
  if (!Number.isInteger(node) || node < 0 || node >= meta.nodeNames.length) return null;
  const cat = categoryOf(meta, node);
  const name = nodeName(meta, node);
  return {
    node,
    name,
    path: cat !== null ? [cat, name] : [name],
    value: meta.values[node] ?? NaN,
    percentOfParent: NaN,
    percentOfTotal: NaN,
    depth: 0,
    children: meta.degree[node] ?? 0,
  };
}

export function graphTooltipContext(meta: GraphChartMeta, node: number, cssColor: (c: RgbaTuple) => string): ChartTooltipContext | null {
  const info = graphNodeInfo(meta, node);
  if (!info) return null;
  return {
    chartType: 'graph',
    index: node,
    xLabel: info.path.join(' › '),
    items: [{ seriesName: info.name, value: info.value, color: cssColor(rgbaAt(meta.nodeColors, node)), nodeId: node }],
    hierarchy: info,
    details: null,
  };
}

/** Node details (`getNodeDetails`). */
export function graphDetails(meta: GraphChartMeta, id: number): { label: string; color: RgbaTuple; series: number; tags: string[]; attributes: Record<string, string | number> } | null {
  const info = graphNodeInfo(meta, id);
  if (!info) return null;
  const cat = categoryOf(meta, id);
  return {
    label: info.path.join(' › '),
    color: rgbaAt(meta.nodeColors, id),
    series: Math.max(0, meta.categories[id]),
    tags: ['graph', ...(cat !== null ? [`category:${cat}`] : [])],
    attributes: {
      name: info.name,
      ...(cat !== null ? { category: cat } : {}),
      ...(Number.isFinite(info.value) ? { value: info.value } : {}),
      links: info.children,
    },
  };
}

// ---------------------------------------------------------------------------
// Accessibility model
// ---------------------------------------------------------------------------

/** A11y model of a 2D graph: Up / Down walk the shown nodes, Right / Left their linked nodes. */
export function graphA11yModel(meta: GraphChartMeta, common: A11yCommon): A11yChartModel {
  const f = common.formatValue;
  const locale = common.locale;
  const msg = getMessages(locale);
  const g = msg.graph;
  const h = msg.hierarchy;
  const num = (n: number) => formatCount(n, locale);
  const name = (v: number) => nodeName(meta, v, locale);
  const value = (v: number) => (Number.isFinite(meta.values[v]) ? f(meta.values[v]) : null);
  const links = (v: number) => g.links(meta.degree[v] ?? 0, num(meta.degree[v] ?? 0));
  const count = meta.nodeNames.length;
  const shown = (v: number) => graphNodeShown(meta, v);
  const shownList = () => {
    const out: number[] = [];
    for (let v = 0; v < count; v++) if (shown(v)) out.push(v);
    return out;
  };
  /** Most linked first (ties: input order) */
  const ranked = () =>
    Array.from({ length: count }, (_, v) => v)
      .filter((v) => meta.degree[v] > 0)
      .sort((a, b) => meta.degree[b] - meta.degree[a] || a - b);
  const custom: A11yCustom = {
    kindLabel: msg.common.kind.graph,
    help: g.help,
    summary() {
      const k = meta.names.length;
      const e = meta.sources.length;
      const top = ranked().slice(0, 3);
      const text = g.summary(
        g.graphName,
        h.nodes(count, num(count)),
        k ? g.categories(k, num(k)) : null,
        g.links(e, num(e)),
        top.length ? top.map((v) => g.topItem(name(v), links(v))).join(msg.common.listSeparator) : null
      );
      return common.title ? h.titled(common.title, text) : text;
    },
    description() {
      return ranked()
        .slice(0, 20)
        .map((v) => g.item(name(v), categoryOf(meta, v), value(v), links(v)));
    },
    step(focus, key) {
      const list = shownList();
      if (!list.length) return null;
      const vertical = ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
      if (!vertical.includes(key) && key !== 'ArrowRight' && key !== 'ArrowLeft') return null;
      if (!focus || !shown(focus.index)) return { series: 0, index: key === 'End' ? list[list.length - 1] : list[0] };
      const v = focus.index;
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        const nb = meta.neighbours[v].filter(shown);
        if (!nb.length) return focus;
        const next = key === 'ArrowRight' ? (nb.find((u) => u > v) ?? nb[0]) : ([...nb].reverse().find((u) => u < v) ?? nb[nb.length - 1]);
        return { series: 0, index: next };
      }
      let k = list.indexOf(v);
      k += key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -10 : key === 'PageDown' ? 10 : key === 'Home' ? -Infinity : Infinity;
      return { series: 0, index: list[Math.max(0, Math.min(list.length - 1, k))] };
    },
    key() {
      return null;
    },
    announce(focus) {
      const v = focus.index;
      if (v < 0 || v >= count) return '';
      const nb = meta.neighbours[v];
      const listed = nb.slice(0, 5).map(name);
      const position = g.position(
        num(v + 1),
        num(count),
        links(v),
        listed.length ? listed.join(msg.common.listSeparator) : null,
        nb.length > 5 ? num(nb.length - 5) : null
      );
      return [g.nodeAnnounce(name(v), categoryOf(meta, v), value(v)), position].join(h.sentenceSeparator);
    },
    table(pick) {
      // Every node in input order; "Linked to" = the targets of its outgoing links
      const out: number[][] = Array.from({ length: count }, () => []);
      for (let e = 0; e < meta.sources.length; e++) out[meta.sources[e]].push(meta.targets[e]);
      const rows = pick(count).map((v): ChartDataCell[] => [
        name(v),
        categoryOf(meta, v),
        Number.isFinite(meta.values[v]) ? meta.values[v] : null,
        meta.degree[v] ?? 0,
        out[v].length ? out[v].map(name).join(msg.common.listSeparator) : null,
      ]);
      return { columns: [g.node, g.category, meta.valueLabel, g.linksHeader, g.linkedTo], rows, totalRows: count, sampled: rows.length < count };
    },
    hover(focus) {
      return meta.engine?.hover(0, focus.index);
    },
  };
  return {
    kind: 'graph',
    ...common,
    series: [{ name: meta.valueLabel, values: meta.values, visible: true, f32: false }],
    length: count,
    custom,
    xValue: name,
    xLabel: name,
    formatX: name,
    pointId: (_s, i) => i,
    itemName: (_s, i) => name(i),
    itemColor: (_s, i) => rgbaAt(meta.nodeColors, i),
  };
}
