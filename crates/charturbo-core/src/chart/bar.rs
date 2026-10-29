//! Bar chart: flat 2D bars (single, grouped, stacked, percent-stacked) and the lit 3D matrix.

use super::bar_style::{BarLabels, BarOrientation, BarStyle};
use super::line::DIMMED_SERIES_ALPHA;
use super::*;

// -----------------------------------------------------------------------------
// Bar chart
// -----------------------------------------------------------------------------

/// How several series share a category slot.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BarMode {
    /// Series side by side inside the slot
    Grouped,
    /// Positive values stack up, negative values stack down, per category
    Stacked,
    /// Stacked, each category normalized to 100% of its absolute sum
    Percent,
}

impl BarMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Stacked,
            2 => Self::Percent,
            _ => Self::Grouped,
        }
    }

    fn stacks(self) -> bool {
        self != Self::Grouped
    }
}

/// Series arrangement of a bar chart. Values are flat `[s * categories + i]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BarSeriesLayout {
    pub series_count: usize,
    pub mode: BarMode,
    /// Empty fraction of each slot between groups when `BarLayout::bar_width` is 0
    pub group_gap: f32,
    /// CSS px between grouped bars / between stacked segments
    pub gap_px: f32,
}

impl Default for BarSeriesLayout {
    fn default() -> Self {
        Self {
            series_count: 1,
            mode: BarMode::Grouped,
            group_gap: 0.28,
            gap_px: 2.0,
        }
    }
}

/// Rectangle of one bar / stack segment in category-axis (`x`) / value-axis (`y`) coordinates:
/// `y0` = base side, `y1` = data end. Equal to world x / y for vertical bars; horizontal bars map
/// through `BarChart::world`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct BarSeg {
    pub(crate) x0: f32,
    pub(crate) x1: f32,
    pub(crate) y0: f32,
    pub(crate) y1: f32,
    /// Outermost segment of its stack (gets the rounded corners, no gap)
    pub(crate) outer: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct BarChart {
    /// Flat `[s * categories + i]`; `NaN` = missing
    pub(crate) values: Vec<f32>,
    /// Per bar for a single series, per series otherwise
    pub(crate) colors: Vec<[f32; 4]>,
    pub(crate) layout: BarLayout,
    pub(crate) series_count: usize,
    pub(crate) categories: usize,
    pub(crate) mode: BarMode,
    pub(crate) gap_px: f32,
    pub(crate) visible: Vec<bool>,
    /// Series drawn at full strength while the others fade (legend hover)
    pub(crate) emphasis: Option<usize>,
    /// Layout of every value by global id (`None` = missing, zero-height stack part, or hidden)
    pub(crate) segs: Vec<Option<BarSeg>>,
    /// Slot centers (x, z), one per category
    pub(crate) slots: Vec<(f32, f32)>,
    pub(crate) spacing: f32,
    /// Width of a whole category group
    pub(crate) bar_width: f32,
    /// World y of the plot bottom, the zero baseline, and world units per value unit
    pub(crate) bottom: f32,
    pub(crate) zero_y: f32,
    pub(crate) scale: f32,
    /// Nice value domain and tick step
    pub(crate) v_min: f32,
    pub(crate) v_max: f32,
    pub(crate) v_step: f64,
    /// Scene objects of the 3D matrix view (bars, then floor)
    pub(crate) bar_objects: Vec<u32>,
    pub(crate) floor_object: Option<u32>,
    /// Histogram bins: numeric x axis ticked at bin edges, pixel gaps between every bar
    pub(crate) histogram: Option<super::histogram::Histogram>,
    /// Empty slot fraction between groups (kept to re-shape on style changes)
    pub(crate) group_gap: f32,
    /// Orientation and error bars (bar_style.rs)
    pub(crate) style: BarStyle,
    /// Data-label options and the anchors of the last frame (bar_style.rs)
    pub(crate) labels: BarLabels,
    /// Floating bars (waterfall.rs): value-axis base of each bar by global id (empty or
    /// non-finite = the zero baseline). Grouped single-series layout only
    pub(crate) bases: Vec<f32>,
    /// Color of the background tracks behind the bars (`None` = none; bar_style.rs)
    pub(crate) background: Option<[f32; 4]>,
    /// Rotation of the category tick labels in degrees (0 = upright; bar_style.rs)
    pub(crate) category_label_deg: f32,
    /// Symbols drawn instead of the bars (pictorial.rs)
    pub(crate) pictorial: Option<super::pictorial::Pictorial>,
}

impl BarChart {
    pub(crate) fn new(mut values: Vec<f32>, mut colors: Vec<[f32; 4]>, layout: BarLayout, series: BarSeriesLayout) -> Self {
        let mut s_count = series.series_count.max(1);
        let n = values.len() / s_count;
        values.truncate(n * s_count);
        // The 3D matrix shows one series: extra series are ignored
        if layout.view == ChartViewMode::Depth && s_count > 1 {
            values.truncate(n);
            colors.truncate(1);
            s_count = 1;
        }
        let group_gap = if series.group_gap.is_finite() {
            series.group_gap.clamp(0.0, 0.95)
        } else {
            0.28
        };
        let mut chart = Self {
            values,
            colors,
            layout,
            series_count: s_count,
            categories: n,
            mode: series.mode,
            gap_px: if series.gap_px.is_finite() { series.gap_px.max(0.0) } else { 2.0 },
            visible: vec![true; s_count],
            emphasis: None,
            segs: Vec::new(),
            slots: Vec::new(),
            spacing: 0.0,
            bar_width: 0.0,
            bottom: 0.0,
            zero_y: 0.0,
            scale: 1.0,
            v_min: 0.0,
            v_max: 0.0,
            v_step: 1.0,
            bar_objects: Vec::new(),
            floor_object: None,
            histogram: None,
            group_gap,
            style: BarStyle::default(),
            labels: BarLabels::default(),
            bases: Vec::new(),
            background: None,
            category_label_deg: 0.0,
            pictorial: None,
        };
        chart.reshape();
        chart.relayout();
        chart
    }

    /// Bars run left to right (2D only; the 3D matrix stays vertical).
    pub(crate) fn horizontal(&self) -> bool {
        self.layout.view == ChartViewMode::Flat && self.style.orientation == BarOrientation::Horizontal
    }

    /// World lengths of the (category axis, value axis).
    pub(crate) fn axis_lengths(&self) -> (f32, f32) {
        if self.horizontal() {
            (self.layout.max_height, self.layout.width)
        } else {
            (self.layout.width, self.layout.max_height)
        }
    }

    /// World (x, y) of a category-axis / value-axis position (`BarSeg` coordinates). Horizontal
    /// bars put values on x and the first category at the top.
    pub(crate) fn world(&self, c: f32, v: f32) -> (f32, f32) {
        if self.horizontal() {
            (v, -c)
        } else {
            (c, v)
        }
    }

    /// Inverse of `world`.
    fn logical(&self, x: f32, y: f32) -> (f32, f32) {
        if self.horizontal() {
            (-y, x)
        } else {
            (x, y)
        }
    }

    /// Nice value domain (values, stacks and error bars), value scale, and category slots.
    fn reshape(&mut self) {
        let (n, s_count, mode) = (self.categories, self.series_count, self.mode);
        let values = &self.values;
        let layout = self.layout;

        // Bars always include the zero baseline; stacks span their per-category sums. The domain
        // is computed with every series visible and stays fixed when series are toggled.
        let (mut vmin, mut vmax) = match mode {
            BarMode::Grouped => {
                // Floating bars: their bases are inside the domain too
                let finite = values.iter().chain(&self.bases).copied().filter(|v| v.is_finite());
                (finite.clone().fold(0.0f32, f32::min), finite.fold(0.0f32, f32::max))
            }
            BarMode::Stacked => (0..n).fold((0.0f32, 0.0f32), |(lo, hi), i| {
                let (neg, pos) = (0..s_count)
                    .map(|s| values[s * n + i])
                    .filter(|v| v.is_finite())
                    .fold((0.0f32, 0.0f32), |(neg, pos), v| {
                        if v < 0.0 {
                            (neg + v, pos)
                        } else {
                            (neg, pos + v)
                        }
                    });
                (lo.min(neg), hi.max(pos))
            }),
            BarMode::Percent => {
                let any = |f: fn(f32) -> bool| values.iter().any(|&v| v.is_finite() && f(v));
                (
                    if any(|v| v < 0.0) { -100.0 } else { 0.0 },
                    if any(|v| v > 0.0) { 100.0 } else { 0.0 },
                )
            }
        };
        // Error bars stay inside the plot (2D only)
        if layout.view == ChartViewMode::Flat {
            if let Some((lo, hi)) = self.style.error_extent(values, n, s_count, mode) {
                (vmin, vmax) = (vmin.min(lo), vmax.max(hi));
            }
        }
        let (nmin, nmax, v_step) = nice_domain(vmin as f64, vmax as f64, ChartFrameStyle::default().grid_rows);
        let (vmin, vmax) = (nmin.min(0.0) as f32, nmax.max(0.0) as f32);
        let span = (vmax - vmin).max(1e-6);
        let (cat_len, val_len) = self.axis_lengths();
        let scale = val_len / span;
        let bottom = match layout.view {
            ChartViewMode::Flat => -val_len * 0.5,
            ChartViewMode::Depth => 0.0,
        };

        let (slots, spacing) = match layout.view {
            ChartViewMode::Flat => {
                let spacing = cat_len / n.max(1) as f32;
                let slots = (0..n)
                    .map(|i| ((i as f32 - (n as f32 - 1.0) * 0.5) * spacing, 0.0))
                    .collect();
                (slots, spacing)
            }
            ChartViewMode::Depth => {
                let cols = (n as f32).sqrt().ceil().max(1.0) as usize;
                let rows = n.div_ceil(cols).max(1);
                let span_xz = layout.width * 0.75;
                let step = span_xz / (cols.max(2) - 1) as f32;
                // Grid centered on the origin whatever its row / column count
                let slots = (0..n)
                    .map(|i| {
                        let (r, c) = (i / cols, i % cols);
                        (
                            (c as f32 - (cols as f32 - 1.0) * 0.5) * step,
                            (r as f32 - (rows as f32 - 1.0) * 0.5) * step,
                        )
                    })
                    .collect();
                (slots, step)
            }
        };
        self.bar_width = if layout.bar_width > 0.0 {
            layout.bar_width
        } else {
            (spacing * (1.0 - self.group_gap)).max(1e-3)
        };
        self.slots = slots;
        self.spacing = spacing;
        self.bottom = bottom;
        self.zero_y = bottom - vmin * scale;
        self.scale = scale;
        (self.v_min, self.v_max, self.v_step) = (vmin, vmax, v_step);
    }

    /// Applies orientation / error bars (2D, not histograms): re-shapes the domain and layout.
    pub(crate) fn set_style(&mut self, style: BarStyle) -> bool {
        if self.layout.view != ChartViewMode::Flat || self.histogram.is_some() {
            return false;
        }
        self.style = style;
        self.reshape();
        self.relayout();
        true
    }

    /// Recomputes every bar / segment rectangle from the visible series (the domain stays fixed).
    pub(crate) fn relayout(&mut self) {
        let n = self.categories;
        // Label anchors follow the segments
        self.labels.key = None;
        self.segs.clear();
        self.segs.resize(self.values.len(), None);
        let vis: Vec<usize> = (0..self.series_count).filter(|&s| self.visible[s]).collect();
        if vis.is_empty() {
            return;
        }
        let hw = self.bar_width * 0.5;
        match self.mode {
            BarMode::Grouped => {
                // Hidden series give their share of the group to the visible ones
                let sub = self.bar_width / vis.len() as f32;
                for (j, &s) in vis.iter().enumerate() {
                    for i in 0..n {
                        let v = self.values[s * n + i];
                        if !v.is_finite() {
                            continue;
                        }
                        let x0 = self.slots[i].0 - hw + j as f32 * sub;
                        let base = self.bases.get(s * n + i).copied().filter(|b| b.is_finite()).unwrap_or(0.0);
                        self.segs[s * n + i] = Some(BarSeg {
                            x0,
                            x1: x0 + sub,
                            y0: self.zero_y + base * self.scale,
                            y1: self.zero_y + v * self.scale,
                            outer: true,
                        });
                    }
                }
            }
            BarMode::Stacked | BarMode::Percent => {
                for i in 0..n {
                    let x = self.slots[i].0;
                    let norm = if self.mode == BarMode::Percent {
                        let total: f32 = vis
                            .iter()
                            .map(|&s| self.values[s * n + i])
                            .filter(|v| v.is_finite())
                            .map(f32::abs)
                            .sum();
                        if total > 0.0 {
                            100.0 / total
                        } else {
                            0.0
                        }
                    } else {
                        1.0
                    };
                    // Running sums of the up (positive) and down (negative) stacks
                    let (mut pos, mut neg) = (0.0f32, 0.0f32);
                    let (mut last_pos, mut last_neg) = (None, None);
                    for &s in &vis {
                        let g = s * n + i;
                        let v = self.values[g] * norm;
                        // Zero / missing values take no space and never own the rounded end
                        if !v.is_finite() || v == 0.0 {
                            continue;
                        }
                        let acc = if v > 0.0 { &mut pos } else { &mut neg };
                        let y0 = self.zero_y + *acc * self.scale;
                        *acc += v;
                        self.segs[g] = Some(BarSeg {
                            x0: x - hw,
                            x1: x + hw,
                            y0,
                            y1: self.zero_y + *acc * self.scale,
                            outer: false,
                        });
                        if v > 0.0 {
                            last_pos = Some(g);
                        } else {
                            last_neg = Some(g);
                        }
                    }
                    for g in [last_pos, last_neg].into_iter().flatten() {
                        if let Some(seg) = &mut self.segs[g] {
                            seg.outer = true;
                        }
                    }
                }
            }
        }
    }

    /// Shows / hides a series and restacks (2D only); returns whether anything changed.
    pub(crate) fn set_visible(&mut self, series: usize, visible: bool) -> bool {
        if self.layout.view != ChartViewMode::Flat {
            return false;
        }
        match self.visible.get_mut(series) {
            Some(v) if *v != visible => {
                *v = visible;
                self.relayout();
                true
            }
            _ => false,
        }
    }

    pub(crate) fn color_of(&self, global: usize) -> [f32; 4] {
        let n = self.categories.max(1);
        let key = if self.series_count == 1 { global % n } else { global / n };
        self.colors
            .get(key)
            .or_else(|| self.colors.last())
            .copied()
            .unwrap_or([0.224, 0.529, 0.898, 1.0])
    }

    /// Value-axis position of a value's data end (the baseline when it is not laid out).
    pub(crate) fn top_y(&self, global: usize) -> f32 {
        self.segs.get(global).copied().flatten().map_or(self.zero_y, |s| s.y1)
    }

    pub(crate) fn hover_color(&self, global: usize, style: &ChartHoverStyle) -> [f32; 4] {
        style
            .bar_highlight_color
            .unwrap_or_else(|| lighten(self.color_of(global), 0.22))
    }

    /// `hovered` = global id of the highlighted bar / segment. Background tracks (if any) come
    /// first, then one bar per laid-out segment in global id order.
    pub(crate) fn build_bars(&self, hovered: Option<usize>, style: &ChartHoverStyle, out: &mut Vec<ChartBarRaw>) {
        out.clear();
        if self.layout.view != ChartViewMode::Flat {
            return;
        }
        // Background tracks first: below every bar
        self.build_tracks(out);
        // Pictorial bars: the symbols (fills) replace the bars, the tracks stay as shadow bars
        if self.pictorial.is_some() {
            return;
        }
        let n = self.categories.max(1);
        let side_gap = (self.mode == BarMode::Grouped && self.visible.iter().filter(|&&v| v).count() > 1)
            || self.histogram.is_some();
        for (g, seg) in self.segs.iter().enumerate() {
            let Some(seg) = seg else { continue };
            let mut color = if hovered == Some(g) {
                self.hover_color(g, style)
            } else {
                self.color_of(g)
            };
            if self.emphasis.is_some_and(|e| e != g / n) {
                color[3] *= DIMMED_SERIES_ALPHA;
            }
            // Pixel gaps are cut on the GPU: < 0 trims both sides (grouped), > 0 the data end
            // of inner stack segments
            let gap = if side_gap {
                -self.gap_px
            } else if !seg.outer {
                self.gap_px
            } else {
                0.0
            };
            let (rect, end) = self.bar_rect(seg);
            out.push(ChartBarRaw {
                rect,
                z_radius: [0.0, if seg.outer { self.layout.corner_radius_px } else { 0.0 }, end, gap],
                color,
            });
        }
    }

    /// World rect `[x0, y0, x1, y1]` of a segment and its rounded-end code for the bar shader
    /// (1 / -1 = top / bottom, 2 / -2 = right / left).
    pub(crate) fn bar_rect(&self, seg: &BarSeg) -> ([f32; 4], f32) {
        let end = if seg.y1 >= seg.y0 { 1.0 } else { -1.0 };
        let (v0, v1) = (seg.y0.min(seg.y1), seg.y0.max(seg.y1));
        if self.horizontal() {
            ([v0, -seg.x1, v1, -seg.x0], end * 2.0)
        } else {
            ([seg.x0, v0, seg.x1, v1], end)
        }
    }

    /// Value gridlines across the category axis (horizontal lines, vertical for horizontal bars).
    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if self.layout.view != ChartViewMode::Flat || !style.show_grid {
            return;
        }
        let half_c = self.axis_lengths().0 * 0.5;
        let z = -0.5;
        let mut line = |v: f32, color: [f32; 4]| {
            let (a, b) = (self.world(-half_c, v), self.world(half_c, v));
            out.push(ChartSegmentRaw {
                p0_width: [a.0, a.1, z, style.stroke_px],
                p1_pad: [b.0, b.1, z, 0.0],
                color,
            });
        };
        for v in ticks_between(self.v_min as f64, self.v_max as f64, self.v_step) {
            if v == 0.0 {
                continue; // drawn as the baseline below
            }
            line(self.zero_y + v as f32 * self.scale, style.grid_color);
        }
        line(self.zero_y, style.baseline_color);
    }

    /// Plot rectangle, value ticks, and thinned-out category ticks (2D view only).
    pub(crate) fn axes(&self, view: &ChartView, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = [0.0; 4];
        if self.layout.view != ChartViewMode::Flat || self.slots.is_empty() {
            return;
        }
        let (half_w, half_h) = (self.layout.width * 0.5, self.layout.max_height * 0.5);
        let Some(plot) = plot_rect_css(view, half_w, -half_h, half_h, 0.0) else {
            return;
        };
        out.plot_css = plot;
        let bottom = plot[1] + plot[3];
        if self.horizontal() {
            return self.horizontal_axes(view, plot, out);
        }
        for v in ticks_between(self.v_min as f64, self.v_max as f64, self.v_step) {
            let y = self.zero_y + v as f32 * self.scale;
            if let Some((_, cy)) = view.project_css(Vec3::new(-half_w, y, 0.0)) {
                out.ticks.push(AxisTick { axis: 1, value: v, x_css: plot[0], y_css: cy, granularity: 0 });
            }
        }
        if let Some(h) = &self.histogram {
            self.edge_ticks(&h.edges, view, plot, out);
            return;
        }
        // One category label per ~88 px (rotated labels: their footprint) so labels never collide
        let n = self.slots.len();
        let every = ((n as f32 * self.category_tick_px() / plot[2].max(1.0)).ceil() as usize).max(1);
        for i in (0..n).step_by(every) {
            if let Some((cx, _)) = view.project_css(Vec3::new(self.slots[i].0, self.bottom, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value: i as f64, x_css: cx, y_css: bottom, granularity: 0 });
            }
        }
    }

    /// Horizontal bars: value ticks along the bottom (axis 0), category labels down the left
    /// (axis 1, one per ~18 px of plot height so labels never collide).
    fn horizontal_axes(&self, view: &ChartView, plot: [f32; 4], out: &mut AxisLayout) {
        let bottom = plot[1] + plot[3];
        for v in ticks_between(self.v_min as f64, self.v_max as f64, self.v_step) {
            let x = self.zero_y + v as f32 * self.scale;
            if let Some((cx, _)) = view.project_css(Vec3::new(x, 0.0, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value: v, x_css: cx, y_css: bottom, granularity: 0 });
            }
        }
        let n = self.slots.len();
        let every = ((n as f32 * 18.0 / plot[3].max(1.0)).ceil() as usize).max(1);
        for i in (0..n).step_by(every) {
            if let Some((_, cy)) = view.project_css(Vec3::new(0.0, -self.slots[i].0, 0.0)) {
                out.ticks.push(AxisTick { axis: 1, value: i as f64, x_css: plot[0], y_css: cy, granularity: 0 });
            }
        }
    }

    /// Creates the 3D matrix bars and floor as lit scene boxes.
    pub(crate) fn spawn_scene_objects(&mut self, scene: &mut SceneWorld) {
        if self.layout.view != ChartViewMode::Depth {
            return;
        }
        for i in 0..self.values.len() {
            let (x, z) = self.slots[i];
            let top = self.top_y(i);
            let h = (top - self.zero_y).abs().max(1e-3);
            let id = scene.add_primitive(
                PrimitiveKind::Box,
                Vec3::new(x, (top + self.zero_y) * 0.5, z),
                Vec3::new(self.bar_width, h, self.bar_width),
                self.color_of(i),
                BodyType::Static,
            );
            scene.set_object_material(
                id,
                Material {
                    color: self.color_of(i),
                    metallic: 0.1,
                    roughness: 0.7,
                    emissive: 0.0,
                },
            );
            self.bar_objects.push(id);
        }
        let floor_span = self.layout.width * 0.9;
        self.floor_object = Some(scene.add_primitive(
            PrimitiveKind::Box,
            Vec3::new(0.0, -1.2, 0.0),
            Vec3::new(floor_span, 2.4, floor_span),
            [0.09, 0.14, 0.24, 1.0],
            BodyType::Static,
        ));
    }

    pub(crate) fn despawn_scene_objects(&mut self, scene: &mut SceneWorld) {
        for id in self.bar_objects.drain(..) {
            scene.remove_object(id);
        }
        if let Some(id) = self.floor_object.take() {
            scene.remove_object(id);
        }
    }

    pub(crate) fn set_scene_highlight(&self, scene: &mut SceneWorld, index: usize, on: bool, style: &ChartHoverStyle) {
        let Some(&id) = self.bar_objects.get(index) else {
            return;
        };
        let color = if on {
            self.hover_color(index, style)
        } else {
            self.color_of(index)
        };
        if let Some(obj) = scene.find_object_mut(id) {
            obj.material.color = color;
        }
    }

    /// `(series, category, value, data-end position)` of a bar by global id.
    pub(crate) fn sample(&self, global: usize) -> Option<(u32, u32, f32, Vec3)> {
        let v = *self.values.get(global)?;
        let (s, i) = (global / self.categories, global % self.categories);
        let (c, z) = self.slots[i];
        let c = self.segs[global].map_or(c, |seg| (seg.x0 + seg.x1) * 0.5);
        let (x, y) = self.world(c, self.top_y(global));
        Some((s as u32, i as u32, v, Vec3::new(x, y, z)))
    }

    fn item(&self, global: usize) -> HoverItem {
        let n = self.categories.max(1);
        HoverItem {
            series: (global / n) as u32,
            index: (global % n) as u32,
            value: self.values[global],
            global_id: global as u32,
        }
    }

    /// Single / grouped: the bar under the pointer. Stacked: every visible series of the hovered
    /// category, with the segment under the pointer (or the closest one) as primary.
    pub(crate) fn hover(&self, view: &ChartView, scene: &SceneWorld, ndc: (f32, f32)) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let n = self.categories;
        let (index, hit_y) = match self.layout.view {
            ChartViewMode::Flat => {
                let hit = ray_hit_z_plane(&ray, 0.0)?;
                // Category-axis / value-axis position of the pointer
                let (hc, hv) = self.logical(hit.x, hit.y);
                // The whole column band of a slot is hoverable, so tiny bars stay easy to hit
                let val_len = self.axis_lengths().1;
                let top = self.bottom + val_len;
                let slack = val_len * HOVER_Y_SLACK;
                if hv < self.bottom - slack || hv > top + slack {
                    return None;
                }
                let first_c = self.slots.first()?.0;
                let i = ((hc - first_c) / self.spacing).round();
                if i < 0.0 || i as usize >= self.slots.len() {
                    return None;
                }
                let i = i as usize;
                if (hc - self.slots[i].0).abs() > self.spacing * 0.5 {
                    return None;
                }
                if !self.mode.stacks() && self.series_count > 1 {
                    // Sub-slot of the visible series under the pointer (clamped to the group)
                    let vis: Vec<usize> = (0..self.series_count).filter(|&s| self.visible[s]).collect();
                    let last = vis.len().checked_sub(1)?;
                    let sub = self.bar_width / vis.len() as f32;
                    let x0 = self.slots[i].0 - self.bar_width * 0.5;
                    let j = (((hc - x0) / sub).floor().max(0.0) as usize).min(last);
                    let g = vis[j] * n + i;
                    self.segs[g]?;
                    return Some(HoverResult { is_bar: true, primary: 0, items: vec![self.item(g)] });
                }
                (i, hv)
            }
            ChartViewMode::Depth => {
                let (id, _) = scene.raycast_object_silent(&ray)?;
                (self.bar_objects.iter().position(|&b| b == id)?, f32::NAN)
            }
        };
        if !self.mode.stacks() {
            if !self.visible[0] {
                return None;
            }
            return Some(HoverResult { is_bar: true, primary: 0, items: vec![self.item(index)] });
        }
        let mut items = Vec::new();
        let (mut primary, mut best) = (0, f32::INFINITY);
        for s in (0..self.series_count).filter(|&s| self.visible[s]) {
            let g = s * n + index;
            if !self.values[g].is_finite() {
                continue;
            }
            if let Some(seg) = self.segs[g] {
                let (lo, hi) = (seg.y0.min(seg.y1), seg.y0.max(seg.y1));
                let d = if hit_y < lo {
                    lo - hit_y
                } else if hit_y > hi {
                    hit_y - hi
                } else {
                    0.0
                };
                if d < best {
                    best = d;
                    primary = items.len();
                }
            }
            items.push(self.item(g));
        }
        if items.is_empty() {
            return None;
        }
        Some(HoverResult { is_bar: true, primary, items })
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        match self.layout.view {
            ChartViewMode::Flat => {
                frame_flat(camera, css, self.layout.width, self.layout.max_height, padding);
            }
            ChartViewMode::Depth => {
                let span = self.layout.width * 0.9;
                let center = Vec3::new(0.0, self.layout.max_height * 0.5, 0.0);
                let half = Vec3::new(span, self.layout.max_height, span) * 0.5;
                frame_oblique(camera, center, half.length());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout(view: ChartViewMode) -> BarLayout {
        BarLayout {
            width: 160.0,
            max_height: 80.0,
            bar_width: 0.0,
            corner_radius_px: 4.0,
            view,
        }
    }

    fn chart(values: Vec<f32>, series_count: usize, mode: BarMode) -> BarChart {
        let colors = (0..series_count).map(|s| [s as f32 * 0.1, 0.5, 0.5, 1.0]).collect();
        let series = BarSeriesLayout {
            series_count,
            mode,
            ..Default::default()
        };
        BarChart::new(values, colors, layout(ChartViewMode::Flat), series)
    }

    fn seg(c: &BarChart, s: usize, i: usize) -> BarSeg {
        c.segs[s * c.categories + i].expect("segment laid out")
    }

    /// Value of a world y on the chart's value axis.
    fn value_at(c: &BarChart, y: f32) -> f32 {
        (y - c.zero_y) / c.scale
    }

    fn flat_view(c: &BarChart) -> (OrbitCamera, (u32, u32)) {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        c.frame_camera(&mut cam, (1600.0, 900.0), &DEFAULT_CHART_PADDING);
        (cam, (1600, 900))
    }

    #[test]
    fn stacks_sum_per_category_and_only_the_outer_segment_is_rounded() {
        // 2 series x 3 categories
        let c = chart(vec![10.0, 20.0, 30.0, 20.0, 30.0, 40.0], 2, BarMode::Stacked);
        assert_eq!((c.v_min, c.v_max), (0.0, 70.0)); // tallest stack 30 + 40, not the max value 40
        for i in 0..3 {
            let (a, b) = (seg(&c, 0, i), seg(&c, 1, i));
            assert_eq!(a.y0, c.zero_y);
            assert_eq!(b.y0, a.y1, "series 1 sits on series 0");
            assert!((value_at(&c, b.y1) - (c.values[i] + c.values[3 + i])).abs() < 1e-3);
            assert!(!a.outer && b.outer);
            assert_eq!((a.x0, a.x1), (b.x0, b.x1), "stack shares the slot width");
        }
        let mut bars = Vec::new();
        c.build_bars(None, &ChartHoverStyle::default(), &mut bars);
        assert_eq!(bars.len(), 6);
        // Inner segment: square, data end trimmed by the px gap; outer: rounded, no gap
        assert_eq!((bars[0].z_radius[1], bars[0].z_radius[3]), (0.0, 2.0));
        assert_eq!((bars[3].z_radius[1], bars[3].z_radius[3]), (4.0, 0.0));
    }

    #[test]
    fn negative_values_stack_down_separately() {
        // 4 series x 1 category: +10, -5, +20, -8
        let c = chart(vec![10.0, -5.0, 20.0, -8.0], 4, BarMode::Stacked);
        assert!(c.v_min <= -13.0 && c.v_max >= 30.0);
        let (p0, n1, p2, n3) = (seg(&c, 0, 0), seg(&c, 1, 0), seg(&c, 2, 0), seg(&c, 3, 0));
        assert_eq!(p2.y0, p0.y1);
        assert!((value_at(&c, p2.y1) - 30.0).abs() < 1e-3);
        assert_eq!(n1.y0, c.zero_y);
        assert_eq!(n3.y0, n1.y1);
        assert!((value_at(&c, n3.y1) + 13.0).abs() < 1e-3);
        assert!(!p0.outer && !n1.outer && p2.outer && n3.outer);
        let mut bars = Vec::new();
        c.build_bars(None, &ChartHoverStyle::default(), &mut bars);
        // Negative segments put their data end (rounded / gap side) at the bottom
        assert_eq!(bars[1].z_radius[2], -1.0);
        assert_eq!(bars[3].z_radius[2], -1.0);
        assert_eq!(bars[3].z_radius[1], 4.0);
    }

    #[test]
    fn percent_mode_normalizes_each_category_to_100() {
        let c = chart(vec![1.0, 10.0, 3.0, 30.0], 2, BarMode::Percent);
        assert_eq!((c.v_min, c.v_max), (0.0, 100.0));
        for i in 0..2 {
            assert!((value_at(&c, seg(&c, 0, i).y1) - 25.0).abs() < 1e-3);
            assert!((value_at(&c, seg(&c, 1, i).y1) - 100.0).abs() < 1e-3);
        }
        // Mixed signs: shares of the absolute sum, the domain covers both directions
        let c = chart(vec![3.0, -1.0], 2, BarMode::Percent);
        assert_eq!((c.v_min, c.v_max), (-100.0, 100.0));
        assert!((value_at(&c, seg(&c, 0, 0).y1) - 75.0).abs() < 1e-3);
        assert!((value_at(&c, seg(&c, 1, 0).y1) + 25.0).abs() < 1e-3);
    }

    #[test]
    fn grouped_bars_split_the_group_width_inside_their_slot() {
        // 3 series x 2 categories; slot = 80, group = 72% of it
        let c = chart(vec![1.0, 2.0, 3.0, 4.0, 5.0, f32::NAN], 3, BarMode::Grouped);
        assert_eq!(c.spacing, 80.0);
        assert!((c.bar_width - 57.6).abs() < 1e-4);
        assert_eq!(c.v_max, 5.0);
        for i in 0..2 {
            let slot = c.slots[i].0;
            let a = seg(&c, 0, i);
            assert!((a.x0 - (slot - c.bar_width * 0.5)).abs() < 1e-4);
            let b = seg(&c, 1, i);
            assert!((b.x0 - a.x1).abs() < 1e-4 && (b.x1 - b.x0 - c.bar_width / 3.0).abs() < 1e-4);
            assert!(a.outer && b.outer);
        }
        // Missing value keeps its sub-slot empty
        assert!(c.segs[5].is_none());
        assert!((seg(&c, 2, 0).x1 - (c.slots[0].0 + c.bar_width * 0.5)).abs() < 1e-4);
        let mut bars = Vec::new();
        c.build_bars(None, &ChartHoverStyle::default(), &mut bars);
        assert_eq!(bars.len(), 5);
        assert!(bars.iter().all(|b| b.z_radius[3] == -2.0 && b.z_radius[1] == 4.0), "side gaps");
    }

    #[test]
    fn stacked_hover_returns_the_whole_column_with_the_pointed_segment_as_primary() {
        let c = chart(vec![10.0, 20.0, 30.0, 20.0, 30.0, 40.0], 2, BarMode::Stacked);
        let (cam, viewport) = flat_view(&c);
        let view = ChartView { camera: &cam, viewport_px: viewport, pixel_ratio: 1.0 };
        let scene = SceneWorld::new();
        let top = seg(&c, 1, 2);
        let p = cam.project_to_ndc(Vec3::new(c.slots[2].0, (top.y0 + top.y1) * 0.5, 0.0)).unwrap();
        let hit = c.hover(&view, &scene, (p.x, p.y)).expect("column 2");
        assert!(hit.is_bar);
        assert_eq!(hit.items.len(), 2);
        assert_eq!(hit.primary, 1);
        assert_eq!(hit.items[1].series, 1);
        assert_eq!(hit.items[1].index, 2);
        assert_eq!(hit.items[1].global_id, 5);
        assert_eq!(hit.items[0].value, 30.0);
        // Above the stack: the closest (top) segment stays primary
        let p = cam.project_to_ndc(Vec3::new(c.slots[2].0, top.y1 + 2.0, 0.0)).unwrap();
        assert_eq!(c.hover(&view, &scene, (p.x, p.y)).unwrap().primary, 1);
        let base = seg(&c, 0, 0);
        let p = cam.project_to_ndc(Vec3::new(c.slots[0].0, base.y0 + 1.0, 0.0)).unwrap();
        let hit = c.hover(&view, &scene, (p.x, p.y)).unwrap();
        assert_eq!((hit.primary, hit.items[hit.primary].global_id), (0, 0));
    }

    #[test]
    fn grouped_hover_picks_the_bar_under_the_pointer() {
        let c = chart(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0], 3, BarMode::Grouped);
        let (cam, viewport) = flat_view(&c);
        let view = ChartView { camera: &cam, viewport_px: viewport, pixel_ratio: 1.0 };
        let scene = SceneWorld::new();
        let b = seg(&c, 2, 1);
        let p = cam.project_to_ndc(Vec3::new((b.x0 + b.x1) * 0.5, c.zero_y + 1.0, 0.0)).unwrap();
        let hit = c.hover(&view, &scene, (p.x, p.y)).unwrap();
        assert_eq!(hit.items.len(), 1);
        assert_eq!((hit.items[0].series, hit.items[0].index, hit.items[0].global_id), (2, 1, 5));
        assert_eq!(hit.items[0].value, 6.0);
    }

    #[test]
    fn hidden_series_restack_and_regroup_with_a_fixed_domain() {
        let mut c = chart(vec![10.0, 20.0, 30.0, 20.0, 30.0, 40.0], 2, BarMode::Stacked);
        let (lo, hi) = (c.v_min, c.v_max);
        assert!(c.set_visible(0, false));
        assert!(!c.set_visible(0, false), "no-op");
        assert!(c.segs[..3].iter().all(Option::is_none));
        let b = seg(&c, 1, 0);
        assert_eq!(b.y0, c.zero_y, "series 1 drops to the baseline");
        assert!(b.outer);
        assert_eq!((c.v_min, c.v_max), (lo, hi));

        let mut g = chart(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0], 3, BarMode::Grouped);
        g.set_visible(1, false);
        let (a, b) = (seg(&g, 0, 0), seg(&g, 2, 0));
        assert!((a.x1 - a.x0 - g.bar_width * 0.5).abs() < 1e-4, "two visible bars share the group");
        assert!((b.x0 - a.x1).abs() < 1e-4);
        // Emphasis fades every other series
        g.emphasis = Some(2);
        let mut bars = Vec::new();
        g.build_bars(Some(4), &ChartHoverStyle::default(), &mut bars);
        assert_eq!(bars.len(), 4);
        assert_eq!(bars[0].color[3], DIMMED_SERIES_ALPHA);
        assert_eq!(bars[3].color[3], 1.0);
        // The hovered bar (global id 4 = series 2, category 0) is highlighted
        assert_ne!(bars[2].color, g.color_of(4));
    }

    #[test]
    fn chart_state_toggles_bar_series_and_clears_a_stale_hover() {
        let mut scene = SceneWorld::new();
        let mut state = ChartState::new_bar_series(
            vec![10.0, 20.0, 30.0, 20.0, 30.0, 40.0],
            vec![[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]],
            layout(ChartViewMode::Flat),
            BarSeriesLayout {
                series_count: 2,
                mode: BarMode::Stacked,
                ..Default::default()
            },
            &mut scene,
        );
        assert_eq!(state.series_count(), 2);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        state.frame_camera(&mut cam, (1600.0, 900.0));
        let view = ChartView { camera: &cam, viewport_px: (1600, 900), pixel_ratio: 1.0 };
        assert_eq!(state.prepare_layers(&view).bars.unwrap().len(), 6);
        let p = cam.project_to_ndc(Vec3::new(0.0, -39.0, 0.0)).unwrap();
        assert!(state.hover_at(&view, &mut scene, (p.x, p.y)).is_some());
        state.set_series_visible(1, false, &mut scene);
        assert!(!state.series_visible(1));
        let layers = state.prepare_layers(&view);
        assert_eq!(layers.bars.unwrap().len(), 3);
        assert_eq!(layers.markers.map(<[_]>::len), Some(0), "hover cleared");
        assert_eq!(state.sample(4).map(|s| (s.0, s.1, s.2)), Some((1, 1, 30.0)));
        state.set_emphasis(Some(0));
        assert!(state.prepare_layers(&view).bars.is_some());
    }

    #[test]
    fn matrix_view_keeps_the_first_series_only() {
        let mut scene = SceneWorld::new();
        let state = ChartState::new_bar_series(
            vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            vec![[1.0, 0.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]],
            layout(ChartViewMode::Depth),
            BarSeriesLayout {
                series_count: 2,
                mode: BarMode::Stacked,
                ..Default::default()
            },
            &mut scene,
        );
        assert_eq!(state.series_count(), 1);
        assert_eq!(state.point_count(), 3);
        assert_eq!(scene.object_count(), 4); // 3 bars + floor
    }
}
