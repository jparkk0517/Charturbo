import { describe, expect, it } from 'vitest';
import { createPrevisPlayer, loadPrevisPlayer } from '../previs/player';
import type { PrevisDoc, PrevisModel, PrevisNode, Vec3 } from '../previs/types';
import type { Charturbo } from '../sdk/charturbo';

type Call = [string, ...unknown[]];

/** What the fake `loadGltf` returns for a source (bounds at load scale 1). */
interface FakeModel {
  objects?: number;
  bounds?: { min: Vec3; max: Vec3 };
  animations?: string[];
  /** Rejects with this instead of loading. */
  error?: Error;
  /** Resolves only after this promise does (abort tests). */
  gate?: Promise<void>;
}

interface FakeResult {
  objects: number[];
  textures: number[];
  nodes: unknown[];
  bounds: { min: Vec3; max: Vec3 };
  animations: { name: string; duration: number }[];
}

/** Recording stand-in for the Charturbo methods the player uses. */
function mockSdk(models: Record<string, FakeModel> = {}) {
  const calls: Call[] = [];
  let nextId = 100;
  let nextAnimator = 1;
  const theme = { surface: [0.1, 0.1, 0.1, 1], marker: 'theme' };
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
    setCameraFov: rec('setCameraFov'),
    removeObject: rec('removeObject', true),
    setObjectParent: rec('setObjectParent', true),
    loadGltf: async (source: unknown, opts: { signal?: AbortSignal; scale?: number }): Promise<FakeResult> => {
      calls.push(['loadGltf', source, opts]);
      const fm = models[String(source)] ?? {};
      if (fm.gate) await fm.gate;
      if (opts.signal?.aborted) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      if (fm.error) throw fm.error;
      const k = opts.scale ?? 1;
      const b = fm.bounds ?? { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] };
      const objects = Array.from({ length: fm.objects ?? 2 }, () => nextId++);
      return {
        objects,
        textures: [],
        nodes: [],
        bounds: { min: b.min.map((v) => v * k) as Vec3, max: b.max.map((v) => v * k) as Vec3 },
        animations: (fm.animations ?? []).map((name) => ({ name, duration: 1 })),
      };
    },
    disposeGltf: (r: FakeResult) => {
      calls.push(['disposeGltf', r.objects]);
    },
    createGltfAnimator: (model: FakeResult, opts: unknown) => {
      const a = nextAnimator++;
      calls.push(['createGltfAnimator', model.objects, opts, a]);
      const animator = {
        setBlend: (entries: unknown) => {
          calls.push(['animator.setBlend', a, entries]);
          return animator;
        },
        dispose: () => {
          calls.push(['animator.dispose', a]);
        },
      };
      return animator;
    },
  };
  const named = (n: string) => calls.filter((c) => c[0] === n);
  return { sdk: sdk as unknown as Charturbo, calls, named, theme };
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
    expect(m.named('setCameraPose')).toEqual([['setCameraPose', [0, 10, 50], [0, 10, 0]]]);
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
