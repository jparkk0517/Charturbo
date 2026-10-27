import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Bars + area + line (right axis)',
  description: 'Series share one x mapping: line points sit at the center of each bar slot. One tooltip shows every series.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderComboChart(
    {
      categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
      series: [
        { name: 'Online', type: 'bar', values: [12, 18, 22, 19, 26, 31, 28, 35, 33, 37, 44, 52] },
        { name: 'Retail', type: 'bar', values: [8, 9, 7, 11, 10, 12, 14, 13, 12, 15, 18, 24] },
        { name: 'Target', type: 'area', values: [18, 22, 26, 28, 32, 36, 40, 44, 46, 50, 56, 64] },
        { name: 'Margin %', type: 'line', yAxis: 'right', values: [21, 24, 23, 27, 26, 30, 29, 33, 31, 34, 36, 35], marker: { show: 'always' }, dash: [5, 3] },
      ],
    },
    {
      barMode: 'stacked',
      title: 'Revenue and margin',
      axes: { y: { title: 'Revenue ($M)', min: 0 }, y2: { title: 'Margin', format: (v) => `${v}%` } },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
