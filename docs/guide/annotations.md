# Annotations

Annotations mark reference values on a 2D chart: horizontal and vertical lines, x and y bands, point markers, and free text. They are placed in data units, follow zoom and pan, and are clipped to the plot.

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { title: 'Latency' });
sdk.setAnnotations([
  { type: 'hline', y: 250, label: 'SLO 250', dash: true, color: [0.94, 0.35, 0.33, 1], z: 'above' },
  { type: 'xband', from: 6800, to: 7000, label: 'Incident', opacity: 0.16 },
  { type: 'point', x: 6900, y: 312, width: 6 }, // marker radius in CSS px
  { type: 'text', x: 100, y: 40, text: 'Deploy v2.3' },
]);
sdk.addAnnotation({ type: 'vline', x: new Date('2026-02-01'), labelPosition: 'start' });
sdk.render();
```

Call `setAnnotations` after the render call: rendering a new chart clears the annotations.

## Annotation types

| `type` | Fields | Draws |
|---|---|---|
| `'hline'` | `y` | Horizontal reference line |
| `'vline'` | `x` | Vertical reference line |
| `'yband'` | `from`, `to` | Horizontal band between two y values |
| `'xband'` | `from`, `to` | Vertical band between two x values |
| `'point'` | `x`, `y` | Point marker |
| `'text'` | `x`, `y`, `text` | Text centred at the point |

Band ends may be `Infinity` or `-Infinity`: the band then reaches the plot edge.

## Coordinates

Coordinates are in data units of the active chart:

- Line and area charts: x is the sample index, or the series `x` value when the chart has `x` (epoch ms or a `Date` on time axes). y is the value.
- Bar charts: x is the category index (fractional values are allowed). With `orientation: 'horizontal'`, x is the value and y the category index.
- Scatter charts: x and y values.
- Candlestick, combo, and waterfall charts map x and y like their axes.

Annotations work on the 2D views of these charts. Heatmaps, box plots, pies, radar, gauge, funnel, hierarchy, and 3D charts do not show them. Log and reversed axes are supported.

## Style options

| Option | Type | Default | Description |
|---|---|---|---|
| `color` | `ColorInput` | theme `baseline` (lines, points), theme `crosshair` (bands) | Line, marker, or band color |
| `width` | `number` | lines `1.5`, points `5`, bands `0` (no border) | Line / band border width in CSS px, or point radius |
| `dash` | `number \| boolean` | none | Dash length in CSS px; `true` = 6 px |
| `opacity` | `number` | bands `0.18`, others `1` | Alpha multiplier |
| `label` | `string` | — | DOM label (small pill) |
| `labelPosition` | `'start' \| 'end' \| 'center'` | `'end'` | Label anchor along the line or band: start = left / bottom, end = right / top |
| `z` | `'below' \| 'above'` | `'below'` | `'below'`: with the gridlines, under the series. `'above'`: over the series, under the hover layer |
| `yAxis` | `'left' \| 'right'` | `'left'` | y axis of `y` and y bands on a dual-axis line chart |

Text annotations draw their `text` as plain text; other kinds draw `label` as a pill with a border in the annotation color.

## Managing annotations

```ts
sdk.setAnnotations(list);            // replace all
const i = sdk.addAnnotation(item);   // append; returns its index
sdk.getAnnotations();                // copy of the current list
sdk.clearAnnotations();
sdk.render();
```

- An invalid color throws and leaves the current list unchanged.
- Default colors follow the theme: `setTheme` recolors annotations without an explicit `color`.

## Dual y axis

On a line chart with a right axis, set `yAxis: 'right'` to read `y`, `from`, and `to` on that axis. Without any right-axis series, the left axis is used.

```ts
sdk.setAnnotations([{ type: 'hline', y: 100, yAxis: 'right', label: 'Heavy rain' }]);
```

## Notes

- The engine maps data units to the screen, clips the marks, and draws them on the GPU (band triangles, line segments, markers). Labels are DOM elements placed at anchors the engine reports, and are re-positioned only when those anchors move.
- Label elements have the class `charturbo-sdk-annotation-label`.
- SVG export includes annotations.

## See also

- [Data & Axes](./data-and-axes): dual y axis, log scales
- [Styling & Themes](./styling)
- [Export: PNG · SVG · PDF](./export)
