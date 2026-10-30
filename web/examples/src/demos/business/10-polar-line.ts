import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Polar line',
  description: 'Value angle (degrees) and value radius: a smooth closed curve with an area fill and markers, and a scatter series.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const curve = Array.from({ length: 36 }, (_, k) => [2 + Math.sin((k * 10 * Math.PI) / 45) * 1.2, k * 10]);
  const dots = Array.from({ length: 24 }, (_, k) => [1 + ((k * 37) % 23) / 6, (k * 53) % 360]);
  sdk.renderPolarChart(
    {
      series: [
        { type: 'line', name: 'Rose curve', data: curve, smooth: true, closed: true, area: true, symbolSize: 5 },
        { type: 'scatter', name: 'Samples', data: dots, symbolSize: 7 },
      ],
    },
    { title: 'Polar line and scatter', angleAxis: { min: 0, max: 360, splitNumber: 12, name: 'Angle' }, radiusAxis: { min: 0, max: 5, name: 'Radius' } }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
