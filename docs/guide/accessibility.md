# Accessibility

Every chart the SDK renders gets a text summary, a longer screen-reader description, keyboard navigation of its data points, and an optional accessible data table with CSV export. Nothing has to be enabled: give the chart a `title`, and a `description` when the automatic summary is not enough.

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const rps = Float32Array.from({ length: 5_000 }, (_, i) => 100 + Math.sin(i / 300) * 50);
sdk.renderLineChart([{ name: 'AI-Inference-RPS', values: rps }], {
  title: 'Inference traffic',
  description: 'RPS doubled after the deploy', // optional: replaces the automatic summary as aria-label
});
sdk.enableNodeInteractions(canvas, { autoRender: true }); // the keyboard-focused point also shows the tooltip
sdk.render();

sdk.getChartSummary(); // "Inference traffic. Line chart, 1 series, 5,000 points; ..."
```

## What the canvas gets

| Attribute / element | Value |
|---|---|
| `role` | `img` |
| `aria-label` | The automatic summary (chart kind, series and point counts, value ranges). With `description`, that sentence; the summary then moves into the long description. |
| `aria-describedby` | A visually hidden element: axis ranges, per-series min / max / mean / trend, and keyboard help. |
| `tabindex` | `0` while a chart is shown, so the canvas is reachable with Tab. |
| Live region | A visually hidden `aria-live="polite"` element that reads the focused point, for example `"T+120, AI-Inference-RPS 135.9."` |

`sdk.getChartSummary()` returns the same text as `aria-label`. The attributes the canvas had before are restored when the chart is removed or the SDK is disposed.

## Keyboard navigation

Focus the canvas, then:

| Key | Action |
|---|---|
| ← / → | Previous / next sample (bar: category; scatter: next point of the series in x order; candlestick: candle; pie: slice; heatmap: column) |
| PageUp / PageDown | Jump 10 samples (not on pie charts) |
| Home / End | First / last sample (scatter: smallest / largest x) |
| ↑ / ↓ | Switch series, skipping hidden ones (heatmap: rows; not on single-series bar, candlestick or pie charts) |
| Enter | Treemap / sunburst: drill into the focused node |
| Esc | Clear the focus (treemap / sunburst: go back up one level) |

Keys pressed with Alt, Ctrl or ⌘ are ignored, so zoom shortcuts such as Ctrl + Z keep working.

The focused point drives the same engine hover as the pointer (crosshair, marker, bar highlight). If `enableNodeInteractions` is on, the built-in tooltip, including a custom `formatChartTooltip`, appears at that point.

## Data table and CSV

```ts
sdk.showDataTable(document.querySelector('#table')!, { maxRows: 1000 }); // without a container: inserted right after the canvas container
sdk.hideDataTable();

const table = sdk.getChartDataTable(); // { columns, rows, totalRows, sampled }, full data by default
const csv = sdk.exportChartCSV();      // RFC 4180 CSV with CRLF rows
```

| Option | Type | Default | Description |
|---|---|---|---|
| `maxRows` | `number` | `1000` in `showDataTable`; unlimited in `getChartDataTable` | Longer data is downsampled evenly, keeping the first and last rows. |
| `maxColumns` | `number` | `50` in `showDataTable`; unlimited in `getChartDataTable` | Heatmap only: value columns, downsampled the same way. |

- The rendered table has a `<caption>` (the chart title) and `<th scope="col">` / `<th scope="row">` headers. Its scroll container has `role="region"` and is focusable, so keyboard users can scroll it.
- A downsampled table carries a note saying so. `getChartDataTable()` reports it with `sampled` (and `sampledColumns` / `totalColumns` for heatmaps).
- An open table is refreshed when the chart is re-rendered or the theme changes.
- `exportChartCSV()` always writes the full data. Text cells that a spreadsheet would run as a formula (starting with `=`, `+`, `-` or `@`) get a leading `'`; numbers are written as is.
- A 4096 × 4096 heatmap is 16M cells: pass `maxRows` / `maxColumns` to `getChartDataTable`, or use `exportChartCSV()`.

## Language

Summaries, long descriptions, keyboard help, live announcements and data table headers follow the SDK locale: `Charturbo.create(canvas, { locale })` or `sdk.setLocale(locale)`. Built-in languages are English (`en`), Korean (`ko`) and Simplified Chinese (`zh-CN`); other locales fall back to English, and `undefined` uses the browser language. Numbers and dates use `Intl` formatting for the same locale. See [Internationalization](./i18n).

## High contrast and reduced motion

- With `forced-colors: active` (Windows High Contrast), legend swatches get a `CanvasText` border and keep their series color (`forced-color-adjust: none`), hidden series get a dashed border, and the canvas focus ring uses `Highlight`. Tooltip and data table cells get `CanvasText` borders.
- The keyboard focus ring is a 2 px `:focus-visible` outline in the current text color.
- The accessibility layer itself uses no transitions. Chart [animations](./animation) are opt-in and are turned off under `prefers-reduced-motion: reduce`.

## Pattern fills (decal)

Color alone does not tell series apart for color-blind readers or on grayscale prints. `decal` (ECharts `aria.decal` / `itemStyle.decal`) draws a pattern of small symbols over the marks of bar (grouped / stacked / percent, 2D), pie / donut, area, treemap, sunburst and funnel charts:

```ts
// Every series (single-series bars: every item category) gets its own automatic pattern
sdk.renderGroupedBarChart(data, { mode: 'stacked', decal: true });

// Chart-level options apply over the automatic patterns; series / items override them
sdk.renderGroupedBarChart(
  { categories, series: [{ name: 'A', values: a }, { name: 'B', values: b, decal: { symbol: 'cross', color: '#facc15' } }, { name: 'C', values: c, decal: false }] },
  { decal: { opacity: 0.6 } }
);

// Pie / funnel: per-slice / per-stage overrides by input index; treemap / sunburst: `decal` on nodes
sdk.renderPieChart({ labels, values }, { decal: true, decals: [undefined, { symbol: 'circle' }] });
```

| Option | Default | |
|---|---|---|
| `symbol` | automatic | `'rect'`, `'circle'`, `'triangle'`, `'diamond'`, `'line'` (stripes), `'cross'`, or `'none'` |
| `symbolSize` | automatic (2–7) | Symbol size in CSS px, 0 < size ≤ 512 (stripe thickness for `'line'`) |
| `spacing` | automatic (8–10) | Tile size in CSS px (distance between symbol centers), 1–1024 |
| `rotation` | automatic | Degrees, clockwise on screen |
| `color` | `'auto'` | `'auto'`: black on light marks, white on dark ones; or any color |
| `opacity` | 0.45 | 0–1, times the color alpha and the mark alpha |

- Automatic patterns cycle through eight distinct symbol / angle combinations in series order (pie: slice, funnel: stage, treemap / sunburst: top-level group).
- Patterns are drawn on the GPU in a second pass (no textures) and look the same on WebGPU and WebGL2. Legend swatches show the pattern, SVG export writes matching `<pattern>` definitions, and a theme switch keeps the patterns (auto colors follow the new mark colors). Without `decal` nothing extra is drawn.
- Patterns are **anchored in screen space**: the tiles start at the canvas top-left, so a pattern stays put while marks move, zoom or animate (like CSS `background-attachment: fixed`).
- Not drawn: 3D charts, pictorial bars, the folded pie "Other" slice, treemap parent headers and the sunburst center. Overlapping areas (`mode: 'overlap'`) draw every pattern after every fill, so a lower series' pattern can show through an upper series where they overlap.

## Chart-specific behavior

- **Scatter**: the summary lists point counts and x / y ranges per series; the table has one row per point (x, y, series) in data order.
- **Sankey**: the summary gives node, column and link counts and the largest flow; the table has one row per link (source, target, value, share of source); ← / → move between links.
- **Treemap / sunburst**: Enter drills into the focused node and Esc goes back up, as with the pointer.
- **Sparkline**: compact. The canvas only gets `role="img"` and an `aria-label` trend sentence (for example `"Revenue: trend up 12% from 100 to 112, min 95, max 120"`); there is no description, live region or `tabindex`. Set the name with the `label` option. See [Sparkline](../charts/sparkline).

## Limits

- A point that is zoomed out of view is still announced, but the hover is cleared.
- In screen reader browse mode the reader takes the arrow keys. Switch to focus / forms mode to navigate the chart.

## See also

- [Internationalization](./i18n)
- [Tooltips & Hover](./tooltips)
- [Interactions](./interactions)
- [Export: PNG · SVG · PDF](./export)
