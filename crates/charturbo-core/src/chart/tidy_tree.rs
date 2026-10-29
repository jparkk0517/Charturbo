//! Tidy tree (node-link) charts: the Buchheim–Jünger–Leipert linear-time Walker layout, ported
//! from d3-hierarchy `tree()` (same coordinates: siblings 1 apart, cousins 2; the radial layout
//! divides the separation by the depth), laid out left-right / right-left / top-bottom /
//! bottom-top or radially, with cubic bezier (ECharts curvature) or elbow edges.
//!
//! Nodes collapse / expand (`initial_depth`, per-node state, toggles); the layout runs over the
//! visible nodes only. With animations on, a toggle tweens from the old layout: both frames draw
//! the union of the old and new visible nodes in the same order (fixed segment counts per edge),
//! hidden ones folded onto their nearest visible ancestor at zero alpha, so the staged layers
//! interpolate element-wise (animation.rs); the folded "ghosts" go away when it ends.
//!
//! Labels are DOM text at anchors exported here: beside the node by orient (leaves away from the
//! root, parents toward it) or along the radius in the radial layout (flipped on the left half),
//! thinned per depth so neighbours never overlap.

use super::hierarchy::*;
use super::*;

/// Segments of a curved edge (fixed: animated toggles pair segments element-wise).
pub const TREE_CURVE_SEGMENTS: usize = 16;
/// Label anchors at most.
pub const MAX_TREE_LABELS: usize = 1500;
/// Gap between a node symbol and its label (CSS px).
const LABEL_GAP_PX: f32 = 5.0;
/// Edges mix the surface this far toward the text color.
const EDGE_TINT: f32 = 0.32;
/// Ring width of node symbols (CSS px).
const RING_PX: f32 = 1.5;

/// Node-link layout.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TreeLayout {
    #[default]
    Orthogonal,
    Radial,
}

/// Direction from the root toward the leaves (orthogonal layout).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TreeOrient {
    #[default]
    LeftRight,
    RightLeft,
    TopBottom,
    BottomTop,
}

impl TreeOrient {
    /// 0 = LR, 1 = RL, 2 = TB, 3 = BT
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::RightLeft,
            2 => Self::TopBottom,
            3 => Self::BottomTop,
            _ => Self::LeftRight,
        }
    }

    fn horizontal(self) -> bool {
        matches!(self, Self::LeftRight | Self::RightLeft)
    }
}

/// Edge shape: cubic bezier, or an orthogonal elbow (the radial layout always curves).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TreeEdgeShape {
    #[default]
    Curve,
    Polyline,
}

/// Node symbol (`EmptyCircle`: a ring filled with the surface; filled when collapsed).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TreeSymbol {
    #[default]
    EmptyCircle,
    Circle,
    Rect,
    Diamond,
    Triangle,
    None,
}

impl TreeSymbol {
    /// 0 = emptyCircle, 1 = circle, 2 = rect, 3 = diamond, 4 = triangle, 5 = none
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Circle,
            2 => Self::Rect,
            3 => Self::Diamond,
            4 => Self::Triangle,
            5 => Self::None,
            _ => Self::EmptyCircle,
        }
    }

    /// Marker shape code of `ChartMarkerRaw` (0 circle, 1 square, 2 diamond, 3 triangle).
    fn shape(self) -> f32 {
        match self {
            Self::Rect => 1.0,
            Self::Diamond => 2.0,
            Self::Triangle => 3.0,
            _ => 0.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TidyTreeOptions {
    pub layout: TreeLayout,
    pub orient: TreeOrient,
    pub edge_shape: TreeEdgeShape,
    /// Nodes above this depth start expanded (root = depth 0; negative = all expanded)
    pub initial_depth: i32,
    pub symbol: TreeSymbol,
    /// Symbol diameter (CSS px)
    pub symbol_size_px: f32,
    /// Edge stroke width (CSS px)
    pub edge_width_px: f32,
    /// Bezier control point offset (0 = straight, 0.5 = ECharts default)
    pub curvature: f32,
    /// Group colors (depth-1 ancestor) instead of one color
    pub color_by_group: bool,
    pub labels: bool,
    /// Label line height (CSS px): labels closer than this along the breadth are thinned
    pub label_line_px: f32,
}

impl Default for TidyTreeOptions {
    fn default() -> Self {
        Self {
            layout: TreeLayout::Orthogonal,
            orient: TreeOrient::LeftRight,
            edge_shape: TreeEdgeShape::Curve,
            initial_depth: 2,
            symbol: TreeSymbol::EmptyCircle,
            symbol_size_px: 7.0,
            edge_width_px: 1.5,
            curvature: 0.5,
            color_by_group: false,
            labels: true,
            label_line_px: 14.0,
        }
    }
}

const NONE: u32 = u32::MAX;

/// d3-hierarchy `tree()` on the subtree of `root` whose children are `kids(v)` (in order):
/// raw x per node (root = 0; siblings `sep(a, b)` apart), NaN for nodes outside the subtree.
/// `sep(a, b, same_parent)`. Iterative (no recursion), linear in the visited nodes.
pub fn tidy_layout<'a>(
    n: usize,
    root: u32,
    parent: &[u32],
    depth: &[u32],
    kids: impl Fn(u32) -> &'a [u32],
    sep: impl Fn(u32, u32) -> f64,
) -> Vec<f64> {
    let mut x = vec![f64::NAN; n];
    // Walker state per node: prelim, mod, change, shift, thread, ancestor, default ancestor, rank
    let mut z = vec![0.0f64; n];
    let mut m = vec![0.0f64; n];
    let mut c = vec![0.0f64; n];
    let mut s = vec![0.0f64; n];
    let mut t = vec![NONE; n];
    let mut a: Vec<u32> = (0..n as u32).collect();
    let mut def_anc = vec![NONE; n];
    let mut rank = vec![0u32; n];
    // The root's (virtual) parent: default ancestor and mod
    let mut root_anc = NONE;

    // d3 `eachAfter`: children before parents, siblings first to last
    let mut next = Vec::new();
    let mut stack = vec![root];
    while let Some(v) = stack.pop() {
        next.push(v);
        for (k, &ch) in kids(v).iter().enumerate() {
            rank[ch as usize] = k as u32;
            stack.push(ch);
        }
    }
    let par = |v: u32| if v == root { NONE } else { parent[v as usize] };
    let first_sibling = |v: u32| {
        if v == root {
            root
        } else {
            kids(parent[v as usize])[0]
        }
    };
    let prev_sibling = |v: u32| {
        let r = rank[v as usize];
        (v != root && r > 0).then(|| kids(parent[v as usize])[r as usize - 1])
    };
    let next_left = |v: u32, t: &[u32]| kids(v).first().copied().unwrap_or(t[v as usize]);
    let next_right = |v: u32, t: &[u32]| kids(v).last().copied().unwrap_or(t[v as usize]);

    for &v in next.iter().rev() {
        let vi = v as usize;
        let ch = kids(v);
        let w = prev_sibling(v);
        if !ch.is_empty() {
            // executeShifts
            let (mut shift, mut change) = (0.0, 0.0);
            for &k in ch.iter().rev() {
                let k = k as usize;
                z[k] += shift;
                m[k] += shift;
                change += c[k];
                shift += s[k] + change;
            }
            let mid = (z[ch[0] as usize] + z[ch[ch.len() - 1] as usize]) / 2.0;
            match w {
                Some(w) => {
                    z[vi] = z[w as usize] + sep(v, w);
                    m[vi] = z[vi] - mid;
                }
                None => z[vi] = mid,
            }
        } else if let Some(w) = w {
            z[vi] = z[w as usize] + sep(v, w);
        }
        // apportion
        let p = par(v);
        let mut ancestor = match p {
            NONE => root_anc,
            p => def_anc[p as usize],
        };
        if ancestor == NONE {
            ancestor = first_sibling(v);
        }
        if let Some(w) = w {
            let (mut vip, mut vop, mut vim, mut vom) = (v, v, w, first_sibling(v));
            let (mut sip, mut sop, mut sim, mut som) = (
                m[vip as usize],
                m[vop as usize],
                m[vim as usize],
                m[vom as usize],
            );
            loop {
                let nim = next_right(vim, &t);
                let nip = next_left(vip, &t);
                if nim == NONE || nip == NONE {
                    vim = nim;
                    vip = nip;
                    break;
                }
                vim = nim;
                vip = nip;
                vom = next_left(vom, &t);
                vop = next_right(vop, &t);
                a[vop as usize] = v;
                let shift = z[vim as usize] + sim - z[vip as usize] - sip + sep(vim, vip);
                if shift > 0.0 {
                    // nextAncestor, moveSubtree
                    let va = a[vim as usize];
                    let wm = if par(va) == par(v) { va } else { ancestor };
                    let (wm, wp) = (wm as usize, vi);
                    let change = shift / (rank[wp] as f64 - rank[wm] as f64);
                    c[wp] -= change;
                    s[wp] += shift;
                    c[wm] += change;
                    z[wp] += shift;
                    m[wp] += shift;
                    sip += shift;
                    sop += shift;
                }
                sim += m[vim as usize];
                sip += m[vip as usize];
                som += m[vom as usize];
                sop += m[vop as usize];
            }
            if vim != NONE && next_right(vop, &t) == NONE {
                t[vop as usize] = vim;
                m[vop as usize] += sim - sop;
            }
            if vip != NONE && next_left(vom, &t) == NONE {
                t[vom as usize] = vip;
                m[vom as usize] += sip - som;
                ancestor = v;
            }
        }
        match p {
            NONE => root_anc = ancestor,
            p => def_anc[p as usize] = ancestor,
        }
    }
    // secondWalk (parents first): the virtual parent's mod is -root.z
    let _ = depth;
    let root_m = -z[root as usize];
    for &v in &next {
        let pm = match par(v) {
            NONE => root_m,
            p => m[p as usize],
        };
        x[v as usize] = z[v as usize] + pm;
        m[v as usize] += pm;
    }
    x
}

/// d3 `tree().size([dx, dy])` of a raw layout: `(x, y)` per laid-out node (NaN elsewhere).
pub fn tidy_fit(
    x: &[f64],
    depth: &[u32],
    root_depth: u32,
    sep: impl Fn(u32, u32) -> f64,
    dx: f64,
    dy: f64,
) -> Vec<(f64, f64)> {
    let mut out = vec![(f64::NAN, f64::NAN); x.len()];
    let laid = || (0..x.len()).filter(|&v| !x[v].is_nan());
    let (Some(left), Some(right)) = (
        laid().min_by(|&a, &b| x[a].total_cmp(&x[b])),
        laid().max_by(|&a, &b| x[a].total_cmp(&x[b]).then(b.cmp(&a))),
    ) else {
        return out;
    };
    let bottom = laid().map(|v| depth[v] - root_depth).max().unwrap_or(0);
    let s = if left == right {
        1.0
    } else {
        sep(left as u32, right as u32) / 2.0
    };
    let tx = s - x[left];
    let kx = dx / (x[right] + s + tx);
    let ky = dy / (bottom.max(1) as f64);
    for v in laid() {
        out[v] = ((x[v] + tx) * kx, (depth[v] - root_depth) as f64 * ky);
    }
    out
}

/// Cubic bezier point.
fn bezier(p0: (f32, f32), p1: (f32, f32), p2: (f32, f32), p3: (f32, f32), t: f32) -> (f32, f32) {
    let u = 1.0 - t;
    let (a, b, c, d) = (u * u * u, 3.0 * u * u * t, 3.0 * u * t * t, t * t * t);
    (
        a * p0.0 + b * p1.0 + c * p2.0 + d * p3.0,
        a * p0.1 + b * p1.1 + c * p2.1 + d * p3.1,
    )
}

#[derive(Debug, Clone)]
pub(crate) struct TidyTreeChart {
    pub(crate) tree: Tree,
    opts: TidyTreeOptions,
    style: HierarchyStyle,
    pub(crate) colors: Vec<[f32; 4]>,
    /// Estimated label width per node (CSS px, from the SDK)
    label_px: Vec<f32>,
    pub(crate) expanded: Vec<bool>,
    /// Shown (every ancestor expanded) in the current layout
    visible: Vec<bool>,
    /// Drawn although hidden: the old / new visible union of an animated toggle
    ghost: Vec<bool>,
    any_ghost: bool,
    /// CSS position per visible node (NaN otherwise); radial: compass angle and radius too
    pos: Vec<(f32, f32)>,
    polar: Vec<(f32, f32)>,
    center: (f32, f32),
    radius: f32,
    plot: [f32; 4],
    screen: Option<FlatScreen>,
    /// Bumped by every expand / collapse (layout key)
    state_rev: u32,
    layout_key: Option<([f32; 4], f32, u32)>,
    built: Option<(FlatScreen, u32, bool)>,
    outlined: Option<Option<(u32, u32)>>,
    pub(crate) labels: Vec<HierarchyLabel>,
    pub(crate) labels_revision: u32,
}

impl TidyTreeChart {
    /// `state`: per input node 0 = default (`initial_depth`), 1 = expanded, 2 = collapsed.
    pub(crate) fn new(
        tree: Tree,
        mut opts: TidyTreeOptions,
        state: &[u8],
        label_px: &[f32],
        style: HierarchyStyle,
    ) -> Self {
        let d = TidyTreeOptions::default();
        let fix =
            |v: f32, lo: f32, hi: f32, d: f32| if v.is_finite() { v.clamp(lo, hi) } else { d };
        opts.symbol_size_px = fix(opts.symbol_size_px, 0.0, 64.0, d.symbol_size_px);
        opts.edge_width_px = fix(opts.edge_width_px, 0.25, 16.0, d.edge_width_px);
        opts.curvature = fix(opts.curvature, 0.0, 1.0, d.curvature);
        opts.label_line_px = fix(opts.label_line_px, 1.0, 200.0, d.label_line_px);
        let n = tree.len();
        let expanded = (0..n)
            .map(|v| match state.get(v) {
                Some(1) => true,
                Some(2) => false,
                _ => opts.initial_depth < 0 || (tree.depth[v] as i64) < opts.initial_depth as i64,
            })
            .collect();
        let label_px = (0..n)
            .map(|v| {
                label_px
                    .get(v)
                    .copied()
                    .filter(|w| w.is_finite())
                    .unwrap_or(0.0)
                    .clamp(0.0, 400.0)
            })
            .collect();
        let mut t = Self {
            tree,
            opts,
            style,
            colors: Vec::new(),
            label_px,
            expanded,
            visible: vec![false; n],
            ghost: vec![false; n],
            any_ghost: false,
            pos: vec![(f32::NAN, f32::NAN); n],
            polar: vec![(f32::NAN, f32::NAN); n],
            center: (0.0, 0.0),
            radius: 0.0,
            plot: [0.0; 4],
            screen: None,
            state_rev: 0,
            layout_key: None,
            built: None,
            outlined: None,
            labels: Vec::new(),
            labels_revision: 0,
        };
        t.assign_colors();
        t.update_visible();
        t
    }

    fn assign_colors(&mut self) {
        self.colors = if self.opts.color_by_group {
            tree_colors(&self.tree, &self.style, HierarchyColorBy::Group, 0.0).0
        } else {
            let base = self
                .style
                .palette
                .first()
                .copied()
                .unwrap_or(self.style.other_color);
            (0..self.tree.len())
                .map(|v| self.style.colors.get(v).copied().flatten().unwrap_or(base))
                .collect()
        };
    }

    pub(crate) fn set_style(&mut self, style: HierarchyStyle) {
        self.style = style;
        self.assign_colors();
        self.built = None;
        self.outlined = None;
    }

    pub(crate) fn has_children(&self, v: u32) -> bool {
        (v as usize) < self.tree.len() && !self.tree.children(v).is_empty()
    }

    fn shown_kids(&self, v: u32) -> &[u32] {
        if self.expanded[v as usize] {
            self.tree.children(v)
        } else {
            &[]
        }
    }

    fn update_visible(&mut self) {
        self.visible.iter_mut().for_each(|v| *v = false);
        let mut stack = vec![self.tree.root];
        while let Some(v) = stack.pop() {
            self.visible[v as usize] = true;
            if self.expanded[v as usize] {
                stack.extend_from_slice(self.tree.children(v));
            }
        }
    }

    pub(crate) fn is_visible(&self, v: u32) -> bool {
        self.visible.get(v as usize).copied().unwrap_or(false)
    }

    #[cfg(test)]
    pub(crate) fn visible_count(&self) -> usize {
        self.visible.iter().filter(|&&v| v).count()
    }

    /// Expands / collapses `node` (parents only). `ghosts`: keep the old and new visible nodes
    /// drawn (animated toggle). Returns false when unchanged.
    pub(crate) fn set_expanded(&mut self, node: u32, expanded: bool, ghosts: bool) -> bool {
        if !self.has_children(node) || self.expanded[node as usize] == expanded {
            return false;
        }
        if ghosts {
            for (g, &v) in self.ghost.iter_mut().zip(&self.visible) {
                *g |= v;
            }
        }
        self.expanded[node as usize] = expanded;
        self.update_visible();
        if ghosts {
            for (g, &v) in self.ghost.iter_mut().zip(&self.visible) {
                *g |= v;
            }
            self.any_ghost = true;
        }
        self.state_rev = self.state_rev.wrapping_add(1);
        true
    }

    fn clear_ghosts(&mut self) {
        if self.any_ghost {
            self.ghost.iter_mut().for_each(|g| *g = false);
            self.any_ghost = false;
            self.built = None;
        }
    }

    fn drawn(&self, v: u32) -> bool {
        self.visible[v as usize] || self.ghost[v as usize]
    }

    fn label_room(&self, v: usize) -> f32 {
        if self.opts.labels {
            self.label_px[v] + LABEL_GAP_PX
        } else {
            0.0
        }
    }

    /// Lays out the visible nodes in the plot (CSS px).
    fn layout(&mut self, plot: [f32; 4]) {
        let n = self.tree.len();
        let tree = &self.tree;
        let expanded = &self.expanded;
        let kids = |v: u32| {
            if expanded[v as usize] {
                tree.children(v)
            } else {
                &[][..]
            }
        };
        let radial = self.opts.layout == TreeLayout::Radial;
        let depth = &tree.depth;
        let parent = &tree.parent;
        let sep = |a: u32, b: u32| {
            let s = if parent[a as usize] == parent[b as usize] {
                1.0
            } else {
                2.0
            };
            if radial {
                s / depth[a as usize].max(1) as f64
            } else {
                s
            }
        };
        let raw = tidy_layout(n, tree.root, parent, depth, kids, sep);
        let fit = tidy_fit(&raw, depth, 0, sep, 1.0, 1.0);
        let r = 0.5 * self.opts.symbol_size_px;
        let leaf = |v: usize| self.visible[v] && kids(v as u32).is_empty();
        let max_depth = (0..n)
            .filter(|&v| self.visible[v])
            .map(|v| depth[v])
            .max()
            .unwrap_or(0) as f32;
        self.pos.iter_mut().for_each(|p| *p = (f32::NAN, f32::NAN));
        self.polar
            .iter_mut()
            .for_each(|p| *p = (f32::NAN, f32::NAN));
        let [l, t, w, h] = plot;
        if radial {
            let room = (0..n)
                .filter(|&v| leaf(v))
                .map(|v| self.label_room(v))
                .fold(0.0f32, f32::max)
                + r
                + 2.0;
            let half = 0.5 * w.min(h);
            let radius = (half - room).max(0.3 * half);
            self.center = (l + 0.5 * w, t + 0.5 * h);
            self.radius = radius;
            for v in 0..n {
                let (fx, fy) = fit[v];
                if fx.is_nan() {
                    continue;
                }
                let ang = (fx * std::f64::consts::TAU) as f32;
                let rad = fy as f32 * radius;
                self.polar[v] = (ang, rad);
                self.pos[v] = (
                    self.center.0 + rad * ang.sin(),
                    self.center.1 - rad * ang.cos(),
                );
            }
            return;
        }
        let horizontal = self.opts.orient.horizontal();
        // Breadth across the plot, depth along it with room for the root / leaf labels
        let (span, breadth) = if horizontal { (w, h) } else { (h, w) };
        let root = tree.root as usize;
        let root_room = if horizontal {
            self.label_room(root)
        } else if self.opts.labels {
            self.opts.label_line_px + LABEL_GAP_PX
        } else {
            0.0
        };
        let start = (root_room + r).min(0.25 * span);
        let mut step = if max_depth > 0.0 {
            (span - start - r) / max_depth
        } else {
            0.0
        };
        for v in (0..n).filter(|&v| leaf(v) && depth[v] > 0) {
            step = step.min((span - start - r - self.label_room(v)) / depth[v] as f32);
        }
        if max_depth > 0.0 {
            step = step.max(0.4 * (span - start) / max_depth);
        }
        let pad = if horizontal {
            0.5 * self.opts.label_line_px.max(2.0 * r)
        } else {
            r.max(2.0)
        };
        let b0 = pad.min(0.25 * breadth);
        let bspan = breadth - 2.0 * b0;
        for v in 0..n {
            let (fx, _) = fit[v];
            if fx.is_nan() {
                continue;
            }
            let along = start + depth[v] as f32 * step;
            let across = b0 + fx as f32 * bspan;
            self.pos[v] = match self.opts.orient {
                TreeOrient::LeftRight => (l + along, t + across),
                TreeOrient::RightLeft => (l + w - along, t + across),
                TreeOrient::TopBottom => (l + across, t + along),
                TreeOrient::BottomTop => (l + across, t + h - along),
            };
        }
    }

    /// Position of a drawn node in this frame: its own, else its nearest visible ancestor's
    /// (`false`: hidden ghost).
    fn anchor(&self, v: u32) -> ((f32, f32), (f32, f32), bool) {
        let mut u = v;
        while !self.visible[u as usize] {
            u = self.tree.parent[u as usize];
        }
        (self.pos[u as usize], self.polar[u as usize], u == v)
    }

    /// Edge polyline from `a` to `b` (CSS px; fixed point count per shape).
    fn edge_points(
        &self,
        a: ((f32, f32), (f32, f32)),
        b: ((f32, f32), (f32, f32)),
        out: &mut Vec<(f32, f32)>,
    ) {
        out.clear();
        let ((p, pa), (q, qa)) = (a, b);
        let c = self.opts.curvature;
        if self.opts.layout == TreeLayout::Radial {
            let at = |ang: f32, rad: f32| {
                (
                    self.center.0 + rad * ang.sin(),
                    self.center.1 - rad * ang.cos(),
                )
            };
            let c1 = at(pa.0, pa.1 + (qa.1 - pa.1) * c);
            let c2 = at(qa.0, qa.1 + (pa.1 - qa.1) * c);
            out.extend(
                (0..=TREE_CURVE_SEGMENTS)
                    .map(|k| bezier(p, c1, c2, q, k as f32 / TREE_CURVE_SEGMENTS as f32)),
            );
            return;
        }
        let horizontal = self.opts.orient.horizontal();
        if self.opts.edge_shape == TreeEdgeShape::Polyline {
            if horizontal {
                let xm = p.0 + (q.0 - p.0) * 0.5;
                out.extend([p, (xm, p.1), (xm, q.1), q]);
            } else {
                let ym = p.1 + (q.1 - p.1) * 0.5;
                out.extend([p, (p.0, ym), (q.0, ym), q]);
            }
            return;
        }
        let (c1, c2) = if horizontal {
            ((p.0 + (q.0 - p.0) * c, p.1), (q.0 + (p.0 - q.0) * c, q.1))
        } else {
            ((p.0, p.1 + (q.1 - p.1) * c), (q.0, q.1 + (p.1 - q.1) * c))
        };
        out.extend(
            (0..=TREE_CURVE_SEGMENTS)
                .map(|k| bezier(p, c1, c2, q, k as f32 / TREE_CURVE_SEGMENTS as f32)),
        );
    }

    fn edge_color(&self) -> [f32; 4] {
        let mut c = mix(self.style.surface, self.style.highlight, EDGE_TINT);
        c[3] = 1.0;
        c
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

    fn marker(
        &self,
        screen: &FlatScreen,
        v: u32,
        at: (f32, f32),
        r: f32,
        alpha: f32,
    ) -> ChartMarkerRaw {
        let color = self.colors[v as usize];
        let collapsed = self.has_children(v) && !self.expanded[v as usize];
        let hollow = self.opts.symbol == TreeSymbol::EmptyCircle && !collapsed;
        let mut fill = if hollow { self.style.surface } else { color };
        let mut ring = color;
        fill[3] *= alpha;
        ring[3] *= alpha;
        let (x, y) = screen.world(at.0, at.1);
        ChartMarkerRaw {
            center_radius: [x, y, 0.0, r],
            fill,
            ring,
            params: [RING_PX, self.opts.symbol.shape(), 0.0, 0.0],
        }
    }

    /// Edges and node symbols of the drawn nodes (preorder; ghosts folded at zero alpha).
    fn build(
        &self,
        screen: &FlatScreen,
        series: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        series.clear();
        markers.clear();
        let edge = self.edge_color();
        let width = self.opts.edge_width_px;
        let r = 0.5 * self.opts.symbol_size_px;
        let mut pts = Vec::with_capacity(TREE_CURVE_SEGMENTS + 1);
        let mut order = Vec::new();
        let mut stack = vec![self.tree.root];
        while let Some(v) = stack.pop() {
            order.push(v);
            for &c in self.tree.children(v).iter().rev() {
                if self.drawn(c) {
                    stack.push(c);
                }
            }
        }
        for &v in &order {
            let (p, pp, shown) = self.anchor(v);
            if v != self.tree.root {
                let (q, qp, _) = self.anchor(self.tree.parent[v as usize]);
                self.edge_points((q, qp), (p, pp), &mut pts);
                let mut c = edge;
                if !shown {
                    c[3] = 0.0;
                }
                Self::push_polyline(screen, &pts, width, c, series);
            }
        }
        if self.opts.symbol != TreeSymbol::None && r > 0.0 {
            for &v in &order {
                let (p, _, shown) = self.anchor(v);
                markers.push(self.marker(screen, v, p, r, if shown { 1.0 } else { 0.0 }));
            }
        }
    }

    /// Hover overlay: the path to the root drawn in the node color, the symbol enlarged.
    fn build_overlay(
        &self,
        screen: &FlatScreen,
        node: u32,
        overlay: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        if !self.is_visible(node) {
            return;
        }
        let color = self.colors[node as usize];
        let mut pts = Vec::with_capacity(TREE_CURVE_SEGMENTS + 1);
        let mut v = node;
        while v != self.tree.root {
            let p = self.tree.parent[v as usize];
            self.edge_points(
                (self.pos[p as usize], self.polar[p as usize]),
                (self.pos[v as usize], self.polar[v as usize]),
                &mut pts,
            );
            Self::push_polyline(screen, &pts, self.opts.edge_width_px + 1.0, color, overlay);
            v = p;
        }
        let r = (0.5 * self.opts.symbol_size_px).max(3.0) + 2.0;
        let mut m = self.marker(screen, node, self.pos[node as usize], r, 1.0);
        if self.opts.symbol == TreeSymbol::None {
            m.params[1] = 0.0;
        }
        markers.push(m);
    }

    /// Visible node nearest to CSS point `(x, y)` within its symbol (at least 8 px).
    pub(crate) fn node_at(&self, x: f32, y: f32) -> Option<u32> {
        let reach = (0.5 * self.opts.symbol_size_px + 4.0).max(8.0);
        let mut best = None;
        let mut best_d = reach * reach;
        for v in 0..self.tree.len() {
            if !self.visible[v] {
                continue;
            }
            let (px, py) = self.pos[v];
            let d = (px - x) * (px - x) + (py - y) * (py - y);
            if d <= best_d {
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
        Some(hover_one(0, v, self.tree.value[v as usize], v))
    }

    /// World position of a visible node.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let s = self.screen?;
        if !self.is_visible(global_id) {
            return None;
        }
        let (x, y) = self.pos[global_id as usize];
        if x.is_nan() {
            return None;
        }
        let (wx, wy) = s.world(x, y);
        Some((0, global_id, 0.0, Vec3::new(wx, wy, 0.0)))
    }

    /// Label anchors: `(x, y)` = anchor, `w_css` = rotation (radians, clockwise), `h_css` = room
    /// for the text (CSS px), `flags` = 1 text starts at the anchor, -1 ends there, 0 centered.
    fn layout_labels(&mut self) -> bool {
        let mut labels = Vec::new();
        if self.opts.labels {
            let n = self.tree.len();
            let r = 0.5 * self.opts.symbol_size_px;
            let off = r + LABEL_GAP_PX;
            let line = self.opts.label_line_px;
            let [l, t, w, h] = self.plot;
            let radial = self.opts.layout == TreeLayout::Radial;
            let mut max_depth = 0;
            // Thinned per depth along the breadth (raw position order)
            let mut by_depth: Vec<Vec<u32>> = Vec::new();
            for v in 0..n {
                if !self.visible[v] {
                    continue;
                }
                let d = self.tree.depth[v] as usize;
                max_depth = max_depth.max(d);
                if by_depth.len() <= d {
                    by_depth.resize(d + 1, Vec::new());
                }
                by_depth[d].push(v as u32);
            }
            let step = if max_depth > 0 && !radial {
                let (a, b) = (
                    self.pos[self.tree.root as usize],
                    by_depth[1]
                        .first()
                        .map(|&c| self.pos[c as usize])
                        .unwrap_or((0.0, 0.0)),
                );
                if self.opts.orient.horizontal() {
                    (b.0 - a.0).abs()
                } else {
                    (b.1 - a.1).abs()
                }
            } else {
                0.0
            };
            for (d, nodes) in by_depth.iter_mut().enumerate() {
                let key = |v: u32| {
                    let p = self.pos[v as usize];
                    if radial {
                        self.polar[v as usize].0
                    } else if self.opts.orient.horizontal() {
                        p.1
                    } else {
                        p.0
                    }
                };
                nodes.sort_by(|&a, &b| key(a).total_cmp(&key(b)));
                let mut last = f32::NEG_INFINITY;
                for &v in nodes.iter() {
                    if labels.len() >= MAX_TREE_LABELS {
                        break;
                    }
                    let vi = v as usize;
                    let (x, y) = self.pos[vi];
                    let leafish = self.shown_kids(v).is_empty();
                    let lw = self.label_px[vi];
                    let label = if radial {
                        let (ang, rad) = self.polar[vi];
                        // Thinning along the arc at the label radius
                        let gap_need = line / rad.max(1.0);
                        if d > 0 && ang - last < gap_need {
                            continue;
                        }
                        last = ang;
                        let (dx, dy) = (ang.sin(), -ang.cos());
                        let phi = ang - std::f32::consts::FRAC_PI_2;
                        let left = dx < -1e-4;
                        if d == 0 {
                            HierarchyLabel {
                                node: v,
                                x_css: x + off,
                                y_css: y,
                                w_css: 0.0,
                                h_css: 160.0,
                                flags: 1,
                            }
                        } else if leafish {
                            let room = (0.5 * w.min(h) - rad - off).max(lw.min(40.0));
                            let (ax, ay) = (x + dx * off, y + dy * off);
                            if left {
                                HierarchyLabel {
                                    node: v,
                                    x_css: ax,
                                    y_css: ay,
                                    w_css: phi + std::f32::consts::PI,
                                    h_css: room,
                                    flags: -1,
                                }
                            } else {
                                HierarchyLabel {
                                    node: v,
                                    x_css: ax,
                                    y_css: ay,
                                    w_css: phi,
                                    h_css: room,
                                    flags: 1,
                                }
                            }
                        } else {
                            let room =
                                (self.radius / max_depth.max(1) as f32 - 2.0 * off).max(24.0);
                            let (ax, ay) = (x - dx * off, y - dy * off);
                            if left {
                                HierarchyLabel {
                                    node: v,
                                    x_css: ax,
                                    y_css: ay,
                                    w_css: phi + std::f32::consts::PI,
                                    h_css: room,
                                    flags: 1,
                                }
                            } else {
                                HierarchyLabel {
                                    node: v,
                                    x_css: ax,
                                    y_css: ay,
                                    w_css: phi,
                                    h_css: room,
                                    flags: -1,
                                }
                            }
                        }
                    } else {
                        let k = key(v);
                        let horizontal = self.opts.orient.horizontal();
                        let need = if horizontal || leafish {
                            line
                        } else {
                            lw.min((step - 2.0 * off).max(24.0)) + 4.0
                        };
                        if k - last < need {
                            continue;
                        }
                        last = k;
                        let inner = (step - 2.0 * off).max(24.0);
                        match self.opts.orient {
                            TreeOrient::LeftRight | TreeOrient::RightLeft => {
                                let lr = self.opts.orient == TreeOrient::LeftRight;
                                // Leaves away from the root, parents toward it
                                let away = leafish == lr;
                                let room = if leafish {
                                    if lr {
                                        l + w - x - off
                                    } else {
                                        x - l - off
                                    }
                                } else if d == 0 {
                                    if lr {
                                        x - l - off
                                    } else {
                                        l + w - x - off
                                    }
                                } else {
                                    inner
                                };
                                let room = room.max(24.0);
                                if away {
                                    HierarchyLabel {
                                        node: v,
                                        x_css: x + off,
                                        y_css: y,
                                        w_css: 0.0,
                                        h_css: room,
                                        flags: 1,
                                    }
                                } else {
                                    HierarchyLabel {
                                        node: v,
                                        x_css: x - off,
                                        y_css: y,
                                        w_css: 0.0,
                                        h_css: room,
                                        flags: -1,
                                    }
                                }
                            }
                            TreeOrient::TopBottom | TreeOrient::BottomTop => {
                                let tb = self.opts.orient == TreeOrient::TopBottom;
                                if leafish {
                                    // Vertical text running away from the root
                                    let room =
                                        if tb { t + h - y - off } else { y - t - off }.max(24.0);
                                    if tb {
                                        HierarchyLabel {
                                            node: v,
                                            x_css: x,
                                            y_css: y + off,
                                            w_css: std::f32::consts::FRAC_PI_2,
                                            h_css: room,
                                            flags: 1,
                                        }
                                    } else {
                                        HierarchyLabel {
                                            node: v,
                                            x_css: x,
                                            y_css: y - off,
                                            w_css: -std::f32::consts::FRAC_PI_2,
                                            h_css: room,
                                            flags: 1,
                                        }
                                    }
                                } else {
                                    let dy = off + 0.5 * line;
                                    let room = lw.min(inner.max(48.0)).max(24.0);
                                    HierarchyLabel {
                                        node: v,
                                        x_css: x,
                                        y_css: if tb { y - dy } else { y + dy },
                                        w_css: 0.0,
                                        h_css: room,
                                        flags: 0,
                                    }
                                }
                            }
                        }
                    };
                    labels.push(label);
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

    pub(crate) fn layout_info(&self) -> HierarchyLayoutInfo {
        HierarchyLayoutInfo {
            root: self.tree.root,
            plot_css: self.plot,
            center_css: self.center,
            center_r_css: self.radius,
            hovered: None,
        }
    }

    /// Starts an animated toggle: switches `node`, keeps the old and new visible nodes drawn
    /// and stages the old layout of them into `series` / `markers` (the frame the tween starts
    /// from). False (nothing switched) before the first prepared frame.
    pub(crate) fn stage_toggle(
        &mut self,
        node: u32,
        expanded: bool,
        series: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) -> bool {
        let Some(screen) = self.screen.filter(|_| self.layout_key.is_some()) else {
            return false;
        };
        let old = self.visible.clone();
        if !self.set_expanded(node, expanded, true) {
            return false;
        }
        // Old positions, old visibility (new nodes fold onto their visible ancestor)
        let new = std::mem::replace(&mut self.visible, old);
        self.build(&screen, series, markers);
        self.visible = new;
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        view: &ChartView,
        padding: &ChartPadding,
        hovered: Option<(u32, u32)>,
        force: bool,
        overlay_dirty: bool,
        animating: bool,
        out: HierFrame,
    ) -> HierChanged {
        let mut changed = HierChanged::default();
        let Some(screen) = FlatScreen::of(view) else {
            return changed;
        };
        self.screen = Some(screen);
        if !animating {
            self.clear_ghosts();
        }
        let plot = padded_plot(css_of(view), padding);
        let key = (plot, screen.pixel_ratio, self.state_rev);
        let relayout = self.layout_key != Some(key);
        if relayout {
            self.plot = plot;
            self.layout(plot);
            self.layout_key = Some(key);
            self.outlined = None;
        }
        // Labels wait for a toggle animation to land
        let labels_changed = if self.any_ghost {
            let had = !self.labels.is_empty();
            if had {
                self.labels.clear();
                self.labels_revision = self.labels_revision.wrapping_add(1);
            }
            had
        } else if relayout || self.built.map(|b| b.2) != Some(false) {
            self.layout_labels()
        } else {
            false
        };
        let _ = labels_changed;
        let build_key = (screen, self.state_rev, self.any_ghost);
        if relayout || force || self.built != Some(build_key) {
            out.fills.clear();
            self.build(&screen, out.edges, out.markers);
            self.built = Some(build_key);
            self.outlined = None;
            changed.fills = true;
        }
        if overlay_dirty || self.outlined != Some(hovered) {
            out.overlay.clear();
            out.overlay_markers.clear();
            if let Some((0, v)) = hovered {
                self.build_overlay(&screen, v, out.overlay, out.overlay_markers);
            }
            self.outlined = Some(hovered);
            changed.overlay = true;
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Raw d3 x of a tree given as a parent list (children in input order).
    fn raw(parents: &[i32], radial: bool) -> (Tree, Vec<f64>) {
        let t = Tree::build(parents, &vec![0.0; parents.len()]).unwrap();
        let sep = |a: u32, b: u32| {
            let s = if t.parent[a as usize] == t.parent[b as usize] {
                1.0
            } else {
                2.0
            };
            if radial {
                s / t.depth[a as usize].max(1) as f64
            } else {
                s
            }
        };
        let x = tidy_layout(t.len(), t.root, &t.parent, &t.depth, |v| t.children(v), sep);
        (t, x)
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn walker_matches_d3_on_a_small_tree() {
        // R(0) -> A(1) [A1(2), A2(3)], B(4)
        let parents = [-1, 0, 1, 1, 0];
        let (t, x) = raw(&parents, false);
        let want = [0.0, -0.5, -1.0, 0.0, 0.5];
        for (v, w) in want.iter().enumerate() {
            assert!(close(x[v], *w), "node {v}: {} vs {w}", x[v]);
        }
        // d3 tree().size([7, 2]): R(4,0) A(3,1) B(5,1) A1(2,2) A2(4,2)
        let sep = |a: u32, b: u32| {
            if t.parent[a as usize] == t.parent[b as usize] {
                1.0
            } else {
                2.0
            }
        };
        let fit = tidy_fit(&x, &t.depth, 0, sep, 7.0, 2.0);
        let want = [(4.0, 0.0), (3.0, 1.0), (2.0, 2.0), (4.0, 2.0), (5.0, 1.0)];
        for (v, w) in want.iter().enumerate() {
            assert!(
                close(fit[v].0, w.0) && close(fit[v].1, w.1),
                "node {v}: {:?} vs {w:?}",
                fit[v]
            );
        }
    }

    #[test]
    fn walker_apportions_and_shifts_like_d3() {
        // R(0) -> A(1) [A1(2), A2(3), A3(4)], B(5), C(6) [C1(7), C2(8), C3(9)]: C's subtree
        // collides with A's through B's thread and is moved, B re-centered (executeShifts)
        let parents = [-1, 0, 1, 1, 1, 0, 0, 6, 6, 6];
        let (_, x) = raw(&parents, false);
        let want = [0.0, -2.0, -3.0, -2.0, -1.0, 0.0, 2.0, 1.0, 2.0, 3.0];
        for (v, w) in want.iter().enumerate() {
            assert!(close(x[v], *w), "node {v}: {} vs {w}", x[v]);
        }
    }

    #[test]
    fn walker_keeps_cousins_apart_and_parents_centered_on_big_trees() {
        // Uneven random-ish tree of 20k nodes: same-depth neighbours >= their separation, every
        // parent centered over its first and last child, linear time (no recursion)
        let n = 20_000;
        let parents: Vec<i32> = (0..n)
            .map(|i| {
                if i == 0 {
                    -1
                } else {
                    (((i as u64 * 2_654_435_761) >> 11) % i as u64) as i32
                }
            })
            .collect();
        // A 100k-deep chain (no recursion: no stack overflow) lines up at x = 0
        let chain: Vec<i32> = (0..100_000).map(|i| i - 1).collect();
        assert!(raw(&chain, false).1.iter().all(|&x| x == 0.0));
        let (t, x) = raw(&parents, false);
        assert!(t.height[t.root as usize] > 5, "uneven tree");
        let mut levels: Vec<Vec<usize>> = Vec::new();
        for v in 0..t.len() {
            let d = t.depth[v] as usize;
            if levels.len() <= d {
                levels.resize(d + 1, Vec::new());
            }
            levels[d].push(v);
        }
        for lv in &mut levels {
            lv.sort_by(|&a, &b| x[a].total_cmp(&x[b]));
            for w in lv.windows(2) {
                let need = if t.parent[w[0]] == t.parent[w[1]] {
                    1.0
                } else {
                    2.0
                };
                assert!(
                    x[w[1]] - x[w[0]] >= need - 1e-6,
                    "{} and {} overlap",
                    w[0],
                    w[1]
                );
            }
        }
        for v in 0..t.len() as u32 {
            let c = t.children(v);
            if !c.is_empty() {
                let mid = (x[c[0] as usize] + x[c[c.len() - 1] as usize]) / 2.0;
                assert!(
                    (x[v as usize] - mid).abs() < 1e-6,
                    "parent {v} not centered"
                );
            }
        }
    }

    // --- chart -------------------------------------------------------------------------

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn chart(parents: &[i32], opts: TidyTreeOptions, state: &[u8]) -> (ChartState, OrbitCamera) {
        let tree = Tree::build(parents, &vec![0.0; parents.len()]).unwrap();
        let mut chart = ChartState::new_tidy_tree(
            tree,
            opts,
            state,
            &vec![40.0; parents.len()],
            HierarchyStyle::default(),
        );
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.prepare_layers(&view(&cam));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &TidyTreeChart {
        match &chart.kind {
            ChartKind::Hierarchy(HierChart::Tree(t)) => t,
            _ => unreachable!(),
        }
    }

    /// R(0) -> A(1) [A1(2) [a(3)], A2(4)], B(5)
    const SMALL: [i32; 6] = [-1, 0, 1, 2, 1, 0];

    #[test]
    fn initial_depth_and_node_state_decide_what_is_expanded() {
        let all = TidyTreeOptions {
            initial_depth: -1,
            ..Default::default()
        };
        let (c, _) = chart(&SMALL, all, &[]);
        assert_eq!(inner(&c).visible_count(), 6);
        // Default depth 2: root and depth-1 nodes expanded, A1 collapsed (a hidden)
        let (c, _) = chart(&SMALL, TidyTreeOptions::default(), &[]);
        let t = inner(&c);
        assert_eq!(t.visible_count(), 5);
        assert!(!t.is_visible(3) && !t.expanded[2]);
        // Per-node state wins: A collapsed, A1 expanded (but under A: hidden)
        let (c, _) = chart(&SMALL, all, &[0, 2, 1]);
        let t = inner(&c);
        assert_eq!(t.visible_count(), 3);
        assert!(t.expanded[2] && !t.is_visible(2));
        // initial_depth 0: only the root
        let (c, _) = chart(
            &SMALL,
            TidyTreeOptions {
                initial_depth: 0,
                ..Default::default()
            },
            &[],
        );
        assert_eq!(inner(&c).visible_count(), 1);
    }

    #[test]
    fn orients_place_the_root_on_their_side_inside_the_plot() {
        for orient in [
            TreeOrient::LeftRight,
            TreeOrient::RightLeft,
            TreeOrient::TopBottom,
            TreeOrient::BottomTop,
        ] {
            let (c, _) = chart(
                &SMALL,
                TidyTreeOptions {
                    orient,
                    initial_depth: -1,
                    ..Default::default()
                },
                &[],
            );
            let t = inner(&c);
            let [l, top, w, h] = t.plot;
            for v in 0..6 {
                let (x, y) = t.pos[v];
                assert!(
                    x >= l - 0.01 && x <= l + w + 0.01 && y >= top - 0.01 && y <= top + h + 0.01,
                    "{orient:?} node {v} at {x},{y}"
                );
            }
            let (r, a, leaf) = (t.pos[0], t.pos[1], t.pos[3]);
            match orient {
                TreeOrient::LeftRight => assert!(r.0 < a.0 && a.0 < leaf.0),
                TreeOrient::RightLeft => assert!(r.0 > a.0 && a.0 > leaf.0),
                TreeOrient::TopBottom => assert!(r.1 < a.1 && a.1 < leaf.1),
                TreeOrient::BottomTop => assert!(r.1 > a.1 && a.1 > leaf.1),
            }
            // Siblings A / B share the depth coordinate, d3 order along the breadth
            let b = t.pos[5];
            if orient.horizontal() {
                assert!((a.0 - b.0).abs() < 1e-3 && a.1 < b.1);
            } else {
                assert!((a.1 - b.1).abs() < 1e-3 && a.0 < b.0);
            }
            // Leaf labels away from the root (room left for them), parents toward it
            let lab = |v: u32| t.labels.iter().find(|l| l.node == v).copied().unwrap();
            if orient == TreeOrient::LeftRight {
                assert!(lab(3).x_css > leaf.0 && lab(3).flags == 1);
                assert!(lab(1).x_css < a.0 && lab(1).flags == -1);
                assert!(leaf.0 + 40.0 <= l + w + 0.5, "leaf label room");
            }
            if orient == TreeOrient::TopBottom {
                assert!(
                    lab(3).y_css > leaf.1
                        && (lab(3).w_css - std::f32::consts::FRAC_PI_2).abs() < 1e-6
                );
            }
        }
    }

    #[test]
    fn radial_layout_starts_at_twelve_and_runs_clockwise() {
        // Root with 4 leaves
        let parents = [-1, 0, 0, 0, 0];
        let (c, _) = chart(
            &parents,
            TidyTreeOptions {
                layout: TreeLayout::Radial,
                ..Default::default()
            },
            &[],
        );
        let t = inner(&c);
        assert!((t.pos[0].0 - t.center.0).abs() < 1e-3 && (t.pos[0].1 - t.center.1).abs() < 1e-3);
        let rad: Vec<f32> = (1..5).map(|v| t.polar[v].1).collect();
        assert!(rad.iter().all(|r| (r - t.radius).abs() < 1e-3), "{rad:?}");
        // Equal angular steps (siblings 1 apart, half a step of margin each side): 45, 135, ...
        let ang: Vec<f32> = (1..5).map(|v| t.polar[v].0.to_degrees()).collect();
        for (k, a) in ang.iter().enumerate() {
            assert!((a - (45.0 + 90.0 * k as f32)).abs() < 1e-3, "{ang:?}");
        }
        // 45 degrees: up-right of the center (CSS y down)
        let p = t.pos[1];
        assert!(p.0 > t.center.0 && p.1 < t.center.1);
        // Labels along the radius: right half outward from the anchor, left half flipped
        let lab = |v: u32| t.labels.iter().find(|l| l.node == v).copied().unwrap();
        assert_eq!((lab(1).flags, lab(4).flags), (1, -1));
        assert!((lab(1).w_css - (45.0f32 - 90.0).to_radians()).abs() < 1e-4);
    }

    #[test]
    fn edges_are_fixed_count_curves_or_elbows() {
        let all = TidyTreeOptions {
            initial_depth: -1,
            ..Default::default()
        };
        let (c, _) = chart(&SMALL, all, &[]);
        assert_eq!(c.series.len(), 5 * TREE_CURVE_SEGMENTS);
        assert_eq!(c.styled.markers.len(), 6);
        // Curve tangents leave the parent along the depth axis (LR: horizontally)
        let s = c.series[0];
        assert!((s.p0_width[1] - s.p1_pad[1]).abs() < 0.2 * (s.p0_width[0] - s.p1_pad[0]).abs());
        let (c, _) = chart(
            &SMALL,
            TidyTreeOptions {
                edge_shape: TreeEdgeShape::Polyline,
                ..all
            },
            &[],
        );
        assert_eq!(c.series.len(), 5 * 3);
        // Elbow: horizontal, vertical, horizontal
        let e = &c.series[0..3];
        assert!((e[0].p0_width[1] - e[0].p1_pad[1]).abs() < 1e-3);
        assert!((e[1].p0_width[0] - e[1].p1_pad[0]).abs() < 1e-3);
        // Radial polyline falls back to curves
        let (c, _) = chart(
            &SMALL,
            TidyTreeOptions {
                layout: TreeLayout::Radial,
                edge_shape: TreeEdgeShape::Polyline,
                ..all
            },
            &[],
        );
        assert_eq!(c.series.len(), 5 * TREE_CURVE_SEGMENTS);
    }

    #[test]
    fn collapsed_parents_get_filled_symbols() {
        let (c, _) = chart(&SMALL, TidyTreeOptions::default(), &[]);
        let t = inner(&c);
        // Drawn in preorder: R, A, A1 (collapsed), A2, B
        let fills: Vec<[f32; 4]> = c.styled.markers.iter().map(|m| m.fill).collect();
        assert_eq!(fills.len(), 5);
        assert_eq!(fills[0], t.style.surface, "expanded: hollow");
        assert_eq!(fills[2], t.colors[2], "collapsed with children: filled");
        assert_eq!(fills[3], t.style.surface, "leaf: hollow");
    }

    #[test]
    fn toggling_relayouts_and_hover_finds_nodes() {
        let (mut c, cam) = chart(&SMALL, TidyTreeOptions::default(), &[]);
        assert!(c.set_tree_node_expanded(2, true));
        assert!(!c.set_tree_node_expanded(2, true), "unchanged");
        assert!(!c.set_tree_node_expanded(3, false), "leaves do not toggle");
        c.prepare_layers(&view(&cam));
        assert_eq!(inner(&c).visible_count(), 6);
        assert_eq!(c.styled.markers.len(), 6);
        assert!(c.toggle_tree_node(1));
        c.prepare_layers(&view(&cam));
        assert_eq!(inner(&c).visible_count(), 3);
        assert_eq!(c.series.len(), 2 * TREE_CURVE_SEGMENTS);
        assert!(!c.set_tree_node_expanded(2, false), "hidden nodes do not toggle");

        // Hover the node under the pointer (node 1 = A, collapsed)
        let t = inner(&c);
        let screen = FlatScreen::of(&view(&cam)).unwrap();
        let (x, y) = t.pos[1];
        let (wx, wy) = screen.world(x + 2.0, y - 1.0);
        let ndc = cam.project_to_ndc(Vec3::new(wx, wy, 0.0)).unwrap();
        let mut scene = SceneWorld::new();
        let hit = c
            .hover_at(&view(&cam), &mut scene, (ndc.x, ndc.y))
            .expect("hover");
        assert_eq!(hit.items[0].index, 1);
        c.prepare_layers(&view(&cam));
        assert!(
            !c.overlay.is_empty() && c.markers.len() == 1,
            "path + enlarged symbol"
        );
        // Far away from every node: nothing
        assert!(inner(&c).node_at(-500.0, -500.0).is_none());
    }

    #[test]
    fn animated_toggles_tween_the_union_of_old_and_new_nodes() {
        let (mut c, cam) = chart(
            &SMALL,
            TidyTreeOptions {
                initial_depth: -1,
                ..Default::default()
            },
            &[],
        );
        c.set_animation(AnimationOptions::new(300.0, Easing::Linear));
        c.arm_animation(AnimationOptions::new(300.0, Easing::Linear), None);
        c.prepare_layers(&view(&cam));
        c.finish_animation();
        c.prepare_layers(&view(&cam));
        let before = (c.series.len(), c.styled.markers.len());
        assert!(c.toggle_tree_node(1), "collapse A");
        assert!(c.is_animating());
        c.animation_tick(0.0);
        c.prepare_layers(&view(&cam));
        // Same counts as before (hidden nodes folded into A at zero alpha), labels wait
        assert_eq!((c.series.len(), c.styled.markers.len()), before);
        assert!(c.anim_is_update());
        assert!(inner(&c).labels.is_empty());
        let hidden = c.styled.markers[2];
        let a = c.styled.markers[1];
        assert_eq!(hidden.fill[3], 0.0);
        assert_eq!(&hidden.center_radius[..2], &a.center_radius[..2]);
        // Landed: ghosts dropped, labels back
        c.animation_tick(1000.0);
        c.prepare_layers(&view(&cam));
        assert_eq!(c.styled.markers.len(), 3);
        assert!(!inner(&c).labels.is_empty());
    }

    #[test]
    fn svg_export_draws_edges_and_symbols() {
        let (c, cam) = chart(&SMALL, TidyTreeOptions { initial_depth: -1, ..Default::default() }, &[]);
        let svg = c.export_svg(&view(&cam), 0, "tree");
        assert_eq!(svg.support, SvgSupport::Vector);
        assert_eq!(svg.marks, 5 * TREE_CURVE_SEGMENTS + 6);
        assert!(svg.markup.contains("<circle"), "node symbols");
    }

    #[test]
    fn labels_thin_out_where_neighbours_would_overlap() {
        // 400 leaves under one root in 900 px: at most one label per line height
        let parents: Vec<i32> = (0..401).map(|i| if i == 0 { -1 } else { 0 }).collect();
        let (c, _) = chart(&parents, TidyTreeOptions::default(), &[]);
        let t = inner(&c);
        let mut ys: Vec<f32> = t
            .labels
            .iter()
            .filter(|l| l.node != 0)
            .map(|l| l.y_css)
            .collect();
        ys.sort_by(f32::total_cmp);
        assert!(ys.len() > 20 && ys.len() < 400);
        assert!(ys.windows(2).all(|w| w[1] - w[0] >= 14.0 - 1e-3));
    }
}
