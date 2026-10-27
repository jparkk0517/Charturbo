import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Violin plot',
  description: 'Binned Gaussian KDE (Silverman bandwidth) evaluated in O(n + grid), with an inner box.',
};

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const bimodal = (n: number, a: number, b: number) =>
    Float32Array.from({ length: n }, (_, i) => (i % 2 ? a : b) + gauss() * 5);
  sdk.renderBoxPlot(
    {
      categories: ['v1.0', 'v1.1', 'v2.0'],
      series: [{ name: 'Build time', values: [bimodal(20_000, 40, 62), bimodal(20_000, 38, 50), bimodal(20_000, 30, 34)] }],
    },
    { title: 'Build time by release', axes: { y: { title: 's' } }, violin: { showBox: true }, legend: false }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
