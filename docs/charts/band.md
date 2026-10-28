# Band · Range

A band chart fills the area between two edges without a center line. Use it for forecast ranges, min–max envelopes and confidence intervals that stand on their own. To draw a band under a line, use the line series `band` option instead (see [Line](./line#range-band)).

[Live example](https://jparkk0517.github.io/Charturbo/line.html#06-band)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderBandChart(
  [{
    name: 'Forecast range',
    x: new Float64Array([0, 1, 2, 3]),
    lower: [8, 12, 20, 11],
    upper: [12, 18, 16, 15], // crossings are allowed: the channel order is kept
    lowerLineWidth: 1.5,
    upperLineWidth: 1.5,
  }],
  { fillOpacity: 0.3, axes: { x: { title: 'Time' } } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBandChart(
  series: BandSeriesDescriptor[],
  options?: BandChartOptions
): { totalPoints: number; seriesCount: number }
```

One pair of edges counts as one series.

## Data format

`BandSeriesDescriptor`:

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Legend and tooltip name. |
| `lower` | `Float32Array \| number[]` | — | First edge. The name is conventional: crossings with `upper` are kept. |
| `upper` | `Float32Array \| number[]` | — | Second edge, one value per `lower` sample. |
| `x` | `Float64Array \| number[] \| Date[]` | — | x of each pair. Finite and non-decreasing. Give it for every series or none. |
| `color` | `ColorInput` | theme palette | Fill and edge color. |
| `yAxis` | `'left' \| 'right'` | `'left'` | Right y axis. |
| `curve` | `LineCurve` | `'linear'` | Edge interpolation, as on line charts. |
| `lowerLineWidth` | `number` | chart value, else `0` | Lower edge stroke in CSS px. `0` = fill only. |
| `upperLineWidth` | `number` | chart value, else `0` | Upper edge stroke in CSS px. |
| `fillOpacity` | `number` | chart value, else `0.25` | Alpha multiplier of the series color, 0..1. |
| `connectNulls` | `boolean` | chart value, else `false` | Bridge missing pairs. |

- `lower`, `upper` and `x` must have the same length within a series.
- Use `axes.x.type: 'time'` or `Date[]` for a time axis.
- A pair with an invalid value on either edge is a gap for the whole pair. With `connectNulls: true` the neighbouring valid pairs are joined.
- Where the edges cross, the engine splits the fill triangles at the real intersection point.

## Options

`BandChartOptions` takes every [line chart option](./line#options) except `viewMode`, `lineWidth`, `nulls` and `animation`, plus chart-wide defaults for the series fields:

| Option | Type | Default | Description |
|---|---|---|---|
| `lowerLineWidth` | `number` | `0` | Default lower edge stroke in CSS px. |
| `upperLineWidth` | `number` | `0` | Default upper edge stroke in CSS px. |
| `fillOpacity` | `number` | `0.25` | Default fill alpha multiplier. |
| `connectNulls` | `boolean` | `false` | Default for bridging missing pairs. |

Series values win over the chart values. Band charts are always 2D.

## Hover, tooltips and selection

- The large-data LOD keeps the minimum and maximum of both channels plus gaps.
- Hover and the XY brush test the real range, not a midpoint.
- Tooltip `chartType` and selection `kind` are `'band'`. `items[].band` holds the two original edges. `items[].value` is an internal midpoint used for selection.
- Keyboard navigation, legend, axes, zoom, pan and SVG export are supported. CSV export writes the two edges only.

See [Tooltips & Hover](../guide/tooltips) and [Interactions](../guide/interactions).

## Updating data

Call `renderBandChart` again with both edges. `setSeriesData` and `appendSeriesData` throw on band charts, because they would update only one channel.

## Frameworks

```tsx
<CharturboChart type="band" data={series} options={{ fillOpacity: 0.3 }} />
```

See [React](../guide/react) and [Vue](../guide/vue).

## See also

- [Line](./line) — `band` option under a line
- [Area](./area)
- [Error Bar · Impulse](./errorbar-impulse)
