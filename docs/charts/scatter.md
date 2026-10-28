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
renderScatterChart(data: ScatterChartData, options?: ScatterChartOptions): { pointCount: number }
```

Data point id = point index.

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
| `axes` | `{ x?: ChartAxisOptions & ChartScaleOptions; y?: ... }` | — | Titles, formats, `scale: 'log'`, `reverse`, `tickCount`. See [Data & Axes](../guide/data-and-axes). |
| `legend` | `ChartLegendOptions \| boolean` | shown for 2+ series | Series legend with toggle and emphasis. |
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

## Updating data

Call `renderScatterChart` again with the new arrays. Use `setSeriesVisible` to hide a series id without re-uploading.

## Notes

- Scatter charts are 2D only: `z` and `viewMode: '3d'` are ignored. For 3D points, see [PointCloud3D · Surface3D](./scientific-3d).
- Error bars are not supported on scatter charts.

## See also

- [Line](./line)
- [Heatmap](./heatmap) — for very dense data as a grid
- [Interactions](../guide/interactions)
