/**
 * Built-in strings of chart-graph.ts (2D graph): accessibility summary / announcements /
 * keyboard help, data table headers, default category names. Numbers arrive already formatted
 * in the chart locale; `n` arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  /** Summary chart name */
  graphName: 'Network graph',
  categories: (n: number, count: string) => `${count} ${plural(n, 'category', 'categories')}`,
  links: (n: number, count: string) => `${count} ${plural(n, 'link', 'links')}`,
  /** Summary: `categories` null without any, `top` = the most linked nodes (null without links) */
  summary: (chart: string, nodes: string, categories: string | null, links: string, top: string | null) =>
    `${chart}, ${nodes}${categories ? ` in ${categories}` : ''}, ${links}${top ? `; most linked: ${top}` : ''}.`,
  /** One of the most linked nodes */
  topItem: (name: string, links: string) => `${name} (${links})`,
  help:
    'Keyboard: focus the chart, then use Up and Down arrows to move between nodes, Right and Left for the next and ' +
    'previous linked node, Page Up and Page Down to jump 10 nodes, Home and End for the first and last node, and ' +
    'Escape to clear.',
  /** Focused node: `category` / `value` null without one */
  nodeAnnounce: (name: string, category: string | null, value: string | null) =>
    `${name}${category ? `, ${category}` : ''}${value ? `, ${value}` : ''}.`,
  /** Position and links of the focused node; `neighbours` null without links, `more` null when all listed */
  position: (i: string, n: string, links: string, neighbours: string | null, more: string | null) =>
    `Node ${i} of ${n}, ${links}${neighbours ? `: ${neighbours}` : ''}${more ? `, and ${more} more` : ''}.`,
  /** Description sentence per node (the most linked first) */
  item: (name: string, category: string | null, value: string | null, links: string) =>
    `${name}${category ? ` (${category})` : ''}${value ? `: ${value}` : ''}, ${links}.`,
  /** Default name of category `k` (1-based) when the input has no `categories` */
  categoryName: (k: number) => `Category ${k}`,
  node: 'Node',
  category: 'Category',
  linksHeader: 'Links',
  linkedTo: 'Linked to',
};

export type GraphMessages = typeof en;

const ko: GraphMessages = {
  graphName: '네트워크 그래프',
  categories: (_n, count) => `범주 ${count}개`,
  links: (_n, count) => `연결 ${count}개`,
  summary: (chart, nodes, categories, links, top) =>
    `${chart}, ${categories ? `${categories}에 걸친 ` : ''}${nodes}, ${links}${top ? `; 연결이 가장 많은 노드: ${top}` : ''}.`,
  topItem: (name, links) => `${name}(${links})`,
  help:
    '키보드: 차트에 포커스한 뒤 위/아래 화살표로 노드 사이를 이동하고, 오른쪽/왼쪽 화살표로 연결된 다음/이전 노드로, ' +
    'Page Up과 Page Down으로 10개씩, Home과 End로 처음과 마지막 노드로 이동합니다. Escape로 해제합니다.',
  nodeAnnounce: (name, category, value) => `${name}${category ? `, ${category}` : ''}${value ? `, ${value}` : ''}.`,
  position: (i, n, links, neighbours, more) => `${n}개 중 ${i}번째 노드, ${links}${neighbours ? `: ${neighbours}` : ''}${more ? ` 외 ${more}개` : ''}.`,
  item: (name, category, value, links) => `${name}${category ? `(${category})` : ''}${value ? `: ${value}` : ''}, ${links}.`,
  categoryName: (k) => `범주 ${k}`,
  node: '노드',
  category: '범주',
  linksHeader: '연결',
  linkedTo: '연결 대상',
};

const zh: GraphMessages = {
  graphName: '关系图',
  categories: (_n, count) => `${count} 个类别`,
  links: (_n, count) => `${count} 条连接`,
  summary: (chart, nodes, categories, links, top) =>
    `${chart}，${categories ? `${categories}共 ` : ''}${nodes}，${links}${top ? `；连接最多：${top}` : ''}。`,
  topItem: (name, links) => `${name}（${links}）`,
  help:
    '键盘：聚焦图表后，用上下方向键在节点间移动，右/左方向键跳到下一个/上一个相连节点，Page Up 和 Page Down 跳 10 个节点，' +
    'Home 和 End 跳到第一个和最后一个节点，Escape 清除。',
  nodeAnnounce: (name, category, value) => `${name}${category ? `，${category}` : ''}${value ? `，${value}` : ''}。`,
  position: (i, n, links, neighbours, more) => `第 ${i} 个节点，共 ${n} 个，${links}${neighbours ? `：${neighbours}` : ''}${more ? `，另有 ${more} 个` : ''}。`,
  item: (name, category, value, links) => `${name}${category ? `（${category}）` : ''}${value ? `：${value}` : ''}，${links}。`,
  categoryName: (k) => `类别 ${k}`,
  node: '节点',
  category: '类别',
  linksHeader: '连接',
  linkedTo: '连接到',
};

export const GRAPH_MESSAGES = { en, ko, 'zh-CN': zh } as const;
