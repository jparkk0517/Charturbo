# Previs: Mannequin Blockout Video

Previs renders a cheap blockout ("mannequin") video from a small JSON document: flat-colored blocks, a camera and motion on one clock. The video fixes **where, at what angle and when**, so the paid AI video model needs ONE generation. Faces, clothes and texture come from reference images and text, not from the previs.

Ko/zh mirrors of this guide are not provided yet.

## Quick start

```bash
cd web
npm run previs:render -- doc.json out.mp4                    # full video (needs Chrome and ffmpeg)
npm run previs:render -- doc.json --still=1.5 --out=t.png    # one cheap preview frame at t=1.5 s
```

| Flag | Description |
| --- | --- |
| `--still=<s>` + `--out=<png>` | Render one frame at time `s`; no ffmpeg |
| `--frames=N` | Render only the first N frames |
| `--backend=webgpu\|webgl2` | Default `webgpu`; falls back to `webgl2` with a warning when not given explicitly |
| `--no-aa` | Disable the 4x MSAA of the main pass |
| `--chrome=<path>` | Chrome binary (or env `CHROME_PATH`) |

Exit codes: `0` ok, `1` render / Chrome / ffmpeg failure, `2` usage error or invalid doc. Issues are printed one per line as `path: message`; the last stdout line is `frames=.. fps=.. size=WxH out=..`.

## Document format

Source of truth: `web/src/previs/types.ts`. Units: meters, radians, sRGB colors `[r, g, b]` in 0..1, Y up.

| Field | Description |
| --- | --- |
| `version` | Must be `1` |
| `title?` | Free text |
| `fps` | Integer 1..120 |
| `size` | `{ width, height }`, even integers 16..4096 |
| `background` | Clear color |
| `worldScale?` | Engine units per meter, default `10` |
| `avoidColors?` | Real-world colors (skin, outfit, set) role colors must stay away from |
| `roles` | `{ id, label, color, reference? }[]`; colors unique and clear of `avoidColors` (Lab distance >= 25) |
| `nodes` | `PrevisNode[]` |
| `shots` | `Shot[]` sorted, covering `[0, duration)` with no gap or overlap |

**Node:** `id` (`[A-Za-z0-9_.-]+`, unique), `shape` (`box`/`sphere`/`cylinder`/`model`), `model` (required for `model`, forbidden otherwise), `color`, `position`, `rotation`, `size`, optional `parent`, `parentJoint` (glTF joint name; needs a `model` parent), `role`, `visible`, `tracks` (`position`, `rotation`, `size`, `visible`, and `joints` on `model` nodes).

**Shot:** `id`, `start`, `end`, `camera: { position: Track, target, fov?, roll? }`. `target` is `{ track }` (look-at points) or `{ follow: nodeId, offset? }`. `fov` is a vertical angle in degrees, default 45. `roll?` is a `Track<number>` in radians, default 0; positive tilts the camera's up toward screen right, so the scene appears to turn counterclockwise. Same track rules as `fov`.

**Track:** `[{ t, v, ease? }]`, `t` strictly increasing; the value is held before the first and after the last key. `ease` applies to the segment starting at that key: `linear` (default), `ease-in`, `ease-out`, `ease-in-out`, `step`. Boolean tracks are always step-wise.

Rules to remember:

- Time is ONE global clock in seconds. Shots only choose the camera; they do not shift time.
- `size` is the full extent of the node's own shape. It does NOT scale children or their offsets. World transform = parent translation + rotation only.
- Rotation is Euler `[rx, ry, rz]` (order YXZ), interpolated per component. Mannequins face +z at rotation 0 (their left is +x).
- Hidden shapes: `visible: false` or a `visible` track (the player draws them with alpha 0).
- `shape: "model"` requires `model: { src, fit?, animation? }`; `model` on any other shape is an error. See "Model nodes (glTF)".

## Mannequin helpers

Import from `web/src/previs/mannequin.ts`. All return plain data and never mutate inputs.

| API | Description |
| --- | --- |
| `createMannequin({ id, color, role?, height?=1.75, position?, limbs? })` | Returns `{ nodes, joints }`. Default is exactly 3 visible blocks (`.lower`, `.upper`, `.head.mesh`) on invisible pivots. `limbs`: `'none'` (default), `'arms'`, `'full'` |
| `walk({ joints, from, to, start, end, stepsPerSecond?=1.8 })` | Root moves `from` to `to`, yaws once to face travel direction, spine bobs, limbs swing |
| `jump({ joints, start, airTime, height, base? })` | Vertical hop of the root |
| `raiseArm({ joints, side, start, end, angle?=2.6, from? })` | Needs arms; holds the final angle |
| `shrug({ joints, start, duration })` | Spine lift, head tilt, arms open |
| `lookAt({ joints, start, end, yaw, from? })` | Head yaw only; holds. Positive yaw turns toward +x |
| `applyMotion(nodes, fragments)` | Merges motion fragments into node tracks; throws on unknown node |
| `attachProp(nodes, parentJointId, { id, size, color, role?, offset? })` | Box child of a joint (e.g. `handR`). `size` = real-world meters |
| `twoToneBox({ id, size, front, back, role?, position? })` | Product-spin box: pivot `id` plus `.front` (+z half) and `.back` (-z half). Spin the pivot's `ry` |

Color helpers (`web/src/previs/handoff.ts`): `suggestRoleColors(count, avoid?)` returns deterministic, distinct colors maximizing distance to `avoid` and to each other; `colorName(rgb, 'ko'|'en')`.

## Model nodes (glTF)

Use a glTF model (`.glb` / `.gltf`) where silhouette, contact or pose matters (a held prop, a vehicle, furniture, human motion from an animated clip). Keep box/sphere/cylinder for blockout volumes.

```json
{ "id": "walker", "shape": "model", "role": "a", "color": [0.5, 0, 1],
  "position": [0, 0.9, 0], "rotation": [0, 0, 0], "size": [0.6, 1.8, 0.4],
  "model": { "src": "models/walker.glb", "fit": "contain",
             "animation": { "clip": "walk", "start": 0.5, "speed": 1, "loop": "repeat" } } }
```

| Field | Description |
| --- | --- |
| `model.src` | Relative path or absolute `http(s):` / `data:` URL; non-empty |
| `model.fit?` | `'contain'` (default): uniform scale so the rest-pose bounds fit inside `size`. `'stretch'`: per-axis, bounds match `size` exactly |
| `model.animation?` | `{ clip, start?, speed?, loop?, blendIn? }` or an array of such segments (see below) |
| `animation.clip` | Clip name or non-negative integer index |
| `animation.start?` | Global seconds at which clip time 0 plays, default `0`; before it the first pose is held |
| `animation.speed?` | Clip seconds per global second, `> 0`, default `1` |
| `animation.loop?` | `'repeat'` (default), `'once'`, `'pingpong'` |
| `animation.blendIn?` | Array form only. Seconds to cross-fade in from the previous segment, `>= 0`, default `0` (hard cut). Must be `0` or absent on the first segment, and at most the time to the next segment's `start` |

Clip segments: `animation` may be an array. Segments are sorted by strictly increasing `start` (`start` is required on every entry after the first). Segment `i` is active on `[start_i, start_{i+1})`. During `[start_i, start_i + blendIn_i)` the pose cross-fades from segment `i-1` to segment `i` with weight `(t - start_i) / blendIn_i`. The previous segment keeps advancing during the fade, and each segment's clip time counts from its own `start`. The example below walks for 2.6 s, then blends into a wave over 0.4 s:

```json
"animation": [
  { "clip": "walk", "loop": "repeat" },
  { "clip": "wave", "start": 2.6, "blendIn": 0.4, "loop": "repeat" }
]
```

Behavior:

- Drawn in the node's flat `color` (the rest of the previs rules apply); textures and material colors are ignored.
- The rest-pose bounds are centered on the node origin and scaled to `size` per `fit`. `size` tracks work. An animated clip can extend beyond the `size` box (fit uses the rest pose, not the clip).
- Clip time = `max(0, t - start) * speed`, wrapped by `loop`. An unknown clip fails the load and lists the available clips: `unknown animation clip "x" (available: ...)`.
- Relative `src` resolves against the doc file's directory in `npm run previs:render`; a missing file fails the render. In the browser viewer (`npm run previs:viewer`) drop or pick the model files with the doc; `src` matches by relative path, then by basename. Use `.glb` there (a `.gltf` with external `.bin` / images cannot resolve them from loose files).
- Programmatic use: `createPrevisPlayer(sdk, doc)` throws for docs with model nodes; use `await loadPrevisPlayer(sdk, doc, { resolveModel?, signal?, decoders? })` (`web/src/previs/player.ts`). `resolveModel(src)` maps `src` to what `sdk.loadGltf` accepts (default: the string as URL). Failures reject with `loadPrevisPlayer: node "<id>" (<src>): <cause>` and remove everything created.
- Millimeter-unit files are handled: the player reloads with a baked scale when the fit factor would fall under the engine's 0.05 clamp.
- Handoff: the prompt still maps role colors to labels. A model gives the video model an accurate silhouette and pose; look still comes from references.

Example: `web/previs/examples/model-demo.json` (models in `web/previs/examples/models/`, generated by `models.gen.ts`).

**Joint poses.** `tracks.joints` (model nodes only) turns individual glTF joints by hand on top of the clip. It maps a joint name to a `Track<Vec3>`. The joint name is the glTF node name and must be unique in the model. Each value is Euler `[rx, ry, rz]` in radians, order YXZ like `rotation`, applied additively in the joint's local frame: local rotation = clip pose * offset. `[0, 0, 0]` leaves the joint unchanged; without a clip the rest pose is the base. Same track rules as other tracks. Joints work with or without clip segments. An unknown joint name fails the load with `loadPrevisPlayer: node "<id>" (<src>): unknown joint "<name>" (joints: ...)`. Example: raise the walker's right arm between 0.5 s and 1.0 s:

```json
"tracks": { "joints": { "upperArm.R": [ { "t": 0.5, "v": [0, 0, 0] }, { "t": 1.0, "v": [-1.2, 0, 0] } ] } }
```

**Props on joints.** `parentJoint` on a child of a `shape: "model"` node attaches it to that glTF joint: the child follows the joint's current posed frame (clip, blend, `tracks.joints`) with the joint's scale removed. Use it for weapons and props held by a model. `position`/`rotation` are in meters in the joint frame and are NOT scaled by the model's `fit`. When the model is drawn at another size than its natural size, multiply offsets along the bone by k = fitted size / natural size (contain: `k = size.y / naturalHeight`, e.g. walker 1.75 m drawn at 3.2 m: `k = 3.2 / 1.75`, forearm end `y = -0.28 * k`). Example: a stick held in the walker's right forearm (natural size), pointing forward:

```json
{ "id": "stick", "shape": "box", "parent": "walker", "parentJoint": "lowerArm.R", "color": [0.1, 0.85, 0.95],
  "position": [0, -0.28, 0.3], "rotation": [1.5707963267948966, 0, 0], "size": [0.04, 0.6, 0.04] }
```

Restrictions: `parentJoint` without a `model` parent is rejected, and so is a camera `follow` of a joint-attached node or its descendants; follow the model node with an offset instead. Programmatic pose reads: `GltfAnimator.nodeMatrix(node)`.

**Compressed models.** Draco (`KHR_draco_mesh_compression`) and meshopt (`EXT_meshopt_compression`) `.glb` files work as-is in `npm run previs:render` and the viewer: each run detects the extensions in the model file and loads only the decoder it needs (`draco3d` and `meshoptimizer` are devDependencies). Programmatic use passes `decoders: { meshopt?, draco? }` to `loadPrevisPlayer`, which forwards them to every model load. The SDK ships no decoder: `meshopt` is `MeshoptDecoder` from `meshoptimizer`, `draco` is the module `await createDecoderModule()` from `draco3d` resolves to. A file that requires an extension without its decoder fails with `loadGltf: EXT_meshopt_compression is required; pass options.decoders.meshopt ...` (or the Draco equivalent). Not supported: `KHR_meshopt_compression`, Draco point clouds, Draco on triangle strips/fans.

## Validation

`validateDoc(json)` (`web/src/previs/validate.ts`) returns `{ ok: true, doc }` or `{ ok: false, issues }` with at most 50 issues, each `{ path, message }`, for example `nodes[3].tracks.position[2].t: keyframe times must strictly increase ...`. It checks types and ranges, unique ids, existing `parent`/`role`/`follow` ids, parent cycles, strictly increasing keys, shot coverage, role color distance and `model` fields (`model` required iff `shape` is `model`; `fit`, `clip`, `start`, `speed`, `loop` values). The CLI runs it first and exits `2` on failure.

## Flat-color rendering

A node renders as exactly its `color`. The player uses shading model `pbr` with `toneMapping: 'none'`, exposure 1, environment/ambient/directional/point intensity 0, material emissive 1, metallic 0, roughness 1, so output equals the base color at every viewing angle. Shadows, helpers, graph and physics are off. Measured error is <= 0.5/255 on face-on swatches and on faces tilted 40, 61 and 77 degrees (`web/previs/examples/flat-swatches.json`). The `classic` model is not used: its fresnel rim lifts channels (up to 16/255 at 77 degrees).

## Handoff

`buildHandoff(doc, { references?, textOnly?, lang?='ko' })` returns `{ uploadOrder, prompt }`.

| Option | Description |
| --- | --- |
| `references` | `{ name, role?, note? }[]`; a role's `reference` must equal a `name` to be linked |
| `textOnly` | Directions the previs cannot carry (hands, expression, texture) |
| `lang` | `'ko'` or `'en'` |

`uploadOrder` is `['previs video', ...reference names]`. The prompt lists attachments in that order, maps each color to its role (and reference image), and tells the model to follow the previs camera and motion exactly and take appearance only from reference images.

## Limits

- The engine clamps object scale to >= 0.05 units: a mesh thinner than `0.05 / worldScale` m per axis is drawn at 0.05 units.
- Looking straight down, screen-up is world -Z; looking straight up, screen-up is world +Z.
- `fov` outside 10..120 is rejected by `validateDoc` (the engine clamps to that range).
- `jump()` without `base` moves the root to the origin; always pass `base` (the node's rest position).
- `fov` is vertical. In portrait output (height > width) the horizontal view is narrow; raise `fov` or move the camera back, and verify with `--still`.
- No per-object visibility API: hiding = alpha 0.
- Model nodes: clip segments with cross-fade are supported (array form above); textures and material colors are dropped; only the rest pose drives `fit`.
- Motions on the same node and property must not overlap in time; `applyMotion` does not detect it and interleaves keys. Sequence them (for example two `walk`s on one root, back to back).

## Minimal example

```json
{
  "version": 1,
  "title": "minimal",
  "fps": 24,
  "size": { "width": 640, "height": 360 },
  "background": [0.2, 0.2, 0.2],
  "roles": [{ "id": "a", "label": "main woman", "color": [0.5, 0, 1] }],
  "nodes": [
    { "id": "a.body", "shape": "box", "role": "a", "color": [0.5, 0, 1],
      "position": [0, 0.9, 0], "rotation": [0, 0, 0], "size": [0.4, 1.8, 0.25],
      "tracks": { "position": [
        { "t": 0, "v": [-1, 0.9, 0] },
        { "t": 2, "v": [1, 0.9, 0] }
      ] } }
  ],
  "shots": [
    { "id": "s1", "start": 0, "end": 2,
      "camera": { "position": [{ "t": 0, "v": [0, 1.5, 5] }],
                  "target": { "follow": "a.body" } } }
  ]
}
```
