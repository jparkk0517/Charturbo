import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Piecewise colors (air quality)',
  description:
    'pieces color the line by value bands (ECharts visualMap pieces): it switches color exactly where it crosses 50 / 100 / 150 / 200 / 300, at any zoom; markers and the tooltip swatch follow.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', timeZone: 'UTC' });

  // Two years of daily AQI: a winter-heavy season plus weather swings
  const day = 86_400_000;
  const t0 = Date.UTC(2024, 0, 1);
  const n = 731;
  const x = Float64Array.from({ length: n }, (_, i) => t0 + i * day);
  const aqi = Float32Array.from({ length: n }, (_, i) => {
    const season = 95 + 60 * Math.cos((i / 365.25) * 2 * Math.PI);
    const weather = 45 * Math.sin(i * 0.37) + 30 * Math.sin(i * 0.113 + 1) + 22 * Math.sin(i * 1.9 + 2);
    return Math.max(8, season + weather);
  });

  sdk.renderLineChart(
    [
      {
        name: 'AQI',
        values: aqi,
        x,
        lineWidth: 1.5,
        marker: { size: 5 },
        pieces: [
          { lte: 50, color: '#2e9e4f' },
          { gt: 50, lte: 100, color: '#e0b100' },
          { gt: 100, lte: 150, color: '#f07c1e' },
          { gt: 150, lte: 200, color: '#d93434' },
          { gt: 200, lte: 300, color: '#8e3fa8' },
          { gt: 300, color: '#7e0023' },
        ],
      },
    ],
    {
      title: 'Daily air quality index',
      axes: { x: { type: 'time' }, y: { title: 'AQI' } },
      hover: { mode: 'index', crosshair: true },
      legend: false,
    }
  );
  sdk.setAnnotations([50, 100, 150, 200, 300].map((y) => ({ type: 'hline' as const, y, dash: true })));
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
