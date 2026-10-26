import { VizEngineSDK, type HeatmapColorScale } from 'viz-engine-sdk';

export const meta = {
  title: 'Heatmap with color bar',
  description: 'Values upload once as an R32Float texture; switching the color scale only re-uploads a 1 KB LUT.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  const cols = 90; // days
  const rows = 24; // hours
  const values = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const daily = Math.exp(-((r - 14) ** 2) / 18); // afternoon peak
      const weekly = c % 7 < 5 ? 1 : 0.45; // weekends
      values[r * cols + c] = 20 + 180 * daily * weekly * (0.8 + 0.2 * Math.sin(c / 9)) + Math.random() * 12;
    }
  }
  sdk.renderHeatmap(
    {
      cols,
      rows,
      values, // row-major, NaN = empty cell
      xLabels: Array.from({ length: cols }, (_, c) => `Day ${c + 1}`),
      yLabels: Array.from({ length: rows }, (_, r) => `${String(r).padStart(2, '0')}:00`),
    },
    { title: 'Load by hour', valueLabel: 'Load', colorScale: 'sequential', colorbar: { title: 'req/s', format: (v) => v.toFixed(0) } }
  );
  for (const scale of ['sequential', 'viridis', 'magma', 'diverging'] satisfies HeatmapColorScale[]) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = scale;
    button.onclick = () => {
      sdk.setHeatmapColorScale(scale);
      sdk.render();
    };
  }
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
