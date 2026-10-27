import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Waterfall with subtotal',
  description: 'Running totals, connectors and signed labels; increases and decreases never rely on red / green alone.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderWaterfallChart(
    {
      labels: ['Q1 start', 'Sales', 'Services', 'Refunds', 'H1', 'Costs', 'Tax'],
      values: [400, 180, 90, -60, null, -220, -45], // null = computed subtotal
      totals: [4],
    },
    { title: 'Cash flow', total: 'End', format: ',.0f', labels: 'auto' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
