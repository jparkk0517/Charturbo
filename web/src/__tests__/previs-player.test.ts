import { describe, expect, it } from 'vitest';
import { createPrevisPlayer, eulerYXZToQuat, loadPrevisPlayer, matrixToEulerYXZ, orthonormalFrame, socketTransform } from '../previs/player';
import type { PrevisDoc, PrevisModel, PrevisNode, Vec3 } from '../previs/types';
import type { Charturbo } from '../sdk/charturbo';
import type { GltfDecoders } from '../sdk/scene-gltf';

type Call = [string, ...unknown[]];

/** What the fake `loadGltf` returns for a source (bounds at load scale 1). */
interface FakeModel {
  objects?: number;
  bounds?: { min: Vec3; max: Vec3 };
  animations?: string[];
  /** glTF node names the animator reports (default hips, leftArm, rightArm). */
  nodeNames?: (string | null)[];
  /** Rejects with this instead of loading. */
  error?: Error;
  /** Resolves only after this promise does (abort tests). */
  gate?: Promise<void>;
  /** loadGltf rejects posable names missing from nodeNames, like the real loader. */
  checkPosable?: boolean;
}

interface FakeResult {
  objects: number[];
  textures: number[];
  nodes: unknown[];
  bounds: { min: Vec3; max: Vec3 };
  animations: { name: string; duration: number }[];
  nodeNames: (string | null)[];
  /** Load scale (the fake animator's nodeMatrix applies it). */
  loadScale: number;
}

/** Recording stand-in for the Charturbo methods the player uses. */
function mockSdk(models: Record<string, FakeModel> = {}) {
  const calls: Call[] = [];
  const view = { reject: false };
  let nextId = 100;
  let nextAnimator = 1;
  const theme = { surface: [0.1, 0.1, 0.1, 1], marker: 'theme' };
  /** Posed glTF world (column-major) per joint name for the fake nodeMatrix; identity when absent. Tests mutate it. */
  const worlds: Record<string, number[]> = {};
  const rec =
    (name: string, ret?: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return ret;
    };
  const sdk = {
    getTheme: () => theme,
    setTheme: rec('setTheme'),
    setGraphVisible: rec('setGraphVisible'),
    setRigidPhysics: rec('setRigidPhysics'),
    setHelpers: rec('setHelpers'),
    setShadows: rec('setShadows'),
    setShading: rec('setShading'),
    setLighting: rec('setLighting'),
    addPrimitive: (d: unknown) => {
      const id = nextId++;
      calls.push(['addPrimitive', d, id]);
      return id;
    },
    setObjectTransform: rec('setObjectTransform', true),
    setObjectMaterial: rec('setObjectMaterial', true),
    setCameraPose: rec('setCameraPose'),
    setCameraView: (v: unknown) => {
      calls.push(['setCameraView', v]);
      return !view.reject;
    },
    setCameraFov: rec('setCameraFov'),
    removeObject: rec('removeObject', true),
    setObjectParent: rec('setObjectParent', true),
    loadGltf: async (source: unknown, opts: { signal?: AbortSignal; scale?: number }): Promise<FakeResult> => {
      calls.push(['loadGltf', source, opts]);
      const fm = models[String(source)] ?? {};
      if (fm.gate) await fm.gate;
      if (opts.signal?.aborted) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      if (fm.error) throw fm.error;
      const names = fm.nodeNames ?? ['hips', 'leftArm', 'rightArm'];
      const posable = (opts as { posable?: string[] }).posable;
      if (fm.checkPosable && posable) {
        for (const p of posable) if (!names.includes(p)) throw new Error(`loadGltf: posable node "${p}" not found (nodes: ${names.filter((x) => x !== null).map((x) => `"${x}"`).join(', ')})`);
      }
      const k = opts.scale ?? 1;
      const b = fm.bounds ?? { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
      const objects = Array.from({ length: fm.objects ?? 2 }, () => nextId++);
      return {
        objects,
        textures: [],
        nodes: [],
        bounds: { min: b.min.map((v) => v * k) as Vec3, max: b.max.map((v) => v * k) as Vec3 },
        animations: (fm.animations ?? []).map((name) => ({ name, duration: 1 })),
        nodeNames: names,
        loadScale: k,
      };
    },
    disposeGltf: (r: FakeResult) => {
      calls.push(['disposeGltf', r.objects]);
    },
    createGltfAnimator: (model: FakeResult, opts: unknown) => {
      const a = nextAnimator++;
      calls.push(['createGltfAnimator', model.objects, opts, a]);
      const animator = {
        nodeNames: model.nodeNames,
        setNodeRotations: (rotations: unknown, mode: unknown) => {
          calls.push(['animator.setNodeRotations', a, rotations, mode]);
          return animator;
        },
        setBlend: (entries: unknown) => {
          calls.push(['animator.setBlend', a, entries]);
          return animator;
        },
        setDrawEnabled: (enabled: boolean) => {
          calls.push(['animator.setDrawEnabled', a, enabled]);
          return animator;
        },
        // base x world: the load scale multiplies rows 0..2 (not recorded: read every frame)
        nodeMatrix: (name: string, out?: Float32Array) => {
          if (!model.nodeNames.includes(name)) throw new Error(`GltfAnimator.nodeMatrix: no node named "${name}"`);
          const w = worlds[name] ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
          const target = out ?? new Float32Array(16);
          for (let i = 0; i < 16; i++) target[i] = i % 4 < 3 ? w[i] * model.loadScale : w[i];
          return target;
        },
        dispose: () => {
          calls.push(['animator.dispose', a]);
        },
      };
      return animator;
    },
  };
  const named = (n: string) => calls.filter((c) => c[0] === n);
  return { sdk: sdk as unknown as Charturbo, calls, named, theme, view, worlds };
}

const node = (id: string, extra: Partial<PrevisNode> = {}): PrevisNode => ({
  id,
  shape: 'box',
  color: [1, 0.5, 0.25],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  ...extra,
});

const doc = (nodes: PrevisNode[], extra: Partial<PrevisDoc> = {}): PrevisDoc => ({
  version: 1,
  fps: 24,
  size: { width: 640, height: 360 },
  background: [0.2, 0.3, 0.4],
  roles: [],
  nodes,
  shots: [
    {
      id: 's',
      start: 0,
      end: 4,
      camera: {
        position: [{ t: 0, v: [0, 1, 5] }],
        target: { track: [{ t: 0, v: [0, 1, 0] }] },
        fov: [
          { t: 0, v: 40 },
          { t: 4, v: 60 },
        ],
      },
    },
  ],
  ...extra,
});

interface PrimDesc {
  shape: string;
  name: string;
  position: number[];
  scale: number[];
  color: number[];
  parentId: number | null;
  emissive?: number;
}
const prims = (m: ReturnType<typeof mockSdk>) =>
  m.named('addPrimitive').map((c) => ({ ...(c[1] as PrimDesc), id: c[2] as number }));

describe('createPrevisPlayer setup', () => {
  it('configures the flat look and background', () => {
    const m = mockSdk();
    createPrevisPlayer(m.sdk, doc([node('a')]));
    expect(m.named('setGraphVisible')[0][1]).toBe(false);
    expect(m.named('setRigidPhysics')[0][1]).toBe(false);
    expect(m.named('setHelpers')[0][1]).toEqual({ showGrid: false, showAxes: false });
    expect(m.named('setShadows')[0][1]).toEqual({ enabled: false });
    expect(m.named('setShading')[0][1]).toEqual({
      model: 'pbr',
      toneMapping: 'none',
      exposure: 1,
      environment: { intensity: 0 },
    });
    expect(m.named('setLighting')[0][1]).toEqual({
      ambientIntensity: 0,
      directionalIntensity: 0,
      pointIntensity: 0,
    });
    const theme = m.named('setTheme')[0][1] as { surface: number[]; marker: string };
    expect(theme.surface).toEqual([0.2, 0.3, 0.4, 1]);
    expect(theme.marker).toBe('theme');
  });
});

describe('object creation', () => {
  it('creates parent pivots before children, even if the doc lists the child first', () => {
    const m = mockSdk();
    createPrevisPlayer(
      m.sdk,
      doc([
        node('child', { parent: 'root', position: [1, 2, 3], size: [0.5, 1, 2] }),
        node('root', { position: [10, 0, 0], size: [4, 4, 4] }),
      ]),
    );
    const p = prims(m);
    expect(p.map((d) => d.name)).toEqual([
      'previs:root',
      'previs:root:mesh',
      'previs:child',
      'previs:child:mesh',
    ]);
    const [rootPivot, rootMesh, childPivot, childMesh] = p;
    // pivots: scale 1, alpha 0, local position * worldScale (default 10), parent = parent's pivot
    expect(rootPivot).toMatchObject({ scale: [1, 1, 1], color: [0, 0, 0, 0], position: [100, 0, 0], parentId: null });
    expect(childPivot).toMatchObject({ scale: [1, 1, 1], color: [0, 0, 0, 0], position: [10, 20, 30], parentId: rootPivot.id });
    // meshes: under own pivot, at origin, scale = size * ws, flat opaque color
    expect(rootMesh).toMatchObject({ parentId: rootPivot.id, position: [0, 0, 0], scale: [40, 40, 40], color: [1, 0.5, 0.25, 1], emissive: 1 });
    expect(childMesh).toMatchObject({ parentId: childPivot.id, scale: [5, 10, 20] });
  });

  it('honors doc.worldScale and maps shapes', () => {
    const m = mockSdk();
    createPrevisPlayer(m.sdk, doc([node('a', { shape: 'cylinder', position: [1, 0, 0], size: [2, 2, 2] })], { worldScale: 2 }));
    const [pivot, mesh] = prims(m);
    expect(pivot.position).toEqual([2, 0, 0]);
    expect(mesh.shape).toBe('cylinder');
    expect(mesh.scale).toEqual([4, 4, 4]);
  });

  it('pure pivots (visible:false, no visible=true key) get no mesh; shapes toggled by a track do', () => {
    const m = mockSdk();
    createPrevisPlayer(
      m.sdk,
      doc([
        node('joint', { visible: false }),
        node('blink', {
          visible: false,
          tracks: {
            visible: [
              { t: 0, v: false },
              { t: 1, v: true },
            ],
          },
        }),
      ]),
    );
    const names = prims(m).map((d) => d.name);
    expect(names).toEqual(['previs:joint', 'previs:blink', 'previs:blink:mesh']);
    expect(prims(m)[2].color[3]).toBe(0); // starts hidden
  });
});

describe('frame', () => {
  const animated = () =>
    doc([
      node('a', {
        position: [0, 0, 0],
        size: [1, 1, 1],
        tracks: {
          position: [
            { t: 0, v: [0, 0, 0] },
            { t: 2, v: [2, 0, 0] },
          ],
          size: [
            { t: 0, v: [1, 1, 1] },
            { t: 2, v: [3, 1, 1] },
          ],
          visible: [
            { t: 0, v: true },
            { t: 3, v: false },
          ],
        },
      }),
      node('still', { position: [5, 0, 0] }),
    ]);

  it('applies transforms (x worldScale), camera pose and fov; returns the FrameState', () => {
    const m = mockSdk();
    const p = createPrevisPlayer(m.sdk, animated());
    const ids = prims(m);
    const aPivot = ids[0].id;
    const aMesh = ids[1].id;
    const fs = p.frame(1);
    expect(fs.time).toBe(1);
    expect(m.named('setObjectTransform')).toEqual([
      ['setObjectTransform', aPivot, { position: [10, 0, 0], rotation: [0, 0, 0] }],
      ['setObjectTransform', aMesh, { scale: [20, 10, 10] }],
    ]);
    expect(m.named('setCameraView')).toEqual([['setCameraView', { eye: [0, 10, 50], target: [0, 10, 0], up: [0, 1, 0], roll: 0 }]]);
    expect(m.named('setCameraPose')).toEqual([]);
    expect(m.named('setCameraFov')).toEqual([['setCameraFov', 45]]);
  });

  it('skips unchanged values on repeated frames', () => {
    const m = mockSdk();
    const p = createPrevisPlayer(m.sdk, animated());
    p.frame(1);
    const before = m.calls.length;
    p.frame(1);
    expect(m.calls.length).toBe(before);
    // the static node and the constant camera pose never trigger calls again; only a, fov change
    p.frame(2);
    const later = m.calls.slice(before).map((c) => c[0]);
    expect(later).toEqual(['setObjectTransform', 'setObjectTransform', 'setCameraFov']);
  });

  it('passes roll and exact scaled values (no clamping), calls again only on change', () => {
    const m = mockSdk();
    const d = doc([], {
      worldScale: 10,
      shots: [
        {
          id: 's',
          start: 0,
          end: 4,
          camera: {
            position: [{ t: 0, v: [0, 0.1, 0.2] }],
            target: { track: [{ t: 0, v: [0, 0.1, 0] }] },
            roll: [
              { t: 0, v: 0 },
              { t: 2, v: 1 },
            ],
          },
        },
      ],
    });
    const p = createPrevisPlayer(m.sdk, d);
    p.frame(0);
    expect(m.named('setCameraView')).toEqual([['setCameraView', { eye: [0, 1, 2], target: [0, 1, 0], up: [0, 1, 0], roll: 0 }]]);
    p.frame(0);
    expect(m.named('setCameraView').length).toBe(1);
    p.frame(1);
    expect(m.named('setCameraView')[1]).toEqual(['setCameraView', { eye: [0, 1, 2], target: [0, 1, 0], up: [0, 1, 0], roll: 0.5 }]);
    p.frame(1);
    expect(m.named('setCameraView').length).toBe(2);
  });

  it('passes camera.up and re-sends when only up changes', () => {
    const m = mockSdk();
    const d = doc([], {
      shots: [
        {
          id: 's',
          start: 0,
          end: 4,
          camera: {
            position: [{ t: 0, v: [0, 5, 1] }],
            target: { track: [{ t: 0, v: [0, 0, 0] }] },
            up: [
              { t: 0, v: [0, 1, 0] },
              { t: 2, v: [0, 0, -1] },
            ],
          },
        },
      ],
    });
    const p = createPrevisPlayer(m.sdk, d);
    p.frame(0);
    p.frame(0);
    expect(m.named('setCameraView').length).toBe(1);
    p.frame(2);
    expect(m.named('setCameraView').length).toBe(2);
    expect((m.named('setCameraView')[1][1] as { up: number[] }).up).toEqual([0, 0, -1]);
  });

  it('keeps the previous camera and does not throw when setCameraView returns false', () => {
    const m = mockSdk();
    const d = doc([], {
      shots: [
        {
          id: 's',
          start: 0,
          end: 4,
          camera: {
            position: [
              { t: 0, v: [0, 0, 5] },
              { t: 4, v: [0, 0, 1] },
            ],
            target: { track: [{ t: 0, v: [0, 0, 0] }] },
          },
        },
      ],
    });
    const p = createPrevisPlayer(m.sdk, d);
    p.frame(0);
    m.view.reject = true;
    expect(() => p.frame(1)).not.toThrow();
    m.view.reject = false;
    p.frame(1); // not recorded as applied while rejected: sent again
    expect(m.named('setCameraView').length).toBe(3);
    p.frame(1);
    expect(m.named('setCameraView').length).toBe(3);
  });

  it('hides the mesh through color alpha 0 when the visible track turns false', () => {
    const m = mockSdk();
    const p = createPrevisPlayer(m.sdk, animated());
    const meshId = prims(m)[1].id;
    p.frame(2);
    expect(m.named('setObjectMaterial')).toEqual([]);
    p.frame(3);
    expect(m.named('setObjectMaterial')).toEqual([['setObjectMaterial', meshId, { color: [1, 0.5, 0.25, 0] }]]);
  });
});

describe('dispose', () => {
  it('removes every created object, children before parents, and restores the theme once', () => {
    const m = mockSdk();
    const p = createPrevisPlayer(m.sdk, doc([node('a'), node('b', { parent: 'a' })]));
    const ids = prims(m).map((d) => d.id); // a, a:mesh, b, b:mesh
    p.dispose();
    p.dispose();
    expect(m.named('removeObject').map((c) => c[1])).toEqual([...ids].reverse());
    const themes = m.named('setTheme');
    expect(themes).toHaveLength(2);
    expect(themes[1][1]).toBe(m.theme);
  });
});

// ---------------------------------------------------------------------------
// Model nodes (loadPrevisPlayer)

const modelNode = (id: string, model: PrevisModel, extra: Partial<PrevisNode> = {}): PrevisNode =>
  node(id, { shape: 'model', model, ...extra });

const FLAT = {
  emissive: 1,
  metallic: 0,
  roughness: 1,
  map: null,
  alphaTest: 0,
  metallicRoughnessMap: null,
  normalMap: null,
  aoMap: null,
  emissiveMap: null,
  emissiveColor: [0, 0, 0],
};

/** [object, parent] of every setObjectParent call (the loader objects of the kept loads). */
const parentCalls = (m: ReturnType<typeof mockSdk>) => m.named('setObjectParent').map((c) => [c[1], c[2]]);
const fitOf = (m: ReturnType<typeof mockSdk>, id: string) => prims(m).find((p) => p.name === `previs:${id}:fit`)!;

describe('createPrevisPlayer with model nodes', () => {
  it('throws and touches nothing', () => {
    const m = mockSdk();
    expect(() => createPrevisPlayer(m.sdk, doc([node('a'), modelNode('cup', { src: 'cup.glb' })]))).toThrow(
      'createPrevisPlayer: doc has model nodes, use loadPrevisPlayer',
    );
    expect(m.calls).toEqual([]);
  });
});

describe('loadPrevisPlayer', () => {
  it('matches createPrevisPlayer for docs without model nodes', async () => {
    const d = doc([node('a', { tracks: { position: [{ t: 0, v: [0, 0, 0] }, { t: 2, v: [2, 0, 0] }] } }), node('b', { parent: 'a' })]);
    const m1 = mockSdk();
    const p1 = createPrevisPlayer(m1.sdk, d);
    const m2 = mockSdk();
    const p2 = await loadPrevisPlayer(m2.sdk, d);
    expect(m2.calls).toEqual(m1.calls);
    for (const t of [0, 1, 1, 3]) expect(p2.frame(t)).toEqual(p1.frame(t));
    p1.dispose();
    p2.dispose();
    expect(m2.calls).toEqual(m1.calls);
  });

  it('builds pivot -> FIT -> loader objects, children hang from the pivot, flat material on every object', async () => {
    const m = mockSdk({ 'cup.glb': { objects: 3 } });
    await loadPrevisPlayer(
      m.sdk,
      doc([
        node('table', { position: [1, 0, 0] }),
        modelNode('cup', { src: 'cup.glb' }, { parent: 'table', position: [0, 1, 0], color: [0.1, 0.2, 0.3] }),
        node('lid', { parent: 'cup', position: [0, 0.5, 0] }),
      ]),
    );
    const p = prims(m);
    expect(p.map((d) => d.name)).toEqual([
      'previs:table',
      'previs:table:mesh',
      'previs:cup',
      'previs:lid',
      'previs:lid:mesh',
      'previs:cup:fit',
    ]);
    const cupPivot = p[2];
    const lidPivot = p[3];
    const fit = p[5];
    expect(cupPivot).toMatchObject({ parentId: p[0].id, scale: [1, 1, 1], color: [0, 0, 0, 0], position: [0, 10, 0] });
    expect(lidPivot.parentId).toBe(cupPivot.id); // never under the scaled FIT
    expect(fit).toMatchObject({ parentId: cupPivot.id, color: [0, 0, 0, 0] });
    // loadGltf: no position / rotation (local transform stays identity after re-parenting)
    const [, src, opts] = m.named('loadGltf')[0];
    expect(src).toBe('cup.glb');
    expect(opts).not.toHaveProperty('position');
    expect(opts).not.toHaveProperty('rotation');
    expect(opts).not.toHaveProperty('scale');
    expect(opts).toMatchObject({ animations: false });
    const objs = parentCalls(m).map((c) => c[0]);
    expect(objs).toHaveLength(3);
    expect(parentCalls(m)).toEqual(objs.map((id) => [id, fit.id]));
    expect(m.named('setObjectMaterial')).toEqual(objs.map((id) => ['setObjectMaterial', id, { ...FLAT, color: [0.1, 0.2, 0.3, 1] }]));
  });

  it("'contain' scales uniformly by the tightest axis and centers the bounds on the node origin", async () => {
    const m = mockSdk({ 'm.glb': { bounds: { min: [-1, 0, -0.5], max: [1, 4, 0.5] } } }); // extent [2,4,1], center [0,2,0]
    await loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'm.glb' }, { size: [1, 1, 1] })]));
    expect(fitOf(m, 'a').scale).toEqual([2.5, 2.5, 2.5]); // min(10/2, 10/4, 10/1)
    expect(fitOf(m, 'a').position).toEqual([-0, -5, -0]); // -k * center
  });

  it("'stretch' scales per axis; a zero-extent axis takes the contain factor", async () => {
    const m = mockSdk({
      'm.glb': { bounds: { min: [-1, 0, -0.5], max: [1, 4, 0.5] } },
      'flat.glb': { bounds: { min: [-1, 0.3, -2], max: [3, 0.3, 2] } }, // extent [4,0,4], center [1,0.3,0]
    });
    await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode('a', { src: 'm.glb', fit: 'stretch' }, { size: [1, 1, 1] }),
        modelNode('f', { src: 'flat.glb', fit: 'stretch' }, { size: [2, 1, 1] }),
      ]),
    );
    expect(fitOf(m, 'a').scale).toEqual([5, 2.5, 10]);
    expect(fitOf(m, 'a').position).toEqual([-0, -5, -0]);
    // f: x 20/4 = 5, z 10/4 = 2.5, flat y -> contain min(5, 2.5) = 2.5
    expect(fitOf(m, 'f').scale).toEqual([5, 2.5, 2.5]);
    expect(fitOf(m, 'f').position).toEqual([-5, -0.75, -0]);
  });

  it('bakes the scale into the vertices when the fit factor is below the 0.05 object scale clamp (mm units)', async () => {
    // a 1 m x 2 m x 0.5 m object authored in millimeters
    const bounds = { min: [-500, 0, -250] as Vec3, max: [500, 2000, 250] as Vec3 };
    const m = mockSdk({ 'mm.glb': { bounds } });
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode(
          'a',
          { src: 'mm.glb' },
          {
            size: [1, 2, 0.5],
            tracks: {
              size: [
                { t: 0, v: [1, 2, 0.5] },
                { t: 2, v: [0.5, 1, 0.25] },
              ],
            },
          },
        ),
      ]),
    );
    const loads = m.named('loadGltf');
    expect(loads).toHaveLength(2);
    // the smallest factor any axis needs: size key 0.5 m * 10 / 1000 = 0.005
    expect((loads[1][2] as { scale: number }).scale).toBeCloseTo(0.005, 12);
    // the first load is freed before the second is used
    const firstObjects = m.named('disposeGltf')[0][1] as number[];
    const kept = parentCalls(m).map((c) => c[0] as number);
    expect(kept.some((id) => firstObjects.includes(id))).toBe(false);
    // rest: world extent = FIT scale * baked extent = size * worldScale, every factor >= 1 (no clamp)
    const fit = fitOf(m, 'a');
    const baked = [1000, 2000, 500].map((e) => e * 0.005);
    fit.scale.forEach((k) => expect(k).toBeGreaterThanOrEqual(1));
    expect(fit.scale.map((k, i) => k * baked[i])).toEqual([10, 20, 5].map((v) => expect.closeTo(v, 9)));
    expect(fit.position[1]).toBeCloseTo(-10, 9); // center y 1000 mm baked -> 5, * k 2
    // end of the track: still exact and >= 1
    p.frame(2);
    const last = m.named('setObjectTransform').filter((c) => c[1] === fit.id).at(-1)![2] as { scale: number[] };
    last.scale.forEach((k) => expect(k).toBeGreaterThanOrEqual(1 - 1e-12));
    expect(last.scale.map((k, i) => k * baked[i])).toEqual([5, 10, 2.5].map((v) => expect.closeTo(v, 9)));
  });

  it('forwards options.decoders to every loadGltf call, including the tiny-scale reload', async () => {
    const m = mockSdk({ 'mm.glb': { bounds: { min: [0, 0, 0], max: [1000, 1000, 1000] } }, 'big.glb': {} });
    const decoders = { meshopt: { ready: Promise.resolve() } } as unknown as GltfDecoders;
    await loadPrevisPlayer(
      m.sdk,
      doc([modelNode('a', { src: 'mm.glb' }, { size: [0.5, 0.5, 0.5] }), modelNode('b', { src: 'big.glb' })]),
      { decoders },
    );
    const loads = m.named('loadGltf');
    expect(loads.length).toBe(3); // a (scale 1), a (reload), b
    for (const l of loads) expect((l[2] as { decoders?: unknown }).decoders).toBe(decoders);
    // omitted when not given
    const m2 = mockSdk();
    await loadPrevisPlayer(m2.sdk, doc([modelNode('a', { src: 'x.glb' })]));
    expect('decoders' in (m2.named('loadGltf')[0][2] as object)).toBe(false);
  });

  it('does not reload models whose factor is above the clamp', async () => {
    const m = mockSdk({ 'big.glb': { bounds: { min: [0, 0, 0], max: [100, 100, 100] } } }); // k = 10/100 = 0.1
    await loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'big.glb' })]));
    expect(m.named('loadGltf')).toHaveLength(1);
    expect(m.named('disposeGltf')).toEqual([]);
    expect(fitOf(m, 'a').scale).toEqual([0.1, 0.1, 0.1]);
    expect(fitOf(m, 'a').position).toEqual([-5, -5, -5]);
  });

  it('a size track rescales and re-centers the FIT (skipping unchanged frames); position tracks move the pivot', async () => {
    const m = mockSdk({ 'm.glb': { bounds: { min: [-1, 0, -1], max: [1, 2, 1] } } }); // extent 2, center [0,1,0]
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode(
          'a',
          { src: 'm.glb' },
          {
            tracks: {
              position: [
                { t: 0, v: [0, 0, 0] },
                { t: 2, v: [2, 0, 0] },
              ],
              size: [
                { t: 0, v: [1, 1, 1] },
                { t: 2, v: [3, 3, 3] },
              ],
            },
          },
        ),
      ]),
    );
    const pivot = prims(m)[0].id;
    const fit = fitOf(m, 'a');
    expect(fit.scale).toEqual([5, 5, 5]);
    p.frame(0);
    expect(m.named('setObjectTransform')).toEqual([]);
    p.frame(1);
    expect(m.named('setObjectTransform')).toEqual([
      ['setObjectTransform', pivot, { position: [10, 0, 0], rotation: [0, 0, 0] }],
      ['setObjectTransform', fit.id, { position: [-0, -10, -0], scale: [10, 10, 10] }],
    ]);
    const n = m.calls.length;
    p.frame(1);
    expect(m.calls.length).toBe(n);
  });

  it('a visible track toggles color alpha on every loader object', async () => {
    const m = mockSdk({ 'm.glb': { objects: 2 } });
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode(
          'a',
          { src: 'm.glb' },
          {
            visible: false,
            tracks: {
              visible: [
                { t: 0, v: false },
                { t: 1, v: true },
                { t: 2, v: false },
              ],
            },
          },
        ),
      ]),
    );
    const objs = parentCalls(m).map((c) => c[0]);
    expect(m.named('setObjectMaterial').map((c) => (c[2] as { color: number[] }).color[3])).toEqual([0, 0]);
    const before = m.named('setObjectMaterial').length;
    p.frame(0.5);
    expect(m.named('setObjectMaterial').length).toBe(before);
    p.frame(1);
    p.frame(2);
    expect(m.named('setObjectMaterial').slice(before)).toEqual([
      ['setObjectMaterial', objs[0], { color: [1, 0.5, 0.25, 1] }],
      ['setObjectMaterial', objs[1], { color: [1, 0.5, 0.25, 1] }],
      ['setObjectMaterial', objs[0], { color: [1, 0.5, 0.25, 0] }],
      ['setObjectMaterial', objs[1], { color: [1, 0.5, 0.25, 0] }],
    ]);
  });

  it('does not load pure pivot model nodes', async () => {
    const m = mockSdk();
    await loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'm.glb' }, { visible: false })]));
    expect(m.named('loadGltf')).toEqual([]);
    expect(prims(m).map((d) => d.name)).toEqual(['previs:a']);
  });

  const blends = (m: ReturnType<typeof mockSdk>) => m.named('animator.setBlend').map((c) => c[2]);

  it('object form: one weight-1 entry, setBlend only when the clip time changes', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle', 'walk'] } });
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([modelNode('a', { src: 'w.glb', animation: { clip: 'walk', start: 1, speed: 2, loop: 'pingpong' } })]),
    );
    expect(m.named('loadGltf')[0][2]).toMatchObject({ animations: true });
    expect(m.named('createGltfAnimator')[0][2]).toEqual({ autoUpdate: false });
    const e = (time: number) => [{ clip: 'walk', time, weight: 1, loop: 'pingpong' }];
    expect(blends(m)).toEqual([e(0)]); // initial pose
    p.frame(0);
    p.frame(1);
    expect(blends(m)).toEqual([e(0)]);
    p.frame(1.5);
    p.frame(1.5);
    p.frame(3);
    p.frame(0.5);
    expect(blends(m)).toEqual([e(0), e(1), e(4), e(0)]);
  });

  it('accepts a clip index and defaults loop to repeat', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle', 'walk'] } });
    const p = await loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'w.glb', animation: { clip: 1 } })]));
    p.frame(2.5);
    expect(blends(m)).toEqual([[{ clip: 1, time: 0, weight: 1, loop: 'repeat' }], [{ clip: 1, time: 2.5, weight: 1, loop: 'repeat' }]]);
  });

  it('array segments: hard cut switches the clip, loop defaults per segment', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle', 'walk'] } });
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([modelNode('a', { src: 'w.glb', animation: [{ clip: 'idle', loop: 'once' }, { clip: 'walk', start: 2 }] })]),
    );
    p.frame(1);
    p.frame(2.5);
    expect(blends(m)).toEqual([
      [{ clip: 'idle', time: 0, weight: 1, loop: 'once' }],
      [{ clip: 'idle', time: 1, weight: 1, loop: 'once' }],
      [{ clip: 'walk', time: 0.5, weight: 1, loop: 'repeat' }],
    ]);
  });

  it('cross-fade sends previous segment first with both weights', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle', 'walk'] } });
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([modelNode('a', { src: 'w.glb', animation: [{ clip: 'idle' }, { clip: 'walk', start: 2, blendIn: 1 }] })]),
    );
    p.frame(2.5);
    expect(blends(m).at(-1)).toEqual([
      { clip: 'idle', time: 2.5, weight: 0.5, loop: 'repeat' },
      { clip: 'walk', time: 0.5, weight: 0.5, loop: 'repeat' },
    ]);
    p.frame(3.5); // fade finished: single entry
    expect(blends(m).at(-1)).toEqual([{ clip: 'walk', time: 1.5, weight: 1, loop: 'repeat' }]);
  });

  it('does not call setBlend again when clips are unchanged', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle'] } });
    const p = await loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'w.glb', animation: { clip: 'idle', start: 5 } })]));
    p.frame(0);
    p.frame(1);
    p.frame(4);
    expect(blends(m)).toHaveLength(1);
  });

  describe('joints', () => {
    const j = (...keys: [number, Vec3][]) => keys.map(([t, v]) => ({ t, v }));
    const rots = (m: ReturnType<typeof mockSdk>) => m.named('animator.setNodeRotations').map((c) => c[2] as { node: string; rotation: number[] }[]);
    const sends = (m: ReturnType<typeof mockSdk>) => m.calls.filter((c) => c[0] === 'animator.setNodeRotations' || c[0] === 'animator.setBlend');
    const close = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
    const S = Math.SQRT1_2;

    it('forwards posable to every load (also the tiny-scale reload) and creates an animator for joints only', async () => {
      const m = mockSdk({ 'mm.glb': { bounds: { min: [-500, -500, -500], max: [500, 500, 500] } } });
      await loadPrevisPlayer(
        m.sdk,
        doc([modelNode('a', { src: 'mm.glb' }, { size: [1, 1, 1], tracks: { joints: { leftArm: j([0, [0, 0, 0]]), hips: j([0, [0, 0, 0]]) } } })]),
      );
      const loads = m.named('loadGltf');
      expect(loads).toHaveLength(2);
      for (const l of loads) expect(l[2]).toMatchObject({ posable: ['leftArm', 'hips'], animations: false });
      expect(m.named('createGltfAnimator')).toHaveLength(1);
      expect(m.named('animator.setBlend')).toEqual([]);
    });

    it('no posable option and no animator without joints and animation', async () => {
      const m = mockSdk();
      await loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'w.glb' })]));
      expect('posable' in (m.named('loadGltf')[0][2] as object)).toBe(false);
      expect(m.named('createGltfAnimator')).toEqual([]);
    });

    it('sends additive quaternions of the Euler YXZ values (hand computed)', async () => {
      const m = mockSdk();
      const p = await loadPrevisPlayer(
        m.sdk,
        doc([
          modelNode('a', { src: 'w.glb' }, {
            tracks: {
              joints: {
                leftArm: j([0, [0, 0, 0]], [1, [Math.PI / 2, 0, 0]], [2, [Math.PI / 2, Math.PI / 2, 0]], [3, [Math.PI / 2, 0, Math.PI / 2]]),
                hips: j([0, [0, Math.PI, 0]]),
              },
            },
          }),
        ]),
      );
      // initial offsets (frame 0): identity and ry = pi -> (0, 1, 0, 0)
      const r0 = rots(m)[0];
      expect(r0.map((e) => e.node)).toEqual(['leftArm', 'hips']);
      expect(m.named('animator.setNodeRotations')[0][3]).toBe('additive');
      close(r0[0].rotation, [0, 0, 0, 1]);
      close(r0[1].rotation, [0, 1, 0, 0]);
      p.frame(1); // rx = 90 deg
      close(rots(m)[1][0].rotation, [S, 0, 0, S]);
      p.frame(2); // YXZ: qY * qX = (c sx, s cx, -s sx, c cx) with both 45 deg half angles -> (0.5, 0.5, -0.5, 0.5)
      close(rots(m)[2][0].rotation, [0.5, 0.5, -0.5, 0.5]);
      p.frame(3); // qX * qZ (ry = 0) = (sx cz, -sx sz, cx sz, cx cz) -> (0.5, -0.5, 0.5, 0.5)
      close(rots(m)[3][0].rotation, [0.5, -0.5, 0.5, 0.5]);
    });

    it('calls setNodeRotations only when a joint value changed', async () => {
      const m = mockSdk();
      const p = await loadPrevisPlayer(
        m.sdk,
        doc([modelNode('a', { src: 'w.glb' }, { tracks: { joints: { leftArm: j([0, [0, 0, 0]], [1, [1, 0, 0]]) } } })]),
      );
      expect(rots(m)).toHaveLength(1); // initial
      p.frame(0);
      p.frame(0);
      expect(rots(m)).toHaveLength(1);
      p.frame(0.5);
      p.frame(0.5);
      expect(rots(m)).toHaveLength(2);
      p.frame(1);
      p.frame(2);
      p.frame(3);
      expect(rots(m)).toHaveLength(3); // held after the last key
    });

    it('with clip segments: one pose send per frame unless both change', async () => {
      const m = mockSdk({ 'w.glb': { animations: ['idle', 'walk'] } });
      const d = doc([
        modelNode('a', { src: 'w.glb', animation: [{ clip: 'idle' }, { clip: 'walk', start: 2, blendIn: 1 }] }, {
          tracks: { joints: { leftArm: j([0, [0, 0, 0]], [1, [1, 0, 0]], [1.5, [1, 0, 0]]) } },
        }),
      ]);
      const p = await loadPrevisPlayer(m.sdk, d);
      const per = (t: number) => {
        const before = sends(m).length;
        p.frame(t);
        return sends(m).length - before;
      };
      expect(sends(m)).toHaveLength(2); // initial joints + initial clip
      expect(per(0)).toBe(0);
      expect(per(0.5)).toBe(2); // joint moves AND idle time moves: setBlend + setNodeRotations
      expect(per(0.5)).toBe(0);
      expect(per(1.5)).toBe(2); // joint reaches its held value, clip time moves
      expect(per(1.7)).toBe(1); // joints held (>= 1.5), clip time moves: setBlend only
    });

    it('joints only change: no setBlend', async () => {
      const m = mockSdk({ 'w.glb': { animations: ['idle'] } });
      const p = await loadPrevisPlayer(
        m.sdk,
        doc([modelNode('a', { src: 'w.glb', animation: { clip: 'idle', start: 9 } }, { tracks: { joints: { leftArm: j([0, [0, 0, 0]], [1, [1, 0, 0]]) } } })]),
      );
      const blendsBefore = m.named('animator.setBlend').length;
      p.frame(0.5);
      expect(m.named('animator.setBlend')).toHaveLength(blendsBefore);
      expect(rots(m)).toHaveLength(2);
    });

    it('rejects an unknown joint listing the model joints, and cleans up', async () => {
      const m = mockSdk({ 'w.glb': { nodeNames: ['hips', null, 'head'] } });
      const d = doc([modelNode('cup', { src: 'w.glb' }, { tracks: { joints: { elbow: j([0, [0, 0, 0]]) } } })]);
      await expect(loadPrevisPlayer(m.sdk, d)).rejects.toThrow(
        'loadPrevisPlayer: node "cup" (w.glb): unknown joint "elbow" (joints: "hips", "head")',
      );
      expect(m.named('disposeGltf')).toHaveLength(1);
      expect(m.named('removeObject').map((c) => c[1])).toEqual(prims(m).map((x) => x.id).reverse());
      expect(m.named('setTheme').at(-1)![1]).toBe(m.theme);
    });
  });

  it('rejects an unknown clip in a later segment and cleans up', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle', 'walk'] } });
    const d = doc([modelNode('cup', { src: 'w.glb', animation: [{ clip: 'idle' }, { clip: 'jump', start: 1 }] })]);
    await expect(loadPrevisPlayer(m.sdk, d)).rejects.toThrow(
      'loadPrevisPlayer: node "cup" (w.glb): unknown animation clip "jump" (available: 0 "idle", 1 "walk")',
    );
    expectCleanedUp(m, 1);
    expect(m.named('createGltfAnimator')).toEqual([]);
  });

  it('resolves each src once and loads it per node', async () => {
    const m = mockSdk();
    const seen: string[] = [];
    await loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'cup.glb' }), modelNode('b', { src: 'cup.glb' })]), {
      resolveModel: async (src) => {
        seen.push(src);
        return `https://cdn/${src}`;
      },
    });
    expect(seen).toEqual(['cup.glb']);
    expect(m.named('loadGltf').map((c) => c[1])).toEqual(['https://cdn/cup.glb', 'https://cdn/cup.glb']);
    expect(prims(m).filter((d) => d.name.endsWith(':fit'))).toHaveLength(2);
  });

  /** Everything created was removed (models disposed first) and the theme restored. */
  function expectCleanedUp(m: ReturnType<typeof mockSdk>, disposedModels: number) {
    expect(m.named('disposeGltf')).toHaveLength(disposedModels);
    expect(m.named('removeObject').map((c) => c[1])).toEqual(prims(m).map((d) => d.id).reverse());
    const themes = m.named('setTheme');
    expect(themes.at(-1)![1]).toBe(m.theme);
    const firstRemove = m.calls.findIndex((c) => c[0] === 'removeObject');
    m.calls.forEach((c, i) => {
      if (c[0] === 'disposeGltf') expect(i).toBeLessThan(firstRemove);
    });
  }

  it('rejects an unknown clip, listing the available clips, and cleans up', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle', 'walk'] }, 'ok.glb': {} });
    const d = doc([modelNode('ok', { src: 'ok.glb' }), modelNode('cup', { src: 'w.glb', animation: { clip: 'jump' } })]);
    await expect(loadPrevisPlayer(m.sdk, d)).rejects.toThrow(
      'loadPrevisPlayer: node "cup" (w.glb): unknown animation clip "jump" (available: 0 "idle", 1 "walk")',
    );
    expectCleanedUp(m, 2);
    expect(m.named('createGltfAnimator')).toEqual([]);
  });

  it('rejects an out-of-range clip index', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['idle'] } });
    await expect(loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'w.glb', animation: { clip: 1 } })]))).rejects.toThrow(
      'loadPrevisPlayer: node "a" (w.glb): unknown animation clip 1 (available: 0 "idle")',
    );
    expectCleanedUp(m, 1);
  });

  it('rejects a failed load naming the node and src, and frees the other models', async () => {
    const cause = new Error('loadGltf: HTTP 404');
    const m = mockSdk({ 'bad.glb': { error: cause } });
    const d = doc([modelNode('good', { src: 'good.glb' }), node('box'), modelNode('cup', { src: 'bad.glb' })]);
    const err = await loadPrevisPlayer(m.sdk, d).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('loadPrevisPlayer: node "cup" (bad.glb): loadGltf: HTTP 404');
    expect((err as Error).cause).toBe(cause);
    expectCleanedUp(m, 1);
  });

  it('rejects a model without triangle meshes', async () => {
    const m = mockSdk({ 'empty.glb': { objects: 0 } });
    await expect(loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'empty.glb' })]))).rejects.toThrow(
      'loadPrevisPlayer: node "a" (empty.glb): the model has no triangle meshes',
    );
    expectCleanedUp(m, 1);
  });

  it('a failed resolveModel rejects the same way', async () => {
    const m = mockSdk();
    const d = doc([modelNode('a', { src: 'x.glb' })]);
    await expect(
      loadPrevisPlayer(m.sdk, d, {
        resolveModel: () => {
          throw new Error('not in the asset bundle');
        },
      }),
    ).rejects.toThrow('loadPrevisPlayer: node "a" (x.glb): not in the asset bundle');
    expectCleanedUp(m, 0);
  });

  it('aborting mid-load rejects and cleans up', async () => {
    let open!: () => void;
    const gate = new Promise<void>((r) => (open = r));
    const m = mockSdk({ 'slow.glb': { gate } });
    const ctl = new AbortController();
    const d = doc([modelNode('fast', { src: 'fast.glb' }), modelNode('slow', { src: 'slow.glb' })]);
    const pending = loadPrevisPlayer(m.sdk, d, { signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 0)); // fast.glb is loaded, slow.glb waits on the gate
    expect(m.named('loadGltf')).toHaveLength(2);
    ctl.abort();
    open();
    await expect(pending).rejects.toThrow(/^loadPrevisPlayer: node "slow" \(slow\.glb\): /);
    expectCleanedUp(m, 1);
  });

  it('an already aborted signal rejects before touching the scene', async () => {
    const m = mockSdk();
    const ctl = new AbortController();
    ctl.abort(new Error('user cancelled'));
    await expect(loadPrevisPlayer(m.sdk, doc([modelNode('a', { src: 'a.glb' })]), { signal: ctl.signal })).rejects.toThrow(
      'loadPrevisPlayer: user cancelled',
    );
    expect(m.calls).toEqual([]);
  });

  it('dispose frees every model before removing the objects, and restores the theme once', async () => {
    const m = mockSdk({ 'w.glb': { animations: ['walk'] } });
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([node('root'), modelNode('a', { src: 'w.glb', animation: { clip: 'walk' } }, { parent: 'root' }), modelNode('b', { src: 'b.glb' })]),
    );
    p.dispose();
    p.dispose();
    expectCleanedUp(m, 2);
    expect(m.named('setTheme')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Sockets (parentJoint)

/** Row-major 3x3 products / rotations, independent of the player code. */
const mul3 = (a: number[], b: number[]): number[] =>
  [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]));
const rx3 = (t: number) => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const ry3 = (t: number) => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const rz3 = (t: number) => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
/** R = Ry * Rx * Rz (engine YXZ). */
const euler3 = (e: Vec3) => mul3(ry3(e[1]), mul3(rx3(e[0]), rz3(e[2])));
/** Column-major 4x4 of row-major R (times s) and translation t. */
const colMajor = (r: number[], t: Vec3, s = 1): number[] => [
  r[0] * s, r[3] * s, r[6] * s, 0,
  r[1] * s, r[4] * s, r[7] * s, 0,
  r[2] * s, r[5] * s, r[8] * s, 0,
  t[0], t[1], t[2], 1,
];
const closeArr = (a: number[], b: number[], digits = 9) => {
  expect(a).toHaveLength(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
};

describe('matrixToEulerYXZ', () => {
  it('uses the same convention as eulerYXZToQuat (R = Ry Rx Rz)', () => {
    const e: Vec3 = [0.4, -1.2, 2.1];
    const [x, y, z, w] = eulerYXZToQuat(e);
    const fromQuat = [
      1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
      2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
      2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
    ];
    closeArr(fromQuat, euler3(e), 12);
    closeArr(matrixToEulerYXZ(euler3(e)), e, 12);
  });

  it('round-trips rotations, including gimbal lock and its neighborhood', () => {
    const H = Math.PI / 2;
    const cases: Vec3[] = [
      [0, 0, 0],
      [0.3, -0.7, 1.1],
      [-1.4, 3.0, -2.9],
      [1.2, 0.1, -0.4],
      [H, 0.5, 0.2],
      [-H, -2.0, 1.0],
      [H - 1e-7, 0.8, -0.3],
      [-H + 1e-10, 1.3, 0.6],
      [H - 1e-12, -0.2, 0.9],
    ];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 * Math.PI - Math.PI;
    for (let i = 0; i < 200; i++) cases.push([rnd() / 2, rnd(), rnd()]);
    for (const e of cases) {
      const r = euler3(e);
      const back = matrixToEulerYXZ(r);
      closeArr(euler3(back), r, 9);
      expect(Math.abs(back[0])).toBeLessThanOrEqual(H + 1e-15);
    }
    // exact gimbal lock: z = 0 and y carries y - z (x = +90) or y + z (x = -90)
    const up = matrixToEulerYXZ(euler3([H, 0.5, 0.2]));
    closeArr(up, [H, 0.3, 0], 12);
    const down = matrixToEulerYXZ(euler3([-H, 0.5, 0.2]));
    closeArr(down, [-H, 0.7, 0], 12);
  });
});

describe('socketTransform / orthonormalFrame', () => {
  it('removes per-axis joint scale and uniform k exactly', () => {
    const e: Vec3 = [0.3, -0.7, 1.1];
    const r = euler3(e);
    const scaledCols = mul3(r, [2, 0, 0, 0, 3, 0, 0, 0, 0.5]);
    const mat = colMajor(scaledCols, [1, 2, 3]);
    const t = socketTransform(mat, [4, 4, 4], [0.5, 1, -1]);
    closeArr(t.position, [2, 4, 16], 12);
    closeArr(t.rotation, e, 12);
  });

  it('stretch: keeps the stretched y (bone) axis, x perpendicular, z = x cross y (hand computed)', () => {
    // A = S(5, 2.5, 10) * Rz(45): y column (-5c, 2.5c, 0) -> (-2, 1, 0)/sqrt5, x -> (1, 2, 0)/sqrt5, z = (0, 0, 1)
    const t = socketTransform(colMajor(rz3(Math.PI / 4), [0, 0, 0]), [5, 2.5, 10], [0, 0, 0]);
    closeArr(t.rotation, [0, 0, Math.atan2(2, 1)], 12);
  });

  it('mirrored frames give a proper rotation; degenerate frames return the fallback', () => {
    const m = orthonormalFrame(mul3(rz3(0.4), [1, 0, 0, 0, 1, 0, 0, 0, -1]))!;
    closeArr(m, rz3(0.4), 12); // z = x cross y: the mirrored z axis is flipped back
    expect(orthonormalFrame([1, 0, 0, 0, 0, 0, 0, 0, 1])).toBeNull(); // y axis of size 0
    expect(orthonormalFrame([1, 1, 0, 0, 0, 0, 0, 0, 1])).toBeNull(); // x parallel to y
    const flat = colMajor([1, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1, 1]);
    expect(socketTransform(flat, [2, 0, 2], [0, 0, 0], [0.1, 0.2, 0.3])).toEqual({ position: [2, 0, 2], rotation: [0.1, 0.2, 0.3] });
  });
});

describe('loadPrevisPlayer sockets (parentJoint)', () => {
  const RIG = { nodeNames: ['root', 'hand', 'head'] as (string | null)[] };
  const socketOf = (m: ReturnType<typeof mockSdk>, model: string, joint: string) => prims(m).find((p) => p.name === `previs:${model}:joint:${joint}`)!;
  const moves = (m: ReturnType<typeof mockSdk>, id: number) =>
    m.named('setObjectTransform').filter((c) => c[1] === id).map((c) => c[2] as { position: Vec3; rotation: Vec3 });

  it('one alpha-0 socket per (model, joint) under the model PIVOT; joint children hang from it', async () => {
    const m = mockSdk({ 'w.glb': RIG });
    await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode('w', { src: 'w.glb' }),
        node('stick', { parent: 'w', parentJoint: 'hand' }),
        node('cap', { parent: 'w', parentJoint: 'hand' }),
        node('tag', { parent: 'w', parentJoint: 'head' }),
        node('plain', { parent: 'w' }),
      ]),
    );
    const p = prims(m);
    expect(p.map((d) => d.name)).toEqual([
      'previs:w',
      'previs:w:joint:hand',
      'previs:stick',
      'previs:stick:mesh',
      'previs:cap',
      'previs:cap:mesh',
      'previs:w:joint:head',
      'previs:tag',
      'previs:tag:mesh',
      'previs:plain',
      'previs:plain:mesh',
      'previs:w:fit',
    ]);
    const byName = (n: string) => p.find((d) => d.name === n)!;
    const pivot = byName('previs:w');
    for (const j of ['hand', 'head']) {
      expect(socketOf(m, 'w', j)).toMatchObject({ shape: 'box', parentId: pivot.id, scale: [1, 1, 1], color: [0, 0, 0, 0] });
    }
    expect(byName('previs:stick').parentId).toBe(socketOf(m, 'w', 'hand').id);
    expect(byName('previs:cap').parentId).toBe(socketOf(m, 'w', 'hand').id);
    expect(byName('previs:tag').parentId).toBe(socketOf(m, 'w', 'head').id);
    expect(byName('previs:plain').parentId).toBe(pivot.id);
    expect(byName('previs:w:fit').parentId).toBe(pivot.id);
    // posable = socket joints; an animator without animation or joints, no pose sends
    expect(m.named('loadGltf')[0][2]).toMatchObject({ posable: ['hand', 'head'], animations: false });
    expect(m.named('createGltfAnimator')).toHaveLength(1);
    expect(m.named('animator.setBlend')).toEqual([]);
    expect(m.named('animator.setNodeRotations')).toEqual([]);
  });

  it('posable lists tracks.joints names, then socket joints, deduplicated, on every load (tiny-scale reload too)', async () => {
    const m = mockSdk({ 'mm.glb': { bounds: { min: [-500, -500, -500], max: [500, 500, 500] }, nodeNames: ['hips', 'leftArm', 'hand'] } });
    await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode('w', { src: 'mm.glb' }, { tracks: { joints: { leftArm: [{ t: 0, v: [0, 0, 0] }], hand: [{ t: 0, v: [0, 0, 0] }] } } }),
        node('a', { parent: 'w', parentJoint: 'hand' }),
        node('b', { parent: 'w', parentJoint: 'hips' }),
      ]),
    );
    const loads = m.named('loadGltf');
    expect(loads).toHaveLength(2);
    for (const l of loads) expect((l[2] as { posable: string[] }).posable).toEqual(['leftArm', 'hand', 'hips']);
  });

  it("'contain': position k (t - c), rotation of the joint with its scale removed (hand computed)", async () => {
    // extent [2, 4, 1], center [0, 2, 0], size 1 m * 10 -> k = 2.5
    const m = mockSdk({ 'w.glb': { ...RIG, bounds: { min: [-1, 0, -0.5], max: [1, 4, 0.5] } } });
    m.worlds.hand = colMajor(rz3(Math.PI / 2), [1, 3, 0.5], 2);
    const p = await loadPrevisPlayer(m.sdk, doc([modelNode('w', { src: 'w.glb' }), node('s', { parent: 'w', parentJoint: 'hand' })]));
    const id = socketOf(m, 'w', 'hand').id;
    let mv = moves(m, id);
    expect(mv).toHaveLength(1); // frame-0 pose at load
    closeArr(mv[0].position, [2.5, 2.5, 1.25], 6);
    closeArr(mv[0].rotation, [0, 0, Math.PI / 2], 6);
    // a general rotation with joint scale 3
    m.worlds.hand = colMajor(euler3([0.3, -0.7, 1.1]), [0, 2, 0], 3);
    p.frame(0);
    mv = moves(m, id);
    expect(mv).toHaveLength(2);
    closeArr(mv[1].position, [0, 0, 0], 6);
    closeArr(mv[1].rotation, [0.3, -0.7, 1.1], 6);
  });

  it("'stretch': per-axis k on position and the frame (hand computed)", async () => {
    // k = [5, 2.5, 10], center [0, 2, 0]
    const m = mockSdk({ 'w.glb': { ...RIG, bounds: { min: [-1, 0, -0.5], max: [1, 4, 0.5] } } });
    m.worlds.hand = colMajor(rz3(Math.PI / 2), [1, 3, 0.5]);
    const p = await loadPrevisPlayer(m.sdk, doc([modelNode('w', { src: 'w.glb', fit: 'stretch' }), node('s', { parent: 'w', parentJoint: 'hand' })]));
    const id = socketOf(m, 'w', 'hand').id;
    // S(k) Rz(90) has orthogonal columns: rotation exact
    closeArr(moves(m, id)[0].position, [5, 2.5, 5], 6);
    closeArr(moves(m, id)[0].rotation, [0, 0, Math.PI / 2], 6);
    // sheared: Rz(45) under S(5, 2.5, 10) -> bone (y) axis (-2, 1, 0)/sqrt5 -> Rz(atan2(2, 1))
    m.worlds.hand = colMajor(rz3(Math.PI / 4), [0, 2, 0]);
    p.frame(0);
    closeArr(moves(m, id)[1].rotation, [0, 0, Math.atan2(2, 1)], 6);
  });

  it('tiny-scale reload: the joint matrix carries the baked load scale', async () => {
    // mm model: extent [1000, 2000, 500] mm, size [1, 2, 0.5] m -> reload at 0.01, then k = 1, center [0, 10, 0]
    const m = mockSdk({ 'mm.glb': { ...RIG, bounds: { min: [-500, 0, -250], max: [500, 2000, 250] } } });
    m.worlds.hand = colMajor(rz3(0), [100, 1500, 50]);
    await loadPrevisPlayer(m.sdk, doc([modelNode('w', { src: 'mm.glb' }, { size: [1, 2, 0.5] }), node('s', { parent: 'w', parentJoint: 'hand' })]));
    expect((m.named('loadGltf')[1][2] as { scale: number }).scale).toBeCloseTo(0.01, 12);
    const mv = moves(m, socketOf(m, 'w', 'hand').id);
    closeArr(mv[0].position, [1, 5, 0.5], 5);
    closeArr(mv[0].rotation, [0, 0, 0], 9);
  });

  it('updates after the pose in the same frame, follows size changes, and skips unchanged results', async () => {
    const m = mockSdk({ 'w.glb': { ...RIG, animations: ['walk'] } });
    m.worlds.hand = colMajor(rz3(0.5), [0.25, 0.5, 0]);
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode('w', { src: 'w.glb', animation: { clip: 'walk' } }, { tracks: { size: [{ t: 2, v: [1, 1, 1] }, { t: 3, v: [2, 2, 2] }] } }),
        node('s', { parent: 'w', parentJoint: 'hand' }),
      ]),
    );
    const id = socketOf(m, 'w', 'hand').id;
    const count = () => moves(m, id).length;
    expect(count()).toBe(1);
    p.frame(0);
    expect(count()).toBe(1); // nothing changed
    p.frame(0.5); // clip time moves; the (fake) joint matrix does not
    expect(count()).toBe(1);
    m.worlds.hand = colMajor(rz3(0.5), [0.25, 0.5, 0], 2); // joint scale only: same socket transform
    p.frame(0.6);
    expect(count()).toBe(1);
    m.worlds.hand = colMajor(rz3(0.9), [0.25, 0.5, 0]);
    p.frame(0.7);
    expect(count()).toBe(2);
    // the socket call comes after this frame's setBlend
    const lastIndex = (f: (c: Call) => boolean) => m.calls.map((c, i) => (f(c) ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
    const idxBlend = lastIndex((c) => c[0] === 'animator.setBlend');
    const idxSock = lastIndex((c) => c[0] === 'setObjectTransform' && c[1] === id);
    expect(idxBlend).toBeGreaterThan(0);
    expect(idxSock).toBeGreaterThan(idxBlend);
    // size track: k doubles -> position doubles (center 0), rotation unchanged
    const before = moves(m, id).at(-1)!;
    p.frame(3);
    const after = moves(m, id).at(-1)!;
    closeArr(after.position, before.position.map((v) => v * 2), 6);
    closeArr(after.rotation, before.rotation, 12);
    p.frame(3);
    expect(moves(m, id).at(-1)).toBe(after);
  });

  it('loads a pure pivot model (invisible) when a node hangs from its joint; sockets never change material', async () => {
    const m = mockSdk({ 'w.glb': RIG });
    const p = await loadPrevisPlayer(
      m.sdk,
      doc([
        modelNode('w', { src: 'w.glb' }, { visible: false }),
        node('s', { parent: 'w', parentJoint: 'hand', tracks: { visible: [{ t: 0, v: true }, { t: 1, v: false }] } }),
      ]),
    );
    expect(m.named('loadGltf')).toHaveLength(1);
    const loaderObjects = parentCalls(m).map((c) => c[0]);
    expect(loaderObjects).toHaveLength(2);
    for (const c of m.named('setObjectMaterial').filter((c) => loaderObjects.includes(c[1]))) expect((c[2] as { color: number[] }).color[3]).toBe(0);
    p.frame(2);
    const sock = socketOf(m, 'w', 'hand').id;
    const mesh = prims(m).find((x) => x.name === 'previs:s:mesh')!.id;
    expect(m.named('setObjectMaterial').filter((c) => c[1] === sock)).toEqual([]);
    expect(m.named('setObjectMaterial').at(-1)).toEqual(['setObjectMaterial', mesh, { color: [1, 0.5, 0.25, 0] }]);
  });

  it('a pure pivot model without joint children is still not loaded', async () => {
    const m = mockSdk();
    await loadPrevisPlayer(m.sdk, doc([modelNode('w', { src: 'w.glb' }, { visible: false }), node('s', { parent: 'w' })]));
    expect(m.named('loadGltf')).toEqual([]);
  });

  it('rejects an unknown socket joint (loadGltf posable error, or the nodeNames check) and cleans up', async () => {
    const d = doc([modelNode('w', { src: 'w.glb' }), node('s', { parent: 'w', parentJoint: 'elbow' })]);
    const m = mockSdk({ 'w.glb': { ...RIG, checkPosable: true } });
    await expect(loadPrevisPlayer(m.sdk, d)).rejects.toThrow(
      'loadPrevisPlayer: node "w" (w.glb): loadGltf: posable node "elbow" not found (nodes: "root", "hand", "head")',
    );
    expect(m.named('disposeGltf')).toEqual([]);
    expect(m.named('removeObject').map((c) => c[1])).toEqual(prims(m).map((x) => x.id).reverse());
    expect(m.named('setTheme').at(-1)![1]).toBe(m.theme);
    // engines that ignore posable: the player's own check
    const m2 = mockSdk({ 'w.glb': RIG });
    await expect(loadPrevisPlayer(m2.sdk, d)).rejects.toThrow('loadPrevisPlayer: node "w" (w.glb): unknown joint "elbow" (joints: "root", "hand", "head")');
    expect(m2.named('disposeGltf')).toHaveLength(1);
    expect(m2.named('removeObject').map((c) => c[1])).toEqual(prims(m2).map((x) => x.id).reverse());
  });

  it('a nodeMatrix failure at load is wrapped and cleaned up', async () => {
    const m = mockSdk({ 'w.glb': RIG });
    const d = doc([modelNode('w', { src: 'w.glb' }), node('s', { parent: 'w', parentJoint: 'hand' })]);
    const orig = m.sdk.createGltfAnimator.bind(m.sdk);
    (m.sdk as unknown as { createGltfAnimator: unknown }).createGltfAnimator = (r: never, o: never) => {
      const a = orig(r, o);
      a.nodeMatrix = () => {
        throw new Error('GltfAnimator.nodeMatrix: "hand" is not in an animation rig');
      };
      return a;
    };
    await expect(loadPrevisPlayer(m.sdk, d)).rejects.toThrow('loadPrevisPlayer: node "w" (w.glb): GltfAnimator.nodeMatrix: "hand" is not in an animation rig');
    expect(m.named('disposeGltf')).toHaveLength(1);
    expect(m.named('removeObject').map((c) => c[1])).toEqual(prims(m).map((x) => x.id).reverse());
  });
});

// ---------------------------------------------------------------------------
// Re-parenting (tracks.parent)

/** World transforms of the recorded scene: replays addPrimitive / setObjectTransform / setObjectParent (scale-1 chains). */
function sceneWorld(m: ReturnType<typeof mockSdk>) {
  const parent = new Map<number, number | null>();
  const pos = new Map<number, Vec3>();
  const rot = new Map<number, Vec3>();
  for (const c of m.calls) {
    if (c[0] === 'addPrimitive') {
      const d = c[1] as { position: Vec3; rotation: Vec3; parentId: number | null };
      parent.set(c[2] as number, d.parentId);
      pos.set(c[2] as number, d.position);
      rot.set(c[2] as number, d.rotation);
    } else if (c[0] === 'setObjectTransform') {
      const t = c[2] as { position?: Vec3; rotation?: Vec3 };
      if (t.position) pos.set(c[1] as number, t.position);
      if (t.rotation) rot.set(c[1] as number, t.rotation);
    } else if (c[0] === 'setObjectParent') parent.set(c[1] as number, c[2] as number | null);
  }
  const world = (id: number): { p: Vec3; r: number[] } => {
    const p = pos.get(id)!;
    const r = euler3(rot.get(id)!);
    const pid = parent.get(id);
    if (pid === null || pid === undefined || !pos.has(pid)) return { p, r };
    const w = world(pid);
    const q = [0, 1, 2].map((i) => w.r[i * 3] * p[0] + w.r[i * 3 + 1] * p[1] + w.r[i * 3 + 2] * p[2]);
    return { p: [w.p[0] + q[0], w.p[1] + q[1], w.p[2] + q[2]], r: mul3(w.r, r) };
  };
  return { world, parent };
}

describe('player re-parenting (tracks.parent)', () => {
  const pivotOf = (m: ReturnType<typeof mockSdk>, id: string) => prims(m).find((p) => p.name === `previs:${id}`)!.id;
  const moving = (id: string, extra: Partial<PrevisNode> = {}) =>
    node(id, {
      tracks: {
        position: [{ t: 0, v: [-2, 1, 0] }, { t: 4, v: [3, 2, 1] }],
        rotation: [{ t: 0, v: [0.1, -0.5, 0.2] }, { t: 4, v: [-0.3, 1.9, 0.5] }],
      },
      ...extra,
    });

  it('re-parents the pivot at each key and keeps the world transform (no pop, 1e-6)', () => {
    const m = mockSdk();
    const d = doc([
      node('crate', { position: [1, 0.4, -2], rotation: [0, 0.7, 0] }),
      moving('carrier'),
      node('bottle', {
        parent: 'crate',
        position: [0.1, 0.5, 0.05],
        rotation: [0.3, 0, 0],
        tracks: { parent: [{ t: 1, v: { node: 'carrier' } }, { t: 2, v: null }] },
      }),
    ]);
    const player = createPrevisPlayer(m.sdk, d);
    const bottle = pivotOf(m, 'bottle');
    const at = (t: number) => {
      player.frame(t);
      return sceneWorld(m);
    };
    expect(at(0.5).parent.get(bottle)).toBe(pivotOf(m, 'crate'));
    for (const tk of [1, 2]) {
      const a = at(tk - 1e-7).world(bottle);
      const s = at(tk);
      const b = s.world(bottle);
      closeArr(a.p, b.p, 5); // engine units (x10): 1e-6 m
      closeArr(a.r, b.r, 6);
      expect(s.parent.get(bottle)).toBe(tk === 1 ? pivotOf(m, 'carrier') : null);
    }
    // detach (null) then attach: exactly these pivot re-parent calls
    expect(m.named('setObjectParent').filter((c) => c[1] === bottle).map((c) => c[2])).toEqual([null, pivotOf(m, 'carrier'), null]);
    // seeking back restores the static parent
    expect(at(0).parent.get(bottle)).toBe(pivotOf(m, 'crate'));
    player.dispose();
  });

  it('a hand-off swap in one instant detaches both pivots before attaching (the engine rejects cycles)', () => {
    const m = mockSdk();
    const d = doc([
      node('a', { tracks: { parent: [{ t: 1, v: { node: 'b' } }] } }),
      node('b', { parent: 'a', position: [1, 0, 0], tracks: { parent: [{ t: 1, v: null }] } }),
    ]);
    const player = createPrevisPlayer(m.sdk, d);
    player.frame(0);
    const n0 = m.calls.length;
    player.frame(1);
    const reparent = m.calls.slice(n0).filter((c) => c[0] === 'setObjectParent');
    const a = pivotOf(m, 'a');
    const b = pivotOf(m, 'b');
    expect(reparent).toEqual([['setObjectParent', b, null], ['setObjectParent', a, b]]);
    player.dispose();
  });

  it('joint refs: socket + forced load, captures posed at t_k then restored, no pop at pick-up and release', async () => {
    const m = mockSdk({ 'w.glb': { nodeNames: ['root', 'hand', 'head'], animations: ['walk'] } });
    // Hand joint follows the clip time: rotation about z by T, at [T, 0.5, 0] (loader units)
    const blendTimes = () => m.named('animator.setBlend').map((c) => (c[2] as { time: number }[])[0].time);
    Object.defineProperty(m.worlds, 'hand', {
      get: () => {
        const ts = blendTimes();
        const T = ts.length > 0 ? ts[ts.length - 1] : 0;
        return colMajor(rz3(T), [T, 0.5, 0]);
      },
    });
    const d = doc([
      node('crate', { position: [1, 0.4, -2] }),
      modelNode('w', { src: 'w.glb', animation: { clip: 'walk' } }, { visible: false, tracks: moving('x').tracks }),
      node('bottle', {
        parent: 'crate',
        position: [0.1, 0.5, 0.05],
        tracks: {
          parent: [{ t: 1, v: { node: 'w', joint: 'hand' } }, { t: 2, v: null }],
          position: [{ t: 2, v: [0.1, 0.5, 0.05] }, { t: 3, v: [1.1, 0.5, 0.05] }],
        },
      }),
    ]);
    const player = await loadPrevisPlayer(m.sdk, d);
    // hidden model still loaded (socket), posable has the joint, socket created after the pivots
    expect(m.named('loadGltf')[0][2]).toMatchObject({ posable: ['hand'] });
    expect(prims(m).map((p) => p.name).slice(0, 6)).toEqual(['previs:crate', 'previs:crate:mesh', 'previs:w', 'previs:bottle', 'previs:bottle:mesh', 'previs:w:joint:hand']);
    // frame-0 pose, posed at t=1 and t=2 for the captures, then frame 0 again
    expect(blendTimes()).toEqual([0, 1, 2, 0]);
    const bottle = pivotOf(m, 'bottle');
    const at = (t: number) => {
      player.frame(t);
      return sceneWorld(m);
    };
    for (const tk of [1, 2]) {
      const a = at(tk - 1e-7).world(bottle);
      const s = at(tk);
      const b = s.world(bottle);
      closeArr(a.p, b.p, 5);
      closeArr(a.r, b.r, 6);
      expect(s.parent.get(bottle)).toBe(tk === 1 ? prims(m).find((p) => p.name === 'previs:w:joint:hand')!.id : null);
    }
    // thrown: world moves by the position delta (x10 engine units) from the release point
    const rel = at(2).world(bottle).p;
    closeArr(at(2.5).world(bottle).p, [rel[0] + 5, rel[1], rel[2]], 9);
    player.dispose();
  });

  it('a doc without tracks.parent makes no re-parent calls per frame', () => {
    const m = mockSdk();
    const player = createPrevisPlayer(m.sdk, doc([node('a'), node('b', { parent: 'a' })]));
    player.frame(0);
    player.frame(1);
    expect(m.named('setObjectParent')).toEqual([]);
    player.dispose();
  });
});
