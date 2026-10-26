//! Axis scales: linear / log10 value mapping, inverted (reversed) axes, tick-count hints, log
//! ticks and log nice domains, plus the `ChartState` scale / dual-y-axis API.
//!
//! Charts keep their domains in *scale space* (`u = fwd(v)`: the value itself, or `log10(v)`)
//! and map `u` linearly to world units, so zoom windows, M4 decimation, hit-testing and GPU
//! transforms stay linear. The transform is applied on the CPU when positions are built (line
//! strokes per LOD rebuild, scatter points once per data set / scale change). log10 is strictly
//! increasing, so per-bucket min / max picks (M4) are the same samples before and after it.
//! Non-positive values have no log: lines leave a gap there, scatter skips the point.

use super::area::AreaChart;
use super::ticks::{nice_step, ticks_between};
use super::{ChartKind, ChartState, LineYAxis};

/// Value scale of one axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ScaleType {
    #[default]
    Linear,
    /// log10; non-positive values are not drawn
    Log,
}

impl ScaleType {
    /// 0 = linear, 1 = log
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Log
        } else {
            Self::Linear
        }
    }
}

/// Scale options of one axis.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct AxisScale {
    pub kind: ScaleType,
    /// Inverted axis: values grow downward (y) / leftward (x)
    pub reverse: bool,
    /// Target tick count (0 = chart default: frame `grid_rows` for y, ~1 per 90 px for x)
    pub tick_count: u32,
}

impl AxisScale {
    pub const LINEAR: Self = Self { kind: ScaleType::Linear, reverse: false, tick_count: 0 };

    #[inline]
    pub fn is_log(&self) -> bool {
        self.kind == ScaleType::Log
    }

    /// Value -> scale space (`log10`; NaN for non-positive values on a log scale).
    #[inline]
    pub fn fwd(&self, v: f64) -> f64 {
        log_or_identity(self.is_log(), v)
    }

    #[inline]
    pub fn fwd32(&self, v: f32) -> f32 {
        if self.is_log() {
            if v > 0.0 {
                v.log10()
            } else {
                f32::NAN
            }
        } else {
            v
        }
    }

    /// Scale space -> value.
    #[inline]
    pub fn inv(&self, u: f64) -> f64 {
        if self.is_log() {
            10f64.powf(u)
        } else {
            u
        }
    }

    /// World direction of increasing values (-1 = reversed).
    #[inline]
    pub fn sign(&self) -> f32 {
        if self.reverse {
            -1.0
        } else {
            1.0
        }
    }

    /// Tick target: the hint, else `default`.
    #[inline]
    pub fn target(&self, default: u32) -> u32 {
        if self.tick_count > 0 {
            self.tick_count.min(64)
        } else {
            default
        }
    }

    /// Value is drawable on this scale (finite, and positive on a log scale).
    #[inline]
    pub fn drawable(&self, v: f32) -> bool {
        v.is_finite() && (!self.is_log() || v > 0.0)
    }

    /// Tick values (data units) of the scale-space range `[lo_u, hi_u]`: multiples of `step` on
    /// a linear scale, `log_ticks` on a log scale.
    pub fn ticks(&self, lo_u: f64, hi_u: f64, step: f64, target: u32) -> Vec<f64> {
        if self.is_log() {
            log_ticks(10f64.powf(lo_u), 10f64.powf(hi_u), target)
        } else {
            ticks_between(lo_u, hi_u, step)
        }
    }
}

/// `log10(v)` when `log` (NaN for `v <= 0`, but -inf stays -inf so open bands reach the plot
/// edge), else `v`.
#[inline]
pub(crate) fn log_or_identity(log: bool, v: f64) -> f64 {
    if !log {
        v
    } else if v > 0.0 || v == f64::INFINITY {
        v.log10()
    } else if v == f64::NEG_INFINITY {
        v
    } else {
        f64::NAN
    }
}

/// Positive `[lo, hi]` expanded outward to powers of ten; a single value / empty decade gets one
/// decade on each side. Non-positive or non-finite input falls back to `[1, 10]`.
pub fn log_nice_domain(lo: f64, hi: f64) -> (f64, f64) {
    if !(lo > 0.0 && hi.is_finite() && lo.is_finite()) {
        return (1.0, 10.0);
    }
    let hi = hi.max(lo);
    // Extents come from f32 data (0.01f32 = 0.0099999998): snap within 1e-6 decades
    let e0 = (lo.log10() + 1e-6).floor();
    let mut e1 = (hi.log10() - 1e-6).ceil();
    if e1 <= e0 {
        e1 = e0 + 1.0;
    }
    (10f64.powi(e0 as i32), 10f64.powi(e1 as i32))
}

/// Tick values in `[lo, hi]` (both > 0) for about `target` ticks on a log10 axis: powers of ten
/// (every k-th decade when there are many), then 1 / 2 / 5 and 1..9 multiples per decade when the
/// range is small, and plain linear nice ticks inside a single short decade.
pub fn log_ticks(lo: f64, hi: f64, target: u32) -> Vec<f64> {
    if !(lo > 0.0 && hi.is_finite() && hi >= lo) {
        return Vec::new();
    }
    let target = target.max(2) as usize;
    let (e0, e1) = ((lo.log10() - 1e-9).floor() as i32, (hi.log10() + 1e-9).ceil() as i32);
    // Domains round-trip through f32: allow a little slack at the ends
    let (min, max) = (lo * (1.0 - 1e-6), hi * (1.0 + 1e-6));
    let gen = |mults: &[f64], every: i32| -> Vec<f64> {
        let mut out = Vec::new();
        for e in (e0..=e1.min(e0 + 640)).filter(|e| e.rem_euclid(every) == 0) {
            let p = 10f64.powi(e);
            for &m in mults {
                let v = snap(m * p, e);
                if v >= min && v <= max {
                    out.push(v);
                }
            }
        }
        out
    };
    let decades = gen(&[1.0], 1);
    if decades.len() > target {
        let every = decades.len().div_ceil(target) as i32;
        return gen(&[1.0], every);
    }
    // A log axis reads well with a few decades: 1 / 2 / 5 multiples only for short ranges
    let enough = (target - 1).clamp(2, 4);
    if decades.len() >= enough {
        return decades;
    }
    let fine = gen(&[1.0, 2.0, 5.0], 1);
    if fine.len() >= enough {
        return fine;
    }
    let finest = gen(&[1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0], 1);
    if finest.len() >= 2 {
        return if finest.len() > 3 * target && fine.len() >= 2 { fine } else { finest };
    }
    ticks_between(lo, hi, nice_step(hi - lo, target as u32))
}

/// Rounds float noise off `m * 10^e` (3 * 0.1 -> 0.3).
#[inline]
fn snap(v: f64, e: i32) -> f64 {
    if e >= 0 {
        return v;
    }
    let f = 10f64.powi(-e + 2);
    (v * f).round() / f
}

/// y domain `(lo_u, hi_u, step)` in scale space for the data extent `[e0, e1]` (data units;
/// positive part only for log) under `axis` options. Log: fixed ends must be positive (others
/// are ignored), data ends expand to powers of ten when `nice`; `step` is 0 (decade ticks).
pub(crate) fn log_y_domain(e0: f64, e1: f64, axis: &LineYAxis) -> (f64, f64, f64) {
    let pos = |v: Option<f64>| v.filter(|v| *v > 0.0 && v.is_finite());
    let (fmin, fmax) = (pos(axis.min), pos(axis.max));
    let (e0, e1) = if e0 > 0.0 && e1 >= e0 && e1.is_finite() { (e0, e1) } else { (1.0, 10.0) };
    let mut lo = fmin.unwrap_or(e0);
    let mut hi = fmax.unwrap_or(e1);
    if hi <= lo {
        match (fmin.is_some(), fmax.is_some()) {
            (true, false) => hi = lo * 10.0,
            (false, true) => lo = hi / 10.0,
            _ => {
                let c = (lo * hi).sqrt();
                (lo, hi) = (c / 10f64.sqrt(), c * 10f64.sqrt());
            }
        }
    }
    if axis.nice {
        let (n0, n1) = log_nice_domain(lo, hi);
        if fmin.is_none() {
            lo = n0;
        }
        if fmax.is_none() {
            hi = n1;
        }
    }
    (lo.log10(), hi.log10(), 0.0)
}

// -----------------------------------------------------------------------------
// ChartState API
// -----------------------------------------------------------------------------

impl ChartState {
    /// Sets the scale of one axis: 0 = x (line: numeric x only for log; scatter), 1 = y (left),
    /// 2 = right y (line charts). Log on an axis without positive values (index / time x, x <= 0)
    /// keeps it linear; reverse and the tick hint still apply. Resets the zoom of a changed axis
    /// mapping and drops the hover (positions moved).
    pub fn set_axis_scale(&mut self, axis: u8, scale: AxisScale) {
        let changed = match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => match axis {
                0 => l.set_x_scale(scale),
                1 | 2 => l.set_y_scale(axis - 1, scale),
                _ => false,
            },
            ChartKind::Scatter(s) if axis <= 1 => {
                let changed = s.set_scale(axis, scale);
                self.dirty.points |= changed;
                self.dirty.point_style |= changed;
                changed
            }
            _ => false,
        };
        if changed {
            self.hover = None;
            self.lod = None;
            self.dirty.overlay = true;
            // Strip x layout (log x) and y mapping follow the scales
            self.navigator.invalidate();
            self.on_y_domain_changed();
        }
    }

    /// Scale of one axis (see `set_axis_scale`); `None` without a line / area / scatter chart.
    pub fn axis_scale(&self, axis: u8) -> Option<AxisScale> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => match axis {
                0 => Some(l.x_scale),
                1 => Some(l.y_scale),
                2 => Some(l.right.scale),
                _ => None,
            },
            ChartKind::Scatter(s) => match axis {
                0 => Some(s.x_scale),
                1 => Some(s.y_scale),
                _ => None,
            },
            ChartKind::Bar(_) | ChartKind::Candle(_) | ChartKind::Heatmap(_) | ChartKind::Box(_) => None,
            ChartKind::Pie(_) => None,
            // Combo axes are linear (no scale options)
            ChartKind::Combo(_) => None,
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => None,
            ChartKind::Hierarchy(_) => None,
        }
    }

    /// Assigns line series to y axes (`0` = left, `1` = right; missing entries = left). The right
    /// axis has its own domain / autoscale / scale / ticks; gridlines follow the left axis.
    pub fn set_series_axes(&mut self, axes: &[u8]) {
        if let ChartKind::Line(l) = &mut self.kind {
            if l.set_series_axes(axes) {
                self.hover = None;
                self.navigator.invalidate();
                self.on_y_domain_changed();
            }
        }
    }

    /// y axis of each line series (0 = left, 1 = right); empty for other kinds.
    pub fn series_axes(&self) -> &[u8] {
        match &self.kind {
            ChartKind::Line(l) => &l.series_axis,
            _ => &[],
        }
    }

    /// Domain options of the right y axis (like `set_y_axis` for the left one).
    pub fn set_y2_axis(&mut self, axis: LineYAxis) {
        if let ChartKind::Line(l) = &mut self.kind {
            if l.set_right_axis(axis) {
                self.on_y_domain_changed();
            }
        }
    }

    /// Right y domain `(min, max, tick step)` in data units (step 0 on a log scale), when any
    /// series uses the right axis.
    pub fn y2_domain(&self) -> Option<(f64, f64, f64)> {
        match &self.kind {
            ChartKind::Line(l) if l.has_right() => Some(l.domain_data(1)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::OrbitCamera;
    use crate::chart::{
        AxisTick, ChartView, ChartViewMode, LineLayout, LineSeries, LineXKind, ScatterLayout, ScatterPoints,
        YAutoscale,
    };
    use glam::Vec3;

    fn close(a: &[f64], b: &[f64]) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() <= 1e-9 * y.abs().max(1.0))
    }

    #[test]
    fn scale_maps_values_and_round_trips() {
        let lin = AxisScale::LINEAR;
        let log = AxisScale { kind: ScaleType::Log, ..lin };
        assert_eq!(lin.fwd(-3.0), -3.0);
        assert_eq!(log.fwd(1000.0), 3.0);
        assert!(log.fwd(0.0).is_nan() && log.fwd(-1.0).is_nan());
        assert!(log.fwd32(0.0).is_nan());
        assert!((log.inv(log.fwd(42.0)) - 42.0).abs() < 1e-9);
        assert!(log.drawable(0.5) && !log.drawable(0.0) && !log.drawable(f32::NAN) && lin.drawable(-1.0));
        assert_eq!(AxisScale { reverse: true, ..lin }.sign(), -1.0);
        assert_eq!(lin.target(5), 5);
        assert_eq!(AxisScale { tick_count: 9, ..lin }.target(5), 9);
        // Open band ends survive the log
        assert_eq!(log_or_identity(true, f64::NEG_INFINITY), f64::NEG_INFINITY);
        assert_eq!(log_or_identity(true, f64::INFINITY), f64::INFINITY);
        assert_eq!(ScaleType::from_u8(1), ScaleType::Log);
        assert_eq!(ScaleType::from_u8(7), ScaleType::Linear);
    }

    #[test]
    fn log_nice_domain_snaps_to_decades() {
        assert_eq!(log_nice_domain(3.0, 470.0), (1.0, 1000.0));
        assert_eq!(log_nice_domain(1.0, 100.0), (1.0, 100.0), "powers stay");
        assert_eq!(log_nice_domain(20.0, 80.0), (10.0, 100.0));
        assert_eq!(log_nice_domain(10.0, 10.0), (10.0, 100.0), "single value: one decade");
        let (lo, hi) = log_nice_domain(0.004, 0.2);
        assert!((lo - 0.001).abs() < 1e-15 && (hi - 1.0).abs() < 1e-12);
        assert_eq!(log_nice_domain(0.0, 5.0), (1.0, 10.0), "non-positive fallback");
    }

    #[test]
    fn log_ticks_pick_decades_then_minor_multiples() {
        // Many decades: powers of ten only
        assert!(close(&log_ticks(1.0, 1e4, 5), &[1.0, 10.0, 100.0, 1e3, 1e4]));
        // Too many decades: every k-th
        let wide = log_ticks(1e-10, 1e10, 5);
        assert!(wide.len() <= 6 && wide.contains(&1.0), "{wide:?}");
        assert!(wide.windows(2).all(|w| (w[1] / w[0] - wide[1] / wide[0]).abs() < 1e-6 * w[1] / w[0]));
        // Two decades: 1 / 2 / 5 multiples
        assert!(close(&log_ticks(1.0, 100.0, 5), &[1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0]));
        // Inside one decade: 1..9 multiples, snapped (no 0.30000000000000004)
        assert!(close(&log_ticks(0.2, 0.8, 5), &[0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]));
        assert_eq!(log_ticks(0.2, 0.8, 5)[1], 0.3);
        // Narrower than one multiple: linear nice ticks
        let narrow = log_ticks(3.1, 3.9, 5);
        assert!(narrow.len() >= 2 && narrow.iter().all(|&v| (3.1..=3.9).contains(&v)), "{narrow:?}");
        assert!(log_ticks(0.0, 10.0, 5).is_empty() && log_ticks(5.0, 1.0, 5).is_empty());
    }

    #[test]
    fn log_y_domain_respects_fixed_ends_and_nice() {
        let axis = LineYAxis::default();
        assert_eq!(log_y_domain(3.0, 470.0, &axis), (0.0, 3.0, 0.0));
        let (lo, hi, _) = log_y_domain(3.0, 470.0, &LineYAxis { nice: false, ..axis });
        assert!((lo - 3f64.log10()).abs() < 1e-12 && (hi - 470f64.log10()).abs() < 1e-12);
        // Fixed positive min kept exactly; non-positive fixed ends are ignored
        let (lo, hi, _) = log_y_domain(3.0, 470.0, &LineYAxis { min: Some(2.0), ..axis });
        assert!((lo - 2f64.log10()).abs() < 1e-12 && hi == 3.0);
        assert_eq!(log_y_domain(3.0, 470.0, &LineYAxis { min: Some(0.0), ..axis }).0, 0.0);
        // No positive data: [1, 10]
        assert_eq!(log_y_domain(f64::INFINITY, f64::NEG_INFINITY, &axis), (0.0, 1.0, 0.0));
    }

    // ---- chart integration -------------------------------------------------

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    const LAYOUT: LineLayout = LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric };

    fn line(values: Vec<Vec<f32>>, x: Option<Vec<f64>>) -> (OrbitCamera, ChartState) {
        let series = values
            .into_iter()
            .map(|values| LineSeries { values, x: x.clone(), color: [1.0; 4], width_px: 2.0 })
            .collect();
        let chart = ChartState::new_line(series, LAYOUT);
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn ticks(chart: &ChartState, axis: u8) -> Vec<AxisTick> {
        chart.axes().ticks.iter().copied().filter(|t| t.axis == axis).collect()
    }

    const LOG: AxisScale = AxisScale { kind: ScaleType::Log, reverse: false, tick_count: 0 };

    #[test]
    fn log_y_line_maps_decades_evenly_and_gaps_non_positive_values() {
        let (cam, mut chart) = line(vec![vec![1.0, 10.0, 0.0, 100.0, 1000.0, -5.0, 10_000.0]], None);
        chart.set_axis_scale(1, LOG);
        assert_eq!(chart.y_domain().unwrap(), (1.0, 10_000.0, 0.0));
        let segs = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        // 1 -> 10 is drawn; 0 and -5 break the line: 10 -> 0, 0 -> 100, 1000 -> -5, -5 -> 1e4 skipped
        assert_eq!(segs.len(), 2, "{segs:?}");
        assert!(segs.iter().all(|s| s.p0_width[1].is_finite() && s.p1_pad[1].is_finite()));
        // Each decade is a quarter of the plot height
        let dy = segs[0].p1_pad[1] - segs[0].p0_width[1];
        assert!((dy - 20.0).abs() < 1e-3, "{dy}");
        let ys: Vec<f64> = ticks(&chart, 1).iter().map(|t| t.value).collect();
        assert!(close(&ys, &[1.0, 10.0, 100.0, 1000.0, 10_000.0]), "{ys:?}");
        let tick_y: Vec<f32> = ticks(&chart, 1).iter().map(|t| t.y_css).collect();
        let gaps: Vec<f32> = tick_y.windows(2).map(|w| w[0] - w[1]).collect();
        assert!(gaps.iter().all(|g| (g - gaps[0]).abs() < 0.5 && *g > 0.0), "even decades: {gaps:?}");
        // Hover skips the non-positive samples
        let mut scene = crate::scene::SceneWorld::new();
        let c = cam.project_to_ndc(chart.sample(2).unwrap().3.with_y(0.0)).unwrap();
        let hit = chart.hover_at(&view(&cam), &mut scene, (c.x, c.y));
        assert!(hit.is_none_or(|h| h.items.iter().all(|i| i.value > 0.0)));
        // Back to linear restores the old mapping
        chart.set_axis_scale(1, AxisScale::LINEAR);
        assert_eq!(chart.y_domain().unwrap().0, -2000.0);
    }

    #[test]
    fn m4_keeps_extremes_under_log_and_reverse() {
        let mut values: Vec<f32> = (0..200_000).map(|i| 10.0 + (i as f32 * 0.01).sin() * 5.0).collect();
        values[77_777] = 1e5;
        values[123_456] = 0.01;
        let (cam, mut chart) = line(vec![values], None);
        chart.set_axis_scale(1, AxisScale { reverse: true, ..LOG });
        let segs = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        assert!(segs.len() < 4 * 1600 * 2, "decimated: {}", segs.len());
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert!((lo - 0.01).abs() < 1e-9 && (hi - 1e5).abs() < 1e-6, "{lo} {hi}");
        let ys = || segs.iter().flat_map(|s| [s.p0_width[1], s.p1_pad[1]]);
        // Reversed: the max sits at the bottom edge, the min at the top
        let min_y = ys().fold(f32::MAX, f32::min);
        let max_y = ys().fold(f32::MIN, f32::max);
        assert!((min_y + 40.0).abs() < 1e-3 && (max_y - 40.0).abs() < 1e-3, "{min_y} {max_y}");
    }

    #[test]
    fn reversed_and_tick_hinted_axes() {
        let (cam, mut chart) = line(vec![(0..=100).map(|i| i as f32).collect()], None);
        chart.set_axis_scale(1, AxisScale { reverse: true, tick_count: 10, ..AxisScale::LINEAR });
        chart.prepare_layers(&view(&cam));
        let ys = ticks(&chart, 1);
        assert_eq!(ys.len(), 11, "tick hint 10 -> step 10");
        assert!(ys.windows(2).all(|w| w[1].y_css > w[0].y_css), "reversed: larger values lower on screen");
        // x reversed: index 0 on the right, ticks run right to left
        chart.set_axis_scale(0, AxisScale { reverse: true, tick_count: 4, ..AxisScale::LINEAR });
        chart.prepare_layers(&view(&cam));
        let xs = ticks(&chart, 0);
        assert!(xs.len() >= 3 && xs.len() <= 6, "{xs:?}");
        assert!(xs.windows(2).all(|w| w[1].x_css < w[0].x_css));
        let p0 = chart.sample(0).unwrap().3;
        assert!((p0.x - 80.0).abs() < 1e-3, "first sample on the right: {p0}");
        // Zoom anchors and pan follow the pointer on the inverted axis
        let v = view(&cam);
        let right = cam.project_to_ndc(Vec3::new(60.0, 0.0, 0.0)).unwrap();
        chart.zoom_x(&v, 0.25, right.x);
        let (w0, w1) = chart.x_window();
        assert!((0.0..0.125).contains(&w0) && w1 < 0.5, "zoomed into the start of the data: {w0} {w1}");
        // Content follows the pointer: dragging right on a reversed axis brings in larger x
        chart.reset_zoom();
        chart.zoom_x(&v, 0.5, 0.0);
        let before = chart.x_window();
        chart.pan_x(&v, 0.2);
        assert!(chart.x_window().0 > before.0, "{:?} -> {:?}", before, chart.x_window());
    }

    #[test]
    fn log_numeric_x_line_ticks_decimates_and_round_trips_x() {
        let x: Vec<f64> = (0..=1000).map(|i| 10f64.powf(i as f64 / 250.0)).collect(); // 1 .. 1e4
        let values: Vec<f32> = (0..=1000).map(|i| i as f32).collect();
        let (cam, mut chart) = line(vec![values], Some(x.clone()));
        chart.set_axis_scale(0, LOG);
        assert!(chart.axis_scale(0).unwrap().is_log());
        // Even in log x: samples are evenly spaced on screen
        let p = |i: u32| chart.sample(i).unwrap().3.x;
        assert!(((p(250) - p(0)) - (p(1000) - p(750))).abs() < 1e-3);
        // Data x survives the internal log storage
        let back = chart.line_x(0).unwrap();
        assert!(back.iter().zip(&x).all(|(a, b)| (a - b).abs() <= 1e-9 * b));
        assert!((chart.sample_x(500).unwrap() - 100.0).abs() < 1e-9);
        chart.prepare_layers(&view(&cam));
        let xs: Vec<f64> = ticks(&chart, 0).iter().map(|t| t.value).collect();
        assert!(close(&xs, &[1.0, 10.0, 100.0, 1000.0, 10_000.0]), "{xs:?}");
        // Ranges are in data units
        let (lo, hi) = chart.x_range_data().unwrap();
        assert!((lo - 1.0).abs() < 1e-9 && (hi - 1e4).abs() < 1e-6);
        assert!(chart.set_x_range_data(10.0, 100.0));
        let (lo, hi) = chart.x_range_data().unwrap();
        assert!((lo - 10.0).abs() < 1e-3 && (hi - 100.0).abs() < 1e-2, "{lo} {hi}");
        // Appends are validated / stored in log space
        assert!(chart.append_series_data(0, &[1.0], Some(&[2e4]), 0).is_ok());
        assert!((chart.line_x(0).unwrap().last().unwrap() - 2e4).abs() < 1e-6);
        assert!(chart.append_series_data(0, &[1.0], Some(&[1.5e4]), 0).is_err(), "x must not go back");
        // Non-positive x keeps the x axis linear
        let (_, mut lin) = line(vec![vec![1.0, 2.0, 3.0]], Some(vec![0.0, 1.0, 2.0]));
        lin.set_axis_scale(0, LOG);
        assert!(!lin.axis_scale(0).unwrap().is_log());
    }

    #[test]
    fn dual_axis_series_use_their_own_domain_and_ticks() {
        let left: Vec<f32> = (0..100).map(|i| i as f32 / 10.0).collect(); // 0 .. 9.9
        let right: Vec<f32> = (0..100).map(|i| 1000.0 + i as f32 * 20.0).collect(); // 1000 .. 2980
        let (cam, mut chart) = line(vec![left, right], None);
        assert!(chart.y2_domain().is_none());
        chart.set_series_axes(&[0, 1]);
        assert_eq!(chart.series_axes(), &[0, 1]);
        assert_eq!(chart.y_domain().unwrap(), (0.0, 10.0, 2.0), "left ignores the right series");
        assert_eq!(chart.y2_domain().unwrap(), (1000.0, 3000.0, 500.0));
        let v = view(&cam);
        chart.prepare_layers(&v);
        let (lt, rt) = (ticks(&chart, 1), ticks(&chart, 2));
        let plot = chart.axes().plot_css;
        assert_eq!(rt.iter().map(|t| t.value).collect::<Vec<_>>(), vec![1000.0, 1500.0, 2000.0, 2500.0, 3000.0]);
        assert!(rt.iter().all(|t| (t.x_css - (plot[0] + plot[2])).abs() < 1e-3), "right edge");
        assert!(lt.iter().all(|t| (t.x_css - plot[0]).abs() < 1e-3), "left edge");
        // Both series start on the plot bottom, each in its own domain
        assert!((chart.sample(0).unwrap().3.y + 40.0).abs() < 1e-3);
        assert!((chart.sample(100).unwrap().3.y + 40.0).abs() < 1e-3);
        // Gridlines follow the left axis only
        chart.set_frame_style(crate::chart::ChartFrameStyle::default());
        assert_eq!(chart.prepare_layers(&v).underlay.unwrap().len(), lt.len());
        // Right axis options are independent: fixed max, log scale
        chart.set_y2_axis(LineYAxis { max: Some(5000.0), ..Default::default() });
        assert_eq!(chart.y2_domain().unwrap(), (1000.0, 5000.0, 1000.0));
        assert_eq!(chart.y_domain().unwrap(), (0.0, 10.0, 2.0));
        chart.set_axis_scale(2, LOG);
        let (lo, hi, step) = chart.y2_domain().unwrap();
        assert!((lo - 1000.0).abs() < 1e-3 && (hi - 5000.0).abs() < 0.1 && step == 0.0, "{lo} {hi}");
        // Visible autoscale on the right axis follows the zoom window (samples 0..20)
        chart.set_axis_scale(2, AxisScale::LINEAR);
        chart.set_y2_axis(LineYAxis { autoscale: YAutoscale::Visible, ..Default::default() });
        assert!(chart.set_x_range_data(0.0, 20.0));
        assert_eq!(chart.y2_domain().unwrap(), (1000.0, 1400.0, 100.0));
        assert_eq!(chart.y_domain().unwrap(), (0.0, 10.0, 2.0), "left keeps all-data autoscale");
        // Streaming onto the right series rescales the right axis only
        chart.set_y2_axis(LineYAxis::default());
        chart.append_series_data(1, &[9000.0], None, 0).unwrap();
        assert!(chart.y2_domain().unwrap().1 >= 9000.0);
        assert_eq!(chart.y_domain().unwrap().1, 10.0);
        // Back to one axis
        chart.set_series_axes(&[]);
        assert!(chart.y2_domain().is_none());
        assert!(chart.y_domain().unwrap().1 >= 9000.0);
        chart.prepare_layers(&v);
        assert!(ticks(&chart, 2).is_empty());
    }

    #[test]
    fn annotations_follow_their_y_axis_and_scale() {
        use crate::chart::{AnnotationKind, ChartAnnotation};
        let (_, mut chart) = line(vec![vec![0.0, 10.0], vec![100.0, 1000.0]], None);
        // No right-axis series yet: right-axis annotations use the left mapping
        let f = chart.annotation_frame().unwrap();
        assert_eq!(f.y2, f.y);
        chart.set_series_axes(&[0, 1]);
        let mut right = ChartAnnotation::new(AnnotationKind::HLine, [1000.0, 0.0, 0.0, 0.0], [1.0; 4]);
        right.y_axis = 1;
        let left = ChartAnnotation::new(AnnotationKind::HLine, [10.0, 0.0, 0.0, 0.0], [1.0; 4]);
        chart.set_annotations(vec![left, right]);
        let f = chart.annotation_frame().unwrap();
        assert!((f.y.map(10.0) - 40.0).abs() < 1e-3);
        assert!((f.y2.map(1000.0) - 40.0).abs() < 1e-3);
        assert!((chart.data_to_world_on(1, 0.0, 0.0).unwrap().y + 40.0).abs() < 1e-3);
        assert!((chart.data_to_world(0.0, 0.0).unwrap().y + 40.0).abs() < 1e-3);
        // Log + reversed left axis
        chart.set_axis_scale(1, AxisScale { reverse: true, ..LOG });
        let f = chart.annotation_frame().unwrap();
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert!((lo - 1.0).abs() < 1e-6 && (hi - 100.0).abs() < 1e-3, "{lo} {hi}");
        assert!((f.y.map(lo) - 40.0).abs() < 1e-3 && (f.y.map(hi) + 40.0).abs() < 1e-3);
        assert!(f.y.map(0.0).is_nan(), "no log of 0");
    }

    #[test]
    fn scatter_log_and_reverse_axes() {
        let points = ScatterPoints {
            xs: vec![1.0, 10.0, 100.0, 1000.0, 0.0, -1.0],
            ys: vec![5.0, 50.0, 500.0, 5000.0, 1.0, 1.0],
            series_colors: vec![[1.0; 4]],
            ..Default::default()
        };
        let mut chart = ChartState::new_scatter(points, ScatterLayout::default());
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.set_axis_scale(0, LOG);
        chart.set_axis_scale(1, AxisScale { reverse: true, ..LOG });
        let v = view(&cam);
        let n = chart.prepare_layers(&v).points.unwrap().len();
        assert_eq!(n, 4, "non-positive x skipped");
        let p: Vec<Vec3> = (0..4).map(|i| chart.sample(i).unwrap().3).collect();
        // Decades evenly spaced on x; y reversed (larger y lower)
        assert!(((p[1].x - p[0].x) - (p[3].x - p[2].x)).abs() < 1e-3);
        assert!(p[3].y < p[0].y);
        let xs: Vec<f64> = ticks(&chart, 0).iter().map(|t| t.value).collect();
        assert!(close(&xs, &[1.0, 10.0, 100.0, 1000.0]), "{xs:?}");
        assert!(ticks(&chart, 1).windows(2).all(|w| w[1].y_css > w[0].y_css));
        // Ranges in data units through the log
        let (lo, hi) = chart.x_range_data().unwrap();
        assert!((lo - 1.0).abs() < 1e-6 && (hi - 1000.0).abs() < 1e-3);
        assert!(chart.set_x_range_data(10.0, 100.0));
        let (lo, hi) = chart.x_range_data().unwrap();
        assert!((lo - 10.0).abs() < 1e-3 && (hi - 100.0).abs() < 1e-2, "{lo} {hi}");
        // Hover finds a point on the log axes
        let mut scene = crate::scene::SceneWorld::new();
        let c = cam.project_to_ndc(chart.sample(1).unwrap().3).unwrap();
        assert_eq!(chart.hover_at(&v, &mut scene, (c.x, c.y)).unwrap().items[0].index, 1);
        // Transform uniform carries the reversal
        let style = chart.prepare_layers(&v).point_style.unwrap();
        assert!(style.transform[1] < 0.0 && style.transform[0] > 0.0);
    }

    #[test]
    fn brush_and_cursor_sync_work_in_data_units_on_log_axes() {
        use crate::chart::BrushMode;
        let x: Vec<f64> = (0..=1000).map(|i| 10f64.powf(i as f64 / 250.0)).collect(); // 1 .. 1e4
        let values: Vec<f32> = (0..=1000).map(|i| 1.0 + i as f32).collect();
        let (cam, mut chart) = line(vec![values], Some(x));
        chart.set_axis_scale(0, LOG);
        chart.set_axis_scale(1, LOG);
        let v = view(&cam);
        chart.prepare_layers(&v);
        // Data-range query: x in [10, 100] = samples 250..=500
        let sel = chart.select_data(BrushMode::X, (10.0, 100.0), None).unwrap();
        assert_eq!(sel.ranges, vec![[0, 250, 501]]);
        // NDC brush between the screen positions of samples 250 and 500 reports data units
        let ndc = |i: u32| cam.project_to_ndc(chart.sample(i).unwrap().3).unwrap();
        let (a, b) = (ndc(250), ndc(500));
        assert!(chart.brush_update(&v, BrushMode::XY, (a.x, a.y), (b.x, b.y)));
        let sel = chart.brush_end().unwrap().clone();
        assert!((sel.x_range.0 - 10.0).abs() < 0.05 && (sel.x_range.1 - 100.0).abs() < 0.5, "{:?}", sel.x_range);
        let (y0, y1) = sel.y_range.unwrap();
        assert!((y0 - 251.0).abs() < 1.5 && (y1 - 501.0).abs() < 2.5, "{y0} {y1}");
        // Cursor sync: data x in, data x out
        let mut scene = crate::scene::SceneWorld::new();
        assert_eq!(chart.hover_at_data_x(&mut scene, 100.0).unwrap().items[0].index, 500);
        assert!((chart.hover_data_x().unwrap() - 100.0).abs() < 1e-9);

        // Scatter: log x brush / sync
        let points = ScatterPoints {
            xs: vec![1.0, 10.0, 100.0, 1000.0],
            ys: vec![5.0, 50.0, 500.0, 5000.0],
            series_colors: vec![[1.0; 4]],
            ..Default::default()
        };
        let mut sc = ChartState::new_scatter(points, ScatterLayout::default());
        sc.set_axis_scale(0, LOG);
        sc.set_axis_scale(1, LOG);
        assert_eq!(sc.select_data(BrushMode::XY, (5.0, 200.0), Some((10.0, 1000.0))).unwrap().ids, vec![1, 2]);
        assert_eq!(sc.hover_at_data_x(&mut scene, 900.0).unwrap().items[0].index, 3);
        assert!((sc.hover_data_x().unwrap() - 1000.0).abs() < 1e-6);
    }

    #[test]
    fn xy_brush_selects_right_axis_series_in_their_own_units() {
        use crate::chart::BrushMode;
        // Left series 0..1, right series 1000..5000 (both ramps over 101 samples)
        let left: Vec<f32> = (0..=100).map(|i| i as f32 / 100.0).collect();
        let right: Vec<f32> = (0..=100).map(|i| 1000.0 + 40.0 * i as f32).collect();
        let (cam, mut chart) = line(vec![left, right], None);
        chart.set_series_axes(&[0, 1]);
        chart.prepare_layers(&view(&cam));
        // Left y band 0.4..0.6 = the same screen band on the right axis
        let sel = chart.select_data(BrushMode::XY, (0.0, 100.0), Some((0.4, 0.6))).unwrap();
        let runs: Vec<[u32; 3]> = sel.ranges.clone();
        assert_eq!(runs.iter().filter(|r| r[0] == 0).count(), 1, "{runs:?}");
        let right_run = runs.iter().find(|r| r[0] == 1).expect("right series selected");
        // Its samples lie inside the band mapped to right-axis units
        let (y0, y1) = chart.y2_domain().map(|(a, b, _)| (a, b)).unwrap();
        let (l0, l1) = chart.y_domain().map(|(a, b, _)| (a, b)).unwrap();
        let to_right = |v: f64| y0 + (v - l0) / (l1 - l0) * (y1 - y0);
        let (lo, hi) = (to_right(0.4), to_right(0.6));
        for i in right_run[1]..right_run[2] {
            let v = 1000.0 + 40.0 * i as f64;
            assert!(v >= lo - 1e-6 && v <= hi + 1e-6, "{v} not in {lo}..{hi}");
        }
    }

    #[test]
    fn log_y_with_non_positive_samples_tracks_the_cached_positive_extent_while_streaming() {
        // 0 forces the positive-extent path; 5000 is the positive max until it is trimmed
        let (_cam, mut chart) = line(vec![vec![0.0, 5000.0, 2.0, 3.0]], None);
        chart.set_axis_scale(1, LOG);
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert!(lo <= 2.0 && hi >= 5000.0, "{lo} {hi}");
        // Keep the newest 4: [2, 3, 40, -1] -> positive extent 2..40
        chart.append_series_data(0, &[40.0, -1.0], None, 4).unwrap();
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert!(lo <= 2.0 && (40.0..1000.0).contains(&hi), "{lo} {hi}");
    }
}
