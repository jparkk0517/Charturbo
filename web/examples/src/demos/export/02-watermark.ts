import { Charturbo, type ChartWatermarkOptions } from 'charturbo';

export const meta = {
  title: 'Watermark',
  description: 'setWatermark tiles a rotated text over the chart, under the labels and tooltips. Image, SVG and PDF exports include it (export: false keeps it on screen only).',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  sdk.renderGroupedBarChart(
    {
      categories: ['Q1', 'Q2', 'Q3', 'Q4'],
      series: [
        { name: 'Plan', values: [18, 24, 30, 36] },
        { name: 'Forecast', values: [16, 26, 28, 41] },
      ],
    },
    { mode: 'grouped', title: 'Draft forecast', axes: { y: { format: '$,.0f' } } }
  );
  const marks: [string, ChartWatermarkOptions | null][] = [
    ['Tiled text', { text: 'CONFIDENTIAL', fontSize: 14, fontWeight: 600 }],
    ['One centered mark', { text: 'DRAFT', fontSize: 64, fontWeight: 700, opacity: 0.08, rotate: 20, repeat: false }],
    ['Screen only', { text: 'internal', opacity: 0.2, gap: [60, 40], export: false }],
    ['None', null],
  ];
  sdk.setWatermark(marks[0][1]);
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  for (const [label, mark] of marks) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = label;
    button.onclick = () => {
      sdk.setWatermark(mark);
      sdk.render();
    };
  }
  const png = toolbar.appendChild(document.createElement('button'));
  png.textContent = 'Download PNG';
  png.onclick = () => void sdk.downloadImage('forecast.png');
  const svg = toolbar.appendChild(document.createElement('button'));
  svg.textContent = 'Download SVG';
  svg.onclick = () => sdk.downloadChartSVG('forecast.svg');
  return sdk;
}
