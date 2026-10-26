import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: '1,000,000-point line',
  description: 'M4 decimation per pixel column in Rust keeps every spike. Wheel = zoom, drag = pan, double-click = reset.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  const n = 1_000_000;
  const values = new Float32Array(n);
  let walk = 0;
  for (let i = 0; i < n; i++) {
    walk += (Math.random() - 0.5) * 0.4;
    values[i] = walk + Math.sin(i / 25_000) * 30;
  }
  for (let i = 60_000; i < n; i += 180_000) values[i] += 45; // spikes survive decimation

  sdk.renderLineChart([{ name: 'Sensor', values }], {
    title: '1M samples',
    axes: { x: { title: 'Sample', format: '.2s' }, y: { format: '.1f' } },
  });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
