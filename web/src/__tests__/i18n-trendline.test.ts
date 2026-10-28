import { describe, expect, it } from 'vitest';
import { trendDescription, trendLegendLabel, type ScatterTrendlineFit } from '../sdk/chart-trendline';

const fit: ScatterTrendlineFit = {
  series: 0,
  type: 'polynomial',
  order: 2,
  coefficients: [1, 0, -1],
  r2: 0.5,
  points: 3,
  skipped: 0,
  expression: 'y = −x² + 1',
  color: [0, 0, 0, 1],
  width: 2,
  dash: [],
};

describe('i18n: scatter trendline text', () => {
  it('describes a fit in Korean and Chinese', () => {
    expect(trendDescription(fit, 'B', true, 'ko')).toBe('B(숨김) 2차 다항식 추세선: y = −x² + 1, R² = 0.5000, 포인트 3개로 회귀.');
    expect(trendDescription(fit, 'B', false, 'zh-CN')).toBe('B2 次多项式趋势线：y = −x² + 1，R² = 0.5000，基于 3 个数据点拟合。');
  });

  it('localizes skipped points and missing fits in the legend', () => {
    const exp: ScatterTrendlineFit = { ...fit, type: 'exponential', order: 1, coefficients: [], points: 1, skipped: 2, expression: '' };
    expect(trendLegendLabel(exp, null, 'ko')).toBe('지수 회귀 불가(포인트 1개; y ≤ 0인 포인트 2개 제외)');
    expect(trendLegendLabel(exp, 'A', 'zh-CN')).toBe('A: 无法进行指数拟合（1 个数据点；已排除 y ≤ 0 的 2 个数据点）');
    expect(trendLegendLabel(exp, null, 'en')).toBe('no exponential fit (1 point; 2 points with y ≤ 0 skipped)');
  });
});
