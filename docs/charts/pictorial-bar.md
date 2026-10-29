# Pictorial Bar

`renderPictorialBarChart` draws a bar chart whose bars are symbols (ECharts `pictorialBar`): built-in shapes or SVG paths, stretched over each bar or repeated along it, optionally clipped at the value. Everything else is a 2D [bar chart](./bar): axes, orientation, grouped / stacked / percent series, labels, hover, legend and accessibility.

[Live example](https://jparkk0517.github.io/Charturbo/bar.html#06-pictorial)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderPictorialBarChart(
  [
    { label: 'Mon', value: 72 },
    { label: 'Tue', value: 45 },
    { label: 'Wed', value: 90 },
  ],
  {
    background: true,
    symbol: 'roundRect',
    symbolRepeat: 'fixed',
    symbolClip: true,
    symbolBoundingData: 100,
    symbolSize: ['70%', 10],
    symbolMargin: 2,
  }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderPictorialBarChart(
  data: PictorialBarItem[] | PictorialBarChartData,
  options?: PictorialBarChartOptions
): { barCount: number }
```

## Data format

The data is the same as for bars: an item array (`renderBarChart`) or `{ categories, series }` (`renderGroupedBarChart`). Items and series also take the symbol options below. The most specific setting wins: item, then series, then chart options.

```ts
sdk.renderPictorialBarChart([
  { label: 'Likes', value: 40, symbol: 'path://M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z' },
  { label: 'Churn', value: -20, symbol: 'arrow' },
]);
```

## Options

`PictorialBarChartOptions` takes every [bar chart option](./bar#options) (2D only), plus these symbol options:

| Option | Type | Default | Description |
|---|---|---|---|
| `symbol` | `'circle' \| 'rect' \| 'roundRect' \| 'square' \| 'triangle' \| 'diamond' \| 'arrow' \| 'pin' \| 'none' \| 'path://…'` | `'circle'` | The shape. `path://` takes SVG path data (`M L H V C S Q T A Z`, absolute and relative, nonzero fill); it is scaled to the symbol box, so its aspect ratio is not kept. |
| `symbolSize` | `number \| '50%' \| [w, h]` | `['100%', '100%']` | Symbol size on screen. Across the bar, percents are of the bar thickness. Along the bar, they are of the bar length (or of the `symbolBoundingData` length), or of the bar thickness when repeating. |
| `symbolRepeat` | `boolean \| number \| 'fixed'` | `false` | `false`: one symbol. `true`: repeated over the bar length. A number: that many. `'fixed'`: as many as fit the bounding length, whatever the value. |
| `symbolMargin` | `number \| '15%'`, optionally with `!` | `'15%'` | Gap on each side of a repeated symbol, px or percent of its size along the bar. The gaps are spread so the run fills its length. A trailing `!` (`'10%!'`) also keeps gaps at both ends. |
| `symbolClip` | `boolean` | `false` | Clip the symbols at the data value. With `'fixed'` or `symbolBoundingData` this gives a "fill level" look. |
| `symbolPosition` | `'start' \| 'end' \| 'center'` | `'start'` | Where a single symbol or the repeated run sits along the bar. |
| `symbolOffset` | `number \| '50%' \| [x, y]` | `0` | Screen offset (right, down), px or percent of the symbol size. |
| `symbolRotate` | `number` | `0` | Rotation in degrees, positive = anticlockwise. |
| `symbolBoundingData` | `number \| [negative, positive]` | none | Lay the symbols out against this value instead of the bar value. With a pair, negative bars use the first and positive bars the second. |

- Bars with a negative value point the other way, and the symbols are mirrored with them.
- `background` (see [Background tracks](./bar#background-tracks)) draws the shadow bars behind the symbols.
- Invalid symbol options, `image://` symbols and `viewMode: '3d'` throw before the current chart is replaced.

## Horizontal bars

```ts
sdk.renderPictorialBarChart(items, {
  orientation: 'horizontal',
  symbol: 'path://M12 2a3 3 0 1 1 0 6a3 3 0 1 1 0-6zM8 9h8a2 2 0 0 1 2 2v5h-2.5v7h-7v-7H6v-5a2 2 0 0 1 2-2z',
  symbolRepeat: true,
  symbolClip: true,
  symbolSize: [16, '80%'],
  symbolMargin: '10%',
});
```

"Along the bar" is then the x axis: `symbolSize[0]` is the size along the bar and `symbolSize[1]` the size across it.

## Hover and animation

- Hover and tooltips work as for bars. The hovered bar's symbols get the hover emphasis, and the legend fades the other series.
- Re-rendering animates the symbols from the old bars to the new ones, and the enter animation grows them from the baseline. Repeated symbols are laid out again on every frame, so a growing bar adds symbols instead of stretching them.

## Accessibility and export

The chart has the bar chart's summary (named "Pictorial bar chart"), data table and keyboard navigation. CSV export lists the bar values, and SVG export writes the symbols as vector paths. React and Vue components take `type: 'pictorialBar'` with `data` and `options`.

## Limitations

- `image://` symbols are not supported.
- No `symbolKeepAspect`, `symbolPatternSize` or overlapping series (`barGap: '-100%'`).
- 2D only. Histograms, waterfall and combo charts are not pictorial.

## See also

- [Bar](./bar)
- [Histogram](./histogram)
