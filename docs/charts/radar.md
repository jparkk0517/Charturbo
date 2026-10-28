# Radar

`renderRadarChart` draws a radar (spider) chart: one closed polygon per series over three or more axes. Use it to compare a few items across the same set of attributes.

[Live example](https://jparkk0517.github.io/Charturbo/business.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderRadarChart(
  {
    axes: ['Speed', 'Range', 'Cost', 'Comfort', 'Safety'],
    series: [
      { name: 'Model A', values: [82, 64, null, 71, 90] }, // null = missing
      { name: 'Model B', values: [55, 88, 70, 62, 74], color: '#d95926' },
    ],
  },
  { title: 'Vehicle comparison', max: 100, rings: 4, format: '.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderRadarChart(data: RadarChartData, options?: RadarChartOptions): { axisCount: number; seriesCount: number }
```

## Data format

```ts
interface RadarChartData {
  axes: string[];          // axis names, clockwise from startAngle; at least 3
  series: RadarSeries[];   // 1 to 8 series
}

interface RadarSeries {
  name: string;
  values: ArrayLike<number | null>;  // one per axis; finite and >= 0, null / NaN = missing
  color?: ColorInput;                // default: theme palette slot of the series
}
```

- Each series must have exactly one value per axis, and there must be 1 to 8 series; otherwise a `RangeError` is thrown.
- Negative or infinite values throw. A missing value (`null` / `NaN`) makes the polygon pass through the center at that axis, with no marker.
- Series colors follow the theme palette in fixed order (no cycling).

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `max` | `number \| (number \| null \| undefined)[]` | nice max of the data | Radial max shared by all axes, or one per axis (`null` = the shared max). Ring labels show only on a shared scale. |
| `rings` | `number` | `4` | Target ring count (nice steps). |
| `fillOpacity` | `number` | `0.2` | Polygon fill opacity. `0` = outlines only. |
| `strokeWidth` | `number` | `2` | Polygon stroke width in CSS px. |
| `markers` | `boolean \| number` | `true` (radius 3.5 px) | Vertex markers: `true`, `false`, or a radius in CSS px. |
| `startAngle` | `number` | `0` | Degrees clockwise from 12 o'clock of the first axis. |
| `grid` | `'polygon' \| 'circle'` | `'polygon'` | Shape of the concentric grid. |
| `showGrid` | `boolean` | `true` | Rings and spokes. |
| `format` | `ChartValueFormat` | locale number | Value text of rings, tooltip and accessibility (spec, `Intl` options or function). See [Number & Date Formats](../guide/number-format). |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `legend` | `ChartLegendOptions \| boolean` | shown with 2+ series | `{ show, toggle, emphasize }`. Click toggles a series, hover emphasizes it. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on.

- Hover picks the axis nearest to the pointer angle and returns every visible series on that axis; the nearest vertex is the primary item. The spoke is highlighted and its markers are enlarged.
- Legend click hides a series; legend hover fades the others and draws the emphasized series on top.
- Brush, zoom and pan are disabled.
- Data point ids are `series * axes + axis`.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'radar'
// ctx.index = axis index
// ctx.items = every visible series on that axis
// ctx.radar = { axis, max }
```

## Notes

- The nice radial scale, per-axis maxima, polygon / grid / marker geometry, hit testing and label anchors are computed in the engine (Rust). Lines and markers are sized in CSS px on the GPU.
- With per-axis maxima, ring value labels are omitted.
- Accessibility: summary (top axis per series), a data table (axis × series), left / right arrows move between axes and up / down between series. See [Accessibility](../guide/accessibility).

## See also

- [Gauge](./gauge)
- [Pie · Donut](./pie)
- [Tooltips & Hover](../guide/tooltips)
- [Number & Date Formats](../guide/number-format)
