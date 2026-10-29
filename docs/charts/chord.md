# Chord Diagram

`renderChordChart` draws flows between groups as a circle. Each group gets an outer arc sized by its total flow, and ribbons connect pairs of groups with widths set by the flow in each direction. The layout is the d3 `chord()` layout (`chordDirected()` when `directed`). Use it for migration, trade, transfers between teams, or any square "from → to" matrix.

[Live example](https://jparkk0517.github.io/Charturbo/hierarchy.html#07-chord)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderChordChart(
  {
    names: ['Black', 'Blond', 'Brown', 'Red'],
    matrix: [
      [11975, 5871, 8916, 2868],
      [1951, 10048, 2060, 6171],
      [8010, 16145, 8090, 8045],
      [1013, 990, 940, 6907],
    ],
  },
  { title: 'Hair color preferences', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderChordChart(data: ChordChartData, options?: ChordChartOptions): { groupCount: number; chordCount: number }
```

## Data format

```ts
type ChordChartData =
  | { matrix: ArrayLike<ArrayLike<number>>; names?: string[] }
  | { nodes: (string | ChordNode)[]; links: ChordLink[] };

interface ChordNode { name: string; color?: ColorInput }
interface ChordLink { source: string | number; target: string | number; value: number }
```

- `matrix[i][j]` is the flow from group `i` to group `j`. The matrix must be square, with 1 to 256 groups. Values must be finite and `>= 0`, and at least one must be above zero. The diagonal (flow from a group to itself) is drawn as a self ribbon.
- `names` gives one name per row. Without it, groups are named `Group 1`, `Group 2`, ….
- ECharts-style `nodes` / `links`: a link names its source and target by node name or index. Repeated links add up. Unknown or duplicate nodes throw.
- The input is validated before the current chart is replaced. If it throws, the previous chart stays.

## Directed chords

By default (d3 `chord()`), each pair of groups shares one ribbon. Its two ends have the widths of the two directions, and the larger direction is its source. `directed: true` uses d3 `chordDirected()` instead: one ribbon per direction, with an arrow tip at the target.

```ts
sdk.renderChordChart(
  {
    nodes: ['Asia', 'Europe', 'Africa'],
    links: [
      { source: 'Asia', target: 'Europe', value: 14 },
      { source: 'Europe', target: 'Asia', value: 4 },
      { source: 'Africa', target: 'Europe', value: 9 },
    ],
  },
  { directed: true, ribbonColor: 'gradient', labelRotate: true }
);
```

[Live example](https://jparkk0517.github.io/Charturbo/hierarchy.html#08-chord-directed)

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `padAngle` | `number` | `3` | Gap between groups in degrees. `n * padAngle` must be below 360. |
| `startAngle` | `number` | `0` | Where the first group starts, in degrees clockwise from 12 o'clock. |
| `clockwise` | `boolean` | `true` | Groups run clockwise. |
| `sortGroups` | `'none' \| 'ascending' \| 'descending'` | `'none'` | Group order by total. |
| `sortSubgroups` | `ChordSortOrder` | `'none'` | Order of each group's ribbons along its arc, by value. |
| `sortChords` | `ChordSortOrder` | `'none'` | Draw order of the ribbons, by the sum of their two values. |
| `directed` | `boolean` | `false` | One ribbon per direction, with arrow tips. |
| `ribbonColor` | `'source' \| 'target' \| 'gradient' \| 'neutral'` | `'source'` | Ribbon color: the source group, the target group, a gradient from source to target, or the neutral theme color. |
| `ribbonOpacity` | `number` | `0.6` | Ribbon opacity, 0 to 1. |
| `arcWidth` | `number` | `14` | Group arc width in CSS px. |
| `labels` | `boolean` | `true` | Group names outside the ring. |
| `labelRotate` | `boolean` | `false` | Names read along the radius instead of level. |
| `colors` | `(ColorInput \| undefined)[]` | | Color per group. Without it: the node `color`, then the palette. |
| `palette` | `ColorInput[]` | theme palette | Colors of groups without their own color. |
| `legend` | `boolean \| ChartLegendOptions` | shown for 2+ groups | Group legend. Hover emphasizes a group, click hides it. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `format` | `ChartValueFormat` | locale number | Value text of tooltip and accessibility. See [Number & Date Formats](../guide/number-format). |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

Invalid options throw: a negative or too large `padAngle`, a non-finite `startAngle`, `ribbonOpacity` outside 0 to 1, `arcWidth` below 1, and unknown sort or `ribbonColor` values.

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on.

- Hovering a group arc emphasizes its ribbons, dims the others and shows the group total.
- Hovering a ribbon shows the flow `source → target` and, if there is one, the reverse flow.
- The legend emphasizes a group on hover. A click hides the group and lays the circle out again; with `animation` on, the arcs and ribbons tween to the new layout.
- Brush, zoom and pan are disabled.

Data point ids: group `i` is `i`, and the ribbon from `s` to `t` is `n + s * n + t`.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'chord'
// ctx.chord = { kind: 'group' | 'ribbon', source, target, sourceName, targetName, value, reverse? }
// group: source === target, value = total; ribbon: value = source → target, reverse = target → source
```

## Notes

- The layout, arcs, ribbons, arrow tips, hit testing, emphasis and label anchors are computed in the engine (Rust). Arcs and ribbons are vector marks, so `exportChartSVG` writes them as SVG paths.
- Accessibility: the summary gives the number of groups and chords and the largest flows. The data table and `exportChartCSV` contain the flow matrix (rows = from, columns = to). Keys: Left / Right move between groups or between chords, Down goes from a group to its first chord, Up goes from a chord to its source group, Home / End jump to the first / last item, and Escape clears. See [Accessibility](../guide/accessibility).
- Label width is estimated (about 6.8 px per character of 11 px text). Very long names are shortened with `…`.
- React / Vue: `type="chord"`.

## See also

- [Sankey](./sankey)
- [Tree](./tree)
- [Tooltips & Hover](../guide/tooltips)
