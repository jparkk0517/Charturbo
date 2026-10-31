// glTF keyframe animation (node translation / rotation / scale; phase 1: no skinning, no morph
// targets). The loader keeps animated subtrees as a rig: meshes under animated nodes stay in
// node-local space and get a mesh matrix (glTF scale x node chain) that the animator recomputes
// and pushes to the engine in one batched call per update.

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
  clips: GltfClip[];
}

/** The engine call the animator uses (`Charturbo.setObjectMeshMatrices`). */
export interface GltfAnimationHost {
  setObjectMeshMatrices(ids: Uint32Array, matrices: Float32Array): boolean;
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

/** Reusable buffers for evaluating one rig. */
class RigPose {
  readonly trs: Float64Array;
  readonly world: Float64Array;
  readonly local = new Float64Array(16);
  readonly sample = new Float64Array(4);
  readonly matrices: Float32Array;

  constructor(readonly rig: GltfRig) {
    const n = rig.parent.length;
    this.trs = new Float64Array(n * 10);
    this.world = Float64Array.from(rig.world);
    this.matrices = new Float32Array(rig.targets.ids.length * 16);
  }

  /** World matrices of the clip at `time` blended with the rest pose by `weight`; null = rest pose. */
  evaluate(clip: GltfClip | null, time: number, weight: number): Float32Array {
    const { rig, trs, world, local, sample } = this;
    trs.set(rig.rest);
    if (clip && weight > 0) {
      for (const ch of clip.channels) {
        const o = ch.node * 10 + (ch.path === 'translation' ? 0 : ch.path === 'rotation' ? 3 : 7);
        sampleGltfSampler(ch.sampler, time, sample, 0);
        if (weight >= 1) {
          copy(sample, 0, trs, o, ch.sampler.size);
        } else if (ch.path === 'rotation') {
          slerpInto(rig.rest, o, sample, 0, weight, trs, o);
        } else {
          for (let c = 0; c < 3; c++) trs[o + c] = rig.rest[o + c] + (sample[c] - rig.rest[o + c]) * weight;
        }
      }
    }
    const n = rig.parent.length;
    for (let i = 0; i < n; i++) {
      if (!rig.dynamic[i]) continue;
      const fixed = rig.fixed[i];
      const p = rig.parent[i];
      if (fixed) local.set(fixed);
      else composeTrs(trs, i * 10, local, 0);
      if (p < 0) world.set(local, i * 16);
      else mul4(world, p * 16, local, 0, world, i * 16);
    }
    const { ids, nodes } = rig.targets;
    for (let k = 0; k < ids.length; k++) mul4(rig.base, 0, world, nodes[k] * 16, this.matrices, k * 16);
    return this.matrices;
  }
}

// ---------------------------------------------------------------------------
// Animator
// ---------------------------------------------------------------------------

/**
 * Plays the clips of one loaded model (`Charturbo.createGltfAnimator`). One clip at a time;
 * `play` switches clips. Every pose change sends all animated objects' matrices in one engine
 * call. With `autoUpdate` (default) a playing animator advances on every `Charturbo.render()`;
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
    this.pose = rig && rig.targets.ids.length > 0 ? new RigPose(rig) : null;
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
    if (!this.pose) return;
    const clip = this.current();
    const matrices = this.pose.evaluate(clip, clip ? loopTime(this.elapsed, clip.duration, this.loopMode) : 0, this.blend);
    this.host.setObjectMeshMatrices(this.rig!.targets.ids, matrices);
  }

  private resolveClip(clip: string | number): number {
    const clips = this.rig?.clips ?? [];
    if (typeof clip === 'number') {
      if (Number.isInteger(clip) && clip >= 0 && clip < clips.length) return clip;
      throw new Error(`GltfAnimator.play: animation ${clip} does not exist (the model has ${clips.length})`);
    }
    const index = clips.findIndex((c) => c.name === clip);
    if (index < 0) throw new Error(`GltfAnimator.play: no animation named '${clip}'`);
    return index;
  }

  private checkAlive(method: string): void {
    if (this.disposed) throw new Error(`GltfAnimator.${method}: the animator is disposed`);
  }
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
