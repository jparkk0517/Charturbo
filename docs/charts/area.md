# Area

An area chart fills each series down to a baseline. It supports three modes: overlapping areas, stacked areas, and 100% stacked areas. It shares the line chart engine, so decimation, axes, zoom and the time axis work the same way. Use it to show volume over time or the composition of a total.

[Live example](https://jparkk0517.github.io/Charturbo/line.html#02-area-stacked)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const day = 86_400_000;
const x = Array.from({ length: 180 }, (_, i) => Date.UTC(2026, 0, 1) + i * day);
sdk.renderAreaChart(
  [
    { name: 'Search', values: search, x },
    { name: 'Social', values: social, x },
  ],
  { mode: 'stacked', title: 'Sessions by channel', axes: { x: { type: 'time' } } }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderAreaChart(
  seriesList: LineSeriesDescriptor[],
  options?: AreaChartOptions
): { totalPoints: number; seriesCount: number }
```

## Data format

The series are the same `LineSeriesDescriptor` objects as in [Line](./line#data-format): `name`, `values`, optional `x`, `color`, `lineWidth`, `marker`, `dash`, `curve`, `nulls`.

- Stacked modes (`'stacked'`, `'percent'`) need series of equal length. When `x` is given, every series needs the same `x`. Otherwise the call throws.
- `NaN` leaves a gap in its own line and area and counts as 0 for the series above it.
- Area charts ignore `band` and `yAxis` (no right axis).

## Options

`AreaChartOptions` takes every [line chart option](./line#options) except `viewMode` (area charts are 2D only), plus:

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'overlap' \| 'stacked' \| 'percent'` | `'overlap'` | `'overlap'` fills each series to 0. `'stacked'` stacks the series. `'percent'` stacks and normalizes each x to 100%. |
| `fillOpacity` | `number` | `0.2` overlap, `0.8` stacked / percent | Fill alpha multiplier of the series color. |

## Modes

- `overlap`: every series is filled down to 0.
- `stacked`: each series sits on the series below it. The top edge gets a line.
- `percent`: at each x, the visible series sum to 100%. Negative values count as 0. The y labels show `%`.

The value axis always includes 0. Curves (`curve`) apply to the fill too; the bottom edge of a stacked area follows the curve of the series below, without gaps or overlap.

With `nulls: 'connect'`, a stacked area interpolates the missing value along x to support the series above, and skips its own marker.

## Legend and tooltips

- Clicking a legend entry hides the series and the engine re-stacks the rest. Hovering a legend entry fades the other fills and lines.
- Tooltips show the raw series values, not the stacked values. `'stacked'` adds the total (`ctx.total`); `'percent'` adds each share (`item.percent`). `ctx.areaMode` holds the mode.
- Hover markers sit on the stacked top edge.

See [Tooltips & Hover](../guide/tooltips).

## Updating data

```ts
// One chunk per series, in render order
const lengths = sdk.appendAreaData(
  [
    { values: nextSearch, x: nextDays },
    { values: nextSocial, x: nextDays },
  ],
  { maxPoints: 4_000 }
);
sdk.render();
```

| Method | Description |
|---|---|
| `appendAreaData(chunks, options?)` | Appends one chunk per series atomically. Returns the retained length of each series. |
| `setSeriesData(seriesIndex, values, x?)` | Replaces one series. In stacked modes the new data must keep the same length and `x` as the other series. |
| `appendSeriesData(seriesIndex, values, x?, options?)` | `'overlap'` only. Stacked modes throw; use `appendAreaData`. |

`appendAreaData` rules:

- The batch must contain every series, hidden series included. In stacked modes all chunks need the same length and `x`.
- Charts without `x` take values only. Charts with `x` need one x (number or `Date`) per value.
- The whole batch is validated first. An invalid batch changes nothing.
- `maxPoints` is an integer in 0..4294967295; 0 or omitted means unlimited. Ids are recomputed after trimming. Styles, legend visibility and zoom are kept.
- Stacked and percent modes recompute the cumulative values over all retained samples on every update (O(retained samples)). Tune the batch size and `maxPoints` for large streams.

See [Real-time Streaming](../guide/streaming).

## Interactions

Area charts take the same interactions as 2D line charts: wheel zoom, drag pan, touch gestures, brush (selection `kind` is `'line'`), annotations and the navigator:

```ts
sdk.renderAreaChart(series, { mode: 'stacked', navigator: true });
```

See [Interactions](../guide/interactions).

## See also

- [Line](./line)
- [Band · Range](./band)
- [Combo](./combo)
- [Real-time Streaming](../guide/streaming)
