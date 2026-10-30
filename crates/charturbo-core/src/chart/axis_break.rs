//! Axis breaks (ECharts 6 `axis.breaks`): value ranges collapsed to a small gap.
//!
//! The mapping is piecewise linear and continuous: values below the first break pass through,
//! each `[start, end]` range is squeezed into `gap` units, and values above it are shifted down
//! by the removed length. It is embedded in [`AxisScale`](super::scale::AxisScale) so every
//! consumer of `fwd` / `inv` (geometry, hit-testing, brush, annotations, SVG) uses the same
//! mapping. Breaks only apply to linear scales; a log scale ignores them.

use super::multi_axis::y_axis_code;
use super::ticks::ticks_between;
use super::{AreaChart, ChartKind, ChartState, ChartView};
use glam::Vec3;

/// Max breaks per axis (keeps `AxisScale` `Copy`).
pub const MAX_AXIS_BREAKS: usize = 8;

/// One collapsed range `[start, end]` (data units) drawn as `gap` scale-space units.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct AxisBreak {
    pub start: f64,
    pub end: f64,
    pub gap: f64,
}

/// Sorted, non-overlapping breaks of one axis.
#[derive(Debug, Clone, Copy, Default)]
pub struct AxisBreaks {
    n: u8,
    items: [AxisBreak; MAX_AXIS_BREAKS],
}

impl PartialEq for AxisBreaks {
    fn eq(&self, o: &Self) -> bool {
        self.list().len() == o.list().len()
            && self.list().iter().zip(o.list()).all(|(a, b)| {
                a.start.to_bits() == b.start.to_bits()
                    && a.end.to_bits() == b.end.to_bits()
                    && a.gap.to_bits() == b.gap.to_bits()
            })
    }
}

impl Eq for AxisBreaks {}

impl AxisBreaks {
    pub const NONE: Self = Self {
        n: 0,
        items: [AxisBreak {
            start: 0.0,
            end: 0.0,
            gap: 0.0,
        }; MAX_AXIS_BREAKS],
    };

    /// Validates and sorts: finite, `start < end`, `gap >= 0`, at most [`MAX_AXIS_BREAKS`], no
    /// overlapping (touching is overlapping too) ranges.
    pub fn new(list: &[AxisBreak]) -> Result<Self, String> {
        if list.len() > MAX_AXIS_BREAKS {
            return Err(format!(
                "at most {MAX_AXIS_BREAKS} axis breaks per axis, got {}",
                list.len()
            ));
        }
        let mut out = Self::NONE;
        for (i, b) in list.iter().enumerate() {
            if !(b.start.is_finite() && b.end.is_finite() && b.gap.is_finite()) {
                return Err(format!("axis break {i}: start / end / gap must be finite"));
            }
            if b.start >= b.end {
                return Err(format!("axis break {i}: start must be < end"));
            }
            if b.gap < 0.0 {
                return Err(format!("axis break {i}: gap must be >= 0"));
            }
            out.items[i] = *b;
        }
        out.n = list.len() as u8;
        let n = list.len();
        out.items[..n].sort_by(|a, b| a.start.total_cmp(&b.start));
        for w in out.items[..n].windows(2) {
            if w[1].start <= w[0].end {
                return Err("axis breaks must not overlap".into());
            }
        }
        Ok(out)
    }

    /// Flat `[start, end, gap] * n` input (the WASM form).
    pub fn from_flat(flat: &[f64]) -> Result<Self, String> {
        if flat.len() % 3 != 0 {
            return Err("axis breaks: expected [start, end, gap] triples".into());
        }
        let list: Vec<AxisBreak> = flat
            .chunks_exact(3)
            .map(|c| AxisBreak {
                start: c[0],
                end: c[1],
                gap: c[2],
            })
            .collect();
        Self::new(&list)
    }

    #[inline]
    pub fn list(&self) -> &[AxisBreak] {
        &self.items[..self.n as usize]
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.n == 0
    }

    /// Value -> compressed (scale) space.
    pub fn fwd(&self, v: f64) -> f64 {
        let mut off = 0.0;
        for b in self.list() {
            if v <= b.start {
                break;
            }
            if v < b.end {
                return b.start - off + (v - b.start) / (b.end - b.start) * b.gap;
            }
            off += b.end - b.start - b.gap;
        }
        v - off
    }

    /// Compressed space -> value; points inside a gap map linearly back into the break (a zero
    /// gap returns its `start`).
    pub fn inv(&self, u: f64) -> f64 {
        let mut off = 0.0;
        for b in self.list() {
            let cs = b.start - off;
            if u <= cs {
                break;
            }
            if u <= cs + b.gap {
                return if b.gap > 0.0 { b.start + (u - cs) / b.gap * (b.end - b.start) } else { b.start };
            }
            off += b.end - b.start - b.gap;
        }
        u + off
    }

    /// Value lies strictly inside a break (hidden behind its gap marker).
    pub fn hides(&self, v: f64) -> bool {
        self.list().iter().any(|b| v > b.start && v < b.end)
    }

    /// Compressed `[from, to]` of each gap.
    pub fn gaps(&self) -> impl Iterator<Item = (f64, f64)> + '_ {
        self.list().iter().map(|b| {
            let s = self.fwd(b.start);
            (s, s + b.gap)
        })
    }

    /// Ticks (data units) of the compressed range `[lo_u, hi_u]`: multiples of `step` on each
    /// unbroken segment, none inside a break, and none closer than half a step (compressed) to
    /// the previous tick (break edges would otherwise collide across a small gap).
    pub fn ticks(&self, lo_u: f64, hi_u: f64, step: f64) -> Vec<f64> {
        let (lo, hi) = (self.inv(lo_u), self.inv(hi_u));
        if self.is_empty() {
            return ticks_between(lo, hi, step);
        }
        let mut out: Vec<f64> = Vec::new();
        let mut last_u = f64::NEG_INFINITY;
        let mut seg_lo = lo;
        let mut push_seg = |a: f64, b: f64, out: &mut Vec<f64>| {
            for t in ticks_between(a, b, step) {
                let u = self.fwd(t);
                if u - last_u >= 0.5 * step {
                    out.push(t);
                    last_u = u;
                }
            }
        };
        for b in self.list() {
            if b.end <= seg_lo {
                continue;
            }
            if b.start >= hi {
                break;
            }
            push_seg(seg_lo, b.start.min(hi), &mut out);
            seg_lo = b.end;
        }
        if seg_lo <= hi {
            push_seg(seg_lo, hi, &mut out);
        }
        out
    }
}

/// Screen span of one visible axis break, for the DOM / SVG break marks: `axis` is the tick axis
/// code of the screen axis (0 = x, 1 = left y, 2 = right y, 16 + k = extra y axis k);
/// `from_css` / `to_css` are the css x (axis 0) or y of the break's start / end.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AxisBreakMark {
    pub axis: u8,
    pub from_css: f32,
    pub to_css: f32,
}

/// World span `[a, b]` of one visible axis break (`axis` as in [`AxisBreakMark`]) with its drawn
/// style: a band in the plot surface color over the gap, zigzag edges `tooth` long and `amp`
/// tall (world units, from 8 / 3 css px), `stroke` colored, `width_px` wide.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct BreakSpan {
    pub axis: u8,
    pub a: f32,
    pub b: f32,
    pub tooth: f32,
    pub amp: f32,
    pub band: [f32; 4],
    pub stroke: [f32; 4],
    pub width_px: f32,
}

/// Zigzag tooth / amplitude in css px.
const TOOTH_PX: f32 = 8.0;
const AMP_PX: f32 = 3.0;

impl ChartState {
    /// World spans of the visible breaks (2D line / area / combo / bar / scatter), skipping
    /// breaks outside the zoom window.
    fn break_spans(&self, view: &ChartView, out: &mut Vec<BreakSpan>) {
        out.clear();
        let Some(f) = self.annotation_frame() else { return };
        let [x0, x1, y0, y1] = f.bounds;
        // css px per world unit (flat views map both axes alike)
        let px = match (view.project_css(Vec3::new(x0, y0, f.z)), view.project_css(Vec3::new(x1, y0, f.z))) {
            (Some(p), Some(q)) if x1 != x0 => ((q.0 - p.0) / (x1 - x0)).abs().max(1e-6),
            _ => return,
        };
        let style = (self.hover_style.marker_ring_color, self.frame_style.baseline_color, self.frame_style.stroke_px);
        let mut push = |axis: u8, breaks: AxisBreaks, map: &dyn Fn(f64) -> f32| {
            let (lo, hi) = if axis != 0 { (y0.min(y1), y0.max(y1)) } else { (x0.min(x1), x0.max(x1)) };
            for b in breaks.list() {
                let (a, c) = (map(b.start), map(b.end));
                if a.max(c) < lo || a.min(c) > hi || !a.is_finite() || !c.is_finite() {
                    continue;
                }
                out.push(BreakSpan {
                    axis,
                    a,
                    b: c,
                    tooth: TOOTH_PX / px,
                    amp: AMP_PX / px,
                    band: style.0,
                    stroke: style.1,
                    width_px: style.2.max(1.0),
                });
            }
        };
        let (line, bar_axis) = match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => (Some(l), None),
            // Combo bars may sit alone on an axis no line uses
            ChartKind::Combo(c) => (Some(&c.line), c.bars.as_ref().map(|_| c.bar_axis)),
            _ => (None, None),
        };
        if let Some(l) = line {
            for k in (0..l.y_axis_count()).filter(|&k| k == 0 || l.uses_axis(k) || bar_axis == Some(k)) {
                let scale = l.scale_of_axis(k);
                if scale.has_breaks() {
                    push(y_axis_code(k), scale.breaks, &|v| l.y_of_axis(k, v as f32));
                }
            }
        } else if matches!(self.kind, ChartKind::Bar(_) | ChartKind::Scatter(_)) {
            push(0, f.x.breaks(), &|v| f.x.map(v));
            push(1, f.y.breaks(), &|v| f.y.map(v));
        }
    }

    /// Re-derives the break spans (drawn with the annotations, above the series) and their
    /// screen marks for the DOM / SVG.
    pub(crate) fn prepare_breaks(&mut self, view: &ChartView) {
        let mut spans = std::mem::take(&mut self.break_scratch);
        self.break_spans(view, &mut spans);
        self.annotations.set_breaks(&spans);
        self.break_scratch = spans;
    }

    /// Screen marks of the current break spans (see `prepare_breaks`).
    pub(crate) fn break_marks(&self, view: &ChartView, out: &mut Vec<AxisBreakMark>) {
        out.clear();
        let Some(f) = self.annotation_frame() else { return };
        let [x0, x1, y0, y1] = f.bounds;
        for s in &self.break_scratch {
            let vertical = s.axis != 0;
            let (lo, hi) = if vertical { (y0.min(y1), y0.max(y1)) } else { (x0.min(x1), x0.max(x1)) };
            let css = |w: f32| {
                let p = if vertical { Vec3::new(x0, w.clamp(lo, hi), f.z) } else { Vec3::new(w.clamp(lo, hi), y0, f.z) };
                view.project_css(p).map(|(x, y)| if vertical { y } else { x })
            };
            if let (Some(from_css), Some(to_css)) = (css(s.a), css(s.b)) {
                out.push(AxisBreakMark { axis: s.axis, from_css, to_css });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn br(start: f64, end: f64, gap: f64) -> AxisBreak {
        AxisBreak { start, end, gap }
    }

    #[test]
    fn single_break_maps_piecewise_and_inverts() {
        let b = AxisBreaks::new(&[br(100.0, 1000.0, 10.0)]).unwrap();
        assert_eq!(b.fwd(0.0), 0.0);
        assert_eq!(b.fwd(100.0), 100.0);
        assert_eq!(b.fwd(550.0), 105.0);
        assert_eq!(b.fwd(1000.0), 110.0);
        assert_eq!(b.fwd(1200.0), 310.0);
        assert_eq!(b.fwd(-50.0), -50.0);
        for v in [-50.0, 0.0, 99.0, 100.0, 300.0, 1000.0, 1000.5, 1200.0] {
            assert!((b.inv(b.fwd(v)) - v).abs() < 1e-9, "round trip {v}");
        }
        assert!(b.hides(550.0) && !b.hides(100.0) && !b.hides(1000.0));
    }

    #[test]
    fn multiple_breaks_accumulate_offsets() {
        let b = AxisBreaks::new(&[br(500.0, 900.0, 0.0), br(10.0, 20.0, 2.0)]).unwrap();
        assert_eq!(b.list()[0].start, 10.0, "sorted");
        assert_eq!(b.fwd(15.0), 11.0);
        assert_eq!(b.fwd(20.0), 12.0);
        assert_eq!(b.fwd(500.0), 492.0);
        assert_eq!(b.fwd(700.0), 492.0, "zero gap collapses the range");
        assert_eq!(b.fwd(1000.0), 592.0);
        assert_eq!(b.inv(492.0), 500.0, "zero gap inverts to its start");
        assert_eq!(b.inv(592.0), 1000.0);
        let g: Vec<_> = b.gaps().collect();
        assert_eq!(g, vec![(10.0, 12.0), (492.0, 492.0)]);
        // Monotone everywhere
        let mut prev = f64::NEG_INFINITY;
        for i in 0..1200 {
            let u = b.fwd(i as f64);
            assert!(u >= prev);
            prev = u;
        }
    }

    #[test]
    fn rejects_invalid_breaks() {
        assert!(AxisBreaks::new(&[br(5.0, 5.0, 1.0)]).is_err());
        assert!(AxisBreaks::new(&[br(5.0, 1.0, 1.0)]).is_err());
        assert!(AxisBreaks::new(&[br(0.0, 1.0, -1.0)]).is_err());
        assert!(AxisBreaks::new(&[br(f64::NAN, 1.0, 0.0)]).is_err());
        assert!(AxisBreaks::new(&[br(0.0, 10.0, 1.0), br(5.0, 20.0, 1.0)]).is_err());
        assert!(AxisBreaks::new(&[br(0.0, 10.0, 1.0), br(10.0, 20.0, 1.0)]).is_err());
        assert!(AxisBreaks::new(&[br(0.0, 1.0, 0.0); MAX_AXIS_BREAKS + 1]).is_err());
        assert!(AxisBreaks::from_flat(&[0.0, 1.0]).is_err());
        assert_eq!(AxisBreaks::from_flat(&[]).unwrap(), AxisBreaks::NONE);
    }

    #[test]
    fn ticks_skip_broken_range() {
        let b = AxisBreaks::new(&[br(120.0, 4900.0, 20.0)]).unwrap();
        // compressed [0, fwd(5100)] = [0, 340]
        let t = b.ticks(0.0, b.fwd(5100.0), 50.0);
        assert_eq!(
            t,
            vec![0.0, 50.0, 100.0, 4900.0, 4950.0, 5000.0, 5050.0, 5100.0]
        );
        // A tick on both edges of a tiny gap keeps only the lower one
        let b = AxisBreaks::new(&[br(100.0, 1000.0, 5.0)]).unwrap();
        let t = b.ticks(0.0, b.fwd(1200.0), 100.0);
        assert_eq!(t, vec![0.0, 100.0, 1100.0, 1200.0]);
        assert_eq!(AxisBreaks::NONE.ticks(0.0, 10.0, 5.0), vec![0.0, 5.0, 10.0]);
    }
}

#[cfg(test)]
mod chart_tests {
    use super::*;
    use crate::camera::OrbitCamera;
    use crate::chart::scale::{AxisScale, ScaleType};
    use crate::chart::{
        AxisTick, BarLayout, ChartState, ChartView, ChartViewMode, LineLayout, LineSeries, LineXKind, ScatterLayout,
        ScatterPoints,
    };
    use crate::scene::SceneWorld;
    use glam::Vec3;

    fn one(start: f64, end: f64, gap: f64) -> AxisBreaks {
        AxisBreaks::new(&[AxisBreak { start, end, gap }]).unwrap()
    }

    fn cam_for(chart: &ChartState) -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn ticks(chart: &ChartState, axis: u8) -> Vec<AxisTick> {
        chart.axes().ticks.iter().copied().filter(|t| t.axis == axis).collect()
    }

    fn bar(values: Vec<f32>) -> ChartState {
        let layout = BarLayout { width: 160.0, max_height: 80.0, bar_width: 0.0, corner_radius_px: 0.0, view: ChartViewMode::Flat };
        ChartState::new_bar(values, vec![[0.2, 0.4, 0.8, 1.0]], layout, &mut SceneWorld::new())
    }

    #[test]
    fn bar_value_breaks_compress_bars_ticks_and_frame() {
        let mut chart = bar(vec![10.0, 20.0, 500.0]);
        assert_eq!(chart.set_axis_breaks(1, one(30.0, 480.0, 5.0)), Ok(true));
        assert_eq!(chart.set_axis_breaks(1, one(30.0, 480.0, 5.0)), Ok(false), "unchanged");
        assert_eq!(chart.axis_breaks(1), one(30.0, 480.0, 5.0));
        assert_eq!(chart.axis_breaks(0), AxisBreaks::NONE);
        let cam = cam_for(&chart);
        chart.prepare_layers(&view(&cam));
        let vs: Vec<f64> = ticks(&chart, 1).iter().map(|t| t.value).collect();
        assert!(!vs.iter().any(|&v| v > 30.0 && v < 480.0), "{vs:?}");
        assert!(vs.contains(&20.0) && vs.contains(&500.0), "{vs:?}");
        let f = chart.annotation_frame().unwrap();
        // 500 -> compressed 55 = top of the 80-unit plot; 20 at 20 / 55 of it
        assert!((f.y.map(500.0) - 40.0).abs() < 1e-3, "{}", f.y.map(500.0));
        assert!((f.y.map(20.0) - (20.0 / 55.0 * 80.0 - 40.0)).abs() < 1e-3);
        assert!((f.y.unmap(f.y.map(250.0)) - 250.0).abs() < 1e-3, "inverse through the gap");
        let crate::chart::ChartKind::Bar(b) = &chart.kind else { panic!() };
        let top = b.segs[2].unwrap().y1;
        assert!((top - 40.0).abs() < 1e-3, "{top}");
        assert!((b.segs[1].unwrap().y1 - f.y.map(20.0)).abs() < 1e-3);
    }

    #[test]
    fn break_marks_span_the_gap_on_screen() {
        let mut chart = bar(vec![10.0, 20.0, 500.0]);
        let cam = cam_for(&chart);
        chart.prepare_layers(&view(&cam));
        assert!(chart.axes().breaks.is_empty(), "no breaks, no marks");
        chart.set_axis_breaks(1, one(30.0, 480.0, 5.0)).unwrap();
        chart.prepare_layers(&view(&cam));
        let axes = chart.axes();
        let plot = axes.plot_css;
        assert_eq!(axes.breaks.len(), 1, "{:?}", axes.breaks);
        let m = axes.breaks[0];
        assert_eq!(m.axis, 1);
        // 30 sits 30 / 55 up the plot, 480 the 5-unit gap above it (css y grows downwards)
        assert!((m.from_css - (plot[1] + plot[3] * (1.0 - 30.0 / 55.0))).abs() < 0.5, "{m:?} {plot:?}");
        assert!((m.from_css - m.to_css - plot[3] * 5.0 / 55.0).abs() < 0.5, "{m:?}");
        // Drawn above the series: a surface band over the gap plus zigzag edges
        let (_, above) = chart.annotations.layers();
        assert_eq!(above.fills.len(), 6, "one band");
        assert!(above.lines.len() >= 8, "zigzag segments: {}", above.lines.len());
        assert!(above.fills.iter().all(|v| v.color == chart.hover_style.marker_ring_color));
        chart.set_axis_breaks(1, AxisBreaks::NONE).unwrap();
        chart.prepare_layers(&view(&cam));
        let (_, above) = chart.annotations.layers();
        assert!(above.fills.is_empty() && above.lines.is_empty(), "cleared with the breaks");
        assert!(chart.axes().breaks.is_empty());
    }

    #[test]
    fn breaks_reject_log_scales_and_other_kinds_keep_state() {
        let series = vec![LineSeries { values: vec![1.0, 10.0, 100.0], x: None, color: [1.0; 4], width_px: 2.0 }];
        let layout = LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric };
        let mut chart = ChartState::new_line(series, layout);
        chart.set_axis_scale(1, AxisScale { kind: ScaleType::Log, ..AxisScale::LINEAR });
        let before = chart.y_domain();
        assert!(chart.set_axis_breaks(1, one(20.0, 80.0, 1.0)).is_err(), "log + breaks rejected");
        assert_eq!(chart.y_domain(), before, "rejected input leaves the chart as it was");
        assert_eq!(chart.axis_scale(1).unwrap().breaks, AxisBreaks::NONE);
        // Clearing breaks on a log axis is fine
        assert_eq!(chart.set_axis_breaks(1, AxisBreaks::NONE), Ok(false));
        // Line x axes have no break support (scatter x does)
        assert!(chart.set_axis_breaks(0, one(0.5, 1.5, 0.1)).is_err());
        assert_eq!(chart.axis_breaks(0), AxisBreaks::NONE);
    }

    #[test]
    fn log_scale_on_a_broken_axis_keeps_it_linear() {
        let series = vec![LineSeries { values: vec![1.0, 10.0, 100.0], x: None, color: [1.0; 4], width_px: 2.0 }];
        let layout = LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric };
        let mut chart = ChartState::new_line(series, layout);
        chart.set_axis_breaks(1, one(20.0, 80.0, 1.0)).unwrap();
        chart.set_axis_scale(1, AxisScale { kind: ScaleType::Log, breaks: one(20.0, 80.0, 1.0), ..AxisScale::LINEAR });
        let s = chart.axis_scale(1).unwrap();
        assert!(!s.is_log(), "breaks need a linear scale");
        assert_eq!(s.breaks, one(20.0, 80.0, 1.0));
        // Other options still apply
        chart.set_axis_scale(1, AxisScale { kind: ScaleType::Log, reverse: true, breaks: one(20.0, 80.0, 1.0), ..AxisScale::LINEAR });
        assert!(chart.axis_scale(1).unwrap().reverse);
    }

    #[test]
    fn scatter_breaks_apply_to_either_axis() {
        let points = ScatterPoints {
            xs: vec![0.0, 10.0, 1000.0],
            ys: vec![0.0, 10.0, 1000.0],
            series_colors: vec![[1.0; 4]],
            ..Default::default()
        };
        let mut chart = ChartState::new_scatter(points, ScatterLayout::default());
        assert_eq!(chart.set_axis_breaks(1, one(20.0, 990.0, 2.0)), Ok(true));
        let cam = cam_for(&chart);
        chart.prepare_layers(&view(&cam));
        let p: Vec<Vec3> = (0..3).map(|i| chart.sample(i).unwrap().3).collect();
        // 1000 compresses to 32: 22 units above 10, which is 10 above 0
        let (d1, d2) = (p[1].y - p[0].y, p[2].y - p[1].y);
        assert!((d2 / d1 - 2.2).abs() < 0.01, "{d1} {d2}");
        let vs: Vec<f64> = ticks(&chart, 1).iter().map(|t| t.value).collect();
        assert!(!vs.iter().any(|&v| v > 20.0 && v < 990.0), "{vs:?}");
    }
}
