import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Band · crossing curves',
  description: 'Two independent curves can exchange order. Fill splits at each crossing; tooltips and CSV retain the original edge values. Shift-drag to select ranges.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas);
  const x = Float64Array.from({ length: 121 }, (_, i) => i / 10);
  const lower = Float32Array.from(x, (v) => Math.sin(v) * 20);
  const upper = Float32Array.from(x, (v) => Math.cos(v) * 20);
  sdk.renderBandChart([{ name: 'Phase difference', x, lower, upper, lowerLineWidth: 2, upperLineWidth: 2 }], {
    title: 'Two phases', fillOpacity: 0.35, axes: { x: { title: 'Time (s)' }, y: { title: 'Amplitude' } },
  });
  sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
  sdk.render();
  return sdk;
}
