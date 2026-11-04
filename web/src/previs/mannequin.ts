/**
 * Previs mannequin builder, motion generators and small prop helpers. Pure data: every function
 * returns plain `PrevisNode[]` / `Track` data and never mutates its inputs.
 *
 * Conventions
 * - Minimal blocks (rule: subtraction). The default person is exactly 3 visible blocks: lower body,
 *   upper body, head. `limbs: 'arms'` adds 2 arm blocks, `'full'` adds 2 arms + 2 legs (the lower
 *   body block then becomes a small pelvis). `'jointed'` is `'full'` with every limb split in two
 *   segments (elbow and knee pivots, see `createMannequin`); only jointed mannequins can `crouch` /
 *   `pickUp`. `'none'`, `'arms'` and `'full'` are the RIGID modes.
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
 *   at their end (except raiseArm/lookAt/crouch, which hold the final value).
 * - crouch / pickUp (jointed only) solve the legs and the reaching arm with analytic two-bone IK
 *   (`twoBoneIK`) and emit one key per global frame (t = k / fps), so the planted feet and the hand
 *   are exact on every rendered frame of a doc with that fps.
 */

import type { Keyframe, PrevisNode, Rgb, Track, Vec3 } from './types';

export type Limbs = 'none' | 'arms' | 'full' | 'jointed';

export interface MannequinOptions {
  id: string;
  color: Rgb;
  role?: string;
  /** Total standing height in meters, default 1.75. */
  height?: number;
  /** World position of the root (ground point under the character), default [0, 0, 0]. */
  position?: Vec3;
  /** Default 'none'. `'jointed'` = full limbs with elbow and knee pivots (two segments per limb). */
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
  /** Jointed only. */
  elbowL?: string;
  elbowR?: string;
  kneeL?: string;
  kneeR?: string;
  /** Jointed only: ankle / ground point at the bottom of the shin (y = 0 at rest). */
  footL?: string;
  footR?: string;
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

/**
 * Where a jointed limb splits. Ratios of the anthropometric segment lengths of Drillis & Contini
 * (1966) as tabulated in D. A. Winter, "Biomechanics and Motor Control of Human Movement", Fig. 4.1
 * (fractions of body height: upper arm 0.186, forearm 0.146, thigh 0.245, leg 0.246). Only the ratios
 * are used; the total arm (0.32 h) and leg (0.48 h) lengths stay those of the rigid mannequin.
 */
const UPPER_ARM_FRACTION = 0.186 / (0.186 + 0.146);
const THIGH_FRACTION = 0.245 / (0.245 + 0.246);

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

/** The 16 pivots (plus root) of a `limbs: 'jointed'` mannequin, i.e. every `MannequinJoints` key. */
export type JointedJoints = Required<MannequinJoints>;

/**
 * Pivot ids of a `limbs: 'jointed'` mannequin built with `createMannequin({ id })`: `${id}.root`, `.hips`, `.spine`,
 * `.head`, `.shoulderX`, `.elbowX`, `.handX`, `.hipX`, `.kneeX`, `.footX` (X = L | R). Equals `createMannequin(...).joints`
 * of a jointed mannequin; used to find a mannequin in a doc by its id prefix (`PrevisModel.retarget.source`).
 */
export function jointedJointIds(id: string): JointedJoints {
  const j = (name: string) => `${id}.${name}`;
  return {
    root: j('root'),
    hips: j('hips'),
    spine: j('spine'),
    head: j('head'),
    handL: j('handL'),
    handR: j('handR'),
    shoulderL: j('shoulderL'),
    shoulderR: j('shoulderR'),
    hipL: j('hipL'),
    hipR: j('hipR'),
    elbowL: j('elbowL'),
    elbowR: j('elbowR'),
    kneeL: j('kneeL'),
    kneeR: j('kneeR'),
    footL: j('footL'),
    footR: j('footR'),
  };
}

/**
 * Build a mannequin. Node ids: `${id}.root`, `.hips`, `.spine`, `.head` (pivots), `.lower`, `.upper`,
 * `.head.mesh` (blocks); with arms `.shoulderL/R`, `.armL/R`, `.handL/R`; with full also `.hipL/R`,
 * `.legL/R`. Parents always precede their children in the returned array.
 *
 * `limbs: 'jointed'` key table (X = L or R; L is the character's left = +x). Pivot axes are the
 * pivot's local axes; at rest every limb hangs straight down (-y) and all rotations are 0.
 *
 * | id                | kind  | parent       | joint, local offset           | bend axis, positive bend      |
 * | ----------------- | ----- | ------------ | ----------------------------- | ----------------------------- |
 * | `.shoulderX`      | pivot | `.spine`     | shoulder (as `'full'`)        | rx < 0 swings the arm forward; ry yaws the elbow plane |
 * | `.upperArmX`      | block | `.shoulderX` | 0.32 h * 0.560 long           | -                             |
 * | `.elbowX`         | pivot | `.shoulderX` | elbow, [0, -upperArm, 0]      | rx; flexion = rx < 0 (forearm swings forward / up, elbow points back) |
 * | `.forearmX`       | block | `.elbowX`    | 0.32 h * 0.440 long           | -                             |
 * | `.handX`          | pivot | `.elbowX`    | wrist, [0, -forearm, 0]       | none (prop parent)            |
 * | `.hipX`           | pivot | `.hips`      | hip joint (as `'full'`)       | rx < 0 swings the thigh forward |
 * | `.thighX`         | block | `.hipX`      | 0.48 h * 0.499 long           | -                             |
 * | `.kneeX`          | pivot | `.hipX`      | knee, [0, -thigh, 0]          | rx; flexion = rx > 0 (shin swings back, knee points forward +z) |
 * | `.shinX`          | block | `.kneeX`     | 0.48 h * 0.501 long           | -                             |
 * | `.footX`          | pivot | `.kneeX`     | ankle / ground point, [0, -shin, 0] (world y = 0 at rest) | none |
 *
 * The `'full'` blocks `.armX` / `.legX` do not exist in `'jointed'`; root, hips, spine, head,
 * `.lower` (pelvis), `.upper` and `.head.mesh` are identical to `'full'`.
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

  const jointed = limbs === 'jointed';

  // The three reference blocks.
  if (limbs === 'full' || jointed) {
    // Small pelvis; the legs below carry the rest of the lower body.
    nodes.push(block(`${id}.lower`, color, role, hips, [0, -0.03 * h, 0], [0.19 * h, 0.12 * h, 0.12 * h]));
  } else {
    nodes.push(block(`${id}.lower`, color, role, hips, [0, -waistY / 2, 0], [0.18 * h, waistY, 0.12 * h]));
  }
  nodes.push(block(`${id}.upper`, color, role, spine, [0, upperH / 2, 0], [upperW, upperH, upperD]));
  nodes.push(block(`${head}.mesh`, color, role, head, [0, headH / 2, 0], [headW, headH, headD]));

  if (limbs === 'arms' || limbs === 'full' || jointed) {
    const armT = 0.045 * h;
    const armLen = 0.32 * h;
    const upperLen = armLen * UPPER_ARM_FRACTION;
    const foreLen = armLen - upperLen;
    const shoulderY = upperH - 0.03 * h;
    for (const side of ['L', 'R'] as const) {
      const sx = (side === 'L' ? 1 : -1) * (upperW / 2 + armT / 2);
      const sh = `${id}.shoulder${side}`;
      const hand = `${id}.hand${side}`;
      nodes.push(pivot(sh, color, [sx, shoulderY, 0], spine));
      if (jointed) {
        const elbow = `${id}.elbow${side}`;
        nodes.push(block(`${id}.upperArm${side}`, color, role, sh, [0, -upperLen / 2, 0], [armT, upperLen, armT]));
        nodes.push(pivot(elbow, color, [0, -upperLen, 0], sh));
        nodes.push(block(`${id}.forearm${side}`, color, role, elbow, [0, -foreLen / 2, 0], [armT, foreLen, armT]));
        nodes.push(pivot(hand, color, [0, -foreLen, 0], elbow));
        if (side === 'L') joints.elbowL = elbow;
        else joints.elbowR = elbow;
      } else {
        nodes.push(block(`${id}.arm${side}`, color, role, sh, [0, -armLen / 2, 0], [armT, armLen, armT]));
        nodes.push(pivot(hand, color, [0, -armLen, 0], sh));
      }
      if (side === 'L') {
        joints.shoulderL = sh;
        joints.handL = hand;
      } else {
        joints.shoulderR = sh;
        joints.handR = hand;
      }
    }
  }

  if (limbs === 'full' || jointed) {
    const hipDrop = -0.02 * h;
    const legLen = waistY + hipDrop; // hip joint down to the ground
    const thighLen = legLen * THIGH_FRACTION;
    const shinLen = legLen - thighLen;
    const legT = 0.075 * h;
    for (const side of ['L', 'R'] as const) {
      const hp = `${id}.hip${side}`;
      const x = (side === 'L' ? 1 : -1) * 0.05 * h;
      nodes.push(pivot(hp, color, [x, hipDrop, 0], hips));
      if (jointed) {
        const knee = `${id}.knee${side}`;
        const foot = `${id}.foot${side}`;
        nodes.push(block(`${id}.thigh${side}`, color, role, hp, [0, -thighLen / 2, 0], [legT, thighLen, legT]));
        nodes.push(pivot(knee, color, [0, -thighLen, 0], hp));
        nodes.push(block(`${id}.shin${side}`, color, role, knee, [0, -shinLen / 2, 0], [legT, shinLen, legT]));
        nodes.push(pivot(foot, color, [0, -shinLen, 0], knee));
        if (side === 'L') {
          joints.kneeL = knee;
          joints.footL = foot;
        } else {
          joints.kneeR = knee;
          joints.footR = foot;
        }
      } else {
        nodes.push(block(`${id}.leg${side}`, color, role, hp, [0, -legLen / 2, 0], [legT, legLen, legT]));
      }
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
// Two-bone IK: crouch, pickUp (jointed mannequins only)
// ---------------------------------------------------------------------------------------------

export interface TwoBoneSolution {
  /** Root joint rx (hip / shoulder), radians. */
  a: number;
  /** Middle joint rx relative to the root joint (knee / elbow), radians. */
  b: number;
  /** True when the target distance is within [|l1 - l2|, l1 + l2] (1e-9 tolerance). */
  reached: boolean;
  /** Unclamped root-to-target distance. */
  distance: number;
  /** Distance from the chain end to the target: 0 when reached, else the clamp amount. */
  miss: number;
}

const REACH_EPS = 1e-9;

/**
 * Analytic two-bone IK (law of cosines) in a joint's local y-z plane. The root joint sits at the
 * origin; both segments (lengths `l1` root->middle, `l2` middle->end) hang along -y at zero rotation,
 * and the chain end is `Rx(a)·[0,-l1,0] + Rx(a+b)·[0,-l2,0]` (Rx as in the engine, rx < 0 swings -y
 * toward +z). `bend = 1` puts the middle joint on the +z side (b >= 0: knee forward), `bend = -1` on the
 * -z side (b <= 0: elbow back, forearm forward). Out of reach the distance is clamped to
 * [|l1 - l2|, l1 + l2]: beyond `l1 + l2` the limb points straight at the target (b = 0), closer than
 * `|l1 - l2|` it folds completely along the target direction.
 */
export function twoBoneIK(l1: number, l2: number, ty: number, tz: number, bend: 1 | -1): TwoBoneSolution {
  if (!(l1 > 0 && l2 > 0)) throw new RangeError('twoBoneIK: segment lengths must be > 0');
  const distance = Math.hypot(ty, tz);
  const lo = Math.abs(l1 - l2);
  const hi = l1 + l2;
  const d = Math.min(hi, Math.max(lo, distance));
  const reached = distance <= hi + REACH_EPS && distance >= lo - REACH_EPS;
  // Direction of the target: (ty, tz) = distance * (-cos phi, -sin phi); phi = 0 is straight down.
  const phi = distance > 0 ? Math.atan2(-tz, -ty) : 0;
  const clamp1 = (x: number) => Math.min(1, Math.max(-1, x));
  // Interior angle at the middle joint; the bend is its supplement.
  const gamma = Math.acos(clamp1((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2)));
  // Angle at the root between the first segment and the root->target line.
  const alpha = d > 0 ? Math.acos(clamp1((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))) : 0;
  const flex = Math.PI - gamma;
  return {
    a: phi - bend * alpha,
    b: bend * flex,
    reached,
    distance,
    miss: reached ? 0 : Math.abs(distance - d),
  };
}

function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]];
}

function rotY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

interface LegRig {
  hip: string;
  knee: string;
  /** Hip joint offset in the hips frame. */
  offset: Vec3;
  thigh: number;
  shin: number;
  /** Planted foot (ankle) point in the root frame at rest. */
  foot: Vec3;
}

interface ArmRig {
  shoulder: string;
  elbow: string;
  hand: string;
  /** Shoulder offset in the spine frame. */
  offset: Vec3;
  upper: number;
  fore: number;
}

interface Rig {
  root: PrevisNode;
  hips: string;
  hipsRest: Vec3;
  spine: string;
  spineRest: Vec3;
  legs: LegRig[];
  arms: { left: ArmRig; right: ArmRig };
}

function rigOf(m: Mannequin, who: string): Rig {
  const j = m.joints;
  const byId = new Map(m.nodes.map((n) => [n.id, n]));
  const notJointed = () =>
    new Error(`${who}: needs jointed limbs (elbow and knee pivots); create the mannequin with limbs: 'jointed'`);
  const get = (id: string | undefined): PrevisNode => {
    const n = id === undefined ? undefined : byId.get(id);
    if (!n) throw notJointed();
    return n;
  };
  if (!j.kneeL || !j.kneeR || !j.elbowL || !j.elbowR || !j.footL || !j.footR) throw notJointed();
  const hips = get(j.hips);
  const spine = get(j.spine);
  const leg = (hipId?: string, kneeId?: string, footId?: string): LegRig => {
    const hip = get(hipId);
    const knee = get(kneeId);
    const foot = get(footId);
    const thigh = Math.hypot(...knee.position);
    const shin = Math.hypot(...foot.position);
    const offset: Vec3 = [...hip.position];
    return {
      hip: hip.id,
      knee: knee.id,
      offset,
      thigh,
      shin,
      foot: [
        hips.position[0] + offset[0],
        hips.position[1] + offset[1] - thigh - shin,
        hips.position[2] + offset[2],
      ],
    };
  };
  const arm = (shId?: string, elbowId?: string, handId?: string): ArmRig => {
    const sh = get(shId);
    const elbow = get(elbowId);
    const hand = get(handId);
    return {
      shoulder: sh.id,
      elbow: elbow.id,
      hand: hand.id,
      offset: [...sh.position],
      upper: Math.hypot(...elbow.position),
      fore: Math.hypot(...hand.position),
    };
  };
  return {
    root: get(j.root),
    hips: hips.id,
    hipsRest: [...hips.position],
    spine: spine.id,
    spineRest: [...spine.position],
    legs: [leg(j.hipL, j.kneeL, j.footL), leg(j.hipR, j.kneeR, j.footR)],
    arms: { left: arm(j.shoulderL, j.elbowL, j.handL), right: arm(j.shoulderR, j.elbowR, j.handR) },
  };
}

/**
 * Key times: `start`, every global frame time k / fps strictly inside (start, end), and `end`, so a
 * player sampling frame k at t = k / fps lands exactly on a solved key.
 */
function frameTimes(start: number, end: number, fps: number, who: string): number[] {
  if (!(fps > 0)) throw new RangeError(`${who}: fps must be > 0`);
  const ts = [start];
  const eps = 1e-9;
  for (let k = Math.ceil(start * fps); k / fps < end - eps; k++) {
    const t = k / fps;
    if (t > start + eps) ts.push(t);
  }
  ts.push(end);
  return ts;
}

/** The evaluator's 'ease-in-out' (smoothstep). */
function smooth(u: number): number {
  return u * u * (3 - 2 * u);
}

function checkDepth(rig: Rig, depth: number, who: string): void {
  for (const l of rig.legs) {
    const max = l.thigh + l.shin - Math.abs(l.thigh - l.shin);
    if (!(depth >= 0 && depth <= max)) {
      throw new RangeError(`${who}: depth must be in [0, ${max}] m (the folded leg length) to keep the feet planted`);
    }
  }
}

/** Hips position and both legs' hip / knee rx for a hip drop `drop` with the feet on their rest points. */
function legPose(rig: Rig, drop: number): { hips: Vec3; legs: { hip: Vec3; knee: Vec3 }[] } {
  const hips: Vec3 = [rig.hipsRest[0], rig.hipsRest[1] - drop, rig.hipsRest[2]];
  const legs = rig.legs.map((l) => {
    if (drop === 0) return { hip: [0, 0, 0] as Vec3, knee: [0, 0, 0] as Vec3 };
    const ty = l.foot[1] - (hips[1] + l.offset[1]);
    const tz = l.foot[2] - (hips[2] + l.offset[2]);
    const s = twoBoneIK(l.thigh, l.shin, ty, tz, 1);
    return { hip: [s.a, 0, 0] as Vec3, knee: [s.b, 0, 0] as Vec3 };
  });
  return { hips, legs };
}

function pushLegKeys(frag: MotionFragments, rig: Rig, t: number, drop: number): void {
  const p = legPose(rig, drop);
  (frag[rig.hips].position ??= []).push({ t, v: p.hips });
  rig.legs.forEach((l, i) => {
    (frag[l.hip].rotation ??= []).push({ t, v: p.legs[i].hip });
    (frag[l.knee].rotation ??= []).push({ t, v: p.legs[i].knee });
  });
}

export interface CrouchOptions {
  /** A mannequin built with `limbs: 'jointed'` (rigid ones throw). */
  mannequin: Mannequin;
  start: number;
  end: number;
  /** Hip drop at `end`, meters (0 = standing). */
  depth: number;
  /** Hip drop at `start`, default 0. Use `from: d, depth: 0` to stand back up. */
  from?: number;
  /**
   * Key rate: one solved key per global frame (t = k / fps) inside the span. Pass the doc fps so
   * every rendered frame lands on a key; between keys the joint angles interpolate linearly and the
   * feet can drift slightly.
   */
  fps: number;
}

/**
 * Lower the hips straight down by `depth` (ease-in-out over [start, end], then hold) while both feet
 * stay planted on their rest ground points: each leg is solved with `twoBoneIK` (knees bend forward,
 * toward the facing direction +z). Root-relative, so it works at any root position / yaw. Requires
 * `limbs: 'jointed'`. Writes: hips.position, hip*.rotation, knee*.rotation.
 */
export function crouch(o: CrouchOptions): MotionFragments {
  checkSpan(o.start, o.end, 'crouch');
  const rig = rigOf(o.mannequin, 'crouch');
  const from = o.from ?? 0;
  checkDepth(rig, o.depth, 'crouch');
  checkDepth(rig, from, 'crouch');
  const frag: MotionFragments = { [rig.hips]: {} };
  for (const l of rig.legs) {
    frag[l.hip] = {};
    frag[l.knee] = {};
  }
  for (const t of frameTimes(o.start, o.end, o.fps, 'crouch')) {
    const u = t === o.end ? 1 : smooth((t - o.start) / (o.end - o.start));
    pushLegKeys(frag, rig, t, from + (o.depth - from) * u);
  }
  return frag;
}

export interface PickUpOptions {
  /** A mannequin built with `limbs: 'jointed'` (rigid ones throw). */
  mannequin: Mannequin;
  side: 'left' | 'right';
  /** World point the hand pivot reaches at `grab` (put a prop's origin here). Should lie in front of the body. */
  target: Vec3;
  /** Rest at `start`, reach the target at `grab`, back at rest at `end` (ease-in-out both ways). */
  start: number;
  grab: number;
  end: number;
  /** Hip drop at `grab`, meters (feet stay planted, as `crouch`). */
  depth: number;
  /** Forward lean of the spine at `grab`, radians (spine rx > 0 tips the torso toward +z), default 0. */
  lean?: number;
  /** Key rate, as `crouch`. */
  fps: number;
  /** Root world position during the motion, default the root node's `position`. */
  rootPosition?: Vec3;
  /** Root yaw during the motion, default the root node's `rotation[1]` (its rx / rz must be 0). */
  rootYaw?: number;
}

export interface PickUpResult {
  motion: MotionFragments;
  /** Hand pivot id: parent a prop here (its world position equals `target` at `grab` when reachable). */
  hand: string;
  /** Hand-to-target distance at `grab`, meters: 0 when reachable, otherwise the arm is straight toward the target. */
  miss: number;
}

/**
 * Bend down and reach one hand to a world point: the hips lower by `depth` with the feet planted (as
 * `crouch`), the spine leans forward by `lean`, and the arm is solved with `twoBoneIK` in the vertical
 * plane through the shoulder and the hand goal (shoulder ry yaws that plane, shoulder rx + elbow rx
 * bend in it, elbow pointing back). The hand goal blends from the hanging rest hand to `target` with
 * the same ease, so the reach and the crouch arrive together at `grab`; everything returns to rest at
 * `end`. Requires `limbs: 'jointed'`. Writes: hips.position, spine.rotation, hip*.rotation,
 * knee*.rotation and the chosen side's shoulder.rotation and elbow.rotation.
 */
export function pickUp(o: PickUpOptions): PickUpResult {
  checkSpan(o.start, o.grab, 'pickUp (start..grab)');
  checkSpan(o.grab, o.end, 'pickUp (grab..end)');
  const rig = rigOf(o.mannequin, 'pickUp');
  checkDepth(rig, o.depth, 'pickUp');
  const arm = o.side === 'left' ? rig.arms.left : rig.arms.right;
  const lean = o.lean ?? 0;
  const rootPos = o.rootPosition ?? rig.root.position;
  const yaw = o.rootYaw ?? rig.root.rotation[1];
  // Target in the root frame (root rx / rz assumed 0).
  const q = rotY([o.target[0] - rootPos[0], o.target[1] - rootPos[1], o.target[2] - rootPos[2]], -yaw);

  const frag: MotionFragments = { [rig.hips]: {}, [rig.spine]: {}, [arm.shoulder]: {}, [arm.elbow]: {} };
  for (const l of rig.legs) {
    frag[l.hip] = {};
    frag[l.knee] = {};
  }
  let miss = 0;
  const key = (t: number, s: number) => {
    const drop = o.depth * s;
    pushLegKeys(frag, rig, t, drop);
    const lz = lean * s;
    (frag[rig.spine].rotation ??= []).push({ t, v: [lz, 0, 0] });
    if (s === 0) {
      (frag[arm.shoulder].rotation ??= []).push({ t, v: [0, 0, 0] });
      (frag[arm.elbow].rotation ??= []).push({ t, v: [0, 0, 0] });
      return;
    }
    // Target in the shoulder's parent (spine) frame, relative to the shoulder joint.
    const hips: Vec3 = [rig.hipsRest[0], rig.hipsRest[1] - drop, rig.hipsRest[2]];
    const inSpine = rotX(
      [q[0] - hips[0] - rig.spineRest[0], q[1] - hips[1] - rig.spineRest[1], q[2] - hips[2] - rig.spineRest[2]],
      -lz,
    );
    const full: Vec3 = [inSpine[0] - arm.offset[0], inSpine[1] - arm.offset[1], inSpine[2] - arm.offset[2]];
    const rest: Vec3 = [0, -(arm.upper + arm.fore), 0];
    const v: Vec3 = [rest[0] + (full[0] - rest[0]) * s, rest[1] + (full[1] - rest[1]) * s, rest[2] + (full[2] - rest[2]) * s];
    const h = Math.hypot(v[0], v[2]);
    const ry = h > 1e-12 ? Math.atan2(v[0], v[2]) : 0;
    const sol = twoBoneIK(arm.upper, arm.fore, v[1], h, -1);
    if (t === o.grab) miss = sol.miss;
    (frag[arm.shoulder].rotation ??= []).push({ t, v: [sol.a, ry, 0] });
    (frag[arm.elbow].rotation ??= []).push({ t, v: [sol.b, 0, 0] });
  };
  for (const t of frameTimes(o.start, o.grab, o.fps, 'pickUp')) {
    key(t, t === o.grab ? 1 : smooth((t - o.start) / (o.grab - o.start)));
  }
  for (const t of frameTimes(o.grab, o.end, o.fps, 'pickUp')) {
    if (t === o.grab) continue;
    key(t, t === o.end ? 0 : smooth(1 - (t - o.grab) / (o.end - o.grab)));
  }
  return { motion: frag, hand: arm.hand, miss };
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
