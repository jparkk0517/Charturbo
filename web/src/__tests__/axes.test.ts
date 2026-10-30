import { describe, expect, it } from 'vitest';
import {
  breakExtent,
  layoutExtraAxes,
  resolveBreaks,
  seriesAxisIndex,
  validateBreaks,
  validateSeriesAxisIndex,
  yAxisCode,
} from '../sdk/chart-axes';
import { encodeSeriesAxes } from '../sdk/chart-scales';

describe('axis breaks (chart-axes)', () => {
  it('accepts valid breaks in any order and rejects bad input with the axis name', () => {
    expect(() => validateBreaks(undefined, 'f: axes.y', false)).not.toThrow();
    expect(() => validateBreaks([], 'f: axes.y', true)).not.toThrow();
    expect(() => validateBreaks([{ start: 300, end: 400 }, { start: 30, end: 80, gap: '5%' }], 'f: axes.y', false)).not.toThrow();
    const bad: [unknown, RegExp][] = [
      ['x', /array/],
      [[{ start: NaN, end: 2 }], /finite/],
      [[{ start: 2, end: 2 }], /start < end/],
      [[{ start: 1, end: 2, gap: -1 }], /gap/],
      [[{ start: 1, end: 2, gap: 'big' }], /gap/],
      [[{ start: 1, end: 2, gap: Infinity }], /gap/],
      [[{ start: 1, end: 5 }, { start: 5, end: 9 }], /overlap/],
      [[{ start: 1, end: 6 }, { start: 3, end: 4 }], /overlap/],
      [Array.from({ length: 9 }, (_, i) => ({ start: i * 10, end: i * 10 + 1 })), /at most 8/],
    ];
    for (const [b, msg] of bad) {
      expect(() => validateBreaks(b as never, 'f: axes.y', false)).toThrow(msg);
      expect(() => validateBreaks(b as never, 'f: axes.y', false)).toThrow(/^f: axes\.y/);
    }
    expect(() => validateBreaks([{ start: 1, end: 2 }], 'f: axes.y', true)).toThrow(/linear/);
  });

  it('resolves gaps: data units, percent of the kept span, default 2%', () => {
    // Extent 0..500 with 30..480 removed: kept span 50
    const flat = resolveBreaks([{ start: 30, end: 480 }, { start: 600, end: 700, gap: 3 }], [0, 500]);
    expect(Array.from(flat)).toEqual([30, 480, 1, 600, 700, 3]);
    expect(Array.from(resolveBreaks([{ start: 30, end: 480, gap: '10%' }], [0, 500]))).toEqual([30, 480, 5]);
    // No data: percent of the break length
    expect(Array.from(resolveBreaks([{ start: 0, end: 100, gap: '5%' }], null))).toEqual([0, 100, 5]);
    expect(resolveBreaks(undefined, [0, 1])).toHaveLength(0);
  });

  it('finds the finite extent of values (optionally with zero)', () => {
    expect(breakExtent([[5, NaN, 9], [7, null as never]])).toEqual([5, 9]);
    expect(breakExtent([[5, 9]], true)).toEqual([0, 9]);
    expect(breakExtent([[NaN]])).toBeNull();
  });
});

describe('multiple y axes (chart-axes)', () => {
  it('maps series to axis indices: yAxisIndex wins over yAxis', () => {
    expect(seriesAxisIndex({})).toBe(0);
    expect(seriesAxisIndex({ yAxis: 'right' })).toBe(1);
    expect(seriesAxisIndex({ yAxis: 'right', yAxisIndex: 3 })).toBe(3);
    expect(seriesAxisIndex({ yAxis: 'right', yAxisIndex: 0 })).toBe(0);
    expect(Array.from(encodeSeriesAxes([{}, { yAxisIndex: 2 }, { yAxis: 'right' }])!)).toEqual([0, 2, 1]);
    expect(encodeSeriesAxes([{ yAxisIndex: 0 }, {}])).toBeNull();
    expect(() => validateSeriesAxisIndex([{ yAxisIndex: 2 }], 3, 'f')).not.toThrow();
    expect(() => validateSeriesAxisIndex([{}, { yAxisIndex: 3 }], 3, 'f')).toThrow(/f: series 1 yAxisIndex 3/);
    expect(() => validateSeriesAxisIndex([{ yAxisIndex: 1.5 }], 3, 'f')).toThrow(/yAxisIndex/);
    expect(yAxisCode(0)).toBe(1);
    expect(yAxisCode(1)).toBe(2);
    expect(yAxisCode(2)).toBe(18);
  });

  it('stacks extra axes outward on their side with offsets and titles', () => {
    const out = layoutExtraAxes(
      [{ position: 'right' }, { position: 'left', title: 'P', offset: 10 }, { position: 'right', show: false }, {}],
      { left: 56, right: 76 }
    );
    expect(out.slots).toEqual([
      { k: 2, side: 'right', dist: 76, width: 56 },
      { k: 3, side: 'left', dist: 66, width: 76 },
      // Hidden: no room (a title keeps its own)
      { k: 4, side: 'right', dist: 132, width: 0 },
      { k: 5, side: 'right', dist: 132, width: 56 },
    ]);
    expect(out.left).toBe(142);
    expect(out.right).toBe(188);
    // No extra axes: base sizes
    expect(layoutExtraAxes([], { left: 56, right: 0 })).toEqual({ slots: [], left: 56, right: 0 });
  });
});
