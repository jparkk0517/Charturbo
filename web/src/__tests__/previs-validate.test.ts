import { describe, expect, it } from 'vitest';
import type { PrevisDoc } from '../previs/types';
import { colorDistance, validateDoc } from '../previs/validate';

const cam = () => ({
  position: [{ t: 0, v: [0, 1, 5] }],
  target: { track: [{ t: 0, v: [0, 1, 0] }] },
});

function base(): any {
  return {
    version: 1,
    fps: 30,
    size: { width: 1280, height: 720 },
    background: [0.5, 0.5, 0.5],
    avoidColors: [[0.9, 0.7, 0.6]],
    roles: [
      { id: 'hero', label: 'main woman', color: [0.5, 0, 1] },
      { id: 'foe', label: 'defender', color: [1, 0.88, 0] },
    ],
    nodes: [
      { id: 'a', shape: 'box', role: 'hero', color: [0.5, 0, 1], position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] },
      { id: 'b', shape: 'sphere', parent: 'a', color: [1, 0.88, 0], position: [0, 1, 0], rotation: [0, 0, 0], size: [1, 1, 1] },
    ],
    shots: [
      { id: 's1', start: 0, end: 2, camera: cam() },
      { id: 's2', start: 2, end: 4, camera: { ...cam(), target: { follow: 'a' } } },
    ],
  };
}

function issues(doc: unknown) {
  const r = validateDoc(doc);
  return r.ok ? [] : r.issues;
}
const has = (doc: unknown, path: string) => issues(doc).some((i) => i.path === path);

describe('validateDoc', () => {
  it('accepts a valid doc', () => {
    const r = validateDoc(base());
    expect(r.ok).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateDoc(null).ok).toBe(false);
    expect(validateDoc([]).ok).toBe(false);
  });

  it('version', () => {
    const d = base();
    d.version = 2;
    expect(has(d, 'version')).toBe(true);
  });

  it('fps', () => {
    for (const v of [0, 121, 29.5, '30']) {
      const d = base();
      d.fps = v;
      expect(has(d, 'fps')).toBe(true);
    }
    const d = base();
    d.fps = 120;
    expect(validateDoc(d).ok).toBe(true);
  });

  it('size', () => {
    for (const [w, h] of [[1281, 720], [8, 720], [1280, 5000], [1280, 721.5]]) {
      const d = base();
      d.size = { width: w, height: h };
      expect(issues(d).some((i) => i.path.startsWith('size.'))).toBe(true);
    }
    const d = base();
    d.size = { width: 16, height: 4096 };
    expect(validateDoc(d).ok).toBe(true);
  });

  it('camera roll: finite radians, same track rules as fov', () => {
    const ok = base();
    ok.shots[0].camera.roll = [{ t: 0, v: 0 }, { t: 1, v: -7 }];
    expect(validateDoc(ok).ok).toBe(true);
    const bad = base();
    bad.shots[0].camera.roll = [{ t: 0, v: 'x' }];
    expect(has(bad, 'shots[0].camera.roll[0].v')).toBe(true);
    const nan = base();
    nan.shots[0].camera.roll = [{ t: 0, v: NaN }];
    expect(has(nan, 'shots[0].camera.roll[0].v')).toBe(true);
    const unsorted = base();
    unsorted.shots[0].camera.roll = [{ t: 1, v: 0 }, { t: 0.5, v: 1 }];
    expect(has(unsorted, 'shots[0].camera.roll[1].t')).toBe(true);
    const empty = base();
    empty.shots[0].camera.roll = [];
    expect(has(empty, 'shots[0].camera.roll')).toBe(true);
  });

  it('camera up: finite non-zero Vec3 keys, track rules', () => {
    const ok = base();
    ok.shots[0].camera.up = [{ t: 0, v: [0, 1, 0] }, { t: 1, v: [0, 0, -1] }];
    expect(validateDoc(ok).ok).toBe(true);
    const zero = base();
    zero.shots[0].camera.up = [{ t: 0, v: [0, 0, 0] }];
    expect(has(zero, 'shots[0].camera.up[0].v')).toBe(true);
    // Opposite neighbours pass through zero; an intermediate key fixes it
    const flip = base();
    flip.shots[0].camera.up = [{ t: 0, v: [0, 1, 0] }, { t: 1, v: [0, -2, 0] }];
    expect(has(flip, 'shots[0].camera.up[1].v')).toBe(true);
    const via = base();
    via.shots[0].camera.up = [{ t: 0, v: [0, 1, 0] }, { t: 0.5, v: [0, 0, -1] }, { t: 1, v: [0, -1, 0] }];
    expect(validateDoc(via).ok).toBe(true);
    const nan = base();
    nan.shots[0].camera.up = [{ t: 0, v: [0, NaN, 0] }];
    expect(has(nan, 'shots[0].camera.up[0].v')).toBe(true);
    const short = base();
    short.shots[0].camera.up = [{ t: 0, v: [0, 1] }];
    expect(has(short, 'shots[0].camera.up[0].v')).toBe(true);
    const unsorted = base();
    unsorted.shots[0].camera.up = [{ t: 1, v: [0, 1, 0] }, { t: 0.5, v: [0, 1, 0] }];
    expect(has(unsorted, 'shots[0].camera.up[1].t')).toBe(true);
    const empty = base();
    empty.shots[0].camera.up = [];
    expect(has(empty, 'shots[0].camera.up')).toBe(true);
  });

  it('no distance or pitch caveats: 0.2 m close-up and straight-down are valid', () => {
    const d = base();
    d.shots[0].camera = { position: [{ t: 0, v: [0, 0.3, 0.2] }], target: { track: [{ t: 0, v: [0, 0.1, 0] }] } };
    d.shots[1].camera = { position: [{ t: 2, v: [0, 5, 0] }], target: { track: [{ t: 2, v: [0, 0, 0] }] } };
    expect(validateDoc(d).ok).toBe(true);
  });

  it('rejects constant camera position equal to target', () => {
    const d = base();
    d.shots[0].camera = { position: [{ t: 0, v: [1, 2, 3] }], target: { track: [{ t: 0, v: [1, 2, 3] }] } };
    expect(has(d, 'shots[0].camera')).toBe(true);
  });

  it('colors in 0..1', () => {
    const d = base();
    d.background = [0, 2, 0];
    d.nodes[0].color = [NaN, 0, 0];
    expect(has(d, 'background')).toBe(true);
    expect(has(d, 'nodes[0].color')).toBe(true);
  });

  it('node id format and uniqueness', () => {
    const d = base();
    d.nodes[1].id = 'A B';
    expect(has(d, 'nodes[1].id')).toBe(true);
    const e = base();
    e.nodes[1].id = 'a';
    expect(issues(e).some((i) => i.message.includes('duplicate node id'))).toBe(true);
  });

  it('parent exists and no cycles', () => {
    const d = base();
    d.nodes[1].parent = 'zzz';
    expect(has(d, 'nodes[1].parent')).toBe(true);
    const c = base();
    c.nodes[0].parent = 'b';
    expect(issues(c).some((i) => i.message.includes('cycle'))).toBe(true);
    const s = base();
    s.nodes[0].parent = 'a';
    expect(has(s, 'nodes[0].parent')).toBe(true);
  });

  it('role refs', () => {
    const d = base();
    d.nodes[0].role = 'nobody';
    expect(has(d, 'nodes[0].role')).toBe(true);
  });

  it('worldScale', () => {
    const d = base();
    d.worldScale = 0;
    expect(has(d, 'worldScale')).toBe(true);
    d.worldScale = 10;
    expect(validateDoc(d).ok).toBe(true);
  });

  it('track keys', () => {
    const d = base();
    d.nodes[0].tracks = { position: [{ t: 0, v: [0, 0, 0] }, { t: 0, v: [1, 0, 0] }] };
    expect(has(d, 'nodes[0].tracks.position[1].t')).toBe(true);
    d.nodes[0].tracks = { position: [] };
    expect(has(d, 'nodes[0].tracks.position')).toBe(true);
    d.nodes[0].tracks = { position: [{ t: Infinity, v: [0, 0, 0] }] };
    expect(has(d, 'nodes[0].tracks.position[0].t')).toBe(true);
    d.nodes[0].tracks = { size: [{ t: 0, v: [1, 1] }] };
    expect(has(d, 'nodes[0].tracks.size[0].v')).toBe(true);
    d.nodes[0].tracks = { visible: [{ t: 0, v: true }, { t: 1, v: false }] };
    expect(validateDoc(d).ok).toBe(true);
  });

  it('vec3 finite and length', () => {
    const d = base();
    d.nodes[0].position = [0, 0];
    d.nodes[0].size = [1, NaN, 1];
    expect(has(d, 'nodes[0].position')).toBe(true);
    expect(has(d, 'nodes[0].size')).toBe(true);
  });

  it('follow id exists', () => {
    const d = base();
    d.shots[1].camera.target = { follow: 'ghost' };
    expect(has(d, 'shots[1].camera.target.follow')).toBe(true);
  });

  it('shots non-empty', () => {
    const d = base();
    d.shots = [];
    expect(has(d, 'shots')).toBe(true);
  });

  it('shot start<end', () => {
    const d = base();
    d.shots[0].end = 0;
    expect(has(d, 'shots[0].end')).toBe(true);
  });

  it('shot gap has actionable message', () => {
    const d = base();
    d.shots = [
      { id: 'a', start: 0, end: 2, camera: cam() },
      { id: 'b', start: 2.5, end: 4, camera: cam() },
    ];
    const i = issues(d).find((x) => x.path === 'shots[1].start');
    expect(i?.message).toContain('shots must cover 0..4 without gap: shot "b" starts at 2.5 but "a" ends at 2');
  });

  it('shot overlap, unsorted, and not starting at 0', () => {
    const d = base();
    d.shots[1].start = 1;
    expect(issues(d).some((i) => i.message.includes('overlap'))).toBe(true);
    const u = base();
    u.shots = [u.shots[1], u.shots[0]];
    expect(issues(u).some((i) => i.message.includes('sorted'))).toBe(true);
    const z = base();
    z.shots[0].start = 0.5;
    expect(has(z, 'shots[0].start')).toBe(true);
  });

  it('role colors distinct', () => {
    const d = base();
    d.roles[1].color = [0.5, 0.02, 1];
    expect(has(d, 'roles[1].color')).toBe(true);
  });

  it('role color vs avoidColors', () => {
    const d = base();
    d.roles[0].color = [0.9, 0.7, 0.6];
    const i = issues(d).find((x) => x.path === 'roles[0].color');
    expect(i?.message).toContain('avoidColors[0]');
  });

  it('collects multiple issues', () => {
    const d = base();
    d.fps = 0;
    d.version = 3;
    d.nodes[0].role = 'x';
    d.shots[1].start = 3;
    const paths = issues(d).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(['fps', 'version', 'nodes[0].role', 'shots[1].start']));
  });

  it('caps issues at 50', () => {
    const d = base();
    d.nodes = Array.from({ length: 80 }, (_, i) => ({ id: `n${i}`, shape: 'cube', color: 5, position: 1, rotation: 1, size: 1 }));
    expect(issues(d).length).toBe(50);
  });

  it('result doc type', () => {
    const r = validateDoc(base());
    if (r.ok) {
      const doc: PrevisDoc = r.doc;
      expect(doc.fps).toBe(30);
    }
  });
});

describe('validateDoc model nodes', () => {
  const modelNode = (extra: any = {}): any => ({
    id: 'm', shape: 'model', model: { src: 'robot.glb' }, color: [1, 0.88, 0], position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], ...extra,
  });
  const withModel = (model?: any, shape = 'model'): any => {
    const d = base();
    const n = modelNode({ shape });
    if (model === undefined) delete n.model;
    else n.model = model;
    d.nodes.push(n);
    return d; // index 2
  };
  const P = 'nodes[2].model';

  describe('tracks.joints', () => {
    const withJoints = (joints: any, extra: any = {}): any => {
      const d = withModel({ src: 'robot.glb' });
      d.nodes[2].tracks = { joints, ...extra };
      return d;
    };
    const J = 'nodes[2].tracks.joints';
    const ok = [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [-1.2, 0, 0.5], ease: 'ease-in' }];

    it('accepts joint tracks and keeps them', () => {
      const r = validateDoc(withJoints({ leftArm: ok, hips: [{ t: 0, v: [0, 1, 0] }] }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.doc.nodes[2].tracks?.joints?.leftArm).toEqual(ok);
    });

    it('only on model nodes', () => {
      const d = base();
      d.nodes[0].tracks = { joints: { x: ok } };
      expect(has(d, 'nodes[0].tracks.joints')).toBe(true);
    });

    it('joints must be an object', () => {
      expect(has(withJoints([ok]), J)).toBe(true);
      expect(has(withJoints('x'), J)).toBe(true);
    });

    it('rejects an empty joint name', () => {
      expect(has(withJoints({ '': ok }), J)).toBe(true);
    });

    it('applies the track rules with paths like nodes[2].tracks.joints.leftArm[1].v', () => {
      expect(has(withJoints({ leftArm: [] }), `${J}.leftArm`)).toBe(true);
      expect(has(withJoints({ leftArm: 'x' }), `${J}.leftArm`)).toBe(true);
      expect(has(withJoints({ leftArm: [{ t: 0, v: [0, 0, 0] }, { t: 1, v: [1, 2] }] }), `${J}.leftArm[1].v`)).toBe(true);
      expect(has(withJoints({ leftArm: [{ t: 0, v: [0, NaN, 0] }] }), `${J}.leftArm[0].v`)).toBe(true);
      expect(has(withJoints({ leftArm: [{ t: 0, v: [0, 0, 0] }, { t: 0, v: [0, 0, 0] }] }), `${J}.leftArm[1].t`)).toBe(true);
      expect(has(withJoints({ leftArm: [{ t: 0, v: [0, 0, 0], ease: 'bounce' }] }), `${J}.leftArm[0].ease`)).toBe(true);
    });
  });

  it('accepts a valid model doc and keeps model in the result', () => {
    const model = { src: 'robot.glb', fit: 'stretch', animation: { clip: 'walk', start: 1, speed: 2, loop: 'pingpong' } };
    const r = validateDoc(withModel(model));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.nodes[2].model).toEqual(model);
    expect(validateDoc(withModel({ src: 'a.glb', animation: { clip: 0 } })).ok).toBe(true);
  });

  it('shape must be a known shape', () => {
    const d = withModel({ src: 'a.glb' }, 'cube');
    expect(has(d, 'nodes[2].shape')).toBe(true);
  });

  it('shape model requires model', () => {
    expect(has(withModel(undefined), P)).toBe(true);
  });

  it('model forbidden on other shapes', () => {
    expect(has(withModel({ src: 'a.glb' }, 'box'), P)).toBe(true);
  });

  it('model must be an object', () => {
    for (const v of ['a.glb', 5, null, []]) expect(has(withModel(v), P)).toBe(true);
  });

  it('src', () => {
    for (const v of [undefined, '', 5]) expect(has(withModel({ src: v }), `${P}.src`)).toBe(true);
  });

  it('fit', () => {
    expect(has(withModel({ src: 'a', fit: 'cover' }), `${P}.fit`)).toBe(true);
    expect(has(withModel({ src: 'a', fit: 'contain' }), `${P}.fit`)).toBe(false);
  });

  it('animation clip', () => {
    for (const v of [undefined, '', -1, 1.5, NaN, true]) {
      expect(has(withModel({ src: 'a', animation: { clip: v } }), `${P}.animation.clip`)).toBe(true);
    }
    for (const v of ['walk', 0, 3]) {
      expect(has(withModel({ src: 'a', animation: { clip: v } }), `${P}.animation.clip`)).toBe(false);
    }
  });

  it('animation start', () => {
    for (const v of ['1', Infinity, NaN]) expect(has(withModel({ src: 'a', animation: { clip: 0, start: v } }), `${P}.animation.start`)).toBe(true);
    expect(has(withModel({ src: 'a', animation: { clip: 0, start: -1 } }), `${P}.animation.start`)).toBe(false);
  });

  it('animation speed', () => {
    for (const v of [0, -1, Infinity, NaN, '2']) expect(has(withModel({ src: 'a', animation: { clip: 0, speed: v } }), `${P}.animation.speed`)).toBe(true);
    expect(has(withModel({ src: 'a', animation: { clip: 0, speed: 0.5 } }), `${P}.animation.speed`)).toBe(false);
  });

  it('animation loop', () => {
    expect(has(withModel({ src: 'a', animation: { clip: 0, loop: 'bounce' } }), `${P}.animation.loop`)).toBe(true);
    for (const v of ['repeat', 'once', 'pingpong']) expect(has(withModel({ src: 'a', animation: { clip: 0, loop: v } }), `${P}.animation.loop`)).toBe(false);
  });

  it('animation must be an object or array', () => {
    expect(has(withModel({ src: 'a', animation: 5 }), `${P}.animation`)).toBe(true);
  });

  describe('animation array / blendIn', () => {
    const A = `${P}.animation`;
    const ok = (animation: unknown) => validateDoc(withModel({ src: 'a', animation })).ok;
    const seg = (clip: string, extra: object = {}) => ({ clip, ...extra });

    it('accepts a valid array', () => {
      expect(ok([seg('a'), seg('b', { start: 2, blendIn: 0.5 }), seg('c', { start: 3 })])).toBe(true);
      expect(ok([seg('a', { start: -1 }), seg('b', { start: 0 })])).toBe(true);
      expect(ok([seg('a')])).toBe(true);
    });

    it('rejects empty array', () => {
      expect(has(withModel({ src: 'a', animation: [] }), A)).toBe(true);
    });

    it('applies per-entry field rules with indexed paths', () => {
      expect(has(withModel({ src: 'a', animation: [seg('a'), { clip: '', start: 1 }] }), `${A}[1].clip`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a', { speed: 0 })] }), `${A}[0].speed`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a', { loop: 'x' })] }), `${A}[0].loop`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b', { start: 'x' })] }), `${A}[1].start`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a'), 'walk'] }), `${A}[1]`)).toBe(true);
    });

    it('start required on entries after the first', () => {
      expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b')] }), `${A}[1].start`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b', { start: 1 }), seg('c')] }), `${A}[2].start`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b', { start: 1 })] }), `${A}[1].start`)).toBe(false);
    });

    it('starts strictly increasing (entry 0 defaults to 0)', () => {
      expect(has(withModel({ src: 'a', animation: [seg('a', { start: 2 }), seg('b', { start: 2 })] }), `${A}[1].start`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a', { start: 2 }), seg('b', { start: 1 })] }), `${A}[1].start`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b', { start: 0 })] }), `${A}[1].start`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b', { start: -1 })] }), `${A}[1].start`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a', { start: 1 }), seg('b', { start: 3 }), seg('c', { start: 2 })] }), `${A}[2].start`)).toBe(true);
    });

    it('blendIn finite >= 0', () => {
      for (const v of [-1, Infinity, NaN, '1']) {
        expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b', { start: 1, blendIn: v })] }), `${A}[1].blendIn`)).toBe(true);
      }
      expect(has(withModel({ src: 'a', animation: [seg('a'), seg('b', { start: 1, blendIn: 0 })] }), `${A}[1].blendIn`)).toBe(false);
    });

    it('blendIn must not run past the next segment start', () => {
      const anim = (b: number) => [seg('a'), seg('b', { start: 1, blendIn: b }), seg('c', { start: 2, blendIn: 0.5 })];
      expect(has(withModel({ src: 'a', animation: anim(2) }), `${A}[1].blendIn`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: anim(1) }), `${A}[1].blendIn`)).toBe(false);
      expect(ok(anim(1))).toBe(true);
      // The last segment's fade has no next segment to collide with
      expect(ok([seg('a'), seg('b', { start: 1, blendIn: 5 })])).toBe(true);
    });

    it('blendIn must be 0/absent on the first entry and on the object form', () => {
      expect(has(withModel({ src: 'a', animation: [seg('a', { blendIn: 1 })] }), `${A}[0].blendIn`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: [seg('a', { blendIn: 0 })] }), `${A}[0].blendIn`)).toBe(false);
      expect(has(withModel({ src: 'a', animation: { clip: 0, blendIn: 1 } }), `${A}.blendIn`)).toBe(true);
      expect(has(withModel({ src: 'a', animation: { clip: 0, blendIn: 0 } }), `${A}.blendIn`)).toBe(false);
      expect(has(withModel({ src: 'a', animation: { clip: 0, blendIn: -1 } }), `${A}.blendIn`)).toBe(true);
    });
  });
});

describe('parentJoint', () => {
  // nodes: a (box), b (sphere, parent a), m (model), p (box on joint "hand" of m), q (child of p)
  const withJoint = (extra: (d: any) => void = () => {}): any => {
    const d = base();
    d.nodes.push(
      { id: 'm', shape: 'model', model: { src: 'w.glb' }, color: [0, 0.6, 0.3], position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 2, 1] },
      { id: 'p', shape: 'box', parent: 'm', parentJoint: 'hand', color: [0.2, 0.2, 0.2], position: [0, 0.1, 0], rotation: [0, 0, 0], size: [0.1, 1, 0.1] },
      { id: 'q', shape: 'box', parent: 'p', color: [0.2, 0.2, 0.2], position: [0, 0.5, 0], rotation: [0, 0, 0], size: [0.1, 0.1, 0.1] },
    );
    extra(d);
    return d;
  };
  const P = 'nodes[3].parentJoint';

  it('accepts a joint of a model parent', () => {
    const r = validateDoc(withJoint());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.doc.nodes[3].parentJoint).toBe('hand');
  });

  it('must be a non-empty string', () => {
    for (const v of ['', 3, null, ['hand']]) {
      const d = withJoint((x) => (x.nodes[3].parentJoint = v));
      const hit = issues(d).find((i) => i.path === P);
      expect(hit?.message).toMatch(/^parentJoint must be a non-empty glTF node name/);
    }
  });

  it('requires a parent', () => {
    const d = withJoint((x) => delete x.nodes[3].parent);
    expect(issues(d).find((i) => i.path === P)?.message).toMatch(/^parentJoint requires "parent"/);
  });

  it('requires the parent to be a model node', () => {
    const d = withJoint((x) => (x.nodes[3].parent = 'a'));
    expect(issues(d).find((i) => i.path === P)?.message).toBe(
      'parentJoint needs a parent with shape "model"; parent "a" has shape "box". Remove "parentJoint" or parent the node to a model node',
    );
    // an unknown parent is reported on parent only
    const u = withJoint((x) => (x.nodes[3].parent = 'ghost'));
    expect(has(u, 'nodes[3].parent')).toBe(true);
    expect(has(u, P)).toBe(false);
  });

  it('the camera cannot follow a joint-attached node or its descendants', () => {
    const F = 'shots[1].camera.target.follow';
    const direct = withJoint((x) => (x.shots[1].camera.target = { follow: 'p' }));
    expect(issues(direct).find((i) => i.path === F)?.message).toBe(
      'follow "p" is attached to joint "hand" of model "m"; the camera cannot follow joint-attached nodes (their joint pose is only known when rendering). Follow "m" with an "offset", or use a target "track"',
    );
    const below = withJoint((x) => (x.shots[1].camera.target = { follow: 'q', offset: [0, 1, 0] }));
    expect(issues(below).find((i) => i.path === F)?.message).toMatch(/^follow "q" hangs from node "p", which is attached to joint "hand" of model "m"; /);
    // the model itself and unrelated nodes are fine
    expect(validateDoc(withJoint((x) => (x.shots[1].camera.target = { follow: 'm', offset: [0, 1, 0] }))).ok).toBe(true);
    expect(validateDoc(withJoint((x) => (x.shots[1].camera.target = { follow: 'b' }))).ok).toBe(true);
  });

  it('follow terminates on parent cycles', () => {
    const d = withJoint((x) => {
      x.nodes[0].parent = 'b'; // a <-> b
      x.shots[1].camera.target = { follow: 'b' };
    });
    expect(has(d, 'shots[1].camera.target.follow')).toBe(false);
    expect(issues(d).some((i) => /parent cycle/.test(i.message))).toBe(true);
  });
});

describe('shot note and markers', () => {
  const mod = (f: (x: any) => void) => {
    const x = base();
    f(x);
    return x;
  };
  it('accepts valid note and markers (unsorted, duplicates, bounds inclusive)', () => {
    const d = mod((x) => {
      x.shots[1].note = 'push-in';
      x.markers = [{ t: 4, label: 'a' }, { t: 0, label: 'b' }, { t: 4, label: 'a' }];
    });
    expect(issues(d)).toEqual([]);
  });
  it('rejects empty or non-string note', () => {
    expect(has(mod((x) => (x.shots[1].note = '')), 'shots[1].note')).toBe(true);
    expect(has(mod((x) => (x.shots[0].note = 3)), 'shots[0].note')).toBe(true);
  });
  it('rejects non-array markers', () => {
    expect(has(mod((x) => (x.markers = {})), 'markers')).toBe(true);
  });
  it('rejects bad t and label', () => {
    const d = mod((x) => {
      x.markers = [{ t: 1, label: 'ok' }, { t: -1, label: 'ok' }, { t: 4.5, label: 'ok' }, { t: NaN, label: 'ok' }, { t: 1, label: '' }];
    });
    expect(has(d, 'markers[1].t')).toBe(true);
    expect(has(d, 'markers[2].t')).toBe(true);
    expect(has(d, 'markers[3].t')).toBe(true);
    expect(has(d, 'markers[4].label')).toBe(true);
    expect(has(d, 'markers[0].t')).toBe(false);
  });
});

describe('colorDistance', () => {
  it('zero for same, large for different', () => {
    expect(colorDistance([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(colorDistance([1, 0, 0], [0, 0, 1])).toBeGreaterThan(50);
    expect(colorDistance([0, 0, 0], [1, 1, 1])).toBeCloseTo(100, 0);
  });

  it('shot ids: file-name safe, no . / .., no case-only duplicates', () => {
    const withId = (id: string) => {
      const d = base();
      d.shots[1].id = id;
      return d;
    };
    for (const id of ['..', '.', 'a/b', 'a b', 'ü']) expect(has(withId(id), 'shots[1].id')).toBe(true);
    for (const id of ['wide', 'a.b-c_1', '...']) expect(has(withId(id), 'shots[1].id')).toBe(false);
    const d = base();
    d.shots[0].id = 'wide';
    d.shots[1].id = 'Wide';
    const r = issues(d);
    expect(r.some((x) => x.path === 'shots[1].id' && /only by case/.test(x.message))).toBe(true);
  });
});
