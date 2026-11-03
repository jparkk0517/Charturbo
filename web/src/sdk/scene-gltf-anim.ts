// glTF keyframe animation (node translation / rotation / scale) and skins (no morph targets).
// The loader keeps animated subtrees as a rig: meshes under animated nodes stay in node-local
// space and get a mesh matrix (glTF scale x node chain); skinned meshes stay in bind space and get
// a joint palette (glTF scale x joint world x inverse bind matrix) that the engine skins on the
// CPU. The animator recomputes both and pushes each to the engine in one batched call per update,
// and reads back the posed model-space matrix of any rig node (`GltfAnimator.nodeMatrix`).

/** Keyframe interpolation of a glTF animation sampler. */
export type GltfInterpolation = 'LINEAR' | 'STEP' | 'CUBICSPLINE';

/** What happens at the end of a clip. */
export type GltfAnimationLoop = 'repeat' | 'once' | 'pingpong';

/** A clip of a loaded model (`GltfLoadResult.animations`; the array index is the clip index). */
export interface GltfAnimationInfo {
  /** The glTF animation name, else `animation <index>` */
  name: string;
  /** Seconds: the last keyframe time of the clip's channels */
  duration: number;
}

export interface GltfPlayOptions {
  /** Default `'repeat'` */
  loop?: GltfAnimationLoop;
  /** Playback rate (negative plays backwards; default 1) */
  speed?: number;
  /** Blend between the rest pose (0) and the clip (1; default 1) */
  weight?: number;
  /** Start time in seconds (default 0; `speed < 0` with `'once'` starts at the end) */
  time?: number;
}

/** One clip of a weighted pose blend (`GltfAnimator.setBlend`). */
export interface GltfClipWeight {
  /** Clip name or index */
  clip: string | number;
  /** Seconds, wrapped per `loop` with the same `loopTime()` semantics as `play` / `seek` */
  time: number;
  /** >= 0; the entries are normalized by their sum (the sum must be > 0) */
  weight: number;
  /** Default `'repeat'` */
  loop?: GltfAnimationLoop;
}

/** One hand-posed joint rotation (`GltfAnimator.setNodeRotations`). */
export interface GltfNodeRotation {
  /** glTF node name (must be unique among the model's nodes) or glTF node index */
  node: string | number;
  /** Unit quaternion [x, y, z, w] in the node's local frame */
  rotation: readonly [number, number, number, number];
}

/** How `GltfAnimator.setNodeRotations` combines an override with the clip / rest rotation. */
export type GltfNodeRotationMode = 'additive' | 'absolute';

/** Loader option the baked-node error points to (`GltfLoadOptions.posable`). */
const POSABLE_LOAD_HINT = 'loadGltf(..., { posable: [<node names>] })';

/** Quaternions within this distance of unit length are normalized; others are rejected. */
const UNIT_QUAT_TOLERANCE = 1e-3;

/** Most clips `GltfAnimator.setBlend` blends at once. */
const GLTF_MAX_BLEND_CLIPS = 4;

export interface GltfAnimatorOptions {
  /** Advance on every `Charturbo.render()` with the wall clock (default true). False: call `update(dt)` / `seek(t)` yourself */
  autoUpdate?: boolean;
}

/** One sampler: keyframe times and values (`size` floats per value; 3 per key for CUBICSPLINE). */
export interface GltfSampler {
  input: Float32Array;
  output: Float32Array;
  interpolation: GltfInterpolation;
  /** 3 (translation / scale) or 4 (rotation quaternion x, y, z, w) */
  size: 3 | 4;
}

export type GltfAnimationPath = 'translation' | 'rotation' | 'scale';

export interface GltfChannel {
  /** Rig node index */
  node: number;
  path: GltfAnimationPath;
  sampler: GltfSampler;
}

export interface GltfClip {
  name: string;
  duration: number;
  channels: GltfChannel[];
}

/**
 * The animated part of a loaded model. Nodes are depth first (parents before children); only
 * `dynamic` nodes (animated, or below an animated node) are recomputed per update.
 */
export interface GltfRig {
  /** glTF node index per rig node */
  gltfNode: Int32Array;
  /** Rig index of the parent (-1 = scene root) */
  parent: Int32Array;
  dynamic: Uint8Array;
  /** Rest pose: translation (3), rotation quaternion (4), scale (3) per node */
  rest: Float64Array;
  /** Constant local matrices of nodes given by `matrix` (never animated), else null */
  fixed: (Float64Array | null)[];
  /** World matrices of the static nodes (16 per node; dynamic slots are recomputed) */
  world: Float64Array;
  /** Loader scale, applied before the node chain */
  base: Float64Array;
  /** Objects with a mesh matrix and their rig node */
  targets: { ids: Uint32Array; nodes: Int32Array };
  /** Skins the loaded meshes use */
  skins: GltfRigSkin[];
  /** Skinned objects and their skin (index into `skins`) */
  skinTargets: { ids: Uint32Array; skins: Int32Array };
  clips: GltfClip[];
}

/** A glTF skin: its joints (rig nodes) and inverse bind matrices. */
export interface GltfRigSkin {
  /** Rig node per joint */
  joints: Int32Array;
  /** 16 column-major floats per joint (identity when the file has none) */
  inverseBind: Float32Array;
}

/** The engine calls the animator uses (`Charturbo.setObjectMeshMatrices` / `setObjectJointMatrices`). */
export interface GltfAnimationHost {
  setObjectMeshMatrices(ids: Uint32Array, matrices: Float32Array): boolean;
  setObjectJointMatrices?(ids: Uint32Array, jointCounts: Uint32Array, matrices: Float32Array): number;
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

/** Index k with input[k] <= t < input[k + 1] (input sorted, t inside the range). */
function keyIndex(input: Float32Array, t: number): number {
  let lo = 0;
  let hi = input.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (input[mid] <= t) lo = mid;
    else hi = mid;
  }
  return lo;
}

/**
 * Samples `s` at time `t` into `out[o .. o + size]`: clamped to the first / last key outside the
 * keyframes, STEP holds the previous key, LINEAR lerps (rotations: shortest-path slerp),
 * CUBICSPLINE evaluates the glTF Hermite spline (in-tangent, value, out-tangent per key; tangents
 * scaled by the key interval). Rotations come out normalized.
 */
export function sampleGltfSampler(s: GltfSampler, t: number, out: Float64Array | number[], o = 0): void {
  const { input, output, size } = s;
  const n = input.length;
  const cubic = s.interpolation === 'CUBICSPLINE';
  const stride = cubic ? 3 * size : size;
  const valueAt = (k: number) => k * stride + (cubic ? size : 0);
  if (n === 0) return;
  if (n === 1 || !(t > input[0])) {
    copy(output, valueAt(0), out, o, size);
  } else if (t >= input[n - 1]) {
    copy(output, valueAt(n - 1), out, o, size);
  } else {
    const k = keyIndex(input, t);
    const t0 = input[k];
    const dt = input[k + 1] - t0;
    const u = dt > 0 ? (t - t0) / dt : 0;
    if (s.interpolation === 'STEP') {
      copy(output, valueAt(k), out, o, size);
    } else if (cubic) {
      const u2 = u * u;
      const u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      const p0 = valueAt(k);
      const m0 = k * stride + 2 * size; // out-tangent of key k
      const p1 = valueAt(k + 1);
      const m1 = (k + 1) * stride; // in-tangent of key k + 1
      for (let c = 0; c < size; c++) {
        out[o + c] = h00 * output[p0 + c] + h10 * dt * output[m0 + c] + h01 * output[p1 + c] + h11 * dt * output[m1 + c];
      }
    } else if (size === 4) {
      slerpInto(output, valueAt(k), output, valueAt(k + 1), u, out, o);
    } else {
      const a = valueAt(k);
      const b = valueAt(k + 1);
      for (let c = 0; c < size; c++) out[o + c] = output[a + c] + (output[b + c] - output[a + c]) * u;
    }
  }
  if (size === 4) normalizeQuat(out, o);
}

/** Shortest-path spherical interpolation of the quaternions a[ao..] and b[bo..] into out[o..]. */
export function slerpInto(
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  u: number,
  out: Float64Array | number[],
  o = 0
): void {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  let bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  if (cos < 0) {
    // q and -q are the same rotation: take the short way
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let wa: number;
  let wb: number;
  if (cos > 0.9995) {
    wa = 1 - u;
    wb = u;
  } else {
    const theta = Math.acos(Math.min(1, cos));
    const sin = Math.sin(theta);
    wa = Math.sin((1 - u) * theta) / sin;
    wb = Math.sin(u * theta) / sin;
  }
  out[o] = ax * wa + bx * wb;
  out[o + 1] = ay * wa + by * wb;
  out[o + 2] = az * wa + bz * wb;
  out[o + 3] = aw * wa + bw * wb;
  normalizeQuat(out, o);
}

function normalizeQuat(q: Float64Array | number[], o: number): void {
  const len = Math.hypot(q[o], q[o + 1], q[o + 2], q[o + 3]);
  if (len > 0) {
    q[o] /= len;
    q[o + 1] /= len;
    q[o + 2] /= len;
    q[o + 3] /= len;
  } else {
    q[o] = q[o + 1] = q[o + 2] = 0;
    q[o + 3] = 1;
  }
}

function copy(src: ArrayLike<number>, so: number, dst: Float64Array | number[], o: number, n: number): void {
  for (let c = 0; c < n; c++) dst[o + c] = src[so + c];
}

/** Hamilton product out[o..] = a[ao..] x b[bo..] of [x, y, z, w] quaternions (out may alias a or b). */
function quatMultiplyInto(
  a: ArrayLike<number>,
  ao: number,
  b: ArrayLike<number>,
  bo: number,
  out: Float64Array | number[],
  o: number
): void {
  const ax = a[ao], ay = a[ao + 1], az = a[ao + 2], aw = a[ao + 3];
  const bx = b[bo], by = b[bo + 1], bz = b[bo + 2], bw = b[bo + 3];
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}

/** Clip time for the elapsed playback time `elapsed` (seconds) under `loop`. */
export function loopTime(elapsed: number, duration: number, loop: GltfAnimationLoop): number {
  if (!(duration > 0)) return 0;
  if (loop === 'once') return Math.min(duration, Math.max(0, elapsed));
  if (loop === 'pingpong') {
    const period = 2 * duration;
    const p = ((elapsed % period) + period) % period;
    return p <= duration ? p : period - p;
  }
  const t = ((elapsed % duration) + duration) % duration;
  // The end of a repeat cycle shows the last key, not the first
  return t === 0 && elapsed > 0 ? duration : t;
}

// ---------------------------------------------------------------------------
// Pose evaluation
// ---------------------------------------------------------------------------

/** Column-major TRS matrix (quaternion normalized) into out[o .. o + 16]. */
export function composeTrs(trs: ArrayLike<number>, i: number, out: Float64Array, o: number): void {
  const tx = trs[i], ty = trs[i + 1], tz = trs[i + 2];
  let x = trs[i + 3], y = trs[i + 4], z = trs[i + 5], w = trs[i + 6];
  const len = Math.hypot(x, y, z, w) || 1;
  x /= len;
  y /= len;
  z /= len;
  w /= len;
  const sx = trs[i + 7], sy = trs[i + 8], sz = trs[i + 9];
  out[o] = (1 - 2 * (y * y + z * z)) * sx;
  out[o + 1] = 2 * (x * y + w * z) * sx;
  out[o + 2] = 2 * (x * z - w * y) * sx;
  out[o + 3] = 0;
  out[o + 4] = 2 * (x * y - w * z) * sy;
  out[o + 5] = (1 - 2 * (x * x + z * z)) * sy;
  out[o + 6] = 2 * (y * z + w * x) * sy;
  out[o + 7] = 0;
  out[o + 8] = 2 * (x * z + w * y) * sz;
  out[o + 9] = 2 * (y * z - w * x) * sz;
  out[o + 10] = (1 - 2 * (x * x + y * y)) * sz;
  out[o + 11] = 0;
  out[o + 12] = tx;
  out[o + 13] = ty;
  out[o + 14] = tz;
  out[o + 15] = 1;
}

/** Column-major out[oo..] = a[ao..] * b[bo..] (out must not alias a or b). */
function mul4(a: ArrayLike<number>, ao: number, b: ArrayLike<number>, bo: number, out: Float64Array | Float32Array, oo: number): void {
  for (let col = 0; col < 4; col++) {
    const b0 = b[bo + col * 4], b1 = b[bo + col * 4 + 1], b2 = b[bo + col * 4 + 2], b3 = b[bo + col * 4 + 3];
    for (let row = 0; row < 4; row++) {
      out[oo + col * 4 + row] = a[ao + row] * b0 + a[ao + 4 + row] * b1 + a[ao + 8 + row] * b2 + a[ao + 12 + row] * b3;
    }
  }
}

/**
 * Joint matrices of `skin` (object space of its skinned meshes): base x joint world x inverse
 * bind matrix, 16 floats per joint into out[o..]. `world` holds 16 floats per rig node.
 */
export function computeJointMatrices(
  skin: GltfRigSkin,
  base: ArrayLike<number>,
  world: ArrayLike<number>,
  out: Float32Array,
  o: number,
  scratch: Float64Array = new Float64Array(16)
): void {
  const { joints, inverseBind } = skin;
  for (let j = 0; j < joints.length; j++) {
    mul4(base, 0, world, joints[j] * 16, scratch, 0);
    mul4(scratch, 0, inverseBind, j * 16, out, o + j * 16);
  }
}

/** Joint counts per skinned object of `rig` (the `setObjectJointMatrices` layout). */
export function skinTargetJointCounts(rig: GltfRig): Uint32Array {
  return Uint32Array.from(rig.skinTargets.skins, (s) => rig.skins[s].joints.length);
}

/**
 * Linear-blend skinned positions (the engine's CPU skinning, used for bounds): `joints` /
 * `weights` hold 4 per vertex, weights are normalized and all-zero weights keep the bind position.
 */
export function skinPositions(
  positions: ArrayLike<number>,
  joints: ArrayLike<number>,
  weights: ArrayLike<number>,
  palette: ArrayLike<number>
): Float32Array {
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = weights[v * 4 + k];
      if (w > 0 && Number.isFinite(w)) sum += w;
    }
    if (!(sum > 1e-12)) {
      out[v * 3] = x;
      out[v * 3 + 1] = y;
      out[v * 3 + 2] = z;
      continue;
    }
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < 4; k++) {
      const w0 = weights[v * 4 + k];
      if (!(w0 > 0 && Number.isFinite(w0))) continue;
      const w = w0 / sum;
      const m = joints[v * 4 + k] * 16;
      ox += w * (palette[m] * x + palette[m + 4] * y + palette[m + 8] * z + palette[m + 12]);
      oy += w * (palette[m + 1] * x + palette[m + 5] * y + palette[m + 9] * z + palette[m + 13]);
      oz += w * (palette[m + 2] * x + palette[m + 6] * y + palette[m + 10] * z + palette[m + 14]);
    }
    out[v * 3] = ox;
    out[v * 3 + 1] = oy;
    out[v * 3 + 2] = oz;
  }
  return out;
}

/** Reusable buffers for evaluating one rig. */
class RigPose {
  readonly trs: Float64Array;
  readonly world: Float64Array;
  readonly local = new Float64Array(16);
  readonly sample = new Float64Array(4);
  readonly scratch = new Float64Array(16);
  /** Mesh matrices of `rig.targets` (16 floats each) */
  readonly matrices: Float32Array;
  /** Joint matrices of `rig.skinTargets`, back to back */
  readonly jointMatrices: Float32Array;
  readonly jointCounts: Uint32Array;
  /** Palette of each skin (shared by its objects) */
  private readonly palettes: Float32Array[];
  /** Second TRS buffer for blending (allocated on the first multi-clip blend) */
  private other: Float64Array | null = null;
  /** Rotation overrides: rig node per entry and its unit quaternion (4 floats per entry) */
  private overrideNodes: Int32Array = new Int32Array(0);
  private overrideQuats: Float64Array = new Float64Array(0);
  private overrideAbsolute = false;
  /** Nodes `compose` recomputes: `rig.dynamic` plus the subtrees of overridden nodes */
  private active: Uint8Array;

  constructor(readonly rig: GltfRig) {
    const n = rig.parent.length;
    this.trs = new Float64Array(n * 10);
    this.world = Float64Array.from(rig.world);
    this.matrices = new Float32Array(rig.targets.ids.length * 16);
    this.jointCounts = skinTargetJointCounts(rig);
    this.jointMatrices = new Float32Array(this.jointCounts.reduce((a, c) => a + c, 0) * 16);
    this.palettes = rig.skins.map((s) => new Float32Array(s.joints.length * 16));
    this.active = rig.dynamic;
  }

  /**
   * Replaces the rotation overrides (validated: TRS rig nodes, unit quaternions). Static nodes in
   * an overridden subtree become recomputed; static nodes that leave it get their load-time world
   * matrix back, so an empty set restores the exact clip pose.
   */
  setOverrides(nodes: Int32Array, quats: Float64Array, absolute: boolean): void {
    const { rig, world } = this;
    const n = rig.parent.length;
    let active = rig.dynamic;
    if (nodes.length > 0) {
      const sub = new Uint8Array(n);
      for (const r of nodes) sub[r] = 1;
      active = Uint8Array.from(rig.dynamic);
      // Parents come before children (depth first)
      for (let i = 0; i < n; i++) {
        const p = rig.parent[i];
        if (p >= 0 && sub[p]) sub[i] = 1;
        if (sub[i]) active[i] = 1;
      }
    }
    for (let i = 0; i < n; i++) {
      if (this.active[i] && !active[i]) world.set(rig.world.subarray(i * 16, i * 16 + 16), i * 16);
    }
    this.active = active;
    this.overrideNodes = nodes;
    this.overrideQuats = quats;
    this.overrideAbsolute = absolute;
  }

  /** Mesh and joint matrices of the clip at `time` blended with the rest pose by `weight` (null clip = rest pose). */
  evaluate(clip: GltfClip | null, time: number, weight: number): void {
    this.sampleInto(this.trs, clip, time, weight);
    this.applyOverrides();
    this.compose();
  }

  /**
   * Mesh and joint matrices of the weighted blend of `count` clips (`weights` >= 0, summing to 1;
   * `times` already looped). Each clip's local TRS (rest TRS for nodes it does not animate) is
   * folded in by successive interpolation: pose = clip 0, then for k >= 1
   * pose = mix(pose, clip k, w_k / (w_0 + .. + w_k)) with lerp for translation / scale and
   * shortest-arc slerp for rotation. A fraction of 1 replaces the pose with clip k exactly, so a
   * single clip (or weights 0 / 1) matches `evaluate(clip, time, 1)` bit for bit.
   */
  evaluateBlend(clips: ArrayLike<GltfClip>, times: ArrayLike<number>, weights: ArrayLike<number>, count: number): void {
    const { rig, trs } = this;
    this.sampleInto(trs, clips[0], times[0], 1);
    let sum = weights[0];
    for (let k = 1; k < count; k++) {
      const w = weights[k];
      if (!(w > 0)) continue;
      sum += w;
      const u = w / sum;
      if (u >= 1) {
        this.sampleInto(trs, clips[k], times[k], 1);
        continue;
      }
      const other = (this.other ??= new Float64Array(trs.length));
      this.sampleInto(other, clips[k], times[k], 1);
      const n = rig.parent.length;
      for (let i = 0; i < n; i++) {
        // Static and matrix nodes never read their TRS
        if (!rig.dynamic[i] || rig.fixed[i]) continue;
        const o = i * 10;
        for (let c = 0; c < 3; c++) {
          trs[o + c] += (other[o + c] - trs[o + c]) * u;
          trs[o + 7 + c] += (other[o + 7 + c] - trs[o + 7 + c]) * u;
        }
        const r = o + 3;
        // Equal rotations (e.g. both at rest) stay bit-exact instead of going through slerp
        if (trs[r] !== other[r] || trs[r + 1] !== other[r + 1] || trs[r + 2] !== other[r + 2] || trs[r + 3] !== other[r + 3]) {
          slerpInto(trs, r, other, r, u, trs, r);
        }
      }
    }
    this.applyOverrides();
    this.compose();
  }

  /** Local rotation of each overridden node: pose x override (additive) or the override (absolute). */
  private applyOverrides(): void {
    const { trs, overrideNodes: nodes, overrideQuats: q } = this;
    for (let k = 0; k < nodes.length; k++) {
      const o = nodes[k] * 10 + 3;
      const qo = k * 4;
      if (this.overrideAbsolute) {
        copy(q, qo, trs, o, 4);
      } else {
        quatMultiplyInto(trs, o, q, qo, trs, o);
      }
    }
  }

  /** Local TRS of every rig node into `out`: the rest pose, with `clip` at `time` mixed in by `weight`. */
  private sampleInto(out: Float64Array, clip: GltfClip | null, time: number, weight: number): void {
    const { rig, sample } = this;
    out.set(rig.rest);
    if (clip && weight > 0) {
      for (const ch of clip.channels) {
        const o = ch.node * 10 + (ch.path === 'translation' ? 0 : ch.path === 'rotation' ? 3 : 7);
        sampleGltfSampler(ch.sampler, time, sample, 0);
        if (weight >= 1) {
          copy(sample, 0, out, o, ch.sampler.size);
        } else if (ch.path === 'rotation') {
          slerpInto(rig.rest, o, sample, 0, weight, out, o);
        } else {
          for (let c = 0; c < 3; c++) out[o + c] = rig.rest[o + c] + (sample[c] - rig.rest[o + c]) * weight;
        }
      }
    }
  }

  /** World matrices of the dynamic nodes from `trs`, then the mesh matrices and joint palettes. */
  private compose(): void {
    const { rig, trs, world, local, active } = this;
    const n = rig.parent.length;
    for (let i = 0; i < n; i++) {
      if (!active[i]) continue;
      const fixed = rig.fixed[i];
      const p = rig.parent[i];
      if (fixed) local.set(fixed);
      else composeTrs(trs, i * 10, local, 0);
      if (p < 0) world.set(local, i * 16);
      else mul4(world, p * 16, local, 0, world, i * 16);
    }
    const { ids, nodes } = rig.targets;
    for (let k = 0; k < ids.length; k++) mul4(rig.base, 0, world, nodes[k] * 16, this.matrices, k * 16);
    const skins = rig.skinTargets.skins;
    if (skins.length === 0) return;
    rig.skins.forEach((skin, s) => computeJointMatrices(skin, rig.base, world, this.palettes[s], 0, this.scratch));
    let o = 0;
    for (let k = 0; k < skins.length; k++) {
      const palette = this.palettes[skins[k]];
      this.jointMatrices.set(palette, o);
      o += palette.length;
    }
  }
}

// ---------------------------------------------------------------------------
// Animator
// ---------------------------------------------------------------------------

/**
 * Plays the clips of one loaded model (`Charturbo.createGltfAnimator`). One clip at a time;
 * `play` switches clips; `setBlend` poses a weighted mix of up to 4 clips. Every pose change sends all animated objects' mesh matrices in one
 * engine call and all skinned objects' joint matrices in another. With `autoUpdate` (default) a playing animator advances on every `Charturbo.render()`;
 * `update(dt)` and `seek(time)` drive it manually (deterministic).
 */
export class GltfAnimator {
  /** Advance on every `Charturbo.render()` (wall clock deltas, capped at 0.1 s) */
  autoUpdate: boolean;
  private readonly pose: RigPose | null;
  private clipIndex: number | null = null;
  private elapsed = 0;
  private running = false;
  private loopMode: GltfAnimationLoop = 'repeat';
  private rate = 1;
  private blend = 1;
  private lastFrame: number | null = null;
  private disposed = false;
  // setBlend scratch (validated entries; no per-call allocation)
  private readonly blendClips: GltfClip[] = [];
  private readonly blendTimes = new Float64Array(GLTF_MAX_BLEND_CLIPS);
  private readonly blendWeights = new Float64Array(GLTF_MAX_BLEND_CLIPS);
  // The blend the current pose shows (count 0: the single-clip / rest pose of `apply`)
  private poseBlendCount = 0;
  private readonly poseBlendClips: GltfClip[] = [];
  private readonly poseBlendTimes = new Float64Array(GLTF_MAX_BLEND_CLIPS);
  private readonly poseBlendWeights = new Float64Array(GLTF_MAX_BLEND_CLIPS);
  /**
   * glTF node names of the loaded scene, depth first (the order of `GltfLoadResult.nodes` and of
   * the rig); null for unnamed nodes. `GltfLoadResult.nodes[i].index` is the glTF node index.
   */
  readonly nodeNames: readonly (string | null)[];
  private readonly nodes: NodeTable;

  /** @internal Created by `Charturbo.createGltfAnimator` */
  constructor(
    private readonly host: GltfAnimationHost,
    /** The model this animator drives */
    readonly model: object,
    private readonly rig: GltfRig | null,
    options: GltfAnimatorOptions,
    private readonly onDispose: (animator: GltfAnimator) => void
  ) {
    this.autoUpdate = options.autoUpdate ?? true;
    // A rig without mesh matrices or skins (mesh-less `posable` nodes) still poses: it only evaluates, `send` skips empty batches
    this.pose = rig && rig.parent.length > 0 ? new RigPose(rig) : null;
    this.nodes = nodeTable(model, this.pose ? rig : null);
    this.nodeNames = Object.freeze(this.nodes.names.slice());
  }

  /** The model's clips */
  get animations(): GltfAnimationInfo[] {
    return (this.rig?.clips ?? []).map((c) => ({ name: c.name, duration: c.duration }));
  }

  /** Index of the current clip (null = stopped, rest pose) */
  get clip(): number | null {
    return this.clipIndex;
  }

  /** Current clip time in seconds (after looping) */
  get time(): number {
    const clip = this.current();
    return clip ? loopTime(this.elapsed, clip.duration, this.loopMode) : 0;
  }

  /** True while a clip advances (false when paused, stopped or a `'once'` clip finished) */
  get playing(): boolean {
    return this.running;
  }

  get loop(): GltfAnimationLoop {
    return this.loopMode;
  }

  set loop(loop: GltfAnimationLoop) {
    this.checkAlive('loop');
    this.loopMode = checkLoop(loop);
    this.apply();
  }

  get speed(): number {
    return this.rate;
  }

  set speed(speed: number) {
    this.checkAlive('speed');
    this.rate = checkSpeed(speed);
  }

  get weight(): number {
    return this.blend;
  }

  set weight(weight: number) {
    this.checkAlive('weight');
    this.blend = checkWeight(weight);
    this.apply();
  }

  /** Starts `clip` (name or index) from `options.time` (default 0) and applies its first pose. */
  play(clip: string | number, options: GltfPlayOptions = {}): this {
    this.checkAlive('play');
    const index = this.resolveClip(clip);
    const loop = options.loop !== undefined ? checkLoop(options.loop) : 'repeat';
    const speed = options.speed !== undefined ? checkSpeed(options.speed) : 1;
    const weight = options.weight !== undefined ? checkWeight(options.weight) : 1;
    const duration = this.rig!.clips[index].duration;
    let start = 0;
    if (options.time !== undefined) {
      if (!Number.isFinite(options.time)) throw new Error('GltfAnimator.play: time must be a finite number');
      start = options.time;
    } else if (loop === 'once' && speed < 0) {
      start = duration;
    }
    this.clipIndex = index;
    this.loopMode = loop;
    this.rate = speed;
    this.blend = weight;
    this.elapsed = start;
    this.running = true;
    this.lastFrame = null;
    this.apply();
    return this;
  }

  /**
   * Applies the weighted blend of 1 to 4 clips immediately: per rig node the clips' local
   * translation / scale are lerped and rotations slerped (shortest arc) by the normalized weights;
   * nodes a clip does not animate count with their rest TRS for that clip. Deterministic (no wall
   * clock): stops wall-clock playback (`playing` becomes false). Afterwards `clip`, `time` and
   * `loop` report the entry with the largest weight (the first one on ties), which `resume`,
   * `seek`, `update` and the `loop` / `weight` setters continue as a single clip; `speed` and
   * `weight` keep their values and do not affect the blend. One entry with weight > 0 gives
   * exactly the pose of `play(clip, { loop }).seek(time)`.
   */
  setBlend(entries: readonly GltfClipWeight[]): this {
    this.checkAlive('setBlend');
    if (!Array.isArray(entries)) fail('entries must be an array');
    const count = entries.length;
    if (count < 1 || count > GLTF_MAX_BLEND_CLIPS) fail(`expected 1 to ${GLTF_MAX_BLEND_CLIPS} entries (got ${count})`);
    const clips = this.rig?.clips ?? [];
    let sum = 0;
    let top = 0;
    let topIndex = 0;
    for (let k = 0; k < count; k++) {
      const e = entries[k];
      if (e === null || typeof e !== 'object') fail(`entry ${k} must be an object`);
      const index = this.resolveClip(e.clip, 'setBlend');
      const { time, weight } = e;
      if (typeof time !== 'number' || !Number.isFinite(time)) fail(`entry ${k} time must be a finite number (got ${String(time)})`);
      if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) {
        fail(`entry ${k} weight must be a finite number >= 0 (got ${String(weight)})`);
      }
      const loop = e.loop ?? 'repeat';
      if (loop !== 'repeat' && loop !== 'once' && loop !== 'pingpong') {
        fail(`entry ${k} loop must be 'repeat', 'once' or 'pingpong' (got ${String(loop)})`);
      }
      const clip = clips[index];
      this.blendClips[k] = clip;
      this.blendTimes[k] = loopTime(time, clip.duration, loop);
      this.blendWeights[k] = weight;
      sum += weight;
      if (k === 0 || weight > entries[top].weight) {
        top = k;
        topIndex = index;
      }
    }
    if (!(sum > 0) || !Number.isFinite(sum)) fail(`the weights must sum to a finite number > 0 (got ${sum})`);
    for (let k = 0; k < count; k++) this.blendWeights[k] /= sum;
    const main = entries[top];
    this.clipIndex = topIndex;
    this.loopMode = main.loop ?? 'repeat';
    this.elapsed = main.time;
    this.running = false;
    this.lastFrame = null;
    // Kept so setNodeRotations can re-apply this blend (the scratch above is overwritten by a failed call)
    this.poseBlendCount = count;
    for (let k = 0; k < count; k++) {
      this.poseBlendClips[k] = this.blendClips[k];
      this.poseBlendTimes[k] = this.blendTimes[k];
      this.poseBlendWeights[k] = this.blendWeights[k];
    }
    this.applyBlend();
    return this;
  }

  /**
   * Persistent per-node rotation overrides (hand-posed joints: raise an arm, turn the head),
   * applied on every pose update (rest, `play`, `seek`, `update`, render frames, `setBlend`).
   * After the clip / blend / rest local TRS is computed: `'additive'` (default) sets the node's
   * local rotation to clipRotation x override (the override turns the node in its own local
   * frame, on top of the clip); `'absolute'` replaces the local rotation with the override.
   * Children follow. Replaces the previous set (`[]` clears it, restoring the exact clip pose)
   * and re-applies the current pose immediately in one batched call.
   *
   * Every joint of a skinned mesh is posable. Rigid meshes are posable when they sit below an
   * animated node (they keep a mesh matrix); a node whose subtree holds a mesh the loader baked
   * into static vertices throws. Nodes given by a `matrix` cannot be overridden. All entries are
   * validated before anything changes.
   */
  setNodeRotations(rotations: readonly GltfNodeRotation[], mode: GltfNodeRotationMode = 'additive'): this {
    this.checkAlive('setNodeRotations');
    if (mode !== 'additive' && mode !== 'absolute') failNode(`mode must be 'additive' or 'absolute' (got ${String(mode)})`);
    if (!Array.isArray(rotations)) failNode('rotations must be an array');
    const count = rotations.length;
    const rigNodes = new Int32Array(count);
    const quats = new Float64Array(count * 4);
    const seen = new Set<number>();
    for (let k = 0; k < count; k++) {
      const e = rotations[k];
      if (e === null || typeof e !== 'object') failNode(`entry ${k} must be an object`);
      const slot = this.resolveNode(e.node, failNode, k);
      const label = this.nodes.label(slot);
      if (seen.has(slot)) failNode(`${label} is listed twice`);
      seen.add(slot);
      readUnitQuat(e.rotation, label, quats, k * 4);
      rigNodes[k] = this.posableRigNode(slot);
    }
    this.pose?.setOverrides(rigNodes, quats, mode === 'absolute');
    if (this.poseBlendCount > 0) this.applyBlend();
    else this.apply();
    return this;
  }

  /** Holds the current pose. */
  pause(): this {
    this.running = false;
    this.lastFrame = null;
    return this;
  }

  /** Continues a paused clip (restarts a finished `'once'` clip). */
  resume(): this {
    this.checkAlive('resume');
    const clip = this.current();
    if (!clip) return this;
    if (this.loopMode === 'once') {
      if (this.rate >= 0 && this.elapsed >= clip.duration) this.elapsed = 0;
      else if (this.rate < 0 && this.elapsed <= 0) this.elapsed = clip.duration;
    }
    this.running = true;
    this.lastFrame = null;
    return this;
  }

  /** Stops playback and restores the rest pose. */
  stop(): this {
    this.running = false;
    this.clipIndex = null;
    this.elapsed = 0;
    this.lastFrame = null;
    if (!this.disposed) this.apply();
    return this;
  }

  /** Jumps to `time` seconds of playback (looped per `loop`) and applies the pose; keeps playing / paused. */
  seek(time: number): this {
    this.checkAlive('seek');
    if (!Number.isFinite(time)) throw new Error('GltfAnimator.seek: time must be a finite number');
    this.elapsed = time;
    this.apply();
    return this;
  }

  /** Advances a playing clip by `dt` seconds (times `speed`) and applies the pose. */
  update(dt: number): this {
    this.checkAlive('update');
    if (!Number.isFinite(dt) || dt < 0) throw new Error('GltfAnimator.update: dt must be a finite number >= 0');
    const clip = this.current();
    if (!clip || !this.running) return this;
    this.elapsed += dt * this.rate;
    if (this.loopMode === 'once' && ((this.rate > 0 && this.elapsed >= clip.duration) || (this.rate < 0 && this.elapsed <= 0))) {
      this.elapsed = Math.min(clip.duration, Math.max(0, this.elapsed));
      this.running = false;
    }
    this.apply();
    return this;
  }

  /** Stops (rest pose) and detaches from the render loop; `disposeGltf` disposes the model's animators. */
  dispose(): void {
    if (this.disposed) return;
    // The model is left in its plain rest pose (no overrides)
    this.pose?.setOverrides(new Int32Array(0), new Float64Array(0), false);
    this.stop();
    this.disposed = true;
    this.onDispose(this);
  }

  /** @internal Render-loop hook */
  frame(nowMs: number): void {
    if (this.disposed || !this.autoUpdate || !this.running) {
      this.lastFrame = null;
      return;
    }
    const last = this.lastFrame;
    this.lastFrame = nowMs;
    if (last === null) return;
    this.update(Math.min(0.1, Math.max(0, (nowMs - last) / 1000)));
  }

  private current(): GltfClip | null {
    return this.clipIndex !== null ? (this.rig?.clips[this.clipIndex] ?? null) : null;
  }

  private apply(): void {
    this.poseBlendCount = 0;
    if (!this.pose) return;
    const clip = this.current();
    this.pose.evaluate(clip, clip ? loopTime(this.elapsed, clip.duration, this.loopMode) : 0, this.blend);
    this.send();
  }

  /** Re-evaluates and sends the last `setBlend` blend. */
  private applyBlend(): void {
    if (!this.pose) return;
    this.pose.evaluateBlend(this.poseBlendClips, this.poseBlendTimes, this.poseBlendWeights, this.poseBlendCount);
    this.send();
  }

  /**
   * Model-space matrix (column-major 4x4, the loadGltf frame: load `scale` included, load position/rotation NOT included)
   * of a rig node in the CURRENT pose (clip / blend / rotation overrides, rest pose before any). Writes into `out` when given.
   * Mesh-less nodes work (empty attach points such as "hand_socket") when the model was loaded with `posable` naming
   * them or an ancestor: the rig then has no mesh matrices, nothing is sent to the engine and this still returns the
   * rest world (base x world) of any rig node, moved by `setNodeRotations` on it or its ancestors.
   * Throws for unknown / ambiguous names, indices outside the loaded scene, or nodes outside the rig (with the same messages
   * style as setNodeRotations, prefixed `GltfAnimator.nodeMatrix:`).
   *
   * Exactly `base x nodeWorld`: the loader scale matrix times the node's posed glTF world matrix (scene root to node,
   * every node's local TRS / `matrix`), the same product the mesh matrices use (`base x world` of the mesh's node).
   * It maps the node's local origin / axes into the object space of the model's meshes (the space their mesh matrices
   * and skinned palettes map into); the scene places that space with the load `position` / `rotation` (the object
   * transform every model object shares), which gives `GltfLoadResult.bounds`. For a skin joint,
   * `nodeMatrix(joint) x inverseBind` is the joint's palette matrix. A skinned mesh node returns its own glTF frame,
   * which skinning ignores (its vertices follow the joints). Static rig nodes give their load-time world unless an
   * overridden ancestor moves them; matrix nodes follow their parents. The matrix is the pose this animator last
   * computed (what it last sent to the engine); reading it never re-evaluates nor sends a pose, and does not allocate
   * when `out` (a Float32Array of length >= 16; the first 16 floats are written) is given.
   */
  nodeMatrix(node: string | number, out?: Float32Array): Float32Array {
    this.checkAlive('nodeMatrix');
    if (out !== undefined && !(out instanceof Float32Array && out.length >= 16)) {
      failMatrix(`out must be a Float32Array of length >= 16 (got ${describeOut(out)})`);
    }
    const slot = this.resolveNode(node, failMatrix, -1);
    const r = this.nodes.rigNode[slot];
    if (r < 0 || !this.pose) {
      failMatrix(
        `${this.nodes.label(slot)} is not in an animation rig: the model has no animated, skinned or posable meshes (a posable node needs a mesh in its subtree); load the model with ${POSABLE_LOAD_HINT} naming a node above a mesh`
      );
    }
    const target = out ?? new Float32Array(16);
    mul4(this.pose.rig.base, 0, this.pose.world, r * 16, target, 0);
    return target;
  }

  /** Slot (index into `nodeNames`) of a node name or glTF node index (`k` < 0: a single node argument, not entry k). */
  private resolveNode(node: unknown, fail: (message: string) => never, k: number): number {
    const t = this.nodes;
    if (typeof node === 'string') {
      const slots = t.byName.get(node);
      if (!slots) {
        const named = t.names.filter((n): n is string => n !== null);
        const shown = named.slice(0, 8).map((n) => `"${n}"`).join(', ');
        const more = named.length > 8 ? `, ... ${named.length - 8} more` : '';
        fail(`no node named "${node}" (${named.length > 0 ? `nodes: ${shown}${more}` : 'the model has no named nodes'})`);
      }
      if (slots.length > 1) {
        fail(`node name "${node}" is ambiguous (${slots.length} nodes have it: glTF nodes ${slots.map((s) => t.gltf[s]).join(', ')}); use the glTF node index`);
      }
      return slots[0];
    }
    if (typeof node === 'number' && Number.isInteger(node) && node >= 0) {
      const slot = t.byIndex.get(node);
      if (slot === undefined) fail(`glTF node ${node} is not in the loaded scene (it has ${t.names.length} nodes)`);
      return slot;
    }
    return fail(`${k >= 0 ? `entry ${k} node` : 'node'} must be a node name or a glTF node index (got ${String(node)})`);
  }

  /** Rig node of a slot, or throws when the node cannot be posed. */
  private posableRigNode(slot: number): number {
    const t = this.nodes;
    const label = t.label(slot);
    const r = t.rigNode[slot];
    if (r < 0) {
      // Not in the rig: the model has no rig, or the node is outside the posed subtrees
      failNode(`${label} cannot move any mesh: the model has no animated, skinned or posable meshes (a posable node needs a mesh in its subtree); load the model with ${POSABLE_LOAD_HINT} naming a node above a mesh`);
    }
    const rig = this.rig!;
    if (rig.fixed[r]) failNode(`${label} has a matrix transform; rotation overrides need a translation / rotation / scale node`);
    const baked = t.bakedBelow ? t.bakedBelow[r] : -1;
    if (baked >= 0) {
      const where = baked === r ? '' : ` (via the baked mesh of ${t.rigLabel(baked)} in its subtree)`;
      failNode(`${label} is baked into static geometry${where}; load the model with ${POSABLE_LOAD_HINT} to animate it`);
    }
    return r;
  }

  /** Sends the evaluated pose: all mesh matrices in one call, all joint palettes in another. */
  private send(): void {
    const pose = this.pose!;
    const { targets, skinTargets } = pose.rig;
    if (targets.ids.length > 0) this.host.setObjectMeshMatrices(targets.ids, pose.matrices);
    if (skinTargets.ids.length > 0) this.host.setObjectJointMatrices?.(skinTargets.ids, pose.jointCounts, pose.jointMatrices);
  }

  private resolveClip(clip: string | number, method = 'play'): number {
    const clips = this.rig?.clips ?? [];
    if (typeof clip === 'number') {
      if (Number.isInteger(clip) && clip >= 0 && clip < clips.length) return clip;
      throw new Error(`GltfAnimator.${method}: animation ${clip} does not exist (the model has ${clips.length})`);
    }
    for (let i = 0; i < clips.length; i++) if (clips[i].name === clip) return i;
    throw new Error(`GltfAnimator.${method}: no animation named '${String(clip)}'`);
  }

  private checkAlive(method: string): void {
    if (this.disposed) throw new Error(`GltfAnimator.${method}: the animator is disposed`);
  }
}

function fail(message: string): never {
  throw new Error(`GltfAnimator.setBlend: ${message}`);
}

function failNode(message: string): never {
  throw new Error(`GltfAnimator.setNodeRotations: ${message}`);
}

function failMatrix(message: string): never {
  throw new Error(`GltfAnimator.nodeMatrix: ${message}`);
}

function describeOut(out: unknown): string {
  if (out instanceof Float32Array) return `a Float32Array of length ${out.length}`;
  if (out === null) return 'null';
  if (typeof out === 'object') return (out as object).constructor?.name ?? 'an object';
  return typeof out;
}

/** Node lookup of one animator: slots follow `GltfLoadResult.nodes` (depth first, = rig order). */
interface NodeTable {
  /** Name per slot (null = unnamed) */
  names: (string | null)[];
  /** glTF node index per slot */
  gltf: number[];
  byName: Map<string, number[]>;
  byIndex: Map<number, number>;
  /** Rig node per slot (-1: the model has no posable rig) */
  rigNode: Int32Array;
  /** Per rig node: a rig node of its subtree whose meshes were baked into static vertices, else -1 (null: unknown) */
  bakedBelow: Int32Array | null;
  label(slot: number): string;
  /** `label` of a rig node */
  rigLabel(r: number): string;
}

/** `GltfLoadResult.nodes` of a loader result, else null. */
function loadedNodes(model: object): { index: number; name: string | null; objectIds: number[] }[] | null {
  const nodes = (model as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return null;
  for (const n of nodes) {
    if (n === null || typeof n !== 'object' || !Number.isInteger(n.index) || !Array.isArray(n.objectIds)) return null;
    if (n.name !== null && typeof n.name !== 'string') return null;
  }
  return nodes;
}

/** Node names and posability of `model` (`rig` null: nothing is posable). */
function nodeTable(model: object, rig: GltfRig | null): NodeTable {
  const loaded = loadedNodes(model);
  const gltf = loaded ? loaded.map((n) => n.index) : Array.from(rig?.gltfNode ?? []);
  const names = loaded ? loaded.map((n) => n.name) : gltf.map(() => null);
  const byName = new Map<string, number[]>();
  const byIndex = new Map<number, number>();
  names.forEach((name, slot) => {
    if (name !== null) {
      const list = byName.get(name);
      if (list) list.push(slot);
      else byName.set(name, [slot]);
    }
    byIndex.set(gltf[slot], slot);
  });
  const rigOf = new Map<number, number>();
  rig?.gltfNode.forEach((g, r) => rigOf.set(g, r));
  const rigNode = Int32Array.from(gltf, (g) => rigOf.get(g) ?? -1);
  let bakedBelow: Int32Array | null = null;
  if (rig && loaded) {
    const live = new Set<number>([...rig.targets.ids, ...rig.skinTargets.ids]);
    const n = rig.parent.length;
    bakedBelow = new Int32Array(n).fill(-1);
    loaded.forEach((node, slot) => {
      const r = rigNode[slot];
      if (r >= 0 && node.objectIds.some((id) => !live.has(id))) bakedBelow![r] = r;
    });
    // Children come after their parents (depth first): fold each subtree into its parent
    for (let i = n - 1; i >= 0; i--) {
      const p = rig.parent[i];
      if (p >= 0 && bakedBelow[i] >= 0 && bakedBelow[p] < 0) bakedBelow[p] = bakedBelow[i];
    }
  }
  const slotOfRig = new Map<number, number>();
  rigNode.forEach((r, slot) => slotOfRig.set(r, slot));
  const label = (slot: number) => (names[slot] !== null ? `node "${names[slot]}"` : `node ${gltf[slot]}`);
  const rigLabel = (r: number) => {
    const slot = slotOfRig.get(r);
    return slot !== undefined ? label(slot) : `node ${rig?.gltfNode[r] ?? r}`;
  };
  return { names, gltf, byName, byIndex, rigNode, bakedBelow, label, rigLabel };
}

/** Validates `[x, y, z, w]` into out[o..], normalized (within UNIT_QUAT_TOLERANCE of unit length). */
function readUnitQuat(q: unknown, label: string, out: Float64Array, o: number): void {
  if (!isQuatLike(q)) failNode(`rotation of ${label} must be 4 finite numbers [x, y, z, w] (got ${String(q)})`);
  const len = Math.hypot(q[0], q[1], q[2], q[3]);
  if (!(Math.abs(len - 1) <= UNIT_QUAT_TOLERANCE)) failNode(`rotation of ${label} must be a unit quaternion (length ${len})`);
  for (let c = 0; c < 4; c++) out[o + c] = q[c] / len;
}

function isQuatLike(q: unknown): q is ArrayLike<number> {
  if (!Array.isArray(q) && !ArrayBuffer.isView(q)) return false;
  const a = q as ArrayLike<unknown>;
  if (a.length !== 4) return false;
  for (let c = 0; c < 4; c++) if (typeof a[c] !== 'number' || !Number.isFinite(a[c])) return false;
  return true;
}

function checkLoop(loop: GltfAnimationLoop): GltfAnimationLoop {
  if (loop !== 'repeat' && loop !== 'once' && loop !== 'pingpong') {
    throw new Error(`GltfAnimator: loop must be 'repeat', 'once' or 'pingpong' (got ${String(loop)})`);
  }
  return loop;
}

function checkSpeed(speed: number): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) throw new Error(`GltfAnimator: speed must be a finite number (got ${String(speed)})`);
  return speed;
}

function checkWeight(weight: number): number {
  if (typeof weight !== 'number' || !(weight >= 0 && weight <= 1)) throw new Error(`GltfAnimator: weight must be in [0, 1] (got ${String(weight)})`);
  return weight;
}
