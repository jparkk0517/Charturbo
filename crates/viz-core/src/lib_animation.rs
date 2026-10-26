//! WASM bindings of chart animations (kept apart from `lib.rs`; same `WasmVizEngine`).

use crate::chart::{AnimationOptions, Easing};
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmVizEngine {
    /// Enter / update animations of this and later charts: `duration_ms` <= 0 or NaN = off;
    /// `easing` 0 = linear, 1 = cubic-out, 2 = cubic-in-out, 3 = cubic-in.
    pub fn set_chart_animation(&mut self, duration_ms: f32, easing: u8) {
        self.inner.set_chart_animation(AnimationOptions::new(duration_ms, Easing::from_u8(easing)));
    }

    /// Advances the running chart animation to `now_ms` (`performance.now()`); true while it
    /// still runs. Render after every tick; stop ticking once it returns false.
    pub fn chart_animation_tick(&mut self, now_ms: f64) -> bool {
        self.inner.chart_animation_tick(now_ms)
    }

    /// True while the chart animates.
    pub fn chart_animating(&mut self) -> bool {
        self.inner.chart_animating()
    }

    /// Jumps a running chart animation to its final frame.
    pub fn chart_finish_animation(&mut self) {
        self.inner.chart_finish_animation();
    }
}
