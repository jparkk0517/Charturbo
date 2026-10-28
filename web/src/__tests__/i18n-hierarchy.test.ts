// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { CHARTURBO_THEMES, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import {
  HierarchyLabelLayer,
  hierarchyA11yModel,
  hierarchyTooltipContext,
  hierarchyTooltipHtml,
  sankeyTooltipContext,
  sendHierarchy,
  sendSankey,
  syncHierarchy,
  syncSankey,
  type HierarchyChartMeta,
  type SankeyChartMeta,
} from '../sdk/chart-hierarchy';
import { registerMessages } from '../sdk/i18n';

const theme = CHARTURBO_THEMES.dark;
const all = (n: number) => Array.from({ length: n }, (_, i) => i);
const css = () => 'red';

/**
 * Two roots (a: a1 6 + a2 4, b 12) under the synthetic root 4. Engine order: b before a; the
 * legend folds a into "Other".
 */
const ROWS = [
  { id: 'a', name: 'a' },
  { id: 'a1', parent: 'a', value: 6 },
  { id: 'a2', parent: 'a', value: 4 },
  { id: 'b', value: 12 },
];
const KIDS: Record<number, number[]> = { 4: [3, 0], 0: [1, 2] };

const engine = {
  chart_hierarchy_values: () => new Float64Array([10, 6, 4, 12, 22]),
  chart_hierarchy_colors: () => new Float32Array(20).fill(0.5),
  chart_hierarchy_info: () => new Float64Array([5, 4, 1, 4]),
  chart_hierarchy_legend: () => new Float64Array([3, 1, 0, 0, 1, -1, 0.5, 0.5, 0.5, 1]),
  chart_hierarchy_layout: () => new Float64Array([4, 0, 0, 0, 0, 0, 0, 0, -1, -1]),
} as unknown as WasmCharturboEngineBackend;

function treemap(locale: string, options?: { valueLabel?: string }): HierarchyChartMeta {
  const meta = sendHierarchy({} as WasmCharturboEngineBackend, 'treemap', ROWS, options, locale);
  syncHierarchy(engine, meta, locale);
  meta.engine = { children: (n) => KIDS[n] ?? [], hover: () => undefined, drill: () => true };
  return meta;
}

function sankey(locale: string): SankeyChartMeta {
  const meta = sendSankey({} as WasmCharturboEngineBackend, { nodes: [{ id: 'A' }, { id: 'B' }], links: [{ source: 'A', target: 'B', value: 10 }] }, undefined, locale);
  const backend = {
    chart_sankey_nodes: () => new Float64Array([0, 10, 0, 10, 0, 0, 0, 0, 1, 10, 10, 0, 0, 0, 0, 0]),
    chart_sankey_links: () => new Float64Array([0, 1, 10, 100]),
    chart_hierarchy_colors: () => new Float32Array(8).fill(0.5),
  } as unknown as WasmCharturboEngineBackend;
  syncSankey(backend, meta, locale);
  return meta;
}

const model = (meta: HierarchyChartMeta | SankeyChartMeta, locale: string, title?: string) =>
  hierarchyA11yModel(meta as unknown as Record<string, unknown>, { title, formatValue: String, locale })!;

describe('hierarchy i18n', () => {
  it('Korean treemap: default names, summary, announcements, table, tooltip, breadcrumb', () => {
    const meta = treemap('ko');
    expect(meta.valueLabel).toBe('값');
    expect(meta.nodeNames[4]).toBe('전체');
    expect(meta.names).toEqual(['b', '기타']);

    const m = model(meta, 'ko', 'Sales');
    const c = m.custom!;
    expect(c.kindLabel).toBe('트리맵');
    expect(c.summary()).toBe('Sales. 트리맵, 노드 4개, 합계 22. 비중 상위: b 54.5%, a 45.5%.');
    expect(c.description()).toContain('a: 10 (45.5%), 하위 노드 2개.');
    expect(c.help).toMatch(/^키보드: /);
    expect(c.announce({ series: 0, index: 1 })).toBe('a1, 6, a의 60%. 2개 중 1번째, 2단계.');
    expect(c.announce({ series: 0, index: 0 })).toBe('a, 10, 전체의 45.5%. 2개 중 2번째, 1단계. 하위 노드 2개. Enter를 누르면 드릴다운합니다.');
    const table = c.table!(all);
    expect(table.columns).toEqual(['경로', '값', '상위 항목 대비 비중', '전체 대비 비중']);
    expect(table.formats![2]!(27.27)).toBe('27.27%');

    const html = hierarchyTooltipHtml(hierarchyTooltipContext(meta, 1, css)!, theme, String, 'ko');
    expect(html).toContain('상위 항목의 60.0%');
    expect(html).toContain('전체의 27.3%');

    const layer = new HierarchyLabelLayer(document.body, meta, () => {});
    layer.update(engine, theme, String, 'ko');
    const crumbs = document.querySelector('.charturbo-sdk-breadcrumb')!;
    expect(crumbs.getAttribute('aria-label')).toBe('드릴다운 경로');
    expect(crumbs.textContent).toBe('전체');
    // A locale change re-labels the breadcrumb and (via syncHierarchy) the default names
    syncHierarchy(engine, meta, 'zh-CN');
    layer.update(engine, theme, String, 'zh-CN');
    expect(crumbs.getAttribute('aria-label')).toBe('下钻路径');
    expect(crumbs.textContent).toBe('全部');
    expect([meta.valueLabel, meta.names[1]]).toEqual(['数值', '其他']);
    layer.remove();
  });

  it('Simplified Chinese treemap summary keeps a user valueLabel', () => {
    const meta = treemap('zh-CN', { valueLabel: 'Revenue' });
    const c = model(meta, 'zh-CN').custom!;
    expect(c.summary()).toBe('矩形树图，共 4 个节点，合计 22；占比最大：b 54.5%、a 45.5%。');
    expect(c.announce({ series: 0, index: 1 })).toBe('a1，6，占 a 的 60%。第 1 项，共 2 项，第 2 层。');
    expect(c.table!(all).columns).toEqual(['路径', 'Revenue', '占上级比例', '占总量比例']);
    syncHierarchy(engine, meta, 'ko');
    expect(meta.valueLabel).toBe('Revenue');
  });

  it('Korean and Chinese sankey: summary, announcement, table, tooltip', () => {
    const zh = sankey('zh-CN');
    const z = model(zh, 'zh-CN', '能源').custom!;
    expect(z.kindLabel).toBe('桑基图');
    expect(z.summary()).toBe('能源。桑基图，2 列，2 个节点，1 条连线；最大流量：从 A 到 B 10。');
    expect(z.description()[0]).toBe('A：10（流入 0，流出 10）。');
    expect(z.announce({ series: 1, index: 0 })).toBe('从 A 到 B：10，占 A 的 100%。第 1 条连线，共 1 条。');
    expect(z.table!(all).columns).toEqual(['源节点', '目标节点', '数值', '占源节点比例']);
    expect(hierarchyTooltipHtml(sankeyTooltipContext(zh, 1, 0, css)!, theme, String, 'zh-CN')).toContain('（占 A 的 100.0%）');
    expect(hierarchyTooltipHtml(sankeyTooltipContext(zh, 0, 1, css)!, theme, String, 'zh-CN')).toContain('流入 10');

    const ko = sankey('ko');
    const k = model(ko, 'ko').custom!;
    expect(k.summary()).toBe('생키 다이어그램, 열 2개, 노드 2개, 링크 1개. 주요 흐름: A에서 B까지 10.');
    expect(k.announce({ series: 1, index: 0 })).toBe('A에서 B까지: 10, A의 100%. 링크 1개 중 1번째.');
    expect(k.table!(all).columns).toEqual(['출발', '도착', '값', '출발 노드 대비 비중']);
    expect(hierarchyTooltipHtml(sankeyTooltipContext(ko, 0, 0, css)!, theme, String, 'ko')).toContain('유출 10');
  });

  it('English defaults stay; registerMessages overrides a hierarchy string', () => {
    const en = treemap('en-US');
    expect([en.valueLabel, en.nodeNames[4], en.names[1]]).toEqual(['Value', 'All', 'Other']);
    registerMessages('en-x-hier', { hierarchy: { rootLabel: 'Everything', ofParent: (share) => `${share} of the parent` } });
    const meta = treemap('en-x-hier');
    expect(meta.nodeNames[4]).toBe('Everything');
    expect(hierarchyTooltipHtml(hierarchyTooltipContext(meta, 1, css)!, theme, String, 'en-x-hier')).toContain('60.0% of the parent');
  });
});
