import { Charturbo } from 'charturbo';
import { htmlLang, t } from './i18n';
import { chartTheme, subscribeTheme } from './theme';

/** Series colors of the site theme (--ct-series-*, the static preview uses the same tokens). */
const seriesColors = () => {
  const style = getComputedStyle(document.documentElement);
  return [3, 2, 1].map((n) => style.getPropertyValue(`--ct-series-${n}`).trim());
};

/** Synthetic signals: deterministic, positive and deliberately not a performance benchmark. */
export async function createStreamingArea(canvas: HTMLCanvasElement) {
  const sdk = await Charturbo.create(canvas, { locale: htmlLang, timeZone: 'UTC' });
  let observer: ResizeObserver | undefined;
  let unsubscribe: (() => void) | undefined;
  try {
    sdk.setTheme(chartTheme());
    const count = 600;
    const step = 50;
    const origin = Date.UTC(2026, 0, 1);
    let index = count;
    let elapsed = 0;
    let disposed = false;
    let size = '';
    const signal = (i: number, s: number) => 22 + s * 8 + Math.sin(i / 48 + s * 1.6) * 10 + Math.sin(i / 17 + s) * 4;
    const layout = (force = false) => {
      const width = Math.max(1, canvas.clientWidth - 62);
      const height = Math.max(1, canvas.clientHeight - 70);
      const nextSize = `${width}:${height}`;
      if (disposed || (size === nextSize && !force)) return;
      const range = size ? sdk.getXRange() : null;
      const visible = size ? [0, 1, 2].map(s => sdk.isSeriesVisible(s)) : null;
      size = nextSize;
      const x = Float64Array.from({ length: count }, (_, i) => origin + (index - count + i) * step);
      const colors = seriesColors();
      sdk.renderAreaChart([t('landing.seriesEurope'), t('landing.seriesAmericas'), t('landing.seriesAsia')].map((name, s) => ({
        name, x, values: Float32Array.from({ length: count }, (_, i) => signal(index - count + i, s)),
        color: colors[s],
      })), {
        width, height, mode: 'stacked', fillOpacity: 0.45, animation: false,
        padding: { left: 44, right: 18, top: 40, bottom: 30 },
        axes: { x: { type: 'time' }, y: { min: 0, max: 145 } },
        description: t('landing.chartDescription'),
      });
      visible?.forEach((show, s) => sdk.setSeriesVisible(s, show));
      if (range) sdk.setXRange(...range);
      sdk.render();
    };
    layout();
    observer = new ResizeObserver(() => layout());
    // Site theme switch: chart theme and series colors follow, keeping the view
    unsubscribe = subscribeTheme(() => { sdk.setTheme(chartTheme()); layout(true); });
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
        unsubscribe?.();
        sdk.dispose();
      },
    };
  } catch (error) {
    observer?.disconnect();
    unsubscribe?.();
    sdk.dispose();
    throw error;
  }
}
