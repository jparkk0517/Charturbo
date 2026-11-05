import { describe, expect, it } from 'vitest';
import { eulerYXZToQuat } from '../previs/evaluate';
import type { Quat } from '../previs/evaluate';
import type { PrevisDoc, Vec3 } from '../previs/types';
import { validateDoc } from '../previs/validate';
import { createMannequin } from '../previs/mannequin';
import {
  modelSourceFrames,
  modelSourceRest,
  prepareRetarget,
  rigRestPose,
  scaleFrames,
  RETARGET_SOURCE_MAPS,
  UE_RETARGET_MAP,
  WALKER_SOURCE_MAP,
} from '../previs/retarget';
import type { RetargetRig } from '../previs/retarget';
import { quaterniusRig } from './fixtures/quaternius-rig';
import { walkerRig } from './fixtures/walker-rig';

// model.retarget with a MODEL source (pure solver): canonical frames read from a posed source rig.

const qmul = (a: Quat, b: Quat): Quat => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec3): Vec3 => a.map((v) => v / len(a)) as Vec3;
const dist = (a: Vec3, b: Vec3) => len(sub(a, b));

/** Column-major 4x4 of rotation q and translation p (unit scale). */
function mat(q: Quat, p: Vec3): number[] {
  const [x, y, z, w] = q;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 0,
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 0,
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y), 0,
    p[0], p[1], p[2], 1,
  ];
}

/** Model-space matrices of every node of `rig` for local rotations `local` (rest translations). */
function posedMatrices(rig: RetargetRig, local: Quat[]): (bone: string) => number[] {
  // a one-bone retargeter only for its forward kinematics
  const rt = prepareRetarget(rig, [{ joint: 'hips', bone: rig.names[1] }], () => ({ rot: [0, 0, 0, 1], pos: [0, 0, 0] }));
  const { rot, pos } = rt.fk(local);
  return (bone) => {
    const i = rig.names.indexOf(bone);
    if (i < 0) throw new Error(`no bone ${bone}`);
    return mat(rot[i], pos[i]);
  };
}

describe('retarget model source: canonical frames', () => {
  it('walker map: sides by geometry (.R at +x = left), hands at the forearm ends, feet at the ankles', () => {
    const rig = walkerRig();
    const { rot, pos } = rigRestPose(rig);
    const at = (b: string) => mat(rot[rig.names.indexOf(b)], pos[rig.names.indexOf(b)]);
    const { frames, ankleHeight } = modelSourceRest(WALKER_SOURCE_MAP, at);
    expect(frames.shoulderL.pos[0]).toBeGreaterThan(0.2);
    expect(frames.shoulderR.pos[0]).toBeLessThan(-0.2);
    expect(frames.hipL.pos[0]).toBeCloseTo(0.09, 12);
    // ankle 0.04 above the sole, straight under the knee
    expect(frames.footL.pos).toEqual([0.09, expect.closeTo(0.04, 12), 0]);
    expect(ankleHeight).toBeCloseTo(0.04, 12);
    // hand = 0.28 down the forearm (tilted 12 deg forward of the upper arm) from the elbow
    expect(dist(frames.handL.pos, frames.elbowL.pos)).toBeCloseTo(0.28, 12);
    expect(frames.handL.pos[2]).toBeGreaterThan(0.05);
    expect(frames.handL.rot).toEqual(frames.elbowL.rot);
    // positions only move with s, t
    const s = scaleFrames(frames, 2, [1, 0, 0]);
    expect(s.hips.pos).toEqual([1, 1.92, 0]);
    expect(s.hips.rot).toBe(frames.hips.rot);
  });

  it('source = target (Quaternius, ue source map): FK, IK and placement reproduce the source pose', () => {
    const rig = quaterniusRig();
    const n = rig.names.length;
    const restR = rig.restLocal.map((t) => t.r);
    const at0 = posedMatrices(rig, restR);
    const rest = modelSourceRest(RETARGET_SOURCE_MAPS.ue, at0);
    const rt = prepareRetarget(rig, UE_RETARGET_MAP, (j) => rest.frames[j]);
    expect(rt.legScale).toBeCloseTo(1, 9);
    // a pose of the source: every mapped bone turned on top of its rest (feet off the ground: no plant)
    const local = restR.map((r) => [...r] as Quat);
    const turn: Record<string, Vec3> = {
      pelvis: [0.1, 0.3, 0.05], spine_01: [0.25, -0.2, 0.1], Head: [-0.2, 0.4, 0],
      upperarm_l: [0.5, 0.2, -0.6], lowerarm_l: [0.9, 0, 0.1], hand_l: [0.3, 0.2, 0],
      upperarm_r: [-0.4, 0.1, 0.7], lowerarm_r: [0.6, -0.1, 0], thigh_l: [-0.7, 0.1, 0.1], calf_l: [1.1, 0, 0],
      thigh_r: [0.3, -0.1, -0.1], calf_r: [0.5, 0, 0], foot_l: [0.3, 0, 0], foot_r: [-0.2, 0, 0.1],
    };
    for (const [b, e] of Object.entries(turn)) local[rig.names.indexOf(b)] = qmul(local[rig.names.indexOf(b)], eulerYXZToQuat(e));
    const src = rt.fk(local);
    const frames = modelSourceFrames(RETARGET_SOURCE_MAPS.ue, posedMatrices(rig, local));
    const pose = rt.solvePose((j) => frames[j], 1, { plant: false, sourceAnkleHeight: rest.ankleHeight });
    expect(pose.limbs.every((l) => l.reached && l.miss < 1e-9)).toBe(true);
    const out = rt.fk(pose.local);
    for (const e of UE_RETARGET_MAP) {
      const i = rig.names.indexOf(e.bone);
      // the fixture's scales are 1 +- 6e-7: lengths after the IK agree to 1e-7 m
      expect(dist(out.pos[i], src.pos[i]), e.bone).toBeLessThan(1e-6);
      // hands continue the forearm (aim 'continue'), so only their position is the source's
      if (e.bone.startsWith('hand_')) continue;
      const d = Math.abs(out.rot[i][0] * src.rot[i][0] + out.rot[i][1] * src.rot[i][1] + out.rot[i][2] * src.rot[i][2] + out.rot[i][3] * src.rot[i][3]);
      expect(d, e.bone).toBeGreaterThan(1 - 1e-12);
    }
    expect(n).toBe(out.rot.length);
  });

  it('walker -> Quaternius: rest limb directions follow the walker, leg ratio hip -> ankle, posed goals reached', () => {
    const walker = walkerRig();
    const wr = walker.restLocal.map((t) => t.r);
    const rest = modelSourceRest(WALKER_SOURCE_MAP, posedMatrices(walker, wr));
    // drawn at 3.2 / 1.75 (the gate-raid giant: contain fit, height-limited)
    const ks = 3.2 / 1.75;
    const restM = scaleFrames(rest.frames, ks);
    const rig = quaterniusRig();
    const rt = prepareRetarget(rig, UE_RETARGET_MAP, (j) => restM[j]);
    const P0 = rt.rest.pos;
    const ix = (b: string) => rig.names.indexOf(b);
    const legRig = dist(P0[ix('thigh_l')], P0[ix('calf_l')]) + dist(P0[ix('calf_l')], P0[ix('foot_l')]);
    expect(rt.legScale).toBeCloseTo(((0.46 + 0.44) * ks) / legRig, 9);
    const k = rt.legScale!;
    // walker at rest: every target limb segment is parallel to the walker's (FK transfer, before the IK goals)
    const frames0 = scaleFrames(modelSourceFrames(WALKER_SOURCE_MAP, posedMatrices(walker, wr)), ks);
    const p0 = rt.solvePose((j) => frames0[j], k, { sourceAnkleHeight: rest.ankleHeight * ks });
    const fk0 = rt.fk(rt.solve((j) => frames0[j].rot));
    for (const [a, b, ja, jb] of [
      ['upperarm_l', 'lowerarm_l', 'shoulderL', 'elbowL'],
      ['thigh_r', 'calf_r', 'hipR', 'kneeR'],
      ['calf_l', 'foot_l', 'kneeL', 'footL'],
    ]) {
      const dt = unit(sub(fk0.pos[ix(b)], fk0.pos[ix(a)]));
      const ds = unit(sub(frames0[jb].pos, frames0[ja].pos));
      expect(dt[0] * ds[0] + dt[1] * ds[1] + dt[2] * ds[2], `${a} -> ${b}`).toBeGreaterThan(1 - 1e-9);
    }
    // planted at rest: ankles on the ground point under the walker ankle + the rig's ankle height
    for (const l of p0.limbs.filter((x) => x.joint.startsWith('foot'))) expect(l.plant).toBe(1);
    // a posed walker (club arm forward, torso bent, knee bent): hands on the forearm ends where in reach
    const wl = wr.map((r) => [...r] as Quat);
    const set = (b: string, e: Vec3) => (wl[walker.names.indexOf(b)] = qmul(wl[walker.names.indexOf(b)], eulerYXZToQuat(e)));
    set('upperArm.R', [-0.9, 0, 0.1]);
    set('lowerArm.R', [0.6, 0, 0]);
    set('torso', [0.3, 0.1, 0]);
    set('upperLeg.L', [-0.5, 0, 0]);
    set('lowerLeg.L', [0.8, 0, 0]);
    const frames = scaleFrames(modelSourceFrames(WALKER_SOURCE_MAP, posedMatrices(walker, wl)), ks);
    const pose = rt.solvePose((j) => frames[j], k, { sourceAnkleHeight: rest.ankleHeight * ks });
    const fk = rt.fk(pose.local);
    const hips = frames.hips.pos;
    const world = (i: number): Vec3 => fk.pos[i].map((v, c) => hips[c] + (v - P0[rt.hipsIndex][c]) * k) as Vec3;
    const hand = pose.limbs.find((l) => l.joint === 'handL')!;
    console.log('[retarget-model] walker -> Quaternius limbs', JSON.stringify(pose.limbs.map((l) => ({ ...l, miss: +l.miss.toFixed(4) }))));
    if (hand.reached) expect(dist(world(ix('hand_l')), frames.handL.pos)).toBeLessThan(1e-6);
    else expect(dist(world(ix('hand_l')), frames.handL.pos)).toBeCloseTo(hand.miss, 6);
    // the raised knee leg reaches its ankle goal (the ground point under the walker ankle + the rig's ankle height)
    const footL = pose.limbs.find((l) => l.joint === 'footL')!;
    expect(footL.reached).toBe(true);
    const goal: Vec3 = [frames.footL.pos[0], frames.footL.pos[1] - rest.ankleHeight * ks + P0[ix('foot_l')][1] * k, frames.footL.pos[2]];
    expect(dist(world(ix('foot_l')), goal)).toBeLessThan(1e-6);
    // rotation transfer (FK, before the IK): posed target segments stay parallel to the posed walker's
    const fkp = rt.fk(rt.solve((j) => frames[j].rot));
    for (const [a, b, ja, jb] of [
      ['upperarm_l', 'lowerarm_l', 'shoulderL', 'elbowL'],
      ['lowerarm_l', 'hand_l', 'elbowL', 'handL'],
      ['calf_l', 'foot_l', 'kneeL', 'footL'],
    ]) {
      const dt = unit(sub(fkp.pos[ix(b)], fkp.pos[ix(a)]));
      const ds = unit(sub(frames[jb].pos, frames[ja].pos));
      expect(dt[0] * ds[0] + dt[1] * ds[1] + dt[2] * ds[2], `posed ${a} -> ${b}`).toBeGreaterThan(1 - 1e-9);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// validateDoc
// ---------------------------------------------------------------------------------------------

const GREY: [number, number, number] = [0.5, 0.5, 0.5];
const T = (v: unknown) => JSON.parse(JSON.stringify(v));

/** A walker giant (flat only) with a club on its forearm (both passes), driving a Quaternius model (textured only). */
function giantDoc(): PrevisDoc {
  return {
    version: 1,
    fps: 24,
    size: { width: 64, height: 64 },
    background: [0, 0, 0],
    roles: [],
    nodes: [
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
      {
        id: 'skin',
        shape: 'model',
        color: [0.8, 0.3, 0.2],
        look: { show: 'textured' },
        model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'giant', map: 'ue', sourceMap: 'walker' } },
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 1.8, 0.4],
      },
    ],
    shots: [{ id: 's', start: 0, end: 2.6, camera: { position: [{ t: 0, v: [0, 2, 9] }], target: { track: [{ t: 0, v: [0, 1.5, 0] }] } } }],
  };
}

function issuesOf(d: unknown) {
  const r = validateDoc(d);
  return r.ok ? [] : r.issues;
}
const msgAt = (d: unknown, path: string) => issuesOf(d).filter((i) => i.path === path).map((i) => i.message).join(' | ');
const nodeOf = (d: any, id: string) => d.nodes.find((n: any) => n.id === id);
const SKIN_AT = 2;

describe('validateDoc model.retarget with a model source', () => {
  it('accepts it; the club drawn in both passes may hang from the flat-only source (pose only in the textured pass)', () => {
    expect(issuesOf(giantDoc())).toEqual([]);
    // without a target in the textured pass the flat-only giant is absent there: the club reference fails
    const d = T(giantDoc());
    d.nodes.splice(SKIN_AT, 1);
    expect(msgAt(d, 'nodes[1].parent')).toMatch(/parent "giant" is not drawn in the textured pass/);
  });

  it('requires sourceMap for a model source and rejects it for a mannequin source', () => {
    const d = T(giantDoc());
    delete nodeOf(d, 'skin').model.retarget.sourceMap;
    expect(msgAt(d, `nodes[${SKIN_AT}].model.retarget.sourceMap`)).toMatch(/source "giant" is a model node: sourceMap .* is required/);
    const e = T(giantDoc());
    nodeOf(e, 'skin').model.retarget.sourceMap = 'mixamo';
    expect(msgAt(e, `nodes[${SKIN_AT}].model.retarget.sourceMap`)).toMatch(/sourceMap must be walker \(models\/walker.glb\), ue or kaykit; got "mixamo"/);
    const f = T(giantDoc());
    nodeOf(f, 'skin').model.retarget.source = 'hero';
    expect(msgAt(f, `nodes[${SKIN_AT}].model.retarget.sourceMap`)).toMatch(/sourceMap is only for a model source; "hero" is a jointed mannequin id prefix/);
  });

  it('rejects a non-model node, itself, a retargeted source (chain), attach, and a source not placed in the world', () => {
    const sp = `nodes[${SKIN_AT}].model.retarget.source`;
    // a non-model node id is read as a mannequin prefix (club.root, ... missing)
    const a = T(giantDoc());
    nodeOf(a, 'skin').model.retarget.source = 'club';
    delete nodeOf(a, 'skin').model.retarget.sourceMap;
    expect(msgAt(a, sp)).toMatch(/source "club" is not a jointed mannequin: missing nodes "club.root"/);
    const b = T(giantDoc());
    nodeOf(b, 'skin').model.retarget.source = 'skin';
    expect(msgAt(b, sp)).toMatch(/source "skin" is the model itself/);
    // chain: skin2 retargets from skin, which retargets from giant
    const c = T(giantDoc());
    c.nodes.push({ ...T(nodeOf(c, 'skin')), id: 'skin2', model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'skin', map: 'ue', sourceMap: 'ue' } } });
    expect(msgAt(c, 'nodes[3].model.retarget.source')).toMatch(/source "skin" is itself a retargeted model/);
    const d = T(giantDoc());
    nodeOf(d, 'skin').model.retarget.attach = true;
    expect(msgAt(d, `nodes[${SKIN_AT}].model.retarget.attach`)).toMatch(/attach is not supported with a model source \("giant"\)/);
    const e = T(giantDoc());
    e.nodes.push({ id: 'base', shape: 'box', color: GREY, position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] });
    nodeOf(e, 'giant').parent = 'base';
    expect(msgAt(e, sp)).toMatch(/source "giant" has a parent; a model source must be placed in the world/);
    const f = T(giantDoc());
    nodeOf(f, 'giant').tracks.parent = [{ t: 1, v: null }];
    expect(msgAt(f, sp)).toMatch(/source "giant" has tracks.parent/);
    const g = T(giantDoc());
    nodeOf(g, 'giant').model.fit = 'stretch';
    nodeOf(g, 'giant').tracks.size = [{ t: 0, v: [1.6, 3.2, 1] }, { t: 1, v: [1.6, 3.4, 1] }];
    expect(msgAt(g, sp)).toMatch(/fit "stretch"; a model source must use fit "contain".*size track/);
  });

  it('keeps the retarget placement rules and the no-hanging rule on the target', () => {
    const d = T(giantDoc());
    nodeOf(d, 'skin').position = [1, 0, 0];
    nodeOf(d, 'club').parent = 'skin';
    nodeOf(d, 'club').look = { show: 'textured' };
    const all = issuesOf(d).map((i) => `${i.path}: ${i.message}`).join('\n');
    expect(all).toMatch(/nodes\[2\]\.position: position must be \[0, 0, 0\] with model.retarget/);
    expect(all).toMatch(/nodes\[1\]\.parent: "skin" is a retargeted model/);
  });
});

describe('validateDoc model.retarget review fixes', () => {
  it('a mannequin prefix that is also the id of a non-model node (a group box "hero") stays a mannequin source', () => {
    const m = createMannequin({ id: 'hero', color: GREY, height: 1.78, limbs: 'jointed' });
    for (const n of m.nodes) n.look = { show: 'flat' };
    const d: any = T(giantDoc());
    d.nodes.push({ id: 'hero', shape: 'box', color: GREY, visible: false, position: [0, 0, 0], rotation: [0, 0, 0], size: [0.1, 0.1, 0.1] }, ...m.nodes);
    d.nodes.push({ ...T(nodeOf(d, 'skin')), id: 'skin2', model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'hero', map: 'ue' } } });
    expect(issuesOf(d)).toEqual([]);
  });

  it('one sourceMap per model source', () => {
    const d: any = T(giantDoc());
    d.nodes.push({ ...T(nodeOf(d, 'skin')), id: 'skin2', model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'giant', map: 'ue', sourceMap: 'ue' } } });
    expect(msgAt(d, 'nodes[3].model.retarget.sourceMap')).toMatch(/sourceMap "ue" differs from "walker" of "skin" for the same source "giant"/);
    nodeOf(d, 'skin2').model.retarget.sourceMap = 'walker';
    expect(issuesOf(d)).toEqual([]);
  });
});
