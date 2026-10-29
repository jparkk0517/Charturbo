//! `VisualizationEngine` passthroughs of the parallel coordinates brush (chart/parallel.rs).

use super::*;

impl VisualizationEngine {
    fn parallel_view(&self) -> ChartView<'_> {
        ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        }
    }

    /// Replaces the parallel brush (see `ChartState::set_parallel_brush`); the active row count.
    pub fn chart_set_parallel_brush(
        &mut self,
        intervals: &[(usize, f64, f64)],
    ) -> Result<usize, String> {
        let chart = self.chart.as_mut().ok_or_else(|| "no chart".to_string())?;
        chart.set_parallel_brush(intervals, &mut self.scene)
    }

    /// Axis under an NDC pointer and the data value there.
    pub fn chart_parallel_axis_hit(&self, ndc: (f32, f32)) -> Option<(usize, f64)> {
        self.chart.as_ref()?.parallel_axis_hit(&self.parallel_view(), ndc)
    }

    /// Hovers row `row` by index (keyboard focus; see `ChartState::hover_parallel_row`).
    pub fn chart_hover_parallel_row(&mut self, row: u32) -> Option<HoverResult> {
        let chart = self.chart.as_mut()?;
        chart.hover_parallel_row(row, &mut self.scene)
    }

    /// Data value of `axis` at an NDC pointer (clamped to the axis).
    pub fn chart_parallel_value_at(&self, axis: usize, ndc: (f32, f32)) -> Option<f64> {
        self.chart.as_ref()?.parallel_value_at(axis, &self.parallel_view(), ndc)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::{ParallelDim, ParallelOptions, ParallelStyle};
    use crate::physics::ForceDirectedSimulator;
    use crate::renderer::MockRenderBackend;
    use crate::spatial::OctreeSpatialIndex;

    #[test]
    fn brush_and_axis_hits_pass_through_to_the_chart() {
        let mut e = VisualizationEngine::new(
            GraphDataset::default_empty(),
            Box::new(ForceDirectedSimulator::new(
                OctreeSpatialIndex::default(),
                ForceConfig::default(),
            )),
            OrbitCamera::new(150.0, 16.0 / 9.0),
            Box::new(MockRenderBackend::default()),
        );
        e.resize(1600, 900);
        assert!(e.chart_set_parallel_brush(&[]).is_err(), "no chart");
        assert_eq!(e.chart_parallel_axis_hit((0.0, 0.0)), None);
        let dims = [ParallelDim {
            min: Some(0.0),
            max: Some(10.0),
            ..Default::default()
        }; 3];
        let mut chart = ChartState::new_parallel(
            &dims,
            &[1.0, 1.0, 1.0, 5.0, 5.0, 5.0],
            &[],
            ParallelOptions::default(),
            ParallelStyle::default(),
        );
        // Symmetric padding: the middle axis sits at the NDC center
        chart.set_padding([20.0; 4]);
        e.set_chart_state(chart);
        e.sync_and_render();
        assert_eq!(e.chart_set_parallel_brush(&[(0, 4.0, 6.0)]), Ok(1));
        assert!(e.chart_set_parallel_brush(&[(9, 0.0, 1.0)]).is_err());
        // Middle axis at the NDC center: value at mid-height of the axis
        let (axis, value) = e.chart_parallel_axis_hit((0.0, 0.0)).expect("middle axis");
        assert_eq!(axis, 1);
        assert!(value > 0.0 && value < 10.0, "{value}");
        assert_eq!(
            e.chart_parallel_value_at(0, (0.0, 10.0)),
            Some(10.0),
            "clamped"
        );
        assert_eq!(e.chart_parallel_value_at(7, (0.0, 0.0)), None);
        // Keyboard focus hovers a row by index
        assert_eq!(e.chart_hover_parallel_row(1).map(|h| h.items[0].index), Some(1));
        assert!(e.chart_hover_parallel_row(5).is_none());
    }
}
