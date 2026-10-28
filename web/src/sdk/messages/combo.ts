/**
 * Built-in strings of chart-combo.ts (point details, a11y summary, description, announcements).
 * Numbers arrive already formatted in the chart locale.
 */

const en = {
  /** Series kind words in the summary / roles (`bars: Revenue, Cost`, `line, right axis`) */
  type: { bar: 'bars', line: 'line', area: 'area' },
  /** Series role on a dual-axis chart, e.g. `bars, left axis` */
  onLeftAxis: (type: string) => `${type}, left axis`,
  onRightAxis: (type: string) => `${type}, right axis`,
  /** Bar layout of 2+ bar series (description) */
  barMode: { grouped: 'bars grouped', stacked: 'bars stacked', percent: 'bars stacked to 100%' },
  /** Details description of a point */
  pointDescription: (series: string, category: string) => `Value of ${series} at ${category}.`,
  /** Summary sentence: optional title, overview, per-series details */
  summary: (title: string | undefined, overview: string, details: string[]) =>
    `${title ? `${title}. ` : ''}${overview}${details.length ? `; ${details.join('; ')}` : ''}.`,
  /** Summary overview, e.g. `Combo chart, 12 categories, 3 series (bars: Revenue, Cost; line: Margin), two y axes` */
  overview: (categories: string, series: string, groups: string[], dual: boolean) =>
    `Combo chart, ${categories}, ${series} (${groups.join('; ')})${dual ? ', two y axes' : ''}`,
  /** Series of one kind in the overview, e.g. `bars: Revenue, Cost` */
  typeGroup: (type: string, names: string) => `${type}: ${names}`,
  seriesRange: (name: string, range: string) => `${name} ranges ${range}`,
  seriesNoData: (name: string) => `${name} has no data`,
  xAxisTitle: (title: string) => `X axis: ${title}.`,
  yAxisTitle: (title: string) => `Y axis: ${title}.`,
  leftAxisTitle: (title: string) => `Left y axis: ${title}.`,
  rightAxisTitle: (title: string) => `Right y axis: ${title}.`,
  /** Category count plus the bar layout when there are 2+ bar series */
  layout: (categories: string, barMode?: string) => `${categories}${barMode ? `, ${barMode}` : ''}.`,
  /** Series name with its role, e.g. `Margin (line, right axis)` */
  seriesLabel: (name: string, role: string) => `${name} (${role})`,
  seriesLabelHidden: (name: string, role: string) => `${name} (${role}) (hidden)`,
  seriesDetail: (label: string, hiX: string, hiValue: string, loX: string, loValue: string, mean: string) =>
    `${label}: highest ${hiX} ${hiValue}, lowest ${loX} ${loValue}, average ${mean}.`,
  seriesEmpty: (label: string) => `${label}: no data.`,
  /** Live-region text of a focused point, e.g. `Q3, Margin (line) 15%.` */
  announce: (x: string, label: string, value: string) => `${x}, ${label} ${value}.`,
};

export type ComboMessages = typeof en;

const ko: ComboMessages = {
  type: { bar: '막대', line: '선', area: '영역' },
  onLeftAxis: (type) => `${type}, 왼쪽 축`,
  onRightAxis: (type) => `${type}, 오른쪽 축`,
  barMode: { grouped: '막대 묶음형', stacked: '막대 누적형', percent: '막대 100% 누적형' },
  pointDescription: (series, category) => `${category} 항목의 ${series} 시리즈 값입니다.`,
  summary: (title, overview, details) => `${title ? `${title}. ` : ''}${overview}${details.length ? `; ${details.join('; ')}` : ''}.`,
  overview: (categories, series, groups, dual) => `콤보 차트, ${categories}, ${series} (${groups.join('; ')})${dual ? ', Y축 2개' : ''}`,
  typeGroup: (type, names) => `${type}: ${names}`,
  seriesRange: (name, range) => `${name} 범위 ${range}`,
  seriesNoData: (name) => `${name} 데이터 없음`,
  xAxisTitle: (title) => `X축: ${title}.`,
  yAxisTitle: (title) => `Y축: ${title}.`,
  leftAxisTitle: (title) => `왼쪽 Y축: ${title}.`,
  rightAxisTitle: (title) => `오른쪽 Y축: ${title}.`,
  layout: (categories, barMode) => `${categories}${barMode ? `, ${barMode}` : ''}.`,
  seriesLabel: (name, role) => `${name} (${role})`,
  seriesLabelHidden: (name, role) => `${name} (${role}, 숨김)`,
  seriesDetail: (label, hiX, hiValue, loX, loValue, mean) => `${label}: 최고 ${hiX} ${hiValue}, 최저 ${loX} ${loValue}, 평균 ${mean}.`,
  seriesEmpty: (label) => `${label}: 데이터 없음.`,
  announce: (x, label, value) => `${x}, ${label} ${value}.`,
};

const zh: ComboMessages = {
  type: { bar: '柱形', line: '折线', area: '面积' },
  onLeftAxis: (type) => `${type}，左轴`,
  onRightAxis: (type) => `${type}，右轴`,
  barMode: { grouped: '柱形分组排列', stacked: '柱形堆叠', percent: '柱形百分比堆叠' },
  pointDescription: (series, category) => `${series} 系列在 ${category} 的数值。`,
  summary: (title, overview, details) => `${title ? `${title}。` : ''}${overview}${details.length ? `；${details.join('；')}` : ''}。`,
  overview: (categories, series, groups, dual) => `组合图，${categories}，${series}（${groups.join('；')}）${dual ? '，双 Y 轴' : ''}`,
  typeGroup: (type, names) => `${type}：${names}`,
  seriesRange: (name, range) => `${name} 范围 ${range}`,
  seriesNoData: (name) => `${name} 无数据`,
  xAxisTitle: (title) => `X 轴：${title}。`,
  yAxisTitle: (title) => `Y 轴：${title}。`,
  leftAxisTitle: (title) => `左 Y 轴：${title}。`,
  rightAxisTitle: (title) => `右 Y 轴：${title}。`,
  layout: (categories, barMode) => `${categories}${barMode ? `，${barMode}` : ''}。`,
  seriesLabel: (name, role) => `${name}（${role}）`,
  seriesLabelHidden: (name, role) => `${name}（${role}，已隐藏）`,
  seriesDetail: (label, hiX, hiValue, loX, loValue, mean) => `${label}：最高 ${hiX} ${hiValue}，最低 ${loX} ${loValue}，平均 ${mean}。`,
  seriesEmpty: (label) => `${label}：无数据。`,
  announce: (x, label, value) => `${x}，${label} ${value}。`,
};

export const COMBO_MESSAGES = { en, ko, 'zh-CN': zh } as const;
