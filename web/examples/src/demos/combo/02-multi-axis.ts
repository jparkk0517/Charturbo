import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Three y axes (finance)',
  description: 'Volume bars on the left axis, price on the right, RSI on an extra left axis with a fixed 0–100 domain (`axes.extraY`, series `yAxisIndex: 2`).',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const weeks = Array.from({ length: 16 }, (_, i) => `W${i + 1}`);
  const price = weeks.map((_, i) => 100 + i * 1.4 + 4 * Math.sin(i / 2));
  const volume = weeks.map((_, i) => 14 + 8 * Math.abs(Math.sin(i / 1.7)));
  const rsi = weeks.map((_, i) => 50 + 18 * Math.sin(i / 2.2));
  sdk.renderComboChart(
    {
      categories: weeks,
      series: [
        { name: 'Volume', type: 'bar', values: volume },
        { name: 'Price', type: 'line', yAxis: 'right', values: price, marker: { show: 'always' } },
        { name: 'RSI', type: 'line', yAxisIndex: 2, values: rsi, dash: [4, 3], color: '#e5a50a' },
      ],
    },
    {
      title: 'Price, volume and RSI',
      axes: {
        y: { title: 'Volume (M)', format: (v) => `${v.toFixed(0)}M` },
        y2: { title: 'Price ($)', format: (v) => `$${v.toFixed(2)}` },
        extraY: [{ title: 'RSI', position: 'left', min: 0, max: 100, nice: false, color: '#e5a50a' }],
      },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
