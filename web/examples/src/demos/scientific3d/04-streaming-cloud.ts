import { Charturbo } from 'charturbo';
import { createDemoPlayback } from '../../demo-playback';

export const meta = {
  title: 'Streaming XYZ · bounded scan',
  description: 'appendPointCloud3D adds colored XYZ batches and retains the newest 2,400 samples. Orbit and legend state survive each update. Pause, hidden tabs, off-screen charts and reduced motion stop the clock.',
  height: 420,
};

export default async function mount(host: HTMLElement) {
  const button = host.appendChild(document.createElement('button'));
  button.type = 'button';
  const canvas = host.appendChild(document.createElement('canvas'));
  canvas.style.height = 'calc(100% - 32px)';
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', nodeCount: 0, edgeCount: 0 });
  let sample = 0;
  const batch = (count: number) => {
    const data = new Float32Array(count * 3), values = new Float32Array(count);
    for (let i = 0; i < count; i++, sample++) {
      const t = sample * 0.025, y = Math.sin(t * 0.31);
      data.set([Math.cos(t) * (1 + y * 0.3), y, Math.sin(t) * (1 + y * 0.3)], i * 3);
      values[i] = y;
    }
    return { data, values };
  };
  const initial = batch(2400);
  sdk.renderPointCloud3D([{ name: 'Scan', data: initial.data, colorBy: { values: initial.values, min: -1, max: 1 }, size: 4 }], { title: 'Live XYZ scan · FIFO 2,400' });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  let elapsed = 0;
  const playback = createDemoPlayback(host, delta => {
    elapsed += delta;
    if (elapsed < 100) return;
    elapsed %= 100;
    const next = batch(40);
    sdk.appendPointCloud3D(0, next.data, { colorValues: next.values, maxPoints: 2400 });
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
