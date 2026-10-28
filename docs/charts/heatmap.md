# Heatmap

A heatmap colors each cell of a value grid. The grid is uploaded once as a float texture and drawn as a single quad, so grids up to 4096 × 4096 cells stay interactive. Use it for matrices, calendars (day × hour), and dense 2D data.

[Live example](https://jparkk0517.github.io/Charturbo/heatmap.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const cols = 90; // days
const rows = 24; // hours
const values = new Float32Array(cols * rows); // values[row * cols + col]
// ... fill values

sdk.renderHeatmap(
  {
    cols,
    rows,
    values,
    xLabels: Array.from({ length: cols }, (_, c) => `Day ${c + 1}`),
    yLabels: Array.from({ length: rows }, (_, r) => `${String(r).padStart(2, '0')}:00`),
  },
  { title: 'Load by hour', valueLabel: 'Load', colorScale: 'sequential', colorbar: { title: 'req/s' } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderHeatmap(data: HeatmapChartData, options?: HeatmapChartOptions): { cellCount: number }
```

Data point id = `row * cols + col`.

## Data format

`HeatmapChartData`:

| Field | Type | Description |
|---|---|---|
| `cols` | `number` | Number of columns. |
| `rows` | `number` | Number of rows. |
| `values` | `Float32Array \| number[]` | Row-major values, `values[row * cols + col]`. `NaN` = empty cell. Up to 4096 × 4096. |
| `xLabels` | `string[]` | Column labels: a categorical x axis (tick value = column index). |
| `yLabels` | `string[]` | Row labels: a categorical y axis (tick value = row index). |
| `xExtent` | `[number, number]` | Numeric x axis instead: data x of the grid's left and right edges. |
| `yExtent` | `[number, number]` | Numeric y axis instead: data y of the grid's bottom and top edges. |

Categorical labels are thinned so they do not overlap.

## Options

`HeatmapChartOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Chart title. |
| `description` | `string` | — | Accessible name of the canvas. |
| `colorScale` | `'sequential' \| 'viridis' \| 'magma' \| 'diverging'` | `'sequential'` | Colormap. `'sequential'` is one hue from light to dark; `'diverging'` uses two hues around `center`. |
| `color` | `ColorInput` | reference blue ramp | Hue source of the sequential scale. |
| `reverse` | `boolean` | `false` | Flip the colormap end for end. |
| `min` | `number` | data min | Bottom of the value domain. |
| `max` | `number` | data max | Top of the value domain. |
| `center` | `number` | `0` if the data crosses it, else the domain middle | Diverging midpoint. A diverging scale without `min` / `max` is symmetric around it. |
| `emptyColor` | `ColorInput` | transparent | Color of `NaN` cells. |
| `rowOrder` | `'top-down' \| 'bottom-up'` | `'top-down'` | `'top-down'`: row 0 at the top (matrix order). `'bottom-up'`: row 0 at the bottom. |
| `colorbar` | `HeatmapColorbarOptions \| boolean` | shown | Colorbar right of the plot: `{ show, title, format }`. |
| `valueLabel` | `string` | `'Value'` (localized) | Tooltip and colorbar name of the value. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | Axis titles and formats. |
| `hover` | `ChartHoverStyle` | — | Cell outline: `markerRingColor` (outer ring), `barHighlightColor` (inner ring); `marker: false` disables it. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. |
| `width` | `number` | `160` | World width of the plot. |
| `height` | `number` | `90` | World height of the plot. |

`HeatmapColorbarOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `show` | `boolean` | `true` | Show the colorbar. |
| `title` | `string` | `valueLabel` | Short label above the bar. |
| `format` | `(value: number) => string` | compact numbers | Tick label text. Functions only (no spec strings). |

The colorbar is DOM and is included in PNG export.

## Colormaps

The engine builds a 256-entry lookup table with OKLab interpolation. The fragment shader reads each cell value, normalizes it by `min` / `max` (or around `center`), and picks the LUT color. The ends of `'sequential'` and `'diverging'` flip with the theme's surface brightness.

Change the colormap or domain after rendering without re-uploading the grid:

```ts
sdk.setHeatmapColorScale('diverging');                 // re-uploads only the 1 KB LUT
sdk.setHeatmapColorScale('sequential', { color: '#2a78d6', reverse: true });
sdk.setHeatmapDomain({ min: -5, max: 5, center: 0 }); // uniform-only update
sdk.render();
```

| Method | Description |
|---|---|
| `setHeatmapColorScale(scale, options?)` | Switches the colormap. `options`: `{ color?, reverse?, emptyColor? }`; `undefined` keeps the stored setting. |
| `setHeatmapDomain({ min?, max?, center? })` | Changes the value domain. Omitted values come from the data. |

## Interactions

- Wheel and drag zoom and pan both axes; double-click resets. `zoomChartXY` works from code.
- Hover is O(1) cell math. It outlines the cell; the tooltip shows row, column and value (`ctx.cell = { row, col, xLabel, yLabel }`).
- Heatmaps have no brush: `'select'` payloads are always empty.

See [Interactions](../guide/interactions) and [Tooltips & Hover](../guide/tooltips).

## Updating data

Call `renderHeatmap` again with the new grid. For colormap or domain changes, use the methods above.

## Notes

- Grids larger than the device's 2D texture limit are wrapped row-major into the texture.
- `xExtent` is not a time axis: time zones do not apply.

## Frameworks

```tsx
<CharturboChart type="heatmap" data={{ cols, rows, values }} options={{ colorScale: 'viridis' }} />
```

## See also

- [Scatter · Bubble](./scatter)
- [Styling & Themes](../guide/styling)
- [Export: PNG · SVG · PDF](../guide/export)
