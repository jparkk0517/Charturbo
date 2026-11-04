import { describe, expect, it } from 'vitest';
import { createMannequin, jointedJointIds } from '../previs/mannequin';
import type { PrevisDoc, PrevisNode } from '../previs/types';
import { validateDoc } from '../previs/validate';

const GREY: [number, number, number] = [0.5, 0.5, 0.5];

function doc(extra: (d: any) => void = () => {}): any {
  const m = createMannequin({ id: 'hero', color: GREY, height: 1.78, limbs: 'jointed' });
  for (const n of m.nodes) n.look = { show: 'flat' };
  const d: any = {
    version: 1,
    fps: 24,
    size: { width: 640, height: 360 },
    background: [0.1, 0.1, 0.1],
    roles: [],
    nodes: [
      ...m.nodes,
      {
        id: 'skin',
        shape: 'model',
        model: { src: 'models/quaternius/Superhero_Male_FullBody.gltf', retarget: { source: 'hero', map: 'ue' } },
        look: { show: 'textured' },
        color: GREY,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        size: [1, 1.8, 0.4],
      } satisfies PrevisNode,
    ],
    shots: [{ id: 's', start: 0, end: 2, camera: { position: [{ t: 0, v: [0, 1.5, 4] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
  };
  extra(d);
  return d;
}

/** Index of the model node (after the mannequin's nodes). */
const SKIN = doc().nodes.length - 1;
const skin = (d: any) => d.nodes.find((n: any) => n.id === 'skin');
const node = (d: any, id: string) => d.nodes.find((n: any) => n.id === id);
function issues(d: unknown) {
  const r = validateDoc(d);
  return r.ok ? [] : r.issues;
}
const at = (d: unknown, path: string) => issues(d).filter((i) => i.path === path).map((i) => i.message);

describe('jointedJointIds', () => {
  it('equals createMannequin(...).joints of a jointed mannequin', () => {
    expect(jointedJointIds('hero')).toEqual(createMannequin({ id: 'hero', color: GREY, limbs: 'jointed' }).joints);
  });
});

describe('validateDoc model.retarget', () => {
  it('accepts a flat-only mannequin driving a textured-only model (the pose is evaluated from the doc)', () => {
    const r = validateDoc(doc());
    expect(r.ok ? [] : r.issues).toEqual([]);
    const d = doc((x) => {
      skin(x).look = { show: 'both' };
      node(x, 'hero.root').tracks = { position: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [0, 0, 1] }] };
    });
    expect(validateDoc(d).ok).toBe(true);
    // a static (non-joint) parent and a tracks.parent switch on the mannequin root are fine
    const e = doc((x) => {
      x.nodes.push({ id: 'cart', shape: 'box', color: GREY, position: [0, 0, 2], rotation: [0, 0, 0], size: [1, 0.3, 1] });
      node(x, 'hero.root').tracks = { parent: [{ t: 1, v: { node: 'cart' } }] };
    });
    expect(issues(e)).toEqual([]);
  });

  it('checks the retarget object', () => {
    const p = `nodes[${SKIN}].model.retarget`;
    expect(at(doc((x) => (skin(x).model.retarget = 'hero')), p)[0]).toMatch(/retarget must be an object \{ source, map \}/);
    expect(at(doc((x) => (skin(x).model.retarget.map = 'mixamo')), `${p}.map`)[0]).toMatch(/map must be ue .* or kaykit/);
    expect(at(doc((x) => (skin(x).model.retarget.source = '')), `${p}.source`)[0]).toMatch(/id prefix of a jointed mannequin/);
    expect(at(doc((x) => (skin(x).model.retarget.k = 1)), `${p}.k`)[0]).toMatch(/unknown retarget key "k"/);
  });

  it('requires every pivot of a jointed mannequin', () => {
    const p = `nodes[${SKIN}].model.retarget.source`;
    expect(at(doc((x) => (skin(x).model.retarget.source = 'villain')), p)[0]).toMatch(/source "villain" is not a jointed mannequin: missing nodes "villain.root", .*"villain.footR"/);
    const d = doc((x) => (x.nodes = x.nodes.filter((n: any) => n.id !== 'hero.kneeL' && !['hero.shinL', 'hero.footL'].includes(n.id))));
    expect(issues(d).find((i) => i.path.endsWith('model.retarget.source'))?.message).toMatch(/missing nodes "hero.kneeL", "hero.footL"/);
  });

  it('requires the pivots below the root through static parents, without re-parenting', () => {
    const p = `nodes[${SKIN}].model.retarget.source`;
    const loose = doc((x) => delete node(x, 'hero.hips').parent);
    expect(at(loose, p).some((m) => /joint "hero.hips" cannot drive the model: it is not below "hero.root"/.test(m))).toBe(true);
    const re = doc((x) => (node(x, 'hero.handR').tracks = { parent: [{ t: 1, v: null }] }));
    expect(at(re, p)[0]).toMatch(/joint "hero.handR" cannot drive the model: node "hero.handR" has tracks.parent/);
  });

  it('rejects a mannequin root that hangs from a joint (static or tracks.parent)', () => {
    const p = `nodes[${SKIN}].model.retarget.source`;
    const add = (x: any) =>
      x.nodes.push({ id: 'horse', shape: 'model', model: { src: 'horse.glb' }, color: GREY, position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 2] });
    const st = doc((x) => {
      add(x);
      Object.assign(node(x, 'hero.root'), { parent: 'horse', parentJoint: 'saddle' });
    });
    expect(at(st, p)[0]).toMatch(/the mannequin root hangs from joint "saddle" of model "horse"; a retarget source must not depend on joint poses/);
    const tr = doc((x) => {
      add(x);
      node(x, 'hero.root').tracks = { parent: [{ t: 0.5, v: { node: 'horse', joint: 'saddle' } }] };
    });
    expect(at(tr, p)[0]).toMatch(/hangs from joint "saddle" of model "horse" \(tracks.parent from t=0.5\)/);
  });

  it('is exclusive with clips, joint offsets, groundLock, fit, own transform and parents', () => {
    const d = doc((x) => {
      const s = skin(x);
      s.model.animation = { clip: 'walk' };
      s.model.groundLock = true;
      s.model.fit = 'stretch';
      s.position = [0, 0.9, 0];
      s.rotation = [0, 1, 0];
      s.tracks = { joints: { Head: [{ t: 0, v: [0, 0, 0] }] }, position: [{ t: 0, v: [0, 0, 0] }], size: [{ t: 0, v: [1, 1, 1] }] };
      s.parent = 'hero.root';
    });
    const p = `nodes[${SKIN}]`;
    expect(at(d, `${p}.model.animation`)[0]).toMatch(/animation \(clips\) is not allowed with model.retarget/);
    expect(at(d, `${p}.model.groundLock`)[0]).toMatch(/groundLock is not allowed with model.retarget/);
    expect(at(d, `${p}.model.fit`)[0]).toMatch(/fit is not allowed/);
    expect(at(d, `${p}.position`)[0]).toMatch(/position must be \[0, 0, 0\] with model.retarget/);
    expect(at(d, `${p}.rotation`)[0]).toMatch(/rotation must be \[0, 0, 0\]/);
    expect(at(d, `${p}.tracks.joints`)[0]).toMatch(/tracks.joints is not allowed/);
    expect(at(d, `${p}.tracks.position`)[0]).toMatch(/tracks.position is not allowed/);
    expect(at(d, `${p}.tracks.size`)[0]).toMatch(/tracks.size is not allowed/);
    expect(at(d, `${p}.parent`)[0]).toMatch(/parent is not allowed/);
    // a visible track is fine
    const v = doc((x) => (skin(x).tracks = { visible: [{ t: 0, v: false }, { t: 1, v: true }] }));
    expect(issues(v)).toEqual([]);
  });

  it('rejects nodes hanging from, and cameras following, the retargeted model', () => {
    const d = doc((x) => {
      skin(x).look = { show: 'both' };
      x.nodes.push({ id: 'cape', shape: 'box', parent: 'skin', color: GREY, position: [0, 1, 0], rotation: [0, 0, 0], size: [0.4, 0.8, 0.02] });
      x.nodes.push({ id: 'cup', shape: 'box', color: GREY, position: [0, 1, 0], rotation: [0, 0, 0], size: [0.1, 0.1, 0.1], tracks: { parent: [{ t: 1, v: { node: 'skin', joint: 'hand_r' } }] } });
      x.shots[0].camera.target = { follow: 'skin' };
    });
    expect(at(d, `nodes[${SKIN + 1}].parent`)[0]).toMatch(/"skin" is a retargeted model .* Parent to the mannequin's pivots \(e.g. "hero.handR"\)/);
    expect(at(d, `nodes[${SKIN + 2}].tracks.parent[0].v.node`)[0]).toMatch(/"skin" is a retargeted model/);
    expect(at(d, 'shots[0].camera.target.follow')[0]).toMatch(/follow "skin" is a retargeted model .* "hero.hips"/);
  });

  it('attach: boolean, at most one attaching model per mannequin', () => {
    expect(issues(doc((x) => (skin(x).model.retarget.attach = true)))).toEqual([]);
    expect(at(doc((x) => (skin(x).model.retarget.attach = 'yes')), `nodes[${SKIN}].model.retarget.attach`)[0]).toMatch(/attach must be true or false/);
    const two = doc((x) => {
      skin(x).model.retarget.attach = true;
      x.nodes.push({ ...JSON.parse(JSON.stringify(skin(x))), id: 'skin2' });
    });
    expect(at(two, `nodes[${SKIN + 1}].model.retarget.attach`)[0]).toMatch(/models "skin" and "skin2" both attach to mannequin "hero"/);
  });

  it('the doc type accepts retarget', () => {
    const d: PrevisDoc = doc();
    expect(skin(d).model.retarget).toEqual({ source: 'hero', map: 'ue' });
  });
});
