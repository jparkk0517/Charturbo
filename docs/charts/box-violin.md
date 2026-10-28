# Box Plot · Violin

A box plot summarizes the distribution of raw samples per category: quartiles, whiskers, outliers and an optional mean. With `violin`, each group is drawn as a kernel density shape instead. The engine computes every statistic in O(n) per group and does not keep the raw samples.

[Live example](https://jparkk0517.github.io/Charturbo/box.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderBoxPlot(
  {
    categories: ['Mon', 'Tue', 'Wed'],
    series: [
      { name: 'Control', values: [monF32, tueF32, wedF32] }, // raw samples per category
      { name: 'Treated', values: [a, b, c] },
    ],
  },
  {
    title: 'Response time',
    axes: { y: { title: 'ms' } },
    whiskers: 'tukey',
    showOutliers: true,
    showMean: true,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBoxPlot(
  data: BoxPlotData,
  options?: BoxPlotOptions
): { boxCount: number; seriesCount: number; categoryCount: number; sampleCount: number }
```

Data point ids: box = `series * categories + category`; outlier ids follow the boxes.

## Data format

`BoxPlotData`:

| Field | Type | Description |
|---|---|---|
| `categories` | `string[]` | Category (x axis) labels. |
| `series[].name` | `string` | Series name. |
| `series[].values` | `(Float32Array \| number[] \| null \| undefined)[]` | One raw sample array per category. Empty or missing = no box. |
| `series[].color` | `ColorInput` | Default: theme palette in series order. |

Several series are laid out side by side in each category, like grouped bars.

## Options

`BoxPlotOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `whiskers` | `'tukey' \| 'minmax' \| [number, number]` | `'tukey'` | `'tukey'`: last sample within `iqrFactor` × IQR of the quartiles. `'minmax'`: data extremes (no outliers). `[p0, p1]`: percentiles 0–100, e.g. `[5, 95]`. |
| `iqrFactor` | `number` | `1.5` | Tukey IQR factor. |
| `showOutliers` | `boolean` | `true` | Outliers as points (box mode). |
| `maxOutliers` | `number` | `10000` | Drawn outliers per group. More are sampled evenly; the count stays exact. |
| `showMean` | `boolean` | `false` | Mean as a hollow dot. |
| `outline` | `boolean` | `false` | Boxes as outlines instead of filled bars. |
| `violin` | `boolean \| BoxPlotViolinOptions` | `false` | Violins (KDE) instead of boxes. |
| `colors` | `ColorInput[]` | theme palette | Series colors. |
| `title` | `string` | — | Chart title. |
| `description` | `string` | — | Accessible name of the canvas. |
| `valueLabel` | `string` | `'Value'` (localized) | Tooltip and table name of the values. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | Axis titles and formats. |
| `legend` | `ChartLegendOptions \| boolean` | shown for 2+ series | Series legend with toggle and emphasis. |
| `groupGap` | `number` | `0.3` | Empty fraction of each category slot between groups. |
| `boxGap` | `number` | `2` | CSS px gap between the boxes of a group. |
| `cornerRadius` | `number` | `4` | Rounded box ends in CSS px. |
| `whiskerWidth` | `number` | `1.5` | Whisker / outline stroke width in CSS px. |
| `outlierRadius` | `number` | `3` | Outlier dot radius in CSS px. |
| `hover` | `ChartHoverStyle` | — | Hover style. |
| `showBackdropGrid` | `boolean` | `true` | Horizontal gridlines and baseline. |
| `grid` | `ChartGridStyle` | — | Grid style. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. |
| `animation` | `ChartAnimationInput` | SDK setting | Enter / update animation. |
| `width` | `number` | `164` | World width of the plot. |
| `height` | `number` | `80` | World height of the plot. |

## Violin

```ts
sdk.renderBoxPlot(data, { violin: { showBox: true, scale: 'area', opacity: 0.3 } });
```

`BoxPlotViolinOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `bandwidth` | `number` | Silverman's rule per group | Gaussian kernel bandwidth in data units. |
| `showBox` | `boolean` | `true` | Inner box (whisker line, IQR bar, median dot). `false` = median line only. |
| `scale` | `'area' \| 'width'` | `'area'` | `'area'`: every violin encloses the same area. `'width'`: each violin reaches full width. |
| `opacity` | `number` | `0.3` | Fill opacity of the violin body. |

The KDE is evaluated on 128 points after linear binning onto a fine grid: O(n + grid), not O(n · grid), even for 1,000,000 samples. Violins draw no outlier points.

## Statistics

- Quartiles use selection (`select_nth_unstable`), not sorting, and match numpy's linear interpolation.
- One more pass computes the whisker ends, the outlier count and the standard deviation.
- Outliers beyond `maxOutliers` are sampled at even, deterministic steps; the minimum and maximum are kept.

## Hover and legend

- Hovering a box shows min, Q1, median, Q3, max, mean, whiskers, n and the outlier count. Hovering an outlier shows its value. `ctx.box` holds these statistics.
- The legend (2+ series) toggles and emphasizes series. More than 8 series fold into "Other".
- Box plots have no brush and no zoom.

See [Tooltips & Hover](../guide/tooltips).

## Accessibility

The chart provides a summary, a data table and CSV with one row per category × series, and keyboard navigation (left / right = category, up / down = series). See [Accessibility](../guide/accessibility).

## Updating data

Call `renderBoxPlot` again with the new samples.

## Frameworks

```tsx
<CharturboChart type="box" data={{ categories, series }} options={{ violin: true }} />
```

## See also

- [Histogram](./histogram)
- [Bar](./bar)
