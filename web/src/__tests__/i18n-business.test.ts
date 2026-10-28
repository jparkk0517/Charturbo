import { describe, expect, it } from 'vitest';
import { CHARTURBO_THEMES, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { buildA11yModel, buildChartDescription, buildChartSummary, buildDataTable, pointAnnouncement } from '../sdk/chart-a11y';
import { localizeBusinessMeta } from '../sdk/chart-business';
import { radarMeta, radarTooltipContext } from '../sdk/chart-radar';
import { gaugeMeta, gaugeTooltipContext, gaugeTooltipHtml, sendGauge } from '../sdk/chart-gauge';
import { funnelLabelParts, funnelMeta, funnelTooltipContext, funnelTooltipHtml } from '../sdk/chart-funnel';
import { waterfallMeta, waterfallTooltipContext, waterfallTooltipHtml } from '../sdk/chart-waterfall';
import { getMessages, registerMessages } from '../sdk/i18n';

const theme = CHARTURBO_THEMES.dark;
const fmt = (v: number) => String(v);
const noDetails = () => null;

function radar(locale: string) {
  const meta = radarMeta(
    {
      axes: ['Speed', 'Range', 'Cost'],
      series: [
        { name: '', values: [80, 60, null] },
        { name: 'B', values: [50, 90, 40] },
      ],
    },
    {},
    fmt,
    locale
  );
  meta.colors = [
    [1, 0, 0, 1],
    [0, 0, 1, 1],
  ];
  meta.max = 100;
  meta.axisMax = [100, 100, 100];
  return meta;
}

/** Gauge with a `good` 0-60 and a `critical` 60-100 band (engine stand-in for the band sync). */
function gauge(locale: string) {
  const meta = gaugeMeta(
    { value: 72 },
    {
      bands: [
        { from: 0, to: 60, status: 'good' },
        { from: 60, to: 100, status: 'critical' },
      ],
    },
    fmt,
    locale
  );
  const backend = { set_gauge_chart: () => 3, chart_gauge_bands: () => new Float64Array([0, 0, 60, 1, 60, 100]) };
  sendGauge(backend as unknown as WasmCharturboEngineBackend, meta, undefined, theme);
  return meta;
}

function funnel(locale: string) {
  const meta = funnelMeta({ labels: ['Visits', 'Signups', 'Paid'], values: [1000, 400, 100] }, { conversion: 'both' }, fmt, locale);
  meta.pctFirst = [100, 40, 10];
  meta.pctPrev = [NaN, 40, 25];
  meta.stageColors = [
    [1, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 0, 0, 1],
  ];
  return meta;
}

function waterfall(locale: string) {
  const meta = waterfallMeta({ labels: ['a', 'b'], values: [10, -4] }, { total: true }, fmt, locale);
  meta.items = [
    { kind: 'increase', value: 10, start: 0, end: 10 },
    { kind: 'decrease', value: -4, start: 10, end: 6 },
    { kind: 'total', value: 6, start: 0, end: 6 },
  ];
  return meta;
}

describe('i18n: business charts', () => {
  it('radar: Korean default names, summary, description, table and announcement', () => {
    const meta = radar('ko');
    expect(meta.names).toEqual(['시리즈 1', 'B']);
    expect(meta.valueLabel).toBe('값');
    const model = buildA11yModel(meta, { title: '자동차' }, undefined, 'ko')!;
    expect(model.custom?.kindLabel).toBe('레이더');
    expect(buildChartSummary(model)).toBe('자동차. 레이더 차트, 축 3개, 시리즈 2개; 시리즈 1의 최고 축 Speed(80); B의 최고 축 Range(90).');
    const desc = buildChartDescription(model);
    expect(desc).toContain('축: Speed, Range, Cost.');
    expect(desc).toContain('방사형 눈금 0~100.');
    expect(desc).toContain('시리즈 1: Speed 80, Range 60, Cost 데이터 없음.');
    expect(desc).toContain('위·아래 화살표로 시리즈 전환');
    expect(buildDataTable(model).columns).toEqual(['축', '시리즈 1', 'B']);
    expect(pointAnnouncement(model, { series: 1, index: 2 })).toBe('Cost, B 40. 3개 중 3번째.');
    // Tooltip fallback name of an out-of-range series
    const ctx = radarTooltipContext(meta, [0, 0, 1, 5, 0, 1, 0], noDetails)!;
    expect(ctx.items[0].seriesName).toBe('시리즈 6');
  });

  it('gauge: Chinese status names, tooltip, summary and table', () => {
    const meta = gauge('zh-CN');
    expect(meta.valueLabel).toBe('数值');
    expect(meta.bands.map((b) => b.label)).toEqual(['良好', '危急']);
    const model = buildA11yModel(meta, { title: '负载' }, undefined, 'zh-CN')!;
    expect(buildChartSummary(model)).toBe('负载。仪表盘，72（危急），刻度范围 0 至 100，2 个区间。');
    expect(buildChartDescription(model)).toContain('良好：0 至 60。');
    expect(pointAnnouncement(model, { series: 0, index: 1 })).toBe('良好 区间，0 至 60。第 2 项，共 3 项。');
    expect(pointAnnouncement(model, { series: 0, index: 0 })).toBe('数值 72（危急）。第 1 项，共 3 项。');
    const table = buildDataTable(model);
    expect(table.columns).toEqual(['项目', '数值', '起始', '结束']);
    expect(table.rows[2]).toEqual(['危急', null, 60, 100]);
    const html = gaugeTooltipHtml(gaugeTooltipContext(meta, 0, noDetails)!, meta, theme, fmt, 'zh-CN');
    expect(html).toContain('状态');
    expect(html).toContain('范围');
    expect(gaugeTooltipHtml(gaugeTooltipContext(meta, 1, noDetails)!, meta, theme, fmt, 'zh-CN')).toContain('区间');
    // Unlabeled bands get a localized default name; `setLocale` re-resolves the defaults
    meta.bands[0].label = '';
    expect(buildChartDescription(buildA11yModel(meta, {}, undefined, 'ko')!)).toContain('구간 1: 0~60.');
    localizeBusinessMeta(meta, 'en');
    expect([meta.valueLabel, ...meta.bands.map((b) => b.label)]).toEqual(['Value', 'Good', 'Critical']);
  });

  it('gauge: Korean status names and value label given in the options win', () => {
    const meta = gaugeMeta({ value: 1 }, { valueLabel: 'CPU', bands: [{ from: 0, to: 1, status: 'warning', label: 'Hot' }] }, fmt, 'ko');
    sendGauge(
      { set_gauge_chart: () => 2, chart_gauge_bands: () => new Float64Array([0, 0, 1]) } as unknown as WasmCharturboEngineBackend,
      meta,
      undefined,
      theme
    );
    expect([meta.valueLabel, meta.bands[0].label]).toEqual(['CPU', 'Hot']);
    expect(getMessages('ko').business.status.warning).toBe('주의');
  });

  it('funnel: Korean stage labels, tooltip and a11y', () => {
    const meta = funnel('ko');
    expect(funnelLabelParts(meta, 1).conversion).toBe('40.0% · 이전 단계 대비 40.0%');
    expect(funnelLabelParts({ ...meta, orientation: 'horizontal' }, 2).conversion).toBe('10.0% · 이전 25.0%');
    const html = funnelTooltipHtml(funnelTooltipContext(meta, 2, noDetails)!, theme, fmt, 'ko');
    expect(html).toContain('첫 단계 대비');
    expect(html).toContain('이전 단계 대비');
    const model = buildA11yModel(meta, {}, undefined, 'ko')!;
    expect(buildChartSummary(model)).toBe('퍼널 차트, 단계 3개, 1000에서 100까지; Paid: Visits 대비 10%.');
    expect(buildDataTable(model).columns).toEqual(['단계', '값', '첫 단계 대비 %', '이전 단계 대비 %']);
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('Paid, 100. 첫 단계 대비 10%, 이전 단계 대비 25%. 3개 중 3번째.');
    expect(pointAnnouncement(model, { series: 0, index: 0 })).toBe('Visits, 1000. 3개 중 1번째.');
  });

  it('funnel: Chinese summary', () => {
    const model = buildA11yModel(funnel('zh-CN'), { title: '转化' }, undefined, 'zh-CN')!;
    expect(buildChartSummary(model)).toBe('转化。漏斗图，3 个阶段，从 1000 到 100；Paid 为 Visits 的 10%。');
    expect(buildChartDescription(model)).toContain('Signups：400，占第一阶段 40%，占上一阶段 40%。');
  });

  it('waterfall: Chinese kind names, appended total, tooltip and a11y; setLocale re-resolves', () => {
    const meta = waterfall('zh-CN');
    expect(meta.categories).toEqual(['a', 'b', '合计']);
    expect(meta.kindNames).toEqual({ increase: '增加', decrease: '减少', total: '合计' });
    expect(meta.valueLabel).toBe('变化');
    const html = waterfallTooltipHtml(waterfallTooltipContext(meta, 1, noDetails)!, theme, fmt, 'zh-CN');
    expect(html).toContain('累计值');
    expect(html).toContain('−4');
    const model = buildA11yModel(meta, { title: '利润' }, undefined, 'zh-CN')!;
    expect(buildChartSummary(model)).toBe('利润。瀑布图，3 项，最终为 6；最大增幅 a +10；最大降幅 b −4。');
    const desc = buildChartDescription(model);
    expect(desc).toContain('b：−4，累计值 6。');
    expect(desc).toContain('合计：合计 6。');
    expect(pointAnnouncement(model, { series: 0, index: 2 })).toBe('合计，合计 6。第 3 项，共 3 项。');
    expect(buildDataTable(model).columns.slice(1)).toEqual(['变化', '累计值']);
    localizeBusinessMeta(meta, 'ko');
    expect(meta.categories[2]).toBe('합계');
    expect(meta.kindNames.increase).toBe('증가');
  });

  it('waterfall: Korean summary and the English default lower-case total', () => {
    const ko = buildA11yModel(waterfall('ko'), {}, undefined, 'ko')!;
    expect(buildChartSummary(ko)).toBe('워터폴 차트, 3개 항목, 최종 6; 최대 증가 a +10; 최대 감소 b −4.');
    expect(pointAnnouncement(ko, { series: 0, index: 1 })).toBe('b, −4, 누적 합계 6. 3개 중 2번째.');
    expect(buildChartDescription(buildA11yModel(waterfall('en'), {}, undefined, 'en')!)).toContain('Total: total 6.');
  });

  it('registerMessages overrides business strings', () => {
    registerMessages('x-test-business', { business: { runningTotal: 'Cumulative', increase: 'Up' } });
    const meta = waterfall('x-test-business');
    expect(meta.kindNames.increase).toBe('Up');
    expect(waterfallTooltipHtml(waterfallTooltipContext(meta, 0, noDetails)!, theme, fmt, 'x-test-business')).toContain('Cumulative');
    // Other strings keep English
    expect(meta.kindNames.decrease).toBe('Decrease');
  });
});
