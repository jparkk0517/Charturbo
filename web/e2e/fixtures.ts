/**
 * Deterministic chart fixtures of the GPU visual regression harness (`npm run test:visual`).
 *
 * Every fixture renders into fixed-size canvases (DPR 1, `autoResize: false`, locale `en-US`)
 * from seeded data (mulberry32), with explicit padding so the plot rectangle never depends on
 * font metrics. Nothing animates: the SDK draws one frame per `render()`.
 * `params` come from the page query (`?p=key:value,...`) so a run can perturb a fixture on
 * purpose (e.g. `color:#ff0000` proves a changed color fails the comparison).
 */

import { CharturboDevice, Charturbo } from '../src/index';
import type { CharturboDeviceBackend } from '../src/index';

export type FixtureTheme = 'dark' | 'light';

export interface FixtureContext {
  /** Card the fixture mounts its canvases into (`position: relative`) */
  card: HTMLElement;
  theme: FixtureTheme;
  backend: CharturboDeviceBackend;
  params: Record<string, string>;
}

export interface FixtureResult {
  /** Backend the engine actually rendered with (detected from the canvas context) */
  backend: CharturboDeviceBackend;
}

export interface Fixture {
  name: string;
  theme: FixtureTheme;
  render(ctx: FixtureContext): Promise<FixtureResult>;
}

/** Card size of single-chart fixtures (CSS px = device px at DPR 1). */
export const FIXTURE_WIDTH = 480;
export const FIXTURE_HEIGHT = 300;

/** Fixed plot margins: tick label widths must not move the plot (fonts differ per machine). */
const PADDING = { top: 36, right: 24, bottom: 36, left: 56 };

/** Seeded PRNG (mulberry32): same sequence on every run / machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal samples (Box-Muller over the seeded PRNG). */
function normals(rand: () => number, n: number, mean = 0, sd = 1): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 2) {
    const u = Math.max(rand(), 1e-12);
    const v = rand();
    const r = Math.sqrt(-2 * Math.log(u));
    out[i] = mean + sd * r * Math.cos(2 * Math.PI * v);
    if (i + 1 < n) out[i + 1] = mean + sd * r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

/** Random walk with a slow sine: line / area fixtures. */
function walk(rand: () => number, n: number, scale: number, base: number): Float32Array {
  const out = new Float32Array(n);
  let v = 0;
  for (let i = 0; i < n; i++) {
    v += (rand() - 0.5) * scale;
    out[i] = base + v + Math.sin((i / n) * Math.PI * 6) * scale * 8;
  }
  return out;
}

function makeCanvas(parent: HTMLElement, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.style.display = 'block';
  parent.appendChild(canvas);
  return canvas;
}

/** Backend of a standalone engine: a WebGL2 canvas returns its context, a WebGPU one null. */
function detectBackend(canvas: HTMLCanvasElement): CharturboDeviceBackend {
  return canvas.getContext('webgl2') ? 'webgl2' : 'webgpu';
}

/** One full-card chart: create, theme, draw via `draw`, render once. */
async function single(
  ctx: FixtureContext,
  draw: (sdk: Charturbo) => void
): Promise<FixtureResult> {
  const canvas = makeCanvas(ctx.card, FIXTURE_WIDTH, FIXTURE_HEIGHT);
  const sdk = await Charturbo.create(canvas, { autoResize: false, locale: 'en-US', timeZone: 'UTC', nodeCount: 0, edgeCount: 0 });
  sdk.setTheme(ctx.theme);
  draw(sdk);
  sdk.render();
  return { backend: detectBackend(canvas) };
}

/** `color` param overrides the first series color (failure drill). */
function firstColor(ctx: FixtureContext): string | undefined {
  return ctx.params.color;
}

function lineSeries(ctx: FixtureContext, n: number, count: number, seed: number) {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, s) => ({
    name: `Series ${s + 1}`,
    values: walk(rand, n, 1, 40 + s * 30),
    color: s === 0 ? firstColor(ctx) : undefined,
  }));
}

const lineFixture = (name: string, theme: FixtureTheme): Fixture => ({
  name,
  theme,
  render: (ctx) =>
    single(ctx, (sdk) => {
      sdk.renderLineChart(lineSeries(ctx, 2_000, 3, 7), { title: 'Line', padding: PADDING, legend: false });
    }),
});

export const FIXTURES: Fixture[] = [
  {
    name: 'scientific3d-cloud', theme: 'dark',
    render: ctx => single(ctx, sdk => {
      const rand = mulberry32(23), data = new Float32Array(1800);
      for (let i = 0; i < 600; i++) data.set([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], i * 3);
      sdk.renderPointCloud3D([{ name: 'Scan', data, size: 5, color: firstColor(ctx) },
        { name: 'Reference', data: [[0, 0, -1], [0, 0, 1]], size: 16, color: '#ff9933' }], { title: 'XYZ cloud', legend: false });
    }),
  },
  ...[false, true].map(wireframe => ({
    name: `scientific3d-surface${wireframe ? '-wire' : ''}`, theme: 'light' as const,
    render: (ctx: FixtureContext) => single(ctx, sdk => {
      const y = Float32Array.from({ length: 17 * 17 }, (_, i) => {
        const x = i % 17 - 8, z = Math.floor(i / 17) - 8;
        return x * x + z * z < 5 ? NaN : Math.sin(x / 3) * Math.cos(z / 3);
      });
      sdk.renderSurface3D([{ name: 'Height', data: { columns: 17, rows: 17, xStart: -8, xStep: 1, zStart: -8, zStep: 1, y }, wireframe }],
        { title: wireframe ? 'Wireframe' : 'Surface with hole' });
    }),
  })),
  {
    name: 'sparse-error-bar', theme: 'dark',
    render: ctx => single(ctx, sdk => {
      sdk.renderErrorBarChart([
        { name: 'Measured', values: [10, 25, NaN, 15, -5, 22], errorLow: [3, 6, 3, 4, 5, 8], errorHigh: 5, capWidth: 14, showCenter: true, color: firstColor(ctx) },
        { name: 'Upper', values: [35, 44, 38, 40, 35, 48], error: 4, errorMode: 'high', drawConnector: false, capWidth: '40%' },
      ], { title: 'Error bars', padding: PADDING, legend: false });
      sdk.setTheme('light'); sdk.setTheme('dark');
    }),
  },
  {
    name: 'sparse-error-horizontal', theme: 'light',
    render: ctx => single(ctx, sdk => {
      sdk.renderErrorBarChart([{ name: 'Interval', x: [10, 20, 30, 40], values: [1, 2, 3, 4], low: [-20, 5, 15, 30], high: [30, 50, 60, 70], direction: 'horizontal', capWidth: 16, showCenter: true }],
        { title: 'Horizontal intervals', padding: PADDING, lineWidth: 2 });
    }),
  },
  {
    name: 'sparse-impulse', theme: 'dark',
    render: ctx => single(ctx, sdk => {
      sdk.renderImpulseChart([
        { name: 'Events', values: [0, 10, -6, NaN, 20, -12, 4, 0, 15], baseline: 0, symbolSize: 7, color: firstColor(ctx) },
        { name: 'Stems', values: [-24, -18, -30, -25, -35, -20, -24, -30, -15], baseline: -25, showMarker: false },
      ], { title: 'Impulse stems', padding: PADDING, legend: false });
    }),
  },
  {
    name: 'line-1m',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        // 1M samples: M4 decimation to pixel columns must keep spikes and stay stable
        const rand = mulberry32(1);
        const values = walk(rand, 1_000_000, 0.2, 0);
        for (let i = 50_000; i < values.length; i += 173_123) values[i] += 60; // spikes M4 keeps
        sdk.renderLineChart([{ name: 'Sensor', values, color: firstColor(ctx) }], {
          title: '1M points',
          padding: PADDING,
          lineWidth: 1.5,
        });
      }),
  },
  lineFixture('line-dark', 'dark'),
  lineFixture('line-light', 'light'),
  {
    name: 'band',
    theme: 'dark',
    render: (ctx) => single(ctx, (sdk) => {
      const x = Float64Array.from({ length: 121 }, (_, i) => i / 10);
      const lower = Float32Array.from(x, (v) => Math.sin(v) * 20);
      const upper = Float32Array.from(x, (v) => Math.cos(v) * 20);
      lower[60] = NaN;
      sdk.renderBandChart([
        { name: 'Crossing', x, lower, upper, color: firstColor(ctx), lowerLineWidth: 2, upperLineWidth: 3 },
        { name: 'Fill only', x, lower: lower.map((v) => v - 35), upper: upper.map((v) => v - 35) },
      ], { title: 'Independent bands', padding: PADDING, fillOpacity: 0.3, legend: false });
      sdk.setTheme('light');
      sdk.setTheme('dark');
    }),
  },
  {
    name: 'area-stacked',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const rand = mulberry32(11);
        const series = ['Search', 'Social', 'Email'].map((name, s) => ({
          name,
          values: Float32Array.from(walk(rand, 400, 0.6, 20 + s * 5), (v) => Math.max(0, v)),
          color: s === 0 ? firstColor(ctx) : undefined,
        }));
        const streaming = ctx.params.streaming === '1';
        sdk.renderAreaChart(streaming ? series.map((s) => ({ ...s, values: s.values.slice(0, 200) })) : series,
          { mode: 'stacked', title: 'Stacked area', padding: PADDING, legend: false });
        // The streamed result must match the existing static baseline on both GPU backends.
        if (streaming) sdk.appendAreaData(series.map((s) => ({ values: s.values.slice(200) })), { maxPoints: 400 });
      }),
  },
  {
    name: 'bar-grouped',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderGroupedBarChart(
          {
            categories: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
            series: [
              { name: 'North', values: [10, 22, 31, 40, 28], color: firstColor(ctx) },
              { name: 'South', values: [6, -5, 15, 22, 12] },
              { name: 'East', values: [14, 18, 9, 30, 35] },
            ],
          },
          { mode: 'grouped', title: 'Grouped bars', padding: PADDING, legend: false }
        );
      }),
  },
  {
    name: 'scatter',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const { x, y, clusters } = scatterData();
        sdk.renderScatterChart(
          { x, y, clusters },
          {
            title: 'Scatter',
            padding: PADDING,
            seriesNames: ['A', 'B', 'C'],
            seriesColors: ctx.params.color ? [ctx.params.color] : undefined,
            legend: false,
            pointRadius: 2.5,
            opacity: 0.85,
          }
        );
      }),
  },
  {
    name: 'candlestick',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const rand = mulberry32(21);
        const n = 120;
        const open = new Float32Array(n);
        const high = new Float32Array(n);
        const low = new Float32Array(n);
        const close = new Float32Array(n);
        const volume = new Float32Array(n);
        let price = 100;
        for (let i = 0; i < n; i++) {
          open[i] = price;
          price += (rand() - 0.48) * 4;
          close[i] = price;
          high[i] = Math.max(open[i], close[i]) + rand() * 2;
          low[i] = Math.min(open[i], close[i]) - rand() * 2;
          volume[i] = 1000 + rand() * 4000;
        }
        // Fixed UTC days: time ticks never depend on "now" or the machine time zone
        const t = Float64Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 1) + i * 86_400_000);
        sdk.renderCandlestickChart(
          { t, open, high, low, close, volume },
          { title: 'OHLC', padding: PADDING, upColor: firstColor(ctx), hollowUp: true }
        );
      }),
  },
  {
    name: 'ohlc',
    theme: 'dark',
    render: (ctx) => single(ctx, (sdk) => {
      const n = ctx.params.dense === '1' ? 50_000 : 32;
      const t = Float64Array.from({ length: n }, (_, i) => Date.UTC(2026, 0, 1) + i * 60_000);
      const open = Float32Array.from({ length: n }, (_, i) => 100 + Math.sin(i / 5) * 8);
      const close = open.map((v, i) => v + (i % 3 - 1) * 3); // down / doji / up
      const high = open.map((v, i) => Math.max(v, close[i]) + 2);
      const low = open.map((v, i) => Math.min(v, close[i]) - 2);
      const volume = open.map((_, i) => 1000 + i % 7 * 300);
      open[7] = NaN;
      sdk.renderOhlcChart({ t, open, high, low, close, volume }, {
        title: 'OHLC bars', padding: PADDING, lineWidth: 2, tickWidth: 0.8,
        upColor: firstColor(ctx),
      });
      sdk.setTheme('light'); // mode must survive theme restyling in the actual engine
      sdk.setTheme('dark');
    }),
  },
  {
    name: 'histogram',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const values = normals(mulberry32(31), 200_000, 50, 12);
        sdk.renderHistogram(values, { bins: 40, range: [0, 100], title: 'Histogram', padding: PADDING, color: firstColor(ctx) });
      }),
  },
  {
    name: 'heatmap',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const cols = 48;
        const rows = 24;
        const rand = mulberry32(41);
        const values = new Float32Array(cols * rows);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            values[r * cols + c] = Math.sin(c / 6) * Math.cos(r / 5) * 10 + rand() * 3;
          }
        }
        values[5 * cols + 7] = NaN; // empty cell
        sdk.renderHeatmap(
          { cols, rows, values, xExtent: [0, cols], yExtent: [0, rows] },
          {
            title: 'Heatmap',
            padding: { ...PADDING, right: 72 },
            colorScale: (ctx.params.scale as 'viridis' | 'magma' | undefined) ?? 'viridis',
            colorbar: { title: 'v' },
          }
        );
      }),
  },
  {
    name: 'line-yzoom',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderLineChart(lineSeries(ctx, 2_000, 3, 7), { title: 'Y zoom', padding: PADDING, legend: false });
        // Manual y window: pinned domain, ticks inside it, strokes clipped at the plot edges
        sdk.setYRange(55, 95);
      }),
  },
  {
    name: 'box-zoom',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderLineChart(lineSeries(ctx, 2_000, 2, 91), { title: 'Box zoom', padding: PADDING, legend: false });
        // Box zoom between two canvas NDC corners: x + y of the box
        sdk.zoomChartBox(-0.4, 0.5, 0.3, -0.3);
      }),
  },
  boxFixture('box', false),
  boxFixture('violin', true),
  pieFixture('pie', 0),
  pieFixture('donut', 0.6),
  {
    name: 'combo',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        // Stacked bars (left) + area on the bar axis + dashed line with markers (right axis);
        // engine hover at a category tints its bars and marks the line point
        sdk.renderComboChart(
          {
            categories: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'],
            series: [
              { name: 'Online', type: 'bar', values: [12, 18, 22, 19, 26, 31, 28, 35], color: firstColor(ctx) },
              { name: 'Retail', type: 'bar', values: [8, 9, 7, 11, 10, 12, 14, 13] },
              { name: 'Target', type: 'area', values: [18, 22, 26, 28, 32, 36, 40, 44] },
              { name: 'Margin %', type: 'line', yAxis: 'right', values: [21, 24, 23, 27, 26, 30, 29, 33], marker: { show: 'always' }, dash: [5, 3] },
            ],
          },
          { barMode: 'stacked', title: 'Combo', padding: { ...PADDING, right: 48 }, legend: false }
        );
        sdk.hoverAtX(Number(ctx.params.hoverX ?? 5));
      }),
  },
  {
    name: 'radar',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderRadarChart(
          {
            axes: ['Speed', 'Range', 'Cost', 'Comfort', 'Safety', 'Tech'],
            series: [
              { name: 'Model A', values: [82, 64, 45, 71, 90, 58], color: firstColor(ctx) },
              { name: 'Model B', values: [55, 88, 70, 62, 74, 81] },
            ],
          },
          { title: 'Radar', max: 100, rings: 4, padding: { top: 64, right: 24, bottom: 24, left: 24 } }
        );
      }),
  },
  {
    name: 'gauge',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderGauge(
          { value: 72 },
          {
            title: 'Gauge',
            min: 0,
            max: 100,
            label: 'CPU load',
            format: '.0f',
            bands: [
              { from: 0, to: 60, status: 'good' },
              { from: 60, to: 85, status: 'warning' },
              { from: 85, to: 100, status: 'critical' },
            ],
            padding: { top: 40, right: 24, bottom: 16, left: 24 },
          }
        );
      }),
  },
  {
    name: 'funnel',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderFunnelChart(
          { labels: ['Visits', 'Sign-ups', 'Trials', 'Paid'], values: [12000, 5400, 2100, 760] },
          { title: 'Funnel', format: ',.0f', color: firstColor(ctx), padding: { top: 40, left: 24, bottom: 16 } }
        );
      }),
  },
  {
    name: 'waterfall',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderWaterfallChart(
          {
            labels: ['Q1 start', 'Sales', 'Services', 'Refunds', 'H1', 'Costs', 'Tax'],
            values: [400, 180, 90, -60, null, -220, -45],
            totals: [4],
          },
          {
            title: 'Waterfall',
            total: 'End',
            format: ',.0f',
            colors: ctx.params.color ? { increase: ctx.params.color } : undefined,
            padding: { ...PADDING, top: 64 },
          }
        );
      }),
  },
  {
    name: 'treemap',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderTreemap(hierarchyData(), {
          title: 'Treemap',
          legend: false,
          padding: { top: 60, right: 12, bottom: 12, left: 12 },
          colors: ctx.params.color ? [ctx.params.color] : undefined,
          format: '$,.0f',
        });
      }),
  },
  {
    name: 'sunburst',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderSunburst(hierarchyData(), {
          title: 'Sunburst',
          legend: false,
          padding: { top: 60, right: 12, bottom: 12, left: 12 },
          colors: ctx.params.color ? [ctx.params.color] : undefined,
          format: '$,.0f',
        });
      }),
  },
  {
    name: 'sankey',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderSankey(
          energyFlows(),
          {
            title: 'Sankey',
            padding: { top: 36, right: 12, bottom: 12, left: 12 },
            colors: ctx.params.color ? [ctx.params.color] : undefined,
          }
        );
      }),
  },
  {
    name: 'sparklines',
    theme: 'light',
    render: async (ctx) => {
      // 4 x 6 grid of 140 x 32 sparklines on one shared device (the dashboard path)
      const device = await CharturboDevice.create({ backend: ctx.backend });
      const grid = document.createElement('div');
      grid.className = 'spark-grid';
      ctx.card.appendChild(grid);
      const types = ['line', 'area', 'bar', 'winloss'] as const;
      const rand = mulberry32(51);
      const engines: Charturbo[] = [];
      for (let i = 0; i < 24; i++) {
        const canvas = makeCanvas(grid, 140, 32);
        const sdk = await Charturbo.create(canvas, { device, autoResize: false, locale: 'en-US', timeZone: 'UTC' });
        sdk.setTheme(ctx.theme);
        const type = types[i % 4];
        const values =
          type === 'winloss'
            ? Float32Array.from({ length: 24 }, () => (rand() < 0.55 ? 1 : rand() < 0.8 ? -1 : 0))
            : walk(rand, 60, 2, 100);
        sdk.renderSparkline(values, {
          type,
          color: i === 0 ? firstColor(ctx) : undefined,
          showLast: type === 'line',
          showMinMax: type === 'line',
          band: type === 'area' ? [95, 105] : undefined,
          label: `Spark ${i}`,
        });
        engines.push(sdk);
      }
      for (const sdk of engines) sdk.render();
      return { backend: device.backend };
    },
  },
  {
    name: 'hover-crosshair',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderLineChart(lineSeries(ctx, 500, 3, 61), {
          title: 'Hover',
          padding: PADDING,
          legend: false,
          hover: { mode: 'index', crosshair: true, markerRadius: 4 },
        });
        // Engine hover at data x (index mode): crosshair + one marker per series, no tooltip DOM
        sdk.hoverAtX(Number(ctx.params.hoverX ?? 300));
      }),
  },
  {
    name: 'navigator',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderLineChart(lineSeries(ctx, 5_000, 2, 71), {
          title: 'Navigator',
          padding: { ...PADDING, bottom: 24 },
          legend: false,
          navigator: { height: 48 },
        });
        sdk.setXRange(1_500, 3_000); // zoom window drawn in the strip
      }),
  },
  {
    name: 'brush-rect',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const { x, y, clusters } = scatterData();
        sdk.renderScatterChart(
          { x, y, clusters },
          {
            title: 'Brush',
            padding: PADDING,
            seriesNames: ['A', 'B', 'C'],
            seriesColors: ctx.params.color ? [ctx.params.color] : undefined,
            legend: false,
            pointRadius: 2.5,
          }
        );
        // Committed xy brush: rectangle + highlighted points inside it
        sdk.selectChartRange([-1, 2], [-1.5, 1.5]);
      }),
  },
  {
    name: 'emphasis-sankey-hover',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderSankey(energyFlows(), { title: 'Sankey hover', padding: { top: 36, right: 12, bottom: 12, left: 12 } });
        // Engine hover of node 4 (Electricity; the keyboard-focus path): its flows lit, the rest dim
        const backend = (sdk as unknown as { backend: { chart_hover_hierarchy_item?(series: number, index: number): unknown } }).backend;
        backend.chart_hover_hierarchy_item?.(0, Number(ctx.params.node ?? 4));
      }),
  },
  {
    name: 'emphasis-treemap-legend',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderTreemap(hierarchyData(), { title: 'Treemap emphasis', legend: false, padding: { top: 60, right: 12, bottom: 12, left: 12 } });
        // Legend hover of group 1: the other groups fade
        sdk.emphasizeSeries(Number(ctx.params.group ?? 1));
      }),
  },
];

function scatterData(): { x: Float32Array; y: Float32Array; clusters: Uint16Array } {
  const rand = mulberry32(81);
  const n = 6_000;
  const centers = [
    [-2, -1],
    [1.5, 1],
    [0, 2.5],
  ];
  const nx = normals(rand, n);
  const ny = normals(rand, n);
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  const clusters = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    const c = i % 3;
    clusters[i] = c;
    x[i] = centers[c][0] + nx[i] * 0.8;
    y[i] = centers[c][1] + ny[i] * 0.7;
  }
  return { x, y, clusters };
}

function boxFixture(name: string, violin: boolean): Fixture {
  return {
    name,
    theme: violin ? 'light' : 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const rand = mulberry32(violin ? 92 : 91);
        const categories = ['Mon', 'Tue', 'Wed', 'Thu'];
        sdk.renderBoxPlot(
          {
            categories,
            series: [
              { name: 'Control', values: categories.map((_, i) => normals(rand, 2_000, 50 + i * 4, 8)), color: firstColor(ctx) },
              { name: 'Treated', values: categories.map((_, i) => normals(rand, 2_000, 46 + i * 2, 12)) },
            ],
          },
          {
            title: violin ? 'Violin' : 'Box plot',
            padding: PADDING,
            legend: false,
            violin: violin ? { showBox: true } : undefined,
            showOutliers: !violin,
            showMean: !violin,
          }
        );
      }),
  };
}

/** Energy flows of the sankey fixtures. */
function energyFlows() {
  const node = (id: string) => ({ id });
  return {
    nodes: ['Coal', 'Gas', 'Solar', 'Wind', 'Electricity', 'Heat', 'Homes', 'Industry', 'Transport', 'Losses'].map(node),
    links: [
      { source: 'Coal', target: 'Electricity', value: 30 },
      { source: 'Coal', target: 'Heat', value: 12 },
      { source: 'Gas', target: 'Electricity', value: 22 },
      { source: 'Gas', target: 'Heat', value: 18 },
      { source: 'Solar', target: 'Electricity', value: 14 },
      { source: 'Wind', target: 'Electricity', value: 16 },
      { source: 'Electricity', target: 'Homes', value: 28 },
      { source: 'Electricity', target: 'Industry', value: 26 },
      { source: 'Electricity', target: 'Transport', value: 8 },
      { source: 'Electricity', target: 'Losses', value: 20 },
      { source: 'Heat', target: 'Homes', value: 16 },
      { source: 'Heat', target: 'Industry', value: 10 },
      { source: 'Heat', target: 'Losses', value: 4 },
      { source: 'Gas', target: 'Transport', value: 6 },
    ],
  };
}

/** Seeded 3-level tree (regions -> categories -> products) of the treemap / sunburst fixtures. */
function hierarchyData() {
  const rand = mulberry32(61);
  const regions = ['Americas', 'Europe', 'Asia', 'Africa', 'Oceania'];
  const scale = [5, 4, 3.5, 1.2, 0.8];
  return {
    name: 'Revenue',
    children: regions.map((region, r) => ({
      name: region,
      children: ['Hardware', 'Software', 'Services'].slice(0, r < 3 ? 3 : 2).map((cat) => ({
        name: `${region.slice(0, 2)} ${cat}`,
        children: Array.from({ length: 2 + Math.floor(rand() * 3) }, (_, k) => ({
          name: `${cat.slice(0, 4)} ${k + 1}`,
          value: Math.round((20 + rand() * 80) * scale[r]),
        })),
      })),
    })),
  };
}

function pieFixture(name: string, donut: number): Fixture {
  return {
    name,
    theme: donut > 0 ? 'light' : 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPieChart(
          { labels: ['Search', 'Direct', 'Social', 'Email', 'Ads', 'Other'], values: [420, 260, 180, 90, 40, 25] },
          {
            title: donut > 0 ? 'Donut' : 'Pie',
            donut,
            sort: 'desc',
            labels: 'outside',
            legend: false,
            padding: { top: 36, right: 24, bottom: 24, left: 24 },
            colors: ctx.params.color ? [ctx.params.color] : undefined,
          }
        );
      }),
  };
}
