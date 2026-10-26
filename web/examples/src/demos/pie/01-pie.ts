import { VizEngineSDK } from 'viz-engine-sdk';

export const meta = {
  title: 'Pie with outside labels',
  description: 'Sorting, the "Other" fold, angles and leader-line layout are computed in Rust. Hover pulls a slice out.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  sdk.renderPieChart(
    {
      labels: ['Search', 'Direct', 'Social', 'Email', 'Ads', 'Referral', 'Podcasts', 'Events', 'Print', 'Radio'],
      values: [420, 260, 180, 90, 40, 32, 18, 12, 6, 4],
    },
    { title: 'Traffic sources', sort: 'desc', maxSlices: 7, labels: 'outside' }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
