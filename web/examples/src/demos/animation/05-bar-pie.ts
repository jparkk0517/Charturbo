import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Bar to pie transition',
  description: 'animation.transition: each bar morphs into the pie slice with the same name (polygon morph in Rust), and back.',
};

export default async function mount(host: HTMLElement) {
  const toolbar = host.appendChild(document.createElement('div'));
  toolbar.className = 'toolbar';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });

  const labels = ['Search', 'Direct', 'Social', 'Email', 'Referral'];
  const values = [420, 310, 180, 120, 70];
  const animation = { duration: 800, easing: 'ease-in-out' as const, transition: true };
  let pie = false;
  const draw = () => {
    if (pie) sdk.renderPieChart({ labels, values }, { title: 'Traffic sources', legend: false, animation });
    else sdk.renderBarChart(labels.map((label, i) => ({ label, value: values[i] })), { title: 'Traffic sources', animation });
    sdk.render();
  };
  const toggle = toolbar.appendChild(document.createElement('button'));
  toggle.textContent = 'Bar / pie';
  toggle.onclick = () => {
    pie = !pie;
    draw();
  };
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  draw();
  return sdk;
}
