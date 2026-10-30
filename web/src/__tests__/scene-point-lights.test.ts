import { describe, expect, it } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { MAX_POINT_LIGHTS } from '../sdk/scene-lights';

/** Scene backend recording every `set_scene_point_lights` upload. */
function lightsBackend(withLights = true) {
  const sent: number[][] = [];
  let nextObject = 1;
  const backend: Record<string, unknown> = {
    add_primitive: () => nextObject++,
    add_custom_mesh: () => nextObject++,
    set_object_transform: () => true,
    get_object_transform: () => new Float32Array(0),
    set_object_material: () => true,
    remove_object: () => true,
    clear_scene_objects: () => {},
    object_count: () => 0,
    set_scene_lighting: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    set_scene_shading: () => {},
    max_texture_size: () => 4096,
    free: () => {},
  };
  if (withLights) {
    backend.set_scene_point_lights = (data: Float32Array) => {
      expect(data).toBeInstanceOf(Float32Array);
      sent.push(Array.from(data));
    };
  }
  const sdk = Charturbo.fromBackend(backend as unknown as WasmCharturboEngineBackend);
  return { sdk, sent };
}

describe('point lights', () => {
  it('adds lights with defaults and packs 8 floats each', () => {
    const { sdk, sent } = lightsBackend();
    expect(sdk.getPointLights()).toEqual([]);
    const a = sdk.addPointLight({ position: [1, 2, 3] });
    const b = sdk.addPointLight({ position: [-4, 5, 6], color: [1, 0, 0.5], intensity: 400, range: 30 });
    expect(a).not.toBe(b);
    expect(sdk.getPointLights()).toEqual([
      { id: a, position: [1, 2, 3], color: [1, 1, 1], intensity: 1, range: 100 },
      { id: b, position: [-4, 5, 6], color: [1, 0, 0.5], intensity: 400, range: 30 },
    ]);
    expect(sent.at(-1)).toEqual([1, 2, 3, 100, 1, 1, 1, 1, -4, 5, 6, 30, 1, 0, 0.5, 400]);
  });

  it('updates partially and removes by id', () => {
    const { sdk, sent } = lightsBackend();
    const a = sdk.addPointLight({ position: [0, 0, 0] });
    const b = sdk.addPointLight({ position: [9, 9, 9], color: [0, 1, 0] });
    sdk.setPointLight(a, { intensity: 2.5 });
    expect(sdk.getPointLights()[0]).toEqual({ id: a, position: [0, 0, 0], color: [1, 1, 1], intensity: 2.5, range: 100 });
    expect(sdk.removePointLight(a)).toBe(true);
    expect(sdk.removePointLight(a)).toBe(false);
    expect(sdk.getPointLights().map((l) => l.id)).toEqual([b]);
    expect(sent.at(-1)).toEqual([9, 9, 9, 100, 0, 1, 0, 1]);
    sdk.removePointLight(b);
    expect(sent.at(-1)).toEqual([]);
    // Ids are not reused
    expect(sdk.addPointLight({ position: [0, 0, 0] })).toBeGreaterThan(b);
  });

  it('throws past the limit and on unknown ids', () => {
    const { sdk, sent } = lightsBackend();
    for (let i = 0; i < MAX_POINT_LIGHTS; i++) sdk.addPointLight({ position: [i, 0, 0] });
    const uploads = sent.length;
    expect(() => sdk.addPointLight({ position: [0, 0, 0] })).toThrow('addPointLight: at most 8 point lights are supported; remove one first');
    expect(sent.length).toBe(uploads);
    expect(sdk.getPointLights()).toHaveLength(8);
    expect(() => sdk.setPointLight(999, { intensity: 1 })).toThrow('setPointLight: unknown point light id 999');
  });

  it('validates every field without changing anything', () => {
    const { sdk, sent } = lightsBackend();
    const id = sdk.addPointLight({ position: [1, 1, 1] });
    const before = sdk.getPointLights();
    const uploads = sent.length;
    const bad: unknown[] = [
      { position: [0, 0] },
      { position: [0, Number.NaN, 0] },
      { color: [1.2, 0, 0] },
      { color: 'red' },
      { intensity: -1 },
      { intensity: Infinity },
      { range: 0 },
      { range: 2e6 },
      null,
    ];
    for (const options of bad) {
      expect(() => sdk.setPointLight(id, options as never), JSON.stringify(options)).toThrow(/^setPointLight: /);
    }
    expect(() => sdk.addPointLight({} as never)).toThrow('addPointLight: position is required');
    expect(sdk.getPointLights()).toEqual(before);
    expect(sent.length).toBe(uploads);
  });

  it('returns copies', () => {
    const { sdk } = lightsBackend();
    sdk.addPointLight({ position: [1, 2, 3] });
    sdk.getPointLights()[0].position[0] = 99;
    expect(sdk.getPointLights()[0].position).toEqual([1, 2, 3]);
  });

  it('keeps lights on clearScene and round-trips through exportScene / loadScene', () => {
    const a = lightsBackend();
    a.sdk.addPointLight({ position: [10, 5, 0], color: [1, 0.2, 0.2], intensity: 600, range: 40 });
    a.sdk.addPointLight({ position: [-10, 5, 0], color: [0.2, 0.2, 1], intensity: 300, range: 25 });
    a.sdk.clearScene();
    expect(a.sdk.getPointLights()).toHaveLength(2);
    const scene = JSON.parse(JSON.stringify(a.sdk.exportScene()));
    expect(scene.pointLights).toEqual([
      { position: [10, 5, 0], color: [1, 0.2, 0.2], intensity: 600, range: 40 },
      { position: [-10, 5, 0], color: [0.2, 0.2, 1], intensity: 300, range: 25 },
    ]);
    const b = lightsBackend();
    b.sdk.addPointLight({ position: [0, 0, 0] });
    b.sdk.loadScene(scene);
    expect(b.sent.at(-1)).toEqual(a.sent.at(-1));
    expect(b.sdk.getPointLights().map(({ id: _id, ...l }) => l)).toEqual(scene.pointLights);
    // Without `pointLights` the current lights stay
    b.sdk.loadScene({ objects: [] });
    expect(b.sdk.getPointLights()).toHaveLength(2);
    // `[]` removes them
    b.sdk.loadScene({ objects: [], pointLights: [] });
    expect(b.sdk.getPointLights()).toEqual([]);
    expect(b.sent.at(-1)).toEqual([]);
  });

  it('rejects invalid descriptor lights before clearing the scene', () => {
    const { sdk } = lightsBackend();
    sdk.addPrimitive({ shape: 'box' });
    const tooMany = Array.from({ length: 9 }, () => ({ position: [0, 0, 0] as [number, number, number] }));
    expect(() => sdk.loadScene({ objects: [], pointLights: tooMany })).toThrow('loadScene: at most 8 point lights are supported (got 9)');
    expect(() => sdk.loadScene({ objects: [], pointLights: [{ position: [0, 0, 0], range: -1 }] })).toThrow(/^loadScene: pointLights\[0\]: range/);
    expect(sdk.getObjects()).toHaveLength(1);
  });

  it('tolerates engines without point lights', () => {
    const { sdk } = lightsBackend(false);
    const id = sdk.addPointLight({ position: [0, 1, 0] });
    sdk.setPointLight(id, { color: [0, 0, 1] });
    expect(sdk.getPointLights()[0].color).toEqual([0, 0, 1]);
  });
});
