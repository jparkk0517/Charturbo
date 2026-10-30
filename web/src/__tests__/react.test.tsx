// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act, createRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

vi.mock('../sdk/charturbo', async () => (await import('./fake-charturbo-sdk')).fakeSdkModule);

import { FakeSDK, flush } from './fake-charturbo-sdk';
import { CharturboChart, useCharturboChart, type CharturboChartHandle, type CharturboChartProps } from '../react';
import type { LineSeriesDescriptor } from '../sdk/charturbo';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const series: LineSeriesDescriptor[] = [{ name: 'cpu', values: [1, 2, 3] }];
const lineOptions = { title: 'CPU' };

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  FakeSDK.reset();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function mount(el: React.ReactElement): Promise<void> {
  await act(async () => {
    root.render(el);
    await flush();
  });
}

/** Settles the pending `create` and lets the ready callbacks commit. */
async function ready(): Promise<FakeSDK> {
  let sdk!: FakeSDK;
  await act(async () => {
    sdk = FakeSDK.resolveNext();
    await flush();
  });
  return sdk;
}

function Line(props: Partial<CharturboChartProps<'line'>> & { chartRef?: React.Ref<CharturboChartHandle> }) {
  const { chartRef, ...rest } = props;
  return <CharturboChart ref={chartRef} type="line" data={series} options={lineOptions} {...rest} />;
}

describe('React CharturboChart', () => {
  it.each(['pointCloud3d', 'surface3d'] as const)('keeps imperative %s streaming across a theme-only render', async type => {
    const ref = createRef<CharturboChartHandle>();
    const data = type === 'pointCloud3d' ? [{ data: new Float32Array([1, 2, 3]) }]
      : [{ data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [1, 2, 3, 4] } }];
    await mount(<CharturboChart ref={ref} type={type} data={data} theme="dark" />);
    const sdk = await ready();
    const live = await ref.current!.whenReady();
    if (!live) throw new Error('chart did not become ready');
    if (type === 'pointCloud3d') live.appendPointCloud3D(0, [[4, 5, 6]], { maxPoints: 2 });
    else live.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: [5, 6] });
    live.render();
    await mount(<CharturboChart ref={ref} type={type} data={data} theme="light" />);
    expect(type === 'pointCloud3d' ? sdk.appendPointCloud3D : sdk.updateSurface3D).toHaveBeenCalledOnce();
    expect(type === 'pointCloud3d' ? sdk.renderPointCloud3D : sdk.renderSurface3D).toHaveBeenCalledOnce();
    expect(ref.current!.sdk).toBe(sdk);
  });
  it.each(['pointCloud3d', 'surface3d'] as const)('dispatches %s props', async (type) => {
    const data = type === 'pointCloud3d' ? [{ data: new Float32Array([1, 2, 3]) }]
      : [{ data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [1, 2, 3, 4] }, contours: { show: true, levels: [2.5] } }];
    const options = { aspect: 'data' as const, axes3d: { x: { min: 0, max: 10 } }, camera: { type: 'orthographic' as const } };
    await mount(<CharturboChart type={type} data={data} options={options} />);
    const sdk = await ready();
    expect(type === 'pointCloud3d' ? sdk.renderPointCloud3D : sdk.renderSurface3D).toHaveBeenCalledWith(data, options);
  });
  it.each(['errorBar', 'impulse'] as const)('dispatches independent %s props', async (type) => {
    const data = [{ name: 'S', values: [1, 2], error: 0.5 }];
    await mount(<CharturboChart type={type} data={data} />);
    const sdk = await ready();
    expect(type === 'errorBar' ? sdk.renderErrorBarChart : sdk.renderImpulseChart).toHaveBeenCalledWith(data, undefined);
  });

  it('dispatches independent band props', async () => {
    const data = [{ name: 'Range', lower: [1, 2], upper: [3, 4] }];
    const options = { fillOpacity: 0.3 };
    await mount(<CharturboChart type="band" data={data} options={options} />);
    const sdk = await ready();
    expect(sdk.renderBandChart).toHaveBeenCalledWith(data, options);
  });
  it('dispatches OHLC props to the independent financial renderer', async () => {
    const data = { open: [10], high: [12], low: [9], close: [11] };
    const options = { lineWidth: 2 };
    await mount(<CharturboChart type="ohlc" data={data} options={options} />);
    const sdk = await ready();
    expect(sdk.renderOhlcChart).toHaveBeenCalledWith(data, options);
    expect(sdk.renderCandlestickChart).not.toHaveBeenCalled();
  });
  it('creates the engine on mount and applies theme, sync, chart, interactions once ready', async () => {
    const onReady = vi.fn();
    const ref = createRef<CharturboChartHandle>();
    await mount(<Line chartRef={ref} theme="light" syncGroup="dash" onReady={onReady} className="c" style={{ height: 200 }} />);
    expect(FakeSDK.create).toHaveBeenCalledTimes(1);
    const canvas = host.querySelector('canvas')!;
    expect(FakeSDK.create.mock.calls[0][0]).toBe(canvas);
    expect((host.firstChild as HTMLElement).className).toBe('c');
    expect((host.firstChild as HTMLElement).style.position).toBe('relative');
    expect(ref.current!.sdk).toBeNull();

    const sdk = await ready();
    expect(sdk.calls).toEqual(['setTheme', 'setSync', 'renderLineChart', 'enableNodeInteractions', 'render']);
    expect(sdk.setTheme).toHaveBeenCalledWith('light');
    expect(sdk.setSync).toHaveBeenCalledWith({ key: 'dash' });
    expect(sdk.renderLineChart).toHaveBeenCalledWith(series, lineOptions);
    expect(sdk.enableNodeInteractions).toHaveBeenCalledWith(canvas, { autoRender: true });
    expect(onReady).toHaveBeenCalledWith(sdk);
    expect(ref.current!.sdk).toBe(sdk);
    expect(ref.current!.canvas).toBe(canvas);
    await expect(ref.current!.whenReady()).resolves.toBe(sdk);
  });

  it('disposes an engine that arrives after unmount (no callbacks, no render)', async () => {
    const onReady = vi.fn();
    await mount(<Line onReady={onReady} />);
    act(() => root.render(<></>));
    let sdk!: FakeSDK;
    await act(async () => {
      sdk = FakeSDK.resolveNext();
      await flush();
    });
    expect(sdk.dispose).toHaveBeenCalledTimes(1);
    expect(sdk.renderLineChart).not.toHaveBeenCalled();
    expect(sdk.listenerCount()).toBe(0);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('StrictMode double mount creates a single engine and disposes it on unmount', async () => {
    const onReady = vi.fn();
    await mount(
      <StrictMode>
        <Line onReady={onReady} />
      </StrictMode>
    );
    expect(FakeSDK.create).toHaveBeenCalledTimes(1);
    const sdk = await ready();
    expect(sdk.renderLineChart).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    act(() => root.render(<></>));
    expect(sdk.dispose).toHaveBeenCalledTimes(1);
    expect(FakeSDK.pendingCount()).toBe(0);
  });

  it('re-renders only on data / options identity change; theme change calls setTheme only', async () => {
    await mount(<Line theme="dark" />);
    const sdk = await ready();
    sdk.calls.length = 0;

    // Same data / options identity, new theme
    await mount(<Line theme="light" />);
    expect(sdk.calls).toEqual(['setTheme', 'render']);
    expect(sdk.setTheme).toHaveBeenLastCalledWith('light');

    // Same props again: nothing
    sdk.calls.length = 0;
    await mount(<Line theme="light" />);
    expect(sdk.calls).toEqual([]);

    // New data identity
    const next = [{ name: 'cpu', values: [4, 5] }];
    await mount(<Line theme="light" data={next} />);
    expect(sdk.calls).toEqual(['renderLineChart', 'render']);
    expect(sdk.renderLineChart).toHaveBeenLastCalledWith(next, lineOptions);

    // New options identity
    sdk.calls.length = 0;
    await mount(<Line theme="light" data={next} options={{ title: 'B' }} />);
    expect(sdk.calls).toEqual(['renderLineChart', 'render']);
  });

  it('props changed before ready are applied once with the latest values', async () => {
    await mount(<Line theme="dark" />);
    const next = [{ name: 'mem', values: [1] }];
    await mount(<Line theme="light" data={next} />);
    const sdk = await ready();
    expect(sdk.renderLineChart).toHaveBeenCalledTimes(1);
    expect(sdk.renderLineChart).toHaveBeenCalledWith(next, lineOptions);
    expect(sdk.setTheme).toHaveBeenCalledTimes(1);
    expect(sdk.setTheme).toHaveBeenCalledWith('light');
  });

  it('dispatches each chart type to its render call', async () => {
    const grouped = { categories: ['a'], series: [{ name: 's', values: [1] }] };
    const cases: [CharturboChartProps['type'], unknown, keyof FakeSDK][] = [
      ['area', series, 'renderAreaChart'],
      ['bar', [{ label: 'a', value: 1 }], 'renderBarChart'],
      ['bar', grouped, 'renderGroupedBarChart'],
      ['scatter', { x: [1], y: [2] }, 'renderScatterChart'],
      ['candlestick', { open: [1], high: [2], low: [0], close: [1] }, 'renderCandlestickChart'],
      ['histogram', [1, 2, 3], 'renderHistogram'],
      ['heatmap', { cols: 1, rows: 1, values: [1] }, 'renderHeatmap'],
      ['box', { categories: ['a'], series: [{ name: 's', values: [[1, 2, 3]] }] }, 'renderBoxPlot'],
      ['pie', { labels: ['a', 'b'], values: [1, 2] }, 'renderPieChart'],
      ['combo', { categories: ['a'], series: [{ name: 's', type: 'bar', values: [1] }] }, 'renderComboChart'],
      ['radar', { axes: ['a', 'b', 'c'], series: [{ name: 's', values: [1, 2, 3] }] }, 'renderRadarChart'],
      ['gauge', { value: 42 }, 'renderGauge'],
      ['funnel', { labels: ['a', 'b'], values: [2, 1] }, 'renderFunnelChart'],
      ['calendar', [['2023-01-01', 1]], 'renderCalendarHeatmap'],
      ['chord', { matrix: [[0, 1], [1, 0]] }, 'renderChordChart'],
      ['parallel', { dimensions: ['a', 'b'], rows: [[1, 2]] }, 'renderParallelChart'],
      ['polar', { series: [{ type: 'bar', data: [1, 2] }] }, 'renderPolarChart'],
      ['waterfall', { labels: ['a', 'b'], values: [2, -1] }, 'renderWaterfallChart'],
      ['treemap', { name: 'root', children: [{ name: 'a', value: 1 }] }, 'renderTreemap'],
      ['sunburst', [{ id: 'r' }, { id: 'a', parent: 'r', value: 2 }], 'renderSunburst'],
      ['sankey', { nodes: [{ id: 'a' }, { id: 'b' }], links: [{ source: 'a', target: 'b', value: 1 }] }, 'renderSankey'],
      ['sparkline', [1, 3, 2], 'renderSparkline'],
      ['themeRiver', [[0, 1, 'a'], [1, 2, 'a']], 'renderThemeRiverChart'],
    ];
    await mount(<CharturboChart type="line" data={series} />);
    const sdk = await ready();
    for (const [type, data, method] of cases) {
      await mount(<CharturboChart type={type} data={data as never} />);
      expect(sdk[method]).toHaveBeenLastCalledWith(data, undefined);
    }
  });

  it('sparklines get no default interactions; a throwing first render still binds them', async () => {
    await mount(<CharturboChart type="sparkline" data={[1, 2, 3]} />);
    const sdk = await ready();
    expect(sdk.renderSparkline).toHaveBeenCalledTimes(1);
    expect(sdk.enableNodeInteractions).not.toHaveBeenCalled();
    // Switching to a regular chart binds the default interactions
    await mount(<CharturboChart type="line" data={series} />);
    expect(sdk.enableNodeInteractions).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(host);
    FakeSDK.reset();
    const onError = vi.fn();
    const bad = { labels: ['a'], values: [-1] };
    await mount(<CharturboChart type="pie" data={bad} onError={onError} />);
    const sdk2 = await ready();
    sdk2.renderPieChart.mockImplementationOnce(() => {
      throw new Error('negative');
    });
    // (the first render already ran in `ready`; re-render with the throwing implementation)
    await mount(<CharturboChart type="pie" data={{ ...bad }} onError={onError} />);
    expect(onError).toHaveBeenCalled();
    expect(sdk2.enableNodeInteractions).toHaveBeenCalledTimes(1);
  });

  it('forwards SDK events to the latest callbacks without resubscribing', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const onRangeChange = vi.fn();
    const onSelect = vi.fn();
    await mount(<Line onHover={first} onRangeChange={onRangeChange} onSelect={onSelect} />);
    const sdk = await ready();
    const subscriptions = sdk.on.mock.calls.length;
    const hover = { chart: null, node: null, clientX: 1, clientY: 2 };
    sdk.emit('hover', hover);
    expect(first).toHaveBeenCalledWith(hover);

    await mount(<Line onHover={second} onRangeChange={onRangeChange} onSelect={onSelect} />);
    sdk.emit('hover', hover);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(sdk.on.mock.calls.length).toBe(subscriptions);
    expect(sdk.renderLineChart).toHaveBeenCalledTimes(1);

    sdk.emit('rangechange', { xMin: 1, xMax: 2 });
    sdk.emit('select', { kind: 'line', xRange: null });
    expect(onRangeChange).toHaveBeenCalledWith({ xMin: 1, xMax: 2 });
    expect(onSelect).toHaveBeenCalledWith({ kind: 'line', xRange: null });
  });

  it('dispose on unmount: unsubscribes, detaches interactions, frees the engine', async () => {
    const ref = createRef<CharturboChartHandle>();
    await mount(<Line chartRef={ref} />);
    const sdk = await ready();
    expect(sdk.listenerCount()).toBeGreaterThan(0);
    act(() => root.render(<></>));
    expect(sdk.detach).toHaveBeenCalledTimes(1);
    expect(sdk.dispose).toHaveBeenCalledTimes(1);
    expect(sdk.listenerCount()).toBe(0);
    expect(ref.current).toBeNull();
  });

  it('syncGroup and interactions updates', async () => {
    const brush = { brush: 'x' as const };
    await mount(<Line syncGroup="a" interactions={brush} />);
    const sdk = await ready();
    expect(sdk.enableNodeInteractions).toHaveBeenCalledWith(host.querySelector('canvas'), { autoRender: true, brush: 'x' });
    sdk.calls.length = 0;
    // Equal member options (new object): no call
    await mount(<Line syncGroup={{ key: 'a' }} interactions={brush} />);
    expect(sdk.calls).toEqual([]);
    await mount(<Line syncGroup={null} interactions={false} />);
    expect(sdk.setSync).toHaveBeenLastCalledWith(null);
    expect(sdk.detach).toHaveBeenCalledTimes(1);
    expect(sdk.calls).toEqual(['setSync']);
  });

  it('reports create failure through onError and the hook state', async () => {
    const onError = vi.fn();
    let seen: unknown = null;
    function Probe() {
      const chart = useCharturboChart({ type: 'line', data: series, onError });
      seen = chart.error;
      return <canvas ref={chart.canvasRef} />;
    }
    await mount(<Probe />);
    const err = new Error('no-webgpu');
    await act(async () => {
      FakeSDK.rejectNext(err);
      await flush();
    });
    expect(onError).toHaveBeenCalledWith(err);
    expect(seen).toBe(err);
  });

  it('useCharturboChart exposes the sdk as state', async () => {
    const seen: unknown[] = [];
    function Probe() {
      const [data] = useState(series);
      const chart = useCharturboChart({ type: 'line', data });
      seen.push(chart.sdk);
      return (
        <div style={{ position: 'relative' }}>
          <canvas ref={chart.canvasRef} />
        </div>
      );
    }
    await mount(<Probe />);
    const sdk = await ready();
    expect(seen[0]).toBeNull();
    expect(seen[seen.length - 1]).toBe(sdk);
    expect(sdk.renderLineChart).toHaveBeenCalledTimes(1);
  });

  it('handle.sdk is live inside onReady; a throwing onReady does not reject whenReady', async () => {
    vi.useFakeTimers();
    try {
      const ref = createRef<CharturboChartHandle>();
      let inside: unknown = 'unset';
      await mount(
        <Line
          chartRef={ref}
          onReady={() => {
            inside = ref.current!.sdk;
            throw new Error('user bug');
          }}
        />
      );
      const sdk = await ready();
      expect(inside).toBe(sdk);
      await expect(ref.current!.whenReady()).resolves.toBe(sdk);
      // Rethrown asynchronously, like SDK event handler errors
      expect(() => vi.runAllTimers()).toThrow('user bug');
    } finally {
      vi.useRealTimers();
    }
  });

  it('SSR: renders markup without creating an engine', () => {
    const html = renderToString(<Line className="ssr" />);
    expect(html).toContain('<canvas');
    expect(html).toContain('class="ssr"');
    expect(FakeSDK.create).not.toHaveBeenCalled();
  });
});
