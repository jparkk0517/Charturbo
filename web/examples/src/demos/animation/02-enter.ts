import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Line reveal and pie enter',
  description: 'Lines reveal left to right through a scissor rectangle (no geometry change); pies fade and scale in.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });
  sdk.setAnimation({ duration: 900, easing: 'ease-in-out' }); // true = 400 ms ease-out, false = off

  const values = Float32Array.from({ length: 2_000 }, (_, i) => Math.sin(i / 90) * 30 + Math.sin(i / 13) * 6);
  const showLine = () => {
    sdk.renderLineChart([{ name: 'Signal', values }], { title: 'Reveal' });
    sdk.render();
  };
  const showPie = () => {
    sdk.renderPieChart({ labels: ['A', 'B', 'C', 'D'], values: [40, 30, 20, 10] }, { title: 'Pie enter', donut: 0.5 });
    sdk.render();
  };
  for (const [label, run] of [['Replay line', showLine], ['Pie', showPie]] as const) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = label;
    button.onclick = run;
  }
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  showLine();
  return sdk;
}
