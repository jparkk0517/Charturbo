// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { BarLabelLayer, resolveBarLabels, sendBarLabels, widestLabel, type BarStyleState } from '../sdk/chart-bar-style';
import { CHARTURBO_THEMES, Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { PieLabelLayer, pieMeta, sendPie } from '../sdk/chart-pie';
import { HierarchyLabelLayer, sendHierarchy, sendSankey } from '../sdk/chart-hierarchy';
import { FunnelLabelLayer, funnelLabelSpace, funnelMeta } from '../sdk/chart-funnel';

vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    showDataTable(): void {}
    hideDataTable(): void {}
    getDataTable(): null {
      return null;
    }
    exportCSV(): string {
      return '';
    }
    summary(): string {
      return '';
    }
  },
}));

const rich = { big: { fontSize: 20, fontWeight: 700, color: '#ff0000' }, tag: { backgroundColor: '#000000', padding: 4, borderRadius: 2 } };

function barState(texts: string[], withRich = true): BarStyleState {
  return {
    orientation: 'vertical',
    labels: resolveBarLabels({ format: (v) => `{big|${v}}{tag|k}`, ...(withRich ? { rich } : {}) }),
    errMinus: null,
    errPlus: null,
    errorBar: {},
    texts,
  };
}

function recorder() {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  return { calls, record };
}

describe('bar rich labels', () => {
  it('resolves and validates `labels.rich`', () => {
    expect(resolveBarLabels({ rich })?.rich).toBe(rich);
    expect(resolveBarLabels({})?.rich).toBeUndefined();
    expect(() => resolveBarLabels({ rich: { a: { fontSize: 0 } } })).toThrow(/fontSize/);
  });

  it('sends rich text boxes (width and height per label) for fit / collision tests', () => {
    const { calls, record } = recorder();
    const backend = { set_bar_labels: record('set_bar_labels'), set_bar_label_boxes: record('set_bar_label_boxes') } as unknown as WasmCharturboEngineBackend;
    sendBarLabels(backend, barState(['{big|12}{tag|k}', '']), 'sans-serif');
    expect(calls.set_bar_labels).toBeUndefined();
    const [, , widths, heights] = calls.set_bar_label_boxes[0] as [number, number, Float32Array, Float32Array];
    // 2 chars at 20px (0.6 em without canvas) + 1 char at 11px + 8 padding
    expect(widths[0]).toBeCloseTo(24 + 6.6 + 8, 3);
    expect(heights[0]).toBeCloseTo(24, 3);
    expect(Number.isNaN(widths[1])).toBe(true);
    expect(widestLabel(barState(['{big|12}{tag|k}']), 'sans-serif')).toBe(39);
  });

  it('labels without `rich` keep the plain path and text', () => {
    const { calls, record } = recorder();
    const backend = { set_bar_labels: record('set_bar_labels'), set_bar_label_boxes: record('set_bar_label_boxes') } as unknown as WasmCharturboEngineBackend;
    sendBarLabels(backend, barState(['{big|12}'], false), 'sans-serif');
    expect(calls.set_bar_label_boxes).toBeUndefined();
    expect(calls.set_bar_labels.length).toBe(1);
    const root = document.createElement('div');
    const layer = new BarLabelLayer(root, barState(['{big|12}'], false), () => [0, 0, 1, 1]);
    layer.update({ chart_bar_labels: () => Float32Array.of(1, 1, 0, 10, 20, 0) } as unknown as WasmCharturboEngineBackend, CHARTURBO_THEMES.dark);
    const el = root.querySelector<HTMLElement>('.charturbo-sdk-bar-label')!;
    expect(el.textContent).toBe('{big|12}');
    expect(el.querySelector('span')).toBeNull();
  });

  it('places rich DOM runs at the engine anchors', () => {
    const root = document.createElement('div');
    const layer = new BarLabelLayer(root, barState(['{big|12}{tag|k}']), () => [0, 0, 1, 1]);
    layer.update({ chart_bar_labels: () => Float32Array.of(1, 1, 0, 10, 20, 0) } as unknown as WasmCharturboEngineBackend, CHARTURBO_THEMES.dark);
    const el = root.querySelector<HTMLElement>('.charturbo-sdk-bar-label')!;
    expect(el.textContent).toBe('12k');
    const spans = el.querySelectorAll<HTMLElement>('span');
    expect(spans[0].style.fontSize).toBe('20px');
    expect(spans[1].style.display).toBe('inline-block');
    expect(el.style.left).toBe('10px');
  });

  it('a bad `rich` option throws before the current chart is cleared', () => {
    const { calls, record } = recorder();
    const backend = {
      set_bar_chart: record('set_bar_chart'),
      clear_scene_objects: record('clear_scene_objects'),
      sync_and_render: () => {},
      set_rigid_physics: () => {},
      set_graph_visible: () => {},
      set_scene_helpers: () => {},
      clear_selection: () => {},
    } as unknown as WasmCharturboEngineBackend;
    const sdk = Charturbo.fromBackend(backend);
    expect(() => sdk.renderBarChart([{ label: 'a', value: 1 }], { labels: { rich: { x: { padding: [1, 2, 3] as never } } } })).toThrow(/padding/);
    expect(calls.clear_scene_objects).toBeUndefined();
    expect(() => sdk.renderGroupedBarChart({ categories: ['a'], series: [{ name: 's', values: [1] }] }, { labels: { rich: { x: { align: 'top' as never } } } })).toThrow(/align/);
    expect(calls.clear_scene_objects).toBeUndefined();
  });
});

describe('pie rich labels', () => {
  const data = { labels: ['North', 'South'], values: [30, 10] };
  const label = {
    formatter: (c: { name: string; value: number; percent: number; index: number }) => `{n|${c.name}}\n{v|${c.value}} ${c.percent.toFixed(0)}%`,
    rich: { n: { fontSize: 16, fontWeight: 700 }, v: { color: '#00ff00' } },
  };
  const slices = (m: ReturnType<typeof pieMeta>) => {
    m.names = ['North', 'South'];
    m.values = [30, 10];
    m.percents = [75, 25];
    m.colors = [
      [0, 0, 0, 1],
      [1, 1, 1, 1],
    ];
    m.sources = [0, 1];
    m.ring = [0, 0];
    return m;
  };

  it('formats outside and inside labels as rich text (formatter gets name, value, percent, index)', () => {
    const meta = slices(pieMeta(data, { label }));
    const root = document.createElement('div');
    const layer = new PieLabelLayer(root, meta);
    layer.update(
      { chart_pie_labels: () => Float32Array.of(1, 2, 0, 100, 50, 1, 1, 40, 40, 0), chart_pie_layout: () => null } as unknown as WasmCharturboEngineBackend,
      CHARTURBO_THEMES.dark,
      String
    );
    const els = root.querySelectorAll<HTMLElement>('.charturbo-sdk-pie-label');
    expect(els[0].textContent).toBe('North30 75%');
    expect(els[0].querySelectorAll('.charturbo-sdk-rich-line').length).toBe(2);
    expect(els[0].querySelector<HTMLElement>('[data-rich="n"]')!.style.fontSize).toBe('16px');
    expect(els[0].style.transform).toBe('translate(0, -50%)');
    expect(els[1].textContent).toBe('South10 25%');
    expect(els[1].style.transform).toBe('translate(-50%, -50%)');
  });

  it('reserves the rich label box: taller line spacing and wider side room', () => {
    const calls: unknown[][] = [];
    const backend = { set_pie_chart: (...a: unknown[]) => (calls.push(a), 2) } as unknown as WasmCharturboEngineBackend;
    sendPie(backend, data, pieMeta(data, { label }), { label });
    const [linePx, sx, sy] = calls[0].slice(8, 11) as number[];
    // Two lines: 16 * 1.2 + 14 >= 33 px
    expect(linePx).toBeGreaterThanOrEqual(33);
    expect(sy).toBe(linePx + 4);
    // 'North' at 16px bold: 5 * 9.6 = 48 (+ 28 leader room), at least the 64 px minimum
    expect(sx).toBeGreaterThanOrEqual(76);
    const plain: unknown[][] = [];
    sendPie({ set_pie_chart: (...a: unknown[]) => (plain.push(a), 2) } as unknown as WasmCharturboEngineBackend, data, pieMeta(data), {});
    expect(plain[0][8]).toBe(16);
  });

  it('a bad pie `label.rich` throws before the current chart is cleared', () => {
    let cleared = 0;
    const sdk = Charturbo.fromBackend({ clear_scene_objects: () => cleared++ } as unknown as WasmCharturboEngineBackend);
    expect(() => sdk.renderPieChart(data, { label: { rich: { a: { lineHeight: -1 } } } })).toThrow(/lineHeight/);
    expect(cleared).toBe(0);
  });
});

describe('treemap / sunburst / sankey rich labels', () => {
  const tree = { name: 'root', children: [{ name: 'Alpha', value: 3 }] };
  const label = { formatter: (c: { name: string; value: number; depth?: number; column?: number }) => `{b|${c.name}}|${c.value}|${c.depth ?? c.column}`, rich: { b: { fontWeight: 700 } } };
  const labels = (node: number, flags: number) => () => Float64Array.of(1, 1, node, 10, 20, 120, 40, flags);

  function hierarchy(kind: 'treemap' | 'sunburst') {
    const meta = sendHierarchy({ set_treemap_chart: () => {}, set_sunburst_chart: () => {} } as unknown as WasmCharturboEngineBackend, kind, tree, { label });
    meta.values = Float64Array.of(3, 3);
    meta.nodeColors = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1);
    return meta;
  }

  it('treemap cells and sunburst arcs render the formatter as rich text (name, value, depth)', () => {
    for (const kind of ['treemap', 'sunburst'] as const) {
      const root = document.createElement('div');
      const layer = new HierarchyLabelLayer(root, hierarchy(kind), () => {});
      layer.update({ chart_hierarchy_labels: labels(1, 0), chart_hierarchy_layout: () => null } as unknown as WasmCharturboEngineBackend, CHARTURBO_THEMES.dark, String);
      const el = root.querySelector<HTMLElement>('.charturbo-sdk-hierarchy-label')!;
      expect(el.textContent).toBe('Alpha|3|1');
      expect(el.querySelector<HTMLElement>('[data-rich="b"]')!.style.fontWeight).toBe('700');
    }
  });

  it('treemap header strips show the first template line centered in the strip; cells show every line', () => {
    const two = { formatter: (c: { name: string; value: number }) => `{b|${c.name}}\n${c.value}`, rich: { b: { fontWeight: 700 } } };
    const meta = sendHierarchy({ set_treemap_chart: () => {} } as unknown as WasmCharturboEngineBackend, 'treemap', tree, { label: two });
    meta.values = Float64Array.of(3, 3);
    meta.nodeColors = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1);
    const root = document.createElement('div');
    const layer = new HierarchyLabelLayer(root, meta, () => {});
    // flags bit 0 = header strip (height 20)
    const header = () => Float64Array.of(1, 1, 1, 10, 20, 120, 20, 1);
    layer.update({ chart_hierarchy_labels: header, chart_hierarchy_layout: () => null } as unknown as WasmCharturboEngineBackend, CHARTURBO_THEMES.dark, String);
    let el = root.querySelector<HTMLElement>('.charturbo-sdk-hierarchy-label')!;
    expect(el.textContent).toBe('Alpha');
    expect(el.style.lineHeight).toBe('20px');
    expect(el.style.overflow).toBe('hidden');
    // Next layout revision: a regular cell (all lines; the label box clips)
    const cell = () => Float64Array.of(2, 1, 1, 10, 20, 120, 40, 0);
    layer.update({ chart_hierarchy_labels: cell, chart_hierarchy_layout: () => null } as unknown as WasmCharturboEngineBackend, CHARTURBO_THEMES.dark, String);
    el = root.querySelector<HTMLElement>('.charturbo-sdk-hierarchy-label')!;
    expect(el.textContent).toBe('Alpha3');
    expect(el.style.overflow).toBe('hidden');
  });

  it('sankey node labels render the formatter (name, value, column)', () => {
    const meta = sendSankey({ set_sankey_chart: () => {} } as unknown as WasmCharturboEngineBackend, { nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b', value: 5 }] }, { label });
    meta.nodes = Float64Array.of(0, 5, 0, 5, 0, 0, 0, 0, 1, 5, 5, 0, 0, 0, 0, 0);
    const root = document.createElement('div');
    const layer = new HierarchyLabelLayer(root, meta, () => {});
    layer.update({ chart_hierarchy_labels: labels(1, 1), chart_hierarchy_layout: () => null } as unknown as WasmCharturboEngineBackend, CHARTURBO_THEMES.dark, String);
    const el = root.querySelector<HTMLElement>('.charturbo-sdk-hierarchy-label')!;
    expect(el.textContent).toBe('b|5|1');
    expect(el.style.transform).toBe('translate(0, -50%)');
  });

  it('bad `label` options throw before the current chart is cleared', () => {
    let cleared = 0;
    const sdk = Charturbo.fromBackend({ clear_scene_objects: () => cleared++ } as unknown as WasmCharturboEngineBackend);
    expect(() => sdk.renderTreemap(tree, { label: { rich: { a: { color: 'nope' } } } })).toThrow(/color/);
    expect(() => sdk.renderSunburst(tree, { label: { formatter: 3 as never } })).toThrow(/formatter/);
    expect(() => sdk.renderSankey({ nodes: [], links: [] }, { label: { rich: { a: { fontSize: -2 } } } })).toThrow(/fontSize/);
    expect(cleared).toBe(0);
  });
});

describe('funnel rich labels', () => {
  const data = { labels: ['Visit', 'Buy'], values: [100, 25] };
  const label = {
    formatter: (c: { stage: string; value: number; percentOfFirst: number; percentOfPrevious: number; index: number }) =>
      `{s|${c.stage}} #${c.index}\n{p|${c.percentOfFirst}/${c.percentOfPrevious}}`,
    rich: { s: { fontSize: 18 }, p: { color: '#0000ff' } },
  };

  it('stage labels render the formatter as rich text and reserve its box', () => {
    const meta = funnelMeta(data, { label }, String);
    meta.pctFirst = [100, 25];
    meta.pctPrev = [NaN, 25];
    const root = document.createElement('div');
    const layer = new FunnelLabelLayer(root, meta);
    layer.update({ chart_funnel_labels: () => Float64Array.of(1, 1, 1, 10, 10, 0, 0.5) } as unknown as WasmCharturboEngineBackend, CHARTURBO_THEMES.dark);
    const el = root.querySelector<HTMLElement>('.charturbo-sdk-funnel-label')!;
    expect(el.textContent).toBe('Buy #125/25');
    expect(el.querySelector<HTMLElement>('[data-rich="s"]')!.style.fontSize).toBe('18px');
    // 'Visit #0' = 'Visit' at 18px (54) + ' #0' at 11px (19.8), plus 20 px leader room
    expect(funnelLabelSpace(meta)).toBe(94);
    const horizontal = funnelMeta(data, { label, orientation: 'horizontal' }, String);
    horizontal.pctFirst = [100, 25];
    horizontal.pctPrev = [NaN, 25];
    // 18 * 1.2 + 15 (funnel line) = 36.6 -> 37 + 10
    expect(funnelLabelSpace(horizontal)).toBe(47);
  });

  it('a bad funnel `label` throws before the current chart is cleared', () => {
    let cleared = 0;
    const sdk = Charturbo.fromBackend({ clear_scene_objects: () => cleared++ } as unknown as WasmCharturboEngineBackend);
    expect(() => sdk.renderFunnelChart(data, { label: { rich: { a: { borderRadius: -1 } } } })).toThrow(/borderRadius/);
    expect(cleared).toBe(0);
  });
});
