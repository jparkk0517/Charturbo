//! Point editing passthroughs (chart/edit.rs, chart/scatter/edit.rs).

use super::*;

impl VisualizationEngine {
    /// Data under NDC `(x, y)` on y axis `axis` plus the visible data range (see
    /// `ChartState::ndc_to_data`).
    pub fn chart_ndc_to_data(&self, x: f32, y: f32, axis: u8) -> Option<[f64; 6]> {
        let view = ChartView { camera: &self.camera, viewport_px: self.viewport_px, pixel_ratio: self.pixel_ratio };
        self.chart.as_ref()?.ndc_to_data(&view, (x, y), axis)
    }

    /// Moves a scatter point in place, then re-resolves the hover under the pointer.
    pub fn set_chart_scatter_point(&mut self, index: usize, x: f32, y: f32) -> bool {
        let moved = self.chart.as_mut().is_some_and(|c| c.set_scatter_point(index, x, y));
        if moved {
            self.refresh_chart_hover();
        }
        moved
    }

    /// Appends a scatter point; its index, or `None`.
    pub fn append_chart_scatter_point(&mut self, x: f32, y: f32, series: u16) -> Option<usize> {
        let index = self.chart.as_mut()?.append_scatter_point(x, y, series)?;
        self.refresh_chart_hover();
        Some(index)
    }
}
