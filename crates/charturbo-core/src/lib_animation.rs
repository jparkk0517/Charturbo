//! WASM bindings of chart animations (kept apart from `lib.rs`; same `WasmCharturboEngine`).

use crate::chart::{AnimationOptions, Easing};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
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

    /// Morphing transitions into a re-rendered chart of the paired family (bar <-> pie, treemap
    /// <-> sunburst); call after `set_chart_animation` (which resets it), needs animations on.
    pub fn set_chart_transition(&mut self, on: bool) {
        self.inner.set_chart_transition(on);
    }

    /// Stable key per mark by global id (bars / pie inputs / hierarchy nodes): races and
    /// transitions pair marks by key. False without a chart.
    pub fn set_chart_mark_keys(&mut self, keys: &[u32]) -> bool {
        self.inner.set_chart_mark_keys(keys.to_vec())
    }

    /// Bar race (`realtimeSort`) of a single-series 2D bar chart. False without a bar chart.
    pub fn set_chart_bar_race(&mut self, on: bool) -> bool {
        self.inner.set_chart_bar_race(on)
    }

    /// Eased progress of the running chart animation (1 when idle).
    pub fn chart_animation_progress(&self) -> f32 {
        self.inner.chart_animation_progress()
    }

    /// Line end label anchors: `[count, (series, x_css, y_css, value) * count]`.
    pub fn chart_line_end_labels(&self) -> Vec<f32> {
        let labels = self.inner.chart_line_end_labels();
        let mut out = Vec::with_capacity(1 + labels.len() * 4);
        out.push(labels.len() as f32);
        for l in labels {
            out.extend([l.series as f32, l.x_css, l.y_css, l.value]);
        }
        out
    }
}
