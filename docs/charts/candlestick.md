# Candlestick · OHLC

Financial charts of open / high / low / close prices. `renderCandlestickChart` draws candles: a body from open to close and a wick from low to high. `renderOhlcChart` draws OHLC bars: a high–low stem with an open tick on the left and a close tick on the right. Both share the time axis, volume pane, aggregation and navigation.

[Live example](https://jparkk0517.github.io/Charturbo/candlestick.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { timeZone: 'UTC' });

sdk.renderCandlestickChart(
  { t, open, high, low, close, volume }, // t: Date[] or epoch ms
  { title: 'ACME', hollowUp: true, yFit: 'visible', axes: { y: { format: '$,.2f' } } }
);
sdk.setXRange(t[t.length - 120], t[t.length - 1]); // start on the last 120 candles
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

```ts
renderCandlestickChart(data: CandlestickChartData, options?: CandlestickChartOptions): { candleCount: number }
renderOhlcChart(data: OhlcChartData, options?: OhlcChartOptions): { barCount: number }
```

Data point id = candle index.

## Data format

`CandlestickChartData` (`OhlcChartData` is the same type) has one entry per candle in every array:

| Field | Type | Description |
|---|---|---|
| `t` | `Float64Array \| number[] \| Date[]` | Optional x of each candle: epoch ms or `Date` for a time axis, or plain numbers with `axes.x.type: 'numeric'`. Finite, ascending. Omit to place candles by index. |
| `open` | `Float32Array \| number[]` | Open prices. |
| `high` | `Float32Array \| number[]` | High prices. |
| `low` | `Float32Array \| number[]` | Low prices. |
| `close` | `Float32Array \| number[]` | Close prices. |
| `volume` | `Float32Array \| number[]` | Optional volume, drawn as bars in a bottom pane with its own scale. |

A candle with a non-finite open, high, low or close is a gap.

## Options

`CandlestickChartOptions`:

| Option | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | — | Chart title. |
| `description` | `string` | — | Accessible name of the canvas. |
| `upColor` | `ColorInput` | theme palette[0] (blue) | Rising candle color (close ≥ open). |
| `downColor` | `ColorInput` | theme palette[1] (orange) | Falling candle color. |
| `hollowUp` | `boolean` | `true` | Rising candles as outlines, a shape cue besides color. Narrow candles are filled. |
| `wickWidth` | `number` | `1` | Wick / outline width in CSS px. |
| `bodyWidth` | `number` | `0.7` | Body width as a fraction of the candle spacing. |
| `cornerRadius` | `number` | `0` | Rounded body corners in CSS px, 0..1. |
| `showVolume` | `boolean` | `true` | Volume pane when `volume` is given. |
| `volumeOpacity` | `number` | `0.45` | Volume bar opacity. |
| `volumeHeight` | `number` | `0.2` | Volume pane height as a fraction of the plot. |
| `yFit` | `'visible' \| 'all'` | `'visible'` | `'visible'`: the price axis fits the visible candles on zoom / pan. `'all'`: every candle. |
| `axes` | `{ x?: LineXAxisOptions; y?: ChartAxisOptions }` | — | `x.type` defaults to `'time'` when `t` is given. See [Data & Axes](../guide/data-and-axes). |
| `locale` | `string` | SDK locale | Locale of default labels and tooltip values. |
| `timeZone` | `CharturboTimeZone` | SDK zone | Time zone of the time axis and its labels. |
| `hover` | `ChartHoverStyle` | — | Crosshair style (vertical at the candle, horizontal at the pointer). |
| `showBackdropGrid` | `boolean` | `true` | Horizontal gridlines and baseline. |
| `grid` | `ChartGridStyle` | — | Grid style. |
| `padding` | `ChartPaddingOptions` | auto | Plot margins in CSS px. |
| `animation` | `ChartAnimationInput` | SDK setting | Enter / update animation. |
| `width` | `number` | `168` | World width of the plot. |
| `height` | `number` | `86` | World height of the plot. |

`OhlcChartOptions` takes the same options except `hollowUp`, `wickWidth`, `bodyWidth` and `cornerRadius`, and adds:

| Option | Type | Default | Description |
|---|---|---|---|
| `lineWidth` | `number` | `1` | Stem and tick stroke width in CSS px (0.25–8). |
| `tickWidth` | `number` | `0.7` | Combined left / right tick span as a fraction of the bar spacing (0.05–1). |

```ts
const { barCount } = sdk.renderOhlcChart({ t, open, high, low, close, volume }, {
  lineWidth: 1.5,
  tickWidth: 0.8,
  showVolume: true,
  yFit: 'visible',
  timeZone: 'UTC',
  axes: { y: { format: '$,.2f' } },
});
```

## Colors

The default colors are blue for rising and orange for falling candles, not red and green alone, so they stay distinct under color-vision deficiency. Rising candles are hollow by default as a second cue. The defaults follow the theme when it changes.

## Aggregation

When candles get narrower than 2 CSS px, the engine aggregates them into 3 px buckets: open = first, high = max, low = min, close = last, volume = sum. Extremes are preserved, and 1,000,000+ candles stay interactive. The tooltip then shows the bucket values and `count`.

## Interactions

- Wheel, drag and pinch zoom and pan the x axis; double-click resets. `setXRange(Date, Date)` zooms from code.
- The crosshair is vertical at the candle and horizontal at the pointer.
- Tooltip: `ctx.chartType` is `'candlestick'` or `'ohlc'`; `ctx.ohlc = { open, high, low, close, volume, x, xEnd, count }`. The tooltip field labels (Open, High, Low, Close, Volume) follow the chart locale; see [Internationalization](../guide/i18n).
- Brush selection `kind` is `'candlestick'` or `'ohlc'`; `ids` are candle indices.
- Annotations use x = `t` and y = price. See [Annotations](../guide/annotations).
- Keyboard navigation, the data table, CSV and vector SVG export are supported.

See [Interactions](../guide/interactions) and [Tooltips & Hover](../guide/tooltips).

## Updating data

Call `renderCandlestickChart` or `renderOhlcChart` again with the new arrays. The OHLC mode is kept across theme changes.

## Frameworks

```tsx
<CharturboChart type="candlestick" data={{ t, open, high, low, close }} />
<CharturboChart type="ohlc" data={{ t, open, high, low, close, volume }} options={{ tickWidth: 0.8 }} />
```

## See also

- [Line](./line)
- [Number & Date Formats](../guide/number-format)
- [Internationalization](../guide/i18n)
