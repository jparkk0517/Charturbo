/**
 * Previs timeline evaluator: pure functions, no DOM, no GPU.
 *
 * Engine transform convention (crates/charturbo-core/src/scene/mod.rs, Transform::local_matrix /
 * resolve_world_matrix), mirrored by `worldPosition`:
 * - local = T(position) * R * S(scale); R = glam Quat::from_euler(YXZ, ry, rx, rz) = Ry * Rx * Rz
 *   (a column vector is rotated by Rz first, then Rx, then Ry).
 * - world = parentWorld * local over the whole chain, so a parent's scale DOES scale the child's
 *   offset, and the parent's rotation rotates it (non-uniform scale + rotation may shear; same here).
 * - The engine caps the chain at MAX_HIERARCHY_DEPTH and then treats the node as a root; we do too.
 * `size` plays the role of scale (the player maps a unit shape to `size`).
 */
import type {
  Easing,
  FrameState,
  NodeState,
  PrevisDoc,
  PrevisNode,
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

function nodeStateAt(node: PrevisNode, time: number): NodeState {
  const tr = node.tracks;
  return {
    position: evalTrack(tr?.position, time, node.position),
    rotation: evalTrack(tr?.rotation, time, node.rotation),
    size: evalTrack(tr?.size, time, node.size),
    visible: evalTrack(tr?.visible, time, node.visible ?? true),
  };
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

/** World position of node `id` given local node states (parent chain composed like the engine). */
export function worldPosition(doc: PrevisDoc, nodes: Record<string, NodeState>, id: string): Vec3 {
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
    const scaled: Vec3 = [p[0] * ps.size[0], p[1] * ps.size[1], p[2] * ps.size[2]];
    const r = rotateYXZ(scaled, ps.rotation);
    p = [r[0] + ps.position[0], r[1] + ps.position[1], r[2] + ps.position[2]];
    cur = parent;
    depth++;
  }
  return p;
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

  return { time, shotId: shot.id, camera: { eye, target, fovDeg }, nodes };
}
