/**
 * Treemap / sunburst / sankey bindings. The engine owns the data logic (lib_hierarchy.rs):
 * tree validation and aggregation, cycle detection, squarified / radial partition / d3-sankey
 * layouts, tessellation (2 px surface gaps), hit-testing, drill-down, hover highlights and label
 * anchors that fit. This module encodes the input (nested tree or flat `{ id, parent }` rows,
 * flows), mirrors the engine's values / colors for the legend, tooltip and a11y model, and
 * places DOM text: labels at the engine anchors, the breadcrumb and the sunburst center.
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { ChartAnimationInput } from './chart-animation';
import type { ChartDecalInput, DecalOverride } from './chart-decal';
import type { A11yChartModel, ChartDataCell } from './chart-a11y';
import type { A11yCommon, A11yCustomModel } from './chart-business-util';
import type { ChartLegendOptions, ChartPaddingOptions, ChartTooltipContext, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { formatCount, formatNumber, getMessages, resolveLocale } from './i18n';
import { measureRichText, parseRichText, renderRichText, type RichLabelOptions } from './chart-rich-text';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Nested hierarchy node: leaves carry `value`; a parent's value is the sum of its children. */
export interface HierarchyNode {
  name: string;
  /** Leaf value, finite and >= 0 (missing = 0; ignored on parents) */
  value?: number;
  children?: HierarchyNode[];
  /** Fill override of this node */
  color?: ColorInput;
  /** Pattern fill of this node over the chart `decal` (`false`: none) */
  decal?: DecalOverride;
}

/** Flat hierarchy row: `parent` is another row's `id` (missing / `null` = a root). */
export interface HierarchyFlatNode {
  id: string | number;
  parent?: string | number | null;
  value?: number;
  /** Display name (default: the id) */
  name?: string;
  color?: ColorInput;
  /** Pattern fill of this node over the chart `decal` (`false`: none) */
  decal?: DecalOverride;
}

/** One root node, or flat rows (several roots get a synthetic `rootLabel` root). */
export type HierarchyData = HierarchyNode | HierarchyFlatNode[];

/** Input of a treemap / sunburst / sankey `label.formatter` (one labeled node). */
export interface HierarchyLabelContext {
  name: string;
  value: number;
  /** Tree depth (top-level nodes 0; treemap / sunburst) */
  depth?: number;
  /** Column (sankey) */
  column?: number;
}

export interface HierarchyChartOptions {
  title?: string;
  /**
   * Pattern fills over the marks (accessibility, ECharts `aria.decal`): `true` gives each top-level group
   * its own automatic pattern; options apply over the automatic patterns (default off). Nodes override with their own `decal`; treemap parent headers and the sunburst center stay plain
   */
  decal?: ChartDecalInput;
  /** Accessible name of the canvas */
  description?: string;
  /** Categorical palette in fixed order (default: the theme palette) */
  colors?: ColorInput[];
  /**
   * `'group'`: palette by top-level group, groups beyond the palette fold into a neutral
   * "Other" color; `'value'`: sequential colormap of the value per depth; `'auto'` (default):
   * group when the top-level groups fit the palette, else value
   */
  colorBy?: 'auto' | 'group' | 'value';
  /** Colormap of `colorBy: 'value'` (default `'sequential'`) */
  colormap?: 'sequential' | 'viridis' | 'magma';
  /** Value text of labels, tooltip, center and a11y (spec like `'$,.0f'`, Intl options, or a function) */
  format?: ChartValueFormat;
  /** DOM labels where they fit (default: true) */
  labels?: boolean;
  /**
   * Text of the labels the engine places (rich text `{style|text}` runs, see chart-rich-text.ts;
   * treemap labels clip to their cell; header strips show the first line). Default: the name (treemap: + value when it fits)
   */
  label?: RichLabelOptions<HierarchyLabelContext>;
  /** Levels shown below the current root (default: all) */
  maxDepth?: number;
  /** Top-level group legend (default: shown in group color mode with 2+ groups); hover emphasizes a group */
  legend?: ChartLegendOptions | boolean;
  /** Plot margins (CSS px) */
  padding?: ChartPaddingOptions;
  /** Tooltip / table name of the values (default: `'Value'` in the chart language) */
  valueLabel?: string;
  /** Name of the synthetic root above several roots (default: `'All'` in the chart language) */
  rootLabel?: string;
  /**
   * Enter / update animation of this chart (default: the SDK setting, `setAnimation`);
   * `{ transition: true }` morphs treemap <-> sunburst by node path
   */
  animation?: ChartAnimationInput;
}

export interface TreemapChartOptions extends HierarchyChartOptions {
  /** Inner padding of parents around their children (CSS px, default 2) */
  innerPadding?: number;
  /** Header strip height of parents (CSS px, default 20; 0 = none) */
  headerHeight?: number;
}

export type SunburstChartOptions = HierarchyChartOptions;

export interface SankeyNodeInput {
  id: string | number;
  /** Display name (default: the id) */
  name?: string;
  color?: ColorInput;
  /** Color group (palette in first-appearance order; the legend lists the groups) */
  group?: string;
  /** Minimum column (0 = left): a node is placed right of all its sources; used columns are packed */
  column?: number;
}

export interface SankeyLevelOptions {
  /** Column index (0 = sources; the packed column, as nodes are laid out) */
  column: number;
  color?: ColorInput;
  /** Opacity of the links leaving the column (0-1, default: `linkOpacity`) */
  linkOpacity?: number;
}

export interface SankeyLinkInput {
  source: string | number;
  target: string | number;
  /** Finite and >= 0 */
  value: number;
}

export interface SankeyChartData {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
}

export interface SankeyChartOptions {
  title?: string;
  description?: string;
  /** Categorical palette in fixed order (default: the theme palette) */
  colors?: ColorInput[];
  format?: ChartValueFormat;
  /** Node labels beside the bars (default: true) */
  labels?: boolean;
  /** Text of node labels (rich text, see chart-rich-text.ts). Default: name + value */
  label?: RichLabelOptions<HierarchyLabelContext>;
  legend?: ChartLegendOptions | boolean;
  padding?: ChartPaddingOptions;
  /** Node bar width (CSS px, default 12; the bar height when vertical) */
  nodeWidth?: number;
  /** Gap between nodes of a column (CSS px, default 10) */
  nodePadding?: number;
  /** Flow direction (default `'horizontal'`: columns left to right; `'vertical'`: rows top to bottom) */
  orient?: 'horizontal' | 'vertical';
  /** Per-column style (ECharts `levels`): node color (node `color` still wins) and the opacity of the links leaving the column */
  levels?: SankeyLevelOptions[];
  /** Relaxation rounds (default 32) */
  iterations?: number;
  /** Column assignment of nodes without `column` (default `'justify'`: sinks in the last column) */
  align?: 'justify' | 'left' | 'right' | 'center';
  /** Ribbon color (default `'source'`; `'gradient'` blends the source into the target color) */
  linkColor?: 'source' | 'target' | 'neutral' | 'gradient';
  /** Ribbon opacity (default 0.5) */
  linkOpacity?: number;
  valueLabel?: string;
}

/** `'drill'` event payload: the treemap / sunburst now shows the subtree of `node`. */
export interface CharturboDrillEvent {
  kind: 'treemap' | 'sunburst';
  /** Node index (input order; tree input: depth-first order; a synthetic root is last) */
  node: number;
  /** Flat input `id` of the node (tree input: undefined) */
  id?: string | number;
  name: string;
  /** Names from the top root down to `node` */
  path: string[];
}

/** Hovered treemap / sunburst node (tooltip context `hierarchy`). */
export interface ChartHierarchyTooltip {
  node: number;
  name: string;
  /** Names from the top root down to the node */
  path: string[];
  value: number;
  /** Share of the parent / of the whole tree (0-100; NaN for the root) */
  percentOfParent: number;
  percentOfTotal: number;
  depth: number;
  /** Shown children (0 = leaf) */
  children: number;
}

/** Hovered sankey link or node (tooltip context `flow`). */
export interface ChartFlowTooltip {
  kind: 'link' | 'node';
  /** Link: source / target names; node: its name in `source` */
  source: string;
  target?: string;
  value: number;
  /** Link: share of the source node's value (0-100) */
  percentOfSource?: number;
  /** Node: total inflow / outflow */
  inflow?: number;
  outflow?: number;
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export interface EncodedHierarchy {
  /** Parent index per node (-1 = root) */
  parents: Int32Array;
  values: Float64Array;
  names: string[];
  ids: (string | number | undefined)[];
  colors: (ColorInput | undefined)[];
  /** Decal option per node (chart-decal.ts) */
  decals: DecalOverride[];
}

/** Flattens a nested tree (depth-first) or indexes flat rows by id (`locale`: default node names). */
export function encodeHierarchy(data: HierarchyData, locale?: string): EncodedHierarchy {
  const names: string[] = [];
  const ids: (string | number | undefined)[] = [];
  const colors: (ColorInput | undefined)[] = [];
  const decals: DecalOverride[] = [];
  const parents: number[] = [];
  const values: number[] = [];
  const num = (v: unknown) => (typeof v === 'number' ? v : v === undefined || v === null ? NaN : Number(v));
  if (Array.isArray(data)) {
    const index = new Map<string, number>();
    data.forEach((row, i) => {
      const key = String(row.id);
      if (index.has(key)) throw new Error(`Hierarchy has a duplicate node id "${key}"`);
      index.set(key, i);
    });
    data.forEach((row) => {
      const p = row.parent;
      let parent = -1;
      if (p !== undefined && p !== null && p !== '') {
        const at = index.get(String(p));
        if (at === undefined) throw new Error(`Hierarchy node "${row.id}" has an unknown parent "${p}"`);
        parent = at;
      }
      parents.push(parent);
      values.push(num(row.value));
      names.push(row.name ?? String(row.id));
      ids.push(row.id);
      colors.push(row.color);
      decals.push(row.decal);
    });
  } else if (data && typeof data === 'object') {
    // Objects on the current root path: a node among its own ancestors is a cycle (a shared
    // subtree object elsewhere is fine and simply appears twice). `null` entries leave a node.
    const path = new Set<HierarchyNode>();
    const stack: ([HierarchyNode, number] | [HierarchyNode, null])[] = [[data, -1]];
    while (stack.length) {
      const [node, parent] = stack.pop()!;
      if (parent === null) {
        path.delete(node);
        continue;
      }
      if (path.has(node)) throw new Error(`Hierarchy has a cycle through node "${node.name}"`);
      path.add(node);
      stack.push([node, null]);
      const i = names.length;
      parents.push(parent);
      values.push(num(node.value));
      names.push(node.name ?? getMessages(locale).common.itemName(i + 1));
      ids.push(undefined);
      colors.push(node.color);
      decals.push(node.decal);
      const kids = node.children ?? [];
      for (let k = kids.length - 1; k >= 0; k--) stack.push([kids[k], i]);
    }
  }
  return { parents: Int32Array.from(parents), values: Float64Array.from(values), names, ids, colors, decals };
}

/** Engine error text with `node <i>` replaced by the node's name. */
export function nameEngineError(e: unknown, names: string[]): Error {
  const msg = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e);
  const text = msg.replace(/node (\d+)/g, (m, i: string) => (names[Number(i)] !== undefined ? `"${names[Number(i)]}"` : m));
  return new Error(text.charAt(0).toUpperCase() + text.slice(1));
}

const COLOR_BY: Record<string, number> = { auto: 0, group: 1, value: 2 };
const COLORMAPS: Record<string, number> = { sequential: 0, viridis: 1, magma: 2 };
const ALIGN: Record<string, number> = { justify: 0, left: 1, right: 2, center: 3 };
const LINK_COLOR: Record<string, number> = { source: 0, target: 1, neutral: 2, gradient: 3 };

/** Packed levels `[column, r, g, b, a (NaN = keep), linkOpacity (NaN = default)]` per entry. */
function encodeSankeyLevels(levels: SankeyLevelOptions[] | undefined): Float32Array {
  const out = new Float32Array((levels?.length ?? 0) * 6);
  levels?.forEach((lv, k) => {
    const o = lv.linkOpacity;
    if (o !== undefined && !(o >= 0 && o <= 1)) throw new Error(`Sankey level ${k}: linkOpacity ${o} must be in [0, 1]`);
    const c = parseOptionalColor(lv.color) ?? [NaN, NaN, NaN, NaN];
    out.set([Math.max(0, Math.floor(lv.column)), ...c, o ?? NaN], k * 6);
  });
  return out;
}
const opt = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const flag = (v: boolean | undefined) => (v === undefined ? NaN : v ? 1 : 0);

/** Engine hooks the SDK binds per chart (children order, direct hover, drill). */
export interface HierarchyEngineHooks {
  children(node: number): number[];
  hover(series: number, index: number): Float64Array | undefined;
  drill(node: number): boolean;
}

/** Display state the SDK keeps for a treemap / sunburst (values and colors mirror the engine). */
export type HierarchyChartMeta = (HierarchyMetaFields & { kind: 'treemap' }) | (HierarchyMetaFields & { kind: 'sunburst' });

interface HierarchyMetaFields {
  /** Legend entries: top-level group names (`'Other'` for the folded ones) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  /** Group node per legend entry (-1 = Other) */
  legendNodes: number[];
  /** Per node (a synthetic root is last) */
  nodeNames: string[];
  ids: (string | number | undefined)[];
  parents: Int32Array;
  values: Float64Array;
  nodeColors: Float32Array;
  inputColors: (ColorInput | undefined)[];
  treeRoot: number;
  root: number;
  valueLabel: string;
  palette?: ColorInput[];
  colormap: number;
  labels: boolean;
  /** `valueLabel` / `rootLabel` options (absent = built-in text of the locale) */
  labelOptions?: { valueLabel?: string; rootLabel?: string };
  label?: RichLabelOptions<HierarchyLabelContext>;
  engine?: HierarchyEngineHooks;
}

/** Display state of a sankey (node / link values mirror the engine). */
export interface SankeyChartMeta {
  kind: 'sankey';
  /** Legend entries: node groups (empty without groups) */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  nodeNames: string[];
  nodeIds: (string | number)[];
  sources: Uint32Array;
  targets: Uint32Array;
  /** 4 per link: source, target, value, percent of source */
  links: Float64Array;
  /** 8 per node: column, value, inflow, outflow, x0, y0, x1, y1 */
  nodes: Float64Array;
  nodeColors: Float32Array;
  inputColors: (ColorInput | undefined)[];
  groups: Int32Array;
  valueLabel: string;
  palette?: ColorInput[];
  labels: boolean;
  /** `valueLabel` option (absent = built-in text of the locale) */
  labelOptions?: { valueLabel?: string };
  label?: RichLabelOptions<HierarchyLabelContext>;
  engine?: HierarchyEngineHooks;
}

/**
 * Uploads a treemap / sunburst; returns the meta (fields filled by `syncHierarchy`). `locale`:
 * default value / root / node names (`syncHierarchy` re-applies them).
 */
export function sendHierarchy(
  backend: WasmCharturboEngineBackend,
  kind: 'treemap' | 'sunburst',
  data: HierarchyData,
  options?: TreemapChartOptions,
  locale?: string,
  encoded?: EncodedHierarchy
): HierarchyChartMeta {
  const enc = encoded ?? encodeHierarchy(data, locale);
  const o = options ?? {};
  const colorBy = COLOR_BY[o.colorBy ?? 'auto'] ?? 0;
  const labels = o.labels ?? true;
  try {
    if (kind === 'treemap') {
      backend.set_treemap_chart?.(enc.parents, enc.values, new Float64Array([opt(o.maxDepth), opt(o.innerPadding), opt(o.headerHeight), colorBy, flag(labels)]));
    } else {
      backend.set_sunburst_chart?.(enc.parents, enc.values, new Float64Array([opt(o.maxDepth), colorBy, flag(labels), 14]));
    }
  } catch (e) {
    throw nameEngineError(e, enc.names);
  }
  const m = getMessages(locale);
  const rootLabel = o.rootLabel ?? m.hierarchy.rootLabel;
  return {
    kind,
    names: [],
    colors: [],
    visible: [],
    legendNodes: [],
    nodeNames: [...enc.names, rootLabel],
    ids: enc.ids,
    parents: enc.parents,
    values: new Float64Array(0),
    nodeColors: new Float32Array(0),
    inputColors: enc.colors,
    treeRoot: 0,
    root: 0,
    valueLabel: o.valueLabel ?? m.common.value,
    palette: o.colors,
    colormap: COLORMAPS[o.colormap ?? 'sequential'] ?? 0,
    labels,
    labelOptions: { valueLabel: o.valueLabel, rootLabel: o.rootLabel },
    ...(o.label ? { label: o.label } : {}),
  };
}

/** Uploads a sankey; returns the meta (fields filled by `syncSankey`; `locale`: default value name). */
export function sendSankey(backend: WasmCharturboEngineBackend, data: SankeyChartData, options?: SankeyChartOptions, locale?: string): SankeyChartMeta {
  const o = options ?? {};
  const nodes = data.nodes ?? [];
  const index = new Map<string, number>();
  nodes.forEach((n, i) => {
    const key = String(n.id);
    if (index.has(key)) throw new Error(`Sankey has a duplicate node id "${key}"`);
    index.set(key, i);
  });
  const names = nodes.map((n) => n.name ?? String(n.id));
  const links = data.links ?? [];
  const sources = new Uint32Array(links.length);
  const targets = new Uint32Array(links.length);
  const values = new Float64Array(links.length);
  links.forEach((l, i) => {
    const s = index.get(String(l.source));
    const t = index.get(String(l.target));
    if (s === undefined) throw new Error(`Sankey link ${i} has an unknown source "${l.source}"`);
    if (t === undefined) throw new Error(`Sankey link ${i} has an unknown target "${l.target}"`);
    sources[i] = s;
    targets[i] = t;
    values[i] = typeof l.value === 'number' ? l.value : Number(l.value);
  });
  const explicit = nodes.some((n) => typeof n.column === 'number');
  const columns = explicit ? Int32Array.from(nodes, (n) => (typeof n.column === 'number' && Number.isFinite(n.column) ? Math.floor(n.column) : -1)) : new Int32Array(0);
  const groupNames: string[] = [];
  const groups = Int32Array.from(nodes, (n) => {
    if (n.group === undefined) return -1;
    let k = groupNames.indexOf(n.group);
    if (k < 0) k = groupNames.push(n.group) - 1;
    return k;
  });
  try {
    backend.set_sankey_chart?.(
      nodes.length,
      sources,
      targets,
      values,
      columns,
      groupNames.length ? groups : new Int32Array(0),
      new Float64Array([
        opt(o.nodeWidth),
        opt(o.nodePadding),
        opt(o.iterations),
        ALIGN[o.align ?? 'justify'] ?? 0,
        LINK_COLOR[o.linkColor ?? 'source'] ?? 0,
        opt(o.linkOpacity),
        flag(o.labels ?? true),
        14,
        o.orient === 'vertical' ? 1 : 0,
        // Vertical rows: label centers keep the widest label apart (name + value, ~6.5 px per character)
        o.label?.formatter ? richSankeyWidth(names, sources, targets, values, o.label) : (Math.max(0, ...names.map((n) => n.length)) + 8) * 6.5,
      ]),
      encodeSankeyLevels(o.levels)
    );
  } catch (e) {
    throw nameEngineError(e, names);
  }
  return {
    kind: 'sankey',
    names: groupNames,
    colors: [],
    visible: groupNames.map(() => true),
    nodeNames: names,
    nodeIds: nodes.map((n) => n.id),
    sources,
    targets,
    links: new Float64Array(0),
    nodes: new Float64Array(0),
    nodeColors: new Float32Array(0),
    inputColors: nodes.map((n) => n.color),
    groups,
    valueLabel: o.valueLabel ?? getMessages(locale).common.value,
    palette: o.colors,
    labels: o.labels ?? true,
    labelOptions: { valueLabel: o.valueLabel },
    ...(o.label ? { label: o.label } : {}),
  };
}

/** Base font of hierarchy labels (rich runs inherit it). */
const LABEL_BASE = { fontSize: 11, fontWeight: '400', fontFamily: 'sans-serif', lineHeight: 14 };

/** Widest formatter label of a sankey (node value = the larger of its in / out flow). */
function richSankeyWidth(names: string[], sources: Uint32Array, targets: Uint32Array, values: Float64Array, label: RichLabelOptions<HierarchyLabelContext>): number {
  const inflow = new Float64Array(names.length);
  const outflow = new Float64Array(names.length);
  values.forEach((v, i) => {
    if (!(v > 0)) return;
    outflow[sources[i]] += v;
    inflow[targets[i]] += v;
  });
  return names.reduce((w, name, i) => Math.max(w, measureRichText(parseRichText(label.formatter!({ name, value: Math.max(inflow[i], outflow[i]) }), label.rich), label.rich, LABEL_BASE).width), 0) + 8;
}

/** Palette, per-node colors, neutral / surface / highlight colors (and the value colormap). */
export function sendHierarchyStyle(
  backend: WasmCharturboEngineBackend,
  meta: HierarchyChartMeta | SankeyChartMeta | { kind: 'tree'; palette?: ColorInput[]; inputColors: (ColorInput | undefined)[]; colormap: number },
  theme: CharturboTheme
): void {
  const own = (meta.palette ?? []).map((c) => parseOptionalColor(c)).filter((c): c is RgbaTuple => !!c);
  const pal = own.length ? own : theme.palette;
  const palette = new Float32Array(pal.length * 4);
  pal.forEach((c, k) => palette.set(c, k * 4));
  const inputs = meta.inputColors;
  const colors = new Float32Array(inputs.length * 4).fill(NaN);
  inputs.forEach((c, i) => {
    const rgba = c === undefined ? undefined : parseOptionalColor(c);
    if (rgba) colors.set(rgba, i * 4);
  });
  const highlight = parseOptionalColor(theme.textPrimary) ?? [1, 1, 1, 1];
  backend.set_chart_hierarchy_style?.(
    palette,
    colors,
    Float32Array.from(theme.baseline),
    Float32Array.from(theme.surface),
    Float32Array.from(highlight),
    meta.kind === 'sankey' ? 0 : meta.colormap
  );
}

const rgbaAt = (a: ArrayLike<number>, i: number): RgbaTuple => [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]];

/**
 * Re-reads values, colors, legend and the current root of a treemap / sunburst; default names
 * (value, synthetic root, folded "Other" group) follow `locale`.
 */
export function syncHierarchy(backend: WasmCharturboEngineBackend, meta: HierarchyChartMeta, locale?: string): void {
  const m = getMessages(locale);
  if (meta.labelOptions) meta.valueLabel = meta.labelOptions.valueLabel ?? m.common.value;
  meta.values = backend.chart_hierarchy_values?.() ?? meta.values;
  meta.nodeColors = backend.chart_hierarchy_colors?.() ?? meta.nodeColors;
  const info = backend.chart_hierarchy_info?.();
  if (info && info.length >= 4) {
    meta.treeRoot = info[1];
    meta.root = info[3];
    // The synthetic root's name sits after the input names
    if (info[2] === 0) meta.nodeNames.length = Math.min(meta.nodeNames.length, info[0]);
  }
  if (meta.labelOptions && meta.labelOptions.rootLabel === undefined && meta.nodeNames.length > meta.parents.length) {
    meta.nodeNames[meta.parents.length] = m.hierarchy.rootLabel;
  }
  const legend = backend.chart_hierarchy_legend?.() ?? new Float64Array(0);
  meta.names = [];
  meta.colors = [];
  meta.legendNodes = [];
  for (let k = 0; k + 4 < legend.length; k += 5) {
    const node = legend[k];
    meta.legendNodes.push(node);
    meta.names.push(node < 0 ? m.common.other : (meta.nodeNames[node] ?? m.common.itemName(node + 1)));
    meta.colors.push([legend[k + 1], legend[k + 2], legend[k + 3], legend[k + 4]]);
  }
  meta.visible = meta.names.map(() => true);
}

/** Re-reads node / link values, shares, colors and the group legend of a sankey (`locale`: default value name). */
export function syncSankey(backend: WasmCharturboEngineBackend, meta: SankeyChartMeta, locale?: string): void {
  if (meta.labelOptions) meta.valueLabel = meta.labelOptions.valueLabel ?? getMessages(locale).common.value;
  meta.nodes = backend.chart_sankey_nodes?.() ?? meta.nodes;
  meta.links = backend.chart_sankey_links?.() ?? meta.links;
  meta.nodeColors = backend.chart_hierarchy_colors?.() ?? meta.nodeColors;
  meta.colors = meta.names.map((_, k) => {
    const v = Array.prototype.indexOf.call(meta.groups, k) as number;
    return v >= 0 ? rgbaAt(meta.nodeColors, v) : [0.5, 0.5, 0.5, 1];
  });
}

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

/** Node indices from the top root down to `node` (a synthetic root excluded). */
export function hierarchyPath(meta: HierarchyChartMeta, node: number): number[] {
  const out: number[] = [];
  for (let v = node, guard = 0; v >= 0 && guard <= meta.nodeNames.length; guard++, v = hierarchyParent(meta, v)) {
    if (v < meta.parents.length) out.push(v);
  }
  return out.reverse();
}

/** Parent of `node` in the engine tree (roots of a multi-root input: the synthetic root). */
export function hierarchyParent(meta: HierarchyChartMeta, node: number): number {
  if (node >= meta.parents.length) return -1;
  const p = meta.parents[node];
  return p < 0 && meta.treeRoot >= meta.parents.length ? meta.treeRoot : p;
}

/** Name of node `v` (default `#n` when it has none). */
const nodeName = (names: string[], v: number, locale?: string) => names[v] ?? getMessages(locale).common.itemName(v + 1);

const pct = (part: number, whole: number) => (whole > 0 && Number.isFinite(part) ? (part / whole) * 100 : NaN);

/** Tooltip data of a node. */
export function hierarchyNodeInfo(meta: HierarchyChartMeta, node: number): ChartHierarchyTooltip | null {
  if (node < 0 || node >= meta.nodeNames.length) return null;
  const value = meta.values[node] ?? NaN;
  const parent = hierarchyParent(meta, node);
  let depth = 0;
  for (let v = node; hierarchyParent(meta, v) >= 0 && depth <= meta.nodeNames.length; v = hierarchyParent(meta, v)) depth++;
  return {
    node,
    name: nodeName(meta.nodeNames, node),
    path: hierarchyPath(meta, node).map((v) => nodeName(meta.nodeNames, v)),
    value,
    percentOfParent: parent >= 0 ? pct(value, meta.values[parent]) : NaN,
    percentOfTotal: pct(value, meta.values[meta.treeRoot]),
    depth,
    children: meta.engine?.children(node).length ?? 0,
  };
}

export function hierarchyTooltipContext(meta: HierarchyChartMeta, node: number, cssColor: (c: RgbaTuple) => string): ChartTooltipContext | null {
  const info = hierarchyNodeInfo(meta, node);
  if (!info) return null;
  const color = cssColor(rgbaAt(meta.nodeColors, node));
  return {
    chartType: meta.kind,
    index: node,
    xLabel: info.path.join(' › '),
    items: [{ seriesName: info.name, value: info.value, color, nodeId: node, percent: info.percentOfParent }],
    hierarchy: info,
    details: null,
  };
}

/** Tooltip data of a sankey node (`series` 0) or link (`series` 1). */
export function sankeyTooltipContext(meta: SankeyChartMeta, series: number, index: number, cssColor: (c: RgbaTuple) => string): ChartTooltipContext | null {
  const n = meta.nodeNames.length;
  if (series === 0) {
    if (index < 0 || index >= n) return null;
    const at = index * 8;
    const name = meta.nodeNames[index];
    const value = meta.nodes[at + 1];
    return {
      chartType: 'sankey',
      index,
      xLabel: name,
      items: [{ seriesName: name, value, color: cssColor(rgbaAt(meta.nodeColors, index)), nodeId: index }],
      flow: { kind: 'node', source: name, value, inflow: meta.nodes[at + 2], outflow: meta.nodes[at + 3] },
      details: null,
    };
  }
  const at = index * 4;
  if (index < 0 || at + 3 >= meta.links.length) return null;
  const [s, t, value, share] = [meta.links[at], meta.links[at + 1], meta.links[at + 2], meta.links[at + 3]];
  const source = nodeName(meta.nodeNames, s);
  const target = nodeName(meta.nodeNames, t);
  return {
    chartType: 'sankey',
    index,
    xLabel: `${source} → ${target}`,
    items: [{ seriesName: `${source} → ${target}`, value, color: cssColor(rgbaAt(meta.nodeColors, s)), nodeId: n + index, percent: share }],
    flow: { kind: 'link', source, target, value, percentOfSource: share },
    details: null,
  };
}

/** Share text with one decimal, e.g. `27.3%` (`—` when undefined). */
export function formatShare(p: number, locale?: string): string {
  if (!Number.isFinite(p)) return getMessages(locale).common.dash;
  return `${p.toLocaleString(resolveLocale(locale), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Default tooltip: path (A › B ›), swatch + name + value, shares; sankey `A → B: value (x% of A)`. */
export function hierarchyTooltipHtml(ctx: ChartTooltipContext, theme: CharturboTheme, formatValue: (v: number) => string, locale?: string): string {
  const it = ctx.items[0];
  if (!it) return '';
  const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px;flex:none;background:${it.color};"></span>`;
  const muted = (t: string) => `<div style="color:${theme.textMuted};font-size:11px;margin-top:2px;">${t}</div>`;
  const head = (name: string, value: string) => `
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
          <span style="display:flex;align-items:center;color:${theme.textSecondary};">${swatch}${esc(name)}</span>
          <span style="color:${theme.textPrimary};font-weight:600;font-variant-numeric:tabular-nums;">${value}</span>
        </div>`;
  const t = getMessages(locale).hierarchy;
  const h = ctx.hierarchy;
  if (h) {
    const up = h.path.slice(0, -1);
    const crumbs = up.length ? `<div style="color:${theme.textMuted};font-size:11px;margin-bottom:4px;max-width:260px;white-space:normal;">${esc(up.join(' › '))} ›</div>` : '';
    const shares = [
      Number.isFinite(h.percentOfParent) ? t.ofParent(formatShare(h.percentOfParent, locale)) : '',
      Number.isFinite(h.percentOfTotal) && h.path.length > 1 ? t.ofTotal(formatShare(h.percentOfTotal, locale)) : '',
    ].filter(Boolean);
    return `${crumbs}${head(h.name, esc(formatValue(h.value)))}${shares.length ? muted(shares.join(' · ')) : ''}`;
  }
  const f = ctx.flow;
  if (!f) return '';
  if (f.kind === 'link') {
    // Names on one line, then `value (x% of A)`: long names never squeeze the numbers
    const share = Number.isFinite(f.percentOfSource ?? NaN) ? ` <span style="color:${theme.textMuted};">${esc(t.ofSource(formatShare(f.percentOfSource!, locale), f.source))}</span>` : '';
    return `
        <div style="display:flex;align-items:center;color:${theme.textSecondary};white-space:nowrap;">${swatch}${esc(f.source)} → ${esc(f.target ?? '')}</div>
        <div style="margin-top:2px;font-variant-numeric:tabular-nums;white-space:nowrap;"><span style="color:${theme.textPrimary};font-weight:600;">${esc(formatValue(f.value))}</span>${share}</div>`;
  }
  const flows = [f.inflow ? esc(t.inflow(formatValue(f.inflow))) : '', f.outflow ? esc(t.outflow(formatValue(f.outflow))) : ''].filter(Boolean);
  return `${head(f.source, esc(formatValue(f.value)))}${flows.length ? muted(flows.join(' · ')) : ''}`;
}

// ---------------------------------------------------------------------------
// Accessibility model (chart-a11y.ts delegates to `model.custom`)
// ---------------------------------------------------------------------------

/** Chart-kind specific a11y behavior (summary, description, keys, table, direct hover). */
/** Hierarchy / flow a11y behavior: the shared custom model with every hook implemented. */
export type A11yCustom = A11yCustomModel & Required<Pick<A11yCustomModel, 'step' | 'key' | 'table' | 'hover'>>;

type Common = A11yCommon;

/** Share text of the a11y summary / table (`50%`; no-data text when undefined). */
const shareText = (v: number, locale: string | undefined, digits: number) =>
  Number.isFinite(v) ? `${formatNumber(v, locale, digits)}%` : getMessages(locale).common.noData;

/** A11y model of a treemap / sunburst / sankey meta (`null` for other kinds). */
export function hierarchyA11yModel(m: Record<string, unknown>, common: Common): A11yChartModel | null {
  if (m.kind === 'sankey') return sankeyA11yModel(m as unknown as SankeyChartMeta, common);
  if (m.kind !== 'treemap' && m.kind !== 'sunburst') return null;
  const meta = m as unknown as HierarchyChartMeta;
  const f = common.formatValue;
  const locale = common.locale;
  const msg = getMessages(locale);
  const t = msg.hierarchy;
  const num = (n: number) => formatCount(n, locale);
  const share = (v: number, digits = 1) => shareText(v, locale, digits);
  const name = (v: number) => nodeName(meta.nodeNames, v, locale);
  const children = (v: number) => meta.engine?.children(v) ?? [];
  const siblings = (v: number) => children(hierarchyParent(meta, v));
  const count = meta.parents.length;
  const total = meta.values[meta.treeRoot] ?? NaN;
  const topShares = () =>
    children(meta.root)
      .slice(0, 3)
      .map((c) => `${name(c)} ${share(pct(meta.values[c], meta.values[meta.root]))}`);
  const custom: A11yCustom = {
    kindLabel: meta.kind === 'treemap' ? msg.common.kind.treemap : msg.common.kind.sunburst,
    help: t.treeHelp,
    summary() {
      const kids = children(meta.root);
      const more = kids.length > 3 ? num(kids.length - 3) : null;
      const at = meta.root !== meta.treeRoot ? hierarchyPath(meta, meta.root).map(name).join(' › ') : null;
      const chart = meta.kind === 'treemap' ? t.treemapName : t.sunburstName;
      const text = t.treeSummary(chart, t.nodes(count, num(count)), f(total), at, topShares().join(msg.common.listSeparator), more);
      return common.title ? t.titled(common.title, text) : text;
    },
    description() {
      const out: string[] = [];
      for (const c of children(meta.root).slice(0, 20)) {
        const k = children(c).length;
        out.push(t.treeItem(name(c), f(meta.values[c]), share(pct(meta.values[c], meta.values[meta.root])), t.children(k, num(k))));
      }
      return out;
    },
    step(focus, key) {
      const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
      if (!handled.includes(key)) return null;
      const top = children(meta.root);
      if (!top.length) return null;
      if (!focus) return { series: 0, index: key === 'End' ? top[top.length - 1] : top[0] };
      const v = focus.index;
      if (key === 'ArrowDown') {
        const kids = children(v);
        return kids.length ? { series: 0, index: kids[0] } : focus;
      }
      if (key === 'ArrowUp') {
        const p = hierarchyParent(meta, v);
        return p >= 0 && p !== meta.root ? { series: 0, index: p } : focus;
      }
      const sib = siblings(v);
      let k = sib.indexOf(v);
      if (k < 0) return { series: 0, index: top[0] };
      k += key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'PageUp' ? 10 : key === 'PageDown' ? -10 : key === 'Home' ? -Infinity : Infinity;
      return { series: 0, index: sib[Math.max(0, Math.min(sib.length - 1, k))] };
    },
    key(focus, key) {
      if (key === 'Enter' && focus && children(focus.index).length) {
        if (!meta.engine?.drill(focus.index)) return null;
        return { focus: { series: 0, index: children(focus.index)[0] ?? focus.index } };
      }
      if (key === 'Escape' && meta.root !== meta.treeRoot) {
        const old = meta.root;
        const p = hierarchyParent(meta, old);
        if (p < 0 || !meta.engine?.drill(p)) return null;
        return { focus: { series: 0, index: old } };
      }
      return null;
    },
    announce(focus) {
      const v = focus.index;
      const info = hierarchyNodeInfo(meta, v);
      if (!info) return '';
      const sib = siblings(v);
      const parent = hierarchyParent(meta, v);
      const parts = [
        t.nodeAnnounce(info.name, f(info.value), Number.isFinite(info.percentOfParent) ? share(info.percentOfParent) : null, name(parent)),
        t.nodePosition(num(sib.indexOf(v) + 1), num(sib.length), num(info.depth)),
      ];
      if (info.children) parts.push(t.drillHint(t.children(info.children, num(info.children))));
      return parts.join(t.sentenceSeparator);
    },
    table(pick) {
      // One row per node in input order (tree input: depth-first), the synthetic root excluded
      const n = meta.parents.length;
      const rows = pick(n).map((v): ChartDataCell[] => {
        const info = hierarchyNodeInfo(meta, v)!;
        const cell = (x: number) => (Number.isFinite(x) ? Math.round(x * 100) / 100 : null);
        return [info.path.join(' › '), Number.isFinite(info.value) ? info.value : null, cell(info.percentOfParent), cell(info.percentOfTotal)];
      });
      const tableShare = (x: number) => share(x, 2);
      return {
        columns: [t.path, meta.valueLabel, t.shareOfParent, t.shareOfTotal],
        rows,
        totalRows: n,
        sampled: rows.length < n,
        formats: [undefined, undefined, tableShare, tableShare],
      };
    },
    hover(focus) {
      return meta.engine?.hover(0, focus.index);
    },
  };
  const gray: RgbaTuple = [0.5, 0.5, 0.5, 1];
  return {
    kind: meta.kind,
    ...common,
    series: [{ name: meta.valueLabel, values: meta.values, visible: true, f32: false }],
    length: meta.nodeNames.length,
    custom,
    xValue: name,
    xLabel: name,
    formatX: name,
    pointId: (_s, i) => i,
    itemName: (_s, i) => name(i),
    itemColor: (_s, i) => (meta.nodeColors.length > i * 4 + 3 ? rgbaAt(meta.nodeColors, i) : gray),
  };
}

function sankeyA11yModel(meta: SankeyChartMeta, common: Common): A11yChartModel {
  const f = common.formatValue;
  const locale = common.locale;
  const msg = getMessages(locale);
  const t = msg.hierarchy;
  const num = (n: number) => formatCount(n, locale);
  const nNodes = meta.nodeNames.length;
  const nLinks = meta.sources.length;
  const name = (v: number) => nodeName(meta.nodeNames, v, locale);
  const link = (l: number) => ({
    s: meta.sources[l],
    t: meta.targets[l],
    value: meta.links[l * 4 + 2] ?? NaN,
    share: meta.links[l * 4 + 3] ?? NaN,
  });
  const custom: A11yCustom = {
    kindLabel: msg.common.kind.sankey,
    help: t.sankeyHelp,
    summary() {
      const order = Array.from({ length: nLinks }, (_, l) => l).sort((a, b) => link(b).value - link(a).value || a - b);
      const top = order.slice(0, 3).map((l) => t.flowItem(name(link(l).s), name(link(l).t), f(link(l).value)));
      const cols = nNodes ? Math.max(...Array.from({ length: nNodes }, (_, v) => meta.nodes[v * 8] ?? 0)) + 1 : 0;
      const largest = top.length ? top.join(msg.common.listSeparator) : null;
      const text = t.sankeySummary(t.sankeyName, t.nodes(nNodes, num(nNodes)), t.columns(cols, num(cols)), t.links(nLinks, num(nLinks)), largest);
      return common.title ? t.titled(common.title, text) : text;
    },
    description() {
      const out: string[] = [];
      for (let v = 0; v < Math.min(nNodes, 30); v++) {
        const at = v * 8;
        out.push(t.sankeyNode(name(v), f(meta.nodes[at + 1]), f(meta.nodes[at + 2]), f(meta.nodes[at + 3])));
      }
      return out;
    },
    step(focus, key) {
      if (!nLinks) return null;
      const delta: Record<string, number> = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, PageUp: 10, PageDown: -10, Home: -Infinity, End: Infinity };
      if (!(key in delta)) return null;
      if (!focus) return { series: 1, index: key === 'End' ? nLinks - 1 : 0 };
      return { series: 1, index: Math.max(0, Math.min(nLinks - 1, focus.index + delta[key])) };
    },
    key: () => null,
    announce(focus) {
      const l = link(focus.index);
      const share = Number.isFinite(l.share) ? shareText(l.share, locale, 1) : null;
      return t.linkAnnounce(name(l.s), name(l.t), f(l.value), share, num(focus.index + 1), num(nLinks));
    },
    table(pick) {
      const rows = pick(nLinks).map((l): ChartDataCell[] => {
        const k = link(l);
        return [name(k.s), name(k.t), Number.isFinite(k.value) ? k.value : null, Number.isFinite(k.share) ? Math.round(k.share * 100) / 100 : null];
      });
      return {
        columns: [t.source, t.target, meta.valueLabel, t.shareOfSource],
        rows,
        totalRows: nLinks,
        sampled: rows.length < nLinks,
        formats: [undefined, undefined, undefined, (x) => shareText(x, locale, 2)],
      };
    },
    hover(focus) {
      return meta.engine?.hover(1, focus.index);
    },
  };
  const gray: RgbaTuple = [0.5, 0.5, 0.5, 1];
  return {
    kind: 'sankey',
    ...common,
    series: [{ name: meta.valueLabel, values: Float64Array.from({ length: nLinks }, (_, l) => link(l).value), visible: true, f32: false }],
    length: nLinks,
    custom,
    xValue: (l) => `${name(link(l).s)} → ${name(link(l).t)}`,
    xLabel: (l) => `${name(link(l).s)} → ${name(link(l).t)}`,
    formatX: (l) => String(l),
    pointId: (_s, l) => nNodes + l,
    itemName: (_s, l) => `${name(link(l).s)} → ${name(link(l).t)}`,
    itemColor: (_s, l) => (meta.nodeColors.length ? rgbaAt(meta.nodeColors, link(l).s) : gray),
  };
}

// ---------------------------------------------------------------------------
// DOM labels, breadcrumb, sunburst center
// ---------------------------------------------------------------------------

/** WCAG relative luminance of an RGBA tuple (sRGB 0-1). */
function luminance(c: RgbaTuple): number {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

/** Text color with the better contrast on a fill. */
function textOn(c: RgbaTuple): string {
  return luminance(c) < 0.18 ? '#ffffff' : '#0b0b0b';
}

/** Header strips are the node color mixed halfway toward the surface (treemap.rs `HEADER_FADE`). */
function mixRgba(a: RgbaTuple, b: RgbaTuple, t: number): RgbaTuple {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1];
}

/** Shortens `text` to about `px` CSS px of 11 px UI text (JS, so the PNG export matches). */
export function fitText(text: string, px: number, charPx = 6.8): string {
  const max = Math.floor(px / charPx);
  if (max <= 0) return '';
  return text.length <= max ? text : max <= 1 ? '…' : `${text.slice(0, max - 1)}…`;
}

/**
 * DOM text of a hierarchy / flow chart: labels at the engine anchors (re-laid out only when the
 * engine's label revision changes), the drill breadcrumb (treemap / sunburst) and the sunburst
 * center (current root, or the hovered node).
 */
export class HierarchyLabelLayer {
  readonly root: HTMLDivElement;
  private readonly crumbs: HTMLDivElement | null = null;
  private readonly center: HTMLDivElement | null = null;
  private labels: HTMLDivElement[] = [];
  private revision = -1;
  private crumbKey = '';
  private centerKey = '';

  constructor(
    parent: HTMLElement,
    private readonly meta: HierarchyChartMeta | SankeyChartMeta,
    private readonly drill: (node: number) => void,
    /** Breadcrumb position (CSS px): below the title / legend rows, at the plot's left margin */
    private readonly crumbAt: { left: number; top: number } = { left: 12, top: 10 }
  ) {
    const div = (className: string, style: Partial<CSSStyleDeclaration>) => {
      const el = document.createElement('div');
      el.className = className;
      Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', ...style });
      return el;
    };
    this.root = div('charturbo-sdk-hierarchy-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    if (meta.kind !== 'sankey') {
      this.crumbs = div('charturbo-sdk-breadcrumb', { display: 'flex', alignItems: 'center', gap: '2px', fontSize: '12px', whiteSpace: 'nowrap', pointerEvents: 'auto' });
      this.crumbs.setAttribute('role', 'navigation');
      this.crumbs.setAttribute('aria-label', getMessages().hierarchy.drillPath);
      this.root.append(this.crumbs);
    }
    if (meta.kind === 'sunburst') {
      this.center = div('charturbo-sdk-sunburst-center', { transform: 'translate(-50%, -50%)', textAlign: 'center', display: 'none' });
      this.root.append(this.center);
    }
    parent.appendChild(this.root);
  }

  /** Forces a re-layout on the next `update` (theme / locale / drill). */
  invalidate(): void {
    this.revision = -1;
    this.crumbKey = '';
    this.centerKey = '';
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme, formatValue: (v: number) => string, locale?: string): void {
    const meta = this.meta;
    const layout = backend.chart_hierarchy_layout?.();
    const a = backend.chart_hierarchy_labels?.();
    if (a && a.length >= 2 && a[0] !== this.revision) {
      this.revision = a[0];
      const count = Math.min(a[1], Math.floor((a.length - 2) / 6));
      for (let k = 0; k < count; k++) {
        const at = 2 + k * 6;
        const [node, x, y, w, h, flags] = [a[at], a[at + 1], a[at + 2], a[at + 3], a[at + 4], a[at + 5]];
        let el = this.labels[k];
        if (!el) {
          el = document.createElement('div');
          el.className = 'charturbo-sdk-hierarchy-label';
          Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', fontSize: '11px', lineHeight: '14px', fontVariantNumeric: 'tabular-nums' });
          this.root.appendChild(el);
          this.labels.push(el);
        }
        el.style.display = 'block';
        el.replaceChildren();
        const fill = meta.nodeColors.length > node * 4 + 3 ? rgbaAt(meta.nodeColors, node) : ([0.5, 0.5, 0.5, 1] as RgbaTuple);
        const name = meta.nodeNames[node] ?? '';
        const f = meta.label?.formatter;
        if (f) {
          this.placeRich(el, meta, node, name, f, fill, [x, y, w, h, flags], theme);
          continue;
        }
        // A stub like "ab…" says nothing: such cells stay unlabeled (tooltip / table)
        const fitted = meta.kind === 'sankey' ? name : fitText(name, w);
        if (fitted.endsWith('…') && fitted.length < 5) {
          el.style.display = 'none';
          continue;
        }
        if (meta.kind === 'treemap') {
          const header = (flags & 1) === 1;
          const bg = header ? mixRgba(fill, theme.surface, 0.5) : fill;
          Object.assign(el.style, {
            left: `${x}px`,
            top: `${y}px`,
            width: `${w}px`,
            height: `${h}px`,
            transform: 'none',
            color: textOn(bg),
            fontWeight: header ? '600' : '500',
            lineHeight: header ? `${h}px` : '14px',
            textAlign: 'left',
          });
          const line = document.createElement('div');
          line.textContent = fitted;
          el.append(line);
          if ((flags & 2) === 2) {
            const value = document.createElement('div');
            value.textContent = fitText(formatValue(meta.values[node]), w);
            value.style.opacity = '0.8';
            el.append(value);
          }
        } else if (meta.kind === 'sunburst') {
          Object.assign(el.style, {
            left: `${x}px`,
            top: `${y}px`,
            width: 'auto',
            height: 'auto',
            transform: 'translate(-50%, -50%)',
            color: textOn(fill),
            fontWeight: '500',
            textAlign: 'center',
          });
          el.textContent = fitted;
        } else {
          const value = meta.nodes[node * 8 + 1];
          const nameEl = document.createElement('span');
          nameEl.textContent = name;
          nameEl.style.color = theme.textSecondary;
          const valueEl = document.createElement('span');
          // Margin, not a leading space: PNG export trims text nodes but keeps their boxes
          valueEl.textContent = formatValue(value);
          valueEl.style.color = theme.textMuted;
          valueEl.style.marginLeft = '4px';
          el.append(nameEl, valueEl);
          Object.assign(el.style, {
            left: `${x}px`,
            top: `${y}px`,
            width: 'auto',
            height: 'auto',
            // Horizontal: beside the bar (1 right, -1 left); vertical: centered below (2) / above (-2)
            transform: flags === 2 ? 'translate(-50%, 0)' : flags === -2 ? 'translate(-50%, -100%)' : flags > 0 ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
            fontWeight: '400',
            overflow: 'visible',
          });
        }
      }
      for (let k = count; k < this.labels.length; k++) this.labels[k].style.display = 'none';
    }
    if (meta.kind === 'sankey' || !layout || layout.length < 10) return;
    this.updateCrumbs(meta, layout, theme, locale);
    this.updateCenter(meta, layout, theme, formatValue, locale);
  }

  /** Formatter label (rich text) at an engine anchor: same box / anchor as the default label. */
  private placeRich(
    el: HTMLDivElement,
    meta: HierarchyChartMeta | SankeyChartMeta,
    node: number,
    name: string,
    f: (ctx: HierarchyLabelContext) => string,
    fill: RgbaTuple,
    [x, y, w, h, flags]: number[],
    theme: CharturboTheme
  ): void {
    const ctx: HierarchyLabelContext =
      meta.kind === 'sankey'
        ? { name, value: meta.nodes[node * 8 + 1], column: meta.nodes[node * 8] }
        : { name, value: meta.values[node], depth: Math.max(0, hierarchyPath(meta, node).length - 1) };
    const lines = parseRichText(f(ctx), meta.label?.rich);
    const header = meta.kind === 'treemap' && (flags & 1) === 1;
    // Header strips are one line high: the template's first line, centered in the strip
    renderRichText(el, header ? lines.slice(0, 1) : lines, meta.label?.rich);
    if (meta.kind === 'treemap') {
      const bg = header ? mixRgba(fill, theme.surface, 0.5) : fill;
      Object.assign(el.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
        transform: 'none',
        color: textOn(bg),
        fontWeight: header ? '600' : '500',
        lineHeight: header ? `${h}px` : '14px',
        textAlign: 'left',
      });
    } else if (meta.kind === 'sunburst') {
      Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: 'auto', height: 'auto', transform: 'translate(-50%, -50%)', color: textOn(fill), fontWeight: '500', textAlign: 'center' });
    } else {
      Object.assign(el.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: 'auto',
        height: 'auto',
        transform: flags === 2 ? 'translate(-50%, 0)' : flags === -2 ? 'translate(-50%, -100%)' : flags > 0 ? 'translate(0, -50%)' : 'translate(-100%, -50%)',
        color: theme.textSecondary,
        fontWeight: '400',
        overflow: 'visible',
      });
    }
  }

  private updateCrumbs(meta: HierarchyChartMeta, layout: Float64Array, theme: CharturboTheme, locale?: string): void {
    const el = this.crumbs;
    if (!el) return;
    const root = layout[0];
    const { left, top } = this.crumbAt;
    const key = `${root}|${theme.name}|${locale}`;
    if (key === this.crumbKey) return;
    this.crumbKey = key;
    el.setAttribute('aria-label', getMessages(locale).hierarchy.drillPath);
    // From the top root (synthetic or not) down to the current root
    const chain: number[] = [];
    for (let v = root, guard = 0; v >= 0 && guard <= meta.nodeNames.length; guard++, v = hierarchyParent(meta, v)) chain.push(v);
    chain.reverse();
    el.replaceChildren();
    Object.assign(el.style, { left: `${left}px`, top: `${top}px` });
    chain.forEach((v, k) => {
      const last = k === chain.length - 1;
      const name = nodeName(meta.nodeNames, v, locale);
      if (k > 0) {
        const sep = document.createElement('span');
        sep.textContent = '›';
        sep.setAttribute('aria-hidden', 'true');
        Object.assign(sep.style, { color: theme.textMuted, padding: '0 4px' });
        el.append(sep);
      }
      if (last) {
        const cur = document.createElement('span');
        cur.textContent = fitText(name, 220, 7);
        cur.setAttribute('aria-current', 'location');
        Object.assign(cur.style, { color: theme.textPrimary, fontWeight: '600' });
        el.append(cur);
      } else {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'charturbo-sdk-breadcrumb-item';
        b.textContent = fitText(name, 160, 7);
        Object.assign(b.style, { border: 'none', background: 'none', padding: '0', font: 'inherit', color: theme.textSecondary, cursor: 'pointer', textDecoration: 'underline' });
        b.addEventListener('click', () => this.drill(v));
        el.append(b);
      }
    });
  }

  private updateCenter(meta: HierarchyChartMeta, layout: Float64Array, theme: CharturboTheme, formatValue: (v: number) => string, locale?: string): void {
    const el = this.center;
    if (!el) return;
    const [root, , , , , cx, cy, r, hs, hi] = layout;
    const hovered = hs === 0 && hi >= 0 && hi !== root ? hi : -1;
    const key = `${root}|${cx}|${cy}|${r}|${hovered}|${theme.name}`;
    if (key === this.centerKey) return;
    this.centerKey = key;
    if (r < 26) {
      el.style.display = 'none';
      return;
    }
    const node = hovered >= 0 ? hovered : root;
    const width = 1.8 * r;
    Object.assign(el.style, { display: 'block', left: `${cx}px`, top: `${cy}px`, maxWidth: `${width}px` });
    el.replaceChildren();
    const value = document.createElement('div');
    value.textContent = fitText(formatValue(meta.values[node]), width, r >= 48 ? 10.5 : 7.8);
    Object.assign(value.style, { fontSize: r >= 48 ? '18px' : '13px', fontWeight: '600', color: theme.textPrimary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' });
    const caption = document.createElement('div');
    const name = meta.nodeNames[node] ?? '';
    const share = hovered >= 0 ? ` · ${formatShare(pct(meta.values[node], meta.values[root]), locale)}` : '';
    caption.textContent = fitText(name, width - (share ? 40 : 0)) + share;
    Object.assign(caption.style, { fontSize: '11px', color: theme.textMuted, whiteSpace: 'nowrap' });
    el.append(value, caption);
  }

  remove(): void {
    this.root.remove();
  }
}

/** Path names of node `v` (drill events). */
export function drillEvent(meta: HierarchyChartMeta, node: number): CharturboDrillEvent {
  // Same path as the tooltip (a synthetic root only when it is the node itself)
  const path = hierarchyPath(meta, node);
  if (!path.length) path.push(node);
  return {
    kind: meta.kind,
    node,
    id: meta.ids[node],
    name: nodeName(meta.nodeNames, node),
    path: path.map((v) => nodeName(meta.nodeNames, v)),
  };
}

/** Node index of a drill target: an index, or a flat input id / node name (first match). */
export function resolveHierarchyNode(meta: HierarchyChartMeta, target: number | string): number {
  if (typeof target === 'number') return Number.isInteger(target) && target >= 0 && target < meta.nodeNames.length ? target : -1;
  const byId = meta.ids.findIndex((id) => id !== undefined && String(id) === target);
  return byId >= 0 ? byId : meta.nodeNames.indexOf(target);
}

/** Node details (`getNodeDetails`) of a hierarchy node / sankey node or link. */
export function hierarchyDetails(meta: HierarchyChartMeta | SankeyChartMeta, id: number): { label: string; color: RgbaTuple; series: number; tags: string[]; attributes: Record<string, string | number> } | null {
  if (meta.kind === 'sankey') {
    const n = meta.nodeNames.length;
    if (id < n) {
      const at = id * 8;
      if (at + 3 >= meta.nodes.length) return null;
      return {
        label: meta.nodeNames[id],
        color: rgbaAt(meta.nodeColors, id),
        series: 0,
        tags: ['sankey', 'node'],
        attributes: { column: meta.nodes[at], value: meta.nodes[at + 1], inflow: meta.nodes[at + 2], outflow: meta.nodes[at + 3] },
      };
    }
    const l = id - n;
    const at = l * 4;
    if (at + 3 >= meta.links.length) return null;
    const [s, t] = [meta.links[at], meta.links[at + 1]];
    return {
      label: `${meta.nodeNames[s]} → ${meta.nodeNames[t]}`,
      color: rgbaAt(meta.nodeColors, s),
      series: 1,
      tags: ['sankey', 'link'],
      attributes: { source: meta.nodeNames[s], target: meta.nodeNames[t], value: meta.links[at + 2], percentOfSource: Number(meta.links[at + 3].toFixed(2)) },
    };
  }
  const info = hierarchyNodeInfo(meta, id);
  if (!info) return null;
  return {
    label: info.path.join(' › '),
    color: rgbaAt(meta.nodeColors, id),
    series: 0,
    tags: [meta.kind, info.children ? 'parent' : 'leaf'],
    attributes: {
      name: info.name,
      value: info.value,
      depth: info.depth,
      ...(Number.isFinite(info.percentOfParent) ? { percentOfParent: Number(info.percentOfParent.toFixed(2)) } : {}),
      ...(Number.isFinite(info.percentOfTotal) ? { percentOfTotal: Number(info.percentOfTotal.toFixed(2)) } : {}),
    },
  };
}
