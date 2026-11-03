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
function armModel(
  opts: {
    quantized?: boolean;
    extraAnimations?: unknown[];
    /** Node names (default root, arm, tip, base; null = unnamed) */
    names?: (string | null)[];
    /** root given by a `matrix` (same transform) */
    rootMatrix?: boolean;
    /** base is a child of root (static mesh inside root's subtree) */
    baseUnderRoot?: boolean;
    /** Adds node 4 'socket' (translation 0,0,1, no mesh) as the last child of root: a static mesh-less node */
    socket?: boolean;
  } = {}
) {
  const bin = new Bin();
  const pos = bin.accessor(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 'VEC3', { min: [0, 0, 0], max: [1, 1, 0] });
  const idx = bin.accessor(new Uint16Array([0, 1, 2, 0]).subarray(0, 3), 'SCALAR');
  const times = bin.accessor(new Float32Array([0, 1]), 'SCALAR');
  const rot = opts.quantized
    ? bin.accessor(Int16Array.from([...qy(0), ...qy(90)].map((v) => Math.round(v * 32767))), 'VEC4', { normalized: true })
    : bin.accessor(new Float32Array([...qy(0), ...qy(90)]), 'VEC4');
  const lift = bin.accessor(new Float32Array([0, 0, 0, 0, 3, 0]), 'VEC3');
  const names = opts.names ?? ['root', 'arm', 'tip', 'base'];
  const named = (k: number) => (names[k] !== null ? { name: names[k] } : {});
  const rootTransform = opts.rootMatrix ? { matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1] } : { translation: [0, 1, 0] };
  const rootChildren = [1, ...(opts.baseUnderRoot ? [3] : []), ...(opts.socket ? [4] : [])];
  return bin.gltf({
    scene: 0,
    scenes: [{ nodes: opts.baseUnderRoot ? [0] : [0, 3] }],
    nodes: [
      { ...named(0), ...rootTransform, children: rootChildren },
      { ...named(1), children: [2] },
      { ...named(2), translation: [2, 0, 0], mesh: 0 },
      { ...named(3), translation: [5, 0, 0], mesh: 0 },
      ...(opts.socket ? [{ name: 'socket', translation: [0, 0, 1] }] : []),
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

// ---------------------------------------------------------------------------
// Weighted multi-clip blending (setBlend)
// ---------------------------------------------------------------------------

describe('glTF clip blending (setBlend)', () => {
  /** Tip origin with the arm rotated `deg` about +Y and translated by `ty` (armModel, scale 1) */
  const tipAt = (deg: number, ty = 0) => {
    const r = (deg * Math.PI) / 180;
    return [2 * Math.cos(r), 1 + ty, -2 * Math.sin(r)];
  };

  async function setup() {
    const env = animBackend();
    const model = await env.sdk.loadGltf(armModel());
    const anim = env.sdk.createGltfAnimator(model, { autoUpdate: false });
    const tip = model.objects[0];
    const mat = () => Array.from(env.matrices.get(tip)!);
    return { ...env, model, anim, tip, mat };
  }

  it('one entry equals play(clip, { loop }) + seek(time) bit for bit', async () => {
    const { anim, mat, batches, tip } = await setup();
    for (const loop of ['repeat', 'once', 'pingpong'] as const) {
      for (const time of [0, 0.3, 1, 1.25, -0.4, 2.7]) {
        for (const clip of ['spin', 'lift', 0] as const) {
          anim.play(clip, { loop }).seek(time);
          const expected = mat();
          const n = batches.length;
          // Any positive weight normalizes to 1
          anim.setBlend([{ clip, time, weight: 0.3, loop }]);
          expect(batches.length).toBe(n + 1); // one batched call
          expect(batches.at(-1)).toEqual({ ids: [tip], floats: 16 });
          expect(mat()).toEqual(expected);
        }
      }
    }
  });

  it('two entries with weights 0 / 1 equal each clip exactly', async () => {
    const { anim, mat } = await setup();
    anim.play('lift').seek(1);
    const lift = mat();
    anim.play('spin').seek(0.5);
    const spin = mat();
    anim.setBlend([
      { clip: 'spin', time: 0.5, weight: 0 },
      { clip: 'lift', time: 1, weight: 1 },
    ]);
    expect(mat()).toEqual(lift);
    anim.setBlend([
      { clip: 'spin', time: 0.5, weight: 1 },
      { clip: 'lift', time: 1, weight: 0 },
    ]);
    expect(mat()).toEqual(spin);
    // Zero-weight entries in front of a later clip
    anim.setBlend([
      { clip: 'lift', time: 1, weight: 0 },
      { clip: 'lift', time: 0, weight: 0 },
      { clip: 'spin', time: 0.5, weight: 2 },
    ]);
    expect(mat()).toEqual(spin);
  });

  it('0.5 blend matches hand-computed slerp (rotation) and lerp (translation)', async () => {
    const { anim, mat } = await setup();
    // spin@1 = 90 deg, rest translation; lift@1 = (0, 3, 0), rest rotation
    // -> rotation slerp(90 deg, identity, 0.5) = 45 deg, translation lerp(0, 3, 0.5) = 1.5
    anim.setBlend([
      { clip: 'spin', time: 1, weight: 0.5 },
      { clip: 'lift', time: 1, weight: 0.5 },
    ]);
    close(apply(mat(), [0, 0, 0]), tipAt(45, 1.5), 6);
    // Two rotations of the same channel: slerp(45 deg, 90 deg, 0.5) = 67.5 deg
    anim.setBlend([
      { clip: 'spin', time: 0.5, weight: 0.5 },
      { clip: 'spin', time: 1, weight: 0.5 },
    ]);
    close(apply(mat(), [0, 0, 0]), tipAt(67.5), 6);
    close(apply(mat(), [1, 0, 0]), [3 * Math.cos((67.5 * Math.PI) / 180), 1, -3 * Math.sin((67.5 * Math.PI) / 180)], 6);
    // Successive slerp of three equal weights: 0, 45, 90 deg -> slerp(slerp(0, 45, 1/2), 90, 1/3) = 45 deg
    anim.setBlend([
      { clip: 'spin', time: 0, weight: 1 },
      { clip: 'spin', time: 0.5, weight: 1 },
      { clip: 'spin', time: 1, weight: 1 },
    ]);
    close(apply(mat(), [0, 0, 0]), tipAt(45), 6);
  });

  it('normalizes the weights by their sum', async () => {
    const { anim, mat } = await setup();
    // 1 : 3 -> 45 deg + 0.75 x 45 deg = 78.75 deg
    anim.setBlend([
      { clip: 'spin', time: 0.5, weight: 1 },
      { clip: 'spin', time: 1, weight: 3 },
    ]);
    const a = mat();
    close(apply(a, [0, 0, 0]), tipAt(78.75), 6);
    anim.setBlend([
      { clip: 'spin', time: 0.5, weight: 0.25 },
      { clip: 'spin', time: 1, weight: 0.75 },
    ]);
    close(mat(), a, 12);
    // 1 : 3 translation: 0.75 x 3
    anim.setBlend([
      { clip: 'lift', time: 0, weight: 10 },
      { clip: 'lift', time: 1, weight: 30 },
    ]);
    close(apply(mat(), [0, 0, 0]), tipAt(0, 2.25), 6);
  });

  it('wraps each entry time with its own loop mode', async () => {
    const { anim, mat } = await setup();
    // 1.25 s: repeat -> 0.25 s (22.5 deg), once -> 1 s (90 deg), pingpong -> 0.75 s (67.5 deg)
    const cases = [
      ['repeat', 22.5],
      ['once', 90],
      ['pingpong', 67.5],
      [undefined, 22.5],
    ] as const;
    for (const [loop, deg] of cases) {
      anim.setBlend([{ clip: 'spin', time: 1.25, weight: 1, ...(loop ? { loop } : {}) }]);
      close(apply(mat(), [0, 0, 0]), tipAt(deg), 6);
    }
    // Mixed: once (90 deg) and pingpong (67.5 deg) at 0.5 / 0.5 -> 78.75 deg
    anim.setBlend([
      { clip: 'spin', time: 1.25, weight: 1, loop: 'once' },
      { clip: 'spin', time: 1.25, weight: 1, loop: 'pingpong' },
    ]);
    close(apply(mat(), [0, 0, 0]), tipAt(78.75), 6);
  });

  it('stops wall-clock playback; clip / time / loop report the heaviest entry', async () => {
    const { sdk, model, batches } = await setup();
    const now = vi.spyOn(performance, 'now');
    const anim = sdk.playGltfAnimation(model, 'spin', { speed: 2, weight: 0.7 });
    now.mockReturnValue(1000);
    sdk.render();
    anim.setBlend([
      { clip: 'spin', time: 0.25, weight: 0.4 },
      { clip: 'lift', time: 2.5, weight: 0.6, loop: 'pingpong' },
    ]);
    expect(anim.playing).toBe(false);
    expect(anim.clip).toBe(1);
    expect(anim.loop).toBe('pingpong');
    expect(anim.time).toBeCloseTo(0.5);
    expect(anim.speed).toBe(2);
    expect(anim.weight).toBe(0.7);
    const n = batches.length;
    now.mockReturnValue(1050);
    sdk.render();
    now.mockReturnValue(1100);
    sdk.render();
    expect(batches.length).toBe(n); // no wall-clock advance
    // Ties: the first entry
    anim.setBlend([
      { clip: 'lift', time: 0.25, weight: 1 },
      { clip: 'spin', time: 0.75, weight: 1 },
    ]);
    expect(anim.clip).toBe(1);
    expect(anim.time).toBeCloseTo(0.25);
    expect(anim.loop).toBe('repeat');
    // resume continues the heaviest clip as a single clip
    anim.resume();
    expect(anim.playing).toBe(true);
  });

  it('validates the entries with GltfAnimator.setBlend messages and keeps the state on error', async () => {
    const { anim, batches, mat } = await setup();
    anim.play('spin').seek(0.5);
    const before = mat();
    const n = batches.length;
    const e = (over: Record<string, unknown> = {}) => ({ clip: 'spin', time: 0, weight: 1, ...over }) as never;
    expect(() => anim.setBlend([])).toThrow('GltfAnimator.setBlend: expected 1 to 4 entries (got 0)');
    expect(() => anim.setBlend([e(), e(), e(), e(), e()])).toThrow('GltfAnimator.setBlend: expected 1 to 4 entries (got 5)');
    expect(() => anim.setBlend(null as never)).toThrow('GltfAnimator.setBlend: entries must be an array');
    expect(() => anim.setBlend([null as never])).toThrow('GltfAnimator.setBlend: entry 0 must be an object');
    expect(() => anim.setBlend([e(), e({ clip: 'nope' })])).toThrow("GltfAnimator.setBlend: no animation named 'nope'");
    expect(() => anim.setBlend([e({ clip: 7 })])).toThrow('GltfAnimator.setBlend: animation 7 does not exist (the model has 2)');
    expect(() => anim.setBlend([e({ clip: 0.5 })])).toThrow(/GltfAnimator\.setBlend: animation 0\.5 does not exist/);
    expect(() => anim.setBlend([e({ time: NaN })])).toThrow('GltfAnimator.setBlend: entry 0 time must be a finite number (got NaN)');
    expect(() => anim.setBlend([e(), e({ time: Infinity })])).toThrow('GltfAnimator.setBlend: entry 1 time must be a finite number (got Infinity)');
    expect(() => anim.setBlend([e({ weight: NaN })])).toThrow('GltfAnimator.setBlend: entry 0 weight must be a finite number >= 0 (got NaN)');
    expect(() => anim.setBlend([e({ weight: Infinity })])).toThrow('GltfAnimator.setBlend: entry 0 weight must be a finite number >= 0 (got Infinity)');
    expect(() => anim.setBlend([e(), e({ weight: -0.1 })])).toThrow('GltfAnimator.setBlend: entry 1 weight must be a finite number >= 0 (got -0.1)');
    expect(() => anim.setBlend([e({ weight: 0 }), e({ weight: 0 })])).toThrow('GltfAnimator.setBlend: the weights must sum to a finite number > 0 (got 0)');
    expect(() => anim.setBlend([e({ weight: 1e308 }), e({ weight: 1e308 })])).toThrow(/GltfAnimator\.setBlend: the weights must sum to a finite number > 0/);
    expect(() => anim.setBlend([e({ loop: 'bounce' })])).toThrow("GltfAnimator.setBlend: entry 0 loop must be 'repeat', 'once' or 'pingpong' (got bounce)");
    // Nothing changed or was sent
    expect(batches.length).toBe(n);
    expect(mat()).toEqual(before);
    expect(anim.playing).toBe(true);
    expect(anim.clip).toBe(0);
    anim.dispose();
    expect(() => anim.setBlend([e()])).toThrow('GltfAnimator.setBlend: the animator is disposed');
  });
});

describe('glTF node rotation overrides (setNodeRotations)', () => {
  type Quat = [number, number, number, number];
  const q = (v: number[]) => v as Quat;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  /** Quaternion of `deg` degrees about +Z */
  const qz = (deg: number) => q([0, 0, Math.sin(rad(deg) / 2), Math.cos(rad(deg) / 2)]);
  /** Rotations of a vector by hand (right-handed, column vectors) */
  const rotY = (v: number[], deg: number) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c];
  };
  const rotZ = (v: number[], deg: number) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
  };
  const add = (a: number[], b: number[]) => a.map((x, i) => x + b[i]);
  const ROOT = [0, 1, 0];
  const TIP = [2, 0, 0];

  async function setup(opts: Parameters<typeof armModel>[0] = {}, load: { animations?: boolean } = {}) {
    const env = animBackend();
    const model = await env.sdk.loadGltf(armModel(opts), load);
    const anim = env.sdk.createGltfAnimator(model, { autoUpdate: false });
    const tip = model.objects[0];
    const mat = () => Array.from(env.matrices.get(tip)!);
    return { ...env, model, anim, tip, mat };
  }

  it('lists the node names depth first (the GltfLoadResult.nodes order)', async () => {
    const { anim, model } = await setup();
    expect(anim.nodeNames).toEqual(['root', 'arm', 'tip', 'base']);
    expect(model.nodes.map((n) => n.name)).toEqual(anim.nodeNames);
    expect(Object.isFrozen(anim.nodeNames)).toBe(true);
    const unnamed = await setup({ names: ['root', null, 'tip', 'base'] });
    expect(unnamed.anim.nodeNames).toEqual(['root', null, 'tip', 'base']);
  });

  it('absolute on an unanimated (static) node moves its whole subtree; one batched call', async () => {
    const { anim, mat, batches, tip, matrices, model } = await setup();
    const n = batches.length;
    anim.setNodeRotations([{ node: 'root', rotation: q(qy(90)) }], 'absolute');
    expect(batches.length).toBe(n + 1);
    expect(batches.at(-1)).toEqual({ ids: [tip], floats: 16 });
    // Rest pose: root = T(0,1,0) Ry(90), arm = identity, tip = T(2,0,0)
    close(apply(mat(), [0, 0, 0]), add(rotY(TIP, 90), ROOT), 6);
    close(apply(mat(), [1, 0, 0]), add(rotY([3, 0, 0], 90), ROOT), 6);
    // The baked static mesh outside the subtree has no mesh matrix
    expect(matrices.has(model.objects[1])).toBe(false);
    // Under a clip: arm 90 deg (spin@1) inside root 90 deg
    anim.play('spin').pause().seek(1);
    close(apply(mat(), [0, 0, 0]), add(rotY(rotY(TIP, 90), 90), ROOT), 6);
    // The glTF node index works the same
    const byName = mat();
    anim.setNodeRotations([{ node: 0, rotation: q(qy(90)) }], 'absolute');
    expect(mat()).toEqual(byName);
  });

  it('absolute on an animated node replaces the clip rotation', async () => {
    const { anim, mat } = await setup();
    anim.play('spin').pause().seek(0.3);
    anim.setNodeRotations([{ node: 'arm', rotation: q(qy(30)) }], 'absolute');
    const a = mat();
    close(apply(a, [0, 0, 0]), add(rotY(TIP, 30), ROOT), 6);
    anim.seek(0.9);
    expect(mat()).toEqual(a);
  });

  it('additive = clip rotation x override (override in the node local frame, after the clip)', async () => {
    const { anim, mat } = await setup();
    anim.play('spin').pause().seek(0.5); // arm: 45 deg about Y
    anim.setNodeRotations([{ node: 'arm', rotation: qz(30) }]);
    // arm world rotation = Ry(45) Rz(30): Rz first in the arm frame, then the clip's Ry
    const expectAt = (p: number[]) => add(rotY(rotZ(add(p, TIP), 30), 45), ROOT);
    close(apply(mat(), [0, 0, 0]), expectAt([0, 0, 0]), 6);
    close(apply(mat(), [1, 0, 0]), expectAt([1, 0, 0]), 6);
    close(apply(mat(), [0, 1, 0]), expectAt([0, 1, 0]), 6);
    // Not the other order (Rz(30) Ry(45))
    const wrong = add(rotZ(rotY(TIP, 45), 30), ROOT);
    expect(Math.abs(apply(mat(), [0, 0, 0])[1] - wrong[1])).toBeGreaterThan(0.1);
    // 'additive' explicitly is the default
    const a = mat();
    anim.setNodeRotations([{ node: 'arm', rotation: qz(30) }], 'additive');
    expect(mat()).toEqual(a);
    // Additive on the rest pose of a static node
    anim.stop();
    anim.setNodeRotations([{ node: 'root', rotation: q(qy(-90)) }]);
    close(apply(mat(), [0, 0, 0]), add(rotY(TIP, -90), ROOT), 6);
  });

  it('overrides persist across seek, update, play, setBlend and stop', async () => {
    const { anim, mat } = await setup();
    anim.setNodeRotations([{ node: 'arm', rotation: qz(30) }]);
    // Rest + override
    close(apply(mat(), [0, 0, 0]), add(rotZ(TIP, 30), ROOT), 6);
    anim.play('spin').pause().seek(1);
    const seek1 = mat();
    close(apply(seek1, [0, 0, 0]), add(rotY(rotZ(TIP, 30), 90), ROOT), 6);
    // setBlend single entry = seek, bit for bit, override included
    anim.setBlend([{ clip: 'spin', time: 1, weight: 1 }]);
    expect(mat()).toEqual(seek1);
    // update
    anim.play('spin').update(0.25).update(0.25);
    close(apply(mat(), [0, 0, 0]), add(rotY(rotZ(TIP, 30), 45), ROOT), 5);
    // Blend 0.5 / 0.5: rotation 45 deg, translation 1.5 (lift) + override
    anim.setBlend([
      { clip: 'spin', time: 1, weight: 0.5 },
      { clip: 'lift', time: 1, weight: 0.5 },
    ]);
    const blended = mat();
    close(apply(blended, [0, 0, 0]), add(rotY(rotZ(TIP, 30), 45), [0, 2.5, 0]), 6);
    // Changing the overrides re-applies the blend (not the heaviest clip alone)
    anim.setNodeRotations([{ node: 'arm', rotation: qz(-30) }]);
    close(apply(mat(), [0, 0, 0]), add(rotY(rotZ(TIP, -30), 45), [0, 2.5, 0]), 6);
    anim.setNodeRotations([{ node: 'arm', rotation: qz(30) }]);
    expect(mat()).toEqual(blended);
    // stop: rest pose + override
    anim.stop();
    close(apply(mat(), [0, 0, 0]), add(rotZ(TIP, 30), ROOT), 6);
  });

  it('[] clears back to the exact clip / blend / rest pose (static nodes included)', async () => {
    const { anim, mat, batches } = await setup();
    const rest = mat();
    anim.play('spin').pause().seek(0.7);
    const clip = mat();
    anim.setNodeRotations([
      { node: 'root', rotation: q(qy(40)) },
      { node: 'arm', rotation: qz(20) },
    ]);
    expect(mat()).not.toEqual(clip);
    const n = batches.length;
    anim.setNodeRotations([]);
    expect(batches.length).toBe(n + 1);
    expect(mat()).toEqual(clip);
    // Overrides on a static node, then cleared, keep later poses exact
    anim.setNodeRotations([{ node: 'root', rotation: q(qy(40)) }], 'absolute');
    anim.seek(0.2);
    anim.setNodeRotations([]);
    anim.seek(0.7);
    expect(mat()).toEqual(clip);
    anim.setBlend([
      { clip: 'spin', time: 1, weight: 0.5 },
      { clip: 'lift', time: 1, weight: 0.5 },
    ]);
    const blended = mat();
    anim.setNodeRotations([{ node: 'root', rotation: q(qy(40)) }]);
    anim.setNodeRotations([]);
    expect(mat()).toEqual(blended);
    anim.stop();
    expect(mat()).toEqual(rest);
    // Identity additive and near-unit quaternions (normalized) leave the pose exact
    anim.play('spin').pause().seek(0.7);
    anim.setNodeRotations([{ node: 'arm', rotation: [0, 0, 0, 1.0005] }]);
    expect(mat()).toEqual(clip);
  });

  it('dispose leaves the plain rest pose (overrides dropped)', async () => {
    const { anim, mat } = await setup();
    const rest = mat();
    anim.setNodeRotations([{ node: 'root', rotation: q(qy(90)) }]);
    expect(mat()).not.toEqual(rest);
    anim.dispose();
    expect(mat()).toEqual(rest);
    expect(() => anim.setNodeRotations([])).toThrow('GltfAnimator.setNodeRotations: the animator is disposed');
  });

  it('validates everything with GltfAnimator.setNodeRotations messages before changing state', async () => {
    const { anim, mat, batches } = await setup({ names: ['root', 'arm', 'tip', 'arm'], baseUnderRoot: false });
    anim.play('spin').pause().seek(0.5);
    anim.setNodeRotations([{ node: 'tip', rotation: qz(10) }]);
    const before = mat();
    const n = batches.length;
    const set = (r: unknown, mode?: unknown) => () => anim.setNodeRotations(r as never, mode as never);
    const msg = (m: string) => `GltfAnimator.setNodeRotations: ${m}`;
    expect(set([{ node: 'nope', rotation: [0, 0, 0, 1] }])).toThrow(msg('no node named "nope" (nodes: "root", "arm", "tip", "arm")'));
    expect(set([{ node: 'arm', rotation: [0, 0, 0, 1] }])).toThrow(
      msg('node name "arm" is ambiguous (2 nodes have it: glTF nodes 1, 3); use the glTF node index')
    );
    expect(set([{ node: 9, rotation: [0, 0, 0, 1] }])).toThrow(msg('glTF node 9 is not in the loaded scene (it has 4 nodes)'));
    expect(set([{ node: -1, rotation: [0, 0, 0, 1] }])).toThrow(msg('entry 0 node must be a node name or a glTF node index (got -1)'));
    expect(set([{ node: 1.5, rotation: [0, 0, 0, 1] }])).toThrow(msg('entry 0 node must be a node name or a glTF node index (got 1.5)'));
    expect(set([{ node: 1, rotation: [0, 0, 0, 1] }, { node: 'tip', rotation: [0, 0, 0, 1] }, { node: 1, rotation: [0, 0, 0, 1] }])).toThrow(
      msg('node "arm" is listed twice')
    );
    expect(set([{ node: 'tip', rotation: [0, 0, 0, 2] }])).toThrow(msg('rotation of node "tip" must be a unit quaternion (length 2)'));
    expect(set([{ node: 'tip', rotation: [0, 0, 0, 0.99] }])).toThrow(/rotation of node "tip" must be a unit quaternion \(length 0\.99/);
    expect(set([{ node: 'tip', rotation: [0, 0, NaN, 1] }])).toThrow(msg('rotation of node "tip" must be 4 finite numbers [x, y, z, w] (got 0,0,NaN,1)'));
    expect(set([{ node: 'tip', rotation: [0, 0, Infinity, 1] }])).toThrow(/rotation of node "tip" must be 4 finite numbers/);
    expect(set([{ node: 'tip', rotation: [0, 0, 1] }])).toThrow(/rotation of node "tip" must be 4 finite numbers/);
    expect(set([{ node: 'tip' }])).toThrow(msg('rotation of node "tip" must be 4 finite numbers [x, y, z, w] (got undefined)'));
    expect(set([null])).toThrow(msg('entry 0 must be an object'));
    expect(set('tip')).toThrow(msg('rotations must be an array'));
    expect(set([], 'relative')).toThrow(msg("mode must be 'additive' or 'absolute' (got relative)"));
    // A good entry before a bad one changes nothing either
    expect(set([{ node: 'root', rotation: [0, 0, 0, 1] }, { node: 'tip', rotation: [1, 1, 1, 1] }])).toThrow(/unit quaternion/);
    expect(batches.length).toBe(n);
    expect(mat()).toEqual(before);
    // The previous overrides are still applied
    anim.seek(0.5);
    expect(mat()).toEqual(before);
    // Unnamed nodes are labeled by glTF index
    const { anim: un } = await setup({ names: ['root', null, 'tip', 'base'] });
    expect(() => un.setNodeRotations([{ node: 1, rotation: [0, 0, 0, 1] }, { node: 1, rotation: [0, 0, 0, 1] }])).toThrow(msg('node 1 is listed twice'));
  });

  it('baked static geometry and matrix nodes cannot be posed (clear errors)', async () => {
    const hint = 'load the model with loadGltf(..., { posable: [<node names>] }) to animate it';
    const msg = (m: string) => `GltfAnimator.setNodeRotations: ${m}`;
    // base: a static node whose mesh was baked into the vertices at load
    const { anim } = await setup();
    expect(() => anim.setNodeRotations([{ node: 'base', rotation: [0, 0, 0, 1] }])).toThrow(msg(`node "base" is baked into static geometry; ${hint}`));
    expect(() => anim.setNodeRotations([{ node: 3, rotation: [0, 0, 0, 1] }])).toThrow(msg(`node "base" is baked into static geometry; ${hint}`));
    // A static ancestor of baked geometry
    const under = await setup({ baseUnderRoot: true });
    expect(() => under.anim.setNodeRotations([{ node: 'root', rotation: [0, 0, 0, 1] }])).toThrow(
      msg(`node "root" is baked into static geometry (via the baked mesh of node "base" in its subtree); ${hint}`)
    );
    // ... while the animated branch beside it stays posable
    under.anim.setNodeRotations([{ node: 'arm', rotation: q(qy(90)) }], 'absolute');
    close(apply(under.mat(), [0, 0, 0]), add(rotY(TIP, 90), ROOT), 6);
    // No rig at all (animations: false bakes everything)
    const flat = await setup({}, { animations: false });
    expect(flat.anim.nodeNames).toEqual(['root', 'arm', 'tip', 'base']);
    expect(() => flat.anim.setNodeRotations([{ node: 'arm', rotation: [0, 0, 0, 1] }])).toThrow(
      msg(
        'node "arm" cannot move any mesh: the model has no animated, skinned or posable meshes (a posable node needs a mesh in its subtree); load the model with loadGltf(..., { posable: [<node names>] }) naming a node above a mesh'
      )
    );
    flat.anim.setNodeRotations([]); // clearing is always fine
    // Nodes given by a matrix
    const m = await setup({ rootMatrix: true });
    expect(() => m.anim.setNodeRotations([{ node: 'root', rotation: [0, 0, 0, 1] }])).toThrow(
      msg('node "root" has a matrix transform; rotation overrides need a translation / rotation / scale node')
    );
    // ... but they follow an overridden ancestor / carry an overridden child
    m.anim.setNodeRotations([{ node: 'arm', rotation: q(qy(90)) }], 'absolute');
    close(apply(m.mat(), [0, 0, 0]), add(rotY(TIP, 90), ROOT), 6);
  });

  describe('loadGltf posable', () => {
    const hint = 'load the model with loadGltf(..., { posable: [<node names>] }) to animate it';
    const REST = [0, 1, 0];
    const baseMat = (e: { matrices: Map<number, Float32Array>; model: { objects: number[] } }) => Array.from(e.matrices.get(e.model.objects[1])!);
    const y90 = [{ node: 'base', rotation: q(qy(90)) }];

    async function posed(posable: unknown, load: Record<string, unknown> = {}, opts: Parameters<typeof armModel>[0] = {}) {
      const env = animBackend();
      const model = await env.sdk.loadGltf(armModel(opts), { ...load, posable } as never);
      const anim = env.sdk.createGltfAnimator(model, { autoUpdate: false });
      return { ...env, model, anim };
    }

    it('without posable a static mesh node cannot be posed; posable: [name] moves its mesh matrix', async () => {
      const none = await setup();
      expect(() => none.anim.setNodeRotations(y90)).toThrow(`GltfAnimator.setNodeRotations: node "base" is baked into static geometry; ${hint}`);
      const p = await posed(['base']);
      expect(p.matrices.has(p.model.objects[1])).toBe(true);
      // Rest: T(5,0,0)
      close(apply(baseMat(p), [1, 0, 0]), [6, 0, 0], 6);
      p.anim.setNodeRotations(y90, 'absolute');
      close(apply(baseMat(p), [0, 0, 0]), [5, 0, 0], 6);
      close(apply(baseMat(p), [1, 0, 0]), add([5, 0, 0], rotY([1, 0, 0], 90)), 6);
      close(apply(baseMat(p), [0, 1, 0]), [5, 1, 0], 6);
    });

    it('glTF node index, true, and animations: false work; scale and options.position apply', async () => {
      for (const [posable, load] of [[[3], {}], [true, {}], [['base'], { animations: false }], [true, { animations: false }]] as const) {
        const p = await posed(posable, load);
        p.anim.setNodeRotations(y90, 'absolute');
        close(apply(baseMat(p), [1, 0, 0]), add([5, 0, 0], rotY([1, 0, 0], 90)), 6);
      }
      const p = await posed(['base'], { scale: 2 });
      p.anim.setNodeRotations(y90, 'absolute');
      close(apply(baseMat(p), [1, 0, 0]), add([10, 0, 0], rotY([2, 0, 0], 90)), 6);
    });

    it('a posable node moves its whole static subtree; additive composes with rest', async () => {
      const p = await posed(['root'], { animations: false }, { baseUnderRoot: true });
      p.anim.setNodeRotations([{ node: 'root', rotation: q(qy(90)) }], 'absolute');
      close(apply(baseMat(p), [0, 0, 0]), add(rotY([5, 0, 0], 90), REST), 6);
      p.anim.setNodeRotations([{ node: 'root', rotation: q(qy(90)) }], 'additive');
      close(apply(baseMat(p), [0, 0, 0]), add(rotY([5, 0, 0], 90), REST), 6);
    });

    it('a matrix node keeps the matrix error even when posable', async () => {
      const p = await posed(['root'], {}, { rootMatrix: true });
      expect(() => p.anim.setNodeRotations([{ node: 'root', rotation: [0, 0, 0, 1] }])).toThrow(
        'GltfAnimator.setNodeRotations: node "root" has a matrix transform; rotation overrides need a translation / rotation / scale node'
      );
    });

    it('unknown, ambiguous or malformed entries reject before any object is created', async () => {
      const env = animBackend();
      const add = vi.spyOn(env.backend as unknown as { add_custom_mesh: () => number }, 'add_custom_mesh');
      const load = (posable: unknown, opts: Parameters<typeof armModel>[0] = {}) => env.sdk.loadGltf(armModel(opts), { posable } as never);
      await expect(load(['nope'])).rejects.toThrow('loadGltf: posable node "nope" not found (nodes: "root", "arm", "tip", "base")');
      await expect(load(['arm'], { names: ['root', 'arm', 'tip', 'arm'] })).rejects.toThrow(
        'loadGltf: posable node name "arm" is ambiguous (glTF nodes 1, 3); use the glTF node index'
      );
      await expect(load([9])).rejects.toThrow('loadGltf: posable glTF node 9 is not in the loaded scene');
      await expect(load([-1])).rejects.toThrow('loadGltf: posable entries must be node names or glTF node indices (got -1)');
      await expect(load('base')).rejects.toThrow('loadGltf: posable must be an array');
      expect(add).not.toHaveBeenCalled();
    });

    it('ignored with a warning when the engine has no mesh matrices', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const env = animBackend({ meshMatrices: false });
      const model = await env.sdk.loadGltf(armModel(), { posable: ['base'] });
      expect(model.objects.length).toBe(2);
      expect(warn.mock.calls.flat().join('\n')).toContain('posable nodes are not supported');
    });

    it('does not change bounds, object count or the rest pose of other meshes', async () => {
      const a = await setup();
      const b = await posed(true);
      expect(b.model.bounds).toEqual(a.model.bounds);
      expect(b.model.objects.length).toBe(a.model.objects.length);
      expect(Array.from(b.matrices.get(b.model.objects[0])!)).toEqual(Array.from(a.matrices.get(a.model.objects[0])!));
      const off = await posed(['base'], { animations: false });
      const flat = await setup({}, { animations: false });
      expect(off.model.bounds).toEqual(flat.model.bounds);
    });
  });
});

describe('glTF node matrices (nodeMatrix)', () => {
  type Quat = [number, number, number, number];
  const q = (v: number[]) => v as Quat;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  /** Quaternion of `deg` degrees about +Z */
  const qz = (deg: number) => q([0, 0, Math.sin(rad(deg) / 2), Math.cos(rad(deg) / 2)]);
  // Column-major 4x4 helpers (hand-computed expectations)
  const mmul = (a: number[], b: number[]) => {
    const o = new Array<number>(16).fill(0);
    for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) for (let k = 0; k < 4; k++) o[col * 4 + row] += a[k * 4 + row] * b[col * 4 + k];
    return o;
  };
  const chain = (...ms: number[][]) => ms.reduce(mmul);
  const T = (x: number, y: number, z: number) => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
  const S = (k: number) => [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1];
  const Ry = (deg: number) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  };
  const Rz = (deg: number) => {
    const c = Math.cos(rad(deg)), s = Math.sin(rad(deg));
    return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  };
  const ROOT = T(0, 1, 0);
  const TIP = T(2, 0, 0);

  async function setup(opts: Parameters<typeof armModel>[0] = {}, load: Record<string, unknown> = {}) {
    const env = animBackend();
    const model = await env.sdk.loadGltf(armModel(opts), load as never);
    const anim = env.sdk.createGltfAnimator(model, { autoUpdate: false });
    const tip = model.objects[0];
    const mesh = () => Array.from(env.matrices.get(tip)!);
    const node = (n: string | number) => Array.from(anim.nodeMatrix(n));
    return { ...env, model, anim, tip, mesh, node };
  }

  it('rest pose before any play: dynamic and static rig nodes give their load-time world', async () => {
    const { node, mesh } = await setup();
    close(node('root'), ROOT, 6);
    close(node('arm'), ROOT, 6);
    close(node('tip'), chain(ROOT, TIP), 6);
    close(node('base'), T(5, 0, 0), 6); // static scene root with a baked mesh
    // Same product as the mesh matrix the loader sent (base x world)
    expect(node('tip')).toEqual(mesh());
    // glTF node index = name
    expect(node(2)).toEqual(node('tip'));
  });

  it('tip node under a clip at t equals the hand-computed chain and the mesh matrix bit for bit', async () => {
    const { anim, node, mesh } = await setup();
    anim.play('spin').pause().seek(0.5);
    close(node('arm'), chain(ROOT, Ry(45)), 5);
    close(node('tip'), chain(ROOT, Ry(45), TIP), 5);
    expect(node('tip')).toEqual(mesh());
    anim.seek(1);
    close(node('tip'), chain(ROOT, Ry(90), TIP), 5);
    // update() and the STEP clip
    anim.play('lift').seek(1);
    close(node('tip'), chain(ROOT, T(0, 3, 0), TIP), 5);
    anim.play('spin').update(0.25);
    close(node('tip'), chain(ROOT, Ry(22.5), TIP), 5);
    expect(node('tip')).toEqual(mesh());
    // stop: rest pose again
    anim.stop();
    close(node('tip'), chain(ROOT, TIP), 6);
    expect(node('tip')).toEqual(mesh());
  });

  it('under a 0.5 / 0.5 blend: rotation slerped, translation lerped', async () => {
    const { anim, node, mesh } = await setup();
    anim.setBlend([
      { clip: 'spin', time: 1, weight: 0.5 },
      { clip: 'lift', time: 1, weight: 0.5 },
    ]);
    close(node('arm'), chain(ROOT, T(0, 1.5, 0), Ry(45)), 5);
    close(node('tip'), chain(ROOT, T(0, 1.5, 0), Ry(45), TIP), 5);
    expect(node('tip')).toEqual(mesh());
  });

  it('additive override on an ancestor (static root) moves the chain; nodes outside stay at rest', async () => {
    const { anim, node, mesh } = await setup();
    anim.play('spin').pause().seek(0.5);
    anim.setNodeRotations([{ node: 'root', rotation: qz(30) }]);
    close(node('root'), chain(ROOT, Rz(30)), 5);
    close(node('tip'), chain(ROOT, Rz(30), Ry(45), TIP), 5);
    expect(node('tip')).toEqual(mesh());
    close(node('base'), T(5, 0, 0), 6);
    // Override on the animated node itself, absolute
    anim.setNodeRotations([{ node: 'arm', rotation: qz(90) }], 'absolute');
    close(node('root'), ROOT, 6);
    close(node('tip'), chain(ROOT, Rz(90), TIP), 5);
    // stop keeps the overrides (rest + override)
    anim.stop();
    close(node('tip'), chain(ROOT, Rz(90), TIP), 5);
  });

  it('static mesh-less node under an overridden ancestor follows it, and gets its rest world back on []', async () => {
    for (const load of [{}, { animations: false, posable: ['arm'] }]) {
      const { anim, node, model } = await setup({ socket: true }, load);
      expect(model.nodes.map((n) => n.name)).toEqual(['root', 'arm', 'tip', 'socket', 'base']);
      const SOCKET = T(0, 0, 1);
      const rest = node('socket');
      close(rest, chain(ROOT, SOCKET), 6);
      anim.setNodeRotations([{ node: 'root', rotation: q(qy(90)) }]);
      close(node('socket'), chain(ROOT, Ry(90), SOCKET), 5);
      close(node('tip'), chain(ROOT, Ry(90), TIP), 5);
      anim.setNodeRotations([{ node: 'root', rotation: q(qy(90)) }], 'absolute');
      close(node('socket'), chain(ROOT, Ry(90), SOCKET), 5);
      anim.setNodeRotations([]);
      expect(node('socket')).toEqual(rest);
    }
  });

  it('matrix nodes are valid and children follow them', async () => {
    const { anim, node, mesh } = await setup({ rootMatrix: true });
    close(node('root'), ROOT, 6);
    anim.play('spin').pause().seek(1);
    close(node('root'), ROOT, 6);
    close(node('tip'), chain(ROOT, Ry(90), TIP), 5);
    expect(node('tip')).toEqual(mesh());
  });

  it('includes the load scale; load position / rotation are not included', async () => {
    const { anim, node, mesh, model } = await setup({}, { scale: 2, position: [10, 0, 0] });
    close(node('tip'), chain(S(2), ROOT, TIP), 6);
    close(node('base'), chain(S(2), T(5, 0, 0)), 6);
    expect(node('tip')).toEqual(mesh());
    // tip origin (object space) + load position = the bounds' minimum corner (tip vertex 0)
    expect(apply(node('tip'), [0, 0, 0])[0] + 10).toBeCloseTo(model.bounds.min[0], 6);
    anim.play('spin').pause().seek(0.5);
    close(node('tip'), chain(S(2), ROOT, Ry(45), TIP), 5);
    expect(node('tip')).toEqual(mesh());
    const rotated = await setup({}, { scale: 2, position: [3, 4, 5], rotation: [0.3, 1.1, -0.4] });
    expect(rotated.node('tip')).toEqual(await setup({}, { scale: 2 }).then((s) => s.node('tip')));
  });

  it('writes into out (same array returned, first 16 floats) and makes no host calls', async () => {
    const { anim, node, batches, backend } = await setup();
    anim.play('spin').pause().seek(0.5);
    const spy = vi.spyOn(backend as unknown as { set_object_mesh_matrices: () => number }, 'set_object_mesh_matrices');
    const n = batches.length;
    const out = new Float32Array(16);
    expect(anim.nodeMatrix('tip', out)).toBe(out);
    expect(Array.from(out)).toEqual(node('tip'));
    const longer = new Float32Array(20).fill(7);
    expect(anim.nodeMatrix('arm', longer)).toBe(longer);
    expect(Array.from(longer.subarray(0, 16))).toEqual(node('arm'));
    expect(Array.from(longer.subarray(16))).toEqual([7, 7, 7, 7]);
    // A fresh array without out
    const a = anim.nodeMatrix('tip');
    expect(a).not.toBe(anim.nodeMatrix('tip'));
    expect(batches.length).toBe(n);
    expect(spy).not.toHaveBeenCalled();
  });

  it('errors: unknown / ambiguous / out-of-scene / malformed nodes, bad out, no rig, disposed', async () => {
    const msg = (m: string) => `GltfAnimator.nodeMatrix: ${m}`;
    const { anim } = await setup({ names: ['root', 'arm', 'tip', 'arm'] });
    expect(() => anim.nodeMatrix('nope')).toThrow(msg('no node named "nope" (nodes: "root", "arm", "tip", "arm")'));
    expect(() => anim.nodeMatrix('arm')).toThrow(msg('node name "arm" is ambiguous (2 nodes have it: glTF nodes 1, 3); use the glTF node index'));
    expect(() => anim.nodeMatrix(9)).toThrow(msg('glTF node 9 is not in the loaded scene (it has 4 nodes)'));
    expect(() => anim.nodeMatrix(-1)).toThrow(msg('node must be a node name or a glTF node index (got -1)'));
    expect(() => anim.nodeMatrix(1.5)).toThrow(msg('node must be a node name or a glTF node index (got 1.5)'));
    expect(() => anim.nodeMatrix(null as never)).toThrow(msg('node must be a node name or a glTF node index (got null)'));
    expect(() => anim.nodeMatrix('tip', new Float32Array(15))).toThrow(msg('out must be a Float32Array of length >= 16 (got a Float32Array of length 15)'));
    expect(() => anim.nodeMatrix('tip', new Float64Array(16) as never)).toThrow(msg('out must be a Float32Array of length >= 16 (got Float64Array)'));
    expect(() => anim.nodeMatrix('tip', [] as never)).toThrow(msg('out must be a Float32Array of length >= 16 (got Array)'));
    // The ambiguous name still resolves by glTF index
    close(Array.from(anim.nodeMatrix(1)), ROOT, 6);
    // No rig (animations: false bakes everything)
    const flat = await setup({}, { animations: false });
    expect(() => flat.anim.nodeMatrix('arm')).toThrow(
      msg(
        'node "arm" is not in an animation rig: the model has no animated, skinned or posable meshes (a posable node needs a mesh in its subtree); load the model with loadGltf(..., { posable: [<node names>] }) naming a node above a mesh'
      )
    );
    expect(() => flat.anim.nodeMatrix('nope')).toThrow(msg('no node named "nope" (nodes: "root", "arm", "tip", "base")'));
    // Disposed
    anim.dispose();
    expect(() => anim.nodeMatrix(2)).toThrow(msg('the animator is disposed'));
    expect(() => anim.nodeMatrix(2, new Float32Array(16))).toThrow(msg('the animator is disposed'));
  });
});

describe('mesh-less posable attach node (static model)', () => {
  const load = { animations: false, posable: ['socket'] };
  it('builds a rig without mesh-matrix / joint host calls; nodeMatrix is the rest world incl. load scale', async () => {
    const env = animBackend();
    const model = await env.sdk.loadGltf(armModel({ socket: true }), { ...load, scale: 2 });
    expect(env.batches.length).toBe(0);
    const anim = env.sdk.createGltfAnimator(model, { autoUpdate: false });
    const mesh = vi.spyOn(env.backend as unknown as { set_object_mesh_matrices: () => number }, 'set_object_mesh_matrices');
    const joints = vi.fn();
    (env.backend as unknown as { set_object_joint_matrices: unknown }).set_object_joint_matrices = joints;
    const m = Array.from(anim.nodeMatrix('socket'));
    // scale 2 x root (0,1,0) x socket (0,0,1)
    expect(apply(m, [0, 0, 0])).toEqual([0, 2, 2]);
    anim.seek(0).update(0.1);
    anim.stop();
    expect(mesh).not.toHaveBeenCalled();
    expect(joints).not.toHaveBeenCalled();
    // rotation of the socket itself moves nothing visible but changes its nodeMatrix
    anim.setNodeRotations([{ node: 'socket', rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] }]);
    const turned = Array.from(anim.nodeMatrix('socket'));
    expect(apply(turned, [0, 0, 0])).toEqual([0, 2, 2]);
    expect(apply(turned, [1, 0, 0])[2]).toBeCloseTo(2 - 2, 5);
    expect(turned).not.toEqual(m);
    expect(mesh).not.toHaveBeenCalled();
    expect(joints).not.toHaveBeenCalled();
    // baked meshes still throw the baked error
    expect(() => anim.setNodeRotations([{ node: 'base', rotation: [0, 0, 0, 1] }])).toThrow(/baked into static geometry/);
  });

  it('without posable: no rig and bit-identical objects', async () => {
    const a = animBackend();
    const plain = await a.sdk.loadGltf(armModel({ socket: true }), { animations: false });
    const b = animBackend();
    const posed = await b.sdk.loadGltf(armModel({ socket: true }), load);
    expect(plain.objects.length).toBe(posed.objects.length);
    expect(() => a.sdk.createGltfAnimator(plain, { autoUpdate: false }).nodeMatrix('socket')).toThrow(/not in an animation rig/);
    expect(a.batches.length).toBe(0);
  });
});
