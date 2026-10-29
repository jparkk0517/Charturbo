import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Chord diagram',
  description: 'd3-chord layout in Rust: one arc per group sized by its total flow, ribbons between groups. Hover a group to light its ribbons; click a legend entry to hide a group and re-lay out.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', animation: { duration: 450, easing: 'ease-out' } });

  // Hair color survey (the d3-chord example): row = respondent, column = partner
  sdk.renderChordChart(
    {
      names: ['Black', 'Blond', 'Brown', 'Red'],
      matrix: [
        [11975, 5871, 8916, 2868],
        [1951, 10048, 2060, 6171],
        [8010, 16145, 8090, 8045],
        [1013, 990, 940, 6907],
      ],
    },
    { title: 'Hair color preferences', colors: ['#3b3b3b', '#e7c06a', '#8a5a33', '#d0563b'], format: ',.0f' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
