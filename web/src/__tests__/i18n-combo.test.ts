import { describe, expect, it } from 'vitest';
import { CHARTURBO_THEMES } from '../sdk/charturbo';
import {
  comboA11yModel,
  comboAnnouncement,
  comboDescription,
  comboMeta,
  comboPointMetadata,
  comboSummary,
  comboTooltipContext,
  encodeCombo,
  type ComboChartData,
} from '../sdk/chart-combo';
import { registerMessages } from '../sdk/i18n';

const DATA: ComboChartData = {
  categories: ['Q1', 'Q2', 'Q3', 'Q4'],
  series: [
    { name: 'Revenue', type: 'bar', values: [10, 20, 30, 40] },
    { name: 'Cost', type: 'bar', values: [5, 5, 10, 10] },
    { name: 'Margin', type: 'line', values: [0.12, 0.18, null as unknown as number, 0.3], yAxis: 'right' },
    { name: 'Trend', type: 'area', values: [8, 16, 24, 32] },
  ],
};

const gray: [number, number, number, number] = [0.5, 0.5, 0.5, 1];
const enc = encodeCombo(DATA, undefined, CHARTURBO_THEMES.dark.palette, CHARTURBO_THEMES.dark.baseline);
const meta = comboMeta(enc, DATA, 'stacked', String);
const pres = { title: 'Quarterly', y2Axis: { title: 'Margin' } };
const common = { title: 'Quarterly', xTitle: 'Quarter', yTitle: 'USD', formatValue: (v: number) => (Number.isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—') };

/** A11y model with Trend hidden, in `locale` (as `buildA11yModel` hands it over). */
const model = (locale?: string) =>
  comboA11yModel({ ...meta, visible: [true, true, true, false] } as unknown as Record<string, unknown>, pres, { ...common, locale }, gray);

describe('Combo chart text in Korean / Chinese', () => {
  it('summarizes, describes and announces in Korean', () => {
    const m = model('ko');
    expect(comboSummary(m)).toBe(
      'Quarterly. 콤보 차트, 항목 4개, 시리즈 4개 (막대: Revenue, Cost; 선: Margin; 영역: Trend), Y축 2개; ' +
        'Revenue 범위 10~40; Cost 범위 5~10; Margin 범위 0.12~0.3; Trend 범위 8~32.'
    );
    const desc = comboDescription(m);
    expect(desc).toEqual([
      'X축: Quarter.',
      '왼쪽 Y축: USD.',
      '오른쪽 Y축: Margin.',
      '항목 4개, 막대 누적형.',
      'Revenue (막대, 왼쪽 축): 최고 Q4 40, 최저 Q1 10, 평균 25.',
      'Cost (막대, 왼쪽 축): 최고 Q3 10, 최저 Q1 5, 평균 7.5.',
      expect.stringMatching(/^Margin \(선, 오른쪽 축\): 최고 Q4 0\.3, 최저 Q1 0\.12/),
      'Trend (영역, 왼쪽 축, 숨김): 최고 Q4 32, 최저 Q1 8, 평균 20.',
    ]);
    expect(comboAnnouncement(m, { series: 0, index: 2 }, '30')).toBe('Q3, Revenue (막대, 왼쪽 축) 30. 4개 중 3번째.');
  });

  it('summarizes, describes and announces in Chinese', () => {
    const m = model('zh-CN');
    expect(comboSummary(m)).toMatch(/^Quarterly。组合图，4 个类别，4 个系列（柱形：Revenue、Cost；折线：Margin；面积：Trend），双 Y 轴；Revenue 范围 10–40；/);
    const desc = comboDescription(m);
    expect(desc).toContain('左 Y 轴：USD。');
    expect(desc).toContain('4 个类别，柱形堆叠。');
    expect(desc).toContain('Trend（面积，左轴，已隐藏）：最高 Q4 32，最低 Q1 8，平均 20。');
    expect(comboAnnouncement(m, { series: 2, index: 3 }, '0.3')).toBe('Q4，Margin（折线，右轴） 0.3。 第 4 项，共 4 项。');
  });

  it('an explicit locale argument wins over the model locale', () => {
    expect(comboSummary(model('ko'), 'zh-CN')).toMatch(/^Quarterly。组合图/);
  });

  it('localizes default names and the point details description', () => {
    const anon = comboA11yModel({ ...meta, names: [], label: undefined } as unknown as Record<string, unknown>, {}, { ...common, locale: 'ko' }, gray);
    expect(anon.series.map((s) => s.name)).toEqual(['시리즈 1', '시리즈 2', '시리즈 3', '시리즈 4']);
    expect(anon.xLabel(0)).toBe('#1');
    expect(comboPointMetadata(meta, 5, 'ko')?.metadata.description).toBe('Q2 항목의 Cost 시리즈 값입니다.');
    expect(comboPointMetadata(meta, 5, 'zh-CN')?.metadata.description).toBe('Cost 系列在 Q2 的数值。');
    expect(comboPointMetadata(meta, 5, 'en')?.metadata.description).toBe('Value of Cost at Q2.');
    const hit = new Float64Array([0, 0, 1, 7, 1, 5, 29]);
    const ctx = comboTooltipContext({ ...meta, names: [] }, hit, () => '#000', () => null, 'zh-CN');
    expect(ctx?.items[0].seriesName).toBe('系列 8');
  });

  it('registerMessages overrides a combo string', () => {
    // Private-use subtag: a valid Intl locale (number formatting) that no other test registers
    registerMessages('en-x-tcombo', { combo: { type: { bar: 'columns', line: 'line', area: 'area' } } });
    expect(comboSummary(model('en-x-tcombo'))).toContain('(columns: Revenue, Cost; line: Margin; area: Trend)');
  });
});
