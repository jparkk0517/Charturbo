import { createDemoPlayback } from './demo-playback';

const host = document.querySelector<HTMLElement>('[data-live-demo]')!;
const canvas = host.querySelector<HTMLCanvasElement>('canvas')!;
const poster = host.querySelector<SVGElement>('[data-demo-poster]')!;
const button = host.querySelector<HTMLButtonElement>('[data-demo-motion]')!;
const status = host.querySelector<HTMLElement>('[data-demo-status]')!;
const motion = matchMedia('(prefers-reduced-motion: reduce)');
let disposed = false;
let loading = false;
let cleanup: (() => void) | undefined;

async function load() {
  if (loading || disposed) return;
  loading = true;
  observer?.disconnect();
  status.textContent = 'Loading live renderer…';
  try {
    const { createStreamingArea } = await import('./streaming-area');
    if (disposed) return;
    // Keep a measurable canvas during GPU initialization, behind the static preview.
    canvas.hidden = false;
    canvas.style.visibility = 'hidden';
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    const chart = await createStreamingArea(canvas);
    if (disposed) { chart.dispose(); return; }
    poster.style.display = 'none';
    canvas.style.visibility = '';
    const playback = createDemoPlayback(host, (delta) => {
      try { chart.tick(delta); } catch { fail(); }
    });
    const updateControl = () => {
      button.textContent = playback.paused ? 'Play demo' : 'Pause demo';
      status.textContent = `${playback.paused ? 'Paused' : 'Live'} · 3 signals · 600 samples per signal`;
    };
    const toggle = () => { playback.setPaused(!playback.paused); updateControl(); };
    const preferenceChanged = () => { if (motion.matches) playback.setPaused(true); updateControl(); };
    button.addEventListener('click', toggle);
    motion.addEventListener('change', preferenceChanged);
    button.disabled = false;
    updateControl();
    cleanup = () => {
      playback.dispose();
      chart.dispose();
      button.removeEventListener('click', toggle);
      motion.removeEventListener('change', preferenceChanged);
    };
  } catch { fail(); }
}

function fail() {
  cleanup?.();
  cleanup = undefined;
  poster.style.display = '';
  canvas.hidden = true;
  button.disabled = true;
  button.textContent = 'Play demo';
  status.textContent = 'Static preview · live rendering unavailable in this browser';
}

const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver((entries) => {
  if (entries.some((entry) => entry.isIntersecting)) void load();
});
observer?.observe(host);
if (!observer) void load();
const dispose = () => { disposed = true; observer?.disconnect(); cleanup?.(); cleanup = undefined; };
window.addEventListener('pagehide', dispose, { once: true });
// A back-forward cache restore must create fresh resources after pagehide cleanup.
window.addEventListener('pageshow', (event) => {
  if (event.persisted) { disposed = false; loading = false; void load(); }
});
if (import.meta.hot) import.meta.hot.dispose(dispose);
