import { VizEngineSDK, type GroupedBarChartOptions } from 'viz-engine-sdk';

export const meta = {
  title: 'Grouped · stacked · percent bars',
  description: 'Multi-series bars: switch the layout; legend clicks hide a series and the engine restacks.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await VizEngineSDK.create(canvas, { locale: 'en-US' });

  const data = {
    categories: ['APAC', 'EMEA', 'US-East', 'US-West', 'LATAM'],
    series: [
      { name: 'Q1', values: [120, 95, 180, 210, 65] },
      { name: 'Q2', values: [145, 110, 205, 230, 80] },
      { name: 'Q3', values: [160, 90, 190, 250, 95] },
    ],
  };
  const draw = (mode: GroupedBarChartOptions['mode']) => {
    sdk.renderGroupedBarChart(data, { mode, title: 'Revenue by region', axes: { y: { format: '$,.0f' } } });
    sdk.render();
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === mode));
  };
  for (const mode of ['grouped', 'stacked', 'percent'] as const) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = mode;
    button.onclick = () => draw(mode);
  }
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw('grouped');
  return sdk;
}
