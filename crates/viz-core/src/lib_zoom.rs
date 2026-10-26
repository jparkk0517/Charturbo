//! WASM bindings of y / box zoom and the zoom history (kept apart from `lib.rs`).

use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmVizEngine {
    /// Zooms the y axis around `anchor_ndc_y` (`factor` < 1 zooms in): line / area charts pin
    /// their y domain until `chart_reset_zoom`, scatter charts zoom their y window. True when the
    /// view moved.
    pub fn chart_zoom_y(&mut self, factor: f32, anchor_ndc_y: f32) -> bool {
        self.inner.chart_zoom_y(factor, anchor_ndc_y)
    }

    /// Box zoom to the NDC rectangle `(ax, ay)` - `(bx, by)` (draw it live with `chart_brush`
    /// mode 1); removes the brush rectangle. True when the view moved.
    pub fn chart_zoom_box(&mut self, ax: f32, ay: f32, bx: f32, by: f32) -> bool {
        self.inner.chart_zoom_box((ax, ay), (bx, by))
    }

    /// True while a manual y zoom pins the line y domain.
    pub fn chart_y_zoomed(&self) -> bool {
        self.inner.chart_y_zoomed()
    }

    /// Records the current zoom before a zoom gesture (clears redo).
    pub fn chart_zoom_history_push(&mut self) {
        self.inner.chart_zoom_history_push();
    }

    /// Drops trailing undo steps equal to the current zoom (a gesture that did not move it).
    pub fn chart_zoom_history_trim(&mut self) {
        self.inner.chart_zoom_history_trim();
    }

    pub fn chart_zoom_undo(&mut self) -> bool {
        self.inner.chart_zoom_undo()
    }

    pub fn chart_zoom_redo(&mut self) -> bool {
        self.inner.chart_zoom_redo()
    }

    /// `[undo steps, redo steps]`.
    pub fn chart_zoom_history(&self) -> Vec<u32> {
        let (u, r) = self.inner.chart_zoom_history_len();
        vec![u as u32, r as u32]
    }

    pub fn chart_zoom_history_clear(&mut self) {
        self.inner.chart_zoom_history_clear();
    }
}
