// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  ChartA11y,
  buildA11yModel,
  buildChartDescription,
  buildChartSummary,
  buildDataTable,
  heatmapToCSV,
  keyboardHelp,
  pointAnnouncement,
  tableToCSV,
  tooltipContext,
  type ChartA11yHostState,
} from '../sdk/chart-a11y';
import { CHARTURBO_THEMES, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { registerMessages } from '../sdk/i18n';

const lineMeta = (over: Record<string, unknown> = {}) => ({
  kind: 'line',
  names: ['RPS', 'Latency'],
  colors: [
    [1, 0, 0, 1],
    [0, 0, 1, 1],
  ],
  values: [
    [52.6, 135.9, 247.1, 100],
    [5, NaN, 7],
  ],
  offsets: [0, 4],
  visible: [true, false],
  ...over,
});
const pres = (over: Record<string, unknown> = {}) => ({ title: 'Infra', xAxis: {}, yAxis: {}, ...over });
const multiMeta = (over: Record<string, unknown> = {}) => ({
  kind: 'bar-multi',
  mode: 'stacked',
  names: ['North', 'South'],
  colors: [],
  categories: ['Q1', 'Q2', 'Q3'],
  values: [10, 20, 30, 1, 2, 3],
  visible: [true, true],
  ...over,
});
const pieMeta = {
  kind: 'pie',
  names: ['A', 'B', 'C'],
  values: [50, 30, 20],
  percents: [50, 30, 20],
  visible: [true, true, true],
  colors: [],
};
const candleMeta = (over: Record<string, unknown> = {}) => ({
  kind: 'candle',
  colors: [],
  t: [1, 2],
  open: [100, 101],
  high: [105, 106],
  low: [95, 96],
  close: [104, 99],
  volume: [1000, 1001],
  ...over,
});
const heatMeta = {
  kind: 'heatmap',
  rows: 2,
  cols: 2,
  values: new Float64Array([1, NaN, 3, 4]),
  xLabels: ['Mon', 'Tue'],
  yLabels: ['AM', 'PM'],
  rowTop: true,
};

describe('chart-a11y text in Korean', () => {
  const m = buildA11yModel(lineMeta(), pres(), undefined, 'ko')!;

  it('carries the locale on the model', () => {
    expect(m.locale).toBe('ko');
    // Presentation locale is the fallback
    expect(buildA11yModel(lineMeta(), pres({ locale: 'zh-CN' }))!.locale).toBe('zh-CN');
  });

  it('summary, description, announcement', () => {
    expect(buildChartSummary(m)).toBe('Infra. 선 차트, 시리즈 2개, 포인트 7개; RPS 범위 52.6~247.1; Latency 범위 5~7.');
    const d = buildChartDescription(m);
    expect(d).toContain('X축: T+0~T+3.');
    expect(d).toContain('RPS: 값 4개, 최솟값 52.6(T+0), 최댓값 247.1(T+2), 평균 133.9; 시작 52.6, 끝 100(전체 상승).');
    expect(d).toContain('Latency(숨김): 값 2개');
    expect(d).toContain(keyboardHelp('line', 'ko'));
    expect(pointAnnouncement(m, { series: 0, index: 1 })).toBe('T+1, RPS 135.9.');
  });

  it('default names and stacked bar text', () => {
    const bars = buildA11yModel(multiMeta({ names: [], values: [10, 20, 30] }), {}, undefined, 'ko')!;
    expect(bars.series[0].name).toBe('시리즈 1');
    const stacked = buildA11yModel(multiMeta(), {}, undefined, 'ko')!;
    expect(buildChartSummary(stacked)).toBe('누적 막대 차트, 항목 3개, 시리즈 2개; North 범위 10~30; South 범위 1~3.');
    expect(buildChartDescription(stacked)).toContain('항목 3개, 누적 막대.');
    expect(pointAnnouncement(stacked, { series: 1, index: 0 })).toBe('Q1, South 1. 합계 11. 3개 중 1번째.');
    expect(buildDataTable(stacked).columns).toEqual(['항목', 'North', 'South', '합계']);
  });

  it('candles: OHLC names, announcement and keyboard help', () => {
    const c = buildA11yModel(candleMeta(), {}, undefined, 'ko')!;
    expect(c.series.map((s) => s.name)).toEqual(['시가', '고가', '저가', '종가', '거래량']);
    expect(pointAnnouncement(c, { series: 3, index: 0 })).toBe('1, 시가 100, 고가 105, 저가 95, 종가 104, 거래량 1,000. 2개 중 1번째.');
    expect(tooltipContext(c, { series: 3, index: 0 }, [], () => null).items[0].seriesName).toBe('종가');
    const ohlc = buildA11yModel(candleMeta({ mode: 'ohlc' }), {}, undefined, 'ko')!;
    expect(buildChartSummary(ohlc)).toContain('OHLC 차트, 봉 2개');
    expect(buildChartDescription(ohlc)).toContain(keyboardHelp('candle', 'ko', true));
  });

  it('data table DOM: caption, label, sampling note', () => {
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    const state: ChartA11yHostState = {
      canvas,
      overlay: null,
      meta: lineMeta({ values: [[1, 2, 3, 4, 5, 6]], names: ['A'], offsets: [0], visible: [true] }),
      presentation: {},
      locale: 'ko',
      theme: CHARTURBO_THEMES.dark,
      backend: {} as unknown as WasmCharturboEngineBackend,
      details: () => null,
      render: () => {},
    };
    const a11y = new ChartA11y(() => state);
    const table = a11y.showDataTable(undefined, { maxRows: 3 })!;
    expect(table.caption?.textContent).toBe('선 차트 데이터');
    expect(table.parentElement?.getAttribute('aria-label')).toBe('데이터 표: 선 차트 데이터');
    expect(table.parentElement?.querySelector('p')?.textContent).toBe(
      '전체 6행 중 3행만 표시합니다(처음과 끝을 포함해 고르게 추출). 전체 데이터는 CSV로 내보내 확인할 수 있습니다.'
    );
    a11y.dispose();
    canvas.remove();
  });
});

describe('chart-a11y axis breaks and extra axes in Korean / Chinese', () => {
  const p = pres({
    extraY: [{ title: 'Latency' }],
    axisBreaks: [{ axis: 'y', breaks: [{ start: 30, end: 480 }] }],
  });
  it('ko', () => {
    const d = buildChartDescription(buildA11yModel(lineMeta({ seriesAxes: [0, 2] }), p, undefined, 'ko')!);
    expect(d).toContain('추가 Y축(Latency): Latency.');
    expect(d).toContain('Y축: 30~480 구간 생략.');
  });
  it('zh', () => {
    const d = buildChartDescription(buildA11yModel(lineMeta({ seriesAxes: [0, 2] }), p, undefined, 'zh-CN')!);
    expect(d).toContain('附加 Y 轴（Latency）：Latency。');
    expect(d).toContain('Y 轴：省略 30–480 区间。');
  });
});

describe('chart-a11y text in Simplified Chinese', () => {
  it('pie summary, description, announcement, table', () => {
    const m = buildA11yModel(pieMeta, {}, undefined, 'zh-CN')!;
    expect(buildChartSummary(m)).toBe('饼图，3 个扇区，合计 100；A 50%；B 30%；C 20%。');
    expect(buildChartDescription(m)).toContain('A：50（50%）。');
    expect(pointAnnouncement(m, { series: 0, index: 1 })).toBe('B，30，30%。第 2 项，共 3 项。');
    expect(buildDataTable(m).columns).toEqual(['扇区', '数值', '占比']);
  });

  it('heatmap summary, description, CSV header', () => {
    const m = buildA11yModel(heatMeta, {}, undefined, 'zh-CN')!;
    expect(buildChartSummary(m)).toBe('热力图，2 行 × 2 列，数值 1–4（1 个空单元格）。');
    const d = buildChartDescription(m);
    expect(d).toContain('行：2 行，AM 至 PM。');
    expect(d).toContain('数值：最小值 1（AM，Mon），最大值 4（PM，Tue）。');
    expect(pointAnnouncement(m, { series: 0, index: 1 })).toBe('AM，Tue：空。');
    expect(heatmapToCSV(m).split('\r\n')[0]).toBe('行,Mon,Tue');
  });

  it('error bar announcement maps the direction; table columns', () => {
    const m = buildA11yModel(
      lineMeta({
        names: ['E'],
        values: [[10, 20]],
        offsets: [0],
        visible: [true],
        sparse: { kind: 'errorBar', errors: [{ low: [8, 17], high: [12, 23], direction: 'horizontal' }] },
      }),
      {},
      undefined,
      'zh-CN'
    )!;
    expect(buildChartSummary(m)).toContain('误差棒图');
    expect(pointAnnouncement(m, { series: 0, index: 1 })).toBe('T+1，E：20，下限 17，上限 23，水平方向。第 2 项，共 2 项。');
    expect(buildDataTable(m).columns).toEqual(['X', 'E', 'E 下限', 'E 上限']);
  });

  it('scatter table / CSV headers and keyboard help', () => {
    const m = buildA11yModel({ kind: 'scatter', names: [], x: [1, 2], y: [3, 4] }, {}, undefined, 'zh-CN')!;
    expect(tableToCSV(buildDataTable(m)).split('\r\n')[0]).toBe('X,Y,系列');
    expect(buildChartDescription(m)).toContain(keyboardHelp('scatter', 'zh-CN'));
    expect(keyboardHelp('scatter', 'zh-CN')).toContain('上下方向键切换系列');
  });
});

describe('chart-a11y locale numbers and overrides', () => {
  it('default number text follows the chart locale', () => {
    const m = buildA11yModel(multiMeta({ mode: 'grouped', names: ['N'], values: [1234.5, 2, 3] }), {}, undefined, 'de-DE')!;
    // German has no built-in messages: English text, German numbers
    expect(pointAnnouncement(m, { series: 0, index: 0 })).toBe('Q1, N 1.234,5. 1 of 3.');
  });

  it('registerMessages overrides an a11y string', () => {
    registerMessages('x-test-a11y', { a11y: { seriesRange: (name, range) => `${name} spans ${range}` } });
    const m = buildA11yModel(multiMeta(), {}, undefined, 'x-test-a11y')!;
    expect(buildChartSummary(m)).toBe('Stacked bar chart, 3 categories, 2 series; North spans 10–30; South spans 1–3.');
    // Other locales keep the built-in text
    expect(buildChartSummary(buildA11yModel(multiMeta(), {}, undefined, 'en')!)).toContain('North ranges 10–30');
  });
});
