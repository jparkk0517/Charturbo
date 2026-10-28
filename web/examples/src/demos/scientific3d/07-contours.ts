import { Charturbo } from 'charturbo';
import { createDemoPlayback } from '../../demo-playback';

export const meta = {
  title: 'Surface3D · contours on a moving field',
  description: 'contours traces 10 isolines evenly inside the fixed yMin..yMax domain on the rendered triangles. updateSurface3D replaceY keeps the levels, holes and orbit while the lines follow the new heights. Lines behind ridges stay hidden.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const button = host.appendChild(document.createElement('button'));
  button.type = 'button';
  const canvas = host.appendChild(document.createElement('canvas'));
  canvas.style.height = 'calc(100% - 32px)';
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', nodeCount: 0, edgeCount: 0 });
  const columns = 61, rows = 61, step = 0.1;
  const field = (t: number) => Float32Array.from({ length: columns * rows }, (_, i) => {
    const x = (i % columns - 30) * step, z = (Math.floor(i / columns) - 30) * step;
    if (Math.hypot(x - 1.6, z + 1.4) < 0.5) return NaN;
    return Math.sin(x * 1.3 + t) * Math.cos(z * 1.1 - t * 0.6) * Math.exp(-(x * x + z * z) / 12);
  });
  sdk.renderSurface3D([{ name: 'Height', data: { columns, rows, xStart: -3, xStep: step, zStart: -3, zStep: step, y: field(0) },
    colormap: 'viridis', yMin: -1, yMax: 1, lighting: 0.45,
    contours: { show: true, levels: 10, color: '#f8fafc', width: 2, opacity: 0.9 } }],
  { title: 'Isolines · 61 × 61', aspect: [1, 0.45, 1], axes3d: { y: { min: -1, max: 1, tickCount: 3, name: 'Height' } } });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  let t = 0;
  const playback = createDemoPlayback(host, delta => {
    t += delta / 1000;
    sdk.updateSurface3D(0, { mode: 'replaceY', y: field(t) });
    sdk.render();
  });
  const update = () => { button.textContent = playback.paused ? 'Play demo' : 'Pause demo'; };
  const toggle = () => { playback.setPaused(!playback.paused); update(); };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener('change', update);
  button.addEventListener('click', toggle);
  update();
  return { sdk, dispose() {
    playback.dispose(); sdk.dispose();
    motion.removeEventListener('change', update);
    button.removeEventListener('click', toggle);
  } };
}
