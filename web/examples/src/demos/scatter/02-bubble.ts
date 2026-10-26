import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Bubble chart',
  description: 'Per-point radius (CSS px) with a surface-colored ring; log x axis.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  const n = 120;
  const x = new Float32Array(n); // GDP per capita
  const y = new Float32Array(n); // life expectancy
  const sizes = new Float32Array(n); // population -> radius
  const clusters = new Uint16Array(n); // region
  for (let i = 0; i < n; i++) {
    const gdp = 10 ** (2.8 + Math.random() * 2);
    x[i] = gdp;
    y[i] = 48 + Math.log10(gdp) * 7 + (Math.random() - 0.5) * 8;
    sizes[i] = 3 + Math.random() ** 3 * 22;
    clusters[i] = i % 4;
  }
  sdk.renderScatterChart(
    { x, y, sizes, clusters },
    {
      title: 'Income vs life expectancy',
      seriesNames: ['Africa', 'Americas', 'Asia', 'Europe'],
      opacity: 0.7,
      axes: { x: { title: 'GDP per capita', scale: 'log', format: '$,.0f' }, y: { title: 'Years' } },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
