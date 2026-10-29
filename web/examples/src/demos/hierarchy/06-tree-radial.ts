import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Radial tree',
  description: 'layout: radial puts the root in the center and the leaves on the rim; labels rotate outward. colorBy: group colors each top-level branch.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', animation: { duration: 450, easing: 'ease-out' } });

  // Flat rows: { id, parent, name }
  const groups: Record<string, string[]> = {
    analytics: ['cluster', 'graph', 'optimization', 'stats'],
    animate: ['easing', 'interpolate', 'transition', 'tween', 'scheduler'],
    data: ['converters', 'schema', 'source', 'tuple'],
    display: ['dirty', 'line', 'rect', 'text'],
    query: ['aggregate', 'filter', 'group', 'sort', 'math'],
    scale: ['linear', 'log', 'ordinal', 'quantile', 'time'],
    vis: ['axis', 'controls', 'events', 'legend', 'operator'],
  };
  const rows: { id: string; parent?: string; name?: string }[] = [{ id: 'flare' }];
  for (const [group, kids] of Object.entries(groups)) {
    rows.push({ id: group, parent: 'flare' });
    for (const k of kids) rows.push({ id: `${group}/${k}`, parent: group, name: k });
  }
  sdk.renderTree(rows, { title: 'flare packages', layout: 'radial', colorBy: 'group', initialTreeDepth: -1 });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
