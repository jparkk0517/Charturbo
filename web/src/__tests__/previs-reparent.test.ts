import { describe, expect, it } from 'vitest';
import {
  createParentResolver,
  eulerYXZToQuat,
  evaluateFrame,
  parentKeyAt,
  quatToEulerYXZ,
  worldPosition,
  worldTransform,
  type JointFrame,
} from '../previs/evaluate';
import { modelSrcsToLoad } from '../previs/models';
import type { PrevisDoc, PrevisNode, Shot, Vec3 } from '../previs/types';
import { validateDoc } from '../previs/validate';

// Independent reference: row-major 3x3 matrices, R = Ry * Rx * Rz (engine YXZ)
type M3 = number[];
const rx = (t: number): M3 => [1, 0, 0, 0, Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t)];
const ry = (t: number): M3 => [Math.cos(t), 0, Math.sin(t), 0, 1, 0, -Math.sin(t), 0, Math.cos(t)];
const rz = (t: number): M3 => [Math.cos(t), -Math.sin(t), 0, Math.sin(t), Math.cos(t), 0, 0, 0, 1];
const mul = (a: M3, b: M3): M3 => {
  const o: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o;
};
const eul = (e: Vec3): M3 => mul(ry(e[1]), mul(rx(e[0]), rz(e[2])));
const app = (m: M3, v: Vec3): Vec3 => [0, 1, 2].map((r) => m[r * 3] * v[0] + m[r * 3 + 1] * v[1] + m[r * 3 + 2] * v[2]) as Vec3;
const quatMat = (q: number[]): M3 => eul(quatToEulerYXZ(q as [number, number, number, number]));

const close = (a: number[], b: number[], tol = 1e-9) => {
  expect(a.length).toBe(b.length);
  a.forEach((v, i) => expect(Math.abs(v - b[i])).toBeLessThan(tol));
};
/** Same rotation (q and -q are equal). */
const sameRot = (a: Vec3, b: Vec3, tol = 1e-9) => close(eul(a), eul(b), tol);

const node = (id: string, extra: Partial<PrevisNode> = {}): PrevisNode => ({
  id,
  shape: 'box',
  color: [1, 0, 0],
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [1, 1, 1],
  ...extra,
});
const shot = (target: Shot['camera']['target'] = { track: [{ t: 0, v: [0, 0, 0] }] }): Shot => ({
  id: 's',
  start: 0,
  end: 10,
  camera: { position: [{ t: 0, v: [0, 0, 10] }], target },
});
const doc = (nodes: PrevisNode[], target?: Shot['camera']['target']): PrevisDoc => ({
  version: 1,
  fps: 24,
  size: { width: 640, height: 360 },
  background: [0, 0, 0],
  roles: [],
  nodes,
  shots: [shot(target)],
});
const W = (d: PrevisDoc, t: number, id: string) => worldTransform(d, evaluateFrame(d, t).nodes, id);

/** Crate (static, rotated), carrier (moving + turning), bottle: crate -> carrier at 1 -> world at 2. */
function pickup(extraBottle: Partial<PrevisNode> = {}): PrevisDoc {
  return doc([
    node('crate', { position: [1, 0.4, -2], rotation: [0, 0.7, 0] }),
    node('carrier', {
      position: [-2, 1, 0],
      rotation: [0.1, 0, 0],
      tracks: {
        position: [
          { t: 0, v: [-2, 1, 0] },
          { t: 3, v: [4, 1.5, 1] },
        ],
        rotation: [
          { t: 0, v: [0.1, -0.5, 0.2] },
          { t: 3, v: [-0.2, 1.8, 0.4] },
        ],
      },
    }),
    node('bottle', {
      parent: 'crate',
      position: [0.1, 0.5, 0.05],
      rotation: [0.3, 0, 0],
      tracks: {
        parent: [
          { t: 1, v: { node: 'carrier' } },
          { t: 2, v: null },
        ],
      },
      ...extraBottle,
    }),
  ]);
}

describe('tracks.parent evaluation', () => {
  it('parentRef: static before the first key (-1), step at t_k, held after the last', () => {
    const d = pickup();
    const at = (t: number) => evaluateFrame(d, t).nodes.bottle.parentRef;
    expect(at(0)).toEqual({ ref: { node: 'crate' }, key: -1 });
    expect(at(0.999)).toEqual({ ref: { node: 'crate' }, key: -1 });
    expect(at(1)).toEqual({ ref: { node: 'carrier' }, key: 0 });
    expect(at(1.5)).toEqual({ ref: { node: 'carrier' }, key: 0 });
    expect(at(2)).toEqual({ ref: null, key: 1 });
    expect(at(9)).toEqual({ ref: null, key: 1 });
    // No parentRef without the track; static joint shows in the ref
    expect(evaluateFrame(d, 1).nodes.crate.parentRef).toBeUndefined();
    const b = d.nodes[2];
    expect(parentKeyAt(b, 1)).toBe(0);
    expect(parentKeyAt(b, 1, true)).toBe(-1);
    const j = doc([node('m', { shape: 'model', model: { src: 'm.glb' } }), node('c', { parent: 'm', parentJoint: 'hand', tracks: { parent: [{ t: 1, v: null }] } })]);
    expect(evaluateFrame(j, 0).nodes.c.parentRef).toEqual({ ref: { node: 'm', joint: 'hand' }, key: -1 });
  });

  it('parentRef.ref is a copy (mutating it leaves the doc alone)', () => {
    const d = pickup();
    evaluateFrame(d, 1.5).nodes.bottle.parentRef!.ref!.node = 'x';
    expect(d.nodes[2].tracks!.parent![0].v).toEqual({ node: 'carrier' });
  });

  it('worldTransform of a static chain: matrix reference, and position equals worldPosition', () => {
    const d = doc([
      node('a', { position: [1, 2, 3], rotation: [0.3, -1.1, 0.5] }),
      node('b', { parent: 'a', position: [0.5, -1, 2], rotation: [-0.7, 0.2, 1.3] }),
      node('c', { parent: 'b', position: [2, 0.25, -1], rotation: [0.4, 2.5, -0.6] }),
    ]);
    const nodes = evaluateFrame(d, 0).nodes;
    const w = worldTransform(d, nodes, 'c');
    const ra = eul([0.3, -1.1, 0.5]);
    const rb = mul(ra, eul([-0.7, 0.2, 1.3]));
    const rc = mul(rb, eul([0.4, 2.5, -0.6]));
    const pb = app(ra, [0.5, -1, 2]).map((v, i) => v + [1, 2, 3][i]) as Vec3;
    const pc = app(rb, [2, 0.25, -1]).map((v, i) => v + pb[i]) as Vec3;
    close(w.position, pc, 1e-12);
    close(eul(w.rotation), rc, 1e-12);
    close(quatMat(w.quaternion), rc, 1e-12);
    close(w.position, worldPosition(d, nodes, 'c'), 1e-12);
  });

  it('no pop at each switch: world just before and at t_k agree within 1e-6 (position and rotation)', () => {
    const d = pickup();
    for (const tk of [1, 2]) {
      const a = W(d, tk - 1e-9, 'bottle');
      const b = W(d, tk, 'bottle');
      close(a.position, b.position, 1e-6);
      sameRot(a.rotation, b.rotation, 1e-6);
    }
    // Before the pick-up it sits on the crate; while carried it follows the carrier rigidly
    const crate = W(d, 0.5, 'crate');
    close(W(d, 0.5, 'bottle').position, app(eul(crate.rotation), [0.1, 0.5, 0.05]).map((v, i) => v + crate.position[i]), 1e-12);
    const rel = (t: number) => {
      const c = W(d, t, 'carrier');
      const b = W(d, t, 'bottle');
      const inv = [0, 1, 2].flatMap((r) => [0, 1, 2].map((col) => eul(c.rotation)[col * 3 + r])); // transpose
      return { p: app(inv, b.position.map((v, i) => v - c.position[i]) as Vec3), r: mul(inv, eul(b.rotation)) };
    };
    const r1 = rel(1.1);
    const r2 = rel(1.9);
    close(r1.p, r2.p, 1e-9);
    close(r1.r, r2.r, 1e-9);
  });

  it('capture = new parent frame^-1 * old world at t_k', () => {
    const d = pickup();
    const r = createParentResolver(d);
    const c = r.capture('bottle', 0)!;
    const before = W(d, 1 - 1e-12, 'bottle');
    const car = W(d, 1, 'carrier');
    const inv = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => eul(car.rotation)[col * 3 + row]));
    close(c.position, app(inv, before.position.map((v, i) => v - car.position[i]) as Vec3), 1e-9);
    close(quatMat(c.quaternion), mul(inv, eul(before.rotation)), 1e-9);
    // Released to the world: the capture is the world transform at t_k
    const c1 = r.capture('bottle', 1)!;
    const at2 = W(d, 2, 'bottle');
    close(c1.position, at2.position, 1e-12);
    close(quatMat(c1.quaternion), eul(at2.rotation), 1e-12);
  });

  it('delta semantics: P and R act relative to their value at t_k, in the new parent frame', () => {
    // Throw: released at t=2, then the position track adds an arc and the rotation track spins
    const d = pickup({
      tracks: {
        parent: [
          { t: 1, v: { node: 'carrier' } },
          { t: 2, v: null },
        ],
        position: [
          { t: 0, v: [0.1, 0.5, 0.05] },
          { t: 2, v: [0.1, 0.5, 0.05] },
          { t: 2.5, v: [1.1, 1.5, 0.05] },
          { t: 3, v: [2.1, 0.5, 0.05] },
        ],
        rotation: [
          { t: 0, v: [0.3, 0, 0] },
          { t: 2, v: [0.3, 0, 0] },
          { t: 3, v: [0.3, 0, 2] },
        ],
      },
    });
    const rel = W(d, 2, 'bottle');
    for (const t of [2.25, 2.5, 3, 4]) {
      const w = W(d, t, 'bottle');
      const p = evaluateFrame(d, t).nodes.bottle;
      // world parent: position = release + (P(t) - P(2)); rotation = Rc * R(2)^-1 * R(t)
      close(w.position, rel.position.map((v, i) => v + p.position[i] - [0.1, 0.5, 0.05][i]), 1e-12);
      const r2inv = [0, 1, 2].flatMap((row) => [0, 1, 2].map((col) => eul([0.3, 0, 0])[col * 3 + row]));
      close(eul(w.rotation), mul(eul(rel.rotation), mul(r2inv, eul(p.rotation))), 1e-9);
    }
    // While carried an unchanged track keeps the bottle rigid on the carrier even though the track has keys
    // at 0 and 2: the delta is P(t) - P(1) = 0
    const c = W(d, 1.5, 'carrier');
    const b = W(d, 1.5, 'bottle');
    const cap = createParentResolver(d).capture('bottle', 0)!;
    close(b.position, app(eul(c.rotation), cap.position).map((v, i) => v + c.position[i]), 1e-12);
  });

  it('delta in a rotating new parent frame is applied in that frame', () => {
    const d = doc([
      node('p', { rotation: [0, Math.PI / 2, 0] }),
      node('n', {
        position: [1, 0, 0],
        tracks: {
          parent: [{ t: 1, v: { node: 'p' } }],
          position: [
            { t: 1, v: [1, 0, 0] },
            { t: 2, v: [2, 0, 0] },
          ],
        },
      }),
    ]);
    // capture at 1: world [1,0,0] in p (Ry 90: local x -> world -z): local = Ry(-90) [1,0,0] = [0,0,1]
    close(createParentResolver(d).capture('n', 0)!.position, [0, 0, 1], 1e-12);
    // at 2: local = [0,0,1] + [1,0,0] -> world = Ry(90) [1,0,1] = [1, 0, -1]
    close(W(d, 2, 'n').position, [1, 0, -1], 1e-12);
  });

  it('snap: tracks are absolute in the new parent frame (pop is the author choice)', () => {
    const d = doc([
      node('p', { position: [5, 0, 0], rotation: [0, 0, Math.PI / 2] }),
      node('n', { position: [1, 0, 0], tracks: { parent: [{ t: 1, v: { node: 'p', snap: true } }] } }),
    ]);
    close(W(d, 0.5, 'n').position, [1, 0, 0], 1e-12);
    close(W(d, 1, 'n').position, [5, 1, 0], 1e-12);
    sameRot(W(d, 1, 'n').rotation, [0, 0, Math.PI / 2]);
    expect(createParentResolver(d).capture('n', 0)).toBeNull();
    // A capture after a snap key starts from the snapped placement
    const d2 = doc([
      d.nodes[0],
      node('n', { position: [1, 0, 0], tracks: { parent: [{ t: 1, v: { node: 'p', snap: true } }, { t: 2, v: null }] } }),
    ]);
    close(W(d2, 2.5, 'n').position, [5, 1, 0], 1e-12);
  });

  it('null release from a static parent keeps the world transform', () => {
    const d = doc([
      node('p', { position: [0, 2, 0], rotation: [0.4, 0.3, 0.2] }),
      node('n', { parent: 'p', position: [1, 1, 1], rotation: [0.1, 0.2, 0.3], tracks: { parent: [{ t: 1, v: null }] } }),
    ]);
    const a = W(d, 0.9, 'n');
    const b = W(d, 1, 'n');
    close(a.position, b.position, 1e-12);
    sameRot(a.rotation, b.rotation, 1e-12);
    expect(evaluateFrame(d, 1).nodes.n.parentRef).toEqual({ ref: null, key: 0 });
  });

  it('nested: a moving grandparent chain, and a simultaneous swap (hand-off) without recursion or pop', () => {
    // Carrier chain g -> h (both moving); n goes from world into h at 1; at 2, n is released AND h re-parents to n
    const d = doc([
      node('g', { tracks: { position: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [3, 0, 0] }], rotation: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [0, 2, 0] }] } }),
      node('h', {
        parent: 'g',
        position: [0, 1, 0],
        tracks: {
          rotation: [{ t: 0, v: [0, 0, 0] }, { t: 3, v: [1, 0, 0] }],
          parent: [{ t: 2, v: { node: 'n' } }],
        },
      }),
      node('n', {
        position: [2, 0, 0],
        tracks: {
          parent: [{ t: 1, v: { node: 'h' } }, { t: 2, v: null }],
          position: [{ t: 2, v: [2, 0, 0] }, { t: 3, v: [2, -1, 0] }],
        },
      }),
    ]);
    expect(validateDoc(d).ok).toBe(true);
    for (const id of ['n', 'h']) {
      for (const tk of [1, 2]) {
        const a = W(d, tk - 1e-9, id);
        const b = W(d, tk, id);
        close(a.position, b.position, 1e-6);
        sameRot(a.rotation, b.rotation, 1e-6);
      }
    }
    // After the swap h rides on n (n drops by 1 in the world), h keeps its offset to n
    const n25 = W(d, 2.5, 'n');
    const n3 = W(d, 3, 'n');
    close(n3.position.map((v, i) => v - n25.position[i]), [0, -0.5, 0], 1e-9);
    const h25 = W(d, 2.5, 'h');
    const h3 = W(d, 3, 'h');
    close(h3.position.map((v, i) => v - h25.position[i]), [0, -0.5, 0], 1e-9);
  });

  it('camera follow uses the re-parented world position', () => {
    const d = pickup();
    d.shots[0].camera.target = { follow: 'bottle', offset: [0, 1, 0] };
    for (const t of [0.5, 1.5, 2.5]) {
      const fs = evaluateFrame(d, t);
      close(fs.camera.target, W(d, t, 'bottle').position.map((v, i) => v + [0, 1, 0][i]), 1e-12);
    }
  });

  it('joints: jointFrame supplies the joint pose (frame and capture times); without it joints throw', () => {
    const m = node('m', { shape: 'model', model: { src: 'm.glb' }, position: [0, 0, 1] });
    const d = doc([
      m,
      node('b', { position: [0.5, 0, 0], tracks: { parent: [{ t: 1, v: { node: 'm', joint: 'hand' } }, { t: 2, v: null }] } }),
    ]);
    // Joint moves with time: at t in the model frame [t, 1, 0], turning about z by t
    const calls: [string, string, number][] = [];
    const jointFrame = (model: string, joint: string, t: number): JointFrame => {
      calls.push([model, joint, t]);
      return { position: [t, 1, 0], rotation: [0, 0, t] };
    };
    const r = createParentResolver(d, { jointFrame });
    r.captureAll();
    expect(calls).toEqual([['m', 'hand', 1], ['m', 'hand', 2]]);
    const at = (t: number) => r.world(evaluateFrame(d, t).nodes, 'b');
    const withTime = (t: number) => createParentResolver(d, { jointFrame, time: t }).world(evaluateFrame(d, t).nodes, 'b');
    // carried: world = M * J(t) * capture
    const cap = r.capture('b', 0)!;
    const w15 = withTime(1.5);
    close(w15.position, app(rz(1.5), cap.position).map((v, i) => v + [1.5, 1, 1][i]), 1e-12);
    // no pop at pick-up and release
    for (const tk of [1, 2]) {
      const a = withTime(tk - 1e-9);
      const b = withTime(tk);
      close(a.position, b.position, 1e-6);
      sameRot(a.rotation, b.rotation, 1e-6);
    }
    // after the release no joint frame of the frame time is needed
    close(at(3).position, withTime(2).position, 1e-12);
    expect(() => at(1.5)).toThrow(/options\.time/);
    expect(() => W(d, 3, 'b')).toThrow(/joint "hand" of model "m".*jointFrame/);
  });

  it('quaternion helpers round-trip Euler YXZ', () => {
    for (const e of [[0.3, -1.2, 2.5], [1.2, 0.4, -0.3], [-0.5, 3, 0.1]] as Vec3[]) sameRot(quatToEulerYXZ(eulerYXZToQuat(e)), e, 1e-12);
  });

  it('worldPosition of a doc without tracks.parent is unchanged (follow child of a rotating parent)', () => {
    const d = doc([node('p', { rotation: [0, Math.PI / 2, 0] }), node('c', { parent: 'p', position: [1, 0, 0] })]);
    close(worldPosition(d, evaluateFrame(d, 0).nodes, 'c'), [0, 0, -1], 1e-12);
  });
});

describe('tracks.parent validation', () => {
  const v = (nodes: PrevisNode[], target?: Shot['camera']['target']) => {
    const r = validateDoc(doc(nodes, target));
    return r.ok ? [] : r.issues;
  };
  const model = (id: string, extra: Partial<PrevisNode> = {}) => node(id, { shape: 'model', model: { src: `${id}.glb` }, ...extra });

  it('accepts the pick-up doc', () => {
    expect(v(pickup().nodes)).toEqual([]);
  });

  it('keys strictly increasing, existing node, not self, joint only on models, snap boolean, value shape', () => {
    const iss = v([
      node('a'),
      model('m'),
      node('n', {
        tracks: {
          parent: [
            { t: 1, v: { node: 'a' } },
            { t: 1, v: { node: 'nope' } },
            { t: 2, v: { node: 'n' } },
            { t: 3, v: { node: 'a', joint: 'hand' } },
            { t: 4, v: { node: 'm', joint: '' } },
            { t: 5, v: { node: 'm', joint: 'hand', snap: 'yes' as unknown as boolean } },
            { t: 6, v: 'm' as unknown as null },
            { t: 7, v: { node: 'm', joint: 'hand', snap: true } },
            { t: 8, v: null },
          ],
        },
      }),
    ]);
    const paths = iss.map((i) => i.path);
    expect(paths).toEqual([
      'nodes[2].tracks.parent[1].t',
      'nodes[2].tracks.parent[1].v.node',
      'nodes[2].tracks.parent[2].v.node',
      'nodes[2].tracks.parent[3].v.joint',
      'nodes[2].tracks.parent[4].v.joint',
      'nodes[2].tracks.parent[5].v.snap',
      'nodes[2].tracks.parent[6].v',
    ]);
    expect(iss[0].message).toMatch(/strictly increase/);
    expect(iss[1].message).toMatch(/"nope" does not exist/);
    expect(iss[2].message).toMatch(/own parent/);
    expect(iss[3].message).toMatch(/shape "model"/);
    expect(v([node('n', { tracks: { parent: [] } })]).map((i) => i.path)).toEqual(['nodes[0].tracks.parent']);
  });

  it('rejects parent cycles at any key time, not only the static state', () => {
    // static: b under a. At t=1 a goes under b -> cycle a <-> b at t=1
    const iss = v([node('a', { tracks: { parent: [{ t: 1, v: { node: 'b' } }] } }), node('b', { parent: 'a' })]);
    expect(iss.map((i) => i.path)).toEqual(['nodes[0].tracks.parent[0].v.node']);
    expect(iss[0].message).toMatch(/parent cycle at t=1 through nodes "a", "b"/);
    // a cycle formed only by two tracks (keys at different times)
    const iss2 = v([
      node('a', { tracks: { parent: [{ t: 1, v: { node: 'b' } }] } }),
      node('b', { tracks: { parent: [{ t: 0.5, v: { node: 'c' } }] } }),
      node('c', { tracks: { parent: [{ t: 2, v: { node: 'a' } }] } }),
    ]);
    expect(iss2.map((i) => i.path)).toEqual(['nodes[0].tracks.parent[0].v.node']);
    expect(iss2[0].message).toMatch(/t=2 /);
    // the swap is fine: b leaves a in the same instant a goes under b
    expect(v([node('a', { tracks: { parent: [{ t: 1, v: { node: 'b' } }] } }), node('b', { parent: 'a', tracks: { parent: [{ t: 1, v: null }] } })])).toEqual([]);
    // released before: no cycle
    expect(v([node('a', { tracks: { parent: [{ t: 1, v: { node: 'b' } }] } }), node('b', { parent: 'a', tracks: { parent: [{ t: 0.5, v: null }] } })])).toEqual([]);
    // static cycles keep their old report (once)
    expect(v([node('a', { parent: 'b', tracks: { parent: [{ t: 1, v: null }] } }), node('b', { parent: 'a' })]).map((i) => i.path)).toEqual(['nodes[0].parent']);
  });

  it('camera cannot follow a node (or ancestor) that hangs from a joint at any time', () => {
    const nodes = [model('m'), node('b', { tracks: { parent: [{ t: 1, v: { node: 'm', joint: 'hand' } }, { t: 2, v: null }] } }), node('cap', { parent: 'b' })];
    for (const id of ['b', 'cap']) {
      const iss = v(nodes, { follow: id });
      expect(iss.map((i) => i.path)).toEqual(['shots[0].camera.target.follow']);
      expect(iss[0].message).toMatch(/joint "hand" of model "m" \(tracks.parent from t=1\)/);
    }
    // a node that hangs at some time from a node with a static parentJoint
    const iss = v([model('m'), node('h', { parent: 'm', parentJoint: 'hand' }), node('b', { tracks: { parent: [{ t: 1, v: { node: 'h' } }] } })], { follow: 'b' });
    expect(iss[0].message).toMatch(/through node "h" from joint "hand" of model "m"/);
    // without any joint: allowed; the model itself: allowed
    expect(v(pickup().nodes, { follow: 'bottle' })).toEqual([]);
    expect(v(nodes, { follow: 'm' })).toEqual([]);
  });
});

describe('modelSrcsToLoad with tracks.parent', () => {
  it('a hidden model referenced by a tracks.parent joint ref is loaded; a plain ref is not enough', () => {
    const m = node('m', { shape: 'model', model: { src: 'm.glb' }, visible: false });
    expect(modelSrcsToLoad(doc([m, node('b', { tracks: { parent: [{ t: 1, v: { node: 'm', joint: 'hand' } }] } })]))).toEqual(['m.glb']);
    expect(modelSrcsToLoad(doc([m, node('b', { tracks: { parent: [{ t: 1, v: { node: 'm' } }, { t: 2, v: null }] } })]))).toEqual([]);
  });
});
