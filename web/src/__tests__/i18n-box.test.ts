import { describe, expect, it } from 'vitest';
import { CHARTURBO_THEMES, type ChartTooltipContext } from '../sdk/charturbo';
import type { A11yChartModel } from '../sdk/chart-a11y';
import {
  BOX_STATS_STRIDE,
  boxA11yData,
  boxAnnouncement,
  boxDataTable,
  boxDescription,
  boxSummary,
  boxTooltipHtml,
  boxTooltipOf,
  encodeBoxPlot,
  whiskerLabel,
  type BoxChartMeta,
} from '../sdk/chart-boxplot';
import { registerMessages } from '../sdk/i18n';

/** One group's engine stats row: n, min, q1, median, q3, max, mean, std, wlo, whi, outliers. */
const row = (median: number, outliers = 0): number[] => [10, 1, median - 2, median, median + 2, 100, median + 1, 3, 1, median + 5, outliers];

/** 2 series x 3 categories; group (1, 2) is empty. */
const STATS = new Float64Array([...row(5, 1), ...row(6), ...row(7), ...row(8), ...row(9, 2), 0, ...new Array(BOX_STATS_STRIDE - 1).fill(NaN)]);

const META: BoxChartMeta = {
  kind: 'box',
  names: ['Control', 'Treated'],
  colors: [CHARTURBO_THEMES.dark.palette[0], CHARTURBO_THEMES.dark.palette[1]],
  categories: ['A', 'B', 'C'],
  visible: [true, false],
  stats: STATS,
  violin: false,
  whiskers: 'tukey',
  iqrFactor: 1.5,
  valueLabel: 'ms',
};

/** Box a11y model as `buildA11yModel` shapes it (without depending on chart-a11y at runtime). */
function model(meta: BoxChartMeta = META): A11yChartModel {
  const { box, medians } = boxA11yData(meta as unknown as Record<string, unknown>);
  const label = (i: number) => box.categories[i] ?? `#${i + 1}`;
  return {
    kind: 'box',
    title: 'Latency',
    xTitle: 'Group',
    yTitle: 'ms',
    series: medians.map((v, s) => ({ name: meta.names[s], values: v, visible: meta.visible[s], f32: false })),
    length: box.categories.length,
    box,
    xLabel: label,
    xValue: label,
    formatX: label,
    formatValue: (v) => (Number.isFinite(v) ? v.toLocaleString('en-US') : 'no data'),
    pointId: (s, i) => s * box.categories.length + i,
    itemName: (s) => meta.names[s] ?? '',
    itemColor: () => [0.5, 0.5, 0.5, 1],
  };
}

describe('Box plot text in Korean / Chinese', () => {
  it('summarizes, describes and announces in Korean', () => {
    const m = model();
    expect(boxSummary(m, 'ko')).toBe('Latency. 박스 플롯, 항목 3개, 시리즈 2개, 표본 50개 (이상치 3개); Control 중앙값 5~7; Treated 중앙값 8~9.');
    const desc = boxDescription(m, 'ko');
    expect(desc).toContain('X축: Group.');
    expect(desc).toContain('항목 3개, 수염 기준 1.5 IQR.');
    expect(desc).toContain('Treated (숨김): 중앙값 최고 B 9, 최저 A 8, 표본 20개, 이상치 2개.');
    expect(boxAnnouncement(m, { series: 1, index: 1 }, 'ko')).toBe(
      'B, Treated: 중앙값 9, 사분위 7~11, 수염 1~14, 평균 10, 표본 10개, 이상치 2개. 3개 중 2번째.'
    );
    expect(boxAnnouncement(m, { series: 1, index: 2 }, 'ko')).toBe('C, Treated: 데이터 없음. 3개 중 3번째.');
    const table = boxDataTable(m, (n) => Array.from({ length: n }, (_, i) => i), 'ko');
    expect(table.columns).toEqual(['Group', '시리즈', '표본 수', '최솟값', 'Q1', '중앙값', 'Q3', '최댓값', '평균', '아래 수염', '위 수염', '이상치']);
  });

  it('summarizes, describes and announces in Chinese', () => {
    const m = { ...model(), xTitle: undefined };
    expect(boxSummary(m, 'zh-CN')).toBe(
      'Latency。箱线图，3 个类别，2 个系列，50 个样本（3 个异常值）；Control 中位数 5–7；Treated 中位数 8–9。'
    );
    const desc = boxDescription(m, 'zh-CN');
    expect(desc).toContain('Y 轴：ms。');
    expect(desc).toContain('Treated（已隐藏）：中位数最高为 B 9，最低为 A 8，20 个样本，2 个异常值。');
    expect(boxAnnouncement(m, { series: 0, index: 0 }, 'zh-CN')).toBe(
      'A，Control：中位数 5，四分位数 3 至 7，须线 1 至 10，平均值 6，10 个样本，1 个异常值。 第 1 项，共 3 项。'
    );
    expect(boxDataTable(m, () => [0], 'zh-CN').columns.slice(0, 3)).toEqual(['类别', '系列', '样本数']);
  });

  it('describes violins and whisker rules per language (English ordinals)', () => {
    const violin = model({ ...META, violin: true, whiskers: [5, 95] });
    expect(boxSummary(violin, 'ko')).toContain('바이올린 플롯, 항목 3개, 시리즈 2개, 표본 50개;');
    expect(boxDescription(violin, 'zh-CN')).toContain('3 个类别；小提琴形状表示估计密度，须线范围：第 5 至第 95 百分位数。');
    expect(whiskerLabel([1, 99], 1.5, 'en')).toBe('1st–99th percentile');
    expect(whiskerLabel([2, 3], 1.5, 'en')).toBe('2nd–3rd percentile');
    expect(whiskerLabel([11, 12], 1.5, 'en')).toBe('11th–12th percentile');
    expect(whiskerLabel([2.5, 97.5], 1.5, 'en')).toBe('2.5th–97.5th percentile');
    expect(whiskerLabel([5, 95], 1.5, 'ko')).toBe('5~95 백분위수');
    expect(whiskerLabel('minmax', 1.5, 'zh-CN')).toBe('最小值 / 最大值');
    expect(whiskerLabel('tukey', 3, 'zh-CN')).toBe('3 倍 IQR');
  });

  it('localizes tooltips, default names and the folded "Other" series', () => {
    expect(boxTooltipOf({ ...META, names: [] }, 0, 1, 6, 1, 'ko')!.seriesName).toBe('시리즈 1');
    const b = boxTooltipOf(META, 0, 1, 6, 1, 'ko')!;
    const ctx = { chartType: 'box', index: 1, xLabel: 'B', items: [{ seriesName: 'Control', value: 6, color: '#000', nodeId: 1 }], box: b } as unknown as ChartTooltipContext;
    const html = boxTooltipHtml(ctx, CHARTURBO_THEMES.light, String, String, 'ko');
    for (const text of ['최댓값', '중앙값', '평균', '표본 수', '이상치', '수염']) expect(html).toContain(text);
    expect(boxTooltipHtml({ ...ctx, box: { ...b, outlier: 100 } }, CHARTURBO_THEMES.light, String, String, 'zh-CN')).toContain('异常值');

    const many = { categories: ['A'], series: Array.from({ length: 10 }, (_, k) => ({ name: `S${k}`, values: [[k]] })) };
    const palette = CHARTURBO_THEMES.light.palette;
    expect(encodeBoxPlot(many, palette, palette[0], undefined, 'zh-CN').names.at(-1)).toBe('其他');
  });

  it('registerMessages overrides a box string', () => {
    // Private-use subtag: a valid Intl locale (number formatting) that no other test registers
    registerMessages('en-x-testbox', { box: { boxPlot: 'Boxes' } });
    expect(boxSummary(model(), 'en-x-testbox')).toMatch(/^Latency\. Boxes, 3 categories, 2 series, 50 samples/);
  });
});
