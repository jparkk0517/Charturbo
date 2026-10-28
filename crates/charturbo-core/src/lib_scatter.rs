//! WASM bindings of the scatter point styles (kept apart from `lib.rs`; same
//! `WasmCharturboEngine`): series symbol shapes.

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Symbol shape per scatter series id: 0 circle, 1 square, 2 diamond, 3 triangle (unknown
    /// codes and series beyond the list = circle). True when the points were rebuilt.
    pub fn set_chart_scatter_shapes(&mut self, shapes: &[u8]) -> bool {
        self.inner.set_chart_scatter_shapes(shapes)
    }
}
