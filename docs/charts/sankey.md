# Sankey

`renderSankey` draws flows between nodes as ribbons whose width is proportional to their value, with nodes arranged in columns. Use it for budgets, energy balances, user journeys and other directed, acyclic flows.

[Live example](https://jparkk0517.github.io/Charturbo/hierarchy.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

const link = (source: string, target: string, value: number) => ({ source, target, value });
sdk.renderSankey(
  {
    nodes: ['Coal', 'Gas', 'Solar', 'Electricity', 'Heat', 'Homes', 'Industry'].map((id) => ({ id })),
    links: [
      link('Coal', 'Electricity', 30), link('Coal', 'Heat', 12),
      link('Gas', 'Electricity', 22), link('Gas', 'Heat', 18),
      link('Solar', 'Electricity', 14),
      link('Electricity', 'Homes', 36), link('Electricity', 'Industry', 30),
      link('Heat', 'Homes', 18), link('Heat', 'Industry', 12),
    ],
  },
  { title: 'Energy (TWh)', format: ',.0f' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderSankey(data: SankeyChartData, options?: SankeyChartOptions): { nodeCount: number; linkCount: number }
```

## Data format

```ts
interface SankeyChartData {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
}

interface SankeyNodeInput {
  id: string | number;
  name?: string;        // display name (default: the id)
  color?: ColorInput;
  group?: string;       // color group (palette in first-appearance order; the legend lists the groups)
  column?: number;      // minimum column (0 = left)
}

interface SankeyLinkInput {
  source: string | number; // node id
  target: string | number; // node id
  value: number;           // finite and >= 0
}
```

- A node's value is the larger of its inflow and outflow.
- `column` is a minimum: a node is always placed to the right of all its sources, and only used columns are kept.
- These inputs throw:
  - a duplicate node id, or a link to an unknown id (`Sankey link 3 has an unknown source "X"`);
  - a negative or non-finite link value;
  - a link from a node to itself, or links that form a cycle (`Sankey links form a cycle: "A" -> "B" -> "A"`);
  - a link between two nodes with explicit `column` that goes to the same or an earlier column.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `nodeWidth` | `number` | `12` | Node bar width in CSS px. |
| `nodePadding` | `number` | `10` | Vertical gap between nodes of a column, in CSS px. |
| `iterations` | `number` | `32` | Relaxation rounds of the layout. |
| `align` | `'justify' \| 'left' \| 'right' \| 'center'` | `'justify'` | Column assignment of nodes without `column`. `'justify'` puts sinks in the last column. |
| `linkColor` | `'source' \| 'target' \| 'neutral'` | `'source'` | Ribbon color. |
| `linkOpacity` | `number` | `0.5` | Ribbon opacity. |
| `colors` | `ColorInput[]` | theme palette | Categorical palette in fixed order. |
| `labels` | `boolean` | `true` | Node labels beside the bars. |
| `format` | `ChartValueFormat` | locale number | Value text of labels, tooltip and accessibility. See [Number & Date Formats](../guide/number-format). |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `legend` | `ChartLegendOptions \| boolean` | shown with 2+ groups | Lists the node groups. Static: no toggle or emphasis. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

## Layout

The layout follows d3-sankey and runs in the engine (Rust):

1. Columns: longest path from the sources, adjusted by `align` or an explicit `column`.
2. Node height is proportional to its value, scaled so the fullest column fits.
3. `iterations` rounds of relaxation move nodes toward the weighted position of their neighbors (right to left, then left to right), followed by collision resolution per column. After the last round, nodes in the same column never overlap.

Links are cubic Bézier ribbons with horizontal tangents at both ends, drawn translucent and thickest first, so thin flows stay visible on top.

## Colors and labels

- Node color: by `group` when groups are given; else one color per node when the nodes fit the palette; else by column (nodes beyond the palette are gray).
- Labels show the name and value: to the right of nodes in the left half, to the left of the others. When two labels in a column are closer than a line, the larger node keeps its label.

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. Hover finds a node first, then a ribbon (top-most first). Only the flows connected to the hovered node or link are highlighted. There is no drill-down. Brush, zoom and cursor sync are disabled.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'sankey'
// ctx.flow = { kind: 'link', source, target, value, percentOfSource }
//          | { kind: 'node', source, value, inflow, outflow }   // node: its name in `source`
```

Data point ids: node index for nodes, node count + link index for links.

## Notes

- One relaxation round costs O(N + L log L), so hub nodes stay cheap.
- Accessibility: summary (node, column and link counts, largest flow), a data table (source, target, value, % of source per link), left / right arrows move between links. See [Accessibility](../guide/accessibility).

## See also

- [Treemap · Sunburst](./treemap-sunburst)
- [Funnel](./funnel)
- [Tooltips & Hover](../guide/tooltips)
- [Styling & Themes](../guide/styling)
