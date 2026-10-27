import { CharturboDevice, Charturbo, type SparklineType } from 'charturbo';
import { bindTheme } from '../../theme';

export const meta = {
  title: '24 sparklines on one GPU device',
  description: 'CharturboDevice shares one adapter / device and one pipeline set: no per-canvas device request, no WebGL context limit.',
  height: 470,
};

export default async function mount(host: HTMLElement) {
  const table = host.appendChild(document.createElement('div'));
  table.className = 'spark-table';
  const device = await CharturboDevice.create(); // { backend: 'auto' | 'webgpu' | 'webgl2' }
  const disposers: Array<() => void> = [];

  const types: SparklineType[] = ['line', 'area', 'bar', 'winloss'];
  const metrics = ['Revenue', 'Orders', 'Visitors', 'Refunds', 'Latency', 'Errors'];
  for (let i = 0; i < 24; i++) {
    const type = types[i % 4];
    let v = 100;
    const values =
      type === 'winloss'
        ? Float32Array.from({ length: 24 }, () => (Math.random() < 0.6 ? 1 : -1))
        : Float32Array.from({ length: 60 }, () => (v += (Math.random() - 0.48) * 6));

    const row = table.appendChild(document.createElement('div'));
    row.className = 'spark-row';
    const name = row.appendChild(document.createElement('span'));
    name.className = 'name';
    name.textContent = `${metrics[i % 6]} ${Math.floor(i / 6) + 1}`;
    const canvas = row.appendChild(document.createElement('canvas'));
    const last = row.appendChild(document.createElement('span'));
    last.className = 'value';
    last.textContent = type === 'winloss' ? `${values.filter((x) => x > 0).length} W` : values[values.length - 1].toFixed(1);

    const sdk = await Charturbo.create(canvas, { device, locale: 'en-US' });
    sdk.renderSparkline(values, {
      type,
      showLast: type === 'line',
      showMinMax: type === 'line',
      band: type === 'area' ? [95, 105] : undefined,
      label: name.textContent,
    });
    const unbind = bindTheme(sdk);
    disposers.push(() => { unbind(); sdk.dispose(); });
  }
  return { dispose: () => { disposers.forEach((dispose) => dispose()); device.dispose(); } };
}
