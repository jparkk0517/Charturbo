//! `VisualizationEngine` passthroughs of chart animations (chart/animation.rs), y / box zoom and
//! zoom history (chart/zoom.rs), and SVG export (chart/svg.rs).

use super::*;

impl VisualizationEngine {
    fn chart_view(&self) -> ChartView<'_> {
        ChartView { camera: &self.camera, viewport_px: self.viewport_px, pixel_ratio: self.pixel_ratio }
    }

    /// Animations of this and every later chart (`None` = off; a running one jumps to its end).
    pub fn set_chart_animation(&mut self, opts: Option<AnimationOptions>) {
        // The snapshot of a replaced chart stays: an SDK may switch options between clearing the
        // old chart and creating the next one (`arm_animation` ignores it while off)
        self.chart_animation = opts;
        if let Some(chart) = self.chart.as_mut() {
            chart.set_animation(opts);
        }
    }

    /// Shape per scatter series id (see `ChartState::set_scatter_shapes`).
    pub fn set_chart_scatter_shapes(&mut self, shapes: &[u8]) -> bool {
        self.chart.as_mut().is_some_and(|c| c.set_scatter_shapes(shapes))
    }

    pub fn chart_animation(&self) -> Option<AnimationOptions> {
        self.chart_animation
    }

    /// Advances the chart animation to `now_ms` (see `ChartState::animation_tick`); true while it
    /// runs. Arms a chart that has not rendered a frame yet.
    pub fn chart_animation_tick(&mut self, now_ms: f64) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        chart.arm_animation(self.chart_animation, self.chart_anim_prev.take());
        chart.animation_tick(now_ms)
    }

    /// True while the chart animates (arms a new chart first).
    pub fn chart_animating(&mut self) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        chart.arm_animation(self.chart_animation, self.chart_anim_prev.take());
        chart.is_animating()
    }

    /// Jumps a running chart animation to its final frame.
    pub fn chart_finish_animation(&mut self) {
        if let Some(chart) = self.chart.as_mut() {
            chart.arm_animation(self.chart_animation, self.chart_anim_prev.take());
            chart.finish_animation();
        }
    }

    /// Zooms the y axis around the pointer (line / area: pins y; scatter: y window).
    pub fn chart_zoom_y(&mut self, factor: f32, anchor_ndc_y: f32) -> bool {
        let view = ChartView { camera: &self.camera, viewport_px: self.viewport_px, pixel_ratio: self.pixel_ratio };
        self.chart.as_mut().is_some_and(|c| c.zoom_y(&view, factor, anchor_ndc_y))
    }

    /// Zooms x and y to the NDC drag rectangle `a` -> `b` (box zoom).
    pub fn chart_zoom_box(&mut self, a: (f32, f32), b: (f32, f32)) -> bool {
        let view = ChartView { camera: &self.camera, viewport_px: self.viewport_px, pixel_ratio: self.pixel_ratio };
        self.chart.as_mut().is_some_and(|c| c.zoom_box(&view, a, b))
    }

    pub fn chart_y_zoomed(&self) -> bool {
        self.chart.as_ref().is_some_and(|c| c.y_zoomed())
    }

    pub fn chart_zoom_history_push(&mut self) {
        if let Some(c) = self.chart.as_mut() {
            c.zoom_history_push();
        }
    }

    pub fn chart_zoom_history_trim(&mut self) {
        if let Some(c) = self.chart.as_mut() {
            c.zoom_history_trim();
        }
    }

    pub fn chart_zoom_undo(&mut self) -> bool {
        self.chart.as_mut().is_some_and(|c| c.zoom_undo())
    }

    pub fn chart_zoom_redo(&mut self) -> bool {
        self.chart.as_mut().is_some_and(|c| c.zoom_redo())
    }

    /// `(undo, redo)` steps of the zoom history.
    pub fn chart_zoom_history_len(&self) -> (usize, usize) {
        self.chart.as_ref().map_or((0, 0), |c| c.zoom_history_len())
    }

    pub fn chart_zoom_history_clear(&mut self) {
        if let Some(c) = self.chart.as_mut() {
            c.zoom_history_clear();
        }
    }

    /// SVG of the last rendered chart frame (`None` without a chart); see `ChartState::export_svg`.
    pub fn chart_export_svg(&self, max_marks: usize, id: &str) -> Option<SvgExport> {
        let chart = self.chart.as_ref()?;
        Some(chart.export_svg(&self.chart_view(), max_marks, id))
    }

    /// GPU memory / upload counters of the render backend (benchmarks, diagnostics).
    pub fn render_stats(&self) -> crate::renderer::RenderStats {
        self.renderer.stats()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::{Easing, LineXKind};
    use crate::physics::ForceDirectedSimulator;
    use crate::renderer::MockRenderBackend;
    use crate::spatial::OctreeSpatialIndex;

    fn engine() -> VisualizationEngine {
        let mut e = VisualizationEngine::new(
            GraphDataset::default_empty(),
            Box::new(ForceDirectedSimulator::new(OctreeSpatialIndex::default(), ForceConfig::default())),
            OrbitCamera::new(150.0, 16.0 / 9.0),
            Box::new(MockRenderBackend::default()),
        );
        e.resize(1600, 900);
        e
    }

    fn line(e: &mut VisualizationEngine, values: Vec<f32>) {
        e.set_line_chart(
            vec![LineSeries { values, x: None, color: [1.0; 4], width_px: 2.0 }],
            LineLayout { width: 160.0, height: 80.0, view: crate::chart::ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        );
    }

    #[test]
    fn rerendered_charts_tween_from_the_replaced_one_and_animations_stop() {
        let mut e = engine();
        line(&mut e, vec![0.0, 1.0, 2.0]);
        assert!(!e.chart_animating(), "off by default");
        e.set_chart_animation(AnimationOptions::new(100.0, Easing::Linear));
        line(&mut e, vec![0.0, 1.0, 2.0]);
        assert!(e.chart_animating(), "enter animation");
        e.chart_finish_animation();
        e.sync_and_render();
        // Same shape: update tween from the cleared chart's frame
        line(&mut e, vec![2.0, 1.0, 0.0]);
        assert!(e.chart_animation_tick(0.0));
        e.sync_and_render();
        assert!(e.chart_animation_tick(50.0));
        assert!(!e.chart_animation_tick(150.0));
        assert!(!e.chart_animating());
        // Off again: nothing animates
        e.set_chart_animation(None);
        line(&mut e, vec![1.0, 1.0, 1.0]);
        assert!(!e.chart_animating());
        // Options toggled between clearing a chart and creating the next one (SDK chart override):
        // the next chart still tweens from the cleared one
        e.set_chart_animation(AnimationOptions::new(100.0, Easing::Linear));
        line(&mut e, vec![1.0, 2.0, 3.0]);
        e.chart_finish_animation();
        e.sync_and_render();
        e.clear_chart();
        e.set_chart_animation(None);
        e.set_chart_animation(AnimationOptions::new(100.0, Easing::Linear));
        line(&mut e, vec![3.0, 2.0, 1.0]);
        assert!(e.chart_animating());
        assert!(e.chart.as_ref().unwrap().anim_is_update());
    }

    #[test]
    fn svg_export_and_zoom_history_pass_through() {
        let mut e = engine();
        assert!(e.chart_export_svg(0, "x").is_none());
        line(&mut e, (0..100).map(|i| i as f32).collect());
        e.sync_and_render();
        let svg = e.chart_export_svg(0, "x").unwrap();
        assert!(svg.markup.contains("data-layer=\"series\""));
        e.chart_zoom_history_push();
        assert!(e.chart_zoom_y(0.5, 0.0));
        assert!(e.chart_y_zoomed());
        assert_eq!(e.chart_zoom_history_len(), (1, 0));
        assert!(e.chart_zoom_undo());
        assert!(!e.chart_y_zoomed());
        assert!(e.chart_zoom_redo());
        assert!(e.chart_y_zoomed());
        e.chart_zoom_history_clear();
        assert_eq!(e.chart_zoom_history_len(), (0, 0));
    }
}
