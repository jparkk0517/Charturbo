// 불씨지기 S06 수문장 (The Warden), 45 s. Run from web/: node --experimental-strip-types previs/examples/film/s06-warden.gen.ts
// Haon enters the deepest vault (west -> east, screen left -> right), sees the altar far away; the giant warden (KayKit
// Skeleton_Warrior, 3.6 m) stands inactive in the middle, awakens, walks at her with heavy steps and chops where she
// stands; she dodges back just before impact and runs to hide behind a pillar; the warden turns to that pillar.
// Shared layout / props / FK: ./s06s07-set.ts (S07 starts from this end state).
import { applyMotion, evaluateFrame, quatToEulerYXZ, walk, worldTransform } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisMarker, PrevisNode, Shot, Track, Vec3 } from '../../../src/previs/index.ts';
import { AVOID, BG, FPS, ROLES, SIZE, add, character, flatOnly, frameTimes, lerp, lerp3, r4, sample, scale, writeDoc, yawTo } from './common.ts';
import {
  C_SPOT, D_SPOT, HERE, WALK_RATE, WY, ALTAR, axeNode, breathe, carryLeft, dist2,
  fwd, haonProps, stripWalk, vaultLighting, vaultSet, wardenJointWorld, wardenNode, axeWorldVerts,
  CHEST_BACK, E_FALL, H_SPOT, IMPACT_CLIP, W1, WC, YAW_APPROACH, YAW_HIDE, YAW_PILLAR,
} from './s06s07-set.ts';

const DUR = 45;

// ---------------------------------------------------------------- timeline
const H_START: Vec3 = [-19.2, 0, 0];
const A1: Vec3 = [-11.6, 0, 0.2]; // first stop: looks down the vault at the altar
const T_IN1 = 7.0;
const T_CREEP0 = 10.0;
const T_CREEP1 = 14.5; // at C_SPOT
const T_AW = 14.0; // the warden awakens
const AW_SPEED = 0.6;
const T_TAUNT = T_AW + 1 / AW_SPEED + 0.25; // Skeletons_Awaken_Standing is 1.0 s
const TAUNT_SPEED = 0.8;
const T_IDLE1 = T_TAUNT + 1.033 / TAUNT_SPEED; // Taunt is 1.033 s
const T_WALK = 19.4;
const WALK_SPEED = 0.7; // clip speed: heavy slow steps
const V_WALK = WALK_RATE * WALK_SPEED; // m/s that matches the planted foot
const CHOP_SPEED = 0.85;
const CHOP_LEN = 1.6333;
const T_GUARD0 = 15.3;
const T_GUARD1 = 16.0;

// ---------------------------------------------------------------- warden placement: the axe head lands on C_SPOT
// chest leans back a little through the bite (tracks.joints, additive): the axe head stops on the floor instead of
// sinking 0.15 m into it (measured on the axe mesh with the FK in s06s07-set.ts)
const chestKeys = (t0: number, speed: number): Track<Vec3> => [
  { t: r4(t0 + 0.7 / speed), v: [0, 0, 0], ease: 'ease-in-out' },
  { t: r4(t0 + 0.86 / speed), v: [CHEST_BACK, 0, 0] },
  { t: r4(t0 + 1.3 / speed), v: [CHEST_BACK, 0, 0], ease: 'ease-in-out' },
  { t: r4(t0 + 1.55 / speed), v: [0, 0, 0] },
];
const chestAt = (tr: Track<Vec3>, t: number): Vec3 => {
  if (t <= tr[0].t) return tr[0].v;
  for (let i = 0; i < tr.length - 1; i++) if (t <= tr[i + 1].t) {
    const u = (t - tr[i].t) / (tr[i + 1].t - tr[i].t);
    const e = tr[i].ease === 'ease-in-out' ? u * u * (3 - 2 * u) : u;
    return lerp3(tr[i].v, tr[i + 1].v, e);
  }
  return tr[tr.length - 1].v;
};
const WALK_DIST = 4.6;
const LUNGE = 0.7; // it stops a little short and lunges into the chop
const WC_PRE: Vec3 = add(WC, scale(fwd(YAW_APPROACH), -LUNGE));
const W0: Vec3 = add(WC_PRE, scale(fwd(YAW_APPROACH), -WALK_DIST)); // inactive spot (east of WC)
const T_STOP = r4(T_WALK + WALK_DIST / V_WALK);
const T_CHOP = r4(T_STOP + 0.45);
const T_IMP = r4(T_CHOP + IMPACT_CLIP / CHOP_SPEED);
const CHEST = chestKeys(T_CHOP, CHOP_SPEED);
// after the chop: turn toward the hiding pillar and close in (S07 starts there)
const T_IDLE2 = r4(T_CHOP + CHOP_LEN / CHOP_SPEED - 0.2);
const T_W2 = r4(T_IMP + 4.4);
const W2_DIST = dist2(WC, W1);
const T_W2END = r4(T_W2 + W2_DIST / V_WALK);
console.log('warden', JSON.stringify({ W0: W0.map((v) => +v.toFixed(3)), WC: WC.map((v) => +v.toFixed(3)), W1: W1.map((v) => +v.toFixed(3)), T_STOP, T_CHOP, T_IMP, T_W2, T_W2END, YAW_PILLAR: +YAW_PILLAR.toFixed(4), H: H_SPOT.map((v) => +v.toFixed(3)) }));

// Haon dodge / run
const T_DODGE0 = r4(T_IMP - 0.5);
const T_DODGE1 = r4(T_IMP - 0.12);
const T_LOWER0 = r4(T_IMP + 0.25);
const T_LOWER1 = r4(T_IMP + 0.8);
const Q_SPOT: Vec3 = [-10.45, 0, 3.4]; // around the west side of the pillar
const T_RUN0 = r4(T_IMP + 0.85);
const RUN_V = 3.4;
const T_RUNQ = r4(T_RUN0 + dist2(D_SPOT, Q_SPOT) / RUN_V);
const T_RUN1 = r4(T_RUNQ + dist2(Q_SPOT, H_SPOT) / (RUN_V * 0.75));
const T_TURNBACK = r4(T_RUN1 + 0.5); // turns her back to the pillar

// ---------------------------------------------------------------- Haon
const yawIn = yawTo(H_START, A1);
const haon = character('haon', H_START, yawIn);
const j = haon.j as unknown as Parameters<typeof stripWalk>[1];
const frags: MotionFragments[] = [];
frags.push(stripWalk(walk({ joints: haon.j, from: H_START, to: A1, start: 0, end: T_IN1, stepsPerSecond: 1.75 }), j));
frags.push(stripWalk(walk({ joints: haon.j, from: A1, to: C_SPOT, start: T_CREEP0, end: T_CREEP1, stepsPerSecond: 1.5 }), j));
const dodge = stripWalk(walk({ joints: haon.j, from: C_SPOT, to: D_SPOT, start: T_DODGE0, end: T_DODGE1, stepsPerSecond: 6 }), j);
delete dodge[j.shoulderR!]; // the sword arm stays in guard while she springs back
dodge[j.root].position![0].ease = 'ease-out';
frags.push(dodge);
const run1 = stripWalk(walk({ joints: haon.j, from: D_SPOT, to: Q_SPOT, start: T_RUN0, end: T_RUNQ, stepsPerSecond: 4.2 }), j);
const run2 = stripWalk(walk({ joints: haon.j, from: Q_SPOT, to: H_SPOT, start: T_RUNQ, end: T_RUN1, stepsPerSecond: 3.6 }), j);
run1[j.root].position![0].ease = 'ease-in';
run2[j.root].position![0].ease = 'ease-out';
frags.push(run1, run2);
frags.push(carryLeft(j, DUR));
// root yaw: one track, smooth turns
const yawC = yawTo(C_SPOT, WC);
const yawRun1 = yawTo(D_SPOT, Q_SPOT);
const yawRun2 = yawTo(Q_SPOT, H_SPOT);
const yawHide = YAW_HIDE; // back to the pillar: faces away from the warden
frags.push({
  [j.root]: {
    rotation: [
      { t: 0, v: [0, yawIn, 0] },
      { t: T_IN1, v: [0, yawIn, 0] },
      { t: T_CREEP0, v: [0, yawIn, 0], ease: 'ease-in-out' },
      { t: T_CREEP0 + 0.5, v: [0, yawTo(A1, C_SPOT), 0] },
      { t: T_CREEP1 - 0.4, v: [0, yawTo(A1, C_SPOT), 0], ease: 'ease-in-out' },
      { t: T_CREEP1, v: [0, yawC, 0] },
      { t: T_RUN0 - 0.15, v: [0, yawC, 0], ease: 'ease-in-out' },
      { t: T_RUN0 + 0.15, v: [0, yawRun1, 0] },
      { t: T_RUNQ - 0.1, v: [0, yawRun1, 0], ease: 'ease-in-out' },
      { t: T_RUNQ + 0.2, v: [0, yawRun2, 0] },
      { t: T_RUN1, v: [0, yawRun2, 0], ease: 'ease-in-out' },
      { t: T_TURNBACK, v: [0, yawHide, 0] },
    ],
  },
});
// head: looks at the far altar at the first stop, up at the giant when it wakes, over her shoulder while hiding
frags.push({
  [j.head]: {
    rotation: [
      { t: T_IN1 - 0.3, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T_IN1 + 0.6, v: [-0.08, 0.05, 0] },
      { t: T_AW + 0.3, v: [-0.08, 0.05, 0], ease: 'ease-in-out' },
      { t: T_AW + 1.2, v: [-0.32, 0, 0] }, // looks up at the 3.6 m giant
      { t: T_RUN0, v: [-0.25, 0, 0], ease: 'ease-in-out' },
      { t: T_RUN0 + 0.4, v: [0, 0, 0] },
      { t: T_TURNBACK + 1.2, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T_TURNBACK + 2.2, v: [0, -1.05, 0] }, // glance back over the right shoulder toward the pillar / warden
      { t: T_TURNBACK + 4.6, v: [0, -1.05, 0], ease: 'ease-in-out' },
      { t: T_TURNBACK + 5.6, v: [0.05, -0.2, 0] },
      { t: DUR - 2.6, v: [0.05, -0.2, 0], ease: 'ease-in-out' },
      { t: DUR - 1.4, v: [0, -1.1, 0] },
    ],
  },
});
// sword arm: guard when the giant wakes, held through the approach and dodge, lowered before the run
frags.push({
  [j.shoulderR!]: {
    rotation: [
      { t: T_GUARD0, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T_GUARD1, v: [-0.75, 0, 0.05] },
      { t: T_LOWER0, v: [-0.75, 0, 0.05], ease: 'ease-in-out' },
      { t: T_LOWER1, v: [0, 0, 0] },
    ],
  },
  [j.elbowR!]: {
    rotation: [
      { t: T_GUARD0, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T_GUARD1, v: [-0.2, 0, 0] },
      { t: T_LOWER0, v: [-0.2, 0, 0], ease: 'ease-in-out' },
      { t: T_LOWER1, v: [-0.15, 0, 0] },
    ],
  },
});
// spine lean: wary crouch-forward while creeping, flinch back at the dodge, run lean, back against the pillar
frags.push({
  [j.spine]: {
    rotation: [
      { t: T_CREEP0, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T_CREEP0 + 0.8, v: [0.12, 0, 0] },
      { t: T_AW + 0.3, v: [0.12, 0, 0], ease: 'ease-in-out' },
      { t: T_AW + 1.2, v: [-0.08, 0, 0] },
      { t: T_DODGE0, v: [-0.08, 0, 0], ease: 'ease-out' },
      { t: T_DODGE1, v: [-0.25, 0, 0], ease: 'ease-in-out' },
      { t: T_RUN0, v: [0.05, 0, 0], ease: 'ease-in-out' },
      { t: T_RUN0 + 0.25, v: [0.3, 0, 0] },
      { t: T_RUN1 - 0.2, v: [0.3, 0, 0], ease: 'ease-in-out' },
      { t: T_TURNBACK, v: [-0.06, 0, 0] },
    ],
  },
});
frags.push(breathe(j, r4(T_TURNBACK + 0.1), DUR, 0.014, 1.3));
const haonNodes = flatOnly(applyMotion(haon.m.nodes, frags));
const props = haonProps(haon.j.handL, haon.j.handR);

// ---------------------------------------------------------------- warden
const wardenPos: Track<Vec3> = [
  { t: T_WALK, v: W0, ease: 'ease-in' },
  { t: r4(T_WALK + 0.8), v: add(W0, scale(fwd(YAW_APPROACH), 0.8 * V_WALK * 0.5)) },
  { t: r4(T_STOP - 0.8), v: add(WC_PRE, scale(fwd(YAW_APPROACH), -0.8 * V_WALK * 0.5)), ease: 'ease-out' },
  { t: T_STOP, v: WC_PRE },
  { t: r4(T_CHOP + 0.5 / CHOP_SPEED), v: WC_PRE, ease: 'ease-in' },
  { t: r4(T_CHOP + 0.84 / CHOP_SPEED), v: WC },
  { t: T_W2, v: WC, ease: 'ease-in-out' },
  { t: T_W2END, v: W1 },
];
const warden = wardenNode('warden', W0, YAW_APPROACH, [
  { clip: 'Skeleton_Inactive_Standing_Pose', loop: 'once' },
  { clip: 'Skeletons_Awaken_Standing', start: T_AW, speed: AW_SPEED, loop: 'once', blendIn: 0.2 },
  { clip: 'Taunt', start: r4(T_TAUNT), speed: TAUNT_SPEED, loop: 'once', blendIn: 0.25 },
  { clip: '2H_Melee_Idle', start: r4(T_IDLE1), loop: 'repeat', blendIn: 0.35 },
  { clip: 'Walking_D_Skeletons', start: T_WALK, speed: WALK_SPEED, loop: 'repeat', blendIn: 0.45 },
  { clip: '2H_Melee_Idle', start: T_STOP, loop: 'repeat', blendIn: 0.4 },
  { clip: '2H_Melee_Attack_Chop', start: T_CHOP, speed: CHOP_SPEED, loop: 'once', blendIn: 0.2 },
  { clip: '2H_Melee_Idle', start: T_IDLE2, loop: 'repeat', blendIn: 0.35 },
  { clip: 'Walking_D_Skeletons', start: T_W2, speed: WALK_SPEED, loop: 'repeat', blendIn: 0.4 },
  { clip: '2H_Melee_Idle', start: T_W2END, loop: 'repeat', blendIn: 0.45 },
], {
  position: wardenPos,
  rotation: [
    { t: T_W2 - 0.6, v: [0, YAW_APPROACH, 0], ease: 'ease-in-out' },
    { t: r4(T_W2 + 0.9), v: [0, YAW_PILLAR, 0] },
  ],
  joints: { chest: CHEST },
});
const axe = axeNode('axe', 'warden');
/** Authored warden node position (no ground-lock offset; y = WY). */
const wAt = (t: number): Vec3 => {
  const k = wardenPos;
  if (t <= k[0].t) return k[0].v;
  for (let i = 0; i < k.length - 1; i++) if (t <= k[i + 1].t) {
    const u = (t - k[i].t) / (k[i + 1].t - k[i].t);
    const e = k[i].ease === 'ease-in' ? u * u : k[i].ease === 'ease-out' ? 1 - (1 - u) * (1 - u) : k[i].ease === 'ease-in-out' ? u * u * (3 - 2 * u) : u;
    return lerp3(k[i].v, k[i + 1].v, e);
  }
  return k[k.length - 1].v;
};

// ---------------------------------------------------------------- checks: axe vs Haon at the chop, axe above the floor
const probeDoc = (nodes: PrevisNode[]): PrevisDoc => ({
  version: 1, fps: FPS, size: SIZE, background: BG, roles: ROLES, nodes,
  shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 8] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
});
const probe = probeDoc([...haonNodes, props.ember, props.sword]);
const wt = (id: string, t: number) => worldTransform(probe, evaluateFrame(probe, t).nodes, id);
{
  let minD = Infinity;
  let at = 0;
  let low = Infinity;
  let lowAt = 0;
  for (const t of frameTimes(T_CHOP, T_CHOP + CHOP_LEN / CHOP_SPEED - 0.05)) {
    const ct = (t - T_CHOP) * CHOP_SPEED;
    if (t < T_CHOP + 0.2) continue; // blend-in from idle
    const slot = wardenJointWorld(wAt(t), YAW_APPROACH, '2H_Melee_Attack_Chop', ct, 'handslot.r', 0, { chest: chestAt(CHEST, t) });
    const corners = axeWorldVerts(slot);
    const h = wt(haon.j.root, t).position;
    for (const c of corners) {
      if (c[1] < 1.75) {
        const d = dist2(c, h);
        if (d < minD) [minD, at] = [d, t];
      }
      if (c[1] < low) [low, lowAt] = [c[1], t];
    }
  }
  console.log('chop: min horizontal axe-corner to Haon root', minD.toFixed(3), 'm at', at, '| lowest axe corner', low.toFixed(3), 'at', lowAt);
  if (minD < 0.6) throw new Error('the axe passes through Haon');
  if (low < -0.03) throw new Error('the axe sinks into the floor');
}

// ---------------------------------------------------------------- set, lights
const set = vaultSet(E_FALL);

// ---------------------------------------------------------------- cameras
const hAt = (t: number) => wt(haon.j.root, t).position;
const T_S9 = r4(T_IMP + 1.5);
const shots: Shot[] = [
  {
    id: 's06-1-vault',
    note: 'establishing: high above the doorway looking down the vault, slow crane down; Haon walks in under the camera and away down the aisle; rows of pillars, the dormant giant in the middle, the altar glowing far east',
    start: 0,
    end: T_IN1,
    camera: {
      position: [
        { t: 0, v: [-18.9, 6.8, 0.9], ease: 'smooth' },
        { t: T_IN1 / 2, v: [-18.4, 5.0, 0.8], ease: 'smooth' },
        { t: T_IN1, v: [-17.6, 3.6, 0.7] },
      ],
      target: { track: [
        { t: 0, v: [-6, 0.2, 0], ease: 'smooth' },
        { t: T_IN1, v: [4, 1.4, 0] },
      ] },
      fov: [{ t: 0, v: 58 }],
    },
  },
  {
    id: 's06-2-altar',
    note: 'over her shoulder, long lens down the vault: the giant sits slumped in the middle, beyond it the altar glows; she stops and stares',
    start: T_IN1,
    end: T_CREEP0,
    camera: {
      position: [
        { t: T_IN1, v: add(A1, [-2.3, 1.78, -0.75]), ease: 'smooth' },
        { t: T_CREEP0, v: add(A1, [-1.9, 1.74, -0.7]) },
      ],
      target: { track: [{ t: T_IN1, v: [ALTAR[0], 1.4, -0.2] }] },
      fov: [{ t: T_IN1, v: 26 }],
    },
  },
  {
    id: 's06-3-creep',
    note: 'side tracking medium: she creeps toward the giant, sword low, ember in her left hand; the giant looms ahead (right)',
    start: T_CREEP0,
    end: T_AW,
    camera: {
      position: sample(T_CREEP0, T_AW, 0.5, (t) => {
        const h = hAt(t);
        return [h[0] - 0.4, 1.35, 3.5];
      }),
      target: { track: sample(T_CREEP0, T_AW, 0.5, (t) => add(hAt(t), [1.6, 1.25, 0])) },
      fov: [{ t: T_CREEP0, v: 46 }],
    },
  },
  {
    id: 's06-4-awaken',
    note: 'low angle up at the giant: its eyes light, it straightens up, taunts, and grips the two-handed axe',
    start: T_AW,
    end: 18.6,
    camera: {
      position: [
        { t: T_AW, v: add(W0, [-5.4, -WY + 0.45, 2.9]), ease: 'smooth' },
        { t: 18.6, v: add(W0, [-4.8, -WY + 0.4, 2.6]) },
      ],
      target: { track: [{ t: T_AW, v: add(W0, [0, 0.1, 0]), ease: 'smooth' }, { t: 18.6, v: add(W0, [0, 0.35, 0]) }] },
      fov: [{ t: T_AW, v: 52 }],
    },
  },
  {
    id: 's06-5-react',
    note: 'close on Haon: she looks up, raises the sword into a guard; ember glow on her left',
    start: 18.6,
    end: 21.2,
    camera: {
      position: [
        { t: 18.6, v: add(C_SPOT, [1.75, 1.42, 1.15]), ease: 'smooth' },
        { t: 21.2, v: add(C_SPOT, [1.5, 1.4, 1.0]) },
      ],
      target: { track: [{ t: 18.6, v: add(C_SPOT, [0, 1.38, 0]) }] },
      fov: [{ t: 18.6, v: 34 }],
    },
  },
  {
    id: 's06-6-approach',
    note: 'low tracking at the giant\'s feet: heavy slow steps across the stone toward her, light handheld jolt per step',
    start: 21.2,
    end: T_STOP,
    camera: {
      position: sample(21.2, T_STOP, 0.5, (t) => {
        const w = wAt(t);
        return [w[0] - 1.5, 0.38, 3.45];
      }),
      target: { track: sample(21.2, T_STOP, 0.5, (t) => add(wAt(t), [-0.9, -WY + 1.05, -0.2])) },
      fov: [{ t: 21.2, v: 66 }],
      shake: { amp: 0.018, freq: 2.2, roll: 0.006, seed: 61 },
    },
  },
  {
    id: 's06-7-ots',
    note: 'over the giant\'s shoulder onto Haon: it raises the axe overhead; she braces, then springs back',
    start: T_STOP,
    end: T_IMP,
    camera: {
      position: [
        { t: T_STOP, v: [WC_PRE[0] + 1.75, 1.75, 3.75], ease: 'smooth' },
        { t: T_IMP, v: [WC_PRE[0] + 1.6, 1.6, 3.65] },
      ],
      target: { track: [{ t: T_STOP, v: add(C_SPOT, [-0.2, 1.3, 0]) }] },
      fov: [{ t: T_STOP, v: 52 }],
    },
  },
  {
    id: 's06-8-impact',
    note: 'IMPACT: wide low side, heavy shake: the axe bites the floor where she stood, she is just clear',
    start: T_IMP,
    end: T_S9,
    camera: {
      position: [{ t: T_IMP, v: [-5.4, 0.7, 7.4] }],
      target: { track: [{ t: T_IMP, v: [-7.3, 1.1, 1.0] }] },
      fov: [{ t: T_IMP, v: 60 }],
      shake: { amp: 0.09, freq: 9, roll: 0.035, seed: 62 },
    },
  },
  {
    id: 's06-9-run',
    note: 'she sprints around the pillar and presses her back to it; light handheld follow',
    start: T_S9,
    end: r4(T_RUN1 + 1.4),
    camera: {
      position: sample(T_S9, r4(T_RUN1 + 1.4), 0.5, (t) => {
        const h = hAt(t);
        return [lerp(-6.4, -7.4, (t - T_S9) / (T_RUN1 + 1.4 - T_S9)), 1.6, 8.4 + 0 * h[0]];
      }),
      target: { track: sample(T_S9, r4(T_RUN1 + 1.4), 0.25, (t) => add(hAt(t), [0.3, 1.1, 0])) },
      fov: [{ t: T_S9, v: 50 }],
      shake: { amp: 0.02, freq: 3, roll: 0.008, seed: 63 },
    },
  },
  {
    id: 's06-10-hide',
    note: 'close: Haon pressed against the pillar, breathing hard, ember held to her chest; she glances back over her shoulder; the giant turns toward the pillar beyond it',
    start: r4(T_RUN1 + 1.4),
    end: 40.4,
    camera: {
      position: [
        { t: r4(T_RUN1 + 1.4), v: add(H_SPOT, [-0.7, 1.5, 2.7]), ease: 'smooth' },
        { t: 40.4, v: add(H_SPOT, [-0.45, 1.46, 2.4]) },
      ],
      target: { track: [{ t: r4(T_RUN1 + 1.4), v: add(H_SPOT, [0.75, 1.4, -0.5]) }] },
      fov: [{ t: r4(T_RUN1 + 1.4), v: 42 }],
    },
  },
  {
    id: 's06-11-standoff',
    note: 'wide, slow push: the giant stands a few meters off, facing her pillar with the axe; Haon hidden behind it on our side',
    start: 40.4,
    end: DUR,
    camera: {
      position: [
        { t: 40.4, v: [-6.0, 3.0, 8.6], ease: 'smooth' },
        { t: DUR, v: [-6.6, 2.6, 8.3] },
      ],
      target: { track: [{ t: 40.4, v: lerp3(H_SPOT, W1, 0.5).map((v, i) => (i === 1 ? 1.5 : v)) as Vec3 }] },
      fov: [{ t: 40.4, v: 50 }],
    },
  },
];

const markers: PrevisMarker[] = [
  { t: 0, label: 'Haon enters the deepest vault through the west doorway, ember in her left hand, sword in her right' },
  { t: T_IN1, label: 'she stops: far east the altar glows; the giant warden kneels slumped in the middle' },
  { t: T_AW, label: 'the giant warden awakens (eyes light, it straightens)' },
  { t: r4(T_TAUNT), label: 'the warden taunts, then grips its two-handed axe' },
  { t: T_WALK, label: 'the warden walks at her: heavy slow steps' },
  { t: T_CHOP, label: 'it raises the axe overhead' },
  { t: T_DODGE0, label: 'Haon springs back' },
  { t: T_IMP, label: 'IMPACT: the axe bites the floor where she stood (stone chips, dust)' },
  { t: T_RUN0, label: 'she sprints to the nearest pillar' },
  { t: T_RUN1, label: 'she presses her back against the pillar, hidden' },
  { t: T_W2, label: 'the warden turns toward her pillar and steps closer' },
  { t: T_W2END, label: 'the warden stops a few meters from the pillar, axe ready' },
];

const doc: PrevisDoc = {
  version: 1,
  title: '불씨지기 S06 수문장',
  fps: FPS,
  size: SIZE,
  background: BG,
  worldScale: 10,
  avoidColors: AVOID,
  lighting: vaultLighting(1.95),
  roles: ROLES,
  nodes: [...set, ...haonNodes, haon.skin, props.ember, props.sword, props.swordTex, warden, axe],
  shots,
  markers,
};
writeDoc('s06-warden', doc, HERE);
// continuity (S07 reads these from s06s07-set + this log)
console.log('end state', JSON.stringify({ haon: hAt(DUR).map((v) => +v.toFixed(3)), haonYaw: +yawHide.toFixed(4), warden: W1.map((v) => +v.toFixed(3)), wardenYaw: +YAW_PILLAR.toFixed(4), E_FALL: E_FALL.map((v) => +v.toFixed(4)) }));
void quatToEulerYXZ;
