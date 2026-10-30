//! WASM binding of the HDR post-processing (bloom / auto exposure) of the PBR meshes, kept
//! apart from `lib.rs`.

use crate::scene::{AutoExposureConfig, BloomConfig, PostProcessConfig};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Bloom (`intensity` 0..8, `threshold` 0..64, `knee` / `radius` 0..1) and auto exposure
    /// (EV clamp within [-16, 16], speeds 0..100 / s, compensation -8..8 EV, `instant`
    /// adaptation). Values are clamped; non-finite ones take the defaults.
    #[allow(clippy::too_many_arguments)]
    pub fn set_post_processing(
        &mut self,
        bloom: bool,
        intensity: f32,
        threshold: f32,
        knee: f32,
        radius: f32,
        auto_exposure: bool,
        min_ev: f32,
        max_ev: f32,
        speed_up: f32,
        speed_down: f32,
        compensation: f32,
        instant: bool,
    ) {
        self.inner.set_post_processing(PostProcessConfig {
            bloom: BloomConfig {
                enabled: bloom,
                intensity,
                threshold,
                knee,
                radius,
            },
            auto_exposure: AutoExposureConfig {
                enabled: auto_exposure,
                min_ev,
                max_ev,
                speed_up,
                speed_down,
                compensation,
                instant,
            },
        });
    }

    /// `[bloom, intensity, threshold, knee, radius, auto exposure, min EV, max EV, speed up,
    /// speed down, compensation, instant, supported, active]` (flags 1 / 0). `supported`: the
    /// device renders the HDR targets at the current MSAA setting; `active`: enabled, PBR
    /// shading and supported.
    pub fn get_post_processing(&self) -> Vec<f32> {
        let PostProcessConfig {
            bloom: b,
            auto_exposure: a,
        } = self.inner.post_processing();
        let flag = |v: bool| if v { 1.0 } else { 0.0 };
        vec![
            flag(b.enabled),
            b.intensity,
            b.threshold,
            b.knee,
            b.radius,
            flag(a.enabled),
            a.min_ev,
            a.max_ev,
            a.speed_up,
            a.speed_down,
            a.compensation,
            flag(a.instant),
            flag(self.inner.post_processing_supported()),
            flag(self.inner.post_processing_active()),
        ]
    }
}

impl WasmCharturboEngine {
    /// Feeds the exposure adaptation clock (`performance.now()`) before a frame.
    pub(crate) fn advance_post_clock(&mut self) {
        #[cfg(target_arch = "wasm32")]
        {
            let now = web_sys::window()
                .and_then(|w| w.performance())
                .map_or_else(js_sys::Date::now, |p| p.now());
            self.inner.advance_post_clock(now / 1000.0);
        }
    }
}
