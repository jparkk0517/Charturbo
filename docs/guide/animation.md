# Animation

Opt-in enter and update animations: lines reveal from left to right, bars grow from the baseline, points and pie slices fade and scale in, and data updates tween to the new values. Animations are off by default; the engine interpolates its staged GPU marks in Rust, so they stay cheap on large data.

[Live example](https://jparkk0517.github.io/Charturbo/animation.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const sdk = await Charturbo.create(canvas, { animation: { duration: 600, easing: 'ease-out' } });

const categories = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const random = () => categories.map(() => 20 + Math.round(Math.random() * 80));
function draw() {
  sdk.renderGroupedBarChart(
    { categories, series: [{ name: 'This week', values: random() }, { name: 'Last week', values: random() }] },
    { title: 'Orders per day' }
  );
  sdk.render();
}

draw();                                                  // first render: bars grow from the baseline
document.querySelector('button')!.onclick = draw;        // same shape: bar heights tween
```

## Settings

An animation setting is `true` (400 ms, `'ease-out'`), `false` (off), or an options object:

| Option | Type | Default | Description |
|---|---|---|---|
| `duration` | `number` | `400` | Duration in ms. Must be a finite number ≥ 0; `0` turns animation off. |
| `easing` | `'linear' \| 'ease-out' \| 'ease-in-out' \| 'ease-in'` | `'ease-out'` | Timing curve. |

A bad value throws at the call site: `animation: duration must be a finite number >= 0 (got …)` or `animation: unknown easing '…'`.

Set it in three places; the most specific one wins:

```ts
const sdk = await Charturbo.create(canvas, { animation: true }); // SDK-wide, at creation
sdk.setAnimation({ duration: 900, easing: 'ease-in-out' });    // SDK-wide, later
sdk.renderBarChart(items, { animation: false });               // this chart only
```

- `setAnimation` applies to the current chart and every chart rendered after it.
- The per-chart `animation` option exists on line, area, bar, grouped bar, scatter, candlestick, OHLC, pie and box plot charts. Band, error bar and impulse charts do not take it.

## Methods

| Method | Description |
|---|---|
| `setAnimation(animation)` | SDK-wide setting: `true` / `false` / `{ duration, easing }`. |
| `getAnimation()` | The resolved SDK-wide setting (`{ duration, easing }`), or `null` when off. |
| `isAnimating()` | `true` while a chart animation runs. |
| `finishAnimation()` | Jumps a running animation to its final frame. Call `render()` to show it. |

## Enter

When a chart is first rendered, or rendered with a different kind:

| Marks | Enter effect |
|---|---|
| Line, area, candlestick | Revealed from left to right through a scissor (clip) rectangle; the geometry does not change. |
| Bars | Grow from the 0 baseline. Stacked bars grow as a whole stack. |
| Scatter points, pie slices | Fade and scale in. |
| Other marks (box plot, ...) | Fade in. |

## Update

An update animation runs after `setSeriesData`, or when a chart is re-rendered with the same kind and the same shape (each layer has the same number of staged instances):

```ts
sdk.setSeriesData(0, next);
sdk.render(); // y values tween from the previous frame
```

- The engine interpolates each staged instance of the previous frame element by element: line vertices (y values), bar rectangles (heights), scatter centers. Pie charts interpolate slice angles and re-tessellate.
- A layer whose shape changed snaps to its final values; a different chart kind plays the enter animation.
- Axes and ticks move to the new domain immediately.

## Cost

- Interpolation runs in Rust over the staged marks only, after level-of-detail reduction: O(visible). A 1M-point line only interpolates the few thousand vertices left after M4 decimation.
- When the staged marks exceed 50,000 (for example a 1M-point scatter), the animation is skipped.
- `requestAnimationFrame` runs only while an animation is in progress; there is no idle loop. Without `requestAnimationFrame`, or in a hidden tab, the final frame is shown immediately.

## Notes

- `prefers-reduced-motion: reduce` turns animations off.
- Because animations are off by default, visual regression fixtures stay deterministic.
- Image, SVG and PDF [exports](./export) always show the final frame.

## See also

- [Real-time Streaming](./streaming)
- [Export: PNG · SVG · PDF](./export)
- [Accessibility](./accessibility)
- [Performance](./performance)
