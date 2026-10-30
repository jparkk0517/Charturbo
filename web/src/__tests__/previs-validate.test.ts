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

describe('colorDistance', () => {
  it('zero for same, large for different', () => {
    expect(colorDistance([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(colorDistance([1, 0, 0], [0, 0, 1])).toBeGreaterThan(50);
    expect(colorDistance([0, 0, 0], [1, 1, 1])).toBeCloseTo(100, 0);
  });
});
