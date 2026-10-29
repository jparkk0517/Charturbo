import { Charturbo, type ParallelChartData } from 'charturbo';

export const meta = {
  title: 'Parallel coordinates brushing',
  description: 'Drag along an axis to brush it, Shift + drag adds another interval, a click clears the axis, Escape clears all. Rows are colored by Score; brushed-out rows fade.',
};

export default async function mount(host: HTMLElement) {
  const status = host.appendChild(document.createElement('div'));
  status.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  let seed = 5;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const regions = ['North', 'East', 'South', 'West'];
  const rows = Array.from({ length: 600 }, () => {
    const r = Math.floor(random() * 4);
    const price = Math.round(20 + random() * 80);
    const units = Math.round(4000 / price + random() * 60);
    const margin = Math.round((10 + random() * 30 + (r === 1 ? 8 : 0)) * 10) / 10;
    const score = Math.round(margin * 1.5 + units * 0.2 + random() * 20);
    return [regions[r], price, units, margin, score];
  });
  const data: ParallelChartData = {
    dimensions: [{ name: 'Region', categories: regions }, 'Price', 'Units', { name: 'Margin %', format: '.1f' }, 'Score'],
    rows,
  };
  const show = (active: number, total: number) => (status.textContent = `${active.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} rows inside the brush`);
  sdk.on('parallelBrush', (e) => show(e.activeCount, e.total));
  sdk.renderParallelChart(data, {
    title: 'Products',
    colorBy: 'Score',
    colorScale: 'viridis',
    opacity: 0.6,
    brush: [{ dimension: 'Price', range: [30, 70] }],
  });
  show(sdk.getParallelActiveRows().length, rows.length);
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
