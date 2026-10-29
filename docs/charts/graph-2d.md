# 2D Graph

`renderGraph` draws a network of nodes and links in the plane, like the ECharts `graph` series. The nodes can be placed by a force layout, on a circle, at given positions, or on cartesian axes. Categories color the nodes and fill a legend. Use it for relationship maps, dependency graphs and small social networks. For large 3D networks (thousands of nodes, orbit camera) see [3D Network Graph](./graph-3d).

[Live example](https://jparkk0517.github.io/Charturbo/graph.html#04-graph-force-2d)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

sdk.renderGraph(
  {
    nodes: [
      { id: 'api', name: 'API', value: 12, category: 'Service' },
      { id: 'db', name: 'Database', value: 30, category: 'Storage' },
      { id: 'web', name: 'Web', value: 8, category: 'Service' },
    ],
    links: [
      { source: 'web', target: 'api' },
      { source: 'api', target: 'db', lineWidth: 3 },
    ],
  },
  { title: 'Services', layout: 'force', symbolSize: [10, 24], edgeSymbol: 'arrow' }
);
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signature:

```ts
renderGraph(data: GraphChartData, options?: GraphChartOptions): { nodeCount: number; linkCount: number }
```

## Data format

```ts
interface GraphChartData {
  nodes: GraphNodeInput[];
  links?: GraphLinkInput[];
  edges?: GraphLinkInput[];             // alias of links (ECharts)
  categories?: (GraphCategoryInput | string)[];
}

interface GraphNodeInput {
  id?: string | number;   // link key (default: the name, then the index)
  name?: string;
  value?: number;         // tooltip, circular slice size, symbolSize [min, max]
  x?: number | string;    // layout 'none' / 'cartesian' (required there); force: start position
  y?: number;
  category?: number | string; // index into categories, or a category name
  symbolSize?: number;    // diameter in CSS px (overrides the option)
  fixed?: boolean;        // force: stay at x / y
  color?: ColorInput;
}

interface GraphLinkInput {
  source: string | number; // node id, name, or index
  target: string | number;
  value?: number;
  lineWidth?: number;      // CSS px (default: the lineWidth option)
}

interface GraphCategoryInput { name: string; color?: ColorInput }
```

- Link ends resolve by `id`, then by `name`, then as a node index.
- A category name that is not in `categories` is appended to the list. Numeric categories without a `categories` list get default names (`Category 1`, …, localized).
- Invalid input throws before the current chart is replaced, so a failed call keeps the chart on screen. Errors name the node or link: an empty node list, an unknown link end, a category out of range, a non-finite value, a missing `x` / `y` with `layout: 'none'` or `'cartesian'`, an `x` name that is not an axis category.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `layout` | `'force' \| 'circular' \| 'none' \| 'cartesian'` | `'force'` | How nodes are placed (see Layouts). |
| `force` | `{ repulsion?, edgeLength?, gravity?, iterations? }` | `50, 30, 0.1, 300` | Force layout parameters. |
| `rotateLabel` | `boolean` | `false` | Circular: labels run outward along the radius. |
| `symbol` | `'circle' \| 'rect' \| 'diamond' \| 'triangle'` | `'circle'` | Node symbol. |
| `symbolSize` | `number \| [min, max]` | `10` | Diameter in CSS px, or scaled linearly by `value`. |
| `lineWidth` | `number` | `1` | Edge width in CSS px. |
| `curveness` | `number` | `0` | Edge bend (0 = straight). |
| `edgeSymbol` | `'none' \| 'arrow'` | `'none'` | `'arrow'`: arrowheads at the targets. |
| `edgeSymbolSize` | `number` | `8` | Arrow length in CSS px. |
| `edgeColor` | `'neutral' \| 'source' \| 'target'` | `'neutral'` | Edge color: neutral gray, or the source / target node color. |
| `edgeOpacity` | `number` | `1` (neutral), `0.6` (source / target) | Edge opacity, 0–1. |
| `xAxis` | `{ min?, max?, title?, format?, categories? }` | | Cartesian x axis. `categories` makes a category axis. |
| `yAxis` | `{ min?, max?, title?, format? }` | | Cartesian y axis. |
| `legend` | `ChartLegendOptions \| boolean` | shown with categories | Category legend: click hides a category, hover emphasizes it. |
| `colors` | `ColorInput[]` | theme palette | Category palette. A category `color` wins over its slot. |
| `labels` | `boolean` | `true` | Node names (overlapping labels are dropped, at most 1,500). |
| `format` | `ChartValueFormat` | locale number | Value text of the tooltip and accessibility; also the cartesian y ticks unless `yAxis.format` is given. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

## Layouts

- `force`: the Barnes-Hut force simulation of the [3D network graph](./graph-3d), run in Rust in the plane until it settles, then fitted to the plot. The start is a deterministic spiral, so the same data gives the same picture. Nodes with `fixed: true` and `x` / `y` stay where they are.
- `circular`: nodes on a ring in input order. When every node has a value ≥ 0 and they sum above 0, each node gets a slice of the ring in proportion to its value (a zero value gets no room); otherwise the spacing is even. `rotateLabel` turns the labels outward.
- `none`: the given `x` / `y` (y down, like screen coordinates), fitted to the plot.
- `cartesian`: the given `x` / `y` on chart axes with gridlines (y up). `xAxis.categories` turns x into a category axis: nodes give `x` as a category name or index.

```ts
sdk.renderGraph(data, { layout: 'circular', rotateLabel: true, curveness: 0.3, edgeColor: 'source' });
sdk.renderGraph(data, { layout: 'cartesian', xAxis: { categories: ['Q1', 'Q2', 'Q3', 'Q4'] }, yAxis: { min: 0 } });
```

[Circular example](https://jparkk0517.github.io/Charturbo/graph.html#05-graph-circular) · [Cartesian example](https://jparkk0517.github.io/Charturbo/graph.html#06-graph-cartesian)

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. Hovering a node highlights it, its links and its neighbors, and fades the rest. The legend toggles and emphasizes categories (`setSeriesVisible(k, visible)` does the same in code); links to a hidden node are hidden too. Brush, zoom and pan are off.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'graph'
// ctx.hierarchy = { node, name, path: [category, name], value, children: <link count> }
// ctx.details.metadata.attributes = { name, category, value, links }
```

React and Vue: `<CharturboChart type="graph" data={...} options={...} />`.

## Notes

- Accessibility: summary (node, category and link counts, the most linked nodes), a data table (node, category, value, links, linked to). Keyboard: Up / Down walk the nodes in input order, Right / Left jump to the next / previous linked node, Home / End. See [Accessibility](../guide/accessibility).
- CSV and SVG export include the graph.
- Not supported yet: dragging nodes (pin with `fixed` instead), self loops, edge hover, animated force settling.

## See also

- [3D Network Graph](./graph-3d)
- [Tree](./tree)
- [Sankey](./sankey)
