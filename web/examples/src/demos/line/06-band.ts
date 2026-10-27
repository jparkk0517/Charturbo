import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Band · 100,000 paired samples',
  description: 'Independent range bands with two boundary strokes. Both-edge extrema survive LOD; missing pairs leave gaps. Wheel to zoom, drag to pan, or use the arrow keys.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', timeZone: 'UTC' });
  const n = 100_000;
  const x = Float64Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 1) + i * 60_000);
  const lower = Float32Array.from({ length: n }, (_, i) => 40 + Math.sin(i / 4500) * 14 - 6 - Math.sin(i / 37) * 2);
  const upper = Float32Array.from({ length: n }, (_, i) => 40 + Math.sin(i / 4500) * 14 + 6 + Math.cos(i / 51) * 2);
  lower[18_023] = 5;
  upper[75_017] = 80;
  lower.fill(NaN, 45_000, 47_000);
  sdk.renderBandChart([{ name: 'Expected range', x, lower, upper, lowerLineWidth: 1.5, upperLineWidth: 1.5 }], {
    title: 'Signal envelope', fillOpacity: 0.3, axes: { x: { type: 'time' }, y: { title: 'Signal' } },
  });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
