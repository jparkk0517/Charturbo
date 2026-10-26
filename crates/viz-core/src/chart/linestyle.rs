//! Per-series line styles of line / area charts: point markers, dash patterns, step / monotone
//! curves, null policies, and range bands (error bands).
//!
//! Every style is geometry built on the CPU from the M4 picks (`LineChart::lod_picks`), so it
//! follows the decimated strokes at any zoom:
//! - curves are applied after decimation; monotone smoothing (Fritsch–Carlson, never
//!   overshooting) is tessellated adaptively in screen px and skipped where the picks are denser
//!   than `SMOOTH_MIN_PX`;
//! - dashes are drawn by the dash-segment shader from a `[on, off, on, off]` pattern and the
//!   pattern phase at each segment start: the cumulative CSS-px length along the polyline,
//!   anchored to data x so panning keeps the dashes in place;
//! - markers use the marker pipeline (shape code in `ChartMarkerRaw::params[1]`);
//! - bands are fill triangles (`band_triangles`) beneath the strokes, decimated per pixel
//!   column keeping the extremes (lowest lower / highest upper edge).

use super::line::{LineChart, LodWindow, DIMMED_SERIES_ALPHA};
use super::*;
use crate::renderer::ChartDashSegmentRaw;

/// `MarkerShow::Auto` draws markers while the visible picks are at least this far apart (CSS px).
pub const AUTO_MARKER_MIN_PX: f32 = 8.0;
/// Monotone smoothing is skipped where picks are closer than this on average (physical px).
pub const SMOOTH_MIN_PX: f32 = 2.0;
/// Target length of the straight pieces of a tessellated monotone curve (physical px).
const CURVE_STEP_PX: f32 = 4.0;
/// Upper bound of pieces per curve span (very steep spans at extreme zoom).
const CURVE_MAX_PIECES: usize = 64;
/// Default band fill alpha multiplier of the series color.
pub const DEFAULT_BAND_OPACITY: f32 = 0.2;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MarkerShape {
    #[default]
    Circle,
    Square,
    Diamond,
    /// Equilateral, pointing up
    Triangle,
}

impl MarkerShape {
    /// Shape of a marker code (0 circle, 1 square, 2 diamond, 3 triangle); `None` otherwise.
    pub fn from_code(v: f32) -> Option<Self> {
        if v.fract() != 0.0 {
            return None;
        }
        match v as i32 {
            0 => Some(Self::Circle),
            1 => Some(Self::Square),
            2 => Some(Self::Diamond),
            3 => Some(Self::Triangle),
            _ => None,
        }
    }

    /// Shader shape code (`ChartMarkerRaw::params[1]`).
    pub fn code(self) -> f32 {
        self as u8 as f32
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum MarkerShow {
    /// Only while the visible points are sparse (`AUTO_MARKER_MIN_PX` apart after LOD)
    #[default]
    Auto,
    Always,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LineCurve {
    #[default]
    Linear,
    /// Steps half way between samples
    Step,
    /// Vertical first: the step happens at the earlier sample
    StepBefore,
    /// Horizontal first: the step happens at the later sample
    StepAfter,
    /// Monotone cubic (Fritsch–Carlson): smooth, never overshoots the samples
    Monotone,
}

impl LineCurve {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Step,
            2 => Self::StepBefore,
            3 => Self::StepAfter,
            4 => Self::Monotone,
            _ => Self::Linear,
        }
    }
}

/// What missing samples (non-finite values) do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum NullPolicy {
    /// Break the line / area (default)
    #[default]
    Gap,
    /// Skip the sample: neighbours are joined (stacked areas interpolate it)
    Connect,
    /// Draw the sample at 0
    Zero,
}

impl NullPolicy {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Connect,
            2 => Self::Zero,
            _ => Self::Gap,
        }
    }
}

/// Data point markers of a series.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SeriesMarker {
    pub shape: MarkerShape,
    /// Diameter in CSS px
    pub size_px: f32,
    /// `None` = series color
    pub fill: Option<[f32; 4]>,
    /// `None` = the hover ring color (chart surface)
    pub stroke: Option<[f32; 4]>,
    pub stroke_px: f32,
    pub show: MarkerShow,
}

impl Default for SeriesMarker {
    fn default() -> Self {
        Self {
            shape: MarkerShape::Circle,
            size_px: 6.0,
            fill: None,
            stroke: None,
            stroke_px: 1.0,
            show: MarkerShow::Auto,
        }
    }
}

/// Style of one line / area series (`Default` = today's plain solid linear stroke).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct LineSeriesStyle {
    /// `None` = no markers
    pub marker: Option<SeriesMarker>,
    /// `[on, off, on, off]` CSS px; all zero = solid (see `normalize_dash`)
    pub dash: [f32; 4],
    pub curve: LineCurve,
    pub nulls: NullPolicy,
}

impl LineSeriesStyle {
    pub fn dashed(&self) -> bool {
        self.dash[0] + self.dash[2] > 0.0 && self.dash[1] + self.dash[3] > 0.0
    }
}

/// Dash pattern of up to 4 CSS-px lengths as `[on, off, on, off]`: one value `a` = `[a, a]`
/// (like CSS `setLineDash`), three values use the first two, more than four the first four.
/// Negative / non-finite lengths, no "on" or no "off" length = solid (all zero).
pub fn normalize_dash(v: &[f32]) -> [f32; 4] {
    if v.iter().any(|d| !d.is_finite() || *d < 0.0) {
        return [0.0; 4];
    }
    let d = match v {
        [] => [0.0; 4],
        [a] => [*a, *a, 0.0, 0.0],
        [a, b] | [a, b, _] => [*a, *b, 0.0, 0.0],
        [a, b, c, e, ..] => [*a, *b, *c, *e],
    };
    let style = LineSeriesStyle { dash: d, ..Default::default() };
    if style.dashed() {
        d
    } else {
        [0.0; 4]
    }
}

/// Range band of a series: lower / upper edges aligned with the stored samples (including a
/// trimmed prefix, like `LineSeries::values`).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SeriesBand {
    pub(crate) lower: Vec<f32>,
    pub(crate) upper: Vec<f32>,
    pub(crate) opacity: f32,
}

/// Styles of every series of a `LineChart` (empty = defaults).
#[derive(Debug, Clone, Default)]
pub(crate) struct LineStyles {
    pub(crate) series: Vec<LineSeriesStyle>,
    pub(crate) bands: Vec<Option<SeriesBand>>,
    /// Extra y extent of each series: its band, and 0 for `Zero` series with missing samples
    /// (`(INF, -INF)` = none). Streaming only widens it.
    extra: Vec<(f32, f32)>,
}

const NO_EXTENT: (f32, f32) = (f32::INFINITY, f32::NEG_INFINITY);

fn widen(e: (f32, f32), values: &[f32], positive: bool) -> (f32, f32) {
    values
        .iter()
        .filter(|v| v.is_finite() && (!positive || **v > 0.0))
        .fold(e, |(lo, hi), &v| (lo.min(v), hi.max(v)))
}

impl LineStyles {
    #[inline]
    pub(crate) fn get(&self, s: usize) -> LineSeriesStyle {
        self.series.get(s).copied().unwrap_or_default()
    }

    #[inline]
    pub(crate) fn nulls(&self, s: usize) -> NullPolicy {
        self.series.get(s).map_or(NullPolicy::Gap, |st| st.nulls)
    }

    pub(crate) fn band(&self, s: usize) -> Option<&SeriesBand> {
        self.bands.get(s).and_then(Option::as_ref)
    }

    pub(crate) fn any_dash(&self) -> bool {
        self.series.iter().any(LineSeriesStyle::dashed)
    }

    pub(crate) fn any_marker(&self) -> bool {
        self.series.iter().any(|st| st.marker.is_some())
    }

    pub(crate) fn extra_extent(&self, s: usize) -> (f32, f32) {
        self.extra.get(s).copied().unwrap_or(NO_EXTENT)
    }

    /// Band extent over live samples `i0..=i1` (visible autoscale).
    pub(crate) fn window_extent(&self, s: usize, head: usize, i0: usize, i1: usize, positive: bool) -> (f32, f32) {
        let Some(b) = self.band(s) else {
            return NO_EXTENT;
        };
        let (a, z) = ((head + i0).min(b.lower.len()), (head + i1 + 1).min(b.lower.len()));
        let e = widen(NO_EXTENT, &b.lower[a..z], positive);
        widen(e, &b.upper[a..z], positive)
    }

    /// Recomputes the extra extent of series `s` from its stored `values` (O(samples)).
    fn rescan(&mut self, s: usize, values: &[f32]) {
        if self.extra.len() <= s {
            self.extra.resize(s + 1, NO_EXTENT);
        }
        let mut e = NO_EXTENT;
        if let Some(b) = self.band(s) {
            e = widen(widen(e, &b.lower, false), &b.upper, false);
        }
        if self.nulls(s) == NullPolicy::Zero && values.iter().any(|v| !v.is_finite()) {
            e = (e.0.min(0.0), e.1.max(0.0));
        }
        self.extra[s] = e;
    }

    /// Series data replaced: a band of another length no longer lines up and is dropped.
    pub(crate) fn on_set_data(&mut self, s: usize, values: &[f32]) {
        if self.band(s).is_some_and(|b| b.lower.len() != values.len()) {
            self.bands[s] = None;
        }
        if s < self.extra.len() {
            self.rescan(s, values);
        }
    }

    /// Samples appended (`stored_len` = new stored length): bands grow by missing edges.
    pub(crate) fn on_append(&mut self, s: usize, appended: &[f32], stored_len: usize) {
        if let Some(Some(b)) = self.bands.get_mut(s) {
            b.lower.resize(stored_len, f32::NAN);
            b.upper.resize(stored_len, f32::NAN);
        }
        if self.nulls(s) == NullPolicy::Zero && appended.iter().any(|v| !v.is_finite()) {
            if let Some(e) = self.extra.get_mut(s) {
                *e = (e.0.min(0.0), e.1.max(0.0));
            }
        }
    }

    /// The first `n` stored samples were compacted away.
    pub(crate) fn drain_front(&mut self, s: usize, n: usize) {
        if let Some(Some(b)) = self.bands.get_mut(s) {
            b.lower.drain(..n.min(b.lower.len()));
            b.upper.drain(..n.min(b.upper.len()));
        }
    }
}

/// Values with missing samples resolved per `policy` (stacked areas): `Zero` -> 0, `Connect` ->
/// linear interpolation between the finite neighbours (by `x` when given, else by index; leading
/// / trailing gaps stay missing), `Gap` -> unchanged.
pub(crate) fn fill_missing(values: &[f32], policy: NullPolicy, x: Option<&[f64]>) -> Vec<f32> {
    let mut out = values.to_vec();
    match policy {
        NullPolicy::Gap => {}
        NullPolicy::Zero => out.iter_mut().filter(|v| !v.is_finite()).for_each(|v| *v = 0.0),
        NullPolicy::Connect => {
            let pos = |i: usize| x.map_or(i as f64, |x| x[i]);
            let mut prev: Option<usize> = None;
            for i in 0..values.len() {
                if !values[i].is_finite() {
                    continue;
                }
                if let Some(p) = prev.filter(|&p| i > p + 1) {
                    let (x0, x1) = (pos(p), pos(i));
                    for (k, v) in out.iter_mut().enumerate().take(i).skip(p + 1) {
                        let f = if x1 > x0 { (pos(k) - x0) / (x1 - x0) } else { 0.5 };
                        *v = values[p] + (values[i] - values[p]) * f as f32;
                    }
                }
                prev = Some(i);
            }
        }
    }
    out
}

// -----------------------------------------------------------------------------
// Paths and curves
// -----------------------------------------------------------------------------

/// World-space polyline sharing x between one or two y channels (`y2` empty = one channel).
/// Rows with a non-finite coordinate break the path into runs.
#[derive(Debug, Default, Clone)]
pub(crate) struct Path {
    pub(crate) x: Vec<f32>,
    pub(crate) y: Vec<f32>,
    pub(crate) y2: Vec<f32>,
}

impl Path {
    fn clear(&mut self) {
        self.x.clear();
        self.y.clear();
        self.y2.clear();
    }

    #[inline]
    fn two(&self) -> bool {
        !self.y2.is_empty()
    }

    #[inline]
    fn push(&mut self, two: bool, x: f32, y: f32, y2: f32) {
        self.x.push(x);
        self.y.push(y);
        if two {
            self.y2.push(y2);
        }
    }

    #[inline]
    fn ok(&self, i: usize) -> bool {
        self.x[i].is_finite() && self.y[i].is_finite() && (!self.two() || self.y2[i].is_finite())
    }

    #[inline]
    fn y2_at(&self, i: usize) -> f32 {
        if self.two() {
            self.y2[i]
        } else {
            0.0
        }
    }

    /// Appends a row, dropping exact repeats of the previous one (steps of equal values).
    fn push_dedup(&mut self, two: bool, x: f32, y: f32, y2: f32) {
        let n = self.x.len();
        if n > 0 && self.x[n - 1] == x && self.y[n - 1] == y && (!two || self.y2[n - 1] == y2) {
            return;
        }
        self.push(two, x, y, y2);
    }
}

/// Fritsch–Carlson tangents (dy/dx) of a monotone cubic through `(x, y)`: averaged secants
/// (zero at local extrema), one-sided at the ends, limited to the monotonicity region
/// `alpha^2 + beta^2 <= 9` of every span. Zero-width spans get zero secants.
fn monotone_tangents(x: &[f32], y: &[f32], m: &mut Vec<f32>) {
    let n = x.len();
    m.clear();
    m.resize(n, 0.0);
    if n < 2 {
        return;
    }
    let secant = |k: usize| {
        let h = x[k + 1] - x[k];
        if h != 0.0 {
            (y[k + 1] - y[k]) / h
        } else {
            0.0
        }
    };
    m[0] = secant(0);
    m[n - 1] = secant(n - 2);
    for (k, mk) in m.iter_mut().enumerate().take(n - 1).skip(1) {
        let (d0, d1) = (secant(k - 1), secant(k));
        *mk = if d0 * d1 > 0.0 { 0.5 * (d0 + d1) } else { 0.0 };
    }
    for k in 0..n - 1 {
        let d = secant(k);
        if d == 0.0 {
            m[k] = 0.0;
            m[k + 1] = 0.0;
            continue;
        }
        let (a, b) = (m[k] / d, m[k + 1] / d);
        let s = a * a + b * b;
        if s > 9.0 {
            let t = 3.0 / s.sqrt();
            m[k] = t * a * d;
            m[k + 1] = t * b * d;
        }
    }
}

/// Cubic Hermite value at `t` in [0, 1] of a span from `y0` to `y1` with end slopes `m0`, `m1`
/// (already multiplied by the span width).
#[inline]
fn hermite(y0: f32, y1: f32, m0: f32, m1: f32, t: f32) -> f32 {
    let (t2, t3) = (t * t, t * t * t);
    (2.0 * t3 - 3.0 * t2 + 1.0) * y0 + (t3 - 2.0 * t2 + t) * m0 + (-2.0 * t3 + 3.0 * t2) * y1 + (t3 - t2) * m1
}

/// Scratch buffers of `apply_curve`.
#[derive(Debug, Default)]
pub(crate) struct CurveScratch {
    m: Vec<f32>,
    m2: Vec<f32>,
}

/// Re-shapes every finite run of `src` with `curve` into `dst` (runs separated by NaN rows).
/// `px_per_world`: physical px per world unit (curve tessellation density, smoothing cutoff).
/// Both y channels share the output x, so band edges stay aligned.
pub(crate) fn apply_curve(curve: LineCurve, px_per_world: f32, src: &Path, dst: &mut Path, sc: &mut CurveScratch) {
    dst.clear();
    let two = src.two();
    let n = src.x.len();
    let mut i = 0;
    while i < n {
        if !src.ok(i) {
            i += 1;
            continue;
        }
        let a = i;
        while i < n && src.ok(i) {
            i += 1;
        }
        let b = i;
        if !dst.x.is_empty() {
            dst.push(two, f32::NAN, f32::NAN, f32::NAN);
        }
        let row = |k: usize| (src.x[k], src.y[k], src.y2_at(k));
        match curve {
            LineCurve::Linear => (a..b).for_each(|k| {
                let (x, y, y2) = row(k);
                dst.push(two, x, y, y2);
            }),
            LineCurve::Step | LineCurve::StepBefore | LineCurve::StepAfter => {
                let (x, y, y2) = row(a);
                dst.push(two, x, y, y2);
                for k in a + 1..b {
                    let ((x0, y0, z0), (x1, y1, z1)) = (row(k - 1), row(k));
                    match curve {
                        LineCurve::StepAfter => dst.push_dedup(two, x1, y0, z0),
                        LineCurve::StepBefore => dst.push_dedup(two, x0, y1, z1),
                        _ => {
                            let xm = 0.5 * (x0 + x1);
                            dst.push_dedup(two, xm, y0, z0);
                            dst.push_dedup(two, xm, y1, z1);
                        }
                    }
                    dst.push_dedup(two, x1, y1, z1);
                }
            }
            LineCurve::Monotone => monotone_run(src, a, b, px_per_world, dst, sc),
        }
    }
}

/// Monotone cubic through rows `a..b` of `src` (straight where picks are denser than
/// `SMOOTH_MIN_PX`), each span cut into pieces of about `CURVE_STEP_PX`.
fn monotone_run(src: &Path, a: usize, b: usize, ppw: f32, dst: &mut Path, sc: &mut CurveScratch) {
    let two = src.two();
    let (x, y) = (&src.x[a..b], &src.y[a..b]);
    let n = b - a;
    let spacing = if n > 1 { (x[n - 1] - x[0]).abs() * ppw / (n - 1) as f32 } else { 0.0 };
    if n < 3 || spacing < SMOOTH_MIN_PX {
        for k in a..b {
            dst.push(two, src.x[k], src.y[k], src.y2_at(k));
        }
        return;
    }
    monotone_tangents(x, y, &mut sc.m);
    if two {
        monotone_tangents(x, &src.y2[a..b], &mut sc.m2);
    }
    dst.push(two, x[0], y[0], src.y2_at(a));
    for k in 0..n - 1 {
        let h = x[k + 1] - x[k];
        let (z0, z1) = (src.y2_at(a + k), src.y2_at(a + k + 1));
        if h == 0.0 {
            dst.push(two, x[k + 1], y[k + 1], z1);
            continue;
        }
        let reach = h.abs().max((y[k + 1] - y[k]).abs()).max((z1 - z0).abs()) * ppw;
        let pieces = ((reach / CURVE_STEP_PX).ceil() as usize).clamp(1, CURVE_MAX_PIECES);
        for j in 1..=pieces {
            let t = j as f32 / pieces as f32;
            let yy = hermite(y[k], y[k + 1], sc.m[k] * h, sc.m[k + 1] * h, t);
            let zz = if two { hermite(z0, z1, sc.m2[k] * h, sc.m2[k + 1] * h, t) } else { 0.0 };
            // Exact sample at the span end (no drift from the basis sum)
            if j == pieces {
                dst.push(two, x[k + 1], y[k + 1], z1);
            } else {
                dst.push(two, x[k] + h * t, yy, zz);
            }
        }
    }
}

/// Segments `[x0, y0, x1, y1]` of the finite runs of a one-channel path, x ascending (`flip`:
/// x negated first, for paths running right to left).
fn path_segments(p: &Path, flip: bool, out: &mut Vec<[f32; 4]>) {
    out.clear();
    let f = if flip { -1.0 } else { 1.0 };
    for k in 1..p.x.len() {
        let (x0, y0, x1, y1) = (p.x[k - 1] * f, p.y[k - 1], p.x[k] * f, p.y[k]);
        if [x0, y0, x1, y1].iter().all(|c| c.is_finite()) {
            out.push([x0, y0, x1, y1]);
        }
    }
}

/// `(left limit, right limit)` of a segment list at `x` (NaN = undefined: gap / outside);
/// `k` is a cursor advanced monotonically over increasing `x`.
fn eval_segments(segs: &[[f32; 4]], k: &mut usize, x: f32) -> (f32, f32) {
    while *k < segs.len() && segs[*k][2] < x {
        *k += 1;
    }
    let at = |s: &[f32; 4]| {
        let w = s[2] - s[0];
        if x == s[0] {
            s[1]
        } else if x == s[2] || w <= 0.0 {
            s[3]
        } else {
            s[1] + (s[3] - s[1]) * (x - s[0]) / w
        }
    };
    let left = segs.get(*k).filter(|s| s[0] < x).map_or(f32::NAN, at);
    let mut j = *k;
    while j < segs.len() && segs[j][2] <= x {
        j += 1;
    }
    let right = segs.get(j).filter(|s| s[0] <= x).map_or(f32::NAN, at);
    // A segment ending exactly at x (vertical steps included) also defines the left limit
    let left = if left.is_nan() && *k < segs.len() && segs[*k][2] == x && segs[*k][0] < x { segs[*k][3] } else { left };
    (left, right)
}

/// Region between two x-monotone polylines (`top`, `bottom`: one channel each, NaN rows = gaps,
/// possibly with vertical steps and different x) as two-channel rows on the union of their
/// breakpoints for `band_triangles`: a break point where either edge jumps gets a left and a
/// right row. Undefined stretches of either edge leave gaps.
pub(crate) fn band_between(top: &Path, bottom: &Path, out: &mut Path) {
    out.clear();
    let first_dx = |p: &Path| {
        (1..p.x.len()).map(|k| p.x[k] - p.x[k - 1]).find(|d| d.is_finite() && *d != 0.0)
    };
    let flip = first_dx(top).or_else(|| first_dx(bottom)).is_some_and(|d| d < 0.0);
    let (mut a, mut b) = (Vec::new(), Vec::new());
    path_segments(top, flip, &mut a);
    path_segments(bottom, flip, &mut b);
    let mut xs: Vec<f32> = a.iter().chain(&b).flat_map(|s| [s[0], s[2]]).collect();
    xs.sort_unstable_by(f32::total_cmp);
    xs.dedup();
    let same = |p: f32, q: f32| p == q || (p.is_nan() && q.is_nan());
    let f = if flip { -1.0 } else { 1.0 };
    let (mut ka, mut kb) = (0, 0);
    for x in xs {
        let (tl, tr) = eval_segments(&a, &mut ka, x);
        let (bl, br) = eval_segments(&b, &mut kb, x);
        let jump = !same(tl, tr) || !same(bl, br);
        // A left row with an undefined edge adds nothing before a jump: the previous row is
        // undefined in that edge too (definedness only changes at breakpoints)
        if !jump || !(tl.is_nan() || bl.is_nan()) {
            out.push(true, x * f, tl, bl);
        }
        if jump {
            out.push(true, x * f, tr, br);
        }
    }
    // Rows past the end of either edge
    while !out.x.is_empty() && !out.ok(out.x.len() - 1) {
        out.x.pop();
        out.y.pop();
        out.y2.pop();
    }
}

// -----------------------------------------------------------------------------
// Building styled geometry
// -----------------------------------------------------------------------------

/// Frame inputs of the style geometry.
#[derive(Debug, Clone, Copy)]
pub(crate) struct StyleCtx {
    pub(crate) pixel_ratio: f32,
    /// Default marker stroke (hover ring color = chart surface)
    pub(crate) ring: [f32; 4],
}

/// Style geometry of the series layer: dashed strokes, point markers, band fills.
#[derive(Debug, Default, Clone)]
pub(crate) struct StyledSeries {
    pub(crate) dashed: Vec<ChartDashSegmentRaw>,
    pub(crate) markers: Vec<ChartMarkerRaw>,
    pub(crate) band: Vec<ChartFillRaw>,
}

impl StyledSeries {
    fn clear(&mut self) {
        self.dashed.clear();
        self.markers.clear();
        self.band.clear();
    }
}

#[derive(Debug, Default)]
struct BuildScratch {
    picks: Vec<usize>,
    raw: Path,
    path: Path,
    band_raw: Path,
    band_path: Path,
    curve: CurveScratch,
    phase: Vec<f64>,
}

impl LineChart {
    #[inline]
    pub(crate) fn style_of(&self, s: usize) -> LineSeriesStyle {
        self.style.get(s)
    }

    /// Physical px per world unit at the build window (2D: isotropic in x and y).
    pub(crate) fn px_per_world(&self, window: &LodWindow) -> f32 {
        window.px_per_t * (self.window.1 - self.window.0) / self.layout.width.max(1e-6)
    }

    /// World y of a sample of series `s` under its null policy: `None` = skip (connect), NaN = gap.
    #[inline]
    fn styled_y(&self, s: usize, axis: u8, v: f32, nulls: NullPolicy) -> Option<f32> {
        let v = if v.is_finite() {
            v
        } else {
            match nulls {
                NullPolicy::Gap => return Some(f32::NAN),
                NullPolicy::Connect => return None,
                NullPolicy::Zero => 0.0,
            }
        };
        Some(if self.drawable(s, v) { self.y_of_axis(axis, v) } else { f32::NAN })
    }

    /// One row per pick of series `s` (world x, y under its null policy; NaN y = gap; skipped
    /// rows for `Connect`): the polyline before its curve.
    pub(crate) fn stroke_rows(&self, s: usize, picks: &[usize], out: &mut Path) {
        out.clear();
        let (values, axis, nulls) = (self.vals(s), self.axis_of(s), self.style.nulls(s));
        for &i in picks {
            if let Some(y) = self.styled_y(s, axis, values[i], nulls) {
                out.push(false, self.x_at(s, i), y, 0.0);
            }
        }
    }

    /// Series in draw order: back to front (`reversed`), the emphasized one last (on top).
    fn draw_order(&self, reversed: bool) -> Vec<usize> {
        let n = self.series.len();
        let mut order: Vec<usize> = (0..n)
            .map(|k| if reversed { n - 1 - k } else { k })
            .filter(|&i| self.visible[i])
            .collect();
        if let Some(e) = self.emphasis {
            if let Some(pos) = order.iter().position(|&i| i == e) {
                let e = order.remove(pos);
                order.push(e);
            }
        }
        order
    }

    /// Strokes of every visible series in `window` (M4 picks, null policy, curve): solid series
    /// as `out` segments, dashed ones plus markers and bands into `styled`.
    pub(crate) fn build_segments(
        &self,
        window: &LodWindow,
        ctx: &StyleCtx,
        out: &mut Vec<ChartSegmentRaw>,
        styled: &mut StyledSeries,
    ) {
        out.clear();
        styled.clear();
        let mut sc = BuildScratch::default();
        let ppw = self.px_per_world(window);
        for s_idx in self.draw_order(window.reversed) {
            let style = self.style_of(s_idx);
            self.lod_picks(s_idx, window, &mut sc.picks);
            if sc.picks.is_empty() && self.len(s_idx) == 1 {
                // A lone sample has no segment but may carry a marker
                sc.picks.push(0);
            }
            let s = &self.series[s_idx];
            let z = self.z[s_idx];
            let dim = if self.emphasis.is_some_and(|e| e != s_idx) { DIMMED_SERIES_ALPHA } else { 1.0 };
            let mut color = s.color;
            color[3] *= dim;

            if let Some(band) = self.style.band(s_idx) {
                self.build_band(s_idx, band, window, style, ppw, color, &mut sc, &mut styled.band);
            }
            self.stroke_rows(s_idx, &sc.picks, &mut sc.raw);
            let path = if style.curve == LineCurve::Linear {
                &sc.raw
            } else {
                apply_curve(style.curve, ppw, &sc.raw, &mut sc.path, &mut sc.curve);
                &sc.path
            };
            if style.dashed() {
                dash_phases(self, window, ctx, path, style.dash, &mut sc.phase);
                for k in 1..path.x.len() {
                    let (x0, y0, x1, y1) = (path.x[k - 1], path.y[k - 1], path.x[k], path.y[k]);
                    if [x0, y0, x1, y1].iter().all(|c| c.is_finite()) {
                        styled.dashed.push(ChartDashSegmentRaw {
                            p0_width: [x0, y0, z, s.width_px],
                            p1_phase: [x1, y1, z, sc.phase[k - 1] as f32],
                            color,
                            dash: style.dash,
                        });
                    }
                }
            } else {
                for k in 1..path.x.len() {
                    let (x0, y0, x1, y1) = (path.x[k - 1], path.y[k - 1], path.x[k], path.y[k]);
                    if [x0, y0, x1, y1].iter().all(|c| c.is_finite()) {
                        out.push(ChartSegmentRaw {
                            p0_width: [x0, y0, z, s.width_px],
                            p1_pad: [x1, y1, z, 0.0],
                            color,
                        });
                    }
                }
            }
            if let Some(m) = style.marker {
                self.push_markers(&sc.raw, window, ctx, m, color, z, dim, &mut styled.markers);
            }
        }
    }

    /// Markers on the drawn samples (`raw`: one row per pick) per `m.show`.
    #[allow(clippy::too_many_arguments)]
    fn push_markers(
        &self,
        raw: &Path,
        window: &LodWindow,
        ctx: &StyleCtx,
        m: SeriesMarker,
        color: [f32; 4],
        z: f32,
        dim: f32,
        out: &mut Vec<ChartMarkerRaw>,
    ) {
        let count = (0..raw.x.len()).filter(|&k| raw.ok(k)).count();
        let show = match m.show {
            MarkerShow::Never => false,
            MarkerShow::Always => true,
            MarkerShow::Auto => {
                let css_width = (window.t1 - window.t0) * window.px_per_t / ctx.pixel_ratio.max(0.1);
                marker_density_ok(count, css_width)
            }
        };
        if !show || m.size_px <= 0.0 {
            return;
        }
        let fill = m.fill.map_or(color, |mut c| {
            c[3] *= dim;
            c
        });
        let mut ring = m.stroke.unwrap_or(ctx.ring);
        ring[3] *= dim;
        for k in (0..raw.x.len()).filter(|&k| raw.ok(k)) {
            out.push(ChartMarkerRaw {
                center_radius: [raw.x[k], raw.y[k], z, 0.5 * m.size_px],
                fill,
                ring,
                params: [m.stroke_px.max(0.0), m.shape.code(), 0.0, 0.0],
            });
        }
    }

    /// Band fill of series `s`: per pixel-column bucket the lowest lower / highest upper edge
    /// (one row per sample where sparse, two rows spanning the bucket where decimated), shaped
    /// by the series curve.
    #[allow(clippy::too_many_arguments)]
    fn build_band(
        &self,
        s: usize,
        band: &SeriesBand,
        window: &LodWindow,
        style: LineSeriesStyle,
        ppw: f32,
        color: [f32; 4],
        sc: &mut BuildScratch,
        out: &mut Vec<ChartFillRaw>,
    ) {
        let head = self.head[s];
        let axis = self.axis_of(s);
        let (lower, upper) = (&band.lower[head..], &band.upper[head..]);
        let nulls = style.nulls;
        let edge = |v: f32| -> Option<f32> {
            let v = if v.is_finite() {
                v
            } else {
                match nulls {
                    NullPolicy::Gap => return Some(f32::NAN),
                    NullPolicy::Connect => return None,
                    NullPolicy::Zero => 0.0,
                }
            };
            Some(if self.drawable(s, v) { self.y_of_axis(axis, v) } else { f32::NAN })
        };
        let mut rows: Vec<(usize, f32, f32)> = Vec::new();
        self.lod_buckets(s, window, |from, to| {
            let to = to.min(lower.len()).min(upper.len());
            if from >= to {
                return;
            }
            // Extremes in data units: the y transform is monotonic per axis (reversal swaps)
            let (mut lo, mut hi) = (f32::NAN, f32::NAN);
            for i in from..to {
                if lower[i].is_finite() && (lo.is_nan() || lower[i] < lo) {
                    lo = lower[i];
                }
                if upper[i].is_finite() && (hi.is_nan() || upper[i] > hi) {
                    hi = upper[i];
                }
            }
            let (Some(a), Some(b)) = (edge(lo), edge(hi)) else {
                return;
            };
            rows.push((from, a, b));
            if to - from > 1 {
                rows.push((to - 1, a, b));
            }
        });
        sc.band_raw.clear();
        for (i, a, b) in rows {
            sc.band_raw.push(true, self.x_at(s, i), b, a);
        }
        let shaped = if style.curve == LineCurve::Linear {
            &sc.band_raw
        } else {
            apply_curve(style.curve, ppw, &sc.band_raw, &mut sc.band_path, &mut sc.curve);
            &sc.band_path
        };
        let mut c = color;
        c[3] *= band.opacity;
        band_triangles(&shaped.x, &shaped.y, &shaped.y2, self.z[s], c, out);
    }
}

/// `MarkerShow::Auto`: `count` visible markers fit `css_width` with `AUTO_MARKER_MIN_PX` each.
pub(crate) fn marker_density_ok(count: usize, css_width: f32) -> bool {
    count > 0 && count as f32 * AUTO_MARKER_MIN_PX <= css_width
}

/// Dash phase (CSS px, modulo the pattern period) at every row of `path`: cumulative length
/// along the drawn polyline, anchored at a data position so rebuilds while panning keep the
/// pattern in place. The anchor row is the first at or after a multiple of twice the
/// zoom-window span in `t`, whose phase is its CSS-px distance from `t = 0`; other rows add /
/// subtract the path length from it (gaps add nothing). When the anchor moves to the next grid
/// line the pattern may shift once (by the difference between path and x length).
fn dash_phases(l: &LineChart, window: &LodWindow, ctx: &StyleCtx, path: &Path, dash: [f32; 4], out: &mut Vec<f64>) {
    let n = path.x.len();
    out.clear();
    out.resize(n, 0.0);
    let css_per_world = (l.px_per_world(window) / ctx.pixel_ratio.max(0.1)) as f64;
    let mut acc = 0.0f64;
    let mut prev: Option<(f32, f32)> = None;
    for (k, phase) in out.iter_mut().enumerate() {
        let (x, y) = (path.x[k], path.y[k]);
        if !(x.is_finite() && y.is_finite()) {
            prev = None;
            *phase = acc;
            continue;
        }
        if let Some((px, py)) = prev {
            acc += (((x - px) as f64).powi(2) + ((y - py) as f64).powi(2)).sqrt() * css_per_world;
        }
        *phase = acc;
        prev = Some((x, y));
    }
    // Grid of twice the zoom span: the anchor stays put until the padded window start (half a
    // span before the view) crosses a grid line, i.e. about every second screen width of panning
    let span = 2.0 * ((l.window.1 - l.window.0) as f64).max(1e-9);
    let tq = (window.t0 as f64 / span).ceil() * span;
    let anchor = (0..n)
        .filter(|&k| path.x[k].is_finite() && path.y[k].is_finite())
        .find(|&k| l.t_of_x64(path.x[k]) >= tq)
        .or_else(|| (0..n).find(|&k| path.x[k].is_finite() && path.y[k].is_finite()));
    let Some(ka) = anchor else {
        return;
    };
    let t_anchor = l.t_of_x64(path.x[ka]);
    let base = t_anchor * window.px_per_t as f64 / ctx.pixel_ratio.max(0.1) as f64 - out[ka];
    let period = dash.iter().map(|&d| d as f64).sum::<f64>().max(1e-6);
    for p in out.iter_mut() {
        *p = (*p + base).rem_euclid(period);
    }
}

// -----------------------------------------------------------------------------
// ChartState API
// -----------------------------------------------------------------------------

impl ChartState {
    fn line_like_mut(&mut self) -> Option<&mut LineChart> {
        match &mut self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => Some(l),
            // Combo: line-local series order (bars excluded)
            ChartKind::Combo(c) => Some(&mut c.line),
            _ => None,
        }
    }

    fn line_like(&self) -> Option<&LineChart> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => Some(l),
            ChartKind::Combo(c) => Some(&c.line),
            _ => None,
        }
    }

    /// After a style / band change: re-stack areas, fold style extents into the y domain, rebuild.
    fn on_line_style_changed(&mut self) {
        if let ChartKind::Area(a) = &mut self.kind {
            a.restack();
        } else if let ChartKind::Line(l) = &mut self.kind {
            l.update_data_extent();
            l.update_y_domain(true);
        } else if let ChartKind::Combo(c) = &mut self.kind {
            // Zero-filled gaps widen the fixed domains; bars re-map onto theirs
            c.update_domains();
            self.dirty.bars = true;
        }
        self.hover = None;
        self.lod = None;
        self.dirty.fills = true;
        self.on_y_domain_changed();
    }

    /// Per-series styles of a line / area chart (missing entries = default). False for other kinds.
    pub fn set_line_styles(&mut self, styles: Vec<LineSeriesStyle>) -> bool {
        let Some(l) = self.line_like_mut() else {
            return false;
        };
        let n = l.series.len();
        let mut styles = styles;
        styles.resize(n, LineSeriesStyle::default());
        for st in &mut styles {
            st.dash = normalize_dash(&st.dash);
        }
        l.style.series = styles;
        for s in 0..n {
            let values = std::mem::take(&mut l.series[s].values);
            l.style.rescan(s, &values);
            l.series[s].values = values;
        }
        self.on_line_style_changed();
        true
    }

    /// Range band (error band) of line series `s` (not area charts): `lower` / `upper` per live
    /// sample (same length as the series), drawn as a fill beneath the stroke at `opacity` x the series color (non-finite
    /// = `DEFAULT_BAND_OPACITY`). Edges may be given in either order per sample.
    pub fn set_line_band(&mut self, s: usize, lower: Vec<f32>, upper: Vec<f32>, opacity: f32) -> Result<(), String> {
        let ChartKind::Line(l) = &mut self.kind else {
            return Err("bands need a line chart".into());
        };
        if s >= l.series.len() {
            return Err(format!("series {s} out of range ({} series)", l.series.len()));
        }
        let len = l.len(s);
        if lower.len() != len || upper.len() != len {
            return Err(format!(
                "series {s}: band needs {len} lower and upper values (got {} / {})",
                lower.len(),
                upper.len()
            ));
        }
        // Stored alignment: a trimmed prefix has no band
        let head = l.head[s];
        let pad = |v: Vec<f32>| {
            let mut out = vec![f32::NAN; head];
            out.extend(v);
            out
        };
        let (mut lo, mut hi) = (pad(lower), pad(upper));
        for (a, b) in lo.iter_mut().zip(hi.iter_mut()) {
            if a.is_finite() && b.is_finite() && *a > *b {
                std::mem::swap(a, b);
            }
        }
        let opacity = if opacity.is_finite() { opacity.clamp(0.0, 1.0) } else { DEFAULT_BAND_OPACITY };
        if l.style.bands.len() < l.series.len() {
            l.style.bands.resize(l.series.len(), None);
        }
        l.style.bands[s] = Some(SeriesBand { lower: lo, upper: hi, opacity });
        let values = std::mem::take(&mut l.series[s].values);
        l.style.rescan(s, &values);
        l.series[s].values = values;
        self.on_line_style_changed();
        Ok(())
    }

    /// Removes the band of series `s`.
    pub fn clear_line_band(&mut self, s: usize) {
        let Some(l) = self.line_like_mut() else {
            return;
        };
        if let Some(b) = l.style.bands.get_mut(s) {
            *b = None;
            let values = std::mem::take(&mut l.series[s].values);
            l.style.rescan(s, &values);
            l.series[s].values = values;
            self.on_line_style_changed();
        }
    }

    /// `(lower, upper)` of the band of series `s` at live sample `index` (tooltips, tables).
    pub fn line_band_at(&self, s: usize, index: usize) -> Option<(f32, f32)> {
        let l = self.line_like()?;
        let b = l.style.band(s)?;
        let i = l.head.get(s)? + index;
        Some((*b.lower.get(i)?, *b.upper.get(i)?))
    }

    /// Style of series `s` (defaults when unset); `None` for other chart kinds.
    pub fn line_style(&self, s: usize) -> Option<LineSeriesStyle> {
        self.line_like().map(|l| l.style_of(s))
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

    const LAYOUT: LineLayout = LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric };

    fn state(values: Vec<Vec<f32>>) -> (OrbitCamera, ChartState) {
        let series = values
            .into_iter()
            .map(|values| LineSeries { values, x: None, color: [1.0, 0.0, 0.0, 1.0], width_px: 2.0 })
            .collect();
        let chart = ChartState::new_line(series, LAYOUT);
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn line(chart: &ChartState) -> &LineChart {
        chart.line_like().unwrap()
    }

    fn style(f: impl FnOnce(&mut LineSeriesStyle)) -> LineSeriesStyle {
        let mut s = LineSeriesStyle::default();
        f(&mut s);
        s
    }

    /// (series segments, dashed, markers, fills) of a fresh frame.
    fn frame(chart: &mut ChartState, cam: &OrbitCamera) -> (Vec<ChartSegmentRaw>, Vec<ChartDashSegmentRaw>, Vec<ChartMarkerRaw>, Vec<ChartFillRaw>) {
        let layers = chart.prepare_layers(&view(cam));
        let st = layers.series_style.unwrap();
        (
            layers.series.unwrap().to_vec(),
            st.dashed.to_vec(),
            st.markers.to_vec(),
            layers.fills.map(|f| f.to_vec()).unwrap_or_default(),
        )
    }

    #[test]
    fn auto_markers_show_only_when_visible_points_are_sparse() {
        assert!(marker_density_ok(100, 800.0));
        assert!(!marker_density_ok(101, 800.0), "< 8 px apart");
        assert!(!marker_density_ok(0, 800.0));
        // 50 samples over ~1600 px (padded window) -> markers; 5000 samples -> none
        let marker = Some(SeriesMarker { shape: MarkerShape::Diamond, ..Default::default() });
        let (cam, mut chart) = state(vec![(0..50).map(|i| i as f32).collect()]);
        chart.set_line_styles(vec![style(|s| s.marker = marker)]);
        let (segs, _, markers, _) = frame(&mut chart, &cam);
        assert_eq!(segs.len(), 49, "markers leave the strokes alone");
        assert_eq!(markers.len(), 50);
        assert!(markers.iter().all(|m| m.params[1] == MarkerShape::Diamond.code() && m.center_radius[3] == 3.0));
        // Default fill = series color, stroke = hover ring color
        assert_eq!(markers[0].fill, [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(markers[0].ring, ChartHoverStyle::default().marker_ring_color);
        let (cam, mut dense) = state(vec![(0..5000).map(|i| (i as f32).sin()).collect()]);
        dense.set_line_styles(vec![style(|s| s.marker = marker)]);
        assert!(frame(&mut dense, &cam).2.is_empty(), "dense: no markers");
        // Always / never override the density rule
        let always = Some(SeriesMarker { show: MarkerShow::Always, ..Default::default() });
        dense.set_line_styles(vec![style(|s| s.marker = always)]);
        assert!(!frame(&mut dense, &cam).2.is_empty());
        let never = Some(SeriesMarker { show: MarkerShow::Never, ..Default::default() });
        chart.set_line_styles(vec![style(|s| s.marker = never)]);
        assert!(frame(&mut chart, &cam).2.is_empty());
        // Zooming into dense data makes it sparse: markers come back
        dense.set_line_styles(vec![style(|s| s.marker = marker)]);
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        dense.zoom_x(&view(&cam), 0.01, c.x);
        assert!(!frame(&mut dense, &cam).2.is_empty(), "zoomed: sparse again");
    }

    #[test]
    fn dash_phase_runs_on_continuously_across_segments() {
        let (cam, mut chart) = state(vec![vec![0.0, 10.0, 3.0, 7.0, 7.0, 1.0]]);
        chart.set_line_styles(vec![style(|s| s.dash = normalize_dash(&[6.0, 3.0]))]);
        let (segs, dashed, _, _) = frame(&mut chart, &cam);
        assert!(segs.is_empty(), "dashed series leave the solid layer");
        assert_eq!(dashed.len(), 5);
        assert!(dashed.iter().all(|d| d.dash == [6.0, 3.0, 0.0, 0.0]));
        // Phase at segment k+1 = phase at k + CSS length of segment k (mod the 9 px period)
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
        // Gaps keep the pattern going; solid input patterns are rejected
        assert_eq!(normalize_dash(&[4.0]), [4.0, 4.0, 0.0, 0.0]);
        assert_eq!(normalize_dash(&[4.0, 2.0, 1.0]), [4.0, 2.0, 0.0, 0.0]);
        assert_eq!(normalize_dash(&[4.0, 2.0, 1.0, 2.0, 9.0]), [4.0, 2.0, 1.0, 2.0]);
        assert_eq!(normalize_dash(&[0.0, 4.0]), [0.0; 4], "no ink");
        assert_eq!(normalize_dash(&[4.0, 0.0]), [0.0; 4], "no gap");
        assert_eq!(normalize_dash(&[-1.0, 4.0]), [0.0; 4]);
    }

    #[test]
    fn dash_phase_stays_put_while_panning() {
        let values: Vec<f32> = (0..200).map(|i| ((i as f32) * 0.3).sin() * 10.0).collect();
        let (cam, mut chart) = state(vec![values]);
        chart.set_line_styles(vec![style(|s| s.dash = [5.0, 5.0, 0.0, 0.0])]);
        let v = view(&cam);
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&v, 0.25, c.x);
        let phase_at = |chart: &mut ChartState, i: usize| -> f32 {
            let (_, dashed, _, _) = frame(chart, &cam);
            let x = line(chart).x_at(0, i);
            dashed.iter().find(|d| (d.p0_width[0] - x).abs() < 1e-3).unwrap().p1_phase[3]
        };
        let before = phase_at(&mut chart, 100);
        // Small pans rebuild the strokes; the phase at a given sample stays the same
        chart.pan_x(&v, 0.1);
        let after = phase_at(&mut chart, 100);
        assert!((before - after).abs() < 0.05, "{before} vs {after}");
    }

    #[test]
    fn step_curves_place_corners_between_samples() {
        let (cam, mut chart) = state(vec![vec![0.0, 10.0, 5.0]]);
        let l = line(&chart);
        let (x0, x1, x2) = (l.x_at(0, 0), l.x_at(0, 1), l.x_at(0, 2));
        let (y0, y1, y2) = (l.y_of(0.0), l.y_of(10.0), l.y_of(5.0));
        let pts = |segs: &[ChartSegmentRaw]| {
            let mut p = vec![(segs[0].p0_width[0], segs[0].p0_width[1])];
            p.extend(segs.iter().map(|s| (s.p1_pad[0], s.p1_pad[1])));
            p
        };
        chart.set_line_styles(vec![style(|s| s.curve = LineCurve::StepAfter)]);
        let segs = frame(&mut chart, &cam).0;
        assert_eq!(pts(&segs), vec![(x0, y0), (x1, y0), (x1, y1), (x2, y1), (x2, y2)]);
        chart.set_line_styles(vec![style(|s| s.curve = LineCurve::StepBefore)]);
        let segs = frame(&mut chart, &cam).0;
        assert_eq!(pts(&segs), vec![(x0, y0), (x0, y1), (x1, y1), (x1, y2), (x2, y2)]);
        chart.set_line_styles(vec![style(|s| s.curve = LineCurve::Step)]);
        let segs = frame(&mut chart, &cam).0;
        let (m0, m1) = (0.5 * (x0 + x1), 0.5 * (x1 + x2));
        assert_eq!(pts(&segs), vec![(x0, y0), (m0, y0), (m0, y1), (x1, y1), (m1, y1), (m1, y2), (x2, y2)]);
        // Only horizontal and vertical pieces
        assert!(segs.iter().all(|s| s.p0_width[0] == s.p1_pad[0] || s.p0_width[1] == s.p1_pad[1]));
    }

    #[test]
    fn monotone_curve_is_smooth_and_never_overshoots() {
        // Plateau then a jump: a natural spline would overshoot both ends of the jump
        let values = vec![0.0, 0.0, 0.0, 10.0, 10.0, 10.0, 4.0, 5.0];
        let (cam, mut chart) = state(vec![values.clone()]);
        chart.set_line_styles(vec![style(|s| s.curve = LineCurve::Monotone)]);
        let segs = frame(&mut chart, &cam).0;
        assert!(segs.len() > 3 * values.len(), "tessellated: {}", segs.len());
        let l = line(&chart);
        let xs: Vec<f32> = (0..values.len()).map(|i| l.x_at(0, i)).collect();
        for s in &segs {
            let (x, y) = (s.p1_pad[0], s.p1_pad[1]);
            let k = xs.windows(2).position(|w| x >= w[0] - 1e-4 && x <= w[1] + 1e-4).unwrap();
            let (a, b) = (l.y_of(values[k]), l.y_of(values[k + 1]));
            assert!(y >= a.min(b) - 1e-3 && y <= a.max(b) + 1e-3, "span {k}: y {y} outside [{a}, {b}]");
        }
        // Passes through every sample
        for (i, &x) in xs.iter().enumerate() {
            assert!(segs.iter().any(|s| (s.p1_pad[0] - x).abs() < 1e-4 && (s.p1_pad[1] - l.y_of(values[i])).abs() < 1e-3) || i == 0);
        }
        // Dense picks (< 2 px apart) stay straight: one segment per pick pair
        let (cam, mut dense) = state(vec![(0..1000).map(|i| (i as f32 * 0.05).sin()).collect()]);
        let plain = frame(&mut dense, &cam).0.len();
        dense.set_line_styles(vec![style(|s| s.curve = LineCurve::Monotone)]);
        assert_eq!(frame(&mut dense, &cam).0.len(), plain);
    }

    #[test]
    fn monotone_tangents_respect_the_fritsch_carlson_bound() {
        let x = [0.0, 1.0, 2.0, 3.0, 4.0];
        let y = [0.0, 1.0, 1.0, 5.0, 5.5];
        let mut m = Vec::new();
        monotone_tangents(&x, &y, &mut m);
        assert_eq!(m[1], 0.0, "flat span: zero tangents");
        assert_eq!(m[2], 0.0);
        for k in 0..4 {
            let d = (y[k + 1] - y[k]) / (x[k + 1] - x[k]);
            if d != 0.0 {
                let (a, b) = (m[k] / d, m[k + 1] / d);
                assert!(a >= 0.0 && b >= 0.0 && a * a + b * b <= 9.0 + 1e-4);
            }
        }
    }

    #[test]
    fn band_between_aligns_edges_with_different_breakpoints_and_steps() {
        let path = |pts: &[(f32, f32)]| {
            let mut p = Path::default();
            for &(x, y) in pts {
                p.push(false, x, y, 0.0);
            }
            p
        };
        // Top: step at x = 1; bottom: straight line sampled at other x
        let top = path(&[(0.0, 4.0), (1.0, 4.0), (1.0, 6.0), (2.0, 6.0)]);
        let bottom = path(&[(0.0, 0.0), (0.5, 1.0), (2.0, 1.0)]);
        let mut out = Path::default();
        band_between(&top, &bottom, &mut out);
        let rows: Vec<(f32, f32, f32)> = (0..out.x.len()).map(|k| (out.x[k], out.y[k], out.y2[k])).collect();
        assert_eq!(rows, vec![(0.0, 4.0, 0.0), (0.5, 4.0, 1.0), (1.0, 4.0, 1.0), (1.0, 6.0, 1.0), (2.0, 6.0, 1.0)]);
        // Gap in the top edge: no rows with both edges there
        let top = path(&[(0.0, 4.0), (1.0, 4.0), (f32::NAN, f32::NAN), (2.0, 4.0), (3.0, 4.0)]);
        let bottom = path(&[(0.0, 0.0), (3.0, 0.0)]);
        band_between(&top, &bottom, &mut out);
        let mut tris = Vec::new();
        band_triangles(&out.x, &out.y, &out.y2, 0.0, [1.0; 4], &mut tris);
        assert_eq!(tris.len(), 2 * 6, "spans 0-1 and 2-3 only");
        // Right-to-left paths (reversed x axis) work the same
        let top = path(&[(0.0, 2.0), (-1.0, 2.0)]);
        let bottom = path(&[(0.0, 0.0), (-0.5, 0.0), (-1.0, 0.0)]);
        band_between(&top, &bottom, &mut out);
        assert_eq!(out.x, vec![0.0, -0.5, -1.0]);
    }

    #[test]
    fn null_policies_gap_connect_and_zero() {
        let nan = f32::NAN;
        let values = vec![2.0, 4.0, nan, 4.0, 2.0];
        let (cam, mut chart) = state(vec![values]);
        // Gap (default): the two segments touching the missing sample are dropped
        assert_eq!(frame(&mut chart, &cam).0.len(), 2);
        chart.set_line_styles(vec![style(|s| s.nulls = NullPolicy::Connect)]);
        let segs = frame(&mut chart, &cam).0;
        assert_eq!(segs.len(), 3, "joined over the gap");
        let l = line(&chart);
        assert_eq!(segs[1].p0_width[0], l.x_at(0, 1));
        assert_eq!(segs[1].p1_pad[0], l.x_at(0, 3));
        chart.set_line_styles(vec![style(|s| s.nulls = NullPolicy::Zero)]);
        let segs = frame(&mut chart, &cam).0;
        assert_eq!(segs.len(), 4);
        let l = line(&chart);
        assert_eq!(segs[1].p1_pad[1], l.y_of(0.0), "drawn at zero");
        // The y domain makes room for the zeros
        assert_eq!(chart.y_domain().unwrap().0, 0.0);
        // Zero: M4 sees missing samples as 0 even when decimated
        let mut big: Vec<f32> = vec![5.0; 100_000];
        big[50_000] = nan;
        let (cam, mut chart) = state(vec![big]);
        chart.set_line_styles(vec![style(|s| s.nulls = NullPolicy::Zero)]);
        let segs = frame(&mut chart, &cam).0;
        let y0 = line(&chart).y_of(0.0);
        assert!(segs.iter().any(|s| s.p1_pad[1] == y0), "dip to zero kept by M4");
    }

    #[test]
    fn null_policies_apply_to_areas() {
        let nan = f32::NAN;
        let mk = |policy: NullPolicy, mode: AreaMode| {
            let series = vec![
                LineSeries { values: vec![1.0, 1.0, 1.0, 1.0], x: None, color: [1.0; 4], width_px: 2.0 },
                LineSeries { values: vec![2.0, 2.0, nan, 4.0], x: None, color: [1.0; 4], width_px: 2.0 },
            ];
            let series = if mode.stacks() {
                let mut s = series;
                s.push(LineSeries { values: vec![1.0; 4], x: None, color: [1.0; 4], width_px: 2.0 });
                s
            } else {
                series
            };
            let mut chart = ChartState::new_area(series, LAYOUT, mode, f32::NAN);
            let mut cam = flat_camera();
            chart.frame_camera(&mut cam, (1600.0, 900.0));
            chart.set_line_styles(vec![LineSeriesStyle::default(), style(|s| s.nulls = policy)]);
            let fills = chart.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
            (chart, fills)
        };
        // Overlap: gap splits the fill of series 1 (1 span left of 3)
        let (_, fills) = mk(NullPolicy::Gap, AreaMode::Overlap);
        assert_eq!(fills.len(), (3 + 1) * 6);
        let (_, fills) = mk(NullPolicy::Connect, AreaMode::Overlap);
        assert_eq!(fills.len(), (3 + 2) * 6, "bridged: 2 spans");
        let (_, fills) = mk(NullPolicy::Zero, AreaMode::Overlap);
        assert_eq!(fills.len(), (3 + 3) * 6);
        // Stacked + connect: the missing sample is interpolated (3 by index) for the series
        // above; its own top stays missing (stroke and fill join over it, no marker there)
        let (chart, fills) = mk(NullPolicy::Connect, AreaMode::Stacked);
        let a = match &chart.kind {
            ChartKind::Area(a) => a,
            _ => unreachable!(),
        };
        assert!(a.line.series[1].values[2].is_nan());
        assert_eq!(a.line.series[2].values[2], 1.0 + 3.0 + 1.0, "series above sits on 1 + interpolated 3");
        // Bands: 3 spans each (the bridged band is cut at the bottom edge's sample at x = 2)
        assert_eq!(fills.len(), (3 + 3 + 3) * 6);
        let (chart, fills) = mk(NullPolicy::Zero, AreaMode::Stacked);
        let a = match &chart.kind {
            ChartKind::Area(a) => a,
            _ => unreachable!(),
        };
        assert_eq!(a.line.series[1].values[2], 1.0, "zero thickness");
        assert_eq!(fills.len(), (3 + 3 + 3) * 6);
    }

    #[test]
    fn fill_missing_interpolates_by_x() {
        let nan = f32::NAN;
        let v = [nan, 0.0, nan, nan, 6.0, nan];
        assert!(fill_missing(&v, NullPolicy::Connect, None)[..1][0].is_nan(), "leading gap stays");
        assert_eq!(&fill_missing(&v, NullPolicy::Connect, None)[1..5], &[0.0, 2.0, 4.0, 6.0]);
        let x = [0.0, 0.0, 1.0, 5.0, 6.0, 7.0];
        assert_eq!(&fill_missing(&v, NullPolicy::Connect, Some(&x))[1..5], &[0.0, 1.0, 5.0, 6.0]);
        assert_eq!(fill_missing(&v, NullPolicy::Zero, None), vec![0.0, 0.0, 0.0, 0.0, 6.0, 0.0]);
    }

    #[test]
    fn band_fills_beneath_the_stroke_and_widens_the_domain() {
        let (cam, mut chart) = state(vec![vec![5.0, 6.0, 7.0]]);
        chart.set_line_band(0, vec![4.0, 5.0, 6.0], vec![9.0, 7.0, 2.0], 0.3).unwrap();
        // Swapped edges are put in order
        assert_eq!(chart.line_band_at(0, 2), Some((2.0, 6.0)));
        assert_eq!(chart.line_band_at(0, 3), None);
        let (segs, _, _, fills) = frame(&mut chart, &cam);
        assert_eq!(segs.len(), 2);
        assert_eq!(fills.len(), 2 * 6);
        assert!(fills.iter().all(|f| (f.color[3] - 0.3).abs() < 1e-6 && f.color[0] == 1.0));
        let l = line(&chart);
        let max_y = fills.iter().map(|f| f.position[1]).fold(f32::MIN, f32::max);
        assert_eq!(max_y, l.y_of(9.0));
        assert!(chart.y_domain().unwrap().1 >= 9.0, "domain covers the band");
        assert!(chart.set_line_band(0, vec![1.0], vec![2.0], 0.3).is_err(), "length mismatch");
        chart.clear_line_band(0);
        assert!(frame(&mut chart, &cam).3.is_empty());
    }

    #[test]
    fn band_lod_keeps_the_extremes_of_a_million_points() {
        let n = 1_000_000;
        let values: Vec<f32> = (0..n).map(|i| (i as f32 * 1e-4).sin()).collect();
        let mut lower: Vec<f32> = values.iter().map(|v| v - 0.5).collect();
        let mut upper: Vec<f32> = values.iter().map(|v| v + 0.5).collect();
        lower[123_457] = -40.0; // single-sample dips in a decimated column
        upper[876_543] = 40.0;
        let (cam, mut chart) = state(vec![values]);
        chart.set_line_band(0, lower, upper, f32::NAN).unwrap();
        let (_, _, _, fills) = frame(&mut chart, &cam);
        assert!(fills.len() < 2 * 1600 * 2 * 6 * 2, "decimated: {} vertices", fills.len());
        let l = line(&chart);
        let ys: Vec<f32> = fills.iter().map(|f| f.position[1]).collect();
        let (lo, hi) = ys.iter().fold((f32::MAX, f32::MIN), |(a, b), &y| (a.min(y), b.max(y)));
        assert!((lo - l.y_of(-40.0)).abs() < 1e-3, "lower spike kept: {lo}");
        assert!((hi - l.y_of(40.0)).abs() < 1e-3, "upper spike kept: {hi}");
        assert!(fills.iter().all(|f| (f.color[3] - DEFAULT_BAND_OPACITY).abs() < 1e-6));
        // Streaming keeps the band aligned (appended samples have no band)
        chart.append_series_data(0, &[1.0, 2.0], None, 0).unwrap();
        assert!(chart.line_band_at(0, n).unwrap().0.is_nan());
        assert_eq!(chart.line_band_at(0, n - 1).map(|b| b.1), Some(line(&chart).vals(0)[n - 1] + 0.5));
    }

    #[test]
    fn visible_autoscale_covers_bands_and_area_charts_reject_them() {
        let (_, mut chart) = state(vec![vec![5.0, 6.0, 7.0, 6.0]]);
        chart.set_y_axis(LineYAxis { autoscale: YAutoscale::Visible, ..Default::default() });
        chart.set_line_band(0, vec![1.0; 4], vec![30.0; 4], 0.2).unwrap();
        assert!(chart.y_domain().unwrap().1 >= 30.0, "unzoomed visible extent includes the band");
        let series = vec![LineSeries { values: vec![1.0, 2.0], x: None, color: [1.0; 4], width_px: 2.0 }];
        let mut area = ChartState::new_area(series, LAYOUT, AreaMode::Overlap, f32::NAN);
        assert!(area.set_line_band(0, vec![0.0; 2], vec![3.0; 2], 0.2).is_err());
    }

    #[test]
    fn band_follows_trimming() {
        let (_, mut chart) = state(vec![vec![0.0; 4]]);
        chart.set_line_band(0, vec![-1.0, -2.0, -3.0, -4.0], vec![1.0, 2.0, 3.0, 4.0], 0.2).unwrap();
        for k in 0..3000 {
            chart.append_series_data(0, &[k as f32], None, 1000).unwrap();
        }
        assert_eq!(line(&chart).len(0), 1000);
        assert!(chart.line_band_at(0, 0).unwrap().0.is_nan(), "original band samples trimmed away");
        let b = line(&chart).style.band(0).unwrap();
        assert_eq!(b.lower.len(), line(&chart).series[0].values.len(), "stays aligned through compaction");
    }

    #[test]
    fn replacing_trimmed_data_keeps_the_band_aligned_to_the_live_samples() {
        let (_, mut chart) = state(vec![vec![0.0; 4]]);
        chart.set_line_band(0, vec![-1.0, -2.0, -3.0, -4.0], vec![1.0, 2.0, 3.0, 4.0], 0.2).unwrap();
        // Two appended, two trimmed: the live band is (-3, 3), (-4, 4), NaN, NaN (head 2)
        chart.append_series_data(0, &[5.0, 6.0], None, 4).unwrap();
        assert_eq!(chart.line_band_at(0, 0), Some((-3.0, 3.0)));
        chart.set_series_data(0, vec![9.0; 4], None).unwrap();
        assert_eq!(chart.line_band_at(0, 0), Some((-3.0, 3.0)), "same live length: band kept, aligned");
        assert_eq!(line(&chart).style.band(0).unwrap().lower.len(), 4);
    }

    #[test]
    fn styles_apply_to_area_strokes_and_markers_sit_on_stacked_tops() {
        let series = vec![
            LineSeries { values: vec![1.0, 2.0, 3.0], x: None, color: [1.0; 4], width_px: 2.0 },
            LineSeries { values: vec![1.0, 1.0, 1.0], x: None, color: [1.0; 4], width_px: 2.0 },
        ];
        let mut chart = ChartState::new_area(series, LAYOUT, AreaMode::Stacked, f32::NAN);
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let marker = Some(SeriesMarker { show: MarkerShow::Always, shape: MarkerShape::Square, ..Default::default() });
        chart.set_line_styles(vec![LineSeriesStyle::default(), style(|s| {
            s.marker = marker;
            s.dash = [4.0, 2.0, 0.0, 0.0];
            s.curve = LineCurve::StepAfter;
        })]);
        let (segs, dashed, markers, fills) = frame(&mut chart, &cam);
        assert_eq!(segs.len(), 2);
        assert_eq!(dashed.len(), 4, "step: 2 pieces per span");
        assert_eq!(markers.len(), 3);
        let l = line(&chart);
        assert_eq!(markers[2].center_radius[1], l.y_of(4.0), "on the stacked top");
        // Step fills follow the step stroke: horizontal-first pieces
        assert!(!fills.is_empty());
        assert_eq!(chart.line_style(1).unwrap().curve, LineCurve::StepAfter);
    }

    #[test]
    fn dashed_charts_rebuild_on_small_view_changes() {
        // A 5% resize keeps solid charts' LOD cache but re-phases dashes
        let resized = |dash: [f32; 4]| {
            let (cam, mut chart) = state(vec![vec![0.0, 1.0, 0.0]]);
            chart.set_line_styles(vec![style(|s| s.dash = dash)]);
            frame(&mut chart, &cam);
            let mut cam2 = cam.clone();
            chart.frame_camera(&mut cam2, (1520.0, 900.0));
            chart.prepare_layers(&view(&cam2)).series_style.is_some()
        };
        assert!(!resized([0.0; 4]), "solid: cached");
        assert!(resized([4.0, 4.0, 0.0, 0.0]), "dashed: rebuilt");
    }
}
