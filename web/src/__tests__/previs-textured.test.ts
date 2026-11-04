import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createPrevisPlayer, loadPrevisPlayer, type PrevisPlayer, type PrevisPlayerLook } from '../previs/player';
import type { PrevisDoc, PrevisNode } from '../previs/types';
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';

// Textured (lit) look of the previs player, and the flat look staying exactly as it was (see player.ts LOOKS).

const dir = fileURLToPath(new URL('../../previs/examples/', import.meta.url));
const bytes = (name: string): ArrayBuffer => {
  const b = readFileSync(`${dir}models/${name}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
/** `.gltf` files get their external buffers / images inlined as data URIs (the test env has no file fetch). */
const resolveModel = (src: string): ArrayBuffer => {
  const name = src.replace(/^models\//, '');
  if (!/\.gltf$/i.test(name)) return bytes(name);
  const json = JSON.parse(readFileSync(`${dir}models/${name}`, 'utf8')) as {
    buffers?: { uri?: string }[];
    images?: { uri?: string; mimeType?: string }[];
  };
  const base = name.replace(/[^/]*$/, '');
  const inline = (o: { uri?: string; mimeType?: string }, mime: string) => {
    if (o.uri && !o.uri.startsWith('data:')) {
      o.uri = `data:${o.mimeType ?? mime};base64,${readFileSync(`${dir}models/${base}${o.uri}`).toString('base64')}`;
    }
  };
  for (const b of json.buffers ?? []) inline(b, 'application/octet-stream');
  for (const i of json.images ?? []) inline(i, 'image/png');
  const out = Buffer.from(JSON.stringify(json));
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
};

/** JSON with typed arrays as arrays, buffers / signals / functions / cycles as tags. */
const ser = (v: unknown): string => {
  const seen = new WeakSet();
  return JSON.stringify(v, (_k, x) => {
    if (typeof x === 'function') return 'fn';
    if (x instanceof ArrayBuffer) return `buf:${x.byteLength}`;
    if (ArrayBuffer.isView(x)) return Array.from(x as unknown as ArrayLike<number>);
    if (x instanceof AbortSignal) return 'signal';
    if (x && typeof x === 'object') {
      if (seen.has(x)) return 'cycle';
      seen.add(x);
    }
    return x;
  });
};

/**
 * A real `Charturbo` over a no-op engine backend; records every engine call (`engine`) and every SDK method
 * call made from outside the SDK (`api`: name and arguments; calls the SDK makes on itself are not listed).
 */
function recordingSdk() {
  let next = 1;
  const engine: string[] = [];
  const impl: Record<string, (...a: unknown[]) => unknown> = {
    add_primitive: () => next++,
    add_custom_mesh: () => next++,
    object_count: () => 0,
    camera_state: () => new Float32Array([0, 0, 0, 5, 0, 0, 0.7, 1]),
    get_object_transform: () => new Float32Array(0),
    get_object_skinned_vertices: () => new Float32Array(0),
  };
  const backend = new Proxy(impl, {
    get: (t, k: string) => (...args: unknown[]) => {
      engine.push(`${k} ${ser(args)}`);
      return t[k] ? t[k](...args) : true;
    },
  }) as unknown as WasmCharturboEngineBackend;
  const real = Charturbo.fromBackend(backend);
  const api: string[] = [];
  const calls: { name: string; args: unknown[] }[] = [];
  let depth = 0;
  const sdk = new Proxy(real, {
    get: (t, k, r) => {
      const v = Reflect.get(t, k, r);
      if (typeof v !== 'function') return v;
      return (...args: unknown[]) => {
        if (depth === 0) {
          api.push(`${String(k)} ${ser(args)}`);
          calls.push({ name: String(k), args });
        }
        depth++;
        try {
          return v.apply(t, args);
        } finally {
          depth--;
        }
      };
    },
  }) as Charturbo;
  const named = (name: string) => calls.filter((c) => c.name === name).map((c) => c.args);
  return { sdk, real, engine, api, calls, named };
}

const exampleDocs = readdirSync(dir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ file: f, doc: JSON.parse(readFileSync(dir + f, 'utf8')) as PrevisDoc }));

const endOf = (doc: PrevisDoc) => Math.max(...doc.shots.map((s) => s.end));
/** Every frame, then a few backward seeks. */
const timesOf = (doc: PrevisDoc, step = 1): number[] => {
  const end = endOf(doc);
  const out: number[] = [];
  for (let i = 0; i <= Math.round(end * doc.fps); i += step) out.push(i / doc.fps);
  return [...out, 0, end / 2, end / 3, end];
};

/** Plays `doc` in `look` on a fresh recording SDK and disposes it; returns the logs (frame states included). */
async function playLog(doc: PrevisDoc, look: PrevisPlayerLook | undefined, step = 1) {
  const m = recordingSdk();
  const player: PrevisPlayer = await loadPrevisPlayer(m.sdk, doc, { resolveModel, ...(look ? { look } : {}) });
  for (const t of timesOf(doc, step)) m.api.push(`== frame ${t} ${ser(player.frame(t))}`);
  player.dispose();
  return m;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const box = (id: string, extra: Partial<PrevisNode> = {}): PrevisNode => ({
  id,
  shape: 'box',
  color: [1, 0.5, 0.25],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  ...extra,
});

const model = (id: string, src: string, extra: Partial<PrevisNode> = {}): PrevisNode => ({
  id,
  shape: 'model',
  model: { src: `models/${src}` },
  color: [0.9, 0.35, 0.15],
  position: [0, 0.5, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  ...extra,
});

const makeDoc = (nodes: PrevisNode[], extra: Partial<PrevisDoc> = {}): PrevisDoc => ({
  version: 1,
  fps: 24,
  size: { width: 64, height: 64 },
  background: [0.2, 0.3, 0.4],
  roles: [],
  nodes,
  shots: [{ id: 's', start: 0, end: 2, camera: { position: [{ t: 0, v: [0, 1, 6] }], target: { track: [{ t: 0, v: [0, 0.5, 0] }] }, fov: [{ t: 0, v: 40 }] } }],
  ...extra,
});

const LIGHT_APIS = ['getShading', 'getLighting', 'getShadows', 'addPointLight', 'setPointLight', 'removePointLight', 'getObjectRecord', 'loadTexture'];

describe('flat look is unchanged', () => {
  for (const { file, doc } of exampleDocs) {
    it(`${file}: lighting, look.color/roughness/metallic/show 'both'|'flat' and show 'textured' nodes change no call`, async () => {
      const plain = await playLog(doc, undefined);
      const flat = await playLog(doc, 'flat');
      expect(flat.api).toEqual(plain.api);
      expect(flat.engine).toEqual(plain.engine);

      // Same doc with every textured-only input added: lighting, per-node looks and textured-only nodes
      const decorated = clone(doc);
      decorated.lighting = { key: { dir: [1, 2, 3], intensity: 3, shadows: true }, env: { intensity: 4 }, rim: [{ position: [1, 2, 3], intensity: 5 }], exposure: 2, toneMapping: 'reinhard' };
      decorated.nodes.forEach((n, i) => {
        if (n.look?.show === 'textured') return; // the doc's own textured-only nodes stay textured-only
        if (n.shape !== 'model') n.look = { color: [0.1, 0.9, 0.3], roughness: 0.3, metallic: 0.7, show: i % 2 ? 'flat' : 'both' };
        else n.look = { show: i % 2 ? 'flat' : 'both' };
      });
      // Textured-only nodes first, in the middle and last (a textured-only model must not even be loaded)
      const extraA = box('tx-a', { look: { show: 'textured' }, tracks: { visible: [{ t: 0, v: true }, { t: 1, v: false }] } });
      const extraB = model('tx-b', 'mug.glb', { look: { show: 'textured' } });
      const extraC = box('tx-c', { look: { show: 'textured' }, parent: 'tx-a' });
      decorated.nodes.splice(Math.floor(decorated.nodes.length / 2), 0, extraB);
      decorated.nodes = [extraA, ...decorated.nodes, extraC];
      const flatDecorated = await playLog(decorated, 'flat');
      // The frame states differ only by the dropped nodes: compare the engine log and the SDK calls
      const calls = (a: string[]) => a.filter((s) => !s.startsWith('== frame'));
      expect(calls(flatDecorated.api)).toEqual(calls(plain.api));
      expect(flatDecorated.engine).toEqual(plain.engine);
      for (const s of flatDecorated.api) expect(s).not.toMatch(/"previs:tx-[abc]/);
    }, 60_000);
  }

  it('never touches lighting, shadow, point light or texture APIs; models load without textures', async () => {
    for (const { doc } of exampleDocs) {
      const m = await playLog(doc, 'flat', 6);
      for (const name of LIGHT_APIS) expect(m.named(name)).toEqual([]);
      for (const [o] of m.named('setShadows')) expect(o).toEqual({ enabled: false });
      for (const [, o] of m.named('loadGltf')) expect((o as { textures: boolean }).textures).toBe(false);
    }
  });

  it('createPrevisPlayer: same calls with and without look flat, textured-only nodes omitted', () => {
    const doc = makeDoc([box('a'), box('b', { look: { show: 'textured' } }), box('c', { look: { show: 'flat', color: [0, 1, 0] } })]);
    const run = (opts?: { look: PrevisPlayerLook }) => {
      const m = recordingSdk();
      const p = createPrevisPlayer(m.sdk, doc, opts);
      const fs = p.frame(0.5);
      p.dispose();
      return { m, fs };
    };
    const a = run();
    const b = run({ look: 'flat' });
    expect(b.m.api).toEqual(a.m.api);
    expect(Object.keys(a.fs.nodes)).toEqual(['a', 'c']);
    const names = a.m.named('addPrimitive').map(([d]) => (d as { name: string }).name);
    expect(names).toEqual(['previs:a', 'previs:a:mesh', 'previs:c', 'previs:c:mesh']);
    // look.color is ignored by the flat look
    const c = a.m.named('addPrimitive').find(([d]) => (d as { name: string }).name === 'previs:c:mesh')![0] as { color: number[] };
    expect(c.color).toEqual([1, 0.5, 0.25, 1]);
  });

  it('rejects an unknown look', async () => {
    const m = recordingSdk();
    expect(() => createPrevisPlayer(m.sdk, makeDoc([box('a')]), { look: 'lit' as PrevisPlayerLook })).toThrow("look must be 'flat' or 'textured'");
    await expect(loadPrevisPlayer(m.sdk, makeDoc([box('a')]), { look: 'lit' as PrevisPlayerLook })).rejects.toThrow("look must be 'flat' or 'textured'");
    expect(m.engine).toEqual([]);
  });
});

describe('textured look', () => {
  const lit = (extra: Partial<PrevisDoc> = {}) =>
    makeDoc(
      [
        box('plain'),
        box('styled', { look: { color: [0.1, 0.2, 0.3], roughness: 0.25, metallic: 0.6 } }),
        box('flatOnly', { look: { show: 'flat' } }),
        box('texOnly', { look: { show: 'textured' }, parent: 'plain' }),
        model('walker', 'walker.glb', {
          model: { src: 'models/walker.glb', animation: { clip: 'walk' } },
          size: [0.7, 1.75, 0.5],
          visible: false,
          tracks: { visible: [{ t: 0, v: false }, { t: 1, v: true }] },
        }),
        box('prop', { parent: 'walker', parentJoint: 'lowerArm.R', size: [0.05, 0.5, 0.05] }),
        model('mug', 'mug.glb'),
      ],
      { worldScale: 10, ...extra },
    );

  it('sets up PBR shading, key light, shadows and environment from the defaults', async () => {
    const m = recordingSdk();
    const p = await loadPrevisPlayer(m.sdk, lit(), { resolveModel, look: 'textured' });
    expect(m.named('setShadows')).toEqual([
      [{ enabled: true, mapSize: 2048, bias: 0.5, normalBias: 1, softness: 1.5, darkness: 1, bounds: 'auto', point: { enabled: false } }],
    ]);
    expect(m.named('setShading')).toEqual([
      [{ model: 'pbr', toneMapping: 'aces', exposure: 1, environment: { sky: [0.6, 0.66, 0.76], ground: [0.24, 0.22, 0.2], intensity: 1, map: null, rotation: 0 } }],
    ]);
    const [[l]] = m.named('setLighting') as [[{ directionalDirection: number[] }]];
    const len = Math.hypot(0.45, 0.85, 0.55);
    expect(l).toEqual({ ambientIntensity: 0, directionalDirection: [0.45 / len, 0.85 / len, 0.55 / len], directionalIntensity: 1, pointIntensity: 0 });
    expect(m.named('addPointLight')).toEqual([]);
    expect(m.named('setTheme')[0][0]).toMatchObject({ surface: [0.2, 0.3, 0.4, 1] });
    p.dispose();
  });

  it('maps doc.lighting: tone mapping, exposure, env, key, no shadows, rim lights in engine units', async () => {
    const m = recordingSdk();
    const p = await loadPrevisPlayer(
      m.sdk,
      lit({
        lighting: {
          key: { dir: [0, 2, 0], intensity: 2.5, shadows: false },
          env: { sky: [0.1, 0.2, 0.3], ground: [0.3, 0.2, 0.1], intensity: 0.5 },
          rim: [
            { position: [1, 2, -3], color: [1, 0.5, 0], intensity: 4, range: 6 },
            { position: [0, 3, 0], intensity: 0.5 },
          ],
          exposure: 1.5,
          toneMapping: 'reinhard',
        },
      }),
      { resolveModel, look: 'textured' },
    );
    expect(m.named('setShadows')[0][0]).toMatchObject({ enabled: false, mapSize: 2048 });
    expect(m.named('setShading')[0][0]).toEqual({
      model: 'pbr',
      toneMapping: 'reinhard',
      exposure: 1.5,
      environment: { sky: [0.1, 0.2, 0.3], ground: [0.3, 0.2, 0.1], intensity: 0.5, map: null, rotation: 0 },
    });
    expect(m.named('setLighting')[0][0]).toEqual({ ambientIntensity: 0, directionalDirection: [0, 1, 0], directionalIntensity: 2.5, pointIntensity: 0 });
    // worldScale 10: position and range x 10, intensity x 100 (inverse-square in engine units)
    expect(m.named('addPointLight')).toEqual([
      [{ position: [10, 20, -30], color: [1, 0.5, 0], intensity: 400, range: 60 }],
      [{ position: [0, 30, 0], color: [1, 1, 1], intensity: 50, range: 1e6 }],
    ]);
    expect(m.real.getPointLights().map((l) => l.intensity)).toEqual([400, 50]);
    p.dispose();
    expect(m.real.getPointLights()).toEqual([]);
  });

  it('primitives: look color / roughness / metallic, emissive 0, cast and receive; helpers do not cast', async () => {
    const m = recordingSdk();
    const p = await loadPrevisPlayer(m.sdk, lit(), { resolveModel, look: 'textured' });
    const prims = new Map(m.named('addPrimitive').map(([d]) => [(d as { name: string }).name, d as Record<string, unknown>]));
    expect(prims.get('previs:plain:mesh')).toMatchObject({ color: [1, 0.5, 0.25, 1], roughness: 0.8, metallic: 0, emissive: 0, castShadow: true, receiveShadow: true });
    expect(prims.get('previs:styled:mesh')).toMatchObject({ color: [0.1, 0.2, 0.3, 1], roughness: 0.25, metallic: 0.6, emissive: 0, castShadow: true, receiveShadow: true });
    for (const [name, d] of prims) {
      if (name.endsWith(':mesh')) continue;
      // pivots, FITs, sockets
      expect(d).toMatchObject({ color: [0, 0, 0, 0], castShadow: false, receiveShadow: false });
    }
    expect([...prims.keys()]).toContain('previs:walker:joint:lowerArm.R');
    expect([...prims.keys()]).toContain('previs:walker:fit');
    p.dispose();
  });

  it('show: textured draws both + textured nodes, flat draws both + flat nodes', async () => {
    const names = async (look: PrevisPlayerLook) => {
      const m = recordingSdk();
      const p = await loadPrevisPlayer(m.sdk, lit(), { resolveModel, look });
      const fs = p.frame(0.5);
      p.dispose();
      return { prims: m.named('addPrimitive').map(([d]) => (d as { name: string }).name), nodes: Object.keys(fs.nodes) };
    };
    const t = await names('textured');
    expect(t.nodes).toEqual(['plain', 'styled', 'texOnly', 'walker', 'prop', 'mug']);
    expect(t.prims).toContain('previs:texOnly:mesh');
    expect(t.prims.some((n) => n.startsWith('previs:flatOnly'))).toBe(false);
    const f = await names('flat');
    expect(f.nodes).toEqual(['plain', 'styled', 'flatOnly', 'walker', 'prop', 'mug']);
    expect(f.prims).toContain('previs:flatOnly:mesh');
    expect(f.prims.some((n) => n.startsWith('previs:texOnly'))).toBe(false);
  });

  it('models: textures loaded, loader materials kept, visibility toggles the loader color alpha only', async () => {
    const m = recordingSdk();
    const p = await loadPrevisPlayer(m.sdk, lit(), { resolveModel, look: 'textured' });
    const loads = m.named('loadGltf');
    expect(loads).toHaveLength(2);
    for (const [, o] of loads) expect((o as { textures: boolean }).textures).toBe(true);
    // No FLAT_GLTF_MATERIAL: no setObjectMaterial except the alpha of the hidden walker
    const mats = m.named('setObjectMaterial') as [number, Record<string, unknown>][];
    for (const [, mat] of mats) expect(Object.keys(mat)).toEqual(['color']);
    const walkerObjs = mats.map(([id]) => id);
    expect(walkerObjs.length).toBeGreaterThan(0);
    const loaderColor = new Map(walkerObjs.map((id) => [id, m.real.getObjectRecord(id)!.color]));
    for (const [id, mat] of mats) {
      const c = mat.color as number[];
      expect(c[3]).toBe(0);
      expect(c.slice(0, 3)).toEqual(loaderColor.get(id)!.slice(0, 3));
    }
    // Mug objects: still the loader's material (color not the node color), metallic / roughness / emissive untouched
    m.calls.length = 0;
    p.frame(0.5);
    expect(m.named('setObjectMaterial')).toEqual([]);
    p.frame(1);
    const shown = m.named('setObjectMaterial') as [number, { color: number[] }][];
    expect(shown.map(([id]) => id)).toEqual(walkerObjs);
    // Shown: the loader color, not the node color [0.9, 0.35, 0.15]
    for (const [id, { color }] of shown) {
      expect(color.slice(0, 3)).toEqual(loaderColor.get(id)!.slice(0, 3));
      expect(color[3]).toBe(1);
      expect(m.real.getObjectRecord(id)!.color).toEqual(color);
    }
    for (const id of walkerObjs) expect(m.real.getObjectRecord(id)!.color.slice(0, 3)).not.toEqual([0.9, 0.35, 0.15]);
    p.dispose();
  });

  it('models keep their loader material (vs the flat look, which applies the flat recipe)', async () => {
    const doc = makeDoc([model('mug', 'mug.glb')]);
    const flat = recordingSdk();
    (await loadPrevisPlayer(flat.sdk, doc, { resolveModel })).dispose();
    const flatMats = flat.named('setObjectMaterial') as [number, Record<string, unknown>][];
    expect(flatMats.length).toBeGreaterThan(0);
    for (const [, mat] of flatMats) expect(mat).toMatchObject({ emissive: 1, map: null, normalMap: null, color: [0.9, 0.35, 0.15, 1] });
    const tex = recordingSdk();
    const p = await loadPrevisPlayer(tex.sdk, doc, { resolveModel, look: 'textured' });
    expect(tex.named('setObjectMaterial')).toEqual([]);
    const ids = (tex.named('setObjectParent') as [number, number][]).map(([id]) => id);
    for (const id of ids) {
      const r = tex.real.getObjectRecord(id)!;
      expect(r.castShadow).toBe(true);
      expect(r.receiveShadow).toBe(true);
    }
    p.dispose();
  });

  it('createPrevisPlayer accepts look textured (docs without drawn models)', () => {
    const m = recordingSdk();
    const doc = makeDoc([box('a', { look: { color: [0, 0, 1] } }), model('m', 'mug.glb', { look: { show: 'flat' } })]);
    expect(() => createPrevisPlayer(recordingSdk().sdk, doc)).toThrow('use loadPrevisPlayer');
    const p = createPrevisPlayer(m.sdk, doc, { look: 'textured' });
    expect(m.named('setShading')[0][0]).toMatchObject({ model: 'pbr', toneMapping: 'aces' });
    expect(m.named('addPrimitive').map(([d]) => (d as { name: string }).name)).toEqual(['previs:a', 'previs:a:mesh']);
    p.frame(0);
    p.dispose();
  });

  it('dispose restores shading, lighting, shadows, point lights and theme to the values before the player', async () => {
    const m = recordingSdk();
    const sdk = m.real;
    // A non-default prior state, including a point light the player must keep
    sdk.setShading({ model: 'classic', toneMapping: 'none', exposure: 2, environment: { sky: [1, 0, 0], intensity: 3, rotation: 1 } });
    sdk.setLighting({ ambientIntensity: 0.3, directionalDirection: [1, 0, 0], directionalIntensity: 0.7, pointPosition: [1, 2, 3], pointIntensity: 0.4 });
    sdk.setShadows({ enabled: false, mapSize: 1024, bias: 2, softness: 3, bounds: { center: [1, 2, 3], radius: 4 }, point: { enabled: true, mapSize: 256 } });
    const keep = sdk.addPointLight({ position: [5, 5, 5], intensity: 7 });
    const before = { shading: sdk.getShading(), lighting: sdk.getLighting(), shadows: sdk.getShadows(), lights: sdk.getPointLights(), theme: sdk.getTheme(), objects: sdk.getObjects().length };
    const doc = lit({ lighting: { rim: [{ position: [0, 1, 0], intensity: 1 }, { position: [0, 2, 0], intensity: 2 }] } });
    const p = await loadPrevisPlayer(m.sdk, doc, { resolveModel, look: 'textured' });
    expect(sdk.getShading().model).toBe('pbr');
    expect(sdk.getShadows().enabled).toBe(true);
    expect(sdk.getPointLights()).toHaveLength(3);
    for (const t of timesOf(doc, 4)) p.frame(t);
    p.dispose();
    const after = { shading: sdk.getShading(), lighting: sdk.getLighting(), shadows: sdk.getShadows(), lights: sdk.getPointLights(), theme: sdk.getTheme(), objects: sdk.getObjects().length };
    expect(after).toEqual(before);
    expect(after.lights.map((l) => l.id)).toEqual([keep]);
    p.dispose(); // idempotent
    expect(sdk.getPointLights()).toHaveLength(1);
  });

  it('a flat player after a disposed textured player makes the same engine calls as on a fresh scene', async () => {
    const doc = exampleDocs.find((d) => d.file === 'model-demo.json')!.doc;
    // Engine object ids differ (the backend counts on), so compare with ids normalized
    const norm = (log: string[]) => log.map((s) => s.replace(/\d+/g, '#'));
    const fresh = recordingSdk();
    const p0 = await loadPrevisPlayer(fresh.sdk, doc, { resolveModel });
    for (const t of timesOf(doc, 8)) p0.frame(t);
    const freshLog = norm(fresh.engine);
    const used = recordingSdk();
    const pt = await loadPrevisPlayer(used.sdk, { ...doc, lighting: { rim: [{ position: [0, 2, 0], intensity: 3 }] } }, { resolveModel, look: 'textured' });
    for (const t of timesOf(doc, 8)) pt.frame(t);
    pt.dispose();
    const start = used.engine.length;
    const p1 = await loadPrevisPlayer(used.sdk, doc, { resolveModel });
    for (const t of timesOf(doc, 8)) p1.frame(t);
    expect(norm(used.engine.slice(start))).toEqual(freshLog);
    // And the SDK state the flat player leaves is the same
    expect(used.real.getShading()).toEqual(fresh.real.getShading());
    expect(used.real.getLighting()).toEqual(fresh.real.getLighting());
    expect(used.real.getShadows()).toEqual(fresh.real.getShadows());
    expect(used.real.getPointLights()).toEqual([]);
  });

  it('a failed textured load restores everything (rim intensity beyond the engine range)', async () => {
    const m = recordingSdk();
    const sdk = m.real;
    const before = { shading: sdk.getShading(), lighting: sdk.getLighting(), shadows: sdk.getShadows(), lights: sdk.getPointLights(), theme: sdk.getTheme() };
    const doc = lit({ lighting: { rim: [{ position: [0, 1, 0], intensity: 1 }, { position: [0, 1, 0], intensity: 20000 }] } });
    await expect(loadPrevisPlayer(m.sdk, doc, { resolveModel, look: 'textured' })).rejects.toThrow('loadPrevisPlayer: lighting.rim[1].intensity 20000');
    expect({ shading: sdk.getShading(), lighting: sdk.getLighting(), shadows: sdk.getShadows(), lights: sdk.getPointLights(), theme: sdk.getTheme() }).toEqual(before);
    expect(m.named('addPrimitive')).toEqual([]);
    // Also a failed model load
    const m2 = recordingSdk();
    const before2 = { shading: m2.real.getShading(), lights: m2.real.getPointLights(), shadows: m2.real.getShadows() };
    await expect(
      loadPrevisPlayer(m2.sdk, lit({ lighting: { rim: [{ position: [0, 1, 0], intensity: 1 }] } }), {
        look: 'textured',
        resolveModel: (src) => (src.includes('mug') ? Promise.reject(new Error('nope')) : resolveModel(src)),
      }),
    ).rejects.toThrow('nope');
    expect({ shading: m2.real.getShading(), lights: m2.real.getPointLights(), shadows: m2.real.getShadows() }).toEqual(before2);
    expect(m2.real.getObjects()).toEqual([]);
  });

  for (const kind of ['createPrevisPlayer', 'loadPrevisPlayer'] as const) {
    it(`${kind}: a throw while creating the nodes removes the created objects and restores the textured state`, async () => {
      const m = recordingSdk();
      const sdk = m.real;
      const before = { shading: sdk.getShading(), lighting: sdk.getLighting(), shadows: sdk.getShadows(), lights: sdk.getPointLights(), theme: sdk.getTheme() };
      const doc = makeDoc([box('a'), box('b'), box('c')], { lighting: { rim: [{ position: [0, 1, 0], intensity: 1 }] } });
      const real = sdk.addPrimitive.bind(sdk);
      let n = 0;
      vi.spyOn(sdk, 'addPrimitive').mockImplementation((...a: Parameters<Charturbo['addPrimitive']>) => {
        if (++n === 3) throw new Error('boom');
        return real(...a);
      });
      const run = () => (kind === 'createPrevisPlayer' ? Promise.resolve().then(() => createPrevisPlayer(m.sdk, doc, { look: 'textured' })) : loadPrevisPlayer(m.sdk, doc, { look: 'textured' }));
      await expect(run()).rejects.toThrow('boom');
      expect(n).toBe(3);
      expect(sdk.getObjects()).toEqual([]);
      expect({ shading: sdk.getShading(), lighting: sdk.getLighting(), shadows: sdk.getShadows(), lights: sdk.getPointLights(), theme: sdk.getTheme() }).toEqual(before);
    });
  }
});
