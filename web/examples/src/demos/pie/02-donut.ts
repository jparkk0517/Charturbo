import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Donut with center total',
  description: 'The center label shows the visible total, or the hovered slice. Legend clicks hide slices.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderPieChart(
    { labels: ['Compute', 'Storage', 'Network', 'Support'], values: [52_000, 21_000, 9_500, 4_200] },
    { title: 'Cloud spend', donut: 0.62, centerLabel: 'Total', labels: 'percent', format: (v) => `$${Math.round(v).toLocaleString('en-US')}` }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
