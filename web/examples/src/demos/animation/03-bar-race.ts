import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Bar race',
  description: 'realtimeSort: bars re-sort by value every year and slide to their new rank (tweened by name in Rust); value labels count up; the top 8 stay, the rest fade out.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const names = ['Aurora', 'Basalt', 'Cobalt', 'Delta', 'Ember', 'Fjord', 'Granite', 'Harbor', 'Indigo', 'Juniper', 'Kestrel', 'Lumen'];
  const growth = names.map(() => 0.9 + Math.random() * 0.35);
  const values = names.map(() => 50 + Math.random() * 150);
  const first = 2000;
  const last = 2024;
  let year = first;

  const yearLabel = toolbar.appendChild(document.createElement('strong'));
  const draw = () => {
    yearLabel.textContent = String(year); // timeline label
    sdk.renderBarChart(
      names.map((label, i) => ({ label, value: Math.round(values[i]) })),
      {
        title: `Monthly active users (k), ${year}`,
        orientation: 'horizontal',
        labels: true,
        realtimeSort: { max: 8 }, // sort by value, keep the top 8, count labels up
        animation: { duration: 900, easing: 'linear' },
      }
    );
    sdk.render();
  };
  const step = () => {
    year = year >= last ? first : year + 1;
    if (year === first) values.forEach((_, i) => (values[i] = 50 + Math.random() * 150));
    else values.forEach((v, i) => (values[i] = v * (growth[i] + (Math.random() - 0.5) * 0.3)));
    draw();
  };
  let timer: ReturnType<typeof setInterval> | undefined = setInterval(step, 1000);
  const play = toolbar.appendChild(document.createElement('button'));
  play.textContent = 'Pause';
  play.onclick = () => {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    } else timer = setInterval(step, 1000);
    play.textContent = timer ? 'Pause' : 'Play';
  };
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return { sdk, dispose: () => (clearInterval(timer), sdk.dispose()) };
}
