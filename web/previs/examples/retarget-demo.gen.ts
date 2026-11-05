// Generator for retarget-demo.json: a jointed box mannequin drives a textured skinned character (model.retarget).
// The Quaternius Superhero (CC0, previs/examples/models/quaternius, UE bone names) follows the mannequin "hero":
// walk-in, crouch, pickUp of a box, raise arm. 5.5 s, 24 fps, 2 shots.
// Run from web/: node --experimental-strip-types previs/examples/retarget-demo.gen.ts
// Render both passes:
//   npm run previs:render -- previs/examples/retarget-demo.json --stills=1,2.2,3.65,5 --out=out/ --passes=beauty,textured
//   npm run previs:render -- previs/examples/retarget-demo.json out/retarget-demo.mp4 --split-shots --passes=beauty,textured
// Looks: the mannequin's blocks are look.show 'flat' (beauty / depth only) and the skinned model 'textured' (lit pass
// only). The mannequin's pivots are invisible and stay 'both', so the box can hang from the hand pivot in both passes;
// with retarget.attach the textured pass hangs it from the skinned hand bone instead (the rig's arm is shorter, so its
// hand leaves the mannequin's hand pivot while the arm is clamped straight).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, createMannequin, crouch, pickUp, raiseArm, retargetParts, validateDoc, walk } from '../../src/previs/index.ts';
import type { PrevisDoc, PrevisNode, Rgb, Vec3 } from '../../src/previs/index.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;

const BG: Rgb = [0.1, 0.1, 0.13];
const cSet: Rgb = [0.5, 0.5, 0.55];
const cHero: Rgb = [0.2, 0.4, 0.9];
const cBox: Rgb = [0.95, 0.75, 0.1];

// ---- timeline (seconds) ----
const T_WALK_END = 1.5;
const T_CROUCH = 1.6;
const T_LOW = 2.2;
const T_UP = 2.9;
const T_REACH = 3.0;
const T_GRAB = 3.65;
const T_RISE = 4.35;
const T_RAISE_END = 5.0;
const END = 5.5;

// ---- hero (jointed mannequin, height 1.78 like gate-raid) walks along +x to the box ----
const FROM: Vec3 = [-2.5, 0, 0];
const STAND: Vec3 = [-0.6, 0, 0];
const YAW = Math.PI / 2; // faces +x: forward +x, its left -z, its right +z
const m = createMannequin({ id: 'hero', color: cHero, role: 'hero', height: 1.78, position: FROM, limbs: 'jointed' });
const j = m.joints;
m.nodes.find((n) => n.id === j.root)!.rotation = [0, YAW, 0];

// Box 0.3 m on the floor in front of the right foot; the hand pivot (wrist) reaches just above its top.
const BOX = 0.3;
const toWorld = (p: Vec3): Vec3 => [STAND[0] + p[2] * Math.sin(YAW) + p[0] * Math.cos(YAW), p[1], STAND[2] + p[2] * Math.cos(YAW) - p[0] * Math.sin(YAW)];
const BOX_POS = toWorld([-0.25, BOX / 2, 0.45]); // root frame: right (-x) 0.25, forward 0.45
const GRIP: Vec3 = [BOX_POS[0], BOX + 0.06, BOX_POS[2]];
const pick = pickUp({ mannequin: m, side: 'right', target: GRIP, start: T_REACH, grab: T_GRAB, end: T_RISE, depth: 0.6, lean: 0.7, fps: FPS, rootPosition: STAND, rootYaw: YAW });
if (pick.miss > 1e-6) throw new Error(`pickUp misses the box by ${pick.miss.toFixed(3)} m`);

const nodes = applyMotion(m.nodes, [
  walk({ joints: j, from: FROM, to: STAND, start: 0, end: T_WALK_END, stepsPerSecond: 2.4 }),
  crouch({ mannequin: m, start: T_CROUCH, end: T_LOW, depth: 0.4, fps: FPS }),
  crouch({ mannequin: m, start: T_LOW + 0.15, end: T_UP, from: 0.4, depth: 0, fps: FPS }),
  pick.motion,
  raiseArm({ joints: j, side: 'left', start: T_RISE, end: T_RAISE_END, angle: 2.6 }),
]);
// Visible blocks: flat pass only (the textured pass draws the skinned model instead); pivots stay 'both'
for (const n of nodes) if (n.visible !== false) n.look = { show: 'flat' };

const skin: PrevisNode = {
  id: 'hero_skin',
  shape: 'model',
  role: 'hero',
  color: cHero,
  look: { show: 'textured' },
  // attach: in the textured pass the box's tracks.parent key onto hero.handR hangs it from the rig's hand_r bone
  model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'hero', map: 'ue', attach: true } },
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [1, 1.8, 0.4],
};
// Hair: a Quaternius "Rigged to Head Bone" hairstyle on the same skeleton, retargeted from the same mannequin, so its
// Head bone gets exactly the skin's pose (the character's own eyebrows are part of the body file)
const hair = retargetParts(skin, [{ id: 'hero_hair', src: 'models/quaternius/hair/Hair_SimpleParted.gltf' }]);

const box: PrevisNode = {
  id: 'box',
  shape: 'box',
  role: 'box',
  color: cBox,
  look: { color: [0.55, 0.36, 0.18], roughness: 0.6 },
  position: BOX_POS,
  rotation: [0, YAW, 0],
  size: [BOX, BOX, BOX],
  // picked up at the grab: keeps its world transform and follows the hand pivot
  tracks: { parent: [{ t: T_GRAB, v: { node: pick.hand } }] },
};

const set: PrevisNode[] = [
  { id: 'floor', shape: 'box', role: 'set', color: cSet, look: { color: [0.42, 0.4, 0.38], roughness: 0.9 }, position: [0, -0.05, 0], rotation: [0, 0, 0], size: [8, 0.1, 6] },
  { id: 'wall_back', shape: 'box', role: 'set', color: cSet, look: { color: [0.55, 0.52, 0.48], roughness: 0.85 }, position: [0, 1.5, -3], rotation: [0, 0, 0], size: [8, 3, 0.2] },
  { id: 'wall_left', shape: 'box', role: 'set', color: cSet, look: { color: [0.55, 0.52, 0.48], roughness: 0.85 }, position: [-4, 1.5, 0], rotation: [0, 0, 0], size: [0.2, 3, 6] },
];

const doc: PrevisDoc = {
  version: 1,
  title: 'retarget demo (box mannequin drives a skinned character)',
  fps: FPS,
  size: { width: 960, height: 540 },
  background: BG,
  lighting: {
    key: { dir: [0.4, 0.85, 0.5], intensity: 1.3, shadows: true },
    env: { intensity: 0.9 },
    rim: [{ position: [-2.5, 2.4, -2.2], color: [1, 0.8, 0.6], intensity: 4, range: 7 }],
    exposure: 1,
    toneMapping: 'aces',
  },
  roles: [
    { id: 'set', label: 'room', color: cSet },
    { id: 'hero', label: 'hero', color: cHero },
    { id: 'box', label: 'box', color: cBox },
  ],
  nodes: [...set, ...nodes, skin, ...hair, box],
  shots: [
    {
      id: 'wide',
      start: 0,
      end: T_UP,
      note: 'three-quarter wide: walk-in and crouch',
      camera: {
        position: [{ t: 0, v: [1.6, 1.4, 3.6] }, { t: T_UP, v: [1.3, 1.3, 3.2], ease: 'ease-in-out' }],
        target: { track: [{ t: 0, v: [-1.6, 0.85, 0] }, { t: T_WALK_END, v: [-0.6, 0.8, 0], ease: 'ease-in-out' }] },
      },
    },
    {
      id: 'pickup',
      start: T_UP,
      end: END,
      note: 'side-front medium: pick up the box, raise the arm',
      camera: {
        position: [{ t: T_UP, v: [0.9, 1.0, 2.4] }, { t: END, v: [0.8, 1.2, 2.6], ease: 'ease-in-out' }],
        target: { track: [{ t: T_UP, v: [-0.4, 0.55, 0.1] }, { t: T_RISE, v: [-0.5, 0.9, 0.1], ease: 'ease-in-out' }] },
      },
    },
  ],
};

const v = validateDoc(JSON.parse(JSON.stringify(doc)));
if (!v.ok) {
  for (const i of v.issues) console.error(`${i.path}: ${i.message}`);
  process.exit(2);
}
const outJson = path.join(HERE, 'retarget-demo.json');
fs.writeFileSync(outJson, JSON.stringify(doc, null, 2) + '\n');
console.log('wrote', outJson, 'nodes', doc.nodes.length, 'box', BOX_POS.map((x) => +x.toFixed(3)), 'grip', GRIP.map((x) => +x.toFixed(3)));
