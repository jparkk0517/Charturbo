//! Piecewise colors of line / area series (ECharts `visualMap` `pieces`): intervals of the data y
//! (or x) with their own color; values outside every piece keep the series color.
//!
//! Colors switch exactly at the piece bounds. Every build maps the bounds onto world y (x)
//! through the series axis (log / reversed axes included) and cuts the drawn geometry there,
//! after M4 decimation and curves:
//! - stroke segments (solid and dashed; the dash phase runs on through a cut) are split where
//!   they cross a bound, interpolating linearly along the drawn segment;
//! - area fill triangles are clipped into the slabs between bounds (Sutherland–Hodgman), so a y
//!   piece paints a horizontal band of the fill and an x piece a vertical one, like the gradient
//!   of an ECharts piecewise visualMap;
//! - point markers, the hover marker and the tooltip swatch take the piece of the drawn point.
//!
//! A point exactly on a bound takes the piece that includes it (`gte` / `lte`); where pieces
//! overlap the first one wins (ECharts `findPieceIndex`). Range bands, standalone band series and
//! sparse (error bar / impulse) series ignore pieces.

use super::line::LineChart;
use super::*;

/// Data dimension the pieces of a series test.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PieceDim {
    #[default]
    Y,
    /// Explicit x in data units (epoch ms on a time axis), else the live sample index
    X,
}

/// One piece: an interval of data values and its color.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ColorPiece {
    /// Lower bound (`-inf` = none); `lo_closed` includes it (`gte`), else `gt`
    pub lo: f64,
    pub lo_closed: bool,
    /// Upper bound (`inf` = none); `hi_closed` includes it (`lte`), else `lt`
    pub hi: f64,
    pub hi_closed: bool,
    pub color: [f32; 4],
}

impl ColorPiece {
    pub fn contains(&self, v: f64) -> bool {
        let above = if self.lo_closed { v >= self.lo } else { v > self.lo };
        let below = if self.hi_closed { v <= self.hi } else { v < self.hi };
        above && below
    }
}

/// Pieces of one series.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SeriesPieces {
    pub dim: PieceDim,
    pub pieces: Vec<ColorPiece>,
}

type PieceColor = Option<[f32; 4]>;

impl SeriesPieces {
    /// Color of data value `v`: the first piece containing it; `None` = the series color.
    pub fn color_of(&self, v: f64) -> PieceColor {
        self.pieces.iter().find(|p| p.contains(v)).map(|p| p.color)
    }

    /// Sorted distinct finite bounds, the color on each bound and inside each open interval
    /// around them (`bounds.len() + 1`, from `-inf`). Pieces are unions of these intervals and
    /// bounds, so one interior value classifies a whole interval.
    fn intervals(&self) -> (Vec<f64>, Vec<PieceColor>, Vec<PieceColor>) {
        let mut bounds: Vec<f64> = self.pieces.iter().flat_map(|p| [p.lo, p.hi]).filter(|v| v.is_finite()).collect();
        bounds.sort_unstable_by(f64::total_cmp);
        bounds.dedup();
        let at = bounds.iter().map(|&b| self.color_of(b)).collect();
        let inside = |lo: f64, hi: f64| match (lo.is_finite(), hi.is_finite()) {
            (true, true) => lo + 0.5 * (hi - lo),
            (false, true) => hi - 1.0 - hi.abs(),
            (true, false) => lo + 1.0 + lo.abs(),
            (false, false) => 0.0,
        };
        let between = (0..=bounds.len())
            .map(|k| {
                let lo = if k == 0 { f64::NEG_INFINITY } else { bounds[k - 1] };
                let hi = bounds.get(k).copied().unwrap_or(f64::INFINITY);
                self.color_of(inside(lo, hi))
            })
            .collect();
        (bounds, at, between)
    }
}

/// Pieces of a series mapped onto one world axis for a build.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WorldPieces {
    /// World axis of the cuts: 0 = x, 1 = y
    pub(crate) axis: usize,
    /// Ascending world coordinates of the piece bounds
    cuts: Vec<f32>,
    /// Color on each cut
    at: Vec<PieceColor>,
    /// Color inside each interval around the cuts (`cuts.len() + 1`, from `-inf`)
    between: Vec<PieceColor>,
}

impl WorldPieces {
    /// Maps the bounds through `world` (monotonic, never NaN; a decreasing map = reversed axis).
    /// Bounds landing on the same world coordinate collapse (the data between them is not drawn).
    fn new(axis: usize, pieces: &SeriesPieces, world: impl Fn(f64) -> f32) -> Self {
        let (bounds, mut at, mut between) = pieces.intervals();
        let mut w: Vec<f32> = bounds.iter().map(|&b| world(b)).collect();
        if w.len() > 1 && w[0] > w[w.len() - 1] {
            w.reverse();
            at.reverse();
            between.reverse();
        }
        let mut out = Self { axis, cuts: Vec::with_capacity(w.len()), at: Vec::with_capacity(w.len()), between: vec![between[0]] };
        for (k, &c) in w.iter().enumerate() {
            if out.cuts.last().is_some_and(|&last| c <= last) {
                // The interval before this cut is empty: the one after it follows the kept cut
                *out.between.last_mut().unwrap() = between[k + 1];
                continue;
            }
            out.cuts.push(c);
            out.at.push(at[k]);
            out.between.push(between[k + 1]);
        }
        out
    }

    /// Piece color at world coordinate `c` of the cut axis (`None` = series color / not finite).
    pub(crate) fn color_at(&self, c: f32) -> PieceColor {
        if !c.is_finite() {
            return None;
        }
        let k = self.cuts.partition_point(|&w| w < c);
        if self.cuts.get(k) == Some(&c) {
            self.at[k]
        } else {
            self.between[k]
        }
    }

    /// Splits the segment `a -> b` (world x, y) at the cuts it crosses: `emit(p0, p1, f0, color)`
    /// per piece in order, `f0` = fraction of the segment before `p0`. Cut points land exactly on
    /// the cut coordinate.
    pub(crate) fn split(&self, a: [f32; 2], b: [f32; 2], mut emit: impl FnMut([f32; 2], [f32; 2], f32, PieceColor)) {
        let (c0, c1) = (a[self.axis], b[self.axis]);
        if c0 == c1 {
            emit(a, b, 0.0, self.color_at(c0));
            return;
        }
        let (lo, hi) = (c0.min(c1), c0.max(c1));
        let (k0, k1) = (self.cuts.partition_point(|&w| w <= lo), self.cuts.partition_point(|&w| w < hi));
        // Crossed cuts in segment order (no allocation: this runs for every drawn segment)
        let crossed = &self.cuts[k0..k1];
        let n = crossed.len();
        let (mut p, mut f) = (a, 0.0f32);
        for j in 0..=n {
            let (q, g) = if j == n {
                (b, 1.0)
            } else {
                let c = if c1 < c0 { crossed[n - 1 - j] } else { crossed[j] };
                let g = (c - c0) / (c1 - c0);
                let mut q = [a[0] + (b[0] - a[0]) * g, a[1] + (b[1] - a[1]) * g];
                q[self.axis] = c;
                (q, g)
            };
            let mid = 0.5 * (p[self.axis] + q[self.axis]);
            emit(p, q, f, self.color_at(mid));
            (p, f) = (q, g);
        }
    }

    /// Clips a fill triangle list into the slabs between the cuts; `color` maps each slab's piece
    /// color to the vertex color.
    pub(crate) fn clip_fill(&self, tris: &[ChartFillRaw], color: impl Fn(PieceColor) -> [f32; 4], out: &mut Vec<ChartFillRaw>) {
        let mut poly: Vec<[f32; 2]> = Vec::with_capacity(5);
        let mut tmp: Vec<[f32; 2]> = Vec::with_capacity(5);
        for t in tris.as_chunks::<3>().0 {
            let z = t[0].position[2];
            let c = t.map(|v| v.position[self.axis]);
            let (lo, hi) = (c[0].min(c[1]).min(c[2]), c[0].max(c[1]).max(c[2]));
            for k in 0..self.between.len() {
                let s0 = if k == 0 { f32::NEG_INFINITY } else { self.cuts[k - 1] };
                let s1 = self.cuts.get(k).copied().unwrap_or(f32::INFINITY);
                if s1 <= lo || s0 >= hi {
                    continue;
                }
                let vc = color(self.between[k]);
                let v = |p: [f32; 2]| ChartFillRaw { position: [p[0], p[1], z, 0.0], color: vc };
                if s0 <= lo && s1 >= hi {
                    out.extend(t.map(|r| v([r.position[0], r.position[1]])));
                    continue;
                }
                poly.clear();
                poly.extend(t.iter().map(|r| [r.position[0], r.position[1]]));
                clip_half(&poly, self.axis, s0, true, &mut tmp);
                clip_half(&tmp, self.axis, s1, false, &mut poly);
                for i in 2..poly.len() {
                    out.extend([v(poly[0]), v(poly[i - 1]), v(poly[i])]);
                }
            }
        }
    }
}

/// One Sutherland–Hodgman pass: the part of convex polygon `src` with coordinate `axis` >= `bound`
/// (`keep_above`) or <= `bound`. Intersections land exactly on `bound`.
fn clip_half(src: &[[f32; 2]], axis: usize, bound: f32, keep_above: bool, dst: &mut Vec<[f32; 2]>) {
    dst.clear();
    if !bound.is_finite() {
        dst.extend_from_slice(src);
        return;
    }
    let inside = |p: &[f32; 2]| if keep_above { p[axis] >= bound } else { p[axis] <= bound };
    for (i, p) in src.iter().enumerate() {
        let q = &src[(i + 1) % src.len()];
        let (pin, qin) = (inside(p), inside(q));
        if pin {
            dst.push(*p);
        }
        if pin != qin {
            let f = (bound - p[axis]) / (q[axis] - p[axis]);
            let mut x = [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
            x[axis] = bound;
            dst.push(x);
        }
    }
}

/// `split` with optional pieces: the whole segment with no piece color when `None`.
pub(crate) fn split_segment(
    pieces: Option<&WorldPieces>,
    a: [f32; 2],
    b: [f32; 2],
    mut emit: impl FnMut([f32; 2], [f32; 2], f32, PieceColor),
) {
    match pieces {
        Some(wp) => wp.split(a, b, emit),
        None => emit(a, b, 0.0, None),
    }
}

impl LineChart {
    /// Pieces of series `s` when it draws a plain stroke (not sparse / a standalone band).
    pub(crate) fn pieces_of(&self, s: usize) -> Option<&SeriesPieces> {
        let p = self.style.pieces.get(s)?.as_ref()?;
        let special = self.style.sparse.get(s).is_some_and(Option::is_some) || self.style.band(s).is_some_and(|b| b.edge_widths.is_some());
        (!special && !p.pieces.is_empty()).then_some(p)
    }

    /// Pieces of series `s` on its world axis under the current domains and zoom window, mapped
    /// exactly like the samples (`y_of_axis`, `t_at64`) so a sample on a bound lands on its cut.
    pub(crate) fn world_pieces(&self, s: usize) -> Option<WorldPieces> {
        let p = self.pieces_of(s)?;
        Some(match p.dim {
            PieceDim::Y => {
                let axis = self.axis_of(s);
                let log = self.scale_of_axis(axis).is_log();
                WorldPieces::new(1, p, |v| {
                    // Bounds <= 0 lie below everything a log axis draws
                    let u = if log && v <= 0.0 { f32::NEG_INFINITY } else { self.scale_of_axis(axis).fwd32(v as f32) };
                    self.y_world(axis, u)
                })
            }
            PieceDim::X => {
                let len = self.len(s);
                WorldPieces::new(0, p, |v| {
                    let t = if self.has_x() {
                        let abs = self.x_data_to_abs(v);
                        let abs = if abs.is_nan() { f64::NEG_INFINITY } else { abs };
                        (abs - self.x_origin - self.x_shift()) / self.x_span
                    } else if len > 1 {
                        v / (len - 1) as f64
                    } else {
                        0.5
                    };
                    self.x_of_t(t)
                })
            }
        })
    }

    /// Piece color of drawn sample `i` of series `s` (`None` = series color / no pieces).
    pub(crate) fn piece_color(&self, s: usize, i: usize) -> PieceColor {
        let wp = self.world_pieces(s)?;
        let p = self.point(s, i);
        wp.color_at(if wp.axis == 0 { p.x } else { p.y })
    }
}

impl ChartState {
    /// Piecewise colors of line / area series `s` (`None` or no pieces = the series color only).
    /// Err for other chart kinds, a series out of range, NaN bounds or non-finite colors.
    pub fn set_line_pieces(&mut self, s: usize, pieces: Option<SeriesPieces>) -> Result<(), String> {
        let l = match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l,
            _ => return Err("pieces need a line or area chart".into()),
        };
        if s >= l.series.len() {
            return Err(format!("series {s} out of range ({} series)", l.series.len()));
        }
        if let Some(p) = &pieces {
            if p.pieces.iter().any(|p| p.lo.is_nan() || p.hi.is_nan()) {
                return Err(format!("series {s}: piece bounds must not be NaN"));
            }
            if p.pieces.iter().any(|p| p.color.iter().any(|c| !c.is_finite())) {
                return Err(format!("series {s}: piece colors must be finite"));
            }
        }
        if l.style.pieces.len() < l.series.len() {
            l.style.pieces.resize(l.series.len(), None);
        }
        l.style.pieces[s] = pieces.filter(|p| !p.pieces.is_empty());
        self.on_line_style_changed();
        Ok(())
    }

    /// Piece color of live sample `index` of line / area series `s` at its drawn position
    /// (tooltip swatch); `None` = the series color.
    pub fn line_piece_color(&self, s: usize, index: usize) -> Option<[f32; 4]> {
        let l = match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l,
            _ => return None,
        };
        if s >= l.series.len() || index >= l.len(s) {
            return None;
        }
        l.piece_color(s, index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::ChartDashSegmentRaw;

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const GREEN: [f32; 4] = [0.0, 1.0, 0.0, 1.0];
    const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];
    const INF: f64 = f64::INFINITY;
    const LAYOUT: LineLayout = LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric };

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn series(values: Vec<Vec<f32>>, x: Option<Vec<f64>>) -> Vec<LineSeries> {
        values.into_iter().map(|values| LineSeries { values, x: x.clone(), color: RED, width_px: 2.0 }).collect()
    }

    fn framed(chart: ChartState) -> (OrbitCamera, ChartState) {
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn line_state(values: Vec<Vec<f32>>, x: Option<Vec<f64>>) -> (OrbitCamera, ChartState) {
        framed(ChartState::new_line(series(values, x), LAYOUT))
    }

    fn area_state(values: Vec<Vec<f32>>, x: Option<Vec<f64>>, mode: AreaMode) -> (OrbitCamera, ChartState) {
        framed(ChartState::new_area(series(values, x), LAYOUT, mode, 0.5))
    }

    fn line(chart: &ChartState) -> &LineChart {
        match &chart.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l,
            _ => unreachable!(),
        }
    }

    /// Pieces from `(lo, lo_closed, hi, hi_closed, color)`.
    fn pieces(dim: PieceDim, p: &[(f64, bool, f64, bool, [f32; 4])]) -> Option<SeriesPieces> {
        let pieces = p.iter().map(|&(lo, lo_closed, hi, hi_closed, color)| ColorPiece { lo, lo_closed, hi, hi_closed, color }).collect();
        Some(SeriesPieces { dim, pieces })
    }

    /// `lt 50` green, `gte 50` blue.
    fn split_at_50() -> Option<SeriesPieces> {
        pieces(PieceDim::Y, &[(-INF, false, 50.0, false, GREEN), (50.0, true, INF, false, BLUE)])
    }

    type Frame = (Vec<ChartSegmentRaw>, Vec<ChartDashSegmentRaw>, Vec<ChartMarkerRaw>, Vec<ChartFillRaw>);

    fn frame(chart: &mut ChartState, cam: &OrbitCamera) -> Frame {
        let layers = chart.prepare_layers(&view(cam));
        let st = layers.series_style.unwrap();
        (
            layers.series.unwrap().to_vec(),
            st.dashed.to_vec(),
            st.markers.to_vec(),
            layers.fills.map(|f| f.to_vec()).unwrap_or_default(),
        )
    }

    fn colors(segs: &[ChartSegmentRaw]) -> Vec<[f32; 4]> {
        segs.iter().map(|s| s.color).collect()
    }

    fn tri_area(t: &[ChartFillRaw]) -> f32 {
        let [a, b, c] = [t[0].position, t[1].position, t[2].position];
        0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])).abs()
    }

    fn total_area(fills: &[ChartFillRaw]) -> f32 {
        fills.as_chunks::<3>().0.iter().map(|t| tri_area(t)).sum()
    }

    /// Every segment lies inside the world interval of its color: `cuts` ascending, `bands[k]`
    /// the color below `cuts[k]` (the last one above every cut).
    fn assert_banded(segs: &[ChartSegmentRaw], axis: usize, cuts: &[f32], bands: &[[f32; 4]]) {
        assert!(!segs.is_empty());
        for s in segs {
            let (a, b) = (s.p0_width[axis], s.p1_pad[axis]);
            let inside = (0..bands.len()).filter(|&k| bands[k] == s.color).any(|k| {
                let lo = if k == 0 { f32::NEG_INFINITY } else { cuts[k - 1] };
                let hi = cuts.get(k).copied().unwrap_or(f32::INFINITY);
                a.min(b) >= lo - 1e-3 && a.max(b) <= hi + 1e-3
            });
            assert!(inside, "{:?} segment {a}..{b} outside its band", s.color);
        }
    }

    #[test]
    fn stroke_switches_color_exactly_at_y_bounds() {
        let (cam, mut chart) = line_state(vec![vec![0.0, 100.0, 0.0]], None);
        chart.set_line_pieces(0, split_at_50()).unwrap();
        let (segs, ..) = frame(&mut chart, &cam);
        let l = line(&chart);
        let y50 = l.y_of(50.0);
        assert_eq!(colors(&segs), vec![GREEN, BLUE, BLUE, GREEN]);
        // Cut points sit exactly on the bound, half way along the segments; the path stays joined
        assert_eq!(segs[0].p1_pad[1], y50);
        assert_eq!(segs[2].p1_pad[1], y50);
        assert!((segs[0].p1_pad[0] - 0.5 * (l.x_at(0, 0) + l.x_at(0, 1))).abs() < 1e-4);
        for w in segs.windows(2) {
            assert_eq!(w[0].p1_pad[..2], w[1].p0_width[..2]);
        }
        assert_eq!(segs[3].p1_pad[..2], [l.x_at(0, 2), l.y_of(0.0)]);

        // Outside every piece: the series color
        chart.set_line_pieces(0, pieces(PieceDim::Y, &[(50.0, true, INF, false, BLUE)])).unwrap();
        assert_eq!(colors(&frame(&mut chart, &cam).0), vec![RED, BLUE, BLUE, RED]);

        // Clearing restores the plain stroke
        chart.set_line_pieces(0, None).unwrap();
        assert_eq!(colors(&frame(&mut chart, &cam).0), vec![RED, RED]);
    }

    #[test]
    fn points_on_a_bound_take_the_piece_that_includes_it_and_the_first_piece_wins() {
        let (cam, mut chart) = line_state(vec![vec![50.0, 50.0, 80.0]], None);
        let mut st = LineSeriesStyle::default();
        st.marker = Some(SeriesMarker { show: MarkerShow::Always, ..Default::default() });
        chart.set_line_styles(vec![st]);
        chart.set_line_pieces(0, split_at_50()).unwrap();
        let (segs, _, markers, _) = frame(&mut chart, &cam);
        assert_eq!(colors(&segs), vec![BLUE, BLUE], "gte 50 includes the flat run on 50");
        assert_eq!(markers.iter().map(|m| m.fill).collect::<Vec<_>>(), vec![BLUE, BLUE, BLUE]);
        // lte 50 listed first wins over gte 50
        chart.set_line_pieces(0, pieces(PieceDim::Y, &[(-INF, false, 50.0, true, GREEN), (50.0, true, INF, false, BLUE)])).unwrap();
        let (segs, _, markers, _) = frame(&mut chart, &cam);
        assert_eq!(colors(&segs), vec![GREEN, BLUE]);
        assert_eq!(markers.iter().map(|m| m.fill).collect::<Vec<_>>(), vec![GREEN, GREEN, BLUE]);
        // An explicit marker fill stays
        st.marker = Some(SeriesMarker { show: MarkerShow::Always, fill: Some(RED), ..Default::default() });
        chart.set_line_styles(vec![st]);
        assert!(frame(&mut chart, &cam).2.iter().all(|m| m.fill == RED));
    }

    #[test]
    fn step_monotone_and_dashed_strokes_split_at_the_bound() {
        let (cam, mut chart) = line_state(vec![vec![0.0, 100.0, 0.0, 100.0]], None);
        chart.set_line_pieces(0, split_at_50()).unwrap();
        let y50 = line(&chart).y_of(50.0);
        let cuts = [y50];
        // Step after: the vertical risers are split
        let mut st = LineSeriesStyle { curve: LineCurve::StepAfter, ..Default::default() };
        chart.set_line_styles(vec![st]);
        let (segs, ..) = frame(&mut chart, &cam);
        assert_eq!(colors(&segs), vec![GREEN, GREEN, BLUE, BLUE, BLUE, GREEN, GREEN, GREEN, BLUE]);
        assert_banded(&segs, 1, &cuts, &[GREEN, BLUE]);
        // Monotone: tessellated pieces are split too
        st.curve = LineCurve::Monotone;
        chart.set_line_styles(vec![st]);
        let (segs, ..) = frame(&mut chart, &cam);
        assert_banded(&segs, 1, &cuts, &[GREEN, BLUE]);
        assert!(segs.iter().any(|s| s.color == GREEN) && segs.iter().any(|s| s.color == BLUE));
        // Dashed: split pieces keep the pattern phase running on along the stroke
        st.curve = LineCurve::Linear;
        st.dash = normalize_dash(&[6.0, 3.0]);
        chart.set_line_styles(vec![st]);
        let (segs, dashed, ..) = frame(&mut chart, &cam);
        assert!(segs.is_empty());
        assert_eq!(dashed.iter().map(|d| d.color).collect::<Vec<_>>(), vec![GREEN, BLUE, BLUE, GREEN, GREEN, BLUE]);
        let v = view(&cam);
        let css = |p: [f32; 4]| v.project_css(Vec3::new(p[0], p[1], p[2])).unwrap();
        for w in dashed.windows(2) {
            let (a, b) = (css(w[0].p0_width), css(w[0].p1_phase));
            let len = ((b.0 - a.0).powi(2) + (b.1 - a.1).powi(2)).sqrt();
            let expect = (w[0].p1_phase[3] + len).rem_euclid(9.0);
            let got = w[1].p1_phase[3];
            let diff = (expect - got).abs().min(9.0 - (expect - got).abs());
            assert!(diff < 0.05, "phase {got} vs {expect}");
        }
    }

    #[test]
    fn decimated_zoomed_streamed_and_reversed_series_stay_exact() {
        let values: Vec<f32> = (0..200_000).map(|i| 100.0 * (i as f32 * 0.001).sin()).collect();
        let (cam, mut chart) = line_state(vec![values], None);
        let three = pieces(PieceDim::Y, &[(-INF, false, -50.0, false, GREEN), (-50.0, true, 50.0, false, BLUE), (50.0, true, INF, false, RED)]);
        chart.set_line_pieces(0, three).unwrap();
        let check = |chart: &mut ChartState| {
            let (segs, ..) = frame(chart, &cam);
            let l = line(chart);
            let (a, b) = (l.y_of(-50.0), l.y_of(50.0));
            if a < b {
                assert_banded(&segs, 1, &[a, b], &[GREEN, BLUE, RED]);
            } else {
                assert_banded(&segs, 1, &[b, a], &[RED, BLUE, GREEN]);
            }
            assert!([GREEN, BLUE, RED].iter().all(|c| segs.iter().any(|s| s.color == *c)));
            segs.len()
        };
        assert!(check(&mut chart) < 50_000, "M4 decimated");
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&view(&cam), 0.05, c.x);
        check(&mut chart);
        chart.append_series_data(0, &(0..5_000).map(|i| 100.0 * (i as f32 * 0.003).cos()).collect::<Vec<_>>(), None, 150_000).unwrap();
        check(&mut chart);
        chart.set_axis_scale(1, AxisScale { reverse: true, ..AxisScale::LINEAR });
        check(&mut chart);
    }

    #[test]
    fn log_axis_cuts_where_the_drawn_line_crosses() {
        let (cam, mut chart) = line_state(vec![vec![1.0, 1000.0]], None);
        chart.set_axis_scale(1, AxisScale { kind: ScaleType::Log, ..AxisScale::LINEAR });
        chart.set_line_pieces(0, pieces(PieceDim::Y, &[(-INF, false, 0.0, true, GREEN), (10.0, true, INF, false, BLUE)])).unwrap();
        let (segs, ..) = frame(&mut chart, &cam);
        let l = line(&chart);
        assert_eq!(colors(&segs), vec![RED, BLUE], "<= 0 is never drawn on a log axis");
        // log10(10) is a third of the way from 1 to 1000
        let x = l.x_at(0, 0) + (l.x_at(0, 1) - l.x_at(0, 0)) / 3.0;
        assert!((segs[0].p1_pad[0] - x).abs() < 1e-3);
        assert_eq!(segs[0].p1_pad[1], l.y_of(10.0));
    }

    #[test]
    fn x_pieces_color_stroke_and_fill_by_x_range() {
        let x: Vec<f64> = (0..=10).map(|i| i as f64).collect();
        let (cam, mut chart) = area_state(vec![vec![5.0; 11]], Some(x), AreaMode::Overlap);
        let plain = total_area(&frame(&mut chart, &cam).3);
        chart.set_line_pieces(0, pieces(PieceDim::X, &[(2.0, true, 4.5, true, GREEN)])).unwrap();
        let (segs, _, _, fills) = frame(&mut chart, &cam);
        let l = line(&chart);
        let (x2, x45) = (l.x_of_t(0.2), l.x_of_t(0.45));
        assert_banded(&segs, 0, &[x2, x45], &[RED, GREEN, RED]);
        assert!(segs.iter().any(|s| s.p1_pad[0] == x45 && s.color == GREEN), "cut inside a segment");
        // Fill: alpha x 0.5 opacity; green triangles inside [2, 4.5], the rest outside; same area
        let (g, r) = ([0.0, 1.0, 0.0, 0.5], [1.0, 0.0, 0.0, 0.5]);
        for t in fills.as_chunks::<3>().0 {
            let xs = t.map(|v| v.position[0]);
            let (lo, hi) = (xs[0].min(xs[1]).min(xs[2]), xs[0].max(xs[1]).max(xs[2]));
            match t[0].color {
                c if c == g => assert!(lo >= x2 - 1e-4 && hi <= x45 + 1e-4),
                c if c == r => assert!(hi <= x2 + 1e-4 || lo >= x45 - 1e-4),
                c => panic!("{c:?}"),
            }
        }
        assert!((total_area(&fills) - plain).abs() < 1e-3 * plain);

        // Index placement: bounds are sample indices
        let (cam, mut chart) = line_state(vec![vec![1.0, 2.0, 3.0, 4.0]], None);
        chart.set_line_pieces(0, pieces(PieceDim::X, &[(1.0, true, 2.0, false, GREEN)])).unwrap();
        assert_eq!(colors(&frame(&mut chart, &cam).0), vec![RED, GREEN, RED]);
    }

    #[test]
    fn y_pieces_cut_area_fills_into_horizontal_bands() {
        let (cam, mut chart) = area_state(vec![vec![10.0, 30.0], vec![0.0, 100.0]], None, AreaMode::Stacked);
        let plain = total_area(&frame(&mut chart, &cam).3);
        // Stacked: the top series is drawn at 10..130; bands follow the drawn (stacked) height
        chart.set_line_pieces(1, split_at_50()).unwrap();
        let (_, _, _, fills) = frame(&mut chart, &cam);
        let y50 = line(&chart).y_of(50.0);
        let (r, g, b) = ([1.0, 0.0, 0.0, 0.5], [0.0, 1.0, 0.0, 0.5], [0.0, 0.0, 1.0, 0.5]);
        let mut seen = [0; 3];
        for t in fills.as_chunks::<3>().0 {
            let ys = t.map(|v| v.position[1]);
            let (lo, hi) = (ys[0].min(ys[1]).min(ys[2]), ys[0].max(ys[1]).max(ys[2]));
            match t[0].color {
                c if c == r => seen[0] += 1,
                c if c == g => {
                    seen[1] += 1;
                    assert!(hi <= y50 + 1e-4);
                }
                c if c == b => {
                    seen[2] += 1;
                    assert!(lo >= y50 - 1e-4);
                }
                c => panic!("{c:?}"),
            }
        }
        assert!(seen.iter().all(|&n| n > 0), "{seen:?}");
        assert!((total_area(&fills) - plain).abs() < 1e-3 * plain);
        // The swatch / hover color follows the drawn top: 10 + 0 = 10 -> green, 30 + 100 -> blue
        assert_eq!(chart.line_piece_color(1, 0), Some(GREEN));
        assert_eq!(chart.line_piece_color(1, 1), Some(BLUE));
        assert_eq!(chart.line_piece_color(0, 1), None);
    }

    #[test]
    fn hover_marker_and_svg_follow_the_pieces() {
        let (cam, mut chart) = line_state(vec![vec![0.0, 100.0, 0.0]], None);
        chart.set_line_pieces(0, split_at_50()).unwrap();
        let l = line(&chart);
        let ndc = cam.project_to_ndc(l.point(0, 1)).unwrap();
        let hit = l.hover(&view(&cam), (ndc.x, ndc.y), &ChartHoverStyle::default()).unwrap();
        let (mut overlay, mut markers) = (Vec::new(), Vec::new());
        l.build_overlay(&hit, &ChartHoverStyle::default(), &mut overlay, &mut markers);
        assert_eq!(markers[0].fill, BLUE);
        assert_eq!((chart.line_piece_color(0, 0), chart.line_piece_color(0, 1)), (Some(GREEN), Some(BLUE)));
        assert_eq!(chart.line_piece_color(0, 3), None, "out of range");
        frame(&mut chart, &cam);
        let svg = chart.export_svg(&view(&cam), 0, "pieces").markup;
        assert!(svg.contains("stroke=\"rgb(0,255,0)\"") && svg.contains("stroke=\"rgb(0,0,255)\""), "{svg}");
        assert!(!svg.contains("stroke=\"rgb(255,0,0)\""));
    }

    #[test]
    fn set_line_pieces_validates() {
        let (_, mut chart) = line_state(vec![vec![1.0, 2.0]], None);
        assert!(chart.set_line_pieces(1, split_at_50()).is_err());
        assert!(chart.set_line_pieces(0, pieces(PieceDim::Y, &[(f64::NAN, false, 1.0, false, GREEN)])).is_err());
        assert!(chart.set_line_pieces(0, pieces(PieceDim::Y, &[(0.0, false, 1.0, false, [f32::NAN; 4])])).is_err());
        assert!(chart.set_line_pieces(0, pieces(PieceDim::Y, &[])).is_ok());
        assert_eq!(line(&chart).pieces_of(0), None, "empty = none");
        let mut scene = SceneWorld::new();
        let layout = BarLayout { width: 160.0, max_height: 80.0, bar_width: 0.0, corner_radius_px: 0.0, view: ChartViewMode::Flat };
        let mut bar = ChartState::new_bar(vec![1.0], vec![RED], layout, &mut scene);
        assert!(bar.set_line_pieces(0, split_at_50()).is_err());
    }
}
