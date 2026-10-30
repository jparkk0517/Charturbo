/**
 * Opt-in HDR post-processing of the 3D Scene meshes (`setPostProcessing` /
 * `getPostProcessing`): bloom and auto exposure (eye adaptation). Off by default; applies with
 * the PBR shading model only, on devices that render `Rgba16Float` targets.
 */

/** Bloom settings; omitted fields keep their current value. */
export interface SceneBloomDescriptor {
  /** Turns bloom on (default: false) */
  enabled?: boolean;
  /** Glow added to the image, 0..8 (default: 0.6) */
  intensity?: number;
  /** Exposed linear brightness where the glow starts, 0..64 (default: 1; 1 = display white) */
  threshold?: number;
  /** Soft knee as a fraction of the threshold, 0..1 (default: 0.5; 0 = hard cut) */
  knee?: number;
  /** Glow spread, 0..1 (default: 0.7; 0 = tight halo, 1 = widest) */
  radius?: number;
}

export interface SceneBloomState {
  enabled: boolean;
  intensity: number;
  threshold: number;
  knee: number;
  radius: number;
}

/** `'smooth'`: adapts over time at `speedUp` / `speedDown`; `'instant'`: meters every frame. */
export type SceneExposureAdaptation = 'smooth' | 'instant';

/** Auto exposure settings; omitted fields keep their current value. */
export interface SceneAutoExposureDescriptor {
  /** Turns auto exposure on (default: false) */
  enabled?: boolean;
  /** Darkest metered exposure in EV, -16..16 (default: -4; EV 0 = average luminance 0.18) */
  minEv?: number;
  /** Brightest metered exposure in EV, -16..16, at least `minEv` (default: 4) */
  maxEv?: number;
  /** Adaptation speed toward a brighter scene, 0..100 per second (default: 3) */
  speedUp?: number;
  /** Adaptation speed toward a darker scene, 0..100 per second (default: 1) */
  speedDown?: number;
  /** EV offset on the metered exposure, -8..8 (default: 0; +1 = twice as bright) */
  compensation?: number;
  /** `'smooth'` (default) or `'instant'`; the first frame always snaps */
  adaptation?: SceneExposureAdaptation;
}

export interface SceneAutoExposureState {
  enabled: boolean;
  minEv: number;
  maxEv: number;
  speedUp: number;
  speedDown: number;
  compensation: number;
  adaptation: SceneExposureAdaptation;
}

/** `setPostProcessing` options (also `SceneDescriptor.postProcessing`). */
export interface ScenePostProcessingDescriptor {
  bloom?: SceneBloomDescriptor;
  autoExposure?: SceneAutoExposureDescriptor;
}

/** `getPostProcessing()`: the requested settings plus what the engine applies. */
export interface ScenePostProcessingState {
  bloom: SceneBloomState;
  autoExposure: SceneAutoExposureState;
  /** The device renders the HDR targets at the current anti-aliasing setting (false: post-processing is skipped) */
  supported: boolean;
  /** Post-processing renders: an effect is on, the shading model is PBR and `supported` */
  active: boolean;
}

/** Engine methods behind `setPostProcessing` (absent on older engines: no-ops, `supported: false`). */
export interface ScenePostBackend {
  set_post_processing?(
    bloom: boolean,
    intensity: number,
    threshold: number,
    knee: number,
    radius: number,
    autoExposure: boolean,
    minEv: number,
    maxEv: number,
    speedUp: number,
    speedDown: number,
    compensation: number,
    instant: boolean
  ): void;
  /** `[bloom, intensity, threshold, knee, radius, ae, minEv, maxEv, speedUp, speedDown, compensation, instant, supported, active]` */
  get_post_processing?(): Float32Array | number[];
}

/** Requested settings (what `exportScene` saves). */
export interface ScenePostSettings {
  bloom: SceneBloomState;
  autoExposure: SceneAutoExposureState;
}

const MAX_INTENSITY = 8;
const MAX_THRESHOLD = 64;
const MAX_EV = 16;
const MAX_COMPENSATION = 8;
const MAX_SPEED = 100;

export function defaultPostSettings(): ScenePostSettings {
  return {
    bloom: { enabled: false, intensity: 0.6, threshold: 1, knee: 0.5, radius: 0.7 },
    autoExposure: { enabled: false, minEv: -4, maxEv: 4, speedUp: 3, speedDown: 1, compensation: 0, adaptation: 'smooth' },
  };
}

export function clonePostSettings(s: ScenePostSettings): ScenePostSettings {
  return { bloom: { ...s.bloom }, autoExposure: { ...s.autoExposure } };
}

function range(fn: string, name: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${fn}: ${name} must be a number in [${min}, ${max}]`);
  }
  return v;
}

function flag(fn: string, name: string, v: unknown): boolean {
  if (typeof v !== 'boolean') throw new Error(`${fn}: ${name} must be a boolean`);
  return v;
}

function object(fn: string, name: string, v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`${fn}: ${name} must be an object`);
  return v as Record<string, unknown>;
}

/** Merges `options` over `current`, validating every given field (throws `fn: ...`). */
export function resolvePostProcessing(
  fn: string,
  current: ScenePostSettings,
  options: ScenePostProcessingDescriptor
): ScenePostSettings {
  const o = object(fn, 'options', options);
  const next = clonePostSettings(current);
  if (o.bloom !== undefined) {
    const b = object(fn, 'bloom', o.bloom);
    const n = next.bloom;
    if (b.enabled !== undefined) n.enabled = flag(fn, 'bloom.enabled', b.enabled);
    if (b.intensity !== undefined) n.intensity = range(fn, 'bloom.intensity', b.intensity, 0, MAX_INTENSITY);
    if (b.threshold !== undefined) n.threshold = range(fn, 'bloom.threshold', b.threshold, 0, MAX_THRESHOLD);
    if (b.knee !== undefined) n.knee = range(fn, 'bloom.knee', b.knee, 0, 1);
    if (b.radius !== undefined) n.radius = range(fn, 'bloom.radius', b.radius, 0, 1);
  }
  if (o.autoExposure !== undefined) {
    const a = object(fn, 'autoExposure', o.autoExposure);
    const n = next.autoExposure;
    if (a.enabled !== undefined) n.enabled = flag(fn, 'autoExposure.enabled', a.enabled);
    if (a.minEv !== undefined) n.minEv = range(fn, 'autoExposure.minEv', a.minEv, -MAX_EV, MAX_EV);
    if (a.maxEv !== undefined) n.maxEv = range(fn, 'autoExposure.maxEv', a.maxEv, -MAX_EV, MAX_EV);
    if (a.speedUp !== undefined) n.speedUp = range(fn, 'autoExposure.speedUp', a.speedUp, 0, MAX_SPEED);
    if (a.speedDown !== undefined) n.speedDown = range(fn, 'autoExposure.speedDown', a.speedDown, 0, MAX_SPEED);
    if (a.compensation !== undefined) {
      n.compensation = range(fn, 'autoExposure.compensation', a.compensation, -MAX_COMPENSATION, MAX_COMPENSATION);
    }
    if (a.adaptation !== undefined) {
      if (a.adaptation !== 'smooth' && a.adaptation !== 'instant') {
        throw new Error(`${fn}: autoExposure.adaptation must be 'smooth' or 'instant'`);
      }
      n.adaptation = a.adaptation;
    }
    if (n.maxEv < n.minEv) throw new Error(`${fn}: autoExposure.maxEv must be at least minEv`);
  }
  return next;
}

/** Sends `s` to the engine. */
export function sendPostProcessing(backend: ScenePostBackend, s: ScenePostSettings): void {
  const { bloom: b, autoExposure: a } = s;
  backend.set_post_processing?.(
    b.enabled,
    b.intensity,
    b.threshold,
    b.knee,
    b.radius,
    a.enabled,
    a.minEv,
    a.maxEv,
    a.speedUp,
    a.speedDown,
    a.compensation,
    a.adaptation === 'instant'
  );
}

/** `s` plus the engine's `supported` / `active` flags. */
export function postProcessingState(backend: ScenePostBackend, s: ScenePostSettings): ScenePostProcessingState {
  const got = backend.get_post_processing?.();
  const at = (i: number) => (got && got.length > i ? got[i] === 1 : false);
  return { ...clonePostSettings(s), supported: at(12), active: at(13) };
}
