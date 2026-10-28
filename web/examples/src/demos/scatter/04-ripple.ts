import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Ripple highlights',
  description: 'ripple (ECharts effectScatter) on one series: rings grow and fade in the point shader; a frame loop runs only while ripples are shown (static under reduced motion).',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  // Background readings (series 0) and the five largest as rippling alerts (series 1)
  const n = 3_000;
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    x.push(Math.random() * 100);
    y.push(30 + Math.sin(x[i] / 12) * 15 + (Math.random() - 0.5) * 20);
  }
  const top = [...y.keys()].sort((a, b) => y[b] - y[a]).slice(0, 5);
  const clusters = y.map((_, i) => (top.includes(i) ? 1 : 0));
  const sizes = y.map((_, i) => (top.includes(i) ? 6 : 2.5));
  sdk.renderScatterChart(
    { x, y, clusters, sizes },
    {
      title: 'Sensor readings with alerts',
      seriesNames: ['Reading', 'Alert'],
      seriesColors: ['#64748b', '#ef4444'],
      pointRing: 0,
      ripple: { series: [1], scale: 3 },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
