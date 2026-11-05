// 불씨지기 S07 쓰러지는 거인 (The Giant Falls), 40 s. Run from web/: node --experimental-strip-types previs/examples/film/s07-fall.gen.ts
// Starts in S06's end state (Haon hidden behind the pillar, the warden facing it). The warden chops again: the axe
// smashes the pillar, which topples (pivot on its base edge, accelerating fall) and crashes flat; Haon bolts out across
// the open floor, turns, charges; the warden sweeps a slice at her, she leaps over the fallen pillar to its legs and
// slashes; the giant staggers, turns, drops forward and crashes (its axe flies out of its hand onto the floor). Silence:
// she lowers her sword and lets it fall, turns to the far altar and walks off east (screen left -> right) while the
// camera cranes up and back over the fallen giant. Shared layout / props / FK: ./s06s07-set.ts.
import { applyMotion, crouch, eulerYXZToQuat, evaluateFrame, quatToEulerYXZ, walk, worldTransform } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisMarker, PrevisNode, Quat, Shot, Track, Vec3 } from '../../../src/previs/index.ts';
import { AVOID, BG, FPS, ROLES, SIZE, add, character, flatOnly, frameTimes, lerp, lerp3, r4, sample, scale, sub, writeDoc, yawTo } from './common.ts';
import {
  ALTAR, AXE_OFF, AXE_S, CHEST_BACK, E_FALL, HERE, H_SPOT, P, PILLAR_SIZE, SWORD_SIZE, SWORD_TEX_IN_HAND, SWORD_TEX_SIZE, U, W1, WY, YAW_HIDE, YAW_PILLAR,
  axeNode, axeWorldVerts, boxCorners, breathe, carryLeft, compose, dist2, eulerNear, fwd, haonProps, lowestCorner, qconj, qmul, qrot, qslerp,
  r6v, smashFrame, smooth01, stripWalk, swordTexFromBox, unit2, vaultLighting, vaultSet, wardenLockDy, wardenNode, wardenWorldAt,
} from './s06s07-set.ts';
import type { Pose, Seg } from './s06s07-set.ts';

const DUR = 40;
const E = E_FALL; // the pillar falls this way (the warden's right at W1)
/** World point at `a` m along the fallen pillar's axis (from P, direction E) and `c` m across it (direction U). */
const at = (a: number, c: number): Vec3 => [P[0] + a * E[0] + c * U[0], 0, P[2] + a * E[2] + c * U[2]];
const alongOf = (p: Vec3) => (p[0] - P[0]) * E[0] + (p[2] - P[2]) * E[2];
const acrossOf = (p: Vec3) => (p[0] - P[0]) * U[0] + (p[2] - P[2]) * U[2];
const right = (yaw: number): Vec3 => [-Math.cos(yaw), 0, Math.sin(yaw)];
const ID: Quat = [0, 0, 0, 1];

// ---------------------------------------------------------------- timeline
const T_C = 3.4; // second chop starts
const CHOP_SPEED = 0.9;
const O_SPOT = at(-1.0, 3.4); // out in the open, away from the falling pillar
const R_SPOT = at(2.3, 1.5); // take-off, beside the fallen pillar near its base end
const T_CH0 = 8.0; // charge
const RUN_V = 3.4;
const T_LOAD = r4(T_CH0 + dist2(O_SPOT, R_SPOT) / RUN_V);
const T_PUSH = r4(T_LOAD + 0.22);
const T_TAKE = r4(T_PUSH + 0.05);
const T_TUCK = r4(T_PUSH + 0.15);
const AIR = 1.0;
const T_LAND = r4(T_TAKE + AIR);
const T_ABSORB = r4(T_LAND + 0.15);
const T_SETTLE = r4(T_LAND + 0.8);
const JUMP_H = 2.3;
const T_S = r4(T_TAKE - 0.8); // slice: the sweep passes (clip 0.3-0.6) while she closes in; it has swung back by her landing
const YAW_SLICE = yawTo(W1, R_SPOT);
// lands in front of its right leg; the 2H idle holds the axe on its left, and the axe is gone before the hit poses
const L_SPOT: Vec3 = add(add([W1[0], 0, W1[2]], scale(fwd(YAW_SLICE), 1.2)), scale(right(YAW_SLICE), 0.6));
const T_HITA = r4(T_LAND + 0.1);
const T_HITB = r4(T_LAND + 0.75);
const T_DEATH = r4(T_LAND + 1.6);
const YAW_FALL = YAW_SLICE + 1.9; // staggers round to its left: she ends up behind its right shoulder
const T_CRASH = r4(T_DEATH + 1.75); // Death_B: body hits the floor at clip ~1.75
const T_REL = T_HITA; // its leg is cut: the grip opens and the axe drops away to its left
const T_BACK0 = r4(T_SETTLE + 0.6);
const T_BACK1 = r4(T_BACK0 + 0.55);
const T_LOWER0 = 17.2;
const T_LOWER1 = 18.3;
const T_SNAP = 21.2; // textured sword back on the mannequin hand pivot (hand hanging, the pop is ~2 cm)
const T_DROP = 21.6;
const T_LOOK = 23.0;
const T_TURN0 = 23.7;
const T_WALK0 = 24.5;

// ---------------------------------------------------------------- warden
const segs: Seg[] = [
  { clip: '2H_Melee_Idle', loop: 'repeat' },
  { clip: '2H_Melee_Attack_Chop', start: T_C, speed: CHOP_SPEED, loop: 'once', blendIn: 0.25 },
  // placeholder start; replaced below once the contact time is known
  { clip: '2H_Melee_Idle', start: 99, loop: 'repeat', blendIn: 0.4 },
  { clip: '2H_Melee_Attack_Slice', start: T_S, speed: 1, loop: 'once', blendIn: 0.25 },
  { clip: '2H_Melee_Idle', start: r4(T_S + 1.05), loop: 'repeat', blendIn: 0.3 },
  { clip: 'Hit_A', start: T_HITA, loop: 'once', blendIn: 0.1 },
  { clip: 'Hit_B', start: T_HITB, loop: 'once', blendIn: 0.15 },
  { clip: 'Death_B', start: T_DEATH, loop: 'once', blendIn: 0.25 },
];
const CHEST_PRE: Track<Vec3> = [
  { t: r4(T_C + 0.7 / CHOP_SPEED), v: [0, 0, 0], ease: 'ease-in-out' },
  { t: r4(T_C + 0.86 / CHOP_SPEED), v: [CHEST_BACK * 1.6, 0, 0] },
];
// contact: the first time any axe vertex enters the standing pillar (vertical cylinder r 0.7 about P, below 6 m)
let T_HIT = 0;
{
  for (const t of frameTimes(r4(T_C + 0.5), r4(T_C + 1.2 / CHOP_SPEED))) {
    const slot = wardenWorldAt(W1, YAW_PILLAR, segs.slice(0, 2), t, 'handslot.r', { chest: evalV(CHEST_PRE, t, [0, 0, 0]) });
    if (axeWorldVerts(slot).some((v) => v[1] < 6 && Math.hypot(v[0] - P[0], v[2] - P[2]) < 0.7)) { T_HIT = t; break; }
  }
  if (!T_HIT) throw new Error('the chop never reaches the pillar');
  segs[2].start = r4(T_HIT + 0.22);
}
const yawWarden: Track<Vec3> = [
  { t: r4(T_HIT + 0.7), v: [0, YAW_PILLAR, 0], ease: 'ease-in-out' },
  { t: r4(T_HIT + 2.0), v: [0, yawTo(W1, O_SPOT), 0] },
  { t: r4(T_CH0 - 0.2), v: [0, yawTo(W1, O_SPOT), 0], ease: 'ease-in-out' },
  { t: T_S, v: [0, YAW_SLICE, 0] },
  { t: r4(T_HITB + 0.05), v: [0, YAW_SLICE, 0], ease: 'ease-in-out' },
  { t: r4(T_DEATH + 0.1), v: [0, YAW_FALL, 0] },
];
const yawAt = (t: number): number => {
  const k = yawWarden;
  if (t <= k[0].t) return k[0].v[1];
  for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1].t) {
    const u = (t - k[i].t) / (k[i + 1].t - k[i].t);
    return lerp(k[i].v[1], k[i + 1].v[1], k[i].ease === 'ease-in-out' ? smooth01(u) : u);
  }
  return k[k.length - 1].v[1];
};
// chest leans back through the follow-through (as in S06): after the pillar the axe head stops on the floor, not in it
const CHEST: Track<Vec3> = [
  { t: r4(T_C + 0.7 / CHOP_SPEED), v: [0, 0, 0], ease: 'ease-in-out' },
  { t: r4(T_C + 0.86 / CHOP_SPEED), v: [CHEST_BACK * 1.6, 0, 0] },
  { t: r4(T_C + 1.25 / CHOP_SPEED), v: [CHEST_BACK * 1.6, 0, 0], ease: 'ease-in-out' },
  { t: r4(T_C + 1.6 / CHOP_SPEED), v: [0, 0, 0] },
];
const offAt = (t: number) => ({ chest: evalV(CHEST, t, [0, 0, 0]) });
const warden = wardenNode('warden', W1, YAW_PILLAR, segs, { rotation: yawWarden, joints: { chest: CHEST } });
const axe = axeNode('axe', 'warden');

// ---------------------------------------------------------------- pillar topple (pivot on the base edge toward E)
const TOPPLE = 1.15;
const T_PLAND = r4(T_HIT + TOPPLE);
const pf = smashFrame(E);
{
  const rot: Track<Vec3> = frameTimes(T_HIT, T_PLAND).map((t) => {
    const u = (t - T_HIT) / TOPPLE;
    return { t, v: [0, pf.yaw, -(Math.PI / 2) * u * u] as Vec3 };
  });
  rot.push({ t: r4(T_PLAND + 0.1), v: [0, pf.yaw, -Math.PI / 2 + 0.05], ease: 'ease-in' });
  rot.push({ t: r4(T_PLAND + 0.2), v: [0, pf.yaw, -Math.PI / 2] });
  pillarTrack = rot;
}
var pillarTrack: Track<Vec3>;
// how deep does the axe cut into the moving pillar after contact (pivot frame: x in [-1.5, 0], y in [0, 6], |z| <= 0.75)?
{
  const qPiv = (t: number) => eulerYXZToQuat(evalV(pillarTrack, t, [0, pf.yaw, 0]));
  let worst = 0;
  let at0 = 0;
  for (const t of frameTimes(T_HIT, r4(T_HIT + 0.6))) {
    const q = qconj(qPiv(t));
    const verts = axeWorldVerts(wardenWorldAt(W1, yawAt(t), segs, t, 'handslot.r', offAt(t)));
    for (const v of verts) {
      const l = qrot(q, sub(v, pf.pivot));
      if (l[0] > -1.5 && l[0] < 0 && l[1] > 0 && l[1] < 6 && Math.abs(l[2]) < 0.6) {
        const d = Math.min(-l[0], l[0] + 1.5, 0.6 - Math.abs(l[2]));
        if (d > worst) [worst, at0] = [d, t];
      }
    }
  }
  console.log('chop on the pillar: contact', T_HIT, '| deepest axe cut into the pillar', worst.toFixed(3), 'm at', at0);
}
function evalV(tr: Track<Vec3>, t: number, rest: Vec3): Vec3 {
  if (!tr.length) return rest;
  if (t <= tr[0].t) return tr[0].v;
  for (let i = 0; i < tr.length - 1; i++) if (t <= tr[i + 1].t) {
    const u = (t - tr[i].t) / (tr[i + 1].t - tr[i].t);
    const e = tr[i].ease === 'ease-in' ? u * u : tr[i].ease === 'ease-out' ? 1 - (1 - u) * (1 - u) : tr[i].ease === 'ease-in-out' ? smooth01(u) : u;
    return lerp3(tr[i].v, tr[i + 1].v, e);
  }
  return tr[tr.length - 1].v;
}

// ---------------------------------------------------------------- Haon
const haon = character('haon', H_SPOT, YAW_HIDE);
const j = haon.j as unknown as Parameters<typeof stripWalk>[1];
const T_BOLT = r4(T_HIT - 0.25);
const T_O = r4(T_BOLT + dist2(H_SPOT, O_SPOT) / 3.0);
const L2: Vec3 = add(L_SPOT, scale(unit2(sub(L_SPOT, W1)), 0.6)); // half a step back from the falling giant
const A_SPOT: Vec3 = [-6.3, 0, 0.3]; // round the giant's feet
const B_SPOT: Vec3 = [5.6, 0, 0.1]; // walking on toward the altar (east)
const T_A = r4(T_WALK0 + dist2(L2, A_SPOT) / 0.95);
const frags: MotionFragments[] = [carryLeft(j, DUR)];
frags.push(breathe(j, 0, T_BOLT, 0.014, 1.3));
const bolt = stripWalk(walk({ joints: haon.j, from: H_SPOT, to: O_SPOT, start: T_BOLT, end: T_O, stepsPerSecond: 4.4 }), j);
bolt[j.root].position![0].ease = 'ease-in';
bolt[j.root].position![1].ease = undefined;
frags.push(bolt);
frags.push(breathe(j, r4(T_O + 0.05), T_CH0, 0.016, 1.1));
const charge = stripWalk(walk({ joints: haon.j, from: O_SPOT, to: R_SPOT, start: T_CH0, end: T_LOAD, stepsPerSecond: 4.6 }), j);
delete charge[j.shoulderR!];
charge[j.root].position![0].ease = 'ease-in';
frags.push(charge);
// jump (gate-raid recipe): load crouch, push-off, tuck in the air, absorb, settle, stand
const LOAD_D = 0.3;
const ABSORB_D = 0.4;
const SETTLE_D = 0.1;
frags.push(crouch({ mannequin: haon.m, start: T_LOAD, end: T_PUSH, depth: LOAD_D, fps: FPS }));
frags.push(crouch({ mannequin: haon.m, start: T_PUSH, end: T_TUCK, from: LOAD_D, depth: 0, fps: FPS }));
const tuck = (hip: number, knee: number) => ({
  hip: [
    { t: T_TUCK, v: [0, 0, 0] as Vec3, ease: 'ease-out' as const },
    { t: r4(T_TUCK + 0.25), v: [hip, 0, 0] as Vec3 },
    { t: r4(T_LAND - 0.25), v: [hip, 0, 0] as Vec3, ease: 'ease-in' as const },
    { t: T_LAND, v: [0, 0, 0] as Vec3 },
  ],
  knee: [
    { t: T_TUCK, v: [0, 0, 0] as Vec3, ease: 'ease-out' as const },
    { t: r4(T_TUCK + 0.25), v: [knee, 0, 0] as Vec3 },
    { t: r4(T_LAND - 0.25), v: [knee, 0, 0] as Vec3, ease: 'ease-in' as const },
    { t: T_LAND, v: [0, 0, 0] as Vec3 },
  ],
});
const tL = tuck(-1.2, 1.6);
const tR = tuck(-1.0, 1.5);
frags.push({ [j.hipL!]: { rotation: tL.hip }, [j.kneeL!]: { rotation: tL.knee }, [j.hipR!]: { rotation: tR.hip }, [j.kneeR!]: { rotation: tR.knee } });
frags.push(crouch({ mannequin: haon.m, start: T_LAND, end: T_ABSORB, depth: ABSORB_D, fps: FPS }));
frags.push(crouch({ mannequin: haon.m, start: T_ABSORB, end: T_SETTLE, from: ABSORB_D, depth: SETTLE_D, fps: FPS }));
frags.push(crouch({ mannequin: haon.m, start: r4(T_SETTLE + 0.05), end: r4(T_BACK0 - 0.05), from: SETTLE_D, depth: 0, fps: FPS }));
frags.push({
  [j.root]: {
    position: frameTimes(T_TAKE, T_LAND).map((t) => {
      const u = (t - T_TAKE) / AIR;
      return { t, v: [lerp(R_SPOT[0], L_SPOT[0], u), 4 * JUMP_H * u * (1 - u), lerp(R_SPOT[2], L_SPOT[2], u)] as Vec3 };
    }),
  },
});
const back = stripWalk(walk({ joints: haon.j, from: L_SPOT, to: L2, start: T_BACK0, end: T_BACK1, stepsPerSecond: 3.5 }), j);
delete back[j.shoulderR!];
frags.push(back);
frags.push(breathe(j, r4(T_BACK1 + 0.05), T_WALK0, 0.018, 1.2));
const w1 = stripWalk(walk({ joints: haon.j, from: L2, to: A_SPOT, start: T_WALK0, end: T_A, stepsPerSecond: 1.7 }), j);
const w2 = stripWalk(walk({ joints: haon.j, from: A_SPOT, to: B_SPOT, start: T_A, end: DUR, stepsPerSecond: 1.7 }), j);
w1[j.root].position![0].ease = 'ease-in';
frags.push(w1, w2);
// root yaw
const yawBolt = yawTo(H_SPOT, O_SPOT);
const yawFaceW = yawTo(O_SPOT, W1);
const yawCharge = yawTo(O_SPOT, R_SPOT);
const yawLeap = yawTo(R_SPOT, L_SPOT);
const yawGiant = yawTo(L2, W1);
const yawA = yawTo(L2, A_SPOT);
const yawB = yawTo(A_SPOT, B_SPOT);
frags.push({
  [j.root]: {
    rotation: [
      { t: 0, v: [0, YAW_HIDE, 0] },
      { t: T_BOLT, v: [0, YAW_HIDE, 0], ease: 'ease-in-out' },
      { t: r4(T_BOLT + 0.25), v: [0, yawBolt, 0] },
      { t: r4(T_O - 0.1), v: [0, yawBolt, 0], ease: 'ease-in-out' },
      { t: r4(T_O + 0.9), v: [0, yawFaceW, 0] },
      { t: r4(T_CH0 - 0.25), v: [0, yawFaceW, 0], ease: 'ease-in-out' },
      { t: r4(T_CH0 + 0.1), v: [0, yawCharge, 0] },
      { t: r4(T_LOAD - 0.15), v: [0, yawCharge, 0], ease: 'ease-in-out' },
      { t: T_PUSH, v: [0, yawLeap, 0] },
      { t: r4(T_LAND + 0.1), v: [0, yawLeap, 0], ease: 'ease-in-out' },
      { t: T_SETTLE, v: [0, yawTo(L_SPOT, W1), 0] },
      { t: r4(T_DEATH + 0.3), v: [0, yawTo(L_SPOT, W1), 0], ease: 'ease-in-out' },
      { t: r4(T_DEATH + 1.6), v: [0, yawGiant, 0] },
      { t: T_TURN0, v: [0, yawGiant, 0], ease: 'ease-in-out' },
      { t: T_WALK0, v: [0, yawA, 0] },
      { t: r4(T_A - 0.3), v: [0, yawA, 0], ease: 'ease-in-out' },
      { t: r4(T_A + 0.5), v: [0, yawB, 0] },
    ],
  },
});
// head
const headToAltar = Math.max(-1.2, Math.min(1.2, yawTo(L2, ALTAR) - yawGiant));
frags.push({
  [j.head]: {
    rotation: [
      { t: 0, v: [0, -1.1, 0] },
      { t: r4(T_C - 0.4), v: [0, -1.1, 0], ease: 'ease-in-out' },
      { t: r4(T_C + 0.2), v: [-0.15, -1.25, 0] }, // the axe goes up: she sees it
      { t: T_BOLT, v: [-0.15, -1.25, 0], ease: 'ease-in-out' },
      { t: r4(T_BOLT + 0.3), v: [0, 0, 0] },
      { t: r4(T_O + 0.3), v: [0, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_O + 1.0), v: [-0.2, 0, 0] },
      { t: T_LAND, v: [-0.2, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_LAND + 0.5), v: [-0.35, 0, 0] }, // looks up at the giant
      { t: r4(T_DEATH + 1.0), v: [-0.35, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_CRASH + 0.2), v: [0.25, 0, 0] }, // down at the fallen giant
      { t: T_LOOK, v: [0.25, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_LOOK + 0.8), v: [-0.05, headToAltar, 0] }, // the altar, far east
      { t: T_WALK0, v: [-0.05, headToAltar, 0], ease: 'ease-in-out' },
      { t: r4(T_WALK0 + 0.8), v: [-0.05, 0, 0] },
    ],
  },
});
// sword arm: low through the bolt (walk swing), guard at O, overhead in the leap, slash down onto the leg, lowered after
frags.push({
  [j.shoulderR!]: {
    rotation: [
      { t: r4(T_O + 0.4), v: [0, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_O + 1.1), v: [-0.75, 0, 0.05] },
      { t: r4(T_PUSH - 0.05), v: [-0.75, 0, 0.05], ease: 'ease-in-out' },
      { t: r4(T_TAKE + 0.25), v: [-2.9, 0, 0.05] },
      { t: r4(T_LAND - 0.22), v: [-2.9, 0, 0.05], ease: 'ease-in' },
      { t: r4(T_LAND + 0.06), v: [-0.35, 0, 0.05] },
      { t: T_LOWER0, v: [-0.35, 0, 0.05], ease: 'ease-in-out' },
      { t: T_LOWER1, v: [0, 0, 0] },
    ],
  },
  [j.elbowR!]: {
    rotation: [
      { t: r4(T_O + 0.4), v: [0, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_O + 1.1), v: [-0.2, 0, 0] },
      { t: r4(T_PUSH - 0.05), v: [-0.2, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_TAKE + 0.25), v: [-0.1, 0, 0] },
      { t: r4(T_LAND + 0.06), v: [-0.25, 0, 0] },
      { t: T_LOWER0, v: [-0.25, 0, 0], ease: 'ease-in-out' },
      { t: T_LOWER1, v: [0, 0, 0] },
    ],
  },
});
frags.push({
  [j.spine]: {
    rotation: [
      { t: 0, v: [-0.06, 0, 0] },
      { t: T_BOLT, v: [-0.06, 0, 0], ease: 'ease-out' },
      { t: r4(T_BOLT + 0.25), v: [0.32, 0, 0] },
      { t: r4(T_O - 0.1), v: [0.32, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_O + 0.6), v: [0.12, 0, 0] }, // catching her breath, bent forward a little
      { t: T_CH0, v: [0.12, 0, 0], ease: 'ease-out' },
      { t: r4(T_CH0 + 0.2), v: [0.3, 0, 0] },
      { t: T_LOAD, v: [0.3, 0, 0], ease: 'ease-in-out' },
      { t: T_PUSH, v: [0.4, 0, 0], ease: 'ease-out' },
      { t: r4(T_TAKE + 0.25), v: [-0.15, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_LAND - 0.1), v: [0.1, 0, 0], ease: 'ease-out' },
      { t: T_ABSORB, v: [0.45, 0, 0], ease: 'ease-in-out' },
      { t: T_SETTLE, v: [0.12, 0, 0] },
      { t: r4(T_CRASH + 0.5), v: [0.12, 0, 0], ease: 'ease-in-out' },
      { t: r4(T_CRASH + 2.0), v: [0.04, 0, 0] },
    ],
  },
});
const haonNodes = flatOnly(applyMotion(haon.m.nodes, frags));
const props = haonProps(haon.j.handL, haon.j.handR);

// ---------------------------------------------------------------- probe (world transforms of Haon's pivots)
const probe: PrevisDoc = {
  version: 1, fps: FPS, size: SIZE, background: BG, roles: ROLES, nodes: [...haonNodes, props.sword],
  shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 8] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
};
const wt = (id: string, t: number) => worldTransform(probe, evaluateFrame(probe, t).nodes, id);
const hAt = (t: number) => wt(haon.j.root, t).position;

// ---------------------------------------------------------------- sword drop: released at T_DROP, falls flat beside her right foot
let T_SLAND = 0;
{
  const hand = wt(haon.j.handR, T_DROP);
  const cap: Pose = compose({ p: hand.position, q: hand.quaternion }, { p: (props.sword.position as Vec3), q: eulerYXZToQuat(props.sword.rotation as Vec3) });
  // flat on the floor on its 5 cm edge like a dropped blade: box local x -> world up, blade (local -y) pointing forward-right
  const yawBlade = yawTo(L2, W1) - 0.9;
  const qFlat = qmul(eulerYXZToQuat([0, yawBlade, 0]), eulerYXZToQuat([Math.PI / 2, 0, Math.PI / 2]));
  // lands where its centre falls (straight down, a little forward), lowest point on the floor
  const landP: Vec3 = [cap.p[0] + 0.1 * Math.sin(yawBlade), 0, cap.p[2] + 0.1 * Math.cos(yawBlade)];
  const lowFlat = lowestCorner({ p: [0, 0, 0], q: qFlat }, SWORD_SIZE);
  const lowFlatTex = Math.min(...boxCorners(swordTexFromBox({ p: [0, 0, 0], q: qFlat }), SWORD_TEX_SIZE).map((v) => v[1]));
  landP[1] = -Math.min(lowFlat, lowFlatTex) + 0.004; // the textured model's bounds also clear the floor
  const G = 9.81;
  const fall = Math.sqrt((2 * (cap.p[1] - landP[1])) / G);
  T_SLAND = r4(T_DROP + fall);
  const box: { t: number; pose: Pose }[] = [];
  for (const t of frameTimes(T_DROP, T_SLAND)) {
    const s = t - T_DROP;
    const u = Math.min(1, s / Math.max(0.05, fall - 0.05)); // flat a frame before contact
    box.push({ t, pose: { p: [lerp(cap.p[0], landP[0], s / fall), cap.p[1] - 0.5 * G * s * s, lerp(cap.p[2], landP[2], s / fall)], q: qslerp(cap.q, qFlat, smooth01(u)) } });
  }
  const last = box[box.length - 1].pose;
  last.p = landP;
  for (const [dt, h] of [[0.08, 0.035], [0.16, 0]] as const) box.push({ t: r4(T_SLAND + dt), pose: { p: [landP[0], landP[1] + h, landP[2]], q: qFlat } });
  // delta tracks after the null switch: world = capture * R(track(T_DROP))^-1 * R(track(t)); position adds the delta
  const tracksFor = (local: Pose, poses: { t: number; pose: Pose }[], capture: Pose) => {
    const pos: Track<Vec3> = [];
    const rot: Track<Vec3> = [];
    const r0 = local.q;
    let prev = quatToEulerYXZ(r0);
    for (const k of poses) {
      pos.push({ t: k.t, v: r6v(add(local.p, sub(k.pose.p, capture.p))) });
      prev = eulerNear(qmul(r0, qmul(qconj(capture.q), k.pose.q)), prev);
      rot.push({ t: k.t, v: r6v(prev) });
    }
    return { pos, rot };
  };
  const swordLocal: Pose = { p: props.sword.position as Vec3, q: eulerYXZToQuat(props.sword.rotation as Vec3) };
  const sb = tracksFor(swordLocal, box, cap);
  props.sword.tracks = { parent: [{ t: T_DROP, v: null }], position: sb.pos, rotation: sb.rot };
  const texPoses = box.map((k) => ({ t: k.t, pose: swordTexFromBox(k.pose) }));
  const st = tracksFor(SWORD_TEX_IN_HAND, texPoses, texPoses[0].pose);
  props.swordTex.tracks = {
    parent: [{ t: 0, v: { node: haon.j.handR } }, { t: T_SNAP, v: { node: haon.j.handR, snap: true } }, { t: T_DROP, v: null }],
    position: st.pos,
    rotation: st.rot,
  };
  let low = Infinity;
  for (const k of box) low = Math.min(low, lowestCorner(k.pose, SWORD_SIZE), Math.min(...boxCorners(swordTexFromBox(k.pose), SWORD_TEX_SIZE).map((v) => v[1])));
  console.log('sword drop: from', cap.p.map((v) => +v.toFixed(3)), 'lands', T_SLAND, 'lowest corner', low.toFixed(4));
  if (low < -0.005) throw new Error('the sword goes into the floor');
}

// ---------------------------------------------------------------- axe release: ballistic arc, lands flat beside the fallen giant
let T_ALAND = 0;
{
  const dy = wardenLockDy(segs, T_REL);
  const slot = wardenWorldAt(W1, yawAt(T_REL), segs, T_REL, 'handslot.r', offAt(T_REL), dy);
  const cap: Pose = compose(slot, { p: AXE_OFF, q: ID });
  const fwdF = fwd(YAW_SLICE);
  const rightF = right(YAW_SLICE);
  const land: Vec3 = add(add([W1[0], 0, W1[2]], scale(fwdF, 1.7)), scale(rightF, -2.0));
  // lying flat: axe local z (thickness) up, handle (local y) along the fall direction turned 0.5 rad
  const h = unit2(add(fwdF, scale(rightF, 0.6)));
  const X: Vec3 = [-h[2], 0, h[0]]; // h x up (right-handed basis)
  const qFlat = qFromBasis(X, h, [0, 1, 0]);
  const vertsAt = (pose: Pose) => axeWorldVerts(compose(pose, { p: scale(AXE_OFF, -1), q: ID }));
  const lowFlat = Math.min(...vertsAt({ p: [0, 0, 0], q: qFlat }).map((v) => v[1]));
  land[1] = -lowFlat + 0.008;
  const G = 9.81;
  const vy = 1.2;
  const y0 = cap.p[1] - land[1];
  const tf = (vy + Math.sqrt(vy * vy + 2 * G * y0)) / G;
  T_ALAND = r4(T_REL + tf);
  const poses: { t: number; pose: Pose }[] = [];
  for (const t of frameTimes(T_REL, T_ALAND)) {
    const s = t - T_REL;
    const u = Math.min(1, s / (tf - 0.16));
    poses.push({ t, pose: { p: [lerp(cap.p[0], land[0], s / tf), cap.p[1] + vy * s - 0.5 * G * s * s, lerp(cap.p[2], land[2], s / tf)], q: qslerp(cap.q, qFlat, smooth01(u)) } });
  }
  poses[poses.length - 1].pose.p = land;
  for (const [dt, hh] of [[0.1, 0.06], [0.2, 0]] as const) poses.push({ t: r4(T_ALAND + dt), pose: { p: [land[0], land[1] + hh, land[2]], q: qFlat } });
  const pos: Track<Vec3> = [];
  const rot: Track<Vec3> = [];
  let prev: Vec3 = [0, 0, 0];
  for (const k of poses) {
    pos.push({ t: k.t, v: r6v(add(AXE_OFF, sub(k.pose.p, cap.p))) });
    prev = eulerNear(qmul(qconj(cap.q), k.pose.q), prev);
    rot.push({ t: k.t, v: r6v(prev) });
  }
  axe.tracks = { parent: [{ t: T_REL, v: null }], position: pos, rotation: rot };
  let low = Infinity;
  let lowT = 0;
  for (const k of poses) { const y = Math.min(...vertsAt(k.pose).map((v) => v[1])); if (y < low) [low, lowT] = [y, k.t]; }
  console.log('axe flight lowest', low.toFixed(4), 'at', lowT, 'release', T_REL);
  { // the fallen body (a 2.6 m segment from W1 along the fall direction) must not lie on the axe
    const f2 = fwd(YAW_FALL);
    const rel = sub(land, [W1[0], 0, W1[2]]);
    const a2 = Math.max(0, Math.min(2.6, rel[0] * f2[0] + rel[2] * f2[2]));
    const dBody = dist2(land, add([W1[0], 0, W1[2]], scale(f2, a2)));
    console.log('axe landing to the fallen body line', dBody.toFixed(2), '| to pillar axis', Math.abs(acrossOf(land)).toFixed(2), 'along', alongOf(land).toFixed(2));
    if (dBody < 1.6) throw new Error('the giant falls onto its axe');
  }
  console.log('axe release', JSON.stringify({ at: cap.p.map((v) => +v.toFixed(3)), dy: +dy.toFixed(3), land: land.map((v) => +v.toFixed(3)), T_ALAND, lowest: +low.toFixed(4), toHaon: +dist2(land, L2).toFixed(2) }));
  if (low < -0.01) throw new Error('the axe goes into the floor');
}
function qFromBasis(X: Vec3, Y: Vec3, Z: Vec3): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]; }
  return q;
}

// ---------------------------------------------------------------- checks: the giant's axe never through Haon, she clears the pillar
{
  let minD = Infinity;
  let at0 = 0;
  let lowAxe = Infinity;
  let lowAt = 0;
  for (const t of frameTimes(0, r4(T_REL - 0.02))) {
    const verts = axeWorldVerts(wardenWorldAt(W1, yawAt(t), segs, t, 'handslot.r', offAt(t), wardenLockDy(segs, t, offAt(t))));
    const h = hAt(t);
    for (const v of verts) {
      if (v[1] < h[1] + 1.75 && v[1] > h[1] - 0.05) {
        const d = dist2(v, h);
        if (d < minD) [minD, at0] = [d, t];
      }
      if (v[1] < lowAxe) [lowAxe, lowAt] = [v[1], t];
    }
  }
  if (process.env.DBG) for (let t = T_LAND - 0.3; t < T_DEATH + 1.2; t += 0.1) {
    const yw = yawAt(t);
    const W: Vec3 = [W1[0], 0, W1[2]];
    const loc = (p: Vec3) => { const r = sub(p, W); return [r[0] * right(yw)[0] + r[2] * right(yw)[2], r[0] * fwd(yw)[0] + r[2] * fwd(yw)[2], p[1]].map((x) => +x.toFixed(2)); };
    const verts = axeWorldVerts(wardenWorldAt(W1, yw, segs, t, 'handslot.r', offAt(t), wardenLockDy(segs, t, offAt(t))));
    const h = hAt(t);
    let best = verts[0]; let bd = Infinity;
    for (const v of verts) { const d = dist2(v, h); if (d < bd && v[1] < h[1] + 1.75) [bd, best] = [d, v]; }
    console.log(t.toFixed(2), 'haon', JSON.stringify(loc(h)), 'nearest axe', JSON.stringify(loc(best)), bd.toFixed(2));
  }
  console.log('axe vs Haon: min horizontal distance', minD.toFixed(3), 'at', at0, '| lowest axe vertex while held', lowAxe.toFixed(3), 'at', lowAt);
  if (minD < 0.45) throw new Error('the axe passes through Haon');
  // feet over the fallen pillar (top 1.5 m) where the arc crosses it
  let clear = Infinity;
  for (const t of frameTimes(T_TAKE, T_LAND)) {
    const p = hAt(t);
    if (Math.abs(acrossOf(p)) < 0.95 && alongOf(p) > 0.5) clear = Math.min(clear, p[1]);
  }
  console.log('leap: lowest root height over the pillar', clear.toFixed(3), '(pillar top 1.5; tucked feet about 0.4 below the hips)');
  const rel = sub(L2, [W1[0], 0, W1[2]]);
  const fF = fwd(YAW_FALL);
  const ahead = rel[0] * fF[0] + rel[2] * fF[2];
  const side = Math.abs(rel[0] * right(YAW_FALL)[0] + rel[2] * right(YAW_FALL)[2]);
  console.log('Haon vs the falling giant: ahead', ahead.toFixed(2), 'side', side.toFixed(2));
  if (ahead > 0.3 && side < 1.6) throw new Error('the giant falls onto Haon');
  console.log('spots', JSON.stringify({ O: O_SPOT.map((v) => +v.toFixed(2)), R: R_SPOT.map((v) => +v.toFixed(2)), L: L_SPOT.map((v) => +v.toFixed(2)), L2: L2.map((v) => +v.toFixed(2)), alongL: +alongOf(L_SPOT).toFixed(2), acrossL: +acrossOf(L_SPOT).toFixed(2), T_HIT, T_LAND, T_CRASH }));
}

// ---------------------------------------------------------------- stone chips from the blow
const chips: PrevisNode[] = [];
{
  const hit = add(at(0, -0.75), [0, 1.3, 0]);
  const dirs: [number, number, number, number][] = [
    [-1.6, 2.2, 0.7, 0.22], [-1.0, 3.0, -1.2, 0.18], [-2.2, 1.6, 0.2, 0.26], [-0.6, 2.6, 1.5, 0.16], [-1.8, 2.8, -0.5, 0.2],
  ];
  dirs.forEach(([vu, vy, ve, sz], i) => {
    const v: Vec3 = add(scale(U, vu), scale(E, ve));
    const G = 9.81;
    const tf = (vy + Math.sqrt(vy * vy + 2 * G * (hit[1] - sz / 2))) / G;
    const pos: Track<Vec3> = frameTimes(T_HIT, r4(T_HIT + tf)).map((t) => {
      const s = t - T_HIT;
      return { t, v: r6v([hit[0] + v[0] * s, hit[1] + vy * s - 0.5 * G * s * s, hit[2] + v[2] * s]) };
    });
    pos[pos.length - 1].v[1] = sz / 2;
    chips.push({
      id: `chip${i + 1}`, shape: 'box', color: [0.27, 0.26, 0.28], look: { color: [0.36, 0.34, 0.33], roughness: 0.9 },
      position: hit, rotation: [0, 0, 0], size: [sz, sz * 0.8, sz * 0.9], visible: false,
      tracks: {
        visible: [{ t: 0, v: false }, { t: T_HIT, v: true }],
        position: pos,
        rotation: [{ t: T_HIT, v: [0, i, 0] }, { t: r4(T_HIT + tf), v: [2.5 + i, i + 1.5, 1.2 * i] }],
      },
    });
  });
}

// ---------------------------------------------------------------- set
const set = vaultSet(E);
set.find((n) => n.id === 'pillar_smash_pivot')!.tracks = { rotation: pillarTrack };

// ---------------------------------------------------------------- cameras
const wy = (y: number) => y; // readability
const T2 = 3.0;
const T3 = r4(T_HIT);
const T4 = 7.2;
const T5 = r4(T_LOAD - 0.15);
const T6 = r4(T_LAND - 0.2);
const T7 = r4(T_DEATH + 0.5);
const T8 = r4(T_CRASH + 1.6);
const T9 = 20.6;
const T10 = 23.4;
const T11 = 27.0;
const fallDir = fwd(YAW_FALL);
const giantDown: Vec3 = add([W1[0], 0, W1[2]], scale(fallDir, 1.2)); // middle of the fallen body
const shots: Shot[] = [
  {
    id: 's07-1-hold',
    note: 'close: Haon still pressed against the pillar, breathing, glancing back over her shoulder; behind the pillar edge the giant lifts its axe',
    start: 0,
    end: T2,
    camera: {
      position: [{ t: 0, v: add(H_SPOT, [-0.45, 1.46, 2.4]), ease: 'smooth' }, { t: T2, v: add(H_SPOT, [-0.3, 1.45, 2.2]) }],
      target: { track: [{ t: 0, v: add(H_SPOT, [0.75, 1.4, -0.5]) }] },
      fov: [{ t: 0, v: 42 }],
    },
  },
  {
    id: 's07-2-raise',
    note: 'low angle up past the pillar: the giant raises the axe overhead and brings it down on the pillar',
    start: T2,
    end: T3,
    camera: {
      position: [{ t: T2, v: add(at(-3.4, -1.6), [0, 0.5, 0]), ease: 'smooth' }, { t: T3, v: add(at(-3.2, -1.55), [0, 0.45, 0]) }],
      target: { track: [{ t: T2, v: add(at(0.2, -1.6), [0, 2.3, 0]) }] },
      fov: [{ t: T2, v: 58 }],
    },
  },
  {
    id: 's07-3-smash',
    note: 'IMPACT, wide: the axe smashes the pillar, chips fly, the pillar topples and crashes flat (heavy shake); Haon bolts out into the open toward us',
    start: T3,
    end: T4,
    camera: {
      position: [{ t: T3, v: [-4.6, 4.6, 8.5], ease: 'smooth' }, { t: T4, v: [-5.0, 4.3, 8.4] }],
      target: { track: [{ t: T3, v: [-10.0, 1.0, 3.0], ease: 'smooth' }, { t: T4, v: [-10.4, 0.8, 3.6] }] },
      fov: [{ t: T3, v: 62 }],
      shake: { amp: 0.06, freq: 7, roll: 0.025, seed: 71 },
    },
  },
  {
    id: 's07-4-face',
    note: 'over Haon\'s shoulder across the fallen pillar: she catches her breath, raises her sword, the giant turns to her; she charges',
    start: T4,
    end: T5,
    camera: {
      position: [{ t: T4, v: add(O_SPOT, add(scale(unit2(sub(O_SPOT, W1)), 1.6), [0.5, 1.75, 0])), ease: 'smooth' }, { t: T5, v: add(O_SPOT, add(scale(unit2(sub(O_SPOT, W1)), 1.3), [0.6, 1.7, 0])) }],
      target: { track: [{ t: T4, v: add(lerp3(O_SPOT, W1, 0.55), [0, 1.6, 0]) }] },
      fov: [{ t: T4, v: 50 }],
    },
  },
  {
    id: 's07-5-leap',
    note: 'low side, handheld: the giant\'s slice sweeps past, she leaps high over the fallen pillar, sword overhead, toward its legs',
    start: T5,
    end: T6,
    camera: {
      position: [{ t: T5, v: add(at(-4.4, -1.5), [0, 0.9, 0]) }],
      target: { track: sample(T5, T6, 1 / 12, (t) => add(hAt(t), [0, 1.0, 0])) },
      fov: [{ t: T5, v: 56 }],
      shake: { amp: 0.03, freq: 5, roll: 0.015, seed: 72 },
    },
  },
  {
    id: 's07-6-slash',
    note: 'close low: she lands and slashes the giant\'s leg; it buckles and reels (hit, hit)',
    start: T6,
    end: T7,
    camera: {
      position: [{ t: T6, v: add(at(-1.7, -1.1), [0, 0.6, 0]) }],
      target: { track: [{ t: T6, v: add(lerp3(L_SPOT, [W1[0], 0, W1[2]], 0.45), [0, 1.25, 0]) }] },
      fov: [{ t: T6, v: 60 }],
      shake: { amp: 0.02, freq: 4, roll: 0.01, seed: 73 },
    },
  },
  {
    id: 's07-7-fall',
    note: 'wide low: the giant turns away, drops to its knees and crashes face down (big shake); the axe flies from its hand and clatters onto the floor',
    start: T7,
    end: T8,
    camera: {
      position: [{ t: T7, v: [-3.2, 1.0, 8.4], ease: 'smooth' }, { t: T8, v: [-3.5, 0.9, 8.3] }],
      target: { track: [{ t: T7, v: add(giantDown, [-0.6, 1.4, 0]), ease: 'smooth' }, { t: T8, v: add(giantDown, [-0.6, 0.8, 0]) }] },
      fov: [{ t: T7, v: 56 }],
      shake: { amp: 0.05, freq: 8, roll: 0.03, seed: 74 },
    },
  },
  {
    id: 's07-8-silence',
    note: 'silence, medium: Haon stands over the fallen giant, breathing hard; slowly she lowers her sword',
    start: T8,
    end: T9,
    camera: {
      position: [{ t: T8, v: add(L2, [0.75, 2.4, 3.7]), ease: 'smooth' }, { t: T9, v: add(L2, [0.6, 2.2, 3.3]) }],
      target: { track: [{ t: T8, v: add(L2, [0.55, 1.0, -0.2]) }] },
      fov: [{ t: T8, v: 46 }],
    },
  },
  {
    id: 's07-9-drop',
    note: 'insert, low at her feet: her fingers open and the sword drops and rings flat on the stone',
    start: T9,
    end: T10,
    camera: {
      position: [{ t: T9, v: add(L2, [1.35, 0.5, -1.0]) }],
      target: { track: [{ t: T9, v: add(L2, [0.25, 0.25, 0.3]) }] },
      fov: [{ t: T9, v: 50 }],
    },
  },
  {
    id: 's07-10-altar',
    note: 'she lifts her head to the far east: the altar glows at the end of the vault; she turns toward it',
    start: T10,
    end: T11,
    camera: {
      position: [{ t: T10, v: add(L2, [-2.4, 1.65, -1.2]), ease: 'smooth' }, { t: T11, v: add(L2, [-2.6, 1.7, -1.3]) }],
      target: { track: [{ t: T10, v: [ALTAR[0], 1.3, 0] }] },
      fov: [{ t: T10, v: 34 }],
    },
  },
  {
    id: 's07-11-crane',
    note: 'final: slow crane up and back over the fallen giant as Haon walks away east toward the altar glow, ember in her left hand, no sword',
    start: T11,
    end: DUR,
    camera: {
      position: [
        { t: T11, v: [-8.6, 1.6, 6.6], ease: 'smooth' },
        { t: 33.5, v: [-9.8, 4.4, 4.4], ease: 'smooth' },
        { t: DUR, v: [-11.2, 7.4, 2.2] },
      ],
      target: { track: [
        { t: T11, v: add(giantDown, [0, 0.9, 0]), ease: 'smooth' },
        { t: 33.5, v: [-3.0, 0.6, 1.2], ease: 'smooth' },
        { t: DUR, v: [3.5, 0.5, 0.3] },
      ] },
      fov: [{ t: T11, v: 50, ease: 'ease-in-out' }, { t: DUR, v: 56 }],
    },
  },
];
void wy;

const markers: PrevisMarker[] = [
  { t: 0, label: 'Haon hidden behind the pillar; the giant faces it' },
  { t: T_C, label: 'the giant raises its axe' },
  { t: T_HIT, label: 'IMPACT: the axe smashes the pillar (stone chips fly); Haon bolts' },
  { t: T_PLAND, label: 'the pillar crashes flat on the floor (dust, shake)' },
  { t: T_CH0, label: 'Haon charges' },
  { t: T_S, label: 'the giant sweeps its axe sideways (slice)' },
  { t: T_TAKE, label: 'she leaps over the fallen pillar, sword overhead' },
  { t: T_LAND, label: 'she lands at its legs and slashes' },
  { t: T_HITA, label: 'the giant buckles (hit)' },
  { t: T_DEATH, label: 'it turns away and drops' },
  { t: T_REL, label: 'the axe flies out of its hand' },
  { t: T_ALAND, label: 'the axe clatters onto the floor' },
  { t: T_CRASH, label: 'the giant crashes face down (big shake, dust)' },
  { t: T_LOWER0, label: 'silence: she lowers her sword' },
  { t: T_DROP, label: 'she lets the sword fall' },
  { t: T_SLAND, label: 'the sword rings flat on the stone' },
  { t: T_LOOK, label: 'she looks to the far altar' },
  { t: T_WALK0, label: 'she walks east toward the altar, ember in her left hand' },
];

const doc: PrevisDoc = {
  version: 1,
  title: '불씨지기 S07 쓰러지는 거인',
  fps: FPS,
  size: SIZE,
  background: BG,
  worldScale: 10,
  avoidColors: AVOID,
  lighting: vaultLighting(2.25),
  roles: ROLES,
  nodes: [...set, ...chips, ...haonNodes, haon.skin, props.ember, props.sword, props.swordTex, warden, axe],
  shots,
  markers,
};
writeDoc('s07-fall', doc, HERE);
console.log('end state', JSON.stringify({ haon: hAt(DUR).map((v) => +v.toFixed(3)), yaw: +yawB.toFixed(3) }));
void PILLAR_SIZE; void AXE_S; void WY;
