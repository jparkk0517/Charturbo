// 불씨지기 S02 "꺼져 가는 불씨" (40 s). Run from web/: node --experimental-strip-types previs/examples/film/s02-dimming.gen.ts
// Starts in S01's end state (s01s02-set.ts): 하온 and 도원 face each other across the pedestal, the ember alive on it.
// The ember flickers and shrinks (size pulses + a swap to a dim orb), a nearby skeleton stirs (Lie_StandUp started
// and blended back to Lie_Pose), 하온's head snaps to it, 도원 steps aside and points at the sealed gate, 하온 looks,
// takes the ember in her LEFT hand (pickUp + tracks.parent onto haon.handL; the skin's attach rides the hand bone),
// it brightens a little, and she walks toward the gate carrying it in front of her belly while 도원 watches.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, evalTrack, evaluateFrame, pickUp, raiseArm, walk, worldTransform } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisMarker, PrevisNode, Quat, Shot, Track, Vec3 } from '../../../src/previs/index.ts';
import { AVOID, BG, C, EMBER_D, FPS, LOOK, ROLES, SIZE, add, character, flatOnly, r4, sample, sub, writeDoc, yawTo } from './common.ts';
import {
  EMBER_LOW_D, EMBER_PED_D, GATE, HAON_END, HAON_END_YAW, MENTOR_POS, MENTOR_YAW, PED, SLEEPERS, emberOnPed, hallLighting, hallSet, sleeper,
  sleeperNode,
} from './s01s02-set.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUR = 40;

// ---- quaternion helpers (x, y, z, w; same conventions as evaluate.ts) ----
const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const qrot = (q: Quat, v: Vec3): Vec3 => {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
};

// ---- timeline (s) ----
const T = {
  flicker: [2.5, 7.4],
  lookDown: [3.0, 4.0],
  stir: 8.0, // skeleton starts to rise
  settle: 9.3, // ... and sinks back
  snap: [10.0, 10.2], // 하온's head snaps to it (just after the cut to her)
  backToMentor: [11.2, 12.0],
  step: [12.0, 13.2], // 도원 steps aside (clear line to the gate)
  turnGate: [13.2, 14.0],
  point: [13.8, 15.0],
  lookGate: [15.2, 16.6],
  lookBack: [19.0, 20.0],
  pick: [20.0, 21.0, 22.2], // start, grab, end (legs / spine back up)
  carry: 22.0, // left arm in the carry pose
  lower: [21.0, 22.4], // 도원 lowers his arm
  bright: 23.4, // the ember brightens in her hand
  nod: [24.2, 25.0],
  turnGo: [25.0, 26.3],
  walk: [26.3, DUR],
} as const;

// ---- skeleton that stirs ----
const SK = sleeper('sk_f2');
const SKULL: Vec3 = [SK.pos[0] - 0.95 * Math.sin(SK.yaw), 0.25, SK.pos[2] - 0.95 * Math.cos(SK.yaw)];
const wrap = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

// ---- 하온 ----
const haon = character('haon', HAON_END, HAON_END_YAW);
const hj = haon.j;
const yawEmber = yawTo(HAON_END, PED);
const toSkull = wrap(yawTo(HAON_END, SKULL) - HAON_END_YAW); // ~ -1.33 (over her right shoulder)
const BODY_SNAP = -0.45;
const yawLookGate = 0.9; // turned over her left shoulder (toward the camera side), head adds 0.45
const END_POS: Vec3 = [9.0, 0, 0.05];
const yawWalk = yawTo(HAON_END, END_POS);
const frags: MotionFragments[] = [];
frags.push({
  [hj.root]: {
    rotation: [
      { t: 0, v: [0, HAON_END_YAW, 0] },
      { t: T.snap[0], v: [0, HAON_END_YAW, 0], ease: 'ease-out' },
      { t: T.snap[1] + 0.35, v: [0, HAON_END_YAW + BODY_SNAP, 0] },
      { t: T.backToMentor[0], v: [0, HAON_END_YAW + BODY_SNAP, 0], ease: 'ease-in-out' },
      { t: T.backToMentor[1], v: [0, HAON_END_YAW, 0] },
      { t: T.lookGate[0], v: [0, HAON_END_YAW, 0], ease: 'ease-in' },
      { t: r4((T.lookGate[0] + T.lookGate[1]) / 2), v: [0, -0.45, 0], ease: 'ease-out' }, // turns via the camera side
      { t: T.lookGate[1], v: [0, yawLookGate, 0] },
      { t: T.lookBack[0], v: [0, yawLookGate, 0], ease: 'ease-in' },
      { t: r4((T.lookBack[0] + T.lookBack[1]) / 2), v: [0, -0.5, 0], ease: 'ease-out' },
      { t: T.lookBack[1], v: [0, yawEmber, 0] },
      { t: T.turnGo[0], v: [0, yawEmber, 0], ease: 'ease-in' },
      { t: r4((T.turnGo[0] + T.turnGo[1]) / 2), v: [0, -0.15, 0], ease: 'ease-out' },
      { t: T.turnGo[1], v: [0, yawWalk, 0] },
    ],
  },
});
frags.push({
  [hj.head]: {
    rotation: [
      { t: 0, v: [0, 0, 0] },
      { t: T.lookDown[0], v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T.lookDown[1], v: [0.35, 0, 0] },
      { t: T.snap[0], v: [0.35, 0, 0], ease: 'ease-out' }, // snap: fast, ease-out
      { t: T.snap[1], v: [0.22, toSkull - BODY_SNAP, 0] },
      { t: T.backToMentor[0], v: [0.22, toSkull - BODY_SNAP, 0], ease: 'ease-in-out' },
      { t: T.backToMentor[1], v: [0, 0, 0] },
      { t: T.lookGate[0] + 0.3, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T.lookGate[1] + 0.2, v: [-0.06, 0.45, 0] },
      { t: T.lookBack[0], v: [-0.06, 0.45, 0], ease: 'ease-in-out' },
      { t: T.lookBack[1], v: [0.15, 0, 0] },
      // pickUp: eyes on the orb (spine leans), then down at it in her hand, then up to 도원
      { t: T.pick[1], v: [0.3, 0, 0], ease: 'ease-in-out' },
      { t: T.pick[2], v: [0.4, 0.15, 0] },
      { t: T.bright + 0.4, v: [0.4, 0.15, 0], ease: 'ease-in-out' },
      { t: T.nod[0] - 0.2, v: [0, 0, 0] },
    ],
  },
});
// pick the (dim) ember up with the LEFT hand. The hand target is solved so that the orb sits at the carry offset
// in the hand frame when it re-parents (no slide in the palm at the switch).
const CARRY_OFF: Vec3 = [0, -0.09, 0.03];
// carry pose: upper arm near the body (a little forward and in), forearm level across the belly
const CARRY_SH: Vec3 = [-0.15, -0.3, 0];
const CARRY_EL: Vec3 = [-1.2, 0, 0];
const EMB_LOW = emberOnPed(EMBER_LOW_D);
const ORB_SET = { size: [] as Track<Vec3>, pos: [] as Track<Vec3> };
let target: Vec3 = add(EMB_LOW, [0, 0.09, 0]);
let pick = pickUp({ mannequin: haon.m, side: 'left', target, start: T.pick[0], grab: T.pick[1], end: T.pick[2], depth: 0.1, lean: 0.35, fps: FPS, rootPosition: HAON_END, rootYaw: yawEmber });
const probeDoc = (nodes: PrevisNode[]): PrevisDoc => ({
  version: 1, fps: FPS, size: SIZE, background: BG, roles: ROLES,
  nodes, shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 5] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
});
const handAt = (nodes: PrevisNode[], t: number) => {
  const d = probeDoc(nodes);
  return worldTransform(d, evaluateFrame(d, t).nodes, pick.hand);
};
const buildHaon = () => {
  const f: MotionFragments[] = [...frags];
  const pm = structuredClone(pick.motion);
  // the arm keys after the grab are replaced by the carry pose below
  const SHL = hj.shoulderL!;
  const ELL = hj.elbowL!;
  for (const id of [SHL, ELL]) pm[id].rotation = pm[id].rotation!.filter((k: { t: number }) => k.t <= T.pick[1]);
  f.push(pm);
  f.push({ [SHL]: { rotation: [{ t: T.pick[1], v: pm[SHL].rotation!.at(-1)!.v, ease: 'ease-in-out' }, { t: T.carry, v: CARRY_SH }] } });
  f.push({ [ELL]: { rotation: [{ t: T.pick[1], v: pm[ELL].rotation!.at(-1)!.v, ease: 'ease-in-out' }, { t: T.carry, v: CARRY_EL }] } });
  // walk to the gate; the left arm keeps the carry pose (walk's left-shoulder swing removed)
  const w = walk({ joints: hj, from: HAON_END, to: END_POS, start: T.walk[0], end: T.walk[1], stepsPerSecond: 1.5 });
  delete w[hj.root].rotation;
  delete w[SHL];
  f.push(w);
  return applyMotion(haon.m.nodes, f);
};
for (let it = 0; it < 4; it++) {
  const h = handAt(buildHaon(), T.pick[1]);
  const want = sub(EMB_LOW, qrot(h.quaternion, CARRY_OFF)); // hand pivot so that the orb is at CARRY_OFF
  const err = Math.hypot(...sub(want, target));
  target = want;
  pick = pickUp({ mannequin: haon.m, side: 'left', target, start: T.pick[0], grab: T.pick[1], end: T.pick[2], depth: 0.1, lean: 0.35, fps: FPS, rootPosition: HAON_END, rootYaw: yawEmber });
  console.log(`pickUp iteration ${it}: target moved ${err.toFixed(4)} m, miss ${pick.miss.toFixed(4)} m`);
}
if (pick.miss > 0.005) throw new Error(`pickUp misses the ember by ${pick.miss.toFixed(3)} m`);
const haonNodes = flatOnly(buildHaon());
const hGrab = handAt(haonNodes, T.pick[1]);
const capLocal = qrot(qconj(hGrab.quaternion), sub(EMB_LOW, hGrab.position));
console.log('orb in the hand frame at the grab', JSON.stringify(capLocal.map((v) => +v.toFixed(4))), 'want', JSON.stringify(CARRY_OFF));
const rootTrack = haonNodes.find((n) => n.id === hj.root)!.tracks!.position!;
const hpos = (t: number): Vec3 => evalTrack(rootTrack, t, HAON_END);

// ---- ember: two orbs (alive / dim) swapped by visible tracks, same size / position / parent tracks ----
// flicker: [t, diameter, bright?]; the centre stays on the pedestal top while the size changes
const FLICK: [number, number, boolean][] = [
  [0, EMBER_PED_D, true],
  [T.flicker[0], EMBER_PED_D, true],
  [2.8, 0.215, false],
  [3.0, 0.235, true],
  [3.6, 0.2, false],
  [3.75, 0.225, true],
  [4.6, 0.19, false],
  [5.0, 0.215, true],
  [5.3, 0.18, false],
  [5.45, 0.2, true],
  [6.2, 0.17, false],
  [6.8, 0.185, true],
  [T.flicker[1], EMBER_LOW_D, false],
];
for (const [t, d] of FLICK) {
  ORB_SET.size.push({ t, v: [d, d, d] });
  ORB_SET.pos.push({ t, v: emberOnPed(d) });
}
// in her hand: re-parent at the grab (world kept), then the delta tracks hold it (capLocal ~ CARRY_OFF already)
const delta = sub(CARRY_OFF, capLocal);
ORB_SET.pos.push({ t: T.pick[1], v: EMB_LOW, ease: 'ease-in-out' }, { t: r4(T.pick[1] + 0.4), v: add(EMB_LOW, delta) });
// brightens a little in her hand: swap to the live orb with a small swell, settling at the carried diameter
ORB_SET.size.push(
  { t: T.bright, v: [EMBER_LOW_D, EMBER_LOW_D, EMBER_LOW_D], ease: 'ease-out' },
  { t: r4(T.bright + 0.35), v: [0.19, 0.19, 0.19], ease: 'ease-in-out' },
  { t: r4(T.bright + 1.2), v: [EMBER_D, EMBER_D, EMBER_D] },
);
const visTrack = (alive: boolean): Track<boolean> => {
  const tr: Track<boolean> = FLICK.filter((f, i) => i === 0 || f[2] !== FLICK[i - 1][2]).map(([t, , b]) => ({ t, v: b === alive }));
  tr.push({ t: T.bright, v: alive });
  return tr;
};
const orb = (id: string, look: PrevisNode['look'], alive: boolean): PrevisNode => ({
  id, shape: 'sphere', role: 'ember', color: C.ember, look,
  position: emberOnPed(EMBER_PED_D), rotation: [0, 0, 0], size: [EMBER_PED_D, EMBER_PED_D, EMBER_PED_D],
  visible: alive,
  tracks: { visible: visTrack(alive), size: ORB_SET.size, position: ORB_SET.pos, parent: [{ t: T.pick[1], v: { node: pick.hand } }] },
});
const ember = orb('ember', LOOK.ember, true);
const emberDim = orb('ember_dim', LOOK.emberDim, false);

// ---- 도원: looks down, looks at the stirring skeleton, steps aside, points at the gate, watches her go ----
const M2: Vec3 = [-0.8, 0, -0.78];
const GATE_AIM: Vec3 = [GATE[0], 1.9, GATE[2]];
const yawGate = yawTo(M2, GATE_AIM);
const mentor = character('mentor', MENTOR_POS, MENTOR_YAW);
const mj = mentor.m.joints;
const mStep = walk({ joints: mj, from: MENTOR_POS, to: M2, start: T.step[0], end: T.step[1], stepsPerSecond: 1.8 });
delete mStep[mj.root].rotation;
const mToSkull = wrap(yawTo(MENTOR_POS, SKULL) - MENTOR_YAW);
const mLook = (t: number, pitch: number): Vec3 => {
  const p = hpos(t);
  return [pitch, Math.max(-1.0, Math.min(1.0, wrap(yawTo(M2, p) - yawGate))), 0];
};
const mentorNodes = flatOnly(
  applyMotion(mentor.m.nodes, [
    mStep,
    {
      [mj.root]: {
        rotation: [
          { t: 0, v: [0, MENTOR_YAW, 0] },
          { t: T.turnGate[0], v: [0, MENTOR_YAW, 0], ease: 'ease-in-out' },
          { t: T.turnGate[1], v: [0, yawGate, 0] },
        ],
      },
    },
    raiseArm({ joints: mj, side: 'right', start: T.point[0], end: T.point[1], angle: 1.62 }),
    raiseArm({ joints: mj, side: 'right', start: T.lower[0], end: T.lower[1], from: 1.62, angle: 0 }),
    {
      [mj.head]: {
        rotation: [
          { t: 0, v: [0, 0, 0] },
          { t: T.lookDown[0], v: [0, 0, 0], ease: 'ease-in-out' },
          { t: T.lookDown[1] + 0.2, v: [0.4, 0, 0] },
          { t: T.snap[0] + 0.1, v: [0.4, 0, 0], ease: 'ease-in-out' },
          { t: T.snap[1] + 0.4, v: [0.15, Math.min(0.95, mToSkull), 0] },
          { t: T.backToMentor[0], v: [0.15, Math.min(0.95, mToSkull), 0], ease: 'ease-in-out' },
          { t: T.backToMentor[1], v: [0, 0, 0] },
          { t: T.point[0], v: [0, 0, 0], ease: 'ease-in-out' },
          { t: T.point[1], v: [-0.06, 0, 0] },
          { t: T.lookBack[1], v: [-0.06, 0, 0], ease: 'ease-in-out' },
          { t: T.pick[1], v: [0.25, mLook(T.pick[1], 0.25)[1], 0] },
          { t: T.nod[0], v: [0.05, mLook(T.nod[0], 0.05)[1], 0], ease: 'ease-in-out' },
          { t: r4((T.nod[0] + T.nod[1]) / 2), v: [0.25, mLook(T.nod[0], 0.25)[1], 0], ease: 'ease-in-out' },
          { t: T.nod[1], v: [0.03, mLook(T.nod[1], 0.03)[1], 0] },
          // follows her down the aisle
          ...[28, 31, 34, 37, DUR].map((t) => ({ t, v: mLook(t, 0.03), ease: 'ease-in-out' as const })),
        ],
      },
    },
  ]),
);

// ---- the stirring skeleton: Lie_StandUp started, then blended back down into Lie_Pose ----
const sleepers = SLEEPERS.map((s) =>
  s.id === SK.id
    ? sleeperNode(s, [
        { clip: s.clip },
        { clip: 'Lie_StandUp', start: T.stir, speed: 0.75, loop: 'once', blendIn: 0.35 },
        { clip: s.clip, start: T.settle, blendIn: 1.0 },
      ])
    : sleeperNode(s),
);

// ---- cameras (+z side; the pointing OTS sits on the hall axis behind 도원) ----
const EMB = emberOnPed(EMBER_PED_D);
const shots: Shot[] = [
  {
    id: 's02-1-two',
    note: 'continues S01\'s two-shot across the pedestal: 도원 (left) and 하온 (right), the ember glowing between them; it starts to flicker',
    start: 0,
    end: 4.0,
    camera: { position: [{ t: 0, v: [-0.15, 1.45, 3.1] }], target: { track: [{ t: 0, v: [-0.15, 1.15, 0] }] }, fov: [{ t: 0, v: 40 }] },
  },
  {
    id: 's02-2-ember',
    note: 'insert: the ember flickers, dims and shrinks on the pedestal',
    start: 4.0,
    end: 7.8,
    camera: {
      position: [
        { t: 4.0, v: [-0.05, 1.36, 1.24], ease: 'smooth' },
        { t: 7.8, v: [-0.05, 1.32, 0.98] },
      ],
      target: { track: [{ t: 4.0, v: add(EMB, [0, -0.02, 0]) }] },
      fov: [{ t: 4.0, v: 38 }],
    },
  },
  {
    id: 's02-3-stir',
    note: 'close, low: a skeleton beside the aisle stirs, half lifts itself and sinks back',
    start: 7.8,
    end: 9.7,
    camera: {
      position: [
        { t: 7.8, v: [1.75, 0.6, -0.9], ease: 'smooth' },
        { t: 9.7, v: [1.65, 0.58, -1.05] },
      ],
      target: { track: [{ t: 7.8, v: add(SKULL, [0.05, 0.15, -0.45]) }] },
      fov: [{ t: 7.8, v: 48 }],
    },
  },
  {
    id: 's02-4-react',
    note: 'medium: 하온\'s head snaps toward the skeleton behind her (it settles back in the background); 도원 looks too',
    start: 9.7,
    end: 12.0,
    camera: {
      // reverse along the new axis (her <-> the skeleton), from the skeleton's side, low
      position: [{ t: 9.7, v: [1.15, 0.72, -1.45] }],
      target: { track: [{ t: 9.7, v: [0.25, 1.5, 0.1] }] },
      fov: [{ t: 9.7, v: 42 }],
    },
  },
  {
    id: 's02-5-point',
    note: 'over 도원\'s right shoulder down the hall axis: he steps aside and points at the sealed gate far away past 하온; she turns to look',
    start: 12.0,
    end: 16.4,
    camera: {
      position: [
        { t: 12.0, v: [-2.3, 1.85, 0.05], ease: 'smooth' },
        { t: 16.4, v: [-2.15, 1.82, 0.0] },
      ],
      target: { track: [{ t: 12.0, v: [3.0, 1.45, -0.2] }] },
      fov: [{ t: 12.0, v: 42 }],
    },
  },
  {
    id: 's02-6-look',
    note: 'medium on 하온: she has turned and looks down the hall at the gate, 도원 still pointing behind her',
    start: 16.4,
    end: 19.4,
    camera: {
      position: [
        { t: 16.4, v: [1.45, 1.5, 2.55], ease: 'smooth' },
        { t: 19.4, v: [1.35, 1.5, 2.4] },
      ],
      target: { track: [{ t: 16.4, v: [0.0, 1.35, -0.2] }] },
      fov: [{ t: 16.4, v: 42 }],
    },
  },
  {
    id: 's02-7-pickup',
    note: 'medium on the pickup: 하온 takes the dimmed ember from the pedestal with her left hand and draws it in front of her',
    start: 19.4,
    end: 23.0,
    camera: {
      position: [
        { t: 19.4, v: [0.85, 1.35, 1.9], ease: 'smooth' },
        { t: 23.0, v: [0.75, 1.32, 1.75] },
      ],
      target: { track: [{ t: 19.4, v: [0.15, 1.05, 0.1] }] },
      fov: [{ t: 19.4, v: 44 }],
    },
  },
  {
    id: 's02-8-glow',
    note: 'close on 하온 and the ember in her hand: it brightens a little; she looks up to 도원, he nods; she turns toward the gate',
    start: 23.0,
    end: 26.4,
    camera: {
      position: [
        { t: 23.0, v: [0.55, 1.2, 1.55], ease: 'smooth' },
        { t: 26.4, v: [0.6, 1.2, 1.45] },
      ],
      target: { track: [{ t: 23.0, v: [0.3, 1.3, 0.1] }] },
      fov: [{ t: 23.0, v: 42 }],
    },
  },
  {
    id: 's02-9-follow',
    note: 'side tracking, left to right: 하온 walks down the aisle toward the gate holding the ember in front of her',
    start: 26.4,
    end: 33.5,
    camera: {
      position: sample(26.4, 33.5, 0.25, (t) => [hpos(t)[0] + 0.4, 1.35, 2.2]),
      target: { track: sample(26.4, 33.5, 0.25, (t) => add(hpos(t), [0.35, 1.0, 0])) },
      fov: [{ t: 26.4, v: 46 }],
    },
  },
  {
    id: 's02-10-wide',
    note: 'final wide from behind 도원: the old keeper watches, 하온 small in the aisle walking toward the sealed gate with the ember',
    start: 33.5,
    end: DUR,
    camera: {
      position: [
        { t: 33.5, v: [-2.7, 1.9, 0.25], ease: 'smooth' },
        { t: DUR, v: [-2.5, 2.05, 0.2] },
      ],
      target: { track: [{ t: 33.5, v: [6.0, 1.15, -0.2], ease: 'smooth' }, { t: DUR, v: [7.5, 1.2, -0.2] }] },
      fov: [{ t: 33.5, v: 40 }],
    },
  },
];

const markers: PrevisMarker[] = [
  { t: T.flicker[0], label: 'the ember on the pedestal starts to flicker' },
  { t: T.flicker[1], label: 'the ember is dim and small' },
  { t: T.stir, label: 'a skeleton beside the aisle stirs and half lifts itself' },
  { t: T.snap[0], label: '하온\'s head snaps toward it; the skeleton sinks back' },
  { t: T.step[0], label: '도원 steps aside' },
  { t: T.point[0], label: '도원 raises his right arm and points at the sealed gate' },
  { t: T.lookGate[0], label: '하온 turns and looks at the gate' },
  { t: T.pick[1], label: '하온 takes the ember from the pedestal with her left hand' },
  { t: T.bright, label: 'the ember brightens a little in her hand' },
  { t: T.nod[0], label: '도원 nods' },
  { t: T.walk[0], label: '하온 walks toward the gate carrying the ember' },
];

const doc: PrevisDoc = {
  version: 1,
  title: '불씨지기 S02 꺼져 가는 불씨',
  fps: FPS,
  size: SIZE,
  background: BG,
  avoidColors: AVOID,
  lighting: hallLighting(),
  roles: ROLES,
  nodes: [...hallSet(), ember, emberDim, ...sleepers, ...haonNodes, haon.skin, ...mentorNodes, mentor.skin],
  shots,
  markers,
};
const dur = writeDoc('s02-dimming', doc, HERE);
if (Math.abs(dur - DUR) > 1e-9) throw new Error(`duration ${dur}`);
// self-check: the carried orb stays in front of the body at belly height while she walks
{
  const full = probeDoc(doc.nodes);
  let lo = Infinity;
  let hi = -Infinity;
  for (let t = T.carry; t <= DUR; t += 0.25) {
    const y = worldTransform(full, evaluateFrame(full, t).nodes, 'ember').position[1];
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  console.log('carried ember height (m)', lo.toFixed(3), '..', hi.toFixed(3), 'haon end', JSON.stringify(hpos(DUR)));
}
