/**
 * Default floating tooltip of graph / point-cloud nodes (`enableNodeInteractions` without
 * `formatTooltip`): label + id, category · cluster, degree, neighbors, position, tags and up to
 * `GRAPH_TOOLTIP_MAX_ATTRIBUTES` metadata attributes, in the theme text tokens. Every
 * data-derived string (label, category, tags, attribute keys / values) is HTML-escaped; the fixed
 * strings and numbers follow the chart / SDK locale (`core` messages, i18n.ts). DOM-free.
 */
import { esc, rgbCss, tooltipRow } from './chart-business-util';
import type { NodeDetails, CharturboTheme } from './charturbo';
import { getMessages, resolveLocale } from './i18n';
import type { CoreMessages } from './messages/core';

/** Fixed strings of the default node tooltip. */
export interface GraphTooltipStrings {
  cluster: string;
  degree: string;
  neighbors: string;
  position: string;
  /** Shown when a click highlights the node's neighbors */
  clickHint: string;
}

/** One strings object per messages object (same locale → same object) */
const stringsCache = new WeakMap<CoreMessages, GraphTooltipStrings>();

/** Attribute rows shown at most (the rest are left to a custom `formatTooltip`). */
export const GRAPH_TOOLTIP_MAX_ATTRIBUTES = 6;

/** Strings for `locale` (`core` messages; unset: page / browser language). */
export function graphTooltipStrings(locale?: string): GraphTooltipStrings {
  const m = getMessages(locale).core;
  let s = stringsCache.get(m);
  if (!s) {
    s = { cluster: m.cluster, degree: m.degree, neighbors: m.neighbors, position: m.nodePosition, clickHint: m.clickHint };
    stringsCache.set(m, s);
  }
  return s;
}

/** Tooltip HTML of a hovered node; `clickHint`: append the click-to-highlight line. */
export function graphTooltipHtml(d: NodeDetails, theme: CharturboTheme, locale?: string, clickHint = false): string {
  const s = graphTooltipStrings(locale);
  const cluster = getMessages(locale).core.clusterName(String(d.clusterId));
  const tag = resolveLocale(locale);
  const int = (v: number) => v.toLocaleString(tag);
  const coord = (v: number) => v.toLocaleString(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const [x, y, z] = d.position;
  const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;flex:none;background:${rgbCss(d.color)};"></span>`;
  // `getNodeDetails` fills a missing category with `clusterName(id)`: the cluster line already says it
  const cat = d.metadata.category;
  const category = cat && cat !== cluster ? `${esc(cat)} · ` : '';
  const tags = d.metadata.tags?.length
    ? `<div style="color:${theme.textMuted};font-size:11px;margin-top:4px;white-space:normal;">${esc(d.metadata.tags.join(getMessages(locale).common.listSeparator))}</div>`
    : '';
  const attributes = Object.entries(d.metadata.attributes ?? {})
    .slice(0, GRAPH_TOOLTIP_MAX_ATTRIBUTES)
    .map(([k, v]) => tooltipRow(theme, k, esc(typeof v === 'number' ? v.toLocaleString(tag) : String(v))))
    .join('');
  const hint = clickHint ? `<div style="color:${theme.textMuted};font-size:11px;margin-top:4px;">${esc(s.clickHint)}</div>` : '';
  return `
        <div style="display:flex;align-items:center;gap:6px;color:${theme.textPrimary};font-weight:600;margin-bottom:2px;">${swatch}<span>${esc(d.label)}</span><span style="color:${theme.textMuted};font-weight:400;">#${d.id}</span></div>
        <div style="color:${theme.textSecondary};font-size:11px;margin-bottom:4px;">${category}${esc(cluster)}</div>
        ${tooltipRow(theme, s.degree, int(d.degree))}
        ${tooltipRow(theme, s.neighbors, int(d.neighbors.length))}
        ${tooltipRow(theme, s.position, esc(`(${coord(x)}, ${coord(y)}, ${coord(z)})`))}
        ${attributes}${tags}${hint}
      `;
}
