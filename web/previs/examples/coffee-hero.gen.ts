// Generator for coffee-hero.json (vertical Shorts previs, "Coffee Hero").
// Run from web/: node --experimental-strip-types previs/examples/coffee-hero.gen.ts
// Optional env HANDOFF_OUT=<path.md> also writes the Korean handoff prompt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMotion, attachProp, createMannequin, jump, raiseArm, shrug, walk } from '../../src/previs/mannequin.ts';
import type { MotionFragments } from '../../src/previs/mannequin.ts';
import { buildHandoff, suggestRoleColors } from '../../src/previs/handoff.ts';
import { validateDoc } from '../../src/previs/validate.ts';
import type { Keyframe, PrevisDoc, PrevisNode, Rgb, Shot, Track, Vec3 } from '../../src/previs/types.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 24;
const DUR = 9;
const W = Number(process.env.W ?? 540);
const H = Number(process.env.H ?? 960);

// ---- timeline (seconds) ----
const T_TAKE = 4.4; // takeoff
const AIR = 1.2; // slow-mo airtime
const T_LAND = T_TAKE + AIR; // 5.6
const JUMP_H = 1.6;
const SPEED = 5.2; // m/s sprint
const X_TAKE = 3.1;
const X_LAND = -3.1;
const X_START = X_TAKE + SPEED * T_TAKE;
const BUS_SPEED = 8; // m/s, travels +z -> -z, centre passes z=0 at t=5.0
const busZ = (t: number) => (t - 5.0) * BUS_SPEED;

// ---- colors ----
const SKY: Rgb = [0.62, 0.76, 0.9];
const avoid: Rgb[] = [
  [0.87, 0.68, 0.55], // skin
  [0.35, 0.35, 0.37], // asphalt
  SKY, // sky / background
  [0.62, 0.6, 0.56], // concrete
  [0.15, 0.2, 0.35], // suit navy
];
const [cHero, cBus, cCup] = suggestRoleColors(3, avoid);
const roles = [
  { id: 'hero', label: 'late office worker (hero)', color: cHero, reference: 'hero face sheet + outfit sheet' },
  { id: 'bus', label: 'city bus', color: cBus, reference: 'bg photo' },
  { id: 'cup', label: 'takeout coffee cup (right hand)', color: cCup },
];

// ---- hero ----
const m = createMannequin({ id: 'hero', color: cHero, role: 'hero', height: 1.75, position: [X_START, 0, 0], limbs: 'full' });
const j = m.joints;
let heroNodes = attachProp(m.nodes, j.handR!, { id: 'cup', size: [0.09, 0.13, 0.09], color: cCup, role: 'cup' });

const frags: MotionFragments[] = [];
frags.push(walk({ joints: j, from: [X_START, 0, 0], to: [X_TAKE, 0, 0], start: 0, end: T_TAKE, stepsPerSecond: 3.2 }));
// facing: walk yaws -90deg (faces -x). After landing turn to face the camera (+z).
frags.push({
  [j.root]: {
    rotation: [
      { t: T_LAND, v: [0, -Math.PI / 2, 0], ease: 'ease-in-out' },
      { t: 6.5, v: [0, 0.2, 0] },
    ],
  },
});
// jump(): arc + left-arm swing. Root position is resampled so the hero also travels across the bus
// (jump() alone keeps x fixed at base); y matches jump()'s ease-out/ease-in parabola.
const jf = jump({ joints: j, start: T_TAKE, airTime: AIR, height: JUMP_H, base: [X_TAKE, 0, 0] });
const arc: Track<Vec3> = [];
const N = 12;
for (let i = 0; i <= N; i++) {
  const u = i / N;
  arc.push({ t: T_TAKE + u * AIR, v: [X_TAKE + (X_LAND - X_TAKE) * u, 4 * JUMP_H * u * (1 - u), 0] });
}
jf[j.root] = { position: arc };
delete jf[j.shoulderR!]; // right arm keeps holding the cup level
frags.push(jf);
// landing crouch
frags.push({
  [j.spine]: {
    position: [
      { t: T_LAND, v: [0, 0, 0], ease: 'ease-out' },
      { t: T_LAND + 0.15, v: [0, -0.12, 0], ease: 'ease-in-out' },
      { t: T_LAND + 0.5, v: [0, 0, 0] },
    ],
  },
});
// sip: raise, hold, lower; then shrug
frags.push(raiseArm({ joints: j, side: 'right', start: 6.9, end: 7.5, angle: 2.0 }));
frags.push(raiseArm({ joints: j, side: 'right', start: 8.0, end: 8.35, from: 2.0, angle: 0 }));
frags.push(shrug({ joints: j, start: 8.4, duration: 0.6 }));
heroNodes = applyMotion(heroNodes, frags);

// cup counter-rotates the right shoulder's rx so it stays level (payoff); extra tilt at the sip.
const sh = heroNodes.find((n) => n.id === j.shoulderR)!;
const cupRot: Keyframe<Vec3>[] = [];
for (const k of sh.tracks!.rotation!) {
  cupRot.push({ t: k.t, v: [-k.v[0], 0, 0], ease: k.ease });
  if (k.t === 7.5) {
    const base = -k.v[0];
    cupRot.push({ t: 7.65, v: [base - 0.5, 0, 0], ease: 'ease-in-out' });
    cupRot.push({ t: 7.85, v: [base - 0.5, 0, 0], ease: 'ease-in-out' });
  }
}
// first key's ease may be needed on the preceding point; keep order sorted
cupRot.sort((a, b) => a.t - b.t);
const cup = heroNodes.find((n) => n.id === 'cup')!;
cup.tracks = { rotation: cupRot };
// fix up eases: a key's ease governs the segment starting there; sip tilt segments need explicit values
for (let i = 0; i < cupRot.length; i++) {
  if (cupRot[i].t === 7.5) cupRot[i].ease = 'ease-in-out';
  if (cupRot[i].t === 7.85) cupRot[i].ease = 'ease-in-out';
}

// ---- bus ----
const bus: PrevisNode = {
  id: 'bus',
  shape: 'box',
  role: 'bus',
  color: cBus,
  position: [0, 0.55, busZ(0)],
  rotation: [0, 0, 0],
  size: [2.2, 1.1, 8],
  tracks: {
    position: [
      { t: 0, v: [0, 0.55, busZ(0)] },
      { t: DUR, v: [0, 0.55, busZ(DUR)] },
    ],
  },
};

// ---- set ----
const box = (id: string, color: Rgb, position: Vec3, size: Vec3, shape: PrevisNode['shape'] = 'box'): PrevisNode => ({
  id, shape, color, position, rotation: [0, 0, 0], size,
});
const set: PrevisNode[] = [
  box('ground', [0.35, 0.35, 0.37], [0, -0.05, 0], [90, 0.1, 60]),
  box('building1', [0.62, 0.6, 0.56], [20, 7, -10], [12, 14, 8]),
  box('building2', [0.58, 0.56, 0.54], [8, 4.5, -10], [8, 9, 8]),
  box('building3', [0.66, 0.64, 0.6], [-14, 9, -10], [12, 18, 8]),
];
for (let i = 0; i < 8; i++) set.push(box(`cross${i}`, [0.95, 0.95, 0.95], [0, 0.012, -3.15 + i * 0.9], [7, 0.02, 0.45]));
for (const [i, x] of [16, 7.5, -8, -17].entries()) {
  set.push(box(`lamp${i}.pole`, [0.25, 0.27, 0.3], [x, 2.25, -3], [0.12, 4.5, 0.12], 'cylinder'));
  set.push(box(`lamp${i}.head`, [0.25, 0.27, 0.3], [x, 4.55, -2.8], [0.2, 0.12, 0.6]));
}

// ---- camera ----
const clampHold = (t: number, a: number, b: number) => Math.min(b, Math.max(a, t));
function heroPos(t: number): Vec3 {
  if (t <= T_TAKE) return [X_START - SPEED * t, 0, 0];
  if (t < T_LAND) {
    const u = (t - T_TAKE) / AIR;
    return [X_TAKE + (X_LAND - X_TAKE) * u, 4 * JUMP_H * u * (1 - u), 0];
  }
  return [X_LAND, 0, 0];
}
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sample = (a: number, b: number, step: number, f: (t: number) => Vec3): Track<Vec3> => {
  const out: Track<Vec3> = [];
  for (let t = a; t < b - 1e-9; t += step) out.push({ t: +t.toFixed(4), v: f(t) });
  out.push({ t: b, v: f(b) });
  return out;
};
const ff = (a: number, b: number): Track<number> => [{ t: a, v: b }];

const shots: Shot[] = [
  {
    id: 's1-track',
    start: 0,
    end: 2.5,
    camera: {
      position: sample(0, 2.5, 0.25, (t) => add(heroPos(t), [3.4, 0.55, -0.6 + 0.5 * (t / 2.5)])),
      target: { follow: 'hero.root', offset: [-0.8, 0.95, 0] },
      fov: ff(0, 62),
    },
  },
  {
    id: 's2-wide',
    start: 2.5,
    end: 4.0,
    camera: {
      position: [
        { t: 2.5, v: [11, 2.0, 8] },
        { t: 4.0, v: [8, 2.0, 8] },
      ],
      target: { follow: 'hero.root', offset: [-1.0, 0.9, -0.5] },
      fov: ff(2.5, 66),
    },
  },
  {
    id: 's3-orbit',
    start: 4.0,
    end: 7.0,
    camera: {
      position: (() => {
        const r = 4.6;
        const th = (t: number) => {
          const ks: [number, number][] = [
            [4.0, 0.9 * Math.PI],
            [5.0, 1.5 * Math.PI],
            [5.9, 1.85 * Math.PI],
            [7.0, 2.0 * Math.PI],
          ];
          for (let i = 0; i < ks.length - 1; i++) {
            if (t <= ks[i + 1][0]) {
              const u = (t - ks[i][0]) / (ks[i + 1][0] - ks[i][0]);
              const s = u * u * (3 - 2 * u);
              return ks[i][1] + (ks[i + 1][1] - ks[i][1]) * (0.5 * u + 0.5 * s);
            }
          }
          return ks[ks.length - 1][1];
        };
        return sample(4.0, 7.0, 1 / 12, (t) => {
          const h = heroPos(clampHold(t, 0, DUR));
          const a = th(t);
          return [h[0] + r * Math.sin(a), 0.55 + 0.1 * h[1], h[2] + r * Math.cos(a)];
        });
      })(),
      target: { follow: 'hero.root', offset: [0, 0.9, 0] },
      fov: ff(4.0, 60),
    },
  },
  {
    id: 's4-sip',
    start: 7.0,
    end: 9.0,
    camera: {
      position: [
        { t: 7.0, v: [X_LAND + 0.1, 1.4, 3.0], ease: 'ease-in-out' },
        { t: 9.0, v: [X_LAND + 0.1, 1.4, 2.5] },
      ],
      target: { follow: 'hero.root', offset: [0, 1.3, 0] },
      fov: ff(7.0, 42),
    },
  },
];

const doc: PrevisDoc = {
  version: 1,
  title: 'Coffee Hero',
  fps: FPS,
  size: { width: W, height: H },
  background: SKY,
  avoidColors: avoid,
  roles,
  nodes: [...set, bus, ...heroNodes],
  shots,
};

const v = validateDoc(JSON.parse(JSON.stringify(doc)));
if (!v.ok) {
  for (const i of v.issues) console.error(`${i.path}: ${i.message}`);
  process.exit(2);
}
const outJson = path.join(HERE, 'coffee-hero.json');
fs.writeFileSync(outJson, JSON.stringify(doc, null, 2) + '\n');
console.log('wrote', outJson, 'nodes', doc.nodes.length);

if (process.env.HANDOFF_OUT) {
  const h = buildHandoff(doc, {
    lang: 'ko',
    references: [
      { name: 'hero face sheet', role: 'hero', note: '주인공 얼굴 시트' },
      { name: 'outfit sheet', role: 'hero', note: '출근 정장 착장 시트' },
      { name: 'bg photo', note: '도심 거리 배경 사진' },
    ],
    textOnly: [
      '커피컵에서 김이 모락모락 피어오름 (컵은 점프 내내 수평 유지, 쏟아지지 않음)',
      '표정: 지각 직전의 다급함 -> 착지 후 안도 -> 한 모금 마시고 만족한 미소',
      '한 모금 마시는 동작과 마지막의 작은 어깨 으쓱',
      '버스 외형(도시 버스), 조명(아침 햇빛), 질감은 참조 이미지 기준',
    ],
  });
  const md = `# Coffee Hero handoff\n\n## 업로드 순서\n${h.uploadOrder.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n\n## 프롬프트\n\n\`\`\`\n${h.prompt}\n\`\`\`\n`;
  fs.writeFileSync(process.env.HANDOFF_OUT, md);
  console.log('wrote', process.env.HANDOFF_OUT);
}
