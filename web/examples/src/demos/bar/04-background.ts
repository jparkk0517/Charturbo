import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Bars with background tracks',
  description: 'background: a muted track behind every bar across the whole value axis (grouped: one per bar slot, stacked: one per category).',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const visits = [120, 200, 150, 80, 70, 110, 130];
  const layouts = {
    single: () =>
      sdk.renderBarChart(
        days.map((label, i) => ({ label, value: visits[i] })),
        { title: 'Daily visits', background: true }
      ),
    horizontal: () =>
      sdk.renderBarChart(
        days.map((label, i) => ({ label, value: visits[i] })),
        { title: 'Daily visits', orientation: 'horizontal', background: true, cornerRadius: 6 }
      ),
    grouped: () =>
      sdk.renderGroupedBarChart(
        {
          categories: days,
          series: [
            { name: 'Web', values: visits },
            { name: 'App', values: visits.map((v, i) => Math.round(v * 0.6 + 20 * (i % 3))) },
          ],
        },
        { title: 'Visits by channel', background: true }
      ),
    stacked: () =>
      sdk.renderGroupedBarChart(
        {
          categories: days,
          series: [
            { name: 'Web', values: visits },
            { name: 'App', values: visits.map((v, i) => Math.round(v * 0.6 + 20 * (i % 3))) },
          ],
        },
        { title: 'Visits by channel', mode: 'stacked', background: { color: '#94a3b8', opacity: 0.18 } }
      ),
  };
  const draw = (name: keyof typeof layouts) => {
    layouts[name]();
    sdk.render();
    for (const b of toolbar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.textContent === name));
  };
  for (const name of Object.keys(layouts) as (keyof typeof layouts)[]) {
    const button = toolbar.appendChild(document.createElement('button'));
    button.textContent = name;
    button.onclick = () => draw(name);
  }
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw('single');
  return sdk;
}
