import { Charturbo } from 'charturbo';
import { createDemoPlayback } from '../../demo-playback';

export const meta = {
  title: 'Streaming surface · rolling field',
  description: 'updateSurface3D appends column-major height strips. The oldest column is dropped and xStart advances while the 49 × 33 window and orbit stay fixed. CSV and tooltips retain the moving raw X coordinate.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const button = host.appendChild(document.createElement('button'));
  button.type = 'button';
  const canvas = host.appendChild(document.createElement('canvas'));
  canvas.style.height = 'calc(100% - 32px)';
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', nodeCount: 0, edgeCount: 0 });
  const columns = 49, rows = 33, step = 0.125;
  let nextColumn = columns;
  const height = (c: number, r: number) => Math.sin(c * step * 2) * Math.cos((r - 16) * step) + Math.cos(c * step * 0.7) * 0.3;
  sdk.renderSurface3D([{ name: 'Height', data: { columns, rows, xStart: 0, xStep: step, zStart: -2, zStep: step,
    y: Float32Array.from({ length: columns * rows }, (_, i) => height(i % columns, Math.floor(i / columns))) },
    colormap: 'magma', yMin: -1.3, yMax: 1.3 }], { title: 'Rolling height field · 49 × 33' });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  let elapsed = 0;
  const playback = createDemoPlayback(host, delta => {
    elapsed += delta;
    if (elapsed < 100) return;
    elapsed %= 100;
    sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 1, y: Float32Array.from({ length: rows }, (_, r) => height(nextColumn, r)) });
    nextColumn++;
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
