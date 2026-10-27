import { Charturbo } from 'charturbo';

export const meta = {
  title: 'PointCloud3D · measured helix',
  description: '12,000 independent XYZ samples with scalar colors and fixed CSS-pixel diameters. Drag to orbit, right-drag to pan, wheel to zoom; arrow keys explore raw coordinates.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', nodeCount: 0, edgeCount: 0 });
  const n = 12000, xyz = new Float32Array(n * 3), values = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / n * Math.PI * 12, radius = 1 + Math.sin(i * 2.39996) * 0.12;
    xyz.set([Math.cos(t) * radius, i / n * 4 - 2, Math.sin(t) * radius], i * 3);
    values[i] = i / n;
  }
  sdk.renderPointCloud3D([
    { name: 'Scan', data: xyz, size: 3, colorBy: { values, colormap: 'viridis' } },
    { name: 'Reference', data: [[0, -2, 0], [0, 0, 0], [0, 2, 0]], color: '#fb923c', size: 10 },
  ], { title: 'Measured helix · XYZ' });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
