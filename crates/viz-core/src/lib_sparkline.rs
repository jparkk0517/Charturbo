//! WASM bindings of the sparkline preset (kept apart from `lib.rs`; same `WasmVizEngine`).

use crate::chart::SparklineMarks;
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

/// RGBA of a 4-entry array with finite entries, else `None` (mark off).
fn color4(v: &[f32]) -> Option<[f32; 4]> {
    match v {
        [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => Some([*r, *g, *b, *a]),
        _ => None,
    }
}

#[wasm_bindgen]
impl WasmVizEngine {
    /// Sparkline marks of the active line / area / bar chart, drawn by the annotation layers
    /// and rebuilt from the data on every data update: `last` / `min` / `max` marker colors
    /// (empty = no marker), marker radius in CSS px (NaN = 3), reference band `[lo, hi]` in
    /// data units (empty = none) with its RGBA, and a y = 0 line color (empty = none).
    #[allow(clippy::too_many_arguments)]
    pub fn set_chart_sparkline(
        &mut self,
        last: &[f32],
        min: &[f32],
        max: &[f32],
        radius_px: f32,
        band: &[f64],
        band_color: &[f32],
        zero_line: &[f32],
    ) {
        let Some(chart) = self.inner.chart_mut() else {
            return;
        };
        let band = match (band, color4(band_color)) {
            ([lo, hi], Some(c)) if lo.is_finite() && hi.is_finite() => Some((*lo, *hi, c)),
            _ => None,
        };
        chart.set_sparkline(Some(SparklineMarks {
            last: color4(last),
            min: color4(min),
            max: color4(max),
            marker_radius_px: if radius_px.is_finite() { radius_px } else { SparklineMarks::default().marker_radius_px },
            band,
            zero_line: color4(zero_line),
        }));
    }

    /// Removes the sparkline marks of the active chart.
    pub fn clear_chart_sparkline(&mut self) {
        if let Some(chart) = self.inner.chart_mut() {
            chart.set_sparkline(None);
        }
    }

    /// `[count, first, last, min, max, first_index, last_index, min_index, max_index,
    /// change_pct (NaN when first is 0)]` of the first series / bar series, or empty without
    /// finite data (or for other chart kinds).
    pub fn chart_sparkline_summary(&self) -> Vec<f64> {
        let Some(s) = self.inner.chart().and_then(|c| c.sparkline_summary()) else {
            return Vec::new();
        };
        vec![
            s.count as f64,
            s.first as f64,
            s.last as f64,
            s.min as f64,
            s.max as f64,
            s.first_index as f64,
            s.last_index as f64,
            s.min_index as f64,
            s.max_index as f64,
            s.change_pct(),
        ]
    }
}
