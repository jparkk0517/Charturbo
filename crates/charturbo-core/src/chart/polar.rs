//! Polar coordinate system (ECharts `polar` with `angleAxis` / `radiusAxis`): bar, line,
//! scatter and heatmap series on one angle axis and one radius axis around the origin.
//!
//! Axes: each is a category axis (`categories > 0`: equal bands, items at band centers) or a
//! value axis (nice ticks over the visible data with 0 included, `min` / `max` overrides).
//! Angles run one full turn from `start_angle` (compass radians, clockwise from 12 o'clock),
//! clockwise or counter-clockwise; radii run from `inner_radius` (a fraction of the rim) out to
//! the rim. Items are `[radius, angle, value]` (the ECharts order); category coordinates are
//! band indices, NaN value coordinates are gaps.
//!
//! Bars stand on the only category axis: on a category angle axis they grow outward (radial
//! bars), on a category radius axis they sweep along the angle (ring bars). Bars of one band
//! share it ECharts-style (`bar_category_gap` of the band free, `bar_gap` of a bar between
//! slots); series with the same `stack` share a slot and stack per sign. Lines and scatter
//! points sit at their coordinates (stacked lines on their stack's running total); lines join
//! their points straight in the plane (Catmull-Rom when smooth) and may fill down to their
//! stack base. Heatmap cells fill category angle x category radius bands, colored through the
//! heatmap colormap / value scale (the colorbar reads it like the cartesian heatmap's).
//!
//! Geometry is kept per item in layout units (angle radians along the axis, world radius): a
//! sector for bars and cells, a point (and an area base) for lines and scatter; drawing maps
//! it through `compass`. A legend toggle re-lays out (axis domains follow the visible series)
//! and tweens from the frame on screen: sectors and points lerp, a hidden series' bars shrink
//! to their base.
//!
//! Hover: the nearest line / scatter point within its symbol + a few px wins, else the topmost
//! sector under the pointer. Item ids: series `s` item `i` = global id `offsets[s] + i`.
//! Labels: one anchor per angle label just outside the rim (`node` = label index) and per
//! radius label beside the radius axis (`node` = `POLAR_RADIUS_LABEL + index`). `flags`: 1 =
//! text starts at the anchor, -1 = ends there, 2 = centered above, 3 = centered below; `h_css`
//! = room for the text (CSS px).

use super::heatmap::{
    colormap_lut, ColormapKind, HeatmapColorbar, HeatmapColormap, HeatmapDomain, ValueScale,
    COLORBAR_TICKS,
};
use super::hierarchy::*;
use super::pie::{arc_segments, polar, tessellate_slice, PieScreen, SliceShape};
use super::*;
use std::collections::HashMap;
use std::f32::consts::{FRAC_PI_2, TAU};

/// Rim radius in world units.
pub(crate) const POLAR_RADIUS: f32 = 50.0;
pub const MAX_POLAR_SERIES: usize = 64;
/// Items over all series.
pub const MAX_POLAR_ITEMS: usize = 200_000;
pub const MAX_POLAR_CATEGORIES: usize = 10_000;
/// Label `node` offset of the radius axis labels.
pub const POLAR_RADIUS_LABEL: u32 = 1 << 16;
const LABEL_OFFSET_PX: f32 = 6.0;
/// Angle axis tick length outside the rim (CSS px).
const TICK_PX: f32 = 4.0;
/// Points hit this far past their symbol (CSS px).
const HIT_SLACK_PX: f32 = 4.0;
/// Curve segments per smoothed line segment.
pub(crate) const SMOOTH_STEPS: usize = 8;
const OUTLINE_PX: f32 = 2.0;
const AREA_ALPHA: f32 = 0.3;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PolarAxis {
    /// Category count (0 = value axis)
    pub categories: usize,
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Target tick intervals of a value axis
    pub split: u32,
    pub labels: bool,
    /// Split circles (radius axis) / spokes (angle axis)
    pub split_lines: bool,
}

impl Default for PolarAxis {
    fn default() -> Self {
        Self {
            categories: 0,
            min: None,
            max: None,
            split: 5,
            labels: true,
            split_lines: true,
        }
    }
}

impl PolarAxis {
    pub fn is_category(&self) -> bool {
        self.categories > 0
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PolarOptions {
    /// Compass angle of the angle axis' zero (radians clockwise from 12 o'clock)
    pub start_angle: f32,
    pub clockwise: bool,
    /// Hole radius as a fraction of the rim
    pub inner_radius: f32,
    pub angle: PolarAxis,
    pub radius: PolarAxis,
    /// Fraction of a category band left between its bar slots and the band edges
    pub bar_category_gap: f32,
    /// Gap between bar slots of a band (fraction of a bar)
    pub bar_gap: f32,
    /// Room reserved for an angle label outside the rim (CSS px)
    pub label_room_px: f32,
    pub label_line_px: f32,
}

impl Default for PolarOptions {
    fn default() -> Self {
        Self {
            start_angle: 0.0,
            clockwise: true,
            inner_radius: 0.0,
            angle: PolarAxis::default(),
            radius: PolarAxis::default(),
            bar_category_gap: 0.2,
            bar_gap: 0.3,
            label_room_px: 56.0,
            label_line_px: 14.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolarSeriesKind {
    Bar,
    Line,
    Scatter,
    Heatmap,
}

impl PolarSeriesKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Bar),
            1 => Some(Self::Line),
            2 => Some(Self::Scatter),
            3 => Some(Self::Heatmap),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct PolarSeries {
    pub kind: PolarSeriesKind,
    /// Stack group (bars / lines; negative = not stacked)
    pub stack: i32,
    /// Bars: rounded ends
    pub round_cap: bool,
    pub smooth: bool,
    /// Lines: fill down to the stack base
    pub area: bool,
    /// Lines: join the last point to the first
    pub closed: bool,
    /// Symbol radius (CSS px; 0 = none)
    pub symbol_px: f32,
    pub line_px: f32,
    /// `[radius, angle, value]` per item (`value`: heatmap cells only)
    pub data: Vec<[f64; 3]>,
}

impl PolarSeries {
    pub fn new(kind: PolarSeriesKind, data: Vec<[f64; 3]>) -> Self {
        Self {
            kind,
            stack: -1,
            round_cap: false,
            smooth: false,
            area: false,
            closed: false,
            symbol_px: match kind {
                PolarSeriesKind::Line => 3.0,
                PolarSeriesKind::Scatter => 5.0,
                _ => 0.0,
            },
            line_px: 2.0,
            data,
        }
    }
}

/// Resolved axis: value domain or category count.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PolarScale {
    pub lo: f64,
    pub hi: f64,
    pub categories: usize,
}

impl PolarScale {
    fn category(n: usize) -> Self {
        Self {
            lo: 0.0,
            hi: n as f64,
            categories: n,
        }
    }

    /// Fraction of the axis at `v` (a category: its band center), clamped to `[0, 1]`.
    fn frac(&self, v: f64) -> f32 {
        if self.categories > 0 {
            ((v + 0.5) / self.categories as f64) as f32
        } else {
            ((v - self.lo) / (self.hi - self.lo)).clamp(0.0, 1.0) as f32
        }
    }
}

/// Item geometry in layout units (angle radians along the axis, world radius).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Geo {
    /// Bar / cell `[a0, a1, r0, r1]`
    pub sector: Option<[f32; 4]>,
    /// Line / scatter point `[a, r]`
    pub point: Option<[f32; 2]>,
    /// Line area base under `point`
    pub base: Option<[f32; 2]>,
}

/// Validates options and series (see the module docs for the data shape).
pub fn validate_polar(opts: &PolarOptions, series: &[PolarSeries]) -> Result<(), String> {
    if series.is_empty() {
        return Err("polar chart needs at least one series".into());
    }
    if series.len() > MAX_POLAR_SERIES {
        return Err(format!(
            "polar chart supports at most {MAX_POLAR_SERIES} series, got {}",
            series.len()
        ));
    }
    let total: usize = series.iter().map(|s| s.data.len()).sum();
    if total > MAX_POLAR_ITEMS {
        return Err(format!(
            "polar chart supports at most {MAX_POLAR_ITEMS} items, got {total}"
        ));
    }
    let axes = [("radius", &opts.radius), ("angle", &opts.angle)];
    for (name, ax) in axes {
        if ax.categories > MAX_POLAR_CATEGORIES {
            return Err(format!(
                "polar {name} axis supports at most {MAX_POLAR_CATEGORIES} categories, got {}",
                ax.categories
            ));
        }
        for v in [ax.min, ax.max].into_iter().flatten() {
            if !v.is_finite() {
                return Err(format!(
                    "polar {name} axis min / max must be finite, got {v}"
                ));
            }
        }
        if let (Some(a), Some(b)) = (ax.min, ax.max) {
            if a >= b {
                return Err(format!(
                    "polar {name} axis min must be below max, got {a} >= {b}"
                ));
            }
        }
    }
    let (ac, rc) = (opts.angle.is_category(), opts.radius.is_category());
    for (s, ser) in series.iter().enumerate() {
        match ser.kind {
            PolarSeriesKind::Bar if ac == rc => {
                return Err(format!(
                    "polar bar series {s} needs exactly one category axis (angle or radius)"
                ))
            }
            PolarSeriesKind::Heatmap if !(ac && rc) => {
                return Err(format!(
                    "polar heatmap series {s} needs category angle and radius axes"
                ))
            }
            _ => {}
        }
        for (i, d) in ser.data.iter().enumerate() {
            for (k, (name, ax)) in axes.iter().enumerate() {
                let v = d[k];
                if ax.is_category() {
                    if !(v.fract() == 0.0 && v >= 0.0 && v < ax.categories as f64) {
                        return Err(format!(
                            "polar series {s} item {i}: {name} category index must be an integer in 0..{}, got {v}",
                            ax.categories
                        ));
                    }
                } else if v.is_infinite() {
                    return Err(format!(
                        "polar series {s} item {i}: {name} value must be finite (NaN = missing), got {v}"
                    ));
                }
            }
            if ser.kind == PolarSeriesKind::Heatmap && d[2].is_infinite() {
                return Err(format!(
                    "polar series {s} item {i}: heatmap value must be finite (NaN = empty), got {}",
                    d[2]
                ));
            }
        }
    }
    Ok(())
}

/// Value axis over `values` (0 included) and its ticks.
fn value_scale(ax: &PolarAxis, values: &[f64]) -> (PolarScale, Vec<f64>) {
    let (mut lo, mut hi) = (0.0f64, 0.0f64);
    for &v in values.iter().filter(|v| v.is_finite()) {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    if let Some(m) = ax.min {
        lo = m;
    }
    if let Some(m) = ax.max {
        hi = m;
    }
    if hi <= lo {
        if ax.max.is_some() && ax.min.is_none() {
            lo = hi - 1.0;
        } else {
            hi = lo + 1.0;
        }
    }
    let step = nice_step(hi - lo, ax.split.max(1));
    if ax.min.is_none() {
        lo = (lo / step).floor() * step;
    }
    if ax.max.is_none() {
        hi = (hi / step).ceil() * step;
    }
    let ticks = ticks_between(lo, hi, step);
    (
        PolarScale {
            lo,
            hi,
            categories: 0,
        },
        ticks,
    )
}

/// Catmull-Rom (or straight) curve through `pts`, `closed` back to the first point.
fn curve(pts: &[(f32, f32)], closed: bool, smooth: bool) -> Vec<(f32, f32)> {
    let n = pts.len();
    let closed = closed && n > 2;
    if n < 2 || !smooth {
        let mut v = pts.to_vec();
        if closed {
            v.push(pts[0]);
        }
        return v;
    }
    let at = |i: isize| -> (f32, f32) {
        if closed {
            pts[i.rem_euclid(n as isize) as usize]
        } else {
            pts[i.clamp(0, n as isize - 1) as usize]
        }
    };
    let segs = if closed { n } else { n - 1 };
    let mut out = Vec::with_capacity(segs * SMOOTH_STEPS + 1);
    for k in 0..segs as isize {
        let (p0, p1, p2, p3) = (at(k - 1), at(k), at(k + 1), at(k + 2));
        for j in 0..SMOOTH_STEPS {
            let t = j as f32 / SMOOTH_STEPS as f32;
            let (t2, t3) = (t * t, t * t * t);
            let cr = |a: f32, b: f32, c: f32, d: f32| {
                0.5 * (2.0 * b
                    + (c - a) * t
                    + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2
                    + (3.0 * b - a - 3.0 * c + d) * t3)
            };
            out.push((cr(p0.0, p1.0, p2.0, p3.0), cr(p0.1, p1.1, p2.1, p3.1)));
        }
    }
    out.push(at(segs as isize));
    out
}

fn push_seg(
    out: &mut Vec<ChartSegmentRaw>,
    a: (f32, f32),
    b: (f32, f32),
    width: f32,
    color: [f32; 4],
) {
    out.push(ChartSegmentRaw {
        p0_width: [a.0, a.1, 0.0, width],
        p1_pad: [b.0, b.1, 0.0, 0.0],
        color,
    });
}

fn push_circle(out: &mut Vec<ChartSegmentRaw>, r: f32, wpp: f32, width: f32, color: [f32; 4]) {
    let n = arc_segments(TAU, r / wpp.max(1e-6)).max(16);
    for i in 0..n {
        let (t0, t1) = (TAU * i as f32 / n as f32, TAU * (i + 1) as f32 / n as f32);
        push_seg(
            out,
            polar((0.0, 0.0), t0, r),
            polar((0.0, 0.0), t1, r),
            width,
            color,
        );
    }
}

fn lerp(a: f32, b: f32, e: f32) -> f32 {
    a + (b - a) * e
}

/// Tween frame between `a` and `b` (indexed by global id): sectors lerp (a missing end is the
/// other end shrunk to its base; `radial` = bars along the radius), points appear with `b`.
fn lerp_geo(a: &[Geo], b: &[Geo], e: f32, radial: bool) -> Vec<Geo> {
    let collapse = |s: [f32; 4]| {
        if radial {
            [s[0], s[1], s[2], s[2]]
        } else {
            [s[0], s[0], s[2], s[3]]
        }
    };
    let l4 =
        |p: [f32; 4], q: [f32; 4]| -> [f32; 4] { std::array::from_fn(|i| lerp(p[i], q[i], e)) };
    let l2 = |p: Option<[f32; 2]>, q: Option<[f32; 2]>| match (p, q) {
        (Some(p), Some(q)) => Some([lerp(p[0], q[0], e), lerp(p[1], q[1], e)]),
        (_, q) => q,
    };
    a.iter()
        .zip(b)
        .map(|(p, q)| Geo {
            sector: match (p.sector, q.sector) {
                (Some(s), Some(t)) => Some(l4(s, t)),
                (Some(s), None) => Some(l4(s, collapse(s))),
                (None, Some(t)) => Some(l4(collapse(t), t)),
                (None, None) => None,
            },
            point: l2(p.point, q.point),
            base: l2(p.base, q.base),
        })
        .collect()
}

#[derive(Debug, Clone)]
pub(crate) struct PolarChart {
    pub(crate) opts: PolarOptions,
    pub(crate) series: Vec<PolarSeries>,
    /// Global id of each series' first item (`len + 1` entries)
    pub(crate) offsets: Vec<usize>,
    style: HierarchyStyle,
    pub(crate) colors: Vec<[f32; 4]>,
    pub(crate) shown: Vec<bool>,
    emphasis: Option<usize>,
    pub(crate) angle: PolarScale,
    pub(crate) radius: PolarScale,
    /// Spoke / circle positions (axis fractions)
    angle_grid: Vec<f32>,
    radius_grid: Vec<f32>,
    /// Label values (category index or tick value) and their axis fractions
    pub(crate) angle_labels: Vec<f64>,
    angle_label_at: Vec<f32>,
    pub(crate) radius_labels: Vec<f64>,
    radius_label_at: Vec<f32>,
    /// Staged geometry and hover value per global id
    pub(crate) geo: Vec<Geo>,
    values: Vec<f64>,
    /// Layout revision (bumps on every relayout)
    rev: u32,
    pub(crate) screen: Option<PieScreen>,
    /// Scale, emphasis and revision the staged buffers were built for
    built: Option<(f32, Option<usize>, u32)>,
    outlined: Option<(Option<(u32, u32)>, f32, u32)>,
    /// Frame on screen mid-tween
    pub(crate) drawn: Option<Vec<Geo>>,
    /// Legend toggle: the frame to tween from (dropped once the animation lands)
    pub(crate) tween_from: Option<Vec<Geo>>,
    pub(crate) labels: Vec<HierarchyLabel>,
    pub(crate) labels_revision: u32,
    labels_key: Option<([f32; 19], u32)>,
    colormap: HeatmapColormap,
    domain: HeatmapDomain,
    lut: Vec<[u8; 4]>,
    scale: ValueScale,
    data_range: (f64, f64),
}

impl PolarChart {
    /// `series` must pass `validate_polar`.
    pub(crate) fn new(
        mut opts: PolarOptions,
        mut series: Vec<PolarSeries>,
        style: HierarchyStyle,
    ) -> Self {
        let d = PolarOptions::default();
        let fin = |v: f32, lo: f32, hi: f32, dflt: f32| {
            if v.is_finite() {
                v.clamp(lo, hi)
            } else {
                dflt
            }
        };
        opts.start_angle = if opts.start_angle.is_finite() {
            opts.start_angle
        } else {
            0.0
        };
        opts.inner_radius = fin(opts.inner_radius, 0.0, 0.9, 0.0);
        opts.bar_category_gap = fin(opts.bar_category_gap, 0.0, 0.95, d.bar_category_gap);
        opts.bar_gap = fin(opts.bar_gap, -1.0, 10.0, d.bar_gap);
        opts.label_room_px = fin(opts.label_room_px, 0.0, 400.0, d.label_room_px);
        opts.label_line_px = fin(opts.label_line_px, 1.0, 100.0, d.label_line_px);
        for ax in [&mut opts.angle, &mut opts.radius] {
            if ax.split == 0 {
                ax.split = 5;
            }
        }
        for s in &mut series {
            let dflt = PolarSeries::new(s.kind, Vec::new());
            s.symbol_px = fin(s.symbol_px, 0.0, 100.0, dflt.symbol_px);
            s.line_px = fin(s.line_px, 0.0, 100.0, dflt.line_px);
        }
        let mut offsets = vec![0usize];
        for s in &series {
            offsets.push(offsets.last().unwrap() + s.data.len());
        }
        let (colormap, domain) = (HeatmapColormap::default(), HeatmapDomain::default());
        let n = series.len();
        let mut c = Self {
            opts,
            series,
            offsets,
            style,
            colors: Vec::new(),
            shown: vec![true; n],
            emphasis: None,
            angle: PolarScale::category(1),
            radius: PolarScale::category(1),
            angle_grid: Vec::new(),
            radius_grid: Vec::new(),
            angle_labels: Vec::new(),
            angle_label_at: Vec::new(),
            radius_labels: Vec::new(),
            radius_label_at: Vec::new(),
            geo: Vec::new(),
            values: Vec::new(),
            rev: 0,
            screen: None,
            built: None,
            outlined: None,
            drawn: None,
            tween_from: None,
            labels: Vec::new(),
            labels_revision: 0,
            labels_key: None,
            lut: colormap_lut(&colormap),
            colormap,
            domain,
            scale: ValueScale::resolve((0.0, 1.0), &domain, false),
            data_range: (0.0, 1.0),
        };
        c.assign_colors();
        c.relayout();
        c
    }

    fn assign_colors(&mut self) {
        let pal = &self.style.palette;
        self.colors = (0..self.series.len())
            .map(|i| {
                let auto = if pal.is_empty() {
                    self.style.other_color
                } else {
                    pal[i % pal.len()]
                };
                self.style.colors.get(i).copied().flatten().unwrap_or(auto)
            })
            .collect();
        self.built = None;
    }

    pub(crate) fn set_style(&mut self, style: HierarchyStyle) {
        self.style = style;
        self.assign_colors();
        self.outlined = None;
    }

    pub(crate) fn set_emphasis(&mut self, series: Option<usize>) -> bool {
        let series = series.filter(|&s| s < self.series.len() && self.shown[s]);
        let changed = self.emphasis != series;
        if changed {
            self.emphasis = series;
            self.built = None;
        }
        changed
    }

    /// Legend toggle: re-lays out without the hidden series and keeps the frame on screen to
    /// tween from. Returns false when unchanged.
    pub(crate) fn set_visible(&mut self, series: usize, visible: bool) -> bool {
        if series >= self.series.len() || self.shown[series] == visible {
            return false;
        }
        let from = self.drawn.take().unwrap_or_else(|| self.geo.clone());
        self.shown[series] = visible;
        if !visible && self.emphasis == Some(series) {
            self.emphasis = None;
        }
        self.relayout();
        self.tween_from = Some(from);
        true
    }

    /// Value axis of bars and stacks: 0 = radius, 1 = angle (`None`: no single category axis).
    fn stack_axis(&self) -> Option<usize> {
        match (
            self.opts.angle.is_category(),
            self.opts.radius.is_category(),
        ) {
            (true, false) => Some(0),
            (false, true) => Some(1),
            _ => None,
        }
    }

    /// Bars grow along the radius (category angle axis).
    fn radial(&self) -> bool {
        self.stack_axis() != Some(1)
    }

    fn r0(&self) -> f32 {
        self.opts.inner_radius * POLAR_RADIUS
    }

    /// World radius at radius axis fraction `f`.
    fn rad(&self, f: f32) -> f32 {
        let r0 = self.r0();
        r0 + f * (POLAR_RADIUS - r0)
    }

    /// Layout angle of an angle axis value (a category: its band center).
    pub(crate) fn angle_of(&self, v: f64) -> f32 {
        self.angle.frac(v) * TAU
    }

    /// World radius of a radius axis value (a category: its band center).
    pub(crate) fn radius_of(&self, v: f64) -> f32 {
        self.rad(self.radius.frac(v))
    }

    /// Compass angle of a layout angle.
    pub(crate) fn compass(&self, a: f32) -> f32 {
        if self.opts.clockwise {
            self.opts.start_angle + a
        } else {
            self.opts.start_angle - a
        }
    }

    /// Layout angle in `[0, tau)` of a compass angle.
    fn layout_angle(&self, phi: f32) -> f32 {
        let d = phi - self.opts.start_angle;
        (if self.opts.clockwise { d } else { -d }).rem_euclid(TAU)
    }

    fn xy(&self, p: [f32; 2]) -> (f32, f32) {
        polar((0.0, 0.0), self.compass(p[0]), p[1])
    }

    fn relayout(&mut self) {
        let k = self.stack_axis();
        let total = *self.offsets.last().unwrap_or(&0);
        // Data extent per item: [radius lo, radius hi, angle lo, angle hi] (lo = stack base)
        let mut ext: Vec<Option<[f64; 4]>> = vec![None; total];
        let mut values = vec![f64::NAN; total];
        let mut acc: HashMap<(i64, usize, bool), f64> = HashMap::new();
        let (mut heat_lo, mut heat_hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for (s, ser) in self.series.iter().enumerate() {
            if !self.shown[s] {
                continue;
            }
            let key = if ser.stack >= 0 {
                ser.stack as i64
            } else {
                -(s as i64) - 1
            };
            for (i, d) in ser.data.iter().enumerate() {
                let g = self.offsets[s] + i;
                match (ser.kind, k) {
                    (PolarSeriesKind::Heatmap, _) => {
                        if d[2].is_finite() {
                            ext[g] = Some([d[0], d[0], d[1], d[1]]);
                            values[g] = d[2];
                            heat_lo = heat_lo.min(d[2]);
                            heat_hi = heat_hi.max(d[2]);
                        }
                    }
                    (PolarSeriesKind::Bar | PolarSeriesKind::Line, Some(k)) => {
                        let (v, c) = (d[k], d[1 - k]);
                        if !v.is_finite() {
                            continue;
                        }
                        let slot = acc.entry((key, c as usize, v < 0.0)).or_insert(0.0);
                        let base = *slot;
                        *slot += v;
                        let mut e = [c; 4];
                        e[2 * k] = base;
                        e[2 * k + 1] = base + v;
                        ext[g] = Some(e);
                        values[g] = v;
                    }
                    _ => {
                        if d[0].is_finite() && d[1].is_finite() {
                            ext[g] = Some([d[0], d[0], d[1], d[1]]);
                            values[g] = k.map_or(d[0], |k| d[k]);
                        }
                    }
                }
            }
        }
        // Axis scales over the visible items (heatmap cells only span categories)
        let heat = |s: usize| self.series[s].kind == PolarSeriesKind::Heatmap;
        let axis_values = |j: usize| -> Vec<f64> {
            let mut out = Vec::new();
            for s in 0..self.series.len() {
                if heat(s) {
                    continue;
                }
                for e in ext[self.offsets[s]..self.offsets[s + 1]].iter().flatten() {
                    out.extend([e[2 * j], e[2 * j + 1]]);
                }
            }
            out
        };
        let (rv, av) = (axis_values(0), axis_values(1));
        let resolve =
            |ax: &PolarAxis, vals: &[f64]| -> (PolarScale, Vec<f32>, Vec<f64>, Vec<f32>) {
                if ax.is_category() {
                    let n = ax.categories;
                    let grid = (0..=n).map(|i| i as f32 / n as f32).collect();
                    let labels = (0..n).map(|i| i as f64).collect();
                    let at = (0..n).map(|i| (i as f32 + 0.5) / n as f32).collect();
                    (PolarScale::category(n), grid, labels, at)
                } else {
                    let (scale, ticks) = value_scale(ax, vals);
                    let at: Vec<f32> = ticks.iter().map(|&t| scale.frac(t)).collect();
                    (scale, at.clone(), ticks, at)
                }
            };
        let (rs, rg, rl, rla) = resolve(&self.opts.radius, &rv);
        let (as_, ag, mut al, mut ala) = resolve(&self.opts.angle, &av);
        // A full turn: a last value tick on (or within half a step of) the first one is dropped
        if !self.opts.angle.is_category() && ala.len() > 1 && ala[0] <= 1e-6 {
            let gap = if ala.len() > 2 { ala[1] - ala[0] } else { 0.0 };
            if 1.0 - *ala.last().unwrap() < 0.5 * gap + 1e-6 {
                al.pop();
                ala.pop();
            }
        }
        self.radius = rs;
        self.angle = as_;
        self.radius_grid = rg;
        self.angle_grid = ag;
        self.radius_labels = rl;
        self.radius_label_at = rla;
        self.angle_labels = al;
        self.angle_label_at = ala;

        // Bar slots: one per stack (or unstacked series) among the visible bar series
        let mut slot_keys: Vec<i64> = Vec::new();
        let mut slot_of = vec![0usize; self.series.len()];
        for (s, ser) in self.series.iter().enumerate() {
            if ser.kind != PolarSeriesKind::Bar || !self.shown[s] {
                continue;
            }
            let key = if ser.stack >= 0 {
                ser.stack as i64
            } else {
                -(s as i64) - 1
            };
            slot_of[s] = slot_keys.iter().position(|&x| x == key).unwrap_or_else(|| {
                slot_keys.push(key);
                slot_keys.len() - 1
            });
        }
        let slots = slot_keys.len().max(1) as f32;
        let (gap, bar_gap) = (self.opts.bar_category_gap, self.opts.bar_gap);
        let mut geo = vec![Geo::default(); total];
        for (s, ser) in self.series.iter().enumerate() {
            for g in self.offsets[s]..self.offsets[s + 1] {
                let Some(e) = ext[g] else {
                    continue;
                };
                geo[g] = match (ser.kind, k) {
                    (PolarSeriesKind::Heatmap, _) => {
                        let (na, nr) =
                            (self.angle.categories as f32, self.radius.categories as f32);
                        let (ca, cr) = (e[2] as f32, e[0] as f32);
                        Geo {
                            sector: Some([
                                ca / na * TAU,
                                (ca + 1.0) / na * TAU,
                                self.rad(cr / nr),
                                self.rad((cr + 1.0) / nr),
                            ]),
                            ..Default::default()
                        }
                    }
                    (PolarSeriesKind::Bar, Some(k)) => {
                        let (cat, val) = if k == 0 {
                            (&self.angle, &self.radius)
                        } else {
                            (&self.radius, &self.angle)
                        };
                        let band = 1.0 / cat.categories as f32;
                        let c = e[2 * (1 - k)] as f32;
                        let w = band * (1.0 - gap) / (slots + (slots - 1.0) * bar_gap);
                        let lo =
                            c * band + 0.5 * band * gap + slot_of[s] as f32 * w * (1.0 + bar_gap);
                        let (v0, v1) = (val.frac(e[2 * k]), val.frac(e[2 * k + 1]));
                        let (v0, v1) = (v0.min(v1), v0.max(v1));
                        Geo {
                            sector: Some(if k == 0 {
                                [lo * TAU, (lo + w) * TAU, self.rad(v0), self.rad(v1)]
                            } else {
                                [v0 * TAU, v1 * TAU, self.rad(lo), self.rad(lo + w)]
                            }),
                            ..Default::default()
                        }
                    }
                    _ => {
                        let point = [self.angle_of(e[3]), self.radius_of(e[1])];
                        let base = match k {
                            Some(0) => [point[0], self.radius_of(e[0])],
                            Some(_) => [self.angle_of(e[2]), point[1]],
                            None => [point[0], self.r0()],
                        };
                        Geo {
                            sector: None,
                            point: Some(point),
                            base: (ser.kind == PolarSeriesKind::Line).then_some(base),
                        }
                    }
                };
            }
        }
        self.geo = geo;
        self.values = values;
        self.data_range = if heat_lo.is_finite() {
            (heat_lo, heat_hi)
        } else {
            (0.0, 1.0)
        };
        self.resolve_scale();
        self.rev = self.rev.wrapping_add(1);
        self.built = None;
        self.outlined = None;
    }

    fn has_heatmap(&self) -> bool {
        self.series
            .iter()
            .any(|s| s.kind == PolarSeriesKind::Heatmap)
    }

    pub(crate) fn set_colormap(&mut self, map: HeatmapColormap) {
        self.lut = colormap_lut(&map);
        self.colormap = map;
        self.resolve_scale();
        self.built = None;
    }

    /// Returns true when the scale changed.
    pub(crate) fn set_domain(&mut self, domain: HeatmapDomain) -> bool {
        self.domain = domain;
        let changed = self.resolve_scale();
        if changed {
            self.built = None;
        }
        changed
    }

    fn resolve_scale(&mut self) -> bool {
        let diverging = self.colormap.kind == ColormapKind::Diverging;
        let scale = ValueScale::resolve(self.data_range, &self.domain, diverging);
        std::mem::replace(&mut self.scale, scale) != scale
    }

    pub(crate) fn lut(&self) -> Option<&[[u8; 4]]> {
        self.has_heatmap().then_some(self.lut.as_slice())
    }

    pub(crate) fn colorbar(&self) -> Option<HeatmapColorbar> {
        if !self.has_heatmap() {
            return None;
        }
        let (lo, hi) = (self.scale.lo as f64, self.scale.hi as f64);
        let ticks = ticks_between(lo, hi, nice_step(hi - lo, COLORBAR_TICKS))
            .into_iter()
            .filter_map(|v| self.scale.normalize(v as f32).map(|t| (v, t)))
            .collect();
        Some(HeatmapColorbar {
            scale: self.scale,
            ticks,
        })
    }

    /// Displayed color of a heatmap value (the empty color for NaN).
    pub(crate) fn color_of(&self, v: f32) -> Option<[u8; 4]> {
        if !self.has_heatmap() {
            return None;
        }
        Some(match self.scale.normalize(v) {
            Some(t) => self.lut[ValueScale::lut_index(t)],
            None => self
                .colormap
                .empty
                .map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8),
        })
    }

    fn fill_color(&self, v: f32) -> [f32; 4] {
        match self.scale.normalize(v) {
            Some(t) => self.lut[ValueScale::lut_index(t)].map(|c| c as f32 / 255.0),
            None => self.colormap.empty,
        }
    }

    /// `color` of series `s`, faded when another series is emphasized.
    fn tint(&self, s: usize, color: [f32; 4]) -> [f32; 4] {
        match self.emphasis {
            Some(e) if e != s => mix(color, self.style.surface, EMPHASIS_FADE),
            _ => color,
        }
    }

    fn sector(
        &self,
        s: [f32; 4],
        corner: f32,
        wpp: f32,
        color: [f32; 4],
        fills: &mut Vec<ChartFillRaw>,
        edges: &mut Vec<ChartSegmentRaw>,
    ) {
        if !(s[1] > s[0] && s[3] > s[2]) {
            return;
        }
        let (p, q) = (self.compass(s[0]), self.compass(s[1]));
        let shape = SliceShape {
            lo: p.min(q),
            hi: p.max(q),
            r_out: s[3],
            r_in: s[2],
            full: s[1] - s[0] >= TAU - 1e-5,
            corner,
        };
        tessellate_slice(&shape, wpp, (0.0, 0.0), color, fills, edges);
    }

    /// Runs of consecutive drawn points of `range` (a gap splits a line).
    fn runs(&self, geo: &[Geo], range: std::ops::Range<usize>) -> Vec<Vec<usize>> {
        let mut runs: Vec<Vec<usize>> = Vec::new();
        let mut cur: Vec<usize> = Vec::new();
        for g in range {
            if geo[g].point.is_some() {
                cur.push(g);
            } else if !cur.is_empty() {
                runs.push(std::mem::take(&mut cur));
            }
        }
        if !cur.is_empty() {
            runs.push(cur);
        }
        runs
    }

    /// Fills (cells, bars, areas in series order), strokes (sector outlines, then lines) and
    /// symbols of `geo` at `wpp`.
    fn build(
        &self,
        geo: &[Geo],
        wpp: f32,
        fills: &mut Vec<ChartFillRaw>,
        edges: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        fills.clear();
        edges.clear();
        markers.clear();
        let mut lines: Vec<ChartSegmentRaw> = Vec::new();
        for (s, ser) in self.series.iter().enumerate() {
            let range = self.offsets[s]..self.offsets[s + 1];
            let color = self.tint(s, self.colors[s]);
            match ser.kind {
                PolarSeriesKind::Heatmap => {
                    for g in range {
                        if let Some(sec) = geo[g].sector {
                            let c = self.tint(s, self.fill_color(self.values[g] as f32));
                            self.sector(sec, 0.0, wpp, c, fills, edges);
                        }
                    }
                }
                PolarSeriesKind::Bar => {
                    for g in range {
                        if let Some(sec) = geo[g].sector {
                            let corner = if ser.round_cap {
                                0.5 * ((sec[1] - sec[0]) * sec[3]).min(sec[3] - sec[2])
                            } else {
                                0.0
                            };
                            self.sector(sec, corner, wpp, color, fills, edges);
                        }
                    }
                }
                PolarSeriesKind::Line => {
                    let runs = self.runs(geo, range.clone());
                    let closed = ser.closed && runs.len() == 1 && runs[0].len() == range.len();
                    for run in &runs {
                        let top: Vec<(f32, f32)> = run
                            .iter()
                            .map(|&g| self.xy(geo[g].point.unwrap()))
                            .collect();
                        let top = curve(&top, closed, ser.smooth);
                        if ser.area {
                            let bot: Vec<(f32, f32)> = run
                                .iter()
                                .map(|&g| self.xy(geo[g].base.or(geo[g].point).unwrap()))
                                .collect();
                            let bot = curve(&bot, closed, ser.smooth);
                            let fill = [color[0], color[1], color[2], color[3] * AREA_ALPHA];
                            let v = |p: (f32, f32)| ChartFillRaw {
                                position: [p.0, p.1, 0.0, 0.0],
                                color: fill,
                            };
                            for k in 0..top.len().min(bot.len()).saturating_sub(1) {
                                fills.extend([
                                    v(top[k]),
                                    v(bot[k]),
                                    v(top[k + 1]),
                                    v(top[k + 1]),
                                    v(bot[k]),
                                    v(bot[k + 1]),
                                ]);
                            }
                        }
                        for w in top.windows(2) {
                            push_seg(&mut lines, w[0], w[1], ser.line_px, color);
                        }
                    }
                    if ser.symbol_px > 0.0 {
                        for g in range {
                            if let Some(p) = geo[g].point {
                                let (x, y) = self.xy(p);
                                markers.push(ChartMarkerRaw {
                                    center_radius: [x, y, 0.0, ser.symbol_px],
                                    fill: self.style.surface,
                                    ring: color,
                                    params: [1.5, 0.0, 0.0, 0.0],
                                });
                            }
                        }
                    }
                }
                PolarSeriesKind::Scatter => {
                    for g in range {
                        if let Some(p) = geo[g].point {
                            let (x, y) = self.xy(p);
                            markers.push(ChartMarkerRaw {
                                center_radius: [x, y, 0.0, ser.symbol_px.max(1.0)],
                                fill: color,
                                ring: color,
                                params: [0.0, 0.0, 0.0, 0.0],
                            });
                        }
                    }
                }
            }
        }
        edges.extend(lines);
    }

    /// Hover outline of a sector or an enlarged symbol.
    fn build_overlay(
        &self,
        hovered: Option<(u32, u32)>,
        wpp: f32,
        overlay: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        overlay.clear();
        markers.clear();
        let Some((s, i)) = hovered else {
            return;
        };
        let s = s as usize;
        let Some(g) = self.global(s, i).and_then(|g| self.geo.get(g)) else {
            return;
        };
        let color = self.style.highlight;
        if let Some(sec) = g.sector {
            let n = arc_segments(sec[1] - sec[0], sec[3] / wpp.max(1e-6)).max(1);
            let arc = |r: f32| -> Vec<(f32, f32)> {
                (0..=n)
                    .map(|k| self.xy([sec[0] + (sec[1] - sec[0]) * k as f32 / n as f32, r]))
                    .collect()
            };
            let (outer, inner) = (arc(sec[3]), arc(sec[2]));
            for w in outer.windows(2) {
                push_seg(overlay, w[0], w[1], OUTLINE_PX, color);
            }
            if sec[2] > 1e-4 {
                for w in inner.windows(2) {
                    push_seg(overlay, w[0], w[1], OUTLINE_PX, color);
                }
            }
            if sec[1] - sec[0] < TAU - 1e-5 {
                push_seg(overlay, inner[0], outer[0], OUTLINE_PX, color);
                push_seg(overlay, inner[n], outer[n], OUTLINE_PX, color);
            }
        } else if let Some(p) = g.point {
            let (x, y) = self.xy(p);
            let ser = &self.series[s];
            markers.push(ChartMarkerRaw {
                center_radius: [x, y, 0.0, ser.symbol_px.max(3.0) + 2.0],
                fill: self.colors[s],
                ring: self.style.surface,
                params: [2.0, 0.0, 0.0, 0.0],
            });
        }
    }

    /// Global id of item `(series, index)`.
    fn global(&self, s: usize, i: u32) -> Option<usize> {
        let g = self.offsets.get(s)? + i as usize;
        (s < self.series.len() && g < self.offsets[s + 1]).then_some(g)
    }

    /// Item `(series, index)` under world point `(x, y)`.
    fn item_at(&self, x: f32, y: f32, wpp: f32) -> Option<(u32, u32)> {
        let mut best: Option<(f32, usize, usize)> = None;
        for (s, ser) in self.series.iter().enumerate() {
            if !self.shown[s]
                || !matches!(ser.kind, PolarSeriesKind::Line | PolarSeriesKind::Scatter)
            {
                continue;
            }
            let reach = (ser.symbol_px.max(2.0) + HIT_SLACK_PX) * wpp;
            for g in self.offsets[s]..self.offsets[s + 1] {
                if let Some(p) = self.geo[g].point {
                    let (px, py) = self.xy(p);
                    let d = (px - x).hypot(py - y);
                    if d <= reach && best.map_or(true, |b| d < b.0) {
                        best = Some((d, s, g - self.offsets[s]));
                    }
                }
            }
        }
        if let Some((_, s, i)) = best {
            return Some((s as u32, i as u32));
        }
        let r = x.hypot(y);
        if r > POLAR_RADIUS + 1e-4 {
            return None;
        }
        let a = self.layout_angle(x.atan2(y));
        for (s, ser) in self.series.iter().enumerate().rev() {
            if !self.shown[s]
                || !matches!(ser.kind, PolarSeriesKind::Bar | PolarSeriesKind::Heatmap)
            {
                continue;
            }
            for g in (self.offsets[s]..self.offsets[s + 1]).rev() {
                if let Some(sec) = self.geo[g].sector {
                    let inside = |a: f32| a >= sec[0] && a <= sec[1];
                    if r >= sec[2] && r <= sec[3] && (inside(a) || inside(a + TAU)) {
                        return Some((s as u32, (g - self.offsets[s]) as u32));
                    }
                }
            }
        }
        None
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let p = ray_hit_z_plane(&view.camera.screen_to_ray(ndc.0, ndc.1), 0.0)?;
        let wpp = screen_of(view)?.wpp;
        let (series, index) = self.item_at(p.x, p.y, wpp)?;
        let (value, id) = self.item(series, index)?;
        Some(hover_one(series, index, value, id))
    }

    /// Value and global id of item `(series, index)` (hidden / missing items: none).
    pub(crate) fn item(&self, series: u32, index: u32) -> Option<(f64, u32)> {
        let s = series as usize;
        let g = self.global(s, index)?;
        let geo = self.geo[g];
        (self.shown[s] && (geo.sector.is_some() || geo.point.is_some()))
            .then_some((self.values[g], g as u32))
    }

    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let g = global_id as usize;
        if g >= self.geo.len() {
            return None;
        }
        let s = self.offsets.partition_point(|&o| o <= g) - 1;
        let i = (g - self.offsets[s]) as u32;
        let (value, _) = self.item(s as u32, i)?;
        let geo = self.geo[g];
        let at = match (geo.sector, geo.point) {
            (Some(sec), _) => [0.5 * (sec[0] + sec[1]), 0.5 * (sec[2] + sec[3])],
            (None, Some(p)) => p,
            _ => return None,
        };
        let (x, y) = self.xy(at);
        Some((s as u32, i, value as f32, Vec3::new(x, y, 0.0)))
    }

    pub(crate) fn series_visible(&self, series: usize) -> bool {
        self.shown.get(series).copied().unwrap_or(false)
    }

    pub(crate) fn point_count(&self) -> usize {
        self.geo.len()
    }

    /// Split circles / spokes (with the grid on), the rim, hole and radius axis lines and the
    /// angle ticks.
    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        let Some(screen) = self.screen else {
            return;
        };
        let (wpp, w, r0) = (screen.wpp, style.stroke_px, self.r0());
        let spokes: Vec<f32> = self
            .angle_grid
            .iter()
            .copied()
            .filter(|&f| f < 1.0 - 1e-6)
            .collect();
        if style.show_grid {
            if self.opts.radius.split_lines {
                for &f in &self.radius_grid {
                    let r = self.rad(f);
                    if r > r0 + 1e-3 && r < POLAR_RADIUS - 1e-3 {
                        push_circle(out, r, wpp, w, style.grid_color);
                    }
                }
            }
            if self.opts.angle.split_lines {
                for &f in &spokes {
                    let phi = self.compass(f * TAU);
                    push_seg(
                        out,
                        polar((0.0, 0.0), phi, r0),
                        polar((0.0, 0.0), phi, POLAR_RADIUS),
                        w,
                        style.grid_color,
                    );
                }
            }
        }
        push_circle(out, POLAR_RADIUS, wpp, w, style.baseline_color);
        if r0 > 0.0 {
            push_circle(out, r0, wpp, w, style.baseline_color);
        }
        let phi0 = self.compass(0.0);
        push_seg(
            out,
            polar((0.0, 0.0), phi0, r0),
            polar((0.0, 0.0), phi0, POLAR_RADIUS),
            w,
            style.baseline_color,
        );
        for &f in &spokes {
            let phi = self.compass(f * TAU);
            let (a, b) = (
                polar((0.0, 0.0), phi, POLAR_RADIUS),
                polar((0.0, 0.0), phi, POLAR_RADIUS + TICK_PX * wpp),
            );
            push_seg(out, a, b, w, style.baseline_color);
        }
    }

    fn layout_labels(&mut self, screen: PieScreen) -> bool {
        let mut labels: Vec<HierarchyLabel> = Vec::new();
        let (cx, cy) = screen.center_css;
        let line = self.opts.label_line_px;
        let flags = |phi: f32| {
            let (s, c) = phi.sin_cos();
            if s.abs() < 0.2 {
                if c > 0.0 {
                    2
                } else {
                    3
                }
            } else if s > 0.0 {
                1
            } else {
                -1
            }
        };
        // Every `step`-th label where neighbours would crowd
        let thin = |n: usize, spacing: f32| -> usize {
            if n < 2 || spacing <= 0.0 {
                1
            } else {
                ((line / spacing).ceil() as usize).max(1)
            }
        };
        if self.opts.angle.labels {
            let r = screen.r_css + TICK_PX + LABEL_OFFSET_PX;
            let n = self.angle_label_at.len();
            let step = thin(n, TAU * screen.r_css / n.max(1) as f32);
            for (j, &f) in self.angle_label_at.iter().enumerate().step_by(step) {
                let phi = self.compass(f * TAU);
                labels.push(HierarchyLabel {
                    node: j as u32,
                    x_css: cx + r * phi.sin(),
                    y_css: cy - r * phi.cos(),
                    w_css: 0.0,
                    h_css: self.opts.label_room_px,
                    flags: flags(phi),
                });
            }
        }
        if self.opts.radius.labels {
            let phi0 = self.compass(0.0);
            let perp = if self.opts.clockwise {
                phi0 - FRAC_PI_2
            } else {
                phi0 + FRAC_PI_2
            };
            let n = self.radius_label_at.len();
            let span = (POLAR_RADIUS - self.r0()) / screen.wpp;
            let step = thin(n, span / (n.max(2) - 1) as f32);
            for (j, &f) in self.radius_label_at.iter().enumerate().step_by(step) {
                let r = self.rad(f) / screen.wpp;
                labels.push(HierarchyLabel {
                    node: POLAR_RADIUS_LABEL + j as u32,
                    x_css: cx + r * phi0.sin() + 4.0 * perp.sin(),
                    y_css: cy - r * phi0.cos() - 4.0 * perp.cos(),
                    w_css: 0.0,
                    h_css: self.opts.label_room_px,
                    flags: flags(perp),
                });
            }
        }
        let changed = labels != self.labels;
        if changed {
            self.labels = labels;
            self.labels_revision = self.labels_revision.wrapping_add(1);
        }
        changed
    }

    pub(crate) fn layout_info(&self) -> HierarchyLayoutInfo {
        let (c, r) = self
            .screen
            .map_or(((0.0, 0.0), 0.0), |s| (s.center_css, s.r_css));
        HierarchyLayoutInfo {
            root: 0,
            plot_css: [c.0 - r, c.1 - r, 2.0 * r, 2.0 * r],
            center_css: c,
            center_r_css: r,
            hovered: None,
        }
    }

    pub(crate) fn plot_css(&self, view: &ChartView) -> [f32; 4] {
        match screen_of(view) {
            Some(s) => [
                s.center_css.0 - s.r_css,
                s.center_css.1 - s.r_css,
                2.0 * s.r_css,
                2.0 * s.r_css,
            ],
            None => [0.0; 4],
        }
    }

    pub(crate) fn frame_camera(
        &self,
        camera: &mut OrbitCamera,
        css: (f32, f32),
        padding: &ChartPadding,
    ) {
        let m = 4.0 + TICK_PX;
        let (rx, ry) = if self.opts.angle.labels {
            (
                self.opts.label_room_px + LABEL_OFFSET_PX,
                self.opts.label_line_px + LABEL_OFFSET_PX,
            )
        } else {
            (0.0, 0.0)
        };
        let pad = [
            padding[0] + m + ry,
            padding[1] + m + rx,
            padding[2] + m + ry,
            padding[3] + m + rx,
        ];
        frame_flat(camera, css, 2.0 * POLAR_RADIUS, 2.0 * POLAR_RADIUS, &pad);
    }

    /// Builds the tween frame at `e` into the animator's buffers (at the staged scale).
    pub(crate) fn tween_build(
        &mut self,
        e: f32,
        fills: &mut Vec<ChartFillRaw>,
        edges: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) -> bool {
        let (Some(from), Some((wpp, _, _))) = (&self.tween_from, self.built) else {
            return false;
        };
        let e = if e.is_finite() {
            e.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let frame = lerp_geo(from, &self.geo, e, self.radial());
        self.build(&frame, wpp, fills, edges, markers);
        self.drawn = Some(frame);
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        view: &ChartView,
        hovered: Option<(u32, u32)>,
        force: bool,
        overlay_dirty: bool,
        animating: bool,
        out: HierFrame,
    ) -> HierChanged {
        let mut changed = HierChanged::default();
        let Some(screen) = screen_of(view) else {
            return changed;
        };
        self.screen = Some(screen);
        if !animating {
            self.tween_from = None;
            self.drawn = None;
        }
        let stale = match self.built {
            Some((wpp, e, rev)) => {
                e != self.emphasis
                    || rev != self.rev
                    || ((wpp - screen.wpp) / screen.wpp).abs() > 1e-4
            }
            None => true,
        };
        if stale || force {
            self.build(&self.geo, screen.wpp, out.fills, out.edges, out.markers);
            changed.underlay = stale;
            self.built = Some((screen.wpp, self.emphasis, self.rev));
            changed.fills = true;
        }
        let okey = (hovered, screen.wpp, self.rev);
        if overlay_dirty || self.outlined != Some(okey) {
            self.build_overlay(hovered, screen.wpp, out.overlay, out.overlay_markers);
            self.outlined = Some(okey);
            changed.overlay = true;
        }
        let lkey = (view.key(), self.rev);
        if self.labels_key != Some(lkey) {
            changed.overlay |= self.layout_labels(screen);
            self.labels_key = Some(lkey);
        }
        changed
    }
}

/// Center / radius of the rim on screen (same mapping as the pie).
fn screen_of(view: &ChartView) -> Option<PieScreen> {
    let c = view.project_css(Vec3::ZERO)?;
    let e = view.project_css(Vec3::new(POLAR_RADIUS, 0.0, 0.0))?;
    let r = (e.0 - c.0).hypot(e.1 - c.1);
    (r > 1e-3).then_some(PieScreen {
        center_css: c,
        r_css: r,
        wpp: POLAR_RADIUS / r,
    })
}

impl ChartState {
    /// Creates a polar chart (see `validate_polar`).
    pub fn new_polar(
        opts: PolarOptions,
        series: Vec<PolarSeries>,
        style: HierarchyStyle,
    ) -> Result<Self, String> {
        validate_polar(&opts, &series)?;
        Ok(Self::with_kind(ChartKind::Hierarchy(HierChart::Polar(
            PolarChart::new(opts, series, style),
        ))))
    }

    /// Angle and radius axis label values of a polar chart (category index or tick value, in
    /// label `node` order) and the resolved axis scales.
    pub fn polar_axes(&self) -> Option<(&[f64], &[f64], PolarScale, PolarScale)> {
        match &self.kind {
            ChartKind::Hierarchy(HierChart::Polar(p)) => {
                Some((&p.angle_labels, &p.radius_labels, p.angle, p.radius))
            }
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    const R: f32 = POLAR_RADIUS;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn axis(categories: usize) -> PolarAxis {
        PolarAxis {
            categories,
            ..Default::default()
        }
    }

    fn opts(angle: usize, radius: usize) -> PolarOptions {
        PolarOptions {
            angle: axis(angle),
            radius: axis(radius),
            ..Default::default()
        }
    }

    /// Bars on a category angle axis: `[value, category, NaN]`.
    fn bars(values: &[f64], stack: i32) -> PolarSeries {
        let mut s = PolarSeries::new(
            PolarSeriesKind::Bar,
            values
                .iter()
                .enumerate()
                .map(|(i, &v)| [v, i as f64, f64::NAN])
                .collect(),
        );
        s.stack = stack;
        s
    }

    fn line(values: &[f64]) -> PolarSeries {
        let mut s = bars(values, -1);
        s.kind = PolarSeriesKind::Line;
        s.symbol_px = PolarSeries::new(PolarSeriesKind::Line, Vec::new()).symbol_px;
        s
    }

    fn chart(opts: PolarOptions, series: Vec<PolarSeries>) -> (ChartState, OrbitCamera) {
        let chart = ChartState::new_polar(opts, series, HierarchyStyle::default()).unwrap();
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &PolarChart {
        match &chart.kind {
            ChartKind::Hierarchy(HierChart::Polar(p)) => p,
            _ => unreachable!(),
        }
    }

    fn ndc_world(cam: &OrbitCamera, p: (f32, f32)) -> (f32, f32) {
        let n = cam.project_to_ndc(Vec3::new(p.0, p.1, 0.0)).unwrap();
        (n.x, n.y)
    }

    /// NDC of layout angle `a` (radians along the angle axis) at world radius `r`.
    fn ndc_at(c: &ChartState, cam: &OrbitCamera, a: f32, r: f32) -> (f32, f32) {
        ndc_world(cam, polar((0.0, 0.0), inner(c).compass(a), r))
    }

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-4
    }

    fn finite(fills: &[ChartFillRaw]) -> bool {
        fills.iter().all(|f| {
            f.position
                .iter()
                .chain(f.color.iter())
                .all(|x| x.is_finite())
        })
    }

    #[test]
    fn validation_rejects_bad_input() {
        let ok = vec![bars(&[1.0, 2.0], -1)];
        assert!(validate_polar(&opts(2, 0), &ok).is_ok());
        assert!(validate_polar(&opts(2, 0), &[])
            .unwrap_err()
            .contains("at least one series"));
        // Bars need exactly one category axis to stand on
        for o in [opts(0, 0), opts(2, 2)] {
            assert!(validate_polar(&o, &ok)
                .unwrap_err()
                .contains("exactly one category axis"));
        }
        let heat = PolarSeries::new(PolarSeriesKind::Heatmap, vec![[0.0, 0.0, 1.0]]);
        assert!(validate_polar(&opts(2, 0), &[heat.clone()])
            .unwrap_err()
            .contains("category angle and radius"));
        assert!(validate_polar(&opts(2, 2), &[heat]).is_ok());
        let one = |d: [f64; 3]| vec![PolarSeries::new(PolarSeriesKind::Bar, vec![d])];
        assert!(validate_polar(&opts(2, 0), &one([1.0, 2.0, f64::NAN]))
            .unwrap_err()
            .contains("angle category index"));
        assert!(validate_polar(&opts(2, 0), &one([1.0, 0.5, f64::NAN])).is_err());
        assert!(
            validate_polar(&opts(2, 0), &one([f64::INFINITY, 0.0, f64::NAN]))
                .unwrap_err()
                .contains("finite")
        );
        // A missing value (NaN) is a gap, not an error
        assert!(validate_polar(&opts(2, 0), &one([f64::NAN, 0.0, f64::NAN])).is_ok());
        let mut o = opts(2, 0);
        o.radius.min = Some(5.0);
        o.radius.max = Some(5.0);
        assert!(validate_polar(&o, &ok)
            .unwrap_err()
            .contains("min must be below max"));
        assert!(ChartState::new_polar(opts(0, 0), ok, HierarchyStyle::default()).is_err());
    }

    #[test]
    fn radial_bars_sit_in_angle_bands_and_hover() {
        let (mut c, cam) = chart(opts(4, 0), vec![bars(&[3.0, 1.0, 2.0, 4.0], -1)]);
        let v = view(&cam);
        assert!(c.prepare_layers(&v).fills.is_some_and(|f| !f.is_empty()));
        let p = inner(&c);
        assert_eq!((p.radius.lo, p.radius.hi), (0.0, 4.0));
        let band = TAU / 4.0;
        let s = p.geo[0].sector.unwrap();
        assert!(close(s[0], 0.1 * band) && close(s[1], 0.9 * band), "{s:?}");
        assert!(close(s[2], 0.0) && close(s[3], 0.75 * R), "{s:?}");
        let mut scene = SceneWorld::new();
        let n = ndc_at(&c, &cam, 0.5 * band, 0.5 * R);
        let hit = c.hover_at(&v, &mut scene, n).unwrap();
        let it = hit.items[0];
        assert_eq!(
            (it.series, it.index, it.value, it.global_id),
            (0, 0, 3.0, 0)
        );
        // Past the bar's end along the same angle: nothing
        let n = ndc_at(&c, &cam, 0.5 * band, 0.9 * R);
        assert!(c.hover_at(&v, &mut scene, n).is_none());
        let n = ndc_at(&c, &cam, 3.5 * band, 0.95 * R);
        assert_eq!(c.hover_at(&v, &mut scene, n).unwrap().items[0].index, 3);
        assert_eq!(c.point_count(), 4);
        // Keyboard focus and samples
        let hit = c.hover_hierarchy_item(&mut scene, 0, 2).unwrap();
        assert_eq!(hit.items[0].value, 2.0);
        let (series, index, value, at) = c.sample(1).unwrap();
        assert_eq!((series, index, value), (0, 1, 1.0));
        assert!(at.x > 0.0 && at.y < 0.0, "{at:?}");
    }

    #[test]
    fn start_angle_rotates_the_layout() {
        let mut o = opts(4, 0);
        o.start_angle = 0.5 * PI;
        let (mut c, cam) = chart(o, vec![bars(&[3.0, 1.0, 2.0, 4.0], -1)]);
        let v = view(&cam);
        c.prepare_layers(&v);
        assert!(close(inner(&c).compass(0.0), 0.5 * PI));
        // Category 0 now centers at 135 deg (lower right)
        let mut scene = SceneWorld::new();
        let n = ndc_world(&cam, polar((0.0, 0.0), 0.75 * PI, 0.5 * R));
        assert_eq!(c.hover_at(&v, &mut scene, n).unwrap().items[0].index, 0);
    }

    #[test]
    fn stacked_bars_accumulate_signs_separately_and_share_a_slot() {
        let series = vec![
            bars(&[1.0, 2.0], 0),
            bars(&[2.0, -1.0], 0),
            bars(&[1.0, 1.0], -1),
        ];
        let (mut c, cam) = chart(opts(2, 0), series);
        c.prepare_layers(&view(&cam));
        let p = inner(&c);
        // The domain covers the stacked total 3 and the negative -1
        assert_eq!((p.radius.lo, p.radius.hi), (-1.0, 3.0));
        let r = |v: f64| p.radius_of(v);
        let g = |s: usize, i: usize| p.geo[p.offsets[s] + i].sector.unwrap();
        assert!(close(g(1, 0)[2], r(1.0)) && close(g(1, 0)[3], r(3.0)));
        // Negative values stack on their own below zero
        assert!(close(g(1, 1)[2], r(-1.0)) && close(g(1, 1)[3], r(0.0)));
        // Two slots per band (stack 0, series 2): stacked bars share theirs
        assert_eq!(g(0, 0)[..2], g(1, 0)[..2]);
        let band = TAU / 2.0;
        let w = band * 0.8 / 2.3;
        assert!(close(g(0, 0)[0], 0.1 * band) && close(g(0, 0)[1], 0.1 * band + w));
        assert!(close(g(2, 0)[0], 0.1 * band + 1.3 * w));
    }

    #[test]
    fn ring_bars_follow_radius_categories_and_direction() {
        let mut o = opts(0, 3);
        o.angle.max = Some(10.0);
        o.clockwise = false;
        let nan = f64::NAN;
        let data = vec![[0.0, 5.0, nan], [1.0, 10.0, nan], [2.0, 2.5, nan]];
        let (mut c, cam) = chart(o, vec![PolarSeries::new(PolarSeriesKind::Bar, data)]);
        let v = view(&cam);
        c.prepare_layers(&v);
        let p = inner(&c);
        let bw = R / 3.0;
        let s0 = p.geo[0].sector.unwrap();
        assert!(
            close(s0[0], 0.0)
                && close(s0[1], 0.5 * TAU)
                && close(s0[2], 0.1 * bw)
                && close(s0[3], 0.9 * bw),
            "{s0:?}"
        );
        assert!(close(p.geo[1].sector.unwrap()[1], TAU));
        // Counter-clockwise: a quarter turn lands at 9 o'clock
        assert!(close(p.compass(0.25 * TAU), -0.25 * TAU));
        let mut scene = SceneWorld::new();
        let n = ndc_world(&cam, polar((0.0, 0.0), -0.25 * TAU, 0.5 * bw));
        assert_eq!(c.hover_at(&v, &mut scene, n).unwrap().items[0].index, 0);
        // 3 o'clock is three quarters along a counter-clockwise axis: past bar 0's half turn
        let n = ndc_world(&cam, polar((0.0, 0.0), 0.25 * TAU, 0.5 * bw));
        assert!(c.hover_at(&v, &mut scene, n).is_none());
    }

    #[test]
    fn line_and_scatter_points_hover_by_proximity() {
        let scatter = PolarSeries::new(PolarSeriesKind::Scatter, vec![[2.5, 1.0, f64::NAN]]);
        let (mut c, cam) = chart(opts(4, 0), vec![line(&[1.0, 2.0, 3.0, 4.0]), scatter]);
        let v = view(&cam);
        let layers = c.prepare_layers(&v);
        assert_eq!(layers.series.unwrap().len(), 3, "open line: 3 segments");
        assert_eq!(
            layers.series_style.unwrap().markers.len(),
            5,
            "4 symbols + 1 dot"
        );
        let p = inner(&c);
        let pt = p.geo[2].point.unwrap();
        assert!(close(pt[0], 2.5 * TAU / 4.0) && close(pt[1], p.radius_of(3.0)));
        let wpp = p.screen.unwrap().wpp;
        let gid = p.offsets[1];
        let sp = p.geo[gid].point.unwrap();
        let mut scene = SceneWorld::new();
        // 3 CSS px off the point still hits it
        let n = ndc_at(&c, &cam, pt[0], pt[1] + 3.0 * wpp);
        let hit = c.hover_at(&v, &mut scene, n).unwrap();
        assert_eq!(
            (hit.items[0].series, hit.items[0].index, hit.items[0].value),
            (0, 2, 3.0)
        );
        let n = ndc_at(&c, &cam, sp[0], sp[1]);
        let it = c.hover_at(&v, &mut scene, n).unwrap().items[0];
        assert_eq!((it.series, it.index, it.global_id), (1, 0, gid as u32));
        // Far from every point: nothing
        let n = ndc_at(&c, &cam, 0.1, 0.9 * R);
        assert!(c.hover_at(&v, &mut scene, n).is_none());
    }

    #[test]
    fn line_options_change_the_shape() {
        let build = |f: &dyn Fn(&mut PolarSeries)| {
            let mut s = line(&[1.0, 2.0, 3.0, 4.0]);
            f(&mut s);
            let (mut c, cam) = chart(opts(4, 0), vec![s]);
            let l = c.prepare_layers(&view(&cam));
            (l.series.unwrap().len(), l.fills.map_or(0, |f| f.len()))
        };
        assert_eq!(build(&|_| {}), (3, 0));
        assert_eq!(build(&|s| s.closed = true).0, 4);
        assert_eq!(build(&|s| s.smooth = true).0, 3 * SMOOTH_STEPS);
        assert_eq!(build(&|s| s.area = true).1, 3 * 6);
        // A missing value breaks the line
        let mut s = line(&[1.0, f64::NAN, 3.0, 4.0]);
        s.closed = true;
        let (mut c, cam) = chart(opts(4, 0), vec![s]);
        assert_eq!(c.prepare_layers(&view(&cam)).series.unwrap().len(), 1);
    }

    #[test]
    fn heatmap_cells_take_colormap_colors() {
        let data = vec![[0.0, 0.0, 1.0], [1.0, 2.0, 5.0], [0.0, 1.0, f64::NAN]];
        let heat = PolarSeries::new(PolarSeriesKind::Heatmap, data);
        let (mut c, cam) = chart(opts(3, 2), vec![heat]);
        let v = view(&cam);
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        let lut = c.heatmap_lut().unwrap().to_vec();
        let bar = c.heatmap_colorbar().unwrap();
        assert_eq!((bar.scale.lo, bar.scale.hi), (1.0, 5.0));
        assert!(!bar.ticks.is_empty());
        let hot = lut[lut.len() - 1];
        assert_eq!(c.heatmap_color(5.0).unwrap(), hot);
        let hot = hot.map(|x| x as f32 / 255.0);
        assert!(fills.iter().any(|f| f.color == hot));
        let p = inner(&c);
        let s = p.geo[1].sector.unwrap();
        assert!(
            close(s[0], TAU * 2.0 / 3.0)
                && close(s[1], TAU)
                && close(s[2], 0.5 * R)
                && close(s[3], R)
        );
        assert!(p.geo[2].sector.is_none(), "empty cell");
        let mut scene = SceneWorld::new();
        let n = ndc_at(&c, &cam, TAU * 5.0 / 6.0, 0.75 * R);
        let it = c.hover_at(&v, &mut scene, n).unwrap().items[0];
        assert_eq!((it.index, it.value), (1, 5.0));
        let n = ndc_at(&c, &cam, TAU * 0.5, 0.25 * R);
        assert!(c.hover_at(&v, &mut scene, n).is_none());
        // A cartesian chart has no polar colormap
        assert!(ChartState::new_polar(
            opts(3, 0),
            vec![bars(&[1.0], -1)],
            HierarchyStyle::default()
        )
        .unwrap()
        .heatmap_lut()
        .is_none());
    }

    #[test]
    fn full_turn_drops_a_last_angle_tick_crowding_the_first() {
        // 0..360 in steps of 50: 350 sits 10 deg before 0 and is dropped
        let mut o = opts(0, 3);
        o.angle.min = Some(0.0);
        o.angle.max = Some(360.0);
        o.angle.split = 8;
        let nan = f64::NAN;
        let data = vec![[0.0, 90.0, nan], [1.0, 180.0, nan]];
        let (c, _) = chart(o, vec![PolarSeries::new(PolarSeriesKind::Bar, data)]);
        let p = inner(&c);
        assert_eq!(p.angle_labels.first(), Some(&0.0));
        assert_eq!(p.angle_labels.last(), Some(&300.0), "{:?}", p.angle_labels);
        assert_eq!(p.angle_labels.len(), p.angle_label_at.len());
    }

    #[test]
    fn grid_and_axis_labels() {
        let (mut c, cam) = chart(opts(4, 0), vec![bars(&[3.0, 1.0, 2.0, 4.0], -1)]);
        let v = view(&cam);
        assert!(c.prepare_layers(&v).underlay.is_some_and(|u| !u.is_empty()));
        let (labels, rev) = c.hierarchy_labels().unwrap();
        let labels = labels.to_vec();
        let lay = c.hierarchy_layout().unwrap();
        let (cx, cy) = lay.center_css;
        let angle: Vec<_> = labels
            .iter()
            .filter(|l| l.node < POLAR_RADIUS_LABEL)
            .collect();
        let radius: Vec<_> = labels
            .iter()
            .filter(|l| l.node >= POLAR_RADIUS_LABEL)
            .collect();
        assert_eq!(inner(&c).angle_labels, vec![0.0, 1.0, 2.0, 3.0]);
        assert_eq!(inner(&c).radius_labels, vec![0.0, 1.0, 2.0, 3.0, 4.0]);
        assert_eq!((angle.len(), radius.len()), (4, 5));
        // Category 0 centers at 45 deg: its text grows right of an anchor outside the ring
        let a0 = angle[0];
        assert!(a0.x_css > cx && a0.y_css < cy && a0.flags == 1, "{a0:?}");
        assert!((a0.x_css - cx).hypot(a0.y_css - cy) > lay.center_r_css);
        // Radius labels run up the 12 o'clock axis, left of it
        for l in &radius {
            assert!(
                l.x_css < cx && l.y_css <= cy + 0.5 && l.flags == -1,
                "{l:?}"
            );
        }
        c.prepare_layers(&v);
        assert_eq!(
            c.hierarchy_labels().unwrap().1,
            rev,
            "same view: no relayout"
        );
        // Grid off: only the axis lines remain
        let full = {
            let (mut c, cam) = chart(opts(4, 0), vec![bars(&[3.0, 1.0, 2.0, 4.0], -1)]);
            c.prepare_layers(&view(&cam)).underlay.unwrap().len()
        };
        let (mut c, cam) = chart(opts(4, 0), vec![bars(&[3.0, 1.0, 2.0, 4.0], -1)]);
        c.set_frame_style(ChartFrameStyle {
            show_grid: false,
            ..Default::default()
        });
        let bare = c.prepare_layers(&view(&cam)).underlay.unwrap().len();
        assert!(bare > 0 && bare < full, "{bare} {full}");
    }

    #[test]
    fn legend_toggle_restacks_and_tweens_from_the_screen() {
        let (mut c, cam) = chart(opts(2, 0), vec![bars(&[1.0, 2.0], 0), bars(&[2.0, 1.0], 0)]);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.set_animation(AnimationOptions::new(300.0, Easing::Linear));
        c.arm_animation(AnimationOptions::new(300.0, Easing::Linear), None);
        c.prepare_layers(&v);
        c.finish_animation();
        c.prepare_layers(&v);
        let before = inner(&c).geo[2].sector.unwrap();
        assert!(close(before[2], inner(&c).radius_of(1.0)));
        c.set_series_visible(0, false, &mut scene);
        assert!(!c.series_visible(0) && c.series_visible(1));
        let p = inner(&c);
        let after = p.geo[2].sector.unwrap();
        assert!(
            close(after[2], 0.0) && close(after[3], p.radius_of(2.0)),
            "{after:?}"
        );
        assert!(p.geo[0].sector.is_none());
        assert!(c.is_animating());
        c.animation_tick(0.0);
        c.prepare_layers(&v);
        assert!(c.anim_is_update());
        c.animation_tick(150.0);
        c.prepare_layers(&v);
        assert!(!c.anim_fills().is_empty() && finite(c.anim_fills()));
        let mid = inner(&c).drawn.as_ref().unwrap()[2].sector.unwrap();
        assert!(close(mid[2], 0.5 * (before[2] + after[2])), "{mid:?}");
        // The hidden series shrinks to its base instead of vanishing
        assert!(inner(&c).drawn.as_ref().unwrap()[0].sector.is_some());
        // Toggle back mid-tween: tweens from the frame on screen, never NaN
        c.set_series_visible(0, true, &mut scene);
        assert_eq!(
            inner(&c).tween_from.as_ref().unwrap()[2].sector.unwrap(),
            mid
        );
        c.animation_tick(160.0);
        c.prepare_layers(&v);
        c.animation_tick(300.0);
        c.prepare_layers(&v);
        assert!(finite(c.anim_fills()));
        c.animation_tick(2000.0);
        c.prepare_layers(&v);
        assert!(!c.is_animating() && inner(&c).tween_from.is_none());
        assert!(close(inner(&c).geo[2].sector.unwrap()[2], before[2]));
    }

    #[test]
    fn emphasis_fades_other_series_and_svg_is_vector() {
        let (mut c, cam) = chart(
            opts(2, 0),
            vec![bars(&[1.0, 2.0], -1), bars(&[2.0, 1.0], -1)],
        );
        let v = view(&cam);
        c.prepare_layers(&v);
        c.set_emphasis(Some(1));
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        let (c0, c1) = (inner(&c).colors[0], inner(&c).colors[1]);
        assert!(!fills.iter().any(|f| f.color == c0) && fills.iter().any(|f| f.color == c1));
        let svg = c.export_svg(&v, 0, "polar");
        assert_eq!(svg.support, SvgSupport::Vector);
        assert!(
            svg.marks > 0 && svg.markup.contains("<path"),
            "{}",
            svg.marks
        );
    }

    #[test]
    fn round_cap_rounds_bar_corners() {
        let count = |cap: bool| {
            let mut s = bars(&[3.0, 4.0], -1);
            s.round_cap = cap;
            let (mut c, cam) = chart(opts(2, 0), vec![s]);
            let n = c.prepare_layers(&view(&cam)).fills.unwrap().len();
            n
        };
        assert!(count(true) > count(false));
    }

    #[test]
    fn hover_outlines_the_bar_in_the_overlay() {
        let (mut c, cam) = chart(opts(4, 0), vec![bars(&[3.0, 1.0, 2.0, 4.0], -1)]);
        let v = view(&cam);
        c.prepare_layers(&v);
        let mut scene = SceneWorld::new();
        let n = ndc_at(&c, &cam, TAU / 8.0, 0.5 * R);
        c.hover_at(&v, &mut scene, n).unwrap();
        let overlay = c.prepare_layers(&v).overlay.unwrap().len();
        assert!(overlay > 4, "{overlay}");
    }
}
