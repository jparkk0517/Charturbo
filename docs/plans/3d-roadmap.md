# 3D scene / previs roadmap (delegation plan)

Status 2026-11-03: Epics 1-4 and 6 DONE (`fe48f62` clip segments, `a56ca8e` exact camera, `b9080f8` compressed glTF, Epic 4 joint poses); Epic 5 deferred. Baseline was `fc04160` (previs glTF model nodes). Each task below is sized for ONE subagent run
(about 30 min to 2 h) and lists everything its brief needs. The supervisor writes contracts, runs waves,
verifies, commits and pushes to `main`.

## Model tier rules

| Tier | Use for | Examples |
| --- | --- | --- |
| haiku | Mechanical work against a fixed spec; no design choices | docs, CHANGELOG, example JSON edits, validator rules copied from a field table |
| sonnet | Well-specified implementation in 1-3 files with a written contract; plumbing; browser checks | previs types/validate/evaluate/player wiring, render/viewer plumbing, fixtures |
| opus | Design-heavy or numerically subtle work, Rust engine, cross-layer (Rust + wasm + SDK), code review | pose blending math, camera matrices, decoder integration, morph CPU path |

A task is promoted one tier when its contract has an open design question.

## Common brief footer (paste into every task)

- Repo `/Users/sun.kist/orca/workspaces/Charturbo/main-2`; JS work in `web/` (volta pins Node 22 there).
  Rust: `. "$HOME/.cargo/env"` first; rebuild wasm with `npm run wasm:build` after Rust changes.
- Touch only the files listed in the task. Other agents may edit other files concurrently.
- Tests: `npx vitest run <files>`; typecheck `npx tsc --noEmit -p .`; Rust `cargo test -p charturbo-core <filter>`.
- Do not commit. Do not run `git stash`.
- Report: files changed, what was verified and how, what was NOT verified.
- 결과는 caveman 압축체로 반환. 조사·접속사·꾸밈말 제거. 숫자·단위·코드·경로·API명·에러 문자열은 원문 그대로. not/never/no/only 유지. 새 약어 금지.

## Wave gate (supervisor, after every wave)

1. Full `npx vitest run` + `tsc` (src and previs files).
2. Real render: `npm run previs:render -- <example> --still=<t> --no-aa` + flat-color pixel check (all pixels within 0.5/255 of a node color).
3. `code-reviewer` (opus) on the wave diff; fix findings through a sonnet task.
4. Commit, `git push origin HEAD:main`.

---

## Epic 1. Clip sequences per model node (walk → stop → wave) — DONE `fe48f62`

Problem: `model.animation` plays one clip per node.

Contract (supervisor writes into `web/src/previs/types.ts` before wave 1):
`model.animation` becomes `PrevisModelAnimation | PrevisModelAnimation[]`. Array = segments sorted by
`start`; segment i is active on `[start_i, start_{i+1})`. New optional field `blendIn` (seconds, default 0):
cross-fade from the previous segment's pose. `NodeState` gains
`clips?: { clip: string | number; time: number; weight: number }[]` (1 or 2 entries, weights sum to 1);
`clipTime` stays for single-object docs (backward compatible).

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 1.1 | opus | Two-clip pose blend in the animator: `GltfAnimator.setBlend([{clip, time, weight}, ...])` (deterministic, no wall clock); per-channel TRS blend (lerp T/S, slerp R) between the two sampled poses, then skin palette / mesh matrices as today | `web/src/sdk/scene-gltf-anim.ts`, `web/src/__tests__/scene-gltf-anim.test.ts`, `scene-gltf-skin.test.ts` | — | blend 0/1 equals single-clip pose exactly; 0.5 matches hand-computed slerp; skinned path covered |
| 1.2 | sonnet | Validate segments (sorted, finite, blendIn >= 0 and < segment gap) and evaluate `clips` per frame | `web/src/previs/validate.ts`, `evaluate.ts` + their tests | contract | old single-object docs produce identical `clipTime`; segment edges and blends unit-tested |
| 1.3 | sonnet | Player: validate every segment clip at load; per frame call `setBlend` only when `clips` changed | `web/src/previs/player.ts`, `previs-player.test.ts` | 1.1, 1.2 | mock tests for switch and blend; unknown clip in any segment rejects with cleanup |
| 1.4 | haiku | Add an `idle` clip to the walker generator; example walker walks, blends 0.3 s into `wave`; docs + SKILL + CHANGELOG | `web/previs/examples/models.gen.ts`, `model-demo.json`, `docs/previs/guide.md`, `web/previs/SKILL.md`, `web/CHANGELOG.md` | 1.3 | generator re-run; doc validates; still at blend midpoint renders |

Parallel: 1.1 and 1.2 together; then 1.3; then 1.4. Estimate: half a day wall clock.

## Epic 2. Camera freedom (close-ups, top-down, roll) — DONE `a56ca8e`

Problem (engine `crates/charturbo-core/src/camera/mod.rs:139-148`): `set_pose` clamps distance to
5..5000 units and pitch to |dir.y| <= 0.99 (about 82 deg); there is no roll. Previs pushes close-ups back to 0.5 m.

Contract: new SDK `setCameraView({ eye, target, up?, roll? })` = exact look-at, no distance or pitch clamp
(only eye != target), near plane adapted to distance. Orbit controls resume from the resulting pose.

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 2.1 | opus | Rust: exact view mode in `Camera` (look-at with up + roll; straight-down handled by up fallback), near plane from distance; wasm binding `set_camera_view`; orbit gestures convert back to yaw/pitch | `crates/charturbo-core/src/camera/mod.rs`, `engine.rs`, `lib.rs` + Rust tests | — | Rust tests: eye 0.2 units from target, pitch 90 deg, roll 30 deg give the exact view matrix |
| 2.2 | sonnet | SDK `setCameraView` + backend typing + unit tests | `web/src/sdk/charturbo.ts`, a new test file | 2.1 | mock backend receives exact values; docs comment |
| 2.3 | sonnet | Previs: `camera.roll?: Track<number>` (radians); player uses `setCameraView`; validator drops the 0.5 m / 82 deg caveats | `web/src/previs/types.ts`, `validate.ts`, `evaluate.ts`, `player.ts` + tests | 2.2 | still at 0.2 m close-up and straight-down shot render as authored |
| 2.4 | haiku | Update Limits / camera docs, SKILL pitfalls, CHANGELOG | `docs/previs/guide.md`, `web/previs/SKILL.md`, `web/CHANGELOG.md` | 2.3 | no stale limit text remains |

Sequential. Runs in parallel with Epic 1 (disjoint files except `types.ts`, which the supervisor edits).
Estimate: 1-2 days.

## Epic 3. Compressed glTF (Draco, meshopt) — DONE `b9080f8` (decision: option (a), injected decoders)

Problem: `web/src/sdk/scene-gltf.ts:466` rejects files whose `extensionsRequired` lists
`KHR_draco_mesh_compression` or `EXT_meshopt_compression`, which many downloaded models use.

Decision needed first: (a) injectable decoders, the SDK ships no decoder (three.js `DRACOLoader` pattern; no
runtime dependency), with `draco3d` / `meshoptimizer` only as devDependencies for tests and the previs tools;
or (b) bundle the decoders. Recommended: (a).

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 3.1 | sonnet | Fixtures: compress the example glbs with `@gltf-transform/cli` (draco + meshopt variants) into a test fixtures dir; record commands | `web/src/__tests__/fixtures/gltf-compressed/` | decision | 4+ fixture files, reproducible command in a README |
| 3.2 | sonnet | `GltfLoadOptions.decoders.meshopt`: decode `EXT_meshopt_compression` buffer views before accessor reads | `web/src/sdk/scene-gltf.ts` + test | 3.1 | decoded positions equal the uncompressed fixture |
| 3.3 | opus | `decoders.draco`: decode `KHR_draco_mesh_compression` primitives (attribute id mapping, indices, quantization) into the existing mesh path; skinned Draco primitives too | `web/src/sdk/scene-gltf.ts` + test | 3.1 | decoded mesh matches uncompressed within quantization error; skin weights preserved |
| 3.4 | sonnet | Previs render + viewer: lazy-load decoders only when a file requires them | `web/scripts/previs-render.mjs`, `web/previs/render.ts`, `viewer.ts` | 3.2, 3.3 | compressed walker renders identical silhouette to the uncompressed one |
| 3.5 | haiku | Docs (scene glTF guide, previs guide), CHANGELOG | docs files | 3.4 | — |

Estimate: 1 day after the decision.

## Epic 4. Per-joint pose keyframes — DONE (loader option `posable` added as task 4.1b)

Problem: motion comes only from clips; no hand-posed adjustments (raise an arm, turn the head).

Contract: `tracks.joints?: Record<string, Track<Vec3>>` — Euler YXZ rotation per glTF node name, applied
ADDITIVELY on top of the current clip pose (on top of the rest pose when the node has no clip; `[0,0,0]` = unchanged). Unknown joint name fails the load.

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 4.1 | opus | Animator node overrides: `setNodeRotations(Map<nodeIndex, quat>, 'additive' \| 'absolute')`, node name to index lookup, composes with 1.1 blending | `scene-gltf-anim.ts` + tests | 1.1 | override on a skinned joint moves only its subtree; additive on clip pose unit-tested |
| 4.2 | sonnet | Previs types/validate/evaluate/player for `tracks.joints` | previs files + tests | 4.1, contract | mock + one real still with a raised arm |
| 4.3 | haiku | Mannequin helper `poseJoint()`, docs, example | `web/src/previs/mannequin.ts`, docs | 4.2 | — |

Estimate: 2-3 days.

## Epic 5. Morph targets — PRIORITY 5 (defer)

Low value for flat-color previs (facial expressions are invisible in silhouettes). Plan only:
5.1 opus Rust CPU morph blend (like CPU skinning, before skinning) + wasm; 5.2 sonnet loader reads `targets` and
weight channels; 5.3 haiku docs. Revisit when a use case appears.

## Order

Wave A: 1.1, 1.2, 2.1 in parallel → Wave B: 1.3, 2.2 → Wave C: 1.4, 2.3 → Wave D: 2.4 (+ Epic 3 after decision)
→ Epic 4 → (Epic 5 deferred).

## Epic 6. Props on glTF joints (sword in a model's hand) — DONE

Problem (found authoring the gate-raid action previs): a previs node can only be parented to another node's
origin, so a model's hand cannot hold a prop; the giant could not carry a weapon.

Contract (supervisor, `web/src/previs/types.ts`): `PrevisNode.parentJoint?: string` — glTF node name in the
`parent` model node; the child's position / rotation are local to that joint's current posed frame (clip,
blend, `tracks.joints`), joint scale removed.

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 6.1 | opus | Animator read-back: `GltfAnimator.nodeMatrix(node, out?)` = model-space matrix of a rig node in the current pose (load scale included), for dynamic and static rig nodes, skinned joints included | `scene-gltf-anim.ts` + tests | — | matches hand-computed chains under clip, blend and overrides; static node = rest world |
| 6.2 | opus | Previs: validate `parentJoint`; player creates a socket pivot per (model node, joint) under the model's pivot, updates it every frame after the pose from fit (k, center) and `nodeMatrix` with scale removed; joint names forwarded via `posable`; tests + real render of a prop in the walker's hand during `walk` | previs validate/player + tests | 6.1, contract | prop stays in the hand over the walk cycle in stills; pixel/position check |
| 6.3 | sonnet | Docs + SKILL + CHANGELOG; gate-raid example gives the giant a club in `lowerArm.R` / hand | docs, `gate-raid.gen.ts` | 6.2 | still shows the club following the swing |

---

# Round 2 (2026-11-03): from the user-lens and code-lens reviews

Sources: a user-lens review (authored a new "bottle throw" scene) and a code-lens audit (measured: 12 animated
50k-vertex characters at 1080p = 0.031 s/frame, 60 s video no slowdown; perf is not a blocker). Order: Epic 7 →
Epic 8 → Epic 9 → Epic 10. Within an epic, tasks on disjoint files run in parallel; the File column decides.

## Epic 7. Bug sweep (A) — DONE

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 7.1 | sonnet | Hidden (`visible: false`) model with `parentJoint` children fails offline render (`404`): render script / render page / viewer skip "pure pivot" models, but the player loads them when a socket child exists. Serve and preload every model src the player can load | `web/scripts/previs-render.mjs`, `web/previs/render.ts`, `web/previs/viewer.ts` | — | repro doc (hidden walker + stick on `lowerArm.R`) renders in render + viewer |
| 7.2 | sonnet | Crane over the target flips the image 180°: add `camera.up?: Track<Vec3>` (contract by supervisor), evaluate, validate, pass to `setCameraView` | `web/src/previs/validate.ts`, `evaluate.ts`, `player.ts` + tests | contract | crane-over repro with an up track has no flip |
| 7.3 | sonnet | Textures are loaded then dropped by previs (256 MiB budget exceeded with 20 x 2048² models; `KHR_texture_basisu` / `EXT_texture_webp` required files rejected): `GltfLoadOptions.textures?: false` skips images and allows texture-only extensions; unknown-node errors list ALL node names | `web/src/sdk/scene-gltf.ts` + tests | — | 20 x 2048² models load with `textures: false`; basisu-required file loads |
| 7.4 | haiku | Player passes `textures: false`; docs: joint-error text matches code, visibility-track pitfall (static `visible` vs first key), `camera.up`, `textures` | `web/src/previs/player.ts` (1 line), `docs/previs/guide.md`, `web/previs/SKILL.md`, `web/CHANGELOG.md` | 7.2, 7.3 | grep shows no stale text |

## Epic 8. AI-video outputs (C)

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 8.1 DONE | sonnet | Render outputs: `--format=mp4|mp4-lossless|png-seq` (lossless = `libx264rgb -crf 0`; mp4 yuv420p measured 2% off-palette pixels), `--shot=<id>` / `--range=a..b` with handles, `--camera-json=<file>` (per frame: t, shot, eye, target, up, fov, roll, aspect, view/proj matrices, meters) | `web/scripts/previs-render.mjs`, `web/previs/render.ts` | 7.1 | lossless frame has 0 off-palette pixels; camera json round-trips a still |
| 8.2 DONE | sonnet | Handoff gets the shot list with cut times and optional `markers: [{ t, label }]` (doc field) | `web/src/previs/handoff.ts`, `types.ts` (contract), `validate.ts` + tests | 7.2 (validate.ts) | prompt lists shots + markers |
| 8.3a DONE | opus | Depth pass DESIGN (read-only): encoding for AI video conditioning (convention used by ControlNet / depth-conditioned video models), range per shot vs per frame (flicker), bit depth, where in the Rust renderer, cost. Output a design note with sources | none (note in scratchpad) | — | note with cited conventions |
| 8.3b DONE (approved 2026-11-03: planar z-depth, MSAA off, per-shot measured range) | opus | Depth pass implementation per the approved design: Rust pass + wasm + SDK `render({ pass: 'depth' })` (new module, not charturbo.ts bloat) + `--passes=depth` in the render script | crates renderer, `web/src/sdk/*` (new module), render script | 8.3a + user approval of numbers, 8.1 | depth png sequence matches analytic depth of a test scene |
| 8.4 DONE | haiku | Docs for 8.1-8.3 | docs | 8.3b | — |

## Epic 9. Authoring power (B)

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 9.1 | opus | Pick-up / hand-off / throw: `tracks.parent?: Track<{ node, joint? } | null>` (step), world transform kept at each switch; evaluate exports `worldTransform` (rotation too, joint-aware via the player) | `types.ts` (contract), `evaluate.ts`, `player.ts`, `validate.ts` + tests | Epic 7, 8.2 | bottle picked from a crate, carried, thrown with no pop in stills |
| 9.2 | opus | `model.groundLock?: boolean`: keep the posed model's lowest point on y = 0 (posed bounds from mesh matrices / CPU skin positions) | `player.ts`, `scene-gltf-anim.ts` (bounds read-back) + tests | 9.1 (player.ts) | walker crouch via tracks.joints keeps feet on the floor |
| 9.3 | sonnet | Smooth interpolation `ease: 'smooth'` (Catmull-Rom through keys) and `shortest` angle unwrap for rotation tracks | `evaluate.ts`, `validate.ts`, `types.ts` (contract) + tests | 9.1 (evaluate.ts) | speed continuous across keys; yaw 3.0 → -3.0 turns 0.28 rad |
| 9.4 | sonnet | Handheld camera: `camera.shake?: { amp, freq?, roll?, seed? }` deterministic 1D Perlin noise on eye / target / roll | `evaluate.ts`, `types.ts` (contract), `validate.ts` + tests | 9.3 | same seed = identical frames; amplitude within spec |
| 9.5 DONE | opus | Mannequin `limbs: 'jointed'` (elbow, knee pivots) + `crouch()` / `pickUp()` helpers with foot-planted two-bone analytic IK; joint key table in docs | `web/src/previs/mannequin.ts` + tests | — | crouch keeps feet on the floor, knees bend forward |
| 9.6 | haiku | Docs for 9.x | docs | 9.5 | — |

## Epic 10. Tools and docs (D)

| ID | Tier | Task | Files | Depends | Done when |
| --- | --- | --- | --- | --- | --- |
| 10.1 | sonnet | `--inspect=<glb>` (joint tree, clips + durations, natural bounds), `--stills=a,b,c` in one Chrome launch, `--contact=6x4` with t / shot labels | `web/scripts/previs-render.mjs`, `web/previs/render.ts` | 8.1 | inspect lists the walker's 12 nodes and 2 clips |
| 10.2 | sonnet | `npm run previs:check`: render every example + pure-pivot socket + compressed walker stills and run the flat-color palette check (0.5/255) | new `web/scripts/previs-check.mjs`, `web/package.json` script | 10.1 | check passes on main, fails on an injected off-palette pixel |
| 10.3 | haiku | `web/src/previs/index.ts` barrel, "Script helpers" table (evaluateFrame, worldPosition, docDuration, mannequin API), `previs:new` scaffold | new files, docs | 10.1 | a scratch scene authored outside the repo imports the barrel with types |
| 10.4 | sonnet | Skip skinning/sending poses of hidden models (pose-only mode keeping nodeMatrix) | `scene-gltf-anim.ts`, `player.ts` | Epic 9 | hidden 50k-vertex model costs ~0 ms/frame |

Deferred: GPU skinning (CPU 32 ns/vertex is enough today), instancing of repeated models, audio mux.
