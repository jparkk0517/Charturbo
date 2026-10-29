//! WASM bindings of pictorial bars (symbols drawn instead of the 2D bars; kept apart from
//! `lib.rs`; same `WasmCharturboEngine`).

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Turns the current 2D bar chart into a pictorial one (call last, after `set_bar_chart` /
    /// `set_bar_chart_multi` and the bar style). `symbols`: `\n`-separated list (built-in names or
    /// `path://` SVG path data); `records`: `PICTORIAL_STRIDE` (19) floats per bar id (see
    /// `chart/pictorial.rs`). Returns false and changes nothing for invalid input, 3D bars,
    /// histograms, or without a bar chart.
    pub fn set_chart_bar_pictorial(&mut self, symbols: &str, records: &[f32]) -> bool {
        self.inner
            .chart_mut()
            .is_some_and(|c| c.set_bar_pictorial(symbols, records))
    }

    /// The symbol (built-in name or `path://` path data) can be drawn by pictorial bars.
    pub fn pictorial_symbol_valid(&self, symbol: &str) -> bool {
        crate::chart::pictorial_symbol_valid(symbol)
    }
}
