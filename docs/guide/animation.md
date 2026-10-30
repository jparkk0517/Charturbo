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
| `transition` | `boolean` | `false` | Morph into the next chart of a paired kind (bar ↔ pie, treemap ↔ sunburst). See [Transitions](#transitions). |

A bad value throws at the call site: `animation: duration must be a finite number >= 0 (got …)` or `animation: unknown easing '…'`.

Set it in three places; the most specific one wins:

```ts
const sdk = await Charturbo.create(canvas, { animation: true }); // SDK-wide, at creation
sdk.setAnimation({ duration: 900, easing: 'ease-in-out' });    // SDK-wide, later
sdk.renderBarChart(items, { animation: false });               // this chart only
```

- `setAnimation` applies to the current chart and every chart rendered after it.
- The per-chart `animation` option exists on line, area, bar, grouped bar, scatter, candlestick, OHLC, pie, box plot, treemap and sunburst charts. Band, error bar and impulse charts do not take it.

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

## Bar race

`realtimeSort` on `renderBarChart` (horizontal or vertical) sorts the bars by value, largest first, on every render. With animation on, each bar tweens from the slot its *label* had in the previous chart, not from its index, so a year-by-year re-render becomes a race:

```ts
const draw = (year: number) => {
  sdk.renderBarChart(rows(year), {
    title: `Users, ${year}`,
    orientation: 'horizontal',
    labels: true,
    realtimeSort: { max: 8 },                     // keep the top 8
    animation: { duration: 900, easing: 'linear' },
  });
  sdk.render();
};
setInterval(() => draw(++year), 1000);
```

| Option | Type | Default | Description |
|---|---|---|---|
| `realtimeSort` | `boolean \| { max?, valueAnimation? }` | off | `true` sorts all bars. |
| `realtimeSort.max` | `number` | all | Keep the N largest bars (integer ≥ 1). |
| `realtimeSort.valueAnimation` | `boolean` | `true` | Value labels count up from the previous value of the same label. |

- Bars are matched by label. A label that enters slides in from one slot past the last bar and fades in; a label that drops out slides out there and fades out.
- Category labels and value labels ride with their bars. The value axis moves to the new domain immediately.
- The keyed tween runs on 2D bar charts; with `viewMode: '3d'` the bars are only sorted and trimmed. Without `realtimeSort`, bars keep the data order and tween by index, as before.

## Line race

`endLabel` on `renderLineChart` pins a label with the series name and its last value to the end of each line. During the left-to-right reveal it follows the reveal front, so a long `duration` makes the lines race:

```ts
sdk.renderLineChart(series, {
  legend: false,
  endLabel: true,                                  // or { format: (value, name) => `${name}: ${value}` }
  animation: { duration: 4000, easing: 'linear' },
});
```

- The default text is `name value`, with the value in the y-axis format. The right padding grows to fit the labels.
- 2D line charts only; area charts do not take `endLabel`.

## Transitions

With `transition: true` in the animation setting, re-rendering the same data as the paired kind morphs mark by mark instead of playing the enter animation:

```ts
const animation = { duration: 800, transition: true };
sdk.renderBarChart(labels.map((label, i) => ({ label, value: values[i] })), { animation });
sdk.render();
sdk.renderPieChart({ labels, values }, { animation }); // each bar morphs into its slice
sdk.render();
```

| From ↔ to | Marks are matched by |
|---|---|
| Bar ↔ pie | Category label = slice label. |
| Treemap ↔ sunburst | Node path (names from the root). |

- Each mark becomes a polygon with an inner and an outer edge of 24 points (bar: base → value end; slice or arc: inner arc → outer arc; treemap cell: bottom → top). A rectangle and a ring sector share that shape, so the engine only interpolates the two edges point by point in Rust: no resampling, matching search or re-triangulation per frame, and every frame is a valid shape.
- A mark without a partner fades in or out in place.
- While the morph runs, marks have no rounded corners or anti-aliased outlines, and data labels and axes are already at their final layout.
- Charts with more than 2,000 marks do not morph; they play the enter animation.
- Other kind changes, and `transition: false` (the default), behave as before.

### During races and transitions

- Hover, click and tooltips hit-test the final layout, not the moving marks.
- Accessibility (the screen reader summary and the data table) describes the final data; count-up labels are visual only.
- `prefers-reduced-motion: reduce` turns the tweens, count-up and morphs off: the chart shows its final, sorted state.

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
