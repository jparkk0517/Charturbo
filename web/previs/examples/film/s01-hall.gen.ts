// 불씨지기 S01 "불씨의 전당" (40 s). Run from web/: node --experimental-strip-types previs/examples/film/s01-hall.gen.ts
// 하온 enters the keeper's hall, walks the aisle between sleeping skeletons, crouches to look at one, rises and walks
// to the pedestal where 도원 waits beside the ember; they end facing each other across the pedestal (S02 starts there).
// Set, skeletons, pedestal and lighting: s01s02-set.ts (shared with S02).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, crouch, evalTrack, walk } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisMarker, PrevisNode, Shot, Track, Vec3 } from '../../../src/previs/index.ts';
import { AVOID, BG, C, FPS, LOOK, ROLES, SIZE, add, character, flatOnly, r4, sample, writeDoc, yawTo } from './common.ts';
import {
  EMBER_PED_D, HAON_END, HAON_END_YAW, MENTOR_POS, MENTOR_YAW, PED, SLEEPERS, emberOnPed, hallLighting, hallSet, sleeper, sleeperNode,
} from './s01s02-set.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUR = 40;

// ---- 하온's path ----
const START: Vec3 = [-13.2, 0, 0.0]; // outside the open entrance, in the dark
const SK = sleeper('sk_n2'); // the skeleton she looks at
const SKULL: Vec3 = [SK.pos[0], 0.2, SK.pos[2] - 0.95];
const CS: Vec3 = [-4.3, 0, 1.15]; // crouch spot, in front of the skull
const W2: Vec3 = [0.45, 0, 0.85]; // beside the pedestal, camera side
const T = {
  walk1: [1.0, 12.5],
  turnSkull: [12.5, 13.3],
  crouch: [13.4, 14.6],
  rise: [19.0, 20.2],
  turnOn: [20.2, 20.9],
  walk2: [20.9, 25.6],
  walk3: [25.6, 26.6],
  lookEmber: [27.3, 28.2],
  lookBack: [29.4, 30.2],
  nod: [34.6, 35.8],
} as const;
const yaw1 = yawTo(START, CS);
const yawSkull = yawTo(CS, SKULL);
const yaw2 = yawTo(CS, W2);
const yaw3 = yawTo(W2, HAON_END); // ~pi (she steps toward -z while turning to face 도원)

const haon = character('haon', START, yaw1);
const hj = haon.j;
const frags: MotionFragments[] = [];
const w1 = walk({ joints: hj, from: START, to: CS, start: T.walk1[0], end: T.walk1[1], stepsPerSecond: 1.7 });
const w2 = walk({ joints: hj, from: CS, to: W2, start: T.walk2[0], end: T.walk2[1], stepsPerSecond: 1.8 });
const w3 = walk({ joints: hj, from: W2, to: HAON_END, start: T.walk3[0], end: T.walk3[1], stepsPerSecond: 2 });
for (const w of [w1, w2, w3]) delete w[hj.root].rotation; // yaw authored below (smooth turns)
w3[hj.root].position![0].ease = 'ease-out';
frags.push(w1, w2, w3);
frags.push({
  [hj.root]: {
    rotation: [
      { t: 0, v: [0, yaw1, 0] },
      { t: T.turnSkull[0], v: [0, yaw1, 0], ease: 'ease-in-out' },
      { t: T.turnSkull[1], v: [0, yawSkull, 0] },
      { t: T.turnOn[0], v: [0, yawSkull, 0], ease: 'ease-in-out' },
      { t: T.turnOn[1], v: [0, yaw2, 0] },
      { t: T.walk3[0], v: [0, yaw2, 0], ease: 'ease-in-out' },
      { t: r4((T.walk3[0] + T.walk3[1]) / 2), v: [0, yaw3, 0], ease: 'ease-in-out' },
      { t: T.walk3[1], v: [0, HAON_END_YAW, 0] },
    ],
  },
});
// crouch beside the skeleton: hips down, torso leans in, forearms forward over the knees; rise again
const DEPTH = 0.55;
frags.push(crouch({ mannequin: haon.m, start: T.crouch[0], end: T.crouch[1], depth: DEPTH, fps: FPS }));
frags.push(crouch({ mannequin: haon.m, start: T.rise[0], end: T.rise[1], from: DEPTH, depth: 0, fps: FPS }));
const hold = (a: number, b: number, c: number, d: number, v: Vec3): Track<Vec3> => [
  { t: a, v: [0, 0, 0], ease: 'ease-in-out' },
  { t: b, v },
  { t: c, v, ease: 'ease-in-out' },
  { t: d, v: [0, 0, 0] },
];
frags.push({ [hj.spine]: { rotation: hold(T.crouch[0], T.crouch[1] + 0.2, T.rise[0], T.rise[1], [0.3, 0, 0]) } });
for (const [sh, el] of [[hj.shoulderL!, hj.elbowL!], [hj.shoulderR!, hj.elbowR!]]) {
  frags.push({ [sh]: { rotation: hold(T.crouch[0], T.crouch[1], T.rise[0], T.rise[1], [-0.55, 0, 0]) } });
  frags.push({ [el]: { rotation: hold(T.crouch[0], T.crouch[1], T.rise[0], T.rise[1], [-0.7, 0, 0]) } });
}
// head: looks down at the skull, tilts with curiosity, back up as she rises; later a glance down at the ember
frags.push({
  [hj.head]: {
    rotation: [
      { t: 0, v: [0, 0, 0] },
      { t: T.crouch[0] - 0.2, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T.crouch[1] + 0.3, v: [0.45, 0, 0], ease: 'ease-in-out' },
      { t: 16.4, v: [0.45, 0, 0], ease: 'ease-in-out' },
      { t: 17.0, v: [0.4, 0.22, 0.1], ease: 'ease-in-out' },
      { t: 18.2, v: [0.4, 0.22, 0.1], ease: 'ease-in-out' },
      { t: T.rise[0] + 0.2, v: [0.3, 0, 0], ease: 'ease-in-out' },
      { t: T.rise[1], v: [0, 0, 0] },
      { t: T.lookEmber[0], v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T.lookEmber[1], v: [0.38, 0.05, 0] },
      { t: T.lookBack[0], v: [0.38, 0.05, 0], ease: 'ease-in-out' },
      { t: T.lookBack[1], v: [0, 0, 0] },
    ],
  },
});
const haonNodes = flatOnly(applyMotion(haon.m.nodes, frags));
const rootTrack = haonNodes.find((n) => n.id === hj.root)!.tracks!.position!;
const hpos = (t: number): Vec3 => evalTrack(rootTrack, t, START);

// ---- 도원: stands beside the pedestal looking down at the ember; turns his head to 하온 as she comes round ----
const mentor = character('mentor', MENTOR_POS, MENTOR_YAW);
const mj = mentor.m.joints;
const relYaw = (t: number) => {
  const p = hpos(t);
  let a = yawTo(MENTOR_POS, p) - MENTOR_YAW;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return Math.max(-1.0, Math.min(1.0, a));
};
const mentorNodes = flatOnly(
  applyMotion(mentor.m.nodes, [
    {
      [mj.head]: {
        rotation: [
          { t: 0, v: [0.4, 0, 0] },
          { t: 24.2, v: [0.4, 0, 0], ease: 'ease-in-out' },
          { t: 25.0, v: [0.15, relYaw(25.0), 0], ease: 'ease-in-out' },
          { t: 25.8, v: [0.05, relYaw(25.8), 0], ease: 'ease-in-out' },
          { t: T.walk3[1], v: [0, 0, 0] },
          { t: T.nod[0], v: [0, 0, 0], ease: 'ease-in-out' },
          { t: r4((T.nod[0] + T.nod[1]) / 2), v: [0.22, 0, 0], ease: 'ease-in-out' },
          { t: T.nod[1], v: [0, 0, 0] },
        ],
      },
    },
  ]),
);

// ---- ember on the pedestal (alive) ----
const ember: PrevisNode = {
  id: 'ember', shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.ember,
  position: emberOnPed(EMBER_PED_D), rotation: [0, 0, 0], size: [EMBER_PED_D, EMBER_PED_D, EMBER_PED_D],
};

// ---- cameras (all on the +z side: +x = screen right) ----
const EMB = emberOnPed(EMBER_PED_D);
const T_ARRIVE = 22.4; // cut: from the bay pan to the pedestal
const shots: Shot[] = [
  {
    id: 's01-1-crane',
    note: 'high establishing crane down at the entrance end: the long pillared hall, sleeping skeletons, the ember glowing on the pedestal mid-hall, the sealed gate far away; 하온 walks in under the camera',
    start: 0,
    end: 7,
    camera: {
      position: [
        { t: 0, v: [-11.0, 8.6, 1.6], ease: 'smooth' },
        { t: 3.5, v: [-11.1, 5.2, 1.6], ease: 'smooth' },
        { t: 7, v: [-11.2, 2.3, 1.6] },
      ],
      target: { track: [
        { t: 0, v: [3, 0, 0], ease: 'smooth' },
        { t: 4.5, v: [-2, 0.6, 0], ease: 'smooth' },
        { t: 7, v: add(hpos(7), [3, 0.9, 0]) },
      ] },
      fov: [{ t: 0, v: 55 }],
    },
  },
  {
    id: 's01-2-follow',
    note: 'low tracking follow from behind-left: 하온 walks down the aisle between the rows of sleeping skeletons toward the distant ember',
    start: 7,
    end: 10,
    camera: {
      position: sample(7, 10, 0.25, (t) => add(hpos(t), [-2.2, 0.7, 0.45])),
      target: { track: sample(7, 10, 0.25, (t) => add(hpos(t), [1.2, 1.1, 0])) },
      fov: [{ t: 7, v: 50 }],
    },
  },
  {
    id: 's01-3-track',
    note: 'low side tracking (left to right): she slows, notices a skeleton beside the aisle and turns to it',
    start: 10,
    end: 13.4,
    camera: {
      // behind the +z pillar row, low: pillars and sleeping skeletons pass in the foreground
      position: sample(10, 13.4, 0.25, (t) => [Math.min(hpos(t)[0], CS[0]) + 1.6, 0.85, 4.6]),
      target: { track: sample(10, 13.4, 0.25, (t) => add(hpos(t), [0.3, 0.95, 0])) },
      fov: [{ t: 10, v: 45 }],
    },
  },
  {
    id: 's01-4-skull',
    note: 'close two-layer low shot: the sleeping skull in the foreground, 하온 crouching behind it, studying it; slow push',
    start: 13.4,
    end: 19.6,
    camera: {
      position: [
        { t: 13.4, v: [-2.65, 1.45, 3.1], ease: 'smooth' },
        { t: 19.6, v: [-2.8, 1.4, 2.9] },
      ],
      target: { track: [
        { t: 13.4, v: add(CS, [0.3, 0.8, 0.4]), ease: 'smooth' },
        { t: 15, v: add(CS, [0.3, 0.72, 0.45]), ease: 'smooth' },
        { t: 19.6, v: add(CS, [0.3, 0.76, 0.45]) },
      ] },
      fov: [{ t: 13.4, v: 50 }],
    },
  },
  {
    id: 's01-5-onward',
    note: 'medium-wide pan from the skeleton bay: she rises and walks on toward the pedestal and her teacher (left to right)',
    start: 19.6,
    end: T_ARRIVE,
    camera: {
      // from the skeleton bay behind the +z pillar row; she walks on behind the next pillar (a natural wipe)
      position: [{ t: 19.6, v: [-3.3, 1.55, 4.7] }],
      target: { track: sample(19.6, T_ARRIVE, 0.25, (t) => add(hpos(t), [0.5, 0.95, 0])) },
      fov: [{ t: 19.6, v: 52 }],
    },
  },
  {
    id: 's01-6-arrive',
    note: 'front medium-wide at the pedestal: 도원 stands looking down at the ember; 하온 passes in front and comes round to the far side; he lifts his head to her',
    start: T_ARRIVE,
    end: 26.8,
    camera: {
      position: [
        { t: T_ARRIVE, v: [0.6, 1.6, 3.1], ease: 'smooth' },
        { t: 26.8, v: [0.4, 1.55, 2.8] },
      ],
      target: { track: [
        { t: T_ARRIVE, v: [-1.0, 1.15, 0.3], ease: 'smooth' },
        { t: 26.8, v: [-0.15, 1.15, 0] },
      ] },
      fov: [{ t: T_ARRIVE, v: 50 }],
    },
  },
  {
    id: 's01-7-ember',
    note: 'low insert on the pedestal: the warm ember glowing between the two keepers; 하온 looks down at it',
    start: 26.8,
    end: 30.0,
    camera: {
      position: [
        { t: 26.8, v: [0.2, 0.95, 1.45], ease: 'smooth' },
        { t: 30.0, v: [0.15, 0.97, 1.2] },
      ],
      target: { track: [{ t: 26.8, v: add(EMB, [0, 0.25, 0]) }] },
      fov: [{ t: 26.8, v: 48 }],
    },
  },
  {
    id: 's01-8-ots',
    note: 'over 하온\'s shoulder onto 도원: the old keeper looks at his apprentice across the ember',
    start: 30.0,
    end: 33.6,
    camera: {
      position: [
        { t: 30.0, v: [1.45, 1.66, 0.75], ease: 'smooth' },
        { t: 33.6, v: [1.35, 1.64, 0.68] },
      ],
      target: { track: [{ t: 30.0, v: [-0.82, 1.5, -0.18] }] },
      fov: [{ t: 30.0, v: 40 }],
    },
  },
  {
    id: 's01-9-two',
    note: 'two-shot across the pedestal: 도원 (left) and 하온 (right) face each other, the ember between them; slow push-in; 도원 nods',
    start: 33.6,
    end: DUR,
    camera: {
      position: [
        { t: 33.6, v: [-0.15, 1.5, 3.6], ease: 'smooth' },
        { t: DUR, v: [-0.15, 1.45, 3.1] },
      ],
      target: { track: [{ t: 33.6, v: [-0.15, 1.15, 0] }] },
      fov: [{ t: 33.6, v: 40 }],
    },
  },
];

const markers: PrevisMarker[] = [
  { t: T.walk1[0], label: '하온 steps out of the dark entrance into the hall' },
  { t: T.turnSkull[0], label: 'she notices a skeleton asleep beside the aisle and turns to it' },
  { t: T.crouch[0], label: 'she crouches beside the skull and studies it' },
  { t: T.rise[0], label: 'she rises and walks on toward the pedestal' },
  { t: 24.2, label: '도원 hears her and lifts his head from the ember' },
  { t: T.walk3[1], label: '하온 stops across the pedestal, facing 도원' },
  { t: T.lookEmber[0], label: '하온 glances down at the ember' },
  { t: T.nod[0], label: '도원 nods to her' },
];

const doc: PrevisDoc = {
  version: 1,
  title: '불씨지기 S01 불씨의 전당',
  fps: FPS,
  size: SIZE,
  background: BG,
  avoidColors: AVOID,
  lighting: hallLighting(),
  roles: ROLES,
  nodes: [...hallSet(), ember, ...SLEEPERS.map((s) => sleeperNode(s)), ...haonNodes, haon.skin, ...mentorNodes, mentor.skin],
  shots,
  markers,
};
const dur = writeDoc('s01-hall', doc, HERE);
if (Math.abs(dur - DUR) > 1e-9) throw new Error(`duration ${dur}`);
console.log('haon end', JSON.stringify(hpos(DUR)), 'yaw', HAON_END_YAW.toFixed(3), 'skull', JSON.stringify(SKULL), 'pedestal', JSON.stringify(PED));
