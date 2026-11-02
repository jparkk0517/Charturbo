/**
 * Previs player: applies an evaluated frame (`evaluateFrame`) to a Charturbo 3D scene. The caller
 * validates the doc, creates the player (`createPrevisPlayer`, or `loadPrevisPlayer` when the doc
 * has `model` nodes), calls `frame(t)` and then `sdk.render()` (and grabs the canvas for video).
 *
 * FLAT COLOR RECIPE (a node must render as exactly its `color`)
 * Shading model `pbr` (`fs_mesh_pbr`, crates/charturbo-core/src/renderer/shader.rs) with
 * toneMapping 'none', exposure 1 and environment intensity 0, ambient / directional / point
 * intensity 0 and material emissive 1 (metallic 0, roughness 1) leaves
 *   out = linear_to_srgb(srgb_to_linear(base) * emissive) = base,
 * which is exact at every viewing angle (the sRGB round trip is lossless).
 * Shadows, helpers (grid/axes), the graph and rigid physics are off. Alpha is exact.
 * MEASURED (previews rendered in headless Chrome, WebGL2 and WebGPU, web/previs/examples/flat-swatches.json):
 * error <= 0.5/255 on face-on swatches and also on faces tilted 40, 61 and 77 degrees.
 * The `classic` model was rejected: its hard-coded fresnel rim 0.14*(1-N.V)^3 lifts every channel
 * (measured 0.5/255 at 40 deg, 5/255 at 61 deg, 16/255 at 77 deg).
 * glTF objects get the same material plus every loader input that would change the result cleared
 * (`FLAT_GLTF_MATERIAL`): base color map, alphaTest (glTF MASK), emissiveColor / emissiveMap
 * (non-black emissiveColor replaces `color * emissive`), metallic-roughness / normal / AO maps.
 * The loader has no vertex colors, so this leaves exactly `color`.
 *
 * SIZE-DECOUPLED HIERARCHY
 * The engine multiplies a parent's scale into its children's offsets (world = parentWorld * local),
 * but a previs `size` must only size the node's own shape (see types.ts / evaluate.ts). So each
 * node becomes a PIVOT object (scale [1,1,1], local position/rotation, parent = the parent's pivot)
 * and, when it has a visible shape, a child MESH object (scale = size*worldScale, position 0).
 * The engine clamps object scale to >= 0.05 units, so a mesh smaller than 0.05/worldScale meters
 * per axis is drawn at 0.05 units.
 *
 * MODEL NODES (`shape: 'model'`, loaded by `loadPrevisPlayer`)
 * Instead of a MESH a model node gets a FIT object under its pivot (alpha-0 unit box, rotation 0)
 * and the loader's objects (one per triangle primitive) are re-parented under the FIT with an
 * identity local transform, so world = pivotWorld * FIT * meshMatrix (node animation and CPU
 * skinning keep working). With the rest-pose bounds (center c, extent e, engine units after the
 * load scale) and s = size*worldScale, FIT has scale k and position -k*c, which puts the bounds
 * center on the node origin:
 *   contain: k = min(s_i / e_i) over axes with e_i > 0, uniform (k = 1 if no such axis);
 *   stretch: k_i = s_i / e_i; an axis with e_i ~ 0 (< 1e-6 of the largest extent, flat models)
 *            takes the contain factor, so the flat axis scales like the rest.
 * A `size` track only updates FIT (one call per change). Small units (e.g. millimeter files): the
 * FIT scale would be clamped at 0.05, so after a first load at scale 1 the player computes the
 * smallest factor any axis can need (rest size and every size key; eases never overshoot) and, if
 * it is below 0.05, disposes that load and reloads with it baked in via `loadGltf({ scale })`;
 * `PrevisLoadOptions.decoders` goes to every `loadGltf` call (both loads), for compressed models;
 * then every FIT factor is >= 1. Only an axis whose size reaches 0 still hits the clamp.
 * Clips run on a `GltfAnimator` without auto update. `animation` is one segment or an array of
 * segments (see `PrevisModelAnimation`: clip, start, speed, loop, blendIn); the object form is
 * segment 0. Every segment's clip is validated against the model's animations at load. Each frame
 * maps `NodeState.clips` (1 entry, or 2 while cross-fading: previous segment first) to
 * `animator.setBlend([{ clip, time, weight, loop }])` with loop defaulting to 'repeat' per segment
 * (the animator wraps each time per its loop); it is called only when a segment, time or weight
 * changed since the last call. The frame-0 clips are applied at load as the initial pose.
 *
 * CAMERA
 * Each frame calls `sdk.setCameraView({ eye, target, roll })` (meters * worldScale, roll in radians): an
 * exact look-at with no distance or pitch clamp (close-ups and straight-down shots render as authored;
 * straight down / up uses the engine's up fallback). The call is skipped while eye, target and roll are
 * unchanged. When it returns false nothing throws and the call is retried next frame: for eye == target
 * the previous camera stays; an engine build without the binding gets the clamped `setCameraPose`
 * fallback instead. The far plane is the engine's orbit far (2000 units unless a fit widened it).
 *
 * INVISIBLE OBJECTS
 * The engine has no per-object visibility flag in its API, so invisible = color alpha 0: pivots
 * and FIT objects are unit boxes with alpha 0; they go through the translucent pipeline
 * (ALPHA_BLENDING, no depth write), which leaves the framebuffer unchanged. A shape hidden by its
 * `visible` track gets alpha 0 via `setObjectMaterial` (every loader object of a model). Pure pivot
 * nodes (`visible: false` with no visible=true key) get no mesh; a pure pivot model node is not
 * loaded at all.
 */
import type { Charturbo, ObjectMaterialDescriptor, PrimitiveShape } from '../sdk/charturbo';
import type { GltfSource, GltfLoadResult, GltfDecoders } from '../sdk/scene-gltf';
import type { GltfAnimator, GltfClipWeight } from '../sdk/scene-gltf-anim';
import { clipWeightsAt, evaluateFrame } from './evaluate';
import type { ClipWeight, FrameState, PrevisDoc, PrevisModelAnimation, PrevisModelFit, PrevisNode, Rgb, Vec3 } from './types';

export interface PrevisPlayer {
  /** Applies the doc at `time` seconds to the scene (call `sdk.render()` afterwards). */
  frame(time: number): FrameState;
  /** Removes the created objects and glTF models (with their animators) and restores the theme (background). */
  dispose(): void;
}

export interface PrevisLoadOptions {
  /** Maps a node's model.src to what sdk.loadGltf accepts. Default: the src string itself (URL). */
  resolveModel?: (src: string) => GltfSource | Promise<GltfSource>;
  /** Passed to every `sdk.loadGltf` call (Draco / meshopt compressed models; see `GltfLoadOptions.decoders`). */
  decoders?: GltfDecoders;
  signal?: AbortSignal;
}

const DEFAULT_WORLD_SCALE = 10;
/** The engine clamps every object scale per axis to at least this (crates/charturbo-core/src/scene/mod.rs). */
const MIN_OBJECT_SCALE = 0.05;
/** Extents below this fraction of the largest extent count as zero for `fit`. */
const FLAT_EXTENT = 1e-6;

/** Loader material inputs cleared on every glTF object (see FLAT COLOR RECIPE). */
const FLAT_GLTF_MATERIAL: Omit<ObjectMaterialDescriptor, 'color'> = {
  emissive: 1,
  metallic: 0,
  roughness: 1,
  map: null,
  alphaTest: 0,
  metallicRoughnessMap: null,
  normalMap: null,
  aoMap: null,
  emissiveMap: null,
  emissiveColor: [0, 0, 0],
};

interface ModelObjects {
  result: GltfLoadResult;
  fitId: number;
  fit: PrevisModelFit;
  /** Rest-pose bounds center / extent in engine units (load scale applied). */
  center: Vec3;
  extent: Vec3;
  animator: GltfAnimator | null;
  /** Segments of the node's animation (object form = one segment). */
  segments: PrevisModelAnimation[];
  /** Clip weights last sent to the animator. */
  clips: ClipWeight[];
}

interface NodeObjects {
  node: PrevisNode;
  pivotId: number;
  meshId: number | null;
  model: ModelObjects | null;
  /** Last values sent to the engine; per-frame calls are skipped while unchanged. */
  pos: Vec3;
  rot: Vec3;
  /** size * worldScale */
  meshScale: Vec3;
  meshVisible: boolean;
}

const eqVec = (a: Vec3, b: Vec3): boolean => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const scaled = (v: Vec3, k: number): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
const rgba = (c: Rgb, visible: boolean): [number, number, number, number] => [c[0], c[1], c[2], visible ? 1 : 0];

/** Parents before children (document order otherwise); tolerates cycles/unknown parents. */
function topoOrder(nodes: PrevisNode[]): PrevisNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  const out: PrevisNode[] = [];
  const visit = (n: PrevisNode, stack: Set<string>): void => {
    if (done.has(n.id) || stack.has(n.id)) return;
    stack.add(n.id);
    const parent = n.parent !== undefined ? byId.get(n.parent) : undefined;
    if (parent) visit(parent, stack);
    stack.delete(n.id);
    done.add(n.id);
    out.push(n);
  };
  for (const n of nodes) visit(n, new Set());
  return out;
}

/** True when the node ever shows a shape: visible at rest or some visible key is true. */
function hasShape(n: PrevisNode): boolean {
  return n.visible !== false || (n.tracks?.visible?.some((k) => k.v) ?? false);
}

/** Axes whose extent counts as non-zero. */
function solidAxes(extent: Vec3): boolean[] {
  const max = Math.max(extent[0], extent[1], extent[2]);
  return extent.map((e) => e > 0 && e > max * FLAT_EXTENT);
}

/** FIT object scale for a model of rest `extent` drawn at `size` (both engine units); see header. */
function modelFitScale(fit: PrevisModelFit, size: Vec3, extent: Vec3): Vec3 {
  const solid = solidAxes(extent);
  let k = Infinity;
  for (let i = 0; i < 3; i++) if (solid[i]) k = Math.min(k, size[i] / extent[i]);
  if (k === Infinity) k = 1;
  if (fit === 'stretch') return [0, 1, 2].map((i) => (solid[i] ? size[i] / extent[i] : k)) as Vec3;
  return [k, k, k];
}

/** Smallest FIT factor the node can need over its rest size and size keys (Infinity: none). */
function minFitFactor(n: PrevisNode, ws: number, extent: Vec3): number {
  const sizes = [n.size, ...(n.tracks?.size ?? []).map((k) => k.v)];
  const solid = solidAxes(extent);
  let k = Infinity;
  for (let i = 0; i < 3; i++) {
    if (!solid[i]) continue;
    for (const s of sizes) if (s[i] > 0) k = Math.min(k, (s[i] * ws) / extent[i]);
  }
  return k;
}

function boundsOf(r: GltfLoadResult): { center: Vec3; extent: Vec3 } {
  const center = [0, 1, 2].map((i) => {
    const c = (r.bounds.min[i] + r.bounds.max[i]) / 2;
    return Number.isFinite(c) ? c : 0;
  }) as Vec3;
  const extent = [0, 1, 2].map((i) => {
    const e = r.bounds.max[i] - r.bounds.min[i];
    return Number.isFinite(e) && e > 0 ? e : 0;
  }) as Vec3;
  return { center, extent };
}

/** Flat look (see header); returns the theme to restore. */
function setupScene(sdk: Charturbo, doc: PrevisDoc): ReturnType<Charturbo['getTheme']> {
  const prevTheme = sdk.getTheme();
  sdk.setGraphVisible(false);
  sdk.setRigidPhysics(false);
  sdk.setHelpers({ showGrid: false, showAxes: false });
  sdk.setShadows({ enabled: false });
  sdk.setShading({ model: 'pbr', toneMapping: 'none', exposure: 1, environment: { intensity: 0 } });
  sdk.setLighting({ ambientIntensity: 0, directionalIntensity: 0, pointIntensity: 0 });
  sdk.setTheme({ ...prevTheme, surface: [doc.background[0], doc.background[1], doc.background[2], 1] });
  return prevTheme;
}

/** Creates pivots and primitive meshes (model nodes get their FIT later); pushes ids onto `created`. */
function buildNodes(sdk: Charturbo, doc: PrevisDoc, ws: number, created: number[]): Map<string, NodeObjects> {
  const objects = new Map<string, NodeObjects>();
  const pivotIds = new Map<string, number>();
  for (const n of topoOrder(doc.nodes)) {
    const pos = scaled(n.position, ws);
    const rot: Vec3 = [...n.rotation];
    const pivotId = sdk.addPrimitive({
      shape: 'box',
      name: `previs:${n.id}`,
      position: pos,
      rotation: rot,
      scale: [1, 1, 1],
      color: [0, 0, 0, 0],
      bodyType: 'static',
      parentId: n.parent !== undefined ? (pivotIds.get(n.parent) ?? null) : null,
      castShadow: false,
      receiveShadow: false,
    });
    pivotIds.set(n.id, pivotId);
    created.push(pivotId);

    const meshScale = scaled(n.size, ws);
    const meshVisible = n.visible !== false;
    let meshId: number | null = null;
    if (hasShape(n) && n.shape !== 'model') {
      meshId = sdk.addPrimitive({
        shape: n.shape as PrimitiveShape,
        name: `previs:${n.id}:mesh`,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: meshScale,
        color: rgba(n.color, meshVisible),
        metallic: 0,
        roughness: 1,
        emissive: 1,
        bodyType: 'static',
        parentId: pivotId,
        castShadow: false,
        receiveShadow: false,
      });
      created.push(meshId);
    }
    objects.set(n.id, { node: n, pivotId, meshId, model: null, pos, rot, meshScale, meshVisible });
  }
  return objects;
}

/** Puts a loaded model under a new FIT object of node `o` and applies the flat look and its clip. */
function attachModel(sdk: Charturbo, o: NodeObjects, result: GltfLoadResult, created: number[]): void {
  const n = o.node;
  const { center, extent } = boundsOf(result);
  const fit = n.model?.fit ?? 'contain';
  const k = modelFitScale(fit, o.meshScale, extent);
  const fitId = sdk.addPrimitive({
    shape: 'box',
    name: `previs:${n.id}:fit`,
    position: [-k[0] * center[0], -k[1] * center[1], -k[2] * center[2]],
    rotation: [0, 0, 0],
    scale: k,
    color: [0, 0, 0, 0],
    bodyType: 'static',
    parentId: o.pivotId,
    castShadow: false,
    receiveShadow: false,
  });
  created.push(fitId);
  for (const id of result.objects) {
    sdk.setObjectParent(id, fitId);
    sdk.setObjectMaterial(id, { ...FLAT_GLTF_MATERIAL, color: rgba(n.color, o.meshVisible) });
  }
  let animator: GltfAnimator | null = null;
  let segments: PrevisModelAnimation[] = [];
  let clips: ClipWeight[] = [];
  const anim = n.model?.animation;
  if (anim) {
    animator = sdk.createGltfAnimator(result, { autoUpdate: false });
    segments = normalizeAnimation(anim);
    clips = clipWeightsAt(anim, 0);
    animator.setBlend(toBlend(segments, clips)); // initial pose = frame 0
  }
  o.model = { result, fitId, fit, center, extent, animator, segments, clips };
}

function normalizeAnimation(anim: PrevisModelAnimation | PrevisModelAnimation[]): PrevisModelAnimation[] {
  return Array.isArray(anim) ? anim : [anim];
}

function toBlend(segments: PrevisModelAnimation[], clips: ClipWeight[]): GltfClipWeight[] {
  return clips.map((c) => {
    const seg = segments[c.segment];
    return { clip: seg.clip, time: c.time, weight: c.weight, loop: seg.loop ?? 'repeat' };
  });
}

function sameClips(a: ClipWeight[], b: ClipWeight[]): boolean {
  return a.length === b.length && a.every((c, i) => c.segment === b[i].segment && c.time === b[i].time && c.weight === b[i].weight);
}

function makePlayer(
  sdk: Charturbo,
  doc: PrevisDoc,
  ws: number,
  prevTheme: ReturnType<Charturbo['getTheme']>,
  objects: Map<string, NodeObjects>,
  created: number[],
): PrevisPlayer {
  let camEye: Vec3 | null = null;
  let camTarget: Vec3 | null = null;
  let camFov: number | null = null;
  let camRoll = 0;
  let disposed = false;

  return {
    frame(time: number): FrameState {
      const fs = evaluateFrame(doc, time);

      for (const [id, o] of objects) {
        const st = fs.nodes[id];
        if (!st) continue;
        const pos = scaled(st.position, ws);
        if (!eqVec(pos, o.pos) || !eqVec(st.rotation, o.rot)) {
          sdk.setObjectTransform(o.pivotId, { position: pos, rotation: [...st.rotation] });
          o.pos = pos;
          o.rot = [...st.rotation];
        }
        const m = o.model;
        if (o.meshId === null && m === null) continue;
        const ms = scaled(st.size, ws);
        if (!eqVec(ms, o.meshScale)) {
          if (m) {
            const k = modelFitScale(m.fit, ms, m.extent);
            sdk.setObjectTransform(m.fitId, {
              position: [-k[0] * m.center[0], -k[1] * m.center[1], -k[2] * m.center[2]],
              scale: k,
            });
          } else {
            sdk.setObjectTransform(o.meshId!, { scale: ms });
          }
          o.meshScale = ms;
        }
        if (st.visible !== o.meshVisible) {
          const color = rgba(o.node.color, st.visible);
          if (m) for (const oid of m.result.objects) sdk.setObjectMaterial(oid, { color });
          else sdk.setObjectMaterial(o.meshId!, { color });
          o.meshVisible = st.visible;
        }
        if (m?.animator) {
          // evaluate.ts sets clips on every model node with an animation
          const cl = st.clips ?? m.clips;
          if (!sameClips(cl, m.clips)) {
            m.animator.setBlend(toBlend(m.segments, cl));
            m.clips = cl;
          }
        }
      }

      const eye = scaled(fs.camera.eye, ws);
      const target = scaled(fs.camera.target, ws);
      const roll = fs.camera.roll;
      if (!camEye || !camTarget || !eqVec(eye, camEye) || !eqVec(target, camTarget) || roll !== camRoll) {
        // Exact look-at: no distance / pitch clamp. false (eye == target) keeps the previous camera.
        if (sdk.setCameraView({ eye, target, roll })) {
          camEye = eye;
          camTarget = target;
          camRoll = roll;
        }
      }
      if (fs.camera.fovDeg !== camFov) {
        sdk.setCameraFov(fs.camera.fovDeg);
        camFov = fs.camera.fovDeg;
      }
      return fs;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      // Models (and their animators) before the FIT / pivot objects they hang from
      for (const o of objects.values()) if (o.model) sdk.disposeGltf(o.model.result);
      // Children first: a mesh goes before its pivot, a pivot after its children
      for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
      created.length = 0;
      objects.clear();
      sdk.setTheme(prevTheme);
    },
  };
}

const hasModels = (doc: PrevisDoc): boolean => doc.nodes.some((n) => n.shape === 'model');

/** Sync player for docs without `model` nodes (use `loadPrevisPlayer` for those). */
export function createPrevisPlayer(sdk: Charturbo, doc: PrevisDoc): PrevisPlayer {
  if (hasModels(doc)) throw new Error('createPrevisPlayer: doc has model nodes, use loadPrevisPlayer');
  const ws = doc.worldScale ?? DEFAULT_WORLD_SCALE;
  const prevTheme = setupScene(sdk, doc);
  const created: number[] = [];
  const objects = buildNodes(sdk, doc, ws, created);
  return makePlayer(sdk, doc, ws, prevTheme, objects, created);
}

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ?? Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Player for any doc: loads the glTF files of `model` nodes (in parallel; resolved sources are
 * cached per `src`, each node gets its own load) and then behaves like `createPrevisPlayer`. On a
 * failure or abort everything created so far is removed, the theme restored and the promise
 * rejects with `loadPrevisPlayer: node "<id>" (<src>): <cause>`.
 */
export async function loadPrevisPlayer(sdk: Charturbo, doc: PrevisDoc, options: PrevisLoadOptions = {}): Promise<PrevisPlayer> {
  const { signal } = options;
  if (signal?.aborted) throw new Error(`loadPrevisPlayer: ${messageOf(abortError(signal))}`, { cause: abortError(signal) });
  const ws = doc.worldScale ?? DEFAULT_WORLD_SCALE;
  const prevTheme = setupScene(sdk, doc);
  const created: number[] = [];
  const loaded = new Set<GltfLoadResult>();
  // Aborts the sibling loads on the first failure, and on the caller's signal
  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort(signal!.reason);
  signal?.addEventListener('abort', onAbort);
  const sources = new Map<string, Promise<GltfSource>>();
  const resolve = (src: string): Promise<GltfSource> => {
    let p = sources.get(src);
    if (!p) {
      p = Promise.resolve(options.resolveModel ? options.resolveModel(src) : src);
      sources.set(src, p);
    }
    return p;
  };
  const results = new Map<NodeObjects, GltfLoadResult>();
  let failure: { node: PrevisNode; cause: unknown } | null = null;

  const loadNode = async (o: NodeObjects): Promise<void> => {
    const n = o.node;
    const model = n.model!;
    const anim = model.animation;
    const check = (): void => {
      if (ctl.signal.aborted) throw abortError(ctl.signal);
    };
    const load = async (scale?: number): Promise<GltfLoadResult> => {
      const source = await resolve(model.src);
      check();
      const r = await sdk.loadGltf(source, {
        signal: ctl.signal,
        animations: anim !== undefined,
        ...(options.decoders ? { decoders: options.decoders } : {}),
        ...(scale !== undefined ? { scale } : {}),
      });
      loaded.add(r);
      check();
      return r;
    };
    try {
      check();
      let r = await load();
      if (r.objects.length === 0) throw new Error('the model has no triangle meshes');
      const kMin = minFitFactor(n, ws, boundsOf(r).extent);
      if (kMin < MIN_OBJECT_SCALE) {
        // Too small for the object scale clamp: bake the factor into the vertices (see header)
        loaded.delete(r);
        sdk.disposeGltf(r);
        r = await load(kMin);
      }
      if (anim) {
        const names = r.animations.map((a) => a.name);
        for (const { clip } of normalizeAnimation(anim)) {
          const ok = typeof clip === 'number' ? Number.isInteger(clip) && clip >= 0 && clip < names.length : names.includes(clip);
          if (!ok) {
            const list = names.length > 0 ? names.map((s, i) => `${i} ${JSON.stringify(s)}`).join(', ') : 'none';
            throw new Error(`unknown animation clip ${JSON.stringify(clip)} (available: ${list})`);
          }
        }
      }
      results.set(o, r);
    } catch (e) {
      if (!failure) {
        failure = { node: n, cause: e };
        ctl.abort();
      }
      throw e;
    }
  };

  const objects = buildNodes(sdk, doc, ws, created);
  const jobs = [...objects.values()].filter((o) => o.node.shape === 'model' && o.node.model && hasShape(o.node));
  await Promise.allSettled(jobs.map(loadNode));
  signal?.removeEventListener('abort', onAbort);

  const fail = (node: PrevisNode, cause: unknown): never => {
    for (const r of loaded) sdk.disposeGltf(r);
    for (let i = created.length - 1; i >= 0; i--) sdk.removeObject(created[i]);
    sdk.setTheme(prevTheme);
    throw new Error(`loadPrevisPlayer: node "${node.id}" (${node.model?.src}): ${messageOf(cause)}`, { cause });
  };
  if (failure) {
    const f: { node: PrevisNode; cause: unknown } = failure;
    return fail(f.node, f.cause);
  }
  for (const o of jobs) {
    try {
      attachModel(sdk, o, results.get(o)!, created);
    } catch (e) {
      return fail(o.node, e);
    }
  }
  return makePlayer(sdk, doc, ws, prevTheme, objects, created);
}
