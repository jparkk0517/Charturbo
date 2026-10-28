//! Pie / donut chart: slice layout, tessellation, hover and label anchors, all in Rust.
//!
//! Values are validated, folded (slices beyond `max_slices` merge into one "Other" slice),
//! optionally sorted, and laid out as angles here. Each slice is tessellated as a triangle fan
//! (pie) or strip (donut) whose arc segment count follows its on-screen radius so the chord
//! error stays <= 0.25 CSS px; it is rebuilt only when the on-screen scale, hover, emphasis or
//! visibility changes. The 2 px gap between slices is left open (both edges are inset by 1 px
//! along their normal, so the gap has a constant width), never painted over in the surface
//! color.
//!
//! Anti-aliasing: the canvas has no MSAA and the fill shader no coverage term, so every slice
//! outline also gets a 1 CSS px stroke in the slice color through the segment pipeline (analytic
//! capsule coverage). Fill and stroke sit 0.5 px inside the true edge: the stroke's coverage ramp
//! then runs from 0.5 px inside to 0.5 px outside the edge, so edges are smooth and the visible
//! area / gap widths stay exact. Slices are opaque (emphasis fades toward the surface color), so
//! the stroke blending over its own fill changes nothing.
//!
//! Hover is an O(log n) binary search over the cumulative slice angles plus a radius test (the
//! donut hole does not hover); the hovered slice is offset outward ("explode"). Outside labels
//! get leader lines (drawn here, beneath the slices) and per-side vertical nudging; the DOM only
//! places the text at the exported anchors.

use super::*;
use std::f32::consts::{FRAC_PI_2, TAU};

/// Default displayed slices; the smallest of the rest fold into "Other".
pub const DEFAULT_PIE_MAX_SLICES: usize = 8;
/// World radius of the pie (the camera framing scales it to the plot).
pub(crate) const PIE_RADIUS: f32 = 50.0;
/// Max distance between an arc and its chords (CSS px).
pub const PIE_CHORD_ERROR_PX: f32 = 0.25;
/// Surface gap between adjacent slices (CSS px).
pub const PIE_GAP_PX: f32 = 2.0;
/// Anti-aliasing stroke width (CSS px), centered half of it inside each edge.
pub(crate) const AA_PX: f32 = 1.0;
/// Hovered slice offset along its bisector (CSS px); also reserved around the pie.
pub const PIE_EXPLODE_PX: f32 = 6.0;
/// Arc segments per slice at most (huge canvases).
const MAX_ARC_SEGMENTS: usize = 2048;
/// Leader line: start / elbow distance beyond the rim, then the text anchor beyond the elbow.
const LEADER_START_PX: f32 = 4.0;
const LEADER_ELBOW_PX: f32 = 16.0;
const LEADER_TEXT_PX: f32 = 12.0;
/// Emphasis (legend hover): other slices mix this far toward the surface.
const FADE: f32 = 0.6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PieSort {
    /// Input order ("Other" last)
    #[default]
    None,
    /// Largest first ("Other" last)
    Descending,
}

impl PieSort {
    /// 0 = input order, 1 = descending
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Descending
        } else {
            Self::None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PieLabelMode {
    None,
    /// Outside the pie with leader lines (large enough slices)
    #[default]
    Outside,
    /// Inside the slice at its centroid (percent labels)
    Inside,
}

impl PieLabelMode {
    /// 0 = none, 1 = outside, 2 = inside
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::None,
            2 => Self::Inside,
            _ => Self::Outside,
        }
    }
}

/// Nightingale rose ("polar area diagram"): the slice radius encodes the value so that the slice
/// area (ring area for donuts) is proportional to it, `r^2 = r_in^2 + v / max * (R^2 - r_in^2)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PieRose {
    /// Plain pie: every slice reaches the full radius
    #[default]
    None,
    /// Angles follow the shares (like a pie), radii the values
    Radius,
    /// Equal angles for the visible slices, radii the values
    Area,
}

impl PieRose {
    /// 0 = none, 1 = radius, 2 = area
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Radius,
            2 => Self::Area,
            _ => Self::None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PieOptions {
    pub sort: PieSort,
    /// Displayed slices including "Other" (0 = no folding; values below 2 act as 2)
    pub max_slices: usize,
    /// Where the first slice starts, degrees clockwise from 12 o'clock
    pub start_angle_deg: f32,
    /// Where the last slice ends (same compass degrees; NaN = a full turn). The sweep runs along
    /// the drawing direction; an end at or before the start is a full turn, beyond one is clamped
    pub end_angle_deg: f32,
    /// Angular gap between neighbouring slices (degrees, clamped to [0, 45]) on top of the 2 px
    /// surface gap; angles, percents and the hit test keep the unpadded layout
    pub pad_angle_deg: f32,
    pub clockwise: bool,
    /// Donut hole radius / outer radius (0 = pie; clamped to [0, 0.95])
    pub inner_ratio: f32,
    pub labels: PieLabelMode,
    /// Slices narrower than this get no label (legend / tooltip only)
    pub label_min_angle_deg: f32,
    /// Label line height (CSS px): minimum vertical distance between outside labels
    pub label_line_px: f32,
    /// CSS px reserved beside (`[0]`, each side) and above / below (`[1]`) the pie for outside
    /// labels
    pub label_space_px: [f32; 2],
    pub rose: PieRose,
}

impl Default for PieOptions {
    fn default() -> Self {
        Self {
            sort: PieSort::None,
            max_slices: DEFAULT_PIE_MAX_SLICES,
            start_angle_deg: 0.0,
            end_angle_deg: f32::NAN,
            pad_angle_deg: 0.0,
            clockwise: true,
            inner_ratio: 0.0,
            labels: PieLabelMode::Outside,
            label_min_angle_deg: 6.0,
            label_line_px: 16.0,
            label_space_px: [0.0, 0.0],
            rose: PieRose::None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PieStyle {
    /// Categorical palette in fixed order: displayed slice `k` gets `palette[k]`
    pub palette: Vec<[f32; 4]>,
    /// Per input value color override (`None` = palette)
    pub colors: Vec<Option<[f32; 4]>>,
    pub other_color: [f32; 4],
    pub leader_color: [f32; 4],
    /// Chart surface (emphasis fades other slices toward it)
    pub surface: [f32; 4],
}

impl Default for PieStyle {
    fn default() -> Self {
        let hex = |h: u32| [((h >> 16) & 255) as f32 / 255.0, ((h >> 8) & 255) as f32 / 255.0, (h & 255) as f32 / 255.0, 1.0];
        Self {
            // Dark theme palette (web/src/sdk/charturbo.ts CHARTURBO_THEMES.dark)
            palette: [0x3987e5, 0xd95926, 0x199e70, 0xc98500, 0xd55181, 0x008300, 0x9085e9, 0xe66767]
                .into_iter()
                .map(hex)
                .collect(),
            colors: Vec::new(),
            other_color: [0.42, 0.44, 0.48, 1.0],
            leader_color: [0.55, 0.54, 0.52, 0.9],
            surface: CHART_SURFACE,
        }
    }
}

/// One displayed slice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PieSlice {
    /// Input index (`None` = the folded "Other" slice)
    pub source: Option<usize>,
    pub value: f64,
    /// Share of the visible total (0-100); NaN while hidden
    pub percent: f64,
    /// Angles in radians from the start angle along the drawing direction (`start == end`
    /// while hidden or zero)
    pub start: f32,
    pub end: f32,
    /// World outer radius (`PIE_RADIUS` unless `PieOptions::rose`)
    pub r_out: f32,
    pub visible: bool,
    pub color: [f32; 4],
}

impl PieSlice {
    fn span(&self) -> f32 {
        self.end - self.start
    }
}

/// DOM label anchor (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PieLabel {
    pub slice: u32,
    /// Outside labels: end of the leader line (text starts / ends here); inside: text center
    pub x_css: f32,
    pub y_css: f32,
    /// 1 = right of the pie (text grows right), -1 = left (text grows left), 0 = inside
    pub side: i8,
}

/// Screen layout of the pie for DOM overlays (center label, labels).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PieLayoutInfo {
    pub center_css: (f32, f32),
    pub r_out_css: f32,
    pub r_in_css: f32,
    /// Sum of the visible slices
    pub total: f64,
    pub hovered: Option<usize>,
}

/// On-screen scale of the pie in the last prepared frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PieScreen {
    pub center_css: (f32, f32),
    pub r_css: f32,
    /// World units per CSS px
    pub wpp: f32,
}

/// Every value must be finite and >= 0.
pub fn validate_pie(values: &[f64]) -> Result<(), String> {
    match values.iter().position(|v| !v.is_finite() || *v < 0.0) {
        Some(i) => Err(format!("pie value {i} is {} (values must be finite and >= 0)", values[i])),
        None => Ok(()),
    }
}

/// Displayed `(source, value)` slices and the folded input indices. With more than
/// `max_slices` values the `max_slices - 1` largest stay (ties: input order) and the rest sum
/// into a trailing "Other" slice (`source = None`).
pub fn fold_slices(values: &[f64], sort: PieSort, max_slices: usize) -> (Vec<(Option<usize>, f64)>, Vec<usize>) {
    let n = values.len();
    let desc = |a: &usize, b: &usize| values[*b].total_cmp(&values[*a]).then(a.cmp(b));
    let mut order: Vec<usize> = (0..n).collect();
    let mut other = Vec::new();
    let max = max_slices.max(2);
    if max_slices > 0 && n > max {
        let mut ranked = order.clone();
        ranked.sort_by(desc);
        let mut kept = vec![false; n];
        for &i in &ranked[..max - 1] {
            kept[i] = true;
        }
        other = (0..n).filter(|&i| !kept[i]).collect();
        order.retain(|&i| kept[i]);
    }
    if sort == PieSort::Descending {
        order.sort_by(desc);
    }
    let mut out: Vec<(Option<usize>, f64)> = order.iter().map(|&i| (Some(i), values[i])).collect();
    if !other.is_empty() {
        out.push((None, other.iter().map(|&i| values[i]).sum()));
    }
    (out, other)
}

/// Chords per arc of `span` radians at `r_px` CSS px so the sagitta stays within
/// `PIE_CHORD_ERROR_PX` (`r (1 - cos(step / 2)) <= e`).
pub(crate) fn arc_segments(span: f32, r_px: f32) -> usize {
    if span <= 0.0 || !span.is_finite() {
        return 0;
    }
    let (e, r) = (PIE_CHORD_ERROR_PX as f64, r_px as f64);
    let step = if r <= e { FRAC_PI_2 as f64 } else { 2.0 * (1.0 - e / r).acos() };
    ((span as f64 / step).ceil() as usize).clamp(1, MAX_ARC_SEGMENTS)
}

/// One slice to tessellate: compass angles (radians clockwise from +y) `lo < hi`, world radii.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SliceShape {
    pub lo: f32,
    pub hi: f32,
    pub r_out: f32,
    pub r_in: f32,
    /// The only visible slice: a full disk / ring without gaps
    pub full: bool,
}

/// World point at compass angle `phi` (0 = up, clockwise) and radius `r` around `c`.
pub(crate) fn polar(c: (f32, f32), phi: f32, r: f32) -> (f32, f32) {
    (c.0 + r * phi.sin(), c.1 + r * phi.cos())
}

/// Appends a slice's fill triangles and its anti-aliasing outline (`wpp` = world units per CSS
/// px, `offset` = explode shift). Returns false when the slice is too thin to show.
pub(crate) fn tessellate_slice(
    shape: &SliceShape,
    wpp: f32,
    offset: (f32, f32),
    color: [f32; 4],
    fills: &mut Vec<ChartFillRaw>,
    edges: &mut Vec<ChartSegmentRaw>,
) -> bool {
    let half_aa = 0.5 * AA_PX * wpp;
    let r_o = shape.r_out - half_aa;
    let r_i = if shape.r_in > 0.0 { shape.r_in + half_aa } else { 0.0 };
    if r_o <= 0.0 || r_i >= r_o {
        return false;
    }
    let vtx = |p: (f32, f32)| ChartFillRaw { position: [p.0, p.1, 0.0, 0.0], color };
    let mut stroke = |a: (f32, f32), b: (f32, f32)| {
        edges.push(ChartSegmentRaw { p0_width: [a.0, a.1, 0.0, AA_PX], p1_pad: [b.0, b.1, 0.0, 0.0], color });
    };
    let arc = |lo: f32, hi: f32, r: f32, n: usize| -> Vec<(f32, f32)> {
        (0..=n).map(|k| polar(offset, lo + (hi - lo) * k as f32 / n as f32, r)).collect()
    };

    if shape.full {
        let n = arc_segments(TAU, r_o / wpp).max(arc_segments(TAU, r_i / wpp));
        let outer = arc(shape.lo, shape.lo + TAU, r_o, n);
        for w in outer.windows(2) {
            stroke(w[0], w[1]);
        }
        if r_i > 0.0 {
            let inner = arc(shape.lo, shape.lo + TAU, r_i, n);
            strip(&outer, &inner, vtx, fills);
            for w in inner.windows(2) {
                stroke(w[0], w[1]);
            }
        } else {
            for w in outer.windows(2) {
                fills.extend([vtx(offset), vtx(w[0]), vtx(w[1])]);
            }
        }
        return true;
    }

    // Both edges move `d` along their normal into the slice: half the gap + half the AA stroke
    let d = (0.5 * PIE_GAP_PX + 0.5 * AA_PX) * wpp;
    if d >= r_o {
        return false;
    }
    let half = 0.5 * (shape.hi - shape.lo);
    let a_o = (d / r_o).asin();
    let (lo_o, hi_o) = (shape.lo + a_o, shape.hi - a_o);
    if hi_o <= lo_o {
        return false;
    }
    // Inner boundary: the hole's arc where the inset edges cross it; else, for a reflex pie
    // slice, the radius-`d` arc around the center (exact inset of the two rays: asin(1) = 90
    // degrees past each edge); else the apex where the inset edges meet
    let inner_r = if r_i >= d && half > (d / r_i).asin() {
        Some(r_i)
    } else if half > FRAC_PI_2 && r_i < d {
        Some(d)
    } else {
        None
    };
    match inner_r {
        Some(ri) => {
            let a_i = (d / ri).min(1.0).asin();
            let (lo_i, hi_i) = (shape.lo + a_i, shape.hi - a_i);
            let n = arc_segments(hi_o - lo_o, r_o / wpp).max(arc_segments(hi_i - lo_i, ri / wpp));
            let outer = arc(lo_o, hi_o, r_o, n);
            let inner = arc(lo_i, hi_i, ri, n);
            strip(&outer, &inner, vtx, fills);
            stroke(inner[0], outer[0]);
            for w in outer.windows(2) {
                stroke(w[0], w[1]);
            }
            stroke(outer[n], inner[n]);
            for w in inner.windows(2).rev() {
                stroke(w[1], w[0]);
            }
        }
        None => {
            let apex = polar(offset, shape.lo + half, d / half.sin());
            let n = arc_segments(hi_o - lo_o, r_o / wpp);
            let outer = arc(lo_o, hi_o, r_o, n);
            for w in outer.windows(2) {
                fills.extend([vtx(apex), vtx(w[0]), vtx(w[1])]);
            }
            stroke(apex, outer[0]);
            for w in outer.windows(2) {
                stroke(w[0], w[1]);
            }
            stroke(outer[n], apex);
        }
    }
    true
}

/// Quad strip between two arcs with the same vertex count.
fn strip(
    outer: &[(f32, f32)],
    inner: &[(f32, f32)],
    vtx: impl Fn((f32, f32)) -> ChartFillRaw,
    fills: &mut Vec<ChartFillRaw>,
) {
    for k in 1..outer.len().min(inner.len()) {
        let (p0, p1, q0, q1) = (outer[k - 1], outer[k], inner[k - 1], inner[k]);
        fills.extend([vtx(q0), vtx(p0), vtx(p1), vtx(q0), vtx(p1), vtx(q1)]);
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PieChart {
    pub(crate) opts: PieOptions,
    style: PieStyle,
    pub(crate) slices: Vec<PieSlice>,
    /// Input indices folded into "Other"
    pub(crate) other: Vec<usize>,
    pub(crate) emphasis: Option<usize>,
    /// Angle the slices share (radians, up to a full turn; see `PieOptions::end_angle_deg`)
    sweep: f32,
    /// Sum of the visible slices
    total: f64,
    /// Scale (world per CSS px) and hovered slice the slice buffers were built for
    built: Option<(f32, Option<usize>)>,
    pub(crate) screen: Option<PieScreen>,
    labels: Vec<PieLabel>,
    labels_scratch: Vec<PieLabel>,
    /// View key + padding the labels / leader lines were laid out for
    labels_key: Option<([f32; 19], ChartPadding)>,
    labels_revision: u32,
}

impl PieChart {
    /// Builds the displayed slices from validated values (see `validate_pie`).
    pub(crate) fn new(values: &[f64], mut opts: PieOptions, style: PieStyle) -> Self {
        let clean = |v: f32, d: f32| if v.is_finite() { v } else { d };
        let d = PieOptions::default();
        opts.inner_ratio = clean(opts.inner_ratio, 0.0).clamp(0.0, 0.95);
        opts.start_angle_deg = clean(opts.start_angle_deg, 0.0);
        opts.pad_angle_deg = clean(opts.pad_angle_deg, 0.0).clamp(0.0, 45.0);
        opts.label_min_angle_deg = clean(opts.label_min_angle_deg, d.label_min_angle_deg).max(0.0);
        opts.label_line_px = clean(opts.label_line_px, d.label_line_px).max(1.0);
        opts.label_space_px = opts.label_space_px.map(|v| clean(v, 0.0).clamp(0.0, 2048.0));
        let dir = if opts.clockwise { 1.0 } else { -1.0 };
        let sweep = match dir * (opts.end_angle_deg - opts.start_angle_deg) {
            d if d.is_finite() && d > 0.0 => d.min(360.0).to_radians(),
            _ => TAU,
        };
        let (slices, other) = fold_slices(values, opts.sort, opts.max_slices);
        let mut pie = Self {
            opts,
            style,
            slices: slices
                .into_iter()
                .map(|(source, value)| PieSlice {
                    source,
                    value,
                    percent: f64::NAN,
                    start: 0.0,
                    end: 0.0,
                    r_out: PIE_RADIUS,
                    visible: true,
                    color: [0.0; 4],
                })
                .collect(),
            other,
            emphasis: None,
            sweep,
            total: 0.0,
            built: None,
            screen: None,
            labels: Vec::new(),
            labels_scratch: Vec::new(),
            labels_key: None,
            labels_revision: 0,
        };
        pie.assign_colors();
        pie.layout();
        pie
    }

    pub(crate) fn len(&self) -> usize {
        self.slices.len()
    }

    /// Angles, radii and percents of the visible slices (hidden ones collapse to zero width).
    fn layout(&mut self) {
        let visible = || self.slices.iter().filter(|s| s.visible);
        let total: f64 = visible().map(|s| s.value).sum();
        let shown = visible().count();
        let max = visible().map(|s| s.value).fold(0.0, f64::max);
        self.total = total;
        let rose = self.opts.rose;
        let (r_in, r_full) = (self.r_in(), PIE_RADIUS);
        let sweep = self.sweep;
        let mut acc = 0.0f64;
        for s in &mut self.slices {
            let share = match rose {
                _ if !s.visible => 0.0,
                PieRose::Area => 1.0 / shown as f64,
                _ if total > 0.0 => s.value / total,
                _ => 0.0,
            };
            s.r_out = match rose {
                PieRose::None => r_full,
                _ if s.visible && max > 0.0 => (r_in * r_in + (s.value / max) as f32 * (r_full * r_full - r_in * r_in)).sqrt(),
                _ => r_in,
            };
            s.start = (acc * sweep as f64) as f32;
            acc += share;
            // The last visible slice closes the sweep exactly
            s.end = ((acc * sweep as f64) as f32).min(sweep);
            s.percent = if s.visible && total > 0.0 { s.value / total * 100.0 } else { f64::NAN };
        }
        // The last visible slice closes the sweep and later (hidden) ones sit at its end, so the
        // ends stay monotonic for the hit test's binary search
        if let Some(last) = self.slices.iter().rposition(|s| s.span() > 0.0) {
            self.slices[last].end = sweep;
            for s in &mut self.slices[last + 1..] {
                (s.start, s.end) = (sweep, sweep);
            }
        }
        self.built = None;
        self.labels_key = None;
    }

    /// Palette in fixed display order ("Other" uses its own neutral color).
    fn assign_colors(&mut self) {
        let st = &self.style;
        let gray = [0.5, 0.5, 0.5, 1.0];
        for (k, s) in self.slices.iter_mut().enumerate() {
            s.color = match s.source {
                None => st.other_color,
                Some(i) => st
                    .colors
                    .get(i)
                    .copied()
                    .flatten()
                    .unwrap_or_else(|| if st.palette.is_empty() { gray } else { st.palette[k % st.palette.len()] }),
            };
        }
        self.built = None;
        self.labels_key = None;
    }

    pub(crate) fn set_style(&mut self, style: PieStyle) {
        self.style = style;
        self.assign_colors();
    }

    pub(crate) fn set_visible(&mut self, slice: usize, visible: bool) -> bool {
        match self.slices.get_mut(slice) {
            Some(s) if s.visible != visible => {
                s.visible = visible;
                self.layout();
                true
            }
            _ => false,
        }
    }

    pub(crate) fn set_emphasis(&mut self, slice: Option<usize>) -> bool {
        let slice = slice.filter(|&k| k < self.slices.len());
        let changed = self.emphasis != slice;
        if changed {
            self.emphasis = slice;
            self.built = None;
        }
        changed
    }

    fn dir(&self) -> f32 {
        if self.opts.clockwise {
            1.0
        } else {
            -1.0
        }
    }

    fn start_rad(&self) -> f32 {
        self.opts.start_angle_deg.to_radians()
    }

    /// Compass interval `(lo, hi)` (radians clockwise from 12 o'clock) of a slice.
    fn compass(&self, s: &PieSlice) -> (f32, f32) {
        let a = self.start_rad();
        if self.opts.clockwise {
            (a + s.start, a + s.end)
        } else {
            (a - s.end, a - s.start)
        }
    }

    fn r_in(&self) -> f32 {
        PIE_RADIUS * self.opts.inner_ratio
    }

    /// World point at the middle of slice `k` (between hole and rim; 0.6 of the rim for pies).
    fn centroid(&self, k: usize) -> Option<Vec3> {
        let s = self.slices.get(k)?;
        let (lo, hi) = self.compass(s);
        let r = if self.opts.inner_ratio > 0.0 { 0.5 * (self.r_in() + s.r_out) } else { 0.6 * s.r_out };
        let (x, y) = polar((0.0, 0.0), 0.5 * (lo + hi), r);
        Some(Vec3::new(x, y, 0.0))
    }

    /// `(slice, slice, value, world centroid)` of slice `global_id`.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let k = global_id as usize;
        let s = self.slices.get(k)?;
        Some((k as u32, k as u32, s.value as f32, self.centroid(k)?))
    }

    pub(crate) fn screen_of(view: &ChartView) -> Option<PieScreen> {
        let c = view.project_css(Vec3::ZERO)?;
        let e = view.project_css(Vec3::new(PIE_RADIUS, 0.0, 0.0))?;
        let r = (e.0 - c.0).hypot(e.1 - c.1);
        (r > 1e-3).then_some(PieScreen { center_css: c, r_css: r, wpp: PIE_RADIUS / r })
    }

    /// Slice under world point `(x, y)` (`wpp` = world units per CSS px): binary search over the
    /// cumulative angles; the donut hole and beyond the rim miss. The `hovered` slice is tested
    /// first where it is drawn (exploded), so hover follows the visible shape.
    pub(crate) fn slice_at(&self, x: f32, y: f32, wpp: f32, hovered: Option<usize>) -> Option<usize> {
        if self.total <= 0.0 || wpp.is_nan() || wpp <= 0.0 {
            return None;
        }
        // A lone shown slice spans the full turn and never explodes (O(1): no count of shown slices)
        if let Some(h) = hovered.filter(|&h| self.slices.get(h).is_some_and(|s| s.span() > 0.0 && s.span() < TAU * 0.9999)) {
            let (lo, hi) = self.compass(&self.slices[h]);
            let o = polar((0.0, 0.0), 0.5 * (lo + hi), PIE_EXPLODE_PX * wpp);
            if self.slice_at_centered(x - o.0, y - o.1) == Some(h) {
                return Some(h);
            }
        }
        self.slice_at_centered(x, y)
    }

    /// Hit test of the unexploded pie around the origin.
    fn slice_at_centered(&self, x: f32, y: f32) -> Option<usize> {
        let r = x.hypot(y);
        if r > PIE_RADIUS || r < self.r_in() {
            return None;
        }
        let phi = x.atan2(y);
        let a = (self.dir() * (phi - self.start_rad())).rem_euclid(TAU);
        // f32 rem_euclid can round up to exactly TAU
        let a = if a >= TAU { 0.0 } else { a };
        let k = self.slices.partition_point(|s| s.end <= a);
        let s = self.slices.get(k)?;
        (s.span() > 0.0 && a >= s.start && r <= s.r_out).then_some(k)
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32), hovered: Option<usize>) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let p = ray_hit_z_plane(&ray, 0.0)?;
        let k = self.slice_at(p.x, p.y, Self::screen_of(view)?.wpp, hovered)?;
        Some(HoverResult {
            is_bar: false,
            primary: 0,
            items: vec![HoverItem { series: k as u32, index: k as u32, value: self.slices[k].value as f32, global_id: k as u32 }],
        })
    }

    fn display_color(&self, k: usize) -> [f32; 4] {
        let c = self.slices[k].color;
        match self.emphasis {
            Some(e) if e != k => {
                let s = self.style.surface;
                [c[0] + (s[0] - c[0]) * FADE, c[1] + (s[1] - c[1]) * FADE, c[2] + (s[2] - c[2]) * FADE, c[3]]
            }
            _ => c,
        }
    }

    /// Compass interval of a drawn slice: shrunk by half the pad angle on each side (a full disk
    /// keeps its turn); `None` when the pad swallows the slice.
    fn padded(&self, (lo, hi): (f32, f32), full: bool) -> Option<(f32, f32)> {
        let pad = if full { 0.0 } else { 0.5 * self.opts.pad_angle_deg.to_radians() };
        (hi - lo > 2.0 * pad).then_some((lo + pad, hi - pad))
    }

    /// Slice triangles (`fills`) and their anti-aliasing outlines (`edges`) at scale `wpp`.
    pub(crate) fn build(&self, wpp: f32, hovered: Option<usize>, fills: &mut Vec<ChartFillRaw>, edges: &mut Vec<ChartSegmentRaw>) {
        fills.clear();
        edges.clear();
        let shown = self.slices.iter().filter(|s| s.span() > 0.0).count();
        for (k, s) in self.slices.iter().enumerate() {
            if s.span() <= 0.0 {
                continue;
            }
            let full = shown == 1 && self.sweep >= TAU;
            let Some((lo, hi)) = self.padded(self.compass(s), full) else {
                continue;
            };
            let offset = if hovered == Some(k) && !full {
                polar((0.0, 0.0), 0.5 * (lo + hi), PIE_EXPLODE_PX * wpp)
            } else {
                (0.0, 0.0)
            };
            let shape = SliceShape { lo, hi, r_out: s.r_out, r_in: self.r_in(), full };
            tessellate_slice(&shape, wpp, offset, self.display_color(k), fills, edges);
        }
    }

    /// Slice `(start, end)` angles of the current layout (update animations, see animation.rs).
    pub(crate) fn angles(&self) -> Vec<(f32, f32)> {
        self.slices.iter().map(|s| (s.start, s.end)).collect()
    }

    /// World units per CSS px of the last built slices (`None` before the first frame).
    pub(crate) fn built_wpp(&self) -> Option<f32> {
        self.built.map(|(wpp, _)| wpp)
    }

    /// `build` with each slice's `(start, end)` taken from `angles` (update animations tween the
    /// angles); never exploded.
    pub(crate) fn build_with_angles(
        &self,
        wpp: f32,
        angles: &[(f32, f32)],
        fills: &mut Vec<ChartFillRaw>,
        edges: &mut Vec<ChartSegmentRaw>,
    ) {
        fills.clear();
        edges.clear();
        let shown = angles.iter().filter(|(a, b)| b > a).count();
        for (k, (s, &(start, end))) in self.slices.iter().zip(angles).enumerate() {
            if end <= start {
                continue;
            }
            let full = shown == 1 && self.sweep >= TAU;
            let Some((lo, hi)) = self.padded(self.compass(&PieSlice { start, end, ..*s }), full) else {
                continue;
            };
            let shape = SliceShape { lo, hi, r_out: s.r_out, r_in: self.r_in(), full };
            tessellate_slice(&shape, wpp, (0.0, 0.0), self.display_color(k), fills, edges);
        }
    }

    /// Lays out label anchors for the current screen; outside labels also get leader lines in
    /// `leaders`. Returns true when the anchors changed (revision bumped).
    fn layout_labels(&mut self, view: &ChartView, screen: PieScreen, padding: &ChartPadding, leaders: &mut Vec<ChartSegmentRaw>) -> bool {
        leaders.clear();
        let mut out = std::mem::take(&mut self.labels_scratch);
        out.clear();
        let (cx, cy) = screen.center_css;
        let r = screen.r_css;
        let min_span = self.opts.label_min_angle_deg.to_radians();
        let line = self.opts.label_line_px;
        // CSS direction (y down) of a compass angle
        let dir_css = |phi: f32| (phi.sin(), -phi.cos());
        match self.opts.labels {
            PieLabelMode::None => {}
            PieLabelMode::Inside => {
                let ratio = self.opts.inner_ratio;
                let ri = ratio * r;
                for (k, s) in self.slices.iter().enumerate() {
                    let rk = r * s.r_out / PIE_RADIUS;
                    let rm = if ratio > 0.0 { 0.5 * (ri + rk) } else { 0.62 * rk };
                    // The label needs about two line heights of arc (and one of depth in a rose)
                    let shallow = self.opts.rose != PieRose::None && rk - ri < line;
                    if s.span() <= 0.0 || s.span() < min_span || s.span() * rm < 2.0 * line || shallow {
                        continue;
                    }
                    let (lo, hi) = self.compass(s);
                    let v = dir_css(0.5 * (lo + hi));
                    out.push(PieLabel { slice: k as u32, x_css: cx + v.0 * rm, y_css: cy + v.1 * rm, side: 0 });
                }
            }
            PieLabelMode::Outside => {
                let css_h = view.viewport_px.1 as f32 / view.pixel_ratio.max(0.1);
                let (top, bottom) = (padding[0] + 0.5 * line, (css_h - padding[2] - 0.5 * line).max(padding[0] + 0.5 * line));
                let capacity = (((bottom - top) / line).floor() as usize + 1).max(1);
                let re = r + LEADER_ELBOW_PX;
                for side in [1i8, -1] {
                    // (slice, mid angle, desired y)
                    let mut cands: Vec<(usize, f32, f32)> = self
                        .slices
                        .iter()
                        .enumerate()
                        .filter(|(_, s)| s.span() > 0.0 && s.span() >= min_span)
                        .filter_map(|(k, s)| {
                            let (lo, hi) = self.compass(s);
                            let mid = 0.5 * (lo + hi);
                            let v = dir_css(mid);
                            ((if v.0 >= 0.0 { 1 } else { -1 }) == side).then_some((k, mid, cy + v.1 * re))
                        })
                        .collect();
                    if cands.len() > capacity {
                        // Not enough room on this side: the largest slices keep their labels
                        cands.sort_by(|a, b| self.slices[b.0].value.total_cmp(&self.slices[a.0].value).then(a.0.cmp(&b.0)));
                        cands.truncate(capacity);
                    }
                    cands.sort_by(|a, b| a.2.total_cmp(&b.2));
                    let ys = nudge(&cands.iter().map(|c| c.2).collect::<Vec<_>>(), line, top, bottom);
                    let sf = side as f32;
                    for (&(k, mid, _), &y) in cands.iter().zip(&ys) {
                        let v = dir_css(mid);
                        let dy = y - cy;
                        // Elbow on the elbow circle at the label's height (outside the rim)
                        let ex_off = if dy.abs() < re { (re * re - dy * dy).sqrt().max(v.0.abs() * re) } else { v.0.abs() * re };
                        let ex = cx + sf * ex_off;
                        // ex_off <= re: the text anchor is always past the elbow
                        let ax = cx + sf * (re + LEADER_TEXT_PX);
                        let rk = r * self.slices[k].r_out / PIE_RADIUS + LEADER_START_PX;
                        let start = (cx + v.0 * rk, cy + v.1 * rk);
                        let world = |p: (f32, f32)| ((p.0 - cx) * screen.wpp, -(p.1 - cy) * screen.wpp);
                        for (a, b) in [(start, (ex, y)), ((ex, y), (ax, y))] {
                            let (a, b) = (world(a), world(b));
                            leaders.push(ChartSegmentRaw {
                                p0_width: [a.0, a.1, 0.0, 1.0],
                                p1_pad: [b.0, b.1, 0.0, 0.0],
                                color: self.style.leader_color,
                            });
                        }
                        out.push(PieLabel { slice: k as u32, x_css: ax, y_css: y, side });
                    }
                }
                out.sort_by_key(|l| l.slice);
            }
        }
        let changed = out != self.labels;
        if changed {
            self.labels_revision = self.labels_revision.wrapping_add(1);
            std::mem::swap(&mut self.labels, &mut out);
        }
        self.labels_scratch = out;
        changed
    }

    /// World bounding box `(x0, x1, y0, y1)` of the full-radius sweep (hole edge or center
    /// included): the whole disk for a full turn.
    fn extent(&self) -> (f32, f32, f32, f32) {
        if self.sweep >= TAU {
            return (-PIE_RADIUS, PIE_RADIUS, -PIE_RADIUS, PIE_RADIUS);
        }
        let a = self.start_rad();
        let (lo, hi) = if self.opts.clockwise { (a, a + self.sweep) } else { (a - self.sweep, a) };
        // Both edges at the rim and the hole (the center for a pie)
        let mut pts: Vec<(f32, f32)> = [lo, hi].iter().flat_map(|&phi| [PIE_RADIUS, self.r_in()].map(|r| polar((0.0, 0.0), phi, r))).collect();
        // Compass extremes (up / right / down / left) inside the sweep
        for q in (lo / FRAC_PI_2).ceil() as i32..=(hi / FRAC_PI_2).floor() as i32 {
            pts.push(polar((0.0, 0.0), q as f32 * FRAC_PI_2, PIE_RADIUS));
        }
        pts.iter().fold((f32::MAX, f32::MIN, f32::MAX, f32::MIN), |(x0, x1, y0, y1), p| (x0.min(p.0), x1.max(p.0), y0.min(p.1), y1.max(p.1)))
    }

    /// Plot rectangle = the bounding box of the sweep; no ticks.
    pub(crate) fn axes(&self, view: &ChartView, out: &mut AxisLayout) {
        out.ticks.clear();
        let (x0, x1, y0, y1) = self.extent();
        out.plot_css = match (view.project_css(Vec3::new(x0, y1, 0.0)), view.project_css(Vec3::new(x1, y0, 0.0))) {
            (Some(a), Some(b)) => [a.0.min(b.0), a.1.min(b.1), (b.0 - a.0).abs(), (b.1 - a.1).abs()],
            _ => [0.0; 4],
        };
    }

    /// Fits the sweep's bounding box into the padded plot, keeping room for the explode offset
    /// and outside labels.
    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        let m = PIE_EXPLODE_PX + 2.0;
        let [sh, sv] = if self.opts.labels == PieLabelMode::Outside { self.opts.label_space_px } else { [0.0; 2] };
        let pad = [padding[0] + m + sv, padding[1] + m + sh, padding[2] + m + sv, padding[3] + m + sh];
        let (x0, x1, y0, y1) = self.extent();
        frame_flat_at(camera, css, (0.5 * (x0 + x1), 0.5 * (y0 + y1)), x1 - x0, y1 - y0, &pad);
    }
}

/// Moves sorted label centers `ys` apart by at least `line`, staying within `[top, bottom]`
/// where possible (forward pass down, then back up from the bottom bound, then down from the top).
pub(crate) fn nudge(ys: &[f32], line: f32, top: f32, bottom: f32) -> Vec<f32> {
    let mut out: Vec<f32> = ys.to_vec();
    let n = out.len();
    if n == 0 {
        return out;
    }
    out[0] = out[0].max(top);
    for i in 1..n {
        out[i] = out[i].max(out[i - 1] + line);
    }
    if out[n - 1] > bottom {
        out[n - 1] = bottom;
        for i in (0..n - 1).rev() {
            out[i] = out[i].min(out[i + 1] - line);
        }
    }
    if out[0] < top {
        out[0] = top;
        for i in 1..n {
            out[i] = out[i].max(out[i - 1] + line);
        }
    }
    out
}

impl ChartState {
    /// Creates a pie / donut chart from validated values (see `validate_pie`).
    pub fn new_pie(values: &[f64], opts: PieOptions, style: PieStyle) -> Self {
        Self::with_kind(ChartKind::Pie(PieChart::new(values, opts, style)))
    }

    /// Palette / per-value colors / leader and surface colors of the pie (re-tessellates).
    pub fn set_pie_style(&mut self, style: PieStyle) {
        if let ChartKind::Pie(p) = &mut self.kind {
            p.set_style(style);
            self.dirty.fills = true;
            self.dirty.underlay = true;
        }
    }

    pub fn pie_slices(&self) -> Option<&[PieSlice]> {
        match &self.kind {
            ChartKind::Pie(p) => Some(&p.slices),
            _ => None,
        }
    }

    /// Input indices folded into the "Other" slice.
    pub fn pie_other(&self) -> Option<&[usize]> {
        match &self.kind {
            ChartKind::Pie(p) => Some(&p.other),
            _ => None,
        }
    }

    /// Label anchors of the last prepared frame and their revision.
    pub fn pie_labels(&self) -> Option<(&[PieLabel], u32)> {
        match &self.kind {
            ChartKind::Pie(p) => Some((&p.labels, p.labels_revision)),
            _ => None,
        }
    }

    /// Center / radii of the last prepared frame, visible total and hovered slice.
    pub fn pie_layout(&self) -> Option<PieLayoutInfo> {
        let ChartKind::Pie(p) = &self.kind else {
            return None;
        };
        let s = p.screen?;
        Some(PieLayoutInfo {
            center_css: s.center_css,
            r_out_css: s.r_css,
            r_in_css: s.r_css * p.opts.inner_ratio,
            total: p.total,
            hovered: self.hover.as_ref().and_then(|h| h.items.get(h.primary)).map(|i| i.index as usize),
        })
    }

    /// Re-tessellates when the on-screen scale / hover / emphasis / visibility changed and
    /// re-lays out labels when the view or padding moved.
    pub(crate) fn prepare_pie(&mut self, view: &ChartView) {
        let hovered = self.hover.as_ref().and_then(|h| h.items.get(h.primary)).map(|i| i.index as usize);
        let ChartKind::Pie(p) = &mut self.kind else {
            return;
        };
        let Some(screen) = PieChart::screen_of(view) else {
            return;
        };
        p.screen = Some(screen);
        let stale = match p.built {
            Some((wpp, h)) => h != hovered || ((wpp - screen.wpp) / screen.wpp).abs() > 1e-4,
            None => true,
        };
        if stale || self.dirty.fills {
            p.build(screen.wpp, hovered, &mut self.fills, &mut self.series);
            p.built = Some((screen.wpp, hovered));
            self.dirty.fills = true;
            self.dirty.series = true;
        }
        let key = (view.key(), self.padding);
        if p.labels_key != Some(key) || self.dirty.underlay {
            p.layout_labels(view, screen, &self.padding, &mut self.underlay);
            p.labels_key = Some(key);
            self.dirty.underlay = true;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn pie(values: &[f64], opts: PieOptions) -> (ChartState, OrbitCamera) {
        validate_pie(values).unwrap();
        let chart = ChartState::new_pie(values, opts, PieStyle::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &PieChart {
        match &chart.kind {
            ChartKind::Pie(p) => p,
            _ => unreachable!(),
        }
    }

    fn ndc_at(cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let n = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        (n.x, n.y)
    }

    /// Distance of point `p` from the line through the origin at compass angle `phi`.
    fn dist_to_ray_line(p: (f32, f32), phi: f32) -> f32 {
        (p.0 * phi.cos() - p.1 * phi.sin()).abs()
    }

    #[test]
    fn angles_and_percents_follow_the_values_and_direction() {
        let (chart, _) = pie(&[1.0, 3.0, 0.0, 4.0], PieOptions::default());
        let p = inner(&chart);
        let s = &p.slices;
        assert_eq!(s.len(), 4);
        assert!((s[0].percent - 12.5).abs() < 1e-9 && (s[1].percent - 37.5).abs() < 1e-9);
        assert_eq!(s[2].percent, 0.0);
        assert!((s[1].start - TAU * 0.125).abs() < 1e-5 && (s[1].end - TAU * 0.5).abs() < 1e-5);
        assert_eq!(s[3].end, TAU, "last slice closes the circle");
        // Clockwise from 12 o'clock: slice 0 is right of the top
        let (lo, hi) = p.compass(&s[0]);
        assert!(lo == 0.0 && hi > 0.0);
        // Counter-clockwise, starting at 3 o'clock: slice 0 runs up from 90 degrees
        let (ccw, _) = pie(&[1.0, 3.0], PieOptions { clockwise: false, start_angle_deg: 90.0, ..Default::default() });
        let q = inner(&ccw);
        let (lo, hi) = q.compass(&q.slices[0]);
        assert!((hi - FRAC_PI_2).abs() < 1e-5 && (lo - (FRAC_PI_2 - TAU * 0.25)).abs() < 1e-5);
        // Bad input is rejected
        assert!(validate_pie(&[1.0, -2.0]).is_err());
        assert!(validate_pie(&[f64::NAN]).unwrap_err().contains("value 0"));
        assert!(validate_pie(&[0.0, 1e9]).is_ok());
    }

    #[test]
    fn small_slices_fold_into_other_and_sorting_keeps_other_last() {
        let values = [5.0, 1.0, 9.0, 2.0, 7.0, 3.0];
        let (slices, other) = fold_slices(&values, PieSort::None, 4);
        // 3 largest keep input order, the rest fold
        assert_eq!(slices, vec![(Some(0), 5.0), (Some(2), 9.0), (Some(4), 7.0), (None, 6.0)]);
        assert_eq!(other, vec![1, 3, 5]);
        let (sorted, _) = fold_slices(&values, PieSort::Descending, 4);
        assert_eq!(sorted.iter().map(|s| s.0).collect::<Vec<_>>(), vec![Some(2), Some(4), Some(0), None]);
        // Exactly max slices or folding disabled: nothing folds
        assert!(fold_slices(&values, PieSort::None, 6).1.is_empty());
        let (all, none) = fold_slices(&values, PieSort::Descending, 0);
        assert_eq!((all.len(), none.len()), (6, 0));
        assert_eq!(all[0], (Some(2), 9.0));
        // Ties keep input order
        let (tie, _) = fold_slices(&[1.0, 1.0, 1.0], PieSort::Descending, 0);
        assert_eq!(tie.iter().map(|s| s.0.unwrap()).collect::<Vec<_>>(), vec![0, 1, 2]);

        // Colors: palette in display order, "Other" neutral, per-value overrides win
        let style = PieStyle { colors: vec![None, None, Some([1.0, 0.0, 0.0, 1.0])], ..Default::default() };
        let chart = ChartState::new_pie(&values, PieOptions { max_slices: 4, ..Default::default() }, style.clone());
        let s = chart.pie_slices().unwrap();
        assert_eq!(s[0].color, style.palette[0]);
        assert_eq!(s[1].color, [1.0, 0.0, 0.0, 1.0]);
        assert_eq!(s[2].color, style.palette[2]);
        assert_eq!(s[3].color, style.other_color);
        assert_eq!(chart.pie_other().unwrap(), &[1, 3, 5]);
        assert!((s[3].percent - 6.0 / 27.0 * 100.0).abs() < 1e-9);
    }

    #[test]
    fn arc_chords_stay_within_a_quarter_pixel() {
        for r_px in [3.0f32, 40.0, 180.0, 400.0, 1500.0] {
            let n = arc_segments(TAU, r_px);
            let step = TAU / n as f32;
            let sagitta = r_px * (1.0 - (0.5 * step).cos());
            assert!(sagitta <= PIE_CHORD_ERROR_PX + 1e-3, "r {r_px}: {sagitta}");
            // Not wastefully fine either: one segment fewer would break the bound
            if n > 4 {
                let coarser = TAU / (n - 1) as f32;
                assert!(r_px * (1.0 - (0.5 * coarser).cos()) > PIE_CHORD_ERROR_PX * 0.9, "r {r_px}");
            }
        }

        // Tessellated outer rim of a real slice: every chord midpoint within 0.25 px of the arc
        let (mut chart, cam) = pie(&[2.0, 3.0, 4.0], PieOptions { labels: PieLabelMode::None, ..Default::default() });
        chart.prepare_layers(&view(&cam));
        let wpp = inner(&chart).screen.unwrap().wpp;
        let rim = PIE_RADIUS - 0.5 * AA_PX * wpp;
        let mut checked = 0;
        for tri in chart.fills.chunks(3) {
            // Fan triangles: apex + two rim vertices
            let (a, b) = (tri[1].position, tri[2].position);
            let mid = (0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]));
            let err = (rim - mid.0.hypot(mid.1)) / wpp;
            assert!((-1e-3..=PIE_CHORD_ERROR_PX + 1e-3).contains(&err), "chord error {err} px");
            checked += 1;
        }
        assert!(checked > 30);
        // Segment count follows the on-screen radius: a 4x larger pie needs ~2x the chords
        let (small, big) = (arc_segments(TAU, 50.0), arc_segments(TAU, 200.0));
        assert!(big >= 2 * small - 1 && big <= 2 * small + 1, "{small} {big}");
    }

    #[test]
    fn slices_leave_a_two_pixel_gap_without_overdraw() {
        let wpp = 0.25; // 4 CSS px per world unit
        let d = (0.5 * PIE_GAP_PX + 0.5 * AA_PX) * wpp;
        for r_in in [0.0, 20.0] {
            let (mut fills, mut edges) = (Vec::new(), Vec::new());
            // Two slices meeting at the 90 degree ray, plus a reflex slice (pie: rounded center)
            for (lo, hi) in [(0.0, FRAC_PI_2), (FRAC_PI_2, TAU)] {
                let shape = SliceShape { lo, hi, r_out: PIE_RADIUS, r_in, full: false };
                assert!(tessellate_slice(&shape, wpp, (0.0, 0.0), [1.0; 4], &mut fills, &mut edges));
            }
            // Every fill vertex keeps >= d from both dividing lines on its side, so the AA ramp
            // (0.5 px either side of `d - 0.5 px`) leaves 2 px of surface between neighbours
            for v in &fills {
                let p = (v.position[0], v.position[1]);
                let phi = p.0.atan2(p.1).rem_euclid(TAU);
                for ray in [0.0, FRAC_PI_2] {
                    // Only the half-line side matters (the opposite half is another slice's interior)
                    let along = p.0 * ray.sin() + p.1 * ray.cos();
                    if along > 0.0 {
                        assert!(dist_to_ray_line(p, ray) >= d - 1e-4, "r_in {r_in}: {p:?} at {phi} too close to {ray}");
                    }
                }
                assert!(p.0.hypot(p.1) <= PIE_RADIUS - 0.5 * AA_PX * wpp + 1e-4, "inside the rim");
                if r_in > 0.0 {
                    assert!(p.0.hypot(p.1) >= r_in + 0.5 * AA_PX * wpp - 1e-4, "outside the hole");
                }
            }
            // The AA outline traces the fill boundary with 1 px strokes in the slice color
            assert!(edges.iter().all(|e| e.p0_width[3] == AA_PX && e.color == [1.0; 4]));
            // Pie vs donut both keep the fill area close to the analytic inset area (no overdraw)
            let area: f32 = fills
                .chunks(3)
                .map(|t| {
                    let [a, b, c] = [t[0].position, t[1].position, t[2].position];
                    0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])).abs()
                })
                .sum();
            let r_o = PIE_RADIUS - 0.5 * AA_PX * wpp;
            let r_i = if r_in > 0.0 { r_in + 0.5 * AA_PX * wpp } else { 0.0 };
            let full = std::f32::consts::PI * (r_o * r_o - r_i * r_i);
            // Two gap strips of width 2d across the ring, minus nothing else
            let gaps = 2.0 * 2.0 * d * (r_o - r_i);
            assert!((area - (full - gaps)).abs() / full < 0.01, "r_in {r_in}: area {area} vs {}", full - gaps);
        }

        // A single visible slice is a full disk without gaps
        let (mut fills, mut edges) = (Vec::new(), Vec::new());
        let shape = SliceShape { lo: 0.0, hi: TAU, r_out: PIE_RADIUS, r_in: 0.0, full: true };
        assert!(tessellate_slice(&shape, wpp, (0.0, 0.0), [1.0; 4], &mut fills, &mut edges));
        assert!(fills.iter().any(|v| v.position[0].abs() < 1e-6 && v.position[1] > 0.0), "covers the top ray");
        // A sliver thinner than the gap disappears instead of folding over
        let sliver = SliceShape { lo: 0.0, hi: 0.01, r_out: PIE_RADIUS, r_in: 0.0, full: false };
        assert!(!tessellate_slice(&sliver, wpp, (0.0, 0.0), [1.0; 4], &mut fills, &mut edges));
    }

    #[test]
    fn hover_is_an_angle_search_that_skips_the_donut_hole_and_explodes_the_slice() {
        let opts = PieOptions { inner_ratio: 0.5, labels: PieLabelMode::None, ..Default::default() };
        let (mut chart, cam) = pie(&[1.0, 1.0, 2.0], opts);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let layers = chart.prepare_layers(&v);
        let before = layers.fills.unwrap().to_vec();
        assert!(layers.series.unwrap().len() > 20, "AA outline strokes");
        // Clockwise from the top: slice 0 = 0-90 deg (upper right), slice 2 = left half
        let r = 0.75 * PIE_RADIUS;
        let hit = chart.hover_at(&v, &mut scene, ndc_at(&cam, r * 0.7, r * 0.7)).expect("slice 0");
        assert_eq!((hit.items[0].index, hit.items[0].value), (0, 1.0));
        assert_eq!(chart.hover_at(&v, &mut scene, ndc_at(&cam, -r, 0.0)).unwrap().items[0].index, 2);
        assert_eq!(chart.hover_at(&v, &mut scene, ndc_at(&cam, r * 0.7, -r * 0.7)).unwrap().items[0].index, 1);
        // Donut hole and far outside: nothing
        assert!(chart.hover_at(&v, &mut scene, ndc_at(&cam, 0.2 * PIE_RADIUS, 0.0)).is_none());
        assert!(chart.hover_at(&v, &mut scene, ndc_at(&cam, 1.3 * PIE_RADIUS, 0.0)).is_none());
        // Hovered slice moves outward along its bisector; the rest stays put
        chart.hover_at(&v, &mut scene, ndc_at(&cam, r * 0.7, r * 0.7));
        let layers = chart.prepare_layers(&v);
        let after = layers.fills.unwrap().to_vec();
        assert_eq!(after.len(), before.len());
        let moved: Vec<f32> = before.iter().zip(&after).map(|(a, b)| (b.position[0] - a.position[0]).hypot(b.position[1] - a.position[1])).collect();
        let wpp = inner(&chart).screen.unwrap().wpp;
        assert!(moved.iter().any(|&m| (m / wpp - PIE_EXPLODE_PX).abs() < 1e-2));
        assert!(moved.iter().filter(|&&m| m == 0.0).count() > after.len() / 2);
        assert_eq!(chart.pie_layout().unwrap().hovered, Some(0));
        // Hover follows the exploded shape: just past slice 0's moved rim it stays hovered; the
        // same radius at a non-hovered slice is empty
        let p = inner(&chart);
        let beyond = PIE_RADIUS + 3.0 * wpp;
        let (lo, hi) = p.compass(&p.slices[0]);
        let (x, y) = polar((0.0, 0.0), 0.5 * (lo + hi), beyond);
        assert_eq!(p.slice_at(x, y, wpp, Some(0)), Some(0));
        assert_eq!(p.slice_at(x, y, wpp, None), None);
        let (lo, hi) = p.compass(&p.slices[2]);
        let (x, y) = polar((0.0, 0.0), 0.5 * (lo + hi), beyond);
        assert_eq!(p.slice_at(x, y, wpp, Some(0)), None);
        // Same frame again: nothing rebuilt
        assert!(chart.prepare_layers(&v).fills.is_none());

        // Pure angle search covers every slice boundary (O(log n) partition point)
        let p = inner(&chart);
        for (k, s) in p.slices.iter().enumerate() {
            let (lo, hi) = p.compass(s);
            let (x, y) = polar((0.0, 0.0), 0.5 * (lo + hi), r);
            assert_eq!(p.slice_at(x, y, wpp, None), Some(k));
        }
        // Sample positions (keyboard focus) hover their own slice
        for k in 0..3u32 {
            let c = chart.sample(k).unwrap().3;
            assert_eq!(chart.hover_at(&v, &mut scene, ndc_at(&cam, c.x, c.y)).unwrap().items[0].index, k);
        }
        // Cursor sync never hovers a pie
        assert!(chart.hover_at_data_x(&mut scene, 1.0).is_none());
    }

    #[test]
    fn legend_toggle_relayouts_and_emphasis_fades_other_slices() {
        let (mut chart, cam) = pie(&[1.0, 1.0, 2.0], PieOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        chart.hover_at(&v, &mut scene, ndc_at(&cam, -30.0, 0.0)).unwrap();
        chart.set_series_visible(2, false, &mut scene);
        assert!(!chart.series_visible(2) && chart.series_count() == 3);
        let s = chart.pie_slices().unwrap();
        assert!((s[0].percent - 50.0).abs() < 1e-9 && s[2].percent.is_nan());
        assert_eq!((s[1].end, s[2].start, s[2].end), (TAU, TAU, TAU));
        assert!(chart.pie_layout().unwrap().hovered.is_none(), "re-layout drops the hover");
        let layers = chart.prepare_layers(&v);
        assert!(layers.fills.is_some() && layers.underlay.is_some());

        chart.set_emphasis(Some(0));
        let fills = chart.prepare_layers(&v).fills.unwrap().to_vec();
        let base = chart.pie_slices().unwrap()[1].color;
        assert!(fills.iter().any(|f| f.color != base && f.color[3] == 1.0), "faded toward the surface, still opaque");
    }

    #[test]
    fn outside_labels_get_leader_lines_and_are_nudged_apart_per_side() {
        // Six thin slices just left of 12 o'clock: their labels would overlap without nudging
        let mut values = vec![100.0];
        values.extend([1.0; 6]);
        let opts = PieOptions { max_slices: 0, label_min_angle_deg: 1.0, label_space_px: [90.0, 20.0], ..Default::default() };
        let (mut chart, cam) = pie(&values, opts);
        let v = view(&cam);
        chart.prepare_layers(&v);
        let (labels, rev) = chart.pie_labels().unwrap();
        let labels = labels.to_vec();
        assert_eq!(labels.len(), 7);
        let layout = chart.pie_layout().unwrap();
        for side in [-1i8, 1] {
            let mut ys: Vec<f32> = labels.iter().filter(|l| l.side == side).map(|l| l.y_css).collect();
            ys.sort_by(f32::total_cmp);
            assert!(ys.windows(2).all(|w| w[1] - w[0] >= 16.0 - 1e-3), "side {side}: {ys:?}");
        }
        for l in &labels {
            let dx = (l.x_css - layout.center_css.0) * l.side as f32;
            assert!(dx >= layout.r_out_css + LEADER_ELBOW_PX, "anchor beyond the elbow");
        }
        // Two leader segments per label, beneath the slices
        assert_eq!(chart.underlay.len(), 14);
        // Same view: same revision; padding change re-lays out
        chart.prepare_layers(&v);
        assert_eq!(chart.pie_labels().unwrap().1, rev);

        // Nudging keeps the order and the bounds when there is room
        let ys = nudge(&[10.0, 12.0, 13.0, 95.0], 10.0, 0.0, 100.0);
        assert_eq!(ys, vec![10.0, 20.0, 30.0, 95.0]);
        let ys = nudge(&[90.0, 95.0, 99.0], 10.0, 0.0, 100.0);
        assert_eq!(ys, vec![80.0, 90.0, 100.0]);

        // Inside (percent) labels sit inside their slice, small slices get none
        let (mut chart, cam) = pie(&[10.0, 10.0, 0.2], PieOptions { labels: PieLabelMode::Inside, ..Default::default() });
        chart.prepare_layers(&view(&cam));
        let (inside, _) = chart.pie_labels().unwrap();
        assert_eq!(inside.iter().map(|l| (l.slice, l.side)).collect::<Vec<_>>(), vec![(0, 0), (1, 0)]);
        assert!(chart.underlay.is_empty(), "no leaders inside");
    }

    /// Max distance from the center of the fill vertices tagged with `color`.
    fn max_fill_radius(chart: &ChartState, color: [f32; 4]) -> f32 {
        chart.fills.iter().filter(|f| f.color == color).map(|f| f.position[0].hypot(f.position[1])).fold(0.0, f32::max)
    }

    #[test]
    fn rose_radius_keeps_the_angles_and_makes_slice_area_proportional_to_the_value() {
        let opts = PieOptions { rose: PieRose::Radius, labels: PieLabelMode::None, ..Default::default() };
        let (mut chart, cam) = pie(&[1.0, 4.0], opts);
        let v = view(&cam);
        chart.prepare_layers(&v);
        let p = inner(&chart);
        let s = &p.slices;
        // Angles still follow the shares, the largest value reaches the full radius
        assert!((s[0].end - TAU * 0.2).abs() < 1e-5);
        assert_eq!(s[1].r_out, PIE_RADIUS);
        // Area (not radius) is proportional to the value: r = R sqrt(v / max)
        assert!((s[0].r_out - 0.5 * PIE_RADIUS).abs() < 1e-4, "{}", s[0].r_out);
        let wpp = p.screen.unwrap().wpp;
        let r0 = max_fill_radius(&chart, s[0].color);
        assert!(r0 <= s[0].r_out && r0 > s[0].r_out - 2.0 * wpp, "slice 0 drawn at its own radius: {r0}");
        // Hover follows the shorter rim; keyboard samples stay inside their slice
        let mid = 0.5 * (s[0].start + s[0].end);
        let (x, y) = polar((0.0, 0.0), mid, 0.4 * PIE_RADIUS);
        assert_eq!(p.slice_at(x, y, wpp, None), Some(0));
        let (x, y) = polar((0.0, 0.0), mid, 0.7 * PIE_RADIUS);
        assert_eq!(p.slice_at(x, y, wpp, None), None);
        let mut scene = SceneWorld::new();
        for k in 0..2u32 {
            let c = chart.sample(k).unwrap().3;
            assert_eq!(chart.hover_at(&v, &mut scene, ndc_at(&cam, c.x, c.y)).unwrap().items[0].index, k);
        }

        // Donut: ring area (r^2 - r_in^2) is proportional to the value; zero sits on the hole
        let opts = PieOptions { rose: PieRose::Radius, inner_ratio: 0.4, ..Default::default() };
        let (chart, _) = pie(&[1.0, 4.0, 0.0], opts);
        let s = chart.pie_slices().unwrap();
        let ri = 0.4 * PIE_RADIUS;
        let ring = |r: f32| r * r - ri * ri;
        assert!((ring(s[0].r_out) / ring(s[1].r_out) - 0.25).abs() < 1e-4);
        assert_eq!(s[2].r_out, ri);
        // Default: every slice reaches the full radius
        let (plain, _) = pie(&[1.0, 4.0], PieOptions::default());
        assert!(plain.pie_slices().unwrap().iter().all(|s| s.r_out == PIE_RADIUS));
    }

    #[test]
    fn rose_area_gives_equal_angles_and_labels_follow_each_slice_rim() {
        let opts = PieOptions { rose: PieRose::Area, max_slices: 0, label_space_px: [90.0, 20.0], ..Default::default() };
        let (mut chart, cam) = pie(&[1.0, 4.0, 9.0, 0.0], opts);
        chart.prepare_layers(&view(&cam));
        let s = chart.pie_slices().unwrap();
        for k in 0..4 {
            assert!((s[k].end - s[k].start - TAU / 4.0).abs() < 1e-5, "slice {k}: equal angle");
        }
        // Percents still report the share of the total
        assert!((s[2].percent - 9.0 / 14.0 * 100.0).abs() < 1e-9);
        assert!((s[0].r_out / s[2].r_out - 1.0 / 3.0).abs() < 1e-4);
        // Hiding the largest slice rescales the rest against the new maximum
        chart.set_series_visible(2, false, &mut SceneWorld::new());
        let s = chart.pie_slices().unwrap();
        assert_eq!(s[1].r_out, PIE_RADIUS);
        assert!((s[0].end - s[0].start - TAU / 3.0).abs() < 1e-5);

        // Outside leader lines start just beyond each slice's own rim, not the full radius
        let (mut chart, cam) = pie(&[1.0, 1.0, 16.0, 16.0], PieOptions { rose: PieRose::Area, label_min_angle_deg: 1.0, ..Default::default() });
        chart.prepare_layers(&view(&cam));
        let p = inner(&chart);
        let wpp = p.screen.unwrap().wpp;
        let starts: Vec<f32> = chart.underlay.chunks(2).map(|l| l[0].p0_width[0].hypot(l[0].p0_width[1]) / wpp).collect();
        let rims: Vec<f32> = chart.pie_labels().unwrap().0.iter().map(|l| p.slices[l.slice as usize].r_out / wpp).collect();
        assert_eq!(starts.len(), 4);
        // Leader order follows the labels (sorted by slice), per side; compare as sets
        let mut want: Vec<f32> = rims.iter().map(|r| r + LEADER_START_PX).collect();
        let mut got = starts.clone();
        want.sort_by(f32::total_cmp);
        got.sort_by(f32::total_cmp);
        for (g, w) in got.iter().zip(&want) {
            assert!((g - w).abs() < 0.05, "leader starts {got:?} vs rims {want:?}");
        }
    }

    #[test]
    fn pad_angle_opens_an_angular_gap_between_slices() {
        for inner_ratio in [0.0, 0.5] {
            let opts = PieOptions { pad_angle_deg: 10.0, inner_ratio, labels: PieLabelMode::None, ..Default::default() };
            let (mut chart, cam) = pie(&[1.0, 1.0, 1.0, 1.0], opts);
            chart.prepare_layers(&view(&cam));
            // Quarter slices: every vertex away from the center keeps >= 5 degrees from the
            // dividing rays at 0 / 90 / 180 / 270 degrees (the apex sits on the bisector)
            assert!(!chart.fills.is_empty());
            for f in &chart.fills {
                let (x, y) = (f.position[0], f.position[1]);
                if x.hypot(y) < 1.0 {
                    continue;
                }
                let deg = x.atan2(y).to_degrees().rem_euclid(90.0);
                assert!((5.0 - 1e-3..=85.0 + 1e-3).contains(&deg), "r_in {inner_ratio}: vertex at {deg} degrees");
            }
            // Angles, percents and the hit test keep the unpadded layout
            let s = chart.pie_slices().unwrap();
            assert!((s[1].start - FRAC_PI_2).abs() < 1e-5 && (s[0].percent - 25.0).abs() < 1e-9);
        }
        // A slice narrower than the pad disappears; a lone slice stays a full disk
        let opts = PieOptions { pad_angle_deg: 20.0, max_slices: 0, labels: PieLabelMode::None, ..Default::default() };
        let (mut chart, cam) = pie(&[100.0, 1.0], opts);
        chart.prepare_layers(&view(&cam));
        let tiny = chart.pie_slices().unwrap()[1].color;
        assert!(chart.fills.iter().all(|f| f.color != tiny));
        let (mut lone, cam) = pie(&[1.0], opts);
        lone.prepare_layers(&view(&cam));
        assert!(lone.fills.iter().any(|f| f.position[0].abs() < 1e-4 && f.position[1] > 1.0), "covers the top ray");
        // Out-of-range pads are clamped / ignored
        for (pad, want) in [(f32::NAN, 0.0), (-5.0, 0.0), (90.0, 45.0)] {
            let (c, _) = pie(&[1.0, 1.0], PieOptions { pad_angle_deg: pad, ..Default::default() });
            assert_eq!(inner(&c).opts.pad_angle_deg, want, "pad {pad}");
        }
    }

    #[test]
    fn end_angle_limits_the_sweep_and_the_half_donut_fills_the_plot() {
        // Top half, clockwise from 9 o'clock to 3 o'clock
        let half = PieOptions { start_angle_deg: -90.0, end_angle_deg: 90.0, inner_ratio: 0.5, labels: PieLabelMode::None, ..Default::default() };
        let (mut chart, cam) = pie(&[1.0, 1.0], half);
        let v = view(&cam);
        chart.prepare_layers(&v);
        let p = inner(&chart);
        let s = &p.slices;
        assert!((s[0].end - FRAC_PI_2).abs() < 1e-5 && (s[1].end - std::f32::consts::PI).abs() < 1e-5);
        assert!((s[0].percent - 50.0).abs() < 1e-9);
        let (lo, hi) = p.compass(&s[0]);
        assert!((lo + FRAC_PI_2).abs() < 1e-5 && hi.abs() < 1e-5, "upper-left quadrant: {lo} {hi}");
        // Nothing below the center: no fill, no hit
        assert!(chart.fills.iter().all(|f| f.position[1] > -1e-3), "lower half stays empty");
        let wpp = p.screen.unwrap().wpp;
        let r = 0.75 * PIE_RADIUS;
        assert_eq!(p.slice_at(-r * 0.7, r * 0.7, wpp, None), Some(0));
        assert_eq!(p.slice_at(r * 0.7, r * 0.7, wpp, None), Some(1));
        assert_eq!(p.slice_at(0.0, -r, wpp, None), None);

        // Framing fits the half ring's box: much larger than the full ring on a wide canvas
        let r_half = chart.pie_layout().unwrap().r_out_css;
        let (mut full, cam_full) = pie(&[1.0, 1.0], PieOptions { end_angle_deg: f32::NAN, ..half });
        full.prepare_layers(&view(&cam_full));
        let r_full = full.pie_layout().unwrap().r_out_css;
        assert!(r_half > 1.5 * r_full, "half {r_half} vs full {r_full}");
        // The plot box is the half ring: twice as wide as tall, its bottom edge on the center
        let [l, t, w, h] = chart.axes().plot_css;
        let c = chart.pie_layout().unwrap().center_css;
        assert!((w - 2.0 * r_half).abs() < 0.5 && (h - r_half).abs() < 0.5, "{w} x {h} for r {r_half}");
        assert!((l + 0.5 * w - c.0).abs() < 0.5 && (t + h - c.1).abs() < 0.5);
        assert!(t >= 0.0 && t + h <= 900.0);

        // A lone visible slice keeps the sweep (no full disk)
        let (mut lone, cam_lone) = pie(&[3.0], half);
        lone.prepare_layers(&view(&cam_lone));
        assert!(lone.fills.iter().all(|f| f.position[1] > -1e-3));
        assert!(!lone.fills.is_empty());

        // Counter-clockwise from 3 o'clock back to 9 o'clock covers the same top half
        let ccw = PieOptions { clockwise: false, start_angle_deg: 90.0, end_angle_deg: -90.0, ..half };
        let (mut chart, cam) = pie(&[1.0, 1.0], ccw);
        chart.prepare_layers(&view(&cam));
        let p = inner(&chart);
        assert!((p.slices[1].end - std::f32::consts::PI).abs() < 1e-5);
        assert!(chart.fills.iter().all(|f| f.position[1] > -1e-3));
        assert_eq!(p.slice_at(r * 0.7, r * 0.7, wpp, None), Some(0));
        // End at or before the start: a full turn (like the gauge); beyond a turn: clamped
        for end in [-90.0, -100.0, 400.0] {
            let (c, _) = pie(&[1.0, 1.0], PieOptions { start_angle_deg: -90.0, end_angle_deg: end, ..Default::default() });
            assert_eq!(c.pie_slices().unwrap()[1].end, TAU, "end {end}");
        }
    }

    #[test]
    fn framing_reserves_label_room_and_axes_report_the_pie_box() {
        let (mut plain, cam) = pie(&[1.0, 2.0], PieOptions { labels: PieLabelMode::None, ..Default::default() });
        plain.prepare_layers(&view(&cam));
        let r0 = plain.pie_layout().unwrap().r_out_css;
        let (mut labeled, cam2) = pie(&[1.0, 2.0], PieOptions { label_space_px: [120.0, 40.0], ..Default::default() });
        labeled.prepare_layers(&view(&cam2));
        let r1 = labeled.pie_layout().unwrap().r_out_css;
        assert!(r1 < r0 - 30.0, "label room shrinks the pie: {r0} -> {r1}");
        let [l, t, w, h] = labeled.axes().plot_css;
        let c = labeled.pie_layout().unwrap().center_css;
        assert!((w - 2.0 * r1).abs() < 1e-2 && (h - w).abs() < 1e-3);
        assert!((l + 0.5 * w - c.0).abs() < 1e-2 && (t + 0.5 * h - c.1).abs() < 1e-2);
        assert!(labeled.axes().ticks.is_empty());
        // Height-bound plot: vertical padding + explode room around the pie
        let [pt, _, pb, _] = DEFAULT_CHART_PADDING;
        let m = PIE_EXPLODE_PX + 2.0;
        assert!((2.0 * r0 - (900.0 - pt - pb - 2.0 * m)).abs() < 0.5, "{r0}");
        // No data: no hover, nothing drawn
        let (mut empty, cam3) = pie(&[0.0, 0.0], PieOptions::default());
        let layers = empty.prepare_layers(&view(&cam3));
        assert!(layers.fills.unwrap().is_empty());
        assert!(empty.hover_at(&view(&cam3), &mut SceneWorld::new(), (0.0, 0.0)).is_none());
    }
}
