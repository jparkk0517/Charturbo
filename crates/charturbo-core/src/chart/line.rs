//! Line chart: layout, zoom window, M4 LOD, hover, axes.

use super::scale::{log_or_identity, log_ticks, log_y_domain, AxisScale, ScaleType};
use super::time_zone::{time_ticks_tz, TimeZone};
use super::*;
use super::linestyle::{LineStyles, NullPolicy};

// -----------------------------------------------------------------------------
// Line chart
// -----------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub(crate) struct LineChart {
    /// Samples of series `s` live at `values[head[s]..]` (and `x[head[s]..]`): trimming the
    /// oldest samples (`max_points`) only advances `head`, compaction is amortized
    pub(crate) series: Vec<LineSeries>,
    pub(crate) head: Vec<usize>,
    /// Finite (min, max) of each series' live samples; `(INF, -INF)` without finite samples
    pub(crate) ext: Vec<(f32, f32)>,
    /// Finite positive (min, max) of each series' live samples (log y axes); `(INF, -INF)` when none
    pub(crate) pos_ext: Vec<(f32, f32)>,
    /// Plane depth of each series
    pub(crate) z: Vec<f32>,
    /// Global id offset of each series (prefix sum of lengths)
    pub(crate) offsets: Vec<u32>,
    pub(crate) layout: LineLayout,
    /// Raw finite extent of all data (`YAutoscale::All` domain before nice expansion)
    pub(crate) data_min: f32,
    pub(crate) data_max: f32,
    pub(crate) y_min: f32,
    pub(crate) y_span: f32,
    pub(crate) y_step: f64,
    pub(crate) y_axis: LineYAxis,
    /// Area fills include zero in automatic linear domains (explicit bounds still win).
    pub(crate) include_zero: bool,
    /// Target y tick count (frame style `grid_rows`)
    pub(crate) tick_target: u32,
    /// Explicit x domain: `t = (x - x_min) / x_span`. Series `x` are stored relative to the
    /// fixed `x_origin` (the first domain start, f64) so epoch-ms timestamps keep full precision
    /// and a moving domain (streaming, trimming) never rewrites stored x.
    pub(crate) x_origin: f64,
    pub(crate) x_min: f64,
    pub(crate) x_span: f64,
    /// Smallest average sample gap over the series, in `t` (zoom limit, hover edge slack)
    pub(crate) min_gap_t: f32,
    /// Visible x range in normalized `t` (zoom / pan), `(0, 1)` = everything
    pub(crate) window: (f32, f32),
    pub(crate) visible: Vec<bool>,
    /// Series drawn on top at full strength while the others fade (legend hover)
    pub(crate) emphasis: Option<usize>,
    /// Scale of the left y axis: `y_min` / `y_span` are in its scale space (log10 units for log)
    pub(crate) y_scale: AxisScale,
    /// Scale of x (reverse / tick hint; log only for numeric x > 0, see `x_log`)
    pub(crate) x_scale: AxisScale,
    /// Effective log x: series x are stored as `log10(x) - x_origin`, so the zoom window, M4
    /// buckets and binary searches stay linear (`x_data` / `x_abs_to_data` map back)
    pub(crate) x_log: bool,
    /// y axis of each series: 0 = left, 1 = right (dual axis)
    pub(crate) series_axis: Vec<u8>,
    /// Right y axis, used when any series is assigned to it
    pub(crate) right: RightAxis,
    /// Per-series markers / dashes / curves / null policies / bands (see linestyle.rs)
    pub(crate) style: LineStyles,
    /// Manual y zoom: scale-space `(min, max)` of the left and right y axes. Pins both domains
    /// (autoscale and nice ends are suspended) until `reset_zoom` (see zoom.rs).
    pub(crate) y_zoom: Option<[(f64, f64); 2]>,
}

/// Right y axis of a dual-axis line chart: own options, scale, data extent and domain (scale
/// space, like the left axis fields of `LineChart`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct RightAxis {
    pub(crate) axis: LineYAxis,
    pub(crate) scale: AxisScale,
    pub(crate) data_min: f32,
    pub(crate) data_max: f32,
    pub(crate) y_min: f32,
    pub(crate) y_span: f32,
    pub(crate) y_step: f64,
}

impl Default for RightAxis {
    fn default() -> Self {
        Self {
            axis: LineYAxis::default(),
            scale: AxisScale::LINEAR,
            data_min: 0.0,
            data_max: 1.0,
            y_min: 0.0,
            y_span: 1.0,
            y_step: 1.0,
        }
    }
}

/// Alpha of non-emphasized series while one series is emphasized.
pub(crate) const DIMMED_SERIES_ALPHA: f32 = 0.2;
/// Visible-extent autoscale keeps the domain until the extent leaves it or spans less than
/// this fraction of it (no jitter while panning over similar data).
pub(crate) const Y_SHRINK_HYSTERESIS: f64 = 0.6;
/// A zoom window ending at or past this `t` follows the latest data as series grow.
pub(crate) const FOLLOW_EDGE: f32 = 0.999;
/// Trimmed samples are compacted away once the dead prefix exceeds the live length and this.
const COMPACT_MIN: usize = 1024;

/// Zoom window in data terms, captured before a data update so the view survives it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum WindowAnchor {
    /// Not zoomed: keep showing everything
    Full,
    /// Touching the right edge: keep this data span pinned to the latest sample
    Follow(f64),
    /// Keep this absolute range (x, or index of the longest series)
    Fixed(f64, f64),
}

/// Finite (min, max) of `values`, `(INF, -INF)` when none.
fn finite_extent(values: &[f32]) -> (f32, f32) {
    extents(values).0
}

/// Finite positive (min, max) of `values` (log scales), `(INF, -INF)` when none.
fn positive_extent(values: &[f32]) -> (f32, f32) {
    extents(values).1
}

/// Finite `(min, max)` and finite positive `(min, max)` of `values` in one pass, each
/// `(INF, -INF)` when empty. Plain comparisons on finite values: `f32::min` / `max` carry NaN
/// handling that wasm lowers to slow compare sequences (2-3x slower on 10M samples).
fn extents(values: &[f32]) -> ((f32, f32), (f32, f32)) {
    let (mut lo, mut hi, mut pos_lo) = (f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY);
    for &v in values {
        if !v.is_finite() {
            continue;
        }
        if v < lo {
            lo = v;
        }
        if v > hi {
            hi = v;
        }
        if v > 0.0 && v < pos_lo {
            pos_lo = v;
        }
    }
    // The largest positive value is the maximum when it is positive
    let pos_hi = if hi > 0.0 { hi } else { f32::NEG_INFINITY };
    ((lo, hi), (pos_lo, pos_hi))
}

/// Fixed ends made finite and ordered (non-finite = from the data).
fn normalize_y_axis(axis: LineYAxis) -> LineYAxis {
    let finite = |v: Option<f64>| v.filter(|v| v.is_finite());
    let (mut min, mut max) = (finite(axis.min), finite(axis.max));
    if let (Some(a), Some(b)) = (min, max) {
        if a > b {
            (min, max) = (Some(b), Some(a));
        }
    }
    LineYAxis { min, max, ..axis }
}

/// Stored x of data `raw`: `log10` on a log x axis, relative to `origin`.
#[inline]
fn store_x(raw: f64, log: bool, origin: f64) -> f64 {
    log_or_identity(log, raw) - origin
}

/// y domain `(min, max, step)` for the data extent `[e0, e1]` under `axis`: fixed ends win,
/// data ends expand to whole steps when `nice`.
pub(crate) fn y_domain(e0: f64, e1: f64, axis: &LineYAxis, target: u32) -> (f64, f64, f64) {
    let mut lo = axis.min.unwrap_or(e0);
    let mut hi = axis.max.unwrap_or(e1);
    if hi <= lo {
        match (axis.min.is_some(), axis.max.is_some()) {
            (true, false) => hi = lo + 1.0,
            (false, true) => lo = hi - 1.0,
            _ => {
                let c = 0.5 * (lo + hi);
                (lo, hi) = (c - 0.5, c + 0.5);
            }
        }
    }
    let step = nice_step(hi - lo, target);
    if axis.nice {
        if axis.min.is_none() {
            lo = (lo / step).floor() * step;
        }
        if axis.max.is_none() {
            hi = (hi / step).ceil() * step;
        }
    }
    (lo, hi, step)
}

/// Cached decimation window in normalized x (`t` in [0, 1]) and screen density (px per unit t).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct LodWindow {
    pub(crate) t0: f32,
    pub(crate) t1: f32,
    pub(crate) px_per_t: f32,
    /// Series emitted in reverse order (camera behind the chart plane). Strokes do not write
    /// depth (their anti-aliased edges would punch holes), so layered series are drawn
    /// back-to-front instead.
    pub(crate) reversed: bool,
}

/// Checks explicit x arrays: given for every series or none, one per sample, finite, sorted
/// ascending (non-decreasing).
pub fn validate_line_x(series: &[LineSeries]) -> Result<(), String> {
    let with_x = series.iter().filter(|s| s.x.is_some()).count();
    if with_x == 0 {
        return Ok(());
    }
    if with_x != series.len() {
        return Err("x must be given for every series or none".into());
    }
    for (i, s) in series.iter().enumerate() {
        let x = s.x.as_deref().unwrap_or_default();
        if x.len() != s.values.len() {
            return Err(format!("series {i}: x length {} != values length {}", x.len(), s.values.len()));
        }
        if let Some(k) = x.iter().position(|v| !v.is_finite()) {
            return Err(format!("series {i}: x[{k}] is not finite"));
        }
        if let Some(k) = x.windows(2).position(|w| w[1] < w[0]) {
            return Err(format!("series {i}: x must be sorted ascending (x[{}] < x[{k}])", k + 1));
        }
    }
    Ok(())
}

/// Appends the first / min / max / last finite samples of `values[from..to]` in index order (M4).
/// Picks are made on raw values: log10 and axis reversal are monotonic, so the same samples are
/// the extremes after the y transform (non-positive samples on a log axis become gaps).
/// `nan_zero` (`NullPolicy::Zero`): missing samples compete as 0.
fn push_m4(values: &[f32], from: usize, to: usize, picks: &mut Vec<usize>, nan_zero: bool) {
    let (mut lo, mut hi) = (usize::MAX, usize::MAX);
    // Running min / max kept in registers (first index wins ties): the per-frame hot loop of
    // zoom / pan over every visible sample
    let (mut lo_v, mut hi_v) = (f32::INFINITY, f32::NEG_INFINITY);
    let end = to.min(values.len());
    if from < end {
        for (k, &raw) in values[from..end].iter().enumerate() {
            let v = if nan_zero && !raw.is_finite() { 0.0 } else { raw };
            if !v.is_finite() {
                continue;
            }
            if v < lo_v {
                lo_v = v;
                lo = from + k;
            }
            if v > hi_v {
                hi_v = v;
                hi = from + k;
            }
        }
    }
    let mut cand = [from, lo, hi, to - 1];
    cand.sort_unstable();
    for c in cand {
        if c != usize::MAX && picks.last() != Some(&c) {
            picks.push(c);
        }
    }
}

impl LineChart {
    pub(crate) fn new(mut series: Vec<LineSeries>, layout: LineLayout) -> Self {
        // Invalid x (callers are expected to validate first) falls back to index placement
        if validate_line_x(&series).is_err() {
            for s in &mut series {
                s.x = None;
            }
        }
        let (mut x_lo, mut x_hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for x in series.iter().filter_map(|s| s.x.as_deref()) {
            if let (Some(&a), Some(&b)) = (x.first(), x.last()) {
                x_lo = x_lo.min(a);
                x_hi = x_hi.max(b);
            }
        }
        let (x_min, x_span) = match (x_lo.is_finite(), x_hi > x_lo) {
            (false, _) => (0.0, 1.0),
            (true, true) => (x_lo, x_hi - x_lo),
            // Single x value: centre it like a one-sample series
            (true, false) => (x_lo - 0.5, 1.0),
        };
        for x in series.iter_mut().filter_map(|s| s.x.as_mut()) {
            x.iter_mut().for_each(|v| *v -= x_min);
        }
        let (ext, pos_ext): (Vec<_>, Vec<_>) = series.iter().map(|s| extents(&s.values)).unzip();
        let n = series.len();
        let z = (0..n)
            .map(|i| match layout.view {
                ChartViewMode::Flat => i as f32 * SERIES_Z_STEP_2D,
                ChartViewMode::Depth => (i as f32 - (n as f32 - 1.0) * 0.5) * SERIES_Z_STEP_LAYERED,
            })
            .collect();
        let mut chart = Self {
            visible: vec![true; n],
            head: vec![0; n],
            ext,
            pos_ext,
            series,
            z,
            offsets: Vec::with_capacity(n),
            layout,
            data_min: 0.0,
            data_max: 1.0,
            y_min: 0.0,
            y_span: 1.0,
            y_step: 1.0,
            y_axis: LineYAxis::default(),
            include_zero: false,
            tick_target: ChartFrameStyle::default().grid_rows,
            x_origin: x_min,
            x_min,
            x_span,
            min_gap_t: 1.0,
            window: (0.0, 1.0),
            emphasis: None,
            y_scale: AxisScale::LINEAR,
            x_scale: AxisScale::LINEAR,
            x_log: false,
            series_axis: vec![0; n],
            right: RightAxis::default(),
            style: LineStyles::default(),
            y_zoom: None,
        };
        chart.update_offsets();
        chart.update_data_extent();
        chart.update_min_gap();
        chart.update_y_domain(true);
        chart
    }

    /// Live samples of series `s`.
    #[inline]
    pub(crate) fn vals(&self, s: usize) -> &[f32] {
        &self.series[s].values[self.head[s]..]
    }

    /// Live x of series `s` (relative to `x_origin`).
    #[inline]
    pub(crate) fn xs(&self, s: usize) -> Option<&[f64]> {
        self.series[s].x.as_deref().map(|x| &x[self.head[s]..])
    }

    #[inline]
    pub(crate) fn len(&self, s: usize) -> usize {
        self.series[s].values.len() - self.head[s]
    }

    /// Domain start relative to `x_origin`.
    #[inline]
    fn x_shift(&self) -> f64 {
        self.x_min - self.x_origin
    }

    /// Re-derives the y domain for about `target` ticks.
    pub(crate) fn set_tick_target(&mut self, target: u32) {
        self.tick_target = target;
        self.update_y_domain(true);
    }

    /// Applies new y domain options (non-finite ends = from the data). True when the domain moved.
    pub(crate) fn set_y_axis(&mut self, axis: LineYAxis) -> bool {
        self.y_axis = normalize_y_axis(axis);
        self.update_y_domain(true)
    }

    /// Domain options of the right y axis; true when a domain moved.
    pub(crate) fn set_right_axis(&mut self, axis: LineYAxis) -> bool {
        self.right.axis = normalize_y_axis(axis);
        self.update_y_domain(true)
    }

    /// Scale of the left (`axis` 0) or right (1) y axis; true when it changed (the domain is
    /// re-derived in the new scale space).
    pub(crate) fn set_y_scale(&mut self, axis: u8, scale: AxisScale) -> bool {
        let slot = if axis == 0 { &mut self.y_scale } else { &mut self.right.scale };
        if *slot == scale {
            return false;
        }
        *slot = scale;
        // A manual y zoom lives in the old scale space
        self.y_zoom = None;
        self.update_y_domain(true);
        true
    }

    /// Scale of x. Log needs explicit numeric x that are all positive, else x stays linear
    /// (reverse / tick hint still apply). Switching log on / off re-stores every x (O(samples))
    /// and resets the zoom window. True when anything changed.
    pub(crate) fn set_x_scale(&mut self, scale: AxisScale) -> bool {
        let positive = (0..self.series.len()).all(|s| self.xs(s).and_then(|x| x.first()).is_none_or(|&v| self.x_data(v) > 0.0));
        let log = scale.is_log() && self.has_x() && self.layout.x_kind == LineXKind::Numeric && positive;
        let scale = AxisScale { kind: if log { ScaleType::Log } else { ScaleType::Linear }, ..scale };
        if scale == self.x_scale {
            return false;
        }
        self.x_scale = scale;
        if log != self.x_log {
            let (old_log, old_origin) = (self.x_log, self.x_origin);
            let mut lo = f64::INFINITY;
            for s in 0..self.series.len() {
                let head = self.head[s];
                if let Some(x) = self.series[s].x.as_mut() {
                    for v in x.iter_mut() {
                        let abs = *v + old_origin;
                        *v = store_x(if old_log { 10f64.powf(abs) } else { abs }, log, 0.0);
                    }
                    if let Some(&first) = x.get(head) {
                        lo = lo.min(first);
                    }
                }
            }
            // New origin: the smallest live x in the new space (keeps relative x small)
            let origin = if lo.is_finite() { lo } else { 0.0 };
            for x in self.series.iter_mut().filter_map(|s| s.x.as_mut()) {
                x.iter_mut().for_each(|v| *v -= origin);
            }
            (self.x_log, self.x_origin) = (log, origin);
            self.update_x_domain();
            self.update_min_gap();
            self.window = (0.0, 1.0);
        }
        true
    }

    /// Assigns series to y axes (1 = right, anything else / missing = left); true when changed.
    pub(crate) fn set_series_axes(&mut self, axes: &[u8]) -> bool {
        let axes: Vec<u8> = (0..self.series.len()).map(|s| u8::from(axes.get(s) == Some(&1))).collect();
        if axes == self.series_axis {
            return false;
        }
        self.series_axis = axes;
        self.update_data_extent();
        self.update_y_domain(true);
        true
    }

    /// Any series on the right y axis.
    #[inline]
    pub(crate) fn has_right(&self) -> bool {
        self.series_axis.contains(&1)
    }

    /// y axis of series `s` (0 = left, 1 = right).
    #[inline]
    pub(crate) fn axis_of(&self, s: usize) -> u8 {
        self.series_axis.get(s).copied().unwrap_or(0)
    }

    #[inline]
    pub(crate) fn scale_of_axis(&self, axis: u8) -> AxisScale {
        if axis == 0 {
            self.y_scale
        } else {
            self.right.scale
        }
    }

    /// `(min, span, step)` of a y axis domain in scale space.
    #[inline]
    fn dom(&self, axis: u8) -> (f32, f32, f64) {
        if axis == 0 {
            (self.y_min, self.y_span, self.y_step)
        } else {
            (self.right.y_min, self.right.y_span, self.right.y_step)
        }
    }

    /// y domain `(min, max, step)` of an axis in data units (step 0 on a log scale).
    pub(crate) fn domain_data(&self, axis: u8) -> (f64, f64, f64) {
        let (min, span, step) = self.dom(axis);
        let scale = self.scale_of_axis(axis);
        (scale.inv(min as f64), scale.inv((min + span) as f64), step)
    }

    /// Visible tick values (data units) of a y axis.
    pub(crate) fn y_ticks(&self, axis: u8) -> Vec<f64> {
        let (min, span, step) = self.dom(axis);
        let scale = self.scale_of_axis(axis);
        scale.ticks(min as f64, (min + span) as f64, step, scale.target(self.tick_target))
    }

    /// Re-derives the y domains (left, and right when used) from the data per their options;
    /// true when one changed. `force` (option / tick target changes) skips the hysteresis and
    /// also re-derives a `YAutoscale::None` domain.
    ///
    /// `Visible` keeps the current domain while the visible extent stays inside it and spans at
    /// least `Y_SHRINK_HYSTERESIS` of it, so panning over similar data never jitters the axis.
    /// Cost: O(visible samples) for a zoomed `Visible` chart, O(series) otherwise; a log axis
    /// whose data has non-positive values rescans its series for the positive extent.
    pub(crate) fn update_y_domain(&mut self, force: bool) -> bool {
        let left = self.update_axis_domain(0, force);
        let right = self.has_right() && self.update_axis_domain(1, force);
        left || right
    }

    fn update_axis_domain(&mut self, k: u8, force: bool) -> bool {
        let (axis, scale, all) = if k == 0 {
            (self.y_axis, self.y_scale, (self.data_min as f64, self.data_max as f64))
        } else {
            let r = &self.right;
            (r.axis, r.scale, (r.data_min as f64, r.data_max as f64))
        };
        if let Some(pin) = self.y_zoom {
            return self.apply_y_zoom(k, pin[k as usize]);
        }
        if axis.autoscale == YAutoscale::None && !force {
            return false;
        }
        let visible = axis.autoscale == YAutoscale::Visible;
        let (e0, e1) = if visible {
            match self.visible_extent(k, false) {
                Some((a, b)) => (a as f64, b as f64),
                // Nothing finite in the window: keep the domain unless asked to re-derive
                None if !force => return false,
                None => all,
            }
        } else {
            all
        };
        // A log axis only sees the positive part of the data
        let (e0, e1) = if scale.is_log() && e0 <= 0.0 {
            let pos = if visible { self.visible_extent(k, true) } else { self.positive_all(k) };
            pos.map_or((f64::INFINITY, f64::NEG_INFINITY), |(a, b)| (a as f64, b as f64))
        } else {
            (e0, e1)
        };
        let (e0, e1) = if self.include_zero && !scale.is_log() {
            (e0.min(0.0), e1.max(0.0))
        } else {
            (e0, e1)
        };
        let (d_min, d_span, d_step) = self.dom(k);
        if visible && !force {
            let (u0, u1) = (scale.fwd(e0), scale.fwd(e1));
            let (d0, d1) = (d_min as f64, (d_min + d_span) as f64);
            if u0 >= d0 && u1 <= d1 && u1 - u0 >= Y_SHRINK_HYSTERESIS * (d1 - d0) {
                return false;
            }
        }
        let (lo, hi, step) = if scale.is_log() {
            log_y_domain(e0, e1, &axis)
        } else {
            y_domain(e0, e1, &axis, scale.target(self.tick_target))
        };
        let (y_min, y_span) = (lo as f32, ((hi - lo) as f32).max(1e-6));
        if (y_min, y_span, step) == (d_min, d_span, d_step) {
            return false;
        }
        if k == 0 {
            (self.y_min, self.y_span, self.y_step) = (y_min, y_span, step);
        } else {
            (self.right.y_min, self.right.y_span, self.right.y_step) = (y_min, y_span, step);
        }
        true
    }

    /// Finite (min, max) of the visible series of y axis `axis` inside the zoom window (`None`
    /// when empty); `positive` keeps only values > 0 (log axes).
    fn visible_extent(&self, axis: u8, positive: bool) -> Option<(f32, f32)> {
        let (w0, w1) = self.window;
        let extent = if positive { positive_extent } else { finite_extent };
        let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
        for s in (0..self.series.len()).filter(|&s| self.visible[s] && self.axis_of(s) == axis) {
            let (a, b) = if self.window == (0.0, 1.0) {
                let (a, b) = if positive { self.pos_ext[s] } else { self.ext[s] };
                // Style extents (bands, zero-filled gaps); a log axis keeps their positive part
                let (c, d) = self.style.extra_extent(s);
                let (c, d) = if positive { (if c > 0.0 { c } else { f32::INFINITY }, if d > 0.0 { d } else { f32::NEG_INFINITY }) } else { (c, d) };
                (a.min(c), b.max(d))
            } else {
                let Some((i0, i1)) = self.inner_range(s, w0, w1) else {
                    continue;
                };
                let vals = &self.vals(s)[i0..=i1];
                let (a, b) = extent(vals);
                let (c, d) = self.style.window_extent(s, self.head[s], i0, i1, positive);
                // Zero-filled gaps in the window are drawn at 0
                let zero = !positive && self.style.nulls(s) == NullPolicy::Zero && vals.iter().any(|v| !v.is_finite());
                let (c, d) = if zero { (c.min(0.0), d.max(0.0)) } else { (c, d) };
                (a.min(c), b.max(d))
            };
            lo = lo.min(a);
            hi = hi.max(b);
        }
        (lo <= hi).then_some((lo, hi))
    }

    /// Positive (min, max) of every series on y axis `axis` (hidden ones too), O(series).
    fn positive_all(&self, axis: u8) -> Option<(f32, f32)> {
        let (lo, hi) = (0..self.series.len())
            .filter(|&s| self.axis_of(s) == axis)
            .map(|s| self.pos_ext[s])
            .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), (a, b)| (lo.min(a), hi.max(b)));
        (lo <= hi).then_some((lo, hi))
    }

    /// Samples with `t` in `[t0, t1]`; when none fall inside, the two samples bracketing the
    /// window (their segment crosses it). `None` when the series does not reach the window.
    fn inner_range(&self, series: usize, t0: f32, t1: f32) -> Option<(usize, usize)> {
        let last = self.len(series).checked_sub(1)?;
        match self.xs(series) {
            Some(x) => {
                let shift = self.x_shift();
                let (a, b) = (t0 as f64 * self.x_span + shift, t1 as f64 * self.x_span + shift);
                let i0 = x.partition_point(|&v| v < a);
                let i1 = x.partition_point(|&v| v <= b);
                if i0 < i1 {
                    Some((i0, i1 - 1))
                } else {
                    (i0 > 0 && i0 <= last).then(|| (i0 - 1, i0))
                }
            }
            None => {
                let i0 = ((t0 as f64 * last as f64).ceil() as usize).min(last);
                let i1 = ((t1 as f64 * last as f64).floor() as usize).min(last);
                Some(if i0 <= i1 { (i0, i1) } else { (i1, i0) })
            }
        }
    }

    fn update_offsets(&mut self) {
        self.offsets.clear();
        let mut acc = 0u32;
        for s in 0..self.series.len() {
            self.offsets.push(acc);
            acc = acc.saturating_add(self.len(s) as u32);
        }
    }

    /// Aggregates the per-series extents of each y axis (O(series)); `[0, 1]` without finite data.
    /// Style extents (bands, zero-filled gaps) count too.
    pub(crate) fn update_data_extent(&mut self) {
        let fold = |axis: u8| {
            let (lo, hi) = (0..self.ext.len())
                .filter(|&s| self.axis_of(s) == axis)
                .map(|s| {
                    let (a, b) = self.style.extra_extent(s);
                    (self.ext[s].0.min(a), self.ext[s].1.max(b))
                })
                .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), (a, b)| (lo.min(a), hi.max(b)));
            if lo <= hi {
                (lo, hi)
            } else {
                (0.0, 1.0)
            }
        };
        let (left, right) = (fold(0), fold(1));
        (self.data_min, self.data_max) = left;
        (self.right.data_min, self.right.data_max) = right;
    }

    /// Smallest average sample gap in `t` (O(series): first / last sample only).
    pub(super) fn update_min_gap(&mut self) {
        self.min_gap_t = (0..self.series.len())
            .filter_map(|s| {
                let len = self.len(s);
                (len > 1).then(|| (self.t_at64(s, len - 1) - self.t_at64(s, 0)) / (len - 1) as f64)
            })
            .filter(|&g| g > 0.0)
            .fold(1.0f64, f64::min) as f32;
    }

    /// Global x domain from the first / last live x of every series (O(series)). Keeps the
    /// current domain when no series has samples.
    pub(super) fn update_x_domain(&mut self) {
        let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
        for s in 0..self.series.len() {
            if let Some(x) = self.xs(s) {
                if let (Some(&a), Some(&b)) = (x.first(), x.last()) {
                    lo = lo.min(a);
                    hi = hi.max(b);
                }
            }
            if let Some(st) = self.style.sparse.get(s).and_then(Option::as_ref).filter(|st| st.horizontal) {
                for &v in st.low.iter().chain(&st.high) {
                    let v = self.x_data_to_abs(v as f64) - self.x_origin;
                    if v.is_finite() { lo = lo.min(v); hi = hi.max(v); }
                }
            }
        }
        if !lo.is_finite() {
            return;
        }
        (self.x_min, self.x_span) = if hi > lo {
            (self.x_origin + lo, hi - lo)
        } else {
            (self.x_origin + lo - 0.5, 1.0)
        };
    }

    /// Data x of a stored (origin-relative) x.
    #[inline]
    pub(crate) fn x_data(&self, rel: f64) -> f64 {
        self.x_abs_to_data(rel + self.x_origin)
    }

    /// Data x of an absolute stored x (`x_min` space: log10 units on a log x axis).
    #[inline]
    pub(crate) fn x_abs_to_data(&self, abs: f64) -> f64 {
        if self.x_log {
            10f64.powf(abs)
        } else {
            abs
        }
    }

    /// Absolute stored x of data `x` (NaN for x <= 0 on a log x axis).
    #[inline]
    pub(crate) fn x_data_to_abs(&self, x: f64) -> f64 {
        log_or_identity(self.x_log, x)
    }

    /// Data position of normalized `t`: absolute x, or index of the longest series.
    fn abs_of_t(&self, t: f64) -> f64 {
        if self.has_x() {
            self.x_min + t * self.x_span
        } else {
            t * self.max_len().saturating_sub(1) as f64
        }
    }

    /// Data units per unit of `t` (x span, or last index of the longest series).
    fn abs_span(&self) -> f64 {
        if self.has_x() {
            self.x_span
        } else {
            self.max_len().saturating_sub(1) as f64
        }
    }

    pub(super) fn window_anchor(&self) -> WindowAnchor {
        let (w0, w1) = self.window;
        if self.window == (0.0, 1.0) {
            return WindowAnchor::Full;
        }
        let (a0, a1) = (self.abs_of_t(w0 as f64), self.abs_of_t(w1 as f64));
        if w1 >= FOLLOW_EDGE {
            WindowAnchor::Follow(a1 - a0)
        } else {
            WindowAnchor::Fixed(a0, a1)
        }
    }

    /// Re-applies a window captured by `window_anchor` after the data moved. `index_shift`:
    /// samples dropped from the front of the longest series (index placement only).
    pub(super) fn restore_window(&mut self, anchor: WindowAnchor, index_shift: f64) {
        let span = self.abs_span();
        if span <= 0.0 {
            self.window = (0.0, 1.0);
            return;
        }
        match anchor {
            WindowAnchor::Full => self.window = (0.0, 1.0),
            WindowAnchor::Follow(a) => {
                let w = (a / span) as f32;
                self.set_window(1.0 - w, 1.0);
            }
            WindowAnchor::Fixed(a0, a1) => {
                let (a0, a1) = (a0 - index_shift, a1 - index_shift);
                let origin = if self.has_x() { self.x_min } else { 0.0 };
                self.set_window(((a0 - origin) / span) as f32, ((a1 - origin) / span) as f32);
            }
        }
    }

    /// Validates an update of series `s`: x present iff the chart has x, one per value, finite,
    /// sorted; appended x must not start before the series' last x.
    pub(super) fn check_update(&self, s: usize, values_len: usize, x: Option<&[f64]>, append: bool) -> Result<(), String> {
        if s >= self.series.len() {
            return Err(format!("series {s} out of range ({} series)", self.series.len()));
        }
        let x = match (self.has_x(), x) {
            (false, None) => return Ok(()),
            (true, None) if values_len == 0 => return Ok(()),
            (false, Some(_)) => return Err("chart has no x: pass values only".into()),
            (true, None) => return Err("chart has x: pass one x per value".into()),
            (true, Some(x)) => x,
        };
        if x.len() != values_len {
            return Err(format!("series {s}: x length {} != values length {values_len}", x.len()));
        }
        if let Some(k) = x.iter().position(|v| !v.is_finite()) {
            return Err(format!("series {s}: x[{k}] is not finite"));
        }
        if let Some(k) = x.windows(2).position(|w| w[1] < w[0]) {
            return Err(format!("series {s}: x must be sorted ascending (x[{}] < x[{k}])", k + 1));
        }
        if self.x_log {
            if let Some(k) = x.iter().position(|&v| v <= 0.0) {
                return Err(format!("series {s}: x[{k}] must be positive on a log x axis"));
            }
        }
        if append {
            let last = self.xs(s).and_then(|v| v.last()).map(|v| v + self.x_origin);
            if let (Some(last), Some(&first)) = (last, x.first()) {
                // Compared in storage space (log10 round trips may differ by an ulp)
                let stored = self.x_data_to_abs(first);
                let slack = if self.x_log { 1e-12 * last.abs().max(1.0) } else { 0.0 };
                if stored < last - slack {
                    let last = self.x_abs_to_data(last);
                    return Err(format!("series {s}: appended x {first} is before the last x {last}"));
                }
            }
        }
        Ok(())
    }

    /// Replaces one series' samples (styles and zoom window kept). Returns the new length.
    pub(crate) fn set_series_data(&mut self, s: usize, values: Vec<f32>, x: Option<Vec<f64>>) -> Result<usize, String> {
        self.check_update(s, values.len(), x.as_deref(), false)?;
        let anchor = self.window_anchor();
        let (origin, log) = (self.x_origin, self.x_log);
        let has_x = self.has_x();
        self.ext[s] = finite_extent(&values);
        self.pos_ext[s] = positive_extent(&values);
        let ser = &mut self.series[s];
        ser.values = values;
        ser.x = has_x.then(|| {
            let mut x = x.unwrap_or_default();
            x.iter_mut().for_each(|v| *v = store_x(*v, log, origin));
            x
        });
        // A kept band is stored-aligned: drop the trimmed prefix with the head
        let head_before = std::mem::replace(&mut self.head[s], 0);
        self.style.drain_front(s, head_before);
        self.style.on_set_data(s, &self.series[s].values);
        self.after_data_change(anchor, 0.0);
        Ok(self.len(s))
    }

    /// Streams samples onto series `s`; `max_points > 0` keeps only the newest `max_points`.
    /// Amortized O(appended) plus O(series) bookkeeping; the visible window is rebuilt on the
    /// next frame. Returns the new length.
    pub(crate) fn append_series_data(
        &mut self,
        s: usize,
        values: &[f32],
        x: Option<&[f64]>,
        max_points: usize,
    ) -> Result<usize, String> {
        self.check_update(s, values.len(), x, true)?;
        let anchor = self.window_anchor();
        let was_longest = self.len(s) == self.max_len();
        let (origin, log) = (self.x_origin, self.x_log);
        let ser = &mut self.series[s];
        ser.values.extend_from_slice(values);
        if let (Some(dst), Some(src)) = (ser.x.as_mut(), x) {
            dst.extend(src.iter().map(|&v| store_x(v, log, origin)));
        }
        let (a, b) = finite_extent(values);
        let e = &mut self.ext[s];
        *e = (e.0.min(a), e.1.max(b));
        let (a, b) = positive_extent(values);
        let e = &mut self.pos_ext[s];
        *e = (e.0.min(a), e.1.max(b));
        self.style.on_append(s, values, self.series[s].values.len());
        let dropped = self.trim(s, max_points);
        let shift = if was_longest && !self.has_x() { dropped as f64 } else { 0.0 };
        self.after_data_change(anchor, shift);
        Ok(self.len(s))
    }

    /// Drops the oldest samples of `s` beyond `max_points` (0 = unlimited); returns how many.
    fn trim(&mut self, s: usize, max_points: usize) -> usize {
        let len = self.len(s);
        if max_points == 0 || len <= max_points {
            return 0;
        }
        let drop = len - max_points;
        let head = self.head[s];
        let (lo, hi) = self.ext[s];
        let (plo, phi) = self.pos_ext[s];
        // The extents only need a rescan when an extreme leaves (amortized: rare)
        let leaving = &self.series[s].values[head..head + drop];
        let rescan = leaving.iter().any(|&v| v.is_finite() && (v <= lo || v >= hi));
        let rescan_pos = leaving.iter().any(|&v| v.is_finite() && v > 0.0 && (v <= plo || v >= phi));
        self.head[s] += drop;
        if rescan {
            self.ext[s] = finite_extent(self.vals(s));
        }
        if rescan_pos {
            self.pos_ext[s] = positive_extent(self.vals(s));
        }
        let head = self.head[s];
        if head > max_points.max(COMPACT_MIN) {
            // Each compaction moves fewer samples than were dropped since the last one
            let ser = &mut self.series[s];
            ser.values.drain(..head);
            if let Some(x) = ser.x.as_mut() {
                x.drain(..head);
            }
            self.style.drain_front(s, head);
            self.head[s] = 0;
        }
        drop
    }

    fn after_data_change(&mut self, anchor: WindowAnchor, index_shift: f64) {
        self.update_offsets();
        self.update_x_domain();
        self.update_data_extent();
        self.update_min_gap();
        self.restore_window(anchor, index_shift);
        self.update_y_domain(false);
    }

    /// Restacking changes all drawn tops without changing their x coordinates or lengths.
    pub(super) fn refresh_extents(&mut self) {
        for s in 0..self.series.len() {
            let (extent, positive) = extents(self.vals(s));
            self.ext[s] = extent;
            self.pos_ext[s] = positive;
        }
        self.update_data_extent();
        self.update_y_domain(false);
    }

    pub(crate) fn max_len(&self) -> usize {
        (0..self.series.len()).map(|s| self.len(s)).max().unwrap_or(0)
    }

    /// Samples carry explicit x (all series or none).
    #[inline]
    pub(crate) fn has_x(&self) -> bool {
        self.series.first().is_some_and(|s| s.x.is_some())
    }

    /// Normalized `t` of world x under the current zoom window.
    #[inline]
    pub(crate) fn t_of_x(&self, x: f32) -> f32 {
        let (w0, w1) = self.window;
        w0 + (x * self.x_scale.sign() / self.layout.width + 0.5) * (w1 - w0)
    }

    /// `t_of_x` in f64 (dash phase anchors: at deep zoom `t * px_per_t` needs more than f32).
    #[inline]
    pub(crate) fn t_of_x64(&self, x: f32) -> f64 {
        let (w0, w1) = (self.window.0 as f64, self.window.1 as f64);
        w0 + (x as f64 * self.x_scale.sign() as f64 / self.layout.width as f64 + 0.5) * (w1 - w0)
    }

    /// World x of normalized `t` under the current zoom window (f64 so explicit x keeps its
    /// precision until the last step; mirrored on a reversed x axis).
    #[inline]
    pub(crate) fn x_of_t(&self, t: f64) -> f32 {
        let (w0, w1) = (self.window.0 as f64, self.window.1 as f64);
        (((t - w0) / (w1 - w0).max(1e-9) - 0.5) * self.layout.width as f64) as f32 * self.x_scale.sign()
    }

    /// Smallest zoom window: about 8 samples of the densest series, floored at a few f32 ulps of
    /// `t` (the window is f32) so very dense data cannot zoom into quantization noise.
    pub(crate) fn min_window_span(&self) -> f32 {
        (8.0 * self.min_gap_t).clamp(32.0 * f32::EPSILON, 1.0)
    }

    pub(crate) fn set_window(&mut self, w0: f32, w1: f32) {
        let span = (w1 - w0).clamp(self.min_window_span(), 1.0);
        let start = w0.clamp(0.0, 1.0 - span);
        self.window = (start, start + span);
    }

    /// Zooms the x window by `factor` (< 1 = in) keeping the data under `anchor_t` fixed.
    pub(crate) fn zoom_x(&mut self, factor: f32, anchor_t: f32) {
        let (w0, w1) = self.window;
        let span = w1 - w0;
        let new_span = (span * factor).clamp(self.min_window_span(), 1.0);
        let a = anchor_t.clamp(w0, w1);
        let start = a - (a - w0) * (new_span / span.max(1e-9));
        self.set_window(start, start + new_span);
    }

    #[inline]
    pub(super) fn t_at64(&self, series: usize, index: usize) -> f64 {
        if let Some(x) = self.xs(series) {
            return (x[index] - self.x_shift()) / self.x_span;
        }
        let len = self.len(series);
        if len <= 1 {
            0.5
        } else {
            index as f64 / (len - 1) as f64
        }
    }

    #[inline]
    pub(crate) fn t_at(&self, series: usize, index: usize) -> f32 {
        self.t_at64(series, index) as f32
    }

    #[inline]
    pub(crate) fn x_at(&self, series: usize, index: usize) -> f32 {
        self.x_of_t(self.t_at64(series, index))
    }

    /// Sample range covering `[t0, t1]` plus one neighbour on each side, so edge segments reach
    /// past the window (binary search on x, arithmetic on index).
    pub(crate) fn index_range(&self, series: usize, t0: f32, t1: f32) -> Option<(usize, usize)> {
        let last = self.len(series).checked_sub(1)?;
        Some(match self.xs(series) {
            Some(x) => {
                let shift = self.x_shift();
                let (a, b) = (t0 as f64 * self.x_span + shift, t1 as f64 * self.x_span + shift);
                (x.partition_point(|&v| v < a).saturating_sub(1), x.partition_point(|&v| v <= b).min(last))
            }
            None => (
                ((t0 * last as f32).floor() as usize).saturating_sub(1),
                (((t1 * last as f32).ceil() as usize) + 1).min(last),
            ),
        })
    }

    /// World y of scale-space `u` on y axis `axis` (mirrored when reversed).
    #[inline]
    fn y_world(&self, axis: u8, u: f32) -> f32 {
        let (min, span, sign) = if axis == 0 {
            (self.y_min, self.y_span, self.y_scale.sign())
        } else {
            (self.right.y_min, self.right.y_span, self.right.scale.sign())
        };
        ((u - min) / span - 0.5) * self.layout.height * sign
    }

    /// World y of value `v` on the left axis (NaN when not drawable on its scale).
    #[inline]
    pub(crate) fn y_of(&self, v: f32) -> f32 {
        self.y_world(0, self.y_scale.fwd32(v))
    }

    #[inline]
    pub(crate) fn y_of_axis(&self, axis: u8, v: f32) -> f32 {
        self.y_world(axis, self.scale_of_axis(axis).fwd32(v))
    }

    /// World y of the zero baseline clamped into the left domain (log: the domain bottom).
    pub(crate) fn y_baseline(&self) -> f32 {
        let u = if self.y_scale.is_log() { self.y_min } else { 0.0f32.clamp(self.y_min, self.y_min + self.y_span) };
        self.y_world(0, u)
    }

    /// Left-axis world y of a band edge: non-positive values on a log axis sit on the baseline.
    pub(crate) fn y_of_or_base(&self, v: f32) -> f32 {
        if self.y_scale.is_log() && v <= 0.0 {
            self.y_baseline()
        } else {
            self.y_of(v)
        }
    }

    /// Sample value is drawn on its series' y scale (finite; positive on a log axis).
    #[inline]
    pub(crate) fn drawable(&self, series: usize, v: f32) -> bool {
        self.scale_of_axis(self.axis_of(series)).drawable(v)
    }

    pub(crate) fn point(&self, series: usize, index: usize) -> Vec3 {
        Vec3::new(
            self.x_at(series, index),
            self.y_of_axis(self.axis_of(series), self.vals(series)[index]),
            self.z[series],
        )
    }

    /// Visible normalized-x window and screen density for the current camera.
    pub(crate) fn view_window(&self, view: &ChartView) -> Option<LodWindow> {
        let z0 = self.z.first().copied().unwrap_or(0.0);
        let half = self.layout.width * 0.5;
        let a = view.project_px(Vec3::new(-half, 0.0, z0))?;
        let b = view.project_px(Vec3::new(half, 0.0, z0))?;
        let span_px = (b.0 - a.0).abs().max(1.0);
        let reversed = view.camera.eye_position().z < 0.0;
        match self.layout.view {
            ChartViewMode::Depth => Some(LodWindow {
                // Perspective view: decimate the full range at roughly screen resolution
                t0: 0.0,
                t1: 1.0,
                px_per_t: span_px.clamp(64.0, 4.0 * view.viewport_px.0 as f32),
                reversed,
            }),
            ChartViewMode::Flat => {
                let half_vw = 0.5 * view.viewport_px.0 as f32;
                // t of a screen x; works for mirrored views (camera behind the plane) too
                let dx = b.0 - a.0;
                let dx = if dx.abs() < 1e-3 { 1e-3 } else { dx };
                let fa = ((-half_vw - a.0) / dx).clamp(0.0, 1.0);
                let fb = ((half_vw - a.0) / dx).clamp(0.0, 1.0);
                // Reversed x: world -half is the window end
                let (fa, fb) = if self.x_scale.reverse { (1.0 - fa, 1.0 - fb) } else { (fa, fb) };
                // Screen fraction of the plot -> data t through the zoom window
                let (w0, w1) = self.window;
                let span_t = (w1 - w0).max(1e-9);
                Some(LodWindow {
                    t0: w0 + fa.min(fb) * span_t,
                    t1: w0 + fa.max(fb) * span_t,
                    px_per_t: span_px / span_t,
                    reversed,
                })
            }
        }
    }

    /// Pixel-column buckets `[from, to)` (ascending, live sample indices) of one series in
    /// `window`: one bucket per sample where samples are sparser than ~2 per pixel. Buckets are
    /// aligned to absolute x / indices, so panning never reshuffles which samples share one.
    pub(crate) fn lod_buckets(&self, s_idx: usize, window: &LodWindow, mut bucket: impl FnMut(usize, usize)) {
        let len = self.len(s_idx);
        if len < 2 {
            return;
        }
        let Some((i0, i1)) = self.index_range(s_idx, window.t0, window.t1) else {
            return;
        };
        if i1 <= i0 {
            return;
        }
        if let Some(x) = self.xs(s_idx) {
            // Buckets are physical pixel columns of x (irregular spacing)
            let px_per_x = window.px_per_t.max(1.0) as f64 / self.x_span;
            let mut from = i0;
            while from <= i1 {
                let b = (x[from] * px_per_x).floor();
                let mut to = from + 1;
                while to <= i1 && (x[to] * px_per_x).floor() == b {
                    to += 1;
                }
                bucket(from, to);
                from = to;
            }
        } else {
            // Samples per physical pixel
            let samples_per_px = (len - 1) as f32 / window.px_per_t.max(1.0);
            if samples_per_px <= 2.0 {
                (i0..=i1).for_each(|i| bucket(i, i + 1));
            } else {
                let size = samples_per_px;
                let b0 = (i0 as f32 / size).floor() as usize;
                let b1 = (i1 as f32 / size).ceil() as usize;
                for b in b0..=b1 {
                    let from = ((b as f32 * size) as usize).max(i0);
                    let to = ((((b + 1) as f32) * size) as usize).min(i1 + 1);
                    if from < to {
                        bucket(from, to);
                    }
                }
            }
        }
    }

    /// M4 picks (ascending sample indices) of one series in `window`: the samples
    /// `build_segments` connects. Area fills reuse them so fill edges follow the strokes.
    pub(crate) fn lod_picks(&self, s_idx: usize, window: &LodWindow, picks: &mut Vec<usize>) {
        picks.clear();
        // Live samples only (streamed series keep a trimmed prefix until compaction)
        let values = self.vals(s_idx);
        let nan_zero = self.style.nulls(s_idx) == NullPolicy::Zero;
        self.lod_buckets(s_idx, window, |from, to| push_m4(values, from, to, picks, nan_zero));
    }

    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if !style.show_grid {
            return;
        }
        let z = self.z.iter().copied().fold(0.0f32, f32::min) - 0.5;
        let half_w = self.layout.width * 0.5;
        // A manual y zoom (zoom.rs) cuts between ticks: its baseline is the domain bottom
        let pinned = self.y_zoom.is_some();
        if pinned {
            let y = self.y_world(0, self.y_min);
            out.push(ChartSegmentRaw {
                p0_width: [-half_w, y, z, style.stroke_px],
                p1_pad: [half_w, y, z, 0.0],
                color: style.baseline_color,
            });
        }
        // Gridlines follow the left axis only (right axis ticks have no grid)
        for (k, v) in self.y_ticks(0).into_iter().enumerate() {
            // A tick on the pinned bottom would cover the baseline
            if pinned && (self.y_scale.fwd(v) - self.y_min as f64).abs() <= 1e-6 * self.y_span as f64 {
                continue;
            }
            let y = self.y_of(v as f32);
            out.push(ChartSegmentRaw {
                p0_width: [-half_w, y, z, style.stroke_px],
                p1_pad: [half_w, y, z, 0.0],
                // The bottom of the domain is the baseline
                color: if k == 0 && !pinned { style.baseline_color } else { style.grid_color },
            });
        }
    }

    /// Plot rectangle and visible y / x ticks in CSS px (2D view only).
    pub(crate) fn axes(&self, view: &ChartView, tz: &TimeZone, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = [0.0; 4];
        if self.layout.view != ChartViewMode::Flat {
            return;
        }
        let z0 = self.z.first().copied().unwrap_or(0.0);
        let half_w = self.layout.width * 0.5;
        let half_h = self.layout.height * 0.5;
        let Some(plot) = plot_rect_css(view, half_w, -half_h, half_h, z0) else {
            return;
        };
        out.plot_css = plot;
        for v in self.y_ticks(0) {
            if let Some((_, y)) = view.project_css(Vec3::new(-half_w, self.y_of(v as f32), z0)) {
                out.ticks.push(AxisTick { axis: 1, value: v, x_css: plot[0], y_css: y, granularity: 0 });
            }
        }
        // Right axis ticks anchor on the plot's right edge
        if self.has_right() {
            for v in self.y_ticks(1) {
                if let Some((_, y)) = view.project_css(Vec3::new(half_w, self.y_of_axis(1, v as f32), z0)) {
                    out.ticks.push(AxisTick { axis: 2, value: v, x_css: plot[0] + plot[2], y_css: y, granularity: 0 });
                }
            }
        }
        // x ticks inside the zoom window, ~1 per 90 px (or the tick hint): explicit x values
        // (nice numbers, decades on a log axis, or calendar boundaries in `tz`), else sample indices
        // of the longest series
        let target = self.x_scale.target(((plot[2] / 90.0).floor() as u32).max(2));
        let bottom = plot[1] + plot[3];
        let (w0, w1) = (self.window.0 as f64, self.window.1 as f64);
        // (t, value, granularity)
        let ticks: Vec<(f64, f64, u8)> = if self.has_x() {
            let (lo, hi) = (self.x_min + w0 * self.x_span, self.x_min + w1 * self.x_span);
            let values = match self.layout.x_kind {
                _ if self.x_log => log_ticks(10f64.powf(lo), 10f64.powf(hi), target).into_iter().map(|v| (v, 0)).collect(),
                LineXKind::Time => time_ticks_tz(lo, hi, target, tz),
                LineXKind::Numeric => ticks_between(lo, hi, nice_step(hi - lo, target))
                    .into_iter()
                    .map(|v| (v, 0))
                    .collect(),
            };
            values
                .into_iter()
                .map(|(v, g)| ((self.x_data_to_abs(v) - self.x_min) / self.x_span, v, g))
                .collect()
        } else {
            let len = self.max_len();
            if len < 2 {
                return;
            }
            let last = (len - 1) as f64;
            let (i0, i1) = (w0 * last, w1 * last);
            let step = nice_step(i1 - i0, target).max(1.0).round();
            ticks_between(i0, i1, step).into_iter().map(|idx| (idx / last, idx, 0)).collect()
        };
        for (t, value, granularity) in ticks {
            if let Some((cx, _)) = view.project_css(Vec3::new(self.x_of_t(t), -half_h, z0)) {
                out.ticks.push(AxisTick { axis: 0, value, x_css: cx, y_css: bottom, granularity });
            }
        }
    }

    /// Plot rect in physical px for scissoring zoomed series (2D only).
    pub(crate) fn clip_px(&self, view: &ChartView) -> Option<[u32; 4]> {
        if self.layout.view != ChartViewMode::Flat || (self.window == (0.0, 1.0) && self.y_zoom.is_none()) {
            return None;
        }
        let z0 = self.z.first().copied().unwrap_or(0.0);
        let half_w = self.layout.width * 0.5;
        let half_h = self.layout.height * 0.5;
        let plot = plot_rect_css(view, half_w, -half_h, half_h, z0)?;
        let pr = view.pixel_ratio;
        // Keep the stroke half-width above / below the plot so peaks are not shaved (a manual y
        // zoom cuts exactly at the plot edges: the data runs on past them)
        let pad = if self.y_zoom.is_some() { 0.0 } else { 8.0 * pr };
        let (vw, vh) = (view.viewport_px.0 as f32, view.viewport_px.1 as f32);
        let x0 = (plot[0] * pr).clamp(0.0, vw);
        let y0 = (plot[1] * pr - pad).clamp(0.0, vh);
        let x1 = ((plot[0] + plot[2]) * pr).clamp(0.0, vw);
        let y1 = ((plot[1] + plot[3]) * pr + pad).clamp(0.0, vh);
        Some([x0 as u32, y0 as u32, (x1 - x0).max(1.0) as u32, (y1 - y0).max(1.0) as u32])
    }

    /// Sample nearest to `t` (by x when given, else by index).
    pub(crate) fn sample_index_at_t(&self, series: usize, t: f32) -> Option<usize> {
        let len = self.len(series);
        if len == 0 {
            return None;
        }
        let t = t.clamp(0.0, 1.0);
        let Some(x) = self.xs(series) else {
            return Some((t * (len - 1) as f32).round() as usize);
        };
        let target = t as f64 * self.x_span + self.x_shift();
        let i = x.partition_point(|&v| v < target);
        Some(if i == 0 {
            0
        } else if i >= len || target - x[i - 1] <= x[i] - target {
            i - 1
        } else {
            i
        })
    }

    /// Ordered range of a standalone band sample, in data units.
    pub(crate) fn band_interval(&self, s: usize, i: usize) -> Option<(f32, f32)> {
        let band = self.style.band(s)?;
        band.edge_widths?;
        let k = self.head[s] + i;
        let (a, b) = (*band.lower.get(k)?, *band.upper.get(k)?);
        (self.drawable(s, a) && self.drawable(s, b)).then_some((a.min(b), a.max(b)))
    }

    fn pick_point(&self, s: usize, i: usize, cursor_y: f32) -> Vec3 {
        let mut p = self.point(s, i);
        if let Some((a, b)) = self.band_interval(s, i) {
            let (a, b) = (self.y_of_axis(self.axis_of(s), a), self.y_of_axis(self.axis_of(s), b));
            p.y = cursor_y.clamp(a.min(b), a.max(b));
        }
        p
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32), style: &ChartHoverStyle) -> Option<HoverResult> {
        if self.style.sparse.iter().any(Option::is_some) {
            return self.sparse_hover(view, ndc, style);
        }
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let cursor = view.ndc_to_px(ndc.0, ndc.1);
        let use_index = style.mode == HoverMode::Index && self.layout.view == ChartViewMode::Flat;

        let mut items: Vec<HoverItem> = Vec::new();
        let mut best: Option<(usize, f32)> = None; // (slot, px distance)

        if use_index {
            let z0 = self.z.first().copied()?;
            let hit = ray_hit_z_plane(&ray, z0)?;
            let half_h = self.layout.height * 0.5;
            if hit.y.abs() > half_h * (1.0 + HOVER_Y_SLACK * 2.0) {
                return None;
            }
            // Pointer must be over the plot (plus half a sample at the edges)
            let edge_t = 0.5 * self.min_gap_t;
            let edge_x = edge_t * self.layout.width / (self.window.1 - self.window.0).max(1e-9);
            if hit.x.abs() > self.layout.width * 0.5 + edge_x.min(self.layout.width * 0.05) {
                return None;
            }
            let t = self.t_of_x(hit.x);
            for s in (0..self.series.len()).filter(|&s| self.visible[s]) {
                let Some(i) = self.sample_index_at_t(s, t) else {
                    continue;
                };
                // Explicit x: skip series whose samples do not reach the pointer x
                if self.has_x() {
                    let Some(last) = self.len(s).checked_sub(1) else {
                        continue;
                    };
                    if t < self.t_at(s, 0) - edge_t || t > self.t_at(s, last) + edge_t {
                        continue;
                    }
                }
                let v = self.vals(s)[i];
                if !self.drawable(s, v) || (self.style.band(s).is_some_and(|b| b.edge_widths.is_some()) && self.band_interval(s, i).is_none()) {
                    continue;
                }
                let slot = items.len();
                items.push(HoverItem {
                    series: s as u32,
                    index: i as u32,
                    value: v,
                    global_id: self.offsets[s] + i as u32,
                });
                if let Some(p) = view.project_px(self.pick_point(s, i, hit.y)) {
                    let d = (p.1 - cursor.1).abs();
                    if best.is_none_or(|(_, bd)| d < bd) {
                        best = Some((slot, d));
                    }
                }
            }
        } else {
            let limit = style.hit_radius_px * view.pixel_ratio;
            let mut best_item: Option<(HoverItem, f32)> = None;
            for s in (0..self.series.len()).filter(|&s| self.visible[s]) {
                if self.len(s) == 0 {
                    continue;
                }
                let Some(hit) = ray_hit_z_plane(&ray, self.z[s]) else {
                    continue;
                };
                if self.layout.view == ChartViewMode::Flat && hit.x.abs() > self.layout.width * 0.5 {
                    continue;
                }
                let t = self.t_of_x(hit.x);
                let Some(center) = self.sample_index_at_t(s, t) else {
                    continue;
                };
                // Samples within the pick radius (in t), at most NEAREST_MAX_WINDOW per side
                let reach = self.view_window(view).map_or(0.0, |w| limit / w.px_per_t.max(1.0));
                let Some((from, to)) = self.index_range(s, t - reach, t + reach) else {
                    continue;
                };
                let from = from.min(center).max(center.saturating_sub(NEAREST_MAX_WINDOW));
                let to = to.max(center).min(center + NEAREST_MAX_WINDOW);
                for i in from..=to {
                    let v = self.vals(s)[i];
                    if !self.drawable(s, v) || (self.style.band(s).is_some_and(|b| b.edge_widths.is_some()) && self.band_interval(s, i).is_none()) {
                        continue;
                    }
                    let Some(p) = view.project_px(self.pick_point(s, i, hit.y)) else {
                        continue;
                    };
                    let d = ((p.0 - cursor.0).powi(2) + (p.1 - cursor.1).powi(2)).sqrt();
                    if d <= limit && best_item.is_none_or(|(_, bd)| d < bd) {
                        best_item = Some((
                            HoverItem {
                                series: s as u32,
                                index: i as u32,
                                value: v,
                                global_id: self.offsets[s] + i as u32,
                            },
                            d,
                        ));
                    }
                }
            }
            let (item, d) = best_item?;
            items.push(item);
            best = Some((0, d));
        }

        if items.is_empty() {
            return None;
        }
        Some(HoverResult {
            is_bar: false,
            primary: best.map_or(0, |(slot, _)| slot),
            items,
        })
    }

    pub(crate) fn build_overlay(
        &self,
        hover: &HoverResult,
        style: &ChartHoverStyle,
        overlay: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        overlay.clear();
        markers.clear();
        let Some(primary) = hover.items.get(hover.primary) else {
            return;
        };
        if style.crosshair && self.layout.view == ChartViewMode::Flat {
            let x = self.x_at(primary.series as usize, primary.index as usize);
            let half_h = self.layout.height * 0.5;
            let z = self.z.iter().copied().fold(0.0f32, f32::max);
            overlay.push(ChartSegmentRaw {
                p0_width: [x, -half_h, z, style.crosshair_width_px],
                p1_pad: [x, half_h, z, 0.0],
                color: style.crosshair_color,
            });
        }
        if style.marker {
            for item in &hover.items {
                let s = item.series as usize;
                let p = self.point(s, item.index as usize);
                let range = self.band_interval(s, item.index as usize);
                let ys = range.map_or([p.y; 2], |(a, b)| [self.y_of_axis(self.axis_of(s), a), self.y_of_axis(self.axis_of(s), b)]);
                for &y in ys.iter().take(if range.is_some() { 2 } else { 1 }) {
                    markers.push(ChartMarkerRaw {
                        center_radius: [p.x, y, p.z, style.marker_radius_px],
                        fill: self.series[s].color,
                        ring: style.marker_ring_color,
                        params: [style.marker_ring_px, 0.0, 0.0, 0.0],
                    });
                }
            }
        }
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        match self.layout.view {
            ChartViewMode::Flat => {
                frame_flat(camera, css, self.layout.width, self.layout.height, padding);
            }
            ChartViewMode::Depth => {
                let depth = self.series.len() as f32 * SERIES_Z_STEP_LAYERED;
                let half = Vec3::new(self.layout.width, self.layout.height, depth) * 0.5;
                frame_oblique(camera, Vec3::ZERO, half.length());
            }
        }
    }
}


#[cfg(test)]
mod perf_tests;

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-01-01T00:00:00Z in epoch ms
    const T0: f64 = 1_767_225_600_000.0;
    const DAY: f64 = 86_400_000.0;

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn xy_state(series: Vec<(Vec<f64>, Vec<f32>)>, x_kind: LineXKind) -> (OrbitCamera, ChartState) {
        let series = series
            .into_iter()
            .map(|(x, values)| LineSeries {
                values,
                x: Some(x),
                color: [1.0, 0.0, 0.0, 1.0],
                width_px: 2.0,
            })
            .collect();
        let chart = ChartState::new_line(
            series,
            LineLayout {
                width: 160.0,
                height: 80.0,
                view: ChartViewMode::Flat,
                x_kind,
            },
        );
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn line(chart: &ChartState) -> &LineChart {
        match &chart.kind {
            ChartKind::Line(l) => l,
            _ => unreachable!(),
        }
    }

    /// NDC of the plot point at relative x position `x` (data units) and y = 0.
    fn ndc_at_x(chart: &ChartState, cam: &OrbitCamera, x: f64) -> (f32, f32) {
        let l = line(chart);
        let wx = l.x_of_t((x - l.x_min) / l.x_span);
        let p = cam.project_to_ndc(Vec3::new(wx, 0.0, 0.0)).unwrap();
        (p.x, p.y)
    }

    fn line_mut(chart: &mut ChartState) -> &mut LineChart {
        match &mut chart.kind {
            ChartKind::Line(l) => l,
            _ => unreachable!(),
        }
    }

    fn index_state(values: Vec<Vec<f32>>) -> (OrbitCamera, ChartState) {
        let series = values
            .into_iter()
            .map(|values| LineSeries { values, x: None, color: [1.0; 4], width_px: 2.0 })
            .collect();
        let chart = ChartState::new_line(
            series,
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        );
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn visible_axis() -> LineYAxis {
        LineYAxis { autoscale: YAutoscale::Visible, ..Default::default() }
    }

    #[test]
    fn visible_autoscale_follows_the_zoom_window_and_updates_axes() {
        // Low plateau (0..10) then a high plateau (100..110)
        let values: Vec<f32> = (0..1000).map(|i| if i < 500 { (i % 10) as f32 } else { 100.0 + (i % 10) as f32 }).collect();
        let (cam, mut chart) = index_state(vec![values]);
        let v = view(&cam);
        chart.prepare_layers(&v);
        assert_eq!(chart.y_domain().unwrap(), (0.0, 120.0, 20.0), "default: all data");
        chart.set_y_axis(visible_axis());
        // Unzoomed: visible extent = all data
        assert_eq!(chart.y_domain().unwrap(), (0.0, 120.0, 20.0));
        let rev = chart.axes_revision();
        line_mut(&mut chart).set_window(0.1, 0.3);
        chart.on_window_changed();
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert_eq!((lo, hi), (0.0, 10.0), "zoomed into the low plateau");
        let layers = chart.prepare_layers(&v);
        assert!(layers.underlay.is_some() && layers.series.is_some());
        assert_ne!(chart.axes_revision(), rev);
        let ys: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 1).map(|t| t.value).collect();
        assert_eq!(ys.first().copied(), Some(0.0));
        assert_eq!(ys.last().copied(), Some(10.0));
        // Hidden series leave the visible extent
        let (cam2, mut two) = index_state(vec![vec![0.0, 1.0, 2.0, 3.0], vec![50.0, 60.0, 70.0, 80.0]]);
        two.set_y_axis(visible_axis());
        let mut scene = SceneWorld::new();
        two.set_series_visible(1, false, &mut scene);
        assert_eq!(two.y_domain().unwrap().1, 3.0);
        let _ = cam2;
    }

    #[test]
    fn visible_autoscale_has_hysteresis() {
        // Three regimes: 0..99, then 25..90 (inside, 65% of the domain), then 40..59 (narrow)
        let values: Vec<f32> = (0..10_000)
            .map(|i| match i {
                0..5000 => (i % 100) as f32,
                5000..8000 => 25.0 + (i % 66) as f32,
                _ => 40.0 + (i % 20) as f32,
            })
            .collect();
        let (_, mut chart) = index_state(vec![values]);
        chart.set_y_axis(visible_axis());
        let pan = |chart: &mut ChartState, w0: f32, w1: f32| {
            line_mut(chart).set_window(w0, w1);
            chart.on_window_changed();
            chart.y_domain().unwrap()
        };
        assert_eq!(pan(&mut chart, 0.1, 0.2), (0.0, 100.0, 20.0));
        // Extent [25, 90] stays inside and spans >= 60%: kept (a fresh fit would be [20, 90])
        assert_eq!(pan(&mut chart, 0.6, 0.7), (0.0, 100.0, 20.0), "no jitter");
        assert_eq!(pan(&mut chart, 0.45, 0.55), (0.0, 100.0, 20.0));
        // Extent [40, 59] spans < 60%: re-fit tighter
        assert_eq!(pan(&mut chart, 0.85, 0.95), (40.0, 60.0, 5.0));
        // Extent leaves the domain: re-fit
        assert_eq!(pan(&mut chart, 0.1, 0.2), (0.0, 100.0, 20.0));
        // Option changes skip the hysteresis
        chart.set_y_axis(visible_axis());
        assert_eq!(pan(&mut chart, 0.6, 0.7), (0.0, 100.0, 20.0));
        chart.set_frame_style(ChartFrameStyle { grid_rows: 5, ..Default::default() });
        chart.set_y_axis(LineYAxis { nice: false, ..visible_axis() });
        assert_eq!(chart.y_domain().unwrap().0 as f32, 25.0);
    }

    #[test]
    fn fixed_y_ends_override_autoscale_and_nice_can_be_off() {
        let (_, mut chart) = index_state(vec![vec![3.0, 47.0, 12.0]]);
        chart.set_y_axis(LineYAxis { min: Some(0.0), ..Default::default() });
        assert_eq!(chart.y_domain().unwrap(), (0.0, 50.0, 10.0));
        chart.set_y_axis(LineYAxis { max: Some(100.0), nice: false, ..Default::default() });
        let (lo, hi, _) = chart.y_domain().unwrap();
        assert_eq!((lo as f32, hi), (3.0, 100.0));
        // Swapped ends are put in order; NaN = from the data
        chart.set_y_axis(LineYAxis { min: Some(10.0), max: Some(-10.0), ..Default::default() });
        assert_eq!(chart.y_domain().unwrap().0, -10.0);
        chart.set_y_axis(LineYAxis { min: Some(f64::NAN), ..Default::default() });
        assert_eq!(chart.y_domain().unwrap().0, 0.0);
        // `None`: data updates leave the domain alone
        chart.set_y_axis(LineYAxis { autoscale: YAutoscale::None, ..Default::default() });
        let d = chart.y_domain().unwrap();
        chart.append_series_data(0, &[500.0], None, 0).unwrap();
        assert_eq!(chart.y_domain().unwrap(), d);
        // `All`: they do
        chart.set_y_axis(LineYAxis::default());
        assert_eq!(chart.y_domain().unwrap().1, 500.0);
    }

    #[test]
    fn append_follows_the_latest_data_when_pinned_right() {
        let x: Vec<f64> = (0..1000).map(|i| i as f64).collect();
        let (cam, mut chart) = xy_state(vec![(x, vec![1.0; 1000])], LineXKind::Numeric);
        let v = view(&cam);
        // Zoom to the last 100 x units
        line_mut(&mut chart).set_window(0.9, 1.0);
        chart.on_window_changed();
        let more: Vec<f64> = (1000..1500).map(|i| i as f64).collect();
        assert_eq!(chart.append_series_data(0, &[2.0; 500], Some(&more), 0).unwrap(), 1500);
        let l = line(&chart);
        let (w0, w1) = l.window;
        assert_eq!(w1, 1.0, "still pinned right");
        let span_x = (w1 - w0) as f64 * l.x_span;
        assert!((span_x - 99.9).abs() < 0.1, "absolute span kept: {span_x}");
        // New samples are drawn
        let segs = chart.prepare_layers(&v).series.unwrap().to_vec();
        assert!(segs.iter().any(|s| s.p1_pad[1] > l_y(&chart, 1.5)));
        // Not at the right edge: the absolute x window stays put
        line_mut(&mut chart).set_window(0.2, 0.4);
        chart.on_window_changed();
        let before = abs_window(&chart);
        let more: Vec<f64> = (1500..2000).map(|i| i as f64).collect();
        chart.append_series_data(0, &[3.0; 500], Some(&more), 0).unwrap();
        let after = abs_window(&chart);
        assert!((before.0 - after.0).abs() < 0.05 && (before.1 - after.1).abs() < 0.05, "{before:?} {after:?}");
        // Unzoomed charts keep showing everything
        chart.reset_zoom();
        chart.append_series_data(0, &[1.0], Some(&[2000.0]), 0).unwrap();
        assert_eq!(chart.x_window(), (0.0, 1.0));
        // x must not go back; x is required on an x chart
        assert!(chart.append_series_data(0, &[1.0], Some(&[10.0]), 0).is_err());
        assert!(chart.append_series_data(0, &[1.0], None, 0).is_err());
        assert!(chart.append_series_data(3, &[1.0], Some(&[3000.0]), 0).is_err());
    }

    fn l_y(chart: &ChartState, v: f32) -> f32 {
        line(chart).y_of(v)
    }

    fn abs_window(chart: &ChartState) -> (f64, f64) {
        let l = line(chart);
        (l.x_min + l.window.0 as f64 * l.x_span, l.x_min + l.window.1 as f64 * l.x_span)
    }

    #[test]
    fn max_points_trims_the_oldest_and_rebases_ids() {
        let (_, mut chart) = index_state(vec![vec![0.0, 1.0], vec![7.0]]);
        // Stream far past the compaction threshold, one chunk at a time
        let mut next = 2.0f32;
        for _ in 0..400 {
            let chunk: Vec<f32> = (0..25).map(|k| next + k as f32).collect();
            next += 25.0;
            chart.append_series_data(0, &chunk, None, 1000).unwrap();
        }
        let l = line(&chart);
        assert_eq!(l.len(0), 1000);
        assert!(l.head[0] <= COMPACT_MIN.max(1000), "dead prefix compacted: {}", l.head[0]);
        // Ids re-based: index 0 = oldest kept sample, series 1 offset = new length of series 0
        assert_eq!(chart.sample(0).unwrap().2, next - 1000.0);
        assert_eq!(chart.sample(999).unwrap().2, next - 1.0);
        assert_eq!(chart.sample(1000).unwrap().0, 1);
        assert_eq!(chart.sample_x(999), Some(999.0));
        assert_eq!(chart.line_values(0).unwrap().len(), 1000);
        // The minimum left with the trimmed samples: the extent was rescanned
        assert_eq!(l.ext[0], (next - 1000.0, next - 1.0));
        assert_eq!((l.data_min, l.data_max), (7.0, next - 1.0));
        assert!(chart.y_domain().unwrap().1 >= next as f64 - 1.0);
        assert_eq!(chart.point_count(), 1001);
    }

    #[test]
    fn set_series_data_keeps_the_window_and_styles() {
        let x: Vec<f64> = (0..=100).map(|i| T0 + i as f64 * 1000.0).collect();
        let (cam, mut chart) = xy_state(vec![(x, vec![1.0; 101])], LineXKind::Time);
        chart.set_line_width(None, 5.0);
        line_mut(&mut chart).set_window(0.25, 0.5);
        chart.on_window_changed();
        let before = abs_window(&chart);
        // New data over a wider x range with the same absolute window of interest
        let x2: Vec<f64> = (-100..=200).map(|i| T0 + i as f64 * 1000.0).collect();
        let n = x2.len();
        assert_eq!(chart.set_series_data(0, vec![2.0; n], Some(x2.clone())).unwrap(), n);
        let after = abs_window(&chart);
        assert!((before.0 - after.0).abs() < 2.0 && (before.1 - after.1).abs() < 2.0, "{before:?} {after:?}");
        assert_eq!(line(&chart).x_min, T0 - 100_000.0);
        assert_eq!(chart.line_x(0).unwrap(), x2);
        let segs = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        assert!(!segs.is_empty() && segs.iter().all(|s| s.p0_width[3] == 5.0), "width kept");
        // Validation: lengths, order, x presence
        assert!(chart.set_series_data(0, vec![1.0; 3], Some(vec![0.0, 1.0])).is_err());
        assert!(chart.set_series_data(0, vec![1.0; 2], Some(vec![1.0, 0.0])).is_err());
        assert!(chart.set_series_data(0, vec![1.0; 2], None).is_err());
        let (_, mut idx) = index_state(vec![vec![1.0; 4]]);
        assert!(idx.set_series_data(0, vec![1.0], Some(vec![0.0])).is_err());
        assert_eq!(idx.set_series_data(0, vec![], None).unwrap(), 0);
    }

    #[test]
    fn data_updates_re_pick_the_hover_at_the_resting_pointer() {
        let (cam, mut chart) = index_state(vec![(0..101).map(|i| i as f32).collect()]);
        let mut scene = SceneWorld::new();
        let v = view(&cam);
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        assert_eq!(chart.hover_at(&v, &mut scene, (c.x, c.y)).unwrap().items[0].index, 50);
        chart.set_series_data(0, (0..201).map(|i| i as f32).collect(), None).unwrap();
        assert!(chart.hover.is_none(), "stale ids dropped");
        chart.refresh_hover(&v, &mut scene);
        assert_eq!(chart.hover.as_ref().unwrap().items[0].index, 100);
        chart.clear_hover(&mut scene);
        chart.append_series_data(0, &[1.0], None, 0).unwrap();
        chart.refresh_hover(&v, &mut scene);
        assert!(chart.hover.is_none(), "pointer left: no re-pick");
    }

    #[test]
    fn validation_rejects_mixed_unsorted_and_non_finite_x() {
        let s = |x: Option<Vec<f64>>| LineSeries {
            values: vec![1.0, 2.0, 3.0],
            x,
            color: [1.0; 4],
            width_px: 1.0,
        };
        assert!(validate_line_x(&[s(None), s(None)]).is_ok());
        assert!(validate_line_x(&[s(Some(vec![0.0, 1.0, 1.0]))]).is_ok(), "ties are allowed");
        assert!(validate_line_x(&[s(Some(vec![0.0, 1.0, 2.0])), s(None)]).is_err());
        assert!(validate_line_x(&[s(Some(vec![0.0, 1.0]))]).is_err());
        assert!(validate_line_x(&[s(Some(vec![0.0, f64::NAN, 2.0]))]).is_err());
        let err = validate_line_x(&[s(Some(vec![0.0, 2.0, 1.0]))]).unwrap_err();
        assert!(err.contains("sorted"), "{err}");
        // Invalid x reaching the chart directly falls back to index placement
        let chart = ChartState::new_line(
            vec![s(Some(vec![2.0, 1.0, 0.0]))],
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        );
        assert!(!line(&chart).has_x());
    }

    #[test]
    fn epoch_ms_x_keeps_millisecond_precision() {
        // 1 ms spacing on top of a ~1.7e12 epoch offset: f32 alone would collapse these
        let x: Vec<f64> = (0..1000).map(|i| T0 + i as f64).collect();
        let (_, chart) = xy_state(vec![(x, vec![0.0; 1000])], LineXKind::Time);
        let l = line(&chart);
        let dx: Vec<f32> = (0..999).map(|i| l.x_at(0, i + 1) - l.x_at(0, i)).collect();
        let expect = 160.0 / 999.0;
        assert!(dx.iter().all(|d| (d - expect).abs() < 1e-4), "{:?}", &dx[..4]);
    }

    #[test]
    fn irregular_x_lod_buckets_by_x_and_keeps_spikes() {
        // Dense first half (1 ms gaps), sparse second half (100 ms gaps)
        let n = 200_000;
        let x: Vec<f64> = (0..n)
            .map(|i| if i < n / 2 { i as f64 } else { (n / 2) as f64 + (i - n / 2) as f64 * 100.0 })
            .map(|v| T0 + v)
            .collect();
        let mut values: Vec<f32> = (0..n).map(|i| (i as f32 * 0.01).sin()).collect();
        values[54_321] = 50.0; // single-sample spike in the dense part
        let (cam, mut chart) = xy_state(vec![(x.clone(), values)], LineXKind::Time);
        let segs = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        assert!(segs.len() < 4 * 1600 * 2, "segments {} not decimated", segs.len());
        let max_y = segs.iter().map(|s| s.p0_width[1].max(s.p1_pad[1])).fold(f32::MIN, f32::max);
        assert!((max_y - 40.0).abs() < 1e-3, "spike lost: max y {max_y}");
        // Spike drawn at its real x, not at its index position
        let spike = segs.iter().find(|s| s.p1_pad[1] > 39.0).unwrap();
        let expect_x = ((x[54_321] - x[0]) / (x[n - 1] - x[0]) - 0.5) as f32 * 160.0;
        assert!((spike.p1_pad[0] - expect_x).abs() < 1e-3, "{} vs {expect_x}", spike.p1_pad[0]);
        // The dense half is ~0.1% of the x range: it collapses to a few pixel columns
        let dense_end = ((x[n / 2] - x[0]) / (x[n - 1] - x[0]) - 0.5) as f32 * 160.0;
        let dense = segs.iter().filter(|s| s.p1_pad[0] <= dense_end).count();
        assert!(dense < 64, "dense half not bucketed by x: {dense} segments");
        // Segments run left to right
        assert!(segs.windows(2).all(|w| w[1].p0_width[0] >= w[0].p0_width[0] - 1e-4));
    }

    #[test]
    fn index_hover_picks_the_nearest_x_per_series() {
        // Series 0: irregular samples; series 1 only covers x in [6, 10]
        let (cam, mut chart) = xy_state(
            vec![
                (vec![0.0, 1.0, 2.0, 10.0], vec![1.0, 2.0, 3.0, 4.0]),
                (vec![6.0, 8.0, 10.0], vec![5.0, 6.0, 7.0]),
            ],
            LineXKind::Numeric,
        );
        let mut scene = SceneWorld::new();
        let v = view(&cam);
        // x = 7: series 0 -> x = 10 (index 3), series 1 -> 6 (tie with 8 resolves left)
        let hit = chart.hover_at(&v, &mut scene, ndc_at_x(&chart, &cam, 7.0)).unwrap();
        let picks: Vec<(u32, u32)> = hit.items.iter().map(|i| (i.series, i.index)).collect();
        assert_eq!(picks, vec![(0, 3), (1, 0)]);
        assert_eq!(hit.items[1].global_id, 4);
        // x = 5.9 is still nearer to 2 than to 10; series 1 starts at 6 but is within slack
        let hit = chart.hover_at(&v, &mut scene, ndc_at_x(&chart, &cam, 5.9)).unwrap();
        assert_eq!(hit.items[0].index, 2);
        // x = 1.2: series 1 has no samples there and is left out
        let hit = chart.hover_at(&v, &mut scene, ndc_at_x(&chart, &cam, 1.2)).unwrap();
        let picks: Vec<(u32, u32)> = hit.items.iter().map(|i| (i.series, i.index)).collect();
        assert_eq!(picks, vec![(0, 1)]);
        // Crosshair sits on the hovered sample's x
        let layers = chart.prepare_layers(&v);
        let cross = layers.overlay.unwrap()[0];
        assert!((cross.p0_width[0] - line(&chart).x_at(0, 1)).abs() < 1e-4);
    }

    #[test]
    fn nearest_hover_searches_by_x() {
        let x: Vec<f64> = (0..2000).map(|i| (i as f64).powi(2)).collect();
        let values: Vec<f32> = (0..2000).map(|i| i as f32).collect();
        let (cam, mut chart) = xy_state(vec![(x.clone(), values)], LineXKind::Numeric);
        let mut scene = SceneWorld::new();
        chart.set_hover_style(ChartHoverStyle { mode: HoverMode::Nearest, ..Default::default() }, &mut scene);
        let v = view(&cam);
        let l = line(&chart);
        let p = cam.project_to_ndc(l.point(0, 1500)).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (p.x, p.y)).unwrap();
        assert_eq!(hit.items[0].index, 1500);
    }

    #[test]
    fn time_axis_ticks_land_on_month_boundaries() {
        // Daily samples from Jan 15 2026 over ~2 years: monthly ticks at the default plot width
        let x: Vec<f64> = (14..744).map(|d| T0 + d as f64 * DAY).collect();
        let len = x.len();
        let (cam, mut chart) = xy_state(vec![(x, vec![1.0; len])], LineXKind::Time);
        chart.prepare_layers(&view(&cam));
        let xs: Vec<AxisTick> = chart.axes().ticks.iter().copied().filter(|t| t.axis == 0).collect();
        assert!(xs.len() >= 5, "{xs:?}");
        for t in &xs {
            let (_, m, d) = super::super::time_ticks::civil_from_days((t.value / DAY) as i64);
            assert_eq!((d, t.value % DAY), (1, 0.0), "tick {} not on the 1st", t.value);
            // January 1st is labelled as a year boundary
            assert_eq!(t.granularity, if m == 1 { 7 } else { 6 });
        }
        assert!(xs.iter().any(|t| t.granularity == 7));
        assert!(xs.windows(2).all(|w| w[1].x_css > w[0].x_css));
        // Numeric x: plain nice values of x, no granularity
        let (cam, mut chart) = xy_state(vec![(vec![3.0, 7.5, 97.0], vec![1.0, 2.0, 3.0])], LineXKind::Numeric);
        chart.prepare_layers(&view(&cam));
        let xs: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 0).map(|t| t.value).collect();
        assert_eq!(xs, (1..20).map(|k| k as f64 * 5.0).collect::<Vec<_>>());
    }

    #[test]
    fn zoom_with_x_limits_span_by_sample_gaps_and_ticks_follow_the_window() {
        // Series 0: gap 10 over [0, 1000]; series 1: gap 5 over [0, 50] -> min span = 8 * 5 / 1000
        let (cam, mut chart) = xy_state(
            vec![
                ((0..=100).map(|i| i as f64 * 10.0).collect(), vec![1.0; 101]),
                ((0..=10).map(|i| i as f64 * 5.0).collect(), vec![2.0; 11]),
            ],
            LineXKind::Numeric,
        );
        let v = view(&cam);
        let anchor = ndc_at_x(&chart, &cam, 250.0);
        chart.zoom_x(&v, 0.2, anchor.0);
        let (w0, w1) = chart.x_window();
        assert!((w1 - w0 - 0.2).abs() < 1e-4);
        assert!(w0 < 0.25 && w1 > 0.25, "anchor x stays in view");
        chart.prepare_layers(&v);
        // Window edges are f32: allow ticks within float noise of the edge
        let lo = w0 as f64 * 1000.0 - 1e-2;
        let hi = w1 as f64 * 1000.0 + 1e-2;
        let xs: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 0).map(|t| t.value).collect();
        assert!(xs.len() >= 3 && xs.iter().all(|&x| x >= lo && x <= hi), "{xs:?} not in [{lo}, {hi}]");
        chart.zoom_x(&v, 1e-6, anchor.0);
        let (w0, w1) = chart.x_window();
        assert!((w1 - w0 - 0.04).abs() < 1e-5, "span {}", w1 - w0);
    }
}
