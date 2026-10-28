# Error Bar · Impulse

Two standalone charts for independent samples. An error bar chart draws a whisker from a low to a high bound around each center value. An impulse (stem) chart draws a stem from a baseline to each sample. Neither chart connects neighbouring samples or decimates them like a line.

[Live example](https://jparkk0517.github.io/Charturbo/line.html#08-error-bars)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderErrorBarChart([
  { name: 'Measurement', x: [1, 2, 3], values: [10, 15, 12], errorLow: 2, errorHigh: [3, 5, 4],
    capWidth: 12, showCenter: true },
]);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

// Impulse chart
sdk.renderImpulseChart([
  { name: 'Events', x: [0, 1, 2, 3], values: [0, 5, -3, 0], baseline: 0, showMarker: true },
]);
sdk.render();
```

```ts
renderErrorBarChart(
  series: ErrorBarSeriesDescriptor[],
  options?: ErrorBarChartOptions
): { totalPoints: number; seriesCount: number }

renderImpulseChart(
  series: ImpulseSeriesDescriptor[],
  options?: ImpulseChartOptions
): { totalPoints: number; seriesCount: number }
```

## Data format

Both charts share these series fields:

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Legend and tooltip name. |
| `values` | `Float32Array \| number[]` | — | Center values (error bar) or sample values (impulse). |
| `x` | `Float64Array \| number[] \| Date[]` | index | Finite, non-decreasing. Give it for every series or none. |
| `color` | `ColorInput` | theme palette | Series color. |
| `lineWidth` | `number` | chart value, else `1.5` | Stroke width in CSS px. |
| `yAxis` | `'left' \| 'right'` | `'left'` | Right y axis. |

### Error bar bounds

Each error bar series uses exactly one of three representations:

| Fields | Meaning |
|---|---|
| `low`, `high` | Absolute bounds, one per value. Inverted bounds are swapped. |
| `error` | Symmetric relative error: a number or an array. |
| `errorLow`, `errorHigh` | Asymmetric relative errors: numbers or arrays. |

Relative errors use their absolute value and are applied around `values`. Mixing representations throws.

### Error bar style

These fields can be set per series or as chart-wide defaults in the options. Series values win.

| Field | Type | Default | Description |
|---|---|---|---|
| `errorMode` | `'both' \| 'high' \| 'low'` | `'both'` | `'both'` draws low ↔ high. `'high'` / `'low'` draws center ↔ that bound. |
| `direction` | `'vertical' \| 'horizontal'` | `'vertical'` | `'horizontal'`: `low` / `high` are x coordinates and `values` are y coordinates. |
| `capWidth` | `number \| string` | `'40%'` | Full cap length: a number in CSS px, or a percent string (`'55%'`) of the mean category spacing. |
| `drawWhiskers` | `boolean` | `true` | Draw the caps. |
| `drawConnector` | `boolean` | `true` | Draw the stem between the bounds. |
| `showCenter` | `boolean` | `false` | Marker at the center value. |
| `symbolSize` | `number` | `6` | Center marker size. |

- A sample whose used bound or center is not finite is a gap.
- With `direction: 'horizontal'` the center marker is at `(x, values)`. Relative errors and one-sided stems are still based on `values`, as in ChartGPU v0.4.0. For a normal horizontal confidence interval, use absolute `low` / `high` and `errorMode: 'both'`.

### Impulse style

Per series or as chart-wide defaults:

| Field | Type | Default | Description |
|---|---|---|---|
| `baseline` | `number` | `0` | Stem floor in data units. |
| `showMarker` | `boolean` | `true` | Circular tip marker. When a value equals the baseline, the stem is skipped and only the marker remains. |
| `symbolSize` | `number` | `6` | Tip marker size. |

## Options

`ErrorBarChartOptions` and `ImpulseChartOptions` take every [line chart option](./line#options) except `viewMode`, `nulls` and `animation`, plus the style fields above as defaults. The default `lineWidth` is `1.5`. Both charts are 2D only and have no sampling options.

```ts
sdk.renderErrorBarChart(
  [{ name: 'Estimate', x: [12, 20, 28], values: [1, 2, 3],
     low: [5, 8, 20], high: [22, 35, 39], direction: 'horizontal', showCenter: true }],
  { title: 'Confidence intervals', capWidth: 16, axes: { x: { title: 'Effect' } } }
);
```

## Hover, tooltips and selection

- The pointer hit-tests the real stems, caps and markers.
- The XY brush selects stems / bounds that cross the box in data units. The CSS-px cap width is not part of the brush range.
- Tooltip `chartType` and selection `kind` are `'errorBar'` or `'impulse'`. Error bar items carry `errorBar: { low, high, direction }`; impulse items carry `baseline`.
- Keyboard tooltips and CSV give the center, low and high (error bar) or the value and baseline (impulse). SVG export writes vector paths.
- Color, right y axis, legend, zoom and pan are supported.

See [Tooltips & Hover](../guide/tooltips) and [Interactions](../guide/interactions).

## Updating data

Call `renderErrorBarChart` or `renderImpulseChart` again with every channel. `setSeriesData` and `appendSeriesData` throw on both chart types.

## Frameworks

```tsx
<CharturboChart type="errorBar" data={series} options={{ capWidth: 12 }} />
<CharturboChart type="impulse" data={series} />
```

See [React](../guide/react) and [Vue](../guide/vue).

More examples: [horizontal error bars](https://jparkk0517.github.io/Charturbo/line.html#09-error-horizontal), [impulse](https://jparkk0517.github.io/Charturbo/line.html#10-impulse).

## See also

- [Line](./line)
- [Band · Range](./band)
- [Bar](./bar) — error bars on bars
