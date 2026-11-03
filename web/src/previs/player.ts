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
 */
import type { Charturbo, ObjectMaterialDescriptor, PrimitiveShape } from '../sdk/charturbo';
import type { GltfSource, GltfLoadResult, GltfDecoders } from '../sdk/scene-gltf';
import type { GltfAnimator, GltfClipWeight } from '../sdk/scene-gltf-anim';
import {
  clipWeightsAt,
  createParentResolver,
  eulerYXZToQuat,
  evalTrack,
  evaluateFrame,
  matrixToEulerYXZ,
  nodeStateAt,
  parentRefOf,
  worldTransform,
  type JointFrame,
  type ParentResolver,
  type Quat,
} from './evaluate';

export { eulerYXZToQuat, matrixToEulerYXZ };
import type { ClipWeight, FrameState, NodeState, PrevisDoc, PrevisModelAnimation, PrevisModelFit, PrevisNode, Rgb, Vec3 } from './types';

export interface PrevisPlayer {
  /** Applies the doc at `time` seconds to the scene (call `sdk.render()` afterwards). */
  frame(time: number): FrameState;
  /** Removes the created objects and glTF models (with their animators) and restores the theme (background). */
  dispose(): void;
}

export interface PrevisLoadOptions {
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
  /** Bumped by every player call that re-poses the animator (setNodeRotations / setBlend). */
  poseVersion: number;
  /** Inputs of `lift`: [poseVersion, k (3), pivot world q (4), p_y]; null: not computed yet. */
  liftKey: number[] | null;
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

const eqVec = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const scaled = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const rgba = (c: Rgb, visible: boolean): [number, number, number, number] => [c[0], c[1], c[2], visible ? 1 : 0];

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

/** Flat look (see header); returns the theme to restore. */
function setupScene(sdk: Charturbo, doc: PrevisDoc): ReturnType<Charturbo['getTheme']> {
  const prevTheme = sdk.getTheme();
  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);
  sdk.setHelpers({ showGrid: false, showAxes: false });
  sdk.setShadows({ enabled: false });
  sdk.setShading({ model: 'pbr', toneMapping: 'none', exposure: 1, environment: { intensity: 0 } });
  sdk.setLighting({ ambientIntensity: 0, directionalIntensity: 0, pointIntensity: 0 });
  sdk.setTheme({ ...prevTheme, surface: [doc.background[0], doc.background[1], doc.background[2], 1] });
  return prevTheme;
}

/** Creates pivots and primitive meshes (model nodes get their FIT later); pushes ids onto `created`. */
function buildNodes(sdk: Charturbo, doc: PrevisDoc, ws: number, created: number[]): Map<string, NodeObjects> {
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
    if (hasShape(n) && n.shape !== 'model') {
      meshId = sdk.addPrimitive({
        shape: n.shape as PrimitiveShape,
        name: `previs:${n.id}:mesh`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: meshScale,
        color: rgba(n.color, meshVisible),
        metallic: 0,
        roughness: 1,
        emissive: 1,
        bodyType: 'static',
        parentId: pivotId,
        castShadow: false,
        receiveShadow: false,
      });
      created.push(meshId);
    }
    objects.set(n.id, {
      node: n,
      pivotId,
      meshId,
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
    // Back to what the player last sent (frame 0 at load)
    for (const m of posed) {
      m.poseVersion++;
      if (m.jointNames.length > 0) sendJoints(m, m.joints);
      if (m.segments.length > 0) m.animator!.setBlend(toBlend(m.segments, m.clips));
    }
  }
  return resolver;
}

/** Puts a loaded model under a new FIT object of node `o` and applies the flat look and its clip. */
function attachModel(sdk: Charturbo, o: NodeObjects, result: GltfLoadResult, created: number[]): void {
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
  for (const id of result.objects) {
    sdk.setObjectParent(id, fitId);
    sdk.setObjectMaterial(id, { ...FLAT_GLTF_MATERIAL, color: rgba(n.color, o.meshVisible) });
  }
  let animator: GltfAnimator | null = null;
  let segments: PrevisModelAnimation[] = [];
  let clips: ClipWeight[] = [];
  const anim = n.model?.animation;
  const jointTracks = n.tracks?.joints;
  const jointNames = jointTracks ? Object.keys(jointTracks) : [];
  const posable = posableNames(o);
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
    poseVersion: 0,
    liftKey: null,
  };
  if (animator && jointNames.length > 0) sendJoints(model, joints); // initial offsets = frame 0
  if (anim && animator) {
    model.segments = segments = normalizeAnimation(anim);
    model.clips = clips = clipWeightsAt(anim, 0);
    animator.setBlend(toBlend(segments, clips)); // initial pose = frame 0
  }
  o.model = model;
  updateSockets(sdk, o.sockets, model); // frame-0 pose; nodeMatrix errors fail the load
}

/** `posable` of a model node: `tracks.joints` names, then socket joints not already listed. */
function posableNames(o: NodeObjects): string[] {
  const names = o.node.tracks?.joints ? Object.keys(o.node.tracks.joints) : [];
  for (const s of o.sockets) if (!names.includes(s.joint)) names.push(s.joint);
  return names;
}

const sameMatrix = (a: Float32Array, b: Float32Array): boolean => {
  for (let i = 0; i < 16; i++) if (a[i] !== b[i]) return false;
  return true;
};

/** Moves every socket of a model to its joint's current posed frame (see SOCKETS); skips unchanged ones. */
function updateSockets(sdk: Charturbo, sockets: SocketObjects[], m: ModelObjects): void {
  for (const s of sockets) {
    const mat = m.animator!.nodeMatrix(s.joint, m.scratch);
    if (s.k !== null && eqVec(s.k, m.k) && eqVec(s.lift, m.lift) && sameMatrix(mat, s.matrix)) continue;
    s.matrix.set(mat.subarray(0, 16));
    s.k = [...m.k];
    s.lift = [...m.lift];
    const { position, rotation } = socketTransform(mat, m.k, m.center, s.rot);
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
  doc: PrevisDoc,
  ws: number,
  prevTheme: ReturnType<Charturbo['getTheme']>,
  objects: Map<string, NodeObjects>,
  created: number[],
  resolver: ParentResolver | null,
): PrevisPlayer {
  const reparented = [...objects.values()].filter((o) => o.node.tracks?.parent !== undefined);
  // Ground-locked loaded models and the owners of pivot / socket objects (their world chain, see GROUND LOCK)
  const locked = [...objects.values()].filter((o) => o.model?.groundLock === true && o.model.animator !== null);
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
      const fs = evaluateFrame(doc, time);

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
        const local = st.parentRef && resolver ? resolver.local(o.node, st) : st;
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
          if (m) {
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
          const color = rgba(o.node.color, st.visible);
          if (m) for (const oid of m.result.objects) sdk.setObjectMaterial(oid, { color });
          else sdk.setObjectMaterial(o.meshId!, { color });
          o.meshVisible = st.visible;
        }
        if (m?.animator) {
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
      sdk.setTheme(prevTheme);
    },
  };
}

const hasModels = (doc: PrevisDoc): boolean => doc.nodes.some((n) => n.shape === 'model');

/** Sync player for docs without `model` nodes (use `loadPrevisPlayer` for those). */
export function createPrevisPlayer(sdk: Charturbo, doc: PrevisDoc): PrevisPlayer {
  if (hasModels(doc)) throw new Error('createPrevisPlayer: doc has model nodes, use loadPrevisPlayer');
  const ws = doc.worldScale ?? DEFAULT_WORLD_SCALE;
  const prevTheme = setupScene(sdk, doc);
  const created: number[] = [];
  const objects = buildNodes(sdk, doc, ws, created);
  let resolver: ParentResolver | null;
  try {
    resolver = captureParents(doc, ws, objects);
  } catch (e) {
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    sdk.setTheme(prevTheme);
    throw new Error(`createPrevisPlayer: ${messageOf(e)}`, { cause: e });
  }
  return makePlayer(sdk, doc, ws, prevTheme, objects, created, resolver);
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Player for any doc: loads the glTF files of `model` nodes (in parallel; resolved sources are
 * cached per `src`, each node gets its own load) and then behaves like `createPrevisPlayer`. On a
 * failure or abort everything created so far is removed, the theme restored and the promise
 * rejects with `loadPrevisPlayer: node "<id>" (<src>): <cause>`.
 */
export async function loadPrevisPlayer(sdk: Charturbo, doc: PrevisDoc, options: PrevisLoadOptions = {}): Promise<PrevisPlayer> {
  const { signal } = options;
  if (signal?.aborted) throw new Error(`loadPrevisPlayer: ${messageOf(abortError(signal))}`, { cause: abortError(signal) });
  const ws = doc.worldScale ?? DEFAULT_WORLD_SCALE;
  const prevTheme = setupScene(sdk, doc);
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
  let failure: { node: PrevisNode; cause: unknown } | null = null;

  const loadNode = async (o: NodeObjects): Promise<void> => {
    const n = o.node;
    const model = n.model!;
    const anim = model.animation;
    const posable = posableNames(o);
    const check = (): void => {
      if (ctl.signal.aborted) throw abortError(ctl.signal);
    };
    const load = async (scale?: number): Promise<GltfLoadResult> => {
      const source = await resolve(model.src);
      check();
      const r = await sdk.loadGltf(source, {
        signal: ctl.signal,
        animations: anim !== undefined,
        // Flat colors drop every map: skip images (texture budget, texture-only extensions)
        textures: false,
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
      const kMin = minFitFactor(n, ws, boundsOf(r).extent);
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

  const objects = buildNodes(sdk, doc, ws, created);
  // A pure pivot model is still loaded (invisible) when a node hangs from one of its joints
  const jobs = [...objects.values()].filter((o) => o.node.shape === 'model' && o.node.model && (hasShape(o.node) || o.sockets.length > 0));
  await Promise.allSettled(jobs.map(loadNode));
  signal?.removeEventListener('abort', onAbort);

  const fail = (node: PrevisNode, cause: unknown): never => {
    for (const r of loaded) sdk.disposeGltf(r);
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    sdk.setTheme(prevTheme);
    throw new Error(`loadPrevisPlayer: node "${node.id}" (${node.model?.src}): ${messageOf(cause)}`, { cause });
  };
  if (failure) {
    const f: { node: PrevisNode; cause: unknown } = failure;
    return fail(f.node, f.cause);
  }
  for (const o of jobs) {
    try {
      attachModel(sdk, o, results.get(o)!, created);
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
    sdk.setTheme(prevTheme);
    throw new Error(`loadPrevisPlayer: ${messageOf(e)}`, { cause: e });
  }
  return makePlayer(sdk, doc, ws, prevTheme, objects, created, resolver);
}
