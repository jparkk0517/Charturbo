//! Bar chart styling: horizontal orientation, error bars, and data-label anchors.
//!
//! Orientation re-maps the bar layout (`BarChart::world`); error bars are drawn as segments with
//! caps in the series layer and widen the value domain; data labels are laid out in CSS px from
//! text sizes measured by the SDK (anchor, inside / outside, fit and collision tests here; the
//! SDK only places DOM text at the anchors).

use super::bar::{BarChart, BarMode};
use super::line::DIMMED_SERIES_ALPHA;
use super::*;

/// Direction the bars grow in (2D only; the 3D matrix is always vertical).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BarOrientation {
    #[default]
    Vertical,
    /// Categories down the left axis, values along x (first category at the top)
    Horizontal,
}

impl BarOrientation {
    /// 0 = vertical, 1 = horizontal
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Horizontal
        } else {
            Self::Vertical
        }
    }
}

/// Orientation and error bars of a bar chart.
#[derive(Debug, Clone, PartialEq)]
pub struct BarStyle {
    pub orientation: BarOrientation,
    /// Error amount below / above each value by global id (`NaN` or missing = none; the absolute
    /// value is used). Stacked bars put the error on the segment's data end; percent bars ignore it
    pub error_minus: Vec<f32>,
    pub error_plus: Vec<f32>,
    pub error_color: [f32; 4],
    pub error_width_px: f32,
    /// Cap length as a fraction of the bar thickness (0 = no caps)
    pub error_cap: f32,
}

impl Default for BarStyle {
    fn default() -> Self {
        Self {
            orientation: BarOrientation::Vertical,
            error_minus: Vec::new(),
            error_plus: Vec::new(),
            error_color: [0.36, 0.4, 0.47, 1.0],
            error_width_px: 1.25,
            error_cap: 0.4,
        }
    }
}

/// Depth of the error bars: over the bars (z = 0), under the hover overlay.
const ERROR_Z: f32 = 0.05;
/// Px kept between neighbouring labels in `Auto` mode.
const LABEL_GAP_PX: f32 = 2.0;
/// Px per upright category tick label along a vertical bar chart's x axis.
const CATEGORY_TICK_PX: f32 = 88.0;
/// Px across one rotated category label: its line box (14) plus the SDK's label gap (8).
const ROTATED_TICK_PX: f32 = 22.0;

impl BarStyle {
    /// `(minus, plus)` value-unit error of a value, `None` without one.
    pub(crate) fn error(&self, global: usize) -> Option<(f32, f32)> {
        let get = |v: &[f32]| v.get(global).copied().filter(|e| e.is_finite()).map(f32::abs);
        let (m, p) = (get(&self.error_minus), get(&self.error_plus));
        (m.is_some() || p.is_some()).then(|| (m.unwrap_or(0.0), p.unwrap_or(0.0)))
    }

    /// Value extent of every error bar (on stacks: around each segment's cumulative end).
    pub(crate) fn error_extent(&self, values: &[f32], n: usize, s_count: usize, mode: BarMode) -> Option<(f32, f32)> {
        if mode == BarMode::Percent || (self.error_minus.is_empty() && self.error_plus.is_empty()) {
            return None;
        }
        let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
        for i in 0..n {
            let (mut pos, mut neg) = (0.0f32, 0.0f32);
            for s in 0..s_count {
                let g = s * n + i;
                let v = values[g];
                if !v.is_finite() {
                    continue;
                }
                let end = match mode {
                    BarMode::Stacked if v < 0.0 => {
                        neg += v;
                        neg
                    }
                    BarMode::Stacked => {
                        pos += v;
                        pos
                    }
                    _ => v,
                };
                if let Some((m, p)) = self.error(g) {
                    lo = lo.min(end - m);
                    hi = hi.max(end + p);
                }
            }
        }
        (lo <= hi).then_some((lo, hi))
    }
}

/// When data labels are shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BarLabelMode {
    #[default]
    Off,
    /// Every label at its position (stack segments: only when it fits inside)
    Show,
    /// Inside labels that do not fit move outside; labels leaving the canvas, overlapping another
    /// label, or (outside) covering another bar are hidden
    Auto,
}

impl BarLabelMode {
    /// 0 = off, 1 = show, 2 = auto
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Show,
            2 => Self::Auto,
            _ => Self::Off,
        }
    }
}

/// Where a label sits on its bar (stack segments use `Center` instead of `Outside`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BarLabelPosition {
    /// Beyond the data end (beyond its error bar)
    #[default]
    Outside,
    /// Inside, against the data end
    Inside,
    /// Inside, against the baseline
    InsideBase,
    /// Centered in the bar
    Center,
}

impl BarLabelPosition {
    /// 0 = outside, 1 = inside, 2 = inside base, 3 = center
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Inside,
            2 => Self::InsideBase,
            3 => Self::Center,
            _ => Self::Outside,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BarLabelOptions {
    pub mode: BarLabelMode,
    pub position: BarLabelPosition,
    /// CSS px between the text box and the bar end / base
    pub pad_px: f32,
}

impl Default for BarLabelOptions {
    fn default() -> Self {
        Self { mode: BarLabelMode::Off, position: BarLabelPosition::Outside, pad_px: 4.0 }
    }
}

/// Text box center of one shown data label (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BarLabel {
    pub global: u32,
    pub x_css: f32,
    pub y_css: f32,
    /// Drawn over the bar fill (the SDK picks a contrasting text color)
    pub inside: bool,
}

/// Label options, measured text sizes, and the anchors of the last frame.
#[derive(Debug, Clone, Default)]
pub(crate) struct BarLabels {
    pub(crate) opts: BarLabelOptions,
    /// `[width, height]` CSS px of each value's text by global id (`NaN` = no label)
    pub(crate) sizes: Vec<[f32; 2]>,
    pub(crate) out: Vec<BarLabel>,
    scratch: Vec<BarLabel>,
    /// View the anchors were laid out for (`None` = stale)
    pub(crate) key: Option<[f32; 19]>,
    pub(crate) revision: u32,
}

/// Label candidate: anchor, CSS box `[x0, y0, x1, y1]`.
struct Candidate {
    label: BarLabel,
    rect: [f32; 4],
}

fn overlaps(a: &[f32; 4], b: &[f32; 4], gap: f32) -> bool {
    a[0] < b[2] + gap && b[0] < a[2] + gap && a[1] < b[3] + gap && b[1] < a[3] + gap
}

impl BarChart {
    /// Error bars: a stem from `value - minus` to `value + plus` at the bar center plus caps,
    /// faded with the bar on legend emphasis (2D; none on percent bars).
    pub(crate) fn build_errors(&self, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if self.layout.view != ChartViewMode::Flat || self.mode == BarMode::Percent {
            return;
        }
        let n = self.categories.max(1);
        let s = &self.style;
        let w = s.error_width_px.max(0.0);
        for (g, seg) in self.segs.iter().enumerate() {
            let (Some(seg), Some((minus, plus))) = (seg, s.error(g)) else {
                continue;
            };
            if minus + plus <= 0.0 {
                continue; // a zero error would still draw a round dot
            }
            let mut color = s.error_color;
            if self.emphasis.is_some_and(|e| e != g / n) {
                color[3] *= DIMMED_SERIES_ALPHA;
            }
            let c = (seg.x0 + seg.x1) * 0.5;
            let (lo, hi) = (seg.y1 - minus * self.scale, seg.y1 + plus * self.scale);
            let half_cap = (seg.x1 - seg.x0).abs() * s.error_cap.max(0.0) * 0.5;
            let mut push = |c0: f32, v0: f32, c1: f32, v1: f32| {
                let (a, b) = (self.world(c0, v0), self.world(c1, v1));
                out.push(ChartSegmentRaw {
                    p0_width: [a.0, a.1, ERROR_Z, w],
                    p1_pad: [b.0, b.1, ERROR_Z, 0.0],
                    color,
                });
            };
            push(c, lo, c, hi);
            if half_cap > 0.0 {
                for (v, e) in [(lo, minus), (hi, plus)] {
                    if e > 0.0 {
                        push(c - half_cap, v, c + half_cap, v);
                    }
                }
            }
        }
    }

    /// CSS px kept per category tick label on a vertical chart's x axis. Rotated labels are
    /// parallel strips: neighbours `d` apart clear each other across the text when
    /// `d * sin(a) >= line + gap`, or along it when `d * cos(a) >= 88` (the upright budget), so
    /// the smaller of the two is the spacing (the SDK thins the shown labels by their real size).
    pub(crate) fn category_tick_px(&self) -> f32 {
        let a = self.category_label_deg.to_radians();
        let (sin, cos) = (a.sin().abs(), a.cos().abs());
        if sin < 1e-3 {
            return CATEGORY_TICK_PX;
        }
        let across = ROTATED_TICK_PX / sin;
        if cos < 1e-3 { across } else { across.min(CATEGORY_TICK_PX / cos) }
    }

    /// Lays out the data labels of the visible bars / segments for `view` (see `BarLabelMode`).
    pub(crate) fn layout_labels(&self, view: &ChartView, out: &mut Vec<BarLabel>) {
        out.clear();
        let opts = self.labels.opts;
        if opts.mode == BarLabelMode::Off || self.layout.view != ChartViewMode::Flat {
            return;
        }
        let horizontal = self.horizontal();
        let auto = opts.mode == BarLabelMode::Auto;
        let stacked = self.mode != BarMode::Grouped;
        let pad = if opts.pad_px.is_finite() { opts.pad_px.max(0.0) } else { 4.0 };
        let pr = view.pixel_ratio.max(0.1);
        let canvas = (view.viewport_px.0 as f32 / pr, view.viewport_px.1 as f32 / pr);
        let css = |c: f32, v: f32| {
            let (x, y) = self.world(c, v);
            view.project_css(Vec3::new(x, y, 0.0))
        };
        let side_gap = self.mode == BarMode::Grouped && self.visible.iter().filter(|&&v| v).count() > 1;
        let mut cands = Vec::new();
        // Every drawn bar in CSS px: outside labels must not cover another one (auto mode)
        let mut bars: Vec<(usize, [f32; 4])> = Vec::new();
        for (g, seg) in self.segs.iter().enumerate() {
            let Some(seg) = seg else { continue };
            let cm = (seg.x0 + seg.x1) * 0.5;
            let (Some(base), Some(end), Some(e0), Some(e1)) =
                (css(cm, seg.y0), css(cm, seg.y1), css(seg.x0, seg.y1), css(seg.x1, seg.y1))
            else {
                continue;
            };
            if auto {
                let (x0, x1) = (base.0.min(end.0).min(e0.0).min(e1.0), base.0.max(end.0).max(e0.0).max(e1.0));
                let (y0, y1) = (base.1.min(end.1).min(e0.1).min(e1.1), base.1.max(end.1).max(e0.1).max(e1.1));
                bars.push((g, [x0, y0, x1, y1]));
            }
            let Some(&[w, h]) = self.labels.sizes.get(g) else { continue };
            if !(w.is_finite() && h.is_finite() && w >= 0.0 && h >= 0.0) {
                continue;
            }
            // Screen direction from the base to the data end (axis aligned)
            let up = seg.y1 >= seg.y0;
            let dir = match (horizontal, up) {
                (false, true) => (0.0, -1.0),
                (false, false) => (0.0, 1.0),
                (true, true) => (1.0, 0.0),
                (true, false) => (-1.0, 0.0),
            };
            let len = (end.0 - base.0).abs() + (end.1 - base.1).abs();
            let thick = (e0.0 - e1.0).abs() + (e0.1 - e1.1).abs() - if side_gap { self.gap_px } else { 0.0 };
            let (along, across) = if horizontal { (w, h) } else { (h, w) };
            let fits = along + 2.0 * pad <= len && across + 2.0 <= thick;

            let mut pos = opts.position;
            if stacked && pos == BarLabelPosition::Outside {
                pos = BarLabelPosition::Center;
            }
            if pos != BarLabelPosition::Outside && !fits {
                if stacked {
                    continue; // stack segments: inside only, when the text fits
                }
                if auto {
                    pos = BarLabelPosition::Outside;
                }
            }
            let d = match pos {
                BarLabelPosition::Outside => {
                    // Clear the error bar on the data-end side
                    let reach = match self.style.error(g).filter(|_| self.mode != BarMode::Percent) {
                        Some((m, p)) => {
                            let v = if up { seg.y1 + p * self.scale } else { seg.y1 - m * self.scale };
                            css(cm, v).map_or(len, |e| (e.0 - base.0) * dir.0 + (e.1 - base.1) * dir.1)
                        }
                        None => len,
                    };
                    len.max(reach) + pad + along * 0.5
                }
                BarLabelPosition::Inside => len - pad - along * 0.5,
                BarLabelPosition::InsideBase => pad + along * 0.5,
                BarLabelPosition::Center => len * 0.5,
            };
            let (x, y) = (base.0 + dir.0 * d, base.1 + dir.1 * d);
            let rect = [x - w * 0.5, y - h * 0.5, x + w * 0.5, y + h * 0.5];
            let inside = pos != BarLabelPosition::Outside;
            if auto && !inside && (rect[0] < 0.0 || rect[1] < 0.0 || rect[2] > canvas.0 || rect[3] > canvas.1) {
                continue;
            }
            cands.push(Candidate { label: BarLabel { global: g as u32, x_css: x, y_css: y, inside }, rect });
        }
        if !auto {
            out.extend(cands.iter().map(|c| c.label));
            return;
        }
        // Greedy sweep along the category axis: a label is kept when it overlaps no kept label
        // and (outside labels) no other bar
        let lo = |r: &[f32; 4]| if horizontal { r[1] } else { r[0] };
        let ext = |r: &[f32; 4]| if horizontal { r[3] - r[1] } else { r[2] - r[0] };
        cands.sort_by(|a, b| lo(&a.rect).total_cmp(&lo(&b.rect)));
        bars.sort_by(|a, b| lo(&a.1).total_cmp(&lo(&b.1)));
        let max_label = cands.iter().map(|c| ext(&c.rect)).fold(0.0f32, f32::max);
        let max_bar = bars.iter().map(|b| ext(&b.1)).fold(0.0f32, f32::max);
        let mut kept: Vec<[f32; 4]> = Vec::new();
        for c in &cands {
            let start = lo(&c.rect) - max_label - LABEL_GAP_PX;
            let hit_label = kept
                .iter()
                .rev()
                .take_while(|k| lo(k) >= start)
                .any(|k| overlaps(k, &c.rect, LABEL_GAP_PX));
            if hit_label {
                continue;
            }
            if !c.label.inside {
                let from = bars.partition_point(|b| lo(&b.1) < lo(&c.rect) - max_bar);
                let end = lo(&c.rect) + ext(&c.rect);
                let hit_bar = bars[from..]
                    .iter()
                    .take_while(|b| lo(&b.1) <= end)
                    .any(|b| b.0 != c.label.global as usize && overlaps(&b.1, &c.rect, 0.0));
                if hit_bar {
                    continue;
                }
            }
            kept.push(c.rect);
            out.push(c.label);
        }
    }
}

impl ChartState {
    /// Error bars (series layer) and data-label anchors of bar charts; run by `prepare_layers`.
    pub(crate) fn prepare_bar_style(&mut self, view: &ChartView) {
        let b = match &mut self.kind {
            ChartKind::Bar(b) => b,
            // Waterfall bars carry bar labels too
            ChartKind::Waterfall(w) => &mut w.bar,
            _ => return,
        };
        if self.dirty.bars {
            b.build_errors(&mut self.series);
            self.dirty.series = true;
        }
        let key = view.key();
        if b.labels.key != Some(key) {
            let mut out = std::mem::take(&mut b.labels.scratch);
            b.layout_labels(view, &mut out);
            if out != b.labels.out {
                std::mem::swap(&mut out, &mut b.labels.out);
                b.labels.revision = b.labels.revision.wrapping_add(1);
            }
            b.labels.scratch = out;
            b.labels.key = Some(key);
        }
    }

    /// Sets the orientation / error bars of a 2D bar chart (not histograms): the domain, layout,
    /// axes and gridlines are rebuilt and any hover / selection dropped. Returns false otherwise.
    pub fn set_bar_style(&mut self, style: BarStyle) -> bool {
        let ChartKind::Bar(b) = &mut self.kind else {
            return false;
        };
        if !b.set_style(style) {
            return false;
        }
        // 2D only: no 3D scene highlight to reset
        self.hover = None;
        self.clear_selection();
        self.dirty.bars = true;
        self.dirty.underlay = true;
        self.dirty.overlay = true;
        self.axes_key = None;
        true
    }

    /// Data labels of a bar chart: options and the text size (`[w, h]` CSS px) of each value by
    /// global id (`NaN` = no label). Returns false without a bar chart.
    pub fn set_bar_labels(&mut self, opts: BarLabelOptions, sizes: Vec<[f32; 2]>) -> bool {
        let b = match &mut self.kind {
            ChartKind::Bar(b) => b,
            ChartKind::Waterfall(w) => &mut w.bar,
            _ => return false,
        };
        b.labels.opts = opts;
        b.labels.sizes = sizes;
        b.labels.key = None;
        true
    }

    /// Rotation (degrees) of the category tick labels of a vertical 2D bar chart (bars or
    /// waterfall): category ticks are thinned by the rotated label footprint instead of the
    /// upright one. Returns false otherwise (horizontal bars, histograms, 3D, other charts).
    pub fn set_bar_axis_label_rotation(&mut self, deg: f32) -> bool {
        let b = match &mut self.kind {
            ChartKind::Bar(b) => b,
            ChartKind::Waterfall(w) => &mut w.bar,
            _ => return false,
        };
        if b.horizontal() || b.histogram.is_some() || b.layout.view != ChartViewMode::Flat {
            return false;
        }
        b.category_label_deg = if deg.is_finite() { deg } else { 0.0 };
        self.axes_key = None;
        true
    }

    /// Shown data-label anchors of the last frame and their revision (bumps when they change).
    pub fn bar_labels(&self) -> Option<(&[BarLabel], u32)> {
        match &self.kind {
            ChartKind::Bar(b) => Some((&b.labels.out, b.labels.revision)),
            ChartKind::Waterfall(w) => Some((&w.bar.labels.out, w.bar.labels.revision)),
            _ => None,
        }
    }

    /// Orientation of the current bar chart.
    pub fn bar_orientation(&self) -> Option<BarOrientation> {
        match &self.kind {
            ChartKind::Bar(b) => Some(if b.horizontal() { BarOrientation::Horizontal } else { BarOrientation::Vertical }),
            ChartKind::Waterfall(w) => Some(if w.bar.horizontal() { BarOrientation::Horizontal } else { BarOrientation::Vertical }),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::bar::BarSeriesLayout;
    use super::*;

    fn layout() -> BarLayout {
        BarLayout { width: 160.0, max_height: 80.0, bar_width: 0.0, corner_radius_px: 4.0, view: ChartViewMode::Flat }
    }

    fn state(values: Vec<f32>, series_count: usize, mode: BarMode, style: BarStyle) -> (ChartState, OrbitCamera) {
        let mut scene = SceneWorld::new();
        let colors = (0..series_count.max(values.len())).map(|s| [s as f32 * 0.1, 0.5, 0.5, 1.0]).collect();
        let series = BarSeriesLayout { series_count, mode, ..Default::default() };
        let mut st = ChartState::new_bar_series(values, colors, layout(), series, &mut scene);
        assert!(st.set_bar_style(style));
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        st.frame_camera(&mut cam, (1600.0, 900.0));
        (st, cam)
    }

    fn horizontal() -> BarStyle {
        BarStyle { orientation: BarOrientation::Horizontal, ..Default::default() }
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn bar(st: &ChartState) -> &BarChart {
        match &st.kind {
            ChartKind::Bar(b) => b,
            _ => unreachable!(),
        }
    }

    #[test]
    fn horizontal_bars_grow_right_from_a_vertical_baseline_with_the_first_category_on_top() {
        let (mut st, cam) = state(vec![10.0, 20.0, -5.0], 1, BarMode::Grouped, horizontal());
        let v = view(&cam);
        let layers = st.prepare_layers(&v);
        let bars = layers.bars.unwrap().to_vec();
        assert_eq!(bars.len(), 3);
        let b = bar(&st);
        // Value axis on x: zero baseline is a vertical line, positive bars end right of it
        let zero_x = b.zero_y;
        assert_eq!((bars[0].rect[0], bars[0].z_radius[2]), (zero_x, 2.0));
        assert!((bars[1].rect[2] - (zero_x + 20.0 * b.scale)).abs() < 1e-4);
        assert_eq!((bars[2].rect[2], bars[2].z_radius[2]), (zero_x, -2.0), "negative: rounded on the left");
        // Category 0 at the top, thickness along y
        assert!(bars[0].rect[1] > bars[1].rect[1] && bars[1].rect[1] > bars[2].rect[1]);
        assert!((bars[0].rect[3] - bars[0].rect[1] - b.bar_width).abs() < 1e-4);
        // The value axis spans the plot width
        assert!((b.scale * (b.v_max - b.v_min) - 160.0).abs() < 1e-3);
    }

    #[test]
    fn horizontal_axes_put_values_along_the_bottom_and_categories_on_the_left() {
        let (mut st, cam) = state(vec![10.0, 20.0, 30.0], 1, BarMode::Grouped, horizontal());
        let v = view(&cam);
        st.prepare_layers(&v);
        let axes = st.axes();
        let [l, t, w, h] = axes.plot_css;
        let values: Vec<_> = axes.ticks.iter().filter(|k| k.axis == 0).collect();
        let cats: Vec<_> = axes.ticks.iter().filter(|k| k.axis == 1).collect();
        assert!(values.len() >= 3 && values.iter().all(|k| (k.y_css - (t + h)).abs() < 1e-3));
        assert!(values.windows(2).all(|p| p[1].x_css > p[0].x_css), "values grow to the right");
        assert_eq!(values[0].value, 0.0);
        assert!((values[0].x_css - l).abs() < 1.0);
        assert_eq!(cats.iter().map(|k| k.value).collect::<Vec<_>>(), vec![0.0, 1.0, 2.0]);
        assert!(cats.iter().all(|k| k.x_css == l));
        assert!(cats[0].y_css < cats[1].y_css && cats[1].y_css < cats[2].y_css, "first category on top");
        assert!(cats[0].y_css > t && cats[2].y_css < t + h);
        assert!(w > 0.0);
        // Gridlines are vertical
        let mut g = Vec::new();
        bar(&st).build_grid(&ChartFrameStyle::default(), &mut g);
        assert!(g.len() >= 3);
        assert!(g.iter().all(|s| s.p0_width[0] == s.p1_pad[0] && s.p0_width[1] != s.p1_pad[1]));
    }

    #[test]
    fn horizontal_category_labels_thin_out_by_plot_height() {
        let (mut st, cam) = state((0..200).map(|i| i as f32).collect(), 1, BarMode::Grouped, horizontal());
        st.prepare_layers(&view(&cam));
        let cats: Vec<_> = st.axes().ticks.iter().filter(|k| k.axis == 1).collect();
        assert!(cats.len() < 60 && cats.len() > 10, "{}", cats.len());
        assert!(cats.windows(2).all(|p| p[1].y_css - p[0].y_css >= 17.9));
    }

    #[test]
    fn horizontal_hover_finds_grouped_and_stacked_segments() {
        let (mut st, cam) = state(vec![1.0, 2.0, 3.0, 4.0], 2, BarMode::Grouped, horizontal());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let b = bar(&st);
        // series 1, category 0 (global 2): center of its bar
        let seg = b.segs[2].unwrap();
        let (x, y) = b.world((seg.x0 + seg.x1) * 0.5, (seg.y0 + seg.y1) * 0.5);
        let end_x = b.zero_y + 3.0 * b.scale;
        let p = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        let hit = st.hover_at(&v, &mut scene, (p.x, p.y)).unwrap();
        assert_eq!((hit.items[0].series, hit.items[0].index, hit.items[0].global_id), (1, 0, 2));
        // Sample position = data end (right end of the bar)
        let s = st.sample(2).unwrap();
        assert!((s.3.x - end_x).abs() < 1e-4 && (s.3.y - y).abs() < 1e-4);

        let (mut st, cam) = state(vec![10.0, 20.0, 30.0, 40.0], 2, BarMode::Stacked, horizontal());
        let v = view(&cam);
        let b = bar(&st);
        let seg = b.segs[3].unwrap(); // series 1, category 1: right part of the second row
        let (x, y) = b.world((seg.x0 + seg.x1) * 0.5, (seg.y0 + seg.y1) * 0.5);
        let p = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        let hit = st.hover_at(&v, &mut scene, (p.x, p.y)).unwrap();
        assert_eq!(hit.items.len(), 2);
        assert_eq!(hit.items[hit.primary].global_id, 3);
        // Far right of the plot (outside the slack): no hit
        let p = cam.project_to_ndc(Vec3::new(120.0, y, 0.0)).unwrap();
        assert!(st.hover_at(&v, &mut scene, (p.x, p.y)).is_none());
    }

    #[test]
    fn horizontal_annotation_frame_maps_values_on_x_and_categories_on_y_without_brush() {
        let (mut st, _) = state(vec![10.0, 20.0, 30.0], 1, BarMode::Grouped, horizontal());
        let f = st.annotation_frame().unwrap();
        let b = bar(&st);
        assert!((f.x.map(20.0) - (b.zero_y + 20.0 * b.scale)).abs() < 1e-4);
        assert!((f.y.map(0.0) - (-b.slots[0].0)).abs() < 1e-4, "category 0 at the top");
        assert!(f.y.map(0.0) > f.y.map(2.0));
        assert_eq!(f.bounds, [-80.0, 80.0, -40.0, 40.0]);
        assert!(st.select_data(BrushMode::X, (0.0, 1.0), None).is_none());
    }

    #[test]
    fn style_changes_keep_3d_and_histograms_vertical() {
        let mut scene = SceneWorld::new();
        let mut st = ChartState::new_bar(
            vec![1.0, 2.0],
            vec![[1.0; 4]],
            BarLayout { view: ChartViewMode::Depth, ..layout() },
            &mut scene,
        );
        assert!(!st.set_bar_style(horizontal()));
        assert_eq!(st.bar_orientation(), Some(BarOrientation::Vertical));
        let mut h = ChartState::new_histogram(&[1.0, 2.0, 3.0], &HistogramOptions::default(), [1.0; 4], layout(), 1.0, &mut scene);
        assert!(!h.set_bar_style(horizontal()));
    }

    #[test]
    fn error_bars_widen_the_domain_and_draw_a_stem_with_caps() {
        let style = BarStyle { error_minus: vec![2.0, f32::NAN], error_plus: vec![15.0, 3.0], ..Default::default() };
        let (mut st, cam) = state(vec![10.0, 8.0], 1, BarMode::Grouped, style);
        let b = bar(&st);
        assert!(b.v_max >= 25.0, "10 + 15 inside the domain: {}", b.v_max);
        let segs = st.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        // bar 0: stem + 2 caps; bar 1: plus only -> stem + 1 cap
        assert_eq!(segs.len(), 5);
        let b = bar(&st);
        let stem = segs[0];
        assert_eq!(stem.p0_width[0], stem.p1_pad[0], "vertical stem");
        assert!((stem.p0_width[1] - (b.zero_y + 8.0 * b.scale)).abs() < 1e-4);
        assert!((stem.p1_pad[1] - (b.zero_y + 25.0 * b.scale)).abs() < 1e-4);
        assert_eq!(segs[1].p0_width[1], segs[1].p1_pad[1], "horizontal cap");
        assert!(segs[1].p1_pad[0] - segs[1].p0_width[0] > 0.0);

        // Horizontal: stems run along x
        let style = BarStyle { error_plus: vec![5.0], error_minus: vec![5.0], ..horizontal() };
        let (mut st, cam) = state(vec![10.0], 1, BarMode::Grouped, style);
        let segs = st.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        assert_eq!(segs.len(), 3);
        assert_eq!(segs[0].p0_width[1], segs[0].p1_pad[1]);
        assert!(segs[0].p1_pad[0] > segs[0].p0_width[0]);
    }

    #[test]
    fn stacked_errors_sit_on_the_cumulative_end_and_percent_ignores_them() {
        let style = BarStyle { error_plus: vec![0.0, 25.0], ..Default::default() };
        let (st, _) = state(vec![10.0, 20.0], 2, BarMode::Stacked, style.clone());
        let b = bar(&st);
        assert!(b.v_max >= 55.0, "stack top 30 + 25: {}", b.v_max);
        let mut segs = Vec::new();
        b.build_errors(&mut segs);
        assert_eq!(segs.len(), 2, "series 0: zero error, nothing; series 1: stem + cap");
        assert!((segs[0].p0_width[1] - (b.zero_y + 30.0 * b.scale)).abs() < 1e-4);
        let (st, _) = state(vec![10.0, 20.0], 2, BarMode::Percent, style);
        let b = bar(&st);
        assert_eq!(b.v_max, 100.0);
        b.build_errors(&mut segs);
        assert!(segs.is_empty());
    }

    fn labels(st: &mut ChartState, cam: &OrbitCamera, mode: BarLabelMode, position: BarLabelPosition, size: [f32; 2]) -> Vec<BarLabel> {
        let n = bar(st).values.len();
        st.set_bar_labels(BarLabelOptions { mode, position, pad_px: 4.0 }, vec![size; n]);
        st.prepare_layers(&view(cam));
        st.bar_labels().unwrap().0.to_vec()
    }

    /// Bar `g` in CSS px `[x0, y0, x1, y1]`.
    fn bar_css(st: &ChartState, cam: &OrbitCamera, g: usize) -> [f32; 4] {
        let b = bar(st);
        let (rect, _) = b.bar_rect(&b.segs[g].unwrap());
        let v = view(cam);
        let a = v.project_css(Vec3::new(rect[0], rect[1], 0.0)).unwrap();
        let c = v.project_css(Vec3::new(rect[2], rect[3], 0.0)).unwrap();
        [a.0.min(c.0), a.1.min(c.1), a.0.max(c.0), a.1.max(c.1)]
    }

    #[test]
    fn label_anchors_follow_the_position_and_orientation() {
        let (mut st, cam) = state(vec![10.0, -20.0, 30.0], 1, BarMode::Grouped, BarStyle::default());
        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Outside, [20.0, 12.0]);
        assert_eq!(out.len(), 3);
        let r0 = bar_css(&st, &cam, 0);
        // Outside above a positive bar: box bottom = bar top - pad
        assert!((out[0].y_css + 6.0 - (r0[1] - 4.0)).abs() < 1e-3);
        assert!((out[0].x_css - (r0[0] + r0[2]) * 0.5).abs() < 1e-3);
        assert!(!out[0].inside);
        // Negative bar: below its data end
        let r1 = bar_css(&st, &cam, 1);
        assert!((out[1].y_css - 6.0 - (r1[3] + 4.0)).abs() < 1e-3);

        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Inside, [20.0, 12.0]);
        assert!(out.iter().all(|l| l.inside));
        assert!((out[2].y_css - 6.0 - (bar_css(&st, &cam, 2)[1] + 4.0)).abs() < 1e-3);
        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::InsideBase, [20.0, 12.0]);
        assert!((out[2].y_css + 6.0 - (bar_css(&st, &cam, 2)[3] - 4.0)).abs() < 1e-3);
        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Center, [20.0, 12.0]);
        let r2 = bar_css(&st, &cam, 2);
        assert!((out[2].y_css - (r2[1] + r2[3]) * 0.5).abs() < 1e-3);

        // Horizontal outside: right of the bar end, vertically centered
        let (mut st, cam) = state(vec![10.0, 30.0], 1, BarMode::Grouped, horizontal());
        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Outside, [30.0, 12.0]);
        let r = bar_css(&st, &cam, 0);
        assert!((out[0].x_css - 15.0 - (r[2] + 4.0)).abs() < 1e-3);
        assert!((out[0].y_css - (r[1] + r[3]) * 0.5).abs() < 1e-3);
    }

    #[test]
    fn auto_labels_move_outside_when_they_do_not_fit_and_hide_on_collision() {
        // Tiny second bar: the inside label cannot fit -> outside
        let (mut st, cam) = state(vec![100.0, 1.0], 1, BarMode::Grouped, BarStyle::default());
        let out = labels(&mut st, &cam, BarLabelMode::Auto, BarLabelPosition::Inside, [30.0, 12.0]);
        assert_eq!(out.len(), 2);
        assert!(out.iter().find(|l| l.global == 0).unwrap().inside);
        assert!(!out.iter().find(|l| l.global == 1).unwrap().inside);
        // Show keeps it inside even though it does not fit
        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Inside, [30.0, 12.0]);
        assert!(out.iter().all(|l| l.inside));

        // 200 bars with labels wider than a slot: auto keeps a non-overlapping subset
        let values: Vec<f32> = (0..200).map(|i| 50.0 + (i % 7) as f32).collect();
        let (mut st, cam) = state(values, 1, BarMode::Grouped, BarStyle::default());
        let size = [40.0, 12.0];
        let out = labels(&mut st, &cam, BarLabelMode::Auto, BarLabelPosition::Outside, size);
        assert!(!out.is_empty() && out.len() < 100, "{}", out.len());
        let boxes: Vec<[f32; 4]> =
            out.iter().map(|l| [l.x_css - 20.0, l.y_css - 6.0, l.x_css + 20.0, l.y_css + 6.0]).collect();
        for (i, a) in boxes.iter().enumerate() {
            for b in &boxes[i + 1..] {
                assert!(!overlaps(a, b, 0.0), "labels overlap");
            }
        }
        let shown = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Outside, size);
        assert_eq!(shown.len(), 200);
    }

    #[test]
    fn auto_outside_labels_do_not_cover_neighbouring_grouped_bars() {
        // Short bar between two tall ones (grouped): its wide outside label would hit them
        let (mut st, cam) = state(vec![100.0, 5.0, 100.0], 3, BarMode::Grouped, BarStyle::default());
        let out = labels(&mut st, &cam, BarLabelMode::Auto, BarLabelPosition::Outside, [500.0, 12.0]);
        assert!(out.iter().all(|l| l.global != 1), "{out:?}");
        // Narrower than its own bar: no collision, shown
        let out = labels(&mut st, &cam, BarLabelMode::Auto, BarLabelPosition::Outside, [40.0, 12.0]);
        assert!(out.iter().any(|l| l.global == 1));
    }

    #[test]
    fn stacked_labels_sit_inside_their_segment_only_when_they_fit() {
        let (mut st, cam) = state(vec![50.0, 1.0, 40.0, 50.0, 30.0, 1.0], 3, BarMode::Stacked, BarStyle::default());
        // 3 series x 2 categories; tiny segments (1.0) cannot hold 12 px text
        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Outside, [20.0, 12.0]);
        let ids: Vec<u32> = out.iter().map(|l| l.global).collect();
        assert!(!ids.contains(&1) && !ids.contains(&5), "{ids:?}");
        assert_eq!(ids.len(), 4);
        assert!(out.iter().all(|l| l.inside), "outside becomes center on stacks");
        for l in &out {
            let r = bar_css(&st, &cam, l.global as usize);
            assert!((l.y_css - (r[1] + r[3]) * 0.5).abs() < 1e-3 && l.x_css > r[0] && l.x_css < r[2]);
        }
        // Hiding a series restacks: anchors move and the revision bumps
        let rev = st.bar_labels().unwrap().1;
        let mut scene = SceneWorld::new();
        st.set_series_visible(0, false, &mut scene);
        st.prepare_layers(&view(&cam));
        let (l, rev2) = st.bar_labels().unwrap();
        assert_ne!(rev, rev2);
        assert!(l.iter().all(|l| l.global >= 2));
        // Same view, nothing changed: no new revision
        st.prepare_layers(&view(&cam));
        assert_eq!(st.bar_labels().unwrap().1, rev2);
    }

    #[test]
    fn rotated_label_boxes_anchor_and_fit_by_their_own_size() {
        // 90° labels: the SDK sends each rotated box (line height across, text width along)
        let (mut st, cam) = state(vec![100.0, 10.0], 1, BarMode::Grouped, BarStyle::default());
        let opts = BarLabelOptions { mode: BarLabelMode::Show, position: BarLabelPosition::Outside, pad_px: 4.0 };
        st.set_bar_labels(opts, vec![[14.0, 60.0], [14.0, 20.0]]);
        st.prepare_layers(&view(&cam));
        let out = st.bar_labels().unwrap().0.to_vec();
        // Box bottom = bar top - pad, per label height
        assert!((out[0].y_css + 30.0 - (bar_css(&st, &cam, 0)[1] - 4.0)).abs() < 1e-3);
        assert!((out[1].y_css + 10.0 - (bar_css(&st, &cam, 1)[1] - 4.0)).abs() < 1e-3);
        // Auto inside: the tall box does not fit the short bar and moves outside
        let auto = BarLabelOptions { mode: BarLabelMode::Auto, position: BarLabelPosition::Inside, ..opts };
        st.set_bar_labels(auto, vec![[14.0, 90.0], [14.0, 90.0]]);
        st.prepare_layers(&view(&cam));
        let out = st.bar_labels().unwrap().0.to_vec();
        assert!(out.iter().find(|l| l.global == 0).unwrap().inside);
        assert!(!out.iter().find(|l| l.global == 1).unwrap().inside);
    }

    #[test]
    fn rotated_category_labels_thin_out_by_their_rotated_footprint() {
        let values: Vec<f32> = (0..200).map(|i| i as f32).collect();
        let (mut st, cam) = state(values, 1, BarMode::Grouped, BarStyle::default());
        let cats = |st: &ChartState| st.axes().ticks.iter().filter(|k| k.axis == 0).map(|k| k.x_css).collect::<Vec<_>>();
        st.prepare_layers(&view(&cam));
        let upright = cats(&st);
        assert!(upright.windows(2).all(|p| p[1] - p[0] >= 87.9));
        // 90°: one line box + gap per label; the axes are re-laid out without a new view
        assert!(st.set_bar_axis_label_rotation(90.0));
        st.prepare_layers(&view(&cam));
        let vertical = cats(&st);
        assert!(vertical.len() > upright.len() * 3, "{} vs {}", vertical.len(), upright.len());
        assert!(vertical.windows(2).all(|p| p[1] - p[0] >= 21.9));
        // 45°: in between; 0° keeps the upright spacing
        assert!(st.set_bar_axis_label_rotation(-45.0));
        st.prepare_layers(&view(&cam));
        let n45 = cats(&st).len();
        assert!(n45 > upright.len() && n45 < vertical.len(), "{n45}");
        assert!(st.set_bar_axis_label_rotation(0.0));
        st.prepare_layers(&view(&cam));
        assert_eq!(cats(&st).len(), upright.len());
        // Horizontal bars (categories on y) ignore it
        let (mut st, _) = state(vec![1.0, 2.0], 1, BarMode::Grouped, horizontal());
        assert!(!st.set_bar_axis_label_rotation(90.0));
    }

    #[test]
    fn outside_labels_clear_the_error_bar() {
        let style = BarStyle { error_plus: vec![20.0], error_minus: vec![20.0], ..Default::default() };
        let (mut st, cam) = state(vec![50.0], 1, BarMode::Grouped, style);
        let out = labels(&mut st, &cam, BarLabelMode::Show, BarLabelPosition::Outside, [20.0, 12.0]);
        let b = bar(&st);
        let top = view(&cam).project_css(Vec3::new(0.0, b.zero_y + 70.0 * b.scale, 0.0)).unwrap().1;
        assert!((out[0].y_css + 6.0 - (top - 4.0)).abs() < 1e-3);
    }
}
