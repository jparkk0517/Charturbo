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

/**
 * Scripted mouse gesture on the fixture's chart canvas: `path` is canvas CSS px, the first entry
 * is the press, the last the release (one entry = a click). Ends with a pointer leave so no
 * hover state is left in the shot.
 */
function scriptPointer(ctx: FixtureContext, path: [number, number][]): void {
  const canvas = ctx.card.querySelector('canvas');
  if (!canvas || !path.length) return;
  const r = canvas.getBoundingClientRect();
  const fire = (type: string, [x, y]: [number, number], buttons: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons, clientX: r.left + x, clientY: r.top + y })
    );
  fire('pointerdown', path[0], 1);
  for (const p of path.slice(1)) fire('pointermove', p, 1);
  fire('pointerup', path[path.length - 1], 0);
  fire('pointerleave', path[path.length - 1], 0);
}

/** Canvas CSS px of global point id `id` of the active chart. */
function pointPx(sdk: Charturbo, id: number): [number, number] {
  const p = sdk.projectNodeToScreen(id, FIXTURE_WIDTH, FIXTURE_HEIGHT);
  return p ? [p.x, p.y] : [NaN, NaN];
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
  ...[false, true].map(surface => ({
    name: `scientific3d-ortho-${surface ? 'surface' : 'cloud'}`, theme: 'dark' as const,
    render: (ctx: FixtureContext) => single(ctx, sdk => {
      const options = { title: 'Fixed axes · orthographic', aspect: surface ? [2, 1, 1] as [number, number, number] : 'data' as const,
        axes3d: { x: { min: -4, max: 4, tickCount: 3 }, y: { min: -1, max: 1, tickCount: 3 }, z: { min: -2, max: 2, tickCount: 3 } },
        camera: { type: 'orthographic' as const, orthoSize: 110 } };
      const y = Float32Array.from({ length: 81 }, (_, i) => Math.sin((i % 9 - 4) / 2) * Math.cos((Math.floor(i / 9) - 4) / 2));
      const xyz = Float32Array.from({ length: 243 }, (_, i) => i % 3 === 0 ? Math.floor(i / 3) % 9 - 4 : i % 3 === 1 ? y[Math.floor(i / 3)] : Math.floor(i / 27) / 2 - 2);
      const streaming = ctx.params.streaming === 'true';
      if (surface) {
        sdk.renderSurface3D([{ data: { columns: 9, rows: 9, xStart: -4, xStep: 1, zStart: -2, zStep: 0.5, y: streaming ? new Float32Array(81) : y } }], options);
        if (streaming) { sdk.render(); sdk.updateSurface3D(0, { mode: 'replaceY', y }); }
      } else {
        sdk.renderPointCloud3D([{ data: streaming ? xyz.subarray(0, 120) : xyz, size: 7 }], options);
        if (streaming) { sdk.render(); sdk.appendPointCloud3D(0, xyz.subarray(120)); }
      }
      sdk.setTheme('light'); sdk.setTheme('dark');
      if (sdk.getCameraState()?.orthoSize !== 110) throw new Error('Orthographic size was reset');
      const p = sdk.projectNodeToScreen(40, FIXTURE_WIDTH, FIXTURE_HEIGHT);
      if (!p || Math.abs(p.x - FIXTURE_WIDTH / 2) > 0.1 || Math.abs(p.y - FIXTURE_HEIGHT / 2) > 0.1) throw new Error('3D center projection changed');
    }),
  })),
  ...[false, true].map(ortho => ({
    name: `scientific3d-contours${ortho ? '-ortho' : ''}`, theme: 'dark' as const,
    render: (ctx: FixtureContext) => single(ctx, sdk => {
      const height = (i: number) => { const x = (i % 25 - 12) / 4, z = (Math.floor(i / 25) - 12) / 4; return Math.sin(x) * Math.cos(z) + 0.15 * x; };
      const y = Float32Array.from({ length: 625 }, (_, i) => (i % 25 - 20) ** 2 + (Math.floor(i / 25) - 16) ** 2 < 6 ? NaN : height(i));
      // Streaming starts from the same values reversed: an equal domain keeps the data-aspect framing.
      const streaming = ctx.params.streaming === 'true';
      const contours = { show: true, levels: ortho ? [-0.8, -0.4, 0, 0.4, 0.8] : 9, color: '#ffffff', width: 2 };
      sdk.renderSurface3D([{ name: 'Height', data: { columns: 25, rows: 25, xStart: -3, xStep: 0.25, zStart: -3, zStep: 0.25, y: streaming ? y.slice().reverse() : y },
        colormap: 'viridis', lighting: 0.4, contours }], ortho
        ? { title: 'Contours · orthographic', aspect: [2, 1, 2], axes3d: { y: { min: -1.5, max: 1.5, tickCount: 3 } }, camera: { type: 'orthographic', orthoSize: 100 } }
        : { title: 'Contours · data aspect', aspect: 'data' });
      if (streaming) { sdk.render(); sdk.updateSurface3D(0, { mode: 'replaceY', y }); }
    }),
  })),
  {
    name: 'scientific3d-cloud', theme: 'dark',
    render: ctx => single(ctx, sdk => {
      const rand = mulberry32(23), data = new Float32Array(1800);
      for (let i = 0; i < 600; i++) data.set([rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1], i * 3);
      const streaming = ctx.params.streaming === 'true';
      sdk.renderPointCloud3D([{ name: 'Scan', data: streaming ? new Float32Array([99, 99, 99, ...data.subarray(0, 900)]) : data, size: 5, color: firstColor(ctx) },
        { name: 'Reference', data: [[0, 0, -1], [0, 0, 1]], size: 16, color: '#ff9933' }], { title: 'XYZ cloud', legend: false });
      if (streaming) {
        sdk.render();
        sdk.appendPointCloud3D(0, data.subarray(900), { maxPoints: 600 });
        if (sdk.getNodeDetails(601)?.metadata.attributes?.z !== 1) throw new Error('streamed cloud ids were not rebased');
      }
    }),
  },
  ...[false, true].map(wireframe => ({
    name: `scientific3d-surface${wireframe ? '-wire' : ''}`, theme: 'light' as const,
    render: (ctx: FixtureContext) => single(ctx, sdk => {
      const y = Float32Array.from({ length: 17 * 17 }, (_, i) => {
        const x = i % 17 - 8, z = Math.floor(i / 17) - 8;
        return x * x + z * z < 5 ? NaN : Math.sin(x / 3) * Math.cos(z / 3);
      });
      const streaming = ctx.params.streaming === 'true';
      const size = streaming && wireframe ? 16 : 17;
      const start = streaming && !wireframe ? -9 : -8;
      sdk.renderSurface3D([{ name: 'Height', data: { columns: size, rows: size, xStart: start, xStep: 1, zStart: start, zStep: 1, y: streaming ? new Float32Array(size * size) : y }, wireframe }],
        { title: wireframe ? 'Wireframe' : 'Surface with hole' });
      if (streaming) {
        const height = (x: number, z: number) => x * x + z * z < 5 ? NaN : Math.sin(x / 3) * Math.cos(z / 3);
        sdk.render();
        sdk.updateSurface3D(0, { mode: 'replaceY', y: Float32Array.from({ length: size * size }, (_, i) => height(start + i % size, start + Math.floor(i / size))) });
        sdk.render();
        sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 1, y: Float32Array.from({ length: size }, (_, r) => height(8, start + r)), scrollX: !wireframe });
        sdk.render();
        sdk.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: Float32Array.from({ length: 17 }, (_, c) => height(-8 + c, 8)), scrollZ: !wireframe });
        if (!sdk.exportChartCSV().includes('Height,8,')) throw new Error('streamed surface CSV lost coordinates');
      }
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
    // One track per grouped bar slot across the whole value axis; the negative bar's track
    // rounds its bottom end
    name: 'bar-background',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderGroupedBarChart(
          {
            categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
            series: [
              { name: 'Web', values: [120, 200, 150, -40, 70] },
              { name: 'App', values: [80, 130, NaN, 60, 110] },
            ],
          },
          { title: 'Bar background', padding: PADDING, legend: false, background: true, cornerRadius: 6 }
        );
      }),
  },
  {
    // Horizontal stacks: one track per category across the plot width, custom color
    name: 'bar-background-horizontal',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderGroupedBarChart(
          {
            categories: ['North', 'South', 'East', 'West'],
            series: [
              { name: 'A', values: [30, 12, 25, 8] },
              { name: 'B', values: [20, 18, 10, 14] },
            ],
          },
          {
            mode: 'stacked',
            orientation: 'horizontal',
            title: 'Horizontal background',
            padding: PADDING,
            legend: false,
            background: { color: '#94a3b8', opacity: 0.18 },
          }
        );
      }),
  },
  {
    // Pictorial bars: rounded rects repeated up to a fixed bound (100) and clipped at the value,
    // the background tracks as the shadow bars
    name: 'pictorial-bar-repeat',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPictorialBarChart(
          ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((label, i) => ({ label, value: [72, 45, 90, 30, 61][i] })),
          {
            title: 'Pictorial repeat + clip',
            padding: PADDING,
            background: true,
            symbol: 'roundRect',
            symbolRepeat: 'fixed',
            symbolClip: true,
            symbolBoundingData: 100,
            symbolSize: ['70%', 10],
            symbolMargin: 2,
          }
        );
      }),
  },
  {
    // One stretched path:// / built-in symbol per bar (holes, arcs, curves); the negative bar's
    // arrow points down (mirrored)
    name: 'pictorial-bar-paths',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPictorialBarChart(
          [
            { label: 'Love', value: 40, symbol: 'path://M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z', color: '#f43f5e' },
            { label: 'Stars', value: 55, symbol: 'path://M50 0 L61 35 L98 35 L68 57 L79 91 L50 70 L21 91 L32 57 L2 35 L39 35 Z', color: '#facc15' },
            { label: 'People', value: 30, symbol: 'path://M12 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM8 9h8a2 2 0 0 1 2 2v5h-2.5v7h-7v-7H6v-5a2 2 0 0 1 2-2z', color: '#38bdf8' },
            { label: 'Drop', value: -20, symbol: 'arrow', color: '#a78bfa' },
            { label: 'Pin', value: 25, symbol: 'pin', color: '#34d399' },
          ],
          { title: 'Pictorial paths', padding: PADDING }
        );
      }),
  },
  {
    // Horizontal: person paths repeated along each bar (auto count), the last one cut at the value
    name: 'pictorial-bar-horizontal',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPictorialBarChart(
          ['North', 'South', 'East', 'West'].map((label, i) => ({ label, value: [8.5, 5, 11, 3.2][i] })),
          {
            title: 'Pictorial horizontal',
            padding: PADDING,
            orientation: 'horizontal',
            symbol: 'path://M12 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM8 9h8a2 2 0 0 1 2 2v5h-2.5v7h-7v-7H6v-5a2 2 0 0 1 2-2z',
            symbolRepeat: true,
            symbolClip: true,
            symbolSize: [14, '80%'],
            symbolMargin: '10%',
            background: { color: '#94a3b8', opacity: 0.12 },
          }
        );
      }),
  },
  {
    // Bar values rotated 90° from the base; long category names rotated 40° on the x axis
    name: 'bar-label-rotation',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const categories = ['Northern Europe', 'Southern Europe', 'North America', 'South America', 'East Asia', 'Oceania'];
        sdk.renderGroupedBarChart(
          {
            categories,
            series: [
              { name: 'Forest', values: [320, 332, 301, 390, 330, 280], color: firstColor(ctx) },
              { name: 'Desert', values: [150, 232, 201, 190, 330, 360] },
            ],
          },
          {
            mode: 'grouped',
            title: 'Label rotation',
            padding: { ...PADDING, bottom: 84 },
            legend: false,
            labels: { rotate: 90, position: 'insideBase', format: (v, c) => `${v} ${c.seriesName}` },
            axes: { x: { labelRotate: 40, format: (i) => categories[i] ?? '' } },
          }
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
    // y pieces cut the stroke exactly at 50 / 100 / 150; an x window recolors a dashed series
    name: 'line-pieces',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const rand = mulberry32(23);
        const aqi = Float32Array.from(walk(rand, 240, 6, 90), (v) => Math.max(5, v));
        const base = Float32Array.from({ length: 240 }, (_, i) => 20 + 6 * Math.sin(i / 14));
        sdk.renderLineChart(
          [
            {
              name: 'AQI',
              values: aqi,
              lineWidth: 2.5,
              color: firstColor(ctx),
              pieces: [
                { lte: 50, color: '#16a34a' },
                { gt: 50, lte: 100, color: '#eab308' },
                { gt: 100, lte: 150, color: '#f97316' },
                { gt: 150, color: '#dc2626' },
              ],
            },
            { name: 'Baseline', values: base, dash: [6, 3], piecesBy: 'x', pieces: [{ gte: 80, lt: 160, color: '#7c3aed' }] },
          ],
          { title: 'Pieces', padding: PADDING, legend: false }
        );
      }),
  },
  {
    // x pieces clip a monotone area fill into vertical slabs; y pieces band an overlapping fill
    name: 'area-pieces',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const x = Float64Array.from({ length: 121 }, (_, i) => i / 10);
        const load = Float32Array.from(x, (v) => 40 + 25 * Math.sin(v * 0.9) + 8 * Math.sin(v * 3.1));
        const low = Float32Array.from(x, (v) => 15 + 12 * Math.cos(v * 0.7));
        sdk.renderAreaChart(
          [
            {
              name: 'Load',
              values: load,
              x,
              curve: 'monotone',
              color: firstColor(ctx),
              piecesBy: 'x',
              pieces: [
                { gte: 2, lte: 4, color: '#f59e0b' },
                { gte: 7.5, lte: 9, color: '#ef4444' },
              ],
            },
            { name: 'Reserve', values: low, x, pieces: [{ gt: 22, color: '#38bdf8' }] },
          ],
          { title: 'Area pieces', padding: PADDING, legend: false, fillOpacity: 0.45 }
        );
      }),
  },
  {
    // Streamgraph: wiggle baseline, inside-out order, monotone edges, one stream at 0 for a stretch
    name: 'theme-river',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const rand = mulberry32(23);
        const names = ['DQ', 'TY', 'SS', 'QG', 'SY'];
        const rows: [number, number, string][] = [];
        names.forEach((name, s) => {
          const w = walk(rand, 40, 0.8, 6 + s * 2);
          for (let i = 0; i < 40; i++) {
            const v = name === 'SS' && i >= 14 && i < 22 ? 0 : Math.max(0, w[i] + 4 * Math.sin(i / 6 + s));
            rows.push([i, v, name]);
          }
        });
        sdk.renderThemeRiverChart(rows, {
          order: 'insideOut',
          title: 'ThemeRiver',
          padding: PADDING,
          legend: false,
          colors: { DQ: firstColor(ctx) ?? '#3987e5' },
        });
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
  pieFixture('pie-rose', 0.2, { rose: 'area' }),
  {
    // Strip plot: 4 categories x 60 points on the same x, jittered by +-0.3
    name: 'scatter-jitter',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const n = 240;
        const x = Float32Array.from({ length: n }, (_, i) => i % 4);
        const y = Float32Array.from({ length: n }, (_, i) => 50 + Math.sin(i * 1.7) * 12 + (i % 4) * 6);
        const clusters = Uint16Array.from({ length: n }, (_, i) => i % 4);
        sdk.renderScatterChart({ x, y, clusters }, { title: 'Jitter', pointRadius: 3.5, jitter: { x: 0.3 }, legend: false });
      }),
  },
  {
    // Linear fit of one series, exponential (dashed) + cubic fits of the other, clipped to the plot
    name: 'scatter-trendline',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const n = 120;
        const x = Float32Array.from({ length: n }, (_, i) => (i >> 1) * 0.17);
        const y = Float32Array.from({ length: n }, (_, i) =>
          i % 2 ? 1.5 * Math.exp(0.3 * x[i]) * (1 + Math.sin(i * 2.3) * 0.15) : 4 + 1.6 * x[i] + Math.sin(i * 1.7) * 2.5
        );
        const clusters = Uint16Array.from({ length: n }, (_, i) => i % 2);
        sdk.renderScatterChart(
          { x, y, clusters },
          {
            title: 'Trendlines',
            pointRadius: 3.5,
            seriesNames: ['Linear', 'Growth'],
            legend: { position: 'right' },
            trendline: [
              { type: 'linear', series: [0] },
              { type: 'exponential', series: [1], dash: [6, 4] },
              { type: 'polynomial', order: 3, series: [1], color: '#e11d48', width: 1.5 },
            ],
          }
        );
      }),
  },
  {
    // Ripple rings frozen 1 s into the cycle around circles and triangles
    name: 'scatter-ripple',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderScatterChart(
          { x: [2, 5, 8, 3, 7], y: [3, 7, 4, 8, 2], clusters: [0, 0, 0, 1, 1] },
          { title: 'Ripple', pointRadius: 7, seriesSymbols: ['circle', 'triangle'], ripple: { scale: 3, period: 3 } }
        );
        sdk.setEffectTime(1);
      }),
  },
  {
    // Four series, four symbols; the legend swatches follow
    name: 'scatter-symbols',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const n = 160;
        const x = Float32Array.from({ length: n }, (_, i) => (i % 40) + (i >> 5) * 0.3);
        const y = Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.37) * 8 + (i % 4) * 6);
        const clusters = Uint16Array.from({ length: n }, (_, i) => i % 4);
        sdk.renderScatterChart(
          { x, y, clusters },
          {
            title: 'Symbols',
            pointRadius: 5,
            seriesNames: ['circle', 'square', 'diamond', 'triangle'],
            seriesSymbols: ['circle', 'square', 'diamond', 'triangle'],
          }
        );
      }),
  },
  {
    // Side legend column sized to the names; 14 entries page behind ‹ ›
    name: 'legend-right-paged',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const labels = ['Search', 'Direct', 'Social', 'Email', 'Ads', 'Video', 'Partners', 'Affiliates', 'Podcasts', 'Events', 'Print', 'Radio', 'TV', 'Other'];
        sdk.renderPieChart(
          { labels, values: labels.map((_, i) => 40 - i * 2.5) },
          { title: 'Legend right', donut: 0.5, maxSlices: false, labels: 'none', legend: { position: 'right' }, padding: { top: 36 } }
        );
      }),
  },
  {
    // Bottom row: 12 series do not fit one row, the pager pages them
    name: 'legend-bottom-paged',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const series = Array.from({ length: 12 }, (_, k) => ({
          name: `Sensor ${String.fromCharCode(65 + k)}`,
          values: Float32Array.from({ length: 200 }, (_, i) => Math.sin(i / 20 + k) * 10 + k * 3),
        }));
        sdk.renderLineChart(series, { title: 'Legend bottom', legend: { position: 'bottom' } });
      }),
  },
  pieFixture('pie-half-donut', 0.55, { startAngle: -90, endAngle: 90 }),
  pieFixture('pie-pad-angle', 0.5, { padAngle: 4 }),
  pieFixture('pie-rounded', 0.5, { padAngle: 3, cornerRadius: 8 }),
  {
    name: 'pie-rings',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPieChart(
          {
            rings: [
              { name: 'Channel', labels: ['Direct', 'Marketing', 'Search'], values: [1548, 775, 679] },
              { name: 'Source', labels: ['Baidu', 'Direct', 'Email', 'Google', 'Bing'], values: [1048, 335, 310, 251, 147] },
            ],
          },
          { title: 'Rings', legend: false, padding: { top: 36, right: 24, bottom: 24, left: 24 } }
        );
      }),
  },
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
    // Three y axes (weather): temperature left, rain right, pressure on an extra colored right
    // axis; padding grows for the extra label slot and title
    name: 'axes-multi-line',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const n = 48;
        const temp = Array.from({ length: n }, (_, i) => 14 + 8 * Math.sin((i / n) * Math.PI * 2 - 1.2));
        const rain = Array.from({ length: n }, (_, i) => Math.max(0, 6 * Math.sin(i / 3.1) + 2 * Math.cos(i / 1.7)));
        const pressure = Array.from({ length: n }, (_, i) => 1008 + 7 * Math.cos(i / 9));
        sdk.renderLineChart(
          [
            { name: 'Temp', values: temp, color: firstColor(ctx) },
            { name: 'Rain', values: rain, yAxis: 'right' },
            { name: 'Pressure', values: pressure, yAxisIndex: 2, color: '#c2410c' },
          ],
          {
            title: 'Three y axes',
            legend: false,
            axes: {
              y: { title: '°C' },
              y2: { title: 'mm', min: 0 },
              extraY: [{ title: 'hPa', color: '#c2410c', format: (v) => v.toFixed(0) }],
            },
          }
        );
      }),
  },
  {
    // One outlier bar: the y break collapses 40..430, zigzag across the plot and the axis
    name: 'axes-break-bar',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const values = [22, 31, 18, 460, 27, 35, 24];
        sdk.renderBarChart(
          labels.map((label, i) => ({ label, value: values[i], color: firstColor(ctx) })),
          { title: 'Axis break', padding: PADDING, axes: { y: { breaks: [{ start: 40, end: 430, gap: '8%' }] } } }
        );
      }),
  },
  {
    // Broken y axis on a line: two breaks; segments crossing a break stay continuous
    name: 'axes-break-line',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const n = 60;
        const a = Array.from({ length: n }, (_, i) => (i < 20 ? 10 + 3 * Math.sin(i / 2) : i < 40 ? 210 + 4 * Math.cos(i / 3) : 610 + 5 * Math.sin(i / 4)));
        sdk.renderLineChart([{ name: 'Load', values: a, color: firstColor(ctx) }], {
          title: 'Broken line',
          padding: PADDING,
          legend: false,
          axes: { y: { breaks: [{ start: 25, end: 195, gap: 6 }, { start: 225, end: 595, gap: 6 }] } },
        });
      }),
  },
  {
    // Point editing: a scripted drag lifts point 3 of an editable line (clamped by `max`)
    name: 'edit-drag-line',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const canvas = ctx.card.querySelector('canvas')!;
        sdk.renderLineChart(
          [{ name: 'Target', values: [42, 48, 55, 51, 63, 70, 74, 69], color: firstColor(ctx), marker: { shape: 'circle', size: 8, show: 'always' } }],
          { title: 'Drag a point', padding: PADDING, legend: false, animation: false, axes: { y: { min: 0, max: 100 } } }
        );
        sdk.enableNodeInteractions(canvas, { builtInTooltip: false, editable: { dragAxis: 'y', max: 90 } });
        sdk.render();
        const [x, y] = pointPx(sdk, 3);
        scriptPointer(ctx, [[x, y], [x, y - 40], [x, y - 400]]);
      }),
  },
  {
    // Point editing: click to add on an empty spot, then an xy drag of point 0
    name: 'edit-add-scatter',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const canvas = ctx.card.querySelector('canvas')!;
        const x = Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
        const y = Float32Array.from([2, 4, 3, 6, 5, 7, 6, 8]);
        const clusters = Uint16Array.from([0, 0, 0, 0, 1, 1, 1, 1]);
        sdk.renderScatterChart({ x, y, clusters }, { title: 'Click to add', pointRadius: 6, legend: false, animation: false });
        sdk.enableNodeInteractions(canvas, { builtInTooltip: false, editable: { dragAxis: 'xy', addOnClick: true, addSeries: 1 } });
        sdk.render();
        const [x1] = pointPx(sdk, 7);
        const [x0, y0] = pointPx(sdk, 0);
        const [x2] = pointPx(sdk, 1);
        const [, y7] = pointPx(sdk, 5);
        scriptPointer(ctx, [[x2, y7]]); // (2, 7) is empty: a new series-1 point
        scriptPointer(ctx, [[x0, y0], [x0 + 20, y0], [x1, y0]]); // point 0 to the bottom right
      }),
  },
  {
    // Finance combo: volume bars (left), price (right), RSI on an extra left axis
    name: 'axes-multi-combo',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const categories = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10'];
        sdk.renderComboChart(
          {
            categories,
            series: [
              { name: 'Volume', type: 'bar', values: [12, 18, 15, 22, 30, 26, 19, 24, 28, 21], color: firstColor(ctx) },
              { name: 'Price', type: 'line', yAxis: 'right', values: [101, 104, 103, 108, 112, 109, 111, 115, 118, 116] },
              { name: 'RSI', type: 'line', yAxisIndex: 2, values: [48, 55, 52, 61, 70, 64, 58, 66, 72, 63], dash: [4, 3], color: '#e5a50a' },
            ],
          },
          {
            title: 'Three y axes combo',
            legend: false,
            axes: { y: { title: 'Volume' }, y2: { title: 'Price' }, extraY: [{ title: 'RSI', position: 'left', min: 0, max: 100, color: '#e5a50a' }] },
          }
        );
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
    name: 'calendar',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const rand = mulberry32(53);
        const data: [string, number | null][] = [];
        for (let d = 0; d < 365; d++) {
          const iso = new Date(Date.UTC(2023, 0, 1 + d)).toISOString().slice(0, 10);
          data.push([iso, d % 29 === 3 ? null : Math.round(rand() * 10 + (d % 7 < 5 ? 5 : 0))]);
        }
        sdk.renderCalendarHeatmap(data, {
          range: 2023,
          firstDay: 1,
          title: 'Calendar',
          valueLabel: 'Commits',
          colorScale: (ctx.params.scale as 'viridis' | 'magma' | undefined) ?? 'viridis',
          padding: { top: 48, left: 24 },
        });
      }),
  },
  {
    name: 'calendar-vertical',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const rand = mulberry32(59);
        const data: [string, number][] = [];
        for (let d = 0; d < 120; d++) data.push([new Date(Date.UTC(2024, 0, 1 + d)).toISOString().slice(0, 10), Math.round(rand() * 100)]);
        sdk.renderCalendarHeatmap(data, {
          ranges: ['2024-01', ['2024-03-01', '2024-04-30']],
          orient: 'vertical',
          cellSize: 14,
          title: 'Calendar (vertical)',
          colorScale: 'sequential',
          color: ctx.params.color,
          splitLine: { width: 2 },
          padding: { top: 48 },
        });
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
    name: 'sankey-vertical-gradient',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderSankey(energyFlows(), {
          title: 'Vertical sankey',
          orient: 'vertical',
          linkColor: 'gradient',
          levels: [{ column: 0, linkOpacity: 0.7 }, { column: 2, color: '#64748b' }],
          padding: { top: 36, right: 12, bottom: 12, left: 12 },
        });
      }),
  },
  {
    name: 'tree',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderTree(treeData(), {
          title: 'Tree',
          initialTreeDepth: -1,
          padding: { top: 36, right: 12, bottom: 12, left: 12 },
          colors: ctx.params.color ? [ctx.params.color] : undefined,
        });
      }),
  },
  {
    name: 'tree-tb-polyline',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderTree(treeData(), {
          title: 'Top-down tree',
          orient: 'TB',
          edgeShape: 'polyline',
          symbol: 'rect',
          initialTreeDepth: 2,
          labels: false,
          padding: { top: 36, right: 12, bottom: 12, left: 12 },
        });
      }),
  },
  {
    name: 'tree-radial',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderTree(treeData(), {
          title: 'Radial tree',
          layout: 'radial',
          initialTreeDepth: -1,
          colorBy: 'group',
          padding: { top: 36, right: 12, bottom: 12, left: 12 },
        });
      }),
  },
  {
    name: 'graph2d-force',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderGraph(graph2dData(), {
          title: 'Force graph',
          layout: 'force',
          symbolSize: [8, 20],
          force: { repulsion: 60, edgeLength: 30 },
          labels: false,
          colors: ctx.params.color ? [ctx.params.color] : undefined,
        });
      }),
  },
  {
    name: 'graph2d-circular',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderGraph(graph2dData(), {
          title: 'Circular graph',
          layout: 'circular',
          rotateLabel: true,
          symbolSize: [6, 16],
          curveness: 0.3,
          edgeSymbol: 'arrow',
          edgeColor: 'source',
        });
      }),
  },
  {
    name: 'graph2d-cartesian',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const quarters = ['Q1', 'Q2', 'Q3', 'Q4'];
        sdk.renderGraph(
          {
            nodes: [
              { name: 'a', x: 'Q1', y: 1.2, category: 0 }, { name: 'b', x: 'Q1', y: 2.4, category: 0 },
              { name: 'c', x: 'Q2', y: 3.1, category: 1 }, { name: 'd', x: 'Q3', y: 6.5, category: 2 },
              { name: 'e', x: 'Q3', y: 4.2, category: 2 }, { name: 'f', x: 'Q4', y: 8.8, category: 3 },
            ],
            links: [{ source: 'a', target: 'c' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }, { source: 'c', target: 'e' }, { source: 'd', target: 'f' }],
            categories: ['Research', 'Build', 'Market', 'Scale'],
          },
          {
            title: 'Cartesian graph',
            layout: 'cartesian',
            xAxis: { categories: quarters },
            yAxis: { min: 0, max: 10 },
            symbolSize: 12,
            edgeSymbol: 'arrow',
            labels: false,
            padding: { ...PADDING, top: 64 },
          }
        );
      }),
  },
  {
    name: 'chord',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderChordChart(
          {
            names: ['Black', 'Blond', 'Brown', 'Red'],
            matrix: [
              [11975, 5871, 8916, 2868],
              [1951, 10048, 2060, 6171],
              [8010, 16145, 8090, 8045],
              [1013, 990, 940, 6907],
            ],
          },
          { title: 'Chord', format: ',.0f', padding: { top: 40 } }
        );
      }),
  },
  {
    name: 'chord-directed',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderChordChart(
          {
            nodes: ['North', 'East', 'South', 'West', 'Center'],
            links: [
              { source: 'North', target: 'East', value: 9 },
              { source: 'East', target: 'North', value: 3 },
              { source: 'North', target: 'South', value: 5 },
              { source: 'South', target: 'West', value: 7 },
              { source: 'West', target: 'South', value: 2 },
              { source: 'West', target: 'Center', value: 6 },
              { source: 'Center', target: 'North', value: 4 },
              { source: 'East', target: 'Center', value: 8 },
            ],
          },
          {
            title: 'Directed chord',
            directed: true,
            ribbonColor: 'gradient',
            sortSubgroups: 'descending',
            labelRotate: true,
            padAngle: 4,
            startAngle: 90,
            padding: { top: 40 },
          }
        );
      }),
  },
  {
    name: 'parallel',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderParallelChart(parallelCars(ctx.params.color), {
          title: 'Parallel',
          opacity: 0.7,
          lineWidth: 1.5,
          legend: false,
          padding: { top: 48, right: 24, bottom: 16, left: 56 },
        });
      }),
  },
  {
    name: 'parallel-brush',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderParallelChart(parallelCars(), {
          title: 'Parallel brush',
          colorBy: 'MPG',
          colorScale: (ctx.params.scale as 'viridis' | 'magma' | undefined) ?? 'viridis',
          opacity: 0.8,
          inactiveOpacity: 0.15,
          brush: [
            { dimension: 'Origin', range: ['EU', 'JP'] },
            { dimension: 'Weight', range: [1800, 2600] },
            { dimension: 'Weight', range: [3200, 3600] },
          ],
          padding: { top: 48, left: 56 },
        });
      }),
  },
  {
    name: 'parallel-vertical-smooth',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderParallelChart(parallelCars(), {
          title: 'Vertical parallel',
          orient: 'vertical',
          smooth: true,
          opacity: 0.6,
          legend: false,
          padding: { top: 40, right: 24, bottom: 28, left: 88 },
        });
      }),
  },
  {
    name: 'polar-bar',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPolarChart(
          {
            series: [
              { type: 'bar', name: 'A', data: [5, 8, 3, 6, 9, 4] },
              { type: 'bar', name: 'B', data: [3, 4, 6, 2, 5, 7], roundCap: true },
            ],
          },
          { title: 'Polar bar', angleAxis: { data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, innerRadius: 0.15, legend: false, padding: { top: 40 } }
        );
      }),
  },
  {
    name: 'polar-stacked',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPolarChart(
          {
            series: [
              { type: 'bar', name: 'A', data: [40, 28, 35, 22], stack: 's' },
              { type: 'bar', name: 'B', data: [25, 30, 18, 26], stack: 's' },
              { type: 'bar', name: 'C', data: [12, 18, 22, 15], stack: 's' },
            ],
          },
          {
            title: 'Stacked radial bar',
            radiusAxis: { data: ['N', 'S', 'E', 'W'] },
            angleAxis: { max: 100 },
            startAngle: 90,
            innerRadius: 0.2,
            legend: false,
            padding: { top: 40 },
          }
        );
      }),
  },
  {
    name: 'polar-line',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const curve = Array.from({ length: 24 }, (_, k) => [2 + Math.sin((k * 15 * Math.PI) / 45) * 1.2, k * 15]);
        const dots = Array.from({ length: 12 }, (_, k) => [1 + ((k * 37) % 23) / 6, (k * 53) % 360]);
        sdk.renderPolarChart(
          {
            series: [
              { type: 'line', name: 'Curve', data: curve, smooth: true, closed: true, area: true, symbolSize: 4 },
              { type: 'scatter', name: 'Dots', data: dots, symbolSize: 6 },
            ],
          },
          { title: 'Polar line', angleAxis: { min: 0, max: 360, splitNumber: 8 }, radiusAxis: { min: 0, max: 5 }, clockwise: false, legend: false, padding: { top: 40 } }
        );
      }),
  },
  {
    name: 'polar-heatmap',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const hours = Array.from({ length: 12 }, (_, h) => `${h * 2}h`);
        const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
        const cells = days.flatMap((_, d) => hours.map((_, h) => [d, h, (d * 7 + h * 5) % 13]));
        sdk.renderPolarChart(
          { series: [{ type: 'heatmap', name: 'Load', data: cells }] },
          {
            title: 'Polar heatmap',
            angleAxis: { data: hours },
            radiusAxis: { data: days },
            innerRadius: 0.2,
            colorScale: 'viridis',
            padding: { top: 40 },
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
  // Races / transitions: no deterministic animation clock, so these capture the end state after
  // the animated re-render (finishAnimation): the final layers must be restored exactly
  {
    name: 'race-bar-end',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const year = (k: number) =>
          ['Aria', 'Brix', 'Cove', 'Dune', 'Echo', 'Fern', 'Gale'].map((label, i) => ({ label, value: 20 + ((i * 37 + k * 53) % 90), color: i === 0 ? firstColor(ctx) : undefined }));
        const opts = {
          title: 'Bar race',
          padding: { ...PADDING, left: 64, right: 48 },
          orientation: 'horizontal' as const,
          labels: true,
          realtimeSort: { max: 5 },
          animation: { duration: 400 },
        };
        sdk.renderBarChart(year(0), opts);
        sdk.render();
        sdk.renderBarChart(year(1), opts);
        sdk.render();
        sdk.finishAnimation();
      }),
  },
  {
    name: 'race-line-end',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderLineChart(lineSeries(ctx, 200, 3, 11), { title: 'Line race', padding: { ...PADDING, right: 96 }, legend: false, endLabel: true, animation: { duration: 400 } });
        sdk.render();
        sdk.finishAnimation();
      }),
  },
  {
    name: 'transition-bar-pie-end',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const labels = ['North', 'South', 'East', 'West'];
        const values = [40, 25, 20, 15];
        const animation = { duration: 400, transition: true };
        sdk.renderBarChart(labels.map((label, i) => ({ label, value: values[i] })), { title: 'Bar to pie', padding: PADDING, animation });
        sdk.render();
        sdk.renderPieChart({ labels, values }, { title: 'Bar to pie', padding: PADDING, legend: false, animation });
        sdk.render();
        sdk.finishAnimation();
      }),
  },
  {
    name: 'transition-treemap-sunburst-end',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const animation = { duration: 400, transition: true };
        const padding = { top: 36, right: 12, bottom: 12, left: 12 };
        sdk.renderTreemap(hierarchyData(), { title: 'Treemap to sunburst', legend: false, padding, animation });
        sdk.render();
        sdk.renderSunburst(hierarchyData(), { title: 'Treemap to sunburst', legend: false, padding, animation });
        sdk.render();
        sdk.finishAnimation();
      }),
  },
  {
    // Lit 3D scene without textures: guards the mesh shader against untextured regressions
    name: 'scene-untextured',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.setGraphVisible(false);
        sdk.setRigidPhysics(false);
        sdk.addPlane({ position: [0, -1, 0], scale: [160, 2, 110], color: [0.2, 0.24, 0.32, 1], roughness: 0.9 });
        sdk.addBox({ position: [-40, 9, 0], rotation: [0, 0.6, 0], scale: [18, 18, 18], color: [0.25, 0.6, 1, 1], roughness: 0.5 });
        sdk.addSphere({ position: [0, 10, 5], scale: [20, 20, 20], color: [0.85, 0.55, 0.25, 1], roughness: 0.3, metallic: 0.4 });
        sdk.addCylinder({ position: [40, 10, 0], scale: [14, 20, 14], color: [0.4, 0.85, 0.5, 1], roughness: 0.6 });
        sdk.setLighting({
          ambientIntensity: 0.3,
          directionalDirection: [-0.4, -1, -0.3],
          directionalIntensity: 0.9,
          pointPosition: [30, 40, 40],
          pointIntensity: 0.6,
        });
        sdk.setCameraPose([0, 60, 110], [0, 8, 0]);
      }),
  },
  {
    // Same layout as scene-untextured with checkerboard maps: UV orientation (red corner = image
    // top-left), repeat on the plane (minified, so mips), offset, and an alpha-tested cutout
    name: 'scene-textured',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.setGraphVisible(false);
        sdk.setRigidPhysics(false);
        const size = 64;
        const cell = 8;
        const rgba = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
            const corner = x < cell && y < cell;
            rgba.set(corner ? [255, 40, 40, 255] : on ? [255, 255, 255, 255] : [40, 40, 40, 255], i);
          }
        }
        const checker = sdk.createDataTexture(size, size, rgba);
        const holes = new Uint8Array(rgba);
        for (let i = 3; i < holes.length; i += 4) {
          const p = (i - 3) / 4;
          if ((Math.floor((p % size) / cell) + Math.floor(Math.floor(p / size) / cell)) % 2 === 1) holes[i] = 0;
        }
        const cutout = sdk.createDataTexture(size, size, holes);
        sdk.addPlane({ position: [0, -1, 0], scale: [160, 2, 110], color: [0.6, 0.65, 0.8, 1], roughness: 0.9, map: checker, mapRepeat: [8, 6] });
        sdk.addBox({ position: [-40, 9, 0], rotation: [0, 0.6, 0], scale: [18, 18, 18], color: [1, 1, 1, 1], roughness: 0.5, map: checker });
        sdk.addSphere({ position: [0, 10, 5], scale: [20, 20, 20], color: [1, 0.85, 0.6, 1], roughness: 0.3, map: checker, mapRepeat: [4, 2], mapOffset: [0.25, 0] });
        sdk.addCylinder({ position: [40, 10, 0], scale: [14, 20, 14], color: [0.6, 1, 0.7, 1], roughness: 0.6, map: cutout });
        sdk.setLighting({
          ambientIntensity: 0.3,
          directionalDirection: [-0.4, -1, -0.3],
          directionalIntensity: 0.9,
          pointPosition: [30, 40, 40],
          pointIntensity: 0.6,
        });
        sdk.setCameraPose([0, 60, 110], [0, 8, 0]);
      }),
  },
  {
    // Rich text bar labels: two lines, mixed sizes, a rounded badge run
    name: 'bar-rich-labels',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        const labels = ['North', 'South', 'East', 'West'];
        const values = [42, 31, 55, 27];
        const growth = [12, -4, 18, 3];
        sdk.renderBarChart(
          labels.map((label, i) => ({ label, value: values[i], color: i === 0 ? firstColor(ctx) : undefined })),
          {
            title: 'Rich labels',
            padding: { ...PADDING, top: 64 },
            labels: {
              format: (v, c) => `{v|${v}}{u|k}\n{${growth[c.category] >= 0 ? 'up' : 'down'}|${growth[c.category]}%}`,
              rich: {
                v: { fontSize: 15, fontWeight: 'bold' },
                u: { fontSize: 10, color: '#64748b' },
                up: { color: '#ffffff', backgroundColor: '#16a34a', padding: [1, 4], borderRadius: 6, fontSize: 10 },
                down: { color: '#ffffff', backgroundColor: '#dc2626', padding: [1, 4], borderRadius: 6, fontSize: 10 },
              },
            },
          }
        );
      }),
  },
  {
    name: 'pie-rich-labels',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPieChart(
          { labels: ['Search', 'Direct', 'Social', 'Email'], values: [420, 260, 180, 90] },
          {
            title: 'Rich pie labels',
            labels: 'outside',
            legend: false,
            padding: { top: 36, right: 24, bottom: 24, left: 24 },
            colors: ctx.params.color ? [ctx.params.color] : undefined,
            label: {
              formatter: (c) => `{n|${c.name}}\n{p|${c.percent.toFixed(0)}%} {v|${c.value}}`,
              rich: { n: { fontWeight: 600 }, p: { fontSize: 13, fontWeight: 'bold', color: '#60a5fa' }, v: { fontSize: 10, color: '#94a3b8' } },
            },
          }
        );
      }),
  },
  {
    name: 'treemap-rich-labels',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderTreemap(hierarchyData(), {
          title: 'Rich treemap labels',
          legend: false,
          padding: { top: 60, right: 12, bottom: 12, left: 12 },
          label: {
            formatter: (c) => `{n|${c.name}}\n{v|${c.value}}`,
            rich: { n: { fontWeight: 'bold' }, v: { fontSize: 10, fontStyle: 'italic' } },
          },
        });
      }),
  },
  {
    // Tiled rotated text over a bar chart (the full shot; the canvas shot hides DOM layers)
    name: 'watermark-text',
    theme: 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderBarChart(
          ['Q1', 'Q2', 'Q3', 'Q4'].map((label, i) => ({ label, value: [18, 24, 30, 36][i], color: i === 0 ? firstColor(ctx) : undefined })),
          { title: 'Watermark', padding: PADDING }
        );
        sdk.setWatermark({ text: 'CONFIDENTIAL', fontSize: 14, fontWeight: 600, opacity: 0.25, gap: [60, 50], fontFamily: 'sans-serif' });
      }),
  },
  {
    // Spinner frozen (no animation) so the shot is stable
    name: 'loading',
    theme: 'light',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderLineChart(lineSeries(ctx, 200, 2, 11), { title: 'Loading', padding: PADDING, legend: false });
        sdk.showLoading({ text: 'Loading data…' });
        for (const el of ctx.card.querySelectorAll<HTMLElement>('.charturbo-sdk-loading-spinner')) el.style.animation = 'none';
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

/** Fixed 4-category network of the 2D graph fixtures (ring per category, hub links between them). */
function graph2dData() {
  const nodes: { id: string; name: string; value: number; category: number }[] = [];
  const links: { source: string; target: string }[] = [];
  for (let c = 0; c < 4; c++) {
    for (let m = 0; m < 6; m++) {
      nodes.push({ id: `${c}-${m}`, name: `N${c}${m}`, value: 1 + ((c * 5 + m * 3) % 7), category: c });
      links.push({ source: `${c}-${m}`, target: `${c}-${(m + 1) % 6}` });
    }
    links.push({ source: `${c}-0`, target: `${(c + 1) % 4}-0` }, { source: `${c}-3`, target: `${c}-0` });
  }
  return { nodes, links, categories: ['Alpha', 'Beta', 'Gamma', 'Delta'] };
}

/** Seeded cars (two series) of the parallel coordinates fixtures: value, category, time and inverted axes. */
function parallelCars(color?: string) {
  const rand = mulberry32(83);
  const origins = ['US', 'EU', 'JP'];
  const make = (count: number, heavy: number) =>
    Array.from({ length: count }, () => {
      const o = Math.floor(rand() * 3);
      const year = 1970 + Math.floor(rand() * 12);
      const weight = Math.round(1700 + heavy * 1500 * rand() + (o === 0 ? 500 : 0));
      const mpg = Math.round(46 - weight / 140 + (year - 1970) * 0.4 + rand() * 4);
      return [mpg, origins[o], new Date(Date.UTC(year, 0, 1)), weight] as (number | string | Date)[];
    });
  return {
    dimensions: ['MPG', { name: 'Origin', categories: origins }, { name: 'Year', type: 'time' as const }, { name: 'Weight', inverse: true }],
    series: [
      { name: 'Sedan', data: make(40, 0.6), color },
      { name: 'Truck', data: make(20, 1.2) },
    ],
  };
}

/** Fixed 4-level tree of the tidy tree fixtures (uneven fan-out; one branch starts collapsed). */
function treeData() {
  const leaves = (prefix: string, n: number) => Array.from({ length: n }, (_, k) => ({ name: `${prefix}${k + 1}` }));
  return {
    name: 'core',
    children: [
      { name: 'chart', children: [{ name: 'line', children: leaves('l', 3) }, { name: 'bar', children: leaves('b', 2) }, { name: 'pie' }] },
      { name: 'scene', children: [{ name: 'mesh', children: leaves('m', 4) }, { name: 'light' }] },
      { name: 'graph', collapsed: true, children: leaves('g', 5) },
      { name: 'svg' },
      { name: 'wasm', children: [{ name: 'bind', children: leaves('w', 2) }] },
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

function pieFixture(
  name: string,
  donut: number,
  extra: { rose?: 'radius' | 'area'; startAngle?: number; endAngle?: number; padAngle?: number; cornerRadius?: number } = {}
): Fixture {
  return {
    name,
    theme: donut > 0 ? 'light' : 'dark',
    render: (ctx) =>
      single(ctx, (sdk) => {
        sdk.renderPieChart(
          { labels: ['Search', 'Direct', 'Social', 'Email', 'Ads', 'Other'], values: [420, 260, 180, 90, 40, 25] },
          {
            title: extra.rose ? 'Rose' : extra.endAngle !== undefined ? 'Half donut' : extra.cornerRadius ? 'Rounded donut' : extra.padAngle ? 'Padded donut' : donut > 0 ? 'Donut' : 'Pie',
            donut,
            ...extra,
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
