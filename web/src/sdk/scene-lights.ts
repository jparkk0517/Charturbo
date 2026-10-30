/**
 * Extra 3D Scene point lights (`addPointLight` / `setPointLight` / `removePointLight` /
 * `getPointLights`): up to `MAX_POINT_LIGHTS` coloured lights with a range, beside the
 * `setLighting` point light (which keeps its attenuation and is the light point shadows follow).
 */

/** Most extra point lights a scene holds (the `setLighting` point light is not counted). */
export const MAX_POINT_LIGHTS = 8;

/** `addPointLight` options (also `SceneDescriptor.pointLights`). */
export interface ScenePointLightDescriptor {
  /** World position */
  position: [number, number, number];
  /** sRGB color, components in [0, 1] (default: [1, 1, 1]) */
  color?: [number, number, number];
  /**
   * Brightness, 0..1e6 (default: 1). Classic shading scales the `setLighting` point falloff
   * (1 ≈ `pointIntensity` 1); PBR treats it as luminous intensity over an inverse-square falloff
   * (`intensity / (d² + 1)`: a light 30 units away needs about 900 to match intensity 1 at 1).
   */
  intensity?: number;
  /** Distance where the light fades out smoothly to zero, 0.01..1e6 (default: 100) */
  range?: number;
}

/** A live extra point light (`getPointLights`). */
export interface ScenePointLight {
  id: number;
  position: [number, number, number];
  color: [number, number, number];
  intensity: number;
  range: number;
}

/** Engine method behind the point lights (absent on older engines: lights are kept but not drawn). */
export interface ScenePointLightsBackend {
  /** 8 floats per light: x, y, z, range, r, g, b, intensity */
  set_scene_point_lights?(data: Float32Array): void;
}

export const DEFAULT_POINT_LIGHT_RANGE = 100;
const MAX_INTENSITY = 1e6;
const MIN_RANGE = 0.01;
const MAX_RANGE = 1e6;

type Vec3 = [number, number, number];

function vec3(fn: string, name: string, v: unknown, min = -Infinity, max = Infinity): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every((c) => typeof c === 'number' && Number.isFinite(c) && c >= min && c <= max)) {
    const bounds = Number.isFinite(min) ? ` with components in [${min}, ${max}]` : ' of finite numbers';
    throw new Error(`${fn}: ${name} must be an array of 3${bounds}`);
  }
  return [v[0], v[1], v[2]];
}

function range(fn: string, name: string, v: unknown, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`${fn}: ${name} must be a number in [${min}, ${max}]`);
  }
  return v;
}

/**
 * Validates `options` merged over `current` (a new light when null: `position` is required).
 * Throws `fn: ...` on invalid fields.
 */
export function resolvePointLight(
  fn: string,
  id: number,
  current: ScenePointLight | null,
  options: Partial<ScenePointLightDescriptor>
): ScenePointLight {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new Error(`${fn}: options must be an object`);
  }
  if (!current && options.position === undefined) throw new Error(`${fn}: position is required`);
  const next: ScenePointLight = current
    ? { ...current, position: [...current.position], color: [...current.color] }
    : { id, position: [0, 0, 0], color: [1, 1, 1], intensity: 1, range: DEFAULT_POINT_LIGHT_RANGE };
  if (options.position !== undefined) next.position = vec3(fn, 'position', options.position);
  if (options.color !== undefined) next.color = vec3(fn, 'color', options.color, 0, 1);
  if (options.intensity !== undefined) next.intensity = range(fn, 'intensity', options.intensity, 0, MAX_INTENSITY);
  if (options.range !== undefined) next.range = range(fn, 'range', options.range, MIN_RANGE, MAX_RANGE);
  return next;
}

export function clonePointLight(l: ScenePointLight): ScenePointLight {
  return { ...l, position: [...l.position], color: [...l.color] };
}

/** The lights in the engine's packed layout (8 floats each). */
export function encodePointLights(lights: Iterable<ScenePointLight>): Float32Array {
  const list = [...lights];
  const out = new Float32Array(list.length * 8);
  list.forEach((l, i) => {
    out.set([...l.position, l.range, ...l.color, l.intensity], i * 8);
  });
  return out;
}
