import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Three y axes (weather)',
  description: 'Series bind to axes by `yAxisIndex`: temperature left, rain right, pressure on an extra colored axis. Each axis scales on its own; tooltips format values per axis.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const hours = 24 * 7;
  const x = Float64Array.from({ length: hours }, (_, i) => Date.UTC(2026, 5, 1) + i * 3_600_000);
  const temp = Float32Array.from(x, (_, i) => 18 + 6 * Math.sin((i / 24) * Math.PI * 2 - 1.8) + 2 * Math.sin(i / 40));
  const rain = Float32Array.from(x, (_, i) => Math.max(0, 4 * Math.sin(i / 9) + 2 * Math.sin(i / 3.3) - 1.5));
  const pressure = Float32Array.from(x, (_, i) => 1012 + 6 * Math.cos(i / 30));
  sdk.renderLineChart(
    [
      { name: 'Temperature', x, values: temp },
      { name: 'Rain', x, values: rain, yAxis: 'right' },
      { name: 'Pressure', x, values: pressure, yAxisIndex: 2, color: '#c2410c' },
    ],
    {
      title: 'One week of weather',
      axes: {
        x: { type: 'time' },
        y: { title: 'Temperature (°C)', format: (v) => `${v.toFixed(1)}°` },
        y2: { title: 'Rain (mm)', min: 0, format: (v) => `${v.toFixed(1)} mm` },
        extraY: [{ title: 'Pressure (hPa)', color: '#c2410c', format: (v) => v.toFixed(0) }],
      },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
