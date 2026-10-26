//! Box plot / violin chart: one distribution per (series, category) group.
//!
//! Statistics run in O(n) per group without sorting: quartiles by selection (numpy's linear
//! interpolation, shared with the histogram), whisker ends / outliers in one more pass, and the
//! violin density by a binned Gaussian KDE (linear binning onto a fine grid, then a truncated
//! kernel sum per output point: O(n + grid), never O(n x grid)). Raw samples are not kept: only
//! the stats, a capped deterministic sample of the outliers, and 128 density values per group.
//!
//! Marks: boxes are two 2D bars split at the median (rounded ends, the median drawn as a 2px
//! surface-color gap), whiskers / caps / outline strokes are segments, outliers and mean
//! markers are instanced points; violins are mirrored fill bands with an outline stroke and an
//! optional inner box. Groups of several series sit side by side like grouped bars.

use super::histogram::quantile;
use super::line::DIMMED_SERIES_ALPHA;
use super::*;
use crate::renderer::{ChartPointStyleRaw, MAX_POINT_SERIES};

/// Density values evaluated per violin (equally spaced over the group's data range).
pub const KDE_POINTS: usize = 128;
/// Fine binning grid = `(KDE_POINTS - 1) * KDE_OVERSAMPLE + 1` points (keeps narrow kernels
/// smooth between output points).
const KDE_OVERSAMPLE: usize = 4;
/// Kernel truncation in bandwidths (the Gaussian beyond 4 sigma is < 0.04% of its peak).
const KDE_CUTOFF: f64 = 4.0;
/// Default cap of drawn outliers per group (the count is always exact).
pub const DEFAULT_MAX_OUTLIERS: usize = 10_000;
/// Boxes behind the strokes and points (bars write depth; strokes / points only test it).
const BOX_Z: f32 = -0.02;
const FILL_Z: f32 = -0.01;
const STROKE_Z: f32 = 0.01;
/// One category label per this many CSS px.
const LABEL_SPACING_PX: f32 = 88.0;
/// Inner box of a violin: IQR bar width and median dot radius (CSS px).
const VIOLIN_IQR_PX: f32 = 5.0;
const VIOLIN_MEDIAN_PX: f32 = 2.5;
/// Mean marker: outer dot in the series color, inner dot in the surface color (CSS px).
const MEAN_OUTER_PX: f32 = 4.0;
const MEAN_INNER_PX: f32 = 2.0;
/// Median stroke width (CSS px).
const MEDIAN_PX: f32 = 2.0;

/// Where the whiskers end; data beyond them are outliers.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum WhiskerRule {
    /// Most extreme data within `k` IQR of the quartiles (Tukey: `k` = 1.5)
    Tukey(f64),
    /// Data min / max (no outliers)
    MinMax,
    /// Quantiles `(p0, p1)` in `[0, 1]` (e.g. 0.05 / 0.95)
    Percentile(f64, f64),
}

impl Default for WhiskerRule {
    fn default() -> Self {
        Self::Tukey(1.5)
    }
}

/// Summary statistics of one group (finite samples only).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoxStats {
    pub n: usize,
    pub min: f64,
    pub max: f64,
    pub q1: f64,
    pub median: f64,
    pub q3: f64,
    pub mean: f64,
    /// Sample standard deviation (ddof = 1; 0 for a single sample)
    pub std: f64,
    pub whisker_lo: f64,
    pub whisker_hi: f64,
    /// Samples beyond the whiskers (exact count; at most `max_outliers` are drawn)
    pub outliers: usize,
}

/// How violins of different groups are scaled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ViolinScale {
    /// One density scale for every group (each violin encloses the same area)
    #[default]
    Area,
    /// Each violin reaches the full width at its own density peak
    Width,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ViolinOptions {
    /// Gaussian kernel bandwidth in data units (`None` = Silverman's rule per group)
    pub bandwidth: Option<f64>,
    /// Inner box: whisker line, IQR bar, median dot (else a median line across the violin)
    pub show_box: bool,
    pub scale: ViolinScale,
    pub fill_opacity: f32,
}

impl Default for ViolinOptions {
    fn default() -> Self {
        Self { bandwidth: None, show_box: true, scale: ViolinScale::Area, fill_opacity: 0.3 }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoxPlotOptions {
    pub whiskers: WhiskerRule,
    /// Draw outliers as points (box mode only; violins span the full data range)
    pub show_outliers: bool,
    /// Mean marker (hollow dot)
    pub show_mean: bool,
    /// Boxes as strokes instead of filled bars
    pub outline: bool,
    /// Drawn outliers per group; more are sampled deterministically (extremes kept)
    pub max_outliers: usize,
    /// Violins instead of boxes
    pub violin: Option<ViolinOptions>,
}

impl Default for BoxPlotOptions {
    fn default() -> Self {
        Self {
            whiskers: WhiskerRule::default(),
            show_outliers: true,
            show_mean: false,
            outline: false,
            max_outliers: DEFAULT_MAX_OUTLIERS,
            violin: None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BoxLayout {
    /// World size of the plot
    pub width: f32,
    pub height: f32,
    /// Empty fraction of each category slot between groups
    pub group_gap: f32,
    /// CSS px surface gap between adjacent boxes of a group
    pub gap_px: f32,
    pub corner_radius_px: f32,
    /// Whisker / outline stroke width (CSS px)
    pub whisker_px: f32,
    pub outlier_radius_px: f32,
}

impl Default for BoxLayout {
    fn default() -> Self {
        Self {
            width: 164.0,
            height: 80.0,
            group_gap: 0.3,
            gap_px: 2.0,
            corner_radius_px: 4.0,
            whisker_px: 1.5,
            outlier_radius_px: 3.0,
        }
    }
}

/// Rejects group offsets that do not describe `series * categories` groups over `len` values.
pub fn validate_box_plot(series: usize, categories: usize, offsets: &[usize], len: usize) -> Result<(), String> {
    if series == 0 || categories == 0 {
        return Err("box plot needs at least one series and one category".into());
    }
    let groups = series.checked_mul(categories).ok_or("box plot group count overflows")?;
    if offsets.len() != groups + 1 {
        return Err(format!("box plot needs {} group offsets, got {}", groups + 1, offsets.len()));
    }
    if offsets[0] != 0 || offsets.windows(2).any(|w| w[1] < w[0]) || offsets[groups] != len {
        return Err(format!("box plot offsets must rise from 0 to the value count {len}"));
    }
    Ok(())
}

/// Statistics of `values` (non-finite samples ignored) under `rule`; `None` without finite
/// samples. `scratch` receives the finite samples (reordered). O(n): one copy pass, three to five
/// selections, one whisker / outlier pass, one variance pass.
pub fn compute_box_stats(values: &[f32], rule: WhiskerRule, scratch: &mut Vec<f32>) -> Option<BoxStats> {
    scratch.clear();
    let (mut min, mut max, mut sum) = (f32::INFINITY, f32::NEG_INFINITY, 0.0f64);
    for &v in values {
        if v.is_finite() {
            scratch.push(v);
            min = min.min(v);
            max = max.max(v);
            sum += v as f64;
        }
    }
    let n = scratch.len();
    if n == 0 {
        return None;
    }
    let mean = sum / n as f64;
    let q1 = quantile(scratch, 0.25);
    let median = quantile(scratch, 0.5);
    let q3 = quantile(scratch, 0.75);
    let (min, max) = (min as f64, max as f64);
    let (whisker_lo, whisker_hi, fences) = match rule {
        WhiskerRule::MinMax => (min, max, None),
        WhiskerRule::Tukey(k) => {
            let k = if k.is_finite() && k >= 0.0 { k } else { 1.5 };
            let iqr = q3 - q1;
            let (f0, f1) = (q1 - k * iqr, q3 + k * iqr);
            // Most extreme samples inside the fences
            let (lo, hi) = scratch.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), &v| {
                let v = v as f64;
                let inside = v >= f0 && v <= f1;
                (if inside && v < lo { v } else { lo }, if inside && v > hi { v } else { hi })
            });
            // No sample inside fences narrower than the gaps (k < 0.5): fall back to the quartiles
            let (lo, hi) = (if lo.is_finite() { lo } else { q1 }, if hi.is_finite() { hi } else { q3 });
            (lo, hi, Some((f0, f1)))
        }
        WhiskerRule::Percentile(p0, p1) => {
            let clamp = |p: f64| if p.is_finite() { p.clamp(0.0, 1.0) } else { 0.0 };
            let (p0, p1) = (clamp(p0).min(clamp(p1)), clamp(p0).max(clamp(p1)));
            let (lo, hi) = (quantile(scratch, p0), quantile(scratch, p1));
            (lo, hi, Some((lo, hi)))
        }
    };
    let mut outliers = 0usize;
    let mut sq = 0.0f64;
    for &v in scratch.iter() {
        let v = v as f64;
        sq += (v - mean) * (v - mean);
        if fences.is_some_and(|(f0, f1)| v < f0 || v > f1) {
            outliers += 1;
        }
    }
    let std = if n > 1 { (sq / (n - 1) as f64).sqrt() } else { 0.0 };
    Some(BoxStats { n, min, max, q1, median, q3, mean, std, whisker_lo, whisker_hi, outliers })
}

/// Appends the outliers of `values` (beyond the whiskers of `st`), sorted ascending. More than
/// `cap` are thinned to `cap` by an even stride over data order; the global min / max are kept.
fn collect_outliers(values: &[f32], st: &BoxStats, cap: usize, out: &mut Vec<f32>) {
    if st.outliers == 0 || cap == 0 {
        return;
    }
    let start = out.len();
    let (lo, hi) = (st.whisker_lo, st.whisker_hi);
    let outside = |v: f32| v.is_finite() && ((v as f64) < lo || (v as f64) > hi);
    let (total, cap) = (st.outliers as u64, cap.min(st.outliers) as u64);
    let mut j = 0u64;
    for &v in values {
        if !outside(v) {
            continue;
        }
        // Keep outlier j when the stride position crosses an integer: exactly `cap` are kept
        if total == cap || (j + 1) * cap / total > j * cap / total {
            out.push(v);
        }
        j += 1;
    }
    let kept = &mut out[start..];
    kept.sort_unstable_by(f32::total_cmp);
    if let (Some(first), true) = (kept.first_mut(), st.min < lo) {
        *first = st.min as f32;
    }
    if let (Some(last), true) = (kept.last_mut(), st.max > hi) {
        *last = st.max as f32;
    }
}

/// Silverman's rule of thumb `0.9 min(std, IQR / 1.34) n^(-1/5)` (std alone when the IQR is 0).
pub fn silverman_bandwidth(n: usize, std: f64, iqr: f64) -> f64 {
    let spread = if iqr > 0.0 { std.min(iqr / 1.34) } else { std };
    0.9 * spread * (n.max(1) as f64).powf(-0.2)
}

/// Gaussian KDE of `values` (finite samples in `[lo, hi]`) evaluated at `points` equally spaced
/// positions over `[lo, hi]`, normalized to integrate to 1 over the real line. Linear binning
/// onto a fine grid (O(n)), then a kernel sum truncated at 4 bandwidths per output point
/// (O(points x kernel width)). Bandwidths below the fine grid step are widened to it.
pub fn kde_binned(values: &[f32], lo: f64, hi: f64, bandwidth: f64, points: usize) -> Vec<f32> {
    let points = points.max(2);
    if hi.partial_cmp(&lo) != Some(std::cmp::Ordering::Greater) || bandwidth.is_nan() || bandwidth <= 0.0 || !lo.is_finite() || !hi.is_finite() {
        return vec![0.0; points];
    }
    let fine = (points - 1) * KDE_OVERSAMPLE + 1;
    let step = (hi - lo) / (fine - 1) as f64;
    let mut bins = vec![0.0f64; fine];
    let mut n = 0usize;
    for &v in values {
        let v = v as f64;
        if !v.is_finite() || v < lo || v > hi {
            continue;
        }
        let pos = (v - lo) / step;
        let k = (pos.floor() as usize).min(fine - 2);
        let frac = pos - k as f64;
        bins[k] += 1.0 - frac;
        bins[k + 1] += frac;
        n += 1;
    }
    if n == 0 {
        return vec![0.0; points];
    }
    let h = bandwidth.max(step);
    let reach = ((KDE_CUTOFF * h / step).ceil() as usize).min(fine - 1);
    let kernel: Vec<f64> = (0..=reach).map(|d| (-0.5 * (d as f64 * step / h).powi(2)).exp()).collect();
    let norm = 1.0 / (n as f64 * h * (2.0 * std::f64::consts::PI).sqrt());
    (0..points)
        .map(|j| {
            let c = j * KDE_OVERSAMPLE;
            let (a, b) = (c.saturating_sub(reach), (c + reach).min(fine - 1));
            let sum: f64 = (a..=b).map(|m| bins[m] * kernel[m.abs_diff(c)]).sum();
            (sum * norm) as f32
        })
        .collect()
}

#[derive(Debug, Clone, Default)]
struct BoxGroup {
    stats: Option<BoxStats>,
    /// Range of this group in `BoxChart::kde` (empty without a violin)
    kde: std::ops::Range<usize>,
    /// Peak of the group's density
    kde_max: f32,
    /// Kernel bandwidth used (0 without a violin)
    bandwidth: f64,
}

#[derive(Debug, Clone)]
pub(crate) struct BoxChart {
    pub(crate) series_count: usize,
    pub(crate) categories: usize,
    /// One color per series
    colors: Vec<[f32; 4]>,
    layout: BoxLayout,
    opts: BoxPlotOptions,
    /// `[s * categories + i]`
    groups: Vec<BoxGroup>,
    /// Largest KDE peak of all groups (`ViolinScale::Area`), cached: marks are rebuilt per hover
    kde_peak: f32,
    /// Drawn outliers, sorted per group; group `g` owns `outlier_offsets[g]..outlier_offsets[g + 1]`
    outliers: Vec<f32>,
    outlier_offsets: Vec<usize>,
    kde: Vec<f32>,
    pub(crate) visible: Vec<bool>,
    pub(crate) emphasis: Option<usize>,
    spacing: f32,
    group_width: f32,
    bottom: f32,
    /// World units per value unit
    scale: f32,
    v_min: f64,
    v_max: f64,
    v_step: f64,
}

impl BoxChart {
    /// `values[offsets[g]..offsets[g + 1]]` = samples of group `g = s * categories + i` (see
    /// `validate_box_plot`); `colors` one per series.
    pub(crate) fn new(
        values: &[f32],
        offsets: &[usize],
        series_count: usize,
        categories: usize,
        colors: Vec<[f32; 4]>,
        layout: BoxLayout,
        opts: BoxPlotOptions,
    ) -> Self {
        let (s_count, n) = (series_count.max(1), categories.max(1));
        let count = s_count * n;
        let mut groups = vec![BoxGroup::default(); count];
        let mut outliers = Vec::new();
        let mut outlier_offsets = Vec::with_capacity(count + 1);
        let mut kde = Vec::new();
        let mut scratch = Vec::new();
        outlier_offsets.push(0);
        for (g, group) in groups.iter_mut().enumerate() {
            let vals = match (offsets.get(g), offsets.get(g + 1)) {
                (Some(&a), Some(&b)) if a <= b && b <= values.len() => &values[a..b],
                _ => &[],
            };
            group.stats = compute_box_stats(vals, opts.whiskers, &mut scratch);
            if let Some(st) = &group.stats {
                if opts.violin.is_none() && opts.show_outliers {
                    collect_outliers(vals, st, opts.max_outliers, &mut outliers);
                }
                if let Some(v) = &opts.violin {
                    let h = v
                        .bandwidth
                        .filter(|h| h.is_finite() && *h > 0.0)
                        .unwrap_or_else(|| silverman_bandwidth(st.n, st.std, st.q3 - st.q1));
                    if st.max > st.min && h > 0.0 {
                        let d = kde_binned(vals, st.min, st.max, h, KDE_POINTS);
                        group.kde_max = d.iter().copied().fold(0.0, f32::max);
                        group.kde = kde.len()..kde.len() + d.len();
                        group.bandwidth = h;
                        kde.extend(d);
                    }
                }
            }
            outlier_offsets.push(outliers.len());
        }

        // Value domain over everything drawn (every series, so toggling never rescales)
        let (lo, hi) = groups.iter().enumerate().fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), (g, gr)| {
            let Some(st) = &gr.stats else { return (lo, hi) };
            let (mut a, mut b) = if opts.violin.is_some() {
                (st.min, st.max)
            } else {
                // Percentile whiskers may sit inside the box
                (st.whisker_lo.min(st.q1), st.whisker_hi.max(st.q3))
            };
            let drawn = &outliers[outlier_offsets[g]..outlier_offsets[g + 1]];
            if let (Some(&o0), Some(&o1)) = (drawn.first(), drawn.last()) {
                (a, b) = (a.min(o0 as f64), b.max(o1 as f64));
            }
            if opts.show_mean {
                (a, b) = (a.min(st.mean), b.max(st.mean));
            }
            (lo.min(a), hi.max(b))
        });
        let (lo, hi) = if lo <= hi { (lo, hi) } else { (0.0, 1.0) };
        let (v_min, v_max, v_step) = nice_domain(lo, hi, ChartFrameStyle::default().grid_rows);
        let width = if layout.width.is_finite() && layout.width > 0.0 { layout.width } else { 164.0 };
        let height = if layout.height.is_finite() && layout.height > 0.0 { layout.height } else { 80.0 };
        let layout = BoxLayout { width, height, ..layout };
        let spacing = width / n as f32;
        let group_gap = if layout.group_gap.is_finite() { layout.group_gap.clamp(0.0, 0.95) } else { 0.3 };
        Self {
            series_count: s_count,
            categories: n,
            colors,
            layout,
            opts,
            kde_peak: groups.iter().map(|gr| gr.kde_max).fold(0.0, f32::max),
            groups,
            outliers,
            outlier_offsets,
            kde,
            visible: vec![true; s_count],
            emphasis: None,
            spacing,
            group_width: (spacing * (1.0 - group_gap)).max(1e-3),
            bottom: -height * 0.5,
            scale: (height as f64 / (v_max - v_min).max(1e-12)) as f32,
            v_min,
            v_max,
            v_step,
        }
    }

    pub(crate) fn stats(&self, g: usize) -> Option<BoxStats> {
        self.groups.get(g)?.stats
    }

    /// `(lo, hi, bandwidth, density)` of a group's violin.
    pub(crate) fn kde(&self, g: usize) -> Option<(f64, f64, f64, &[f32])> {
        let gr = self.groups.get(g)?;
        let st = gr.stats?;
        (!gr.kde.is_empty()).then(|| (st.min, st.max, gr.bandwidth, &self.kde[gr.kde.clone()]))
    }

    /// Drawn (sampled) outliers of a group, ascending.
    pub(crate) fn group_outliers(&self, g: usize) -> &[f32] {
        match (self.outlier_offsets.get(g), self.outlier_offsets.get(g + 1)) {
            (Some(&a), Some(&b)) => &self.outliers[a..b],
            _ => &[],
        }
    }

    pub(crate) fn domain(&self) -> (f64, f64, f64) {
        (self.v_min, self.v_max, self.v_step)
    }

    /// Finite samples over every group.
    pub(crate) fn sample_count(&self) -> usize {
        self.groups.iter().filter_map(|g| g.stats).map(|s| s.n).sum()
    }

    fn y_of(&self, v: f64) -> f32 {
        self.bottom + ((v - self.v_min) as f32) * self.scale
    }

    fn v_of(&self, y: f32) -> f64 {
        self.v_min + ((y - self.bottom) / self.scale) as f64
    }

    fn slot_x(&self, i: usize) -> f32 {
        (i as f32 - (self.categories as f32 - 1.0) * 0.5) * self.spacing
    }

    fn visible_series(&self) -> Vec<usize> {
        (0..self.series_count).filter(|&s| self.visible[s]).collect()
    }

    /// Center x and sub-slot width of group `g` (`None` when its series is hidden).
    fn place(&self, g: usize, vis: &[usize]) -> Option<(f32, f32)> {
        let (s, i) = (g / self.categories, g % self.categories);
        let j = vis.iter().position(|&v| v == s)?;
        let sub = self.group_width / vis.len() as f32;
        Some((self.slot_x(i) - self.group_width * 0.5 + (j as f32 + 0.5) * sub, sub))
    }

    fn base_color(&self, g: usize) -> [f32; 4] {
        let s = g / self.categories;
        let mut c = self
            .colors
            .get(s)
            .or_else(|| self.colors.last())
            .copied()
            .unwrap_or([0.224, 0.529, 0.898, 1.0]);
        if self.emphasis.is_some_and(|e| e != s) {
            c[3] *= DIMMED_SERIES_ALPHA;
        }
        c
    }

    fn mark_color(&self, g: usize, hovered: Option<usize>, style: &ChartHoverStyle) -> [f32; 4] {
        let c = self.base_color(g);
        if hovered == Some(g) {
            let mut h = style.bar_highlight_color.unwrap_or_else(|| lighten(c, 0.22));
            h[3] = h[3].min(c[3]);
            return h;
        }
        c
    }

    /// Shows / hides a series (groups re-share their slot); returns whether anything changed.
    pub(crate) fn set_visible(&mut self, series: usize, visible: bool) -> bool {
        match self.visible.get_mut(series) {
            Some(v) if *v != visible => {
                *v = visible;
                true
            }
            _ => false,
        }
    }

    /// Boxes (bars), violin bands (fills) and strokes (whiskers, medians, outlines).
    pub(crate) fn build_marks(
        &self,
        hovered: Option<usize>,
        surface: [f32; 4],
        style: &ChartHoverStyle,
        bars: &mut Vec<ChartBarRaw>,
        fills: &mut Vec<ChartFillRaw>,
        strokes: &mut Vec<ChartSegmentRaw>,
    ) {
        bars.clear();
        fills.clear();
        strokes.clear();
        let vis = self.visible_series();
        if vis.is_empty() {
            return;
        }
        let side_gap = if vis.len() > 1 { -self.layout.gap_px.max(0.0) } else { 0.0 };
        let wpx = self.layout.whisker_px.max(0.25);
        let seg = |a: (f32, f32), b: (f32, f32), w: f32, color: [f32; 4]| ChartSegmentRaw {
            p0_width: [a.0, a.1, STROKE_Z, w],
            p1_pad: [b.0, b.1, STROKE_Z, 0.0],
            color,
        };
        for (g, gr) in self.groups.iter().enumerate() {
            let (Some(st), Some((cx, sub))) = (gr.stats, self.place(g, &vis)) else { continue };
            let color = self.mark_color(g, hovered, style);
            let (y_lo, y_q1, y_med, y_q3, y_hi) =
                (self.y_of(st.whisker_lo), self.y_of(st.q1), self.y_of(st.median), self.y_of(st.q3), self.y_of(st.whisker_hi));
            if let Some(v) = &self.opts.violin {
                self.violin_marks(g, cx, sub, color, v, surface, fills, strokes);
                if v.show_box {
                    strokes.push(seg((cx, y_lo), (cx, y_hi), wpx, color));
                    if y_q3 > y_q1 {
                        strokes.push(seg((cx, y_q1), (cx, y_q3), VIOLIN_IQR_PX, color));
                    }
                } else {
                    let hw = self.violin_half_width(g, sub, st.median);
                    strokes.push(seg((cx - hw, y_med), (cx + hw, y_med), MEDIAN_PX, color));
                }
                continue;
            }
            let hw = sub * 0.5;
            // Whiskers with caps at half the box width
            let cap = hw * 0.5;
            if y_q1 > y_lo {
                strokes.push(seg((cx, y_lo), (cx, y_q1), wpx, color));
            }
            if y_hi > y_q3 {
                strokes.push(seg((cx, y_q3), (cx, y_hi), wpx, color));
            }
            strokes.push(seg((cx - cap, y_lo), (cx + cap, y_lo), wpx, color));
            strokes.push(seg((cx - cap, y_hi), (cx + cap, y_hi), wpx, color));
            let degenerate = y_q3 <= y_q1;
            if self.opts.outline {
                let (x0, x1) = (cx - hw, cx + hw);
                if !degenerate {
                    strokes.push(seg((x0, y_q1), (x1, y_q1), wpx, color));
                    strokes.push(seg((x0, y_q3), (x1, y_q3), wpx, color));
                    strokes.push(seg((x0, y_q1), (x0, y_q3), wpx, color));
                    strokes.push(seg((x1, y_q1), (x1, y_q3), wpx, color));
                }
                strokes.push(seg((x0, y_med), (x1, y_med), MEDIAN_PX, color));
                continue;
            }
            if degenerate {
                strokes.push(seg((cx - hw, y_med), (cx + hw, y_med), MEDIAN_PX, color));
                continue;
            }
            // Two halves split at the median: each rounds its outer end
            let r = self.layout.corner_radius_px.max(0.0);
            for (y0, y1, end) in [(y_q1, y_med, -1.0), (y_med, y_q3, 1.0)] {
                if y1 > y0 {
                    bars.push(ChartBarRaw { rect: [cx - hw, y0, cx + hw, y1], z_radius: [BOX_Z, r, end, side_gap], color });
                }
            }
            // The median reads as a surface gap between the halves
            strokes.push(seg((cx - hw, y_med), (cx + hw, y_med), MEDIAN_PX, surface));
        }
    }

    /// Half width (world) of a violin at value `v`.
    fn violin_half_width(&self, g: usize, sub: f32, v: f64) -> f32 {
        let Some((lo, hi, _, d)) = self.kde(g) else { return 0.0 };
        let t = ((v - lo) / (hi - lo)).clamp(0.0, 1.0) * (d.len() - 1) as f64;
        let k = (t.floor() as usize).min(d.len() - 2);
        let f = (t - k as f64) as f32;
        (d[k] + (d[k + 1] - d[k]) * f) * self.violin_scale(g, sub)
    }

    /// World half width per density unit.
    fn violin_scale(&self, g: usize, sub: f32) -> f32 {
        let peak = match self.opts.violin.map(|v| v.scale) {
            Some(ViolinScale::Width) => self.groups[g].kde_max,
            _ => self.kde_peak,
        };
        if peak > 0.0 { sub * 0.5 * 0.94 / peak } else { 0.0 }
    }

    #[allow(clippy::too_many_arguments)]
    fn violin_marks(
        &self,
        g: usize,
        cx: f32,
        sub: f32,
        color: [f32; 4],
        v: &ViolinOptions,
        _surface: [f32; 4],
        fills: &mut Vec<ChartFillRaw>,
        strokes: &mut Vec<ChartSegmentRaw>,
    ) {
        let Some((lo, hi, _, d)) = self.kde(g) else {
            // Single value: a flat line at it
            if let Some(st) = self.groups[g].stats {
                let y = self.y_of(st.median);
                let hw = sub * 0.25;
                strokes.push(ChartSegmentRaw {
                    p0_width: [cx - hw, y, STROKE_Z, MEDIAN_PX],
                    p1_pad: [cx + hw, y, STROKE_Z, 0.0],
                    color,
                });
            }
            return;
        };
        let k = self.violin_scale(g, sub);
        let last = (d.len() - 1) as f64;
        let ys: Vec<f32> = (0..d.len()).map(|j| self.y_of(lo + (hi - lo) * j as f64 / last)).collect();
        let right: Vec<f32> = d.iter().map(|&p| cx + p * k).collect();
        let left: Vec<f32> = d.iter().map(|&p| cx - p * k).collect();
        // Vertical band: tessellate with value as the band axis, then swap x / y
        let start = fills.len();
        let mut fill = color;
        fill[3] *= v.fill_opacity.clamp(0.0, 1.0);
        band_triangles(&ys, &right, &left, FILL_Z, fill, fills);
        for p in &mut fills[start..] {
            p.position.swap(0, 1);
        }
        let w = self.layout.whisker_px.max(0.25);
        let mut seg = |a: (f32, f32), b: (f32, f32)| {
            strokes.push(ChartSegmentRaw { p0_width: [a.0, a.1, STROKE_Z, w], p1_pad: [b.0, b.1, STROKE_Z, 0.0], color });
        };
        for j in 1..d.len() {
            seg((right[j - 1], ys[j - 1]), (right[j], ys[j]));
            seg((left[j - 1], ys[j - 1]), (left[j], ys[j]));
        }
        let n = d.len() - 1;
        seg((left[0], ys[0]), (right[0], ys[0]));
        seg((left[n], ys[n]), (right[n], ys[n]));
    }

    /// Outliers, mean markers and violin median dots (instanced points; slot = series).
    pub(crate) fn build_points(&self, surface: [f32; 4], out: &mut Vec<ChartPointRaw>) {
        out.clear();
        let vis = self.visible_series();
        let rgba8 = |c: [f32; 4]| c.map(|v| (v.clamp(0.0, 1.0) * 255.0).round() as u8);
        let slot = |g: usize| ((g / self.categories).min(MAX_POINT_SERIES - 1)) as f32;
        let violin_box = self.opts.violin.is_some_and(|v| v.show_box);
        for (g, gr) in self.groups.iter().enumerate() {
            let (Some(st), Some((cx, _))) = (gr.stats, self.place(g, &vis)) else { continue };
            let color = self.base_color(g);
            let mut inner = surface;
            inner[3] *= color[3];
            let r = self.layout.outlier_radius_px.max(0.5);
            for &o in self.group_outliers(g) {
                out.push(ChartPointRaw { center_radius: [cx, self.y_of(o as f64), slot(g), r], color: rgba8(color) });
            }
            if violin_box {
                let y = self.y_of(st.median);
                out.push(ChartPointRaw { center_radius: [cx, y, slot(g), VIOLIN_MEDIAN_PX], color: rgba8(inner) });
            }
            if self.opts.show_mean {
                // Hollow dot: readable over the box and over the surface
                let y = self.y_of(st.mean);
                out.push(ChartPointRaw { center_radius: [cx, y, slot(g), MEAN_OUTER_PX], color: rgba8(color) });
                out.push(ChartPointRaw { center_radius: [cx, y, slot(g), MEAN_INNER_PX], color: rgba8(inner) });
            }
        }
    }

    /// Point layer uniform: identity transform, surface ring (colors / dimming are baked in).
    pub(crate) fn point_style(&self, hover: &ChartHoverStyle) -> ChartPointStyleRaw {
        ChartPointStyleRaw {
            ring_color: hover.marker_ring_color,
            params: [1.0, -1.0, 0.0, 0.0],
            ..Default::default()
        }
    }

    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if !style.show_grid {
            return;
        }
        let half_w = self.layout.width * 0.5;
        let z = -0.5;
        for v in ticks_between(self.v_min, self.v_max, self.v_step) {
            if (v - self.v_min).abs() < self.v_step * 1e-6 {
                continue; // drawn as the baseline below
            }
            let y = self.y_of(v);
            out.push(ChartSegmentRaw { p0_width: [-half_w, y, z, style.stroke_px], p1_pad: [half_w, y, z, 0.0], color: style.grid_color });
        }
        out.push(ChartSegmentRaw {
            p0_width: [-half_w, self.bottom, z, style.stroke_px],
            p1_pad: [half_w, self.bottom, z, 0.0],
            color: style.baseline_color,
        });
    }

    /// Hover ring on a hovered outlier (boxes / violins highlight through their mark colors).
    pub(crate) fn build_overlay(&self, hover: &HoverResult, style: &ChartHoverStyle, out: &mut Vec<ChartMarkerRaw>) {
        out.clear();
        let Some(item) = hover.items.get(hover.primary) else { return };
        if hover.is_bar || !style.marker {
            return;
        }
        let Some((_, _, _, p)) = self.sample(item.global_id) else { return };
        let g = item.series as usize * self.categories + item.index as usize;
        out.push(ChartMarkerRaw {
            center_radius: [p.x, p.y, STROKE_Z, self.layout.outlier_radius_px.max(0.5) + 2.0],
            fill: self.base_color(g),
            ring: style.marker_ring_color,
            params: [style.marker_ring_px, 0.0, 0.0, 0.0],
        });
    }

    /// Plot rectangle, value ticks, and thinned-out category ticks.
    pub(crate) fn axes(&self, view: &ChartView, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = [0.0; 4];
        let half_w = self.layout.width * 0.5;
        let Some(plot) = plot_rect_css(view, half_w, self.bottom, self.bottom + self.layout.height, 0.0) else {
            return;
        };
        out.plot_css = plot;
        for v in ticks_between(self.v_min, self.v_max, self.v_step) {
            if let Some((_, cy)) = view.project_css(Vec3::new(-half_w, self.y_of(v), 0.0)) {
                out.ticks.push(AxisTick { axis: 1, value: v, x_css: plot[0], y_css: cy, granularity: 0 });
            }
        }
        let n = self.categories;
        let every = ((n as f32 * LABEL_SPACING_PX / plot[2].max(1.0)).ceil() as usize).max(1);
        let bottom = plot[1] + plot[3];
        for i in (0..n).step_by(every) {
            if let Some((cx, _)) = view.project_css(Vec3::new(self.slot_x(i), self.bottom, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value: i as f64, x_css: cx, y_css: bottom, granularity: 0 });
            }
        }
    }

    /// `(series, category, value, world position)`: box ids `s * categories + i` sit at their
    /// median; outlier ids follow them (`groups + k`, `k` into the drawn outliers).
    pub(crate) fn sample(&self, id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let vis = self.visible_series();
        let id = id as usize;
        let count = self.groups.len();
        let (g, v) = if id < count {
            (id, self.groups[id].stats?.median)
        } else {
            let k = id - count;
            let v = *self.outliers.get(k)?;
            (self.outlier_offsets.partition_point(|&o| o <= k) - 1, v as f64)
        };
        let (cx, _) = self.place(g, &vis)?;
        let (s, i) = (g / self.categories, g % self.categories);
        Some((s as u32, i as u32, v as f32, Vec3::new(cx, self.y_of(v), 0.0)))
    }

    /// The group column under the pointer (box id, value = median), or an outlier point within
    /// a few px of the pointer (outlier id, its value).
    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let hit = ray_hit_z_plane(&ray, 0.0)?;
        let half_w = self.layout.width * 0.5;
        let slack = self.layout.height * HOVER_Y_SLACK;
        if hit.x.abs() > half_w || hit.y < self.bottom - slack || hit.y > self.bottom + self.layout.height + slack {
            return None;
        }
        let vis = self.visible_series();
        let last = vis.len().checked_sub(1)?;
        let i = (((hit.x + half_w) / self.spacing).floor().max(0.0) as usize).min(self.categories - 1);
        let sub = self.group_width / vis.len() as f32;
        let x0 = self.slot_x(i) - self.group_width * 0.5;
        let j = (((hit.x - x0) / sub).floor().max(0.0) as usize).min(last);
        let g = vis[j] * self.categories + i;
        let st = self.groups[g].stats?;
        let item = |value: f32, global_id: usize| HoverItem {
            series: vis[j] as u32,
            index: i as u32,
            value,
            global_id: global_id as u32,
        };
        if let Some(k) = self.outlier_near(g, &vis, hit, view) {
            return Some(HoverResult { is_bar: false, primary: 0, items: vec![item(self.outliers[k], self.groups.len() + k)] });
        }
        Some(HoverResult { is_bar: true, primary: 0, items: vec![item(st.median as f32, g)] })
    }

    /// Flat index of the drawn outlier of group `g` closest to `hit` within its pick radius.
    fn outlier_near(&self, g: usize, vis: &[usize], hit: Vec3, view: &ChartView) -> Option<usize> {
        let drawn = self.group_outliers(g);
        if drawn.is_empty() {
            return None;
        }
        let (cx, _) = self.place(g, vis)?;
        let (a, b) = (view.project_css(Vec3::ZERO)?, view.project_css(Vec3::new(1.0, 1.0, 0.0))?);
        let (sx, sy) = ((b.0 - a.0).abs(), (b.1 - a.1).abs());
        let v = self.v_of(hit.y) as f32;
        let at = drawn.partition_point(|&o| o < v);
        let dist = |k: usize| {
            let dy = (self.y_of(drawn[k] as f64) - hit.y) * sy;
            ((hit.x - cx) * sx).hypot(dy)
        };
        let best = [at.checked_sub(1), (at < drawn.len()).then_some(at)]
            .into_iter()
            .flatten()
            .min_by(|&p, &q| dist(p).total_cmp(&dist(q)))?;
        let radius = self.layout.outlier_radius_px.max(0.5) + 4.0;
        (dist(best) <= radius).then(|| self.outlier_offsets[g] + best)
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        frame_flat(camera, css, self.layout.width, self.layout.height, padding);
    }
}

impl ChartState {
    /// Creates a box plot / violin chart; see `BoxChart::new` and `validate_box_plot`.
    #[allow(clippy::too_many_arguments)]
    pub fn new_box_plot(
        values: &[f32],
        offsets: &[usize],
        series_count: usize,
        categories: usize,
        colors: Vec<[f32; 4]>,
        layout: BoxLayout,
        opts: BoxPlotOptions,
    ) -> Self {
        Self::with_kind(ChartKind::Box(BoxChart::new(values, offsets, series_count, categories, colors, layout, opts)))
    }

    /// Stats of box group `g = series * categories + category`.
    pub fn box_stats(&self, g: usize) -> Option<BoxStats> {
        match &self.kind {
            ChartKind::Box(b) => b.stats(g),
            _ => None,
        }
    }

    /// `(series, categories)` of a box plot.
    pub fn box_shape(&self) -> Option<(usize, usize)> {
        match &self.kind {
            ChartKind::Box(b) => Some((b.series_count, b.categories)),
            _ => None,
        }
    }

    /// `(lo, hi, bandwidth, density at KDE_POINTS positions over [lo, hi])` of a violin group.
    pub fn box_kde(&self, g: usize) -> Option<(f64, f64, f64, &[f32])> {
        match &self.kind {
            ChartKind::Box(b) => b.kde(g),
            _ => None,
        }
    }

    /// Drawn (sampled) outliers of a group, ascending.
    pub fn box_outliers(&self, g: usize) -> &[f32] {
        match &self.kind {
            ChartKind::Box(b) => b.group_outliers(g),
            _ => &[],
        }
    }

    /// `(min, max, step)` of the box plot value axis.
    pub fn box_domain(&self) -> Option<(f64, f64, f64)> {
        match &self.kind {
            ChartKind::Box(b) => Some(b.domain()),
            _ => None,
        }
    }

    /// Box plot part of `prepare_layers`: rebuilds marks / points / grid / hover ring as needed.
    pub(crate) fn prepare_box(&mut self) {
        let ChartKind::Box(b) = &self.kind else { return };
        let surface = self.hover_style.marker_ring_color;
        // Visibility / emphasis / style changes rebuild everything; hover changes only the marks
        let full = self.dirty.bars || self.dirty.points;
        if full || self.dirty.series || self.dirty.fills {
            let hovered = self.hover.as_ref().filter(|h| h.is_bar).and_then(|h| h.items.get(h.primary)).map(|i| i.global_id as usize);
            b.build_marks(hovered, surface, &self.hover_style, &mut self.bars, &mut self.fills, &mut self.series);
            self.dirty.bars = true;
            self.dirty.fills = true;
            self.dirty.series = true;
        }
        if full {
            b.build_points(surface, &mut self.points);
            self.dirty.points = true;
        }
        if self.dirty.underlay {
            b.build_grid(&self.frame_style, &mut self.underlay);
        }
        if self.dirty.overlay {
            self.overlay.clear();
            match &self.hover {
                Some(h) => b.build_overlay(h, &self.hover_style, &mut self.markers),
                None => self.markers.clear(),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic standard normals (xorshift + Box–Muller).
    fn normals(n: usize, seed: u64) -> Vec<f32> {
        let mut s = seed.max(1);
        let mut next = || {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            ((s >> 11) as f64 + 0.5) / (1u64 << 53) as f64
        };
        (0..n)
            .map(|_| {
                let (u, v) = (next(), next());
                ((-2.0 * u.ln()).sqrt() * (std::f64::consts::TAU * v).cos()) as f32
            })
            .collect()
    }

    fn stats(v: &[f32], rule: WhiskerRule) -> BoxStats {
        compute_box_stats(v, rule, &mut Vec::new()).unwrap()
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn quartiles_match_numpy_linear_interpolation() {
        // np.percentile(np.arange(1, 11), [25, 50, 75]) = [3.25, 5.5, 7.75]
        let st = stats(&[7.0, 1.0, 10.0, 4.0, 2.0, 9.0, 3.0, 8.0, 5.0, 6.0], WhiskerRule::MinMax);
        assert!(close(st.q1, 3.25) && close(st.median, 5.5) && close(st.q3, 7.75), "{st:?}");
        assert_eq!((st.n, st.min, st.max, st.outliers), (10, 1.0, 10.0, 0));
        assert!(close(st.mean, 5.5));
        // np.std(np.arange(1, 11), ddof=1) = 3.0276503540974917
        assert!((st.std - 3.027_650_354_097_491_7).abs() < 1e-12);
        // [1, 2, 3, 4]: 1.75 / 2.5 / 3.25; NaN / inf are ignored
        let st = stats(&[4.0, f32::NAN, 1.0, 3.0, f32::INFINITY, 2.0], WhiskerRule::MinMax);
        assert!(close(st.q1, 1.75) && close(st.median, 2.5) && close(st.q3, 3.25));
        assert_eq!(st.n, 4);
        // One sample: every statistic is that sample
        let st = stats(&[2.5], WhiskerRule::default());
        assert!([st.min, st.q1, st.median, st.q3, st.max, st.whisker_lo, st.whisker_hi].iter().all(|&v| v == 2.5));
        assert!(compute_box_stats(&[f32::NAN], WhiskerRule::default(), &mut Vec::new()).is_none());
    }

    #[test]
    fn tukey_whiskers_end_at_the_last_sample_inside_the_fences() {
        // q1 3.25, q3 7.75, IQR 4.5: fences -3.5 / 14.5 -> whiskers 1 / 9, outlier 100
        let v = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0];
        let st = stats(&v, WhiskerRule::Tukey(1.5));
        assert_eq!((st.whisker_lo, st.whisker_hi, st.outliers), (1.0, 9.0, 1));
        assert!(close(st.mean, 14.5));
        let mut out = Vec::new();
        collect_outliers(&v, &st, 10, &mut out);
        assert_eq!(out, vec![100.0]);
        // Lower outliers too, sorted on the way out
        let v = [-50.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 100.0, -40.0];
        let st = stats(&v, WhiskerRule::Tukey(1.5));
        assert_eq!(st.outliers, 3);
        let mut out = Vec::new();
        collect_outliers(&v, &st, 10, &mut out);
        assert_eq!(out, vec![-50.0, -40.0, 100.0]);
        // Min / max whiskers: no outliers
        let st = stats(&v, WhiskerRule::MinMax);
        assert_eq!((st.whisker_lo, st.whisker_hi, st.outliers), (-50.0, 100.0, 0));
    }

    #[test]
    fn narrow_fences_and_inner_percentiles_stay_finite_and_in_the_domain() {
        // k = 0 on [0, 10]: no sample inside the fences 2.5 / 7.5 -> whiskers fall back to the quartiles
        let st = stats(&[0.0, 10.0], WhiskerRule::Tukey(0.0));
        assert_eq!((st.whisker_lo, st.whisker_hi, st.outliers), (2.5, 7.5, 2));
        let mut out = Vec::new();
        collect_outliers(&[0.0, 10.0], &st, 10, &mut out);
        assert_eq!(out, vec![0.0, 10.0]);
        // 40th / 60th percentile whiskers sit inside the box: the axis still covers q1..q3
        let v: Vec<f32> = (0..=100).map(|i| i as f32).collect();
        let state = ChartState::new_box_plot(
            &v,
            &[0, v.len()],
            1,
            1,
            vec![[1.0; 4]],
            BoxLayout::default(),
            BoxPlotOptions { whiskers: WhiskerRule::Percentile(0.4, 0.6), show_outliers: false, ..Default::default() },
        );
        let (lo, hi, _) = state.box_domain().unwrap();
        assert!(lo <= 25.0 && hi >= 75.0, "{lo}..{hi}");
    }

    #[test]
    fn percentile_whiskers_follow_numpy_quantiles() {
        // np.percentile(np.arange(1, 101), [5, 95]) = [5.95, 95.05]
        let v: Vec<f32> = (1..=100).rev().map(|i| i as f32).collect();
        let st = stats(&v, WhiskerRule::Percentile(0.05, 0.95));
        assert!((st.whisker_lo - 5.95).abs() < 1e-6 && (st.whisker_hi - 95.05).abs() < 1e-6, "{st:?}");
        assert_eq!(st.outliers, 10); // 1..=5 and 96..=100
    }

    #[test]
    fn outliers_beyond_the_cap_are_sampled_deterministically_with_extremes_kept() {
        // 100,000 core values in [0, 100) and 20,000 far outliers on both sides
        let mut v: Vec<f32> = (0..100_000).map(|i| i as f32 * 0.001).collect();
        v.extend((0..10_000).map(|i| 1_000.0 + i as f32));
        v.extend((0..10_000).map(|i| -1_000.0 - i as f32));
        let st = stats(&v, WhiskerRule::default());
        assert_eq!(st.outliers, 20_000);
        let (mut a, mut b) = (Vec::new(), Vec::new());
        collect_outliers(&v, &st, 1_000, &mut a);
        collect_outliers(&v, &st, 1_000, &mut b);
        assert_eq!(a.len(), 1_000);
        assert_eq!(a, b, "deterministic");
        assert!(a.windows(2).all(|w| w[0] <= w[1]));
        assert_eq!((a[0], a[999]), (-10_999.0, 10_999.0));
        // Roughly half from each side
        let low = a.iter().filter(|&&o| o < 0.0).count();
        assert!((450..=550).contains(&low), "{low}");
    }

    #[test]
    fn binned_kde_integrates_to_one_and_scales_linearly_on_a_million_samples() {
        let v = normals(1_000_000, 7);
        let t = std::time::Instant::now();
        let st = stats(&v, WhiskerRule::default());
        let h = silverman_bandwidth(st.n, st.std, st.q3 - st.q1);
        let d = kde_binned(&v, st.min, st.max, h, KDE_POINTS);
        let elapsed = t.elapsed();
        assert_eq!(d.len(), KDE_POINTS);
        // Silverman for N(0, 1), n = 1e6: 0.9 * 1e6^-0.2 ~ 0.0568
        assert!((h - 0.0568).abs() < 0.003, "{h}");
        // Trapezoid over [min, max] (the tails beyond the extremes are negligible)
        let dx = (st.max - st.min) / (KDE_POINTS - 1) as f64;
        let area: f64 = d.windows(2).map(|w| (w[0] + w[1]) as f64 * 0.5 * dx).sum();
        assert!((area - 1.0).abs() < 0.02, "integral {area}");
        // Peak near the standard normal density 1 / sqrt(2 pi) ~ 0.399
        let peak = d.iter().copied().fold(0.0, f32::max);
        assert!((peak - 0.399).abs() < 0.02, "{peak}");
        // O(n + grid): a naive O(n x grid) evaluation would be 128M kernel evaluations
        assert!(elapsed.as_secs_f64() < 10.0, "{elapsed:?}");

        // A wide explicit bandwidth still integrates to ~1 (mass spills past [min, max] only)
        let small = normals(2_000, 3);
        let st = stats(&small, WhiskerRule::default());
        let d = kde_binned(&small, -10.0, 10.0, 0.5, KDE_POINTS);
        let dx = 20.0 / (KDE_POINTS - 1) as f64;
        let area: f64 = d.windows(2).map(|w| (w[0] + w[1]) as f64 * 0.5 * dx).sum();
        assert!((area - 1.0).abs() < 0.01, "{area} ({st:?})");
        // Degenerate ranges / bandwidths give zero density, never NaN
        assert!(kde_binned(&small, 1.0, 1.0, 0.5, 8).iter().all(|&p| p == 0.0));
        assert!(kde_binned(&small, -1.0, 1.0, 0.0, 8).iter().all(|&p| p == 0.0));
    }

    fn chart(opts: BoxPlotOptions) -> ChartState {
        // 2 series x 2 categories; group (1, 1) is empty
        let a: Vec<f32> = (1..=10).map(|i| i as f32).collect();
        let mut values = a.clone();
        values.push(100.0); // outlier of group 0
        values.extend(a.iter().map(|v| v * 2.0));
        values.extend(a.iter().map(|v| v + 5.0));
        let offsets = [0, 11, 21, 31, 31];
        validate_box_plot(2, 2, &offsets, values.len()).unwrap();
        ChartState::new_box_plot(
            &values,
            &offsets,
            2,
            2,
            vec![[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]],
            BoxLayout::default(),
            opts,
        )
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    #[test]
    fn validation_rejects_bad_offsets() {
        assert!(validate_box_plot(1, 2, &[0, 3, 5], 5).is_ok());
        assert!(validate_box_plot(1, 2, &[0, 3], 5).is_err());
        assert!(validate_box_plot(1, 2, &[0, 6, 5], 5).is_err());
        assert!(validate_box_plot(1, 2, &[1, 3, 5], 5).is_err());
        assert!(validate_box_plot(0, 2, &[0], 0).is_err());
    }

    #[test]
    fn box_marks_split_at_the_median_with_whiskers_outliers_and_a_nice_axis() {
        let mut state = chart(BoxPlotOptions { show_mean: true, ..Default::default() });
        assert_eq!(state.box_shape(), Some((2, 2)));
        assert_eq!(state.point_count(), 31);
        assert!(state.box_stats(3).is_none(), "empty group");
        assert_eq!(state.box_outliers(0), &[100.0]);
        let (lo, hi, _) = state.box_domain().unwrap();
        assert!(lo <= 1.0 && hi >= 100.0);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        state.frame_camera(&mut cam, (1600.0, 900.0));
        let v = view(&cam);
        let layers = state.prepare_layers(&v);
        // 3 non-empty groups x 2 halves; grouped -> 2px side gaps, rounded outer ends
        let bars = layers.bars.unwrap();
        assert_eq!(bars.len(), 6);
        assert!(bars.iter().all(|b| b.z_radius[3] == -2.0 && b.z_radius[1] == 4.0));
        assert_eq!((bars[0].z_radius[2], bars[1].z_radius[2]), (-1.0, 1.0));
        assert_eq!(bars[0].rect[3], bars[1].rect[1], "halves meet at the median");
        // Per box: 2 whiskers + 2 caps + surface median
        assert_eq!(layers.series.unwrap().len(), 15);
        // 1 outlier + 2 mean dots per group
        assert_eq!(layers.points.unwrap().len(), 7);
        assert!(layers.point_style.is_some());
        assert!(layers.underlay.unwrap().len() >= 3);
        let axes = state.axes();
        assert_eq!(axes.ticks.iter().filter(|t| t.axis == 0).count(), 2);
        assert!(axes.ticks.iter().any(|t| t.axis == 1 && t.value == 100.0));
    }

    #[test]
    fn hover_reports_the_box_or_the_outlier_under_the_pointer() {
        let mut state = chart(BoxPlotOptions::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        state.frame_camera(&mut cam, (1600.0, 900.0));
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        // Box of series 1, category 0 (id 2) at its median
        let (s, i, med, p) = state.sample(2).unwrap();
        assert_eq!((s, i, med), (1, 0, 10.5));
        let ndc = cam.project_to_ndc(p).unwrap();
        let hit = state.hover_at(&v, &mut scene, (ndc.x, ndc.y)).unwrap();
        assert!(hit.is_bar);
        assert_eq!((hit.items[0].series, hit.items[0].index, hit.items[0].global_id), (1, 0, 2));
        // Hovered box is highlighted (lighter than its base color)
        let layers = state.prepare_layers(&v);
        let bars = layers.bars.unwrap();
        assert!(bars.iter().any(|b| b.color != [1.0, 0.0, 0.0, 1.0] && b.color != [0.0, 0.0, 1.0, 1.0]));
        // Outlier 100 of group 0: id = groups (4) + 0
        let (_, _, val, p) = state.sample(4).unwrap();
        assert_eq!(val, 100.0);
        let ndc = cam.project_to_ndc(p).unwrap();
        let hit = state.hover_at(&v, &mut scene, (ndc.x, ndc.y)).unwrap();
        assert!(!hit.is_bar);
        assert_eq!((hit.items[0].value, hit.items[0].global_id, hit.items[0].series), (100.0, 4, 0));
        assert_eq!(state.prepare_layers(&v).markers.unwrap().len(), 1, "outlier ring");
        // Empty group: nothing
        let (_, _, _, p) = state.sample(1).unwrap(); // series 0, category 1
        let ndc = cam.project_to_ndc(p + Vec3::new(state_sub_shift(&state), 0.0, 0.0)).unwrap();
        assert!(state.hover_at(&v, &mut scene, (ndc.x, ndc.y)).is_none());
    }

    /// World x shift from series 0 to series 1 inside a category.
    fn state_sub_shift(state: &ChartState) -> f32 {
        let (_, _, _, a) = state.sample(0).unwrap();
        let (_, _, _, b) = state.sample(2).unwrap();
        b.x - a.x
    }

    #[test]
    fn hidden_series_give_their_slot_to_the_others() {
        let mut state = chart(BoxPlotOptions::default());
        let mut scene = SceneWorld::new();
        let wide = state.sample(0).unwrap().3.x;
        state.set_series_visible(1, false, &mut scene);
        assert!(!state.series_visible(1));
        let centered = state.sample(0).unwrap().3.x;
        assert!(centered > wide, "series 0 moves to the slot center");
        assert!(state.sample(2).is_none(), "hidden");
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        state.frame_camera(&mut cam, (1600.0, 900.0));
        let layers = state.prepare_layers(&view(&cam));
        let bars = layers.bars.unwrap();
        assert_eq!(bars.len(), 4);
        assert!(bars.iter().all(|b| b.z_radius[3] == 0.0), "single visible series: no side gap");
        state.set_emphasis(Some(0));
        assert!(state.prepare_layers(&view(&cam)).bars.is_some());
    }

    #[test]
    fn violins_are_mirrored_bands_scaled_by_area_or_width() {
        let mut values = normals(5_000, 11);
        values.extend(normals(5_000, 12).iter().map(|v| v * 3.0));
        let offsets = [0, 5_000, 10_000];
        let make = |scale| {
            ChartState::new_box_plot(
                &values,
                &offsets,
                1,
                2,
                vec![[0.2, 0.4, 0.8, 1.0]],
                BoxLayout::default(),
                BoxPlotOptions { violin: Some(ViolinOptions { scale, ..Default::default() }), ..Default::default() },
            )
        };
        let mut state = make(ViolinScale::Area);
        let (lo, hi, h, d) = state.box_kde(0).unwrap();
        assert!(lo < -2.0 && hi > 2.0 && h > 0.0 && d.len() == KDE_POINTS);
        assert!(state.box_outliers(0).is_empty(), "violins draw no outliers");
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        state.frame_camera(&mut cam, (1600.0, 900.0));
        let c = state.sample(0).unwrap().3.x;
        let layers = state.prepare_layers(&view(&cam));
        assert!(layers.bars.unwrap().is_empty());
        let fills = layers.fills.unwrap().to_vec();
        assert_eq!(fills.len(), 2 * (KDE_POINTS - 1) * 6);
        // Mirrored around the group center
        let xs: Vec<f32> = fills[..fills.len() / 2].iter().map(|p| p.position[0]).collect();
        let (x0, x1) = xs.iter().fold((f32::MAX, f32::MIN), |(a, b), &x| (a.min(x), b.max(x)));
        assert!(((x0 + x1) * 0.5 - c).abs() < 1e-3);
        let area_width = x1 - x0;
        // Width scaling: the wide (low peak) group reaches the same width as the narrow one
        let wide_area = {
            let xs: Vec<f32> = fills[fills.len() / 2..].iter().map(|p| p.position[0]).collect();
            xs.iter().fold(f32::MIN, |a, &x| a.max(x)) - xs.iter().fold(f32::MAX, |a, &x| a.min(x))
        };
        assert!(wide_area < area_width * 0.6, "same area: the spread-out group is narrower");
        let mut state = make(ViolinScale::Width);
        state.frame_camera(&mut cam, (1600.0, 900.0));
        let fills = state.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
        let width = |f: &[ChartFillRaw]| {
            let xs: Vec<f32> = f.iter().map(|p| p.position[0]).collect();
            xs.iter().fold(f32::MIN, |a, &x| a.max(x)) - xs.iter().fold(f32::MAX, |a, &x| a.min(x))
        };
        let (a, b) = (width(&fills[..fills.len() / 2]), width(&fills[fills.len() / 2..]));
        assert!((a - b).abs() < a * 0.02, "{a} vs {b}");
        // Inner box: median dot per group in the point layer
        assert_eq!(state.prepare_layers(&view(&cam)).points.map(<[_]>::len), None, "unchanged");
    }
}
