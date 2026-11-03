import { describe, expect, it } from 'vitest';
import { loadPrevisPlayer } from '../previs/player';
import type { PrevisDoc, PrevisNode } from '../previs/types';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

// Real loader + real animator + real Charturbo over a recording fake backend: a static model whose
// attach point is a mesh-less node must load and place a `parentJoint` child (the empty-socket case).

/** A unit box (node "body") plus an empty node "hand_socket" (translation 2,0,0), as a data-URI glTF. */
function boxWithSocket(): ArrayBuffer {
  const pos = new Float32Array([-1, -1, -1, 1, -1, -1, 1, 1, -1, -1, 1, -1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1]);
  const idx = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7, 3]);
  const bytes = new Uint8Array(pos.byteLength + idx.byteLength);
  bytes.set(new Uint8Array(pos.buffer), 0);
  bytes.set(new Uint8Array(idx.buffer), pos.byteLength);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      { name: 'root', children: [1, 2] },
      { name: 'body', mesh: 0 },
      { name: 'hand_socket', translation: [2, 0, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
      { bufferView: 1, componentType: 5123, count: idx.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: idx.byteLength },
    ],
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}` }],
  };
  return new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer;
}

function fakeSdk() {
  let next = 1;
  const meshBatches: number[][] = [];
  const transforms = new Map<number, { position?: number[]; rotation?: number[] }>();
  const impl: Record<string, unknown> = {
    add_primitive: () => next++,
    add_custom_mesh: () => next++,
    set_object_transform: () => true,
    set_object_mesh_matrices: (ids: Uint32Array) => (meshBatches.push(Array.from(ids)), ids.length),
    object_count: () => 0,
    camera_state: () => new Float32Array([0, 0, 0, 5, 0, 0, 0.7, 1]),
    get_object_transform: () => new Float32Array(0),
  };
  // Every other engine call is a no-op returning true.
  const backend = new Proxy(impl, { get: (t, k: string) => t[k] ?? (() => true) }) as unknown as WasmCharturboEngineBackend;
  const sdk = Charturbo.fromBackend(backend);
  const orig = sdk.setObjectTransform.bind(sdk);
  sdk.setObjectTransform = ((id: number, t: { position?: number[]; rotation?: number[] }) => {
    transforms.set(id, { ...transforms.get(id), ...t });
    return orig(id, t as never);
  }) as typeof sdk.setObjectTransform;
  return { sdk, meshBatches, transforms };
}

const node = (id: string, extra: Partial<PrevisNode> = {}): PrevisNode =>
  ({ id, shape: 'box', size: [0.1, 0.1, 0.1], position: [0, 0, 0], rotation: [0, 0, 0], color: [1, 1, 1], ...extra }) as PrevisNode;

const doc = (nodes: PrevisNode[]): PrevisDoc =>
  ({
    version: 1,
    fps: 24,
    size: { width: 64, height: 64 },
    background: [0, 0, 0],
    roles: [],
    nodes,
    shots: [{ id: 's', start: 0, end: 1, camera: { position: [{ t: 0, v: [0, 1, 5] }], target: { track: [{ t: 0, v: [0, 0, 0] }] }, fov: [{ t: 0, v: 40 }] } }],
  }) as PrevisDoc;

describe('previs parentJoint on a mesh-less node of a static model (real loader + animator)', () => {
  it('loads and places the child at the socket without mesh-matrix calls', async () => {
    const { sdk, meshBatches, transforms } = fakeSdk();
    const d = doc([
      node('man', { shape: 'model', model: { src: 'box.gltf' } } as Partial<PrevisNode>),
      node('stick', { parent: 'man', parentJoint: 'hand_socket', position: [0, 0, 0] }),
    ]);
    const player = await loadPrevisPlayer(sdk, d, { resolveModel: () => boxWithSocket() });
    player.frame(0);
    expect(meshBatches).toEqual([]);
    const socketPositions = [...transforms.values()].map((t) => t.position).filter((p): p is number[] => Array.isArray(p));
    // Some object sits at the socket offset (2 box-model units, scaled by the fit): non-zero x
    expect(socketPositions.some((p) => Math.abs(p[0]) > 1e-6)).toBe(true);
    player.dispose();
  });
});
