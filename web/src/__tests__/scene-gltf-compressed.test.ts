// Compressed glTF (EXT_meshopt_compression, KHR_draco_mesh_compression) through injected decoders.
// Every fixture is compared with its uncompressed source loaded the same way.
//
// Tolerances (derived from the encoder settings, not tuned):
// - Positions: the fixtures were written by @gltf-transform/cli 4.5.1 with default options, which
//   quantize POSITION to 14 bits over the mesh's largest bounding-box extent E (taken from the
//   source POSITION accessor min / max):
//   - Draco (`quantizePosition: 14`, unsigned over the range E): one step is E / (2^14 - 1) and
//     rounding errs by at most half a step per axis.
//   - meshopt (`quantize`, per-mesh volume, signed int16): values in [-1, 1] (half-range E / 2) are
//     rounded to 13 magnitude bits (step 1 / (2^13 - 1)) and bit-replicated into 15 bits
//     (q << 2 | q >> 11); decoding q' / 32767 differs from q / 8191 by less than 1 / 32767. Per
//     axis: (E / 2) * (0.5 / (2^13 - 1) + 1 / 32767).
//   A vertex moves at most sqrt(3) times the per-axis bound. The source nodes carry no scale
//   (asserted), so world error = local error. A float32 allowance of 16 * FLT_EPSILON * (largest
//   |coordinate|) covers the dequantization transforms.
// - Index counts: gltf-transform's `draco` command always welds, which drops triangles whose
//   corners share a position (mug: 784 source triangles, 64 of them degenerate; the Draco file
//   keeps 728). Such zero-area triangles draw nothing, so triangles are compared after dropping
//   degenerate ones; meshopt keeps every triangle, so its index counts must match exactly.
// - Skinned (posed) vertices add the weight error: weights are quantized to Bw bits (meshopt
//   `quantizeWeight: 8`; Draco `quantizeGeneric: 12`), each of the 4 weights errs by half a step
//   and the loader renormalizes (at most doubling it), and a weight error moves a vertex by at most
//   the largest distance D between two copies of it transformed by joints that influence it
//   (computed from the source palette of the current pose; 0 in the bind pose):
//   4 * 2 * 0.5 / (2^Bw - 1) * D. Meshopt also stores rotation keyframes with its QUATERNION filter
//   at 16 bits (grid (1/sqrt 2) / 32767, so <= 0.5 / 32767 error per component; angle error
//   <= 2 * |dq| <= 2 * 2 * 0.5 / 32767 rad), accumulated along the joint chain (J joints) with a
//   lever arm bounded by the posed object's bounds diagonal (the tail's joints lie inside its mesh):
//   J * 2 / 32767 * diagonal.

import { beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MeshoptDecoder } from 'meshoptimizer';
import type { CustomMeshObjectDescriptor } from '../sdk/charturbo';
import { loadGltfModel, gltfRigOf, type GltfDracoDecoder, type GltfHost, type GltfLoadOptions, type GltfLoadResult } from '../sdk/scene-gltf';
import { GltfAnimator, skinPositions, type GltfAnimationHost } from '../sdk/scene-gltf-anim';

const fixtures = new URL('./fixtures/gltf-compressed/', import.meta.url);
const sources = new URL('../../previs/examples/models/', import.meta.url);

const FLT_EPSILON = 2 ** -23;

let draco: GltfDracoDecoder;
beforeAll(async () => {
  // @ts-expect-error draco3d ships no type declarations
  const draco3d: any = await import('draco3d');
  draco = await (draco3d.default ?? draco3d).createDecoderModule({});
  await MeshoptDecoder.ready;
});

const decoders = (): GltfLoadOptions['decoders'] => ({ meshopt: MeshoptDecoder, draco });

// ---------------------------------------------------------------------------
// GLB helpers
// ---------------------------------------------------------------------------

function readFile(url: URL): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(url)));
}

function parseGlb(bytes: Uint8Array): { json: any; bin: Uint8Array } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binStart = 20 + jsonLength;
  const binLength = view.getUint32(binStart, true);
  return { json, bin: bytes.slice(binStart + 8, binStart + 8 + binLength) };
}

function writeGlb(json: unknown, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = Math.ceil(text.length / 4) * 4;
  const binLength = Math.ceil(bin.length / 4) * 4;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.fill(0x20, 20, 20 + jsonLength);
  out.set(text, 20);
  view.setUint32(20 + jsonLength, binLength, true);
  view.setUint32(24 + jsonLength, 0x004e4942, true);
  out.set(bin, 28 + jsonLength);
  return out;
}

// ---------------------------------------------------------------------------
// Mock host (records meshes, mesh matrices and skin palettes)
// ---------------------------------------------------------------------------

function mockHost() {
  let next = 1;
  const meshes = new Map<number, CustomMeshObjectDescriptor>();
  const matrices = new Map<number, Float32Array>();
  const skins = new Map<number, { joints: Uint16Array; weights: Float32Array; jointCount: number; palette: Float32Array }>();
  const host: GltfHost & GltfAnimationHost = {
    maxTextureSize: 0,
    loadTexture: () => Promise.reject(new Error('no textures')),
    disposeTexture: () => true,
    addCustomMesh: (desc) => {
      meshes.set(next, desc);
      return next++;
    },
    removeObject: (id) => meshes.delete(id),
    supportsMeshMatrices: true,
    setObjectMeshMatrices: (ids, mats) => {
      ids.forEach((id, k) => matrices.set(id, mats.slice(k * 16, k * 16 + 16)));
      return true;
    },
    supportsSkinning: true,
    setObjectSkin: (id, skin) => {
      if (!skin) return skins.delete(id);
      skins.set(id, { ...skin, palette: new Float32Array(skin.jointCount * 16) });
      return true;
    },
    setObjectJointMatrices: (ids, counts, mats) => {
      let o = 0;
      ids.forEach((id, k) => {
        skins.get(id)!.palette = mats.slice(o, o + counts[k] * 16);
        o += counts[k] * 16;
      });
      return ids.length;
    },
  };
  /** World-space vertices of an object in the current pose (skin palette, then mesh matrix). */
  const world = (id: number): Float32Array => {
    const desc = meshes.get(id)!;
    let p: Float32Array = Float32Array.from(desc.positions);
    const skin = skins.get(id);
    if (skin) p = skinPositions(p, skin.joints, skin.weights, skin.palette);
    const m = matrices.get(id);
    if (m) {
      const out = new Float32Array(p.length);
      for (let i = 0; i < p.length; i += 3) {
        for (let r = 0; r < 3; r++) out[i + r] = m[r] * p[i] + m[4 + r] * p[i + 1] + m[8 + r] * p[i + 2] + m[12 + r];
      }
      p = out;
    }
    return p;
  };
  const indices = (id: number) => Uint32Array.from(meshes.get(id)!.indices);
  return { host, meshes, skins, world, indices };
}

async function load(bytes: Uint8Array, options: GltfLoadOptions = {}) {
  const mock = mockHost();
  const result = await loadGltfModel(mock.host, bytes, options);
  return { ...mock, result };
}

function animator(m: Awaited<ReturnType<typeof load>>): GltfAnimator {
  return new GltfAnimator(m.host, m.result, gltfRigOf(m.result), { autoUpdate: false }, () => {});
}

// ---------------------------------------------------------------------------
// Geometry comparison
// ---------------------------------------------------------------------------

/**
 * Largest vertex distance between matched triangles: every triangle of `a` is matched with the
 * closest triangle of `b` under a cyclic vertex rotation (winding kept), and vice versa. Vertex
 * order and triangle order may differ (both codecs reorder).
 */
function triangleError(aPos: Float32Array, aIdx: Uint32Array, bPos: Float32Array, bIdx: Uint32Array): number {
  const oneWay = (pPos: Float32Array, pIdx: Uint32Array, qPos: Float32Array, qIdx: Uint32Array) => {
    let worst = 0;
    for (let t = 0; t < pIdx.length; t += 3) {
      let best = Infinity;
      for (let u = 0; u < qIdx.length && best > 0; u += 3) {
        for (let r = 0; r < 3; r++) {
          let err = 0;
          for (let k = 0; k < 3 && err < best; k++) {
            const i = pIdx[t + k] * 3;
            const j = qIdx[u + ((k + r) % 3)] * 3;
            err = Math.max(err, Math.hypot(pPos[i] - qPos[j], pPos[i + 1] - qPos[j + 1], pPos[i + 2] - qPos[j + 2]));
          }
          if (err < best) best = err;
        }
      }
      worst = Math.max(worst, best);
    }
    return worst;
  };
  return Math.max(oneWay(aPos, aIdx, bPos, bIdx), oneWay(bPos, bIdx, aPos, aIdx));
}

function maxAbs(p: Float32Array): number {
  let m = 0;
  for (const v of p) m = Math.max(m, Math.abs(v));
  return m;
}

/** Position tolerance of a source object (see the header): 14-bit quantization + float32 slack. */
function positionTolerance(codec: 'draco' | 'meshopt', sourceJson: any, accessor: number, worldPositions: Float32Array): number {
  const { min, max } = sourceJson.accessors[accessor];
  const extent = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  const perAxis = codec === 'draco' ? (0.5 * extent) / (2 ** 14 - 1) : (extent / 2) * (0.5 / (2 ** 13 - 1) + 1 / 32767);
  return Math.sqrt(3) * perAxis + 16 * FLT_EPSILON * maxAbs(worldPositions);
}

/** Object id -> its glTF primitive (via the result's node list; one object per primitive). */
function primitivesOf(json: any, result: GltfLoadResult): Map<number, any> {
  const out = new Map<number, any>();
  for (const node of result.nodes) {
    const mesh = json.nodes[node.index].mesh;
    node.objectIds.forEach((id, k) => out.set(id, json.meshes[mesh].primitives[k]));
  }
  return out;
}

/** Triangles without two corners at the same position (they draw nothing). */
function solidTriangles(pos: Float32Array, idx: Uint32Array): Uint32Array {
  const same = (a: number, b: number) => pos[a * 3] === pos[b * 3] && pos[a * 3 + 1] === pos[b * 3 + 1] && pos[a * 3 + 2] === pos[b * 3 + 2];
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (!same(a, b) && !same(b, c) && !same(a, c)) out.push(a, b, c);
  }
  return Uint32Array.from(out);
}

type Loaded = Awaited<ReturnType<typeof load>>;

/** Diagonal of the bounding box of `p`. */
function diagonal(p: Float32Array): number {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  return Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
}

/**
 * D of the header: the largest distance between two copies of a vertex transformed by joints that
 * influence it (current palette). A weight error moves a skinned vertex by at most this much.
 */
function jointSpread(bind: Float32Array, skin: { joints: Uint16Array; weights: Float32Array; palette: Float32Array }): number {
  let d = 0;
  const copy = (j: number, v: number) => {
    const m = skin.palette.subarray(j * 16, j * 16 + 16);
    const [x, y, z] = [bind[v * 3], bind[v * 3 + 1], bind[v * 3 + 2]];
    return [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
  };
  for (let v = 0; v < bind.length / 3; v++) {
    const copies: number[][] = [];
    for (let k = 0; k < 4; k++) if (skin.weights[v * 4 + k] > 0) copies.push(copy(skin.joints[v * 4 + k], v));
    for (const a of copies) for (const b of copies) d = Math.max(d, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return d;
}

/** Non-degenerate triangles of two objects in world space (current pose) and their triangle error. */
function compare(src: Loaded, s: number, dst: Loaded, d: number): { error: number; triangles: [number, number] } {
  const [sPos, dPos] = [src.world(s), dst.world(d)];
  const [sIdx, dIdx] = [solidTriangles(sPos, src.indices(s)), solidTriangles(dPos, dst.indices(d))];
  return { error: sIdx.length === dIdx.length ? triangleError(sPos, sIdx, dPos, dIdx) : Infinity, triangles: [sIdx.length / 3, dIdx.length / 3] };
}

/**
 * Pairs every source object with a compressed one (same non-degenerate triangle count, smallest
 * triangle error; the codecs reorder nodes, vertices and triangles). Rest pose, world space.
 */
function pairObjects(src: Loaded, dst: Loaded) {
  const free = new Set(dst.result.objects);
  return src.result.objects.map((s) => {
    let best: { id: number; error: number } | null = null;
    for (const d of free) {
      const { error } = compare(src, s, dst, d);
      if (error < (best?.error ?? Infinity)) best = { id: d, error };
    }
    expect(best, `no compressed object matches source object ${s}`).not.toBeNull();
    free.delete(best!.id);
    return { source: s, compressed: best!.id, error: best!.error };
  });
}

// ---------------------------------------------------------------------------
// Fixtures vs sources
// ---------------------------------------------------------------------------

const MODELS = ['mug', 'walker', 'tail'] as const;
const CODECS = ['draco', 'meshopt'] as const;
/** Weight bits of the codecs (gltf-transform defaults, see the header) */
const WEIGHT_BITS = { draco: 12, meshopt: 8 } as const;

describe('compressed glTF fixtures match their uncompressed sources', () => {
  const cases = MODELS.flatMap((model) => CODECS.map((codec) => [model, codec] as const));

  it.each(cases)('%s.%s.glb', async (model, codec) => {
    const sourceBytes = readFile(new URL(`${model}.glb`, sources));
    const sourceJson = parseGlb(sourceBytes).json;
    // Rigid source nodes: world error = local quantization error
    for (const n of sourceJson.nodes) expect(n.scale === undefined && n.matrix === undefined).toBe(true);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const src = await load(sourceBytes);
    const dstBytes = readFile(new URL(`${model}.${codec}.glb`, fixtures));
    const dstJson = parseGlb(dstBytes).json;
    const dst = await load(dstBytes, { decoders: decoders() });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();

    // Object and index counts
    expect(dst.result.objects).toHaveLength(src.result.objects.length);
    const srcPrims = primitivesOf(sourceJson, src.result);
    const dstPrims = primitivesOf(dstJson, dst.result);
    const skinned = src.skins.size > 0;
    /** Tolerance of a source object in the current pose (see the header) */
    const tolOf = (id: number, posed = false) => {
      const world = src.world(id);
      let tol = positionTolerance(codec, sourceJson, srcPrims.get(id).attributes.POSITION, world);
      const skin = src.skins.get(id);
      if (skin) {
        tol += 4 * 2 * (0.5 / (2 ** WEIGHT_BITS[codec] - 1)) * jointSpread(Float32Array.from(src.meshes.get(id)!.positions), skin);
        if (posed && codec === 'meshopt') tol += ((skin.jointCount * 2) / 32767) * diagonal(world);
      }
      return tol;
    };

    // Rest pose: per-object triangles within the quantization tolerance
    const pairs = pairObjects(src, dst);
    for (const p of pairs) {
      // The loader keeps every index the compressed file declares
      expect(dst.indices(p.compressed).length).toBe(dstJson.accessors[dstPrims.get(p.compressed).indices].count);
      if (codec === 'meshopt') expect(dst.indices(p.compressed).length).toBe(src.indices(p.source).length);
      expect(p.error).toBeLessThanOrEqual(tolOf(p.source));
    }
    // Bounds within the largest object tolerance
    const boundsTol = Math.max(...src.result.objects.map((id) => tolOf(id)));
    for (const k of [0, 1, 2]) {
      expect(Math.abs(dst.result.bounds.min[k] - src.result.bounds.min[k])).toBeLessThanOrEqual(boundsTol);
      expect(Math.abs(dst.result.bounds.max[k] - src.result.bounds.max[k])).toBeLessThanOrEqual(boundsTol);
    }

    // Animations: names and durations equal (time inputs are not quantized)
    expect(dst.result.animations).toEqual(src.result.animations);

    // Skins: joint count equal; posed vertices within tolerance at several clip times
    expect(dst.skins.size).toBe(src.skins.size);
    if (skinned) {
      expect(gltfRigOf(dst.result)!.skins.map((s) => s.joints.length)).toEqual(gltfRigOf(src.result)!.skins.map((s) => s.joints.length));
      const a = animator(src);
      const b = animator(dst);
      for (const clip of src.result.animations) {
        for (const f of [0.17, 0.5, 0.83]) {
          a.play(clip.name, { time: clip.duration * f, loop: 'once' });
          b.play(clip.name, { time: clip.duration * f, loop: 'once' });
          for (const p of pairs) {
            expect(src.skins.has(p.source)).toBe(dst.skins.has(p.compressed));
            expect(compare(src, p.source, dst, p.compressed).error).toBeLessThanOrEqual(tolOf(p.source, true));
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Missing decoders, fallbacks, no-ops, resource cleanup
// ---------------------------------------------------------------------------

describe('compressed glTF without decoders', () => {
  it('rejects required meshopt without options.decoders.meshopt, before creating anything', async () => {
    const m = mockHost();
    await expect(loadGltfModel(m.host, readFile(new URL('mug.meshopt.glb', fixtures)))).rejects.toThrow(
      "loadGltf: EXT_meshopt_compression is required; pass options.decoders.meshopt (MeshoptDecoder from 'meshoptimizer')"
    );
    // A Draco decoder alone does not help
    await expect(loadGltfModel(m.host, readFile(new URL('mug.meshopt.glb', fixtures)), { decoders: { draco } })).rejects.toThrow(
      'EXT_meshopt_compression is required'
    );
    expect(m.meshes.size).toBe(0);
  });

  it('rejects required Draco without options.decoders.draco, before creating anything', async () => {
    const m = mockHost();
    await expect(loadGltfModel(m.host, readFile(new URL('tail.draco.glb', fixtures)), { decoders: { meshopt: MeshoptDecoder } })).rejects.toThrow(
      "loadGltf: KHR_draco_mesh_compression is required; pass options.decoders.draco (the module createDecoderModule() from 'draco3d' resolves to)"
    );
    expect(m.meshes.size).toBe(0);
  });

  it('meshopt used but not required: reads the uncompressed fallback buffer when it has data', async () => {
    const { json, bin } = parseGlb(readFile(new URL('mug.meshopt.glb', fixtures)));
    // Build the fallback buffer the spec allows (decoded bytes at each bufferView's offset)
    const fallbackIndex = json.buffers.findIndex((b: any) => b.extensions?.EXT_meshopt_compression?.fallback);
    const fallback = new Uint8Array(json.buffers[fallbackIndex].byteLength);
    for (const view of json.bufferViews) {
      const ext = view.extensions?.EXT_meshopt_compression;
      if (!ext) continue;
      const target = new Uint8Array(ext.count * ext.byteStride);
      MeshoptDecoder.decodeGltfBuffer(target, ext.count, ext.byteStride, bin.subarray(ext.byteOffset ?? 0, (ext.byteOffset ?? 0) + ext.byteLength), ext.mode, ext.filter);
      fallback.set(target, view.byteOffset ?? 0);
    }
    json.extensionsRequired = json.extensionsRequired.filter((e: string) => e !== 'EXT_meshopt_compression');
    json.buffers[fallbackIndex].uri = `data:application/octet-stream;base64,${Buffer.from(fallback).toString('base64')}`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plain = await load(writeGlb(json, bin));
    expect(warn).toHaveBeenCalledWith(
      'loadGltf: extension EXT_meshopt_compression is used without options.decoders.meshopt; the uncompressed fallback data is read'
    );
    warn.mockRestore();
    const decoded = await load(readFile(new URL('mug.meshopt.glb', fixtures)), { decoders: decoders() });
    expect(plain.result.objects).toHaveLength(1);
    const [a, b] = [plain.result.objects[0], decoded.result.objects[0]];
    expect(Array.from(plain.world(a))).toEqual(Array.from(decoded.world(b)));
    expect(Array.from(plain.indices(a))).toEqual(Array.from(decoded.indices(b)));
  });

  it('meshopt used but not required, fallback without data: rejects when a view is read', async () => {
    const { json, bin } = parseGlb(readFile(new URL('mug.meshopt.glb', fixtures)));
    json.extensionsRequired = json.extensionsRequired.filter((e: string) => e !== 'EXT_meshopt_compression');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const m = mockHost();
    await expect(loadGltfModel(m.host, writeGlb(json, bin))).rejects.toThrow(
      "loadGltf: EXT_meshopt_compression is required; pass options.decoders.meshopt (MeshoptDecoder from 'meshoptimizer')"
    );
    warn.mockRestore();
    expect(m.meshes.size).toBe(0);
  });

  it('Draco used but not required without fallback accessors: rejects', async () => {
    const { json, bin } = parseGlb(readFile(new URL('mug.draco.glb', fixtures)));
    json.extensionsRequired = [];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(loadGltfModel(mockHost().host, writeGlb(json, bin))).rejects.toThrow('KHR_draco_mesh_compression is required; pass options.decoders.draco');
    warn.mockRestore();
  });

  it('rejects decoder objects of the wrong shape', async () => {
    const bytes = readFile(new URL('mug.glb', sources));
    await expect(loadGltfModel(mockHost().host, bytes, { decoders: { meshopt: {} as never } })).rejects.toThrow(
      "loadGltf: options.decoders.meshopt must be the MeshoptDecoder from 'meshoptimizer'"
    );
    await expect(loadGltfModel(mockHost().host, bytes, { decoders: { draco: {} as never } })).rejects.toThrow(
      "loadGltf: options.decoders.draco must be the module createDecoderModule() from 'draco3d' resolves to"
    );
  });
});

describe('decoders on files without compression', () => {
  it('are a no-op (never called; same result)', async () => {
    const meshopt = { ready: Promise.resolve(), decodeGltfBuffer: vi.fn() };
    const Decoder = vi.fn();
    const Mesh = vi.fn();
    const fakeDraco = { Decoder, Mesh, destroy: vi.fn(), _malloc: vi.fn(), _free: vi.fn() } as unknown as GltfDracoDecoder;
    for (const model of MODELS) {
      const bytes = readFile(new URL(`${model}.glb`, sources));
      const plain = await load(bytes);
      const withDecoders = await load(bytes, { decoders: { meshopt, draco: fakeDraco } });
      expect(withDecoders.result.objects).toHaveLength(plain.result.objects.length);
      expect(withDecoders.result.bounds).toEqual(plain.result.bounds);
      expect(withDecoders.result.animations).toEqual(plain.result.animations);
      plain.result.objects.forEach((id, k) => {
        expect(Array.from(withDecoders.world(withDecoders.result.objects[k]))).toEqual(Array.from(plain.world(id)));
      });
    }
    expect(meshopt.decodeGltfBuffer).not.toHaveBeenCalled();
    expect(Decoder).not.toHaveBeenCalled();
    expect(Mesh).not.toHaveBeenCalled();
  });
});

describe('Draco resources', () => {
  it('destroys the decoder and every decoded mesh', async () => {
    const destroy = vi.spyOn(draco, 'destroy');
    try {
      const bytes = readFile(new URL('walker.draco.glb', fixtures));
      await load(bytes, { decoders: { draco } });
      const primitives = parseGlb(bytes).json.meshes.reduce((n: number, m: any) => n + m.primitives.length, 0);
      expect(primitives).toBe(7);
      const objects = destroy.mock.calls.map((c) => c[0]);
      expect(objects.filter((o) => o instanceof draco.Decoder)).toHaveLength(1);
      // One Draco mesh per decoded primitive (each glTF mesh once, even when several nodes use it)
      expect(objects.filter((o) => o instanceof draco.Mesh)).toHaveLength(primitives);
      expect(objects).toHaveLength(1 + primitives);
    } finally {
      destroy.mockRestore();
    }
  });

  it('destroys them when decoding fails', async () => {
    const { json, bin } = parseGlb(readFile(new URL('mug.draco.glb', fixtures)));
    const pos = json.meshes[0].primitives[0].attributes.POSITION;
    json.accessors[pos].count += 1;
    const destroy = vi.spyOn(draco, 'destroy');
    try {
      await expect(loadGltfModel(mockHost().host, writeGlb(json, bin), { decoders: { draco } })).rejects.toThrow(/Draco POSITION has \d+ points, accessor \d+ declares \d+/);
      const objects = destroy.mock.calls.map((c) => c[0]);
      expect(objects.filter((o) => o instanceof draco.Decoder)).toHaveLength(1);
      expect(objects.filter((o) => o instanceof draco.Mesh)).toHaveLength(1);
    } finally {
      destroy.mockRestore();
    }
  });
});

describe('decoder input hardening', () => {
  const meshoptViews = (json: any) => json.bufferViews.filter((v: any) => v.extensions?.EXT_meshopt_compression);
  const meshoptCase = async (mutate: (ext: any, view: any, json: any) => void, message: RegExp | string) => {
    const { json, bin } = parseGlb(readFile(new URL('mug.meshopt.glb', fixtures)));
    // every compressed view is mutated, so whichever is decoded first fails before the decoder is called
    for (const view of meshoptViews(json)) mutate(view.extensions.EXT_meshopt_compression, view, json);
    const spy = vi.spyOn(MeshoptDecoder, 'decodeGltfBuffer');
    try {
      await expect(loadGltfModel(mockHost().host, writeGlb(json, bin), { decoders: { meshopt: MeshoptDecoder } })).rejects.toThrow(message);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  };

  it('meshopt: count * byteStride must equal the bufferView byteLength (no decode, no allocation)', async () => {
    const before = process.memoryUsage().rss;
    await meshoptCase((ext) => (ext.count = 1_000_000), /bufferView \d+: EXT_meshopt_compression count 1000000 \* byteStride \d+ must equal the bufferView byteLength \d+/);
    // a huge count is rejected by the cap, a below-cap mismatch by the equality check; neither grows memory
    await meshoptCase((ext) => (ext.count = 100_000_000), /EXT_meshopt_compression count 100000000 exceeds the limit/);
    expect(process.memoryUsage().rss - before).toBeLessThan(200 * 1024 * 1024);
  });

  it('meshopt: stride rules per mode', async () => {
    const modeOf = (ext: any) => ext.mode;
    await meshoptCase((ext, view) => {
      if (modeOf(ext) !== 'ATTRIBUTES') return;
      ext.byteStride = 6;
      view.byteLength = ext.count * 6;
    }, /byteStride 6 must be divisible by 4 and at most 256 in ATTRIBUTES mode/);
    await meshoptCase((ext, view) => {
      ext.byteStride = 260;
      view.byteLength = ext.count * 260;
    }, /byteStride 260 must be divisible by 4 and at most 256 in ATTRIBUTES mode/);
    for (const mode of ['TRIANGLES', 'INDICES']) {
      await meshoptCase((ext, view) => {
        ext.mode = mode;
        ext.byteStride = 8;
        ext.count = 3;
        view.byteLength = 24;
      }, new RegExp(`byteStride 8 must be 2 or 4 in ${mode} mode`));
    }
    await meshoptCase((ext, view) => {
      ext.mode = 'TRIANGLES';
      ext.byteStride = 4;
      ext.count = 4;
      view.byteLength = 16;
    }, /count 4 must be divisible by 3 in TRIANGLES mode/);
  });

  it('meshopt: unknown filter and cap', async () => {
    await meshoptCase((ext) => (ext.filter = 'COLOR'), /bufferView \d+: EXT_meshopt_compression has an unknown filter COLOR/);
    await meshoptCase((ext) => (ext.filter = 'BOGUS'), /has an unknown filter BOGUS/);
    await meshoptCase(
      (ext, view) => {
        ext.mode = 'INDICES';
        ext.byteStride = 4;
        ext.count = 67_108_865;
        view.byteLength = ext.count * 4;
      },
      /EXT_meshopt_compression count 67108865 exceeds the limit of 67108864/
    );
    await meshoptCase((ext) => (ext.count = 8_388_609), /count 8388609 exceeds the limit of 8388608/);
  });

  /** A fake draco module: a mesh with the given sizes, `_malloc` stubbed. */
  function fakeDraco(points: number, faces: number, malloc: (n: number) => number) {
    const destroy = vi.fn();
    const _malloc = vi.fn(malloc);
    const _free = vi.fn();
    class Mesh {
      ptr = 1;
      num_points = () => points;
      num_faces = () => faces;
    }
    class Decoder {
      DecodeArrayToMesh = () => ({ ok: () => true, error_msg: () => '' });
      GetAttributeByUniqueId = () => ({ ptr: 1, num_components: () => 3 });
      GetAttributeDataArrayForAllPoints = () => true;
      GetTrianglesUInt16Array = () => true;
      GetTrianglesUInt32Array = () => true;
    }
    const module = { Decoder, Mesh, destroy, _malloc, _free, HEAPU8: new Uint8Array(16), DT_INT8: 0, DT_UINT8: 1, DT_INT16: 2, DT_UINT16: 3, DT_UINT32: 4, DT_FLOAT32: 5 };
    return { module: module as unknown as GltfDracoDecoder, destroy, _malloc, _free };
  }

  const dracoGlb = (adjust?: (json: any) => void) => {
    const { json, bin } = parseGlb(readFile(new URL('mug.draco.glb', fixtures)));
    adjust?.(json);
    return writeGlb(json, bin);
  };

  it('Draco: a huge point or face count is rejected before _malloc', async () => {
    for (const [points, faces, what] of [
      [100_000_000, 1, /Draco mesh has 100000000 points; the limit is 8388608/],
      [3, 30_000_000, /Draco mesh has 90000000 indices; the limit is 67108864/],
    ] as const) {
      const f = fakeDraco(points, faces, () => 8);
      await expect(loadGltfModel(mockHost().host, dracoGlb(), { decoders: { draco: f.module } })).rejects.toThrow(what);
      expect(f._malloc).not.toHaveBeenCalled();
      expect(f._free).not.toHaveBeenCalled();
      // decoder and mesh are still destroyed
      expect(f.destroy).toHaveBeenCalledTimes(2);
    }
  });

  it('Draco: _malloc returning 0 is a clean error, destroy still runs, no _free', async () => {
    const f = fakeDraco(3, 1, () => 0);
    // make the accessor counts match the fake mesh so decoding reaches _malloc
    const glb = dracoGlb((json) => {
      const prim = json.meshes[0].primitives[0];
      for (const a of Object.values(prim.attributes) as number[]) json.accessors[a].count = 3;
      json.accessors[prim.indices].count = 3;
    });
    await expect(loadGltfModel(mockHost().host, glb, { decoders: { draco: f.module } })).rejects.toThrow(/Draco decoder out of memory/);
    expect(f._malloc).toHaveBeenCalled();
    expect(f._free).not.toHaveBeenCalled();
    expect(f.destroy).toHaveBeenCalledTimes(2);
  });
});
