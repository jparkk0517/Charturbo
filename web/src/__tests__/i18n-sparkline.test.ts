import { describe, expect, it } from 'vitest';
import { CHARTURBO_THEMES, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { readSparklineSummary, resolveSparkline, sparklineLabel } from '../sdk/chart-sparkline';
import { registerMessages } from '../sdk/i18n';

const theme = CHARTURBO_THEMES.dark;
const none = { chart_sparkline_summary: undefined } as unknown as WasmCharturboEngineBackend;

/** aria-label of a sparkline resolved and labelled in `locale`. */
function label(values: number[], locale: string, options: { label?: string; type?: 'winloss' } = { label: 'CPU' }): string {
  const s = resolveSparkline({ values }, options, theme, [124, 34], locale);
  return sparklineLabel(s, readSparklineSummary(none, s.values), locale);
}

describe('sparkline aria-label i18n', () => {
  it('Korean: trend, flat, empty and win / loss', () => {
    expect(label([50, 40, 45], 'ko')).toBe('CPU: 50에서 45까지 10% 하락, 최솟값 40, 최댓값 50');
    expect(label([0, 3], 'ko')).toBe('CPU: 0에서 3까지 상승, 최솟값 0, 최댓값 3');
    expect(label([7, 9, 7], 'ko')).toBe('CPU: 7 유지, 최솟값 7, 최댓값 9');
    expect(label([7], 'ko')).toBe('CPU: 7 유지');
    expect(label([NaN], 'ko')).toBe('CPU: 데이터 없음');
    expect(label([1, -1, 1, 0], 'ko', { label: '결과', type: 'winloss' })).toBe('결과: 2승, 1패, 1무, 최근 결과: 무');
    // Default name and locale number format
    expect(label([1000, 1234.5], 'ko-KR', {})).toBe('스파크라인: 1,000에서 1,234.5까지 23% 상승, 최솟값 1,000, 최댓값 1,234.5');
  });

  it('Simplified Chinese: full-width punctuation, list separator', () => {
    expect(label([10, 12.5], 'zh-CN')).toBe('CPU：上升 25%，从 10 到 12.5，最小值 10，最大值 12.5');
    expect(label([7, 9, 7], 'zh-CN')).toBe('CPU：持平于 7，最小值 7，最大值 9');
    expect(label([NaN], 'zh')).toBe('CPU：无数据');
    expect(label([1, -1, 1, 0], 'zh-CN', { type: 'winloss' })).toBe('迷你图：2 胜、1 负、1 平，最近结果：平');
  });

  it('the default name follows the label locale, not the resolve locale', () => {
    const s = resolveSparkline({ values: [1, 2] }, undefined, theme, [124, 34], 'en-US');
    expect(s.name).toBe('Sparkline');
    expect(sparklineLabel(s, readSparklineSummary(none, s.values), 'ko')).toMatch(/^스파크라인: /);
  });

  it('English stays unchanged; registerMessages overrides a sparkline string', () => {
    expect(label([1, -1, 1], 'en-US', { label: 'Results', type: 'winloss' })).toBe('Results: 2 wins, 1 loss, last: win');
    registerMessages('en-x-spark', { sparkline: { win: 'W', wins: (_n, count) => `${count}W` } });
    expect(label([1, -1, 1], 'en-x-spark', { label: 'Results', type: 'winloss' })).toBe('Results: 2W, 1 loss, last: W');
  });
});
