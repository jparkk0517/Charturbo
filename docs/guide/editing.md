# Editing Data Points

Line and scatter charts can let users drag points to new values and click the plot to add points, like ECharts' draggable points. Editing is off by default. Without `editable`, charts behave exactly as before.

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Turn it on

```ts
sdk.renderLineChart([{ name: 'Target', values: [42, 48, 55, 51, 63] }]);
sdk.enableNodeInteractions(canvas, { autoRender: true, editable: { dragAxis: 'y', min: 0, max: 100 } });

sdk.on('pointDrag', (e) => console.log(e.series, e.index, e.oldValue.y, '→', e.newValue.y));
sdk.on('pointDragEnd', (e) => {
  if (!e.cancelled) save(sdk.getSeriesData(e.series));
});
```

`editable: true` uses the defaults. `sdk.setChartEditable(options | false)` changes the options later, and `sdk.getChartEditable()` returns the active ones. Options are validated before anything changes: a bad `dragAxis` or `min > max` throws and keeps the current setting.

| Option | Default | Meaning |
|---|---|---|
| `drag` | `true` | Pointer and keyboard drag of existing points |
| `dragAxis` | line `'y'`, scatter `'xy'` | Axes a drag moves: `'x'`, `'y'` or `'xy'` |
| `min` / `max` | none | y clamp in data units |
| `xMin` / `xMax` | none | x clamp in data units |
| `addOnClick` | `false` | A click or tap on an empty part of the plot adds a point |
| `addSeries` | `0` | Series that new points join |
| `series` | all | Only these series can be edited |
| `hitRadius` | `10` | Grab distance from a point's center, in CSS px |

## How a drag behaves

- **Pointer:** pressing a point grabs it, so the press does not pan, brush or box-zoom. A press that does not move is still a normal click. Mouse, touch and pen all work through Pointer Events.
- **Clamping:** values stay inside the visible plot range and inside `min` / `max` / `xMin` / `xMax`.
- **Line x drags:** a line point moves in x only when the series has `x` values. It never passes its neighbours, so x stays sorted.
- **Escape:** cancels a drag and restores the old value. `pointDragEnd` then has `cancelled: true`.
- **Live updates:** the chart updates through the data update path. The scene is not cleared, and zoom, legend and style state stay. The line y domain is held during the drag and re-derived on release.

## Click to add

With `addOnClick`, a click on an empty part of the plot adds a point under the pointer and emits `pointAdd`. A click on or next to an existing point is not an add. On a line, the point is inserted in x order (without `x`, at the nearest sample index), so later indices shift by one.

```ts
sdk.enableNodeInteractions(canvas, { editable: { addOnClick: true, addSeries: 1 } });
sdk.on('pointAdd', (e) => console.log(`series ${e.series} #${e.index}`, e.value));
```

## Keyboard

Focus the chart and move to a point with the arrow keys. Then:

- **Shift + arrow** moves the focused point by 1/50 of the visible range.
- **Alt + arrow** moves it by 1/500 of the visible range (a fine step).

Up and Down change y. Left and Right change x when `dragAxis` allows it. The new value is announced in the chart's live region, and each step emits `pointDrag` and `pointDragEnd` with `source: 'keyboard'`.

## Events and data

| Event | Payload |
|---|---|
| `pointDrag` | `{ chartType, series, index, oldValue, newValue, source }` on each move |
| `pointDragEnd` | Same, plus `cancelled` |
| `pointAdd` | `{ chartType, series, index, value }` |

`sdk.getSeriesData(series)` returns the edited data as `{ x, y }`. For scatter it also returns `index`, the point indices of that series. Line `x` is the sample index on charts without `x` values.

React: `onPointDrag`, `onPointDragEnd`, `onPointAdd`. Vue: `@point-drag`, `@point-drag-end`, `@point-add`. Pass `editable` through `interactions`.

## Limits

- **Supported charts:** 2D line and scatter charts.
- **Line series that are not editable:** stacked, percent, band, ThemeRiver and sparse series, and series on extra y axes (`yAxisIndex` ≥ 2).
- **Scatter:** points outside the current domain are still kept. The domain does not grow until the next render.
