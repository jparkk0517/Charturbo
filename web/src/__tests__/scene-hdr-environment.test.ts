import { afterEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

type Calls = Record<string, unknown[][]>;

/** Backend recording the HDR environment contract (texture ids from 1, like the engine). */
function hdrBackend(opts: { hdr?: boolean; gpuError?: (id: number) => string | null } = {}) {
  const calls: Calls = {};
  const log = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  let nextTexture = 1;
  const live = new Set<number>();
  const backend: Record<string, unknown> = {
    add_primitive: () => 1,
    set_object_transform: () => true,
    set_object_material: () => true,
    set_object_physics: () => true,
    clear_scene_objects: () => {},
    set_scene_lighting: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    set_scene_shading: (...args: unknown[]) => log('set_scene_shading', args),
    set_scene_env_rotation: (...args: unknown[]) => log('set_scene_env_rotation', args),
    max_texture_size: () => 4096,
    create_texture_rgba8: () => {
      const id = nextTexture++;
      live.add(id);
      return id;
    },
    dispose_texture: (id: number) => {
      log('dispose_texture', [id]);
      return live.delete(id);
    },
    free: () => {},
  };
  if (opts.hdr !== false) {
    backend.create_environment_hdr = (bytes: Uint8Array) => {
      log('create_environment_hdr', [bytes]);
      if (bytes[0] !== 0x23) throw 'not a Radiance HDR file (missing #? signature)';
      const id = nextTexture++;
      live.add(id);
      return new Uint32Array([id, 64, 32]);
    };
    backend.create_environment_from_float = (w: number, h: number, rgb: Float32Array) => {
      log('create_environment_from_float', [w, h, rgb]);
      if (w > 4096) throw `environment ${w}x${h} exceeds the 4096x2048 limit`;
      const id = nextTexture++;
      live.add(id);
      return id;
    };
  }
  if (opts.gpuError) {
    const gpuError = opts.gpuError;
    // WebGPU: the error scopes settle after the creation returned
    backend.environment_ready = (id: number) => {
      log('environment_ready', [id]);
      const e = gpuError(id);
      return e === null ? Promise.resolve() : Promise.reject(new Error(e));
    };
  }
  return { calls, sdk: Charturbo.fromBackend(backend as unknown as WasmCharturboEngineBackend) };
}

const HDR = new TextEncoder().encode('#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 32 +X 64\n');

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadEnvironmentHdr', () => {
  it('accepts ArrayBuffer, typed arrays and Blobs and records an hdr texture', async () => {
    const { sdk, calls } = hdrBackend();
    const a = await sdk.loadEnvironmentHdr(HDR.buffer.slice(0));
    const b = await sdk.loadEnvironmentHdr(HDR);
    const c = await sdk.loadEnvironmentHdr(new Blob([HDR]));
    expect([a, b, c]).toEqual([1, 2, 3]);
    const sent = calls.create_environment_hdr.map(([bytes]) => Array.from(bytes as Uint8Array));
    expect(sent.every((s) => s.join() === Array.from(HDR).join())).toBe(true);
    expect(sdk.getTextures()[0]).toEqual({ id: 1, width: 64, height: 32, src: null, hdr: true });
  });

  it('fetches URLs and keeps the src', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => HDR.buffer.slice(0) }));
    vi.stubGlobal('fetch', fetchMock);
    const { sdk } = hdrBackend();
    const id = await sdk.loadEnvironmentHdr('/studio.hdr');
    expect(fetchMock).toHaveBeenCalledWith('/studio.hdr', { signal: undefined });
    expect(sdk.getTextures().find((t) => t.id === id)).toMatchObject({ src: '/studio.hdr', hdr: true });
  });

  it('reports fetch failures, aborts and engine errors with the method prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const { sdk } = hdrBackend();
    await expect(sdk.loadEnvironmentHdr('/missing.hdr')).rejects.toThrow('loadEnvironmentHdr: failed to fetch /missing.hdr (404)');
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(sdk.loadEnvironmentHdr(HDR, { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await expect(sdk.loadEnvironmentHdr(new Uint8Array([1, 2, 3]))).rejects.toThrow('loadEnvironmentHdr: not a Radiance HDR file');
    await expect(sdk.loadEnvironmentHdr(42 as unknown as ArrayBuffer)).rejects.toThrow('loadEnvironmentHdr: source must be');
    expect(sdk.getTextures()).toEqual([]);
  });

  it('throws when the engine has no HDR support', async () => {
    const { sdk } = hdrBackend({ hdr: false });
    await expect(sdk.loadEnvironmentHdr(HDR)).rejects.toThrow('engine has no HDR environment support');
    expect(() => sdk.createEnvironmentFromFloat(2, 1, new Float32Array(6))).toThrow('engine has no HDR environment support');
  });
});

describe('createEnvironmentFromFloat', () => {
  it('validates the size and the rgb length before the engine call', () => {
    const { sdk, calls } = hdrBackend();
    expect(() => sdk.createEnvironmentFromFloat(0, 1, new Float32Array(0))).toThrow('createEnvironmentFromFloat: width and height must be positive integers');
    expect(() => sdk.createEnvironmentFromFloat(2.5, 1, new Float32Array(6))).toThrow('positive integers');
    expect(() => sdk.createEnvironmentFromFloat(4, 2, new Float32Array(23))).toThrow('rgb must hold width * height * 3 = 24 floats (got 23)');
    expect(calls.create_environment_from_float).toBeUndefined();
    expect(() => sdk.createEnvironmentFromFloat(8192, 1, new Float32Array(8192 * 3))).toThrow(
      'createEnvironmentFromFloat: environment 8192x1 exceeds the 4096x2048 limit'
    );
  });

  it('passes Float32Arrays through and converts number arrays', () => {
    const { sdk, calls } = hdrBackend();
    const rgb = new Float32Array([4, 2, 1, 0, 0, 0]);
    const id = sdk.createEnvironmentFromFloat(2, 1, rgb);
    expect(calls.create_environment_from_float[0][2]).toBe(rgb);
    sdk.createEnvironmentFromFloat(1, 1, [8, 8, 8]);
    expect(calls.create_environment_from_float[1][2]).toEqual(new Float32Array([8, 8, 8]));
    expect(sdk.getTextures().find((t) => t.id === id)).toEqual({ id, width: 2, height: 1, src: null, hdr: true });
  });

  it('is usable as environment.map and freed by disposeTexture', () => {
    const { sdk, calls } = hdrBackend();
    const env = sdk.createEnvironmentFromFloat(2, 1, new Float32Array(6));
    sdk.setShading({ model: 'pbr', environment: { map: env, rotation: 1.25 } });
    expect(calls.set_scene_shading.at(-1)?.at(-1)).toBe(env);
    expect(calls.set_scene_env_rotation.at(-1)).toEqual([1.25]);
    expect(sdk.disposeTexture(env)).toBe(true);
    expect(sdk.getShading().environment).toMatchObject({ map: null, rotation: 1.25 });
    expect(sdk.getTextures()).toEqual([]);
  });
});

describe('GPU errors while prefiltering', () => {
  const OOM = 'GPU error while creating the environment map: Out of Memory';

  it('loadEnvironmentHdr rejects with the method prefix and frees the map', async () => {
    const { sdk, calls } = hdrBackend({ gpuError: (id) => (id === 2 ? OOM : null) });
    const ok = await sdk.loadEnvironmentHdr(HDR);
    await expect(sdk.environmentReady(ok)).resolves.toBeUndefined();
    await expect(sdk.loadEnvironmentHdr(HDR)).rejects.toThrow(`loadEnvironmentHdr: ${OOM}`);
    expect(calls.environment_ready).toEqual([[1], [2]]);
    expect(calls.dispose_texture).toEqual([[2]]);
    expect(sdk.getTextures().map((t) => t.id)).toEqual([1]);
    await expect(sdk.environmentReady(2)).rejects.toThrow(`loadEnvironmentHdr: ${OOM}`);
  });

  it('createEnvironmentFromFloat stays synchronous; environmentReady reports a late error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, calls } = hdrBackend({ gpuError: () => OOM });
    const env = sdk.createEnvironmentFromFloat(2, 1, new Float32Array(6));
    expect(typeof env).toBe('number');
    sdk.setShading({ model: 'pbr', environment: { map: env } });
    await expect(sdk.environmentReady(env)).rejects.toThrow(`createEnvironmentFromFloat: ${OOM}`);
    expect(calls.dispose_texture).toEqual([[env]]);
    expect(sdk.getTextures()).toEqual([]);
    expect(sdk.getShading().environment.map).toBeNull();
    expect(warn).toHaveBeenCalledWith(`createEnvironmentFromFloat: ${OOM}; environment map ${env} was disposed`);
  });

  it('a map disposed before its check settles is left alone', async () => {
    const { sdk, calls } = hdrBackend({ gpuError: () => OOM });
    const env = sdk.createEnvironmentFromFloat(2, 1, new Float32Array(6));
    expect(sdk.disposeTexture(env)).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(calls.dispose_texture).toEqual([[env]]);
    await expect(sdk.environmentReady(env)).rejects.toThrow('environmentReady: 1 is not a live HDR environment map');
  });

  it('environmentReady resolves for live maps without a pending check and rejects otherwise', async () => {
    const { sdk } = hdrBackend();
    const env = sdk.createEnvironmentFromFloat(2, 1, new Float32Array(6));
    await expect(sdk.environmentReady(env)).resolves.toBeUndefined();
    const ldr = sdk.createDataTexture(1, 1, new Uint8Array(4));
    await expect(sdk.environmentReady(ldr)).rejects.toThrow(`environmentReady: ${ldr} is not a live HDR environment map`);
    await expect(sdk.environmentReady(99)).rejects.toThrow('not a live HDR environment map');
  });
});

describe('environment.rotation', () => {
  it('defaults to 0, validates and round-trips through exportScene', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, arrayBuffer: async () => HDR.buffer.slice(0) }));
    vi.stubGlobal('fetch', fetchMock);
    const { sdk, calls } = hdrBackend();
    expect(sdk.getShading().environment.rotation).toBe(0);
    expect(() => sdk.setShading({ environment: { rotation: Number.NaN } })).toThrow('setShading: environment.rotation must be a finite number');
    const env = await sdk.loadEnvironmentHdr('/sky.hdr');
    sdk.setShading({ model: 'pbr', environment: { map: env, rotation: -0.5 } });
    const scene = JSON.parse(JSON.stringify(sdk.exportScene()));
    expect(scene.textures).toEqual([{ id: env, src: '/sky.hdr', width: 64, height: 32, hdr: true }]);
    expect(scene.shading.environment.rotation).toBe(-0.5);

    // Another session: the hdr texture is reloaded through loadEnvironmentHdr
    const other = hdrBackend();
    other.sdk.createDataTexture(2, 2, new Uint8Array(16)); // id 1: unrelated LDR texture
    await other.sdk.loadSceneWithTextures(scene);
    expect(other.calls.create_environment_hdr).toHaveLength(1);
    expect(other.sdk.getShading().environment).toMatchObject({ map: 2, rotation: -0.5 });
    expect(other.calls.set_scene_env_rotation.at(-1)).toEqual([-0.5]);
    expect(calls.create_environment_hdr).toHaveLength(1);
  });
});
