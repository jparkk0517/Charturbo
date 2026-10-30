# 3D Scene · Physics

Besides charts and graphs, the same canvas can hold a small Three.js-style 3D scene: primitive shapes and custom triangle meshes with transforms, parenting, lighting, PBR-style materials, rigid-body physics and ray picking. Use it for spatial views, simple simulations, or 3D context around a graph.

[Live example](https://jparkk0517.github.io/Charturbo/scene.html)

## Basic usage

```ts
import { Charturbo } from 'charturbo';

const canvas = document.querySelector('canvas')!;
const sdk = await Charturbo.create(canvas, { nodeCount: 0, edgeCount: 0 });

sdk.setGraphVisible(false);                // scene only
sdk.setRigidPhysics(true, [0, -40, 0]);    // gravity
sdk.setHelpers({ showGrid: true });

sdk.addPlane({ position: [0, -1, 0], scale: [160, 2, 160] });
sdk.addBox({ position: [0, 40, 0], scale: [10, 10, 10], bodyType: 'dynamic' });
sdk.addSphere({ position: [5, 70, 0], scale: [8, 8, 8], bodyType: 'dynamic', metallic: 0.6 });
sdk.setCameraPose([0, 55, 115], [0, 10, 0]); // eye, target

// Orbit / pan / zoom; no graph nodes, so no node tooltip
const detach = sdk.enableNodeInteractions(canvas, { builtInTooltip: false, focusOnDoubleClick: false });

const tick = () => {
  sdk.stepPhysics(1 / 60); // advances rigid bodies (and the graph layout, if visible)
  sdk.render();
  requestAnimationFrame(tick);
};
tick();
```

Every `add*` method returns the new object's numeric ID.

## Objects

| Method | Description |
| --- | --- |
| `addBox(desc?)` | Box |
| `addSphere(desc?)` | Sphere |
| `addCylinder(desc?)` | Cylinder |
| `addPlane(desc?)` | Thin slab; default `scale: [200, 2, 200]`, `color: [0.16, 0.21, 0.31, 1]` |
| `addPrimitive(desc)` | Any of the above by `shape: 'box' \| 'sphere' \| 'plane' \| 'cylinder'` |
| `addCustomMesh(desc)` | Indexed triangle mesh |

Primitives are unit shapes, so `scale` is the object's size in world units.

### Primitive options (`PrimitiveObjectDescriptor`)

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `name` | `string` | `'<SHAPE>_<id>'` | Name stored in the object record |
| `shape` | `PrimitiveShape` | | Required for `addPrimitive` only |
| `position` | `[x, y, z]` | `[0, 0, 0]` | Position |
| `rotation` | `[rx, ry, rz]` | `[0, 0, 0]` | Euler angles in radians |
| `scale` | `[x, y, z]` | `[10, 10, 10]` | Size |
| `color` | `RgbaTuple` | `[0.35, 0.68, 0.98, 1]` | RGBA in `[0, 1]` |
| `metallic` | `number` | `0.15` | Metalness |
| `roughness` | `number` | `0.45` | Roughness |
| `emissive` | `number` | `0` | Self-illumination |
| `bodyType` | `'static' \| 'dynamic' \| 'kinematic'` | `'static'` | Rigid-body type |
| `velocity` | `[x, y, z]` | `[0, 0, 0]` | Initial linear velocity |
| `angularVelocity` | `[wx, wy, wz]` | `[0, 0, 0]` | Initial world-space spin, radians per second |
| `mass` | `number` | `max(0.2, abs(sx × sy × sz) × 0.01)` | Mass |
| `restitution` | `number` | `0.55` | Bounciness |
| `parentId` | `number \| null` | `null` | Parent object for hierarchical transforms |
| `map` / `mapRepeat` / `mapOffset` / `alphaTest` | | | Texture mapping, see [Textures](#textures) |

### Custom meshes (`CustomMeshObjectDescriptor`)

```ts
const torus = sdk.addCustomMesh({
  name: 'torus',
  ...Charturbo.createTorusMesh(8, 2.6, 24, 48), // { positions, normals, uvs, indices }
  position: [0, 40, -10],
  color: [0.62, 0.5, 0.92, 1],
  metallic: 0.8,
  roughness: 0.2,
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `positions` | `Float32Array \| number[]` | (required) | `[x0, y0, z0, ...]` vertex positions |
| `normals` | `Float32Array \| number[]` | | Vertex normals |
| `indices` | `Uint32Array \| number[]` | (required) | Triangle vertex indices |
| `uvs` | `Float32Array \| number[]` | | `[u0, v0, ...]` texture coordinates, 2 per vertex (see [Textures](#textures)) |
| `scale` | `[x, y, z]` | `[1, 1, 1]` | Scale |
| `color` | `RgbaTuple` | `[0.85, 0.45, 0.95, 1]` | RGBA |
| `metallic` / `roughness` | `number` | `0.35` / `0.3` | Material |
| `mass` / `restitution` | `number` | `2.0` / `0.6` | Physics |
| `map` / `mapRepeat` / `mapOffset` / `alphaTest` | | | Texture mapping, see [Textures](#textures) |

The other fields (`name` default `'MESH_<id>'`, `position`, `rotation`, `emissive`, `bodyType`, `velocity`, `angularVelocity`, `parentId`) work as for primitives. `Charturbo.createTorusMesh(majorRadius = 8, minorRadius = 2.6, radialSegments = 18, tubularSegments = 32)` generates a test mesh.

### Textures

```ts
const wood = await sdk.loadTexture('/img/wood.jpg');            // fetch + decode
const checker = sdk.createDataTexture(2, 2, new Uint8Array([    // raw RGBA8 texels
  255, 255, 255, 255,  60, 60, 60, 255,
   60, 60, 60, 255,  255, 255, 255, 255,
]));

const crate = sdk.addBox({ map: wood, mapRepeat: [2, 2] });
sdk.addPlane({ map: checker, mapRepeat: [16, 16] });
sdk.setObjectMaterial(crate, { map: null });                     // back to the plain color
sdk.disposeTexture(wood);
```

| Method | Returns | Description |
| --- | --- | --- |
| `loadTexture(source, { mipmaps?, signal? })` | `Promise<number>` | Decode an image and upload it; resolves to the texture ID. `source` is a URL string, `URL`, `Blob`, `ImageBitmap`, `HTMLImageElement`, `HTMLCanvasElement`, `OffscreenCanvas` or `ImageData` |
| `createDataTexture(width, height, rgba, { mipmaps? })` | `number` | Upload raw RGBA8 texels (straight alpha, first row at the top); `rgba.length` must be `width × height × 4` |
| `disposeTexture(id)` | `boolean` | Free a texture; objects that used it render untextured |
| `getTextures()` | `TextureRecord[]` | `{ id, width, height, src }` of the textures created through this SDK (`src` for string / `URL` sources only) |
| `maxTextureSize` | `number` | Largest texture edge in texels (at most 4096); `0` when the engine has no texture support |

The mapping fields work on `addBox` / `addSphere` / `addCylinder` / `addPlane` / `addPrimitive` / `addCustomMesh` and `setObjectMaterial`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `map` | `number \| null` | `null` | Texture ID; `null` (or `0`) removes the texture |
| `mapRepeat` | `[u, v]` | `[1, 1]` | Tiling; textures wrap |
| `mapOffset` | `[u, v]` | `[0, 0]` | UV offset |
| `alphaTest` | `number` | `0.5` with a map, else `0` | Fragments whose alpha (texture alpha × color alpha) is below this are discarded, for cutouts |
| `uvs` | `Float32Array \| number[]` | | Custom meshes only: two floats `u, v` per vertex. Without them the mesh is projected planarly along its two largest axes |

- **UV convention.** `u` runs left to right and `v` top to bottom (`v = 0` is the top row of the image), so images are never flipped. Boxes and planes show the whole image on every face, spheres wrap it once around, cylinders wrap the side and project it onto the caps, and `createTorusMesh` returns `uvs` (spread it into `addCustomMesh`).
- **Color.** The texture is multiplied by `color`, so the default white shows the image as drawn and any other color tints it. Lighting, metallic and roughness apply as usual. Translucency still follows `color[3]`, and texture alpha is for cutouts (`alphaTest`): with a map, fragments whose alpha is below `alphaTest` (default 0.5) are discarded, so set `alphaTest: 0` on a textured object with `color[3] < 0.5`.
- **Color space.** Textures are sampled as plain RGBA8 in the renderer's gamma space, and mip levels are averaged there, so shrunken textures look very slightly darker than a linear-light filter would give.
- **Limits.** Images larger than `maxTextureSize` are downscaled keeping their aspect ratio; `ImageData` and `createDataTexture` data must fit. Each engine allows 256 MiB of textures in total (`texture memory budget exceeded`). Texture IDs are never reused.
- **Errors.** Tainted images (cross-origin without CORS) reject with `loadTexture: cross-origin image`, an aborted `signal` rejects with an `AbortError`, and an engine built without texture support throws `... engine has no texture support`.
- A lost GPU device is not recovered: reload the page or recreate the SDK and its textures. Picking, physics, the SVG export and charts are unaffected by textures.

### glTF models

```ts
const house = await sdk.loadGltf('/models/house.glb', { rotation: [0, Math.PI / 4, 0], scale: 10 });
console.log(house.objects, house.bounds);   // object IDs, world-space bounds
sdk.disposeGltf(house);                      // removes its objects and textures
```

| Method | Returns | Description |
| --- | --- | --- |
| `loadGltf(source, options?)` | `Promise<GltfLoadResult>` | Load a glTF 2.0 model (`.gltf` or `.glb`). `source` is a URL string, `URL`, `ArrayBuffer`, `Uint8Array` or `Blob` |
| `disposeGltf(result)` | | Remove every object and texture the load created |

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `position` | `[x, y, z]` | `[0, 0, 0]` | Object position of every created mesh; the model origin lands here |
| `rotation` | `[rx, ry, rz]` | `[0, 0, 0]` | Object rotation (Euler radians, as for primitives) |
| `scale` | `number \| [x, y, z]` | `1` | Baked into the vertices (glTF units are meters) |
| `scene` | `number` | the file's `scene`, else `0` | Scene index |
| `baseUrl` | `string` | the source URL, else the page URL | Base for relative buffer and image URIs |
| `signal` | `AbortSignal` | | Aborts fetches and decoding; the promise rejects with an `AbortError` |

The result is `{ objects, textures, nodes, bounds }`: `nodes` lists the scene's nodes depth first as `{ index, name, objectIds }`, and `bounds` is `{ min, max }` in world space. Each mesh primitive becomes one custom mesh object named after its node (or mesh), with `#<n>` appended when the mesh has several primitives.

- **Supported.** `.gltf` with external or `data:` buffers and images, `.glb` with its binary chunk; every accessor type, including interleaved (`byteStride`), normalized, sparse and accessors without a buffer view; triangles, triangle strips and fans (points and lines are skipped with a warning). The node hierarchy (TRS or `matrix`) is baked into the vertices, with normals transformed by the inverse transpose and the winding flipped for mirrored nodes; missing normals are computed smooth. Extensions `KHR_texture_transform`, `KHR_mesh_quantization` and `KHR_materials_emissive_strength`.
- **Materials.** `baseColorFactor` is converted from linear to the renderer's gamma space; `baseColorTexture` becomes `map` (`TEXCOORD_0` only; `KHR_texture_transform` offset and scale become `mapOffset` / `mapRepeat`); `metallicFactor` and `roughnessFactor` default to 1 as in glTF; `emissive` is the largest `emissiveFactor` component (times the emissive strength), since the engine's emission is a scalar on the base color. `alphaMode: 'MASK'` sets `alphaTest` to `alphaCutoff` (default 0.5), `'BLEND'` keeps the color alpha and `'OPAQUE'` forces color alpha 1. Images used by several materials are decoded once.
- **Ignored.** Samplers (textures always repeat with linear filtering). With a warning: normal, occlusion, metallic-roughness and emissive textures, texture transform rotation, base color textures on `TEXCOORD_1` or higher, skins (meshes render in their bind pose), morph targets, animations, cameras and other extensions. A model that lists an unsupported extension in `extensionsRequired` is rejected with `loadGltf: extension X is required but not supported`.
- **Limits.** One load creates at most `GLTF_MAX_VERTICES` (8,388,608) vertices and `GLTF_MAX_INDICES` (67,108,864) indices. All objects share one geometry buffer, so several large models can still exceed the GPU's buffer limit. Textures follow the texture limits above.
- **Errors.** Error messages start with `loadGltf:`. On any failure, including an abort, the objects and textures created so far are removed.
- All objects of one model use the model origin as pivot, so applying the same `position` / `rotation` with `setObjectTransform` to each of `result.objects` moves the model as a whole.

### Editing objects

| Method | Returns | Description |
| --- | --- | --- |
| `setObjectTransform(id, { position?, rotation?, scale?, parentId? })` | `boolean` | Partial transform update |
| `getObjectTransform(id)` | `{ position, rotation, scale } \| null` | Current transform, including physics motion |
| `setObjectMaterial(id, { color?, metallic?, roughness?, emissive?, map?, mapRepeat?, mapOffset?, alphaTest? })` | `boolean` | Partial material update |
| `setObjectPhysics(id, { bodyType?, velocity?, angularVelocity?, mass?, restitution? })` | `boolean` | Partial physics update |
| `setObjectParent(id, parentId \| null)` | `boolean` | Attach to / detach from a parent |
| `removeObject(id)` | `boolean` | Remove one object |
| `clearScene()` | | Remove every object and the active chart |
| `objectCount()` | `number` | Object count |
| `getObjects()` / `getObjectRecord(id)` | `SceneObjectRecord[]` / `SceneObjectRecord \| null` | Full records with current transforms |

Methods that take an ID return `false` (or `null`) for an unknown ID.

## Lighting and helpers

```ts
sdk.setLighting({ ambientIntensity: 0.3, directionalIntensity: 1, pointPosition: [0, 45, 25] });
sdk.setHelpers({ showGrid: true, gridSize: 160, gridDivisions: 16, showAxes: true });
```

`setLighting` and `setHelpers` merge into the current values; `getLighting()` / `getHelpers()` return the full settings.

| Lighting option | Type | Default |
| --- | --- | --- |
| `ambientIntensity` | `number` | `0.32` |
| `directionalDirection` | `[x, y, z]` | `[0.45, 0.85, 0.55]` |
| `directionalIntensity` | `number` | `0.95` |
| `pointPosition` | `[x, y, z]` | `[0, 45, 25]` |
| `pointIntensity` | `number` | `0.65` |

| Helper option | Type | Default |
| --- | --- | --- |
| `showGrid` | `boolean` | `false` |
| `gridSize` | `number` | `200` |
| `gridDivisions` | `number` | `20` |
| `showAxes` | `boolean` | `false` |
| `axesLength` | `number` | `60` |

## Rigid-body physics

`setRigidPhysics(enabled, gravity?)` turns the simulation on or off; it is on by default with gravity `[0, -40, 0]`. `getRigidPhysics()` returns `{ enabled, gravity }`.

- `stepPhysics(dt)` advances the scene. `dt` is clamped to 0.001..0.05 s and split into substeps of at most 1/120 s. It returns the kinetic energy.
- `'dynamic'` bodies fall under gravity and collide with every other body. `'kinematic'` bodies move by their own `velocity` and `angularVelocity` without gravity. `'static'` bodies never move.
- Off-center impacts make bodies spin, and friction makes spheres roll. Boxes use oriented contact manifolds; cylinders collide as boxes; custom meshes use their bounding box.
- Child objects (`parentId`) follow their parent and are not simulated on their own.

## Picking

```ts
sdk.enableNodeInteractions(canvas, {
  builtInTooltip: false,
  focusOnDoubleClick: false,
  onNodeClick: (_node, e) => {
    const rect = canvas.getBoundingClientRect();
    const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((e.clientY - rect.top) / rect.height) * 2;
    const hit = sdk.raycastObjectAtNdc(ndcX, ndcY); // { objectId, point } | null
    sdk.selectObject(hit?.objectId ?? null);         // outline the hit object
  },
});
```

- `raycastObjectAtNdc(ndcX, ndcY)` returns the nearest hit object and the world-space hit point. Spheres and planes are intersected analytically, boxes and cylinders as boxes, and custom meshes per triangle after a bounding-box test.
- `pickObjectAtNdc(ndcX, ndcY)` returns only the object ID (`null` for none).
- `selectObject(id | null)` highlights an object (large static planes get an outline-only selection).

## Save and load

`exportScene()` returns a serializable `SceneDescriptor` (objects with transforms, materials and physics, plus lighting, helpers, rigid physics and graph visibility). `loadScene(descriptor)` clears the scene, applies the settings and recreates the objects, returning their new IDs.

Textures are not cleared by `clearScene()` / `loadScene()`. `exportScene()` lists the textures its objects use in `textures` (`{ id, src, width, height }`, no pixel data) and keeps the `map` IDs on the objects. `loadScene` is synchronous: it keeps `map` IDs of textures that are still alive and drops unknown ones with a `console.warn`. To restore a scene saved in another session, call `await sdk.loadSceneWithTextures(descriptor)`: it reloads the textures that have a `src` (reusing a live texture with the same `src`), remaps the object `map` IDs and then calls `loadScene`. Textures without a `src` (`createDataTexture`, canvases, `ImageData`) cannot be restored and their maps are dropped.

```ts
sdk.loadScene({
  lighting: { ambientIntensity: 0.3, directionalDirection: [0.4, 0.9, 0.5], directionalIntensity: 1, pointIntensity: 0.5 },
  helpers: { showGrid: true, gridSize: 160, gridDivisions: 16 },
  rigidPhysics: { enabled: true, gravity: [0, -40, 0] },
  graphVisible: false,
  objects: [
    { kind: 'primitive', name: 'floor', shape: 'plane', position: [0, -1, 0], scale: [160, 2, 160], roughness: 0.9 },
    { kind: 'primitive', name: 'step', shape: 'box', position: [-25, 5, 0], scale: [30, 10, 30] },
  ],
});

const saved = JSON.stringify(sdk.exportScene());
```

## Camera

The scene uses the same orbit camera as the [3D graph](./graph-3d#camera): mouse and touch controls, `setCameraPose(eye, target)`, `rotateCamera`, `panCamera`, `zoomCamera` and `getCameraState()`. For first-person movement use `moveCameraLocal(forward, right, up)` and `rotateCameraLook(deltaYaw, deltaPitch)`.

## Notes

- `Charturbo.create` generates a 1000-node graph unless you pass `nodeCount: 0, edgeCount: 0`. Use `setGraphVisible(false)` when the canvas shows only the scene; a visible graph and the scene can also share the canvas.
- Rendering a chart (`render*Chart`) puts the canvas in chart mode; the built-in camera controls apply only while no chart is shown.

## See also

- [3D Network Graph](./graph-3d)
- [Interactions](../guide/interactions)
- [Performance](../guide/performance)
