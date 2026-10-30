//! y-axis zoom, box zoom and zoom history of 2D charts.
//!
//! - Line / area charts get a manual y window (`LineChart::y_zoom`, scale space per y axis):
//!   wheel y zoom around the pointer, `set_y_range_data`, or a box zoom pins the y domains, which
//!   then ignore autoscale / data changes until `reset_zoom`. Ticks and gridlines follow the
//!   pinned window (nice step, no outward rounding). Scatter charts zoom `window_y`.
//! - Box zoom maps an NDC drag rectangle (drawn live with the brush rectangle) to data ranges and
//!   zooms x and y to it.
//! - Zoom history: snapshots of the zoom windows (x window, scatter / heatmap y window, line y
//!   pin) pushed before each zoom gesture, with undo / redo (at most `ZOOM_HISTORY_MAX` steps).

use super::area::AreaChart;
use super::line::LineChart;
use super::multi_axis::MAX_Y_AXES;
use super::*;

/// Undo steps kept by the zoom history.
pub const ZOOM_HISTORY_MAX: usize = 50;

/// Pinned y spans stay within these multiples of the data extent.
const Y_ZOOM_MIN_SPAN: f64 = 1e-5;
const Y_ZOOM_MAX_SPAN: f64 = 1e3;

/// Zoom windows of a chart (what the history restores).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ZoomState {
    x: (f32, f32),
    y: (f32, f32),
    y_zoom: Option<[(f64, f64); MAX_Y_AXES]>,
}

#[derive(Debug, Clone, Default)]
pub(crate) struct ZoomHistory {
    undo: Vec<ZoomState>,
    redo: Vec<ZoomState>,
}

impl LineChart {
    /// Applies the pinned scale-space window `(lo, hi)` to y axis `k`; true when it moved.
    pub(crate) fn apply_y_zoom(&mut self, k: u8, (lo, hi): (f64, f64)) -> bool {
        let scale = self.scale_of_axis(k);
        let span = (hi - lo).max(1e-12);
        // Log axes tick by decade (step unused), linear ones by a nice step of the window
        let step = if scale.is_log() { 0.0 } else { nice_step(span, scale.target(self.tick_target)) };
        let (y_min, y_span) = (lo as f32, (span as f32).max(1e-6));
        let slot = self.dom_mut(k);
        if (*slot.0, *slot.1, *slot.2) == (y_min, y_span, step) {
            return false;
        }
        (*slot.0, *slot.1, *slot.2) = (y_min, y_span, step);
        true
    }

    /// Current scale-space `(lo, hi)` of y axis `k`.
    fn y_window_u(&self, k: u8) -> (f64, f64) {
        let (min, span) = if k == 0 { (self.y_min, self.y_span) } else { (self.rec(k).y_min, self.rec(k).y_span) };
        (min as f64, (min + span) as f64)
    }

    /// Scale-space extent of the data on axis `k` (zoom limits; flat data: its magnitude).
    fn y_data_span_u(&self, k: u8) -> f64 {
        let (lo, hi) = self.data_extent(k);
        let scale = self.scale_of_axis(k);
        let (a, b) = (scale.fwd(lo as f64), scale.fwd(hi as f64));
        if !a.is_finite() || !b.is_finite() {
            return 1.0;
        }
        let span = (b - a).abs();
        if span > 0.0 {
            span
        } else {
            a.abs().max(1.0)
        }
    }

    /// Pins both y axes to windows whose fraction of the current domain is `(f0, f1)` (0 = the
    /// domain bottom, 1 = its top in scale space). Spans are clamped to the zoom limits around the
    /// window centre. True when a domain moved.
    pub(crate) fn pin_y_fraction(&mut self, f0: f64, f1: f64) -> bool {
        if !f0.is_finite() || !f1.is_finite() || (f1 - f0).abs() < 1e-12 {
            return false;
        }
        let (f0, f1) = (f0.min(f1), f0.max(f1));
        let mut pin = self.y_zoom.unwrap_or_else(|| std::array::from_fn(|k| self.y_window_u(k as u8)));
        for k in 0..self.y_axis_count() {
            let (lo, hi) = self.y_window_u(k);
            let (a, b) = (lo + f0 * (hi - lo), lo + f1 * (hi - lo));
            let base = self.y_data_span_u(k);
            let span = (b - a).clamp(base * Y_ZOOM_MIN_SPAN, base * Y_ZOOM_MAX_SPAN);
            let c = 0.5 * (a + b);
            pin[k as usize] = (c - 0.5 * span, c + 0.5 * span);
        }
        self.y_zoom = Some(pin);
        self.update_y_domain(true)
    }

    /// Fraction of the left y domain (0 = bottom of the domain) at world `y`.
    fn y_fraction_of_world(&self, y: f32) -> f64 {
        let f = (y / self.layout.height.max(1e-6) + 0.5) as f64;
        // A reversed axis runs top -> bottom
        if self.y_scale.sign() < 0.0 {
            1.0 - f
        } else {
            f
        }
    }
}

impl ChartState {
    /// Zooms the y axis around the pointer (`factor` < 1 zooms in): line / area charts pin their
    /// y domains (both axes of a dual-axis chart, same screen anchor), scatter charts zoom
    /// `window_y`. True when the view moved.
    pub fn zoom_y(&mut self, view: &ChartView, factor: f32, anchor_ndc_y: f32) -> bool {
        if !factor.is_finite() || factor <= 0.0 || !anchor_ndc_y.is_finite() {
            return false;
        }
        let f = factor as f64;
        let changed = match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if l.layout.view == ChartViewMode::Flat => {
                let z0 = l.z.first().copied().unwrap_or(0.0);
                let half = l.layout.height * 0.5;
                let a = ray_hit_z_plane(&view.camera.screen_to_ray(0.0, anchor_ndc_y), z0)
                    .map_or(0.5, |p| l.y_fraction_of_world(p.y.clamp(-half, half)));
                l.pin_y_fraction(a - a * f, a + (1.0 - a) * f)
            }
            ChartKind::Scatter(s) => {
                let hh = s.layout.height * 0.5;
                let (w0, w1) = s.window_y;
                let anchor = ray_hit_z_plane(&view.camera.screen_to_ray(0.0, anchor_ndc_y), 0.0)
                    .map(|p| s.t_of_world(0.0, p.y.clamp(-hh, hh))[1])
                    .unwrap_or((w0 + w1) * 0.5);
                let span = (w1 - w0) * factor;
                let start = anchor - (anchor - w0) * factor;
                let before = s.window_y;
                s.set_window(s.window_x, (start, start + span));
                s.window_y != before
            }
            _ => false,
        };
        if changed {
            self.on_zoom_changed();
        }
        changed
    }

    /// Box zoom: zooms x and y to the data rectangle under the NDC drag from `a` to `b` (clamped
    /// to the plot) and removes the live brush rectangle that showed it. True when the view moved.
    pub fn zoom_box(&mut self, view: &ChartView, a: (f32, f32), b: (f32, f32)) -> bool {
        self.clear_selection();
        if ![a.0, a.1, b.0, b.1].iter().all(|v| v.is_finite()) {
            return false;
        }
        let Some(f) = self.annotation_frame() else {
            return false;
        };
        let [bx0, bx1, by0, by1] = f.bounds;
        let hit = |p: (f32, f32)| {
            let w = ray_hit_z_plane(&view.camera.screen_to_ray(p.0, p.1), f.z)?;
            Some((w.x.clamp(bx0.min(bx1), bx0.max(bx1)), w.y.clamp(by0.min(by1), by0.max(by1))))
        };
        let (Some(pa), Some(pb)) = (hit(a), hit(b)) else {
            return false;
        };
        if (pa.0 - pb.0).abs() < 1e-6 || (pa.1 - pb.1).abs() < 1e-6 {
            return false;
        }
        let (x0, x1) = (f.x.unmap(pa.0), f.x.unmap(pb.0));
        match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                let (f0, f1) = (l.y_fraction_of_world(pa.1), l.y_fraction_of_world(pb.1));
                let y = l.pin_y_fraction(f0, f1);
                if y {
                    self.on_zoom_changed();
                }
                self.set_x_range_data(x0, x1) | y
            }
            ChartKind::Scatter(_) | ChartKind::Candle(_) => {
                let (y0, y1) = (f.y.unmap(pa.1), f.y.unmap(pb.1));
                let x = self.set_x_range_data(x0, x1);
                self.set_y_range_data(y0, y1) | x
            }
            _ => false,
        }
    }

    /// True while a manual y zoom pins the line y domains.
    pub fn y_zoomed(&self) -> bool {
        matches!(&self.kind, ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if l.y_zoom.is_some())
    }

    /// Line / area: pins the left y axis to `[lo, hi]` (data units; the right axis keeps the same
    /// screen band). True when the view moved.
    pub(crate) fn set_line_y_range(&mut self, lo: f64, hi: f64) -> bool {
        let (ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. })) = &mut self.kind else {
            return false;
        };
        if l.layout.view != ChartViewMode::Flat {
            return false;
        }
        let (u0, u1) = (l.y_scale.fwd(lo), l.y_scale.fwd(hi));
        let (d0, d1) = l.y_window_u(0);
        let changed = l.pin_y_fraction((u0 - d0) / (d1 - d0), (u1 - d0) / (d1 - d0));
        if changed {
            self.on_zoom_changed();
        }
        changed
    }

    /// Drops a manual y zoom (part of `reset_zoom`); true when it was set.
    pub(crate) fn clear_y_zoom(&mut self) -> bool {
        let cleared = match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if l.y_zoom.is_some() => {
                l.y_zoom = None;
                l.update_y_domain(true);
                true
            }
            _ => false,
        };
        if cleared {
            self.on_zoom_changed();
        }
        cleared
    }

    fn on_zoom_changed(&mut self) {
        // Pinned y moves every mark / gridline / tick (series re-laid out from the LOD)
        self.dirty.series = true;
        self.dirty.underlay = true;
        self.dirty.overlay = true;
        self.dirty.point_style = true;
        self.axes_key = None;
        self.lod = None;
        self.brush.invalidate();
    }

    /// Zoom windows of the chart (`None` for charts without zoom).
    pub(crate) fn zoom_state(&self) -> Option<ZoomState> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if l.layout.view == ChartViewMode::Flat => {
                Some(ZoomState { x: l.window, y: (0.0, 1.0), y_zoom: l.y_zoom })
            }
            ChartKind::Scatter(s) => Some(ZoomState { x: s.window_x, y: s.window_y, y_zoom: None }),
            ChartKind::Heatmap(h) => Some(ZoomState { x: h.window_x, y: h.window_y, y_zoom: None }),
            ChartKind::Candle(c) => Some(ZoomState { x: c.window, y: (0.0, 1.0), y_zoom: None }),
            // Combo: x zoom / pan only (its y domains are fixed)
            ChartKind::Combo(c) => Some(ZoomState { x: c.line.window, y: (0.0, 1.0), y_zoom: None }),
            _ => None,
        }
    }

    fn restore_zoom_state(&mut self, st: ZoomState) {
        let mut y_changed = false;
        match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                l.set_window(st.x.0, st.x.1);
                if l.y_zoom != st.y_zoom {
                    l.y_zoom = st.y_zoom;
                    l.update_y_domain(true);
                    y_changed = true;
                }
            }
            ChartKind::Scatter(s) => s.set_window(st.x, st.y),
            ChartKind::Heatmap(h) => h.set_window(st.x, st.y),
            ChartKind::Candle(c) => c.set_window(st.x.0, st.x.1),
            ChartKind::Combo(c) => c.line.set_window(st.x.0, st.x.1),
            _ => return,
        }
        self.on_window_changed();
        if y_changed {
            self.on_zoom_changed();
        }
    }

    /// Records the current zoom before a zoom gesture (wheel burst, drag pan, box zoom, range
    /// call); clears the redo steps. Consecutive identical states are stored once.
    pub fn zoom_history_push(&mut self) {
        let Some(st) = self.zoom_state() else {
            return;
        };
        let h = &mut self.zoom_history;
        if h.undo.last() != Some(&st) {
            h.undo.push(st);
            if h.undo.len() > ZOOM_HISTORY_MAX {
                h.undo.remove(0);
            }
        }
        h.redo.clear();
    }

    /// Restores the last recorded zoom that differs from the current one; true when it moved.
    pub fn zoom_undo(&mut self) -> bool {
        let Some(cur) = self.zoom_state() else {
            return false;
        };
        while let Some(st) = self.zoom_history.undo.pop() {
            if st != cur {
                self.zoom_history.redo.push(cur);
                self.restore_zoom_state(st);
                return true;
            }
        }
        false
    }

    /// Re-applies the last undone zoom; true when it moved.
    pub fn zoom_redo(&mut self) -> bool {
        let Some(cur) = self.zoom_state() else {
            return false;
        };
        let Some(st) = self.zoom_history.redo.pop() else {
            return false;
        };
        self.zoom_history.undo.push(cur);
        if self.zoom_history.undo.len() > ZOOM_HISTORY_MAX {
            self.zoom_history.undo.remove(0);
        }
        self.restore_zoom_state(st);
        true
    }

    /// Drops trailing undo steps equal to the current zoom (a recorded gesture that did not move
    /// the view).
    pub fn zoom_history_trim(&mut self) {
        let Some(cur) = self.zoom_state() else {
            return;
        };
        while self.zoom_history.undo.last() == Some(&cur) {
            self.zoom_history.undo.pop();
        }
    }

    /// `(undo steps, redo steps)`.
    pub fn zoom_history_len(&self) -> (usize, usize) {
        (self.zoom_history.undo.len(), self.zoom_history.redo.len())
    }

    pub fn zoom_history_clear(&mut self) {
        self.zoom_history = ZoomHistory::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    /// 0..=1000 ramp: y domain 0..1000 (step 200).
    fn ramp() -> (OrbitCamera, ChartState) {
        let mut cam = flat_camera();
        let chart = ChartState::new_line(
            vec![LineSeries { values: (0..=1000).map(|i| i as f32).collect(), x: None, color: [1.0; 4], width_px: 2.0 }],
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn ndc_of_world(cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let p = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        (p.x, p.y)
    }

    #[test]
    fn y_zoom_keeps_the_anchor_value_and_ticks_follow() {
        let (cam, mut chart) = ramp();
        assert_eq!(chart.y_domain().unwrap().0..chart.y_domain().unwrap().1, 0.0..1000.0);
        // Anchor at value 250 (a quarter up the plot)
        let (_, ay) = ndc_of_world(&cam, 0.0, -20.0);
        assert!(chart.zoom_y(&view(&cam), 0.5, ay));
        let (lo, hi, step) = chart.y_domain().unwrap();
        assert!((lo - 125.0).abs() < 1e-3 && (hi - 625.0).abs() < 1e-3, "{lo} {hi}");
        assert_eq!(step, 100.0);
        assert!(chart.y_zoomed());
        let grid = chart.prepare_layers(&view(&cam)).underlay.unwrap().to_vec();
        // Baseline at the pinned domain bottom (plot edge), then one gridline per tick
        assert_eq!(grid.len(), 6);
        assert_eq!(grid[0].color, ChartFrameStyle::default().baseline_color);
        assert!((grid[0].p0_width[1] + 40.0).abs() < 1e-3);
        assert!(grid[1..].iter().all(|g| g.color == ChartFrameStyle::default().grid_color));
        let ys: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 1).map(|t| t.value).collect();
        assert_eq!(ys, vec![200.0, 300.0, 400.0, 500.0, 600.0]);
        // Pinned: the data range is reported and data updates do not re-derive the domain
        assert_eq!(chart.y_range_data(), Some((lo, hi)));
        chart.set_series_data(0, (0..10).map(|i| i as f32 * 500.0).collect(), None).unwrap();
        assert!((chart.y_domain().unwrap().1 - 625.0).abs() < 1e-3);
        // Series are scissored exactly to the plot while y is pinned
        assert!(chart.prepare_layers(&view(&cam)).series_clip.is_some());
        // Reset frees y (autoscale back to the data)
        chart.reset_zoom();
        assert!(!chart.y_zoomed());
        assert_eq!(chart.y_domain().unwrap().1, 5000.0, "autoscaled to 0..4500, nice end");
    }

    #[test]
    fn y_zoom_is_clamped_to_the_data_extent_limits() {
        let (cam, mut chart) = ramp();
        for _ in 0..200 {
            chart.zoom_y(&view(&cam), 0.5, 0.0);
        }
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert!(hi - lo >= 1000.0 * Y_ZOOM_MIN_SPAN * 0.99, "{lo} {hi}");
        for _ in 0..200 {
            chart.zoom_y(&view(&cam), 2.0, 0.0);
        }
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert!(hi - lo <= 1000.0 * Y_ZOOM_MAX_SPAN * 1.01);
    }

    #[test]
    fn box_zoom_maps_the_ndc_rectangle_to_x_and_y_ranges() {
        let (cam, mut chart) = ramp();
        // World x -40..40 = samples 250..750, world y -20..20 = values 250..750
        let a = ndc_of_world(&cam, -40.0, 20.0);
        let b = ndc_of_world(&cam, 40.0, -20.0);
        assert!(chart.brush_update(&view(&cam), BrushMode::XY, a, b), "live rectangle via the brush");
        assert!(chart.has_brush());
        assert!(chart.zoom_box(&view(&cam), a, b));
        assert!(!chart.has_brush(), "the live rectangle is gone");
        let (x0, x1) = chart.x_range_data().unwrap();
        assert!((x0 - 250.0).abs() < 0.5 && (x1 - 750.0).abs() < 0.5, "{x0} {x1}");
        let (y0, y1) = chart.y_range_data().unwrap();
        assert!((y0 - 250.0).abs() < 0.5 && (y1 - 750.0).abs() < 0.5, "{y0} {y1}");
        // Degenerate (zero-height) boxes do nothing
        let c = ndc_of_world(&cam, 0.0, 0.0);
        assert!(!chart.zoom_box(&view(&cam), c, (c.0 + 0.1, c.1)));
    }

    #[test]
    fn scatter_y_zoom_and_box_zoom() {
        let mut cam = flat_camera();
        let mut chart = ChartState::new_scatter(
            ScatterPoints { xs: vec![0.0, 10.0], ys: vec![0.0, 10.0], ..Default::default() },
            ScatterLayout { width: 160.0, height: 80.0, ..Default::default() },
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let (x0, x1) = chart.x_range_data().unwrap();
        assert!(chart.zoom_y(&view(&cam), 0.5, 0.0));
        assert_eq!(chart.x_range_data().unwrap(), (x0, x1), "x untouched");
        let (y0, y1) = chart.y_range_data().unwrap();
        assert!(y1 - y0 > 0.0);
        let a = ndc_of_world(&cam, -40.0, 10.0);
        let b = ndc_of_world(&cam, 0.0, -10.0);
        assert!(chart.zoom_box(&view(&cam), a, b));
        let (nx0, nx1) = chart.x_range_data().unwrap();
        assert!(nx1 - nx0 < x1 - x0);
    }

    #[test]
    fn history_undoes_and_redoes_and_is_capped() {
        let (cam, mut chart) = ramp();
        let v = view(&cam);
        let start = chart.zoom_state().unwrap();
        chart.zoom_history_push();
        chart.zoom_x(&v, 0.5, 0.0);
        let zoomed_x = chart.zoom_state().unwrap();
        chart.zoom_history_push();
        chart.zoom_y(&v, 0.5, 0.0);
        let zoomed_xy = chart.zoom_state().unwrap();
        assert_eq!(chart.zoom_history_len(), (2, 0));
        assert!(chart.zoom_undo());
        assert_eq!(chart.zoom_state().unwrap(), zoomed_x);
        assert!(!chart.y_zoomed(), "undo restores the autoscaled y");
        assert!(chart.zoom_undo());
        assert_eq!(chart.zoom_state().unwrap(), start);
        assert!(!chart.zoom_undo(), "nothing left");
        assert_eq!(chart.zoom_history_len(), (0, 2));
        assert!(chart.zoom_redo());
        assert!(chart.zoom_redo());
        assert_eq!(chart.zoom_state().unwrap(), zoomed_xy);
        assert!(!chart.zoom_redo());
        // A new gesture drops the redo steps
        assert!(chart.zoom_undo());
        chart.zoom_history_push();
        assert_eq!(chart.zoom_history_len().1, 0);
        // Capped
        for k in 0..(ZOOM_HISTORY_MAX + 20) {
            chart.zoom_history_push();
            chart.zoom_x(&v, if k % 2 == 0 { 0.9 } else { 1.05 }, 0.1);
        }
        assert_eq!(chart.zoom_history_len().0, ZOOM_HISTORY_MAX);
        chart.zoom_history_clear();
        assert_eq!(chart.zoom_history_len(), (0, 0));
        // A recorded gesture that did not move the view is trimmed
        chart.zoom_history_push();
        chart.zoom_history_trim();
        assert_eq!(chart.zoom_history_len(), (0, 0));
    }

    #[test]
    fn charts_without_zoom_have_no_history() {
        let mut chart = ChartState::new_pie(&[1.0, 2.0], PieOptions::default(), PieStyle::default());
        chart.zoom_history_push();
        assert_eq!(chart.zoom_history_len(), (0, 0));
        assert!(!chart.zoom_undo());
    }
}
