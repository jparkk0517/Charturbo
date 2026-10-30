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

**Node:** `id` (`[A-Za-z0-9_.-]+`, unique), `shape` (`box`/`sphere`/`cylinder`), `color`, `position`, `rotation`, `size`, optional `parent`, `role`, `visible`, `tracks` (`position`, `rotation`, `size`, `visible`).

**Shot:** `id`, `start`, `end`, `camera: { position: Track, target, fov? }`. `target` is `{ track }` (look-at points) or `{ follow: nodeId, offset? }`. `fov` is a vertical angle in degrees, default 45.

**Track:** `[{ t, v, ease? }]`, `t` strictly increasing; the value is held before the first and after the last key. `ease` applies to the segment starting at that key: `linear` (default), `ease-in`, `ease-out`, `ease-in-out`, `step`. Boolean tracks are always step-wise.

Rules to remember:

- Time is ONE global clock in seconds. Shots only choose the camera; they do not shift time.
- `size` is the full extent of the node's own shape. It does NOT scale children or their offsets. World transform = parent translation + rotation only.
- Rotation is Euler `[rx, ry, rz]` (order YXZ), interpolated per component. Mannequins face +z at rotation 0 (their left is +x).
- Hidden shapes: `visible: false` or a `visible` track (the player draws them with alpha 0).

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

## Validation

`validateDoc(json)` (`web/src/previs/validate.ts`) returns `{ ok: true, doc }` or `{ ok: false, issues }` with at most 50 issues, each `{ path, message }`, for example `nodes[3].tracks.position[2].t: keyframe times must strictly increase ...`. It checks types and ranges, unique ids, existing `parent`/`role`/`follow` ids, parent cycles, strictly increasing keys, shot coverage and role color distance. The CLI runs it first and exits `2` on failure.

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
- The camera cannot come closer than 5 units to its target (0.5 m at `worldScale` 10).
- No camera roll.
- `fov` is vertical. In portrait output (height > width) the horizontal view is narrow; raise `fov` or move the camera back, and verify with `--still`.
- No per-object visibility API: hiding = alpha 0.
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
