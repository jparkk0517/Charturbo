import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Legend position and paging',
  description: "legend.position puts the legend on any side; entries beyond one row page behind ‹ › (overflow: 'wrap' keeps the old wrapping).",
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const series = Array.from({ length: 16 }, (_, k) => ({
    name: `Sensor ${String.fromCharCode(65 + k)}`,
    values: Float32Array.from({ length: 2_000 }, (_, i) => Math.sin(i / 120 + k * 0.7) * 10 + k * 4),
  }));
  sdk.renderLineChart(series, { title: '16 sensors', legend: { position: 'bottom' } });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
