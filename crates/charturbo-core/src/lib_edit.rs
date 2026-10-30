//! WASM bindings of point editing (SDK point drag / click to add; kept apart from `lib.rs`;
//! same `WasmCharturboEngine`).

use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Data under NDC `(x, y)` with y on axis `axis` (1 = right axis):
    /// `[x, y, x_lo, x_hi, y_lo, y_hi]` (visible data range, ordered); empty outside 2D charts.
    pub fn chart_ndc_to_data(&self, x: f32, y: f32, axis: u8) -> Vec<f64> {
        self.inner.chart_ndc_to_data(x, y, axis).map(|d| d.to_vec()).unwrap_or_default()
    }

    /// Moves scatter point `index` (data order) to `(x, y)` keeping the domains, zoom and
    /// legend state. False for other charts, unknown indices or non-finite values.
    pub fn set_chart_scatter_point(&mut self, index: u32, x: f32, y: f32) -> bool {
        self.inner.set_chart_scatter_point(index as usize, x, y)
    }

    /// Appends a scatter point to series id `series`; its index, or -1 (other charts, unknown
    /// series, non-finite values).
    pub fn append_chart_scatter_point(&mut self, x: f32, y: f32, series: u16) -> i32 {
        self.inner.append_chart_scatter_point(x, y, series).map_or(-1, |i| i as i32)
    }
}
