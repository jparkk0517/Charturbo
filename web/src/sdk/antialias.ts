/**
 * Opt-in multisample anti-aliasing (MSAA) of the main render pass (`create({ antialias })`,
 * `setAntialias` / `getAntialias`). Off by default.
 */

/** Main-pass sample count: 1 = off, 4 = MSAA x4. */
export type CharturboAntialiasSamples = 1 | 4;

/** `create` option: `true` = 4, `false` = 1, or the sample count. */
export type CharturboAntialias = boolean | CharturboAntialiasSamples;

export interface AntialiasBackend {
  /** Requests a sample count; returns the applied one (1 without device support for x4) */
  set_antialias?(samples: number): number;
  get_antialias?(): number;
}

/** Sample count of a `create` option / `setAntialias` argument; throws on anything else. */
export function resolveAntialias(fn: string, value: unknown): CharturboAntialiasSamples {
  if (value === true || value === 4) return 4;
  if (value === false || value === 1) return 1;
  throw new Error(`${fn}: antialias must be true, false, 1 or 4 (got ${String(value)})`);
}

/**
 * Applies `samples` and returns the applied count. Warns when the device cannot render x4; a
 * backend without the method stays at 1.
 */
export function sendAntialias(backend: AntialiasBackend, samples: CharturboAntialiasSamples): CharturboAntialiasSamples {
  if (!backend.set_antialias) return 1;
  const applied: CharturboAntialiasSamples = backend.set_antialias(samples) === 4 ? 4 : 1;
  if (applied < samples) {
    console.warn(`Charturbo: MSAA x${samples} is not supported by this device; anti-aliasing stays off`);
  }
  return applied;
}
