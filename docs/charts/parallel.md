# Parallel Coordinates

`renderParallelChart` draws one polyline per row across a set of axes (ECharts `parallel`). Axes are value, category or time axes, side by side or stacked. Dragging along an axis brushes an interval; rows outside the brush fade. Use it to compare many records over many dimensions and to filter them interactively: cars, products, experiment runs, sensor logs.

[Live example](https://jparkk0517.github.io/Charturbo/business.html#05-parallel)

## Basic usage

```ts
import { Charturbo, type ParallelChartData } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const data: ParallelChartData = {
  dimensions: ['MPG', 'Horsepower', { name: 'Origin', categories: ['US', 'EU', 'JP'] }, { name: 'Year', type: 'time' }, { name: 'Weight', inverse: true }],
  series: [
    { name: 'Sedan', data: [[31, 88, 'JP', new Date('1978-01-01'), 2200], [24, 110, 'EU', new Date('1974-01-01'), 2700]] },
    { name: 'Truck', data: [[16, 150, 'US', new Date('1972-01-01'), 4100]] },
  ],
};
sdk.renderParallelChart(data, { title: 'Cars' });
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signatures:

```ts
renderParallelChart(data: ParallelChartData, options?: ParallelChartOptions): { rowCount: number; dimensionCount: number; seriesCount: number }
setParallelBrush(intervals: ParallelBrushInterval[]): number   // active row count
clearParallelBrush(): void
getParallelBrush(): ParallelBrushRange[]
getParallelActiveRows(): number[]
exportParallelCSV(options?: { activeOnly?: boolean }): string
```

## Data format

```ts
interface ParallelChartData {
  dimensions: (string | ParallelDimension)[]; // 2 to 64 axes; a string is a value axis
  rows?: ParallelCell[][];                     // one series
  series?: ParallelSeries[];                   // or rows grouped by series
}

interface ParallelDimension {
  name: string;
  type?: 'value' | 'category' | 'time';        // default: inferred from the first cell
  min?: number | string | Date;                // default: the data extent with nice ends
  max?: number | string | Date;
  inverse?: boolean;                           // larger values toward the axis start
  categories?: string[];                       // axis order (default: first-seen order)
  format?: ChartValueFormat;                   // tick, tooltip and accessibility text
}

interface ParallelSeries { name?: string; data: ParallelCell[][]; color?: ColorInput }

type ParallelCell = number | string | Date | null | undefined;
```

- Each row has one cell per dimension. A string cell is a category, a `Date` (or epoch ms, or a date string) is a time.
- `null` or `undefined` is a missing value: the line breaks at that axis. A category cell may also be a category index.
- Up to 1,000,000 rows. Invalid input (a non-numeric value, a bad date, a name outside the given `categories`, a row with the wrong length, `min` not below `max`, an unknown `colorBy`, an invalid color) throws before the current chart is cleared.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `orient` | `'horizontal' \| 'vertical'` | `'horizontal'` | Horizontal: axes side by side, values up. Vertical: axes stacked, values to the right. |
| `lineWidth` | `number` | `1` | Line width in CSS px. |
| `opacity` | `number` | `0.45` | Line opacity, 0–1. |
| `smooth` | `boolean` | `false` | Smooth curves through the axes. |
| `colorBy` | `number \| string` | | Color rows by a value or time dimension through the heatmap colormap (with a colorbar). |
| `colorScale` · `color` · `reverse` | | `'viridis'` | Colormap of `colorBy`, as in [Heatmap](./heatmap). |
| `colorRange` | `[number, number]` | data extent | Color domain of `colorBy`. |
| `colorbar` | `HeatmapColorbarOptions \| boolean` | shown | Colorbar of `colorBy`. |
| `brush` | `ParallelBrushInterval[]` | | Initial brush (no event). |
| `brushable` | `boolean` | `true` | Pointer and keyboard brushing. |
| `inactiveOpacity` | `number` | `0.25` | Opacity of brushed-out rows, relative to `opacity`. |
| `inactiveColor` | `ColorInput` | theme grid tone | Tone brushed-out rows fade to. |
| `brushColor` | `ColorInput` | theme crosshair, 25% alpha | Brush band color. |
| `axisColor` | `ColorInput` | theme baseline | Axis line color. |
| `legend` | `ChartLegendOptions \| boolean` | 2+ series without `colorBy` | Series legend; a click toggles a series. |
| `format` | `ChartValueFormat` | locale number | Value text of value axes without their own `format`. |
| `title` · `description` · `padding` | | | Title, accessible name, plot margins. |

```ts
sdk.renderParallelChart(data, { orient: 'vertical', smooth: true });
sdk.renderParallelChart(data, { colorBy: 'MPG', colorScale: 'magma', opacity: 0.6 });
```

## Brushing

- Drag along an axis to brush an interval on it. Shift + drag adds another interval on the same axis. A click on an axis without dragging clears that axis.
- Several intervals on one axis select their union; brushes on several axes select their intersection. Escape clears every brush.
- A brush change rewrites only the per-row flags on the GPU; the line geometry is uploaded once per `renderParallelChart`.
- `setParallelBrush` takes intervals in axis terms (category names, dates, numbers, in any order; up to 16 per axis). `[]` clears.

```ts
sdk.setParallelBrush([
  { dimension: 'Origin', range: ['EU', 'JP'] },
  { dimension: 'Weight', range: [1800, 2600] },
  { dimension: 'Weight', range: [3200, 3600] },
]);
sdk.on('parallelBrush', (e) => console.log(e.activeCount, e.total, e.intervals, e.source));
// e.source: 'pointer' | 'keyboard' | 'api'
const rows = sdk.getParallelActiveRows();          // row indices inside the brush
const csv = sdk.exportParallelCSV({ activeOnly: true });
```

React and Vue: `<CharturboChart type="parallel" data={...} options={...} onParallelBrush={...} />` (Vue: `@parallel-brush`).

[Live example](https://jparkk0517.github.io/Charturbo/business.html#06-parallel-brush)

## Performance

100,000 rows × 8 dimensions (700,000 segments) stay interactive: building the chart takes about 11 ms on the CPU, a brush change about 1 ms (a 400 KB flag upload), a hover hit test under 1 ms (release build, desktop). The large example shows the build, brush and frame times live.

[Live example](https://jparkk0517.github.io/Charturbo/business.html#07-parallel-large)

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. Hover highlights the nearest line and shows every dimension of its row. Zoom, pan and cursor sync are disabled.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'parallel'
// ctx.xLabel = 'Sedan · Row 12'
// ctx.parallel = { row, series, seriesName, values: [{ dimension, value, text }, ...] }
```

## Notes

- Accessibility: summary (rows, dimensions, series, rows inside the brush), one sentence per dimension (range or categories) and per brushed axis, a data table. Keyboard: Up / Down (vertical: Left / Right) move between rows in value order on the focused axis, Left / Right (vertical: Up / Down) change the axis, Home / End, Page Up / Down; Shift with a move brushes the range from where it started, Delete clears the focused axis, Escape clears all. See [Accessibility](../guide/accessibility).
- CSV export lists every row (series, then one column per dimension); SVG export draws the lines, axes and brush bands as vectors.
- Labels: horizontal ticks sit left of each axis and names above the plot; vertical ticks sit below each axis and names to the left.

## See also

- [Heatmap](./heatmap) (colormaps and the colorbar)
- [Radar](./radar)
- [Tooltips & Hover](../guide/tooltips)
