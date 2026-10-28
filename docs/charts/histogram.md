# Histogram

A histogram bins raw values and draws one gap-free bar per bin. The engine bins the data in O(n), so 1,000,000+ values are fine. Use it to show the distribution of a single variable.

[Live example](https://jparkk0517.github.io/Charturbo/bar.html#03-histogram)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const values = new Float32Array(500_000).map(() => Math.random() * 100);
const bins = sdk.renderHistogram(values, { bins: 'auto', title: 'Response time (ms)' });
console.log(`${bins.binCount} bins (${bins.rule})`);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderHistogram(
  values: Float32Array | number[],
  options?: HistogramChartOptions
): HistogramResult
```

Data point ids are the bin indices.

## Data format

`values` is a flat `Float32Array` (preferred) or `number[]` of raw samples. Non-finite values and values outside `range` are ignored.

The method returns the bins the engine computed:

| Field | Type | Description |
|---|---|---|
| `binCount` | `number` | Number of bins. |
| `edges` | `Float64Array` | `binCount + 1` ascending bin edges. |
| `counts` | `Float64Array` | Samples per bin. |
| `heights` | `Float64Array` | Bar heights: counts, or densities with `density: true`. |
| `total` | `number` | Finite values inside the range. |
| `rule` | `'freedman-diaconis' \| 'sturges' \| 'fixed'` | Binning rule that was used. |

## Options

`HistogramChartOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `bins` | `'auto' \| number` | `'auto'` | `'auto'`: Freedman–Diaconis, or Sturges when the IQR is 0 (max 1000 bins). A number sets equal-width bins (max 10000). |
| `range` | `[number, number]` | finite data extent | Binned range. Values outside are ignored. |
| `density` | `boolean` | `false` | Bar heights are densities whose total area is 1. |
| `color` | `ColorInput` | theme palette[0] | Bar color. |
| `barGap` | `number` | `1` | CSS px between bars. |
| `cornerRadius` | `number` | `0` | Rounded bar tops in CSS px. |
| `title` | `string` | — | Chart title. |
| `description` | `string` | — | Accessible name of the canvas. |
| `locale` | `string` | SDK locale | Locale of default labels. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | x ticks land on bin edges and receive the edge value. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. |
| `hover` | `ChartHoverStyle` | — | Hover style. |
| `grid` | `ChartGridStyle` | — | Grid style. |
| `width` | `number` | `164` | World width of the plot. |
| `maxBarHeight` | `number` | `78` | World height of the tallest bar. |

## Hover

The tooltip label is the bin range `a – b`, with the count (or the density and the count when `density: true`).

## Updating data

Call `renderHistogram` again with the new values. Binning is O(n), so re-binning large arrays is cheap.

## Notes

- Histograms are always vertical and 2D. They have no zoom or pan and no `animation` option.
- For grouped distributions with quartiles, use [Box Plot · Violin](./box-violin).

## Frameworks

```tsx
<CharturboChart type="histogram" data={values} options={{ bins: 40 }} />
```

## See also

- [Bar](./bar)
- [Box Plot · Violin](./box-violin)
