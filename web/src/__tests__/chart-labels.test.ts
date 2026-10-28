import { describe, expect, it } from 'vitest';
import {
  labelRotation,
  rotatedLabelReserve,
  rotatedLabelStyle,
  thinCenteredLabels,
  thinRotatedLabels,
} from '../sdk/chart-labels';

/** Labels `width` px wide at `x` positions with tick `values`. */
function labels(xs: number[], values: number[], width = 60) {
  return xs.map((x, i) => ({
    x,
    value: values[i],
    el: { style: { display: 'block' }, getBoundingClientRect: () => ({ width: i === 2 && width < 0 ? 0 : Math.abs(width) }) } as unknown as HTMLElement,
  }));
}
const shown = (ls: ReturnType<typeof labels>) => ls.filter((l) => l.el.style.display !== 'none').map((l) => l.value);

describe('x axis label thinning', () => {
  it('keeps every label that fits and thins evenly when they collide', () => {
    const wide = labels([0, 100, 200, 300], [0, 10, 20, 30]);
    thinCenteredLabels(wide);
    expect(shown(wide)).toEqual([0, 10, 20, 30]);
    // 50 px apart, 60 px wide: every second label
    const tight = labels([0, 50, 100, 150, 200], [0, 10, 20, 30, 40]);
    thinCenteredLabels(tight);
    expect(shown(tight)).toEqual([0, 20, 40]);
  });

  it('anchors the kept set on values, so panning does not swap it', () => {
    // Same ticks shifted by one (the leftmost left the window): 20 / 40 stay, 30 stays hidden
    const panned = labels([0, 50, 100, 150], [10, 20, 30, 40]);
    thinCenteredLabels(panned);
    expect(shown(panned)).toEqual([20, 40]);
  });

  it('handles reversed axes (x descending) and empty labels', () => {
    const reversed = labels([300, 200, 100, 0], [0, 10, 20, 30]);
    thinCenteredLabels(reversed);
    expect(shown(reversed)).toEqual([0, 10, 20, 30]);
    // One empty label (width 0) does not disable thinning for the rest
    const withEmpty = labels([0, 50, 100, 150, 200], [0, 10, 20, 30, 40], -60);
    thinCenteredLabels(withEmpty);
    expect(shown(withEmpty)).toEqual([0, 20, 40]);
  });

  it('slides edge labels inside the overlay box', () => {
    const ls = labels([10, 200, 395], [0, 1, 2]);
    thinCenteredLabels(ls, [0, 400]);
    // 60 px wide: the first starts at 0, the last ends at 400, the middle stays centred
    expect(ls.map((l) => l.el.style.transform)).toEqual([
      'translate(calc(-50% + 20px), 0)',
      'translate(-50%, 0)',
      'translate(calc(-50% + -25px), 0)',
    ]);
    expect(shown(ls)).toEqual([0, 1, 2]);
  });

  it('drops a slid edge label that would collide instead of thinning the axis', () => {
    // 70 px apart, 60 px wide: fits; the last (at 395) slides to 370 and would overlap 350
    const ls = labels([10, 80, 150, 220, 290, 350, 395].map((x) => x + 30), [0, 1, 2, 3, 4, 5, 6]);
    thinCenteredLabels(ls, [0, 400]);
    expect(shown(ls)).toEqual([0, 1, 2, 3, 4]);
  });
});

/** Labels `w x h` px (layout box, before the rotation) at `x` positions with tick `values`. */
function boxes(xs: number[], values: number[], w: number | number[], h = 14) {
  return xs.map((x, i) => ({
    x,
    value: values[i],
    el: { style: { display: 'block' }, offsetWidth: Array.isArray(w) ? w[i] : w, offsetHeight: h } as unknown as HTMLElement,
  }));
}

describe('rotated x axis labels', () => {
  it('normalizes the angle (ECharts axisLabel.rotate: degrees, -90..90, positive = anticlockwise)', () => {
    expect(labelRotation(undefined)).toBe(0);
    expect(labelRotation(NaN)).toBe(0);
    expect(labelRotation(45)).toBe(45);
    expect(labelRotation(-30)).toBe(-30);
    expect(labelRotation(120)).toBe(90);
    expect(labelRotation(-200)).toBe(-90);
  });

  it('anchors the text end (positive) or start (negative) at the tick, vertically centered', () => {
    expect(rotatedLabelStyle(45)).toEqual({ transform: 'translate(-100%, -50%) rotate(-45deg)', transformOrigin: '100% 50%' });
    expect(rotatedLabelStyle(-30)).toEqual({ transform: 'translate(0, -50%) rotate(30deg)', transformOrigin: '0 50%' });
    expect(rotatedLabelStyle(90).transform).toBe('translate(-100%, -50%) rotate(-90deg)');
  });

  it('reserves the rotated depth beyond the upright row', () => {
    // 90°: the whole text width hangs below the tick (14 px already fit an upright row)
    expect(rotatedLabelReserve([[100, 14], [60, 14]], 90)).toBe(86);
    // 30°: w sin + h/2 cos = 50 + 6.06
    expect(rotatedLabelReserve([[100, 14]], 30)).toBe(43);
    // Short labels fit the upright row
    expect(rotatedLabelReserve([[10, 14]], 45)).toBe(0);
    expect(rotatedLabelReserve([], 45)).toBe(0);
  });

  it('thins by the rotated footprint, not the upright width', () => {
    // 100 px wide labels 30 px apart: upright they would keep every 4th; at 90° 30 >= 14 + 8
    const vertical = boxes([0, 30, 60, 90, 120], [0, 1, 2, 3, 4], 100);
    thinRotatedLabels(vertical, 90);
    expect(shown(vertical)).toEqual([0, 1, 2, 3, 4]);
    expect(vertical[0].el.style.transform).toBe('translate(-100%, -50%) rotate(-90deg)');
    // 45°, 20 px apart: 14.1 px across < 22, 14.1 px along < 108 -> every second (28.3 px across)
    const diagonal = boxes([0, 20, 40, 60, 80], [0, 1, 2, 3, 4], 100);
    thinRotatedLabels(diagonal, 45);
    expect(shown(diagonal)).toEqual([0, 2, 4]);
  });

  it('lets short rotated labels pass along the text direction', () => {
    // 20°, 40 px apart: 13.7 px across < 22, but 37.6 px along >= the right label (20) + 8
    const ls = boxes([0, 40, 80], [0, 1, 2], [200, 20, 20]);
    thinRotatedLabels(ls, 20);
    expect(shown(ls)).toEqual([0, 1, 2]);
    // Negative angles extend right: the left label's width decides (200 px blocks its neighbour)
    const neg = boxes([0, 40, 80], [0, 1, 2], [200, 20, 20]);
    thinRotatedLabels(neg, -20);
    expect(shown(neg)).toEqual([0, 2]);
  });

  it('leaves labels without layout as placed', () => {
    const ls = boxes([0, 1, 2], [0, 1, 2], 0, 0);
    thinRotatedLabels(ls, 45);
    expect(shown(ls)).toEqual([0, 1, 2]);
  });
});
