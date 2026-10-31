import { afterEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { loopTime, sampleGltfSampler, slerpInto, type GltfSampler } from '../sdk/scene-gltf-anim';

// ---------------------------------------------------------------------------
// Mock backend with mesh matrices
// ---------------------------------------------------------------------------

function animBackend(options: { meshMatrices?: boolean } = {}) {
  let nextObject = 1;
  const matrices = new Map<number, Float32Array>();
  const batches: { ids: number[]; floats: number }[] = [];
  const removed: number[] = [];
  const base: Record<string, unknown> = {
    add_primitive: () => nextObject++,
    add_custom_mesh: () => nextObject++,
    set_object_transform: () => true,
    get_object_transform: () => new Float32Array(0),
    set_object_material: () => true,
    set_object_physics: () => true,
    set_object_angular_velocity: () => true,
    set_object_parent: () => true,
    remove_object: (id: number) => {
      removed.push(id);
      matrices.delete(id);
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
  };
  if (options.meshMatrices !== false) {
    base.set_object_mesh_matrices = (ids: Uint32Array, mats: Float32Array) => {
      batches.push({ ids: Array.from(ids), floats: mats.length });
      ids.forEach((id, k) => matrices.set(id, mats.slice(k * 16, k * 16 + 16)));
      return ids.length;
    };
  }
  const backend = base as unknown as WasmCharturboEngineBackend;
  return { backend, matrices, batches, removed, sdk: Charturbo.fromBackend(backend) };
}

/** Accumulates a binary buffer with 4-byte aligned bufferViews (base64 data URI). */
class Bin {
  private parts: number[] = [];
  readonly bufferViews: Record<string, number>[] = [];
  readonly accessors: Record<string, unknown>[] = [];

  accessor(data: Float32Array | Int16Array | Uint16Array, type: string, extra: Record<string, unknown> = {}): number {
    while (this.parts.length % 4) this.parts.push(0);
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.bufferViews.push({ buffer: 0, byteOffset: this.parts.length, byteLength: bytes.byteLength });
    this.parts.push(...bytes);
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type]!;
    const componentType = data instanceof Float32Array ? 5126 : data instanceof Int16Array ? 5122 : 5123;
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
      buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${btoa(String.fromCharCode(...bytes))}` }],
    };
    return new TextEncoder().encode(JSON.stringify(json)).buffer;
  }
}

const S45 = Math.SQRT1_2;
/** Quaternion of `deg` degrees about +Y */
const qy = (deg: number) => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];

/**
 * root (translation 0,1,0) -> arm (animated rotation about Y: 0 -> 90 deg over 1 s) -> tip
 * (translation 2,0,0, mesh) plus a static node with a mesh. Clip 1 ('lift') translates the arm.
 */
function armModel(opts: { quantized?: boolean; extraAnimations?: unknown[] } = {}) {
  const bin = new Bin();
  const pos = bin.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { min: [0, 0, 0], max: [1, 1, 0] });
  const idx = bin.accessor(new Uint16Array([0, 1, 2, 0]).subarray(0, 3), 'SCALAR');
  const times = bin.accessor(new Float32Array([0, 1]), 'SCALAR');
  const rot = opts.quantized
    ? bin.accessor(Int16Array.from([...qy(0), ...qy(90)].map((v) => Math.round(v * 32767))), 'VEC4', { normalized: true })
    : bin.accessor(new Float32Array([...qy(0), ...qy(90)]), 'VEC4');
  const lift = bin.accessor(new Float32Array([0, 0, 0, 0, 3, 0]), 'VEC3');
  return bin.gltf({
    scene: 0,
    scenes: [{ nodes: [0, 3] }],
    nodes: [
      { name: 'root', translation: [0, 1, 0], children: [1] },
      { name: 'arm', children: [2] },
      { name: 'tip', translation: [2, 0, 0], mesh: 0 },
      { name: 'base', translation: [5, 0, 0], mesh: 0 },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: pos }, indices: idx }] }],
    animations: [
      { name: 'spin', channels: [{ sampler: 0, target: { node: 1, path: 'rotation' } }], samplers: [{ input: times, output: rot }] },
      { name: 'lift', channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }], samplers: [{ input: times, output: lift, interpolation: 'STEP' }] },
      ...(opts.extraAnimations ?? []),
    ],
  });
}

/** World position of local point p under a column-major matrix */
const apply = (m: ArrayLike<number>, p: number[]) => [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
const close = (a: ArrayLike<number>, b: number[], digits = 4) => {
  expect(a.length).toBe(b.length);
  Array.from(a).forEach((v, i) => expect(v).toBeCloseTo(b[i], digits));
};

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Sampler math
// ---------------------------------------------------------------------------

describe('glTF animation samplers', () => {
  const vec3 = (interpolation: GltfSampler['interpolation'], input: number[], output: number[]): GltfSampler => ({
    input: new Float32Array(input),
    output: new Float32Array(output),
    interpolation,
    size: 3,
  });

  it('LINEAR lerps and clamps outside the keyframes', () => {
    const s = vec3('LINEAR', [1, 3], [0, 0, 0, 2, 4, -6]);
    const out = [0, 0, 0];
    sampleGltfSampler(s, 2, out);
    close(out, [1, 2, -3]);
    sampleGltfSampler(s, 0, out);
    close(out, [0, 0, 0]);
    sampleGltfSampler(s, 9, out);
    close(out, [2, 4, -6]);
  });

  it('STEP holds the previous key', () => {
    const s = vec3('STEP', [0, 1, 2], [0, 0, 0, 1, 1, 1, 2, 2, 2]);
    const out = [0, 0, 0];
    sampleGltfSampler(s, 0.99, out);
    close(out, [0, 0, 0]);
    sampleGltfSampler(s, 1, out);
    close(out, [1, 1, 1]);
    sampleGltfSampler(s, 1.5, out);
    close(out, [1, 1, 1]);
  });

  it('CUBICSPLINE uses the glTF tangent layout scaled by the key interval', () => {
    // in-tangent, value, out-tangent per key; tangents of the line x = t / 2 reproduce it exactly
    const s = vec3('CUBICSPLINE', [0, 2], [9, 9, 9, 0, 0, 0, 0.5, 0, 0, 0.5, 0, 0, 1, 0, 0, 9, 9, 9]);
    const out = [0, 0, 0];
    for (const t of [0.25, 1, 1.5]) {
      sampleGltfSampler(s, t, out);
      close(out, [t / 2, 0, 0]);
    }
    // Zero tangents: smoothstep
    const flat = vec3('CUBICSPLINE', [0, 1], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
    sampleGltfSampler(flat, 0.25, out);
    expect(out[0]).toBeCloseTo(3 * 0.0625 - 2 * 0.015625, 6);
    // Ends take the key values, not the tangents
    sampleGltfSampler(flat, 5, out);
    close(out, [1, 0, 0]);
  });

  it('CUBICSPLINE rotations come out normalized', () => {
    const s: GltfSampler = {
      input: new Float32Array([0, 1]),
      output: new Float32Array([0, 0, 0, 0, ...qy(0), 0, 2, 0, 0, 0, 2, 0, 0, ...qy(120), 0, 0, 0, 0]),
      interpolation: 'CUBICSPLINE',
      size: 4,
    };
    const out = [0, 0, 0, 0];
    sampleGltfSampler(s, 0.4, out);
    expect(Math.hypot(...out)).toBeCloseTo(1, 6);
  });

  it('slerp takes the shortest path and LINEAR rotations slerp', () => {
    const out = [0, 0, 0, 0];
    // -q90 is the same rotation as q90: halfway must be +45 deg, not through 225 deg
    slerpInto(qy(0), 0, qy(90).map((v) => -v), 0, 0.5, out);
    close(out, qy(45));
    slerpInto(qy(0), 0, qy(90), 0, 0.5, out);
    close(out, qy(45));
    // Constant angular velocity (slerp, not nlerp)
    slerpInto(qy(0), 0, qy(160), 0, 0.25, out);
    close(out, qy(40));
    const s: GltfSampler = { input: new Float32Array([0, 1]), output: new Float32Array([...qy(0), ...qy(90)]), interpolation: 'LINEAR', size: 4 };
    sampleGltfSampler(s, 0.5, out);
    close(out, qy(45));
  });

  it('loop modes map elapsed time onto the clip', () => {
    expect(loopTime(2.5, 2, 'repeat')).toBeCloseTo(0.5);
    expect(loopTime(2, 2, 'repeat')).toBe(2);
    expect(loopTime(0, 2, 'repeat')).toBe(0);
    expect(loopTime(-0.5, 2, 'repeat')).toBeCloseTo(1.5);
    expect(loopTime(3, 2, 'once')).toBe(2);
    expect(loopTime(-1, 2, 'once')).toBe(0);
    expect(loopTime(2.5, 2, 'pingpong')).toBeCloseTo(1.5);
    expect(loopTime(4.5, 2, 'pingpong')).toBeCloseTo(0.5);
    expect(loopTime(-0.5, 2, 'pingpong')).toBeCloseTo(0.5);
    expect(loopTime(1, 0, 'repeat')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Loader + animator
// ---------------------------------------------------------------------------

describe('glTF animation playback', () => {
  it('keeps animated subtrees node-local with a rest-pose mesh matrix; static nodes stay baked', async () => {
    const { sdk, matrices, batches } = animBackend();
    const model = await sdk.loadGltf(armModel(), { scale: 2, position: [10, 0, 0] });
    expect(model.animations).toEqual([
      { name: 'spin', duration: 1 },
      { name: 'lift', duration: 1 },
    ]);
    const [tip, base] = model.objects;
    // Node-local vertices + one batched rest-pose call for the animated object only
    expect(sdk.getObjectRecord(tip)!.customMesh!.positions).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(batches).toEqual([{ ids: [tip], floats: 16 }]);
    close(apply(matrices.get(tip)!, [0, 0, 0]), [4, 2, 0]); // scale 2 x (0,1,0) x (2,0,0)
    expect(sdk.getObjectRecord(tip)!.position).toEqual([10, 0, 0]);
    // The static mesh is baked like before and has no mesh matrix
    expect(sdk.getObjectRecord(base)!.customMesh!.positions).toEqual([10, 0, 0, 12, 0, 0, 10, 2, 0]);
    expect(sdk.getObjectRecord(base)!.meshMatrix).toBeNull();
    expect(matrices.has(base)).toBe(false);
    // Bounds use the rest pose
    expect(model.bounds).toEqual({ min: [14, 0, 0], max: [22, 4, 0] });
  });

  it('composes root x animated node x child chain on seek (deterministic)', async () => {
    const { sdk, matrices } = animBackend();
    const model = await sdk.loadGltf(armModel(), { scale: 2 });
    const tip = model.objects[0];
    const anim = sdk.createGltfAnimator(model, { autoUpdate: false });
    anim.play('spin').pause();
    anim.seek(1);
    close(apply(matrices.get(tip)!, [0, 0, 0]), [0, 2, -4]); // Ry(90) maps +x to -z
    close(apply(matrices.get(tip)!, [1, 0, 0]), [0, 2, -6]);
    anim.seek(0.5);
    const a = Array.from(matrices.get(tip)!);
    close(apply(a, [0, 0, 0]), [4 * S45, 2, -4 * S45]);
    // Same time, same matrix, whatever the path
    anim.seek(0.2).seek(0.9).seek(0.5);
    expect(Array.from(matrices.get(tip)!)).toEqual(a);
    anim.seek(0).play('spin');
    anim.update(0.25).update(0.25);
    close(Array.from(matrices.get(tip)!), a, 5);
    expect(sdk.getObjectRecord(tip)!.meshMatrix).toEqual(a);
  });

  it('STEP clips, weight blending and stop (rest pose)', async () => {
    const { sdk, matrices } = animBackend();
    const model = await sdk.loadGltf(armModel());
    const tip = model.objects[0];
    const anim = sdk.createGltfAnimator(model, { autoUpdate: false });
    anim.play(1).seek(0.99);
    close(apply(matrices.get(tip)!, [0, 0, 0]), [2, 1, 0]);
    anim.seek(1);
    close(apply(matrices.get(tip)!, [0, 0, 0]), [2, 4, 0]);
    anim.play('spin', { weight: 0.5 }).seek(1);
    close(apply(matrices.get(tip)!, [0, 0, 0]), [2 * S45, 1, -2 * S45]); // half of 90 deg
    anim.weight = 0;
    close(apply(matrices.get(tip)!, [0, 0, 0]), [2, 1, 0]);
    anim.weight = 1;
    anim.stop();
    expect(anim.clip).toBeNull();
    close(apply(matrices.get(tip)!, [0, 0, 0]), [2, 1, 0]);
    expect(() => (anim.weight = 2)).toThrow(/weight/);
    expect(() => anim.play('nope')).toThrow(/no animation named 'nope'/);
    expect(() => anim.play(5)).toThrow(/does not exist/);
  });

  it('loop modes: repeat wraps, once stops at the end, pingpong bounces, negative speed', async () => {
    const { sdk } = animBackend();
    const model = await sdk.loadGltf(armModel());
    const anim = sdk.createGltfAnimator(model, { autoUpdate: false });
    anim.play('spin');
    anim.update(1.25);
    expect(anim.time).toBeCloseTo(0.25);
    anim.play('spin', { loop: 'once' }).update(0.75).update(0.75);
    expect(anim.time).toBe(1);
    expect(anim.playing).toBe(false);
    anim.resume();
    expect(anim.playing).toBe(true);
    expect(anim.time).toBe(0);
    anim.play('spin', { loop: 'pingpong', speed: 2 }).update(0.75);
    expect(anim.time).toBeCloseTo(0.5);
    anim.play('spin', { loop: 'once', speed: -1 });
    expect(anim.time).toBe(1);
    anim.update(0.4);
    expect(anim.time).toBeCloseTo(0.6);
    anim.update(1);
    expect(anim.time).toBe(0);
    expect(anim.playing).toBe(false);
  });

  it('advances on render() with the wall clock (first frame only anchors)', async () => {
    const { sdk } = animBackend();
    const model = await sdk.loadGltf(armModel());
    const now = vi.spyOn(performance, 'now');
    const anim = sdk.playGltfAnimation(model, 'spin');
    expect(sdk.playGltfAnimation(model, 0)).toBe(anim);
    now.mockReturnValue(1000);
    sdk.render();
    expect(anim.time).toBe(0);
    now.mockReturnValue(1050);
    sdk.render();
    expect(anim.time).toBeCloseTo(0.05);
    // Long stalls advance at most 0.1 s
    now.mockReturnValue(9000);
    sdk.render();
    expect(anim.time).toBeCloseTo(0.15);
    anim.pause();
    now.mockReturnValue(9500);
    sdk.render();
    expect(anim.time).toBeCloseTo(0.15);
  });

  it('disposeGltf stops and detaches the model animators', async () => {
    const { sdk, batches, removed } = animBackend();
    const model = await sdk.loadGltf(armModel());
    const anim = sdk.playGltfAnimation(model, 'spin', { loop: 'pingpong' });
    const other = sdk.createGltfAnimator(model);
    sdk.disposeGltf(model);
    expect(removed).toEqual(model.objects);
    expect(anim.playing).toBe(false);
    expect(() => anim.seek(0)).toThrow(/disposed/);
    expect(() => other.play(0)).toThrow(/disposed/);
    const n = batches.length;
    sdk.render();
    sdk.render();
    expect(batches.length).toBe(n);
    expect(() => {
      anim.weight = 0.5;
    }).toThrow(/disposed/);
    expect(() => {
      anim.loop = 'once';
    }).toThrow(/disposed/);
    expect(batches.length).toBe(n);
  });

  it('clearScene disposes every animator', async () => {
    const { sdk, batches } = animBackend();
    const model = await sdk.loadGltf(armModel());
    const anim = sdk.playGltfAnimation(model, 'spin');
    sdk.clearScene();
    expect(() => anim.seek(0)).toThrow(/disposed/);
    const n = batches.length;
    anim.autoUpdate = true;
    sdk.render();
    sdk.render();
    expect(batches.length).toBe(n);
  });

  it('exportScene bakes the current pose (clips are not exported)', async () => {
    const { sdk } = animBackend();
    const model = await sdk.loadGltf(armModel());
    sdk.createGltfAnimator(model, { autoUpdate: false }).play('spin').seek(1);
    const exported = sdk.exportScene().objects.find((o) => o.name === 'tip')!;
    expect(exported.kind).toBe('custom');
    const positions = (exported as { positions: number[] }).positions;
    close(positions.slice(0, 3), [0, 1, -2]);
    close(positions.slice(3, 6), [0, 1, -3]);
  });

  it('reads normalized-integer rotation keys (KHR_mesh_quantization)', async () => {
    const { sdk, matrices } = animBackend();
    const model = await sdk.loadGltf(armModel({ quantized: true }));
    sdk.createGltfAnimator(model, { autoUpdate: false }).play('spin').seek(0.5);
    close(apply(matrices.get(model.objects[0])!, [0, 0, 0]), [2 * S45, 1, -2 * S45], 3);
  });

  it('warns about morph weights and invalid samplers and skips those channels', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = animBackend();
    const model = await sdk.loadGltf(
      armModel({
        extraAnimations: [
          { channels: [{ sampler: 0, target: { node: 2, path: 'weights' } }], samplers: [{ input: 2, output: 3 }] },
          { channels: [{ sampler: 0, target: { node: 2, path: 'translation' } }], samplers: [{ input: 2, output: 3, interpolation: 'CUBICSPLINE' }] },
        ],
      })
    );
    expect(model.animations.map((a) => a.name)).toEqual(['spin', 'lift', 'animation 2', 'animation 3']);
    expect(model.animations[2].duration).toBe(0);
    const messages = warn.mock.calls.map((c) => String(c[0]));
    expect(messages.some((m) => m.includes('morph target weight animations are not supported'))).toBe(true);
    expect(messages.some((m) => m.includes('animation 3 sampler 0 output has 2 values, expected 6'))).toBe(true);
  });

  it('without engine support (or animations: false) bakes the rest pose like before', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const old = animBackend({ meshMatrices: false });
    expect(old.sdk.supportsMeshMatrices).toBe(false);
    const a = await old.sdk.loadGltf(armModel());
    expect(a.animations).toEqual([]);
    expect(old.sdk.getObjectRecord(a.objects[0])!.customMesh!.positions).toEqual([2, 1, 0, 3, 1, 0, 2, 2, 0]);
    expect(warn.mock.calls.map((c) => String(c[0]))).toContain('loadGltf: animations are not supported and are ignored');
    expect(() => old.sdk.createGltfAnimator(a).play(0)).toThrow(/does not exist/);

    const off = animBackend();
    const b = await off.sdk.loadGltf(armModel(), { animations: false });
    expect(b.animations).toEqual([]);
    expect(off.batches).toEqual([]);
    expect(off.sdk.getObjectRecord(b.objects[0])!.customMesh!.positions).toEqual([2, 1, 0, 3, 1, 0, 2, 2, 0]);
  });

  it('updates ~200 animated nodes with one batched engine call', async () => {
    // A chain of 200 animated nodes, one triangle each
    const bin = new Bin();
    const pos = bin.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { min: [0, 0, 0], max: [1, 1, 0] });
    const times = bin.accessor(new Float32Array([0, 0.5, 1]), 'SCALAR');
    const rot = bin.accessor(new Float32Array([...qy(0), ...qy(10), ...qy(20)]), 'VEC4');
    const N = 200;
    const nodes = Array.from({ length: N }, (_, i) => ({ translation: [0.1, 0, 0], mesh: 0, ...(i + 1 < N ? { children: [i + 1] } : {}) }));
    const file = bin.gltf({
      scenes: [{ nodes: [0] }],
      nodes,
      meshes: [{ primitives: [{ attributes: { POSITION: pos } }] }],
      animations: [{ channels: nodes.map((_, i) => ({ sampler: 0, target: { node: i, path: 'rotation' } })), samplers: [{ input: times, output: rot }] }],
    });
    const { sdk, batches } = animBackend();
    const model = await sdk.loadGltf(file);
    expect(model.objects).toHaveLength(N);
    const anim = sdk.createGltfAnimator(model, { autoUpdate: false }).play(0);
    batches.length = 0;
    const frames = 200;
    const t0 = performance.now();
    for (let f = 0; f < frames; f++) anim.update(1 / 60);
    const perFrame = (performance.now() - t0) / frames;
    expect(batches).toHaveLength(frames);
    expect(batches[0]).toEqual({ ids: model.objects, floats: N * 16 });
    console.info(`glTF animation: ${N} animated nodes, ${perFrame.toFixed(3)} ms per update (JS pose + batch)`);
    expect(perFrame).toBeLessThan(5);
  });
});
