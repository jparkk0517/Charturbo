// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStreamingArea } from '../../examples/src/streaming-area';

const backend = vi.hoisted(() => ({
  setTheme: vi.fn(), renderAreaChart: vi.fn(), enableNodeInteractions: vi.fn(), render: vi.fn(),
  appendAreaData: vi.fn(), dispose: vi.fn(), getXRange: vi.fn(() => [10, 20]),
  setXRange: vi.fn(), isSeriesVisible: vi.fn((s: number) => s !== 1), setSeriesVisible: vi.fn(),
}));
vi.mock('charturbo', () => ({
  Charturbo: { create: async () => backend }, CHARTURBO_THEMES: { dark: {} },
}));

describe('responsive streaming demo', () => {
  let resize: () => void;
  let width: number;
  let canvas: HTMLCanvasElement;
  const disconnect = vi.fn();
  const cleanups: Array<() => void> = [];
  beforeEach(() => {
    vi.clearAllMocks();
    width = 1100;
    canvas = document.createElement('canvas');
    vi.spyOn(canvas, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(canvas, 'clientHeight', 'get').mockReturnValue(350);
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { resize = callback; }
      observe() {}
      disconnect = disconnect;
    });
  });
  afterEach(() => { cleanups.splice(0).forEach(f => f()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('fits the available plot ratio and ignores duplicate resize notifications', async () => {
    const chart = await createStreamingArea(canvas);
    cleanups.push(chart.dispose);
    const options = backend.renderAreaChart.mock.calls[0][1];
    expect(options.width / options.height).toBeCloseTo((1100 - 62) / (350 - 70));
    resize();
    expect(backend.renderAreaChart).toHaveBeenCalledTimes(1);
  });

  it('keeps the current data, visibility and x window when relaying out', async () => {
    const chart = await createStreamingArea(canvas);
    cleanups.push(chart.dispose);
    const initial = backend.renderAreaChart.mock.calls[0][0][0];
    chart.tick(100);
    width = 390;
    resize();
    const [series, options] = backend.renderAreaChart.mock.calls[1];
    expect(options.width / options.height).toBeCloseTo((390 - 62) / (350 - 70));
    expect(series[0].x[0]).toBe(initial.x[2]);
    expect(series[0].x[599]).toBe(initial.x[599] + 100);
    expect(series[0].values).toHaveLength(600);
    expect(backend.setSeriesVisible).toHaveBeenCalledWith(1, false);
    expect(backend.setXRange).toHaveBeenCalledWith(10, 20);
  });

  it('disconnects resize observation and releases the chart once', async () => {
    const chart = await createStreamingArea(canvas);
    chart.dispose(); chart.dispose();
    width = 390;
    resize();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(backend.dispose).toHaveBeenCalledTimes(1);
    expect(backend.renderAreaChart).toHaveBeenCalledTimes(1);
  });
});
