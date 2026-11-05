// 불씨지기 S08 "다시 타오르는 불" (45 s): Haon places the ember on the altar, kneels, the ember and six braziers
// flare, skeletons in the dark collapse, Haon rises, the mentor appears in the entrance, crane up to a top-down.
// Run from web/: node --experimental-strip-types previs/examples/film/s08-rekindled.gen.ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, walk, crouch, pickUp, evaluateFrame, worldPosition } from '../../../src/previs/index.ts';
import type { PrevisDoc, PrevisNode, Shot, Vec3, Track } from '../../../src/previs/index.ts';
import { BG, C, FPS, LIGHT, LOOK, PILLAR_FLAT, ROLES, SIZE, SRC, AVOID, MINION_H, EMBER_D, character, flatOnly, writeDoc, sample, r4, add } from './common.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUR = 45.0;
const PI = Math.PI;

// ---- timeline ----
const T_WALK0 = 0.5, T_WALK1 = 11.0; // approach
const T_REACH = 12.0, T_PLACE = 13.6, T_REACH_END = 14.9; // pickUp-style reach to the bowl
const T_BACK0 = 15.2, T_BACK1 = 16.2; // one step back
const T_KNEEL0 = 16.6, T_KNEEL1 = 18.2; // crouch down
const T_GROW0 = 17.0, T_GROW1 = 20.0; // ember 0.16 -> 0.55
const T_BRAZ0 = 20.8, BRAZ_STEP = 0.9, BRAZ_GROW = 0.9; // braziers ignite one by one
const T_COLLAPSE = [26.3, 26.7, 27.1]; // skeletons collapse
const T_RISE0 = 29.0, T_RISE1 = 30.4;
const T_MENTOR_SHOW = 32.4, T_MENTOR0 = 32.5, T_MENTOR1 = 38.0;
const T_TURN0 = 32.5, T_TURN1 = 33.9;

// ---- set geometry ----
const ALTAR_R = 0.4, ALTAR_H = 1.05; // column
const DISH_TOP = 1.14; // shallow bowl rim/top height; the ember rests on it
const EMBER_END_D = 0.55;
const START: Vec3 = [-7.8, 0, 0.2];
const STAND: Vec3 = [-0.74, 0, 0.2]; // reach spot, facing +x
const BACK: Vec3 = [-1.19, 0, 0.2]; // kneel spot
const MENTOR_START: Vec3 = [-8.4, 0, 0.2];
const MENTOR_STOP: Vec3 = [-3.3, 0, 0.2];
const BOWL_EMBER: Vec3 = [0, DISH_TOP + EMBER_D / 2, 0];
const OFFSET: Vec3 = [0, -0.09, 0.03]; // ember in the hand pivot frame (as common.ts carry)
const CARRY_SH = -0.5, CARRY_EL = -1.1;
const BRAZ_R = 3.0;
const brazierAngles = [30, 90, 150, 210, 270, 330].map((d) => (d * PI) / 180);
const brazierPos: Vec3[] = brazierAngles.map((a) => [BRAZ_R * Math.cos(a), 0, BRAZ_R * Math.sin(a)]);
// ignition order around the ring, starting at the west side (visible from the pan camera)
const igniteOrder = [2, 3, 4, 5, 0, 1];
const igniteTime = (idx: number) => T_BRAZ0 + BRAZ_STEP * igniteOrder.indexOf(idx);

// ---- helpers ----
type Frag = Record<string, Record<string, { t: number; v: any; ease?: any }[]>>;
const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (u: number) => u * u * (3 - 2 * u);
const dropProps = (f: Frag, id: string, props?: string[]) => {
  if (!f[id]) return;
  if (!props) delete f[id];
  else for (const p of props) delete f[id][p];
};
/** Time-reversed copy of a motion fragment over [a, b] (a walk played backward = a backward step). */
const reverseFrag = (f: Frag, a: number, b: number): Frag => {
  const out: Frag = {};
  for (const [id, props] of Object.entries(f)) {
    out[id] = {};
    for (const [p, keys] of Object.entries(props)) {
      out[id][p] = keys.map((k) => ({ t: r4(a + b - k.t), v: k.v })).reverse();
    }
  }
  return out;
};

// ---- characters ----
const haon = character('haon', START, PI / 2);
const mentor = character('mentor', MENTOR_START, PI / 2);
const hj = haon.j;
const mj = mentor.j;

// ---- haon motion (built for a given reach target) ----
function haonFrags(target: Vec3) {
  const frags: Frag[] = [];
  // approach: walk's left shoulder/elbow and yaw are replaced (carry pose, authored yaw)
  const w1 = walk({ joints: hj, from: START, to: STAND, start: T_WALK0, end: T_WALK1, stepsPerSecond: 1.3 }) as unknown as Frag;
  dropProps(w1, hj.shoulderL);
  dropProps(w1, hj.elbowL);
  dropProps(w1, hj.root, ['rotation']);
  frags.push(w1);
  frags.push({
    [hj.shoulderL]: { rotation: [{ t: 0, v: [CARRY_SH, 0, 0] }] },
    [hj.elbowL]: { rotation: [{ t: 0, v: [CARRY_EL, 0, 0] }] },
  });
  const pick = pickUp({ mannequin: haon.m, side: 'left', target, start: T_REACH, grab: T_PLACE, end: T_REACH_END, depth: 0.14, lean: 0.45, fps: FPS, rootPosition: STAND, rootYaw: PI / 2 });
  const pm = pick.motion as unknown as Frag;
  // blend the first 0.7 s of the left arm from the carry pose
  const blend = (id: string, carry: number) => {
    const keys = pm[id]?.rotation;
    if (!keys) return;
    for (const k of keys) {
      const u = (k.t - T_REACH) / 0.7;
      if (u >= 1) break;
      const w = 1 - smooth(Math.max(0, u));
      k.v = [lerp(k.v[0], carry, w), k.v[1], k.v[2]];
    }
  };
  blend(hj.shoulderL, CARRY_SH);
  blend(hj.elbowL, CARRY_EL);
  frags.push(pm);
  // one step back (a walk played backward)
  const w2 = reverseFrag(walk({ joints: hj, from: BACK, to: STAND, start: T_BACK0, end: T_BACK1, stepsPerSecond: 1.3 }) as unknown as Frag, T_BACK0, T_BACK1);
  dropProps(w2, hj.shoulderL);
  dropProps(w2, hj.shoulderR);
  dropProps(w2, hj.root, ['rotation']);
  frags.push(w2);
  // kneel and rise
  frags.push(crouch({ mannequin: haon.m, start: T_KNEEL0, end: T_KNEEL1, depth: 0.6, fps: FPS }) as unknown as Frag);
  frags.push(crouch({ mannequin: haon.m, start: T_RISE0, end: T_RISE1, from: 0.6, depth: 0, fps: FPS }) as unknown as Frag);
  frags.push({
    [hj.root]: {
      rotation: [
        { t: 0, v: [0, PI / 2, 0] },
        { t: T_TURN0, v: [0, PI / 2, 0], ease: 'ease-in-out' },
        { t: T_TURN0 + 0.7, v: [0, 0.2, 0], ease: 'ease-in-out' },
        { t: T_TURN1, v: [0, -PI / 2 + 0.1, 0] },
        { t: 38.5, v: [0, -PI / 2 + 0.1, 0], ease: 'ease-in-out' },
        { t: 39.5, v: [0, -PI / 2 + 0.28, 0] },
      ],
    },
    [hj.spine]: {
      rotation: [
        { t: T_REACH_END + 0.05, v: [0, 0, 0] },
        { t: T_KNEEL0, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: T_KNEEL1, v: [0.42, 0, 0] },
        { t: T_RISE0, v: [0.42, 0, 0], ease: 'ease-in-out' },
        { t: T_RISE1, v: [0, 0, 0] },
      ],
    },
    [hj.shoulderL]: {
      rotation: [
        { t: T_REACH_END + 0.05, v: [0, 0, 0] },
        { t: T_KNEEL0, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: T_KNEEL1, v: [-0.5, 0, 0] },
        { t: T_RISE0, v: [-0.5, 0, 0], ease: 'ease-in-out' },
        { t: T_RISE1, v: [0, 0, 0] },
      ],
    },
    [hj.shoulderR]: {
      rotation: [
        { t: T_BACK1 + 0.05, v: [0, 0, 0] },
        { t: T_KNEEL0, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: T_KNEEL1, v: [-0.5, 0, 0] },
        { t: T_RISE0, v: [-0.5, 0, 0], ease: 'ease-in-out' },
        { t: T_RISE1, v: [0, 0, 0] },
      ],
    },
    [hj.elbowL]: {
      rotation: [
        { t: T_REACH_END + 0.05, v: [0, 0, 0] },
        { t: T_KNEEL0, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: T_KNEEL1, v: [-0.45, 0, 0] },
        { t: T_RISE0, v: [-0.45, 0, 0], ease: 'ease-in-out' },
        { t: T_RISE1, v: [0, 0, 0] },
      ],
    },
    [hj.elbowR]: {
      rotation: [
        { t: 0, v: [0, 0, 0] },
        { t: T_KNEEL0, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: T_KNEEL1, v: [-0.45, 0, 0] },
        { t: T_RISE0, v: [-0.45, 0, 0], ease: 'ease-in-out' },
        { t: T_RISE1, v: [0, 0, 0] },
      ],
    },
    [hj.head]: {
      rotation: [
        { t: 0, v: [0, 0, 0] },
        { t: T_WALK1 - 1, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: T_WALK1 + 0.6, v: [0.25, 0, 0], ease: 'ease-in-out' },
        { t: T_PLACE - 0.4, v: [0.45, 0, 0], ease: 'ease-in-out' },
        { t: T_REACH_END, v: [0.3, 0, 0], ease: 'ease-in-out' },
        { t: T_KNEEL1, v: [0.65, 0, 0] },
        { t: T_RISE0 - 0.2, v: [0.65, 0, 0], ease: 'ease-in-out' },
        { t: T_RISE1, v: [-0.12, 0, 0], ease: 'ease-in-out' },
        { t: 31.2, v: [-0.42, 0, 0] },
        { t: T_TURN0, v: [-0.42, 0, 0], ease: 'ease-in-out' },
        { t: T_TURN1, v: [0.02, 0, 0] },
        { t: 36.5, v: [0.02, 0, 0], ease: 'ease-in-out' },
        { t: 37.3, v: [0.14, 0, 0] },
      ],
    },
  });
  return { frags, pick };
}

const emberHeld = (): PrevisNode => ({
  id: 'ember', shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.ember, parent: hj.handL,
  position: OFFSET, rotation: [0, 0, 0], size: [EMBER_D, EMBER_D, EMBER_D],
  tracks: { visible: [{ t: 0, v: true }, { t: T_PLACE, v: false }] },
});

// solve the reach target so the held ember (flat pass hand pivot) lands exactly on the bowl at T_PLACE
let target: Vec3 = [BOWL_EMBER[0], BOWL_EMBER[1], BOWL_EMBER[2]];
let built = haonFrags(target);
for (let it = 0; it < 6; it++) {
  const nodes = applyMotion(haon.m.nodes, built.frags as any);
  const probe: PrevisDoc = { version: 1, title: 'p', fps: FPS, size: SIZE, background: BG, roles: ROLES, nodes: [...nodes, emberHeld()], shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 8] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }] };
  const fs_ = evaluateFrame(probe, T_PLACE);
  const w = worldPosition(probe, fs_.nodes, 'ember');
  const d: Vec3 = [BOWL_EMBER[0] - w[0], BOWL_EMBER[1] - w[1], BOWL_EMBER[2] - w[2]];
  const sh = worldPosition(probe, fs_.nodes, hj.shoulderL);
  const wr = worldPosition(probe, fs_.nodes, hj.handL);
  console.log(`iter ${it} ember err ${Math.hypot(...d).toFixed(4)} miss ${built.pick.miss.toFixed(4)} shoulder->wrist ${Math.hypot(wr[0] - sh[0], wr[1] - sh[1], wr[2] - sh[2]).toFixed(3)}`);
  if (Math.hypot(...d) < 5e-4) break;
  target = add(target, d);
  built = haonFrags(target);
}
if (built.pick.miss > 1e-3) throw new Error(`reach miss ${built.pick.miss}`);
const haonNodes = flatOnly(applyMotion(haon.m.nodes, built.frags as any));

// ---- mentor motion ----
const mFrags: Frag[] = [];
const mw = walk({ joints: mj, from: MENTOR_START, to: MENTOR_STOP, start: T_MENTOR0, end: T_MENTOR1, stepsPerSecond: 1.6 }) as unknown as Frag;
dropProps(mw, mj.root, ['rotation']);
mFrags.push(mw);
mFrags.push({
  [mj.root]: { rotation: [{ t: 0, v: [0, PI / 2, 0] }, { t: T_MENTOR1 - 0.3, v: [0, PI / 2, 0], ease: 'ease-in-out' }, { t: 39.5, v: [0, PI / 2 - 0.25, 0] }] },
  [mj.head]: { rotation: [{ t: 0, v: [0, 0, 0] }, { t: T_MENTOR1, v: [0, 0, 0], ease: 'ease-in-out' }, { t: 38.9, v: [0.12, 0.2, 0] }] },
});
const mentorNodes = flatOnly(applyMotion(mentor.m.nodes, mFrags as any));
const mentorHidden: Track<boolean> = [{ t: 0, v: false }, { t: T_MENTOR_SHOW, v: true }];
for (const n of mentorNodes) if (n.visible !== false) n.tracks = { ...(n.tracks ?? {}), visible: mentorHidden };
mentor.skin.tracks = { visible: mentorHidden };

// ---- set ----
const set: PrevisNode[] = [];
set.push({ id: 'floor', shape: 'box', color: [0.2, 0.2, 0.22], look: LOOK.floor, position: [0, -0.25, 0], rotation: [0, 0, 0], size: [20, 0.5, 20] });
// inner floor disc around the altar
set.push({ id: 'floor_disc', shape: 'cylinder', color: [0.24, 0.23, 0.24], look: LOOK.darkStone, position: [0, 0.01, 0], rotation: [0, 0, 0], size: [7.4, 0.02, 7.4] });
// pillar ring (16 slots, the west slot is the entrance) + wall segments between them
const RING_R = 8;
for (let k = 0; k < 16; k++) {
  if (k === 8) continue; // entrance (west)
  const a = (k * 22.5 * PI) / 180;
  const px = RING_R * Math.cos(a), pz = RING_R * Math.sin(a);
  set.push({ id: `pillar${k}`, shape: 'cylinder', color: PILLAR_FLAT, look: LOOK.pillar, position: [px, 2, pz], rotation: [0, 0, 0], size: [1.1, 4, 1.1] });
  set.push({ id: `pillar${k}_base`, shape: 'box', color: PILLAR_FLAT, look: LOOK.darkStone, position: [px, 0.15, pz], rotation: [0, 0, 0], size: [1.5, 0.3, 1.5] });
  set.push({ id: `pillar${k}_cap`, shape: 'box', color: PILLAR_FLAT, look: LOOK.darkStone, position: [px, 3.85, pz], rotation: [0, 0, 0], size: [1.5, 0.3, 1.5] });
}
for (let k = 0; k < 16; k++) {
  if (k === 7 || k === 8) continue; // doorway span
  const a = ((k * 22.5 + 11.25) * PI) / 180;
  set.push({ id: `wall${k}`, shape: 'box', color: [0.25, 0.24, 0.26], look: LOOK.wall, position: [(RING_R + 0.1) * Math.cos(a), 2, (RING_R + 0.1) * Math.sin(a)], rotation: [0, PI / 2 - a, 0], size: [3.2, 4, 0.7] });
}
for (const sgn of [1, -1]) set.push({ id: `door_side${sgn > 0 ? 'L' : 'R'}`, shape: 'box', color: [0.25, 0.24, 0.26], look: LOOK.wall, position: [-RING_R, 2, sgn * 1.7], rotation: [0, 0, 0], size: [0.9, 4, 1.2] });
set.push({ id: 'door_lintel', shape: 'box', color: [0.25, 0.24, 0.26], look: LOOK.darkStone, position: [-RING_R, 3.5, 0], rotation: [0, 0, 0], size: [1.0, 1.0, 2.4] });
// altar: column, cap slab, shallow dish (the bowl)
set.push({ id: 'altar_col', shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.pillar, position: [0, ALTAR_H / 2 - 0.04, 0], rotation: [0, 0, 0], size: [ALTAR_R * 2, ALTAR_H - 0.08, ALTAR_R * 2] });
set.push({ id: 'altar_cap', shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.darkStone, position: [0, ALTAR_H - 0.02, 0], rotation: [0, 0, 0], size: [1.0, 0.1, 1.0] });
set.push({ id: 'altar_bowl', shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.bronze, position: [0, (ALTAR_H + 0.03 + DISH_TOP) / 2, 0], rotation: [0, 0, 0], size: [0.56, DISH_TOP - ALTAR_H - 0.03, 0.56] });
set.push({ id: 'altar_bowl_rim', shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.bronze, position: [0, DISH_TOP - 0.015, 0], rotation: [0, 0, 0], size: [0.64, 0.03, 0.64] });

// braziers + flames
brazierPos.forEach((p, i) => {
  set.push({ id: `braz${i}_stand`, shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.darkStone, position: [p[0], 0.38, p[2]], rotation: [0, 0, 0], size: [0.3, 0.76, 0.3] });
  set.push({ id: `braz${i}_bowl`, shape: 'cylinder', role: 'altar', color: C.altar, look: LOOK.iron, position: [p[0], 0.84, p[2]], rotation: [0, 0, 0], size: [0.62, 0.16, 0.62] });
  const t0 = igniteTime(i);
  // two stacked blobs sitting inside the bowl rim (bowl top 0.92): base 0.30 x 0.24, tip 0.16 x 0.22
  const BASE_BOT = 0.88, TIP_BOT = 1.05;
  const blob = (id: string, w: number, h: number, bot: number, ta: number, tb: number, bot0 = bot) => {
    const sz = (ww: number, hh: number): Vec3 => [ww, hh, ww];
    const ps = (hh: number, b0 = bot): Vec3 => [p[0], b0 + hh / 2, p[2]];
    set.push({
      id, shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.flame, visible: false,
      position: ps(0.03, bot0), rotation: [0, 0, 0], size: sz(0.03, 0.03),
      tracks: {
        visible: [{ t: 0, v: false }, { t: ta, v: true }],
        size: [{ t: 0, v: sz(0.03, 0.03) }, { t: ta, v: sz(0.03, 0.03), ease: 'ease-out' }, { t: tb, v: sz(w, h) }],
        position: [{ t: 0, v: ps(0.03, bot0) }, { t: ta, v: ps(0.03, bot0), ease: 'ease-out' }, { t: tb, v: ps(h) }],
      },
    });
  };
  blob(`flame${i}`, 0.3, 0.24, BASE_BOT, t0, t0 + BRAZ_GROW);
  blob(`flameT${i}`, 0.16, 0.22, TIP_BOT, t0 + 0.25, t0 + BRAZ_GROW + 0.1, 0.92);
});

// ember in the bowl: grows, bottom stays on the dish top
const eg = (d: number): { s: Vec3; p: Vec3 } => ({ s: [d, d, d], p: [0, DISH_TOP + d / 2, 0] });
const e0 = eg(EMBER_D), e1 = eg(0.3), e2 = eg(EMBER_END_D);
const T_G_MID = T_GROW0 + 0.6 * (T_GROW1 - T_GROW0);
const emberBowl: PrevisNode = {
  id: 'ember_bowl', shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.ember, visible: false,
  position: e0.p, rotation: [0, 0, 0], size: e0.s,
  tracks: {
    visible: [{ t: 0, v: false }, { t: T_PLACE, v: true }],
    size: [
      { t: 0, v: e0.s }, { t: T_GROW0, v: e0.s, ease: 'ease-in-out' }, { t: T_G_MID, v: e1.s, ease: 'ease-in-out' }, { t: T_GROW1, v: e2.s },
    ],
    position: [
      { t: 0, v: e0.p }, { t: T_GROW0, v: e0.p, ease: 'ease-in-out' }, { t: T_G_MID, v: e1.p, ease: 'ease-in-out' }, { t: T_GROW1, v: e2.p },
    ],
  },
};
const heldEmber = emberHeld();

// skeletons in the dark east edge, standing guard until the ember flares, then sagging into rest
const minionSpots: { p: Vec3; yaw: number; speed: number }[] = [
  { p: [5.6, 0, -1.3], yaw: -PI / 2 + 0.3, speed: 0.9 },
  { p: [4.7, 0, -3.7], yaw: -PI / 2 + 0.8, speed: 1.0 },
  { p: [5.9, 0, 1.4], yaw: -PI / 2 - 0.4, speed: 1.1 },
];
const minions: PrevisNode[] = minionSpots.map((s, i) => ({
  id: `minion${i}`, shape: 'model', role: 'skeleton', color: C.skeleton,
  model: {
    src: SRC.minion, fit: 'contain', groundLock: true,
    animation: [
      { clip: 'Idle_Combat', loop: 'repeat', speed: s.speed },
      { clip: 'Death_C_Skeletons', start: T_COLLAPSE[i], blendIn: 0.25, loop: 'once' },
    ],
  },
  position: [s.p[0], MINION_H / 2, s.p[2]], rotation: [0, s.yaw, 0], size: [1.6, MINION_H, 0.8],
}));

// ---- lighting ----
const rims = [
  { position: [0, 2.0, 0] as Vec3, color: LIGHT.WARM, intensity: 7, range: 8 },
  ...brazierPos.map((p) => ({ position: [p[0], 1.5, p[2]] as Vec3, color: LIGHT.WARM, intensity: 2.5, range: 5 })),
];
const lighting = LIGHT.altar(rims);
lighting.exposure = 1.25;

// ---- cameras ----
const hx = (t: number) => lerp(START[0], STAND[0], Math.min(1, Math.max(0, (t - T_WALK0) / (T_WALK1 - T_WALK0))));
const TOP = 0;
const shots: Shot[] = [
  {
    id: 's08-1-entrance', start: 0, end: 4.5,
    note: 'wide from inside the ring: Haon walks in through the arched entrance, screen left to right, ember in her left hand',
    camera: {
      position: [{ t: 0, v: [-2.6, 1.35, 5.8], ease: 'smooth' }, { t: 4.5, v: [-3.4, 1.35, 4.9] }],
      target: { track: [{ t: 0, v: [-5.6, 1.1, 0.2], ease: 'smooth' }, { t: 4.5, v: [-4.9, 1.15, 0.2] }] },
      fov: [{ t: 0, v: 56 }],
    },
  },
  {
    id: 's08-2-approach', start: 4.5, end: 11.5,
    note: 'follow: camera ahead of Haon and to her right, retreating; ember visible in front of her belly, altar behind',
    camera: {
      position: sample(4.5, 11.5, 0.5, (t) => [hx(t) + lerp(2.6, 2.2, (t - 4.5) / 7), 2.0, 5.6]),
      target: { follow: haon.j.hips, offset: [0.35, 0.25, 0] },
      fov: [{ t: 4.5, v: 40 }],
    },
  },
  {
    id: 's08-3-place', start: 11.5, end: 16.0,
    note: 'insert: close on the hands, the left hand lowers the ember into the bowl, hand withdraws, one step back',
    camera: {
      position: [{ t: 11.5, v: [1.5, 1.7, 1.9], ease: 'smooth' }, { t: 16.0, v: [1.2, 1.6, 1.7] }],
      target: { track: [{ t: 11.5, v: [-0.45, 1.2, 0.15], ease: 'smooth' }, { t: 14.0, v: [-0.4, 1.2, 0.15], ease: 'smooth' }, { t: 16.0, v: [-0.4, 1.2, 0.15] }] },
      fov: [{ t: 11.5, v: 40 }],
    },
  },
  {
    id: 's08-4-kneel', start: 16.0, end: 21.0,
    note: 'low angle: Haon kneels with head bowed, the ember grows and flares above the altar',
    camera: {
      position: [{ t: 16.0, v: [1.5, 0.5, 2.2], ease: 'smooth' }, { t: 21.0, v: [0.9, 0.45, 2.0] }],
      target: { track: [{ t: 16.0, v: [-0.55, 1.0, 0.2], ease: 'smooth' }, { t: 21.0, v: [-0.3, 1.25, 0.1] }] },
      fov: [{ t: 16.0, v: 52 }],
    },
  },
  {
    id: 's08-5-braziers', start: 21.0, end: 25.5,
    note: 'pan across the ring as the six braziers ignite one by one',
    camera: {
      position: [{ t: 21.0, v: [0.4, 2.6, 6.3], ease: 'smooth' }, { t: 25.5, v: [-0.6, 2.8, 6.0] }],
      target: { track: [
        { t: 21.0, v: [-2.6, 1.0, 1.0], ease: 'smooth' },
        { t: 22.8, v: [-2.2, 1.0, -1.6], ease: 'smooth' },
        { t: 23.9, v: [0.4, 1.0, -2.6], ease: 'smooth' },
        { t: 25.5, v: [2.6, 1.0, -0.2] },
      ] },
      fov: [{ t: 21.0, v: 48 }],
    },
  },
  {
    id: 's08-6-collapse', start: 25.5, end: 29.0,
    note: 'low from the glowing ring toward the dark edge: the skeletons sag and collapse into rest',
    camera: {
      position: [{ t: 25.5, v: [2.8, 1.0, 4.2], ease: 'smooth' }, { t: 29.0, v: [2.5, 0.9, 3.6] }],
      target: { track: [{ t: 25.5, v: [5.3, 0.8, -0.8], ease: 'smooth' }, { t: 29.0, v: [5.2, 0.4, -1.2] }] },
      fov: [{ t: 25.5, v: 44 }],
    },
  },
  {
    id: 's08-7-rise', start: 29.0, end: 33.0,
    note: 'profile medium: Haon rises and lifts her head to the flame, then turns toward the entrance',
    camera: {
      position: [{ t: 29.0, v: [-2.0, 1.4, 6.4], ease: 'smooth' }, { t: 33.0, v: [-2.1, 1.6, 6.2] }],
      target: { track: [{ t: 29.0, v: [-0.9, 0.9, 0.2], ease: 'smooth' }, { t: 31.0, v: [-0.6, 1.3, 0.2], ease: 'smooth' }, { t: 33.0, v: [-1.4, 1.25, 0.2] }] },
      fov: [{ t: 29.0, v: 30 }],
    },
  },
  {
    id: 's08-8-twoshot', start: 33.0, end: 38.0,
    note: 'two-shot from the +z side: the mentor walks in from the entrance, Haon turned to face him; they look at each other',
    camera: {
      position: [{ t: 33.0, v: [-3.9, 2.5, 6.0], ease: 'smooth' }, { t: 38.0, v: [-3.8, 2.6, 5.9] }],
      target: { track: [{ t: 33.0, v: [-4.2, 1.2, 0.2], ease: 'smooth' }, { t: 38.0, v: [-3.0, 1.2, 0.2] }] },
      fov: [{ t: 33.0, v: 50 }],
    },
  },
  {
    id: 's08-9-crane', start: 38.0, end: 45.0,
    note: 'smooth crane up from the two-shot to a near top-down over the lit altar ring (camera.up switch), holds the last 3 s',
    camera: {
      position: [
        { t: 38.0, v: [-3.8, 2.6, 5.9], ease: 'smooth' },
        { t: 39.6, v: [-2.6, 4.6, 5.6], ease: 'smooth' },
        { t: 41.0, v: [-0.8, 7.8, 2.4], ease: 'smooth' },
        { t: 42.0, v: add([TOP, 0, 0], [0, 7.8, 0.15]) },
      ],
      target: { track: [
        { t: 38.0, v: [-3.0, 1.2, 0.2], ease: 'smooth' },
        { t: 39.6, v: [-2.4, 0.9, 0.2], ease: 'smooth' },
        { t: 41.0, v: [-0.7, 0.2, 0.1], ease: 'ease-out' },
        { t: 42.0, v: [TOP, 0, 0] },
      ] },
      fov: [{ t: 38.0, v: 50, ease: 'ease-in-out' }, { t: 42.0, v: 58 }],
      up: [{ t: 39.8, v: [0, 1, 0], ease: 'ease-in-out' }, { t: 41.7, v: [0, 0, -1] }],
    },
  },
];

const doc: PrevisDoc = {
  version: 1,
  title: '불씨지기 S08 다시 타오르는 불',
  fps: FPS,
  size: SIZE,
  background: BG,
  worldScale: 10,
  avoidColors: AVOID,
  lighting,
  roles: ROLES,
  nodes: [...set, ...minions, ...haonNodes, haon.skin, ...mentorNodes, mentor.skin, heldEmber, emberBowl],
  shots,
  markers: [
    { t: T_WALK0, label: 'Haon walks in carrying the ember' },
    { t: T_PLACE, label: 'ember placed in the bowl' },
    { t: T_KNEEL1, label: 'Haon kneels, ember starts to grow' },
    { t: T_BRAZ0, label: 'first brazier ignites' },
    { t: T_COLLAPSE[0], label: 'skeletons collapse' },
    { t: T_RISE0, label: 'Haon rises' },
    { t: T_MENTOR0, label: 'mentor appears in the entrance' },
    { t: 38.0, label: 'crane up' },
    { t: 42.0, label: 'top-down hold' },
  ],
} as PrevisDoc;
writeDoc('s08-rekindled', doc, HERE);
