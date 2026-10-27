import { Charturbo, CHARTURBO_THEMES } from 'charturbo';

/** Synthetic signals: deterministic, positive and deliberately not a performance benchmark. */
export async function createStreamingArea(canvas: HTMLCanvasElement) {
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', timeZone: 'UTC' });
  let observer: ResizeObserver | undefined;
  try {
    sdk.setTheme({ ...CHARTURBO_THEMES.dark, surface: '#0d131e' });
    const count = 600;
    const step = 50;
    const origin = Date.UTC(2026, 0, 1);
    let index = count;
    let elapsed = 0;
    let disposed = false;
    let size = '';
    const signal = (i: number, s: number) => 22 + s * 8 + Math.sin(i / 48 + s * 1.6) * 10 + Math.sin(i / 17 + s) * 4;
    const layout = () => {
      const width = Math.max(1, canvas.clientWidth - 62);
      const height = Math.max(1, canvas.clientHeight - 70);
      const nextSize = `${width}:${height}`;
      if (disposed || size === nextSize) return;
      const range = size ? sdk.getXRange() : null;
      const visible = size ? [0, 1, 2].map(s => sdk.isSeriesVisible(s)) : null;
      size = nextSize;
      const x = Float64Array.from({ length: count }, (_, i) => origin + (index - count + i) * step);
      sdk.renderAreaChart(['Europe', 'Americas', 'Asia Pacific'].map((name, s) => ({
        name, x, values: Float32Array.from({ length: count }, (_, i) => signal(index - count + i, s)),
        color: ['#b8a4f5', '#6fb9ed', '#64dfc1'][s],
      })), {
        width, height, mode: 'stacked', fillOpacity: 0.45, animation: false,
        padding: { left: 44, right: 18, top: 40, bottom: 30 },
        axes: { x: { type: 'time' }, y: { min: 0, max: 145 } },
        description: 'Synthetic regional traffic. Three synchronized series, retaining 600 samples each.',
      });
      visible?.forEach((show, s) => sdk.setSeriesVisible(s, show));
      if (range) sdk.setXRange(...range);
      sdk.render();
    };
    layout();
    observer = new ResizeObserver(layout);
    observer.observe(canvas);
    sdk.enableNodeInteractions(canvas, { autoRender: true });
    sdk.render();
    return {
      sdk,
      tick(delta: number) {
        if (disposed) return;
        elapsed += delta;
        const n = Math.floor(elapsed / step);
        if (!n) return;
        elapsed -= n * step;
        const x = Float64Array.from({ length: n }, (_, i) => origin + (index + i) * step);
        sdk.appendAreaData([0, 1, 2].map((s) => ({
          values: Float32Array.from({ length: n }, (_, i) => signal(index + i, s)), x,
        })), { maxPoints: count });
        index += n;
        sdk.render();
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        observer?.disconnect();
        sdk.dispose();
      },
    };
  } catch (error) {
    observer?.disconnect();
    sdk.dispose();
    throw error;
  }
}
