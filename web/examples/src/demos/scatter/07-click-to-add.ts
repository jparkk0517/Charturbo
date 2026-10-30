import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Click to add scatter points',
  description: 'With `editable.addOnClick`, a click on an empty part of the plot adds a point to the chosen series; drag any point to move it in x and y. The zoom window and legend state are kept.',
};

export default async function mount(host: HTMLElement) {
  const status = host.appendChild(document.createElement('div'));
  status.className = 'toolbar';
  status.textContent = 'Click the plot to add a point; drag a point to move it.';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const x = Float32Array.from([1.2, 2.5, 3.1, 4.8, 5.5, 6.9, 7.4, 8.8, 2.2, 3.9, 6.1, 8.1]);
  const y = Float32Array.from([2.1, 3.4, 2.8, 5.1, 4.6, 6.8, 6.1, 8.2, 6.5, 7.8, 2.4, 3.3]);
  const clusters = Uint16Array.from([0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1]);
  sdk.renderScatterChart({ x, y, clusters }, { title: 'Samples', seriesNames: ['Measured', 'Outliers'], pointRadius: 6 });
  sdk.enableNodeInteractions(canvas, { autoRender: true, editable: { dragAxis: 'xy', addOnClick: true, addSeries: 0 } });
  sdk.on('pointAdd', (e) => {
    const count = sdk.getSeriesData(0)?.x.length ?? 0;
    status.textContent = `Added (${e.value.x.toFixed(2)}, ${e.value.y.toFixed(2)}): ${count} measured points.`;
  });
  sdk.on('pointDragEnd', (e) => {
    if (!e.cancelled) status.textContent = `Moved to (${e.newValue.x.toFixed(2)}, ${e.newValue.y.toFixed(2)}).`;
  });
  sdk.render();
  return sdk;
}
