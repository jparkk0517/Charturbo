# Polar Coordinates

`renderPolarChart` draws series in a polar coordinate system: an angle axis around the circle and a radius axis from the center out (ECharts `polar` with `angleAxis` / `radiusAxis`). Either axis can be a category or a value axis. Series can be radial bars, ring bars, stacked bars, lines (open or closed, smooth, filled), scatter points and heatmap cells.

[Live example](https://jparkk0517.github.io/Charturbo/business.html#08-polar-bar)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPolarChart(
  {
    series: [
      { type: 'bar', name: 'Sales', data: [5, 8, 3, 6, 9, 4], roundCap: true },
      { type: 'bar', name: 'Cost', data: [3, 4, 6, 2, 5, 7] },
    ],
  },
  { title: 'Weekly sales', angleAxis: { data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] }, innerRadius: 0.15 }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderPolarChart(data: PolarChartData, options?: PolarChartOptions): { seriesCount: number; itemCount: number }
```

## Data format

```ts
interface PolarChartData { series: PolarSeriesOptions[] }

interface PolarSeriesOptions {
  type: 'bar' | 'line' | 'scatter' | 'heatmap';
  name?: string;
  data: ArrayLike<number | null> | ReadonlyArray<ReadonlyArray<number | string | null>>;
  stack?: string;
  color?: ColorInput;
  roundCap?: boolean;   // bar
  smooth?: boolean;     // line
  area?: boolean;       // line
  closed?: boolean;     // line
  symbolSize?: number;  // line / scatter, CSS px
  lineWidth?: number;   // line, CSS px
}
```

- With exactly one category axis, a bar or line series can be a plain array: one value per category (`null` = gap).
- Otherwise, items are `[radius, angle]` pairs, like ECharts. Heatmap items are `[radius, angle, value]` cells (`value` `null` = empty cell). A coordinate on a category axis is a category name or index.
- Bars need exactly one category axis. When it is the angle axis, the bars grow outward (radial bars). When it is the radius axis, they run around the circle (ring bars).
- A heatmap needs category angle and radius axes.
- Series with the same `stack` name pile up. Positive and negative values stack separately.
- Limits: 64 series, 200,000 items and 10,000 categories per axis.
- The input is validated before the current chart is replaced. If it throws, the previous chart stays.

## Axes

```ts
interface PolarAxisOptions {
  type?: 'category' | 'value'; // default: 'category' with data, else 'value'
  data?: string[];             // category names
  min?: number;
  max?: number;
  splitNumber?: number;        // tick count hint, default 5
  labels?: boolean;            // default true
  splitLine?: boolean;         // circles (radius) / spokes (angle), default true
  name?: string;               // tooltip / table name
}
```

A value axis gets nice ticks over the data. The radius axis starts at 0. When the angle axis covers a full turn, its last tick is dropped if it lands on or next to the first one.

```ts
sdk.renderPolarChart(
  {
    series: [
      { type: 'bar', name: 'A', data: [40, 28, 35, 22], stack: 'total' },
      { type: 'bar', name: 'B', data: [25, 30, 18, 26], stack: 'total' },
    ],
  },
  { radiusAxis: { data: ['N', 'S', 'E', 'W'] }, angleAxis: { max: 100 }, startAngle: 90 }
);
```

[Live example: stacked ring bars](https://jparkk0517.github.io/Charturbo/business.html#09-polar-stacked)

## Lines and scatter

```ts
const curve = Array.from({ length: 36 }, (_, k) => [2 + Math.sin(k / 3), k * 10]);
sdk.renderPolarChart(
  {
    series: [
      { type: 'line', name: 'Curve', data: curve, smooth: true, closed: true, area: true },
      { type: 'scatter', name: 'Points', data: [[1, 30], [3.5, 140], [4, 250]], symbolSize: 8 },
    ],
  },
  { angleAxis: { min: 0, max: 360 }, radiusAxis: { max: 5 } }
);
```

[Live example](https://jparkk0517.github.io/Charturbo/business.html#10-polar-line)

## Polar heatmap

```ts
const hours = Array.from({ length: 24 }, (_, h) => `${h}h`);
const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
sdk.renderPolarChart(
  { series: [{ type: 'heatmap', name: 'Requests', data: days.flatMap((d) => hours.map((h, i) => [d, h, i % 7])) }] },
  { angleAxis: { data: hours }, radiusAxis: { data: days }, innerRadius: 0.2, colorScale: 'viridis' }
);
```

Colors use the [heatmap](./heatmap) colormap (`colorScale`, `color`, `reverse`, `min` / `max` / `center`) and the colorbar.

[Live example](https://jparkk0517.github.io/Charturbo/business.html#11-polar-heatmap)

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `angleAxis` | `PolarAxisOptions` | value axis | Angle axis. |
| `radiusAxis` | `PolarAxisOptions` | value axis | Radius axis. |
| `startAngle` | `number` | `0` | Where the angle axis starts, in degrees clockwise from 12 o'clock (same as pie and chord). ECharts measures counterclockwise from 3 o'clock instead. |
| `clockwise` | `boolean` | `true` | The angle axis runs clockwise. |
| `innerRadius` | `number` | `0` | Hole in the center, as a fraction of the outer radius (0 to 0.9). |
| `barCategoryGap` | `number` | `0.2` | Gap between categories, as a fraction of a category band (0 to 0.95). |
| `barGap` | `number` | `0.3` | Gap between the bars of a category, as a fraction of a bar (-1 to 10). |
| `palette` | `ColorInput[]` | theme palette | Series colors. |
| `showGrid` | `boolean` | `true` | Split circles and spokes. |
| `legend` | `boolean \| ChartLegendOptions` | shown for 2+ series | Series legend. Hover emphasizes a series, click hides it. |
| `colorScale` · `color` · `reverse` | | `'sequential'` | Heatmap colormap, as in `renderHeatmap`. |
| `min` · `max` · `center` | `number` | data extent | Heatmap value domain. |
| `emptyColor` | `ColorInput` | theme grid tone | Heatmap cells without a value. |
| `colorbar` | `boolean \| HeatmapColorbarOptions` | shown with a heatmap | Heatmap colorbar. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of heatmap values in the tooltip, table and colorbar. |
| `format` | `ChartValueFormat` | locale number | Value text of tooltips, labels and accessibility. See [Number & Date Formats](../guide/number-format). |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

Invalid input throws: an unknown series or axis type, a bar series without exactly one category axis, a heatmap without two category axes, an unknown category, non-finite values or bounds, `min >= max`, out-of-range `innerRadius` / `barCategoryGap` / `barGap` / `symbolSize` / `lineWidth`, and too many series, items or categories.

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on.

- Hovering a bar or cell outlines it, and lines and points are hit by proximity. The tooltip shows the series, the angle and radius coordinates and the value.
- The legend emphasizes a series on hover. A click hides the series, re-stacks the bars and fits the value axes again. With `animation` on, the marks tween to the new layout.
- Brush, zoom and pan are disabled.

Data point ids: item `i` of series `s` is the item count of the series before `s` plus `i`.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'polar'
// ctx.polar = { series, seriesName, type, index, angle, radius, value }
// angle / radius: category name or formatted value; value: heatmap cell value, else the value-axis coordinate
```

## Notes

- Axis scales, ticks, bars, lines, cells, grid, hit testing, emphasis and label anchors are computed in the engine (Rust). The marks are vector shapes, so `exportChartSVG` writes them as SVG paths.
- Accessibility: the summary gives the series count and both axis ranges. The data table and `exportChartCSV` list every item (series, angle, radius, and the value for a heatmap). Keys: Left / Right move between the items of a series, Up / Down change the series, Home / End jump to the first / last item and Page Up / Page Down move by 10. See [Accessibility](../guide/accessibility).
- Label width is estimated (about 6.8 px per character of 11 px text).
- React / Vue: `type="polar"`.

## See also

- [Radar](./radar)
- [Pie · Donut](./pie)
- [Heatmap](./heatmap)
