import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Stacked radial bars',
  description: 'Ring bars on a category radius axis: the value runs along the angle, three stacked series per ring.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderPolarChart(
    {
      series: [
        { type: 'bar', name: 'Direct', data: [40, 28, 35, 22], stack: 'all' },
        { type: 'bar', name: 'Search', data: [25, 30, 18, 26], stack: 'all' },
        { type: 'bar', name: 'Social', data: [12, 18, 22, 15], stack: 'all' },
      ],
    },
    {
      title: 'Traffic by region',
      radiusAxis: { data: ['North', 'South', 'East', 'West'], name: 'Region' },
      angleAxis: { max: 100, name: 'Sessions' },
      innerRadius: 0.2,
      barCategoryGap: 0.3,
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
