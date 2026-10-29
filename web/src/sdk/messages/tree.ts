/**
 * Built-in strings of chart-tree.ts (tidy tree): accessibility summary / announcements /
 * keyboard help, data table headers, node states. Numbers arrive already formatted in the
 * chart locale; `n` arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  /** Summary chart name */
  treeName: 'Tree diagram',
  levels: (n: number, count: string) => `${count} ${plural(n, 'level', 'levels')}`,
  /** Summary: `shown` = visible node count, `top` = the root's first children (null for none), `more` = the others (null when none) */
  summary: (chart: string, nodes: string, levels: string, shown: string, root: string, top: string | null, more: string | null) =>
    `${chart}, ${nodes} in ${levels}, ${shown} shown; root ${root}${top ? ` with ${top}` : ''}${more ? `, and ${more} more` : ''}.`,
  help:
    'Keyboard: focus the chart, then use Up and Down arrows to move between siblings, Right for the first ' +
    'child of an expanded node, Left for the parent, Home and End for the first and last sibling, ' +
    'Enter or Space to expand or collapse the focused node, and Escape to clear.',
  expanded: 'expanded',
  collapsed: 'collapsed',
  leaf: 'leaf',
  /** Focused node: `value` null without one, `state` = expanded / collapsed with its children (null for leaves) */
  nodeAnnounce: (name: string, value: string | null, state: string | null) => `${name}${value ? `, ${value}` : ''}${state ? `, ${state}` : ''}.`,
  /** State with the child count, e.g. `collapsed, 3 children` */
  state: (state: string, children: string) => `${state}, ${children}`,
  toggleHint: (expanded: boolean): string => (expanded ? 'Press Enter to collapse.' : 'Press Enter to expand.'),
  /** Description sentence per top-level child */
  item: (name: string, value: string | null, children: string) => `${name}${value ? `: ${value}` : ''}, ${children}.`,
  depth: 'Depth',
  stateHeader: 'State',
};

export type TreeMessages = typeof en;

const ko: TreeMessages = {
  treeName: '트리 다이어그램',
  levels: (_n, count) => `${count}단계`,
  summary: (chart, nodes, levels, shown, root, top, more) =>
    `${chart}, ${levels}에 걸친 ${nodes}, ${shown} 표시 중; 루트 ${root}${top ? `, 하위 ${top}` : ''}${more ? ` 외 ${more}` : ''}.`,
  help:
    '키보드: 차트에 포커스한 뒤 위/아래 화살표로 형제 노드 사이를 이동하고, 오른쪽 화살표로 펼친 노드의 첫 자식으로, ' +
    '왼쪽 화살표로 부모로, Home과 End로 처음과 마지막 형제로 이동합니다. Enter나 Space로 포커스한 노드를 펼치거나 접고, ' +
    'Escape로 해제합니다.',
  expanded: '펼침',
  collapsed: '접힘',
  leaf: '말단',
  nodeAnnounce: (name, value, state) => `${name}${value ? `, ${value}` : ''}${state ? `, ${state}` : ''}.`,
  state: (state, children) => `${state}, 자식 ${children}`,
  toggleHint: (expanded) => (expanded ? 'Enter를 눌러 접습니다.' : 'Enter를 눌러 펼칩니다.'),
  item: (name, value, children) => `${name}${value ? `: ${value}` : ''}, 자식 ${children}.`,
  depth: '깊이',
  stateHeader: '상태',
};

const zh: TreeMessages = {
  treeName: '树图',
  levels: (_n, count) => `${count} 层`,
  summary: (chart, nodes, levels, shown, root, top, more) =>
    `${chart}，${levels}共 ${nodes}，显示 ${shown}；根节点 ${root}${top ? `，子节点 ${top}` : ''}${more ? `，另有 ${more} 个` : ''}。`,
  help:
    '键盘：聚焦图表后，用上下方向键在兄弟节点间移动，右方向键进入已展开节点的第一个子节点，左方向键回到父节点，' +
    'Home 和 End 跳到第一个和最后一个兄弟节点，Enter 或空格展开或折叠当前节点，Escape 清除。',
  expanded: '已展开',
  collapsed: '已折叠',
  leaf: '叶节点',
  nodeAnnounce: (name, value, state) => `${name}${value ? `，${value}` : ''}${state ? `，${state}` : ''}。`,
  state: (state, children) => `${state}，${children} 个子节点`,
  toggleHint: (expanded) => (expanded ? '按 Enter 折叠。' : '按 Enter 展开。'),
  item: (name, value, children) => `${name}${value ? `：${value}` : ''}，${children} 个子节点。`,
  depth: '深度',
  stateHeader: '状态',
};

export const TREE_MESSAGES = { en, ko, 'zh-CN': zh } as const;
