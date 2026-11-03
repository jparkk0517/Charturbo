/**
 * A real `Charturbo` over a no-op backend that records what the engine would draw: object transforms
 * (position / Euler YXZ rotation / scale, clamped to >= 0.05 per axis like the engine), parents, custom mesh
 * vertices, mesh matrices and CPU skins (weights normalized like `normalize_weights`). `worldVertices` mirrors the
 * engine: world = parentWorld * T * R * S over the chain, then mesh matrix x vertex (rigid) or linear-blend skinning
 * with the last joint palette (skinned). Used as an independent reference for posed bounds / ground lock.
 */
import { Charturbo, type WasmCharturboEngineBackend } from '../sdk/charturbo';
import { eulerYXZToQuat } from '../previs/evaluate';

type V3 = [number, number, number];

export interface DrawnObject {
  name: string;
  position: V3;
  rotation: V3;
  scale: V3;
  parent: number | null;
  positions: Float32Array | null;
  indices: Uint32Array | null;
  meshMatrix: Float32Array | null;
  skin: { joints: Uint16Array; weights: Float32Array } | null;
  palette: Float32Array | null;
}

/** Column-major 4x4 multiply a * b. */
export function mul4(a: ArrayLike<number>, b: ArrayLike<number>): number[] {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}

/** Engine local matrix T(p) * R(Euler YXZ) * S(max(s, 0.05)). */
function localMatrix(o: DrawnObject): number[] {
  const [x, y, z, w] = eulerYXZToQuat(o.rotation);
  const s = o.scale.map((v) => Math.max(v, 0.05));
  const r = [
    1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
    2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
    2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y),
  ];
  return [
    r[0] * s[0], r[1] * s[0], r[2] * s[0], 0,
    r[3] * s[1], r[4] * s[1], r[5] * s[1], 0,
    r[6] * s[2], r[7] * s[2], r[8] * s[2], 0,
    o.position[0], o.position[1], o.position[2], 1,
  ];
}

export function drawnScene() {
  let next = 1;
  const impl: Record<string, unknown> = {
    add_primitive: () => next++,
    add_custom_mesh: () => next++,
    object_count: () => 0,
    camera_state: () => new Float32Array([0, 0, 0, 5, 0, 0, 0.7, 1]),
    get_object_transform: () => new Float32Array(0),
    get_object_skinned_vertices: () => new Float32Array(0),
  };
  // Every other engine call is a no-op returning true (mesh matrices and skinning are "supported")
  const backend = new Proxy(impl, { get: (t, k: string) => t[k] ?? (() => true) }) as unknown as WasmCharturboEngineBackend;
  const sdk = Charturbo.fromBackend(backend);
  const objects = new Map<number, DrawnObject>();
  /** Engine calls the player / animator made, in order (method name and first argument). */
  const calls: string[] = [];
  const blank = (name: string): DrawnObject => ({
    name,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    parent: null,
    positions: null,
    indices: null,
    meshMatrix: null,
    skin: null,
    palette: null,
  });

  const addPrimitive = sdk.addPrimitive.bind(sdk);
  sdk.addPrimitive = ((d: Parameters<Charturbo['addPrimitive']>[0]) => {
    const id = addPrimitive(d);
    const o = blank(d.name ?? '');
    o.position = [...(d.position ?? [0, 0, 0])] as V3;
    o.rotation = [...(d.rotation ?? [0, 0, 0])] as V3;
    o.scale = [...(d.scale ?? [1, 1, 1])] as V3;
    o.parent = d.parentId ?? null;
    objects.set(id, o);
    calls.push(`addPrimitive ${JSON.stringify(d)}`);
    return id;
  }) as Charturbo['addPrimitive'];
  const addCustomMesh = sdk.addCustomMesh.bind(sdk);
  sdk.addCustomMesh = ((d: Parameters<Charturbo['addCustomMesh']>[0]) => {
    const id = addCustomMesh(d);
    const o = blank(d.name ?? '');
    o.position = [...(d.position ?? [0, 0, 0])] as V3;
    o.rotation = [...(d.rotation ?? [0, 0, 0])] as V3;
    o.scale = [...(d.scale ?? [1, 1, 1])] as V3;
    o.positions = Float32Array.from(d.positions);
    o.indices = Uint32Array.from(d.indices);
    objects.set(id, o);
    calls.push(`addCustomMesh ${o.positions.length}`);
    return id;
  }) as Charturbo['addCustomMesh'];
  const setObjectTransform = sdk.setObjectTransform.bind(sdk);
  sdk.setObjectTransform = ((id: number, t: Parameters<Charturbo['setObjectTransform']>[1]) => {
    const o = objects.get(id)!;
    if (t.position) o.position = [...t.position] as V3;
    if (t.rotation) o.rotation = [...t.rotation] as V3;
    if (t.scale) o.scale = [...t.scale] as V3;
    if (t.parentId !== undefined) o.parent = t.parentId;
    calls.push(`setObjectTransform ${id} ${JSON.stringify(t)}`);
    return setObjectTransform(id, t);
  }) as Charturbo['setObjectTransform'];
  const setObjectParent = sdk.setObjectParent.bind(sdk);
  sdk.setObjectParent = (id: number, parent: number | null) => {
    objects.get(id)!.parent = parent;
    calls.push(`setObjectParent ${id} ${parent}`);
    return setObjectParent(id, parent);
  };
  const setObjectMeshMatrices = sdk.setObjectMeshMatrices.bind(sdk);
  sdk.setObjectMeshMatrices = (ids: ArrayLike<number>, mats: ArrayLike<number>) => {
    for (let k = 0; k < ids.length; k++) objects.get(ids[k])!.meshMatrix = Float32Array.from(Array.prototype.slice.call(mats, k * 16, k * 16 + 16));
    calls.push(`setObjectMeshMatrices ${Array.from(ids).join(',')} ${Array.from(mats).join(',')}`);
    return setObjectMeshMatrices(ids, mats);
  };
  const setObjectSkin = sdk.setObjectSkin.bind(sdk);
  sdk.setObjectSkin = ((id: number, skin: { joints: ArrayLike<number>; weights: ArrayLike<number>; jointCount: number } | null) => {
    const o = objects.get(id)!;
    if (skin) {
      const joints = Uint16Array.from(skin.joints);
      const weights = Float32Array.from(skin.weights);
      for (let v = 0; v < weights.length; v += 4) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          const w = weights[v + k];
          weights[v + k] = Number.isFinite(w) && w > 0 ? w : 0;
          sum += weights[v + k];
        }
        for (let k = 0; k < 4; k++) weights[v + k] = sum > 1e-12 ? weights[v + k] / sum : 0;
      }
      o.skin = { joints, weights };
    } else o.skin = null;
    calls.push(`setObjectSkin ${id}`);
    return setObjectSkin(id, skin);
  }) as Charturbo['setObjectSkin'];
  const setObjectJointMatrices = sdk.setObjectJointMatrices.bind(sdk);
  sdk.setObjectJointMatrices = (ids: ArrayLike<number>, counts: ArrayLike<number>, mats: ArrayLike<number>) => {
    let off = 0;
    for (let k = 0; k < ids.length; k++) {
      objects.get(ids[k])!.palette = Float32Array.from(Array.prototype.slice.call(mats, off, off + counts[k] * 16));
      off += counts[k] * 16;
    }
    calls.push(`setObjectJointMatrices ${Array.from(ids).join(',')} ${Array.from(mats).join(',')}`);
    return setObjectJointMatrices(ids, counts, mats);
  };

  /** World matrix of an object (engine chain, scale included). */
  const worldMatrix = (id: number, depth = 0): number[] => {
    const o = objects.get(id)!;
    const local = localMatrix(o);
    return o.parent === null || depth > 64 ? local : mul4(worldMatrix(o.parent, depth + 1), local);
  };

  /** Model-space (object-local, before the object transform) drawn vertex `v` of a custom mesh. */
  const localVertex = (o: DrawnObject, v: number): V3 => {
    const p = o.positions!;
    const x = p[v * 3], y = p[v * 3 + 1], z = p[v * 3 + 2];
    if (o.skin && o.palette) {
      const { joints, weights } = o.skin;
      if (weights[v * 4] === 0 && weights[v * 4 + 1] === 0 && weights[v * 4 + 2] === 0 && weights[v * 4 + 3] === 0) return [x, y, z];
      const out: V3 = [0, 0, 0];
      for (let k = 0; k < 4; k++) {
        const w = weights[v * 4 + k];
        if (w === 0) continue;
        const m = joints[v * 4 + k] * 16;
        const pal = o.palette;
        for (let r = 0; r < 3; r++) out[r] += w * (pal[m + r] * x + pal[m + 4 + r] * y + pal[m + 8 + r] * z + pal[m + 12 + r]);
      }
      return out;
    }
    if (o.meshMatrix) {
      const m = o.meshMatrix;
      return [0, 1, 2].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]) as V3;
    }
    return [x, y, z];
  };

  /** World positions of the vertices some triangle of custom mesh `id` uses. */
  const worldVertices = (id: number): V3[] => {
    const o = objects.get(id)!;
    const w = worldMatrix(id);
    const used = new Set(o.indices!);
    const out: V3[] = [];
    for (const v of used) {
      const [x, y, z] = localVertex(o, v);
      out.push([0, 1, 2].map((r) => w[r] * x + w[4 + r] * y + w[8 + r] * z + w[12 + r]) as V3);
    }
    return out;
  };

  const idOf = (name: string): number => {
    for (const [id, o] of objects) if (o.name === name) return id;
    throw new Error(`no object named ${name}`);
  };
  /** Custom meshes parented to object `parent` (a model's FIT). */
  const meshesUnder = (parent: number): number[] => [...objects].filter(([, o]) => o.positions && o.parent === parent).map(([id]) => id);
  /** Lowest world y of every mesh under the FIT of previs node `nodeId`. */
  const minWorldY = (nodeId: string): number => {
    let min = Infinity;
    for (const id of meshesUnder(idOf(`previs:${nodeId}:fit`))) for (const p of worldVertices(id)) min = Math.min(min, p[1]);
    return min;
  };

  return { sdk, objects, calls, worldMatrix, worldVertices, localVertex, idOf, meshesUnder, minWorldY };
}
