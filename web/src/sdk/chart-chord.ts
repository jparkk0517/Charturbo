/**
 * Chord diagram binding. The engine owns the layout (chord.rs, a port of d3-chord `chord()` /
 * `chordDirected()`): group arcs, ribbons, hover hit test, emphasis, legend toggle re-layout and
 * label anchors. This module validates the flow matrix (or converts ECharts-style nodes / links),
 * encodes the options, mirrors groups / chords for the tooltip and a11y, and places the group
 * names at the engine anchors.
 */
import { parseOptionalColor, type ColorInput, type RgbaTuple } from './color';
import type { ChartValueFormat } from './chart-format';
import type { A11yChartModel, ChartDataTable } from './chart-a11y';
import type { ChartLegendOptions, ChartPaddingOptions, ChartTooltipContext, NodeMetadata, CharturboTheme, WasmCharturboEngineBackend } from './charturbo';
import { esc, overlayDiv, rgbCss, tooltipHeader, tooltipRow, type A11yCommon, type A11yCustomModel, type BusinessLabelLayer } from './chart-business-util';
import { formatCount, getMessages } from './i18n';

/** Most groups (chord.rs `MAX_CHORD_GROUPS`) */
const MAX_GROUPS = 256;
/** Average label glyph width (CSS px, 11 px text) */
const CHAR_PX = 6.8;
const DEG = Math.PI / 180;

export type ChordSortOrder = 'none' | 'ascending' | 'descending';

/** ECharts-style group: a name, optionally its own color. */
export interface ChordNode {
  name: string;
  color?: ColorInput;
}

/** Flow from `source` to `target` (node name or index); repeated links add up. */
export interface ChordLink {
  source: string | number;
  target: string | number;
  value: number;
}

/**
 * Square flow matrix (`matrix[i][j]` = flow from group i to group j; finite, >= 0, not all zero)
 * with optional group names, or ECharts-style `nodes` and `links`.
 */
export type ChordChartData =
  | { matrix: ArrayLike<ArrayLike<number>>; names?: string[] }
  | { nodes: (string | ChordNode)[]; links: ChordLink[] };

export interface ChordChartOptions {
  title?: string;
  /** Accessible name of the canvas */
  description?: string;
  padding?: ChartPaddingOptions;
  /** Own color per group (default: the node colors, then the palette) */
  colors?: (ColorInput | undefined)[];
  /** Palette of the groups without their own color (default: the theme palette) */
  palette?: ColorInput[];
  /** Gap between groups in degrees (default 3) */
  padAngle?: number;
  /** Where the first group starts, degrees clockwise from 12 o'clock (default 0) */
  startAngle?: number;
  /** Groups run clockwise (default true) */
  clockwise?: boolean;
  /** Group order by total (default: input order) */
  sortGroups?: ChordSortOrder;
  /** Order of each group's ribbons by value (default: input order) */
  sortSubgroups?: ChordSortOrder;
  /** Draw order of the ribbons by their two values' sum (default: d3 order) */
  sortChords?: ChordSortOrder;
  /** One ribbon per direction (d3 `chordDirected`, arrow tips at the target; default false) */
  directed?: boolean;
  /** Ribbon color: source group (default), target group, a source-to-target gradient, or neutral */
  ribbonColor?: 'source' | 'target' | 'gradient' | 'neutral';
  /** Ribbon opacity 0-1 (default 0.6) */
  ribbonOpacity?: number;
  /** Group arc width in CSS px (default 14) */
  arcWidth?: number;
  /** Group names outside the ring (default true) */
  labels?: boolean;
  /** Names read along the radius instead of level (default false) */
  labelRotate?: boolean;
  /** Group legend: hover emphasizes a group's ribbons, click hides it (re-laid out) */
  legend?: ChartLegendOptions | boolean;
  /** Tooltip / table name of the flow values (default: `'Value'` in the chart locale) */
  valueLabel?: string;
  /** Value text of tooltip and a11y (spec, Intl options or function; default: locale number) */
  format?: ChartValueFormat;
}

/** Hovered group (`source === target`) or ribbon. */
export interface ChartChordTooltip {
  kind: 'group' | 'ribbon';
  source: number;
  target: number;
  sourceName: string;
  targetName: string;
  /** Group: its total; ribbon: the flow source → target */
  value: number;
  /** Ribbon: the flow target → source when there is one */
  reverse?: number;
}

/** A chord the engine laid out: `value` = source → target, `reverse` = target → source. */
export interface ChordFlow {
  source: number;
  target: number;
  value: number;
  reverse: number;
}

/** Display state the SDK keeps for a chord diagram. */
export interface ChordChartMeta {
  kind: 'chord';
  n: number;
  /** Row-major `n x n` flows */
  matrix: Float64Array;
  /** Encoded engine options (`set_chord_chart`) */
  options: Float64Array;
  directed: boolean;
  names: string[];
  colors: RgbaTuple[];
  visible: boolean[];
  /** Group totals of the current layout (hidden groups: 0) */
  groups: number[];
  /** Chords of the current layout, by `source * n + target` */
  chords: ChordFlow[];
  inputColors: (ColorInput | undefined)[];
  palette?: ColorInput[];
  namesInput: (string | undefined)[];
  valueLabel: string;
  format: (value: number) => string;
  locale?: string;
  valueLabelInput?: string;
  engine?: { hover(series: number, index: number): Float64Array | undefined };
}

const SORTS: Record<string, number> = { none: 0, ascending: 1, descending: 2 };
const RIBBON_COLORS: Record<string, number> = { source: 0, target: 1, gradient: 2, neutral: 3 };

function enumCode(table: Record<string, number>, v: string | undefined, d: string, what: string): number {
  const key = v ?? d;
  if (!(key in table)) throw new Error(`Chord ${what} must be one of ${Object.keys(table).join(', ')}, got ${JSON.stringify(v)}`);
  return table[key];
}

function checkFlow(v: number, where: string): void {
  if (!(Number.isFinite(v) && v >= 0)) throw new Error(`Chord ${where} must be finite and >= 0, got ${v}`);
}

/** Row-major matrix, names and node colors of the data (throws for an invalid shape / value). */
function parseData(data: ChordChartData): { n: number; matrix: Float64Array; names: (string | undefined)[]; colors: (ColorInput | undefined)[] } {
  if (data && typeof data === 'object' && 'nodes' in data && Array.isArray(data.nodes)) {
    const n = data.nodes.length;
    if (n < 1) throw new Error('Chord diagram needs at least one group');
    if (n > MAX_GROUPS) throw new Error(`Chord diagram supports at most ${MAX_GROUPS} groups, got ${n}`);
    const names = data.nodes.map((d) => (typeof d === 'string' ? d : String(d?.name ?? '')));
    const index = new Map<string, number>();
    names.forEach((name, i) => {
      if (index.has(name)) throw new Error(`Chord node name ${JSON.stringify(name)} is duplicate`);
      index.set(name, i);
    });
    const at = (x: string | number, k: number) => {
      const i = typeof x === 'number' ? (Number.isInteger(x) && x >= 0 && x < n ? x : -1) : (index.get(x) ?? -1);
      if (i < 0) throw new Error(`Chord link ${k} has an unknown node ${JSON.stringify(x)}`);
      return i;
    };
    const matrix = new Float64Array(n * n);
    (Array.isArray(data.links) ? data.links : []).forEach((l, k) => {
      const s = at(l?.source, k);
      const t = at(l?.target, k);
      const v = Number(l?.value);
      checkFlow(v, `link ${k} value`);
      matrix[s * n + t] += v;
    });
    const colors = data.nodes.map((d) => (typeof d === 'string' ? undefined : d?.color));
    return { n, matrix, names, colors };
  }
  const rows = data && typeof data === 'object' && 'matrix' in data ? data.matrix : undefined;
  if (!rows || typeof rows !== 'object' || typeof rows.length !== 'number') throw new Error('Chord data needs a square matrix (or nodes and links)');
  const n = rows.length;
  if (n < 1) throw new Error('Chord diagram needs at least one group');
  if (n > MAX_GROUPS) throw new Error(`Chord diagram supports at most ${MAX_GROUPS} groups, got ${n}`);
  const matrix = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const row = rows[i];
    if (!row || row.length !== n) throw new Error(`Chord matrix must be square: row ${i} has ${row?.length ?? 0} values, expected ${n}`);
    for (let j = 0; j < n; j++) {
      const v = Number(row[j]);
      checkFlow(v, `matrix value [${i}][${j}]`);
      matrix[i * n + j] = v;
    }
  }
  const given = (data as { names?: string[] }).names;
  if (given !== undefined && (!Array.isArray(given) || given.length !== n)) throw new Error(`Chord names must list ${n} names, got ${Array.isArray(given) ? given.length : typeof given}`);
  return { n, matrix, names: given ? given.map((s) => String(s)) : new Array<undefined>(n).fill(undefined), colors: new Array<undefined>(n).fill(undefined) };
}

/** Builds the display meta (validates data and options; nothing is sent). */
export function chordMeta(data: ChordChartData, options: ChordChartOptions | undefined, format: (v: number) => string, locale?: string): ChordChartMeta {
  const { n, matrix, names, colors } = parseData(data);
  if (!matrix.some((v) => v > 0)) throw new Error('Chord matrix needs at least one value > 0');
  const o = options ?? {};
  const pad = o.padAngle ?? 3;
  if (!(Number.isFinite(pad) && pad >= 0 && pad * n < 360)) throw new Error(`Chord padAngle must be >= 0 degrees with groups * padAngle < 360, got ${pad}`);
  const start = o.startAngle ?? 0;
  if (!Number.isFinite(start)) throw new Error(`Chord startAngle must be finite degrees, got ${start}`);
  const opacity = o.ribbonOpacity ?? 0.6;
  if (!(Number.isFinite(opacity) && opacity >= 0 && opacity <= 1)) throw new Error(`Chord ribbonOpacity must be from 0 to 1, got ${opacity}`);
  const arc = o.arcWidth ?? 14;
  if (!(Number.isFinite(arc) && arc >= 1)) throw new Error(`Chord arcWidth must be >= 1 CSS px, got ${arc}`);
  if (o.colors !== undefined && !Array.isArray(o.colors)) throw new Error('Chord colors must be an array (one color per group)');
  const sorts = [
    enumCode(SORTS, o.sortGroups, 'none', 'sortGroups'),
    enumCode(SORTS, o.sortSubgroups, 'none', 'sortSubgroups'),
    enumCode(SORTS, o.sortChords, 'none', 'sortChords'),
  ];
  const ribbon = enumCode(RIBBON_COLORS, o.ribbonColor, 'source', 'ribbonColor');
  const directed = o.directed ?? false;
  const labels = o.labels ?? true;
  const meta: ChordChartMeta = {
    kind: 'chord',
    n,
    matrix,
    options: new Float64Array(14),
    directed,
    names: [],
    colors: [],
    visible: new Array<boolean>(n).fill(true),
    groups: Array.from({ length: n }, (_, i) => {
      let s = 0;
      for (let j = 0; j < n; j++) s += matrix[i * n + j] + (directed ? matrix[j * n + i] : 0);
      return s;
    }),
    chords: [],
    inputColors: Array.from({ length: n }, (_, i) => o.colors?.[i] ?? colors[i]),
    palette: o.palette,
    namesInput: names,
    valueLabel: '',
    format,
    valueLabelInput: o.valueLabel,
  };
  // Parse every color now: sendChordStyle runs after the current chart is cleared
  for (const c of [...meta.inputColors, ...(meta.palette ?? [])]) if (c !== undefined) parseOptionalColor(c);
  localizeChordMeta(meta, locale);
  // Room for the longest name outside the ring (the engine thins colliding labels)
  const longest = Math.max(0, ...meta.names.map((s) => s.length));
  const room = labels ? Math.min(160, Math.max(24, Math.ceil(longest * CHAR_PX) + 6)) : 0;
  meta.options.set([pad * DEG, start * DEG, o.clockwise === false ? 0 : 1, ...sorts, directed ? 1 : 0, ribbon, opacity, arc, labels ? 1 : 0, o.labelRotate ? 1 : 0, room, 14]);
  return meta;
}

/** Default group names / value label in `locale` (names given in the data win). */
export function localizeChordMeta(meta: ChordChartMeta, locale: string | undefined): void {
  const { common: cm, business: bm } = getMessages(locale);
  meta.locale = locale;
  meta.names = meta.namesInput.map((s, i) => s ?? bm.chordGroup(i + 1));
  meta.valueLabel = meta.valueLabelInput ?? cm.value;
}

/** Uploads the chord diagram (`set_chord_chart`), its colors and the engine layout mirror. */
export function sendChord(backend: WasmCharturboEngineBackend, meta: ChordChartMeta, theme: CharturboTheme): number {
  const n = backend.set_chord_chart?.(meta.matrix, meta.options) ?? 0;
  sendChordStyle(backend, meta, theme);
  syncChord(backend, meta);
  return n;
}

/** Group palette / own colors and the theme surface (dimmed groups mix toward it). */
export function sendChordStyle(backend: WasmCharturboEngineBackend, meta: ChordChartMeta, theme: CharturboTheme): void {
  const own = (meta.palette ?? []).map((c) => parseOptionalColor(c)).filter((c): c is RgbaTuple => !!c);
  const pal = own.length ? own : theme.palette;
  const palette = new Float32Array(pal.length * 4);
  pal.forEach((c, k) => palette.set(c, k * 4));
  const colors = new Float32Array(meta.n * 4).fill(NaN);
  meta.inputColors.forEach((c, i) => {
    const rgba = c === undefined ? undefined : parseOptionalColor(c);
    if (rgba) colors.set(rgba, i * 4);
  });
  const highlight = parseOptionalColor(theme.textPrimary) ?? [1, 1, 1, 1];
  backend.set_chart_hierarchy_style?.(palette, colors, Float32Array.from(theme.baseline), Float32Array.from(theme.surface), Float32Array.from(highlight), 0);
  const c = backend.chart_hierarchy_colors?.();
  meta.colors = Array.from({ length: meta.n }, (_, i): RgbaTuple =>
    c && c.length >= (i + 1) * 4 ? [c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3]] : (parseOptionalColor(meta.inputColors[i]) ?? pal[i % pal.length])
  );
}

/** Re-reads the group totals and chords of the current layout (after a legend toggle). */
export function syncChord(backend: WasmCharturboEngineBackend, meta: ChordChartMeta): void {
  const n = meta.n;
  const g = backend.chart_chord_groups?.();
  if (g && g.length >= n * 4) meta.groups = Array.from({ length: n }, (_, i) => (g[i * 4 + 3] > 0 ? g[i * 4 + 2] : 0));
  const c = backend.chart_chord_chords?.();
  if (!c) return;
  const chords: ChordFlow[] = [];
  for (let k = 0; k + 7 < c.length; k += 8) {
    const [s, t] = [c[k], c[k + 4]];
    if (!(s >= 0 && s < n && t >= 0 && t < n)) continue;
    chords.push({ source: s, target: t, value: c[k + 3], reverse: s === t ? 0 : meta.matrix[t * n + s] });
  }
  meta.chords = chords.sort((a, b) => a.source * n + a.target - (b.source * n + b.target));
}

const flowText = (meta: ChordChartMeta, s: number, t: number) => `${meta.names[s] ?? ''} → ${meta.names[t] ?? ''}`;

/** Tooltip of an engine hit: series 0 = group, series 1 = ribbon `source * n + target`. */
export function chordTooltipContext(meta: ChordChartMeta, hit: ArrayLike<number>, details: (id: number) => ChartTooltipContext['details']): ChartTooltipContext | null {
  const [series, index, value, id] = [hit[3], hit[4], hit[5], hit[6]];
  const n = meta.n;
  if (series === 0) {
    if (!(index >= 0 && index < n)) return null;
    const name = meta.names[index];
    return {
      chartType: 'chord',
      index,
      xLabel: name,
      items: [{ seriesName: name, value, color: rgbCss(meta.colors[index]), nodeId: id }],
      chord: { kind: 'group', source: index, target: index, sourceName: name, targetName: name, value },
      details: details(id),
    };
  }
  if (series !== 1 || !(index >= 0 && index < n * n)) return null;
  const [s, t] = [Math.floor(index / n), index % n];
  const reverse = s === t ? 0 : meta.matrix[t * n + s];
  return {
    chartType: 'chord',
    index,
    xLabel: flowText(meta, s, t),
    items: [{ seriesName: flowText(meta, s, t), value, color: rgbCss(meta.colors[s]), nodeId: id }],
    chord: { kind: 'ribbon', source: s, target: t, sourceName: meta.names[s], targetName: meta.names[t], value, ...(reverse > 0 ? { reverse } : {}) },
    details: details(id),
  };
}

export function chordTooltipHtml(ctx: ChartTooltipContext, meta: ChordChartMeta, theme: CharturboTheme, formatValue: (v: number) => string): string {
  const c = ctx.chord;
  if (!c) return '';
  const color = (i: number) => rgbCss(meta.colors[i]);
  if (c.kind === 'group') return `${tooltipHeader(theme, c.sourceName)}${tooltipRow(theme, meta.valueLabel, esc(formatValue(c.value)), color(c.source))}`;
  const back = c.reverse !== undefined ? tooltipRow(theme, `${c.targetName} → ${c.sourceName}`, esc(formatValue(c.reverse)), color(c.target)) : '';
  return `${tooltipHeader(theme, meta.valueLabel)}${tooltipRow(theme, `${c.sourceName} → ${c.targetName}`, esc(formatValue(c.value)), color(c.source))}${back}`;
}

/** Point details: ids `0..n` = groups, `n + source * n + target` = ribbons. */
export function chordPointMetadata(meta: ChordChartMeta, id: number): { series: number; color: RgbaTuple; metadata: NodeMetadata } | null {
  const n = meta.n;
  if (!Number.isInteger(id) || id < 0) return null;
  const gray: RgbaTuple = [0.5, 0.5, 0.5, 1];
  if (id < n) {
    return {
      series: id,
      color: meta.colors[id] ?? gray,
      metadata: {
        label: meta.names[id],
        category: meta.valueLabel,
        tags: ['chord-group', ...(meta.visible[id] ? [] : ['hidden'])],
        attributes: { value: meta.groups[id] ?? 0, visible: meta.visible[id] ?? true },
      },
    };
  }
  const k = id - n;
  if (k >= n * n) return null;
  const [s, t] = [Math.floor(k / n), k % n];
  const value = meta.matrix[k];
  if (!(value > 0)) return null;
  return {
    series: s,
    color: meta.colors[s] ?? gray,
    metadata: {
      label: flowText(meta, s, t),
      category: meta.valueLabel,
      tags: ['chord-ribbon', ...(meta.directed ? ['directed'] : [])],
      attributes: { source: meta.names[s], target: meta.names[t], value, reverse: s === t ? 0 : meta.matrix[t * n + s] },
    },
  };
}

/**
 * A11y model: series 0 = groups (input order), series 1 = chords (by `source * n + target`);
 * Left / Right step within, Down goes from a group to its first chord, Up from a chord to its
 * source group. The table is the flow matrix.
 */
export function chordA11yModel(meta: ChordChartMeta, c: A11yCommon): A11yChartModel {
  const n = meta.n;
  const f = c.formatValue;
  const locale = c.locale ?? meta.locale;
  const { common: cm, business: bm } = getMessages(locale);
  const num = (v: number) => formatCount(v, locale);
  const name = (i: number) => meta.names[i] ?? '';
  const chords = () => meta.chords;
  const flow = (k: ChordFlow) => bm.chordFlow(name(k.source), name(k.target), f(k.value));
  const back = (k: ChordFlow) => (k.reverse > 0 && k.source !== k.target ? bm.chordFlow(name(k.target), name(k.source), f(k.reverse)) : null);
  const key = (k: ChordFlow | undefined) => (k ? k.source * n + k.target : -1);
  const custom: A11yCustomModel = {
    kindLabel: cm.kind.chord,
    xHeader: bm.chordCorner,
    summary: () => {
      const list = chords();
      const top = [...list].sort((a, b) => b.value - a.value || key(a) - key(b)).slice(0, 3);
      const text = bm.chordSummary(n, num(n), list.length, num(list.length), top.length ? top.map(flow).join(cm.listSeparator) : null);
      return c.title ? bm.titled(c.title, text) : text;
    },
    description: () => Array.from({ length: Math.min(n, 30) }, (_, i) => (meta.visible[i] ? bm.chordGroupTotal(name(i), f(meta.groups[i] ?? 0)) : bm.chordGroupHidden(name(i)))),
    help: bm.chordHelp,
    announce: (focus) => {
      if (focus.series === 0) {
        const i = focus.index;
        const position = cm.position(num(i + 1), num(n));
        return meta.visible[i] ? bm.chordGroupAnnounce(name(i), f(meta.groups[i] ?? 0), position) : bm.chordGroupHiddenAnnounce(name(i), position);
      }
      const list = chords();
      const k = list[focus.index];
      return k ? bm.chordAnnounce(flow(k), back(k), cm.position(num(focus.index + 1), num(list.length))) : '';
    },
    step: (focus, key) => {
      if (n < 1) return null;
      if (!focus) return { series: 0, index: key === 'End' ? n - 1 : 0 };
      const list = chords();
      if (key === 'ArrowDown' && focus.series === 0) {
        const at = list.findIndex((k) => k.source === focus.index || k.target === focus.index);
        return at >= 0 ? { series: 1, index: at } : focus;
      }
      if (key === 'ArrowUp' && focus.series === 1) {
        const k = list[focus.index];
        return k ? { series: 0, index: k.source } : { series: 0, index: 0 };
      }
      const len = focus.series === 0 ? n : list.length;
      if (len < 1) return focus;
      const i = focus.index;
      const next =
        key === 'ArrowLeft' ? i - 1
        : key === 'ArrowRight' ? i + 1
        : key === 'PageUp' ? i - 10
        : key === 'PageDown' ? i + 10
        : key === 'Home' ? 0
        : key === 'End' ? len - 1
        : i;
      return { series: focus.series, index: Math.max(0, Math.min(len - 1, next)) };
    },
    table: (pick): ChartDataTable => {
      const rows = pick(n).map((i) => [name(i), ...Array.from(meta.matrix.subarray(i * n, i * n + n))]);
      return { columns: [bm.chordCorner, ...meta.names], rows, totalRows: n, sampled: rows.length < n };
    },
    hover: (focus) => {
      const index = focus.series === 0 ? focus.index : key(chords()[focus.index]);
      // A stale chord focus (the chords changed under it) hovers nothing
      return index >= 0 ? meta.engine?.hover(focus.series, index) : undefined;
    },
  };
  const gray: RgbaTuple = [0.5, 0.5, 0.5, 1];
  return {
    kind: 'chord',
    ...c,
    locale,
    series: [{ name: meta.valueLabel, values: Float64Array.from(meta.groups), visible: true, f32: false }],
    length: n,
    custom,
    xValue: name,
    xLabel: name,
    formatX: name,
    pointId: (s, i) => {
      if (s === 0) return i;
      const k = key(chords()[i]);
      return k >= 0 ? n + k : -1;
    },
    itemName: (s, i) => (s === 0 ? name(i) : (() => { const k = chords()[i]; return k ? flowText(meta, k.source, k.target) : ''; })()),
    itemColor: (s, i) => meta.colors[s === 0 ? i : (chords()[i]?.source ?? 0)] ?? gray,
  };
}

/** Text cut to `px` CSS px with an ellipsis. */
function fitName(text: string, px: number): string {
  const max = Math.floor(px / CHAR_PX);
  if (text.length <= max) return text;
  return max < 2 ? '' : `${text.slice(0, max - 1)}…`;
}

/**
 * DOM group names at the engine anchors (`chart_hierarchy_labels`: node, x, y, rotation rad,
 * room px, flags 1 = text starts at the anchor, -1 = ends there, 2 = centered above, 3 =
 * centered below).
 */
export class ChordLabelLayer implements BusinessLabelLayer {
  private readonly root: HTMLDivElement;
  private labels: HTMLDivElement[] = [];
  private revision = -1;
  private themeKey = '';

  constructor(
    parent: HTMLElement,
    private readonly meta: ChordChartMeta
  ) {
    this.root = overlayDiv('charturbo-sdk-chord-labels', { left: '0px', top: '0px', width: '0px', height: '0px', overflow: 'visible' });
    parent.appendChild(this.root);
  }

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
      const text = fitName(this.meta.names[node] ?? '', room + 0.5);
      if (!text) continue;
      let el = this.labels[used];
      if (!el) {
        el = overlayDiv('charturbo-sdk-chord-label', { fontSize: '11px', lineHeight: '14px', transformOrigin: '0 0' });
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
