import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Circular graph',
  description:
    'layout: circular puts the nodes on a ring, each slice sized by value; rotateLabel turns the labels outward. Curved edges take the color of their source and end in arrows.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  // Package imports: value = lines of code (k)
  const packages: [string, string, number][] = [
    ['core', 'Runtime', 42], ['scheduler', 'Runtime', 12], ['events', 'Runtime', 9], ['store', 'Runtime', 15],
    ['layout', 'Render', 28], ['paint', 'Render', 22], ['text', 'Render', 14], ['gpu', 'Render', 31],
    ['axes', 'Charts', 11], ['legend', 'Charts', 8], ['tooltip', 'Charts', 10], ['a11y', 'Charts', 13],
    ['cli', 'Tools', 6], ['devtools', 'Tools', 9], ['bench', 'Tools', 5],
  ];
  const imports: [string, string][] = [
    ['scheduler', 'core'], ['events', 'core'], ['store', 'core'], ['store', 'events'], ['layout', 'core'],
    ['paint', 'layout'], ['paint', 'gpu'], ['text', 'paint'], ['gpu', 'core'], ['axes', 'text'], ['axes', 'layout'],
    ['legend', 'text'], ['legend', 'events'], ['tooltip', 'text'], ['tooltip', 'events'], ['a11y', 'store'],
    ['a11y', 'tooltip'], ['cli', 'core'], ['devtools', 'store'], ['devtools', 'scheduler'], ['bench', 'gpu'], ['bench', 'cli'],
  ];
  sdk.renderGraph(
    {
      nodes: packages.map(([name, category, value]) => ({ name, category, value })),
      links: imports.map(([source, target]) => ({ source, target })),
    },
    {
      title: 'Package imports',
      layout: 'circular',
      rotateLabel: true,
      labels: true,
      symbolSize: [8, 20],
      curveness: 0.3,
      edgeSymbol: 'arrow',
      edgeColor: 'source',
      edgeOpacity: 0.6,
      valueLabel: 'kLOC',
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
