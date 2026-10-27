import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Box plot',
  description: 'Quartiles via selection (no sort) in Rust, Tukey whiskers, sampled outliers, mean markers.',
};

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
const sample = (n: number, mean: number, sd: number) => Float32Array.from({ length: n }, () => mean + gauss() * sd);

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  sdk.renderBoxPlot(
    {
      categories: days,
      series: [
        { name: 'Control', values: days.map((_, i) => sample(5_000, 50 + i * 3, 8)) },
        { name: 'Treated', values: days.map((_, i) => sample(5_000, 46 + i, 12)) },
      ],
    },
    { title: 'Response time', axes: { y: { title: 'ms' } }, whiskers: 'tukey', showOutliers: true, showMean: true }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
