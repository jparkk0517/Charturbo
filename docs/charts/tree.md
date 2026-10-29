# Tree

`renderTree` draws a hierarchy as a node-link diagram: the tidy tree layout of d3 `tree()`, either orthogonal (left to right, right to left, top to bottom, bottom to top) or radial. Parents expand and collapse on click or keyboard, and the tree re-lays out with a tween. Use it for org charts, file trees, taxonomies and decision trees, where the structure matters more than the values.

[Live example](https://jparkk0517.github.io/Charturbo/hierarchy.html#05-tree)

## Basic usage

```ts
import { Charturbo, type TreeChartNode } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { animation: { duration: 450 } });

const tree: TreeChartNode = {
  name: 'charturbo',
  children: [
    { name: 'core', children: [{ name: 'chart' }, { name: 'scene' }, { name: 'graph' }] },
    { name: 'sdk', children: [{ name: 'charturbo.ts' }, { name: 'messages', collapsed: true, children: [{ name: 'en' }, { name: 'ko' }] }] },
    { name: 'react' },
  ],
};
sdk.renderTree(tree, { title: 'Package layout', initialTreeDepth: 2 });
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signatures:

```ts
renderTree(data: TreeChartData, options?: TreeChartOptions): { nodeCount: number }
setTreeNodeExpanded(target: number | string, expanded: boolean): boolean
toggleTreeNode(target: number | string): boolean
```

## Data format

The input has the same shapes as [Treemap · Sunburst](./treemap-sunburst): one nested root, or flat rows.

```ts
type TreeChartData = TreeChartNode | TreeChartFlatNode[];

interface TreeChartNode {
  name: string;
  value?: number;            // optional, shown as is (parents do not sum their children)
  children?: TreeChartNode[];
  color?: ColorInput;
  collapsed?: boolean;       // start collapsed (false: start expanded); wins over initialTreeDepth
}

interface TreeChartFlatNode {
  id: string | number;
  parent?: string | number | null; // another row's id (missing / null = a root)
  name?: string;                   // display name (default: the id)
  value?: number;
  color?: ColorInput;
  collapsed?: boolean;
}
```

- Children keep their input order (no sorting by value).
- Flat rows with several roots hang under a synthetic root named `rootLabel` (default `'All'`, localized).
- A cycle throws an error whose message names the nodes on the cycle.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `layout` | `'orthogonal' \| 'radial'` | `'orthogonal'` | `'radial'`: the root in the center, the leaves on the rim. |
| `orient` | `'LR' \| 'RL' \| 'TB' \| 'BT'` | `'LR'` | Orthogonal direction from the root to the leaves. |
| `edgeShape` | `'curve' \| 'polyline'` | `'curve'` | Cubic Bézier or elbow edges. The radial layout always curves. |
| `initialTreeDepth` | `number` | `2` | Levels expanded at first (root = 0, `-1` = all). A node's `collapsed` wins. |
| `expandAndCollapse` | `boolean` | `true` | Click, Enter and Space expand and collapse parents. |
| `symbol` | `'emptyCircle' \| 'circle' \| 'rect' \| 'diamond' \| 'triangle' \| 'none'` | `'emptyCircle'` | Node symbol. With `'emptyCircle'`, collapsed parents are filled. |
| `symbolSize` | `number` | `7` | Symbol diameter in CSS px. |
| `lineWidth` | `number` | `1.5` | Edge width in CSS px. |
| `curvature` | `number` | `0.5` | Bézier control offset, 0–1. |
| `colorBy` | `'single' \| 'group'` | `'single'` | `'group'`: one palette color per top-level branch. |
| `colors` | `ColorInput[]` | theme palette | Palette of `colorBy: 'group'`. |
| `labels` | `boolean` | `true` | Node names. |
| `format` | `ChartValueFormat` | locale number | Value text of the tooltip and accessibility. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `rootLabel` | `string` | `'All'` (localized) | Name of the synthetic root of multi-root flat rows. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

## Layout

- The engine (Rust) runs the Walker / Buchheim tidy tree in O(n), with the d3 separation rule: 1 between siblings, 2 between cousins, divided by depth in the radial layout.
- Only expanded nodes take part in the layout, so collapsing a branch packs the rest of the tree.
- The tree is fitted to the plot. Room for the root and leaf labels is reserved on the outer sides (the radial radius shrinks by the longest leaf label).
- Labels: orthogonal leaves put their name away from the root, parents toward it; TB / BT leaves run vertically. Radial labels rotate outward and flip on the left half so the text stays upright. Labels that would overlap a neighbor are dropped.

```ts
sdk.renderTree(rows, { layout: 'radial', colorBy: 'group', initialTreeDepth: -1 });
sdk.renderTree(tree, { orient: 'TB', edgeShape: 'polyline', symbol: 'rect' });
```

[Live example](https://jparkk0517.github.io/Charturbo/hierarchy.html#06-tree-radial)

## Expand and collapse

- A click on a parent toggles it (leaves do nothing). With `animation` on, nodes and edges tween from the old layout to the new one; a collapsing branch shrinks into its parent.
- `setTreeNodeExpanded(target, expanded)` and `toggleTreeNode(target)` take a node index, a flat row `id` or a node name. They return `false` when nothing changed (a leaf, a hidden node, or not a tree). Call `render()` afterwards; pointer and keyboard toggles render themselves.
- Every toggle emits `'treeToggle'`:

```ts
sdk.on('treeToggle', (e) => console.log(e.name, e.expanded, e.path));
// e: { node: number; id?: string | number; name: string; path: string[]; expanded: boolean }
```

React and Vue: `<CharturboChart type="tree" data={...} options={...} onTreeToggle={...} />` (Vue: `@tree-toggle`).

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on. Hover highlights the node and shows its path, name and value. Brush, zoom and cursor sync are disabled; there is no pan or zoom.

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'tree'
// ctx.xLabel = 'Root › A › a1'
// ctx.hierarchy = { node, name, path, value, depth, ... }   // value NaN when missing
```

## Notes

- Accessibility: summary (node and level counts, shown nodes, the root's children), a data table (path, value, depth, state). Keyboard: Up / Down for siblings, Right for the first child of an expanded node, Left for the parent, Home / End, Enter or Space to expand or collapse. See [Accessibility](../guide/accessibility).
- CSV and SVG export include the tree. Label widths are estimated (about 6.8 px per character of 11 px text), so very long names are shortened with `…`.

## See also

- [Treemap · Sunburst](./treemap-sunburst)
- [Sankey](./sankey)
- [Tooltips & Hover](../guide/tooltips)
