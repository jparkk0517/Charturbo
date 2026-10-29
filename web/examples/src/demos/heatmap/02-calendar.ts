import { Charturbo, type CalendarHeatmapOptions } from 'charturbo';

export const meta = {
  title: 'Calendar heatmap',
  description: 'One cell per day, laid out in Rust; two years stacked, Monday first. Hover or use the arrow keys to read a day; empty days stay neutral.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  // Daily commits: busier on weekdays, a quiet August, some days without any data
  const data: [string, number | null][] = [];
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let t = Date.UTC(2023, 0, 1); t <= Date.UTC(2024, 11, 31); t += 86_400_000) {
    const day = new Date(t);
    const weekday = day.getUTCDay();
    const base = weekday === 0 || weekday === 6 ? 1 : 6;
    const season = day.getUTCMonth() === 7 ? 0.3 : 1;
    const value = random() < 0.08 ? null : Math.round(base * season * (0.4 + random() * 1.6));
    data.push([day.toISOString().slice(0, 10), value]);
  }
  const options: CalendarHeatmapOptions = {
    ranges: [2023, 2024],
    firstDay: 1,
    title: 'Commits per day',
    valueLabel: 'Commits',
    colorScale: 'viridis',
    min: 0,
  };
  const draw = () => {
    sdk.renderCalendarHeatmap(data, options);
    sdk.render();
  };
  for (const orient of ['horizontal', 'vertical'] as const) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = orient;
    button.onclick = () => {
      options.orient = orient;
      draw();
    };
  }
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return sdk;
}
