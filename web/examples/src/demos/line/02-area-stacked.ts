import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Stacked area on a time axis',
  description: 'Epoch-ms x values, calendar ticks, sorted shared tooltip with totals. Click legend items to restack.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US', timeZone: 'UTC' });

  const day = 86_400_000;
  const x = Array.from({ length: 180 }, (_, i) => Date.UTC(2026, 0, 1) + i * day);
  const channel = (base: number, phase: number) =>
    Float32Array.from(x, (_, i) => base * (1 + 0.25 * Math.sin(i / 11 + phase)) + i * base * 0.004);

  sdk.renderAreaChart(
    [
      { name: 'Search', values: channel(40, 0), x },
      { name: 'Social', values: channel(24, 1.3), x },
      { name: 'Email', values: channel(12, 2.6), x },
    ],
    {
      mode: 'stacked', // 'overlap' | 'stacked' | 'percent'
      title: 'Sessions by channel',
      axes: { x: { type: 'time' }, y: { title: 'Sessions (k)', format: ',.0f' } },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true, tooltip: { sort: 'desc', valueFormatter: ',.1f' } });
  sdk.render();
  return sdk;
}
