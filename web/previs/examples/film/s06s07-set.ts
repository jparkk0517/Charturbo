// Shared set + helpers for S06 (s06-warden) and S07 (s07-fall): the warden's vault.
// Layout, lighting, the warden (KayKit Skeleton_Warrior at 3.6 m) with its axe, Haon's props (ember, sword) and a tiny
// glTF forward-kinematics reader for the warden's clips (used only to AUTHOR contact points: where the axe head lands,
// where the axe is when it is released). Nothing here changes the engine; it only builds doc nodes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eulerYXZToQuat, quatToEulerYXZ } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisNode, Quat, Rgb, Track, Vec3 } from '../../../src/previs/index.ts';
import { C, EMBER_D, LIGHT, LOOK, PILLAR_FLAT, SRC, WARDEN_H, add, scale, sub } from './common.ts';

export const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------- quaternions (x, y, z, w), as evaluate.ts
export const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
export const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
export const qrot = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
export const qslerp = (a: Quat, b: Quat, u: number): Quat => {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const bb: Quat = d < 0 ? [-b[0], -b[1], -b[2], -b[3]] : [...b];
  d = Math.abs(d);
  if (d > 0.9995) {
    const q = a.map((v, i) => v + (bb[i] - v) * u) as Quat;
    const n = Math.hypot(...q);
    return q.map((v) => v / n) as Quat;
  }
  const th = Math.acos(d);
  const sa = Math.sin((1 - u) * th) / Math.sin(th);
  const sb = Math.sin(u * th) / Math.sin(th);
  return a.map((v, i) => v * sa + bb[i] * sb) as Quat;
};
/** Euler of q with every component unwrapped to lie within pi of `near`. */
export const eulerNear = (q: Quat, near: Vec3): Vec3 =>
  quatToEulerYXZ(q).map((v, i) => v + 2 * Math.PI * Math.round((near[i] - v) / (2 * Math.PI))) as Vec3;
export const qYaw = (yaw: number): Quat => eulerYXZToQuat([0, yaw, 0]);
export type Pose = { p: Vec3; q: Quat };
export const compose = (a: Pose, b: Pose): Pose => ({ p: add(a.p, qrot(a.q, b.p)), q: qmul(a.q, b.q) });
/** The 8 corners of a box of `size` centred at `c` (local), mapped by pose. */
export const boxCorners = (pose: Pose, size: Vec3, c: Vec3 = [0, 0, 0]): Vec3[] => {
  const out: Vec3[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    out.push(add(pose.p, qrot(pose.q, add(c, [(sx * size[0]) / 2, (sy * size[1]) / 2, (sz * size[2]) / 2]))));
  }
  return out;
};
export const lowestCorner = (pose: Pose, size: Vec3, c: Vec3 = [0, 0, 0]) => Math.min(...boxCorners(pose, size, c).map((v) => v[1]));
export const smooth01 = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
export const r6v = (v: Vec3): Vec3 => v.map((x) => +x.toFixed(6)) as Vec3;
export const dist2 = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);
export const unit2 = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[2]);
  return [v[0] / n, 0, v[2] / n];
};
/** Forward unit vector of a node at yaw (faces +z at yaw 0). */
export const fwd = (yaw: number): Vec3 => [Math.sin(yaw), 0, Math.cos(yaw)];

// ---------------------------------------------------------------- layout (meters; floor top y = 0)
// The vault runs along +x: Haon enters at the west door (x = -19.5) and the altar stands at the far east end. Pillar
// rows at z = +-4.5. Cameras for wide travel shots sit on the +z side, so +x reads screen right.
export const FLOOR = { x0: -20, x1: 26, z0: -9, z1: 9 };
export const PILLAR_SIZE: Vec3 = [1.5, 6, 1.5]; // KayKit pillar stretched to 6 m
export const PILLAR_XS = [-15, -9, -3, 3, 9, 15];
export const ROW_Z = 4.5;
/** The pillar Haon hides behind (front row) and the warden smashes in S07. */
export const P: Vec3 = [-9, 0, ROW_Z];
export const ALTAR: Vec3 = [22.5, 0, 0];
/** Haon's spot when the first chop lands (S06). */
export const C_SPOT: Vec3 = [-7.4, 0, 0.5];
/** Where she dodges to (back and to her right, clear of the swing). */
export const D_SPOT: Vec3 = [-9.0, 0, 1.7];

// ---------------------------------------------------------------- warden (KayKit Skeleton_Warrior)
// Rest bounds (file units, `--inspect`): min [-0.971253, -0.000027, -0.758234], max [0.971253, 2.590435, 0.700537].
const W_MIN: Vec3 = [-0.971253, -0.000027, -0.758234];
const W_MAX: Vec3 = [0.971253, 2.590435, 0.700537];
export const WK = WARDEN_H / (W_MAX[1] - W_MIN[1]); // fit contain, height-limited: file units -> meters
export const W_CENTER: Vec3 = scale(add(W_MIN, W_MAX), 0.5);
export const WARDEN_SIZE: Vec3 = sub(W_MAX, W_MIN).map((v) => +(v * WK).toFixed(4)) as Vec3;
/** World y of the warden node origin (centre of the rest bounds) standing on the floor. */
export const WY = WARDEN_H / 2;
/** Walking_D_Skeletons: the planted toe slides 0.785 file units/s at clip speed 1 (measured from the clip). */
export const WALK_RATE = 0.785 * WK; // m/s per unit clip speed

// Axe (axe_2handed.gltf: grip at the file origin, handle along +y, head at y 0.48..1.29). Hangs on `handslot.r` with
// identity rotation (checked in a render: KayKit 2H clips then hold it across the body / overhead as designed).
const A_MIN: Vec3 = [-0.619774, -0.432982, -0.130899];
const A_MAX: Vec3 = [0.619774, 1.291647, 0.130902];
export const AXE_LEN = 2.2;
export const AXE_S = AXE_LEN / (A_MAX[1] - A_MIN[1]);
export const AXE_SIZE: Vec3 = sub(A_MAX, A_MIN).map((v) => +(v * AXE_S).toFixed(4)) as Vec3;
/** Axe node offset in the slot frame: the bounds centre (the file origin stays on the slot). */
export const AXE_OFF: Vec3 = [0, +(((A_MIN[1] + A_MAX[1]) / 2) * AXE_S).toFixed(5), 0];
/** Axe head centre in the slot frame. */
export const AXE_HEAD: Vec3 = [0, 0.87 * AXE_S, 0];

export function wardenNode(id: string, position: Vec3, yaw: number, animation: NonNullable<PrevisNode['model']>['animation'], tracks?: PrevisNode['tracks']): PrevisNode {
  return {
    id,
    shape: 'model',
    role: 'warden',
    color: C.warden,
    model: { src: SRC.warrior, fit: 'contain', groundLock: true, animation },
    position,
    rotation: [0, yaw, 0],
    rotationPath: 'shortest',
    size: WARDEN_SIZE,
    ...(tracks ? { tracks } : {}),
  };
}
export function axeNode(id: string, parent: string): PrevisNode {
  return {
    id,
    shape: 'model',
    role: 'warden',
    color: C.warden,
    parent,
    parentJoint: 'handslot.r',
    model: { src: SRC.axe, fit: 'contain' },
    position: AXE_OFF,
    rotation: [0, 0, 0],
    size: AXE_SIZE,
  };
}

// ---- tiny glTF FK for the warden's clips (model space, file units) ----
type GNode = { name?: string; children?: number[]; translation?: Vec3; rotation?: Quat; scale?: Vec3 };
const glb = (() => {
  const buf = fs.readFileSync(path.join(HERE, SRC.warrior));
  const jlen = buf.readUInt32LE(12);
  const gl = JSON.parse(buf.subarray(20, 20 + jlen).toString());
  const bin = buf.subarray(20 + jlen + 8);
  const cache = new Map<number, number[][]>();
  const acc = (i: number): number[][] => {
    const hit = cache.get(i);
    if (hit) return hit;
    const a = gl.accessors[i];
    const bv = gl.bufferViews[a.bufferView];
    const n = ({ SCALAR: 1, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const stride = bv.byteStride || n * 4;
    const out: number[][] = [];
    for (let k = 0; k < a.count; k++) {
      const v: number[] = [];
      for (let c = 0; c < n; c++) v.push(bin.readFloatLE(off + k * stride + c * 4));
      out.push(v);
    }
    cache.set(i, out);
    return out;
  };
  const nodes: GNode[] = gl.nodes;
  const parent: number[] = nodes.map(() => -1);
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)));
  const idx = new Map(nodes.map((n, i) => [n.name ?? '', i]));
  return { gl, acc, nodes, parent, idx };
})();
const slerpArr = (a: number[], b: number[], u: number) => qslerp(a as Quat, b as Quat, u);
function sampleChannel(s: { input: number; output: number; interpolation?: string }, p: string, t: number): number[] {
  const inp = glb.acc(s.input).map((v) => v[0]);
  const out = glb.acc(s.output);
  if (t <= inp[0]) return out[0];
  if (t >= inp[inp.length - 1]) return out[out.length - 1];
  let k = 0;
  while (inp[k + 1] < t) k++;
  const u = (t - inp[k]) / (inp[k + 1] - inp[k]);
  if (s.interpolation === 'STEP') return out[k];
  return p === 'rotation' ? slerpArr(out[k], out[k + 1], u) : out[k].map((x, i) => x + (out[k + 1][i] - x) * u);
}
/** Model-space pose (file units) of a warden joint for `clip` at clip time `t` (no blending); `offsets` = tracks.joints
 * values at that time (Euler YXZ, applied as local = clip * offset, as the player does). */
export function wardenJoint(clip: string, t: number, joint: string, offsets: Record<string, Vec3> = {}): Pose {
  const anim = glb.gl.animations.find((a: { name: string }) => a.name === clip);
  if (!anim) throw new Error(`warden FK: no clip ${clip}`);
  const loc = glb.nodes.map((n) => ({ t: (n.translation ?? [0, 0, 0]) as number[], r: (n.rotation ?? [0, 0, 0, 1]) as number[], s: (n.scale ?? [1, 1, 1]) as number[] }));
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler];
    const p = ch.target.path as 'translation' | 'rotation' | 'scale';
    const v = sampleChannel(s, p, t);
    if (p === 'translation') loc[ch.target.node].t = v;
    else if (p === 'rotation') loc[ch.target.node].r = v;
    else loc[ch.target.node].s = v;
  }
  for (const [name, e] of Object.entries(offsets)) {
    const i = glb.idx.get(name);
    if (i === undefined) throw new Error(`warden FK: no joint ${name}`);
    loc[i].r = qmul(loc[i].r as Quat, eulerYXZToQuat(e));
  }
  const W = new Map<number, { p: Vec3; q: Quat; s: Vec3 }>();
  const get = (i: number): { p: Vec3; q: Quat; s: Vec3 } => {
    const hit = W.get(i);
    if (hit) return hit;
    const l = loc[i];
    let r: { p: Vec3; q: Quat; s: Vec3 };
    if (glb.parent[i] < 0) r = { p: l.t as Vec3, q: l.r as Quat, s: l.s as Vec3 };
    else {
      const P0 = get(glb.parent[i]);
      const sp: Vec3 = [l.t[0] * P0.s[0], l.t[1] * P0.s[1], l.t[2] * P0.s[2]];
      r = { p: add(qrot(P0.q, sp), P0.p), q: qmul(P0.q, l.r as Quat), s: [P0.s[0] * l.s[0], P0.s[1] * l.s[1], P0.s[2] * l.s[2]] };
    }
    W.set(i, r);
    return r;
  };
  const i = glb.idx.get(joint);
  if (i === undefined) throw new Error(`warden FK: no joint ${joint}`);
  const w = get(i);
  return { p: w.p, q: w.q };
}
// ---- whole-timeline FK: clip segments with cross-fade (as the player: segment i active on [start_i, start_i+1), blending
// in from segment i-1 over blendIn; every segment's clip time counts from its own start) ----
export type Seg = { clip: string; start?: number; speed?: number; loop?: 'repeat' | 'once' | 'pingpong'; blendIn?: number };
const clipDur = (clip: string): number => {
  const anim = glb.gl.animations.find((a: { name: string }) => a.name === clip);
  if (!anim) throw new Error(`warden FK: no clip ${clip}`);
  return Math.max(...anim.samplers.map((sm: { input: number }) => glb.gl.accessors[sm.input].max?.[0] ?? 0));
};
const segTime = (sg: Seg, t: number): number => {
  const c = Math.max(0, t - (sg.start ?? 0)) * (sg.speed ?? 1);
  const d = clipDur(sg.clip);
  if (d <= 0) return 0;
  const loop = sg.loop ?? 'repeat';
  if (loop === 'once') return Math.min(c, d);
  if (loop === 'pingpong') { const m = c % (2 * d); return m <= d ? m : 2 * d - m; }
  return c % d;
};
function localsAt(clip: string, t: number) {
  const anim = glb.gl.animations.find((a: { name: string }) => a.name === clip);
  const loc = glb.nodes.map((n) => ({ t: (n.translation ?? [0, 0, 0]) as number[], r: (n.rotation ?? [0, 0, 0, 1]) as number[], s: (n.scale ?? [1, 1, 1]) as number[] }));
  for (const ch of anim.channels) {
    const sm = anim.samplers[ch.sampler];
    const pth = ch.target.path as 'translation' | 'rotation' | 'scale';
    const v = sampleChannel(sm, pth, t);
    if (pth === 'translation') loc[ch.target.node].t = v;
    else if (pth === 'rotation') loc[ch.target.node].r = v;
    else loc[ch.target.node].s = v;
  }
  return loc;
}
function fkLocals(loc: { t: number[]; r: number[]; s: number[] }[], joint: string): Pose {
  const W = new Map<number, { p: Vec3; q: Quat; s: Vec3 }>();
  const get = (i: number): { p: Vec3; q: Quat; s: Vec3 } => {
    const hit = W.get(i);
    if (hit) return hit;
    const l = loc[i];
    let r: { p: Vec3; q: Quat; s: Vec3 };
    if (glb.parent[i] < 0) r = { p: l.t as Vec3, q: l.r as Quat, s: l.s as Vec3 };
    else {
      const P0 = get(glb.parent[i]);
      const sp: Vec3 = [l.t[0] * P0.s[0], l.t[1] * P0.s[1], l.t[2] * P0.s[2]];
      r = { p: add(qrot(P0.q, sp), P0.p), q: qmul(P0.q, l.r as Quat), s: [P0.s[0] * l.s[0], P0.s[1] * l.s[1], P0.s[2] * l.s[2]] };
    }
    W.set(i, r);
    return r;
  };
  const i = glb.idx.get(joint);
  if (i === undefined) throw new Error(`warden FK: no joint ${joint}`);
  const w = get(i);
  return { p: w.p, q: w.q };
}
/** Model-space pose (file units) of a warden joint at GLOBAL time t for an animation segment list (+ joint offsets). */
export function wardenJointAt(segs: Seg[], t: number, joint: string, offsets: Record<string, Vec3> = {}): Pose {
  let i = 0;
  for (let k = 1; k < segs.length; k++) if (t >= (segs[k].start ?? 0)) i = k;
  let loc = localsAt(segs[i].clip, segTime(segs[i], t));
  const b = segs[i].blendIn ?? 0;
  const s0 = segs[i].start ?? 0;
  if (i > 0 && b > 0 && t < s0 + b) {
    const w = (t - s0) / b;
    const prev = localsAt(segs[i - 1].clip, segTime(segs[i - 1], t));
    loc = loc.map((l, n) => ({
      t: prev[n].t.map((x, c) => x + (l.t[c] - x) * w),
      r: qslerp(prev[n].r as Quat, l.r as Quat, w),
      s: prev[n].s.map((x, c) => x + (l.s[c] - x) * w),
    }));
  }
  for (const [name, e] of Object.entries(offsets)) {
    const n = glb.idx.get(name);
    if (n === undefined) throw new Error(`warden FK: no joint ${name}`);
    loc[n] = { ...loc[n], r: qmul(loc[n].r as Quat, eulerYXZToQuat(e)) };
  }
  return fkLocals(loc, joint);
}
/** Approximate ground-lock lift (m) at t: lowest toe / heel joint brought to its rest height above the sole. */
export function wardenLockDy(segs: Seg[], t: number, offsets: Record<string, Vec3> = {}): number {
  const toes = Math.min(...['toes.l', 'toes.r'].map((j) => wardenJointAt(segs, t, j, offsets).p[1] - 0.026));
  return -toes * WK;
}
/** World pose of a warden joint at global t (node position / yaw at t). */
export function wardenWorldAt(pos: Vec3, yaw: number, segs: Seg[], t: number, joint = 'handslot.r', offsets: Record<string, Vec3> = {}, dy = 0): Pose {
  const j = wardenJoint2(segs, t, joint, offsets);
  const qy = qYaw(yaw);
  return { p: add(add(pos, qrot(qy, scale(sub(j.p, W_CENTER), WK))), [0, dy, 0]), q: qmul(qy, j.q) };
}
const wardenJoint2 = wardenJointAt;
/** World pose (meters) of a warden joint: node origin `pos` (the authored node position), yaw, clip, clip time. */
export function wardenJointWorld(pos: Vec3, yaw: number, clip: string, clipT: number, joint = 'handslot.r', dy = 0, offsets: Record<string, Vec3> = {}): Pose {
  const j = wardenJoint(clip, clipT, joint, offsets);
  const qy = qYaw(yaw);
  return { p: add(add(pos, qrot(qy, scale(sub(j.p, W_CENTER), WK))), [0, dy, 0]), q: qmul(qy, j.q) };
}
/** Axe mesh vertices (file units, every vertex of axe_2handed.gltf). */
const AXE_VERTS: Vec3[] = (() => {
  const file = path.join(HERE, SRC.axe);
  const g = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bin = fs.readFileSync(path.join(path.dirname(file), g.buffers[0].uri));
  const out: Vec3[] = [];
  for (const m of g.meshes) for (const pr of m.primitives) {
    const a = g.accessors[pr.attributes.POSITION];
    const bv = g.bufferViews[a.bufferView];
    const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
    const st = bv.byteStride || 12;
    for (let i = 0; i < a.count; i++) out.push([bin.readFloatLE(off + i * st), bin.readFloatLE(off + i * st + 4), bin.readFloatLE(off + i * st + 8)]);
  }
  return out;
})();
/** World points of the axe mesh for a slot pose (file origin on the slot, scaled by AXE_S). */
export const axeWorldVerts = (slot: Pose): Vec3[] => AXE_VERTS.map((v) => add(slot.p, qrot(slot.q, scale(v, AXE_S))));
/** World pose of the axe NODE (bounds centre) for a slot pose. */
export const axePose = (slot: Pose): Pose => compose(slot, { p: AXE_OFF, q: [0, 0, 0, 1] });

// ---------------------------------------------------------------- set
const box = (id: string, position: Vec3, size: Vec3, look: PrevisNode['look'], color: Rgb = [0.2, 0.2, 0.22], role?: string): PrevisNode => ({
  id, shape: 'box', color, ...(role ? { role } : {}), look, position, rotation: [0, 0, 0], size,
});
const pillarModel = (id: string, position: Vec3, parent?: string): PrevisNode => ({
  id,
  shape: 'model',
  color: PILLAR_FLAT,
  ...(parent ? { parent } : {}),
  model: { src: SRC.pillar, fit: 'stretch' },
  position,
  rotation: [0, 0, 0],
  size: PILLAR_SIZE,
});
/** Fall direction of the smashed pillar (unit, horizontal) and its pivot yaw (local +x -> e). */
export function smashFrame(e: Vec3) {
  const yaw = Math.atan2(-e[2], e[0]);
  const pivot: Vec3 = add(P, scale(e, PILLAR_SIZE[0] / 2));
  return { yaw, pivot };
}
/**
 * The vault. `smashDir` = the horizontal unit direction the hiding pillar P will fall (S07); its pillar hangs from an
 * invisible pivot on its base edge on that side (`pillar_smash_pivot`, rotate rz 0 -> -pi/2 to topple it).
 */
export function vaultSet(smashDir: Vec3): PrevisNode[] {
  const W = FLOOR.x1 - FLOOR.x0;
  const D = FLOOR.z1 - FLOOR.z0;
  const cx = (FLOOR.x0 + FLOOR.x1) / 2;
  const wallLook = { color: [0.27, 0.27, 0.29] as Rgb, roughness: 0.92 };
  const nodes: PrevisNode[] = [
    box('floor', [cx, -0.25, 0], [W, 0.5, D], LOOK.floor),
    box('wall_back', [cx, 4.5, FLOOR.z0 - 0.3], [W, 9, 0.6], wallLook, [0.27, 0.26, 0.28]),
    box('wall_front', [cx, 4.5, FLOOR.z1 + 0.3], [W, 9, 0.6], wallLook, [0.27, 0.26, 0.28]),
    box('wall_end', [FLOOR.x1 + 0.3, 4.5, 0], [0.6, 9, D], wallLook, [0.27, 0.26, 0.28]),
    // west wall with the open doorway Haon comes through (z -1.6 .. 1.6, 4 m high)
    box('wall_west_s', [FLOOR.x0 - 0.3, 4.5, (FLOOR.z0 - 1.6) / 2], [0.6, 9, -FLOOR.z0 - 1.6], wallLook, [0.27, 0.26, 0.28]),
    box('wall_west_n', [FLOOR.x0 - 0.3, 4.5, (FLOOR.z1 + 1.6) / 2], [0.6, 9, FLOOR.z1 - 1.6], wallLook, [0.27, 0.26, 0.28]),
    box('wall_west_lintel', [FLOOR.x0 - 0.3, 6.5, 0], [0.6, 5, 3.2], wallLook, [0.27, 0.26, 0.28]),
    // the altar far east (a glimpse; S08 is the altar scene): step, block, two cold braziers
    box('altar_step', [ALTAR[0], 0.15, 0], [4, 0.3, 5.2], LOOK.darkStone),
    box('altar', [ALTAR[0], 0.85, 0], [1.6, 1.1, 2.6], { color: [0.42, 0.38, 0.34], roughness: 0.85 }, C.altar, 'altar'),
    { id: 'brazier_n', shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.bronze, position: [ALTAR[0] - 1.2, 0.85, 2.2], rotation: [0, 0, 0], size: [0.7, 1.1, 0.7] },
    { id: 'brazier_s', shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.bronze, position: [ALTAR[0] - 1.2, 0.85, -2.2], rotation: [0, 0, 0], size: [0.7, 1.1, 0.7] },
  ];
  for (const x of PILLAR_XS) {
    for (const z of [-ROW_Z, ROW_Z]) {
      if (x === P[0] && z === P[2]) continue;
      nodes.push(pillarModel(`pillar_${x < 0 ? 'm' + -x : x}_${z < 0 ? 's' : 'n'}`, [x, PILLAR_SIZE[1] / 2, z]));
    }
  }
  const f = smashFrame(smashDir);
  nodes.push({ id: 'pillar_smash_pivot', shape: 'box', color: [0.27, 0.26, 0.28], visible: false, position: f.pivot, rotation: [0, f.yaw, 0], size: [0.1, 0.1, 0.1] });
  nodes.push(pillarModel('pillar_smash', [-PILLAR_SIZE[0] / 2, PILLAR_SIZE[1] / 2, 0], 'pillar_smash_pivot'));
  return nodes;
}

/** Lighting: high cold key, cold rims down the vault, amber-red accents where the warden fights, warm altar far east. */
export function vaultLighting(exposure: number, extra: NonNullable<NonNullable<PrevisDoc['lighting']>['rim']> = []): NonNullable<PrevisDoc['lighting']> {
  const RED: Rgb = [1.0, 0.38, 0.16];
  const l = LIGHT.vault([
    { position: [-16, 4.5, 2.5], color: LIGHT.COLD, intensity: 18, range: 13 },
    { position: [-6, 7, -4], color: LIGHT.COLD, intensity: 30, range: 16 },
    { position: [7, 7, 3], color: LIGHT.COLD, intensity: 24, range: 15 },
    { position: [-2.0, 3.2, -3.2], color: RED, intensity: 12, range: 9 },
    { position: [-7.0, 3.4, -2.6], color: RED, intensity: 9, range: 8 },
    { position: [ALTAR[0] - 1.5, 2.2, 0], color: LIGHT.WARM, intensity: 16, range: 10 },
    ...extra,
  ]);
  l.exposure = exposure;
  return l;
}

// ---------------------------------------------------------------- Haon props
export const GRIP = -1.0; // sword box angle in the hand (gate-raid)
export const BLADE = 0.9;
export const SWORD_SIZE: Vec3 = [0.05, BLADE, 0.02];
const half = BLADE / 2 + 0.04;
/** Flat sword box pose in the hand pivot frame (grip end on the pivot, blade forward-down when the arm hangs). */
export const SWORD_IN_HAND: Pose = { p: [0, -half * Math.cos(GRIP), -half * Math.sin(GRIP)], q: eulerYXZToQuat([GRIP, 0, 0]) };
// textured sword (sword_1handed.gltf, grip at the file origin, blade along +y) placed rigidly in the box frame
const S_MIN: Vec3 = [-0.251719, -0.365766, -0.065317];
const S_MAX: Vec3 = [0.251726, 1.409496, 0.065317];
const SWORD_S = 0.53;
export const SWORD_TEX_SIZE = scale(sub(S_MAX, S_MIN), SWORD_S).map((v) => +v.toFixed(4)) as Vec3;
const SWORD_HANDLE = -0.15;
const PALM: Vec3 = [0, -0.07, 0];
const SWORD_OFF: Pose = {
  p: add([0.012, half - ((S_MIN[1] + S_MAX[1]) / 2 - SWORD_HANDLE) * SWORD_S, 0], qrot(qconj(eulerYXZToQuat([GRIP, 0, 0])), PALM)),
  q: [Math.SQRT1_2, 0, Math.SQRT1_2, 0],
};
export const SWORD_TEX_IN_HAND: Pose = compose(SWORD_IN_HAND, SWORD_OFF);
/** Box pose -> textured sword pose (both world or both in one frame). */
export const swordTexFromBox = (b: Pose): Pose => compose(b, SWORD_OFF);
export const EMBER_OFF: Vec3 = [0, -0.09, 0.03];

/** Ember (left hand) + sword box (flat) + sword model (textured), all riding Haon's hands from t = 0. */
export function haonProps(handL: string, handR: string): { ember: PrevisNode; sword: PrevisNode; swordTex: PrevisNode } {
  const ember: PrevisNode = {
    id: 'ember', shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.ember, parent: handL, position: EMBER_OFF, rotation: [0, 0, 0],
    size: [EMBER_D, EMBER_D, EMBER_D], tracks: { parent: [{ t: 0, v: { node: handL } }] },
  };
  const sword: PrevisNode = {
    id: 'sword', shape: 'box', role: 'sword', color: C.sword, look: { show: 'flat' }, parent: handR,
    position: r6v(SWORD_IN_HAND.p), rotation: r6v(quatToEulerYXZ(SWORD_IN_HAND.q)), size: SWORD_SIZE,
  };
  const swordTex: PrevisNode = {
    id: 'sword_tex', shape: 'model', role: 'sword', color: C.sword, look: { show: 'textured' }, parent: handR,
    model: { src: SRC.sword, fit: 'contain' },
    position: r6v(SWORD_TEX_IN_HAND.p), rotation: r6v(quatToEulerYXZ(SWORD_TEX_IN_HAND.q)), size: SWORD_TEX_SIZE,
    tracks: { parent: [{ t: 0, v: { node: handR } }] },
  };
  return { ember, sword, swordTex };
}

// ---------------------------------------------------------------- Haon motion helpers
export type Joints = { root: string; spine: string; head: string; shoulderL?: string; shoulderR?: string; elbowL?: string; elbowR?: string; hipL?: string; hipR?: string; kneeL?: string; kneeR?: string };
/** walk() without its root yaw (authored separately) and without the left shoulder (the ember carry arm). */
export function stripWalk(frag: MotionFragments, j: Joints): MotionFragments {
  delete frag[j.root].rotation;
  if (j.shoulderL) delete frag[j.shoulderL];
  return frag;
}
export const CARRY_SH: Vec3 = [-0.25, -0.45, 0];
export const CARRY_EL: Vec3 = [-1.35, 0, 0];
/** Ember carry pose: left arm forward-bent, held for the whole doc (tracks: the retarget reads static fields as rest). */
export function carryLeft(j: Joints, dur: number, extra: { t: number; sh: Vec3; el: Vec3 }[] = []): MotionFragments {
  const sh: Track<Vec3> = [{ t: 0, v: CARRY_SH }];
  const el: Track<Vec3> = [{ t: 0, v: CARRY_EL }];
  for (const k of extra) {
    sh.push({ t: k.t, v: k.sh, ease: 'ease-in-out' });
    el.push({ t: k.t, v: k.el, ease: 'ease-in-out' });
  }
  sh.push({ t: dur, v: sh[sh.length - 1].v });
  el.push({ t: dur, v: el[el.length - 1].v });
  return { [j.shoulderL!]: { rotation: sh }, [j.elbowL!]: { rotation: el } };
}
/** Breathing: spine position bob (heavy, ~0.6 Hz) on [a, b]. */
export function breathe(j: Joints, a: number, b: number, amp = 0.012, period = 1.5): MotionFragments {
  const tr: Track<Vec3> = [];
  let i = 0;
  for (let t = a; t < b - 1e-6; t += period / 2, i++) tr.push({ t: +t.toFixed(4), v: [0, i % 2 ? amp : 0, 0], ease: 'ease-in-out' });
  tr.push({ t: b, v: [0, 0, 0] });
  return { [j.spine]: { position: tr } };
}

// ---------------------------------------------------------------- S06 chop placement and the S06 -> S07 hand-off
export const YAW_APPROACH = -Math.PI / 2; // the warden walks west at Haon
/** Chest lean-back (tracks.joints `chest`, additive) through the chop's bite, so the axe head stops ON the floor. */
export const CHEST_BACK = -0.125;
export const IMPACT_CLIP = 0.88; // 2H_Melee_Attack_Chop: the axe head reaches the floor
const off0 = sub(
  compose(wardenJointWorld([0, WY, 0], YAW_APPROACH, '2H_Melee_Attack_Chop', IMPACT_CLIP, 'handslot.r', 0, { chest: [CHEST_BACK * 0.8, 0, 0] }), { p: AXE_HEAD, q: [0, 0, 0, 1] }).p,
  [0, WY, 0],
);
/** Warden node position when the S06 chop lands its axe head on C_SPOT. */
export const WC: Vec3 = [C_SPOT[0] - off0[0], WY, C_SPOT[2] - off0[2]];
/** Unit direction warden -> hiding pillar; the warden ends S06 at W1 facing it, Haon hides at H_SPOT behind it. */
export const U: Vec3 = unit2(sub(P, WC));
export const YAW_PILLAR = Math.atan2(U[0], U[2]);
export const W1: Vec3 = [P[0] - 2.9 * U[0], WY, P[2] - 2.9 * U[2]];
export const H_SPOT: Vec3 = [P[0] + 1.3 * U[0], 0, P[2] + 1.3 * U[2]];
/** The warden's right at W1: the S07 diagonal blow knocks the pillar over this way. */
export const E_FALL: Vec3 = [-Math.cos(YAW_PILLAR), 0, Math.sin(YAW_PILLAR)];
/** Haon's S06 end yaw: back to the pillar (faces away from the warden). */
export const YAW_HIDE = YAW_PILLAR;
