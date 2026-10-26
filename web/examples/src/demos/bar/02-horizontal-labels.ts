import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Horizontal bars, data labels, error bars',
  description: 'Label placement and collision checks run in Rust; the DOM only places the text.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  sdk.renderGroupedBarChart(
    {
      categories: ['North America', 'Europe', 'Asia', 'Oceania'],
      series: [
        { name: '2025', values: [31, 45, 28, 12], error: [3, [2, 6], 2, null] }, // ±e or [minus, plus]
        { name: '2026', values: [36, 41, 33, 15], error: [2, 3, [1, 4], 1] },
      ],
    },
    {
      orientation: 'horizontal',
      title: 'Satisfaction score',
      labels: { show: 'auto', position: 'inside', format: '.0f' },
      errorBars: { width: 1.25, cap: 0.4 },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
