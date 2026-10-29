import { Charturbo, type ParallelChartData } from 'charturbo';

export const meta = {
  title: 'Parallel coordinates',
  description: 'One polyline per car across value, category and time axes; Weight is inverted. Hover a line to read every dimension, toggle series in the legend.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  // Seeded cars: origin shifts weight and economy, newer years run a little leaner
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const origins = ['US', 'EU', 'JP'];
  const make = (count: number, heavy: number) =>
    Array.from({ length: count }, () => {
      const o = Math.floor(random() * 3);
      const year = 1970 + Math.floor(random() * 13);
      const weight = Math.round(1800 + heavy * 1600 * random() + (o === 0 ? 600 : 0));
      const hp = Math.round(50 + (weight - 1600) * 0.05 + random() * 40);
      const mpg = Math.round((46 - weight / 140 + (year - 1970) * 0.4 + random() * 4) * 10) / 10;
      return [mpg, hp, origins[o], new Date(Date.UTC(year, 0, 1)), weight];
    });
  const data: ParallelChartData = {
    dimensions: ['MPG', 'Horsepower', { name: 'Origin', categories: origins }, { name: 'Year', type: 'time' }, { name: 'Weight', inverse: true }],
    series: [
      { name: 'Sedan', data: make(120, 0.6) },
      { name: 'Truck', data: make(60, 1.2) },
    ],
  };
  const options = { title: 'Cars by origin and year', smooth: false, orient: 'horizontal' as 'horizontal' | 'vertical' };
  const draw = () => {
    sdk.renderParallelChart(data, options);
    sdk.render();
  };
  const toggle = (label: string, apply: () => void) => {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = label;
    button.onclick = () => {
      apply();
      draw();
    };
  };
  toggle('smooth', () => (options.smooth = !options.smooth));
  toggle('vertical', () => (options.orient = options.orient === 'vertical' ? 'horizontal' : 'vertical'));
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return sdk;
}
