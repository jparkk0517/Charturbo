import { describe, expect, it } from 'vitest';
import { evaluateFrame, perlin1 } from '../previs/evaluate';
import type { CameraShake, PrevisDoc } from '../previs/types';
import { validateDoc } from '../previs/validate';

const doc = (shake?: CameraShake): PrevisDoc => ({
  version: 1,
  fps: 24,
  size: { width: 64, height: 36 },
  background: [0.5, 0.5, 0.5],
  roles: [],
  nodes: [{ id: 'b', shape: 'box', color: [0.2, 0.4, 0.9], position: [0, 0, 0], rotation: [0, 0, 0], size: [1, 1, 1] }],
  shots: [
    {
      id: 's',
      start: 0,
      end: 20,
      camera: {
        position: [{ t: 0, v: [1, 2, 9] }],
        target: { track: [{ t: 0, v: [0, 1, 0] }] },
        roll: [{ t: 0, v: 0.1 }],
        ...(shake ? { shake } : {}),
      },
    },
  ],
});

const chans = (d: PrevisDoc, t: number) => {
  const c = evaluateFrame(d, t).camera;
  return [...c.eye, ...c.target, c.roll];
};
const base = chans(doc(), 0);
const off = (d: PrevisDoc, t: number) => chans(d, t).map((v, i) => v - base[i]);
const SH: CameraShake = { amp: 0.05, freq: 3.7, roll: 0.02, seed: 5 };

describe('camera shake', () => {
  it('deterministic per seed, differs across seeds', () => {
    const a = JSON.stringify(evaluateFrame(doc(SH), 1.234));
    expect(JSON.stringify(evaluateFrame(doc({ ...SH }), 1.234))).toBe(a);
    expect(JSON.stringify(evaluateFrame(doc({ ...SH, seed: 6 }), 1.234))).not.toBe(a);
  });

  it('stays within amplitude over 10k samples (and is not trivially zero)', () => {
    const d = doc(SH);
    const mx = new Array(7).fill(0);
    for (let k = 0; k < 10000; k++) {
      off(d, k * 0.0019 + 0.0003).forEach((v, i) => (mx[i] = Math.max(mx[i], Math.abs(v))));
    }
    for (let i = 0; i < 6; i++) {
      expect(mx[i]).toBeLessThanOrEqual(SH.amp + 1e-12);
      expect(mx[i]).toBeGreaterThan(SH.amp * 0.3);
    }
    expect(mx[6]).toBeLessThanOrEqual(SH.roll! + 1e-12);
    expect(mx[6]).toBeGreaterThan(SH.roll! * 0.3);
  });

  it('raw noise bound: |perlin1| <= 1 on dense sweep, 0 at lattice points', () => {
    const perm = new Uint8Array(256).map((_, i) => (i * 37 + 11) & 255);
    let mx = 0;
    for (let k = 0; k < 100000; k++) mx = Math.max(mx, Math.abs(perlin1(perm, k * 0.0037 - 5)));
    expect(mx).toBeLessThanOrEqual(1);
    for (let n = -5; n < 40; n++) expect(Math.abs(perlin1(perm, n))).toBe(0);
  });

  it('is 0 at lattice points (t * freq integer)', () => {
    const d = doc({ amp: 0.1, freq: 2, roll: 0.1, seed: 1 });
    for (const t of [0, 0.5, 1, 2.5]) for (const v of off(d, t)) expect(Math.abs(v)).toBeLessThan(1e-12);
  });

  it('continuous: no jumps between t and t + 1e-4', () => {
    const d = doc({ amp: 1, freq: 5, roll: 1, seed: 3 });
    let mx = 0;
    for (let k = 0; k < 20000; k++) {
      const a = chans(d, k * 0.001);
      const b = chans(d, k * 0.001 + 1e-4);
      a.forEach((v, i) => (mx = Math.max(mx, Math.abs(b[i] - v))));
    }
    // |d(2n)/dt| <= 2 * freq * max|dn/dx| (< 3) -> < 30 per second -> < 3e-3 per 1e-4
    expect(mx).toBeLessThan(3e-3);
  });

  it('channels differ from each other', () => {
    const d = doc({ amp: 1, freq: 3, roll: 1, seed: 0 });
    const seq: number[][] = [[], [], [], [], [], [], []];
    for (let k = 0; k < 200; k++) off(d, 0.013 + k * 0.071).forEach((v, i) => seq[i].push(v));
    for (let i = 0; i < 7; i++) {
      for (let j = i + 1; j < 7; j++) {
        const diff = seq[i].reduce((m, v, k) => Math.max(m, Math.abs(v - seq[j][k])), 0);
        expect(diff).toBeGreaterThan(0.1);
      }
    }
  });

  it('no shake (or amp 0) leaves frames unchanged; mutation-free', () => {
    const plain = JSON.stringify(evaluateFrame(doc(), 2.2));
    expect(JSON.stringify(evaluateFrame(doc({ amp: 0, freq: 3 }), 2.2))).toBe(plain);
    const d = doc(SH);
    evaluateFrame(d, 1.1);
    expect(d.shots[0].camera.position).toEqual([{ t: 0, v: [1, 2, 9] }]);
  });

  describe('validation', () => {
    const run = (shake: unknown) => validateDoc(doc(shake as CameraShake));
    const ok = (r: ReturnType<typeof validateDoc>) => r.ok;
    it('accepts valid', () => {
      expect(ok(run({ amp: 0, freq: 1 }))).toBe(true);
      expect(ok(run({ amp: 0.1, freq: 2, roll: 0, seed: -3 }))).toBe(true);
    });
    it('rejects bad values and unknown keys', () => {
      for (const s of [
        { amp: -1, freq: 1 },
        { amp: 'a', freq: 1 },
        { amp: 1, freq: 0 },
        { amp: 1, freq: Infinity },
        { amp: 1 },
        { amp: 1, freq: 1, roll: -0.1 },
        { amp: 1, freq: 1, seed: 1.5 },
        { amp: 1, freq: 1, extra: 1 },
        5,
      ]) {
        expect(ok(run(s)), JSON.stringify(s)).toBe(false);
      }
    });
  });
});
