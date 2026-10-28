import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Nested rings',
  description: 'Two independent rings: percents, folding and labels per ring. "Direct" appears in both, so it shares one color and one legend entry.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderPieChart(
    {
      rings: [
        { name: 'Channel', labels: ['Direct', 'Marketing', 'Search engine'], values: [1548, 775, 679], radius: [0, 0.42] },
        {
          name: 'Source',
          labels: ['Baidu', 'Direct', 'Email', 'Google', 'Union ads', 'Bing', 'Video ads', 'Others'],
          values: [1048, 335, 310, 251, 234, 147, 135, 102],
          radius: [0.56, 0.86],
          maxSlices: false,
        },
      ],
    },
    { title: 'Access sources', format: (v) => `${v.toLocaleString('en-US')} visits` }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
