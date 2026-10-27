import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Animated updates',
  description: 'Opt-in tweens: bars grow from the baseline on enter and interpolate on update (in Rust, over staged marks only).',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US', animation: { duration: 600, easing: 'ease-out' } });

  const categories = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const random = () => categories.map(() => 20 + Math.round(Math.random() * 80));
  const draw = () => {
    sdk.renderGroupedBarChart(
      { categories, series: [{ name: 'This week', values: random() }, { name: 'Last week', values: random() }] },
      { title: 'Orders per day' }
    );
    sdk.render();
  };
  const shuffle = toolbar.appendChild(document.createElement('button'));
  shuffle.textContent = 'Shuffle data';
  shuffle.onclick = draw; // same shape -> update tween
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw(); // first render -> enter tween
  return sdk;
}
