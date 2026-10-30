import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { AUTO_DECALS, DECAL_SPEC_STRIDE, decalPaint, decalSwatchSvg, encodeDecals, resolveDecal, resolveDecals, validateDecal } from '../sdk/chart-decal';
import { renderChartSpec } from '../sdk/chart-binding';

/** Minimal DOM element: enough for the chart overlay (legend, ticks) and the tooltip. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  innerHTML = '';
  type = '';
  offsetLeft = 0;
  offsetTop = 0;
  offsetWidth = 800;
  offsetHeight = 400;
  id = '';
  tabIndex = -1;
  classList = { add: () => {}, remove: () => {} };
  constructor(readonly tag: string) {}
  appendChild(c: FakeEl): FakeEl {
    c.parentElement = this;
    this.children.push(c);
    return c;
  }
  append(...cs: FakeEl[]): void {
    cs.forEach((c) => this.appendChild(c));
  }
  replaceChildren(...cs: FakeEl[]): void {
    this.children = [];
    this.append(...cs);
  }
  removeChild(c: FakeEl): void {
    this.children = this.children.filter((x) => x !== c);
    c.parentElement = null;
  }
  remove(): void {
    this.parentElement?.removeChild(this);
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  insertAdjacentElement(_where: string, el: FakeEl): FakeEl {
    return (this.parentElement ?? this).appendChild(el);
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 400 };
  }
  querySelectorAll(sel: string): FakeEl[] {
    const cls = sel.slice(1);
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) =>
      el.children.forEach((c) => {
        if (c.className.split(' ').includes(cls)) out.push(c);
        walk(c);
      });
    walk(this);
    return out;
  }
}

type Calls = Record<string, unknown[][]>;

/** Backend recording every call; listed methods return fixed values, the rest undefined. */
function mockBackend(calls: Calls, returns: Record<string, unknown> = {}): WasmCharturboEngineBackend {
  const fixed: Record<string, unknown> = {
    set_bar_chart: 3,
    set_bar_chart_multi: 4,
    set_chart_decals: '',
    chart_hover_at_ndc: new Float64Array(0),
    chart_axes: new Float64Array(0),
    chart_axes_revision: 1,
    export_positions: new Float32Array(0),
    select_box_ndc: new Uint32Array(0),
    query_radius: new Uint32Array(0),
    select_node_and_neighbors: new Uint32Array(0),
    select_cluster: new Uint32Array(0),
    node_count: 0,
    edge_count: 0,
    pick_node_at_ndc: -1,
    ...returns,
  };
  return new Proxy({} as WasmCharturboEngineBackend, {
    get: (_t, name: string) => {
      if (name === 'then') return undefined;
      return (...args: unknown[]) => {
        (calls[name] ??= []).push(args);
        return fixed[name] as never;
      };
    },
    has: () => true,
  });
}

const specsOf = (calls: Calls): Float32Array => calls.set_chart_decals?.at(-1)?.[0] as Float32Array;
const symbolsOf = (specs: Float32Array) => Array.from({ length: specs.length / DECAL_SPEC_STRIDE }, (_, k) => specs[k * DECAL_SPEC_STRIDE]);

describe('decal options', () => {
  it('validates symbols, sizes, spacing, rotation, color and opacity', () => {
    expect(() => validateDecal({ symbol: 'star' as never }, 'x')).toThrow(/decal.symbol "star"/);
    expect(() => validateDecal({ symbolSize: 0 }, 'x')).toThrow(/symbolSize 0/);
    expect(() => validateDecal({ spacing: 0.5 }, 'x')).toThrow(/spacing/);
    expect(() => validateDecal({ rotation: NaN }, 'x')).toThrow(/rotation/);
    expect(() => validateDecal({ opacity: 2 }, 'x')).toThrow(/opacity/);
    expect(() => validateDecal({ color: 'notacolor' }, 'x')).toThrow(/decal.color/);
    expect(() => validateDecal({ symbol: 'cross', symbolSize: 4, spacing: 9, rotation: 30, color: '#f00', opacity: 1 }, 'x')).not.toThrow();
    expect(() => validateDecal(true, 'x')).not.toThrow();
    expect(() => validateDecal({ symbol: 'toString' as never }, 'x')).toThrow(/decal.symbol "toString"/);
    expect(() => validateDecal({ symbol: 'constructor' as never }, 'x')).toThrow(/decal.symbol/);
  });

  it('explicit undefined fields keep the automatic values', () => {
    const d = resolveDecal({ symbol: undefined, symbolSize: undefined, spacing: undefined, rotation: undefined, color: '#f00' }, { opacity: undefined }, 1);
    expect(d).toMatchObject({ symbol: AUTO_DECALS[1].symbol, symbolSize: AUTO_DECALS[1].symbolSize, spacing: AUTO_DECALS[1].spacing, rotation: AUTO_DECALS[1].rotation, opacity: 0.45 });
    expect(Array.from(encodeDecals([d])).every(Number.isFinite)).toBe(true);
  });

  it('resolves auto patterns, chart-level fields and per-mark overrides', () => {
    expect(resolveDecal(undefined, undefined, 0)).toBeNull();
    expect(resolveDecal(false, undefined, 0)).toBeNull();
    expect(resolveDecal(true, false, 0)).toBeNull();
    expect(resolveDecal(true, { symbol: 'none' }, 0)).toBeNull();
    expect(resolveDecal(true, undefined, 1)).toEqual({ ...AUTO_DECALS[1], color: null, opacity: 0.45 });
    // Cycles past the list
    expect(resolveDecal(true, undefined, AUTO_DECALS.length)?.symbol).toBe(AUTO_DECALS[0].symbol);
    expect(resolveDecal({ opacity: 0.8 }, { symbol: 'rect' }, 0)).toMatchObject({ symbol: 'rect', opacity: 0.8, rotation: 45 });
    // Own options without a chart-level decal
    expect(resolveDecal(undefined, { color: '#ff0000' }, 2)).toMatchObject({ symbol: AUTO_DECALS[2].symbol, color: [1, 0, 0, 1] });
    expect(resolveDecals(undefined, 3, () => undefined, (k) => k)).toBeNull();
    expect(new Set(AUTO_DECALS.map((d) => `${d.symbol}${d.rotation}`)).size).toBe(AUTO_DECALS.length);
  });

  it('encodes specs (auto contrast r = -1, rotation in radians, opacity times color alpha)', () => {
    const specs = encodeDecals([resolveDecal(true, undefined, 0), null, resolveDecal(true, { color: [0, 1, 0, 0.5], opacity: 0.5, rotation: 90 }, 1)]);
    expect(specs.length).toBe(3 * DECAL_SPEC_STRIDE);
    const round = (a: Float32Array) => Array.from(a).map((v) => Math.round(v * 1000) / 1000);
    expect(round(specs.subarray(0, 8))).toEqual([5, 2, 8, 0.785, -1, 0, 0, 0.45]);
    expect(round(specs.subarray(8, 16))).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(round(specs.subarray(16, 24))).toEqual([2, 3, 8, 1.571, 0, 1, 0, 0.25]);
    expect(encodeDecals(null).length).toBe(0);
  });

  it('paints auto contrast like the shader and draws matching swatch SVG', () => {
    const d = resolveDecal(true, undefined, 3)!;
    expect(decalPaint(d, [1, 1, 0.9, 1])).toEqual([0, 0, 0, 0.45]);
    expect(decalPaint(d, [0.1, 0.2, 0.5, 0.5])).toEqual([1, 1, 1, 0.225]);
    const svg = decalSwatchSvg(d, [0.1, 0.2, 0.5, 1], 10, 10);
    expect(svg).toContain('<pattern id="d" patternUnits="userSpaceOnUse" width="10" height="10" patternTransform="rotate(45)">');
    expect(svg).toContain('fill="rgba(255,255,255,0.45)"');
    expect(svg).toContain('fill="url(#d)"');
  });
});

describe('decals on charts', () => {
  beforeEach(() => {
    vi.stubGlobal('document', {
      body: new FakeEl('body'),
      head: new FakeEl('head'),
      createElement: (tag: string) => new FakeEl(tag),
      getElementById: () => null,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('off by default: no decal call (charts render exactly as before)', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderGroupedBarChart({ categories: ['a', 'b'], series: [{ name: 'A', values: [1, 2] }, { name: 'B', values: [3, 4] }] });
    sdk.renderPieChart({ labels: ['x', 'y'], values: [1, 2] });
    expect(calls.set_chart_decals).toBeUndefined();
  });

  it('grouped / stacked bars: one spec per global bar id, patterns per series, series overrides', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderGroupedBarChart(
      {
        categories: ['a', 'b', 'c'],
        series: [
          { name: 'A', values: [1, 2, 3] },
          { name: 'B', values: [3, 4, 5], decal: { symbol: 'cross' } },
          { name: 'C', values: [1, 1, 1], decal: false },
        ],
      },
      { mode: 'stacked', decal: true }
    );
    const order = Object.keys(calls);
    expect(order.indexOf('set_chart_decals')).toBeGreaterThan(order.indexOf('set_bar_chart_multi'));
    expect(symbolsOf(specsOf(calls))).toEqual([5, 5, 5, 6, 6, 6, 0, 0, 0]);
  });

  it('single-series bars: one pattern, or one per item category; items override', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderBarChart([{ label: 'a', value: 1 }, { label: 'b', value: 2, decal: { symbol: 'circle' } }], { decal: true });
    expect(symbolsOf(specsOf(calls))).toEqual([5, 2]);
    sdk.renderBarChart(
      [
        { label: 'a', value: 1, category: 'x' },
        { label: 'b', value: 2, category: 'y' },
        { label: 'c', value: 2, category: 'x' },
      ],
      { decal: true }
    );
    expect(symbolsOf(specsOf(calls))).toEqual([5, 2, 5]);
  });

  it('invalid decals throw before the current chart is cleared', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderBarChart([{ label: 'a', value: 1 }]);
    const cleared = calls.clear_scene_objects?.length ?? 0;
    expect(() => sdk.renderBarChart([{ label: 'a', value: 1 }], { decal: { spacing: 0 } })).toThrow(/renderBarChart: decal.spacing/);
    expect(() => sdk.renderGroupedBarChart({ categories: ['a'], series: [{ name: 'A', values: [1], decal: { symbol: 'x' as never } }] })).toThrow(/decal.symbol/);
    expect(() => sdk.renderPieChart({ labels: ['a'], values: [1] }, { decals: [{ opacity: -1 }] })).toThrow(/opacity/);
    expect(() => sdk.renderAreaChart([{ name: 'A', values: [1, 2], decal: { symbolSize: -1 } }])).toThrow(/symbolSize/);
    expect(() => sdk.renderTreemap({ name: 'r', children: [{ name: 'a', value: 1, decal: { rotation: Infinity } }] })).toThrow(/rotation/);
    expect(() => sdk.renderFunnelChart({ labels: ['a'], values: [1] }, { decal: 'yes' as never })).toThrow(/decal must be/);
    expect(calls.clear_scene_objects?.length ?? 0).toBe(cleared);
  });

  it('pie (by input slice), area (by series), funnel (by stage)', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    sdk.renderPieChart({ labels: ['x', 'y', 'z'], values: [1, 2, 3] }, { decal: true, decals: [undefined, false] });
    expect(symbolsOf(specsOf(calls))).toEqual([5, 0, 1]);
    sdk.renderAreaChart([{ name: 'A', values: [1, 2] }, { name: 'B', values: [2, 3] }], { decal: true });
    expect(symbolsOf(specsOf(calls))).toEqual([5, 2]);
    sdk.renderFunnelChart({ labels: ['a', 'b'], values: [3, 2] }, { decal: true });
    expect(symbolsOf(specsOf(calls))).toEqual([5, 2]);
  });

  it('treemap / sunburst: one spec per node, auto pattern of its top-level group, node overrides', () => {
    const calls: Calls = {};
    // Legend groups: nodes 1 and 3 (the engine reports [node, r, g, b, a] per entry)
    const sdk = Charturbo.fromBackend(mockBackend(calls, { chart_hierarchy_legend: new Float64Array([1, 0, 0, 1, 1, 3, 1, 0, 0, 1]) }));
    const data = { name: 'r', children: [{ name: 'a', children: [{ name: 'a1', value: 1, decal: { symbol: 'diamond' as const } }] }, { name: 'b', value: 2 }] };
    sdk.renderTreemap(data, { decal: true });
    // Nodes depth-first: r, a, a1, b
    expect(symbolsOf(specsOf(calls))).toEqual([5, 5, 4, 2]);
    sdk.renderSunburst(data, { decal: true });
    expect(symbolsOf(specsOf(calls))).toEqual([5, 5, 4, 2]);
  });

  it('legend swatches show the pattern; a theme switch keeps the decals', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    const body = new FakeEl('div');
    sdk.enableNodeInteractions(body.appendChild(new FakeEl('canvas')) as unknown as HTMLCanvasElement);
    sdk.renderGroupedBarChart({ categories: ['a'], series: [{ name: 'A', values: [1] }, { name: 'B', values: [2] }] }, { decal: true });
    const items = body.querySelectorAll('.charturbo-sdk-legend-item');
    expect(items.length).toBe(2);
    expect(items[0].children[0].style.backgroundImage).toMatch(/^url\("data:image\/svg\+xml,/);
    const sent = calls.set_chart_decals.length;
    sdk.setTheme('light');
    // Decals live in the engine chart; theme restyles never clear them
    expect(calls.set_chart_decals.length).toBe(sent);
    expect(body.querySelectorAll('.charturbo-sdk-legend-item')[1].children[0].style.backgroundImage).toContain('svg');
  });

  it('chart specs (React / Vue) pass decals through', () => {
    const calls: Calls = {};
    const sdk = Charturbo.fromBackend(mockBackend(calls));
    renderChartSpec(sdk, { type: 'pie', data: { labels: ['a', 'b'], values: [1, 2] }, options: { decal: { symbol: 'circle' } } });
    expect(symbolsOf(specsOf(calls))).toEqual([2, 2]);
  });
});
