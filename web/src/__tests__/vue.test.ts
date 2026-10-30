// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive, shallowRef, type App } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { createSSRApp } from 'vue';

vi.mock('../sdk/charturbo', async () => (await import('./fake-charturbo-sdk')).fakeSdkModule);

import { FakeSDK, flush } from './fake-charturbo-sdk';
import { CharturboChart, useCharturboChart, type CharturboChartInstance } from '../vue';
import type { LineSeriesDescriptor } from '../sdk/charturbo';

const series: LineSeriesDescriptor[] = [{ name: 'cpu', values: [1, 2, 3] }];
const lineOptions = { title: 'CPU' };

let host: HTMLDivElement;
let app: App | null = null;

beforeEach(() => {
  FakeSDK.reset();
  host = document.createElement('div');
  document.body.appendChild(host);
});

afterEach(() => {
  app?.unmount();
  app = null;
  host.remove();
});

/** Mounts `<CharturboChart v-bind="props()" />` (props read reactively) with a template ref. */
function mountChart(props: () => Record<string, unknown>) {
  const chartRef = shallowRef<CharturboChartInstance | null>(null);
  const show = shallowRef(true);
  app = createApp(
    defineComponent({
      setup: () => () => (show.value ? h(CharturboChart, { ref: chartRef, ...props() } as never) : null),
    })
  );
  app.mount(host);
  return { chartRef, show };
}

async function ready(): Promise<FakeSDK> {
  const sdk = FakeSDK.resolveNext();
  await flush();
  await nextTick();
  return sdk;
}

describe('Vue CharturboChart', () => {
  it.each(['pointCloud3d', 'surface3d'] as const)('keeps imperative %s streaming across a theme-only render', async type => {
    const data = type === 'pointCloud3d' ? [{ data: new Float32Array([1, 2, 3]) }]
      : [{ data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [1, 2, 3, 4] } }];
    const theme = shallowRef('dark');
    const { chartRef } = mountChart(() => ({ type, data, theme: theme.value }));
    await flush();
    const sdk = await ready();
    const live = await chartRef.value!.whenReady();
    if (!live) throw new Error('chart did not become ready');
    if (type === 'pointCloud3d') live.appendPointCloud3D(0, [[4, 5, 6]], { maxPoints: 2 });
    else live.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: [5, 6] });
    live.render();
    theme.value = 'light';
    await nextTick();
    expect(type === 'pointCloud3d' ? sdk.appendPointCloud3D : sdk.updateSurface3D).toHaveBeenCalledOnce();
    expect(type === 'pointCloud3d' ? sdk.renderPointCloud3D : sdk.renderSurface3D).toHaveBeenCalledOnce();
    expect(chartRef.value!.sdk).toBe(sdk);
  });
  it.each(['pointCloud3d', 'surface3d'] as const)('dispatches %s props', async (type) => {
    const data = type === 'pointCloud3d' ? [{ data: new Float32Array([1, 2, 3]) }]
      : [{ data: { columns: 2, rows: 2, xStart: 0, xStep: 1, zStart: 0, zStep: 1, y: [1, 2, 3, 4] }, contours: { show: true, levels: [2.5] } }];
    const options = { aspect: 'data' as const, axes3d: { x: { min: 0, max: 10 } }, camera: { type: 'orthographic' as const } };
    mountChart(() => ({ type, data, options }));
    await flush();
    const sdk = await ready();
    expect(type === 'pointCloud3d' ? sdk.renderPointCloud3D : sdk.renderSurface3D).toHaveBeenCalledWith(data, options);
  });
  it.each(['errorBar', 'impulse'] as const)('dispatches independent %s props', async (type) => {
    const data = [{ name: 'S', values: [1, 2], error: 0.5 }];
    mountChart(() => ({ type, data }));
    await flush();
    const sdk = await ready();
    expect(type === 'errorBar' ? sdk.renderErrorBarChart : sdk.renderImpulseChart).toHaveBeenCalledWith(data, undefined);
  });

  it('dispatches independent band props', async () => {
    const data = [{ name: 'Range', lower: [1, 2], upper: [3, 4] }];
    const options = { fillOpacity: 0.3 };
    mountChart(() => ({ type: 'band', data, options }));
    await flush();
    const sdk = await ready();
    expect(sdk.renderBandChart).toHaveBeenCalledWith(data, options);
  });
  it('dispatches OHLC props to the independent financial renderer', async () => {
    const data = { open: [10], high: [12], low: [9], close: [11] };
    const options = { tickWidth: 0.8 };
    mountChart(() => ({ type: 'ohlc', data, options }));
    await flush();
    const sdk = await ready();
    expect(sdk.renderOhlcChart).toHaveBeenCalledWith(data, options);
    expect(sdk.renderCandlestickChart).not.toHaveBeenCalled();
  });
  it('creates the engine on mount and applies theme, sync, chart, interactions once ready', async () => {
    const onReady = vi.fn();
    const { chartRef } = mountChart(() => ({
      type: 'line',
      data: series,
      options: lineOptions,
      theme: 'light',
      syncGroup: 'dash',
      class: 'c',
      onReady,
    }));
    await flush();
    expect(FakeSDK.create).toHaveBeenCalledTimes(1);
    const canvas = host.querySelector('canvas')!;
    expect(FakeSDK.create.mock.calls[0][0]).toBe(canvas);
    const root = host.firstElementChild as HTMLElement;
    expect(root.className).toBe('c');
    expect(root.style.position).toBe('relative');
    expect(chartRef.value!.sdk).toBeNull();

    const sdk = await ready();
    expect(sdk.calls).toEqual(['setTheme', 'setSync', 'renderLineChart', 'enableNodeInteractions', 'render']);
    expect(sdk.setTheme).toHaveBeenCalledWith('light');
    expect(sdk.setSync).toHaveBeenCalledWith({ key: 'dash' });
    expect(sdk.renderLineChart).toHaveBeenCalledWith(series, lineOptions);
    expect(sdk.enableNodeInteractions).toHaveBeenCalledWith(canvas, { autoRender: true });
    expect(onReady).toHaveBeenCalledWith(sdk);
    expect(chartRef.value!.sdk).toBe(sdk);
    expect(chartRef.value!.canvas).toBe(canvas);
    await expect(chartRef.value!.whenReady()).resolves.toBe(sdk);
  });

  it('disposes an engine that arrives after unmount (no events, no render)', async () => {
    const onReady = vi.fn();
    const { show } = mountChart(() => ({ type: 'line', data: series, onReady }));
    await flush();
    show.value = false;
    await nextTick();
    const sdk = FakeSDK.resolveNext();
    await flush();
    expect(sdk.dispose).toHaveBeenCalledTimes(1);
    expect(sdk.renderLineChart).not.toHaveBeenCalled();
    expect(sdk.listenerCount()).toBe(0);
    expect(onReady).not.toHaveBeenCalled();
  });

  it('unmount before the deferred create starts never creates an engine', async () => {
    const { show } = mountChart(() => ({ type: 'line', data: series }));
    show.value = false;
    await nextTick();
    await flush();
    expect(FakeSDK.create).not.toHaveBeenCalled();
  });

  it('shallow watches: data / options identity re-renders, theme calls setTheme only', async () => {
    const state = reactive({ data: series as LineSeriesDescriptor[], options: lineOptions, theme: 'dark' });
    mountChart(() => ({ type: 'line', data: state.data, options: state.options, theme: state.theme }));
    await flush();
    const sdk = await ready();
    sdk.calls.length = 0;

    state.theme = 'light';
    await nextTick();
    expect(sdk.calls).toEqual(['setTheme', 'render']);
    expect(sdk.setTheme).toHaveBeenLastCalledWith('light');

    // In-place mutation is not watched (shallow)
    sdk.calls.length = 0;
    state.data.push({ name: 'x', values: [1] });
    await nextTick();
    expect(sdk.calls).toEqual([]);

    const next = [{ name: 'mem', values: [4, 5] }];
    state.data = next;
    await nextTick();
    expect(sdk.calls).toEqual(['renderLineChart', 'render']);
    // Unwrapped: the SDK never sees the reactive proxy
    expect(sdk.renderLineChart.mock.calls.at(-1)![0]).toBe(next);
    expect(sdk.renderLineChart.mock.calls.at(-1)![1]).toBe(lineOptions);

    sdk.calls.length = 0;
    state.options = { title: 'B' };
    await nextTick();
    expect(sdk.calls).toEqual(['renderLineChart', 'render']);
  });

  it('emits SDK events', async () => {
    const onHover = vi.fn();
    const onRangeChange = vi.fn();
    const onLegendToggle = vi.fn();
    mountChart(() => ({ type: 'line', data: series, onHover, onRangeChange, onLegendToggle }));
    await flush();
    const sdk = await ready();
    const hover = { chart: null, node: null, clientX: 1, clientY: 2 };
    sdk.emit('hover', hover);
    sdk.emit('rangechange', { xMin: 1, xMax: 2 });
    sdk.emit('legendtoggle', { series: 0, visible: false });
    expect(onHover).toHaveBeenCalledWith(hover);
    expect(onRangeChange).toHaveBeenCalledWith({ xMin: 1, xMax: 2 });
    expect(onLegendToggle).toHaveBeenCalledWith({ series: 0, visible: false });
  });

  it('dispose on unmount: unsubscribes, detaches interactions, frees the engine', async () => {
    const { show } = mountChart(() => ({ type: 'line', data: series }));
    await flush();
    const sdk = await ready();
    expect(sdk.listenerCount()).toBeGreaterThan(0);
    show.value = false;
    await nextTick();
    expect(sdk.detach).toHaveBeenCalledTimes(1);
    expect(sdk.dispose).toHaveBeenCalledTimes(1);
    expect(sdk.listenerCount()).toBe(0);
  });

  it('loading and watermark props: applied once ready, then on change', async () => {
    const mark = { text: 'DRAFT' };
    const state = reactive({ loading: true as unknown, watermark: mark as unknown });
    mountChart(() => ({ type: 'line', data: series, loading: state.loading, watermark: state.watermark }));
    await flush();
    const sdk = await ready();
    expect(sdk.calls.slice(0, 2)).toEqual(['setWatermark', 'showLoading']);
    expect(sdk.setWatermark).toHaveBeenCalledWith(mark);
    expect(sdk.showLoading).toHaveBeenCalledWith(undefined);
    sdk.calls.length = 0;
    const opts = { text: 'Fetching' };
    state.loading = opts;
    await nextTick();
    expect(sdk.showLoading).toHaveBeenLastCalledWith(opts);
    state.loading = false;
    state.watermark = null;
    await nextTick();
    expect(sdk.calls).toEqual(['showLoading', 'hideLoading', 'setWatermark']);
    expect(sdk.setWatermark).toHaveBeenLastCalledWith(null);
  });

  it('no loading / watermark props: no calls', async () => {
    mountChart(() => ({ type: 'line', data: series }));
    await flush();
    const sdk = await ready();
    expect(sdk.showLoading).not.toHaveBeenCalled();
    expect(sdk.hideLoading).not.toHaveBeenCalled();
    expect(sdk.setWatermark).not.toHaveBeenCalled();
  });

  it('syncGroup / interactions / type updates', async () => {
    const state = reactive({
      type: 'line' as string,
      data: series as unknown,
      sync: 'a' as unknown,
      interactions: undefined as unknown,
    });
    mountChart(() => ({ type: state.type, data: state.data, syncGroup: state.sync, interactions: state.interactions }));
    await flush();
    const sdk = await ready();
    sdk.calls.length = 0;
    state.sync = { key: 'a' };
    await nextTick();
    expect(sdk.calls).toEqual([]);
    state.sync = null;
    state.interactions = false;
    await nextTick();
    expect(sdk.setSync).toHaveBeenLastCalledWith(null);
    expect(sdk.detach).toHaveBeenCalledTimes(1);

    const grouped = { categories: ['a'], series: [{ name: 's', values: [1] }] };
    state.type = 'bar';
    state.data = grouped;
    await nextTick();
    expect(sdk.renderGroupedBarChart).toHaveBeenLastCalledWith(grouped, undefined);
    state.type = 'histogram';
    state.data = [1, 2];
    await nextTick();
    expect(sdk.renderHistogram).toHaveBeenCalledTimes(1);
  });

  it('useCharturboChart composable with getters, plus create failure', async () => {
    const onError = vi.fn();
    let result: ReturnType<typeof useCharturboChart> | null = null;
    app = createApp(
      defineComponent({
        setup() {
          const canvas = shallowRef<HTMLCanvasElement | null>(null);
          result = useCharturboChart(canvas, { type: 'scatter', data: { x: [1], y: [2] }, onError });
          return () => h('div', [h('canvas', { ref: canvas })]);
        },
      })
    );
    app.mount(host);
    await flush();
    const err = new Error('no-webgpu');
    FakeSDK.rejectNext(err);
    await flush();
    expect(onError).toHaveBeenCalledWith(err);
    expect(result!.error.value).toBe(err);
    expect(result!.sdk.value).toBeNull();
  });

  it('SSR: renders markup without creating an engine', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(CharturboChart, { type: 'line', data: series, class: 'ssr' }) }));
    expect(html).toContain('<canvas');
    expect(html).toContain('ssr');
    expect(FakeSDK.create).not.toHaveBeenCalled();
  });
});
