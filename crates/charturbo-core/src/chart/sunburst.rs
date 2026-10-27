//! Sunburst: radial partition of the tree, one ring per depth below the current root.
//!
//! The current root is the center disk; its descendants get angular spans proportional to their
//! value (children ordered largest first, contiguous within the parent's span) and rings of
//! equal width. Arcs reuse the pie tessellation (`tessellate_slice`: chord error <= 0.25 px,
//! 2 px angular surface gaps, 1 px anti-aliasing outlines); rings are inset by half the gap
//! radially, so every neighbour is 2 px apart. Arcs narrower than the gap disappear and their
//! subtree is skipped, so the drawn arc count follows the screen.
//!
//! Hover: ring from the radius, then a binary search over the children's cumulative angles per
//! level (O(depth log n)); the center hovers the current root. The hovered node's path (its
//! ancestors) and subtree stay at full color while the rest fades. Labels (horizontal DOM text)
//! are anchored at arc centroids that leave room for a line of text.

use super::*;
use super::hierarchy::*;
use super::pie::{arc_segments, tessellate_slice, PieScreen, SliceShape};
use std::f32::consts::TAU;

/// World radius of the sunburst (the camera framing scales it to the plot).
pub(crate) const SUNBURST_RADIUS: f32 = 50.0;
/// Surface gap between arcs (CSS px, angular and radial).
pub const SUNBURST_GAP_PX: f32 = 2.0;
/// Hover: arcs off the hovered path mix this far toward the surface.
const PATH_FADE: f32 = 0.55;
/// Rings step this far toward the surface per level below the top (group mode).
const DEPTH_STEP: f32 = 0.14;
/// Arcs shorter than this (CSS px at their outer radius) are not drawn, nor their subtree.
const MIN_ARC_PX: f32 = 1.0;
/// Label anchors at most (largest arcs win).
pub const MAX_SUNBURST_LABELS: usize = 300;
const LABEL_MIN_W: f32 = 28.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SunburstOptions {
    /// Rings shown below the current root (0 = all)
    pub max_depth: u32,
    pub color_by: HierarchyColorBy,
    pub labels: bool,
    /// Label line height (CSS px): arcs need this much room across the text
    pub label_line_px: f32,
}

impl Default for SunburstOptions {
    fn default() -> Self {
        Self { max_depth: 0, color_by: HierarchyColorBy::Auto, labels: true, label_line_px: 14.0 }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct SunburstChart {
    pub(crate) tree: Tree,
    opts: SunburstOptions,
    style: HierarchyStyle,
    pub(crate) colors: Vec<[f32; 4]>,
    pub(crate) legend: Legend,
    root: u32,
    emphasis: Option<usize>,
    /// Compass angles (radians clockwise from 12 o'clock) of each node in the current partition
    start: Vec<f32>,
    end: Vec<f32>,
    /// Rings shown below the root, center disk radius and ring width (world units)
    levels: u32,
    r0: f32,
    ring: f32,
    partitioned: bool,
    screen: Option<PieScreen>,
    /// Scale (world per CSS px), hovered node and emphasis the arcs were built for
    built: Option<(f32, Option<u32>)>,
    pub(crate) labels: Vec<HierarchyLabel>,
    pub(crate) labels_revision: u32,
    labels_key: Option<[f32; 19]>,
}

impl SunburstChart {
    pub(crate) fn new(tree: Tree, mut opts: SunburstOptions, style: HierarchyStyle) -> Self {
        let d = SunburstOptions::default();
        if !opts.label_line_px.is_finite() || opts.label_line_px < 1.0 {
            opts.label_line_px = d.label_line_px;
        }
        let n = tree.len();
        let root = tree.root;
        let mut s = Self {
            tree,
            opts,
            style,
            colors: Vec::new(),
            legend: Vec::new(),
            root,
            emphasis: None,
            start: vec![0.0; n],
            end: vec![0.0; n],
            levels: 0,
            r0: 0.0,
            ring: 0.0,
            partitioned: false,
            screen: None,
            built: None,
            labels: Vec::new(),
            labels_revision: 0,
            labels_key: None,
        };
        s.assign_colors();
        s.partition();
        s
    }

    fn assign_colors(&mut self) {
        let (colors, legend) = tree_colors(&self.tree, &self.style, self.opts.color_by, DEPTH_STEP);
        self.colors = colors;
        self.legend = legend;
        self.built = None;
    }

    pub(crate) fn set_style(&mut self, style: HierarchyStyle) {
        self.style = style;
        self.assign_colors();
    }

    pub(crate) fn set_emphasis(&mut self, series: Option<usize>) -> bool {
        let series = series.filter(|&k| k < self.legend.len());
        let changed = self.emphasis != series;
        if changed {
            self.emphasis = series;
            self.built = None;
        }
        changed
    }

    pub(crate) fn set_root(&mut self, node: u32) -> bool {
        if node as usize >= self.tree.len() || node == self.root || self.tree.shown_children(node).is_empty() {
            return false;
        }
        self.root = node;
        self.partition();
        true
    }

    /// Clicked arc: drill into it (if it has children); the center (current root): up one level.
    pub(crate) fn drill_target(&self, node: u32) -> Option<u32> {
        if node as usize >= self.tree.len() {
            return None;
        }
        if node == self.root {
            let p = self.tree.parent[node as usize];
            return (p != NO_PARENT).then_some(p);
        }
        (self.tree.is_ancestor(self.root, node) && !self.tree.shown_children(node).is_empty()).then_some(node)
    }

    /// Angles of the current root's subtree and the ring geometry.
    fn partition(&mut self) {
        self.start.fill(0.0);
        self.end.fill(0.0);
        let root = self.root as usize;
        // Levels with something to draw (zero-valued descendants take no ring)
        let mut below = 0;
        let mut walk = vec![(self.root, 0u32)];
        while let Some((v, d)) = walk.pop() {
            below = below.max(d);
            walk.extend(self.tree.shown_children(v).iter().map(|&c| (c, d + 1)));
        }
        self.levels = if self.opts.max_depth == 0 { below } else { below.min(self.opts.max_depth) }.max(1);
        let r = SUNBURST_RADIUS;
        self.r0 = (r / (self.levels + 1) as f32).max(0.2 * r);
        self.ring = (r - self.r0) / self.levels as f32;
        let (d0, levels) = (self.tree.depth[root], self.levels);
        self.end[root] = TAU;
        let mut stack = vec![self.root];
        while let Some(v) = stack.pop() {
            if self.tree.depth[v as usize] - d0 >= levels {
                continue;
            }
            let (a0, a1) = (self.start[v as usize] as f64, self.end[v as usize] as f64);
            let total = self.tree.value[v as usize];
            if total <= 0.0 {
                continue;
            }
            let mut acc = 0.0f64;
            let kids = self.tree.shown_children(v);
            for (k, &c) in kids.iter().enumerate() {
                let lo = a0 + (a1 - a0) * acc / total;
                acc += self.tree.value[c as usize];
                // The last child closes the parent's span exactly
                let hi = if k + 1 == kids.len() { a1 } else { a0 + (a1 - a0) * acc / total };
                self.start[c as usize] = lo as f32;
                self.end[c as usize] = hi as f32;
                stack.push(c);
            }
        }
        self.partitioned = true;
        self.built = None;
        self.labels_key = None;
    }

    /// Inner / outer world radius of ring `k` (1 = first ring below the root).
    fn ring_radii(&self, k: u32) -> (f32, f32) {
        let lo = self.r0 + self.ring * (k - 1) as f32;
        (lo, lo + self.ring)
    }

    fn rel_depth(&self, v: u32) -> u32 {
        self.tree.depth[v as usize] - self.tree.depth[self.root as usize]
    }

    fn legend_slot(&self, v: usize) -> Option<usize> {
        let g = self.tree.group[v];
        (g != NO_PARENT && !self.legend.is_empty()).then(|| (g as usize).min(self.legend.len() - 1))
    }

    fn display_color(&self, v: u32, hovered: Option<u32>) -> [f32; 4] {
        let c = self.colors[v as usize];
        let faded = match (hovered, self.emphasis) {
            // Hovered path: ancestors of the hovered node, the node and its subtree
            (Some(h), _) => !(self.tree.is_ancestor(v, h) || self.tree.is_ancestor(h, v)),
            (None, Some(e)) => self.legend_slot(v as usize) != Some(e),
            _ => false,
        };
        if faded {
            mix(c, self.style.surface, if hovered.is_some() { PATH_FADE } else { EMPHASIS_FADE })
        } else {
            c
        }
    }

    /// Center disk color: a quiet tint of the surface toward the highlight.
    fn center_color(&self) -> [f32; 4] {
        mix(self.style.surface, self.style.highlight, 0.1)
    }

    /// Arcs (fills + AA outlines) at scale `wpp` with the hovered path highlighted.
    fn build(&self, wpp: f32, hovered: Option<u32>, fills: &mut Vec<ChartFillRaw>, edges: &mut Vec<ChartSegmentRaw>) {
        fills.clear();
        edges.clear();
        let half = 0.5 * SUNBURST_GAP_PX * wpp;
        let center = SliceShape { lo: 0.0, hi: TAU, r_out: self.r0 - half, r_in: 0.0, full: true };
        let center_color = if hovered == Some(self.root) { mix(self.center_color(), self.style.highlight, 0.12) } else { self.center_color() };
        tessellate_slice(&center, wpp, (0.0, 0.0), center_color, fills, edges);
        let mut stack: Vec<u32> = self.tree.shown_children(self.root).to_vec();
        while let Some(v) = stack.pop() {
            let k = self.rel_depth(v);
            if k == 0 || k > self.levels {
                continue;
            }
            let (lo, hi) = (self.start[v as usize], self.end[v as usize]);
            let (r_in, r_out) = self.ring_radii(k);
            if (hi - lo) * r_out / wpp < MIN_ARC_PX {
                continue;
            }
            let full = hi - lo >= TAU * 0.99999;
            let shape = SliceShape { lo, hi, r_out: r_out - half, r_in: r_in + half, full };
            if tessellate_slice(&shape, wpp, (0.0, 0.0), self.display_color(v, hovered), fills, edges) {
                stack.extend_from_slice(self.tree.shown_children(v));
            }
        }
    }

    /// Node at world point `(x, y)`: the center is the current root; rings descend by angle.
    pub(crate) fn node_at(&self, x: f32, y: f32) -> Option<u32> {
        let r = x.hypot(y);
        if r > SUNBURST_RADIUS {
            return None;
        }
        if r < self.r0 {
            return Some(self.root);
        }
        let ring = (((r - self.r0) / self.ring).floor() as u32 + 1).min(self.levels);
        let a = x.atan2(y).rem_euclid(TAU);
        let a = if a >= TAU { 0.0 } else { a };
        let mut v = self.root;
        for _ in 0..ring {
            let kids = self.tree.shown_children(v);
            // Children's spans are contiguous and ascending: first child ending past `a`
            let k = kids.partition_point(|&c| self.end[c as usize] <= a);
            let &c = kids.get(k)?;
            if a < self.start[c as usize] {
                return None;
            }
            v = c;
        }
        Some(v)
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let p = ray_hit_z_plane(&ray, 0.0)?;
        let v = self.node_at(p.x, p.y)?;
        Some(hover_one(0, v, self.tree.value[v as usize], v))
    }

    /// World centroid of a node's arc (the center for the current root).
    fn centroid(&self, v: u32) -> Option<(f32, f32)> {
        if v == self.root {
            return Some((0.0, 0.0));
        }
        if !self.tree.is_ancestor(self.root, v) {
            return None;
        }
        let k = self.rel_depth(v);
        if k > self.levels {
            return None;
        }
        let (r_in, r_out) = self.ring_radii(k);
        let mid = 0.5 * (self.start[v as usize] + self.end[v as usize]);
        Some((0.5 * (r_in + r_out) * mid.sin(), 0.5 * (r_in + r_out) * mid.cos()))
    }

    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let (x, y) = self.centroid(global_id)?;
        Some((0, global_id, self.tree.value[global_id as usize] as f32, Vec3::new(x, y, 0.0)))
    }

    /// Horizontal label anchors at arc centroids where a line of text fits.
    fn layout_labels(&mut self, screen: PieScreen) -> bool {
        let mut out: Vec<(f32, HierarchyLabel)> = Vec::new();
        let line = self.opts.label_line_px;
        let px = 1.0 / screen.wpp;
        if self.opts.labels {
            let mut stack: Vec<u32> = self.tree.shown_children(self.root).to_vec();
            while let Some(v) = stack.pop() {
                let k = self.rel_depth(v);
                if k > self.levels {
                    continue;
                }
                let (r_in, r_out) = self.ring_radii(k);
                let span = self.end[v as usize] - self.start[v as usize];
                if span * r_out * px < LABEL_MIN_W {
                    continue;
                }
                stack.extend_from_slice(self.tree.shown_children(v));
                let rm = 0.5 * (r_in + r_out) * px;
                let ring_w = self.ring * px - SUNBURST_GAP_PX;
                let arc = (span * rm - SUNBURST_GAP_PX).max(0.0);
                let mid = 0.5 * (self.start[v as usize] + self.end[v as usize]);
                let (s, c) = (mid.sin().abs().max(1e-3), mid.cos().abs().max(1e-3));
                // Horizontal text at the centroid: radial room shrinks it near 3 / 9 o'clock,
                // tangential room near 12 / 6 o'clock (full span past a half turn)
                let tangential = if span >= std::f32::consts::PI { f32::INFINITY } else { arc / c };
                let w = 0.85 * (ring_w / s).min(tangential);
                let h = (ring_w / c).min(if span >= std::f32::consts::PI { f32::INFINITY } else { arc / s });
                if w < LABEL_MIN_W || h < line {
                    continue;
                }
                let cx = screen.center_css.0 + rm * mid.sin();
                let cy = screen.center_css.1 - rm * mid.cos();
                out.push((span * rm * ring_w, HierarchyLabel { node: v, x_css: cx, y_css: cy, w_css: w.min(160.0), h_css: line, flags: 0 }));
            }
        }
        if out.len() > MAX_SUNBURST_LABELS {
            out.select_nth_unstable_by(MAX_SUNBURST_LABELS - 1, |a, b| b.0.total_cmp(&a.0));
            out.truncate(MAX_SUNBURST_LABELS);
        }
        let mut labels: Vec<HierarchyLabel> = out.into_iter().map(|(_, l)| l).collect();
        labels.sort_by_key(|l| l.node);
        let changed = labels != self.labels;
        if changed {
            self.labels = labels;
            self.labels_revision = self.labels_revision.wrapping_add(1);
        }
        changed
    }

    pub(crate) fn layout_info(&self) -> HierarchyLayoutInfo {
        let (c, r) = match self.screen {
            Some(s) => (s.center_css, self.r0 / s.wpp),
            None => ((0.0, 0.0), 0.0),
        };
        let plot = self.screen.map_or([0.0; 4], |s| [s.center_css.0 - s.r_css, s.center_css.1 - s.r_css, 2.0 * s.r_css, 2.0 * s.r_css]);
        HierarchyLayoutInfo { root: self.root, plot_css: plot, center_css: c, center_r_css: r, hovered: None }
    }

    pub(crate) fn plot_css(&self, view: &ChartView) -> [f32; 4] {
        match screen_of(view) {
            Some(s) => [s.center_css.0 - s.r_css, s.center_css.1 - s.r_css, 2.0 * s.r_css, 2.0 * s.r_css],
            None => [0.0; 4],
        }
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        let m = 4.0;
        let pad = [padding[0] + m, padding[1] + m, padding[2] + m, padding[3] + m];
        frame_flat(camera, css, 2.0 * SUNBURST_RADIUS, 2.0 * SUNBURST_RADIUS, &pad);
    }

    pub(crate) fn prepare(&mut self, view: &ChartView, _padding: &ChartPadding, hovered: Option<(u32, u32)>, force: bool, out: HierFrame) -> HierChanged {
        let mut changed = HierChanged::default();
        let Some(screen) = screen_of(view) else {
            return changed;
        };
        self.screen = Some(screen);
        if !self.partitioned {
            self.partition();
        }
        let hovered = hovered.filter(|h| h.0 == 0).map(|h| h.1);
        let stale = match self.built {
            Some((wpp, h)) => h != hovered || ((wpp - screen.wpp) / screen.wpp).abs() > 1e-4,
            None => true,
        };
        if stale || force {
            self.build(screen.wpp, hovered, out.fills, out.edges);
            self.built = Some((screen.wpp, hovered));
            changed.fills = true;
        }
        if self.labels_key != Some(view.key()) {
            self.layout_labels(screen);
            self.labels_key = Some(view.key());
        }
        if !out.overlay.is_empty() {
            out.overlay.clear();
            changed.overlay = true;
        }
        changed
    }
}

/// Center / radius of the sunburst on screen (same mapping as the pie).
fn screen_of(view: &ChartView) -> Option<PieScreen> {
    let c = view.project_css(Vec3::ZERO)?;
    let e = view.project_css(Vec3::new(SUNBURST_RADIUS, 0.0, 0.0))?;
    let r = (e.0 - c.0).hypot(e.1 - c.1);
    (r > 1e-3).then_some(PieScreen { center_css: c, r_css: r, wpp: SUNBURST_RADIUS / r })
}

/// Arc chords of a full ring at `r_px` (exposed for tests).
#[allow(dead_code)]
pub(crate) fn ring_segments(r_px: f32) -> usize {
    arc_segments(TAU, r_px)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn sunburst(parents: &[i32], values: &[f64], opts: SunburstOptions) -> (ChartState, OrbitCamera) {
        let tree = Tree::build(parents, values).unwrap();
        let chart = ChartState::new_sunburst(tree, opts, HierarchyStyle::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &SunburstChart {
        match &chart.kind {
            ChartKind::Hierarchy(HierChart::Sunburst(s)) => s,
            _ => unreachable!(),
        }
    }

    fn ndc_at(cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let n = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        (n.x, n.y)
    }

    const PARENTS: [i32; 8] = [-1, 0, 0, 1, 1, 1, 2, 2];
    const VALUES: [f64; 8] = [0.0, 0.0, 0.0, 30.0, 20.0, 10.0, 25.0, 15.0];

    #[test]
    fn partition_angles_are_proportional_and_nested() {
        let (chart, _) = sunburst(&PARENTS, &VALUES, SunburstOptions::default());
        let s = inner(&chart);
        // Root 100: A (60) then B (40), largest first, clockwise from 12 o'clock
        assert!((s.start[1] - 0.0).abs() < 1e-6 && (s.end[1] - TAU * 0.6).abs() < 1e-5);
        assert!((s.start[2] - TAU * 0.6).abs() < 1e-5 && s.end[2] == TAU);
        // Children subdivide the parent's span exactly (last one closes it)
        assert!((s.end[3] - s.start[3] - TAU * 0.3).abs() < 1e-5);
        assert_eq!(s.start[3], s.start[1]);
        assert_eq!(s.end[5], s.end[1]);
        for v in 3..8u32 {
            let p = s.tree.parent[v as usize] as usize;
            assert!(s.start[v as usize] >= s.start[p] - 1e-6 && s.end[v as usize] <= s.end[p] + 1e-6);
            let share = (s.end[v as usize] - s.start[v as usize]) / TAU;
            assert!((share as f64 - VALUES[v as usize] / 100.0).abs() < 1e-5, "angle ∝ value");
        }
        // Two rings + center
        assert_eq!(s.levels, 2);
        assert!((s.r0 + 2.0 * s.ring - SUNBURST_RADIUS).abs() < 1e-4);
    }

    #[test]
    fn hover_descends_rings_and_drill_repartitions() {
        let (mut chart, cam) = sunburst(&PARENTS, &VALUES, SunburstOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        let s = inner(&chart);
        let at = |node: u32| s.centroid(node).unwrap();
        let points: Vec<(u32, (f32, f32))> = (0..8u32).map(|n| (n, at(n))).collect();
        for (n, (x, y)) in points {
            let hit = chart.hover_at(&v, &mut scene, ndc_at(&cam, x, y)).unwrap();
            assert_eq!(hit.items[0].index, n);
        }
        assert!(chart.hover_at(&v, &mut scene, ndc_at(&cam, 0.0, SUNBURST_RADIUS * 1.1)).is_none());
        // Hover path: rebuilt with the off-path arcs faded
        let (x, y) = inner(&chart).centroid(6).unwrap();
        chart.hover_at(&v, &mut scene, ndc_at(&cam, x, y));
        let fills = chart.prepare_layers(&v).fills.unwrap().to_vec();
        let base3 = inner(&chart).colors[3];
        assert!(fills.iter().all(|f| f.color != base3), "node 3 is off the hovered path");
        assert!(fills.iter().any(|f| f.color == inner(&chart).colors[6]));
        // AA outlines exist
        assert!(!chart.series.is_empty());

        // Drill: arcs drill into themselves; the center goes up
        assert_eq!(chart.hierarchy_drill_target(1), Some(1));
        assert_eq!(chart.hierarchy_drill_target(3), None, "leaf");
        assert!(chart.set_hierarchy_root(1));
        let s = inner(&chart);
        assert_eq!(s.levels, 1);
        assert!((s.end[3] - s.start[3] - TAU * 0.5).abs() < 1e-5, "30 of 60");
        assert_eq!(chart.hierarchy_drill_target(1), Some(0), "center = up");
        assert_eq!(chart.hierarchy_drill_target(6), None, "outside the current root");
        chart.prepare_layers(&v);
        let hit = chart.hover_at(&v, &mut scene, ndc_at(&cam, 0.0, 0.0)).unwrap();
        assert_eq!(hit.items[0].index, 1, "center hovers the current root");
    }

    #[test]
    fn arcs_keep_gaps_labels_fit_and_slivers_are_culled() {
        let mut parents = vec![-1, 0, 0];
        let mut values = vec![0.0, 1000.0, 0.0];
        for _ in 0..2000 {
            parents.push(2);
            values.push(0.001);
        }
        let (mut chart, cam) = sunburst(&parents, &values, SunburstOptions::default());
        chart.prepare_layers(&view(&cam));
        // Slivers below a pixel are skipped: far fewer triangles than nodes
        assert!(chart.fills.len() / 3 < 2000, "{}", chart.fills.len() / 3);

        let (mut chart, cam) = sunburst(&PARENTS, &VALUES, SunburstOptions::default());
        chart.prepare_layers(&view(&cam));
        let s = inner(&chart);
        let (labels, _) = chart.hierarchy_labels().unwrap();
        assert!(!labels.is_empty());
        let screen = s.screen.unwrap();
        for l in labels {
            // Anchor inside its arc's ring
            let d = (l.x_css - screen.center_css.0).hypot(l.y_css - screen.center_css.1) * screen.wpp;
            let (r_in, r_out) = s.ring_radii(s.rel_depth(l.node));
            assert!(d > r_in && d < r_out, "label {l:?}");
            assert!(l.w_css >= LABEL_MIN_W);
        }
        // Radial gap: no fill vertex inside the half gap at a ring boundary
        let wpp = screen.wpp;
        let boundary = s.r0 + s.ring;
        for f in &chart.fills {
            let r = f.position[0].hypot(f.position[1]);
            assert!((r - boundary).abs() >= 0.5 * SUNBURST_GAP_PX * wpp - 1e-3 || r < s.r0, "{r} vs {boundary}");
        }
        assert!(ring_segments(100.0) > 8);
    }
}
