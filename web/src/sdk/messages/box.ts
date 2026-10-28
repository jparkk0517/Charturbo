/**
 * Built-in strings of chart-boxplot.ts (box / violin tooltips, a11y summary, description,
 * announcements, data table). Numbers arrive already formatted in the chart locale; `n`
 * arguments only pick the plural form.
 */

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** English ordinal of a percentile (`1st`, `2nd`, `11th`, `2.5th`) */
const ordinal = (n: number, text: string): string => {
  if (!Number.isInteger(n)) return `${text}th`;
  const t = Math.abs(n) % 100;
  return `${text}${t >= 11 && t <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][t % 10] ?? 'th')}`;
};

const en = {
  boxPlot: 'Box plot',
  violinPlot: 'Violin plot',
  /** Tooltip row of a hovered outlier point */
  outlier: 'Outlier',
  outliers: 'Outliers',
  whiskers: 'Whiskers',
  lowerWhisker: 'Lower whisker',
  upperWhisker: 'Upper whisker',
  q1: 'Q1',
  q3: 'Q3',
  /** Sample count label (tooltip row, table column) */
  n: 'n',
  /** Whisker rule `'minmax'` */
  whiskersMinMax: 'min / max',
  /** Tukey whisker rule, e.g. `1.5 IQR` */
  whiskersIqr: (factor: string) => `${factor} IQR`,
  /** Percentile whisker rule; raw percentiles pick the ordinal suffix */
  whiskersPercentile: (lo: number, hi: number, loText: string, hiText: string) => `${ordinal(lo, loText)}–${ordinal(hi, hiText)} percentile`,
  samples: (n: number, count: string) => `${count} ${plural(n, 'sample', 'samples')}`,
  outlierCount: (n: number, count: string) => `${count} ${plural(n, 'outlier', 'outliers')}`,
  /** Summary sentence: optional title, overview, per-series details */
  summary: (title: string | undefined, overview: string, details: string[]) =>
    `${title ? `${title}. ` : ''}${overview}${details.length ? `; ${details.join('; ')}` : ''}.`,
  /** Summary overview, e.g. `Box plot, 3 categories, 2 series, 50 samples (3 outliers)` */
  overview: (kind: string, categories: string, series: string, samples: string, outliers?: string) =>
    `${kind}, ${categories}, ${series}, ${samples}${outliers ? ` (${outliers})` : ''}`,
  seriesMedians: (name: string, range: string) => `${name} medians ${range}`,
  seriesNoData: (name: string) => `${name} has no data`,
  xAxisTitle: (title: string) => `X axis: ${title}.`,
  yAxisTitle: (title: string) => `Y axis: ${title}.`,
  layoutBox: (categories: string, whiskers: string) => `${categories}; whiskers at ${whiskers}.`,
  layoutViolin: (categories: string, whiskers: string) => `${categories}; violins show the estimated density, whiskers at ${whiskers}.`,
  hiddenName: (name: string) => `${name} (hidden)`,
  /** Description line of a series; `outliers` is omitted for violins */
  seriesDetail: (name: string, hiCategory: string, hiMedian: string, loCategory: string, loMedian: string, samples: string, outliers?: string) =>
    `${name}: highest median ${hiCategory} ${hiMedian}, lowest median ${loCategory} ${loMedian}, ${samples}${outliers ? `, ${outliers}` : ''}.`,
  seriesEmpty: (name: string) => `${name}: no data.`,
  /** Live-region text of a focused group; `outliers` is omitted for violins */
  announce: (
    category: string,
    series: string,
    median: string,
    q1: string,
    q3: string,
    whiskerLo: string,
    whiskerHi: string,
    mean: string,
    samples: string,
    outliers?: string
  ) =>
    `${category}, ${series}: median ${median}, quartiles ${q1} to ${q3}, whiskers ${whiskerLo} to ${whiskerHi}, ` +
    `mean ${mean}, ${samples}${outliers ? `, ${outliers}` : ''}.`,
  announceEmpty: (category: string, series: string) => `${category}, ${series}: no data.`,
};

export type BoxMessages = typeof en;

const ko: BoxMessages = {
  boxPlot: '박스 플롯',
  violinPlot: '바이올린 플롯',
  outlier: '이상치',
  outliers: '이상치',
  whiskers: '수염',
  lowerWhisker: '아래 수염',
  upperWhisker: '위 수염',
  q1: 'Q1',
  q3: 'Q3',
  n: '표본 수',
  whiskersMinMax: '최솟값 / 최댓값',
  whiskersIqr: (factor) => `${factor} IQR`,
  whiskersPercentile: (_lo, _hi, loText, hiText) => `${loText}~${hiText} 백분위수`,
  samples: (_n, count) => `표본 ${count}개`,
  outlierCount: (_n, count) => `이상치 ${count}개`,
  summary: (title, overview, details) => `${title ? `${title}. ` : ''}${overview}${details.length ? `; ${details.join('; ')}` : ''}.`,
  overview: (kind, categories, series, samples, outliers) => `${kind}, ${categories}, ${series}, ${samples}${outliers ? ` (${outliers})` : ''}`,
  seriesMedians: (name, range) => `${name} 중앙값 ${range}`,
  seriesNoData: (name) => `${name} 데이터 없음`,
  xAxisTitle: (title) => `X축: ${title}.`,
  yAxisTitle: (title) => `Y축: ${title}.`,
  layoutBox: (categories, whiskers) => `${categories}, 수염 기준 ${whiskers}.`,
  layoutViolin: (categories, whiskers) => `${categories}, 바이올린은 추정 밀도 표시, 수염 기준 ${whiskers}.`,
  hiddenName: (name) => `${name} (숨김)`,
  seriesDetail: (name, hiCategory, hiMedian, loCategory, loMedian, samples, outliers) =>
    `${name}: 중앙값 최고 ${hiCategory} ${hiMedian}, 최저 ${loCategory} ${loMedian}, ${samples}${outliers ? `, ${outliers}` : ''}.`,
  seriesEmpty: (name) => `${name}: 데이터 없음.`,
  announce: (category, series, median, q1, q3, whiskerLo, whiskerHi, mean, samples, outliers) =>
    `${category}, ${series}: 중앙값 ${median}, 사분위 ${q1}~${q3}, 수염 ${whiskerLo}~${whiskerHi}, ` +
    `평균 ${mean}, ${samples}${outliers ? `, ${outliers}` : ''}.`,
  announceEmpty: (category, series) => `${category}, ${series}: 데이터 없음.`,
};

const zh: BoxMessages = {
  boxPlot: '箱线图',
  violinPlot: '小提琴图',
  outlier: '异常值',
  outliers: '异常值',
  whiskers: '须线',
  lowerWhisker: '下须线',
  upperWhisker: '上须线',
  q1: 'Q1',
  q3: 'Q3',
  n: '样本数',
  whiskersMinMax: '最小值 / 最大值',
  whiskersIqr: (factor) => `${factor} 倍 IQR`,
  whiskersPercentile: (_lo, _hi, loText, hiText) => `第 ${loText} 至第 ${hiText} 百分位数`,
  samples: (_n, count) => `${count} 个样本`,
  outlierCount: (_n, count) => `${count} 个异常值`,
  summary: (title, overview, details) => `${title ? `${title}。` : ''}${overview}${details.length ? `；${details.join('；')}` : ''}。`,
  overview: (kind, categories, series, samples, outliers) => `${kind}，${categories}，${series}，${samples}${outliers ? `（${outliers}）` : ''}`,
  seriesMedians: (name, range) => `${name} 中位数 ${range}`,
  seriesNoData: (name) => `${name} 无数据`,
  xAxisTitle: (title) => `X 轴：${title}。`,
  yAxisTitle: (title) => `Y 轴：${title}。`,
  layoutBox: (categories, whiskers) => `${categories}；须线范围：${whiskers}。`,
  layoutViolin: (categories, whiskers) => `${categories}；小提琴形状表示估计密度，须线范围：${whiskers}。`,
  hiddenName: (name) => `${name}（已隐藏）`,
  seriesDetail: (name, hiCategory, hiMedian, loCategory, loMedian, samples, outliers) =>
    `${name}：中位数最高为 ${hiCategory} ${hiMedian}，最低为 ${loCategory} ${loMedian}，${samples}${outliers ? `，${outliers}` : ''}。`,
  seriesEmpty: (name) => `${name}：无数据。`,
  announce: (category, series, median, q1, q3, whiskerLo, whiskerHi, mean, samples, outliers) =>
    `${category}，${series}：中位数 ${median}，四分位数 ${q1} 至 ${q3}，须线 ${whiskerLo} 至 ${whiskerHi}，` +
    `平均值 ${mean}，${samples}${outliers ? `，${outliers}` : ''}。`,
  announceEmpty: (category, series) => `${category}，${series}：无数据。`,
};

export const BOX_MESSAGES = { en, ko, 'zh-CN': zh } as const;
