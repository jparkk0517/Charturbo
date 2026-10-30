/**
 * Previs mannequin builder, motion generators and small prop helpers. Pure data: every function
 * returns plain `PrevisNode[]` / `Track` data and never mutates its inputs.
 *
 * Conventions
 * - Minimal blocks (rule: subtraction). The default person is exactly 3 visible blocks: lower body,
 *   upper body, head. `limbs: 'arms'` adds 2 arm blocks, `'full'` adds 2 arms + 2 legs (the lower
 *   body block then becomes a small pelvis).
 * - Joint pivots are invisible, tiny nodes (`visible: false`). Rotating a pivot swings its children
 *   about the joint, because child transforms are local to the parent.
 * - FACING: +z is the character's forward at rotation 0 (yaw = ry; yaw = atan2(dx, dz) faces (dx, dz)).
 *   Consequently the character's LEFT side is +x and its RIGHT side is -x. Y is up, the ground is y = 0.
 * - Hierarchy: root (ground, world position) > hips (waist height) > spine (at hips origin) > head
 *   pivot; shoulders hang off the spine, hip joints off the hips. Hand pivots hang off the shoulders.
 * - Rotation signs (right-handed): negative rx swings a hanging limb FORWARD (+z); positive rz swings
 *   a hanging limb toward +x (outward for the left arm, inward for the right).
 * - Motions return `MotionFragments` (per node id, per property tracks); `applyMotion` merges them
 *   into nodes. Motions assume the target joints rest at the mannequin's rest pose and return to it
 *   at their end (except raiseArm/lookAt, which hold the final value).
 */

import type { Keyframe, PrevisNode, Rgb, Track, Vec3 } from './types';

export type Limbs = 'none' | 'arms' | 'full';

export interface MannequinOptions {
  id: string;
  color: Rgb;
  role?: string;
  /** Total standing height in meters, default 1.75. */
  height?: number;
  /** World position of the root (ground point under the character), default [0, 0, 0]. */
  position?: Vec3;
  /** Default 'none'. */
  limbs?: Limbs;
}

export interface MannequinJoints {
  root: string;
  hips: string;
  spine: string;
  head: string;
  handL?: string;
  handR?: string;
  shoulderL?: string;
  shoulderR?: string;
  hipL?: string;
  hipR?: string;
}

export interface Mannequin {
  nodes: PrevisNode[];
  joints: MannequinJoints;
}

export interface MotionTracks {
  position?: Track<Vec3>;
  rotation?: Track<Vec3>;
}

export type MotionFragments = Record<string, MotionTracks>;

const PIVOT_SIZE: Vec3 = [0.02, 0.02, 0.02];

function pivot(id: string, color: Rgb, position: Vec3, parent?: string): PrevisNode {
  const n: PrevisNode = {
    id,
    shape: 'box',
    color: [...color],
    position,
    rotation: [0, 0, 0],
    size: [...PIVOT_SIZE],
    visible: false,
  };
  if (parent !== undefined) n.parent = parent;
  return n;
}

function block(
  id: string,
  color: Rgb,
  role: string | undefined,
  parent: string,
  position: Vec3,
  size: Vec3,
): PrevisNode {
  const n: PrevisNode = {
    id,
    shape: 'box',
    parent,
    color: [...color],
    position,
    rotation: [0, 0, 0],
    size,
  };
  if (role !== undefined) n.role = role;
  return n;
}

/**
 * Build a mannequin. Node ids: `${id}.root`, `.hips`, `.spine`, `.head` (pivots), `.lower`, `.upper`,
 * `.head.mesh` (blocks); with arms `.shoulderL/R`, `.armL/R`, `.handL/R`; with full also `.hipL/R`,
 * `.legL/R`. Parents always precede their children in the returned array.
 */
export function createMannequin(opts: MannequinOptions): Mannequin {
  const { id, color, role } = opts;
  const h = opts.height ?? 1.75;
  const pos: Vec3 = opts.position ? [...opts.position] : [0, 0, 0];
  const limbs = opts.limbs ?? 'none';

  const waistY = 0.5 * h; // hips / waist height
  const upperH = 0.35 * h;
  const upperW = 0.24 * h;
  const upperD = 0.13 * h;
  const headH = 0.15 * h;
  const headW = 0.11 * h;
  const headD = 0.12 * h;

  const root = `${id}.root`;
  const hips = `${id}.hips`;
  const spine = `${id}.spine`;
  const head = `${id}.head`;
  const joints: MannequinJoints = { root, hips, spine, head };

  const nodes: PrevisNode[] = [
    pivot(root, color, pos),
    pivot(hips, color, [0, waistY, 0], root),
    pivot(spine, color, [0, 0, 0], hips),
    pivot(head, color, [0, upperH, 0], spine),
  ];

  // The three reference blocks.
  if (limbs === 'full') {
    // Small pelvis; the legs below carry the rest of the lower body.
    nodes.push(block(`${id}.lower`, color, role, hips, [0, -0.03 * h, 0], [0.19 * h, 0.12 * h, 0.12 * h]));
  } else {
    nodes.push(block(`${id}.lower`, color, role, hips, [0, -waistY / 2, 0], [0.18 * h, waistY, 0.12 * h]));
  }
  nodes.push(block(`${id}.upper`, color, role, spine, [0, upperH / 2, 0], [upperW, upperH, upperD]));
  nodes.push(block(`${head}.mesh`, color, role, head, [0, headH / 2, 0], [headW, headH, headD]));

  if (limbs === 'arms' || limbs === 'full') {
    const armT = 0.045 * h;
    const armLen = 0.32 * h;
    const shoulderY = upperH - 0.03 * h;
    for (const side of ['L', 'R'] as const) {
      const sx = (side === 'L' ? 1 : -1) * (upperW / 2 + armT / 2);
      const sh = `${id}.shoulder${side}`;
      const hand = `${id}.hand${side}`;
      nodes.push(pivot(sh, color, [sx, shoulderY, 0], spine));
      nodes.push(block(`${id}.arm${side}`, color, role, sh, [0, -armLen / 2, 0], [armT, armLen, armT]));
      nodes.push(pivot(hand, color, [0, -armLen, 0], sh));
      if (side === 'L') {
        joints.shoulderL = sh;
        joints.handL = hand;
      } else {
        joints.shoulderR = sh;
        joints.handR = hand;
      }
    }
  }

  if (limbs === 'full') {
    const hipDrop = -0.02 * h;
    const legLen = waistY + hipDrop; // hip joint down to the ground
    const legT = 0.075 * h;
    for (const side of ['L', 'R'] as const) {
      const hp = `${id}.hip${side}`;
      const x = (side === 'L' ? 1 : -1) * 0.05 * h;
      nodes.push(pivot(hp, color, [x, hipDrop, 0], hips));
      nodes.push(block(`${id}.leg${side}`, color, role, hp, [0, -legLen / 2, 0], [legT, legLen, legT]));
      if (side === 'L') joints.hipL = hp;
      else joints.hipR = hp;
    }
  }

  return { nodes, joints };
}

// ---------------------------------------------------------------------------------------------
// Motions
// ---------------------------------------------------------------------------------------------

function need(id: string | undefined, what: string): string {
  if (id === undefined) throw new Error(`mannequin has no ${what}; create it with limbs 'arms' or 'full'`);
  return id;
}

function checkSpan(start: number, end: number, name: string): void {
  if (!(end > start)) throw new RangeError(`${name}: end must be greater than start`);
}

export interface WalkOptions {
  joints: MannequinJoints;
  from: Vec3;
  to: Vec3;
  start: number;
  end: number;
  /** Footsteps per second (one step = one foot), default 1.8. */
  stepsPerSecond?: number;
}

/**
 * Root translates `from` -> `to` linearly and yaws once to face the travel direction (the yaw is
 * keyed at `start`, so turn earlier with `lookAt`-style tracks if a smooth turn is needed). The spine
 * bobs up and down per step; shoulders and hip joints swing in opposite phase when present.
 * Writes: root.position, root.rotation, spine.position, shoulder*.rotation, hip*.rotation.
 */
export function walk(o: WalkOptions): MotionFragments {
  const { joints: j, from, to, start, end } = o;
  checkSpan(start, end, 'walk');
  const d = end - start;
  const sps = o.stepsPerSecond ?? 1.8;
  const n = Math.max(2, Math.round(d * sps));
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const yaw = dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz);

  const frag: MotionFragments = {};
  frag[j.root] = {
    position: [
      { t: start, v: [...from] },
      { t: end, v: [...to] },
    ],
    rotation: [
      { t: start, v: [0, yaw, 0] },
      { t: end, v: [0, yaw, 0] },
    ],
  };

  // Bob: high at mid-step, rest at foot contact.
  const bob: Track<Vec3> = [];
  for (let i = 0; i <= 2 * n; i++) {
    bob.push({ t: start + (i * d) / (2 * n), v: [0, i % 2 === 1 ? 0.02 : 0, 0], ease: 'ease-in-out' });
  }
  frag[j.spine] = { position: bob };

  const swing = (amp: number, sign: number): Track<Vec3> => {
    const tr: Track<Vec3> = [];
    for (let i = 0; i <= n; i++) {
      const edge = i === 0 || i === n;
      const s = edge ? 0 : (i % 2 === 0 ? 1 : -1) * sign * amp;
      tr.push({ t: start + (i * d) / n, v: [s, 0, 0], ease: 'ease-in-out' });
    }
    return tr;
  };
  // Arm opposite to the same-side leg; negative rx = forward.
  if (j.hipL) frag[j.hipL] = { rotation: swing(0.6, 1) };
  if (j.hipR) frag[j.hipR] = { rotation: swing(0.6, -1) };
  if (j.shoulderL) frag[j.shoulderL] = { rotation: swing(0.5, -1) };
  if (j.shoulderR) frag[j.shoulderR] = { rotation: swing(0.5, 1) };
  return frag;
}

export interface JumpOptions {
  joints: MannequinJoints;
  start: number;
  /** Seconds off the ground. */
  airTime: number;
  /** Peak height in meters. */
  height: number;
  /** Root position at takeoff and landing, default [0, 0, 0]. */
  base?: Vec3;
}

/**
 * Vertical hop of the root: rises with ease-out, falls with ease-in. Arms (if present) swing up
 * during the air time and return. Writes: root.position, shoulder*.rotation.
 */
export function jump(o: JumpOptions): MotionFragments {
  const { joints: j, start, airTime, height } = o;
  if (!(airTime > 0)) throw new RangeError('jump: airTime must be > 0');
  const b: Vec3 = o.base ?? [0, 0, 0];
  const mid = start + airTime / 2;
  const end = start + airTime;
  const frag: MotionFragments = {
    [j.root]: {
      position: [
        { t: start, v: [...b], ease: 'ease-out' },
        { t: mid, v: [b[0], b[1] + height, b[2]], ease: 'ease-in' },
        { t: end, v: [...b] },
      ],
    },
  };
  const armUp: Track<Vec3> = [
    { t: start, v: [0, 0, 0], ease: 'ease-out' },
    { t: mid, v: [-2.4, 0, 0], ease: 'ease-in' },
    { t: end, v: [0, 0, 0] },
  ];
  if (j.shoulderL) frag[j.shoulderL] = { rotation: armUp.map(cloneKey) };
  if (j.shoulderR) frag[j.shoulderR] = { rotation: armUp.map(cloneKey) };
  return frag;
}

export interface RaiseArmOptions {
  joints: MannequinJoints;
  side: 'left' | 'right';
  start: number;
  end: number;
  /** Target forward-up angle in radians (0 hanging, PI/2 forward, PI overhead), default 2.6. */
  angle?: number;
  /** Starting angle, default 0. Use `from: <previous angle>, angle: 0` to lower the arm. */
  from?: number;
}

/** Swing one arm forward/up about the shoulder (rx = -angle) and hold. Requires arms. Writes shoulder rotation. */
export function raiseArm(o: RaiseArmOptions): MotionFragments {
  checkSpan(o.start, o.end, 'raiseArm');
  const sh = need(o.side === 'left' ? o.joints.shoulderL : o.joints.shoulderR, `${o.side} shoulder`);
  const angle = o.angle ?? 2.6;
  const from = o.from ?? 0;
  return {
    [sh]: {
      rotation: [
        { t: o.start, v: [-from, 0, 0], ease: 'ease-in-out' },
        { t: o.end, v: [-angle, 0, 0] },
      ],
    },
  };
}

export interface ShrugOptions {
  joints: MannequinJoints;
  start: number;
  duration: number;
}

/**
 * Shoulders-up shrug: spine lifts 3 cm, head tilts, arms (if present) open outward slightly, then
 * everything returns to rest. Writes: spine.position, head.rotation, shoulder*.rotation.
 */
export function shrug(o: ShrugOptions): MotionFragments {
  const { joints: j, start, duration } = o;
  if (!(duration > 0)) throw new RangeError('shrug: duration must be > 0');
  const t = [start, start + 0.25 * duration, start + 0.75 * duration, start + duration];
  const shape = (peak: Vec3, rest: Vec3): Track<Vec3> => [
    { t: t[0], v: [...rest], ease: 'ease-out' },
    { t: t[1], v: [...peak] },
    { t: t[2], v: [...peak], ease: 'ease-in-out' },
    { t: t[3], v: [...rest] },
  ];
  const zero: Vec3 = [0, 0, 0];
  const frag: MotionFragments = {
    [j.spine]: { position: shape([0, 0.03, 0], zero) },
    [j.head]: { rotation: shape([0, 0, 0.12], zero) },
  };
  if (j.shoulderL) frag[j.shoulderL] = { rotation: shape([0, 0, 0.35], zero) };
  if (j.shoulderR) frag[j.shoulderR] = { rotation: shape([0, 0, -0.35], zero) };
  return frag;
}

export interface LookAtOptions {
  joints: MannequinJoints;
  start: number;
  end: number;
  /** Head yaw relative to the body, radians (positive turns toward +x, the character's left). */
  yaw: number;
  /** Starting yaw, default 0. */
  from?: number;
}

/** Turn the head (not the body) about y and hold. Writes head.rotation. */
export function lookAt(o: LookAtOptions): MotionFragments {
  checkSpan(o.start, o.end, 'lookAt');
  return {
    [o.joints.head]: {
      rotation: [
        { t: o.start, v: [0, o.from ?? 0, 0], ease: 'ease-in-out' },
        { t: o.end, v: [0, o.yaw, 0] },
      ],
    },
  };
}

// ---------------------------------------------------------------------------------------------
// applyMotion
// ---------------------------------------------------------------------------------------------

function cloneKey<T extends Vec3>(k: Keyframe<T>): Keyframe<T> {
  const c: Keyframe<T> = { t: k.t, v: [...k.v] as T };
  if (k.ease !== undefined) c.ease = k.ease;
  return c;
}

function cloneNode(n: PrevisNode): PrevisNode {
  const c: PrevisNode = {
    ...n,
    color: [...n.color],
    position: [...n.position],
    rotation: [...n.rotation],
    size: [...n.size],
  };
  if (n.tracks) {
    c.tracks = {};
    if (n.tracks.position) c.tracks.position = n.tracks.position.map(cloneKey);
    if (n.tracks.rotation) c.tracks.rotation = n.tracks.rotation.map(cloneKey);
    if (n.tracks.size) c.tracks.size = n.tracks.size.map(cloneKey);
    if (n.tracks.visible) c.tracks.visible = n.tracks.visible.map((k) => ({ ...k }));
  }
  return c;
}

function mergeTrack(existing: Track<Vec3> | undefined, added: Track<Vec3>): Track<Vec3> {
  const all = [...(existing ?? []), ...added].map(cloneKey);
  // Stable sort by time. On equal t the LATER-added key wins, which keeps t strictly increasing.
  const indexed = all.map((k, i) => ({ k, i }));
  indexed.sort((a, b) => a.k.t - b.k.t || a.i - b.i);
  const out: Track<Vec3> = [];
  for (const { k } of indexed) {
    if (out.length > 0 && out[out.length - 1].t === k.t) out[out.length - 1] = k;
    else out.push(k);
  }
  return out;
}

/**
 * Merge motion fragments into copies of `nodes`. For each node+property the fragment keys are
 * CONCATENATED with any existing keys and sorted by `t`; a key with exactly the same `t` replaces the
 * earlier one. Overlap in time on the same node+property is NOT detected and interleaves the keys, so
 * sequence motions that write the same joint (e.g. two walks on the root) instead of overlapping them.
 * Throws if a fragment names an unknown node. Inputs are never mutated.
 */
export function applyMotion(
  nodes: PrevisNode[],
  fragments: MotionFragments | MotionFragments[],
): PrevisNode[] {
  const list = Array.isArray(fragments) ? fragments : [fragments];
  const out = nodes.map(cloneNode);
  const byId = new Map(out.map((n) => [n.id, n]));
  for (const frag of list) {
    for (const [nodeId, tr] of Object.entries(frag)) {
      const node = byId.get(nodeId);
      if (!node) throw new Error(`applyMotion: unknown node "${nodeId}"`);
      for (const prop of ['position', 'rotation'] as const) {
        const added = tr[prop];
        if (!added || added.length === 0) continue;
        node.tracks = node.tracks ?? {};
        node.tracks[prop] = mergeTrack(node.tracks[prop], added);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------------------------

export interface PropOptions {
  id: string;
  /** Real-world size in meters. */
  size: Vec3;
  color: Rgb;
  role?: string;
  /** Position local to the parent joint, default [0, 0, 0]. */
  offset?: Vec3;
}

/** Return `nodes` plus a box child of `parentJointId` (e.g. a hand pivot). Throws on unknown parent or duplicate id. */
export function attachProp(nodes: PrevisNode[], parentJointId: string, opts: PropOptions): PrevisNode[] {
  if (!nodes.some((n) => n.id === parentJointId)) {
    throw new Error(`attachProp: unknown parent "${parentJointId}"`);
  }
  if (nodes.some((n) => n.id === opts.id)) throw new Error(`attachProp: duplicate id "${opts.id}"`);
  const prop = block(opts.id, opts.color, opts.role, parentJointId, opts.offset ? [...opts.offset] : [0, 0, 0], [
    ...opts.size,
  ]);
  return [...nodes.map(cloneNode), prop];
}

export interface TwoToneBoxOptions {
  id: string;
  size: Vec3;
  front: Rgb;
  back: Rgb;
  /** Applied to both halves. */
  role?: string;
  position?: Vec3;
}

/**
 * Product-spin helper: an invisible pivot `id` with two half-depth boxes, `${id}.front` (+z half,
 * `front` color) and `${id}.back` (-z half, `back` color). Spin the pivot's ry to see which side
 * faces the camera.
 */
export function twoToneBox(opts: TwoToneBoxOptions): PrevisNode[] {
  const [w, h, d] = opts.size;
  const pv = pivot(opts.id, opts.front, opts.position ? [...opts.position] : [0, 0, 0]);
  return [
    pv,
    block(`${opts.id}.front`, opts.front, opts.role, opts.id, [0, 0, d / 4], [w, h, d / 2]),
    block(`${opts.id}.back`, opts.back, opts.role, opts.id, [0, 0, -d / 4], [w, h, d / 2]),
  ];
}
