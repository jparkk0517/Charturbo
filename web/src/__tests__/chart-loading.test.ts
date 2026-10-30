// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('../sdk/chart-a11y', () => ({
  ChartA11y: class {
    tooltip: unknown = null;
    refresh(): void {}
    dispose(): void {}
    summary(): string {
      return '';
    }
  },
}));
import { ChartLoadingLayer, validateLoadingOptions } from '../sdk/chart-loading';
import { CHARTURBO_THEMES, Charturbo } from '../sdk/charturbo';
import { graphBackend } from './graph-backend';

const dark = CHARTURBO_THEMES.dark;

function host() {
  const box = document.createElement('div');
  const canvas = document.createElement('canvas');
  box.appendChild(canvas);
  document.body.appendChild(box);
  return { box, canvas };
}

const layerOf = (box: HTMLElement) => box.querySelector<HTMLElement>('.charturbo-sdk-loading');

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('validateLoadingOptions', () => {
  it('rejects bad values', () => {
    expect(() => validateLoadingOptions(undefined)).not.toThrow();
    expect(() => validateLoadingOptions({ text: 'x', maskColor: '#ffffff80', color: '#ff0000', fontSize: 14, delay: 0, spinner: false })).not.toThrow();
    expect(() => validateLoadingOptions({ fontSize: 0 })).toThrow(/fontSize/);
    expect(() => validateLoadingOptions({ delay: -1 })).toThrow(/delay/);
    expect(() => validateLoadingOptions({ color: 'nope' })).toThrow(/color/);
    expect(() => validateLoadingOptions({ text: 3 as never })).toThrow(/text/);
    expect(() => validateLoadingOptions('x' as never)).toThrow(/options/);
  });
});

describe('ChartLoadingLayer', () => {
  it('shows a mask with spinner and status text over the canvas, busy container, excluded from exports', () => {
    const { box, canvas } = host();
    box.setAttribute('aria-busy', 'false');
    const layer = new ChartLoadingLayer(() => canvas, () => dark, () => 'Loading…');
    layer.show({});
    const el = layerOf(box)!;
    expect(el).not.toBeNull();
    expect(el.dataset.charturboExport).toBe('false');
    expect(box.getAttribute('aria-busy')).toBe('true');
    const status = el.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Loading…');
    const spinner = el.querySelector<HTMLElement>('.charturbo-sdk-loading-spinner')!;
    expect(spinner.getAttribute('aria-hidden')).toBe('true');
    expect(el.style.position).toBe('absolute');
    expect(layer.isShown()).toBe(true);
    layer.hide();
    expect(layerOf(box)).toBeNull();
    // The previous value comes back
    expect(box.getAttribute('aria-busy')).toBe('false');
    expect(layer.isShown()).toBe(false);
  });

  it('applies colors, text, font size and no spinner; showing again updates in place', () => {
    const { box, canvas } = host();
    const layer = new ChartLoadingLayer(() => canvas, () => dark, () => 'Loading…');
    layer.show({ text: 'Fetching', maskColor: '#ff000080', textColor: '#00ff00', fontSize: 16, spinner: false });
    const el = layerOf(box)!;
    expect(el.style.background).toBe('rgba(255, 0, 0, 0.502)');
    const status = el.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toBe('Fetching');
    expect(status.style.color).toBe('rgb(0, 255, 0)');
    expect(status.style.fontSize).toBe('16px');
    expect(el.querySelector('.charturbo-sdk-loading-spinner')).toBeNull();
    layer.show({ text: 'Again', color: '#0000ff' });
    expect(box.querySelectorAll('.charturbo-sdk-loading').length).toBe(1);
    expect(layerOf(box)!.querySelector('[role="status"]')!.textContent).toBe('Again');
    expect(layerOf(box)!.querySelector<HTMLElement>('.charturbo-sdk-loading-spinner')!.style.borderTopColor).toBe('rgb(0, 0, 255)');
  });

  it('delay: busy at once, visible only after the delay; hiding first shows nothing', () => {
    vi.useFakeTimers();
    const { box, canvas } = host();
    const layer = new ChartLoadingLayer(() => canvas, () => dark, () => 'Loading…');
    layer.show({ delay: 200 });
    expect(box.getAttribute('aria-busy')).toBe('true');
    expect(layerOf(box)).toBeNull();
    vi.advanceTimersByTime(199);
    expect(layerOf(box)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(layerOf(box)).not.toBeNull();
    layer.hide();
    layer.show({ delay: 100 });
    layer.hide();
    vi.advanceTimersByTime(500);
    expect(layerOf(box)).toBeNull();
    expect(box.hasAttribute('aria-busy')).toBe(false);
  });

  it('updating during a pending delay keeps the original deadline', () => {
    vi.useFakeTimers();
    const { box, canvas } = host();
    const layer = new ChartLoadingLayer(() => canvas, () => dark, () => 'Loading…');
    layer.show({ delay: 200 });
    vi.advanceTimersByTime(150);
    layer.show({ delay: 200, text: 'Still' });
    vi.advanceTimersByTime(50);
    expect(layerOf(box)!.querySelector('[role="status"]')!.textContent).toBe('Still');
    layer.hide();
  });

  it('the spinner does not spin under reduced motion', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {} }));
    const { box, canvas } = host();
    new ChartLoadingLayer(() => canvas, () => dark, () => 'Loading…').show({});
    expect(layerOf(box)!.querySelector<HTMLElement>('.charturbo-sdk-loading-spinner')!.style.animation).toBe('none');
  });

  it('default colors follow the theme (restyle)', () => {
    const { box, canvas } = host();
    let theme = dark;
    const layer = new ChartLoadingLayer(() => canvas, () => theme, () => 'Loading…');
    layer.show({});
    const before = layerOf(box)!.style.background;
    theme = CHARTURBO_THEMES.light;
    layer.restyle();
    expect(layerOf(box)!.style.background).not.toBe(before);
  });
});

describe('Charturbo showLoading / hideLoading', () => {
  function sdkWithCanvas() {
    const { box, canvas } = host();
    const sdk = Charturbo.fromBackend(graphBackend().backend);
    sdk.enableNodeInteractions(canvas);
    return { sdk, box };
  }

  it('shows, localizes, hides and disposes', () => {
    const { sdk, box } = sdkWithCanvas();
    expect(sdk.isLoading()).toBe(false);
    sdk.setLocale('ko');
    sdk.showLoading();
    expect(sdk.isLoading()).toBe(true);
    expect(layerOf(box)!.querySelector('[role="status"]')!.textContent).toBe('로딩 중…');
    sdk.setLocale('zh');
    expect(layerOf(box)!.querySelector('[role="status"]')!.textContent).toBe('加载中…');
    sdk.hideLoading();
    expect(sdk.isLoading()).toBe(false);
    expect(layerOf(box)).toBeNull();
    sdk.showLoading({ text: 'x' });
    sdk.dispose();
    expect(layerOf(box)).toBeNull();
  });

  it('bad options throw and keep the current indicator', () => {
    const { sdk, box } = sdkWithCanvas();
    sdk.showLoading({ text: 'first' });
    expect(() => sdk.showLoading({ fontSize: -3 })).toThrow(/fontSize/);
    expect(layerOf(box)!.querySelector('[role="status"]')!.textContent).toBe('first');
  });

  it('theme switch restyles the default colors', () => {
    const { sdk, box } = sdkWithCanvas();
    sdk.showLoading();
    const before = layerOf(box)!.style.background;
    sdk.setTheme('light');
    expect(layerOf(box)!.style.background).not.toBe(before);
  });
});
