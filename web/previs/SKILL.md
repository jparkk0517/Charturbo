---
name: previs
description: Author a previs (mannequin blockout) JSON doc from a user's reference video or images, render it to mp4 with web/scripts/previs-render.mjs, and produce the upload order and prompt for a single paid AI video generation. Use when the user wants to fix camera, motion and timing of an AI video before generating it.
---

# previs

Goal: a cheap flat-color blockout video that fixes camera, movement and timing, so the paid video model needs ONE generation. Full reference: `docs/previs/guide.md`. Types: `web/src/previs/types.ts`. Examples: `web/previs/examples/*.json`.

## Workflow

1. Collect inputs. Ask for: reference video (camera/motion source), face sheets and outfit sheets per character, background photos, target size/orientation/fps, duration. Do not start without the reference.
2. Analyze the reference frame by frame. Write down:
   - who is where and when (per subject: start position, path, end position, with seconds)
   - camera moves (position and look-at over time, fov changes), and every cut (shot boundaries)
   - props with real sizes and what the hands do
3. Apply the three rules (below).
4. Author the doc JSON. Prefer a small Node/TS script using `createMannequin`, `walk`/`jump`/`raiseArm`/`shrug`/`lookAt`, `applyMotion`, `attachProp`, `twoToneBox` from `web/src/previs/mannequin.ts` and `suggestRoleColors` from `web/src/previs/handoff.ts`; hand-write JSON for simple scenes. Time is one global clock; shots must cover `[0, duration)` exactly.
5. Check cheaply: `cd web && npm run previs:render -- doc.json --still=<t> --out=t.png` at key times (each shot start, mid-motion, each cut, last frame). Read the PNG, fix the doc, repeat. Exit code `2` prints `path: message` issues; fix those first. Then render: `npm run previs:render -- doc.json out.mp4`. Use `--format=mp4-lossless` (or `--format=png-seq`) when the colors are used as masks; the default mp4 leaves about 2% of edge pixels off the role palette. Add `--split-shots` to get one file per shot plus `<stem>.cuts.json` (frame range per shot). For a depth map for AI conditioning add `--passes=depth` (or `--passes=beauty,depth`); flags and file names are in the "Depth pass" section of `docs/previs/guide.md`.
6. User edits (timing, framing, positions) are made in the doc and re-rendered. This costs no video credits; only the final generation does.
7. Handoff: call `buildHandoff(doc, { references, textOnly, lang })`. Give the user `uploadOrder` and `prompt`. The prompt must contain the color-to-role mapping, "follow camera and motion exactly", and the text-only items. Set `Shot.note` (what the shot shows) and `markers` (`{ t, label }`, timed events) so the prompt carries the shot list with the intended cuts and the event timeline.

## Three rules (and why)

- Subtract. Person = 3 blocks (lower, upper, head); product = a real-size box. Any detail in the previs makes the video model copy that shape instead of the reference image.
- Color-code. One unique flat color per swappable subject, so the model knows which block becomes which reference. Never use colors close to the real look of the final video (skin, outfit, set), or the color leaks into the result. Get colors from `suggestRoleColors(count, avoidColors)`; put real-look colors in `avoidColors`. `validateDoc` rejects Lab distance < 25.
- Divide. The previs carries where/angle/when ONLY. Faces and clothes come from reference images (link with `role.reference` = reference `name`). Hands, expression, texture, lighting mood go in `textOnly`.

## Model nodes (glTF)

- Use `shape: 'model'` where silhouette, contact or pose matters: props held in hand, vehicles, furniture, human motion via an animated clip. Keep box/sphere/cylinder and the 3-block mannequin for blockout volumes; rule 1 (subtract) still applies, so do not use a detailed model where a box is enough.
- Fields: `model: { src, fit?: 'contain'|'stretch', animation?: { clip, start?, speed?, loop? } }`. `src` is relative to the doc file (or an http(s)/data URL). `fit` default `contain` (uniform, inside `size`); `stretch` matches `size` per axis. `clip` is a name or index; `start` in global seconds; `speed > 0`; `loop` `repeat`|`once`|`pingpong`.
- Drawn in the node's flat role `color`; textures/material colors are ignored. Give it a unique role color like any other subject. The video model gets the exact silhouette and pose; look still comes from references.
- Set `size` to the real-world extent. Bounds come from the rest pose, so an animated clip may extend beyond the box.
- Unknown clip fails the load and lists the available clips. Check with `--still` at key times.
- Render resolves `src` against the doc's directory. Browser viewer (`npm run previs:viewer`): pick a served example (`examples/*.json`, `examples/film/*.json`, `?doc=<path>&look=textured`; `src` resolves against the doc URL, `.gltf` siblings load) or drop the doc with its `.glb` files. Look button flat/textured; a playlist JSON `{ title?, docs: [...] }` plays scenes on one timeline.
- Draco / meshopt compressed `.glb` files work as-is in `previs:render` and the viewer (decoders are detected and loaded automatically).
- Programmatic playback needs `loadPrevisPlayer`; `createPrevisPlayer` throws for model docs.
- Clip segments: `animation` may be an array sorted by strictly increasing `start` (`start` required after the first entry). `blendIn` (seconds, default 0, must be 0 on the first entry and at most the gap to the next segment start) cross-fades from the previous segment, which keeps advancing. Example: walk, stop the position track at 2.6 s, blend into wave:

```json
"model": { "src": "models/walker.glb", "animation": [
  { "clip": "walk", "loop": "repeat" },
  { "clip": "wave", "start": 2.6, "blendIn": 0.4, "loop": "repeat" }
] },
"tracks": { "position": [{ "t": 0, "v": [-3.2, 0.875, -3.5] }, { "t": 2.6, "v": [0.96, 0.875, -3.5] }] }
```
- Weapons/props held by a model: child box with `parent: <model id>` + `parentJoint: '<joint name>'`; it follows the posed joint. Offsets are meters in the joint frame, not scaled by `fit`: when the model is drawn at another size than natural, scale offsets along the bone by k = size / natural size (walker: `k = size.y / 1.75`). Camera `follow` of a joint-attached node is rejected; follow the model node.
- For hand-posed tweaks on top of clips (raise an arm, turn the head), use `tracks.joints` on the model node: joint name → track of Euler `[rx, ry, rz]` radians, additive in the joint's local frame. Joint names are the glTF node names; the load error `posable node "<name>" not found (nodes: ...)` lists them (up to 64), or use the SDK's `GltfAnimator.nodeNames`.

- Skinned character driven by a jointed mannequin: `model: { src, retarget: { source: '<mannequin id>', map: 'ue'|'kaykit', attach?: true } }` with `position`/`rotation` `[0, 0, 0]` and no `fit`/`animation`/`groundLock`/transform tracks; mannequin blocks `look.show: 'flat'`, the character `'textured'`. Arms / legs are fitted by two-bone IK (hands on the hand pivots, ankles above the foot pivots, planted feet level). `attach: true` makes props switched onto a mannequin pivot by `tracks.parent` ride the character's bone in its pass. See guide "Retargeting a skinned character" and `previs/examples/retarget-demo.gen.ts`.
- Skinned character driven by another MODEL node (e.g. a flat `walker.glb` blockout): `retarget: { source: '<model node id>', map: 'ue'|'kaykit', sourceMap: 'walker'|'ue'|'kaykit' }` (no `attach`). The source keeps its clips / joints / groundLock / transform tracks and must be world-placed (no parent / parentJoint / tracks.parent), `fit` 'contain', no size track, not itself retargeted. A flat-only source stays posed (undrawn) in the textured pass, so props on its joints (`look.show: 'both'`) ride it in both passes. See guide "Retargeting from a model" and `giant_tex` in `previs/examples/gate-raid.gen.ts`. Each Quaternius instance loads ~27 MiB of textures (downscaled to 1024²): at most 9 fit the 256 MiB budget (measured; the 10th fails `loadTexture: texture memory budget exceeded`).

## Authoring tips

- Pick-ups and hand-offs: use `tracks.parent` (`{ node: "<hand pivot>" }`, then `null` for the throw) instead of hiding and showing two copies of the prop. Put the prop at the grab point before the switch. See guide "Re-parenting (tracks.parent)".
- Crouching model (glTF): set `model.groundLock: true` so the feet stay on y = 0; turn it off for jumps. Jointed mannequins: `crouch` / `pickUp` need `limbs: 'jointed'` and the doc `fps`. See guide "Ground lock" and "Jointed limbs, crouch and pickUp".
- Camera moves: `ease: "smooth"` on consecutive camera keys gives continuous speed through the keys. Not allowed on `fov`. See guide "Smooth easing".
- Textured (lit) pass: `--passes=beauty,textured` writes `<stem>.textured.mp4` next to the beauty output (models keep their own materials / textures; primitives use `look.color ?? color`). Add a doc `lighting` block (`key { dir, intensity, shadows }`, `env { sky, ground, intensity }`, up to 8 `rim` point lights, `exposure`, `toneMapping`); defaults apply when absent. There is one directional light and it has no color. Pattern as in `previs/examples/textured-demo.gen.ts`: the detailed model gets `look: { show: 'textured' }` and a flat box with the same role color gets `look: { show: 'flat' }`, so beauty / depth keep the flat stand-in. Model nodes take no `look.color` / `roughness` / `metallic`; referenced nodes (`parent`, `tracks.parent`) must be drawn in the same passes; the camera `follow` target must be `look.show: 'both'`. The textured pass is not bit-exact across reruns (a few pixels by 1/255); `npm run previs:check-textured` checks it. See guide "Textured pass".
- Handheld look: `camera.shake: { amp (m), freq (Hz, required), roll?, seed? }`; same seed gives identical frames. See guide "Camera shake".

## Pitfalls

- Prop sizes are real-world meters. A wrong-size box makes the model resize the object.
- Product spin: use `twoToneBox` (front/back colors differ) and give a back-side photo as a reference; a single-color box cannot show which side faces the camera.
- `size` does not scale children. Do not try to scale a parent to resize a group.
- Rotation is Euler YXZ; mannequins face +z at rotation 0.
- Portrait output: `fov` is vertical, so horizontal view is narrow. Raise `fov` or pull the camera back; verify with `--still`.
- `camera.roll` (radians, track, default 0) tilts the frame; positive turns the scene counterclockwise.
- `camera.up` (`Track<Vec3>`, default `[0, 1, 0]`, zero vector rejected) sets world up over time. Crane over the target: key `[0, 1, 0]` at the start and `[0, 0, -1]` once the eye is above the target; otherwise the image flips 180° as the view passes through the fixed up.
- Shapes thinner than 0.05 units are drawn at 0.05 units.
- Hiding = `visible: false` or a `visible` track (alpha 0); there is no other visibility API.
- A `visible` track holds its first key before that key: static `visible: false` plus a track whose first key is `true` at t > 0 is VISIBLE from t = 0. Always add `{ "t": 0, "v": false }`.
- Motions on the same node+property must not overlap in time; chain them with non-overlapping `start`/`end`.
- Ids: `[A-Za-z0-9_.-]+`, unique; role, parent and follow ids must exist.
- Do not edit engine code. Ko/zh doc mirrors do not exist yet; do not create them.
