# Gauge

`renderGauge` draws a single value on an arc between `min` and `max`, with optional threshold bands and a needle or progress indicator. Use it for one live metric against known ranges, such as CPU load or an SLA target.

[Live example](https://jparkk0517.github.io/Charturbo/business.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGauge(
  { value: 72 },
  {
    title: 'CPU load',
    min: 0,
    max: 100,
    label: 'CPU',
    format: '.0f',
    bands: [
      { from: 0, to: 60, status: 'good' },
      { from: 60, to: 85, status: 'warning' },
      { from: 85, to: 100, status: 'critical', label: 'Overload' },
    ],
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderGauge(data: GaugeChartData, options?: GaugeChartOptions): { bandCount: number }
```

## Data format

```ts
interface GaugeChartData {
  value: number; // NaN = no value; values outside [min, max] pin to the ends
}
```

An invalid range or band throws.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `min` | `number` | `0` | Start of the range. |
| `max` | `number` | `100` | End of the range. |
| `bands` | `GaugeBandOptions[]` | | Threshold ranges in value units. Clipped to the range; where bands overlap, the one starting later wins. |
| `indicator` | `'needle' \| 'progress'` | `'needle'` with bands, else `'progress'` | Needle, or an arc filled up to the value. |
| `startAngle` | `number` | `-120` | Arc start in degrees clockwise from 12 o'clock. |
| `endAngle` | `number` | `120` | Arc end in degrees clockwise from 12 o'clock. |
| `thickness` | `number` | `0.2` | Ring thickness as a fraction of the radius. |
| `bandLabels` | `boolean` | `true` when a band has a `label` or `status` | Labels beside the bands. |
| `showMinMax` | `boolean` | `true` | Min / max labels at the arc ends. |
| `label` | `string` | | Caption under the value (unit or metric name). |
| `trackColor` | `ColorInput` | theme grid color | Unfilled arc color. |
| `color` | `ColorInput` | first palette color | Progress color when the value is in no band. |
| `needleColor` | `ColorInput` | theme primary text color | Needle color. |
| `format` | `ChartValueFormat` | locale number | Value, min and max text (spec, `Intl` options or function). See [Number & Date Formats](../guide/number-format). |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the value in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

The gauge has no legend.

### Bands

```ts
interface GaugeBandOptions {
  from: number;
  to: number;
  status?: 'good' | 'warning' | 'serious' | 'critical'; // reserved status color + icon + label
  color?: ColorInput;  // default: the status color, else the theme palette slot
  label?: string;      // beside the band and in tooltips (default: the status name)
}
```

Status colors are reserved and do not follow the theme. Each status is always shown with an icon and a label, so color never carries the meaning alone.

| Status | Color | Icon | Default label |
| --- | --- | --- | --- |
| `good` | `#0ca30c` | ✓ | Good (localized) |
| `warning` | `#fab219` | ▲ | Warning (localized) |
| `serious` | `#ec835a` | ◆ | Serious (localized) |
| `critical` | `#d03b3b` | ✖ | Critical (localized) |

A band with `color` and no `status` is a plain band.

## Updating the value

```ts
setGaugeValue(value: number): boolean
```

`setGaugeValue` moves the current gauge to a new value. The band geometry and label layout are kept; only the needle (or the progress arc) and the center value text change. Call `render()` afterwards. It returns `false` when no gauge is rendered or the value is infinite.

```ts
setInterval(() => {
  sdk.setGaugeValue(Math.random() * 100);
  sdk.render();
}, 1000);
```

The change is not animated.

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. Hovering the ring shows the band under the pointer; hovering inside shows the value. Brush, zoom and pan are disabled.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'gauge'
// ctx.index: 0 = value, 1 + k = band k (bands sorted by `from`)
// ctx.gauge = { value, min, max, band?: { label, from, to, status? } }
```

Data point ids: `0` = value, `1 + k` = band `k` in drawing order.

## Notes

- Arc, band and track tessellation (2 px gaps between bands, anti-aliased edges), band clipping and ordering, the band of the value, the needle, hit testing and label anchors are computed in the engine (Rust).
- Accessibility: summary (value, status, range), a data table (value, then From–To per band), left / right arrows move from the value through the bands. See [Accessibility](../guide/accessibility).

## See also

- [Radar](./radar)
- [Real-time Streaming](../guide/streaming)
- [Tooltips & Hover](../guide/tooltips)
- [Number & Date Formats](../guide/number-format)
