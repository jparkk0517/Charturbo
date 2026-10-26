/**
 * Default floating tooltip of graph / point-cloud nodes (`enableNodeInteractions` without
 * `formatTooltip`): label + id, category · cluster, degree, neighbors, position, tags and up to
 * `GRAPH_TOOLTIP_MAX_ATTRIBUTES` metadata attributes, in the theme text tokens. Every
 * data-derived string (label, category, tags, attribute keys / values) is HTML-escaped; the fixed
 * strings follow the chart / SDK locale (Korean for `ko*`, English otherwise). DOM-free.
 */
import { esc, rgbCss, tooltipRow } from './chart-business-util';
import type { NodeDetails, VizTheme } from './viz-engine-sdk';

/** Fixed strings of the default node tooltip. */
export interface GraphTooltipStrings {
  cluster: string;
  degree: string;
  neighbors: string;
  position: string;
  /** Shown when a click highlights the node's neighbors */
  clickHint: string;
}

const EN: GraphTooltipStrings = {
  cluster: 'Cluster',
  degree: 'Degree',
  neighbors: 'Neighbors',
  position: 'Position',
  clickHint: 'Click to highlight neighbors',
};

const KO: GraphTooltipStrings = {
  cluster: '클러스터',
  degree: '연결 차수',
  neighbors: '이웃 노드',
  position: '좌표',
  clickHint: '클릭하면 이웃 노드를 강조합니다',
};

/** Attribute rows shown at most (the rest are left to a custom `formatTooltip`). */
export const GRAPH_TOOLTIP_MAX_ATTRIBUTES = 6;

/** Strings for `locale`: Korean for `ko` / `ko-KR` / …, English otherwise (also when unset). */
export function graphTooltipStrings(locale?: string): GraphTooltipStrings {
  return locale?.toLowerCase().startsWith('ko') ? KO : EN;
}

/** Tooltip HTML of a hovered node; `clickHint`: append the click-to-highlight line. */
export function graphTooltipHtml(d: NodeDetails, theme: VizTheme, locale?: string, clickHint = false): string {
  const s = graphTooltipStrings(locale);
  const int = (v: number) => v.toLocaleString(locale);
  const coord = (v: number) => v.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const [x, y, z] = d.position;
  const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:2px;flex:none;background:${rgbCss(d.color)};"></span>`;
  // `getNodeDetails` fills a missing category with `Cluster <id>`: the cluster line already says it
  const cat = d.metadata.category;
  const category = cat && cat !== `Cluster ${d.clusterId}` ? `${esc(cat)} · ` : '';
  const tags = d.metadata.tags?.length
    ? `<div style="color:${theme.textMuted};font-size:11px;margin-top:4px;white-space:normal;">${esc(d.metadata.tags.join(', '))}</div>`
    : '';
  const attributes = Object.entries(d.metadata.attributes ?? {})
    .slice(0, GRAPH_TOOLTIP_MAX_ATTRIBUTES)
    .map(([k, v]) => tooltipRow(theme, k, esc(typeof v === 'number' ? v.toLocaleString(locale) : String(v))))
    .join('');
  const hint = clickHint ? `<div style="color:${theme.textMuted};font-size:11px;margin-top:4px;">${esc(s.clickHint)}</div>` : '';
  return `
        <div style="display:flex;align-items:center;gap:6px;color:${theme.textPrimary};font-weight:600;margin-bottom:2px;">${swatch}<span>${esc(d.label)}</span><span style="color:${theme.textMuted};font-weight:400;">#${d.id}</span></div>
        <div style="color:${theme.textSecondary};font-size:11px;margin-bottom:4px;">${category}${esc(s.cluster)} ${d.clusterId}</div>
        ${tooltipRow(theme, s.degree, int(d.degree))}
        ${tooltipRow(theme, s.neighbors, int(d.neighbors.length))}
        ${tooltipRow(theme, s.position, esc(`(${coord(x)}, ${coord(y)}, ${coord(z)})`))}
        ${attributes}${tags}${hint}
      `;
}
