// S04 깨어나는 자들 (45 s). node --experimental-strip-types previs/examples/film/s04-waking.gen.ts
// Crypt corridor along +x (Haon's travel, screen left -> right with the camera on the +z side). Four Skeleton_Minion
// lie in the corridor ahead, awaken one after another, stand and patrol toward -x in a file along z = PATH_Z. Haon backs
// off, slips behind the far-row pillar PILLAR_HIDE (z = -3) and crouches against the far wall while they pass on the
// corridor side of that pillar, then rises and sneaks on toward +x.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, crouch, evaluateFrame, walk, worldTransform } from '../../../src/previs/index.ts';
import type { MotionFragments, PrevisDoc, PrevisMarker, PrevisNode, Rgb, Shot, Vec3 } from '../../../src/previs/index.ts';
import { AVOID, BG, C, EMBER_D, FPS, LIGHT, LOOK, MINION_H, PILLAR_FLAT, ROLES, SIZE, SRC, STONE, STONE_LIGHT, add, character, flatOnly, lerp, r4, sample, writeDoc, yawTo } from './common.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUR = 45;
const FACE_X = Math.PI / 2; // facing +x

// ---- set layout (meters) ----
const ROW_Z = 3; // pillar rows at z = +-3 (pillar 1.5 x 4 x 1.5)
const PILLAR_XS = [-12.5, -7.5, -2.5, 2.5, 7.5, 12.5]; // 3.5 m gaps: cameras sit on the near row line between pillars
const WALL_Z = 6; // wall centre (1 m thick): faces at +-5.5
const PATH_Z = -0.95; // skeleton patrol line (far pillar front face at z = -2.25)
const HIDE_PILLAR_X = -7.5; // far-row pillar Haon hides behind

// ---- Haon timeline ----
const H0: Vec3 = [-12.8, 0, -0.6];
const H_STOP: Vec3 = [-5.0, 0, -0.6];
const H_BACK: Vec3 = [-6.0, 0, -0.6];
const H_TURN: Vec3 = [-6.15, 0, -4.3];
const H_HIDE: Vec3 = [-8.0, 0, -4.45]; // behind the far-row pillar x = -7.5 (its -x half), against the far wall
const H_OUT1: Vec3 = [-6.3, 0, -4.35];
const H_OUT2: Vec3 = [-5.5, 0, -1.3];
const H_END: Vec3 = [-1.3, 0, -0.7];
const T_IN = [0, 7.0] as const;
const T_BACK = [10.0, 11.4] as const;
const T_RUN1 = [11.4, 13.4] as const;
const T_RUN2 = [13.4, 14.4] as const;
const T_CROUCH = [14.6, 15.5] as const;
const CROUCH_D = 0.56;
const T_RISE = [32.0, 33.3] as const;
const T_OUT1 = [33.5, 35.6] as const;
const T_OUT2 = [35.6, 39.4] as const;
const T_OUT3 = [39.4, 45.0] as const;

// ---- skeletons: lying spot (= standing spot), lying yaw, awaken clip / start, join point on the patrol line,
// time it passes Haon's hiding x (walk start solved from it) ----
const WALK_CLIP_SPEED = 1.45; // Walking_D_Skeletons: ~0.58 m/s at speed 1 (planted-foot sweep, contain fit 0.806), so ~0.84 m/s
const SK_V = 0.84;
type Awaken = 'Skeletons_Awaken_Floor_Long' | 'Skeletons_Awaken_Floor';
type Sk = { id: string; p: Vec3; yaw: number; awaken: Awaken; tA: number; join: Vec3; pass: number; tW: number };
const AWAKE_LEN: Record<Awaken, number> = { Skeletons_Awaken_Floor_Long: 3.833, Skeletons_Awaken_Floor: 2.3 };
const SK_DEF: Omit<Sk, 'tW' | 'join'>[] = [
  { id: 'sk1', p: [-1.5, 0, -1.1], yaw: -Math.PI / 2, awaken: 'Skeletons_Awaken_Floor_Long', tA: 6.5, pass: 21.0 },
  { id: 'sk2', p: [0.4, 0, 0.5], yaw: -Math.PI / 2 - 0.35, awaken: 'Skeletons_Awaken_Floor', tA: 7.8, pass: 23.5 },
  { id: 'sk3', p: [2.2, 0, -1.4], yaw: -Math.PI / 2 + 0.3, awaken: 'Skeletons_Awaken_Floor', tA: 11.2, pass: 26.0 },
  { id: 'sk4', p: [4.2, 0, 0.4], yaw: -Math.PI / 2 - 0.2, awaken: 'Skeletons_Awaken_Floor_Long', tA: 10.4, pass: 29.3 },
];
const SKS: Sk[] = SK_DEF.map((s) => {
  const join: Vec3 = [s.p[0] - 1.2, 0, PATH_Z];
  const dist = Math.hypot(join[0] - s.p[0], join[2] - s.p[2]) + (join[0] - HIDE_PILLAR_X); // `pass` = at the hiding pillar's centre x
  const tW = r4(s.pass - dist / SK_V);
  const up = s.tA + AWAKE_LEN[s.awaken];
  if (tW < up + 0.3) throw new Error(`${s.id} walks at ${tW} before it stands (${up})`);
  return { ...s, join, tW };
});
const SK_END_X = -17; // they walk off into the dark (then hidden)

// ---- Haon ----
const haon = character('haon', H0, FACE_X);
const j = haon.j;
const walks: MotionFragments[] = [
  walk({ joints: j, from: H0, to: H_STOP, start: T_IN[0], end: T_IN[1], stepsPerSecond: 1.6 }),
  walk({ joints: j, from: H_STOP, to: H_BACK, start: T_BACK[0], end: T_BACK[1], stepsPerSecond: 2.0 }),
  walk({ joints: j, from: H_BACK, to: H_TURN, start: T_RUN1[0], end: T_RUN1[1], stepsPerSecond: 3.0 }),
  walk({ joints: j, from: H_TURN, to: H_HIDE, start: T_RUN2[0], end: T_RUN2[1], stepsPerSecond: 2.4 }),
  walk({ joints: j, from: H_HIDE, to: H_OUT1, start: T_OUT1[0], end: T_OUT1[1], stepsPerSecond: 1.2 }),
  walk({ joints: j, from: H_OUT1, to: H_OUT2, start: T_OUT2[0], end: T_OUT2[1], stepsPerSecond: 1.1 }),
  walk({ joints: j, from: H_OUT2, to: H_END, start: T_OUT3[0], end: T_OUT3[1], stepsPerSecond: 1.1 }),
];
for (const w of walks) {
  delete w[j.shoulderL!]; // left arm holds the ember (carry pose)
  delete w[j.root].rotation; // yaw authored below
}
walks[0][j.root].position![0].ease = 'ease-out';
walks[1][j.root].position![0].ease = 'ease-in-out';
const yIn = FACE_X;
const yRun1 = yawTo(H_BACK, H_TURN);
const yRun2 = yawTo(H_TURN, H_HIDE);
const yOut1 = yawTo(H_HIDE, H_OUT1);
const yOut2 = yawTo(H_OUT1, H_OUT2);
const yOut3 = yawTo(H_OUT2, H_END);
// carry pose: forearm forward-up, ember in front of the belly; hugged closer while hiding
const CARRY: Vec3 = [-0.5, 0, 0];
const CARRY_E: Vec3 = [-1.1, 0, 0];
const HUG: Vec3 = [-0.3, 0, 0];
const HUG_E: Vec3 = [-2.3, 0, 0];
const motion: MotionFragments[] = [
  ...walks,
  crouch({ mannequin: haon.m, start: T_CROUCH[0], end: T_CROUCH[1], depth: CROUCH_D, fps: FPS }),
  crouch({ mannequin: haon.m, start: T_RISE[0], end: T_RISE[1], from: CROUCH_D, depth: 0, fps: FPS }),
  {
    [j.root]: {
      rotation: [
        { t: 0, v: [0, yIn, 0] },
        { t: T_RUN1[0] - 0.1, v: [0, yIn, 0], ease: 'ease-in-out' },
        { t: T_RUN1[0] + 0.3, v: [0, yRun1, 0] },
        { t: T_RUN2[0] - 0.15, v: [0, yRun1, 0], ease: 'ease-in-out' },
        { t: T_RUN2[0] + 0.2, v: [0, yRun2, 0] },
        { t: T_RUN2[1], v: [0, yRun2, 0], ease: 'ease-in-out' },
        { t: T_CROUCH[0] + 0.2, v: [0, 0, 0] }, // faces the pillar (+z), back to the wall
        { t: T_RISE[1], v: [0, 0, 0], ease: 'ease-in-out' },
        { t: T_OUT1[0] + 0.25, v: [0, yOut1, 0] },
        { t: T_OUT2[0] - 0.15, v: [0, yOut1, 0], ease: 'ease-in-out' },
        { t: T_OUT2[0] + 0.3, v: [0, yOut2, 0] },
        { t: T_OUT3[0] - 0.2, v: [0, yOut2, 0], ease: 'ease-in-out' },
        { t: T_OUT3[0] + 0.4, v: [0, yOut3, 0] },
      ],
    },
    [j.shoulderL!]: {
      rotation: [
        { t: 0, v: CARRY }, { t: T_CROUCH[0], v: CARRY, ease: 'ease-in-out' }, { t: T_CROUCH[1], v: HUG },
        { t: T_RISE[0], v: HUG, ease: 'ease-in-out' }, { t: T_RISE[1], v: CARRY },
      ],
    },
    [j.elbowL!]: {
      rotation: [
        { t: 0, v: CARRY_E }, { t: T_CROUCH[0], v: CARRY_E, ease: 'ease-in-out' }, { t: T_CROUCH[1], v: HUG_E },
        { t: T_RISE[0], v: HUG_E, ease: 'ease-in-out' }, { t: T_RISE[1], v: CARRY_E },
      ],
    },
    // spine lean: cautious walk, recoil, hurried run, hunched hiding, sneaking
    [j.spine]: {
      rotation: [
        { t: 0, v: [0.06, 0, 0] },
        { t: 7.6, v: [0.06, 0, 0], ease: 'ease-out' },
        { t: 8.0, v: [-0.12, 0, 0] },
        { t: T_RUN1[0], v: [-0.08, 0, 0], ease: 'ease-in-out' },
        { t: T_RUN1[0] + 0.4, v: [0.3, 0, 0] },
        { t: T_RUN2[1], v: [0.25, 0, 0], ease: 'ease-in-out' },
        { t: T_CROUCH[1], v: [0.2, 0, 0] },
        { t: T_RISE[0], v: [0.2, 0, 0], ease: 'ease-in-out' },
        { t: T_RISE[1], v: [0.18, 0, 0] },
      ],
    },
    // head: glances while entering, fixes on the stirring skeleton, peeks toward each skeleton as it passes the pillar
    [j.head]: {
      rotation: [
        { t: 0, v: [0, 0, 0] },
        { t: 1.6, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 2.6, v: [0, 0.45, 0], ease: 'ease-in-out' },
        { t: 3.8, v: [0, 0.45, 0], ease: 'ease-in-out' },
        { t: 4.8, v: [0, -0.3, 0], ease: 'ease-in-out' },
        { t: 6.0, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 7.0, v: [0.22, 0, 0], ease: 'ease-in-out' },
        { t: 8.6, v: [0.05, 0, 0], ease: 'ease-in-out' },
        { t: 9.6, v: [0.05, 0.25, 0], ease: 'ease-in-out' },
        { t: 10.6, v: [0.05, -0.2, 0], ease: 'ease-in-out' },
        { t: T_RUN1[0], v: [0, 0, 0] },
        { t: 17.5, v: [0, 0, 0], ease: 'ease-in-out' },
        { t: 19.0, v: [0, 0.9, 0], ease: 'ease-in-out' }, // toward +x: the file approaching
        { t: 20.3, v: [0, 0.85, 0], ease: 'ease-in-out' },
        { t: 22.0, v: [-0.05, -0.5, 0], ease: 'ease-in-out' },
        { t: 22.7, v: [0, 0.6, 0], ease: 'ease-in-out' },
        { t: 24.5, v: [-0.05, -0.5, 0], ease: 'ease-in-out' },
        { t: 25.2, v: [0, 0.6, 0], ease: 'ease-in-out' },
        { t: 27.0, v: [-0.05, -0.5, 0], ease: 'ease-in-out' },
        { t: 27.7, v: [0, 0.6, 0], ease: 'ease-in-out' },
        { t: 30.2, v: [0, -0.9, 0], ease: 'ease-in-out' }, // watches the last one walk away (-x)
        { t: 31.4, v: [0, -0.9, 0], ease: 'ease-in-out' },
        { t: 32.3, v: [0, 0.3, 0], ease: 'ease-in-out' },
        { t: 33.3, v: [0.1, 0, 0], ease: 'ease-in-out' },
        { t: 37.0, v: [0.1, -0.35, 0], ease: 'ease-in-out' },
        { t: 38.4, v: [0.1, 0, 0] },
      ],
    },
  },
];
const hn = flatOnly(applyMotion(haon.m.nodes, motion));
const ember: PrevisNode = {
  id: 'ember', shape: 'sphere', role: 'ember', color: C.ember, look: LOOK.ember, parent: j.handL,
  position: [0, -0.06, 0.04], rotation: [0, 0, 0], size: [EMBER_D, EMBER_D, EMBER_D],
};

// ---- skeletons (both passes) ----
const skT1 = (s: Sk) => r4(s.tW + Math.hypot(s.join[0] - s.p[0], s.join[2] - s.p[2]) / SK_V);
const skPos = (s: Sk, t: number): Vec3 => {
  const t1 = skT1(s);
  if (t <= s.tW) return s.p;
  if (t <= t1) return [lerp(s.p[0], s.join[0], (t - s.tW) / (t1 - s.tW)), 0, lerp(s.p[2], s.join[2], (t - s.tW) / (t1 - s.tW))];
  return [s.join[0] - (t - t1) * SK_V, 0, PATH_Z];
};
const skNodes: PrevisNode[] = SKS.map((s) => {
  const t1 = skT1(s);
  const tEnd = r4(t1 + (s.join[0] - SK_END_X) / SK_V);
  const yJoin = yawTo(s.p, s.join);
  const yPath = -Math.PI / 2;
  const tUp = s.tA + AWAKE_LEN[s.awaken];
  const Y = MINION_H / 2;
  return {
    id: s.id, shape: 'model', role: 'skeleton', color: C.skeleton,
    model: {
      src: SRC.minion, fit: 'contain', groundLock: true,
      animation: [
        { clip: 'Skeletons_Inactive_Floor_Pose' },
        { clip: s.awaken, start: s.tA, loop: 'once' },
        { clip: 'Idle_Combat', start: r4(tUp - 0.25), blendIn: 0.25, loop: 'repeat' },
        { clip: 'Walking_D_Skeletons', start: s.tW, blendIn: 0.35, speed: WALK_CLIP_SPEED, loop: 'repeat' },
      ],
    },
    position: [s.p[0], Y, s.p[2]], rotation: [0, s.yaw, 0], size: [1.6, MINION_H, 0.8], rotationPath: 'shortest',
    tracks: {
      position: [
        { t: s.tW, v: [s.p[0], Y, s.p[2]], ease: 'ease-in' },
        { t: t1, v: [s.join[0], Y, s.join[2]] },
        { t: tEnd, v: [SK_END_X, Y, PATH_Z] },
      ],
      rotation: [
        { t: s.tW - 0.4, v: [0, s.yaw, 0], ease: 'ease-in-out' },
        { t: s.tW + 0.3, v: [0, yJoin, 0] },
        { t: t1 - 0.3, v: [0, yJoin, 0], ease: 'ease-in-out' },
        { t: t1 + 0.4, v: [0, yPath, 0] },
      ],
      visible: [{ t: 0, v: true }, { t: tEnd, v: false }],
    },
  };
});

// ---- set ----
const box = (id: string, color: Rgb, pos: Vec3, size: Vec3, look = LOOK.wall): PrevisNode => ({
  id, shape: 'box', color, look, position: pos, rotation: [0, 0, 0], size,
});
const pillar = (id: string, x: number, z: number): PrevisNode => ({
  id, shape: 'model', color: PILLAR_FLAT, model: { src: SRC.pillar, fit: 'contain' }, position: [x, 2, z], rotation: [0, 0, 0], size: [1.5, 4, 1.5],
});
const set: PrevisNode[] = [
  box('floor', STONE, [-3, -0.25, 0], [46, 0.5, 13], LOOK.floor),
  box('wall_far', STONE_LIGHT, [-3, 3.5, -WALL_Z], [46, 7, 1]),
  box('wall_near', STONE_LIGHT, [-3, 3.5, WALL_Z], [46, 7, 1]),
];
for (const x of PILLAR_XS) {
  set.push(pillar(`pillar_f${x}`, x, -ROW_Z));
  set.push(pillar(`pillar_n${x}`, x, ROW_Z));
}

// ---- lighting: cold crypt, cold rims along the corridor, one faint warm rim (the ember) at the hiding spot ----
const COLD = LIGHT.COLD;
const lighting: PrevisDoc['lighting'] = {
  ...LIGHT.crypt([
    { position: [-11, 3.4, 0], color: COLD, intensity: 5, range: 9 },
    { position: [-5, 3.4, 0], color: COLD, intensity: 5, range: 9 },
    { position: [1, 3.4, 0], color: COLD, intensity: 5, range: 9 },
    { position: [7, 3.4, 0], color: COLD, intensity: 4, range: 9 },
    { position: [-5.6, 1.6, -1.4], color: COLD, intensity: 2, range: 4 },
    { position: [-7.95, 0.85, -4.85], color: LIGHT.WARM, intensity: 0.35, range: 1.8 },
  ]),
  key: { dir: [-0.35, 0.9, 0.3], intensity: 0.8, shadows: true },
  env: { sky: [0.4, 0.45, 0.6], ground: [0.16, 0.16, 0.2], intensity: 0.7 },
  exposure: 1.55,
};

// ---- probe: Haon world position for camera tracks ----
const probe: PrevisDoc = {
  version: 1, fps: FPS, size: SIZE, background: BG, roles: ROLES, nodes: [...hn, haon.skin],
  shots: [{ id: 'p', start: 0, end: DUR, camera: { position: [{ t: 0, v: [0, 2, 8] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
};
const wt = (id: string, t: number) => worldTransform(probe, evaluateFrame(probe, t).nodes, id);
const haonAt = (t: number): Vec3 => wt(j.root, t).position;
console.log('ember hand: walking', wt(j.handL!, 3).position.map((v) => +v.toFixed(2)), 'hiding', wt(j.handL!, 20).position.map((v) => +v.toFixed(2)));

// ---- self-checks: skeletons vs pillars, Haon, each other; Haon vs pillars ----
{
  type W = { d: number; t: number; id: string };
  let worstP: W = { d: Infinity, t: 0, id: '' };
  let worstH: W = { d: Infinity, t: 0, id: '' };
  let worstS: W = { d: Infinity, t: 0, id: '' };
  let worstHP: W = { d: Infinity, t: 0, id: '' };
  const toPillar = (p: Vec3) => {
    let best = Infinity;
    for (const x of PILLAR_XS) for (const z of [-ROW_Z, ROW_Z]) {
      best = Math.min(best, Math.hypot(Math.max(0, Math.abs(p[0] - x) - 0.75), Math.max(0, Math.abs(p[2] - z) - 0.75)));
    }
    return best;
  };
  for (let k = 0; k <= DUR * FPS; k++) {
    const t = k / FPS;
    const h = haonAt(t);
    const dHP = toPillar(h);
    if (dHP < worstHP.d) worstHP = { d: dHP, t, id: 'haon' };
    const ps = SKS.map((s) => skPos(s, t));
    ps.forEach((p, i) => {
      if (p[0] < -14) return;
      const d = toPillar(p);
      if (d < worstP.d) worstP = { d, t, id: SKS[i].id };
      const dh = Math.hypot(p[0] - h[0], p[2] - h[2]);
      if (dh < worstH.d) worstH = { d: dh, t, id: SKS[i].id };
      ps.forEach((q, m) => {
        if (m <= i) return;
        const dd = Math.hypot(p[0] - q[0], p[2] - q[2]);
        if (dd < worstS.d) worstS = { d: dd, t, id: `${SKS[i].id}-${SKS[m].id}` };
      });
    });
  }
  const f = (o: W) => `${o.id} ${o.d.toFixed(2)} m @ ${o.t.toFixed(2)} s`;
  console.log('closest (centre to footprint / centre to centre): skeleton-pillar', f(worstP), '| skeleton-haon', f(worstH), '| skeleton-skeleton', f(worstS), '| haon-pillar', f(worstHP));
  if (worstP.d < 0.6 || worstH.d < 1.5 || worstS.d < 1.3 || worstHP.d < 0.25) throw new Error('collision');
  for (const s of SKS) console.log(s.id, 'stands', r4(s.tA + AWAKE_LEN[s.awaken]), 'walks', s.tW, 'on path', skT1(s), 'passes', s.pass);
}

// ---- cameras ----
const sk = (i: number, t: number, y = 0): Vec3 => add(skPos(SKS[i], t), [0, y, 0]);
const hAt = (t: number, y = 0): Vec3 => add(haonAt(t), [0, y, 0]);
const S1 = SKS[0].p;
const shots: Shot[] = [
  {
    id: 's04-1-corridor', note: 'wide establishing down the pillared crypt corridor in cold blue light, skeletons lying ahead; Haon enters frame left with the ember and walks in (left to right, into depth)', start: 0, end: 6.5,
    camera: {
      position: [{ t: 0, v: [-14.2, 3.0, 2.1], ease: 'smooth' }, { t: 6.5, v: [-12.9, 2.6, 2.0] }],
      target: { track: [{ t: 0, v: [-5.0, 0.6, -1.4], ease: 'smooth' }, { t: 6.5, v: [-3.0, 0.7, -1.2] }] },
      fov: [{ t: 0, v: 56 }],
    },
  },
  {
    id: 's04-2-sockets', note: 'insert, low on the floor: the nearest skull; its eye sockets wake, it lifts and the skeleton sits up and rises', start: 6.5, end: 9.0,
    camera: {
      position: [{ t: 6.5, v: add(S1, [1.6, 0.45, 1.9]), ease: 'smooth' }, { t: 9.0, v: add(S1, [1.3, 0.7, 2.2]) }],
      target: { track: [
        { t: 6.5, v: add(S1, [0.6, 0.3, 0]), ease: 'smooth' }, { t: 7.3, v: add(S1, [0.6, 0.3, 0]), ease: 'smooth' },
        { t: 8.0, v: add(S1, [0.1, 0.8, 0]), ease: 'smooth' }, { t: 9.0, v: add(S1, [0, 1.2, 0]) },
      ] },
      fov: [{ t: 6.5, v: 36 }],
    },
  },
  {
    id: 's04-3-reaction', note: 'medium three-quarter front on Haon: she freezes, ember at her belly, then backs off', start: 9.0, end: 11.5,
    camera: {
      position: [{ t: 9.0, v: [-3.2, 1.5, 0.15], ease: 'smooth' }, { t: 11.5, v: [-3.9, 1.45, 0.3] }],
      target: { track: sample(9.0, 11.5, 0.5, (t) => hAt(t, 1.3)) },
      fov: [{ t: 9.0, v: 40 }],
      shake: { amp: 0.01, freq: 2, roll: 0.004, seed: 41 },
    },
  },
  {
    id: 's04-4-rising', note: 'low wide from the floor: the skeletons rise one after another, Combat idle, facing the camera / Haon', start: 11.5, end: 15.0,
    camera: {
      position: [{ t: 11.5, v: [-4.6, 0.35, 1.4], ease: 'smooth' }, { t: 15.0, v: [-4.2, 0.4, 1.3] }],
      target: { track: [{ t: 11.5, v: [1.5, 1.0, -0.4], ease: 'smooth' }, { t: 15.0, v: [1.0, 1.2, -0.5] }] },
      fov: [{ t: 11.5, v: 50 }],
      shake: { amp: 0.015, freq: 2.5, roll: 0.006, seed: 42 },
    },
  },
  {
    id: 's04-5-patrol', note: 'tracking dolly alongside the patrol: the skeleton file walks screen right to left toward the pillars', start: 15.0, end: 19.5,
    camera: {
      position: sample(15.0, 19.5, 0.5, (t) => [sk(1, t)[0] - 1.0, 1.25, 1.95]),
      target: { track: sample(15.0, 19.5, 0.5, (t) => [sk(1, t)[0] - 0.6, 0.9, PATH_Z]) },
      fov: [{ t: 15.0, v: 60 }],
    },
  },
  {
    id: 's04-6-hiding', note: 'close, low handheld from the corridor: Haon crouched behind the pillar against the wall, ember hugged, peeking; skeleton legs pass in the foreground', start: 19.5, end: 24.5,
    camera: {
      position: [{ t: 19.5, v: [-9.8, 0.45, 0.3], ease: 'smooth' }, { t: 24.5, v: [-9.95, 0.45, 0.35] }],
      target: { track: [{ t: 19.5, v: [-7.9, 0.75, -4.0], ease: 'smooth' }, { t: 24.5, v: [-7.95, 0.75, -4.0] }] },
      fov: [{ t: 19.5, v: 36 }],
      shake: { amp: 0.018, freq: 2.2, roll: 0.008, seed: 43 },
    },
  },
  {
    id: 's04-7-high', note: 'high angle over the corridor: the pillar between Haon (crouched at the wall) and the skeleton file walking past and away', start: 24.5, end: 30.5,
    camera: {
      position: [{ t: 24.5, v: [-7.3, 9.0, -3.5], ease: 'smooth' }, { t: 30.5, v: [-7.9, 9.3, -3.55] }],
      target: { track: [{ t: 24.5, v: [-7.4, 0.3, -2.9], ease: 'smooth' }, { t: 30.5, v: [-8.0, 0.3, -2.95] }] },
      fov: [{ t: 24.5, v: 46 }],
      // looking almost straight down: screen-up = -z (wall / Haon at the top, the corridor below), screen-right = +x
      up: [{ t: 24.5, v: [0, 0, -1] }],
    },
  },
  {
    id: 's04-8-peek', note: 'close on Haon at the wall, low handheld: she turns her head after the skeletons walking away, exhales, rises', start: 30.5, end: 33.5,
    camera: {
      position: [{ t: 30.5, v: [-9.3, 0.8, -3.85], ease: 'smooth' }, { t: 33.5, v: [-9.35, 1.15, -3.9] }],
      target: { track: [{ t: 30.5, v: [-7.95, 0.9, -4.3], ease: 'smooth' }, { t: 33.5, v: [-7.9, 1.45, -4.3] }] },
      fov: [{ t: 30.5, v: 42 }],
      shake: { amp: 0.012, freq: 2, roll: 0.006, seed: 44 },
    },
  },
  {
    id: 's04-9-release', note: 'medium from the corridor: she slips out from behind the pillar and sneaks back toward the corridor with slow careful steps', start: 33.5, end: 39.0,
    camera: {
      position: [{ t: 33.5, v: [-4.2, 1.35, 0.9], ease: 'smooth' }, { t: 39.0, v: [-4.0, 1.3, 1.1] }],
      target: { track: sample(33.5, 39.0, 0.5, (t) => hAt(t, 1.0)) },
      fov: [{ t: 33.5, v: 46 }],
    },
  },
  {
    id: 's04-10-onward', note: 'wide release from between the near pillars: Haon sneaks on along the emptied corridor, screen left to right, and exits frame right; cold tone', start: 39.0, end: DUR,
    camera: {
      position: [{ t: 39.0, v: [-5.4, 1.9, 3.0], ease: 'smooth' }, { t: DUR, v: [-5.0, 1.85, 3.0] }],
      target: { track: [{ t: 39.0, v: [-6.0, 0.9, -1.5], ease: 'smooth' }, { t: DUR, v: [-5.6, 0.9, -1.5] }] },
      fov: [{ t: 39.0, v: 58 }],
    },
  },
];

const markers: PrevisMarker[] = [
  { t: 0.5, label: 'Haon enters the cold crypt corridor, ember in her left hand' },
  { t: SKS[0].tA, label: 'first skeleton stirs: its eye sockets wake' },
  { t: T_IN[1], label: 'Haon freezes' },
  ...SKS.slice(1).map((s) => ({ t: s.tA, label: `${s.id} awakens and rises` })),
  { t: T_BACK[0], label: 'Haon backs off' },
  { t: T_RUN1[0], label: 'Haon turns and hurries behind the pillar' },
  { t: T_CROUCH[0], label: 'Haon crouches behind the pillar against the wall' },
  { t: Math.min(...SKS.map((s) => s.tW)), label: 'the skeletons start their patrol toward the pillars' },
  ...SKS.map((s) => ({ t: s.pass, label: `${s.id} walks past the hiding pillar` })),
  { t: T_RISE[0], label: 'Haon rises' },
  { t: T_OUT1[0], label: 'Haon sneaks out and on, slow careful steps' },
  { t: 44.0, label: 'Haon exits frame right' },
].sort((a, b) => a.t - b.t);

const doc: PrevisDoc = {
  version: 1, title: '불씨지기 S04 깨어나는 자들', fps: FPS, size: SIZE, background: BG, worldScale: 10, avoidColors: AVOID,
  lighting, roles: ROLES,
  nodes: [...set, ...hn, haon.skin, ember, ...skNodes],
  shots, markers,
};
writeDoc('s04-waking', doc, HERE);
