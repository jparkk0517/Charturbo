import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMotion, createMannequin, crouch, lookAt, pickUp } from '../previs/mannequin';
import { retargetParts } from '../previs/models';
import { loadPrevisPlayer } from '../previs/player';
import type { PrevisDoc, PrevisNode } from '../previs/types';
import { validateDoc } from '../previs/validate';
import { drawnScene, mul4 } from './drawn-scene';

// Hair as extra retargeted parts (`retargetParts`): a Quaternius "Rigged to Head Bone" hairstyle on the body's skeleton,
// retargeted from the same source as the body, must be drawn rigidly on the body's posed Head bone. Independent reference:
// the BODY's drawn Head joint (its eyebrow mesh is skinned to Head only: object world x that palette entry) applied to the
// hair's bind-space vertices (the hair's Head rest world equals the body's, so both share the Head inverse bind matrix).

const EX = '../../previs/examples/';
type V3 = [number, number, number];

/** A .gltf (path relative to this file) with its .bin inlined and every texture reference dropped (no fetches in node). */
function gltfBytes(rel: string): ArrayBuffer {
  const url = new URL(rel, import.meta.url);
  const j = JSON.parse(readFileSync(fileURLToPath(url), 'utf8'));
  const bin = readFileSync(fileURLToPath(new URL(j.buffers[0].uri, url)));
  j.buffers[0].uri = `data:application/octet-stream;base64,${bin.toString('base64')}`;
  delete j.images;
  delete j.textures;
  delete j.samplers;
  for (const m of j.materials ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    if (m.pbrMetallicRoughness) {
      delete m.pbrMetallicRoughness.baseColorTexture;
      delete m.pbrMetallicRoughness.metallicRoughnessTexture;
    }
  }
  const b = new TextEncoder().encode(JSON.stringify(j));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function fileBuffer(rel: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** resolveModel for docs in `dir` (relative to this file): .gltf textures stripped, .glb as is. */
const resolverFor = (dir: string) => (src: string) => (src.endsWith('.glb') ? fileBuffer(dir + src) : gltfBytes(dir + src));

const loadDoc = (rel: string): PrevisDoc => JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));

/** Skinned mesh objects under the FIT of previs node `id`. */
function skinnedUnder(scene: ReturnType<typeof drawnScene>, id: string): number[] {
  const fit = scene.idOf(`previs:${id}:fit`);
  return scene.meshesUnder(fit).filter((m) => scene.objects.get(m)!.skin);
}

/** World matrix of the body's drawn Head joint: an object of the body skinned to one joint only (the eyebrows / eyes). */
function headMatrix(scene: ReturnType<typeof drawnScene>, body: string): number[] {
  for (const id of skinnedUnder(scene, body)) {
    const o = scene.objects.get(id)!;
    const { joints, weights } = o.skin!;
    const j = joints[0];
    let single = true;
    for (let v = 0; v < weights.length / 4 && single; v++) single = weights[v * 4] > 0.999 && joints[v * 4] === j;
    if (single && o.palette) return mul4(scene.worldMatrix(id), Array.from(o.palette.slice(j * 16, j * 16 + 16)));
  }
  throw new Error(`no single-joint skinned object under ${body}`);
}

/** Max distance (engine units) between the part's drawn vertices and its bind vertices carried by the body's Head. */
function partError(scene: ReturnType<typeof drawnScene>, body: string, part: string): { err: number; count: number } {
  const H = headMatrix(scene, body);
  let err = 0;
  let count = 0;
  for (const id of skinnedUnder(scene, part)) {
    const o = scene.objects.get(id)!;
    const got = scene.worldVertices(id);
    const used = [...new Set(o.indices!)];
    used.forEach((v, i) => {
      const p = o.positions!;
      const [x, y, z] = [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]];
      const want = [0, 1, 2].map((r) => H[r] * x + H[4 + r] * y + H[8 + r] * z + H[12 + r]) as V3;
      err = Math.max(err, Math.hypot(got[i][0] - want[0], got[i][1] - want[1], got[i][2] - want[2]));
      count++;
    });
  }
  return { err, count };
}

/** Camera without follow (subset docs may drop the followed node). */
function plainShots(doc: PrevisDoc): PrevisDoc['shots'] {
  const end = Math.max(...doc.shots.map((s) => s.end));
  return [{ id: 's', start: 0, end, camera: { position: [{ t: 0, v: [0, 2, 6] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }];
}

const GREY: [number, number, number] = [0.5, 0.5, 0.5];

/** Jointed mannequin (pickUp with lean, crouch, head turn, root move) + body (attach) + beard part, both textured. */
function mannequinDoc(): PrevisDoc {
  const m = createMannequin({ id: 'hero', color: GREY, height: 1.78, position: [0.5, 0, -1], limbs: 'jointed' });
  m.nodes.find((n) => n.id === m.joints.root)!.rotation = [0, 0.7, 0];
  const pick = pickUp({ mannequin: m, side: 'right', target: [0.2, 0.08, -0.5], start: 0.25, grab: 1, end: 1.75, depth: 0.6, lean: 0.7, fps: 24 });
  const nodes = applyMotion(m.nodes, [
    pick.motion,
    crouch({ mannequin: m, start: 2, end: 2.5, depth: 0.35, fps: 24 }),
    lookAt({ joints: m.joints, start: 2, end: 2.5, yaw: -0.5 }),
    { [m.joints.root]: { position: [{ t: 1.75, v: [0.5, 0, -1] }, { t: 2.5, v: [0.9, 0, -0.4] }] } },
  ]);
  for (const n of nodes) n.look = { show: 'flat' };
  const skin: PrevisNode = {
    id: 'skin',
    shape: 'model',
    look: { show: 'textured' },
    color: [0.8, 0.3, 0.2],
    model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'hero', map: 'ue', attach: true } },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [1, 1.8, 0.4],
  };
  const parts = retargetParts(skin, [
    { id: 'beard', src: 'models/quaternius/hair/Hair_Beard.gltf' },
    { id: 'hair', src: 'models/quaternius/hair/Hair_Buzzed.gltf' },
  ]);
  return {
    version: 1,
    fps: 24,
    size: { width: 64, height: 64 },
    background: [0, 0, 0],
    roles: [],
    nodes: [...nodes, skin, ...parts],
    shots: [{ id: 's', start: 0, end: 2.5, camera: { position: [{ t: 0, v: [0, 1.5, 4] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
  };
}

describe('retargetParts', () => {
  it('copies source / map / sourceMap (never attach), role, color, look, size, visible and its track; throws without retarget', () => {
    const skin: PrevisNode = {
      id: 'giant_tex',
      shape: 'model',
      role: 'giant',
      color: [0, 1, 1],
      look: { show: 'textured' },
      model: { src: 'a.gltf', retarget: { source: 'giant', map: 'ue', sourceMap: 'walker' } },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [1.6, 3.2, 1],
      visible: false,
      tracks: { visible: [{ t: 0, v: false }, { t: 1.5, v: true }] },
    };
    const [p] = retargetParts(skin, [{ id: 'giant_beard', src: 'hair/Hair_Beard.gltf' }]);
    expect(p).toEqual({
      id: 'giant_beard',
      shape: 'model',
      role: 'giant',
      color: [0, 1, 1],
      look: { show: 'textured' },
      model: { src: 'hair/Hair_Beard.gltf', retarget: { source: 'giant', map: 'ue', sourceMap: 'walker' } },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [1.6, 3.2, 1],
      visible: false,
      tracks: { visible: [{ t: 0, v: false }, { t: 1.5, v: true }] },
    });
    // deep copies
    expect(p.tracks!.visible).not.toBe(skin.tracks!.visible);
    expect(p.look).not.toBe(skin.look);
    const attached = { ...skin, model: { src: 'a.gltf', retarget: { source: 'hero', map: 'ue' as const, attach: true } } };
    expect(retargetParts(attached, [{ id: 'h', src: 'h.gltf' }])[0].model!.retarget).toEqual({ source: 'hero', map: 'ue' });
    expect(() => retargetParts({ ...skin, model: { src: 'a.gltf' } }, [{ id: 'h', src: 'h.gltf' }])).toThrow(/has no model.retarget/);
    expect(() => retargetParts(skin, [{ id: 'giant_tex', src: 'h.gltf' }])).toThrow(/equals the skin id/);
  });

  it('validate: several models retargeted from one mannequin; attach on two of them is still rejected', () => {
    const doc = mannequinDoc();
    const v = validateDoc(doc);
    expect(v.ok ? [] : v.issues).toEqual([]);
    const both = structuredClone(doc);
    both.nodes.find((n) => n.id === 'beard')!.model!.retarget!.attach = true;
    const r = validateDoc(both);
    expect(r.ok ? [] : r.issues.map((i) => i.message)).toEqual([expect.stringMatching(/models "skin" and "beard" both attach to mannequin "hero"/)]);
  });
});

describe('previs player: hair parts follow the body Head bone', () => {
  it('jointed mannequin source (pickUp lean, crouch, head turn): beard and hair on the body Head < 1e-3 units', async () => {
    const doc = mannequinDoc();
    const scene = drawnScene();
    const player = await loadPrevisPlayer(scene.sdk, doc, { look: 'textured', resolveModel: resolverFor(EX) });
    let worst = 0;
    for (const t of [0, 0.5, 1, 1.5, 2.1, 2.25, 2.5]) {
      player.frame(t);
      for (const part of ['beard', 'hair']) {
        const { err, count } = partError(scene, 'skin', part);
        expect(count).toBeGreaterThan(400);
        expect(err, `${part} t=${t}`).toBeLessThan(1e-3);
        worst = Math.max(worst, err);
      }
    }
    console.log(`[hair parts] mannequin source: max |drawn - body Head| ${worst.toExponential(2)} engine units`);
    player.dispose();
  });

  it('retarget-demo.json and gate-raid.json (mannequin hero, walker-sourced giant with a topple): every frame', async () => {
    const cases: { doc: string; keep: (id: string) => boolean; pairs: [string, string][] }[] = [
      { doc: 'retarget-demo.json', keep: () => true, pairs: [['hero_skin', 'hero_hair']] },
      {
        doc: 'gate-raid.json',
        keep: (id) => ['giant', 'giant_tex', 'giant_beard', 'club', 'hero_skin', 'hero_hair'].includes(id) || id.startsWith('hero.'),
        pairs: [
          ['hero_skin', 'hero_hair'],
          ['giant_tex', 'giant_beard'],
        ],
      },
    ];
    for (const c of cases) {
      const full = loadDoc(EX + c.doc);
      const doc: PrevisDoc = { ...full, nodes: full.nodes.filter((n) => c.keep(n.id)), shots: plainShots(full) };
      expect(validateDoc(doc).ok).toBe(true);
      const scene = drawnScene();
      const player = await loadPrevisPlayer(scene.sdk, doc, { look: 'textured', resolveModel: resolverFor(EX) });
      const end = Math.round(Math.max(...doc.shots.map((s) => s.end)) * doc.fps);
      const worst: Record<string, number> = {};
      for (let f = 0; f < end; f++) {
        const t = f / doc.fps;
        player.frame(t);
        for (const [body, part] of c.pairs) {
          const node = doc.nodes.find((n) => n.id === body)!;
          const shown = node.tracks?.visible ? node.tracks.visible.filter((k) => k.t <= t).at(-1)?.v ?? node.tracks.visible[0].v : node.visible !== false;
          if (!shown) continue; // pose-only frames send no palette
          const { err } = partError(scene, body, part);
          worst[part] = Math.max(worst[part] ?? 0, err);
        }
      }
      console.log(`[hair parts] ${c.doc}: max |drawn - body Head| (engine units) ${JSON.stringify(worst)}`);
      for (const [, part] of c.pairs) expect(worst[part], `${c.doc} ${part}`).toBeLessThan(1e-3);
      player.dispose();
    }
  });

  it('film s07-fall.json (Haon falls) and s01-hall.json (Doowon): every 4th frame', async () => {
    const FILM = EX + 'film/';
    for (const [name, who] of [
      ['s07-fall.json', ['haon']],
      ['s01-hall.json', ['haon', 'mentor']],
    ] as const) {
      const full = loadDoc(FILM + name);
      const doc: PrevisDoc = { ...full, nodes: full.nodes.filter((n) => who.some((w) => n.id.startsWith(w))), shots: plainShots(full) };
      const v = validateDoc(doc);
      expect(v.ok ? [] : v.issues).toEqual([]);
      const parts = doc.nodes.filter((n) => /_hair_/.test(n.id)).map((n) => [n.id.replace(/_hair_.*$/, '_skin'), n.id] as [string, string]);
      expect(parts.length).toBe(who.length === 1 ? 1 : 3);
      const scene = drawnScene();
      const player = await loadPrevisPlayer(scene.sdk, doc, { look: 'textured', resolveModel: resolverFor(FILM) });
      const end = Math.round(Math.max(...doc.shots.map((s) => s.end)) * doc.fps);
      const worst: Record<string, number> = {};
      for (let f = 0; f < end; f += 4) {
        player.frame(f / doc.fps);
        for (const [body, part] of parts) worst[part] = Math.max(worst[part] ?? 0, partError(scene, body, part).err);
      }
      console.log(`[hair parts] film ${name}: max |drawn - body Head| (engine units) ${JSON.stringify(worst)}`);
      for (const [, part] of parts) expect(worst[part], `${name} ${part}`).toBeLessThan(1e-3);
      player.dispose();
    }
  });
});

describe('previs player: hair parts do not touch the flat pass', () => {
  it('textured-only parts: the flat look makes exactly the calls of the doc without them', async () => {
    const doc = mannequinDoc();
    const without: PrevisDoc = { ...doc, nodes: doc.nodes.filter((n) => n.id !== 'beard' && n.id !== 'hair') };
    const record = async (d: PrevisDoc) => {
      const scene = drawnScene();
      const player = await loadPrevisPlayer(scene.sdk, d, { resolveModel: resolverFor(EX) });
      for (const t of [0, 1, 2.5]) player.frame(t);
      player.dispose();
      return scene.calls;
    };
    expect(await record(doc)).toEqual(await record(without));
  });
});
