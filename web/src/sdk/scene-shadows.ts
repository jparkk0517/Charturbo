/**
 * Directional-light shadow settings of the 3D Scene (`setShadows` / `getShadows`) and the
 * per-object cast / receive flags. Shadows are off by default.
 */
import type { Vec3Tuple } from './charturbo';

/** Shadow map edge in texels (clamped to the device's texture limit). */
export type SceneShadowMapSize = 512 | 1024 | 2048 | 4096;

/** Region the light's shadow camera covers. */
export type SceneShadowBounds = { center: Vec3Tuple; radius: number } | 'auto';

/** Shadow settings (`setShadows`); omitted fields keep their current value. */
export interface SceneShadowsDescriptor {
  /** Turns shadows on (default: false) */
  enabled?: boolean;
  /** Shadow map edge (default: 2048) */
  mapSize?: SceneShadowMapSize;
  /** Constant depth bias in shadow-map texels, 0..16 (default: 0.5); also scaled by the surface slope */
  bias?: number;
  /** Receiver offset along its normal in texels, 0..16 (default: 1) */
  normalBias?: number;
  /** PCF filter radius in texels, 0..8 (default: 1.5; 0 = hard edges) */
  softness?: number;
  /** Fraction of the directional light a shadow removes, 0..1 (default: 1) */
  darkness?: number;
  /** `'auto'` (default) fits every caster and receiver; or a fixed world-space sphere */
  bounds?: SceneShadowBounds;
}

/** Resolved shadow settings (`getShadows`). */
export interface SceneShadowsState {
  enabled: boolean;
  mapSize: SceneShadowMapSize;
  bias: number;
  normalBias: number;
  softness: number;
  darkness: number;
  bounds: SceneShadowBounds;
}

/** Per-object shadow flags (primitives, custom meshes, `setObjectMaterial`). */
export interface ObjectShadowDescriptor {
  /** Drawn into the shadow map (default: true; translucent objects never cast) */
  castShadow?: boolean;
  /** Darkened by other objects' shadows (default: true) */
  receiveShadow?: boolean;
}

/** Engine methods behind `setShadows` and the object flags (absent on older engines: no-ops). */
export interface SceneShadowsBackend {
  set_scene_shadows?(
    enabled: boolean,
    mapSize: number,
    bias: number,
    normalBias: number,
    softness: number,
    darkness: number,
    autoBounds: boolean,
    cx: number,
    cy: number,
    cz: number,
    radius: number
  ): void;
  /** `[enabled, mapSize, bias, normalBias, softness, darkness, auto, cx, cy, cz, radius]` */
  get_scene_shadows?(): Float32Array | number[];
  set_object_shadow_flags?(objectId: number, cast: boolean, receive: boolean): boolean;
}

export const SHADOW_MAP_SIZES: readonly SceneShadowMapSize[] = [512, 1024, 2048, 4096];
const MAX_BIAS = 16;
const MAX_SOFTNESS = 8;

export function defaultShadowsState(): SceneShadowsState {
  return { enabled: false, mapSize: 2048, bias: 0.5, normalBias: 1, softness: 1.5, darkness: 1, bounds: 'auto' };
}

export function cloneShadows(s: SceneShadowsState): SceneShadowsState {
  return {
    ...s,
    bounds: s.bounds === 'auto' ? 'auto' : { center: [...s.bounds.center], radius: s.bounds.radius },
  };
}

/** Merges `options` over `current`, validating every given field (throws `fn: ...`). */
export function resolveShadows(fn: string, current: SceneShadowsState, options: SceneShadowsDescriptor): SceneShadowsState {
  if (typeof options !== 'object' || options === null) throw new Error(`${fn}: options must be an object`);
  const next = cloneShadows(current);
  const { enabled, mapSize, bias, normalBias, softness, darkness, bounds } = options;
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') throw new Error(`${fn}: enabled must be a boolean`);
    next.enabled = enabled;
  }
  if (mapSize !== undefined) {
    if (!SHADOW_MAP_SIZES.includes(mapSize)) throw new Error(`${fn}: mapSize must be 512, 1024, 2048 or 4096`);
    next.mapSize = mapSize;
  }
  const range = (name: string, v: number, max: number) => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > max) {
      throw new Error(`${fn}: ${name} must be a number in [0, ${max}]`);
    }
    return v;
  };
  if (bias !== undefined) next.bias = range('bias', bias, MAX_BIAS);
  if (normalBias !== undefined) next.normalBias = range('normalBias', normalBias, MAX_BIAS);
  if (softness !== undefined) next.softness = range('softness', softness, MAX_SOFTNESS);
  if (darkness !== undefined) next.darkness = range('darkness', darkness, 1);
  if (bounds !== undefined) {
    if (bounds === 'auto') {
      next.bounds = 'auto';
    } else {
      const c = typeof bounds === 'object' && bounds !== null ? bounds.center : undefined;
      const r = typeof bounds === 'object' && bounds !== null ? bounds.radius : undefined;
      if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => typeof x === 'number' && Number.isFinite(x))) {
        throw new Error(`${fn}: bounds must be 'auto' or { center: [x, y, z], radius }`);
      }
      if (typeof r !== 'number' || !Number.isFinite(r) || r <= 0) throw new Error(`${fn}: bounds.radius must be a positive number`);
      next.bounds = { center: [c[0], c[1], c[2]], radius: r };
    }
  }
  return next;
}

/** Sends `s` to the engine and returns it with the engine's map size (device clamp). */
export function sendShadows(backend: SceneShadowsBackend, s: SceneShadowsState): SceneShadowsState {
  const b = s.bounds;
  const auto = b === 'auto';
  backend.set_scene_shadows?.(
    s.enabled,
    s.mapSize,
    s.bias,
    s.normalBias,
    s.softness,
    s.darkness,
    auto,
    auto ? 0 : b.center[0],
    auto ? 0 : b.center[1],
    auto ? 0 : b.center[2],
    auto ? 0 : b.radius
  );
  const got = backend.get_scene_shadows?.();
  const size = got && got.length >= 2 ? (got[1] as SceneShadowMapSize) : s.mapSize;
  return SHADOW_MAP_SIZES.includes(size) && size !== s.mapSize ? { ...cloneShadows(s), mapSize: size } : s;
}

/** Validated `castShadow` / `receiveShadow` (throws `fn: ...` on non-booleans). */
export function resolveShadowFlags(
  fn: string,
  current: { castShadow: boolean; receiveShadow: boolean },
  desc: ObjectShadowDescriptor
): { castShadow: boolean; receiveShadow: boolean } {
  const flag = (name: string, v: unknown, d: boolean) => {
    if (v === undefined) return d;
    if (typeof v !== 'boolean') throw new Error(`${fn}: ${name} must be a boolean`);
    return v;
  };
  return {
    castShadow: flag('castShadow', desc.castShadow, current.castShadow),
    receiveShadow: flag('receiveShadow', desc.receiveShadow, current.receiveShadow),
  };
}
