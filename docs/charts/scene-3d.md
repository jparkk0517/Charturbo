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
| `castShadow` / `receiveShadow` | `boolean` | `true` | Shadow participation, see [Shadows](#shadows) |

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
| `castShadow` / `receiveShadow` | `boolean` | `true` | Shadow participation, see [Shadows](#shadows) |

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
- **Materials.** `baseColorFactor` is converted from linear to the renderer's gamma space; `baseColorTexture` becomes `map` (`TEXCOORD_0` only; `KHR_texture_transform` offset and scale become `mapOffset` / `mapRepeat`); `metallicFactor` and `roughnessFactor` default to 1 as in glTF; `emissiveFactor` (times the emissive strength) becomes `emissiveColor`, and its largest component `emissive` for classic shading; metallic-roughness, normal, occlusion and emissive textures become the [material maps](#material-maps) (`TEXCOORD_0` only; all textures of a material share one uv transform, others are ignored with a warning). `alphaMode: 'MASK'` sets `alphaTest` to `alphaCutoff` (default 0.5), `'BLEND'` keeps the color alpha and `'OPAQUE'` forces color alpha 1. Images used by several materials are decoded once.
- **Ignored.** Samplers (textures always repeat with linear filtering). With a warning: texture transform rotation, textures on `TEXCOORD_1` or higher, skins (meshes render in their bind pose), morph targets, animations, cameras and other extensions. A model that lists an unsupported extension in `extensionsRequired` is rejected with `loadGltf: extension X is required but not supported`.
- **Limits.** One load creates at most `GLTF_MAX_VERTICES` (8,388,608) vertices and `GLTF_MAX_INDICES` (67,108,864) indices. All objects share one geometry buffer, so several large models can still exceed the GPU's buffer limit. Textures follow the texture limits above.
- **Errors.** Error messages start with `loadGltf:`. On any failure, including an abort, the objects and textures created so far are removed.
- All objects of one model use the model origin as pivot, so applying the same `position` / `rotation` with `setObjectTransform` to each of `result.objects` moves the model as a whole.

### Editing objects

| Method | Returns | Description |
| --- | --- | --- |
| `setObjectTransform(id, { position?, rotation?, scale?, parentId? })` | `boolean` | Partial transform update |
| `getObjectTransform(id)` | `{ position, rotation, scale } \| null` | Current transform, including physics motion |
| `setObjectMaterial(id, { color?, metallic?, roughness?, emissive?, map?, mapRepeat?, mapOffset?, alphaTest?, ...material maps })` | `boolean` | Partial material update |
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

## Physically based shading

Scene meshes use the classic Blinn-Phong look by default. `setShading({ model: 'pbr' })` switches them to opt-in physically based shading (charts, scientific 3D and the 3D graph never change):

```ts
const sky = await sdk.loadTexture('/env/sky-equirect.jpg'); // 2:1 equirectangular, mipmapped
sdk.setShading({
  model: 'pbr',
  toneMapping: 'aces',
  exposure: 1.2,
  environment: { map: sky, intensity: 1 },
});
sdk.addSphere({ position: [0, 10, 0], scale: [20, 20, 20], color: [1, 0.78, 0.35, 1], metallic: 1, roughness: 0.2 });
```

- Metallic-roughness model: GGX distribution, height-correlated Smith visibility, Schlick Fresnel with `F0 = mix(0.04, color, metallic)` and a Lambert diffuse term. `roughness` is clamped to at least 0.045. The directional and point lights from `setLighting` and `emissive` apply as before; `ambientIntensity` is classic only (PBR ambient light comes from the environment).
- Colors stay sRGB like everywhere else. The shader decodes them (and textures) to linear, lights in linear space, multiplies by `exposure`, tone maps (`'aces'`, `'reinhard'` or `'none'`) and encodes back to sRGB.
- Environment: without `map` a sky / ground hemisphere (`sky`, `ground`, sRGB `[r, g, b]` in 0..1) lights the scene. With `map` (an equirectangular texture id from `loadTexture` / `createDataTexture`, top row = up, the center column faces −z) specular reflections sample a mip level that grows with roughness and diffuse light uses a blurry mip, with an analytic split-sum approximation instead of prefiltered maps. Keep the default `mipmaps: true`. HDR maps are prefiltered instead; see [HDR environment maps](#hdr-environment-maps). An unknown or disposed id falls back to the hemisphere; `disposeTexture` clears it.
- `setShading` merges into the current settings and throws `setShading: ...` for invalid values; `getShading()` returns a copy. `exportScene()` stores the settings in `shading` (and the environment texture in `textures`), `loadScene` restores them and `loadSceneWithTextures` remaps the environment texture id.
- The PBR pipelines are compiled on first use. Both WebGPU and WebGL2 are supported.

| Shading option | Type | Default |
| --- | --- | --- |
| `model` | `'classic' \| 'pbr'` | `'classic'` |
| `toneMapping` | `'aces' \| 'reinhard' \| 'none'` | `'aces'` |
| `exposure` | `number` (0..16) | `1` |
| `environment.sky` | `[r, g, b]` | `[0.6, 0.66, 0.76]` |
| `environment.ground` | `[r, g, b]` | `[0.24, 0.22, 0.2]` |
| `environment.intensity` | `number` (0..16) | `1` |
| `environment.map` | `number \| null` | `null` |
| `environment.rotation` | `number` (radians around +y) | `0` |

### HDR environment maps {#hdr-environment-maps}

High dynamic range environments light PBR meshes with real radiance: a sun of value 50 stays a sharp, bright highlight on smooth metal instead of clipping at 1.

```ts
const studio = await sdk.loadEnvironmentHdr('/env/studio.hdr'); // Radiance RGBE, flat or RLE
sdk.setShading({ model: 'pbr', exposure: 0.8, environment: { map: studio, rotation: Math.PI / 2 } });

// Or from linear floats: width * height * 3, top row = up
const env = sdk.createEnvironmentFromFloat(256, 128, rgb);
```

- `loadEnvironmentHdr(source, { signal })` takes a URL string, `URL`, `Blob`, `ArrayBuffer` or typed array holding a Radiance `.hdr` file (`#?RADIANCE` / `#?RGBE`, `FORMAT=32-bit_rle_rgbe`, `-Y h +X w` or `+Y h +X w`). `createEnvironmentFromFloat(width, height, rgb)` takes linear RGB floats. Both return a texture id for `environment.map` and accept at most 4096x2048; errors are prefixed with the method name, and an aborted `signal` rejects with an `AbortError`.
- At creation the equirect image is downsampled to at most 1024 texels wide, stored as `Rgba16Float` and prefiltered once on the GPU: mip `i` of `n` holds the GGX convolution for roughness `i / (n - 1)` (128 importance samples per texel, the smallest mip is 8 texels high), so rough reflections are blurred the way the BRDF blurs them. Diffuse light comes from a 9-coefficient spherical-harmonics projection of the map. Values above 1 are kept until `exposure` and tone mapping (values above 65504 are clamped, negative and NaN texels become 0).
- A 1024x512 map takes about 5.6 MB (`getTextures()` lists it with `hdr: true`; it counts against the texture budget and `getRenderStats().gpuBytes`). `disposeTexture` frees it. Prefiltering costs a few milliseconds on WebGPU and tens of milliseconds on WebGL2. A WebGL2 device that cannot render to half floats gets plain box-filtered mips instead (blurrier rough reflections, same API).
- GPU errors while prefiltering (validation, out of memory) free the map again. `loadEnvironmentHdr` rejects with them and `createEnvironmentFromFloat` throws them on WebGL2. WebGPU reports them asynchronously, so there `createEnvironmentFromFloat` returns the id first and frees the map later with a console warning; `await sdk.environmentReady(env)` resolves once the map is known to be valid and rejects with the error otherwise.
- `environment.rotation` turns any environment map (HDR or LDR) around +y. HDR textures are for `environment.map` only: as an object `map` they render white. `exportScene` marks them with `hdr: true` so `loadSceneWithTextures` reloads those with a `src` through `loadEnvironmentHdr`.

### Material maps

glTF-style texture maps refine the PBR material per texel. They are used by `model: 'pbr'` only (classic shading ignores them), and objects without maps render exactly as before:

```ts
const normal = await sdk.loadTexture('/tex/bricks-normal.png');
const orm = await sdk.loadTexture('/tex/bricks-mr.png');
sdk.addBox({
  map: bricks,
  metallicRoughnessMap: orm,  // B = metalness, G = roughness
  normalMap: normal,
  normalScale: 1,
  aoMap: orm,                 // R = occlusion (a packed ORM texture works for both)
  emissiveMap: windows,
  emissiveColor: [1, 0.6, 0.2],
});
```

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `metallicRoughnessMap` | `number \| null` | `null` | Blue channel multiplies `metallic`, green multiplies `roughness` (linear data) |
| `normalMap` | `number \| null` | `null` | Tangent-space normal map, OpenGL / glTF convention (green = up in the image) |
| `normalScale` | `number` | `1` | Scales the map's x / y (clamped to −16..16) |
| `aoMap` | `number \| null` | `null` | Ambient occlusion in the red channel (linear); darkens environment light only |
| `aoStrength` | `number` | `1` | 0..1: `1 + aoStrength × (ao − 1)` |
| `emissiveColor` | `[r, g, b]` | `[0, 0, 0]` | Linear emitted color (glTF `emissiveFactor`, 0..1000). When non-black it replaces the PBR `color × emissive` glow |
| `emissiveMap` | `number \| null` | `null` | sRGB texture multiplying `emissiveColor` (no effect while it is black) |

- The fields work on every `add*` method, `addCustomMesh` and `setObjectMaterial` (only the given fields change; `null` or `0` clears a slot). `getObjectRecord` returns them, `disposeTexture` clears every slot that used the texture, `exportScene` writes them (only for objects that have maps) with their textures in `textures`, `loadScene` drops unknown ids with a warning and `loadSceneWithTextures` remaps them.
- Every map uses the object's uvs and `mapRepeat` / `mapOffset`, with or without a base `map`.
- The normal map's tangent frame comes from screen-space derivatives of the position and uvs (no vertex tangents), so it works on every mesh, including mirrored uvs; glTF `TANGENT` attributes are not used. Shadows keep using the geometric normal.
- Images are uploaded as RGBA8 like other textures, so a single packed ORM (occlusion-roughness-metalness) texture can be used for both `aoMap` and `metallicRoughnessMap`.
- `loadGltf` reads `metallicRoughnessTexture`, `normalTexture` (`scale`), `occlusionTexture` (`strength`) and `emissiveTexture` (with `emissiveFactor` × the emissive strength as `emissiveColor`).

## Shadows

`setShadows({ enabled: true })` turns on shadow mapping from the `setLighting` directional light (off by default; charts, scientific 3D and the 3D graph never cast or receive):

```ts
sdk.setLighting({ directionalDirection: [0.6, 1, 0.3] }); // points toward the light
sdk.setShadows({ enabled: true, mapSize: 2048, softness: 1.5 });
sdk.addSphere({ position: [0, 30, 0], castShadow: false }); // no shadow
sdk.addBox({ position: [20, 5, 0], receiveShadow: false }); // never darkened
```

- One depth-only pass from the directional light renders every visible opaque object with `castShadow` into a `Depth32Float` map before the main pass; the light's orthographic camera fits the casters and receivers (`bounds: 'auto'`, snapped to whole texels so the shadows do not shimmer when the camera moves) or a fixed sphere `bounds: { center, radius }`. A large auto-fit scene spreads the map over a larger area, so use fixed bounds around the interesting part of a big scene.
- Shadows attenuate only the directional light (ambient, point light, emissive and the PBR environment stay), in both the classic and PBR models, scaled by `darkness`.
- Edges are filtered with hardware-compared PCF over a 4 × 4 grid spanning `softness` texels (`softness: 0` = one hard tap). `bias` (constant, grows with the surface slope) and `normalBias` (receiver offset along its normal) are in shadow-map texels; raise them if you see shadow acne, lower them if shadows detach from their casters.
- Translucent objects (`color` alpha below 1) do not cast; alpha-tested textures (`alphaTest`) cut matching holes into the shadow. `castShadow` / `receiveShadow` default to `true` on primitives, custom meshes and glTF objects and can be changed later with `setObjectMaterial`.
- `setShadows` merges into the current settings and throws `setShadows: ...` for invalid values; `getShadows()` returns a copy with `mapSize` clamped to the device's texture limit. `exportScene()` stores the settings in `shadows` and the per-object flags, and `loadScene` restores them.
- The map is allocated when shadows are enabled (2048² = 16 MiB, counted in `getRenderStats().gpuBytes`), recreated when `mapSize` changes and released on disable. Shadows cost one extra depth pass over the casting objects per frame. Both WebGPU and WebGL2 are supported.

| Shadow option | Type | Default |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `mapSize` | `512 \| 1024 \| 2048 \| 4096` | `2048` |
| `bias` | `number` (0..16 texels) | `0.5` |
| `normalBias` | `number` (0..16 texels) | `1` |
| `softness` | `number` (0..8 texels) | `1.5` |
| `darkness` | `number` (0..1) | `1` |
| `bounds` | `'auto' \| { center: [x, y, z]; radius }` | `'auto'` |
| `point` | `ScenePointShadowsDescriptor` | off, see [Point-light shadows](#point-light-shadows) |

### Point-light shadows {#point-light-shadows}

`setShadows({ point: { enabled: true } })` adds omnidirectional shadows of the `setLighting` point light (`pointPosition`). It is off by default and independent of the directional settings, so either kind or both can be on:

```ts
sdk.setLighting({ pointPosition: [0, 26, 0], pointIntensity: 1.6 });
sdk.setShadows({ point: { enabled: true, mapSize: 512, softness: 1 } });
sdk.addSphere({ position: [0, 26, 0], scale: [2, 2, 2], emissive: 1, castShadow: false }); // lamp bulb
```

- Six depth-only passes (one per 90° cube face, from the light position) render the opaque `castShadow` objects into a `Depth32Float` cube map before the main pass. Each face stores reversed-Z perspective depth between `near` and `far`; the receivers recompute the same depth for their own position and compare it in hardware, so the cube's faces and seams are filtered without gaps.
- The shadow attenuates only the point light, scaled by `darkness`, in both the classic and PBR models. Edges are filtered with a 3 × 3 grid of bilinear comparison taps spanning `softness` texels at the receiver's distance (`softness: 0` = one hardware-filtered tap). `bias` (grows with the surface slope) and `normalBias` are in texels at the receiver's distance.
- `near` (world units, default `0.5`) skips casters closer to the light, such as a lamp bulb; `far: 'auto'` (default) reaches the far side of every caster and receiver, a number fixes it (at least `2 * near`).
- The cube map is allocated on enable (`6 × mapSize² × 4` bytes: 1.5 MiB at 256, 6 MiB at 512, 24 MiB at 1024, counted in `getRenderStats().gpuBytes`), recreated when `mapSize` changes and released on disable. While off there are no extra passes and the shaders are unchanged. With point shadows on, every frame draws the casters six times, so prefer `mapSize: 512` and keep the caster count modest. WebGPU and WebGL2 are both supported.
- `getShadows().point` returns the settings with `mapSize` clamped to the device; `exportScene()` / `loadScene` store and restore them with the rest of `shadows` (scenes saved without `point` keep the current point settings).

| Point shadow option | Type | Default |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `mapSize` | `256 \| 512 \| 1024` | `512` |
| `bias` | `number` (0..16 texels) | `1` |
| `normalBias` | `number` (0..16 texels) | `1` |
| `softness` | `number` (0..8 texels) | `1` |
| `darkness` | `number` (0..1) | `1` |
| `near` | `number` (0.01..1e6) | `0.5` |
| `far` | `number \| 'auto'` | `'auto'` |

## Anti-aliasing

Multisample anti-aliasing (MSAA) is off by default. Turn it on at creation or at runtime:

```ts
const sdk = await Charturbo.create(canvas, { antialias: true }); // or 4
sdk.setAntialias(1); // off
sdk.setAntialias(4); // MSAA x4
sdk.getAntialias(); // applied count: 1 or 4
```

- With 4 samples the main pass renders into multisampled color and depth targets and resolves them into the canvas. Stair-stepped mesh silhouettes and intersections (thin rods, box and plank edges) become smooth. Texture interiors, the shadow map, offscreen passes and DOM text are unchanged. 2D chart lines and markers are already anti-aliased by their shaders, so they barely change.
- `antialias` takes `true` / `4` (4 samples) or `false` / `1` (off). `setAntialias` takes `1` or `4` and throws `setAntialias: ...` for anything else. If the device cannot render the canvas format with 4 samples, the setting stays at `1` and a console warning is logged; `getAntialias()` reports the applied count.
- Cost: the multisampled targets take 4 × (color + depth) bytes per canvas pixel (480 × 300 ≈ 4.4 MiB, counted in `getRenderStats().gpuBytes`), plus 4x fill rate in the main pass. They are created when MSAA turns on, recreated on resize and released on `setAntialias(1)`. With MSAA off nothing is allocated and the pipelines are unchanged.
- Canvas export (`toImage`, `toDataURL`) sees the resolved image. WebGPU and WebGL2 are both supported. The setting belongs to the canvas, not the scene: `exportScene` does not store it.

## Post-processing {#post-processing}

Bloom and auto exposure (eye adaptation) are opt-in HDR effects of the PBR scene meshes. Both are off by default:

```ts
sdk.setShading({ model: 'pbr', toneMapping: 'aces' });
sdk.setPostProcessing({
  bloom: { enabled: true, intensity: 0.8, threshold: 1, knee: 0.5, radius: 0.7 },
  autoExposure: { enabled: true, minEv: -4, maxEv: 4, speedUp: 3, speedDown: 1, compensation: 0 },
});
sdk.addSphere({ position: [0, 10, 0], emissiveColor: [8, 2.4, 0.5] }); // HDR emissive glows
sdk.getPostProcessing(); // { bloom, autoExposure, supported, active }
```

- With an effect on, the meshes render into an `Rgba16Float` HDR target (with MSAA, a multisampled one resolved into it) without tone mapping. A fullscreen composite then applies the exposure, adds the bloom, tone maps (`setShading({ toneMapping })`), blends over the clear color and encodes sRGB into the canvas. 2D charts, nodes, edges and helper lines draw on top of the composite unchanged, so they also draw over translucent meshes.
- Bloom: a prefilter keeps the exposed brightness above `threshold` with a soft `knee` (and averages bright pixels so single sparkles do not flicker), a chain of up to 6 half-size mips downsamples it with a 13-tap filter, and tent upsamples add it back up the chain. `radius` widens the glow, `intensity` scales it. Emissive colors above 1, a strong sun and HDR environment maps bloom the most.
- Auto exposure: every frame the GPU meters the average log luminance of the meshes (64 × 64, reduced to 1 × 1; the background is ignored) and adapts the exposure toward EV `log2(average / 0.18)`, clamped to `minEv..maxEv`, plus `compensation`. The value stays on the GPU (no readback). `setShading({ exposure })` still multiplies the result. `adaptation: 'smooth'` (default) moves at `speedUp` / `speedDown` per second of rendered frames, so render continuously (an animation loop) to watch it settle; `adaptation: 'instant'` meters every frame. The first frame after enabling always snaps.
- Needs the PBR model (classic shading is display referred and stays unchanged; `active` is `false`). Devices without float render targets (WebGL2 without `EXT_color_buffer_float`) skip post-processing: the scene renders as before and `getPostProcessing().supported` is `false`. WebGPU and WebGL2 with the extension are both supported.
- Cost: nothing while both effects are off (no targets, no extra passes, unchanged pipelines). On, the HDR target takes 8 bytes per pixel (32 with MSAA x4, plus the 8-byte resolve), the bloom mips about a third of that, and the exposure chain 34 KiB, all counted in `getRenderStats().gpuBytes`. Targets are created on enable, recreated on resize and MSAA changes, and released when both effects turn off. Headless Chrome (Apple M1, 1280 × 720, 41 PBR meshes) measured 0.72 ms off, 1.18 ms bloom, 1.36 ms bloom + auto exposure per frame on WebGPU, and 1.09 / 1.72 / 1.82 ms on WebGL2.
- `setPostProcessing` merges into the current settings and throws `setPostProcessing: ...` for invalid values. `exportScene()` stores the settings in `postProcessing` and `loadScene` restores them.

| Bloom option | Type | Default |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `intensity` | `number` (0..8) | `0.6` |
| `threshold` | `number` (0..64, exposed linear brightness) | `1` |
| `knee` | `number` (0..1, fraction of the threshold) | `0.5` |
| `radius` | `number` (0..1) | `0.7` |

| Auto exposure option | Type | Default |
| --- | --- | --- |
| `enabled` | `boolean` | `false` |
| `minEv` / `maxEv` | `number` (-16..16, `maxEv >= minEv`) | `-4` / `4` |
| `speedUp` / `speedDown` | `number` (0..100 per second) | `3` / `1` |
| `compensation` | `number` (-8..8 EV) | `0` |
| `adaptation` | `'smooth' \| 'instant'` | `'smooth'` |

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

- `raycastObjectAtNdc(ndcX, ndcY)` returns the nearest hit object and the world-space hit point. Spheres, planes and cylinders (sides and caps) are intersected analytically, boxes as boxes, and custom meshes per triangle after a bounding-box test; meshes of 64+ triangles use a triangle BVH built on the first pick, and objects whose world bounds the ray misses are skipped.
- `pickObjectAtNdc(ndcX, ndcY)` returns only the object ID (`null` for none).
- `selectObject(id | null)` highlights an object (large static planes get an outline-only selection).

## Save and load

`exportScene()` returns a serializable `SceneDescriptor` (objects with transforms, materials and physics, plus lighting, shading, helpers, rigid physics and graph visibility). `loadScene(descriptor)` clears the scene, applies the settings and recreates the objects, returning their new IDs.

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

The scene uses the same orbit camera as the [3D graph](./graph-3d#camera): mouse and touch controls, `setCameraPose(eye, target)`, `rotateCamera`, `panCamera`, `zoomCamera` and `getCameraState()`. For first-person movement use `moveCameraLocal(forward, right, up)` and `rotateCameraLook(deltaYaw, deltaPitch)`. `setCameraFov(degrees)` sets the vertical field of view (default 45, clamped to 10-120); call `fitToView()` afterwards to re-frame the content for the new angle.

## Notes

- `Charturbo.create` generates a 1000-node graph unless you pass `nodeCount: 0, edgeCount: 0`. Use `setGraphVisible(false)` when the canvas shows only the scene; a visible graph and the scene can also share the canvas.
- Rendering a chart (`render*Chart`) puts the canvas in chart mode; the built-in camera controls apply only while no chart is shown.

## See also

- [3D Network Graph](./graph-3d)
- [Interactions](../guide/interactions)
- [Performance](../guide/performance)
