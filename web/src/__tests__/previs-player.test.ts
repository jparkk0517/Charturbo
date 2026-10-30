import { describe, expect, it } from 'vitest';
import { createPrevisPlayer } from '../previs/player';
import type { PrevisDoc, PrevisNode } from '../previs/types';
import type { Charturbo } from '../sdk/charturbo';

type Call = [string, ...unknown[]];

/** Recording stand-in for the Charturbo methods the player uses. */
function mockSdk() {
  const calls: Call[] = [];
  let nextId = 100;
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
    expect(m.named('setShading')[0][1]).toEqual({ model: 'classic' });
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
