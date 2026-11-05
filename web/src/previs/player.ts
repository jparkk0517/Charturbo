/**
 * Previs player: applies an evaluated frame (`evaluateFrame`) to a Charturbo 3D scene. The caller
 * validates the doc, creates the player (`createPrevisPlayer`, or `loadPrevisPlayer` when the doc
 * has `model` nodes), calls `frame(t)` and then `sdk.render()` (and grabs the canvas for video).
 *
 * FLAT COLOR RECIPE (a node must render as exactly its `color`)
 * Shading model `pbr` (`fs_mesh_pbr`, crates/charturbo-core/src/renderer/shader.rs) with
 * toneMapping 'none', exposure 1 and environment intensity 0, ambient / directional / point
 * intensity 0 and material emissive 1 (metallic 0, roughness 1) leaves
 *   out = linear_to_srgb(srgb_to_linear(base) * emissive) = base,
 * which is exact at every viewing angle (the sRGB round trip is lossless).
 * Shadows, helpers (grid/axes), the graph and rigid physics are off. Alpha is exact.
 * MEASURED (previews rendered in headless Chrome, WebGL2 and WebGPU, web/previs/examples/flat-swatches.json):
 * error <= 0.5/255 on face-on swatches and also on faces tilted 40, 61 and 77 degrees.
 * The `classic` model was rejected: its hard-coded fresnel rim 0.14*(1-N.V)^3 lifts every channel
 * (measured 0.5/255 at 40 deg, 5/255 at 61 deg, 16/255 at 77 deg).
 * glTF objects get the same material plus every loader input that would change the result cleared
 * (`FLAT_GLTF_MATERIAL`): base color map, alphaTest (glTF MASK), emissiveColor / emissiveMap
 * (non-black emissiveColor replaces `color * emissive`), metallic-roughness / normal / AO maps.
 * The loader has no vertex colors, so this leaves exactly `color`.
 *
 * SIZE-DECOUPLED HIERARCHY
 * The engine multiplies a parent's scale into its children's offsets (world = parentWorld * local),
 * but a previs `size` must only size the node's own shape (see types.ts / evaluate.ts). So each
 * node becomes a PIVOT object (scale [1,1,1], local position/rotation, parent = the parent's pivot)
 * and, when it has a visible shape, a child MESH object (scale = size*worldScale, position 0).
 * The engine clamps object scale to >= 0.05 units, so a mesh smaller than 0.05/worldScale meters
 * per axis is drawn at 0.05 units.
 *
 * MODEL NODES (`shape: 'model'`, loaded by `loadPrevisPlayer`)
 * Instead of a MESH a model node gets a FIT object under its pivot (alpha-0 unit box, rotation 0)
 * and the loader's objects (one per triangle primitive) are re-parented under the FIT with an
 * identity local transform, so world = pivotWorld * FIT * meshMatrix (node animation and CPU
 * skinning keep working). With the rest-pose bounds (center c, extent e, engine units after the
 * load scale) and s = size*worldScale, FIT has scale k and position -k*c, which puts the bounds
 * center on the node origin:
 *   contain: k = min(s_i / e_i) over axes with e_i > 0, uniform (k = 1 if no such axis);
 *   stretch: k_i = s_i / e_i; an axis with e_i ~ 0 (< 1e-6 of the largest extent, flat models)
 *            takes the contain factor, so the flat axis scales like the rest.
 * A `size` track only updates FIT (one call per change). Small units (e.g. millimeter files): the
 * FIT scale would be clamped at 0.05, so after a first load at scale 1 the player computes the
 * smallest factor any axis can need (rest size and every size key; eases never overshoot) and, if
 * it is below 0.05, disposes that load and reloads with it baked in via `loadGltf({ scale })`;
 * `PrevisLoadOptions.decoders` goes to every `loadGltf` call (both loads), for compressed models;
 * then every FIT factor is >= 1. Only an axis whose size reaches 0 still hits the clamp.
 * Clips run on a `GltfAnimator` without auto update. `animation` is one segment or an array of
 * segments (see `PrevisModelAnimation`: clip, start, speed, loop, blendIn); the object form is
 * segment 0. Every segment's clip is validated against the model's animations at load. Each frame
 * maps `NodeState.clips` (1 entry, or 2 while cross-fading: previous segment first) to
 * `animator.setBlend([{ clip, time, weight, loop }])` with loop defaulting to 'repeat' per segment
 * (the animator wraps each time per its loop); it is called only when a segment, time or weight
 * changed since the last call. The frame-0 clips are applied at load as the initial pose.
 * JOINTS (`tracks.joints`): every `sdk.loadGltf` of the node (also the tiny-scale reload) gets
 * `posable: [...joint names]` so static nodes can be posed. The animator exists when the node has an
 * animation OR joints OR sockets (no clip: rest pose + offsets, deterministic). Unknown joint names are
 * rejected by `loadGltf` itself (`posable node "x" not found`); the check against
 * `animator.nodeNames` only matters on engines without mesh matrices (posable ignored). Each frame maps
 * `NodeState.joints` (Euler [rx, ry, rz], YXZ) to the quaternion q = qY * qX * qZ (the engine's
 * R = Ry * Rx * Rz, see evaluate.ts `rotateYXZ`) and calls
 * `animator.setNodeRotations([{ node, rotation: [x, y, z, w] }], 'additive')` for ALL joints of the
 * node, only when some value changed (the frame-0 values are applied at load). The animator re-applies
 * the whole pose on every call of setNodeRotations and setBlend, and offers no way to defer one: a
 * frame where clips AND joints both changed costs two applies (rotations first, then setBlend);
 * a frame where only one changed costs exactly one call.
 *
 * POSE-ONLY (hidden models)
 * A model node hidden at this frame (`visible` false at load, or by its `visible` track) has its animator in
 * `setDrawEnabled(false)`: it is still posed every frame (joint frames for SOCKETS / re-parenting, ground lock via
 * `posedMinAlong`), but no mesh matrices or skin palettes are built or sent to the engine. The frame that shows it again enables
 * drawing first (the CURRENT pose is sent at once), then applies that frame's pose. Docs without hidden models make the same engine calls.
 *
 * SOCKETS (`parentJoint`: a node attached to a joint of its `parent` model node)
 * One SOCKET object per (model node, joint), an alpha-0 unit box named `previs:<model>:joint:<joint>`,
 * parented to the model's PIVOT (never the scaled FIT: children must not be scaled); the child's pivot
 * is parented to the socket instead of the model pivot. The model node is loaded even when it is a
 * pure pivot (its objects then stay at alpha 0) and gets an animator even without animation or
 * joints; every `loadGltf` of it (also the tiny-scale reload) gets the socket joints in `posable`
 * after the `tracks.joints` names (deduplicated), so static rigs have the node and unknown names fail
 * the load (`posable node "x" not found`; the `animator.nodeNames` check covers both lists).
 * Each frame, after the model's pose (setNodeRotations / setBlend) and FIT are current, the player reads
 * M = `animator.nodeMatrix(joint)` (loader space: load scale x posed glTF world, the space of the
 * objects under FIT) and maps it through the FIT (scale k, position -k*c):
 *   position = k * (t - c)   (t = M's translation, per axis; engine units in the pivot frame)
 *   rotation = Gram-Schmidt of A = S(k) * M3 (M3 = M's upper 3x3; `orthonormalFrame`): y axis =
 *              A's y column normalized, x = A's x column made perpendicular to it, z = x cross y
 * Uniform k (contain) or no stretch, joint chains without shear: A = rotation x positive diagonal, the
 * columns are orthogonal and R is exactly the joint's rotation with its scale removed. `stretch` with
 * non-uniform k shears the joint frame in the pivot frame and no rotation is exact. APPROXIMATION:
 * the joint's y axis (the bone axis of glTF / Blender rigs) follows the stretched mesh exactly; x and
 * z stay perpendicular to it and can differ from the stretched mesh's x / z by the shear angle (the
 * polar decomposition would instead keep the unstretched rotation for every unsheared chain, so props
 * along the bone would leave the stretched bone). Mirrored frames (det A < 0) get z = x cross y, i.e. the
 * joint z axis flipped; a degenerate A (y axis of size 0) keeps the previous rotation. R goes to setObjectTransform as Euler
 * [rx, ry, rz] in YXZ order (R = Ry * Rx * Rz, `matrixToEulerYXZ`, z = 0 in gimbal lock). The
 * matrix is read every frame (16 floats, no allocation) and the socket math and engine call are skipped
 * while M and k are unchanged; the engine call also when the result is unchanged.
 *
 * RE-PARENTING (`tracks.parent`, math in evaluate.ts RE-PARENTING)
 * Every (model, joint) named by a `tracks.parent` key gets a SOCKET like `parentJoint` (created after all
 * pivots, so docs without the track build exactly as before; posable / forced load as for sockets). At
 * load, after every model is attached, all captures are computed ONCE in time order through
 * `createParentResolver` with a `jointFrame` that poses the model at the capture time t_k through the
 * same machinery as a frame (setNodeRotations of `tracks.joints` at t_k, setBlend of the clips at t_k, FIT
 * scale of the size at t_k, `nodeMatrix` + `socketTransform`, engine units / worldScale), memoized per
 * (model, joint, t); afterwards each posed model gets its frame-0 joints / clips sent again, so the
 * animator matches what the player last sent. Joint frames are thus exactly what the SOCKET object gets
 * at that time. Each frame: pivots whose active key changed are first all detached (parent null), then
 * attached to the new parent's pivot / socket (the engine rejects cycles; a hand-off swap would form one
 * transiently otherwise); the pivot's local transform is the resolver's `local` (capture + deltas, or raw
 * for key -1 / snap) and goes through the usual unchanged-value skip.
 *
 * GROUND LOCK (`model.groundLock: true`)
 * The node's model gets an animator even without animation / joints / sockets. Each frame, after every pivot, pose
 * (setNodeRotations / setBlend) and FIT scale is current, the player takes the pivot's world frame (R, p: the chain of
 * pivot and socket local transforms last sent, i.e. parents and re-parenting, composed like the engine with scale 1) and
 * the lowest world height of the posed mesh, exactly per vertex:
 *   y_min = p_y + r . (-k*c) + min_v (r * kd) . v   (r = world-Y row of R, kd = max(k, 0.05) the drawn FIT scale,
 *                                                     v = posed vertex in loader space, `GltfAnimator.posedMinAlong`)
 * and lifts the model by dy = -y_min along world Y: the pivot-frame offset d = dy * r (R^T (0, dy, 0)) is added to the
 * FIT position (-k*c + d) and to every SOCKET position, so the mesh's lowest point is on y = 0 and props on its joints
 * move with it. The PIVOT itself keeps the authored transform: children by plain `parent`, camera `follow` and
 * `worldTransform` see the authored (unlifted) node origin. Order: poses, then per locked model (a locked model hanging
 * from another locked model's socket is locked after that host) the offset, the FIT call and the socket updates;
 * the FIT and socket calls are skipped while unchanged. The offset is reused while the pose (every player call that
 * re-poses the animator bumps a counter), k and the pivot's world rotation and height are unchanged. Locked models are
 * loaded with `readback: true` (both loads), which keeps their CPU vertices for `posedMinAlong`. RE-PARENTING captures include the offset: the joint frame of a
 * locked model at a capture time t adds d(t), computed the same way from the pivot's `worldTransform` at t (the
 * configuration at t). Docs without groundLock make exactly the calls they made before.
 *
 * RETARGET (`model.retarget: { source, map }`, solver in retarget.ts, rules in types.ts / validate.ts)
 * The model is loaded with the map's bones in `posable` (a missing bone fails the load) and must be skinned
 * (`GltfAnimator.skinned`, else the load fails naming the node). At load the rig is read from the animator before any
 * pose: names `nodeNames`, parents `nodeParents` (same slot order), rest local TRS decomposed from the rest
 * `nodeMatrix` of every node (`rigFromWorldMatrices`, loader space); the mannequin's REST frames are its pivots'
 * static fields in the FULL doc (`mannequinFrames`), so a mannequin with `look.show` 'flat' still drives a 'textured'
 * model. `prepareRetarget` with `RETARGET_MAPS[map]` gives the bone alignment and k = legScale (mannequin meters per
 * loader unit). Each frame (and once at load for t = 0), from the full doc's node states at t (`nodeStateAt` of the
 * pivots, their static chains and every node the root can hang from):
 *   PIVOT = the mannequin root's world transform (`createParentResolver(fullDoc).world`: parents and `tracks.parent`
 *           captures as for any pivot; validate.ts rules out joint poses in that chain). The node's own transform
 *           is ignored (validated [0, 0, 0], no tracks).
 *   bones = `retargeter.solvePose` of the pivots' root-frame frames (`mannequinFrames` over the states; FK, then two-bone
 *           IK of arms / legs onto the mannequin hand / foot pivots and planted-foot leveling, root world transform for
 *           world up and foot heights; see retarget.ts IK AND PLANTED FEET), sent as ONE
 *           `setNodeRotations(mapped bones, 'absolute')`, only when some value changed (unmapped bones keep rest).
 *   FIT   = uniform scale k * worldScale, position hips * worldScale - k * worldScale * P0_hips (hips = the mannequin
 *           hips pivot in the root frame, P0_hips = the rig's rest hips position in loader space; the hips' ancestors
 *           are unmapped, so the hips bone stays at P0_hips and lands exactly on the mannequin hips; this is
 *           `Retargeter.hipsTranslation` applied to the FIT instead of the bone), sent only when changed. The rig's
 *           loader frame must face +z with its left at +x, like the mannequin root frame (FIT rotation 0).
 * `size` and `fit` do not apply: also the tiny-scale reload decides on legScale x worldScale (read with a temporary
 * animator after the first load) instead of `size`; below 0.05 the model is reloaded with that factor baked in, so its FIT
 * scale becomes 1.
 * ATTACH (`retarget.attach`): `attachForLook` turns `tracks.parent` keys onto driven mannequin pivots into joint refs of
 * the model's bones in the doc the player builds (sockets, captures: the bone frame at t_k in world, i.e. the PIVOT's root
 * world composed with the socket transform). evaluateFrame (node states, camera) keeps the look's doc before that
 * rewrite, so a camera `follow` sees the mannequin pivot in every pass.
 * Docs without `model.retarget` make exactly the calls they made before.
 *
 * RETARGET FROM A MODEL (`retarget.source` = a model node id, `retarget.sourceMap`; rules in validate.ts)
 * The same solver, fed with canonical joint frames read from the SOURCE model's posed bones (`modelSourceFrames`) instead
 * of mannequin pivots:
 *   PRESENCE: a pass that draws the target also holds the source. When the look drops the source (`look.show`), `docForLook`
 *             keeps it as a POSE-ONLY copy (`visible: false`, no visible track: loaded, posed every frame, never drawn, see
 *             POSE-ONLY); nodes of that pass may hang from it (sockets). Its state is part of that pass's FrameState.
 *   LOAD:     the source gets the source map's bones in `posable` (a missing bone fails the source's load); a pose-only
 *             copy loads with `textures: false` (never drawn). Every load starts at once; a target awaits ITS source's load
 *             before deciding the tiny-scale reload, which needs the source rest pose (read with a temporary animator on
 *             the source's load, before its own animator exists) and its FIT scale ks (contain fit of its static `size`,
 *             engine units per loader unit). Rest frames = `modelSourceRest` x ks / worldScale (meters; the source feet are
 *             its ANKLES, so legScale is hip -> knee -> ankle on both rigs, and the ankle rest height x ks / worldScale is
 *             the `sourceAnkleHeight` that moves foot goals and plant heights to the ground point); k = legScale x
 *             worldScale as for a mannequin. Targets are attached after the other models. A missing sourceMap or a source
 *             that is itself model-sourced throws before the scene is set up. No pose is sent at load (the first frame()
 *             sends it).
 *   FRAME:    after every node's pose and the GROUND LOCK pass (the source is fully posed and lifted), per target: q, p = the
 *             source node's state rotation / position (validate.ts: the source has no parent), which is also the target's
 *             PIVOT; loader-space frames from `animator.nodeMatrix` of the source bones (`modelSourceFrames`: feet are the
 *             ankles), mapped through the source FIT: pos_m = (ks * pos + fitPos) / worldScale (fitPos includes the ground-lock
 *             offset); then `solvePose(frames, k / worldScale, { root: { q, p }, sourceAnkleHeight })` (the source's rest ankle
 *             height in meters: foot goals and plant heights from the ground point under its ankles), ONE absolute
 *             setNodeRotations and the FIT (hips on the source hips bone), each only when changed, like a mannequin source.
 * Docs without a model source make exactly the calls they made before.
 *
 * CAMERA
 * Each frame calls `sdk.setCameraView({ eye, target, up, roll })` (meters * worldScale, roll in radians): an
 * exact look-at with no distance or pitch clamp (close-ups and straight-down shots render as authored;
 * straight down / up uses the engine's up fallback; `camera.up` is a track, default [0, 1, 0]). The call is skipped while eye, target, up and roll are
 * unchanged. When it returns false nothing throws and the call is retried next frame: for eye == target
 * the previous camera stays; an engine build without the binding gets the clamped `setCameraPose`
 * fallback instead. The far plane is the engine's orbit far (2000 units unless a fit widened it).
 *
 * INVISIBLE OBJECTS
 * The engine has no per-object visibility flag in its API, so invisible = color alpha 0: pivots
 * and FIT and SOCKET objects are unit boxes with alpha 0 (always: the `visible` track of a node never touches them); they go through the translucent pipeline
 * (ALPHA_BLENDING, no depth write), which leaves the framebuffer unchanged. A shape hidden by its
 * `visible` track gets alpha 0 via `setObjectMaterial` (every loader object of a model). Pure pivot
 * nodes (`visible: false` with no visible=true key) get no mesh; a pure pivot model node is not
 * loaded at all, unless a node is attached to one of its joints (see SOCKETS).
 *
 * LOOKS (`PrevisLoadOptions.look` / `createPrevisPlayer(..., { look })`, default 'flat')
 * A player draws the nodes of its look only: 'flat' the nodes with `look.show` 'both' | 'flat', 'textured'
 * 'both' | 'textured'; the others are dropped from the doc before anything is created (no engine call, no
 * state in the returned FrameState). The validator guarantees that a drawn node references (parent,
 * tracks.parent, camera follow) only drawn nodes. Everything else (tracks, hierarchy, sockets, re-parenting,
 * ground lock, clips, camera) is the same code path in both looks. The flat look is the FLAT COLOR RECIPE
 * above, unchanged: a doc without `look.show` 'textured' nodes makes exactly the calls it made before looks
 * existed (`doc.lighting` and `look.color/roughness/metallic` are ignored).
 * TEXTURED LOOK (lit, `doc.lighting`, defaults in types.ts PrevisLighting)
 *   setShading: model 'pbr', toneMapping (default 'aces'), exposure (default 1), environment = the sky / ground
 *     hemisphere (map null, rotation 0) with env.sky / env.ground / env.intensity (defaults [0.6, 0.66, 0.76],
 *     [0.24, 0.22, 0.2], 1). PBR takes its ambient from the environment only (`ambientIntensity` is classic
 *     only, see `Charturbo.setShading`), so ambientIntensity is 0 as in the flat look.
 *   setLighting: directional = key (direction toward the light, normalized, default [0.45, 0.85, 0.55];
 *     intensity default 1; white: the engine has one uncolored directional light), the setLighting point light
 *     off (pointIntensity 0).
 *   setShadows: directional shadows enabled unless `key.shadows === false`, mapSize 2048, bounds 'auto' (fits
 *     every caster and receiver), bias 0.5, normalBias 1, softness 1.5, darkness 1 (the SDK defaults, set
 *     explicitly so the result does not depend on earlier calls), point-light shadows off.
 *   rim: one `addPointLight` per light (at most 8, the engine limit MAX_POINT_LIGHTS). PBR attenuation of an
 *     extra point light (shader.rs fs_mesh_pbr) is intensity_e * w^2 / (d_e^2 + 1) with the range window
 *     w = clamp(1 - (d_e / range_e)^4, 0, 1). With d_e = d_m * ws (ws = worldScale) and the doc unit "irradiance
 *     about intensity / d_m^2" this gives intensity_e = intensity * ws^2 (the +1 is 1/ws^2 m^2, negligible
 *     beyond ~0.3 m). position_e = position * ws; range_e = range * ws, no range = 1e6 units (the SDK maximum,
 *     w ~ 1 everywhere in a previs set; ranges beyond it are clamped to it). Color as given (sRGB, default white).
 *     An engine intensity above the SDK maximum 1e6 is an error.
 *   Primitives: color look.color ?? color, roughness look.roughness ?? 0.8, metallic look.metallic ?? 0,
 *     emissive 0, castShadow and receiveShadow true. Pivot / FIT / SOCKET helpers stay alpha-0 boxes with
 *     castShadow false (translucent objects never cast anyway).
 *   Models: loaded with `textures: true` and keep the loader's materials (no FLAT_GLTF_MATERIAL); the loader's
 *     meshes cast and receive by default. Their loader color (`getObjectRecord(id).color`, read once at load)
 *     is the visible color: the `visible` track sends that color with alpha 0 (hidden) or its own alpha.
 *   dispose (also every failed load) restores what the textured look set: the extra point lights it added
 *     are removed, then setShadows / setShading / setLighting get the `getShadows` / `getShading` /
 *     `getLighting` values from before the player, and the theme. (Graph, rigid physics and helpers are
 *     switched off by both looks and restored by neither, as before.)
 */
import type { Charturbo, ObjectMaterialDescriptor, PrimitiveShape } from '../sdk/charturbo';
import type { GltfSource, GltfLoadResult, GltfDecoders } from '../sdk/scene-gltf';
import type { GltfAnimator, GltfClipWeight, GltfNodeRotation } from '../sdk/scene-gltf-anim';
import {
  clipWeightsAt,
  createParentResolver,
  eulerYXZToQuat,
  evalTrack,
  evaluateFrame,
  matrixToEulerYXZ,
  nodeStateAt,
  parentRefOf,
  quatToEulerYXZ,
  worldTransform,
  type JointFrame,
  type ParentResolver,
  type Quat,
} from './evaluate';

export { eulerYXZToQuat, matrixToEulerYXZ };
import { jointedJointIds, type JointedJoints } from './mannequin';
import {
  mannequinFrames,
  modelSourceFrames,
  modelSourceRest,
  prepareRetarget,
  quatRotate,
  rigFromWorldMatrices,
  scaleFrames,
  RETARGET_MAPS,
  RETARGET_SOURCE_MAPS,
  type MannequinJointFrame,
  type RetargetRig,
  type RetargetSourceJoint,
  type Retargeter,
} from './retarget';
import type { ClipWeight, FrameState, NodeState, PrevisDoc, PrevisModelAnimation, PrevisModelFit, PrevisNode, Rgb, Vec3 } from './types';

export interface PrevisPlayer {
  /** Applies the doc at `time` seconds to the scene (call `sdk.render()` afterwards). */
  frame(time: number): FrameState;
  /**
   * Removes the created objects and glTF models (with their animators) and restores the theme (background);
   * the textured look also restores shading, lighting, shadows and removes its point lights (see LOOKS).
   */
  dispose(): void;
}

/** Which pass a player draws (see LOOKS): 'flat' (default) or 'textured' (lit). */
export type PrevisPlayerLook = 'flat' | 'textured';

/** Options of `createPrevisPlayer`. */
export interface PrevisPlayerOptions {
  /** Default 'flat'. */
  look?: PrevisPlayerLook;
}

export interface PrevisLoadOptions {
  /** Default 'flat'. 'textured': lit pass with the models' own materials (see LOOKS). */
  look?: PrevisPlayerLook;
  /** Maps a node's model.src to what sdk.loadGltf accepts. Default: the src string itself (URL). */
  resolveModel?: (src: string) => GltfSource | Promise<GltfSource>;
  /** Passed to every `sdk.loadGltf` call (Draco / meshopt compressed models; see `GltfLoadOptions.decoders`). */
  decoders?: GltfDecoders;
  signal?: AbortSignal;
}

const DEFAULT_WORLD_SCALE = 10;
/** The engine clamps every object scale per axis to at least this (crates/charturbo-core/src/scene/mod.rs). */
const MIN_OBJECT_SCALE = 0.05;
/** Extents below this fraction of the largest extent count as zero for `fit`. */
const FLAT_EXTENT = 1e-6;

/** Loader material inputs cleared on every glTF object (see FLAT COLOR RECIPE). */
const FLAT_GLTF_MATERIAL: Omit<ObjectMaterialDescriptor, 'color'> = {
  emissive: 1,
  metallic: 0,
  roughness: 1,
  map: null,
  alphaTest: 0,
  metallicRoughnessMap: null,
  normalMap: null,
  aoMap: null,
  emissiveMap: null,
  emissiveColor: [0, 0, 0],
};

interface ModelObjects {
  result: GltfLoadResult;
  fitId: number;
  fit: PrevisModelFit;
  /** Rest-pose bounds center / extent in engine units (load scale applied). */
  center: Vec3;
  extent: Vec3;
  animator: GltfAnimator | null;
  /** Joint names of `tracks.joints` (document order); empty without joints. */
  jointNames: string[];
  /** Joint values last sent to the animator, by `jointNames` order. */
  joints: Vec3[];
  /** Segments of the node's animation (object form = one segment). */
  segments: PrevisModelAnimation[];
  /** Clip weights last sent to the animator. */
  clips: ClipWeight[];
  /** Current FIT scale (engine units per loader unit, per axis). */
  k: Vec3;
  /** nodeMatrix output buffer. */
  scratch: Float32Array;
  /** `model.groundLock` (see GROUND LOCK). */
  groundLock: boolean;
  /** FIT position last sent (ground lock: -k*c + offset). */
  fitPos: Vec3;
  /** FIT scale last sent. */
  fitScale: Vec3;
  /** Ground-lock offset (engine units, pivot frame) the FIT and sockets carry; [0, 0, 0] without ground lock. */
  lift: Vec3;
  /** False while the animator is pose-only (see POSE-ONLY). */
  drawn: boolean;
  /** Bumped by every player call that re-poses the animator (setNodeRotations / setBlend). */
  poseVersion: number;
  /** Inputs of `lift`: [poseVersion, k (3), pivot world q (4), p_y]; null: not computed yet. */
  liftKey: number[] | null;
  /** Textured look: the loader's color of each `result.objects` entry (shown color); null in the flat look. */
  colors: Rgba[] | null;
  /** `model.retarget` state (see RETARGET); null otherwise. */
  retarget: RetargetObjects | null;
}

/** Per-node state of `model.retarget` (see RETARGET). */
interface RetargetObjects {
  retargeter: Retargeter;
  /** Mannequin source (see RETARGET); null for a model source. */
  mannequin: MannequinSource | null;
  /** Model source (see RETARGET FROM A MODEL); null for a mannequin source. */
  model: ModelSource | null;
  /** Mapped rig nodes: name and rig index, map order. */
  bones: { name: string; index: number }[];
  /** FIT scale, engine units per loader unit: legScale (meters per loader unit) x worldScale. */
  k: number;
  /** Rest loader-space position of the hips bone. */
  hipsRest: Vec3;
  /** Rotations last sent (4 per bone); null before the first send. */
  sent: Float64Array | null;
}

interface MannequinSource {
  /** Mannequin pivot ids (`jointedJointIds(source)`). */
  joints: JointedJoints;
  /** Full-doc nodes the pose reads (the pivots, their static chains to the root, the root's possible parents). */
  closure: PrevisNode[];
  /** World transforms over the FULL doc (the mannequin may not be drawn in this look); no joint poses needed. */
  resolver: ParentResolver;
}

interface ModelSource {
  /** The source model node of this pass (drawn or pose-only); posed before the target in every frame. */
  node: NodeObjects;
  /** `RETARGET_SOURCE_MAPS[sourceMap]`. */
  map: readonly RetargetSourceJoint[];
  /** Rest ankle height of the source as drawn, meters (`modelSourceRest` x ks / worldScale): `sourceAnkleHeight`. */
  ankleHeight: number;
}

/** Rest of a loaded source model (see RETARGET FROM A MODEL), meters as drawn: frames and ankle height. */
interface SourceRest {
  frames: Record<string, MannequinJointFrame>;
  ankleHeight: number;
}

/** Alpha-0 object that follows one joint of a model node (see SOCKETS). */
interface SocketObjects {
  joint: string;
  id: number;
  /** Joint matrix, FIT scale and ground-lock offset of the last socket computation (k null: none yet). */
  matrix: Float32Array;
  k: Vec3 | null;
  lift: Vec3;
  /** Last values sent to the engine. */
  pos: Vec3;
  rot: Vec3;
}

interface NodeObjects {
  node: PrevisNode;
  pivotId: number;
  meshId: number | null;
  /** Shown color of the primitive mesh: `color`, or in the textured look `look.color ?? color`. */
  meshColor: Rgb;
  model: ModelObjects | null;
  /** Last values sent to the engine; per-frame calls are skipped while unchanged. */
  pos: Vec3;
  rot: Vec3;
  /** size * worldScale */
  meshScale: Vec3;
  meshVisible: boolean;
  /** Sockets of a model node, one per joint used by a child's `parentJoint` (doc order), then by `tracks.parent` joint refs. */
  sockets: SocketObjects[];
  /** Parent object of the pivot for the static fields (key -1), and the current one. */
  staticParentId: number | null;
  parentId: number | null;
  /** Active `tracks.parent` key last applied (-1: static). */
  parentKey: number;
}

type Rgba = [number, number, number, number];

const eqVec = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const scaled = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const rgba = (c: Rgb, visible: boolean): Rgba => [c[0], c[1], c[2], visible ? 1 : 0];
/** A loader color shown (its own alpha) or hidden (alpha 0); textured look. */
const shownColor = (c: Rgba, visible: boolean): Rgba => [c[0], c[1], c[2], visible ? c[3] : 0];

/** Parents before children (document order otherwise); tolerates cycles/unknown parents. */
function topoOrder(nodes: PrevisNode[]): PrevisNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  const out: PrevisNode[] = [];
  const visit = (n: PrevisNode, stack: Set<string>): void => {
    if (done.has(n.id) || stack.has(n.id)) return;
    stack.add(n.id);
    const parent = n.parent !== undefined ? byId.get(n.parent) : undefined;
    if (parent) visit(parent, stack);
    stack.delete(n.id);
    done.add(n.id);
    out.push(n);
  };
  for (const n of nodes) visit(n, new Set());
  return out;
}

/** True when the node ever shows a shape: visible at rest or some visible key is true. */
function hasShape(n: PrevisNode): boolean {
  return n.visible !== false || (n.tracks?.visible?.some((k) => k.v) ?? false);
}

/** Axes whose extent counts as non-zero. */
function solidAxes(extent: Vec3): boolean[] {
  const max = Math.max(extent[0], extent[1], extent[2]);
  return extent.map((e) => e > 0 && e > max * FLAT_EXTENT);
}

/** FIT object scale for a model of rest `extent` drawn at `size` (both engine units); see header. */
function modelFitScale(fit: PrevisModelFit, size: Vec3, extent: Vec3): Vec3 {
  const solid = solidAxes(extent);
  let k = Infinity;
  for (let i = 0; i < 3; i++) if (solid[i]) k = Math.min(k, size[i] / extent[i]);
  if (k === Infinity) k = 1;
  if (fit === 'stretch') return [0, 1, 2].map((i) => (solid[i] ? size[i] / extent[i] : k)) as Vec3;
  return [k, k, k];
}

/** Smallest FIT factor the node can need over its rest size and size keys (Infinity: none). */
function minFitFactor(n: PrevisNode, ws: number, extent: Vec3): number {
  const sizes = [n.size, ...(n.tracks?.size ?? []).map((k) => k.v)];
  const solid = solidAxes(extent);
  let k = Infinity;
  for (let i = 0; i < 3; i++) {
    if (!solid[i]) continue;
    for (const s of sizes) if (s[i] > 0) k = Math.min(k, (s[i] * ws) / extent[i]);
  }
  return k;
}

function boundsOf(r: GltfLoadResult): { center: Vec3; extent: Vec3 } {
  const center = [0, 1, 2].map((i) => {
    const c = (r.bounds.min[i] + r.bounds.max[i]) / 2;
    return Number.isFinite(c) ? c : 0;
  }) as Vec3;
  const extent = [0, 1, 2].map((i) => {
    const e = r.bounds.max[i] - r.bounds.min[i];
    return Number.isFinite(e) && e > 0 ? e : 0;
  }) as Vec3;
  return { center, extent };
}

/** Textured look defaults (see types.ts PrevisLighting). */
const KEY_DIR: Vec3 = [0.45, 0.85, 0.55];
const ENV_SKY: Rgb = [0.6, 0.66, 0.76];
const ENV_GROUND: Rgb = [0.24, 0.22, 0.2];
const TEXTURED_ROUGHNESS = 0.8;
/** Directional shadow map edge of the textured look (texels; the SDK clamps it to the device limit). */
const TEXTURED_SHADOW_MAP = 2048;
/** `addPointLight` limits (scene-lights.ts): range stands in for "unlimited", intensity is the maximum. */
const MAX_LIGHT_RANGE = 1e6;
const MAX_LIGHT_INTENSITY = 1e6;

function checkLook(fn: string, look: unknown): PrevisPlayerLook {
  if (look === undefined) return 'flat';
  if (look !== 'flat' && look !== 'textured') throw new Error(`${fn}: look must be 'flat' or 'textured'; got ${JSON.stringify(look)}`);
  return look;
}

/**
 * The doc with only the nodes `look` draws (`look.show`, see LOOKS), plus a POSE-ONLY copy of every model source of a drawn
 * retarget that the look does not draw (see RETARGET FROM A MODEL); the same object when it draws every node.
 */
function docForLook(doc: PrevisDoc, look: PrevisPlayerLook): PrevisDoc {
  const drawn = (n: PrevisNode): boolean => drawnIn(n, look);
  if (doc.nodes.every(drawn)) return doc;
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const poseOnly = new Set<string>();
  for (const n of doc.nodes) {
    const s = drawn(n) ? modelSourceOf(n, byId) : undefined;
    if (s && !drawn(s)) poseOnly.add(s.id);
  }
  const nodes = doc.nodes.filter((n) => drawn(n) || poseOnly.has(n.id));
  return { ...doc, nodes: poseOnly.size === 0 ? nodes : nodes.map((n) => (poseOnly.has(n.id) ? poseOnlyNode(n) : n)) };
}

/** Whether `look` draws node `n` (`look.show`, see LOOKS). */
function drawnIn(n: PrevisNode, look: PrevisPlayerLook): boolean {
  const show = n.look?.show ?? 'both';
  return show === 'both' || show === look;
}

/** A node that exists (pivot, model, pose) but is never drawn: `visible` false and no visible track. */
function poseOnlyNode(n: PrevisNode): PrevisNode {
  if (!n.tracks) return { ...n, visible: false };
  const { visible: _visible, ...tracks } = n.tracks;
  return { ...n, visible: false, tracks };
}

/** The model node a retarget of `n` reads (`retarget.source` names a model node), else undefined. */
function modelSourceOf(n: PrevisNode, byId: ReadonlyMap<string, PrevisNode>): PrevisNode | undefined {
  const r = n.shape === 'model' ? n.model?.retarget : undefined;
  const s = r ? byId.get(r.source) : undefined;
  return s?.shape === 'model' && s !== n ? s : undefined;
}

/**
 * Bones every model source of `doc` must expose (`posable`), by source node id (see RETARGET FROM A MODEL). Only targets
 * that are loaded count (they ever show a shape: nothing hangs from a retargeted model), as in models.ts `nodeLoadsModel`.
 */
function modelSourceBones(doc: PrevisDoc): Map<string, string[]> {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const out = new Map<string, string[]>();
  for (const n of doc.nodes) {
    const s = hasShape(n) ? modelSourceOf(n, byId) : undefined;
    if (!s) continue;
    // A chain would make a load wait for itself (validate.ts rejects it too)
    if (modelSourceOf(s, byId)) throw new Error(`node "${n.id}": model.retarget source "${s.id}" is itself retargeted from a model; a model source must be posed by its own clips / joints`);
    const map = sourceMapOf(n);
    const bones = out.get(s.id) ?? [];
    for (const e of map) if (!bones.includes(e.bone)) bones.push(e.bone);
    out.set(s.id, bones);
  }
  return out;
}

function sourceMapOf(n: PrevisNode): readonly RetargetSourceJoint[] {
  const name = n.model?.retarget?.sourceMap;
  const map = name !== undefined ? RETARGET_SOURCE_MAPS[name] : undefined;
  if (!map) throw new Error(`model.retarget: source "${n.model?.retarget?.source}" is a model node and needs sourceMap (walker, ue or kaykit); got ${JSON.stringify(name)}`);
  return map;
}

/**
 * `model.retarget.attach` (see RETARGET): the drawn doc with every `tracks.parent` key (no joint, not snap) that targets a
 * driven pivot of an attaching model's source mannequin turned into a joint ref of that model's mapped bone. Only models
 * the pass draws attach: in the look's doc and ever visible (`hasShape`); a model hidden for good keeps the mannequin
 * pivots. The same object when nothing changes (docs without attach are untouched).
 */
function attachForLook(doc: PrevisDoc): PrevisDoc {
  const to = new Map<string, { node: string; joint: string }>();
  for (const n of doc.nodes) {
    const r = n.shape === 'model' ? n.model?.retarget : undefined;
    // Only a model this pass DRAWS (in the look's doc and ever visible): a never-visible one is not loaded (models.ts
    // nodeLoadsModel), so its bones must not become sockets
    if (!r?.attach || !hasShape(n)) continue;
    const ids = jointedJointIds(r.source) as unknown as Record<string, string>;
    for (const e of RETARGET_MAPS[r.map] ?? []) if (ids[e.joint] !== undefined) to.set(ids[e.joint], { node: n.id, joint: e.bone });
  }
  if (to.size === 0) return doc;
  let changed = false;
  const nodes = doc.nodes.map((n) => {
    const keys = n.tracks?.parent;
    if (!keys?.some((k) => k.v !== null && k.v.joint === undefined && k.v.snap !== true && to.has(k.v.node))) return n;
    changed = true;
    const parent = keys.map((k) => (k.v !== null && k.v.joint === undefined && k.v.snap !== true && to.has(k.v.node) ? { ...k, v: { ...to.get(k.v.node)! } } : k));
    return { ...n, tracks: { ...n.tracks, parent } };
  });
  return changed ? { ...doc, nodes } : doc;
}

/** Sets up the scene for `look` (see header); returns what undoes it (dispose and failed loads). */
function setupScene(sdk: Charturbo, doc: PrevisDoc, look: PrevisPlayerLook, ws: number): () => void {
  if (look === 'textured') return setupTextured(sdk, doc, ws);
  // Flat look (FLAT COLOR RECIPE)
  const prevTheme = sdk.getTheme();
  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);
  sdk.setHelpers({ showGrid: false, showAxes: false });
  sdk.setShadows({ enabled: false });
  sdk.setShading({ model: 'pbr', toneMapping: 'none', exposure: 1, environment: { intensity: 0 } });
  sdk.setLighting({ ambientIntensity: 0, directionalIntensity: 0, pointIntensity: 0 });
  sdk.setTheme({ ...prevTheme, surface: [doc.background[0], doc.background[1], doc.background[2], 1] });
  return () => sdk.setTheme(prevTheme);
}

/** Textured look (see TEXTURED LOOK); returns the restore of everything it changed. */
function setupTextured(sdk: Charturbo, doc: PrevisDoc, ws: number): () => void {
  const L = doc.lighting ?? {};
  const prevTheme = sdk.getTheme();
  const prevShading = sdk.getShading();
  const prevLighting = sdk.getLighting();
  const prevShadows = sdk.getShadows();
  const lights: number[] = [];
  const restore = (): void => {
    for (let i = lights.length - 1; i >= 0; i--) sdk.removePointLight(lights[i]);
    lights.length = 0;
    sdk.setShadows(prevShadows);
    sdk.setShading(prevShading);
    sdk.setLighting(prevLighting);
    sdk.setTheme(prevTheme);
  };
  try {
    sdk.setGraphVisible(false);
    sdk.setRigidPhysics(false);
    sdk.setHelpers({ showGrid: false, showAxes: false });
    sdk.setShadows({
      enabled: L.key?.shadows !== false,
      mapSize: TEXTURED_SHADOW_MAP,
      bias: 0.5,
      normalBias: 1,
      softness: 1.5,
      darkness: 1,
      bounds: 'auto',
      point: { enabled: false },
    });
    sdk.setShading({
      model: 'pbr',
      toneMapping: L.toneMapping ?? 'aces',
      exposure: L.exposure ?? 1,
      environment: {
        sky: [...(L.env?.sky ?? ENV_SKY)],
        ground: [...(L.env?.ground ?? ENV_GROUND)],
        intensity: L.env?.intensity ?? 1,
        map: null,
        rotation: 0,
      },
    });
    const d = L.key?.dir ?? KEY_DIR;
    const len = Math.hypot(d[0], d[1], d[2]);
    sdk.setLighting({
      ambientIntensity: 0,
      directionalDirection: [d[0] / len, d[1] / len, d[2] / len],
      directionalIntensity: L.key?.intensity ?? 1,
      pointIntensity: 0,
    });
    (L.rim ?? []).forEach((r, i) => {
      const intensity = r.intensity * ws * ws;
      if (!(intensity <= MAX_LIGHT_INTENSITY)) {
        throw new Error(`lighting.rim[${i}].intensity ${r.intensity} x worldScale^2 (${ws * ws}) = ${intensity} exceeds the engine maximum ${MAX_LIGHT_INTENSITY}`);
      }
      lights.push(
        sdk.addPointLight({
          position: scaled(r.position, ws),
          color: [...(r.color ?? [1, 1, 1])],
          intensity,
          range: r.range !== undefined ? Math.min(r.range * ws, MAX_LIGHT_RANGE) : MAX_LIGHT_RANGE,
        }),
      );
    });
    sdk.setTheme({ ...prevTheme, surface: [doc.background[0], doc.background[1], doc.background[2], 1] });
  } catch (e) {
    restore();
    throw e;
  }
  return restore;
}

/** Creates pivots and primitive meshes (model nodes get their FIT later); pushes ids onto `created`. */
function buildNodes(sdk: Charturbo, doc: PrevisDoc, ws: number, created: number[], look: PrevisPlayerLook): Map<string, NodeObjects> {
  const textured = look === 'textured';
  const objects = new Map<string, NodeObjects>();
  const pivotIds = new Map<string, number>();
  for (const n of topoOrder(doc.nodes)) {
    const pos = scaled(n.position, ws);
    const rot: Vec3 = [...n.rotation];
    let parentId = n.parent !== undefined ? (pivotIds.get(n.parent) ?? null) : null;
    const host = n.parent !== undefined ? objects.get(n.parent) : undefined;
    if (n.parentJoint !== undefined && host?.node.shape === 'model') {
      // Hang from the joint's SOCKET (one per model node and joint) instead of the model pivot
      parentId = ensureSocket(sdk, host, n.parentJoint, created).id;
    }
    const pivotId = sdk.addPrimitive({
      shape: 'box',
      name: `previs:${n.id}`,
      position: pos,
      rotation: rot,
      scale: [1, 1, 1],
      color: [0, 0, 0, 0],
      bodyType: 'static',
      parentId,
      castShadow: false,
      receiveShadow: false,
    });
    pivotIds.set(n.id, pivotId);
    created.push(pivotId);

    const meshScale = scaled(n.size, ws);
    const meshVisible = n.visible !== false;
    let meshId: number | null = null;
    const meshColor: Rgb = textured ? (n.look?.color ?? n.color) : n.color;
    if (hasShape(n) && n.shape !== 'model') {
      // Flat: FLAT COLOR RECIPE; textured: lit PBR material that casts and receives (see TEXTURED LOOK)
      meshId = sdk.addPrimitive({
        shape: n.shape as PrimitiveShape,
        name: `previs:${n.id}:mesh`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: meshScale,
        color: rgba(meshColor, meshVisible),
        metallic: textured ? (n.look?.metallic ?? 0) : 0,
        roughness: textured ? (n.look?.roughness ?? TEXTURED_ROUGHNESS) : 1,
        emissive: textured ? 0 : 1,
        bodyType: 'static',
        parentId: pivotId,
        castShadow: textured,
        receiveShadow: textured,
      });
      created.push(meshId);
    }
    objects.set(n.id, {
      node: n,
      pivotId,
      meshId,
      meshColor,
      model: null,
      pos,
      rot,
      meshScale,
      meshVisible,
      sockets: [],
      staticParentId: parentId,
      parentId,
      parentKey: -1,
    });
  }
  // Sockets of `tracks.parent` joint refs (after every pivot: docs without the track are unchanged)
  for (const n of doc.nodes) {
    for (const k of n.tracks?.parent ?? []) {
      const host = k.v ? objects.get(k.v.node) : undefined;
      if (k.v?.joint !== undefined && host?.node.shape === 'model') ensureSocket(sdk, host, k.v.joint, created);
    }
  }
  return objects;
}

/** The SOCKET of (`host`, `joint`), created on first use (alpha-0 unit box under the model PIVOT, see SOCKETS). */
function ensureSocket(sdk: Charturbo, host: NodeObjects, joint: string, created: number[]): SocketObjects {
  let socket = host.sockets.find((s) => s.joint === joint);
  if (!socket) {
    const id = sdk.addPrimitive({
      shape: 'box',
      name: `previs:${host.node.id}:joint:${joint}`,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      color: [0, 0, 0, 0],
      bodyType: 'static',
      parentId: host.pivotId,
      castShadow: false,
      receiveShadow: false,
    });
    created.push(id);
    socket = { joint, id, matrix: new Float32Array(16), k: null, lift: [0, 0, 0], pos: [0, 0, 0], rot: [0, 0, 0] };
    host.sockets.push(socket);
  }
  return socket;
}

/** Parent object of `o`'s pivot for `tracks.parent` key `key` (-1: static fields). */
function parentObjectOf(objects: Map<string, NodeObjects>, o: NodeObjects, key: number): number | null {
  if (key < 0) return o.staticParentId;
  const ref = parentRefOf(o.node, key);
  if (ref === null) return null;
  const host = objects.get(ref.node);
  if (!host) return null;
  if (ref.joint === undefined) return host.pivotId;
  return host.sockets.find((s) => s.joint === ref.joint)?.id ?? host.pivotId;
}

/**
 * Resolver with every capture computed (see RE-PARENTING); null without `tracks.parent`. Joint frames pose
 * the loaded models at the capture times; the poses are restored afterwards.
 */
function captureParents(doc: PrevisDoc, ws: number, objects: Map<string, NodeObjects>): ParentResolver | null {
  if (!doc.nodes.some((n) => n.tracks?.parent !== undefined)) return null;
  const frames = new Map<string, JointFrame>();
  const posed = new Set<ModelObjects>();
  const jointFrame = (model: string, joint: string, time: number): JointFrame => {
    const key = `${model}\u0000${joint}\u0000${time}`;
    const hit = frames.get(key);
    if (hit) return hit;
    const o = objects.get(model);
    const m = o?.model;
    if (!o || !m?.animator) throw new Error(`joint "${joint}" of node "${model}" has no loaded model to pose`);
    posed.add(m);
    if (m.retarget) {
      // The model node's world is the identity (the PIVOT carries the mannequin root): return the bone frame in world
      const rt = m.retarget;
      // validate.ts: nothing hangs from a model-sourced retarget (no attach), so no capture reads one
      if (!rt.mannequin) throw new Error(`joint "${joint}" of node "${model}" cannot be captured: the model is retargeted from a model source`);
      const pose = retargetPose(rt, time);
      const { next, fitPos } = retargetSolve(rt, pose.frames, { q: pose.q, p: pose.root.position }, ws);
      sendRetarget(m, rt, next);
      const c: Vec3 = [-fitPos[0] / rt.k, -fitPos[1] / rt.k, -fitPos[2] / rt.k];
      const t = socketTransform(m.animator.nodeMatrix(joint, m.scratch), [rt.k, rt.k, rt.k], c, [NaN, NaN, NaN]);
      if (t.rotation.some((v) => Number.isNaN(v))) {
        throw new Error(`joint "${joint}" of node "${model}" has a degenerate frame (zero scale) at t=${time}; move the tracks.parent key off that time`);
      }
      const p = quatRotate(pose.q, scaled(t.position, 1 / ws));
      const jf: JointFrame = {
        position: [pose.root.position[0] + p[0], pose.root.position[1] + p[1], pose.root.position[2] + p[2]],
        rotation: quatToEulerYXZ(qmulQ(pose.q, eulerYXZToQuat(t.rotation))),
      };
      frames.set(key, jf);
      return jf;
    }
    const k = poseAt(o, m, time);
    const t = socketTransform(m.animator.nodeMatrix(joint, m.scratch), k, m.center, [NaN, NaN, NaN]);
    if (m.groundLock) {
      // The socket carries the model's ground-lock offset at `time` (see GROUND LOCK): from the pivot's world
      // frame at `time` (re-parenting included; may pose other models), then this model posed at `time` again
      const states: Record<string, NodeState> = {};
      for (const n of doc.nodes) states[n.id] = nodeStateAt(n, time);
      const w = worldTransform(doc, states, model, { jointFrame, time });
      poseAt(o, m, time);
      const lift = groundLift(m.animator, k, m.center, w.quaternion, w.position[1] * ws);
      for (let i = 0; i < 3; i++) t.position[i] += lift[i];
    }
    // A collapsed joint frame (scale 0) has no rotation to capture; the runtime socket would keep an
    // older one, so the capture would not match it (a pop). Refuse instead of guessing.
    if (t.rotation.some((v) => Number.isNaN(v))) {
      throw new Error(`joint "${joint}" of node "${model}" has a degenerate frame (zero scale) at t=${time}; move the tracks.parent key off that time`);
    }
    const jf: JointFrame = { position: scaled(t.position, 1 / ws), rotation: t.rotation };
    frames.set(key, jf);
    return jf;
  };
  /** Poses model node `o` as a frame at `time` would (rotations first, then the clips; see JOINTS); returns its FIT scale. */
  const poseAt = (o: NodeObjects, m: ModelObjects, time: number): Vec3 => {
    const st = nodeStateAt(o.node, time);
    m.poseVersion++;
    if (st.joints && m.jointNames.length > 0) {
      m.animator!.setNodeRotations(m.jointNames.map((node) => ({ node, rotation: eulerYXZToQuat(st.joints![node]) })), 'additive');
    }
    if (st.clips && m.segments.length > 0) m.animator!.setBlend(toBlend(m.segments, st.clips));
    return modelFitScale(m.fit, scaled(st.size, ws), m.extent);
  };
  const resolver = createParentResolver(doc, { jointFrame });
  try {
    resolver.captureAll();
  } finally {
    // Back to what the player last sent (frame 0 at load). Retarget models are not restored: `sent` already records
    // the capture pose they now show, so the next frame() sends its own pose (sendRetarget compares against `sent`)
    for (const m of posed) {
      m.poseVersion++;
      if (m.jointNames.length > 0) sendJoints(m, m.joints);
      if (m.segments.length > 0) m.animator!.setBlend(toBlend(m.segments, m.clips));
    }
  }
  return resolver;
}

/**
 * Puts a loaded model under a new FIT object of node `o` and applies its clip and the look's material: flat
 * `FLAT_GLTF_MATERIAL` + node color; textured the loader's own materials (alpha 0 while hidden).
 */
function attachModel(
  sdk: Charturbo,
  o: NodeObjects,
  result: GltfLoadResult,
  created: number[],
  look: PrevisPlayerLook,
  fullDoc: PrevisDoc,
  ws: number,
  /** Bones this node exposes as a model source (see RETARGET FROM A MODEL); empty otherwise. */
  sourceBones: readonly string[] = [],
  /** Model source of this node's retarget (loaded and attached, with its rest); undefined for a mannequin source. */
  source?: { node: NodeObjects; rest: SourceRest },
): void {
  const n = o.node;
  const { center, extent } = boundsOf(result);
  const fit = n.model?.fit ?? 'contain';
  const k = modelFitScale(fit, o.meshScale, extent);
  const fitId = sdk.addPrimitive({
    shape: 'box',
    name: `previs:${n.id}:fit`,
    position: [-k[0] * center[0], -k[1] * center[1], -k[2] * center[2]],
    rotation: [0, 0, 0],
    scale: k,
    color: [0, 0, 0, 0],
    bodyType: 'static',
    parentId: o.pivotId,
    castShadow: false,
    receiveShadow: false,
  });
  created.push(fitId);
  let colors: Rgba[] | null = null;
  if (look === 'textured') {
    // Keep the loader's materials; its color (alpha included) is the shown color of the `visible` track
    colors = [];
    for (const id of result.objects) {
      sdk.setObjectParent(id, fitId);
      const c = sdk.getObjectRecord(id)?.color ?? [1, 1, 1, 1];
      colors.push([c[0], c[1], c[2], c[3]]);
      if (!o.meshVisible) sdk.setObjectMaterial(id, { color: shownColor(colors[colors.length - 1], false) });
    }
  } else {
    for (const id of result.objects) {
      sdk.setObjectParent(id, fitId);
      sdk.setObjectMaterial(id, { ...FLAT_GLTF_MATERIAL, color: rgba(n.color, o.meshVisible) });
    }
  }
  let animator: GltfAnimator | null = null;
  let segments: PrevisModelAnimation[] = [];
  let clips: ClipWeight[] = [];
  const anim = n.model?.animation;
  const jointTracks = n.tracks?.joints;
  const jointNames = jointTracks ? Object.keys(jointTracks) : [];
  const posable = posableNames(o, sourceBones);
  const groundLock = n.model?.groundLock === true;
  if (anim || posable.length > 0 || groundLock) animator = sdk.createGltfAnimator(result, { autoUpdate: false });
  if (animator && posable.length > 0) {
    const known = animator.nodeNames;
    for (const name of posable) {
      if (!known.includes(name)) {
        const list = known.filter((s): s is string => s !== null);
        const shown = list.slice(0, 50).map((s) => JSON.stringify(s)).join(', ');
        throw new Error(`unknown joint ${JSON.stringify(name)} (joints: ${list.length > 0 ? shown + (list.length > 50 ? ', ...' : '') : 'none'})`);
      }
    }
  }
  const joints = jointNames.map((name) => evalTrack(jointTracks![name], 0, [0, 0, 0] as Vec3));
  const model: ModelObjects = {
    result,
    fitId,
    fit,
    center,
    extent,
    animator,
    jointNames,
    joints,
    segments,
    clips,
    k,
    scratch: new Float32Array(16),
    groundLock,
    fitPos: [-k[0] * center[0], -k[1] * center[1], -k[2] * center[2]],
    fitScale: [...k],
    lift: [0, 0, 0],
    drawn: true,
    poseVersion: 0,
    liftKey: null,
    colors,
    retarget: null,
  };
  // Hidden at load: pose only (the first frame that shows it enables drawing, see POSE-ONLY)
  if (animator && !o.meshVisible) {
    animator.setDrawEnabled(false);
    model.drawn = false;
  }
  if (animator && jointNames.length > 0) sendJoints(model, joints); // initial offsets = frame 0
  if (anim && animator) {
    model.segments = segments = normalizeAnimation(anim);
    model.clips = clips = clipWeightsAt(anim, 0);
    animator.setBlend(toBlend(segments, clips)); // initial pose = frame 0
  }
  if (n.model?.retarget && source) {
    // Model source: posed from the source in every frame() (see RETARGET FROM A MODEL), nothing sent at load
    model.retarget = setupModelRetarget(model, n, source.node, source.rest, ws);
  } else if (n.model?.retarget) {
    // Frame-0 pose and FIT at load, like the clips (see RETARGET); the pivot follows in the first frame()
    const rt = setupRetarget(model, n, fullDoc, ws);
    model.retarget = rt;
    const pose = retargetPose(rt, 0);
    applyRetarget(sdk, model, rt, pose.frames, { q: pose.q, p: pose.root.position }, ws);
  }
  o.model = model;
  updateSockets(sdk, o.sockets, model); // frame-0 pose; nodeMatrix errors fail the load
}

/** RetargetObjects of a loaded model node with `model.retarget` (see RETARGET); throws a load error. */
function setupRetarget(m: ModelObjects, n: PrevisNode, fullDoc: PrevisDoc, ws: number): RetargetObjects {
  if (!m.animator) throw new Error('model.retarget: the model has no rig to pose');
  const { retargeter, joints, closure, map } = buildRetarget(m.animator, m.result, n, fullDoc);
  return retargetObjects(retargeter, map, ws, { joints, closure, resolver: createParentResolver(fullDoc) }, null);
}

/** RetargetObjects of a model-sourced retarget (see RETARGET FROM A MODEL); throws a load error. */
function setupModelRetarget(m: ModelObjects, n: PrevisNode, source: NodeObjects, rest: SourceRest, ws: number): RetargetObjects {
  if (!m.animator) throw new Error('model.retarget: the model has no rig to pose');
  const retargeter = prepareRetarget(retargetRig(m.animator, m.result), RETARGET_MAPS[n.model!.retarget!.map], (j) => rest.frames[j]);
  return retargetObjects(retargeter, RETARGET_MAPS[n.model!.retarget!.map], ws, null, { node: source, map: sourceMapOf(n), ankleHeight: rest.ankleHeight });
}

function retargetObjects(
  retargeter: Retargeter,
  map: readonly { bone: string }[],
  ws: number,
  mannequin: MannequinSource | null,
  model: ModelSource | null,
): RetargetObjects {
  if (retargeter.legScale === undefined) throw new Error('model.retarget: the map has no full leg chain to scale by');
  const k = retargeter.legScale * ws;
  if (!(k >= MIN_OBJECT_SCALE) || !Number.isFinite(k)) {
    throw new Error(`model.retarget: the leg-ratio scale ${k} (engine units per file unit) is below the engine's object scale minimum ${MIN_OBJECT_SCALE}`);
  }
  return {
    retargeter,
    mannequin,
    model,
    bones: map.map((e) => ({ name: e.bone, index: retargeter.indexOf(e.bone) })),
    k,
    hipsRest: [...retargeter.rest.pos[retargeter.hipsIndex]],
    sent: null,
  };
}

/**
 * Engine units per file unit the retarget FIT of a freshly loaded model would need (legScale x worldScale), read with a
 * temporary animator (disposed again; the model is left at rest). Infinity when it cannot tell (no skin: the attach fails
 * with its own error). The load decides on this, not on `size`, whether to reload with a baked scale (see RETARGET).
 * `source`: the rest of a model source (see RETARGET FROM A MODEL) instead of the mannequin's.
 */
function retargetLoadFactor(sdk: Charturbo, r: GltfLoadResult, n: PrevisNode, fullDoc: PrevisDoc, ws: number, source?: SourceRest): number {
  const a = sdk.createGltfAnimator(r, { autoUpdate: false });
  try {
    if (!a.skinned) return Infinity;
    const rt = source
      ? prepareRetarget(retargetRig(a, r), RETARGET_MAPS[n.model!.retarget!.map], (j) => source.frames[j])
      : buildRetarget(a, r, n, fullDoc).retargeter;
    return (rt.legScale ?? Infinity) * ws;
  } finally {
    a.dispose();
  }
}

/**
 * Rest of a loaded, not yet attached model source (see RETARGET FROM A MODEL): the source map's bone frames from a
 * temporary animator (disposed again), feet at the ankles; positions and the ankle rest height in meters (x its FIT scale
 * ks / worldScale; the height becomes `sourceAnkleHeight`).
 */
function sourceRestOf(sdk: Charturbo, src: NodeObjects, r: GltfLoadResult, map: readonly RetargetSourceJoint[], ws: number): SourceRest {
  const fit = src.node.model?.fit ?? 'contain';
  const ks = modelFitScale(fit, src.meshScale, boundsOf(r).extent);
  if (ks[0] !== ks[1] || ks[0] !== ks[2]) throw new Error(`model.retarget: the source "${src.node.id}" must be drawn at a uniform scale (fit 'contain')`);
  const a = sdk.createGltfAnimator(r, { autoUpdate: false });
  try {
    const rest = modelSourceRest(map, (bone) => a.nodeMatrix(bone));
    return { frames: scaleFrames(rest.frames, ks[0] / ws), ankleHeight: (rest.ankleHeight * ks[0]) / ws };
  } finally {
    a.dispose();
  }
}

/** Rig of a loaded, unposed skinned model: rest local TRS from the rest world matrices (loader space). */
function retargetRig(animator: GltfAnimator, result: GltfLoadResult): RetargetRig {
  if (!animator.skinned) throw new Error('model.retarget needs a skinned model (a glTF skin); this model has none');
  const names = animator.nodeNames.map((x) => x ?? '');
  const parents = animator.nodeParents;
  if (parents.length !== names.length) throw new Error(`model.retarget: the rig has ${parents.length} nodes, the scene ${names.length}`);
  const gltf = result.nodes.map((x) => x.index);
  return rigFromWorldMatrices(names, parents, (i) => animator.nodeMatrix(gltf[i]));
}

/** The retargeter of a loaded, unposed model (rig from the rest `nodeMatrix`) and the mannequin nodes its pose reads. */
function buildRetarget(animator: GltfAnimator, result: GltfLoadResult, n: PrevisNode, fullDoc: PrevisDoc) {
  const spec = n.model!.retarget!;
  // Rest local TRS from the rest world matrices (loader space; nothing is posed yet)
  const rig = retargetRig(animator, result);
  const joints = jointedJointIds(spec.source);
  // Every node the pose reads: the pivots, their chains to the root and whatever the root can hang from
  const byId = new Map(fullDoc.nodes.map((x) => [x.id, x]));
  const seen = new Set<string>(Object.values(joints));
  const queue = [...seen];
  while (queue.length > 0) {
    const x = byId.get(queue.shift()!);
    if (!x) continue;
    for (const p of [x.parent, ...(x.tracks?.parent ?? []).map((k) => k.v?.node)]) {
      if (p !== undefined && !seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    }
  }
  const closure = fullDoc.nodes.filter((x) => seen.has(x.id));
  const rest = mannequinFrames(closure, joints);
  const map = RETARGET_MAPS[spec.map];
  return { retargeter: prepareRetarget(rig, map, (j) => rest[j]), joints, closure, map };
}

/** Mannequin root world transform (meters) and root-frame joint frames at `time` (see RETARGET). */
function retargetPose(rt: RetargetObjects, time: number): RetargetFrame {
  const mq = rt.mannequin!;
  const states: Record<string, NodeState> = {};
  for (const n of mq.closure) states[n.id] = nodeStateAt(n, time);
  const w = mq.resolver.world(states, mq.joints.root);
  return { root: { position: w.position, rotation: w.rotation }, q: w.quaternion, frames: mannequinFrames(mq.closure, mq.joints, (n) => states[n.id]) };
}

interface RetargetFrame {
  /** Mannequin root world transform (meters, Euler YXZ): the model PIVOT. */
  root: { position: Vec3; rotation: Vec3 };
  q: Quat;
  /** Root-frame frames of the mannequin joints. */
  frames: Record<string, MannequinJointFrame>;
}

/**
 * Root-frame joint frames (meters) of a model source posed for this frame (see RETARGET FROM A MODEL): its bones'
 * `nodeMatrix` through its FIT (scale ks, position fitPos incl. the ground-lock offset).
 */
function modelSourcePose(src: ModelSource, ws: number): Record<string, MannequinJointFrame> {
  const m = src.node.model;
  if (!m?.animator) throw new Error(`model.retarget: the source "${src.node.node.id}" has no loaded rig to read`);
  const loader = modelSourceFrames(src.map, (bone) => m.animator!.nodeMatrix(bone, m.scratch));
  return scaleFrames(loader, m.k[0] / ws, [m.fitPos[0] / ws, m.fitPos[1] / ws, m.fitPos[2] / ws]);
}

/** Solved bone rotations (4 per mapped bone, map order) and FIT position (engine units) of root-frame frames. */
function retargetSolve(
  rt: RetargetObjects,
  frames: Record<string, MannequinJointFrame>,
  root: { q: Quat; p: Vec3 },
  ws: number,
): { next: Float64Array; fitPos: Vec3 } {
  const { local } = rt.retargeter.solvePose((j) => frames[j], rt.k / ws, rt.model ? { root, sourceAnkleHeight: rt.model.ankleHeight } : { root });
  const next = new Float64Array(rt.bones.length * 4);
  rt.bones.forEach((b, i) => next.set(local[b.index], i * 4));
  const h = frames.hips.pos;
  const fitPos: Vec3 = [h[0] * ws - rt.k * rt.hipsRest[0], h[1] * ws - rt.k * rt.hipsRest[1], h[2] * ws - rt.k * rt.hipsRest[2]];
  return { next, fitPos };
}

/** One absolute setNodeRotations of the mapped bones, skipped when equal to the last one sent. */
function sendRetarget(m: ModelObjects, rt: RetargetObjects, next: Float64Array): void {
  if (rt.sent !== null && next.every((v, i) => v === rt.sent![i])) return;
  m.poseVersion++;
  const rotations: GltfNodeRotation[] = rt.bones.map((b, i) => ({ node: b.name, rotation: [next[i * 4], next[i * 4 + 1], next[i * 4 + 2], next[i * 4 + 3]] }));
  m.animator!.setNodeRotations(rotations, 'absolute');
  rt.sent = next;
}

/** The bounds center that makes the socket math (k * (t - c)) match the retarget FIT position. */
function retargetCenter(m: ModelObjects): Vec3 {
  return [-m.fitPos[0] / m.k[0], -m.fitPos[1] / m.k[1], -m.fitPos[2] / m.k[2]];
}

/** Sends the solved bone rotations (one absolute setNodeRotations) and the FIT (hips on the source hips), each only when changed. */
function applyRetarget(
  sdk: Charturbo,
  m: ModelObjects,
  rt: RetargetObjects,
  frames: Record<string, MannequinJointFrame>,
  root: { q: Quat; p: Vec3 },
  ws: number,
): void {
  const { next, fitPos } = retargetSolve(rt, frames, root, ws);
  sendRetarget(m, rt, next);
  const k: Vec3 = [rt.k, rt.k, rt.k];
  if (!eqVec(fitPos, m.fitPos) || !eqVec(k, m.fitScale)) {
    sdk.setObjectTransform(m.fitId, { position: fitPos, scale: k });
    m.fitPos = fitPos;
    m.fitScale = k;
    m.k = k;
  }
}

/**
 * `posable` of a model node: `tracks.joints` names, then socket joints not already listed, the retarget map's bones and the
 * bones it exposes as a model source (`sourceBones`, see RETARGET FROM A MODEL).
 */
function posableNames(o: NodeObjects, sourceBones: readonly string[] = []): string[] {
  const names = o.node.tracks?.joints ? Object.keys(o.node.tracks.joints) : [];
  for (const s of o.sockets) if (!names.includes(s.joint)) names.push(s.joint);
  // Retarget: the mapped bones (a missing bone fails the load: `posable node "x" not found`)
  const rt = o.node.model?.retarget;
  if (rt) for (const e of RETARGET_MAPS[rt.map] ?? []) if (!names.includes(e.bone)) names.push(e.bone);
  for (const b of sourceBones) if (!names.includes(b)) names.push(b);
  return names;
}

const sameMatrix = (a: Float32Array, b: Float32Array): boolean => {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Moves every socket of a model to its joint's current posed frame (see SOCKETS); skips unchanged ones. */
function updateSockets(sdk: Charturbo, sockets: SocketObjects[], m: ModelObjects): void {
  // Retarget: the FIT sits at fitPos, not -k*c, so the socket math takes c = -fitPos / k and fitPos is part of the key
  const c = m.retarget ? retargetCenter(m) : m.center;
  const off = m.retarget ? m.fitPos : m.lift;
  for (const s of sockets) {
    const mat = m.animator!.nodeMatrix(s.joint, m.scratch);
    if (s.k !== null && eqVec(s.k, m.k) && eqVec(s.lift, off) && sameMatrix(mat, s.matrix)) continue;
    s.matrix.set(mat.subarray(0, 16));
    s.k = [...m.k];
    s.lift = [...off];
    const { position, rotation } = socketTransform(mat, m.k, c, s.rot);
    if (m.groundLock) for (let i = 0; i < 3; i++) position[i] += m.lift[i];
    if (!eqVec(position, s.pos) || !eqVec(rotation, s.rot)) {
      sdk.setObjectTransform(s.id, { position, rotation });
      s.pos = position;
      s.rot = rotation;
    }
  }
}

/**
 * Socket transform in the model PIVOT frame for joint matrix `mat` (column-major, loader space) under a
 * FIT of scale `k` and bounds center `c`: position k * (t - c), rotation = YXZ Euler of the orthonormalized
 * S(k) * M3 (`orthonormalFrame`, see SOCKETS). `fallback` is returned as rotation when that frame is degenerate.
 */
export function socketTransform(mat: ArrayLike<number>, k: Vec3, c: Vec3, fallback: Vec3 = [0, 0, 0]): { position: Vec3; rotation: Vec3 } {
  const position: Vec3 = [k[0] * (mat[12] - c[0]), k[1] * (mat[13] - c[1]), k[2] * (mat[14] - c[2])];
  // A = S(k) * M3, row-major: A[r][c] = k_r * M[c * 4 + r]
  const a: number[] = [];
  for (let r = 0; r < 3; r++) for (let col = 0; col < 3; col++) a.push(k[r] * mat[col * 4 + r]);
  const rot = orthonormalFrame(a);
  return { position, rotation: rot ? matrixToEulerYXZ(rot) : [...fallback] };
}

/**
 * Rotation (row-major 3x3) of the frame whose axes are the columns of `a` (row-major 3x3), by Gram-Schmidt
 * in the order y, x: y = normalize(a_y), x = normalize(a_x - (a_x . y) y), z = x cross y (right-handed).
 * Equals the column normalization when the columns are orthogonal (rotation x positive per-axis scale).
 * Y first: glTF / Blender skeletons point bones along local +Y, so the bone axis is kept exactly.
 * null when a_y or the part of a_x perpendicular to it vanishes (relative 1e-9) or `a` is not finite.
 */
export function orthonormalFrame(a: readonly number[]): number[] | null {
  const cx = [a[0], a[3], a[6]];
  const cy = [a[1], a[4], a[7]];
  const ny = Math.hypot(cy[0], cy[1], cy[2]);
  const nx0 = Math.hypot(cx[0], cx[1], cx[2]);
  if (!Number.isFinite(ny) || !Number.isFinite(nx0) || !(ny > 0) || !(nx0 > 0)) return null;
  const y = cy.map((v) => v / ny);
  const dot = cx[0] * y[0] + cx[1] * y[1] + cx[2] * y[2];
  const px = cx.map((v, i) => v - dot * y[i]);
  const nx = Math.hypot(px[0], px[1], px[2]);
  if (!(nx > 1e-9 * nx0)) return null;
  const x = px.map((v) => v / nx);
  const z = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

function normalizeAnimation(anim: PrevisModelAnimation | PrevisModelAnimation[]): PrevisModelAnimation[] {
  return Array.isArray(anim) ? anim : [anim];
}

function toBlend(segments: PrevisModelAnimation[], clips: ClipWeight[]): GltfClipWeight[] {
  return clips.map((c) => {
    const seg = segments[c.segment];
    return { clip: seg.clip, time: c.time, weight: c.weight, loop: seg.loop ?? 'repeat' };
  });
}

function sameClips(a: ClipWeight[], b: ClipWeight[]): boolean {
  return a.length === b.length && a.every((c, i) => c.segment === b[i].segment && c.time === b[i].time && c.weight === b[i].weight);
}

function sendJoints(m: ModelObjects, values: Vec3[]): void {
  m.poseVersion++;
  m.animator!.setNodeRotations(
    m.jointNames.map((node, i) => ({ node, rotation: eulerYXZToQuat(values[i]) })),
    'additive',
  );
  m.joints = values;
}

/** Rigid transform (engine units, quaternion [x, y, z, w]). */
interface Rigid {
  p: Vec3;
  q: Quat;
}

const qmulQ = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

/** Deeper object chains are cut (the engine caps its parent chain at 32). */
const MAX_CHAIN = 32;

/** parent * T(pos) * R(rot) (rot: Euler YXZ, the engine's local transform with scale 1). */
function composeRigid(parent: Rigid, pos: Vec3, rot: Vec3): Rigid {
  const [x, y, z, w] = parent.q;
  // p' = parent.p + parent.q * pos * parent.q^-1
  const tx = 2 * (y * pos[2] - z * pos[1]);
  const ty = 2 * (z * pos[0] - x * pos[2]);
  const tz = 2 * (x * pos[1] - y * pos[0]);
  const p: Vec3 = [
    parent.p[0] + pos[0] + w * tx + (y * tz - z * ty),
    parent.p[1] + pos[1] + w * ty + (z * tx - x * tz),
    parent.p[2] + pos[2] + w * tz + (x * ty - y * tx),
  ];
  const [bx, by, bz, bw] = eulerYXZToQuat(rot);
  const q: Quat = [
    w * bx + x * bw + y * bz - z * by,
    w * by - x * bz + y * bw + z * bx,
    w * bz + x * by - y * bx + z * bw,
    w * bw - x * bx - y * by - z * bz,
  ];
  return { p, q };
}

/**
 * Ground-lock offset in the PIVOT frame (engine units) of a posed model under a FIT of scale `k` and bounds center `c`,
 * whose pivot has world rotation `q` and world height `py` (see GROUND LOCK): dy * r with r = the world-Y row of R(q)
 * and dy = -(lowest world y of the posed vertices). [0, 0, 0] for a model without vertices.
 */
function groundLift(animator: GltfAnimator, k: Vec3, c: Vec3, q: Quat, py: number): Vec3 {
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const [x, y, z, w] = [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
  const r: Vec3 = [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)];
  // The engine draws the FIT at max(k, 0.05) per axis (scale clamp); its position stays -k*c
  const kd = k.map((v) => Math.max(v, MIN_OBJECT_SCALE));
  const min = animator.posedMinAlong([r[0] * kd[0], r[1] * kd[1], r[2] * kd[2]]);
  if (!Number.isFinite(min)) return [0, 0, 0];
  const dy = -(py - r[0] * k[0] * c[0] - r[1] * k[1] * c[1] - r[2] * k[2] * c[2] + min);
  return [r[0] * dy, r[1] * dy, r[2] * dy];
}

function makePlayer(
  sdk: Charturbo,
  /** The look's doc BEFORE `attachForLook`: evaluateFrame (node states, camera) runs on it, so the camera is shared by the passes. */
  frameDoc: PrevisDoc,
  ws: number,
  restore: () => void,
  objects: Map<string, NodeObjects>,
  created: number[],
  resolver: ParentResolver | null,
): PrevisPlayer {
  const reparented = [...objects.values()].filter((o) => o.node.tracks?.parent !== undefined);
  // Ground-locked loaded models and the owners of pivot / socket objects (their world chain, see GROUND LOCK)
  const locked = [...objects.values()].filter((o) => o.model?.groundLock === true && o.model.animator !== null);
  // Model-sourced retargets: posed after every source pose and ground lock (see RETARGET FROM A MODEL)
  const fromModel = [...objects.values()].filter((o) => o.model?.retarget?.model);
  const pivotOwner = new Map<number, NodeObjects>();
  const socketOwner = new Map<number, { host: NodeObjects; socket: SocketObjects }>();
  if (locked.length > 0) {
    for (const o of objects.values()) {
      pivotOwner.set(o.pivotId, o);
      for (const socket of o.sockets) socketOwner.set(socket.id, { host: o, socket });
    }
  }
  let camEye: Vec3 | null = null;
  let camTarget: Vec3 | null = null;
  let camFov: number | null = null;
  let camRoll = 0;
  let camUp: Vec3 = [0, 1, 0];
  let disposed = false;

  return {
    frame(time: number): FrameState {
      // Node states do not depend on the attach rewrite (a key's index, not its ref, picks the capture), and a camera
      // `follow` of an attached prop must see the mannequin pivot as in every other pass (no joint pose needed)
      const fs = evaluateFrame(frameDoc, time);

      if (reparented.length > 0) {
        // Detach every switching pivot first, then attach: the engine rejects (transient) cycles
        const moves: { o: NodeObjects; key: number; target: number | null }[] = [];
        for (const o of reparented) {
          const key = fs.nodes[o.node.id]?.parentRef?.key ?? -1;
          if (key === o.parentKey) continue;
          o.parentKey = key;
          const target = parentObjectOf(objects, o, key);
          if (target !== o.parentId) moves.push({ o, key, target });
        }
        for (const { o } of moves) if (o.parentId !== null) sdk.setObjectParent(o.pivotId, null);
        for (const { o, target } of moves) {
          if (target !== null) sdk.setObjectParent(o.pivotId, target);
          o.parentId = target;
        }
      }

      for (const [id, o] of objects) {
        const st = fs.nodes[id];
        if (!st) continue;
        // Retarget: the pivot takes the mannequin root's world transform (see RETARGET), or the model source's
        // (validate.ts: it has no parent; see RETARGET FROM A MODEL)
        const rt = o.model?.retarget ?? null;
        const pose = rt?.mannequin ? retargetPose(rt, time) : null;
        const srcState = rt?.model ? sourceState(fs, rt.model) : null;
        const local = pose ? pose.root : srcState ? srcState : st.parentRef && resolver ? resolver.local(o.node, st) : st;
        const pos = scaled(local.position, ws);
        if (!eqVec(pos, o.pos) || !eqVec(local.rotation, o.rot)) {
          sdk.setObjectTransform(o.pivotId, { position: pos, rotation: [...local.rotation] });
          o.pos = pos;
          o.rot = [...local.rotation];
        }
        const m = o.model;
        if (o.meshId === null && m === null) continue;
        const ms = scaled(st.size, ws);
        if (!eqVec(ms, o.meshScale)) {
          if (m?.retarget) {
            // size is ignored: the FIT scale is the leg ratio (validate.ts rejects size tracks)
          } else if (m) {
            const k = modelFitScale(m.fit, ms, m.extent);
            m.k = k;
            // Ground-locked FITs are sent after the pose, with their offset (see GROUND LOCK)
            if (!m.groundLock) {
              sdk.setObjectTransform(m.fitId, {
                position: [-k[0] * m.center[0], -k[1] * m.center[1], -k[2] * m.center[2]],
                scale: k,
              });
            }
          } else {
            sdk.setObjectTransform(o.meshId!, { scale: ms });
          }
          o.meshScale = ms;
        }
        if (st.visible !== o.meshVisible) {
          if (m?.colors) {
            // Textured: the loader's own color, alpha 0 while hidden
            const objs = m.result.objects;
            for (let i = 0; i < objs.length; i++) sdk.setObjectMaterial(objs[i], { color: shownColor(m.colors[i], st.visible) });
          } else {
            const color = rgba(o.meshColor, st.visible);
            if (m) for (const oid of m.result.objects) sdk.setObjectMaterial(oid, { color });
            else sdk.setObjectMaterial(o.meshId!, { color });
          }
          o.meshVisible = st.visible;
        }
        if (m?.animator) {
          // Draw before the pose changes below: enabling sends the current pose at once, the setBlend after it the new one
          if (m.drawn !== st.visible) {
            m.animator.setDrawEnabled(st.visible);
            m.drawn = st.visible;
          }
          if (rt && pose) applyRetarget(sdk, m, rt, pose.frames, { q: pose.q, p: pose.root.position }, ws);
          // Rotations first: setBlend then re-applies the pose with the new offsets
          if (st.joints && m.jointNames.length > 0) {
            const next = m.jointNames.map((name) => st.joints![name]);
            if (next.some((v, i) => !eqVec(v, m.joints[i]))) sendJoints(m, next);
          }
          // evaluate.ts sets clips on every model node with an animation
          const cl = st.clips ?? m.clips;
          if (!sameClips(cl, m.clips)) {
            m.poseVersion++;
            m.animator.setBlend(toBlend(m.segments, cl));
            m.clips = cl;
          }
          // After this frame's pose and FIT: children of joints render in the same frame
          if (o.sockets.length > 0 && !m.groundLock) updateSockets(sdk, o.sockets, m);
        }
      }

      if (locked.length > 0) {
        // GROUND LOCK: every pose and pivot is current; lock parents (through sockets) before their children
        const done = new Set<NodeObjects>();
        const worldOf = (id: number | null, depth: number): Rigid => {
          if (id === null || depth > MAX_CHAIN) return { p: [0, 0, 0], q: [0, 0, 0, 1] };
          const pivot = pivotOwner.get(id);
          if (pivot) return composeRigid(worldOf(pivot.parentId, depth + 1), pivot.pos, pivot.rot);
          const sock = socketOwner.get(id);
          if (!sock) return { p: [0, 0, 0], q: [0, 0, 0, 1] };
          if (sock.host.model?.groundLock) lock(sock.host);
          return composeRigid(worldOf(sock.host.pivotId, depth + 1), sock.socket.pos, sock.socket.rot);
        };
        const lock = (o: NodeObjects): void => {
          if (done.has(o)) return;
          done.add(o);
          const m = o.model!;
          const w = worldOf(o.pivotId, 0);
          // The offset depends only on the pose, k and the pivot's world rotation / height
          const key = [m.poseVersion, ...m.k, ...w.q, w.p[1]];
          if (!m.liftKey || key.some((v, i) => v !== m.liftKey![i])) {
            m.lift = groundLift(m.animator!, m.k, m.center, w.q, w.p[1]);
            m.liftKey = key;
          }
          const fitPos: Vec3 = [0, 1, 2].map((i) => -m.k[i] * m.center[i] + m.lift[i]) as Vec3;
          if (!eqVec(fitPos, m.fitPos) || !eqVec(m.k, m.fitScale)) {
            sdk.setObjectTransform(m.fitId, { position: fitPos, scale: [...m.k] });
            m.fitPos = fitPos;
            m.fitScale = [...m.k];
          }
          if (o.sockets.length > 0) updateSockets(sdk, o.sockets, m);
        };
        for (const o of locked) lock(o);
      }

      for (const o of fromModel) {
        // Every source is posed (clips, joints) and lifted (ground lock) by now; the target's pivot was set above
        const rt = o.model!.retarget!;
        const st = sourceState(fs, rt.model!);
        const q = eulerYXZToQuat(st.rotation);
        applyRetarget(sdk, o.model!, rt, modelSourcePose(rt.model!, ws), { q, p: st.position }, ws);
      }

      const eye = scaled(fs.camera.eye, ws);
      const target = scaled(fs.camera.target, ws);
      const roll = fs.camera.roll;
      const up = fs.camera.up;
      if (!camEye || !camTarget || !eqVec(eye, camEye) || !eqVec(target, camTarget) || roll !== camRoll || !eqVec(up, camUp)) {
        // Exact look-at: no distance / pitch clamp. false (eye == target) keeps the previous camera.
        if (sdk.setCameraView({ eye, target, up, roll })) {
          camEye = eye;
          camTarget = target;
          camRoll = roll;
          camUp = up;
        }
      }
      if (fs.camera.fovDeg !== camFov) {
        sdk.setCameraFov(fs.camera.fovDeg);
        camFov = fs.camera.fovDeg;
      }
      return fs;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Models (and their animators) before the FIT / pivot objects they hang from
      for (const o of objects.values()) if (o.model) sdk.disposeGltf(o.model.result);
      // Children first: a mesh goes before its pivot, a pivot after its children
      for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
      created.length = 0;
      objects.clear();
      restore();
    },
  };
}

const hasModels = (doc: PrevisDoc): boolean => doc.nodes.some((n) => n.shape === 'model');

/** The model source's node state in this frame (it is in the pass's doc, drawn or pose-only). */
function sourceState(fs: FrameState, src: ModelSource): NodeState {
  const st = fs.nodes[src.node.node.id];
  if (!st) throw new Error(`model.retarget: the source "${src.node.node.id}" has no state in this frame`);
  return st;
}

/** Sync player for docs without `model` nodes drawn in its look (use `loadPrevisPlayer` for those). */
export function createPrevisPlayer(sdk: Charturbo, fullDoc: PrevisDoc, options: PrevisPlayerOptions = {}): PrevisPlayer {
  const look = checkLook('createPrevisPlayer', options.look);
  const doc = docForLook(fullDoc, look);
  if (hasModels(doc)) throw new Error('createPrevisPlayer: doc has model nodes, use loadPrevisPlayer');
  const ws = doc.worldScale ?? DEFAULT_WORLD_SCALE;
  let restore: () => void;
  try {
    restore = setupScene(sdk, doc, look, ws);
  } catch (e) {
    // Only the textured setup can throw (rim lights out of the engine's range); it has undone itself
    throw look === 'textured' ? new Error(`createPrevisPlayer: ${messageOf(e)}`, { cause: e }) : e;
  }
  const created: number[] = [];
  let objects: Map<string, NodeObjects>;
  try {
    objects = buildNodes(sdk, doc, ws, created, look);
  } catch (e) {
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    restore();
    throw e;
  }
  let resolver: ParentResolver | null;
  try {
    resolver = captureParents(doc, ws, objects);
  } catch (e) {
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    restore();
    throw new Error(`createPrevisPlayer: ${messageOf(e)}`, { cause: e });
  }
  return makePlayer(sdk, doc, ws, restore, objects, created, resolver);
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Player for any doc: loads the glTF files of `model` nodes (in parallel; resolved sources are
 * cached per `src`, each node gets its own load) and then behaves like `createPrevisPlayer`. `options.look`
 * picks the pass (see LOOKS). On a failure or abort everything created so far is removed, the theme (and in
 * the textured look shading, lighting, shadows and point lights) restored and the promise
 * rejects with `loadPrevisPlayer: node "<id>" (<src>): <cause>`.
 */
export async function loadPrevisPlayer(sdk: Charturbo, fullDoc: PrevisDoc, options: PrevisLoadOptions = {}): Promise<PrevisPlayer> {
  const { signal } = options;
  const look = checkLook('loadPrevisPlayer', options.look);
  if (signal?.aborted) throw new Error(`loadPrevisPlayer: ${messageOf(abortError(signal))}`, { cause: abortError(signal) });
  const lookDoc = docForLook(fullDoc, look);
  const doc = attachForLook(lookDoc);
  const ws = doc.worldScale ?? DEFAULT_WORLD_SCALE;
  // RETARGET FROM A MODEL: the sources' bones (throws on a missing sourceMap, before anything is set up) and the pose-only
  // copies (they are never drawn: no textures)
  let sourceBones: Map<string, string[]>;
  try {
    sourceBones = modelSourceBones(doc);
  } catch (e) {
    throw new Error(`loadPrevisPlayer: ${messageOf(e)}`, { cause: e });
  }
  const poseOnly = new Set(lookDoc.nodes.filter((n) => !drawnIn(n, look)).map((n) => n.id));
  let restore: () => void;
  try {
    restore = setupScene(sdk, doc, look, ws);
  } catch (e) {
    // Only the textured setup can throw (rim lights out of the engine's range); it has undone itself
    throw look === 'textured' ? new Error(`loadPrevisPlayer: ${messageOf(e)}`, { cause: e }) : e;
  }
  const created: number[] = [];
  const loaded = new Set<GltfLoadResult>();
  // Aborts the sibling loads on the first failure, and on the caller's signal
  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort(signal!.reason);
  signal?.addEventListener('abort', onAbort);
  const sources = new Map<string, Promise<GltfSource>>();
  const resolve = (src: string): Promise<GltfSource> => {
    let p = sources.get(src);
    if (!p) {
      p = Promise.resolve(options.resolveModel ? options.resolveModel(src) : src);
      sources.set(src, p);
    }
    return p;
  };
  const results = new Map<NodeObjects, GltfLoadResult>();
  const loads = new Map<NodeObjects, Promise<void>>();
  let failure: { node: PrevisNode; cause: unknown } | null = null;
  // RETARGET FROM A MODEL: each target's source node and the sources' rest (read once per load result; validate.ts allows
  // one sourceMap per source)
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  let objects: Map<string, NodeObjects> | null = null;
  const sourceNodeOf = (o: NodeObjects): NodeObjects | undefined => {
    const s = modelSourceOf(o.node, byId);
    return s ? objects?.get(s.id) : undefined;
  };
  const rests = new Map<GltfLoadResult, SourceRest>();
  const sourceRest = (target: NodeObjects): SourceRest => {
    const src = sourceNodeOf(target)!;
    const r = results.get(src);
    if (!r) throw new Error(`model.retarget: the source "${src.node.id}" is not loaded`);
    let rest = rests.get(r);
    if (!rest) {
      rest = sourceRestOf(sdk, src, r, sourceMapOf(target.node), ws);
      rests.set(r, rest);
    }
    return rest;
  };

  const loadNode = async (o: NodeObjects): Promise<void> => {
    const n = o.node;
    const model = n.model!;
    const anim = model.animation;
    const posable = posableNames(o, sourceBones.get(n.id));
    const check = (): void => {
      if (ctl.signal.aborted) throw abortError(ctl.signal);
    };
    const load = async (scale?: number): Promise<GltfLoadResult> => {
      const source = await resolve(model.src);
      check();
      const r = await sdk.loadGltf(source, {
        signal: ctl.signal,
        animations: anim !== undefined,
        // Flat colors drop every map: skip images (texture budget, texture-only extensions); textured keeps them
        textures: look === 'textured' && !poseOnly.has(n.id),
        ...(posable.length > 0 ? { posable } : {}),
        ...(options.decoders ? { decoders: options.decoders } : {}),
        ...(scale !== undefined ? { scale } : {}),
        // Ground lock reads the posed vertices back (GltfAnimator.posedMinAlong)
        ...(model.groundLock === true ? { readback: true } : {}),
      });
      loaded.add(r);
      check();
      return r;
    };
    try {
      check();
      let r = await load();
      if (r.objects.length === 0) throw new Error('the model has no triangle meshes');
      // Model source: its load must be done (rest pose, FIT scale); only that one is awaited (see RETARGET FROM A MODEL)
      const src = sourceNodeOf(o);
      if (src) {
        await loads.get(src);
        check();
      }
      // Retarget: the FIT scale is the leg ratio, not a `size` fit
      const kMin = model.retarget
        ? retargetLoadFactor(sdk, r, n, fullDoc, ws, src ? sourceRest(o) : undefined)
        : minFitFactor(n, ws, boundsOf(r).extent);
      if (kMin < MIN_OBJECT_SCALE) {
        // Too small for the object scale clamp: bake the factor into the vertices (see header)
        loaded.delete(r);
        sdk.disposeGltf(r);
        r = await load(kMin);
      }
      if (anim) {
        const names = r.animations.map((a) => a.name);
        for (const { clip } of normalizeAnimation(anim)) {
          const ok = typeof clip === 'number' ? Number.isInteger(clip) && clip >= 0 && clip < names.length : names.includes(clip);
          if (!ok) {
            const list = names.length > 0 ? names.map((s, i) => `${i} ${JSON.stringify(s)}`).join(', ') : 'none';
            throw new Error(`unknown animation clip ${JSON.stringify(clip)} (available: ${list})`);
          }
        }
      }
      results.set(o, r);
    } catch (e) {
      if (!failure) {
        failure = { node: n, cause: e };
        ctl.abort();
      }
      throw e;
    }
  };

  try {
    objects = buildNodes(sdk, doc, ws, created, look);
  } catch (e) {
    signal?.removeEventListener('abort', onAbort);
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    restore();
    throw e;
  }
  // A pure pivot model is still loaded (invisible) when a node hangs from one of its joints, and so is a model source
  const jobs = [...objects.values()].filter(
    (o) => o.node.shape === 'model' && o.node.model && (hasShape(o.node) || o.sockets.length > 0 || sourceBones.has(o.node.id)),
  );
  // All loads start together; a model-sourced retarget waits for its source's load only, and attaches after the others
  // (see RETARGET FROM A MODEL)
  for (const o of jobs) loads.set(o, loadNode(o));
  await Promise.allSettled(loads.values());
  const late = jobs.filter((o) => sourceNodeOf(o) !== undefined);
  const early = late.length > 0 ? jobs.filter((o) => !late.includes(o)) : jobs;
  signal?.removeEventListener('abort', onAbort);

  const fail = (node: PrevisNode, cause: unknown): never => {
    for (const r of loaded) sdk.disposeGltf(r);
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    restore();
    throw new Error(`loadPrevisPlayer: node "${node.id}" (${node.model?.src}): ${messageOf(cause)}`, { cause });
  };
  if (failure) {
    const f: { node: PrevisNode; cause: unknown } = failure;
    return fail(f.node, f.cause);
  }
  for (const o of [...early, ...late]) {
    try {
      const src = sourceNodeOf(o);
      attachModel(sdk, o, results.get(o)!, created, look, fullDoc, ws, sourceBones.get(o.node.id), src ? { node: src, rest: sourceRest(o) } : undefined);
    } catch (e) {
      return fail(o.node, e);
    }
  }
  let resolver: ParentResolver | null;
  try {
    resolver = captureParents(doc, ws, objects);
  } catch (e) {
    for (const r of loaded) sdk.disposeGltf(r);
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    restore();
    throw new Error(`loadPrevisPlayer: ${messageOf(e)}`, { cause: e });
  }
  return makePlayer(sdk, lookDoc, ws, restore, objects!, created, resolver);
}
