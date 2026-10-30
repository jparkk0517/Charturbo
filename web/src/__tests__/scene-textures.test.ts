import { afterEach, describe, expect, it, vi } from 'vitest';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

type Calls = Record<string, unknown[][]>;

/** Scene backend with the texture contract recorded (ids from 1, like the engine). */
function textureBackend(options: { maxTextureSize?: number; withTextures?: boolean } = {}) {
  const calls: Calls = {};
  const log = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const maps = new Map<number, number[]>();
  let nextObject = 1;
  let nextTexture = 1;
  const live = new Set<number>();
  const base = {
    add_primitive: (...args: unknown[]) => {
      log('add_primitive', args);
      return nextObject++;
    },
    add_custom_mesh: (...args: unknown[]) => {
      log('add_custom_mesh', args);
      return nextObject++;
    },
    set_object_transform: () => true,
    get_object_transform: () => new Float32Array(0),
    set_object_material: (...args: unknown[]) => {
      log('set_object_material', args);
      return true;
    },
    set_object_physics: () => true,
    set_object_angular_velocity: () => true,
    set_object_parent: () => true,
    remove_object: () => true,
    clear_scene_objects: () => {
      log('clear_scene_objects', []);
    },
    object_count: () => 0,
    set_scene_lighting: () => {},
    set_scene_helpers: () => {},
    set_rigid_physics: () => {},
    set_graph_visible: () => {},
    free: () => {},
  };
  const textures = {
    max_texture_size: () => options.maxTextureSize ?? 4096,
    create_texture_from_bitmap: (...args: unknown[]) => {
      log('create_texture_from_bitmap', args);
      const id = nextTexture++;
      live.add(id);
      return id;
    },
    create_texture_rgba8: (...args: unknown[]) => {
      log('create_texture_rgba8', args);
      const id = nextTexture++;
      live.add(id);
      return id;
    },
    dispose_texture: (id: number) => {
      log('dispose_texture', [id]);
      return live.delete(id);
    },
    set_object_map: (...args: unknown[]) => {
      log('set_object_map', args);
      const [id, ...rest] = args as number[];
      maps.set(id, rest);
      return true;
    },
    set_custom_mesh_uvs: (...args: unknown[]) => {
      log('set_custom_mesh_uvs', args);
      return true;
    },
  };
  const backend = (options.withTextures === false ? base : { ...base, ...textures }) as unknown as WasmCharturboEngineBackend;
  return { backend, calls, maps, sdk: Charturbo.fromBackend(backend) };
}

const fakeBitmap = (width: number, height: number) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
const checker = (size: number) => new Uint8Array(size * size * 4).fill(255);
const triangle = {
  positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
  indices: [0, 1, 2],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('textures: engine without texture support', () => {
  it('throws English "engine has no texture support" errors', async () => {
    const { sdk } = textureBackend({ withTextures: false });
    await expect(sdk.loadTexture(fakeBitmap(2, 2))).rejects.toThrow('loadTexture: engine has no texture support');
    await expect(sdk.loadTexture({ data: new Uint8ClampedArray(4), width: 1, height: 1 } as ImageData)).rejects.toThrow(
      'loadTexture: engine has no texture support'
    );
    expect(() => sdk.createDataTexture(1, 1, checker(1))).toThrow('createDataTexture: engine has no texture support');
    expect(() => sdk.disposeTexture(1)).toThrow('disposeTexture: engine has no texture support');
    expect(sdk.maxTextureSize).toBe(0);
    expect(sdk.getTextures()).toEqual([]);
  });

  it('still adds textured descriptors without touching the engine map', () => {
    const { sdk } = textureBackend({ withTextures: false });
    const id = sdk.addBox({ map: 3 });
    expect(sdk.getObjectRecord(id)?.map).toBe(3);
  });
});

describe('createDataTexture', () => {
  it('uploads RGBA8, records the texture and forwards mipmaps', () => {
    const { sdk, calls } = textureBackend();
    const rgba = checker(4);
    const id = sdk.createDataTexture(4, 4, rgba);
    expect(id).toBe(1);
    expect(calls.create_texture_rgba8[0]).toEqual([4, 4, rgba, true]);
    const off = sdk.createDataTexture(2, 2, checker(2), { mipmaps: false });
    expect(calls.create_texture_rgba8[1][3]).toBe(false);
    expect(sdk.getTextures()).toEqual([
      { id, width: 4, height: 4, src: null },
      { id: off, width: 2, height: 2, src: null },
    ]);
    expect(sdk.maxTextureSize).toBe(4096);
  });

  it('accepts Uint8ClampedArray as a Uint8Array view of the same bytes', () => {
    const { sdk, calls } = textureBackend();
    const clamped = new Uint8ClampedArray(16).fill(7);
    sdk.createDataTexture(2, 2, clamped);
    const sent = calls.create_texture_rgba8[0][2] as Uint8Array;
    expect(sent).toBeInstanceOf(Uint8Array);
    expect(sent.buffer).toBe(clamped.buffer);
    expect(Array.from(sent)).toEqual(Array.from(clamped));
  });

  it('rejects bad sizes and prefixes engine errors', () => {
    const { sdk, backend } = textureBackend();
    expect(() => sdk.createDataTexture(0, 2, new Uint8Array(0))).toThrow('createDataTexture: width and height must be positive integers');
    expect(() => sdk.createDataTexture(2, 2, new Uint8Array(15))).toThrow('createDataTexture: rgba must hold width * height * 4 = 16 bytes (got 15)');
    backend.create_texture_rgba8 = () => {
      throw 'texture memory budget exceeded';
    };
    expect(() => sdk.createDataTexture(2, 2, checker(2))).toThrow('createDataTexture: texture memory budget exceeded');
    expect(sdk.getTextures()).toEqual([]);
  });
});

describe('loadTexture sources', () => {
  it('decodes an ImageBitmap with straight alpha and closes only the bitmap it created', async () => {
    const decoded = fakeBitmap(8, 4);
    const createImageBitmap = vi.fn(async () => decoded);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk, calls } = textureBackend();
    const input = fakeBitmap(8, 4);
    const id = await sdk.loadTexture(input);
    expect(createImageBitmap).toHaveBeenCalledWith(input, {
      premultiplyAlpha: 'none',
      colorSpaceConversion: 'default',
      imageOrientation: 'from-image',
    });
    expect(calls.create_texture_from_bitmap[0]).toEqual([decoded, true]);
    expect(decoded.close).toHaveBeenCalledTimes(1);
    expect(input.close).not.toHaveBeenCalled();
    expect(sdk.getTextures()).toEqual([{ id, width: 8, height: 4, src: null }]);
  });

  it('accepts Blob, canvas-like and HTMLImageElement-like sources', async () => {
    const createImageBitmap = vi.fn(async (_image: unknown, _options?: unknown) => fakeBitmap(4, 4));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk, calls } = textureBackend();
    const blob = new Blob(['x'], { type: 'image/png' });
    const canvas = { width: 4, height: 4 } as unknown as HTMLCanvasElement;
    const img = { naturalWidth: 4, naturalHeight: 4, width: 4, height: 4 } as unknown as HTMLImageElement;
    await sdk.loadTexture(blob, { mipmaps: false });
    await sdk.loadTexture(canvas);
    await sdk.loadTexture(img);
    expect(createImageBitmap.mock.calls.map((c) => c[0])).toEqual([blob, canvas, img]);
    expect(calls.create_texture_from_bitmap.map((c) => c[1])).toEqual([false, true, true]);
    expect(sdk.getTextures().every((t) => t.src === null)).toBe(true);
  });

  it('fetches strings and URLs with the signal and remembers src', async () => {
    const blob = new Blob(['x']);
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => ({ ok: true, blob: async () => blob }));
    vi.stubGlobal('fetch', fetchMock);
    const createImageBitmap = vi.fn(async (_image: unknown, _options?: unknown) => fakeBitmap(2, 2));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk } = textureBackend();
    const controller = new AbortController();
    const a = await sdk.loadTexture('/img/a.png', { signal: controller.signal });
    const b = await sdk.loadTexture(new URL('https://example.com/b.png'));
    expect(fetchMock.mock.calls[0]).toEqual(['/img/a.png', { signal: controller.signal }]);
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/b.png');
    expect(createImageBitmap.mock.calls[0][0]).toBe(blob);
    expect(sdk.getTextures()).toEqual([
      { id: a, width: 2, height: 2, src: '/img/a.png' },
      { id: b, width: 2, height: 2, src: 'https://example.com/b.png' },
    ]);
  });

  it('uploads ImageData through create_texture_rgba8 without a bitmap', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk, calls } = textureBackend();
    const data = new Uint8ClampedArray(2 * 3 * 4).fill(9);
    const id = await sdk.loadTexture({ data, width: 2, height: 3 } as ImageData, { mipmaps: false });
    expect(createImageBitmap).not.toHaveBeenCalled();
    const [w, h, rgba, mips] = calls.create_texture_rgba8[0] as [number, number, Uint8Array, boolean];
    expect([w, h, mips]).toEqual([2, 3, false]);
    expect(rgba.byteLength).toBe(24);
    expect(sdk.getTextures()).toEqual([{ id, width: 2, height: 3, src: null }]);
  });

  it('rejects ImageData larger than the maximum texture size', async () => {
    const { sdk, calls } = textureBackend({ maxTextureSize: 4 });
    await expect(sdk.loadTexture({ data: new Uint8ClampedArray(8 * 1 * 4), width: 8, height: 1 } as ImageData)).rejects.toThrow(
      'loadTexture: ImageData 8x1 exceeds the maximum texture size 4'
    );
    expect(calls.create_texture_rgba8).toBeUndefined();
  });
});

describe('loadTexture resizing', () => {
  it('downscales sources with a known size while decoding, keeping the aspect ratio', async () => {
    const createImageBitmap = vi.fn(async () => fakeBitmap(4096, 1024));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk } = textureBackend({ maxTextureSize: 4096 });
    const canvas = { width: 8192, height: 2048 } as unknown as HTMLCanvasElement;
    await sdk.loadTexture(canvas);
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledWith(canvas, expect.objectContaining({ resizeWidth: 4096, resizeHeight: 1024 }));
  });

  it('does not resize images within the limit', async () => {
    const createImageBitmap = vi.fn(async () => fakeBitmap(4096, 16));
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk } = textureBackend({ maxTextureSize: 4096 });
    await sdk.loadTexture({ width: 4096, height: 16 } as unknown as HTMLCanvasElement);
    const opts = (createImageBitmap.mock.calls[0] as unknown as [unknown, Record<string, unknown>])[1];
    expect(opts).not.toHaveProperty('resizeWidth');
  });

  it('shrinks a decoded Blob bitmap in a second pass and closes both bitmaps', async () => {
    const full = fakeBitmap(2000, 500);
    const small = fakeBitmap(1000, 250);
    const createImageBitmap = vi.fn().mockResolvedValueOnce(full).mockResolvedValueOnce(small);
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk, calls } = textureBackend({ maxTextureSize: 1000 });
    const id = await sdk.loadTexture(new Blob(['x']));
    expect(createImageBitmap.mock.calls[1][0]).toBe(full);
    expect(createImageBitmap.mock.calls[1][1]).toMatchObject({ resizeWidth: 1000, resizeHeight: 250, premultiplyAlpha: 'none' });
    expect(calls.create_texture_from_bitmap[0][0]).toBe(small);
    expect(full.close).toHaveBeenCalled();
    expect(small.close).toHaveBeenCalled();
    expect(sdk.getTextures()).toEqual([{ id, width: 1000, height: 250, src: null }]);
  });
});

describe('loadTexture failures', () => {
  it('rejects with an AbortError for an already aborted signal', async () => {
    const createImageBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    const { sdk } = textureBackend();
    const controller = new AbortController();
    controller.abort();
    await expect(sdk.loadTexture(fakeBitmap(1, 1), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(createImageBitmap).not.toHaveBeenCalled();
  });

  it('rejects with an AbortError when the fetch is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            init.signal.addEventListener('abort', () => reject(new TypeError('network aborted')));
          })
      )
    );
    const { sdk } = textureBackend();
    const controller = new AbortController();
    const pending = sdk.loadTexture('/slow.png', { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(sdk.getTextures()).toEqual([]);
  });

  it('closes the bitmap and skips the upload when aborted during decoding', async () => {
    const controller = new AbortController();
    const decoded = fakeBitmap(2, 2);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => (controller.abort(), decoded)));
    const { sdk, calls } = textureBackend();
    await expect(sdk.loadTexture(fakeBitmap(2, 2), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(decoded.close).toHaveBeenCalledTimes(1);
    expect(calls.create_texture_from_bitmap).toBeUndefined();
  });

  it('reports tainted images as cross-origin', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('tainted', 'SecurityError'))));
    const { sdk } = textureBackend();
    await expect(sdk.loadTexture({ width: 2, height: 2 } as unknown as HTMLCanvasElement)).rejects.toThrow('loadTexture: cross-origin image');
  });

  it('reports other decode and HTTP failures with the loadTexture prefix', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => Promise.reject(new DOMException('bad data', 'InvalidStateError'))));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const { sdk } = textureBackend();
    await expect(sdk.loadTexture(new Blob(['x']))).rejects.toThrow('loadTexture: could not decode image (bad data)');
    await expect(sdk.loadTexture('/missing.png')).rejects.toThrow('loadTexture: failed to fetch /missing.png (404)');
  });

  it('closes the bitmap when the engine rejects the upload', async () => {
    const decoded = fakeBitmap(2, 2);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => decoded));
    const { sdk, backend } = textureBackend();
    backend.create_texture_from_bitmap = () => {
      throw new Error('texture memory budget exceeded');
    };
    await expect(sdk.loadTexture(fakeBitmap(2, 2))).rejects.toThrow('loadTexture: texture memory budget exceeded');
    expect(decoded.close).toHaveBeenCalledTimes(1);
  });
});

describe('texture maps on scene objects', () => {
  it('does not call set_object_map for untextured objects', () => {
    const { sdk, calls } = textureBackend();
    sdk.addBox();
    sdk.addCustomMesh(triangle);
    expect(calls.set_object_map).toBeUndefined();
    expect(calls.set_custom_mesh_uvs).toBeUndefined();
    expect(sdk.getObjects().map((o) => [o.map, o.alphaTest])).toEqual([[null, 0], [null, 0]]);
  });

  it('forwards map, repeat, offset and the default alpha test from addPrimitive', () => {
    const { sdk, calls } = textureBackend();
    const tex = sdk.createDataTexture(2, 2, checker(2));
    const id = sdk.addBox({ map: tex, mapRepeat: [3, 2], mapOffset: [0.25, 0.5] });
    expect(calls.set_object_map[0]).toEqual([id, tex, 3, 2, 0.25, 0.5, 0.5]);
    const explicit = sdk.addSphere({ map: tex, alphaTest: 0.1 });
    expect(calls.set_object_map[1]).toEqual([explicit, tex, 1, 1, 0, 0, 0.1]);
    expect(sdk.getObjectRecord(id)).toMatchObject({ map: tex, mapRepeat: [3, 2], mapOffset: [0.25, 0.5], alphaTest: 0.5 });
  });

  it('sends a map for the other shape helpers and custom meshes', () => {
    const { sdk, calls } = textureBackend();
    const tex = sdk.createDataTexture(2, 2, checker(2));
    sdk.addPlane({ map: tex });
    sdk.addCylinder({ map: tex });
    sdk.addCustomMesh({ ...triangle, map: tex });
    expect(calls.set_object_map.map((c) => c[1])).toEqual([tex, tex, tex]);
  });

  it('forwards custom mesh uvs as a Float32Array and mirrors them in the record', () => {
    const { sdk, calls } = textureBackend();
    const id = sdk.addCustomMesh({ ...triangle, uvs: [0, 0, 1, 0, 0, 1] });
    const [objectId, uvs] = calls.set_custom_mesh_uvs[0] as [number, Float32Array];
    expect(objectId).toBe(id);
    expect(uvs).toBeInstanceOf(Float32Array);
    expect(Array.from(uvs)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(sdk.getObjectRecord(id)?.customMesh?.uvs).toEqual([0, 0, 1, 0, 0, 1]);
  });

  it('rejects uvs that are not two per vertex before adding the mesh', () => {
    const { sdk, calls } = textureBackend();
    expect(() => sdk.addCustomMesh({ ...triangle, uvs: [0, 0, 1, 1] })).toThrow('addCustomMesh: uvs length must be 2 per vertex or empty');
    expect(calls.add_custom_mesh).toBeUndefined();
    sdk.addCustomMesh({ ...triangle, uvs: [] });
    expect(calls.set_custom_mesh_uvs).toBeUndefined();
  });

  it('setObjectMaterial sets, retargets and clears the map', () => {
    const { sdk, calls } = textureBackend();
    const a = sdk.createDataTexture(2, 2, checker(2));
    const b = sdk.createDataTexture(2, 2, checker(2));
    const id = sdk.addBox({ color: [1, 0, 0, 1] });
    expect(sdk.setObjectMaterial(id, { map: a })).toBe(true);
    expect(calls.set_object_map[0]).toEqual([id, a, 1, 1, 0, 0, 0.5]);
    sdk.setObjectMaterial(id, { map: b, mapRepeat: [4, 4] });
    expect(calls.set_object_map[1]).toEqual([id, b, 4, 4, 0, 0, 0.5]);
    sdk.setObjectMaterial(id, { alphaTest: 0.8 });
    expect(calls.set_object_map[2]).toEqual([id, b, 4, 4, 0, 0, 0.8]);
    sdk.setObjectMaterial(id, { map: null, alphaTest: 0 });
    expect(calls.set_object_map[3]).toEqual([id, 0, 4, 4, 0, 0, 0]);
    expect(sdk.getObjectRecord(id)).toMatchObject({ map: null, alphaTest: 0 });
    // Color-only updates leave the map alone
    sdk.setObjectMaterial(id, { color: [0, 1, 0, 1] });
    expect(calls.set_object_map).toHaveLength(4);
  });

  it('resets the default alpha test when a map is added or removed', () => {
    const { sdk } = textureBackend();
    const tex = sdk.createDataTexture(2, 2, checker(2));
    const id = sdk.addBox();
    sdk.setObjectMaterial(id, { map: tex });
    expect(sdk.getObjectRecord(id)?.alphaTest).toBe(0.5);
    sdk.setObjectMaterial(id, { map: null });
    expect(sdk.getObjectRecord(id)?.alphaTest).toBe(0);
  });

  it('keeps a customised alpha test when the map is added or removed', () => {
    const { sdk } = textureBackend();
    const tex = sdk.createDataTexture(2, 2, checker(2));
    const id = sdk.addBox({ alphaTest: 0.3 });
    sdk.setObjectMaterial(id, { map: tex });
    expect(sdk.getObjectRecord(id)?.alphaTest).toBe(0.3);
    sdk.setObjectMaterial(id, { map: null });
    expect(sdk.getObjectRecord(id)?.alphaTest).toBe(0.3);
  });

  it('treats map 0 as no texture', () => {
    const { sdk, calls } = textureBackend();
    const id = sdk.addBox({ map: 0 });
    expect(calls.set_object_map).toBeUndefined();
    expect(sdk.getObjectRecord(id)?.map).toBeNull();
  });
});

describe('Charturbo.createTorusMesh uvs', () => {
  it('returns two floats per vertex in [0, 1] with u = 1 - i / tubular and v = j / radial', () => {
    const radial = 6;
    const tubular = 8;
    const torus = Charturbo.createTorusMesh(8, 2.6, radial, tubular);
    const vertices = (radial + 1) * (tubular + 1);
    expect(torus.positions.length).toBe(vertices * 3);
    expect(torus.uvs).toBeInstanceOf(Float32Array);
    expect(torus.uvs.length).toBe(vertices * 2);
    for (const value of torus.uvs) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(Array.from(torus.uvs.slice(0, 4))).toEqual([1, 0, 1 - 1 / tubular, 0]);
    const last = vertices * 2 - 2;
    expect(Array.from(torus.uvs.slice(last))).toEqual([0, 1]);
  });

  it('spreads straight into addCustomMesh', () => {
    const { sdk, calls } = textureBackend();
    const torus = Charturbo.createTorusMesh(8, 2.6, 4, 6);
    sdk.addCustomMesh({ ...torus });
    expect((calls.set_custom_mesh_uvs[0][1] as Float32Array).length).toBe(torus.uvs.length);
  });
});

describe('disposal and lifetime', () => {
  it('disposeTexture frees the id and clears SDK references', () => {
    const { sdk, calls } = textureBackend();
    const tex = sdk.createDataTexture(2, 2, checker(2));
    const other = sdk.createDataTexture(2, 2, checker(2));
    const a = sdk.addBox({ map: tex });
    const b = sdk.addBox({ map: other });
    expect(sdk.disposeTexture(tex)).toBe(true);
    expect(calls.dispose_texture[0]).toEqual([tex]);
    expect(sdk.getTextures().map((t) => t.id)).toEqual([other]);
    expect(sdk.getObjectRecord(a)?.map).toBeNull();
    expect(sdk.getObjectRecord(a)?.alphaTest).toBe(0);
    // The engine is told the object is untextured again
    expect(calls.set_object_map.at(-1)).toEqual([a, 0, 1, 1, 0, 0, 0]);
    expect(sdk.getObjectRecord(b)?.map).toBe(other);
    expect(sdk.disposeTexture(tex)).toBe(false);
  });

  it('clearScene keeps textures; dispose drops the SDK records', () => {
    const { sdk } = textureBackend();
    const tex = sdk.createDataTexture(2, 2, checker(2));
    sdk.addBox({ map: tex });
    sdk.clearScene();
    expect(sdk.getTextures().map((t) => t.id)).toEqual([tex]);
    sdk.dispose();
    expect(sdk.getTextures()).toEqual([]);
  });
});

describe('scene export and load', () => {
  it('exports referenced textures and map fields, and round-trips through loadScene', () => {
    const { sdk, calls } = textureBackend();
    const used = sdk.createDataTexture(4, 4, checker(4));
    sdk.createDataTexture(2, 2, checker(2)); // unreferenced: not exported
    sdk.addBox({ name: 'crate', map: used, mapRepeat: [2, 2], mapOffset: [0.5, 0] });
    sdk.addCustomMesh({ ...triangle, uvs: [0, 0, 1, 0, 0, 1], map: used, alphaTest: 0.25 });
    sdk.addSphere();

    const scene = sdk.exportScene();
    expect(scene.textures).toEqual([{ id: used, src: null, width: 4, height: 4 }]);
    expect(scene.objects[0]).toMatchObject({ kind: 'primitive', map: used, mapRepeat: [2, 2], mapOffset: [0.5, 0], alphaTest: 0.5 });
    expect(scene.objects[1]).toMatchObject({ kind: 'custom', map: used, alphaTest: 0.25, uvs: [0, 0, 1, 0, 0, 1] });
    expect(scene.objects[2]).toMatchObject({ map: null, alphaTest: 0 });
    expect(JSON.parse(JSON.stringify(scene))).toEqual(scene);

    const before = calls.set_object_map.length;
    const ids = sdk.loadScene(scene);
    expect(ids).toHaveLength(3);
    expect(calls.set_object_map.slice(before)).toEqual([
      [ids[0], used, 2, 2, 0.5, 0, 0.5],
      [ids[1], used, 1, 1, 0, 0, 0.25],
    ]);
    expect(calls.set_custom_mesh_uvs.at(-1)).toEqual([ids[1], new Float32Array([0, 0, 1, 0, 0, 1])]);
  });

  it('omits textures when no object uses one', () => {
    const { sdk } = textureBackend();
    sdk.createDataTexture(2, 2, checker(2));
    sdk.addBox();
    expect(sdk.exportScene()).not.toHaveProperty('textures');
  });

  it('warns about unknown texture ids and drops the map', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, calls } = textureBackend();
    const [id] = sdk.loadScene({ objects: [{ kind: 'primitive', shape: 'box', map: 42 }] });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('unknown texture id 42');
    expect(calls.set_object_map).toBeUndefined();
    expect(sdk.getObjectRecord(id)).toMatchObject({ map: null, alphaTest: 0 });
  });

  it('keeps live ids without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = textureBackend();
    const tex = sdk.createDataTexture(2, 2, checker(2));
    const [id] = sdk.loadScene({ objects: [{ kind: 'primitive', shape: 'box', map: tex }] });
    expect(warn).not.toHaveBeenCalled();
    expect(sdk.getObjectRecord(id)?.map).toBe(tex);
  });

  it('loadSceneWithTextures reloads textures with a src and remaps ids', async () => {
    const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => ({ ok: true, blob: async () => new Blob(['x']) }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2, 2)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk, calls } = textureBackend();
    // A live data texture that shares its id with the descriptor's first texture
    const unrelated = sdk.createDataTexture(2, 2, checker(2));
    expect(unrelated).toBe(1);

    const ids = await sdk.loadSceneWithTextures({
      textures: [
        { id: 1, src: '/wood.png', width: 2, height: 2 },
        { id: 9, src: null, width: 2, height: 2 },
      ],
      objects: [
        { kind: 'primitive', shape: 'box', map: 1 },
        { kind: 'primitive', shape: 'box', map: 9 },
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const wood = sdk.getTextures().find((t) => t.src === '/wood.png');
    expect(wood?.id).toBe(2);
    expect(calls.set_object_map[0].slice(0, 2)).toEqual([ids[0], 2]);
    // id 9 has no src and is not live: dropped with a warning
    expect(sdk.getObjectRecord(ids[1])?.map).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    // Loading the same scene again reuses the live texture instead of fetching it twice
    await sdk.loadSceneWithTextures({
      textures: [{ id: 1, src: '/wood.png', width: 2, height: 2 }],
      objects: [{ kind: 'primitive', shape: 'box', map: 1 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sdk.getTextures()).toHaveLength(2);
  });

  it('loadSceneWithTextures keeps a live data texture of the same size and drops others', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = textureBackend();
    const data = sdk.createDataTexture(2, 2, checker(2));
    const ids = await sdk.loadSceneWithTextures({
      textures: [
        { id: data, src: null, width: 2, height: 2 },
        { id: data + 1, src: null, width: 2, height: 2 },
      ],
      objects: [
        { kind: 'primitive', shape: 'box', map: data },
        { kind: 'primitive', shape: 'box', map: data + 1 },
      ],
    });
    expect(sdk.getObjectRecord(ids[0])?.map).toBe(data);
    expect(sdk.getObjectRecord(ids[1])?.map).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    // A live texture with a different size is not the same texture
    const [id] = await sdk.loadSceneWithTextures({
      textures: [{ id: data, src: null, width: 8, height: 8 }],
      objects: [{ kind: 'primitive', shape: 'box', map: data }],
    });
    expect(sdk.getObjectRecord(id)?.map).toBeNull();
  });

  it('loadSceneWithTextures drops maps of textures that fail to load', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { sdk } = textureBackend();
    const live = sdk.createDataTexture(2, 2, checker(2));
    const [id] = await sdk.loadSceneWithTextures({
      textures: [{ id: live, src: '/gone.png', width: 2, height: 2 }],
      objects: [{ kind: 'primitive', shape: 'box', map: live }],
    });
    expect(sdk.getObjectRecord(id)?.map).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('could not load texture');
  });
});
