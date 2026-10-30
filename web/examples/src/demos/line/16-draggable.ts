import { Charturbo } from 'charturbo';

export const meta = {
  title: 'Draggable line points',
  description: 'With `editable`, drag a point up or down (clamped to 0–100) to edit the data in place; Escape cancels. Focus the chart and press Shift + arrows (Alt for a fine step) to move the focused point.',
};

export default async function mount(host: HTMLElement) {
  const status = host.appendChild(document.createElement('div'));
  status.className = 'toolbar';
  status.textContent = 'Drag a point to change its value.';
  const chart = host.appendChild(document.createElement('div'));
  chart.className = 'chart';
  const canvas = chart.appendChild(document.createElement('canvas'));
  const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  sdk.renderLineChart(
    [{ name: 'Target', values: [42, 48, 55, 51, 63, 70, 74, 69, 61, 57, 50, 46], marker: { shape: 'circle', size: 8, show: 'always' } }],
    { title: 'Monthly target (%)', legend: false, axes: { x: { title: 'Month' }, y: { min: 0, max: 100 } } }
  );
  sdk.enableNodeInteractions(canvas, { autoRender: true, editable: { dragAxis: 'y', min: 0, max: 100 } });
  sdk.on('pointDrag', (e) => {
    status.textContent = `${months[e.index]}: ${e.oldValue.y.toFixed(1)} → ${e.newValue.y.toFixed(1)}`;
  });
  sdk.on('pointDragEnd', (e) => {
    const values = sdk.getSeriesData(0)?.y ?? [];
    status.textContent = e.cancelled ? 'Drag cancelled.' : `Saved: ${values.map((v) => Math.round(v)).join(', ')}`;
  });
  sdk.render();
  return sdk;
}
