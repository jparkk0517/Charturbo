import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Graph on cartesian axes',
  description:
    'layout: cartesian places each node at its x / y on chart axes: a category x axis (quarters) and a value y axis with gridlines. Links with arrows show which project fed the next.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  // Projects: quarter, revenue ($M), stage
  const projects: [string, string, number, string][] = [
    ['Pilot', 'Q1', 1.2, 'Research'], ['Prototype', 'Q1', 2.1, 'Research'],
    ['Beta', 'Q2', 3.4, 'Build'], ['SDK', 'Q2', 2.6, 'Build'],
    ['Launch', 'Q3', 6.8, 'Market'], ['Partners', 'Q3', 4.9, 'Market'],
    ['Enterprise', 'Q4', 9.5, 'Scale'], ['Marketplace', 'Q4', 7.2, 'Scale'],
  ];
  const fed: [string, string][] = [
    ['Pilot', 'Beta'], ['Prototype', 'Beta'], ['Prototype', 'SDK'], ['Beta', 'Launch'],
    ['SDK', 'Partners'], ['Launch', 'Enterprise'], ['Partners', 'Marketplace'], ['Launch', 'Marketplace'],
  ];
  sdk.renderGraph(
    {
      nodes: projects.map(([name, x, y, category]) => ({ name, x, y, category, value: y })),
      links: fed.map(([source, target]) => ({ source, target })),
    },
    {
      title: 'Project roadmap',
      layout: 'cartesian',
      xAxis: { categories: ['Q1', 'Q2', 'Q3', 'Q4'] },
      yAxis: { min: 0, title: 'Revenue', format: '$,.1f' },
      format: '$,.1f',
      symbolSize: 14,
      labels: true,
      edgeSymbol: 'arrow',
      lineWidth: 1.5,
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
