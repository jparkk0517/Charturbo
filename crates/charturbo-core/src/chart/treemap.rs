//! Treemap: squarified layout (Bruls, Huizing, van Wijk 2000) of nested levels, laid out in CSS
//! px of the padded plot so padding, header strips and the 2 px surface gaps are exact on
//! screen.
//!
//! Every expanded parent gets a header strip (when it fits) and inner padding; its children are
//! squarified into the rest. A subtree whose content area would be smaller than
//! `MIN_CONTENT_PX` (or that sits at `max_depth`) is drawn as one aggregated cell, so the drawn
//! cell count follows the screen, not the data (100k leaves lay out in O(n), draw at most what
//! fits). Cells are inset by half the gap and snapped to device pixels: neighbours always show
//! exactly 2 px of surface between them, and axis-aligned edges stay crisp without AA strokes.
//!
//! Hover descends from the current root through the layout rectangles (header / padding hit
//! the parent); the hovered cell gets an outline in the overlay layer, no re-tessellation.
//! Label anchors (text boxes) are chosen here for cells large enough to hold text, largest
//! first, capped at `MAX_LABELS`.

use super::*;
use super::hierarchy::*;

/// Surface gap between adjacent cells (CSS px).
pub const TREEMAP_GAP_PX: f32 = 2.0;
/// Below this content size (CSS px) a parent is drawn as one aggregated cell.
const MIN_CONTENT_PX: f32 = 4.0;
/// A parent is drawn whole when its children would average less than this area (CSS px^2):
/// cells that small are mostly gap and could not be told apart anyway (drill to see them).
const MIN_CHILD_AREA: f32 = 36.0;
/// Headers need at least this width (CSS px).
const MIN_HEADER_W: f32 = 24.0;
/// Header strips mix this far toward the surface (recessive, text sits on them).
const HEADER_FADE: f32 = 0.5;
/// Label boxes: minimum cell size and the height that also fits a value line (CSS px).
const LABEL_MIN_W: f32 = 30.0;
const LABEL_MIN_H: f32 = 16.0;
const VALUE_LINE_H: f32 = 34.0;
const LABEL_INSET_X: f32 = 4.0;
const LABEL_INSET_Y: f32 = 2.0;
/// Label anchors at most (largest cells win).
pub const MAX_TREEMAP_LABELS: usize = 600;
/// Hover outline width (CSS px).
const OUTLINE_PX: f32 = 2.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TreemapOptions {
    /// Levels shown below the current root (0 = all)
    pub max_depth: u32,
    /// Inner padding of expanded parents (CSS px)
    pub padding_px: f32,
    /// Header strip height of expanded parents (CSS px; 0 = none)
    pub header_px: f32,
    pub color_by: HierarchyColorBy,
    pub labels: bool,
}

impl Default for TreemapOptions {
    fn default() -> Self {
        Self { max_depth: 0, padding_px: 2.0, header_px: 20.0, color_by: HierarchyColorBy::Auto, labels: true }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CellKind {
    Leaf,
    /// A parent drawn whole (too small, or at `max_depth`)
    Aggregate,
    /// Header strip of an expanded parent
    Header,
}

/// One drawn rectangle: snapped CSS px `[left, top, width, height]` from the canvas top-left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Cell {
    pub node: u32,
    pub kind: CellKind,
    pub rect: [f32; 4],
}

const NO_RECT: [f32; 4] = [f32::NAN; 4];

fn contains(r: &[f32; 4], x: f32, y: f32) -> bool {
    x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3]
}

fn inset(r: [f32; 4], d: f32) -> [f32; 4] {
    [r[0] + d, r[1] + d, r[2] - 2.0 * d, r[3] - 2.0 * d]
}

/// Squarified layout of `values` (sorted descending, > 0) filling `rect` exactly: rows are laid
/// along the shorter side and grow while the worst aspect ratio of the row improves.
pub fn squarify(values: &[f64], rect: [f32; 4], out: &mut Vec<[f32; 4]>) {
    out.clear();
    let total: f64 = values.iter().sum();
    let (mut x, mut y, mut w, mut h) = (rect[0] as f64, rect[1] as f64, rect[2].max(0.0) as f64, rect[3].max(0.0) as f64);
    if values.is_empty() || total <= 0.0 || w * h <= 0.0 {
        out.extend(values.iter().map(|_| [rect[0], rect[1], 0.0, 0.0]));
        return;
    }
    let scale = w * h / total;
    // Worst aspect ratio of a row with area sum `s`, extremes `lo` / `hi`, along side `side`
    let worst = |s: f64, lo: f64, hi: f64, side: f64| {
        let (s2, side2) = (s * s, side * side);
        (side2 * hi / s2).max(s2 / (side2 * lo))
    };
    let n = values.len();
    let mut i = 0;
    while i < n {
        let side = w.min(h);
        let a0 = values[i] * scale;
        let (mut sum, mut lo, mut hi) = (a0, a0, a0);
        let mut best = worst(sum, lo, hi, side);
        let mut j = i + 1;
        while j < n {
            let a = values[j] * scale;
            let r = worst(sum + a, lo.min(a), hi.max(a), side);
            if r > best {
                break;
            }
            sum += a;
            lo = lo.min(a);
            hi = hi.max(a);
            best = r;
            j += 1;
        }
        // The last row takes whatever is left (no drift from rounding)
        let last = j == n;
        if w >= h {
            // Column on the left
            let cw = if last { w } else { (sum / h).min(w) };
            let mut yy = y;
            for (k, &val) in values.iter().enumerate().take(j).skip(i) {
                let hk = if k + 1 == j { y + h - yy } else { val * scale / cw };
                out.push([x as f32, yy as f32, cw as f32, hk.max(0.0) as f32]);
                yy += hk;
            }
            x += cw;
            w -= cw;
        } else {
            // Row along the top
            let rh = if last { h } else { (sum / w).min(h) };
            let mut xx = x;
            for (k, &val) in values.iter().enumerate().take(j).skip(i) {
                let wk = if k + 1 == j { x + w - xx } else { val * scale / rh };
                out.push([xx as f32, y as f32, wk.max(0.0) as f32, rh as f32]);
                xx += wk;
            }
            y += rh;
            h -= rh;
        }
        i = j;
    }
}

/// Snaps a cell to device pixels. A cell its gap inset would erase keeps its full rect (its
/// area stays visible); cells thinner than a device pixel even then are not drawn.
fn push_cell(cells: &mut Vec<Cell>, node: u32, kind: CellKind, r: [f32; 4], screen: &FlatScreen) {
    let min = 0.999 / screen.pixel_ratio;
    let snapped = |r: [f32; 4]| {
        let (x0, y0) = (screen.snap(r[0]), screen.snap(r[1]));
        let (x1, y1) = (screen.snap(r[0] + r[2]), screen.snap(r[1] + r[3]));
        (x1 - x0 >= min && y1 - y0 >= min).then_some([x0, y0, x1 - x0, y1 - y0])
    };
    let full = || if kind == CellKind::Header { None } else { snapped(inset(r, -0.5 * TREEMAP_GAP_PX)) };
    if let Some(rect) = snapped(r).or_else(full) {
        cells.push(Cell { node, kind, rect });
    }
}

#[derive(Debug, Clone)]
pub(crate) struct TreemapChart {
    pub(crate) tree: Tree,
    opts: TreemapOptions,
    style: HierarchyStyle,
    pub(crate) colors: Vec<[f32; 4]>,
    pub(crate) legend: Legend,
    root: u32,
    /// Legend entry whose group stays at full color (others fade)
    emphasis: Option<usize>,
    /// Layout rectangle per node (CSS px; `NO_RECT` = not laid out)
    rects: Vec<[f32; 4]>,
    /// Node's children are laid out (else it is a drawn cell)
    expanded: Vec<bool>,
    pub(crate) cells: Vec<Cell>,
    /// Plot rect, pixel ratio and root the layout was computed for
    layout_key: Option<([f32; 4], f32, u32)>,
    plot: [f32; 4],
    screen: Option<FlatScreen>,
    /// Screen the fills were built for
    built: Option<FlatScreen>,
    /// Hovered item the overlay outline was built for
    outlined: Option<Option<(u32, u32)>>,
    pub(crate) labels: Vec<HierarchyLabel>,
    pub(crate) labels_revision: u32,
}

impl TreemapChart {
    pub(crate) fn new(tree: Tree, mut opts: TreemapOptions, style: HierarchyStyle) -> Self {
        let clean = |v: f32, d: f32| if v.is_finite() { v.clamp(0.0, 256.0) } else { d };
        let d = TreemapOptions::default();
        opts.padding_px = clean(opts.padding_px, d.padding_px);
        opts.header_px = clean(opts.header_px, d.header_px);
        let n = tree.len();
        let root = tree.root;
        let mut t = Self {
            tree,
            opts,
            style,
            colors: Vec::new(),
            legend: Vec::new(),
            root,
            emphasis: None,
            rects: vec![NO_RECT; n],
            expanded: vec![false; n],
            cells: Vec::new(),
            layout_key: None,
            plot: [0.0; 4],
            screen: None,
            built: None,
            outlined: None,
            labels: Vec::new(),
            labels_revision: 0,
        };
        t.assign_colors();
        t
    }

    fn assign_colors(&mut self) {
        let (colors, legend) = tree_colors(&self.tree, &self.style, self.opts.color_by, 0.0);
        self.colors = colors;
        self.legend = legend;
        self.built = None;
    }

    pub(crate) fn set_style(&mut self, style: HierarchyStyle) {
        self.style = style;
        self.assign_colors();
        self.outlined = None;
    }

    /// Legend emphasis: only the fill emphasis uniform changes (cells carry their group key).
    pub(crate) fn set_emphasis(&mut self, series: Option<usize>) -> bool {
        let series = series.filter(|&k| k < self.legend.len());
        let changed = self.emphasis != series;
        self.emphasis = series;
        changed
    }

    pub(crate) fn set_root(&mut self, node: u32) -> bool {
        if node as usize >= self.tree.len() || node == self.root || self.tree.shown_children(node).is_empty() {
            return false;
        }
        self.root = node;
        self.layout_key = None;
        self.outlined = None;
        true
    }

    /// The current root's child containing `node` (if it has children to show).
    pub(crate) fn drill_target(&self, node: u32) -> Option<u32> {
        if node as usize >= self.tree.len() {
            return None;
        }
        let c = if self.tree.parent[node as usize] == self.root { node } else { self.tree.child_toward(self.root, node)? };
        (!self.tree.shown_children(c).is_empty()).then_some(c)
    }

    /// Legend entry of a node's color (`None` in value mode).
    fn legend_slot(&self, v: usize) -> Option<usize> {
        let g = self.tree.group[v];
        (g != NO_PARENT && !self.legend.is_empty()).then(|| (g as usize).min(self.legend.len() - 1))
    }

    /// Displayed color of node `v` with the legend emphasis applied on the CPU (the pre-uniform
    /// path, kept as the reference of the equivalence tests).
    #[cfg(test)]
    pub(crate) fn display_color(&self, v: usize) -> [f32; 4] {
        let c = self.colors[v];
        match self.emphasis {
            Some(e) if self.legend_slot(v) != Some(e) => mix(c, self.style.surface, EMPHASIS_FADE),
            _ => c,
        }
    }

    /// Fill of a drawn cell as `prepare` draws it (header strips fade toward the surface).
    pub(crate) fn cell_color(&self, c: &Cell) -> [f32; 4] {
        let base = self.colors[c.node as usize];
        if c.kind == CellKind::Header {
            mix(base, self.style.surface, HEADER_FADE)
        } else {
            base
        }
    }

    /// Fill emphasis tag of node `v`: fades unless its legend group (key = slot + 1) is emphasized.
    fn emphasis_tag(&self, v: usize) -> f32 {
        fill_emphasis_tag(FILL_EMPH_FADE, false, self.legend_slot(v).map_or(0, |k| k as u32 + 1))
    }

    /// Fill emphasis uniform of the current legend emphasis.
    pub(crate) fn fill_style(&self) -> ChartFillStyleRaw {
        match self.emphasis {
            Some(e) => ChartFillStyleRaw {
                emphasis: [1.0, 0.0, 1.0, EMPHASIS_FADE],
                surface: self.style.surface,
                key: [(e + 1) as f32, 0.0, 0.0, 0.0],
            },
            None => ChartFillStyleRaw::default(),
        }
    }

    /// Lays out the subtree of the current root into `plot` (CSS px) and collects the cells.
    fn layout(&mut self, plot: [f32; 4], screen: &FlatScreen) {
        self.rects.fill(NO_RECT);
        self.expanded.fill(false);
        self.cells.clear();
        let half = 0.5 * TREEMAP_GAP_PX;
        let (pad, hdr) = (self.opts.padding_px, self.opts.header_px);
        let mut stack = vec![(self.root, plot, 0u32)];
        let mut vals: Vec<f64> = Vec::new();
        let mut kid_rects: Vec<[f32; 4]> = Vec::new();
        while let Some((v, r, d)) = stack.pop() {
            self.rects[v as usize] = r;
            let kids = self.tree.shown_children(v);
            let can_expand = !kids.is_empty() && (self.opts.max_depth == 0 || d < self.opts.max_depth);
            let content = if v == self.root {
                if kids.is_empty() {
                    push_cell(&mut self.cells, v, CellKind::Leaf, inset(r, half), screen);
                    continue;
                }
                r
            } else {
                let inner = inset(r, half);
                if !can_expand {
                    let kind = if kids.is_empty() { CellKind::Leaf } else { CellKind::Aggregate };
                    push_cell(&mut self.cells, v, kind, inner, screen);
                    continue;
                }
                let header = hdr > 0.0 && inner[2] >= MIN_HEADER_W && inner[3] >= hdr + half + pad + MIN_CONTENT_PX;
                // Below the header: half a gap, so children (inset by half a gap) sit a full gap away
                let top = if header { hdr + half } else { pad };
                let c = [inner[0] + pad, inner[1] + top, inner[2] - 2.0 * pad, inner[3] - top - pad];
                if c[2] < MIN_CONTENT_PX || c[3] < MIN_CONTENT_PX || c[2] * c[3] < MIN_CHILD_AREA * kids.len() as f32 {
                    push_cell(&mut self.cells, v, CellKind::Aggregate, inner, screen);
                    continue;
                }
                if header {
                    push_cell(&mut self.cells, v, CellKind::Header, [inner[0], inner[1], inner[2], hdr], screen);
                }
                c
            };
            self.expanded[v as usize] = true;
            vals.clear();
            vals.extend(kids.iter().map(|&k| self.tree.value[k as usize]));
            squarify(&vals, content, &mut kid_rects);
            for (&k, &kr) in kids.iter().zip(&kid_rects).rev() {
                stack.push((k, kr, d + 1));
            }
        }
    }

    /// Label boxes of the cells that fit text, largest first (at most `MAX_TREEMAP_LABELS`).
    fn layout_labels(&mut self) {
        let mut out: Vec<(f32, HierarchyLabel)> = Vec::new();
        if self.opts.labels {
            for c in &self.cells {
                let [x, y, w, h] = c.rect;
                if w < LABEL_MIN_W || h < LABEL_MIN_H {
                    continue;
                }
                let flags = match c.kind {
                    CellKind::Header => 1,
                    _ if h >= VALUE_LINE_H => 2,
                    _ => 0,
                };
                let (by, bh) = if c.kind == CellKind::Header { (y, h) } else { (y + LABEL_INSET_Y, h - 2.0 * LABEL_INSET_Y) };
                let label = HierarchyLabel { node: c.node, x_css: x + LABEL_INSET_X, y_css: by, w_css: w - 2.0 * LABEL_INSET_X, h_css: bh, flags };
                out.push((w * h, label));
            }
        }
        if out.len() > MAX_TREEMAP_LABELS {
            out.select_nth_unstable_by(MAX_TREEMAP_LABELS - 1, |a, b| b.0.total_cmp(&a.0));
            out.truncate(MAX_TREEMAP_LABELS);
        }
        let mut labels: Vec<HierarchyLabel> = out.into_iter().map(|(_, l)| l).collect();
        labels.sort_by_key(|l| (l.node, l.flags & 1));
        if labels != self.labels {
            self.labels = labels;
            self.labels_revision = self.labels_revision.wrapping_add(1);
        }
    }

    /// Deepest shown node under CSS point `(x, y)`: a cell, or the parent of a header / padding.
    pub(crate) fn node_at(&self, x: f32, y: f32) -> Option<u32> {
        let mut v = self.root;
        if !contains(&self.rects[v as usize], x, y) {
            return None;
        }
        loop {
            if !self.expanded[v as usize] {
                return Some(v);
            }
            match self.tree.shown_children(v).iter().find(|&&k| contains(&self.rects[k as usize], x, y)) {
                Some(&k) => v = k,
                None => return (v != self.root).then_some(v),
            }
        }
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let screen = FlatScreen::of(view)?;
        let (x, y) = screen.css_at(view, ndc)?;
        let v = self.node_at(x, y)?;
        Some(hover_one(0, v, self.tree.value[v as usize], v))
    }

    /// World center of a laid-out node.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let r = self.rects.get(global_id as usize)?;
        let s = self.screen?;
        if r[0].is_nan() {
            return None;
        }
        let (x, y) = s.world(r[0] + 0.5 * r[2], r[1] + 0.5 * r[3]);
        Some((0, global_id, self.tree.value[global_id as usize] as f32, Vec3::new(x, y, 0.0)))
    }

    pub(crate) fn layout_info(&self) -> HierarchyLayoutInfo {
        HierarchyLayoutInfo { root: self.root, plot_css: self.plot, center_css: (0.0, 0.0), center_r_css: 0.0, hovered: None }
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
        let key = (plot, screen.pixel_ratio, self.root);
        let relayout = self.layout_key != Some(key);
        if relayout {
            self.plot = plot;
            self.layout(plot, &screen);
            self.layout_key = Some(key);
            self.layout_labels();
            self.outlined = None;
        }
        if relayout || force || self.built != Some(screen) {
            out.fills.clear();
            out.edges.clear();
            // Base colors tagged with the legend group: emphasis fades on the GPU
            for c in &self.cells {
                let base = self.colors[c.node as usize];
                let color = if c.kind == CellKind::Header { mix(base, self.style.surface, HEADER_FADE) } else { base };
                let at = out.fills.len();
                push_rect(&screen, c.rect, color, out.fills);
                let tag = self.emphasis_tag(c.node as usize);
                out.fills[at..].iter_mut().for_each(|f| f.position[3] = tag);
            }
            self.built = Some(screen);
            self.outlined = None;
            changed.fills = true;
        }
        let style = self.fill_style();
        if *out.style != style {
            *out.style = style;
            changed.style = true;
        }
        if overlay_dirty || self.outlined != Some(hovered) {
            out.overlay.clear();
            if let Some((0, v)) = hovered {
                let r = self.rects.get(v as usize).copied().unwrap_or(NO_RECT);
                if !r[0].is_nan() {
                    let r = if v == self.root { r } else { inset(r, 0.5 * TREEMAP_GAP_PX) };
                    let (x0, y0) = (screen.snap(r[0]), screen.snap(r[1]));
                    let (x1, y1) = (screen.snap(r[0] + r[2]), screen.snap(r[1] + r[3]));
                    push_outline(&screen, [x0, y0, x1 - x0, y1 - y0], OUTLINE_PX, self.style.highlight, out.overlay);
                }
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

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn treemap(parents: &[i32], values: &[f64], opts: TreemapOptions) -> (ChartState, OrbitCamera) {
        let tree = Tree::build(parents, values).unwrap();
        let chart = ChartState::new_treemap(tree, opts, HierarchyStyle::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &TreemapChart {
        match &chart.kind {
            ChartKind::Hierarchy(HierChart::Treemap(t)) => t,
            _ => unreachable!(),
        }
    }

    fn aspect(r: &[f32; 4]) -> f32 {
        r[2].max(r[3]) / r[2].min(r[3])
    }

    #[test]
    fn squarify_fills_the_rect_with_areas_proportional_to_values_and_low_aspect_ratios() {
        // Bruls et al. example: 6 6 4 3 2 2 1 in a 6 x 4 rect
        let values = [6.0, 6.0, 4.0, 3.0, 2.0, 2.0, 1.0];
        let mut out = Vec::new();
        squarify(&values, [0.0, 0.0, 6.0, 4.0], &mut out);
        assert_eq!(out.len(), 7);
        for (r, v) in out.iter().zip(values) {
            assert!((r[2] * r[3] - v as f32).abs() < 1e-4, "area {r:?} vs {v}");
        }
        // The paper's steps: rows [6 6] (1.5), [4 3] (1.81), [2], [2], [1] (25 / 9, the last
        // strip); slice-and-dice would give 6 / (1 / 6 * 4) = 9 for the 1
        let worst = out.iter().map(aspect).fold(0.0, f32::max);
        assert!(worst <= 25.0 / 9.0 + 1e-4, "worst aspect {worst}");
        assert!((aspect(&out[0]) - 1.5).abs() < 1e-4 && (aspect(&out[1]) - 1.5).abs() < 1e-4);
        // Tiles cover the rect without overlap
        let total: f32 = out.iter().map(|r| r[2] * r[3]).sum();
        assert!((total - 24.0).abs() < 1e-3);
        for (i, a) in out.iter().enumerate() {
            for b in &out[i + 1..] {
                let ox = (a[0] + a[2]).min(b[0] + b[2]) - a[0].max(b[0]);
                let oy = (a[1] + a[3]).min(b[1] + b[3]) - a[1].max(b[1]);
                assert!(ox <= 1e-4 || oy <= 1e-4, "{a:?} overlaps {b:?}");
            }
        }

        // Many random-ish values: mean aspect ratio stays low (vs slice-and-dice: thousands)
        let mut vals: Vec<f64> = (0..1000).map(|i| 1.0 + ((i * 7919) % 997) as f64).collect();
        vals.sort_by(|a, b| b.total_cmp(a));
        squarify(&vals, [0.0, 0.0, 1600.0, 900.0], &mut out);
        let total_v: f64 = vals.iter().sum();
        let mean = out.iter().map(aspect).sum::<f32>() / out.len() as f32;
        assert!(mean < 2.0, "mean aspect {mean}");
        for (r, v) in out.iter().zip(&vals) {
            let want = (*v / total_v) as f32 * 1600.0 * 900.0;
            assert!((r[2] * r[3] - want).abs() / want < 1e-3, "area ∝ value");
        }
    }

    #[test]
    fn nested_levels_get_headers_padding_and_two_pixel_gaps() {
        // root -> A (3 leaves), B (2 leaves)
        let parents = [-1, 0, 0, 1, 1, 1, 2, 2];
        let values = [0.0, 0.0, 0.0, 30.0, 20.0, 10.0, 25.0, 15.0];
        let (mut chart, cam) = treemap(&parents, &values, TreemapOptions::default());
        chart.prepare_layers(&view(&cam));
        let t = inner(&chart);
        let headers: Vec<&Cell> = t.cells.iter().filter(|c| c.kind == CellKind::Header).collect();
        assert_eq!(headers.len(), 2);
        assert!(headers.iter().all(|h| (h.rect[3] - 20.0).abs() < 1.0));
        let leaves: Vec<&Cell> = t.cells.iter().filter(|c| c.kind == CellKind::Leaf).collect();
        assert_eq!(leaves.len(), 5);
        // Any two drawn cells are >= 2 px apart (gap), never overlapping
        for (i, a) in t.cells.iter().enumerate() {
            for b in &t.cells[i + 1..] {
                let gx = b.rect[0] - (a.rect[0] + a.rect[2]);
                let gx2 = a.rect[0] - (b.rect[0] + b.rect[2]);
                let gy = b.rect[1] - (a.rect[1] + a.rect[3]);
                let gy2 = a.rect[1] - (b.rect[1] + b.rect[3]);
                let gap = gx.max(gx2).max(gy).max(gy2);
                assert!(gap >= TREEMAP_GAP_PX - 1e-3, "{a:?} {b:?} gap {gap}");
            }
        }
        // Leaf area ∝ value within a parent (padding / header taken out first)
        let area = |n: u32| t.cells.iter().find(|c| c.node == n && c.kind == CellKind::Leaf).map(|c| c.rect[2] * c.rect[3]).unwrap();
        let r = area(3) / area(5);
        assert!((r - 3.0).abs() < 0.2, "30 / 10 -> {r}");
        // Plot fill: one tri pair per cell
        assert_eq!(chart.fills.len(), t.cells.len() * 6);
        // Labels: headers + leaves, header flagged
        let (labels, _) = chart.hierarchy_labels().unwrap();
        assert!(labels.iter().any(|l| l.node == 1 && l.flags & 1 == 1));
        assert!(labels.iter().any(|l| l.node == 3 && l.flags & 1 == 0));
    }

    #[test]
    fn hover_hits_cells_headers_and_drill_relayouts_the_subtree() {
        let parents = [-1, 0, 0, 1, 1, 1, 2, 2];
        let values = [0.0, 0.0, 0.0, 30.0, 20.0, 10.0, 25.0, 15.0];
        let (mut chart, cam) = treemap(&parents, &values, TreemapOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        let t = inner(&chart);
        let screen = t.screen.unwrap();
        let ndc = |x: f32, y: f32| {
            let s = screen;
            let w = s.world(x, y);
            let n = cam.project_to_ndc(Vec3::new(w.0, w.1, 0.0)).unwrap();
            (n.x, n.y)
        };
        // Every leaf center hovers that leaf; header centers hover the parent
        let cells = t.cells.clone();
        for c in &cells {
            let p = ndc(c.rect[0] + 0.5 * c.rect[2], c.rect[1] + 0.5 * c.rect[3]);
            let hit = chart.hover_at(&v, &mut scene, p).unwrap();
            assert_eq!(hit.items[0].index, c.node, "{c:?}");
        }
        // Hover outline in the overlay layer, no fill rebuild
        let layers = chart.prepare_layers(&v);
        assert!(layers.fills.is_none());
        assert_eq!(layers.overlay.unwrap().len(), 4);
        // Outside the plot: nothing
        assert!(chart.hover_at(&v, &mut scene, (0.999, 0.999)).is_none());

        // Drill: a leaf's click target is its top-level group
        assert_eq!(chart.hierarchy_drill_target(4), Some(1));
        assert_eq!(chart.hierarchy_drill_target(1), Some(1));
        assert!(chart.set_hierarchy_root(1));
        assert!(chart.hover.is_none());
        chart.prepare_layers(&v);
        let t = inner(&chart);
        assert_eq!(t.cells.iter().filter(|c| c.kind == CellKind::Leaf).count(), 3, "only A's leaves");
        assert_eq!(chart.hierarchy_layout().unwrap().root, 1);
        // Leaves cannot be roots; drilling to the same root is a no-op
        assert!(!chart.set_hierarchy_root(3) && !chart.set_hierarchy_root(1));
        assert!(chart.set_hierarchy_root(0));
        // Keyboard item hover
        chart.prepare_layers(&v);
        let hit = chart.hover_hierarchy_item(&mut scene, 0, 6).unwrap();
        assert_eq!((hit.items[0].index, hit.items[0].value), (6, 25.0));
        assert!(chart.sample(6).is_some());
    }

    #[test]
    fn tiny_subtrees_aggregate_and_max_depth_limits_levels() {
        // One big group and one with 50 tiny leaves in a small share
        let mut parents = vec![-1, 0, 0];
        let mut values = vec![0.0, 1e6, 0.0];
        for _ in 0..50 {
            parents.push(2);
            values.push(0.01);
        }
        let (mut chart, cam) = treemap(&parents, &values, TreemapOptions::default());
        chart.prepare_layers(&view(&cam));
        let t = inner(&chart);
        assert!(t.cells.iter().any(|c| c.node == 2 && c.kind == CellKind::Aggregate) || t.cells.iter().all(|c| c.node != 2));
        assert!(t.cells.iter().all(|c| c.node < 3), "tiny leaves are not drawn individually");

        let parents = [-1, 0, 0, 1, 1, 2];
        let values = [0.0, 0.0, 0.0, 1.0, 2.0, 3.0];
        let (mut chart, cam) = treemap(&parents, &values, TreemapOptions { max_depth: 1, ..Default::default() });
        chart.prepare_layers(&view(&cam));
        let t = inner(&chart);
        assert_eq!(t.cells.iter().map(|c| (c.node, c.kind)).collect::<Vec<_>>().len(), 2);
        assert!(t.cells.iter().all(|c| c.kind == CellKind::Aggregate));
    }

    #[test]
    fn hundred_thousand_leaves_lay_out_quickly() {
        // 100 groups x 1000 leaves
        let mut parents = vec![-1i32];
        let mut values = vec![0.0f64];
        for g in 0..100 {
            parents.push(0);
            values.push(0.0);
            let gi = (parents.len() - 1) as i32;
            for k in 0..1000 {
                parents.push(gi);
                values.push(1.0 + ((g * 1000 + k) * 7919 % 1009) as f64);
            }
        }
        let t0 = std::time::Instant::now();
        let tree = Tree::build(&parents, &values).unwrap();
        let (mut chart, cam) = {
            let chart = ChartState::new_treemap(tree, TreemapOptions::default(), HierarchyStyle::default());
            let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
            cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
            chart.frame_camera(&mut cam, (1600.0, 900.0));
            (chart, cam)
        };
        let layers = chart.prepare_layers(&view(&cam));
        let tris = layers.fills.unwrap().len() / 3;
        let ms = t0.elapsed().as_secs_f64() * 1e3;
        let t = inner(&chart);
        let leaves = t.cells.iter().filter(|c| c.kind == CellKind::Leaf).count();
        println!("100k-leaf treemap: build + layout + tessellate {ms:.1} ms, {} cells, {tris} triangles", t.cells.len());
        // Debug builds are ~10x slower than release; this guards against quadratic behavior
        assert!(ms < 3000.0, "{ms} ms");
        // ~13 px^2 per leaf at 1600 x 900: the groups are drawn whole (drill to see leaves)
        let aggregates = t.cells.iter().filter(|c| c.kind == CellKind::Aggregate).count();
        assert_eq!((aggregates, leaves), (100, 0));
        let drawn: f32 = t.cells.iter().map(|c| c.rect[2] * c.rect[3]).sum();
        assert!(drawn > 0.75 * t.plot[2] * t.plot[3], "cells cover most of the plot: {drawn}");
        // Drilled into one group: its 1000 leaves are cells
        let group = chart.hierarchy_tree().unwrap().children(0)[0];
        assert!(chart.set_hierarchy_root(group));
        chart.prepare_layers(&view(&cam));
        let t = inner(&chart);
        let leaves = t.cells.iter().filter(|c| c.kind == CellKind::Leaf).count();
        assert_eq!(leaves, 1000);
        assert!(t.labels.len() <= MAX_TREEMAP_LABELS);
        // Hover stays a short descent
        let t1 = std::time::Instant::now();
        let mut scene = SceneWorld::new();
        for k in 0..200 {
            let x = -0.9 + 1.8 * (k as f32 / 200.0);
            chart.hover_at(&view(&cam), &mut scene, (x, 0.1));
        }
        assert!(t1.elapsed().as_secs_f64() * 1e3 / 200.0 < 20.0);
    }
}
