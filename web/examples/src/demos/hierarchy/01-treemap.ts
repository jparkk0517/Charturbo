import { VizEngineSDK, type HierarchyNode } from 'viz-engine-sdk';

export const meta = {
  title: 'Treemap with drill-down',
  description: 'Squarified layout, labels and hit-testing in Rust. Click a group to drill in, the breadcrumb or Escape to go up.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  const regions = { Americas: 5, Europe: 4, Asia: 3.5, Africa: 1.2, Oceania: 0.8 };
  const tree: HierarchyNode = {
    name: 'Revenue',
    children: Object.entries(regions).map(([region, scale]) => ({
      name: region,
      children: ['Hardware', 'Software', 'Services'].map((category) => ({
        name: category,
        children: Array.from({ length: 3 }, (_, k) => ({
          name: `${category} ${k + 1}`,
          value: Math.round((20 + Math.random() * 80) * scale), // leaf values; parents = sum
        })),
      })),
    })),
  };
  sdk.renderTreemap(tree, { title: 'Revenue by region', format: '$,.0f', maxDepth: 2 });
  sdk.on('drill', (e) => console.info('drill', e.path.join(' › ')));
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
