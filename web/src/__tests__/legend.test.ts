import { describe, expect, it } from 'vitest';
import { legendColumnWidth, legendPages } from '../sdk/chart-legend';

describe('legend layout helpers', () => {
  it('pages fill the available length with whole entries', () => {
    // 50 + 14 + 50 = 114 fits 120; the third entry starts page 2
    expect(legendPages([50, 50, 50, 50], 14, 120)).toEqual([0, 2]);
    // Everything fits: one page
    expect(legendPages([30, 30, 30], 10, 200)).toEqual([0]);
    // An entry wider than the room gets a page of its own (clipped, never skipped)
    expect(legendPages([40, 300, 40], 10, 120)).toEqual([0, 1, 2]);
    expect(legendPages([], 10, 100)).toEqual([0]);
    // No room measured (hidden canvas): one page, nothing to page
    expect(legendPages([50, 50], 10, 0)).toEqual([0]);
  });

  it('side legends size their column to the longest name', () => {
    expect(legendColumnWidth(['a', 'b'])).toBe(72);
    expect(legendColumnWidth(['Electricity'])).toBeCloseTo(11 * 6.5 + 30);
    expect(legendColumnWidth(['x'.repeat(100)])).toBe(200);
  });
});
