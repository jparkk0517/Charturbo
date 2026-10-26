import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Radar',
  description: 'Hover picks the axis nearest to the pointer and shows every series on it.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  sdk.renderRadarChart(
    {
      axes: ['Speed', 'Range', 'Cost', 'Comfort', 'Safety', 'Tech'],
      series: [
        { name: 'Model A', values: [82, 64, 45, 71, 90, 58] },
        { name: 'Model B', values: [55, 88, 70, 62, 74, 81] },
      ],
    },
    { title: 'Vehicle comparison', max: 100, rings: 4, markers: true, format: '.0f' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
