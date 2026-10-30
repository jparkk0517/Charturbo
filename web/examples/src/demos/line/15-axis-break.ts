import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Broken y axis',
  description: 'Two `breaks` collapse empty value ranges into small gaps with zigzag marks. Ticks skip the collapsed ranges; hover, zoom and exports use the same mapping.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const n = 300;
  const load = Float32Array.from({ length: n }, (_, i) =>
    i < 100 ? 12 + 4 * Math.sin(i / 8) : i < 200 ? 220 + 6 * Math.cos(i / 11) : 620 + 8 * Math.sin(i / 14)
  );
  sdk.renderLineChart([{ name: 'Load', values: load }], {
    title: 'Load by phase',
    legend: false,
    axes: { y: { title: 'Requests / s', breaks: [{ start: 25, end: 205 }, { start: 235, end: 600 }] } },
  });
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
