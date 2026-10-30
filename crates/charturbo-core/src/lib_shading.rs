//! WASM binding of the scene mesh shading model (classic Blinn-Phong / PBR with tone mapping
//! and environment lighting), kept apart from `lib.rs`.

use crate::scene::{ShadingConfig, ShadingModel, ToneMapping};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// `model` 0 = classic, 1 = pbr; `tone_mapping` 0 none / 1 aces / 2 reinhard. Sky / ground
    /// are sRGB; `env_map` is a texture id (0 = none; unknown ids use the hemisphere). Values
    /// are clamped (exposure and intensity to [0, 16]).
    #[allow(clippy::too_many_arguments)]
    pub fn set_scene_shading(
        &mut self,
        model: u32,
        tone_mapping: u32,
        exposure: f32,
        sky_r: f32,
        sky_g: f32,
        sky_b: f32,
        ground_r: f32,
        ground_g: f32,
        ground_b: f32,
        env_intensity: f32,
        env_map: u32,
    ) {
        self.inner.set_shading(ShadingConfig {
            model: if model == 1 { ShadingModel::Pbr } else { ShadingModel::Classic },
            tone_mapping: ToneMapping::from_code(tone_mapping),
            exposure,
            env_sky: [sky_r, sky_g, sky_b],
            env_ground: [ground_r, ground_g, ground_b],
            env_intensity,
            env_map,
        });
    }

    /// `[model, tone_mapping, exposure, sky r, g, b, ground r, g, b, env_intensity, env_map]`
    /// (the env map id is 0 after its texture was disposed).
    pub fn get_scene_shading(&self) -> Vec<f32> {
        let s = self.inner.shading();
        vec![
            if s.model == ShadingModel::Pbr { 1.0 } else { 0.0 },
            s.tone_mapping.code() as f32,
            s.exposure,
            s.env_sky[0],
            s.env_sky[1],
            s.env_sky[2],
            s.env_ground[0],
            s.env_ground[1],
            s.env_ground[2],
            s.env_intensity,
            s.env_map as f32,
        ]
    }
}
