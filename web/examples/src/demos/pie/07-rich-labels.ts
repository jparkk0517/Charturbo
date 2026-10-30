import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Pie with rich text labels',
  description: 'label.formatter returns a two-line template: the name, then a bold percentage and a muted value. Leader-line spacing follows the measured labels.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  sdk.renderPieChart(
    { labels: ['Search', 'Direct', 'Social', 'Email', 'Ads'], values: [420, 260, 180, 90, 50] },
    {
      title: 'Traffic sources',
      labels: 'outside',
      label: {
        formatter: ({ name, value, percent }) => `{name|${name}}\n{pct|${percent.toFixed(1)}%} {value|${value} visits}`,
        rich: {
          name: { fontSize: 12, fontWeight: 600 },
          pct: { fontSize: 13, fontWeight: 'bold', color: '#3d7eff' },
          value: { fontSize: 10, color: '#8a94a6' },
        },
      },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
