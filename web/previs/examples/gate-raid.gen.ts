// Generator for gate-raid.json (original dungeon-gate hunter action previs, 8 s, 1280x720).
// Run from web/: node --experimental-strip-types previs/examples/gate-raid.gen.ts
// Optional env HANDOFF_OUT=<path.md> also writes the Korean handoff (upload order + prompt).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, attachProp, createMannequin, jump, raiseArm, walk } from '../../src/previs/mannequin.ts';
import type { MotionFragments } from '../../src/previs/mannequin.ts';
import { buildHandoff, suggestRoleColors } from '../../src/previs/handoff.ts';
import { validateDoc } from '../../src/previs/validate.ts';
import { evaluateFrame, worldPosition } from '../../src/previs/evaluate.ts';
import type { PrevisDoc, PrevisNode, Rgb, Shot, Track, Vec3 } from '../../src/previs/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const DUR = 8;

// ---- layout (meters) ----
const HERO_START: Vec3 = [0, 0, 2];
const GATE_Z = -6;
const GATE_D = 3.4;
const GIANT_H = 3.2;
const GIANT_HALF = GIANT_H / 2; // node origin = centre of the rest-pose bounds
const GIANT_FROM_Z = -6.8; // behind the gate disc
const GIANT_STOP_Z = GATE_Z + 2.5; // -3.5
const DASH_END: Vec3 = [0.5, 0, -2.2]; // in front of the giant's raised (+x) arm
const SIDESTEP_END: Vec3 = [-1.2, 0, -2.0]; // clear of the swing
const LAND: Vec3 = [-2.0, 0, -4.4]; // behind the giant
const WARRIOR_H = 1.8;

// ---- timeline (seconds) ----
const T_EMERGE = 1.5;
const T_STOP = 3.0;
const T_DASH = 3.0;
const T_DASH_END = 3.55;
const T_SIDE_END = 3.85;
const T_TAKE = 4.8;
const AIR = 1.2;
const T_LAND = T_TAKE + AIR; // 6.0
const JUMP_H = 2.2;
const T_TOPPLE = 6.1;
const TOPPLE = 0.8;
// 1.4 rad (the brief) leaves the head 0.5 m in the air because the pivot is the toe; 1.6 lays the body flat
const TOPPLE_RX = 1.6;
const RISE = [6.4, 6.6, 6.8];
const RISE_DUR = 0.6;

// ---- colors ----
const STONE: Rgb = [0.2, 0.2, 0.22];
const STONE_LIGHT: Rgb = [0.27, 0.26, 0.28];
const BG: Rgb = [0.035, 0.035, 0.05];
const avoid: Rgb[] = [
  STONE, // dark stone grey (floor, walls)
  STONE_LIGHT,
  [0.05, 0.05, 0.06], // black outfit
  [0.87, 0.68, 0.55], // light skin
  [0.6, 0.42, 0.3], // darker skin
  [0.45, 0.35, 0.95], // gate glow blue-violet
  [0.3, 0.25, 0.8], // deeper gate glow
];
const [cHero, cSword, cGiant, cGate, cShadow] = suggestRoleColors(5, avoid);
// the club gets its own color, picked with every existing role color in avoid so those stay unchanged
const [cClub] = suggestRoleColors(1, [...avoid, cHero, cSword, cGiant, cGate, cShadow]);
const roles = [
  { id: 'hero', label: 'hunter (hero)', color: cHero, reference: 'hero face sheet' },
  { id: 'sword', label: 'sword (right hand)', color: cSword },
  { id: 'giant', label: 'stone giant (gate monster)', color: cGiant, reference: 'giant design' },
  { id: 'gate', label: 'gate portal', color: cGate },
  { id: 'shadow', label: 'shadow warriors', color: cShadow, reference: 'shadow warrior design' },
  { id: 'club', label: 'stone club (giant right hand)', color: cClub },
];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

// ---- hero ----
const m = createMannequin({ id: 'hero', color: cHero, role: 'hero', height: 1.78, position: HERO_START, limbs: 'full' });
const j = m.joints;
// Sword: blade box 0.05 x 0.9 x 0.02 on the right hand, pivoting about the grip and angled forward
// (rx = GRIP) so it points forward-down when the arm hangs and up-back when the arm is overhead.
const GRIP = -1.0;
const BLADE = 0.9;
const half = BLADE / 2 + 0.04;
let heroNodes = attachProp(m.nodes, j.handR!, {
  id: 'sword',
  size: [0.05, BLADE, 0.02],
  color: cSword,
  role: 'sword',
  offset: [0, -half * Math.cos(GRIP), -half * Math.sin(GRIP)],
});
heroNodes.find((n) => n.id === 'sword')!.rotation = [GRIP, 0, 0];
heroNodes.find((n) => n.id === j.root)!.rotation = [0, Math.PI, 0]; // faces the gate (-z)

const frags: MotionFragments[] = [];
const FACE_GATE: Vec3 = [0, Math.PI, 0];
// dash (fast run) then sidestep (keeps facing the gate)
const dash = walk({ joints: j, from: HERO_START, to: DASH_END, start: T_DASH, end: T_DASH_END, stepsPerSecond: 7 });
const side = walk({ joints: j, from: DASH_END, to: SIDESTEP_END, start: T_DASH_END, end: T_SIDE_END, stepsPerSecond: 6 });
dash[j.root].position![0].ease = 'ease-in';
side[j.root].position![0].ease = 'ease-out';
delete dash[j.root].rotation;
delete side[j.root].rotation;
frags.push(dash, side);
// root yaw: face the gate the whole time, slight lean into the dash direction, turn to the fallen giant after landing
frags.push({
  [j.root]: {
    rotation: [
      { t: 0, v: FACE_GATE },
      { t: T_DASH, v: FACE_GATE, ease: 'ease-out' },
      { t: T_DASH + 0.15, v: [0, Math.PI - 0.15, 0] },
      { t: T_DASH_END, v: [0, Math.PI - 0.15, 0], ease: 'ease-out' },
      { t: T_SIDE_END, v: FACE_GATE },
      { t: T_LAND + 0.1, v: FACE_GATE, ease: 'ease-in-out' },
      { t: T_LAND + 0.7, v: [0, Math.PI * 1.75, 0] },
    ],
  },
});
// forward lean of the spine while dashing, crouch before takeoff, crouch on landing
frags.push({
  [j.spine]: {
    rotation: [
      { t: T_DASH, v: [0, 0, 0], ease: 'ease-out' },
      { t: T_DASH + 0.15, v: [0.35, 0, 0] },
      { t: T_DASH_END, v: [0.35, 0, 0], ease: 'ease-in-out' },
      { t: T_SIDE_END + 0.1, v: [0, 0, 0] },
      { t: T_TAKE - 0.3, v: [0, 0, 0], ease: 'ease-in' },
      { t: T_TAKE - 0.05, v: [0.4, 0, 0], ease: 'ease-out' },
      { t: T_TAKE + 0.25, v: [-0.15, 0, 0], ease: 'ease-in-out' },
      { t: T_LAND - 0.1, v: [0, 0, 0], ease: 'ease-out' },
      { t: T_LAND + 0.12, v: [0.45, 0, 0], ease: 'ease-in-out' },
      { t: T_LAND + 0.7, v: [0.15, 0, 0] },
    ],
  },
});
frags.push({
  [j.hips]: {
    position: [
      { t: T_TAKE - 0.3, v: [0, 0.89, 0], ease: 'ease-in' },
      { t: T_TAKE - 0.05, v: [0, 0.7, 0], ease: 'ease-out' },
      { t: T_TAKE + 0.15, v: [0, 0.89, 0] },
      { t: T_LAND - 0.02, v: [0, 0.89, 0], ease: 'ease-out' },
      { t: T_LAND + 0.12, v: [0, 0.66, 0], ease: 'ease-in-out' },
      { t: T_LAND + 0.7, v: [0, 0.8, 0] },
    ],
  },
});
// jump: arc from the sidestep spot over the giant's shoulder line to behind it
const jf = jump({ joints: j, start: T_TAKE, airTime: AIR, height: JUMP_H, base: SIDESTEP_END });
const arc: Track<Vec3> = [];
const N = 16;
for (let i = 0; i <= N; i++) {
  const u = i / N;
  arc.push({
    t: +(T_TAKE + u * AIR).toFixed(4),
    v: [lerp(SIDESTEP_END[0], LAND[0], u), 4 * JUMP_H * u * (1 - u), lerp(SIDESTEP_END[2], LAND[2], u)],
  });
}
jf[j.root] = { position: arc };
delete jf[j.shoulderL!]; // arms are driven by raiseArm below (both overhead holding the sword)
delete jf[j.shoulderR!];
frags.push(jf);
// both arms overhead for the leap, slash down into a low hold on landing
frags.push(raiseArm({ joints: j, side: 'right', start: T_TAKE - 0.2, end: T_TAKE + 0.25, angle: 2.9 }));
frags.push(raiseArm({ joints: j, side: 'left', start: T_TAKE - 0.2, end: T_TAKE + 0.25, angle: 2.9 }));
frags.push(raiseArm({ joints: j, side: 'right', start: T_LAND - 0.25, end: T_LAND + 0.1, from: 2.9, angle: 0.35 }));
frags.push(raiseArm({ joints: j, side: 'left', start: T_LAND - 0.25, end: T_LAND + 0.1, from: 2.9, angle: 0.2 }));
// legs tuck in the air
const tuck: Track<Vec3> = [
  { t: T_TAKE, v: [0, 0, 0], ease: 'ease-out' },
  { t: T_TAKE + 0.35, v: [-0.9, 0, 0] },
  { t: T_LAND - 0.3, v: [-0.9, 0, 0], ease: 'ease-in' },
  { t: T_LAND, v: [0, 0, 0] },
];
frags.push({ [j.hipL!]: { rotation: tuck.map((k) => ({ ...k, v: [...k.v] as Vec3 })) } });
frags.push({ [j.hipR!]: { rotation: tuck.map((k) => ({ ...k, v: [k.v[0] * 0.4, 0, 0] as Vec3 })) } });
heroNodes = applyMotion(heroNodes, frags);

// ---- giant (walker.glb) ----
const giantTopple: Track<Vec3> = [];
const topplePos: Track<Vec3> = [];
const FRONT = 0.25; // pivot on the toe tip (front of the rest-pose bounds)
for (let i = 0; i <= 8; i++) {
  const u = i / 8;
  const th = TOPPLE_RX * u * u; // accelerating fall
  const t = +(T_TOPPLE + u * TOPPLE).toFixed(4);
  giantTopple.push({ t, v: [th, 0, 0] });
  topplePos.push({
    t,
    v: [0, GIANT_HALF * Math.cos(th) + FRONT * Math.sin(th), GIANT_STOP_Z + FRONT + GIANT_HALF * Math.sin(th) - FRONT * Math.cos(th)],
  });
}
const giant: PrevisNode = {
  id: 'giant',
  shape: 'model',
  role: 'giant',
  color: cGiant,
  model: {
    src: 'models/walker.glb',
    fit: 'contain',
    animation: [
      { clip: 'walk', start: T_EMERGE, speed: 1.1, loop: 'repeat' },
      // 'wave' held at its end = rest pose for every joint (nodes a clip does not animate rest)
      { clip: 'wave', start: T_STOP - 0.35, speed: 40, loop: 'once', blendIn: 0.45 },
    ],
  },
  position: [0, GIANT_HALF, GIANT_FROM_Z],
  rotation: [0, 0, 0],
  size: [1.6, GIANT_H, 1.0],
  visible: false,
  tracks: {
    // a track holds its first value before the first key, so key `false` at 0 explicitly
    visible: [{ t: 0, v: false }, { t: T_EMERGE, v: true }],
    position: [
      { t: T_EMERGE, v: [0, GIANT_HALF, GIANT_FROM_Z], ease: 'linear' },
      { t: T_STOP - 0.3, v: [0, GIANT_HALF, GIANT_STOP_Z + 0.25], ease: 'ease-out' },
      { t: T_STOP, v: [0, GIANT_HALF, GIANT_STOP_Z] },
      ...topplePos,
    ],
    rotation: giantTopple,
    joints: {
      // raise the arm overhead, then swing it down hard in front (negative rx = forward/up)
      'upperArm.R': [
        { t: 3.2, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 3.5, v: [-2.9, 0, 0.15], ease: 'ease-in' },
        { t: 3.8, v: [-0.55, 0, 0.1], ease: 'ease-in-out' },
        { t: 5.0, v: [-0.3, 0, 0] },
        { t: T_TOPPLE, v: [-0.3, 0, 0], ease: 'ease-out' },
        { t: T_TOPPLE + TOPPLE, v: [-2.9, 0, 0.3] },
      ],
      'lowerArm.R': [
        { t: 3.2, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 3.5, v: [-0.9, 0, 0], ease: 'ease-in' },
        { t: 3.8, v: [0, 0, 0] },
      ],
      'upperArm.L': [
        { t: T_TOPPLE, v: [0, 0, 0], ease: 'ease-out' },
        { t: T_TOPPLE + TOPPLE, v: [-2.9, 0, -0.3] },
      ],
      head: [
        { t: 4.6, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 5.4, v: [-0.4, -0.3, 0], ease: 'ease-in-out' },
        { t: T_TOPPLE + 0.2, v: [0.3, 0, 0] },
      ],
    },
  },
};

// Stone club held in the giant's right hand: child of the model, attached to joint `lowerArm.R`.
// Child offsets are METERS in the joint frame and are NOT scaled by the model's fit, so the walker's forearm end
// (y = -0.28 m at natural size 1.75 m) is multiplied by k = fit factor (contain, height-limited: 3.2 / 1.75).
const WALKER_H = 1.75;
const K = GIANT_H / WALKER_H;
const FOREARM_END = -0.28 * K;
const CLUB: Vec3 = [0.18, 1.4, 0.18];
const club: PrevisNode = {
  id: 'club',
  shape: 'box',
  role: 'club',
  color: cClub,
  parent: 'giant',
  parentJoint: 'lowerArm.R',
  // rotation [pi/2, 0, 0] lays the long axis along the forearm's +z (forward); 0.5 m of handle behind the fist
  position: [0, FOREARM_END, CLUB[1] / 2 - 0.2],
  rotation: [Math.PI / 2, 0, 0],
  size: CLUB,
};

// ---- gate: vertical disc (cylinder axis along y, rotated 90 deg about x so the axis points at z) ----
const gate: PrevisNode = {
  id: 'gate',
  shape: 'cylinder',
  role: 'gate',
  color: cGate,
  position: [0, GATE_D / 2 + 0.05, GATE_Z],
  rotation: [Math.PI / 2, 0, 0],
  size: [GATE_D, 0.1, GATE_D],
};

// ---- shadow warriors: triangle around the landing spot, rising from under the floor ----
const R_TRI = 1.6;
// right of the hero (between it and the gate axis), back-left and front-left; clear of the gate disc and the fallen giant
const warriorAngles = [Math.PI / 2, (7 * Math.PI) / 6, (11 * Math.PI) / 6]; // x = sin, z = cos
const warriors: PrevisNode[] = warriorAngles.map((a, i) => {
  const x = LAND[0] + R_TRI * Math.sin(a);
  const z = LAND[2] + R_TRI * Math.cos(a);
  const yaw = Math.atan2(LAND[0] - x, LAND[2] - z) + Math.PI; // face outward, backs to the hero
  const t0 = RISE[i];
  return {
    id: `shadow${i + 1}`,
    shape: 'model',
    role: 'shadow',
    color: cShadow,
    model: { src: 'models/walker.glb', fit: 'contain' },
    position: [x, -2.0, z],
    rotation: [0, yaw, 0],
    size: [0.7, WARRIOR_H, 0.5],
    visible: false,
    tracks: {
      visible: [{ t: 0, v: false }, { t: t0, v: true }],
      position: [
        { t: t0, v: [x, -2.0, z], ease: 'ease-out' },
        { t: t0 + RISE_DUR, v: [x, WARRIOR_H / 2, z] },
      ],
    },
  };
});

// ---- set: dark stone hall ----
const box = (id: string, color: Rgb, position: Vec3, size: Vec3): PrevisNode => ({
  id, shape: 'box', color, position, rotation: [0, 0, 0], size,
});
const set: PrevisNode[] = [
  box('floor', STONE, [0, -0.25, -2], [14, 0.5, 24]),
  box('wallL', STONE_LIGHT, [-6.75, 4, -2], [0.5, 8, 24]),
  box('wallR', STONE_LIGHT, [6.75, 4, -2], [0.5, 8, 24]),
  box('wallBack', [0.15, 0.15, 0.17], [0, 4, -11], [14, 8, 0.5]),
];
for (const [i, z] of [-8, -4, 0, 4].entries()) {
  set.push(box(`pillarL${i}`, [0.24, 0.23, 0.25], [-5.2, 4, z], [1.0, 8, 1.0]));
  set.push(box(`pillarR${i}`, [0.24, 0.23, 0.25], [5.2, 4, z], [1.0, 8, 1.0]));
}

// ---- cameras (sampled from the evaluated hero position) ----
const nodes: PrevisNode[] = [...set, gate, giant, club, ...warriors, ...heroNodes];
const probe: PrevisDoc = {
  version: 1, fps: FPS, size: { width: 1280, height: 720 }, background: BG, roles, nodes,
  shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 8] }], target: { follow: 'hero.root' } } }],
};
const heroAt = (t: number): Vec3 => worldPosition(probe, evaluateFrame(probe, t).nodes, 'hero.root');
const sample = (a: number, b: number, step: number, f: (t: number) => Vec3): Track<Vec3> => {
  const out: Track<Vec3> = [];
  for (let t = a; t < b - 1e-9; t += step) out.push({ t: +t.toFixed(4), v: f(t) });
  out.push({ t: b, v: f(b) });
  return out;
};

const shots: Shot[] = [
  {
    // 1. establish: low wide angle behind/beside the hero, gate dominant, slow push-in
    id: 's1-establish',
    start: 0,
    end: 1.5,
    camera: {
      position: [
        { t: 0, v: [2.2, 0.35, 6.8], ease: 'ease-in-out' },
        { t: 1.5, v: [1.8, 0.4, 5.9] },
      ],
      target: { track: [{ t: 0, v: [0.1, 1.8, -6] }, { t: 1.5, v: [0, 1.8, -6] }] },
      fov: [{ t: 0, v: 34 }],
    },
  },
  {
    // 2. emerge: over the hero's shoulder, slight roll easing in
    id: 's2-emerge',
    start: 1.5,
    end: 3.0,
    camera: {
      position: [
        { t: 1.5, v: [0.95, 1.95, 4.4], ease: 'ease-in-out' },
        { t: 3.0, v: [0.85, 1.9, 3.9] },
      ],
      target: { track: [{ t: 1.5, v: [0, 1.9, -5], ease: 'ease-in-out' }, { t: 3.0, v: [0, 2.0, -3.8] }] },
      fov: [{ t: 1.5, v: 42 }],
      roll: [{ t: 1.5, v: 0, ease: 'ease-in' }, { t: 3.0, v: 0.08 }],
    },
  },
  {
    // 3. clash: low side tracking dolly following the hero
    id: 's3-clash',
    start: 3.0,
    end: 4.5,
    camera: {
      position: sample(3.0, 4.5, 1 / 12, (t) => {
        const h = heroAt(t);
        return [0.5 * h[0] + 4.4, 0.7, h[2] - 0.3];
      }),
      target: { follow: 'hero.root', offset: [0.4, 1.4, -0.9] },
      fov: [{ t: 3.0, v: 58 }],
    },
  },
  {
    // 4. leap: low and close, looking up; roll swings, fov widens on the apex
    id: 's4-leap',
    start: 4.5,
    end: 6.0,
    camera: {
      position: [
        { t: 4.5, v: add(SIDESTEP_END, [-0.55, 0.3, 0.3]), ease: 'ease-in-out' },
        { t: 6.0, v: add(SIDESTEP_END, [-0.9, 0.25, 0.6]) },
      ],
      target: { follow: 'hero.root', offset: [0, 1.45, 0] },
      fov: [{ t: 4.5, v: 70, ease: 'ease-in-out' }, { t: 5.4, v: 82, ease: 'ease-in-out' }, { t: 6.0, v: 74 }],
      roll: [{ t: 4.5, v: -0.15, ease: 'ease-in-out' }, { t: 6.0, v: 0.15 }],
    },
  },
  {
    // 5. aftermath: high angle crane up to a straight-down top shot over the hero by 7.6 s
    id: 's5-aftermath',
    start: 6.0,
    end: 8.0,
    camera: {
      position: [
        { t: 6.0, v: add(LAND, [0, 3.0, 4.0]), ease: 'ease-in-out' },
        { t: 7.6, v: add(LAND, [0, 6.0, 0]) },
        { t: 8.0, v: add(LAND, [0, 6.2, 0]) },
      ],
      target: { track: [
        { t: 6.0, v: add(LAND, [0, 1.0, 0]), ease: 'ease-in-out' },
        { t: 7.6, v: add(LAND, [0, 0, 0]) },
      ] },
      fov: [{ t: 6.0, v: 50, ease: 'ease-in-out' }, { t: 7.6, v: 72 }],
    },
  },
];

const doc: PrevisDoc = {
  version: 1,
  title: 'Gate Raid',
  fps: FPS,
  size: { width: 1280, height: 720 },
  background: BG,
  worldScale: 10,
  avoidColors: avoid,
  roles,
  nodes,
  shots,
};

const v = validateDoc(JSON.parse(JSON.stringify(doc)));
if (!v.ok) {
  for (const i of v.issues) console.error(`${i.path}: ${i.message}`);
  process.exit(2);
}
const outJson = path.join(HERE, 'gate-raid.json');
fs.writeFileSync(outJson, JSON.stringify(doc, null, 2) + '\n');
console.log('wrote', outJson, 'nodes', doc.nodes.length, 'colors', JSON.stringify({ cHero, cSword, cGiant, cGate, cShadow, cClub }));

if (process.env.HANDOFF_OUT) {
  const h = buildHandoff(doc, {
    lang: 'ko',
    references: [
      { name: 'hero face sheet', role: 'hero', note: '주인공 헌터 얼굴 시트 (플레이스홀더)' },
      { name: 'hero outfit', role: 'hero', note: '검은 전투복 착장 시트 (플레이스홀더)' },
      { name: 'giant design', role: 'giant', note: '게이트에서 나온 석상 거인 디자인 (플레이스홀더)' },
      { name: 'shadow warrior design', role: 'shadow warriors', note: '그림자 병사 디자인 (플레이스홀더)' },
      { name: 'dungeon hall background', note: '어두운 석조 던전 홀 배경 (플레이스홀더)' },
    ],
    textOnly: [
      '조명: 뒤쪽 게이트에서 나오는 차가운 청보라 빛이 홀을 비춤, 나머지는 거의 어둠. 게이트 색은 previs 색이 아니라 청보라 발광',
      '공기 중 먼지가 게이트 빛을 받아 떠다님; 6.1~6.9초 거인이 쓰러질 때 바닥에서 먼지가 크게 일어남',
      '3.5~3.8초 거인 팔이 내려칠 때, 4.8~6.0초 도약 베기 때 검에서 불꽃이 튐',
      '그림자 병사들은 6.4/6.6/6.8초에 바닥의 검은 그림자 웅덩이에서 솟아오름 (실루엣 검은 연기, 눈만 청보라로 빛남)',
      '표정: 처음엔 침착하게 게이트를 응시 -> 돌진할 때 이를 악문 집중 -> 착지 후 담담한 무표정',
      '거인은 오른손에 거친 돌 몽둥이를 쥐고 있음(3.2~3.9초 팔을 휘두를 때 함께 휘둘러지고, 쓰러진 뒤에는 거인 곁에 놓임); 몽둥이 색은 previs 색이 아니라 돌 질감',
      '손: 주인공은 오른손으로 검 손잡이를 단단히 쥠, 도약 때 두 손으로 머리 위에서 검을 잡음, 착지 후 오른손 한 손으로 검을 낮게 듦',
      '질감·의상·얼굴은 참조 이미지 기준, previs 블록 모양과 색은 따르지 말 것',
    ],
  });
  const md = `# Gate Raid handoff\n\n## 업로드 순서\n${h.uploadOrder.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## 프롬프트\n\n\`\`\`\n${h.prompt}\n\`\`\`\n`;
  fs.writeFileSync(process.env.HANDOFF_OUT, md);
  console.log('wrote', process.env.HANDOFF_OUT);
}
