# Waterfall

`renderWaterfallChart` draws a running total as floating bars: each change starts where the previous total ended, and subtotal / total bars start at zero. Use it to explain how a start value turns into an end value, such as a cash flow or a profit bridge.

[Live example](https://jparkk0517.github.io/Charturbo/business.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderWaterfallChart(
  {
    labels: ['Q1 start', 'Sales', 'Services', 'Refunds', 'H1', 'Costs', 'Tax'],
    values: [400, 180, 90, -60, null, -220, -45], // null = computed subtotal
    totals: [4],                                  // index of the "H1" subtotal
  },
  { title: 'Cash flow', total: 'End', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderWaterfallChart(data: WaterfallChartData, options?: WaterfallChartOptions): { itemCount: number }
```

`itemCount` includes the bar appended by `options.total`.

## Data format

```ts
interface WaterfallChartData {
  labels: string[];                         // one category per value
  values: (number | null)[] | Float64Array; // changes (finite); total items may be null
  totals?: number[] | boolean[];            // subtotal / total items: indices, or one flag per value
}
```

- `labels` and `values` must have the same length; otherwise a `RangeError` is thrown.
- A change item must be finite (otherwise it throws). A positive change is an increase, a negative one a decrease.
- A total item (listed in `totals`) is a bar from zero to the running total. Its value is ignored, so `null` is the usual input. It does not change the running total.
- `options.total` appends a final total bar.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `total` | `boolean \| string` | | Appends a final total bar: `true` (named `'Total'` (localized)) or its name. |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | `'horizontal'` puts the categories down the left axis. |
| `connectors` | `boolean` | `true` | Dashed lines from each bar's end level to the next bar. |
| `colors` | `{ increase?, decrease?, total?, connector? }` | see below | `ColorInput` per kind. Default: first and second palette colors, and the theme's neutral baseline color for totals and connectors. |
| `names` | `{ increase?, decrease?, total? }` | `Increase` / `Decrease` / `Total` (localized) | Legend and tooltip names of the kinds. |
| `labels` | `boolean \| 'auto' \| Omit<BarLabelOptions, 'format'>` | `'auto'` | Value labels. `'auto'` hides labels that collide. Changes carry their sign (`+1,200`, `−300`); totals show the running total. |
| `cornerRadius` | `number` | `0` | Data-end corner radius in CSS px. |
| `axes` | `{ x?: ChartAxisOptions; y?: ChartAxisOptions }` | | Axis options, as for bar charts. See [Data & Axes](../guide/data-and-axes). |
| `showBackdropGrid` | `boolean` | `true` | Value gridlines and baseline. |
| `grid` | `ChartGridStyle` | theme | Gridline style. See [Styling & Themes](../guide/styling). |
| `hover` | `ChartHoverStyle` | theme | Hovered bar highlight. |
| `format` | `ChartValueFormat` | locale number | Value text of labels, tooltip and accessibility (spec, `Intl` options or function). Without an axis format, the value axis uses it too. See [Number & Date Formats](../guide/number-format). |
| `valueLabel` | `string` | `'Change'` (localized) | Name of the changes in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `legend` | `ChartLegendOptions \| boolean` | shown with 2+ kinds | Lists the kinds present. Static: no toggle or emphasis. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

`BarLabelOptions` (without `format`) are `show`, `position` and `color`; see [Bar](./bar).

## Colors

Increase, decrease and total use palette slots and a neutral color, never red / green alone. The sign is always in the label and tooltip (`+180`, `−60`); totals show the value only.

```ts
sdk.renderWaterfallChart(data, {
  colors: { increase: '#3987e5', decrease: '#d95926', total: '#a3a29c' },
  names: { increase: 'Gain', decrease: 'Loss', total: 'Balance' },
});
```

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. Hover, horizontal orientation, axes, gridlines and label collision handling are those of the bar chart. Brush, zoom and pan are disabled; for cursor sync the waterfall behaves like a bar chart (x cursor). Data point ids are item indices.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'waterfall'
// ctx.index = bar index
// ctx.waterfall = { kind: 'increase' | 'decrease' | 'total', change, start, end }
// change: the change (a total item: the running total)
```

## Notes

- Running totals are computed in the engine (Rust) and drawn as floating bars of the 2D bar chart; connectors are engine lines.
- Accessibility: summary (final total, largest increase / decrease), a data table (item, Change, Running total), left / right arrows move between bars. See [Accessibility](../guide/accessibility).

## See also

- [Bar](./bar)
- [Funnel](./funnel)
- [Dashboard Sync](../guide/dashboard-sync)
- [Number & Date Formats](../guide/number-format)
