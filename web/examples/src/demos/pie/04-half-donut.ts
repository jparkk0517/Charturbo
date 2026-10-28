import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Half donut',
  description: 'endAngle limits the sweep to the top half; the chart is framed to the half ring, so it fills the card.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderPieChart(
    { labels: ['Chrome', 'Safari', 'Edge', 'Firefox', 'Other'], values: [1048, 735, 580, 484, 300] },
    { title: 'Browser share', donut: 0.55, startAngle: -90, endAngle: 90, labels: 'outside', centerLabel: 'Sessions' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
