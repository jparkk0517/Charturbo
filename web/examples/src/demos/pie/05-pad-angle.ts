import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Donut with pad angle',
  description: 'padAngle opens an angular gap between slices on top of the 2 px surface gap; angles and percents keep the unpadded layout.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderPieChart(
    { labels: ['Search', 'Direct', 'Email', 'Union ads', 'Video ads'], values: [1048, 735, 580, 484, 300] },
    { title: 'Access source', donut: 0.55, padAngle: 5, labels: 'outside' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
