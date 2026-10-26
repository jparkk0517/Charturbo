//! Sankey diagram: d3-sankey style layout, ribbon tessellation and hit-testing in Rust.
//!
//! Nodes get columns by longest path from the sources (aligned left / right / justified /
//! centered, or given explicitly); a node's value is the larger of its inflow and outflow. The
//! vertical layout follows d3-sankey: breadths scale by value (`ky` = the tightest column),
//! then `iterations` rounds of relaxation move every node toward the value-weighted position of
//! its links (right-to-left, then left-to-right, alpha decaying 0.99^i), each column followed
//! by collision resolution with the node padding; the last round resolves fully, so nodes in a
//! column never overlap. Link orders at every node are re-sorted by the far end's position
//! after each pass (O(L log L)), and the attach offsets are prefix sums, so a round is O(N + L)
//! plus the sorts even with hub nodes.
//!
//! Links are cubic bezier ribbons (horizontal tangents at both ends, width = value * ky),
//! tessellated into quad strips whose segment count follows the on-screen length, translucent,
//! widest first so thin flows stay visible on top. Hover tests nodes (column, then rect), then
//! links (solve x(t) = x, compare the band at t) from the top-most ribbon down; the hovered node
//! / link and its connected flows stay bright while the rest fade. Cycles are rejected.

use super::*;
use super::hierarchy::*;

/// Default node bar width / vertical padding (CSS px), relaxation rounds and link opacity.
pub const DEFAULT_SANKEY_NODE_WIDTH: f32 = 12.0;
pub const DEFAULT_SANKEY_NODE_PADDING: f32 = 10.0;
pub const DEFAULT_SANKEY_ITERATIONS: u32 = 32;
pub const DEFAULT_SANKEY_LINK_OPACITY: f32 = 0.5;
/// Label gap from the node bar (CSS px).
const LABEL_GAP_PX: f32 = 6.0;
/// Hover: connected links brighten by this much alpha; the rest keep this share of it.
const LINK_HOVER_BOOST: f32 = 0.35;
const LINK_HOVER_DIM: f32 = 0.3;
/// Hover: unconnected nodes mix this far toward the surface.
const NODE_FADE: f32 = 0.6;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SankeyAlign {
    /// Sources left, sinks in the last column (d3 `sankeyJustify`)
    #[default]
    Justify,
    Left,
    Right,
    Center,
}

impl SankeyAlign {
    /// 0 = justify, 1 = left, 2 = right, 3 = center
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Left,
            2 => Self::Right,
            3 => Self::Center,
            _ => Self::Justify,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SankeyLinkColor {
    /// Source node color
    #[default]
    Source,
    Target,
    /// Neutral (style `other_color`)
    Neutral,
}

impl SankeyLinkColor {
    /// 0 = source, 1 = target, 2 = neutral
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Target,
            2 => Self::Neutral,
            _ => Self::Source,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SankeyOptions {
    pub node_width_px: f32,
    pub node_padding_px: f32,
    pub iterations: u32,
    pub align: SankeyAlign,
    pub link_color: SankeyLinkColor,
    pub link_opacity: f32,
    pub labels: bool,
    /// Label line height (CSS px): labels in a column keep this far apart
    pub label_line_px: f32,
}

impl Default for SankeyOptions {
    fn default() -> Self {
        Self {
            node_width_px: DEFAULT_SANKEY_NODE_WIDTH,
            node_padding_px: DEFAULT_SANKEY_NODE_PADDING,
            iterations: DEFAULT_SANKEY_ITERATIONS,
            align: SankeyAlign::Justify,
            link_color: SankeyLinkColor::Source,
            link_opacity: DEFAULT_SANKEY_LINK_OPACITY,
            labels: true,
            label_line_px: 14.0,
        }
    }
}

/// Flow input: nodes `0..node_count`, links `sources[i] -> targets[i]` carrying `values[i]`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct SankeyGraph {
    pub node_count: usize,
    pub sources: Vec<u32>,
    pub targets: Vec<u32>,
    pub values: Vec<f64>,
    /// Explicit column per node (`< 0` = computed); empty = all computed
    pub columns: Vec<i32>,
    /// Color group per node (`< 0` = none); empty = no groups
    pub groups: Vec<i32>,
}

/// Laid-out node (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SankeyNode {
    pub value: f64,
    pub layer: u32,
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
}

/// Laid-out link: ribbon `width` CSS px, centered at `y0` on the source and `y1` on the target.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SankeyLink {
    pub source: u32,
    pub target: u32,
    pub value: f64,
    pub width: f32,
    pub y0: f32,
    pub y1: f32,
}

/// Validates indices, values (finite, >= 0), explicit columns (targets in later columns) and
/// rejects cycles, naming the node chain.
pub fn validate_sankey(g: &SankeyGraph) -> Result<(), String> {
    let n = g.node_count;
    let l = g.sources.len();
    if g.targets.len() != l || g.values.len() != l {
        return Err(format!("sankey has {l} sources, {} targets and {} values", g.targets.len(), g.values.len()));
    }
    if !g.columns.is_empty() && g.columns.len() != n {
        return Err(format!("sankey has {n} nodes but {} columns", g.columns.len()));
    }
    for i in 0..l {
        let (s, t, v) = (g.sources[i], g.targets[i], g.values[i]);
        if s as usize >= n || t as usize >= n {
            return Err(format!("link {i} connects node {s} to node {t} (nodes are 0..{n})"));
        }
        if !v.is_finite() || v < 0.0 {
            return Err(format!("link {i} value is {v} (values must be finite and >= 0)"));
        }
        if s == t {
            return Err(format!("sankey links form a cycle: node {s} -> node {s}"));
        }
        if let (Some(&cs), Some(&ct)) = (g.columns.get(s as usize), g.columns.get(t as usize)) {
            if cs >= 0 && ct >= 0 && ct <= cs {
                return Err(format!("link {i} goes from column {cs} to column {ct} (targets must be in later columns)"));
            }
        }
    }
    topo_order(g).map(|_| ())
}

/// Kahn's topological order of the nodes, or the cycle message.
fn topo_order(g: &SankeyGraph) -> Result<Vec<u32>, String> {
    let n = g.node_count;
    let (out_start, out) = csr(n, &g.sources, None);
    let mut indeg = vec![0u32; n];
    for &t in &g.targets {
        indeg[t as usize] += 1;
    }
    let mut order: Vec<u32> = (0..n as u32).filter(|&v| indeg[v as usize] == 0).collect();
    let mut head = 0;
    while head < order.len() {
        let v = order[head] as usize;
        head += 1;
        for &l in &out[out_start[v] as usize..out_start[v + 1] as usize] {
            let t = g.targets[l as usize] as usize;
            indeg[t] -= 1;
            if indeg[t] == 0 {
                order.push(t as u32);
            }
        }
    }
    if order.len() == n {
        return Ok(order);
    }
    // Every remaining node has a remaining predecessor: walk back until a node repeats
    let (in_start, inl) = csr(n, &g.targets, None);
    let mut v = (0..n).find(|&v| indeg[v] > 0).unwrap_or(0);
    let mut seen = vec![usize::MAX; n];
    let mut chain = Vec::new();
    while seen[v] == usize::MAX {
        seen[v] = chain.len();
        chain.push(v);
        let pred = inl[in_start[v] as usize..in_start[v + 1] as usize]
            .iter()
            .map(|&l| g.sources[l as usize] as usize)
            .find(|&s| indeg[s] > 0);
        match pred {
            Some(s) => v = s,
            None => break,
        }
    }
    let mut cyc: Vec<usize> = chain[seen[v].min(chain.len() - 1)..].to_vec();
    cyc.reverse();
    cyc.push(cyc[0]);
    let text: Vec<String> = cyc.iter().map(|i| format!("node {i}")).collect();
    Err(format!("sankey links form a cycle: {}", text.join(" -> ")))
}

/// Link ids grouped by `ends[l]` (CSR), optionally only links with `keep[l]`.
fn csr(n: usize, ends: &[u32], keep: Option<&[bool]>) -> (Vec<u32>, Vec<u32>) {
    let mut start = vec![0u32; n + 1];
    for (l, &e) in ends.iter().enumerate() {
        if keep.is_none_or(|k| k[l]) {
            start[e as usize + 1] += 1;
        }
    }
    for i in 0..n {
        start[i + 1] += start[i];
    }
    let mut fill = start.clone();
    let mut ids = vec![0u32; start[n] as usize];
    for (l, &e) in ends.iter().enumerate() {
        if keep.is_none_or(|k| k[l]) {
            ids[fill[e as usize] as usize] = l as u32;
            fill[e as usize] += 1;
        }
    }
    (start, ids)
}

#[derive(Debug, Clone)]
pub struct SankeyChart {
    graph: SankeyGraph,
    opts: SankeyOptions,
    style: HierarchyStyle,
    pub(crate) colors: Vec<[f32; 4]>,
    /// Links per node (CSR), re-sorted by the far end's position during layout
    out_start: Vec<u32>,
    out: Vec<u32>,
    in_start: Vec<u32>,
    inl: Vec<u32>,
    layer: Vec<u32>,
    layers: u32,
    nodes: Vec<SankeyNode>,
    links: Vec<SankeyLink>,
    /// Links widest first (drawing order)
    order: Vec<u32>,
    /// Plot rect the layout was computed for
    layout_key: Option<[f32; 4]>,
    plot: [f32; 4],
    screen: Option<FlatScreen>,
    /// Screen the geometry was built for, and the hover it was colored for
    built: Option<FlatScreen>,
    lit_for: Option<Option<(u32, u32)>>,
    /// Vertex range per link and first node vertex in the built fills
    link_ranges: Vec<(u32, u32)>,
    node_start: u32,
    pub(crate) labels: Vec<HierarchyLabel>,
    pub(crate) labels_revision: u32,
}

impl SankeyChart {
    /// Builds from a validated graph (see `validate_sankey`).
    pub(crate) fn new(graph: SankeyGraph, mut opts: SankeyOptions, style: HierarchyStyle) -> Self {
        let d = SankeyOptions::default();
        let clean = |v: f32, d: f32, max: f32| if v.is_finite() && v >= 0.0 { v.min(max) } else { d };
        opts.node_width_px = clean(opts.node_width_px, d.node_width_px, 200.0).max(1.0);
        opts.node_padding_px = clean(opts.node_padding_px, d.node_padding_px, 200.0);
        opts.link_opacity = clean(opts.link_opacity, d.link_opacity, 1.0);
        opts.label_line_px = clean(opts.label_line_px, d.label_line_px, 100.0).max(1.0);
        opts.iterations = opts.iterations.min(1000);
        let n = graph.node_count;
        let (out_start, out) = csr(n, &graph.sources, None);
        let (in_start, inl) = csr(n, &graph.targets, None);
        let mut s = Self {
            graph,
            opts,
            style,
            colors: Vec::new(),
            out_start,
            out,
            in_start,
            inl,
            layer: vec![0; n],
            layers: 1,
            nodes: Vec::new(),
            links: Vec::new(),
            order: Vec::new(),
            layout_key: None,
            plot: [0.0; 4],
            screen: None,
            built: None,
            lit_for: None,
            link_ranges: Vec::new(),
            node_start: 0,
            labels: Vec::new(),
            labels_revision: 0,
        };
        s.compute_layers();
        s.assign_colors();
        s
    }

    pub fn node_count(&self) -> usize {
        self.graph.node_count
    }

    pub fn link_count(&self) -> usize {
        self.graph.sources.len()
    }

    /// Laid-out nodes of the last frame (empty before the first one).
    pub fn nodes(&self) -> &[SankeyNode] {
        &self.nodes
    }

    pub fn links(&self) -> &[SankeyLink] {
        &self.links
    }

    /// Node values (larger of inflow and outflow), independent of the layout.
    pub fn node_values(&self) -> Vec<f64> {
        (0..self.graph.node_count).map(|v| self.node_value(v)).collect()
    }

    /// `(inflow, outflow)` per node.
    pub fn node_flows(&self) -> Vec<(f64, f64)> {
        let sum = |ls: &[u32]| ls.iter().map(|&l| self.graph.values[l as usize]).sum::<f64>();
        (0..self.graph.node_count).map(|v| (sum(self.ins(v)), sum(self.outs(v)))).collect()
    }

    /// Column per node (known before the first frame).
    pub fn node_layers(&self) -> &[u32] {
        &self.layer
    }

    /// `(source, target, value, percent of the source's value)` per link.
    pub fn link_shares(&self) -> Vec<(u32, u32, f64, f64)> {
        let values = self.node_values();
        (0..self.link_count())
            .map(|l| {
                let (s, v) = (self.graph.sources[l], self.graph.values[l]);
                let total = values[s as usize];
                (s, self.graph.targets[l], v, if total > 0.0 { v / total * 100.0 } else { f64::NAN })
            })
            .collect()
    }

    /// Column count.
    pub fn layers(&self) -> u32 {
        self.layers
    }

    fn outs(&self, v: usize) -> &[u32] {
        &self.out[self.out_start[v] as usize..self.out_start[v + 1] as usize]
    }

    fn ins(&self, v: usize) -> &[u32] {
        &self.inl[self.in_start[v] as usize..self.in_start[v + 1] as usize]
    }

    /// Node value: the larger of inflow and outflow.
    fn node_value(&self, v: usize) -> f64 {
        let sum = |ls: &[u32]| ls.iter().map(|&l| self.graph.values[l as usize]).sum::<f64>();
        sum(self.ins(v)).max(sum(self.outs(v)))
    }

    /// Columns from the longest paths (depth from sources, height to sinks) and the alignment;
    /// explicit columns win.
    fn compute_layers(&mut self) {
        let n = self.graph.node_count;
        let order = topo_order(&self.graph).unwrap_or_else(|_| (0..n as u32).collect());
        let mut depth = vec![0u32; n];
        for &v in &order {
            for &l in self.outs(v as usize) {
                let t = self.graph.targets[l as usize] as usize;
                depth[t] = depth[t].max(depth[v as usize] + 1);
            }
        }
        let mut height = vec![0u32; n];
        for &v in order.iter().rev() {
            for &l in self.ins(v as usize) {
                let s = self.graph.sources[l as usize] as usize;
                height[s] = height[s].max(height[v as usize] + 1);
            }
        }
        let max_depth = depth.iter().copied().max().unwrap_or(0);
        for v in 0..n {
            let (has_in, has_out) = (!self.ins(v).is_empty(), !self.outs(v).is_empty());
            self.layer[v] = match self.opts.align {
                SankeyAlign::Left => depth[v],
                SankeyAlign::Right => max_depth - height[v],
                SankeyAlign::Justify => if has_out { depth[v] } else { max_depth },
                SankeyAlign::Center => {
                    if has_in {
                        depth[v]
                    } else if has_out {
                        self.outs(v).iter().map(|&l| depth[self.graph.targets[l as usize] as usize]).min().unwrap_or(1).saturating_sub(1)
                    } else {
                        0
                    }
                }
            };
            if let Some(&c) = self.graph.columns.get(v) {
                if c >= 0 {
                    self.layer[v] = c as u32;
                }
            }
        }
        if !self.graph.columns.is_empty() {
            // Explicit columns are minimums: a node sits right of every source (topological
            // order), so no link runs backward even when explicit and computed columns mix
            for &v in &order {
                let after = self.ins(v as usize).iter().map(|&l| self.layer[self.graph.sources[l as usize] as usize] + 1).max();
                if let Some(min) = after {
                    self.layer[v as usize] = self.layer[v as usize].max(min);
                }
            }
            // Dense ranks of the used columns: huge explicit indices cost nothing
            let mut used: Vec<u32> = self.layer.clone();
            used.sort_unstable();
            used.dedup();
            for l in &mut self.layer {
                *l = used.partition_point(|&u| u < *l) as u32;
            }
        }
        self.layers = self.layer.iter().copied().max().unwrap_or(0) + 1;
    }

    /// Node colors: by group when groups are given, else per node when the palette has room,
    /// else per column; beyond the palette the neutral "Other". Overrides win.
    fn assign_colors(&mut self) {
        let n = self.graph.node_count;
        let pal = &self.style.palette;
        let gray = self.style.other_color;
        let pick = |k: usize| if k < pal.len() { pal[k] } else { gray };
        let any_group = self.graph.groups.iter().any(|&g| g >= 0);
        self.colors = (0..n)
            .map(|v| {
                if let Some(Some(c)) = self.style.colors.get(v) {
                    return *c;
                }
                if any_group {
                    match self.graph.groups.get(v) {
                        Some(&g) if g >= 0 => pick(g as usize),
                        _ => gray,
                    }
                } else if n <= pal.len() {
                    pick(v)
                } else {
                    pick(self.layer[v] as usize)
                }
            })
            .collect();
        self.lit_for = None;
    }

    pub(crate) fn set_style(&mut self, style: HierarchyStyle) {
        self.style = style;
        self.assign_colors();
    }

    /// d3-sankey layout into `plot` (CSS px).
    fn layout(&mut self, plot: [f32; 4]) {
        let n = self.graph.node_count;
        let [left, top, w, h] = plot;
        let nw = self.opts.node_width_px.min(w.max(1.0));
        let cols = self.layers.max(1);
        let mut columns: Vec<Vec<u32>> = vec![Vec::new(); cols as usize];
        for v in 0..n {
            columns[self.layer[v] as usize].push(v as u32);
        }
        let step = if cols > 1 { (w - nw) / (cols - 1) as f32 } else { 0.0 };
        let x_of = |layer: u32| if cols > 1 { left + layer as f32 * step } else { left + 0.5 * (w - nw) };
        self.nodes = (0..n)
            .map(|v| {
                let x0 = x_of(self.layer[v]);
                SankeyNode { value: self.node_value(v), layer: self.layer[v], x0, y0: top, x1: x0 + nw, y1: top }
            })
            .collect();
        // Padding: at most half the height of the fullest column goes to gaps
        let max_len = columns.iter().map(|c| c.len()).max().unwrap_or(1);
        let py = if max_len > 1 { self.opts.node_padding_px.min(0.5 * h / (max_len - 1) as f32) } else { self.opts.node_padding_px };
        let ky = columns
            .iter()
            .filter_map(|c| {
                let sum: f64 = c.iter().map(|&v| self.nodes[v as usize].value).sum();
                (sum > 0.0).then(|| (h as f64 - (c.len().saturating_sub(1)) as f64 * py as f64) / sum)
            })
            .fold(f64::INFINITY, f64::min);
        let ky = if ky.is_finite() { ky.max(0.0) } else { 0.0 };
        for c in &columns {
            let mut y = top;
            for &v in c {
                let node = &mut self.nodes[v as usize];
                node.y0 = y;
                node.y1 = y + (node.value * ky) as f32;
                y = node.y1 + py;
            }
        }
        self.links = (0..self.link_count())
            .map(|l| SankeyLink {
                source: self.graph.sources[l],
                target: self.graph.targets[l],
                value: self.graph.values[l],
                width: (self.graph.values[l] * ky) as f32,
                y0: 0.0,
                y1: 0.0,
            })
            .collect();
        self.reorder_links();
        let iters = self.opts.iterations;
        for i in 0..iters {
            let alpha = 0.99f32.powi(i as i32);
            let beta = (1.0 - alpha).max((i + 1) as f32 / iters as f32);
            self.relax(&mut columns, alpha, beta, py, (top, top + h), false);
            self.relax(&mut columns, alpha, beta, py, (top, top + h), true);
        }
        if iters == 0 {
            for c in &mut columns {
                self.resolve_collisions(c, py, (top, top + h), 1.0);
            }
            self.reorder_links();
        }
        // Link attach points: stacked in each node's (sorted) link order
        for v in 0..n {
            let mut y = self.nodes[v].y0;
            for k in self.out_start[v]..self.out_start[v + 1] {
                let l = self.out[k as usize] as usize;
                self.links[l].y0 = y + 0.5 * self.links[l].width;
                y += self.links[l].width;
            }
            let mut y = self.nodes[v].y0;
            for k in self.in_start[v]..self.in_start[v + 1] {
                let l = self.inl[k as usize] as usize;
                self.links[l].y1 = y + 0.5 * self.links[l].width;
                y += self.links[l].width;
            }
        }
        self.order = (0..self.link_count() as u32).collect();
        self.order.sort_by(|a, b| self.links[*b as usize].width.total_cmp(&self.links[*a as usize].width).then(a.cmp(b)));
    }

    /// Sorts every node's links by the far end's top (ties: link id).
    fn reorder_links(&mut self) {
        let nodes = &self.nodes;
        let g = &self.graph;
        for v in 0..g.node_count {
            let (a, b) = (self.out_start[v] as usize, self.out_start[v + 1] as usize);
            self.out[a..b].sort_by(|x, y| {
                let (tx, ty) = (g.targets[*x as usize] as usize, g.targets[*y as usize] as usize);
                nodes[tx].y0.total_cmp(&nodes[ty].y0).then(x.cmp(y))
            });
            let (a, b) = (self.in_start[v] as usize, self.in_start[v + 1] as usize);
            self.inl[a..b].sort_by(|x, y| {
                let (sx, sy) = (g.sources[*x as usize] as usize, g.sources[*y as usize] as usize);
                nodes[sx].y0.total_cmp(&nodes[sy].y0).then(x.cmp(y))
            });
        }
    }

    /// One relaxation pass: `ltr` moves targets toward their sources (columns 1..), else sources
    /// toward their targets (last-but-one column down to 0); each column then resolves
    /// collisions with strength `beta`.
    fn relax(&mut self, columns: &mut [Vec<u32>], alpha: f32, beta: f32, py: f32, extent: (f32, f32), ltr: bool) {
        let n = self.graph.node_count;
        let nl = self.link_count();
        // Attach offsets (prefix sums in the current link orders): `out_off[l]` = room taken by
        // the source's earlier outgoing links (+ padding, d3-style spread), `in_off[l]` = width
        // of the target's earlier incoming links; and the mirror pair for the other direction
        let mut out_off = vec![0.0f32; nl];
        let mut in_off = vec![0.0f32; nl];
        let mut out_w = vec![0.0f32; nl];
        let mut in_w = vec![0.0f32; nl];
        for v in 0..n {
            let (mut a, mut aw) = (0.0f32, 0.0f32);
            for &l in self.outs(v) {
                out_off[l as usize] = a;
                out_w[l as usize] = aw;
                a += self.links[l as usize].width + py;
                aw += self.links[l as usize].width;
            }
            let (mut b, mut bw) = (0.0f32, 0.0f32);
            for &l in self.ins(v) {
                in_off[l as usize] = b;
                in_w[l as usize] = bw;
                b += self.links[l as usize].width + py;
                bw += self.links[l as usize].width;
            }
        }
        let cols = columns.len();
        let range: Vec<usize> = if ltr { (1..cols).collect() } else { (0..cols.saturating_sub(1)).rev().collect() };
        for c in range {
            for &v in &columns[c] {
                let v = v as usize;
                let (mut y, mut wsum) = (0.0f64, 0.0f64);
                let links = if ltr { self.ins(v) } else { self.outs(v) };
                for &l in links {
                    let link = &self.links[l as usize];
                    let (s, t) = (link.source as usize, link.target as usize);
                    let span = (self.layer[t] as f64 - self.layer[s] as f64).max(1.0);
                    let wgt = link.value * span;
                    // Where this node's top would line the link up with its far end
                    let want = if ltr {
                        self.nodes[s].y0 - ((self.out_start[s + 1] - self.out_start[s]) as f32 - 1.0) * py * 0.5 + out_off[l as usize] - in_w[l as usize]
                    } else {
                        self.nodes[t].y0 - ((self.in_start[t + 1] - self.in_start[t]) as f32 - 1.0) * py * 0.5 + in_off[l as usize] - out_w[l as usize]
                    };
                    y += want as f64 * wgt;
                    wsum += wgt;
                }
                if wsum > 0.0 {
                    let dy = ((y / wsum) as f32 - self.nodes[v].y0) * alpha;
                    self.nodes[v].y0 += dy;
                    self.nodes[v].y1 += dy;
                }
            }
            let nodes = &self.nodes;
            columns[c].sort_by(|a, b| nodes[*a as usize].y0.total_cmp(&nodes[*b as usize].y0).then(a.cmp(b)));
            let col = std::mem::take(&mut columns[c]);
            self.resolve_collisions(&col, py, extent, beta);
            columns[c] = col;
        }
        self.reorder_links();
    }

    /// d3-sankey collision resolution of a column sorted by top: push apart from the middle
    /// node outward, then back inside the extent (`alpha` = 1 resolves fully).
    fn resolve_collisions(&mut self, col: &[u32], py: f32, extent: (f32, f32), alpha: f32) {
        if col.is_empty() {
            return;
        }
        let nodes = &mut self.nodes;
        let down = |from: usize, mut y: f32, nodes: &mut Vec<SankeyNode>| {
            for &v in &col[from..] {
                let node = &mut nodes[v as usize];
                let dy = (y - node.y0) * alpha;
                if dy > 1e-6 {
                    node.y0 += dy;
                    node.y1 += dy;
                }
                y = node.y1 + py;
            }
        };
        let up = |to: usize, mut y: f32, nodes: &mut Vec<SankeyNode>| {
            for &v in col[..=to].iter().rev() {
                let node = &mut nodes[v as usize];
                let dy = (node.y1 - y) * alpha;
                if dy > 1e-6 {
                    node.y0 -= dy;
                    node.y1 -= dy;
                }
                y = node.y0 - py;
            }
        };
        let i = col.len() >> 1;
        let subject = nodes[col[i] as usize];
        if i > 0 {
            up(i - 1, subject.y0 - py, nodes);
        }
        down(i + 1, subject.y1 + py, nodes);
        up(col.len() - 1, extent.1, nodes);
        down(0, extent.0, nodes);
    }

    /// Ribbon geometry of link `l` in CSS px: `(x0, x1, top at source, top at target, width)`.
    fn ribbon(&self, l: usize) -> (f32, f32, f32, f32, f32) {
        let link = &self.links[l];
        let (s, t) = (&self.nodes[link.source as usize], &self.nodes[link.target as usize]);
        let w = link.width;
        (s.x1, t.x0, link.y0 - 0.5 * w, link.y1 - 0.5 * w, w)
    }

    /// Point at bezier parameter `t` of a ribbon's top edge (horizontal tangents at both ends).
    fn bezier(x0: f32, x1: f32, y0: f32, y1: f32, t: f32) -> (f32, f32) {
        let (dx, dy) = (x1 - x0, y1 - y0);
        (x0 + dx * (1.5 * t * (1.0 - t) + t * t * t), y0 + dy * t * t * (3.0 - 2.0 * t))
    }

    /// Bezier parameter whose x is `x` (x(t) is monotonic: Newton from the linear guess).
    fn t_of_x(x0: f32, x1: f32, x: f32) -> f32 {
        let dx = x1 - x0;
        if dx.abs() < 1e-6 {
            return 0.5;
        }
        let mut t = ((x - x0) / dx).clamp(0.0, 1.0);
        for _ in 0..8 {
            let f = 1.5 * t * (1.0 - t) + t * t * t - (x - x0) / dx;
            let d = 1.5 - 3.0 * t + 3.0 * t * t;
            t = (t - f / d).clamp(0.0, 1.0);
        }
        t
    }

    /// Hovered item under CSS point: nodes first, then the top-most link ribbon.
    pub(crate) fn item_at(&self, x: f32, y: f32) -> Option<(u32, u32)> {
        if self.nodes.is_empty() {
            return None;
        }
        for (v, node) in self.nodes.iter().enumerate() {
            // Nodes thinner than 3 px hover within 1.5 px of their center
            let pad = (3.0 - (node.y1 - node.y0)).max(0.0) * 0.5;
            if x >= node.x0 && x < node.x1 && y >= node.y0 - pad && y < node.y1 + pad {
                return Some((0, v as u32));
            }
        }
        for &l in self.order.iter().rev() {
            let (x0, x1, top0, top1, w) = self.ribbon(l as usize);
            if w <= 0.0 || x < x0 || x > x1 {
                continue;
            }
            let t = Self::t_of_x(x0, x1, x);
            let top = Self::bezier(x0, x1, top0, top1, t).1;
            if y >= top && y <= top + w.max(1.0) {
                return Some((1, l));
            }
        }
        None
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let screen = FlatScreen::of(view)?;
        let (x, y) = screen.css_at(view, ndc)?;
        let (series, index) = self.item_at(x, y)?;
        let (value, id) = self.item_value(series, index)?;
        Some(hover_one(series, index, value, id))
    }

    /// `(value, global id)` of a node (series 0) or link (series 1; id = node count + link).
    pub(crate) fn item_value(&self, series: u32, index: u32) -> Option<(f64, u32)> {
        match series {
            0 => (index < self.graph.node_count as u32).then(|| (self.node_value(index as usize), index)),
            1 => self.graph.values.get(index as usize).map(|&v| (v, self.graph.node_count as u32 + index)),
            _ => None,
        }
    }

    /// World center of a node, or the middle of a link ribbon.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let s = self.screen?;
        let n = self.graph.node_count as u32;
        let (series, index, (x, y)) = if global_id < n {
            let node = self.nodes.get(global_id as usize)?;
            (0, global_id, (0.5 * (node.x0 + node.x1), 0.5 * (node.y0 + node.y1)))
        } else {
            let l = (global_id - n) as usize;
            if l >= self.links.len() {
                return None;
            }
            let (x0, x1, top0, top1, w) = self.ribbon(l);
            let (x, y) = Self::bezier(x0, x1, top0, top1, 0.5);
            (1, l as u32, (x, y + 0.5 * w))
        };
        let (value, _) = self.item_value(series, index)?;
        let (wx, wy) = s.world(x, y);
        Some((series, index, value as f32, Vec3::new(wx, wy, 0.0)))
    }

    /// Nodes and links lit by a hover (all when nothing is hovered).
    fn lit(&self, hovered: Option<(u32, u32)>) -> Option<(Vec<bool>, Vec<bool>)> {
        let (series, index) = hovered?;
        let mut nodes = vec![false; self.graph.node_count];
        let mut links = vec![false; self.link_count()];
        let mut light = |l: usize, nodes: &mut Vec<bool>| {
            links[l] = true;
            nodes[self.graph.sources[l] as usize] = true;
            nodes[self.graph.targets[l] as usize] = true;
        };
        match series {
            0 => {
                let v = index as usize;
                nodes[v] = true;
                for &l in self.outs(v).iter().chain(self.ins(v)) {
                    light(l as usize, &mut nodes);
                }
            }
            _ => light(index as usize, &mut nodes),
        }
        Some((nodes, links))
    }

    /// Ribbon geometry (widest first) then node bars; vertex ranges are kept so a hover only
    /// re-colors (`recolor`).
    fn build_geometry(&mut self, screen: &FlatScreen, fills: &mut Vec<ChartFillRaw>) {
        fills.clear();
        self.link_ranges.clear();
        self.link_ranges.resize(self.link_count(), (0, 0));
        let color = [0.0; 4];
        let v = |p: (f32, f32)| ChartFillRaw { position: [p.0, p.1, 0.0, 0.0], color };
        for &l in &self.order {
            let (x0, x1, top0, top1, w) = self.ribbon(l as usize);
            let start = fills.len() as u32;
            if w > 0.0 {
                // Chords within ~0.25 px: the smoothstep's curvature peaks at 6 dy / dx^2, so
                // sqrt(3 dy) uniform steps suffice
                let n = ((3.0 * (top1 - top0).abs()).sqrt().ceil() as usize).clamp(2, 48);
                let mut prev: Option<((f32, f32), (f32, f32))> = None;
                for k in 0..=n {
                    let (x, y) = Self::bezier(x0, x1, top0, top1, k as f32 / n as f32);
                    let (a, b) = (screen.world(x, y), screen.world(x, y + w));
                    if let Some((pa, pb)) = prev {
                        fills.extend([v(pa), v(pb), v(b), v(pa), v(b), v(a)]);
                    }
                    prev = Some((a, b));
                }
            }
            self.link_ranges[l as usize] = (start, fills.len() as u32);
        }
        self.node_start = fills.len() as u32;
        for node in &self.nodes {
            // Snapped bars, at least one device pixel tall
            let (x0, x1) = (screen.snap(node.x0), screen.snap(node.x1));
            let (y0, mut y1) = (screen.snap(node.y0), screen.snap(node.y1));
            if y1 - y0 < 1.0 / screen.pixel_ratio {
                y1 = y0 + 1.0 / screen.pixel_ratio;
            }
            push_rect(screen, [x0, y0, x1 - x0, y1 - y0], color, fills);
        }
    }

    /// Colors of the built geometry with the hovered flows highlighted.
    fn recolor(&self, hovered: Option<(u32, u32)>, fills: &mut [ChartFillRaw]) {
        let lit = self.lit(hovered);
        let base_alpha = self.opts.link_opacity;
        for (l, &(a, b)) in self.link_ranges.iter().enumerate() {
            let link = &self.links[l];
            let mut color = match self.opts.link_color {
                SankeyLinkColor::Source => self.colors[link.source as usize],
                SankeyLinkColor::Target => self.colors[link.target as usize],
                SankeyLinkColor::Neutral => self.style.other_color,
            };
            color[3] = match &lit {
                Some((_, links)) if links[l] => (base_alpha + LINK_HOVER_BOOST).min(1.0),
                Some(_) => base_alpha * LINK_HOVER_DIM,
                None => base_alpha,
            };
            for f in &mut fills[a as usize..b as usize] {
                f.color = color;
            }
        }
        for v in 0..self.nodes.len() {
            let mut color = self.colors[v];
            if let Some((nodes, _)) = &lit {
                if !nodes[v] {
                    color = mix(color, self.style.surface, NODE_FADE);
                }
            }
            color[3] = 1.0;
            let at = self.node_start as usize + v * 6;
            for f in &mut fills[at..at + 6] {
                f.color = color;
            }
        }
    }

    /// Node label anchors beside the bars (right of nodes in the left half, left of the rest);
    /// within a column, larger nodes keep their label when two would be closer than a line.
    fn layout_labels(&mut self) {
        let mut labels = Vec::new();
        if self.opts.labels {
            let mid = self.plot[0] + 0.5 * self.plot[2];
            let line = self.opts.label_line_px;
            let mut by_col: Vec<Vec<u32>> = vec![Vec::new(); self.layers as usize];
            for (v, node) in self.nodes.iter().enumerate() {
                by_col[node.layer as usize].push(v as u32);
            }
            for mut col in by_col {
                col.sort_by(|a, b| self.nodes[*b as usize].value.total_cmp(&self.nodes[*a as usize].value).then(a.cmp(b)));
                let mut taken: Vec<f32> = Vec::new();
                for v in col {
                    let node = &self.nodes[v as usize];
                    let y = 0.5 * (node.y0 + node.y1);
                    let k = taken.partition_point(|&t| t < y);
                    let clear = taken.get(k).is_none_or(|&t| t - y >= line) && (k == 0 || y - taken[k - 1] >= line);
                    if !clear {
                        continue;
                    }
                    taken.insert(k, y);
                    let right = node.x0 < mid;
                    let x = if right { node.x1 + LABEL_GAP_PX } else { node.x0 - LABEL_GAP_PX };
                    labels.push(HierarchyLabel { node: v, x_css: x, y_css: y, w_css: 0.0, h_css: line, flags: if right { 1 } else { -1 } });
                }
            }
        }
        labels.sort_by_key(|l| l.node);
        if labels != self.labels {
            self.labels = labels;
            self.labels_revision = self.labels_revision.wrapping_add(1);
        }
    }

    pub(crate) fn layout_info(&self) -> HierarchyLayoutInfo {
        HierarchyLayoutInfo { root: 0, plot_css: self.plot, center_css: (0.0, 0.0), center_r_css: 0.0, hovered: None }
    }

    pub(crate) fn prepare(&mut self, view: &ChartView, padding: &ChartPadding, hovered: Option<(u32, u32)>, force: bool, out: HierFrame) -> HierChanged {
        let mut changed = HierChanged::default();
        let Some(screen) = FlatScreen::of(view) else {
            return changed;
        };
        self.screen = Some(screen);
        let plot = padded_plot(css_of(view), padding);
        let relayout = self.layout_key != Some(plot);
        if relayout {
            self.plot = plot;
            self.layout(plot);
            self.layout_key = Some(plot);
            self.layout_labels();
        }
        if relayout || force || self.built != Some(screen) {
            out.edges.clear();
            self.build_geometry(&screen, out.fills);
            self.built = Some(screen);
            self.lit_for = None;
        }
        if self.lit_for != Some(hovered) {
            self.recolor(hovered, out.fills);
            self.lit_for = Some(hovered);
            changed.fills = true;
        }
        if !out.overlay.is_empty() {
            out.overlay.clear();
            changed.overlay = true;
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn graph(n: usize, links: &[(u32, u32, f64)]) -> SankeyGraph {
        SankeyGraph {
            node_count: n,
            sources: links.iter().map(|l| l.0).collect(),
            targets: links.iter().map(|l| l.1).collect(),
            values: links.iter().map(|l| l.2).collect(),
            ..Default::default()
        }
    }

    fn sankey(g: SankeyGraph, opts: SankeyOptions) -> (ChartState, OrbitCamera) {
        validate_sankey(&g).unwrap();
        let chart = ChartState::new_sankey(g, opts, HierarchyStyle::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    /// Energy-style graph: 2 sources -> 3 middle -> 2 sinks, one skip link.
    fn sample_graph() -> SankeyGraph {
        graph(7, &[(0, 2, 10.0), (0, 3, 5.0), (1, 3, 8.0), (1, 4, 4.0), (2, 5, 9.0), (2, 6, 1.0), (3, 5, 6.0), (3, 6, 7.0), (4, 6, 4.0), (0, 6, 2.0)])
    }

    fn assert_no_overlap(s: &SankeyChart, py: f32) {
        for c in 0..s.layers {
            let mut col: Vec<&SankeyNode> = s.nodes.iter().filter(|n| n.layer == c).collect();
            col.sort_by(|a, b| a.y0.total_cmp(&b.y0));
            for w in col.windows(2) {
                assert!(w[1].y0 >= w[0].y1 + py - 1e-2, "column {c}: {:?} overlaps {:?}", w[0], w[1]);
            }
            for n in &col {
                assert!(n.y0 >= s.plot[1] - 0.05 && n.y1 <= s.plot[1] + s.plot[3] + 0.05, "inside the plot: {n:?}");
            }
        }
    }

    #[test]
    fn layers_values_and_conservation() {
        let (mut chart, cam) = sankey(sample_graph(), SankeyOptions::default());
        chart.prepare_layers(&view(&cam));
        let s = chart.sankey().unwrap();
        // Justify: sources at 0, sinks at the last column, middle by depth
        let layers: Vec<u32> = s.nodes.iter().map(|n| n.layer).collect();
        assert_eq!(layers, vec![0, 0, 1, 1, 1, 2, 2]);
        // Node value = max(inflow, outflow); flow is conserved through middle nodes
        let inflow = |v: u32| s.links.iter().filter(|l| l.target == v).map(|l| l.value).sum::<f64>();
        let outflow = |v: u32| s.links.iter().filter(|l| l.source == v).map(|l| l.value).sum::<f64>();
        for v in 2..5 {
            assert_eq!(inflow(v), outflow(v), "node {v} conserves flow");
            assert_eq!(s.nodes[v as usize].value, inflow(v));
        }
        assert_eq!(s.nodes[0].value, 17.0);
        // Breadth ∝ value (one ky for every node and link)
        let ky = (s.nodes[0].y1 - s.nodes[0].y0) / 17.0;
        for (v, n) in s.nodes.iter().enumerate() {
            assert!(((n.y1 - n.y0) - ky * n.value as f32).abs() < 1e-2, "node {v}");
        }
        for l in &s.links {
            assert!((l.width - ky * l.value as f32).abs() < 1e-3);
        }
        // Links stack exactly within their node's breadth on both ends
        for (v, n) in s.nodes.iter().enumerate() {
            let outs: Vec<&SankeyLink> = s.links.iter().filter(|l| l.source as usize == v).collect();
            let total: f32 = outs.iter().map(|l| l.width).sum();
            if !outs.is_empty() {
                let lo = outs.iter().map(|l| l.y0 - 0.5 * l.width).fold(f32::INFINITY, f32::min);
                let hi = outs.iter().map(|l| l.y0 + 0.5 * l.width).fold(f32::NEG_INFINITY, f32::max);
                assert!((lo - n.y0).abs() < 1e-2 && (hi - lo - total).abs() < 1e-2, "node {v} out links");
            }
        }
        assert_no_overlap(s, DEFAULT_SANKEY_NODE_PADDING);
        // Columns span the plot width: first at the left edge, last at the right
        assert!((s.nodes[0].x0 - s.plot[0]).abs() < 1e-3);
        assert!((s.nodes[6].x1 - (s.plot[0] + s.plot[2])).abs() < 1e-3);
        // Alignments
        let left = SankeyChart::new(sample_graph(), SankeyOptions { align: SankeyAlign::Left, ..Default::default() }, HierarchyStyle::default());
        assert_eq!(left.layer[6], 2);
        let g = graph(3, &[(0, 1, 1.0), (2, 1, 1.0)]);
        let right = SankeyChart::new(g.clone(), SankeyOptions { align: SankeyAlign::Right, ..Default::default() }, HierarchyStyle::default());
        assert_eq!(right.layer, vec![0, 1, 0]);
        let mut explicit = sample_graph();
        explicit.columns = vec![0, 0, 1, 1, 2, 3, 3];
        assert!(validate_sankey(&explicit).is_ok());
        let e = SankeyChart::new(explicit, SankeyOptions::default(), HierarchyStyle::default());
        assert_eq!((e.layer[4], e.layers), (2, 4));
        // Mixed explicit / computed columns never run backward; huge indices compact
        let mut mixed = graph(3, &[(0, 1, 1.0), (1, 2, 1.0)]);
        mixed.columns = vec![2_000_000_000, -1, -1];
        assert!(validate_sankey(&mixed).is_ok());
        let m = SankeyChart::new(mixed, SankeyOptions::default(), HierarchyStyle::default());
        assert_eq!((m.layer.clone(), m.layers), (vec![0, 1, 2], 3));
    }

    #[test]
    fn cycles_and_bad_input_are_rejected() {
        let e = validate_sankey(&graph(3, &[(0, 1, 1.0), (1, 2, 1.0), (2, 0, 1.0)])).unwrap_err();
        assert!(e.starts_with("sankey links form a cycle: "), "{e}");
        for k in ["node 0", "node 1", "node 2"] {
            assert!(e.contains(k), "{e}");
        }
        // The named chain is a real cycle: consecutive nodes are linked
        let g = graph(4, &[(0, 1, 1.0), (1, 2, 1.0), (2, 3, 1.0), (3, 1, 1.0)]);
        let e = validate_sankey(&g).unwrap_err();
        let chain: Vec<u32> = e.split(": ").nth(1).unwrap().split(" -> ").map(|t| t.trim_start_matches("node ").parse().unwrap()).collect();
        assert_eq!(chain.len(), 4, "{e}");
        assert_eq!(chain[0], chain[3]);
        for w in chain.windows(2) {
            assert!((0..4).any(|l| g.sources[l] == w[0] && g.targets[l] == w[1]), "{e}: {w:?} is not a link");
        }
        assert!(!chain.contains(&0), "node 0 only feeds the cycle");
        assert!(validate_sankey(&graph(2, &[(1, 1, 1.0)])).unwrap_err().contains("cycle: node 1 -> node 1"));
        assert!(validate_sankey(&graph(2, &[(0, 2, 1.0)])).unwrap_err().contains("link 0"));
        assert!(validate_sankey(&graph(2, &[(0, 1, -1.0)])).unwrap_err().contains("value"));
        assert!(validate_sankey(&graph(2, &[(0, 1, f64::NAN)])).is_err());
        let mut back = graph(2, &[(0, 1, 1.0)]);
        back.columns = vec![1, 0];
        assert!(validate_sankey(&back).unwrap_err().contains("later columns"));
        // Zero-valued links are fine (not drawn)
        assert!(validate_sankey(&graph(2, &[(0, 1, 0.0)])).is_ok());
    }

    #[test]
    fn hover_hits_nodes_and_ribbons_and_highlights_connected_flows() {
        let (mut chart, cam) = sankey(sample_graph(), SankeyOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let before = chart.prepare_layers(&v).fills.unwrap().to_vec();
        // Every node sample position hovers itself; link midpoints hover a link (ribbons cross:
        // the top-most one wins), mostly their own
        let mut own = 0;
        for id in 0..(7 + 10) {
            let (series, index, _, p) = chart.sample(id).unwrap();
            let n = cam.project_to_ndc(p).unwrap();
            let hit = chart.hover_at(&v, &mut scene, (n.x, n.y)).expect("hit");
            let got = (hit.items[0].series, hit.items[0].index);
            if series == 0 {
                assert_eq!(got, (0, index), "node {id}");
            }
            own += (got == (series, index)) as u32;
        }
        // The skip link 0 -> 6 passes behind a middle node (nodes hover first)
        assert!(own >= 14, "{own} of 17");
        // Hover node 3: its 4 links brighten, the rest dim
        let (_, _, _, p) = chart.sample(3).unwrap();
        let n = cam.project_to_ndc(p).unwrap();
        chart.hover_at(&v, &mut scene, (n.x, n.y));
        let after = chart.prepare_layers(&v).fills.unwrap().to_vec();
        assert_eq!(after.len(), before.len());
        let alphas: Vec<f32> = after.iter().map(|f| f.color[3]).collect();
        let base = DEFAULT_SANKEY_LINK_OPACITY;
        assert!(alphas.iter().any(|&a| (a - (base + LINK_HOVER_BOOST)).abs() < 1e-5));
        assert!(alphas.iter().any(|&a| (a - base * LINK_HOVER_DIM).abs() < 1e-5));
        assert_eq!(chart.hierarchy_layout().unwrap().hovered, Some((0, 3)));
        // Keyboard: links by id
        let hit = chart.hover_hierarchy_item(&mut scene, 1, 2).unwrap();
        assert_eq!((hit.items[0].value, hit.items[0].global_id), (8.0, 9));
        // Labels: left half to the right of nodes, right half to the left
        let (labels, _) = chart.hierarchy_labels().unwrap();
        assert_eq!(labels.len(), 7);
        let s = chart.sankey().unwrap();
        assert!(labels.iter().filter(|l| s.nodes[l.node as usize].layer == 0).all(|l| l.flags == 1));
        assert!(labels.iter().filter(|l| s.nodes[l.node as usize].layer == 2).all(|l| l.flags == -1));
    }

    #[test]
    fn ten_thousand_nodes_lay_out_without_overlap() {
        // 10 columns x 1000 nodes; each node links to 2 nodes of the next column + a hub
        let (cols, per) = (10u32, 1000u32);
        let mut links = Vec::new();
        for c in 0..cols - 1 {
            for k in 0..per {
                let s = c * per + k;
                let t1 = (c + 1) * per + (k * 7) % per;
                let t2 = (c + 1) * per + (k * 13 + 1) % per;
                links.push((s, t1, 1.0 + (k % 5) as f64));
                links.push((s, t2, 1.0 + (k % 3) as f64));
            }
        }
        let g = graph((cols * per) as usize, &links);
        let t0 = std::time::Instant::now();
        let (mut chart, cam) = sankey(g, SankeyOptions { iterations: 6, ..Default::default() });
        chart.prepare_layers(&view(&cam));
        let ms = t0.elapsed().as_secs_f64() * 1e3;
        println!("10k-node sankey ({} links): layout + tessellate {ms:.1} ms", links.len());
        assert!(ms < 10_000.0, "{ms} ms");
        let s = chart.sankey().unwrap();
        // Padding shrinks to fit 1000 nodes per column
        let max_len = per as f32;
        let py = DEFAULT_SANKEY_NODE_PADDING.min(0.5 * s.plot[3] / (max_len - 1.0));
        assert_no_overlap(s, py);
    }
}
