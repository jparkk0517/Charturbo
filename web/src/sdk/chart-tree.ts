/**
 * Tidy tree (node-link) bindings. The engine owns the layout (tidy_tree.rs: d3-hierarchy
 * `tree()` coordinates, orthogonal or radial, curve / elbow edges), expand / collapse with
 * relayout and tweened toggles, hit-testing and label anchors that do not overlap. This module
 * encodes the input (the hierarchy shapes plus `collapsed`), mirrors names / values / expanded
 * state for the tooltip, a11y model and events, and places DOM labels at the engine anchors.
 */
import type { RgbaTuple } from './color';
import type { A11yChartModel, ChartDataCell } from './chart-a11y';
import type { A11yCommon } from './chart-business-util';
import {
  encodeHierarchy,
  fitText,
  nameEngineError,
  type A11yCustom,
  type ChartHierarchyTooltip,
  type HierarchyChartOptions,
  type HierarchyFlatNode,
  type HierarchyNode,
} from './chart-hierarchy';
import type { ChartTooltipContext, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { formatCount, getMessages } from './i18n';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Nested tree node (`value` optional, shown as is: parents do not sum their children). */
export interface TreeChartNode extends Omit<HierarchyNode, 'children'> {
  children?: TreeChartNode[];
  /** Start collapsed (`false`: start expanded); overrides `initialTreeDepth` */
  collapsed?: boolean;
}

/** Flat tree row (`parent` = another row's `id`; several roots get a synthetic `rootLabel` root). */
export interface TreeChartFlatNode extends HierarchyFlatNode {
  collapsed?: boolean;
}

export type TreeChartData = TreeChartNode | TreeChartFlatNode[];

export interface TreeChartOptions extends Pick<HierarchyChartOptions, 'title' | 'description' | 'colors' | 'format' | 'labels' | 'padding' | 'valueLabel' | 'rootLabel'> {
  /** `'orthogonal'` (default) or `'radial'` (root in the center, leaves on the rim) */
  layout?: 'orthogonal' | 'radial';
  /** Orthogonal direction root → leaves: left-right (default), right-left, top-bottom, bottom-top */
  orient?: 'LR' | 'RL' | 'TB' | 'BT';
  /** `'curve'` (cubic bezier, default) or `'polyline'` (elbow; the radial layout always curves) */
  edgeShape?: 'curve' | 'polyline';
  /** Levels expanded at first (root = 0; default 2; -1 = all); `collapsed` per node wins */
  initialTreeDepth?: number;
  /** Node symbol (default `'emptyCircle'`: hollow; collapsed parents are filled) */
  symbol?: 'emptyCircle' | 'circle' | 'rect' | 'diamond' | 'triangle' | 'none';
  /** Symbol diameter in CSS px (default 7) */
  symbolSize?: number;
  /** Edge width in CSS px (default 1.5) */
  lineWidth?: number;
  /** Bezier control offset 0-1 (default 0.5) */
  curvature?: number;
  /** `'single'` (default): one color; `'group'`: palette by top-level branch */
  colorBy?: 'single' | 'group';
  /** Click / Enter / Space expand and collapse parents (default: true) */
  expandAndCollapse?: boolean;
}

/** `'treeToggle'` event: a tree node was expanded or collapsed (click, keyboard, API). */
export interface CharturboTreeToggleEvent {
  node: number;
  /** Flat input `id` (tree input: undefined) */
  id?: string | number;
  name: string;
  path: string[];
  expanded: boolean;
}

/** Display state of a tidy tree (names, raw values, expanded flags mirror the engine). */
export interface TreeChartMeta {
  kind: 'tree';
  /** No legend */
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  /** Per node (a synthetic root is last) */
  nodeNames: string[];
  ids: (string | number | undefined)[];
  parents: Int32Array;
  /** Input value per node (NaN = none) */
  values: Float64Array;
  nodeColors: Float32Array;
  inputColors: (ColorInputLike | undefined)[];
  treeRoot: number;
  /** Children per node in input order (the synthetic root's: the input roots) */
  children: number[][];
  depth: Int32Array;
  expanded: boolean[];
  valueLabel: string;
  palette?: ColorInputLike[];
  colormap: number;
  labels: boolean;
  layout: 'orthogonal' | 'radial';
  expandAndCollapse: boolean;
  labelOptions: { valueLabel?: string; rootLabel?: string };
  engine?: { hover(series: number, index: number): Float64Array | undefined; toggle(node: number): boolean };
}

type ColorInputLike = NonNullable<HierarchyNode['color']>;

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

const ORIENT: Record<string, number> = { LR: 0, RL: 1, TB: 2, BT: 3 };
const SYMBOL: Record<string, number> = { emptyCircle: 0, circle: 1, rect: 2, diamond: 3, triangle: 4, none: 5 };
const opt = (v: number | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
/** Label width estimate of 11 px UI text (matches `fitText`) */
const CHAR_PX = 6.8;
const MAX_LABEL_PX = 160;

/** Collapsed state per encoded node (depth-first for nested input, row order for flat rows). */
function collapsedFlags(data: TreeChartData): (boolean | undefined)[] {
  if (Array.isArray(data)) return data.map((r) => r.collapsed);
  const out: (boolean | undefined)[] = [];
  const stack: TreeChartNode[] = data && typeof data === 'object' ? [data] : [];
  while (stack.length) {
    const node = stack.pop()!;
    out.push(node.collapsed);
    const kids = node.children ?? [];
    for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]);
  }
  return out;
}

/** Uploads a tidy tree; returns the meta (expanded state / colors filled by `syncTree`). */
export function sendTree(backend: WasmCharturboEngineBackend, data: TreeChartData, options?: TreeChartOptions, locale?: string): TreeChartMeta {
  const enc = encodeHierarchy(data as Parameters<typeof encodeHierarchy>[0], locale);
  const o = options ?? {};
  const n = enc.parents.length;
  const flags = collapsedFlags(data);
  const state = new Uint8Array(n);
  for (let i = 0; i < n; i++) state[i] = flags[i] === true ? 2 : flags[i] === false ? 1 : 0;
  const labels = o.labels ?? true;
  const m = getMessages(locale);
  const rootLabel = o.rootLabel ?? m.hierarchy.rootLabel;
  const names = [...enc.names, rootLabel];
  const labelPx = new Float32Array(n + 1);
  names.forEach((s, i) => (labelPx[i] = Math.min(MAX_LABEL_PX, s.length * CHAR_PX)));
  const layout = o.layout === 'radial' ? 'radial' : 'orthogonal';
  const initial = o.initialTreeDepth;
  try {
    backend.set_tree_chart?.(
      enc.parents,
      state,
      labelPx,
      new Float64Array([
        layout === 'radial' ? 1 : 0,
        ORIENT[o.orient ?? 'LR'] ?? 0,
        o.edgeShape === 'polyline' ? 1 : 0,
        typeof initial === 'number' && Number.isFinite(initial) ? Math.floor(initial) : NaN,
        SYMBOL[o.symbol ?? 'emptyCircle'] ?? 0,
        opt(o.symbolSize),
        opt(o.lineWidth),
        opt(o.curvature),
        o.colorBy === 'group' ? 1 : 0,
        labels ? 1 : 0,
        14,
      ])
    );
  } catch (e) {
    throw nameEngineError(e, enc.names);
  }
  // Children in input order, depth per node (a synthetic root last, above the input roots)
  const children: number[][] = Array.from({ length: n + 1 }, () => []);
  const roots: number[] = [];
  for (let i = 0; i < n; i++) (enc.parents[i] < 0 ? roots : children[enc.parents[i]]).push(i);
  const treeRoot = roots.length === 1 ? roots[0] : n;
  children[n] = roots.length === 1 ? [] : roots;
  const depth = new Int32Array(n + 1);
  const order = [treeRoot];
  for (let k = 0; k < order.length; k++) {
    const v = order[k];
    for (const c of children[v]) {
      depth[c] = depth[v] + 1;
      order.push(c);
    }
  }
  if (treeRoot !== n) names.length = n;
  return {
    kind: 'tree',
    names: [],
    colors: [],
    visible: [],
    nodeNames: names,
    ids: enc.ids,
    parents: enc.parents,
    values: Float64Array.from(enc.values, (v) => (Number.isFinite(v) ? v : NaN)),
    nodeColors: new Float32Array(0),
    inputColors: enc.colors as (ColorInputLike | undefined)[],
    treeRoot,
    children,
    depth,
    expanded: [],
    valueLabel: o.valueLabel ?? m.common.value,
    palette: o.colors as ColorInputLike[] | undefined,
    colormap: 0,
    labels,
    layout,
    expandAndCollapse: o.expandAndCollapse ?? true,
    labelOptions: { valueLabel: o.valueLabel, rootLabel: o.rootLabel },
  };
}

/** Re-reads colors and expanded flags; default value / root names follow `locale`. */
export function syncTree(backend: WasmCharturboEngineBackend, meta: TreeChartMeta, locale?: string): void {
  const m = getMessages(locale);
  meta.valueLabel = meta.labelOptions.valueLabel ?? m.common.value;
  if (meta.treeRoot >= meta.parents.length && meta.labelOptions.rootLabel === undefined) meta.nodeNames[meta.treeRoot] = m.hierarchy.rootLabel;
  meta.nodeColors = backend.chart_hierarchy_colors?.() ?? meta.nodeColors;
  syncTreeState(backend, meta);
}

/** Re-reads the expanded flags (after a toggle). */
export function syncTreeState(backend: WasmCharturboEngineBackend, meta: TreeChartMeta): void {
  const e = backend.chart_tree_expanded?.();
  if (e) meta.expanded = Array.from(e, (x) => x === 1);
}

/** Parent of `node` (input roots of a multi-root input: the synthetic root). */
export function treeParent(meta: TreeChartMeta, node: number): number {
  if (node < 0 || node >= meta.parents.length) return -1;
  const p = meta.parents[node];
  return p < 0 && meta.treeRoot >= meta.parents.length ? meta.treeRoot : p;
}

/** Shown: every ancestor expanded. */
export function treeVisible(meta: TreeChartMeta, node: number): boolean {
  if (node < 0 || node >= meta.nodeNames.length) return false;
  for (let v = treeParent(meta, node), guard = 0; v >= 0 && guard <= meta.nodeNames.length; v = treeParent(meta, v), guard++) {
    if (meta.expanded[v] === false) return false;
  }
  return true;
}

const nodeName = (meta: TreeChartMeta, v: number, locale?: string) => meta.nodeNames[v] ?? getMessages(locale).common.itemName(v + 1);

/** Node indices from the top root down to `node` (a synthetic root excluded). */
export function treePath(meta: TreeChartMeta, node: number): number[] {
  const out: number[] = [];
  for (let v = node, guard = 0; v >= 0 && guard <= meta.nodeNames.length; guard++, v = treeParent(meta, v)) {
    if (v < meta.parents.length || v === node) out.push(v);
  }
  return out.reverse();
}

const rgbaAt = (a: ArrayLike<number>, i: number): RgbaTuple =>
  a.length > i * 4 + 3 ? [a[i * 4], a[i * 4 + 1], a[i * 4 + 2], a[i * 4 + 3]] : [0.5, 0.5, 0.5, 1];

/** Tooltip data (`hierarchy` context; shares are NaN: tree values do not partition). */
export function treeNodeInfo(meta: TreeChartMeta, node: number): ChartHierarchyTooltip | null {
  if (!Number.isInteger(node) || node < 0 || node >= meta.nodeNames.length) return null;
  return {
    node,
    name: nodeName(meta, node),
    path: treePath(meta, node).map((v) => nodeName(meta, v)),
    value: meta.values[node] ?? NaN,
    percentOfParent: NaN,
    percentOfTotal: NaN,
    depth: meta.depth[node] ?? 0,
    children: meta.children[node]?.length ?? 0,
  };
}

export function treeTooltipContext(meta: TreeChartMeta, node: number, cssColor: (c: RgbaTuple) => string): ChartTooltipContext | null {
  const info = treeNodeInfo(meta, node);
  if (!info) return null;
  return {
    chartType: 'tree',
    index: node,
    xLabel: info.path.join(' › '),
    items: [{ seriesName: info.name, value: info.value, color: cssColor(rgbaAt(meta.nodeColors, node)), nodeId: node }],
    hierarchy: info,
    details: null,
  };
}

/** `'treeToggle'` payload of `node`. */
export function treeToggleEvent(meta: TreeChartMeta, node: number): CharturboTreeToggleEvent {
  return {
    node,
    id: meta.ids[node],
    name: nodeName(meta, node),
    path: treePath(meta, node).map((v) => nodeName(meta, v)),
    expanded: meta.expanded[node] === true,
  };
}

/** Node index of a target: an index, or a flat input id / node name (first match). */
export function resolveTreeNode(meta: TreeChartMeta, target: number | string): number {
  if (typeof target === 'number') return Number.isInteger(target) && target >= 0 && target < meta.nodeNames.length ? target : -1;
  const byId = meta.ids.findIndex((id) => id !== undefined && String(id) === target);
  return byId >= 0 ? byId : meta.nodeNames.indexOf(target);
}

/** Node details (`getNodeDetails`). */
export function treeDetails(meta: TreeChartMeta, id: number): { label: string; color: RgbaTuple; series: number; tags: string[]; attributes: Record<string, string | number> } | null {
  const info = treeNodeInfo(meta, id);
  if (!info) return null;
  const parent = info.children > 0;
  return {
    label: info.path.join(' › '),
    color: rgbaAt(meta.nodeColors, id),
    series: 0,
    tags: ['tree', parent ? 'parent' : 'leaf', ...(parent ? [meta.expanded[id] ? 'expanded' : 'collapsed'] : [])],
    attributes: { name: info.name, depth: info.depth, ...(Number.isFinite(info.value) ? { value: info.value } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Accessibility model
// ---------------------------------------------------------------------------

/** A11y model of a tidy tree: arrows walk the shown nodes, Enter / Space toggle. */
export function treeA11yModel(meta: TreeChartMeta, common: A11yCommon): A11yChartModel {
  const f = common.formatValue;
  const locale = common.locale;
  const msg = getMessages(locale);
  const t = msg.tree;
  const h = msg.hierarchy;
  const num = (n: number) => formatCount(n, locale);
  const name = (v: number) => nodeName(meta, v, locale);
  const value = (v: number) => (Number.isFinite(meta.values[v]) ? f(meta.values[v]) : null);
  const kids = (v: number) => meta.children[v] ?? [];
  const shownKids = (v: number) => (meta.expanded[v] ? kids(v) : []);
  const count = meta.parents.length;
  const levels = () => {
    // Loops, not spreads: big trees would overflow the argument limit
    const base = meta.depth[meta.treeRoot] ?? 0;
    let max = 0;
    for (let i = 0; i < count; i++) max = Math.max(max, meta.depth[i] - base);
    return max + 1;
  };
  const shownCount = () => {
    let k = 0;
    const stack = [meta.treeRoot];
    while (stack.length) {
      const v = stack.pop()!;
      if (v < count) k++;
      for (const c of shownKids(v)) stack.push(c);
    }
    return k;
  };
  const stateText = (v: number) => {
    const k = kids(v).length;
    return k ? t.state(meta.expanded[v] ? t.expanded : t.collapsed, h.children(k, num(k))) : null;
  };
  const custom: A11yCustom = {
    kindLabel: msg.common.kind.tree,
    help: t.help,
    summary() {
      const top = kids(meta.treeRoot);
      const n = levels();
      const shown = shownCount();
      const text = t.summary(
        t.treeName,
        h.nodes(count, num(count)),
        t.levels(n, num(n)),
        num(shown),
        name(meta.treeRoot),
        top.length ? top.slice(0, 3).map(name).join(msg.common.listSeparator) : null,
        top.length > 3 ? num(top.length - 3) : null
      );
      return common.title ? h.titled(common.title, text) : text;
    },
    description() {
      return kids(meta.treeRoot)
        .slice(0, 20)
        .map((c) => t.item(name(c), value(c), h.children(kids(c).length, num(kids(c).length))));
    },
    step(focus, key) {
      const handled = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'];
      if (!handled.includes(key)) return null;
      const root = meta.treeRoot;
      if (!focus || !treeVisible(meta, focus.index)) return { series: 0, index: root };
      const v = focus.index;
      if (key === 'ArrowRight') {
        const c = shownKids(v);
        return c.length ? { series: 0, index: c[0] } : focus;
      }
      if (key === 'ArrowLeft') {
        const p = treeParent(meta, v);
        return p >= 0 ? { series: 0, index: p } : focus;
      }
      const p = treeParent(meta, v);
      const sib = p >= 0 ? kids(p) : [v];
      let k = sib.indexOf(v);
      k += key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : key === 'PageUp' ? -10 : key === 'PageDown' ? 10 : key === 'Home' ? -Infinity : Infinity;
      return { series: 0, index: sib[Math.max(0, Math.min(sib.length - 1, k))] };
    },
    key(focus, key) {
      if ((key !== 'Enter' && key !== ' ') || !focus || !meta.expandAndCollapse || !kids(focus.index).length) return null;
      if (!meta.engine?.toggle(focus.index)) return null;
      return { focus };
    },
    announce(focus) {
      const v = focus.index;
      if (v < 0 || v >= meta.nodeNames.length) return '';
      const p = treeParent(meta, v);
      const sib = p >= 0 ? kids(p) : [v];
      const parts = [t.nodeAnnounce(name(v), value(v), stateText(v)), h.nodePosition(num(sib.indexOf(v) + 1), num(sib.length), num(meta.depth[v] ?? 0))];
      if (kids(v).length && meta.expandAndCollapse) parts.push(t.toggleHint(meta.expanded[v] === true));
      return parts.join(h.sentenceSeparator);
    },
    table(pick) {
      // Every node in input order (tree input: depth-first), the synthetic root excluded
      const rows = pick(count).map((v): ChartDataCell[] => {
        const k = kids(v).length;
        const state = k ? (meta.expanded[v] ? t.expanded : t.collapsed) : t.leaf;
        return [treePath(meta, v).map(name).join(' › '), Number.isFinite(meta.values[v]) ? meta.values[v] : null, meta.depth[v] ?? 0, state];
      });
      return { columns: [h.path, meta.valueLabel, t.depth, t.stateHeader], rows, totalRows: count, sampled: rows.length < count };
    },
    hover(focus) {
      return meta.engine?.hover(0, focus.index);
    },
  };
  return {
    kind: 'tree',
    ...common,
    series: [{ name: meta.valueLabel, values: meta.values, visible: true, f32: false }],
    length: meta.nodeNames.length,
    custom,
    xValue: name,
    xLabel: name,
    formatX: name,
    pointId: (_s, i) => i,
    itemName: (_s, i) => name(i),
    itemColor: (_s, i) => rgbaAt(meta.nodeColors, i),
  };
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * DOM labels of a tidy tree at the engine anchors (re-laid out only when the engine's label
 * revision changes): `w` = rotation (radians), `h` = room (CSS px), flags 1 = text starts at
 * the anchor, -1 = ends there, 0 = centered.
 */
export class TreeLabelLayer {
  readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;
  private themeKey = '';

  constructor(
    parent: HTMLElement,
    private readonly meta: TreeChartMeta
  ) {
    this.root = document.createElement('div');
    this.root.className = 'charturbo-sdk-tree-labels';
    Object.assign(this.root.style, { position: 'absolute', pointerEvents: 'none', left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

  /** Forces a re-layout on the next `update` (theme / locale / toggle). */
  invalidate(): void {
    this.revision = -1;
  }

  update(backend: WasmCharturboEngineBackend, theme: CharturboTheme): void {
    const a = backend.chart_hierarchy_labels?.();
    if (!a || a.length < 2) return;
    if (a[0] === this.revision && theme.name === this.themeKey) return;
    this.revision = a[0];
    this.themeKey = theme.name;
    const count = Math.min(a[1], Math.floor((a.length - 2) / 6));
    let used = 0;
    for (let k = 0; k < count; k++) {
      const at = 2 + k * 6;
      const [node, x, y, rot, room, flags] = [a[at], a[at + 1], a[at + 2], a[at + 3], a[at + 4], a[at + 5]];
      // +0.5: the engine room is the f32 width estimate, which may round just under it
      const text = fitText(this.meta.nodeNames[node] ?? '', room + 0.5, CHAR_PX);
      if (!text || (text.endsWith('…') && text.length < 4)) continue;
      let el = this.labels[used];
      if (!el) {
        el = document.createElement('div');
        el.className = 'charturbo-sdk-tree-label';
        Object.assign(el.style, { position: 'absolute', pointerEvents: 'none', whiteSpace: 'nowrap', fontSize: '11px', lineHeight: '14px', transformOrigin: '0 0' });
        this.root.appendChild(el);
        this.labels.push(el);
      }
      used++;
      const dx = flags > 0 ? '0' : flags < 0 ? '-100%' : '-50%';
      Object.assign(el.style, {
        display: 'block',
        left: `${x}px`,
        top: `${y}px`,
        color: theme.textSecondary,
        transform: rot ? `rotate(${rot.toFixed(4)}rad) translate(${dx}, -50%)` : `translate(${dx}, -50%)`,
      });
      el.textContent = text;
    }
    for (let k = used; k < this.labels.length; k++) this.labels[k].style.display = 'none';
  }

  remove(): void {
    this.root.remove();
  }
}
