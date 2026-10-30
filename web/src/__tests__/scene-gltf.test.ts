import { afterEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

type Calls = Record<string, unknown[][]>;

/** Scene backend with textures, recording calls (ids from 1, like the engine). */
function gltfBackend(options: { withTextures?: boolean } = {}) {
  const calls: Calls = {};
  const log = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  let nextObject = 1;
  let nextTexture = 1;
  const base = {
    add_primitive: () => nextObject++,
    add_custom_mesh: (...args: unknown[]) => {
      log('add_custom_mesh', args);
      return nextObject++;
    },
    set_object_transform: (...args: unknown[]) => {
      log('set_object_transform', args);
      return true;
    },
    get_object_transform: () => new Float32Array(0),
    set_object_material: () => true,
    set_object_physics: () => true,
    set_object_angular_velocity: () => true,
    set_object_parent: () => true,
    remove_object: (id: number) => {
      log('remove_object', [id]);
      return true;
    },
    clear_scene_objects: () => {},
    object_count: () => 0,
    set_scene_lighting: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    free: () => {},
  };
  const textures = {
    max_texture_size: () => 4096,
    create_texture_from_bitmap: (...args: unknown[]) => {
      log('create_texture_from_bitmap', args);
      return nextTexture++;
    },
    create_texture_rgba8: () => nextTexture++,
    dispose_texture: (id: number) => {
      log('dispose_texture', [id]);
      return true;
    },
    set_object_map: (...args: unknown[]) => {
      log('set_object_map', args);
      return true;
    },
    set_custom_mesh_uvs: (...args: unknown[]) => {
      log('set_custom_mesh_uvs', args);
      return true;
    },
  };
  const backend = (options.withTextures === false ? base : { ...base, ...textures }) as unknown as WasmCharturboEngineBackend;
  return { backend, calls, sdk: Charturbo.fromBackend(backend) };
}

const fakeBitmap = (width = 2, height = 2) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const stubBitmaps = () => {
  const createImageBitmap = vi.fn(async (_image: unknown, _options?: unknown) => fakeBitmap());
  vi.stubGlobal('createImageBitmap', createImageBitmap);
  return createImageBitmap;
};

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

/** Accumulates a binary buffer with 4-byte aligned bufferViews. */
class BinBuilder {
  private parts: Uint8Array[] = [];
  private length = 0;
  readonly bufferViews: Record<string, number>[] = [];

  /** Appends bytes as a new bufferView; returns its index. */
  view(data: ArrayBufferView, byteStride?: number): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.push(new Uint8Array(pad));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(byteStride ? { byteStride } : {}) });
    this.push(bytes);
    return this.bufferViews.length - 1;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }

  private push(bytes: Uint8Array) {
    this.parts.push(bytes);
    this.length += bytes.byteLength;
  }
}

/** Writes a GLB: 12-byte header, JSON chunk (space padded) and optional BIN chunk (zero padded). */
function writeGlb(json: object, bin?: Uint8Array): ArrayBuffer {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.byteLength / 4) * 4;
  const binLen = bin ? Math.ceil(bin.byteLength / 4) * 4 : 0;
  const total = 12 + 8 + jsonLen + (bin ? 8 + binLen : 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(text, 20);
  if (bin) {
    const o = 20 + jsonLen;
    dv.setUint32(o, binLen, true);
    dv.setUint32(o + 4, 0x004e4942, true);
    out.set(bin, o + 8);
  }
  return out.buffer;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TRI_POS = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const TRI_NRM = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
const TRI_UV = new Float32Array([0, 1, 1, 1, 0, 0]);

/** One textured triangle; `extra` merges into the JSON. */
function triangleModel(extra: Record<string, unknown> = {}) {
  const bin = new BinBuilder();
  const pos = bin.view(TRI_POS);
  const nrm = bin.view(TRI_NRM);
  const uv = bin.view(TRI_UV);
  const idx = bin.view(new Uint16Array([0, 1, 2, 0]));
  const img = bin.view(PNG);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'tri', mesh: 0 }],
    meshes: [{ name: 'triMesh', primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: 0 }] }],
    accessors: [
      { bufferView: pos, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
      { bufferView: nrm, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: uv, componentType: 5126, count: 3, type: 'VEC2' },
      { bufferView: idx, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0.25, roughnessFactor: 0.75 } }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729 }],
    images: [{ bufferView: img, mimeType: 'image/png' }],
    bufferViews: bin.bufferViews,
    ...extra,
  };
  const bytes = bin.bytes();
  return { json: { ...json, buffers: [{ byteLength: bytes.byteLength }] }, bin: bytes };
}

/** Minimal untextured model from raw accessors (one buffer, base64 data URI). */
function rawModel(build: (bin: BinBuilder) => Record<string, unknown>) {
  const bin = new BinBuilder();
  const rest = build(bin);
  const bytes = bin.bytes();
  return {
    asset: { version: '2.0' },
    ...rest,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${base64(bytes)}` }],
  };
}

const gltfBytes = (json: object) => new TextEncoder().encode(JSON.stringify(json)).buffer;
const mesh = (sdk: Charturbo, id: number) => sdk.getObjectRecord(id)!.customMesh!;
const close = (a: ArrayLike<number>, b: number[], digits = 5) => {
  expect(a.length).toBe(b.length);
  Array.from(a).forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('loadGltf containers', () => {
  it('loads a GLB with a binary chunk and a bufferView image', async () => {
    const createImageBitmap = stubBitmaps();
    const { sdk, calls } = gltfBackend();
    const { json, bin } = triangleModel();
    const result = await sdk.loadGltf(writeGlb(json, bin));

    expect(result.objects).toEqual([1]);
    expect(result.textures).toEqual([1]);
    expect(result.nodes).toEqual([{ index: 0, name: 'tri', objectIds: [1] }]);
    expect(result.bounds).toEqual({ min: [0, 0, 0], max: [1, 1, 0] });
    const blob = createImageBitmap.mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG);

    const rec = sdk.getObjectRecord(1)!;
    expect(rec.name).toBe('tri');
    expect(rec.customMesh!.positions).toEqual(Array.from(TRI_POS));
    expect(rec.customMesh!.normals).toEqual(Array.from(TRI_NRM));
    expect(rec.customMesh!.indices).toEqual([0, 1, 2]);
    expect(rec.customMesh!.uvs).toEqual(Array.from(TRI_UV));
    expect(rec).toMatchObject({ map: 1, metallic: 0.25, roughness: 0.75, color: [1, 1, 1, 1], alphaTest: 0, scale: [1, 1, 1] });
    expect(calls.set_custom_mesh_uvs).toHaveLength(1);
  });

  it('loads .gltf JSON with data URI buffers and images (also from a Blob / Uint8Array)', async () => {
    const createImageBitmap = stubBitmaps();
    const { sdk } = gltfBackend();
    const { json, bin } = triangleModel();
    const model = {
      ...json,
      buffers: [{ byteLength: bin.byteLength, uri: `data:application/octet-stream;base64,${base64(bin)}` }],
      images: [{ uri: `data:image/png;base64,${base64(PNG)}` }],
    };
    const result = await sdk.loadGltf(gltfBytes(model));
    expect(result.objects).toHaveLength(1);
    const blob = createImageBitmap.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG);
    expect(mesh(sdk, result.objects[0]).positions).toEqual(Array.from(TRI_POS));

    const fromBlob = await sdk.loadGltf(new Blob([JSON.stringify(model)]));
    expect(fromBlob.objects).toHaveLength(1);
    const fromBytes = await sdk.loadGltf(new Uint8Array(writeGlb(json, bin)));
    expect(fromBytes.objects).toHaveLength(1);
  });

  it('fetches external buffers and images relative to the model URL or baseUrl', async () => {
    stubBitmaps();
    const { json, bin } = triangleModel();
    const model = { ...json, buffers: [{ byteLength: bin.byteLength, uri: 'tri.bin' }], images: [{ uri: 'tex/a%20b.png' }] };
    const fetchMock = vi.fn(async (url: string, _init?: unknown) => {
      if (url.endsWith('.gltf')) return { ok: true, arrayBuffer: async () => gltfBytes(model) };
      if (url.endsWith('.bin')) return { ok: true, arrayBuffer: async () => bin.slice().buffer };
      return { ok: true, blob: async () => new Blob([PNG]) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const { sdk } = gltfBackend();
    const result = await sdk.loadGltf('https://example.com/models/tri.gltf');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://example.com/models/tri.gltf',
      'https://example.com/models/tri.bin',
      'https://example.com/models/tex/a%20b.png',
    ]);
    expect(sdk.getTextures()[0].src).toBe('https://example.com/models/tex/a%20b.png');
    expect(result.objects).toHaveLength(1);

    fetchMock.mockClear();
    await sdk.loadGltf(new URL('https://cdn.test/x/tri.gltf'), { baseUrl: 'https://assets.test/y/' });
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://cdn.test/x/tri.gltf',
      'https://assets.test/y/tri.bin',
      'https://assets.test/y/tex/a%20b.png',
    ]);
  });

  it('reports HTTP failures and bad files with the loadGltf prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const { sdk } = gltfBackend();
    await expect(sdk.loadGltf('https://example.com/missing.glb')).rejects.toThrow('loadGltf: failed to fetch https://example.com/missing.glb (404)');
    await expect(sdk.loadGltf(gltfBytes({ asset: { version: '1.0' } }))).rejects.toThrow('loadGltf: unsupported glTF version 1.0');
    await expect(sdk.loadGltf(new TextEncoder().encode('nope').buffer)).rejects.toThrow('loadGltf: not a glTF 2.0 file');
    await expect(sdk.loadGltf(gltfBytes({ asset: { version: '2.0' } }), { scene: 3 })).rejects.toThrow('loadGltf: scene 3 does not exist');
    await expect(sdk.loadGltf(gltfBytes({ asset: { version: '2.0' } }), { scale: 0 })).rejects.toThrow('loadGltf: scale must be');
  });

  it('returns an empty result for a model without meshes', async () => {
    const { sdk } = gltfBackend();
    const result = await sdk.loadGltf(gltfBytes({ asset: { version: '2.0' }, scenes: [{ nodes: [0] }], nodes: [{ name: 'empty' }] }), {
      position: [1, 2, 3],
    });
    expect(result).toEqual({ objects: [], textures: [], nodes: [{ index: 0, name: 'empty', objectIds: [] }], bounds: { min: [1, 2, 3], max: [1, 2, 3] } });
  });
});

describe('loadGltf accessors', () => {
  it('reads interleaved attributes with byteStride and normalized u8 / u16 uvs', async () => {
    const { sdk } = gltfBackend();
    // Stride 16: position f32 x3 (12 bytes) + uv u16 x2 normalized (4 bytes)
    const interleaved = new ArrayBuffer(16 * 3);
    const dv = new DataView(interleaved);
    const uv16 = [0, 65535, 65535, 65535, 0, 0];
    for (let i = 0; i < 3; i++) {
      for (let c = 0; c < 3; c++) dv.setFloat32(i * 16 + c * 4, TRI_POS[i * 3 + c], true);
      dv.setUint16(i * 16 + 12, uv16[i * 2], true);
      dv.setUint16(i * 16 + 14, uv16[i * 2 + 1], true);
    }
    const model = rawModel((bin) => {
      const v = bin.view(new Uint8Array(interleaved), 16);
      const u8 = bin.view(new Uint8Array([0, 255, 128, 255, 0, 0]));
      return {
        scenes: [{ nodes: [0, 1] }],
        nodes: [{ mesh: 0 }, { mesh: 1 }],
        meshes: [
          { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 } }] },
          { primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 2 } }] },
        ],
        accessors: [
          { bufferView: v, byteOffset: 0, componentType: 5126, count: 3, type: 'VEC3' },
          { bufferView: v, byteOffset: 12, componentType: 5123, normalized: true, count: 3, type: 'VEC2' },
          { bufferView: u8, componentType: 5121, normalized: true, count: 3, type: 'VEC2' },
        ],
      };
    });
    const { objects } = await sdk.loadGltf(gltfBytes(model));
    expect(mesh(sdk, objects[0]).positions).toEqual(Array.from(TRI_POS));
    close(mesh(sdk, objects[0]).uvs!, [0, 1, 1, 1, 0, 0]);
    close(mesh(sdk, objects[1]).uvs!, [0, 1, 128 / 255, 1, 0, 0]);
    // Non-indexed: indices generated
    expect(mesh(sdk, objects[0]).indices).toEqual([0, 1, 2]);
  });

  it('reads normalized signed components and u8 / u32 indices', async () => {
    const { sdk } = gltfBackend();
    const model = rawModel((bin) => {
      const pos = bin.view(new Int8Array([0, 0, 0, 127, 0, 0, 0, -128, 0]));
      const i8 = bin.view(new Uint8Array([0, 2, 1]));
      const i32 = bin.view(new Uint32Array([0, 1, 2]));
      return {
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }, { attributes: { POSITION: 0 }, indices: 2 }] }],
        accessors: [
          { bufferView: pos, componentType: 5120, normalized: true, count: 3, type: 'VEC3' },
          { bufferView: i8, componentType: 5121, count: 3, type: 'SCALAR' },
          { bufferView: i32, componentType: 5125, count: 3, type: 'SCALAR' },
        ],
      };
    });
    const { objects } = await sdk.loadGltf(gltfBytes(model));
    close(mesh(sdk, objects[0]).positions, [0, 0, 0, 1, 0, 0, 0, -1, 0]);
    expect(mesh(sdk, objects[0]).indices).toEqual([0, 2, 1]);
    expect(mesh(sdk, objects[1]).indices).toEqual([0, 1, 2]);
  });

  it('applies sparse accessors over zeros and over a bufferView', async () => {
    const { sdk } = gltfBackend();
    const model = rawModel((bin) => {
      const base = bin.view(new Float32Array([5, 5, 5, 5, 5, 5, 5, 5, 5]));
      const sIdx = bin.view(new Uint16Array([1, 2]));
      const sVal = bin.view(new Float32Array([1, 0, 0, 0, 1, 0]));
      return {
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 1 } }] }],
        accessors: [
          { componentType: 5126, count: 3, type: 'VEC3', sparse: { count: 2, indices: { bufferView: sIdx, componentType: 5123 }, values: { bufferView: sVal } } },
          { bufferView: base, componentType: 5126, count: 3, type: 'VEC3', sparse: { count: 1, indices: { bufferView: sIdx, componentType: 5123, byteOffset: 2 }, values: { bufferView: sVal, byteOffset: 12 } } },
        ],
      };
    });
    const { objects } = await sdk.loadGltf(gltfBytes(model));
    expect(mesh(sdk, objects[0]).positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(mesh(sdk, objects[1]).positions).toEqual([5, 5, 5, 5, 5, 5, 0, 1, 0]);
  });

  it('converts strips and fans and skips points / lines with one warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = gltfBackend();
    const model = rawModel((bin) => {
      const pos = bin.view(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 2, 1, 0]));
      return {
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [
          {
            primitives: [
              { attributes: { POSITION: 0 }, mode: 5 },
              { attributes: { POSITION: 0 }, mode: 6 },
              { attributes: { POSITION: 0 }, mode: 0 },
              { attributes: { POSITION: 0 }, mode: 1 },
            ],
          },
        ],
        accessors: [{ bufferView: pos, componentType: 5126, count: 5, type: 'VEC3' }],
      };
    });
    const { objects } = await sdk.loadGltf(gltfBytes(model));
    expect(objects).toHaveLength(2);
    expect(mesh(sdk, objects[0]).indices).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4]);
    expect(mesh(sdk, objects[1]).indices).toEqual([1, 2, 0, 2, 3, 0, 3, 4, 0]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('loadGltf: points and lines primitives are skipped');
  });

  it('rejects out-of-range indices and accessors past their bufferView', async () => {
    const { sdk } = gltfBackend();
    const model = (indices: number[], count = 3) =>
      rawModel((bin) => {
        const pos = bin.view(TRI_POS);
        const idx = bin.view(new Uint16Array(indices));
        return {
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
          accessors: [
            { bufferView: pos, componentType: 5126, count, type: 'VEC3' },
            { bufferView: idx, componentType: 5123, count: indices.length, type: 'SCALAR' },
          ],
        };
      });
    await expect(sdk.loadGltf(gltfBytes(model([0, 1, 7])))).rejects.toThrow('loadGltf: mesh 0 primitive 0 index 7 is out of range');
    await expect(sdk.loadGltf(gltfBytes(model([0, 1, 2], 4)))).rejects.toThrow('loadGltf: accessor 0 reads past the end of bufferView 0');
  });
});

describe('loadGltf transforms', () => {
  it('bakes TRS and matrix hierarchies into positions and normals', async () => {
    const { sdk } = gltfBackend();
    const s = Math.SQRT1_2;
    const model = rawModel((bin) => {
      const pos = bin.view(TRI_POS);
      const nrm = bin.view(new Float32Array([1, 0, 0, 1, 0, 0, 1, 0, 0]));
      return {
        scenes: [{ nodes: [0] }],
        nodes: [
          { name: 'parent', translation: [10, 0, 0], scale: [2, 2, 2], children: [1] },
          // 90 degrees about Z as a column-major matrix: x -> y, y -> -x
          { name: 'child', matrix: [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 5, 1], children: [2], mesh: 0 },
          { name: 'quat', rotation: [0, 0, s, s], mesh: 0 },
        ],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
        accessors: [
          { bufferView: pos, componentType: 5126, count: 3, type: 'VEC3' },
          { bufferView: nrm, componentType: 5126, count: 3, type: 'VEC3' },
        ],
      };
    });
    const result = await sdk.loadGltf(gltfBytes(model));
    expect(result.nodes.map((n) => [n.name, n.objectIds])).toEqual([
      ['parent', []],
      ['child', [1]],
      ['quat', [2]],
    ]);
    // child: parent * matrix -> (2 * rotZ(p) + [10, 0, 10])
    close(mesh(sdk, 1).positions, [10, 0, 10, 10, 2, 10, 8, 0, 10]);
    close(mesh(sdk, 1).normals, [0, 1, 0, 0, 1, 0, 0, 1, 0]);
    // quat child of child: two 90 degree turns -> 180 degrees
    close(mesh(sdk, 2).positions, [10, 0, 10, 8, 0, 10, 10, -2, 10]);
    close(mesh(sdk, 2).normals, [-1, 0, 0, -1, 0, 0, -1, 0, 0]);
    expect(mesh(sdk, 1).indices).toEqual([0, 1, 2]);
  });

  it('uses inverse-transpose normals for non-uniform scale and flips the winding of mirrored nodes', async () => {
    const { sdk } = gltfBackend();
    const model = rawModel((bin) => {
      const pos = bin.view(TRI_POS);
      const nrm = bin.view(new Float32Array([1, 1, 0, 1, 1, 0, 1, 1, 0]));
      return {
        scenes: [{ nodes: [0, 1] }],
        nodes: [
          { scale: [2, 1, 1], mesh: 0 },
          { scale: [-1, 1, 1], mesh: 0 },
        ],
        meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
        accessors: [
          { bufferView: pos, componentType: 5126, count: 3, type: 'VEC3' },
          { bufferView: nrm, componentType: 5126, count: 3, type: 'VEC3' },
        ],
      };
    });
    const { objects } = await sdk.loadGltf(gltfBytes(model));
    const n = 1 / Math.hypot(0.5, 1);
    close(mesh(sdk, objects[0]).normals.slice(0, 3), [0.5 * n, n, 0]);
    expect(mesh(sdk, objects[0]).indices).toEqual([0, 1, 2]);
    close(mesh(sdk, objects[1]).positions, [0, 0, 0, -1, 0, 0, 0, 1, 0]);
    close(mesh(sdk, objects[1]).normals.slice(0, 3), [-Math.SQRT1_2, Math.SQRT1_2, 0]);
    expect(mesh(sdk, objects[1]).indices).toEqual([0, 2, 1]);
  });

  it('computes smooth normals when NORMAL is missing (also for mirrored nodes)', async () => {
    const { sdk } = gltfBackend();
    const model = rawModel((bin) => {
      // Two triangles folded along x = 0 (a roof): shared ridge vertices average both faces
      const pos = bin.view(new Float32Array([0, 1, 0, 0, 1, 1, -1, 0, 0, 1, 0, 0]));
      const idx = bin.view(new Uint16Array([0, 2, 1, 0, 1, 3]));
      return {
        scenes: [{ nodes: [0, 1] }],
        nodes: [{ mesh: 0 }, { mesh: 0, scale: [1, 1, -1] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        accessors: [
          { bufferView: pos, componentType: 5126, count: 4, type: 'VEC3' },
          { bufferView: idx, componentType: 5123, count: 6, type: 'SCALAR' },
        ],
      };
    });
    const { objects } = await sdk.loadGltf(gltfBytes(model));
    const n = mesh(sdk, objects[0]).normals;
    close(n.slice(0, 3), [0, 1, 0]);
    close(n.slice(6, 9), [-Math.SQRT1_2, Math.SQRT1_2, 0]);
    close(n.slice(9, 12), [Math.SQRT1_2, Math.SQRT1_2, 0]);
    // Mirrored in z: winding flipped, so the normals still point up
    const m = mesh(sdk, objects[1]).normals;
    close(m.slice(0, 3), [0, 1, 0]);
    close(m.slice(6, 9), [-Math.SQRT1_2, Math.SQRT1_2, 0]);
  });

  it('applies position / rotation as the object transform and bakes scale; bounds are world space', async () => {
    const { sdk } = gltfBackend();
    const model = rawModel((bin) => {
      const pos = bin.view(TRI_POS);
      return {
        scenes: [{ nodes: [] }, { nodes: [0] }],
        scene: 1,
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        accessors: [{ bufferView: pos, componentType: 5126, count: 3, type: 'VEC3' }],
      };
    });
    const result = await sdk.loadGltf(gltfBytes(model), { position: [10, 0, 0], rotation: [0, Math.PI / 2, 0], scale: 10 });
    const rec = sdk.getObjectRecord(result.objects[0])!;
    expect(rec.position).toEqual([10, 0, 0]);
    expect(rec.rotation).toEqual([0, Math.PI / 2, 0]);
    expect(rec.scale).toEqual([1, 1, 1]);
    close(rec.customMesh!.positions, [0, 0, 0, 10, 0, 0, 0, 10, 0]);
    // Ry(90): x -> -z
    close(result.bounds.min, [10, 0, -10]);
    close(result.bounds.max, [10, 10, 0]);
    // scene option overrides the default scene
    expect((await sdk.loadGltf(gltfBytes(model), { scene: 0 })).objects).toEqual([]);
    expect((await sdk.loadGltf(gltfBytes(model), { scale: [1, 2, 3] })).bounds.max).toEqual([1, 2, 0]);
  });
});

describe('loadGltf materials', () => {
  function materialModel(materials: object[], extra: Record<string, unknown> = {}) {
    const { json, bin } = triangleModel();
    return writeGlb(
      {
        ...json,
        meshes: [{ primitives: materials.map((_, i) => ({ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 }, indices: 3, material: i })) }],
        materials,
        ...extra,
      },
      bin
    );
  }

  it('maps factors and alpha modes onto the scene material', async () => {
    stubBitmaps();
    const { sdk } = gltfBackend();
    const { objects } = await sdk.loadGltf(
      materialModel([
        { pbrMetallicRoughness: { baseColorFactor: [0.214, 0.5, 1, 0.3], metallicFactor: 0, roughnessFactor: 0.5 }, emissiveFactor: [0.2, 0.6, 0.1] },
        { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.4] }, alphaMode: 'BLEND' },
        { alphaMode: 'MASK', alphaCutoff: 0.3 },
        { alphaMode: 'MASK' },
        { emissiveFactor: [1, 1, 1], extensions: { KHR_materials_emissive_strength: { emissiveStrength: 2 } } },
      ])
    );
    const recs = objects.map((id) => sdk.getObjectRecord(id)!);
    // Linear factors become sRGB; OPAQUE ignores the factor alpha
    close(recs[0].color, [0.5, 0.7354, 1, 1], 3);
    expect(recs[0]).toMatchObject({ metallic: 0, roughness: 0.5, alphaTest: 0, map: null });
    expect(recs[0].emissive).toBeCloseTo(0.6);
    close(recs[1].color, [1, 1, 1, 0.4]);
    expect(recs[1]).toMatchObject({ alphaTest: 0, metallic: 1, roughness: 1 });
    expect(recs[2].alphaTest).toBe(0.3);
    expect(recs[3].alphaTest).toBe(0.5);
    expect(recs[4].emissive).toBe(2);
  });

  it('maps baseColorTexture with KHR_texture_transform and warns about ignored features once', async () => {
    stubBitmaps();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = gltfBackend();
    const transform = { KHR_texture_transform: { offset: [0.25, 0.5], scale: [2, 3], rotation: 0.3 } };
    const { objects } = await sdk.loadGltf(
      materialModel(
        [
          { pbrMetallicRoughness: { baseColorTexture: { index: 0, extensions: transform } }, normalTexture: { index: 0 } },
          { pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } }, occlusionTexture: { index: 0 } },
        ],
        { extensionsUsed: ['KHR_texture_transform', 'KHR_lights_punctual'], animations: [{}], skins: [{}] }
      )
    );
    expect(sdk.getObjectRecord(objects[0])).toMatchObject({ map: 1, mapOffset: [0.25, 0.5], mapRepeat: [2, 3], alphaTest: 0 });
    expect(sdk.getObjectRecord(objects[1])!.map).toBeNull();
    expect(warn.mock.calls.map((c) => c[0])).toEqual([
      'loadGltf: extension KHR_lights_punctual is not supported and is ignored',
      'loadGltf: animations are not supported and are ignored',
      'loadGltf: normal, occlusion, metallic-roughness and emissive textures are ignored',
      'loadGltf: KHR_texture_transform rotation is not supported and is ignored',
      'loadGltf: base color textures on TEXCOORD_1 or higher are not supported and are ignored',
    ]);
  });

  it('loads an image shared by several materials and textures once', async () => {
    const createImageBitmap = stubBitmaps();
    const { sdk, calls } = gltfBackend();
    const { objects, textures } = await sdk.loadGltf(
      materialModel(
        [
          { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
          { pbrMetallicRoughness: { baseColorTexture: { index: 1 } }, alphaMode: 'MASK' },
        ],
        { textures: [{ source: 0 }, { source: 0, sampler: 0 }] }
      )
    );
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(calls.create_texture_from_bitmap).toHaveLength(1);
    expect(textures).toEqual([1]);
    expect(objects.map((id) => sdk.getObjectRecord(id)!.map)).toEqual([1, 1]);
    expect(sdk.getObjectRecord(objects[1])!.alphaTest).toBe(0.5);
  });

  it('renders untextured with a warning when the engine has no texture support', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = gltfBackend({ withTextures: false });
    const { json, bin } = triangleModel();
    const result = await sdk.loadGltf(writeGlb(json, bin));
    expect(result.textures).toEqual([]);
    expect(sdk.getObjectRecord(result.objects[0])!.map).toBeNull();
    expect(warn).toHaveBeenCalledWith('loadGltf: the engine has no texture support; models render untextured');
    sdk.disposeGltf(result);
  });
});

describe('loadGltf failures and disposal', () => {
  it('rejects required unsupported extensions before creating anything', async () => {
    const { sdk, calls } = gltfBackend();
    const { json, bin } = triangleModel({ extensionsUsed: ['KHR_draco_mesh_compression'], extensionsRequired: ['KHR_draco_mesh_compression'] });
    await expect(sdk.loadGltf(writeGlb(json, bin))).rejects.toThrow('loadGltf: extension KHR_draco_mesh_compression is required but not supported');
    expect(calls.add_custom_mesh).toBeUndefined();
    // Supported required extensions pass
    stubBitmaps();
    const ok = triangleModel({ extensionsUsed: ['KHR_mesh_quantization'], extensionsRequired: ['KHR_mesh_quantization'] });
    expect((await sdk.loadGltf(writeGlb(ok.json, ok.bin))).objects).toHaveLength(1);
  });

  it('rejects with an AbortError and disposes textures created before the abort', async () => {
    const controller = new AbortController();
    let n = 0;
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        // The second image aborts while decoding, after the first one finished
        if (++n === 2) {
          await new Promise((resolve) => setTimeout(resolve, 0));
          controller.abort();
        }
        return fakeBitmap();
      })
    );
    const { sdk, calls } = gltfBackend();
    const { json, bin } = triangleModel();
    const glb = writeGlb(
      {
        ...json,
        meshes: [{ primitives: [0, 1].map((material) => ({ attributes: { POSITION: 0, TEXCOORD_0: 2 }, material })) }],
        materials: [0, 1].map((index) => ({ pbrMetallicRoughness: { baseColorTexture: { index } } })),
        textures: [{ source: 0 }, { source: 1 }],
        images: [json.images[0], { ...json.images[0] }],
      },
      bin
    );
    await expect(sdk.loadGltf(glb, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.create_texture_from_bitmap).toHaveLength(1);
    expect(calls.dispose_texture).toEqual([[1]]);
    expect(calls.add_custom_mesh).toBeUndefined();
    expect(sdk.getTextures()).toEqual([]);

    const aborted = new AbortController();
    aborted.abort();
    await expect(sdk.loadGltf(glb, { signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('removes created objects and textures when the engine rejects a mesh', async () => {
    stubBitmaps();
    const { sdk, calls, backend } = gltfBackend();
    const { json, bin } = triangleModel();
    let added = 0;
    const add = backend.add_custom_mesh!.bind(backend);
    backend.add_custom_mesh = ((...args: Parameters<typeof add>) => {
      if (++added === 2) throw new Error('mesh index out of bounds');
      return add(...args);
    }) as typeof add;
    const glb = writeGlb({ ...json, scenes: [{ nodes: [0, 1] }], nodes: [{ mesh: 0 }, { mesh: 0 }] }, bin);
    await expect(sdk.loadGltf(glb)).rejects.toThrow('loadGltf: mesh index out of bounds');
    expect(calls.remove_object).toEqual([[1]]);
    expect(calls.dispose_texture).toEqual([[1]]);
    expect(sdk.objectCount()).toBe(0);
  });

  it('disposeGltf removes the objects and textures of a result', async () => {
    stubBitmaps();
    const { sdk, calls } = gltfBackend();
    const { json, bin } = triangleModel();
    const result = await sdk.loadGltf(writeGlb({ ...json, scenes: [{ nodes: [0, 1] }], nodes: [{ mesh: 0 }, { mesh: 0, translation: [3, 0, 0] }] }, bin));
    expect(result.objects).toEqual([1, 2]);
    expect(result.bounds).toEqual({ min: [0, 0, 0], max: [4, 1, 0] });
    sdk.disposeGltf(result);
    expect(calls.remove_object).toEqual([[1], [2]]);
    expect(calls.dispose_texture).toEqual([[1]]);
    expect(sdk.getObjects()).toEqual([]);
    expect(sdk.getTextures()).toEqual([]);
  });
});
