# Previs: Mannequin Blockout Video

Previs renders a cheap blockout ("mannequin") video from a small JSON document: flat-colored blocks, a camera and motion on one clock. The video fixes **where, at what angle and when**, so the paid AI video model needs ONE generation. Faces, clothes and texture come from reference images and text, not from the previs.

Ko/zh mirrors of this guide are not provided yet.

## Quick start

```bash
cd web
npm run previs:render -- doc.json out.mp4                    # full video (needs Chrome and ffmpeg)
npm run previs:render -- doc.json --still=1.5 --out=t.png    # one cheap preview frame at t=1.5 s
npm run previs:render -- doc.json out.mp4 --format=mp4-lossless   # exact role colors (for masks)
npm run previs:render -- doc.json shots/ --format=png-seq         # PNG frames, no ffmpeg
npm run previs:render -- doc.json out.mp4 --split-shots          # one file per shot + out.cuts.json
```

| Flag | Description |
| --- | --- |
| `--still=<s>` + `--out=<png>` | Render one frame at time `s`; no ffmpeg |
| `--frames=N` | Render only the first N frames |
| `--format=mp4\|mp4-lossless\|png-seq` | Default `mp4`: H.264 yuv420p, crf 14 (about 2% of pixels at color edges differ from the role palette; fine for viewing). `mp4-lossless`: RGB lossless H.264 (`libx264rgb -crf 0`), pixel-exact role colors; many players cannot play it; ffmpeg must have libx264rgb. `png-seq`: `<out>` is a directory of `frame_000000.png` ..., no ffmpeg. Use lossless or png-seq when the colors are used as masks |
| `--shot=<id>` | Render one shot |
| `--range=<a>..<b>` | Render frames with `a <= t < b` (seconds). `--shot` and `--range` are exclusive |
| `--handles=<s>` | Extend `--shot`, `--range` or each `--split-shots` shot by `s` seconds on both sides, clamped to the doc. Without one of those three: exit 2 |
| `--force` | png-seq only: delete existing `frame_NNNNNN.png` files (only those) in the target directory (per-shot subdirectories with `--split-shots`). Without it, a directory that already holds such files exits 2 |
| `--split-shots` | One file per shot: `<stem>.<shotId>.<ext>` (png-seq: `<out>/<shotId>/`) plus `<stem>.cuts.json` = `[{ shot, start, end, frames: [first, last] }]` (global frame indices; seconds include handles). A shot shorter than one frame is skipped (warning, no file, `frames: []`). Not combinable with `--shot`, `--range` or `--frames` |
| `--camera-json=<file>` | Per-frame camera export: `{ frame, t, shot, eye, target, up, roll, fovDeg, aspect, near, far, worldScale, view[16], projection[16] }`. eye/target in meters; near/far/matrices in engine units (column-major, reverse-Z, clip = projection * view * [p, 1]); a top-level `units` field states this |
| `--backend=webgpu\|webgl2` | Default `webgpu`; falls back to `webgl2` with a warning when not given explicitly |
| `--no-aa` | Disable the 4x MSAA of the main pass |
| `--chrome=<path>` | Chrome binary (or env `CHROME_PATH`) |

Exit codes: `0` ok, `1` render / Chrome / ffmpeg failure, `2` usage error or invalid doc (unknown shot, bad format, bad range). Issues are printed one per line as `path: message`; the last stdout line is `frames=.. fps=.. size=WxH out=.. format=..`.

## Depth pass

`--passes` adds a depth map for AI video conditioning (ControlNet depth, Wan VACE, LTX-Video depth IC-LoRA). It is written next to the beauty output. The engine side is `setRenderPass` / `getRenderPass` / `readDepthRange` in `web/src/sdk/scene-depth.ts`.

```bash
npm run previs:render -- previs/examples/gate-raid.json out/raid --passes=beauty,depth --split-shots --format=png-seq
```

| Flag | Description |
| --- | --- |
| `--passes=beauty\|depth\|beauty,depth` | Default `beauty`. `depth` writes only the depth output (`<out>` is then only the base name). `beauty,depth` writes both; beauty bytes are the same as a beauty-only run |
| `--depth-range=shot\|frame\|<near>..<far>` | Default `shot`. `shot`: one range per output job (a split shot incl. handles, or the whole render), from the foreground min / max depth over its frames. `frame`: per frame. `<near>..<far>`: fixed, in meters, `0 < near < far`. A measured `near == far` (one flat surface) fails; pass a fixed range. Without `depth` in `--passes` this flag exits 2 |
| `--depth-encoding=inverse\|linear` | Default `inverse`. Without `depth` in `--passes` this flag exits 2 |

Encoding: `D` is the planar view depth (distance along the camera's view axis, in meters). `inverse` (default): `v = (1/D - 1/far) / (1/near - 1/far)`; `linear`: `v = (far - D) / (far - near)`. `v` is clamped to 0..1 and written as `round(255 v)`. The nearest distance (`near`) is white (255), the farthest (`far`) is black (0), and nothing drawn (background) is 0. The value is gray with R = G = B. One range per shot keeps the brightness of a shot stable, so the same depth looks the same across its frames.

Output files (`<stem>` is `<out>` without its extension; with `png-seq`, `<out>` is the directory):

| Case | File |
| --- | --- |
| mp4 formats | `<stem>.depth.mp4` (same `--format` codec as beauty) |
| `--format=png-seq` | `<stem>.depth/` (`frame_NNNNNN.png`) |
| `--split-shots`, mp4 | `<stem>.<shotId>.depth.mp4` |
| `--split-shots`, png-seq | `<stem>.depth/<shotId>/` |
| always (with depth) | `<stem>.depth.json` = `[{ shot, near_m, far_m, encoding, range, formula }]`; `shot` is `null` when not split, `near_m` / `far_m` are `null` with no foreground pixel |
| `--still` | `<stem>.depth.png` (+ `.depth.json`); range from that frame alone |

Rules:

- The depth pass renders without anti-aliasing, so edges are hard. In one run the beauty jobs keep their 4x MSAA and run first; the depth jobs then run with MSAA off. With `--passes=depth` the page loads with MSAA off. `--no-aa` together with `--passes=depth` exits 2.
- Only geometry that writes depth appears: opaque meshes, opaque graph nodes, bars and 3D markers / fills. Translucent meshes, 2D lines and overlays write no depth, so they show as background.
- `--format=mp4` is yuv420p limited range (0..255 becomes 16..235), so the gray levels are coarser. When exact values matter (masks, training data, measurements), use `--format=png-seq` or `--format=mp4-lossless`.
- Models: ControlNet depth ([lllyasviel/sd-controlnet-depth](https://huggingface.co/lllyasviel/sd-controlnet-depth)) and Wan VACE ([VACE depth annotators](https://github.com/ali-vilab/VACE/blob/main/vace/annotators/depth.py), MiDaS / Depth Anything V2 inverse depth) use near = white. Wan VACE preprocessing normalizes depth per frame, so `--depth-range=frame` matches it exactly. The LTX-Video depth IC-LoRA guide asks for a consistent range across frames (the default `shot`) but does not state the polarity.

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
| `markers?` | `{ t, label }[]`: timed events on the global clock (seconds within the doc); `label` non-empty. Listed in the handoff prompt |

**Node:** `id` (`[A-Za-z0-9_.-]+`, unique), `shape` (`box`/`sphere`/`cylinder`/`model`), `model` (required for `model`, forbidden otherwise), `color`, `position`, `rotation`, `size`, optional `parent`, `parentJoint` (glTF joint name; needs a `model` parent), `role`, `visible`, `tracks` (`position`, `rotation`, `size`, `visible`, and `joints` on `model` nodes).

**Shot:** `id`, `start`, `end`, `camera: { position: Track, target, fov?, roll?, up? }`, `note?` (free text; shown in the handoff shot list). `target` is `{ track }` (look-at points) or `{ follow: nodeId, offset? }`. `fov` is a vertical angle in degrees, default 45. `roll?` is a `Track<number>` in radians, default 0; positive tilts the camera's up toward screen right, so the scene appears to turn counterclockwise. Same track rules as `fov`. `up?` is a `Track<Vec3>` giving the world up direction over time, default `[0, 1, 0]`; it need not be unit length, a zero vector is rejected, neighbouring keys must not point in opposite directions (the interpolation would pass through zero; add an intermediate key), and `roll` is applied on top of it. Use it for a crane over the target: key `[0, 1, 0]` at the start and `[0, 0, -1]` once the eye is above the target. Without that switch the image flips 180° when the view direction passes through the fixed up.

**Track:** `[{ t, v, ease? }]`, `t` strictly increasing; the value is held before the first and after the last key. `ease` applies to the segment starting at that key: `linear` (default), `ease-in`, `ease-out`, `ease-in-out`, `step`. Boolean tracks are always step-wise.

Rules to remember:

- Time is ONE global clock in seconds. Shots only choose the camera; they do not shift time.
- `size` is the full extent of the node's own shape. It does NOT scale children or their offsets. World transform = parent translation + rotation only.
- Rotation is Euler `[rx, ry, rz]` (order YXZ), interpolated per component. Mannequins face +z at rotation 0 (their left is +x).
- Hidden shapes: `visible: false` or a `visible` track (the player draws them with alpha 0). A track holds its first key before that key, so a node with static `visible: false` and a `visible` track whose first key is `true` at t > 0 is VISIBLE from t = 0. Always add an explicit `{ "t": 0, "v": false }` key.
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

- Drawn in the node's flat `color` (the rest of the previs rules apply); textures and material colors are ignored. The player loads with `textures: false`, so no texture is read: large-texture models stay within the 256 MiB texture budget, and files that REQUIRE only texture extensions (`KHR_texture_basisu`, `EXT_texture_webp`, `EXT_texture_avif`, `MSFT_texture_dds`) load.
- The rest-pose bounds are centered on the node origin and scaled to `size` per `fit`. `size` tracks work. An animated clip can extend beyond the `size` box (fit uses the rest pose, not the clip).
- Clip time = `max(0, t - start) * speed`, wrapped by `loop`. An unknown clip fails the load and lists the available clips: `unknown animation clip "x" (available: ...)`.
- Relative `src` resolves against the doc file's directory in `npm run previs:render`; a missing file fails the render. In the browser viewer (`npm run previs:viewer`) drop or pick the model files with the doc; `src` matches by relative path, then by basename. Use `.glb` there (a `.gltf` with external `.bin` / images cannot resolve them from loose files).
- Programmatic use: `createPrevisPlayer(sdk, doc)` throws for docs with model nodes; use `await loadPrevisPlayer(sdk, doc, { resolveModel?, signal?, decoders? })` (`web/src/previs/player.ts`). `resolveModel(src)` maps `src` to what `sdk.loadGltf` accepts (default: the string as URL). Failures reject with `loadPrevisPlayer: node "<id>" (<src>): <cause>` and remove everything created.
- Millimeter-unit files are handled: the player reloads with a baked scale when the fit factor would fall under the engine's 0.05 clamp.
- Handoff: the prompt still maps role colors to labels. A model gives the video model an accurate silhouette and pose; look still comes from references.

Example: `web/previs/examples/model-demo.json` (models in `web/previs/examples/models/`, generated by `models.gen.ts`).

**Joint poses.** `tracks.joints` (model nodes only) turns individual glTF joints by hand on top of the clip. It maps a joint name to a `Track<Vec3>`. The joint name is the glTF node name and must be unique in the model. Each value is Euler `[rx, ry, rz]` in radians, order YXZ like `rotation`, applied additively in the joint's local frame: local rotation = clip pose * offset. `[0, 0, 0]` leaves the joint unchanged; without a clip the rest pose is the base. Same track rules as other tracks. Joints work with or without clip segments. An unknown joint name fails the load (a render exit `1`, not a validation issue) with `loadPrevisPlayer: node "<id>" (<src>): loadGltf: posable node "<name>" not found (nodes: "a", "b", ...)`; the message lists all node names (up to 64, then `... N more`). Example: raise the walker's right arm between 0.5 s and 1.0 s:

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

With 2 or more shots, the prompt also carries a shot list (`- s1: 0.00 s–1.46 s (frames 0–34) — note`; seconds with 2 decimals, frame range at the doc fps, `(no frames)` for a sub-frame shot; markers `3.80 s (frame 91): label`) and states that the cuts are intentional and must be kept at those times. Markers are sorted by time and added as a timed events list. Fill `Shot.note` and `markers` in the doc so the prompt carries the cuts and events.

## Limits

- The engine clamps object scale to >= 0.05 units: a mesh thinner than `0.05 / worldScale` m per axis is drawn at 0.05 units.
- Looking straight down, screen-up is world -Z; looking straight up, screen-up is world +Z.
- `fov` outside 10..120 is rejected by `validateDoc` (the engine clamps to that range).
- `jump()` without `base` moves the root to the origin; always pass `base` (the node's rest position).
- `fov` is vertical. In portrait output (height > width) the horizontal view is narrow; raise `fov` or move the camera back, and verify with `--still`.
- No per-object visibility API: hiding = alpha 0. A `visible` track holds its first key before that key, so add `{ "t": 0, "v": false }` (see Hidden shapes).
- Model nodes: clip segments with cross-fade are supported (array form above); textures are not loaded and material colors are dropped; only the rest pose drives `fit`.
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
