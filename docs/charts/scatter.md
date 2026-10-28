# Scatter · Bubble

A 2D scatter chart draws one GPU instance per point; the points are uploaded once, so 1,000,000+ points stay at 60 FPS. Per-point sizes turn it into a bubble chart. Use it to show the relation between two variables or the shape of clusters.

[Live example](https://jparkk0517.github.io/Charturbo/scatter.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderScatterChart(
  { x: xs, y: ys, clusters: seriesIds },
  {
    title: 'Segment distribution',
    seriesNames: ['A', 'B', 'C'],
    axes: { x: { title: 'x' }, y: { title: 'y' } },
    pointRadius: 3,
    opacity: 0.85,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true }); // wheel: x/y zoom, drag: pan
sdk.render();
```

```ts
renderScatterChart(
  data: ScatterChartData,
  options?: ScatterChartOptions
): { pointCount: number; trendlines: ScatterTrendlineFit[] }
```

Data point id = point index. `trendlines` holds the fits of the `trendline` option (empty without it); see [Trendlines](#trendlines).

## Data format

`ScatterChartData` holds parallel arrays, one entry per point:

| Field | Type | Description |
|---|---|---|
| `x` | `Float32Array \| number[]` | x coordinates. |
| `y` | `Float32Array \| number[]` | y coordinates. |
| `sizes` | `Float32Array \| number[]` | Optional radius per point in CSS px (bubble chart). Default: `pointRadius`. |
| `clusters` | `Uint16Array \| number[]` | Optional series id per point: legend entry, palette color, visibility toggle. |
| `colors` | `Float32Array \| number[]` | Optional RGBA per point (`4 * N` values, 0..1). Overrides the series color. |
| `z` | `Float32Array \| number[]` | Deprecated and ignored: the chart is 2D. |

Series ids index `seriesNames` and `seriesColors`.

### Bubble chart

```ts
sdk.renderScatterChart(
  { x: gdp, y: lifeExpectancy, sizes: radiusPx, clusters: region },
  {
    seriesNames: ['Africa', 'Americas', 'Asia', 'Europe'],
    opacity: 0.7,
    axes: { x: { title: 'GDP per capita', scale: 'log', format: '$,.0f' }, y: { title: 'Years' } },
  }
);
```

With `sizes`, each point gets a 1 px ring in the surface color by default (`pointRing`), so overlapping bubbles stay readable.

## Options

`ScatterChartOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Chart title. |
| `description` | `string` | — | Accessible name of the canvas. |
| `seriesNames` | `string[]` | `Series <id>` | Legend and tooltip name of each series id. |
| `seriesColors` | `ColorInput[]` | theme palette, wrapping | Color of each series id. |
| `pointRadius` | `number` | `3` | Point radius in CSS px when `sizes` is not given. |
| `opacity` | `number` | `0.85` | Fill alpha multiplier. Lower values reveal density. |
| `pointRing` | `number` | `1` with `sizes`, else `0` | Ring in the surface color around each point, CSS px. |
| `symbol` | `'circle' \| 'square' \| 'diamond' \| 'triangle'` | `'circle'` | Point symbol of every series. See [Symbols](#symbols). |
| `seriesSymbols` | `(ScatterSymbol \| undefined)[]` | — | Symbol per series id. Missing entries use `symbol`. |
| `ripple` | `ScatterRippleOptions \| boolean` | off | Rippling rings around the points of chosen series. `true` = every series with the defaults. See [Ripple effect](#ripple-effect). |
| `jitter` | `{ x?: number; y?: number; seed?: number }` | off | Spreads overlapping points by fixed random offsets in data units. See [Jitter](#jitter). |
| `trendline` | `ScatterTrendline \| ScatterTrendline[]` | — | Regression lines fitted per series. See [Trendlines](#trendlines). |
| `axes` | `{ x?: ChartAxisOptions & ChartScaleOptions; y?: ... }` | — | Titles, formats, `scale: 'log'`, `reverse`, `tickCount`. See [Data & Axes](../guide/data-and-axes). |
| `legend` | `ChartLegendOptions \| boolean` | shown for 2+ series or with trendlines | Series legend with toggle and emphasis. |
| `hover` | `ChartHoverStyle` | `hitRadius: 12` | Scatter always picks the nearest point. |
| `showBackdropGrid` | `boolean` | `true` | Horizontal gridlines and baseline. |
| `verticalGrid` | `boolean` | `true` | Vertical gridlines at the x ticks. |
| `grid` | `ChartGridStyle` | — | Grid style. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. |
| `animation` | `ChartAnimationInput` | SDK setting | Enter / update animation. |
| `width` | `number` | `168` | World width of the plot. |
| `height` | `number` | `94` | World height of the plot. |
| `viewMode` | `'2d' \| '3d'` | `'2d'` | Deprecated: only `'2d'` is supported. |

## Interactions

- Wheel zooms x and y together, drag pans, double-click resets. `zoomChartXY(factor, anchorNdcX?, anchorNdcY?)`, `setXRange`, `setYRange` and `resetChartZoom` do the same from code.
- Zoom and pan only update a transform uniform; the points are re-uploaded only when the data or the visible series change.
- Hover finds the nearest point with a uniform grid hash in the engine: within 12 px by default, or within a bubble's own radius. The tooltip shows series, x and y (`ctx.point`).
- Brush selection (`brush: 'xy'`) selects points with the same spatial hash; `selection.ids` holds the point ids of visible series.

```ts
sdk.enableNodeInteractions(canvas, { autoRender: true, brush: 'xy' });
sdk.on('select', (sel) => console.log(`${sel.count} points selected`));
```

See [Interactions](../guide/interactions) and [Tooltips & Hover](../guide/tooltips).

## Log axes

`scale: 'log'` uses log10 with ticks at powers of 10. Points with values ≤ 0 on a log axis are not drawn.

## Symbols

```ts
sdk.renderScatterChart(
  { x, y, clusters },
  {
    seriesNames: ['North-west', 'North-east', 'South-west', 'South-east'],
    pointRadius: 4,
    seriesSymbols: ['circle', 'square', 'diamond', 'triangle'],
  }
);
```

- `symbol` sets the shape of every series; `seriesSymbols` sets it per series id.
- The shapes are anti-aliased with the same signed distance functions as line markers and have about the same visual weight as the circle.
- The hover marker, SVG export and legend swatches use the same shape. The triangle swatch is a `▲` character, so it also appears in image exports.
- Hit testing treats every symbol as a circle.

[Live example](https://jparkk0517.github.io/Charturbo/scatter.html#03-symbols)

## Ripple effect

```ts
sdk.renderScatterChart(
  { x, y, clusters, sizes },
  {
    seriesNames: ['Reading', 'Alert'],
    seriesColors: ['#64748b', '#ef4444'],
    ripple: { series: [1], period: 4, scale: 3, count: 3, fill: false },
  }
);
sdk.setEffectTime(1.5); // freeze at 1.5 s into the cycle (screenshots, exports)
sdk.setEffectTime(null); // play again
```

Like ECharts `effectScatter`, rings grow behind each point of the chosen series, from the point radius to `scale` times it, and fade out over `period` seconds.

`ScatterRippleOptions`:

| Field | Type | Default | Description |
|---|---|---|---|
| `series` | `number[]` | every series | Series ids that ripple. |
| `period` | `number` | `4` | Seconds per ring cycle (at least 0.1). |
| `scale` | `number` | `2.5` | Outer ring radius / point radius, 1–10. |
| `count` | `number` | `3` | Rings at a time, 1–8. They share the cycle evenly. |
| `fill` | `boolean` | `false` | Translucent filled rings instead of 1.5 px strokes. |

- Only a time uniform changes per frame. The SDK runs a `requestAnimationFrame` loop only while ripples are shown; it stops when the chart changes, and browsers pause it in hidden tabs.
- With `prefers-reduced-motion: reduce`, a single still frame is drawn.
- `setEffectTime(seconds)` freezes the rings at that point of the cycle; `null` restarts them.
- The chart redraws every frame while rippling, so use it to highlight a few points, not whole data sets. SVG export has no rings.

[Live example](https://jparkk0517.github.io/Charturbo/scatter.html#04-ripple)

## Jitter

```ts
sdk.renderScatterChart(
  { x: serviceIndex, y: latencyMs, clusters: serviceIndex },
  { seriesNames: services, opacity: 0.6, jitter: { x: 0.28 } }
);
```

- Like ggplot2 `geom_jitter`, each point moves by a uniform offset in `[-x, x]` and `[-y, y]` data units (decades on log axes). `x` and `y` default to `0` (no offset on that axis).
- The offset depends only on the point index and `seed` (default `0`), so redraws give the same picture.
- The offset is applied when the points are laid out: the axis range, hover, brush and the spatial hash use the jittered positions. Tooltips, the data table and CSV show the original values.
- It is not the pixel-based, collision-avoiding (beeswarm) jitter of ECharts.

[Live example](https://jparkk0517.github.io/Charturbo/scatter.html#05-jitter)

## Trendlines

```ts
const { trendlines } = sdk.renderScatterChart(data, {
  seriesNames: ['Product A', 'Product B'],
  trendline: { type: 'linear' },                 // or an array of trendlines
});
trendlines[0].expression; // e.g. 'y = 1.234x + 5.6'
trendlines[0].r2;
sdk.getScatterTrendlines(); // same fits for the current chart; [] for other charts
```

Like ECharts ecStat `regression`, each trendline is fitted to each chosen series by least squares and drawn beneath the points.

`ScatterTrendline`:

| Field | Type | Default | Description |
|---|---|---|---|
| `type` | `'linear' \| 'exponential' \| 'logarithmic' \| 'polynomial'` | — | Regression model. Required. |
| `order` | `number` | `2` | Polynomial order, an integer 2–6 (Excel's polynomial trendline also ends at 6). |
| `series` | `number[]` | every series | Series ids to fit, one line each. |
| `color` | `ColorInput` | series color | Stroke color. |
| `width` | `number` | `2` | Stroke width in CSS px. |
| `dash` | `number[]` | solid | Dash pattern in CSS px, `[on, off]` or `[on, off, on, off]`. |

Models:

- `'linear'`: `y = a + bx`, ordinary least squares.
- `'logarithmic'`: `y = a + b·ln(x)`. Fits points with `x > 0` only.
- `'exponential'`: `y = a·e^(bx)`, the same y-weighted log least squares as ecStat. Fits points with `y > 0` only.
- `'polynomial'`: coefficients in ascending powers of x, solved on x normalized to [−1, 1].

R² is `1 − SS_res / SS_tot` against the original y for every model (ecStat does not report R²). Points outside a model's domain are left out; their count appears in the legend, the accessible description and `skipped`.

- The curve spans the visible x range (zoom and log axes included) and is subdivided by its curvature.
- The legend lists each line as `y = … (R² = …)`, so the legend is shown by default when there are trendlines. With several series, the series name comes first.
- The legend and accessible description text follow the chart locale.
- An invalid `type`, `order`, `series`, `width` or `dash` throws.

`ScatterTrendlineFit` (returned by `renderScatterChart` and `getScatterTrendlines()`):

| Field | Type | Description |
|---|---|---|
| `type` | `ScatterTrendlineType` | Model. |
| `order` | `number` | Polynomial order (polynomial fits only). |
| `series` | `number` | Series id fitted. |
| `coefficients` | `number[]` | `[a, b]` for linear, exponential and logarithmic; `[c0, …, ck]` for polynomial. Empty when the series has too few distinct points. |
| `r2` | `number` | R² (`NaN` without a fit or when every y is equal). |
| `points` | `number` | Points fitted. |
| `skipped` | `number` | Finite points outside the model's domain, left out of the fit. |
| `expression` | `string` | Equation text, e.g. `y = 1.234x + 5.6` (empty without a fit). |
| `color`, `width`, `dash` | `RgbaTuple`, `number`, `number[]` | Resolved stroke style. |

[Live example](https://jparkk0517.github.io/Charturbo/scatter.html#06-trendline)

## Updating data

Call `renderScatterChart` again with the new arrays. Use `setSeriesVisible` to hide a series id without re-uploading.

## Notes

- Scatter charts are 2D only: `z` and `viewMode: '3d'` are ignored. For 3D points, see [PointCloud3D · Surface3D](./scientific-3d).
- Error bars are not supported on scatter charts.

## See also

- [Line](./line)
- [Heatmap](./heatmap) — for very dense data as a grid
- [Interactions](../guide/interactions)
