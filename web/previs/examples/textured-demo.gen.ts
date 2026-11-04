// Generator for textured-demo.json: a small stone hall (KayKit CC0 dungeon + skeleton models, previs/examples/models/kaykit)
// for the lit `textured` pass (doc.lighting, per-node look). 4 s, 24 fps, 2 shots.
// Run from web/: node --experimental-strip-types previs/examples/textured-demo.gen.ts
// Render both passes:
//   npm run previs:render -- previs/examples/textured-demo.json --stills=0.5,2,3.5 --out=out/ --passes=beauty,textured
//   npm run previs:render -- previs/examples/textured-demo.json out/textured-demo.mp4 --split-shots --passes=beauty,textured
// Shows: model materials kept in the textured pass, primitive lit look (crate: look.color / roughness / metallic),
// look.show: the flat box `warrior_proxy` is drawn only by the flat pass, the Skeleton_Warrior model only by the
// textured pass; `lighting` with key + env + one rim light.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDoc } from '../../src/previs/index.ts';
import type { PrevisDoc, PrevisNode, Rgb, Vec3 } from '../../src/previs/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const K = 'models/kaykit/';

const BG: Rgb = [0.1, 0.1, 0.13];
const cSet: Rgb = [0.5, 0.5, 0.55];
const cMinion: Rgb = [0.9, 0.2, 0.2];
const cWarrior: Rgb = [0.2, 0.4, 0.9];
const cAxe: Rgb = [0.95, 0.8, 0.15];
const cCrate: Rgb = [0.2, 0.75, 0.35];

const yawTo = (a: Vec3, b: Vec3) => Math.atan2(b[0] - a[0], b[2] - a[2]);
const r3 = (v: number) => +v.toFixed(3);

const set: PrevisNode[] = [];
const piece = (id: string, src: string, size: Vec3, position: Vec3, yaw = 0): void => {
  set.push({ id, shape: 'model', role: 'set', color: cSet, model: { src: K + src, fit: 'stretch' }, position, rotation: [0, yaw, 0], size });
};
// floor 12 x 8 m: 3 x 2 tiles of 4 m
for (const x of [-4, 0, 4]) for (const z of [-4, 0]) piece(`floor_${x}_${z}`, 'floor_tile_large.gltf.glb', [4, 0.15, 4], [x, -0.05, z]);
// back wall (z = -6) with the gate in the middle, left wall
piece('wall_back_l', 'wall.gltf.glb', [4, 4, 1], [-4, 2, -6]);
piece('wall_back_gate', 'wall_gated.gltf.glb', [4, 4, 1], [0, 2, -6]);
piece('wall_back_r', 'wall.gltf.glb', [4, 4, 1], [4, 2, -6]);
piece('wall_left_a', 'wall.gltf.glb', [4, 4, 1], [-6.5, 2, -4], Math.PI / 2);
piece('wall_left_b', 'wall.gltf.glb', [4, 4, 1], [-6.5, 2, 0], Math.PI / 2);
piece('pillar_l', 'pillar.gltf.glb', [0.9, 3.2, 0.9], [-3.4, 1.6, -3.2]);
piece('pillar_r', 'pillar.gltf.glb', [0.9, 3.2, 0.9], [3.4, 1.6, -3.2]);

// minion: walks (Walking_A) then chops at the warrior
const MIN_FROM: Vec3 = [-3, 0.8, 1.5];
const MIN_TO: Vec3 = [0.3, 0.8, -1.0];
const WAR: Vec3 = [1.8, 0.85, -1.8];
const T_ATTACK = 2.0;
const minion: PrevisNode = {
  id: 'minion', shape: 'model', role: 'minion', color: cMinion,
  model: {
    src: K + 'Skeleton_Minion.glb', fit: 'contain', groundLock: true,
    animation: [
      { clip: 'Walking_A', loop: 'repeat' },
      { clip: '1H_Melee_Attack_Chop', start: T_ATTACK, blendIn: 0.2, loop: 'repeat' },
    ],
  },
  position: MIN_FROM, rotation: [0, yawTo(MIN_FROM, MIN_TO), 0], size: [1.45, 1.6, 0.7],
  tracks: {
    position: [{ t: 0, v: MIN_FROM }, { t: T_ATTACK, v: MIN_TO }],
    rotation: [{ t: 0, v: [0, r3(yawTo(MIN_FROM, MIN_TO)), 0] }, { t: T_ATTACK, v: [0, r3(yawTo(MIN_FROM, MIN_TO)), 0] }, { t: T_ATTACK + 0.3, v: [0, r3(yawTo(MIN_TO, WAR)), 0] }],
  },
};
const warriorYaw = r3(yawTo(WAR, MIN_TO));
// warrior: model in the textured pass, a flat box stand-in in the flat pass
const warrior: PrevisNode = {
  id: 'warrior', shape: 'model', role: 'warrior', color: cWarrior, look: { show: 'textured' },
  model: { src: K + 'Skeleton_Warrior.glb', fit: 'contain', groundLock: true, animation: { clip: 'Idle', loop: 'repeat' } },
  position: WAR, rotation: [0, warriorYaw, 0], size: [1.45, 1.6, 0.7],
};
const warriorProxy: PrevisNode = {
  id: 'warrior_proxy', shape: 'box', role: 'warrior', color: cWarrior, look: { show: 'flat' },
  position: [WAR[0], 0.8, WAR[2]], rotation: [0, warriorYaw, 0], size: [0.6, 1.6, 0.4],
};
const axe: PrevisNode = {
  id: 'axe', shape: 'model', role: 'axe', color: cAxe,
  model: { src: K + 'axe_2handed.gltf', fit: 'contain' },
  position: [-0.8, 0.07, -2.4], rotation: [Math.PI / 2, 0.6, 0], size: [0.55, 0.77, 0.12],
};
const crate: PrevisNode = {
  id: 'crate', shape: 'box', role: 'crate', color: cCrate, look: { color: [0.55, 0.36, 0.18], roughness: 0.45 },
  position: [-1.8, 0.25, -3.6], rotation: [0, 0.4, 0], size: [0.7, 0.5, 0.7],
};

const doc: PrevisDoc = {
  version: 1,
  title: 'textured demo (lit pass, KayKit stone hall)',
  fps: FPS,
  size: { width: 960, height: 540 },
  background: BG,
  avoidColors: [[0.8, 0.62, 0.5]],
  lighting: {
    key: { dir: [0.5, 0.8, 0.6], intensity: 1.2, shadows: true },
    env: { intensity: 0.9 },
    rim: [{ position: [0.5, 2.6, -4.2], color: [1, 0.75, 0.5], intensity: 6, range: 8 }],
    exposure: 1,
    toneMapping: 'aces',
  },
  roles: [
    { id: 'set', label: 'stone hall', color: cSet },
    { id: 'minion', label: 'skeleton minion', color: cMinion },
    { id: 'warrior', label: 'skeleton warrior', color: cWarrior },
    { id: 'axe', label: 'axe', color: cAxe },
    { id: 'crate', label: 'crate', color: cCrate },
  ],
  nodes: [...set, minion, warrior, warriorProxy, axe, crate],
  shots: [
    {
      id: 'wide', start: 0, end: 2, note: 'wide of the hall, slow push-in',
      camera: {
        position: [{ t: 0, v: [0.5, 2.4, 6.2] }, { t: 2, v: [0.3, 2.1, 5.2], ease: 'ease-in-out' }],
        target: { track: [{ t: 0, v: [0, 1.1, -1.5] }] },
      },
    },
    {
      id: 'attack', start: 2, end: 4, note: 'low three-quarter on the attack',
      camera: {
        position: [{ t: 2, v: [3.2, 1.2, 1.8] }, { t: 4, v: [2.6, 1.3, 1.2] }],
        target: { follow: 'minion', offset: [0.6, 0.9, -0.5] },
      },
    },
  ],
};

const v = validateDoc(JSON.parse(JSON.stringify(doc)));
if (!v.ok) {
  for (const i of v.issues) console.error(`${i.path}: ${i.message}`);
  process.exit(2);
}
const outJson = path.join(HERE, 'textured-demo.json');
fs.writeFileSync(outJson, JSON.stringify(doc, null, 2) + '\n');
console.log('wrote', outJson, 'nodes', doc.nodes.length);
