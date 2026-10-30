import { describe, expect, it } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { defaultPostSettings } from '../sdk/scene-post';

/** Scene backend recording the post-processing contract (`supported` mimics the device). */
function postBackend(opts: { supported?: boolean; withPost?: boolean } = {}) {
  const { supported = true, withPost = true } = opts;
  const sent: unknown[][] = [];
  let nextObject = 1;
  let pbr = false;
  let engine: number[] = [0, 0.6, 1, 0.5, 0.7, 0, -4, 4, 3, 1, 0, 0, supported ? 1 : 0, 0];
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
    set_scene_shading: (model: number) => {
      pbr = model === 1;
    },
    max_texture_size: () => 4096,
    free: () => {},
  };
  if (withPost) {
    backend.set_post_processing = (...args: unknown[]) => {
      sent.push(args);
      const n = args.map((v) => (typeof v === 'boolean' ? (v ? 1 : 0) : (v as number)));
      const on = (n[0] === 1 || n[5] === 1) && pbr && supported;
      engine = [...n, supported ? 1 : 0, on ? 1 : 0];
    };
    backend.get_post_processing = () => engine;
  }
  const sdk = Charturbo.fromBackend(backend as unknown as WasmCharturboEngineBackend);
  return { sent, sdk };
}

describe('setPostProcessing', () => {
  it('starts off with the documented defaults', () => {
    const { sdk } = postBackend();
    expect(sdk.getPostProcessing()).toEqual({ ...defaultPostSettings(), supported: true, active: false });
  });

  it('merges partial options and sends every field', () => {
    const { sdk, sent } = postBackend();
    sdk.setPostProcessing({ bloom: { enabled: true, intensity: 1.5 } });
    sdk.setPostProcessing({ autoExposure: { enabled: true, minEv: -2, adaptation: 'instant' } });
    expect(sent.at(-1)).toEqual([true, 1.5, 1, 0.5, 0.7, true, -2, 4, 3, 1, 0, true]);
    const s = sdk.getPostProcessing();
    expect(s.bloom).toEqual({ enabled: true, intensity: 1.5, threshold: 1, knee: 0.5, radius: 0.7 });
    expect(s.autoExposure.adaptation).toBe('instant');
  });

  it('reports active only with PBR shading', () => {
    const { sdk } = postBackend();
    sdk.setPostProcessing({ bloom: { enabled: true } });
    expect(sdk.getPostProcessing().active).toBe(false);
    sdk.setShading({ model: 'pbr' });
    sdk.setPostProcessing({});
    expect(sdk.getPostProcessing().active).toBe(true);
  });

  it('reports unsupported devices', () => {
    const { sdk } = postBackend({ supported: false });
    sdk.setShading({ model: 'pbr' });
    sdk.setPostProcessing({ bloom: { enabled: true } });
    expect(sdk.getPostProcessing()).toMatchObject({ supported: false, active: false });
    expect(sdk.getPostProcessing().bloom.enabled).toBe(true);
  });

  it('tolerates engines without post-processing', () => {
    const { sdk } = postBackend({ withPost: false });
    sdk.setPostProcessing({ bloom: { enabled: true } });
    expect(sdk.getPostProcessing()).toMatchObject({ supported: false, active: false, bloom: { enabled: true } });
  });

  it('rejects invalid values without changing the state', () => {
    const { sdk, sent } = postBackend();
    const bad: unknown[] = [
      null,
      { bloom: 1 },
      { bloom: { enabled: 'yes' } },
      { bloom: { intensity: -1 } },
      { bloom: { intensity: 9 } },
      { bloom: { threshold: Number.NaN } },
      { bloom: { knee: 2 } },
      { bloom: { radius: -0.1 } },
      { autoExposure: { minEv: -17 } },
      { autoExposure: { maxEv: -5 } },
      { autoExposure: { speedUp: 101 } },
      { autoExposure: { speedDown: -1 } },
      { autoExposure: { compensation: 9 } },
      { autoExposure: { adaptation: 'fast' } },
    ];
    for (const options of bad) {
      expect(() => sdk.setPostProcessing(options as never), JSON.stringify(options)).toThrow(/^setPostProcessing: /);
    }
    expect(sent).toEqual([]);
    expect(sdk.getPostProcessing().bloom).toEqual(defaultPostSettings().bloom);
  });

  it('returns copies', () => {
    const { sdk } = postBackend();
    sdk.getPostProcessing().bloom.intensity = 5;
    expect(sdk.getPostProcessing().bloom.intensity).toBe(0.6);
  });

  it('round-trips through exportScene / loadScene', () => {
    const a = postBackend();
    a.sdk.setPostProcessing({
      bloom: { enabled: true, intensity: 2, threshold: 0.8, knee: 0.2, radius: 0.4 },
      autoExposure: { enabled: true, minEv: -1, maxEv: 6, speedUp: 5, speedDown: 2, compensation: 0.5, adaptation: 'instant' },
    });
    const scene = a.sdk.exportScene();
    expect(scene.postProcessing).toEqual({
      bloom: { enabled: true, intensity: 2, threshold: 0.8, knee: 0.2, radius: 0.4 },
      autoExposure: { enabled: true, minEv: -1, maxEv: 6, speedUp: 5, speedDown: 2, compensation: 0.5, adaptation: 'instant' },
    });
    const b = postBackend();
    b.sdk.loadScene(JSON.parse(JSON.stringify(scene)));
    expect(b.sent.at(-1)).toEqual(a.sent.at(-1));
    const { supported: _s, active: _a, ...settings } = b.sdk.getPostProcessing();
    expect(settings).toEqual(scene.postProcessing);
  });
});
