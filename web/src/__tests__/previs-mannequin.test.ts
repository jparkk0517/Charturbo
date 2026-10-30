import { describe, expect, it } from 'vitest';
import {
  applyMotion,
  attachProp,
  createMannequin,
  jump,
  lookAt,
  raiseArm,
  shrug,
  twoToneBox,
  walk,
} from '../previs/mannequin';
import type { PrevisNode, Track } from '../previs/types';

const RED: [number, number, number] = [1, 0, 0];
const visible = (nodes: PrevisNode[]) => nodes.filter((n) => n.visible !== false);

function checkTree(nodes: PrevisNode[]) {
  const ids = nodes.map((n) => n.id);
  expect(new Set(ids).size).toBe(ids.length);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    let cur: PrevisNode | undefined = n;
    const seen = new Set<string>();
    while (cur?.parent !== undefined) {
      expect(byId.has(cur.parent)).toBe(true);
      expect(seen.has(cur.id)).toBe(false);
      seen.add(cur.id);
      cur = byId.get(cur.parent);
    }
  }
}

function strictlyIncreasing(t: Track<unknown> | undefined) {
  if (!t) return;
  for (let i = 1; i < t.length; i++) expect(t[i].t).toBeGreaterThan(t[i - 1].t);
}

describe('createMannequin', () => {
  it('default person has exactly 3 visible blocks sharing color and role', () => {
    const m = createMannequin({ id: 'p', color: RED, role: 'hero' });
    const v = visible(m.nodes);
    expect(v.map((n) => n.id).sort()).toEqual(['p.head.mesh', 'p.lower', 'p.upper']);
    for (const n of v) {
      expect(n.color).toEqual(RED);
      expect(n.role).toBe('hero');
    }
    expect(m.joints).toEqual({ root: 'p.root', hips: 'p.hips', spine: 'p.spine', head: 'p.head' });
  });

  it('ids unique, parents exist, acyclic, parents precede children, in all modes', () => {
    for (const limbs of ['none', 'arms', 'full'] as const) {
      const { nodes } = createMannequin({ id: 'q', color: RED, limbs });
      checkTree(nodes);
      const idx = new Map(nodes.map((n, i) => [n.id, i]));
      for (const n of nodes) if (n.parent) expect(idx.get(n.parent)!).toBeLessThan(idx.get(n.id)!);
    }
  });

  it('pivots are invisible and tiny', () => {
    const { nodes, joints } = createMannequin({ id: 'p', color: RED, limbs: 'full' });
    for (const id of Object.values(joints)) {
      const n = nodes.find((x) => x.id === id)!;
      expect(n.visible).toBe(false);
      expect(Math.max(...n.size)).toBeLessThanOrEqual(0.05);
    }
  });

  it('limbs modes node counts', () => {
    const none = createMannequin({ id: 'a', color: RED });
    const arms = createMannequin({ id: 'a', color: RED, limbs: 'arms' });
    const full = createMannequin({ id: 'a', color: RED, limbs: 'full' });
    expect(none.nodes.length).toBe(7);
    expect(visible(arms.nodes).length).toBe(5);
    expect(arms.nodes.length).toBe(7 + 6);
    expect(visible(full.nodes).length).toBe(7);
    expect(full.nodes.length).toBe(7 + 6 + 4);
    expect(none.joints.handL).toBeUndefined();
    expect(arms.joints.handL).toBe('a.handL');
    expect(arms.joints.hipL).toBeUndefined();
    expect(full.joints.hipR).toBe('a.hipR');
    expect(full.nodes.some((n) => n.id === 'a.lower')).toBe(true);
  });

  it('scales with height, feet on ground, applies position', () => {
    const m = createMannequin({ id: 'p', color: RED, height: 2, position: [1, 0, 3] });
    expect(m.nodes[0].position).toEqual([1, 0, 3]);
    const lower = m.nodes.find((n) => n.id === 'p.lower')!;
    const hips = m.nodes.find((n) => n.id === 'p.hips')!;
    expect(hips.position[1] + lower.position[1] - lower.size[1] / 2).toBeCloseTo(0);
    const head = m.nodes.find((n) => n.id === 'p.head')!;
    const mesh = m.nodes.find((n) => n.id === 'p.head.mesh')!;
    const top = hips.position[1] + head.position[1] + mesh.position[1] + mesh.size[1] / 2;
    expect(top).toBeCloseTo(2);
  });

  it('left is +x', () => {
    const m = createMannequin({ id: 'p', color: RED, limbs: 'arms' });
    const l = m.nodes.find((n) => n.id === 'p.shoulderL')!;
    expect(l.position[0]).toBeGreaterThan(0);
  });
});

describe('motions', () => {
  const full = createMannequin({ id: 'p', color: RED, limbs: 'full' });
  const bare = createMannequin({ id: 'b', color: RED });

  it('walk writes root, spine, arms, legs with strictly increasing t', () => {
    const f = walk({ joints: full.joints, from: [0, 0, 0], to: [4, 0, 0], start: 1, end: 3 });
    expect(Object.keys(f).sort()).toEqual(
      ['p.hipL', 'p.hipR', 'p.root', 'p.shoulderL', 'p.shoulderR', 'p.spine'].sort(),
    );
    for (const tr of Object.values(f)) {
      strictlyIncreasing(tr.position);
      strictlyIncreasing(tr.rotation);
    }
    expect(f['p.root'].position![1].v).toEqual([4, 0, 0]);
    // travelling +x => yaw +PI/2
    expect(f['p.root'].rotation![0].v[1]).toBeCloseTo(Math.PI / 2);
    const g = walk({ joints: full.joints, from: [0, 0, 0], to: [0, 0, 5], start: 0, end: 2 });
    expect(g['p.root'].rotation![0].v[1]).toBeCloseTo(0);
  });

  it('walk on limbless mannequin writes only root and spine', () => {
    const f = walk({ joints: bare.joints, from: [0, 0, 0], to: [0, 0, 1], start: 0, end: 1 });
    expect(Object.keys(f).sort()).toEqual(['b.root', 'b.spine']);
  });

  it('walk arm and same-side leg swing opposite', () => {
    const f = walk({ joints: full.joints, from: [0, 0, 0], to: [0, 0, 5], start: 0, end: 4 });
    const leg = f['p.hipL'].rotation!.map((k) => k.v[0]);
    const arm = f['p.shoulderL'].rotation!.map((k) => k.v[0]);
    leg.forEach((v, i) => expect(arm[i] * v).toBeLessThanOrEqual(0));
    expect(leg.some((v) => v !== 0)).toBe(true);
  });

  it('walk rejects empty span', () => {
    expect(() => walk({ joints: full.joints, from: [0, 0, 0], to: [1, 0, 0], start: 2, end: 2 })).toThrow();
  });

  it('jump rises by height and returns', () => {
    const f = jump({ joints: full.joints, start: 1, airTime: 0.8, height: 0.5, base: [2, 0, 2] });
    const p = f['p.root'].position!;
    expect(p.map((k) => k.t)).toEqual([1, 1.4, 1.8]);
    expect(p[1].v).toEqual([2, 0.5, 2]);
    expect(p[2].v).toEqual([2, 0, 2]);
    expect(f['p.shoulderL']).toBeDefined();
  });

  it('raiseArm targets correct shoulder; throws without arms', () => {
    const f = raiseArm({ joints: full.joints, side: 'right', start: 0, end: 1, angle: 1.5 });
    expect(Object.keys(f)).toEqual(['p.shoulderR']);
    expect(f['p.shoulderR'].rotation![1].v).toEqual([-1.5, 0, 0]);
    expect(() => raiseArm({ joints: bare.joints, side: 'left', start: 0, end: 1 })).toThrow();
  });

  it('shrug returns to rest; lookAt writes head', () => {
    const s = shrug({ joints: full.joints, start: 2, duration: 1 });
    expect(s['p.spine'].position![0].v).toEqual([0, 0, 0]);
    expect(s['p.spine'].position![3].v).toEqual([0, 0, 0]);
    expect(s['p.spine'].position![1].v[1]).toBeGreaterThan(0);
    strictlyIncreasing(s['p.head'].rotation);
    const l = lookAt({ joints: bare.joints, start: 0, end: 0.5, yaw: 0.8 });
    expect(l['b.head'].rotation![1].v).toEqual([0, 0.8, 0]);
  });
});

describe('applyMotion', () => {
  const m = createMannequin({ id: 'p', color: RED, limbs: 'arms' });

  it('does not mutate inputs and merges tracks sorted', () => {
    const snapshot = JSON.parse(JSON.stringify(m.nodes));
    const w1 = walk({ joints: m.joints, from: [0, 0, 0], to: [0, 0, 2], start: 0, end: 2 });
    const w2 = walk({ joints: m.joints, from: [0, 0, 2], to: [2, 0, 2], start: 2.5, end: 4 });
    const fragSnapshot = JSON.parse(JSON.stringify(w1));
    const out = applyMotion(m.nodes, [w2, w1]);
    expect(JSON.parse(JSON.stringify(m.nodes))).toEqual(snapshot);
    expect(JSON.parse(JSON.stringify(w1))).toEqual(fragSnapshot);
    expect(out).not.toBe(m.nodes);
    const root = out.find((n) => n.id === 'p.root')!;
    expect(root.tracks!.position!.map((k) => k.t)).toEqual([0, 2, 2.5, 4]);
    for (const n of out) {
      strictlyIncreasing(n.tracks?.position);
      strictlyIncreasing(n.tracks?.rotation);
    }
    const orig = m.nodes.find((n) => n.id === 'p.root')!;
    expect(orig.tracks).toBeUndefined();
    expect(root).not.toBe(orig);
  });

  it('same t: later key replaces earlier; applying twice keeps t strict', () => {
    const f = raiseArm({ joints: m.joints, side: 'left', start: 0, end: 1 });
    const once = applyMotion(m.nodes, f);
    const twice = applyMotion(once, f);
    const tr = twice.find((n) => n.id === 'p.shoulderL')!.tracks!.rotation!;
    expect(tr.length).toBe(2);
    expect(once.find((n) => n.id === 'p.shoulderL')!.tracks!.rotation).toHaveLength(2);
  });

  it('throws on unknown node', () => {
    expect(() => applyMotion(m.nodes, { nope: { position: [{ t: 0, v: [0, 0, 0] }] } })).toThrow();
  });
});

describe('props and twoToneBox', () => {
  it('attachProp adds a real-size child of the hand without mutating input', () => {
    const m = createMannequin({ id: 'p', color: RED, limbs: 'arms' });
    const before = m.nodes.length;
    const out = attachProp(m.nodes, m.joints.handL!, {
      id: 'cup',
      size: [0.08, 0.1, 0.08],
      color: [0, 1, 0],
      role: 'cup',
      offset: [0, 0.05, 0],
    });
    expect(m.nodes.length).toBe(before);
    expect(out.length).toBe(before + 1);
    const cup = out[out.length - 1];
    expect(cup.parent).toBe('p.handL');
    expect(cup.size).toEqual([0.08, 0.1, 0.08]);
    expect(cup.visible).not.toBe(false);
    expect(cup.role).toBe('cup');
    checkTree(out);
    expect(() => attachProp(m.nodes, 'zzz', { id: 'x', size: [1, 1, 1], color: RED })).toThrow();
    expect(() => attachProp(out, 'p.handL', { id: 'cup', size: [1, 1, 1], color: RED })).toThrow();
  });

  it('twoToneBox: invisible pivot, +z front half, -z back half', () => {
    const nodes = twoToneBox({
      id: 'box',
      size: [0.2, 0.3, 0.1],
      front: [1, 0, 0],
      back: [0, 0, 1],
      position: [0, 1, 0],
    });
    checkTree(nodes);
    expect(nodes).toHaveLength(3);
    const [pv, f, b] = nodes;
    expect(pv.visible).toBe(false);
    expect(pv.position).toEqual([0, 1, 0]);
    expect(f.parent).toBe('box');
    expect(b.parent).toBe('box');
    expect(f.color).toEqual([1, 0, 0]);
    expect(b.color).toEqual([0, 0, 1]);
    expect(f.size).toEqual([0.2, 0.3, 0.05]);
    expect(b.size).toEqual([0.2, 0.3, 0.05]);
    expect(f.position[2]).toBeCloseTo(0.025);
    expect(b.position[2]).toBeCloseTo(-0.025);
    expect(visible(nodes)).toHaveLength(2);
  });
});
