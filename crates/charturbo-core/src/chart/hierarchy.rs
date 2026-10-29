//! Hierarchy and flow charts (treemap, sunburst, sankey): shared tree model, colors and the
//! `ChartState` glue. Layout, tessellation, hit-testing and label anchors live in Rust
//! (treemap.rs, sunburst.rs, sankey.rs); the DOM only places text at the exported anchors.
//!
//! Trees come in as a parent index per node (`-1` = root; several roots get a virtual root
//! appended at index `n`). Leaf values must be finite and >= 0 (NaN = 0); a parent's value is
//! the sum of its children (its own input value is ignored). Children are sorted by value,
//! largest first (ties keep input order), which squarify and the sunburst partition both want.
//! Cycles are rejected with the node chain in the message.

use super::*;
use super::sankey::SankeyChart;
use super::sunburst::SunburstChart;
use super::treemap::TreemapChart;
use super::tidy_tree::{TidyTreeChart, TidyTreeOptions};
pub(crate) use crate::renderer::{fill_emphasis_tag, merge_ranges, with_lit, ChartFillStyleRaw, FILL_EMPH_ALPHA, FILL_EMPH_FADE};

/// Parent of the root.
pub const NO_PARENT: u32 = u32::MAX;
/// Emphasis (legend hover): other groups mix this far toward the surface.
pub(crate) const EMPHASIS_FADE: f32 = 0.6;

/// Validated, aggregated tree (see the module docs).
#[derive(Debug, Clone)]
pub struct Tree {
    /// Parent per node (`NO_PARENT` for the root); a virtual root is the last node
    pub parent: Vec<u32>,
    /// Aggregated value (leaf input value, or the sum of the children)
    pub value: Vec<f64>,
    /// Depth from the root (root = 0)
    pub depth: Vec<u32>,
    /// Longest path down to a leaf (leaf = 0)
    pub height: Vec<u32>,
    child_start: Vec<u32>,
    /// Children of node `i` at `child_start[i]..child_start[i + 1]`, largest value first
    children: Vec<u32>,
    pub root: u32,
    /// Several input roots: node `n` (the last) is a synthetic root above them
    pub virtual_root: bool,
    /// Rank of the depth-1 ancestor among the root's children (`NO_PARENT` for the root)
    pub group: Vec<u32>,
}

impl Tree {
    /// Builds the tree from one parent index per node (`-1` = root) and leaf values.
    pub fn build(parents: &[i32], values: &[f64]) -> Result<Tree, String> {
        let n = parents.len();
        if values.len() != n {
            return Err(format!("hierarchy has {n} parents but {} values", values.len()));
        }
        if n == 0 {
            return Err("hierarchy is empty".into());
        }
        if n >= u32::MAX as usize - 1 {
            return Err("hierarchy is too large".into());
        }
        for (i, &p) in parents.iter().enumerate() {
            if p < -1 || p as i64 >= n as i64 {
                return Err(format!("node {i} has parent {p} (must be -1 or a node index below {n})"));
            }
            if p as i64 == i as i64 {
                return Err(format!("hierarchy has a cycle: node {i} -> node {i}"));
            }
        }
        let roots: Vec<usize> = (0..n).filter(|&i| parents[i] < 0).collect();
        if roots.is_empty() {
            return Err(cycle_message(parents, 0));
        }
        let virtual_root = roots.len() > 1;
        let m = n + virtual_root as usize;
        let root = if virtual_root { n } else { roots[0] };
        let mut parent: Vec<u32> = parents.iter().map(|&p| if p < 0 { root as u32 } else { p as u32 }).collect();
        if virtual_root {
            parent.push(NO_PARENT);
        } else {
            parent[root] = NO_PARENT;
        }

        // Children in CSR form (input order first, sorted by value below)
        let mut count = vec![0u32; m + 1];
        for &p in &parent {
            if p != NO_PARENT {
                count[p as usize] += 1;
            }
        }
        let mut child_start = vec![0u32; m + 1];
        for i in 0..m {
            child_start[i + 1] = child_start[i] + count[i];
        }
        let mut fill = child_start.clone();
        let mut children = vec![0u32; m - 1];
        for (i, &p) in parent.iter().enumerate() {
            if p != NO_PARENT {
                children[fill[p as usize] as usize] = i as u32;
                fill[p as usize] += 1;
            }
        }

        // Breadth-first order from the root: depth, and every node reached (else a cycle)
        let mut order = Vec::with_capacity(m);
        let mut depth = vec![0u32; m];
        order.push(root as u32);
        let mut head = 0;
        while head < order.len() {
            let v = order[head] as usize;
            head += 1;
            for &c in &children[child_start[v] as usize..child_start[v + 1] as usize] {
                depth[c as usize] = depth[v] + 1;
                order.push(c);
            }
        }
        if order.len() < m {
            let mut seen = vec![false; m];
            for &v in &order {
                seen[v as usize] = true;
            }
            let start = (0..n).find(|&i| !seen[i]).unwrap_or(0);
            return Err(cycle_message(parents, start));
        }

        // Leaf values, then sums bottom-up (reverse breadth-first order)
        let mut value = vec![0.0f64; m];
        for i in 0..n {
            if count[i] == 0 {
                let v = values[i];
                if v.is_nan() {
                    continue;
                }
                if !v.is_finite() || v < 0.0 {
                    return Err(format!("node {i} value is {v} (leaf values must be finite and >= 0)"));
                }
                value[i] = v;
            }
        }
        let mut height = vec![0u32; m];
        for &v in order.iter().rev() {
            let p = parent[v as usize];
            if p != NO_PARENT {
                value[p as usize] += value[v as usize];
                height[p as usize] = height[p as usize].max(height[v as usize] + 1);
            }
        }
        for v in 0..m {
            let (a, b) = (child_start[v] as usize, child_start[v + 1] as usize);
            children[a..b].sort_by(|x, y| value[*y as usize].total_cmp(&value[*x as usize]).then(x.cmp(y)));
        }
        let mut group = vec![NO_PARENT; m];
        for (k, &c) in children[child_start[root] as usize..child_start[root + 1] as usize].iter().enumerate() {
            group[c as usize] = k as u32;
        }
        for &v in &order {
            let p = parent[v as usize];
            if p != NO_PARENT && p as usize != root {
                group[v as usize] = group[p as usize];
            }
        }
        Ok(Tree { parent, value, depth, height, child_start, children, root: root as u32, virtual_root, group })
    }

    pub fn len(&self) -> usize {
        self.parent.len()
    }

    pub fn is_empty(&self) -> bool {
        self.parent.is_empty()
    }

    /// Children of `v`, largest value first.
    pub fn children(&self, v: u32) -> &[u32] {
        let v = v as usize;
        &self.children[self.child_start[v] as usize..self.child_start[v + 1] as usize]
    }

    /// Children with a positive value (they come first: children are sorted by value).
    pub fn shown_children(&self, v: u32) -> &[u32] {
        let c = self.children(v);
        let k = c.partition_point(|&x| self.value[x as usize] > 0.0);
        &c[..k]
    }

    /// True when `a` is `b` or one of its ancestors.
    pub fn is_ancestor(&self, a: u32, mut b: u32) -> bool {
        loop {
            if a == b {
                return true;
            }
            let p = self.parent[b as usize];
            if p == NO_PARENT {
                return false;
            }
            b = p;
        }
    }

    /// Ancestor of `v` that is a child of `top` (`None` when `v` is `top` or outside its subtree).
    pub fn child_toward(&self, top: u32, mut v: u32) -> Option<u32> {
        loop {
            let p = self.parent[v as usize];
            if p == NO_PARENT {
                return None;
            }
            if p == top {
                return Some(v);
            }
            v = p;
        }
    }
}

/// Error text naming the cycle reached by following parents from `start`.
fn cycle_message(parents: &[i32], start: usize) -> String {
    let mut seen = vec![usize::MAX; parents.len()];
    let mut chain = Vec::new();
    let mut v = start;
    while seen[v] == usize::MAX {
        seen[v] = chain.len();
        chain.push(v);
        let p = parents[v];
        if p < 0 {
            return "hierarchy has a cycle".into();
        }
        v = p as usize;
    }
    let mut cyc: Vec<String> = chain[seen[v]..].iter().map(|i| format!("node {i}")).collect();
    cyc.push(format!("node {v}"));
    format!("hierarchy has a cycle: {}", cyc.join(" -> "))
}

/// How hierarchy cells are colored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum HierarchyColorBy {
    /// Top-level group when there are at most as many groups as palette colors, else value
    #[default]
    Auto,
    /// Categorical palette by top-level group in fixed order; groups beyond the palette fold into
    /// the neutral "Other" color (the largest groups keep their own color)
    Group,
    /// Sequential colormap of the value, normalized per depth
    Value,
}

impl HierarchyColorBy {
    /// 0 = auto, 1 = group, 2 = value
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Group,
            2 => Self::Value,
            _ => Self::Auto,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct HierarchyStyle {
    /// Categorical palette in fixed order (group / node `k` gets `palette[k]`)
    pub palette: Vec<[f32; 4]>,
    /// Per input node color override (`None` = automatic)
    pub colors: Vec<Option<[f32; 4]>>,
    /// Folded groups ("Other") and value-mode parents
    pub other_color: [f32; 4],
    /// Chart surface (fades, headers and emphasis mix toward it)
    pub surface: [f32; 4],
    /// Hover outline (treemap) and center disk tint (sunburst)
    pub highlight: [f32; 4],
    /// Sequential colormap of the value mode
    pub colormap: HeatmapColormap,
}

impl Default for HierarchyStyle {
    fn default() -> Self {
        let pie = PieStyle::default();
        Self {
            palette: pie.palette,
            colors: Vec::new(),
            other_color: pie.other_color,
            surface: CHART_SURFACE,
            highlight: [0.93, 0.93, 0.91, 1.0],
            colormap: HeatmapColormap::default(),
        }
    }
}

pub(crate) fn mix(c: [f32; 4], to: [f32; 4], t: f32) -> [f32; 4] {
    [c[0] + (to[0] - c[0]) * t, c[1] + (to[1] - c[1]) * t, c[2] + (to[2] - c[2]) * t, c[3]]
}

/// Legend entries `(group node or -1 = Other, color)`.
pub(crate) type Legend = Vec<(i64, [f32; 4])>;

/// Base colors of a tree and its legend: `(color per node, [(group node or -1 = Other, color)])`.
/// Group mode: top-level groups take the palette in fixed (value) order; with more groups than
/// colors the last palette slot becomes the neutral "Other". Deeper nodes keep their group hue,
/// stepping `depth_step` toward the surface per level below 1 (at most 3 steps). Value mode: a
/// sequential colormap of each node's value within its depth. Overrides win in both.
pub(crate) fn tree_colors(tree: &Tree, style: &HierarchyStyle, by: HierarchyColorBy, depth_step: f32) -> (Vec<[f32; 4]>, Legend) {
    let groups = tree.children(tree.root);
    let pal = &style.palette;
    let by = match by {
        HierarchyColorBy::Auto if groups.len() > pal.len().max(1) => HierarchyColorBy::Value,
        HierarchyColorBy::Auto => HierarchyColorBy::Group,
        b => b,
    };
    let gray = style.other_color;
    let mut colors = vec![gray; tree.len()];
    let mut legend = Vec::new();
    if by == HierarchyColorBy::Group {
        let folded = groups.len() > pal.len();
        let kept = if folded { pal.len().saturating_sub(1) } else { groups.len() };
        let group_color = |g: u32| if (g as usize) < kept { pal[g as usize] } else { gray };
        for (k, &g) in groups.iter().enumerate().take(kept) {
            legend.push((g as i64, style.colors.get(g as usize).copied().flatten().unwrap_or(pal[k])));
        }
        if folded {
            legend.push((-1, gray));
        }
        for (v, slot) in colors.iter_mut().enumerate() {
            let g = tree.group[v];
            if g == NO_PARENT {
                continue;
            }
            let steps = tree.depth[v].saturating_sub(1).min(3) as f32;
            *slot = mix(group_color(g), style.surface, depth_step * steps);
        }
    } else {
        let lut = colormap_lut(&style.colormap);
        let max_depth = tree.depth.iter().copied().max().unwrap_or(0) as usize;
        let mut range = vec![(f64::INFINITY, f64::NEG_INFINITY); max_depth + 1];
        for v in 0..tree.len() {
            let r = &mut range[tree.depth[v] as usize];
            r.0 = r.0.min(tree.value[v]);
            r.1 = r.1.max(tree.value[v]);
        }
        let last = (lut.len().max(1) - 1) as f64;
        for v in 0..tree.len() {
            let (lo, hi) = range[tree.depth[v] as usize];
            // The lowest fifth of the ramp is left out: on dark surfaces it recedes into the
            // surface, and every cell must stay visible
            let t = if hi > lo { (tree.value[v] - lo) / (hi - lo) } else { 1.0 };
            let t = 0.2 + 0.8 * t;
            let c = lut.get((t.clamp(0.0, 1.0) * last).round() as usize).copied().unwrap_or([128, 128, 128, 255]);
            colors[v] = [c[0] as f32 / 255.0, c[1] as f32 / 255.0, c[2] as f32 / 255.0, 1.0];
        }
    }
    for (v, c) in style.colors.iter().enumerate() {
        if let (Some(c), Some(slot)) = (c, colors.get_mut(v)) {
            *slot = *c;
        }
    }
    (colors, legend)
}

/// DOM label anchor (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HierarchyLabel {
    /// Node (sankey: node index)
    pub node: u32,
    /// Treemap: text box top-left; sunburst: text center; sankey: text anchor on the node side
    pub x_css: f32,
    pub y_css: f32,
    /// Room for the text (CSS px): treemap box / sunburst max width and height (sankey: 0)
    pub w_css: f32,
    pub h_css: f32,
    /// Treemap: 0 = cell, 1 = header, +2 = room for a value line. Sunburst: 0. Sankey: side
    /// (1 = text grows right, -1 = left)
    pub flags: i32,
}

/// Screen state of a hierarchy chart for DOM overlays.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HierarchyLayoutInfo {
    /// Treemap / sunburst: current (drilled) root node
    pub root: u32,
    /// Plot rectangle `[left, top, width, height]` (CSS px)
    pub plot_css: [f32; 4],
    /// Sunburst: center and center-disk radius (CSS px); zero otherwise
    pub center_css: (f32, f32),
    pub center_r_css: f32,
    /// Hovered item `(series, index)`: series 0 = node, 1 = sankey link
    pub hovered: Option<(u32, u32)>,
}

/// World <-> CSS mapping of the last frame (flat camera).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct FlatScreen {
    /// CSS position of the world origin
    pub origin_css: (f32, f32),
    /// World units per CSS px
    pub wpp: f32,
    /// Device px per CSS px
    pub pixel_ratio: f32,
}

impl FlatScreen {
    pub(crate) fn of(view: &ChartView) -> Option<Self> {
        let c = view.project_css(Vec3::ZERO)?;
        let e = view.project_css(Vec3::new(1.0, 0.0, 0.0))?;
        let px = (e.0 - c.0).hypot(e.1 - c.1);
        (px > 1e-6).then_some(Self { origin_css: c, wpp: 1.0 / px, pixel_ratio: view.pixel_ratio.max(0.1) })
    }

    pub(crate) fn world(&self, x: f32, y: f32) -> (f32, f32) {
        ((x - self.origin_css.0) * self.wpp, (self.origin_css.1 - y) * self.wpp)
    }

    pub(crate) fn css(&self, wx: f32, wy: f32) -> (f32, f32) {
        (self.origin_css.0 + wx / self.wpp, self.origin_css.1 - wy / self.wpp)
    }

    /// Snaps a CSS coordinate to the device pixel grid (crisp, gap-exact edges).
    pub(crate) fn snap(&self, v: f32) -> f32 {
        (v * self.pixel_ratio).round() / self.pixel_ratio
    }

    /// CSS point of an NDC pointer on the chart plane.
    pub(crate) fn css_at(&self, view: &ChartView, ndc: (f32, f32)) -> Option<(f32, f32)> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let p = ray_hit_z_plane(&ray, 0.0)?;
        Some(self.css(p.x, p.y))
    }
}

/// Padded plot rectangle `[left, top, width, height]` in CSS px (same rule as `frame_flat`).
pub(crate) fn padded_plot(css: (f32, f32), padding: &ChartPadding) -> [f32; 4] {
    let [top, right, bottom, left] = *padding;
    let w = (css.0 - left - right).max(css.0 * 0.2);
    let h = (css.1 - top - bottom).max(css.1 * 0.2);
    [left, top, w, h]
}

/// Frames a flat chart laid out in CSS px: one world unit = one CSS px, plot centered.
pub(crate) fn frame_css_plot(camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
    let [_, _, w, h] = padded_plot(css, padding);
    frame_flat(camera, css, w, h, padding);
}

/// Pushes the two triangles of an axis-aligned CSS rect (world coordinates via `screen`).
pub(crate) fn push_rect(screen: &FlatScreen, r: [f32; 4], color: [f32; 4], fills: &mut Vec<ChartFillRaw>) {
    let (x0, y0) = screen.world(r[0], r[1]);
    let (x1, y1) = screen.world(r[0] + r[2], r[1] + r[3]);
    let v = |x: f32, y: f32| ChartFillRaw { position: [x, y, 0.0, 0.0], color };
    fills.extend([v(x0, y0), v(x0, y1), v(x1, y1), v(x0, y0), v(x1, y1), v(x1, y0)]);
}

/// Outline of a CSS rect as 4 segments `width_px` wide, drawn just inside it.
pub(crate) fn push_outline(screen: &FlatScreen, r: [f32; 4], width_px: f32, color: [f32; 4], out: &mut Vec<ChartSegmentRaw>) {
    let h = 0.5 * width_px;
    let (l, t, rr, b) = (r[0] + h, r[1] + h, r[0] + r[2] - h, r[1] + r[3] - h);
    if rr <= l || b <= t {
        return;
    }
    let p = |x: f32, y: f32| screen.world(x, y);
    for (a, c) in [((l - h, t), (rr + h, t)), ((rr, t), (rr, b)), ((rr + h, b), (l - h, b)), ((l, b), (l, t))] {
        let (a, c) = (p(a.0, a.1), p(c.0, c.1));
        out.push(ChartSegmentRaw { p0_width: [a.0, a.1, 0.0, width_px], p1_pad: [c.0, c.1, 0.0, 0.0], color });
    }
}

/// The three hierarchy / flow chart kinds behind `ChartKind::Hierarchy`.
#[derive(Debug, Clone)]
pub(crate) enum HierChart {
    Treemap(TreemapChart),
    Sunburst(SunburstChart),
    Sankey(SankeyChart),
    Tree(TidyTreeChart),
}

impl HierChart {
    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        match self {
            HierChart::Treemap(_) | HierChart::Sankey(_) | HierChart::Tree(_) => frame_css_plot(camera, css, padding),
            HierChart::Sunburst(s) => s.frame_camera(camera, css, padding),
        }
    }

    /// Legend entries (top-level color groups; sankey: none).
    pub(crate) fn series_count(&self) -> usize {
        match self {
            HierChart::Treemap(t) => t.legend.len(),
            HierChart::Sunburst(s) => s.legend.len(),
            HierChart::Sankey(_) | HierChart::Tree(_) => 0,
        }
    }

    pub(crate) fn point_count(&self) -> usize {
        match self {
            HierChart::Treemap(t) => t.tree.len(),
            HierChart::Sunburst(s) => s.tree.len(),
            HierChart::Sankey(s) => s.node_count() + s.link_count(),
            HierChart::Tree(t) => t.tree.len(),
        }
    }

    /// Legend hover: fades every group but `series` (legend entry). Returns true when fills
    /// must be rebuilt (treemap: never, the emphasis uniform follows in `prepare`).
    pub(crate) fn set_emphasis(&mut self, series: Option<usize>) -> bool {
        match self {
            HierChart::Treemap(t) => {
                t.set_emphasis(series);
                false
            }
            HierChart::Sunburst(s) => s.set_emphasis(series),
            HierChart::Sankey(_) | HierChart::Tree(_) => false,
        }
    }

    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        match self {
            HierChart::Treemap(t) => t.sample(global_id),
            HierChart::Sunburst(s) => s.sample(global_id),
            HierChart::Sankey(s) => s.sample(global_id),
            HierChart::Tree(t) => t.sample(global_id),
        }
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        match self {
            HierChart::Treemap(t) => t.hover(view, ndc),
            HierChart::Sunburst(s) => s.hover(view, ndc),
            HierChart::Sankey(s) => s.hover(view, ndc),
            HierChart::Tree(t) => t.hover(view, ndc),
        }
    }

    /// Hover result of item `(series, index)` without a pointer (keyboard focus).
    pub(crate) fn item(&self, series: u32, index: u32) -> Option<HoverResult> {
        let (value, global_id) = match self {
            HierChart::Treemap(t) if series == 0 => (*t.tree.value.get(index as usize)?, index),
            HierChart::Sunburst(s) if series == 0 => (*s.tree.value.get(index as usize)?, index),
            HierChart::Sankey(s) => s.item_value(series, index)?,
            HierChart::Tree(t) if series == 0 && t.is_visible(index) => (*t.tree.value.get(index as usize)?, index),
            _ => return None,
        };
        Some(hover_one(series, index, value, global_id))
    }

    pub(crate) fn axes(&self, view: &ChartView, padding: &ChartPadding, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = match self {
            HierChart::Sunburst(s) => s.plot_css(view),
            _ => padded_plot(css_of(view), padding),
        };
    }
}

pub(crate) fn hover_one(series: u32, index: u32, value: f64, global_id: u32) -> HoverResult {
    HoverResult { is_bar: false, primary: 0, items: vec![HoverItem { series, index, value: value as f32, global_id }] }
}

/// Canvas size in CSS px.
pub(crate) fn css_of(view: &ChartView) -> (f32, f32) {
    let pr = view.pixel_ratio.max(0.1);
    (view.viewport_px.0 as f32 / pr, view.viewport_px.1 as f32 / pr)
}

impl ChartState {
    /// Creates a treemap (see treemap.rs) from a validated tree.
    pub fn new_treemap(tree: Tree, opts: TreemapOptions, style: HierarchyStyle) -> Self {
        Self::with_kind(ChartKind::Hierarchy(HierChart::Treemap(TreemapChart::new(tree, opts, style))))
    }

    /// Creates a sunburst (see sunburst.rs) from a validated tree.
    pub fn new_sunburst(tree: Tree, opts: SunburstOptions, style: HierarchyStyle) -> Self {
        Self::with_kind(ChartKind::Hierarchy(HierChart::Sunburst(SunburstChart::new(tree, opts, style))))
    }

    /// Creates a sankey diagram (see sankey.rs) from validated flows.
    pub fn new_sankey(graph: SankeyGraph, opts: SankeyOptions, style: HierarchyStyle) -> Self {
        Self::with_kind(ChartKind::Hierarchy(HierChart::Sankey(SankeyChart::new(graph, opts, style))))
    }

    /// Creates a tidy tree (see tidy_tree.rs) from a validated tree (children in input order:
    /// build it with zero values). `state` per node: 0 = by `initial_depth`, 1 = expanded,
    /// 2 = collapsed; `label_px` = estimated label width per node (CSS px).
    pub fn new_tidy_tree(tree: Tree, opts: TidyTreeOptions, state: &[u8], label_px: &[f32], style: HierarchyStyle) -> Self {
        Self::with_kind(ChartKind::Hierarchy(HierChart::Tree(TidyTreeChart::new(tree, opts, state, label_px, style))))
    }

    /// Expands / collapses a tidy tree node (parents only; animated with animations on).
    /// Returns false when unchanged, hidden (a collapsed ancestor) or not a tree chart.
    pub fn set_tree_node_expanded(&mut self, node: u32, expanded: bool) -> bool {
        let ChartKind::Hierarchy(HierChart::Tree(t)) = &self.kind else {
            return false;
        };
        if !t.has_children(node) || !t.is_visible(node) || t.expanded[node as usize] == expanded {
            return false;
        }
        // Tween from the frame on screen: land a running one first, stage the old layout with
        // the old + new nodes drawn, snapshot it, then switch (the next frame builds the target)
        self.finish_animation();
        let animate = self.animation().is_some();
        let ChartKind::Hierarchy(HierChart::Tree(t)) = &mut self.kind else {
            return false;
        };
        let staged = animate && t.stage_toggle(node, expanded, &mut self.series, &mut self.styled.markers);
        if !staged {
            t.set_expanded(node, expanded, false);
        }
        if staged {
            self.begin_update_animation();
        }
        self.hover = None;
        self.hover_ndc = None;
        self.dirty.fills = true;
        self.dirty.series = true;
        self.dirty.overlay = true;
        true
    }

    /// Flips a tidy tree node (see `set_tree_node_expanded`).
    pub fn toggle_tree_node(&mut self, node: u32) -> bool {
        let ChartKind::Hierarchy(HierChart::Tree(t)) = &self.kind else {
            return false;
        };
        let Some(&e) = t.expanded.get(node as usize) else {
            return false;
        };
        self.set_tree_node_expanded(node, !e)
    }

    /// Expanded flag per node of a tidy tree.
    pub fn tree_expanded(&self) -> Option<&[bool]> {
        match self.hier()? {
            HierChart::Tree(t) => Some(&t.expanded),
            _ => None,
        }
    }

    /// Shown (every ancestor expanded) flag of a tidy tree node.
    pub fn tree_node_visible(&self, node: u32) -> bool {
        matches!(self.hier(), Some(HierChart::Tree(t)) if t.is_visible(node))
    }

    fn hier(&self) -> Option<&HierChart> {
        match &self.kind {
            ChartKind::Hierarchy(h) => Some(h),
            _ => None,
        }
    }

    /// Palette / overrides / colormap of the hierarchy chart (re-colors, keeps the layout).
    pub fn set_hierarchy_style(&mut self, style: HierarchyStyle) {
        if let ChartKind::Hierarchy(h) = &mut self.kind {
            match h {
                HierChart::Treemap(t) => t.set_style(style),
                HierChart::Sunburst(s) => s.set_style(style),
                HierChart::Sankey(s) => s.set_style(style),
                HierChart::Tree(t) => t.set_style(style),
            }
            self.dirty.fills = true;
            self.dirty.overlay = true;
        }
    }

    /// Tree of a treemap / sunburst.
    pub fn hierarchy_tree(&self) -> Option<&Tree> {
        match self.hier()? {
            HierChart::Treemap(t) => Some(&t.tree),
            HierChart::Sunburst(s) => Some(&s.tree),
            HierChart::Tree(t) => Some(&t.tree),
            HierChart::Sankey(_) => None,
        }
    }

    /// Display color per node (treemap / sunburst nodes, sankey nodes).
    pub fn hierarchy_colors(&self) -> Option<&[[f32; 4]]> {
        Some(match self.hier()? {
            HierChart::Treemap(t) => &t.colors,
            HierChart::Sunburst(s) => &s.colors,
            HierChart::Sankey(s) => &s.colors,
            HierChart::Tree(t) => &t.colors,
        })
    }

    /// Legend entries `(group node or -1 = Other, color)`.
    pub fn hierarchy_legend(&self) -> Option<&[(i64, [f32; 4])]> {
        Some(match self.hier()? {
            HierChart::Treemap(t) => &t.legend,
            HierChart::Sunburst(s) => &s.legend,
            HierChart::Sankey(_) | HierChart::Tree(_) => &[],
        })
    }

    /// Label anchors of the last prepared frame and their revision.
    pub fn hierarchy_labels(&self) -> Option<(&[HierarchyLabel], u32)> {
        Some(match self.hier()? {
            HierChart::Treemap(t) => (&t.labels, t.labels_revision),
            HierChart::Sunburst(s) => (&s.labels, s.labels_revision),
            HierChart::Sankey(s) => (&s.labels, s.labels_revision),
            HierChart::Tree(t) => (&t.labels, t.labels_revision),
        })
    }

    /// Current root, plot / center geometry and hovered item of the last prepared frame.
    pub fn hierarchy_layout(&self) -> Option<HierarchyLayoutInfo> {
        let hovered = self.hover.as_ref().and_then(|h| h.items.get(h.primary)).map(|i| (i.series, i.index));
        let mut info = match self.hier()? {
            HierChart::Treemap(t) => t.layout_info(),
            HierChart::Sunburst(s) => s.layout_info(),
            HierChart::Sankey(s) => s.layout_info(),
            HierChart::Tree(t) => t.layout_info(),
        };
        info.hovered = hovered;
        Some(info)
    }

    /// Node a click on `node` drills into: treemap = the current root's child containing it,
    /// sunburst = the node itself, the center (current root) = its parent. `None` = no drill
    /// (leaf, outside the current root, or sankey).
    pub fn hierarchy_drill_target(&self, node: u32) -> Option<u32> {
        match self.hier()? {
            HierChart::Treemap(t) => t.drill_target(node),
            HierChart::Sunburst(s) => s.drill_target(node),
            HierChart::Sankey(_) | HierChart::Tree(_) => None,
        }
    }

    /// Shows the subtree of `node` (treemap / sunburst). Returns false when unchanged or invalid
    /// (leaves cannot be roots). Drops the hover.
    pub fn set_hierarchy_root(&mut self, node: u32) -> bool {
        let changed = match &mut self.kind {
            ChartKind::Hierarchy(HierChart::Treemap(t)) => t.set_root(node),
            ChartKind::Hierarchy(HierChart::Sunburst(s)) => s.set_root(node),
            _ => false,
        };
        if changed {
            self.hover = None;
            self.hover_ndc = None;
            self.dirty.fills = true;
            self.dirty.overlay = true;
            self.dirty.series = true;
        }
        changed
    }

    /// Sankey nodes and links (layout in CSS px of the last prepared frame).
    pub fn sankey(&self) -> Option<&SankeyChart> {
        match self.hier()? {
            HierChart::Sankey(s) => Some(s),
            _ => None,
        }
    }

    /// Hovers item `(series, index)` directly (keyboard focus; series 1 = sankey link).
    pub fn hover_hierarchy_item(&mut self, scene: &mut SceneWorld, series: u32, index: u32) -> Option<HoverResult> {
        let hit = self.hier()?.item(series, index);
        self.hover_ndc = None;
        self.hover_x = None;
        self.set_hover(hit.clone(), scene);
        hit
    }

    /// Lays out / tessellates / labels the hierarchy chart for this frame (each kind caches on
    /// its own keys) and redraws the hover overlay.
    pub(crate) fn prepare_hierarchy(&mut self, view: &ChartView) {
        let hovered = self.hover.as_ref().and_then(|h| h.items.get(h.primary)).map(|i| (i.series, i.index));
        let animating = self.is_animating();
        let ChartKind::Hierarchy(h) = &mut self.kind else {
            return;
        };
        let force = self.dirty.fills;
        let out = HierFrame {
            fills: &mut self.fills,
            edges: &mut self.series,
            overlay: &mut self.overlay,
            underlay: &mut self.underlay,
            patches: &mut self.fill_patches,
            style: &mut self.fill_style,
            markers: &mut self.styled.markers,
            overlay_markers: &mut self.markers,
        };
        let changed = match h {
            HierChart::Treemap(t) => t.prepare(view, &self.padding, hovered, force, self.dirty.overlay, out),
            HierChart::Sunburst(s) => s.prepare(view, &self.padding, hovered, force, out),
            HierChart::Sankey(s) => s.prepare(view, &self.padding, hovered, force, out),
            HierChart::Tree(t) => t.prepare(view, &self.padding, hovered, force, self.dirty.overlay, animating, out),
        };
        let tree = matches!(h, HierChart::Tree(_));
        self.dirty.fills |= changed.fills;
        self.dirty.series |= changed.fills;
        self.dirty.overlay |= changed.overlay;
        self.dirty.fill_style |= changed.style;
        if self.dirty.underlay {
            self.underlay.clear();
        }
        // Tree: the hover symbol lives in the overlay markers (rebuilt by `prepare`)
        if self.dirty.overlay && !tree {
            self.markers.clear();
        }
    }
}

/// Output buffers of a hierarchy frame.
pub(crate) struct HierFrame<'a> {
    pub fills: &'a mut Vec<ChartFillRaw>,
    /// Anti-aliasing outlines (sunburst arcs)
    pub edges: &'a mut Vec<ChartSegmentRaw>,
    /// Hover outline (treemap)
    pub overlay: &'a mut Vec<ChartSegmentRaw>,
    #[allow(dead_code)]
    pub underlay: &'a mut Vec<ChartSegmentRaw>,
    /// Re-written vertex ranges of `fills` (uploaded alone unless the fills were rebuilt)
    pub patches: &'a mut Vec<(u32, u32)>,
    /// Fill emphasis uniform (set `HierChanged::style` when it changes)
    pub style: &'a mut ChartFillStyleRaw,
    /// Node symbols (tree; staged with the edges in `edges`)
    pub markers: &'a mut Vec<ChartMarkerRaw>,
    /// Hover symbol (tree)
    pub overlay_markers: &'a mut Vec<ChartMarkerRaw>,
}

/// What a hierarchy frame rebuilt.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct HierChanged {
    pub fills: bool,
    pub overlay: bool,
    /// Fill emphasis uniform
    pub style: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tree_aggregates_sorts_and_groups() {
        // 0 root; 1, 2 groups; 3, 4 under 1; 5 under 2
        let parents = [-1, 0, 0, 1, 1, 2];
        let values = [99.0, 99.0, f64::NAN, 1.0, 5.0, 10.0];
        let t = Tree::build(&parents, &values).unwrap();
        assert_eq!(t.value, vec![16.0, 6.0, 10.0, 1.0, 5.0, 10.0], "parents sum their children");
        assert_eq!(t.children(0), &[2, 1], "largest first");
        assert_eq!(t.children(1), &[4, 3]);
        assert_eq!((t.group[2], t.group[5], t.group[1], t.group[3]), (0, 0, 1, 1));
        assert_eq!(t.height[0], 2);
        assert_eq!(t.depth[5], 2);
        assert!(t.is_ancestor(1, 3) && !t.is_ancestor(2, 3));
        assert_eq!(t.child_toward(0, 3), Some(1));
        assert!(!t.virtual_root);

        // Several roots: a virtual root on top
        let t = Tree::build(&[-1, -1, 0], &[0.0, 2.0, 3.0]).unwrap();
        assert!(t.virtual_root && t.root == 3 && t.value[3] == 5.0);
        // Zero-valued children are not shown
        let t = Tree::build(&[-1, 0, 0], &[0.0, 0.0, 3.0]).unwrap();
        assert_eq!(t.shown_children(0), &[2]);
    }

    #[test]
    fn tree_rejects_cycles_and_bad_values() {
        let e = Tree::build(&[1, 2, 0], &[1.0; 3]).unwrap_err();
        assert!(e.contains("cycle") && e.contains("node 0 -> node 1 -> node 2 -> node 0"), "{e}");
        // A root exists but a detached loop does not reach it
        let e = Tree::build(&[-1, 2, 1], &[1.0; 3]).unwrap_err();
        assert!(e.contains("cycle: node 1 -> node 2 -> node 1"), "{e}");
        assert!(Tree::build(&[-1, 1], &[1.0; 2]).unwrap_err().contains("node 1 -> node 1"));
        assert!(Tree::build(&[-1, 0], &[1.0, -1.0]).unwrap_err().contains("node 1 value"));
        assert!(Tree::build(&[-1, 0], &[1.0, f64::INFINITY]).is_err());
        assert!(Tree::build(&[-1, 5], &[1.0, 1.0]).unwrap_err().contains("parent 5"));
        assert!(Tree::build(&[], &[]).is_err());
        assert!(Tree::build(&[-1], &[1.0, 2.0]).is_err());
    }

    #[test]
    fn group_colors_fold_beyond_the_palette_and_value_mode_uses_the_colormap() {
        let style = HierarchyStyle { palette: vec![[1.0, 0.0, 0.0, 1.0], [0.0, 1.0, 0.0, 1.0], [0.0, 0.0, 1.0, 1.0]], ..Default::default() };
        // 4 groups, 3 colors: 2 kept + Other
        let parents = [-1, 0, 0, 0, 0, 1];
        let values = [0.0, 0.0, 3.0, 2.0, 1.0, 4.0];
        let t = Tree::build(&parents, &values).unwrap();
        let (c, legend) = tree_colors(&t, &style, HierarchyColorBy::Group, 0.0);
        assert_eq!(legend.iter().map(|l| l.0).collect::<Vec<_>>(), vec![1, 2, -1]);
        assert_eq!(c[1], style.palette[0]);
        assert_eq!(c[5], style.palette[0], "descendants keep the group hue");
        assert_eq!(c[2], style.palette[1]);
        assert_eq!((c[3], c[4]), (style.other_color, style.other_color));
        // Auto: too many groups for the palette -> value colors, no legend
        let (_, legend) = tree_colors(&t, &style, HierarchyColorBy::Auto, 0.0);
        assert!(legend.is_empty());
        let (v, _) = tree_colors(&t, &HierarchyStyle::default(), HierarchyColorBy::Value, 0.0);
        assert_ne!(v[1], v[4], "largest vs smallest group differ");
        // Overrides win
        let style = HierarchyStyle { colors: vec![None, Some([0.5; 4])], ..style };
        assert_eq!(tree_colors(&t, &style, HierarchyColorBy::Group, 0.0).0[1], [0.5; 4]);
    }
}
