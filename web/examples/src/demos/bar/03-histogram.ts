import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Histogram of 500k samples',
  description: 'O(n) binning in Rust (Freedman–Diaconis rule by default).',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  // Bimodal sample (Box-Muller)
  const values = new Float32Array(500_000);
  for (let i = 0; i < values.length; i++) {
    const r = Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
    values[i] = i % 3 === 0 ? 72 + r * 6 : 45 + r * 9;
  }
  const bins = sdk.renderHistogram(values, { bins: 'auto', title: 'Response time (ms)' });
  console.info(`${bins.binCount} bins (${bins.rule})`);
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
