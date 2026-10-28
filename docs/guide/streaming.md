# Real-time Streaming

Line and area charts can take new samples without rebuilding the chart: replace one series, append to it with a sliding window, or append to every area series at once. Styles, legend state, and the zoom window are kept.

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });
const t0 = Date.now();
sdk.renderLineChart(
  [
    { name: 'p50', values: [40], x: [t0] },
    { name: 'p99', values: [95], x: [t0] },
  ],
  {
    title: 'Request latency (ms)',
    axes: { x: { type: 'time' }, y: { min: 0, autoscale: 'visible' } },
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

setInterval(() => {
  const x = Date.now();
  sdk.appendSeriesData(0, [readP50()], [x], { maxPoints: 4_000 });
  sdk.appendSeriesData(1, [readP99()], [x], { maxPoints: 4_000 });
  sdk.render(); // one render after all appends of a tick
}, 50);
```

## Update methods

| Method | Returns | Description |
|---|---|---|
| `setSeriesData(series, values, x?)` | new sample count | Replaces the data of one line / area series |
| `appendSeriesData(series, values, x?, { maxPoints }?)` | new sample count | Appends to one line or overlap area series |
| `appendAreaData(chunks, { maxPoints }?)` | retained length per series | Appends one chunk per area series in one atomic call |

- `x` is required if and only if the chart was rendered with `x`. Pass numbers, epoch ms, or `Date`s.
- Appended `x` must not go back before the series' last x.
- `setSeriesData` keeps `values` by reference for tooltips and accessibility; do not mutate the array afterwards.
- After an update, call `render()` (or rely on `autoRender` for interaction-driven frames).

## Sliding window

`maxPoints` keeps only the newest N samples of each series. `0` or omitted means unlimited. `appendAreaData` requires an integer from 0 to 4294967295.

Data point ids are re-based on every update: index 0 is always the oldest kept sample. Do not keep ids across updates.

## Following the latest data

- A chart that is not zoomed keeps showing all data.
- If the zoom window touches the right edge, it follows the newest data with the same x width.
- Otherwise the absolute x window is kept.

`'rangechange'` fires when new data moves the visible range.

## y axis while streaming

The `axes.y.autoscale` option decides how the y domain reacts to new data (see [Data & Axes](./data-and-axes#y-domain)):

| `autoscale` | Behavior |
|---|---|
| `'all'` (default) | Extent of all retained data |
| `'visible'` | Extent of the visible window, updated with hysteresis (no jitter) |
| `'none'` | Derived once, then kept |

A manual y zoom (`setYRange`, Shift + wheel) pins the y window; streaming does not change it until `resetChartZoom()`.

## Area charts

```ts
// One chunk per series, in render order (hidden series included)
const lengths = sdk.appendAreaData(
  [
    { values: nextSearch, x: nextDays },
    { values: nextSocial, x: nextDays },
  ],
  { maxPoints: 4_000 }
);
sdk.render();
```

- `overlap` areas can also use `setSeriesData` / `appendSeriesData` per series.
- `stacked` and `percent` areas must append with `appendAreaData`: chunks need equal lengths and identical `x`. `setSeriesData` on them must keep the length and x of the other series.
- The whole batch is validated first; an invalid batch changes nothing.
- Tooltips and CSV read the latest raw values, not the stacked ones.

## Performance

- `appendSeriesData` is amortized O(appended) in the engine; the next frame re-decimates only the visible window.
- Stacked and percent areas recompute the cumulative tops of all retained samples on each update, O(retained samples). Tune batch size and `maxPoints` for large streams.
- The SDK keeps no copy of streamed data; tooltips and accessibility read it back from the engine. Accessibility summaries and the data table refresh at most 4 times per second.
- Batch several appends and call `render()` once per tick.

## Limits

- `appendSeriesData` throws on stacked / percent areas, standalone band charts, and error bar / impulse charts (render them again instead).
- Samples appended to a line series with a `band` carry no band: their tooltips show no range, and after streaming the data table's band columns are empty. `setSeriesData` with a new length removes the band.
- Other charts update by calling their render method again. 3D charts have their own streaming methods (`appendPointCloud3D`, `updateSurface3D`); see [PointCloud3D · Surface3D](../charts/scientific-3d).

## React and Vue

Call these methods on the SDK from `onReady(sdk)` or the component ref's `whenReady()`. Keep the `data` and `options` prop references stable while streaming: a new reference runs the full render method again.

## See also

- [Data & Axes](./data-and-axes)
- [Line](../charts/line) · [Area](../charts/area)
- [Performance](./performance)
- [React](./react) · [Vue](./vue)
