import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Jitter strip plot',
  description: 'jitter spreads points that share an x (ggplot2 geom_jitter: uniform offsets in data units, fixed per point); tooltips keep the real values.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  // Response times of 5 services, 400 requests each (x = service index)
  const services = ['auth', 'search', 'cart', 'checkout', 'images'];
  const x: number[] = [];
  const y: number[] = [];
  const clusters: number[] = [];
  services.forEach((_, s) => {
    for (let i = 0; i < 400; i++) {
      x.push(s);
      y.push(40 + s * 15 + (-Math.log(Math.random()) * (10 + s * 4)));
      clusters.push(s);
    }
  });
  sdk.renderScatterChart(
    { x, y, clusters },
    {
      title: 'Latency by service',
      seriesNames: services,
      pointRadius: 2.5,
      opacity: 0.6,
      jitter: { x: 0.28 },
      axes: { x: { format: (v) => services[Math.round(v)] ?? '' }, y: { title: 'ms' } },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
