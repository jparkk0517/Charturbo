/**
 * Camera matrices of a previs frame, computed exactly like the engine's exact-view camera
 * (crates/charturbo-core/src/camera/mod.rs: `set_view`, `view_matrix`, `projection_matrix`), because the SDK exposes no
 * view / projection getter (`getCameraState` is orbit yaw / pitch only, no roll / up):
 *   - view  = glam `Mat4::look_at_rh(eye, target, up')`, with `up'` built as `set_view` does (up made orthogonal to the
 *             view direction, then rotated by `roll` about it; fallback axis when up is parallel to the view direction).
 *   - proj  = glam `Mat4::perspective_rh(fovY, aspect, far, near)` (reverse-Z: near -> 1, far -> 0).
 *   - near  = 0.01 engine units (EXACT_NEAR), far = 2000 (default `z_far`; the previs player never refits the orbit).
 * eye / target are scaled by `worldScale` (previs meters -> engine units) like the player does. Matrices are
 * column-major (glam / WebGPU layout), `clip = projection * view * [p, 1]`.
 * An eye == target frame keeps the previous camera (the engine's `set_view` returns false), also done here.
 */
type V3 = [number, number, number];

export const EXACT_NEAR = 0.01;
export const Z_FAR = 2000;
export const DEFAULT_WORLD_SCALE = 10;

export interface EngineCamera {
  view: number[];
  projection: number[];
  near: number;
  far: number;
  worldScale: number;
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: V3): V3 => {
  const l = len(a);
  return [a[0] / l, a[1] / l, a[2] / l];
};

export function engineCameraMatrices(
  cam: { eye: V3; target: V3; up: V3; roll: number; fovDeg: number },
  worldScale: number | undefined,
  aspect: number,
  previous: EngineCamera | null,
): EngineCamera {
  const ws = worldScale ?? DEFAULT_WORLD_SCALE;
  const eye = cam.eye.map((v) => v * ws) as V3;
  const target = cam.target.map((v) => v * ws) as V3;
  const offset = sub(target, eye);
  const l = len(offset);
  const finite = [...eye, ...target, cam.roll].every(Number.isFinite);

  const proj = (() => {
    const f = 1 / Math.tan((cam.fovDeg * Math.PI) / 180 / 2);
    // glam perspective_rh(fov, aspect, z_near = Z_FAR, z_far = EXACT_NEAR): reverse-Z
    const zn = Z_FAR;
    const zf = EXACT_NEAR;
    const r = zf / (zn - zf);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, r, -1, 0, 0, r * zn, 0];
  })();

  if (!finite || l <= 1e-6) {
    if (previous) return { ...previous, projection: proj };
    // No earlier camera: engine default (never reached by a valid doc; keep it finite)
    return { view: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], projection: proj, near: EXACT_NEAR, far: Z_FAR, worldScale: ws };
  }

  const forward = norm(offset);
  const upIn: V3 = cam.up.every(Number.isFinite) && len(cam.up) > 0 ? norm(cam.up) : [0, 1, 0];
  let up: V3;
  if (len(cross(forward, upIn)) > 1e-6) up = upIn;
  else if (Math.abs(forward[1]) >= 0.5) up = [0, 0, Math.sign(forward[1])];
  else up = [0, 1, 0];
  const right = norm(cross(forward, up));
  up = norm(cross(right, forward));
  // rotate up about forward by roll (Rodrigues; forward . up == 0)
  const c = Math.cos(cam.roll);
  const s = Math.sin(cam.roll);
  const fu = cross(forward, up);
  up = norm([up[0] * c + fu[0] * s, up[1] * c + fu[1] * s, up[2] * c + fu[2] * s]);

  // look_at_rh: f = normalize(center - eye), s = normalize(f x up), u = s x f
  const sx = norm(cross(forward, up));
  const u = cross(sx, forward);
  const view = [
    sx[0], u[0], -forward[0], 0,
    sx[1], u[1], -forward[1], 0,
    sx[2], u[2], -forward[2], 0,
    -dot(sx, eye), -dot(u, eye), dot(forward, eye), 1,
  ];
  return { view, projection: proj, near: EXACT_NEAR, far: Z_FAR, worldScale: ws };
}
