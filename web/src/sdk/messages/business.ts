/**
 * Built-in strings of chart-radar.ts, chart-gauge.ts, chart-funnel.ts, chart-waterfall.ts,
 * chart-business*.ts. Numbers arrive already formatted in the chart locale; `n` arguments only
 * pick the plural form. Positions (`position`) and count phrases (`seriesCount`, `items`) come
 * from the common group.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const en = {
  /** Chart title before a summary sentence */
  titled: (title: string, text: string) => `${title}. ${text}`,
  /** One `name value` entry of a list (radar axis maxima, series values per axis) */
  namedValue: (name: string, value: string) => `${name} ${value}`,

  /** Data table header of the radar axis column */
  axis: 'Axis',
  /** `series`: count phrase (common `seriesCount`); `highs`: `radarHighest` clauses */
  radarSummary: (nAxes: number, axes: string, series: string, highs: string[]) =>
    `Radar chart, ${axes} ${plural(nAxes, 'axis', 'axes')}, ${series}${highs.length ? `; ${highs.join('; ')}` : ''}.`,
  /** Summary clause: the axis where a series peaks */
  radarHighest: (series: string, axis: string, value: string) => `${series} highest on ${axis} (${value})`,
  radarAxes: (axes: string) => `Axes: ${axes}.`,
  radarSharedScale: (max: string) => `Radial scale from 0 to ${max}.`,
  /** `list`: `namedValue` entries (axis, its maximum) */
  radarAxisScales: (list: string) => `Each axis has its own maximum: ${list}.`,
  radarSeries: (name: string, values: string) => `${name}: ${values}.`,
  radarHiddenSeries: (name: string, values: string) => `${name} (hidden): ${values}.`,
  radarHelp:
    'Keyboard: focus the chart, then use Left and Right arrows to move between axes, Up and Down arrows to ' +
    'switch series, Home and End for the first and last axis, and Escape to clear.',
  radarAnnounce: (axis: string, series: string, value: string, position: string) => `${axis}, ${series} ${value}. ${position}`,

  /** Names of the reserved gauge status bands */
  status: { good: 'Good', warning: 'Warning', serious: 'Serious', critical: 'Critical' },
  /** Default name of the `index`-th gauge band (1-based) */
  bandName: (index: string) => `Band ${index}`,
  /** Tooltip header of a hovered band */
  band: 'Band',
  /** Tooltip row of the band containing the value */
  statusLabel: 'Status',
  /** Tooltip row of the gauge range */
  range: 'Range',
  /** Gauge without a value */
  noValue: 'no value',
  /** Data table columns of a gauge (name, then the value column `common.value`, band start, band end) */
  item: 'Item',
  from: 'From',
  to: 'To',
  /** `band`: name of the band containing the value (`''` = none) */
  gaugeSummary: (value: string, band: string, min: string, max: string, nBands: number, bands: string) =>
    `Gauge, ${value}${band ? ` (${band})` : ''} on a scale from ${min} to ${max}${nBands ? `, ${bands} ${plural(nBands, 'band', 'bands')}` : ''}.`,
  gaugeBand: (name: string, from: string, to: string) => `${name}: ${from} to ${to}.`,
  gaugeHelp: 'Keyboard: focus the chart, then use Left and Right arrows to move between the value and the bands, Home and End for the first and last, and Escape to clear.',
  gaugeValueAnnounce: (name: string, value: string, band: string, position: string) => `${name} ${value}${band ? ` (${band})` : ''}. ${position}`,
  gaugeBandAnnounce: (name: string, from: string, to: string, position: string) => `${name} band, ${from} to ${to}. ${position}`,

  /** Data table header of the funnel stage column */
  stage: 'Stage',
  /** Stage label: conversion from the previous stage */
  ofPrevious: (percent: string) => `${percent} of previous`,
  /** Compact `ofPrevious` under the narrow stages of a horizontal funnel */
  ofPreviousShort: (percent: string) => `${percent} prev.`,
  /** Tooltip rows of the conversion rates */
  ofFirstStage: 'Of first stage',
  ofPreviousStage: 'Of previous stage',
  /** Data table / CSV columns of the conversion rates */
  percentOfFirst: '% of first',
  percentOfPrevious: '% of previous',
  /** `share`: `funnelShare` of the last stage (`''` = single stage) */
  funnelSummary: (n: number, count: string, from: string, to: string, share: string) =>
    `Funnel chart, ${count} ${plural(n, 'stage', 'stages')}, from ${from} to ${to}${share ? `; ${share}` : ''}.`,
  /** `stage` is `percent` of the `first` stage */
  funnelShare: (stage: string, percent: string, first: string) => `${stage} is ${percent} of ${first}`,
  funnelStage: (stage: string, value: string) => `${stage}: ${value}.`,
  funnelStageConversion: (stage: string, value: string, ofFirst: string, ofPrevious: string) =>
    `${stage}: ${value}, ${ofFirst} of first, ${ofPrevious} of previous.`,
  funnelHelp: 'Keyboard: focus the chart, then use Left and Right arrows to move between stages, Home and End for the first and last stage, and Escape to clear.',
  funnelAnnounce: (stage: string, value: string, position: string) => `${stage}, ${value}. ${position}`,
  funnelAnnounceConversion: (stage: string, value: string, ofFirst: string, ofPrevious: string, position: string) =>
    `${stage}, ${value}. ${ofFirst} of first, ${ofPrevious} of previous. ${position}`,

  /** Default waterfall kind names (the total kind uses `common.total`) */
  increase: 'Increase',
  decrease: 'Decrease',
  /** Default name of the waterfall changes */
  change: 'Change',
  runningTotal: 'Running total',
  /** Default total name inside a description sentence */
  totalInSentence: 'total',
  /** `items`: count phrase (common `items`); `end`: final running total (`''` = no items) */
  waterfallSummary: (items: string, end: string, highlights: string[]) =>
    `Waterfall chart, ${items}${end ? `, ending at ${end}` : ''}${highlights.length ? `; ${highlights.join('; ')}` : ''}.`,
  largestIncrease: (label: string, change: string) => `largest increase ${label} ${change}`,
  largestDecrease: (label: string, change: string) => `largest decrease ${label} ${change}`,
  waterfallTotal: (label: string, name: string, value: string) => `${label}: ${name} ${value}.`,
  waterfallChange: (label: string, change: string, total: string) => `${label}: ${change}, running total ${total}.`,
  waterfallHelp: 'Keyboard: focus the chart, then use Left and Right arrows to move between bars, Home and End for the first and last bar, and Escape to clear.',
  waterfallTotalAnnounce: (label: string, name: string, value: string, position: string) => `${label}, ${name} ${value}. ${position}`,
  waterfallChangeAnnounce: (label: string, change: string, total: string, position: string) =>
    `${label}, ${change}, running total ${total}. ${position}`,

  /** Calendar heatmap (chart-calendar.ts): data table header of the date column */
  date: 'Date',
  /** Tooltip value of a day without data */
  calendarNoData: 'No data',
  /** `from` / `to`: dates; `withData`: days with a value; `lo` / `hi`: value range (`''` = no data) */
  calendarSummary: (nDays: number, days: string, from: string, to: string, withData: string, lo: string, hi: string) =>
    `Calendar heatmap, ${days} ${plural(nDays, 'day', 'days')} from ${from} to ${to}, ${withData} with data${lo ? `, from ${lo} to ${hi}` : ''}.`,
  /** One calendar (range) of several */
  calendarBlock: (from: string, to: string, withData: string) => `Calendar from ${from} to ${to}: ${withData} days with data.`,
  /** `vertical`: weeks run down (Left / Right step days) */
  calendarHelp: (vertical: boolean) =>
    `Keyboard: focus the chart, then use ${vertical ? 'Left and Right' : 'Up and Down'} arrows to move by day, ${vertical ? 'Up and Down' : 'Left and Right'} arrows to move by week, ` +
    'Page Up and Page Down for the previous and next month, Home and End for the first and last day, and Escape to clear.',
  calendarAnnounce: (date: string, name: string, value: string, position: string) => `${date}, ${name} ${value}. ${position}`,
  calendarAnnounceEmpty: (date: string, position: string) => `${date}, no data. ${position}`,

  /** Chord diagram (chart-chord.ts): default group name (1-based) */
  chordGroup: (i: number) => `Group ${i}`,
  /** Corner cell of the flow matrix table (rows = from, columns = to) */
  chordCorner: 'From \\ To',
  chordFlow: (from: string, to: string, value: string) => `${from} → ${to} ${value}`,
  /** `largest`: the biggest flows, joined (null = none) */
  chordSummary: (nGroups: number, groups: string, nChords: number, chords: string, largest: string | null) =>
    `Chord diagram, ${groups} ${plural(nGroups, 'group', 'groups')}, ${chords} ${plural(nChords, 'chord', 'chords')}${largest ? `; largest: ${largest}` : ''}.`,
  chordGroupTotal: (name: string, total: string) => `${name}: total ${total}.`,
  chordGroupHidden: (name: string) => `${name}: hidden.`,
  chordHelp:
    'Keyboard: focus the chart, then use Left and Right arrows to move between groups or chords, Down to go from a group to its chords, Up to go from a chord to its source group, Home and End for the first and last item, and Escape to clear.',
  chordGroupAnnounce: (name: string, total: string, position: string) => `${name}, total ${total}. ${position}`,
  chordGroupHiddenAnnounce: (name: string, position: string) => `${name}, hidden. ${position}`,
  /** `back`: the reverse flow (null = none) */
  chordAnnounce: (flow: string, back: string | null, position: string) => `${flow}${back ? `, ${back}` : ''}. ${position}`,
};

export type BusinessMessages = typeof en;

const ko: BusinessMessages = {
  titled: (title, text) => `${title}. ${text}`,
  namedValue: (name, value) => `${name} ${value}`,

  axis: '축',
  radarSummary: (_n, axes, series, highs) => `레이더 차트, 축 ${axes}개, ${series}${highs.length ? `; ${highs.join('; ')}` : ''}.`,
  radarHighest: (series, axis, value) => `${series}의 최고 축 ${axis}(${value})`,
  radarAxes: (axes) => `축: ${axes}.`,
  radarSharedScale: (max) => `방사형 눈금 0~${max}.`,
  radarAxisScales: (list) => `축별 최댓값: ${list}.`,
  radarSeries: (name, values) => `${name}: ${values}.`,
  radarHiddenSeries: (name, values) => `${name}(숨김): ${values}.`,
  radarHelp: '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 축 이동, 위·아래 화살표로 시리즈 전환, Home·End로 첫 축·마지막 축 이동, Esc로 선택 해제.',
  radarAnnounce: (axis, series, value, position) => `${axis}, ${series} ${value}. ${position}`,

  status: { good: '양호', warning: '주의', serious: '심각', critical: '위험' },
  bandName: (index) => `구간 ${index}`,
  band: '구간',
  statusLabel: '상태',
  range: '범위',
  noValue: '값 없음',
  item: '항목',
  from: '시작',
  to: '끝',
  gaugeSummary: (value, band, min, max, n, bands) => `게이지, ${value}${band ? `(${band})` : ''}, 범위 ${min}~${max}${n ? `, 구간 ${bands}개` : ''}.`,
  gaugeBand: (name, from, to) => `${name}: ${from}~${to}.`,
  gaugeHelp: '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 값과 구간 사이 이동, Home·End로 처음·마지막 항목 이동, Esc로 선택 해제.',
  gaugeValueAnnounce: (name, value, band, position) => `${name} ${value}${band ? `(${band})` : ''}. ${position}`,
  gaugeBandAnnounce: (name, from, to, position) => `${name} 구간, ${from}~${to}. ${position}`,

  stage: '단계',
  ofPrevious: (percent) => `이전 단계 대비 ${percent}`,
  ofPreviousShort: (percent) => `이전 ${percent}`,
  ofFirstStage: '첫 단계 대비',
  ofPreviousStage: '이전 단계 대비',
  percentOfFirst: '첫 단계 대비 %',
  percentOfPrevious: '이전 단계 대비 %',
  funnelSummary: (_n, count, from, to, share) => `퍼널 차트, 단계 ${count}개, ${from}에서 ${to}까지${share ? `; ${share}` : ''}.`,
  funnelShare: (stage, percent, first) => `${stage}: ${first} 대비 ${percent}`,
  funnelStage: (stage, value) => `${stage}: ${value}.`,
  funnelStageConversion: (stage, value, ofFirst, ofPrevious) => `${stage}: ${value}, 첫 단계 대비 ${ofFirst}, 이전 단계 대비 ${ofPrevious}.`,
  funnelHelp: '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 단계 이동, Home·End로 첫 단계·마지막 단계 이동, Esc로 선택 해제.',
  funnelAnnounce: (stage, value, position) => `${stage}, ${value}. ${position}`,
  funnelAnnounceConversion: (stage, value, ofFirst, ofPrevious, position) =>
    `${stage}, ${value}. 첫 단계 대비 ${ofFirst}, 이전 단계 대비 ${ofPrevious}. ${position}`,

  increase: '증가',
  decrease: '감소',
  change: '변동',
  runningTotal: '누적 합계',
  totalInSentence: '합계',
  waterfallSummary: (items, end, highlights) =>
    `워터폴 차트, ${items}${end ? `, 최종 ${end}` : ''}${highlights.length ? `; ${highlights.join('; ')}` : ''}.`,
  largestIncrease: (label, change) => `최대 증가 ${label} ${change}`,
  largestDecrease: (label, change) => `최대 감소 ${label} ${change}`,
  waterfallTotal: (label, name, value) => `${label}: ${name} ${value}.`,
  waterfallChange: (label, change, total) => `${label}: ${change}, 누적 합계 ${total}.`,
  waterfallHelp: '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 막대 이동, Home·End로 첫 막대·마지막 막대 이동, Esc로 선택 해제.',
  waterfallTotalAnnounce: (label, name, value, position) => `${label}, ${name} ${value}. ${position}`,
  waterfallChangeAnnounce: (label, change, total, position) => `${label}, ${change}, 누적 합계 ${total}. ${position}`,

  date: '날짜',
  calendarNoData: '데이터 없음',
  calendarSummary: (_nDays, days, from, to, withData, lo, hi) =>
    `캘린더 히트맵, ${from}부터 ${to}까지 ${days}일, 데이터가 있는 날 ${withData}일${lo ? `, 값 ${lo}~${hi}` : ''}.`,
  calendarBlock: (from, to, withData) => `${from}부터 ${to}까지의 캘린더: 데이터가 있는 날 ${withData}일.`,
  calendarHelp: (vertical) =>
    `키보드: 차트에 포커스를 둔 뒤 ${vertical ? '왼쪽·오른쪽' : '위·아래'} 화살표로 하루씩, ${vertical ? '위·아래' : '왼쪽·오른쪽'} 화살표로 한 주씩 이동, ` +
    'Page Up·Page Down으로 이전 달·다음 달, Home·End로 첫날·마지막 날 이동, Esc로 선택 해제.',
  calendarAnnounce: (date, name, value, position) => `${date}, ${name} ${value}. ${position}`,
  calendarAnnounceEmpty: (date, position) => `${date}, 데이터 없음. ${position}`,

  chordGroup: (i) => `그룹 ${i}`,
  chordCorner: '출발 \\ 도착',
  chordFlow: (from, to, value) => `${from} → ${to} ${value}`,
  chordSummary: (_nGroups, groups, _nChords, chords, largest) => `코드 다이어그램, 그룹 ${groups}개, 코드 ${chords}개${largest ? `; 가장 큰 흐름: ${largest}` : ''}.`,
  chordGroupTotal: (name, total) => `${name}: 합계 ${total}.`,
  chordGroupHidden: (name) => `${name}: 숨김.`,
  chordHelp:
    '키보드: 차트에 포커스를 둔 뒤 왼쪽·오른쪽 화살표로 그룹 또는 코드 사이를 이동, 아래 화살표로 그룹에서 그 코드로, 위 화살표로 코드에서 출발 그룹으로 이동, Home·End로 처음·마지막 항목 이동, Esc로 선택 해제.',
  chordGroupAnnounce: (name, total, position) => `${name}, 합계 ${total}. ${position}`,
  chordGroupHiddenAnnounce: (name, position) => `${name}, 숨김. ${position}`,
  chordAnnounce: (flow, back, position) => `${flow}${back ? `, ${back}` : ''}. ${position}`,
};

const zh: BusinessMessages = {
  titled: (title, text) => `${title}。${text}`,
  namedValue: (name, value) => `${name} ${value}`,

  axis: '坐标轴',
  radarSummary: (_n, axes, series, highs) => `雷达图，${axes} 个坐标轴，${series}${highs.length ? `；${highs.join('；')}` : ''}。`,
  radarHighest: (series, axis, value) => `${series} 在 ${axis} 上最高（${value}）`,
  radarAxes: (axes) => `坐标轴：${axes}。`,
  radarSharedScale: (max) => `径向刻度范围 0 至 ${max}。`,
  radarAxisScales: (list) => `各坐标轴最大值不同：${list}。`,
  radarSeries: (name, values) => `${name}：${values}。`,
  radarHiddenSeries: (name, values) => `${name}（已隐藏）：${values}。`,
  radarHelp: '键盘操作：聚焦图表后，用左右方向键在坐标轴之间移动，用上下方向键切换系列，用 Home 和 End 跳到第一个和最后一个坐标轴，按 Esc 清除焦点。',
  radarAnnounce: (axis, series, value, position) => `${axis}，${series} ${value}。${position}`,

  status: { good: '良好', warning: '警告', serious: '严重', critical: '危急' },
  bandName: (index) => `区间 ${index}`,
  band: '区间',
  statusLabel: '状态',
  range: '范围',
  noValue: '无数值',
  item: '项目',
  from: '起始',
  to: '结束',
  gaugeSummary: (value, band, min, max, n, bands) => `仪表盘，${value}${band ? `（${band}）` : ''}，刻度范围 ${min} 至 ${max}${n ? `，${bands} 个区间` : ''}。`,
  gaugeBand: (name, from, to) => `${name}：${from} 至 ${to}。`,
  gaugeHelp: '键盘操作：聚焦图表后，用左右方向键在数值和各区间之间移动，用 Home 和 End 跳到第一项和最后一项，按 Esc 清除焦点。',
  gaugeValueAnnounce: (name, value, band, position) => `${name} ${value}${band ? `（${band}）` : ''}。${position}`,
  gaugeBandAnnounce: (name, from, to, position) => `${name} 区间，${from} 至 ${to}。${position}`,

  stage: '阶段',
  ofPrevious: (percent) => `占上一阶段 ${percent}`,
  ofPreviousShort: (percent) => `上阶段 ${percent}`,
  ofFirstStage: '占第一阶段',
  ofPreviousStage: '占上一阶段',
  percentOfFirst: '占第一阶段 %',
  percentOfPrevious: '占上一阶段 %',
  funnelSummary: (_n, count, from, to, share) => `漏斗图，${count} 个阶段，从 ${from} 到 ${to}${share ? `；${share}` : ''}。`,
  funnelShare: (stage, percent, first) => `${stage} 为 ${first} 的 ${percent}`,
  funnelStage: (stage, value) => `${stage}：${value}。`,
  funnelStageConversion: (stage, value, ofFirst, ofPrevious) => `${stage}：${value}，占第一阶段 ${ofFirst}，占上一阶段 ${ofPrevious}。`,
  funnelHelp: '键盘操作：聚焦图表后，用左右方向键在各阶段之间移动，用 Home 和 End 跳到第一个和最后一个阶段，按 Esc 清除焦点。',
  funnelAnnounce: (stage, value, position) => `${stage}，${value}。${position}`,
  funnelAnnounceConversion: (stage, value, ofFirst, ofPrevious, position) =>
    `${stage}，${value}。占第一阶段 ${ofFirst}，占上一阶段 ${ofPrevious}。${position}`,

  increase: '增加',
  decrease: '减少',
  change: '变化',
  runningTotal: '累计值',
  totalInSentence: '合计',
  waterfallSummary: (items, end, highlights) =>
    `瀑布图，${items}${end ? `，最终为 ${end}` : ''}${highlights.length ? `；${highlights.join('；')}` : ''}。`,
  largestIncrease: (label, change) => `最大增幅 ${label} ${change}`,
  largestDecrease: (label, change) => `最大降幅 ${label} ${change}`,
  waterfallTotal: (label, name, value) => `${label}：${name} ${value}。`,
  waterfallChange: (label, change, total) => `${label}：${change}，累计值 ${total}。`,
  waterfallHelp: '键盘操作：聚焦图表后，用左右方向键在各柱之间移动，用 Home 和 End 跳到第一根和最后一根柱，按 Esc 清除焦点。',
  waterfallTotalAnnounce: (label, name, value, position) => `${label}，${name} ${value}。${position}`,
  waterfallChangeAnnounce: (label, change, total, position) => `${label}，${change}，累计值 ${total}。${position}`,

  date: '日期',
  calendarNoData: '无数据',
  calendarSummary: (_nDays, days, from, to, withData, lo, hi) =>
    `日历热力图，${from} 至 ${to}，共 ${days} 天，其中 ${withData} 天有数据${lo ? `，数值从 ${lo} 到 ${hi}` : ''}。`,
  calendarBlock: (from, to, withData) => `${from} 至 ${to} 的日历：${withData} 天有数据。`,
  calendarHelp: (vertical) =>
    `键盘操作：聚焦图表后，用${vertical ? '左右' : '上下'}方向键按天移动，用${vertical ? '上下' : '左右'}方向键按周移动，` +
    '用 Page Up 和 Page Down 跳到上一个月和下一个月，用 Home 和 End 跳到第一天和最后一天，按 Esc 清除焦点。',
  calendarAnnounce: (date, name, value, position) => `${date}，${name} ${value}。${position}`,
  calendarAnnounceEmpty: (date, position) => `${date}，无数据。${position}`,

  chordGroup: (i) => `组 ${i}`,
  chordCorner: '来源 \\ 目标',
  chordFlow: (from, to, value) => `${from} → ${to} ${value}`,
  chordSummary: (_nGroups, groups, _nChords, chords, largest) => `和弦图，${groups} 个组，${chords} 条弦${largest ? `；最大流量：${largest}` : ''}。`,
  chordGroupTotal: (name, total) => `${name}：合计 ${total}。`,
  chordGroupHidden: (name) => `${name}：已隐藏。`,
  chordHelp: '键盘操作：聚焦图表后，用左右方向键在组或弦之间移动，按下方向键从组进入其弦，按上方向键从弦回到来源组，用 Home 和 End 跳到第一项和最后一项，按 Esc 清除焦点。',
  chordGroupAnnounce: (name, total, position) => `${name}，合计 ${total}。${position}`,
  chordGroupHiddenAnnounce: (name, position) => `${name}，已隐藏。${position}`,
  chordAnnounce: (flow, back, position) => `${flow}${back ? `，${back}` : ''}。${position}`,
};

export const BUSINESS_MESSAGES = { en, ko, 'zh-CN': zh } as const;
