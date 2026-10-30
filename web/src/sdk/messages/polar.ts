/**
 * Built-in strings of chart-polar.ts (polar coordinate charts): default axis / series names,
 * series type names, accessibility summary / description / announcements and keyboard help.
 * Numbers arrive already formatted in the chart locale; `n` arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  angle: 'Angle',
  radius: 'Radius',
  seriesName: (i: number) => `Series ${i}`,
  /** Series type names (description) */
  type: { bar: 'bar', line: 'line', scatter: 'scatter', heatmap: 'heatmap' },
  categories: (n: number, count: string) => `${count} ${plural(n, 'category', 'categories')}`,
  range: (lo: string, hi: string) => `${lo} to ${hi}`,
  summary: (chart: string, series: string, angle: string, radius: string) => `${chart}, ${series}; angle axis: ${angle}; radius axis: ${radius}.`,
  /** Description sentence of a series (`range` null without data) */
  seriesText: (name: string, type: string, items: string, range: string | null) => `${name} (${type}): ${range ? `${items}, ${range}` : 'no data'}.`,
  seriesHidden: (name: string, type: string) => `${name} (${type}): hidden.`,
  help:
    'Keyboard: focus the chart, then use Left and Right arrows to move between the items of a series, Up and Down to change the series, ' +
    'Home and End for the first and last item, and Page Up / Page Down to jump by 10.',
  /** `name value` pair */
  pair: (name: string, value: string) => `${name} ${value}`,
  announce: (series: string, pairs: string, position: string) => `${series}: ${pairs}. ${position}`,
};

export type PolarMessages = typeof en;

const ko: PolarMessages = {
  angle: '각도',
  radius: '반지름',
  seriesName: (i) => `시리즈 ${i}`,
  type: { bar: '막대', line: '선', scatter: '산점', heatmap: '히트맵' },
  categories: (_n, count) => `${count}개 범주`,
  range: (lo, hi) => `${lo}부터 ${hi}까지`,
  summary: (chart, series, angle, radius) => `${chart}, ${series}; 각도 축: ${angle}; 반지름 축: ${radius}.`,
  seriesText: (name, type, items, range) => `${name} (${type}): ${range ? `${items}, ${range}` : '데이터 없음'}.`,
  seriesHidden: (name, type) => `${name} (${type}): 숨김.`,
  help: '키보드: 차트에 포커스한 뒤 왼쪽/오른쪽 화살표로 시리즈 안의 항목을 이동하고, 위/아래 화살표로 시리즈를 바꾸며, Home과 End로 처음과 마지막 항목으로, Page Up / Page Down으로 10개씩 이동합니다.',
  pair: (name, value) => `${name} ${value}`,
  announce: (series, pairs, position) => `${series}: ${pairs}. ${position}`,
};

const zh: PolarMessages = {
  angle: '角度',
  radius: '半径',
  seriesName: (i) => `系列 ${i}`,
  type: { bar: '柱', line: '线', scatter: '散点', heatmap: '热力' },
  categories: (_n, count) => `${count} 个类别`,
  range: (lo, hi) => `${lo} 至 ${hi}`,
  summary: (chart, series, angle, radius) => `${chart}，${series}；角度轴：${angle}；半径轴：${radius}。`,
  seriesText: (name, type, items, range) => `${name}（${type}）：${range ? `${items}，${range}` : '无数据'}。`,
  seriesHidden: (name, type) => `${name}（${type}）：已隐藏。`,
  help: '键盘：聚焦图表后，用左右方向键在系列内的项目间移动，上下方向键切换系列，Home 和 End 跳到第一项和最后一项，Page Up / Page Down 每次跳 10 项。',
  pair: (name, value) => `${name} ${value}`,
  announce: (series, pairs, position) => `${series}：${pairs}。${position}`,
};

export const POLAR_MESSAGES = { en, ko, 'zh-CN': zh } as const;
