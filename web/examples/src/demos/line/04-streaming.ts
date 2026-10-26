import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Real-time streaming',
  description: 'appendSeriesData every 50 ms keeps a sliding window of 4,000 samples per series; the y axis autoscales to the visible window.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US', timeZone: 'UTC' });

  const step = 50; // ms between samples
  let t = Date.now() - 400 * step;
  let p50 = 40;
  const next = () => {
    p50 = Math.max(5, p50 + (Math.random() - 0.5) * 3);
    t += step;
    return [t, p50, p50 * (2 + Math.random() * 0.6)];
  };
  const history = Array.from({ length: 400 }, next);
  sdk.renderLineChart(
    [
      { name: 'p50', values: history.map((h) => h[1]), x: history.map((h) => h[0]) },
      { name: 'p99', values: history.map((h) => h[2]), x: history.map((h) => h[0]) },
    ],
    {
      title: 'Request latency (ms)',
      axes: { x: { type: 'time' }, y: { min: 0, autoscale: 'visible' } },
      animation: false,
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();

  const timer = setInterval(() => {
    const [x, a, b] = next();
    sdk.appendSeriesData(0, [a], [x], { maxPoints: 4_000 });
    sdk.appendSeriesData(1, [b], [x], { maxPoints: 4_000 });
    sdk.render();
  }, step);
  return { sdk, dispose: () => (clearInterval(timer), sdk.dispose()) };
}
