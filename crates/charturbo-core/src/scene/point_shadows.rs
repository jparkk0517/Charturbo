//! Opt-in omnidirectional point-light shadows: settings, the six 90° cube-face cameras and the
//! receiver uniform. Each face of a `Depth32Float` cube map stores reversed-Z perspective depth
//! of the major-axis distance `z` from the light: `depth = a / z + b` (1 at `near`, 0 at `far`),
//! which the receivers recompute for their own position and compare in hardware.

use super::shadows::SHADOW_MAX_SLOPE;
use crate::renderer::{PointShadowFrame, PointShadowUniformRaw, ShadowUniformRaw};
use glam::{Mat4, Vec2, Vec3};

pub const POINT_SHADOW_MAP_MIN: u32 = 256;
pub const POINT_SHADOW_MAP_MAX: u32 = 1024;
pub const DEFAULT_POINT_SHADOW_MAP_SIZE: u32 = 512;
/// Smallest near plane (world units)
pub const MIN_POINT_SHADOW_NEAR: f32 = 0.01;
/// Largest near plane / far plane (world units)
pub const MAX_POINT_SHADOW_RANGE: f32 = 1.0e6;
/// The far plane is at least this many near planes away
const MIN_FAR_OVER_NEAR: f32 = 2.0;
/// Far plane without user value or scene bounds (world units)
const FALLBACK_FAR: f32 = 100.0;

/// Point-light shadow settings of the scene (`SceneWorld::point_shadows`); off by default and
/// independent of the directional `ShadowConfig`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PointShadowConfig {
    pub enabled: bool,
    /// Cube face edge: 256, 512 or 1024 texels
    pub map_size: u32,
    /// Constant depth bias (texels at the receiver's distance; also scaled by the slope)
    pub bias: f32,
    /// Receiver offset along its normal (texels)
    pub normal_bias: f32,
    /// PCF filter radius (texels; 0 = one hardware-filtered tap)
    pub softness: f32,
    /// How much a shadow removes of the point light (0 = none, 1 = all)
    pub darkness: f32,
    /// Near plane of the face cameras (world units): casters closer to the light are ignored
    pub near: f32,
    /// Far plane (world units); `None` reaches the far side of the shadow bounds
    pub far: Option<f32>,
}

impl Default for PointShadowConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            map_size: DEFAULT_POINT_SHADOW_MAP_SIZE,
            bias: 1.0,
            normal_bias: 1.0,
            softness: 1.0,
            darkness: 1.0,
            near: 0.5,
            far: None,
        }
    }
}

fn finite_or(v: f32, fallback: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        fallback
    }
}

/// Largest power of two in [256, 1024] not above `size` (smaller sizes take 256).
pub fn snap_point_map_size(size: u32) -> u32 {
    let s = size.clamp(POINT_SHADOW_MAP_MIN, POINT_SHADOW_MAP_MAX);
    1 << (31 - s.leading_zeros())
}

impl PointShadowConfig {
    /// Clamps every field into its valid range (non-finite values take the defaults; a far
    /// plane that is not positive and finite becomes automatic, one too close to `near` moves
    /// out to `2 * near`).
    pub fn sanitized(self) -> Self {
        use super::shadows::{MAX_SHADOW_BIAS, MAX_SHADOW_SOFTNESS};
        let d = Self::default();
        let near =
            finite_or(self.near, d.near).clamp(MIN_POINT_SHADOW_NEAR, MAX_POINT_SHADOW_RANGE);
        let far = self.far.filter(|f| f.is_finite() && *f > 0.0).map(|f| {
            f.clamp(
                near * MIN_FAR_OVER_NEAR,
                MAX_POINT_SHADOW_RANGE * MIN_FAR_OVER_NEAR,
            )
        });
        Self {
            enabled: self.enabled,
            map_size: snap_point_map_size(self.map_size),
            bias: finite_or(self.bias, d.bias).clamp(0.0, MAX_SHADOW_BIAS),
            normal_bias: finite_or(self.normal_bias, d.normal_bias).clamp(0.0, MAX_SHADOW_BIAS),
            softness: finite_or(self.softness, d.softness).clamp(0.0, MAX_SHADOW_SOFTNESS),
            darkness: finite_or(self.darkness, d.darkness).clamp(0.0, 1.0),
            near,
            far,
        }
    }

    /// `sanitized()` with the face edge also limited to `max_edge` (the device texture limit;
    /// 0 = unknown, no limit).
    pub fn clamped_to_device(self, max_edge: u32) -> Self {
        let mut c = self.sanitized();
        if max_edge >= POINT_SHADOW_MAP_MIN {
            c.map_size = c.map_size.min(snap_point_map_size(max_edge));
        }
        c
    }

    /// Far plane for a light at `light_pos`: the user value, or the far side of the caster /
    /// receiver sphere `auto_bounds` (at least `2 * near`).
    pub fn resolved_far(&self, light_pos: Vec3, auto_bounds: Option<(Vec3, f32)>) -> f32 {
        let auto = || {
            auto_bounds.map_or(FALLBACK_FAR, |(c, r)| {
                // 1% slack so the farthest receiver stays inside the frustum
                ((light_pos - c).length() + r) * 1.01
            })
        };
        let far = self.far.unwrap_or_else(auto);
        finite_or(far, FALLBACK_FAR).clamp(
            self.near * MIN_FAR_OVER_NEAR,
            MAX_POINT_SHADOW_RANGE * MIN_FAR_OVER_NEAR,
        )
    }

    /// The frame's cube-face cameras + receiver uniform, or `None` when point shadows are off.
    pub fn frame(
        &self,
        light_pos: Vec3,
        auto_bounds: Option<(Vec3, f32)>,
    ) -> Option<PointShadowFrame> {
        if !self.enabled {
            return None;
        }
        let near = self.near;
        let far = self.resolved_far(light_pos, auto_bounds);
        let (a, b) = depth_coefficients(near, far);
        let faces = std::array::from_fn(|face| ShadowUniformRaw {
            light_view_proj: face_view_proj(face, light_pos, near, far).to_cols_array_2d(),
            params: [0.0; 4],
            map: [0.0; 4],
        });
        Some(PointShadowFrame {
            map_size: self.map_size,
            faces,
            uniform: PointShadowUniformRaw {
                light_near: [light_pos.x, light_pos.y, light_pos.z, near],
                params: [self.bias, self.normal_bias, self.softness, self.darkness],
                map: [1.0 / self.map_size as f32, self.map_size as f32, a, b],
                range: [far, SHADOW_MAX_SLOPE, 0.0, 0.0],
            },
        })
    }
}

/// `(a, b)` of the reversed-Z depth `a / z + b` of a major-axis distance `z`: 1 at `near`,
/// 0 at `far`.
pub fn depth_coefficients(near: f32, far: f32) -> (f32, f32) {
    let span = far - near;
    (near * far / span, -near / span)
}

/// `(sc, tc, ma)` axes of cube face `face` (+x, -x, +y, -y, +z, -z: the WebGPU / Vulkan layer
/// order): for a direction `d` on that face, `s = (sc . d / ma . d + 1) / 2` grows to the right
/// of the face image and `t = (tc . d / ma . d + 1) / 2` downwards (row 0 = `t` 0).
pub fn cube_face_axes(face: usize) -> (Vec3, Vec3, Vec3) {
    match face {
        0 => (Vec3::NEG_Z, Vec3::NEG_Y, Vec3::X),
        1 => (Vec3::Z, Vec3::NEG_Y, Vec3::NEG_X),
        2 => (Vec3::X, Vec3::Z, Vec3::Y),
        3 => (Vec3::X, Vec3::NEG_Z, Vec3::NEG_Y),
        4 => (Vec3::X, Vec3::NEG_Y, Vec3::Z),
        _ => (Vec3::NEG_X, Vec3::NEG_Y, Vec3::NEG_Z),
    }
}

/// World -> clip of the 90° camera rendering cube face `face` of a light at `light_pos`: clip
/// x / y follow the face image (y up = row 0, like any render target), w is the major-axis
/// distance and depth the reversed-Z `a / w + b`.
pub fn face_view_proj(face: usize, light_pos: Vec3, near: f32, far: f32) -> Mat4 {
    let (sc, tc, ma) = cube_face_axes(face);
    let (a, b) = depth_coefficients(near, far);
    // Rows of the projection (applied to the light-relative position)
    let rows = Mat4::from_cols(
        sc.extend(0.0),
        (-tc).extend(0.0),
        (ma * b).extend(a),
        ma.extend(0.0),
    )
    .transpose();
    rows * Mat4::from_translation(-light_pos)
}

/// Face (same order as `cube_face_axes`) and `(s, t)` the GPU samples for direction `d`: the
/// largest component wins (ties: x before y before z), as in the WebGPU / Vulkan cube rules.
pub fn cube_face_lookup(d: Vec3) -> (usize, Vec2) {
    let a = d.abs();
    let face = if a.x >= a.y && a.x >= a.z {
        if d.x >= 0.0 {
            0
        } else {
            1
        }
    } else if a.y >= a.z {
        if d.y >= 0.0 {
            2
        } else {
            3
        }
    } else if d.z >= 0.0 {
        4
    } else {
        5
    };
    let (sc, tc, ma) = cube_face_axes(face);
    let m = ma.dot(d);
    (
        face,
        Vec2::new(sc.dot(d) / m, tc.dot(d) / m) * 0.5 + Vec2::splat(0.5),
    )
}

/// Light-space clip coordinates `face_view_proj(...) * p` after the perspective divide.
#[cfg(test)]
fn face_ndc(view_proj: Mat4, p: Vec3) -> Vec3 {
    let c = view_proj * glam::Vec4::from((p, 1.0));
    c.truncate() / c.w
}

#[cfg(test)]
mod tests {
    use super::*;

    fn directions() -> Vec<Vec3> {
        let mut v = Vec::new();
        for i in 0..7 {
            for j in 0..13 {
                let theta = 0.2 + i as f32 * 0.43;
                let phi = j as f32 * 0.48 + 0.05;
                v.push(Vec3::new(
                    theta.sin() * phi.cos(),
                    theta.cos(),
                    theta.sin() * phi.sin(),
                ));
            }
        }
        v.extend([Vec3::X, -Vec3::X, Vec3::Y, -Vec3::Y, Vec3::Z, -Vec3::Z]);
        v
    }

    #[test]
    fn defaults_are_off_and_sanitized_clamps() {
        let d = PointShadowConfig::default();
        assert!(!d.enabled);
        assert_eq!(d.map_size, 512);
        assert_eq!(d.frame(Vec3::Y, None), None);
        let c = PointShadowConfig {
            enabled: true,
            map_size: 700,
            bias: f32::NAN,
            normal_bias: -1.0,
            softness: 99.0,
            darkness: 2.0,
            near: f32::INFINITY,
            far: Some(f32::NAN),
        }
        .sanitized();
        assert_eq!(c.map_size, 512);
        assert_eq!(c.bias, d.bias);
        assert_eq!(c.normal_bias, 0.0);
        assert_eq!(c.softness, crate::scene::MAX_SHADOW_SOFTNESS);
        assert_eq!(c.darkness, 1.0);
        assert_eq!(c.near, d.near);
        assert_eq!(c.far, None, "non-finite far = auto");
        assert_eq!(snap_point_map_size(10), 256);
        assert_eq!(snap_point_map_size(4096), 1024);
        assert_eq!(snap_point_map_size(1024), 1024);
        let tiny = PointShadowConfig {
            near: 0.0,
            far: Some(0.001),
            ..d
        }
        .sanitized();
        assert_eq!(tiny.near, MIN_POINT_SHADOW_NEAR);
        assert_eq!(
            tiny.far,
            Some(MIN_POINT_SHADOW_NEAR * 2.0),
            "far moves past near"
        );
        assert_eq!(
            PointShadowConfig {
                far: Some(-3.0),
                ..d
            }
            .sanitized()
            .far,
            None
        );
        let c = PointShadowConfig {
            map_size: 1024,
            ..d
        };
        assert_eq!(c.clamped_to_device(512).map_size, 512);
        assert_eq!(c.clamped_to_device(0).map_size, 1024, "unknown limit");
    }

    #[test]
    fn far_plane_reaches_the_bounds_unless_given() {
        let d = PointShadowConfig::default();
        let light = Vec3::new(0.0, 40.0, 0.0);
        let far = d.resolved_far(light, Some((Vec3::ZERO, 10.0)));
        assert!((far - 50.0 * 1.01).abs() < 1e-3, "{far}");
        assert_eq!(d.resolved_far(light, None), FALLBACK_FAR);
        let user = PointShadowConfig {
            far: Some(30.0),
            ..d
        };
        assert_eq!(user.resolved_far(light, Some((Vec3::ZERO, 10.0))), 30.0);
        // A light inside a tiny scene still gets 2 * near
        let close = d.resolved_far(Vec3::ZERO, Some((Vec3::ZERO, 0.1)));
        assert_eq!(close, d.near * 2.0);
    }

    #[test]
    fn face_cameras_cover_their_face_and_match_the_cube_lookup() {
        let light = Vec3::new(3.0, 20.0, -4.0);
        let (near, far) = (0.5, 80.0);
        let (a, b) = depth_coefficients(near, far);
        for d in directions() {
            for dist in [1.0, 7.5, 60.0] {
                let q = d.normalize() * dist;
                let (face, st) = cube_face_lookup(q);
                let vp = face_view_proj(face, light, near, far);
                let ndc = face_ndc(vp, light + q);
                assert!(
                    ndc.x.abs() <= 1.0 + 1e-5 && ndc.y.abs() <= 1.0 + 1e-5,
                    "{q} face {face}: {ndc}"
                );
                // Render target row 0 is clip y = +1, i.e. t = 0
                let rendered = Vec2::new(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
                assert!(
                    (rendered - st).length() < 1e-5,
                    "{q} face {face}: {rendered} vs {st}"
                );
                // Depth: reversed-Z of the major-axis distance, as the receivers recompute it
                let major = q.abs().max_element();
                assert!((ndc.z - (a / major + b)).abs() < 1e-5, "{q}: {}", ndc.z);
                assert!((0.0..=1.0).contains(&ndc.z));
            }
        }
    }

    #[test]
    fn other_faces_clip_the_point() {
        let light = Vec3::ZERO;
        for d in directions() {
            let (face, _) = cube_face_lookup(d);
            for other in (0..6).filter(|&f| f != face) {
                let c = face_view_proj(other, light, 0.5, 80.0) * glam::Vec4::from((d * 10.0, 1.0));
                let inside = c.w > 0.0 && c.x.abs() < c.w * 0.999 && c.y.abs() < c.w * 0.999;
                assert!(!inside, "{d} is drawn into face {other} as well as {face}");
            }
        }
    }

    #[test]
    fn depth_is_one_at_near_and_zero_at_far() {
        let (near, far) = (0.25, 40.0);
        for face in 0..6 {
            let (_, _, ma) = cube_face_axes(face);
            let vp = face_view_proj(face, Vec3::ONE, near, far);
            assert!((face_ndc(vp, Vec3::ONE + ma * near).z - 1.0).abs() < 1e-5);
            assert!(face_ndc(vp, Vec3::ONE + ma * far).z.abs() < 1e-5);
            assert!(
                face_ndc(vp, Vec3::ONE + ma * 2.0).z > face_ndc(vp, Vec3::ONE + ma * 3.0).z,
                "nearer = larger"
            );
        }
    }

    #[test]
    fn frame_packs_the_faces_and_the_receiver_uniform() {
        let cfg = PointShadowConfig {
            enabled: true,
            map_size: 1024,
            far: Some(60.0),
            ..PointShadowConfig::default()
        };
        let light = Vec3::new(1.0, 30.0, 2.0);
        let f = cfg.frame(light, Some((Vec3::ZERO, 500.0))).unwrap();
        assert_eq!(f.map_size, 1024);
        for (i, face) in f.faces.iter().enumerate() {
            assert_eq!(
                face.light_view_proj,
                face_view_proj(i, light, 0.5, 60.0).to_cols_array_2d()
            );
        }
        let (a, b) = depth_coefficients(0.5, 60.0);
        assert_eq!(f.uniform.light_near, [1.0, 30.0, 2.0, 0.5]);
        assert_eq!(f.uniform.params, [1.0, 1.0, 1.0, 1.0]);
        assert_eq!(f.uniform.map, [1.0 / 1024.0, 1024.0, a, b]);
        assert_eq!(f.uniform.range, [60.0, SHADOW_MAX_SLOPE, 0.0, 0.0]);
    }
}
