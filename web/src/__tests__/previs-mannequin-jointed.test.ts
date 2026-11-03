import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyMotion, attachProp, createMannequin, crouch, pickUp, twoBoneIK } from '../previs/mannequin';
import type { Mannequin } from '../previs/mannequin';
import { evaluateFrame, worldPosition } from '../previs/evaluate';
import type { PrevisDoc, PrevisNode, Vec3 } from '../previs/types';

const RED: [number, number, number] = [1, 0, 0];
const FPS = 24;

const doc = (nodes: PrevisNode[], end = 10): PrevisDoc => ({
  version: 1,
  fps: FPS,
  size: { width: 64, height: 36 },
  background: [0, 0, 0],
  roles: [],
  nodes,
  shots: [{ id: 's', start: 0, end, camera: { position: [{ t: 0, v: [5, 1, 0] }], target: { track: [{ t: 0, v: [0, 1, 0] }] } } }],
});

const world = (d: PrevisDoc, t: number, id: string): Vec3 => worldPosition(d, evaluateFrame(d, t).nodes, id);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Forward kinematics of the twoBoneIK chain (engine Rx: y' = c y - s z, z' = s y + c z). */
function fk(l1: number, l2: number, a: number, b: number): { mid: [number, number]; end: [number, number] } {
  const mid: [number, number] = [-l1 * Math.cos(a), -l1 * Math.sin(a)];
  return { mid, end: [mid[0] - l2 * Math.cos(a + b), mid[1] - l2 * Math.sin(a + b)] };
}

describe('rigid output unchanged', () => {
  it('none/arms/full/default outputs hash to the pre-jointed snapshot', () => {
    // Hash recorded from mannequin.ts at HEAD 70355e3, before 'jointed' existed.
    const out: unknown[] = [];
    for (const limbs of [undefined, 'none', 'arms', 'full'] as const) {
      out.push(
        createMannequin({ id: 'p', color: [0.2, 0.4, 0.6], role: 'hero', height: 1.8, position: [1, 0, -2], ...(limbs ? { limbs } : {}) }),
      );
      out.push(createMannequin({ id: 'q', color: [1, 0, 0], ...(limbs ? { limbs } : {}) }));
    }
    const s = JSON.stringify(out);
    expect(s.length).toBe(14632);
    expect(createHash('sha256').update(s).digest('hex')).toBe(
      'be8b7b4a7ffd4b139cff38458bb95ec22564c6f055d56e5030edd9043bc55f65',
    );
  });
});

describe("createMannequin limbs: 'jointed'", () => {
  const m = createMannequin({ id: 'p', color: RED, role: 'hero', limbs: 'jointed' });
  const byId = new Map(m.nodes.map((n) => [n.id, n]));

  it('ids, parents, joints, visibility', () => {
    const ids = m.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const idx = new Map(ids.map((id, i) => [id, i]));
    for (const n of m.nodes) if (n.parent) expect(idx.get(n.parent)!).toBeLessThan(idx.get(n.id)!);
    expect(m.nodes).toHaveLength(27);
    expect(m.nodes.filter((n) => n.visible !== false).map((n) => n.id).sort()).toEqual(
      [
        'p.lower', 'p.upper', 'p.head.mesh',
        'p.upperArmL', 'p.forearmL', 'p.upperArmR', 'p.forearmR',
        'p.thighL', 'p.shinL', 'p.thighR', 'p.shinR',
      ].sort(),
    );
    expect(m.joints).toEqual({
      root: 'p.root', hips: 'p.hips', spine: 'p.spine', head: 'p.head',
      shoulderL: 'p.shoulderL', handL: 'p.handL', elbowL: 'p.elbowL',
      shoulderR: 'p.shoulderR', handR: 'p.handR', elbowR: 'p.elbowR',
      hipL: 'p.hipL', kneeL: 'p.kneeL', footL: 'p.footL',
      hipR: 'p.hipR', kneeR: 'p.kneeR', footR: 'p.footR',
    });
    for (const id of Object.values(m.joints)) expect(byId.get(id)!.visible).toBe(false);
    const parent = (id: string) => byId.get(id)!.parent;
    expect(parent('p.elbowL')).toBe('p.shoulderL');
    expect(parent('p.handL')).toBe('p.elbowL');
    expect(parent('p.forearmL')).toBe('p.elbowL');
    expect(parent('p.kneeR')).toBe('p.hipR');
    expect(parent('p.shinR')).toBe('p.kneeR');
    expect(parent('p.footR')).toBe('p.kneeR');
  });

  it('segments add up to the rigid limb lengths; feet on the ground; body identical to full', () => {
    const full = createMannequin({ id: 'p', color: RED, role: 'hero', limbs: 'full' });
    const fById = new Map(full.nodes.map((n) => [n.id, n]));
    const h = 1.75;
    const len = (id: string) => byId.get(id)!.size[1];
    expect(len('p.upperArmL') + len('p.forearmL')).toBeCloseTo(fById.get('p.armL')!.size[1], 12);
    expect(len('p.thighR') + len('p.shinR')).toBeCloseTo(fById.get('p.legR')!.size[1], 12);
    expect(len('p.upperArmL') / (0.32 * h)).toBeCloseTo(0.186 / 0.332, 12);
    expect(len('p.thighL') / (0.48 * h)).toBeCloseTo(0.245 / 0.491, 12);
    for (const id of ['p.root', 'p.hips', 'p.spine', 'p.head', 'p.lower', 'p.upper', 'p.head.mesh', 'p.shoulderL', 'p.hipR']) {
      expect(byId.get(id)).toEqual(fById.get(id));
    }
    const d = doc(m.nodes);
    for (const f of ['p.footL', 'p.footR']) expect(Math.abs(world(d, 0, f)[1])).toBeLessThan(1e-12);
    expect(dist(world(d, 0, 'p.handL'), world(doc(full.nodes), 0, 'p.handL'))).toBeLessThan(1e-12);
    expect(dist(world(d, 0, 'p.handR'), world(doc(full.nodes), 0, 'p.handR'))).toBeLessThan(1e-12);
  });
});

describe('twoBoneIK', () => {
  const pairs: [number, number][] = [
    [0.42, 0.42],
    [0.31, 0.25],
    [0.2, 0.5],
  ];

  it('closed form reaches every reachable target within 1e-6, both bend signs', () => {
    let worst = 0;
    for (const [l1, l2] of pairs) {
      const lo = Math.abs(l1 - l2);
      const hi = l1 + l2;
      for (let i = 0; i <= 20; i++) {
        const r = lo + ((hi - lo) * i) / 20;
        for (let k = 0; k < 24; k++) {
          const th = (2 * Math.PI * k) / 24;
          const ty = r * Math.cos(th);
          const tz = r * Math.sin(th);
          for (const bend of [1, -1] as const) {
            const s = twoBoneIK(l1, l2, ty, tz, bend);
            expect(s.reached).toBe(true);
            expect(s.miss).toBe(0);
            const e = fk(l1, l2, s.a, s.b).end;
            worst = Math.max(worst, Math.hypot(e[0] - ty, e[1] - tz));
            if (bend === 1) expect(s.b).toBeGreaterThanOrEqual(0);
            else expect(s.b).toBeLessThanOrEqual(0);
          }
        }
      }
    }
    expect(worst).toBeLessThan(1e-6);
  });

  it('out of reach: straight limb toward the target; too close: folded along it', () => {
    const [l1, l2] = [0.31, 0.25];
    const s = twoBoneIK(l1, l2, -0.3, 0.9, 1);
    expect(s.reached).toBe(false);
    expect(s.b).toBeCloseTo(0, 12);
    const e = fk(l1, l2, s.a, s.b).end;
    expect(Math.hypot(...e)).toBeCloseTo(l1 + l2, 12);
    const dir = 1 / Math.hypot(-0.3, 0.9);
    expect(e[0] / (l1 + l2)).toBeCloseTo(-0.3 * dir, 12);
    expect(e[1] / (l1 + l2)).toBeCloseTo(0.9 * dir, 12);
    expect(s.miss).toBeCloseTo(Math.hypot(-0.3, 0.9) - (l1 + l2), 12);
    const c = twoBoneIK(l1, l2, -0.01, 0.02, -1);
    expect(c.reached).toBe(false);
    expect(Math.abs(c.b)).toBeCloseTo(Math.PI, 12);
    const ce = fk(l1, l2, c.a, c.b).end;
    expect(Math.hypot(...ce)).toBeCloseTo(l1 - l2, 12);
  });

  it('straight-down target: knee (bend 1) forward +z, elbow (bend -1) back -z', () => {
    const k = twoBoneIK(0.42, 0.42, -0.6, 0, 1);
    expect(fk(0.42, 0.42, k.a, k.b).mid[1]).toBeGreaterThan(0.1);
    const e = twoBoneIK(0.3, 0.25, -0.4, 0, -1);
    expect(fk(0.3, 0.25, e.a, e.b).mid[1]).toBeLessThan(-0.1);
  });
});

describe('crouch', () => {
  const build = (yaw: number) => {
    const m = createMannequin({ id: 'p', color: RED, limbs: 'jointed', position: [1.5, 0, -0.5] });
    m.nodes[0].rotation = [0, yaw, 0];
    return m;
  };

  it('feet stay planted within 1e-6 on every frame; hips drop by depth; knees forward of the facing', () => {
    for (const yaw of [0, 1.1, -2.5]) {
      const m = build(yaw);
      const f = crouch({ mannequin: m, start: 0.5, end: 1.5, depth: 0.4, fps: FPS });
      const up = crouch({ mannequin: m, start: 2, end: 2.8, depth: 0, from: 0.4, fps: FPS });
      const nodes = applyMotion(m.nodes, [f, up]);
      const d = doc(nodes);
      const rest = doc(m.nodes);
      const footRest = { L: world(rest, 0, 'p.footL'), R: world(rest, 0, 'p.footR') };
      const facing: Vec3 = [Math.sin(yaw), 0, Math.cos(yaw)];
      let worst = 0;
      for (let k = 0; k <= 3 * FPS; k++) {
        const t = k / FPS;
        for (const s of ['L', 'R'] as const) {
          const foot = world(d, t, `p.foot${s}`);
          worst = Math.max(worst, Math.abs(foot[1]), dist(foot, footRest[s]));
          const knee = world(d, t, `p.knee${s}`);
          const hip = world(d, t, `p.hip${s}`);
          // knee ahead of the hip-foot line along the facing direction whenever the leg bends
          const mid: Vec3 = [(hip[0] + foot[0]) / 2, 0, (hip[2] + foot[2]) / 2];
          const fwd = (knee[0] - mid[0]) * facing[0] + (knee[2] - mid[2]) * facing[2];
          if (t > 0.5 + 1e-9 && t < 2.8 - 1e-9) expect(fwd).toBeGreaterThan(0);
          else expect(Math.abs(fwd)).toBeLessThan(1e-9);
        }
      }
      expect(worst).toBeLessThan(1e-6);
      const hips0 = world(d, 0, 'p.hips')[1];
      expect(hips0 - world(d, 1.5, 'p.hips')[1]).toBeCloseTo(0.4, 12);
      expect(world(d, 2.8, 'p.hips')[1]).toBeCloseTo(hips0, 12);
      // all keys strictly increasing
      for (const n of nodes) {
        const tr = n.tracks?.rotation ?? n.tracks?.position;
        if (tr) for (let i = 1; i < tr.length; i++) expect(tr[i].t).toBeGreaterThan(tr[i - 1].t);
      }
    }
  });

  it('one key per global frame inside the span, plus start and end', () => {
    const m = build(0);
    const f = crouch({ mannequin: m, start: 0.51, end: 1, depth: 0.2, fps: 10 });
    expect(f['p.hips'].position!.map((k) => k.t)).toEqual([0.51, 0.6, 0.7, 0.8, 0.9, 1]);
    expect(f['p.hips'].position![0].v).toEqual(m.nodes.find((n) => n.id === 'p.hips')!.position);
    expect(f['p.kneeL'].rotation![0].v).toEqual([0, 0, 0]);
  });

  it('rejects rigid mannequins, bad spans, impossible depth', () => {
    for (const limbs of ['none', 'arms', 'full'] as const) {
      const r = createMannequin({ id: 'r', color: RED, limbs });
      expect(() => crouch({ mannequin: r, start: 0, end: 1, depth: 0.3, fps: FPS })).toThrow(/limbs: 'jointed'/);
    }
    const m = build(0);
    expect(() => crouch({ mannequin: m, start: 1, end: 1, depth: 0.3, fps: FPS })).toThrow(RangeError);
    expect(() => crouch({ mannequin: m, start: 0, end: 1, depth: 2, fps: FPS })).toThrow(/depth/);
    expect(() => crouch({ mannequin: m, start: 0, end: 1, depth: 0.3, fps: 0 })).toThrow(/fps/);
  });
});

describe('pickUp', () => {
  const make = (): Mannequin => {
    const m = createMannequin({ id: 'p', color: RED, limbs: 'jointed', position: [2, 0, 1] });
    m.nodes[0].rotation = [0, 0.7, 0];
    return m;
  };
  const yaw = 0.7;
  // 0.5 m ahead of the body, 0.25 m to the right (-x local), 0.15 m above the floor
  const local: Vec3 = [-0.25, 0.15, 0.5];
  const target: Vec3 = [
    2 + Math.cos(yaw) * local[0] + Math.sin(yaw) * local[2],
    local[1],
    1 - Math.sin(yaw) * local[0] + Math.cos(yaw) * local[2],
  ];

  it('hand reaches the world target at grab within 1e-6, feet planted, back to rest at end', () => {
    const m = make();
    const r = pickUp({ mannequin: m, side: 'right', target, start: 0.5, grab: 1.5, end: 2.5, depth: 0.5, lean: 1.0, fps: FPS });
    expect(r.hand).toBe('p.handR');
    expect(r.miss).toBe(0);
    const withBall = attachProp(applyMotion(m.nodes, r.motion), r.hand, { id: 'ball', size: [0.24, 0.24, 0.24], color: [0, 1, 0] });
    const d = doc(withBall);
    expect(dist(world(d, 1.5, 'p.handR'), target)).toBeLessThan(1e-6);
    expect(dist(world(d, 1.5, 'ball'), target)).toBeLessThan(1e-6);
    const rest = doc(m.nodes);
    let worst = 0;
    for (let k = 0; k <= 3 * FPS; k++) {
      for (const s of ['L', 'R']) worst = Math.max(worst, dist(world(d, k / FPS, `p.foot${s}`), world(rest, 0, `p.foot${s}`)));
    }
    expect(worst).toBeLessThan(1e-6);
    for (const id of ['p.handR', 'p.handL', 'p.hips', 'p.head']) {
      expect(dist(world(d, 2.5, id), world(rest, 0, id))).toBeLessThan(1e-12);
    }
    const sh = r.motion['p.shoulderR'].rotation!;
    expect(sh[0].v).toEqual([0, 0, 0]);
    expect(sh[sh.length - 1].v).toEqual([0, 0, 0]);
    // elbow flexes the natural way (rx <= 0) and the other arm is untouched
    for (const k of r.motion['p.elbowR'].rotation!) expect(k.v[0]).toBeLessThanOrEqual(0);
    expect(r.motion['p.shoulderL']).toBeUndefined();
  });

  it('unreachable target: miss > 0, arm straight toward it', () => {
    const m = make();
    const r = pickUp({ mannequin: m, side: 'left', target: [2, 0, 6], start: 0, grab: 1, end: 2, depth: 0.1, fps: FPS });
    expect(r.hand).toBe('p.handL');
    expect(r.miss).toBeGreaterThan(0.5);
    const el = r.motion['p.elbowL'].rotation!.find((k) => k.t === 1)!;
    expect(el.v[0]).toBeCloseTo(0, 12);
  });

  it('rejects rigid mannequins and bad spans', () => {
    for (const limbs of ['none', 'arms', 'full'] as const) {
      const rm = createMannequin({ id: 'r', color: RED, limbs });
      expect(() =>
        pickUp({ mannequin: rm, side: 'left', target: [0, 0.1, 0.4], start: 0, grab: 1, end: 2, depth: 0.3, fps: FPS }),
      ).toThrow(/needs jointed limbs/);
    }
    expect(() =>
      pickUp({ mannequin: make(), side: 'left', target, start: 0, grab: 0, end: 2, depth: 0.3, fps: FPS }),
    ).toThrow(RangeError);
  });
});
