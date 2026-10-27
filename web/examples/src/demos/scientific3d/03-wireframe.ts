import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Surface3D · wireframe',
  description: 'Grid edges colored by height. Hover selects the underlying grid cell; drag to inspect the surface from another angle.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', nodeCount: 0, edgeCount: 0 });
  const y = Float32Array.from({ length: 21 * 21 }, (_, i) => Math.sin((i % 21) / 4) + Math.cos(Math.floor(i / 21) / 4));
  sdk.renderSurface3D([{ name: 'Grid', data: { columns: 21, rows: 21, xStart: -10, xStep: 1, zStart: -10, zStep: 1, y }, wireframe: true }],
    { title: 'Wireframe height grid', showGrid: false });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
