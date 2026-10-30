//! WASM bindings of decal pattern fills (kept apart from `lib.rs`; same `WasmCharturboEngine`).

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Sets the decals (pattern fills) of the current chart by key (bar global id, pie color
    /// group, funnel stage, area series, treemap / sunburst node): `DECAL_SPEC_STRIDE` (8)
    /// floats each, `[symbol 0-6, size px, spacing px, rotation rad, r, g, b, opacity]` with
    /// `r = -1` for auto contrast (see `chart/decal.rs`); empty = off. Returns "" or the
    /// validation error (the current decals are kept). Without a chart: "no chart".
    pub fn set_chart_decals(&mut self, specs: &[f32]) -> String {
        match self.inner.chart_mut() {
            Some(c) => c.set_decals(specs).err().unwrap_or_default(),
            None => "no chart".into(),
        }
    }
}
