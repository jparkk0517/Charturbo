//! Scatter trendlines (ECharts ecStat regression lines): least-squares fits of chosen series
//! (regression.rs), stroked across the visible x range. The curve is sampled in screen space and
//! refined where it bends, re-drawn when the zoom window, the scales, the camera or the legend
//! change, clipped to the plot and drawn in the series stroke layers (beneath the points).

use super::super::regression::{fit_trend, TrendModel};
use super::*;
use crate::renderer::ChartDashSegmentRaw;

/// Base sampling step of a trendline along x, CSS px.
const BASE_STEP_PX: f32 = 4.0;
/// A sample interval is split while the curve midpoint leaves its chord midpoint by more than
/// this (CSS px), at most `MAX_REFINE` times.
const FLATNESS_PX: f64 = 0.25;
const MAX_REFINE: u32 = 8;

/// One trendline: `model` fitted to the points of series `series`, stroked in `color`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ScatterTrendline {
    pub series: u16,
    pub model: TrendModel,
    pub color: [f32; 4],
    /// Stroke width in CSS px
    pub width_px: f32,
    /// `[on, off, on, off]` dash pattern in CSS px; all zeros = solid
    pub dash: [f32; 4],
}

/// Everything the drawn trendlines depend on besides the fits.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct TrendKey {
    view: [f32; 19],
    window: [f32; 4],
    domains: [f64; 4],
    scales: [AxisScale; 2],
    visible: Vec<bool>,
    emphasis: Option<usize>,
}

/// Part of segment `a -> b` with `|y| <= hh` as parameters `(t0, t1)` (Liang-Barsky on y).
fn clip_y(a: (f64, f64), b: (f64, f64), hh: f64) -> Option<(f64, f64)> {
    let dy = b.1 - a.1;
    let (mut t0, mut t1) = (0.0f64, 1.0f64);
    for (p, q) in [(-dy, a.1 + hh), (dy, hh - a.1)] {
        if p == 0.0 {
            if q < 0.0 {
                return None;
            }
        } else if p < 0.0 {
            t0 = t0.max(q / p);
        } else {
            t1 = t1.min(q / p);
        }
    }
    (t0 < t1).then_some((t0, t1))
}

impl ScatterChart {
    /// Sets the trendlines and fits each to the real (unjittered) values of its series. True when
    /// they changed.
    pub(crate) fn set_trendlines(&mut self, lines: &[ScatterTrendline]) -> bool {
        if lines.len() == self.trendlines.len() && lines.iter().zip(&self.trendlines).all(|(a, (b, _))| a == b) {
            return false;
        }
        self.trendlines = lines
            .iter()
            .map(|&line| {
                let s = line.series as usize;
                let pts = (0..self.xs.len())
                    .filter(|&i| self.series_of(i) == s)
                    .map(|i| (self.xs[i] as f64, self.ys[i] as f64));
                (line, fit_trend(line.model, pts))
            })
            .collect();
        self.trend_key = None;
        true
    }

    /// World xy of data `(x, y)` under the zoom window (f64: far off-plot values stay ordered).
    fn world_f64(&self, x: f64, y: f64) -> (f64, f64) {
        let axis = |v: f64, domain: (f64, f64), window: (f32, f32), size: f32, sign: f32| {
            let t = (v - domain.0) / (domain.1 - domain.0);
            ((t - window.0 as f64) / ((window.1 - window.0) as f64).max(1e-9) - 0.5) * size as f64 * sign as f64
        };
        (
            axis(self.x_scale.fwd(x), self.x_domain, self.window_x, self.layout.width, self.x_scale.sign()),
            axis(self.y_scale.fwd(y), self.y_domain, self.window_y, self.layout.height, self.y_scale.sign()),
        )
    }

    /// Strokes of the visible trendlines into `solid` / `dashed` when the view or the legend
    /// changed since the last build (or `force`). True when the layers were rebuilt.
    pub(crate) fn build_trendlines(
        &mut self,
        view: &ChartView,
        force: bool,
        solid: &mut Vec<ChartSegmentRaw>,
        dashed: &mut Vec<ChartDashSegmentRaw>,
    ) -> bool {
        if self.trendlines.is_empty() {
            // Only a forced build (data / trendline change) clears a previous chart's strokes
            if force {
                solid.clear();
                dashed.clear();
            }
            return force;
        }
        let key = TrendKey {
            view: view.key(),
            window: [self.window_x.0, self.window_x.1, self.window_y.0, self.window_y.1],
            domains: [self.x_domain.0, self.x_domain.1, self.y_domain.0, self.y_domain.1],
            scales: [self.x_scale, self.y_scale],
            visible: self.visible.clone(),
            emphasis: self.emphasis,
        };
        if !force && self.trend_key.as_ref() == Some(&key) {
            return false;
        }
        self.trend_key = Some(key);
        solid.clear();
        dashed.clear();
        let (hw, hh) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let Some(plot) = plot_rect_css(view, hw, -hh, hh, 0.0) else {
            return true;
        };
        // CSS px per world unit (head-on flat chart)
        let (kx, ky) = ((plot[2] / self.layout.width) as f64, (plot[3] / self.layout.height) as f64);
        let (u0, u1) = Self::visible_range(self.x_domain, self.window_x);
        let base = ((plot[2] / BASE_STEP_PX).ceil() as usize).clamp(16, 4096);
        let mut path: Vec<Option<(f64, f64)>> = Vec::new();
        for (line, fit) in &self.trendlines {
            let s = line.series as usize;
            if fit.coeffs.is_empty() || !self.visible.get(s).copied().unwrap_or(false) {
                continue;
            }
            let mut color = line.color;
            if self.emphasis.is_some_and(|e| e != s) {
                color[3] *= DIMMED_SERIES_ALPHA;
            }
            let curve = |u: f64| {
                let x = self.x_scale.inv(u);
                let p = self.world_f64(x, fit.eval(line.model, x));
                (p.0.is_finite() && p.1.is_finite()).then_some(p)
            };
            path.clear();
            let mut prev = (u0, curve(u0));
            path.push(prev.1);
            for k in 1..=base {
                let u = u0 + (u1 - u0) * k as f64 / base as f64;
                let next = (u, curve(u));
                refine(&curve, prev, next, (kx, ky), hh as f64, MAX_REFINE, &mut path);
                path.push(next.1);
                prev = next;
            }
            emit(&path, line, color, (kx, ky), hh as f64, solid, dashed);
        }
        true
    }

    /// Fits of the trendlines, in order.
    pub(crate) fn trend_fits(&self) -> impl Iterator<Item = &TrendFit> {
        self.trendlines.iter().map(|(_, fit)| fit)
    }
}

/// Pushes the interior samples of `(ua, a) -> (ub, b)` where the curve leaves the chord by more
/// than `FLATNESS_PX` (screen px through `k`), splitting at most `depth` times. Intervals with a
/// gap end or wholly beyond one plot edge are not refined.
fn refine(
    curve: &impl Fn(f64) -> Option<(f64, f64)>,
    (ua, a): (f64, Option<(f64, f64)>),
    (ub, b): (f64, Option<(f64, f64)>),
    k: (f64, f64),
    hh: f64,
    depth: u32,
    out: &mut Vec<Option<(f64, f64)>>,
) {
    let (Some(pa), Some(pb)) = (a, b) else {
        return;
    };
    if depth == 0 {
        return;
    }
    let um = (ua + ub) * 0.5;
    let Some(pm) = curve(um) else {
        return;
    };
    let beyond = |p: (f64, f64)| if p.1 > hh { 1 } else if p.1 < -hh { -1 } else { 0 };
    let side = beyond(pa);
    if side != 0 && side == beyond(pb) && side == beyond(pm) {
        return;
    }
    let dev = (((pm.0 - (pa.0 + pb.0) * 0.5) * k.0).powi(2) + ((pm.1 - (pa.1 + pb.1) * 0.5) * k.1).powi(2)).sqrt();
    if dev <= FLATNESS_PX {
        return;
    }
    refine(curve, (ua, a), (um, Some(pm)), k, hh, depth - 1, out);
    out.push(Some(pm));
    refine(curve, (um, Some(pm)), (ub, b), k, hh, depth - 1, out);
}

/// Segments of a sampled path (`None` = gap) clipped to the plot height: solid strokes, or dashed
/// ones whose pattern phase runs on along the path (CSS px).
fn emit(
    path: &[Option<(f64, f64)>],
    line: &ScatterTrendline,
    color: [f32; 4],
    k: (f64, f64),
    hh: f64,
    solid: &mut Vec<ChartSegmentRaw>,
    dashed: &mut Vec<ChartDashSegmentRaw>,
) {
    let width = if line.width_px.is_finite() { line.width_px.clamp(0.0, 64.0) } else { 2.0 };
    let period: f64 = line.dash.iter().map(|&d| d.max(0.0) as f64).sum();
    let mut phase = 0.0f64;
    for w in path.windows(2) {
        let (Some(a), Some(b)) = (w[0], w[1]) else {
            continue;
        };
        let len = (((b.0 - a.0) * k.0).powi(2) + ((b.1 - a.1) * k.1).powi(2)).sqrt();
        if let Some((t0, t1)) = clip_y(a, b, hh) {
            let at = |t: f64| [(a.0 + (b.0 - a.0) * t) as f32, (a.1 + (b.1 - a.1) * t) as f32];
            let (p0, p1) = (at(t0), at(t1));
            if period > 0.0 {
                dashed.push(ChartDashSegmentRaw {
                    p0_width: [p0[0], p0[1], 0.0, width],
                    p1_phase: [p1[0], p1[1], 0.0, (phase + len * t0).rem_euclid(period) as f32],
                    color,
                    dash: line.dash.map(|d| d.max(0.0)),
                });
            } else {
                solid.push(ChartSegmentRaw { p0_width: [p0[0], p0[1], 0.0, width], p1_pad: [p1[0], p1[1], 0.0, 0.0], color });
            }
        }
        if period > 0.0 && len.is_finite() {
            phase = (phase + len).rem_euclid(period);
        }
    }
}

impl ChartState {
    /// Trendlines of a scatter chart (see `ScatterChart::set_trendlines`); refits and redraws
    /// them when they changed. False for other charts.
    pub fn set_scatter_trendlines(&mut self, lines: &[ScatterTrendline]) -> bool {
        let ChartKind::Scatter(s) = &mut self.kind else {
            return false;
        };
        let changed = s.set_trendlines(lines);
        self.dirty.series |= changed;
        changed
    }

    /// Fits of the scatter trendlines, in `set_scatter_trendlines` order (empty for other charts).
    pub fn scatter_trend_fits(&self) -> Vec<TrendFit> {
        match &self.kind {
            ChartKind::Scatter(s) => s.trend_fits().cloned().collect(),
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::ScaleType;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn framed(chart: &ChartState) -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        cam
    }

    fn inner(chart: &ChartState) -> &ScatterChart {
        match &chart.kind {
            ChartKind::Scatter(s) => s,
            _ => unreachable!(),
        }
    }

    /// Data (x, y) under a world point.
    fn data_of(s: &ScatterChart, x: f32, y: f32) -> (f64, f64) {
        let t = s.t_of_world(x, y);
        let u = |t: f32, d: (f64, f64)| d.0 + t as f64 * (d.1 - d.0);
        (s.x_scale.inv(u(t[0], s.x_domain)), s.y_scale.inv(u(t[1], s.y_domain)))
    }

    fn line(series: u16, model: TrendModel) -> ScatterTrendline {
        ScatterTrendline { series, model, color: [0.1, 0.2, 0.3, 1.0], width_px: 2.0, dash: [0.0; 4] }
    }

    /// Two series: series 0 on y = 2x + 1 (+-1), series 1 on y = 0.5 e^(0.4x).
    fn chart() -> ChartState {
        let mut xs = Vec::new();
        let mut ys = Vec::new();
        let mut ids = Vec::new();
        for i in 0..40 {
            let x = i as f32 * 0.25;
            xs.push(x);
            ys.push(2.0 * x + 1.0 + if i % 2 == 0 { 1.0 } else { -1.0 });
            ids.push(0);
            xs.push(x);
            ys.push(0.5 * (0.4 * x).exp());
            ids.push(1);
        }
        ChartState::new_scatter(ScatterPoints { xs, ys, series: ids, ..Default::default() }, ScatterLayout::default())
    }

    #[test]
    fn linear_trendline_spans_the_visible_x_range_on_the_fit() {
        let mut chart = chart();
        let cam = framed(&chart);
        let v = view(&cam);
        assert!(chart.set_scatter_trendlines(&[line(0, TrendModel::Linear)]));
        assert!(!chart.set_scatter_trendlines(&[line(0, TrendModel::Linear)]), "unchanged");
        let fits = chart.scatter_trend_fits();
        assert!((fits[0].coeffs[1] - 2.0).abs() < 0.05 && (fits[0].coeffs[0] - 1.0).abs() < 0.3, "{:?}", fits[0].coeffs);
        assert_eq!((fits[0].used, fits[0].skipped), (40, 0));
        let segs = chart.prepare_layers(&v).series.expect("trendline strokes").to_vec();
        assert!(!segs.is_empty());
        let s = inner(&chart);
        let hw = s.layout.width * 0.5;
        // From the left plot edge to the right one, every vertex on the fitted line
        let xs: Vec<f32> = segs.iter().flat_map(|g| [g.p0_width[0], g.p1_pad[0]]).collect();
        let (lo, hi) = (xs.iter().cloned().fold(f32::MAX, f32::min), xs.iter().cloned().fold(f32::MIN, f32::max));
        assert!((lo + hw).abs() < 1e-3 && (hi - hw).abs() < 1e-3, "{lo} {hi}");
        for g in &segs {
            let (x, y) = data_of(s, g.p0_width[0], g.p0_width[1]);
            assert!((y - (fits[0].coeffs[0] + fits[0].coeffs[1] * x)).abs() < 1e-3, "{x} {y}");
            assert_eq!(g.color, [0.1, 0.2, 0.3, 1.0]);
            assert_eq!(g.p0_width[3], 2.0);
        }
        // Nothing changed: no rebuild, no upload
        assert!(chart.prepare_layers(&v).series.is_none());
        // Zoom: rebuilt across the new window, still on the line
        chart.zoom_xy(&v, 0.4, (0.2, 0.1));
        let segs = chart.prepare_layers(&v).series.expect("redrawn on zoom").to_vec();
        let s = inner(&chart);
        let hh = s.layout.height * 0.5;
        // Enters through the left edge or, clipped, through the top / bottom edge
        let [x0, y0, ..] = segs[0].p0_width;
        assert!((x0 + hw).abs() < 1e-3 || (y0.abs() - hh).abs() < 1e-3, "{x0} {y0}");
        assert!(segs.iter().all(|g| g.p0_width[1].abs() <= hh + 1e-3 && g.p1_pad[1].abs() <= hh + 1e-3));
        for g in &segs {
            let (x, y) = data_of(s, g.p1_pad[0], g.p1_pad[1]);
            assert!((y - (fits[0].coeffs[0] + fits[0].coeffs[1] * x)).abs() < 1e-3, "{x} {y}");
        }
    }

    #[test]
    fn legend_hides_and_dims_trendlines_with_their_series() {
        let mut chart = chart();
        let cam = framed(&chart);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.set_scatter_trendlines(&[line(0, TrendModel::Linear), line(1, TrendModel::Exponential)]);
        let both = chart.prepare_layers(&v).series.unwrap().len();
        chart.set_series_visible(1, false, &mut scene);
        let one = chart.prepare_layers(&v).series.expect("redrawn").to_vec();
        assert!(!one.is_empty() && one.len() < both);
        assert!(one.iter().all(|g| g.color[3] == 1.0));
        chart.set_series_visible(1, true, &mut scene);
        chart.set_emphasis(Some(1));
        let segs = chart.prepare_layers(&v).series.expect("redrawn").to_vec();
        assert!(segs.iter().any(|g| g.color[3] == DIMMED_SERIES_ALPHA) && segs.iter().any(|g| g.color[3] == 1.0));
        // A series without points (or beyond the series count) draws nothing
        chart.set_emphasis(None);
        chart.set_scatter_trendlines(&[line(7, TrendModel::Linear)]);
        assert!(chart.scatter_trend_fits()[0].coeffs.is_empty());
        assert_eq!(chart.prepare_layers(&v).series.expect("cleared").len(), 0);
        chart.set_scatter_trendlines(&[]);
        assert_eq!(chart.prepare_layers(&v).series.expect("cleared").len(), 0);
    }

    #[test]
    fn curved_fits_are_refined_and_clipped_to_the_plot() {
        let mut chart = chart();
        let cam = framed(&chart);
        let v = view(&cam);
        // Order-6 polynomial of the exponential series overshoots outside the data: clipped
        chart.set_scatter_trendlines(&[line(1, TrendModel::Exponential), line(1, TrendModel::Polynomial(6))]);
        let fits = chart.scatter_trend_fits();
        assert!((fits[0].coeffs[0] - 0.5).abs() < 1e-4 && (fits[0].coeffs[1] - 0.4).abs() < 1e-5, "{:?}", fits[0].coeffs);
        let segs = chart.prepare_layers(&v).series.unwrap().to_vec();
        assert!(segs.len() > 100, "{}", segs.len());
        let s = inner(&chart);
        let hh = s.layout.height * 0.5;
        // CSS px per world unit
        let plot = plot_rect_css(&v, s.layout.width * 0.5, -hh, hh, 0.0).unwrap();
        let (kx, ky) = (plot[2] / s.layout.width, plot[3] / s.layout.height);
        for g in segs.iter().filter(|g| g.color == [0.1, 0.2, 0.3, 1.0]) {
            assert!(g.p0_width[1].abs() <= hh + 1e-3 && g.p1_pad[1].abs() <= hh + 1e-3);
        }
        // Chords of the exponential stay within ~1/4 px of the curve
        let exp_fit = &fits[0];
        let mut worst = 0.0f32;
        for g in &segs {
            let (mx, my) = ((g.p0_width[0] + g.p1_pad[0]) * 0.5, (g.p0_width[1] + g.p1_pad[1]) * 0.5);
            let (x, _) = data_of(s, mx, my);
            let on = s.world_f64(x, exp_fit.eval(TrendModel::Exponential, x));
            if on.1.abs() < hh as f64 {
                worst = worst.max((on.1 as f32 - my).abs() * ky.min(kx));
            }
        }
        assert!(worst < 0.5, "max chord error {worst} px");
    }

    #[test]
    fn log_axes_and_dashes() {
        let mut chart = chart();
        let mut dashed = line(1, TrendModel::Exponential);
        dashed.dash = [6.0, 3.0, 0.0, 0.0];
        chart.set_scatter_trendlines(&[dashed]);
        // Exponential on a log y axis is a straight line
        chart.set_axis_scale(1, AxisScale { kind: ScaleType::Log, ..AxisScale::LINEAR });
        let cam = framed(&chart);
        let v = view(&cam);
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.series.unwrap().len(), 0, "dashed strokes only");
        let segs = layers.series_style.unwrap().dashed.to_vec();
        assert!(!segs.is_empty());
        let s = inner(&chart);
        let fit = &chart.scatter_trend_fits()[0];
        for g in &segs {
            let (x, y) = data_of(s, g.p0_width[0], g.p0_width[1]);
            let want = fit.eval(TrendModel::Exponential, x);
            assert!(((y - want) / want).abs() < 1e-3, "{x}: {y} vs {want}");
            assert_eq!(g.dash, [6.0, 3.0, 0.0, 0.0]);
        }
        // Phase runs on: phase(k + 1) = phase(k) + CSS length of segment k (mod 9)
        let hh = s.layout.height * 0.5;
        let plot = plot_rect_css(&v, s.layout.width * 0.5, -hh, hh, 0.0).unwrap();
        let (kx, ky) = (plot[2] / s.layout.width, plot[3] / s.layout.height);
        for w in segs.windows(2) {
            let len = (((w[0].p1_phase[0] - w[0].p0_width[0]) * kx).powi(2) + ((w[0].p1_phase[1] - w[0].p0_width[1]) * ky).powi(2)).sqrt();
            let expect = (w[0].p1_phase[3] + len).rem_euclid(9.0);
            let diff = (expect - w[1].p1_phase[3]).abs();
            assert!(diff.min(9.0 - diff) < 0.05, "{expect} vs {}", w[1].p1_phase[3]);
        }
        // Logarithmic fit on a log x axis: x > 0 only, sampled evenly in decades
        let mut chart = ChartState::new_scatter(
            ScatterPoints { xs: vec![-1.0, 1.0, 10.0, 100.0, 1000.0], ys: vec![0.0, 1.0, 3.0, 5.0, 7.0], ..Default::default() },
            ScatterLayout::default(),
        );
        chart.set_scatter_trendlines(&[line(0, TrendModel::Logarithmic)]);
        let fit = chart.scatter_trend_fits()[0].clone();
        assert_eq!((fit.used, fit.skipped), (4, 1));
        assert!((fit.coeffs[1] - 2.0 / 10f64.ln()).abs() < 1e-9 && fit.r2 > 0.999_999);
        chart.set_axis_scale(0, AxisScale { kind: ScaleType::Log, ..AxisScale::LINEAR });
        let cam = framed(&chart);
        let segs = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        // y = 1 + 2 log10 x is straight against log x: no refinement beyond the base samples
        assert!(segs.len() <= 4096 && !segs.is_empty());
        let s = inner(&chart);
        for g in &segs {
            let (x, y) = data_of(s, g.p1_pad[0], g.p1_pad[1]);
            assert!((y - fit.eval(TrendModel::Logarithmic, x)).abs() < 1e-3);
        }
        // SVG export draws the trendline in the series group
        let svg = chart.export_svg(&view(&cam), 0, "t").markup;
        assert!(svg.contains("data-layer=\"series\""), "{svg}");
    }
}
