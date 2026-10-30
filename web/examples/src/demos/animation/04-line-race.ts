import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Line race',
  description: 'Lines grow along x (a long reveal) while endLabel pins each series name and its value to the moving line end.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const walk = (drift: number) => {
    let v = 100;
    return Float32Array.from({ length: 120 }, () => (v *= 1 + drift + (Math.random() - 0.5) * 0.04));
  };
  const draw = () => {
    sdk.renderLineChart(
      [
        { name: 'Alpha', values: walk(0.006) },
        { name: 'Beta', values: walk(0.004) },
        { name: 'Gamma', values: walk(0.008) },
      ],
      {
        title: 'Index race',
        legend: false,
        endLabel: { format: (value, name) => `${name} ${value.toFixed(0)}` },
        animation: { duration: 4000, easing: 'linear' },
      }
    );
    sdk.render();
  };
  const replay = toolbar.appendChild(document.createElement('button'));
  replay.textContent = 'Replay';
  replay.onclick = draw;
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return sdk;
}
