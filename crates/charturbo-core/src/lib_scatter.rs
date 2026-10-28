//! WASM bindings of the scatter point styles (kept apart from `lib.rs`; same
//! `WasmCharturboEngine`): series symbol shapes and the ripple effect.

use crate::chart::RippleOptions;
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Symbol shape per scatter series id: 0 circle, 1 square, 2 diamond, 3 triangle (unknown
    /// codes and series beyond the list = circle). True when the points were rebuilt.
    pub fn set_chart_scatter_shapes(&mut self, shapes: &[u8]) -> bool {
        self.inner.set_chart_scatter_shapes(shapes)
    }

    /// Rippling scatter series (`flags[id] != 0`; empty = none): rings grow to `scale` point radii
    /// and fade over `period_s` seconds, `count` rings, `fill` = filled discs instead of 1.5 px
    /// strokes (NaN = defaults 4 s / 2.5; clamped). True when the points were rebuilt.
    pub fn set_chart_scatter_ripple(&mut self, flags: &[u8], period_s: f32, scale: f32, count: u32, fill: bool) -> bool {
        let d = RippleOptions::default();
        let opts = RippleOptions {
            period_s: if period_s.is_finite() { period_s } else { d.period_s },
            scale: if scale.is_finite() { scale } else { d.scale },
            count: if count == 0 { d.count } else { count },
            fill,
        };
        self.inner.set_chart_scatter_ripple(flags, opts)
    }

    /// Ripple clock in seconds (only the point uniform changes); false when nothing ripples, so
    /// the caller can stop its frame loop.
    pub fn set_chart_effect_time(&mut self, seconds: f32) -> bool {
        self.inner.set_chart_effect_time(seconds)
    }
}
