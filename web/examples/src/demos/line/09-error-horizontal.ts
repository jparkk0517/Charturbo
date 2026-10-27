import { Charturbo } from 'charturbo';

export const meta = {
  title: 'ErrorBar · horizontal intervals',
  description: 'Absolute low/high endpoints along X with categories on Y. Zoom into a whisker: it stays visible and pickable even when its center lies outside the viewport.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  sdk.renderErrorBarChart([
    { name: 'Estimate', x: [12, 20, 28, 36, 44, 52], values: [1, 2, 3, 4, 5, 6],
      low: [5, 8, 20, 26, 32, 40], high: [22, 35, 39, 50, 58, 70], direction: 'horizontal', capWidth: 16, showCenter: true, lineWidth: 2 },
  ], { title: 'Confidence intervals', axes: { x: { title: 'Effect' }, y: { title: 'Experiment' } } });
  sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
  sdk.render();
  return sdk;
}
