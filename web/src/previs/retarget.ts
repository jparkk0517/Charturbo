/**
 * Pose retargeting from a previs jointed mannequin (`createMannequin({ limbs: 'jointed' })`) onto a skinned glTF
 * skeleton (e.g. the KayKit character rig), so a textured character follows the mannequin's procedural motion
 * (walk, crouch, pickUp, twoBoneIK). Pure math: no SDK, no DOM.
 *
 * Method (rest-direction alignment + rotation-delta transfer)
 * - Frames. Every rotation and position is expressed in the MANNEQUIN ROOT FRAME (y up, +z = facing, the
 *   character's left = +x) for the mannequin, and in the glTF MODEL FRAME for the rig. The two are assumed to
 *   coincide in orientation (KayKit: left arm at +x, faces +z). The root's world position / yaw and the uniform
 *   model scale are the caller's (the model node sits on the mannequin root).
 * - Rest. W0_b = rest model-space rotation of rig node b (product of the rest local rotations, scale ignored),
 *   P0_b = rest model-space position (scales applied). R_j(rest) = rest root-frame rotation of mannequin joint j.
 * - Alignment. For each mapped bone b (mannequin joint j) A_b is the SHORTEST-ARC rotation that turns the rig's
 *   rest bone direction into the mannequin's rest bone direction:
 *     `child: c`        rig  P0[bone(c)] - P0[b]         -> mannequin pos(c) - pos(j)          (chain bones)
 *     `aim: 'continue'` rig  P0[tip] - P0[b]             -> mannequin pos(j) - pos(parent joint) (hands: the hand
 *                       continues the forearm line; tip = `rigTip` or the bone's first child in node order)
 *     `aim: 'inherit'`  A_b = A of the nearest mapped rig ancestor (identity if none). Default without `child`.
 *                       Used for head and feet: they keep the rig's rest angle to their parent segment (a foot keeps
 *                       pointing forward from the shin instead of being aimed down the mannequin's leg line).
 *   So the rig at the mannequin's rest pose has the mannequin's limb DIRECTIONS (a T-pose rig drops its arms).
 * - Transfer. At time t, Δ_j = R_j(t) · R_j(rest)^-1 and W_b = Δ_j · A_b · W0_b. Twist about the bone axis is part
 *   of Δ_j, so it is carried over. Unmapped nodes keep their rest LOCAL rotation: W_b = W_parent · r_b. The output
 *   local rotation of a mapped bone is W_parent^-1 · W_b (normalized, sign chosen on the rest local's hemisphere).
 * - Translation. Only the root-most mapped bone (hips) translates: `hipsTranslation` moves it by the mannequin hips
 *   displacement divided by the model scale k. Other mannequin pivot translations (the walk's 2 cm spine bob) are
 *   not transferred.
 *
 * IK AND PLANTED FEET (`solvePose`; UE IK Retargeter style: FK chain retarget, then IK goals)
 * - Limbs: every side whose 3 joints (shoulder, elbow, hand / hip, knee, foot) are mapped onto a direct parent chain of
 *   rig bones a -> b -> c. Lengths l1 = |P0_b - P0_a|, l2 = |P0_c - P0_b| (rest; rotations keep them).
 * - Goals in rig model space (hips bone at rest, scale k): g = P0_hips + (p_joint - p_hips) / k. Hand: the mannequin
 *   hand pivot is the wrist, and so is the origin of the rig's hand bone. Foot: the mannequin foot pivot is the
 *   GROUND point under the ankle, the rig foot bone is the ankle, so the goal is lifted by the rig's rest ankle height
 *   P0_foot.y (the rig is assumed to stand on y = 0 at rest) along world up (root frame: q_root^-1 * +y). A model source's
 *   foot frames are ankles, not ground points: `sourceAnkleHeight` hs (meters) moves them down to the ground point first
 *   (goal lift P0_foot.y - hs / k, planted height - hs); 0 for a mannequin.
 * - Analytic two-bone IK (law of cosines) in the bend plane of the FK result: pole = the FK mid joint's offset from
 *   the a -> c line; when FK is straight (|pole| < 1e-4 (l1 + l2)), the rest pose's pole turned by the root bone's FK
 *   rotation change; when that is straight too, the limb's default (knees +z, elbows -z, root frame) turned likewise.
 *   Out of reach: clamped to full extension (or fully folded) toward the goal; `reached` false, `miss` reported.
 *   Bone a turns by the frame map {bone dir, plane normal} FK -> IK, bone b by the shortest arc in the IK plane.
 * - End bones keep their FK world rotation (hands). Feet: slerp(FK, level, w) with level = the rest foot rotation
 *   under the root's yaw only (sole flat in world), w = 1 - smoothstep(PLANT_LOW, PLANT_HIGH, world height of the
 *   mannequin foot pivot). Everything is a pure function of the inputs (deterministic).
 *
 * MODEL SOURCES (`modelSourceFrames`, `RETARGET_SOURCE_MAPS`)
 * - The "mannequin" frames can come from a posed glTF model instead: each canonical joint reads one source bone's world
 *   matrix (rotation = columns normalized, position = the matrix applied to an optional bone-local `tip`, for rigs
 *   without hand / ankle nodes such as walker.glb). Rest frames = the same of the rest matrices; everything above applies
 *   unchanged (Δ_j is then the source bone's rotation change, the alignment uses the source's rest bone directions).
 *
 * Limits
 * - Rotations ignore node scale (exact for unit / uniform scales, as in KayKit where |s - 1| < 1e-6).
 * - `solve` (FK only) does not adapt limb LENGTHS: angles transfer, so hands and feet land where the rig's own
 *   proportions put them, and feet rigidly follow the shin, hands the forearm (the mannequin's foot and hand pivots
 *   never rotate). `solvePose` adds the IK goals and the planted-foot leveling on top; a limb shorter than the
 *   mannequin's still misses goals out of its reach (`RetargetLimbResult.miss`).
 * - The torso is not re-fitted: the spine bone(s) take the mannequin spine's rotation change only.
 */

import type { PrevisNode, Vec3 } from './types';
import type { Quat } from './evaluate';
import { eulerYXZToQuat } from './evaluate.ts';
import type { MannequinJoints } from './mannequin';

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/** Rest local TRS of one glTF node (translation in file units, rotation quaternion [x, y, z, w], scale). */
export interface RetargetTrs {
  t: Vec3;
  r: Quat;
  s: Vec3;
}

/** A glTF skeleton: node names, parent index (-1 for a root) and rest local TRS, all indexed alike. */
export interface RetargetRig {
  names: string[];
  parents: number[];
  restLocal: RetargetTrs[];
}

/** One mannequin joint -> rig bone correspondence (see the header for `child` / `aim`). */
export interface RetargetJoint {
  /** Mannequin joint name: a `MannequinJoints` key (`hips`, `spine`, `head`, `shoulderL`, `elbowL`, `handL`, `hipL`, `kneeL`, `footL`, ...). */
  joint: string;
  /** Rig node name. */
  bone: string;
  /** Mapped mannequin joint the bone points at in rest (its chain child). */
  child?: string;
  /** Without `child`: `'inherit'` (default) or `'continue'`. */
  aim?: 'inherit' | 'continue';
  /** `'continue'` only: rig node the bone points at (default its first child in node order). */
  rigTip?: string;
}

/** A mannequin joint frame in the mannequin root frame: rotation and pivot position (meters). */
export interface MannequinJointFrame {
  rot: Quat;
  pos: Vec3;
}

export interface Retargeter {
  /** Rig node names (same order as the input rig and every output array). */
  readonly names: readonly string[];
  /** Rest model-space rotation (scale ignored) and position of every rig node. */
  readonly rest: { readonly rot: readonly Quat[]; readonly pos: readonly Vec3[] };
  /** Rest alignment A_b per rig node (identity for unmapped nodes). */
  readonly align: readonly Quat[];
  /** Index of the root-most mapped bone (the hips for the KayKit map). */
  readonly hipsIndex: number;
  /**
   * Uniform model scale k = mannequin leg length / rig leg length (chains hipX -> kneeX -> footX, i.e. hip joint
   * to ankle; averaged over the mapped sides). `undefined` when no full leg chain is mapped.
   */
  readonly legScale: number | undefined;
  /** Index of rig node `name`, -1 if absent. */
  indexOf(name: string): number;
  /** Mannequin length / rig length along a chain of mapped joints (e.g. `['shoulderL', 'elbowL', 'handL']`). */
  chainScale(joints: readonly string[]): number;
  /**
   * Local rotations of EVERY rig node for a mannequin pose (`rot(joint)`: root-frame rotation of a mapped joint at
   * time t). Unmapped nodes return their rest local rotation. Writes into `out` when given.
   */
  solve(rot: (joint: string) => Quat, out?: Quat[]): Quat[];
  /**
   * Local translation of the hips bone for the mannequin hips pivot at `pos` (root frame, meters) with the model
   * drawn at uniform scale `k`: rest translation + displacement / k (the hips' parent is assumed at rest).
   */
  hipsTranslation(pos: Vec3, k: number): Vec3;
  /** Model-space forward kinematics for local rotations (rest translations and scales unless `translation(i)` overrides). */
  fk(local: readonly Quat[], translation?: (i: number) => Vec3 | undefined): { rot: Quat[]; pos: Vec3[] };
  /**
   * Full pose (see IK AND PLANTED FEET): `solve` (FK) of the frames' rotations, then two-bone IK of every fully mapped
   * limb onto the mannequin hand / foot pivots and the planted-foot leveling. `frames(joint)`: root-frame frame of a
   * mapped joint at time t; `k`: model scale (meters per rig unit). Local rotations of EVERY rig node (as `solve`) and
   * per limb whether the goal was reached and by how much it was missed (meters).
   */
  solvePose(frames: (joint: string) => MannequinJointFrame, k: number, options?: RetargetPoseOptions): RetargetPose;
}

export interface RetargetPoseOptions {
  /** Two-bone IK of arms and legs (default true). */
  ik?: boolean;
  /** Planted-foot leveling (default true). */
  plant?: boolean;
  /** World transform of the mannequin root (meters); gives world up and the foot heights. Default identity. */
  root?: { q: Quat; p: Vec3 };
  /**
   * Height (meters, along world up) of the source foot frames above the ground point under them, when standing: 0
   * (default) for mannequin foot pivots, which ARE ground points; a model source's ankle rest height x its scale
   * (`modelSourceRest`). Foot goals and planted-foot heights are taken from that ground point.
   */
  sourceAnkleHeight?: number;
}

export interface RetargetLimbResult {
  /** Mannequin end joint of the limb (`handL`, `handR`, `footL`, `footR`). */
  joint: string;
  /** False when the goal was out of reach (the limb is clamped fully extended / folded toward it). */
  reached: boolean;
  /** Distance from the rig end bone to its goal after IK, meters (0 when reached). */
  miss: number;
  /** Planted-foot weight used (feet; 0 for hands). */
  plant: number;
}

export interface RetargetPose {
  local: Quat[];
  limbs: RetargetLimbResult[];
}

/**
 * Planted-foot band (meters, world height of the mannequin foot pivot, i.e. its ground point): at or below
 * PLANT_LOW the rig foot is level (weight 1), at or above PLANT_HIGH it follows the shin (FK, weight 0); smoothstep in
 * between. crouch / pickUp keep planted pivots at exactly 0; the jointed walk's straight-leg swing (+-0.6 rad) lifts
 * the pivot up to 0.15 m (h = 1.78), so the band ends well inside the swing.
 */
export const PLANT_LOW = 0.02;
export const PLANT_HIGH = 0.08;

// ---------------------------------------------------------------------------------------------
// Default map: jointed mannequin -> KayKit character rig (all KayKit characters share it)
// ---------------------------------------------------------------------------------------------

const side = (s: 'L' | 'R'): RetargetJoint[] => {
  const g = s.toLowerCase();
  return [
    { joint: `shoulder${s}`, bone: `upperarm.${g}`, child: `elbow${s}` },
    { joint: `elbow${s}`, bone: `lowerarm.${g}`, child: `hand${s}` },
    { joint: `hand${s}`, bone: `wrist.${g}`, aim: 'continue' },
    { joint: `hip${s}`, bone: `upperleg.${g}`, child: `knee${s}` },
    { joint: `knee${s}`, bone: `lowerleg.${g}`, child: `foot${s}` },
    { joint: `foot${s}`, bone: `foot.${g}`, aim: 'inherit' },
  ];
};

/**
 * Jointed mannequin -> KayKit rig. Torso bones aim at the head (the mannequin spine pivot sits on the hips pivot,
 * so hips -> spine has no length); the chest follows the spine as an unmapped child. The mannequin hand pivot is the
 * wrist, so `handX` drives `wrist.x`; hand / handslot, toes and the IK / control helper bones stay at rest local.
 */
export const KAYKIT_RETARGET_MAP: readonly RetargetJoint[] = Object.freeze([
  { joint: 'hips', bone: 'hips', child: 'head' },
  { joint: 'spine', bone: 'spine', child: 'head' },
  { joint: 'head', bone: 'head', aim: 'inherit' },
  ...side('L'),
  ...side('R'),
]);

const ueSide = (s: 'L' | 'R'): RetargetJoint[] => {
  const g = s.toLowerCase();
  return [
    { joint: `shoulder${s}`, bone: `upperarm_${g}`, child: `elbow${s}` },
    { joint: `elbow${s}`, bone: `lowerarm_${g}`, child: `hand${s}` },
    { joint: `hand${s}`, bone: `hand_${g}`, aim: 'continue', rigTip: `middle_01_${g}` },
    { joint: `hip${s}`, bone: `thigh_${g}`, child: `knee${s}` },
    { joint: `knee${s}`, bone: `calf_${g}`, child: `foot${s}` },
    { joint: `foot${s}`, bone: `foot_${g}`, aim: 'inherit' },
  ];
};

/**
 * Jointed mannequin -> UE-style skeleton (Unreal mannequin bone names, as in the Quaternius Universal Base
 * Characters): pelvis, spine_01..03, neck_01, Head, clavicle_x, upperarm_x, lowerarm_x, hand_x, fingers, thigh_x,
 * calf_x, foot_x, ball_x. One mannequin spine pivot drives ONE bone: `spine` -> spine_01; spine_02, spine_03, neck_01
 * and the clavicles are unmapped, so they keep their rest LOCAL rotation and follow spine_01 rigidly (no bend
 * distribution). pelvis and spine_01 aim at the head (as in the KayKit map), the hand continues the forearm line
 * through the middle finger root (`middle_01_x`), head and feet inherit. Fingers and ball_x stay at rest local.
 */
export const UE_RETARGET_MAP: readonly RetargetJoint[] = Object.freeze([
  { joint: 'hips', bone: 'pelvis', child: 'head' },
  { joint: 'spine', bone: 'spine_01', child: 'head' },
  { joint: 'head', bone: 'Head', aim: 'inherit' },
  ...ueSide('L'),
  ...ueSide('R'),
]);

/** Joint maps by `PrevisModel.retarget.map` name. */
export const RETARGET_MAPS: Readonly<Record<'ue' | 'kaykit', readonly RetargetJoint[]>> = Object.freeze({
  ue: UE_RETARGET_MAP,
  kaykit: KAYKIT_RETARGET_MAP,
});

// ---------------------------------------------------------------------------------------------
// Model sources: canonical joint frames read from a posed glTF model (see modelSourceFrames)
// ---------------------------------------------------------------------------------------------

/** One canonical (mannequin) joint read from a bone of a SOURCE model: `joint` <- the bone's frame at `tip`. */
export interface RetargetSourceJoint {
  /** Canonical joint name (a `MannequinJoints` key: `hips`, `spine`, `head`, `shoulderL`, ..., `footR`). */
  joint: string;
  /** Source rig node name. */
  bone: string;
  /** Point on the bone in its local frame (file units); default the bone origin. For rigs without a hand / ankle bone. */
  tip?: Vec3;
}

const walkerSide = (s: 'L' | 'R'): RetargetSourceJoint[] => {
  // The walker's ".R" limbs sit at +x and it faces +z, so they are the character's LEFT in the mannequin root frame
  // (left = +x); the map goes by geometry, not by the node names.
  const b = s === 'L' ? 'R' : 'L';
  return [
    { joint: `shoulder${s}`, bone: `upperArm.${b}` },
    { joint: `elbow${s}`, bone: `lowerArm.${b}` },
    // No hand bone: the hand pivot is the far end of the 0.28 forearm + hand segment
    { joint: `hand${s}`, bone: `lowerArm.${b}`, tip: [0, -0.28, 0] },
    { joint: `hip${s}`, bone: `upperLeg.${b}` },
    { joint: `knee${s}`, bone: `lowerLeg.${b}` },
    // No foot bone: the ankle is the lower end of the 0.44 shin (0.04 above the sole at rest)
    { joint: `foot${s}`, bone: `lowerLeg.${b}`, tip: [0, -0.44, 0] },
  ];
};

/**
 * Source map of `models/walker.glb` (previs/examples/models.gen.ts buildWalker: rigid node hierarchy, no skin, no hand
 * or foot nodes). `spine` reads `torso`; hands and feet are points at the ends of the forearm and shin nodes and turn
 * with them.
 */
export const WALKER_SOURCE_MAP: readonly RetargetSourceJoint[] = Object.freeze([
  { joint: 'hips', bone: 'hips' },
  { joint: 'spine', bone: 'torso' },
  { joint: 'head', bone: 'head' },
  ...walkerSide('L'),
  ...walkerSide('R'),
]);

/** Source maps by `PrevisRetarget.sourceMap` name: 'ue' / 'kaykit' read the bones of the target maps of the same name. */
export const RETARGET_SOURCE_MAPS: Readonly<Record<'walker' | 'ue' | 'kaykit', readonly RetargetSourceJoint[]>> = Object.freeze({
  walker: WALKER_SOURCE_MAP,
  ue: Object.freeze(UE_RETARGET_MAP.map((e) => ({ joint: e.joint, bone: e.bone }))),
  kaykit: Object.freeze(KAYKIT_RETARGET_MAP.map((e) => ({ joint: e.joint, bone: e.bone }))),
});

/**
 * Canonical joint frames of a POSED source model, in its model space (the space of `matrix`, e.g. the loader space of
 * `GltfAnimator.nodeMatrix`): rotation = the bone's world rotation (its 3x3 with the columns normalized: exact for a
 * rotation times a positive scale, i.e. glTF TRS chains without shear or mirroring), position = the bone matrix applied
 * to `tip`. Feet are the ANKLES (not ground points as the mannequin's foot pivots): pass their rest height to
 * `solvePose` as `sourceAnkleHeight` (see `modelSourceRest`). `matrix` may reuse one output buffer: each matrix is read
 * before the next call.
 */
export function modelSourceFrames(
  map: readonly RetargetSourceJoint[],
  matrix: (bone: string) => ArrayLike<number>,
): Record<string, MannequinJointFrame> {
  const out: Record<string, MannequinJointFrame> = {};
  for (const e of map) {
    const m = matrix(e.bone);
    if (!m || m.length < 16) throw new Error(`retarget: no matrix for source bone "${e.bone}"`);
    const tip = e.tip ?? [0, 0, 0];
    const cols: Vec3[] = [0, 1, 2].map((c) => [m[c * 4], m[c * 4 + 1], m[c * 4 + 2]] as Vec3);
    const n = cols.map(len);
    if (!n.every((v) => v > 1e-12 && Number.isFinite(v))) throw new RangeError(`retarget: source bone "${e.bone}" has a zero or non-finite scale`);
    const r: M3 = [
      cols[0][0] / n[0], cols[1][0] / n[1], cols[2][0] / n[2],
      cols[0][1] / n[0], cols[1][1] / n[1], cols[2][1] / n[2],
      cols[0][2] / n[0], cols[1][2] / n[1], cols[2][2] / n[2],
    ];
    const pos: Vec3 = [
      m[12] + m[0] * tip[0] + m[4] * tip[1] + m[8] * tip[2],
      m[13] + m[1] * tip[0] + m[5] * tip[1] + m[9] * tip[2],
      m[14] + m[2] * tip[0] + m[6] * tip[1] + m[10] * tip[2],
    ];
    out[e.joint] = { rot: quatFromM3(r), pos };
  }
  return out;
}

/**
 * Rest frames of a source model (`modelSourceFrames` of the REST matrices) and its ankle rest height: the mean model-space
 * y of the `footL` / `footR` points (the rig is assumed to stand on y = 0 at rest, as the target rig); 0 without feet.
 */
export function modelSourceRest(
  map: readonly RetargetSourceJoint[],
  matrix: (bone: string) => ArrayLike<number>,
): { frames: Record<string, MannequinJointFrame>; ankleHeight: number } {
  const frames = modelSourceFrames(map, matrix);
  const feet = ['footL', 'footR'].filter((j) => frames[j]);
  const ankleHeight = feet.length ? feet.reduce((a, j) => a + frames[j].pos[1], 0) / feet.length : 0;
  return { frames, ankleHeight };
}

/** Frames with every position mapped to s * pos + t (rotations unchanged): model space -> a scaled, shifted frame. */
export function scaleFrames(frames: Readonly<Record<string, MannequinJointFrame>>, s: number, t: Vec3 = [0, 0, 0]): Record<string, MannequinJointFrame> {
  const out: Record<string, MannequinJointFrame> = {};
  for (const [j, f] of Object.entries(frames)) out[j] = { rot: f.rot, pos: [s * f.pos[0] + t[0], s * f.pos[1] + t[1], s * f.pos[2] + t[2]] };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Small math (quaternions [x, y, z, w], row-major 3x3)
// ---------------------------------------------------------------------------------------------

const ID: Quat = [0, 0, 0, 1];

function qmul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

function qnorm(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(n > 0) || !Number.isFinite(n)) throw new RangeError('retarget: zero or non-finite quaternion');
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** v rotated by unit q. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Shortest-arc unit quaternion turning direction `from` into direction `to` (any lengths > 0). Antiparallel
 * directions turn by pi about a deterministic perpendicular axis (from x [1,0,0], or x [0,1,0] when from ~ x).
 */
export function shortestArc(from: Vec3, to: Vec3): Quat {
  const lu = len(from);
  const lv = len(to);
  if (!(lu > 0 && lv > 0)) throw new RangeError('retarget: shortestArc of a zero-length direction');
  const u: Vec3 = [from[0] / lu, from[1] / lu, from[2] / lu];
  const v: Vec3 = [to[0] / lv, to[1] / lv, to[2] / lv];
  const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  if (d < -1 + 1e-12) {
    const axis = cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
    const la = len(axis);
    return [axis[0] / la, axis[1] / la, axis[2] / la, 0];
  }
  const c = cross(u, v);
  return qnorm([c[0], c[1], c[2], 1 + d]);
}

type M3 = number[]; // row-major 3x3

function m3FromQuat(q: Quat): M3 {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function m3Mul(a: M3, b: M3): M3 {
  const o: M3 = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) o[3 * r + c] = a[3 * r] * b[c] + a[3 * r + 1] * b[3 + c] + a[3 * r + 2] * b[6 + c];
  }
  return o;
}

const m3Vec = (m: M3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

/** R(q) · diag(s): the linear part of a TRS. */
function m3Trs(q: Quat, s: Vec3): M3 {
  const m = m3FromQuat(q);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) m[3 * r + c] *= s[c];
  return m;
}

function m3Inv(m: M3): M3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!(Math.abs(det) > 1e-15)) throw new RangeError('retarget: singular node scale');
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

const M3_ID: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Unit quaternion of a row-major 3x3 rotation (Shepperd: the largest of w, x, y, z first). */
function quatFromM3(m: M3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  return qnorm(q);
}

/**
 * A `RetargetRig` from rest WORLD matrices (column-major 4x4, e.g. `GltfAnimator.nodeMatrix` of every node before any
 * pose) and parent indices: local = parentWorld^-1 · world; a root keeps its world matrix, so the rig's model space
 * is the space of the matrices (the loader space for `nodeMatrix`). Each local is decomposed as T · R · S with
 * positive scales (exact for glTF TRS chains without shear; a mirrored node, det < 0, gets a negative x scale).
 */
export function rigFromWorldMatrices(
  names: readonly string[],
  parents: readonly number[],
  world: (i: number) => ArrayLike<number>,
): RetargetRig {
  if (parents.length !== names.length) throw new RangeError('retarget: names and parents must have the same length');
  const lin = (w: ArrayLike<number>): M3 => [w[0], w[4], w[8], w[1], w[5], w[9], w[2], w[6], w[10]];
  const restLocal = names.map((_, i): RetargetTrs => {
    const w = world(i);
    const p = parents[i];
    let l = lin(w);
    let t: Vec3 = [w[12], w[13], w[14]];
    if (p >= 0) {
      const pw = world(p);
      const inv = m3Inv(lin(pw));
      l = m3Mul(inv, l);
      t = m3Vec(inv, [w[12] - pw[12], w[13] - pw[13], w[14] - pw[14]]);
    }
    const s: Vec3 = [0, 1, 2].map((c) => Math.hypot(l[c], l[3 + c], l[6 + c])) as Vec3;
    if (!s.every((v) => v > 0 && Number.isFinite(v))) throw new RangeError(`retarget: node ${i} (${names[i]}) has a zero or non-finite scale`);
    const det = l[0] * (l[4] * l[8] - l[5] * l[7]) - l[1] * (l[3] * l[8] - l[5] * l[6]) + l[2] * (l[3] * l[7] - l[4] * l[6]);
    if (det < 0) s[0] = -s[0];
    const r = l.map((v, k) => v / s[k % 3]);
    return { t, r: quatFromM3(r), s };
  });
  return { names: [...names], parents: [...parents], restLocal };
}

// ---------------------------------------------------------------------------------------------
// Mannequin frames
// ---------------------------------------------------------------------------------------------

/**
 * Root-frame frames of every mannequin joint pivot (`MannequinJoints` keys except `root`): rotation and pivot
 * position composed from the hips down, the root node excluded. `local` gives a node's local transform (default:
 * the node's own `position` / `rotation`, i.e. the rest pose); pass `(n) => nodeStateAt(n, t)` for time t. Sizes
 * do not affect children (as in the evaluator).
 */
export function mannequinFrames(
  nodes: readonly PrevisNode[],
  joints: MannequinJoints,
  local: (node: PrevisNode) => { position: Vec3; rotation: Vec3 } = (n) => n,
): Record<string, MannequinJointFrame> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, MannequinJointFrame>();
  const frame = (id: string, depth: number): MannequinJointFrame => {
    if (id === joints.root) return { rot: [...ID], pos: [0, 0, 0] };
    const hit = memo.get(id);
    if (hit) return hit;
    const n = byId.get(id);
    if (!n) throw new Error(`mannequinFrames: unknown node "${id}"`);
    if (n.parent === undefined || depth > 64) throw new Error(`mannequinFrames: "${id}" is not under the root "${joints.root}"`);
    const p = frame(n.parent, depth + 1);
    const l = local(n);
    const f: MannequinJointFrame = {
      pos: add(p.pos, quatRotate(p.rot, l.position)),
      rot: qnorm(qmul(p.rot, eulerYXZToQuat(l.rotation))),
    };
    memo.set(id, f);
    return f;
  };
  const out: Record<string, MannequinJointFrame> = {};
  for (const [key, id] of Object.entries(joints)) {
    if (key === 'root' || typeof id !== 'string') continue;
    out[key] = frame(id, 0);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// prepareRetarget
// ---------------------------------------------------------------------------------------------

/** Parents-first visiting order; throws on bad parent indices or cycles. */
function topoOrder(parents: readonly number[]): number[] {
  const n = parents.length;
  const kids: number[][] = Array.from({ length: n }, () => []);
  const roots: number[] = [];
  parents.forEach((p, i) => {
    if (p === -1) roots.push(i);
    else if (Number.isInteger(p) && p >= 0 && p < n && p !== i) kids[p].push(i);
    else throw new RangeError(`retarget: node ${i} has an invalid parent ${p}`);
  });
  const order: number[] = [];
  const stack = [...roots].reverse();
  while (stack.length) {
    const i = stack.pop()!;
    order.push(i);
    for (let k = kids[i].length - 1; k >= 0; k--) stack.push(kids[i][k]);
  }
  if (order.length !== n) throw new RangeError('retarget: the rig hierarchy has a cycle');
  return order;
}

/**
 * Model-space FK: rotation (product of local rotations, scale ignored), linear part (rotation and scale) and
 * position of every node, visiting `order` parents first.
 */
function fkCore(
  rig: RetargetRig,
  order: readonly number[],
  local: readonly Quat[],
  translation?: (i: number) => Vec3 | undefined,
): { rot: Quat[]; lin: M3[]; pos: Vec3[] } {
  const n = rig.names.length;
  const rot: Quat[] = new Array(n);
  const lin: M3[] = new Array(n);
  const pos: Vec3[] = new Array(n);
  for (const i of order) {
    const p = rig.parents[i];
    const q = qnorm(local[i]);
    const t = translation?.(i) ?? rig.restLocal[i].t;
    const pl = p < 0 ? M3_ID : lin[p];
    rot[i] = qnorm(qmul(p < 0 ? ID : rot[p], q));
    lin[i] = m3Mul(pl, m3Trs(q, rig.restLocal[i].s));
    pos[i] = add(p < 0 ? [0, 0, 0] : pos[p], m3Vec(pl, t));
  }
  return { rot, lin, pos };
}

/** Rest model-space rotation (scale ignored) and position (scales applied) of every rig node. */
export function rigRestPose(rig: RetargetRig): { rot: Quat[]; pos: Vec3[] } {
  if (rig.parents.length !== rig.names.length || rig.restLocal.length !== rig.names.length) {
    throw new RangeError('retarget: names, parents and restLocal must have the same length');
  }
  const { rot, pos } = fkCore(rig, topoOrder(rig.parents), rig.restLocal.map((t) => t.r));
  return { rot, pos };
}

/**
 * Prepare a retargeter for `rig` with the joint map `map` and the mannequin's REST frames `rest(joint)` (root frame,
 * e.g. `mannequinFrames(m.nodes, m.joints)[joint]`). Throws on unknown / duplicate bones or joints, a `child` that is
 * not mapped, or a zero-length rest direction.
 */
export function prepareRetarget(
  rig: RetargetRig,
  map: readonly RetargetJoint[],
  rest: (joint: string) => MannequinJointFrame,
): Retargeter {
  const n = rig.names.length;
  if (rig.parents.length !== n || rig.restLocal.length !== n) {
    throw new RangeError('retarget: names, parents and restLocal must have the same length');
  }
  const order = topoOrder(rig.parents);
  const index = new Map<string, number>();
  rig.names.forEach((name, i) => {
    if (!index.has(name)) index.set(name, i);
  });
  const restR = rig.restLocal.map((t) => qnorm(t.r));

  // Rest model space.
  const { rot: W0, lin: L0, pos: P0 } = fkCore(rig, order, restR);

  // Map entries.
  const boneOf = new Map<string, number>(); // joint -> rig index
  const jointOf: (string | undefined)[] = new Array(n).fill(undefined); // rig index -> joint
  const entryOf = new Map<string, RetargetJoint>();
  for (const e of map) {
    const b = index.get(e.bone);
    if (b === undefined) throw new Error(`retarget: unknown rig bone "${e.bone}" (joint "${e.joint}")`);
    if (boneOf.has(e.joint)) throw new Error(`retarget: joint "${e.joint}" is mapped twice`);
    if (jointOf[b] !== undefined) throw new Error(`retarget: bone "${e.bone}" is mapped twice`);
    if (e.child !== undefined && e.aim !== undefined) throw new Error(`retarget: joint "${e.joint}" has both child and aim`);
    boneOf.set(e.joint, b);
    jointOf[b] = e.joint;
    entryOf.set(e.joint, e);
  }
  for (const e of map) {
    if (e.child !== undefined && !boneOf.has(e.child)) {
      throw new Error(`retarget: child "${e.child}" of joint "${e.joint}" is not mapped`);
    }
  }
  const restOf = (joint: string): MannequinJointFrame => {
    const f = rest(joint);
    if (!f) throw new Error(`retarget: no mannequin rest frame for joint "${joint}"`);
    return f;
  };
  const mappedAncestor = (i: number): number => {
    for (let p = rig.parents[i]; p >= 0; p = rig.parents[p]) if (jointOf[p] !== undefined) return p;
    return -1;
  };
  const dirCheck = (d: Vec3, what: string): Vec3 => {
    if (!(len(d) > 1e-9)) throw new RangeError(`retarget: zero-length rest direction (${what})`);
    return d;
  };

  // Alignment A_b, parents first so 'inherit' can read its ancestor's.
  const align: Quat[] = Array.from({ length: n }, () => [...ID] as Quat);
  for (const i of order) {
    const joint = jointOf[i];
    if (joint === undefined) continue;
    const e = entryOf.get(joint)!;
    if (e.child !== undefined) {
      const c = boneOf.get(e.child)!;
      const dr = dirCheck(sub(P0[c], P0[i]), `rig ${e.bone} -> ${rig.names[c]}`);
      const dm = dirCheck(sub(restOf(e.child).pos, restOf(joint).pos), `mannequin ${joint} -> ${e.child}`);
      align[i] = shortestArc(dr, dm);
    } else if (e.aim === 'continue') {
      const anc = mappedAncestor(i);
      if (anc < 0) throw new Error(`retarget: joint "${joint}" uses aim 'continue' but has no mapped rig ancestor`);
      const tip = e.rigTip === undefined ? rig.parents.indexOf(i) : index.get(e.rigTip);
      if (tip === undefined || tip < 0) throw new Error(`retarget: joint "${joint}" has no rig tip for aim 'continue'`);
      const dr = dirCheck(sub(P0[tip], P0[i]), `rig ${e.bone} -> ${rig.names[tip]}`);
      const pj = jointOf[anc]!;
      const dm = dirCheck(sub(restOf(joint).pos, restOf(pj).pos), `mannequin ${pj} -> ${joint}`);
      align[i] = shortestArc(dr, dm);
    } else {
      const anc = mappedAncestor(i);
      align[i] = anc < 0 ? [...ID] : [...align[anc]];
    }
  }

  // K_b = R_j(rest)^-1 · A_b · W0_b, so W_b(t) = R_j(t) · K_b.
  const K: (Quat | undefined)[] = new Array(n).fill(undefined);
  for (let i = 0; i < n; i++) {
    const joint = jointOf[i];
    if (joint === undefined) continue;
    K[i] = qnorm(qmul(qconj(qnorm(restOf(joint).rot)), qmul(align[i], W0[i])));
  }

  let hipsIndex = -1;
  for (const i of order) {
    if (jointOf[i] !== undefined) {
      hipsIndex = i;
      break;
    }
  }
  if (hipsIndex < 0) throw new Error('retarget: the map has no bone');

  const chainScale = (joints: readonly string[]): number => {
    if (joints.length < 2) throw new RangeError('retarget: a chain needs at least 2 joints');
    let lm = 0;
    let lr = 0;
    for (let k = 1; k < joints.length; k++) {
      const a = boneOf.get(joints[k - 1]);
      const b = boneOf.get(joints[k]);
      if (a === undefined || b === undefined) throw new Error(`retarget: chain joint "${a === undefined ? joints[k - 1] : joints[k]}" is not mapped`);
      lm += len(sub(restOf(joints[k]).pos, restOf(joints[k - 1]).pos));
      lr += len(sub(P0[b], P0[a]));
    }
    if (!(lr > 0)) throw new RangeError('retarget: zero-length rig chain');
    return lm / lr;
  };

  const legs = [['hipL', 'kneeL', 'footL'], ['hipR', 'kneeR', 'footR']].filter((c) => c.every((j) => boneOf.has(j)));
  const legScale = legs.length ? legs.reduce((s, c) => s + chainScale(c), 0) / legs.length : undefined;

  const hipsJoint = jointOf[hipsIndex]!;
  const hipsRestPos = restOf(hipsJoint).pos;
  const hipsParent = rig.parents[hipsIndex];
  const hipsParentInv = m3Inv(hipsParent < 0 ? M3_ID : L0[hipsParent]);

  const solve = (rot: (joint: string) => Quat, out?: Quat[]): Quat[] => {
    const res = out ?? new Array<Quat>(n);
    const W: Quat[] = new Array(n);
    for (const i of order) {
      const p = rig.parents[i];
      const pw = p < 0 ? ID : W[p];
      const joint = jointOf[i];
      if (joint === undefined) {
        W[i] = qnorm(qmul(pw, restR[i]));
        res[i] = [...restR[i]];
        continue;
      }
      const r = rot(joint);
      if (!r) throw new Error(`retarget: no mannequin rotation for joint "${joint}"`);
      W[i] = qnorm(qmul(qnorm(r), K[i]!));
      let l = qnorm(qmul(qconj(pw), W[i]));
      const rr = restR[i];
      if (l[0] * rr[0] + l[1] * rr[1] + l[2] * rr[2] + l[3] * rr[3] < 0) l = [-l[0], -l[1], -l[2], -l[3]];
      res[i] = l;
    }
    return res;
  };

  const hipsTranslation = (pos: Vec3, k: number): Vec3 => {
    if (!(k > 0)) throw new RangeError('retarget: scale k must be > 0');
    const d = sub(pos, hipsRestPos);
    const target = add(P0[hipsIndex], [d[0] / k, d[1] / k, d[2] / k]);
    const pp: Vec3 = hipsParent < 0 ? [0, 0, 0] : P0[hipsParent];
    return m3Vec(hipsParentInv, sub(target, pp));
  };

  const fk = (local: readonly Quat[], translation?: (i: number) => Vec3 | undefined) => {
    if (local.length !== n) throw new RangeError(`retarget: fk needs ${n} local rotations`);
    const { rot, pos } = fkCore(rig, order, local, translation);
    return { rot, pos };
  };

  // ---- IK AND PLANTED FEET ----
  const LIMBS: { joints: [string, string, string]; leg: boolean }[] = [
    { joints: ['shoulderL', 'elbowL', 'handL'], leg: false },
    { joints: ['shoulderR', 'elbowR', 'handR'], leg: false },
    { joints: ['hipL', 'kneeL', 'footL'], leg: true },
    { joints: ['hipR', 'kneeR', 'footR'], leg: true },
  ];
  const limbs = LIMBS.flatMap(({ joints, leg }) => {
    const idx = joints.map((j) => boneOf.get(j));
    if (idx.some((i) => i === undefined)) return [];
    const [a, b, c] = idx as number[];
    if (rig.parents[b] !== a || rig.parents[c] !== b) return [];
    const l1 = len(sub(P0[b], P0[a]));
    const l2 = len(sub(P0[c], P0[b]));
    // Rest pole in bone a's rest frame (null when the rest limb is straight)
    const line = sub(P0[c], P0[a]);
    const ll = len(line);
    const off = sub(P0[b], P0[a]);
    const t = ll > 0 ? (off[0] * line[0] + off[1] * line[1] + off[2] * line[2]) / (ll * ll) : 0;
    const restPole: Vec3 = sub(off, [line[0] * t, line[1] * t, line[2] * t]);
    const restPoleLocal = len(restPole) > 1e-4 * (l1 + l2) ? quatRotate(qconj(W0[a]), restPole) : null;
    return [{ a, b, c, l1, l2, leg, end: joints[2], restPoleLocal }];
  });

  const dot = (u: Vec3, v: Vec3) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const unitv = (v: Vec3): Vec3 => {
    const l = len(v);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  /** Rotation taking the orthonormal pair (x, y) onto (x2, y2). */
  const frameMap = (x: Vec3, y: Vec3, x2: Vec3, y2: Vec3): Quat => {
    const z = cross(x, y);
    const z2 = cross(x2, y2);
    // R = [x2 y2 z2] [x y z]^T, row-major
    const m: M3 = new Array(9);
    for (let r = 0; r < 3; r++) for (let cc = 0; cc < 3; cc++) m[3 * r + cc] = x2[r] * x[cc] + y2[r] * y[cc] + z2[r] * z[cc];
    return quatFromM3(m);
  };
  const slerp = (a: Quat, b0: Quat, u: number): Quat => {
    let b = b0;
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) {
      b = [-b[0], -b[1], -b[2], -b[3]];
      d = -d;
    }
    if (d > 1 - 1e-12) return qnorm([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u, a[3] + (b[3] - a[3]) * u]);
    const th = Math.acos(Math.min(1, d));
    const sa = Math.sin((1 - u) * th) / Math.sin(th);
    const sb = Math.sin(u * th) / Math.sin(th);
    return qnorm([a[0] * sa + b[0] * sb, a[1] * sa + b[1] * sb, a[2] * sa + b[2] * sb, a[3] * sa + b[3] * sb]);
  };
  const localOf = (parentW: Quat, w: Quat, i: number): Quat => {
    let l = qnorm(qmul(qconj(parentW), w));
    const rr = restR[i];
    if (l[0] * rr[0] + l[1] * rr[1] + l[2] * rr[2] + l[3] * rr[3] < 0) l = [-l[0], -l[1], -l[2], -l[3]];
    return l;
  };

  const solvePose = (frames: (joint: string) => MannequinJointFrame, k: number, options: RetargetPoseOptions = {}): RetargetPose => {
    if (!(k > 0)) throw new RangeError('retarget: scale k must be > 0');
    const ik = options.ik !== false;
    const plant = options.plant !== false;
    const rootQ = qnorm(options.root?.q ?? ID);
    const rootP = options.root?.p ?? [0, 0, 0];
    const hs = options.sourceAnkleHeight ?? 0;
    if (!Number.isFinite(hs)) throw new RangeError('retarget: sourceAnkleHeight must be finite');
    const up = quatRotate(qconj(rootQ), [0, 1, 0]);
    // level = root yaw only, expressed in the root frame: q_root^-1 * yaw(q_root)
    const fwd = quatRotate(rootQ, [0, 0, 1]);
    const yaw = Math.hypot(fwd[0], fwd[2]) > 1e-9 ? Math.atan2(fwd[0], fwd[2]) : 0;
    const level = qnorm(qmul(qconj(rootQ), [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]));

    const local = solve((j) => frames(j).rot);
    const results: RetargetLimbResult[] = [];
    if (!ik && !plant) return { local, limbs: results };
    const { rot: W, pos: P } = fkCore(rig, order, local);
    const hipsPos = frames(hipsJoint).pos;
    const goalOf = (joint: string): Vec3 => {
      const p = frames(joint).pos;
      return add(P0[hipsIndex], [(p[0] - hipsPos[0]) / k, (p[1] - hipsPos[1]) / k, (p[2] - hipsPos[2]) / k]);
    };
    for (const L of limbs) {
      const { a, b, c, l1, l2 } = L;
      let Wa = W[a];
      let Wb = W[b];
      let Wc = W[c];
      let reached = true;
      let miss = 0;
      if (ik) {
        let goal = goalOf(L.end);
        // Foot: the ground point under the source ankle (source foot frame - up * hs) lifted by the rig's ankle height
        const lift = P0[c][1] - hs / k;
        if (L.leg) goal = add(goal, [up[0] * lift, up[1] * lift, up[2] * lift]);
        const A = P[a];
        const B = P[b];
        const C = P[c];
        // Pole: FK bend, else the rest bend / default turned by bone a's FK rotation change
        const lineFk = sub(C, A);
        const lf = len(lineFk);
        const offB = sub(B, A);
        const tf = lf > 0 ? dot(offB, lineFk) / (lf * lf) : 0;
        let pole: Vec3 = sub(offB, [lineFk[0] * tf, lineFk[1] * tf, lineFk[2] * tf]);
        const dA = qmul(W[a], qconj(W0[a]));
        if (!(len(pole) > 1e-4 * (l1 + l2))) {
          pole = L.restPoleLocal ? quatRotate(W[a], L.restPoleLocal) : quatRotate(dA, L.leg ? [0, 0, 1] : [0, 0, -1]);
        }
        const toGoal = sub(goal, A);
        const dist = len(toGoal);
        const lo = Math.abs(l1 - l2);
        const hi = l1 + l2;
        const u: Vec3 = dist > 1e-12 ? unitv(toGoal) : unitv(lineFk);
        let v: Vec3 = sub(pole, [u[0] * dot(pole, u), u[1] * dot(pole, u), u[2] * dot(pole, u)]);
        if (!(len(v) > 1e-9)) v = cross(u, Math.abs(u[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]);
        v = unitv(v);
        const d = Math.min(hi, Math.max(lo, dist));
        reached = dist >= lo - 1e-9 && dist <= hi + 1e-9;
        const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
        const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
        const B2 = add(A, [l1 * (cosA * u[0] + sinA * v[0]), l1 * (cosA * u[1] + sinA * v[1]), l1 * (cosA * u[2] + sinA * v[2])]);
        const C2 = add(A, [d * u[0], d * u[1], d * u[2]]);
        // Bone a: {dir, plane normal} FK -> IK (FK normal from the same pole, so a straight FK limb is well defined)
        const fkLine = lf > 1e-12 ? unitv(lineFk) : u;
        let nFk = cross(fkLine, pole);
        if (!(len(nFk) > 1e-12)) nFk = cross(fkLine, v);
        nFk = unitv(nFk);
        const e1 = unitv(offB);
        // e1 lies in the FK plane: re-orthogonalize against nFk for safety
        const e1o = unitv(sub(e1, [nFk[0] * dot(e1, nFk), nFk[1] * dot(e1, nFk), nFk[2] * dot(e1, nFk)]));
        const nIk = unitv(cross(u, v));
        const qa = frameMap(e1o, nFk, unitv(sub(B2, A)), nIk);
        Wa = qnorm(qmul(qa, W[a]));
        const midDir = quatRotate(qa, sub(C, B));
        const qb = shortestArc(midDir, sub(C2, B2));
        Wb = qnorm(qmul(qb, qmul(qa, W[b])));
        miss = len(sub(C2, goal)) * k;
      }
      let w = 0;
      if (L.leg && plant) {
        const fp = frames(L.end).pos;
        const h = quatRotate(rootQ, fp)[1] + rootP[1] - hs;
        const x = Math.min(1, Math.max(0, (h - PLANT_LOW) / (PLANT_HIGH - PLANT_LOW)));
        w = 1 - x * x * (3 - 2 * x);
        if (w > 0) Wc = slerp(W[c], qnorm(qmul(level, W0[c])), w);
      }
      const pa = rig.parents[a];
      local[a] = localOf(pa < 0 ? ID : W[pa], Wa, a);
      local[b] = localOf(Wa, Wb, b);
      local[c] = localOf(Wb, Wc, c);
      results.push({ joint: L.end, reached, miss, plant: w });
    }
    return { local, limbs: results };
  };

  return {
    names: [...rig.names],
    rest: { rot: W0, pos: P0 },
    align,
    hipsIndex,
    legScale,
    indexOf: (name) => index.get(name) ?? -1,
    chainScale,
    solve,
    hipsTranslation,
    fk,
    solvePose,
  };
}
