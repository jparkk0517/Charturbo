import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Loading indicator',
  description: 'showLoading masks the chart with a spinner and a status text, sets aria-busy and announces the text; hideLoading removes it. Rendering does not hide it. The spinner stays still under reduced motion.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const days = 30;
  let round = 0;
  const draw = () => {
    round++;
    const values = Array.from({ length: days }, (_, i) => 40 + Math.round(30 * Math.sin(i / 4 + round)));
    sdk.renderLineChart([{ name: 'Visits', values }], { title: `Daily visits (load ${round})` });
    sdk.render();
  };
  draw();
  sdk.enableNodeInteractions(canvas, { autoRender: true });

  const button = (label: string, run: () => void) => {
    const b = toolbar.appendChild(document.createElement('button'));
    b.textContent = label;
    b.onclick = run;
    return b;
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  button('Reload (1.5 s)', () => {
    if (timer) clearTimeout(timer);
    sdk.showLoading({ delay: 150 });
    timer = setTimeout(() => {
      timer = null;
      draw();
      sdk.hideLoading();
    }, 1500);
  });
  button('Toggle', () => (sdk.isLoading() ? sdk.hideLoading() : sdk.showLoading({ text: 'Fetching data…' })));
  return sdk;
}
