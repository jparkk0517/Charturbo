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
renderPieChart(data: PieChartData | PieRingsData, options?: PieChartOptions): { sliceCount: number }
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
- For several concentric rings, pass `{ rings }` instead; see [Nested rings](#nested-rings).

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `donut` | `number` | `0` | Hole radius as a fraction of the outer radius. `0` = pie, up to `0.95`. |
| `sort` | `'none' \| 'desc'` | `'none'` | `'desc'` puts the largest slice first. "Other" always stays last. |
| `maxSlices` | `number \| false` | `8` | Displayed slices including "Other"; smaller slices fold into "Other". `0` / `false` disables folding. |
| `startAngle` | `number` | `0` | Degrees clockwise from 12 o'clock where the first slice starts. |
| `endAngle` | `number` | full turn | Degrees clockwise from 12 o'clock where the last slice ends. See [Corners, gaps and partial circles](#corners-gaps-and-partial-circles). |
| `direction` | `'clockwise' \| 'counterclockwise'` | `'clockwise'` | Slice direction. |
| `padAngle` | `number` | `0` | Angular gap between slices in degrees (at most 45), on top of the 2 px gap. |
| `cornerRadius` | `number` | `0` | Rounds every slice corner by this many CSS px. |
| `rose` | `'radius' \| 'area'` | off | Nightingale rose: the slice radius encodes the value. See [Nightingale rose](#nightingale-rose). |
| `colors` | `(ColorInput \| null \| undefined)[]` | theme palette | Color per input value. Missing entries use the theme palette in display order. With `rings`, the values of every ring in order. |
| `otherColor` | `ColorInput` | theme neutral | Color of the "Other" slice. |
| `otherLabel` | `string` | `'Other'` (localized) | Name of the folded slice. |
| `labels` | `'outside' \| 'percent' \| 'none'` | `'outside'` | `'outside'`: name + percent with leader lines. `'percent'`: percent inside the slice. |
| `labelMinAngle` | `number` | `6` | Slices narrower than this many degrees get no label (legend and tooltip only). |
| `centerLabel` | `boolean \| string` | `true` for donuts (off for roses and multi-ring pies) | Donut center text: the visible total (the hovered slice while hovering). `true` captions it `Total`, a string replaces the caption, `false` hides it. |
| `format` | `(value: number) => string` | locale number | Value text of labels, tooltip and center. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `legend` | `ChartLegendOptions \| boolean` | shown with 2+ slices | `{ show, toggle, emphasize, position, overflow }`. Click hides a slice, hover emphasizes it. |
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

## Nested rings

```ts
sdk.renderPieChart(
  {
    rings: [
      { name: 'Channel', labels: ['Direct', 'Marketing', 'Search engine'], values: [1548, 775, 679], radius: [0, 0.42] },
      {
        name: 'Source',
        labels: ['Baidu', 'Direct', 'Email', 'Google', 'Union ads', 'Bing', 'Video ads', 'Others'],
        values: [1048, 335, 310, 251, 234, 147, 135, 102],
        radius: [0.56, 0.86],
        maxSlices: false,
      },
    ],
  },
  { title: 'Access sources' }
);
```

Like ECharts nested pies, `{ rings: PieRingData[] }` draws several rings, from the inside out in the given order.

`PieRingData`:

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | `Ring 1`, `Ring 2`, … (localized) | Ring name in the tooltip, data table and keyboard announcements. |
| `labels` | `string[]` | — | One name per value. |
| `values` | `Float64Array \| number[]` | — | Finite values `>= 0`. |
| `radius` | `[number, number]` | equal share | `[inner, outer]` as fractions of the full radius, `0 <= inner < outer <= 1`. |
| `label` | `'outside' \| 'percent' \| 'none'` | `'percent'` for inner rings, chart `labels` for the outermost | Label mode of the ring. |
| `maxSlices` | `number \| false` | chart `maxSlices` | "Other" folding of the ring. |
| `sort` | `'none' \| 'desc'` | chart `sort` | Slice order of the ring. |

- Percentages (against the ring total), angles, "Other" folding and labels are computed per ring.
- Without `radius`, ring `k` of `n` takes the `k`-th equal share of the band from `donut` to the rim, with a small gap between neighbors.
- Slices with the same name share a color, a legend entry and the legend emphasis across rings. A legend click hides the name in every ring.
- Hit testing finds the ring by radius, then the slice by angle within that ring.
- Tooltips, the data table and keyboard announcements name slices as `ring · slice`. The donut center label is off unless `centerLabel` is set.
- `colors` indexes the values of every ring, concatenated in ring order.

[Live example](https://jparkk0517.github.io/Charturbo/pie.html#06-nested)

## Corners, gaps and partial circles

```ts
sdk.renderPieChart(data, { donut: 0.55, padAngle: 5, cornerRadius: 10 });       // rounded, spaced slices
sdk.renderPieChart(data, { donut: 0.55, startAngle: -90, endAngle: 90 });        // top half donut
```

- `cornerRadius` (CSS px): each corner circle touches the inset edge and the arc at once, the same construction as d3-shape `cornerRadius`. The radius shrinks for thin slices and thin rings so corners never cross. A pie (no hole) keeps a sharp center. Hit testing uses the shape before rounding.
- `padAngle` (degrees, at most 45): adds an angular gap on top of the 2 px gap. Angles, percentages and hit testing use the layout without gaps. Slices narrower than the gap are not drawn, but stay in the legend, tooltip and data table. A single visible slice is drawn as a full circle without a gap.
- `endAngle` uses the same compass angles as `startAngle`: `startAngle: -90, endAngle: 90` is a top half donut. The slices share this sweep along `direction`. An end at or before the start means a full turn; more than a full turn is cut to one turn (the gauge uses the same rule). The view is framed to the bounding box of the sweep, so a half donut fills the card.

Live examples: [half donut](https://jparkk0517.github.io/Charturbo/pie.html#04-half-donut), [rounded corners](https://jparkk0517.github.io/Charturbo/pie.html#05-rounded).

## Nightingale rose

```ts
sdk.renderPieChart(
  { labels: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'], values: [40, 38, 32, 30, 28, 26, 22, 18] },
  { rose: 'area', donut: 0.2, maxSlices: false }
);
```

With `rose`, the slice radius encodes the value so that each slice's area (ring area for donuts) is proportional to the value, as in Nightingale's polar area diagram: `r² = r_in² + v / max · (R² − r_in²)`.

- `'radius'`: angles still follow the shares. `'area'`: the visible slices share equal angles.
- Percentages, tooltips and the data table still show the share of the total.
- Hiding slices from the legend recomputes the radii from the largest remaining value.
- Hover, keyboard focus and outside leader lines follow each slice's radius. The donut center label shows only when `centerLabel` is set.
- ECharts maps min → inner and max → outer radius linearly; Charturbo does not, because that makes the smallest slice vanish and exaggerates areas.

[Live example](https://jparkk0517.github.io/Charturbo/pie.html#03-rose)

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
