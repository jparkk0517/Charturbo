import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Rich text labels',
  description: 'A label format returns a template like {value|42}{unit|k}; rich styles each run (size, weight, color, a rounded badge). Layout and exports use the styled text.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const regions = ['North', 'South', 'East', 'West', 'Central'];
  const revenue = [42.5, 31.2, 55.8, 27.4, 38.9];
  const growth = [12, -4, 18, 3, -9];
  sdk.renderBarChart(
    regions.map((label, i) => ({ label, value: revenue[i] })),
    {
      title: 'Revenue by region',
      axes: { y: { title: 'Revenue ($k)' } },
      labels: {
        position: 'outside',
        format: (v, ctx) => {
          const g = growth[ctx.category];
          return `{value|${v.toFixed(1)}}{unit|k}\n{${g >= 0 ? 'up' : 'down'}|${g >= 0 ? '+' : ''}${g}%}`;
        },
        rich: {
          value: { fontSize: 15, fontWeight: 'bold' },
          unit: { fontSize: 10, color: '#8a94a6' },
          up: { color: '#ffffff', backgroundColor: '#1a9e5c', padding: [1, 5], borderRadius: 7, fontSize: 10 },
          down: { color: '#ffffff', backgroundColor: '#d64545', padding: [1, 5], borderRadius: 7, fontSize: 10 },
        },
      },
    }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
