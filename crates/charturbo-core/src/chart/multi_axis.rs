//! Multiple y axes (3+): extra y axes beyond the left (0) / right (1) pair of line and combo
//! charts. Axis `k >= 2` has its own options, scale, breaks, data extent and domain (stored in
//! `LineChart::extra`), and emits ticks with axis code [`y_axis_code`]`(k)`; the SDK places its
//! labels (side / offset). Gridlines follow the left axis.

use super::{ChartKind, ChartState, LineYAxis};

/// Max y axes of one chart (left, right and 6 extra).
pub const MAX_Y_AXES: usize = 8;

/// First tick / scale axis code of the extra y axes: axis `k >= 2` is `EXTRA_Y_CODE + k`.
pub const EXTRA_Y_CODE: u8 = 16;

/// Tick / scale axis code of y axis `k` (0 = left -> 1, 1 = right -> 2, k >= 2 -> 16 + k).
#[inline]
pub const fn y_axis_code(k: u8) -> u8 {
    if k < 2 {
        k + 1
    } else {
        EXTRA_Y_CODE + k
    }
}

/// y axis index of a tick / scale axis code (inverse of [`y_axis_code`]).
#[inline]
pub const fn y_axis_of_code(code: u8) -> Option<u8> {
    match code {
        1 | 2 => Some(code - 1),
        c if c >= EXTRA_Y_CODE + 2 && c < EXTRA_Y_CODE + MAX_Y_AXES as u8 => Some(c - EXTRA_Y_CODE),
        _ => None,
    }
}

impl ChartState {
    /// Domain options of y axis `k` (0 = left, 1 = right, 2.. = extra; line and combo charts).
    pub fn set_y_axis_at(&mut self, k: u8, axis: LineYAxis) {
        let changed = match &mut self.kind {
            ChartKind::Line(l) => l.set_axis_options(k, axis),
            _ => return,
        };
        if changed {
            self.on_y_domain_changed();
        }
    }

    /// y domain `(min, max, tick step)` of y axis `k` in data units, when a series uses it.
    pub fn y_domain_at(&self, k: u8) -> Option<(f64, f64, f64)> {
        match &self.kind {
            ChartKind::Line(l) if k == 0 || (k < l.y_axis_count() && l.uses_axis(k)) => Some(l.domain_data(k)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::OrbitCamera;
    use crate::chart::axis_break::{AxisBreak, AxisBreaks};
    use crate::chart::scale::AxisScale;
    use crate::chart::{AxisTick, ChartView, ChartViewMode, LineLayout, LineSeries, LineXKind};
    use glam::Vec3;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn ticks(chart: &ChartState, axis: u8) -> Vec<AxisTick> {
        chart
            .axes()
            .ticks
            .iter()
            .copied()
            .filter(|t| t.axis == axis)
            .collect()
    }

    fn three_axes() -> (OrbitCamera, ChartState) {
        let ramp = |lo: f32, hi: f32| {
            (0..=10)
                .map(|i| lo + (hi - lo) * i as f32 / 10.0)
                .collect::<Vec<f32>>()
        };
        let series = [ramp(0.0, 10.0), ramp(0.0, 1000.0), ramp(-40.0, 40.0)]
            .into_iter()
            .map(|values| LineSeries {
                values,
                x: None,
                color: [1.0; 4],
                width_px: 2.0,
            })
            .collect();
        let layout = LineLayout {
            width: 160.0,
            height: 80.0,
            view: ChartViewMode::Flat,
            x_kind: LineXKind::Numeric,
        };
        let mut chart = ChartState::new_line(series, layout);
        chart.set_series_axes(&[0, 1, 2]);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    #[test]
    fn axis_codes_round_trip() {
        assert_eq!(
            (
                y_axis_code(0),
                y_axis_code(1),
                y_axis_code(2),
                y_axis_code(7)
            ),
            (1, 2, 18, 23)
        );
        for k in 0..MAX_Y_AXES as u8 {
            assert_eq!(y_axis_of_code(y_axis_code(k)), Some(k));
        }
        assert_eq!(y_axis_of_code(0), None);
        assert_eq!(y_axis_of_code(3), None);
        assert_eq!(y_axis_of_code(16 + MAX_Y_AXES as u8), None);
    }

    #[test]
    fn third_y_axis_has_its_own_domain_ticks_scale_and_breaks() {
        let (cam, mut chart) = three_axes();
        assert_eq!(chart.series_axes(), &[0, 1, 2]);
        assert_eq!(chart.y_domain_at(0), chart.y_domain());
        assert_eq!(chart.y_domain_at(1), chart.y2_domain());
        assert_eq!(
            chart.y_domain_at(2).map(|d| (d.0, d.1)),
            Some((-40.0, 40.0))
        );
        chart.prepare_layers(&view(&cam));
        let plot = chart.axes().plot_css;
        let t = ticks(&chart, y_axis_code(2));
        assert!(t.len() >= 3, "{t:?}");
        let top = t.iter().find(|t| t.value == 40.0).expect("tick at the top");
        let bottom = t
            .iter()
            .find(|t| t.value == -40.0)
            .expect("tick at the bottom");
        assert!(
            (top.y_css - plot[1]).abs() < 0.5 && (bottom.y_css - (plot[1] + plot[3])).abs() < 0.5
        );
        assert!(!ticks(&chart, 2).is_empty(), "right axis still ticks");
        // Own options, scale and breaks
        chart.set_y_axis_at(
            2,
            LineYAxis {
                min: Some(-100.0),
                max: Some(100.0),
                ..LineYAxis::default()
            },
        );
        assert_eq!(
            chart.y_domain_at(2).map(|d| (d.0, d.1)),
            Some((-100.0, 100.0))
        );
        assert_eq!(
            chart.y_domain_at(0).map(|d| (d.0, d.1)),
            Some((0.0, 10.0)),
            "left untouched"
        );
        chart.set_axis_scale(
            y_axis_code(2),
            AxisScale {
                reverse: true,
                ..AxisScale::LINEAR
            },
        );
        assert!(chart.axis_scale(y_axis_code(2)).unwrap().reverse);
        assert!(!chart.axis_scale(1).unwrap().reverse);
        let b = AxisBreaks::new(&[AxisBreak {
            start: 10.0,
            end: 40.0,
            gap: 2.0,
        }])
        .unwrap();
        assert_eq!(chart.set_axis_breaks(y_axis_code(2), b), Ok(true));
        assert_eq!(chart.axis_scale(y_axis_code(2)).unwrap().breaks, b);
        chart.prepare_layers(&view(&cam));
        let marks = &chart.axes().breaks;
        assert!(marks.len() == 1 && marks[0].axis == y_axis_code(2), "{marks:?}");
        // Unused extra axes report nothing; out-of-range axes are ignored
        assert_eq!(chart.y_domain_at(3), None);
        chart.set_series_axes(&[0, 1, 0]);
        assert_eq!(chart.y_domain_at(2), None);
        chart.set_series_axes(&[0, 1, 99]);
        assert_eq!(
            chart.series_axes(),
            &[0, 1, 0],
            "invalid axis falls back to the left"
        );
    }

    #[test]
    fn y_zoom_pins_every_axis_and_reset_frees_them() {
        let (cam, mut chart) = three_axes();
        let v = view(&cam);
        let mid = cam.project_to_ndc(Vec3::new(0.0, 0.0, 0.0)).unwrap();
        assert!(chart.zoom_y(&v, 0.5, mid.y));
        let (a, b, _) = chart.y_domain_at(2).unwrap();
        assert!(
            (a + 20.0).abs() < 1e-3 && (b - 20.0).abs() < 1e-3,
            "{a} {b}"
        );
        let (a, b, _) = chart.y_domain_at(1).unwrap();
        assert!(
            (a - 250.0).abs() < 1e-3 && (b - 750.0).abs() < 1e-3,
            "{a} {b}"
        );
        chart.reset_zoom();
        assert_eq!(
            chart.y_domain_at(2).map(|d| (d.0, d.1)),
            Some((-40.0, 40.0))
        );
    }

    #[test]
    fn combo_series_bind_to_a_third_axis_and_bars_take_breaks() {
        use crate::chart::{ComboLayout, ComboSeries, ComboSeriesKind};
        let mk = |kind, values: Vec<f32>, axis| ComboSeries { kind, values, axis, color: [1.0; 4], width_px: 2.0 };
        let series = vec![
            mk(ComboSeriesKind::Bar, vec![10.0, 20.0, 500.0], 0),
            mk(ComboSeriesKind::Line, vec![1.0, 2.0, 3.0], 1),
            mk(ComboSeriesKind::Line, vec![-40.0, 0.0, 40.0], 2),
        ];
        let mut chart = ChartState::new_combo(series, None, ComboLayout::default(), [LineYAxis::default(); 3]).unwrap();
        assert_eq!(chart.combo_series().unwrap()[2], (ComboSeriesKind::Line, 2));
        assert_eq!(chart.combo_y_domain(2), Some((-40.0, 40.0)));
        assert_eq!(chart.combo_y_domain(3), None);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.prepare_layers(&view(&cam));
        assert!(!ticks(&chart, y_axis_code(2)).is_empty());
        let b = AxisBreaks::new(&[AxisBreak { start: 30.0, end: 480.0, gap: 5.0 }]).unwrap();
        assert_eq!(chart.set_axis_breaks(1, b), Ok(true));
        assert_eq!(chart.axis_breaks(1), b);
        let ChartKind::Combo(c) = &chart.kind else { panic!() };
        let bars = c.bars.as_ref().unwrap();
        let h = c.line.layout.height;
        assert!((bars.segs[2].unwrap().y1 - h / 2.0).abs() < 1e-3, "500 tops the compressed axis");
        assert!((bars.segs[1].unwrap().y1 - (20.0 / 55.0 * h - h / 2.0)).abs() < 1e-3);
        chart.prepare_layers(&view(&cam));
        let vs: Vec<f64> = ticks(&chart, 1).iter().map(|t| t.value).collect();
        assert!(!vs.iter().any(|&v| v > 30.0 && v < 480.0), "{vs:?}");
    }

    #[test]
    fn combo_bar_only_axis_draws_its_break_marks() {
        use crate::chart::{ComboLayout, ComboSeries, ComboSeriesKind};
        let mk = |kind, values: Vec<f32>, axis| ComboSeries { kind, values, axis, color: [1.0; 4], width_px: 2.0 };
        // Bars alone on the right axis, the line on the left
        let series = vec![mk(ComboSeriesKind::Bar, vec![10.0, 20.0, 500.0], 1), mk(ComboSeriesKind::Line, vec![1.0, 2.0, 3.0], 0)];
        let mut chart = ChartState::new_combo(series, None, ComboLayout::default(), [LineYAxis::default(); 2]).unwrap();
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let b = AxisBreaks::new(&[AxisBreak { start: 30.0, end: 480.0, gap: 5.0 }]).unwrap();
        assert_eq!(chart.set_axis_breaks(y_axis_code(1), b), Ok(true));
        chart.prepare_layers(&view(&cam));
        let marks = &chart.axes().breaks;
        assert!(marks.len() == 1 && marks[0].axis == y_axis_code(1), "{marks:?}");
        // The span sits where the bars put 30 (30 / 55 up the compressed axis)
        let ChartKind::Combo(c) = &chart.kind else { panic!() };
        let h = c.line.layout.height;
        let span = chart.break_scratch[0];
        assert!((span.a - (30.0 / 55.0 * h - h / 2.0)).abs() < 1e-3, "{}", span.a);
    }
}
