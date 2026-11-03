import { describe, expect, it } from 'vitest';
import { evalTrack, evaluateFrame } from '../previs/evaluate';
import type { PrevisDoc, PrevisNode, Track, Vec3 } from '../previs/types';
import { validateDoc } from '../previs/validate';

const S = 'smooth' as const;
const num = (pts: Array<[number, number]>): Track<number> => pts.map(([t, v]) => ({ t, v, ease: S }));
const d = (tr: Track<number>, t: number, h = 1e-7) => (evalTrack(tr, t + h, 0) - evalTrack(tr, t - h, 0)) / (2 * h);

describe('smooth ease', () => {
  const tr = num([[0, 0], [1, 2], [3, -1], [3.5, 4], [6, 0]]);

  it('passes through keys exactly', () => {
    for (const k of tr) expect(evalTrack(tr, k.t, 0)).toBeCloseTo(k.v, 12);
  });

  it('velocity is continuous at interior keys (non-uniform spacing)', () => {
    for (const k of [tr[1], tr[2], tr[3]]) {
      const l = (evalTrack(tr, k.t, 0) - evalTrack(tr, k.t - 1e-6, 0)) / 1e-6;
      const r = (evalTrack(tr, k.t + 1e-6, 0) - evalTrack(tr, k.t, 0)) / 1e-6;
      expect(Math.abs(l - r)).toBeLessThan(1e-4 * Math.max(1, Math.abs(l)));
      const m = (tr[tr.indexOf(k) + 1].v - tr[tr.indexOf(k) - 1].v) / (tr[tr.indexOf(k) + 1].t - tr[tr.indexOf(k) - 1].t);
      expect(d(tr, k.t)).toBeCloseTo(m, 5);
    }
  });

  it('one-sided tangents at the ends', () => {
    expect(d(tr, 0 + 1e-4, 1e-5)).toBeCloseTo((2 - 0) / 1, 2);
    expect(d(tr, 6 - 1e-4, 1e-5)).toBeCloseTo((0 - 4) / 2.5, 2);
  });

  it('2-key track is cubic with chord tangents = linear', () => {
    const t2 = num([[1, 0], [3, 10]]);
    expect(evalTrack(t2, 2, 0)).toBeCloseTo(5, 12);
    expect(evalTrack(t2, 1.5, 0)).toBeCloseTo(2.5, 12);
  });

  it('Vec3 per component; boolean stays step', () => {
    const v: Track<Vec3> = [
      { t: 0, v: [0, 0, 0], ease: S },
      { t: 1, v: [1, 10, -1], ease: S },
      { t: 2, v: [0, 0, 0], ease: S },
    ];
    const m = evalTrack(v, 0.5, [0, 0, 0]);
    expect(m[1]).toBeCloseTo(m[0] * 10, 10);
    const b: Track<boolean> = [{ t: 0, v: false, ease: S }, { t: 1, v: true }];
    expect(evalTrack(b, 0.9, false)).toBe(false);
  });
});

const node = (extra: Partial<PrevisNode>): PrevisNode => ({
  id: 'n', shape: 'box', color: [1, 0, 0], position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1], ...extra,
});
const mk = (n: PrevisNode): PrevisDoc => ({
  version: 1, fps: 24, size: { width: 640, height: 360 }, background: [0, 0, 0], roles: [], nodes: [n],
  shots: [{ id: 's', start: 0, end: 10, camera: { position: [{ t: 0, v: [0, 0, 10] }], target: { track: [{ t: 0, v: [0, 0, 0] }] } } }],
} as PrevisDoc);
const rotAt = (n: PrevisNode, t: number) => evaluateFrame(mk(n), t).nodes.n.rotation;

describe('rotationPath shortest', () => {
  const yaw = (pts: Array<[number, number]>): Track<Vec3> => pts.map(([t, y]) => ({ t, v: [0, y, 0] }));

  it('3.0 -> -3.0 turns 2pi-6', () => {
    const n = node({ rotationPath: 'shortest', tracks: { rotation: yaw([[0, 3.0], [1, -3.0]]) } });
    expect(rotAt(n, 0.5)[1]).toBeCloseTo(3.0 + (2 * Math.PI - 6) / 2, 9);
    expect(rotAt(n, 0)[1]).toBeCloseTo(3.0, 12);
    const direct = node({ tracks: { rotation: yaw([[0, 3.0], [1, -3.0]]) } });
    expect(rotAt(direct, 0.5)[1]).toBeCloseTo(0, 9);
  });

  it('multi-key accumulation stays near pi', () => {
    const n = node({ rotationPath: 'shortest', tracks: { rotation: yaw([[0, 3.0], [1, -3.0], [2, 3.0]]) } });
    for (const t of [0, 0.25, 0.5, 0.75, 1, 1.5, 2]) {
      const y = rotAt(n, t)[1];
      expect(Math.abs(y - Math.PI)).toBeLessThan(0.2);
    }
  });

  it('joints tracks unwrapped', () => {
    const n = node({ rotationPath: 'shortest', tracks: { joints: { elbow: yaw([[0, 3.0], [1, -3.0]]) } } });
    const j = evaluateFrame(mk(n), 0.5).nodes.n.joints!.elbow;
    expect(j[1]).toBeCloseTo(3.0 + (2 * Math.PI - 6) / 2, 9);
  });
});

describe('validation', () => {
  const doc = (extra: any, ease: string): any => ({
    ...mk(node(extra)),
    nodes: [{ ...node(extra), tracks: { position: [{ t: 0, v: [0, 0, 0], ease }, { t: 1, v: [1, 0, 0] }], ...(extra.tracks ?? {}) } }],
  });
  const errs = (x: any) => { try { return JSON.stringify(validateDoc(x)); } catch (e) { return String(e); } };
  it('accepts smooth and rotationPath', () => {
    const r = validateDoc(doc({ rotationPath: 'shortest' }, 'smooth') as any) as any;
    expect(r.ok).toBe(true);
  });
  it('rejects bad rotationPath and lists smooth in ease message', () => {
    expect(errs(doc({ rotationPath: 'slerp' }, 'smooth'))).toMatch(/rotationPath must be direct or shortest/);
    expect(errs(doc({}, 'bogus'))).toMatch(/step, smooth/);
  });
});

describe('smooth is rejected where overshoot breaks invariants', () => {
  it('rejects smooth on size tracks and camera fov', () => {
    const doc = {
      version: 1, fps: 24, size: { width: 64, height: 36 }, background: [0, 0, 0], roles: [],
      nodes: [{ id: 'a', shape: 'box', color: [1, 0, 0], position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1],
        tracks: { size: [{ t: 0, v: [1, 1, 1], ease: 'smooth' }, { t: 1, v: [2, 2, 2] }] } }],
      shots: [{ id: 's', start: 0, end: 1, camera: { position: [{ t: 0, v: [0, 1, 5] }], target: { track: [{ t: 0, v: [0, 0, 0] }] },
        fov: [{ t: 0, v: 40, ease: 'smooth' }, { t: 1, v: 50 }] } }],
    };
    const r = validateDoc(doc);
    const issues = r.ok ? [] : r.issues.map((i) => i.path);
    expect(issues).toContain('nodes[0].tracks.size[0].ease');
    expect(issues).toContain('shots[0].camera.fov[0].ease');
  });
});
