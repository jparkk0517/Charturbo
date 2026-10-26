import { describe, expect, it } from 'vitest';
import { thinCenteredLabels } from '../sdk/chart-labels';

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
