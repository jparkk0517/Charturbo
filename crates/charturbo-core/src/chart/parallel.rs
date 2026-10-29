//! Parallel coordinates: one polyline per row across 2+ axes (ECharts `parallel`), with
//! interval brushing on the axes.
//!
//! Rows are row-major `rows x dims` values (category dims hold category indices, time dims epoch
//! ms; NaN = missing, which breaks the line). Each axis normalizes its values to `t` in [0, 1]
//! (value: "nice" or explicit domain, time: data extent, category: evenly spaced). Polylines are
//! laid out in CSS px (one world unit = one CSS px) as `ChartSegmentRaw` instances carrying the
//! row index; a per-row flag buffer (`PARALLEL_*`) tells the shader which rows are active,
//! brushed out (dimmed) or hidden, so brushing and legend toggles never re-upload geometry.

use super::heatmap::{
    colormap_lut, ColormapKind, HeatmapColormap, HeatmapDomain, ValueScale, COLORBAR_TICKS,
};
use super::hierarchy::{css_of, frame_css_plot, hover_one, padded_plot, FlatScreen};
use super::time_ticks::time_ticks;
use super::*;
use crate::renderer::{ChartParallelStyleRaw, PARALLEL_ACTIVE, PARALLEL_HIDDEN, PARALLEL_INACTIVE};

/// Most axes of a parallel chart.
pub const MAX_PARALLEL_DIMS: usize = 64;
/// Most rows of a parallel chart.
pub const MAX_PARALLEL_ROWS: usize = 1_000_000;
/// Most polyline segments (rows x (dims - 1) x smooth subdivisions).
pub const MAX_PARALLEL_SEGMENTS: usize = 4_000_000;
/// Most brush intervals per axis.
pub const MAX_PARALLEL_INTERVALS: usize = 16;
/// Most category ticks labelled per axis (thinned evenly beyond).
const MAX_CATEGORY_TICKS: usize = 40;
/// Smooth polylines: subdivisions per gap (fewer when the segment budget is tight).
const SMOOTH_STEPS: usize = 8;
/// Hover / axis hit tolerances (CSS px).
const HOVER_PX: f32 = 6.0;
const AXIS_HIT_PX: f32 = 12.0;
/// Tick length and label gap (CSS px).
const TICK_PX: f32 = 4.0;
const LABEL_GAP_PX: f32 = 4.0;
const NAME_GAP_PX: f32 = 10.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ParallelAxisKind {
    #[default]
    Value,
    /// Values are category indices `0..categories`
    Category,
    /// Values are epoch ms
    Time,
}

/// One axis of a parallel chart.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ParallelDim {
    pub kind: ParallelAxisKind,
    /// Explicit domain ends (value / time axes; `None` = from the data)
    pub min: Option<f64>,
    pub max: Option<f64>,
    /// Flips the axis (high values at the start)
    pub inverse: bool,
    /// Number of categories (category axes)
    pub categories: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ParallelOrient {
    /// Axes are vertical lines spread left to right (values grow upward)
    #[default]
    Horizontal,
    /// Axes are horizontal lines spread top to bottom (values grow rightward)
    Vertical,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParallelOptions {
    pub orient: ParallelOrient,
    /// Stroke width (CSS px)
    pub line_width: f32,
    /// Line opacity (multiplies the row color alpha)
    pub opacity: f32,
    /// Smoothstep curves between axes instead of straight segments
    pub smooth: bool,
    /// Color rows by this dim through the heatmap colormap (else by series)
    pub color_dim: Option<usize>,
    /// Number of series (legend entries) the rows belong to
    pub series_count: usize,
}

impl Default for ParallelOptions {
    fn default() -> Self {
        Self {
            orient: ParallelOrient::Horizontal,
            line_width: 1.0,
            opacity: 0.45,
            smooth: false,
            color_dim: None,
            series_count: 1,
        }
    }
}

/// Theme-dependent colors (changing them keeps the layout).
#[derive(Debug, Clone, PartialEq)]
pub struct ParallelStyle {
    /// Row colors by series (cycled)
    pub series_colors: Vec<[f32; 4]>,
    pub axis_color: [f32; 4],
    pub axis_width: f32,
    /// Brushed interval bands drawn along the axes
    pub brush_color: [f32; 4],
    pub brush_width: f32,
    /// Inactive (brushed-out) rows: `rgb` mixed into the row color by `a`
    pub inactive_color: [f32; 4],
    pub inactive_opacity: f32,
    /// Hovered row stroke width (CSS px)
    pub hover_width: f32,
}

impl Default for ParallelStyle {
    fn default() -> Self {
        Self {
            series_colors: vec![[0.33, 0.44, 0.78, 1.0]],
            axis_color: [0.4, 0.4, 0.4, 1.0],
            axis_width: 1.0,
            brush_color: [0.3, 0.5, 0.9, 0.35],
            brush_width: 14.0,
            inactive_color: [0.6, 0.6, 0.6, 0.0],
            inactive_opacity: 0.05,
            hover_width: 3.0,
        }
    }
}

/// DOM label anchor (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ParallelLabel {
    /// 0 = tick (`value` in data units), 1 = axis name
    pub kind: u8,
    pub axis: u32,
    pub value: f64,
    pub x_css: f32,
    pub y_css: f32,
    /// -1 = text ends at the anchor, 0 = centered, 1 = starts at it
    pub h_align: i8,
    /// -1 = text above the anchor, 0 = centered, 1 = below it
    pub v_align: i8,
    /// Time ticks: granularity (see `time_ticks`); 0 otherwise
    pub gran: u8,
}

/// Checks the input before any chart state is replaced.
pub fn validate_parallel(
    dims: &[ParallelDim],
    values: &[f64],
    series: &[u32],
    opts: &ParallelOptions,
) -> Result<(), String> {
    let n = dims.len();
    if !(2..=MAX_PARALLEL_DIMS).contains(&n) {
        return Err(format!(
            "parallel chart needs 2 to {MAX_PARALLEL_DIMS} dimensions, got {n}"
        ));
    }
    if values.len() % n != 0 {
        return Err(format!(
            "parallel values ({}) must be a multiple of the {n} dimensions",
            values.len()
        ));
    }
    let rows = values.len() / n;
    if rows > MAX_PARALLEL_ROWS {
        return Err(format!(
            "parallel chart has {rows} rows (at most {MAX_PARALLEL_ROWS})"
        ));
    }
    if rows * (n - 1) > MAX_PARALLEL_SEGMENTS {
        return Err(format!(
            "parallel chart needs {} segments (at most {MAX_PARALLEL_SEGMENTS})",
            rows * (n - 1)
        ));
    }
    for (i, d) in dims.iter().enumerate() {
        let bad = |v: Option<f64>| v.is_some_and(|v| !v.is_finite());
        if bad(d.min) || bad(d.max) {
            return Err(format!("parallel dimension {i} min / max must be finite"));
        }
        if let (Some(lo), Some(hi)) = (d.min, d.max) {
            if lo >= hi {
                return Err(format!("parallel dimension {i} min must be below max"));
            }
        }
        if d.kind == ParallelAxisKind::Category && d.categories == 0 {
            return Err(format!(
                "parallel dimension {i} is a category axis without categories"
            ));
        }
    }
    for (k, &v) in values.iter().enumerate() {
        if v.is_nan() {
            continue;
        }
        let (r, i) = (k / n, k % n);
        if !v.is_finite() {
            return Err(format!(
                "parallel row {r} dimension {i} is {v} (finite or NaN only)"
            ));
        }
        let d = &dims[i];
        if d.kind == ParallelAxisKind::Category
            && (v.fract() != 0.0 || v < 0.0 || v >= d.categories as f64)
        {
            return Err(format!(
                "parallel row {r} dimension {i}: {v} is not one of its {} categories",
                d.categories
            ));
        }
    }
    let count = opts.series_count.max(1);
    if !series.is_empty() && series.len() != rows {
        return Err(format!(
            "parallel chart has {rows} rows but {} series indices",
            series.len()
        ));
    }
    if let Some(s) = series.iter().find(|&&s| s as usize >= count) {
        return Err(format!(
            "parallel series index {s} is out of range ({count} series)"
        ));
    }
    if opts.color_dim.is_some_and(|d| d >= n) {
        return Err(format!(
            "parallel color dimension is out of range ({n} dimensions)"
        ));
    }
    Ok(())
}

const DAY_MS: f64 = 86_400_000.0;

/// Resolved axis: domain and ticks.
#[derive(Debug, Clone, PartialEq)]
struct Axis {
    lo: f64,
    hi: f64,
    /// `(value, granularity)` (granularity: time axes only)
    ticks: Vec<(f64, u8)>,
}

fn resolve_axis(d: &ParallelDim, column: impl Iterator<Item = f64>) -> Axis {
    if d.kind == ParallelAxisKind::Category {
        let k = d.categories.max(1) as usize;
        let step = k.div_ceil(MAX_CATEGORY_TICKS).max(1);
        let ticks = (0..k).step_by(step).map(|c| (c as f64, 0)).collect();
        return Axis {
            lo: 0.0,
            hi: (k - 1) as f64,
            ticks,
        };
    }
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for v in column.filter(|v| v.is_finite()) {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    if !lo.is_finite() {
        (lo, hi) = (0.0, 1.0);
    }
    if d.kind == ParallelAxisKind::Time {
        let (mut lo, mut hi) = (d.min.unwrap_or(lo), d.max.unwrap_or(hi));
        if hi <= lo {
            match (d.min, d.max) {
                (Some(_), None) => hi = lo + DAY_MS,
                (None, Some(_)) => lo = hi - DAY_MS,
                _ => (lo, hi) = (lo - DAY_MS / 2.0, lo + DAY_MS / 2.0),
            }
        }
        return Axis {
            lo,
            hi,
            ticks: time_ticks(lo, hi, 5),
        };
    }
    let (a, b) = (d.min.unwrap_or(lo), d.max.unwrap_or(hi));
    let (nlo, nhi, _) = nice_domain(a.min(b), a.max(b), 5);
    let (mut lo, mut hi) = (d.min.unwrap_or(nlo), d.max.unwrap_or(nhi));
    if hi <= lo {
        let step = nice_step(lo.abs().max(hi.abs()).max(1.0), 5);
        if d.max.is_some() {
            lo = hi - step;
        } else {
            hi = lo + step;
        }
    }
    let ticks = ticks_between(lo, hi, nice_step(hi - lo, 5))
        .into_iter()
        .map(|v| (v, 0))
        .collect();
    Axis { lo, hi, ticks }
}

/// Smoothstep along a gap and its derivative (linear when not smooth).
fn ease(smooth: bool, s: f32) -> (f32, f32) {
    if smooth {
        (s * s * (3.0 - 2.0 * s), 6.0 * s * (1.0 - s))
    } else {
        (s, 1.0)
    }
}

#[derive(Debug, Clone)]
pub(crate) struct ParallelChart {
    dims: Vec<ParallelDim>,
    axes: Vec<Axis>,
    rows: usize,
    /// Row-major data values
    values: Vec<f64>,
    /// Row-major axis positions in [0, 1] (NaN = missing)
    t: Vec<f32>,
    series: Vec<u32>,
    visible: Vec<bool>,
    opts: ParallelOptions,
    style: ParallelStyle,
    /// Color-by-dimension scale (`opts.color_dim`)
    colormap: HeatmapColormap,
    domain: HeatmapDomain,
    scale: ValueScale,
    lut: Vec<[u8; 4]>,
    /// Brush intervals per axis (data units, `lo <= hi`)
    brush: Vec<Vec<(f64, f64)>>,
    flags: Vec<f32>,
    active: usize,
    segments: Vec<ChartSegmentRaw>,
    /// Screen and plot the segments / labels were built for
    built: Option<(FlatScreen, [f32; 4])>,
    /// Hovered row the overlay was built for
    outlined: Option<Option<u32>>,
    /// Layer opacity last handed to the GPU (enter fade)
    fade: f32,
    labels: Vec<ParallelLabel>,
    labels_revision: u32,
}

impl ParallelChart {
    fn new(
        dims: &[ParallelDim],
        values: &[f64],
        series: &[u32],
        mut opts: ParallelOptions,
        style: ParallelStyle,
    ) -> Self {
        let clean =
            |v: f32, d: f32, lo: f32, hi: f32| if v.is_finite() { v.clamp(lo, hi) } else { d };
        opts.line_width = clean(opts.line_width, 1.0, 0.1, 32.0);
        opts.opacity = clean(opts.opacity, 0.45, 0.0, 1.0);
        opts.series_count = opts.series_count.max(1);
        let n = dims.len().max(1);
        let rows = values.len() / n;
        let axes = dims
            .iter()
            .enumerate()
            .map(|(i, d)| resolve_axis(d, values.iter().skip(i).step_by(n).copied()))
            .collect();
        let colormap = HeatmapColormap::default();
        let mut chart = Self {
            dims: dims.to_vec(),
            axes,
            rows,
            values: values.to_vec(),
            t: Vec::new(),
            series: if series.is_empty() {
                vec![0; rows]
            } else {
                series.to_vec()
            },
            visible: vec![true; opts.series_count],
            opts,
            style: ParallelStyle::default(),
            lut: colormap_lut(&colormap),
            colormap,
            domain: HeatmapDomain::default(),
            scale: ValueScale {
                lo: 0.0,
                hi: 1.0,
                center: None,
            },
            brush: vec![Vec::new(); dims.len()],
            flags: Vec::new(),
            active: 0,
            segments: Vec::new(),
            built: None,
            outlined: None,
            fade: f32::NAN,
            labels: Vec::new(),
            labels_revision: 0,
        };
        let t = chart
            .values
            .iter()
            .enumerate()
            .map(|(k, &v)| chart.t_of(k % n, v))
            .collect();
        chart.t = t;
        chart.set_style_inner(style);
        chart.resolve_scale();
        chart.compute_flags();
        chart
    }

    fn n(&self) -> usize {
        self.dims.len()
    }

    /// Axis position in [0, 1] of a data value (clamped; NaN = missing).
    fn t_of(&self, d: usize, v: f64) -> f32 {
        if !v.is_finite() {
            return f32::NAN;
        }
        let a = &self.axes[d];
        let t = if a.hi > a.lo {
            ((v - a.lo) / (a.hi - a.lo)).clamp(0.0, 1.0)
        } else {
            0.5
        };
        (if self.dims[d].inverse { 1.0 - t } else { t }) as f32
    }

    /// Data value at axis position `t` (clamped to the axis).
    fn value_of_t(&self, d: usize, t: f32) -> f64 {
        let t = t.clamp(0.0, 1.0) as f64;
        let t = if self.dims[d].inverse { 1.0 - t } else { t };
        let a = &self.axes[d];
        a.lo + t * (a.hi - a.lo)
    }

    fn horizontal(&self) -> bool {
        self.opts.orient == ParallelOrient::Horizontal
    }

    /// CSS coordinate of axis `d` across the axes (x when horizontal).
    fn along(&self, plot: &[f32; 4], d: usize) -> f32 {
        let f = d as f32 / (self.n().max(2) - 1) as f32;
        if self.horizontal() {
            plot[0] + f * plot[2]
        } else {
            plot[1] + f * plot[3]
        }
    }

    /// CSS coordinate of axis position `t` (y when horizontal: values grow upward).
    fn perp(&self, plot: &[f32; 4], t: f32) -> f32 {
        if self.horizontal() {
            plot[1] + (1.0 - t) * plot[3]
        } else {
            plot[0] + t * plot[2]
        }
    }

    /// Axis position of a perpendicular CSS coordinate (unclamped).
    fn t_at(&self, plot: &[f32; 4], p: f32) -> f32 {
        if self.horizontal() {
            1.0 - (p - plot[1]) / plot[3].max(1e-6)
        } else {
            (p - plot[0]) / plot[2].max(1e-6)
        }
    }

    fn css(&self, along: f32, perp: f32) -> (f32, f32) {
        if self.horizontal() {
            (along, perp)
        } else {
            (perp, along)
        }
    }

    /// `(along, perp)` of a CSS point.
    fn split(&self, (x, y): (f32, f32)) -> (f32, f32) {
        if self.horizontal() {
            (x, y)
        } else {
            (y, x)
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.rows
    }

    pub(crate) fn series_count(&self) -> usize {
        self.visible.len()
    }

    pub(crate) fn segments(&self) -> &[ChartSegmentRaw] {
        &self.segments
    }

    pub(crate) fn flags(&self) -> &[f32] {
        &self.flags
    }

    fn brushed(&self) -> bool {
        self.brush.iter().any(|b| !b.is_empty())
    }

    /// Row color before the line opacity.
    fn row_color(&self, r: usize) -> [f32; 4] {
        if let Some(d) = self.opts.color_dim {
            return match self.scale.normalize(self.values[r * self.n() + d] as f32) {
                Some(t) => self.lut[ValueScale::lut_index(t)].map(|c| c as f32 / 255.0),
                None => self.colormap.empty,
            };
        }
        let colors = &self.style.series_colors;
        if colors.is_empty() {
            return ParallelStyle::default().series_colors[0];
        }
        colors[self.series[r] as usize % colors.len()]
    }

    /// Recomputes the row flags and the active count.
    fn compute_flags(&mut self) {
        let n = self.n();
        let brushed: Vec<usize> = (0..n).filter(|&d| !self.brush[d].is_empty()).collect();
        let mut active = 0;
        let flags = (0..self.rows)
            .map(|r| {
                if !self
                    .visible
                    .get(self.series[r] as usize)
                    .copied()
                    .unwrap_or(true)
                {
                    return PARALLEL_HIDDEN;
                }
                let inside = brushed.iter().all(|&d| {
                    let v = self.values[r * n + d];
                    self.brush[d].iter().any(|&(lo, hi)| v >= lo && v <= hi)
                });
                if inside {
                    active += 1;
                    PARALLEL_ACTIVE
                } else {
                    PARALLEL_INACTIVE
                }
            })
            .collect();
        self.flags = flags;
        self.active = active;
    }

    pub(crate) fn set_visible(&mut self, series: usize, visible: bool) -> bool {
        match self.visible.get_mut(series) {
            Some(v) if *v != visible => {
                *v = visible;
                self.compute_flags();
                true
            }
            _ => false,
        }
    }

    pub(crate) fn visible(&self, series: usize) -> bool {
        self.visible.get(series).copied().unwrap_or(false)
    }

    fn set_style_inner(&mut self, mut style: ParallelStyle) {
        let clean = |v: f32, d: f32, hi: f32| if v.is_finite() { v.clamp(0.0, hi) } else { d };
        style.axis_width = clean(style.axis_width, 1.0, 16.0);
        style.brush_width = clean(style.brush_width, 14.0, 64.0);
        style.hover_width = clean(style.hover_width, 3.0, 32.0);
        style.inactive_opacity = clean(style.inactive_opacity, 0.05, 1.0);
        self.style = style;
    }

    /// Re-resolves the color scale; true when it changed (color-by-dimension charts only).
    fn resolve_scale(&mut self) -> bool {
        let Some(d) = self.opts.color_dim else {
            return false;
        };
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for &v in self
            .values
            .iter()
            .skip(d)
            .step_by(self.n())
            .filter(|v| v.is_finite())
        {
            lo = lo.min(v);
            hi = hi.max(v);
        }
        let data = if lo.is_finite() { (lo, hi) } else { (0.0, 1.0) };
        let scale = ValueScale::resolve(
            data,
            &self.domain,
            self.colormap.kind == ColormapKind::Diverging,
        );
        std::mem::replace(&mut self.scale, scale) != scale
    }

    /// Returns true when row colors changed (color-by-dimension charts only).
    pub(crate) fn set_colormap(&mut self, map: HeatmapColormap) -> bool {
        self.lut = colormap_lut(&map);
        self.colormap = map;
        self.resolve_scale();
        self.opts.color_dim.is_some()
    }

    pub(crate) fn set_domain(&mut self, domain: HeatmapDomain) -> bool {
        self.domain = domain;
        self.resolve_scale()
    }

    pub(crate) fn lut(&self) -> Option<&[[u8; 4]]> {
        self.opts.color_dim.map(|_| self.lut.as_slice())
    }

    pub(crate) fn colorbar(&self) -> Option<HeatmapColorbar> {
        self.opts.color_dim?;
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

    pub(crate) fn color_of(&self, v: f32) -> Option<[u8; 4]> {
        self.opts.color_dim?;
        Some(match self.scale.normalize(v) {
            Some(t) => self.lut[ValueScale::lut_index(t)],
            None => self
                .colormap
                .empty
                .map(|c| (c.clamp(0.0, 1.0) * 255.0).round() as u8),
        })
    }

    /// Subdivisions per gap (smooth lines, within the segment budget).
    fn steps(&self) -> usize {
        if !self.opts.smooth {
            return 1;
        }
        let gaps = (self.rows * (self.n() - 1)).max(1);
        (MAX_PARALLEL_SEGMENTS / gaps).clamp(1, SMOOTH_STEPS)
    }

    /// Pushes the polyline of row `r` (CSS -> world through `screen`).
    #[allow(clippy::too_many_arguments)]
    fn push_row(
        &self,
        screen: &FlatScreen,
        plot: &[f32; 4],
        r: usize,
        width: f32,
        color: [f32; 4],
        tag: f32,
        out: &mut Vec<ChartSegmentRaw>,
    ) {
        let n = self.n();
        let k = self.steps();
        for g in 0..n - 1 {
            let (t0, t1) = (self.t[r * n + g], self.t[r * n + g + 1]);
            if t0.is_nan() || t1.is_nan() {
                continue;
            }
            let (a0, a1) = (self.along(plot, g), self.along(plot, g + 1));
            let (p0, p1) = (self.perp(plot, t0), self.perp(plot, t1));
            let at = |s: f32| {
                let e = ease(self.opts.smooth, s).0;
                let (x, y) = self.css(a0 + (a1 - a0) * s, p0 + (p1 - p0) * e);
                screen.world(x, y)
            };
            let mut prev = at(0.0);
            for j in 1..=k {
                let next = at(j as f32 / k as f32);
                out.push(ChartSegmentRaw {
                    p0_width: [prev.0, prev.1, 0.0, width],
                    p1_pad: [next.0, next.1, 0.0, tag],
                    color,
                });
                prev = next;
            }
        }
    }

    fn build_segments(&mut self, screen: &FlatScreen, plot: &[f32; 4]) {
        let mut out = std::mem::take(&mut self.segments);
        out.clear();
        out.reserve(self.rows * (self.n() - 1) * self.steps());
        for r in 0..self.rows {
            let c = self.row_color(r);
            let color = [c[0], c[1], c[2], c[3] * self.opts.opacity];
            self.push_row(
                screen,
                plot,
                r,
                self.opts.line_width,
                color,
                r as f32,
                &mut out,
            );
        }
        self.segments = out;
    }

    /// Axis lines, ticks and brushed interval bands.
    fn build_axes(&self, screen: &FlatScreen, plot: &[f32; 4], out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        let st = &self.style;
        let mut seg = |a: (f32, f32), b: (f32, f32), width: f32, color: [f32; 4]| {
            let (a, b) = (screen.world(a.0, a.1), screen.world(b.0, b.1));
            out.push(ChartSegmentRaw {
                p0_width: [a.0, a.1, 0.0, width],
                p1_pad: [b.0, b.1, 0.0, 0.0],
                color,
            });
        };
        // Ticks point away from the plot: left of horizontal-layout axes, below vertical ones
        let off = if self.horizontal() { -TICK_PX } else { TICK_PX };
        for d in 0..self.n() {
            let a = self.along(plot, d);
            if st.axis_width > 0.0 {
                seg(
                    self.css(a, self.perp(plot, 0.0)),
                    self.css(a, self.perp(plot, 1.0)),
                    st.axis_width,
                    st.axis_color,
                );
                for &(v, _) in &self.axes[d].ticks {
                    let p = self.perp(plot, self.t_of(d, v));
                    seg(
                        self.css(a, p),
                        self.css(a + off, p),
                        st.axis_width,
                        st.axis_color,
                    );
                }
            }
            for &(lo, hi) in &self.brush[d] {
                let (p0, p1) = (
                    self.perp(plot, self.t_of(d, lo)),
                    self.perp(plot, self.t_of(d, hi)),
                );
                let (mut p0, mut p1) = (p0.min(p1), p0.max(p1));
                if p1 - p0 < 4.0 {
                    (p0, p1) = (p0 - 2.0, p1 + 2.0);
                }
                seg(
                    self.css(a, p0),
                    self.css(a, p1),
                    st.brush_width,
                    st.brush_color,
                );
            }
        }
    }

    fn build_hover(
        &self,
        screen: &FlatScreen,
        plot: &[f32; 4],
        hovered: Option<u32>,
        out: &mut Vec<ChartSegmentRaw>,
    ) {
        out.clear();
        let Some(r) = hovered.map(|r| r as usize).filter(|&r| r < self.rows) else {
            return;
        };
        let c = self.row_color(r);
        let width = self.style.hover_width.max(self.opts.line_width);
        self.push_row(screen, plot, r, width, [c[0], c[1], c[2], 1.0], 0.0, out);
    }

    fn layout_labels(&mut self, plot: &[f32; 4]) {
        let mut out = Vec::new();
        let h = self.horizontal();
        for d in 0..self.n() {
            let a = self.along(plot, d);
            for &(value, gran) in &self.axes[d].ticks {
                let p = self.perp(plot, self.t_of(d, value));
                let (x_css, y_css, h_align, v_align) = if h {
                    (a - TICK_PX - LABEL_GAP_PX, p, -1, 0)
                } else {
                    (p, a + TICK_PX + LABEL_GAP_PX, 0, 1)
                };
                out.push(ParallelLabel {
                    kind: 0,
                    axis: d as u32,
                    value,
                    x_css,
                    y_css,
                    h_align,
                    v_align,
                    gran,
                });
            }
            let (x_css, y_css, h_align, v_align) = if h {
                (a, plot[1] - NAME_GAP_PX, 0, -1)
            } else {
                (plot[0] - NAME_GAP_PX, a, -1, 0)
            };
            out.push(ParallelLabel {
                kind: 1,
                axis: d as u32,
                value: 0.0,
                x_css,
                y_css,
                h_align,
                v_align,
                gran: 0,
            });
        }
        if out != self.labels {
            self.labels = out;
            self.labels_revision = self.labels_revision.wrapping_add(1);
        }
    }

    pub(crate) fn frame_camera(
        &self,
        camera: &mut OrbitCamera,
        css: (f32, f32),
        padding: &ChartPadding,
    ) {
        frame_css_plot(camera, css, padding);
    }

    /// `(series, row, value on axis 0, the row's point on its first present axis)` (needs a
    /// prepared frame).
    pub(crate) fn sample(&self, row: u32) -> Option<(u32, u32, f32, Vec3)> {
        let (screen, plot) = self.built?;
        let r = row as usize;
        if r >= self.rows {
            return None;
        }
        let n = self.n();
        let d = (0..n).find(|&d| !self.t[r * n + d].is_nan()).unwrap_or(0);
        let t = self.t[r * n + d];
        let t = if t.is_nan() { 0.5 } else { t };
        let (x, y) = self.css(self.along(&plot, d), self.perp(&plot, t));
        let (wx, wy) = screen.world(x, y);
        Some((
            self.series[r],
            row,
            self.values[r * n] as f32,
            Vec3::new(wx, wy, 0.0),
        ))
    }

    /// Nearest active row within `HOVER_PX` (perpendicular distance) of the pointer.
    pub(crate) fn hover(
        &self,
        view: &ChartView,
        ndc: (f32, f32),
        padding: &ChartPadding,
    ) -> Option<HoverResult> {
        let screen = FlatScreen::of(view)?;
        let plot = padded_plot(css_of(view), padding);
        let (a, p) = self.split(screen.css_at(view, ndc)?);
        let n = self.n();
        let (first, last) = (self.along(&plot, 0), self.along(&plot, n - 1));
        if a < first - HOVER_PX || a > last + HOVER_PX {
            return None;
        }
        let span = (last - first) / (n - 1) as f32;
        if span <= 0.0 {
            return None;
        }
        let g = (((a - first) / span).floor().max(0.0) as usize).min(n - 2);
        let s = ((a - self.along(&plot, g)) / span).clamp(0.0, 1.0);
        let (e, de) = ease(self.opts.smooth, s);
        let mut best: Option<(f32, usize)> = None;
        for r in 0..self.rows {
            if self.flags[r] != PARALLEL_ACTIVE {
                continue;
            }
            let (t0, t1) = (self.t[r * n + g], self.t[r * n + g + 1]);
            if t0.is_nan() || t1.is_nan() {
                continue;
            }
            let (p0, p1) = (self.perp(&plot, t0), self.perp(&plot, t1));
            let slope = (p1 - p0) / span * de;
            let dist = (p0 + (p1 - p0) * e - p).abs() / (1.0 + slope * slope).sqrt();
            // Later rows draw on top: they win ties
            if dist <= HOVER_PX && best.is_none_or(|(b, _)| dist <= b) {
                best = Some((dist, r));
            }
        }
        let (_, r) = best?;
        let d = if s < 0.5 { g } else { g + 1 };
        Some(hover_one(
            self.series[r],
            r as u32,
            self.values[r * n + d],
            r as u32,
        ))
    }

    /// Plot and `(along, perp)` of an NDC pointer.
    fn pointer(
        &self,
        view: &ChartView,
        ndc: (f32, f32),
        padding: &ChartPadding,
    ) -> Option<([f32; 4], f32, f32)> {
        let screen = FlatScreen::of(view)?;
        let plot = padded_plot(css_of(view), padding);
        let (a, p) = self.split(screen.css_at(view, ndc)?);
        Some((plot, a, p))
    }

    pub(crate) fn axis_hit(
        &self,
        view: &ChartView,
        ndc: (f32, f32),
        padding: &ChartPadding,
    ) -> Option<(usize, f64)> {
        let (plot, a, p) = self.pointer(view, ndc, padding)?;
        let t = self.t_at(&plot, p);
        let length = if self.horizontal() { plot[3] } else { plot[2] };
        let slack = HOVER_PX / length.max(1.0);
        if !(-slack..=1.0 + slack).contains(&t) {
            return None;
        }
        let (d, _) = (0..self.n())
            .map(|d| (d, (self.along(&plot, d) - a).abs()))
            .filter(|&(_, dist)| dist <= AXIS_HIT_PX)
            .min_by(|x, y| x.1.total_cmp(&y.1))?;
        Some((d, self.value_of_t(d, t)))
    }

    pub(crate) fn value_at(
        &self,
        axis: usize,
        view: &ChartView,
        ndc: (f32, f32),
        padding: &ChartPadding,
    ) -> Option<f64> {
        if axis >= self.n() {
            return None;
        }
        let (plot, _, p) = self.pointer(view, ndc, padding)?;
        Some(self.value_of_t(axis, self.t_at(&plot, p)))
    }

    pub(crate) fn axes(&self, view: &ChartView, padding: &ChartPadding, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = padded_plot(css_of(view), padding);
    }

    fn gpu_style(&self) -> ChartParallelStyleRaw {
        let fade = if self.fade.is_finite() {
            self.fade
        } else {
            1.0
        };
        ChartParallelStyleRaw {
            inactive: self.style.inactive_color,
            params: [
                self.style.inactive_opacity,
                if self.brushed() { 1.0 } else { 0.0 },
                1.0,
                fade,
            ],
        }
    }
}

impl ChartState {
    /// Creates a parallel coordinates chart from validated input (see `validate_parallel`).
    pub fn new_parallel(
        dims: &[ParallelDim],
        values: &[f64],
        series: &[u32],
        opts: ParallelOptions,
        style: ParallelStyle,
    ) -> Self {
        Self::with_kind(ChartKind::Parallel(ParallelChart::new(
            dims, values, series, opts, style,
        )))
    }

    /// Replaces every brush interval `(axis, lo, hi)` (data units; several per axis = union,
    /// several axes = intersection; empty = no brush). Returns the active row count. Only the
    /// row flags (and the axis bands) are re-uploaded; a hover on a brushed-out row is dropped.
    /// Invalid input leaves the brush unchanged.
    pub fn set_parallel_brush(
        &mut self,
        intervals: &[(usize, f64, f64)],
        scene: &mut SceneWorld,
    ) -> Result<usize, String> {
        let ChartKind::Parallel(p) = &mut self.kind else {
            return Err("not a parallel chart".into());
        };
        let n = p.n();
        let mut brush = vec![Vec::new(); n];
        for &(axis, a, b) in intervals {
            if axis >= n {
                return Err(format!(
                    "parallel brush axis {axis} is out of range ({n} axes)"
                ));
            }
            if !a.is_finite() || !b.is_finite() {
                return Err(format!(
                    "parallel brush interval on axis {axis} must be finite"
                ));
            }
            if brush[axis].len() == MAX_PARALLEL_INTERVALS {
                return Err(format!(
                    "at most {MAX_PARALLEL_INTERVALS} brush intervals per axis"
                ));
            }
            brush[axis].push((a.min(b), a.max(b)));
        }
        if p.brush != brush {
            let was = p.brushed();
            p.brush = brush;
            p.compute_flags();
            self.dirty.parallel_flags = true;
            self.dirty.parallel_style |= was != p.brushed();
            self.dirty.series = true;
        }
        let active = p.active;
        let stale = self
            .hover
            .as_ref()
            .and_then(|h| h.items.get(h.primary))
            .is_some_and(|i| p.flags.get(i.global_id as usize) != Some(&PARALLEL_ACTIVE));
        if stale {
            self.set_hover(None, scene);
        }
        Ok(active)
    }

    /// Hovers row `row` by index (keyboard focus, no pointer): brushed-out rows too, hidden
    /// rows / other kinds clear the hover and return None.
    pub fn hover_parallel_row(&mut self, row: u32, scene: &mut SceneWorld) -> Option<HoverResult> {
        let hit = match &self.kind {
            ChartKind::Parallel(p) => {
                let r = row as usize;
                p.flags.get(r).filter(|&&f| f >= 0.0).map(|_| {
                    hover_one(p.series[r], row, p.values[r * p.n()], row)
                })
            }
            _ => None,
        };
        self.hover_ndc = None;
        self.hover_x = None;
        self.set_hover(hit.clone(), scene);
        hit
    }

    /// Current brush intervals `(axis, lo, hi)` by axis.
    pub fn parallel_brush(&self) -> Vec<(usize, f64, f64)> {
        match &self.kind {
            ChartKind::Parallel(p) => p
                .brush
                .iter()
                .enumerate()
                .flat_map(|(d, b)| b.iter().map(move |&(lo, hi)| (d, lo, hi)))
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Visible rows inside the brush (every visible row without one).
    pub fn parallel_active_count(&self) -> usize {
        match &self.kind {
            ChartKind::Parallel(p) => p.active,
            _ => 0,
        }
    }

    pub fn parallel_active_rows(&self) -> Vec<u32> {
        match &self.kind {
            ChartKind::Parallel(p) => (0..p.rows as u32)
                .filter(|&r| p.flags[r as usize] == PARALLEL_ACTIVE)
                .collect(),
            _ => Vec::new(),
        }
    }

    /// Axis under an NDC pointer and the data value there (brush drags start on an axis).
    pub fn parallel_axis_hit(&self, view: &ChartView, ndc: (f32, f32)) -> Option<(usize, f64)> {
        match &self.kind {
            ChartKind::Parallel(p) => p.axis_hit(view, ndc, &self.padding),
            _ => None,
        }
    }

    /// Data value of `axis` at an NDC pointer (clamped to the axis; brush drag updates).
    pub fn parallel_value_at(&self, axis: usize, view: &ChartView, ndc: (f32, f32)) -> Option<f64> {
        match &self.kind {
            ChartKind::Parallel(p) => p.value_at(axis, view, ndc, &self.padding),
            _ => None,
        }
    }

    /// `(lo, hi)` domain per axis (category axes: `(0, categories - 1)`).
    pub fn parallel_domains(&self) -> Option<Vec<(f64, f64)>> {
        match &self.kind {
            ChartKind::Parallel(p) => Some(p.axes.iter().map(|a| (a.lo, a.hi)).collect()),
            _ => None,
        }
    }

    /// Label anchors of the last prepared frame and their revision.
    pub fn parallel_labels(&self) -> Option<(&[ParallelLabel], u32)> {
        match &self.kind {
            ChartKind::Parallel(p) => Some((&p.labels, p.labels_revision)),
            _ => None,
        }
    }

    /// Theme colors (keeps the layout and the brush).
    pub fn set_parallel_style(&mut self, style: ParallelStyle) {
        if let ChartKind::Parallel(p) = &mut self.kind {
            p.set_style_inner(style);
            self.dirty.parallel = true;
            self.dirty.parallel_style = true;
            self.dirty.series = true;
            self.dirty.overlay = true;
        }
    }

    /// Parallel part of `prepare_layers`.
    pub(crate) fn prepare_parallel(&mut self, view: &ChartView) {
        let hovered = self
            .hover
            .as_ref()
            .and_then(|h| h.items.get(h.primary))
            .map(|i| i.global_id);
        let fade = self.animation_progress();
        let fade = if fade.is_finite() {
            fade.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let ChartKind::Parallel(p) = &mut self.kind else {
            return;
        };
        let Some(screen) = FlatScreen::of(view) else {
            return;
        };
        let plot = padded_plot(css_of(view), &self.padding);
        if self.dirty.parallel || p.built != Some((screen, plot)) {
            p.build_segments(&screen, &plot);
            p.layout_labels(&plot);
            p.built = Some((screen, plot));
            p.outlined = None;
            self.dirty.parallel = true;
            self.dirty.series = true;
        }
        if self.dirty.series {
            p.build_axes(&screen, &plot, &mut self.series);
        }
        if self.dirty.overlay || p.outlined != Some(hovered) {
            p.build_hover(&screen, &plot, hovered, &mut self.overlay);
            self.markers.clear();
            p.outlined = Some(hovered);
            self.dirty.overlay = true;
        }
        if p.fade != fade {
            p.fade = fade;
            self.dirty.parallel_style = true;
        }
        if self.dirty.underlay {
            self.underlay.clear();
        }
    }

    /// Resolved polylines for SVG export: inactive rows first (dimmed), then active rows.
    pub(crate) fn parallel_svg_segments(&self) -> Vec<ChartSegmentRaw> {
        let ChartKind::Parallel(p) = &self.kind else {
            return Vec::new();
        };
        let style = p.gpu_style();
        let mut out = Vec::new();
        for active in [false, true] {
            for s in &p.segments {
                let flag = p
                    .flags
                    .get(s.p1_pad[3] as usize)
                    .copied()
                    .unwrap_or(PARALLEL_ACTIVE);
                if flag < 0.0 || (flag > 0.5) != active {
                    continue;
                }
                if let Some(color) = style.resolve(s.color, flag) {
                    out.push(ChartSegmentRaw {
                        p1_pad: [s.p1_pad[0], s.p1_pad[1], s.p1_pad[2], 0.0],
                        color,
                        ..*s
                    });
                }
            }
        }
        out
    }

    /// GPU style of the parallel layer (defaults for other kinds).
    pub(crate) fn parallel_gpu_style(&self) -> ChartParallelStyleRaw {
        match &self.kind {
            ChartKind::Parallel(p) => p.gpu_style(),
            _ => ChartParallelStyleRaw::default(),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn value_dims(n: usize) -> Vec<ParallelDim> {
        vec![
            ParallelDim {
                min: Some(0.0),
                max: Some(10.0),
                ..Default::default()
            };
            n
        ]
    }

    fn chart(
        dims: &[ParallelDim],
        values: &[f64],
        series: &[u32],
        opts: ParallelOptions,
    ) -> (ChartState, OrbitCamera) {
        validate_parallel(dims, values, series, &opts).unwrap();
        let mut c = ChartState::new_parallel(dims, values, series, opts, ParallelStyle::default());
        c.set_padding([20.0, 20.0, 20.0, 20.0]);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        c.frame_camera(&mut cam, (1600.0, 900.0));
        (c, cam)
    }

    /// CSS -> NDC on the flat chart plane.
    fn ndc(c: &ChartState, cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let v = view(cam);
        let _ = c;
        let (wx, wy) = FlatScreen::of(&v).unwrap().world(x, y);
        let n = cam.project_to_ndc(Vec3::new(wx, wy, 0.0)).unwrap();
        (n.x, n.y)
    }

    fn css_seg(cam: &OrbitCamera, s: &ChartSegmentRaw) -> ((f32, f32), (f32, f32)) {
        let screen = FlatScreen::of(&view(cam)).unwrap();
        (
            screen.css(s.p0_width[0], s.p0_width[1]),
            screen.css(s.p1_pad[0], s.p1_pad[1]),
        )
    }

    fn close(a: (f32, f32), b: (f32, f32)) -> bool {
        (a.0 - b.0).abs() < 0.05 && (a.1 - b.1).abs() < 0.05
    }

    #[test]
    fn input_is_validated() {
        let o = ParallelOptions::default();
        let d2 = value_dims(2);
        assert!(
            validate_parallel(&d2[..1], &[1.0], &[], &o)
                .unwrap_err()
                .contains("2"),
            "one axis"
        );
        assert!(validate_parallel(&d2, &[1.0, 2.0, 3.0], &[], &o)
            .unwrap_err()
            .contains("multiple"));
        assert!(validate_parallel(&d2, &[1.0, f64::INFINITY], &[], &o).is_err());
        assert!(
            validate_parallel(&d2, &[1.0, f64::NAN], &[], &o).is_ok(),
            "NaN = missing"
        );
        let cat = [
            ParallelDim {
                kind: ParallelAxisKind::Category,
                categories: 3,
                ..Default::default()
            },
            d2[0],
        ];
        assert!(validate_parallel(&cat, &[3.0, 1.0], &[], &o)
            .unwrap_err()
            .contains("categor"));
        assert!(
            validate_parallel(&cat, &[1.5, 1.0], &[], &o).is_err(),
            "fractional category"
        );
        assert!(validate_parallel(&cat, &[2.0, 1.0], &[], &o).is_ok());
        let no_cats = [
            ParallelDim {
                kind: ParallelAxisKind::Category,
                ..Default::default()
            },
            d2[0],
        ];
        assert!(validate_parallel(&no_cats, &[0.0, 1.0], &[], &o).is_err());
        let bad = [
            ParallelDim {
                min: Some(5.0),
                max: Some(5.0),
                ..Default::default()
            },
            d2[0],
        ];
        assert!(validate_parallel(&bad, &[1.0, 1.0], &[], &o)
            .unwrap_err()
            .contains("min"));
        assert!(validate_parallel(&d2, &[1.0, 1.0, 2.0, 2.0], &[0], &o)
            .unwrap_err()
            .contains("series"));
        assert!(validate_parallel(&d2, &[1.0, 1.0], &[1], &o)
            .unwrap_err()
            .contains("series"));
        let two = ParallelOptions {
            series_count: 2,
            ..o
        };
        assert!(validate_parallel(&d2, &[1.0, 1.0], &[1], &two).is_ok());
        let col = ParallelOptions {
            color_dim: Some(2),
            ..o
        };
        assert!(validate_parallel(&d2, &[1.0, 1.0], &[], &col)
            .unwrap_err()
            .contains("color"));
    }

    #[test]
    fn rows_become_segments_between_evenly_spaced_axes() {
        let mut dims = value_dims(4);
        dims[3].inverse = true;
        let values = [
            0.0,
            10.0,
            5.0,
            0.0, //
            10.0,
            0.0,
            f64::NAN,
            10.0, //
            5.0,
            5.0,
            5.0,
            5.0,
        ];
        let (mut c, cam) = chart(&dims, &values, &[], ParallelOptions::default());
        let v = view(&cam);
        let segs = c.prepare_layers(&v).parallel.unwrap().to_vec();
        assert_eq!(segs.len(), 3 + 1 + 3, "rows x gaps, NaN breaks the line");
        assert_eq!(c.point_count(), 3);
        // Plot 1560 x 860 at (20, 20): axes at x = 20, 540, 1060, 1580; 0 at the bottom
        let (a, b) = css_seg(&cam, &segs[0]);
        assert!(
            close(a, (20.0, 880.0)) && close(b, (540.0, 20.0)),
            "{a:?} {b:?}"
        );
        assert_eq!(segs[0].p1_pad[3], 0.0);
        // Inverse axis 3: row 0's 0 sits at the top
        assert!(close(css_seg(&cam, &segs[2]).1, (1580.0, 20.0)));
        // Row 1 breaks at its NaN: only gap 0 remains, tagged with row 1
        assert_eq!(segs[3].p1_pad[3], 1.0);
        assert!(close(css_seg(&cam, &segs[3]).1, (540.0, 880.0)));
        assert_eq!(segs[4].p1_pad[3], 2.0);
        // Row colors: series color x opacity, line width
        let s = ParallelStyle::default().series_colors[0];
        assert_eq!(segs[0].color, [s[0], s[1], s[2], s[3] * 0.45]);
        assert_eq!(segs[0].p0_width[3], 1.0);
        // Axes (lines + ticks) in the series layer; the plot is the padded rect
        assert!(c.prepare_layers(&v).series.is_none(), "built once");
        assert_eq!(c.axes().plot_css, [20.0, 20.0, 1560.0, 860.0]);
        assert_eq!(c.parallel_domains().unwrap(), vec![(0.0, 10.0); 4]);
    }

    #[test]
    fn vertical_layout_swaps_the_axes_and_category_axes_spread_evenly() {
        let dims = [
            ParallelDim {
                kind: ParallelAxisKind::Category,
                categories: 3,
                ..Default::default()
            },
            ParallelDim {
                min: Some(0.0),
                max: Some(10.0),
                ..Default::default()
            },
        ];
        let opts = ParallelOptions {
            orient: ParallelOrient::Vertical,
            ..Default::default()
        };
        let (mut c, cam) = chart(&dims, &[0.0, 0.0, 1.0, 10.0, 2.0, 5.0], &[], opts);
        let segs = c.prepare_layers(&view(&cam)).parallel.unwrap().to_vec();
        assert_eq!(segs.len(), 3);
        // Axis 0 at the top (y = 20), axis 1 at the bottom (y = 880); values grow rightward
        assert!(close(css_seg(&cam, &segs[0]).0, (20.0, 20.0)));
        assert!(close(css_seg(&cam, &segs[0]).1, (20.0, 880.0)));
        assert!(
            close(css_seg(&cam, &segs[1]).0, (800.0, 20.0)),
            "middle category"
        );
        assert!(close(css_seg(&cam, &segs[1]).1, (1580.0, 880.0)));
        assert_eq!(c.parallel_domains().unwrap()[0], (0.0, 2.0));
    }

    #[test]
    fn value_and_time_axes_pick_nice_or_data_domains() {
        let dims = [
            ParallelDim::default(),
            ParallelDim {
                kind: ParallelAxisKind::Time,
                ..Default::default()
            },
            ParallelDim {
                min: Some(-5.0),
                ..Default::default()
            },
        ];
        let day = 86_400_000.0;
        let (c, _) = chart(
            &dims,
            &[3.0, 0.0, 1.0, 97.0, 10.0 * day, 7.0],
            &[],
            ParallelOptions::default(),
        );
        let d = c.parallel_domains().unwrap();
        assert_eq!(d[0], (0.0, 100.0), "nice");
        assert_eq!(d[1], (0.0, 10.0 * day), "time: data extent");
        assert_eq!(d[2].0, -5.0);
        assert!(d[2].1 >= 7.0);
    }

    #[test]
    fn brushing_rewrites_only_the_row_flags() {
        let dims = value_dims(3);
        let values = [
            1.0,
            1.0,
            1.0, //
            5.0,
            5.0,
            5.0, //
            9.0,
            9.0,
            f64::NAN, //
            5.0,
            9.0,
            1.0,
        ];
        let (mut c, cam) = chart(&dims, &values, &[], ParallelOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let first = c.prepare_layers(&v);
        assert_eq!(first.parallel_flags.unwrap(), &[1.0; 4]);
        assert_eq!(first.parallel_style.unwrap().params[1], 0.0, "not brushed");
        assert_eq!(c.parallel_active_count(), 4);
        // One interval on axis 0: rows 1 and 3
        assert_eq!(c.set_parallel_brush(&[(0, 4.0, 6.0)], &mut scene), Ok(2));
        let l = c.prepare_layers(&v);
        assert!(l.parallel.is_none(), "geometry stays on the GPU");
        assert_eq!(l.parallel_flags.unwrap(), &[0.0, 1.0, 0.0, 1.0]);
        assert_eq!(l.parallel_style.unwrap().params[1], 1.0);
        assert!(l.series.is_some(), "brush band drawn on the axis");
        // Two intervals on one axis = union; a second axis intersects; reversed ends are fine
        assert_eq!(
            c.set_parallel_brush(&[(0, 6.0, 4.0), (0, 8.0, 10.0), (1, 0.0, 6.0)], &mut scene),
            Ok(1)
        );
        assert_eq!(c.parallel_active_rows(), vec![1]);
        assert_eq!(
            c.parallel_brush(),
            vec![(0, 4.0, 6.0), (0, 8.0, 10.0), (1, 0.0, 6.0)]
        );
        // NaN is outside every interval
        assert_eq!(c.set_parallel_brush(&[(2, 0.0, 10.0)], &mut scene), Ok(3));
        assert_eq!(c.parallel_active_rows(), vec![0, 1, 3]);
        // Invalid input leaves the brush untouched
        assert!(c.set_parallel_brush(&[(3, 0.0, 1.0)], &mut scene).is_err());
        assert!(c
            .set_parallel_brush(&[(0, f64::NAN, 1.0)], &mut scene)
            .is_err());
        assert!(c
            .set_parallel_brush(&vec![(0, 0.0, 1.0); MAX_PARALLEL_INTERVALS + 1], &mut scene)
            .is_err());
        assert_eq!(c.parallel_brush(), vec![(2, 0.0, 10.0)]);
        // Clearing: every row active, single pass again
        assert_eq!(c.set_parallel_brush(&[], &mut scene), Ok(4));
        let l = c.prepare_layers(&v);
        assert!(l.parallel.is_none());
        assert_eq!(l.parallel_flags.unwrap(), &[1.0; 4]);
        assert_eq!(l.parallel_style.unwrap().params[1], 0.0);
    }

    #[test]
    fn hidden_series_rows_are_flagged_and_not_counted() {
        let opts = ParallelOptions {
            series_count: 2,
            ..Default::default()
        };
        let (mut c, cam) = chart(
            &value_dims(2),
            &[1.0, 1.0, 5.0, 5.0, 9.0, 9.0],
            &[0, 1, 1],
            opts,
        );
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.prepare_layers(&v);
        assert_eq!(c.series_count(), 2);
        c.set_series_visible(1, false, &mut scene);
        assert!(!c.series_visible(1));
        let l = c.prepare_layers(&v);
        assert!(l.parallel.is_none());
        assert_eq!(l.parallel_flags.unwrap(), &[1.0, -1.0, -1.0]);
        assert_eq!(c.parallel_active_count(), 1);
        c.set_parallel_brush(&[(0, 0.0, 6.0)], &mut scene).unwrap();
        assert_eq!(
            c.prepare_layers(&v).parallel_flags.unwrap(),
            &[1.0, -1.0, -1.0]
        );
        assert_eq!(c.parallel_active_rows(), vec![0]);
        // Series colors cycle per row series
        let style = ParallelStyle {
            series_colors: vec![[1.0, 0.0, 0.0, 1.0], [0.0, 1.0, 0.0, 1.0]],
            ..Default::default()
        };
        c.set_parallel_style(style);
        let segs = c.prepare_layers(&v).parallel.unwrap().to_vec();
        assert_eq!(segs[0].color, [1.0, 0.0, 0.0, 0.45]);
        assert_eq!(segs[1].color, [0.0, 1.0, 0.0, 0.45]);
    }

    #[test]
    fn hover_picks_the_nearest_active_row_and_highlights_it() {
        // Horizontal rows at 2, 5 and 8 between two axes; row 3 crosses diagonally
        let values = [2.0, 2.0, 5.0, 5.0, 8.0, 8.0, 0.0, 10.0];
        let (mut c, cam) = chart(&value_dims(2), &values, &[], ParallelOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.prepare_layers(&v);
        let y = |val: f32| 880.0 - val / 10.0 * 860.0;
        let hit = c
            .hover_at(&v, &mut scene, ndc(&c, &cam, 400.0, y(5.0) + 3.0))
            .unwrap();
        assert_eq!(
            (
                hit.items[0].index,
                hit.items[0].global_id,
                hit.items[0].value
            ),
            (1, 1, 5.0)
        );
        let overlay = c.prepare_layers(&v).overlay.unwrap().to_vec();
        assert_eq!(overlay.len(), 1, "hovered row redrawn on top");
        assert_eq!(overlay[0].p0_width[3], 3.0);
        assert_eq!(overlay[0].color[3], 1.0);
        // Far from every line
        assert!(c
            .hover_at(&v, &mut scene, ndc(&c, &cam, 400.0, y(3.5)))
            .is_none());
        assert_eq!(c.prepare_layers(&v).overlay.unwrap().len(), 0);
        // The diagonal row at its midpoint (perpendicular distance, not vertical)
        assert_eq!(
            c.hover_at(&v, &mut scene, ndc(&c, &cam, 800.0, y(5.0) - 0.5))
                .unwrap()
                .items[0]
                .index,
            3,
            "the diagonal is nearer perpendicularly"
        );
        assert_eq!(
            c.hover_at(
                &v,
                &mut scene,
                ndc(&c, &cam, 600.0, y(10.0 * 580.0 / 1560.0))
            )
            .unwrap()
            .items[0]
                .index,
            3
        );
        // Outside the axes span
        assert!(c
            .hover_at(&v, &mut scene, ndc(&c, &cam, 2.0, y(5.0)))
            .is_none());
        // Brushed-out rows do not hover; brushing drops a hover on them
        c.hover_at(&v, &mut scene, ndc(&c, &cam, 400.0, y(5.0)))
            .unwrap();
        c.set_parallel_brush(&[(0, 7.0, 9.0)], &mut scene).unwrap();
        assert!(c.hover.is_none());
        assert_eq!(
            c.hover_at(&v, &mut scene, ndc(&c, &cam, 400.0, y(5.0) + 2.0))
                .map(|h| h.items[0].index),
            None
        );
        assert_eq!(
            c.hover_at(&v, &mut scene, ndc(&c, &cam, 400.0, y(8.0)))
                .unwrap()
                .items[0]
                .index,
            2
        );
        // Sample: the row's point on axis 0
        let (series, row, value, p) = c.sample(2).unwrap();
        assert_eq!((series, row, value), (0, 2, 8.0));
        let css = view(&cam).project_css(p).unwrap();
        assert!(close(css, (20.0, y(8.0))), "{css:?}");
    }

    #[test]
    fn axis_hits_map_the_pointer_to_data_values() {
        let mut dims = value_dims(3);
        dims[1].inverse = true;
        let (mut c, cam) = chart(&dims, &[1.0, 1.0, 1.0], &[], ParallelOptions::default());
        let v = view(&cam);
        c.prepare_layers(&v);
        let (axis, value) = c
            .parallel_axis_hit(&v, ndc(&c, &cam, 803.0, 450.0))
            .unwrap();
        assert_eq!(axis, 1);
        assert!((value - 5.0).abs() < 0.02, "{value}");
        let (axis, value) = c
            .parallel_axis_hit(&v, ndc(&c, &cam, 20.0, 880.0 - 86.0))
            .unwrap();
        assert_eq!(axis, 0);
        assert!((value - 1.0).abs() < 0.02);
        assert!(c
            .parallel_axis_hit(&v, ndc(&c, &cam, 400.0, 450.0))
            .is_none());
        // Drags continue past the ends: clamped to the domain; inverse: top = min
        assert_eq!(
            c.parallel_value_at(1, &v, ndc(&c, &cam, 0.0, 0.0)),
            Some(0.0)
        );
        assert_eq!(
            c.parallel_value_at(2, &v, ndc(&c, &cam, 0.0, 0.0)),
            Some(10.0)
        );
        assert_eq!(c.parallel_value_at(3, &v, ndc(&c, &cam, 0.0, 0.0)), None);
    }

    #[test]
    fn labels_anchor_ticks_and_axis_names() {
        let dims = [
            ParallelDim {
                min: Some(0.0),
                max: Some(10.0),
                ..Default::default()
            },
            ParallelDim {
                kind: ParallelAxisKind::Category,
                categories: 3,
                ..Default::default()
            },
        ];
        let (mut c, cam) = chart(&dims, &[1.0, 2.0], &[], ParallelOptions::default());
        c.prepare_layers(&view(&cam));
        let (labels, rev) = c.parallel_labels().unwrap();
        let ticks: Vec<_> = labels
            .iter()
            .filter(|l| l.kind == 0 && l.axis == 0)
            .collect();
        assert_eq!(
            ticks.iter().map(|l| l.value).collect::<Vec<_>>(),
            vec![0.0, 2.0, 4.0, 6.0, 8.0, 10.0]
        );
        assert_eq!((ticks[0].h_align, ticks[0].v_align), (-1, 0));
        assert!(ticks[0].x_css < 20.0 && (ticks[0].y_css - 880.0).abs() < 0.01);
        let cats: Vec<_> = labels
            .iter()
            .filter(|l| l.kind == 0 && l.axis == 1)
            .map(|l| l.value)
            .collect();
        assert_eq!(cats, vec![0.0, 1.0, 2.0]);
        let names: Vec<_> = labels.iter().filter(|l| l.kind == 1).collect();
        assert_eq!(names.len(), 2);
        assert!(
            (names[1].x_css - 1580.0).abs() < 0.01
                && names[1].y_css < 20.0
                && names[1].v_align == -1
        );
        // Same frame: same revision; resize: new anchors
        c.prepare_layers(&view(&cam));
        assert_eq!(c.parallel_labels().unwrap().1, rev);
        let v2 = ChartView {
            camera: &cam,
            viewport_px: (1200, 900),
            pixel_ratio: 1.0,
        };
        c.prepare_layers(&v2);
        assert_ne!(c.parallel_labels().unwrap().1, rev);
    }

    #[test]
    fn rows_can_be_colored_by_a_dimension_through_the_colormap() {
        let opts = ParallelOptions {
            color_dim: Some(1),
            opacity: 1.0,
            ..Default::default()
        };
        let (mut c, cam) = chart(&value_dims(2), &[0.0, 0.0, 0.0, 10.0], &[], opts);
        let v = view(&cam);
        let segs = c.prepare_layers(&v).parallel.unwrap().to_vec();
        let lut = c.heatmap_lut().unwrap().to_vec();
        let rgba = |k: usize| lut[k].map(|v| v as f32 / 255.0);
        assert_eq!(segs[0].color, rgba(0));
        assert_eq!(segs[1].color, rgba(lut.len() - 1));
        let bar = c.heatmap_colorbar().unwrap();
        assert_eq!((bar.scale.lo, bar.scale.hi), (0.0, 10.0));
        c.set_heatmap_domain(HeatmapDomain {
            max: Some(20.0),
            ..Default::default()
        });
        let segs = c.prepare_layers(&v).parallel.unwrap().to_vec();
        assert_ne!(segs[1].color, rgba(lut.len() - 1), "domain re-colors");
        // Series-colored charts have no colorbar
        let (s, _) = chart(&value_dims(2), &[0.0, 0.0], &[], ParallelOptions::default());
        assert!(s.heatmap_colorbar().is_none());
    }

    #[test]
    fn smooth_lines_subdivide_within_the_segment_budget() {
        let opts = ParallelOptions {
            smooth: true,
            ..Default::default()
        };
        let (mut c, cam) = chart(&value_dims(3), &[0.0, 10.0, 0.0], &[], opts);
        let segs = c.prepare_layers(&view(&cam)).parallel.unwrap().to_vec();
        assert_eq!(segs.len(), 2 * SMOOTH_STEPS);
        // Continuous, flat at the axes (smoothstep), ends on the axes
        for w in segs.windows(2) {
            assert!(close(css_seg(&cam, &w[0]).1, css_seg(&cam, &w[1]).0));
        }
        let (a, b) = css_seg(&cam, &segs[0]);
        assert!(close(a, (20.0, 880.0)));
        assert!((b.1 - 880.0).abs() < 0.1 * 860.0 && (b.1 - 880.0).abs() > 0.0);
        assert!(close(
            css_seg(&cam, &segs[SMOOTH_STEPS - 1]).1,
            (800.0, 20.0)
        ));
    }

    #[test]
    fn the_enter_animation_fades_the_layer_without_nan() {
        let (mut c, cam) = chart(&value_dims(2), &[1.0, 2.0], &[], ParallelOptions::default());
        c.arm_animation(AnimationOptions::new(100.0, Easing::Linear), None);
        let v = view(&cam);
        c.animation_tick(0.0);
        c.prepare_layers(&v);
        c.animation_tick(50.0);
        let mid = c
            .prepare_layers(&v)
            .parallel_style
            .expect("fade re-uploads the uniform");
        assert!(
            mid.params[3].is_finite() && mid.params[3] > 0.2 && mid.params[3] < 0.8,
            "{mid:?}"
        );
        assert!(
            c.prepare_layers(&v).parallel_style.is_none(),
            "unchanged frame"
        );
        c.animation_tick(200.0);
        let end = c.prepare_layers(&v).parallel_style.unwrap();
        assert_eq!(end.params[3], 1.0);
    }

    #[test]
    fn svg_export_draws_inactive_rows_beneath_active_ones() {
        let (mut c, cam) = chart(
            &value_dims(2),
            &[1.0, 1.0, 9.0, 9.0],
            &[],
            ParallelOptions::default(),
        );
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.set_parallel_brush(&[(0, 8.0, 10.0)], &mut scene).unwrap();
        c.prepare_layers(&v);
        assert_eq!(c.svg_support(), SvgSupport::Vector);
        let segs = c.parallel_svg_segments();
        assert_eq!(segs.len(), 2);
        assert!(segs[0].color[3] < segs[1].color[3], "dimmed first");
        assert!(
            segs.iter().all(|s| s.p1_pad[3] == 0.0),
            "no row tags (solid strokes)"
        );
        let svg = c.export_svg(&v, 0, "p").markup;
        let (lines, axes) = (
            svg.find("data-layer=\"parallel\"").unwrap(),
            svg.find("data-layer=\"series\"").unwrap(),
        );
        assert!(lines < axes, "axes over the lines");
    }

    #[test]
    fn keyboard_focus_hovers_a_row_by_index() {
        let opts = ParallelOptions {
            series_count: 2,
            ..Default::default()
        };
        let (mut c, cam) = chart(&value_dims(2), &[1.0, 2.0, 5.0, 6.0, 9.0, 8.0], &[0, 1, 1], opts);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.prepare_layers(&v);
        let hit = c.hover_parallel_row(2, &mut scene).unwrap();
        assert_eq!((hit.items[0].series, hit.items[0].index, hit.items[0].global_id, hit.items[0].value), (1, 2, 2, 9.0));
        assert_eq!(c.prepare_layers(&v).overlay.unwrap().len(), 1, "focused row highlighted");
        // Brushed-out rows still take the keyboard focus; hidden rows and bad indices do not
        c.set_parallel_brush(&[(0, 0.0, 3.0)], &mut scene).unwrap();
        assert!(c.hover_parallel_row(1, &mut scene).is_some());
        c.set_series_visible(1, false, &mut scene);
        assert!(c.hover_parallel_row(1, &mut scene).is_none());
        assert!(c.hover.is_none(), "a refused focus clears the hover");
        assert!(c.hover_parallel_row(7, &mut scene).is_none());
        assert!(ChartState::new_calendar(&[0.0, 6.0], &[], &[], CalendarOptions::default())
            .hover_parallel_row(0, &mut scene)
            .is_none());
    }

    #[test]
    fn replacing_the_chart_clears_the_parallel_layer() {
        let layers = empty_chart_layers();
        assert_eq!(layers.parallel.unwrap().len(), 0);
        assert_eq!(layers.parallel_flags.unwrap().len(), 0);
        let mut c = ChartState::new_calendar(&[0.0, 6.0], &[], &[], CalendarOptions::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        c.frame_camera(&mut cam, (1600.0, 900.0));
        assert_eq!(
            c.prepare_layers(&view(&cam)).parallel.unwrap().len(),
            0,
            "other kinds clear it once"
        );
        assert!(c.prepare_layers(&view(&cam)).parallel.is_none());
    }

    /// `cargo test -p charturbo-core --release parallel_perf -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn parallel_perf_100k_rows_8_dims() {
        let (rows, n) = (100_000usize, 8usize);
        let mut values = Vec::with_capacity(rows * n);
        let mut s = 12345u64;
        for _ in 0..rows * n {
            s = s
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            values.push((s >> 33) as f64 / (1u64 << 31) as f64 * 100.0);
        }
        let dims = vec![ParallelDim::default(); n];
        let t = std::time::Instant::now();
        let (mut c, cam) = chart(&dims, &values, &[], ParallelOptions::default());
        let v = view(&cam);
        let segs = c.prepare_layers(&v).parallel.unwrap().len();
        let build = t.elapsed();
        let mut scene = SceneWorld::new();
        let t = std::time::Instant::now();
        let active = c
            .set_parallel_brush(&[(0, 20.0, 60.0), (3, 10.0, 90.0)], &mut scene)
            .unwrap();
        let bytes = c.prepare_layers(&v).parallel_flags.unwrap().len() * 4;
        let brush = t.elapsed();
        let t = std::time::Instant::now();
        c.hover_at(&v, &mut scene, ndc(&c, &cam, 300.0, 450.0));
        let hover = t.elapsed();
        println!("parallel 100k x 8: {segs} segments, build {build:?}, brush {brush:?} ({active} active, {bytes} B flags), hover {hover:?}");
        assert_eq!(segs, rows * (n - 1));
    }
}
