# Charturbo

High-performance charting library powered by **Rust + WebGPU (WebAssembly)** (WebGL2 fallback): line, area, bar, scatter, candlestick, histogram, heatmap, box / violin, pie, combo, radar, gauge, funnel, waterfall, treemap, sunburst, sankey and sparkline charts, plus 3D graph / embedding views.

Renders **1,000,000+ points at 60 FPS**: decimation, hit-testing, stacking and tick layout run in Rust; the DOM only carries labels, legend and tooltip.

## Installation

```bash
npm install charturbo
```

The engine is a WebAssembly module (`charturbo_core_bg.wasm`, ~2.6 MB raw / ~1.0 MB gzip / ~0.77 MB brotli). Pick the entry
that matches your toolchain:

| Entry | WASM | Use with |
|---|---|---|
| `charturbo` | separate file, loaded via `new URL('./charturbo_core_bg.wasm', import.meta.url)` | Vite, webpack 5, Rollup / Parcel with asset handling (verified: Vite 8 dev + build, webpack 5) — the bundler emits the `.wasm` as an asset |
| `charturbo/inline` | embedded (base64, ~3.9 MB JS) | esbuild or any setup without asset handling; no extra file to serve |
| `charturbo/umd` (`dist-lib/charturbo.umd.cjs`) | embedded | `<script>` tag (global `Charturbo`), CommonJS `require` |
| `charturbo/react`, `charturbo/vue` | shares the main entry | React >= 18 / Vue >= 3.3 (optional peers); ESM only (no CommonJS build) |

Serving the `.wasm` yourself (CDN, esbuild copy step, strict CSP): call `setWasmSource` before the first `create()`:

```ts
import { setWasmSource, Charturbo } from 'charturbo';
import wasmUrl from 'charturbo/charturbo_core_bg.wasm?url'; // Vite; or any URL / Response / bytes / WebAssembly.Module
setWasmSource(wasmUrl);
```

```html
<!-- No bundler -->
<script src="https://cdn.jsdelivr.net/npm/charturbo@0.1/dist-lib/charturbo.umd.cjs"></script>
<script>
  Charturbo.Charturbo.create(document.querySelector('canvas')).then((sdk) => {
    sdk.renderLineChart([{ name: 'a', values: [1, 3, 2, 5] }]);
    sdk.render();
  });
</script>
```

Runtime: browsers with WebGPU, or WebGL2 (automatic fallback). Importing any entry in Node / SSR is safe (no `window` /
`document` access at import); engines are created on the client only. TypeScript: `moduleResolution` `bundler`,
`node16` / `nodenext` (ESM and CJS) and `node10` are supported.

## Features

- 🚀 **Rust + WebGPU Core**: zero-copy TypedArray buffers, GPU instancing, M4 decimation per pixel column, constant-pixel anti-aliased lines.
- 📈 **Charts**: `renderLineChart`, `renderAreaChart`, `renderBarChart` / `renderGroupedBarChart`, `renderScatterChart`, `renderCandlestickChart`, `renderHistogram`, `renderHeatmap`, `renderBoxPlot`, `renderPieChart`, `renderComboChart`, `renderRadarChart`, `renderGauge`, `renderFunnelChart`, `renderWaterfallChart`, `renderTreemap`, `renderSunburst`, `renderSankey`, `renderSparkline`.
- 🖨️ **Export & animation**: PNG / JPEG / WebP (`toImage`), vector SVG (`exportChartSVG`), PDF (`toPDF`), opt-in enter / update animations.
- ⏱️ **Streaming & navigation**: `appendSeriesData` with sliding windows, time axes, log / reversed / dual y axes, wheel / drag / pinch zoom, range navigator, brush selection, synced dashboards.
- 🧩 **Formatting & tooltips**: d3-format style specs (`'.2f'`, `'$,.2f'`, `'.2s'`, `'compact'`, `'bytes'`) for axes and tooltip values; tooltip `sort`, `shared`, click `pin`.
- ♿ **Accessibility**: generated summaries, data tables / CSV, keyboard navigation for every chart kind.
- ⚛️ **React / Vue**: `charturbo/react` and `charturbo/vue` components (optional peers).
- 🌌 **3D graphs & embeddings**: Barnes-Hut force layout, high-dimensional embedding projection (PCA / JL) with cosine k-NN, node inspection.

## Usage

### 1. Charts

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas); // autoResize: true by default

// Multi-series line chart (1M+ points per series are fine)
sdk.renderLineChart(
  [
    { name: 'GPU Sensor Alpha', values: Float32Array.from({ length: 50_000 }, (_, i) => Math.sin(i * 0.05) * 40) },
    { name: 'Network Throughput', values: Float32Array.from({ length: 50_000 }, (_, i) => Math.cos(i * 0.05) * 35) },
  ],
  {
    title: 'High-Frequency Telemetry',
    axes: { x: { title: 'Sample' }, y: { title: 'Mbps', format: '.2s' } }, // spec, Intl options, or a function
  }
);
sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  tooltip: { sort: 'desc', valueFormatter: ',.1f', pin: 'click' },
});

// Streaming: append and keep the newest 100k samples
sdk.appendSeriesData(0, chunk, undefined, { maxPoints: 100_000 });

// Each render* call replaces the chart of this SDK instance (one chart per canvas)
// Grouped / stacked bars
sdk.renderGroupedBarChart(
  {
    categories: ['APAC', 'EMEA', 'US-East', 'US-West', 'LATAM'],
    series: [
      { name: 'Q1', values: [120, 95, 180, 210, 65] },
      { name: 'Q2', values: [145, 110, 205, 230, 80] },
    ],
  },
  { mode: 'stacked' }
);

// 1,000,000-point scatter / bubble chart
sdk.renderScatterChart({ x: xs, y: ys, clusters: seriesIds }, { seriesNames: ['A', 'B'] });
sdk.render();
```

### 2. High-Dimensional Embeddings Projection (128D ~ 3072D)

```ts
// Ingest any high-dimensional vector embeddings
const dim = 1536; // e.g. text-embedding-3-large
const count = 500;
const flatVectors = new Float32Array(count * dim);

// Ingest, auto-project to 3D coordinates, and connect cosine k-NN edges
sdk.loadEmbeddings(flatVectors, {
  dimensions: dim,
  kNeighbors: 4,
  similarityThreshold: 0.15,
  projection: 'pca', // 'pca-umap' (default) | 'pca' | 'random-projection'
});

// Exact Cosine Similarity query
const topK = sdk.queryCosineSimilar(0, 5);
console.log('Top 5 most similar items to item 0:', topK);
```

### 3. Interactive 3D Graphs & Networks

```ts
import { Charturbo, escapeHtml } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, {
  nodeCount: 1000,
  edgeCount: 2500,
  clusterCount: 6,
});

// Attach node metadata
sdk.setSingleNodeMetadata(0, {
  label: 'Core-Router-0',
  category: 'Core Network',
  attributes: { region: 'ap-northeast-2', throughputGbps: 40 },
});

// Enable built-in hover tooltip & click inspection
// Touch / pen (Pointer Events; mouse unchanged). Line charts: pinch = x zoom at the midpoint,
// drag = pan (+ fling), tap = pinned tooltip, long-press = scrub, double-tap = reset zoom.
// Graph / 3D: drag = orbit, pinch = zoom, two-finger drag = pan, tap = select, double-tap = focus.
// The canvas gets `touch-action: none` while attached. Opt out per gesture or with `touch: false`;
// host pointer handlers can skip touch via `sdk.handlesTouchGestures()`.
sdk.enableNodeInteractions(canvas, {
  builtInTooltip: true,
  highlightNeighborsOnClick: 1,
  autoRender: true,
  touch: { pinchZoom: true, tapTooltip: true, longPressScrub: true }, // defaults
  // Mouse: drag = orbit, Shift / right / middle drag = pan, wheel = zoom (defaults: all on)
  cameraControls: { orbit: true, pan: true, zoom: true },
  onNodeClick: (node) => {
    if (node) {
      console.log('Selected node:', node.label, 'Neighbors:', node.neighbors);
    }
  },
  // Optional custom tooltip: the returned HTML is used as-is, so escape data strings
  // formatTooltip: (d) => `<b>${escapeHtml(d.label)}</b>`,
});

// Apply 3D layout preset ('cluster-sphere' | 'radial-shells' | 'helix' | 'grid-3d')
sdk.applyLayout('cluster-sphere', 85);
sdk.fitToView(); // fills the view on its tighter axis (horizontal or vertical)
sdk.render();

sdk.focusNode(42); // center on a node and move closer (40 % of the fitToView distance)
const camera = sdk.getCameraState(); // { target, eye, distance, yaw, pitch, fovY, aspect } | null
```

- **Built-in camera controls** (`cameraControls`, graph / point-cloud / scene views; charts keep their own
  wheel / drag navigation): left drag orbits, Shift + drag or right / middle drag pans (the content follows
  the pointer), the wheel zooms proportionally to the distance without scrolling the page. Drags use
  pointer capture (releasing outside the canvas ends them); a press released within 5 px stays a click.
  `{ orbit: false }` makes a left drag pan, `{ pan: false }` / `{ zoom: false }` disable one move, and
  `cameraControls: false` disables them all (hosts driving the camera themselves); the same switches gate
  the camera moves of touch gestures. The canvas context menu is suppressed in graph views while pan is on.
  Hosts with their own pointer handlers can check `sdk.handlesCameraControls()`.
- **Framing**: double-click (or `focusNode(id, { distance })`) centers on a node and moves the camera
  closer immediately; `getCameraState()`, distance-scaled zoom / pan and the focus distance need the
  engine's `camera_state` binding (older builds: `null`, fixed gains, target-only focus).
- **Default tooltip**: label, category, cluster, degree, neighbors, position, tags and up to 6 attributes in
  the theme's text colors. Every data-derived string is HTML-escaped (a label like `<img onerror=…>` renders
  as text); fixed strings follow the SDK / chart locale (`ko*` = Korean, otherwise English). The default
  chart tooltips escape series names, x labels, attributes and formatted values too (a
  `tooltip.valueFormatter` result is shown as text).

## Documentation

- API reference: `npm run docs` (TypeDoc → `docs/api/`).
- Examples (every chart family with its source): https://jparkk0517.github.io/VizEngineSDK/ (locally: `npm run examples:dev`).
- Changes: [CHANGELOG.md](./CHANGELOG.md) (0.x: minor = new features or breaking changes, patch = fixes).

## License

MIT — see [LICENSE](./LICENSE).
