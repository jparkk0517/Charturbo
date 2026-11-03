import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasGltfGeometry } from '../sdk/scene-gltf-anim';
import { drawnScene } from './drawn-scene';

// GltfAnimator.posedMinAlong against an independent reference: the vertices, mesh matrices and joint palettes the
// engine received (recorded by drawnScene), skinned / transformed per vertex.

const model = (name: string): ArrayBuffer => {
  const b = readFileSync(fileURLToPath(new URL(`../../previs/examples/models/${name}`, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

type V3 = [number, number, number];

/** min over the drawn model-space vertices of axis . v (reference). */
function referenceMin(scene: ReturnType<typeof drawnScene>, ids: number[], axis: V3): number {
  let min = Infinity;
  for (const id of ids) {
    const o = scene.objects.get(id)!;
    for (const v of new Set(o.indices!)) {
      const p = scene.localVertex(o, v);
      min = Math.min(min, axis[0] * p[0] + axis[1] * p[1] + axis[2] * p[2]);
    }
  }
  return min;
}

const AXES: V3[] = [
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [0.3, 0.8, -0.52],
  [-2, 0.5, 1.5],
];

const q = (axis: V3, rad: number): [number, number, number, number] => {
  const s = Math.sin(rad / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(rad / 2)];
};

describe('GltfAnimator.posedMinAlong', () => {
  it('rigid node hierarchy (walker.glb): clips, blends and setNodeRotations, per vertex', async () => {
    const scene = drawnScene();
    const r = await scene.sdk.loadGltf(model('walker.glb'), { textures: false, posable: ['upperLeg.R', 'lowerLeg.R'], scale: 1.7, readback: true });
    const anim = scene.sdk.createGltfAnimator(r, { autoUpdate: false });
    const check = () => {
      for (const a of AXES) expect(anim.posedMinAlong(a)).toBeCloseTo(referenceMin(scene, r.objects, a), 9);
    };
    check(); // rest pose the loader sent, before any pose
    expect(anim.posedMinAlong([0, 1, 0])).toBeCloseTo(r.bounds.min[1], 6);
    for (const t of [0, 0.13, 0.5, 0.77]) {
      anim.setBlend([{ clip: 'walk', time: t, weight: 1 }]);
      check();
    }
    anim.setBlend([
      { clip: 'walk', time: 0.3, weight: 0.4 },
      { clip: 'wave', time: 0.9, weight: 0.6 },
    ]);
    check();
    anim.setNodeRotations([
      { node: 'upperLeg.R', rotation: q([1, 0, 0], -1.2) },
      { node: 'lowerLeg.R', rotation: q([1, 0, 0], 2.0) },
    ]);
    check();
    // The raised knee reaches forward (+z): the pose really changed the read-back
    const front = anim.posedMinAlong([0, 0, -1]);
    anim.setNodeRotations([]);
    expect(anim.posedMinAlong([0, 0, -1])).toBeGreaterThan(front + 0.1);
    check();
  });

  it('skinned mesh (tail.glb): linear-blend skinning with the palette sent, normalized weights', async () => {
    const scene = drawnScene();
    const r = await scene.sdk.loadGltf(model('tail.glb'), { textures: false, readback: true });
    const anim = scene.sdk.createGltfAnimator(r, { autoUpdate: false });
    const skinned = r.objects.filter((id) => scene.objects.get(id)!.skin);
    expect(skinned.length).toBe(1);
    for (const a of AXES) expect(anim.posedMinAlong(a)).toBeCloseTo(referenceMin(scene, r.objects, a), 9);
    for (const t of [0.2, 0.9, 1.6]) {
      anim.setBlend([{ clip: 'sway', time: t, weight: 1 }]);
      anim.setNodeRotations([{ node: 'joint2', rotation: q([0, 0, 1], 0.8) }]);
      for (const a of AXES) expect(anim.posedMinAlong(a)).toBeCloseTo(referenceMin(scene, r.objects, a), 9);
    }
  });

  it('static model without a rig: baked vertices, vertices no triangle uses are skipped', async () => {
    // One triangle plus a far vertex (index 3) that no triangle references
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -100, 0]);
    const idx = new Uint16Array([0, 1, 2, 0]);
    const bytes = new Uint8Array(pos.byteLength + idx.byteLength);
    bytes.set(new Uint8Array(pos.buffer), 0);
    bytes.set(new Uint8Array(idx.buffer), pos.byteLength);
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ name: 'tri', mesh: 0, translation: [0, 2, 0], rotation: q([0, 0, 1], Math.PI / 2) }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, -100, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
        { buffer: 0, byteOffset: pos.byteLength, byteLength: 6 },
      ],
      buffers: [{ byteLength: bytes.byteLength, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    };
    const scene = drawnScene();
    const r = await scene.sdk.loadGltf(new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer, { scale: 2, readback: true });
    const anim = scene.sdk.createGltfAnimator(r, { autoUpdate: false });
    // Baked: (x, y) -> (-y, x) rotated, +2 up, x2 load scale; lowest drawn y = 2 * (2 + 0) = 4
    expect(anim.posedMinAlong([0, 1, 0])).toBeCloseTo(4, 6);
    expect(anim.posedMinAlong([1, 0, 0])).toBeCloseTo(-2, 6);
    for (const a of AXES) expect(anim.posedMinAlong(a)).toBeCloseTo(referenceMin(scene, r.objects, a), 9);
  });

  it('keeps CPU vertices only with readback: true, and drops them on disposeGltf', async () => {
    const scene = drawnScene();
    const plain = await scene.sdk.loadGltf(model('walker.glb'), { textures: false });
    expect(hasGltfGeometry(plain)).toBe(false);
    const anim = scene.sdk.createGltfAnimator(plain, { autoUpdate: false });
    expect(() => anim.posedMinAlong([0, 1, 0])).toThrow(
      'GltfAnimator.posedMinAlong: no CPU vertices kept for this model; load it with loadGltf(..., { readback: true })'
    );
    const kept = await scene.sdk.loadGltf(model('tail.glb'), { textures: false, readback: true });
    expect(hasGltfGeometry(kept)).toBe(true);
    const a2 = scene.sdk.createGltfAnimator(kept, { autoUpdate: false });
    expect(Number.isFinite(a2.posedMinAlong([0, 1, 0]))).toBe(true);
    expect(hasGltfGeometry(kept)).toBe(true); // compact form after the first read-back
    scene.sdk.disposeGltf(kept);
    expect(hasGltfGeometry(kept)).toBe(false);
  });

  it('validates the axis and the animator', async () => {
    const scene = drawnScene();
    const r = await scene.sdk.loadGltf(model('walker.glb'), { textures: false, readback: true });
    const anim = scene.sdk.createGltfAnimator(r, { autoUpdate: false });
    expect(() => anim.posedMinAlong([0, NaN, 0])).toThrow('GltfAnimator.posedMinAlong: axis must be 3 finite numbers');
    expect(() => anim.posedMinAlong([0, 1] as unknown as V3)).toThrow('axis must be 3 finite numbers');
    anim.dispose();
    expect(() => anim.posedMinAlong([0, 1, 0])).toThrow('GltfAnimator.posedMinAlong: the animator is disposed');
  });

  it('cost: 50k-vertex skinned and rigid models (logged; loose bound)', async () => {
    const N = 50_000;
    const JOINTS = 24;
    const pos = new Float32Array(N * 3);
    const joints = new Uint16Array(N * 4);
    const weights = new Float32Array(N * 4);
    for (let v = 0; v < N; v++) {
      pos.set([Math.sin(v) * 0.3, (v / N) * 2, Math.cos(v * 1.3) * 0.2], v * 3);
      const j = Math.min(JOINTS - 2, Math.floor((v / N) * (JOINTS - 1)));
      joints.set([j, j + 1, (j + 2) % JOINTS, 0], v * 4);
      weights.set([0.5, 0.3, 0.2, 0], v * 4);
    }
    const idx = new Uint32Array(N);
    for (let i = 0; i < N; i++) idx[i] = i;
    const ibm = new Float32Array(JOINTS * 16);
    for (let j = 0; j < JOINTS; j++) {
      ibm.set([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, (-2 * j) / JOINTS, 0, 1], j * 16);
    }
    const parts = [pos, joints, weights, idx, ibm];
    const offsets: number[] = [];
    let len = 0;
    for (const p of parts) {
      offsets.push(len);
      len += p.byteLength;
    }
    const bytes = new Uint8Array(len);
    parts.forEach((p, k) => bytes.set(new Uint8Array(p.buffer), offsets[k]));
    const nodes: object[] = [];
    for (let j = 0; j < JOINTS; j++) nodes.push({ name: `j${j}`, ...(j ? { translation: [0, 2 / JOINTS, 0] } : {}), ...(j < JOINTS - 1 ? { children: [j + 1] } : {}) });
    nodes.push({ name: 'skinned', mesh: 0, skin: 0 }, { name: 'rigid', mesh: 1 });
    const view = (k: number) => ({ buffer: 0, byteOffset: offsets[k], byteLength: parts[k].byteLength });
    const json = {
      asset: { version: '2.0' },
      scene: 0,
      scenes: [{ nodes: [0, JOINTS, JOINTS + 1] }],
      nodes,
      meshes: [
        { primitives: [{ attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 }, indices: 3 }] },
        { primitives: [{ attributes: { POSITION: 0 }, indices: 3 }] },
      ],
      skins: [{ joints: Array.from({ length: JOINTS }, (_, j) => j), inverseBindMatrices: 4 }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: N, type: 'VEC3', min: [-0.3, 0, -0.2], max: [0.3, 2, 0.2] },
        { bufferView: 1, componentType: 5123, count: N, type: 'VEC4' },
        { bufferView: 2, componentType: 5126, count: N, type: 'VEC4' },
        { bufferView: 3, componentType: 5125, count: N, type: 'SCALAR' },
        { bufferView: 4, componentType: 5126, count: JOINTS, type: 'MAT4' },
      ],
      bufferViews: parts.map((_, k) => view(k)),
      buffers: [{ byteLength: len, uri: `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}` }],
    };
    const scene = drawnScene();
    const r = await scene.sdk.loadGltf(new TextEncoder().encode(JSON.stringify(json)).buffer as ArrayBuffer, { posable: ['rigid', 'j3'], readback: true });
    const anim = scene.sdk.createGltfAnimator(r, { autoUpdate: false });
    anim.setNodeRotations([
      { node: 'j3', rotation: q([0, 0, 1], 0.6) },
      { node: 'rigid', rotation: q([1, 0, 0], 0.4) },
    ]);
    const axis: V3 = [0.2, 0.95, 0.1];
    expect(anim.posedMinAlong(axis)).toBeCloseTo(referenceMin(scene, r.objects, axis), 6);
    const rounds = 200;
    const t0 = performance.now();
    for (let i = 0; i < rounds; i++) anim.posedMinAlong([0.2, 0.95, 0.1 + i * 1e-4]);
    const ms = (performance.now() - t0) / rounds;
    console.log(`posedMinAlong: ${ms.toFixed(3)} ms per call for ${N} skinned + ${N} rigid vertices`);
    expect(ms).toBeLessThan(50);
  });
});
