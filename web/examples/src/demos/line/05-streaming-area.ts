import { createStreamingArea } from '../../streaming-area';
import { createDemoPlayback } from '../../demo-playback';

export const meta = {
  title: 'Atomic area streaming',
  description: 'appendAreaData adds all three series together. The FIFO retains 600 samples per series. Pause, reduced motion, hidden tabs and off-screen charts stop the clock.',
  height: 380,
};

export default async function mount(host: HTMLElement) {
  const button = host.appendChild(document.createElement('button'));
  button.type = 'button';
  const canvas = host.appendChild(document.createElement('canvas'));
  canvas.style.height = 'calc(100% - 32px)';
  const chart = await createStreamingArea(canvas);
  const playback = createDemoPlayback(host, chart.tick);
  const update = () => { button.textContent = playback.paused ? 'Play demo' : 'Pause demo'; };
  const toggle = () => { playback.setPaused(!playback.paused); update(); };
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  motion.addEventListener('change', update);
  button.addEventListener('click', toggle);
  update();
  return {
    sdk: chart.sdk,
    dispose() {
      playback.dispose();
      chart.dispose();
      motion.removeEventListener('change', update);
      button.removeEventListener('click', toggle);
    },
  };
}
