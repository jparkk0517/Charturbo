import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Decal pattern fills',
  description: 'decal: true gives every series its own pattern (drawn on the GPU, anchored in screen space); series can override it. Bars, pie and treemap; legend swatches and SVG export keep the patterns.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const kinds = ['bars', 'pie', 'treemap'] as const;
  let kind: (typeof kinds)[number] = 'bars';
  let decal = true;
  const draw = () => {
    if (kind === 'bars') {
      sdk.renderGroupedBarChart(
        {
          categories: ['Q1', 'Q2', 'Q3', 'Q4'],
          series: [
            { name: 'North', values: [32, 41, 38, 50] },
            { name: 'South', values: [21, 18, 30, 26] },
            { name: 'East', values: [14, 22, 17, 25], decal: { symbol: 'cross', color: '#facc15', opacity: 0.9 } },
          ],
        },
        { title: 'Revenue by region', mode: 'stacked', decal }
      );
    } else if (kind === 'pie') {
      sdk.renderPieChart({ labels: ['Search', 'Direct', 'Social', 'Email', 'Ads'], values: [420, 260, 180, 90, 40] }, { title: 'Traffic', donut: 0.45, decal });
    } else {
      sdk.renderTreemap(
        {
          name: 'Revenue',
          children: [
            { name: 'Europe', children: [{ name: 'Services', value: 900 }, { name: 'Hardware', value: 600 }] },
            { name: 'Americas', children: [{ name: 'Services', value: 1100 }, { name: 'Hardware', value: 700 }] },
            { name: 'Asia', children: [{ name: 'Software', value: 800 }, { name: 'Hardware', value: 400 }] },
          ],
        },
        { title: 'Revenue', decal }
      );
    }
    sdk.render();
  };
  const button = (text: () => string, onClick: () => void) => {
    const b = toolbar.appendChild(document.createElement('button'));
    b.textContent = text();
    b.onclick = () => {
      onClick();
      b.textContent = text();
      draw();
    };
  };
  button(() => `Chart: ${kind}`, () => (kind = kinds[(kinds.indexOf(kind) + 1) % kinds.length]));
  button(() => `Patterns: ${decal ? 'on' : 'off'}`, () => (decal = !decal));
  const svg = toolbar.appendChild(document.createElement('button'));
  svg.textContent = 'Download SVG';
  svg.onclick = () => sdk.downloadChartSVG('decal.svg');
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return sdk;
}
