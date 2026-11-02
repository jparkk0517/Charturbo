# 3D scene / previs roadmap (delegation plan)

Status 2026-11-02. Baseline: `fc04160` (previs glTF model nodes). Each task below is sized for ONE subagent run
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

## Epic 1. Clip sequences per model node (walk → stop → wave) — PRIORITY 1

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

## Epic 2. Camera freedom (close-ups, top-down, roll) — PRIORITY 2

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

## Epic 3. Compressed glTF (Draco, meshopt) — PRIORITY 3, needs a user decision

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

## Epic 4. Per-joint pose keyframes — PRIORITY 4

Problem: motion comes only from clips; no hand-posed adjustments (raise an arm, turn the head).

Contract: `tracks.joints?: Record<string, Track<Vec3>>` — Euler YXZ rotation per glTF node name, applied
ADDITIVELY on top of the current clip pose (absolute when the node has no clip). Unknown joint name fails the load.

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
