import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { CharturboChart, type CharturboChartHandle } from 'charturbo/react';
import { chartTheme, getThemeName, setThemeName, subscribeTheme } from '../../theme';

export const meta = {
  title: 'React <CharturboChart>',
  description: 'data / options are compared by identity: memoize them so the chart re-renders only when they change.',
};

const walk = (n: number, seed: number) => {
  let v = 50 + seed * 10;
  return Float32Array.from({ length: n }, (_, i) => (v += Math.sin(i / 40 + seed) * 0.8 + (Math.random() - 0.5) * 2));
};

function Dashboard() {
  const chart = useRef<CharturboChartHandle>(null);
  const [version, setVersion] = useState(0);
  const theme = useSyncExternalStore(subscribeTheme, getThemeName);
  const appearance = useMemo(() => chartTheme(), [theme]);
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
        <button onClick={() => setThemeName(theme === 'dark' ? 'light' : 'dark')}>Theme: {theme}</button>
        <button onClick={() => chart.current?.sdk?.resetChartZoom()}>Reset zoom</button>
        <span>{range}</span>
      </div>
      <CharturboChart
        ref={chart}
        type="line"
        data={data}
        options={options}
        theme={appearance}
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
