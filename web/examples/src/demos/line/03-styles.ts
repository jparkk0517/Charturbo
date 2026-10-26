import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Line styles, markers and bands',
  description: 'Dashed monotone forecast with a confidence band, markers on the actuals, a step series and a threshold annotation.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  const n = 48;
  const trend = (i: number) => 50 + Math.sin(i / 6) * 12;
  const forecast = Float32Array.from({ length: n }, (_, i) => trend(i));
  const lower = forecast.map((v, i) => v - 3 - i * 0.15);
  const upper = forecast.map((v, i) => v + 3 + i * 0.15);
  const actual = Float32Array.from({ length: n }, (_, i) => (i < 32 ? trend(i) + Math.cos(i * 1.7) * 3 : NaN)); // NaN = no data yet
  const capacity = Float32Array.from({ length: n }, (_, i) => 66 + Math.floor(i / 12) * 4);

  sdk.renderLineChart(
    [
      { name: 'Forecast', values: forecast, dash: [6, 3], curve: 'monotone', band: { lower, upper, opacity: 0.18 } },
      { name: 'Actual', values: actual, marker: { shape: 'circle', size: 6, show: 'always' } },
      { name: 'Capacity', values: capacity, curve: 'stepAfter' },
    ],
    { title: 'Forecast vs actual', axes: { x: { title: 'Week' } }, hover: { mode: 'index', crosshair: true } }
  );
  sdk.setAnnotations([{ type: 'hline', y: 40, label: 'SLO floor', dash: true }]);
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
