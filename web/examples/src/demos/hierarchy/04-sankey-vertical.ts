import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Vertical sankey with gradient links and levels',
  description: 'orient: vertical runs the flow top to bottom; ribbons blend the source into the target color; levels set a column color and link opacity.',
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
    {
      title: 'Energy (TWh)',
      format: ',.0f',
      orient: 'vertical',
      linkColor: 'gradient',
      levels: [
        { column: 0, linkOpacity: 0.65 },
        { column: 2, color: '#64748b' },
      ],
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
