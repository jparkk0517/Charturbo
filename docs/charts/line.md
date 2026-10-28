# Line

A multi-series line chart drawn by the Rust engine on the GPU. The engine decimates each series to the screen resolution (M4, spikes preserved), so a chart with 1,000,000+ points stays at 60 FPS. Use it for continuous series: sensor data, metrics, prices, time series.

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const values = Float32Array.from({ length: 50_000 }, (_, i) => Math.sin(i * 0.05) * 40);
sdk.renderLineChart([{ name: 'Sensor', values }], {
  title: 'Sensor data',
  axes: { x: { title: 'Sample' }, y: { title: 'Value' } },
});
sdk.enableNodeInteractions(canvas, { autoRender: true }); // hover, wheel zoom, drag pan
sdk.render();
```

```ts
renderLineChart(
  seriesList: LineSeriesDescriptor[],
  options?: LineChartOptions
): { totalPoints: number; seriesCount: number }
```

Data point ids are the series offset plus the sample index.

## Data format

Each series is a `LineSeriesDescriptor`. `values` takes a `Float32Array` (preferred for large data) or `number[]`. `NaN`, `null` and `undefined` are missing samples (see `nulls`).

`x` is optional. Give it for every series or for none:

- Without `x`, samples are spaced evenly by index and labelled with `xLabelPrefix` (`T+120`).
- With `x`, each value has its own x (`Float64Array`, `number[]` or `Date[]`, same length as `values`). The values must be finite and ascending (equal values are allowed); otherwise the call throws. Spacing may be irregular, and series may have different lengths.
- `Date[]` selects a time axis by default. Epoch-millisecond numbers need `axes.x.type: 'time'`.

```ts
sdk.renderLineChart(
  [
    { name: 'CPU', values: cpu, x: timestamps },      // Date[] or epoch ms
    { name: 'GPU', values: gpu, x: otherTimestamps }, // different length and spacing is fine
  ],
  { axes: { x: { type: 'time' } }, locale: 'en-US' }
);
```

### Series fields

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | — | Legend and tooltip name. |
| `values` | `Float32Array \| number[]` | — | Sample values. `NaN` / `null` / `undefined` are missing. |
| `x` | `Float64Array \| number[] \| Date[]` | — | x of each sample (see above). |
| `color` | `ColorInput` | theme palette | `[r, g, b, a]` in 0..1 or a CSS color string. |
| `lineWidth` | `number` | chart `lineWidth` | Stroke width in CSS px for this series. |
| `yAxis` | `'left' \| 'right'` | `'left'` | `'right'` turns on a second y axis (`axes.y2`). 2D line charts only. |
| `marker` | `LineMarkerOptions \| boolean` | — | Point markers. `true` uses the defaults. See [Line styles](#line-styles). |
| `dash` | `number[]` | solid | Dash pattern in CSS px, e.g. `[6, 3]`. |
| `curve` | `'linear' \| 'step' \| 'stepBefore' \| 'stepAfter' \| 'monotone'` | `'linear'` | Interpolation between samples. |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | chart `nulls` | Missing-sample policy of this series. |
| `band` | `{ lower, upper, opacity? }` | — | Range band filled beneath the line. See [Range band](#range-band). |
| `pieces` | `LinePiece[]` | — | Piecewise colors by value range. See [Piecewise colors](#piecewise-colors). |
| `piecesBy` | `'y' \| 'x'` | `'y'` | Value the pieces test. |
| `pointSize` | `number` | — | Deprecated. Mapped to `marker: { size }`. |

## Options

`LineChartOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Chart title above the plot. |
| `description` | `string` | — | Accessible name of the canvas. Replaces the auto summary, which moves to the description. |
| `viewMode` | `'2d' \| '2.5d'` | `'2d'` | Flat 2D chart or a 2.5D perspective view. |
| `lineWidth` | `number` | `2` | Stroke width in CSS px for every series. Constant at any zoom. |
| `nulls` | `'gap' \| 'connect' \| 'zero'` | `'gap'` | Missing samples: break the line, join the neighbours, or draw them at 0. Series `nulls` wins. |
| `axes` | `{ x?: LineXAxisOptions; y?: LineYAxisOptions; y2?: LineYAxisOptions }` | — | Axis titles, formats, scales, y domain. `y2` is used only when a series has `yAxis: 'right'`. See [Data & Axes](../guide/data-and-axes). |
| `legend` | `ChartLegendOptions \| boolean` | shown for 2+ series | `{ show, toggle, emphasize, position, overflow }`. Click toggles a series, hover fades the others. See [Styling & Themes](../guide/styling). |
| `hover` | `ChartHoverStyle` | — | Crosshair and hover markers. See [Tooltips & Hover](../guide/tooltips). |
| `showBackdropGrid` | `boolean` | `true` | Horizontal gridlines and baseline. |
| `grid` | `ChartGridStyle` | — | Grid rows, color, stroke width. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. Omitted sides fit the title, legend and axes. |
| `xLabelPrefix` | `string` | `'T'` | Prefix of the x label when series have no `x` (`T+120`). |
| `locale` | `string` | SDK locale | Locale of number / time labels and tooltip values. |
| `timeZone` | `CharturboTimeZone` | SDK zone, else `'local'` | Time zone of a time x axis. |
| `navigator` | `boolean \| { height?: number }` | off | Range selector strip under the plot (2D only). Height in CSS px, default 48. |
| `animation` | `ChartAnimationInput` | SDK setting | Enter / update animation. See [Animation](../guide/animation). |
| `width` | `number` | `168` | World width of the plot (sets the aspect ratio). |
| `height` | `number` | `86` | World height of the plot. |

## Line styles

```ts
sdk.renderLineChart(
  [
    { name: 'Forecast', values: forecast, curve: 'monotone', dash: [6, 3],
      band: { lower: lo, upper: hi, opacity: 0.2 } },
    { name: 'Actual', values: actual, marker: { shape: 'diamond', size: 8, show: 'auto' } },
    { name: 'Rate', values: rate, curve: 'stepAfter', nulls: 'connect' },
  ],
  { nulls: 'gap' } // chart default; series `nulls` wins
);
```

`marker` (`LineMarkerOptions`):

| Field | Type | Default | Description |
|---|---|---|---|
| `shape` | `'circle' \| 'square' \| 'diamond' \| 'triangle' \| 'none'` | `'circle'` | `'none'` turns markers off. |
| `size` | `number` | `6` | Diameter in CSS px. |
| `fill` | `ColorInput` | series color | Marker fill. |
| `stroke` | `ColorInput` | chart surface color | Separating outline. |
| `strokeWidth` | `number` | `1` | Outline width in CSS px. |
| `show` | `'auto' \| 'always' \| 'never'` | `'auto'` | `'auto'` shows markers only while the visible points are at least 8 CSS px apart after decimation, so zooming in reveals them. |

- `dash`: `[on, off]` or `[on, off, on, off]` in CSS px. `[a]` means `[a, a]`; with 3 values the first 2 are used. The engine computes the pattern phase along the polyline, so the dash runs on across segments.
- `curve`: `'step'` steps at the midpoint, `'stepBefore'` / `'stepAfter'` step at the sample, `'monotone'` is a Fritsch–Carlson monotone cubic (no overshoot). Curves are applied after decimation.
- `nulls`: `'gap'` breaks the line. `'connect'` joins the neighbours. `'zero'` draws the sample at 0 (the value axis then includes 0).

## Range band

`band` fills a range (confidence interval, min–max envelope) beneath the line in the series color.

- `lower` / `upper` have one value per sample (`NaN` = missing). `opacity` multiplies the series color alpha (default `0.2`).
- The band LOD keeps the minimum lower and maximum upper edge per pixel column, so extremes survive at 1M points. The value axis includes the band.
- It shares the series legend entry. Tooltips show `value lower – upper` (`item.band`). The data table and CSV add `<name> lower` and `<name> upper` columns.
- Line charts only: area charts ignore `band`. For a band without a center line, use [Band · Range](./band).
- Samples added with `appendSeriesData` have no band. `setSeriesData` with a new length removes the band.

## Piecewise colors

```ts
sdk.renderLineChart(
  [
    {
      name: 'AQI',
      values: aqi,
      x,
      pieces: [
        { lte: 50, color: '#2e9e4f' },
        { gt: 50, lte: 100, color: '#e0b100' },
        { gt: 100, lte: 150, color: '#f07c1e' },
        { gt: 150, color: '#d93434' },
      ],
    },
  ],
  { axes: { x: { type: 'time' } } }
);
```

Like ECharts piecewise `visualMap`, `pieces` colors a series by value range. Each `LinePiece` is `{ gt?, gte?, lt?, lte?, color }`; a missing bound leaves that end open.

- The tested value is y by default. With `piecesBy: 'x'` it is the data x (epoch ms on a time axis), or the sample index when the series has no `x`.
- A value takes the color of the first piece that contains it. Values outside every piece use the series color.
- `gte` wins over `gt` and `lte` over `lt` when both are given, as in ECharts.
- The line is split where the drawn path (after decimation and `curve`) crosses a bound, by linear interpolation, so the color changes exactly at the bound value. A dash pattern runs on across the split.
- Area fills are clipped into bands between the bounds. With y pieces the bands are horizontal by height, like an ECharts gradient; stacked areas test the stacked height. See [Area](./area).
- Markers (unless `marker.fill` is set), the hover marker, the tooltip swatch and SVG export use the piece colors.
- Works with zoom, streaming, log and reversed axes, and the right y axis.
- Not colored by pieces: the range `band`, standalone [Band](./band) / [Error Bar · Impulse](./errorbar-impulse) charts, [Combo](./combo) charts, legend swatches and the data table.
- A non-array `pieces`, a piece without `color`, a `NaN` bound, or a `piecesBy` other than `'y'` / `'x'` throws.

[Live example](https://jparkk0517.github.io/Charturbo/line.html#12-pieces)

## Updating data

```ts
sdk.setSeriesData(0, values, x);                                // replace one series
sdk.appendSeriesData(0, chunk, chunkX, { maxPoints: 100_000 }); // append, drop the oldest
sdk.render();
```

| Method | Description |
|---|---|
| `setSeriesData(seriesIndex, values, x?)` | Replaces one series. Keeps styles, legend state and zoom. Returns the new sample count. `x` is required only if the chart was rendered with `x`. |
| `appendSeriesData(seriesIndex, values, x?, options?)` | Appends samples. New `x` must not be smaller than the series' last x. `maxPoints` keeps only the newest samples. Returns the new sample count. |
| `setLineWidth(widthPx, seriesIndex?)` | Changes the stroke width of every series or one series. |
| `setSeriesVisible(seriesIndex, visible)` | Same as a legend click. |
| `emphasizeSeries(seriesIndex \| null)` | Fades the other series; `null` clears it. |

Data point ids are re-based on every update. When the zoom window touches the right edge, it follows new data. See [Real-time Streaming](../guide/streaming).

## Y domain and axes

```ts
sdk.renderLineChart(series, { axes: { y: { min: 0, autoscale: 'visible', nice: true } } });
sdk.setYDomain({ autoscale: 'all' }); // merged into the current options
sdk.getYDomain();                     // [min, max]
```

- `autoscale`: `'all'` (default, full data extent), `'visible'` (visible series in the zoom window), `'none'` (derived once, then kept).
- `scale: 'log'`, `reverse` and `tickCount` work on `axes.x`, `axes.y` and `axes.y2`. A log x axis needs positive numeric `x`.
- A series with `yAxis: 'right'` adds a right axis with its own domain. Use `setY2Domain` / `getY2Domain` for it. Use dual axes with care: the choice of the two ranges can create false crossings.

Details are in [Data & Axes](../guide/data-and-axes).

## Interactions

After `enableNodeInteractions(canvas)`:

- Wheel zooms the x axis, drag pans, double-click resets. On touch: one-finger pan, pinch zoom, tap to pin a tooltip, long-press to scrub.
- `hover.mode: 'index'` (default) shows every series at the hovered x; `'nearest'` shows only the closest point.
- Programmatic: `zoomChartX(factor, anchorNdcX?)`, `setXRange(min, max)`, `resetChartZoom()`.
- Brush selection, navigator and annotations are supported in 2D.

See [Interactions](../guide/interactions), [Tooltips & Hover](../guide/tooltips) and [Annotations](../guide/annotations).

## Notes

- The 2.5D view always uses `'nearest'` hover. Dash phase and monotone subdivision are approximate there. The right y axis, navigator and brush are 2D only.
- Dashed series and markers are drawn in a layer above solid series, regardless of emphasis order.
- `renderLineChart` keeps `values` by reference for tooltips and accessibility: do not mutate it afterwards.

## See also

- [Area](./area)
- [Band · Range](./band)
- [Error Bar · Impulse](./errorbar-impulse)
- [Combo](./combo)
- [Real-time Streaming](../guide/streaming)
- [Performance](../guide/performance)
