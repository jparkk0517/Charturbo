import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Candlestick with volume',
  description: 'Two years of daily OHLC. Zoom out: candles narrower than 2 px are aggregated per pixel column in Rust.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', timeZone: 'UTC' });

  const n = 730;
  const t = new Float64Array(n);
  const [open, high, low, close, volume] = Array.from({ length: 5 }, () => new Float32Array(n));
  let price = 100;
  for (let i = 0; i < n; i++) {
    t[i] = Date.UTC(2025, 0, 1) + i * 86_400_000;
    open[i] = price;
    price = Math.max(5, price * (1 + (Math.random() - 0.48) * 0.04));
    close[i] = price;
    high[i] = Math.max(open[i], close[i]) * (1 + Math.random() * 0.015);
    low[i] = Math.min(open[i], close[i]) * (1 - Math.random() * 0.015);
    volume[i] = 1e6 * (0.5 + Math.random());
  }
  sdk.renderCandlestickChart(
    { t, open, high, low, close, volume },
    { title: 'ACME', hollowUp: true, yFit: 'visible', axes: { y: { format: '$,.2f' } } }
  );
  sdk.setXRange(t[n - 120], t[n - 1]); // start on the last 4 months
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
