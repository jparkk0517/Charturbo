// Generator for gate-raid.json (original dungeon-gate hunter action previs, 8 s, 1280x720).
// Run from web/: node --experimental-strip-types previs/examples/gate-raid.gen.ts
// Optional env HANDOFF_OUT=<path.md> also writes the Korean handoff (upload order + prompt).
//
// Showcase of the authoring features: jointed hero (pickUp, crouch), re-parented props (tracks.parent: the sword
// is picked up from the floor, the club leaves the giant's hand and tumbles), model.groundLock, smooth camera
// moves, camera shake, rotationPath 'shortest', markers and shot notes for the handoff.
// Textured pass (look.show, lighting, model.retarget from the hero mannequin and from the walker giant model; see the
// section "textured pass" below): the blocks above are flat-only and lit CC0 models stand in for them, so beauty / depth
// stay the flat blockout:
//   npm run previs:render -- previs/examples/gate-raid.json --stills=0.75,3.8,5.3,7.9 --out=out/ --passes=beauty,textured
//   npm run previs:render -- previs/examples/gate-raid.json out/raid.mp4 --split-shots --passes=beauty,textured
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMotion,
  buildHandoff,
  createMannequin,
  crouch,
  eulerYXZToQuat,
  evalTrack,
  evaluateFrame,
  pickUp,
  quatToEulerYXZ,
  raiseArm,
  retargetParts,
  suggestRoleColors,
  validateDoc,
  walk,
  worldTransform,
} from '../../src/previs/index.ts';
import type {
  JointFrame,
  MotionFragments,
  PrevisDoc,
  PrevisMarker,
  PrevisNode,
  Quat,
  Rgb,
  Shot,
  Track,
  Vec3,
} from '../../src/previs/index.ts';

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
const DASH_END: Vec3 = [0.5, 0, -2.2]; // in front of the giant's club (+x) arm
const SIDESTEP_END: Vec3 = [-1.2, 0, -2.0]; // clear of the swing
const LAND: Vec3 = [-2.0, 0, -4.4]; // behind the giant
const WARRIOR_H = 1.8;

// ---- timeline (seconds) ----
const T_REACH = 0.2; // hero bends for the sword
const T_GRAB = 0.75; // hand on the grip: the sword re-parents to the hand
const T_RISE = 1.35; // standing again
const T_SET = 1.2; // sword settled in the grip pose
const T_EMERGE = 1.5;
const T_STOP = 3.0;
const T_DASH = 3.0;
const T_DASH_END = 3.55;
const T_SIDE_END = 3.85;
const T_SLAM = 3.8; // club hits the floor where the hero was
const T_LOAD = 4.5; // anticipation crouch before the leap
const T_TAKE = 4.8;
const T_PUSH = 4.75; // deepest point of the anticipation crouch
const T_TUCK = 4.9; // legs fully extended, the tuck starts
const AIR = 1.2;
const T_LAND = T_TAKE + AIR; // 6.0
const T_ABSORB = T_LAND + 0.15; // deepest point of the landing crouch
const T_SETTLE = T_LAND + 0.8;
const JUMP_H = 2.2;
const T_TOPPLE = 6.1;
const TOPPLE = 0.8;
const T_DOWN = T_TOPPLE + TOPPLE; // 6.9 giant hits the floor
// 1.4 rad (the brief) leaves the head 0.5 m in the air because the pivot is the toe; 1.6 lays the body flat
const TOPPLE_RX = 1.6;
const T_REL = T_TOPPLE; // the giant's grip opens as it starts to fall: the club drops out of its hand
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
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const r4 = (t: number) => +t.toFixed(4);
/** Yaw that faces from `a` toward `b` (mannequins face +z at yaw 0), in (-pi, pi]. */
const yawTo = (a: Vec3, b: Vec3) => Math.atan2(b[0] - a[0], b[2] - a[2]);
/** Global frame times k / fps in [a, b], plus b. */
const frameTimes = (a: number, b: number): number[] => {
  const out: number[] = [a];
  for (let k = Math.ceil(a * FPS - 1e-9); k / FPS < b - 1e-9; k++) if (k / FPS > a + 1e-9) out.push(r4(k / FPS));
  out.push(b);
  return out;
};

// ---- quaternions (x, y, z, w), same conventions as evaluate.ts ----
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
/** Euler of q with every component unwrapped to lie within pi of `near` (a smooth per-component path). */
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
/** Shortest-arc rotation taking unit vector a onto unit vector b (not antiparallel). */
const qFromTo = (a: Vec3, b: Vec3): Quat => {
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const q: Quat = [c[0], c[1], c[2], 1 + a[0] * b[0] + a[1] * b[1] + a[2] * b[2]];
  const n = Math.hypot(...q);
  return q.map((v) => v / n) as Quat;
};
/** Lowest world y of the 8 corners of a box of `size` at world pose (p, q). */
const lowestCorner = (p: Vec3, q: Quat, size: Vec3): number => {
  let min = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    min = Math.min(min, p[1] + qrot(q, [(sx * size[0]) / 2, (sy * size[1]) / 2, (sz * size[2]) / 2])[1]);
  }
  return min;
};

// ---- hero (jointed: elbows and knees, needed by pickUp and crouch) ----
const FACE_GATE = yawTo(HERO_START, [0, 0, GATE_Z]); // pi
const m = createMannequin({ id: 'hero', color: cHero, role: 'hero', height: 1.78, position: HERO_START, limbs: 'jointed' });
const j = m.joints;
m.nodes.find((n) => n.id === j.root)!.rotation = [0, FACE_GATE, 0]; // faces the gate (-z); pickUp reads this yaw
const heroRoot = m.nodes.find((n) => n.id === j.root)!;
// Root yaw crosses +-pi several times (facing -z = pi); every yaw below is a plain atan2 in (-pi, pi] and the
// root interpolates the shortest way.
heroRoot.rotationPath = 'shortest';

// Sword: blade box 0.05 x 0.9 x 0.02. It starts ON THE FLOOR in front of the hero's right foot, on its edge, blade
// pointing to the hero's right (+x). pickUp reaches the right hand to the grip at T_GRAB; there the sword
// re-parents to the hand (tracks.parent) and its delta tracks turn it into the grip pose: pivoting about the grip
// and angled forward (rx = GRIP) so it points forward-down when the arm hangs and up-back when the arm is overhead.
const GRIP = -1.0;
const BLADE = 0.9;
const SWORD_SIZE: Vec3 = [0.05, BLADE, 0.02];
const half = BLADE / 2 + 0.04; // grip to blade centre
const GRIP_POINT: Vec3 = [0.3, 0.075, HERO_START[2] - 0.42]; // hand (wrist pivot) target, world
// The grip is the box's local +y end (the blade runs along local -y). On the floor it lies on its edge (0.05 m tall),
// blade toward the hero's right (+x): Rz(pi/2) maps local +y onto world -x (back toward the grip).
const SWORD_FLOOR_ROT: Vec3 = [0, 0, Math.PI / 2];
const SWORD_FLOOR: Vec3 = [GRIP_POINT[0] + half, SWORD_SIZE[0] / 2, GRIP_POINT[2]];
const pick = pickUp({
  mannequin: m,
  side: 'right',
  target: GRIP_POINT,
  start: T_REACH,
  grab: T_GRAB,
  end: T_RISE,
  depth: 0.65,
  lean: 0.8,
  fps: FPS,
});
if (pick.miss > 1e-6) throw new Error(`pickUp misses the grip by ${pick.miss.toFixed(3)} m`);

const frags: MotionFragments[] = [pick.motion];
// dash (fast run) then sidestep; root yaw is authored separately below, so drop the walk yaw keys
const dash = walk({ joints: j, from: HERO_START, to: DASH_END, start: T_DASH, end: T_DASH_END, stepsPerSecond: 7 });
const side = walk({ joints: j, from: DASH_END, to: SIDESTEP_END, start: T_DASH_END, end: T_SIDE_END, stepsPerSecond: 6 });
dash[j.root].position![0].ease = 'ease-in';
side[j.root].position![0].ease = 'ease-out';
delete dash[j.root].rotation;
delete side[j.root].rotation;
frags.push(dash, side);

const GIANT_POS: Vec3 = [0, 0, GIANT_STOP_Z];
const FALLEN_GIANT: Vec3 = [0, 0, GIANT_STOP_Z + GIANT_HALF + 0.2]; // middle of the body on the floor
const yawDash = yawTo(HERO_START, DASH_END); // 3.02
const yawSquare = yawTo(DASH_END, GIANT_POS); // -2.78: squares up to the giant (crosses -pi)
const yawDodge = yawTo(SIDESTEP_END, GIANT_POS); // 2.47: keeps the giant in sight while side-stepping
const yawLeap = yawTo(SIDESTEP_END, LAND); // -2.82: faces the take-off direction (crosses pi again)
const yawLook = yawTo(LAND, FALLEN_GIANT); // 0.64: turns to the fallen giant
frags.push({
  [j.root]: {
    rotation: [
      { t: 0, v: [0, FACE_GATE, 0] },
      { t: T_DASH, v: [0, FACE_GATE, 0], ease: 'ease-out' },
      { t: T_DASH + 0.12, v: [0, yawDash, 0] },
      { t: T_DASH_END - 0.15, v: [0, yawDash, 0], ease: 'ease-in-out' },
      { t: T_DASH_END + 0.05, v: [0, yawSquare, 0], ease: 'ease-in-out' },
      { t: T_SIDE_END, v: [0, yawDodge, 0] },
      { t: T_LOAD + 0.05, v: [0, yawDodge, 0], ease: 'ease-in-out' },
      { t: T_TAKE, v: [0, yawLeap, 0] },
      { t: T_LAND + 0.1, v: [0, yawLeap, 0], ease: 'ease-in-out' },
      { t: T_SETTLE, v: [0, yawLook, 0] },
    ],
  },
});
// forward lean of the spine while dashing, lean into the anticipation crouch, arch in the air, lean on landing.
// pickUp owns spine.rotation on [T_REACH, T_RISE]; these keys start after it.
frags.push({
  [j.spine]: {
    rotation: [
      { t: T_DASH, v: [0, 0, 0], ease: 'ease-out' },
      { t: T_DASH + 0.15, v: [0.35, 0, 0] },
      { t: T_DASH_END, v: [0.35, 0, 0], ease: 'ease-in-out' },
      { t: T_SIDE_END + 0.1, v: [0, 0, 0] },
      { t: T_LOAD, v: [0, 0, 0], ease: 'ease-in-out' },
      { t: T_PUSH, v: [0.4, 0, 0], ease: 'ease-out' },
      { t: T_TAKE + 0.25, v: [-0.15, 0, 0], ease: 'ease-in-out' },
      { t: T_LAND - 0.1, v: [0, 0, 0], ease: 'ease-out' },
      { t: T_ABSORB, v: [0.45, 0, 0], ease: 'ease-in-out' },
      { t: T_SETTLE, v: [0.15, 0, 0] },
    ],
  },
});
// Legs (hips.position, hip*.rotation, knee*.rotation) are owned in sequence, never overlapping:
//   pickUp [0.2, 1.35] -> walk dash + sidestep [3.0, 3.85] (hip* only) -> crouch load [4.5, 4.75] ->
//   crouch push-off [4.75, 4.9] -> air tuck [4.9, 6.0] -> crouch absorb [6.0, 6.15] -> crouch settle [6.15, 6.8]
const LOAD_D = 0.32;
const ABSORB_D = 0.42;
const SETTLE_D = 0.12;
frags.push(crouch({ mannequin: m, start: T_LOAD, end: T_PUSH, depth: LOAD_D, fps: FPS }));
frags.push(crouch({ mannequin: m, start: T_PUSH, end: T_TUCK, from: LOAD_D, depth: 0, fps: FPS }));
const tuck = (hip: number, knee: number): { hip: Track<Vec3>; knee: Track<Vec3> } => ({
  hip: [
    { t: T_TUCK, v: [0, 0, 0], ease: 'ease-out' },
    { t: T_TUCK + 0.3, v: [hip, 0, 0] },
    { t: T_LAND - 0.3, v: [hip, 0, 0], ease: 'ease-in' },
    { t: T_LAND, v: [0, 0, 0] },
  ],
  knee: [
    { t: T_TUCK, v: [0, 0, 0], ease: 'ease-out' },
    { t: T_TUCK + 0.3, v: [knee, 0, 0] },
    { t: T_LAND - 0.3, v: [knee, 0, 0], ease: 'ease-in' },
    { t: T_LAND, v: [0, 0, 0] },
  ],
});
const tuckL = tuck(-1.1, 1.5);
const tuckR = tuck(-0.5, 0.9);
frags.push({ [j.hipL!]: { rotation: tuckL.hip }, [j.kneeL!]: { rotation: tuckL.knee } });
frags.push({ [j.hipR!]: { rotation: tuckR.hip }, [j.kneeR!]: { rotation: tuckR.knee } });
frags.push(crouch({ mannequin: m, start: T_LAND, end: T_ABSORB, depth: ABSORB_D, fps: FPS }));
frags.push(crouch({ mannequin: m, start: T_ABSORB, end: T_SETTLE, from: ABSORB_D, depth: SETTLE_D, fps: FPS }));

// leap: one root key per frame on a parabola from the sidestep spot past the giant's shoulder to behind it
const arc: Track<Vec3> = frameTimes(T_TAKE, T_LAND).map((t) => {
  const u = (t - T_TAKE) / AIR;
  return { t, v: [lerp(SIDESTEP_END[0], LAND[0], u), 4 * JUMP_H * u * (1 - u), lerp(SIDESTEP_END[2], LAND[2], u)] };
});
frags.push({ [j.root]: { position: arc } });
// arms: left winds back in the crouch, both overhead for the leap, slash down into a low hold on landing
// (shoulder*: pickUp [0.2, 1.35] right only -> walk [3.0, 3.85] -> these from 4.5)
for (const s of ['right', 'left'] as const) {
  // the sword arm comes forward to a level guard instead of winding back (a wound-back sword would dig into the floor)
  const load = s === 'right' ? 0.6 : -0.5;
  frags.push(raiseArm({ joints: j, side: s, start: T_LOAD, end: T_PUSH - 0.03, angle: load }));
  frags.push(raiseArm({ joints: j, side: s, start: T_PUSH - 0.03, end: T_TAKE + 0.2, from: load, angle: 2.9 }));
  frags.push(raiseArm({ joints: j, side: s, start: T_LAND - 0.28, end: T_LAND + 0.08, from: 2.9, angle: s === 'right' ? 0.7 : 0.2 }));
}
const heroNodes = applyMotion(m.nodes, frags);

// ---- giant (walker.glb) ----
const giantTopple: Track<Vec3> = [];
const topplePos: Track<Vec3> = [];
const FRONT = 0.25; // pivot on the toe tip (front of the rest-pose bounds)
for (let i = 0; i <= 8; i++) {
  const u = i / 8;
  const th = TOPPLE_RX * u * u; // accelerating fall
  const t = r4(T_TOPPLE + u * TOPPLE);
  giantTopple.push({ t, v: [th, 0, 0] });
  topplePos.push({
    t,
    v: [0, GIANT_HALF * Math.cos(th) + FRONT * Math.sin(th), GIANT_STOP_Z + FRONT + GIANT_HALF * Math.sin(th) - FRONT * Math.cos(th)],
  });
}
// club arm: raise overhead (club drops behind the back), smash down with the torso bending into the blow so the
// club head lands on the floor in front at T_SLAM (the upper-arm angle there is solved below), lift, then fling
// both arms up while toppling
const SLAM_TORSO = 0.5;
const SLAM_ELBOW = 1.0; // forearm swings back in line with the upper arm
const clubArm = (slamRx: number): Track<Vec3> => [
  { t: 3.2, v: [0, 0, 0], ease: 'ease-in-out' },
  { t: 3.5, v: [-2.9, 0, 0.15], ease: 'ease-in' },
  { t: T_SLAM, v: [slamRx, 0, 0.1], ease: 'ease-in-out' },
  { t: T_SLAM + 0.35, v: [slamRx, 0, 0.1], ease: 'ease-in-out' },
  { t: 5.0, v: [-0.3, 0, 0] },
  { t: T_TOPPLE, v: [-0.3, 0, 0], ease: 'ease-out' },
  { t: T_DOWN, v: [-2.9, 0, 0.3] },
];
const giant: PrevisNode = {
  id: 'giant',
  shape: 'model',
  role: 'giant',
  color: cGiant,
  model: {
    src: 'models/walker.glb',
    fit: 'contain',
    // Feet on the floor while the walk clip bobs the hips and bends the knees; in the topple the toe pivot
    // below already keeps the lowest point at y = 0, so the lock only trims it (no jump, no fight).
    groundLock: true,
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
      'upperArm.R': clubArm(-0.55),
      'lowerArm.R': [
        { t: 3.2, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 3.5, v: [-0.9, 0, 0], ease: 'ease-in' },
        { t: T_SLAM, v: [SLAM_ELBOW, 0, 0] },
        { t: T_SLAM + 0.35, v: [SLAM_ELBOW, 0, 0], ease: 'ease-in-out' },
        { t: 5.0, v: [0, 0, 0] },
      ],
      torso: [
        { t: 3.2, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 3.5, v: [-0.12, 0, 0], ease: 'ease-in' },
        { t: T_SLAM, v: [SLAM_TORSO, 0, 0] },
        { t: T_SLAM + 0.35, v: [SLAM_TORSO, 0, 0], ease: 'ease-in-out' },
        { t: 5.0, v: [0, 0, 0] },
      ],
      'upperArm.L': [
        { t: T_TOPPLE, v: [0, 0, 0], ease: 'ease-out' },
        { t: T_DOWN, v: [-2.9, 0, -0.3] },
      ],
      head: [
        { t: 4.6, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 5.4, v: [-0.4, -0.3, 0], ease: 'ease-in-out' },
        { t: T_TOPPLE + 0.2, v: [0.3, 0, 0] },
      ],
    },
  },
};

// Walker rest pose (models.gen.ts buildWalker), file units: joint -> parent, translation, rotation. After the walk ->
// wave blend has finished (t >= T_STOP + 0.1) every joint is at rest, so a joint frame = rest chain + tracks.joints.
// This mirrors what the player's socket reads (without the ground-lock offset, which is 0 there: the rest feet and
// the toe pivot of the topple sit on y = 0). Used only to AUTHOR the slam contact and the club's release arc.
const WALKER_H = 1.75;
const K = GIANT_H / WALKER_H; // contain fit, height-limited
const WALKER_CENTER: Vec3 = [0, 0.875, 0.03]; // centre of the rest-pose bounds (min [-.27, 0, -.11], max [.27, 1.75, .17])
const qAxis = (axis: 0 | 1 | 2, deg: number): Quat => {
  const h = (deg * Math.PI) / 360;
  const q: Quat = [0, 0, 0, Math.cos(h)];
  q[axis] = Math.sin(h);
  return q;
};
const I: Quat = [0, 0, 0, 1];
const WALKER: Record<string, { parent: string | null; t: Vec3; q: Quat }> = {
  hips: { parent: null, t: [0, 0.96, 0], q: I },
  torso: { parent: 'hips', t: [0, 0.04, 0], q: I },
  'upperArm.R': { parent: 'torso', t: [0.23, 0.45, 0], q: qAxis(2, -6) },
  'lowerArm.R': { parent: 'upperArm.R', t: [0, -0.3, 0], q: qAxis(0, -12) },
};
const T_SETTLED = T_STOP - 0.35 + 0.45 + 0.05;
const giantJointFrame = (model: string, joint: string, time: number): JointFrame => {
  if (model !== 'giant' || !(joint in WALKER)) throw new Error(`no rest data for ${model}/${joint}`);
  if (time < T_SETTLED) throw new Error(`giant joint frame at ${time}: the walk clip is still playing (only rest is modelled)`);
  let p: Vec3 = [0, 0, 0];
  let q: Quat = I;
  // walk up to the root, composing parent * local on the way down
  const chain: string[] = [];
  for (let n: string | null = joint; n; n = WALKER[n].parent) chain.unshift(n);
  for (const n of chain) {
    const off = evalTrack(giant.tracks!.joints![n], time, [0, 0, 0] as Vec3);
    const local = qmul(WALKER[n].q, eulerYXZToQuat(off));
    p = add(p, qrot(q, WALKER[n].t));
    q = qmul(q, local);
  }
  return { position: scale(sub(p, WALKER_CENTER), K), rotation: quatToEulerYXZ(q) };
};

// Stone club held in the giant's right hand: child of the model on joint `lowerArm.R`. Child offsets are METERS in
// the joint frame and are NOT scaled by the model's fit, so the forearm end (y = -0.28 m at natural size) is
// multiplied by K. At T_REL it re-parents to the world (null) and flies on a ballistic delta arc.
const FOREARM_END = -0.28 * K;
const CLUB: Vec3 = [0.2, 1.9, 0.2];
// Grip: the long axis leaves the fist CLUB_PHI forward of the forearm's down direction (0 = straight along the
// forearm, pi/2 = perpendicular forward), so it trails forward-down while the arm hangs and lines up with a
// forward-swung arm for the slam. 0.2 m of handle stays behind the fist.
const CLUB_PHI = 0.8;
const CLUB_DIR: Vec3 = [0, -Math.cos(CLUB_PHI), Math.sin(CLUB_PHI)];
const CLUB_OFF: Vec3 = add([0, FOREARM_END, 0], scale(CLUB_DIR, CLUB[1] / 2 - 0.2));
const CLUB_ROT: Vec3 = [Math.PI - CLUB_PHI, 0, 0]; // Rx maps the box's long axis (local y) onto -CLUB_DIR (a line)
const club: PrevisNode = {
  id: 'club',
  shape: 'box',
  role: 'club',
  color: cClub,
  parent: 'giant',
  parentJoint: 'lowerArm.R',
  position: CLUB_OFF,
  rotation: CLUB_ROT,
  size: CLUB,
  // hidden with the giant behind the gate disc (a child does not inherit its parent's visibility)
  visible: false,
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
// No groundLock here: the rise IS authored height (from y = -2 under the floor up to standing); a ground lock would
// pin them on the floor from their first visible frame and remove the rise. They play no clip, so nothing to fix.
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

// ---- probe doc: evaluates the hero and the props while the remaining tracks are authored ----
const sword: PrevisNode = {
  id: 'sword',
  shape: 'box',
  role: 'sword',
  color: cSword,
  position: SWORD_FLOOR,
  rotation: SWORD_FLOOR_ROT,
  size: SWORD_SIZE,
};
const nodes: PrevisNode[] = [...set, gate, giant, club, ...warriors, ...heroNodes, sword];
const probe: PrevisDoc = {
  version: 1, fps: FPS, size: { width: 1280, height: 720 }, background: BG, roles, nodes,
  shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 8] }], target: { follow: 'hero.root' } } }],
};
const wt = (id: string, t: number) =>
  worldTransform(probe, evaluateFrame(probe, t).nodes, id, { jointFrame: giantJointFrame, time: t });
const heroAt = (t: number): Vec3 => wt(j.root, t).position;

// -- slam: solve the upper-arm swing at T_SLAM so the club's lowest corner just touches the floor (y = 0.01) --
{
  const lowAt = (rx: number) => {
    giant.tracks!.joints!['upperArm.R'] = clubArm(rx);
    const w = wt('club', T_SLAM);
    return lowestCorner(w.position, w.quaternion, CLUB);
  };
  // scan from the arm overhead (club high) forward-down until the club first reaches the floor
  let lo = -2.9;
  let hi = NaN;
  for (let rx = -2.9; rx <= 0.5; rx += 0.02) {
    if (lowAt(rx) <= 0.01) { hi = rx; break; }
    lo = rx;
  }
  if (Number.isNaN(hi)) throw new Error('slam: the club never reaches the floor');
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (lowAt(mid) > 0.01) lo = mid;
    else hi = mid;
  }
  {
    lowAt(lo);
    const w = wt('club', T_SLAM);
    const tip = add(w.position, qrot(w.quaternion, [0, -CLUB[1] / 2, 0]));
    const tip2 = add(w.position, qrot(w.quaternion, [0, CLUB[1] / 2, 0]));
    console.log('slam upperArm rx', lo.toFixed(3), 'club ends', JSON.stringify([tip, tip2].map((p) => p.map((x) => +x.toFixed(2)))));
  }
  giant.tracks!.joints!['upperArm.R'] = clubArm(+lo.toFixed(4));
}

// -- sword pick-up: re-parent to the hand at T_GRAB (the capture keeps it where it lies), then author its WORLD
// orientation (floor -> blade raised forward-up -> grip pose) and convert it per frame into the hand-frame delta
// tracks, so the blade swings up and never through the floor while the hand is still low --
{
  const qs = eulerYXZToQuat(SWORD_FLOOR_ROT);
  const hand0 = wt(pick.hand, T_GRAB);
  const capQ = qmul(qconj(hand0.quaternion), qs);
  const capP = qrot(qconj(hand0.quaternion), sub(SWORD_FLOOR, hand0.position));
  const gripP: Vec3 = [0, -half * Math.cos(GRIP), -half * Math.sin(GRIP)];
  const gripQ = eulerYXZToQuat([GRIP, 0, 0]);
  const handSet = wt(pick.hand, T_SET);
  const qEnd = qmul(handSet.quaternion, gripQ);
  // blade (local -y, +x on the floor) swung up to point forward-up toward the gate at 50 degrees; the minimal
  // swing from the floor pose (no roll about the blade, so the 5 cm edge does not dig into the floor)
  const qUp = qmul(qFromTo([1, 0, 0], [0, Math.sin(0.87), -Math.cos(0.87)]), qs);
  const T_MID = r4(T_GRAB + 0.22);
  const ease = (u: number) => u * u * (3 - 2 * u);
  const pos: Track<Vec3> = [];
  const rot: Track<Vec3> = [];
  let prev: Vec3 = SWORD_FLOOR_ROT;
  for (const t of frameTimes(T_GRAB, T_SET)) {
    const h = wt(pick.hand, t);
    const qw = t <= T_MID ? qslerp(qs, qUp, ease((t - T_GRAB) / (T_MID - T_GRAB))) : qslerp(qUp, qEnd, ease((t - T_MID) / (T_SET - T_MID)));
    const lq = qmul(qconj(h.quaternion), qw); // wanted local rotation in the hand frame
    // the grip slides from where the hand caught it (capP, up to a few cm off) onto the hand pivot
    const u = ease((t - T_GRAB) / (T_SET - T_GRAB));
    const gripNow = add(qrot(lq, [0, half, 0]), [0, 0, 0]); // grip end, hand frame, if the centre were at 0
    const capGrip = add(capP, qrot(capQ, [0, half, 0])); // where the grip sat in the hand frame at the switch
    const lp = sub(scale(capGrip, 1 - u), gripNow);
    pos.push({ t, v: add(SWORD_FLOOR, sub(lp, capP)) });
    // local = capQ * Rk^-1 * R(t)  =>  R(t) = Rk * capQ^-1 * lq
    prev = eulerNear(qmul(qs, qmul(qconj(capQ), lq)), prev);
    rot.push({ t, v: prev });
  }
  const last = pos[pos.length - 1].v;
  const want = add(SWORD_FLOOR, sub(gripP, capP));
  if (Math.hypot(...sub(last, want)) > 1e-6) throw new Error('sword does not end in the grip pose');
  sword.tracks = { parent: [{ t: T_GRAB, v: { node: pick.hand } }], position: pos, rotation: rot };
}

// -- club release: world capture at T_REL (the hand is at rest there), then a ballistic arc (gravity 9.81 m/s^2):
// knocked loose with a small toss up and to the giant's right, one tumble, a bounce and a short slide --
const CLUB_LAND: Vec3 = [1.65, CLUB[0] / 2, -2.3]; // right of the fallen giant, clear of its arm and the hero
let clubLandT = 0;
{
  const w0 = wt('club', T_REL);
  const G = 9.81;
  const vy = 1.2;
  const y0 = w0.position[1] - CLUB_LAND[1];
  const tf = (vy + Math.sqrt(vy * vy + 2 * G * y0)) / G;
  clubLandT = r4(T_REL + tf);
  const vx = (CLUB_LAND[0] - w0.position[0]) / tf;
  const vz = (CLUB_LAND[2] - w0.position[2]) / tf;
  // final world orientation: lying flat, long axis across the hall at yaw 1.2; the track adds one full tumble on x
  const qFlat = eulerYXZToQuat([Math.PI / 2, 1.2, 0]);
  const rLand = eulerNear(qmul(eulerYXZToQuat(CLUB_ROT), qmul(qconj(w0.quaternion), qFlat)), CLUB_ROT);
  rLand[0] += 2 * Math.PI;
  const pos: Track<Vec3> = [];
  const rot: Track<Vec3> = [];
  const spinEnd = clubLandT - 0.06; // flat a little before contact, so no corner digs in
  for (const t of frameTimes(T_REL, clubLandT)) {
    const s = t - T_REL;
    const pw: Vec3 = [w0.position[0] + vx * s, w0.position[1] + vy * s - 0.5 * G * s * s, w0.position[2] + vz * s];
    pos.push({ t, v: add(CLUB_OFF, sub(pw, w0.position)) });
    const u = Math.min(1, s / (spinEnd - T_REL));
    rot.push({ t, v: CLUB_ROT.map((c, i) => lerp(c, rLand[i], u)) as Vec3 });
  }
  // one small bounce and a short slide, then rest
  const landDelta = sub(CLUB_LAND, w0.position);
  const slide: Vec3 = [0.12, 0, 0.08];
  const B = 0.22;
  for (const t of frameTimes(clubLandT, r4(clubLandT + B)).slice(1)) {
    const u = (t - clubLandT) / B;
    pos.push({ t, v: add(CLUB_OFF, add(landDelta, [slide[0] * u, 0.12 * 4 * u * (1 - u), slide[2] * u])) });
  }
  club.tracks = { visible: [{ t: 0, v: false }, { t: T_EMERGE, v: true }], parent: [{ t: T_REL, v: null }], position: pos, rotation: rot };
  console.log('club release', JSON.stringify({ at: w0.position.map((v) => +v.toFixed(3)), v: [vx, vy, vz].map((v) => +v.toFixed(2)), lands: clubLandT }));
}

// -- self-checks: props never below the floor --
{
  const worst = (id: string, size: Vec3, a: number, b: number) => {
    let min = Infinity;
    let at = a;
    for (const t of frameTimes(a, b)) {
      const w = wt(id, t);
      const y = lowestCorner(w.position, w.quaternion, size);
      if (y < min) [min, at] = [y, t];
    }
    return { min: +min.toFixed(4), at };
  };
  const s = worst('sword', SWORD_SIZE, 0, DUR);
  const c = worst('club', CLUB, T_SETTLED, DUR);
  console.log('lowest corner (m): sword', JSON.stringify(s), 'club', JSON.stringify(c));
  if (s.min < -0.005 || c.min < -0.005) throw new Error('a prop goes through the floor');
}

// ---- textured pass (`--passes=textured`): skinned / textured stand-ins, drawn ONLY there (look.show) ----
// Every block above keeps its motion; the visible ones get look.show 'flat' below, so beauty and depth are unchanged.
// The textured pass draws instead: the Quaternius Superhero retargeted onto the hero mannequin, a KayKit sword in its
// hand, the same Superhero retargeted onto the walker giant (model source: it follows the walker's posed bones, so the
// giant silhouettes match), and three Skeleton_Minion shadow warriors on the same rise tracks. The club box and the
// primitives (set, gate) stay in both passes with a lit `look.color`. All models are CC0 (models/quaternius,
// models/kaykit; see their README.md).
const K_DIR = 'models/kaykit/';
type Pose = { p: Vec3; q: Quat };
const compose = (a: Pose, b: Pose): Pose => ({ p: add(a.p, qrot(a.q, b.p)), q: qmul(a.q, b.q) });

// -- hero sword (sword_1handed.gltf: grip at the file origin, blade along +y; rest bounds below) --
// Placed rigidly in the frame of the flat sword box (grip at its +y end): flipped end for end (F: file y -> box -y,
// the blade width onto box z, so the blade lies flat on the floor and its edge leads the swing), the handle centre on
// the palm 7 cm below the wrist pivot (the box grip sits on the pivot itself; the mannequin has no hand block).
// Parent keys: at T_GRAB a `snap` key onto the hand PIVOT with absolute hand-frame tracks (= the box's motion composed
// with that offset; attach does not rewrite snap keys), then at T_RISE a plain key onto the same pivot, which
// retarget.attach turns into the rig's hand_r bone (world kept): from there the sword rides the drawn hand. Before
// T_RISE the retargeted hand misses the pivot (the rig arm cannot reach the floor grip: up to ~0.13 m at the grab),
// so the sword follows the mannequin's hand there, exactly as the flat box does.
const SWORD_MIN: Vec3 = [-0.2517, -0.3658, -0.0653];
const SWORD_MAX: Vec3 = [0.2517, 1.4095, 0.0653];
const SWORD_S = 0.53; // file units -> meters: 0.94 m overall, 0.75 m blade
const SWORD_TEX_SIZE = scale(sub(SWORD_MAX, SWORD_MIN), SWORD_S).map((v) => +v.toFixed(4)) as Vec3;
const SWORD_HANDLE = -0.15; // file y of the handle centre
const PALM: Vec3 = [0, -0.07, 0]; // hand frame
const SWORD_LIFT = 0.012; // along box x (= up while it lies on the floor): the 7 cm thick guard clears the floor
const swordOff: Pose = {
  p: add([SWORD_LIFT, half - ((SWORD_MIN[1] + SWORD_MAX[1]) / 2 - SWORD_HANDLE) * SWORD_S, 0], qrot(qconj(eulerYXZToQuat([GRIP, 0, 0])), PALM)),
  q: [Math.SQRT1_2, 0, Math.SQRT1_2, 0], // 180 deg about (1, 0, 1)/sqrt 2: x -> z, y -> -y, z -> x
};
const swordFloor = compose({ p: SWORD_FLOOR, q: eulerYXZToQuat(SWORD_FLOOR_ROT) }, swordOff);
const r6v = (v: Vec3): Vec3 => v.map((x) => +x.toFixed(6)) as Vec3;
const swordTex: PrevisNode = (() => {
  const pos: Track<Vec3> = [{ t: 0, v: r6v(swordFloor.p), ease: 'step' }];
  let prev = quatToEulerYXZ(swordFloor.q);
  const rot: Track<Vec3> = [{ t: 0, v: r6v(prev), ease: 'step' }];
  let low = { y: Infinity, t: 0 };
  for (const t of frameTimes(T_GRAB, T_SET)) {
    const h = wt(pick.hand, t);
    const s = wt('sword', t);
    const local = compose({ p: qrot(qconj(h.quaternion), sub(s.position, h.position)), q: qmul(qconj(h.quaternion), s.quaternion) }, swordOff);
    prev = eulerNear(local.q, prev);
    pos.push({ t, v: r6v(local.p) });
    rot.push({ t, v: r6v(prev) });
  }
  // lowest corner of the model's bounds while it follows the mannequin (the bone part is checked in the render)
  for (const t of frameTimes(0, T_RISE)) {
    const w = t < T_GRAB ? swordFloor : compose({ p: wt(pick.hand, t).position, q: wt(pick.hand, t).quaternion }, { p: evalTrack(pos, t, [0, 0, 0] as Vec3), q: eulerYXZToQuat(evalTrack(rot, t, [0, 0, 0] as Vec3)) });
    const y = lowestCorner(w.p, w.q, SWORD_TEX_SIZE);
    if (y < low.y) low = { y: +y.toFixed(4), t };
  }
  console.log('textured sword lowest bounds corner before T_RISE (m)', JSON.stringify(low));
  if (low.y < -0.005) throw new Error('the textured sword goes through the floor');
  return {
    id: 'sword_tex',
    shape: 'model',
    role: 'sword',
    color: cSword,
    look: { show: 'textured' },
    model: { src: K_DIR + 'sword_1handed.gltf', fit: 'contain' },
    position: r6v(swordFloor.p),
    rotation: r6v(quatToEulerYXZ(swordFloor.q)),
    size: SWORD_TEX_SIZE,
    tracks: {
      parent: [{ t: T_GRAB, v: { node: pick.hand, snap: true } }, { t: T_RISE, v: { node: pick.hand } }],
      position: pos,
      rotation: rot,
    },
  };
})();

// -- hero: skinned character driven by the jointed mannequin (model.retarget), sword props ride its hand bone --
const heroSkin: PrevisNode = {
  id: 'hero_skin',
  shape: 'model',
  role: 'hero',
  color: cHero,
  look: { show: 'textured' },
  model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'hero', map: 'ue', attach: true } },
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [1, 1.8, 0.4],
};

// -- giant: the Quaternius Superhero retargeted onto the flat walker giant (model.retarget with a MODEL source): every
// frame it takes the walker's posed bones (walk -> wave clips, the hand-posed club arm / torso / head joints, ground lock)
// and the walker's world tracks (emerge, stop, toe-pivot topple), drawn at the walker's leg ratio with its hips on the
// walker's hips, so the textured silhouette follows the flat one. The walker itself is flat-only; in the textured pass it
// stays loaded but undrawn (pose only), so the club box below can keep riding its forearm in both passes --
const giantTex: PrevisNode = {
  id: 'giant_tex',
  shape: 'model',
  role: 'giant',
  color: cGiant,
  look: { show: 'textured' },
  model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'giant', map: 'ue', sourceMap: 'walker' } },
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [1.6, GIANT_H, 1.0],
  visible: false,
  tracks: { visible: giant.tracks!.visible },
};

// -- shadow warriors: Skeleton_Minion (rest bounds 1.94 x 2.17 x 0.91 file units) on the same rise tracks --
const shadowTex: PrevisNode[] = warriors.map((w, i) => ({
  id: `${w.id}_tex`,
  shape: 'model',
  role: 'shadow',
  color: cShadow,
  look: { show: 'textured' },
  model: { src: K_DIR + 'Skeleton_Minion.glb', fit: 'contain', animation: { clip: 'Idle_Combat', start: RISE[i], loop: 'repeat' } },
  position: w.position,
  rotation: w.rotation,
  size: [1.75, WARRIOR_H, 0.85],
  visible: false,
  tracks: w.tracks,
}));

// -- flat stand-ins: drawn by beauty / depth only (their pivots and every motion unchanged) --
for (const n of [...heroNodes.filter((h) => h.visible !== false), sword, giant, ...warriors]) n.look = { show: 'flat' };
// -- the club box is drawn in BOTH passes (lit rough stone in the textured one): it rides the walker's forearm, which the
// textured giant's hand follows, so the weapon silhouette is the same in every pass --
club.look = { color: [0.34, 0.32, 0.3], roughness: 0.95 };
// -- primitives: a lit stone look for the textured pass (the flat role colors are kept for beauty / depth) --
for (const n of set) n.look = { color: n.id.startsWith('pillar') ? [0.36, 0.34, 0.33] : n.id === 'floor' ? [0.3, 0.29, 0.28] : [0.32, 0.31, 0.3], roughness: 0.9 };
gate.look = { color: [0.5, 0.42, 0.9], roughness: 0.6 };
// -- hair: Quaternius "Rigged to Head Bone" hairstyles (same skeleton as the Superhero), retargeted from the same source as
// the skin they belong to, so their Head bone gets exactly the skin's pose (eyebrows are part of the body file) --
const H_DIR = 'models/quaternius/hair/';
const heroHair = retargetParts(heroSkin, [{ id: 'hero_hair', src: H_DIR + 'Hair_SimpleParted.gltf' }]);
const giantHair = retargetParts(giantTex, [{ id: 'giant_beard', src: H_DIR + 'Hair_Beard.gltf' }]);
const texturedNodes: PrevisNode[] = [heroSkin, ...heroHair, swordTex, giantTex, ...giantHair, ...shadowTex];

// ---- cameras ----
const sample = (a: number, b: number, step: number, f: (t: number) => Vec3): Track<Vec3> => {
  const out: Track<Vec3> = [];
  for (let t = a; t < b - 1e-9; t += step) out.push({ t: r4(t), v: f(t), ease: 'smooth' });
  out.push({ t: b, v: f(b) });
  return out;
};

// centre of the final top-down frame: between the hero and the fallen giant, so the shadow triangle, the giant and
// the club all sit inside it
const TOP: Vec3 = [-1.6, 0, -3.4];
const shots: Shot[] = [
  {
    // 1. establish: low wide angle behind/beside the hero; tilts from the sword on the floor up to the gate
    id: 's1-establish',
    note: 'low wide from behind-right, slow smooth push-in; tilt from the hero picking up his sword to the dark gate',
    start: 0,
    end: 1.5,
    camera: {
      position: [
        { t: 0, v: [2.3, 0.5, 6.4], ease: 'smooth' },
        { t: 0.75, v: [2.05, 0.5, 5.9], ease: 'smooth' },
        { t: 1.5, v: [1.8, 0.55, 5.3] },
      ],
      target: { track: [
        { t: 0, v: [0.4, 0.55, 0.6], ease: 'smooth' },
        { t: 0.8, v: [0.3, 0.7, -0.2], ease: 'smooth' },
        { t: 1.5, v: [0, 1.7, -5.5] },
      ] },
      fov: [{ t: 0, v: 36 }],
    },
  },
  {
    // 2. emerge: over the hero's shoulder, slight roll easing in
    id: 's2-emerge',
    note: 'over-the-shoulder, slow smooth push; the stone giant walks out of the gate with its club',
    start: 1.5,
    end: 3.0,
    camera: {
      position: [
        { t: 1.5, v: [0.95, 1.95, 4.4], ease: 'smooth' },
        { t: 2.25, v: [0.9, 1.93, 4.15], ease: 'smooth' },
        { t: 3.0, v: [0.85, 1.9, 3.9] },
      ],
      target: { track: [
        { t: 1.5, v: [0, 1.9, -5], ease: 'smooth' },
        { t: 2.25, v: [0, 1.95, -4.4], ease: 'smooth' },
        { t: 3.0, v: [0, 2.0, -3.8] },
      ] },
      fov: [{ t: 1.5, v: 42 }],
      roll: [{ t: 1.5, v: 0, ease: 'ease-in' }, { t: 3.0, v: 0.08 }],
    },
  },
  {
    // 3. clash: low side tracking dolly following the hero, handheld
    id: 's3-clash',
    note: 'low side handheld tracking dolly: hero dashes in, the club slams down, hero side-steps clear',
    start: 3.0,
    end: 4.5,
    camera: {
      position: sample(3.0, 4.5, 1 / 12, (t) => {
        const h = heroAt(t);
        return [0.5 * h[0] + 4.4, 0.7, h[2] - 0.3];
      }),
      target: { follow: 'hero.root', offset: [0.4, 1.4, -0.9] },
      fov: [{ t: 3.0, v: 58 }],
      shake: { amp: 0.035, freq: 4, roll: 0.012, seed: 3 },
    },
  },
  {
    // 4. leap: low and close, looking up; roll swings, fov widens on the apex
    id: 's4-leap',
    note: 'low close handheld looking up: crouch, leap past the giant\'s shoulder with the sword overhead',
    start: 4.5,
    end: 6.0,
    camera: {
      position: [
        { t: 4.5, v: add(SIDESTEP_END, [-0.6, 0.45, 2.0]), ease: 'smooth' },
        { t: 5.25, v: add(SIDESTEP_END, [-0.75, 0.35, 1.8]), ease: 'smooth' },
        { t: 6.0, v: add(SIDESTEP_END, [-0.9, 0.3, 1.7]) },
      ],
      // look at the hips in the crouch, then up at the chest/sword line once airborne
      target: { track: sample(4.5, 6.0, 1 / 12, (t) => add(heroAt(t), [0, t < T_TAKE ? 0.85 : lerp(0.85, 1.45, Math.min(1, (t - T_TAKE) / 0.3)), 0])) },
      fov: [{ t: 4.5, v: 70, ease: 'ease-in-out' }, { t: 5.4, v: 82, ease: 'ease-in-out' }, { t: 6.0, v: 74 }],
      roll: [{ t: 4.5, v: -0.15, ease: 'ease-in-out' }, { t: 6.0, v: 0.15 }],
      shake: { amp: 0.03, freq: 5, roll: 0.018, seed: 4 },
    },
  },
  {
    // 5. aftermath: high angle crane up to a straight-down top shot over the hero by the end
    id: 's5-aftermath',
    note: 'high angle, smooth crane up to a near top-down: landing, the giant topples, club tumbles away, shadows rise',
    start: 6.0,
    end: 8.0,
    camera: {
      position: [
        { t: 6.0, v: [-3.6, 2.2, 0.6], ease: 'smooth' },
        { t: 6.8, v: add(TOP, [-1.0, 4.6, 2.2]), ease: 'smooth' },
        { t: 7.6, v: add(TOP, [0, 6.0, 0.15]), ease: 'smooth' },
        { t: 8.0, v: add(TOP, [0, 6.2, 0]) },
      ],
      target: { track: [
        { t: 6.0, v: [-0.8, 0.9, -3.4], ease: 'smooth' },
        { t: 6.8, v: add(TOP, [0, 0.3, 0]), ease: 'ease-out' },
        { t: 7.6, v: TOP },
      ] },
      fov: [{ t: 6.0, v: 50, ease: 'ease-in-out' }, { t: 7.6, v: 72 }],
      // world up turns to -z while the eye climbs over the target, so the top-down frame keeps screen-up = -z
      up: [{ t: 6.6, v: [0, 1, 0], ease: 'ease-in-out' }, { t: 7.5, v: [0, 0, -1] }],
    },
  },
];

const markers: PrevisMarker[] = [
  { t: T_GRAB, label: 'hero grips the sword lying on the floor' },
  { t: T_EMERGE, label: 'cut: the stone giant steps out of the gate' },
  { t: T_DASH, label: 'cut: hero dashes at the giant' },
  { t: 3.5, label: 'giant raises the club overhead' },
  { t: T_SLAM, label: 'club slams the floor where the hero stood (impact, debris)' },
  { t: T_LOAD, label: 'cut: hero crouches to leap' },
  { t: T_TAKE, label: 'take-off' },
  { t: T_TAKE + AIR / 2, label: 'apex beside the giant\'s shoulder, sword overhead' },
  { t: T_LAND, label: 'cut: hero lands behind the giant, slash down' },
  { t: T_TOPPLE, label: 'giant starts to topple forward; its grip opens and the club drops out of its hand' },
  { t: clubLandT, label: 'club hits the floor and bounces' },
  { t: T_DOWN, label: 'giant hits the floor (impact, dust)' },
  { t: RISE[0], label: 'first shadow warrior rises' },
  { t: 7.6, label: 'top-down hold: hero inside the shadow triangle' },
];

const doc: PrevisDoc = {
  version: 1,
  title: 'Gate Raid',
  fps: FPS,
  size: { width: 1280, height: 720 },
  background: BG,
  worldScale: 10,
  avoidColors: avoid,
  // textured pass only (beauty / depth ignore it)
  lighting: {
    key: { dir: [0.35, 0.9, 0.45], intensity: 1.2, shadows: true },
    env: { sky: [0.42, 0.46, 0.62], ground: [0.18, 0.16, 0.16], intensity: 1.0 },
    rim: [{ position: [0, 2.2, -4.6], color: [0.55, 0.45, 1.0], intensity: 6, range: 9 }],
    exposure: 1.45,
    toneMapping: 'aces',
  },
  roles,
  nodes: [...nodes, ...texturedNodes],
  shots,
  markers,
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
      '공기 중 먼지가 게이트 빛을 받아 떠다님; 3.8초 몽둥이가 바닥을 칠 때 돌 파편, 6.1~6.9초 거인이 쓰러질 때 바닥에서 먼지가 크게 일어남',
      '4.8~6.0초 도약 때 검날이 게이트 빛을 받아 번쩍임, 6.0초 착지 베기 때 검에서 불꽃이 튐',
      '그림자 병사들은 6.4/6.6/6.8초에 바닥의 검은 그림자 웅덩이에서 솟아오름 (실루엣 검은 연기, 눈만 청보라로 빛남)',
      '표정: 처음엔 침착하게 검을 집어 들고 게이트를 응시 -> 돌진할 때 이를 악문 집중 -> 착지 후 담담한 무표정',
      `거인은 오른손에 거친 돌 몽둥이를 쥐고 있음(3.2~3.8초 내려쳐 바닥을 찍음, ${T_REL.toFixed(1)}초 쓰러지기 시작하며 손에서 빠져 공중에서 한 바퀴 돌고 ${clubLandT.toFixed(2)}초 바닥에 튕긴 뒤 멈춤); 몽둥이 색은 previs 색이 아니라 돌 질감`,
      '손: 0.75초 주인공이 바닥에 놓인 검의 손잡이를 오른손으로 잡아 들어 올림, 도약 때 두 팔을 머리 위로 들어 검을 치켜듦, 착지 후 오른손 한 손으로 검을 낮게 듦',
      '질감·의상·얼굴은 참조 이미지 기준, previs 블록 모양과 색은 따르지 말 것',
    ],
  });
  const md = `# Gate Raid handoff\n\n## 업로드 순서\n${h.uploadOrder.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## 프롬프트\n\n\`\`\`\n${h.prompt}\n\`\`\`\n`;
  fs.writeFileSync(process.env.HANDOFF_OUT, md);
  console.log('wrote', process.env.HANDOFF_OUT);
}
