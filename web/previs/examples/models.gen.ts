// Generator for the glTF demo models (previs/examples/models/*.glb) and model-demo.json.
// Procedural geometry only, no external assets. Run from web/:
//   node --experimental-strip-types previs/examples/models.gen.ts
// Files: mug.glb (static, 0.1 m), tiny-mm.glb (same mug authored in millimeters, 100 units tall),
// walker.glb (rigid segments on a node hierarchy, ~1.75 m, clips `walk` 1 s and `wave` 2 s),
// tail.glb (skinned strip, 4 joints, clip `sway`).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'models');

// ---------------------------------------------------------------------------
// Mesh helpers (indexed triangles, CCW outward)
// ---------------------------------------------------------------------------

interface Mesh {
  pos: number[];
  idx: number[];
}
type V3 = [number, number, number];

const emptyMesh = (): Mesh => ({ pos: [], idx: [] });

function merge(...meshes: Mesh[]): Mesh {
  const out = emptyMesh();
  for (const m of meshes) {
    const base = out.pos.length / 3;
    out.pos.push(...m.pos);
    for (const i of m.idx) out.idx.push(base + i);
  }
  return out;
}

function translate(m: Mesh, [dx, dy, dz]: V3): Mesh {
  const pos = m.pos.slice();
  for (let i = 0; i < pos.length; i += 3) {
    pos[i] += dx;
    pos[i + 1] += dy;
    pos[i + 2] += dz;
  }
  return { pos, idx: m.idx };
}

function scaleMesh(m: Mesh, k: number): Mesh {
  return { pos: m.pos.map((v) => v * k), idx: m.idx };
}

/** Box with its own 4 vertices per face (flat normals after `normals`). */
function box(sx: number, sy: number, sz: number, center: V3 = [0, 0, 0]): Mesh {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const faces: V3[][] = [
    [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz]], // +x
    [[-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz], [-hx, -hy, -hz]], // -x
    [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], // +y
    [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], // -y
    [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], // +z
    [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], // -z
  ];
  const m = emptyMesh();
  for (const f of faces) {
    const b = m.pos.length / 3;
    for (const p of f) m.pos.push(p[0] + center[0], p[1] + center[1], p[2] + center[2]);
    m.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return m;
}

/**
 * Surface of revolution about +Y. `profile` = [radius, y] points; the surface normal faces the
 * side that is to the RIGHT of the walk direction when looking at (r, y) with r to the right,
 * i.e. walking the profile bottom -> top outside, top -> bottom inside gives outward normals.
 */
function lathe(profile: [number, number][], seg: number): Mesh {
  const m = emptyMesh();
  for (const [r, y] of profile) {
    for (let s = 0; s < seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      m.pos.push(r * Math.cos(a), y, -r * Math.sin(a));
    }
  }
  for (let i = 0; i < profile.length - 1; i++) {
    for (let s = 0; s < seg; s++) {
      const s1 = (s + 1) % seg;
      const a = i * seg + s;
      const b = i * seg + s1;
      const c = (i + 1) * seg + s1;
      const d = (i + 1) * seg + s;
      m.idx.push(a, c, d, a, b, c);
    }
  }
  return m;
}

/** Closed cylinder along Y, from y0 to y1. */
function cylinder(r: number, y0: number, y1: number, seg = 14): Mesh {
  return lathe(
    [
      [0, y0],
      [r, y0],
      [r, y1],
      [0, y1],
    ],
    seg,
  );
}

/** Torus (partial sweep a0..a1 radians in the XY plane) with its axis along +Z: ring radius R, tube radius r. */
function torus(R: number, r: number, a0: number, a1: number, ringSeg: number, tubeSeg: number): Mesh {
  const m = emptyMesh();
  for (let i = 0; i <= ringSeg; i++) {
    const a = a0 + ((a1 - a0) * i) / ringSeg;
    for (let j = 0; j < tubeSeg; j++) {
      const b = (j / tubeSeg) * Math.PI * 2;
      const rr = R + r * Math.cos(b);
      m.pos.push(rr * Math.cos(a), rr * Math.sin(a), r * Math.sin(b));
    }
  }
  for (let i = 0; i < ringSeg; i++) {
    for (let j = 0; j < tubeSeg; j++) {
      const j1 = (j + 1) % tubeSeg;
      const a = i * tubeSeg + j;
      const b = i * tubeSeg + j1;
      const c = (i + 1) * tubeSeg + j1;
      const d = (i + 1) * tubeSeg + j;
      m.idx.push(a, c, b, a, d, c);
    }
  }
  return m;
}

/** Area-weighted smooth vertex normals. */
function normals(m: Mesh): number[] {
  const n = new Array<number>(m.pos.length).fill(0);
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t] * 3, m.idx[t + 1] * 3, m.idx[t + 2] * 3];
    const e1: V3 = [m.pos[b] - m.pos[a], m.pos[b + 1] - m.pos[a + 1], m.pos[b + 2] - m.pos[a + 2]];
    const e2: V3 = [m.pos[c] - m.pos[a], m.pos[c + 1] - m.pos[a + 1], m.pos[c + 2] - m.pos[a + 2]];
    const f: V3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    for (const v of [a, b, c]) {
      n[v] += f[0];
      n[v + 1] += f[1];
      n[v + 2] += f[2];
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  return n;
}

/** Signed volume (positive = outward CCW winding for a closed mesh). */
export function signedVolume(m: Mesh): number {
  let v = 0;
  for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t] * 3, m.idx[t + 1] * 3, m.idx[t + 2] * 3];
    const p = (o: number) => [m.pos[o], m.pos[o + 1], m.pos[o + 2]];
    const [pa, pb, pc] = [p(a), p(b), p(c)];
    v += (pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) - pa[1] * (pb[0] * pc[2] - pb[2] * pc[0]) + pa[2] * (pb[0] * pc[1] - pb[1] * pc[0])) / 6;
  }
  return v;
}

// ---------------------------------------------------------------------------
// GLB writer
// ---------------------------------------------------------------------------

class Bin {
  private chunks: Uint8Array[] = [];
  private length = 0;
  readonly bufferViews: Record<string, unknown>[] = [];
  readonly accessors: Record<string, unknown>[] = [];

  /** Appends data as a 4-byte aligned bufferView + accessor; returns the accessor index. */
  accessor(
    data: Float32Array | Uint16Array | Uint8Array,
    type: 'SCALAR' | 'VEC3' | 'VEC4' | 'MAT4',
    target?: 34962 | 34963,
    minmax = false,
  ): number {
    const pad = (4 - (this.length % 4)) % 4;
    if (pad) this.push(new Uint8Array(pad));
    const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    this.bufferViews.push({ buffer: 0, byteOffset: this.length, byteLength: bytes.byteLength, ...(target ? { target } : {}) });
    this.push(bytes);
    const comps = { SCALAR: 1, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const componentType = data instanceof Float32Array ? 5126 : data instanceof Uint16Array ? 5123 : 5121;
    const count = data.length / comps;
    const acc: Record<string, unknown> = { bufferView: this.bufferViews.length - 1, componentType, count, type };
    if (minmax) {
      const min = new Array<number>(comps).fill(Infinity);
      const max = new Array<number>(comps).fill(-Infinity);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < comps; c++) {
          min[c] = Math.min(min[c], data[i * comps + c]);
          max[c] = Math.max(max[c], data[i * comps + c]);
        }
      }
      acc.min = min;
      acc.max = max;
    }
    this.accessors.push(acc);
    return this.accessors.length - 1;
  }

  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.chunks) {
      out.set(p, o);
      o += p.byteLength;
    }
    return out;
  }

  private push(b: Uint8Array) {
    this.chunks.push(b);
    this.length += b.byteLength;
  }
}

function writeGlb(json: object, bin: Uint8Array): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = Math.ceil(text.byteLength / 4) * 4;
  const binLen = Math.ceil(bin.byteLength / 4) * 4;
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.fill(0x20, 20, 20 + jsonLen);
  out.set(text, 20);
  const o = 20 + jsonLen;
  dv.setUint32(o, binLen, true);
  dv.setUint32(o + 4, 0x004e4942, true); // 'BIN\0'
  out.set(bin, o + 8);
  return out;
}

interface Prim {
  mesh: Mesh;
  skin?: { joints: Uint16Array; weights: Float32Array };
}

/** Adds a mesh to the builder; returns the glTF mesh index. */
function addMesh(bin: Bin, meshes: object[], prim: Prim): number {
  const { mesh } = prim;
  if (mesh.pos.length / 3 > 65535) throw new Error('mesh too large for 16-bit indices');
  const attributes: Record<string, number> = {
    POSITION: bin.accessor(new Float32Array(mesh.pos), 'VEC3', 34962, true),
    NORMAL: bin.accessor(new Float32Array(normals(mesh)), 'VEC3', 34962),
  };
  if (prim.skin) {
    attributes.JOINTS_0 = bin.accessor(prim.skin.joints, 'VEC4', 34962);
    attributes.WEIGHTS_0 = bin.accessor(prim.skin.weights, 'VEC4', 34962);
  }
  const indices = bin.accessor(new Uint16Array(mesh.idx), 'SCALAR', 34963);
  meshes.push({ primitives: [{ attributes, indices, material: 0, mode: 4 }] });
  return meshes.length - 1;
}

const MATERIAL = { name: 'flat', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.8, 0.8, 1], metallicFactor: 0, roughnessFactor: 0.9 } };

// ---------------------------------------------------------------------------
// Quaternions (xyzw)
// ---------------------------------------------------------------------------

type Q = [number, number, number, number];
const deg = (d: number) => (d * Math.PI) / 180;
const qx = (d: number): Q => [Math.sin(deg(d) / 2), 0, 0, Math.cos(deg(d) / 2)];
const qy = (d: number): Q => [0, Math.sin(deg(d) / 2), 0, Math.cos(deg(d) / 2)];
const qz = (d: number): Q => [0, 0, Math.sin(deg(d) / 2), Math.cos(deg(d) / 2)];

// ---------------------------------------------------------------------------
// mug (unit scale: 1 = 1 m for mug.glb, 1000 for tiny-mm.glb)
// ---------------------------------------------------------------------------

function mugMesh(k: number): Mesh {
  const R = 0.04;
  const wall = 0.0035;
  const H = 0.1;
  const floor = 0.008;
  // outside bottom -> up, over the lip, inside down to the floor: outward-facing normals
  const body = lathe(
    [
      [0, 0],
      [R - 0.003, 0],
      [R, 0.003],
      [R, H],
      [R - wall, H],
      [R - wall, floor],
      [0, floor],
    ],
    32,
  );
  // handle: half ring on +x side, centered on the wall
  const handle = translate(torus(0.026, 0.0055, -Math.PI * 0.62, Math.PI * 0.62, 20, 10), [R - 0.001, H * 0.52, 0]);
  return scaleMesh(merge(body, handle), k);
}

function buildMug(k: number): Uint8Array {
  const bin = new Bin();
  const meshes: object[] = [];
  addMesh(bin, meshes, { mesh: mugMesh(k) });
  return writeGlb(
    {
      asset: { version: '2.0', generator: 'charturbo previs models.gen.ts' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: k === 1 ? 'mug' : 'mug_mm', mesh: 0 }],
      meshes,
      materials: [MATERIAL],
      accessors: bin.accessors,
      bufferViews: bin.bufferViews,
      buffers: [{ byteLength: bin.bytes().byteLength }],
    },
    bin.bytes(),
  );
}

// ---------------------------------------------------------------------------
// walker: rigid segments on a node hierarchy, facing +Z, feet at y = 0
// ---------------------------------------------------------------------------

interface NodeDef {
  name: string;
  mesh?: number;
  translation?: V3;
  rotation?: Q;
  children?: number[];
}

interface Channel {
  node: number;
  path: 'translation' | 'rotation';
  values: number[][];
}

/** Writes animation samplers sharing `times`. */
function addAnimation(bin: Bin, name: string, times: number[], channels: Channel[]): object {
  const input = bin.accessor(new Float32Array(times), 'SCALAR', undefined, true);
  const samplers: object[] = [];
  const outChannels: object[] = [];
  for (const ch of channels) {
    const flat = new Float32Array(ch.values.flat());
    const output = bin.accessor(flat, ch.path === 'rotation' ? 'VEC4' : 'VEC3');
    samplers.push({ input, output, interpolation: 'LINEAR' });
    outChannels.push({ sampler: samplers.length - 1, target: { node: ch.node, path: ch.path } });
  }
  return { name, samplers, channels: outChannels };
}

function buildWalker(): Uint8Array {
  const bin = new Bin();
  const meshes: object[] = [];
  const mesh = (m: Mesh) => addMesh(bin, meshes, { mesh: m });

  // segment lengths (m): feet bottom at y = 0 -> top of head 1.75
  const HIPS_Y = 0.94;
  const UL = 0.46; // upper leg
  const LL = 0.44; // lower leg (ankle at 0.04)
  const TORSO = 0.5;
  const HEAD = 0.25;
  const UA = 0.3; // upper arm
  const FA = 0.28; // forearm + hand

  const mHips = mesh(box(0.3, 0.14, 0.18, [0, 0.0, 0]));
  const mTorso = mesh(box(0.34, TORSO, 0.2, [0, TORSO / 2, 0]));
  const mHead = mesh(box(0.2, HEAD, 0.22, [0, HEAD / 2, 0]));
  const mUpperLeg = mesh(cylinder(0.062, -UL, 0));
  const mLowerLeg = mesh(merge(cylinder(0.05, -LL, 0), box(0.1, 0.04, 0.24, [0, -LL - 0.02, 0.05])));
  const mUpperArm = mesh(cylinder(0.044, -UA, 0));
  const mForearm = mesh(cylinder(0.038, -FA, 0));

  const nodes: NodeDef[] = [];
  const add = (n: NodeDef): number => nodes.push(n) - 1;
  const link = (parent: number, child: number) => ((nodes[parent].children ??= []).push(child), child);

  const root = add({ name: 'walker' });
  const hips = link(root, add({ name: 'hips', mesh: mHips, translation: [0, HIPS_Y, 0] }));
  const torso = link(hips, add({ name: 'torso', mesh: mTorso, translation: [0, 0.04, 0] }));
  const head = link(torso, add({ name: 'head', mesh: mHead, translation: [0, TORSO, 0] }));
  const side = (s: 1 | -1, tag: string) => {
    const hipJ = link(hips, add({ name: `upperLeg.${tag}`, mesh: mUpperLeg, translation: [0.09 * s, -0.02, 0] }));
    const knee = link(hipJ, add({ name: `lowerLeg.${tag}`, mesh: mLowerLeg, translation: [0, -UL, 0] }));
    const shoulder = link(torso, add({ name: `upperArm.${tag}`, mesh: mUpperArm, translation: [0.23 * s, TORSO - 0.05, 0], rotation: qz(-6 * s) }));
    const elbow = link(shoulder, add({ name: `lowerArm.${tag}`, mesh: mForearm, translation: [0, -UA, 0], rotation: qx(-12) }));
    return { hipJ, knee, shoulder, elbow };
  };
  const R = side(1, 'R');
  const L = side(-1, 'L');

  // feet bottom: hips (HIPS_Y + 0.02) - 0.02 - UL - LL - 0.04 = 0; top of head: + 0.04 + TORSO + HEAD = 1.75
  nodes[torso].translation = [0, 0.04, 0];
  nodes[hips].translation = [0, HIPS_Y + 0.02, 0];

  // --- walk: 1.0 s loop ---
  const N = 12;
  const times = Array.from({ length: N + 1 }, (_, i) => i / N);
  const wave = (f: (ph: number) => number) => times.map((t) => f(t * Math.PI * 2));
  const rot = (axis: (d: number) => Q, fn: (ph: number) => number): number[][] => wave(fn).map((d) => axis(d));
  const walk = addAnimation(bin, 'walk', times, [
    { node: R.hipJ, path: 'rotation', values: rot(qx, (p) => -28 * Math.sin(p)) },
    { node: L.hipJ, path: 'rotation', values: rot(qx, (p) => 28 * Math.sin(p)) },
    { node: R.knee, path: 'rotation', values: rot(qx, (p) => 8 + 32 * Math.max(0, Math.cos(p))) },
    { node: L.knee, path: 'rotation', values: rot(qx, (p) => 8 + 32 * Math.max(0, -Math.cos(p))) },
    { node: R.shoulder, path: 'rotation', values: wave((p) => 22 * Math.sin(p)).map((d) => mulQ(qz(-6), qx(d))) },
    { node: L.shoulder, path: 'rotation', values: wave((p) => -22 * Math.sin(p)).map((d) => mulQ(qz(6), qx(d))) },
    { node: torso, path: 'rotation', values: rot(qy, (p) => 5 * Math.sin(p)) },
    { node: hips, path: 'translation', values: wave((p) => 0.02 * Math.cos(p * 2)).map((dy) => [0, HIPS_Y + 0.02 + dy, 0]) },
  ]);

  // --- wave: 2.0 s, right arm up and forearm waves ---
  const wt = [0, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 2.0];
  const up = (d: number): Q => mulQ(qz(-6), qz(d));
  const waveAnim = addAnimation(bin, 'wave', wt, [
    { node: R.shoulder, path: 'rotation', values: [0, 150, 150, 150, 150, 150, 150, 150, 0].map(up) },
    { node: R.elbow, path: 'rotation', values: [0, 0, 28, -28, 28, -28, 28, 0, 0].map((d) => mulQ(qx(-12), qz(d))) },
    { node: head, path: 'rotation', values: [0, 10, 10, 10, 10, 10, 10, 10, 0].map(qy) },
  ]);

  const json = {
    asset: { version: '2.0', generator: 'charturbo previs models.gen.ts' },
    scene: 0,
    scenes: [{ nodes: [root] }],
    nodes: nodes.map((n) => ({
      name: n.name,
      ...(n.mesh !== undefined ? { mesh: n.mesh } : {}),
      ...(n.translation ? { translation: n.translation } : {}),
      ...(n.rotation ? { rotation: n.rotation } : {}),
      ...(n.children ? { children: n.children } : {}),
    })),
    meshes,
    materials: [MATERIAL],
    animations: [walk, waveAnim],
    accessors: bin.accessors,
    bufferViews: bin.bufferViews,
    buffers: [{ byteLength: bin.bytes().byteLength }],
  };
  return writeGlb(json, bin.bytes());
}

/** Quaternion product a * b (xyzw). */
function mulQ(a: Q, b: Q): Q {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

// ---------------------------------------------------------------------------
// tail: skinned rectangular tube along +Y, 4 joints
// ---------------------------------------------------------------------------

function buildTail(): Uint8Array {
  const bin = new Bin();
  const meshes: object[] = [];
  const LEN = 1.0;
  const ROWS = 17;
  const JOINTS = 4;
  const spacing = LEN / JOINTS; // joints at y = 0, .25, .5, .75
  const mesh = emptyMesh();
  const joints: number[] = [];
  const weights: number[] = [];
  const hw = 0.06;
  const hd = 0.02;
  for (let r = 0; r < ROWS; r++) {
    const y = (r / (ROWS - 1)) * LEN;
    const taper = 1 - 0.55 * (y / LEN);
    const corners: [number, number][] = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    // joint blend: joint j sits at y = j * spacing; linear between neighbours
    const f = Math.min(y / spacing, JOINTS - 1);
    const j0 = Math.min(Math.floor(f), JOINTS - 1);
    const j1 = Math.min(j0 + 1, JOINTS - 1);
    const w1 = j1 === j0 ? 0 : f - j0;
    for (const [cx, cz] of corners) {
      mesh.pos.push(cx * taper, y, cz * taper);
      joints.push(j0, j1, 0, 0);
      weights.push(1 - w1, w1, 0, 0);
    }
  }
  for (let r = 0; r < ROWS - 1; r++) {
    for (let c = 0; c < 4; c++) {
      const c1 = (c + 1) % 4;
      const a = r * 4 + c;
      const b = r * 4 + c1;
      const cc = (r + 1) * 4 + c1;
      const d = (r + 1) * 4 + c;
      mesh.idx.push(a, cc, b, a, d, cc);
    }
  }
  // end caps: bottom faces down, top faces up
  mesh.idx.push(0, 1, 2, 0, 2, 3);
  const t = (ROWS - 1) * 4;
  mesh.idx.push(t, t + 2, t + 1, t, t + 3, t + 2);

  const meshIdx = addMesh(bin, meshes, { mesh, skin: { joints: new Uint16Array(joints), weights: new Float32Array(weights) } });
  const ibm = new Float32Array(JOINTS * 16);
  for (let j = 0; j < JOINTS; j++) {
    for (let c = 0; c < 16; c += 5) ibm[j * 16 + c] = 1;
    ibm[j * 16 + 13] = -j * spacing;
  }
  const ibmAcc = bin.accessor(ibm, 'MAT4');

  // nodes: 0..3 joint chain, 4 mesh node
  const nodes: object[] = [];
  for (let j = 0; j < JOINTS; j++) {
    nodes.push({ name: `joint${j}`, ...(j === 0 ? {} : { translation: [0, spacing, 0] }), ...(j < JOINTS - 1 ? { children: [j + 1] } : {}) });
  }
  nodes.push({ name: 'tailMesh', mesh: meshIdx, skin: 0 });

  const N = 16;
  const times = Array.from({ length: N + 1 }, (_, i) => (i / N) * 2);
  const channels: Channel[] = [];
  for (let j = 0; j < JOINTS; j++) {
    const amp = 12 + 4 * j;
    channels.push({
      node: j,
      path: 'rotation',
      values: times.map((tt) => {
        const ph = (tt / 2) * Math.PI * 2 - j * 0.7;
        return mulQ(qz(amp * Math.sin(ph)), qx(4 * Math.sin(ph + 1)));
      }),
    });
  }
  const sway = addAnimation(bin, 'sway', times, channels);

  return writeGlb(
    {
      asset: { version: '2.0', generator: 'charturbo previs models.gen.ts' },
      scene: 0,
      scenes: [{ nodes: [0, 4] }],
      nodes,
      meshes,
      materials: [MATERIAL],
      skins: [{ name: 'tailSkin', inverseBindMatrices: ibmAcc, joints: [0, 1, 2, 3], skeleton: 0 }],
      animations: [sway],
      accessors: bin.accessors,
      bufferViews: bin.bufferViews,
      buffers: [{ byteLength: bin.bytes().byteLength }],
    },
    bin.bytes(),
  );
}

// ---------------------------------------------------------------------------
// previs doc
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];
const key = <T>(t: number, v: T) => ({ t, v });
const node = (n: Record<string, unknown>) => ({ rotation: [0, 0, 0], ...n });

function buildDoc() {
  const cWalker: Rgb = [0.9, 0.35, 0.15];
  const cMug: Rgb = [0.2, 0.45, 0.9];
  const cTail: Rgb = [0.25, 0.75, 0.35];
  const cTiny: Rgb = [0.95, 0.8, 0.15];
  const cTable: Rgb = [0.55, 0.5, 0.45];
  return {
    version: 1,
    title: 'model demo (glTF nodes)',
    fps: 24,
    size: { width: 640, height: 360 },
    background: [0.82, 0.86, 0.9],
    roles: [
      { id: 'walker', label: 'walking person', color: cWalker },
      { id: 'mug', label: 'coffee mug (meters)', color: cMug },
      { id: 'tiny', label: 'coffee mug (authored in mm)', color: cTiny },
      { id: 'tail', label: 'swaying tail', color: cTail },
      { id: 'table', label: 'table', color: cTable },
    ],
    nodes: [
      node({ id: 'ground', shape: 'box', color: [0.68, 0.7, 0.66], position: [0, -0.01, -1], size: [14, 0.02, 8] }),
      node({
        id: 'walker',
        shape: 'model',
        model: { src: 'models/walker.glb', animation: { clip: 'walk', loop: 'repeat' } },
        role: 'walker',
        color: cWalker,
        position: [-3.2, 0.875, -3.5],
        rotation: [0, Math.PI / 2, 0],
        size: [0.7, 1.75, 0.5],
        tracks: { position: [key(0, [-3.2, 0.875, -3.5]), key(4, [3.2, 0.875, -3.5])] },
      }),
      node({ id: 'table', shape: 'box', role: 'table', color: cTable, position: [-1, 0.375, -2], size: [1.6, 0.75, 0.8] }),
      node({
        id: 'mug',
        shape: 'model',
        model: { src: 'models/mug.glb', fit: 'contain' },
        role: 'mug',
        color: cMug,
        position: [-1.3, 0.8, -2],
        size: [0.12, 0.1, 0.1],
      }),
      node({
        id: 'tinyMug',
        shape: 'model',
        model: { src: 'models/tiny-mm.glb', fit: 'contain' },
        role: 'tiny',
        color: cTiny,
        position: [-0.7, 0.8, -2],
        size: [0.12, 0.1, 0.1],
      }),
      node({
        id: 'tail',
        shape: 'model',
        model: { src: 'models/tail.glb', animation: { clip: 'sway', loop: 'repeat', speed: 1 } },
        role: 'tail',
        color: cTail,
        position: [2, 0.5, -2],
        size: [0.5, 1, 0.2],
      }),
    ],
    shots: [
      {
        id: 'wide',
        start: 0,
        end: 1.6,
        camera: { position: [{ t: 0, v: [0, 1.5, 6] }, { t: 1.6, v: [0.6, 1.5, 5.4] }], target: { track: [{ t: 0, v: [0, 0.9, -0.5] }] } },
      },
      {
        id: 'mugs',
        start: 1.6,
        end: 3,
        camera: { position: [{ t: 1.6, v: [-1, 1.35, 0.4] }, { t: 3, v: [-1, 1.2, 0] }], target: { track: [{ t: 1.6, v: [-1, 0.85, -2] }] } },
      },
      {
        id: 'tail',
        start: 3,
        end: 4,
        camera: { position: [{ t: 3, v: [2, 1.1, 1.8] }], target: { track: [{ t: 3, v: [2, 0.55, -2] }] } },
      },
    ],
  };
}

// ---------------------------------------------------------------------------

fs.mkdirSync(OUT, { recursive: true });
const files: [string, Uint8Array][] = [
  ['mug.glb', buildMug(1)],
  ['tiny-mm.glb', buildMug(1000)],
  ['walker.glb', buildWalker()],
  ['tail.glb', buildTail()],
];
for (const [name, bytes] of files) {
  fs.writeFileSync(path.join(OUT, name), bytes);
  console.log('wrote', path.join(OUT, name), bytes.byteLength, 'bytes');
}
const docPath = path.join(HERE, 'model-demo.json');
fs.writeFileSync(docPath, JSON.stringify(buildDoc(), null, 2) + '\n');
console.log('wrote', docPath);
