//! Combo charts (2D): bar, line and area series on one plot sharing one x mapping, with an
//! optional right y axis.
//!
//! Composition, not a new renderer: bar series live in a wrapped `BarChart` (grouped / stacked /
//! percent layout, restacking on legend toggles), line and area series in a wrapped `LineChart`
//! (M4 LOD, line styles, zoom window, x ticks). Both share the same categories: category `i`
//! sits at data x `xs[i]` (its index without explicit x), the line x domain is padded by half a
//! category gap on both sides, so line points land on bar slot centers and bars get the gap
//! (smallest gap of explicit x) as their slot width. Bar rectangles are laid out once in unzoomed
//! world x and mapped through the line zoom window when the bar layer is built.
//!
//! y domains are fixed (no autoscale): per axis the extent of its series (hidden ones too; bars
//! by their stacked sums; bars and areas include zero), expanded to nice ticks unless the axis
//! fixes an end. Every bar series shares the first bar series' axis. Series ids (legend, hover
//! items, a11y) are the combo order; data point ids are `series * categories + category`.

use super::bar::{BarChart, BarMode, BarSeriesLayout};
use super::line::{y_domain, LineChart, LodWindow, DIMMED_SERIES_ALPHA};
use super::linestyle::{apply_curve, CurveScratch, LineCurve, Path, StyleCtx};
use super::time_zone::TimeZone;
use super::*;

/// How a combo series is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComboSeriesKind {
    Bar,
    Line,
    /// Line with a translucent fill down to the zero baseline of its axis
    Area,
}

impl ComboSeriesKind {
    /// 0 = bar, 1 = line, 2 = area
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Bar,
            2 => Self::Area,
            _ => Self::Line,
        }
    }
}

/// One combo series: one value per category (`NaN` = missing).
#[derive(Debug, Clone, PartialEq)]
pub struct ComboSeries {
    pub kind: ComboSeriesKind,
    pub values: Vec<f32>,
    /// 0 = left y axis, 1 = right
    pub axis: u8,
    pub color: [f32; 4],
    /// Stroke width of line / area series (CSS px)
    pub width_px: f32,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ComboLayout {
    /// World size of the plot
    pub width: f32,
    pub height: f32,
    /// Grouped / stacked / percent bars (bar series only)
    pub bar_mode: BarMode,
    /// Empty fraction of each category slot between bar groups
    pub group_gap: f32,
    /// CSS px between grouped bars / stacked segments
    pub gap_px: f32,
    pub corner_radius_px: f32,
    /// Fill alpha multiplier of area series
    pub fill_opacity: f32,
    /// Tick scale of explicit x (ignored for categories)
    pub x_kind: LineXKind,
}

impl Default for ComboLayout {
    fn default() -> Self {
        Self {
            width: 168.0,
            height: 86.0,
            bar_mode: BarMode::Grouped,
            group_gap: 0.28,
            gap_px: 2.0,
            corner_radius_px: 4.0,
            fill_opacity: 0.2,
            x_kind: LineXKind::Numeric,
        }
    }
}

/// Checks combo input: at least one series, every series with the same number of values (>= 1),
/// and explicit x (when given) one per category, finite and strictly increasing.
pub fn validate_combo(series: &[ComboSeries], x: Option<&[f64]>) -> Result<usize, String> {
    let n = series.first().ok_or("combo charts need at least one series")?.values.len();
    if n == 0 {
        return Err("combo series need at least one value".into());
    }
    if let Some((i, s)) = series.iter().enumerate().find(|(_, s)| s.values.len() != n) {
        return Err(format!("series {i} has {} values, series 0 has {n}", s.values.len()));
    }
    if let Some(x) = x {
        if x.len() != n {
            return Err(format!("x has {} values for {n} categories", x.len()));
        }
        if let Some(k) = x.iter().position(|v| !v.is_finite()) {
            return Err(format!("x[{k}] is not finite"));
        }
        if let Some(k) = x.windows(2).position(|w| w[1] <= w[0]) {
            return Err(format!("x must be strictly increasing (x[{}] <= x[{k}])", k + 1));
        }
    }
    Ok(n)
}

/// Where a combo series lives: its kind and its index in `bars` / `line`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ComboSlot {
    pub(crate) kind: ComboSeriesKind,
    pub(crate) local: usize,
}

#[derive(Debug, Clone)]
pub(crate) struct ComboChart {
    /// Line and area series (a hidden all-NaN placeholder when there are none: it carries the
    /// x mapping, zoom window and axes)
    pub(crate) line: LineChart,
    /// Bar series, laid out in unzoomed world x
    pub(crate) bars: Option<BarChart>,
    /// Per combo series, in input order
    pub(crate) slots: Vec<ComboSlot>,
    /// Categories (values per series)
    pub(crate) n: usize,
    /// Data x of each category (its index without explicit x)
    pub(crate) xs: Vec<f64>,
    pub(crate) categorical: bool,
    /// Category slot width in data x (1 for categories, smallest gap of explicit x: bars never overlap)
    pub(crate) gap: f64,
    /// y axis shared by every bar series
    pub(crate) bar_axis: u8,
    /// Raw bar value extent (stacked sums, zero included) before mapping onto `bar_axis`
    bar_extent: (f32, f32),
    pub(crate) fill_opacity: f32,
    /// Domain options of the left / right y axis (`autoscale` is ignored: domains are fixed)
    pub(crate) y_axes: [LineYAxis; 2],
    /// Any series on the right axis
    pub(crate) has_right: bool,
}

/// Smallest positive gap between consecutive `xs` (1 without any).
fn min_gap(xs: &[f64]) -> f64 {
    let g = xs.windows(2).map(|w| w[1] - w[0]).filter(|g| *g > 0.0).fold(f64::INFINITY, f64::min);
    if g.is_finite() {
        g
    } else {
        1.0
    }
}

/// Raw value extent of bars (`values` flat `[s * n + i]`), zero included: values (grouped),
/// per-category positive / negative sums (stacked), or the percent span.
fn bar_extent(values: &[f32], n: usize, mode: BarMode) -> (f32, f32) {
    let finite = || values.iter().copied().filter(|v| v.is_finite());
    match mode {
        BarMode::Grouped => (finite().fold(0.0, f32::min), finite().fold(0.0, f32::max)),
        BarMode::Stacked => (0..n).fold((0.0f32, 0.0f32), |(lo, hi), i| {
            let (neg, pos) = values.iter().skip(i).step_by(n.max(1)).filter(|v| v.is_finite()).fold((0.0f32, 0.0f32), |(a, b), &v| {
                if v < 0.0 {
                    (a + v, b)
                } else {
                    (a, b + v)
                }
            });
            (lo.min(neg), hi.max(pos))
        }),
        BarMode::Percent => (
            if finite().any(|v| v < 0.0) { -100.0 } else { 0.0 },
            if finite().any(|v| v > 0.0) { 100.0 } else { 0.0 },
        ),
    }
}

impl ComboChart {
    /// Expects input accepted by `validate_combo`.
    pub(crate) fn new(series: Vec<ComboSeries>, x: Option<Vec<f64>>, layout: ComboLayout, y_axes: [LineYAxis; 2]) -> Self {
        let n = series.first().map_or(0, |s| s.values.len()).max(1);
        let categorical = x.is_none();
        let xs = x.unwrap_or_else(|| (0..n).map(|i| i as f64).collect());
        let gap = if categorical { 1.0 } else { min_gap(&xs) };
        // Bars share the first bar series' axis; then a right axis needs a left one: all-right
        // input moves to the left
        let mut axes: Vec<u8> = series.iter().map(|s| u8::from(s.axis == 1)).collect();
        let mut bar_axis = series.iter().zip(&axes).find(|(s, _)| s.kind == ComboSeriesKind::Bar).map_or(0, |(_, &a)| a);
        for (a, s) in axes.iter_mut().zip(&series) {
            if s.kind == ComboSeriesKind::Bar {
                *a = bar_axis;
            }
        }
        if !axes.contains(&0) {
            axes.fill(0);
            bar_axis = 0;
        }

        let mut slots = Vec::with_capacity(series.len());
        let (mut bar_values, mut bar_colors) = (Vec::new(), Vec::new());
        let (mut lines, mut line_axes) = (Vec::new(), Vec::new());
        for (k, s) in series.into_iter().enumerate() {
            match s.kind {
                ComboSeriesKind::Bar => {
                    slots.push(ComboSlot { kind: s.kind, local: bar_colors.len() });
                    bar_values.extend_from_slice(&s.values);
                    bar_colors.push(s.color);
                    axes[k] = bar_axis;
                }
                _ => {
                    slots.push(ComboSlot { kind: s.kind, local: lines.len() });
                    line_axes.push(axes[k]);
                    lines.push(LineSeries { values: s.values, x: Some(xs.clone()), color: s.color, width_px: s.width_px.max(0.25) });
                }
            }
        }
        let placeholder = lines.is_empty();
        if placeholder {
            lines.push(LineSeries { values: vec![f32::NAN; n], x: Some(xs.clone()), color: [0.0; 4], width_px: 1.0 });
            line_axes.push(0);
        }
        let line_layout = LineLayout { width: layout.width, height: layout.height, view: ChartViewMode::Flat, x_kind: layout.x_kind };
        let mut line = LineChart::new(lines, line_layout);
        line.series_axis = line_axes;
        if placeholder {
            line.visible[0] = false;
        }
        // Pad the x domain by half a slot on both sides: categories sit on slot centers
        let (first, last) = (xs[0], xs[n - 1]);
        line.x_min = first - gap * 0.5;
        line.x_span = (last - first) + gap;
        line.min_gap_t = (gap / line.x_span) as f32;

        let mut chart = Self {
            line,
            bars: None,
            slots,
            n,
            xs,
            categorical,
            gap,
            bar_axis,
            bar_extent: (0.0, 0.0),
            fill_opacity: if layout.fill_opacity.is_finite() { layout.fill_opacity.clamp(0.0, 1.0) } else { 0.2 },
            y_axes: y_axes.map(|a| LineYAxis { autoscale: YAutoscale::None, ..a }),
            has_right: axes.contains(&1),
        };
        if !bar_colors.is_empty() {
            let count = bar_colors.len();
            let bar_layout = BarLayout {
                width: layout.width,
                max_height: layout.height,
                bar_width: 0.0,
                corner_radius_px: if layout.corner_radius_px.is_finite() { layout.corner_radius_px.max(0.0) } else { 4.0 },
                view: ChartViewMode::Flat,
            };
            let series_layout = BarSeriesLayout { series_count: count, mode: layout.bar_mode, group_gap: layout.group_gap, gap_px: layout.gap_px };
            // Raw extent (the bar chart's own domain is already niced)
            chart.bar_extent = bar_extent(&bar_values, n, layout.bar_mode);
            let mut b = BarChart::new(bar_values, bar_colors, bar_layout, series_layout);
            // Slots on the shared x mapping (explicit x may be irregular)
            let w = layout.width as f64;
            let (x_min, x_span) = (chart.line.x_min, chart.line.x_span);
            b.slots = chart.xs.iter().map(|&x| ((((x - x_min) / x_span) - 0.5) * w) as f32).map(|x| (x, 0.0)).collect();
            b.spacing = (gap / x_span * w) as f32;
            b.bar_width = (b.spacing * (1.0 - b.group_gap)).max(1e-3);
            chart.bars = Some(b);
        }
        chart.update_domains();
        chart
    }

    /// Re-derives both y domains (tick target / options) and maps the bars onto theirs.
    pub(crate) fn update_domains(&mut self) {
        let target = self.line.tick_target;
        for k in 0..2u8 {
            let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
            for slot in &self.slots {
                let (a, b) = match slot.kind {
                    ComboSeriesKind::Bar => continue,
                    _ if self.line.axis_of(slot.local) != k => continue,
                    ComboSeriesKind::Line => self.line.ext[slot.local],
                    // Areas fill from zero
                    ComboSeriesKind::Area => {
                        let (a, b) = self.line.ext[slot.local];
                        (a.min(0.0), b.max(0.0))
                    }
                };
                // Style extents (zero-filled gaps)
                let (c, d) = self.line.style.extra_extent(slot.local);
                let (a, b) = (a.min(c), b.max(d));
                (lo, hi) = (lo.min(a), hi.max(b));
            }
            let bars = self.bars.is_some() && self.bar_axis == k;
            if bars {
                (lo, hi) = (lo.min(self.bar_extent.0).min(0.0), hi.max(self.bar_extent.1).max(0.0));
            }
            if lo > hi {
                (lo, hi) = (0.0, 1.0);
            }
            let axis = self.y_axes[k as usize];
            let (mut a, mut b, mut step) = y_domain(lo as f64, hi as f64, &axis, target);
            // Bars grow from zero: their axis always shows it
            if bars && (a > 0.0 || b < 0.0) {
                (a, b) = (a.min(0.0), b.max(0.0));
                step = nice_step(b - a, target);
            }
            let (y_min, y_span) = (a as f32, ((b - a) as f32).max(1e-6));
            // Fixed ends: a forced re-derive (`update_y_domain(true)`) lands on the same domain
            let fixed = LineYAxis { min: Some(a), max: Some(b), autoscale: YAutoscale::None, nice: false };
            let l = &mut self.line;
            if k == 0 {
                (l.y_min, l.y_span, l.y_step, l.y_axis) = (y_min, y_span, step, fixed);
            } else {
                (l.right.y_min, l.right.y_span, l.right.y_step, l.right.axis) = (y_min, y_span, step, fixed);
                (l.right.data_min, l.right.data_max) = (lo, hi);
            }
            if k == 0 {
                (l.data_min, l.data_max) = (lo, hi);
            }
        }
        if let Some(b) = self.bars.as_mut() {
            let (min, span, step) = if self.bar_axis == 0 {
                (self.line.y_min, self.line.y_span, self.line.y_step)
            } else {
                let r = &self.line.right;
                (r.y_min, r.y_span, r.y_step)
            };
            let h = self.line.layout.height;
            b.v_min = min;
            b.v_max = min + span;
            b.v_step = step;
            b.scale = h / span;
            b.bottom = -h * 0.5;
            b.zero_y = b.bottom - min * b.scale;
            b.relayout();
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.slots.len()
    }

    /// y axis of combo series `s`.
    pub(crate) fn axis_of(&self, s: usize) -> u8 {
        match self.slots.get(s) {
            Some(ComboSlot { kind: ComboSeriesKind::Bar, .. }) => self.bar_axis,
            Some(slot) => self.line.axis_of(slot.local),
            None => 0,
        }
    }

    pub(crate) fn visible(&self, s: usize) -> bool {
        match self.slots.get(s) {
            Some(ComboSlot { kind: ComboSeriesKind::Bar, local }) => {
                self.bars.as_ref().is_some_and(|b| b.visible.get(*local).copied().unwrap_or(false))
            }
            Some(slot) => self.line.visible.get(slot.local).copied().unwrap_or(false),
            None => false,
        }
    }

    /// Shows / hides a series (bars restack / regroup); returns `(bars changed, lines changed)`.
    pub(crate) fn set_visible(&mut self, s: usize, visible: bool) -> (bool, bool) {
        match self.slots.get(s) {
            Some(ComboSlot { kind: ComboSeriesKind::Bar, local }) => {
                (self.bars.as_mut().is_some_and(|b| b.set_visible(*local, visible)), false)
            }
            Some(slot) => match self.line.visible.get_mut(slot.local) {
                Some(v) if *v != visible => {
                    *v = visible;
                    (false, true)
                }
                _ => (false, false),
            },
            None => (false, false),
        }
    }

    /// Emphasizes one series (every other series fades, bars and lines alike); returns
    /// `(bars changed, lines changed)`.
    pub(crate) fn set_emphasis(&mut self, s: Option<usize>) -> (bool, bool) {
        let slot = s.and_then(|s| self.slots.get(s).copied());
        // An emphasized series of the other part fades all of this part (`MAX` matches nothing)
        let pick = |kind_is_bar: bool| {
            slot.map(|sl| if (sl.kind == ComboSeriesKind::Bar) == kind_is_bar { sl.local } else { usize::MAX })
        };
        let (bar_e, line_e) = (pick(true), pick(false));
        let bars = match self.bars.as_mut() {
            Some(b) if b.emphasis != bar_e => {
                b.emphasis = bar_e;
                true
            }
            _ => false,
        };
        let lines = self.line.emphasis != line_e;
        self.line.emphasis = line_e;
        (bars, lines)
    }

    /// Value of series `s` at category `i` (`NaN` = missing).
    pub(crate) fn value(&self, s: usize, i: usize) -> f32 {
        match self.slots.get(s) {
            Some(ComboSlot { kind: ComboSeriesKind::Bar, local }) => {
                self.bars.as_ref().and_then(|b| b.values.get(local * self.n + i)).copied().unwrap_or(f32::NAN)
            }
            Some(slot) => self.line.vals(slot.local).get(i).copied().unwrap_or(f32::NAN),
            None => f32::NAN,
        }
    }

    /// World x (zoom window applied) of an unzoomed world x (bar layout space).
    #[inline]
    fn zoomed_x(&self, unzoomed: f32) -> f32 {
        self.line.x_of_t((unzoomed / self.line.layout.width) as f64 + 0.5)
    }

    /// World x of category `i` under the zoom window.
    pub(crate) fn category_x(&self, i: usize) -> f32 {
        self.line.x_of_t((self.xs[i] - self.line.x_min) / self.line.x_span)
    }

    /// Category whose slot contains data x `x` (`None` between irregular slots / outside).
    pub(crate) fn category_at(&self, x: f64) -> Option<usize> {
        let k = self.xs.partition_point(|&v| v < x);
        let near = [k.checked_sub(1), (k < self.n).then_some(k)]
            .into_iter()
            .flatten()
            .min_by(|&a, &b| (self.xs[a] - x).abs().total_cmp(&(self.xs[b] - x).abs()))?;
        ((self.xs[near] - x).abs() <= self.gap * 0.5 * (1.0 + 1e-9)).then_some(near)
    }

    /// Category nearest to data x `x` inside the x domain (cursor sync).
    pub(crate) fn category_near(&self, x: f64) -> Option<usize> {
        let (lo, hi) = (self.line.x_min, self.line.x_min + self.line.x_span);
        if !(lo..=hi).contains(&x) {
            return None;
        }
        let k = self.xs.partition_point(|&v| v < x);
        [k.checked_sub(1), (k < self.n).then_some(k)]
            .into_iter()
            .flatten()
            .min_by(|&a, &b| (self.xs[a] - x).abs().total_cmp(&(self.xs[b] - x).abs()))
    }

    /// World y of the drawn end of series `s` at category `i` (bar top / line point).
    fn item_y(&self, s: usize, i: usize) -> Option<f32> {
        let slot = self.slots.get(s)?;
        match slot.kind {
            ComboSeriesKind::Bar => {
                let b = self.bars.as_ref()?;
                Some(b.top_y(slot.local * self.n + i))
            }
            _ => {
                let v = self.line.vals(slot.local).get(i).copied()?;
                v.is_finite().then(|| self.line.y_of_axis(self.line.axis_of(slot.local), v))
            }
        }
    }

    /// Every visible series with a value at category `i` (shared tooltip). `pointer` (world x, y
    /// under the zoom window) picks the primary item: the bar segment under / nearest the pointer
    /// or the closest line point (lines win ties: they draw over the bars); `nearest_only` keeps
    /// just that item.
    pub(crate) fn items_at(&self, i: usize, pointer: Option<(f32, f32)>, nearest_only: bool) -> Option<HoverResult> {
        if i >= self.n {
            return None;
        }
        let mut items = Vec::new();
        let (mut primary, mut best, mut best_line) = (0, f32::INFINITY, false);
        let tol = self.line.layout.height * 0.01;
        let outside = |p: f32, a: f32, b: f32| if p < a.min(b) { a.min(b) - p } else if p > a.max(b) { p - a.max(b) } else { 0.0 };
        for s in 0..self.slots.len() {
            let v = self.value(s, i);
            if !self.visible(s) || !v.is_finite() {
                continue;
            }
            if let Some((px, py)) = pointer {
                let line = self.slots[s].kind != ComboSeriesKind::Bar;
                let d = match self.slots[s] {
                    // Distance to the segment rectangle (grouped bars sit side by side)
                    ComboSlot { kind: ComboSeriesKind::Bar, local } => match self.bars.as_ref().and_then(|b| b.segs[local * self.n + i]) {
                        Some(seg) => {
                            let dx = outside(px, self.zoomed_x(seg.x0), self.zoomed_x(seg.x1));
                            dx.hypot(outside(py, seg.y0, seg.y1))
                        }
                        None => f32::INFINITY,
                    },
                    // A little slack so a pointer on a line point inside a bar picks the line
                    _ => self.item_y(s, i).map_or(f32::INFINITY, |y| ((px - self.category_x(i)).hypot(y - py) - tol).max(0.0)),
                };
                if d < best || (d == best && line && !best_line) {
                    (best, best_line) = (d, line);
                    primary = items.len();
                }
            }
            items.push(HoverItem { series: s as u32, index: i as u32, value: v, global_id: (s * self.n + i) as u32 });
        }
        if items.is_empty() {
            return None;
        }
        if nearest_only {
            let item = items[primary];
            return Some(HoverResult { is_bar: false, primary: 0, items: vec![item] });
        }
        Some(HoverResult { is_bar: false, primary, items })
    }

    /// Category under the pointer: every visible series there (index mode) or the item nearest
    /// to the pointer (nearest mode).
    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32), style: &ChartHoverStyle) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let hit = ray_hit_z_plane(&ray, 0.0)?;
        let l = &self.line;
        if hit.y.abs() > l.layout.height * 0.5 * (1.0 + HOVER_Y_SLACK * 2.0) || hit.x.abs() > l.layout.width * 0.5 {
            return None;
        }
        let x = l.x_min + l.t_of_x64(hit.x) * l.x_span;
        let i = self.category_at(x)?;
        self.items_at(i, Some((hit.x, hit.y)), style.mode == HoverMode::Nearest)
    }

    /// Bars in zoomed world x; bars of hovered items are tinted.
    pub(crate) fn build_bars(&self, hover: Option<&HoverResult>, style: &ChartHoverStyle, out: &mut Vec<ChartBarRaw>) {
        out.clear();
        let Some(b) = &self.bars else {
            return;
        };
        b.build_bars(None, style, out);
        let hovered: Vec<usize> = hover
            .map(|h| {
                h.items
                    .iter()
                    .filter_map(|it| match self.slots.get(it.series as usize) {
                        Some(ComboSlot { kind: ComboSeriesKind::Bar, local }) => Some(local * self.n + it.index as usize),
                        _ => None,
                    })
                    .collect()
            })
            .unwrap_or_default();
        // `build_bars` emits one bar per laid-out segment, in global id order
        let ids = b.segs.iter().enumerate().filter_map(|(g, seg)| seg.map(|_| g));
        for (bar, g) in out.iter_mut().zip(ids) {
            bar.rect[0] = self.zoomed_x(bar.rect[0]);
            bar.rect[2] = self.zoomed_x(bar.rect[2]);
            if hovered.contains(&g) {
                // Keep the emphasis fade
                let alpha = bar.color[3];
                bar.color = b.hover_color(g, style);
                bar.color[3] = alpha;
            }
        }
    }

    /// Area fills (series color x `fill_opacity`) from each visible area series' drawn stroke
    /// (same M4 picks and curve) down to the zero baseline of its axis.
    pub(crate) fn build_fills(&self, window: &LodWindow, out: &mut Vec<ChartFillRaw>) {
        out.clear();
        let l = &self.line;
        let ppw = l.px_per_world(window);
        let (mut picks, mut rows, mut curved, mut sc) = (Vec::new(), Path::default(), Path::default(), CurveScratch::default());
        let mut bottom = Vec::new();
        for slot in self.slots.iter().filter(|sl| sl.kind == ComboSeriesKind::Area) {
            let s = slot.local;
            if !l.visible[s] {
                continue;
            }
            l.lod_picks(s, window, &mut picks);
            l.stroke_rows(s, &picks, &mut rows);
            let curve = l.style_of(s).curve;
            let top = if curve == LineCurve::Linear {
                &rows
            } else {
                apply_curve(curve, ppw, &rows, &mut curved, &mut sc);
                &curved
            };
            let base = self.baseline_y(l.axis_of(s));
            bottom.clear();
            bottom.resize(top.x.len(), base);
            let mut color = l.series[s].color;
            color[3] *= self.fill_opacity;
            if l.emphasis.is_some_and(|e| e != s) {
                color[3] *= DIMMED_SERIES_ALPHA;
            }
            band_triangles(&top.x, &top.y, &bottom, l.z[s], color, out);
        }
    }

    /// World y of zero on y axis `axis`, clamped into its domain.
    fn baseline_y(&self, axis: u8) -> f32 {
        let l = &self.line;
        let (min, span) = if axis == 0 { (l.y_min, l.y_span) } else { (l.right.y_min, l.right.y_span) };
        l.y_of_axis(axis, 0.0f32.clamp(min, min + span))
    }

    /// Crosshair at the hovered category (when the chart has line / area series) and markers on
    /// the hovered line / area points; hovered bars are tinted by `build_bars`.
    pub(crate) fn build_overlay(
        &self,
        hover: &HoverResult,
        style: &ChartHoverStyle,
        overlay: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        overlay.clear();
        markers.clear();
        let Some(first) = hover.items.first() else {
            return;
        };
        let has_lines = self.slots.iter().any(|sl| sl.kind != ComboSeriesKind::Bar);
        let l = &self.line;
        if style.crosshair && has_lines {
            let x = self.category_x(first.index as usize);
            let half_h = l.layout.height * 0.5;
            let z = l.z.iter().copied().fold(0.0f32, f32::max);
            overlay.push(ChartSegmentRaw {
                p0_width: [x, -half_h, z, style.crosshair_width_px],
                p1_pad: [x, half_h, z, 0.0],
                color: style.crosshair_color,
            });
        }
        if style.marker {
            for item in &hover.items {
                let Some(slot) = self.slots.get(item.series as usize) else { continue };
                if slot.kind == ComboSeriesKind::Bar {
                    continue;
                }
                let p = l.point(slot.local, item.index as usize);
                markers.push(ChartMarkerRaw {
                    center_radius: [p.x, p.y, p.z, style.marker_radius_px],
                    fill: l.series[slot.local].color,
                    ring: style.marker_ring_color,
                    params: [style.marker_ring_px, 0.0, 0.0, 0.0],
                });
            }
        }
    }

    /// Plot rect, left / right value ticks, and x ticks: category ticks (thinned to ~1 per
    /// 88 px of visible categories) or the line chart's numeric / time ticks.
    pub(crate) fn axes(&self, view: &ChartView, tz: &TimeZone, out: &mut AxisLayout) {
        let l = &self.line;
        l.axes(view, tz, out);
        let plot = out.plot_css;
        if plot[2] <= 0.0 {
            return;
        }
        let half_w = l.layout.width * 0.5;
        // Bars alone on the right axis: the line chart has no right series to tick it
        if self.has_right && !l.has_right() {
            for v in l.y_ticks(1) {
                if let Some((_, y)) = view.project_css(Vec3::new(half_w, l.y_of_axis(1, v as f32), 0.0)) {
                    out.ticks.push(AxisTick { axis: 2, value: v, x_css: plot[0] + plot[2], y_css: y, granularity: 0 });
                }
            }
        }
        if !self.categorical {
            return;
        }
        out.ticks.retain(|t| t.axis != 0);
        let (w0, w1) = l.window;
        let (lo, hi) = (l.x_min + w0 as f64 * l.x_span, l.x_min + w1 as f64 * l.x_span);
        let (i0, i1) = (self.xs.partition_point(|&v| v < lo), self.xs.partition_point(|&v| v <= hi));
        if i0 >= i1 {
            return;
        }
        let every = (((i1 - i0) as f32 * 88.0 / plot[2].max(1.0)).ceil() as usize).max(1);
        let bottom = plot[1] + plot[3];
        for i in (i0..i1).step_by(every) {
            if let Some((cx, _)) = view.project_css(Vec3::new(self.category_x(i), -l.layout.height * 0.5, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value: i as f64, x_css: cx, y_css: bottom, granularity: 0 });
            }
        }
    }

    /// `(series, category, value, position)` of a data point by id `series * n + category`;
    /// position = bar data end / line point under the zoom window.
    pub(crate) fn sample(&self, id: usize) -> Option<(u32, u32, f32, Vec3)> {
        let (s, i) = (id / self.n, id % self.n);
        let slot = *self.slots.get(s)?;
        let v = self.value(s, i);
        let p = match slot.kind {
            ComboSeriesKind::Bar => {
                let b = self.bars.as_ref()?;
                let g = slot.local * self.n + i;
                let c = b.segs[g].map_or(b.slots[i].0, |seg| (seg.x0 + seg.x1) * 0.5);
                Vec3::new(self.zoomed_x(c), b.top_y(g), 0.0)
            }
            _ => self.line.point(slot.local, i),
        };
        Some((s as u32, i as u32, v, p))
    }

    /// Zooms x around the pointer (`factor` < 1 = in); true when the window moved.
    pub(crate) fn zoom(&mut self, view: &ChartView, factor: f32, anchor_ndc_x: f32) -> bool {
        let l = &mut self.line;
        let half = l.layout.width * 0.5;
        let ray = view.camera.screen_to_ray(anchor_ndc_x, 0.0);
        let anchor = ray_hit_z_plane(&ray, 0.0)
            .map(|p| l.t_of_x(p.x.clamp(-half, half)))
            .unwrap_or((l.window.0 + l.window.1) * 0.5);
        let before = l.window;
        l.zoom_x(factor, anchor);
        l.window != before
    }

    /// Pans x by a pointer delta in NDC (content follows the pointer); true when it moved.
    pub(crate) fn pan(&mut self, view: &ChartView, delta_ndc_x: f32) -> bool {
        let l = &mut self.line;
        let half = l.layout.width * 0.5;
        let (Some(a), Some(b)) = (view.project_px(Vec3::new(-half, 0.0, 0.0)), view.project_px(Vec3::new(half, 0.0, 0.0))) else {
            return false;
        };
        let plot_px = (b.0 - a.0).abs().max(1.0);
        let delta_px = delta_ndc_x * 0.5 * view.viewport_px.0 as f32;
        let (w0, w1) = l.window;
        let shift = -delta_px / plot_px * (w1 - w0);
        l.set_window(w0 + shift, w1 + shift);
        l.window != (w0, w1)
    }
}

// -----------------------------------------------------------------------------
// ChartState API
// -----------------------------------------------------------------------------

impl ChartState {
    /// Creates a 2D combo chart (bar / line / area series on shared categories or explicit x;
    /// `x` epoch ms with `LineXKind::Time`). `y_axes`: domain options of the left / right axis.
    pub fn new_combo(
        series: Vec<ComboSeries>,
        x: Option<Vec<f64>>,
        layout: ComboLayout,
        y_axes: [LineYAxis; 2],
    ) -> Result<Self, String> {
        validate_combo(&series, x.as_deref())?;
        Ok(Self::with_kind(ChartKind::Combo(Box::new(ComboChart::new(series, x, layout, y_axes)))))
    }

    /// Kind and y axis of each combo series (`None` for other charts).
    pub fn combo_series(&self) -> Option<Vec<(ComboSeriesKind, u8)>> {
        let ChartKind::Combo(c) = &self.kind else { return None };
        Some((0..c.len()).map(|s| (c.slots[s].kind, c.axis_of(s))).collect())
    }

    /// `(min, max)` of the left (`axis` 0) or right (1) y domain of a combo chart; `None` when
    /// no series uses that axis.
    pub fn combo_y_domain(&self, axis: u8) -> Option<(f64, f64)> {
        let ChartKind::Combo(c) = &self.kind else { return None };
        if axis == 1 && !c.has_right {
            return None;
        }
        let (min, max, _) = c.line.domain_data(axis.min(1));
        Some((min, max))
    }

    /// Builds the combo layers (called from `prepare_layers`): strokes / markers and area fills
    /// on the shared LOD window, bars, gridlines (left axis), hover overlays. Returns true when
    /// the strokes could not be built this frame (kept dirty).
    pub(super) fn prepare_combo(&mut self, view: &ChartView) -> bool {
        let ChartKind::Combo(c) = &self.kind else {
            return false;
        };
        let l = &c.line;
        let mut keep_dirty = false;
        if let Some(window) = l.view_window(view) {
            let stale = match self.lod {
                None => true,
                Some(built) => {
                    let ratio = window.px_per_t / built.px_per_t;
                    window.t0 < built.t0
                        || window.t1 > built.t1
                        || !(0.8..=1.25).contains(&ratio)
                        || (l.style.any_dash() && (ratio - 1.0).abs() > 1e-4)
                }
            };
            if stale || self.dirty.series {
                let pad = (window.t1 - window.t0) * 0.5;
                let padded = LodWindow { t0: (window.t0 - pad).max(0.0), t1: (window.t1 + pad).min(1.0), ..window };
                let ctx = StyleCtx { pixel_ratio: view.pixel_ratio, ring: self.hover_style.marker_ring_color };
                l.build_segments(&padded, &ctx, &mut self.series, &mut self.styled);
                c.build_fills(&padded, &mut self.fills);
                self.dirty.fills = true;
                self.lod = Some(padded);
                self.dirty.series = true;
            }
        } else if self.dirty.series {
            keep_dirty = true;
        }
        if self.dirty.bars {
            c.build_bars(self.hover.as_ref(), &self.hover_style, &mut self.bars);
        }
        if self.dirty.underlay {
            l.build_grid(&self.frame_style, &mut self.underlay);
        }
        if self.dirty.overlay {
            match &self.hover {
                Some(h) => c.build_overlay(h, &self.hover_style, &mut self.overlay, &mut self.markers),
                None => {
                    self.overlay.clear();
                    self.markers.clear();
                }
            }
        }
        keep_dirty
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];
    const GREEN: [f32; 4] = [0.0, 1.0, 0.0, 1.0];

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn series(kind: ComboSeriesKind, values: Vec<f32>, axis: u8, color: [f32; 4]) -> ComboSeries {
        ComboSeries { kind, values, axis, color, width_px: 2.0 }
    }

    fn state(series: Vec<ComboSeries>, x: Option<Vec<f64>>, mode: BarMode) -> (OrbitCamera, ChartState) {
        let layout = ComboLayout { bar_mode: mode, ..Default::default() };
        let chart = ChartState::new_combo(series, x, layout, [LineYAxis::default(); 2]).unwrap();
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn combo(chart: &ChartState) -> &ComboChart {
        match &chart.kind {
            ChartKind::Combo(c) => c,
            _ => unreachable!(),
        }
    }

    /// Revenue bars (2 series) + margin line on the right axis, 4 categories.
    fn revenue() -> (OrbitCamera, ChartState) {
        state(
            vec![
                series(ComboSeriesKind::Bar, vec![10.0, 20.0, 30.0, 40.0], 0, RED),
                series(ComboSeriesKind::Bar, vec![5.0, 5.0, 10.0, 10.0], 0, BLUE),
                series(ComboSeriesKind::Line, vec![0.12, 0.18, 0.15, 0.3], 1, GREEN),
            ],
            None,
            BarMode::Stacked,
        )
    }

    #[test]
    fn validation_rejects_ragged_series_and_bad_x() {
        let s = |n: usize| series(ComboSeriesKind::Line, vec![1.0; n], 0, RED);
        assert!(validate_combo(&[], None).is_err());
        assert!(validate_combo(&[s(0)], None).is_err());
        assert!(validate_combo(&[s(3), s(2)], None).unwrap_err().contains("series 1"));
        assert!(validate_combo(&[s(3)], Some(&[0.0, 1.0])).is_err());
        assert!(validate_combo(&[s(3)], Some(&[0.0, 1.0, 1.0])).unwrap_err().contains("strictly"));
        assert!(validate_combo(&[s(3)], Some(&[0.0, f64::NAN, 2.0])).is_err());
        assert_eq!(validate_combo(&[s(3)], Some(&[0.0, 1.0, 5.0])), Ok(3));
    }

    #[test]
    fn line_points_sit_on_the_bar_slot_centers() {
        let (cam, mut chart) = revenue();
        let v = view(&cam);
        let layers = chart.prepare_layers(&v);
        let bars = layers.bars.unwrap().to_vec();
        assert_eq!(bars.len(), 8);
        let c = combo(&chart);
        for (i, bar) in bars.iter().take(4).enumerate() {
            // Series 0 bar i (stack base) and the line point of category i share one x
            let center = (bar.rect[0] + bar.rect[2]) * 0.5;
            let p = c.line.point(0, i);
            assert!((center - p.x).abs() < 1e-3, "category {i}: bar {center} vs line {}", p.x);
            assert!((c.category_x(i) - p.x).abs() < 1e-3);
        }
        // Slots are evenly spread over the full width (half a slot of padding at both ends)
        let w = c.line.layout.width;
        assert!((c.category_x(0) - (-w * 0.5 + w / 8.0)).abs() < 1e-3);
        assert!((c.category_x(3) - (w * 0.5 - w / 8.0)).abs() < 1e-3);
        // Category x labels, one per category, at the slot centers
        let ticks: Vec<&AxisTick> = chart.axes().ticks.iter().filter(|t| t.axis == 0).collect();
        assert_eq!(ticks.iter().map(|t| t.value).collect::<Vec<_>>(), vec![0.0, 1.0, 2.0, 3.0]);
    }

    #[test]
    fn explicit_x_places_bars_by_smallest_gap() {
        let (cam, mut chart) = state(
            vec![
                series(ComboSeriesKind::Bar, vec![1.0, 2.0, 3.0, 4.0], 0, RED),
                series(ComboSeriesKind::Line, vec![1.0, 2.0, 3.0, 4.0], 0, BLUE),
            ],
            Some(vec![0.0, 10.0, 20.0, 40.0]),
            BarMode::Grouped,
        );
        let c = combo(&chart);
        assert_eq!(c.gap, 10.0);
        assert_eq!((c.line.x_min, c.line.x_span), (-5.0, 50.0));
        let bars = chart.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        let c = combo(&chart);
        for (i, bar) in bars.iter().enumerate() {
            let center = (bar.rect[0] + bar.rect[2]) * 0.5;
            assert!((center - c.line.point(0, i).x).abs() < 1e-3);
            // 72% of a 10-unit slot of a 50-unit domain
            assert!(((bar.rect[2] - bar.rect[0]) - c.line.layout.width * 0.2 * 0.72).abs() < 1e-3);
        }
        // Numeric x ticks come from the line chart
        assert!(chart.axes().ticks.iter().filter(|t| t.axis == 0).any(|t| t.value == 20.0));
    }

    #[test]
    fn dual_axis_domains_cover_their_own_series_and_bars_include_zero() {
        let (_, chart) = revenue();
        // Stacked bars: tallest stack 50, zero included
        let (lo, hi) = chart.combo_y_domain(0).unwrap();
        assert_eq!((lo, hi), (0.0, 50.0));
        // Line on the right: its own nice domain, not forced to zero
        let (lo, hi) = chart.combo_y_domain(1).unwrap();
        assert!(lo > 0.0 && lo <= 0.12 && (0.3..0.5).contains(&hi), "{lo} {hi}");
        let c = combo(&chart);
        // Bars map onto the left domain: the 50 stack reaches the plot top
        let b = c.bars.as_ref().unwrap();
        let top = b.segs[4 + 3].unwrap().y1;
        assert!((top - c.line.layout.height * 0.5).abs() < 1e-3);
        assert_eq!(chart.combo_series().unwrap()[2], (ComboSeriesKind::Line, 1));

        // Bars on the right axis alone still get right ticks
        let (cam, mut chart) = state(
            vec![
                series(ComboSeriesKind::Line, vec![100.0, 200.0], 0, RED),
                series(ComboSeriesKind::Bar, vec![1.0, 3.0], 1, BLUE),
            ],
            None,
            BarMode::Grouped,
        );
        chart.prepare_layers(&view(&cam));
        let right: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 2).map(|t| t.value).collect();
        assert_eq!(right.first(), Some(&0.0));
        assert!(right.last().is_some_and(|&v| v >= 3.0));
        // Fixed axis ends win
        let layout = ComboLayout::default();
        let fixed = LineYAxis { min: Some(-10.0), max: Some(100.0), ..Default::default() };
        let chart = ChartState::new_combo(vec![series(ComboSeriesKind::Bar, vec![1.0, 3.0], 0, RED)], None, layout, [fixed, LineYAxis::default()]).unwrap();
        assert_eq!(chart.combo_y_domain(0), Some((-10.0, 100.0)));
        assert_eq!(chart.combo_y_domain(1), None);
    }

    #[test]
    fn hover_returns_bars_and_lines_at_the_category() {
        let (cam, mut chart) = revenue();
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        let c = combo(&chart);
        // Pointer inside the series 1 segment of category 2
        let seg = c.bars.as_ref().unwrap().segs[4 + 2].unwrap();
        let p = cam.project_to_ndc(Vec3::new(c.category_x(2), (seg.y0 + seg.y1) * 0.5, 0.0)).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (p.x, p.y)).expect("category 2");
        assert_eq!(hit.items.len(), 3);
        assert!(hit.items.iter().all(|i| i.index == 2));
        assert_eq!(hit.items.iter().map(|i| i.series).collect::<Vec<_>>(), vec![0, 1, 2]);
        assert_eq!(hit.items[2].value, 0.15);
        assert_eq!(hit.items[1].global_id, 4 + 2);
        assert_eq!(hit.primary, 1, "segment under the pointer");
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.markers.unwrap().len(), 1, "marker on the line point only");
        assert_eq!(layers.overlay.unwrap().len(), 1, "crosshair");
        let bars = layers.bars.unwrap().to_vec();
        // Both bars of category 2 are tinted, the others keep their color
        assert_ne!(bars[2].color, RED);
        assert_ne!(bars[6].color, BLUE);
        assert_eq!(bars[1].color, RED);
        // Sample positions: bar top / line point (keyboard focus, tooltips)
        let (s, i, val, pos) = chart.sample(2 * 4 + 1).unwrap();
        assert_eq!((s, i, val), (2, 1, 0.18));
        assert!((pos.x - combo(&chart).category_x(1)).abs() < 1e-3);
        assert_eq!(chart.sample(4).unwrap().2, 5.0);

        // Nearest mode keeps the closest item only
        chart.set_hover_style(ChartHoverStyle { mode: HoverMode::Nearest, ..Default::default() }, &mut scene);
        let hit = chart.hover_at(&v, &mut scene, (p.x, p.y)).unwrap();
        assert_eq!((hit.items.len(), hit.items[0].series), (1, 1));

        // Synced cursor at category 3
        let hit = chart.hover_at_data_x(&mut scene, 3.2).unwrap();
        assert!(hit.items.iter().all(|i| i.index == 3));
        assert_eq!(chart.hover_data_x(), Some(3.0));
    }

    #[test]
    fn legend_toggle_restacks_bars_and_hides_lines() {
        let (cam, mut chart) = revenue();
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        let before = combo(&chart).bars.as_ref().unwrap().segs[4].unwrap();
        chart.set_series_visible(0, false, &mut scene);
        assert!(!chart.series_visible(0));
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.bars.unwrap().len(), 4);
        let c = combo(&chart);
        let after = c.bars.as_ref().unwrap().segs[4].unwrap();
        assert!(after.y0 < before.y0, "series 1 drops onto the baseline");
        assert_eq!(after.y0, c.bars.as_ref().unwrap().zero_y);
        assert_eq!(chart.combo_y_domain(0), Some((0.0, 50.0)), "domain stays fixed");
        // Hidden line: no strokes, not hovered
        chart.set_series_visible(2, false, &mut scene);
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.series.unwrap().len(), 0);
        let hit = chart.hover_at_data_x(&mut scene, 1.0).unwrap();
        assert_eq!(hit.items.iter().map(|i| i.series).collect::<Vec<_>>(), vec![1]);
        // Emphasis on the line fades every bar
        chart.set_series_visible(2, true, &mut scene);
        chart.set_emphasis(Some(2));
        let bars = chart.prepare_layers(&v).bars.unwrap().to_vec();
        assert!(bars.iter().all(|b| b.color[3] < 0.5));
    }

    #[test]
    fn areas_fill_to_zero_and_zoom_moves_bars_with_lines() {
        let n = 40;
        let vals: Vec<f32> = (0..n).map(|i| 5.0 + (i % 7) as f32).collect();
        let (cam, mut chart) = state(
            vec![
                series(ComboSeriesKind::Bar, vals.clone(), 0, RED),
                series(ComboSeriesKind::Area, vals.iter().map(|v| v * 0.5).collect(), 0, BLUE),
            ],
            None,
            BarMode::Grouped,
        );
        let v = view(&cam);
        let layers = chart.prepare_layers(&v);
        let fills = layers.fills.unwrap().to_vec();
        assert_eq!(fills.len(), (n - 1) * 6);
        let base = combo(&chart).baseline_y(0);
        assert!(fills.iter().any(|f| (f.position[1] - base).abs() < 1e-4));
        assert!((fills[0].color[3] - 0.2).abs() < 1e-6);
        // Zoom in around the plot center: bars follow the window and get clipped
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&v, 0.25, c.x);
        assert!(chart.x_window().1 - chart.x_window().0 < 0.3);
        let layers = chart.prepare_layers(&v);
        assert!(layers.series_clip.is_some());
        let bars = layers.bars.unwrap().to_vec();
        let combo = combo(&chart);
        let mid = n / 2;
        let center = (bars[mid].rect[0] + bars[mid].rect[2]) * 0.5;
        assert!((center - combo.line.point(0, mid).x).abs() < 1e-3);
        // Category ticks only inside the window
        let xs: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 0).map(|t| t.value).collect();
        assert!(!xs.is_empty() && xs.iter().all(|x| (13.0..=27.0).contains(x)), "{xs:?}");
        chart.reset_zoom();
        assert_eq!(chart.x_window(), (0.0, 1.0));
    }

    #[test]
    fn bars_only_combo_keeps_a_hidden_placeholder_line() {
        let (cam, mut chart) = state(vec![series(ComboSeriesKind::Bar, vec![3.0, 1.0, 2.0], 1, RED)], None, BarMode::Grouped);
        assert_eq!(chart.series_count(), 1);
        // All-right input moves to the left axis
        assert_eq!(chart.combo_series().unwrap(), vec![(ComboSeriesKind::Bar, 0)]);
        let layers = chart.prepare_layers(&view(&cam));
        assert_eq!(layers.bars.unwrap().len(), 3);
        assert_eq!(layers.series.unwrap().len(), 0);
        assert_eq!(chart.point_count(), 3);
    }

    #[test]
    fn primary_follows_the_pointer_across_grouped_bars_and_lines_win_ties() {
        let (cam, mut chart) = state(
            vec![
                series(ComboSeriesKind::Bar, vec![30.0, 30.0], 0, RED),
                series(ComboSeriesKind::Bar, vec![10.0, 10.0], 0, BLUE),
                series(ComboSeriesKind::Line, vec![5.0, 5.0], 0, GREEN),
            ],
            None,
            BarMode::Grouped,
        );
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.set_hover_style(ChartHoverStyle { mode: HoverMode::Nearest, ..Default::default() }, &mut scene);
        // Inside the short series 1 bar (same y range as series 0's lower half)
        let (_, _, _, top) = chart.sample(2).unwrap();
        let p = cam.project_to_ndc(Vec3::new(top.x, top.y - 1.0, 0.0)).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (p.x, p.y)).unwrap();
        assert_eq!(hit.items[0].series, 1);
        // Keyboard focus on the line point (inside a bar): the line wins the tie
        let (_, _, _, pt) = chart.sample(2 * 2 + 1).unwrap();
        let p = cam.project_to_ndc(pt).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (p.x, p.y)).unwrap();
        assert_eq!((hit.items[0].series, hit.items[0].index), (2, 1));
    }

    #[test]
    fn bar_axis_honors_nice_false_and_mixed_axis_bars_share_one() {
        let layout = ComboLayout::default();
        let raw = LineYAxis { nice: false, ..Default::default() };
        let chart = ChartState::new_combo(vec![series(ComboSeriesKind::Bar, vec![1.0, 42.0], 0, RED)], None, layout, [raw, raw]).unwrap();
        assert_eq!(chart.combo_y_domain(0), Some((0.0, 42.0)));
        // Bars [right, left] alone: both follow the first (right), then move to the left axis
        let chart = ChartState::new_combo(
            vec![series(ComboSeriesKind::Bar, vec![1.0, 2.0], 1, RED), series(ComboSeriesKind::Bar, vec![3.0, 4.0], 0, BLUE)],
            None,
            layout,
            [LineYAxis::default(); 2],
        )
        .unwrap();
        assert_eq!(chart.combo_series().unwrap(), vec![(ComboSeriesKind::Bar, 0), (ComboSeriesKind::Bar, 0)]);
        assert_eq!(chart.combo_y_domain(1), None);
    }

    #[test]
    fn toggling_a_series_drops_the_stale_hover() {
        let (cam, mut chart) = revenue();
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        assert!(chart.hover_at_data_x(&mut scene, 1.0).is_some());
        chart.set_series_visible(1, false, &mut scene);
        assert_eq!(chart.prepare_layers(&v).markers.map(<[_]>::len), Some(0));
    }

    #[test]
    fn zoom_history_covers_combo_x_zoom() {
        let series = vec![
            series(ComboSeriesKind::Bar, (0..20).map(|i| i as f32).collect(), 0, RED),
            series(ComboSeriesKind::Line, (0..20).map(|i| (i * 2) as f32).collect(), 0, RED),
        ];
        let (cam, mut chart) = state(series, None, BarMode::Grouped);
        let v = ChartView { camera: &cam, viewport_px: (1600, 900), pixel_ratio: 1.0 };
        let start = chart.zoom_state().expect("combo has a zoom state");
        chart.zoom_history_push();
        chart.zoom_x(&v, 0.5, 0.0);
        assert_ne!(chart.zoom_state().unwrap(), start);
        assert!(chart.zoom_undo());
        assert_eq!(chart.zoom_state().unwrap(), start);
        assert!(chart.zoom_redo());
        assert_ne!(chart.zoom_state().unwrap(), start);
    }
}
