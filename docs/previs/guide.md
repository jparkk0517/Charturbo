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
| `--no-aa` | Disable the 4x MSAA of the main pass (beauty and textured) |
| `--passes=beauty,depth,textured` | Extra outputs next to the beauty output; see "Depth pass" and "Textured pass" |
| `--chrome=<path>` | Chrome binary (or env `CHROME_PATH`) |

Exit codes: `0` ok, `1` render / Chrome / ffmpeg failure, `2` usage error or invalid doc (unknown shot, bad format, bad range). Issues are printed one per line as `path: message`; the last stdout line is `frames=.. fps=.. size=WxH out=.. format=..`.

## Depth pass

`--passes` adds a depth map for AI video conditioning (ControlNet depth, Wan VACE, LTX-Video depth IC-LoRA). It is written next to the beauty output. The engine side is `setRenderPass` / `getRenderPass` / `readDepthRange` in `web/src/sdk/scene-depth.ts`.

```bash
npm run previs:render -- previs/examples/gate-raid.json out/raid --passes=beauty,depth --split-shots --format=png-seq
```

| Flag | Description |
| --- | --- |
| `--passes=beauty\|depth\|beauty,depth` | Default `beauty`. `textured` is a third pass, see "Textured pass". `depth` writes only the depth output (`<out>` is then only the base name). `beauty,depth` writes both; beauty bytes are the same as a beauty-only run |
| `--depth-range=shot\|frame\|<near>..<far>` | Default `shot`. `shot`: one range per output job (a split shot incl. handles, or the whole render), from the foreground min / max depth over its frames. `frame`: per frame. `<near>..<far>`: fixed, in meters, `0 < near < far`. A measured `near == far` (one flat surface) fails; pass a fixed range. Without `depth` in `--passes` this flag exits 2 |
| `--depth-near-clip=<meters>` | Opt-in, no default. Only with a measured range (`--depth-range=shot` or `frame`): after measuring `[Dnear, Dfar]`, `near` becomes `max(Dnear, meters)`; `far` is unchanged. Pixels nearer than `meters` clamp to white (255), so one close object (a prop in the lens) no longer takes the gray range from the rest of the scene. The value must be finite and `> 0`, else exit 2. With a fixed `--depth-range=<near>..<far>` or without `depth` in `--passes` it exits 2. If `meters` is at or beyond the measured `far` of a shot / frame, it exits 1 and names the shot and both numbers. Absent: output is unchanged |
| `--depth-encoding=inverse\|linear` | Default `inverse`. Without `depth` in `--passes` this flag exits 2 |

Encoding: `D` is the planar view depth (distance along the camera's view axis, in meters). `inverse` (default): `v = (1/D - 1/far) / (1/near - 1/far)`; `linear`: `v = (far - D) / (far - near)`. `v` is clamped to 0..1 and written as `round(255 v)`. The nearest distance (`near`) is white (255), the farthest (`far`) is black (0), and nothing drawn (background) is 0. The value is gray with R = G = B. One range per shot keeps the brightness of a shot stable, so the same depth looks the same across its frames.

Output files (`<stem>` is `<out>` without its extension; with `png-seq`, `<out>` is the directory):

| Case | File |
| --- | --- |
| mp4 formats | `<stem>.depth.mp4` (same `--format` codec as beauty) |
| `--format=png-seq` | `<stem>.depth/` (`frame_NNNNNN.png`) |
| `--split-shots`, mp4 | `<stem>.<shotId>.depth.mp4` |
| `--split-shots`, png-seq | `<stem>.depth/<shotId>/` |
| always (with depth) | `<stem>.depth.json` = `[{ shot, near_m, far_m, encoding, range, formula }]` (with `--depth-near-clip` also `near_clip_m`, the flag value, and `measured_near_m`, the raw measured near; `near_m` is the value used); `shot` is `null` when not split, `near_m` / `far_m` are `null` with no foreground pixel |
| `--still` | `<stem>.depth.png` (+ `.depth.json`); range from that frame alone |

Rules:

- The depth pass renders without anti-aliasing, so edges are hard. In one run the beauty jobs keep their 4x MSAA and run first; the depth jobs then run with MSAA off. With `--passes=depth` the page loads with MSAA off. `--no-aa` together with `--passes=depth` exits 2.
- Only geometry that writes depth appears: opaque meshes, opaque graph nodes, bars and 3D markers / fills. Translucent meshes, 2D lines and overlays write no depth, so they show as background.
- `--format=mp4` is yuv420p limited range (0..255 becomes 16..235), so the gray levels are coarser. When exact values matter (masks, training data, measurements), use `--format=png-seq` or `--format=mp4-lossless`.
- Models: ControlNet depth ([lllyasviel/sd-controlnet-depth](https://huggingface.co/lllyasviel/sd-controlnet-depth)) and Wan VACE ([VACE depth annotators](https://github.com/ali-vilab/VACE/blob/main/vace/annotators/depth.py), MiDaS / Depth Anything V2 inverse depth) use near = white. Wan VACE preprocessing normalizes depth per frame, so `--depth-range=frame` matches it exactly. The LTX-Video depth IC-LoRA guide asks for a consistent range across frames (the default `shot`) but does not state the polarity.

## Textured pass

`--passes=textured` renders the same doc and camera lit, for looks beyond flat role colors: glTF models keep their own materials and textures, and primitives (box, sphere, cylinder, ...) are lit in `look.color ?? color`. It is written next to the beauty output and does not change the flat passes. The flat pass (beauty, depth) stays the flat-color recipe; the doc's `lighting` and `look.color` / `roughness` / `metallic` are ignored there.

```bash
npm run previs:render -- previs/examples/textured-demo.json out/demo.mp4 --split-shots --passes=beauty,textured
npm run previs:render -- previs/examples/textured-demo.json --stills=0.5,2,3.5 --out=out/ --passes=beauty,textured
```

| Flag | Description |
| --- | --- |
| `--passes=beauty,depth,textured` | Any non-empty, duplicate-free comma list (anything else: exit 2). `--passes=textured` writes only the textured output (`<out>` is then only the base name). `--shot`, `--range`, `--handles`, `--frames`, `--force` and `--format` apply as for beauty. `--camera-json` is unchanged (the camera is shared) |
| `--no-aa` | Also disables the 4x MSAA of the textured pass (it uses the beauty render pass, MSAA 4 by default) |

Output files (`<stem>` is `<out>` without its extension):

| Case | File |
| --- | --- |
| mp4 formats | `<stem>.textured.mp4` |
| `--format=png-seq` | `<stem>.textured/` (`frame_NNNNNN.png`) |
| `--split-shots`, mp4 | `<stem>.<shotId>.textured.mp4` |
| `--split-shots`, png-seq | `<stem>.textured/<shotId>/` |
| `--still` | `<stem>.textured.png` (`<stem>` = `--out` without a trailing `.png`; `--out=preview` and `--out=preview.png` both give `preview.textured.png`) |
| `--stills` | a sibling `.textured.png` per still (stdout `out=` lists one primary file per still: beauty, else depth, else textured, like `--still`) |

Order in one page load: all beauty jobs, all depth jobs, then the page swaps to the textured player (`window.previs.setLook('textured')`, see `web/previs/render.ts`) and runs all textured jobs.

Split-shots outputs of all requested passes must have distinct names (shot `a` textured `<stem>.a.textured.mp4` collides with shot `a.textured` beauty, same for `.depth`, and png-seq directories): the render exits 2 before rendering. If `setLook` rejects, the page is broken: later `frame` / `measureFrame` / `contact` calls throw `setLook('<look>') failed: <cause>; reload the page` until a `setLook` succeeds.

### `lighting` (doc level, optional)

The engine has ONE directional light and it has no color; fill comes from a hemisphere environment; only rim lights are colored. Defaults apply per missing field; a doc without `lighting` uses all defaults.

| Field | Description |
| --- | --- |
| `key.dir?` | Direction TOWARD the light, world space, finite, not all zero (need not be unit length). Default `[0.45, 0.85, 0.55]` |
| `key.intensity?` | `0..4`, default `1` |
| `key.shadows?` | Default `true`. Directional shadows: map size 2048, bounds fit every caster and receiver, bias 0.5, normal bias 1, softness 1.5, darkness 1; point-light shadows are off |
| `env.sky?` | Hemisphere sky color, each channel `0..1`, default `[0.6, 0.66, 0.76]` |
| `env.ground?` | Hemisphere ground color, each channel `0..1`, default `[0.24, 0.22, 0.2]` |
| `env.intensity?` | `0..16`, default `1` |
| `rim?` | Array of point lights, at most 8 |
| `rim[].position` | Meters, world space |
| `rim[].color?` | Each channel `0..1`, default `[1, 1, 1]` |
| `rim[].intensity` | `>= 0`, meter units: irradiance is about `intensity / d_m^2` at `d_m` meters. The engine value is `intensity * worldScale^2`, at most `1e6`: with the default `worldScale` 10, `intensity <= 10000` (validated up front, the message states the limit for your `worldScale`) |
| `rim[].range?` | Meters, `> 0`: distance beyond which the light has no effect. Default unlimited. The engine value is `range * worldScale >= 0.01`: with the default `worldScale` 10, `range >= 0.001` m |
| `exposure?` | Linear multiplier before tone mapping, `0..16`, default `1` |
| `toneMapping?` | `'aces'` (default), `'reinhard'` or `'none'` |

### `look` (per node, optional)

A node without `look` is the same in both passes. Types: `PrevisLook` in `web/src/previs/types.ts`.

| Field | Description |
| --- | --- |
| `look.color?` | Base color of the textured pass, each channel `0..1`. Default: the node's `color`. Not allowed on `shape: 'model'` nodes |
| `look.roughness?` | `0..1`, default `0.8`. Not allowed on model nodes |
| `look.metallic?` | `0..1`, default `0`. Not allowed on model nodes |
| `look.show?` | `'both'` (default), `'flat'` or `'textured'`. The flat pass (beauty, depth) draws `both` and `flat` nodes; the textured pass draws `both` and `textured` nodes. A node that is not drawn in a pass does not exist there (no engine object) |

Rules (checked by `validateDoc`):

- A node may reference (`parent`, `tracks.parent`) only nodes drawn in every pass it is drawn in. Give both nodes the same `look.show`, or set the referenced one to `both`.
- The camera `follow` target must have `look.show: 'both'`, because the camera is shared by all passes (or use a target `track`).
- `look.color`, `look.roughness` and `look.metallic` on a `shape: 'model'` node are rejected.

Pattern: a model that only exists in the textured pass gets a flat stand-in in the flat pass, with the same role color:

```json
{ "id": "warrior", "shape": "model", "role": "warrior", "color": [0.2, 0.4, 0.9], "look": { "show": "textured" },
  "model": { "src": "models/kaykit/Skeleton_Warrior.glb", "fit": "contain", "groundLock": true },
  "position": [1.8, 0.85, -1.8], "rotation": [0, 0, 0], "size": [1.45, 1.6, 0.7] },
{ "id": "warrior_proxy", "shape": "box", "role": "warrior", "color": [0.2, 0.4, 0.9], "look": { "show": "flat" },
  "position": [1.8, 0.8, -1.8], "rotation": [0, 0, 0], "size": [0.6, 1.6, 0.4] }
```

Example: `web/previs/examples/textured-demo.json` (generated by `textured-demo.gen.ts`; KayKit CC0 models in `web/previs/examples/models/kaykit/`, see its `README.md`).

### Guarantees and checks

- Adding `textured` to `--passes` never changes beauty or depth bytes.
- The textured pass is NOT bit-exact across reruns: a few pixels may differ by 1/255 (measured on Chrome WebGPU / Metal; rarely one edge pixel by about 20/255). Beauty and depth are exact.
- `npm run previs:check-textured` renders png-seq of `textured-demo.json`, `model-demo.json` and `gate-raid.json` (default first 24 frames, `--frames=N`) and checks: (1) beauty bytes equal with and without textured; (2) beauty bytes equal across a rerun, textured frames differ in at most 0.01 % of pixels; (3) exposure over non-background pixels: clipped (any channel 255) <= 1 %, crushed (all channels < 5) <= 5 %, mean luma 0.25..0.65, the luma range enforced only for docs with a `lighting` block (others get a warning); (4) silhouette IoU >= 0.98 between beauty and textured foreground, only for docs without a `look.show` of `'flat'` or `'textured'` (an explicit `'both'` keeps the check). Any failure exits 1. `--selftest` feeds synthetic images to every check without rendering; `--keep=<dir>` keeps the renders; `--backend=webgpu|webgl2`.

Limits of the textured pass:

- One directional light; no light colors except rim lights (point lights, at most 8).
- No post effects (no bloom, SSAO, depth of field, color grading); only `exposure` and `toneMapping`.
- Model textures are loaded per node: two nodes with the same `src` load their textures twice (duplicated GPU memory).
- Motion and camera come from the same tracks in every pass; `look.show` only chooses which nodes are drawn.

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

**Node:** `id` (`[A-Za-z0-9_.-]+`, unique), `shape` (`box`/`sphere`/`cylinder`/`model`), `model` (required for `model`, forbidden otherwise), `color`, `position`, `rotation`, `size`, optional `parent`, `parentJoint` (glTF joint name; needs a `model` parent), `role`, `visible`, `rotationPath?` (`'direct'` default, or `'shortest'`, see "Shortest rotation path"), `tracks` (`position`, `rotation`, `size`, `visible`, `joints` on `model` nodes, and `parent` for re-parenting, see "Re-parenting").

**Shot:** `id`, `start`, `end`, `camera: { position: Track, target, fov?, roll?, up?, shake? }`, `note?` (free text; shown in the handoff shot list). `target` is `{ track }` (look-at points) or `{ follow: nodeId, offset? }`. `fov` is a vertical angle in degrees, default 45. `roll?` is a `Track<number>` in radians, default 0; positive tilts the camera's up toward screen right, so the scene appears to turn counterclockwise. Same track rules as `fov`. `up?` is a `Track<Vec3>` giving the world up direction over time, default `[0, 1, 0]`; it need not be unit length, a zero vector is rejected, neighbouring keys must not point in opposite directions (the interpolation would pass through zero; add an intermediate key), and `roll` is applied on top of it. Use it for a crane over the target: key `[0, 1, 0]` at the start and `[0, 0, -1]` once the eye is above the target. Without that switch the image flips 180° when the view direction passes through the fixed up. `shake?` is handheld noise added on top of the tracks (see "Camera shake").

**Track:** `[{ t, v, ease? }]`, `t` strictly increasing; the value is held before the first and after the last key. `ease` applies to the segment starting at that key: `linear` (default), `ease-in`, `ease-out`, `ease-in-out`, `step`, `smooth` (see "Smooth easing"). Boolean tracks and `tracks.parent` are always step-wise.

Rules to remember:

- Time is ONE global clock in seconds. Shots only choose the camera; they do not shift time.
- `size` is the full extent of the node's own shape. It does NOT scale children or their offsets. World transform = parent translation + rotation only.
- Rotation is Euler `[rx, ry, rz]` (order YXZ), interpolated per component. Mannequins face +z at rotation 0 (their left is +x).
- Hidden shapes: `visible: false` or a `visible` track (the player draws them with alpha 0). A track holds its first key before that key, so a node with static `visible: false` and a `visible` track whose first key is `true` at t > 0 is VISIBLE from t = 0. Always add an explicit `{ "t": 0, "v": false }` key.
- `shape: "model"` requires `model: { src, fit?, animation? }`; `model` on any other shape is an error. See "Model nodes (glTF)".

### Smooth easing (`ease: "smooth"`)

`ease: "smooth"` on a key shapes the segment that starts at that key as a cubic Hermite through the keys, with Catmull-Rom tangents taken in time from the neighbouring keys (one-sided at the first and last key). The curve passes through every key. When both segments meeting a key are `smooth`, the speed is continuous across that key, so a camera move through several keys has no jerk at each one. A `smooth` segment next to another easing still reaches the key value, but not its speed. The curve may overshoot between keys, so `smooth` is rejected on `size` tracks and on `camera.fov` (use `linear` or `ease-in-out` there). Boolean tracks and `tracks.parent` stay step-wise.

```json
"position": [
  { "t": 0,   "v": [0, 1.4, 4], "ease": "smooth" },
  { "t": 1.5, "v": [1, 1.4, 3], "ease": "smooth" },
  { "t": 3.0, "v": [2, 1.6, 2] }
]
```

Here both segments are `smooth`, so the camera's speed is continuous at 1.5 s.

### Shortest rotation path (`rotationPath`)

`rotationPath: "shortest"` on a node unwraps each Euler component of `tracks.rotation` and `tracks.joints` by multiples of 2π, so each key lies within π of the previous one. Yaw 3.0 → -3.0 then turns 0.28 rad instead of 6.0. Interpolation stays per component (not a quaternion slerp), so it is exact for turns about one axis. The default `'direct'` uses the values as written. `camera.roll` and `position` are not affected.

### Re-parenting (`tracks.parent`)

`tracks.parent` is a step track of `{ node, joint?, snap? }` or `null`, where `null` means world. Before its first key the static `parent` (and `parentJoint`) applies. `node` is any node id: a mannequin pivot such as `a.handL` needs no `joint`; `joint` names a glTF joint of a `shape: "model"` node.

- At each key the node's WORLD transform (position, rotation, joint pose included) is kept. The player captures it under the old parent and expresses it in the new parent's frame, so there is no pop at the switch.
- After the switch, `tracks.position` and `tracks.rotation` act as DELTAS from their own value at the switch time, in the new parent's frame. An unchanged track keeps the node where the switch left it. A throw after `null` is written relative to the release point.
- `snap: true` skips the capture: the tracks are absolute in the new parent's frame again, so the node jumps to that frame. Use it when a pop is intended.
- `size` and `visible` are not affected.
- When several nodes switch at the same time (a hand-off), every capture uses the configuration just before that time.
- Parent cycles are rejected at every key time. A camera `follow` cannot target a node that hangs from a joint at any time (follow the model with an `offset` instead).
- Put the object at the grab point before the switch (for `pickUp`, its `target` at `grab`), so the switch itself does not move it.

Example: a bottle is picked up by the mannequin's left hand pivot at 1.2 s (`pickUp` returns `hand: "a.handL"`), released at 2.0 s and thrown. Values are illustrative. After `null` the position keys are offsets from the release value `[0.35, 0.9, 0.45]`, so the throw moves the bottle +0.8 m and +0.5 m up by 2.6 s.

```json
{ "id": "bottle", "shape": "cylinder", "role": "prop", "color": [0.1, 0.8, 0.3],
  "position": [0.35, 0.9, 0.45], "rotation": [0, 0, 0], "size": [0.07, 0.25, 0.07],
  "tracks": {
    "parent": [
      { "t": 1.2, "v": { "node": "a.handL" } },
      { "t": 2.0, "v": null }
    ],
    "position": [
      { "t": 0,   "v": [0.35, 0.9, 0.45] },
      { "t": 1.2, "v": [0.35, 0.9, 0.45] },
      { "t": 2.0, "v": [0.35, 0.9, 0.45] },
      { "t": 2.6, "v": [1.15, 1.4, 0.45] },
      { "t": 3.2, "v": [1.95, 0.8, 0.45] }
    ]
  } }
```

### Ground lock (`model.groundLock`)

`model.groundLock: true` (default `false`, on a `shape: "model"` node) moves the model vertically on every frame so the lowest point of the POSED mesh (clip, blends and `tracks.joints` included) sits exactly on y = 0. Feet stay on the floor while a crouch or a clip lowers the hips. The authored height is overridden, so turn it off for jumps and for models standing on something other than the ground. Props on its joints move with it. The node origin itself is NOT moved: plain `parent` children, camera `follow` and `worldTransform` still see the authored position.

```json
"model": { "src": "models/walker.glb", "groundLock": true, "animation": { "clip": "walk" } }
```

### Camera shake (`camera.shake`)

`camera.shake` adds handheld noise to the camera after its tracks and `follow` are evaluated. Fields:

| Field | Description |
| --- | --- |
| `amp` | Meters, `>= 0`: maximum offset of eye and target on each axis |
| `freq` | Hz, `> 0`, required: lattice frequency of the noise (lattice points per second) |
| `roll?` | Radians, `>= 0`, default `0`: maximum roll offset |
| `seed?` | Integer, default `0` |

The noise is seven independent 1D Perlin channels (eye x/y/z, target x/y/z, roll), derived from the seed. The same doc and seed give identical frames. The noise is 0 at lattice points, so it does not jump at cuts, but it also does not restart at a cut.

```json
"camera": { "position": [{ "t": 0, "v": [0, 1.5, 5] }],
            "target": { "follow": "a.body" },
            "shake": { "amp": 0.02, "freq": 3, "roll": 0.01, "seed": 7 } }
```

## Mannequin helpers

Import from `web/src/previs/mannequin.ts`. All return plain data and never mutate inputs.

| API | Description |
| --- | --- |
| `createMannequin({ id, color, role?, height?=1.75, position?, limbs? })` | Returns `{ nodes, joints }`. Default is exactly 3 visible blocks (`.lower`, `.upper`, `.head.mesh`) on invisible pivots. `limbs`: `'none'` (default), `'arms'`, `'full'`, `'jointed'` (elbow and knee pivots, required for `crouch` and `pickUp`; see "Jointed limbs") |
| `walk({ joints, from, to, start, end, stepsPerSecond?=1.8 })` | Root moves `from` to `to`, yaws once to face travel direction, spine bobs, limbs swing |
| `jump({ joints, start, airTime, height, base? })` | Vertical hop of the root |
| `raiseArm({ joints, side, start, end, angle?=2.6, from? })` | Needs arms; holds the final angle |
| `shrug({ joints, start, duration })` | Spine lift, head tilt, arms open |
| `lookAt({ joints, start, end, yaw, from? })` | Head yaw only; holds. Positive yaw turns toward +x |
| `applyMotion(nodes, fragments)` | Merges motion fragments into node tracks; throws on unknown node |
| `attachProp(nodes, parentJointId, { id, size, color, role?, offset? })` | Box child of a joint (e.g. `handR`). `size` = real-world meters |
| `twoToneBox({ id, size, front, back, role?, position? })` | Product-spin box: pivot `id` plus `.front` (+z half) and `.back` (-z half). Spin the pivot's `ry` |
| `crouch({ mannequin, start, end, depth, from?, fps })` | Hips straight down by `depth` m with both feet planted; holds at the end. Needs `limbs: 'jointed'` |
| `pickUp({ mannequin, side, target, start, grab, end, depth, lean?, fps, rootPosition?, rootYaw? })` | Bends and reaches one hand to a world `target` at `grab`, back to rest at `end`. Returns `{ motion, hand, miss }`. Needs `limbs: 'jointed'` |
| `twoBoneIK(l1, l2, ty, tz, bend)` | Low-level analytic two-bone IK in a joint's local y-z plane; out-of-reach distances are clamped |

Color helpers (`web/src/previs/handoff.ts`): `suggestRoleColors(count, avoid?)` returns deterministic, distinct colors maximizing distance to `avoid` and to each other; `colorName(rgb, 'ko'|'en')`.

### Jointed limbs, crouch and pickUp

`createMannequin({ ..., limbs: 'jointed' })` is `'full'` with every arm and leg split in two (elbow and knee pivots). Only jointed mannequins accept `crouch` and `pickUp`; a rigid one throws. The segment ratios follow Drillis & Contini (1966) as tabulated in Winter, "Biomechanics and Motor Control of Human Movement", Fig. 4.1. The total arm and leg lengths stay those of the rigid mannequin.

Joint id table (X = `L` or `R`; `L` is the character's left = +x). Node ids are `${id}.<name>`, e.g. `a.elbowL`. Pivot axes are the pivot's local axes; at rest every limb hangs straight down (-y) and all rotations are 0.

| id                | kind  | parent       | joint, local offset           | bend axis, positive bend      |
| ----------------- | ----- | ------------ | ----------------------------- | ----------------------------- |
| `.shoulderX`      | pivot | `.spine`     | shoulder (as `'full'`)        | rx < 0 swings the arm forward; ry yaws the elbow plane |
| `.upperArmX`      | block | `.shoulderX` | 0.32 h * 0.560 long           | -                             |
| `.elbowX`         | pivot | `.shoulderX` | elbow, [0, -upperArm, 0]      | rx; flexion = rx < 0 (forearm swings forward / up, elbow points back) |
| `.forearmX`       | block | `.elbowX`    | 0.32 h * 0.440 long           | -                             |
| `.handX`          | pivot | `.elbowX`    | wrist, [0, -forearm, 0]       | none (prop parent)            |
| `.hipX`           | pivot | `.hips`      | hip joint (as `'full'`)       | rx < 0 swings the thigh forward |
| `.thighX`         | block | `.hipX`      | 0.48 h * 0.499 long           | -                             |
| `.kneeX`          | pivot | `.hipX`      | knee, [0, -thigh, 0]          | rx; flexion = rx > 0 (shin swings back, knee points forward +z) |
| `.shinX`          | block | `.kneeX`     | 0.48 h * 0.501 long           | -                             |
| `.footX`          | pivot | `.kneeX`     | ankle / ground point, [0, -shin, 0] (world y = 0 at rest) | none |

The `'full'` blocks `.armX` / `.legX` do not exist in `'jointed'`; root, hips, spine, head, `.lower` (pelvis), `.upper` and `.head.mesh` are identical to `'full'`. `createMannequin` returns `joints` with the same ids: `handL/R`, `elbowL/R`, `kneeL/R`, `footL/R`, and so on.

`crouch` and `pickUp` both take `fps`: pass the doc's `fps`. They emit one solved key per frame (`t = k / fps`), so the planted feet and the hand are exact on every rendered frame. Between keys the angles interpolate linearly and the feet can drift slightly.

```ts
import { createMannequin, crouch, pickUp, applyMotion, attachProp } from '../../src/previs/index.ts';

const m = createMannequin({ id: 'a', color: [0.5, 0, 1], limbs: 'jointed' });

// crouch: hips 0.35 m down between 0.5 s and 1.0 s, feet stay on the ground points, then hold
const crouched = applyMotion(m.nodes, crouch({ mannequin: m, start: 0.5, end: 1.0, depth: 0.35, fps: 24 }));

// pickUp: reach the left hand to a world point at 1.2 s, back at rest at 2.0 s
const { motion, hand, miss } = pickUp({
  mannequin: m, side: 'left', target: [0.35, 0.9, 0.45],
  start: 0, grab: 1.2, end: 2.0, depth: 0.3, fps: 24,
});
const picking = applyMotion(m.nodes, motion);
// `hand` is the pivot id, here "a.handL". `miss` is the hand-to-target distance at `grab`, in meters (0 = reached).
// Parent the object to `hand` with tracks.parent (see "Re-parenting"), or attach a rigid child: attachProp(picking, hand, {...}).
```

Do not put `crouch` and `pickUp` on the same node and property over overlapping times (see Limits): sequence them.

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
| `model.groundLock?` | Boolean, default `false`. Keeps the lowest point of the posed mesh on y = 0 every frame; see "Ground lock" |
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

- Flat pass (beauty, depth): drawn in the node's flat `color` (the rest of the previs rules apply); textures and material colors are ignored. The textured pass (see "Textured pass") keeps the model's own materials and textures instead. The flat player loads with `textures: false`, so no texture is read: large-texture models stay within the 256 MiB texture budget, and files that REQUIRE only texture extensions (`KHR_texture_basisu`, `EXT_texture_webp`, `EXT_texture_avif`, `MSFT_texture_dds`) load.
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

`validateDoc(json)` (`web/src/previs/validate.ts`) returns `{ ok: true, doc }` or `{ ok: false, issues }` with at most 50 issues, each `{ path, message }`, for example `nodes[3].tracks.position[2].t: keyframe times must strictly increase ...`. It checks types and ranges, unique ids, existing `parent`/`role`/`follow` ids, parent cycles, strictly increasing keys, shot coverage, role color distance and `model` fields (`model` required iff `shape` is `model`; `fit`, `clip`, `start`, `speed`, `loop` values). With `lighting` / `look` it also checks their ranges, `look.show` references and the model-node `look` restriction (see "Textured pass"). The CLI runs it first and exits `2` on failure.

## Flat-color rendering

This is the flat pass (beauty, depth); for the lit pass see "Textured pass". A node renders as exactly its `color`. The player uses shading model `pbr` with `toneMapping: 'none'`, exposure 1, environment/ambient/directional/point intensity 0, material emissive 1, metallic 0, roughness 1, so output equals the base color at every viewing angle. Shadows, helpers, graph and physics are off. Measured error is <= 0.5/255 on face-on swatches and on faces tilted 40, 61 and 77 degrees (`web/previs/examples/flat-swatches.json`). The `classic` model is not used: its fresnel rim lifts channels (up to 16/255 at 77 degrees).

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
- Model nodes: clip segments with cross-fade are supported (array form above); in the flat pass textures are not loaded and material colors are dropped (the textured pass keeps them); only the rest pose drives `fit`.
- Motions on the same node and property must not overlap in time; `applyMotion` does not detect it and interleaves keys. Sequence them (for example two `walk`s on one root, back to back).
- `ease: "smooth"` is rejected on `size` tracks and `camera.fov`. `camera.shake` needs `freq` (Hz, `> 0`); `amp` is meters.
- `groundLock` moves the model's drawn position, not its authored origin; turn it off for jumps.
- `crouch` / `pickUp` need `limbs: 'jointed'` and the doc `fps`. `pickUp` returns the hand pivot id as `hand`; use it as the `attachProp` parent or as a `tracks.parent` `node`.

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

## Script helpers

Generators import the pure helpers from the barrel `web/src/previs/index.ts` (types, evaluate, validate, handoff, mannequin, models), with a path relative to the generator file, e.g. `import { createMannequin, validateDoc } from '../../src/previs/index.ts';`. `player.ts` is not in the barrel because it needs the SDK at runtime: `import { loadPrevisPlayer } from '<relative>/src/previs/player.ts'`.

Scaffold a new generator with `npm run previs:new -- <name>` (name: `^[a-z0-9][a-z0-9-]*$`). It writes `web/previs/examples/<name>.gen.ts` from a minimal template and refuses to overwrite an existing file (exit 2).

| function | module | what it does |
| --- | --- | --- |
| `evalTrack` | evaluate.ts | Value of a track at time `t`; `rest` when the track is empty or undefined; held outside the key range |
| `docDuration` | evaluate.ts | End of the last shot (max shot end); 0 when there are no shots |
| `frameCount` | evaluate.ts | `round(docDuration * fps)` |
| `evaluateFrame` | evaluate.ts | Frame state at global time `t`: active shot camera and every node's local state |
| `worldPosition` | evaluate.ts | World position of node `id` from local node states (parent translation and rotation; sizes ignored); throws for joint-chained nodes in docs with `tracks.parent` (use `worldTransform`) |
| `worldTransform` | evaluate.ts | World transform of node `id` (position in meters, Euler YXZ and quaternion) for one frame, with static parents and `tracks.parent` captures; joints need `options.jointFrame` |
| `validateDoc` | validate.ts | Checks unknown input as a `PrevisDoc`; returns `{ ok: true, doc }` or `{ ok: false, issues }` |
| `buildHandoff` | handoff.ts | Builds `{ uploadOrder, prompt }` for the handoff from a doc, optional `references` and `textOnly` lines, `lang` `ko` or `en` |
| `createMannequin` | mannequin.ts | Builds `{ nodes, joints }`: 3 visible blocks by default; `limbs` `none`, `arms`, `full` or `jointed` (jointed adds elbow and knee pivots, needed for `crouch` and `pickUp`) |
| `walk` | mannequin.ts | Root moves `from` to `to`, yaws once to face travel direction, spine bobs, limbs swing |
| `jump` | mannequin.ts | Vertical hop of the root (ease-out up, ease-in down); arms swing up during the air time |
| `raiseArm` | mannequin.ts | Swings one arm forward/up about the shoulder and holds; requires arms |
| `shrug` | mannequin.ts | Shoulders-up shrug: spine lifts 3 cm, head tilts, arms open slightly, then return to rest |
| `lookAt` | mannequin.ts | Turns the head (not the body) about y and holds |
| `crouch` | mannequin.ts | Lowers the hips straight down with both feet planted (`twoBoneIK`); requires `limbs: 'jointed'` |
| `pickUp` | mannequin.ts | Bends down and reaches one hand to a world point (crouch, lean, IK arm); requires `limbs: 'jointed'` |
| `twoBoneIK` | mannequin.ts | Analytic two-bone IK (law of cosines) in a joint's local y-z plane; out-of-reach distances are clamped |
| `applyMotion` | mannequin.ts | Merges motion fragments into copies of `nodes`; keys sorted by `t`, same `t` replaces; throws on unknown node; does not detect time overlap |
| `attachProp` | mannequin.ts | Returns `nodes` plus a box child of a joint (e.g. `handR`); throws on unknown parent or duplicate id |
| `twoToneBox` | mannequin.ts | Product-spin helper: invisible pivot `id` with `.front` and `.back` half-depth boxes in two colors |
| `modelSrcsToLoad` | models.ts | Distinct `model.src` of the nodes the player loads, in doc order |
