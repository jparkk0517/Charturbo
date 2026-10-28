import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Label rotation',
  description: 'Bar values rotated 90° inside their bars; long category names rotated on the x axis, thinned by their rotated footprint.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const categories = ['Northern Europe', 'Southern Europe', 'North America', 'Central America', 'South America', 'East Asia', 'Southeast Asia', 'Oceania'];
  const data = {
    categories,
    series: [
      { name: 'Forest', values: [320, 332, 301, 334, 390, 330, 320, 280] },
      { name: 'Steppe', values: [220, 182, 191, 234, 290, 330, 310, 240] },
      { name: 'Desert', values: [150, 232, 201, 154, 190, 330, 410, 360] },
    ],
  };
  const draw = (rotate: number) => {
    sdk.renderGroupedBarChart(data, {
      title: 'Land cover by region',
      // Values read along the bar, from its base (ECharts label.rotate: positive = anticlockwise)
      labels: { rotate: 90, position: 'insideBase', format: (v, c) => `${v} ${c.seriesName}` },
      // Full category names (the default truncates them to 12 characters)
      axes: { x: { labelRotate: rotate, format: (i) => categories[i] ?? '' } },
    });
    sdk.render();
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === `${rotate}°`));
  };
  for (const rotate of [0, 30, 45, 90, -30]) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = `${rotate}°`;
    button.onclick = () => draw(rotate);
  }
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw(30);
  return sdk;
}
