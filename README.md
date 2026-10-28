# Charturbo

**English** · [한국어](README.ko.md) · [简体中文](README.zh-CN.md)

**A large-scale web charting library built with Rust + WebGPU.** Zoom and pan 1–10 million points at 60 FPS.
Browsers without WebGPU switch to WebGL2 automatically.

[![CI](https://github.com/jparkk0517/Charturbo/actions/workflows/ci.yml/badge.svg)](https://github.com/jparkk0517/Charturbo/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[▶ Live demo](https://jparkk0517.github.io/Charturbo/)** · [Documentation](https://jparkk0517.github.io/Charturbo/docs/) · [Benchmarks](docs/contributing/benchmarks.md) · [Changelog](web/CHANGELOG.md)

<p align="center">
  <a href="https://jparkk0517.github.io/Charturbo/"><img src="docs/assets/demo/hero.png" alt="Line, scatter, candlestick, 3D network graph, sankey and business chart examples" width="880"></a>
</p>

## Why Charturbo

- **Fast on big data**: decimation (M4), hit-testing, stacking and tick layout all run in Rust (WebAssembly) and draw on the GPU. The DOM only carries labels, legend and tooltip.
- **18 chart types**: line, area, bar, scatter, candlestick, histogram, heatmap, box/violin, pie, combo, radar, gauge, funnel, waterfall, treemap, sunburst, sankey, sparkline
- **Built for real apps**: real-time streaming, time axis, log axis, wheel/drag/pinch zoom, range navigator, brush selection, dashboard sync, PNG/SVG/PDF export
- **Accessible and multilingual**: automatic summaries, data tables and keyboard navigation on every chart. Built-in text in English, Korean and Simplified Chinese
- **React and Vue components** with TypeScript types
- **Design settings**: light/dark and custom themes, series colors and palettes, fonts, grid and tooltip, bar corner radius and data labels ([try it](https://jparkk0517.github.io/Charturbo/benchmarks.html))
- **3D**: large network graphs (Barnes-Hut physics layout, shortest path, search), 3D projection of high-dimensional embeddings with similarity search, and a 3D scene with rigid-body physics ([examples](https://jparkk0517.github.io/Charturbo/graph.html))

## Performance

**[▶ Interactive performance comparison · change theme/colors](https://jparkk0517.github.io/Charturbo/benchmarks.html)**

The charts below are **rendered with Charturbo and exported with `exportChartSVG()`**. The comparison page lets you pick scenarios, inspect tooltips, switch between 4 themes, change the accent color, palette, font, corner radius and value labels, and download SVG.

Charturbo is compared with uPlot, ECharts, Chart.js, Plotly, ChartGPU, SciChart and Highcharts on the same seeded data. Measured on a single Apple M1 environment; initialization cost is excluded from TTFF. The ChartGPU scatter only moves along x, so its workload differs from the other libraries.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-ttff-dark.svg">
  <img src="docs/assets/bench-ttff-light.svg" alt="Time to first frame drawn with Charturbo. Line 1M and 10M, scatter 1M, bar 10k. Failures and unsupported cases are marked separately." width="880">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-fps-dark.svg">
  <img src="docs/assets/bench-fps-light.svg" alt="FPS during zoom/pan and bar hover, drawn with Charturbo. 60 Hz display; see the linked comparison page for individual values." width="880">
</picture>

Read the charts **per workload**. For each scenario Charturbo shows the one mode (CPU or GPU) with the higher FPS, and every metric comes from that same selected run (on a tie, the mode with the shorter physics time). Charturbo and three.js use the same 3D Barnes-Hut force model. These graph numbers were measured with the earlier hybrid GPU mode (GPU repulsion, CPU integration and spatial index), whose physics time includes the GPU round trip. deck.gl renders without physics, cosmos.gl is a 2D GPU layout, and 3d-force-graph uses a different d3-force-3d force model. Do not read their FPS as an overall ranking of the same task. Timeouts are results of that adapter and setting.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/bench-graph-dark.svg">
  <img src="docs/assets/bench-graph-light.svg" alt="FPS, physics time and time to first frame for 10k and 100k nodes. Charturbo uses its best-FPS mode, GPU physics includes the GPU round trip, deck.gl renders only, cosmos.gl is 2D, so workloads differ." width="880">
</picture>

On Apple M1, the hybrid GPU physics ran at **60 FPS** with 10k nodes and **19.6 FPS** with 100k nodes (CPU: 43.8 / 3.5 FPS). `stepPhysicsAsync` now keeps the whole layout resident on the GPU and has not been re-measured yet. Use it as `await sdk.stepPhysicsAsync(0.016)` followed by `sdk.render()`, and `await sdk.syncPhysicsPositions()` before picking or exporting; WebGL2 falls back to the CPU. The synchronous `stepPhysics()` is the CPU path.

Methodology, per-library settings, full tables and limitations are in the [benchmark methodology](docs/contributing/benchmarks.md). To run it yourself: `cd web && npm run bench`.

Regenerate the README images: `cd web && npm run bench:charts` (requires Chrome). Run the comparison page with `npm run examples:dev` and open `/benchmarks.html`.

## Installation

> Not yet published to npm. For now, [build from source](docs/contributing/development.md).

```bash
npm install charturbo
```

Bundlers such as Vite and webpack 5 handle the wasm file automatically. For a plain `<script>` tag or esbuild, see [Installation & Bundlers](docs/guide/installation.md).

## Quick start

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

// A 1,000,000-point line chart
const values = Float32Array.from({ length: 1_000_000 }, (_, i) => Math.sin(i / 5000) * 40 + Math.random() * 4);
sdk.renderLineChart([{ name: 'Sensor A', values }], { title: 'Live telemetry' });

// Tooltip, wheel zoom, drag to pan
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

React:

```tsx
import { CharturboChart } from 'charturbo/react';

<CharturboChart type="line" data={series} options={{ title: 'Utilization' }} style={{ height: 300 }} />;
```

Examples and source for every chart type are in the [live demo](https://jparkk0517.github.io/Charturbo/).

## Browser support

| Renderer | Browsers |
|---|---|
| WebGPU | Chrome · Edge 113+, Safari 26+ |
| WebGL2 (automatic fallback) | Other modern browsers |

## Documentation

The [documentation site](https://jparkk0517.github.io/Charturbo/docs/) is available in English, Korean and Simplified Chinese. To read it in the repository, see [docs/](docs/).

- [Getting Started](docs/guide/getting-started.md) · [Installation & Bundlers](docs/guide/installation.md) · [Core Concepts](docs/guide/core-concepts.md)
- [Chart manual](docs/charts/line.md): options, data formats and interactions per chart
- [Internationalization](docs/guide/i18n.md): built-in text (accessibility, tooltips, data tables) in English, Korean and Chinese
- API reference: `cd web && npm run docs` (TypeDoc → `docs/public/api/`, English)
- [Benchmarks](docs/contributing/benchmarks.md) · [Development · build · test](docs/contributing/development.md) · [Releasing](docs/contributing/releasing.md)

## License

[MIT](LICENSE)
