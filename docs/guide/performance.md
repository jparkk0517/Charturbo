# Performance

Charturbo keeps zoom, pan and hover at display rate by doing the heavy work in WebAssembly and keeping data on the GPU. This page explains where the speed comes from, how to keep it with large data, and what the benchmarks measured.

[Benchmark comparison](https://jparkk0517.github.io/Charturbo/benchmarks.html)

## How it stays fast

| Technique | Where it applies |
|---|---|
| M4 decimation per pixel column (first, last, min and max of each column) in Rust | Line and area charts: a million samples become a few thousand segments, and spikes are kept |
| Pixel-column OHLC aggregation | Candlesticks narrower than 2 px |
| GPU instancing, points uploaded once | Scatter / bubble charts: zoom and pan only change the view |
| Value grid as one `R32Float` texture with a 256-color lookup table | Heatmaps up to 4096 × 4096 cells: one quad, color map changes without re-upload |
| Hit-testing, stacking, tick layout, hierarchy and Sankey layout in Rust | Hover and layout cost stays out of JavaScript |
| Upload only what changed | Streaming uploads the decimated result (about 155 KB per frame for a 1M window); Sankey hover and treemap legend highlighting change a uniform instead of geometry |
| GPU-resident graph layout (`stepPhysicsAsync`, WebGPU) | Positions and velocities stay in GPU buffers; the GPU builds the Barnes-Hut octree and integrates |
| DOM only for text | Title, legend, axis labels and tooltips; tick label DOM is rebuilt only when ticks change |

## Tips for large data

### Pass typed arrays

Use `Float32Array` for values and `Float64Array` for x values and timestamps. Plain arrays are accepted but converted first. For a single series given as a `Float32Array` (and an optional `Float64Array` x), the SDK passes the array to the engine without making a concatenated copy; in the benchmarks this cut the WebAssembly memory of a 10M-sample line from 78 MB to 41 MB.

```ts
const values = new Float32Array(n);
const x = new Float64Array(n); // epoch ms for a time axis
sdk.renderLineChart([{ name: 'Sensor', values, x }], { axes: { x: { type: 'time' } } });
sdk.render();
```

### Append instead of re-rendering

`appendSeriesData` adds samples to an existing series and `maxPoints` keeps a sliding window. Trimming is amortized O(appended samples), and the next frame re-decimates only the visible range. `appendAreaData` does the same for stacked areas. Calling `renderLineChart` with the full data on every update copies everything again.

```ts
sdk.appendSeriesData(0, chunk, chunkX, { maxPoints: 1_000_000 });
sdk.render();
```

### Render only when something changed

There is no idle loop: `render()` draws one frame. Call it after data or view changes, or use `autoRender: true` on `enableNodeInteractions`. For streaming, batch updates and render once per animation frame.

### Share a GPU device across many charts

`Charturbo.create(canvas)` requests an adapter and device and compiles every pipeline per canvas, and browsers cap WebGL contexts at about 16. With `CharturboDevice`, 100 sparklines took 165 ms on WebGPU and 717 ms on WebGL2 to create and first render (headless Chrome). See [Shared GPU Device](./shared-device).

### Know the limits

- Scatter charts have no point decimation: every point is drawn. At 5M points zoom and pan were GPU-bound at 12–13 fps.
- Animations are skipped when a chart stages more than 50,000 marks (for example a 1M-point scatter).
- Graph physics at 100k nodes is not real time on the CPU. Lay out first with `warmup()` and then only render, step less often, or use `stepPhysicsAsync` on WebGPU.
- On the WebGL2 fallback, peak WebAssembly memory was 1.6–2.4× higher for scatter, heatmap and multi-series charts.

### Measure

`sdk.getRenderStats()` returns GPU buffer and texture bytes, the bytes uploaded by the last frame, staged mark counts and the WebAssembly memory size (`null` on backends without counters).

## Benchmark summary

Measured with the `web/bench/` harness on one machine: Apple M1, headless Chrome 156, 960 × 540 canvas at DPR 1, 60 Hz. Steady state is 3 seconds of wheel zoom and drag pan (hover sweep for bars). Numbers will differ on other machines and browsers.

| Scenario | TTFF ms WebGPU / WebGL2 | Steady frame med / p95 / max ms | Dropped vsyncs / frames | Work per frame med ms | GPU MB |
|---|---|---|---|---|---|
| line-1m-1s | 16.7 / 16.6 | 16.7 / 16.7 / 16.7 | 0/180 | 1.7 | 0.7 |
| line-10m-1s | 91.8 / 92.3 | 16.7 / 16.7 / 33.3 | 4/176 | 2.9 | 0.7 |
| area-stacked-1m | 26.9 / 25.6 | 16.7 / 16.7 / 33.3 | 1/179 | 5.5 | 5.3 |
| scatter-1m | 46.1 / 46.9 | 16.7 / 16.7 / 16.7 | 0/180 | 1.2 | 32.7 |
| scatter-5m | 210 / 244 | 83.3 / 117 / 117 | 144/37 | 1.6 | 128.7 |
| bar-10k | 19.0 / 19.1 | 16.7 / 16.7 / 16.7 | 0/180 | 1.1 | 1.2 |
| heatmap-4096 | 92.9 / 96.4 | 16.7 / 16.7 / 16.7 | 0/180 | 1.3 | 64.7 |
| candle-1m | 33.2 / 33.3 | 16.7 / 16.7 / 16.7 | 0/180 | 1.6 | 0.7 |
| stream-1m | 15.9 / 16.2 | 16.7 / 16.7 / 16.7 | 0/180 | 3.2 | 0.7 |

TTFF and frame times are quantized to the 16.7 ms vsync; 16.7 means "within one frame". `stream-1m` appends 10k points per frame to a 1M window.

Graph layout, 3-second steady state (2026-10-27, before the layout became GPU-resident):

| Nodes / edges | CPU physics ms / FPS | Hybrid GPU physics ms / FPS |
|---|---|---|
| 10k / 20k | 17.74 / 52.7 | 6.23 / 60.0 |
| 100k / 200k | 285.76 / 3.7 | 41.87 / 19.6 |

Library comparisons (uPlot, ECharts, Chart.js, Plotly, ChartGPU, SciChart, Highcharts, three.js, deck.gl, cosmos.gl, 3d-force-graph), the full method and the known limits are in [Benchmark Methodology](../contributing/benchmarks). Run them yourself with `cd web && npm run bench`.

## See also

- [Real-time Streaming](./streaming)
- [Shared GPU Device](./shared-device)
- [3D Network Graph](../charts/graph-3d)
