# Number & Date Formats

Axis tick labels, bar data labels, and tooltip values take a format: a function, a d3-format style spec string, or an `Intl.NumberFormatOptions` object. Default labels and time labels follow the chart locale and time zone.

## Basic usage

```ts
import { Charturbo, createFormatter, formatNumber } from 'charturbo';

const sdk = await Charturbo.create(canvas, { locale: 'en-US' });
sdk.renderLineChart(series, {
  axes: {
    x: { format: ',d' },
    y: { format: '.2s' },
    y2: { format: { style: 'percent' } },
  },
});
sdk.enableNodeInteractions(canvas, { tooltip: { valueFormatter: '$,.2f' } });
sdk.render();

formatNumber(1234.5, '$,.2f');                               // "$1,234.50"
formatNumber(1234.5, '$,.2f', 'de-DE', { currency: 'EUR' }); // "1.234,50 €"
const fmt = createFormatter('bytes', { locale: 'ko-KR' });   // (v) => string, reusable
fmt(1536);                                                   // "1.5 KB"
```

## Where formats apply

| Option | Accepts |
|---|---|
| `axes.x.format`, `axes.y.format`, `axes.y2.format` | function, spec string, `Intl.NumberFormatOptions` |
| Bar `labels.format` | `(value, ctx) => string`, spec string, `Intl.NumberFormatOptions` |
| `enableNodeInteractions({ tooltip: { valueFormatter } })` | `(v) => string`, spec string, `Intl.NumberFormatOptions` |
| Pie `format`, heatmap colorbar `format` | function only |

A spec string compiles once into an `Intl.NumberFormat` for the chart locale and is cached. After `setLocale`, ticks are redrawn with the new locale.

## Spec syntax

`[sign][$][,][.precision][~][type]`

| Spec | Example (en-US) | Description |
|---|---|---|
| `'.2f'`, `',.0f'` | `1234.57`, `1,234,568` | Fixed point; `,` adds thousands separators |
| `'d'`, `',d'` | `4`, `12,345` | Integer (rounded) |
| `'.1%'` | `12.3%` | Percent (× 100) |
| `'.2s'` | `1.5k`, `1.2M`, `1.2m` | SI prefix (significant digits; rounding may carry to the next prefix) |
| `'.2e'` | `1.23e+4` | Exponent |
| `'$,.2f'` | `$1,234.50` | Currency (`Intl` `style: 'currency'`, code from the `currency` option, default `USD`) |
| `'compact'`, `'.1compact'` | `1.5K`, `2M` | `Intl` compact notation |
| `'bytes'`, `'.2bytes'` | `1.5 KB`, `1.50 KB` | 1024-based units (B, KB, MB, GB, TB, PB, EB) |
| `'+.1f'` | `+1.3`, `-2.0`, `0.0` | Sign on positive and negative values (zero unsigned) |

- `sign`: `+` shows the sign on positive and negative values; `-` (default) only on negative values.
- `$` works with no type, `f`, `d`, or `compact`.
- `.precision` is fraction digits for `f`, `%`, `e`, `compact`, and `bytes`, and significant digits for `s` and no type.
- `~` trims insignificant trailing zeros (`'.3~s'` gives `1.5k`).
- Missing precision defaults to 6 like d3-format (`d`: 0, `compact`: the `Intl` default, `bytes`: 1). Without a type, the locale's default number format is used.
- An invalid spec throws a `TypeError` when the chart renders.

## Helper functions

| Function | Description |
|---|---|
| `formatNumber(value, spec, locale?, { currency? })` | Formats one value |
| `createFormatter(spec, options?)` | Returns a reusable `(value) => string`; `options` is a locale string or `{ locale, currency }`. A function `spec` is returned as is |

## Locale

The locale of default labels and tooltip values is resolved in this order:

1. the chart's `locale` option (line, area, candlestick, and other charts that take it),
2. the SDK locale: `Charturbo.create(canvas, { locale })` or `sdk.setLocale(locale)`,
3. the runtime (browser) locale.

```ts
const sdk = await Charturbo.create(canvas, { locale: 'ko-KR' });
sdk.setLocale('de-DE'); // re-formats tick labels and tooltip numbers of the active chart
sdk.getLocale();        // 'de-DE'
sdk.setLocale(undefined); // back to the runtime locale
```

Built-in UI text (accessibility summaries, data table headers, tooltip field labels, export / legend / navigator text) follows the same locale: en, ko, and zh-CN are included, unknown locales fall back to English, and `undefined` uses the browser language. See [Internationalization](./i18n).

## Date and time labels

On a `'time'` x axis the default tick label depends on the calendar boundary the tick lands on (`ChartTimeGranularity`), formatted with `Intl.DateTimeFormat` in the chart locale and time zone:

| Granularity | Label |
|---|---|
| `'millisecond'` | `HH:mm:ss.SSS` |
| `'second'` | `HH:mm:ss` |
| `'minute'`, `'hour'` | `HH:mm` |
| `'day'` | `MMM d` |
| `'month'` | `MMM` |
| `'year'` | `yyyy` |

Tooltips show the full date and time (date only at local midnight, milliseconds only when present).

To customize, pass a function. Ticks receive the granularity; the tooltip calls it without one:

```ts
import { formatChartTime } from 'charturbo';

sdk.renderLineChart(series, {
  axes: {
    x: {
      type: 'time',
      format: (ms, granularity) =>
        granularity === 'day' ? new Date(ms).toISOString().slice(5, 10) : formatChartTime(ms, granularity, 'en-GB', 'UTC'),
    },
  },
});

formatChartTime(Date.UTC(2026, 0, 1, 9), 'hour', 'ko-KR', 'Asia/Seoul'); // default label of one value
```

`formatChartTime(ms, granularity?, locale?, timeZone = 'UTC')` is a pure function: its time zone defaults to `'UTC'`, not to the chart zone. Time zones are covered in [Data & Axes](./data-and-axes#time-zones).

::: warning
A spec string on a time axis formats the epoch milliseconds as a plain number. For date labels, use a function or the default format.
:::

## See also

- [Data & Axes](./data-and-axes)
- [Tooltips & Hover](./tooltips)
- [Internationalization](./i18n)
- [Bar](../charts/bar): data labels
