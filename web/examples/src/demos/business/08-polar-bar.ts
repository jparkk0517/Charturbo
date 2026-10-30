import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Polar bar',
  description: 'Radial bars on a category angle axis with round caps; hover outlines a bar, the legend toggles a series and the radius axis re-fits.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  sdk.renderPolarChart(
    {
      series: [
        { type: 'bar', name: '2024', data: [32, 41, 38, 52, 61, 74, 81, 77, 63, 50, 39, 35], roundCap: true },
        { type: 'bar', name: '2025', data: [36, 44, 47, 58, 66, 79, 88, 84, 70, 55, 42, 40], roundCap: true },
      ],
    },
    { title: 'Monthly visitors (k)', angleAxis: { data: months, name: 'Month' }, radiusAxis: { name: 'Visitors' }, innerRadius: 0.15 }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
