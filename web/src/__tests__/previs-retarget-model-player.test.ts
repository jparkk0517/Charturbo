import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eulerYXZToQuat, nodeStateAt } from '../previs/evaluate';
import type { Quat } from '../previs/evaluate';
import { loadPrevisPlayer } from '../previs/player';
import { modelSrcsToLoad } from '../previs/models';
import { modelSourceFrames, modelSourceRest, prepareRetarget, quatRotate, rigRestPose, scaleFrames, UE_RETARGET_MAP, WALKER_SOURCE_MAP } from '../previs/retarget';
import type { MannequinJointFrame } from '../previs/retarget';
import type { PrevisDoc, PrevisNode, Vec3 } from '../previs/types';
import { validateDoc } from '../previs/validate';
import { drawnScene, mul4 } from './drawn-scene';
import { quaterniusRig } from './fixtures/quaternius-rig';
import { walkerRig } from './fixtures/walker-rig';

// model.retarget from a MODEL source in the player, against an independent reference: the source pose is taken from what
// the FLAT pass draws (walker mesh objects: object chain x mesh matrix, ground lock included), the target is posed by
// the pure solver on the JSON fixture rigs and placed by hand on the source node's world frame.

const EX = '../../previs/examples/';
const QDIR = EX + 'models/quaternius/';
const GLTF = 'Superhero_Male_FullBody.gltf';
const WS = 10;

function fileBuffer(rel: string): ArrayBuffer {
  const b = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

/** The .gltf with its .bin inlined and every texture reference dropped (no fetches in node). */
function gltfBytes(): ArrayBuffer {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL(QDIR + GLTF, import.meta.url)), 'utf8'));
  const bin = readFileSync(fileURLToPath(new URL(QDIR + j.buffers[0].uri, import.meta.url)));
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

const resolveModel = (src: string) => (src.endsWith('walker.glb') ? fileBuffer(EX + 'models/walker.glb') : gltfBytes());

/** Walker giant (flat only: clips, joints, ground lock, moving and toppling) + club (both) + Quaternius skin (textured). */
function giantDoc(withSkin = true): PrevisDoc {
  const nodes: PrevisNode[] = [
    {
      id: 'giant',
      shape: 'model',
      color: [0.1, 0.9, 0.9],
      look: { show: 'flat' },
      model: {
        src: 'models/walker.glb',
        fit: 'contain',
        groundLock: true,
        animation: [
          { clip: 'walk', start: 0.2, speed: 1.1, loop: 'repeat' },
          { clip: 'wave', start: 1.4, speed: 40, loop: 'once', blendIn: 0.4 },
        ],
      },
      position: [0.3, 1.6, -1],
      rotation: [0, 0.4, 0],
      size: [1.6, 3.2, 1.0],
      tracks: {
        position: [{ t: 0, v: [0.3, 1.6, -1] }, { t: 1.4, v: [0.3, 1.6, 0.5] }, { t: 2.2, v: [0.3, 1.2, 1.6] }],
        rotation: [{ t: 1.8, v: [0, 0.4, 0] }, { t: 2.6, v: [1.2, 0.4, 0] }],
        joints: {
          'upperArm.R': [{ t: 1.6, v: [0, 0, 0] }, { t: 2.2, v: [-1.4, 0, 0.1] }],
          'lowerArm.R': [{ t: 1.6, v: [0, 0, 0] }, { t: 2.2, v: [0.7, 0, 0] }],
          torso: [{ t: 1.6, v: [0, 0, 0] }, { t: 2.2, v: [0.4, 0, 0] }],
        },
      },
    },
    {
      id: 'club',
      shape: 'box',
      color: [0.5, 0, 1],
      look: { color: [0.3, 0.3, 0.3] },
      parent: 'giant',
      parentJoint: 'lowerArm.R',
      position: [0, -0.5, 0.3],
      rotation: [2.3, 0, 0],
      size: [0.2, 1.9, 0.2],
    },
  ];
  if (withSkin) {
    nodes.push({
      id: 'skin',
      shape: 'model',
      color: [0.8, 0.3, 0.2],
      look: { show: 'textured' },
      model: { src: `models/quaternius/${GLTF}`, retarget: { source: 'giant', map: 'ue', sourceMap: 'walker' } },
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [1, 1.8, 0.4],
    });
  }
  return {
    version: 1,
    fps: 24,
    size: { width: 64, height: 64 },
    background: [0, 0, 0],
    roles: [],
    nodes,
    shots: [{ id: 's', start: 0, end: 2.6, camera: { position: [{ t: 0, v: [0, 2, 9] }], target: { track: [{ t: 0, v: [0, 1.5, 0] }] } } }],
  };
}

const TIMES = [0, 0.7, 1.5, 1.9, 2.2, 2.6];

/** Column-major 4x4 of rotation q, translation p. */
function mat(q: Quat, p: Vec3): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    p[0], p[1], p[2], 1,
  ];
}
const qconj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];
const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];

describe('previs player: model.retarget from a model source (walker -> Quaternius)', () => {
  it('the drawn skin equals the pure solver fed with the walker the flat pass draws; the club is the same in both passes', async () => {
    const doc = giantDoc();
    expect(validateDoc(doc).ok ? [] : (validateDoc(doc) as { issues: unknown }).issues).toEqual([]);

    // walker node name of each loader object, in creation order (a separate load)
    const probe = drawnScene();
    const wr = await probe.sdk.loadGltf(fileBuffer(EX + 'models/walker.glb'), { textures: false });
    const objectNode = wr.objects.map((id) => wr.nodes.find((n) => n.objectIds.includes(id))!.name!);

    const flat = drawnScene();
    const pf = await loadPrevisPlayer(flat.sdk, doc, { resolveModel });
    expect([...flat.objects.values()].some((o) => o.name.startsWith('previs:skin'))).toBe(false);
    const tex = drawnScene();
    const pt = await loadPrevisPlayer(tex.sdk, doc, { look: 'textured', resolveModel });

    // reference rig, rest from the walker fixture at the drawn scale
    const fitF = flat.idOf('previs:giant:fit');
    const ks = flat.objects.get(fitF)!.scale[0];
    const wrig = walkerRig();
    const { rot: wR, pos: wP } = rigRestPose(wrig);
    const rest = modelSourceRest(WALKER_SOURCE_MAP, (b) => mat(wR[wrig.names.indexOf(b)], wP[wrig.names.indexOf(b)]));
    const restM = scaleFrames(rest.frames, ks / WS);
    const rt = prepareRetarget(quaterniusRig(), UE_RETARGET_MAP, (j) => restM[j]);
    const k = rt.legScale!;
    const hips0 = rt.rest.pos[rt.hipsIndex];
    const ref = drawnScene();
    const qr = await ref.sdk.loadGltf(gltfBytes(), { textures: false, posable: UE_RETARGET_MAP.map((e) => e.bone) });
    const anim = ref.sdk.createGltfAnimator(qr, { autoUpdate: false });

    const fitT = tex.idOf('previs:skin:fit');
    const skinIds = tex.meshesUnder(fitT).filter((id) => tex.objects.get(id)!.skin);
    expect(skinIds.length).toBeGreaterThan(0);
    const walkerIds = () => flat.meshesUnder(fitF).sort((a, b) => a - b);
    const texWalker = new Set(tex.meshesUnder(tex.idOf('previs:giant:fit')));
    expect(texWalker.size).toBe(wr.objects.length); // loaded (pose only) in the textured pass

    const minY: Record<number, number> = {};
    let worstSkin = 0;
    let worstClub = 0;
    for (const t of TIMES) {
      pf.frame(t);
      tex.calls.length = 0;
      pt.frame(t);
      // pose only: the walker sends nothing to draw in the textured pass
      expect(tex.calls.filter((c) => c.startsWith('setObjectMeshMatrices') && c.split(' ')[1].split(',').some((id) => texWalker.has(+id)))).toEqual([]);
      // source frames from the drawn walker (world, engine units) -> the source's root frame (meters)
      const world = new Map<string, number[]>();
      walkerIds().forEach((id, i) => world.set(objectNode[i], mul4(flat.worldMatrix(id), flat.objects.get(id)!.meshMatrix!)));
      const st = nodeStateAt(doc.nodes[0], t);
      const q = eulerYXZToQuat(st.rotation);
      const fw = modelSourceFrames(WALKER_SOURCE_MAP, (b) => world.get(b)!);
      const frames: Record<string, MannequinJointFrame> = {};
      for (const [j, f] of Object.entries(fw)) {
        frames[j] = { rot: qmul(qconj(q), f.rot), pos: quatRotate(qconj(q), [f.pos[0] / WS - st.position[0], f.pos[1] / WS - st.position[1], f.pos[2] / WS - st.position[2]]) };
      }
      const { local } = rt.solvePose((j) => frames[j], k, { root: { q, p: st.position }, sourceAnkleHeight: (rest.ankleHeight * ks) / WS });
      anim.setNodeRotations(UE_RETARGET_MAP.map((e) => ({ node: e.bone, rotation: local[rt.indexOf(e.bone)] as Quat })), 'absolute');
      const want: Vec3[] = [];
      for (const id of qr.objects) {
        const o = ref.objects.get(id)!;
        if (!o.skin) continue;
        for (const v of new Set(o.indices!)) {
          const p = ref.localVertex(o, v);
          const f = [0, 1, 2].map((c) => frames.hips.pos[c] * WS + k * WS * (p[c] - hips0[c])) as Vec3;
          const r = quatRotate(q, f);
          want.push([r[0] + st.position[0] * WS, r[1] + st.position[1] * WS, r[2] + st.position[2] * WS]);
        }
      }
      const got = skinIds.flatMap((id) => tex.worldVertices(id));
      minY[t] = +(Math.min(...got.map((p) => p[1])) / WS).toFixed(4);
      expect(got.length).toBe(want.length);
      for (let i = 0; i < got.length; i++) worstSkin = Math.max(worstSkin, Math.hypot(got[i][0] - want[i][0], got[i][1] - want[i][1], got[i][2] - want[i][2]));
      // the club hangs from the (pose-only) walker forearm in the textured pass: the same world matrix as in flat
      const a = flat.worldMatrix(flat.idOf('previs:club'));
      const b = tex.worldMatrix(tex.idOf('previs:club'));
      for (let i = 0; i < 16; i++) worstClub = Math.max(worstClub, Math.abs(a[i] - b[i]));
    }
    console.log(`[retarget-model] skin vs reference max ${worstSkin.toExponential(2)} engine units; club flat vs textured max ${worstClub.toExponential(2)}; skin min y per time ${JSON.stringify(minY)}`);
    // engine units (0.1 mm at worldScale 10): float32 matrices on both sides
    expect(worstSkin).toBeLessThan(1e-3);
    // the skin really moves and stays on the floor while the walker stands (ground lock of the source, planted feet)
    expect(new Set(Object.values(minY)).size).toBeGreaterThan(3);
    expect(worstClub).toBeLessThan(1e-4);
    // a frame without any change sends nothing for the skin
    pt.frame(2.6);
    tex.calls.length = 0;
    pt.frame(2.6);
    const skinObjs = new Set([fitT, ...skinIds, tex.idOf('previs:skin')]);
    expect(tex.calls.filter((c) => /^(setObjectJointMatrices|setObjectTransform) /.test(c) && c.split(' ')[1].split(',').some((id) => skinObjs.has(+id)))).toEqual([]);
    pf.dispose();
    pt.dispose();
  });

  it('flat pass: a textured-only model-sourced skin changes no SDK call', async () => {
    const run = async (doc: PrevisDoc): Promise<string[]> => {
      const s = drawnScene();
      const p = await loadPrevisPlayer(s.sdk, doc, { resolveModel });
      for (const t of TIMES) p.frame(t);
      p.dispose();
      return s.calls;
    };
    const withSkin = await run(giantDoc(true));
    const without = await run(giantDoc(false));
    expect(withSkin).toEqual(without);
  });

  it('load errors: a source bone missing names the source node', async () => {
    const doc = giantDoc();
    const noTorso = (): ArrayBuffer => {
      // rename the walker's torso node inside the GLB JSON chunk (same length keeps the chunk layout)
      const b = new Uint8Array(fileBuffer(EX + 'models/walker.glb'));
      const s = new TextDecoder().decode(b);
      const at = s.indexOf('"torso"');
      b.set(new TextEncoder().encode('"tors0"'), at);
      return b.buffer;
    };
    await expect(
      loadPrevisPlayer(drawnScene().sdk, doc, { look: 'textured', resolveModel: (src) => (src.endsWith('walker.glb') ? noTorso() : gltfBytes()) }),
    ).rejects.toThrow(/loadPrevisPlayer: node "giant" \(models\/walker.glb\): .*posable node "torso" not found/);
  });
});

describe('previs gate-raid.json giant_tex (Quaternius retargeted onto the walker giant)', () => {
  it('drawn mesh never more than 2.5 cm below the floor; top within 15 % of the walker top', async () => {
    const full: PrevisDoc = JSON.parse(readFileSync(fileURLToPath(new URL(EX + 'gate-raid.json', import.meta.url)), 'utf8'));
    // the giant, its club, its retargeted skin and the hero pivots (the camera follows hero.root)
    const doc = { ...full, nodes: full.nodes.filter((n) => ['giant', 'giant_tex', 'club'].includes(n.id) || n.id.startsWith('hero.')) };
    expect(validateDoc(doc).ok).toBe(true);
    const tex = drawnScene();
    const pt = await loadPrevisPlayer(tex.sdk, doc, { look: 'textured', resolveModel });
    const flat = drawnScene();
    const pf = await loadPrevisPlayer(flat.sdk, doc, { resolveModel });
    const span = (s: ReturnType<typeof drawnScene>, id: string): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const m of s.meshesUnder(s.idOf(`previs:${id}:fit`))) for (const p of s.worldVertices(m)) [lo, hi] = [Math.min(lo, p[1]), Math.max(hi, p[1])];
      return [lo / WS, hi / WS];
    };
    let low = { y: Infinity, t: 0 };
    let tall = 0;
    const visible = doc.nodes.find((n) => n.id === 'giant')!.tracks!.visible!.find((k) => k.v)!.t;
    const topple = doc.nodes.find((n) => n.id === 'giant')!.tracks!.rotation![0].t;
    for (let f = Math.ceil(visible * doc.fps); f < Math.round(doc.shots[doc.shots.length - 1].end * doc.fps); f++) {
      const t = f / doc.fps;
      pt.frame(t);
      pf.frame(t);
      const [y, top] = span(tex, 'giant_tex');
      if (y < low.y) low = { y, t };
      if (t < topple) tall = Math.max(tall, top / span(flat, 'giant')[1]);
    }
    console.log(`[gate-raid giant_tex] lowest drawn point ${low.y.toFixed(4)} m at t=${low.t.toFixed(3)}; standing height / walker height max ${tall.toFixed(3)}`);
    expect(low.y).toBeGreaterThanOrEqual(-0.025);
    expect(tall).toBeLessThan(1.15);
    pt.dispose();
    pf.dispose();
  });
});

describe('previs player review fixes (attach of an undrawn model, pose-only textures, early errors)', () => {
  it('attach onto a model hidden for good: no rewrite, its src is neither listed nor fetched, the prop stays on the mannequin pivot', async () => {
    const doc: PrevisDoc = JSON.parse(readFileSync(fileURLToPath(new URL(EX + 'retarget-demo.json', import.meta.url)), 'utf8'));
    const skin = doc.nodes.find((n) => n.id === 'hero_skin')!;
    skin.visible = false;
    expect(validateDoc(doc).ok).toBe(true);
    expect(modelSrcsToLoad(doc)).not.toContain(skin.model!.src);
    const fetched: string[] = [];
    const s = drawnScene();
    const p = await loadPrevisPlayer(s.sdk, doc, { look: 'textured', resolveModel: (src) => (fetched.push(src), gltfBytes()) });
    expect(fetched).toEqual([]);
    expect([...s.objects.values()].some((o) => o.name.startsWith('previs:hero_skin:joint:'))).toBe(false);
    const grab = doc.nodes.find((n) => n.id === 'box')!.tracks!.parent![0].t;
    p.frame(grab + 0.5);
    expect(s.objects.get(s.idOf('previs:box'))!.parent).toBe(s.idOf('previs:hero.handR'));
    p.dispose();
  });

  it('textured pass: the pose-only source loads without textures, the drawn target with them; flat loads are unchanged', async () => {
    const spy = (s: ReturnType<typeof drawnScene>) => {
      const opts: Record<string, boolean | undefined> = {};
      const load = s.sdk.loadGltf.bind(s.sdk);
      s.sdk.loadGltf = ((src: Parameters<typeof load>[0], o?: Parameters<typeof load>[1]) => {
        opts[new Uint8Array(src as ArrayBuffer, 0, 4)[0] === 0x67 ? 'walker' : 'skin'] = o?.textures;
        return load(src, o);
      }) as typeof s.sdk.loadGltf;
      return opts;
    };
    const tex = drawnScene();
    const to = spy(tex);
    (await loadPrevisPlayer(tex.sdk, giantDoc(), { look: 'textured', resolveModel })).dispose();
    expect(to).toEqual({ walker: false, skin: true });
    const flat = drawnScene();
    const fo = spy(flat);
    (await loadPrevisPlayer(flat.sdk, giantDoc(), { resolveModel })).dispose();
    expect(fo).toEqual({ walker: false });
  });

  it('an unvalidated doc without sourceMap rejects before the scene is touched (theme kept, no object)', async () => {
    const doc = giantDoc();
    delete doc.nodes.find((n) => n.id === 'skin')!.model!.retarget!.sourceMap;
    const s = drawnScene();
    const theme = JSON.stringify(s.sdk.getTheme());
    await expect(loadPrevisPlayer(s.sdk, doc, { look: 'textured', resolveModel })).rejects.toThrow(
      /loadPrevisPlayer: model.retarget: source "giant" is a model node and needs sourceMap/,
    );
    expect(s.objects.size).toBe(0);
    expect(s.calls).toEqual([]);
    expect(JSON.stringify(s.sdk.getTheme())).toBe(theme);
    // a model source that is itself model-sourced (unvalidated chain) is refused the same way, no load waits for itself
    const chain = giantDoc();
    chain.nodes.find((n) => n.id === 'giant')!.model!.retarget = { source: 'skin', map: 'ue', sourceMap: 'ue' };
    await expect(loadPrevisPlayer(drawnScene().sdk, chain, { resolveModel })).rejects.toThrow(/is itself retargeted from a model/);
  });
});
