# PointCloud3D · Surface3D

`renderPointCloud3D` draws independent XYZ samples as screen-facing points, and `renderSurface3D` draws a Y-up height grid as a lit, colormapped surface. Use them for measured 3D data (scans, trajectories, simulation output) when you need real X/Y/Z axes, picking and streaming rather than a force-directed graph.

[Live example](https://jparkk0517.github.io/Charturbo/scientific3d.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
// nodeCount / edgeCount 0: skip the default seeded graph
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

sdk.renderPointCloud3D([
  { name: 'Scan', data: new Float32Array([0, 1, 2, 3, 4, 5]), size: 5 },
  { name: 'Reference', data: [{ x: 1, y: 2, z: 3 }], color: '#ff9933', size: 10 },
], { title: 'XYZ cloud', legend: true });

// Orbit / pan / zoom, hover tooltip, keyboard exploration
sdk.enableNodeInteractions(canvas, { autoRender: true });
sdk.render();
```

A surface uses the same pattern:

```ts
sdk.renderSurface3D([{
  name: 'Height',
  data: { columns: 3, rows: 2, xStart: -1, xStep: 1, zStart: 0, zStep: 2,
    y: [0, 1, 0, 1, 2, 1] },
  colormap: 'viridis', lighting: 0.65,
  contours: { show: true, levels: 8, color: '#f8fafc' },
}], { title: 'Y-up surface', showGrid: true });
sdk.render();
```

Both methods return `{ pointCount, seriesCount }`. Coordinates are Y-up. The original XYZ values are kept separate from render coordinates: tooltips, keyboard focus and CSV export always report the original values. Internal render coordinates use Float32 precision.

## Data format

### Point cloud (`PointCloud3DSeries.data`)

Any of these shapes:

| Shape | Example |
| --- | --- |
| Interleaved `Float32Array` or `Float64Array` | `new Float32Array([x0, y0, z0, x1, y1, z1])` |
| Array of tuples | `[[x, y, z], ...]` |
| Array of objects | `[{ x, y, z }, ...]` |
| Columns of equal length | `{ x: ArrayLike<number>, y: ArrayLike<number>, z: ArrayLike<number> }` |

A `null` entry or a non-finite coordinate is a gap: it is not drawn, but the remaining samples keep their original IDs.

### Surface (`Surface3DSeries.data`)

```ts
interface Surface3DGridData {
  columns: number; // >= 2
  rows: number;    // >= 2
  xStart: number; xStep: number; // finite start, non-zero step (negative allowed)
  zStart: number; zStep: number;
  y: ArrayLike<number>;           // row-major: y[row * columns + column]
}
```

A cell with at least one non-finite vertex becomes a hole.

A chart holds at most 4,000,000 samples in total.

## Options

### Series options

Common to both series types:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | | Legend and tooltip name |
| `color` | `ColorInput` | palette | Series color |
| `visible` | `boolean` | `true` | Initial visibility |
| `opacity` | `number` | | Series opacity |

`PointCloud3DSeries`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `PointCloud3DData` | | XYZ samples (see above) |
| `size` | `number` | `3` | Point diameter in CSS pixels |
| `colorBy` | `{ values, colormap?, min?, max? }` | | One scalar per point, mapped through `'viridis'` (default) or `'magma'`. `min` / `max` fix the color range |

`Surface3DSeries`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `data` | `Surface3DGridData` | | Height grid |
| `colormap` | `'viridis' \| 'magma'` | `'viridis'` | Height colormap. With only an explicit `color` (no `colormap`) the surface is a solid color |
| `yMin` / `yMax` | `number` | data range | Color range of the colormap |
| `wireframe` | `boolean` | `false` | Draw grid lines instead of filled cells |
| `lighting` | `number` | `0.65` | Flat diffuse lighting, 0..1 |
| `contours` | `Surface3DContourOptions` | | Height isolines, see [Contours](#contours) |

### Chart options (`Scientific3DChartOptions`)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `title` | `string` | | Chart title |
| `description` | `string` | | Accessible description |
| `legend` | `boolean \| ChartLegendOptions` | | Series legend |
| `grid` | `ChartGridStyle` | | Grid line style |
| `showGrid` | `boolean` | | Show the grid |
| `hover` | `ChartHoverStyle` | | Hover marker style |
| `axes3d` | `{ x?, y?, z? }` | | Per-axis range, name, ticks, visibility |
| `aspect` | `'cube' \| 'data' \| [x, y, z]` | `'cube'` | Box proportions |
| `camera` | `Scientific3DCameraOptions` | | Projection and initial pose |

The camera is a Y-up orbit in normalized render space. It keeps rotation, pan, distance and projection size across resizes.

## Axis ranges, aspect and orthographic projection

```ts
sdk.renderPointCloud3D([{ data: measuredXYZ, size: 4 }], {
  axes3d: {
    x: { name: 'X', min: 0, max: 120, tickCount: 4 },
    y: { min: 0, max: 40, tickCount: 3 },
    z: { min: 0, max: 20, tickCount: 3 },
  },
  aspect: 'data', // 'cube' (default) or relative XYZ box lengths such as [2, 1, 0.5]
  camera: { type: 'orthographic' }, // perspective by default; orthoSize omitted = auto framing
});
```

`axes3d.x` / `y` / `z` (`Scientific3DAxisOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | | Axis label |
| `min` / `max` | `number` | data range | Fixed frame range in data units |
| `tickCount` | `number` | `5` | Integer 2..50, evenly spaced inside the range |
| `visible` | `boolean` | `true` | `false` hides this axis's ticks and its grid direction |

- An omitted endpoint follows the range of all finite samples, including hidden series. When both endpoints are set, `min < max` is required. If only one end is fixed and the automatic end would cross it, the automatic end is widened by 5 % of the fixed value (at least 1 unit).
- A fixed range is an **axis frame**: geometry outside it is not clipped.
- Axis labels are DOM elements. The whole grid is controlled by `showGrid`.
- `aspect: 'cube'` normalizes each axis independently to `[-60, 60]`. `aspect: 'data'` uses the ratio of the axis range lengths, so equal data units have equal length. A numeric tuple gives positive relative box lengths. The longest side is 120 render units. Tooltips, CSV and accessibility output keep the original XYZ.
- While streaming, fixed endpoints stay and only automatic endpoints are recomputed.

`camera` (`Scientific3DCameraOptions`):

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | `'perspective' \| 'orthographic'` | `'perspective'` | Projection |
| `eye` | `[x, y, z]` | fits the data box | Eye position in render space |
| `target` | `[x, y, z]` | `[0, 0, 0]` | Orbit target in render space; requires `eye` |
| `orthoSize` | `number` | auto | Initial vertical half-extent (orthographic only, positive). Changes with wheel zoom |

Orthographic picking casts a parallel ray per screen position. `getCameraState()` reports `projection` and `orthoSize`. Switching to another chart restores perspective.

## Contours {#contours}

`contours: { show?, levels?, color?, width?, opacity? }` on a surface series draws height isolines.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `show` | `boolean` | `false` | Draw contours |
| `levels` | `number \| number[]` | `12` | Integer 1..64: evenly spaced levels strictly inside `yMin..yMax` (or the finite height range), end points excluded; a single-value range gives that one value. An array of finite numbers: explicit raw Y heights |
| `color` | `ColorInput` | `'#e2e8f0'` | Line color |
| `width` | `number` | `1.5` | Visual weight, not a CSS pixel width: lines are 1 px hairlines with alpha `min(1, opacity × colorAlpha × (0.75 + 0.15 × min(width, 4)))` |
| `opacity` | `number` | `0.85` | 0..1 |

Invalid values are rejected before rendering. Contours are traced with marching triangles on the rendered triangles and use the same coordinate mapping as the surface, so they stay on it with fixed `axes3d`, any `aspect` and orthographic projection. They skip hole cells, follow series visibility and emphasis, and are depth tested, but they are not pickable. `updateSurface3D` recomputes count-based levels from the updated heights and `yMin` / `yMax`.

## Streaming updates

```ts
// Append to cloud series 0; returns the retained length of that series
sdk.appendPointCloud3D(0, new Float32Array([1, 2, 3, 4, 5, 6]), { maxPoints: 2400 });
// A colorBy series needs one colorValues entry per appended point:
// sdk.appendPointCloud3D(0, xyz, { maxPoints: 2400, colorValues: scalars });
sdk.render();

// On a rendered surface (a separate chart from the cloud above)
sdk.updateSurface3D(0, { mode: 'replaceY', y: heights, yMin: -1, yMax: 1 });
sdk.updateSurface3D(0, { mode: 'appendColumns', columns: 1, y: nextColumn });
sdk.updateSurface3D(0, { mode: 'appendRows', rows: 1, y: nextRow, scrollZ: false });
sdk.render();
```

### `appendPointCloud3D(seriesIndex, data, options?)`

Accepts the same XYZ shapes as `renderPointCloud3D` and returns the retained sample count of the series.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `maxPoints` | `number` | `0` (unbounded) | Keep only the newest N samples |
| `colorValues` | `ArrayLike<number>` | | Required when the series uses `colorBy` (one per appended point); not allowed otherwise |

The colormap and fixed `min` / `max` are kept; an automatic color range is recomputed from the retained scalars.

### `updateSurface3D(seriesIndex, update)`

Returns `{ columns, rows, pointCount }` for the series.

| `mode` | Fields | Description |
| --- | --- | --- |
| `'replaceY'` | `y`, `yMin?`, `yMax?` | Replaces all heights (row-major, `rows * columns`). `yMin` / `yMax` persist for later updates; omitted keeps the current setting |
| `'appendColumns'` | `columns`, `y`, `scrollX?` | `y` is a column-major strip: `y[newColumn * rows + row]` |
| `'appendRows'` | `rows`, `y`, `scrollZ?` | `y` is a row-major block: `y[newRow * columns + column]` |

With `scrollX` / `scrollZ` `true` (default) the grid keeps its size: the oldest columns / rows are dropped and the origin moves by `appended count × step`. A chunk larger than the window keeps only the last window. With `false` the origin stays and the grid grows. Negative steps work.

### Update rules

- Updates are atomic. A wrong length, range, kind, series index or an unsupported backend is rejected without changing the current data.
- Inputs are copied: changing your array afterwards does not affect the chart. Each chunk holds at most 4,000,000 samples, and so does the whole chart. An empty append is allowed (it still applies a smaller cloud `maxPoints`).
- Camera, styles, visibility, emphasis and fixed axis endpoints are kept. Automatic ranges are recomputed from all retained data. IDs are renumbered from the current series order and sample position. A pinned tooltip or keyboard focus is released; CSV, accessibility and tooltips use the updated XYZ.
- The current implementation copies SDK metadata, sends the changed series to WebAssembly again and lets Rust rebuild ranges and geometry. It does not guarantee partial GPU uploads or O(appended) cost.

## Interaction and export

- Call `enableNodeInteractions(canvas, { autoRender: true })` for orbit (left drag), pan (Shift / right / middle drag) and zoom (wheel); see [3D Network Graph](./graph-3d#camera) for the camera controls.
- Point cloud picking returns the front-most sample within the tolerance radius. Surface picking intersects the triangles and returns `point3d: { x, y, z, column, row }`. Wireframe surfaces also pick inside cells.
- Keyboard navigation and CSV report the raw (not interpolated) vertex XYZ.
- SVG export falls back to a raster image; PNG and PDF capture the current 3D view.

## Framework usage

React and Vue accept `type="pointCloud3d"` and `type="surface3d"`, with the same `options`. Updating means passing the full data to the render API again. For streaming, call `appendPointCloud3D` / `updateSurface3D` and `render()` on the SDK from `onReady(sdk)` or the component ref's `whenReady()`, and keep the `data` / `options` prop references stable: a new reference re-runs the full render API.

## Notes

- Hover currently tests every point / cell.
- Semi-transparent geometry writes depth but is not depth sorted; exact multi-layer transparency is not supported.
- Not available yet: 3D brush and sync, contour labels, FOV / near / far / up camera settings, nice ticks, GPU glyph labels, an independent box toggle.

## See also

- [3D Network Graph](./graph-3d)
- [Interactions](../guide/interactions)
- [Export: PNG · SVG · PDF](../guide/export)
- [React](../guide/react) · [Vue](../guide/vue)
