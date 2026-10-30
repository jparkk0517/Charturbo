# Multiple Axes & Axis Breaks

Line and combo charts can show more than two y axes, and value axes can collapse ranges that hold no data (axis breaks).

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Three or more y axes

Each series picks its axis with `yAxisIndex`: `0` is `axes.y` (left), `1` is `axes.y2` (right), and `2..` is `axes.extraY[k - 2]`. `yAxisIndex` overrides `yAxis: 'left' | 'right'`.

```ts
sdk.renderLineChart(
  [
    { name: 'Temperature', x, values: temp },
    { name: 'Rain', x, values: rain, yAxis: 'right' },
    { name: 'Pressure', x, values: pressure, yAxisIndex: 2, color: '#c2410c' },
  ],
  {
    axes: {
      y: { title: 'Temperature (°C)' },
      y2: { title: 'Rain (mm)', min: 0 },
      extraY: [{ title: 'Pressure (hPa)', color: '#c2410c', format: (v) => v.toFixed(0) }],
    },
  }
);
```

Every extra axis has its own options: `min` / `max`, `autoscale`, `scale` (`'linear'` / `'log'`), `format`, `title`, `tickCount`, `breaks`, and placement:

| Option | Default | Meaning |
|---|---|---|
| `position` | `'right'` | Side of the plot. Axes stack outward after the axes already on that side |
| `offset` | `0` | Extra CSS px between this axis and the previous one on its side |
| `color` | theme | Color of the labels, the title and the axis line |
| `show` | `true` | `false` hides the labels but keeps the axis scale |

- **Padding:** it grows automatically to fit the extra label slots and titles.
- **Zoom:** x zoom and pan move every series. Each y axis autoscales on its own.
- **Gridlines:** they follow the left axis.
- **Tooltips:** each value uses its own axis' `format`.
- **Limit:** at most 6 extra axes (8 y axes in total).
- **Errors:** a `yAxisIndex` without an axis throws before the current chart is cleared.

Combo charts take the same options (`ComboChartOptions.axes.extraY` with `min`, `max`, `nice`, `position`, `offset`, `color`). All bar series share the first bar series' axis.

```ts
sdk.renderComboChart(
  {
    categories: weeks,
    series: [
      { name: 'Volume', type: 'bar', values: volume },
      { name: 'Price', type: 'line', yAxis: 'right', values: price },
      { name: 'RSI', type: 'line', yAxisIndex: 2, values: rsi },
    ],
  },
  { axes: { extraY: [{ title: 'RSI', position: 'left', min: 0, max: 100, nice: false }] } }
);
```

Several axes invite readers to compare unrelated scales. Prefer separate charts unless the series belong together.

## Axis breaks

`breaks` collapses value ranges into small gaps marked with zigzag lines on the axis and across the plot:

```ts
sdk.renderBarChart(items, {
  axes: { y: { breaks: [{ start: 40, end: 430, gap: '8%' }] } },
});
```

| Field | Meaning |
|---|---|
| `start`, `end` | Collapsed value range (`start < end`) |
| `gap` | Room the range keeps: data units, or `'<n>%'` of the axis' kept data span. Default `'2%'` |

Where breaks are supported:

| Chart | Axes |
|---|---|
| Line | `axes.y`, `axes.y2`, `axes.extraY[i]` |
| Area | `axes.y` |
| Combo | `axes.y`, `axes.y2`, `axes.extraY[i]` |
| Bar (single and grouped / stacked / percent) | the value axis (`axes.y`, or `axes.x` when horizontal) |
| Scatter | `axes.x` and `axes.y` |

- **Engine:** the piecewise mapping lives in the Rust scale. Geometry, ticks, hover, brush selection and zoom all use it.
- **Tick labels:** ticks skip the collapsed ranges.
- **Data inside a break:** it is drawn at the gap and keeps its real value in tooltips, the data table and CSV.
- **Exports:** PNG and SVG exports include the zigzag marks.
- **Screen readers:** the description lists every break.

Rules (checked before the current chart is cleared):

- at most 8 breaks per axis, with no overlapping or touching ranges
- linear scales only: breaks on a `log` axis throw, and so does `setAxisScale(axis, { scale: 'log' })` on an axis with breaks
- bar error bars cannot be combined with breaks
- pictorial bars and the x axis of line / area charts reject breaks

## Accessibility

The screen-reader description names each extra axis with its series ("Additional y axis (Pressure): Pressure.") and each break ("Y axis skips 40–430."), in the chart locale.
