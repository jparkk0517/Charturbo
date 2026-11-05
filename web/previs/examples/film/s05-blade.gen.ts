// 불씨지기 S05 "버려진 검" (The Abandoned Blade), 40 s. Run from web/:
//   node --experimental-strip-types previs/examples/film/s05-blade.gen.ts
// A small side chamber of the crypt (cold blue, one dim warm brazier). Haon enters screen left -> right with the ember
// in her LEFT hand, finds an old sword beside a slumped dead skeleton, picks it up with her RIGHT hand (pickUp +
// tracks.parent, gate-raid sword pattern). A skeleton she walked past rises behind her, advances and chops; she
// sidesteps, raises the sword overhead and slashes down; the skeleton is hit and collapses. She breathes, lowers the
// sword, looks to the far doorway and walks out through it (screen right).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, evalTrack, evaluateFrame, eulerYXZToQuat, pickUp, quatToEulerYXZ, walk, raiseArm, worldTransform } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisMarker, PrevisNode, Quat, Shot, Track, Vec3 } from '../../../src/previs/index.ts';
import {
  AVOID, BG, C, EMBER_D, FPS, LIGHT, LOOK, MINION_H, PILLAR_FLAT, ROLES, SIZE, SRC, WORLD_SCALE,
  add, character, flatOnly, frameTimes, lerp, lerp3, r4, sample, scale, sub, writeDoc, yawTo,
} from './common.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUR = 40;

// ---- quaternions (x, y, z, w), same conventions as evaluate.ts (copied from gate-raid) ----
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};
const eulerNear = (q: Quat, near: Vec3): Vec3 =>
  quatToEulerYXZ(q).map((v, i) => v + 2 * Math.PI * Math.round((near[i] - v) / (2 * Math.PI))) as Vec3;
const qslerp = (a: Quat, b: Quat, u: number): Quat => {
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
const qFromTo = (a: Vec3, b: Vec3): Quat => {
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const q: Quat = [c[0], c[1], c[2], 1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]];
  const n = Math.hypot(...q);
  return q.map((v) => v / n) as Quat;
};
const qYaw = (yaw: number): Quat => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
const lowestCorner = (p: Vec3, q: Quat, size: Vec3): number => {
  let min = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    min = Math.min(min, p[1] + qrot(q, [(sx * size[0]) / 2, (sy * size[1]) / 2, (sz * size[2]) / 2])[1]);
  }
  return min;
};
const ease = (u: number) => u * u * (3 - 2 * u);

// ---- layout (meters; camera side is +z, screen right is +x) ----
const A: Vec3 = [-7.4, 0, 0.6]; // entry: through the doorway gap in the left wall (screen left)
const B: Vec3 = [-1.6, 0, 0.6]; // stops: notices the sword
const P: Vec3 = [-0.35, 0, 0.6]; // pick-up stance, facing +x
const YAW_PICK = Math.PI / 2;
const R: Vec3 = [-3.3, 0, -0.7]; // the skeleton she walks past (lying), rises behind her
const S: Vec3 = [-1.7, 0, 0.5]; // where it stops to chop
const Q: Vec3 = [-0.2, 0, 1.35]; // sidestep out of the blow (her left, toward the camera side)
const S2: Vec3 = [-1.25, 0, 0.54]; // the chop lunges it forward onto the spot she just left
const L: Vec3 = [-0.48, 0, 1.14]; // lunge: slash distance to S
const DOOR_X = 2.5;
const WALL_Z = -4.5; // far wall (centre plane), 1 m thick
const E: Vec3 = [DOOR_X, 0, -5.4]; // through the doorway at the end
const DEAD: Vec3 = [1.3, 0, 0.1]; // slumped dead skeleton beside the sword

// ---- timeline (seconds) ----
const W1 = [0.0, 4.8]; // entry walk A -> B
const W2 = [5.6, 6.9]; // B -> P
const T_REACH = 7.0;
const T_GRAB = 8.0;
const T_SET = 9.05;
const T_RISE = 9.2;
const T_EXAM = [9.4, 10.2]; // lifts the blade to look at it
const T_EXAM_END = [12.3, 12.9];
const T_STAND = 10.6; // skeleton starts to rise (Lie_StandUp 2.333 s)
const T_ADV = 13.3; // skeleton walks at her
const T_HEAR = 13.5; // Haon hears it
const T_TURN = [14.0, 15.0];
const T_GUARD = [14.3, 15.0];
const T_CHOP = 15.8; // 2H_Melee_Attack_Chop (1.633 s, both arms overhead: reads from the side), the blow lands ~0.8 s in
const SIDE = [16.2, 16.6];
const T_OVER = [16.8, 17.5]; // sword overhead
const LUNGE = [17.6, 18.0];
const T_SLASH = [18.0, 18.25];
const T_HIT = 18.22;
const T_DIE = 18.75; // Death_C_Skeletons (2.0 s)
const T_LOWER = [24.5, 25.5];
const T_LOOK = [27.6, 28.3];
const T_TURN2 = [28.6, 29.6];
const W3 = [32.0, 40.0]; // exit walk L -> E

// ---- Haon ----
const haon = character('haon', A, YAW_PICK);
const j = haon.j;
const m = haon.m;
const node = (id: string) => m.nodes.find((n) => n.id === id)!;
// carry pose of the ember (left) arm (static rest; only the explicit fight keys below write shoulderL / elbowL)
const CARRY_SH: Vec3 = [-0.35, 0.15, 0];
const CARRY_EL: Vec3 = [-0.95, 0, 0];
node(j.shoulderL!).rotation = [...CARRY_SH];
node(j.elbowL!).rotation = [...CARRY_EL];

const frags: MotionFragments[] = [];
const walkSeg = (from: Vec3, to: Vec3, a: number, b: number, sps: number, arms: 'right' | 'none') => {
  const w = walk({ joints: j, from, to, start: a, end: b, stepsPerSecond: sps });
  delete w[j.root].rotation; // root yaw authored below
  delete w[j.shoulderL!]; // the ember arm keeps its carry pose
  if (arms === 'none') delete w[j.shoulderR!];
  return w;
};
frags.push(walkSeg(A, B, W1[0], W1[1], 2.0, 'right'));
frags.push(walkSeg(B, P, W2[0], W2[1], 1.7, 'right'));

// sword geometry (gate-raid pattern, turned to Haon's facing): blade box 0.05 x 0.9 x 0.02, grip at local +y
const FWD: Vec3 = [Math.sin(YAW_PICK), 0, Math.cos(YAW_PICK)];
const RIGHT: Vec3 = [-Math.cos(YAW_PICK), 0, Math.sin(YAW_PICK)];
const GRIP = -1.0;
const BLADE = 0.9;
const SWORD_SIZE: Vec3 = [0.05, BLADE, 0.02];
const half = BLADE / 2 + 0.04;
const GRIP_POINT: Vec3 = add(add(P, add(scale(RIGHT, 0.28), scale(FWD, 0.4))), [0, 0.075, 0]);
const SWORD_FLOOR_Q = qmul(qYaw(YAW_PICK - Math.PI), eulerYXZToQuat([0, 0, Math.PI / 2])); // blade toward her right
const SWORD_FLOOR_ROT = quatToEulerYXZ(SWORD_FLOOR_Q);
const SWORD_FLOOR: Vec3 = add(GRIP_POINT, add(scale(RIGHT, half), [0, SWORD_SIZE[0] / 2 - GRIP_POINT[1], 0]));
const pk = pickUp({ mannequin: m, side: 'right', target: GRIP_POINT, start: T_REACH, grab: T_GRAB, end: T_RISE, depth: 0.66, lean: 0.8, fps: FPS, rootPosition: P, rootYaw: YAW_PICK });
if (pk.miss > 1e-6) throw new Error(`pickUp misses the grip by ${pk.miss.toFixed(3)} m`);
frags.push(pk.motion);

// right arm after the pick-up: lift the blade to look at it, guard, overhead, slash, lower
frags.push(raiseArm({ joints: j, side: 'right', start: T_EXAM[0], end: T_EXAM[1], angle: 1.0 }));
frags.push(raiseArm({ joints: j, side: 'right', start: T_EXAM_END[0], end: T_EXAM_END[1], from: 1.0, angle: 0.45 }));
frags.push(raiseArm({ joints: j, side: 'right', start: T_GUARD[0], end: T_GUARD[1], from: 0.45, angle: 0.6 }));
frags.push(raiseArm({ joints: j, side: 'right', start: T_OVER[0], end: T_OVER[1], from: 0.6, angle: 2.9 }));
frags.push(raiseArm({ joints: j, side: 'right', start: T_SLASH[0], end: T_SLASH[1], from: 2.9, angle: 0.55 }));
frags.push(raiseArm({ joints: j, side: 'right', start: T_LOWER[0], end: T_LOWER[1], from: 0.55, angle: 0 }));
frags.push({
  [j.elbowR!]: {
    rotation: [
      { t: T_EXAM[0], v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T_EXAM[1], v: [-0.75, 0, 0] },
      { t: T_EXAM_END[0], v: [-0.75, 0, 0], ease: 'ease-in-out' },
      { t: T_EXAM_END[1], v: [-0.2, 0, 0] },
      { t: T_GUARD[0], v: [-0.2, 0, 0], ease: 'ease-in-out' },
      { t: T_GUARD[1], v: [-1.1, 0, 0] }, // high guard: blade upright in front of her
      { t: T_OVER[0], v: [-1.1, 0, 0], ease: 'ease-in-out' },
      { t: T_OVER[1], v: [-0.45, 0, 0] },
      { t: T_SLASH[0], v: [-0.45, 0, 0], ease: 'ease-in' },
      { t: T_SLASH[1], v: [0, 0, 0] },
    ],
  },
});
// the ember arm: carry pose, pulled back and out to her left during the fight (shielding the ember), carry again after
frags.push({
  [j.shoulderL!]: {
    rotation: [
      { t: T_GUARD[0], v: [...CARRY_SH], ease: 'ease-in-out' },
      { t: T_GUARD[1], v: [0.5, 0, 0.3] },
      { t: 20.4, v: [0.5, 0, 0.3], ease: 'ease-in-out' },
      { t: 21.6, v: [...CARRY_SH] },
    ],
  },
  [j.elbowL!]: {
    rotation: [
      { t: T_GUARD[0], v: [...CARRY_EL], ease: 'ease-in-out' },
      { t: T_GUARD[1], v: [-1.6, 0, 0] },
      { t: 20.4, v: [-1.6, 0, 0], ease: 'ease-in-out' },
      { t: 21.6, v: [...CARRY_EL] },
    ],
  },
});
// fight footwork: sidestep (fast, legs only) and lunge
frags.push(walkSeg(P, Q, SIDE[0], SIDE[1], 6, 'none'));
frags.push(walkSeg(Q, L, LUNGE[0], LUNGE[1], 5, 'none'));
frags.push(walkSeg(L, E, W3[0], W3[1], 1.6, 'right'));

// root yaw (shortest path; walks do not write it)
const yawS = yawTo(P, S);
const yawSide = yawTo(Q, S2);
const yawL = yawTo(L, S2);
const yawDoor = yawTo(L, E);
frags.push({
  [j.root]: {
    rotation: [
      { t: 0, v: [0, YAW_PICK, 0] },
      { t: T_TURN[0], v: [0, YAW_PICK, 0], ease: 'ease-in' },
      { t: (T_TURN[0] + T_TURN[1]) / 2, v: [0, (YAW_PICK + yawS) / 2, 0], ease: 'ease-out' },
      { t: T_TURN[1], v: [0, yawS, 0] },
      { t: SIDE[0], v: [0, yawS, 0], ease: 'ease-in-out' },
      { t: SIDE[1], v: [0, yawSide, 0] },
      { t: LUNGE[0], v: [0, yawSide, 0], ease: 'ease-in-out' },
      { t: LUNGE[1], v: [0, yawL, 0] },
      { t: T_TURN2[0], v: [0, yawL, 0], ease: 'ease-in-out' },
      { t: T_TURN2[1], v: [0, yawDoor, 0] },
    ],
  },
});
// head: notices the sword (down-right), watches the pick-up and the blade, hears, looks over the right shoulder,
// watches the fallen skeleton, looks to the doorway (rx > 0 nods down, yaw > 0 toward her left)
frags.push({
  [j.head]: {
    rotation: [
      { t: 0, v: [0, 0, 0] },
      { t: 3.4, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: 4.2, v: [0.3, -0.38, 0] },
      { t: W2[0], v: [0.3, -0.38, 0], ease: 'ease-in-out' },
      { t: 6.2, v: [0.35, -0.12, 0] },
      { t: T_REACH, v: [0.35, -0.12, 0], ease: 'ease-in-out' },
      { t: T_GRAB, v: [0.35, -0.2, 0], ease: 'ease-in-out' },
      { t: T_EXAM[1], v: [0.12, -0.38, 0] },
      { t: T_HEAR, v: [0.1, -0.38, 0], ease: 'ease-out' },
      { t: T_HEAR + 0.3, v: [0, -1.05, 0] },
      { t: T_TURN[0] + 0.2, v: [0, -1.05, 0], ease: 'ease-in-out' },
      { t: T_TURN[1], v: [0.05, 0, 0] },
      { t: T_SLASH[1], v: [0.12, 0, 0], ease: 'ease-in-out' },
      { t: 20.5, v: [0.3, 0.05, 0] },
      { t: T_LOOK[0] - 1.5, v: [0.25, 0.05, 0], ease: 'ease-in-out' },
      { t: T_LOOK[0], v: [0.05, 0, 0], ease: 'ease-in-out' },
      { t: T_LOOK[1], v: [0, -1.05, 0] },
      { t: T_TURN2[0], v: [0, -1.05, 0], ease: 'ease-in-out' },
      { t: T_TURN2[1], v: [0, 0, 0] },
    ],
  },
});
// spine: arch back with the sword overhead, fold into the slash, heavy breathing that settles, upright for the exit
// (pickUp owns spine.rotation on [T_REACH, T_RISE])
{
  const rot: Track<Vec3> = [
    { t: T_OVER[0], v: [0, 0, 0], ease: 'ease-in-out' },
    { t: T_OVER[1], v: [-0.12, 0, 0] },
    { t: T_SLASH[0], v: [-0.12, 0, 0], ease: 'ease-in' },
    { t: T_SLASH[1], v: [0.38, 0, 0], ease: 'ease-in-out' },
  ];
  const pos: Track<Vec3> = [];
  const B0 = 19.0;
  const B1 = 31.0;
  const period = 1.5;
  for (let t = B0, i = 0; t < B1 - 1e-9; t += period / 2, i++) {
    const u = (t - B0) / (B1 - B0);
    const amp = lerp(0.07, 0.02, u);
    const base = lerp(0.2, 0.04, u);
    rot.push({ t: r4(t), v: [i % 2 === 0 ? base + amp : base - amp, 0, 0], ease: 'ease-in-out' });
    pos.push({ t: r4(t), v: [0, i % 2 === 0 ? 0 : lerp(0.012, 0.004, u), 0], ease: 'ease-in-out' });
  }
  rot.push({ t: B1 + 0.5, v: [0, 0, 0] });
  pos.push({ t: B1 + 0.5, v: [0, 0, 0] });
  frags.push({ [j.spine]: { rotation: rot, position: pos } });
}
const haonNodes = applyMotion(m.nodes, frags);
haonNodes.find((n) => n.id === j.root)!.rotationPath = 'shortest';

// ---- ember (left hand, the whole scene; a parent key at 0 lets attach hang it on the skin's hand bone) ----
const EMBER_OFF: Vec3 = [0, -0.09, 0.03];
const ember: PrevisNode = {
  id: 'ember', shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.ember,
  parent: j.handL!, position: EMBER_OFF, rotation: [0, 0, 0], size: [EMBER_D, EMBER_D, EMBER_D],
  tracks: { parent: [{ t: 0, v: { node: j.handL! } }] },
};

// ---- sword box (flat pass) ----
const sword: PrevisNode = {
  id: 'sword', shape: 'box', role: 'sword', color: C.sword, look: { show: 'flat' },
  position: SWORD_FLOOR, rotation: SWORD_FLOOR_ROT, size: SWORD_SIZE,
};

// ---- skeletons (KayKit Skeleton_Minion, drawn in both passes) ----
const yawRS = yawTo(R, S);
const yawSL = yawTo(S2, L);
const minion: PrevisNode = {
  id: 'minion', shape: 'model', role: 'skeleton', color: C.skeleton,
  model: {
    src: SRC.minion, fit: 'contain', groundLock: true,
    animation: [
      { clip: 'Lie_Pose' },
      { clip: 'Lie_StandUp', start: T_STAND, loop: 'once' },
      { clip: 'Idle_Combat', start: T_STAND + 2.3, blendIn: 0.25, loop: 'repeat' },
      { clip: 'Walking_D_Skeletons', start: T_ADV, blendIn: 0.3, loop: 'repeat' },
      { clip: '2H_Melee_Attack_Chop', start: T_CHOP, blendIn: 0.12, loop: 'once' },
      { clip: 'Idle_Combat', start: T_CHOP + 1.6, blendIn: 0.2, loop: 'repeat' },
      { clip: 'Hit_A', start: T_HIT, blendIn: 0.05, loop: 'once' },
      { clip: 'Death_C_Skeletons', start: T_DIE, blendIn: 0.12, loop: 'once' },
    ],
  },
  position: [R[0], MINION_H / 2, R[2]], rotation: [0, yawRS, 0], size: [1.6, MINION_H, 0.8],
  rotationPath: 'shortest',
  tracks: {
    position: [
      { t: T_ADV + 0.2, v: [R[0], MINION_H / 2, R[2]] },
      { t: T_CHOP - 0.1, v: [S[0], MINION_H / 2, S[2]] },
      { t: T_CHOP + 0.35, v: [S[0], MINION_H / 2, S[2]], ease: 'ease-in-out' },
      { t: T_CHOP + 0.8, v: [S2[0], MINION_H / 2, S2[2]] },
    ],
    rotation: [
      { t: T_CHOP + 1.5, v: [0, yawRS, 0], ease: 'ease-in-out' },
      { t: T_CHOP + 1.95, v: [0, yawSL, 0] },
    ],
  },
};
const dead: PrevisNode = {
  id: 'minion_dead', shape: 'model', role: 'skeleton', color: C.skeleton,
  model: { src: SRC.minion, fit: 'contain', groundLock: true, animation: { clip: 'Death_B_Pose' } },
  position: [DEAD[0], MINION_H / 2, DEAD[2]], rotation: [0, Math.PI / 2, 0], size: [1.6, MINION_H, 0.8], // fell forward, skull toward +x
};

// ---- set: side chamber ----
const KP = { fit: 'contain' as const };
const wall = (id: string, x: number, z: number, yaw: number): PrevisNode => ({
  id, shape: 'model', color: [0.27, 0.26, 0.28],
  model: { src: SRC.wall, ...KP }, position: [x, 2, z], rotation: [0, yaw, 0], size: [4, 4, 1],
});
const pillar = (id: string, x: number, z: number): PrevisNode => ({
  id, shape: 'model', color: PILLAR_FLAT, model: { src: SRC.pillar, ...KP }, position: [x, 2, z], rotation: [0, 0, 0], size: [1.5, 4, 1.5],
});
const BRAZIER: Vec3 = [-4.6, 0, -3.3];
const set: PrevisNode[] = [
  { id: 'floor', shape: 'box', color: [0.2, 0.2, 0.22], look: LOOK.floor, position: [0, -0.25, -1], rotation: [0, 0, 0], size: [18, 0.5, 18] },
  // far wall with an open doorway gap (DOOR_X +- 0.8) leading deeper
  wall('wall_far0', -8.3, WALL_Z, 0),
  wall('wall_far1', DOOR_X - 0.8 - 6, WALL_Z, 0),
  wall('wall_far2', DOOR_X - 0.8 - 2, WALL_Z, 0),
  wall('wall_far3', DOOR_X + 0.8 + 2, WALL_Z, 0),
  { id: 'lintel_far', shape: 'box', color: [0.24, 0.23, 0.25], look: LOOK.darkStone, position: [DOOR_X, 3.4, WALL_Z], rotation: [0, 0, 0], size: [1.7, 1.2, 1.0] },
  // left wall with the gap she enters through (z = A[2] +- 1.1), right wall closed
  wall('wall_left1', -7.5, A[2] - 1.1 - 2, Math.PI / 2),
  wall('wall_left2', -7.5, A[2] + 1.1 + 2, Math.PI / 2),
  { id: 'lintel_left', shape: 'box', color: [0.24, 0.23, 0.25], look: LOOK.darkStone, position: [-7.5, 3.4, A[2]], rotation: [0, 0, 0], size: [1.0, 1.2, 2.3] },
  wall('wall_right1', 8.0, -2.5, Math.PI / 2),
  wall('wall_right2', 8.0, 1.5, Math.PI / 2),
  // the corridor behind the doorway (dark, so the opening reads as a way deeper)
  wall('corr_l', DOOR_X - 2.0, -7.0, Math.PI / 2),
  wall('corr_r', DOOR_X + 2.0, -7.0, Math.PI / 2),
  pillar('pillar1', -4.3, -2.6),
  pillar('pillar2', -0.9, -3.1),
  pillar('pillar3', 5.2, -2.7),
  // the one warm accent: a dying brazier in the back-left corner
  { id: 'brazier', shape: 'cylinder', color: [0.3, 0.24, 0.16], look: LOOK.bronze, position: add(BRAZIER, [0, 0.45, 0]), rotation: [0, 0, 0], size: [0.5, 0.9, 0.5] },
  { id: 'brazier_fire', shape: 'sphere', color: [0.55, 0.3, 0.12], look: LOOK.emberDim, position: add(BRAZIER, [0, 0.95, 0]), rotation: [0, 0, 0], size: [0.38, 0.22, 0.38] },
];

// ---- probe doc: evaluate Haon and the sword while the sword tracks are authored ----
const probe: PrevisDoc = {
  version: 1, fps: FPS, size: SIZE, background: BG, roles: ROLES, nodes: [...set, ...haonNodes, sword],
  shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 8] }], target: { follow: j.root } } }],
};
const wt = (id: string, t: number) => worldTransform(probe, evaluateFrame(probe, t).nodes, id, { time: t });
const at = (t: number): Vec3 => wt(j.root, t).position;

// -- sword pick-up (gate-raid): re-parent to the hand at T_GRAB, world orientation floor -> blade up-forward -> grip
{
  const qs = SWORD_FLOOR_Q;
  const hand0 = wt(pk.hand, T_GRAB);
  const capQ = qmul(qconj(hand0.quaternion), qs);
  const capP = qrot(qconj(hand0.quaternion), sub(SWORD_FLOOR, hand0.position));
  const gripP: Vec3 = [0, -half * Math.cos(GRIP), -half * Math.sin(GRIP)];
  const gripQ = eulerYXZToQuat([GRIP, 0, 0]);
  const qEnd = qmul(wt(pk.hand, T_SET).quaternion, gripQ);
  const upDir = add(scale([0, 1, 0], Math.sin(0.6)), scale(RIGHT, Math.cos(0.6))); // blade swings up beside her, the guard stays level
  const qUp = qmul(qFromTo(RIGHT, upDir), qs);
  // the hand first lifts the sword level off the floor (so the pommel and guard clear it), then the blade swings up
  const T_HOLD = r4(T_GRAB + 0.25);
  const T_MID = r4(T_GRAB + 0.55);
  const pos: Track<Vec3> = [];
  const rot: Track<Vec3> = [];
  let prev: Vec3 = SWORD_FLOOR_ROT;
  for (const t of frameTimes(T_GRAB, T_SET)) {
    const h = wt(pk.hand, t);
    const qw = t <= T_HOLD ? qs : t <= T_MID ? qslerp(qs, qUp, ease((t - T_HOLD) / (T_MID - T_HOLD))) : qslerp(qUp, qEnd, ease((t - T_MID) / (T_SET - T_MID)));
    const lq = qmul(qconj(h.quaternion), qw);
    const u = ease((t - T_GRAB) / (T_SET - T_GRAB));
    const gripNow = qrot(lq, [0, half, 0]);
    const capGrip = add(capP, qrot(capQ, [0, half, 0]));
    const lp = sub(scale(capGrip, 1 - u), gripNow);
    pos.push({ t, v: add(SWORD_FLOOR, sub(lp, capP)) });
    prev = eulerNear(qmul(qs, qmul(qconj(capQ), lq)), prev);
    rot.push({ t, v: prev });
  }
  const last = pos[pos.length - 1].v;
  const want = add(SWORD_FLOOR, sub(gripP, capP));
  if (Math.hypot(...sub(last, want)) > 1e-6) throw new Error('sword does not end in the grip pose');
  sword.tracks = { parent: [{ t: T_GRAB, v: { node: pk.hand } }], position: pos, rotation: rot };
}
// -- self-check: the sword box never below the floor (whole scene, it follows the mannequin hand) --
{
  let min = Infinity;
  let atT = 0;
  for (const t of frameTimes(0, DUR)) {
    const w = wt('sword', t);
    const y = lowestCorner(w.position, w.quaternion, SWORD_SIZE);
    if (y < min) [min, atT] = [y, t];
  }
  console.log('sword box lowest corner (m)', min.toFixed(4), 'at', atT);
  if (min < -0.005) throw new Error('the sword goes through the floor');
}

// ---- textured sword (KayKit sword_1handed) riding the hand; gate-raid sword_tex ----
type Pose = { p: Vec3; q: Quat };
const compose = (a: Pose, b: Pose): Pose => ({ p: add(a.p, qrot(a.q, b.p)), q: qmul(a.q, b.q) });
const SWORD_MIN: Vec3 = [-0.2517, -0.3658, -0.0653];
const SWORD_MAX: Vec3 = [0.2517, 1.4095, 0.0653];
const SWORD_S = 0.53;
const SWORD_TEX_SIZE = scale(sub(SWORD_MAX, SWORD_MIN), SWORD_S).map((v) => +v.toFixed(4)) as Vec3;
const SWORD_HANDLE = -0.15;
const PALM: Vec3 = [0, -0.07, 0];
const SWORD_LIFT = 0.012;
const swordOff: Pose = {
  p: add([SWORD_LIFT, half - ((SWORD_MIN[1] + SWORD_MAX[1]) / 2 - SWORD_HANDLE) * SWORD_S, 0], qrot(qconj(eulerYXZToQuat([GRIP, 0, 0])), PALM)),
  q: [Math.SQRT1_2, 0, Math.SQRT1_2, 0],
};
const swordFloor = compose({ p: SWORD_FLOOR, q: SWORD_FLOOR_Q }, swordOff);
const r6v = (v: Vec3): Vec3 => v.map((x) => +x.toFixed(6)) as Vec3;
const swordTex: PrevisNode = (() => {
  const pos: Track<Vec3> = [{ t: 0, v: r6v(swordFloor.p), ease: 'step' }];
  let prev = quatToEulerYXZ(swordFloor.q);
  const rot: Track<Vec3> = [{ t: 0, v: r6v(prev), ease: 'step' }];
  for (const t of frameTimes(T_GRAB, T_SET)) {
    const h = wt(pk.hand, t);
    const s = wt('sword', t);
    const local = compose({ p: qrot(qconj(h.quaternion), sub(s.position, h.position)), q: qmul(qconj(h.quaternion), s.quaternion) }, swordOff);
    prev = eulerNear(local.q, prev);
    pos.push({ t, v: r6v(local.p) });
    rot.push({ t, v: r6v(prev) });
  }
  // lowest bounds corner while it follows the mannequin hand pivot (before T_RISE exactly; after it the bone,
  // approximated here by the pivot with the last local pose)
  let low = { y: Infinity, t: 0 };
  for (const t of frameTimes(0, DUR)) {
    const h = wt(pk.hand, t);
    const w = t < T_GRAB ? swordFloor : compose({ p: h.position, q: h.quaternion }, { p: evalTrack(pos, t, [0, 0, 0] as Vec3), q: eulerYXZToQuat(evalTrack(rot, t, [0, 0, 0] as Vec3)) });
    const y = lowestCorner(w.p, w.q, SWORD_TEX_SIZE);
    if (y < low.y) low = { y: +y.toFixed(4), t };
  }
  console.log('textured sword lowest bounds corner (m)', JSON.stringify(low));
  if (low.y < -0.005) throw new Error('the textured sword goes through the floor');
  return {
    id: 'sword_tex', shape: 'model', role: 'sword', color: C.sword, look: { show: 'textured' },
    model: { src: SRC.sword, fit: 'contain' },
    position: r6v(swordFloor.p), rotation: r6v(quatToEulerYXZ(swordFloor.q)), size: SWORD_TEX_SIZE,
    tracks: {
      parent: [{ t: T_GRAB, v: { node: pk.hand, snap: true } }, { t: T_RISE, v: { node: pk.hand } }],
      position: pos,
      rotation: rot,
    },
  };
})();

// ---- cameras ----
const hz = (t: number) => at(t);
const shots: Shot[] = [
  {
    id: 's05-1-wide', start: 0, end: 5.0,
    note: 'wide establishing of the cold side chamber, slow pan right: Haon enters screen left with the ember, passes a lying skeleton, stops and notices something on the floor',
    camera: {
      position: [{ t: 0, v: [-1.6, 2.5, 7.4], ease: 'smooth' }, { t: 5.0, v: [-0.6, 2.3, 6.8] }],
      target: { track: sample(0, 5.0, 0.5, (t) => [lerp(-3.0, -0.4, Math.min(1, t / 4.6)), 0.95, -0.6]) },
      fov: [{ t: 0, v: 52 }],
    },
  },
  {
    id: 's05-2-insert', start: 5.0, end: 7.0,
    note: 'insert, floor level: an old sword lies beside a slumped dead skeleton; Haon\'s feet step into frame',
    camera: {
      position: [{ t: 5.0, v: [1.9, 0.45, 2.95], ease: 'smooth' }, { t: 7.0, v: [1.75, 0.42, 2.75] }],
      target: { track: [{ t: 5.0, v: [0.65, 0.12, 0.6], ease: 'smooth' }, { t: 7.0, v: [0.5, 0.16, 0.65] }] },
      fov: [{ t: 5.0, v: 44 }],
    },
  },
  {
    id: 's05-3-pickup', start: 7.0, end: 10.0,
    note: 'medium side shot: Haon bends and grips the sword with her right hand, ember kept in the left, and rises with it',
    camera: {
      position: [{ t: 7.0, v: [0.0, 1.0, 3.7], ease: 'smooth' }, { t: 10.0, v: [-0.05, 1.15, 3.3] }],
      target: { track: [{ t: 7.0, v: [-0.05, 0.6, 0.8], ease: 'smooth' }, { t: T_GRAB, v: [-0.05, 0.55, 0.85], ease: 'smooth' }, { t: 10.0, v: [-0.15, 1.05, 0.7] }] },
      fov: [{ t: 7.0, v: 44 }],
    },
  },
  {
    id: 's05-4-behind', start: 10.0, end: 14.2,
    note: 'front three-quarter on Haon examining the blade; behind her, out of focus in the gloom, the skeleton she passed rises (she does not see it), then she hears it',
    camera: {
      position: [{ t: 10.0, v: [1.7, 1.45, 3.3], ease: 'smooth' }, { t: 14.2, v: [1.45, 1.4, 3.0] }],
      target: { track: [{ t: 10.0, v: [-1.5, 1.0, -0.15], ease: 'smooth' }, { t: 14.2, v: [-1.7, 0.95, -0.2] }] },
      fov: [{ t: 10.0, v: 44 }],
    },
  },
  {
    id: 's05-5-turn', start: 14.2, end: 16.2,
    note: 'medium two-shot from the side, slight handheld: Haon turns to face the skeleton and raises the sword to guard; it walks at her',
    camera: {
      position: [{ t: 14.2, v: [-0.9, 1.3, 4.0], ease: 'smooth' }, { t: 16.2, v: [-0.85, 1.25, 3.6] }],
      target: { track: [{ t: 14.2, v: [-1.3, 0.95, 0.0], ease: 'smooth' }, { t: 16.2, v: [-0.9, 1.0, 0.3] }] },
      fov: [{ t: 14.2, v: 46 }],
      shake: { amp: 0.012, freq: 2, roll: 0.004, seed: 51 },
    },
  },
  {
    id: 's05-6-attack', start: 16.2, end: 17.6,
    note: 'close, handheld shake: the skeleton chops down, Haon sidesteps out of the blow',
    camera: {
      position: [{ t: 16.2, v: [-0.85, 1.2, 3.75], ease: 'smooth' }, { t: 17.6, v: [-0.75, 1.15, 3.6] }],
      target: { track: [{ t: 16.2, v: [-0.85, 1.0, 0.7], ease: 'smooth' }, { t: 17.6, v: [-0.75, 1.05, 0.8] }] },
      fov: [{ t: 16.2, v: 46 }],
      shake: { amp: 0.035, freq: 5, roll: 0.012, seed: 52 },
    },
  },
  {
    id: 's05-7-slash', start: 17.6, end: 19.6,
    note: 'low angle looking up: Haon steps in, sword overhead, and slashes down; the skeleton is hit (impact shake)',
    camera: {
      position: [{ t: 17.6, v: [-2.2, 0.3, 2.45], ease: 'smooth' }, { t: 19.6, v: [-2.05, 0.35, 2.3] }],
      target: { track: [{ t: 17.6, v: [-0.85, 1.3, 0.85], ease: 'smooth' }, { t: 19.6, v: [-1.15, 0.8, 0.7] }] },
      fov: [{ t: 17.6, v: 62 }],
      shake: { amp: 0.04, freq: 6, roll: 0.015, seed: 53 },
    },
  },
  {
    id: 's05-8-collapse', start: 19.6, end: 24.0,
    note: 'wide: the skeleton crumbles to the floor; Haon stands over it, breathing hard',
    camera: {
      position: [{ t: 19.6, v: [-0.4, 2.4, 5.6], ease: 'smooth' }, { t: 24.0, v: [-0.6, 2.2, 5.2] }],
      target: { track: [{ t: 19.6, v: [-1.2, 0.7, 0.5], ease: 'smooth' }, { t: 24.0, v: [-1.0, 0.75, 0.5] }] },
      fov: [{ t: 19.6, v: 44 }],
    },
  },
  {
    id: 's05-9-breath', start: 24.0, end: 29.0,
    note: 'close on Haon: she catches her breath, lowers the sword, then turns her head toward the far doorway',
    camera: (() => {
      const yc = yawL + 1.1;
      const eye = (d: number, h: number): Vec3 => add(L, [Math.sin(yc) * d, h, Math.cos(yc) * d]);
      return {
        position: [{ t: 24.0, v: eye(2.0, 1.45), ease: 'smooth' }, { t: 29.0, v: eye(1.75, 1.42) }],
        target: { track: [{ t: 24.0, v: add(L, [0, 1.12, 0]), ease: 'smooth' }, { t: 29.0, v: add(L, [0, 1.2, 0]) }] },
        fov: [{ t: 24.0, v: 40 }],
      };
    })(),
  },
  {
    id: 's05-10-door', start: 29.0, end: 32.0,
    note: 'over her right shoulder toward the dark doorway in the far wall, cold light beyond it',
    camera: (() => {
      const dir: Vec3 = [Math.sin(yawDoor), 0, Math.cos(yawDoor)];
      const right: Vec3 = [-Math.cos(yawDoor), 0, Math.sin(yawDoor)];
      const eye = add(add(add(L, scale(dir, -1.9)), scale(right, 0.6)), [0, 1.8, 0]);
      return {
        position: [{ t: 29.0, v: eye, ease: 'smooth' }, { t: 32.0, v: add(eye, scale(dir, 0.25)) }],
        target: { track: [{ t: 29.0, v: [DOOR_X - 0.2, 1.3, WALL_Z], ease: 'smooth' }, { t: 32.0, v: [DOOR_X, 1.4, WALL_Z] }] },
        fov: [{ t: 29.0, v: 46 }],
      };
    })(),
  },
  {
    id: 's05-11-exit', start: 32.0, end: 40.0,
    note: 'wide, slow pan: Haon walks away screen right, sword lowered in the right hand, ember in the left, out through the far doorway',
    camera: {
      position: [{ t: 32.0, v: [-1.8, 2.1, 4.6], ease: 'smooth' }, { t: 40.0, v: [-0.6, 2.0, 4.0] }],
      target: { track: sample(32.0, 40.0, 0.5, (t) => add(lerp3(hz(t), [DOOR_X, 0, WALL_Z], 0.3), [0, 1.1, 0])) },
      fov: [{ t: 32.0, v: 48 }],
    },
  },
];

const markers: PrevisMarker[] = [
  { t: W1[0], label: 'Haon enters screen left, ember glowing in her left hand' },
  { t: 3.8, label: 'she notices the sword on the floor' },
  { t: T_GRAB, label: 'right hand grips the old sword' },
  { t: T_STAND, label: 'behind her the skeleton she passed starts to rise' },
  { t: T_HEAR, label: 'Haon hears it and turns' },
  { t: T_CHOP + 0.8, label: 'the skeleton lunges and chops where she stood (she sidestepped)' },
  { t: T_SLASH[1], label: 'overhead slash hits the skeleton (impact)' },
  { t: T_DIE, label: 'the skeleton collapses into a heap of bones' },
  { t: T_LOWER[0], label: 'she lowers the sword, breathing' },
  { t: T_LOOK[0], label: 'she looks to the far doorway' },
  { t: W3[0], label: 'she walks out through the far doorway' },
];

// ---- lighting: cold crypt, one dim warm accent (the brazier) ----
const lighting = LIGHT.crypt([
  { position: [DOOR_X, 2.2, -6.2], color: LIGHT.COLD, intensity: 10, range: 8 }, // cold light from deeper in
  { position: [-0.6, 3.6, 2.0], color: LIGHT.COLD, intensity: 7, range: 8 }, // cold top fill over the fight
  { position: [-3.8, 3.0, -1.0], color: LIGHT.COLD, intensity: 4, range: 6 }, // the riser's corner
  { position: add(BRAZIER, [0, 1.3, 0.4]), color: LIGHT.WARM, intensity: 3, range: 5 }, // dim warm accent
]);
lighting.exposure = 1.5;

const doc: PrevisDoc = {
  version: 1,
  title: '불씨지기 S05 버려진 검',
  fps: FPS,
  size: SIZE,
  background: BG,
  worldScale: WORLD_SCALE,
  avoidColors: AVOID,
  lighting,
  roles: ROLES,
  nodes: [...set, ...flatOnly(haonNodes), haon.skin, ember, sword, swordTex, minion, dead],
  shots,
  markers,
};
writeDoc('s05-blade', doc, HERE);
