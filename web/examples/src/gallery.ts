/**
 * Gallery (gallery.html): one card per family with a live preview. All previews share one GPU
 * device (`CharturboDevice`): one adapter / device and one pipeline set for the whole page.
 */
// First: sets <html lang> (the library's default locale) before anything else runs.
import { htmlLang, setPageMeta, t } from './i18n';
import './style.css';
import { CharturboDevice, Charturbo } from 'charturbo';
import { FAMILIES, renderHeader } from './families';
import { bindTheme } from './theme';

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
const PREVIEWS: Record<string, (sdk: Charturbo) => void> = {
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
  graph: (sdk) => {
    sdk.reloadSeededDataset(42, 1_500, 3_000, 8);
    sdk.applyLayout('cluster-sphere', 85);
    sdk.fitToView();
    sdk.zoomCamera(-20); // wide card: frame tighter than the bounding sphere
  },
  embeddings: (sdk) => {
    // 600 x 256 vectors: 8 random topic directions + equal-variance noise (cosine ~0.5 within a topic)
    const [n, dim] = [600, 256];
    let seed = 1;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    const topics = Array.from({ length: 8 }, () => Float32Array.from({ length: dim }, rnd));
    const vectors = Float32Array.from({ length: n * dim }, (_, k) => topics[Math.floor(k / dim) % 8][k % dim] + rnd());
    const clusters = Uint16Array.from({ length: n }, (_, i) => i % 8);
    sdk.loadEmbeddings(vectors, { dimensions: dim, projection: 'pca', kNeighbors: 3, similarityThreshold: 0.3, clusters });
    sdk.fitToView();
    sdk.zoomCamera(-60);
  },
  scene: (sdk) => {
    sdk.setGraphVisible(false);
    sdk.addPlane({ position: [0, -1, 0], scale: [120, 2, 90], color: [0.11, 0.14, 0.2, 1] });
    const colors: [number, number, number, number][] = [[0.22, 0.53, 0.9, 1], [0.95, 0.55, 0.2, 1], [0.3, 0.78, 0.55, 1], [0.86, 0.33, 0.45, 1]];
    colors.forEach((color, i) => {
      sdk.addSphere({ position: [-30 + i * 20, 7, -8], scale: [13, 13, 13], color, metallic: 0.5, roughness: 0.3 });
      sdk.addBox({ position: [-20 + i * 14, 4, 18], scale: [8, 8, 8], rotation: [0, i * 0.4, 0], color: colors[(i + 2) % 4] });
    });
    sdk.setCameraPose([0, 48, 95], [0, 4, 0]);
  },
  sparklines: (sdk) => sdk.renderSparkline(wave(80, 0.5, 100, 9), { type: 'area', showLast: true, showMinMax: true }),
  animation: (sdk) => sdk.renderGroupedBarChart(groupedBars, { ...quiet, mode: 'stacked', padding: pad }),
  export: (sdk) => sdk.renderAreaChart(lineSeries, { ...quiet, mode: 'stacked', padding: pad }),
  react: (sdk) => sdk.renderLineChart(lineSeries, { ...quiet, padding: pad, hover: { mode: 'index' } }),
  vue: (sdk) => sdk.renderBarChart(['A', 'B', 'C', 'D', 'E'].map((label, i) => ({ label, value: [7, 12, 9, 15, 11][i] })), { ...quiet, padding: pad }),
};

async function main() {
  setPageMeta(t('gallery.title'), t('gallery.intro'));
  document.body.prepend(renderHeader('gallery'));
  const mainEl = document.querySelector('main')!;
  const intro = document.createElement('section');
  intro.className = 'intro';
  intro.append(document.createElement('h1'), document.createElement('p'));
  intro.querySelector('h1')!.textContent = t('gallery.heading');
  intro.querySelector('p')!.textContent = t('gallery.intro');
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
    const device = await CharturboDevice.create();
    for (const { id, canvas } of canvases) {
      try {
        const sdk = await Charturbo.create(canvas, { device, locale: htmlLang });
        PREVIEWS[id]?.(sdk);
        bindTheme(sdk);
      } catch (err) {
        console.error(`[examples] ${id} preview failed`, err);
      }
    }
  } catch (err) {
    console.error('[examples] shared device unavailable', err);
    const notice = document.createElement('div');
    notice.className = 'demo-error';
    notice.setAttribute('role', 'alert');
    notice.style.marginTop = '12px';
    notice.textContent = t('gallery.noGpu');
    intro.appendChild(notice);
  }
  window.__ready = true;
}

void main();
