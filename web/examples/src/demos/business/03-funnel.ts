import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Funnel',
  description: 'Stage widths and conversion rates (of first and of previous) are computed in Rust.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  sdk.renderFunnelChart(
    { labels: ['Visits', 'Sign-ups', 'Trials', 'Activated', 'Paid'], values: [12_000, 5_400, 2_100, 1_300, 760] },
    { title: 'Conversion funnel', conversion: 'both', format: ',.0f' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
