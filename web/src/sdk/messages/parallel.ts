/**
 * Built-in strings of chart-parallel.ts (parallel coordinates): accessibility summary /
 * description / announcements / keyboard help and tooltip headers. Numbers arrive already
 * formatted in the chart locale; `n` arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  rows: (n: number, count: string) => `${count} ${plural(n, 'row', 'rows')}`,
  dimensions: (n: number, count: string) => `${count} ${plural(n, 'dimension', 'dimensions')}`,
  /** Summary: `series` null for one series, `active` null without a brush */
  summary: (chart: string, rows: string, dims: string, series: string | null, active: string | null) =>
    `${chart}, ${rows} over ${dims}${series ? ` in ${series}` : ''}${active ? `; ${active} inside the brush` : ''}.`,
  /** Description sentence of a value / time dimension */
  dimRange: (name: string, lo: string, hi: string) => `${name}: ${lo} to ${hi}.`,
  /** Description sentence of a category dimension (`list` = the first names) */
  dimCategories: (name: string, count: string, list: string) => `${name}: ${count}, ${list}.`,
  dimEmpty: (name: string) => `${name}: no data.`,
  /** Description sentence of the brush on one dimension (`ranges` joined) */
  brushed: (name: string, ranges: string) => `Brush on ${name}: ${ranges}.`,
  help: (vertical: boolean) =>
    `Keyboard: focus the chart, then use ${vertical ? 'Left and Right' : 'Up and Down'} arrows to move between rows in value order on the focused axis, ` +
    `${vertical ? 'Up and Down' : 'Left and Right'} to change the axis, Home and End for the first and last row on it, ` +
    `Shift with ${vertical ? 'Left or Right' : 'Up or Down'} to brush the value range from where the move started, ` +
    'Delete to clear the brush on the focused axis, and Escape to clear every brush.',
  /** `name value` pair of a dimension */
  pair: (name: string, value: string) => `${name} ${value}`,
  /** Row label: `series` null for one series */
  rowLabel: (series: string | null, row: string) => (series ? `${series} · Row ${row}` : `Row ${row}`),
  /** Focused row: the focused axis value first, then every dimension */
  announce: (axis: string, series: string | null, row: string, total: string, values: string, outside: boolean) =>
    `${axis}. ${series ? `${series}, ` : ''}row ${row} of ${total}: ${values}.${outside ? ' Outside the brush.' : ''}`,
};

export type ParallelMessages = typeof en;

const ko: ParallelMessages = {
  rows: (_n, count) => `${count}개 행`,
  dimensions: (_n, count) => `${count}개 차원`,
  summary: (chart, rows, dims, series, active) =>
    `${chart}, ${dims}에 걸친 ${rows}${series ? `, ${series}` : ''}${active ? `; 브러시 안 ${active}` : ''}.`,
  dimRange: (name, lo, hi) => `${name}: ${lo}부터 ${hi}까지.`,
  dimCategories: (name, count, list) => `${name}: ${count}, ${list}.`,
  dimEmpty: (name) => `${name}: 데이터 없음.`,
  brushed: (name, ranges) => `${name} 브러시: ${ranges}.`,
  help: (vertical) =>
    `키보드: 차트에 포커스한 뒤 ${vertical ? '왼쪽/오른쪽' : '위/아래'} 화살표로 포커스한 축의 값 순서대로 행을 이동하고, ` +
    `${vertical ? '위/아래' : '왼쪽/오른쪽'} 화살표로 축을 바꾸며, Home과 End로 축의 처음과 마지막 행으로 이동합니다. ` +
    `Shift와 ${vertical ? '왼쪽/오른쪽' : '위/아래'} 화살표로 이동을 시작한 값부터 범위를 브러시하고, ` +
    'Delete로 포커스한 축의 브러시를, Escape로 모든 브러시를 해제합니다.',
  pair: (name, value) => `${name} ${value}`,
  rowLabel: (series, row) => (series ? `${series} · ${row}행` : `${row}행`),
  announce: (axis, series, row, total, values, outside) =>
    `${axis}. ${series ? `${series}, ` : ''}${total}개 중 ${row}행: ${values}.${outside ? ' 브러시 밖.' : ''}`,
};

const zh: ParallelMessages = {
  rows: (_n, count) => `${count} 行`,
  dimensions: (_n, count) => `${count} 个维度`,
  summary: (chart, rows, dims, series, active) =>
    `${chart}，${dims}上共 ${rows}${series ? `，${series}` : ''}${active ? `；刷选范围内 ${active}` : ''}。`,
  dimRange: (name, lo, hi) => `${name}：${lo} 至 ${hi}。`,
  dimCategories: (name, count, list) => `${name}：${count}，${list}。`,
  dimEmpty: (name) => `${name}：无数据。`,
  brushed: (name, ranges) => `${name} 刷选：${ranges}。`,
  help: (vertical) =>
    `键盘：聚焦图表后，用${vertical ? '左右' : '上下'}方向键按当前轴的数值顺序在行间移动，` +
    `${vertical ? '上下' : '左右'}方向键切换轴，Home 和 End 跳到该轴的第一行和最后一行，` +
    `Shift 加${vertical ? '左右' : '上下'}方向键从起始值开始刷选范围，Delete 清除当前轴的刷选，Escape 清除全部刷选。`,
  pair: (name, value) => `${name} ${value}`,
  rowLabel: (series, row) => (series ? `${series} · 第 ${row} 行` : `第 ${row} 行`),
  announce: (axis, series, row, total, values, outside) =>
    `${axis}。${series ? `${series}，` : ''}第 ${row} 行，共 ${total} 行：${values}。${outside ? '在刷选范围外。' : ''}`,
};

export const PARALLEL_MESSAGES = { en, ko, 'zh-CN': zh } as const;
