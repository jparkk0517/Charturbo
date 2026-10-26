//! WASM bindings of time-axis time zones (kept apart from `lib.rs`; same `WasmVizEngine`).

use crate::chart::TimeZone;
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmVizEngine {
    /// Time zone of the active chart's time x axis as a UTC-offset table: `offsets_min[i]`
    /// (minutes east of UTC) applies from `transitions_ms[i]` (UTC epoch ms, strictly ascending;
    /// the first entry also covers earlier instants). Empty arrays = UTC. Applies to the current
    /// chart only (new charts start in UTC); ticks re-lay out on the next frame.
    pub fn set_chart_time_zone(&mut self, transitions_ms: &[f64], offsets_min: &[f32]) -> Result<(), JsValue> {
        let tz = TimeZone::from_table(transitions_ms, offsets_min).map_err(|e| JsValue::from_str(&e))?;
        if let Some(chart) = self.inner.chart_mut() {
            chart.set_time_zone(tz);
        }
        Ok(())
    }

    /// Full x domain `[lo, hi]` (epoch ms) of the active chart's time x axis, empty without one:
    /// the range the time zone table must cover (zoom / pan stay inside it; streaming grows it).
    pub fn chart_time_domain(&self) -> Vec<f64> {
        match self.inner.chart().and_then(|c| c.time_x_domain()) {
            Some((lo, hi)) => vec![lo, hi],
            None => Vec::new(),
        }
    }
}
