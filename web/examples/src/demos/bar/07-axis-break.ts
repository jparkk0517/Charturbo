import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Axis break for an outlier',
  description: 'One outlier would flatten every other bar. A value-axis break collapses 40–430 so both stay readable; the gap is marked across the plot.',
};

export default async function mount(host: HTMLElement) {
  const canvas = host.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const orders = [22, 31, 18, 460, 27, 35, 24];
  sdk.renderBarChart(
    days.map((label, i) => ({ label, value: orders[i] })),
    { title: 'Orders (Thursday sale)', axes: { y: { title: 'Orders', breaks: [{ start: 40, end: 430, gap: '8%' }] } } }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  sdk.render();
  return sdk;
}
