import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Rounded donut with pad angle',
  description: 'padAngle opens an angular gap between slices; cornerRadius rounds every corner in CSS px (shrunk on thin slices so corners never cross).',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderPieChart(
    { labels: ['Search', 'Direct', 'Email', 'Union ads', 'Video ads'], values: [1048, 735, 580, 484, 300] },
    { title: 'Access source', donut: 0.55, padAngle: 5, cornerRadius: 10, labels: 'outside' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
