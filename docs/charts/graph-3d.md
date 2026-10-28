# 3D Network Graph

Charturbo renders large 3D node-link graphs and lays them out with a Barnes-Hut force simulation (O(N log N) octree) written in Rust. Use it for service maps, dependency graphs and other networks with thousands to hundreds of thousands of nodes, with hover tooltips, neighbor highlighting, shortest paths and search built in.

[Live example](https://jparkk0517.github.io/Charturbo/graph.html)

## Basic usage

```ts
import { Charturbo, type RawGraphData } from 'charturbo';

const canvas = document.querySelector('canvas')!;
// nodeCount / edgeCount 0: start empty instead of the default seeded graph
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

const graph: RawGraphData = {
  positions: new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]), // 3 nodes
  edges: new Uint32Array([0, 1, 1, 2]),                       // 0-1, 1-2
};
sdk.loadDataset(graph);
sdk.setNodeMetadata([
  { label: 'gateway', category: 'Ingress' },
  { label: 'auth', category: 'Service' },
  { label: 'db', category: 'Storage' },
]);

// Hover tooltip, click = 1-hop neighbors, double-click = focus, drag / wheel = camera
const detach = sdk.enableNodeInteractions(canvas, { autoRender: true });

sdk.setAutoSleep(true); // stop simulating once the layout is at rest
sdk.warmup(40);         // settle the layout before the first frame
sdk.fitToView();

const tick = () => {
  if (!sdk.isSleeping()) {
    sdk.stepPhysics();
    sdk.render();
  }
  requestAnimationFrame(tick);
};
tick();
```

`detach()` (or `sdk.dispose()`) removes the listeners and the tooltip.

## Data format

`loadDataset(data: RawGraphData)` takes flat typed arrays without copying them into objects:

| Field | Type | Length | Description |
| --- | --- | --- | --- |
| `positions` | `Float32Array` | `3 * N` | `[x0, y0, z0, x1, y1, z1, ...]` initial coordinates |
| `masses` | `Float32Array` | `N` | Optional, default `1.0` |
| `colors` | `Float32Array` | `4 * N` | Optional RGBA in `[0, 1]` |
| `clusters` | `Uint16Array` | `N` | Optional cluster IDs |
| `edges` | `Uint32Array` | `2 * E` | Endpoint index pairs `[src0, dst0, src1, dst1, ...]` |
| `edgeWeights` | `Float32Array` | `E` | Optional, default `1.0` |

Node IDs are the indices into these arrays. Loading a dataset replaces any chart on the canvas.

### Seeded synthetic graph

Without `loadDataset`, `Charturbo.create` generates a clustered random graph from these options. Pass `nodeCount: 0, edgeCount: 0` to start empty.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `seed` | `number` | `42` | Random seed |
| `nodeCount` | `number` | `1000` | Nodes |
| `edgeCount` | `number` | `2000` | Edges |
| `clusterCount` | `number` | `8` | Clusters |

`sdk.reloadSeededDataset(seed, nodeCount, edgeCount, clusterCount)` regenerates it later. `sdk.generateDefaultMetadata(prefix?)` fills demo labels, categories, tags and attributes for every node (default prefix `'Service-Node'`).

## Options

### `enableNodeInteractions(canvas, options?)`

Options that apply to graph and 3D views (`NodeInteractionOptions`; chart-only options are covered in [Interactions](../guide/interactions)):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `builtInTooltip` | `boolean` | `true` | Floating HTML tooltip on hover |
| `tooltipContainer` | `HTMLElement` | `canvas.parentElement` or `document.body` | Where the tooltip is mounted |
| `highlightNeighborsOnClick` | `number` | `1` | Hops highlighted on click; `0` disables |
| `focusOnDoubleClick` | `boolean` | `true` | Double-click moves the camera to the node |
| `autoRender` | `boolean` | `false` | Call `render()` on hover / click / camera changes |
| `formatTooltip` | `(details: NodeDetails) => string` | | Custom tooltip HTML |
| `tooltipClassName` | `string` | | Extra CSS class (base class `charturbo-sdk-node-tooltip`) |
| `tooltipStyle` | `Partial<CSSStyleDeclaration>` | | Inline style merged over the default |
| `touch` | `false \| TouchInteractionOptions` | all on | Touch / pen: drag orbits, pinch zooms, two-finger drag pans, tap selects, double-tap focuses |
| `cameraControls` | `false \| CameraControlOptions` | all on | Mouse camera controls, see [Camera](#camera) |
| `onNodeHover` | `(details, pointer) => void` | | Hovered node changed (`null` when none) |
| `onNodeClick` | `(details, event) => void` | | Node clicked; `null` for a click on empty space |

### Force options

`setForceOptions(options: Partial<ForceOptions>)` merges into the current values:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `repulsionStrength` | `number` | `25.0` | Node-node repulsion |
| `springStiffness` | `number` | `0.08` | Edge spring stiffness |
| `springRestLength` | `number` | `8.0` | Edge spring rest length |
| `centerGravity` | `number` | `0.03` | Pull toward the origin |
| `damping` | `number` | `0.88` | Velocity damping per step |
| `theta` | `number` | `0.75` | Barnes-Hut opening angle (higher = faster, less exact) |

## Force simulation

| Method | Description |
| --- | --- |
| `stepPhysics(dt = 0.016)` | One synchronous CPU step; returns the kinetic energy |
| `warmup(ticks = 60, dt = 0.016)` | Runs several steps at once |
| `setAutoSleep(enabled, sleepThreshold = 0.05)` | Stops stepping after 30 consecutive steps with mean kinetic energy per unpinned node below the threshold. Off by default |
| `isSleeping()` / `wakeUp()` | Read / clear the sleep state |
| `exportPositions()` / `importPositions(positions)` | Save / restore the layout as a flat `Float32Array` |
| `pinNode(id, pinned)` | Fix a node in place |
| `moveNode(id, x, y, z)` | Move a node |
| `setNodeStyle(id, { color?, mass?, clusterId? })` | Change one node's color, mass or cluster |

None of these render: call `render()` (or use `autoRender`) after them.

### GPU-resident layout

On WebGPU, `stepPhysicsAsync` keeps the layout on the GPU: positions and velocities stay in GPU buffers, and the GPU builds the Barnes-Hut octree and applies repulsion, springs, integration and the auto-sleep check every step.

```ts
if (sdk.supportsGpuPhysics()) console.log('GPU layout available');

const loop = async () => {
  if (!sdk.isSleeping()) {
    await sdk.stepPhysicsAsync(0.016); // resolves at submission
    sdk.render();
  }
  requestAnimationFrame(loop);
};
loop();

// Before picking or exporting when positions must be current
await sdk.syncPhysicsPositions();
const positions = sdk.exportPositions();
```

- `stepPhysicsAsync(dt)` resolves once the step is submitted, with the kinetic energy of the newest read-back layout. It does not render.
- The CPU copy (used by picking, `exportPositions`, node details and `isSleeping()`) trails the GPU by a frame or two. `await syncPhysicsPositions()` brings it up to date with every submitted step; it is a no-op on CPU physics.
- CPU edits (`moveNode`, `pinNode`, `setNodeStyle`, `loadDataset`, `stepPhysics`) are applied in order. Only the edited nodes are uploaded (or the whole layout after a full edit), and pending CPU node edits win over GPU state.
- Await each step before starting the next; a second call while one is pending throws `A physics step is already pending`.
- On WebGL2 and older backends `stepPhysicsAsync` falls back to CPU physics. The synchronous `stepPhysics()` is always CPU.
- Frustum culling (`setFrustumCulling`) is skipped while the layout is GPU-resident.

::: warning
Since the GPU-resident change, `stepPhysicsAsync` resolves at submission instead of after the readback, and CPU edits during GPU work are applied in order instead of rejecting the step. Await `syncPhysicsPositions()` where you need current positions.
:::

## Layout presets

`applyLayout(mode, spaceRadius = 85)` places every node immediately:

| `mode` | Layout |
| --- | --- |
| `'cluster-sphere'` | Clusters grouped on a sphere |
| `'radial-shells'` | Concentric shells |
| `'helix'` | Helix |
| `'grid-3d'` | 3D grid |

Presets are static. To hand the positions back to the simulation, call `wakeUp()` and keep calling `stepPhysics()`.

```ts
sdk.applyLayout('cluster-sphere', 85);
sdk.fitToView();
sdk.render();
```

## Node metadata and tooltips

```ts
sdk.setSingleNodeMetadata(0, {
  label: 'API-Gateway-01',
  category: 'Ingress',
  description: 'Main gateway, Seoul region',
  tags: ['critical'],
  attributes: { latencyMs: 1.8, rps: 4200, status: 'Healthy' },
});
```

- `setNodeMetadata(metadata)` replaces all metadata. It accepts an array indexed by node ID, a `Map<number, NodeMetadata>` or a `Record<number, NodeMetadata>`.
- `setSingleNodeMetadata(id, metadata)` merges into one node. `getNodeMetadata(id)` returns it, or `{ label: 'Node #<id>' }` when none is set.
- `NodeMetadata`: `label`, `category`, `description`, `tags: string[]`, `attributes: Record<string, string | number | boolean>`.

`getNodeDetails(id)` returns `NodeDetails` (also passed to `onNodeHover`, `onNodeClick` and `formatTooltip`):

| Field | Type | Description |
| --- | --- | --- |
| `id` | `number` | Node ID |
| `label` | `string` | Metadata label or `Node #<id>` |
| `position` | `[x, y, z]` | Current position |
| `mass` | `number` | Mass |
| `clusterId` | `number` | Cluster |
| `color` | `RgbaTuple` | Color |
| `degree` | `number` | Edge count |
| `selected` / `pinned` | `boolean` | State flags |
| `neighbors` | `number[]` | Adjacent node IDs |
| `metadata` | `NodeMetadata` | Metadata; `category` defaults to `Cluster <id>` |

### Default tooltip

The built-in tooltip shows label and `#id`, category and cluster, degree, neighbor count, position, tags and up to 6 attributes, in the theme text colors. Every data-derived string (label, category, tags, attribute keys and values) is HTML-escaped, so a label such as `<img onerror=…>` is shown as text. Fixed labels follow the SDK / chart locale (see [Internationalization](../guide/i18n)), and numbers use that locale's format.

`setNodeHoverStyle({ enabled?, scale?, color? })` changes the hover marker. By default the hovered node is enlarged 1.6× and brightened in its own color.

### Custom tooltip

`formatTooltip` HTML is inserted with `innerHTML` as is. Wrap data strings in the exported `escapeHtml`:

```ts
import { escapeHtml } from 'charturbo';

sdk.enableNodeInteractions(canvas, {
  autoRender: true,
  formatTooltip: (d) =>
    `<b>${escapeHtml(d.label)}</b><div>${escapeHtml(d.metadata.category ?? '')} · ${d.degree} links</div>`,
});
```

## Selection, paths and search

| Method | Returns | Description |
| --- | --- | --- |
| `highlightNeighbors(id, hops = 1)` | `Uint32Array` | Selects a node and its neighbors up to `hops` (`0` = the node only) |
| `highlightShortestPath(start, end)` | `Uint32Array` | Undirected BFS shortest path, highlighted; empty when not connected |
| `selectCluster(clusterId)` | `Uint32Array` | Selects a cluster |
| `boxSelect(minX, minY, maxX, maxY)` | `Uint32Array` | Nodes inside an NDC rectangle |
| `queryRadius(x, y, z, radius, maxResults = 100)` | `Uint32Array` | Nodes within a sphere |
| `pickNodeAtNdc(ndcX, ndcY)` | `number \| null` | Node under an NDC point |
| `clearSelection()` | | Clears the selection |
| `searchNodes(query, limit = 25)` | `NodeDetails[]` | Matches a numeric ID (`42` or `#42`) first, then label, category, description and tags (case-insensitive substring) |
| `projectNodeToScreen(id, w, h)` | `{ x, y, ndcZ } \| null` | Canvas pixel position; `null` behind the camera |
| `projectNodesToScreen(ids, w, h)` | `Float32Array` | `[x0, y0, x1, y1, ...]` in one WebAssembly call; `NaN` behind the camera |

```ts
const path = sdk.highlightShortestPath(0, 1999);
console.log(`${path.length - 1} hops`);

for (const node of sdk.searchNodes('vector db', 4)) {
  sdk.focusNode(node.id);
  sdk.highlightNeighbors(node.id, 1);
}
sdk.render();
```

## Camera {#camera}

The built-in camera controls (`cameraControls`) apply to graph, point cloud and 3D scene views while no 2D chart is shown:

| Input | Action |
| --- | --- |
| Left drag | Orbit |
| Shift + drag, right drag, middle drag | Pan (the content under the pointer follows it) |
| Wheel | Zoom, proportional to the current distance; the page does not scroll |
| Double-click | Focus the node (`focusOnDoubleClick`) |

- The pointer is captured during a drag, so releasing outside the canvas ends it. A release within 5 px of the press counts as a click.
- `{ orbit: false }` makes a left drag pan (2D-style navigation). `{ pan: false }` / `{ zoom: false }` turn off one action. `cameraControls: false` turns off every built-in camera move, for hosts that drive the camera themselves. The same switches apply to touch gestures.
- The canvas context menu is suppressed in graph views so right-drag can pan.
- Hosts with their own pointer handlers can skip camera handling while `sdk.handlesCameraControls()` returns `true`.

```ts
sdk.fitToView();                      // frame all nodes from the current direction (10 % margin)
sdk.focusNode(42);                    // move to a node and approach to 40 % of the overview distance
sdk.focusNode(42, { distance: 60 });  // explicit distance (`false` keeps the distance)
const cam = sdk.getCameraState();     // { projection, target, eye, distance, yaw, pitch, fovY, aspect } | null
sdk.setCameraPose([0, 50, 160], [0, 0, 0]); // eye, target
```

- `fitToView()` sets the distance at which all nodes fill the view on the tighter of the horizontal and vertical field of view, so wide canvases fill too. It also sets the overview distance used by `focusNode`.
- `focusNode` and double-click focus move the target and get closer, to 40 % of the overview distance (the last `fitToView` / `setCameraPose`), never farther than the current distance. The move is immediate. Returns `false` for an unknown ID.
- Programmatic control: `rotateCamera(deltaYaw, deltaPitch)`, `panCamera(deltaRight, deltaUp)`, `zoomCamera(delta)`.

## Notes

- Frustum culling is off by default; `setFrustumCulling(true)` enables it for the CPU layout.
- `getCameraState()`, distance-based zoom / pan and focus distance need an engine build with the `camera_state` binding; without it they return `null`, use fixed gains, or move only the target.
- `setGraphVisible(false)` hides the graph (and stops its simulation), for example when the canvas only shows a [3D scene](./scene-3d).

## See also

- [Embeddings · Similarity](./embeddings)
- [3D Scene · Physics](./scene-3d)
- [Tooltips & Hover](../guide/tooltips)
- [Performance](../guide/performance)
