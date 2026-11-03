import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadPrevisPlayer } from '../previs/player';
import type { PrevisDoc, PrevisNode, Track, Vec3 } from '../previs/types';
import { GltfAnimator, hasGltfGeometry } from '../sdk/scene-gltf-anim';
import { drawnScene } from './drawn-scene';

// model.groundLock with the real loader, animator and player over a recording backend: the lowest drawn vertex
// (engine-style world chain x mesh matrix / skin, recomputed independently by drawnScene) must be at y = 0.

const bytes = (name: string): ArrayBuffer => {
  const b = readFileSync(fileURLToPath(new URL(`../../previs/examples/models/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const resolveModel = (src: string) => bytes(src.replace(/^models\//, ''));

const crouch = (t0: number, t1: number): Record<string, Track<Vec3>> => ({
  'upperLeg.R': [{ t: t0, v: [0, 0, 0] }, { t: t1, v: [-1.2, 0, 0] }],
  'upperLeg.L': [{ t: t0, v: [0, 0, 0] }, { t: t1, v: [-1.2, 0, 0] }],
  'lowerLeg.R': [{ t: t0, v: [0, 0, 0] }, { t: t1, v: [2.0, 0, 0] }],
  'lowerLeg.L': [{ t: t0, v: [0, 0, 0] }, { t: t1, v: [2.0, 0, 0] }],
});

const walker = (id: string, groundLock: boolean | undefined, extra: Partial<PrevisNode> = {}): PrevisNode =>
  ({
    id,
    shape: 'model',
    model: { src: 'models/walker.glb', animation: { clip: 'walk' }, ...(groundLock !== undefined ? { groundLock } : {}) },
    color: [0.9, 0.35, 0.15],
    position: [0, 0.875, 0],
    rotation: [0, Math.PI / 2, 0],
    size: [0.7, 1.75, 0.5],
    tracks: { joints: crouch(0.5, 2) },
    ...extra,
  }) as PrevisNode;

const box = (id: string, extra: Partial<PrevisNode> = {}): PrevisNode =>
  ({ id, shape: 'box', color: [0.2, 0.2, 0.2], position: [0, 0, 0], rotation: [0, 0, 0], size: [0.1, 0.1, 0.1], ...extra }) as PrevisNode;

const doc = (nodes: PrevisNode[]): PrevisDoc =>
  ({
    version: 1,
    fps: 24,
    size: { width: 64, height: 64 },
    background: [0, 0, 0],
    roles: [],
    nodes,
    shots: [{ id: 's', start: 0, end: 4, camera: { position: [{ t: 0, v: [0, 1, 6] }], target: { track: [{ t: 0, v: [0, 0.8, 0] }] }, fov: [{ t: 0, v: 40 }] } }],
  }) as PrevisDoc;

const TIMES = [0, 0.4, 0.9, 1.3, 2, 2.6, 3.3];
const WS = 10; // default worldScale: engine units per meter

describe('previs model.groundLock', () => {
  it('keeps the posed walker (walk clip + tracks.joints crouch) on y = 0; without it the feet leave the floor', async () => {
    const scene = drawnScene();
    const player = await loadPrevisPlayer(scene.sdk, doc([walker('on', true), walker('off', false, { position: [2, 0.875, 0] })]), { resolveModel });
    for (const t of TIMES) {
      player.frame(t);
      expect(Math.abs(scene.minWorldY('on'))).toBeLessThan(1e-6);
    }
    player.frame(2);
    // Crouched without the lock: the feet float well above the floor (engine units)
    expect(scene.minWorldY('off')).toBeGreaterThan(0.2 * WS);
  });

  it('exact under rotated and moving pivots and parents (per vertex, not a box)', async () => {
    const scene = drawnScene();
    const d = doc([
      box('carrier', {
        visible: false,
        rotation: [0.25, 0.4, -0.15],
        tracks: { position: [{ t: 0, v: [0, 2, 0] }, { t: 3, v: [1, 3, -1] }], rotation: [{ t: 0, v: [0.25, 0.4, -0.15] }, { t: 3, v: [-0.3, 1.2, 0.35] }] },
      }),
      walker('w', true, {
        parent: 'carrier',
        position: [0.3, 0.5, 0.2],
        tracks: {
          joints: crouch(0.5, 2),
          rotation: [{ t: 0, v: [0.4, 1.0, 0.3] }, { t: 3.3, v: [-0.5, 2.2, -0.6] }],
          size: [{ t: 0, v: [0.7, 1.75, 0.5] }, { t: 3, v: [0.5, 1.2, 0.3] }],
        },
      }),
    ]);
    const player = await loadPrevisPlayer(scene.sdk, d, { resolveModel });
    for (const t of TIMES) {
      player.frame(t);
      expect(Math.abs(scene.minWorldY('w'))).toBeLessThan(1e-6);
    }
  });

  it('skinned (tail.glb, sway clip) and static (mug.glb, no rig) models', async () => {
    const scene = drawnScene();
    const d = doc([
      box('tail', {
        shape: 'model',
        model: { src: 'models/tail.glb', animation: { clip: 'sway' }, groundLock: true },
        position: [0, 3, 0],
        rotation: [0.9, 0.3, 0.5],
        size: [0.2, 1, 0.1],
      }),
      box('mug', { shape: 'model', model: { src: 'models/mug.glb', groundLock: true }, position: [1, -2, 0], rotation: [0.7, 0, 1.1], size: [0.12, 0.1, 0.12] }),
    ]);
    const player = await loadPrevisPlayer(scene.sdk, d, { resolveModel });
    for (const t of TIMES) {
      player.frame(t);
      expect(Math.abs(scene.minWorldY('tail'))).toBeLessThan(1e-6);
      expect(Math.abs(scene.minWorldY('mug'))).toBeLessThan(1e-6);
    }
  });

  it('props on its joints move with it by the same vertical offset; the pivot keeps the authored transform', async () => {
    const make = (lock: boolean) => doc([walker('w', lock, { rotation: [0.2, 1.2, -0.1] }), box('cup', { parent: 'w', parentJoint: 'lowerArm.R', position: [0, -0.3, 0] })]);
    const a = drawnScene();
    const b = drawnScene();
    const pa = await loadPrevisPlayer(a.sdk, make(false), { resolveModel });
    const pb = await loadPrevisPlayer(b.sdk, make(true), { resolveModel });
    for (const t of TIMES) {
      pa.frame(t);
      pb.frame(t);
      const dy = -a.minWorldY('w');
      expect(Math.abs(b.minWorldY('w'))).toBeLessThan(1e-6);
      const cupA = a.worldMatrix(a.idOf('previs:cup'));
      const cupB = b.worldMatrix(b.idOf('previs:cup'));
      // Same rotation, translated by exactly (0, dy, 0)
      for (let i = 0; i < 12; i++) expect(cupB[i]).toBeCloseTo(cupA[i], 9);
      expect(cupB[12]).toBeCloseTo(cupA[12], 6);
      expect(cupB[13] - cupA[13]).toBeCloseTo(dy, 6);
      expect(cupB[14]).toBeCloseTo(cupA[14], 6);
      // The pivot is not moved
      expect(b.worldMatrix(b.idOf('previs:w'))).toEqual(a.worldMatrix(a.idOf('previs:w')));
    }
  });

  it('locks a model hanging from another locked model after its host (re-parented, listed first)', async () => {
    const scene = drawnScene();
    // Re-parenting does not change the build order (static parents): the rider comes first
    const hang = { t: 0, v: { node: 'base', joint: 'lowerArm.L', snap: true } };
    const d = doc([
      walker('rider', true, { position: [0, -1.5, 0], rotation: [0.3, 0, 0.2], tracks: { joints: crouch(0.5, 2), parent: [hang] } }),
      walker('base', true, { rotation: [0.1, 1.4, 0] }),
    ]);
    const player = await loadPrevisPlayer(scene.sdk, d, { resolveModel });
    for (const t of TIMES) {
      player.frame(t);
      expect(Math.abs(scene.minWorldY('base'))).toBeLessThan(1e-6);
      expect(Math.abs(scene.minWorldY('rider'))).toBeLessThan(1e-6);
    }
  });

  it('re-parenting: picking a prop up with a locked, crouched walker does not pop (capture includes the offset)', async () => {
    const scene = drawnScene();
    const d = doc([
      walker('w', true),
      box('crate', {
        position: [0.4, 0.05, 0.3],
        tracks: { parent: [{ t: 2, v: { node: 'w', joint: 'lowerArm.R' } }] },
      }),
    ]);
    const player = await loadPrevisPlayer(scene.sdk, d, { resolveModel });
    const crate = scene.idOf('previs:crate');
    player.frame(1.99);
    const before = scene.worldMatrix(crate);
    expect(before.slice(12, 15).map((v) => v / WS)).toEqual([0.4, 0.05, 0.3].map((v) => expect.closeTo(v, 9)));
    player.frame(2);
    const at = scene.worldMatrix(crate);
    for (let i = 0; i < 16; i++) expect(at[i]).toBeCloseTo(before[i], 5);
    expect(Math.abs(scene.minWorldY('w'))).toBeLessThan(1e-6);
    // Afterwards it follows the hand (moves with the walk clip)
    player.frame(2.4);
    expect(Math.hypot(...[12, 13, 14].map((i) => scene.worldMatrix(crate)[i] - at[i]))).toBeGreaterThan(0.01);
  });

  it('fit stretch with size axes going to 0 (engine scale clamp) stays on the floor', async () => {
    const scene = drawnScene();
    const w = walker('w', true, {
      model: { src: 'models/walker.glb', animation: { clip: 'walk' }, fit: 'stretch', groundLock: true },
      position: [0, 1, 0],
      rotation: [0.5, 0.7, 0.3],
      tracks: {
        joints: crouch(0.5, 2),
        size: [{ t: 0, v: [0.7, 1.75, 0.5] }, { t: 2, v: [0.7, 0, 0.5] }, { t: 3, v: [0, 1.75, 0] }],
      },
    });
    const player = await loadPrevisPlayer(scene.sdk, doc([w]), { resolveModel });
    for (const t of [0, 1, 2, 2.5, 3, 3.3]) {
      player.frame(t);
      expect(Math.abs(scene.minWorldY('w'))).toBeLessThan(1e-5);
    }
  });

  it('tiny sizes (tiny-scale reload) keep readback on the reloaded model and stay on the floor', async () => {
    const scene = drawnScene();
    const loads: { readback?: boolean; scale?: unknown }[] = [];
    const load = scene.sdk.loadGltf.bind(scene.sdk);
    scene.sdk.loadGltf = ((src: Parameters<typeof load>[0], o: Parameters<typeof load>[1] = {}) => (loads.push({ readback: o.readback, scale: o.scale }), load(src, o))) as typeof load;
    const d = doc([
      walker('w', true, { position: [0, 1, 0], rotation: [0.5, 0.7, 0.3], size: [0.002, 0.004, 0.001] }),
      box('t', { shape: 'model', model: { src: 'models/tail.glb', animation: { clip: 'sway' }, groundLock: true }, position: [0, 1, 0], rotation: [0.5, 0.7, 0.3], size: [0.0002, 0.001, 0.0001] }),
    ]);
    const player = await loadPrevisPlayer(scene.sdk, d, { resolveModel });
    expect(loads.length).toBe(4); // first load + reload with the baked scale, per node
    expect(loads.every((l) => l.readback === true)).toBe(true);
    expect(loads.filter((l) => l.scale !== undefined).length).toBe(2);
    for (const t of [3.3, 0, 2, 0.4, 2, 1]) {
      player.frame(t);
      expect(Math.abs(scene.minWorldY('w'))).toBeLessThan(1e-6);
      expect(Math.abs(scene.minWorldY('t'))).toBeLessThan(1e-6);
    }
  });

  it('hidden frames, clip blends and random seeks', async () => {
    const scene = drawnScene();
    const w = walker('w', true, {
      model: { src: 'models/walker.glb', animation: [{ clip: 'walk' }, { clip: 'wave', start: 1, blendIn: 0.5 }], groundLock: true },
      position: [0, 3, 0],
      rotation: [0, 0, 0],
      tracks: { joints: crouch(0.5, 2), visible: [{ t: 0, v: true }, { t: 1, v: false }, { t: 2, v: true }] },
    });
    const player = await loadPrevisPlayer(scene.sdk, doc([w]), { resolveModel });
    // Same doc without the visible track: the always-drawn reference for the hidden frames
    const ref = drawnScene();
    const always = walker('w', true, { ...w, tracks: { joints: crouch(0.5, 2) } });
    const refPlayer = await loadPrevisPlayer(ref.sdk, doc([always]), { resolveModel });
    for (const t of [3, 0.2, 1.2, 1.4, 0, 2.2]) {
      player.frame(t);
      refPlayer.frame(t);
      const hidden = t >= 1 && t < 2;
      // A hidden model is posed but not drawn (the engine keeps its last drawn pose): the lift is still computed
      // from the posed vertices, so its FIT offset equals the always-visible run
      if (!hidden) expect(Math.abs(scene.minWorldY('w'))).toBeLessThan(1e-6);
      expect(Math.abs(ref.minWorldY('w'))).toBeLessThan(1e-6);
      const fit = (s: typeof scene) => s.objects.get(s.idOf('previs:w:fit'))!.position;
      for (let i = 0; i < 3; i++) expect(Math.abs(fit(scene)[i] - fit(ref)[i])).toBeLessThan(1e-6);
    }
    refPlayer.dispose();
    player.dispose();
  });

  it('hand-off of a prop from one locked walker to another does not pop', async () => {
    const scene = drawnScene();
    const W = (id: string, x: number) => walker(id, true, { position: [x, 0.875, 0], rotation: [0, 0.3 * x, 0] });
    const d = doc([
      W('a', 0),
      W('b', 0.6),
      box('cup', {
        position: [0.2, 0.9, 0.2],
        tracks: { parent: [{ t: 1, v: { node: 'a', joint: 'lowerArm.R' } }, { t: 2.5, v: { node: 'b', joint: 'lowerArm.L' } }] },
      }),
    ]);
    const player = await loadPrevisPlayer(scene.sdk, d, { resolveModel });
    const cup = scene.idOf('previs:cup');
    for (const tk of [1, 2.5]) {
      player.frame(tk - 1e-4);
      const before = scene.worldMatrix(cup);
      player.frame(tk);
      const at = scene.worldMatrix(cup);
      // 1e-4 s of motion (walk clip) at most; the offset is in both captures
      expect(Math.hypot(at[12] - before[12], at[13] - before[13], at[14] - before[14])).toBeLessThan(0.05);
    }
    for (const t of [0, 1.5, 3]) {
      player.frame(t);
      expect(Math.abs(scene.minWorldY('a'))).toBeLessThan(1e-6);
      expect(Math.abs(scene.minWorldY('b'))).toBeLessThan(1e-6);
    }
  });

  it('reuses the offset while pose, size and pivot are unchanged (no extra read-back, same result)', async () => {
    const scene = drawnScene();
    // Static rest pose after t = 2 (no clip; joints held), pivot fixed
    const w = walker('w', true, { model: { src: 'models/walker.glb', groundLock: true } });
    const player = await loadPrevisPlayer(scene.sdk, doc([w]), { resolveModel });
    const readBack = vi.spyOn(GltfAnimator.prototype, 'posedMinAlong');
    player.frame(1);
    player.frame(2);
    expect(readBack).toHaveBeenCalledTimes(2);
    const n = scene.calls.length;
    player.frame(2.5);
    player.frame(3);
    expect(readBack).toHaveBeenCalledTimes(2); // pose, k and pivot unchanged: offset reused
    expect(scene.calls.length).toBe(n); // and no FIT / socket call
    expect(Math.abs(scene.minWorldY('w'))).toBeLessThan(1e-6);
    player.frame(1.5); // pose changed again
    expect(readBack).toHaveBeenCalledTimes(3);
    expect(Math.abs(scene.minWorldY('w'))).toBeLessThan(1e-6);
    readBack.mockRestore();
  });

  it('only ground-locked models keep CPU vertices (readback)', async () => {
    const scene = drawnScene();
    const results: object[] = [];
    const load = scene.sdk.loadGltf.bind(scene.sdk);
    scene.sdk.loadGltf = ((...a: Parameters<typeof load>) => load(...a).then((r) => (results.push(r), r))) as typeof load;
    const player = await loadPrevisPlayer(scene.sdk, doc([walker('on', true), walker('off', false, { position: [2, 0.875, 0] })]), { resolveModel });
    expect(results.map((r) => hasGltfGeometry(r)).sort()).toEqual([false, true]);
    player.dispose();
    expect(results.some((r) => hasGltfGeometry(r))).toBe(false);
  });

  it('without groundLock (absent or false) the engine calls are the same, and a static model gets no animator', async () => {
    const run = async (lock: boolean | undefined) => {
      const scene = drawnScene();
      let animators = 0;
      const create = scene.sdk.createGltfAnimator.bind(scene.sdk);
      scene.sdk.createGltfAnimator = ((...args: Parameters<typeof create>) => (animators++, create(...args))) as typeof create;
      const mug = box('mug', { shape: 'model', model: { src: 'models/mug.glb', ...(lock !== undefined ? { groundLock: lock } : {}) }, size: [0.12, 0.1, 0.12] });
      const player = await loadPrevisPlayer(scene.sdk, doc([walker('w', lock), mug]), { resolveModel });
      for (const t of TIMES) player.frame(t);
      return { calls: scene.calls, animators };
    };
    const absent = await run(undefined);
    const off = await run(false);
    expect(off.calls).toEqual(absent.calls);
    expect(absent.animators).toBe(1); // the walker only
    expect((await run(true)).animators).toBe(2);
  });
});
