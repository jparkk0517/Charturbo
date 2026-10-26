import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Live gauge',
  description: 'Status bands always pair color with an icon and a label. setGaugeValue rebuilds only the needle.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  let value = 64;
  sdk.renderGauge(
    { value },
    {
      title: 'CPU load',
      min: 0,
      max: 100,
      label: 'CPU',
      format: '.0f',
      bands: [
        { from: 0, to: 60, status: 'good' },
        { from: 60, to: 85, status: 'warning' },
        { from: 85, to: 100, status: 'critical', label: 'Overload' },
      ],
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  const timer = setInterval(() => {
    value = Math.min(99, Math.max(5, value + (Math.random() - 0.5) * 12));
    sdk.setGaugeValue(value);
    sdk.render();
  }, 1000);
  return { sdk, dispose: () => (clearInterval(timer), sdk.dispose()) };
}
