import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Sankey energy flows',
  description: 'd3-sankey style layout (column assignment, relaxation, collision resolution) in Rust; hover highlights connected flows.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const link = (source: string, target: string, value: number) => ({ source, target, value });
  sdk.renderSankey(
    {
      nodes: ['Coal', 'Gas', 'Solar', 'Wind', 'Electricity', 'Heat', 'Homes', 'Industry', 'Transport', 'Losses'].map((id) => ({ id })),
      links: [
        link('Coal', 'Electricity', 30), link('Coal', 'Heat', 12),
        link('Gas', 'Electricity', 22), link('Gas', 'Heat', 18), link('Gas', 'Transport', 6),
        link('Solar', 'Electricity', 14), link('Wind', 'Electricity', 16),
        link('Electricity', 'Homes', 28), link('Electricity', 'Industry', 26),
        link('Electricity', 'Transport', 8), link('Electricity', 'Losses', 20),
        link('Heat', 'Homes', 16), link('Heat', 'Industry', 10), link('Heat', 'Losses', 4),
      ],
    },
    { title: 'Energy (TWh)', format: ',.0f', linkColor: 'source', linkOpacity: 0.45 }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
