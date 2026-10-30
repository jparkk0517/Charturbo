import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Polar heatmap',
  description: 'Hour of day around the angle axis, weekday on the radius axis: one colormap cell each, with a colorbar.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cells = days.flatMap((_, d) =>
    hours.map((_, h) => [d, h, Math.round(20 + 60 * Math.max(0, Math.sin(((h - 6) * Math.PI) / 14)) * (d < 5 ? 1 : 0.6) + ((d * 7 + h * 3) % 11))])
  );
  sdk.renderPolarChart(
    { series: [{ type: 'heatmap', name: 'Load', data: cells }] },
    {
      title: 'Requests by hour and weekday',
      angleAxis: { data: hours, name: 'Hour' },
      radiusAxis: { data: days, name: 'Day' },
      innerRadius: 0.2,
      colorScale: 'viridis',
      valueLabel: 'Requests',
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
