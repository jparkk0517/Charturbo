import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseColor, parseOptionalColor } from '../sdk/color';
import { CHARTURBO_THEMES, Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

const close = (a: number[], b: number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 3));
};

describe('parseColor', () => {
  it('passes tuples through', () => {
    const c: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    expect(parseColor(c)).toBe(c);
    expect(parseOptionalColor(undefined)).toBeUndefined();
  });

  it('hex: #rgb, #rgba, #rrggbb, #rrggbbaa (any case)', () => {
    close(parseColor('#3b82f6'), [59 / 255, 130 / 255, 246 / 255, 1]);
    close(parseColor('#3B82F680'), [59 / 255, 130 / 255, 246 / 255, 128 / 255]);
    close(parseColor('#f00'), [1, 0, 0, 1]);
    close(parseColor('#f008'), [1, 0, 0, 0x88 / 255]);
    close(parseColor('  #FFF  '), [1, 1, 1, 1]);
  });

  it('rgb() / rgba(): legacy commas, modern spaces, percentages, slash alpha', () => {
    close(parseColor('rgb(255, 0, 128)'), [1, 0, 128 / 255, 1]);
    close(parseColor('rgba(255, 0, 0, 0.5)'), [1, 0, 0, 0.5]);
    close(parseColor('rgb(255 0 0 / 25%)'), [1, 0, 0, 0.25]);
    close(parseColor('rgb(100% 50% 0%)'), [1, 0.5, 0, 1]);
    close(parseColor('RGBA(0,0,0,.2)'), [0, 0, 0, 0.2]);
    // Out-of-range components clamp
    close(parseColor('rgb(300, -5, 0)'), [1, 0, 0, 1]);
  });

  it('hsl() / hsla() with hue units', () => {
    close(parseColor('hsl(0, 100%, 50%)'), [1, 0, 0, 1]);
    close(parseColor('hsl(120 100% 25%)'), [0, 0.5, 0, 1]);
    close(parseColor('hsla(240, 100%, 50%, 0.3)'), [0, 0, 1, 0.3]);
    close(parseColor('hsl(0.5turn 100% 50% / 50%)'), [0, 1, 1, 0.5]);
    close(parseColor('hsl(-120deg, 100%, 50%)'), [0, 0, 1, 1]);
    close(parseColor('hsl(0, 0%, 50%)'), [0.5, 0.5, 0.5, 1]);
  });

  it('transparent; returns a fresh copy from the cache', () => {
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
    const a = parseColor('#123456');
    a[0] = 9;
    expect(parseColor('#123456')[0]).toBeCloseTo(0x12 / 255, 5);
  });

  it('rejects malformed strings (no DOM fallback in node)', () => {
    for (const bad of ['#12', '#12345', 'rgb(1, 2)', 'rgb(1 2 3 4)', 'hsl(red, 1%, 1%)', 'rgb(a, b, c)', 'tomato', '']) {
      expect(() => parseColor(bad), bad).toThrow(TypeError);
    }
  });

  describe('canvas fallback (named and other CSS colors)', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('resolves through a 2D context when document exists', async () => {
      // Fake 2D context: knows `rebeccapurple` (serialized as hex) and `color(display-p3 ...)`
      // (kept as is, read back as a pixel); anything else is invalid
      const ctx = {
        _fill: '#000000',
        set fillStyle(v: string) {
          if (v === 'rebeccapurple') this._fill = '#663399';
          else if (v.startsWith('color(')) this._fill = v;
          else if (v.startsWith('#')) this._fill = v;
        },
        get fillStyle() {
          return this._fill;
        },
        clearRect() {},
        fillRect() {},
        getImageData: () => ({ data: new Uint8ClampedArray([64, 0, 0, 128]) }),
      };
      vi.stubGlobal('document', { createElement: () => ({ getContext: () => ctx }) });
      vi.resetModules();
      const { parseColor: fresh } = await import('../sdk/color');
      close(fresh('RebeccaPurple'), [0x66 / 255, 0x33 / 255, 0x99 / 255, 1]);
      close(fresh('color(display-p3 1 0 0 / 0.5)'), [64 / 255, 0, 0, 128 / 255]);
      expect(() => fresh('notacolor')).toThrow(TypeError);
    });
  });
});

describe('CSS colors across the SDK', () => {
  function backend() {
    const calls: Record<string, unknown[][]> = {};
    const record =
      (name: string) =>
      (...args: unknown[]) => {
        (calls[name] ??= []).push(args);
        return 0 as never;
      };
    const noop = () => undefined as never;
    const b = new Proxy({} as WasmCharturboEngineBackend, {
      get: (_t, key: string) =>
        ['set_line_chart', 'set_bar_chart', 'set_bar_chart_multi', 'set_scatter_chart', 'set_chart_hover_style',
          'set_chart_frame_style', 'set_clear_color', 'set_node_hover_style'].includes(key)
          ? record(key)
          : key === 'chart_series_count'
            ? () => 2
            : key === 'pick_node_at_ndc'
              ? () => -1
              : key.startsWith('chart_') || key === 'free' || key === 'then'
                ? undefined
                : noop,
    });
    return { sdk: Charturbo.fromBackend(b), calls };
  }
  const rgba = (f: Float32Array, at = 0) => Array.from(f.slice(at, at + 4));

  it('series, bar, hover, grid and node hover colors accept CSS strings', () => {
    const { sdk, calls } = backend();
    sdk.renderLineChart(
      [
        { name: 'a', values: [1, 2], color: '#ff0000' },
        { name: 'b', values: [1, 2], color: [0, 1, 0, 1] },
      ],
      { hover: { crosshairColor: 'rgba(0, 0, 255, 0.5)' }, grid: { color: 'hsl(0, 0%, 50%)', baselineColor: '#000' } }
    );
    const colors = calls.set_line_chart[0][2] as Float32Array;
    close(rgba(colors, 0), [1, 0, 0, 1]);
    close(rgba(colors, 4), [0, 1, 0, 1]);
    close(rgba(calls.set_chart_hover_style.at(-1)![0] as Float32Array, 2), [0, 0, 1, 0.5]);
    const grid = calls.set_chart_frame_style.at(-1)![0] as Float32Array;
    close(rgba(grid, 2), [0.5, 0.5, 0.5, 1]);
    close(rgba(grid, 6), [0, 0, 0, 1]);

    sdk.renderBarChart([{ label: 'x', value: 1 }, { label: 'y', value: 2, color: '#00f' }], { color: 'rgb(255 255 0)' });
    const bars = calls.set_bar_chart[0][1] as Float32Array;
    close(rgba(bars, 0), [1, 1, 0, 1]);
    close(rgba(bars, 4), [0, 0, 1, 1]);

    sdk.renderGroupedBarChart({ categories: ['q'], series: [{ name: 's', values: [1], color: '#0f0' }] });
    close(rgba(calls.set_bar_chart_multi[0][2] as Float32Array), [0, 1, 0, 1]);

    sdk.renderScatterChart({ x: [0], y: [0] }, { seriesColors: ['#f00', [0, 0, 1, 1]], hover: { markerRingColor: '#fff' } });
    const sc = calls.set_scatter_chart[0][5] as Float32Array;
    close(Array.from(sc), [1, 0, 0, 1, 0, 0, 1, 1]);

    sdk.setNodeHoverStyle({ color: '#ff000080' });
    close((calls.set_node_hover_style[0] as number[]).slice(2, 6), [1, 0, 0, 128 / 255]);
  });

  it('custom themes may use CSS strings; getTheme returns tuples', () => {
    const { sdk, calls } = backend();
    sdk.setTheme({ ...CHARTURBO_THEMES.light, name: 'brand', surface: '#ffffff', palette: ['#ff0000', 'hsl(120, 100%, 50%)'], crosshair: 'rgb(0 0 0 / 50%)' });
    const t = sdk.getTheme();
    expect(t.name).toBe('brand');
    expect(t.surface).toEqual([1, 1, 1, 1]);
    close(t.palette[1], [0, 1, 0, 1]);
    close(t.crosshair, [0, 0, 0, 0.5]);
    expect(calls.set_clear_color.at(-1)).toEqual([1, 1, 1, 1]);
  });
});
