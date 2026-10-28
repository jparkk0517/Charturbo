// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
// The a11y layer has its own tests: an inert stand-in that counts refreshes
const a11yRefresh = vi.hoisted(() => ({ count: 0 }));
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {
      a11yRefresh.count++;
    }
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type NodeDetails, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { graphTooltipHtml, graphTooltipStrings } from '../sdk/graph-tooltip';
import { encodePointCloud3D, scientificA11yModel } from '../sdk/chart-scientific3d';
import { formatPercent, pieMeta, pieTooltipHtml } from '../sdk/chart-pie';
import { HeatmapColorbarLayer, heatmapMeta } from '../sdk/chart-heatmap';
import { buildPdf } from '../sdk/chart-pdf';
import { registerMessages } from '../sdk/i18n';
import { fakeCanvas, graphBackend } from './graph-backend';

const theme = CHARTURBO_THEMES.dark;

/** Parses tooltip HTML the way the browser does when it is assigned to `innerHTML`. */
const text = (html: string) => {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el.textContent!;
};

const tooltip = () => document.body.querySelector<HTMLElement>('.charturbo-sdk-node-tooltip')!;
const hover = (handlers: Record<string, (e: unknown) => void>, x = 10) =>
  handlers.pointermove({ buttons: 0, pointerType: 'mouse', clientX: x, clientY: 10 });

/** SDK on the graph test backend with an interactive canvas; `extra` adds chart calls. */
function setup(extra: Partial<WasmCharturboEngineBackend> = {}) {
  const g = graphBackend();
  const sdk = Charturbo.fromBackend({ ...g.backend, ...extra });
  const { canvas, handlers } = fakeCanvas();
  sdk.enableNodeInteractions(canvas);
  return { sdk, handlers, ...g };
}

const node = (over: Partial<NodeDetails> = {}): NodeDetails => ({
  id: 7,
  label: 'api-01',
  position: [1.25, -2, 3],
  mass: 1,
  clusterId: 2,
  color: [0.2, 0.5, 0.9, 1],
  degree: 1234,
  selected: false,
  pinned: false,
  neighbors: [1, 2],
  metadata: { category: 'Gateway' },
  ...over,
});

afterEach(() => document.body.replaceChildren());

describe('graph node text', () => {
  it('tooltip strings in Simplified Chinese', () => {
    expect(graphTooltipStrings('zh-CN')).toBe(graphTooltipStrings('zh'));
    const zh = text(graphTooltipHtml(node(), theme, 'zh-CN', true));
    expect(zh).toContain('Gateway · 簇 2');
    expect(zh).toContain('度');
    expect(zh).toContain('邻居节点');
    expect(zh).toContain('点击以高亮邻居节点');
    expect(zh).not.toContain('Degree');
  });

  it('default node label / category follow the SDK locale; the tooltip skips the default category', () => {
    const { sdk } = setup();
    sdk.setLocale('ko');
    const d = sdk.getNodeDetails(0)!;
    expect(d.label).toBe('노드 #0');
    expect(d.metadata.category).toBe('클러스터 2');
    const ko = text(graphTooltipHtml(d, theme, 'ko'));
    expect(ko).toContain('클러스터 2');
    expect(ko).not.toContain('클러스터 2 · 클러스터 2');
    sdk.setLocale('zh-CN');
    expect(sdk.getNodeMetadata(1).label).toBe('节点 #1');
  });
});

describe('chart text follows the locale', () => {
  it('line point details: category and description', () => {
    const { sdk } = setup();
    sdk.setLocale('ko');
    sdk.renderLineChart([{ name: 'Sales', values: [1, 2, 3] }]);
    const d = sdk.getNodeDetails(1)!;
    expect(d.metadata.category).toBe('선 시리즈: Sales');
    expect(d.metadata.description).toBe('Sales 시계열의 2번째 샘플 데이터 포인트입니다.');
    sdk.setLocale('zh-CN');
    expect(sdk.getNodeDetails(1)!.metadata.category).toBe('折线图系列：Sales');
  });

  it('OHLC tooltip rows, bucket size and change in Korean / Chinese', () => {
    let bucket = new Float64Array([0, 107, 112, 102, 105, 1007, 7, 7]);
    const { sdk, handlers, setHit } = setup({
      set_candle_chart: () => 10,
      set_chart_candle_style: () => {},
      chart_candle: () => bucket,
    });
    sdk.setLocale('ko-KR');
    const open = Array.from({ length: 10 }, (_, i) => 100 + i);
    sdk.renderCandlestickChart({ open, high: open.map((o) => o + 5), low: open.map((o) => o - 5), close: open, volume: open });
    let ctx: ChartTooltipContext | null = null;
    sdk.on('hover', (e) => (ctx = e.chart));
    setHit([0, 0, 1, 0, 7, 105, 7]);
    hover(handlers);
    expect((ctx as ChartTooltipContext | null)?.items[0].seriesName).toBe('종가');
    const ko = tooltip().textContent!;
    for (const label of ['시가', '고가', '저가', '종가', '거래량', '-1.87%']) expect(ko).toContain(label);
    expect(ko).not.toContain('Open');
    expect(sdk.getNodeDetails(7)!.metadata.label).toMatch(/^캔들 · /);
    bucket = new Float64Array([4, 104, 113, 98, 106, 5030, 4, 8]);
    sdk.setLocale('zh-CN');
    hover(handlers, 12);
    const zh = tooltip().textContent!;
    expect(zh).toContain('5 根 K 线');
    expect(zh).toContain('开盘');
    expect(zh).toContain('+1.92%');
  });

  it('single-bar tooltip names built-in attributes; legend aria-label and a11y follow setLocale', () => {
    const { sdk, handlers, setHit } = setup({ set_bar_chart: () => 2 });
    sdk.renderBarChart(
      [
        { label: 'A', value: 1 },
        { label: 'B', value: 3 },
      ],
      { legend: true }
    );
    const legend = document.body.querySelector('.charturbo-sdk-chart-legend')!;
    expect(legend.getAttribute('aria-label')).toBe('Chart legend');
    setHit([1, 0, 1, 0, 1, 3, 1]);
    hover(handlers);
    expect(tooltip().textContent).toContain('Share of total: 75.00%');
    expect(tooltip().textContent).toContain('Share of peak: 100.0%');
    const before = a11yRefresh.count;
    sdk.setLocale('ko');
    expect(a11yRefresh.count).toBeGreaterThan(before);
    expect(legend.getAttribute('aria-label')).toBe('차트 범례');
    hover(handlers, 12);
    expect(tooltip().textContent).toContain('전체 대비 비중: 75.00%');
    expect(tooltip().textContent).toContain('최댓값 대비 비율: 100.0%');
    sdk.setLocale('zh-CN');
    expect(legend.getAttribute('aria-label')).toBe('图表图例');
    // Defaults the chart got at render time follow the locale of the next render
    sdk.renderBarChart([{ label: 'A', value: 1 }], { legend: true });
    expect(sdk.getNodeDetails(0)!.metadata.category).toBe('2D 柱状图 / 直方图');
  });
});

describe('module text', () => {
  it('3D charts: default names, summary, help, announcement, table header', () => {
    const palette = theme.palette;
    const ko = encodePointCloud3D([{ data: [[1, 2, 3], [4, 5, 6]] }], palette, 'ko');
    expect(ko.meta.names).toEqual(['시리즈 1']);
    const m = scientificA11yModel(ko.meta, { title: 'Scan', formatValue: String, locale: 'ko' });
    expect(m.custom!.summary()).toBe('Scan. 3D 포인트 클라우드, 샘플 2개, 시리즈 1개.');
    expect(m.custom!.help).toContain('화살표 키');
    expect(m.custom!.announce({ series: 0, index: 1 })).toBe('시리즈 1, X 4, Y 5, Z 6.');
    const zhMeta = encodePointCloud3D([{ name: 'Scan', data: [[1, 2, 3]] }], palette, 'zh-CN').meta;
    const zh = scientificA11yModel(zhMeta, { formatValue: String, locale: 'zh-CN' });
    expect(zh.custom!.summary()).toBe('3D 点云，1 个样本，1 个系列。');
    expect(zh.custom!.description()).toEqual(['Y 轴朝上的坐标系。非有限样本显示为空缺。']);
    expect(zh.custom!.table!((n) => Array.from({ length: n }, (_, i) => i)).columns).toEqual(['系列', 'X', 'Y', 'Z']);
  });

  it('pie defaults, "Other" members and missing percent', () => {
    const data = { labels: ['a'], values: [1] };
    expect(pieMeta(data, { donut: 0.5 }, 'ko')).toMatchObject({ valueLabel: '값', otherLabel: '기타', center: { caption: '합계' } });
    expect(pieMeta(data, { donut: 0.5 }, 'zh-CN').center.caption).toBe('合计');
    const members = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
    const ctx = {
      chartType: 'pie',
      index: 0,
      xLabel: '其他',
      items: [{ seriesName: '其他', value: 8, color: '#888', nodeId: 0 }],
      slice: { label: '其他', value: 8, percent: 8, members },
      details: null,
    } as ChartTooltipContext;
    expect(text(pieTooltipHtml(ctx, theme, String, 'zh-CN'))).toContain('m1、m2、m3、m4、m5、m6、等 2 项');
    expect(text(pieTooltipHtml(ctx, theme, String, 'en'))).toContain('m6, and 2 more');
    expect(formatPercent(NaN, 'ko')).toBe('—');
  });

  it('heatmap default value name and colorbar aria-label', () => {
    expect(heatmapMeta({ cols: 1, rows: 1, values: [1] }, undefined, 'zh-CN').valueLabel).toBe('数值');
    const meta = heatmapMeta({ cols: 1, rows: 1, values: [1] }, { valueLabel: 'ms' }, 'ko');
    const bar = new HeatmapColorbarLayer(document.body, meta);
    const backend = { chart_heatmap_colorbar: () => new Float64Array([0, 10, 5, 0]) } as unknown as WasmCharturboEngineBackend;
    bar.refresh(backend, theme, 'ko');
    expect(bar.root.getAttribute('aria-label')).toBe('ms 색상 척도, 0~10, 중간값 5');
    bar.refresh(backend, theme, 'zh-CN');
    expect(bar.root.getAttribute('aria-label')).toBe('ms色阶，从 0 到 10，中点 5');
  });

  it('PDF default title in the locale (UTF-16 text string)', () => {
    const page = { widthPt: 1, heightPt: 1, image: { width: 1, height: 1, data: new Uint8Array(3), deflated: false } };
    const pdf = (p: object) => new TextDecoder('latin1').decode(buildPdf({ ...page, ...p }));
    expect(pdf({})).toContain('/Title (Chart)');
    // 차트 = U+CC28 U+D2B8
    expect(pdf({ locale: 'ko' })).toContain('/Title <FEFFCC28D2B8>');
    expect(pdf({ title: 'Q3 매출' })).toContain('/Title <FEFF005100330020B9E4CD9C>');
  });
});

describe('registerMessages', () => {
  it('overrides core strings for a locale', () => {
    registerMessages('x-test-core', { core: { legend: 'Legend X', degree: 'Deg X' } });
    expect(graphTooltipStrings('x-test-core').degree).toBe('Deg X');
    // Unregistered strings keep English
    expect(graphTooltipStrings('x-test-core').neighbors).toBe('Neighbors');
    const { sdk } = setup({ set_bar_chart: () => 2 });
    sdk.setLocale('x-test-core');
    sdk.renderBarChart([{ label: 'A', value: 1 }], { legend: true });
    expect(document.body.querySelector('.charturbo-sdk-chart-legend')!.getAttribute('aria-label')).toBe('Legend X');
  });
});
