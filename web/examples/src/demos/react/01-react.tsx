import { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { VizChart, type VizChartHandle } from 'viz-engine-sdk/react';

export const meta = {
  title: 'React <VizChart>',
  description: 'data / options are compared by identity: memoize them so the chart re-renders only when they change.',
};

const walk = (n: number, seed: number) => {
  let v = 50 + seed * 10;
  return Float32Array.from({ length: n }, (_, i) => (v += Math.sin(i / 40 + seed) * 0.8 + (Math.random() - 0.5) * 2));
};

function Dashboard() {
  const chart = useRef<VizChartHandle>(null);
  const [version, setVersion] = useState(0);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const data = useMemo(
    () => [
      { name: 'CPU', values: walk(5_000, version) },
      { name: 'GPU', values: walk(5_000, version + 2) },
    ],
    [version]
  );
  const options = useMemo(() => ({ title: 'Utilization', axes: { y: { format: '.0f' } } }), []);
  const [range, setRange] = useState('');

  return (
    <>
      <div className="toolbar">
        <button onClick={() => setVersion((v) => v + 1)}>New data</button>
        <button onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>Theme: {theme}</button>
        <button onClick={() => chart.current?.sdk?.resetChartZoom()}>Reset zoom</button>
        <span>{range}</span>
      </div>
      <VizChart
        ref={chart}
        type="line"
        data={data}
        options={options}
        theme={theme}
        createOptions={{ locale: 'en-US' }}
        style={{ height: 290 }}
        onRangeChange={(r) => setRange(`x ${r.xMin.toFixed(0)} – ${r.xMax.toFixed(0)}`)}
        onError={(e) => console.error(e)}
      />
    </>
  );
}

export default function mount(host: HTMLElement) {
  const root = createRoot(host);
  root.render(<Dashboard />);
  return { dispose: () => root.unmount() };
}
