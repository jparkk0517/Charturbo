import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Impulse · independent event stems',
  description: 'Positive, negative and zero-length stems from a custom baseline. Tip markers are optional; no line decimation or connections between events.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const x = Float64Array.from({ length: 80 }, (_, i) => i * 1.3);
  const values = Float32Array.from(x, (v, i) => i % 13 === 0 ? 5 : 5 + Math.sin(v * 0.4) * 20 * Math.exp(-v / 100));
  values[37] = NaN;
  sdk.renderImpulseChart([
    { name: 'Events', x, values, baseline: 5, symbolSize: 5 },
    { name: 'Reference', x, values: values.map(v => v / 2 - 25), baseline: -25, showMarker: false, lineWidth: 1 },
  ], { title: 'Event response', axes: { x: { title: 'Time (s)' }, y: { title: 'Amplitude' } } });
  sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
  sdk.render();
  return sdk;
}
