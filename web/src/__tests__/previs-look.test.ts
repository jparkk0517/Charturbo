import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateDoc } from '../previs/validate';

const cam = () => ({
  position: [{ t: 0, v: [0, 1, 5] }],
  target: { track: [{ t: 0, v: [0, 1, 0] }] },
});
const node = (id: string, extra: any = {}) => ({
  id, shape: 'box', color: [0.2, 0.4, 0.6], position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], ...extra,
});
function base(): any {
  return {
    version: 1, fps: 30, size: { width: 1280, height: 720 }, background: [0.5, 0.5, 0.5],
    roles: [], nodes: [node('a'), node('b')],
    shots: [{ id: 's1', start: 0, end: 2, camera: cam() }],
  };
}
const issues = (doc: unknown) => {
  const r = validateDoc(doc);
  return r.ok ? [] : r.issues;
};
const msgAt = (doc: unknown, path: string) => issues(doc).filter((i) => i.path === path).map((i) => i.message).join(' | ');
const withLight = (l: unknown) => ({ ...base(), lighting: l });
const withLook = (look: unknown, extra: any = {}) => {
  const d = base();
  d.nodes[0] = node('a', { look, ...extra });
  return d;
};

describe('lighting', () => {
  it('accepts full valid lighting and bounds', () => {
    const l = {
      key: { dir: [0.1, 1, 0], intensity: 4, shadows: false },
      env: { sky: [0, 0, 1], ground: [1, 1, 1], intensity: 16 },
      rim: Array.from({ length: 8 }, () => ({ position: [1, 2, 3], color: [1, 0, 0], intensity: 0, range: 0.5 })),
      exposure: 0,
      toneMapping: 'reinhard',
    };
    expect(validateDoc(withLight(l)).ok).toBe(true);
    expect(validateDoc(withLight({})).ok).toBe(true);
  });
  it('rejects non-object and unknown keys at every level', () => {
    expect(msgAt(withLight(3), 'lighting')).toContain('lighting must be an object');
    expect(msgAt(withLight({ foo: 1 }), 'lighting.foo')).toContain('unknown lighting key "foo"');
    expect(msgAt(withLight({ key: { foo: 1 } }), 'lighting.key.foo')).toContain('unknown lighting.key key "foo"');
    expect(msgAt(withLight({ env: { foo: 1 } }), 'lighting.env.foo')).toContain('unknown lighting.env key "foo"');
    expect(msgAt(withLight({ rim: [{ position: [0, 0, 0], intensity: 1, foo: 1 }] }), 'lighting.rim[0].foo')).toContain('unknown rim light key "foo"');
  });
  it('key rules', () => {
    expect(msgAt(withLight({ key: { dir: [0, 0, 0] } }), 'lighting.key.dir')).toContain('must not be the zero vector');
    expect(msgAt(withLight({ key: { dir: [1, 2] } }), 'lighting.key.dir')).toContain('3 finite numbers');
    expect(msgAt(withLight({ key: { dir: [1, NaN, 0] } }), 'lighting.key.dir')).toContain('3 finite numbers');
    expect(msgAt(withLight({ key: { intensity: 4.1 } }), 'lighting.key.intensity')).toContain('in 0..4');
    expect(msgAt(withLight({ key: { intensity: -1 } }), 'lighting.key.intensity')).toContain('in 0..4');
    expect(msgAt(withLight({ key: { shadows: 'yes' } }), 'lighting.key.shadows')).toContain('true or false');
  });
  it('env rules', () => {
    expect(msgAt(withLight({ env: { sky: [2, 0, 0] } }), 'lighting.env.sky')).toContain('0..1');
    expect(msgAt(withLight({ env: { ground: [0, 0] } }), 'lighting.env.ground')).toContain('0..1');
    expect(msgAt(withLight({ env: { intensity: 16.5 } }), 'lighting.env.intensity')).toContain('in 0..16');
  });
  it('rim rules', () => {
    const r = { position: [0, 0, 0], intensity: 1 };
    expect(msgAt(withLight({ rim: Array.from({ length: 9 }, () => r) }), 'lighting.rim')).toContain('at most 8');
    expect(msgAt(withLight({ rim: 'x' }), 'lighting.rim')).toContain('must be an array');
    expect(msgAt(withLight({ rim: [{ intensity: 1 }] }), 'lighting.rim[0].position')).toContain('requires position');
    expect(msgAt(withLight({ rim: [{ position: [0, 0, 0] }] }), 'lighting.rim[0].intensity')).toContain('requires intensity');
    expect(msgAt(withLight({ rim: [{ ...r, intensity: -1 }] }), 'lighting.rim[0].intensity')).toContain('>= 0');
    expect(msgAt(withLight({ rim: [{ ...r, range: 0 }] }), 'lighting.rim[0].range')).toContain('> 0');
    expect(msgAt(withLight({ rim: [{ ...r, color: [0, 0, 2] }] }), 'lighting.rim[0].color')).toContain('0..1');
    // Engine limits (intensity x worldScale^2 <= 1e6, range x worldScale >= 0.01), default worldScale 10
    expect(msgAt(withLight({ rim: [{ ...r, intensity: 10_000 }] }), 'lighting.rim[0].intensity')).toBe('');
    expect(msgAt(withLight({ rim: [{ ...r, intensity: 10_001 }] }), 'lighting.rim[0].intensity')).toContain('worldScale 10 intensity must be <= 10000');
    expect(msgAt(withLight({ rim: [{ ...r, range: 0.001 }] }), 'lighting.rim[0].range')).toBe('');
    expect(msgAt(withLight({ rim: [{ ...r, range: 0.0009 }] }), 'lighting.rim[0].range')).toContain('worldScale 10 range must be >= 0.001 m');
    // ... and they follow doc.worldScale
    expect(msgAt({ ...withLight({ rim: [{ ...r, intensity: 10_001 }] }), worldScale: 1 }, 'lighting.rim[0].intensity')).toBe('');
    expect(msgAt({ ...withLight({ rim: [{ ...r, intensity: 11 }] }), worldScale: 1000 }, 'lighting.rim[0].intensity')).toContain('worldScale 1000 intensity must be <= 1');
    expect(msgAt({ ...withLight({ rim: [{ ...r, range: 0.5 }] }), worldScale: 0.01 }, 'lighting.rim[0].range')).toContain('worldScale 0.01 range must be >= 1 m');
    expect(msgAt(withLight({ rim: [{ ...r, position: [0, 0] }] }), 'lighting.rim[0].position')).toContain('3 finite numbers');
  });
  it('exposure and toneMapping', () => {
    expect(msgAt(withLight({ exposure: 17 }), 'lighting.exposure')).toContain('in 0..16');
    expect(msgAt(withLight({ exposure: -0.1 }), 'lighting.exposure')).toContain('in 0..16');
    expect(msgAt(withLight({ toneMapping: 'filmic' }), 'lighting.toneMapping')).toContain('aces, reinhard or none');
    for (const t of ['aces', 'reinhard', 'none']) expect(validateDoc(withLight({ toneMapping: t })).ok).toBe(true);
  });
});

describe('node look', () => {
  it('accepts valid look', () => {
    expect(validateDoc(withLook({ color: [1, 0, 0], roughness: 0, metallic: 1, show: 'textured' })).ok).toBe(true);
    expect(validateDoc(withLook({})).ok).toBe(true);
  });
  it('rejects bad look', () => {
    expect(msgAt(withLook(5), 'nodes[0].look')).toContain('look must be an object');
    expect(msgAt(withLook({ foo: 1 }), 'nodes[0].look.foo')).toContain('unknown look key "foo"');
    expect(msgAt(withLook({ color: [1, 2, 0] }), 'nodes[0].look.color')).toContain('0..1');
    expect(msgAt(withLook({ roughness: 1.1 }), 'nodes[0].look.roughness')).toContain('0..1');
    expect(msgAt(withLook({ metallic: -0.1 }), 'nodes[0].look.metallic')).toContain('0..1');
    expect(msgAt(withLook({ show: 'x' }), 'nodes[0].look.show')).toContain('both, flat or textured');
  });
  it('color / roughness / metallic are errors on model nodes; show is fine', () => {
    const m = { shape: 'model', model: { src: 'a.glb' } };
    for (const k of ['color', 'roughness', 'metallic']) {
      const v = k === 'color' ? [1, 0, 0] : 0.5;
      expect(msgAt(withLook({ [k]: v }, m), `nodes[0].look.${k}`)).toContain('model nodes keep their own materials in the textured pass');
    }
    expect(validateDoc(withLook({ show: 'both' }, m)).ok).toBe(true);
  });
});

describe('look membership', () => {
  const pair = (parentShow: string | undefined, childShow: string | undefined) => {
    const d = base();
    d.nodes = [
      node('p', parentShow ? { look: { show: parentShow } } : {}),
      node('c', { parent: 'p', ...(childShow ? { look: { show: childShow } } : {}) }),
    ];
    return d;
  };
  it('accepts consistent combos', () => {
    expect(validateDoc(pair(undefined, undefined)).ok).toBe(true);
    expect(validateDoc(pair('textured', 'textured')).ok).toBe(true);
    expect(validateDoc(pair('flat', 'flat')).ok).toBe(true);
    expect(validateDoc(pair('both', 'textured')).ok).toBe(true);
    expect(validateDoc(pair('both', 'flat')).ok).toBe(true);
  });
  it('rejects child in a pass the parent is not', () => {
    const m1 = msgAt(pair('flat', 'textured'), 'nodes[1].parent');
    expect(m1).toContain('look.show "textured": parent "p" is not drawn in the textured pass');
    expect(msgAt(pair('textured', 'flat'), 'nodes[1].parent')).toContain('look.show "flat": parent "p" is not drawn in the flat pass');
    // child 'both' needs the parent in both passes
    expect(msgAt(pair('flat', undefined), 'nodes[1].parent')).toContain('look.show "both": parent "p" is not drawn in the textured pass');
    expect(msgAt(pair('textured', 'both'), 'nodes[1].parent')).toContain('is not drawn in the flat pass');
  });
  it('checks tracks.parent nodes (also with joint)', () => {
    const d = base();
    d.nodes = [
      node('h', { shape: 'model', model: { src: 'a.glb' }, look: { show: 'flat' } }),
      node('p', { look: { show: 'textured' } }),
      node('c', {
        look: { show: 'textured' },
        tracks: { parent: [{ t: 0, v: { node: 'p' } }, { t: 1, v: { node: 'h', joint: 'hand' } }, { t: 2, v: null }] },
      }),
    ];
    const is = issues(d);
    expect(is.filter((i) => i.path === 'nodes[2].tracks.parent[0].v.node')).toHaveLength(0);
    expect(msgAt(d, 'nodes[2].tracks.parent[1].v.node')).toContain('look.show "textured": tracks.parent node "h" is not drawn in the textured pass');
  });
  it('camera follow needs look.show both', () => {
    const d = base();
    d.nodes[0] = node('a', { look: { show: 'textured' } });
    d.shots[0].camera.target = { follow: 'a' };
    expect(msgAt(d, 'shots[0].camera.target.follow')).toContain('must have look.show "both"');
    d.nodes[0] = node('a', { look: { show: 'both' } });
    expect(validateDoc(d).ok).toBe(true);
  });
});

describe('examples', () => {
  const dir = fileURLToPath(new URL('../../previs/examples/', import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    it(`validates ${f}`, () => {
      const r = validateDoc(JSON.parse(readFileSync(dir + f, 'utf8')));
      expect(r.ok ? [] : r.issues).toEqual([]);
    });
  }
});
