import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Surface3D · height field with a hole',
  description: 'Y-up heights on a row-major XZ grid. Missing vertices remove complete cells. Pointer tooltips report the ray intersection; keyboard navigation and CSV report original vertices.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', nodeCount: 0, edgeCount: 0 });
  const columns = 49, rows = 49;
  const y = Float32Array.from({ length: columns * rows }, (_, i) => {
    const x = (i % columns - 24) / 8, z = (Math.floor(i / columns) - 24) / 8;
    return Math.hypot(x - 1, z - 0.5) < 0.45 ? NaN : Math.sin(x * 2) * Math.cos(z * 2) * Math.exp(-(x * x + z * z) / 8);
  });
  sdk.renderSurface3D([{ name: 'Height', data: { columns, rows, xStart: -3, xStep: 0.125, zStart: -3, zStep: 0.125, y }, colormap: 'magma' }],
    { title: 'Height field · Y-up' });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
