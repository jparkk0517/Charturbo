import { Charturbo } from 'charturbo';

export const meta = {
  title: '60k-point scatter with brush selection',
  description: 'Drag a rectangle to select (Alt + drag pans, wheel zooms x/y). Selection queries run on the engine’s spatial hash.',
};

export default async function mount(host: HTMLElement) {
  const status = host.appendChild(document.createElement('div'));
  status.className = 'toolbar';
  status.textContent = 'Drag on the plot to select points.';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const n = 60_000;
  const centers = [[-2, -1], [1.5, 1], [0, 2.5]];
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const clusters = new Uint16Array(n);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
  for (let i = 0; i < n; i++) {
    const c = i % 3;
    clusters[i] = c; // series id
    x[i] = centers[c][0] + gauss() * 0.8;
    y[i] = centers[c][1] + gauss() * 0.7;
  }
  sdk.renderScatterChart(
    { x, y, clusters },
    { title: 'Clusters', seriesNames: ['Alpha', 'Beta', 'Gamma'], pointRadius: 1.8, opacity: 0.8 }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
  sdk.on('select', (sel) => {
    status.textContent = sel.xRange ? `${sel.count.toLocaleString()} points selected` : 'Selection cleared.';
  });
  sdk.render();
  return sdk;
}
