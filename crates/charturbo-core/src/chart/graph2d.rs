//! 2D graph (ECharts `graph` series): nodes and edges in the plane, laid out by force (the CPU
//! Barnes-Hut simulator of the 3D graph, run in the z = 0 plane), on a circle, at given
//! positions or on value axes (cartesian). Categories color the nodes and are the legend
//! entries (toggle hides a category and its edges, hover fades the others); hovering a node
//! fades everything but its adjacency. Edges are straight or quadratic curves (ECharts
//! `curveness`) with optional arrows at the target.

use super::hierarchy::*;
use super::*;

/// Segments of a curved edge.
pub const GRAPH_CURVE_SEGMENTS: usize = 12;
/// Label anchors at most.
pub const MAX_GRAPH_LABELS: usize = 1500;

/// Node placement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GraphLayout {
    #[default]
    Force,
    Circular,
    /// Given `x` / `y` (screen space, y down), fitted to the plot keeping the aspect
    None,
    /// `x` / `y` are values on the x / y axes (y up)
    Cartesian,
}

impl GraphLayout {
    /// 0 force, 1 circular, 2 none, 3 cartesian
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Circular,
            2 => Self::None,
            3 => Self::Cartesian,
            _ => Self::Force,
        }
    }
}

/// Edge color source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GraphEdgeColor {
    #[default]
    Neutral,
    Source,
    Target,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GraphOptions {
    pub layout: GraphLayout,
    pub edge_width_px: f32,
    /// ECharts curveness (0 = straight)
    pub curveness: f32,
    pub arrow: bool,
    pub arrow_px: f32,
    pub edge_color: GraphEdgeColor,
    /// NaN = 1 for neutral edges, 0.6 for colored ones
    pub edge_opacity: f32,
    /// Marker shape (0 circle, 1 square, 2 diamond, 3 triangle)
    pub symbol: u8,
    pub labels: bool,
    /// Circular: labels along the radius
    pub rotate_label: bool,
    pub label_line_px: f32,
    /// Force: simulation steps, ECharts-like repulsion / edge length / gravity
    pub iterations: u32,
    pub repulsion: f32,
    pub edge_length: f32,
    pub gravity: f32,
    /// Cartesian domains (NaN = nice extent of the data)
    pub x_range: (f64, f64),
    pub y_range: (f64, f64),
    /// Cartesian: x is a category index `0..x_categories` (0 = numeric)
    pub x_categories: u32,
}

impl Default for GraphOptions {
    fn default() -> Self {
        Self {
            layout: GraphLayout::Force,
            edge_width_px: 1.0,
            curveness: 0.0,
            arrow: false,
            arrow_px: 8.0,
            edge_color: GraphEdgeColor::Neutral,
            edge_opacity: f32::NAN,
            symbol: 0,
            labels: true,
            rotate_label: false,
            label_line_px: 14.0,
            iterations: 300,
            repulsion: 50.0,
            edge_length: 30.0,
            gravity: 0.1,
            x_range: (f64::NAN, f64::NAN),
            y_range: (f64::NAN, f64::NAN),
            x_categories: 0,
        }
    }
}

/// Graph input (node count = `value.len()`; optional per-node arrays empty or one per node).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct GraphData {
    pub value: Vec<f64>,
    pub x: Vec<f64>,
    pub y: Vec<f64>,
    /// Category per node (< 0 = none)
    pub category: Vec<i32>,
    pub category_count: u32,
    /// Symbol diameter per node (CSS px)
    pub size_px: Vec<f32>,
    /// Force: keep the node at its given x / y
    pub fixed: Vec<bool>,
    pub sources: Vec<u32>,
    pub targets: Vec<u32>,
    /// Per edge width (NaN = default)
    pub edge_width: Vec<f32>,
    /// Label width estimate per node (CSS px)
    pub label_px: Vec<f32>,
}

/// Gap between a symbol and its label (CSS px).
const LABEL_GAP_PX: f32 = 5.0;
/// Neutral edge tint (surface toward the highlight color).
const EDGE_TINT: f32 = 0.32;
const RING_PX: f32 = 1.5;
/// Faded (not focused) marks mix this far toward the surface.
const FADE: f32 = 0.82;
/// Default symbol diameter (ECharts `symbolSize: 10`).
const DEFAULT_SIZE_PX: f32 = 10.0;
/// Force steps * nodes at most (large graphs run fewer steps).
const FORCE_WORK: usize = 1_500_000;
/// Force scale of the plane layout (see `force_layout`).
const FORCE_GAIN: f32 = 100.0;

/// Checks a graph before anything is replaced; returns the node count.
pub fn validate_graph(d: &GraphData, layout: GraphLayout) -> Result<usize, String> {
    let n = d.value.len();
    if n == 0 {
        return Err("graph needs at least one node".into());
    }
    if n > u32::MAX as usize / 2 {
        return Err(format!("graph has too many nodes ({n})"));
    }
    let per_node = |name: &str, len: usize| {
        if len != 0 && len != n {
            Err(format!(
                "{name}: expected {n} values (one per node), got {len}"
            ))
        } else {
            Ok(())
        }
    };
    per_node("x", d.x.len())?;
    per_node("y", d.y.len())?;
    per_node("category", d.category.len())?;
    per_node("size", d.size_px.len())?;
    per_node("fixed", d.fixed.len())?;
    per_node("label width", d.label_px.len())?;
    for (v, value) in d.value.iter().enumerate() {
        if value.is_infinite() {
            return Err(format!("node {v}: value is not finite"));
        }
    }
    let placed = matches!(layout, GraphLayout::None | GraphLayout::Cartesian);
    for v in 0..n {
        let x = d.x.get(v).copied().unwrap_or(f64::NAN);
        let y = d.y.get(v).copied().unwrap_or(f64::NAN);
        if x.is_infinite() || y.is_infinite() {
            return Err(format!("node {v}: x / y is not finite"));
        }
        if placed && !(x.is_finite() && y.is_finite()) {
            return Err(format!("node {v}: this layout needs x and y"));
        }
    }
    for (v, &c) in d.category.iter().enumerate() {
        if c >= 0 && c as u32 >= d.category_count {
            return Err(format!(
                "node {v}: category {c} out of range ({} categories)",
                d.category_count
            ));
        }
    }
    if d.sources.len() != d.targets.len() {
        return Err(format!(
            "edge sources and targets differ in length ({} vs {})",
            d.sources.len(),
            d.targets.len()
        ));
    }
    for (e, (&s, &t)) in d.sources.iter().zip(&d.targets).enumerate() {
        for v in [s, t] {
            if v as usize >= n {
                return Err(format!("edge {e}: node {v} out of range ({n} nodes)"));
            }
        }
    }
    let m = d.sources.len();
    if !d.edge_width.is_empty() && d.edge_width.len() != m {
        return Err(format!(
            "edge width: expected {m} values (one per edge), got {}",
            d.edge_width.len()
        ));
    }
    Ok(n)
}

/// Quadratic Bezier point.
fn quad(p: (f32, f32), c: (f32, f32), q: (f32, f32), t: f32) -> (f32, f32) {
    let u = 1.0 - t;
    (
        u * u * p.0 + 2.0 * u * t * c.0 + t * t * q.0,
        u * u * p.1 + 2.0 * u * t * c.1 + t * t * q.1,
    )
}

/// Extent of `vals` as a nice axis (given range ends win) and its ticks.
fn value_axis(vals: impl Iterator<Item = f64>, range: (f64, f64)) -> ((f64, f64), Vec<f64>) {
    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
    for v in vals.filter(|v| v.is_finite()) {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    if !lo.is_finite() {
        (lo, hi) = (0.0, 1.0);
    }
    let (nlo, nhi, step) = nice_domain(lo, hi, 5);
    let given = range.0.is_finite() || range.1.is_finite();
    let lo = if range.0.is_finite() { range.0 } else { nlo };
    let hi = if range.1.is_finite() { range.1 } else { nhi };
    let ((lo, hi), step) = if hi > lo {
        ((lo, hi), if given { nice_step(hi - lo, 5) } else { step })
    } else {
        ((nlo, nhi), step)
    };
    ((lo, hi), ticks_between(lo, hi, step))
}

#[derive(Debug, Clone)]
pub(crate) struct GraphChart {
    pub(crate) data: GraphData,
    opts: GraphOptions,
    style: HierarchyStyle,
    pub(crate) colors: Vec<[f32; 4]>,
    pub(crate) legend: Legend,
    pub(crate) cat_visible: Vec<bool>,
    emphasis: Option<usize>,
    /// Neighbours per node (CSR, both directions)
    adj_start: Vec<u32>,
    adj: Vec<u32>,
    /// Layout space positions (force / none: free units, cartesian: data values)
    pub(crate) raw: Vec<(f64, f64)>,
    /// Circular: angle per node (radians, clockwise from 3 o'clock)
    angle: Vec<f32>,
    /// Cartesian domains and ticks
    x_dom: (f64, f64),
    y_dom: (f64, f64),
    x_ticks: Vec<f64>,
    y_ticks: Vec<f64>,
    /// CSS position per node of the last frame
    pub(crate) pos: Vec<(f32, f32)>,
    center: (f32, f32),
    radius: f32,
    plot: [f32; 4],
    screen: Option<FlatScreen>,
    /// Bumped by legend toggles / emphasis
    state_rev: u32,
    layout_key: Option<([f32; 4], f32)>,
    labels_key: Option<([f32; 4], f32, u32)>,
    built: Option<(FlatScreen, u32, Option<u32>)>,
    outlined: Option<Option<u32>>,
    pub(crate) labels: Vec<HierarchyLabel>,
    pub(crate) labels_revision: u32,
}

impl GraphChart {
    pub(crate) fn new(data: GraphData, mut opts: GraphOptions, style: HierarchyStyle) -> Self {
        let d = GraphOptions::default();
        let fix =
            |v: f32, lo: f32, hi: f32, d: f32| if v.is_finite() { v.clamp(lo, hi) } else { d };
        opts.edge_width_px = fix(opts.edge_width_px, 0.25, 32.0, d.edge_width_px);
        opts.curveness = fix(opts.curveness, -1.0, 1.0, d.curveness);
        opts.arrow_px = fix(opts.arrow_px, 2.0, 64.0, d.arrow_px);
        opts.label_line_px = fix(opts.label_line_px, 1.0, 200.0, d.label_line_px);
        opts.repulsion = fix(opts.repulsion, 0.0, 1e5, d.repulsion);
        opts.edge_length = fix(opts.edge_length, 0.0, 1e4, d.edge_length);
        opts.gravity = fix(opts.gravity, 0.0, 100.0, d.gravity);
        opts.iterations = opts.iterations.min(5000);
        if opts.edge_opacity.is_finite() {
            opts.edge_opacity = opts.edge_opacity.clamp(0.0, 1.0);
        }
        let n = data.value.len();
        let ok = |s: u32, t: u32| s != t && (s as usize) < n && (t as usize) < n;
        // Neighbour lists
        let mut start = vec![0u32; n + 1];
        for (&s, &t) in data.sources.iter().zip(&data.targets) {
            if ok(s, t) {
                start[s as usize + 1] += 1;
                start[t as usize + 1] += 1;
            }
        }
        for v in 0..n {
            start[v + 1] += start[v];
        }
        let mut next = start.clone();
        let mut adj = vec![0u32; start[n] as usize];
        for (&s, &t) in data.sources.iter().zip(&data.targets) {
            if ok(s, t) {
                adj[next[s as usize] as usize] = t;
                next[s as usize] += 1;
                adj[next[t as usize] as usize] = s;
                next[t as usize] += 1;
            }
        }
        let at = |a: &[f64], v: usize| a.get(v).copied().filter(|x| x.is_finite());
        let given: Vec<(f64, f64)> = (0..n)
            .map(|v| match (at(&data.x, v), at(&data.y, v)) {
                (Some(x), Some(y)) => (x, y),
                _ => (f64::NAN, f64::NAN),
            })
            .collect();
        let raw: Vec<(f64, f64)> = match opts.layout {
            GraphLayout::Force => {
                let fixed: Vec<bool> = (0..n)
                    .map(|v| data.fixed.get(v).copied().unwrap_or(false))
                    .collect();
                force_layout(n, &data.sources, &data.targets, &given, &fixed, &opts)
                    .iter()
                    .map(|p| (p.x as f64, p.y as f64))
                    .collect()
            }
            GraphLayout::Circular => vec![(0.0, 0.0); n],
            GraphLayout::None | GraphLayout::Cartesian => given
                .iter()
                .map(|&(x, y)| if x.is_finite() { (x, y) } else { (0.0, 0.0) })
                .collect(),
        };
        // Circular: value-proportional slices, each node mid-slice (even when values are unusable)
        let mut angle = vec![0.0f32; n];
        if opts.layout == GraphLayout::Circular {
            let sum: f64 = data.value.iter().sum();
            let by_value = sum > 0.0 && sum.is_finite() && data.value.iter().all(|v| *v >= 0.0);
            let mut acc = 0.0f64;
            for (v, a) in angle.iter_mut().enumerate() {
                let share = if by_value {
                    data.value[v] / sum
                } else {
                    1.0 / n as f64
                };
                *a = ((acc + 0.5 * share) * std::f64::consts::TAU) as f32;
                acc += share;
            }
        }
        let (mut x_dom, mut y_dom) = ((0.0, 1.0), (0.0, 1.0));
        let (mut x_ticks, mut y_ticks) = (Vec::new(), Vec::new());
        if opts.layout == GraphLayout::Cartesian {
            if opts.x_categories > 0 {
                let k = opts.x_categories;
                x_dom = (-0.5, k as f64 - 0.5);
                x_ticks = (0..k).map(|i| i as f64).collect();
            } else {
                (x_dom, x_ticks) = value_axis(raw.iter().map(|p| p.0), opts.x_range);
            }
            (y_dom, y_ticks) = value_axis(raw.iter().map(|p| p.1), opts.y_range);
        }
        let mut g = Self {
            cat_visible: vec![true; data.category_count as usize],
            data,
            opts,
            style,
            colors: Vec::new(),
            legend: Vec::new(),
            emphasis: None,
            adj_start: start,
            adj,
            raw,
            angle,
            x_dom,
            y_dom,
            x_ticks,
            y_ticks,
            pos: vec![(f32::NAN, f32::NAN); n],
            center: (0.0, 0.0),
            radius: 0.0,
            plot: [0.0; 4],
            screen: None,
            state_rev: 0,
            layout_key: None,
            labels_key: None,
            built: None,
            outlined: None,
            labels: Vec::new(),
            labels_revision: 0,
        };
        g.assign_colors();
        g
    }

    fn category_color(&self, k: usize) -> [f32; 4] {
        let pal = &self.style.palette;
        if pal.is_empty() {
            self.style.other_color
        } else {
            pal[k % pal.len()]
        }
    }

    fn assign_colors(&mut self) {
        self.colors = (0..self.len())
            .map(|v| {
                self.style
                    .colors
                    .get(v)
                    .copied()
                    .flatten()
                    .unwrap_or_else(|| {
                        self.category_color(self.category(v).map_or(0, |c| c as usize))
                    })
            })
            .collect();
        self.legend = (0..self.cat_visible.len())
            .map(|k| (k as i64, self.category_color(k)))
            .collect();
    }

    pub(crate) fn len(&self) -> usize {
        self.data.value.len()
    }

    fn category(&self, v: usize) -> Option<u32> {
        let c = *self.data.category.get(v)?;
        (c >= 0 && (c as u32) < self.data.category_count).then_some(c as u32)
    }

    fn shown(&self, v: usize) -> bool {
        self.category(v)
            .is_none_or(|c| self.cat_visible[c as usize])
    }

    fn radius_of(&self, v: usize) -> f32 {
        let s = self
            .data
            .size_px
            .get(v)
            .copied()
            .filter(|s| s.is_finite() && *s >= 0.0)
            .unwrap_or(DEFAULT_SIZE_PX);
        0.5 * s.min(256.0)
    }

    fn label_px(&self, v: usize) -> f32 {
        self.data
            .label_px
            .get(v)
            .copied()
            .filter(|w| w.is_finite())
            .unwrap_or(0.0)
            .clamp(0.0, 400.0)
    }

    fn neighbours(&self, v: usize) -> &[u32] {
        &self.adj[self.adj_start[v] as usize..self.adj_start[v + 1] as usize]
    }

    pub(crate) fn set_style(&mut self, style: HierarchyStyle) {
        self.style = style;
        self.assign_colors();
        self.built = None;
        self.outlined = None;
    }

    pub(crate) fn series_count(&self) -> usize {
        self.cat_visible.len()
    }

    pub(crate) fn set_visible(&mut self, cat: usize, visible: bool) -> bool {
        match self.cat_visible.get_mut(cat) {
            Some(v) if *v != visible => {
                *v = visible;
                self.state_rev = self.state_rev.wrapping_add(1);
                true
            }
            _ => false,
        }
    }

    pub(crate) fn series_visible(&self, cat: usize) -> bool {
        self.cat_visible.get(cat).copied().unwrap_or(false)
    }

    pub(crate) fn set_emphasis(&mut self, cat: Option<usize>) -> bool {
        let cat = cat.filter(|&c| c < self.cat_visible.len());
        if self.emphasis == cat {
            return false;
        }
        self.emphasis = cat;
        self.state_rev = self.state_rev.wrapping_add(1);
        true
    }

    pub(crate) fn node_visible(&self, v: u32) -> bool {
        (v as usize) < self.len() && self.shown(v as usize)
    }

    /// Visible node nearest to CSS point `(x, y)` within its symbol (at least 8 px).
    pub(crate) fn node_at(&self, x: f32, y: f32) -> Option<u32> {
        let mut best = None;
        let mut best_d = f32::INFINITY;
        for v in 0..self.len() {
            if !self.shown(v) {
                continue;
            }
            let (px, py) = self.pos[v];
            let d = (px - x).hypot(py - y);
            let reach = (self.radius_of(v) + 4.0).max(8.0);
            if d <= reach && d <= best_d {
                best_d = d;
                best = Some(v as u32);
            }
        }
        best
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let screen = FlatScreen::of(view)?;
        let (x, y) = screen.css_at(view, ndc)?;
        let v = self.node_at(x, y)?;
        Some(hover_one(0, v, self.data.value[v as usize], v))
    }

    /// World position of a visible node.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let s = self.screen?;
        if !self.node_visible(global_id) {
            return None;
        }
        let (x, y) = self.pos[global_id as usize];
        if !x.is_finite() || !y.is_finite() {
            return None;
        }
        let (wx, wy) = s.world(x, y);
        Some((0, global_id, 0.0, Vec3::new(wx, wy, 0.0)))
    }

    pub(crate) fn layout_info(&self) -> HierarchyLayoutInfo {
        HierarchyLayoutInfo {
            root: 0,
            plot_css: self.plot,
            center_css: self.center,
            center_r_css: self.radius,
            hovered: None,
        }
    }

    fn cartesian(&self) -> bool {
        self.opts.layout == GraphLayout::Cartesian
    }

    fn map_x(&self, plot: [f32; 4], x: f64) -> f32 {
        let (a, b) = self.x_dom;
        plot[0] + ((x - a) / (b - a)) as f32 * plot[2]
    }

    fn map_y(&self, plot: [f32; 4], y: f64) -> f32 {
        let (a, b) = self.y_dom;
        plot[1] + plot[3] - ((y - a) / (b - a)) as f32 * plot[3]
    }

    /// Cartesian ticks (value axes; none for the other layouts).
    pub(crate) fn axes(&self, view: &ChartView, padding: &ChartPadding, out: &mut AxisLayout) {
        out.ticks.clear();
        let plot = padded_plot(css_of(view), padding);
        out.plot_css = plot;
        if !self.cartesian() {
            return;
        }
        for &v in &self.y_ticks {
            out.ticks.push(AxisTick {
                axis: 1,
                value: v,
                x_css: plot[0],
                y_css: self.map_y(plot, v),
                granularity: 0,
            });
        }
        for &v in &self.x_ticks {
            out.ticks.push(AxisTick {
                axis: 0,
                value: v,
                x_css: self.map_x(plot, v),
                y_css: plot[1] + plot[3],
                granularity: 0,
            });
        }
    }

    /// Cartesian gridlines (y ticks, numeric x ticks) and the baseline.
    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        let Some(screen) = self.screen.filter(|_| self.cartesian() && style.show_grid) else {
            return;
        };
        let [l, t, w, h] = self.plot;
        let mut line = |a: (f32, f32), b: (f32, f32), color: [f32; 4]| {
            let a = screen.world(a.0, a.1);
            let b = screen.world(b.0, b.1);
            out.push(ChartSegmentRaw {
                p0_width: [a.0, a.1, 0.0, style.stroke_px],
                p1_pad: [b.0, b.1, 0.0, 0.0],
                color,
            });
        };
        let edge = |v: f32, at: f32| (v - at).abs() < 0.5;
        for &v in &self.y_ticks {
            let y = self.map_y(self.plot, v);
            if !edge(y, t + h) {
                line((l, y), (l + w, y), style.grid_color);
            }
        }
        if self.opts.x_categories == 0 {
            for &v in &self.x_ticks {
                let x = self.map_x(self.plot, v);
                if !edge(x, l) {
                    line((x, t), (x, t + h), style.grid_color);
                }
            }
        }
        line((l, t + h), (l + w, t + h), style.baseline_color);
    }

    fn max_radius(&self) -> f32 {
        (0..self.len())
            .map(|v| self.radius_of(v))
            .fold(0.0f32, f32::max)
    }

    /// CSS positions of every node in `plot`.
    fn fit(&mut self, plot: [f32; 4]) {
        let n = self.len();
        let [l, t, w, h] = plot;
        let (cx, cy) = (l + 0.5 * w, t + 0.5 * h);
        self.center = (cx, cy);
        self.radius = 0.0;
        let max_r = self.max_radius();
        match self.opts.layout {
            GraphLayout::Cartesian => {
                for v in 0..n {
                    let (x, y) = self.raw[v];
                    self.pos[v] = (self.map_x(plot, x), self.map_y(plot, y));
                }
            }
            GraphLayout::Circular => {
                let half = 0.5 * w.min(h);
                let room = if self.opts.labels && self.opts.rotate_label {
                    let widest = (0..n).map(|v| self.label_px(v)).fold(0.0f32, f32::max);
                    widest.min(0.35 * half) + LABEL_GAP_PX
                } else {
                    0.0
                };
                let r = (half - max_r - 4.0 - room).max(0.3 * half).max(0.0);
                self.radius = r;
                for v in 0..n {
                    let a = self.angle[v];
                    self.pos[v] = (cx + r * a.cos(), cy + r * a.sin());
                }
            }
            GraphLayout::Force | GraphLayout::None => {
                let (mut x0, mut y0) = (f64::INFINITY, f64::INFINITY);
                let (mut x1, mut y1) = (f64::NEG_INFINITY, f64::NEG_INFINITY);
                for &(x, y) in &self.raw {
                    x0 = x0.min(x);
                    x1 = x1.max(x);
                    y0 = y0.min(y);
                    y1 = y1.max(y);
                }
                let m = (max_r + 4.0).min(0.25 * w.min(h));
                let (aw, ah) = ((w - 2.0 * m).max(0.0) as f64, (h - 2.0 * m).max(0.0) as f64);
                let (bw, bh) = (x1 - x0, y1 - y0);
                let sx = if bw > 1e-12 { aw / bw } else { f64::INFINITY };
                let sy = if bh > 1e-12 { ah / bh } else { f64::INFINITY };
                let s = sx.min(sy);
                let s = if s.is_finite() { s } else { 0.0 };
                let (bx, by) = (0.5 * (x0 + x1), 0.5 * (y0 + y1));
                for v in 0..n {
                    let (x, y) = self.raw[v];
                    self.pos[v] = (cx + ((x - bx) * s) as f32, cy + ((y - by) * s) as f32);
                }
            }
        }
    }

    fn edge_width(&self, e: usize) -> f32 {
        self.data
            .edge_width
            .get(e)
            .copied()
            .filter(|w| w.is_finite() && *w > 0.0)
            .unwrap_or(self.opts.edge_width_px)
            .clamp(0.25, 32.0)
    }

    fn edge_color(&self, s: usize, t: usize) -> [f32; 4] {
        let (mut c, def) = match self.opts.edge_color {
            GraphEdgeColor::Neutral => {
                let mut c = mix(self.style.surface, self.style.highlight, EDGE_TINT);
                c[3] = 1.0;
                (c, 1.0)
            }
            GraphEdgeColor::Source => (self.colors[s], 0.6),
            GraphEdgeColor::Target => (self.colors[t], 0.6),
        };
        c[3] *= if self.opts.edge_opacity.is_finite() {
            self.opts.edge_opacity
        } else {
            def
        };
        c
    }

    /// Edge polyline (CSS px; straight or a quadratic curve) and the arrow triangle at the
    /// target rim. `None`: self loop or coincident ends.
    #[allow(clippy::type_complexity)]
    fn edge_geometry(
        &self,
        e: usize,
        pts: &mut Vec<(f32, f32)>,
    ) -> Option<Option<[(f32, f32); 3]>> {
        pts.clear();
        let (s, t) = (self.data.sources[e] as usize, self.data.targets[e] as usize);
        let (p, q) = (self.pos[s], self.pos[t]);
        let len = (q.0 - p.0).hypot(q.1 - p.1);
        if s == t || len.is_nan() || len <= 1e-3 {
            return None;
        }
        let c = self.opts.curveness;
        let cp = (
            0.5 * (p.0 + q.0) - (p.1 - q.1) * c,
            0.5 * (p.1 + q.1) - (q.0 - p.0) * c,
        );
        let curved = c != 0.0;
        let at = |t: f32| {
            if curved {
                quad(p, cp, q, t)
            } else {
                (p.0 + (q.0 - p.0) * t, p.1 + (q.1 - p.1) * t)
            }
        };
        let mut arrow = None;
        let mut t_end = 1.0f32;
        if self.opts.arrow {
            let rt = self.radius_of(t);
            let alen = self.opts.arrow_px.max(2.0 * self.edge_width(e));
            let curve_len = if curved {
                (0..GRAPH_CURVE_SEGMENTS)
                    .map(|k| {
                        let a = at(k as f32 / GRAPH_CURVE_SEGMENTS as f32);
                        let b = at((k + 1) as f32 / GRAPH_CURVE_SEGMENTS as f32);
                        (b.0 - a.0).hypot(b.1 - a.1)
                    })
                    .sum::<f32>()
            } else {
                len
            };
            if rt + alen < curve_len {
                t_end = 1.0 - (rt + alen) / curve_len;
                let base = at(t_end);
                let (dx, dy) = (q.0 - base.0, q.1 - base.1);
                let d = dx.hypot(dy);
                if d > rt + 1e-3 {
                    let (ux, uy) = (dx / d, dy / d);
                    let tip = (q.0 - ux * rt, q.1 - uy * rt);
                    let hw = 0.45 * alen;
                    arrow = Some([
                        tip,
                        (base.0 - uy * hw, base.1 + ux * hw),
                        (base.0 + uy * hw, base.1 - ux * hw),
                    ]);
                } else {
                    t_end = 1.0;
                }
            }
        }
        if curved {
            pts.extend(
                (0..=GRAPH_CURVE_SEGMENTS)
                    .map(|k| at(t_end * k as f32 / GRAPH_CURVE_SEGMENTS as f32)),
            );
        } else {
            pts.extend([p, at(t_end)]);
        }
        Some(arrow)
    }

    /// Pushes a CSS polyline as segments (ends extended by half the width: closed joints).
    fn push_polyline(
        screen: &FlatScreen,
        pts: &[(f32, f32)],
        width: f32,
        color: [f32; 4],
        out: &mut Vec<ChartSegmentRaw>,
    ) {
        for w in pts.windows(2) {
            let (a, b) = (w[0], w[1]);
            let (dx, dy) = (b.0 - a.0, b.1 - a.1);
            let len = dx.hypot(dy);
            let (ex, ey) = if len > 1e-6 {
                (dx / len * 0.5 * width, dy / len * 0.5 * width)
            } else {
                (0.0, 0.0)
            };
            let a = screen.world(a.0 - ex, a.1 - ey);
            let b = screen.world(b.0 + ex, b.1 + ey);
            out.push(ChartSegmentRaw {
                p0_width: [a.0, a.1, 0.0, width],
                p1_pad: [b.0, b.1, 0.0, 0.0],
                color,
            });
        }
    }

    fn marker(&self, screen: &FlatScreen, v: usize, r: f32, faded: bool) -> ChartMarkerRaw {
        let mut fill = self.colors[v];
        if faded {
            fill = mix(fill, self.style.surface, FADE);
        }
        let (x, y) = screen.world(self.pos[v].0, self.pos[v].1);
        ChartMarkerRaw {
            center_radius: [x, y, 0.0, r],
            fill,
            ring: fill,
            params: [RING_PX, self.opts.symbol.min(3) as f32, 0.0, 0.0],
        }
    }

    /// Lit marks: the focused node and its neighbours, else the emphasized category, else all.
    fn lit_set(&self, focus: Option<u32>) -> Option<Vec<bool>> {
        let n = self.len();
        if let Some(f) = focus {
            let mut lit = vec![false; n];
            lit[f as usize] = true;
            for &u in self.neighbours(f as usize) {
                lit[u as usize] = true;
            }
            return Some(lit);
        }
        let k = self.emphasis? as u32;
        Some((0..n).map(|v| self.category(v) == Some(k)).collect())
    }

    /// Edges (series segments, arrows in the fills) and node symbols of the shown nodes.
    fn build(
        &self,
        screen: &FlatScreen,
        focus: Option<u32>,
        fills: &mut Vec<ChartFillRaw>,
        series: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        fills.clear();
        series.clear();
        markers.clear();
        let lit = self.lit_set(focus);
        let is_lit = |v: usize| lit.as_ref().is_none_or(|l| l[v]);
        let mut pts = Vec::with_capacity(GRAPH_CURVE_SEGMENTS + 1);
        for e in 0..self.data.sources.len() {
            let (s, t) = (self.data.sources[e] as usize, self.data.targets[e] as usize);
            if !self.shown(s) || !self.shown(t) {
                continue;
            }
            let Some(arrow) = self.edge_geometry(e, &mut pts) else {
                continue;
            };
            let on = match focus {
                Some(f) => s == f as usize || t == f as usize,
                None => is_lit(s) && is_lit(t),
            };
            let mut c = self.edge_color(s, t);
            if !on {
                c = mix(c, self.style.surface, FADE);
            }
            Self::push_polyline(screen, &pts, self.edge_width(e), c, series);
            for (x, y) in arrow.into_iter().flatten() {
                let (wx, wy) = screen.world(x, y);
                fills.push(ChartFillRaw {
                    position: [wx, wy, 0.0, 0.0],
                    color: c,
                });
            }
        }
        for v in 0..self.len() {
            if self.shown(v) {
                markers.push(self.marker(screen, v, self.radius_of(v), !is_lit(v)));
            }
        }
    }

    /// Hover overlay: the incident edges in the node color, the symbol enlarged.
    fn build_overlay(
        &self,
        screen: &FlatScreen,
        node: u32,
        overlay: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        let f = node as usize;
        let color = self.colors[f];
        let mut pts = Vec::with_capacity(GRAPH_CURVE_SEGMENTS + 1);
        for e in 0..self.data.sources.len() {
            let (s, t) = (self.data.sources[e] as usize, self.data.targets[e] as usize);
            if (s != f && t != f) || !self.shown(s) || !self.shown(t) {
                continue;
            }
            if self.edge_geometry(e, &mut pts).is_some() {
                Self::push_polyline(screen, &pts, self.edge_width(e) + 1.0, color, overlay);
            }
        }
        let r = self.radius_of(f).max(3.0) + 2.0;
        markers.push(self.marker(screen, f, r, false));
    }

    /// Label anchors: `(x, y)` = anchor, `w_css` = rotation (radians, clockwise), `h_css` = room
    /// for the text (CSS px), `flags` = 1 text starts at the anchor, -1 ends there.
    fn layout_labels(&mut self) -> bool {
        let mut labels = Vec::new();
        if self.opts.labels {
            let line = self.opts.label_line_px;
            let [l, _, w, _] = self.plot;
            let mut order: Vec<usize> = (0..self.len()).filter(|&v| self.shown(v)).collect();
            if self.opts.layout == GraphLayout::Circular && self.opts.rotate_label {
                // Radial text, thinned along the circle
                order.sort_by(|&a, &b| self.angle[a].total_cmp(&self.angle[b]));
                let half = 0.5 * self.plot[2].min(self.plot[3]);
                let mut last = f32::NEG_INFINITY;
                for v in order {
                    if labels.len() >= MAX_GRAPH_LABELS {
                        break;
                    }
                    let off = self.radius + self.radius_of(v) + LABEL_GAP_PX;
                    let a = self.angle[v];
                    if a - last < line / off.max(1.0) {
                        continue;
                    }
                    last = a;
                    let (dx, dy) = (a.cos(), a.sin());
                    let rot = dy.atan2(dx);
                    let (x_css, y_css) = (self.center.0 + dx * off, self.center.1 + dy * off);
                    let (w_css, flags) = if dx >= 0.0 {
                        (rot, 1)
                    } else if rot > 0.0 {
                        (rot - std::f32::consts::PI, -1)
                    } else {
                        (rot + std::f32::consts::PI, -1)
                    };
                    labels.push(HierarchyLabel {
                        node: v as u32,
                        x_css,
                        y_css,
                        w_css,
                        h_css: (half - off).max(24.0),
                        flags,
                    });
                }
            } else {
                // Right of the node, larger nodes first, overlapping ones dropped
                order.sort_by(|&a, &b| self.radius_of(b).total_cmp(&self.radius_of(a)));
                let cell = (4.0 * line).max(16.0);
                let mut grid: std::collections::HashMap<(i32, i32), Vec<[f32; 4]>> =
                    std::collections::HashMap::new();
                for v in order {
                    if labels.len() >= MAX_GRAPH_LABELS {
                        break;
                    }
                    let (x, y) = self.pos[v];
                    if !x.is_finite() || !y.is_finite() {
                        continue;
                    }
                    let ax = x + self.radius_of(v) + LABEL_GAP_PX;
                    let room = (l + w - ax).max(24.0);
                    let tw = self.label_px(v).min(room).max(8.0);
                    let rect = [ax, y - 0.5 * line, ax + tw, y + 0.5 * line];
                    let cols = (rect[0] / cell).floor() as i32..=(rect[2] / cell).floor() as i32;
                    let rows = (rect[1] / cell).floor() as i32..=(rect[3] / cell).floor() as i32;
                    let overlaps = |o: &[f32; 4]| {
                        rect[0] < o[2] && o[0] < rect[2] && rect[1] < o[3] && o[1] < rect[3]
                    };
                    let hit = cols.clone().any(|cx| {
                        rows.clone().any(|cy| {
                            grid.get(&(cx, cy))
                                .is_some_and(|rs| rs.iter().any(overlaps))
                        })
                    });
                    if hit {
                        continue;
                    }
                    for cx in cols {
                        for cy in rows.clone() {
                            grid.entry((cx, cy)).or_default().push(rect);
                        }
                    }
                    labels.push(HierarchyLabel {
                        node: v as u32,
                        x_css: ax,
                        y_css: y,
                        w_css: 0.0,
                        h_css: room,
                        flags: 1,
                    });
                }
            }
        }
        if labels != self.labels {
            self.labels = labels;
            self.labels_revision = self.labels_revision.wrapping_add(1);
            return true;
        }
        false
    }

    pub(crate) fn prepare(
        &mut self,
        view: &ChartView,
        padding: &ChartPadding,
        hovered: Option<(u32, u32)>,
        force: bool,
        overlay_dirty: bool,
        out: HierFrame,
    ) -> HierChanged {
        let mut changed = HierChanged::default();
        let Some(screen) = FlatScreen::of(view) else {
            return changed;
        };
        self.screen = Some(screen);
        let plot = padded_plot(css_of(view), padding);
        let key = (plot, screen.pixel_ratio);
        let relayout = self.layout_key != Some(key);
        if relayout {
            self.plot = plot;
            self.fit(plot);
            self.layout_key = Some(key);
            self.outlined = None;
        }
        let labels_key = (plot, screen.pixel_ratio, self.state_rev);
        if self.labels_key != Some(labels_key) {
            self.layout_labels();
            self.labels_key = Some(labels_key);
        }
        let focus = hovered
            .filter(|h| h.0 == 0 && self.node_visible(h.1))
            .map(|h| h.1);
        let build_key = (screen, self.state_rev, focus);
        if relayout || force || self.built != Some(build_key) {
            self.build(&screen, focus, out.fills, out.edges, out.markers);
            self.built = Some(build_key);
            self.outlined = None;
            changed.fills = true;
            changed.underlay = self.cartesian();
        }
        if overlay_dirty || self.outlined != Some(focus) {
            out.overlay.clear();
            out.overlay_markers.clear();
            if let Some(v) = focus {
                self.build_overlay(&screen, v, out.overlay, out.overlay_markers);
            }
            self.outlined = Some(focus);
            changed.overlay = true;
        }
        changed
    }
}

/// Force layout in the z = 0 plane (deterministic): the Barnes-Hut simulator of the 3D graph
/// with ECharts-like `repulsion` / `edgeLength` / `gravity`. `init`: start positions (NaN =
/// phyllotaxis spiral); `fixed` nodes with a start position stay there.
pub fn force_layout(
    n: usize,
    sources: &[u32],
    targets: &[u32],
    init: &[(f64, f64)],
    fixed: &[bool],
    opts: &GraphOptions,
) -> Vec<Vec3> {
    use crate::domain::{EdgeData, GraphDataset, NodeData};
    use crate::physics::{ForceConfig, ForceDirectedSimulator, LayoutSimulator};
    use crate::spatial::OctreeSpatialIndex;
    if n == 0 {
        return Vec::new();
    }
    let rest = (opts.edge_length.max(0.0) * 8.0 / 30.0).max(0.5);
    let golden = std::f32::consts::PI * (3.0 - 5f32.sqrt());
    let spiral = |i: usize| {
        let r = 0.5 * rest * (i as f32 + 0.5).sqrt();
        let a = i as f32 * golden;
        Vec3::new(r * a.cos(), r * a.sin(), 0.0)
    };
    let given = |i: usize| {
        init.get(i)
            .copied()
            .filter(|p| p.0.is_finite() && p.1.is_finite())
    };
    let pinned: Vec<bool> = (0..n)
        .map(|i| given(i).is_some() && fixed.get(i).copied().unwrap_or(false))
        .collect();
    let nodes: Vec<NodeData> = (0..n)
        .map(|i| {
            // Free nodes get a small spiral offset so coincident starts can separate
            let p = match given(i) {
                Some((x, y)) if pinned[i] => Vec3::new(x as f32, y as f32, 0.0),
                Some((x, y)) => Vec3::new(x as f32, y as f32, 0.0) + spiral(i) * 0.05,
                None => spiral(i),
            };
            let mut node = NodeData::new(i as u32, p, 0, 1.0, [1.0; 4]);
            node.set_pinned(pinned[i]);
            node
        })
        .collect();
    let edges: Vec<EdgeData> = sources
        .iter()
        .zip(targets)
        .filter(|(&s, &t)| s != t && (s as usize) < n && (t as usize) < n)
        .map(|(&s, &t)| EdgeData::new(s, t, 1.0))
        .collect();
    let Ok(mut ds) = GraphDataset::new(nodes, edges) else {
        return (0..n).map(spiral).collect();
    };
    // The 3D defaults scaled by a gain: the same equilibrium reached in a few hundred steps
    // instead of seconds of animation
    let d = ForceConfig::default();
    let cfg = ForceConfig {
        repulsion_strength: opts.repulsion.max(0.0) * 0.5 * FORCE_GAIN,
        spring_stiffness: d.spring_stiffness * FORCE_GAIN,
        spring_rest_length: rest,
        center_gravity: opts.gravity.max(0.0) * 0.3 * FORCE_GAIN,
        ..d
    };
    let mut sim = ForceDirectedSimulator::new(OctreeSpatialIndex::default(), cfg);
    sim.rebuild_spatial_index(&ds);
    let steps = (opts.iterations as usize).min((FORCE_WORK / n).max(30));
    for _ in 0..steps {
        sim.step(&mut ds, 0.05);
        // Coincident pairs repel along a 3D direction: keep the layout in the plane
        if ds.nodes().iter().any(|node| node.position().z != 0.0) {
            for node in ds.nodes_mut() {
                let (p, v) = (node.position(), node.velocity());
                node.set_position(Vec3::new(p.x, p.y, 0.0));
                node.set_velocity(Vec3::new(v.x, v.y, 0.0));
            }
            sim.rebuild_spatial_index(&ds);
        }
    }
    ds.nodes()
        .iter()
        .enumerate()
        .map(|(i, node)| {
            let p = node.position();
            match given(i) {
                Some((x, y)) if pinned[i] => Vec3::new(x as f32, y as f32, 0.0),
                _ if p.x.is_finite() && p.y.is_finite() => Vec3::new(p.x, p.y, 0.0),
                _ => spiral(i),
            }
        })
        .collect()
}

impl ChartState {
    /// Creates a 2D graph (see graph2d.rs) from validated data.
    pub fn new_graph(data: GraphData, opts: GraphOptions, style: HierarchyStyle) -> Self {
        Self::with_kind(ChartKind::Hierarchy(HierChart::Graph(GraphChart::new(
            data, opts, style,
        ))))
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

    fn data(n: usize, edges: &[(u32, u32)]) -> GraphData {
        GraphData {
            value: vec![1.0; n],
            sources: edges.iter().map(|e| e.0).collect(),
            targets: edges.iter().map(|e| e.1).collect(),
            label_px: vec![40.0; n],
            ..Default::default()
        }
    }

    fn graph(d: GraphData, opts: GraphOptions) -> (ChartState, OrbitCamera) {
        validate_graph(&d, opts.layout).unwrap();
        let mut chart = ChartState::new_graph(d, opts, HierarchyStyle::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.prepare_layers(&view(&cam));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &GraphChart {
        match &chart.kind {
            ChartKind::Hierarchy(HierChart::Graph(g)) => g,
            _ => unreachable!(),
        }
    }

    fn inside(p: (f32, f32), plot: [f32; 4]) -> bool {
        p.0 >= plot[0] - 0.5
            && p.0 <= plot[0] + plot[2] + 0.5
            && p.1 >= plot[1] - 0.5
            && p.1 <= plot[1] + plot[3] + 0.5
    }

    fn dist(a: (f32, f32), b: (f32, f32)) -> f32 {
        (a.0 - b.0).hypot(a.1 - b.1)
    }

    #[test]
    fn validation_rejects_bad_input_before_anything_is_replaced() {
        assert!(validate_graph(&data(0, &[]), GraphLayout::Force)
            .unwrap_err()
            .contains("node"));
        let e = validate_graph(&data(3, &[(0, 1), (0, 5)]), GraphLayout::Force).unwrap_err();
        assert!(e.contains("edge 1") && e.contains('5'), "{e}");
        let mut d = data(2, &[]);
        d.x = vec![1.0];
        assert!(validate_graph(&d, GraphLayout::Force)
            .unwrap_err()
            .contains("x"));
        let mut d = data(2, &[]);
        d.category = vec![0, 3];
        d.category_count = 2;
        assert!(validate_graph(&d, GraphLayout::Force)
            .unwrap_err()
            .contains("category"));
        let mut d = data(2, &[]);
        d.value[1] = f64::INFINITY;
        assert!(validate_graph(&d, GraphLayout::Force)
            .unwrap_err()
            .contains("node 1"));
        let mut d = data(2, &[(0, 1)]);
        d.targets.pop();
        assert!(validate_graph(&d, GraphLayout::Force).is_err());
        // Without a force / circular layout every node needs a position
        let mut d = data(2, &[]);
        d.x = vec![0.0, 1.0];
        d.y = vec![0.0, f64::NAN];
        assert!(validate_graph(&d, GraphLayout::None)
            .unwrap_err()
            .contains("node 1"));
        assert!(validate_graph(&data(2, &[]), GraphLayout::Cartesian).is_err());
        assert_eq!(
            validate_graph(&d, GraphLayout::Force),
            Ok(2),
            "force: missing positions start on a spiral"
        );
    }

    /// Two 5-cliques without an edge between them
    fn cliques() -> Vec<(u32, u32)> {
        let mut e = Vec::new();
        for base in [0u32, 5] {
            for a in 0..5 {
                for b in a + 1..5 {
                    e.push((base + a, base + b));
                }
            }
        }
        e
    }

    #[test]
    fn force_layout_stays_in_the_plane_and_pulls_connected_nodes_together() {
        let d = data(10, &cliques());
        let opts = GraphOptions::default();
        let p = force_layout(10, &d.sources, &d.targets, &[], &[], &opts);
        assert!(
            p.iter()
                .all(|v| v.z == 0.0 && v.x.is_finite() && v.y.is_finite()),
            "plane: {p:?}"
        );
        assert_eq!(
            p,
            force_layout(10, &d.sources, &d.targets, &[], &[], &opts),
            "deterministic"
        );
        let (mut intra, mut inter, mut ni, mut ne) = (0.0, 0.0, 0, 0);
        for a in 0..10 {
            for b in a + 1..10 {
                let d = (p[a] - p[b]).length();
                if (a < 5) == (b < 5) {
                    intra += d;
                    ni += 1;
                } else {
                    inter += d;
                    ne += 1;
                }
            }
        }
        assert!(
            intra / (ni as f32) < 0.6 * inter / (ne as f32),
            "clusters: {intra} / {inter}"
        );
        // Fixed nodes keep their given position
        let init = vec![(5.0, -3.0); 10];
        let mut fixed = vec![false; 10];
        fixed[0] = true;
        let q = force_layout(10, &d.sources, &d.targets, &init, &fixed, &opts);
        assert_eq!((q[0].x, q[0].y), (5.0, -3.0));

        // On screen: fitted inside the plot, no NaN
        let (c, _) = graph(d, opts);
        let g = inner(&c);
        assert!(
            g.pos.iter().all(|&p| inside(p, g.plot)),
            "{:?} in {:?}",
            g.pos,
            g.plot
        );
        assert_eq!(c.styled.markers.len(), 10);
        assert_eq!(c.series.len(), 20, "one straight segment per edge");
    }

    #[test]
    fn circular_layout_spaces_nodes_by_value_clockwise_from_three_o_clock() {
        let (c, _) = graph(
            data(6, &[(0, 3)]),
            GraphOptions {
                layout: GraphLayout::Circular,
                ..Default::default()
            },
        );
        let g = inner(&c);
        let center = (g.plot[0] + 0.5 * g.plot[2], g.plot[1] + 0.5 * g.plot[3]);
        let r = dist(g.pos[0], center);
        assert!(r > 100.0);
        for k in 0..6 {
            let p = g.pos[k];
            assert!((dist(p, center) - r).abs() < 0.5);
            let a = (p.1 - center.1)
                .atan2(p.0 - center.0)
                .rem_euclid(std::f32::consts::TAU);
            let want = (k as f32 + 0.5) * std::f32::consts::TAU / 6.0;
            assert!((a - want).abs() < 1e-3, "node {k}: {a} vs {want}");
        }
        // Values 1 and 3: slices of a quarter and three quarters, each node mid-slice
        let mut d = data(2, &[]);
        d.value = vec![1.0, 3.0];
        let (c, _) = graph(
            d,
            GraphOptions {
                layout: GraphLayout::Circular,
                ..Default::default()
            },
        );
        let g = inner(&c);
        let center = (g.plot[0] + 0.5 * g.plot[2], g.plot[1] + 0.5 * g.plot[3]);
        let ang = |p: (f32, f32)| {
            (p.1 - center.1)
                .atan2(p.0 - center.0)
                .rem_euclid(std::f32::consts::TAU)
        };
        assert!((ang(g.pos[0]) - std::f32::consts::FRAC_PI_4).abs() < 1e-3);
        assert!((ang(g.pos[1]) - 1.25 * std::f32::consts::PI).abs() < 1e-3);
    }

    #[test]
    fn rotated_circular_labels_run_outward_and_flip_on_the_left() {
        let opts = GraphOptions {
            layout: GraphLayout::Circular,
            rotate_label: true,
            ..Default::default()
        };
        let (c, _) = graph(data(4, &[]), opts);
        let g = inner(&c);
        assert_eq!(g.labels.len(), 4);
        let center = (g.plot[0] + 0.5 * g.plot[2], g.plot[1] + 0.5 * g.plot[3]);
        for l in &g.labels {
            let v = l.node as usize;
            let a = (g.pos[v].1 - center.1).atan2(g.pos[v].0 - center.0);
            assert!(
                dist((l.x_css, l.y_css), center) > dist(g.pos[v], center),
                "beyond the node"
            );
            if a.cos() >= 0.0 {
                assert_eq!(l.flags, 1);
                assert!((l.w_css - a).abs() < 1e-3);
            } else {
                assert_eq!(l.flags, -1, "left half ends at the anchor");
                assert!(
                    ((l.w_css - a).rem_euclid(std::f32::consts::TAU) - std::f32::consts::PI).abs()
                        < 1e-3
                );
            }
            assert!(l.h_css >= 24.0, "room for the text");
        }
        // Not rotated: right of the node, overlapping labels thinned (all nodes at one spot)
        let mut d = data(30, &[]);
        d.x = vec![1.0; 30];
        d.y = vec![1.0; 30];
        let (c, _) = graph(
            d,
            GraphOptions {
                layout: GraphLayout::None,
                ..Default::default()
            },
        );
        let g = inner(&c);
        assert_eq!(g.labels.len(), 1);
        assert_eq!(g.labels[0].flags, 1);
        assert!(
            g.labels[0].x_css > g.pos[0].0
                && g.pos.iter().all(|p| p.0.is_finite() && p.1.is_finite())
        );
    }

    #[test]
    fn none_layout_fits_given_positions_keeping_the_aspect_y_down() {
        let mut d = data(3, &[(0, 2)]);
        d.x = vec![0.0, 100.0, 50.0];
        d.y = vec![0.0, 0.0, 200.0];
        let (c, _) = graph(
            d,
            GraphOptions {
                layout: GraphLayout::None,
                ..Default::default()
            },
        );
        let g = inner(&c);
        let (a, b, e) = (g.pos[0], g.pos[1], g.pos[2]);
        assert!(e.1 > a.1, "y grows down");
        assert!(
            ((b.0 - a.0) / (e.1 - a.1) - 0.5).abs() < 1e-3,
            "aspect kept"
        );
        assert!((a.1 - b.1).abs() < 1e-3);
        assert!(g.pos.iter().all(|&p| inside(p, g.plot)));
    }

    #[test]
    fn cartesian_layout_maps_values_onto_nice_axes_with_gridlines() {
        let mut d = data(2, &[(0, 1)]);
        d.x = vec![0.0, 10.0];
        d.y = vec![0.0, 5.0];
        let (c, _) = graph(
            d,
            GraphOptions {
                layout: GraphLayout::Cartesian,
                ..Default::default()
            },
        );
        let g = inner(&c);
        let p = g.plot;
        assert!(
            dist(g.pos[0], (p[0], p[1] + p[3])) < 0.5,
            "origin bottom-left: {:?} {p:?}",
            g.pos[0]
        );
        assert!(dist(g.pos[1], (p[0] + p[2], p[1])) < 0.5, "top-right");
        let xs: Vec<f64> = c
            .axes
            .ticks
            .iter()
            .filter(|t| t.axis == 0)
            .map(|t| t.value)
            .collect();
        let ys: Vec<f64> = c
            .axes
            .ticks
            .iter()
            .filter(|t| t.axis == 1)
            .map(|t| t.value)
            .collect();
        assert_eq!(xs, vec![0.0, 2.0, 4.0, 6.0, 8.0, 10.0]);
        assert_eq!(ys, vec![0.0, 1.0, 2.0, 3.0, 4.0, 5.0]);
        let t = c
            .axes
            .ticks
            .iter()
            .find(|t| t.axis == 0 && t.value == 10.0)
            .unwrap();
        assert!((t.x_css - g.pos[1].0).abs() < 0.5 && (t.y_css - (p[1] + p[3])).abs() < 0.5);
        assert!(!c.underlay.is_empty(), "gridlines");
        // Category x: index bands centered
        let mut d = data(2, &[]);
        d.x = vec![0.0, 2.0];
        d.y = vec![1.0, 1.0];
        let (c, _) = graph(
            d,
            GraphOptions {
                layout: GraphLayout::Cartesian,
                x_categories: 3,
                y_range: (0.0, 2.0),
                ..Default::default()
            },
        );
        let g = inner(&c);
        let p = g.plot;
        assert!((g.pos[0].0 - (p[0] + p[2] / 6.0)).abs() < 0.5);
        assert!((g.pos[0].1 - (p[1] + p[3] * 0.5)).abs() < 0.5);
        let xs: Vec<f64> = c
            .axes
            .ticks
            .iter()
            .filter(|t| t.axis == 0)
            .map(|t| t.value)
            .collect();
        assert_eq!(xs, vec![0.0, 1.0, 2.0]);
    }

    fn categorized() -> GraphData {
        // 0, 1 in category 0; 2 in category 1; 3 uncategorized and isolated
        let mut d = data(4, &[(0, 1), (1, 2)]);
        d.category = vec![0, 0, 1, -1];
        d.category_count = 2;
        d
    }

    #[test]
    fn categories_color_nodes_and_the_legend_toggles_them_with_their_edges() {
        let (mut c, cam) = graph(categorized(), GraphOptions::default());
        assert_eq!(c.series_count(), 2);
        let g = inner(&c);
        assert_eq!(g.legend.len(), 2);
        let pal = HierarchyStyle::default().palette;
        assert_eq!(
            (g.colors[0], g.colors[1], g.colors[2], g.colors[3]),
            (pal[0], pal[0], pal[1], pal[0])
        );
        assert_eq!(g.legend[1], (1, pal[1]));
        assert_eq!(c.styled.markers.len(), 4);
        assert_eq!(c.series.len(), 2);

        let mut scene = SceneWorld::new();
        c.set_series_visible(1, false, &mut scene);
        assert!(!c.series_visible(1) && c.series_visible(0));
        c.prepare_layers(&view(&cam));
        assert_eq!(c.styled.markers.len(), 3, "category 1 hidden");
        assert_eq!(c.series.len(), 1, "its edge too");
        let g = inner(&c);
        let p = g.pos[2];
        assert!(g.node_at(p.0, p.1).is_none(), "hidden nodes are not hit");
        assert!(
            c.hover_hierarchy_item(&mut scene, 0, 2).is_none(),
            "nor focused"
        );
        c.set_series_visible(1, true, &mut scene);
        c.prepare_layers(&view(&cam));
        assert_eq!(c.styled.markers.len(), 4);

        // Legend hover fades the other categories
        c.set_emphasis(Some(1));
        c.prepare_layers(&view(&cam));
        let m = &c.styled.markers;
        assert_eq!(m[2].fill, pal[1]);
        assert_ne!(m[0].fill, pal[0], "faded");
    }

    #[test]
    fn hovering_a_node_fades_everything_but_its_adjacency() {
        let (mut c, cam) = graph(categorized(), GraphOptions::default());
        let mut scene = SceneWorld::new();
        let hit = c.hover_hierarchy_item(&mut scene, 0, 0).expect("item");
        assert_eq!(hit.items[0].index, 0);
        c.prepare_layers(&view(&cam));
        let g = inner(&c);
        let m = &c.styled.markers;
        assert_eq!(m[0].fill, g.colors[0]);
        assert_eq!(m[1].fill, g.colors[1], "neighbour stays");
        assert_ne!(m[2].fill, g.colors[2], "two hops away: faded");
        assert_ne!(m[3].fill, g.colors[3]);
        assert!(!c.overlay.is_empty(), "incident edge highlighted");
        assert_eq!(c.markers.len(), 1, "enlarged symbol");
        assert!(c.markers[0].center_radius[3] > m[0].center_radius[3]);

        // Pointer hover finds the node under it
        let p = g.pos[2];
        let screen = FlatScreen::of(&view(&cam)).unwrap();
        let (wx, wy) = screen.world(p.0 + 1.0, p.1 - 1.0);
        let ndc = cam.project_to_ndc(Vec3::new(wx, wy, 0.0)).unwrap();
        let hit = c
            .hover_at(&view(&cam), &mut scene, (ndc.x, ndc.y))
            .expect("hover");
        assert_eq!(hit.items[0].index, 2);
        assert!(inner(&c).node_at(-500.0, -500.0).is_none());
        let s = c.sample(2);
        assert!(s.is_some());
    }

    #[test]
    fn curved_edges_and_arrows_end_at_the_target_rim() {
        let mut d = data(2, &[(0, 1)]);
        d.x = vec![0.0, 100.0];
        d.y = vec![0.0, 0.0];
        d.size_px = vec![10.0, 20.0];
        let opts = GraphOptions {
            layout: GraphLayout::None,
            curveness: 0.3,
            arrow: true,
            ..Default::default()
        };
        let (c, cam) = graph(d, opts);
        assert_eq!(c.series.len(), GRAPH_CURVE_SEGMENTS);
        assert_eq!(c.fills.len(), 3, "one arrow triangle");
        let g = inner(&c);
        let screen = FlatScreen::of(&view(&cam)).unwrap();
        // The tip is the vertex nearest the target
        let tips: Vec<(f32, f32)> = c
            .fills
            .iter()
            .map(|f| screen.css(f.position[0], f.position[1]))
            .collect();
        let tip = tips
            .iter()
            .copied()
            .min_by(|a, b| dist(*a, g.pos[1]).total_cmp(&dist(*b, g.pos[1])))
            .unwrap();
        assert!(
            (dist(tip, g.pos[1]) - 10.0).abs() < 0.75,
            "tip on the rim: {}",
            dist(tip, g.pos[1])
        );
        // Curved: the middle bows off the straight line
        let mid = c.series[GRAPH_CURVE_SEGMENTS / 2].p0_width;
        let (_, my) = screen.css(mid[0], mid[1]);
        assert!((my - g.pos[0].1).abs() > 5.0);
    }

    #[test]
    fn degenerate_graphs_stay_finite_and_export_to_svg() {
        let (c, cam) = graph(data(1, &[]), GraphOptions::default());
        let g = inner(&c);
        assert!(inside(g.pos[0], g.plot));
        let svg = c.export_svg(&view(&cam), 0, "graph");
        assert_eq!(svg.support, SvgSupport::Vector);
        assert!(svg.markup.contains("<circle"), "node symbols");
        // Self loops and duplicate positions never produce NaN
        let mut d = data(3, &[(0, 0), (0, 1)]);
        d.x = vec![2.0; 3];
        d.y = vec![2.0; 3];
        let (c, _) = graph(
            d,
            GraphOptions {
                layout: GraphLayout::Force,
                ..Default::default()
            },
        );
        assert!(c
            .styled
            .markers
            .iter()
            .all(|m| m.center_radius.iter().all(|v| v.is_finite())));
        assert!(c.series.iter().all(|s| s
            .p0_width
            .iter()
            .chain(s.p1_pad.iter())
            .all(|v| v.is_finite())));
    }

    #[test]
    fn enter_animation_frames_stay_finite() {
        let (mut c, cam) = graph(
            categorized(),
            GraphOptions {
                curveness: 0.2,
                arrow: true,
                ..Default::default()
            },
        );
        c.set_animation(AnimationOptions::new(300.0, Easing::Linear));
        c.arm_animation(AnimationOptions::new(300.0, Easing::Linear), None);
        c.animation_tick(0.0);
        c.prepare_layers(&view(&cam));
        c.animation_tick(150.0);
        c.prepare_layers(&view(&cam));
        let markers = c.anim_series_style().markers;
        assert!(!markers.is_empty());
        assert!(markers.iter().all(|m| m
            .center_radius
            .iter()
            .chain(m.fill.iter())
            .all(|v| v.is_finite())));
        assert!(c.anim_series().iter().all(|s| s
            .p0_width
            .iter()
            .chain(s.p1_pad.iter())
            .all(|v| v.is_finite())));
    }
}
