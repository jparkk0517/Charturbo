// S03 봉인의 문 (35 s). node --experimental-strip-types previs/examples/film/s03-gate.gen.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, walk, raiseArm } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisNode, PrevisMarker, Vec3, Track } from '../../../src/previs/index.ts';
import { AVOID, BG, C, EMBER_D, FPS, LIGHT, LOOK, PILLAR_FLAT, ROLES, SIZE, SRC, STONE, character, flatOnly, lerp, sample, writeDoc } from './common.ts';
import type { Rgb } from '../../../src/previs/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GATE_X = 6; // wall plane x = 6, hall at x < 6, crypt at x > 6
const OPEN_W = 2.4;
const OPEN_H = 3;
const FACE = Math.PI / 2; // facing +x

// ---- timeline ----
const X0 = -3.2;
const X_STOP = 4.6;
const T_WALK_IN = [0.6, 7.0] as const;
const T_RAISE = [8.0, 9.6] as const;
const T_GATE_UP = [10.0, 16.0] as const;
const T_LOWER = [16.2, 17.6] as const;
const T_WALK_OUT = [17.6, 35.0] as const;
const X_END = 18.6;
const T_SLAM = 22.4;
const LIFT = 3.1;

const haonX = (t: number) => {
  if (t <= T_WALK_IN[0]) return X0;
  if (t < T_WALK_IN[1]) return lerp(X0, X_STOP, (t - T_WALK_IN[0]) / (T_WALK_IN[1] - T_WALK_IN[0]));
  if (t <= T_WALK_OUT[0]) return X_STOP;
  return lerp(X_STOP, X_END, (t - T_WALK_OUT[0]) / (T_WALK_OUT[1] - T_WALK_OUT[0]));
};

// ---- hero ----
const haon = character('haon', [X0, 0, 0], FACE);
const j = haon.j;
const w1 = walk({ joints: haon.m.joints, from: [X0, 0, 0], to: [X_STOP, 0, 0], start: T_WALK_IN[0], end: T_WALK_IN[1], stepsPerSecond: 1.7 });
const w2 = walk({ joints: haon.m.joints, from: [X_STOP, 0, 0], to: [X_END, 0, 0], start: T_WALK_OUT[0], end: T_WALK_OUT[1], stepsPerSecond: 1.5 });
for (const w of [w1, w2]) {
  delete w[j.shoulderL!]; // left arm holds the carry pose
  w[j.root].position![0].ease = 'ease-in-out';
}
const CARRY_S = 0.5;
const CARRY_E = -1.1;
const HIGH = 2.5;
const arm: MotionFragments[] = [
  raiseArm({ joints: j, side: 'left', start: T_RAISE[0], end: T_RAISE[1], from: CARRY_S, angle: HIGH }),
  raiseArm({ joints: j, side: 'left', start: T_LOWER[0], end: T_LOWER[1], from: HIGH, angle: CARRY_S }),
  {
    [j.elbowL!]: {
      rotation: [
        { t: 0, v: [CARRY_E, 0, 0] },
        { t: T_RAISE[0], v: [CARRY_E, 0, 0], ease: 'ease-in-out' },
        { t: T_RAISE[1], v: [-0.15, 0, 0] },
        { t: T_LOWER[0], v: [-0.15, 0, 0], ease: 'ease-in-out' },
        { t: T_LOWER[1], v: [CARRY_E, 0, 0] },
      ],
    },
    [j.head]: {
      rotation: [
        { t: 0, v: [0, 0, 0] },
        { t: 14.5, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 16.4, v: [0, 0.4, 0], ease: 'ease-in-out' },
        { t: 17.2, v: [0, -0.35, 0], ease: 'ease-in-out' },
        { t: 17.9, v: [0, 0, 0] },
      ],
    },
  },
];
const hn = flatOnly(applyMotion(haon.m.nodes, [w1, w2, ...arm]));
const ember: PrevisNode = {
  id: 'ember', shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.ember, parent: j.handL,
  position: [0, -0.02, 0.05], rotation: [0, 0, 0], size: [EMBER_D, EMBER_D, EMBER_D],
};

// ---- set ----
const WALL_T = 1.0;
const WALL_H = 6.6;
// flat colors: walls [0.27, 0.26, 0.28], floors STONE, jambs / arch PILLAR_FLAT (the flat pass separates set pieces only by color)
const stone = (id: string, pos: Vec3, size: Vec3, look = LOOK.wall, color: Rgb = [0.27, 0.26, 0.28]): PrevisNode => ({
  id, shape: 'box', color, look, position: pos, rotation: [0, 0, 0], size,
});
const pillar = (id: string, pos: Vec3): PrevisNode => ({
  id, shape: 'model', color: PILLAR_FLAT, model: { src: SRC.pillar, fit: 'contain' }, position: [pos[0], 2, pos[2]], rotation: [0, 0, 0], size: [1.5, 4, 1.5],
});
const SIDE = 12; // wall flank length each side
const set: PrevisNode[] = [
  stone('floor_hall', [-4, -0.25, 0], [20, 0.5, 20], LOOK.floor, STONE),
  stone('floor_crypt', [GATE_X + 11, -0.25, 0], [22, 0.5, 20], LOOK.darkStone, STONE),
  // wall: two flanks, lintel and upper mass
  stone('wall_l', [GATE_X, WALL_H / 2, -(OPEN_W / 2 + SIDE / 2)], [WALL_T, WALL_H, SIDE]),
  stone('wall_r', [GATE_X, WALL_H / 2, OPEN_W / 2 + SIDE / 2], [WALL_T, WALL_H, SIDE]),
  stone('lintel', [GATE_X, OPEN_H + (WALL_H - OPEN_H) / 2, 0], [WALL_T, WALL_H - OPEN_H, OPEN_W], LOOK.darkStone),
  // jambs stand 5 cm proud of the wall face and of the opening sides (coplanar faces z-fight)
  stone('jamb_l', [GATE_X - 0.4, OPEN_H / 2, -(OPEN_W / 2 + 0.15)], [0.3, OPEN_H, 0.4], LOOK.pillar, PILLAR_FLAT),
  stone('jamb_r', [GATE_X - 0.4, OPEN_H / 2, OPEN_W / 2 + 0.15], [0.3, OPEN_H, 0.4], LOOK.pillar, PILLAR_FLAT),
  stone('arch_front', [GATE_X - 0.4, OPEN_H - 0.15, 0], [0.3, 0.3, OPEN_W + 0.8], LOOK.pillar, PILLAR_FLAT),
  pillar('pillar_h1', [1.0, 0, -3.6]),
  pillar('pillar_h2', [1.0, 0, 3.6]),
  pillar('pillar_h3', [-3.5, 0, -3.6]),
  pillar('pillar_c1', [9.5, 0, -3.4]),
  pillar('pillar_c2', [9.5, 0, 3.4]),
  pillar('pillar_c3', [14.0, 0, -3.4]),
  pillar('pillar_c4', [14.0, 0, 3.4]),
  pillar('pillar_c5', [18.5, 0, -3.4]),
  pillar('pillar_c6', [18.5, 0, 3.4]),
  stone('crypt_end', [24, 3, 0], [1, 6, 20]),
  stone('wall_back_l', [-4, 3, -10], [20, 6, 1]),
  stone('wall_back_r', [-4, 3, 10], [20, 6, 1]),
  stone('wall_crypt_l', [GATE_X + 11, 3, -10], [22, 6, 1]),
  stone('wall_crypt_r', [GATE_X + 11, 3, 10], [22, 6, 1]),
];

// portcullis: one pivot (y track lifts all bars)
const gateRise = (): Track<Vec3> => [
  { t: 0, v: [GATE_X, 0, 0] },
  { t: T_GATE_UP[0], v: [GATE_X, 0, 0], ease: 'ease-in' },
  { t: 11.2, v: [GATE_X, 0.6, 0], ease: 'ease-in-out' },
  { t: 11.7, v: [GATE_X, 0.62, 0], ease: 'ease-in-out' },
  { t: 13.4, v: [GATE_X, 1.9, 0], ease: 'ease-in-out' },
  { t: 13.8, v: [GATE_X, 1.92, 0], ease: 'ease-in-out' },
  { t: T_GATE_UP[1], v: [GATE_X, LIFT, 0] },
  { t: T_SLAM, v: [GATE_X, LIFT, 0], ease: 'ease-in' },
  { t: T_SLAM + 0.32, v: [GATE_X, 0, 0] },
];
const gate: PrevisNode[] = [
  { id: 'gate', shape: 'box', role: 'gate', color: C.gate, position: [GATE_X, 0, 0], rotation: [0, 0, 0], size: [0.1, 0.1, 0.1], visible: false, tracks: { position: gateRise() } },
];
const BAR_H = OPEN_H + 0.05;
for (let i = 0; i <= 12; i++) {
  const z = -OPEN_W / 2 + 0.1 + (i * (OPEN_W - 0.2)) / 12;
  gate.push({ id: `gbar_v${i}`, shape: 'box', role: 'gate', color: C.gate, look: LOOK.iron, parent: 'gate', position: [0, BAR_H / 2, z], rotation: [0, 0, 0], size: [0.08, BAR_H, 0.08] });
}
[0.35, 0.95, 1.55, 2.15, 2.8].forEach((y, k) =>
  gate.push({ id: `gbar_h${k}`, shape: 'box', role: 'gate', color: C.gate, look: LOOK.iron, parent: 'gate', position: [0.02, y, 0], rotation: [0, 0, 0], size: [0.07, 0.08, OPEN_W - 0.1] }),
);
for (let i = 0; i <= 12; i += 2) {
  const z = -OPEN_W / 2 + 0.1 + (i * (OPEN_W - 0.2)) / 12;
  gate.push({ id: `gspike${i}`, shape: 'box', role: 'gate', color: C.gate, look: LOOK.iron, parent: 'gate', position: [0, 0.05, z], rotation: [0, 0, 0], size: [0.12, 0.22, 0.12] });
}

// ---- lighting: warm hall (x < 6) vs cold crypt ----
const WARM = LIGHT.WARM;
const COLD = LIGHT.COLD;
const lighting: PrevisDoc['lighting'] = {
  key: { dir: [-0.3, 0.9, 0.35], intensity: 0.85, shadows: true },
  env: { sky: [0.42, 0.44, 0.58], ground: [0.18, 0.16, 0.18], intensity: 1.0 },
  rim: [
    { position: [2.0, 2.4, 3.2], color: WARM, intensity: 6, range: 9 },
    { position: [3.0, 2.8, -3.0], color: WARM, intensity: 5, range: 9 },
    { position: [-2.5, 2.6, 0], color: WARM, intensity: 4, range: 8 },
    { position: [7.8, 1.6, 0], color: COLD, intensity: 6, range: 8 },
    { position: [11, 3.0, 2.2], color: COLD, intensity: 6, range: 9 },
    { position: [11, 3.0, -2.2], color: COLD, intensity: 6, range: 9 },
    { position: [16, 3.0, 0], color: COLD, intensity: 6, range: 9 },
    { position: [21, 3.0, 0], color: COLD, intensity: 5, range: 9 },
  ],
  exposure: 1.75,
  toneMapping: 'aces',
};

// ---- camera ----
const shots: PrevisDoc['shots'] = [
  {
    id: 's03-1-approach', note: 'wide side profile: Haon walks left to right toward the sealed gate, warm hall behind, ember at her belly', start: 0, end: 7,
    camera: {
      position: [{ t: 0, v: [-0.5, 1.6, 8], ease: 'smooth' }, { t: 7, v: [2.2, 1.55, 7.6] }],
      target: { track: [{ t: 0, v: [1.5, 1.7, 0], ease: 'smooth' }, { t: 7, v: [3.4, 1.9, 0] }] },
      fov: [{ t: 0, v: 52 }],
    },
  },
  {
    id: 's03-2-silhouette', note: 'low frontal from the crypt side through the bars: her silhouette, warm backlight, she raises the ember', start: 7, end: 10.5,
    camera: {
      position: [{ t: 7, v: [9.5, 0.7, 0.7], ease: 'smooth' }, { t: 10.5, v: [9.0, 0.8, 0.5] }],
      target: { track: [{ t: 7, v: [4.6, 1.5, 0], ease: 'smooth' }, { t: 10.5, v: [4.7, 1.9, 0] }] },
      fov: [{ t: 7, v: 42 }],
    },
  },
  {
    id: 's03-3-ember-close', note: 'close-up of the raised ember and her left hand; gate begins to grind, slight shake', start: 10.5, end: 13.5,
    camera: {
      position: [{ t: 10.5, v: [2.9, 2.0, -2.2], ease: 'smooth' }, { t: 13.5, v: [3.4, 2.1, -1.8] }],
      target: { track: [{ t: 10.5, v: [4.7, 2.0, -0.1], ease: 'smooth' }, { t: 13.5, v: [4.7, 2.05, -0.1] }] },
      fov: [{ t: 10.5, v: 40 }],
      shake: { amp: 0.012, freq: 6, roll: 0.006, seed: 3 },
    },
  },
  {
    id: 's03-4-bars-rise', note: 'low angle on the portcullis rising; cold light spills through; she lowers the arm and looks through', start: 13.5, end: 17.6,
    camera: {
      position: [{ t: 13.5, v: [3.6, 0.35, -2.2], ease: 'smooth' }, { t: 17.6, v: [3.4, 0.5, -2.6] }],
      target: { track: [{ t: 13.5, v: [6, 1.6, 0.3], ease: 'smooth' }, { t: 16, v: [5.6, 2.0, 0.2], ease: 'smooth' }, { t: 17.6, v: [5.0, 1.5, 0] }] },
      fov: [{ t: 13.5, v: 62 }],
      shake: { amp: 0.02, freq: 5, roll: 0.01, seed: 5 },
    },
  },
  {
    id: 's03-5-follow-under', note: 'follow from behind as she walks under the lifted gate into the cold corridor', start: 17.6, end: 21.6,
    camera: {
      position: sample(17.6, 21.6, 1 / 6, (t) => [haonX(t) - 3.0, 1.55, 0.3]),
      target: { track: sample(17.6, 21.6, 1 / 6, (t) => [haonX(t) + 2.5, 1.3, 0]) },
      fov: [{ t: 17.6, v: 56 }],
    },
  },
  {
    id: 's03-6-slam', note: 'reverse from the crypt side: she walks toward camera, the portcullis slams down behind her, shake', start: 21.6, end: 25,
    camera: {
      position: [{ t: 21.6, v: [12.8, 1.3, -1.8], ease: 'smooth' }, { t: 25, v: [13.4, 1.4, -2.0] }],
      target: { track: [{ t: 21.6, v: [7.4, 1.5, 0], ease: 'smooth' }, { t: 25, v: [9.5, 1.5, 0] }] },
      fov: [{ t: 21.6, v: 50 }],
      shake: { amp: 0.045, freq: 4, roll: 0.02, seed: 7 },
    },
  },
  {
    id: 's03-7-crypt-profile', note: 'medium side tracking from her left in the crypt: she walks on, cold light, closed gate receding', start: 25, end: 30,
    camera: {
      position: sample(25, 30, 1 / 6, (t) => [haonX(t) + 0.6, 1.3, -2.4]),
      target: { track: sample(25, 30, 1 / 6, (t) => [haonX(t) + 1.2, 1.3, 0]) },
      fov: [{ t: 25, v: 48 }],
    },
  },
  {
    id: 's03-8-deeper', note: 'low behind her, facing deeper into the crypt: pillars and cold rims ahead, ember glowing in her left hand', start: 30, end: 35,
    camera: {
      position: sample(30, 35, 1 / 6, (t) => [haonX(t) - 1.4, 1.2, -2.0]),
      target: { track: sample(30, 35, 1 / 6, (t) => [haonX(t) + 3.0, 1.3, 0.2]) },
      fov: [{ t: 30, v: 52 }],
    },
  },
];
const markers: PrevisMarker[] = [
  { t: T_WALK_IN[1], label: 'Haon stops before the bars' },
  { t: T_RAISE[1], label: 'ember held high' },
  { t: T_GATE_UP[0], label: 'portcullis starts to grind up' },
  { t: T_GATE_UP[1], label: 'portcullis fully raised, cold light reveals corridor' },
  { t: T_LOWER[1], label: 'arm lowered, she looks through' },
  { t: 19.6, label: 'Haon passes under the gate line' },
  { t: T_SLAM, label: 'portcullis slams down behind her (shake)' },
];
const doc: PrevisDoc = {
  version: 1, title: '불씨지기 S03 봉인의 문', fps: FPS, size: SIZE, background: BG, worldScale: 10, avoidColors: AVOID,
  lighting, roles: ROLES,
  nodes: [...set, ...gate, ...hn, haon.skin, ember],
  shots, markers,
};
writeDoc('s03-gate', doc, HERE);
