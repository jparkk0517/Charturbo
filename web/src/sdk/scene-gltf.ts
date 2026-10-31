// glTF 2.0 loader for the 3D scene: parses .gltf (JSON) and .glb (binary) files, bakes the node
// hierarchy into custom meshes and maps pbrMetallicRoughness materials onto the engine material.
// Animated subtrees are not baked: their meshes stay node-local and get a mesh matrix that
// `GltfAnimator` (scene-gltf-anim.ts) recomputes from the keyframes.

import type { CustomMeshObjectDescriptor, LoadTextureOptions, Vec2Tuple, Vec3Tuple } from './charturbo';
import type { RgbaTuple } from './color';
import type { GltfAnimationInfo, GltfAnimationPath, GltfChannel, GltfClip, GltfInterpolation, GltfRig, GltfSampler } from './scene-gltf-anim';

/** Model sources `loadGltf` reads (strings and `URL`s are fetched). */
export type GltfSource = string | URL | ArrayBuffer | Uint8Array | Blob;

export interface GltfLoadOptions {
  /** Aborts fetches and texture decoding; the promise rejects with an `AbortError` */
  signal?: AbortSignal;
  /** Object position of every created mesh (default: [0, 0, 0]); the model origin lands here */
  position?: Vec3Tuple;
  /** Euler radians [rx, ry, rz], same convention as primitives (default: [0, 0, 0]) */
  rotation?: Vec3Tuple;
  /** Uniform or per-axis scale baked into the vertices (default: 1; glTF units are meters) */
  scale?: number | Vec3Tuple;
  /** Scene index (default: the file's `scene`, else 0) */
  scene?: number;
  /** Base URL for relative buffer / image URIs (default: the source URL, else the page URL) */
  baseUrl?: string;
  /**
   * Keep animated node subtrees animatable (default true when the file has animations): their
   * meshes stay in node-local space with a mesh matrix (`createGltfAnimator` plays the clips).
   * False bakes every node like an unanimated file (rest pose).
   */
  animations?: boolean;
}

export interface GltfNodeResult {
  /** glTF node index */
  index: number;
  name: string | null;
  /** Objects created for the node's mesh primitives (empty for nodes without a mesh) */
  objectIds: number[];
}

export interface GltfLoadResult {
  /** Every created scene object id */
  objects: number[];
  /** Every created texture id */
  textures: number[];
  /** The loaded scene's nodes, depth first */
  nodes: GltfNodeResult[];
  /** World-space bounds of the created meshes (position / rotation / scale applied; rest pose) */
  bounds: { min: Vec3Tuple; max: Vec3Tuple };
  /** The file's animation clips, in glTF order (empty without animations or with `animations: false`) */
  animations: GltfAnimationInfo[];
}

/** The `Charturbo` methods the loader uses. */
export interface GltfHost {
  readonly maxTextureSize: number;
  loadTexture(source: Blob | string, options: LoadTextureOptions): Promise<number>;
  disposeTexture(textureId: number): boolean;
  addCustomMesh(desc: CustomMeshObjectDescriptor): number;
  removeObject(objectId: number): boolean;
  /** True when the engine supports per-object mesh matrices (needed for animations) */
  readonly supportsMeshMatrices?: boolean;
  setObjectMeshMatrices?(ids: Uint32Array, matrices: Float32Array): boolean;
}

/** Animation rigs of loaded models (`createGltfAnimator` looks them up). */
const rigs = new WeakMap<object, GltfRig>();

/** The animation rig of a `loadGltf` result (null: no animated nodes, or not a loader result). */
export function gltfRigOf(result: object): GltfRig | null {
  return rigs.get(result) ?? null;
}

/**
 * Vertices one load may create: the engine keeps all scene meshes in one vertex buffer of 32-byte
 * vertices, and WebGPU only guarantees 256 MiB buffers (geometry past the limit is not drawn).
 */
export const GLTF_MAX_VERTICES = 8_388_608;
/** Triangle indices one load may create (4-byte indices in a 256 MiB buffer). */
export const GLTF_MAX_INDICES = 67_108_864;

/** Extensions the loader understands; others in `extensionsRequired` reject the file. */
const SUPPORTED_EXTENSIONS = new Set(['KHR_texture_transform', 'KHR_mesh_quantization', 'KHR_materials_emissive_strength']);

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// ---------------------------------------------------------------------------
// glTF JSON shapes (only the fields the loader reads)
// ---------------------------------------------------------------------------

interface GltfTextureInfo {
  index: number;
  texCoord?: number;
  /** normalTexture */
  scale?: number;
  /** occlusionTexture */
  strength?: number;
  extensions?: { KHR_texture_transform?: { offset?: number[]; scale?: number[]; rotation?: number; texCoord?: number } };
}

interface GltfMaterial {
  name?: string;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: GltfTextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: GltfTextureInfo;
  };
  normalTexture?: GltfTextureInfo;
  occlusionTexture?: GltfTextureInfo;
  emissiveTexture?: GltfTextureInfo;
  emissiveFactor?: number[];
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND';
  alphaCutoff?: number;
  extensions?: { KHR_materials_emissive_strength?: { emissiveStrength?: number } };
}

interface GltfPrimitive {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  targets?: unknown[];
}

interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  camera?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  normalized?: boolean;
  count: number;
  type: string;
  sparse?: {
    count: number;
    indices: { bufferView: number; byteOffset?: number; componentType: number };
    values: { bufferView: number; byteOffset?: number };
  };
}

interface GltfAnimationJson {
  name?: string;
  channels?: { sampler: number; target?: { node?: number; path?: string } }[];
  samplers?: { input: number; output: number; interpolation?: string }[];
}

interface GltfJson {
  asset?: { version?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { name?: string; primitives: GltfPrimitive[] }[];
  accessors?: GltfAccessor[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  materials?: GltfMaterial[];
  textures?: { source?: number; sampler?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
  animations?: GltfAnimationJson[];
  skins?: unknown[];
  cameras?: unknown[];
}

/** Engine material of a glTF material, plus the images its textures use (null = none). */
interface MaterialInfo {
  color: RgbaTuple;
  metallic: number;
  roughness: number;
  emissive: number;
  alphaTest: number;
  /** Base color image */
  image: number | null;
  /** PBR map images (metallic-roughness, normal, occlusion, emissive) */
  maps: Record<GltfMapSlot, number | null>;
  normalScale: number;
  aoStrength: number;
  /** Linear emissiveFactor * emissive strength */
  emissiveColor: [number, number, number];
  /** Shared uv transform of every texture of the material */
  mapRepeat: Vec2Tuple;
  mapOffset: Vec2Tuple;
}

/** PBR map slots, in SDK field names. */
const GLTF_MAP_SLOTS = ['metallicRoughnessMap', 'normalMap', 'aoMap', 'emissiveMap'] as const;
type GltfMapSlot = (typeof GLTF_MAP_SLOTS)[number];

/** Every image a material samples. */
function materialImages(m: MaterialInfo): number[] {
  const out: number[] = [];
  if (m.image !== null) out.push(m.image);
  for (const slot of GLTF_MAP_SLOTS) if (m.maps[slot] !== null) out.push(m.maps[slot]);
  return out;
}

function hasImages(m: MaterialInfo): boolean {
  return materialImages(m).length > 0;
}

/** A triangle mesh with the world transform baked in, ready for `addCustomMesh`. */
interface PreparedMesh {
  node: GltfNodeResult;
  name: string | undefined;
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array | null;
  indices: Uint32Array;
  material: MaterialInfo;
  /** Mesh matrix (rest pose) of a node-local mesh under an animated node; null = baked */
  matrix: Mat4 | null;
  /** Rig node of a node-local mesh */
  rigNode: number;
}

type Mat4 = Float64Array;

/** A node of the loaded scene graph, depth first. */
interface VisitedNode {
  node: GltfNode;
  index: number;
  /** Visit index of the parent (-1 = scene root) */
  parent: number;
  world: Mat4;
}

const INTERPOLATIONS = new Set<GltfInterpolation>(['LINEAR', 'STEP', 'CUBICSPLINE']);

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Loads a glTF 2.0 model into the scene (see `Charturbo.loadGltf`). On failure every object and
 * texture created so far is removed again.
 */
export async function loadGltfModel(host: GltfHost, source: GltfSource, options: GltfLoadOptions = {}): Promise<GltfLoadResult> {
  const { signal } = options;
  const created: { objects: number[]; textures: number[] } = { objects: [], textures: [] };
  try {
    checkAbort(signal);
    const scale = resolveScale(options.scale);
    const { json, bin, base } = await readContainer(source, options.baseUrl, signal);
    const loader = new GltfLoader(host, json, bin, base, signal);
    return await loader.load(options, scale, created);
  } catch (e) {
    for (const id of created.objects) host.removeObject(id);
    for (const id of created.textures) {
      try {
        host.disposeTexture(id);
      } catch {
        // engine without texture support: nothing was uploaded
      }
    }
    if (signal?.aborted) throw abortError(signal);
    throw gltfError(e);
  }
}

/** Removes the objects and textures of a `loadGltf` result. */
export function disposeGltfModel(host: GltfHost, result: GltfLoadResult): void {
  for (const id of result.objects) host.removeObject(id);
  for (const id of result.textures) {
    try {
      host.disposeTexture(id);
    } catch {
      // engine without texture support
    }
  }
}

// ---------------------------------------------------------------------------
// Container (fetch, GLB chunks, JSON)
// ---------------------------------------------------------------------------

async function readContainer(
  source: GltfSource,
  baseUrl: string | undefined,
  signal: AbortSignal | undefined
): Promise<{ json: GltfJson; bin: Uint8Array | null; base: string | undefined }> {
  let base = baseUrl;
  let bytes: Uint8Array;
  if (typeof source === 'string' || source instanceof URL) {
    const url = typeof source === 'string' ? source : source.href;
    base ??= url;
    bytes = await fetchBytes(url, signal);
  } else if (source instanceof Uint8Array) {
    bytes = source;
  } else if (source instanceof ArrayBuffer || Object.prototype.toString.call(source) === '[object ArrayBuffer]') {
    bytes = new Uint8Array(source as ArrayBuffer);
  } else if (typeof Blob !== 'undefined' && source instanceof Blob) {
    bytes = new Uint8Array(await source.arrayBuffer());
  } else {
    throw new Error('loadGltf: source must be a URL string, URL, ArrayBuffer, Uint8Array or Blob');
  }
  checkAbort(signal);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength >= 12 && view.getUint32(0, true) === GLB_MAGIC) {
    const version = view.getUint32(4, true);
    if (version !== 2) throw new Error(`loadGltf: unsupported GLB version ${version} (2 required)`);
    const length = Math.min(view.getUint32(8, true), bytes.byteLength);
    let offset = 12;
    let json: GltfJson | null = null;
    let bin: Uint8Array | null = null;
    while (offset + 8 <= length) {
      const chunkLength = view.getUint32(offset, true);
      const chunkType = view.getUint32(offset + 4, true);
      const start = offset + 8;
      if (start + chunkLength > length) throw new Error('loadGltf: GLB chunk exceeds the file length');
      const chunk = bytes.subarray(start, start + chunkLength);
      if (json === null) {
        if (chunkType !== CHUNK_JSON) throw new Error('loadGltf: the first GLB chunk must be JSON');
        json = parseJson(chunk);
      } else if (chunkType === CHUNK_BIN && bin === null) {
        bin = chunk;
      }
      offset = start + chunkLength;
    }
    if (!json) throw new Error('loadGltf: GLB has no JSON chunk');
    return { json, bin, base };
  }
  return { json: parseJson(bytes), bin: null, base };
}

function parseJson(bytes: Uint8Array): GltfJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error('loadGltf: not a glTF 2.0 file (invalid JSON and no GLB header)');
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('loadGltf: not a glTF 2.0 file (JSON is not an object)');
  return parsed as GltfJson;
}

async function fetchBytes(url: string, signal: AbortSignal | undefined): Promise<Uint8Array> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    checkAbort(signal);
    throw new Error(`loadGltf: failed to fetch ${url} (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) throw new Error(`loadGltf: failed to fetch ${url} (${res.status})`);
  const data = new Uint8Array(await res.arrayBuffer());
  checkAbort(signal);
  return data;
}

/** Resolves a buffer / image URI against the model URL (or the page URL). */
function resolveUri(uri: string, base: string | undefined): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) return uri;
  const page = (globalThis as { location?: { href?: string } }).location?.href;
  try {
    return new URL(uri, base !== undefined ? new URL(base, page) : page).href;
  } catch {
    // Relative base outside a page: join the directories
    return base !== undefined ? base.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + uri : uri;
  }
}

function decodeDataUri(uri: string): { bytes: Uint8Array<ArrayBuffer>; mime: string } {
  const comma = uri.indexOf(',');
  if (comma < 0) throw new Error('loadGltf: malformed data URI');
  const header = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = (isBase64 ? header.slice(0, -7) : header).split(';')[0];
  if (isBase64) {
    let text: string;
    try {
      text = atob(payload.replace(/\s/g, ''));
    } catch {
      throw new Error('loadGltf: malformed base64 data URI');
    }
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return { bytes, mime };
  }
  // Percent-encoded bytes
  const out: number[] = [];
  for (let i = 0; i < payload.length; i++) {
    const c = payload.charCodeAt(i);
    if (c === 37 /* % */ && i + 2 < payload.length && /^[0-9a-f]{2}$/i.test(payload.slice(i + 1, i + 3))) {
      out.push(parseInt(payload.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(c & 0xff);
    }
  }
  return { bytes: Uint8Array.from(out), mime };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

class GltfLoader {
  private readonly buffers = new Map<number, Uint8Array>();
  private readonly materials = new Map<number, MaterialInfo>();
  private readonly warned = new Set<string>();

  constructor(
    private readonly host: GltfHost,
    private readonly json: GltfJson,
    private readonly bin: Uint8Array | null,
    private readonly base: string | undefined,
    private readonly signal: AbortSignal | undefined
  ) {}

  async load(
    options: GltfLoadOptions,
    scale: Vec3Tuple,
    created: { objects: number[]; textures: number[] }
  ): Promise<GltfLoadResult> {
    const json = this.json;
    const version = json.asset?.version;
    if (typeof version !== 'string' || version.split('.')[0] !== '2') {
      throw new Error(`loadGltf: unsupported glTF version ${version ?? '(missing)'} (2.0 required)`);
    }
    for (const ext of json.extensionsRequired ?? []) {
      if (!SUPPORTED_EXTENSIONS.has(ext)) throw new Error(`loadGltf: extension ${ext} is required but not supported`);
    }
    for (const ext of json.extensionsUsed ?? []) {
      if (!SUPPORTED_EXTENSIONS.has(ext)) this.warn(`ext:${ext}`, `extension ${ext} is not supported and is ignored`);
    }
    const wantAnimations = options.animations !== false && (json.animations?.length ?? 0) > 0;
    const animate = wantAnimations && this.host.supportsMeshMatrices === true && typeof this.host.setObjectMeshMatrices === 'function';
    if (wantAnimations && !animate) this.warn('animations', 'animations are not supported and are ignored');
    if (json.cameras?.length) this.warn('cameras', 'cameras are not supported and are ignored');

    // Scene graph: world matrices of every node with a mesh
    const nodes: GltfNodeResult[] = [];
    const jobs: { node: GltfNodeResult; world: Mat4; mesh: number; visit: number }[] = [];
    const visited = new Map<number, number>();
    const order: VisitedNode[] = [];
    const visit = (index: number, parent: number) => {
      const node = json.nodes?.[index];
      if (!node) throw new Error(`loadGltf: node ${index} does not exist`);
      if (visited.has(index)) throw new Error(`loadGltf: node ${index} appears twice in the scene graph`);
      const self = order.length;
      visited.set(index, self);
      const world = multiply(parent >= 0 ? order[parent].world : identity(), nodeMatrix(node));
      order.push({ node, index, parent, world });
      const entry: GltfNodeResult = { index, name: node.name ?? null, objectIds: [] };
      nodes.push(entry);
      if (node.skin !== undefined) this.warn('skins', 'skins are not supported; skinned meshes render in their bind pose');
      if (node.mesh !== undefined) jobs.push({ node: entry, world, mesh: node.mesh, visit: self });
      for (const child of node.children ?? []) visit(child, self);
    };
    for (const root of this.sceneRoots(options.scene)) visit(root, -1);

    // Geometry and keyframes first (synchronous parse errors happen before anything is created)
    await this.loadBuffers(jobs.map((j) => j.mesh), animate ? this.animationAccessors(visited) : []);
    const clips = animate ? this.parseAnimations(visited, order) : [];
    // Dynamic = animated or below an animated node (parents are visited first)
    const animated = new Set(clips.flatMap((c) => c.channels.map((ch) => ch.node)));
    const dynamic = new Uint8Array(order.length);
    order.forEach((v, i) => {
      dynamic[i] = animated.has(i) || (v.parent >= 0 && dynamic[v.parent]) ? 1 : 0;
    });
    const base = scaleMatrix(scale);
    const meshes: PreparedMesh[] = [];
    for (const job of jobs) {
      if (dynamic[job.visit]) {
        // Node-local vertices; the animator moves them with the mesh matrix
        const local = this.prepareMesh(job.mesh, identity(), job.node);
        const matrix = multiply(base, job.world);
        for (const m of local) {
          m.matrix = matrix;
          m.rigNode = job.visit;
        }
        meshes.push(...local);
      } else {
        meshes.push(...this.prepareMesh(job.mesh, multiply(base, job.world), job.node));
      }
    }
    const vertexCount = meshes.reduce((n, m) => n + m.positions.length / 3, 0);
    if (vertexCount > GLTF_MAX_VERTICES) {
      throw new Error(`loadGltf: model has ${vertexCount} vertices; the scene geometry buffer holds at most ${GLTF_MAX_VERTICES}`);
    }
    const indexCount = meshes.reduce((n, m) => n + m.indices.length, 0);
    if (indexCount > GLTF_MAX_INDICES) {
      throw new Error(`loadGltf: model has ${indexCount} triangle indices; the scene index buffer holds at most ${GLTF_MAX_INDICES}`);
    }

    // Textures (each image once, even when several materials use it)
    const textureOf = await this.loadImages(meshes, created);

    // Objects
    const dynamicObjects: { id: number; mesh: PreparedMesh }[] = [];
    const position: Vec3Tuple = options.position ? [...options.position] : [0, 0, 0];
    const rotation: Vec3Tuple = options.rotation ? [...options.rotation] : [0, 0, 0];
    for (const mesh of meshes) {
      const m = mesh.material;
      const texture = (image: number | null) => (image !== null ? (textureOf.get(image) ?? null) : null);
      const map = texture(m.image);
      const maps: Partial<Record<GltfMapSlot, number>> = {};
      for (const slot of GLTF_MAP_SLOTS) {
        const id = texture(m.maps[slot]);
        if (id !== null) maps[slot] = id;
      }
      const textured = map !== null || Object.keys(maps).length > 0;
      const id = this.host.addCustomMesh({
        ...(mesh.name !== undefined ? { name: mesh.name } : {}),
        positions: mesh.positions,
        normals: mesh.normals,
        ...(mesh.uvs ? { uvs: mesh.uvs } : {}),
        indices: mesh.indices,
        position: [...position],
        rotation: [...rotation],
        scale: [1, 1, 1],
        color: [...m.color],
        metallic: m.metallic,
        roughness: m.roughness,
        emissive: m.emissive,
        ...(map !== null ? { map } : {}),
        ...(textured ? { mapRepeat: [...m.mapRepeat], mapOffset: [...m.mapOffset] } : {}),
        ...maps,
        ...(m.maps.normalMap !== null && m.normalScale !== 1 ? { normalScale: m.normalScale } : {}),
        ...(m.maps.aoMap !== null && m.aoStrength !== 1 ? { aoStrength: m.aoStrength } : {}),
        ...(m.emissiveColor.some((c) => c !== 0) ? { emissiveColor: [...m.emissiveColor] } : {}),
        alphaTest: m.alphaTest,
      });
      created.objects.push(id);
      mesh.node.objectIds.push(id);
      if (mesh.matrix) dynamicObjects.push({ id, mesh });
    }

    let rig: GltfRig | null = null;
    if (dynamicObjects.length > 0) {
      rig = buildRig(order, dynamic, base, clips, dynamicObjects);
      // Rest pose (the vertices are node-local until the first mesh matrix lands)
      const mats = new Float32Array(dynamicObjects.length * 16);
      dynamicObjects.forEach((d, k) => mats.set(d.mesh.matrix!, k * 16));
      this.host.setObjectMeshMatrices!(rig.targets.ids, mats);
    }

    const result: GltfLoadResult = {
      objects: [...created.objects],
      textures: [...created.textures],
      nodes,
      bounds: worldBounds(meshes, position, rotation),
      animations: clips.map((c) => ({ name: c.name, duration: c.duration })),
    };
    if (rig) rigs.set(result, rig);
    else if (clips.length > 0) rigs.set(result, { ...emptyRig(), clips });
    return result;
  }

  /** Sampler accessors of the channels that target loaded nodes. */
  private animationAccessors(visited: Map<number, number>): number[] {
    const out: number[] = [];
    for (const a of this.json.animations ?? []) {
      for (const ch of a.channels ?? []) {
        const node = ch.target?.node;
        if (node === undefined || !visited.has(node)) continue;
        const s = a.samplers?.[ch.sampler];
        if (s) out.push(s.input, s.output);
      }
    }
    return out;
  }

  /** Clips in glTF order (invalid channels are skipped with a warning; indices stay aligned). */
  private parseAnimations(visited: Map<number, number>, order: VisitedNode[]): GltfClip[] {
    return (this.json.animations ?? []).map((a, ai) => {
      const channels: GltfChannel[] = [];
      const samplers = new Map<number, GltfSampler | null>();
      for (const ch of a.channels ?? []) {
        const target = ch.target;
        const path = target?.path;
        if (path === 'weights') {
          this.warn('morph-animation', 'morph target weight animations are not supported and are ignored');
          continue;
        }
        if (path !== 'translation' && path !== 'rotation' && path !== 'scale') continue;
        const node = target?.node !== undefined ? visited.get(target.node) : undefined;
        if (node === undefined) continue; // not in the loaded scene
        if (order[node].node.matrix) {
          this.warn('animated-matrix', 'animated nodes given by a matrix are not supported; their channels are ignored');
          continue;
        }
        let sampler = samplers.get(ch.sampler);
        if (sampler === undefined) {
          sampler = this.sampler(a, ai, ch.sampler, path);
          samplers.set(ch.sampler, sampler);
        }
        if (sampler && sampler.size === (path === 'rotation' ? 4 : 3)) channels.push({ node, path, sampler });
        else if (sampler) this.warn('animation-sampler', `animation ${ai}: a ${path} channel has ${sampler.size}-component values and is ignored`);
      }
      const duration = channels.reduce((d, ch) => Math.max(d, ch.sampler.input[ch.sampler.input.length - 1]), 0);
      return { name: a.name ?? `animation ${ai}`, duration, channels };
    });
  }

  private sampler(a: GltfAnimationJson, ai: number, index: number, path: GltfAnimationPath): GltfSampler | null {
    const s = a.samplers?.[index];
    const skip = (why: string) => {
      this.warn(`animation-${ai}-${index}`, `animation ${ai} sampler ${index} ${why}; its channels are ignored`);
      return null;
    };
    if (!s) return skip('does not exist');
    const interpolation = (s.interpolation ?? 'LINEAR') as GltfInterpolation;
    if (!INTERPOLATIONS.has(interpolation)) return skip(`has an unknown interpolation ${String(s.interpolation)}`);
    const input = this.readAccessor(s.input, 'float');
    if (input.size !== 1) return skip('input must be SCALAR');
    if (input.count === 0) return skip('has no keyframes');
    const times = input.values as Float32Array;
    for (let i = 0; i < times.length; i++) {
      if (!Number.isFinite(times[i]) || (i > 0 && times[i] < times[i - 1])) return skip('input times must be finite and increasing');
    }
    const output = this.readAccessor(s.output, 'float');
    const size = output.size;
    if (size !== 3 && size !== 4) return skip(`output must be VEC3 or VEC4 (${path})`);
    const expected = input.count * (interpolation === 'CUBICSPLINE' ? 3 : 1);
    if (output.count !== expected) return skip(`output has ${output.count} values, expected ${expected}`);
    return { input: times, output: output.values as Float32Array, interpolation, size };
  }

  private warn(kind: string, message: string): void {
    if (this.warned.has(kind)) return;
    this.warned.add(kind);
    console.warn(`loadGltf: ${message}`);
  }

  private sceneRoots(requested: number | undefined): number[] {
    const { json } = this;
    if (requested !== undefined) {
      if (!Number.isInteger(requested) || !json.scenes?.[requested]) throw new Error(`loadGltf: scene ${requested} does not exist`);
      return json.scenes[requested].nodes ?? [];
    }
    if (json.scenes?.length) {
      const index = json.scene ?? 0;
      const scene = json.scenes[index];
      if (!scene) throw new Error(`loadGltf: scene ${index} does not exist`);
      return scene.nodes ?? [];
    }
    // No scenes: every root node
    const children = new Set((json.nodes ?? []).flatMap((n) => n.children ?? []));
    return (json.nodes ?? []).map((_, i) => i).filter((i) => !children.has(i));
  }

  // ---- buffers / accessors ------------------------------------------------

  /** Fetches / decodes the buffers the meshes' accessors and images (and `extra` accessors) read. */
  private async loadBuffers(meshIndices: number[], extra: number[] = []): Promise<void> {
    const { json } = this;
    const views = new Set<number>();
    const addAccessor = (a: number | undefined) => {
      if (a === undefined) return;
      const acc = json.accessors?.[a];
      if (!acc) return;
      if (acc.bufferView !== undefined) views.add(acc.bufferView);
      if (acc.sparse) {
        views.add(acc.sparse.indices.bufferView);
        views.add(acc.sparse.values.bufferView);
      }
    };
    for (const a of extra) addAccessor(a);
    for (const meshIndex of new Set(meshIndices)) {
      for (const prim of json.meshes?.[meshIndex]?.primitives ?? []) {
        addAccessor(prim.attributes?.POSITION);
        addAccessor(prim.attributes?.NORMAL);
        addAccessor(prim.attributes?.TEXCOORD_0);
        addAccessor(prim.indices);
        const images = prim.material !== undefined ? materialImages(this.material(prim.material)) : [];
        for (const image of images) {
          const imageView = json.images?.[image]?.bufferView;
          if (imageView !== undefined) views.add(imageView);
        }
      }
    }
    const buffers = new Set<number>();
    for (const v of views) {
      const view = json.bufferViews?.[v];
      if (!view) throw new Error(`loadGltf: bufferView ${v} does not exist`);
      buffers.add(view.buffer);
    }
    await Promise.all([...buffers].map(async (b) => this.buffers.set(b, await this.loadBuffer(b))));
    checkAbort(this.signal);
  }

  private async loadBuffer(index: number): Promise<Uint8Array> {
    const buffer = this.json.buffers?.[index];
    if (!buffer) throw new Error(`loadGltf: buffer ${index} does not exist`);
    let data: Uint8Array;
    if (buffer.uri === undefined) {
      if (index !== 0 || !this.bin) throw new Error(`loadGltf: buffer ${index} has no uri and no GLB binary chunk`);
      data = this.bin;
    } else if (buffer.uri.startsWith('data:')) {
      data = decodeDataUri(buffer.uri).bytes;
    } else {
      data = await fetchBytes(resolveUri(buffer.uri, this.base), this.signal);
    }
    if (data.byteLength < buffer.byteLength) {
      throw new Error(`loadGltf: buffer ${index} holds ${data.byteLength} bytes, expected ${buffer.byteLength}`);
    }
    return data;
  }

  private bufferView(index: number): { data: DataView; stride: number | undefined } {
    const view = this.json.bufferViews?.[index];
    if (!view) throw new Error(`loadGltf: bufferView ${index} does not exist`);
    const buffer = this.buffers.get(view.buffer);
    if (!buffer) throw new Error(`loadGltf: buffer ${view.buffer} is not loaded`);
    const offset = view.byteOffset ?? 0;
    if (offset + view.byteLength > buffer.byteLength) throw new Error(`loadGltf: bufferView ${index} exceeds its buffer`);
    return { data: new DataView(buffer.buffer, buffer.byteOffset + offset, view.byteLength), stride: view.byteStride };
  }

  /** Reads an accessor as floats (normalized integers mapped to [0, 1] / [-1, 1]) or as unsigned indices. */
  private readAccessor(index: number, kind: 'float' | 'index'): { values: Float32Array | Uint32Array; size: number; count: number } {
    const acc = this.json.accessors?.[index];
    if (!acc) throw new Error(`loadGltf: accessor ${index} does not exist`);
    const size = TYPE_SIZE[acc.type];
    const csize = COMPONENT_SIZE[acc.componentType];
    if (!size || !csize) throw new Error(`loadGltf: accessor ${index} has an invalid type or componentType`);
    if (kind === 'index' && ![5121, 5123, 5125].includes(acc.componentType)) {
      throw new Error(`loadGltf: index accessor ${index} must be unsigned byte, short or int`);
    }
    const count = acc.count;
    if (!Number.isInteger(count) || count < 0) throw new Error(`loadGltf: accessor ${index} has an invalid count`);
    const values = kind === 'index' ? new Uint32Array(count * size) : new Float32Array(count * size);
    const read = componentReader(acc.componentType, kind === 'float' && acc.normalized === true);

    if (acc.bufferView !== undefined) {
      const { data, stride: viewStride } = this.bufferView(acc.bufferView);
      const elem = csize * size;
      const stride = viewStride || elem;
      const start = acc.byteOffset ?? 0;
      if (count > 0 && start + stride * (count - 1) + elem > data.byteLength) {
        throw new Error(`loadGltf: accessor ${index} reads past the end of bufferView ${acc.bufferView}`);
      }
      for (let i = 0; i < count; i++) {
        const o = start + i * stride;
        for (let c = 0; c < size; c++) values[i * size + c] = read(data, o + c * csize);
      }
    }
    // (no bufferView: zeros)

    if (acc.sparse) {
      const { count: n, indices, values: vals } = acc.sparse;
      if (![5121, 5123, 5125].includes(indices.componentType)) {
        throw new Error(`loadGltf: sparse indices of accessor ${index} must be unsigned byte, short or int`);
      }
      const isize = COMPONENT_SIZE[indices.componentType];
      const readIndex = componentReader(indices.componentType, false);
      const iv = this.bufferView(indices.bufferView);
      const vv = this.bufferView(vals.bufferView);
      const io = indices.byteOffset ?? 0;
      const vo = vals.byteOffset ?? 0;
      if (io + n * isize > iv.data.byteLength || vo + n * size * csize > vv.data.byteLength) {
        throw new Error(`loadGltf: sparse data of accessor ${index} exceeds its bufferView`);
      }
      for (let k = 0; k < n; k++) {
        const target = readIndex(iv.data, io + k * isize);
        if (target >= count) throw new Error(`loadGltf: sparse index ${target} of accessor ${index} is out of range`);
        for (let c = 0; c < size; c++) values[target * size + c] = read(vv.data, vo + (k * size + c) * csize);
      }
    }
    return { values, size, count };
  }

  private attribute(index: number, size: number, count: number, what: string): Float32Array {
    const a = this.readAccessor(index, 'float');
    if (a.size !== size) throw new Error(`loadGltf: ${what} accessor ${index} must have ${size} components`);
    if (a.count !== count) throw new Error(`loadGltf: ${what} accessor ${index} has ${a.count} elements, POSITION has ${count}`);
    return a.values as Float32Array;
  }

  // ---- meshes -------------------------------------------------------------

  private prepareMesh(meshIndex: number, matrix: Mat4, node: GltfNodeResult): PreparedMesh[] {
    const mesh = this.json.meshes?.[meshIndex];
    if (!mesh) throw new Error(`loadGltf: mesh ${meshIndex} does not exist`);
    const out: PreparedMesh[] = [];
    const baseName = node.name ?? mesh.name;
    mesh.primitives.forEach((prim, p) => {
      const mode = prim.mode ?? 4;
      if (mode <= 3) {
        this.warn('points-lines', 'points and lines primitives are skipped');
        return;
      }
      if (mode > 6) throw new Error(`loadGltf: mesh ${meshIndex} primitive ${p} has an invalid mode ${mode}`);
      if (prim.targets?.length) this.warn('morph', 'morph targets are not supported; meshes render without them');
      const posIndex = prim.attributes?.POSITION;
      if (posIndex === undefined) {
        this.warn('no-position', 'primitives without POSITION are skipped');
        return;
      }
      const pos = this.readAccessor(posIndex, 'float');
      if (pos.size !== 3) throw new Error(`loadGltf: POSITION accessor ${posIndex} must be VEC3`);
      const count = pos.count;
      if (count === 0) return;
      const material = prim.material !== undefined ? this.material(prim.material) : defaultMaterial();
      const normals = prim.attributes.NORMAL !== undefined ? this.attribute(prim.attributes.NORMAL, 3, count, 'NORMAL') : null;
      const uvs = prim.attributes.TEXCOORD_0 !== undefined ? this.attribute(prim.attributes.TEXCOORD_0, 2, count, 'TEXCOORD_0') : null;

      let indices: Uint32Array;
      if (prim.indices !== undefined) {
        const read = this.readAccessor(prim.indices, 'index');
        if (read.size !== 1) throw new Error(`loadGltf: index accessor ${prim.indices} must be SCALAR`);
        indices = read.values as Uint32Array;
        for (let i = 0; i < indices.length; i++) {
          if (indices[i] >= count) throw new Error(`loadGltf: mesh ${meshIndex} primitive ${p} index ${indices[i]} is out of range`);
        }
      } else {
        indices = new Uint32Array(count);
        for (let i = 0; i < count; i++) indices[i] = i;
      }
      indices = toTriangleList(indices, mode);
      if (indices.length === 0) return;

      let mat = material;
      if (hasImages(mat) && !uvs) {
        this.warn('no-uvs', 'textured primitives without TEXCOORD_0 render untextured');
        mat = { ...mat, image: null, maps: noMaps() };
      }
      const baked = bakeTransform(pos.values as Float32Array, normals, indices, matrix);
      out.push({
        node,
        name: baseName !== undefined && mesh.primitives.length > 1 ? `${baseName}#${p}` : baseName,
        positions: baked.positions,
        normals: baked.normals,
        uvs,
        indices: baked.indices,
        material: mat,
        matrix: null,
        rigNode: -1,
      });
    });
    return out;
  }

  // ---- materials / textures -----------------------------------------------

  private material(index: number): MaterialInfo {
    const cached = this.materials.get(index);
    if (cached) return cached;
    const m = this.json.materials?.[index];
    if (!m) throw new Error(`loadGltf: material ${index} does not exist`);
    const pbr = m.pbrMetallicRoughness ?? {};
    const factor = pbr.baseColorFactor ?? [1, 1, 1, 1];
    const mode = m.alphaMode ?? 'OPAQUE';
    const color: RgbaTuple = [linearToSrgb(factor[0]), linearToSrgb(factor[1]), linearToSrgb(factor[2]), mode === 'OPAQUE' ? 1 : clamp01(factor[3] ?? 1)];
    const emissiveFactor = m.emissiveFactor ?? [0, 0, 0];
    const strength = m.extensions?.KHR_materials_emissive_strength?.emissiveStrength ?? 1;
    const finiteOr = (v: number | undefined, d: number) => (v !== undefined && Number.isFinite(v) ? v : d);
    const info: MaterialInfo = {
      color,
      metallic: clamp01(pbr.metallicFactor ?? 1),
      roughness: clamp01(pbr.roughnessFactor ?? 1),
      // Classic shading's base-color glow; PBR uses emissiveColor (* the emissive texture)
      emissive: Math.max(0, emissiveFactor[0] ?? 0, emissiveFactor[1] ?? 0, emissiveFactor[2] ?? 0) * strength,
      alphaTest: mode === 'MASK' ? (m.alphaCutoff ?? 0.5) : 0,
      image: null,
      maps: noMaps(),
      normalScale: finiteOr(m.normalTexture?.scale, 1),
      aoStrength: clamp01(finiteOr(m.occlusionTexture?.strength, 1)),
      emissiveColor: [0, 1, 2].map((i) => Math.max(0, finiteOr(emissiveFactor[i], 0) * strength)) as [number, number, number],
      mapRepeat: [1, 1],
      mapOffset: [0, 0],
    };
    // Every texture shares the object's uv transform: the first textured slot sets it
    let transformOf: { repeat: Vec2Tuple; offset: Vec2Tuple } | null = null;
    const slot = (tex: GltfTextureInfo | undefined, label: string): number | null => {
      if (!tex) return null;
      const transform = tex.extensions?.KHR_texture_transform;
      const texCoord = transform?.texCoord ?? tex.texCoord ?? 0;
      const texture = this.json.textures?.[tex.index];
      if (!texture) throw new Error(`loadGltf: texture ${tex.index} does not exist`);
      if (texCoord !== 0) {
        this.warn('texcoord', 'textures on TEXCOORD_1 or higher are not supported and are ignored');
        return null;
      }
      if (texture.source === undefined) {
        this.warn('texture-source', 'textures without a PNG / JPEG source are ignored');
        return null;
      }
      if (!this.json.images?.[texture.source]) throw new Error(`loadGltf: image ${texture.source} does not exist`);
      if (transform?.rotation) this.warn('uv-rotation', 'KHR_texture_transform rotation is not supported and is ignored');
      const repeat: Vec2Tuple = transform?.scale ? [transform.scale[0], transform.scale[1]] : [1, 1];
      const offset: Vec2Tuple = transform?.offset ? [transform.offset[0], transform.offset[1]] : [0, 0];
      if (!transformOf) {
        transformOf = { repeat, offset };
      } else if (repeat.some((v, i) => v !== transformOf!.repeat[i]) || offset.some((v, i) => v !== transformOf!.offset[i])) {
        this.warn('map-transform', `all textures of a material share one uv transform; the ${label} texture's KHR_texture_transform is ignored`);
      }
      return texture.source;
    };
    info.image = slot(pbr.baseColorTexture, 'base color');
    info.maps.metallicRoughnessMap = slot(pbr.metallicRoughnessTexture, 'metallic-roughness');
    info.maps.normalMap = slot(m.normalTexture, 'normal');
    info.maps.aoMap = slot(m.occlusionTexture, 'occlusion');
    info.maps.emissiveMap = slot(m.emissiveTexture, 'emissive');
    const shared = transformOf as { repeat: Vec2Tuple; offset: Vec2Tuple } | null;
    if (shared) {
      info.mapRepeat = shared.repeat;
      info.mapOffset = shared.offset;
    }
    this.materials.set(index, info);
    return info;
  }

  /** Loads every image the meshes use once; returns image index -> texture id. */
  private async loadImages(meshes: PreparedMesh[], created: { textures: number[] }): Promise<Map<number, number>> {
    const images = new Set<number>();
    for (const m of meshes) for (const image of materialImages(m.material)) images.add(image);
    const out = new Map<number, number>();
    if (images.size === 0) return out;
    if (!(this.host.maxTextureSize > 0)) {
      this.warn('no-texture-support', 'the engine has no texture support; models render untextured');
      return out;
    }
    const order = [...images];
    const results = await Promise.allSettled(order.map((i) => this.loadImage(i)));
    let failure: unknown = null;
    results.forEach((r, k) => {
      if (r.status === 'fulfilled') {
        created.textures.push(r.value);
        out.set(order[k], r.value);
      } else {
        failure ??= r.reason;
      }
    });
    if (failure !== null) throw failure;
    checkAbort(this.signal);
    return out;
  }

  private async loadImage(index: number): Promise<number> {
    const image = this.json.images![index];
    const opts = { signal: this.signal };
    try {
      if (image.uri !== undefined) {
        if (image.uri.startsWith('data:')) {
          const { bytes, mime } = decodeDataUri(image.uri);
          return await this.host.loadTexture(new Blob([bytes], { type: image.mimeType ?? mime }), opts);
        }
        return await this.host.loadTexture(resolveUri(image.uri, this.base), opts);
      }
      if (image.bufferView === undefined) throw new Error('has no uri or bufferView');
      const { data } = this.bufferView(image.bufferView);
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      return await this.host.loadTexture(new Blob([bytes], { type: image.mimeType ?? '' }), opts);
    } catch (e) {
      if (this.signal?.aborted) throw abortError(this.signal);
      throw new Error(`loadGltf: image ${index}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function componentReader(componentType: number, normalized: boolean): (view: DataView, offset: number) => number {
  switch (componentType) {
    case 5120:
      return normalized ? (v, o) => Math.max(v.getInt8(o) / 127, -1) : (v, o) => v.getInt8(o);
    case 5121:
      return normalized ? (v, o) => v.getUint8(o) / 255 : (v, o) => v.getUint8(o);
    case 5122:
      return normalized ? (v, o) => Math.max(v.getInt16(o, true) / 32767, -1) : (v, o) => v.getInt16(o, true);
    case 5123:
      return normalized ? (v, o) => v.getUint16(o, true) / 65535 : (v, o) => v.getUint16(o, true);
    case 5125:
      return (v, o) => v.getUint32(o, true);
    default:
      return (v, o) => v.getFloat32(o, true);
  }
}

/** TRIANGLES / TRIANGLE_STRIP / TRIANGLE_FAN indices as a triangle list. */
export function toTriangleList(indices: Uint32Array, mode: number): Uint32Array {
  if (mode === 4) return indices.length % 3 === 0 ? indices : indices.subarray(0, indices.length - (indices.length % 3));
  const n = Math.max(0, indices.length - 2);
  const out = new Uint32Array(n * 3);
  for (let i = 0; i < n; i++) {
    if (mode === 5) {
      // Strip: every other triangle is flipped to keep the winding
      out[i * 3] = indices[i];
      out[i * 3 + 1] = indices[i + 1 + (i % 2)];
      out[i * 3 + 2] = indices[i + 2 - (i % 2)];
    } else {
      out[i * 3] = indices[i + 1];
      out[i * 3 + 1] = indices[i + 2];
      out[i * 3 + 2] = indices[0];
    }
  }
  return out;
}

/** Applies `matrix` to positions and (inverse-transpose) normals; flips the winding of mirrored meshes. */
export function bakeTransform(
  src: Float32Array,
  srcNormals: Float32Array | null,
  srcIndices: Uint32Array,
  m: Mat4
): { positions: Float32Array; normals: Float32Array; indices: Uint32Array } {
  const count = src.length / 3;
  const positions = new Float32Array(src.length);
  for (let i = 0; i < count; i++) {
    const x = src[i * 3];
    const y = src[i * 3 + 1];
    const z = src[i * 3 + 2];
    positions[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  // Columns a, b, c of the linear part: inverse transpose = [b x c, c x a, a x b] / det
  const a = [m[0], m[1], m[2]];
  const b = [m[4], m[5], m[6]];
  const c = [m[8], m[9], m[10]];
  const bc = cross(b, c);
  const ca = cross(c, a);
  const ab = cross(a, b);
  const det = a[0] * bc[0] + a[1] * bc[1] + a[2] * bc[2];
  let indices = srcIndices;
  if (det < 0) {
    indices = new Uint32Array(srcIndices);
    for (let t = 0; t + 2 < indices.length; t += 3) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }
  let normals: Float32Array;
  if (srcNormals) {
    normals = new Float32Array(srcNormals.length);
    const s = det < 0 ? -1 : 1;
    for (let i = 0; i < count; i++) {
      const nx = srcNormals[i * 3];
      const ny = srcNormals[i * 3 + 1];
      const nz = srcNormals[i * 3 + 2];
      const x = (bc[0] * nx + ca[0] * ny + ab[0] * nz) * s;
      const y = (bc[1] * nx + ca[1] * ny + ab[1] * nz) * s;
      const z = (bc[2] * nx + ca[2] * ny + ab[2] * nz) * s;
      const len = Math.hypot(x, y, z);
      if (len > 0) {
        normals[i * 3] = x / len;
        normals[i * 3 + 1] = y / len;
        normals[i * 3 + 2] = z / len;
      } else {
        normals[i * 3 + 1] = 1;
      }
    }
  } else {
    normals = smoothNormals(positions, indices);
  }
  return { positions, normals, indices };
}

/** Area-weighted vertex normals from counter-clockwise triangles. */
function smoothNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const i0 = indices[t] * 3;
    const i1 = indices[t + 1] * 3;
    const i2 = indices[t + 2] * 3;
    const e1 = [positions[i1] - positions[i0], positions[i1 + 1] - positions[i0 + 1], positions[i1 + 2] - positions[i0 + 2]];
    const e2 = [positions[i2] - positions[i0], positions[i2 + 1] - positions[i0 + 1], positions[i2 + 2] - positions[i0 + 2]];
    const n = cross(e1, e2);
    for (const i of [i0, i1, i2]) {
      normals[i] += n[0];
      normals[i + 1] += n[1];
      normals[i + 2] += n[2];
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    } else {
      normals[i + 1] = 1;
    }
  }
  return normals;
}

function worldBounds(meshes: PreparedMesh[], position: Vec3Tuple, rotation: Vec3Tuple): { min: Vec3Tuple; max: Vec3Tuple } {
  if (meshes.length === 0) return { min: [...position], max: [...position] };
  const r = eulerYXZ(rotation);
  const min: Vec3Tuple = [Infinity, Infinity, Infinity];
  const max: Vec3Tuple = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) {
    const p = mesh.matrix ? bakeTransform(mesh.positions, null, new Uint32Array(0), mesh.matrix).positions : mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const v = r[k] * p[i] + r[3 + k] * p[i + 1] + r[6 + k] * p[i + 2] + position[k];
        if (v < min[k]) min[k] = v;
        if (v > max[k]) max[k] = v;
      }
    }
  }
  return { min, max };
}

/** Column-major 3x3 rotation of the engine's Euler convention (Ry * Rx * Rz). */
function eulerYXZ([rx, ry, rz]: Vec3Tuple): number[] {
  const [cx, sx, cy, sy, cz, sz] = [Math.cos(rx), Math.sin(rx), Math.cos(ry), Math.sin(ry), Math.cos(rz), Math.sin(rz)];
  const mul = (p: number[], q: number[]) => {
    const o = new Array<number>(9).fill(0);
    for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) for (let k = 0; k < 3; k++) o[col * 3 + row] += p[k * 3 + row] * q[col * 3 + k];
    return o;
  };
  const Rx = [1, 0, 0, 0, cx, sx, 0, -sx, cx];
  const Ry = [cy, 0, -sy, 0, 1, 0, sy, 0, cy];
  const Rz = [cz, sz, 0, -sz, cz, 0, 0, 0, 1];
  return mul(mul(Ry, Rx), Rz);
}

function nodeMatrix(node: GltfNode): Mat4 {
  if (node.matrix) {
    if (node.matrix.length !== 16) throw new Error('loadGltf: node matrix must have 16 numbers');
    return Float64Array.from(node.matrix);
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  let [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const m = new Float64Array(16);
  m[0] = (1 - 2 * (y * y + z * z)) * sx;
  m[1] = 2 * (x * y + w * z) * sx;
  m[2] = 2 * (x * z - w * y) * sx;
  m[4] = 2 * (x * y - w * z) * sy;
  m[5] = (1 - 2 * (x * x + z * z)) * sy;
  m[6] = 2 * (y * z + w * x) * sy;
  m[8] = 2 * (x * z + w * y) * sz;
  m[9] = 2 * (y * z - w * x) * sz;
  m[10] = (1 - 2 * (x * x + y * y)) * sz;
  m[12] = tx;
  m[13] = ty;
  m[14] = tz;
  m[15] = 1;
  return m;
}

function identity(): Mat4 {
  return scaleMatrix([1, 1, 1]);
}

function scaleMatrix([x, y, z]: Vec3Tuple): Mat4 {
  const m = new Float64Array(16);
  m[0] = x;
  m[5] = y;
  m[10] = z;
  m[15] = 1;
  return m;
}

/** Column-major `a * b`. */
function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = s;
    }
  }
  return out;
}

function cross(a: ArrayLike<number>, b: ArrayLike<number>): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---------------------------------------------------------------------------
// Animation rig
// ---------------------------------------------------------------------------

function emptyRig(): GltfRig {
  return {
    gltfNode: new Int32Array(0),
    parent: new Int32Array(0),
    dynamic: new Uint8Array(0),
    rest: new Float64Array(0),
    fixed: [],
    world: new Float64Array(0),
    base: identity(),
    targets: { ids: new Uint32Array(0), nodes: new Int32Array(0) },
    clips: [],
  };
}

function buildRig(
  order: VisitedNode[],
  dynamic: Uint8Array,
  base: Mat4,
  clips: GltfClip[],
  objects: { id: number; mesh: PreparedMesh }[]
): GltfRig {
  const n = order.length;
  const rig: GltfRig = {
    gltfNode: new Int32Array(n),
    parent: new Int32Array(n),
    dynamic,
    rest: new Float64Array(n * 10),
    fixed: new Array<Float64Array | null>(n).fill(null),
    world: new Float64Array(n * 16),
    base,
    targets: { ids: Uint32Array.from(objects.map((o) => o.id)), nodes: Int32Array.from(objects.map((o) => o.mesh.rigNode)) },
    clips,
  };
  order.forEach((v, i) => {
    rig.parent[i] = v.parent;
    rig.gltfNode[i] = v.index;
    rig.world.set(v.world, i * 16);
    const node = v.node;
    if (node.matrix) {
      rig.fixed[i] = nodeMatrix(node);
      return;
    }
    const t = node.translation ?? [0, 0, 0];
    const r = node.rotation ?? [0, 0, 0, 1];
    const s = node.scale ?? [1, 1, 1];
    const len = Math.hypot(r[0], r[1], r[2], r[3]) || 1;
    rig.rest.set([t[0], t[1], t[2], r[0] / len, r[1] / len, r[2] / len, r[3] / len, s[0], s[1], s[2]], i * 10);
  });
  return rig;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function noMaps(): Record<GltfMapSlot, number | null> {
  return { metallicRoughnessMap: null, normalMap: null, aoMap: null, emissiveMap: null };
}

function defaultMaterial(): MaterialInfo {
  return {
    color: [1, 1, 1, 1],
    metallic: 1,
    roughness: 1,
    emissive: 0,
    alphaTest: 0,
    image: null,
    maps: noMaps(),
    normalScale: 1,
    aoStrength: 1,
    emissiveColor: [0, 0, 0],
    mapRepeat: [1, 1],
    mapOffset: [0, 0],
  };
}

/** glTF factors are linear; the renderer shades in gamma (sRGB-like) space. */
function linearToSrgb(v: number | undefined): number {
  const c = clamp01(v ?? 1);
  if (c >= 1) return 1;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function resolveScale(scale: number | Vec3Tuple | undefined): Vec3Tuple {
  const s: Vec3Tuple = scale === undefined ? [1, 1, 1] : typeof scale === 'number' ? [scale, scale, scale] : [scale[0], scale[1], scale[2]];
  if (!s.every((v) => Number.isFinite(v) && v !== 0)) throw new Error('loadGltf: scale must be a non-zero finite number or [x, y, z]');
  return s;
}

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.name === 'AbortError') return reason;
  return new DOMException('loadGltf: aborted', 'AbortError');
}

function gltfError(e: unknown): Error {
  if (e instanceof Error && (e.name === 'AbortError' || e.message.startsWith('loadGltf:'))) return e;
  const err = new Error(`loadGltf: ${e instanceof Error ? e.message : String(e)}`);
  (err as Error & { cause?: unknown }).cause = e;
  return err;
}
