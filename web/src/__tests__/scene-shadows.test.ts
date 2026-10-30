import { describe, expect, it } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import type { SceneShadowsState } from '../sdk/scene-shadows';

type Calls = Record<string, unknown[][]>;

/** Scene backend recording the shadow contract; `deviceMax` mimics the engine's map clamp. */
function shadowBackend(opts: { deviceMax?: number; withShadows?: boolean } = {}) {
  const { deviceMax = 4096, withShadows = true } = opts;
  const calls: Calls = {};
  const log = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  let nextObject = 1;
  let engine: number[] = [0, 2048, 0.5, 1, 1.5, 1, 1, 0, 0, 0, 0];
  const backend: Record<string, unknown> = {
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
    set_scene_shading: () => {},
    max_texture_size: () => 4096,
    set_object_map: () => true,
    set_custom_mesh_uvs: () => true,
    free: () => {},
  };
  if (withShadows) {
    backend.set_scene_shadows = (...args: number[]) => {
      log('set_scene_shadows', args);
      const size = Math.min(args[1], deviceMax);
      engine = [args[0] ? 1 : 0, size, ...args.slice(2, 6), args[6] ? 1 : 0, ...args.slice(7)];
    };
    backend.get_scene_shadows = () => engine;
    backend.set_object_shadow_flags = (...args: unknown[]) => {
      log('set_object_shadow_flags', args);
      return true;
    };
  }
  const sdk = Charturbo.fromBackend(backend as unknown as WasmCharturboEngineBackend);
  return { calls, sdk };
}

const DEFAULTS: SceneShadowsState = {
  enabled: false,
  mapSize: 2048,
  bias: 0.5,
  normalBias: 1,
  softness: 1.5,
  darkness: 1,
  bounds: 'auto',
};

describe('setShadows', () => {
  it('is off by default and sends nothing until set', () => {
    const { sdk, calls } = shadowBackend();
    expect(sdk.getShadows()).toEqual(DEFAULTS);
    expect(calls.set_scene_shadows).toBeUndefined();
  });

  it('merges partial updates and encodes the engine call', () => {
    const { sdk, calls } = shadowBackend();
    sdk.setShadows({ enabled: true });
    expect(calls.set_scene_shadows.at(-1)).toEqual([true, 2048, 0.5, 1, 1.5, 1, true, 0, 0, 0, 0]);
    sdk.setShadows({ mapSize: 1024, softness: 0, darkness: 0.6, bounds: { center: [1, 2, 3], radius: 5 } });
    expect(calls.set_scene_shadows.at(-1)).toEqual([true, 1024, 0.5, 1, 0, 0.6, false, 1, 2, 3, 5]);
    expect(sdk.getShadows()).toEqual({
      ...DEFAULTS,
      enabled: true,
      mapSize: 1024,
      softness: 0,
      darkness: 0.6,
      bounds: { center: [1, 2, 3], radius: 5 },
    });
    sdk.setShadows({ bounds: 'auto' });
    expect(sdk.getShadows().bounds).toBe('auto');
  });

  it('reports the device-clamped map size', () => {
    const { sdk } = shadowBackend({ deviceMax: 2048 });
    sdk.setShadows({ enabled: true, mapSize: 4096 });
    expect(sdk.getShadows().mapSize).toBe(2048);
  });

  it('returns copies', () => {
    const { sdk } = shadowBackend();
    sdk.setShadows({ bounds: { center: [0, 0, 0], radius: 1 } });
    const s = sdk.getShadows();
    (s.bounds as { center: number[] }).center[0] = 9;
    expect(sdk.getShadows().bounds).toEqual({ center: [0, 0, 0], radius: 1 });
  });

  it.each([
    [{ enabled: 1 }, /setShadows: enabled/],
    [{ mapSize: 300 }, /setShadows: mapSize/],
    [{ bias: -1 }, /setShadows: bias/],
    [{ normalBias: 17 }, /setShadows: normalBias/],
    [{ softness: 9 }, /setShadows: softness/],
    [{ darkness: 1.5 }, /setShadows: darkness/],
    [{ darkness: Number.NaN }, /setShadows: darkness/],
    [{ bounds: 'box' }, /setShadows: bounds/],
    [{ bounds: { center: [0, 0], radius: 1 } }, /setShadows: bounds/],
    [{ bounds: { center: [0, 0, 0], radius: 0 } }, /setShadows: bounds.radius/],
  ])('rejects %j without changing state', (bad, msg) => {
    const { sdk, calls } = shadowBackend();
    expect(() => sdk.setShadows(bad as never)).toThrow(msg);
    expect(sdk.getShadows()).toEqual(DEFAULTS);
    expect(calls.set_scene_shadows).toBeUndefined();
  });

  it('is a no-op on engines without the shadow methods', () => {
    const { sdk } = shadowBackend({ withShadows: false });
    expect(() => sdk.setShadows({ enabled: true, mapSize: 512 })).not.toThrow();
    expect(sdk.getShadows()).toEqual({ ...DEFAULTS, enabled: true, mapSize: 512 });
    const id = sdk.addBox({ castShadow: false });
    expect(sdk.setObjectMaterial(id, { receiveShadow: false })).toBe(true);
  });
});

describe('object shadow flags', () => {
  it('default to cast and receive without an engine call', () => {
    const { sdk, calls } = shadowBackend();
    const id = sdk.addBox({});
    const rec = sdk.getObjects().find((r) => r.id === id)!;
    expect(rec.castShadow).toBe(true);
    expect(rec.receiveShadow).toBe(true);
    expect(calls.set_object_shadow_flags).toBeUndefined();
  });

  it('are sent on creation when opted out', () => {
    const { sdk, calls } = shadowBackend();
    const a = sdk.addSphere({ castShadow: false });
    const b = sdk.addCustomMesh({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      indices: [0, 1, 2],
      receiveShadow: false,
    });
    expect(calls.set_object_shadow_flags).toEqual([
      [a, false, true],
      [b, true, false],
    ]);
  });

  it('are updated through setObjectMaterial', () => {
    const { sdk, calls } = shadowBackend();
    const id = sdk.addBox({});
    expect(sdk.setObjectMaterial(id, { receiveShadow: false })).toBe(true);
    expect(calls.set_object_shadow_flags.at(-1)).toEqual([id, true, false]);
    sdk.setObjectMaterial(id, { castShadow: false });
    expect(calls.set_object_shadow_flags.at(-1)).toEqual([id, false, false]);
    const rec = sdk.getObjects().find((r) => r.id === id)!;
    expect([rec.castShadow, rec.receiveShadow]).toEqual([false, false]);
    sdk.setObjectMaterial(id, { color: [1, 0, 0, 1] });
    expect(calls.set_object_shadow_flags).toHaveLength(2);
  });

  it('reject non-boolean flags', () => {
    const { sdk } = shadowBackend();
    expect(() => sdk.addBox({ castShadow: 'no' as never })).toThrow(/addPrimitive: castShadow/);
    expect(sdk.getObjects()).toHaveLength(0);
    const id = sdk.addBox({ color: [0, 0, 1, 1] });
    expect(() => sdk.setObjectMaterial(id, { color: [1, 0, 0, 1], receiveShadow: 0 as never })).toThrow(
      /setObjectMaterial: receiveShadow/
    );
    expect(sdk.getObjects()[0].color).toEqual([0, 0, 1, 1]);
  });
});

describe('shadows in exportScene / loadScene', () => {
  it('round-trips the settings and the object flags', () => {
    const { sdk, calls } = shadowBackend();
    sdk.addBox({ castShadow: false });
    sdk.addSphere({ receiveShadow: false });
    sdk.setShadows({ enabled: true, mapSize: 1024, softness: 2, bounds: { center: [0, 1, 0], radius: 8 } });
    const scene = JSON.parse(JSON.stringify(sdk.exportScene()));
    expect(scene.shadows).toEqual(sdk.getShadows());
    expect(scene.objects.map((o: { castShadow: boolean; receiveShadow: boolean }) => [o.castShadow, o.receiveShadow])).toEqual([
      [false, true],
      [true, false],
    ]);

    sdk.setShadows({ enabled: false, mapSize: 4096, bounds: 'auto' });
    const ids = sdk.loadScene(scene);
    expect(sdk.getShadows()).toEqual(scene.shadows);
    expect(calls.set_object_shadow_flags.slice(-2)).toEqual([
      [ids[0], false, true],
      [ids[1], true, false],
    ]);
  });

  it('loadScene without shadows keeps the current settings', () => {
    const { sdk } = shadowBackend();
    sdk.setShadows({ enabled: true, darkness: 0.5 });
    const before = sdk.getShadows();
    sdk.loadScene({ objects: [] });
    expect(sdk.getShadows()).toEqual(before);
  });
});
