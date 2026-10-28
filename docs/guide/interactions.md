# Interactions

`enableNodeInteractions(canvas, options)` binds mouse, wheel, touch, pen, and keyboard input to a chart: tooltips, zoom and pan, box zoom with undo, brush selection, and SDK events. This page covers 2D chart navigation and selection; tooltips have their own page.

[Live example](https://jparkk0517.github.io/Charturbo/scatter.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { title: 'Throughput' });
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();

// later: remove listeners and the tooltip (dispose() does this too)
detach();
```

`autoRender` (default `false`) calls `sdk.render()` after hover, click, and navigation changes. Without it, call `render()` yourself. The React and Vue components default it to `true`.

## Mouse controls

| Input | Line / area / candlestick | Scatter |
|---|---|---|
| Wheel | Zoom x around the pointer | Zoom x and y |
| Shift + wheel | Zoom y (pins the line y domain) | Zoom y |
| Drag | Pan x | Pan x and y |
| Ctrl / ⌘ + drag | Box zoom (x + y) | Box zoom |
| Double-click | Reset zoom | Reset zoom |
| Ctrl / ⌘ + Z | Undo zoom (canvas focused) | Undo zoom |
| Ctrl / ⌘ + Shift + Z, Ctrl + Y | Redo zoom | Redo zoom |

Heatmaps zoom and pan both axes. Bar charts have no wheel / drag navigation. Combo charts support x wheel zoom, pan, and zoom history only (no box zoom or y zoom). Graph and 3D views use their own camera controls (see [3D Network Graph](../charts/graph-3d)).

## Interaction options

| Option | Type | Default | Description |
|---|---|---|---|
| `autoRender` | `boolean` | `false` | Render automatically on hover / click / navigation changes |
| `chartNavigation` | `boolean` | `true` | Wheel zoom, drag pan, and double-click reset on 2D charts |
| `zoom` | `'x' \| 'y' \| 'xy'` | `'x'` | Axes the wheel zooms; Shift + wheel always zooms y |
| `zoomMode` | `'pan' \| 'box'` | `'pan'` | `'pan'`: drag pans, Ctrl / ⌘ + drag box-zooms. `'box'`: drag box-zooms, Alt + drag pans |
| `brush` | `'x' \| 'xy' \| false` | unchanged (off) | Brush selection on drag; see [Brush selection](#brush-selection) |
| `brushStyle` | `BrushStyleOptions` | — | Brush rectangle look |
| `touch` | `false \| TouchInteractionOptions` | all on | Touch and pen gestures |
| `cameraControls` | `false \| CameraControlOptions` | all on | Camera controls of graph / 3D views |
| `builtInTooltip`, `tooltip`, `formatChartTooltip`, … | | | See [Tooltips & Hover](./tooltips) |
| `onNodeHover` | `(details, pointer) => void` | — | Hovered point / node changed |
| `onNodeClick` | `(details, event) => void` | — | Click; `null` on empty space |

## Programmatic zoom and pan

```ts
sdk.setXRange(Date.parse('2026-01-01'), Date.parse('2026-02-01')); // data units; Dates allowed on time axes
sdk.getXRange();          // [min, max] | null
sdk.setYRange(55, 95);    // scatter: zoom y; line / area: pin the y domain
sdk.getYRange();          // [min, max] | null
sdk.zoomChartX(0.5);      // factor < 1 zooms in, around NDC anchor x (default 0)
sdk.zoomChartXY(0.5, 0, 0); // scatter: both axes
sdk.panChartX(0.1);       // NDC delta
sdk.resetChartZoom();
sdk.render();
```

- Ranges are in data units: line charts use the series `x` (epoch ms on time axes) or the sample index; scatter charts use x / y values.
- `setXRange` and `setYRange` clamp to the data and the zoom limit like the wheel does, and return `true` when the view moved.
- These calls do not record zoom history. Call `pushZoomHistory()` first to make one undoable.

## Y zoom and box zoom

```ts
sdk.enableNodeInteractions(canvas, {
  zoom: 'x',       // wheel axes: 'x' (default) | 'y' | 'xy'
  zoomMode: 'pan', // 'pan' (default) | 'box'
});
sdk.zoomChartY(0.5, 0);                 // y zoom around NDC anchor y
sdk.zoomChartBox(-0.4, 0.5, 0.3, -0.3); // x + y zoom to an NDC rectangle
```

- On line and area charts a manual y zoom **pins** the y window in data units: autoscale, data updates, and streaming no longer move y. `resetChartZoom()` (double-click) releases the pin and returns to autoscale. On a dual-axis chart both y axes zoom over the same screen band. Scatter charts zoom their y window only.
- Box zoom draws a dashed rectangle while dragging and zooms x and y to it on release, clamped to the plot. A box smaller than 4 px is a click. Escape cancels a box in progress. A box zoom clears an existing brush selection.
- Box zoom works on line, area, scatter, and candlestick charts.

## Zoom history

```ts
sdk.undoZoom();      // true when the view moved
sdk.redoZoom();
sdk.zoomHistory;     // { undo, redo, max: 50 }
sdk.pushZoomHistory();
sdk.clearZoomHistory();
```

- Each mouse gesture records one step before it starts: a wheel burst (events within 400 ms), a drag pan, or a box zoom. Touch gestures do not record steps. A new gesture clears the redo steps.
- At most 50 steps are kept. Double-click reset clears the history, and a new chart starts with an empty history.
- Programmatic calls (`setXRange` and others) are not recorded.

## Brush selection

```ts
sdk.enableNodeInteractions(canvas, {
  brush: 'x', // 'x' = x interval (time range), 'xy' = rectangle, false = off
  brushStyle: { color: '#3b82f6', fillOpacity: 0.15, borderWidth: 1 },
});
sdk.on('select', (sel) => {
  if (!sel.xRange) return clearDetail(); // cleared (Escape, click, clearChartSelection)
  if (sel.kind === 'line') sel.ranges.forEach(({ series, start, end }) => { /* [start, end) samples */ });
  else console.log(sel.ids, sel.count);  // scatter: point ids, bar: category indices, candlestick: candle indices
});

sdk.setChartBrush('xy');           // switch at runtime; getChartBrush() reads it
sdk.selectChartRange([new Date('2026-02-01'), new Date('2026-03-01')]); // emits 'select'
sdk.selectChartRange([1, 2], [-3, 4]);                                  // with a y range
sdk.getSelection();                // committed selection or null
sdk.clearChartSelection();         // emits an empty 'select' if something was selected
```

- While a brush is on: drag draws the brush (moves under 5 px count as a click), release commits it and emits `'select'`, **Alt + drag** pans, wheel zoom and double-click reset keep working. A click, Escape (canvas focused), or `clearChartSelection()` clears it.
- Bars always brush an x interval. Area charts report `kind: 'line'`.
- Brushes work on 2D charts with a data frame. Heatmaps, box plots, pies, combo, business, and hierarchy charts have no brush; their `'select'` payloads are empty. Horizontal bars, 3D bars, and the 2.5D line view have no brush either.
- After data or legend changes, `getSelection()` returns the re-queried result. Rendering a new chart emits an empty `'select'` for a remaining selection.

`CharturboSelection` (the `'select'` payload):

| Field | Type | Description |
|---|---|---|
| `kind` | `'line' \| 'bar' \| 'scatter' \| 'candlestick' \| …` | Chart kind |
| `mode` | `'x' \| 'xy'` | Brush shape |
| `xRange` | `[number, number] \| null` | Brushed x range in data units; `null` = cleared |
| `yRange` | `[number, number] \| null` | Brushed y range (`'xy'` mode), else `null` |
| `ranges` | `{ series, start, end }[]` | Line / area: selected sample runs per visible series |
| `ids` | `Uint32Array` | Scatter point ids, bar category indices, or candle indices (ascending, visible series only) |
| `count` | `number` | Selected samples / points / categories |

`BrushStyleOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `color` | `ColorInput` | engine blue-gray | Border color; the fill is the same color at `fillOpacity` |
| `fillOpacity` | `number` | `0.15` | Fill alpha multiplier |
| `borderWidth` | `number` | `1` | Border width in CSS px (`0` = none) |

## Touch and pen

`enableNodeInteractions` reads touch and pen input through Pointer Events (mouse behavior is unchanged). While bound, it sets `touch-action: none` on the canvas and restores the previous value on detach.

| Gesture | 2D line chart | Graph / 3D (2D scatter and bars pan instead of orbiting) |
|---|---|---|
| One-finger drag (8 px or more) | Pan x, with inertia on release | Orbit camera |
| Pinch | Zoom x around the finger midpoint | Camera zoom |
| Two-finger drag | Pan x | Camera pan |
| Tap | Pin the tooltip at that point until the next tap | Select node + tooltip (`onNodeClick`) |
| Long press (450 ms) | Scrub: the tooltip follows the finger, no pan | Same |
| Double tap | Reset zoom | Focus node |

```ts
sdk.enableNodeInteractions(canvas, {
  touch: { pinchZoom: true, tapTooltip: true, longPressScrub: true }, // all default true; touch: false disables
});
```

## Events

```ts
const off = sdk.on('rangechange', ({ xMin, xMax, yMin, yMax }) => {});
sdk.on('hover', ({ chart, node, clientX, clientY }) => {});
sdk.on('click', ({ chart, node, event }) => {});
off(); // or sdk.off(event, handler)
```

| Event | Payload | When |
|---|---|---|
| `hover` | `{ chart, node, clientX, clientY }` | Hover target changed; `null`s when the pointer leaves. Needs `enableNodeInteractions` |
| `click` | `{ chart, node, event }` | Click or tap without dragging. Needs `enableNodeInteractions` |
| `rangechange` | `{ xMin, xMax, yMin?, yMax? }` | Visible range changed (zoom, pan, reset, `setXRange`, navigator, streaming), at most once per frame and only on a real change |
| `legendtoggle` | `{ series, visible }` | Legend click or `setSeriesVisible` |
| `select` | `CharturboSelection` | Brush committed or cleared |
| `themechange` | `CharturboTheme` | `setTheme` |
| `resize` | `{ width, height }` | Render target resized (physical px) |
| `drill` | `CharturboDrillEvent` | Treemap / sunburst drill down or up |

- `chart` is a `ChartTooltipContext` (chart hover), `node` the `NodeDetails` of a graph node or of the primary chart point.
- `rangechange` includes `yMin` / `yMax` for scatter charts and for the line / area y domain.
- Events work alongside the `onNodeHover` / `onNodeClick` callbacks. A throwing handler does not stop the others; its error is rethrown asynchronously.

## Hosts with their own pointer handlers

When your app also listens to pointer events on the canvas, ask the SDK which input it owns:

```ts
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' && sdk.handlesTouchGestures()) return; // touch / pen belong to the SDK
  if (sdk.handlesChartBrush() && !e.altKey) return;                     // drag draws the brush
  if (sdk.handlesChartNavigation()) return;                             // wheel / drag navigate the chart
  // your own handling
});
```

`handlesCameraControls()` answers the same for graph and 3D camera controls.

## See also

- [Tooltips & Hover](./tooltips)
- [Data & Axes](./data-and-axes): y domain, navigator
- [Dashboard Sync](./dashboard-sync): share cursor and zoom across charts
- [Accessibility](./accessibility): keyboard navigation
