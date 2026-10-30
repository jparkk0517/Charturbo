//! WASM binding of the directional- and point-light shadow settings and the per-object cast /
//! receive flags, kept apart from `lib.rs`.

use crate::scene::{PointShadowConfig, ShadowBounds, ShadowConfig};
use crate::WasmCharturboEngine;
use glam::Vec3;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Bias / normal bias / softness are in shadow-map texels, darkness in [0, 1]. `auto_bounds`
    /// fits the light to the scene's casters and receivers; otherwise to the sphere
    /// `(cx, cy, cz, radius)`. The map edge is snapped to 512 / 1024 / 2048 / 4096 and clamped
    /// to the device limit.
    #[allow(clippy::too_many_arguments)]
    pub fn set_scene_shadows(
        &mut self,
        enabled: bool,
        map_size: u32,
        bias: f32,
        normal_bias: f32,
        softness: f32,
        darkness: f32,
        auto_bounds: bool,
        cx: f32,
        cy: f32,
        cz: f32,
        radius: f32,
    ) {
        self.inner.set_shadows(ShadowConfig {
            enabled,
            map_size,
            bias,
            normal_bias,
            softness,
            darkness,
            bounds: if auto_bounds {
                ShadowBounds::Auto
            } else {
                ShadowBounds::Sphere {
                    center: Vec3::new(cx, cy, cz),
                    radius,
                }
            },
        });
    }

    /// `[enabled, map_size, bias, normal_bias, softness, darkness, auto_bounds, cx, cy, cz,
    /// radius]` (booleans as 0 / 1; the sphere is zeros with auto bounds).
    pub fn get_scene_shadows(&self) -> Vec<f32> {
        let s = self.inner.shadows();
        let (auto, c, r) = match s.bounds {
            ShadowBounds::Auto => (1.0, Vec3::ZERO, 0.0),
            ShadowBounds::Sphere { center, radius } => (0.0, center, radius),
        };
        vec![
            if s.enabled { 1.0 } else { 0.0 },
            s.map_size as f32,
            s.bias,
            s.normal_bias,
            s.softness,
            s.darkness,
            auto,
            c.x,
            c.y,
            c.z,
            r,
        ]
    }

    /// Point-light (cube map) shadows, independent of `set_scene_shadows`. Bias / normal bias /
    /// softness are in texels at the receiver's distance, darkness in [0, 1], near / far in
    /// world units (`far <= 0` = automatic: the far side of the casters and receivers). The
    /// face edge is snapped to 256 / 512 / 1024.
    #[allow(clippy::too_many_arguments)]
    pub fn set_scene_point_shadows(
        &mut self,
        enabled: bool,
        map_size: u32,
        bias: f32,
        normal_bias: f32,
        softness: f32,
        darkness: f32,
        near: f32,
        far: f32,
    ) {
        self.inner.set_point_shadows(PointShadowConfig {
            enabled,
            map_size,
            bias,
            normal_bias,
            softness,
            darkness,
            near,
            far: (far > 0.0).then_some(far),
        });
    }

    /// `[enabled, map_size, bias, normal_bias, softness, darkness, near, far]` (enabled as
    /// 0 / 1; far 0 = automatic).
    pub fn get_scene_point_shadows(&self) -> Vec<f32> {
        let s = self.inner.point_shadows();
        vec![
            if s.enabled { 1.0 } else { 0.0 },
            s.map_size as f32,
            s.bias,
            s.normal_bias,
            s.softness,
            s.darkness,
            s.near,
            s.far.unwrap_or(0.0),
        ]
    }

    pub fn set_object_shadow_flags(&mut self, object_id: u32, cast: bool, receive: bool) -> bool {
        self.inner.set_object_shadow_flags(object_id, cast, receive)
    }

    /// `[cast, receive]` as 0 / 1, or `[]` when the object does not exist.
    pub fn get_object_shadow_flags(&self, object_id: u32) -> Vec<f32> {
        self.inner
            .object_shadow_flags(object_id)
            .map_or_else(Vec::new, |(c, r)| {
                vec![if c { 1.0 } else { 0.0 }, if r { 1.0 } else { 0.0 }]
            })
    }
}
