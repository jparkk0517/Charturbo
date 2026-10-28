# Bar

Bar charts compare values across categories. `renderBarChart` draws a single series; `renderGroupedBarChart` draws several series grouped, stacked, or stacked to 100%. Bars can be vertical or horizontal, carry data labels and error bars, or switch to a lit 3D matrix view.

[Live example](https://jparkk0517.github.io/Charturbo/bar.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGroupedBarChart(
  {
    categories: ['Q1', 'Q2', 'Q3', 'Q4'],
    series: [
      { name: 'North', values: [10, 20, 30, 40] },
      { name: 'South', values: [5, -5, 15, NaN] }, // NaN = no value
    ],
  },
  { mode: 'stacked', title: 'Revenue' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderBarChart(
  items: BarChartItemDescriptor[],
  options?: BarChartOptions
): { barCount: number }

renderGroupedBarChart(
  data: GroupedBarChartData,
  options?: GroupedBarChartOptions
): { barCount: number; seriesCount: number; categoryCount: number }
```

## Data format

### Single series

`renderBarChart` takes one item per bar:

```ts
sdk.renderBarChart(
  [
    { label: 'Mon', value: 42, error: 4 },
    { label: 'Tue', value: 37 },
  ],
  { labels: true, legend: true, seriesName: 'Visits' }
);
```

| Field | Type | Description |
|---|---|---|
| `label` | `string` | Category label. |
| `value` | `number` | Bar value. Negative values hang below the zero baseline. |
| `error` | `number \| [number, number] \| null` | Error bar: `±e` or `[minus, plus]` in value units (2D). |
| `category` | `string` | Optional group key. Without the `color` option, items of one category share a palette color, and a single-series legend lists the categories. |
| `color` | `ColorInput` | Bar color. Wins over the category color and the `color` option. |
| `attributes` | `Record<string, string \| number \| boolean>` | Extra key / values merged into the bar's details (`getNodeDetails`, click callbacks). |

Data point ids are the bar indices.

### Multiple series

`renderGroupedBarChart` takes `{ categories, series }`. Every series has one value per category; `NaN` means no value.

| Field | Type | Description |
|---|---|---|
| `categories` | `string[]` | Category labels. |
| `series[].name` | `string` | Series name. |
| `series[].values` | `Float32Array \| number[]` | One value per category. |
| `series[].error` | `(number \| [number, number] \| null)[]` | Error bar per category (`null` = none). |
| `series[].color` | `ColorInput` | Default: theme palette in series order. |

Data point id = `seriesIndex * categories.length + categoryIndex`.

## Options

`BarChartOptions` (both methods):

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Chart title. |
| `description` | `string` | — | Accessible name of the canvas. |
| `viewMode` | `'2d' \| '3d'` | `'2d'` | Flat bars or a lit 3D matrix. Multi-series 3D shows the first series only. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | Horizontal bars (2D only). |
| `labels` | `boolean \| 'auto' \| BarLabelOptions` | off | Data labels (2D). See [Data labels](#data-labels). |
| `errorBars` | `BarErrorBarStyle` | — | Look of error bars. See [Error bars](#error-bars). |
| `legend` | `ChartLegendOptions \| boolean` | multi: shown for 2+ series; single: hidden | Single series: a static key of item `category` values, or one entry named `seriesName`. |
| `seriesName` | `string` | `'Value'` (localized) | Legend entry name of a single-series chart. |
| `color` | `ColorInput` | first palette color | Default bar color for items without `color`. |
| `cornerRadius` | `number` | `4` | Rounded data-end corners in CSS px (2D). |
| `barThickness` | `number` | 72% of the slot | Bar width in world units. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | — | Axis titles and formats. With `'horizontal'`, `x` is the value axis and `y` the category axis. |
| `hover` | `ChartHoverStyle` | — | Hover style, e.g. `barHighlightColor`. |
| `grid` | `ChartGridStyle` | — | Grid rows, color, stroke width. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. |
| `animation` | `ChartAnimationInput` | SDK setting | Enter / update animation. |
| `width` | `number` | `164` | World width of the plot. |
| `maxBarHeight` | `number` | `78` | World height of the tallest bar. |

`GroupedBarChartOptions` adds:

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'grouped' \| 'stacked' \| 'percent'` | `'grouped'` | Series side by side, stacked, or stacked to 100%. |
| `groupGap` | `number` | `0.28` | Empty fraction of each category slot between groups. Ignored with `barThickness`. |
| `barGap` | `number` | `2` | CSS px between the bars of a group or between stacked segments. |

## Modes

- `grouped`: series sit side by side inside each category slot.
- `stacked`: positive values stack up and negative values stack down, separately. The value axis uses the stacked sums. Only the outer segment ends are rounded.
- `percent`: each category's absolute sum is normalized to 100%. The y labels show `%`.

## Horizontal bars

```ts
sdk.renderGroupedBarChart(data, { orientation: 'horizontal' });
```

- Categories run down the left axis, first category at the top. Labels are thinned to about one per 18 px.
- Values run along the x axis with nice ticks and vertical gridlines. Rounded ends point right (negative values left).
- Works with single, grouped, stacked and percent bars. The left margin fits the category label length.
- The brush is off for horizontal bars. Annotations use x = value, y = category index.
- 3D bars and histograms are always vertical.

## Data labels

```ts
sdk.renderGroupedBarChart(data, {
  labels: { show: 'auto', position: 'inside', format: { maximumFractionDigits: 1 } },
});
```

`labels` takes `true`, `'auto'` or `BarLabelOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `show` | `boolean \| 'auto'` | `true` | `'auto'` moves inside labels that do not fit to the outside, and hides labels that leave the canvas, overlap another label, or cover another bar. |
| `position` | `'outside' \| 'inside' \| 'insideBase' \| 'center'` | `'outside'` | `'outside'` is beyond the data end and its error bar. |
| `format` | function, spec string or `Intl.NumberFormatOptions` | value axis format | `(value, ctx) => string`, a spec like `'.1f'` or `'$,.0f'`, or `Intl` options. Percent bars format the share. |
| `color` | `ColorInput` | auto | Outside: theme text color. Inside: light or dark by bar luminance. |

- The engine computes label anchors, fit and collision tests in CSS px; the DOM only places the text. Labels are included in PNG export.
- Stacked segment labels always sit inside (centered) and show only when the text fits.
- Format specs are described in [Number & Date Formats](../guide/number-format).

## Error bars

Set `error` on items or `error[]` on series: `±e` or `[minus, plus]` in value units.

| `errorBars` field | Type | Default | Description |
|---|---|---|---|
| `color` | `ColorInput` | theme secondary text color | Stroke color. |
| `width` | `number` | `1.25` | Stroke width in CSS px. |
| `cap` | `number` | `0.4` | Cap length as a fraction of the bar thickness. `0` = no caps. |

The engine draws capped segments and includes them in the value domain (stacked bars: at the segment's stacked end; percent mode ignores errors). Tooltips show `±e` or `+p / −m` (`ChartTooltipItem.error`).

## Legend, hover and selection

- Multi-series legend: click hides a series and the engine re-lays out or re-stacks (the value axis stays fixed); hover fades the other series. `setSeriesVisible(i, false)` and `emphasizeSeries(i)` do the same.
- Hover: grouped bars report the bar under the pointer. Stacked / percent bars report every series of the category (tooltip `ctx.total`, `item.percent`), with the segment under the pointer as primary.
- Brush selection always selects an x range of categories.

See [Tooltips & Hover](../guide/tooltips) and [Interactions](../guide/interactions).

## Updating data

Bar charts have no partial update method. Call `renderBarChart` or `renderGroupedBarChart` again with the new data. Style-only changes: `setChartHoverStyle`, `setChartGrid`.

## Frameworks

`type="bar"` takes either an item array (single series) or `{ categories, series }`:

```tsx
<CharturboChart type="bar" data={{ categories, series }} options={{ mode: 'stacked' }} />
```

## See also

- [Histogram](./histogram)
- [Combo](./combo) — bars with lines
- [Number & Date Formats](../guide/number-format)
