import { describe, expect, it } from 'vitest';
import { applyMotion, createMannequin, crouch, lookAt, pickUp, raiseArm, walk } from '../previs/mannequin';
import type { Mannequin } from '../previs/mannequin';
import { eulerYXZToQuat, nodeStateAt } from '../previs/evaluate';
import type { Quat } from '../previs/evaluate';
import type { PrevisNode, Vec3 } from '../previs/types';
import {
  KAYKIT_RETARGET_MAP,
  UE_RETARGET_MAP,
  mannequinFrames,
  prepareRetarget,
  quatRotate,
  rigFromWorldMatrices,
  PLANT_HIGH,
  PLANT_LOW,
  rigRestPose,
  shortestArc,
} from '../previs/retarget';
import type { MannequinJointFrame, RetargetLimbResult, RetargetRig, Retargeter } from '../previs/retarget';
import { QUATERNIUS_ROWS, quaterniusRig } from './fixtures/quaternius-rig';

// KayKit Character Pack Adventures, Knight.glb: the 41 skin joints (skin order) with their rest local TRS, read
// from the file's JSON chunk (9 significant digits). Parent = index in this list, -1 for the skeleton root.
// All KayKit characters share this rig.
type Row = [string, number, Vec3, Quat, Vec3];
const KNIGHT: Row[] = [
  ["root", -1, [0, 0, 0], [0, 1.19209275e-7, 0, 1], [1, 1, 1]],
  ["hips", 0, [0, 0.405663431, 0], [0, -1.19209275e-7, 0, 1], [1, 1, 1]],
  ["spine", 1, [0, 0.191977501, 0], [0, 7.10542736e-15, 0, 1], [1, 1, 1]],
  ["chest", 2, [0, 0.37498796, 0], [0, 0, 0, 1], [1, 0.99999994, 1]],
  ["upperarm.l", 3, [0.212007374, 0.134132147, 8.40246202e-8], [-0.514121473, -0.485467792, -0.485467762, 0.51412189], [0.999999344, 0.999999344, 0.999999762]],
  ["lowerarm.l", 4, [-3.21966498e-9, 0.2418973, -1.19405613e-7], [1.6480538e-9, -5.95036234e-8, -0.0552855209, 0.998470604], [1.00000024, 0.999999881, 0.99999994]],
  ["wrist.l", 5, [8.71929196e-9, 0.26004383, -1.50195176e-10], [-9.73783901e-11, -2.98437081e-10, 0.0266580991, 0.999644697], [0.99999994, 0.99999994, 0.99999994]],
  ["hand.l", 6, [9.08162434e-13, 0.0738258362, 2.22044605e-16], [1.20017918e-9, 1.33101835e-7, -0.00000545519561, 1], [1, 0.99999994, 0.99999994]],
  ["handslot.l", 7, [8.34814884e-10, 0.0961250663, -0.057500124], [1.60975311e-9, 1.609753e-9, -0.707106829, 0.707106709], [0.99999994, 1, 0.99999994]],
  ["upperarm.r", 3, [-0.212007374, 0.134132147, 8.40246202e-8], [-0.514121413, 0.485467732, 0.485467762, 0.51412195], [0.999999344, 0.999999344, 0.999999762]],
  ["lowerarm.r", 9, [-7.12185658e-11, 0.24189733, -1.19405613e-7], [1.64805358e-9, 5.95036305e-8, 0.0552855209, 0.998470604], [1.00000024, 0.999999881, 0.99999994]],
  ["wrist.r", 10, [-8.71838335e-9, 0.26004383, -1.50195176e-10], [-9.73783901e-11, 2.98437081e-10, -0.0266580991, 0.999644697], [0.99999994, 0.99999994, 0.99999994]],
  ["hand.r", 11, [1.33226763e-15, 0.0738258362, 2.22044605e-16], [1.1999316e-9, -8.93185899e-8, 0.00000545519561, 1], [1, 0.99999994, 0.99999994]],
  ["handslot.r", 12, [-8.34814884e-10, 0.0961250663, -0.057500124], [1.60973301e-9, -1.6097329e-9, 0.707106829, 0.707106709], [0.99999994, 1, 0.99999994]],
  ["head", 3, [0, 0.268796563, 0], [0, 0, 0, 1], [1, 1, 1]],
  ["upperleg.l", 1, [0.170945063, 0.11358726, 1.39232723e-8], [0.999849081, -7.13275625e-8, -1.20427384e-8, 0.0173731912], [1, 0.999999821, 1.00000119]],
  ["lowerleg.l", 15, [3.57981822e-9, 0.227077499, -6.13985973e-9], [0.10622514, 6.86528523e-8, -7.37698755e-8, 0.994342208], [1, 1.00000048, 1.00000012]],
  ["foot.l", 16, [1.83222298e-10, 0.149437025, 9.66536629e-10], [-0.455239028, 1.61971272e-8, -3.43568445e-8, 0.890369296], [1, 1.00000083, 0.999998748]],
  ["toes.l", 17, [-2.13059653e-10, 0.165650025, 5.17173504e-9], [-3.04790824e-8, 0.920354784, -0.391084462, 6.94848481e-8], [1, 0.99999994, 1.00000012]],
  ["upperleg.r", 1, [-0.170945063, 0.11358726, 1.39232723e-8], [0.999849081, 7.42656425e-8, -3.17262732e-8, 0.0173731912], [1, 0.999999821, 1.00000119]],
  ["lowerleg.r", 19, [-3.57981822e-9, 0.227077499, -6.13985973e-9], [0.10622514, -6.86528665e-8, 7.37698755e-8, 0.994342208], [1, 1.00000048, 1.00000012]],
  ["foot.r", 20, [-1.83221022e-10, 0.149437025, 9.66541513e-10], [-0.455239028, 1.65982414e-7, 2.25095165e-9, 0.890369296], [1, 1.00000083, 0.999998748]],
  ["toes.r", 21, [2.13057683e-10, 0.165650025, 5.17173948e-9], [-3.04790859e-8, -0.920354784, 0.391084462, 6.94848623e-8], [1, 0.99999994, 1.00000012]],
  ["kneeIK.l", 0, [0.170944914, 0.292310268, 0.575812459], [0.707106829, -2.2930233e-7, -4.60551846e-8, 0.707106829], [1, 0.999999881, 0.999999881]],
  ["control-toe-roll.l", 0, [0.170944974, 0.0259902626, 0.245789379], [-0.707106829, -7.05285004e-8, -7.05284862e-8, 0.707106829], [1, 1, 1]],
  ["control-heel-roll.l", 24, [1.94581098e-8, 0.362832665, -2.42861287e-15], [-7.10543752e-15, 1.38321168e-22, -1, 2.33982954e-34], [1, 1, 1]],
  ["control-foot-roll.l", 25, [-1.11482166e-8, 0.213436142, -2.50941981e-15], [1.04035252e-7, -0.391084343, -0.920354843, 2.95260438e-8], [1, 0.99999994, 0.999999881]],
  ["heelIK.l", 26, [8.58988169e-9, 0.16565004, -5.09136555e-9], [-0.391084343, -6.88499995e-8, -6.56287753e-8, 0.920354843], [1, 0.99999994, 1]],
  ["IK-foot.l", 26, [8.58988169e-9, 0.16565004, -5.09136555e-9], [-1, 3.10862701e-15, -1.94707198e-7, 6.91738875e-22], [1, 1, 0.99999994]],
  ["IK-toe.l", 25, [-4.55694904e-9, -7.95029209e-10, -1.86264515e-9], [1.37008579e-22, -6.74097804e-17, -1.94669347e-8, 1], [1, 0.99999994, 1]],
  ["kneeIK.r", 0, [-0.170945182, 0.292310268, 0.57581234], [0.707106829, -3.82384968e-8, 1.45008656e-7, 0.707106829], [1, 0.999999881, 0.999999881]],
  ["control-toe-roll.r", 0, [-0.170945093, 0.0259902626, 0.245789289], [-0.707106829, -7.05285075e-8, -7.05285004e-8, 0.707106829], [1, 1, 1]],
  ["control-heel-roll.r", 31, [1.94581062e-8, 0.362832665, 2.42861287e-15], [-7.10543752e-15, 1.38321067e-22, -1, 2.33983046e-34], [1, 1, 1]],
  ["control-foot-roll.r", 32, [3.75294151e-9, 0.213436142, 0], [1.04035223e-7, -0.391084343, -0.920354843, 2.95260527e-8], [1, 0.99999994, 0.999999881]],
  ["heelIK.r", 33, [-6.31127506e-9, 0.16565004, 1.36608236e-9], [-0.391084343, -6.88500137e-8, -6.5628754e-8, 0.920354843], [1, 0.99999994, 1]],
  ["IK-foot.r", 33, [-2.12124363e-8, 0.16565004, 1.36607659e-9], [1, 4.44086457e-16, 1.94707198e-7, 6.91738875e-22], [1, 1, 0.99999994]],
  ["IK-toe.r", 32, [-4.55694549e-9, 7.95036204e-10, -1.86264515e-9], [1.37008504e-22, -6.74098664e-17, -1.94669205e-8, 1], [1, 0.99999994, 1]],
  ["elbowIK.l", 0, [0.453507483, 1.1067611, -0.588859379], [-0.707106829, -7.27951104e-8, -7.27950891e-8, 0.707106829], [1, 1, 1]],
  ["handIK.l", 0, [0.713181496, 1.1067611, 2.54914141e-7], [-0.49999994, -0.50000006, -0.50000006, 0.5], [0.999999881, 0.999999762, 0.99999994]],
  ["elbowIK.r", 0, [-0.453507185, 1.1067611, -0.588859618], [-0.707106829, -7.27951104e-8, -7.27950891e-8, 0.707106829], [1, 1, 1]],
  ["handIK.r", 0, [-0.713181555, 1.1067611, -8.51573105e-8], [-0.50000006, 0.49999994, 0.5, 0.50000006], [1, 1, 1]],
];
const knightRig = (): RetargetRig => ({
  names: KNIGHT.map((r) => r[0]),
  parents: KNIGHT.map((r) => r[1]),
  restLocal: KNIGHT.map((r) => ({ t: [...r[2]], r: [...r[3]], s: [...r[4]] })),
});

const FPS = 24;
/**
 * Bone directions on the Knight are compared within 1e-6: the file's node scales differ from 1 by up to 1.3e-6,
 * which the rotation transfer ignores (exact on the unit-scale synthetic rig below, within 1e-9).
 */
const KNIGHT_DIR_TOL = 1e-6;
const GREY: [number, number, number] = [0.5, 0.5, 0.5];

// ---- small helpers ----
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => scale(a, 1 / norm(a));
const dist = (a: Vec3, b: Vec3): number => norm(sub(a, b));
const qn = (q: Quat): Quat => {
  const l = Math.hypot(...q);
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
};
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
/** Distance between two rotations as quaternions (sign-insensitive). */
const qdist = (a: Quat, b: Quat): number => {
  const x = qn(a);
  const y = qn(b);
  return Math.min(Math.hypot(...x.map((v, i) => v - y[i])), Math.hypot(...x.map((v, i) => v + y[i])));
};

const jointedMannequin = (h = 1.75): Mannequin =>
  createMannequin({ id: 'm', color: GREY, height: h, limbs: 'jointed' });

/** Root-frame mannequin frames of `nodes` at time t (or rest when t is undefined). */
const framesAt = (m: Mannequin, nodes: PrevisNode[], t?: number): Record<string, MannequinJointFrame> =>
  mannequinFrames(nodes, m.joints, t === undefined ? undefined : (n) => nodeStateAt(n, t));

/** Rig model-space positions for a mannequin pose, hips translated by the mannequin hips displacement / k. */
function posedRig(r: Retargeter, f: Record<string, MannequinJointFrame>, k: number): { pos: Vec3[]; rot: Quat[]; local: Quat[] } {
  const local = r.solve((j) => f[j].rot);
  const hipsT = r.hipsTranslation(f.hips.pos, k);
  const { pos, rot } = r.fk(local, (i) => (i === r.hipsIndex ? hipsT : undefined));
  return { pos, rot, local };
}

/**
 * A synthetic glTF-like rig with EXACTLY the mannequin's proportions, but in T-pose (arms along +-x) and with
 * arbitrary bone twists (bone +y points at the child, then a per-bone roll about it), plus unmapped chest, hand,
 * handslot and toes nodes.
 */
function tPoseRig(m: Mannequin): RetargetRig {
  const F = mannequinFrames(m.nodes, m.joints);
  const upper = dist(F.elbowL.pos, F.shoulderL.pos);
  const fore = dist(F.handL.pos, F.elbowL.pos);
  const spec: [string, string | null, Vec3][] = [
    ['root', null, [0, 0, 0]],
    ['hips', 'root', F.hips.pos],
    ['spine', 'hips', F.spine.pos],
    ['chest', 'spine', add(F.spine.pos, [0, 0.2, 0])],
    ['head', 'chest', F.head.pos],
  ];
  for (const [s, sx] of [['l', 1], ['r', -1]] as const) {
    const S = s === 'l' ? 'L' : 'R';
    const sh = F[`shoulder${S}`].pos;
    spec.push(
      [`upperarm.${s}`, 'chest', sh],
      [`lowerarm.${s}`, `upperarm.${s}`, add(sh, [sx * upper, 0, 0])],
      [`wrist.${s}`, `lowerarm.${s}`, add(sh, [sx * (upper + fore), 0, 0])],
      [`hand.${s}`, `wrist.${s}`, add(sh, [sx * (upper + fore + 0.08), 0, 0])],
      [`handslot.${s}`, `hand.${s}`, add(sh, [sx * (upper + fore + 0.13), 0, 0.03])],
      [`upperleg.${s}`, 'hips', F[`hip${S}`].pos],
      [`lowerleg.${s}`, `upperleg.${s}`, F[`knee${S}`].pos],
      [`foot.${s}`, `lowerleg.${s}`, F[`foot${S}`].pos],
      [`toes.${s}`, `foot.${s}`, add(F[`foot${S}`].pos, [0, -0.02, 0.15])],
    );
  }
  const names = spec.map((s) => s[0]);
  const idx = (n: string | null) => (n === null ? -1 : names.indexOf(n));
  const parents = spec.map((s) => idx(s[1]));
  // Model-space rotation: +y onto the direction to the first child, then a roll about it.
  const W: Quat[] = spec.map((s, i) => {
    const child = parents.indexOf(i);
    const dir = child >= 0 ? sub(spec[child][2], s[2]) : ([0, 1, 0] as Vec3);
    const aim = norm(dir) > 1e-9 ? shortestArc([0, 1, 0], dir) : ([0, 0, 0, 1] as Quat);
    const roll = 0.37 * (i + 1);
    return qn(qmul(aim, [0, Math.sin(roll / 2), 0, Math.cos(roll / 2)]));
  });
  const restLocal = spec.map((s, i) => {
    const p = parents[i];
    const pw: Quat = p < 0 ? [0, 0, 0, 1] : W[p];
    const pp: Vec3 = p < 0 ? [0, 0, 0] : spec[p][2];
    return { t: quatRotate(qconj(pw), sub(s[2], pp)), r: qn(qmul(qconj(pw), W[i])), s: [1, 1, 1] as Vec3 };
  });
  return { names, parents, restLocal };
}

/** Mannequin nodes posed by pickUp (right hand to a floor point in front) or by crouch. */
function pickUpNodes(m: Mannequin) {
  const pick = pickUp({ mannequin: m, side: 'right', target: [-0.3, 0.075, 0.42], start: 0, grab: 1, end: 2, depth: 0.65, lean: 0.8, fps: FPS });
  expect(pick.miss).toBeLessThan(1e-6);
  return applyMotion(m.nodes, pick.motion);
}

const SIDES = ['L', 'R'] as const;
const lower = (s: 'L' | 'R') => s.toLowerCase();

// ---------------------------------------------------------------------------------------------

describe('retarget: helpers', () => {
  it('shortestArc maps from onto to, including antiparallel', () => {
    const cases: [Vec3, Vec3][] = [
      [[1, 0, 0], [0, -1, 0]],
      [[0, 1, 0], [0, -1, 0]],
      [[1, 0, 0], [-2, 0, 0]],
      [[0.3, -0.2, 0.9], [-0.5, 0.1, 0.4]],
      [[0, 0, 1], [0, 0, 3]],
    ];
    for (const [a, b] of cases) {
      const q = shortestArc(a, b);
      expect(Math.hypot(...q)).toBeCloseTo(1, 12);
      expect(dist(quatRotate(q, unit(a)), unit(b))).toBeLessThan(1e-12);
    }
  });

  it('knight fixture rest FK matches the file (hips 0.406 m, left arm at +x, T-pose)', () => {
    const m = jointedMannequin();
    const r = prepareRetarget(knightRig(), KAYKIT_RETARGET_MAP, (j) => mannequinFrames(m.nodes, m.joints)[j]);
    const P = (n: string) => r.rest.pos[r.indexOf(n)];
    expect(P('hips')[1]).toBeCloseTo(0.405663, 5);
    expect(P('upperarm.l')[0]).toBeGreaterThan(0.2);
    expect(P('upperarm.r')[0]).toBeLessThan(-0.2);
    // T-pose: the left forearm runs along +x
    expect(unit(sub(P('wrist.l'), P('lowerarm.l')))[0]).toBeGreaterThan(0.99);
  });
});

describe('retarget: rest pose', () => {
  it('rig-derived rest (A_b = I): solve(rest) returns restLocal for every node within 1e-9', () => {
    const rig = knightRig();
    const rest = rigRestPose(rig);
    // Mannequin rest taken from the rig itself: every direction already agrees, so every A_b is the identity.
    const fromRig = (j: string): MannequinJointFrame => {
      const i = rig.names.indexOf(KAYKIT_RETARGET_MAP.find((e) => e.joint === j)!.bone);
      return { rot: rest.rot[i], pos: rest.pos[i] };
    };
    // aim 'continue' (hands) straightens the rig's 3 degree rest wrist bend onto the forearm line by design, so it
    // is not the identity even here; 'inherit' is (the forearm's A_b).
    const map = KAYKIT_RETARGET_MAP.map((e) => (e.aim === 'continue' ? { ...e, aim: 'inherit' as const } : e));
    const r = prepareRetarget(rig, map, fromRig);
    for (const a of r.align) expect(qdist(a, [0, 0, 0, 1])).toBeLessThan(1e-9);
    const local = r.solve((j) => fromRig(j).rot);
    expect(local).toHaveLength(41);
    local.forEach((q, i) => expect(qdist(q, rig.restLocal[i].r), rig.names[i]).toBeLessThan(1e-9));
  });

  it('T-pose rig vs limbs-down mannequin rest: A_b drops the arms; unmapped and torso keep restLocal', () => {
    const rig = knightRig();
    const m = jointedMannequin();
    const F = mannequinFrames(m.nodes, m.joints);
    const r = prepareRetarget(rig, KAYKIT_RETARGET_MAP, (j) => F[j]);
    const { pos, local } = posedRig(r, F, r.legScale!);
    const mapped = new Set(KAYKIT_RETARGET_MAP.map((e) => e.bone));
    rig.names.forEach((name, i) => {
      if (!mapped.has(name)) expect(qdist(local[i], rig.restLocal[i].r), name).toBeLessThan(1e-9);
    });
    // Torso rest directions already agree (+y): hips, spine, head unchanged.
    for (const b of ['hips', 'spine', 'head']) expect(qdist(local[r.indexOf(b)], rig.restLocal[r.indexOf(b)].r), b).toBeLessThan(1e-9);
    // Limbs: every chain bone points along the mannequin's rest segment (arms and legs straight down).
    const P = (n: string) => pos[r.indexOf(n)];
    for (const s of SIDES) {
      const g = lower(s);
      const chains: [string, string, string, string][] = [
        [`upperarm.${g}`, `lowerarm.${g}`, `shoulder${s}`, `elbow${s}`],
        [`lowerarm.${g}`, `wrist.${g}`, `elbow${s}`, `hand${s}`],
        [`upperleg.${g}`, `lowerleg.${g}`, `hip${s}`, `knee${s}`],
        [`lowerleg.${g}`, `foot.${g}`, `knee${s}`, `foot${s}`],
      ];
      for (const [b, c, mj, mc] of chains) {
        expect(dist(unit(sub(P(c), P(b))), unit(sub(F[mc].pos, F[mj].pos))), b).toBeLessThan(KNIGHT_DIR_TOL);
      }
      expect(dist(unit(sub(P(`wrist.${g}`), P(`lowerarm.${g}`))), [0, -1, 0])).toBeLessThan(KNIGHT_DIR_TOL);
    }
  });
});

describe('retarget: transfer', () => {
  it('a 90 degree elbow bend bends the rig forearm 90 degrees about x, forward', () => {
    const rig = knightRig();
    const m = jointedMannequin();
    const F0 = mannequinFrames(m.nodes, m.joints);
    const r = prepareRetarget(rig, KAYKIT_RETARGET_MAP, (j) => F0[j]);
    const bent = m.nodes.map((n) => (n.id === m.joints.elbowL ? { ...n, rotation: [-Math.PI / 2, 0, 0] as Vec3 } : n));
    const F = mannequinFrames(bent, m.joints);
    const k = r.legScale!;
    const rest = posedRig(r, F0, k);
    const pose = posedRig(r, F, k);
    const P = (n: string) => pose.pos[r.indexOf(n)];
    const mForearm = unit(sub(F.handL.pos, F.elbowL.pos));
    expect(dist(mForearm, [0, 0, 1])).toBeLessThan(1e-12);
    expect(dist(unit(sub(P('wrist.l'), P('lowerarm.l'))), mForearm)).toBeLessThan(1e-6);
    expect(dist(unit(sub(P('lowerarm.l'), P('upperarm.l'))), [0, -1, 0])).toBeLessThan(1e-6);
    // World rotation change of the forearm bone = Rx(-pi/2): 90 degrees about the mannequin elbow axis x.
    const i = r.indexOf('lowerarm.l');
    const delta = qn(qmul(pose.rot[i], qconj(rest.rot[i])));
    expect(qdist(delta, eulerYXZToQuat([-Math.PI / 2, 0, 0]))).toBeLessThan(1e-9);
    // the right arm is untouched
    const j = r.indexOf('lowerarm.r');
    expect(qdist(pose.local[j], rest.local[j])).toBeLessThan(1e-12);
  });

  it('unmapped bones (handslot, hand, toes, IK / control helpers, chest, root) keep rest local in any pose', () => {
    const rig = knightRig();
    const m = jointedMannequin(1.78);
    const r = prepareRetarget(rig, KAYKIT_RETARGET_MAP, (j) => mannequinFrames(m.nodes, m.joints)[j]);
    const F = framesAt(m, pickUpNodes(m), 0.8);
    const local = r.solve((j) => F[j].rot);
    const mapped = new Set(KAYKIT_RETARGET_MAP.map((e) => e.bone));
    let n = 0;
    rig.names.forEach((name, i) => {
      if (mapped.has(name)) return;
      n++;
      expect(qdist(local[i], rig.restLocal[i].r), name).toBeLessThan(1e-9);
    });
    expect(n).toBe(41 - KAYKIT_RETARGET_MAP.length);
  });

  it('chain consistency: rig arm, hand and leg bone directions equal the mannequin segment directions', () => {
    const rig = knightRig();
    const m = jointedMannequin(1.78);
    const r = prepareRetarget(rig, KAYKIT_RETARGET_MAP, (j) => mannequinFrames(m.nodes, m.joints)[j]);
    const nodes = applyMotion(pickUpNodes(m), lookAt({ joints: m.joints, start: 0, end: 1, yaw: 0.6 }));
    for (const t of [0.4, 1, 1.5]) {
      const F = framesAt(m, nodes, t);
      const { pos, rot } = posedRig(r, F, r.legScale!);
      const P = (n: string) => pos[r.indexOf(n)];
      for (const s of SIDES) {
        const g = lower(s);
        const pairs: [string, string, Vec3][] = [
          [`upperarm.${g}`, `lowerarm.${g}`, sub(F[`elbow${s}`].pos, F[`shoulder${s}`].pos)],
          [`lowerarm.${g}`, `wrist.${g}`, sub(F[`hand${s}`].pos, F[`elbow${s}`].pos)],
          // hand bone (wrist -> hand) continues the mannequin forearm line
          [`wrist.${g}`, `hand.${g}`, sub(F[`hand${s}`].pos, F[`elbow${s}`].pos)],
          [`upperleg.${g}`, `lowerleg.${g}`, sub(F[`knee${s}`].pos, F[`hip${s}`].pos)],
          [`lowerleg.${g}`, `foot.${g}`, sub(F[`foot${s}`].pos, F[`knee${s}`].pos)],
        ];
        for (const [b, c, md] of pairs) expect(dist(unit(sub(P(c), P(b))), unit(md)), `${b} t=${t}`).toBeLessThan(KNIGHT_DIR_TOL);
      }
      // head follows the mannequin head's rotation change (lookAt yaw + spine lean)
      const ih = r.indexOf('head');
      const dRig = qmul(rot[ih], qconj(r.rest.rot[ih]));
      const F0 = mannequinFrames(m.nodes, m.joints);
      const dMan = qmul(F.head.rot, qconj(F0.head.rot));
      expect(qdist(dRig, dMan)).toBeLessThan(1e-9);
    }
  });

  it('T-pose rig with the mannequin proportions reproduces every joint position exactly (pickUp, crouch, raiseArm)', () => {
    const m = jointedMannequin(1.78);
    const rig = tPoseRig(m);
    const r = prepareRetarget(rig, KAYKIT_RETARGET_MAP, (j) => mannequinFrames(m.nodes, m.joints)[j]);
    expect(r.legScale).toBeCloseTo(1, 12);
    const poses: [string, PrevisNode[], number][] = [
      ['pickUp', pickUpNodes(m), 1],
      ['pickUp mid', pickUpNodes(m), 1.6],
      ['crouch', applyMotion(m.nodes, crouch({ mannequin: m, start: 0, end: 1, depth: 0.5, fps: FPS })), 1],
      [
        'raiseArm + lookAt',
        applyMotion(m.nodes, [
          raiseArm({ joints: m.joints, side: 'left', start: 0, end: 1, angle: 2.2 }),
          lookAt({ joints: m.joints, start: 0, end: 1, yaw: -0.5 }),
        ]),
        1,
      ],
    ];
    const pairs: [string, string][] = [['hips', 'hips'], ['head', 'head']];
    for (const s of SIDES) {
      const g = lower(s);
      pairs.push(
        [`upperarm.${g}`, `shoulder${s}`], [`lowerarm.${g}`, `elbow${s}`], [`wrist.${g}`, `hand${s}`],
        [`upperleg.${g}`, `hip${s}`], [`lowerleg.${g}`, `knee${s}`], [`foot.${g}`, `foot${s}`],
      );
    }
    for (const [name, nodes, t] of poses) {
      const F = framesAt(m, nodes, t);
      const { pos } = posedRig(r, F, 1);
      for (const [bone, joint] of pairs) {
        expect(dist(pos[r.indexOf(bone)], F[joint].pos), `${name}: ${bone}`).toBeLessThan(1e-9);
      }
    }
  });

  it('is deterministic and honours `out`', () => {
    const rig = knightRig();
    const m = jointedMannequin(1.78);
    const r = prepareRetarget(rig, KAYKIT_RETARGET_MAP, (j) => mannequinFrames(m.nodes, m.joints)[j]);
    const F = framesAt(m, pickUpNodes(m), 0.7);
    const a = r.solve((j) => F[j].rot);
    const r2 = prepareRetarget(knightRig(), KAYKIT_RETARGET_MAP, (j) => mannequinFrames(m.nodes, m.joints)[j]);
    const b = r2.solve((j) => F[j].rot);
    expect(b).toEqual(a);
    const out: Quat[] = [];
    expect(r.solve((j) => F[j].rot, out)).toBe(out);
    expect(out).toEqual(a);
  });

  it('rejects bad maps', () => {
    const m = jointedMannequin();
    const F = mannequinFrames(m.nodes, m.joints);
    const rest = (j: string) => F[j];
    expect(() => prepareRetarget(knightRig(), [{ joint: 'hips', bone: 'pelvis' }], rest)).toThrow(/unknown rig bone "pelvis"/);
    expect(() =>
      prepareRetarget(knightRig(), [{ joint: 'hips', bone: 'hips' }, { joint: 'spine', bone: 'hips' }], rest),
    ).toThrow(/mapped twice/);
    expect(() => prepareRetarget(knightRig(), [{ joint: 'hips', bone: 'hips', child: 'head' }], rest)).toThrow(/not mapped/);
  });
});

describe('retarget: KayKit Knight end effectors (uniform scale k, hips anchored)', () => {
  it('measures the hand / foot error against the mannequin pivots', () => {
    const rig = knightRig();
    const m = jointedMannequin(1.78);
    const F0 = mannequinFrames(m.nodes, m.joints);
    const r = prepareRetarget(rig, KAYKIT_RETARGET_MAP, (j) => F0[j]);
    const k = r.legScale!;
    const hips0 = r.rest.pos[r.hipsIndex];
    // Model placed on the root at scale k, offset so the rig hips rest on the mannequin hips rest point.
    const world = (p: Vec3): Vec3 => add(F0.hips.pos, scale(sub(p, hips0), k));
    const cases: [string, PrevisNode[], number][] = [
      ['rest', m.nodes, 0],
      ['crouch 0.4 m', applyMotion(m.nodes, crouch({ mannequin: m, start: 0, end: 1, depth: 0.4, fps: FPS })), 1],
      ['pickUp grab', pickUpNodes(m), 1],
    ];
    const report: Record<string, Record<string, number>> = {};
    for (const [name, nodes, t] of cases) {
      const F = framesAt(m, nodes, t);
      const { pos } = posedRig(r, F, k);
      const P = (n: string) => world(pos[r.indexOf(n)]);
      const e = {
        handL: dist(P('wrist.l'), F.handL.pos),
        handR: dist(P('wrist.r'), F.handR.pos),
        footL: dist(P('foot.l'), F.footL.pos),
        footR: dist(P('foot.r'), F.footR.pos),
        hips: dist(P('hips'), F.hips.pos),
      };
      for (const v of Object.values(e)) expect(Number.isFinite(v)).toBe(true);
      expect(e.hips).toBeLessThan(1e-9);
      report[name] = Object.fromEntries(Object.entries(e).map(([kk, v]) => [kk, Number(v.toFixed(3))]));
    }
    const seg = (a: string, b: string) => k * dist(r.rest.pos[r.indexOf(a)], r.rest.pos[r.indexOf(b)]);
    const proportions = {
      k: Number(k.toFixed(4)),
      armRig: Number((seg('upperarm.l', 'lowerarm.l') + seg('lowerarm.l', 'wrist.l')).toFixed(3)),
      armMannequin: Number((dist(F0.shoulderL.pos, F0.elbowL.pos) + dist(F0.elbowL.pos, F0.handL.pos)).toFixed(3)),
      thighShinRig: Number((seg('upperleg.l', 'lowerleg.l') / seg('lowerleg.l', 'foot.l')).toFixed(3)),
      thighShinMannequin: Number((dist(F0.hipL.pos, F0.kneeL.pos) / dist(F0.kneeL.pos, F0.footL.pos)).toFixed(3)),
      hipsToShoulderRig: Number((k * (r.rest.pos[r.indexOf('upperarm.l')][1] - hips0[1])).toFixed(3)),
      hipsToShoulderMannequin: Number((F0.shoulderL.pos[1] - F0.hips.pos[1]).toFixed(3)),
      hipHalfWidthRig: Number((k * r.rest.pos[r.indexOf('upperleg.l')][0]).toFixed(3)),
      hipHalfWidthMannequin: Number(F0.hipL.pos[0].toFixed(3)),
    };
    console.log('[retarget] knight end-effector error (m):', JSON.stringify(report), 'proportions:', JSON.stringify(proportions));
  });
});

// ---------------------------------------------------------------------------------------------
// Quaternius Universal Base Characters (UE bone names), Superhero_Male_FullBody.gltf
// ---------------------------------------------------------------------------------------------

/** Rig rest-space point `p` carried rigidly by bone `b` (posed rot / pos) from its rest frame. */
function carried(r: Retargeter, pose: { rot: Quat[]; pos: Vec3[] }, b: number, p: Vec3): Vec3 {
  const local = quatRotate(qconj(r.rest.rot[b]), sub(p, r.rest.pos[b]));
  return add(pose.pos[b], quatRotate(pose.rot[b], local));
}

/**
 * Hand / foot errors of the rig against the mannequin pivots, the rig drawn at uniform scale k with its pelvis on the
 * mannequin hips (as the player places it), plus the sole clearance: the lowest of 3 sole points (ground under the
 * ankle, under the ball, under the toe tip at rest) carried by the foot bone, world y (negative = below the floor).
 */
function ueEffectors(r: Retargeter, F0: Record<string, MannequinJointFrame>, F: Record<string, MannequinJointFrame>, k: number, ik = false) {
  let pos: Vec3[];
  let rot: Quat[];
  let limbs: RetargetLimbResult[] = [];
  if (ik) {
    const pose = r.solvePose((j) => F[j], k);
    const hipsT = r.hipsTranslation(F.hips.pos, k);
    ({ pos, rot } = r.fk(pose.local, (i) => (i === r.hipsIndex ? hipsT : undefined)));
    limbs = pose.limbs;
  } else ({ pos, rot } = posedRig(r, F, k));
  const hips0 = r.rest.pos[r.hipsIndex];
  const world = (p: Vec3): Vec3 => add(F0.hips.pos, scale(sub(p, hips0), k));
  const P = (n: string) => world(pos[r.indexOf(n)]);
  const ankle = (g: string, j: string) => add(F[j].pos, [0, k * r.rest.pos[r.indexOf(`foot_${g}`)][1], 0]);
  const sole = (g: string) => {
    const fi = r.indexOf(`foot_${g}`);
    const f0 = r.rest.pos[fi];
    const b0 = r.rest.pos[r.indexOf(`ball_${g}`)];
    const t0 = r.rest.pos[r.indexOf(`ball_leaf_${g}`)];
    const pts: Vec3[] = [[f0[0], 0, f0[2]], [b0[0], 0, b0[2]], [t0[0], 0, t0[2]]];
    return Math.min(...pts.map((p) => world(carried(r, { pos, rot }, fi, p))[1]));
  };
  return {
    handL: dist(P('hand_l'), F.handL.pos),
    handR: dist(P('hand_r'), F.handR.pos),
    /** ankle bone vs the mannequin foot pivot lifted by the rig's ankle height (the IK goal) */
    footL: dist(P('foot_l'), ankle('l', 'footL')),
    footR: dist(P('foot_r'), ankle('r', 'footR')),
    soleL: sole('l'),
    soleR: sole('r'),
    hips: dist(P('pelvis'), F.hips.pos),
    unreached: limbs.filter((l) => !l.reached).length,
    miss: Math.max(0, ...limbs.map((l) => l.miss)),
    missL: limbs.find((l) => l.joint === 'handL')?.miss ?? 0,
    missR: limbs.find((l) => l.joint === 'handR')?.miss ?? 0,
  };
}

describe('retarget: Quaternius (UE names) rig', () => {
  const ueRig = () => {
    const m = jointedMannequin(1.78);
    const F0 = mannequinFrames(m.nodes, m.joints);
    return { m, F0, r: prepareRetarget(quaterniusRig(), UE_RETARGET_MAP, (j) => F0[j]) };
  };

  it('fixture rest FK: y up, faces +z, left arm at +x (T-pose), ankles 0.0865 above the ground', () => {
    const { r } = ueRig();
    const P = (n: string) => r.rest.pos[r.indexOf(n)];
    expect(QUATERNIUS_ROWS).toHaveLength(69);
    expect(P('pelvis')[1]).toBeCloseTo(0.9491, 4);
    expect(P('Head')[1]).toBeCloseTo(1.5998, 4);
    expect(P('upperarm_l')[0]).toBeGreaterThan(0.2);
    expect(P('upperarm_r')[0]).toBeLessThan(-0.2);
    expect(unit(sub(P('hand_l'), P('lowerarm_l')))[0]).toBeGreaterThan(0.99);
    expect(P('ball_leaf_l')[2]).toBeGreaterThan(P('foot_l')[2] + 0.2); // toes forward (+z)
    expect(P('foot_l')[1]).toBeCloseTo(0.0865, 4);
    // the leg scale k: mannequin hip -> ankle over rig thigh -> foot
    expect(r.legScale).toBeCloseTo(0.854 / 0.8876, 3);
  });

  it('unmapped bones (spine_02/03, neck, clavicles, fingers, ball, root, meshes) keep rest local; torso and arms follow', () => {
    const { m, r } = ueRig();
    const rig = quaterniusRig();
    const F = framesAt(m, pickUpNodes(m), 0.8);
    const local = r.solve((j) => F[j].rot);
    const mapped = new Set(UE_RETARGET_MAP.map((e) => e.bone));
    expect(mapped.size).toBe(UE_RETARGET_MAP.length);
    let n = 0;
    rig.names.forEach((name, i) => {
      if (mapped.has(name)) return;
      n++;
      expect(qdist(local[i], rig.restLocal[i].r), name).toBeLessThan(1e-9);
    });
    expect(n).toBe(69 - 15);
  });

  it('chain consistency: arm, hand and leg bone directions equal the mannequin segment directions', () => {
    const { m, r } = ueRig();
    const nodes = applyMotion(pickUpNodes(m), lookAt({ joints: m.joints, start: 0, end: 1, yaw: 0.6 }));
    for (const t of [0, 0.4, 1, 1.5]) {
      const F = framesAt(m, nodes, t);
      const { pos, rot } = posedRig(r, F, r.legScale!);
      const P = (n: string) => pos[r.indexOf(n)];
      for (const s of SIDES) {
        const g = lower(s);
        const pairs: [string, string, Vec3][] = [
          [`upperarm_${g}`, `lowerarm_${g}`, sub(F[`elbow${s}`].pos, F[`shoulder${s}`].pos)],
          [`lowerarm_${g}`, `hand_${g}`, sub(F[`hand${s}`].pos, F[`elbow${s}`].pos)],
          [`hand_${g}`, `middle_01_${g}`, sub(F[`hand${s}`].pos, F[`elbow${s}`].pos)],
          [`thigh_${g}`, `calf_${g}`, sub(F[`knee${s}`].pos, F[`hip${s}`].pos)],
          [`calf_${g}`, `foot_${g}`, sub(F[`foot${s}`].pos, F[`knee${s}`].pos)],
        ];
        // The Quaternius file's node scales differ from 1 by up to 2e-6 (thigh z): directions within 1e-5
        for (const [b, c, md] of pairs) expect(dist(unit(sub(P(c), P(b))), unit(md)), `${b} t=${t}`).toBeLessThan(1e-5);
      }
      // head: its rotation change from the rig at the mannequin's rest pose (A_b applied) is the mannequin head's
      const ih = r.indexOf('Head');
      const F0 = mannequinFrames(m.nodes, m.joints);
      const aligned = posedRig(r, F0, r.legScale!).rot[ih];
      expect(qdist(qmul(rot[ih], qconj(aligned)), qmul(F.head.rot, qconj(F0.head.rot)))).toBeLessThan(1e-9);
    }
  });

  it('measures hand / foot errors, sole clearance and unreachable goals: FK only vs IK + planted feet (rest, crouch, pickUp, walk)', () => {
    const { m, F0, r } = ueRig();
    // Rest height of the rig: the head top is not a bone; the file's rest bounds are 1.82 m tall (y), min y = 0
    const RIG_HEIGHT = 1.82;
    const kLeg = r.legScale!;
    const kHeight = 1.78 / RIG_HEIGHT;
    const frames = (a: number, b: number) => Array.from({ length: Math.round((b - a) * FPS) + 1 }, (_, i) => a + i / FPS);
    const cases: [string, PrevisNode[], number[]][] = [
      ['rest', m.nodes, [0]],
      ['crouch 0.4 m', applyMotion(m.nodes, crouch({ mannequin: m, start: 0, end: 1, depth: 0.4, fps: FPS })), frames(0, 1)],
      ['pickUp (grab t=1)', pickUpNodes(m), frames(0, 2)],
      ['pickUp grab only', pickUpNodes(m), [1]],
      ['walk', applyMotion(m.nodes, walk({ joints: m.joints, from: [0, 0, 0], to: [0, 0, 2], start: 0, end: 1.5, stepsPerSecond: 2.4 })), frames(0, 1.5)],
    ];
    const report: Record<string, Record<string, Record<string, number>>> = {};
    for (const [kn, k, ik] of [['FK kLeg', kLeg, false], ['FK kHeight', kHeight, false], ['IK kLeg', kLeg, true]] as const) {
      const key = `${kn}=${k.toFixed(4)}`;
      report[key] = {};
      for (const [name, nodes, times] of cases) {
        const agg = { hand: 0, foot: 0, sole: Infinity, unreachedFrames: 0, maxMiss: 0, frames: times.length };
        for (const t of times) {
          const e = ueEffectors(r, F0, framesAt(m, nodes, t), k, ik);
          for (const v of Object.values(e)) expect(Number.isFinite(v)).toBe(true);
          expect(e.hips).toBeLessThan(1e-9);
          agg.hand = Math.max(agg.hand, e.handL, e.handR);
          agg.foot = Math.max(agg.foot, e.footL, e.footR);
          agg.sole = Math.min(agg.sole, e.soleL, e.soleR);
          if (e.unreached > 0) agg.unreachedFrames++;
          agg.maxMiss = Math.max(agg.maxMiss, e.miss);
          if (ik) {
            // the hand bone ends at its goal up to the reported miss; the ankle exactly (legs reach)
            expect(Math.abs(e.handL - e.missL), `${name} t=${t} handL`).toBeLessThan(1e-6);
            expect(Math.abs(e.handR - e.missR), `${name} t=${t} handR`).toBeLessThan(1e-6);
            // 1e-6: the file's thigh scale z = 1.000002 is ignored by the rotation transfer
            expect(Math.max(e.footL, e.footR), `${name} t=${t}`).toBeLessThan(1e-6);
          }
        }
        report[key][name] = Object.fromEntries(Object.entries(agg).map(([kk, v]) => [kk, Number(v.toFixed(3))]));
      }
    }
    const seg = (a: string, b: string) => kLeg * dist(r.rest.pos[r.indexOf(a)], r.rest.pos[r.indexOf(b)]);
    const hips0 = r.rest.pos[r.hipsIndex];
    const proportions = {
      armRig: Number((seg('upperarm_l', 'lowerarm_l') + seg('lowerarm_l', 'hand_l')).toFixed(3)),
      armMannequin: Number((dist(F0.shoulderL.pos, F0.elbowL.pos) + dist(F0.elbowL.pos, F0.handL.pos)).toFixed(3)),
      hipsToShoulderRig: Number((kLeg * (r.rest.pos[r.indexOf('upperarm_l')][1] - hips0[1])).toFixed(3)),
      hipsToShoulderMannequin: Number((F0.shoulderL.pos[1] - F0.hips.pos[1]).toFixed(3)),
      shoulderHalfWidthRig: Number((kLeg * r.rest.pos[r.indexOf('upperarm_l')][0]).toFixed(3)),
      shoulderHalfWidthMannequin: Number(F0.shoulderL.pos[0].toFixed(3)),
      hipJointBelowHipsRig: Number((kLeg * (hips0[1] - r.rest.pos[r.indexOf('thigh_l')][1])).toFixed(3)),
      hipJointBelowHipsMannequin: Number((F0.hips.pos[1] - F0.hipL.pos[1]).toFixed(3)),
      hipHalfWidthRig: Number((kLeg * r.rest.pos[r.indexOf('thigh_l')][0]).toFixed(3)),
      hipHalfWidthMannequin: Number(F0.hipL.pos[0].toFixed(3)),
      ankleHeightRig: Number((kLeg * r.rest.pos[r.indexOf('foot_l')][1]).toFixed(3)),
    };
    console.log('[retarget] quaternius end effectors (m):', JSON.stringify(report, null, 1), 'proportions:', JSON.stringify(proportions));
  });
});

describe('retarget: rigFromWorldMatrices', () => {
  it('recovers the rest local TRS of the Quaternius and Knight rigs from their world matrices', () => {
    for (const rig of [quaterniusRig(), knightRig()]) {
      // world matrices (column-major) by composing T * R * S down the hierarchy, scale included
      const W: number[][] = [];
      const mat = (t: Vec3, q: Quat, s: Vec3): number[] => {
        const [x, y, z, w] = q;
        const r = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)];
        return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, t[0], t[1], t[2], 1];
      };
      const mul = (a: number[], b: number[]) => {
        const o = new Array(16).fill(0);
        for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
        return o;
      };
      rig.restLocal.forEach((l, i) => {
        const m = mat(l.t, qn(l.r), l.s);
        W[i] = rig.parents[i] < 0 ? m : mul(W[rig.parents[i]], m);
      });
      const back = rigFromWorldMatrices(rig.names, rig.parents, (i) => W[i]);
      back.restLocal.forEach((l, i) => {
        expect(dist(l.t, rig.restLocal[i].t), rig.names[i]).toBeLessThan(1e-9);
        expect(qdist(l.r, rig.restLocal[i].r), rig.names[i]).toBeLessThan(1e-7);
        expect(dist(l.s, rig.restLocal[i].s), rig.names[i]).toBeLessThan(1e-9);
      });
    }
  });
});

describe('retarget: solvePose (two-bone IK, planted feet)', () => {
  it('a rig with the mannequin proportions: IK reaches every goal and keeps the FK joint positions', () => {
    const m = jointedMannequin(1.78);
    const r = prepareRetarget(tPoseRig(m), KAYKIT_RETARGET_MAP, (j) => mannequinFrames(m.nodes, m.joints)[j]);
    for (const [nodes, t] of [[pickUpNodes(m), 1], [applyMotion(m.nodes, crouch({ mannequin: m, start: 0, end: 1, depth: 0.5, fps: FPS })), 1]] as const) {
      const F = framesAt(m, nodes, t);
      const pose = r.solvePose((j) => F[j], 1, { plant: false });
      expect(pose.limbs.map((l) => l.joint)).toEqual(['handL', 'handR', 'footL', 'footR']);
      for (const l of pose.limbs) expect(l.reached && l.miss < 1e-9, l.joint).toBe(true);
      const { pos } = r.fk(pose.local, (i) => (i === r.hipsIndex ? r.hipsTranslation(F.hips.pos, 1) : undefined));
      for (const [b, j] of [['lowerarm.r', 'elbowR'], ['wrist.r', 'handR'], ['lowerleg.l', 'kneeL'], ['foot.l', 'footL']]) {
        expect(dist(pos[r.indexOf(b)], F[j].pos), b).toBeLessThan(1e-9);
      }
    }
  });

  it('Quaternius: planted feet are level (rest world rotation) on the ground, follow the shin above PLANT_HIGH, blend between', () => {
    const m = jointedMannequin(1.78);
    const F0 = mannequinFrames(m.nodes, m.joints);
    const r = prepareRetarget(quaterniusRig(), UE_RETARGET_MAP, (j) => F0[j]);
    const k = r.legScale!;
    const fi = r.indexOf('foot_l');
    const crouched = framesAt(m, applyMotion(m.nodes, crouch({ mannequin: m, start: 0, end: 1, depth: 0.4, fps: FPS })), 1);
    const p1 = r.solvePose((j) => crouched[j], k);
    expect(p1.limbs.find((l) => l.joint === 'footL')!.plant).toBe(1);
    expect(qdist(r.fk(p1.local).rot[fi], r.rest.rot[fi])).toBeLessThan(1e-9);
    // a root yaw keeps the foot level in world: same root-frame rotation
    const yawed = r.solvePose((j) => crouched[j], k, { root: { q: [0, Math.sin(0.4), 0, Math.cos(0.4)], p: [3, 0, -1] } });
    expect(qdist(r.fk(yawed.local).rot[fi], r.rest.rot[fi])).toBeLessThan(1e-9);
    // lifted by the root (a jump): the foot follows the shin (FK world rotation)
    const high = r.solvePose((j) => crouched[j], k, { root: { q: [0, 0, 0, 1], p: [0, PLANT_HIGH, 0] } });
    const fkOnly = r.solvePose((j) => crouched[j], k, { plant: false });
    expect(high.limbs.find((l) => l.joint === 'footL')!.plant).toBe(0);
    expect(qdist(r.fk(high.local).rot[fi], r.fk(fkOnly.local).rot[fi])).toBeLessThan(1e-9);
    const mid = r.solvePose((j) => crouched[j], k, { root: { q: [0, 0, 0, 1], p: [0, (PLANT_LOW + PLANT_HIGH) / 2, 0] } });
    expect(mid.limbs.find((l) => l.joint === 'footL')!.plant).toBeCloseTo(0.5, 12);
  });

  it('is deterministic; ik: false and plant: false give solve()', () => {
    const m = jointedMannequin(1.78);
    const F0 = mannequinFrames(m.nodes, m.joints);
    const r = prepareRetarget(quaterniusRig(), UE_RETARGET_MAP, (j) => F0[j]);
    const F = framesAt(m, pickUpNodes(m), 0.7);
    expect(r.solvePose((j) => F[j], r.legScale!)).toEqual(r.solvePose((j) => F[j], r.legScale!));
    expect(r.solvePose((j) => F[j], r.legScale!, { ik: false, plant: false }).local).toEqual(r.solve((j) => F[j].rot));
  });
});
