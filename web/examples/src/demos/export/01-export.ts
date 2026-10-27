import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Vector SVG, PDF and PNG export',
  description: 'exportChartSVG writes the staged GPU marks as SVG paths plus the DOM labels as <text>. Right: the exported SVG.',
  height: 400,
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const split = host.appendChild(document.createElement('div'));
  split.className = 'split';
  const live = split.appendChild(document.createElement('figure'));
  live.innerHTML = '<figcaption>Live (WebGPU canvas)</figcaption>';
  const chart = live.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const exported = split.appendChild(document.createElement('figure'));
  exported.innerHTML = '<figcaption>exportChartSVG()</figcaption>';
  const preview = exported.appendChild(document.createElement('img'));
  preview.alt = 'Exported SVG';

  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  sdk.renderGroupedBarChart(
    {
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [
        { name: 'North', values: [10, 22, 31, 40] },
        { name: 'South', values: [6, 15, 12, 22] },
      ],
    },
    { mode: 'grouped', title: 'Quarterly revenue', labels: true, axes: { y: { format: '$,.0f' } } }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();

  const refresh = () => {
    const svg = sdk.exportChartSVG({ background: 'theme' });
    preview.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  };
  sdk.on('resize', refresh);
  refresh();

  const actions: [string, () => unknown][] = [
    ['Download SVG', () => sdk.downloadChartSVG('revenue.svg')],
    ['Download PDF', () => sdk.downloadChartPDF('revenue.pdf')],
    ['Download PNG @2x', () => sdk.downloadImage('revenue.png', { pixelRatio: 2 })],
    ['Copy image', () => sdk.copyChartImage()],
  ];
  for (const [label, run] of actions) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = label;
    button.onclick = () => void run();
  }
  return sdk;
}
