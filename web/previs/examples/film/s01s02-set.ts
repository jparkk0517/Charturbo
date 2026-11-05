// Shared set of S01 (s01-hall) and S02 (s02-dimming): the keeper's hall. Both scenes import this module so the
// layout, the skeletons, the pedestal / ember and the lighting match exactly across the cut.
//
// Hall axis = world x: entrance (open, dark) at x = -12, sealed gate (KayKit wall_gated) at x = +12. The aisle runs
// along z = 0; two rows of KayKit pillars at z = +-3; skeletons sleep in the bays between the pillars; the stone
// pedestal with the ember stands mid-hall at the origin. Cameras stay on the +z side of the action (screen left ->
// right = +x = toward the gate).
import type { PrevisDoc, PrevisNode, Rgb, Vec3 } from '../../../src/previs/index.ts';
import { C, LIGHT, LOOK, MINION_H, PILLAR_FLAT, SRC, STONE, STONE_LIGHT } from './common.ts';

// ---- layout (meters) ----
export const HALL_X0 = -12; // entrance end
export const HALL_X1 = 12; // gate end
export const WALL_Z = 6; // side wall centre lines (inner face at 5.5)
export const PILLAR_Z = 3;
export const PILLAR_XS = [-10, -6, -2, 2, 6, 10];
export const PED: Vec3 = [0, 0, 0]; // pedestal base centre
export const PED_TOP = 1.0;
export const EMBER_PED_D = 0.24; // ember on the pedestal, alive (S01)
export const EMBER_LOW_D = 0.15; // dimmed (S02 before the pickup)
export const emberOnPed = (d: number): Vec3 => [PED[0], PED_TOP + d / 2, PED[2]];
export const GATE: Vec3 = [HALL_X1, 0, 0];

// ---- characters at the S01 -> S02 cut ----
// 도원 stands on the entrance side of the pedestal facing the gate; 하온 ends on the far side facing him, so her LEFT
// hand is on the camera side (+z) when she picks the ember up in S02.
export const MENTOR_POS: Vec3 = [-0.82, 0, -0.18];
export const HAON_END: Vec3 = [0.5, 0, 0.14];
export const HAON_END_YAW = Math.atan2(MENTOR_POS[0] - HAON_END[0], MENTOR_POS[2] - HAON_END[2]);
export const MENTOR_YAW = Math.atan2(HAON_END[0] - MENTOR_POS[0], HAON_END[2] - MENTOR_POS[2]);

// ---- skeletons: Skeleton_Minion asleep in the bays between the pillars ----
// Texture budget: with the two Quaternius skins at 2048² only 7 KayKit model nodes fit (each loads its own 1024^2
// texture), so the set is primitives and the KayKit models are the gate + these 6 sleepers. (Since the skins were
// downscaled to 1024², 37 KayKit nodes fit next to them: docs/previs/guide.md "Texture memory".)
// Lie_Pose / Skeletons_Inactive_Floor_Pose at yaw 0 lie along z with the skull at about -0.95 m local z (toward the
// aisle for the +z row); the -z row is turned by ~pi so its skulls face the aisle too.
export type Sleeper = { id: string; pos: Vec3; yaw: number; clip: string };
export const SLEEPERS: Sleeper[] = [
  // camera side (+z)
  { id: 'sk_n1', pos: [-8.1, MINION_H / 2, 3.0], yaw: -0.2, clip: 'Lie_Pose' },
  { id: 'sk_n2', pos: [-4.0, MINION_H / 2, 2.9], yaw: 0, clip: 'Lie_Pose' }, // S01: 하온 crouches here
  { id: 'sk_n3', pos: [4.1, MINION_H / 2, 3.0], yaw: 0.3, clip: 'Skeletons_Inactive_Floor_Pose' },
  // far side (-z)
  { id: 'sk_f1', pos: [-7.9, MINION_H / 2, -3.0], yaw: Math.PI + 0.15, clip: 'Skeletons_Inactive_Floor_Pose' },
  { id: 'sk_f2', pos: [0.6, MINION_H / 2, -2.9], yaw: Math.PI - 0.1, clip: 'Lie_Pose' }, // S02: stirs
  { id: 'sk_f3', pos: [8.0, MINION_H / 2, -3.0], yaw: Math.PI + 0.25, clip: 'Lie_Pose' },
];
export const sleeper = (id: string) => SLEEPERS.find((s) => s.id === id)!;

// ---- braziers (hall light sources, role altar) ----
export const BRAZIERS: Vec3[] = [
  // in front of the entrance-side and gate-side pillars, clear of the aisle and of the camera lanes mid-hall
  [-10, 0, 1.95],
  [-10, 0, -1.95],
  [6, 0, 1.95],
  [6, 0, -1.95],
];
const FLAME_Y = 1.12;

// ---- builders ----
const prim = (id: string, shape: PrevisNode['shape'], color: Rgb, position: Vec3, size: Vec3, look: PrevisNode['look'], role?: string, rotation: Vec3 = [0, 0, 0]): PrevisNode => {
  const n: PrevisNode = { id, shape, color, position, rotation, size, look };
  if (role) n.role = role;
  return n;
};
const kmodel = (id: string, src: string, position: Vec3, size: Vec3, yaw = 0, role?: string): PrevisNode => {
  const n: PrevisNode = { id, shape: 'model', color: role ? C[role as keyof typeof C] : STONE_LIGHT, model: { src, fit: 'contain' }, position, rotation: [0, yaw, 0], size };
  if (role) n.role = role;
  return n;
};

/** Floor, walls, pillars, gate, pedestal, braziers (static set, no tracks). */
export function hallSet(): PrevisNode[] {
  const out: PrevisNode[] = [];
  const L = HALL_X1 - HALL_X0;
  // floor: one slab (top at y = 0) reaching past the entrance into the dark
  out.push(prim('floor', 'box', STONE, [-1, -0.25, 0], [L + 6, 0.5, 2 * WALL_Z + 1], LOOK.floor));
  // aisle runner: slightly darker flagstones along the aisle (5 mm proud of the floor)
  out.push(prim('aisle', 'box', STONE, [0, -0.005, 0], [L, 0.02, 1.9], LOOK.darkStone));
  // side walls, 4.5 m high
  out.push(prim('wallN', 'box', STONE_LIGHT, [0, 2.25, WALL_Z], [L + 1, 4.5, 1], LOOK.wall));
  out.push(prim('wallS', 'box', STONE_LIGHT, [0, 2.25, -WALL_Z], [L + 1, 4.5, 1], LOOK.wall));
  // entrance end: two wall blocks, open in the middle (darkness beyond)
  out.push(prim('wallE_n', 'box', STONE_LIGHT, [HALL_X0, 2.25, 4], [1, 4.5, 4], LOOK.wall));
  out.push(prim('wallE_s', 'box', STONE_LIGHT, [HALL_X0, 2.25, -4], [1, 4.5, 4], LOOK.wall));
  out.push(prim('wallE_lintel', 'box', STONE_LIGHT, [HALL_X0, 3.6, 0], [1, 1.8, 4], LOOK.wall));
  // gate end: the sealed gate (KayKit wall_gated, 4 x 4 x 1) between two wall blocks + a lintel above
  out.push(prim('wallG_n', 'box', STONE_LIGHT, [HALL_X1, 2.25, 4], [1, 4.5, 4], LOOK.wall));
  out.push(prim('wallG_s', 'box', STONE_LIGHT, [HALL_X1, 2.25, -4], [1, 4.5, 4], LOOK.wall));
  out.push(prim('wallG_top', 'box', STONE_LIGHT, [HALL_X1, 4.25, 0], [1, 0.5, 4], LOOK.wall));
  out.push(kmodel('gate', SRC.wallGated, [HALL_X1, 2, 0], [4, 4, 1], -Math.PI / 2, 'gate'));
  // pillars: square base + round shaft + square cap, 4.5 m to the top
  for (const x of PILLAR_XS) {
    for (const s of [1, -1]) {
      const id = `pil_${s > 0 ? 'n' : 's'}${x}`;
      const z = s * PILLAR_Z;
      out.push(prim(`${id}_base`, 'box', PILLAR_FLAT, [x, 0.2, z], [1.3, 0.4, 1.3], LOOK.pillar));
      out.push(prim(`${id}_shaft`, 'cylinder', PILLAR_FLAT, [x, 2.2, z], [0.9, 3.6, 0.9], LOOK.pillar));
      out.push(prim(`${id}_cap`, 'box', PILLAR_FLAT, [x, 4.2, z], [1.3, 0.6, 1.3], LOOK.pillar));
    }
  }
  // pedestal (role altar): base slab, column, cap; top at PED_TOP
  out.push(prim('ped_base', 'box', C.altar, [PED[0], 0.06, PED[2]], [0.72, 0.12, 0.72], LOOK.darkStone, 'altar'));
  out.push(prim('ped_col', 'cylinder', C.altar, [PED[0], 0.12 + 0.39, PED[2]], [0.4, 0.78, 0.4], LOOK.pillar, 'altar'));
  out.push(prim('ped_cap', 'box', C.altar, [PED[0], PED_TOP - 0.05, PED[2]], [0.5, 0.1, 0.5], LOOK.darkStone, 'altar'));
  // braziers: stand, bowl, flame blob
  BRAZIERS.forEach((b, i) => {
    out.push(prim(`braz${i}_stand`, 'cylinder', C.altar, [b[0], 0.45, b[2]], [0.12, 0.9, 0.12], LOOK.iron, 'altar'));
    out.push(prim(`braz${i}_bowl`, 'cylinder', C.altar, [b[0], 0.97, b[2]], [0.5, 0.14, 0.5], LOOK.bronze, 'altar'));
    out.push(prim(`braz${i}_flame`, 'sphere', C.altar, [b[0], FLAME_Y, b[2]], [0.3, 0.22, 0.3], LOOK.flame, 'altar'));
  });
  return out;
}

/** One sleeping Skeleton_Minion (both passes; flat = role color). `animation` overrides the static pose. */
export function sleeperNode(s: Sleeper, animation?: NonNullable<PrevisNode['model']>['animation']): PrevisNode {
  return {
    id: s.id,
    shape: 'model',
    role: 'skeleton',
    color: C.skeleton,
    model: { src: SRC.minion, fit: 'contain', groundLock: true, animation: animation ?? { clip: s.clip } },
    position: s.pos,
    rotation: [0, s.yaw, 0],
    size: [1.6, MINION_H, 0.8],
  };
}

/** Hall lighting (LIGHT.hall + brazier rims + a faint cold rim at the gate + a warm bounce): 7 rims. */
export const EMBER_RIM = 3.2;
export const HALL_EXPOSURE = 1.8;
export function hallLighting(exposure = HALL_EXPOSURE): NonNullable<PrevisDoc['lighting']> {
  // The ember rim hangs 0.9 m above the orb (head height): it lights the two keepers' faces warmly without
  // burning out the orb and the pedestal cap right under it (clipping), with the exposure raised for the hall.
  const l = LIGHT.hall([PED[0], PED_TOP + 0.9, PED[2]], [
    ...BRAZIERS.map((b) => ({ position: [b[0], FLAME_Y + 0.25, b[2]] as Vec3, color: LIGHT.WARM, intensity: 2.2, range: 7 })),
    { position: [HALL_X1 - 1.2, 2.2, 0] as Vec3, color: LIGHT.COLD, intensity: 3, range: 6 },
    // soft warm bounce on the +z side mid-hall: the key comes from +z, so that wall's inner face is otherwise in shadow
    { position: [0, 3.4, 3.9] as Vec3, color: [1.0, 0.78, 0.55] as Rgb, intensity: 5, range: 7 },
  ]);
  l.rim![0] = { ...l.rim![0], intensity: EMBER_RIM };
  l.env = { ...l.env!, intensity: 1.15 };
  l.exposure = exposure;
  return l;
}
