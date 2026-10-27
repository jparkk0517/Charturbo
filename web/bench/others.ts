/**
 * Cross-library adapters of the benchmark comparison (`?lib=uplot|echarts|chartjs|plotly|viz`).
 * Each library gets its documented large-data settings (see docs/BENCHMARKS.md):
 *  - uPlot: typed-array columns, no points (its line path already folds pixel columns); scatter
 *    = mode 2 with a custom square drawer (uPlot scatter demo style)
 *  - ECharts (canvas): typed-array data, `sampling: 'lttb'` (line), `large: true` (scatter /
 *    bar), animation off, inside dataZoom for the x / y window
 *  - Chart.js: `parsing: false`, `normalized: true`, animation off, decimation plugin
 *    (`min-max`) for lines, `pointRadius: 0`
 *  - Plotly: `scattergl` (WebGL) traces (the gl2d bundle has no bar trace)
 *  - viz: the same SDK calls as ours.ts, with the window set through `setXRange` / `setYRange`
 * Libraries are loaded with dynamic imports, so the viz-only scenario pages never load them.
 */

import { VizEngineSDK } from '../src/index';
import type { CompareId } from './ours';
import * as gen from './data';

export type LibName = 'viz' | 'uplot' | 'echarts' | 'chartjs' | 'plotly' | 'chartgpu' | 'scichart' | 'highcharts';

export interface Domain {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface LibAdapter {
  /** Full render of the dataset (creates / re-creates the chart); resolves once drawn */
  render(): Promise<void>;
  /** Shows the data window (y ignored by line / bar charts); the library redraws on its own */
  setWindow(w: Domain): void;
  /** Element that receives the hover sweep's pointer / mouse events */
  hoverTarget(): Element | null;
  /** Re-render without the window / interaction support (bar zoom etc.) */
  zoomable: boolean;
  destroy(): void;
}

export interface CompareData {
  domain: Domain;
  line?: Float32Array;
  xs?: Float64Array;
  scatter?: { x: Float32Array; y: Float32Array };
  bars?: { labels: string[]; values: Float32Array };
}

export function compareData(id: CompareId): CompareData {
  if (id === 'scatter-1m') {
    const s = gen.scatter(1_000_000);
    return { scatter: s, domain: extent2(s.x, s.y) };
  }
  if (id === 'bar-10k') {
    const bars = gen.bars(10_000);
    return { bars, domain: { x0: 0, x1: bars.values.length - 1, y0: 0, y1: 100 } };
  }
  const n = id === 'line-10m-1s' ? 10_000_000 : 1_000_000;
  const line = gen.lineSeries(n, 1)[0];
  const xs = new Float64Array(line.length);
  for (let i = 0; i < xs.length; i++) xs[i] = i;
  return { line, xs, domain: { x0: 0, x1: line.length - 1, ...extent1(line) } };
}

function extent1(v: Float32Array): { y0: number; y1: number } {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < v.length; i++) {
    if (v[i] < lo) lo = v[i];
    if (v[i] > hi) hi = v[i];
  }
  return { y0: lo, y1: hi };
}

function extent2(x: Float32Array, y: Float32Array): Domain {
  const a = extent1(x);
  const b = extent1(y);
  return { x0: a.y0, x1: a.y1, y0: b.y0, y1: b.y1 };
}

const COLOR = '#2a6fdb';
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export async function createAdapter(lib: LibName, card: HTMLElement, data: CompareData, w: number, h: number, backendHook?: (sdk: VizEngineSDK) => void): Promise<LibAdapter> {
  switch (lib) {
    case 'viz':
      return vizAdapter(card, data, w, h, backendHook);
    case 'uplot':
      return uplotAdapter(card, data, w, h);
    case 'echarts':
      return echartsAdapter(card, data, w, h);
    case 'chartjs':
      return chartjsAdapter(card, data, w, h);
    case 'plotly':
      return plotlyAdapter(card, data, w, h);
    case 'chartgpu':
      return chartgpuAdapter(card, data, w, h);
    case 'scichart':
      return scichartAdapter(card, data, w, h);
    case 'highcharts':
      return highchartsAdapter(card, data, w, h);
  }
}

async function vizAdapter(card: HTMLElement, d: CompareData, w: number, h: number, hook?: (sdk: VizEngineSDK) => void): Promise<LibAdapter> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(canvas);
  const sdk = await VizEngineSDK.create(canvas, { autoResize: false, locale: 'en-US', timeZone: 'UTC', nodeCount: 0, edgeCount: 0 });
  sdk.setTheme('light');
  sdk.enableNodeInteractions(canvas, { autoRender: true });
  hook?.(sdk);
  const padding = { top: 36, right: 24, bottom: 36, left: 64 };
  return {
    zoomable: !d.bars,
    async render() {
      if (d.line) sdk.renderLineChart([{ name: 'S1', values: d.line }], { padding, lineWidth: 1, legend: false });
      else if (d.scatter) sdk.renderScatterChart(d.scatter, { padding, pointRadius: 1.5, opacity: 0.6 });
      else if (d.bars) sdk.renderBarChart(d.bars.labels.map((label, i) => ({ label, value: d.bars!.values[i] })), { padding });
      sdk.render();
    },
    setWindow(win) {
      sdk.setXRange(win.x0, win.x1);
      if (d.scatter) sdk.setYRange(win.y0, win.y1);
      sdk.render();
    },
    hoverTarget: () => canvas,
    destroy: () => sdk.dispose(),
  };
}

async function uplotAdapter(card: HTMLElement, d: CompareData, w: number, h: number): Promise<LibAdapter> {
  const { default: uPlot } = await import('uplot');
  await import('uplot/dist/uPlot.min.css');
  let u: InstanceType<typeof uPlot> | null = null;
  const build = () => {
    if (d.line) {
      return new uPlot(
        { width: w, height: h, scales: { x: { time: false } }, legend: { show: false }, series: [{}, { stroke: COLOR, width: 1, points: { show: false } }] },
        [d.xs!, d.line] as unknown as uPlot.AlignedData,
        card
      );
    }
    if (d.bars) {
      const xs = Float64Array.from(d.bars.values, (_, i) => i);
      return new uPlot(
        {
          width: w,
          height: h,
          scales: { x: { time: false } },
          legend: { show: false },
          series: [{}, { fill: COLOR, stroke: COLOR, width: 0, paths: uPlot.paths.bars!({ size: [0.6, 100] }), points: { show: false } }],
        },
        [xs, d.bars.values] as unknown as uPlot.AlignedData,
        card
      );
    }
    // Scatter: x-sorted data is not required in mode 2 (facets). The built-in `paths.points()`
    // builds one Path2D of 1M arcs, which Chrome leaves blank, so the points are drawn by a custom
    // path builder like uPlot's own scatter demo (3 px squares, returns null = draw every redraw)
    const s = d.scatter!;
    const drawPoints = (u: InstanceType<typeof uPlot>, si: number) => {
      const [xs, ys] = (u.data as unknown as [Float32Array, Float32Array][])[si];
      const { left, top, width, height } = u.bbox;
      const sx = u.scales.x;
      const sy = u.scales.y;
      const kx = width / (sx.max! - sx.min!);
      const ky = height / (sy.max! - sy.min!);
      const size = 3 * uPlot.pxRatio;
      const half = size / 2;
      const ctx = u.ctx;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, width, height);
      ctx.clip();
      ctx.fillStyle = COLOR;
      ctx.globalAlpha = 0.6;
      for (let i = 0; i < xs.length; i++) {
        const x = left + (xs[i] - sx.min!) * kx;
        const y = top + height - (ys[i] - sy.min!) * ky;
        if (x < left - half || x > left + width + half || y < top - half || y > top + height + half) continue;
        ctx.fillRect(x - half, y - half, size, size);
      }
      ctx.restore();
      return null;
    };
    return new uPlot(
      {
        mode: 2,
        width: w,
        height: h,
        legend: { show: false },
        scales: { x: { time: false } },
        series: [{}, { stroke: COLOR, fill: COLOR, paths: drawPoints, points: { show: false } }],
      } as unknown as uPlot.Options,
      [null, [s.x, s.y]] as unknown as uPlot.AlignedData,
      card
    );
  };
  return {
    zoomable: true,
    async render() {
      u?.destroy();
      u = build();
    },
    setWindow(win) {
      u?.batch(() => {
        u!.setScale('x', { min: win.x0, max: win.x1 });
        if (d.scatter) u!.setScale('y', { min: win.y0, max: win.y1 });
      });
    },
    hoverTarget: () => card.querySelector('.u-over'),
    destroy: () => u?.destroy(),
  };
}

async function echartsAdapter(card: HTMLElement, d: CompareData, w: number, h: number): Promise<LibAdapter> {
  const echarts = await import('echarts');
  const el = document.createElement('div');
  Object.assign(el.style, { width: `${w}px`, height: `${h}px` });
  card.appendChild(el);
  const chart = echarts.init(el, null, { renderer: 'canvas', width: w, height: h, devicePixelRatio: 1 });
  const flat = (x: ArrayLike<number>, y: ArrayLike<number>) => {
    const out = new Float64Array(y.length * 2);
    for (let i = 0; i < y.length; i++) {
      out[2 * i] = x[i];
      out[2 * i + 1] = y[i];
    }
    return out;
  };
  const grid = { left: 64, right: 24, top: 36, bottom: 36 };
  let option: Record<string, unknown>;
  if (d.line) {
    option = {
      animation: false,
      grid,
      tooltip: { trigger: 'axis', animation: false },
      xAxis: { type: 'value', min: 'dataMin', max: 'dataMax' },
      yAxis: { type: 'value', scale: true },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }],
      series: [{ type: 'line', data: flat(d.xs!, d.line), dimensions: ['x', 'y'], showSymbol: false, sampling: 'lttb', lineStyle: { width: 1, color: COLOR }, large: true }],
    };
  } else if (d.scatter) {
    option = {
      animation: false,
      grid,
      tooltip: { trigger: 'item', animation: false },
      xAxis: { type: 'value', scale: true },
      yAxis: { type: 'value', scale: true },
      dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'empty' }, { type: 'inside', yAxisIndex: 0, filterMode: 'empty' }],
      series: [{ type: 'scatter', data: flat(d.scatter.x, d.scatter.y), dimensions: ['x', 'y'], symbolSize: 3, large: true, largeThreshold: 2000, itemStyle: { color: COLOR, opacity: 0.6 } }],
    };
  } else {
    option = {
      animation: false,
      grid,
      tooltip: { trigger: 'axis', animation: false },
      xAxis: { type: 'category', data: d.bars!.labels },
      yAxis: { type: 'value' },
      dataZoom: [{ type: 'inside', xAxisIndex: 0 }],
      series: [{ type: 'bar', data: Array.from(d.bars!.values), large: true, itemStyle: { color: COLOR } }],
    };
  }
  return {
    zoomable: true,
    render: () =>
      new Promise<void>((resolve) => {
        chart.off('finished');
        chart.on('finished', () => resolve());
        chart.setOption(option, { notMerge: true });
      }),
    setWindow(win) {
      chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 0, startValue: win.x0, endValue: win.x1 });
      if (d.scatter) chart.dispatchAction({ type: 'dataZoom', dataZoomIndex: 1, startValue: win.y0, endValue: win.y1 });
    },
    hoverTarget: () => el.querySelector('canvas'),
    destroy: () => chart.dispose(),
  };
}

async function chartjsAdapter(card: HTMLElement, d: CompareData, w: number, h: number): Promise<LibAdapter> {
  const cj = await import('chart.js');
  cj.Chart.register(cj.LineController, cj.ScatterController, cj.BarController, cj.LineElement, cj.PointElement, cj.BarElement, cj.LinearScale, cj.CategoryScale, cj.Decimation, cj.Tooltip);
  const canvas = document.createElement('canvas');
  Object.assign(canvas.style, { width: `${w}px`, height: `${h}px`, display: 'block' });
  card.appendChild(canvas);
  // Chart.js needs one {x, y} object per sample with `parsing: false` (built once, not timed)
  const points = (x: ArrayLike<number>, y: ArrayLike<number>) => Array.from({ length: y.length }, (_, i) => ({ x: x[i], y: y[i] }));
  const data = d.line ? points(d.xs!, d.line) : d.scatter ? points(d.scatter.x, d.scatter.y) : Array.from(d.bars!.values);
  let chart: InstanceType<typeof cj.Chart> | null = null;
  const build = () => {
    const common = {
      animation: false as const,
      responsive: false,
      devicePixelRatio: 1,
      parsing: false as const,
      normalized: true,
      events: ['mousemove', 'mouseout'] as ('mousemove' | 'mouseout')[],
    };
    if (d.line) {
      return new cj.Chart(canvas, {
        type: 'line',
        data: { datasets: [{ data: data as { x: number; y: number }[], borderColor: COLOR, borderWidth: 1, pointRadius: 0, spanGaps: true }] },
        options: {
          ...common,
          interaction: { mode: 'nearest', axis: 'x', intersect: false },
          scales: { x: { type: 'linear', min: d.domain.x0, max: d.domain.x1 } },
          plugins: { decimation: { enabled: true, algorithm: 'min-max' }, tooltip: { enabled: true } },
        },
      });
    }
    if (d.scatter) {
      return new cj.Chart(canvas, {
        type: 'scatter',
        data: { datasets: [{ data: data as { x: number; y: number }[], backgroundColor: COLOR, pointRadius: 1.5, borderWidth: 0 }] },
        options: { ...common, scales: { x: { type: 'linear', min: d.domain.x0, max: d.domain.x1 }, y: { type: 'linear', min: d.domain.y0, max: d.domain.y1 } } },
      });
    }
    return new cj.Chart(canvas, {
      type: 'bar',
      data: { labels: d.bars!.labels, datasets: [{ data: data as number[], backgroundColor: COLOR }] },
      options: { ...common, parsing: undefined, normalized: undefined, interaction: { mode: 'index', intersect: false }, scales: { x: { type: 'category' } } },
    });
  };
  canvas.width = w;
  canvas.height = h;
  return {
    zoomable: true,
    async render() {
      chart?.destroy();
      chart = build();
    },
    setWindow(win) {
      if (!chart) return;
      const scales = chart.options.scales as Record<string, { min?: number; max?: number }>;
      scales.x.min = win.x0;
      scales.x.max = win.x1;
      if (d.scatter) {
        scales.y.min = win.y0;
        scales.y.max = win.y1;
      }
      chart.update('none');
    },
    hoverTarget: () => canvas,
    destroy: () => chart?.destroy(),
  };
}

/**
 * ChartGPU adapter — WebGPU-native charting library (MIT, no key required).
 * Uses `setZoomRange(start, end)` for the x-axis window: ChartGPU's zoom API is percent of the
 * data domain ([0, 100]), so absolute x values are converted on every setWindow call. Its zoom is
 * x-only, so scatter shows the full window (the y half of the schedule is not applied).
 * Bar charts use `type: 'bar'` with category-type x-axis and integer category indices.
 */
async function chartgpuAdapter(card: HTMLElement, d: CompareData, w: number, h: number): Promise<LibAdapter> {
  const { createChart } = await import('chartgpu');
  const el = document.createElement('div');
  Object.assign(el.style, { width: `${w}px`, height: `${h}px` });
  card.appendChild(el);
  const grid = { left: 64, right: 24, top: 36, bottom: 36 };
  const dataZoom = [{ type: 'inside' as const, xAxisIndex: 0 }];

  let chart: Awaited<ReturnType<typeof createChart>> | null = null;
  const build = async () => {
    chart?.dispose();
    if (d.line) {
      chart = await createChart(el, {
        animation: false,
        grid,
        xAxis: { type: 'value' as const, min: d.domain.x0, max: d.domain.x1 },
        yAxis: { type: 'value' as const },
        dataZoom,
        series: [{ type: 'line' as const, data: { x: d.xs!, y: d.line }, color: COLOR, sampling: 'lttb', lineStyle: { width: 1 } }],
      });
    } else if (d.scatter) {
      chart = await createChart(el, {
        animation: false,
        grid,
        xAxis: { type: 'value' as const },
        yAxis: { type: 'value' as const },
        dataZoom,
        series: [{ type: 'scatter' as const, data: { x: d.scatter.x, y: d.scatter.y }, color: COLOR, symbolSize: 3 }],
      });
    } else {
      // Bar: category axis with integer indices as categories
      const n = d.bars!.values.length;
      const xs = new Float32Array(n);
      for (let i = 0; i < n; i++) xs[i] = i;
      chart = await createChart(el, {
        animation: false,
        grid,
        xAxis: { type: 'category' as const },
        yAxis: { type: 'value' as const },
        series: [{ type: 'bar' as const, data: { x: xs, y: d.bars!.values }, color: COLOR }],
      });
    }
  };

  return {
    zoomable: !d.bars,
    async render() {
      await build();
    },
    setWindow(win) {
      if (!chart) return;
      const span = d.domain.x1 - d.domain.x0;
      chart.setZoomRange((100 * (win.x0 - d.domain.x0)) / span, (100 * (win.x1 - d.domain.x0)) / span);
    },
    hoverTarget: () => el.querySelector('canvas'),
    destroy: () => chart?.dispose(),
  };
}

/**
 * SciChart adapter — WebGL2/WebGPU canvas-based charting library (community watermark, no key needed).
 * WASM files are served from the local node_modules `_wasm/` directory via Vite's static asset
 * serving. The shared wasm context is used so all bench runs in a session share one context.
 * scatter uses `XyScatterRenderableSeries` with a 3px `SquarePointMarker`;
 * bar uses `FastColumnRenderableSeries` with relative `dataPointWidth: 0.8`.
 */
async function scichartAdapter(card: HTMLElement, d: CompareData, w: number, h: number): Promise<LibAdapter> {
  const sc = await import('scichart');
  // Point wasm loader at the files Vite serves from /node_modules/scichart/_wasm/
  sc.SciChartSurface.configure({
    wasmUrl: '/node_modules/scichart/_wasm/scichart.wasm',
    wasmNoSimdUrl: '/node_modules/scichart/_wasm/scichart-nosimd.wasm',
  });
  // Community license: shows a watermark; no key required for evaluation
  sc.SciChartSurface.UseCommunityLicense();

  const div = document.createElement('div');
  Object.assign(div.style, { width: `${w}px`, height: `${h}px` });
  card.appendChild(div);

  const { sciChartSurface, wasmContext } = await sc.SciChartSurface.create(div);
  sciChartSurface.xAxes.add(new sc.NumericAxis(wasmContext, { autoRange: sc.EAutoRange.Never }));
  // Scatter gets an explicit y window (zoom schedule); line / bar keep y fitted to the visible data
  sciChartSurface.yAxes.add(new sc.NumericAxis(wasmContext, { autoRange: d.scatter ? sc.EAutoRange.Never : sc.EAutoRange.Always }));

  // XyDataSeries takes number[] | Float64Array (copied into wasm memory once, not timed)
  const xs = d.line ? d.xs! : d.scatter ? Float64Array.from(d.scatter.x) : Float64Array.from(d.bars!.values, (_, i) => i);
  const ys = Float64Array.from(d.line ?? d.scatter?.y ?? d.bars!.values);
  const dataSeries = new sc.XyDataSeries(wasmContext, {
    dataIsSortedInX: !d.scatter,
    containsNaN: false,
  });
  dataSeries.appendRange(xs, ys);

  if (d.line) {
    sciChartSurface.renderableSeries.add(
      new sc.FastLineRenderableSeries(wasmContext, { dataSeries, stroke: COLOR, strokeThickness: 1, resamplingMode: sc.EResamplingMode.MinMax })
    );
  } else if (d.scatter) {
    sciChartSurface.renderableSeries.add(
      new sc.XyScatterRenderableSeries(wasmContext, {
        dataSeries,
        pointMarker: new sc.SquarePointMarker(wasmContext, { width: 3, height: 3, fill: COLOR, stroke: COLOR }),
      })
    );
  } else {
    sciChartSurface.renderableSeries.add(
      new sc.FastColumnRenderableSeries(wasmContext, { dataSeries, fill: COLOR, stroke: COLOR, dataPointWidth: 0.8 })
    );
  }

  const xAxis = sciChartSurface.xAxes.get(0);
  const yAxis = sciChartSurface.yAxes.get(0);

  return {
    zoomable: !d.bars,
    async render() {
      xAxis.visibleRange = new sc.NumberRange(d.domain.x0, d.domain.x1);
      if (d.scatter) yAxis.visibleRange = new sc.NumberRange(d.domain.y0, d.domain.y1);
      const drawn = sciChartSurface.nextStateRender();
      sciChartSurface.invalidateElement();
      await drawn;
    },
    setWindow(win) {
      xAxis.visibleRange = new sc.NumberRange(win.x0, win.x1);
      if (d.scatter) yAxis.visibleRange = new sc.NumberRange(win.y0, win.y1);
      sciChartSurface.invalidateElement();
    },
    hoverTarget: () => div.querySelector('canvas'),
    destroy: () => sciChartSurface.delete(),
  };
}

/**
 * Highcharts adapter: SVG charting library plus the Boost module (WebGL) for large series.
 * Boost kicks in above `boostThreshold` points; `useGPUTranslations` + `usePreallocated` are the
 * documented large-data settings. Data goes in as [x, y] tuples (Boost's fastest input besides
 * plain y arrays). Bars use `type: 'column'`. Commercial license; evaluation use needs no key.
 */
async function highchartsAdapter(card: HTMLElement, d: CompareData, w: number, h: number): Promise<LibAdapter> {
  // ESM build: importing the boost module registers it on the shared Highcharts namespace
  const { default: Highcharts } = await import('highcharts/esm/highcharts.js');
  await import('highcharts/esm/modules/boost.js');

  const el = document.createElement('div');
  Object.assign(el.style, { width: `${w}px`, height: `${h}px` });
  card.appendChild(el);

  const BOOST_THRESHOLD = 5000;
  let hc: ReturnType<typeof Highcharts.chart> | null = null;

  const build = () => {
    hc?.destroy();
    if (d.line) {
      const data = Array.from({ length: d.line.length }, (_, i) => [d.xs![i], d.line![i]] as [number, number]);
      hc = Highcharts.chart(el, {
        chart: { animation: false, width: w, height: h },
        title: { text: undefined },
        legend: { enabled: false },
        credits: { enabled: false },
        boost: { enabled: true, useGPUTranslations: true, usePreallocated: true },
        xAxis: { min: d.domain.x0, max: d.domain.x1 },
        yAxis: { title: { text: undefined } },
        series: [{ type: 'line', data, color: COLOR, lineWidth: 1, marker: { enabled: false }, boostThreshold: BOOST_THRESHOLD }],
      });
    } else if (d.scatter) {
      const data = Array.from({ length: d.scatter.x.length }, (_, i) => [d.scatter!.x[i], d.scatter!.y[i]] as [number, number]);
      hc = Highcharts.chart(el, {
        chart: { animation: false, width: w, height: h },
        title: { text: undefined },
        legend: { enabled: false },
        credits: { enabled: false },
        boost: { enabled: true, useGPUTranslations: true, usePreallocated: true },
        xAxis: { title: { text: undefined } },
        yAxis: { title: { text: undefined } },
        series: [{ type: 'scatter', data, color: COLOR, marker: { radius: 1.5 }, boostThreshold: BOOST_THRESHOLD }],
      });
    } else {
      hc = Highcharts.chart(el, {
        chart: { animation: false, type: 'column', width: w, height: h },
        title: { text: undefined },
        legend: { enabled: false },
        credits: { enabled: false },
        boost: { enabled: true },
        xAxis: { categories: d.bars!.labels },
        yAxis: { title: { text: undefined } },
        series: [{ type: 'column', data: Array.from(d.bars!.values), color: COLOR, boostThreshold: BOOST_THRESHOLD }],
      });
    }
  };

  return {
    zoomable: true,
    async render() {
      build();
      await frame();
    },
    setWindow(win) {
      if (!hc) return;
      hc.xAxis[0].setExtremes(win.x0, win.x1, !d.scatter, false);
      if (d.scatter) hc.yAxis[0].setExtremes(win.y0, win.y1, true, false);
    },
    hoverTarget: () => el.querySelector('.highcharts-plot-background') ?? el,
    destroy: () => hc?.destroy(),
  };
}

async function plotlyAdapter(card: HTMLElement, d: CompareData, w: number, h: number): Promise<LibAdapter> {
  if (d.bars) throw new Error('unsupported: the plotly gl2d bundle has no bar trace');
  const Plotly = (await import('plotly.js-gl2d-dist-min')).default as {
    newPlot(el: HTMLElement, data: unknown[], layout: unknown, config: unknown): Promise<unknown>;
    relayout(el: HTMLElement, update: unknown): Promise<unknown>;
    purge(el: HTMLElement): void;
  };
  const el = document.createElement('div');
  Object.assign(el.style, { width: `${w}px`, height: `${h}px` });
  card.appendChild(el);
  const trace = d.line
    ? { type: 'scattergl', mode: 'lines', x: d.xs, y: d.line, line: { width: 1, color: COLOR }, hoverinfo: 'x+y' }
    : { type: 'scattergl', mode: 'markers', x: d.scatter!.x, y: d.scatter!.y, marker: { size: 3, color: COLOR, opacity: 0.6 } };
  const layout = { width: w, height: h, margin: { l: 64, r: 24, t: 36, b: 36 }, showlegend: false, hovermode: 'closest' };
  let pending: Promise<unknown> | null = null;
  return {
    zoomable: true,
    async render() {
      Plotly.purge(el);
      await Plotly.newPlot(el, [trace], layout, { displayModeBar: false, responsive: false });
      await frame();
    },
    setWindow(win) {
      // One relayout in flight at a time (Plotly queues them otherwise)
      if (pending) return;
      const update: Record<string, unknown> = { 'xaxis.range': [win.x0, win.x1] };
      if (d.scatter) update['yaxis.range'] = [win.y0, win.y1];
      pending = Plotly.relayout(el, update).finally(() => (pending = null));
    },
    hoverTarget: () => el.querySelector('.nsewdrag') ?? el,
    destroy: () => Plotly.purge(el),
  };
}
