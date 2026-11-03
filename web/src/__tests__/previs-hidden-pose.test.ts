import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadPrevisPlayer } from '../previs/player';
import type { PrevisDoc, PrevisNode } from '../previs/types';
import { drawnScene } from './drawn-scene';

// Hidden model nodes are posed without sending anything to the engine (GltfAnimator.setDrawEnabled(false)):
// props on their joints stay exact and the first visible frame equals an always-visible run.

const bytes = (name: string): ArrayBuffer => {
  const b = readFileSync(fileURLToPath(new URL(`../../previs/examples/models/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const resolveModel = (src: string) => bytes(src.replace(/^models\//, ''));

const model = (id: string, src: string, clip: string, joint: string, hidden: boolean, extra: Partial<PrevisNode> = {}): PrevisNode[] => [
  {
    id,
    shape: 'model',
    model: { src: `models/${src}`, animation: { clip } },
    color: [0.9, 0.35, 0.15],
    position: [0, 0.875, 0],
    rotation: [0, 0.6, 0],
    size: [0.7, 1.75, 0.5],
    ...(hidden ? { visible: false, tracks: { visible: [{ t: 0, v: false }, { t: 1, v: true }], ...(extra.tracks ?? {}) } } : { tracks: extra.tracks }),
  } as PrevisNode,
  {
    id: `${id}-prop`,
    shape: 'box',
    color: [0.8, 0.8, 0.9],
    parent: id,
    parentJoint: joint,
    position: [0, -0.3, 0.2],
    rotation: [1.57, 0, 0],
    size: [0.06, 0.8, 0.06],
  } as PrevisNode,
];

const doc = (hidden: boolean): PrevisDoc =>
  ({
    version: 1,
    fps: 24,
    size: { width: 64, height: 64 },
    background: [0, 0, 0],
    roles: [],
    nodes: [
      ...model('walker', 'walker.glb', 'walk', 'lowerArm.R', hidden, {
        tracks: { joints: { 'upperArm.R': [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [-1.2, 0, 0] }] } },
      } as Partial<PrevisNode>),
      ...model('tail', 'tail.glb', 'sway', 'joint2', hidden),
    ],
    shots: [{ id: 's', start: 0, end: 2, camera: { position: [{ t: 0, v: [0, 1, 6] }], target: { track: [{ t: 0, v: [0, 0.8, 0] }] }, fov: [{ t: 0, v: 40 }] } }],
  }) as PrevisDoc;

const run = async (hidden: boolean) => {
  const scene = drawnScene();
  const player = await loadPrevisPlayer(scene.sdk, doc(hidden), { resolveModel });
  const frames: { t: number; sends: number; props: number[][]; mats: string[] }[] = [];
  for (const t of [0, 0.25, 0.5, 0.75, 0.99, 1, 1.25, 1.5, 2]) {
    scene.calls.length = 0;
    player.frame(t);
    const props = ['walker-prop', 'tail-prop'].map((id) => {
      const s = [...scene.objects.values()].find((o) => o.name === `previs:${id.replace('-prop', '')}:joint:${id === 'walker-prop' ? 'lowerArm.R' : 'joint2'}`)!;
      return [...s.position, ...s.rotation, ...s.scale];
    });
    const mats = [...scene.objects.values()].filter((o) => o.meshMatrix || o.palette).map((o) => `${[...(o.meshMatrix ?? [])]}|${[...(o.palette ?? [])]}`);
    frames.push({ t, sends: scene.calls.filter((c) => /^setObject(Mesh|Joint)Matrices/.test(c)).length, props: props.map((p) => p), mats });
  }
  return frames;
};

describe('previs hidden models are pose-only', () => {
  it('no engine matrix / palette calls while hidden, props exact, first visible frame identical to an always-visible run', async () => {
    const always = await run(false);
    const hidden = await run(true);
    expect(always.filter((f) => f.t < 1).reduce((n, f) => n + f.sends, 0)).toBeGreaterThan(0);
    for (let i = 0; i < always.length; i++) {
      const a = always[i];
      const h = hidden[i];
      if (h.t < 1) {
        expect(h.sends, `t=${h.t}`).toBe(0);
      }
      // Socket (prop) transforms: exact
      for (let p = 0; p < a.props.length; p++) for (let c = 0; c < a.props[p].length; c++) expect(Math.abs(h.props[p][c] - a.props[p][c])).toBeLessThan(1e-6);
      // From the first visible frame on, the engine holds the same matrices / palettes
      if (h.t >= 1) expect(h.mats).toEqual(a.mats);
    }
  });
});

describe('GltfAnimator.setDrawEnabled', () => {
  it('pose-only keeps nodeMatrix and posedMinAlong exact; enabling sends the current pose once', async () => {
    const mk = async () => {
      const scene = drawnScene();
      const r = await scene.sdk.loadGltf(bytes('tail.glb'), { textures: false, readback: true });
      return { scene, anim: scene.sdk.createGltfAnimator(r, { autoUpdate: false }) };
    };
    const on = await mk();
    const off = await mk();
    off.anim.setDrawEnabled(false);
    expect(off.anim.drawEnabled).toBe(false);
    off.scene.calls.length = 0;
    for (const t of [0.2, 0.9, 1.6]) {
      on.anim.setBlend([{ clip: 'sway', time: t, weight: 1 }]);
      off.anim.setBlend([{ clip: 'sway', time: t, weight: 1 }]);
      for (const a of [[0, 1, 0], [0.3, 0.8, -0.5]] as [number, number, number][]) expect(off.anim.posedMinAlong(a)).toBe(on.anim.posedMinAlong(a));
      expect(Array.from(off.anim.nodeMatrix('joint2'))).toEqual(Array.from(on.anim.nodeMatrix('joint2')));
    }
    expect(off.scene.calls.filter((c) => /Matrices/.test(c)).length).toBe(0);
    off.anim.setDrawEnabled(true);
    expect(off.scene.calls.filter((c) => /Matrices/.test(c)).length).toBeGreaterThan(0);
    const last = (s: ReturnType<typeof drawnScene>) => s.calls.filter((c) => /Matrices/.test(c)).slice(-1);
    expect(last(off.scene)).toEqual(last(on.scene));
  });

  it('measure: hidden 50k-vertex skinned model, ms per frame (logged; engine CPU skinning emulated by the host)', async () => {
    const N = 50_000;
    const JOINTS = 24;
    const pos = new Float32Array(N * 3);
    const joints = new Uint16Array(N * 4);
    const weights = new Float32Array(N * 4);
    for (let v = 0; v < N; v++) {
      pos.set([Math.sin(v) * 0.3, (v / N) * 2, Math.cos(v * 1.3) * 0.2], v * 3);
      const j = Math.min(JOINTS - 2, Math.floor((v / N) * (JOINTS - 1)));
      joints.set([j, j + 1, (j + 2) % JOINTS, 0], v * 4);
      weights.set([0.5, 0.3, 0.2, 0], v * 4);
    }
    const idx = new Uint32Array(N).map((_, i) => i);
    const ibm = new Float32Array(JOINTS * 16);
    for (let j = 0; j < JOINTS; j++) ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, (-2 * j) / JOINTS, 0, 1], j * 16);
    const parts = [pos, joints, weights, idx, ibm];
    const offsets: number[] = [];
    let len = 0;
    for (const p of parts) {
      offsets.push(len);
      len += p.byteLength;
    }
    const buf = new Uint8Array(len);
    parts.forEach((p, k) => buf.set(new Uint8Array(p.buffer), offsets[k]));
    const nodes: object[] = [];
    for (let j = 0; j < JOINTS; j++) nodes.push({ name: `j${j}`, ...(j ? { translation: [0, 2 / JOINTS, 0] } : {}), ...(j < JOINTS - 1 ? { children: [j + 1] } : {}) });
    nodes.push({ name: 'skinned', mesh: 0, skin: 0 });
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0, JOINTS] }],
      nodes,
      meshes: [{ primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3 }] }],
      skins: [{ joints: Array.from({ length: JOINTS }, (_, j) => j), inverseBindMatrices: 4 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: N, type: 'VEC3', min: [-0.3, 0, -0.2], max: [0.3, 2, 0.2] },
        { bufferView: 1, componentType: 5123, count: N, type: 'VEC4' },
        { bufferView: 2, componentType: 5126, count: N, type: 'VEC4' },
        { bufferView: 3, componentType: 5125, count: N, type: 'SCALAR' },
        { bufferView: 4, componentType: 5126, count: JOINTS, type: 'MAT4' },
      ],
      bufferViews: parts.map((p, k) => ({ buffer: 0, byteOffset: offsets[k], byteLength: p.byteLength })),
      buffers: [{ byteLength: len, uri: `data:application/octet-stream;base64,${Buffer.from(buf).toString('base64')}` }],
    };
    const scene = drawnScene();
    const r = await scene.sdk.loadGltf(new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer, { posable: ['j3'] });
    const out = new Float32Array(N * 3);
    let sink = 0;
    let uploads = 0;
    // The engine skins the whole mesh on the CPU on every palette upload
    scene.sdk.setObjectJointMatrices = (_ids, _counts, m) => {
      uploads++;
      for (let v = 0; v < N; v++) {
        let x = 0, y = 0, z = 0;
        const px = pos[v * 3], py = pos[v * 3 + 1], pz = pos[v * 3 + 2];
        for (let k = 0; k < 4; k++) {
          const o = joints[v * 4 + k] * 16;
          const w = weights[v * 4 + k];
          x += w * (m[o] * px + m[o + 4] * py + m[o + 8] * pz + m[o + 12]);
          y += w * (m[o + 1] * px + m[o + 5] * py + m[o + 9] * pz + m[o + 13]);
          z += w * (m[o + 2] * px + m[o + 6] * py + m[o + 10] * pz + m[o + 14]);
        }
        out[v * 3] = x; out[v * 3 + 1] = y; out[v * 3 + 2] = z;
      }
      sink += out[N];
      return 1;
    };
    const anim = scene.sdk.createGltfAnimator(r, { autoUpdate: false });
    const rounds = 100;
    const frame = (draw: boolean): number => {
      anim.setDrawEnabled(draw);
      uploads = 0;
      const t0 = performance.now();
      for (let i = 0; i < rounds; i++) anim.setNodeRotations([{ node: 'j3', rotation: [0, 0, Math.sin(0.01 * i), Math.cos(0.01 * i)] }]);
      const ms = (performance.now() - t0) / rounds;
      expect(uploads).toBe(draw ? rounds : 0);
      return ms;
    };
    frame(true); // warm up
    const shown = frame(true);
    const hidden = frame(false);
    console.log(`50k-vertex skinned model, ms per frame: drawn (palette sent, engine skinning emulated) ${shown.toFixed(3)}, hidden (pose only) ${hidden.toFixed(4)}; sink ${sink > 1e9}`);
    expect(hidden).toBeLessThan(shown / 5);
  });
});
