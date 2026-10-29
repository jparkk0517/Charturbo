import { Charturbo } from 'charturbo';

export const meta = {
  title: '100k rows × 8 dimensions',
  description: '700k line segments are uploaded once; a brush change re-uploads only the per-row flags. The toolbar shows build, brush and frame times.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const button = toolbar.appendChild(document.createElement('button'));
  button.textContent = 'random brush';
  const status = toolbar.appendChild(document.createElement('span'));
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const n = 100_000;
  const dims = 8;
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  const rows: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const base = gauss();
    // Correlated neighbors: the lines form bands instead of noise
    rows[i] = Array.from({ length: dims }, (_, d) => Math.round((base * (d % 2 ? -1 : 1) * 10 + gauss() * 6 + d * 5) * 100) / 100);
  }
  const time = (f: () => void) => {
    const s = performance.now();
    f();
    return performance.now() - s;
  };
  const build = time(() =>
    sdk.renderParallelChart(
      { dimensions: Array.from({ length: dims }, (_, d) => `D${d + 1}`), rows },
      { title: 'Synthetic 100k rows', opacity: 0.08, inactiveOpacity: 0.15, colorBy: 'D1' }
    )
  );
  let brush = NaN;
  let frame = time(() => sdk.render());
  const show = () => {
    const active = sdk.getParallelActiveRows().length.toLocaleString('en-US');
    status.textContent = ` build ${build.toFixed(0)} ms · brush ${Number.isNaN(brush) ? '–' : brush.toFixed(1)} ms · frame ${frame.toFixed(1)} ms · ${active} active rows`;
  };
  button.onclick = () => {
    const lo = Math.random() * 20;
    const axis = Math.floor(Math.random() * dims);
    brush = time(() => sdk.setParallelBrush([{ dimension: axis, range: [lo, lo + 15] }]));
    frame = time(() => sdk.render());
    show();
  };
  // Pointer brushing: the brush time is the event handler round trip of the last drag step
  let last = 0;
  canvas.addEventListener('pointermove', () => (last = performance.now()), { capture: true });
  sdk.on('parallelBrush', (e) => {
    if (e.source === 'pointer') brush = performance.now() - last;
    queueMicrotask(show);
  });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  show();
  return sdk;
}
