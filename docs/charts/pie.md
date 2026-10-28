# Pie · Donut

`renderPieChart` draws a pie or, with `donut`, a donut chart. Use it to show the parts of one whole with a handful of categories; for many categories or comparisons across groups, a bar chart reads better.

[Live example](https://jparkk0517.github.io/Charturbo/pie.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPieChart(
  { labels: ['Search', 'Direct', 'Social', 'Email', 'Ads'], values: [420, 260, 180, 90, 40] },
  { title: 'Traffic sources', sort: 'desc', donut: 0.6, centerLabel: 'Visits' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true }); // hover, tooltip, legend
sdk.render();
```

Signature:

```ts
renderPieChart(data: PieChartData, options?: PieChartOptions): { sliceCount: number }
```

`sliceCount` is the number of displayed slices, including the folded "Other" slice.

## Data format

```ts
interface PieChartData {
  labels: string[];                  // one name per value
  values: Float64Array | number[];   // finite and >= 0
}
```

- Every value must be finite and `>= 0`; anything else throws.
- Percentages are computed against the total of the visible slices.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `donut` | `number` | `0` | Hole radius as a fraction of the outer radius. `0` = pie, up to `0.95`. |
| `sort` | `'none' \| 'desc'` | `'none'` | `'desc'` puts the largest slice first. "Other" always stays last. |
| `maxSlices` | `number \| false` | `8` | Displayed slices including "Other"; smaller slices fold into "Other". `0` / `false` disables folding. |
| `startAngle` | `number` | `0` | Degrees clockwise from 12 o'clock where the first slice starts. |
| `direction` | `'clockwise' \| 'counterclockwise'` | `'clockwise'` | Slice direction. |
| `colors` | `(ColorInput \| null \| undefined)[]` | theme palette | Color per input value. Missing entries use the theme palette in display order. |
| `otherColor` | `ColorInput` | theme neutral | Color of the "Other" slice. |
| `otherLabel` | `string` | `'Other'` (localized) | Name of the folded slice. |
| `labels` | `'outside' \| 'percent' \| 'none'` | `'outside'` | `'outside'`: name + percent with leader lines. `'percent'`: percent inside the slice. |
| `labelMinAngle` | `number` | `6` | Slices narrower than this many degrees get no label (legend and tooltip only). |
| `centerLabel` | `boolean \| string` | `true` for donuts | Donut center text: the visible total (the hovered slice while hovering). `true` captions it `Total`, a string replaces the caption, `false` hides it. |
| `format` | `(value: number) => string` | locale number | Value text of labels, tooltip and center. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `legend` | `ChartLegendOptions \| boolean` | shown with 2+ slices | `{ show, toggle, emphasize }`. Click hides a slice, hover emphasizes it. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px (`top`, `right`, `bottom`, `left`). |
| `animation` | `ChartAnimationInput` | SDK setting | Enter / update animation of this chart. See [Animation](../guide/animation). |

::: tip
Unlike the radar, gauge, funnel and waterfall charts, the pie `format` option takes a function only. To use a format spec such as `'$,.0f'`, build a function with `createFormatter`; see [Number & Date Formats](../guide/number-format).

```ts
import { createFormatter } from 'charturbo';
sdk.renderPieChart(data, { format: createFormatter('$,.0f') });
```
:::

## "Other" folding

When there are more values than `maxSlices`, the smallest ones are summed into one slice named `otherLabel`, placed last. The tooltip of that slice lists the folded names in `ctx.slice.members`.

```ts
sdk.renderPieChart(
  {
    labels: ['Search', 'Direct', 'Social', 'Email', 'Ads', 'Referral', 'Podcasts', 'Events', 'Print', 'Radio'],
    values: [420, 260, 180, 90, 40, 32, 18, 12, 6, 4],
  },
  { title: 'Traffic sources', sort: 'desc', maxSlices: 7, otherLabel: 'Other' }
);
```

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on.

- Hover moves the slice under the pointer 6 px outward and shows a tooltip. In a donut the center label switches to the hovered slice.
- Legend click hides a slice; the remaining slices re-lay out and percentages follow the visible total. Legend hover emphasizes a slice.
- Brush, zoom and cursor sync are disabled for pies.
- Data point ids are displayed slice indices.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'pie'
// ctx.index = displayed slice index
// ctx.slice = { label, value, percent, members? }  // members: names folded into "Other"
```

## Notes

- Validation, folding, sorting, angles, percentages, tessellation, hit testing and label placement run in the engine (Rust). The DOM only places label text.
- Slices are separated by 2 px gaps and drawn with an anti-aliased edge, so slice areas stay exact.
- Accessibility: summary of the top slices, a data table (slice, value, percent), and left / right arrow keys move between slices. See [Accessibility](../guide/accessibility).

## See also

- [Funnel](./funnel)
- [Treemap · Sunburst](./treemap-sunburst)
- [Tooltips & Hover](../guide/tooltips)
- [Styling & Themes](../guide/styling)
- [Animation](../guide/animation)
