# Treemap · Sunburst

`renderTreemap` draws a hierarchy as nested rectangles (squarified layout); `renderSunburst` draws it as rings, one ring per depth. Both show part-to-whole shares inside a tree and support click drill-down. Use a treemap for many leaves and precise areas, a sunburst when the depth structure matters.

[Live example](https://jparkk0517.github.io/Charturbo/hierarchy.html)

## Basic usage

```ts
import { Charturbo, type HierarchyNode } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas);

// Leaves carry `value`; a parent's value is the sum of its children
const tree: HierarchyNode = {
  name: 'Revenue',
  children: [
    { name: 'Americas', children: [{ name: 'Hardware', value: 420 }, { name: 'Software', value: 310 }] },
    { name: 'Europe', children: [{ name: 'Hardware', value: 260 }, { name: 'Services', value: 180 }] },
  ],
};

sdk.renderTreemap(tree, { title: 'Revenue', format: '$,.0f' });
// or: sdk.renderSunburst(tree, { title: 'Revenue', format: '$,.0f' });
sdk.on('drill', (e) => console.log(e.path.join(' › ')));
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

Signatures:

```ts
renderTreemap(data: HierarchyData, options?: TreemapChartOptions): { nodeCount: number }
renderSunburst(data: HierarchyData, options?: SunburstChartOptions): { nodeCount: number }
drillTo(target: number | string): boolean
drillUp(): boolean
```

## Data format

`HierarchyData` is either one nested root node or an array of flat rows.

```ts
type HierarchyData = HierarchyNode | HierarchyFlatNode[];

// Nested tree
interface HierarchyNode {
  name: string;
  value?: number;              // leaf value, finite and >= 0 (missing = 0; ignored on parents)
  children?: HierarchyNode[];
  color?: ColorInput;          // fill override of this node
}

// Flat rows: `parent` is another row's `id` (missing / null = a root)
interface HierarchyFlatNode {
  id: string | number;
  parent?: string | number | null;
  value?: number;
  name?: string;               // display name (default: the id)
  color?: ColorInput;
}
```

```ts
sdk.renderSunburst([
  { id: 'src', name: 'src' },
  { id: 'sdk', parent: 'src', name: 'sdk' },
  { id: 'core', parent: 'sdk', name: 'charturbo.ts', value: 294 },
  { id: 'a11y', parent: 'sdk', name: 'chart-a11y.ts', value: 79 },
  { id: 'vue', parent: 'src', name: 'vue' },
  { id: 'vc', parent: 'vue', name: 'CharturboChart.ts', value: 3.7 },
], { title: 'Source size (KB)', format: ',.1f' });
```

- Parent values are always the sum of their children; a `value` on a parent is ignored.
- Leaf values must be finite and `>= 0` (`NaN` counts as 0).
- With flat rows, several roots get a synthetic root named `rootLabel` (default `'All'`).
- A cycle throws an error whose message names the nodes on the cycle.
- Children are sorted by value, largest first.

## Options

Shared by both charts (`HierarchyChartOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `colors` | `ColorInput[]` | theme palette | Categorical palette in fixed order. |
| `colorBy` | `'auto' \| 'group' \| 'value'` | `'auto'` | `'group'`: palette per top-level group; groups beyond the palette fold into a neutral "Other" color. `'value'`: colormap of the value, normalized per depth. `'auto'`: group when the top-level groups fit the palette, else value. |
| `colormap` | `'sequential' \| 'viridis' \| 'magma'` | `'sequential'` | Colormap of `colorBy: 'value'`. |
| `format` | `ChartValueFormat` | locale number | Value text of labels, tooltip, center and accessibility (spec like `'$,.0f'`, `Intl` options, or a function). See [Number & Date Formats](../guide/number-format). |
| `labels` | `boolean` | `true` | DOM labels where they fit. |
| `maxDepth` | `number` | `0` (all) | Levels shown below the current root. `0` = all. |
| `legend` | `ChartLegendOptions \| boolean` | shown in group color mode with 2+ groups | Top-level groups. Hover emphasizes a group; there is no toggle. |
| `valueLabel` | `string` | `'Value'` (localized) | Name of the values in the tooltip and data table. |
| `rootLabel` | `string` | `'All'` (localized) | Name of the synthetic root above several roots. |
| `title` | `string` | | Chart title. |
| `description` | `string` | | Accessible name of the canvas. |
| `padding` | `ChartPaddingOptions` | derived | Plot margins in CSS px. |

Treemap only (`TreemapChartOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `innerPadding` | `number` | `2` | Inner padding of parents around their children, in CSS px. |
| `headerHeight` | `number` | `20` | Header strip height of parents, in CSS px. `0` = none. |

`SunburstChartOptions` is the same as `HierarchyChartOptions`.

## Drill-down

Both charts start at the top root and can drill into a subtree:

- **Treemap**: click a cell to drill into the child group of the current root that contains it.
- **Sunburst**: click an arc to drill into it; click the center to go back up.
- The breadcrumb (under the title and legend) and the Escape key go back up.
- Keyboard: Enter drills into the focused node, Escape goes up.

Each drill emits a `'drill'` event:

```ts
interface CharturboDrillEvent {
  kind: 'treemap' | 'sunburst';
  node: number;            // node index (tree input: depth-first order; a synthetic root is last)
  id?: string | number;    // flat input id (tree input: undefined)
  name: string;
  path: string[];          // names from the top root down to `node`
}

const off = sdk.on('drill', (e) => console.log(e.kind, e.path.join(' › ')));
```

Drill from code with `drillTo` and `drillUp`. `drillTo` accepts a node index, a flat input `id`, or a node name (the first match). Both return `false` when nothing changes (for example a leaf, or already at the top). They emit `'drill'`, but do not render: call `render()` afterwards. Pointer, keyboard and breadcrumb drills render by themselves.

```ts
sdk.drillTo('Americas');
sdk.render();
sdk.drillUp();
sdk.render();
```

In React use `onDrill`, in Vue `@drill`. See [React](../guide/react) and [Vue](../guide/vue).

## Interactions

Call `enableNodeInteractions(canvas)` to turn them on.

- Treemap hover outlines the cell under the pointer (headers and padding belong to the parent).
- Sunburst hover highlights the path (ancestors and subtree); other arcs fade toward the surface. The center shows the current root's value and name, or the hovered node and its share.
- Brush, zoom and cursor sync are disabled.
- Data point ids are node indices (tree input: depth-first order; a synthetic root is last).

Tooltip context (see [Tooltips & Hover](../guide/tooltips)):

```ts
// ctx.chartType === 'treemap' | 'sunburst'
// ctx.index = node index
// ctx.hierarchy = { node, name, path, value, percentOfParent, percentOfTotal, depth, children }
// percentOfParent / percentOfTotal: 0-100, NaN for the root; children: shown children (0 = leaf)
```

## Notes

- Validation, cycle detection, aggregation and sorting run in the engine (Rust) in O(n).
- Treemap: a parent whose children would average less than 36 px² (or that sits at `maxDepth`) is drawn as one cell, so the drawn amount follows the screen, not the data size. Cells snap to device pixels with exact 2 px gaps.
- Sunburst: arcs shorter than 1 px are skipped together with their subtree.
- Labels are placed only on cells / arcs that fit them (largest first, up to 600 for a treemap and 300 for a sunburst); names that do not fit are cut with an ellipsis.
- Accessibility: summary (node count, total, top group shares), a data table (path, value, % of parent, % of total per node), and keyboard navigation: left / right siblings, down first child, up parent, Enter drill, Escape up. See [Accessibility](../guide/accessibility).

## See also

- [Sankey](./sankey)
- [Pie · Donut](./pie)
- [Heatmap](./heatmap) (colormaps)
- [Tooltips & Hover](../guide/tooltips)
