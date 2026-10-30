import { Charturbo, type HierarchyNode } from 'charturbo';

export const meta = {
  title: 'Treemap to sunburst transition',
  description: 'animation.transition: every treemap cell morphs into the sunburst arc with the same node path, and back.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const tree: HierarchyNode = {
    name: 'Revenue',
    children: Object.entries({ Americas: 5, Europe: 4, Asia: 3.5, Oceania: 1 }).map(([region, scale]) => ({
      name: region,
      children: ['Hardware', 'Software', 'Services'].map((category) => ({
        name: category,
        value: Math.round((20 + Math.random() * 80) * scale),
      })),
    })),
  };
  const animation = { duration: 900, easing: 'ease-in-out' as const, transition: true };
  let sunburst = false;
  const draw = () => {
    if (sunburst) sdk.renderSunburst(tree, { title: 'Revenue by region', animation });
    else sdk.renderTreemap(tree, { title: 'Revenue by region', animation });
    sdk.render();
  };
  const toggle = toolbar.appendChild(document.createElement('button'));
  toggle.textContent = 'Treemap / sunburst';
  toggle.onclick = () => {
    sunburst = !sunburst;
    draw();
  };
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return sdk;
}
