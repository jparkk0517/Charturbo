# Data & Axes

How series data maps onto the x and y axes of 2D charts: sample indices or real x values, time axes and time zones, log / reversed scales, the y domain, a second y axis, and the range navigator strip. Most of this applies to line and area charts; bar, scatter, and candlestick charts take the same axis options where noted.

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });
sdk.renderLineChart(
  [
    { name: 'CPU', values: cpu, x: timestamps },      // Date[] or epoch ms (Float64Array / number[])
    { name: 'GPU', values: gpu, x: otherTimestamps }, // lengths and spacing may differ per series
  ],
  {
    axes: {
      x: { type: 'time', title: 'Time' },
      y: { title: 'Utilization (%)', min: 0, max: 100 },
    },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

## Series data

- `values` is a `Float32Array` or `number[]`. `NaN`, `null`, and `undefined` are missing samples; how they draw is set by `nulls` (see [Line](../charts/line)).
- Without `x`, samples are spaced evenly by index. Default x labels and tooltips show the index with the `xLabelPrefix` option as prefix (`T` gives `T+120`).
- With `x`, every sample gets a real x value: a `Float64Array`, `number[]`, or `Date[]` of the same length as `values`.
  - Give `x` for every series or for none.
  - Values must be finite and sorted ascending (equal neighbours are allowed); otherwise the render call throws. Irregular spacing is fine.
  - Series may have different lengths and spacing. The x range is shared by all series.
  - Epoch milliseconds are stored as f64 offsets from the minimum, so millisecond precision is kept.

## Time axis

`axes.x.type` selects how numeric `x` is read:

- `'numeric'`: nice 1 / 2 / 5 × 10ⁿ ticks. Default for numeric `x`.
- `'time'`: `x` is epoch milliseconds. Default when `x` is `Date[]`.

Time ticks land on calendar boundaries of the chart's time zone: 1, 2, 5, 10, 15, 30 seconds or minutes; 1, 3, 6, 12 hours; 1, 2 days; 1 week (Monday); 1, 3, 6 months; 1, 2, 5, 10, … years. The default label format follows the boundary a tick lands on (`HH:mm`, `MMM d`, `MMM`, `yyyy`). To change the labels, pass `axes.x.format(value, granularity)`; see [Number & Date Formats](./number-format#date-and-time-labels).

Candlestick and OHLC charts read `t` the same way: `axes.x.type` defaults to `'time'` when `t` is given.

## Time zones

```ts
const sdk = await Charturbo.create(canvas, { timeZone: 'Asia/Seoul' }); // 'UTC' | 'local' | IANA name
sdk.setTimeZone('America/New_York'); // redraws ticks and labels of the active chart
sdk.getTimeZone();                   // 'America/New_York'

// A chart's own option wins over the SDK value
sdk.renderLineChart(series, { axes: { x: { type: 'time' } }, timeZone: 'UTC' });
sdk.renderCandlestickChart(ohlc, { timeZone: 'Europe/Berlin' });
```

- The default is `'local'`, the viewer's time zone.
- Every time text uses the same zone: x tick labels, tooltips and `getNodeDetails`, accessibility summaries, the data table, and `exportChartCSV()`.
- Ticks land on local boundaries: midnight, month start, year start, the hours of 23 h / 25 h DST days, and whole hours in zones with offsets such as +05:30 or +05:45.
- An unknown zone name throws a `RangeError` (`create`, `setTimeZone`).
- Applies to `'time'` x axes of line, area, and candlestick charts. Numeric, log, and index axes, and heatmap extents, are not affected.

::: tip
For output that must not depend on the machine, such as server rendering or snapshot tests, set `'UTC'` or an IANA name explicitly.
:::

## Axis options

`axes.x`, `axes.y`, and (line charts) `axes.y2` accept:

| Option | Type | Default | Description |
|---|---|---|---|
| `show` | `boolean` | `true` | Show tick labels |
| `title` | `string` | — | Axis title beside the tick labels |
| `format` | spec string, `Intl.NumberFormatOptions`, or `(value, granularity?) => string` | locale number / time label | Tick label text; see [Number & Date Formats](./number-format) |
| `labelRotate` | `number` | `0` | x axes only: tick label rotation in degrees, positive = anticlockwise, -90..90 (ECharts `axisLabel.rotate`). See [Bar](../charts/bar#label-rotation) |
| `type` | `'numeric' \| 'time'` | `'time'` for `Date[]` x, else `'numeric'` | Line / candlestick x axis only |
| `scale` | `'linear' \| 'log'` | `'linear'` | Value scale (line, area, scatter) |
| `reverse` | `boolean` | `false` | y grows downward, x grows leftward |
| `tickCount` | `number` | y: grid rows; x: about one per 90 px | Target tick count |
| `min` / `max` | `number` | from the data | Fixed end of the line y domain |
| `autoscale` | `'all' \| 'visible' \| 'none'` | `'all'` | How the line y domain follows the data |
| `nice` | `boolean` | `true` | Expand data-derived ends to whole tick steps |

The last three rows and `min` / `max` are line / area y axis options (`axes.y`, `axes.y2`). Ticks use 1 / 2 / 5 × 10ⁿ steps, and gridlines are drawn at the same values.

## Log, reverse, and tick count

```ts
sdk.renderLineChart(series, { axes: { x: { scale: 'log' }, y: { reverse: true, tickCount: 4 } } }); // needs positive numeric x
sdk.renderScatterChart(data, { axes: { x: { scale: 'log' }, y: { scale: 'log' } } });

sdk.setAxisScale('y', { scale: 'log' }); // 'x' | 'y' | 'y2'; merged into the current options
sdk.getAxisScale('y');                   // { scale, reverse, tickCount } | null
```

- `scale: 'log'` uses log10 with decade ticks (1 / 2 / 5 minor ticks when the range is narrow). Values at or below 0 are not drawn: lines break, scatter points are skipped.
- A log x on a line chart applies only when every series has positive numeric `x`. Index or time x, or any x ≤ 0, stays linear (`reverse` and `tickCount` still apply).
- Zoom, decimation, hover, annotations, and the range APIs work on every scale. Changing an axis scale resets that axis's zoom.
- `setAxisScale` works on line, area, and scatter charts.

## y domain

The line / area y domain is derived by the engine from `axes.y`:

```ts
sdk.renderLineChart(series, { axes: { y: { min: 0, autoscale: 'visible', nice: true } } });
sdk.setYDomain({ autoscale: 'all' }); // merged into the current options; pass min: undefined to free an end
sdk.getYDomain();                     // [min, max] | null
```

- `'all'` (default): extent of all data, re-derived when the data changes.
- `'visible'`: extent of the visible series inside the x zoom window. It is re-derived on zoom, pan, and data updates with hysteresis: only when the data leaves the domain or spans less than 60% of it, so the axis does not jitter.
- `'none'`: derived once, then kept while the data changes.
- `min` / `max` fix one end. `nice` only expands the ends that come from the data.
- With `autoscale: 'all'`, hiding a series keeps the y range.
- A manual y zoom (`setYRange`, Shift + wheel) pins the domain until reset; see [Interactions](./interactions#y-zoom-and-box-zoom).

Candlestick charts use `yFit: 'visible' | 'all'` instead (default `'visible'`). Combo charts have a fixed y domain set with `axes.y` / `axes.y2` `min`, `max`, and `nice` (see [Combo](../charts/combo)).

## Dual y axis

A second y axis is opt-in: it turns on when any line series has `yAxis: 'right'`.

```ts
sdk.renderLineChart(
  [
    { name: 'Temperature', values: temp },
    { name: 'Rainfall', values: rain, yAxis: 'right' },
  ],
  { axes: { y: { title: '°C' }, y2: { title: 'mm', scale: 'log', min: 1, format: (v) => `${v} mm` } } }
);
sdk.setY2Domain({ autoscale: 'visible' }); // same options as setYDomain, right axis
sdk.getY2Domain();                         // [min, max] | null
sdk.setAnnotations([{ type: 'hline', y: 100, yAxis: 'right', label: 'Heavy rain' }]);
```

- 2D line charts only. Area charts and the 2.5D view show no right axis labels.
- The right axis has its own domain, autoscale, scale, and ticks. Gridlines follow the left axis. The SDK reserves the right margin for labels and title.
- Annotations use the right axis with `yAxis: 'right'`.

::: warning
Two y axes make crossings and slopes depend on how each range is chosen, which invites misreading. For two measures with different units, consider first: small multiples that share x (sync their zoom with [Dashboard Sync](./dashboard-sync)), a single indexed axis (first value = 100, or % change), or a scatter plot of one value against the other. Use a dual axis only when x alignment is the point, and label each axis with its title and series color.
:::

## Range navigator

A strip under the plot shows the full x range with a draggable zoom window.

```ts
sdk.renderLineChart(series, { navigator: true }); // or { navigator: { height: 64 } } (CSS px, default 48)
sdk.renderAreaChart(series, { mode: 'stacked', navigator: true });
sdk.enableNodeInteractions(canvas);
sdk.on('rangechange', ({ xMin, xMax }) => { /* window drag, handles and wheel emit it too */ });
sdk.getNavigatorRect(); // [left, top, width, height] in CSS px, or null
```

- 2D line and area charts only.
- Drag inside the window moves it; its edges (±8 px) resize it; a click outside the window centres it there and keeps dragging; the wheel over the strip zooms around the pointer. Mouse, touch, and pen all operate the window when pressed on the strip.
- The strip draws the visible series over the full x range, decimated to the strip width, so it stays cheap at 1M+ points. It is rebuilt only when data, visibility, or the view changes.

[Live example: navigator](https://jparkk0517.github.io/Charturbo/candlestick.html)

## Bar and scatter axes

- Bar charts take `axes.x` / `axes.y` with `show`, `title`, and `format`, plus `labelRotate` on `axes.x`. With `orientation: 'horizontal'`, `axes.x` is the value axis and `axes.y` the category axis. See [Bar](../charts/bar).
- Scatter charts take `axes.x` / `axes.y` with the scale options (`scale`, `reverse`, `tickCount`) too. Both axes zoom and pan. See [Scatter · Bubble](../charts/scatter).

## See also

- [Interactions](./interactions): zoom, pan, ranges, and events
- [Number & Date Formats](./number-format)
- [Real-time Streaming](./streaming)
- [Line](../charts/line) · [Area](../charts/area) · [Combo](../charts/combo)
