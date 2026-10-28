# What is Charturbo?

Charturbo is a charting library for the web that draws on the GPU. Data processing runs in Rust compiled to WebAssembly, rendering uses WebGPU with an automatic WebGL2 fallback, and the DOM only carries text such as titles, legends, axis labels and tooltips. It is built for charts that must stay interactive with one to ten million points.

[Live examples](https://jparkk0517.github.io/Charturbo/gallery.html)

## Architecture

| Layer | Runs in | Responsibilities |
|---|---|---|
| Engine (`charturbo-core`) | Rust, compiled to WebAssembly | M4 decimation per pixel column, hit-testing, stacking, tick layout, hierarchy and Sankey layout, histogram binning, box-plot statistics, graph physics |
| GPU renderer | WebGPU, or WebGL2 through the same `wgpu` pipeline | Lines, fills, bars, instanced points, heatmap textures, crosshair and hover marks, 3D views |
| SDK (`Charturbo`) | TypeScript | Canvas sizing, input handling, DOM overlay (title, legend, axis labels, tooltips), accessibility, export, events |

A chart goes through three steps:

1. A `render*` call (for example `renderLineChart`) validates the input and sends it to the engine as typed arrays.
2. The engine reduces the data to what the current view needs (for a line chart, about one min/max pair per pixel column) and stages GPU instances.
3. `render()` draws one frame and updates the overlay DOM.

Zoom and pan re-run step 2 for the visible range only, so the cost of a frame follows the canvas size more than the data size.

## WebGPU and WebGL2

`Charturbo.create(canvas)` starts the engine on WebGPU when the browser provides an adapter. Otherwise the same engine runs on WebGL2. You do not choose the backend; the API and the rendered result are the same.

| Renderer | Browsers |
|---|---|
| WebGPU | Chrome / Edge 113+, Safari 26+ |
| WebGL2 (automatic fallback) | Other current browsers |

Differences on the WebGL2 fallback:

- The opt-in GPU graph physics step (`stepPhysicsAsync`) runs on the CPU instead.
- In the benchmarks, peak WebAssembly memory was 1.6–2.4× higher for scatter, heatmap and multi-series charts. Frame times were about the same as WebGPU.
- Browsers limit the number of live WebGL contexts (about 16). Pages with many charts should share one device: see [Shared GPU Device](./shared-device).

A separate WebGPU-only build without the WebGL2 stack is also packaged: see [Installation & Bundlers](./installation#webgpu-only-build).

## Chart catalog

| Group | Charts |
|---|---|
| Cartesian | [Line](../charts/line), [Area](../charts/area), [Band · Range](../charts/band), [Error Bar · Impulse](../charts/errorbar-impulse), [Bar](../charts/bar), [Histogram](../charts/histogram), [Scatter · Bubble](../charts/scatter), [Candlestick · OHLC](../charts/candlestick), [Heatmap](../charts/heatmap), [Box Plot · Violin](../charts/box-violin), [Combo](../charts/combo) |
| Business | [Pie · Donut](../charts/pie), [Radar](../charts/radar), [Gauge](../charts/gauge), [Funnel](../charts/funnel), [Waterfall](../charts/waterfall), [Sparkline](../charts/sparkline) |
| Hierarchy & flow | [Treemap · Sunburst](../charts/treemap-sunburst), [Sankey](../charts/sankey) |
| 3D | [PointCloud3D · Surface3D](../charts/scientific-3d), [3D Network Graph](../charts/graph-3d), [Embeddings · Similarity](../charts/embeddings), [3D Scene · Physics](../charts/scene-3d) |

Shared features across charts: real-time streaming, time / log / reversed / dual y axes, wheel / drag / pinch zoom, range navigator, brush selection, dashboard sync, annotations, PNG / SVG / PDF export, opt-in animation, accessibility summaries with data tables and keyboard navigation, and [React](./react) / [Vue](./vue) components.

## When to use it

- Large or fast-changing data: time series with millions of samples, scatter plots with up to a few million points, streaming sensor or market data.
- Dashboards with many linked charts (cursor and zoom sync, a shared GPU device for hundreds of sparklines).
- Network graphs and embedding views with tens of thousands of nodes.

## When not to use it

- Server-side rendering of chart images. Importing the package in Node is safe, but engines are only created in the browser; there is no server renderer.
- Very small pages where download size matters more than speed. The default WebAssembly module is about 2.6 MB raw / 1.0 MB gzip.
- Environments with neither WebGPU nor WebGL2. `Charturbo.create` then rejects; check with `Charturbo.isSupported()` and show your own fallback.
- Projects that need a stable 1.x API today. Charturbo is at 0.x: minor versions may contain breaking changes (see [Changelog & Migration](./migration)). The package is not on npm yet (see [Installation](./installation)).

## See also

- [Getting Started](./getting-started)
- [Core Concepts](./core-concepts)
- [Performance](./performance)
