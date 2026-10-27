import { Charturbo } from 'charturbo';

export const meta = {
  title: 'OHLC bars · open left, close right',
  description: '50,000 minute bars with volume. Zoom out for OHLC aggregation; hover for bucket values, drag to pan, or use the arrow keys.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', timeZone: 'UTC' });
  const n = 50_000;
  const t = Float64Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 1) + i * 60_000);
  const [open, high, low, close, volume] = Array.from({ length: 5 }, () => new Float32Array(n));
  let price = 100;
  for (let i = 0; i < n; i++) {
    open[i] = price;
    price += Math.sin(i * 1.7) * 0.6 + Math.cos(i / 29) * 0.12;
    close[i] = price;
    high[i] = Math.max(open[i], close[i]) + 0.4;
    low[i] = Math.min(open[i], close[i]) - 0.4;
    volume[i] = 1000 + (1 + Math.sin(i * 0.7)) * 3000;
  }
  sdk.renderOhlcChart({ t, open, high, low, close, volume }, {
    title: 'ACME · OHLC', lineWidth: 1.5, tickWidth: 0.8,
    axes: { y: { format: '$,.2f' } },
  });
  sdk.setXRange(t[n - 80], t[n - 1]);
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
