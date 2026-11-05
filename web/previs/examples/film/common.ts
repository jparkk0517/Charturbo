// Shared conventions for the short film "불씨지기 (The Ember Keeper)": one generator per scene
// (film/sNN-<name>.gen.ts -> film/sNN-<name>.json). READ-ONLY for scene authors: ask the director for changes.
// Run a scene from web/: node --experimental-strip-types previs/examples/film/s01-hall.gen.ts
import fs from 'node:fs';
import path from 'node:path';
import { createMannequin, jointedJointIds, suggestRoleColors, validateDoc, docDuration, retargetParts } from '../../../src/previs/index.ts';
import type { PrevisDoc, PrevisNode, Rgb, Track, Vec3 } from '../../../src/previs/index.ts';

// ---- format (identical in every scene) ----
export const FPS = 24;
export const SIZE = { width: 1280, height: 720 };
export const BG: Rgb = [0.03, 0.03, 0.045]; // near-black void (excluded from the luma check)
export const WORLD_SCALE = 10;

// ---- model sources (relative to the film/ folder = the doc's directory) ----
export const SRC = {
  haon: 'models/haon/Superhero_Female_FullBody.gltf', // Quaternius CC0 (fixed copy: eye normal uri)
  mentor: '../models/quaternius/Superhero_Male_FullBody.gltf', // Quaternius CC0
  walker: '../models/walker.glb', // flat blockout giant source (clips walk, wave)
  minion: '../models/kaykit/Skeleton_Minion.glb',
  warrior: '../models/kaykit/Skeleton_Warrior.glb',
  sword: '../models/kaykit/sword_1handed.gltf',
  axe: '../models/kaykit/axe_2handed.gltf',
  floorTile: '../models/kaykit/floor_tile_large.gltf.glb', // 4 x 0.15 x 4, top at y = 0.05 (file min y -0.1)
  wall: '../models/kaykit/wall.gltf.glb', // 4 x 4 x 1
  wallGated: '../models/kaykit/wall_gated.gltf.glb', // 4 x 4 x 1, arched opening
  pillar: '../models/kaykit/pillar.gltf.glb', // 1.5 x 4 x 1.5
} as const;
/**
 * Hair of each skin (Quaternius CC0 "Rigged to Head Bone" hairstyles on the same skeleton as the body, see
 * ../models/quaternius/hair/README.md): `writeDoc` adds them after every `<who>_skin` node (`retargetParts`: same
 * retarget source, look and visible track as the skin). Eyebrows are part of the body files. 하온: dark-tinted buns (her
 * body file's eyebrow material has the same tint); 도원: untinted (silver) beard and buzzed hair.
 */
export const HAIR: Record<'haon' | 'mentor', readonly string[]> = {
  haon: ['../models/quaternius/hair/Hair_Buns.gltf'],
  mentor: ['../models/quaternius/hair/Hair_Beard.gltf', '../models/quaternius/hair/Hair_Buzzed.gltf'],
};

// ---- characters ----
export const HAON_H = 1.68; // 하온, apprentice ember keeper (Quaternius Superhero Female)
export const MENTOR_H = 1.8; // 도원, old keeper (Quaternius Superhero Male)
export const WARDEN_H = 3.6; // 수문장, giant skeleton warden
export const MINION_H = 1.75; // sleeping / waking skeletons (Skeleton_Minion)

// ---- colors ----
export const STONE: Rgb = [0.2, 0.2, 0.22];
export const STONE_LIGHT: Rgb = [0.27, 0.26, 0.28];
/** Flat-pass color of pillars / columns / door jambs (set, no role). The flat pass has no shading, so a set piece only
 * reads against what is behind it by its color (CIE76 dE: floor STONE - walls STONE_LIGHT 7, walls - PILLAR_FLAT 19,
 * floor - PILLAR_FLAT 26; PILLAR_FLAT - every role color >= 46). Primitives keep their textured color in `look.color`. */
export const PILLAR_FLAT: Rgb = [0.45, 0.44, 0.46];
export const AVOID: Rgb[] = [
  STONE,
  STONE_LIGHT,
  BG,
  [0.05, 0.05, 0.06], // dark outfits
  [0.87, 0.68, 0.55], // light skin
  [0.6, 0.42, 0.3], // darker skin
  [0.85, 0.82, 0.72], // bone
  [1.0, 0.62, 0.22], // ember glow
  [0.45, 0.55, 1.0], // cold crypt glow
];
export const ROLE_IDS = ['haon', 'mentor', 'ember', 'sword', 'skeleton', 'warden', 'gate', 'altar'] as const;
export type RoleId = (typeof ROLE_IDS)[number];
const LABELS: Record<RoleId, string> = {
  haon: '하온 (apprentice ember keeper, woman)',
  mentor: '도원 (old keeper, man)',
  ember: 'ember orb (glowing stone)',
  sword: 'old sword',
  skeleton: 'skeletons',
  warden: 'giant skeleton warden',
  gate: 'sealed gate / portcullis',
  altar: 'altar / pedestal / braziers',
};
const palette = suggestRoleColors(ROLE_IDS.length, AVOID);
/** Flat role colors: identical in every scene. */
export const C = Object.fromEntries(ROLE_IDS.map((id, i) => [id, palette[i]])) as Record<RoleId, Rgb>;
/** All roles; every scene doc lists all of them (stable mapping). */
export const ROLES = ROLE_IDS.map((id) => ({ id, label: LABELS[id], color: C[id] }));

// ---- textured-pass looks (look.color / roughness / metallic; primitives only, never on model nodes) ----
export const LOOK = {
  floor: { color: [0.3, 0.29, 0.28] as Rgb, roughness: 0.92 },
  wall: { color: [0.32, 0.31, 0.3] as Rgb, roughness: 0.9 },
  pillar: { color: [0.36, 0.34, 0.33] as Rgb, roughness: 0.9 },
  darkStone: { color: [0.22, 0.21, 0.21] as Rgb, roughness: 0.95 },
  iron: { color: [0.25, 0.25, 0.27] as Rgb, roughness: 0.5, metallic: 0.8 },
  bronze: { color: [0.55, 0.4, 0.22] as Rgb, roughness: 0.45, metallic: 0.7 },
  ember: { color: [1.0, 0.62, 0.22] as Rgb, roughness: 0.3 }, // the ember orb, alive
  emberDim: { color: [0.55, 0.28, 0.12] as Rgb, roughness: 0.5 }, // nearly out (use a second orb + visible tracks to swap)
  flame: { color: [1.0, 0.78, 0.35] as Rgb, roughness: 0.25 }, // brazier fire blobs
};
export const EMBER_D = 0.16; // ember orb diameter (m) when carried

// ---- lighting presets (textured pass only). Tune `exposure` per scene so check-textured mean luma is 0.25..0.65 ----
type Lighting = NonNullable<PrevisDoc['lighting']>;
const WARM: Rgb = [1.0, 0.62, 0.25];
const COLD: Rgb = [0.45, 0.55, 1.0];
export const LIGHT = {
  /** S01, S02: keeper's hall, warm ember light at the pedestal + soft key. */
  hall: (emberPos: Vec3, extraRim: Lighting['rim'] = []): Lighting => ({
    key: { dir: [0.3, 0.9, 0.45], intensity: 1.1, shadows: true },
    env: { sky: [0.5, 0.46, 0.42], ground: [0.2, 0.17, 0.14], intensity: 1.0 },
    rim: [{ position: emberPos, color: WARM, intensity: 6, range: 9 }, ...(extraRim ?? [])],
    exposure: 1.45,
    toneMapping: 'aces',
  }),
  /** S03, S04, S05: cold crypt beyond the gate. */
  crypt: (rims: NonNullable<Lighting['rim']>): Lighting => ({
    key: { dir: [-0.35, 0.9, 0.3], intensity: 1.0, shadows: true },
    env: { sky: [0.4, 0.45, 0.6], ground: [0.16, 0.16, 0.2], intensity: 1.0 },
    rim: rims,
    exposure: 1.5,
    toneMapping: 'aces',
  }),
  /** S06, S07: warden's vault, high cold key, red-amber accents. */
  vault: (rims: NonNullable<Lighting['rim']>): Lighting => ({
    key: { dir: [0.2, 0.95, -0.3], intensity: 1.2, shadows: true },
    env: { sky: [0.38, 0.42, 0.55], ground: [0.18, 0.15, 0.14], intensity: 1.0 },
    rim: rims,
    exposure: 1.5,
    toneMapping: 'aces',
  }),
  /** S08: altar chamber, warm and bright. */
  altar: (rims: NonNullable<Lighting['rim']>): Lighting => ({
    key: { dir: [0.25, 0.9, 0.5], intensity: 1.2, shadows: true },
    env: { sky: [0.6, 0.52, 0.42], ground: [0.24, 0.19, 0.14], intensity: 1.1 },
    rim: rims,
    exposure: 1.4,
    toneMapping: 'aces',
  }),
  WARM,
  COLD,
};

// ---- vectors / time ----
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
export const lerp3 = (a: Vec3, b: Vec3, u: number): Vec3 => [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
export const r4 = (t: number) => +t.toFixed(4);
/** Yaw that faces from `a` toward `b` (mannequins face +z at yaw 0), in (-pi, pi]. */
export const yawTo = (a: Vec3, b: Vec3) => Math.atan2(b[0] - a[0], b[2] - a[2]);
/** Global frame times k / FPS in [a, b], plus a and b. */
export const frameTimes = (a: number, b: number): number[] => {
  const out: number[] = [a];
  for (let k = Math.ceil(a * FPS - 1e-9); k / FPS < b - 1e-9; k++) if (k / FPS > a + 1e-9) out.push(r4(k / FPS));
  out.push(b);
  return out;
};
/** Smooth camera track sampled from f every `step` seconds over [a, b]. */
export const sample = (a: number, b: number, step: number, f: (t: number) => Vec3): Track<Vec3> => {
  const out: Track<Vec3> = [];
  for (let t = a; t < b - 1e-9; t += step) out.push({ t: r4(t), v: f(t), ease: 'smooth' });
  out.push({ t: b, v: f(b) });
  return out;
};

// ---- character factory: jointed mannequin (flat pass) + retargeted Quaternius skin (textured pass) ----
export type Who = 'haon' | 'mentor';
/**
 * Builds the jointed mannequin `<who>` (ids `<who>.root`, `<who>.handL`, ...) and its skin node `<who>_skin`.
 * Apply motions to `m.nodes`, then call `flatOnly(nodes)` on the result. Only ONE haon and ONE mentor per doc
 * (one Quaternius skin of each per doc; the 1024² textures would allow up to 9 instances, see docs/previs/guide.md "Texture memory").
 * `writeDoc` adds the skin's hair nodes (`HAIR`, `hairOf`); a scene that writes its doc another way calls `hairOf(skin)`.
 */
export function character(who: Who, position: Vec3, yaw = 0) {
  const m = createMannequin({ id: who, color: C[who], role: who, height: who === 'haon' ? HAON_H : MENTOR_H, position, limbs: 'jointed' });
  const root = m.nodes.find((n) => n.id === m.joints.root)!;
  root.rotation = [0, yaw, 0];
  root.rotationPath = 'shortest';
  const skin: PrevisNode = {
    id: `${who}_skin`,
    shape: 'model',
    role: who,
    color: C[who],
    look: { show: 'textured' },
    model: { src: SRC[who], retarget: { source: who, map: 'ue', attach: true } },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [1, who === 'haon' ? HAON_H : MENTOR_H, 0.4],
  };
  return { m, j: jointedJointIds(who), skin }; // limbs: 'jointed' -> every joint id is defined
}
/** Visible mannequin blocks: flat pass only (pivots stay 'both' so props / follow work in every pass). Mutates and returns. */
export function flatOnly(nodes: PrevisNode[]): PrevisNode[] {
  for (const n of nodes) if (n.visible !== false) n.look = { show: 'flat' };
  return nodes;
}

// ---- output ----
/** Hair part nodes of a skin: `<who>_hair_<file name in lower case without "hair_">`, e.g. `mentor_hair_beard`. */
export function hairOf(skin: PrevisNode): PrevisNode[] {
  const who = skin.id.replace(/_skin$/, '') as Who;
  return retargetParts(
    skin,
    HAIR[who].map((src) => ({ id: `${who}_hair_${path.basename(src, '.gltf').replace(/^Hair_/, '').toLowerCase()}`, src })),
  );
}
/** `doc` with the hair of every character skin (`<who>_skin`) inserted right after it (the skin's final visible track). */
function withHair(doc: PrevisDoc): PrevisDoc {
  const skins = new Set(Object.keys(HAIR).map((who) => `${who}_skin`));
  return { ...doc, nodes: doc.nodes.flatMap((n) => (skins.has(n.id) ? [n, ...hairOf(n)] : [n])) };
}

/** Validates and writes `<name>.json` next to the generators (hair added, see `HAIR`); exits 2 on issues. Returns the duration. */
export function writeDoc(name: string, docIn: PrevisDoc, dir: string): number {
  const doc = withHair(docIn);
  const v = validateDoc(JSON.parse(JSON.stringify(doc)));
  if (!v.ok) {
    for (const i of v.issues) console.error(`${i.path}: ${i.message}`);
    process.exit(2);
  }
  if (doc.fps !== FPS || doc.size.width !== SIZE.width || doc.size.height !== SIZE.height) throw new Error('film format: 1280x720 @ 24 fps');
  const out = path.join(dir, `${name}.json`);
  fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  const dur = docDuration(doc);
  console.log('wrote', out, 'nodes', doc.nodes.length, 'shots', doc.shots.length, 'duration', dur);
  return dur;
}
