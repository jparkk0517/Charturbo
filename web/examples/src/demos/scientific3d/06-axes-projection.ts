import { Charturbo, type Scientific3DChartOptions } from 'charturbo';

export const meta = {
  title: 'Axes · data aspect · orthographic',
  description: 'A 120 × 40 × 20 measurement volume. Compare equal data units with cube normalization, or perspective with parallel projection. Fixed domains remain stable while orbiting and zooming.',
  height: 460,
};

export default async function mount(host: HTMLElement) {
  const controls = host.appendChild(document.createElement('div'));
  const aspect = controls.appendChild(document.createElement('select'));
  aspect.setAttribute('aria-label', '3D aspect');
  for (const [value, label] of [['data', 'Equal data units'], ['cube', 'Cube normalization']]) {
    const option = aspect.appendChild(document.createElement('option')); option.value = value; option.textContent = label;
  }
  const projection = controls.appendChild(document.createElement('select'));
  projection.setAttribute('aria-label', '3D projection');
  for (const value of ['orthographic', 'perspective']) {
    const option = projection.appendChild(document.createElement('option')); option.value = value; option.textContent = value;
  }
  const canvas = host.appendChild(document.createElement('canvas'));
  canvas.style.height = 'calc(100% - 32px)';
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', nodeCount: 0, edgeCount: 0 });
  const data = new Float32Array(4000 * 3);
  for (let i = 0; i < 4000; i++) {
    const t = i / 3999, angle = t * Math.PI * 24;
    data.set([t * 120, 20 + Math.sin(angle) * 20, 10 + Math.cos(angle) * 10], i * 3);
  }
  const draw = () => {
    const options: Scientific3DChartOptions = {
      title: 'Measured helix · fixed XYZ domains', aspect: aspect.value as 'data' | 'cube',
      axes3d: { x: { min: 0, max: 120, tickCount: 4 }, y: { min: 0, max: 40, tickCount: 3 }, z: { min: 0, max: 20, tickCount: 3 } },
      camera: { type: projection.value as 'orthographic' | 'perspective' },
    };
    sdk.renderPointCloud3D([{ name: 'Scan', data, size: 4, colorBy: { values: Float32Array.from({ length: 4000 }, (_, i) => i) } }], options);
    sdk.render();
  };
  aspect.addEventListener('change', draw); projection.addEventListener('change', draw);
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return { sdk, dispose() {
    aspect.removeEventListener('change', draw); projection.removeEventListener('change', draw); sdk.dispose();
  } };
}
