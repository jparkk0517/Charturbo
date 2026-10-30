//! Opt-in directional-light shadow mapping: settings, the orthographic light-space fit
//! (texel snapped so the map does not shimmer while objects move) and the shadow uniform.

use crate::renderer::{ShadowFrame, ShadowUniformRaw};
use glam::{Mat4, Vec3, Vec4};

pub const SHADOW_MAP_MIN: u32 = 512;
pub const SHADOW_MAP_MAX: u32 = 4096;
pub const DEFAULT_SHADOW_MAP_SIZE: u32 = 2048;
/// Bias / normal bias / softness are in shadow-map texels
pub const MAX_SHADOW_BIAS: f32 = 16.0;
pub const MAX_SHADOW_SOFTNESS: f32 = 8.0;
/// The depth bias grows with the receiver slope `tan(theta)`, up to this factor
pub const SHADOW_MAX_SLOPE: f32 = 4.0;
/// The light-space depth range reaches this many fitted radii past the bounds toward the light,
/// so casters just outside user bounds still shadow what is inside
const NEAR_EXTENSION: f32 = 2.0;

/// The region the light camera covers.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum ShadowBounds {
    /// Bounding sphere of every visible caster and receiver (recomputed when the scene changes)
    #[default]
    Auto,
    Sphere {
        center: Vec3,
        radius: f32,
    },
}

/// Shadow settings of the scene (`SceneWorld::shadows`); off by default.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ShadowConfig {
    pub enabled: bool,
    /// Depth map edge: 512, 1024, 2048 or 4096 (clamped to the device limit by the engine)
    pub map_size: u32,
    /// Constant depth bias (texels of depth; also scaled by the receiver slope)
    pub bias: f32,
    /// Receiver offset along its normal (texels)
    pub normal_bias: f32,
    /// PCF filter radius (texels; 0 = one hardware-filtered tap)
    pub softness: f32,
    /// How much a shadow removes of the directional light (0 = none, 1 = all)
    pub darkness: f32,
    pub bounds: ShadowBounds,
}

impl Default for ShadowConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            map_size: DEFAULT_SHADOW_MAP_SIZE,
            bias: 0.5,
            normal_bias: 1.0,
            softness: 1.5,
            darkness: 1.0,
            bounds: ShadowBounds::Auto,
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

/// Largest power of two in [512, 4096] not above `size` (smaller sizes take 512).
pub fn snap_map_size(size: u32) -> u32 {
    let s = size.clamp(SHADOW_MAP_MIN, SHADOW_MAP_MAX);
    1 << (31 - s.leading_zeros())
}

impl ShadowConfig {
    /// Clamps every field into its valid range (non-finite values take the defaults; invalid
    /// user bounds fall back to `Auto`).
    pub fn sanitized(self) -> Self {
        let d = Self::default();
        let bounds = match self.bounds {
            ShadowBounds::Sphere { center, radius }
                if center.is_finite() && radius.is_finite() && radius > 0.0 =>
            {
                ShadowBounds::Sphere { center, radius }
            }
            _ => ShadowBounds::Auto,
        };
        Self {
            enabled: self.enabled,
            map_size: snap_map_size(self.map_size),
            bias: finite_or(self.bias, d.bias).clamp(0.0, MAX_SHADOW_BIAS),
            normal_bias: finite_or(self.normal_bias, d.normal_bias).clamp(0.0, MAX_SHADOW_BIAS),
            softness: finite_or(self.softness, d.softness).clamp(0.0, MAX_SHADOW_SOFTNESS),
            darkness: finite_or(self.darkness, d.darkness).clamp(0.0, 1.0),
            bounds,
        }
    }

    /// `sanitized()` with the map edge also limited to `max_edge` (the device texture limit;
    /// 0 = unknown, no limit).
    pub fn clamped_to_device(self, max_edge: u32) -> Self {
        let mut c = self.sanitized();
        if max_edge >= SHADOW_MAP_MIN {
            c.map_size = c.map_size.min(snap_map_size(max_edge));
        }
        c
    }

    /// The frame's shadow uniform, or `None` when shadows are off. `auto_bounds` is the scene's
    /// caster / receiver sphere (`None` = nothing to shadow).
    pub fn frame(&self, light_dir: Vec3, auto_bounds: Option<(Vec3, f32)>) -> Option<ShadowFrame> {
        if !self.enabled {
            return None;
        }
        let (center, radius) = match self.bounds {
            ShadowBounds::Sphere { center, radius } => (center, radius),
            ShadowBounds::Auto => auto_bounds.unwrap_or((Vec3::ZERO, 1.0)),
        };
        let fit = fit_light(light_dir, center, radius, self.map_size);
        Some(ShadowFrame {
            map_size: self.map_size,
            uniform: ShadowUniformRaw {
                light_view_proj: fit.view_proj.to_cols_array_2d(),
                params: [
                    self.bias * fit.texel_world / fit.depth_range,
                    // The kernel reaches `softness` texels: offset far enough to clear it
                    self.normal_bias * fit.texel_world * self.softness.max(1.0),
                    self.softness,
                    self.darkness,
                ],
                map: [
                    1.0 / self.map_size as f32,
                    self.map_size as f32,
                    SHADOW_MAX_SLOPE,
                    0.0,
                ],
            },
        })
    }
}

/// Orthographic light camera.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LightFit {
    /// World -> clip (x, y in [-1, 1]; depth 1 nearest the light, 0 at the far bound)
    pub view_proj: Mat4,
    /// World size of one shadow-map texel
    pub texel_world: f32,
    /// World length of the [0, 1] depth range
    pub depth_range: f32,
}

/// Rounds `r` up to a coarse step (1/8 of its power of two) so small bound changes keep the
/// same texel size.
fn quantize_radius(r: f32) -> f32 {
    let step = (r.log2().floor() - 3.0).exp2();
    (r / step).ceil() * step
}

/// Fits an orthographic light camera looking along `-light_dir` (`light_dir` points toward the
/// light) around the sphere `(center, radius)`. The radius is quantized and the light-space
/// center snapped to whole texels, so the map's texel grid stays fixed in world space.
pub fn fit_light(light_dir: Vec3, center: Vec3, radius: f32, map_size: u32) -> LightFit {
    let l = light_dir.try_normalize().unwrap_or(Vec3::Y);
    let forward = -l;
    let up = if forward.y.abs() > 0.99 {
        Vec3::Z
    } else {
        Vec3::Y
    };
    // Rotation only: the snap grid must not move with the scene center
    let view = Mat4::look_to_rh(Vec3::ZERO, forward, up);
    let size = map_size.max(4) as f32;
    let r = quantize_radius(finite_or(radius, 1.0).max(1e-3)) * size / (size - 2.0);
    let texel = 2.0 * r / size;
    let c = view.transform_point3(center);
    let (cx, cy) = ((c.x / texel).round() * texel, (c.y / texel).round() * texel);
    // View space looks down -z: the light side has the larger z
    let z_far = c.z - r;
    let z_near = c.z + r * (1.0 + NEAR_EXTENSION);
    let depth_range = z_near - z_far;
    let proj = Mat4::from_cols(
        Vec4::new(1.0 / r, 0.0, 0.0, 0.0),
        Vec4::new(0.0, 1.0 / r, 0.0, 0.0),
        Vec4::new(0.0, 0.0, 1.0 / depth_range, 0.0),
        Vec4::new(-cx / r, -cy / r, -z_far / depth_range, 1.0),
    );
    LightFit {
        view_proj: proj * view,
        texel_world: texel,
        depth_range,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ndc(fit: &LightFit, p: Vec3) -> Vec3 {
        let c = fit.view_proj * p.extend(1.0);
        c.truncate() / c.w
    }

    #[test]
    fn defaults_are_off_and_sanitized_clamps() {
        let d = ShadowConfig::default();
        assert!(!d.enabled);
        assert_eq!(d.map_size, 2048);
        assert_eq!(d.frame(Vec3::Y, None), None);
        let c = ShadowConfig {
            enabled: true,
            map_size: 3000,
            bias: f32::NAN,
            normal_bias: -1.0,
            softness: 99.0,
            darkness: 2.0,
            bounds: ShadowBounds::Sphere {
                center: Vec3::ZERO,
                radius: -1.0,
            },
        }
        .sanitized();
        assert_eq!(c.map_size, 2048);
        assert_eq!(c.bias, d.bias);
        assert_eq!(c.normal_bias, 0.0);
        assert_eq!(c.softness, MAX_SHADOW_SOFTNESS);
        assert_eq!(c.darkness, 1.0);
        assert_eq!(c.bounds, ShadowBounds::Auto);
        assert_eq!(snap_map_size(100), 512);
        assert_eq!(snap_map_size(9000), 4096);
        assert_eq!(snap_map_size(1024), 1024);
    }

    #[test]
    fn map_size_is_clamped_to_the_device_limit() {
        let c = ShadowConfig {
            map_size: 4096,
            ..ShadowConfig::default()
        };
        assert_eq!(c.clamped_to_device(2048).map_size, 2048);
        assert_eq!(c.clamped_to_device(3000).map_size, 2048);
        assert_eq!(c.clamped_to_device(8192).map_size, 4096);
        assert_eq!(c.clamped_to_device(0).map_size, 4096, "unknown limit");
    }

    #[test]
    fn fit_contains_the_bounds_in_front_of_the_light() {
        for dir in [
            Vec3::new(0.4, 1.0, 0.3),
            Vec3::Y,
            Vec3::new(-1.0, 0.2, 0.0),
            Vec3::new(0.0, -1.0, 0.001),
        ] {
            let center = Vec3::new(3.0, 1.0, -2.0);
            let radius = 5.0;
            let fit = fit_light(dir, center, radius, 2048);
            for corner in 0..8 {
                let s = Vec3::new(
                    if corner & 1 == 0 { -1.0 } else { 1.0 },
                    if corner & 2 == 0 { -1.0 } else { 1.0 },
                    if corner & 4 == 0 { -1.0 } else { 1.0 },
                );
                // Sphere-inscribed box corners and the sphere's extreme points
                for p in [
                    center + s * radius / 3f32.sqrt(),
                    center + dir.normalize() * radius * s.x,
                ] {
                    let q = ndc(&fit, p);
                    assert!(q.x.abs() <= 1.0 && q.y.abs() <= 1.0, "{dir} {p} -> {q}");
                    assert!((0.0..=1.0).contains(&q.z), "{dir} {p} -> {q}");
                }
            }
            // Nearer to the light = larger depth (reversed-Z, like the main pass)
            let toward = ndc(&fit, center + dir.normalize()).z;
            assert!(toward > ndc(&fit, center).z);
        }
    }

    #[test]
    fn fit_snaps_to_whole_texels() {
        let dir = Vec3::new(0.3, 1.0, 0.5);
        let size = 1024;
        let a = fit_light(dir, Vec3::new(0.1, 0.2, 0.3), 4.1, size);
        let b = fit_light(dir, Vec3::new(0.137, 0.21, 0.29), 4.3, size);
        assert_eq!(
            a.texel_world, b.texel_world,
            "quantized radius keeps the texel size"
        );
        for fit in [a, b] {
            let o = ndc(&fit, Vec3::ZERO) * (size as f32 / 2.0);
            assert!(
                (o.x - o.x.round()).abs() < 1e-3 && (o.y - o.y.round()).abs() < 1e-3,
                "{o}"
            );
        }
        // The grid offset between two fits is a whole number of texels
        let d = (ndc(&a, Vec3::ZERO) - ndc(&b, Vec3::ZERO)) * (size as f32 / 2.0);
        assert!((d.x - d.x.round()).abs() < 1e-3 && (d.y - d.y.round()).abs() < 1e-3);
    }

    #[test]
    fn frame_packs_biases_in_map_units() {
        let cfg = ShadowConfig {
            enabled: true,
            map_size: 1024,
            ..ShadowConfig::default()
        };
        let f = cfg.frame(Vec3::Y, Some((Vec3::ZERO, 8.0))).unwrap();
        let fit = fit_light(Vec3::Y, Vec3::ZERO, 8.0, 1024);
        assert_eq!(f.map_size, 1024);
        assert_eq!(f.uniform.light_view_proj, fit.view_proj.to_cols_array_2d());
        assert!((f.uniform.params[0] - 0.5 * fit.texel_world / fit.depth_range).abs() < 1e-9);
        assert!((f.uniform.params[1] - 1.5 * fit.texel_world).abs() < 1e-6);
        assert_eq!(f.uniform.params[2..], [1.5, 1.0]);
        assert_eq!(f.uniform.map, [1.0 / 1024.0, 1024.0, SHADOW_MAX_SLOPE, 0.0]);
        // User bounds override the scene bounds
        let user = ShadowConfig {
            bounds: ShadowBounds::Sphere {
                center: Vec3::X,
                radius: 2.0,
            },
            ..cfg
        };
        let g = user.frame(Vec3::Y, Some((Vec3::ZERO, 8.0))).unwrap();
        assert_eq!(
            g.uniform.light_view_proj,
            fit_light(Vec3::Y, Vec3::X, 2.0, 1024)
                .view_proj
                .to_cols_array_2d()
        );
    }

    #[test]
    fn casters_lead_each_draw_and_flags_reach_the_instances() {
        use crate::scene::{BodyType, PrimitiveKind, SceneWorld};
        let mut w = SceneWorld::new();
        let ids: Vec<u32> = (0..4)
            .map(|i| {
                w.add_primitive(PrimitiveKind::Box, Vec3::new(i as f32 * 2.0, 0.0, 0.0), Vec3::ONE, [1.0; 4], BodyType::Static)
            })
            .collect();
        let glass = w.add_primitive(PrimitiveKind::Sphere, Vec3::Y * 3.0, Vec3::ONE, [1.0, 1.0, 1.0, 0.5], BodyType::Static);
        let before: Vec<_> = w.pack_render_data(Vec3::Z * 10.0).instances.to_vec();
        let draws = w.pack_render_data(Vec3::Z * 10.0).draws.to_vec();
        assert_eq!(draws.len(), 2);
        assert_eq!((draws[0].instance_count, draws[0].shadow_instances), (4, 4));
        assert_eq!((draws[1].translucent, draws[1].shadow_instances), (true, 0), "translucent never casts");
        assert!(before.iter().all(|i| i.normal[0][3] == 0.0), "default bytes unchanged");

        // A non-caster moves behind the casters of its draw; batching is kept
        assert!(w.set_object_shadow_flags(ids[1], false, false));
        let packed = w.pack_render_data(Vec3::Z * 10.0);
        let d = packed.draws[0];
        assert_eq!((d.instance_count, d.shadow_instances), (4, 3));
        let last = packed.instances[d.first_instance as usize + 3];
        assert_eq!(last.model[3][0], 2.0, "the non-caster is last");
        assert_eq!(last.normal[0][3], 1.0, "receive opt-out flag");
        assert!(packed.instances[..3].iter().all(|i| i.normal[0][3] == 0.0));

        // Auto bounds cover casters and receivers; an object that does neither is ignored
        let (c, r) = w.shadow_bounds().unwrap();
        assert!((c - Vec3::new(3.0, 1.5, 0.0)).length() < 1e-4, "translucent receivers count: {c}");
        assert!(r > 3.5);
        let far = w.add_primitive(PrimitiveKind::Box, Vec3::X * 100.0, Vec3::ONE, [1.0; 4], BodyType::Static);
        w.set_object_shadow_flags(far, false, false);
        w.pack_render_data(Vec3::Z * 10.0);
        assert_eq!(w.shadow_bounds().unwrap(), (c, r));
        let _ = glass;
    }
}
