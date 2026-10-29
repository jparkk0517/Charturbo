# Calendar Heatmap

`renderCalendarHeatmap` draws one cell per day, arranged in weeks like a wall calendar, and colors each cell by its value. Use it for daily activity over months or years, such as commits, sales or sensor uptime.

[Live example](https://jparkk0517.github.io/Charturbo/heatmap.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderCalendarHeatmap(
  [
    ['2023-01-02', 4],
    ['2023-01-03', 7],
    ['2023-01-05', null], // no data
  ],
  { range: 2023, firstDay: 1, title: 'Commits per day', valueLabel: 'Commits' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderCalendarHeatmap(data: CalendarHeatmapData, options?: CalendarHeatmapOptions): { dayCount: number; calendarCount: number }
```

## Data format

```ts
type CalendarDate = string | number | Date;
type CalendarHeatmapData = ArrayLike<readonly [CalendarDate, number | null | undefined]>;
```

- `'YYYY-MM-DD'` strings are taken as written; no time zone is applied.
- Epoch milliseconds, `Date` objects and ISO strings with a time (`'2023-01-02T09:00Z'`) count on their day in the chart time zone: `options.timeZone`, else the SDK zone (`setTimeZone`, default `'local'`). A time without `Z` or an offset is first read in the browser's zone (`Date.parse`). See [Data & Axes](../guide/data-and-axes).
- `null`, `undefined` and `NaN` values mark a day without data. If a day appears twice, the last value wins.
- Days outside every range are ignored. An invalid date such as `'2023-02-30'` throws.

## Ranges and multiple calendars

`range` sets one calendar. `ranges` sets several; they stack top to bottom (horizontal) or sit side by side (vertical).

| Value | Meaning |
| --- | --- |
| `2023` or `'2023'` | The whole year |
| `'2023-02'` | One month |
| `'2023-02-14'` | One day |
| `['2023-01-15', '2023-03']` | Inclusive span; a month or year end means its last day |

Without `range` or `ranges` there is one calendar per year that the data covers (the current year without data). A range that starts after it ends throws. All ranges together may cover at most 40,000 days.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `range` | `CalendarRange` | data years | One calendar. |
| `ranges` | `CalendarRange[]` | | Several calendars; wins over `range`. |
| `orient` | `'horizontal' \| 'vertical'` | `'horizontal'` | Horizontal: weeks run left to right, weekdays are rows. Vertical: weeks run down, weekdays are columns. |
| `cellSize` | `number` | fit | Largest cell side in CSS px. Cells shrink to fit the plot. |
| `cellGap` | `number` | `2` | Gap between cells in CSS px. |
| `firstDay` | `number` | `0` | First day of the week: `0` Sunday to `6` Saturday. Other values throw. |
| `dayLabels` | `boolean \| { show?, names? }` | `true` | Weekday names. `names`: 7 names from Sunday. Small cells show every other or every third row. |
| `monthLabels` | `boolean \| { show?, names? }` | `true` | Month names. `names`: 12 names from January. Labels that would overlap are skipped. |
| `yearLabel` | `boolean` | `true` | Year of each calendar (`2023–2024` when a range spans years). |
| `splitLine` | `boolean \| { show?, color?, width? }` | `true` | Month boundary lines. The default color is the theme baseline; width is 1 px. |
| `colorScale` | `HeatmapColorScale` | `'sequential'` | Colormap, the same as [Heatmap](./heatmap): `'sequential'`, `'viridis'`, `'magma'`, `'diverging'`, … |
| `color` | `ColorInput` | | Hue of the sequential / diverging scales. |
| `reverse` | `boolean` | `false` | Reverses the colormap. |
| `min`, `max`, `center` | `number` | data extent | Value domain; `center` is the diverging midpoint. |
| `emptyColor` | `ColorInput` | theme grid tone | Color of days without data. |
| `colorbar` | `boolean \| HeatmapColorbarOptions` | `true` | Colorbar right of the calendar (`title` defaults to `valueLabel`). |
| `timeZone` | `CharturboTimeZone` | SDK zone | Zone that turns epoch ms / `Date` into days. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip, data table and colorbar. |
| `format` | `ChartValueFormat` | locale number | Value text of tooltip and accessibility. See [Number & Date Formats](../guide/number-format). |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

Weekday and month names follow the chart locale (`setLocale`). The calendar has no legend.

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. Hovering any day, including days without data, highlights the cell and shows the date and value. Brush, zoom and pan are disabled. Data point ids count the days of all calendars in order (the first day of the first calendar is `0`).

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'calendar'
// ctx.index = day id
// ctx.calendar = { date: '2023-01-02', day, value, calendar }  // value NaN = no data
```

## Notes

- Layout, month split lines, label anchors, hit testing and the colormap are computed in the engine (Rust). The cells are vector marks, so `exportChartSVG` writes them as SVG paths.
- Accessibility: the summary gives the span, how many days have data and the value range. The data table and `exportChartCSV` list the days with data (date, value). Keys: Up / Down move one day and Left / Right one week (swapped when vertical), Page Up / Page Down move one month, Home / End go to the first / last day. See [Accessibility](../guide/accessibility).
- React / Vue: `type="calendar"`.

## See also

- [Heatmap](./heatmap)
- [Data & Axes](../guide/data-and-axes)
- [Tooltips & Hover](../guide/tooltips)
