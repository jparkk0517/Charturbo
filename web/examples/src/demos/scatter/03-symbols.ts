import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Symbols per series',
  description: 'seriesSymbols: circle, square, diamond and triangle points (shader signed distances, anti-aliased); the legend swatches follow.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const n = 2_000;
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const clusters = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const s = i % 4;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 12;
    x[i] = 20 + (s % 2) * 30 + Math.cos(a) * r;
    y[i] = 20 + (s >> 1) * 30 + Math.sin(a) * r;
    clusters[i] = s;
  }
  sdk.renderScatterChart(
    { x, y, clusters },
    {
      title: 'Four clusters',
      pointRadius: 4,
      seriesNames: ['North-west', 'North-east', 'South-west', 'South-east'],
      seriesSymbols: ['circle', 'square', 'diamond', 'triangle'],
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
