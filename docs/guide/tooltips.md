# Tooltips & Hover

Hovering a chart shows a GPU hover layer (crosshair, point markers, highlighted bars) and a DOM tooltip. This page covers the tooltip options, custom tooltip HTML, the hover style, and hover events.

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Basic usage

The built-in tooltip appears once interactions are enabled:

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.renderLineChart(series, { hover: { mode: 'index', crosshair: true } });
sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  tooltip: {
    sort: 'desc',            // 'none' (default, series order) | 'asc' | 'desc'
    shared: true,            // every series at the hovered x (default)
    pin: 'click',            // click pins the tooltip
    valueFormatter: '$,.2f', // spec, Intl options, or function
  },
});
sdk.render();
```

## Tooltip options

`enableNodeInteractions` options that shape the tooltip:

| Option | Type | Default | Description |
|---|---|---|---|
| `builtInTooltip` | `boolean` | `true` | Show the floating tooltip |
| `tooltipContainer` | `HTMLElement` | `canvas.parentElement` or `document.body` | Element the tooltip is mounted in |
| `tooltip.sort` | `'none' \| 'asc' \| 'desc'` | `'none'` | Row order by value; `NaN` last |
| `tooltip.shared` | `boolean` | `true` | `true`: every series at the hovered x / category. `false`: only the item closest to the pointer |
| `tooltip.pin` | `'click' \| false` | `false` | Click a hovered item to pin the tooltip |
| `tooltip.valueFormatter` | spec, `Intl.NumberFormatOptions`, or `(v) => string` | y axis `format` or locale number | Values in the default tooltip |
| `formatChartTooltip` | `(ctx: ChartTooltipContext) => string` | — | Custom HTML for chart tooltips |
| `formatTooltip` | `(details: NodeDetails) => string` | — | Custom HTML for graph / point-cloud node tooltips |
| `tooltipClassName` | `string` | — | Extra class(es); the base class is `charturbo-sdk-node-tooltip` |
| `tooltipStyle` | `Partial<CSSStyleDeclaration>` | — | Inline styles merged over the default style |

- `sort` and `shared` are presentation only. The engine hit-test is unchanged, and `'hover'` / `'click'` events still receive the original order and every item. `formatChartTooltip` receives the sorted and filtered context.
- `shared: false` reduces the rows of line, area, stacked bar, and combo tooltips. The GPU markers stay at every series; for a single marker too, use `hover: { mode: 'nearest' }`.
- `valueFormatter` applies to series values, totals, OHLC, heatmap cells, box statistics, pie values, and scatter y. It applies to the default tooltip only, not to `formatChartTooltip`. Spec syntax: [Number & Date Formats](./number-format).

## Pinning

With `pin: 'click'`, clicking a hovered item freezes the tooltip and the engine hover (crosshair, markers) at that point. The pinned element gets `data-pinned="true"`, and pointer moves, leaving the canvas, or a synced cursor do not change it.

It is released by the next click, a `pointerdown` outside the canvas, Escape (canvas focused), wheel zoom or drag pan, keyboard point navigation, or a new chart. Clicking empty space does not pin. On release, the `'hover'` event and `onNodeHover` receive `null`.

On touch devices a tap pins the tooltip at that point until the next tap, and a long press scrubs (see [Interactions](./interactions#touch-and-pen)).

::: warning
While pinned, the cursor of a [sync group](./dashboard-sync) (`hoverAtX`) still moves the engine markers. Only the tooltip stays fixed.
:::

## Custom tooltip HTML

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  formatChartTooltip: (ctx) =>
    `<b>${escapeHtml(ctx.xLabel)}</b>` +
    ctx.items
      .map((it) => `<div style="color:${it.color}">${escapeHtml(it.seriesName)}: ${it.value}</div>`)
      .join(''),
  tooltipClassName: 'my-tooltip',
  tooltipStyle: { background: '#fff', color: '#111' },
});
```

::: warning
The returned string is set as `innerHTML`. Wrap every data string (series names, labels, metadata) in the exported `escapeHtml`. The default tooltip escapes them already.
:::

Main fields of `ChartTooltipContext`:

| Field | Description |
|---|---|
| `chartType` | `'line'`, `'bar'`, `'scatter'`, `'candlestick'`, `'heatmap'`, `'box'`, `'pie'`, `'combo'`, … (area charts report `'line'`) |
| `index` | Hovered sample / bar / point index |
| `xLabel` | Formatted x (line), category label (bar), formatted x (scatter) |
| `x` | Series `x` of the primary sample (line charts with `x`) |
| `items` | `{ seriesName, value, color, nodeId, percent?, error?, band? }` per row |
| `total` | Stacked bar / area: sum of the visible series |
| `areaMode` | Area charts: `'overlap' \| 'stacked' \| 'percent'` |
| `point` | Scatter: data coordinates of the hovered point |
| `ohlc` | Candlestick: open / high / low / close / volume |
| `cell` | Heatmap: `{ row, col, xLabel, yLabel }` |
| `slice` | Pie: `{ label, value, percent, members? }` |
| `box` | Box plot statistics |
| `details` | `NodeDetails` of the primary point (closest to the pointer) |

Business and hierarchy charts add their own fields (`radar`, `gauge`, `funnel`, `waterfall`, `hierarchy`, `flow`).

## Hover style

The `hover` chart option (or `setChartHoverStyle` after rendering) styles the GPU hover layer. Colors are `ColorInput`: an `[r, g, b, a]` tuple in 0..1 or a CSS color string.

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'index' \| 'nearest'` | `'index'` | `'index'`: every series at the hovered x. `'nearest'`: the closest point only (the 2.5D view always uses `'nearest'`) |
| `crosshair` | `boolean` | `true` | Vertical guide line on 2D line charts |
| `crosshairColor` | `ColorInput` | `[0.58, 0.64, 0.72, 0.55]` | Crosshair color |
| `crosshairWidth` | `number` | `1` | Crosshair width in CSS px |
| `marker` | `boolean` | `true` | Point markers in the series color |
| `markerRadius` | `number` | `4` | Marker radius in CSS px, excluding the ring |
| `markerRingColor` | `ColorInput` | chart background | Ring separating the marker from the line |
| `markerRingWidth` | `number` | `2` | Ring width in CSS px |
| `hitRadius` | `number` | `24` (scatter: `12`) | `'nearest'` pick radius in CSS px |
| `barHighlightColor` | `ColorInput` | bar color lightened by 22% | Color of the hovered bar |

```ts
sdk.setChartHoverStyle({ mode: 'nearest', markerRadius: 6 });

// Graph / point-cloud nodes (default: own color brightened, 1.6x radius)
sdk.setNodeHoverStyle({ scale: 1.4, color: [1, 1, 1, 1] });
```

## Hover events

```ts
sdk.on('hover', ({ chart, node }) => {
  if (!chart) return hideSidePanel(); // pointer left
  showSidePanel(chart.xLabel, chart.items);
});
```

`chart` is the same `ChartTooltipContext` as above, but unsorted and unfiltered. Both `'hover'` and `onNodeHover` need `enableNodeInteractions`.

## Hover from code

```ts
sdk.hoverAtX(Date.parse('2026-01-01T09:00Z'), { tooltip: true }); // like a pointer resting at that x
sdk.getHoverX();  // data x of the current hover, or null
sdk.hoverAtX(null); // clear
sdk.render();
```

`hoverAtX` hovers in index mode (bars: the category at `round(x)`) without emitting `'hover'`. `tooltip: true` also shows the built-in tooltip. This is what [Dashboard Sync](./dashboard-sync) uses.

## Localized labels

Default tooltip values use the chart locale (`locale` option, then `setLocale`, then the runtime locale). Built-in field labels such as Open / High / Low / Close / Volume follow the same locale (en, ko, zh-CN; others fall back to English). See [Internationalization](./i18n).

## See also

- [Interactions](./interactions)
- [Number & Date Formats](./number-format)
- [Styling & Themes](./styling): tooltip colors come from the theme
