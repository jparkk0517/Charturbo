import { describe, expect, it } from 'vitest';
import {
  clipWeightsAt,
  docDuration,
  evalTrack,
  evaluateFrame,
  frameCount,
  worldPosition,
} from '../previs/evaluate';
import type { Easing, PrevisModelAnimation, PrevisDoc, PrevisNode, Shot, Track, Vec3 } from '../previs/types';

const close = (a: number[], b: number[]) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
};

const node = (id: string, extra: Partial<PrevisNode> = {}): PrevisNode => ({
  id,
  shape: 'box',
  color: [1, 0, 0],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  ...extra,
});

const shot = (id: string, start: number, end: number, extra: Partial<Shot['camera']> = {}): Shot => ({
  id,
  start,
  end,
  camera: { position: [{ t: 0, v: [0, 0, 10] }], target: { track: [{ t: 0, v: [0, 0, 0] }] }, ...extra },
});

const doc = (nodes: PrevisNode[], shots: Shot[], fps = 24): PrevisDoc => ({
  version: 1,
  fps,
  size: { width: 640, height: 360 },
  background: [0, 0, 0],
  roles: [],
  nodes,
  shots,
});

describe('evalTrack', () => {
  const mk = (ease?: Easing): Track<number> => [
    { t: 0, v: 0, ease },
    { t: 2, v: 10 },
  ];

  it('rest for empty/undefined', () => {
    expect(evalTrack(undefined, 1, 7)).toBe(7);
    expect(evalTrack([], 1, 7)).toBe(7);
    expect(evalTrack<Vec3>(undefined, 1, [1, 2, 3])).toEqual([1, 2, 3]);
  });

  it('holds before first and after last', () => {
    const tr = mk();
    expect(evalTrack(tr, -5, 99)).toBe(0);
    expect(evalTrack(tr, 2, 99)).toBe(10);
    expect(evalTrack(tr, 50, 99)).toBe(10);
  });

  it('linear endpoints and midpoint', () => {
    expect(evalTrack(mk('linear'), 0, 0)).toBe(0);
    expect(evalTrack(mk(), 1, 0)).toBe(5);
    expect(evalTrack(mk(), 2, 0)).toBe(10);
  });

  it('ease-in is u^2', () => {
    expect(evalTrack(mk('ease-in'), 1, 0)).toBeCloseTo(2.5);
  });

  it('ease-out is 1-(1-u)^2', () => {
    expect(evalTrack(mk('ease-out'), 1, 0)).toBeCloseTo(7.5);
  });

  it('ease-in-out is smoothstep: 0.5 at mid, slower at the ends', () => {
    expect(evalTrack(mk('ease-in-out'), 1, 0)).toBeCloseTo(5);
    // u = 0.25 -> 0.0625 * 2.5 = 0.15625 -> 1.5625
    expect(evalTrack(mk('ease-in-out'), 0.5, 0)).toBeCloseTo(1.5625);
  });

  it('step holds until next key', () => {
    const tr = mk('step');
    expect(evalTrack(tr, 1.999, 0)).toBe(0);
    expect(evalTrack(tr, 2, 0)).toBe(10);
  });

  it('per-key ease applies to the segment starting at that key', () => {
    const tr: Track<number> = [
      { t: 0, v: 0, ease: 'step' },
      { t: 1, v: 10 },
      { t: 2, v: 20 },
    ];
    expect(evalTrack(tr, 0.5, 0)).toBe(0);
    expect(evalTrack(tr, 1.5, 0)).toBe(15);
  });

  it('boolean always steps', () => {
    const tr: Track<boolean> = [
      { t: 0, v: false, ease: 'linear' },
      { t: 1, v: true },
    ];
    expect(evalTrack(tr, 0.99, true)).toBe(false);
    expect(evalTrack(tr, 1, false)).toBe(true);
  });

  it('Vec3 lerps per component', () => {
    const tr: Track<Vec3> = [
      { t: 0, v: [0, 10, -4] },
      { t: 4, v: [4, 20, 4] },
    ];
    close(evalTrack(tr, 1, [0, 0, 0]), [1, 12.5, -2]);
  });

  it('does not alias the keyframe arrays', () => {
    const tr: Track<Vec3> = [{ t: 0, v: [1, 2, 3] }];
    const v = evalTrack(tr, 0, [0, 0, 0]);
    v[0] = 99;
    expect(tr[0].v[0]).toBe(1);
  });
});

describe('frameCount / docDuration', () => {
  it('duration is max shot end; frames = round(duration*fps)', () => {
    const d = doc([], [shot('a', 0, 1.5), shot('b', 1.5, 4)], 24);
    expect(docDuration(d)).toBe(4);
    expect(frameCount(d)).toBe(96);
    expect(frameCount(doc([], [shot('a', 0, 1.01)], 30))).toBe(30);
  });
});

describe('evaluateFrame', () => {
  const a = shot('a', 0, 2, { position: [{ t: 0, v: [0, 0, 1] }] });
  const b = shot('b', 2, 4, { position: [{ t: 0, v: [0, 0, 2] }] });
  const d = doc([node('n')], [a, b]);

  it('cuts at the shot boundary', () => {
    expect(evaluateFrame(d, 1.999).shotId).toBe('a');
    expect(evaluateFrame(d, 2).shotId).toBe('b');
    expect(evaluateFrame(d, 2).camera.eye).toEqual([0, 0, 2]);
  });

  it('clamps time >= duration to last shot and < 0 to first', () => {
    expect(evaluateFrame(d, 4).shotId).toBe('b');
    expect(evaluateFrame(d, 100).shotId).toBe('b');
    expect(evaluateFrame(d, -1).shotId).toBe('a');
  });

  it('nodes use rest values without tracks and tracks when present', () => {
    const dd = doc(
      [
        node('r', { position: [1, 2, 3], visible: false }),
        node('m', {
          tracks: {
            position: [
              { t: 0, v: [0, 0, 0] },
              { t: 2, v: [2, 0, 0] },
            ],
            visible: [
              { t: 0, v: false },
              { t: 1, v: true },
            ],
          },
        }),
      ],
      [a, b],
    );
    const f = evaluateFrame(dd, 1);
    expect(f.nodes.r.position).toEqual([1, 2, 3]);
    expect(f.nodes.r.visible).toBe(false);
    expect(f.nodes.m.position).toEqual([1, 0, 0]);
    expect(f.nodes.m.visible).toBe(true);
    expect(evaluateFrame(dd, 0.5).nodes.m.visible).toBe(false);
  });

  it('fov defaults to 45 and follows its track', () => {
    expect(evaluateFrame(d, 0).camera.fovDeg).toBe(45);
    const dd = doc(
      [],
      [
        shot('f', 0, 2, {
          fov: [
            { t: 0, v: 30 },
            { t: 2, v: 50 },
          ],
        }),
      ],
    );
    expect(evaluateFrame(dd, 1).camera.fovDeg).toBeCloseTo(40);
  });

  it('up defaults to [0, 1, 0] and interpolates (not normalized)', () => {
    expect(evaluateFrame(d, 0).camera.up).toEqual([0, 1, 0]);
    const dd = doc(
      [],
      [
        shot('u', 0, 2, {
          up: [
            { t: 0, v: [0, 1, 0] },
            { t: 2, v: [0, 0, -1] },
          ],
        }),
      ],
    );
    expect(evaluateFrame(dd, 1).camera.up).toEqual([0, 0.5, -0.5]);
    expect(evaluateFrame(dd, 5).camera.up).toEqual([0, 0, -1]);
  });

  it('roll defaults to 0 and interpolates (radians)', () => {
    expect(evaluateFrame(d, 0).camera.roll).toBe(0);
    const dd = doc(
      [],
      [
        shot('r', 0, 2, {
          roll: [
            { t: 0, v: 0 },
            { t: 2, v: 1 },
          ],
        }),
      ],
    );
    expect(evaluateFrame(dd, 1).camera.roll).toBeCloseTo(0.5);
    expect(evaluateFrame(dd, 5).camera.roll).toBe(1);
    const ss = doc([], [shot('r', 0, 2, { roll: [{ t: 0, v: 0, ease: 'step' }, { t: 1, v: 0.7 }] })]);
    expect(evaluateFrame(ss, 0.9).camera.roll).toBe(0);
    expect(evaluateFrame(ss, 1.5).camera.roll).toBe(0.7);
  });

  it('target from track', () => {
    const dd = doc(
      [],
      [
        shot('t', 0, 2, {
          target: {
            track: [
              { t: 0, v: [0, 0, 0] },
              { t: 2, v: [4, 0, 0] },
            ],
          },
        }),
      ],
    );
    close(evaluateFrame(dd, 1).camera.target, [2, 0, 0]);
  });

  it('follow adds a world-axes offset to the node position at time', () => {
    const dd = doc(
      [
        node('hero', {
          rotation: [0, Math.PI / 2, 0],
          tracks: {
            position: [
              { t: 0, v: [0, 0, 0] },
              { t: 2, v: [4, 0, 0] },
            ],
          },
        }),
      ],
      [shot('s', 0, 2, { target: { follow: 'hero', offset: [0, 1.5, 0] } })],
    );
    close(evaluateFrame(dd, 1).camera.target, [2, 1.5, 0]);
  });

  it('follow of a child under a rotating parent uses its world position', () => {
    const dd = doc(
      [
        node('pivot', {
          tracks: {
            rotation: [
              { t: 0, v: [0, 0, 0] },
              { t: 2, v: [0, Math.PI, 0] },
            ],
          },
        }),
        node('child', { parent: 'pivot', position: [2, 0, 0] }),
      ],
      [shot('s', 0, 2, { target: { follow: 'child', offset: [0, 0, 1] } })],
    );
    close(evaluateFrame(dd, 0).camera.target, [2, 0, 1]);
    // Ry(90deg) maps +x to -z.
    close(evaluateFrame(dd, 1).camera.target, [0, 0, -2 + 1]);
    close(evaluateFrame(dd, 2).camera.target, [-2, 0, 1]);
  });

  it('throws a clear error for a missing follow target', () => {
    const dd = doc([node('n')], [shot('s', 0, 1, { target: { follow: 'ghost' } })]);
    expect(() => evaluateFrame(dd, 0)).toThrow(/ghost/);
  });
});

describe('worldPosition (engine convention)', () => {
  it('parent size does not affect the child; parent rotation rotates and parent translates', () => {
    const dd = doc(
      [
        node('p', { position: [1, 0, 0], size: [2, 3, 4], rotation: [0, 0, Math.PI / 2] }),
        node('c', { parent: 'p', position: [1, 1, 1] }),
      ],
      [shot('s', 0, 1)],
    );
    const f = evaluateFrame(dd, 0);
    // size ignored; Rz(90): (x,y)->(-y,x) => (-1,1,1); + (1,0,0)
    close(worldPosition(dd, f.nodes, 'c'), [0, 1, 1]);
    close(worldPosition(dd, f.nodes, 'p'), [1, 0, 0]);
  });

  it('Euler order YXZ: Rz applied first, then Rx, then Ry', () => {
    const dd = doc(
      [
        node('p', { rotation: [Math.PI / 2, Math.PI / 2, Math.PI / 2] }),
        node('c', { parent: 'p', position: [1, 0, 0] }),
      ],
      [shot('s', 0, 1)],
    );
    const f = evaluateFrame(dd, 0);
    // (1,0,0) -Rz90-> (0,1,0) -Rx90-> (0,0,1) -Ry90-> (1,0,0)
    close(worldPosition(dd, f.nodes, 'c'), [1, 0, 0]);
  });

  it('composes a multi-level chain', () => {
    const dd = doc(
      [
        node('a', { position: [10, 0, 0] }),
        node('b', { parent: 'a', position: [0, 5, 0], rotation: [0, Math.PI / 2, 0] }),
        node('c', { parent: 'b', position: [1, 0, 0] }),
      ],
      [shot('s', 0, 1)],
    );
    const f = evaluateFrame(dd, 0);
    // c in b: Ry90 (1,0,0)->(0,0,-1); +b(0,5,0) -> (0,5,-1); +a -> (10,5,-1)
    close(worldPosition(dd, f.nodes, 'c'), [10, 5, -1]);
  });
});

describe('clipTime', () => {
  const mn = (animation?: PrevisModelAnimation | PrevisModelAnimation[]) =>
    node('m', { shape: 'model', model: { src: 'x.glb', ...(animation ? { animation } : {}) } });
  const at = (n: PrevisNode, t: number) => evaluateFrame(doc([n], [shot('s', 0, 10)]), t).nodes.m;

  it('absent for non-model and model without animation', () => {
    expect('clipTime' in at(node('m'), 1)).toBe(false);
    expect('clipTime' in at(mn(), 1)).toBe(false);
  });

  it('defaults: start 0, speed 1', () => {
    expect(at(mn({ clip: 0 }), 2.5).clipTime).toBeCloseTo(2.5, 9);
  });

  it('before, at and after start with speed', () => {
    const n = mn({ clip: 'walk', start: 2, speed: 1.5 });
    expect(at(n, 1).clipTime).toBe(0);
    expect(at(n, 2).clipTime).toBe(0);
    expect(at(n, 4).clipTime).toBeCloseTo(3, 9);
  });
});

describe('clips / clipWeightsAt', () => {
  const mn = (animation?: PrevisModelAnimation | PrevisModelAnimation[]) =>
    node('m', { shape: 'model', model: { src: 'x.glb', ...(animation ? { animation } : {}) } });
  const at = (n: PrevisNode, t: number) => evaluateFrame(doc([n], [shot('s', 0, 10)]), t).nodes.m;

  it('absent for non-model and model without animation', () => {
    expect('clips' in at(node('m'), 1)).toBe(false);
    expect('clips' in at(mn(), 1)).toBe(false);
  });

  it('object form: clips mirror clipTime', () => {
    const n = mn({ clip: 'walk', start: 2, speed: 1.5 });
    expect(at(n, 1).clips).toEqual([{ segment: 0, time: 0, weight: 1 }]);
    expect(at(n, 4).clips).toEqual([{ segment: 0, time: 3, weight: 1 }]);
    expect(at(n, 4).clipTime).toBe(3);
    expect(at(mn({ clip: 0 }), 2.5).clips).toEqual([{ segment: 0, time: 2.5, weight: 1 }]);
  });

  it('single-element array: clips set, no clipTime', () => {
    const s = at(mn([{ clip: 0 }]), 2);
    expect(s.clips).toEqual([{ segment: 0, time: 2, weight: 1 }]);
    expect('clipTime' in s).toBe(false);
  });

  const segs: PrevisModelAnimation[] = [
    { clip: 'a', start: 1, speed: 2 },
    { clip: 'b', start: 4 },
    { clip: 'c', start: 8, speed: 0.5 },
  ];

  it('array: before first start holds segment 0 at time 0', () => {
    const s = at(mn(segs), 0.5);
    expect(s.clips).toEqual([{ segment: 0, time: 0, weight: 1 }]);
    expect('clipTime' in s).toBe(false);
  });

  it('array: inside segments and exact boundaries (hard cut)', () => {
    expect(at(mn(segs), 1).clips).toEqual([{ segment: 0, time: 0, weight: 1 }]);
    expect(at(mn(segs), 3).clips).toEqual([{ segment: 0, time: 4, weight: 1 }]);
    expect(at(mn(segs), 4).clips).toEqual([{ segment: 1, time: 0, weight: 1 }]);
    expect(at(mn(segs), 6).clips).toEqual([{ segment: 1, time: 2, weight: 1 }]);
    expect(at(mn(segs), 8).clips).toEqual([{ segment: 2, time: 0, weight: 1 }]);
    expect(at(mn(segs), 10).clips).toEqual([{ segment: 2, time: 1, weight: 1 }]);
  });

  it('array: mid-blend weights; previous segment keeps advancing', () => {
    const a: PrevisModelAnimation[] = [{ clip: 'a' }, { clip: 'b', start: 4, blendIn: 2 }];
    const c = clipWeightsAt(a, 5);
    expect(c).toHaveLength(2);
    expect(c[0].segment).toBe(0);
    expect(c[0].time).toBeCloseTo(5, 9);
    expect(c[0].weight).toBeCloseTo(0.5, 9);
    expect(c[1].segment).toBe(1);
    expect(c[1].time).toBeCloseTo(1, 9);
    expect(c[1].weight).toBeCloseTo(0.5, 9);
    const q = clipWeightsAt(a, 4.5);
    expect(q[0].weight).toBeCloseTo(0.75, 9);
    expect(q[1].weight).toBeCloseTo(0.25, 9);
  });

  it('array: blend start emits only previous at weight 1; blend end emits only the new segment', () => {
    const a: PrevisModelAnimation[] = [{ clip: 'a' }, { clip: 'b', start: 4, blendIn: 2 }];
    expect(clipWeightsAt(a, 4)).toEqual([{ segment: 0, time: 4, weight: 1 }]);
    expect(clipWeightsAt(a, 6)).toEqual([{ segment: 1, time: 2, weight: 1 }]);
    expect(clipWeightsAt(a, 7)).toEqual([{ segment: 1, time: 3, weight: 1 }]);
  });

  it('array: blend with different speeds', () => {
    const a: PrevisModelAnimation[] = [{ clip: 'a', speed: 2 }, { clip: 'b', start: 3, speed: 0.5, blendIn: 1 }];
    const c = clipWeightsAt(a, 3.5);
    expect(c[0]).toEqual({ segment: 0, time: 7, weight: 0.5 });
    expect(c[1]).toEqual({ segment: 1, time: 0.25, weight: 0.5 });
    expect(c[0].weight + c[1].weight).toBeCloseTo(1, 9);
  });

  it('array: blendIn 0 or absent is a hard cut; never a weight-0 entry', () => {
    const a: PrevisModelAnimation[] = [{ clip: 'a' }, { clip: 'b', start: 2, blendIn: 0 }];
    expect(clipWeightsAt(a, 2)).toEqual([{ segment: 1, time: 0, weight: 1 }]);
    expect(clipWeightsAt(a, 1.999)).toEqual([{ segment: 0, time: 1.999, weight: 1 }]);
    for (const t of [0, 1, 2, 3, 4, 5]) {
      for (const e of clipWeightsAt([{ clip: 'a' }, { clip: 'b', start: 2, blendIn: 2 }], t)) expect(e.weight).toBeGreaterThan(0);
    }
  });

  it('array: blend of segment 2 fades from segment 1', () => {
    const a: PrevisModelAnimation[] = [{ clip: 'a' }, { clip: 'b', start: 2 }, { clip: 'c', start: 5, blendIn: 1 }];
    const c = clipWeightsAt(a, 5.25);
    expect(c.map((e) => e.segment)).toEqual([1, 2]);
    expect(c[0].time).toBeCloseTo(3.25, 9);
    expect(c[1].time).toBeCloseTo(0.25, 9);
    expect(c[1].weight).toBeCloseTo(0.25, 9);
  });
});

describe('joints', () => {
  const mn = (joints?: Record<string, { t: number; v: Vec3; ease?: 'ease-in' | 'step' }[]>) =>
    node('m', { shape: 'model', model: { src: 'x.glb' }, ...(joints ? { tracks: { joints } } : {}) });
  const at = (n: PrevisNode, t: number) => evaluateFrame(doc([n], [shot('s', 0, 10)]), t).nodes.m;

  it('a joint named "__proto__" stays an own key', () => {
    const joints = JSON.parse('{"__proto__": [{"t": 0, "v": [1, 2, 3]}]}');
    const j = at(mn(joints), 0).joints!;
    expect(Object.keys(j)).toEqual(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(j, '__proto__')?.value).toEqual([1, 2, 3]);
  });

  it('absent without tracks.joints', () => {
    expect('joints' in at(mn(), 1)).toBe(false);
  });

  it('evaluates each joint with the track machinery (lerp, ease, hold, step)', () => {
    const n = mn({
      a: [{ t: 1, v: [0, 0, 0] }, { t: 3, v: [2, 4, -2] }],
      b: [{ t: 0, v: [1, 1, 1], ease: 'step' }, { t: 2, v: [5, 5, 5] }],
      c: [{ t: 0, v: [0, 0, 0], ease: 'ease-in' }, { t: 2, v: [4, 0, 0] }],
    });
    expect(at(n, 0).joints).toEqual({ a: [0, 0, 0], b: [1, 1, 1], c: [0, 0, 0] });
    expect(at(n, 2).joints).toEqual({ a: [1, 2, -1], b: [5, 5, 5], c: [4, 0, 0] });
    expect(at(n, 1).joints!.b).toEqual([1, 1, 1]);
    expect(at(n, 1).joints!.c).toEqual([1, 0, 0]);
    expect(at(n, 9).joints).toEqual({ a: [2, 4, -2], b: [5, 5, 5], c: [4, 0, 0] });
  });
});
