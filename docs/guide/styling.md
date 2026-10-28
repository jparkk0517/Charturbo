# Styling & Themes

A theme sets the colors shared by the GPU marks and the DOM overlay: background, series palette, gridlines, text, and tooltips. Per-chart options then set series colors, the title, the legend, the grid, padding, and line widths.

[Live example](https://jparkk0517.github.io/Charturbo/line.html)

## Built-in themes

```ts
import { Charturbo, CHARTURBO_THEMES } from 'charturbo';

const sdk = await Charturbo.create(canvas);
sdk.setTheme('light');          // 'dark' (default) | 'light'
sdk.getTheme().name;            // 'light'
CHARTURBO_THEMES.dark.palette;  // RgbaTuple[]
```

Each built-in palette is an 8-color order validated for color-vision deficiency against its own background.

## Custom themes

Spread an existing theme and override the tokens you need. The GPU color tokens (`surface`, `palette`, `grid`, `baseline`, `crosshair`) also accept CSS color strings.

```ts
sdk.setTheme('light');
sdk.setTheme({
  ...sdk.getTheme(),
  name: 'brand',
  surface: '#faf6ed',
  palette: ['#3182f6', '#14b8a6', '#f59e0b'],
  textPrimary: '#14213d',
  fontFamily: 'system-ui, sans-serif',
});
sdk.renderBarChart(
  [
    { label: 'A', value: 32, color: '#3182f6' },
    { label: 'B', value: 18, color: '#14b8a6' },
  ],
  { orientation: 'horizontal', cornerRadius: 8, labels: true }
);
sdk.render();
```

Theme tokens (`CharturboTheme`):

| Token | Type | Description |
|---|---|---|
| `name` | `string` | Theme name |
| `surface` | `RgbaTuple` | Canvas clear color |
| `palette` | `RgbaTuple[]` | Categorical series order |
| `grid` | `RgbaTuple` | Gridlines |
| `baseline` | `RgbaTuple` | Baseline; default color of line / point annotations |
| `crosshair` | `RgbaTuple` | Crosshair; default color of band annotations |
| `textPrimary` | `string` | Titles, labels |
| `textSecondary` | `string` | Secondary text |
| `textMuted` | `string` | Muted text |
| `tooltipBackground` | `string` | Tooltip and label pill background |
| `tooltipBorder` | `string` | Tooltip and label pill border |
| `fontFamily` | `string` | Font of the DOM overlay (title, legend, ticks, labels, tooltip) |

`getTheme()` returns GPU tokens as tuples even when they were given as CSS strings.

## What setTheme updates

`setTheme` updates the background, text, gridlines, tooltips, annotation default colors, the navigator, and each chart kind's theme-derived styles (pie, heatmap, business, and hierarchy palettes, among others). It emits `'themechange'`.

Series and item colors you passed explicitly to a render call are kept. To change those too, call the `render*Chart()` method again with new options and then `render()`.

The [benchmark page](https://jparkk0517.github.io/Charturbo/benchmarks.html) switches themes, accent color, palette, font, corner radius, and labels this way. Its Midnight and Paper themes are custom themes from the example; the SDK's built-in string themes are `'light'` and `'dark'`.

## Series colors

```ts
sdk.renderLineChart([
  { name: 'cpu', values: cpu, color: '#3b82f6' },
  { name: 'mem', values: mem, color: [0.94, 0.35, 0.33, 1] },
  { name: 'net', values: net }, // next palette color
]);
```

Every color option accepts `ColorInput`:

- an `[r, g, b, a]` tuple in 0..1,
- `'#rgb'`, `'#rgba'`, `'#rrggbb'`, `'#rrggbbaa'`, `rgb()` / `rgba()`, `hsl()` / `hsla()`, parsed without the DOM,
- any other CSS color (named colors and so on), resolved through a 2D canvas when `document` exists.

An invalid string throws a `TypeError`. The parser is exported as `parseColor`.

## Title and legend

```ts
sdk.renderLineChart(series, {
  title: 'Infrastructure telemetry',
  legend: { show: true, toggle: true, emphasize: true },
});
sdk.setSeriesVisible(1, false); // same as a legend click
sdk.emphasizeSeries(0);         // fade the other series (null clears)
```

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Chart title above the plot |
| `legend` | `boolean \| ChartLegendOptions` | shown with 2+ series | `true` / `false` or the object below |
| `legend.show` | `boolean` | `true` with 2+ series | Show the legend |
| `legend.toggle` | `boolean` | `true` | Click toggles series visibility |
| `legend.emphasize` | `boolean` | `true` | Hover fades the other series |

Legend items are `<button aria-pressed>` elements, so they work from the keyboard. Toggling emits `'legendtoggle'`.

## Grid

```ts
sdk.renderLineChart(series, { showBackdropGrid: true, grid: { rows: 4, strokeWidth: 1 } });
sdk.setChartGrid(true, { rows: 4, color: '#e5e7eb' }); // after rendering
```

| Option | Type | Default | Description |
|---|---|---|---|
| `showBackdropGrid` | `boolean` | `true` | Horizontal gridlines and baseline |
| `grid.rows` | `number` | `5` | Number of horizontal grid intervals |
| `grid.color` | `ColorInput` | theme `grid` | Gridline color |
| `grid.baselineColor` | `ColorInput` | theme `baseline` | Baseline color |
| `grid.strokeWidth` | `number` | `1` | Line width in CSS px |
| `verticalGrid` | `boolean` | `true` | Scatter only: vertical gridlines at the x ticks |

## Padding

```ts
sdk.renderLineChart(series, { padding: { right: 24 } });
```

`padding` (`top`, `right`, `bottom`, `left`, CSS px) sets plot margins. Sides you omit are derived from the title, legend, and axes.

## Line width

```ts
sdk.renderLineChart(series, { lineWidth: 2 }); // every series, CSS px (default 2)
sdk.setLineWidth(1.5);    // after rendering: every series
sdk.setLineWidth(4, 0);   // series 0 only
```

Series `lineWidth` overrides the chart value. The width stays constant at any zoom. Markers, dashes, and curves are covered in [Line](../charts/line).

## CSS classes

The overlay is plain DOM, so it can be styled with CSS:

| Class | Element |
|---|---|
| `.charturbo-sdk-chart-overlay` | Overlay root above the canvas |
| `.charturbo-sdk-chart-title` | Title |
| `.charturbo-sdk-chart-legend`, `.charturbo-sdk-legend-item` | Legend and its items |
| `.charturbo-sdk-axis-tick`, `.charturbo-sdk-axis-title` | Tick labels and axis titles |
| `.charturbo-sdk-annotation-label` | Annotation labels |
| `.charturbo-sdk-node-tooltip` | Tooltip |

## See also

- [Tooltips & Hover](./tooltips): hover layer style
- [Annotations](./annotations)
- [Export: PNG · SVG · PDF](./export)
- [Accessibility](./accessibility)
