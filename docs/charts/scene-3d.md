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

### Custom meshes (`CustomMeshObjectDescriptor`)

```ts
const torus = sdk.addCustomMesh({
  name: 'torus',
  ...Charturbo.createTorusMesh(8, 2.6, 24, 48), // { positions, normals, indices }
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
| `scale` | `[x, y, z]` | `[1, 1, 1]` | Scale |
| `color` | `RgbaTuple` | `[0.85, 0.45, 0.95, 1]` | RGBA |
| `metallic` / `roughness` | `number` | `0.35` / `0.3` | Material |
| `mass` / `restitution` | `number` | `2.0` / `0.6` | Physics |

The other fields (`name` default `'MESH_<id>'`, `position`, `rotation`, `emissive`, `bodyType`, `velocity`, `angularVelocity`, `parentId`) work as for primitives. `Charturbo.createTorusMesh(majorRadius = 8, minorRadius = 2.6, radialSegments = 18, tubularSegments = 32)` generates a test mesh.

### Editing objects

| Method | Returns | Description |
| --- | --- | --- |
| `setObjectTransform(id, { position?, rotation?, scale?, parentId? })` | `boolean` | Partial transform update |
| `getObjectTransform(id)` | `{ position, rotation, scale } \| null` | Current transform, including physics motion |
| `setObjectMaterial(id, { color?, metallic?, roughness?, emissive? })` | `boolean` | Partial material update |
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
