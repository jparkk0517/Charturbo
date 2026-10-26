//! WASM binding of the render backend counters (kept apart from `lib.rs`): GPU bytes, chart
//! upload traffic and staged instance counts for benchmarks / diagnostics.

use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmVizEngine {
    /// `[gpu_bytes, chart_upload_bytes (last sync), chart_upload_total, chart_uploads, frames,
    /// series_segments, points, bars, fill_vertices, markers, wasm_memory_bytes]`.
    pub fn render_stats(&self) -> Vec<f64> {
        let s = self.inner.render_stats();
        #[cfg(target_arch = "wasm32")]
        let wasm_bytes = core::arch::wasm32::memory_size(0) as f64 * 65536.0;
        #[cfg(not(target_arch = "wasm32"))]
        let wasm_bytes = 0.0;
        vec![
            s.gpu_bytes as f64,
            s.chart_upload_bytes as f64,
            s.chart_upload_total as f64,
            s.chart_uploads as f64,
            s.frames as f64,
            f64::from(s.series_segments),
            f64::from(s.points),
            f64::from(s.bars),
            f64::from(s.fill_vertices),
            f64::from(s.markers),
            wasm_bytes,
        ]
    }
}
