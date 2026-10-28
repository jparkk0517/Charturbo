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
