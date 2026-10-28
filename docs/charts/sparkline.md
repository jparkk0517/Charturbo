# Sparkline

`renderSparkline` draws a word-sized line, area, bar or win / loss chart with no axes, grid, legend, title or overlay DOM. Use it in tables and KPI rows; pair it with a shared GPU device when a page shows many of them.

[Live example](https://jparkk0517.github.io/Charturbo/sparklines.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!; // e.g. 120 × 30 CSS px
const sdk = await Charturbo.create(canvas);

sdk.renderSparkline([100, 104, 98, 107, 112, 109, 115], {
  type: 'line',
  showLast: true,
  showMinMax: true,
  label: 'Revenue',
});
sdk.render();
```

Signature:

```ts
renderSparkline(data: SparklineData | Float32Array | number[], options?: SparklineOptions): SparklineResult
```

## Data format

Pass the values directly, or an object with `x`:

```ts
interface SparklineData {
  values: Float32Array | number[]; // NaN = gap; win / loss: sign of each value
  x?: Float64Array | number[] | Date[]; // line / area only; same rules as a line series `x`
}
```

- `'winloss'` reads the sign of each value: `> 0` win, `< 0` loss, `0` tie (empty slot).
- `x` is ignored by `'bar'` and `'winloss'`.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `'line' \| 'area' \| 'bar' \| 'winloss'` | `'line'` | `'winloss'` draws equal-height up / down bars by sign. |
| `color` | `ColorInput` | first palette color | Series, bar or win color. |
| `negativeColor` | `ColorInput` | second palette color | Loss bars of `'winloss'`. |
| `lineWidth` | `number` | `1.5` | Stroke width in CSS px. |
| `showLast` | `boolean` | `false` | Marker on the last sample, in the series color. Ignored by `'winloss'`. |
| `showMinMax` | `boolean` | `false` | Markers on the minimum and maximum. Ignored by `'winloss'`. |
| `markerRadius` | `number` | `2.5` | Marker radius in CSS px. |
| `lastColor` | `ColorInput` | series color | Last-sample marker color. |
| `minMaxColor` | `ColorInput` | theme secondary text color | Min / max marker color. |
| `band` | `[number, number]` | | Reference band `[lo, hi]` in data units (e.g. a target range), drawn beneath the series. |
| `bandColor` | `ColorInput` | theme muted text color at 15% alpha | Band color; its alpha is used as is. |
| `fillOpacity` | `number` | `0.2` | Area fill alpha multiplier. |
| `width` | `number` | canvas CSS size minus padding | Plot width in world units; only the aspect ratio matters. |
| `height` | `number` | canvas CSS size minus padding | Plot height in world units. |
| `padding` | `number` | `2` (marker radius + 1 with markers) | CSS px around the plot. |
| `tooltip` | `boolean` | `false` | Built-in hover tooltip. When `false`, no tooltip DOM and no pointer listeners are created. |
| `label` | `string` | `'Sparkline'` (localized) | Name used in the aria-label and tooltip, e.g. `'Revenue'`. |
| `description` | `string` | generated trend summary | Accessible name of the canvas; replaces the generated summary. |
| `formatValue` | `(v: number) => string` | locale, up to 2 decimals | Number format of the aria-label and tooltip values. |

When neither `width` nor `height` is given, the plot follows the canvas CSS size and is re-fitted when a resize changes the aspect ratio. The y domain fits the data exactly (no nice rounding).

## Result

```ts
interface SparklineResult {
  pointCount: number;
  summary: SparklineSummary | null; // trend of the data, computed by the engine
  label: string;                    // aria-label given to the canvas
}

interface SparklineSummary {
  count: number;
  first: number; last: number; min: number; max: number;
  firstIndex: number; lastIndex: number; minIndex: number; maxIndex: number;
  changePct: number; // first → last in % of |first| (NaN when first is 0)
}
```

## Accessibility

The canvas gets `role="img"` and an `aria-label` only; no description DOM, live region or `tabindex` is created. `getChartSummary()` returns the same sentence.

- line / area / bar: `"Revenue: trend up 12% from 100 to 112, min 95, max 120"`
- win / loss: `"Results: 7 wins, 3 losses, last: win"`

The examples are for an English locale; the text follows the chart locale. See [Internationalization](../guide/i18n).

## Updating data

For `'line'` and `'area'` sparklines, `setSeriesData` replaces the data without re-rendering the chart. The engine recomputes the last / min / max markers and the trend summary.

```ts
sdk.setSeriesData(0, nextValues);
sdk.render();
```

`setSeriesData` works on line charts only, so for `'bar'` and `'winloss'` call `renderSparkline` again with the new values.

## Many sparklines on one page

`Charturbo.create(canvas)` requests a GPU device and compiles every pipeline per canvas, and browsers cap WebGL contexts at about 16. For tables with dozens or hundreds of sparklines, create one `CharturboDevice` and pass it to every chart:

```ts
import { Charturbo, CharturboDevice } from 'charturbo';

const device = await CharturboDevice.create();
for (const row of rows) {
  const sdk = await Charturbo.create(row.canvas, { device });
  sdk.renderSparkline(row.values, { type: 'area', band: [95, 105], label: row.name });
  sdk.render();
}
// later: dispose each sdk, then device.dispose()
```

See [Shared GPU Device](../guide/shared-device) for backends, WebGL2 behavior and limits.

## Notes

- Last / min / max markers, the reference band and the win / loss zero line are engine (Rust) marks drawn on the GPU only.
- There is no zoom, pan or keyboard navigation.
- Win / loss bars use the first palette color for wins and the second for losses, with a zero line.
- In the React / Vue components, `type: 'sparkline'` turns interactions off by default. See [React](../guide/react) and [Vue](../guide/vue).

## See also

- [Shared GPU Device](../guide/shared-device)
- [Line](./line)
- [Area](./area)
- [Real-time Streaming](../guide/streaming)
- [Accessibility](../guide/accessibility)
