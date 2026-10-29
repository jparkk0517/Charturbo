# ThemeRiver

`renderThemeRiverChart` draws a streamgraph (ECharts `themeRiver`): one stream per name, stacked around a moving baseline so the overall shape stays smooth. Use it to show how the mix of topics, categories or sources changes over time.

[Live example](https://jparkk0517.github.io/Charturbo/line.html#13-theme-river)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderThemeRiverChart(
  [
    ['2026-01-01', 12, 'Rust'],
    ['2026-01-02', 18, 'Rust'],
    ['2026-01-01', 7, 'WebGPU'],
    ['2026-01-02', 11, 'WebGPU'],
  ],
  { title: 'Mentions by topic' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderThemeRiverChart(
  data: readonly ThemeRiverDatum[],
  options?: ThemeRiverChartOptions
): { totalPoints: number; seriesCount: number }
```

## Data format

```ts
type ThemeRiverDatum = readonly [x: number | Date | string, value: number, name: string];
```

- Rows are grouped by `name`. Streams stack in order of first appearance (the first name is at the bottom).
- The x values of all streams are merged and sorted. A stream without a row at some x is 0 there. Rows with the same x and name are added together.
- `x` is a number, a `Date` or a date string (`Date.parse`). With `Date` or string x, the x axis is a time axis.
- `value` must be finite and `>= 0`, and `x` must be finite. Anything else throws.

`themeRiverSeries(data, options)` returns the grouped streams without rendering.

## Options

`ThemeRiverChartOptions` takes every [line chart option](./line#options) except `viewMode` and `nulls`, plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `offset` | `'wiggle' \| 'silhouette' \| 'zero'` | `'wiggle'` | Baseline. `'wiggle'` minimizes the weighted wiggle of the streams (d3 `stackOffsetWiggle`). `'silhouette'` centers the stack on zero. `'zero'` is a plain stack. |
| `order` | `'none' \| 'insideOut'` | `'none'` | Stack order. `'none'` keeps the input order. `'insideOut'` puts early-peaking streams in the middle and later ones outside (d3 `stackOrderInsideOut`). |
| `smooth` | `boolean` | `true` | Smooth (monotone) stream edges. `false` draws straight segments. |
| `colors` | `Record<string, ColorInput> \| ColorInput[]` | theme palette | Stream colors by name, or in stream order. |
| `fillOpacity` | `number` | `0.85` | Fill alpha multiplier of the stream colors. |
| `labels` | `boolean \| { show?: boolean; minHeight?: number }` | shown | Stream names at the left end of each stream. Streams thinner than `minHeight` CSS px (default 12) there get no label, and a label that would overlap a thicker stream's label is dropped. |

The y axis and gridlines are hidden by default (`axes.y.show: true` shows them). `axes.y.autoscale: 'visible'` acts as `'all'` so the whole river stays in view. The baseline values match d3 numerically.

## Legend and tooltips

- Clicking a legend entry hides the stream. The engine re-stacks the rest and recomputes the baseline.
- Hovering shows every stream at that x with the total (`ctx.total`); `ctx.chartType` is `'themeRiver'`. The stream under the pointer is the primary item and is emphasized; the others fade.

See [Tooltips & Hover](../guide/tooltips).

## Updating data

`appendAreaData` streams new samples: one chunk per stream, in stream order (first appearance), all with the same x.

```ts
sdk.appendAreaData(
  [{ values: [14], x: [nextDay] }, { values: [9], x: [nextDay] }],
  { maxPoints: 365 }
);
sdk.render();
```

The baseline is recomputed over the retained samples on every update. See [Area](./area#updating-data) for the rules.

## Accessibility and export

The chart has a summary, a data table and keyboard navigation like an area chart. CSV export lists the raw stream values; SVG and PNG export include the stream labels. React and Vue components take `type: 'themeRiver'` with `data` and `options`.

## See also

- [Area](./area)
- [Line](./line)
- [Real-time Streaming](../guide/streaming)
