/**
 * Built-in strings of chart-hierarchy.ts (treemap, sunburst, sankey): default root name,
 * tooltip shares, accessibility summary / announcements / keyboard help, data table headers,
 * breadcrumb label. Numbers and shares (with `%`) arrive already formatted in the chart
 * locale; `n` arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  /** Default name of the synthetic root above several roots (`rootLabel`) */
  rootLabel: 'All',
  /** Tooltip shares of a treemap / sunburst node */
  ofParent: (share: string) => `${share} of parent`,
  ofTotal: (share: string) => `${share} of total`,
  /** Tooltip share of a sankey link, after its value */
  ofSource: (share: string, source: string) => `(${share} of ${source})`,
  /** Tooltip / description inflow and outflow of a sankey node */
  inflow: (value: string) => `in ${value}`,
  outflow: (value: string) => `out ${value}`,
  /** Summary chart names */
  treemapName: 'Treemap',
  sunburstName: 'Sunburst chart',
  sankeyName: 'Sankey diagram',
  /** Chart title before the summary */
  titled: (title: string, text: string) => `${title}. ${text}`,
  nodes: (n: number, count: string) => `${count} ${plural(n, 'node', 'nodes')}`,
  children: (n: number, count: string) => `${count} ${plural(n, 'child', 'children')}`,
  columns: (n: number, count: string) => `${count} ${plural(n, 'column', 'columns')}`,
  links: (n: number, count: string) => `${count} ${plural(n, 'link', 'links')}`,
  treeHelp:
    'Keyboard: focus the chart, then use Left and Right arrows to move between siblings, Down for the first child, ' +
    'Up for the parent, Home and End for the first and last sibling, Enter to drill into the focused node, ' +
    'and Escape to go back up (or clear).',
  sankeyHelp:
    'Keyboard: focus the chart, then use Left and Right arrows to move between links, Page Up and Page Down ' +
    'to jump 10 links, Home and End for the first and last link, and Escape to clear.',
  /**
   * Treemap / sunburst summary: `at` = drilled path (null at the top), `largest` = the top
   * children with shares, `more` = count of the other children (null when none)
   */
  treeSummary: (chart: string, nodes: string, total: string, at: string | null, largest: string, more: string | null) =>
    `${chart}, ${nodes}, total ${total}${at ? `, showing ${at}` : ''}; largest: ${largest}${more ? `, and ${more} more` : ''}.`,
  /** One child of the current root: value, share of the root, child count */
  treeItem: (name: string, value: string, share: string, children: string) => `${name}: ${value} (${share}), ${children}.`,
  /** Focused node: `share` of `parent` (null at a root) */
  nodeAnnounce: (name: string, value: string, share: string | null, parent: string) =>
    `${name}, ${value}${share ? `, ${share} of ${parent}` : ''}.`,
  /** Position of the focused node among its siblings and its depth */
  nodePosition: (i: string, n: string, level: string) => `${i} of ${n}, level ${level}.`,
  drillHint: (children: string) => `${children}; press Enter to drill down.`,
  /** Joins the sentences of an announcement */
  sentenceSeparator: ' ',
  /** Sankey summary; `largest` = the top flows (null without links) */
  sankeySummary: (chart: string, nodes: string, columns: string, links: string, largest: string | null) =>
    `${chart}, ${nodes} in ${columns}, ${links}${largest ? `; largest flows: ${largest}` : ''}.`,
  /** One flow in the sankey summary */
  flowItem: (source: string, target: string, value: string) => `${source} to ${target} ${value}`,
  sankeyNode: (name: string, value: string, inflow: string, outflow: string) => `${name}: ${value} (in ${inflow}, out ${outflow}).`,
  /** Focused link: `share` of the source node (null when undefined), position among links */
  linkAnnounce: (source: string, target: string, value: string, share: string | null, i: string, n: string) =>
    `${source} to ${target}: ${value}${share ? `, ${share} of ${source}` : ''}. Link ${i} of ${n}.`,
  path: 'Path',
  shareOfParent: 'Share of parent',
  shareOfTotal: 'Share of total',
  source: 'Source',
  target: 'Target',
  shareOfSource: 'Share of source',
  /** aria-label of the breadcrumb */
  drillPath: 'Drill path',
};

export type HierarchyMessages = typeof en;

const ko: HierarchyMessages = {
  rootLabel: '전체',
  ofParent: (share) => `상위 항목의 ${share}`,
  ofTotal: (share) => `전체의 ${share}`,
  ofSource: (share, source) => `(${source}의 ${share})`,
  inflow: (value) => `유입 ${value}`,
  outflow: (value) => `유출 ${value}`,
  treemapName: '트리맵',
  sunburstName: '선버스트 차트',
  sankeyName: '생키 다이어그램',
  titled: (title, text) => `${title}. ${text}`,
  nodes: (_n, count) => `노드 ${count}개`,
  children: (_n, count) => `하위 노드 ${count}개`,
  columns: (_n, count) => `열 ${count}개`,
  links: (_n, count) => `링크 ${count}개`,
  treeHelp:
    '키보드: 차트에 포커스한 뒤 왼쪽·오른쪽 화살표로 같은 수준의 노드 사이를 이동하고, 아래쪽 화살표로 첫 번째 하위 노드, ' +
    '위쪽 화살표로 상위 노드로 이동합니다. Home과 End는 같은 수준의 첫 번째와 마지막 노드로 이동하고, ' +
    'Enter는 포커스한 노드로 드릴다운하며, Esc는 한 단계 위로 돌아가거나 포커스를 해제합니다.',
  sankeyHelp:
    '키보드: 차트에 포커스한 뒤 왼쪽·오른쪽 화살표로 링크 사이를 이동하고, Page Up과 Page Down으로 10개씩 건너뜁니다. ' +
    'Home과 End는 첫 번째와 마지막 링크로 이동하고, Esc는 포커스를 해제합니다.',
  treeSummary: (chart, nodes, total, at, largest, more) =>
    `${chart}, ${nodes}, 합계 ${total}.${at ? ` 현재 위치: ${at}.` : ''} 비중 상위: ${largest}${more ? ` 외 ${more}개` : ''}.`,
  treeItem: (name, value, share, children) => `${name}: ${value} (${share}), ${children}.`,
  nodeAnnounce: (name, value, share, parent) => `${name}, ${value}${share ? `, ${parent}의 ${share}` : ''}.`,
  nodePosition: (i, n, level) => `${n}개 중 ${i}번째, ${level}단계.`,
  drillHint: (children) => `${children}. Enter를 누르면 드릴다운합니다.`,
  sentenceSeparator: ' ',
  sankeySummary: (chart, nodes, columns, links, largest) =>
    `${chart}, ${columns}, ${nodes}, ${links}.${largest ? ` 주요 흐름: ${largest}.` : ''}`,
  flowItem: (source, target, value) => `${source}에서 ${target}까지 ${value}`,
  sankeyNode: (name, value, inflow, outflow) => `${name}: ${value} (유입 ${inflow}, 유출 ${outflow}).`,
  linkAnnounce: (source, target, value, share, i, n) =>
    `${source}에서 ${target}까지: ${value}${share ? `, ${source}의 ${share}` : ''}. 링크 ${n}개 중 ${i}번째.`,
  path: '경로',
  shareOfParent: '상위 항목 대비 비중',
  shareOfTotal: '전체 대비 비중',
  source: '출발',
  target: '도착',
  shareOfSource: '출발 노드 대비 비중',
  drillPath: '드릴다운 경로',
};

const zh: HierarchyMessages = {
  rootLabel: '全部',
  ofParent: (share) => `占上级 ${share}`,
  ofTotal: (share) => `占总量 ${share}`,
  ofSource: (share, source) => `（占 ${source} 的 ${share}）`,
  inflow: (value) => `流入 ${value}`,
  outflow: (value) => `流出 ${value}`,
  treemapName: '矩形树图',
  sunburstName: '旭日图',
  sankeyName: '桑基图',
  titled: (title, text) => `${title}。${text}`,
  nodes: (_n, count) => `${count} 个节点`,
  children: (_n, count) => `${count} 个子节点`,
  columns: (_n, count) => `${count} 列`,
  links: (_n, count) => `${count} 条连线`,
  treeHelp:
    '键盘操作：聚焦图表后，使用左右方向键在同级节点间移动，下方向键进入第一个子节点，上方向键返回父节点，' +
    'Home 和 End 跳到第一个和最后一个同级节点，Enter 下钻到当前节点，Esc 返回上一级（或清除焦点）。',
  sankeyHelp:
    '键盘操作：聚焦图表后，使用左右方向键在连线间移动，Page Up 和 Page Down 每次跳过 10 条连线，' +
    'Home 和 End 跳到第一条和最后一条连线，Esc 清除焦点。',
  treeSummary: (chart, nodes, total, at, largest, more) =>
    `${chart}，共 ${nodes}，合计 ${total}${at ? `，当前位置：${at}` : ''}；占比最大：${largest}${more ? `，另有 ${more} 项` : ''}。`,
  treeItem: (name, value, share, children) => `${name}：${value}（${share}），${children}。`,
  nodeAnnounce: (name, value, share, parent) => `${name}，${value}${share ? `，占 ${parent} 的 ${share}` : ''}。`,
  nodePosition: (i, n, level) => `第 ${i} 项，共 ${n} 项，第 ${level} 层。`,
  drillHint: (children) => `${children}；按 Enter 下钻。`,
  sentenceSeparator: '',
  sankeySummary: (chart, nodes, columns, links, largest) =>
    `${chart}，${columns}，${nodes}，${links}${largest ? `；最大流量：${largest}` : ''}。`,
  flowItem: (source, target, value) => `从 ${source} 到 ${target} ${value}`,
  sankeyNode: (name, value, inflow, outflow) => `${name}：${value}（流入 ${inflow}，流出 ${outflow}）。`,
  linkAnnounce: (source, target, value, share, i, n) =>
    `从 ${source} 到 ${target}：${value}${share ? `，占 ${source} 的 ${share}` : ''}。第 ${i} 条连线，共 ${n} 条。`,
  path: '路径',
  shareOfParent: '占上级比例',
  shareOfTotal: '占总量比例',
  source: '源节点',
  target: '目标节点',
  shareOfSource: '占源节点比例',
  drillPath: '下钻路径',
};

export const HIERARCHY_MESSAGES = { en, ko, 'zh-CN': zh } as const;
