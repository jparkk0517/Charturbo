import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Nightingale rose',
  description: 'Equal angles, slice area proportional to the value (r ∝ √value) on a donut hole. Legend clicks rescale the rest.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderPieChart(
    {
      labels: ['North', 'North-east', 'East', 'South-east', 'South', 'South-west', 'West', 'North-west'],
      values: [40, 38, 32, 30, 28, 26, 22, 18],
    },
    { title: 'Wind direction frequency', rose: 'area', donut: 0.2, maxSlices: false, format: (v) => `${v} days` }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
