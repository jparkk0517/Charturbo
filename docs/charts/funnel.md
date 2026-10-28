# Funnel

`renderFunnelChart` draws ordered stages whose width follows their value, with conversion rates between stages. Use it for step-by-step drop-off, such as visits to sign-ups to paid users.

[Live example](https://jparkk0517.github.io/Charturbo/business.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderFunnelChart(
  { labels: ['Visits', 'Sign-ups', 'Trials', 'Paid'], values: [12000, 5400, 2100, 760] },
  { title: 'Conversion funnel', conversion: 'both', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderFunnelChart(data: FunnelChartData, options?: FunnelChartOptions): { stageCount: number }
```

## Data format

```ts
interface FunnelChartData {
  labels: string[];                  // stage names, first stage first
  values: Float64Array | number[];   // finite and >= 0
}
```

Values must be finite and `>= 0`; anything else throws. Stage widths are relative to the largest value.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `orientation` | `'vertical' \| 'horizontal'` | `'vertical'` | Vertical: first stage on top, labels to the right. Horizontal: labels under the stages. |
| `shape` | `'trapezoid' \| 'bar'` | `'trapezoid'` | Trapezoids narrow to the next stage (the last is a rectangle); `'bar'` draws centered bars. |
| `color` | `ColorInput` | first palette color | One color for every stage (one series, one hue). |
| `colors` | `(ColorInput \| null \| undefined)[]` | | Per-stage colors (e.g. an ordinal ramp). Missing entries use `color`. |
| `minWidth` | `number` | `0.02` | Narrowest stage as a fraction of the widest. |
| `conversion` | `'first' \| 'previous' \| 'both' \| 'none'` | `'first'` | Conversion rate shown in the stage labels. The tooltip always shows both. |
| `labels` | `boolean` | `true` | Stage labels. |
| `format` | `ChartValueFormat` | locale number | Value text of labels, tooltip and accessibility (spec, `Intl` options or function). See [Number & Date Formats](../guide/number-format). |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. Room for the labels is added automatically. |

The funnel has no legend.

## Conversion rates

The engine computes two rates per stage:

- **of first**: the stage value as a percentage of the first stage.
- **of previous**: the stage value as a percentage of the previous stage.

A rate divided by zero is `NaN` (undefined). `conversion` picks which rate the labels show.

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. The hovered stage is brightened and the tooltip shows the value and both rates. Brush, zoom and pan are disabled. Data point ids are stage indices.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'funnel'
// ctx.index = stage index
// ctx.funnel = { stage, value, ofFirst, ofPrevious }  // NaN = undefined
```

## Notes

- Validation, stage widths, conversion rates, tessellation (2 px gaps, anti-aliased edges), hit testing and label anchors are computed in the engine (Rust).
- Accessibility: summary (first → last, overall conversion), a data table (stage, value, % of first, % of previous), left / right arrows move between stages. See [Accessibility](../guide/accessibility).

## See also

- [Waterfall](./waterfall)
- [Pie · Donut](./pie)
- [Sankey](./sankey)
- [Tooltips & Hover](../guide/tooltips)
