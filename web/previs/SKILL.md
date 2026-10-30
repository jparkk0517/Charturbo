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
5. Check cheaply: `cd web && npm run previs:render -- doc.json --still=<t> --out=t.png` at key times (each shot start, mid-motion, each cut, last frame). Read the PNG, fix the doc, repeat. Exit code `2` prints `path: message` issues; fix those first. Then render: `npm run previs:render -- doc.json out.mp4`.
6. User edits (timing, framing, positions) are made in the doc and re-rendered. This costs no video credits; only the final generation does.
7. Handoff: call `buildHandoff(doc, { references, textOnly, lang })`. Give the user `uploadOrder` and `prompt`. The prompt must contain the color-to-role mapping, "follow camera and motion exactly", and the text-only items.

## Three rules (and why)

- Subtract. Person = 3 blocks (lower, upper, head); product = a real-size box. Any detail in the previs makes the video model copy that shape instead of the reference image.
- Color-code. One unique flat color per swappable subject, so the model knows which block becomes which reference. Never use colors close to the real look of the final video (skin, outfit, set), or the color leaks into the result. Get colors from `suggestRoleColors(count, avoidColors)`; put real-look colors in `avoidColors`. `validateDoc` rejects Lab distance < 25.
- Divide. The previs carries where/angle/when ONLY. Faces and clothes come from reference images (link with `role.reference` = reference `name`). Hands, expression, texture, lighting mood go in `textOnly`.

## Pitfalls

- Prop sizes are real-world meters. A wrong-size box makes the model resize the object.
- Product spin: use `twoToneBox` (front/back colors differ) and give a back-side photo as a reference; a single-color box cannot show which side faces the camera.
- `size` does not scale children. Do not try to scale a parent to resize a group.
- Rotation is Euler YXZ; mannequins face +z at rotation 0.
- Portrait output: `fov` is vertical, so horizontal view is narrow. Raise `fov` or pull the camera back; verify with `--still`.
- Camera must stay >= 5 units (0.5 m at `worldScale` 10) from its target; no roll.
- Shapes thinner than 0.05 units are drawn at 0.05 units.
- Hiding = `visible: false` or a `visible` track (alpha 0); there is no other visibility API.
- Motions on the same node+property must not overlap in time; chain them with non-overlapping `start`/`end`.
- Ids: `[A-Za-z0-9_.-]+`, unique; role, parent and follow ids must exist.
- Do not edit engine code. Ko/zh doc mirrors do not exist yet; do not create them.
