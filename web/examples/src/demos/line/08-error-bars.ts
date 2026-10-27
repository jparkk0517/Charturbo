import { Charturbo } from 'charturbo';

export const meta = {
  title: 'ErrorBar · measurement uncertainty',
  description: 'Independent whiskers with asymmetric errors, a missing sample, and one-sided cap-only bounds. Hover a stem or cap, use the arrow keys, or Shift-drag to select.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const x = Float64Array.from({ length: 24 }, (_, i) => i + 1);
  const values = Float32Array.from(x, v => 40 + Math.sin(v / 3) * 12);
  values[11] = NaN;
  sdk.renderErrorBarChart([
    { name: 'Measurement', x, values, errorLow: 4, errorHigh: Float32Array.from(x, v => 6 + v / 8), capWidth: 12, showCenter: true },
    { name: 'Upper bounds', x, values: values.map(v => v + 20), error: 5, errorMode: 'high', drawConnector: false, capWidth: '55%' },
  ], { title: 'Measured signal ± uncertainty', axes: { x: { title: 'Sample' }, y: { title: 'Signal' } } });
  sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
  sdk.render();
  return sdk;
}
