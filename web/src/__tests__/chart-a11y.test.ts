import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChartA11y,
  buildA11yModel,
  buildChartDescription,
  buildChartSummary,
  buildDataTable,
  categoryTotal,
  csvField,
  heatmapToCSV,
  keyboardHelp,
  mergeXAxis,
  f32ToShortest,
  hitIncludes,
  modelValue,
  pointAnnouncement,
  sampleRowIndices,
  seriesStats,
  stepFocus,
  tableToCSV,
  tooltipContext,
  type A11yChartModel,
  type ChartA11yHostState,
} from '../sdk/chart-a11y';
import { CHARTURBO_THEMES, Charturbo, type ChartTooltipContext, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { heatmapMeta } from '../sdk/chart-heatmap';

const lineMeta = (over: Record<string, unknown> = {}) => ({
  kind: 'line',
  names: ['AI-Inference-RPS', 'DB-Latency'],
  colors: [
    [1, 0, 0, 1],
    [0, 0, 1, 1],
  ],
  values: [
    [52.6, 135.9, 247.1, 100],
    [5, NaN, 7],
  ],
  offsets: [0, 4],
  xPrefix: 'T',
  visible: [true, true],
  ...over,
});
const linePresentation = (over: Record<string, unknown> = {}) => ({
  title: 'Infra',
  xAxis: {},
  yAxis: {},
  legend: { show: true, toggle: true, emphasize: true },
  navigable: true,
  formatX: (v: number) => `T+${v.toLocaleString('en-US')}`,
  ...over,
});
const barMeta = () => ({
  kind: 'bar',
  colors: [
    [0.2, 0.4, 0.6, 1],
    [0.1, 0.1, 0.1, 1],
    [1, 1, 1, 1],
  ],
  metadata: [
    { label: 'APAC', category: 'Region', attributes: { value: 12.5 } },
    { label: 'EMEA', category: 'Region', attributes: { value: 40 } },
    { label: 'US', category: 'Region', attributes: { value: 3 } },
  ],
});

const lineModel = (meta = lineMeta(), pres = linePresentation()) => buildA11yModel(meta, pres)!;

describe('chart-a11y model + text', () => {
  it('ErrorBar and Impulse keyboard, announcements and CSV expose scientific values', () => {
    const meta = lineMeta({ names: ['E'], values: [[10, 20]], offsets: [0], visible: [true], sparse: {
      kind: 'errorBar', errors: [{ low: [8, 17], high: [12, 23], direction: 'horizontal' }],
    } });
    const m = lineModel(meta);
    expect(buildChartSummary(m)).toContain('Error bar chart');
    expect(buildDataTable(m).columns).toEqual(['X', 'E', 'E low', 'E high']);
    expect(tableToCSV(buildDataTable(m))).toContain('T+1,20,17,23');
    expect(tooltipContext(m, { series: 0, index: 1 }, [0, 0, 1, 0, 1, 20, 1], () => null))
      .toMatchObject({ chartType: 'errorBar', items: [{ value: 20, errorBar: { low: 17, high: 23, direction: 'horizontal' } }] });
    expect(pointAnnouncement(m, { series: 0, index: 1 })).toContain('17');
    const impulse = lineModel(lineMeta({ ...meta, sparse: { kind: 'impulse', baselines: [-5] } }));
    expect(buildChartSummary(impulse)).toContain('Impulse chart');
    expect(buildDataTable(impulse).columns).toEqual(['X', 'E', 'E baseline']);
    expect(tableToCSV(buildDataTable(impulse))).toContain('T+1,20,-5');
    expect(tooltipContext(impulse, { series: 0, index: 1 }, [0, 0, 1, 0, 1, 20, 1], () => null))
      .toMatchObject({ chartType: 'impulse', items: [{ value: 20, baseline: -5 }] });
  });
  it('standalone band summaries, keyboard tooltip and CSV use the actual edges', () => {
    const m = lineModel(lineMeta({
      standaloneBand: true, names: ['Range'], values: [new Float32Array([0, 0])], offsets: [0], visible: [true],
      bands: [{ lower: [10, -20], upper: [-10, 20] }],
    }));
    expect(buildChartSummary(m)).toContain('Band chart, 1 series, 2 points; Range ranges -20–20');
    const table = buildDataTable(m);
    expect(table.columns).toEqual(['X', 'Range lower', 'Range upper']);
    expect(table.rows[0]).toEqual(['T+0', 10, -10]);
    expect(tableToCSV(table)).toContain('T+1,-20,20');
    expect(tooltipContext(m, { series: 0, index: 1 }, [0, 0, 1, 0, 1, 0, 1], () => null)).toMatchObject({ chartType: 'band', items: [{ band: { lower: -20, upper: 20 } }] });
    expect(pointAnnouncement(m, { series: 0, index: 1 })).toContain('-20');
  });
  it('normalizes line and bar meta, and ignores unknown chart kinds', () => {
    const m = lineModel();
    expect(m.kind).toBe('line');
    expect(m.length).toBe(4);
    expect(m.series.map((s) => s.name)).toEqual(['AI-Inference-RPS', 'DB-Latency']);
    expect(m.xLabel(120)).toBe('T+120');
    expect(m.pointId(1, 2)).toBe(6);

    const b = buildA11yModel(barMeta(), { xAxis: {}, yAxis: { title: 'Revenue' } })!;
    expect(b.kind).toBe('bar');
    expect(b.length).toBe(3);
    expect(b.xLabel(1)).toBe('EMEA');
    expect(b.series[0].name).toBe('Revenue');
    expect(b.itemName(0, 0)).toBe('Region');
    expect(b.pointId(0, 2)).toBe(2);

    // Horizontal bars: the value axis is x (format + title), the category axis y
    const h = buildA11yModel(
      { ...barMeta(), barStyle: { orientation: 'horizontal' } },
      { xAxis: { title: 'Revenue', format: '$,.1f' }, yAxis: { title: 'Region', format: (i: number) => `cat ${i}` } },
      undefined,
      'de-DE'
    )!;
    expect(h.series[0].name).toBe('Revenue');
    expect(h.formatValue(1234.5)).toBe(new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'USD', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(1234.5));

    expect(buildA11yModel({ kind: 'scatter' }, {})).toBeNull();
    expect(buildA11yModel(null, null)).toBeNull();
  });

  it('uses real x arrays when the meta carries them (shared or per series)', () => {
    const shared = lineModel(lineMeta({ xs: [10, 20, 30, 40] }), linePresentation({ formatX: (v: number) => `${v}s` }));
    expect(shared.xValue(2)).toBe(30);
    expect(shared.xLabel(2)).toBe('30s');
    const per = lineModel(lineMeta({ x: [[1, 2, 3, 4], [7, 8, 9]] }), linePresentation({ formatX: undefined }));
    expect(per.xValue(1, 1)).toBe(8);
    expect(per.xLabel(1, 1)).toBe('T+8');
  });

  it('prefers exact engine values for bars and cleans Float32 noise', () => {
    const b = buildA11yModel(barMeta(), {}, (id) => new Float64Array([0, id, Math.fround(0.1) + id, 0, 0, 0]))!;
    expect(b.series[0].values[0]).toBe(0.1);
    expect(f32ToShortest(Math.fround(135.9))).toBe(135.9);
    expect(f32ToShortest(NaN)).toBeNaN();
    const f = lineModel(lineMeta({ values: [new Float32Array([135.9, 1]), new Float32Array([2])] }));
    expect(buildDataTable(f).rows[0][1]).toBe(135.9);
  });

  it('computes series stats over finite values', () => {
    const st = seriesStats([NaN, 3, -1, 8, NaN]);
    expect(st).toMatchObject({ count: 3, min: -1, max: 8, minIndex: 2, maxIndex: 3, first: 3, last: 8 });
    expect(st.mean).toBeCloseTo(10 / 3);
    expect(seriesStats([NaN]).count).toBe(0);
  });

  it('builds the short summary (aria-label) and the long description', () => {
    const m = lineModel();
    expect(buildChartSummary(m)).toBe(
      'Infra. Line chart, 2 series, 7 points; AI-Inference-RPS ranges 52.6–247.1; DB-Latency ranges 5–7.'
    );
    const many = lineModel(
      lineMeta({
        names: Array.from({ length: 7 }, (_, i) => `S${i}`),
        values: Array.from({ length: 7 }, () => [1, 2]),
        offsets: Array.from({ length: 7 }, (_, i) => i * 2),
        visible: Array(7).fill(true),
      }),
      linePresentation({ title: undefined })
    );
    expect(buildChartSummary(many)).toMatch(/^Line chart, 7 series, 14 points; S0 ranges 1–2;.*and 2 more\.$/);

    const desc = buildChartDescription(lineModel(lineMeta({ visible: [true, false] })));
    expect(desc).toContain('X axis from T+0 to T+3.');
    expect(desc).toContain('AI-Inference-RPS: 4 values, minimum 52.6 at T+0, maximum 247.1 at T+2');
    expect(desc).toContain('rising overall');
    expect(desc).toContain('DB-Latency (hidden)');
    expect(desc).toContain('Up and Down arrows to switch series');

    const b = buildA11yModel(barMeta(), { title: 'Revenue by region' })!;
    expect(buildChartSummary(b)).toBe('Revenue by region. Bar chart, 3 categories; values range 3 (US) to 40 (EMEA).');
    const bd = buildChartDescription(b);
    expect(bd).toContain('highest EMEA 40, lowest US 3');
    expect(bd).not.toContain('switch series');

    // Author description leads the long text; y format is reused for values
    const custom = lineModel(lineMeta(), linePresentation({ description: 'Traffic doubled.', yAxis: { format: (v: number) => `${v} rps` } }));
    expect(buildChartDescription(custom).startsWith('Traffic doubled.')).toBe(true);
    expect(buildChartSummary(custom)).toContain('52.6 rps–247.1 rps');
  });
});

describe('chart-a11y extra y axes and axis breaks', () => {
  it('describes extra y axes with their series and every axis break in its axis format', () => {
    const m = lineModel(
      lineMeta({ seriesAxes: [0, 2] }),
      linePresentation({
        yAxis: { format: (v: number) => `${v} ms` },
        extraY: [{ title: 'Latency', format: (v: number) => `${v}%` }],
        axisBreaks: [
          { axis: 'y', breaks: [{ start: 30, end: 480 }, { start: 600, end: 700 }] },
          { axis: '2', title: 'Latency', breaks: [{ start: 1, end: 2 }] },
        ],
      })
    );
    const d = buildChartDescription(m);
    expect(d).toContain('Additional y axis (Latency): DB-Latency.');
    expect(d).toContain('Y axis skips 30 ms–480 ms, 600 ms–700 ms.');
    expect(d).toContain('Y axis 3 (Latency) skips 1%–2%.');
    // Sentences come before the keyboard help
    expect(d.indexOf('skips')).toBeLessThan(d.indexOf(keyboardHelp('line')));
    // No options: no sentences
    expect(buildChartDescription(lineModel())).not.toContain('skips');
    expect(buildChartDescription(lineModel())).not.toContain('Additional');
  });

  it('describes combo extra axes and bar / scatter breaks', () => {
    const combo = buildA11yModel(
      { kind: 'combo', names: ['Bar', 'Rain'], colors: [], types: ['bar', 'line'], axes: [0, 2], values: [new Float32Array([1, 2]), new Float32Array([3, 4])], categories: ['a', 'b'], xs: null, label: (i: number) => `c${i}`, visible: [true, true], barMode: 'grouped' },
      linePresentation({ extraY: [{}] })
    )!;
    expect(buildChartDescription(combo)).toContain('Additional y axis: Rain.');
    const scatter = buildA11yModel(
      { kind: 'scatter', x: [1, 2], y: [3, 4], series: null, names: [], colors: [] },
      linePresentation({ axisBreaks: [{ axis: 'x', breaks: [{ start: 5, end: 90 }] }] })
    )!;
    expect(buildChartDescription(scatter)).toContain('X axis skips T+5–T+90.');
  });
});

describe('chart-a11y keyboard', () => {
  const m: A11yChartModel = lineModel(
    lineMeta({ values: [Array.from({ length: 30 }, (_, i) => i), [1, 2, 3], [9]], names: ['A', 'B', 'C'], offsets: [0, 30, 33], visible: [true, true, true] })
  );

  it('steps through samples and series with clamping', () => {
    expect(stepFocus(m, null, 'ArrowRight')).toEqual({ series: 0, index: 0 });
    expect(stepFocus(m, null, 'End')).toEqual({ series: 0, index: 29 });
    expect(stepFocus(m, { series: 0, index: 5 }, 'ArrowRight')).toEqual({ series: 0, index: 6 });
    expect(stepFocus(m, { series: 0, index: 0 }, 'ArrowLeft')).toEqual({ series: 0, index: 0 });
    expect(stepFocus(m, { series: 0, index: 5 }, 'PageUp')).toEqual({ series: 0, index: 15 });
    expect(stepFocus(m, { series: 0, index: 5 }, 'PageDown')).toEqual({ series: 0, index: 0 });
    expect(stepFocus(m, { series: 0, index: 25 }, 'PageUp')).toEqual({ series: 0, index: 29 });
    expect(stepFocus(m, { series: 0, index: 7 }, 'Home')).toEqual({ series: 0, index: 0 });
    // Up / Down wrap and clamp the index to the target series length
    expect(stepFocus(m, { series: 0, index: 20 }, 'ArrowDown')).toEqual({ series: 1, index: 2 });
    expect(stepFocus(m, { series: 0, index: 20 }, 'ArrowUp')).toEqual({ series: 2, index: 0 });
    expect(stepFocus(m, { series: 0, index: 1 }, 'Enter')).toBeNull();
  });

  it('skips hidden series and handles single-series charts', () => {
    const hidden = { ...m, series: m.series.map((s, i) => ({ ...s, visible: i !== 1 })) };
    expect(stepFocus(hidden, { series: 0, index: 2 }, 'ArrowDown')).toEqual({ series: 2, index: 0 });
    // Focused series got hidden: continue on the first visible one
    expect(stepFocus(hidden, { series: 1, index: 2 }, 'ArrowRight')).toEqual({ series: 0, index: 3 });

    const b = buildA11yModel(barMeta(), {})!;
    expect(stepFocus(b, { series: 0, index: 1 }, 'ArrowDown')).toBeNull();
    expect(stepFocus(b, { series: 0, index: 1 }, 'End')).toEqual({ series: 0, index: 2 });
  });

  it('announces points', () => {
    const l = lineModel();
    expect(pointAnnouncement(l, { series: 0, index: 1 })).toBe('T+1, AI-Inference-RPS 135.9.');
    expect(pointAnnouncement(l, { series: 1, index: 1 })).toBe('T+1, DB-Latency no data.');
    const b = buildA11yModel(barMeta(), {})!;
    expect(pointAnnouncement(b, { series: 0, index: 1 })).toBe('EMEA, 40. 2 of 3.');
  });

  it('builds tooltip context from an engine hit, focused point as primary', () => {
    const l = lineModel();
    const hit = new Float64Array([0, 0, 2, 0, 1, 135.9, 1, 1, 1, NaN, 5]);
    expect(hitIncludes(hit, 1)).toBe(true);
    expect(hitIncludes(hit, 2)).toBe(false);
    expect(hitIncludes(hit, 1, 1)).toBe(true);
    expect(hitIncludes(new Float64Array([0, 0, 1, 0, 1, 135.9, 1]), 1, 1)).toBe(false); // other series only
    const ctx = tooltipContext(l, { series: 1, index: 1 }, hit, (id) => ({ id }) as never);
    expect(ctx.chartType).toBe('line');
    expect(ctx.xLabel).toBe('T+1');
    expect(ctx.items.map((i) => i.seriesName)).toEqual(['AI-Inference-RPS', 'DB-Latency']);
    expect(ctx.items[0].color).toBe('rgb(255, 0, 0)');
    expect(ctx.details?.id).toBe(5);
  });

  it('drives the engine hover from keydown via project_node_to_ndc + chart_hover_at_ndc', () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const canvas = {
      addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
      removeEventListener: (t: string) => delete listeners[t],
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 200, height: 100 }),
    } as unknown as HTMLCanvasElement;
    const calls: string[] = [];
    let renders = 0;
    const tooltips: [number, number, string | undefined][] = [];
    const state: ChartA11yHostState = {
      canvas,
      overlay: null,
      meta: lineMeta(),
      presentation: linePresentation(),
      theme: CHARTURBO_THEMES.dark,
      backend: {
        project_node_to_ndc: (id) => {
          calls.push(`project ${id}`);
          return new Float32Array(id === 3 ? [1.5, 0, 0] : [0.5, -0.5, 0.3]);
        },
        chart_hover_at_ndc: (x, y) => {
          calls.push(`hover ${x} ${y}`);
          return new Float64Array([0, 0, 1, 0, 1, 135.9, 1]);
        },
        chart_clear_hover: () => calls.push('clear'),
      },
      details: () => null,
      render: () => renders++,
    };
    const a11y = new ChartA11y(() => state);
    a11y.tooltip = (ctx, x, y) => tooltips.push([x, y, ctx?.xLabel]);
    a11y.refresh();
    const key = (k: string) => {
      let prevented = false;
      listeners.keydown({ key: k, preventDefault: () => (prevented = true) });
      return prevented;
    };
    expect(key('ArrowRight')).toBe(true); // lands on T+0 (id 0) — hit has index 1, so not accepted
    expect(calls).toEqual(['project 0', 'hover 0.5 -0.5', 'clear']);
    calls.length = 0;
    expect(key('ArrowRight')).toBe(true); // T+1 matches the hit
    expect(calls).toEqual(['project 1', 'hover 0.5 -0.5']);
    expect(tooltips.at(-1)).toEqual([250, 125, 'T+1']);
    calls.length = 0;
    key('End'); // id 3 projects off-canvas: no hit-test, hover cleared
    expect(calls).toEqual(['project 3', 'clear']);
    expect(key('Tab')).toBe(false);
    calls.length = 0;
    key('ArrowLeft');
    expect(key('Escape')).toBe(true);
    expect(calls.at(-1)).toBe('clear');
    expect(renders).toBeGreaterThan(0);
    // Chart left while a keyboard point is shown: the tooltip is hidden
    key('ArrowRight');
    key('ArrowRight');
    expect(tooltips.at(-1)?.[2]).toBe('T+1');
    state.meta = null;
    a11y.refresh();
    expect(tooltips.at(-1)).toEqual([0, 0, undefined]);
    a11y.dispose();
    expect(listeners.keydown).toBeUndefined();
  });
});

describe('chart-a11y data table + CSV', () => {
  it('samples rows evenly including first and last', () => {
    expect(sampleRowIndices(5, 10)).toEqual([0, 1, 2, 3, 4]);
    expect(sampleRowIndices(10, 4)).toEqual([0, 3, 6, 9]);
    expect(sampleRowIndices(5000, 1000)).toHaveLength(1000);
    expect(sampleRowIndices(5000, 1000).at(-1)).toBe(4999);
    expect(sampleRowIndices(7, 1)).toEqual([0]);
    expect(sampleRowIndices(0, 1000)).toEqual([]);
  });

  it('builds line / bar tables', () => {
    const t = buildDataTable(lineModel());
    expect(t.columns).toEqual(['X', 'AI-Inference-RPS', 'DB-Latency']);
    expect(t.rows[0]).toEqual(['T+0', 52.6, 5]);
    expect(t.rows[1]).toEqual(['T+1', 135.9, null]);
    expect(t.rows[3]).toEqual(['T+3', 100, null]);
    expect(t.sampled).toBe(false);
    const s = buildDataTable(lineModel(), 2);
    expect(s.rows.map((r) => r[0])).toEqual(['T+0', 'T+3']);
    expect(s).toMatchObject({ totalRows: 4, sampled: true });

    const b = buildDataTable(buildA11yModel(barMeta(), { xAxis: { title: 'Region' }, yAxis: { title: 'Revenue' } })!);
    expect(b.columns).toEqual(['Region', 'Revenue']);
    expect(b.rows).toEqual([['APAC', 12.5], ['EMEA', 40], ['US', 3]]);
  });

  it('escapes CSV fields (RFC 4180) and guards formula injection', () => {
    expect(csvField(null)).toBe('');
    expect(csvField(-1.5)).toBe('-1.5');
    expect(csvField(NaN)).toBe('');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('-5')).toBe('-5');
    expect(tableToCSV({ columns: ['X', 'A'], rows: [['T+0', 1], ['T+1', null]] })).toBe('X,A\r\nT+0,1\r\nT+1,');
  });

  it('is exposed on the SDK (works without a DOM)', () => {
    const noop = () => {};
    const backend = {
      set_line_chart: () => 0,
      set_bar_chart: () => 0,
      clear_scene_objects: noop,
      clear_selection: noop,
      set_rigid_physics: noop,
      set_graph_visible: noop,
      set_scene_helpers: noop,
      load_raw_dataset: noop,
    } as unknown as WasmCharturboEngineBackend;
    const sdk = Charturbo.fromBackend(backend);
    expect(sdk.getChartDataTable()).toBeNull();
    expect(sdk.exportChartCSV()).toBe('');
    sdk.renderLineChart(
      [
        { name: 'A', values: new Float32Array([1.1, 2.2]) },
        { name: 'B, total', values: [3, NaN] },
      ],
      { title: 'T', axes: { x: { title: 'Step' } } }
    );
    expect(sdk.getChartSummary()).toBe('T. Line chart, 2 series, 4 points; A ranges 1.1–2.2; B, total ranges 3–3.');
    expect(sdk.getChartDataTable()?.columns).toEqual(['Step', 'A', 'B, total']);
    expect(sdk.exportChartCSV()).toBe('Step,A,"B, total"\r\nT+0,1.1,3\r\nT+1,2.2,');
    expect(sdk.showDataTable()).toBeNull(); // no document in node
    sdk.renderBarChart([{ label: 'Q1', value: 4 }, { label: 'Q2', value: 9 }], { description: 'Quarterly' });
    expect(sdk.exportChartCSV()).toBe('Category,Value\r\nQ1,4\r\nQ2,9');
    sdk.loadDataset({ positions: new Float32Array(3) } as never);
    expect(sdk.getChartDataTable()).toBeNull();
  });
});

const multiMeta = (over: Record<string, unknown> = {}) => ({
  kind: 'bar-multi',
  mode: 'grouped',
  names: ['North', 'South'],
  colors: [
    [1, 0, 0, 1],
    [0, 1, 0, 1],
  ],
  categories: ['Q1', 'Q2', 'Q3'],
  // [series * 3 + category]
  values: new Float32Array([10, 20, 30, 1, NaN, 3]),
  visible: [true, true],
  viewMode: '2d',
  ...over,
});
const scatterMeta = (over: Record<string, unknown> = {}) => ({
  kind: 'scatter',
  names: ['A', 'B'],
  colors: [
    [1, 0, 0, 1],
    [0, 0, 1, 1],
  ],
  visible: [true, true],
  // ids 0..5; series A = 0, 2, 4, 5; B = 1, 3
  x: new Float32Array([5, 1, 2, 4, NaN, 0.5]),
  y: new Float32Array([50, 10, 20, 40, 7, 5]),
  series: new Uint16Array([0, 1, 0, 1, 0, 0]),
  pointColors: null,
  ...over,
});
const scatterPres = { xAxis: {}, yAxis: {}, formatX: (v: number) => `${v}u` };

describe('chart-a11y line charts with per-series x', () => {
  const xs = [new Float64Array([0, 10, 20, 30]), new Float64Array([5, 10, 25])];
  const m = lineModel(
    lineMeta({ xs, values: [[1, 2, 3, 4], [7, 8, 9]] }),
    linePresentation({ formatX: (v: number) => `${v}s` })
  );

  it('merges the x axis (sorted union) and places values by exact x', () => {
    expect(Array.from(mergeXAxis([...xs, [NaN, 10]]))).toEqual([0, 5, 10, 20, 25, 30]);
    const t = buildDataTable(m);
    expect(t.rows).toEqual([
      ['0s', 1, null],
      ['5s', null, 7],
      ['10s', 2, 8],
      ['20s', 3, null],
      ['25s', null, 9],
      ['30s', 4, null],
    ]);
    expect(t).toMatchObject({ totalRows: 6, sampled: false });
    const s = buildDataTable(m, 3);
    expect(s.rows.map((r) => r[0])).toEqual(['0s', '20s', '30s']); // union indices 0, 3, 5
    expect(s).toMatchObject({ totalRows: 6, sampled: true });
    // Same x in every series keeps the index-aligned rows (duplicate x samples survive)
    const same = lineModel(lineMeta({ xs: [new Float64Array([1, 1, 2]), new Float64Array([1, 1, 2])], values: [[1, 2, 3], [4, 5, 6]] }));
    expect(buildDataTable(same).rows).toHaveLength(3);
    // NaN x falls back to a map lookup too
    const gap = lineModel(lineMeta({ xs: [new Float64Array([1, NaN, 3]), new Float64Array([2])], values: [[1, 2, 3], [9]] }));
    expect(buildDataTable(gap).rows).toEqual([['T+1', 1, null], ['T+2', null, 9], ['T+3', 3, null]]);
    // Unsorted x falls back to a map lookup
    const unsorted = lineModel(lineMeta({ xs: [new Float64Array([3, 1]), new Float64Array([1])], values: [[30, 10], [100]] }));
    expect(buildDataTable(unsorted).rows).toEqual([['T+1', 10, 100], ['T+3', 30, null]]);
  });

  it('describes the global x range and per-series x of min / max', () => {
    const desc = buildChartDescription(m);
    expect(desc).toContain('X axis from 0s to 30s.');
    expect(desc).toContain('DB-Latency: 3 values, minimum 7 at 5s, maximum 9 at 25s');
  });

  it('keyboard tooltip carries the sample x like the pointer path', () => {
    const hit = new Float64Array([0, 0, 1, 1, 2, 9, 6]);
    const ctx = tooltipContext(m, { series: 1, index: 2 }, hit, () => null);
    expect(ctx.x).toBe(25);
    expect(ctx.xLabel).toBe('25s');
    expect('x' in tooltipContext(lineModel(), { series: 0, index: 1 }, hit, () => null)).toBe(false);
  });
});

describe('chart-a11y multi-series bars', () => {
  it('builds summary, description, keyboard steps and announcements', () => {
    const m = buildA11yModel(multiMeta(), { title: 'Sales', xAxis: {}, yAxis: {} })!;
    expect(m.kind).toBe('bar-multi');
    expect(m.length).toBe(3);
    expect(m.series.map((s) => Array.from(s.values))).toEqual([[10, 20, 30], [1, NaN, 3]]);
    expect(m.pointId(1, 2)).toBe(5);
    expect(buildChartSummary(m)).toBe('Sales. Grouped bar chart, 3 categories, 2 series; North ranges 10–30; South ranges 1–3.');
    const d = buildChartDescription(m);
    expect(d).toContain('3 categories, grouped.');
    expect(d).toContain('North: highest Q3 30, lowest Q1 10, average 20.');
    expect(d).toContain(keyboardHelp('bar-multi'));
    expect(d).toContain('move between categories');

    expect(stepFocus(m, { series: 0, index: 1 }, 'ArrowRight')).toEqual({ series: 0, index: 2 });
    expect(stepFocus(m, { series: 0, index: 1 }, 'ArrowDown')).toEqual({ series: 1, index: 1 });
    expect(pointAnnouncement(m, { series: 1, index: 1 })).toBe('Q2, South no data. 2 of 3.');
    const hidden = buildA11yModel(multiMeta({ visible: [true, false] }), {})!;
    expect(stepFocus(hidden, { series: 0, index: 1 }, 'ArrowDown')).toBeNull();

    const stacked = buildA11yModel(multiMeta({ mode: 'stacked' }), {})!;
    expect(buildChartSummary(stacked)).toMatch(/^Stacked bar chart/);
    expect(categoryTotal(stacked, 1)).toBe(20);
    expect(pointAnnouncement(stacked, { series: 0, index: 2 })).toBe('Q3, North 30. Total 33. 3 of 3.');
  });

  it('tables: rows = categories, columns = series (+ Total of visible series when stacked)', () => {
    const t = buildDataTable(buildA11yModel(multiMeta(), { xAxis: { title: 'Quarter' } })!);
    expect(t.columns).toEqual(['Quarter', 'North', 'South']);
    expect(t.rows).toEqual([['Q1', 10, 1], ['Q2', 20, null], ['Q3', 30, 3]]);
    const s = buildDataTable(buildA11yModel(multiMeta({ mode: 'stacked', visible: [true, false] }), {})!);
    expect(s.columns).toEqual(['Category', 'North', 'South', 'Total']);
    expect(s.rows[2]).toEqual(['Q3', 30, 3, 30]);
    expect(tableToCSV(s).split('\r\n')[1]).toBe('Q1,10,1,10');
  });

  it('tooltip context: stacked total, percent shares, chartType bar', () => {
    const stacked = buildA11yModel(multiMeta({ mode: 'stacked' }), {})!;
    const hit = new Float64Array([0, 0, 2, 0, 2, 30, 2, 1, 2, 3, 5]);
    expect(hitIncludes(hit, 2, 1)).toBe(true);
    const ctx = tooltipContext(stacked, { series: 1, index: 2 }, hit, () => null);
    expect(ctx).toMatchObject({ chartType: 'bar', index: 2, xLabel: 'Q3', total: 33 });
    expect(ctx.items.map((i) => [i.seriesName, i.color])).toEqual([['North', 'rgb(255, 0, 0)'], ['South', 'rgb(0, 255, 0)']]);
    const pct = tooltipContext(buildA11yModel(multiMeta({ mode: 'percent' }), {})!, { series: 0, index: 2 }, hit, () => null);
    expect(pct.items[0].percent).toBeCloseTo(90.909, 2);
    expect(pct.total).toBeUndefined();
  });
});

describe('chart-a11y scatter', () => {
  it('summarizes points, series and x / y ranges (finite points only)', () => {
    const m = buildA11yModel(scatterMeta(), { ...scatterPres, title: 'Cloud' })!;
    expect(m.kind).toBe('scatter');
    expect(m.series.map((s) => s.count)).toEqual([3, 2]);
    expect(buildChartSummary(m)).toBe(
      'Cloud. Scatter chart, 2 series, 5 points; x ranges 0.5u–5u, y ranges 5–50; A 3 points; B 2 points.'
    );
    const d = buildChartDescription(m);
    expect(d).toContain('X axis from 0.5u to 5u.');
    expect(d).toContain('Y axis from 5 to 50.');
    expect(d).toContain('A: 3 points.');
    expect(d).toContain('in x order');
    expect(buildA11yModel({ kind: 'scatter', x: [1], y: [2], names: [] }, {})!.series).toHaveLength(1);
  });

  it('steps through points of each visible series in x order', () => {
    const m = buildA11yModel(scatterMeta(), scatterPres)!;
    // Series A sorted by x: id 5 (0.5), id 2 (2), id 0 (5); NaN id 4 is skipped
    expect([0, 1, 2].map((i) => m.pointId(0, i))).toEqual([5, 2, 0]);
    expect([0, 1].map((i) => m.pointId(1, i))).toEqual([1, 3]);
    expect(stepFocus(m, null, 'End')).toEqual({ series: 0, index: 2 });
    expect(stepFocus(m, { series: 0, index: 2 }, 'ArrowDown')).toEqual({ series: 1, index: 1 });
    expect(modelValue(m, 0, 1)).toBe(20);
    expect(pointAnnouncement(m, { series: 0, index: 1 })).toBe('A: x 2u, y 20. 2 of 3.');
    const named = buildA11yModel(scatterMeta(), { ...scatterPres, xAxis: { title: 'Age' }, yAxis: { title: 'Income' } })!;
    expect(pointAnnouncement(named, { series: 1, index: 0 })).toBe('B: Age 1u, Income 10. 1 of 2.');
    const hidden = buildA11yModel(scatterMeta({ visible: [false, true] }), scatterPres)!;
    expect(stepFocus(hidden, null, 'ArrowRight')).toEqual({ series: 1, index: 0 });
  });

  it('table rows are points in data order with raw x / y and the series name', () => {
    const t = buildDataTable(buildA11yModel(scatterMeta(), scatterPres)!);
    expect(t.columns).toEqual(['X', 'Y', 'Series']);
    expect(t.rows[0]).toEqual([5, 50, 'A']);
    expect(t.rows[4]).toEqual([null, 7, 'A']);
    expect(t.totalRows).toBe(6);
    expect(tableToCSV(buildDataTable(buildA11yModel(scatterMeta(), scatterPres)!, 2))).toBe('X,Y,Series\r\n5,50,A\r\n0.5,5,A');
  });

  it('tooltip context is built from the focused point (point, per-point color)', () => {
    const colors = new Float32Array(24).fill(1);
    colors.set([0, 0, 1, 1], 2 * 4);
    const m = buildA11yModel(scatterMeta({ pointColors: colors }), scatterPres)!;
    const ctx = tooltipContext(m, { series: 0, index: 1 }, new Float64Array([0, 0, 1, 0, 2, 20, 2]), (id) => ({ id }) as never);
    expect(ctx).toMatchObject({ chartType: 'scatter', index: 2, xLabel: '2u', point: { x: 2, y: 20 } });
    expect(ctx.items).toEqual([{ seriesName: 'A', value: 20, color: 'rgb(0, 0, 255)', nodeId: 2 }]);
    expect(ctx.details?.id).toBe(2);
  });

  it('keydown hovers the x-sorted point id through the engine', () => {
    const listeners: Record<string, (e: unknown) => void> = {};
    const canvas = {
      addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
      removeEventListener: (t: string) => delete listeners[t],
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    } as unknown as HTMLCanvasElement;
    const projected: number[] = [];
    const tooltips: (ChartTooltipContextLike | null)[] = [];
    // id 6 duplicates id 2 (x 2, y 20); series A x order: 5, 2, 6, 0
    let hoverId = 5;
    const state: ChartA11yHostState = {
      canvas,
      overlay: null,
      meta: scatterMeta({
        x: new Float32Array([5, 1, 2, 4, NaN, 0.5, 2]),
        y: new Float32Array([50, 10, 20, 40, 7, 5, 20]),
        series: new Uint16Array([0, 1, 0, 1, 0, 0, 0]),
      }),
      presentation: scatterPres,
      theme: CHARTURBO_THEMES.dark,
      backend: {
        project_node_to_ndc: (id) => {
          projected.push(id);
          return new Float32Array([0, 0, 0]);
        },
        chart_hover_at_ndc: () => new Float64Array([0, 0, 1, 0, hoverId, 1, hoverId]),
        chart_clear_hover: () => tooltips.push(null),
      },
      details: () => null,
      render: () => {},
    };
    const a11y = new ChartA11y(() => state);
    a11y.tooltip = (ctx) => tooltips.push(ctx);
    a11y.refresh();
    const right = () => listeners.keydown({ key: 'ArrowRight', preventDefault: () => {} });
    right();
    expect(tooltips.at(-1)).toMatchObject({ chartType: 'scatter', index: 5 });
    hoverId = 6; // engine picks the exact duplicate: still the focused point
    right();
    expect(projected).toEqual([5, 2]);
    expect(tooltips.at(-1)).toMatchObject({ chartType: 'scatter', index: 2, point: { x: 2, y: 20 } });
    hoverId = 0; // another point (focused one outside the zoom window): hover cleared
    right();
    expect(tooltips.at(-1)).toBeNull();
    a11y.dispose();
  });
});

type ChartTooltipContextLike = ReturnType<typeof tooltipContext>;

describe('chart-a11y SDK integration (bar-multi / scatter / view flags)', () => {
  const noop = () => {};
  const backend = () =>
    ({
      set_line_chart: () => 0,
      set_bar_chart_multi: () => 0,
      set_scatter_chart: () => 0,
      chart_series_count: () => 2,
      set_chart_series_visible: noop,
      clear_scene_objects: noop,
      clear_selection: noop,
      set_rigid_physics: noop,
      set_graph_visible: noop,
      set_scene_helpers: noop,
      load_raw_dataset: noop,
    }) as unknown as WasmCharturboEngineBackend;
  const flat = (sdk: Charturbo) => (sdk as unknown as { flatCameraView: boolean }).flatCameraView;
  const data = { categories: ['Q1', 'Q2'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }] };

  it('exposes bar-multi and scatter summaries / CSV', () => {
    const sdk = Charturbo.fromBackend(backend());
    sdk.renderGroupedBarChart(data, { mode: 'stacked' });
    expect(sdk.getChartSummary()).toBe('Stacked bar chart, 2 categories, 2 series; A ranges 1–2; B ranges 3–4.');
    expect(sdk.exportChartCSV()).toBe('Category,A,B,Total\r\nQ1,1,3,4\r\nQ2,2,4,6');
    sdk.renderScatterChart({ x: [1, 2], y: [3, 4], clusters: [0, 1] }, { seriesNames: ['P', 'Q'] });
    expect(sdk.getChartSummary()).toMatch(/^Scatter chart, 2 series, 2 points; x ranges 1–2, y ranges 3–4/);
    expect(sdk.exportChartCSV()).toBe('X,Y,Series\r\n1,3,P\r\n2,4,Q');
  });

  it('3D bar-multi ignores setSeriesVisible (engine keeps every bar); 2D toggles', () => {
    const sdk = Charturbo.fromBackend(backend());
    sdk.renderGroupedBarChart(data, { viewMode: '3d' });
    sdk.setSeriesVisible(0, false);
    expect(sdk.isSeriesVisible(0)).toBe(true);
    sdk.renderGroupedBarChart(data);
    sdk.setSeriesVisible(1, false);
    expect(sdk.isSeriesVisible(1)).toBe(false);
  });

  it('flat camera flag follows every chart builder and resets on exit', () => {
    const sdk = Charturbo.fromBackend(backend());
    sdk.renderLineChart([{ name: 'A', values: [1, 2] }]);
    expect(flat(sdk)).toBe(true);
    sdk.renderLineChart([{ name: 'A', values: [1, 2] }], { viewMode: '2.5d' });
    expect(flat(sdk)).toBe(false);
    sdk.renderGroupedBarChart(data);
    expect(flat(sdk)).toBe(true);
    sdk.renderGroupedBarChart(data, { viewMode: '3d' });
    expect(flat(sdk)).toBe(false);
    sdk.renderScatterChart({ x: [1], y: [2] });
    expect(flat(sdk)).toBe(true);
    sdk.loadDataset({ positions: new Float32Array(3) } as never);
    expect(flat(sdk)).toBe(false);
  });
});

describe('chart-a11y area charts', () => {
  const stacked = () =>
    lineModel(
      lineMeta({
        area: 'stacked',
        values: [
          [10, 20, 30],
          [1, 2, 3],
        ],
        offsets: [0, 3],
      })
    );

  it('names the area mode and adds stacked totals to text and table', () => {
    const m = stacked();
    expect(m.areaMode).toBe('stacked');
    expect(buildChartSummary(m)).toContain('Stacked area chart');
    expect(pointAnnouncement(m, { series: 1, index: 2 })).toContain('Total 33');
    const table = buildDataTable(m);
    expect(table.columns.at(-1)).toBe('Total');
    expect(table.rows[1].at(-1)).toBe(22);
  });

  it('plain line charts keep their wording and table', () => {
    const m = lineModel();
    expect(buildChartSummary(m)).toContain('Line chart');
    expect(buildDataTable(m).columns).not.toContain('Total');
  });
});

/** Fake canvas recording keydown listeners; `key()` returns whether the key was handled. */
function keyCanvas() {
  const listeners: Record<string, (e: unknown) => void> = {};
  const canvas = {
    addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
    removeEventListener: (t: string) => delete listeners[t],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
  } as unknown as HTMLCanvasElement;
  const key = (k: string) => {
    let prevented = false;
    listeners.keydown({ key: k, preventDefault: () => (prevented = true) });
    return prevented;
  };
  return { canvas, key };
}

describe('chart-a11y candlestick charts', () => {
  const candleMeta = (over: Record<string, unknown> = {}) => ({
    kind: 'candle',
    colors: [
      [0, 0, 1, 1],
      [1, 0, 0, 1],
    ],
    t: null,
    open: new Float32Array([100, 101, 102]),
    high: new Float32Array([105, 106, 107]),
    low: new Float32Array([95, 96, 97]),
    close: new Float32Array([102, 99, 104]),
    volume: new Float32Array([1000, 1001, 1002]),
    ...over,
  });
  const pres = { xAxis: {}, yAxis: {}, formatX: (v: number) => `Day ${v}` };

  it('OHLC summary, keyboard tooltip and CSV preserve financial identity and data', () => {
    const m = buildA11yModel(candleMeta({ mode: 'ohlc' }), pres)!;
    expect(buildChartSummary(m)).toContain('OHLC chart, 3 bars');
    expect(buildChartDescription(m)).toContain('move between bars');
    expect(stepFocus(m, null, 'ArrowRight')).toEqual({ series: 3, index: 0 });
    const ctx = tooltipContext(m, { series: 3, index: 1 }, new Float64Array([0, 0, 1, 0, 1, 99, 1]), () => null);
    expect(ctx).toMatchObject({ chartType: 'ohlc', ohlc: { open: 101, high: 106, low: 96, close: 99, volume: 1001 } });
    expect(tableToCSV(buildDataTable(m, 2))).toBe('X,Open,High,Low,Close,Volume\r\nDay 0,100,105,95,102,1000\r\nDay 2,102,107,97,104,1002');
  });

  it('one focus stop per candle; announcement reads O / H / L / C / V', () => {
    const m = buildA11yModel(candleMeta(), pres)!;
    expect(m.kind).toBe('candle');
    const first = stepFocus(m, null, 'ArrowRight')!;
    expect(first).toEqual({ series: 3, index: 0 });
    // Up / Down: nothing to switch to
    expect(stepFocus(m, first, 'ArrowDown')).toBeNull();
    expect(stepFocus(m, first, 'ArrowUp')).toBeNull();
    expect(stepFocus(m, first, 'End')).toEqual({ series: 3, index: 2 });
    expect(pointAnnouncement(m, { series: 3, index: 1 })).toBe(
      'Day 1, open 101, high 106, low 96, close 99, volume 1,001. 2 of 3.'
    );
    const noVol = buildA11yModel(candleMeta({ volume: null }), pres)!;
    expect(pointAnnouncement(noVol, { series: 3, index: 0 })).toBe('Day 0, open 100, high 105, low 95, close 102. 1 of 3.');
    expect(keyboardHelp('candle')).not.toContain('Up and Down');
    // Price format applies to O / H / L / C only, never to volume
    const priced = buildA11yModel(candleMeta(), { ...pres, yAxis: { format: (v: number) => `$${v}` } })!;
    expect(pointAnnouncement(priced, { series: 3, index: 0 })).toBe('Day 0, open $100, high $105, low $95, close $102, volume 1,000. 1 of 3.');
    expect(buildChartSummary(priced)).toContain('Close ranges $99–$104; Volume ranges 1,000–1,002');
    expect(buildChartDescription(priced)).toContain('Volume: 3 values, minimum 1,000');
    expect(buildChartDescription(m)).toContain('Left and Right arrows to move between candles');
    // Table / CSV keep the OHLCV columns
    expect(buildDataTable(m).columns).toEqual(['X', 'Open', 'High', 'Low', 'Close', 'Volume']);
    expect(tableToCSV(buildDataTable(m, 2))).toBe('X,Open,High,Low,Close,Volume\r\nDay 0,100,105,95,102,1000\r\nDay 2,102,107,97,104,1002');
  });

  it('fallback tooltip context is an OHLC candlestick context', () => {
    const m = buildA11yModel(candleMeta(), pres)!;
    const ctx = tooltipContext(m, { series: 3, index: 1 }, new Float64Array([0, 0, 1, 0, 1, 99, 1]), () => null);
    expect(ctx).toMatchObject({
      chartType: 'candlestick',
      index: 1,
      x: 1,
      xLabel: 'Day 1',
      ohlc: { open: 101, high: 106, low: 96, close: 99, volume: 1001, x: 1, xEnd: 1, count: 1 },
    });
    // Falling candle: down color
    expect(ctx.items).toEqual([{ seriesName: 'Close', value: 99, color: 'rgb(255, 0, 0)', nodeId: 1 }]);
  });

  it('keyboard hover accepts the engine hit (series 0) and shows the host OHLC tooltip', () => {
    const { canvas, key } = keyCanvas();
    const calls: string[] = [];
    const tooltips: (ChartTooltipContext | null)[] = [];
    const hostTips: number[] = [];
    let hoverIndex = 0;
    const state: ChartA11yHostState = {
      canvas,
      overlay: null,
      meta: candleMeta(),
      presentation: pres,
      theme: CHARTURBO_THEMES.dark,
      backend: {
        project_node_to_ndc: (id) => {
          calls.push(`project ${id}`);
          return new Float32Array([0.1, 0.2, 0]);
        },
        // Engine: candles are always series 0, value = close
        chart_hover_at_ndc: () => new Float64Array([0, 0, 1, 0, hoverIndex, 102, hoverIndex]),
        chart_clear_hover: () => calls.push('clear'),
      },
      details: () => null,
      render: () => {},
      chartTooltip: (hit) => {
        hostTips.push(hit[4]);
        return { chartType: 'candlestick', index: hit[4], xLabel: 'bucket', items: [], details: null };
      },
    };
    const a11y = new ChartA11y(() => state);
    a11y.tooltip = (ctx) => tooltips.push(ctx);
    a11y.refresh();
    expect(key('ArrowRight')).toBe(true);
    expect(calls).toEqual(['project 0']);
    expect(hostTips).toEqual([0]);
    expect(tooltips.at(-1)).toMatchObject({ chartType: 'candlestick', index: 0, xLabel: 'bucket' });
    // Down is not a series switch for candles: focus and hover stay
    expect(key('ArrowDown')).toBe(false);
    expect(calls).toEqual(['project 0']);
    hoverIndex = 1;
    calls.length = 0;
    key('ArrowRight');
    expect(calls).toEqual(['project 1']);
    expect(tooltips.at(-1)).toMatchObject({ index: 1 });
    // Without the host hook the model builds the OHLC context
    delete state.chartTooltip;
    hoverIndex = 2;
    key('ArrowRight');
    expect(tooltips.at(-1)).toMatchObject({ chartType: 'candlestick', index: 2, ohlc: { close: 104 } });
    a11y.dispose();
  });
});

describe('chart-a11y heatmaps', () => {
  /** 4 x 3 grid, value = row * 10 + col, cell (1, 2) empty. */
  const grid = () => {
    const v = Array.from({ length: 12 }, (_, i) => Math.floor(i / 4) * 10 + (i % 4));
    v[6] = NaN;
    return v;
  };
  const LABELS = { xLabels: ['Mon', 'Tue', 'Wed', 'Thu'], yLabels: ['A', 'B', 'C'] };
  const pres = (over: Record<string, unknown> = {}) => ({ xAxis: {}, yAxis: { format: (v: number) => `row${v}` }, ...over });
  const model = (opts: Record<string, unknown> = {}, p = pres()) =>
    buildA11yModel(heatmapMeta({ cols: 4, rows: 3, values: grid(), ...LABELS }, { valueLabel: 'Load', ...opts }), p)!;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('summary / description use title, labels, value range and empty cells', () => {
    const m = model({}, pres({ title: 'Weekly load' }));
    expect(m.kind).toBe('heatmap');
    expect(buildChartSummary(m)).toBe('Weekly load. Heatmap, 3 rows × 4 columns, values 0–23 (1 empty cell).');
    const desc = buildChartDescription(model({}, pres({ description: 'Server load per weekday' })));
    expect(desc).toMatch(/^Server load per weekday Rows: 3 rows from A to C\. Columns: 4 columns from Mon to Thu\./);
    expect(desc).toContain('Load: minimum 0 at A, Mon, maximum 23 at C, Thu. 1 empty cell.');
    expect(desc).toContain('Up and Down arrows to move between rows');
    const empty = buildA11yModel(heatmapMeta({ cols: 2, rows: 1, values: [NaN, NaN] }), pres())!;
    expect(buildChartSummary(empty)).toBe('Heatmap, 1 row × 2 columns, no values (2 empty cells).');
  });

  it('arrows move by cell; Up / Down follow the drawn row order; announcement reads row, column: value', () => {
    const m = model();
    let f = stepFocus(m, null, 'ArrowRight')!;
    expect(f).toEqual({ series: 0, index: 0 });
    expect(pointAnnouncement(m, f)).toBe('A, Mon: 0.');
    f = stepFocus(m, f, 'ArrowDown')!; // top-down: row 1 below row 0
    f = stepFocus(m, f, 'ArrowRight')!;
    f = stepFocus(m, f, 'ArrowRight')!;
    expect(f).toEqual({ series: 1, index: 2 });
    expect(pointAnnouncement(m, f)).toBe('B, Wed: empty.');
    expect(stepFocus(m, f, 'End')).toEqual({ series: 1, index: 3 });
    expect(stepFocus(m, f, 'Home')).toEqual({ series: 1, index: 0 });
    expect(stepFocus(m, f, 'PageUp')).toEqual({ series: 1, index: 3 });
    expect(stepFocus(m, { series: 0, index: 1 }, 'ArrowUp')).toEqual({ series: 0, index: 1 });
    expect(stepFocus(m, { series: 2, index: 1 }, 'ArrowDown')).toEqual({ series: 2, index: 1 });
    expect(stepFocus(m, f, 'Tab')).toBeNull();
    const bottomUp = model({ rowOrder: 'bottom-up' });
    expect(stepFocus(bottomUp, { series: 0, index: 0 }, 'ArrowUp')).toEqual({ series: 1, index: 0 });
    // Numeric axes: cell centers with the author's tick format
    const num = buildA11yModel(
      heatmapMeta({ cols: 2, rows: 2, values: [1, 2, 3, 4], xExtent: [0, 10], yExtent: [0, 1] }),
      pres({ xAxis: { format: (v: number) => `${v}s` }, yAxis: {} })
    )!;
    // Top-down grid: row 0 is the top of the y extent
    expect(pointAnnouncement(num, { series: 0, index: 1 })).toBe('0.75, 7.5s: 2.');
  });

  it('data table rows = grid rows, columns = labels; CSV has every cell', () => {
    const m = model();
    const t = buildDataTable(m);
    expect(t.columns).toEqual(['Row', 'Mon', 'Tue', 'Wed', 'Thu']);
    expect(t.rows[1]).toEqual(['B', 10, 11, null, 13]);
    expect([t.sampled, t.sampledColumns]).toEqual([false, false]);
    expect(heatmapToCSV(m)).toBe('Row,Mon,Tue,Wed,Thu\r\nA,0,1,2,3\r\nB,10,11,,13\r\nC,20,21,22,23');
    expect(tableToCSV(t)).toBe(heatmapToCSV(m));
  });

  it('4096 x 4096 grid: summary in one pass, DOM table samples rows and columns', () => {
    const n = 4096;
    const values = new Float32Array(n * n);
    for (let i = 0; i < values.length; i++) values[i] = i % 1000;
    values[5] = NaN;
    const m = buildA11yModel(heatmapMeta({ cols: n, rows: n, values }), pres())!;
    expect(buildChartSummary(m)).toBe('Heatmap, 4,096 rows × 4,096 columns, values 0–999 (1 empty cell).');
    const t = buildDataTable(m, 1000, 50);
    expect(t.rows.length).toBe(1000);
    expect(t.columns.length).toBe(51);
    expect(t.columns.slice(0, 2)).toEqual(['Row', '0']);
    expect(t.columns.at(-1)).toBe('4095');
    expect(t).toMatchObject({ totalRows: n, sampled: true, totalColumns: n, sampledColumns: true });
  });

  it('keyboard hover drives the engine at the cell id and shows the host tooltip', () => {
    const { canvas, key } = keyCanvas();
    const calls: string[] = [];
    const tooltips: (ChartTooltipContext | null)[] = [];
    let empty = false;
    const state: ChartA11yHostState = {
      canvas,
      overlay: null,
      meta: heatmapMeta({ cols: 4, rows: 3, values: grid(), ...LABELS }),
      presentation: pres(),
      theme: CHARTURBO_THEMES.dark,
      backend: {
        project_node_to_ndc: (id) => {
          calls.push(`project ${id}`);
          return new Float32Array([0, 0, 0]);
        },
        // Engine item: series = row, index = column, global id = row * cols + col (empty: no hit)
        chart_hover_at_ndc: () => {
          const id = Number(calls.at(-1)!.split(' ')[1]);
          return empty ? new Float64Array([0, 0, 0]) : new Float64Array([0, 0, 1, Math.floor(id / 4), id % 4, 1, id]);
        },
        chart_clear_hover: () => calls.push('clear'),
      },
      details: () => null,
      render: () => {},
      chartTooltip: (hit) => ({ chartType: 'heatmap', index: hit[4], xLabel: 'host', items: [], details: null }),
    };
    const a11y = new ChartA11y(() => state);
    a11y.tooltip = (ctx) => tooltips.push(ctx);
    a11y.refresh();
    expect(key('ArrowRight')).toBe(true);
    expect(key('ArrowDown')).toBe(true);
    expect(calls).toEqual(['project 0', 'project 4']);
    expect(tooltips.at(-1)).toMatchObject({ chartType: 'heatmap', xLabel: 'host' });
    empty = true;
    key('ArrowRight');
    key('ArrowRight'); // (1, 2) is empty: no engine hit, hover cleared
    expect(calls.at(-1)).toBe('clear');
    expect(tooltips.at(-1)).toBeNull();
    // Fallback (no host hook): heatmap context from the model
    delete state.chartTooltip;
    empty = false;
    key('ArrowRight');
    expect(tooltips.at(-1)).toMatchObject({
      chartType: 'heatmap',
      index: 3,
      cell: { row: 1, col: 3, xLabel: 'Thu', yLabel: 'B' },
      items: [{ seriesName: 'Value', value: 13, nodeId: 7 }],
    });
    a11y.dispose();
  });

  it('canvas gets role, aria-label (description), tabindex and a description', () => {
    const attrs: Record<string, string> = {};
    const els: { id: string; textContent: string }[] = [];
    const el = () => {
      const e = { id: '', className: '', textContent: '', style: {}, setAttribute: () => {}, remove: () => {} };
      els.push(e);
      return e;
    };
    vi.stubGlobal('document', { createElement: el, getElementById: () => null, head: { appendChild: () => {} } });
    const canvas = {
      addEventListener: () => {},
      removeEventListener: () => {},
      insertAdjacentElement: () => {},
      classList: { add: () => {}, remove: () => {} },
      getAttribute: (k: string) => attrs[k] ?? null,
      setAttribute: (k: string, v: string) => (attrs[k] = v),
      removeAttribute: (k: string) => delete attrs[k],
    } as unknown as HTMLCanvasElement;
    const state = {
      canvas,
      overlay: null,
      meta: heatmapMeta({ cols: 4, rows: 3, values: grid(), ...LABELS }),
      presentation: pres({ title: 'Load' }),
      theme: CHARTURBO_THEMES.dark,
      backend: {},
      details: () => null,
      render: () => {},
    } as ChartA11yHostState;
    const a11y = new ChartA11y(() => state);
    a11y.refresh();
    expect(attrs).toMatchObject({ role: 'img', tabindex: '0' });
    expect(attrs['aria-label']).toBe('Load. Heatmap, 3 rows × 4 columns, values 0–23 (1 empty cell).');
    expect(els.find((e) => e.id === attrs['aria-describedby'])?.textContent).toContain('Rows: 3 rows from A to C.');
    state.presentation = pres({ description: 'Server load' });
    a11y.refresh();
    expect(attrs['aria-label']).toBe('Server load');
    a11y.dispose();
  });

  it('SDK: renderHeatmap exposes summary and CSV', () => {
    const noop = () => {};
    const backend = {
      set_heatmap_chart: () => 12,
      clear_scene_objects: noop,
      clear_selection: noop,
      set_rigid_physics: noop,
      set_graph_visible: noop,
      set_scene_helpers: noop,
      load_raw_dataset: noop,
    } as unknown as WasmCharturboEngineBackend;
    const sdk = Charturbo.fromBackend(backend);
    sdk.renderHeatmap({ cols: 4, rows: 3, values: grid(), ...LABELS }, { title: 'Load', axes: { y: { title: 'Server' } } });
    expect(sdk.getChartSummary()).toBe('Load. Heatmap, 3 rows × 4 columns, values 0–23 (1 empty cell).');
    expect(sdk.exportChartCSV().split('\r\n')[0]).toBe('Server,Mon,Tue,Wed,Thu');
    expect(sdk.getChartDataTable()?.rows[2]).toEqual(['C', 20, 21, 22, 23]);
  });
});
