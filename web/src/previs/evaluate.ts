/**
 * Previs timeline evaluator: pure functions, no DOM, no GPU.
 *
 * Engine transform convention (crates/charturbo-core/src/scene/mod.rs, Transform::local_matrix /
 * resolve_world_matrix), mirrored by `worldPosition`:
 * - local = T(position) * R * S(scale); R = glam Quat::from_euler(YXZ, ry, rx, rz) = Ry * Rx * Rz
 *   (a column vector is rotated by Rz first, then Rx, then Ry).
 * - The engine composes world = parentWorld * local over the whole chain, scale included. The previs
 *   doc deliberately does NOT: a node's `size` only sizes its own shape and never scales children or
 *   their offsets (invisible joint pivots have tiny sizes). So the world transform here is parent
 *   translation + rotation composition only; the player realises this with scale-1 pivot objects.
 * - The engine caps the chain at MAX_HIERARCHY_DEPTH and then treats the node as a root; we do too.
 *
 * RE-PARENTING (`tracks.parent`, see types.ts), mirrored by `worldTransform` and the player:
 * - Active key at time t: the last key with t_k <= t (step; -1 before the first key: static `parent` /
 *   `parentJoint`). W(n, t) = F(ref, t) * L(n, t), F = the active parent's world frame (identity for
 *   null, the parent's W, times the joint frame for a `joint` ref), L = the node's local transform.
 * - The capture of key k is C_k = F(ref_k, t_k)^-1 * W^-(n, t_k), where W^- is the LEFT LIMIT at t_k:
 *   every node of the chain uses its last key with t_key < t_k (the configuration just before the
 *   switch, evaluated at t_k). So simultaneous switches (a swap / hand-off in one instant) are
 *   well defined and W(n, t_k) = W^-(n, t_k) exactly: no pop when the tracks are continuous at t_k.
 *   F(ref_k, t_k) uses the configuration AT t_k (validate.ts rejects parent cycles at every key time).
 * - L(n, t) = raw (P(t), R(t)) for key -1 and `snap` keys; otherwise
 *   (C_k.p + P(t) - P(t_k), C_k.q * R(t_k)^-1 * R(t)) with quaternions (Euler YXZ, `eulerYXZToQuat`).
 * - Joint frames come from the caller (`WorldTransformOptions.jointFrame`; the player poses the model
 *   at that time and reads the socket transform); without one a joint in the chain throws.
 */
import type {
  ClipWeight,
  Easing,
  FrameState,
  NodeState,
  PrevisDoc,
  PrevisModelAnimation,
  PrevisNode,
  PrevisParentRef,
  Shot,
  Track,
  Vec3,
} from './types';

const DEFAULT_FOV_DEG = 45;
/** Mirrors the engine's parent-chain cap; deeper ancestors are ignored. */
const MAX_HIERARCHY_DEPTH = 32;

function applyEase(ease: Easing | undefined, u: number): number {
  switch (ease) {
    case 'ease-in':
      return u * u;
    case 'ease-out':
      return 1 - (1 - u) * (1 - u);
    case 'ease-in-out':
      return u * u * (3 - 2 * u);
    case 'step':
      return 0;
    default:
      return u;
  }
}

function lerp<T extends number | Vec3 | boolean>(a: T, b: T, u: number): T {
  if (typeof a === 'number') return (a + ((b as number) - a) * u) as T;
  if (typeof a === 'boolean') return a;
  const av = a as Vec3;
  const bv = b as Vec3;
  return [
    av[0] + (bv[0] - av[0]) * u,
    av[1] + (bv[1] - av[1]) * u,
    av[2] + (bv[2] - av[2]) * u,
  ] as Vec3 as T;
}

function copyVal<T extends number | Vec3 | boolean>(v: T): T {
  return (Array.isArray(v) ? [...v] : v) as T;
}

/** Value of `track` at time `t`; `rest` when the track is empty/undefined. Held outside the key range. */
export function evalTrack<T extends number | Vec3 | boolean>(
  track: Track<T> | undefined,
  t: number,
  rest: T,
): T {
  if (!track || track.length === 0) return copyVal(rest);
  const first = track[0];
  if (t <= first.t) return copyVal(first.v);
  const last = track[track.length - 1];
  if (t >= last.t) return copyVal(last.v);
  // Find segment lo with track[lo].t <= t < track[hi].t, hi = lo + 1.
  let lo = 0;
  let hi = track.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = track[lo];
  const b = track[hi];
  if (typeof a.v === 'boolean' || a.ease === 'step') return copyVal(a.v);
  const span = b.t - a.t;
  const u = span > 0 ? (t - a.t) / span : 1;
  return lerp(a.v, b.v, applyEase(a.ease, u));
}

/** End of the last shot (max shot end). 0 when there are no shots. */
export function docDuration(doc: PrevisDoc): number {
  let d = 0;
  for (const s of doc.shots) if (s.end > d) d = s.end;
  return d;
}

export function frameCount(doc: PrevisDoc): number {
  return Math.round(docDuration(doc) * doc.fps);
}

function pickShot(doc: PrevisDoc, time: number): Shot {
  const shots = doc.shots;
  if (shots.length === 0) throw new Error('previs doc has no shots');
  let first = shots[0];
  let last = shots[0];
  for (const s of shots) {
    if (s.start < first.start) first = s;
    if (s.end > last.end) last = s;
    if (s.start <= time && time < s.end) return s;
  }
  return time < first.start ? first : last;
}

/**
 * Weighted clips of a model's animation at global time `t` (see `PrevisModelAnimation` SEGMENTS).
 * Never emits a zero-weight entry; weights sum to 1.
 */
export function clipWeightsAt(animation: PrevisModelAnimation | PrevisModelAnimation[], t: number): ClipWeight[] {
  const segs = Array.isArray(animation) ? animation : [animation];
  const start = (i: number) => segs[i].start ?? 0;
  const timeOf = (i: number) => Math.max(0, t - start(i)) * (segs[i].speed ?? 1);
  let i = 0;
  for (let k = 0; k < segs.length; k++) if (start(k) <= t) i = k;
  const blend = segs[i].blendIn ?? 0;
  if (i > 0 && blend > 0 && t < start(i) + blend) {
    const w = (t - start(i)) / blend;
    if (w > 0) {
      return [
        { segment: i - 1, time: timeOf(i - 1), weight: 1 - w },
        { segment: i, time: timeOf(i), weight: w },
      ];
    }
    return [{ segment: i - 1, time: timeOf(i - 1), weight: 1 }];
  }
  return [{ segment: i, time: timeOf(i), weight: 1 }];
}

/** Static parent assignment of a node (what applies before the first `tracks.parent` key). */
function staticRef(node: PrevisNode): PrevisParentRef | null {
  if (node.parent === undefined) return null;
  return node.parentJoint !== undefined ? { node: node.parent, joint: node.parentJoint } : { node: node.parent };
}

/**
 * Index of the active `tracks.parent` key at `time`: the last key with t_k <= time (`strict`: t_k < time,
 * the left limit used by captures); -1 before the first key or without the track.
 */
export function parentKeyAt(node: PrevisNode, time: number, strict = false): number {
  const tr = node.tracks?.parent;
  if (!tr) return -1;
  let k = -1;
  for (let i = 0; i < tr.length; i++) {
    if (strict ? tr[i].t < time : tr[i].t <= time) k = i;
    else break;
  }
  return k;
}

/** Parent assignment of key `key` of `node` (-1: the static fields); a fresh copy. */
export function parentRefOf(node: PrevisNode, key: number): PrevisParentRef | null {
  if (key < 0) return staticRef(node);
  const v = node.tracks!.parent![key].v;
  return v === null ? null : { ...v };
}

/** Local state of one node at `time` (what `evaluateFrame` puts in `nodes`). */
export function nodeStateAt(node: PrevisNode, time: number): NodeState {
  const tr = node.tracks;
  const state: NodeState = {
    position: evalTrack(tr?.position, time, node.position),
    rotation: evalTrack(tr?.rotation, time, node.rotation),
    size: evalTrack(tr?.size, time, node.size),
    visible: evalTrack(tr?.visible, time, node.visible ?? true),
  };
  if (tr?.joints) {
    // Null prototype: a joint literally named "__proto__" stays an own key
    state.joints = Object.create(null) as Record<string, Vec3>;
    for (const [name, jt] of Object.entries(tr.joints)) state.joints[name] = evalTrack(jt, time, [0, 0, 0]);
  }
  const anim = node.model?.animation;
  if (anim) {
    state.clips = clipWeightsAt(anim, time);
    if (!Array.isArray(anim)) state.clipTime = state.clips[0].time;
  }
  if (tr?.parent) {
    const key = parentKeyAt(node, time);
    state.parentRef = { ref: parentRefOf(node, key), key };
  }
  return state;
}

/** Rotate `v` by R = Ry * Rx * Rz (engine glam EulerRot::YXZ). */
function rotateYXZ(v: Vec3, rot: Vec3): Vec3 {
  const [rx, ry, rz] = rot;
  let [x, y, z] = v;
  const cz = Math.cos(rz);
  const sz = Math.sin(rz);
  [x, y] = [cz * x - sz * y, sz * x + cz * y];
  const cx = Math.cos(rx);
  const sx = Math.sin(rx);
  [y, z] = [cx * y - sx * z, sx * y + cx * z];
  const cy = Math.cos(ry);
  const sy = Math.sin(ry);
  [x, z] = [cy * x + sy * z, -sy * x + cy * z];
  return [x, y, z];
}

/**
 * World position of node `id` given local node states (parent translation + rotation composed; sizes ignored,
 * see header). Docs with `tracks.parent` go through `worldTransform` (captures included); there it THROWS
 * when the chain of `id` uses a joint (static `parentJoint` or a joint ref) because joint frames need the
 * player. Docs without `tracks.parent` ignore joints (approximation: parent node origin).
 */
export function worldPosition(doc: PrevisDoc, nodes: Record<string, NodeState>, id: string): Vec3 {
  if (doc.nodes.some((n) => n.tracks?.parent !== undefined)) return worldTransform(doc, nodes, id).position;
  const byId = new Map<string, PrevisNode>();
  for (const n of doc.nodes) byId.set(n.id, n);

  const start = nodes[id];
  if (!start) throw new Error(`previs: unknown node "${id}"`);
  let p: Vec3 = [...start.position];
  let cur = byId.get(id);
  let depth = 0;
  while (cur?.parent !== undefined && depth < MAX_HIERARCHY_DEPTH) {
    const parent = byId.get(cur.parent);
    const ps = parent ? nodes[parent.id] : undefined;
    if (!parent || !ps) break;
    const r = rotateYXZ(p, ps.rotation);
    p = [r[0] + ps.position[0], r[1] + ps.position[1], r[2] + ps.position[2]];
    cur = parent;
    depth++;
  }
  return p;
}

/** Quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** Quaternion [x, y, z, w] of Euler [rx, ry, rz] in order YXZ: q = qY * qX * qZ (R = Ry * Rx * Rz). */
export function eulerYXZToQuat(rot: Vec3): Quat {
  const hx = rot[0] / 2, hy = rot[1] / 2, hz = rot[2] / 2;
  const sx = Math.sin(hx), cx = Math.cos(hx);
  const sy = Math.sin(hy), cy = Math.cos(hy);
  const sz = Math.sin(hz), cz = Math.cos(hz);
  // qY * qX
  const ax = cy * sx, ay = sy * cx, az = -sy * sx, aw = cy * cx;
  // (qY * qX) * qZ with qZ = (0, 0, sz, cz)
  return [ax * cz + ay * sz, ay * cz - ax * sz, az * cz + aw * sz, aw * cz - az * sz];
}

/**
 * Euler [rx, ry, rz] (radians, order YXZ: R = Ry * Rx * Rz, the engine's convention) of a row-major 3x3
 * rotation. With R = Ry Rx Rz: R12 = -sin x, (R10, R11) = cos x (sin z, cos z), (R02, R22) = cos x (sin y, cos y).
 * x = atan2(-R12, |(R10, R11)|) stays accurate near +-90 degrees; in gimbal lock (cos x < 1e-9) only y -+ z is
 * defined, so z = 0 and y = atan2(-R20, R00).
 */
export function matrixToEulerYXZ(r: ArrayLike<number>): Vec3 {
  const cx = Math.hypot(r[3], r[4]);
  const x = Math.atan2(-r[5], cx);
  if (cx < 1e-9) return [x, Math.atan2(-r[6], r[0]), 0];
  return [x, Math.atan2(r[2], r[8]), Math.atan2(r[3], r[4])];
}

/** Euler YXZ of a (not necessarily unit) quaternion, via its rotation matrix. */
export function quatToEulerYXZ(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const s = 2 / (x * x + y * y + z * z + w * w);
  return matrixToEulerYXZ([
    1 - s * (y * y + z * z), s * (x * y - z * w), s * (x * z + y * w),
    s * (x * y + z * w), 1 - s * (x * x + z * z), s * (y * z - x * w),
    s * (x * z - y * w), s * (y * z + x * w), 1 - s * (x * x + y * y),
  ]);
}

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** v rotated by unit q: v + 2w (u x v) + 2 u x (u x v). */
function qrot(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

/** Rigid transform: translation (meters) then rotation. */
interface Rigid {
  p: Vec3;
  q: Quat;
}
const IDENTITY: Rigid = { p: [0, 0, 0], q: [0, 0, 0, 1] };
const compose = (a: Rigid, b: Rigid): Rigid => {
  const r = qrot(a.q, b.p);
  return { p: [a.p[0] + r[0], a.p[1] + r[1], a.p[2] + r[2]], q: qmul(a.q, b.q) };
};
const invert = (a: Rigid): Rigid => {
  const q = qconj(a.q);
  const r = qrot(q, a.p);
  return { p: [-r[0], -r[1], -r[2]], q };
};

/** World (or parent-frame) transform: position in meters, rotation as Euler YXZ and as quaternion. */
export interface WorldTransform {
  position: Vec3;
  rotation: Vec3;
  quaternion: Quat;
}

/** Posed frame of a joint in its model node's frame: what a SOCKET has (meters, Euler YXZ, scale removed). */
export interface JointFrame {
  position: Vec3;
  rotation: Vec3;
}

export interface WorldTransformOptions {
  /** Time of the `nodes` states (needed only when a joint frame of that frame is involved). */
  time?: number;
  /**
   * Frame of joint `joint` of model node `model` at global `time` (static `parentJoint` or a `joint` ref;
   * called for frame times and capture times). Without it a joint anywhere in the chain throws.
   */
  jointFrame?: (model: string, joint: string, time: number) => JointFrame;
}

/** Capture of one `tracks.parent` key: the node's local transform in the new parent's frame at t_k. */
export interface ParentCapture {
  position: Vec3;
  quaternion: Quat;
}

/** Re-parenting math for one doc (see RE-PARENTING); captures are computed once and memoized. */
export interface ParentResolver {
  /** World transform of `id` for the local states `nodes` of one frame (`evaluateFrame(...).nodes`). */
  world(nodes: Record<string, NodeState>, id: string): WorldTransform;
  /** Local transform of `node` in its active parent's frame for its frame `state` (raw for key -1 / snap). */
  local(node: PrevisNode, state: NodeState): { position: Vec3; rotation: Vec3 };
  /** Capture of key `key` of node `id`; null for `snap` keys. */
  capture(id: string, key: number): ParentCapture | null;
  /** Computes every capture of the doc, in time order (key time, then doc order). */
  captureAll(): void;
}

export function createParentResolver(doc: PrevisDoc, options: WorldTransformOptions = {}): ParentResolver {
  const byId = new Map<string, PrevisNode>();
  for (const n of doc.nodes) byId.set(n.id, n);
  const memo = new Map<string, Rigid | null>();
  const busy = new Set<string>();
  const euler = (v: Vec3): Quat => eulerYXZToQuat(v);

  const refValue = (node: PrevisNode, key: number): PrevisParentRef | null =>
    key < 0 ? staticRef(node) : node.tracks!.parent![key].v;

  const local = (node: PrevisNode, key: number, pos: Vec3, rot: Vec3): Rigid => {
    const ref = refValue(node, key);
    if (key < 0 || ref?.snap === true) return { p: [...pos], q: euler(rot) };
    const c = capture(node, key)!;
    const tk = node.tracks!.parent![key].t;
    const pk = evalTrack(node.tracks?.position, tk, node.position);
    const rk = evalTrack(node.tracks?.rotation, tk, node.rotation);
    return {
      p: [c.p[0] + pos[0] - pk[0], c.p[1] + pos[1] - pk[1], c.p[2] + pos[2] - pk[2]],
      q: qmul(c.q, qmul(qconj(euler(rk)), euler(rot))),
    };
  };

  /** World frame of a parent assignment at `t` (`nodes`: frame states; otherwise evaluated at t, left limit if `strict`). */
  const frameOf = (
    child: PrevisNode,
    ref: PrevisParentRef | null,
    t: number,
    strict: boolean,
    depth: number,
    nodes: Record<string, NodeState> | null,
  ): Rigid => {
    if (ref === null || depth >= MAX_HIERARCHY_DEPTH) return IDENTITY;
    const parent = byId.get(ref.node);
    if (!parent || (nodes && !nodes[parent.id])) return IDENTITY;
    const w = world(parent, t, strict, depth + 1, nodes);
    if (ref.joint === undefined) return w;
    if (!options.jointFrame || !Number.isFinite(t)) {
      throw new Error(
        `previs: node "${child.id}" hangs from joint "${ref.joint}" of model "${ref.node}"; its world transform needs the joint pose (options.jointFrame${options.jointFrame ? ' and options.time' : ''}), which is only known when rendering`,
      );
    }
    const jf = options.jointFrame(ref.node, ref.joint, t);
    return compose(w, { p: [...jf.position], q: euler(jf.rotation) });
  };

  const world = (node: PrevisNode, t: number, strict: boolean, depth: number, nodes: Record<string, NodeState> | null): Rigid => {
    let pos: Vec3;
    let rot: Vec3;
    let key: number;
    if (nodes) {
      const st = nodes[node.id];
      pos = st.position;
      rot = st.rotation;
      key = st.parentRef?.key ?? (node.tracks?.parent && Number.isFinite(t) ? parentKeyAt(node, t) : -1);
    } else {
      pos = evalTrack(node.tracks?.position, t, node.position);
      rot = evalTrack(node.tracks?.rotation, t, node.rotation);
      key = parentKeyAt(node, t, strict);
    }
    return compose(frameOf(node, refValue(node, key), t, strict, depth, nodes), local(node, key, pos, rot));
  };

  const capture = (node: PrevisNode, key: number): Rigid | null => {
    const id = `${node.id}\u0000${key}`;
    if (memo.has(id)) return memo.get(id)!;
    const k = node.tracks!.parent![key];
    if (k.v?.snap === true) {
      memo.set(id, null);
      return null;
    }
    if (busy.has(id)) throw new Error(`previs: parent cycle through node "${node.id}" at t=${k.t}`);
    busy.add(id);
    try {
      // Left limit under the old configuration, expressed in the new parent's frame at t_k
      const before = world(node, k.t, true, 0, null);
      const frame = frameOf(node, k.v, k.t, false, 0, null);
      const c = compose(invert(frame), before);
      memo.set(id, c);
      return c;
    } finally {
      busy.delete(id);
    }
  };

  const nodeOf = (id: string): PrevisNode => {
    const n = byId.get(id);
    if (!n) throw new Error(`previs: unknown node "${id}"`);
    return n;
  };

  return {
    world(nodes, id) {
      const n = nodeOf(id);
      if (!nodes[id]) throw new Error(`previs: unknown node "${id}"`);
      const w = world(n, options.time ?? NaN, false, 0, nodes);
      return { position: w.p, rotation: quatToEulerYXZ(w.q), quaternion: w.q };
    },
    local(node, state) {
      const key = state.parentRef?.key ?? -1;
      const ref = refValue(node, key);
      if (key < 0 || ref?.snap === true) return { position: [...state.position], rotation: [...state.rotation] };
      const l = local(node, key, state.position, state.rotation);
      return { position: l.p, rotation: quatToEulerYXZ(l.q) };
    },
    capture(id, key) {
      const c = capture(nodeOf(id), key);
      return c && { position: [...c.p], quaternion: [...c.q] };
    },
    captureAll() {
      const keys: { n: PrevisNode; k: number; t: number; order: number }[] = [];
      doc.nodes.forEach((n, order) => n.tracks?.parent?.forEach((kf, k) => keys.push({ n, k, t: kf.t, order })));
      keys.sort((a, b) => a.t - b.t || a.order - b.order || a.k - b.k);
      for (const { n, k } of keys) capture(n, k);
    },
  };
}

/**
 * World transform of node `id` (position in meters, rotation Euler YXZ + quaternion) given the local states of
 * one frame: parent translation + rotation composed (sizes ignored, see header), static parents and
 * `tracks.parent` captures included (see RE-PARENTING). A joint (static `parentJoint` or a `joint` ref, also
 * one met while computing a capture) needs `options.jointFrame` (and `options.time` for the frame's own joints).
 */
export function worldTransform(
  doc: PrevisDoc,
  nodes: Record<string, NodeState>,
  id: string,
  options: WorldTransformOptions = {},
): WorldTransform {
  return createParentResolver(doc, options).world(nodes, id);
}

export function evaluateFrame(doc: PrevisDoc, time: number): FrameState {
  const shot = pickShot(doc, time);
  const nodes: Record<string, NodeState> = {};
  for (const n of doc.nodes) nodes[n.id] = nodeStateAt(n, time);

  const cam = shot.camera;
  const eye = evalTrack<Vec3>(cam.position, time, [0, 0, 0]);
  let target: Vec3;
  if ('follow' in cam.target) {
    const id = cam.target.follow;
    if (!nodes[id]) {
      throw new Error(`previs: shot "${shot.id}" camera follows unknown node "${id}"`);
    }
    const w = worldPosition(doc, nodes, id);
    const o = cam.target.offset ?? [0, 0, 0];
    target = [w[0] + o[0], w[1] + o[1], w[2] + o[2]];
  } else {
    target = evalTrack<Vec3>(cam.target.track, time, [0, 0, 0]);
  }
  const fovDeg = evalTrack<number>(cam.fov, time, DEFAULT_FOV_DEG);
  const roll = evalTrack<number>(cam.roll, time, 0);
  const up = evalTrack<Vec3>(cam.up, time, [0, 1, 0]);

  return { time, shotId: shot.id, camera: { eye, target, fovDeg, roll, up }, nodes };
}
