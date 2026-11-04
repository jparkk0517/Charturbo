import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyMotion, createMannequin, crouch, lookAt, pickUp } from '../previs/mannequin';
import { nodeStateAt, worldTransform } from '../previs/evaluate';
import type { Quat } from '../previs/evaluate';
import { loadPrevisPlayer } from '../previs/player';
import { mannequinFrames, prepareRetarget, quatRotate, UE_RETARGET_MAP } from '../previs/retarget';
import type { NodeState, PrevisDoc, PrevisNode, Vec3 } from '../previs/types';
import { validateDoc } from '../previs/validate';
import { drawnScene } from './drawn-scene';
import { quaterniusRig } from './fixtures/quaternius-rig';

// model.retarget in the player, against an independent reference: the same file loaded on its own, posed with the pure
// solver (rig from the JSON fixture, not from the player's nodeMatrix decomposition) and placed by hand on the
// mannequin root (pivot) and hips (FIT).

const DIR = '../../previs/examples/models/quaternius/';
const GLTF = 'Superhero_Male_FullBody.gltf';

/** The .gltf with its .bin inlined as a data URI and every texture reference dropped (no fetches in node). */
function gltfBytes(edit: (j: any) => void = () => {}): ArrayBuffer {
  const j = JSON.parse(readFileSync(fileURLToPath(new URL(DIR + GLTF, import.meta.url)), 'utf8'));
  const bin = readFileSync(fileURLToPath(new URL(DIR + j.buffers[0].uri, import.meta.url)));
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
  edit(j);
  const b = new TextEncoder().encode(JSON.stringify(j));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

const FPS = 24;
const GREY: [number, number, number] = [0.5, 0.5, 0.5];
const WS = 10;

function retargetDoc(show: 'both' | 'textured' = 'both', src = `models/${GLTF}`): PrevisDoc {
  const m = createMannequin({ id: 'hero', color: GREY, height: 1.78, position: [0.5, 0, -1], limbs: 'jointed' });
  const root = m.nodes.find((n) => n.id === m.joints.root)!;
  root.rotation = [0, 0.7, 0];
  const pick = pickUp({ mannequin: m, side: 'right', target: [0.2, 0.08, -0.5], start: 0.25, grab: 1, end: 1.75, depth: 0.6, lean: 0.7, fps: FPS });
  const nodes = applyMotion(m.nodes, [
    pick.motion,
    crouch({ mannequin: m, start: 2, end: 2.5, depth: 0.35, fps: FPS }),
    lookAt({ joints: m.joints, start: 2, end: 2.5, yaw: -0.5 }),
    { [m.joints.root]: { position: [{ t: 1.75, v: [0.5, 0, -1] }, { t: 2.5, v: [0.9, 0, -0.4] }] } },
  ]);
  if (show === 'textured') for (const n of nodes) n.look = { show: 'flat' };
  return {
    version: 1,
    fps: FPS,
    size: { width: 64, height: 64 },
    background: [0, 0, 0],
    roles: [],
    nodes: [
      ...nodes,
      {
        id: 'skin',
        shape: 'model',
        model: { src, retarget: { source: 'hero', map: 'ue' } },
        ...(show === 'textured' ? { look: { show: 'textured' as const } } : {}),
        color: [0.8, 0.3, 0.2],
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 1.8, 0.4],
      } as PrevisNode,
    ],
    shots: [{ id: 's', start: 0, end: 2.5, camera: { position: [{ t: 0, v: [0, 1.5, 4] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
  };
}

const TIMES = [0, 0.5, 1, 1.5, 2.25, 2.5];

/** World vertices of the model's skinned objects, as drawn. */
function skinVertices(scene: ReturnType<typeof drawnScene>, id = 'skin'): Vec3[] {
  const fit = [...scene.objects.entries()].find(([, o]) => o.name === `previs:${id}:fit`)![0];
  const ids = [...scene.objects.entries()].filter(([, o]) => o.parent === fit && o.skin).map(([id]) => id);
  expect(ids.length).toBeGreaterThan(0);
  return ids.flatMap((id) => scene.worldVertices(id));
}

/** Reference world vertices at `t`: separate load, pure solve on the JSON fixture rig, placement by hand. */
async function referenceVertices(doc: PrevisDoc, times: number[]): Promise<Vec3[][]> {
  const scene = drawnScene();
  const r = await scene.sdk.loadGltf(gltfBytes(), { textures: false, posable: UE_RETARGET_MAP.map((e) => e.bone) });
  const anim = scene.sdk.createGltfAnimator(r, { autoUpdate: false });
  const nodes = doc.nodes;
  const joints = createMannequin({ id: 'hero', color: GREY, limbs: 'jointed' }).joints;
  const rest = mannequinFrames(nodes, joints);
  const rt = prepareRetarget(quaterniusRig(), UE_RETARGET_MAP, (j) => rest[j]);
  const k = rt.legScale! * WS;
  const hips0 = rt.rest.pos[rt.hipsIndex];
  const out: Vec3[][] = [];
  for (const t of times) {
    const states: Record<string, NodeState> = {};
    for (const n of nodes) states[n.id] = nodeStateAt(n, t);
    const F = mannequinFrames(nodes, joints, (n) => states[n.id]);
    const w = worldTransform(doc, states, joints.root);
    const { local } = rt.solvePose((j) => F[j], rt.legScale!, { root: { q: w.quaternion, p: w.position } });
    anim.setNodeRotations(UE_RETARGET_MAP.map((e) => ({ node: e.bone, rotation: local[rt.indexOf(e.bone)] as Quat })), 'absolute');
    const verts: Vec3[] = [];
    for (const id of r.objects) {
      const o = scene.objects.get(id)!;
      if (!o.skin) continue;
      for (const v of new Set(o.indices!)) {
        const p = scene.localVertex(o, v);
        // FIT (pivot frame, engine units): hips * ws + k * (p - hips0); PIVOT: root world
        const f: Vec3 = [0, 1, 2].map((i) => F.hips.pos[i] * WS + k * (p[i] - hips0[i])) as Vec3;
        const q = quatRotate(w.quaternion, f);
        verts.push([q[0] + w.position[0] * WS, q[1] + w.position[1] * WS, q[2] + w.position[2] * WS]);
      }
    }
    out.push(verts);
  }
  return out;
}

describe('previs player: model.retarget (Quaternius, UE map)', () => {
  it('the doc validates; the drawn skin equals the pure solver placed on the mannequin (root pivot, hips FIT)', async () => {
    const doc = retargetDoc();
    const v = validateDoc(doc);
    expect(v.ok ? [] : v.issues).toEqual([]);
    const scene = drawnScene();
    const player = await loadPrevisPlayer(scene.sdk, doc, { resolveModel: () => gltfBytes() });
    const ref = await referenceVertices(doc, TIMES);
    const minY: Record<string, number> = {};
    TIMES.forEach((t, i) => {
      scene.calls.length = 0;
      player.frame(t);
      // at most one pose send per frame (one setNodeRotations call: one joint-matrix batch)
      expect(scene.calls.filter((c) => c.startsWith('setObjectJointMatrices')).length).toBeLessThanOrEqual(1);
      const got = skinVertices(scene);
      expect(got.length).toBe(ref[i].length);
      let err = 0;
      for (let k = 0; k < got.length; k++) err = Math.max(err, Math.hypot(got[k][0] - ref[i][k][0], got[k][1] - ref[i][k][1], got[k][2] - ref[i][k][2]));
      // engine units (0.1 mm at worldScale 10): float32 matrices on both sides
      expect(err, `t=${t}`).toBeLessThan(1e-3);
      minY[t] = Math.min(...got.map((p) => p[1])) / WS;
    });
    console.log('[retarget] drawn mesh lowest point (m) per time:', JSON.stringify(Object.fromEntries(Object.entries(minY).map(([k, x]) => [k, Number(x.toFixed(3))]))));
    // a frame without any change sends nothing for the model
    player.frame(2.5);
    scene.calls.length = 0;
    player.frame(2.5);
    expect(scene.calls.filter((c) => /setObjectJointMatrices|setObjectTransform/.test(c))).toEqual([]);
    player.dispose();
  });

  it('a flat-only mannequin drives a textured-only model (the mannequin is not built in the textured look)', async () => {
    const doc = retargetDoc('textured');
    expect(validateDoc(doc).ok).toBe(true);
    const flat = drawnScene();
    const pf = await loadPrevisPlayer(flat.sdk, doc, { resolveModel: () => gltfBytes() });
    expect([...flat.objects.values()].some((o) => o.name === 'previs:skin')).toBe(false);
    pf.dispose();
    const tex = drawnScene();
    const pt = await loadPrevisPlayer(tex.sdk, doc, { look: 'textured', resolveModel: () => gltfBytes() });
    expect([...tex.objects.values()].some((o) => o.name.startsWith('previs:hero.'))).toBe(false);
    const ref = await referenceVertices(doc, [1]);
    pt.frame(1);
    const got = skinVertices(tex);
    let err = 0;
    for (let k = 0; k < got.length; k++) err = Math.max(err, Math.hypot(got[k][0] - ref[0][k][0], got[k][1] - ref[0][k][1], got[k][2] - ref[0][k][2]));
    expect(err).toBeLessThan(1e-3);
    pt.dispose();
  });

  it('load errors name the node: missing bone, unskinned model', async () => {
    const doc = retargetDoc();
    const noPelvis = gltfBytes((j) => {
      for (const n of j.nodes) if (n.name === 'pelvis') n.name = 'hips_bone';
    });
    await expect(loadPrevisPlayer(drawnScene().sdk, doc, { resolveModel: () => noPelvis })).rejects.toThrow(
      /loadPrevisPlayer: node "skin" \(models\/Superhero_Male_FullBody.gltf\): .*posable node "pelvis" not found/,
    );
    const rigid = gltfBytes((j) => {
      for (const n of j.nodes) delete n.skin;
      delete j.skins;
    });
    await expect(loadPrevisPlayer(drawnScene().sdk, doc, { resolveModel: () => rigid })).rejects.toThrow(
      /node "skin" .*model.retarget needs a skinned model \(a glTF skin\); this model has none/,
    );
  });
});

describe('previs retarget-demo.json (IK + planted feet)', () => {
  it('drawn mesh lowest point >= -0.01 m on every frame; box-to-hand distance while carried', async () => {
    const doc: PrevisDoc = JSON.parse(readFileSync(fileURLToPath(new URL('../../previs/examples/retarget-demo.json', import.meta.url)), 'utf8'));
    expect(validateDoc(doc).ok).toBe(true);
    const scene = drawnScene();
    const player = await loadPrevisPlayer(scene.sdk, doc, { look: 'textured', resolveModel: () => gltfBytes() });
    const fit = scene.idOf('previs:hero_skin:fit');
    const meshes = scene.meshesUnder(fit);
    // independent hand: pure solver on the fixture rig, placed by hand
    const joints = createMannequin({ id: 'hero', color: GREY, limbs: 'jointed' }).joints;
    const rest = mannequinFrames(doc.nodes, joints);
    const rt = prepareRetarget(quaterniusRig(), UE_RETARGET_MAP, (j) => rest[j]);
    const k = rt.legScale!;
    const grab = doc.nodes.find((n) => n.id === 'box')!.tracks!.parent![0].t;
    const n = Math.round(doc.shots[doc.shots.length - 1].end * doc.fps);
    let lowest = { y: Infinity, t: 0 };
    let carried = { max: 0, t: 0 };
    let unreached = 0;
    let maxMiss = 0;
    for (let f = 0; f < n; f++) {
      const t = f / doc.fps;
      player.frame(t);
      let y = Infinity;
      for (const id of meshes) for (const p of scene.worldVertices(id)) y = Math.min(y, p[1] / WS);
      if (y < lowest.y) lowest = { y, t };
      const states: Record<string, NodeState> = {};
      for (const x of doc.nodes) states[x.id] = nodeStateAt(x, t);
      const F = mannequinFrames(doc.nodes, joints, (x) => states[x.id]);
      const w = worldTransform(doc, states, joints.root);
      const pose = rt.solvePose((j) => F[j], k, { root: { q: w.quaternion, p: w.position } });
      if (pose.limbs.some((l) => !l.reached)) unreached++;
      maxMiss = Math.max(maxMiss, ...pose.limbs.map((l) => l.miss));
      if (t >= grab) {
        const hand = pose.limbs.find((l) => l.joint === 'handR')!.miss;
        if (hand > carried.max) carried = { max: hand, t };
      }
    }
    console.log(`[retarget-demo] frames ${n}; lowest drawn point ${lowest.y.toFixed(4)} m at t=${lowest.t.toFixed(3)}; skin hand_r to the box's hand pivot while carried: max ${carried.max.toFixed(4)} m at t=${carried.t.toFixed(3)}; frames with an unreached goal ${unreached}, max miss ${maxMiss.toFixed(4)} m`);
    expect(lowest.y).toBeGreaterThanOrEqual(-0.01);
    player.dispose();
  });
});

describe('previs retarget.attach (retarget-demo.json box)', () => {
  it('textured: the box hangs from the hand_r bone socket (placed like the bone), no pop at the grab; flat: from hero.handR', async () => {
    const doc: PrevisDoc = JSON.parse(readFileSync(fileURLToPath(new URL('../../previs/examples/retarget-demo.json', import.meta.url)), 'utf8'));
    const grab = doc.nodes.find((n) => n.id === 'box')!.tracks!.parent![0].t;
    const dt = 1 / doc.fps;
    // reference hand_r bone world (engine units): separate load posed by the pure solver, placed by hand
    const ref = drawnScene();
    const rr = await ref.sdk.loadGltf(gltfBytes(), { textures: false, posable: UE_RETARGET_MAP.map((e) => e.bone) });
    const anim = ref.sdk.createGltfAnimator(rr, { autoUpdate: false });
    const joints = createMannequin({ id: 'hero', color: GREY, limbs: 'jointed' }).joints;
    const rest = mannequinFrames(doc.nodes, joints);
    const rt = prepareRetarget(quaterniusRig(), UE_RETARGET_MAP, (j) => rest[j]);
    const k = rt.legScale! * WS;
    const hips0 = rt.rest.pos[rt.hipsIndex];
    const boneAt = (t: number): Vec3 => {
      const states: Record<string, NodeState> = {};
      for (const x of doc.nodes) states[x.id] = nodeStateAt(x, t);
      const F = mannequinFrames(doc.nodes, joints, (x) => states[x.id]);
      const w = worldTransform(doc, states, joints.root);
      const { local } = rt.solvePose((j) => F[j], rt.legScale!, { root: { q: w.quaternion, p: w.position } });
      anim.setNodeRotations(UE_RETARGET_MAP.map((e) => ({ node: e.bone, rotation: local[rt.indexOf(e.bone)] as Quat })), 'absolute');
      const m = anim.nodeMatrix('hand_r');
      const f: Vec3 = [0, 1, 2].map((i) => F.hips.pos[i] * WS + k * (m[12 + i] - hips0[i])) as Vec3;
      const q = quatRotate(w.quaternion, f);
      return [q[0] + w.position[0] * WS, q[1] + w.position[1] * WS, q[2] + w.position[2] * WS];
    };

    const tex = drawnScene();
    const pt = await loadPrevisPlayer(tex.sdk, doc, { look: 'textured', resolveModel: () => gltfBytes() });
    const box = tex.idOf('previs:box');
    const socket = tex.idOf('previs:hero_skin:joint:hand_r');
    const at = (id: number) => tex.worldMatrix(id);
    pt.frame(grab - dt);
    expect(tex.objects.get(box)!.parent).toBe(null);
    const before = at(box);
    pt.frame(grab);
    expect(tex.objects.get(box)!.parent).toBe(socket);
    const after = at(box);
    for (let i = 0; i < 16; i++) expect(Math.abs(after[i] - before[i]), `box matrix [${i}] across the grab`).toBeLessThan(1e-3);
    let worst = 0;
    for (const t of [grab, grab + 0.25, grab + 0.5, grab + 1, 5.4]) {
      pt.frame(t);
      const m = at(socket);
      const b = boneAt(t);
      worst = Math.max(worst, Math.hypot(m[12] - b[0], m[13] - b[1], m[14] - b[2]));
    }
    expect(worst).toBeLessThan(1e-3);
    pt.dispose();

    const flat = drawnScene();
    const pf = await loadPrevisPlayer(flat.sdk, doc, { resolveModel: () => gltfBytes() });
    pf.frame(grab + 0.5);
    expect(flat.objects.get(flat.idOf('previs:box'))!.parent).toBe(flat.idOf('previs:hero.handR'));
    expect([...flat.objects.values()].some((o) => o.name.startsWith('previs:hero_skin'))).toBe(false);
    pf.dispose();
  });
});

describe('previs retarget review fixes', () => {
  const demo = (): PrevisDoc => JSON.parse(readFileSync(fileURLToPath(new URL('../../previs/examples/retarget-demo.json', import.meta.url)), 'utf8'));

  it('attach + camera follow of the attached box: no throw, the same camera in both passes', async () => {
    const doc = demo();
    doc.shots[1].camera.target = { follow: 'box', offset: [0, 0.2, 0] };
    expect(validateDoc(doc).ok).toBe(true);
    const grab = doc.nodes.find((n) => n.id === 'box')!.tracks!.parent![0].t;
    const pt = await loadPrevisPlayer(drawnScene().sdk, doc, { look: 'textured', resolveModel: () => gltfBytes() });
    const pf = await loadPrevisPlayer(drawnScene().sdk, doc, { resolveModel: () => gltfBytes() });
    for (const t of [grab - 0.1, grab + 0.5, 5.2]) {
      const a = pt.frame(t).camera;
      const b = pf.frame(t).camera;
      expect(a).toEqual(b);
    }
    pt.dispose();
    pf.dispose();
  });

  it('after the load-time captures the first frame shows its own pose (the capture pose is not kept)', async () => {
    const doc = demo();
    const scene = drawnScene();
    const p = await loadPrevisPlayer(scene.sdk, doc, { look: 'textured', resolveModel: () => gltfBytes() });
    const [ref] = await referenceVertices(doc, [0]);
    p.frame(0);
    const got = skinVertices(scene, 'hero_skin');
    let err = 0;
    for (let k = 0; k < got.length; k++) err = Math.max(err, Math.hypot(got[k][0] - ref[k][0], got[k][1] - ref[k][1], got[k][2] - ref[k][2]));
    expect(err).toBeLessThan(1e-3);
    p.dispose();
  });

  it('tiny-scale reload decides on the leg ratio, not on size (file units x1000, size 100x)', async () => {
    const big = gltfBytes((j) => {
      for (const n of j.nodes) if (n.name === 'Armature') n.scale = [1000, 1000, 1000];
    });
    const doc = retargetDoc();
    const skin = doc.nodes.find((n) => n.id === 'skin')!;
    skin.size = [100, 180, 40]; // a size fit would never ask for a reload here
    const scene = drawnScene();
    const p = await loadPrevisPlayer(scene.sdk, doc, { resolveModel: () => big });
    const fit = scene.objects.get(scene.idOf('previs:skin:fit'))!;
    expect(fit.scale[0]).toBeCloseTo(1, 6); // float32 nodeMatrix of the rig
    const [ref] = await referenceVertices(doc, [1]);
    p.frame(1);
    const got = skinVertices(scene);
    let err = 0;
    for (let k = 0; k < got.length; k++) err = Math.max(err, Math.hypot(got[k][0] - ref[k][0], got[k][1] - ref[k][1], got[k][2] - ref[k][2]));
    // engine units (worldScale 10): 1 mm, float32 vertices of a model scaled by 1000 and back
    expect(err).toBeLessThan(1e-2);
    p.dispose();
  });
});
