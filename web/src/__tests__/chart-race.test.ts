// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAnimation, sameAnimation } from '../sdk/chart-animation';
import { LineEndLabelLayer, MarkKeys, countUpValues, raceOrder, resolveRealtimeSort } from '../sdk/chart-race';
import { CHARTURBO_THEMES, Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

// The a11y layer is covered by its own suite
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

function sdkWith(extra: Partial<WasmCharturboEngineBackend> = {}) {
  const calls: Record<string, unknown[][]> = {};
  const record =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      (calls[name] ??= []).push(args);
      return ret as never;
    };
  const backend = {
    set_line_chart: record('set_line_chart', 3),
    set_bar_chart: record('set_bar_chart', 3),
    set_pie_chart: record('set_pie_chart', 2),
    set_treemap_chart: record('set_treemap_chart', 3),
    set_sunburst_chart: record('set_sunburst_chart', 3),
    set_chart_animation: record('set_chart_animation'),
    set_chart_transition: record('set_chart_transition'),
    set_chart_mark_keys: record('set_chart_mark_keys', true),
    set_chart_bar_race: record('set_chart_bar_race', true),
    set_bar_labels: record('set_bar_labels', true),
    sync_and_render: record('sync_and_render'),
    clear_scene_objects: record('clear_scene_objects'),
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    set_scene_helpers: () => {},
    clear_selection: () => {},
    ...extra,
  } as unknown as WasmCharturboEngineBackend;
  return { sdk: Charturbo.fromBackend(backend), calls };
}

const keysSent = (calls: Record<string, unknown[][]>) => Array.from(calls.set_chart_mark_keys.at(-1)![0] as Uint32Array);
const barValues = (calls: Record<string, unknown[][]>) => Array.from(calls.set_bar_chart.at(-1)![0] as Float32Array);

describe('transition option', () => {
  it('resolves, validates and compares `transition`', () => {
    expect(resolveAnimation({ transition: true }, false)).toEqual({ duration: 400, easing: 'ease-out', transition: true });
    // Off by default: the resolved shape stays as before
    expect(resolveAnimation(true, false)).toEqual({ duration: 400, easing: 'ease-out' });
    expect(() => resolveAnimation({ transition: 'yes' as never }, false)).toThrow(/transition/);
    expect(resolveAnimation({ transition: true }, true)).toBeNull(); // reduced motion
    const on = resolveAnimation({ transition: true }, false);
    expect(sameAnimation(on, resolveAnimation(true, false))).toBe(false);
    expect(sameAnimation(on, resolveAnimation({ transition: true }, false))).toBe(true);
  });

  it('is sent to the engine after the animation options, only when on', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { sdk, calls } = sdkWith();
    sdk.setAnimation(true);
    expect(calls.set_chart_transition).toBeUndefined();
    sdk.setAnimation({ transition: true });
    expect(calls.set_chart_transition).toEqual([[true]]);
    vi.unstubAllGlobals();
  });
});

describe('realtimeSort helpers', () => {
  it('resolves and validates the option', () => {
    expect(resolveRealtimeSort(undefined)).toBeNull();
    expect(resolveRealtimeSort(false)).toBeNull();
    expect(resolveRealtimeSort(true)).toEqual({ max: Infinity, valueAnimation: true });
    expect(resolveRealtimeSort({ max: 3, valueAnimation: false })).toEqual({ max: 3, valueAnimation: false });
    expect(() => resolveRealtimeSort({ max: 0 })).toThrow(/max/);
    expect(() => resolveRealtimeSort({ max: 2.5 })).toThrow(/max/);
    expect(() => resolveRealtimeSort('on' as never)).toThrow(/realtimeSort/);
  });

  it('orders by value descending (stable, missing values last) and keeps the top `max`', () => {
    const items = [
      { label: 'a', value: 2 },
      { label: 'b', value: NaN },
      { label: 'c', value: 5 },
      { label: 'd', value: 2 },
    ];
    expect(raceOrder(items, Infinity).map((i) => i.label)).toEqual(['c', 'a', 'd', 'b']);
    expect(raceOrder(items, 2).map((i) => i.label)).toEqual(['c', 'a']);
    expect(items.map((i) => i.label)).toEqual(['a', 'b', 'c', 'd']); // input untouched
  });

  it('mark keys are stable per name; repeated names get their own keys', () => {
    const keys = new MarkKeys();
    const first = Array.from(keys.keysOf(['x', 'y']));
    expect(Array.from(keys.keysOf(['y', 'z', 'x']))).toEqual([first[1], 2, first[0]]);
    const dup = Array.from(keys.keysOf(['x', 'x']));
    expect(dup[0]).toBe(first[0]);
    expect(dup[1]).not.toBe(first[0]);
  });

  it('mark keys only remember the last call (unique names do not grow the registry)', () => {
    const keys = new MarkKeys();
    for (let i = 0; i < 1000; i++) keys.keysOf([`id-${i}`, 'kept']);
    expect(keys.size).toBeLessThanOrEqual(2);
    const kept = keys.keysOf(['kept'])[0];
    expect(keys.keysOf(['kept'])[0]).toBe(kept);
  });

  it('count-up values lerp from the previous value by key (new keys from 0)', () => {
    const from = new Map([[7, 10]]);
    const v = countUpValues(Uint32Array.of(7, 9), Float32Array.of(20, 8), from, 0.3);
    expect(Array.from(v)).toEqual([13, 2]); // 13, 2.4 -> integers stay integers
    expect(Array.from(countUpValues(Uint32Array.of(7), Float32Array.of(NaN), from, 0.5))).toEqual([NaN]);
  });

  it('count-up values keep the decimals of their endpoints (no 198.18 mid-race)', () => {
    const v = countUpValues(Uint32Array.of(1, 2), Float32Array.of(198, 2.25), new Map([[1, 150], [2, 1.5]]), 0.5133);
    expect(v[0]).toBe(175);
    expect(v[1]).toBeCloseTo(1.88, 6);
  });
});

describe('bar race through the SDK', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sorts, trims, keys and races single-series bars', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { sdk, calls } = sdkWith();
    sdk.renderBarChart(
      [
        { label: 'A', value: 1 },
        { label: 'B', value: 3 },
        { label: 'C', value: 2 },
      ],
      { realtimeSort: { max: 2 }, animation: true, orientation: 'horizontal' }
    );
    expect(barValues(calls)).toEqual([3, 2]);
    expect(calls.set_chart_bar_race).toEqual([[true]]);
    const [b, c] = keysSent(calls);
    sdk.renderBarChart(
      [
        { label: 'A', value: 9 },
        { label: 'B', value: 3 },
        { label: 'C', value: 2 },
      ],
      { realtimeSort: { max: 2 }, animation: true, orientation: 'horizontal' }
    );
    expect(barValues(calls)).toEqual([9, 3]);
    const [a, b2] = keysSent(calls);
    expect(b2).toBe(b);
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('is opt-in, and a bad option throws before the current chart is cleared', () => {
    const { sdk, calls } = sdkWith();
    sdk.renderBarChart([{ label: 'A', value: 1 }, { label: 'B', value: 2 }]);
    expect(barValues(calls)).toEqual([1, 2]);
    expect(calls.set_chart_mark_keys).toBeUndefined();
    expect(calls.set_chart_bar_race).toBeUndefined();
    const cleared = calls.clear_scene_objects.length;
    expect(() => sdk.renderBarChart([{ label: 'A', value: 1 }], { realtimeSort: { max: -1 } })).toThrow(/max/);
    expect(() => sdk.renderBarChart([{ label: 'A', value: 1 }], { animation: { transition: 1 as never } })).toThrow(/transition/);
    expect(calls.clear_scene_objects.length).toBe(cleared);
  });

  it('value labels count up with the animation progress and end on the final values', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    let progress = 1;
    let animating = false;
    const { sdk } = sdkWith({ chart_animation_progress: () => progress, chart_animating: () => animating });
    const texts = () => (sdk as unknown as { chartMeta: { barStyle: { texts: string[] } } }).chartMeta.barStyle.texts;
    const opts = { realtimeSort: true, animation: { duration: 100 }, labels: true } as const;
    sdk.renderBarChart([{ label: 'A', value: 10 }, { label: 'B', value: 4 }], opts);
    sdk.render();
    expect(texts()).toEqual(['10', '4']);
    sdk.renderBarChart([{ label: 'A', value: 20 }, { label: 'B', value: 30 }, { label: 'C', value: 8 }], opts);
    [progress, animating] = [0.5, true];
    sdk.render();
    // Sorted B, A, C: B 4 -> 30, A 10 -> 20, C (new) 0 -> 8
    expect(texts()).toEqual(['17', '15', '4']);
    [progress, animating] = [1, false];
    sdk.render();
    expect(texts()).toEqual(['30', '20', '8']);
    // Accessible data stays the final values throughout
    const meta = (sdk as unknown as { chartMeta: { values: Float32Array } }).chartMeta;
    expect(Array.from(meta.values)).toEqual([30, 20, 8]);
  });
});

describe('transition keys', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('bars and pie slices share keys by name; hierarchy nodes key by path; only with transition on', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const { sdk, calls } = sdkWith();
    sdk.renderBarChart([{ label: 'A', value: 1 }, { label: 'B', value: 2 }]);
    sdk.renderPieChart({ labels: ['B', 'A'], values: [2, 1] });
    expect(calls.set_chart_mark_keys).toBeUndefined();
    sdk.setAnimation({ transition: true });
    sdk.renderBarChart([{ label: 'A', value: 1 }, { label: 'B', value: 2 }]);
    const [a, b] = keysSent(calls);
    sdk.renderPieChart({ labels: ['B', 'A'], values: [2, 1] });
    expect(keysSent(calls)).toEqual([b, a]);
    const tree = { name: 'root', children: [{ name: 'x', children: [{ name: 'y', value: 1 }] }, { name: 'y', value: 2 }] };
    sdk.renderTreemap(tree);
    const t = keysSent(calls);
    expect(new Set(t).size).toBe(t.length); // x/y and y differ
    sdk.renderSunburst(tree);
    expect(keysSent(calls).slice(0, t.length)).toEqual(t);
  });
});

describe('line end labels', () => {
  it('places one label per anchor in the series color with name and value', () => {
    const root = document.createElement('div');
    const layer = new LineEndLabelLayer(root, ['Alpha', 'Beta'], [[1, 0, 0, 1], [0, 0, 1, 1]], (v) => v.toFixed(1));
    let anchors = Float32Array.of(2, 0, 100, 50, 3.25, 1, 120, 80, 7);
    const backend = { chart_line_end_labels: () => anchors } as unknown as WasmCharturboEngineBackend;
    layer.update(backend, CHARTURBO_THEMES.dark);
    const els = Array.from(root.querySelectorAll<HTMLElement>('.charturbo-sdk-end-label')).filter((e) => e.style.display !== 'none');
    expect(els.map((e) => e.textContent)).toEqual(['Alpha 3.3', 'Beta 7.0']);
    expect(els[0].style.left).toBe('106px');
    expect(els[0].style.top).toBe('50px');
    expect(els[1].style.color).toBe('rgb(0, 0, 255)');
    // A hidden series drops its label
    anchors = Float32Array.of(1, 1, 130, 60, 8);
    layer.update(backend, CHARTURBO_THEMES.dark);
    const shown = Array.from(root.querySelectorAll<HTMLElement>('.charturbo-sdk-end-label')).filter((e) => e.style.display !== 'none');
    expect(shown.map((e) => e.textContent)).toEqual(['Beta 8.0']);
    layer.remove();
    expect(root.children.length).toBe(0);
  });

  it('line charts with `endLabel` reserve room on the right; others do not', () => {
    const { sdk } = sdkWith();
    const pad = () => (sdk as unknown as { chartPresentation: { endLabel?: unknown } }).chartPresentation.endLabel;
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    expect(pad()).toBeUndefined();
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }], { endLabel: true });
    expect(pad()).toBeDefined();
  });

  it('a throwing `endLabel.format` throws before the current chart is cleared', () => {
    const { sdk, calls } = sdkWith();
    sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }]);
    const cleared = calls.clear_scene_objects.length;
    const format = () => {
      throw new Error('boom');
    };
    expect(() => sdk.renderLineChart([{ name: 'A', values: [1, 2, 3] }], { endLabel: { format } })).toThrow(/boom/);
    expect(calls.clear_scene_objects.length).toBe(cleared);
  });
});
