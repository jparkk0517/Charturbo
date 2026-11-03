/**
 * Depth output pass for AI video conditioning (`setRenderPass('depth', options)` /
 * `getRenderPass` / `readDepthRange`). While on, every frame is replaced by the encoded planar
 * view depth `D` (distance along the view axis, engine units) of the frame's depth buffer
 * (crates/charturbo-core/src/renderer/depth_out.rs):
 *
 * - `inverse` (default): `v = (1/D - 1/far) / (1/near - 1/far)`, clamped to 0..1, near = white
 *   (inverse depth / disparity, as MiDaS / Depth Anything output);
 * - `linear`: `v = (far - D) / (far - near)`, clamped, near = white;
 * - both: gray `round(255 v)` in R = G = B, background (nothing drawn) = 0;
 * - `packed` (measurement): `q = round(D / F * (2^24 - 1))` in R (high byte), G, B with `F` the
 *   camera's far clip plane; background = `2^24 - 1` (white). `readDepthRange` decodes it.
 *
 * `near` / `far` are the normalization range in engine units, supplied by the caller (e.g. the
 * foreground min / max of a shot measured with `packed`). The pass reads the single-sample depth
 * buffer: it needs anti-aliasing off (WebGL2 cannot sample a multisampled depth buffer), so
 * `setRenderPass('depth')` throws while `getAntialias()` is 4 and `setAntialias(4)` throws while
 * the depth pass is on. Only draws that write depth appear: opaque meshes, opaque graph nodes,
 * bars and 3D markers / fills. Translucent meshes, 2D lines and overlays write no depth.
 */

export type RenderPassKind = 'beauty' | 'depth';
export type DepthEncoding = 'inverse' | 'linear' | 'packed';

export interface DepthPassOptions {
  /** Default `'inverse'` */
  encoding?: DepthEncoding;
  /** Planar depth (engine units) encoded as white; required for `inverse` / `linear` */
  near?: number;
  /** Planar depth (engine units) encoded as black; required for `inverse` / `linear` */
  far?: number;
}

/** `getRenderPass()`: the pass and its depth options (`near` / `far` 0 when unused). */
export type RenderPassState = { pass: RenderPassKind } & Required<DepthPassOptions>;

export interface DepthOutputBackend {
  /** `encoding` 0 inverse, 1 linear, 2 packed; throws on an invalid setting or with MSAA on */
  set_depth_output?(encoding: number, near: number, far: number): void;
  clear_depth_output?(): void;
  /** `[near, far, orthographic 1/0]` clip planes of the current projection (engine units) */
  get_depth_clip_planes?(): ArrayLike<number>;
}

/** Largest packed code (24 bits): the background. */
export const PACKED_DEPTH_MAX = 0xffffff;

const ENCODING_CODES: Record<DepthEncoding, number> = { inverse: 0, linear: 1, packed: 2 };

export function defaultRenderPass(): RenderPassState {
  return { pass: 'beauty', encoding: 'inverse', near: 0, far: 0 };
}

const validRange = (near: unknown, far: unknown): boolean =>
  typeof near === 'number' && typeof far === 'number' && Number.isFinite(near) && Number.isFinite(far) && near > 0 && near < far;

/**
 * Validated state of a `setRenderPass(pass, options)` call; throws a descriptive Error on bad
 * input or when `antialias` (the applied sample count) is above 1 for the depth pass.
 */
export function resolveRenderPass(fn: string, pass: unknown, options: unknown, antialias: number): RenderPassState {
  if (pass === 'beauty') {
    if (options !== undefined) throw new Error(`${fn}: options only apply to the 'depth' pass`);
    return defaultRenderPass();
  }
  if (pass !== 'depth') throw new Error(`${fn}: pass must be 'beauty' or 'depth' (got ${String(pass)})`);
  if (options !== undefined && (options === null || typeof options !== 'object')) {
    throw new Error(`${fn}: options must be an object`);
  }
  const o = (options ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(o)) {
    if (key !== 'encoding' && key !== 'near' && key !== 'far') throw new Error(`${fn}: unknown option '${key}'`);
  }
  const encoding = o.encoding ?? 'inverse';
  if (encoding !== 'inverse' && encoding !== 'linear' && encoding !== 'packed') {
    throw new Error(`${fn}: encoding must be 'inverse', 'linear' or 'packed' (got ${String(encoding)})`);
  }
  let near = 0;
  let far = 0;
  const given = o.near !== undefined || o.far !== undefined;
  if (encoding !== 'packed' || given) {
    if (!validRange(o.near, o.far)) {
      throw new Error(
        `${fn}: near and far must be finite numbers with 0 < near < far, in engine units (got near ${String(o.near)}, far ${String(o.far)})`,
      );
    }
    near = o.near as number;
    far = o.far as number;
  }
  if (antialias > 1) {
    throw new Error(
      `${fn}: the depth pass needs anti-aliasing off (getAntialias() is ${antialias}): WebGL2 cannot sample a multisampled depth buffer; call setAntialias(1) first`,
    );
  }
  return { pass: 'depth', encoding, near, far };
}

/** Applies `state` to the engine; throws when the engine has no depth output. */
export function sendRenderPass(fn: string, backend: DepthOutputBackend, state: RenderPassState): void {
  if (state.pass === 'beauty') {
    backend.clear_depth_output?.();
    return;
  }
  if (!backend.set_depth_output) throw new Error(`${fn}: this engine has no depth output`);
  backend.set_depth_output(ENCODING_CODES[state.encoding], state.near, state.far);
}

/**
 * Foreground min / max planar depth (engine units) of a `packed` frame's RGBA pixels (`far` =
 * the camera's far clip plane of that frame); `null` when every pixel is background.
 */
export function decodeDepthRange(rgba: ArrayLike<number>, far: number): { near: number; far: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i + 2 < rgba.length; i += 4) {
    // The packed pass writes alpha 255 everywhere; anything else is not a packed frame
    if (rgba[i + 3] !== 255) {
      throw new Error('readDepthRange: the canvas does not hold a packed depth frame (alpha != 255); the frame was probably not presented');
    }
    const q = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2];
    if (q === PACKED_DEPTH_MAX) continue;
    if (q < lo) lo = q;
    if (q > hi) hi = q;
  }
  if (hi < 0) return null;
  return { near: (lo / PACKED_DEPTH_MAX) * far, far: (hi / PACKED_DEPTH_MAX) * far };
}
