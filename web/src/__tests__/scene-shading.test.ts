import { afterEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type SceneShadingState, type WasmCharturboEngineBackend } from '../sdk/charturbo';

type Calls = Record<string, unknown[][]>;

/** Scene backend recording the shading / texture contract (texture ids from 1, like the engine). */
function shadingBackend() {
  const calls: Calls = {};
  const log = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  let nextObject = 1;
  let nextTexture = 1;
  const live = new Set<number>();
  const backend = {
    add_primitive: () => nextObject++,
    add_custom_mesh: () => nextObject++,
    set_object_transform: () => true,
    get_object_transform: () => new Float32Array(0),
    set_object_material: () => true,
    set_object_physics: () => true,
    set_object_angular_velocity: () => true,
    set_object_parent: () => true,
    remove_object: () => true,
    clear_scene_objects: () => {},
    object_count: () => 0,
    set_scene_lighting: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    set_scene_shading: (...args: unknown[]) => log('set_scene_shading', args),
    max_texture_size: () => 4096,
    create_texture_from_bitmap: () => {
      const id = nextTexture++;
      live.add(id);
      return id;
    },
    create_texture_rgba8: () => {
      const id = nextTexture++;
      live.add(id);
      return id;
    },
    dispose_texture: (id: number) => {
      log('dispose_texture', [id]);
      return live.delete(id);
    },
    set_object_map: () => true,
    set_custom_mesh_uvs: () => true,
    free: () => {},
  } as unknown as WasmCharturboEngineBackend;
  return { backend, calls, sdk: Charturbo.fromBackend(backend) };
}

const lastShading = (calls: Calls) => calls.set_scene_shading?.at(-1);
const sky = (w: number, h: number) => new Uint8Array(w * h * 4).fill(200);

const DEFAULTS: SceneShadingState = {
  model: 'classic',
  toneMapping: 'aces',
  exposure: 1,
  environment: { sky: [0.6, 0.66, 0.76], ground: [0.24, 0.22, 0.2], intensity: 1, map: null, rotation: 0 },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('setShading', () => {
  it('defaults to classic and sends nothing until set', () => {
    const { sdk, calls } = shadingBackend();
    expect(sdk.getShading()).toEqual(DEFAULTS);
    expect(calls.set_scene_shading).toBeUndefined();
  });

  it('merges partial updates and encodes the engine call', () => {
    const { sdk, calls } = shadingBackend();
    sdk.setShading({ model: 'pbr' });
    expect(lastShading(calls)).toEqual([1, 1, 1, 0.6, 0.66, 0.76, 0.24, 0.22, 0.2, 1, 0]);
    const env = sdk.createDataTexture(8, 4, sky(8, 4));
    sdk.setShading({ toneMapping: 'reinhard', exposure: 1.5, environment: { ground: [0, 0, 0.5], map: env } });
    expect(lastShading(calls)).toEqual([1, 2, 1.5, 0.6, 0.66, 0.76, 0, 0, 0.5, 1, env]);
    sdk.setShading({ environment: { intensity: 2 } });
    const s = sdk.getShading();
    expect(s.environment).toEqual({ sky: [0.6, 0.66, 0.76], ground: [0, 0, 0.5], intensity: 2, map: env, rotation: 0 });
    expect(s.model).toBe('pbr');
    sdk.setShading({ toneMapping: 'none', environment: { map: 0 } });
    expect(sdk.getShading().environment.map).toBeNull();
    expect(lastShading(calls)?.slice(1, 2)).toEqual([0]);
    expect(lastShading(calls)?.at(-1)).toBe(0);
    sdk.setShading({ model: 'classic' });
    expect(lastShading(calls)?.[0]).toBe(0);
  });

  it('returns copies', () => {
    const { sdk } = shadingBackend();
    const s = sdk.getShading();
    s.environment.sky[0] = 0;
    s.model = 'pbr';
    expect(sdk.getShading()).toEqual(DEFAULTS);
  });

  it('rejects invalid values without changing the state', () => {
    const { sdk, calls } = shadingBackend();
    const bad: unknown[] = [
      { model: 'phong' },
      { toneMapping: 'filmic' },
      { toneMapping: 'toString' },
      { exposure: -1 },
      { exposure: Number.NaN },
      { exposure: 17 },
      { environment: { intensity: Infinity } },
      { environment: { sky: [1, 1] } },
      { environment: { ground: [0, 2, 0] } },
      { environment: { map: 1.5 } },
      { environment: { map: -2 } },
      { environment: null },
    ];
    for (const options of bad) {
      expect(() => sdk.setShading(options as never), JSON.stringify(options)).toThrow(/^setShading: /);
    }
    expect(() => sdk.setShading(null as never)).toThrow('setShading: options must be an object');
    expect(sdk.getShading()).toEqual(DEFAULTS);
    expect(calls.set_scene_shading).toBeUndefined();
  });

  it('keeps unknown environment ids (the engine falls back to the hemisphere)', () => {
    const { sdk, calls } = shadingBackend();
    sdk.setShading({ model: 'pbr', environment: { map: 42 } });
    expect(sdk.getShading().environment.map).toBe(42);
    expect(lastShading(calls)?.at(-1)).toBe(42);
  });

  it('disposeTexture clears the environment map and resends', () => {
    const { sdk, calls } = shadingBackend();
    const env = sdk.createDataTexture(8, 4, sky(8, 4));
    const other = sdk.createDataTexture(1, 1, sky(1, 1));
    sdk.setShading({ model: 'pbr', environment: { map: env } });
    const sent = calls.set_scene_shading.length;
    sdk.disposeTexture(other);
    expect(calls.set_scene_shading).toHaveLength(sent);
    sdk.disposeTexture(env);
    expect(sdk.getShading().environment.map).toBeNull();
    expect(calls.set_scene_shading).toHaveLength(sent + 1);
    expect(lastShading(calls)?.at(-1)).toBe(0);
    expect(sdk.getShading().model).toBe('pbr');
  });

  it('works on backends without shading support', () => {
    const { backend } = shadingBackend();
    delete (backend as { set_scene_shading?: unknown }).set_scene_shading;
    const sdk = Charturbo.fromBackend(backend);
    sdk.setShading({ model: 'pbr' });
    expect(sdk.getShading().model).toBe('pbr');
  });
});

describe('shading in exportScene / loadScene', () => {
  it('round-trips the shading and lists the environment texture', () => {
    const { sdk, calls } = shadingBackend();
    const env = sdk.createDataTexture(8, 4, sky(8, 4));
    sdk.addBox({});
    sdk.setShading({ model: 'pbr', toneMapping: 'reinhard', exposure: 0.8, environment: { sky: [1, 0.9, 0.8], intensity: 1.5, map: env } });
    const scene = sdk.exportScene();
    expect(scene.shading).toEqual({
      model: 'pbr',
      toneMapping: 'reinhard',
      exposure: 0.8,
      environment: { sky: [1, 0.9, 0.8], ground: [0.24, 0.22, 0.2], intensity: 1.5, map: env, rotation: 0 },
    });
    expect(scene.textures).toEqual([{ id: env, src: null, width: 8, height: 4 }]);
    const json = JSON.parse(JSON.stringify(scene));

    sdk.setShading({ model: 'classic', exposure: 2, environment: { map: null } });
    sdk.loadScene(json);
    expect(sdk.getShading()).toEqual(scene.shading);
    expect(lastShading(calls)).toEqual([1, 2, 0.8, 1, 0.9, 0.8, 0.24, 0.22, 0.2, 1.5, env]);
  });

  it('loadScene drops an unknown environment id with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = shadingBackend();
    sdk.loadScene({ shading: { model: 'pbr', environment: { map: 7 } }, objects: [] });
    expect(sdk.getShading().environment.map).toBeNull();
    expect(sdk.getShading().model).toBe('pbr');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('unknown environment texture id 7');
  });

  it('loadScene without shading keeps the current shading', () => {
    const { sdk } = shadingBackend();
    sdk.setShading({ model: 'pbr' });
    sdk.loadScene({ objects: [] });
    expect(sdk.getShading().model).toBe('pbr');
  });

  it('loadSceneWithTextures remaps the environment map id like object maps', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, blob: async () => new Blob(['x']) })));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 64, height: 32, close: vi.fn() })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, calls } = shadingBackend();
    sdk.createDataTexture(2, 2, sky(2, 2)); // id 1: unrelated live texture

    await sdk.loadSceneWithTextures({
      textures: [{ id: 1, src: '/sky.png', width: 64, height: 32 }],
      shading: { model: 'pbr', environment: { map: 1 } },
      objects: [],
    });
    const loaded = sdk.getTextures().find((t) => t.src === '/sky.png');
    expect(loaded?.id).toBe(2);
    expect(sdk.getShading().environment.map).toBe(2);
    expect(lastShading(calls)?.at(-1)).toBe(2);

    // A src-less environment texture that cannot be restored is dropped
    await sdk.loadSceneWithTextures({
      textures: [{ id: 9, src: null, width: 4, height: 2 }],
      shading: { environment: { map: 9 } },
      objects: [],
    });
    expect(sdk.getShading().environment.map).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
