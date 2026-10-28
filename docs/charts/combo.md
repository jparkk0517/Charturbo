# Combo

A combo chart draws bar, line and area series on one plot. The series share a category or x axis, and an optional right y axis can carry a second unit. Use it for measures that belong together, such as revenue bars with a target line.

[Live example](https://jparkk0517.github.io/Charturbo/combo.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderComboChart(
  {
    categories: ['Jan', 'Feb', 'Mar', 'Apr'],
    series: [
      { name: 'Online', type: 'bar', values: [12, 18, 22, 19] },
      { name: 'Retail', type: 'bar', values: [8, 9, 7, 11] },
      { name: 'Target', type: 'area', values: [18, 22, 26, 28] },
      { name: 'Margin %', type: 'line', yAxis: 'right', values: [21, 24, 23, 27],
        marker: true, dash: [5, 3], curve: 'monotone' },
    ],
  },
  {
    barMode: 'stacked',
    title: 'Revenue and margin',
    axes: { x: { title: 'Month' }, y: { title: 'Revenue', min: 0 }, y2: { title: '%', format: (v) => `${v}%` } },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderComboChart(
  data: ComboChartData,
  options?: ComboChartOptions
): { seriesCount: number; categoryCount: number; pointCount: number }
```

Data point id = `series * categories + category`.

## Data format

`ComboChartData`:

| Field | Type | Description |
|---|---|---|
| `categories` | `string[]` | Category labels of a category x axis. |
| `x` | `Float64Array \| number[] \| Date[]` | Or numeric / time x of each category: strictly increasing; epoch ms or `Date[]` for time. |
| `series` | `ComboSeriesDescriptor[]` | One value per category in every series. |

`ComboSeriesDescriptor`:

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Legend and tooltip name. |
| `type` | `'bar' \| 'line' \| 'area'` | — | `'area'` is a line filled down to zero, translucent. |
| `values` | `Float32Array \| number[]` | — | One value per category. `NaN` / `null` = missing. |
| `yAxis` | `'left' \| 'right'` | `'left'` | Any `'right'` series adds a right y axis (`axes.y2`). All bar series share the first bar series' axis. |
| `color` | `ColorInput` | theme palette | Series color. |
| `lineWidth` | `number` | chart `lineWidth` | Stroke width of line / area series in CSS px. |
| `marker`, `dash`, `curve`, `nulls` | line styles | — | Line / area series take the [line styles](./line#line-styles). |

With numeric or time `x`, the bar slot width is the smallest x gap (bars never overlap; a bar is 72% of it), and the x ticks are the same numeric / calendar ticks as on line charts.

## Options

`ComboChartOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `barMode` | `'grouped' \| 'stacked' \| 'percent'` | `'grouped'` | Layout of the bar series. |
| `axes` | `{ x?: ComboXAxisOptions; y?: ComboYAxisOptions; y2?: ComboYAxisOptions }` | — | See below. |
| `title` | `string` | — | Chart title. |
| `description` | `string` | — | Accessible name of the canvas. |
| `legend` | `ChartLegendOptions \| boolean` | shown for 2+ series | Click toggles (bars re-stack), hover emphasizes. |
| `groupGap` | `number` | `0.28` | Empty fraction of each category slot between bar groups. |
| `barGap` | `number` | `2` | CSS px between grouped bars or stacked segments. |
| `cornerRadius` | `number` | `4` | Rounded bar ends in CSS px. |
| `fillOpacity` | `number` | `0.2` | Fill alpha multiplier of area series. |
| `lineWidth` | `number` | `2` | Stroke width of line / area series in CSS px. |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | `'gap'` | Missing samples of line / area series. Series `nulls` wins. |
| `hover` | `ChartHoverStyle` | — | Hover style. |
| `showBackdropGrid` | `boolean` | `true` | Horizontal gridlines and baseline. |
| `grid` | `ChartGridStyle` | — | Grid style. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. |
| `locale` | `string` | SDK locale | Locale of default number / time labels. |
| `timeZone` | `CharturboTimeZone` | SDK zone | Time zone of a time x axis. |
| `width` | `number` | `168` | World width of the plot. |
| `height` | `number` | `86` | World height of the plot. |

Axis options:

| Axis | Fields | Description |
|---|---|---|
| `x` | `ChartAxisOptions` + `type?: 'numeric' \| 'time'` | `type` applies to explicit `x`: `'numeric'` (default) or `'time'` (default for `Date[]`). |
| `y`, `y2` | `ChartAxisOptions` + `min?`, `max?`, `nice?` | Fixed domain ends. `nice` (default `true`) expands data-derived ends to whole tick steps. |

## Layout

- Category `i` sits at data x `i` (or `x[i]`). The x domain is widened by half a slot on both sides, so line points sit exactly on the bar slot centers.
- Bar series use the bar engine (grouped / stacked / percent, re-stacking on legend toggles). Line and area series use the line engine (M4 decimation, markers, dashes, curves, null policies).
- Draw order: bars, then area fills (translucent, down to 0), then lines, then markers.
- Areas are not stacked: each fills down to 0.

## Y domains

- Domains are fixed (no autoscale). Each axis covers all of its series, hidden series included (stacked bars: the sums), expanded to nice ticks.
- The bar axis and area series always include 0. Zeros filled by `nulls: 'zero'` are part of the domain.
- Fix the ends with `axes.y` / `axes.y2` `min`, `max`, `nice`. Read them with `getYDomain()` and `getY2Domain()`.
- If every series ends up on the right axis, they move to the left axis.
- Log and reversed scales are not supported.

::: warning
Dual y axes invite readers to compare unrelated scales: the choice of the two ranges alone can make a line appear to "cross" the bars. Use the right axis only for a different unit, and label both axes clearly. Consider two charts sharing the same x, or a single indexed axis, first.
:::

## Hover and legend

- Hover uses index mode: one tooltip (`chartType: 'combo'`) lists every visible series at the hovered category. Bars are tinted, line and area points get markers, and a crosshair is drawn when there are line series.
- The primary item is the bar segment or line point closest to the pointer (a line point inside a bar wins). `hover: { mode: 'nearest' }` or `tooltip: { shared: false }` shows only that item.
- `hoverAtX` (cursor sync) snaps to the closest category.
- Legend symbols: bar = square, line = line segment, area = light block with a top line. A toggle re-stacks or re-groups the bars (domains stay fixed). Emphasis fades every other series, of any type.

See [Tooltips & Hover](../guide/tooltips) and [Dashboard Sync](../guide/dashboard-sync).

## Zoom and pan

x zoom and pan work with the wheel, drag, touch and `setXRange`. Bars widen with the zoom window and are clipped to the plot.

Not supported on combo charts: brush, navigator, bar data labels, bar error bars and line range bands.

## Accessibility

Summary (series by type, dual axis, ranges), description (axis titles; type, axis, max, min and mean per series), data table and CSV (rows = categories, columns = all series), and keyboard navigation (left / right = category, up / down = series). See [Accessibility](../guide/accessibility).

## Updating data

Call `renderComboChart` again with the new data.

## Frameworks

```tsx
<CharturboChart type="combo" data={{ categories, series }} options={{ barMode: 'grouped' }} />
```

## See also

- [Bar](./bar)
- [Line](./line)
- [Area](./area)
- [Data & Axes](../guide/data-and-axes)
