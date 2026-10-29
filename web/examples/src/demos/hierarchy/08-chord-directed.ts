import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Directed chord with gradient ribbons',
  description: 'directed: true lays out one ribbon per direction (d3 chordDirected) with arrow tips; ribbons blend from the source to the target color. ECharts-style nodes / links, names along the radius.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', animation: { duration: 450, easing: 'ease-out' } });

  const link = (source: string, target: string, value: number) => ({ source, target, value });
  sdk.renderChordChart(
    {
      nodes: ['Asia', 'Europe', 'Africa', 'North America', 'Latin America', 'Oceania'],
      links: [
        link('Asia', 'Europe', 14), link('Asia', 'North America', 17), link('Asia', 'Oceania', 6), link('Asia', 'Africa', 2),
        link('Europe', 'Asia', 4), link('Europe', 'North America', 6), link('Europe', 'Oceania', 3),
        link('Africa', 'Europe', 9), link('Africa', 'Asia', 3), link('Africa', 'North America', 2),
        link('North America', 'Europe', 3), link('North America', 'Asia', 2),
        link('Latin America', 'North America', 19), link('Latin America', 'Europe', 5),
        link('Oceania', 'Asia', 1), link('Oceania', 'Europe', 2),
      ],
    },
    {
      title: 'Migration flows (millions)',
      directed: true,
      ribbonColor: 'gradient',
      ribbonOpacity: 0.7,
      sortSubgroups: 'descending',
      labelRotate: true,
      padAngle: 4,
      valueLabel: 'Migrants',
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
