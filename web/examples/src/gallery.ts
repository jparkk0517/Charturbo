/**
 * Gallery (index.html): one card per family with a live preview. All previews share one GPU
 * device (`VizDevice`): one adapter / device and one pipeline set for the whole page.
 */
import './style.css';
import { VizDevice, VizEngineSDK } from 'viz-engine-sdk';
import { FAMILIES, renderHeader } from './families';

declare global {
  interface Window {
    __ready?: boolean;
  }
}

const wave = (n: number, phase: number, base: number, amp: number) =>
  Float32Array.from({ length: n }, (_, i) => base + Math.sin(i / (n / 9) + phase) * amp + Math.cos(i / (n / 23) + phase) * amp * 0.35);
const quiet = { title: undefined, legend: false } as const;
const pad = { top: 10, right: 10, bottom: 22, left: 34 };

const lineSeries = [
  { name: 'A', values: wave(400, 0, 50, 18) },
  { name: 'B', values: wave(400, 1.4, 42, 12) },
];
const groupedBars = {
  categories: ['Q1', 'Q2', 'Q3', 'Q4', 'Q5'],
  series: [
    { name: 'North', values: [12, 18, 24, 21, 28] },
    { name: 'South', values: [9, 12, 15, 19, 17] },
  ],
};

/** Preview of each family (static: no interactions). */
const PREVIEWS: Record<string, (sdk: VizEngineSDK) => void> = {
  line: (sdk) => sdk.renderLineChart(lineSeries, { ...quiet, padding: pad }),
  bar: (sdk) => sdk.renderGroupedBarChart(groupedBars, { ...quiet, padding: pad }),
  scatter: (sdk) => {
    const n = 3000;
    const x = new Float32Array(n);
    const y = new Float32Array(n);
    const clusters = new Uint16Array(n);
    for (let i = 0; i < n; i++) {
      const c = i % 3;
      const a = i * 2.399963;
      const r = Math.sqrt((i % 997) / 997) * 1.1;
      clusters[i] = c;
      x[i] = [-1.6, 1.2, 0][c] + Math.cos(a) * r;
      y[i] = [-0.8, 0.6, 1.9][c] + Math.sin(a) * r * 0.8;
    }
    sdk.renderScatterChart({ x, y, clusters }, { ...quiet, seriesNames: ['A', 'B', 'C'], pointRadius: 1.6, padding: pad });
  },
  candlestick: (sdk) => {
    const n = 60;
    const open = new Float32Array(n);
    const close = new Float32Array(n);
    const high = new Float32Array(n);
    const low = new Float32Array(n);
    let p = 100;
    for (let i = 0; i < n; i++) {
      open[i] = p;
      p += Math.sin(i * 1.7) * 3 + Math.cos(i / 6) * 1.5;
      close[i] = p;
      high[i] = Math.max(open[i], close[i]) + 1 + (i % 3);
      low[i] = Math.min(open[i], close[i]) - 1 - (i % 2);
    }
    sdk.renderCandlestickChart({ open, high, low, close }, { title: undefined, padding: pad, hollowUp: true });
  },
  heatmap: (sdk) => {
    const cols = 40;
    const rows = 16;
    const values = Float32Array.from({ length: cols * rows }, (_, k) => Math.sin((k % cols) / 5) * Math.cos(Math.floor(k / cols) / 3));
    sdk.renderHeatmap({ cols, rows, values }, { title: undefined, colorScale: 'viridis', colorbar: false, padding: pad });
  },
  box: (sdk) => {
    const sample = (mean: number, sd: number) =>
      Float32Array.from({ length: 400 }, (_, i) => mean + sd * Math.sin(i * 12.9898) * Math.sqrt(-2 * Math.log(((i * 7919) % 997) / 997 + 0.001)));
    sdk.renderBoxPlot(
      { categories: ['Mon', 'Tue', 'Wed', 'Thu'], series: [{ name: 'Latency', values: [sample(50, 8), sample(56, 10), sample(48, 6), sample(60, 12)] }] },
      { ...quiet, padding: pad, violin: { showBox: true } }
    );
  },
  pie: (sdk) =>
    sdk.renderPieChart(
      { labels: ['Search', 'Direct', 'Social', 'Email', 'Other'], values: [420, 260, 180, 90, 60] },
      { ...quiet, donut: 0.6, labels: 'none', padding: { top: 8, right: 8, bottom: 8, left: 8 } }
    ),
  combo: (sdk) =>
    sdk.renderComboChart(
      {
        categories: ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A'],
        series: [
          { name: 'Online', type: 'bar', values: [12, 18, 22, 19, 26, 31, 28, 35] },
          { name: 'Target', type: 'line', values: [18, 20, 23, 26, 28, 30, 33, 36], marker: { show: 'always' } },
        ],
      },
      { ...quiet, padding: pad }
    ),
  business: (sdk) =>
    sdk.renderGauge(
      { value: 72 },
      {
        title: undefined,
        min: 0,
        max: 100,
        format: '.0f',
        bands: [
          { from: 0, to: 60, status: 'good' },
          { from: 60, to: 85, status: 'warning' },
          { from: 85, to: 100, status: 'critical' },
        ],
        padding: { top: 12, right: 12, bottom: 4, left: 12 },
      }
    ),
  hierarchy: (sdk) =>
    sdk.renderTreemap(
      {
        name: 'All',
        children: ['Americas', 'Europe', 'Asia', 'Africa'].map((region, r) => ({
          name: region,
          children: [0, 1, 2].map((k) => ({ name: `${region} ${k + 1}`, value: (4 - r) * (30 + k * 17) })),
        })),
      },
      { ...quiet, labels: false, padding: { top: 8, right: 8, bottom: 8, left: 8 } }
    ),
  sparklines: (sdk) => sdk.renderSparkline(wave(80, 0.5, 100, 9), { type: 'area', showLast: true, showMinMax: true }),
  animation: (sdk) => sdk.renderGroupedBarChart(groupedBars, { ...quiet, mode: 'stacked', padding: pad }),
  export: (sdk) => sdk.renderAreaChart(lineSeries, { ...quiet, mode: 'stacked', padding: pad }),
  react: (sdk) => sdk.renderLineChart(lineSeries, { ...quiet, padding: pad, hover: { mode: 'index' } }),
  vue: (sdk) => sdk.renderBarChart(['A', 'B', 'C', 'D', 'E'].map((label, i) => ({ label, value: [7, 12, 9, 15, 11][i] })), { ...quiet, padding: pad }),
};

async function main() {
  document.body.prepend(renderHeader(''));
  const mainEl = document.querySelector('main')!;
  const intro = document.createElement('section');
  intro.className = 'intro';
  intro.innerHTML =
    '<h1>viz-engine-sdk examples</h1><p>Rust + WebGPU charts (WebGL2 fallback). Every page shows live charts next to their source.</p>';
  const grid = document.createElement('div');
  grid.className = 'gallery';
  mainEl.append(intro, grid);

  const canvases = FAMILIES.map((f) => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = `./${f.id}.html`;
    card.innerHTML = `<div class="preview"><canvas></canvas></div><div class="body"><h2></h2><p></p></div>`;
    card.querySelector('h2')!.textContent = f.title;
    card.querySelector('p')!.textContent = f.description;
    grid.appendChild(card);
    return { id: f.id, canvas: card.querySelector('canvas')! };
  });

  try {
    const device = await VizDevice.create();
    for (const { id, canvas } of canvases) {
      try {
        const sdk = await VizEngineSDK.create(canvas, { device, locale: 'en-US' });
        PREVIEWS[id]?.(sdk);
        sdk.render();
      } catch (err) {
        console.error(`[examples] ${id} preview failed`, err);
      }
    }
  } catch (err) {
    console.error('[examples] shared device unavailable', err);
  }
  window.__ready = true;
}

void main();
