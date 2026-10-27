//! Programmatic zoom ranges in data units: maps the normalized zoom windows of line / scatter
//! charts to and from the data domain behind them (line: series `x` or sample index; scatter:
//! its nice x / y domains).

use super::line::LineChart;
use super::area::AreaChart;
use super::{ChartKind, ChartState, ChartViewMode};

/// Data x at `t = 0` and `t = 1`: the explicit x domain, else sample indices of the longest
/// series (the x tick values in both cases). A lone sample sits at `t = 0.5`.
pub(super) fn line_x_domain(l: &LineChart) -> (f64, f64) {
    if l.has_x() {
        return (l.x_min, l.x_min + l.x_span);
    }
    match l.max_len() {
        0 | 1 => (-0.5, 0.5),
        n => (0.0, (n - 1) as f64),
    }
}

/// Data range covered by `window` (normalized) of `domain`.
fn range_of_window(domain: (f64, f64), window: (f32, f32)) -> (f64, f64) {
    let span = domain.1 - domain.0;
    (domain.0 + window.0 as f64 * span, domain.0 + window.1 as f64 * span)
}

/// Normalized window of the data range `[lo, hi]` (either order); `None` when it is not finite,
/// empty, or the domain is degenerate. The caller clamps it to the chart's zoom limits.
fn window_of_range(domain: (f64, f64), lo: f64, hi: f64) -> Option<(f32, f32)> {
    let (lo, hi) = (lo.min(hi), lo.max(hi));
    let span = domain.1 - domain.0;
    if !lo.is_finite() || !hi.is_finite() || hi <= lo || !span.is_finite() || span <= 0.0 {
        return None;
    }
    Some((((lo - domain.0) / span) as f32, ((hi - domain.0) / span) as f32))
}

impl ChartState {
    /// Visible x range in data units (line: series `x` or sample index; scatter: x values).
    /// `None` for bar charts.
    pub fn x_range_data(&self) -> Option<(f64, f64)> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                // Domains live in scale space (log10 units on a log x axis)
                let (a, b) = range_of_window(line_x_domain(l), l.window);
                Some((l.x_abs_to_data(a), l.x_abs_to_data(b)))
            }
            ChartKind::Scatter(s) => {
                let (a, b) = range_of_window(s.x_domain, s.window_x);
                Some((s.x_scale.inv(a), s.x_scale.inv(b)))
            }
            ChartKind::Candle(c) => Some(range_of_window(c.x_domain(), c.window)),
            ChartKind::Heatmap(h) => Some(h.range_x()),
            ChartKind::Bar(_) | ChartKind::Box(_) => None,
            ChartKind::Pie(_) => None,
            // Category index / x of the padded combo domain
            ChartKind::Combo(c) => Some(range_of_window(line_x_domain(&c.line), c.line.window)),
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => None,
            ChartKind::Hierarchy(_) | ChartKind::Scientific3D(_) => None,
        }
    }

    /// Visible y range in data units (2D line / area: the left y domain; scatter; heatmap).
    pub fn y_range_data(&self) -> Option<(f64, f64)> {
        match &self.kind {
            // Line / area: the left y domain (follows autoscale, or a manual y zoom, see zoom.rs)
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if l.layout.view == ChartViewMode::Flat => {
                let (lo, hi, _) = l.domain_data(0);
                Some((lo, hi))
            }
            ChartKind::Scatter(s) => {
                let (a, b) = range_of_window(s.y_domain, s.window_y);
                Some((s.y_scale.inv(a), s.y_scale.inv(b)))
            }
            ChartKind::Heatmap(h) => Some(h.range_y()),
            _ => None,
        }
    }

    /// Zooms the x axis to `[lo, hi]` in data units (2D line / scatter), clamped to the data
    /// domain and the zoom limit like wheel zoom. Returns true when the window moved.
    pub fn set_x_range_data(&mut self, lo: f64, hi: f64) -> bool {
        let changed = match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. })
                if l.layout.view == ChartViewMode::Flat =>
            {
                let Some((w0, w1)) = window_of_range(line_x_domain(l), l.x_data_to_abs(lo), l.x_data_to_abs(hi)) else {
                    return false;
                };
                let before = l.window;
                l.set_window(w0, w1);
                l.window != before
            }
            ChartKind::Scatter(s) => {
                let Some(wx) = window_of_range(s.x_domain, s.x_scale.fwd(lo), s.x_scale.fwd(hi)) else {
                    return false;
                };
                let before = (s.window_x, s.window_y);
                s.set_window(wx, s.window_y);
                (s.window_x, s.window_y) != before
            }
            ChartKind::Candle(c) => {
                let Some((w0, w1)) = window_of_range(c.x_domain(), lo, hi) else {
                    return false;
                };
                let before = c.window;
                c.set_window(w0, w1);
                c.window != before
            }
            ChartKind::Heatmap(h) => h.set_range_x(lo, hi),
            ChartKind::Combo(c) => {
                let l = &mut c.line;
                let Some((w0, w1)) = window_of_range(line_x_domain(l), lo, hi) else {
                    return false;
                };
                let before = l.window;
                l.set_window(w0, w1);
                l.window != before
            }
            _ => false,
        };
        if changed {
            self.on_window_changed();
        }
        changed
    }

    /// Zooms the y axis of a scatter chart to `[lo, hi]` in data units (clamped like
    /// `set_x_range_data`); line / area charts pin their y domain there (zoom.rs). Returns true
    /// when the view moved.
    pub fn set_y_range_data(&mut self, lo: f64, hi: f64) -> bool {
        // Line / area: pins the y domain (zoom.rs)
        if matches!(self.kind, ChartKind::Line(_) | ChartKind::Area(_)) {
            return self.set_line_y_range(lo, hi);
        }
        if let ChartKind::Heatmap(h) = &mut self.kind {
            let changed = h.set_range_y(lo, hi);
            if changed {
                self.on_window_changed();
            }
            return changed;
        }
        let ChartKind::Scatter(s) = &mut self.kind else {
            return false;
        };
        let Some(wy) = window_of_range(s.y_domain, s.y_scale.fwd(lo), s.y_scale.fwd(hi)) else {
            return false;
        };
        let before = (s.window_x, s.window_y);
        s.set_window(s.window_x, wy);
        let changed = (s.window_x, s.window_y) != before;
        if changed {
            self.on_window_changed();
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::{BarLayout, LineLayout, LineSeries, LineXKind, ScatterLayout, ScatterPoints};
    use crate::scene::SceneWorld;

    fn line(values: Vec<Vec<f32>>, xs: Option<Vec<Vec<f64>>>, view: ChartViewMode) -> ChartState {
        let mut xs = xs.map(|v| v.into_iter());
        let series = values
            .into_iter()
            .map(|values| LineSeries {
                values,
                x: xs.as_mut().and_then(|it| it.next()),
                color: [1.0; 4],
                width_px: 2.0,
            })
            .collect();
        ChartState::new_line(
            series,
            LineLayout { width: 160.0, height: 80.0, view, x_kind: LineXKind::Numeric },
        )
    }

    fn scatter() -> ChartState {
        let points = ScatterPoints {
            xs: vec![0.0, 50.0, 100.0],
            ys: vec![-0.5, 1.0, 2.5],
            sizes: Vec::new(),
            series: Vec::new(),
            colors: Vec::new(),
            series_colors: vec![[1.0; 4]],
        };
        ChartState::new_scatter(points, ScatterLayout::default())
    }

    fn close(a: (f64, f64), b: (f64, f64), eps: f64) -> bool {
        (a.0 - b.0).abs() <= eps && (a.1 - b.1).abs() <= eps
    }

    #[test]
    fn line_index_range_round_trips_through_the_window() {
        // Longest series: 101 samples -> indices 0..100 (the shorter one does not matter)
        let mut c = line(vec![vec![0.0; 101], vec![1.0; 11]], None, ChartViewMode::Flat);
        assert_eq!(c.x_range_data(), Some((0.0, 100.0)));
        assert_eq!(c.y_range_data(), Some((0.0, 1.0)), "line y range = the y domain");
        assert!(c.set_x_range_data(60.0, 20.0), "either order");
        assert!(close(c.x_range_data().unwrap(), (20.0, 60.0), 1e-4));
        assert!(!c.set_x_range_data(20.0, 60.0), "same window: no change");
        c.reset_zoom();
        assert_eq!(c.x_range_data(), Some((0.0, 100.0)));
    }

    #[test]
    fn line_explicit_x_keeps_epoch_precision() {
        let t0 = 1.7e12;
        let xs: Vec<f64> = (0..1000).map(|i| t0 + i as f64 * 60_000.0).collect();
        let last = *xs.last().unwrap();
        let mut c = line(vec![vec![0.0; 1000]], Some(vec![xs]), ChartViewMode::Flat);
        assert_eq!(c.x_range_data(), Some((t0, last)));
        let (lo, hi) = (t0 + 3_600_000.0, t0 + 7_200_000.0);
        assert!(c.set_x_range_data(lo, hi));
        // f32 window over a ~60M ms span: well under a second of error
        assert!(close(c.x_range_data().unwrap(), (lo, hi), 1000.0));
    }

    #[test]
    fn line_range_is_clamped_and_rejects_bad_input() {
        let mut c = line(vec![vec![0.0; 101]], None, ChartViewMode::Flat);
        // Past the data: clamped to the full domain (already shown -> no change)
        assert!(!c.set_x_range_data(-50.0, 500.0));
        assert_eq!(c.x_range_data(), Some((0.0, 100.0)));
        // Narrower than the zoom limit (8 samples): widened to it
        assert!(c.set_x_range_data(10.0, 10.5));
        let (lo, hi) = c.x_range_data().unwrap();
        assert!((hi - lo - 8.0).abs() < 1e-3 && (lo - 10.0).abs() < 1e-3);
        for (lo, hi) in [(f64::NAN, 5.0), (3.0, f64::INFINITY), (4.0, 4.0)] {
            assert!(!c.set_x_range_data(lo, hi));
        }
        // 2.5D views do not zoom (like wheel zoom)
        let mut depth = line(vec![vec![0.0; 101]], None, ChartViewMode::Depth);
        assert!(!depth.set_x_range_data(10.0, 20.0));
        assert_eq!(depth.x_range_data(), Some((0.0, 100.0)));
    }

    #[test]
    fn single_sample_line_has_a_centred_unit_domain() {
        let c = line(vec![vec![5.0]], None, ChartViewMode::Flat);
        assert_eq!(c.x_range_data(), Some((-0.5, 0.5)));
    }

    #[test]
    fn scatter_axes_are_set_independently() {
        let mut c = scatter();
        let (x_full, y_full) = (c.x_range_data().unwrap(), c.y_range_data().unwrap());
        assert!(c.set_x_range_data(x_full.0 + 10.0, x_full.0 + 30.0));
        assert!(close(c.x_range_data().unwrap(), (x_full.0 + 10.0, x_full.0 + 30.0), 1e-3));
        assert_eq!(c.y_range_data(), Some(y_full), "y untouched");
        assert!(c.set_y_range_data(0.0, 1.0));
        assert!(close(c.y_range_data().unwrap(), (0.0, 1.0), 1e-5));
        assert!(close(c.x_range_data().unwrap(), (x_full.0 + 10.0, x_full.0 + 30.0), 1e-3));
        c.reset_zoom();
        assert_eq!((c.x_range_data(), c.y_range_data()), (Some(x_full), Some(y_full)));
    }

    #[test]
    fn bars_have_no_data_range() {
        let mut scene = SceneWorld::new();
        let layout = BarLayout { width: 100.0, max_height: 50.0, bar_width: 0.0, corner_radius_px: 4.0, view: ChartViewMode::Flat };
        let mut c = ChartState::new_bar(vec![1.0, 2.0], vec![[1.0; 4]; 2], layout, &mut scene);
        assert_eq!((c.x_range_data(), c.y_range_data()), (None, None));
        assert!(!c.set_x_range_data(0.0, 1.0) && !c.set_y_range_data(0.0, 1.0));
    }

    #[test]
    fn window_mapping_helpers() {
        assert_eq!(window_of_range((10.0, 20.0), 12.5, 15.0), Some((0.25, 0.5)));
        assert_eq!(window_of_range((0.0, 0.0), 0.0, 1.0), None);
        assert_eq!(range_of_window((10.0, 20.0), (0.25, 0.5)), (12.5, 15.0));
    }
}
