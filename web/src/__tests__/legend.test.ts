import { describe, expect, it } from 'vitest';
import { legendColumnWidth, legendPages, symbolSwatch } from '../sdk/chart-legend';

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

  it('scatter swatches follow the series symbol (glyph triangle exports as text)', () => {
    expect(symbolSwatch('circle', 'red')).toEqual({ style: { width: '8px', height: '8px', borderRadius: '50%', background: 'red' } });
    expect(symbolSwatch('square', 'red').style).toMatchObject({ width: '8px', height: '8px', borderRadius: '1px', background: 'red' });
    expect(symbolSwatch('diamond', 'red').style).toMatchObject({ transform: 'rotate(45deg)', width: '7px', background: 'red' });
    expect(symbolSwatch('triangle', 'red')).toEqual({ style: { color: 'red', fontSize: '10px', lineHeight: '10px', width: '10px', textAlign: 'center' }, text: '▲' });
  });

  it('side legends size their column to the longest name', () => {
    expect(legendColumnWidth(['a', 'b'])).toBe(72);
    expect(legendColumnWidth(['Electricity'])).toBeCloseTo(11 * 6.5 + 30);
    expect(legendColumnWidth(['x'.repeat(100)])).toBe(200);
  });
});
