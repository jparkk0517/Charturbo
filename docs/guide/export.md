# Export: PNG · SVG · PDF

Save a chart as a raster image (PNG, JPEG, WebP) with its DOM labels composited in, as a vector SVG built from the engine's marks, as a one-page PDF, or copy it to the clipboard. Exports always show the final frame, even while an animation runs.

[Live example](https://jparkk0517.github.io/Charturbo/export.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderGroupedBarChart(
  {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'North', values: [10, 22, 31, 40] },
      { name: 'South', values: [6, 15, 12, 22] },
    ],
  },
  { title: 'Quarterly revenue' }
);
sdk.render();

await sdk.downloadImage('revenue.png', { pixelRatio: 2 }); // PNG at 2x
sdk.downloadChartSVG('revenue.svg');                      // vector SVG
await sdk.downloadChartPDF('revenue.pdf');                // one-page PDF (raster)
const copied = await sdk.copyChartImage();                // PNG on the clipboard; false when unsupported
```

## Methods

| Method | Returns | Description |
|---|---|---|
| `toImage(options?)` | `Promise<Blob>` | Canvas plus DOM overlay as an image. |
| `toDataURL(options?)` | `Promise<string>` | `toImage` as a `data:` URL. |
| `downloadImage(filename = 'chart.png', options?)` | `Promise<void>` | Downloads `toImage`. The format comes from the extension (`.jpg` / `.jpeg`, `.webp`, else PNG) unless `options.format` is set. |
| `exportChartSVG(options?)` | `string` | Synchronous vector SVG document. |
| `downloadChartSVG(filename = 'chart.svg', options?)` | `void` | Downloads `exportChartSVG()`. |
| `toPDF(options?)` | `Promise<Blob>` | One-page PDF of the PNG image. Takes the image options without `format` / `quality`. |
| `downloadChartPDF(filename = 'chart.pdf', options?)` | `Promise<void>` | Downloads `toPDF()`. |
| `copyChartImage(options?)` | `Promise<boolean>` | Copies a PNG to the clipboard. Takes the image options without `format` / `quality`. |

## Image options

`toImage`, `toDataURL`, `downloadImage`, `toPDF` and `copyChartImage` take these options (`ChartImageOptions`):

| Option | Type | Default | Description |
|---|---|---|---|
| `format` | `'png' \| 'jpeg' \| 'webp'` | `'png'` | Image format. |
| `quality` | `number` | browser default | JPEG / WebP quality, 0–1. |
| `pixelRatio` | `number` | current canvas ratio | Output pixels per CSS pixel. The chart is re-rendered at that size (at most 8192 px per side). |
| `background` | `'theme' \| 'transparent' \| string` | `'theme'` | Theme surface color, a transparent background, or any CSS color. |
| `overlay` | `boolean` | `true` | Composite the DOM overlay (title, legend, axes). `false` = canvas only. |

### How capture works

- A WebGPU canvas loses its contents once the frame is presented, so every export re-renders the canvas and copies it into a 2D canvas in the same task. If the copy reads back fully transparent, it retries on the next animation frame up to 2 times, then throws `toImage: canvas read back blank (GPU frame unavailable)`.
- When `pixelRatio` differs from the current ratio, the canvas backing store is resized for the export and restored afterwards.
- `background`: an opaque CSS color is used as the GPU clear color. `'transparent'` renders twice, on black and on white, to recover exact alpha. A translucent CSS color is laid under the chart. JPEG has no alpha, so transparent areas turn black.
- The DOM overlay (title, legend swatches and names with their hidden state, axis ticks, axis titles, annotation labels) is walked generically and drawn at its laid-out position with the computed font, color, opacity, line-through and rotation. Add `data-charturbo-export="false"` to an overlay element to leave it out.

## SVG options

| Option | Type | Default | Description |
|---|---|---|---|
| `maxMarks` | `number` | `200000` | Most marks written (stroke segments, fill triangles, bars, points). Points beyond it are thinned evenly and a console warning is logged. |
| `background` | `'theme' \| 'transparent' \| string` | `'theme'` | Same as the image option. |
| `overlay` | `boolean` | `true` | Include the DOM overlay text (title, legend, axes). |

## Vector SVG

`exportChartSVG()` writes the engine's staged GPU instances from the last frame in CSS px coordinates:

- Consecutive line segments of the same style become one `<path>` polyline; dashed lines use `stroke-dasharray` / `stroke-dashoffset`.
- Filled triangles become one `<path>` per color; bars become `<path>` elements with rounded data ends (gap trimming included).
- Markers and points become `<circle>` (square, diamond and triangle markers become `<path>`).
- Annotations, the brush and the navigator are included; the hover overlay is not. While zoomed, the plot uses the same `clipPath` as the canvas.
- Overlay text is written as `<text>` (computed font family, size, weight, style, color, rotation, ellipsis) and `<rect>` (legend swatches, label chips), the same walk as the image export.
- Only the decimated (LOD) output is written, so a 1M-point line produces an SVG about the size of the screen's pixel columns. Points outside the plot are culled.

| Chart | SVG output |
|---|---|
| line, area, bar (2D), scatter, pie, box, candlestick, combo, radar, gauge, funnel, waterfall, treemap, sunburst, sankey | Vector |
| heatmap | Plot area as a PNG `<image>` (cells are a GPU texture); axes, legend and labels in vector |
| 3D / 2.5D views, kinds without an SVG writer | The whole canvas as a PNG `<image>` under vector text, with a console warning |

## PDF

`toPDF()` writes a minimal single-page PDF without dependencies. The page has the chart's CSS size (96 dpi converted to points), and the chart title is stored as the document title. The image is the composited PNG export; its RGB data is compressed with `CompressionStream('deflate')` when the browser has it, and stored uncompressed otherwise. The PDF is raster only: use SVG when you need vector output.

## Clipboard

`copyChartImage()` writes a PNG through `ClipboardItem`. It resolves `false` when the browser has no `ClipboardItem` / `navigator.clipboard.write`, or refuses the write (permission, no user gesture). Call it from a click handler.

## Limits

- Tooltips are outside the overlay and are not exported.
- SVG, images, borders and shadows inside the overlay are not drawn; text wrapped over several lines is drawn on one line.
- A ratio set with `setPixelRatio` is recalculated from the canvas after a high-resolution export.
- Exported labels are the ones in the DOM, so they follow the chart [locale](./i18n).

## See also

- [Accessibility](./accessibility) (CSV export)
- [Animation](./animation)
- [Styling & Themes](./styling)
