import { afterEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { computeJointMatrices, skinPositions } from '../sdk/scene-gltf-anim';

// ---------------------------------------------------------------------------
// Mock backend with skinning (the engine skins on the CPU; the mock mirrors it for positions)
// ---------------------------------------------------------------------------

interface MockSkin {
  joints: Uint16Array;
  weights: Float32Array;
  jointCount: number;
  palette: Float32Array;
}

function skinBackend(options: { skinning?: boolean } = {}) {
  let nextObject = 1;
  const positions = new Map<number, Float32Array>();
  const skins = new Map<number, MockSkin>();
  const jointBatches: { ids: number[]; counts: number[]; floats: number }[] = [];
  const meshBatches: number[][] = [];
  const base: Record<string, unknown> = {
    add_primitive: () => nextObject++,
    add_custom_mesh: (p: Float32Array) => {
      positions.set(nextObject, Float32Array.from(p));
      return nextObject++;
    },
    set_object_transform: () => true,
    get_object_transform: () => new Float32Array(0),
    set_object_material: () => true,
    set_object_physics: () => true,
    set_object_angular_velocity: () => true,
    set_object_parent: () => true,
    remove_object: (id: number) => {
      skins.delete(id);
      return true;
    },
    clear_scene_objects: () => {},
    object_count: () => 0,
    set_scene_lighting: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    sync_and_render: () => {},
    free: () => {},
    set_object_mesh_matrices: (ids: Uint32Array) => {
      meshBatches.push(Array.from(ids));
      return ids.length;
    },
  };
  if (options.skinning !== false) {
    base.set_object_skin = (id: number, joints: Uint16Array, weights: Float32Array, jointCount: number) => {
      if (!positions.has(id)) return false;
      if (joints.length === 0) {
        skins.delete(id);
        return true;
      }
      const palette = new Float32Array(jointCount * 16);
      for (let j = 0; j < jointCount; j++) for (let c = 0; c < 16; c += 5) palette[j * 16 + c] = 1;
      skins.set(id, { joints: Uint16Array.from(joints), weights: Float32Array.from(weights), jointCount, palette });
      return true;
    };
    base.set_object_joint_matrices = (ids: Uint32Array, counts: Uint32Array, mats: Float32Array) => {
      jointBatches.push({ ids: Array.from(ids), counts: Array.from(counts), floats: mats.length });
      let o = 0;
      let n = 0;
      ids.forEach((id, k) => {
        const skin = skins.get(id);
        if (skin && skin.jointCount === counts[k]) {
          skin.palette = mats.slice(o, o + counts[k] * 16);
          n++;
        }
        o += counts[k] * 16;
      });
      return n;
    };
    base.get_object_skinned_vertices = (id: number) => {
      const skin = skins.get(id);
      const p = positions.get(id);
      if (!skin || !p) return new Float32Array(0);
      const posed = skinPositions(p, skin.joints, skin.weights, skin.palette);
      const out = new Float32Array((posed.length / 3) * 6);
      for (let v = 0; v < posed.length / 3; v++) {
        out.set(posed.subarray(v * 3, v * 3 + 3), v * 6);
        out[v * 6 + 4] = 1; // normal +Y
      }
      return out;
    };
  }
  const backend = base as unknown as WasmCharturboEngineBackend;
  /** Current posed positions of a skinned object (bind positions when unskinned) */
  const posed = (id: number) => {
    const skin = skins.get(id);
    const p = positions.get(id)!;
    return skin ? Array.from(skinPositions(p, skin.joints, skin.weights, skin.palette)) : Array.from(p);
  };
  return { backend, positions, skins, jointBatches, meshBatches, posed, sdk: Charturbo.fromBackend(backend) };
}

type Data = Float32Array | Uint16Array | Uint8Array;

/** Accumulates a binary buffer with 4-byte aligned bufferViews (base64 data URI). */
class Bin {
  private parts: number[] = [];
  readonly bufferViews: Record<string, number>[] = [];
  readonly accessors: Record<string, unknown>[] = [];

  accessor(data: Data, type: string, extra: Record<string, unknown> = {}): number {
    while (this.parts.length % 4) this.parts.push(0);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.bufferViews.push({ buffer: 0, byteOffset: this.parts.length, byteLength: bytes.byteLength });
    for (const b of bytes) this.parts.push(b);
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type]!;
    const componentType = data instanceof Float32Array ? 5126 : data instanceof Uint16Array ? 5123 : 5121;
    this.accessors.push({ bufferView: this.bufferViews.length - 1, componentType, count: data.length / comps, type, ...extra });
    return this.accessors.length - 1;
  }

  gltf(rest: Record<string, unknown>): ArrayBuffer {
    const bytes = Uint8Array.from(this.parts);
    const json = {
      asset: { version: '2.0' },
      ...rest,
      accessors: this.accessors,
      bufferViews: this.bufferViews,
      buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${btoa(binaryString(bytes))}` }],
    };
    return new TextEncoder().encode(JSON.stringify(json)).buffer;
  }
}

/** Quaternion of `deg` degrees about +Z */
const qz = (deg: number) => [0, 0, Math.sin((deg * Math.PI) / 360), Math.cos((deg * Math.PI) / 360)];

/** Bind positions of the strip: rows y = 0, 1, 2 at x = 0 and 1 */
const STRIP = [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 2, 0, 1, 2, 0];

/**
 * A 6-vertex strip skinned to two joints: 'root' (origin) -> 'bend' (y = 1, animated 0 -> 90 deg
 * about +Z over 1 s). Row 0 follows root, row 1 is split 50/50, row 2 follows bend. The mesh node
 * has a translation that skinning must ignore.
 */
function stripModel(
  opts: {
    joints?: 'u8' | 'u16';
    weights?: 'float' | 'unorm8' | 'unorm16';
    /** Extra primitive attributes (JOINTS_1 etc.) */
    attributes?: Record<string, number>;
    /** Override joint indices of the bend row */
    bendJoint?: number;
    noIbm?: boolean;
    primitives?: number;
    jointsOutside?: boolean;
    animations?: boolean;
  } = {}
) {
  const bin = new Bin();
  const pos = bin.accessor(new Float32Array(STRIP), 'VEC3', { min: [0, 0, 0], max: [1, 2, 0] });
  const idx = bin.accessor(new Uint16Array([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]), 'SCALAR');
  const b = opts.bendJoint ?? 1;
  const j = [0, 0, 0, 0, 0, 0, 0, 0, 0, b, 0, 0, 0, b, 0, 0, b, 0, 0, 0, b, 0, 0, 0];
  const joints = bin.accessor(opts.joints === 'u8' ? Uint8Array.from(j) : Uint16Array.from(j), 'VEC4');
  // Row 1 weights 0.3 / 0.3 (float: normalized to 0.5 / 0.5 by the loader)
  const w = [1, 0, 0, 0, 1, 0, 0, 0, 0.3, 0.3, 0, 0, 0.3, 0.3, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  const weights =
    opts.weights === 'unorm8'
      ? bin.accessor(Uint8Array.from(w, (v) => Math.round(v * 255)), 'VEC4', { normalized: true })
      : opts.weights === 'unorm16'
        ? bin.accessor(Uint16Array.from(w, (v) => Math.round(v * 65535)), 'VEC4', { normalized: true })
        : bin.accessor(new Float32Array(w), 'VEC4');
  const ibm = opts.noIbm
    ? undefined
    : bin.accessor(new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]), 'MAT4');
  const times = bin.accessor(new Float32Array([0, 1]), 'SCALAR');
  const rot = bin.accessor(new Float32Array([...qz(0), ...qz(90)]), 'VEC4');
  const prim = { attributes: { POSITION: pos, JOINTS_0: joints, WEIGHTS_0: weights, ...opts.attributes }, indices: idx };
  return bin.gltf({
    scenes: [{ nodes: opts.jointsOutside ? [0] : [0, 1] }],
    nodes: [
      { name: 'skinned', mesh: 0, skin: 0, translation: [100, 0, 0] },
      { name: 'root', children: [2] },
      { name: 'bend', translation: [0, 1, 0] },
    ],
    meshes: [{ primitives: Array.from({ length: opts.primitives ?? 1 }, () => prim) }],
    skins: [{ joints: [1, 2], ...(ibm !== undefined ? { inverseBindMatrices: ibm } : {}), skeleton: 1 }],
    ...(opts.animations === false
      ? {}
      : { animations: [{ name: 'bend', channels: [{ sampler: 0, target: { node: 2, path: 'rotation' } }], samplers: [{ input: times, output: rot }] }] }),
  });
}

function binaryString(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return out;
}

const close = (a: ArrayLike<number>, b: number[], digits = 4) => {
  expect(a.length).toBe(b.length);
  Array.from(a).forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
};

/** The strip at t = 1 s: the top row folds 90 deg about (0, 1, 0); row 1 blends 50/50 */
const BENT = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0.5, 1.5, 0, -1, 1, 0, -1, 2, 0];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('glTF skins: parsing', () => {
  it.each([
    ['u16', 'float'],
    ['u8', 'unorm8'],
    ['u16', 'unorm16'],
  ] as const)('loads JOINTS_0 %s / WEIGHTS_0 %s into a bind-space skinned mesh', async (joints, weights) => {
    const { sdk, skins, positions, jointBatches } = skinBackend();
    expect(sdk.supportsSkinning).toBe(true);
    const model = await sdk.loadGltf(stripModel({ joints, weights }), { animations: false });
    expect(model.objects).toHaveLength(1);
    const id = model.objects[0];
    // Bind-space vertices: the mesh node's translation (100, 0, 0) is ignored
    close(positions.get(id)!, STRIP);
    const skin = skins.get(id)!;
    expect(skin.jointCount).toBe(2);
    expect(Array.from(skin.joints)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    // Weights normalized (row 1: 0.3 / 0.3 -> 0.5 / 0.5; unorm quantization included)
    close(skin.weights, [1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    // Rest palette in one call: root identity, bend T(0,1,0) x IBM T(0,-1,0) = identity
    expect(jointBatches).toEqual([{ ids: [id], counts: [2], floats: 32 }]);
    close(skin.palette, [...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], ...[1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]]);
    expect(model.bounds).toEqual({ min: [0, 0, 0], max: [1, 2, 0] });
  });

  it('defaults missing inverse bind matrices to identity and applies the loader scale to the palette', async () => {
    const { sdk, skins, posed } = skinBackend();
    const model = await sdk.loadGltf(stripModel({ noIbm: true }), { animations: false, scale: 2 });
    const skin = skins.get(model.objects[0])!;
    // Joint 1 = base(2) x T(0, 1, 0) x identity: the whole bend row set moves up by 1 (scaled: 2)
    close(skin.palette.subarray(16, 32), [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 2, 0, 0, 2, 0, 1]);
    close(posed(model.objects[0]).slice(12, 18), [0, 6, 0, 2, 6, 0]);
    expect(model.bounds.max[1]).toBeCloseTo(6);
  });

  it('warns about JOINTS_1 / WEIGHTS_1 and uses the first set', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, skins } = skinBackend();
    const file = stripModel({ attributes: { JOINTS_1: 2, WEIGHTS_1: 3 } });
    const model = await sdk.loadGltf(file);
    expect(skins.get(model.objects[0])!.jointCount).toBe(2);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain(
      'loadGltf: only the first 4 joint influences per vertex (JOINTS_0 / WEIGHTS_0) are used'
    );
  });

  it('rejects joint indices past the skin and removes the created objects', async () => {
    const { sdk, skins } = skinBackend();
    const removed = vi.spyOn(sdk, 'removeObject');
    await expect(sdk.loadGltf(stripModel({ bendJoint: 5 }))).rejects.toThrow(/joint index 5 is out of range \(the skin has 2 joints\)/);
    expect(skins.size).toBe(0);
    expect(removed).not.toHaveBeenCalled(); // validation happens before any object exists
  });

  it('bakes the bind pose when a joint is outside the loaded scene', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, skins, positions } = skinBackend();
    const model = await sdk.loadGltf(stripModel({ jointsOutside: true }));
    expect(skins.size).toBe(0);
    // Rigid fallback: the node transform applies
    expect(Array.from(positions.get(model.objects[0])!.subarray(0, 3))).toEqual([100, 0, 0]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('loadGltf: skin 0 uses joints outside the loaded scene; its meshes render in their bind pose');
  });

  it('without engine skinning support warns and bakes the bind pose like before', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, positions, jointBatches } = skinBackend({ skinning: false });
    expect(sdk.supportsSkinning).toBe(false);
    const model = await sdk.loadGltf(stripModel());
    expect(Array.from(positions.get(model.objects[0])!.subarray(0, 3))).toEqual([100, 0, 0]);
    expect(jointBatches).toEqual([]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('loadGltf: skins are not supported; skinned meshes render in their bind pose');
  });
});

describe('glTF skins: joint matrices', () => {
  it('computeJointMatrices = base x joint world x inverse bind', () => {
    const skin = { joints: Int32Array.from([1]), inverseBind: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]) };
    const world = new Float64Array(32);
    // node 1: rotate 90 deg about Z, then translate (0, 1, 0)
    world.set([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1], 16);
    const base = new Float64Array([3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1]);
    const out = new Float32Array(16);
    computeJointMatrices(skin, base, world, out, 0);
    // p = (0, 2, 0): IBM -> (0, 1, 0), rotate -> (-1, 0, 0), translate -> (-1, 1, 0), x3
    const p = [0, 2, 0];
    close([0, 1, 2].map((r) => out[r] * p[0] + out[4 + r] * p[1] + out[8 + r] * p[2] + out[12 + r]), [-3, 3, 0]);
  });

  it('skinPositions blends, normalizes weights and keeps unweighted vertices', () => {
    const palette = new Float32Array(32);
    palette.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], 0);
    palette.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 4, 0, 0, 1], 16);
    const out = skinPositions([1, 1, 1, 5, 5, 5], [0, 1, 0, 0, 1, 0, 0, 0], [2, 2, 0, 0, 0, 0, 0, 0], palette);
    close(out, [3, 1, 1, 5, 5, 5]);
  });
});

describe('glTF skins: animator', () => {
  it('poses the skin with one batched joint-matrix call per update', async () => {
    const { sdk, posed, jointBatches, meshBatches } = skinBackend();
    const model = await sdk.loadGltf(stripModel());
    const id = model.objects[0];
    close(posed(id), STRIP);
    jointBatches.length = 0;
    const anim = sdk.createGltfAnimator(model, { autoUpdate: false }).play('bend', { loop: 'once' });
    anim.pause().seek(1);
    close(posed(id), BENT);
    expect(jointBatches).toHaveLength(2); // play + seek
    expect(jointBatches[1]).toEqual({ ids: [id], counts: [2], floats: 32 });
    expect(meshBatches).toEqual([]); // no rigid animated meshes in this model
    anim.weight = 0;
    close(posed(id), STRIP);
    anim.weight = 1;
    anim.stop();
    close(posed(id), STRIP);
  });

  it('shares one skin across primitives in the same call', async () => {
    const { sdk, posed, jointBatches } = skinBackend();
    const model = await sdk.loadGltf(stripModel({ primitives: 2 }));
    expect(model.objects).toHaveLength(2);
    jointBatches.length = 0;
    sdk.createGltfAnimator(model, { autoUpdate: false }).play(0).pause().seek(1);
    expect(jointBatches.at(-1)).toEqual({ ids: model.objects, counts: [2, 2], floats: 64 });
    close(posed(model.objects[1]), BENT);
  });

  it('exportScene writes the current pose of skinned meshes', async () => {
    const { sdk } = skinBackend();
    const model = await sdk.loadGltf(stripModel());
    sdk.createGltfAnimator(model, { autoUpdate: false }).play(0).pause().seek(1);
    const exported = sdk.exportScene().objects.find((o) => o.name === 'skinned')!;
    expect(exported.kind).toBe('custom');
    if (exported.kind === 'custom') close(exported.positions, BENT);
    // A removed skin exports the bind pose again
    expect(sdk.setObjectSkin(model.objects[0], null)).toBe(true);
    const bind = sdk.exportScene().objects.find((o) => o.name === 'skinned')!;
    if (bind.kind === 'custom') close(bind.positions, STRIP);
  });

  it('setObjectJointMatrices validates the batch layout', () => {
    const { sdk } = skinBackend();
    expect(() => sdk.setObjectJointMatrices([1, 2], [2], new Float32Array(32))).toThrow(/one joint count per id/);
    const { sdk: old } = skinBackend({ skinning: false });
    expect(old.setObjectJointMatrices([1], [1], new Float32Array(16))).toBe(0);
    expect(old.setObjectSkin(1, { joints: [0, 0, 0, 0], weights: [1, 0, 0, 0], jointCount: 1 })).toBe(false);
  });

  it('a 10k-vertex, 40-joint skin poses in one call per update (JS palette cost)', async () => {
    // Tube of 40 bones (one ring row per joint step), 10k vertices
    const bin = new Bin();
    const J = 40;
    const rings = 250;
    const seg = 40;
    const pos = new Float32Array(rings * seg * 3);
    const joints = new Uint8Array(rings * seg * 4);
    const weights = new Float32Array(rings * seg * 4);
    for (let r = 0; r < rings; r++) {
      const y = (r / (rings - 1)) * (J - 1);
      const j0 = Math.min(J - 2, Math.floor(y));
      const f = y - j0;
      for (let s = 0; s < seg; s++) {
        const v = r * seg + s;
        const a = (s / seg) * Math.PI * 2;
        pos.set([Math.cos(a) * 0.3, y, Math.sin(a) * 0.3], v * 3);
        joints.set([j0, j0 + 1, 0, 0], v * 4);
        weights.set([1 - f, f, 0, 0], v * 4);
      }
    }
    const ibm = new Float32Array(J * 16);
    for (let j = 0; j < J; j++) ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -j, 0, 1], j * 16);
    const times = bin.accessor(new Float32Array([0, 1]), 'SCALAR');
    const rot = bin.accessor(new Float32Array([...qz(0), ...qz(8)]), 'VEC4');
    const p = bin.accessor(pos, 'VEC3', { min: [-0.3, 0, -0.3], max: [0.3, J - 1, 0.3] });
    const jo = bin.accessor(joints, 'VEC4');
    const we = bin.accessor(weights, 'VEC4');
    const ib = bin.accessor(ibm, 'MAT4');
    const nodes: Record<string, unknown>[] = [{ mesh: 0, skin: 0 }];
    for (let j = 0; j < J; j++) nodes.push({ ...(j > 0 ? { translation: [0, 1, 0] } : {}), ...(j + 1 < J ? { children: [j + 2] } : {}) });
    const file = bin.gltf({
      scenes: [{ nodes: [0, 1] }],
      nodes,
      meshes: [{ primitives: [{ attributes: { POSITION: p, JOINTS_0: jo, WEIGHTS_0: we }, mode: 0 + 4 }] }],
      skins: [{ joints: Array.from({ length: J }, (_, j) => j + 1), inverseBindMatrices: ib }],
      animations: [{ channels: Array.from({ length: J - 1 }, (_, j) => ({ sampler: 0, target: { node: j + 2, path: 'rotation' } })), samplers: [{ input: times, output: rot }] }],
    });
    const { sdk, jointBatches } = skinBackend();
    const model = await sdk.loadGltf(file);
    const anim = sdk.createGltfAnimator(model, { autoUpdate: false }).play(0);
    jointBatches.length = 0;
    const frames = 200;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) anim.update(1 / 240);
    const perFrame = (performance.now() - t0) / frames;
    expect(jointBatches).toHaveLength(frames);
    expect(jointBatches[0]).toEqual({ ids: model.objects, counts: [J], floats: J * 16 });
    console.info(`glTF skin: ${J} joints, ${rings * seg} vertices, ${perFrame.toFixed(3)} ms per update (JS palette + batch; engine skinning not included)`);
    expect(perFrame).toBeLessThan(5);
  });
});
