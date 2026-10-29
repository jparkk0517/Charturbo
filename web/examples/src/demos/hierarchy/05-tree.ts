import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Collapsible tree',
  description: 'Tidy tree layout in Rust (d3 tree()). Click a node, or press Enter / Space, to expand or collapse it; the tree re-lays out with a tween.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', animation: { duration: 450, easing: 'ease-out' } });

  const leaves = (...names: string[]) => names.map((name) => ({ name }));
  const tree = {
    name: 'charturbo',
    children: [
      {
        name: 'core',
        children: [
          { name: 'chart', children: leaves('line', 'bar', 'pie', 'heatmap', 'treemap', 'tree', 'sankey') },
          { name: 'scene', children: leaves('mesh', 'material', 'light', 'physics') },
          { name: 'graph', children: leaves('layout', 'barnes-hut', 'picking') },
          { name: 'svg', children: leaves('paths', 'text') },
        ],
      },
      {
        name: 'sdk',
        children: [
          { name: 'charturbo.ts' },
          { name: 'chart-a11y.ts' },
          { name: 'chart-export.ts' },
          // Starts collapsed whatever initialTreeDepth says
          { name: 'messages', collapsed: true, children: leaves('en', 'ko', 'zh-CN') },
        ],
      },
      { name: 'react', children: leaves('CharturboChart', 'useCharturboChart') },
      { name: 'vue', children: leaves('CharturboChart', 'useCharturboChart') },
    ],
  };
  // Levels 0-1 open: click core / sdk / react / vue to open the next level
  sdk.renderTree(tree, { title: 'Package layout', initialTreeDepth: 2 });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
