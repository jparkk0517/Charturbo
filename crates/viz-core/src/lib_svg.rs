//! WASM bindings of the SVG export (kept apart from `lib.rs`).

use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmVizEngine {
    /// SVG markup of the last rendered chart frame (CSS px; empty without a chart): a header
    /// comment `<!--viz:support,marks,truncated,left,top,width,height-->` (support 0 = vector,
    /// 1 = raster plot / heatmap, 2 = raster; truncated 0 / 1; plot rectangle in CSS px), then
    /// `<defs>` + `<g>` layers. `max_marks` 0 = default budget; `id` prefixes element ids.
    pub fn chart_export_svg(&self, max_marks: u32, id: &str) -> String {
        let Some(svg) = self.inner.chart_export_svg(max_marks as usize, id) else {
            return String::new();
        };
        let [l, t, w, h] = svg.plot_css;
        format!(
            "<!--viz:{},{},{},{l},{t},{w},{h}-->{}",
            svg.support.code(),
            svg.marks,
            u8::from(svg.truncated),
            svg.markup
        )
    }
}
