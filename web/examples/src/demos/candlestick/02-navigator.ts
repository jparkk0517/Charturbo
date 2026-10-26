import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Range navigator',
  description: 'Drag the window or its handles in the strip under the plot; the rangechange event reports the visible x range.',
};

export default async function mount(host: HTMLElement) {
  const status = host.appendChild(document.createElement('div'));
  status.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US', timeZone: 'UTC' });

  const n = 20_000;
  const minute = 60_000;
  const x = Float64Array.from({ length: n }, (_, i) => Date.UTC(2026, 2, 1) + i * minute);
  let level = 60;
  const cpu = Float32Array.from({ length: n }, (_, i) => {
    level += (Math.random() - 0.5) * 2;
    level = Math.min(95, Math.max(10, level));
    return level + Math.sin(i / 720) * 10;
  });
  sdk.renderLineChart([{ name: 'CPU %', values: cpu, x }], {
    title: 'CPU, 2 weeks @ 1 min',
    axes: { x: { type: 'time' }, y: { min: 0, max: 100 } },
    navigator: { height: 48 },
    legend: false,
  });
  sdk.on('rangechange', ({ xMin, xMax }) => {
    status.textContent = `Visible: ${new Date(xMin).toISOString().slice(0, 16)} → ${new Date(xMax).toISOString().slice(0, 16)} UTC`;
  });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.setXRange(x[n - 3_000], x[n - 1]);
  sdk.render();
  return sdk;
}
