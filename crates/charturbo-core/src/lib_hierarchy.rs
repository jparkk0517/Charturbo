//! WASM bindings of the treemap / sunburst / sankey charts (kept apart from `lib.rs`; same
//! `WasmCharturboEngine`). Options travel as flat `f64` arrays (missing / NaN entries = defaults).

use crate::chart::{
    validate_sankey, ChartState, ColormapKind, HeatmapColormap, HierarchyColorBy, HierarchyStyle, SankeyAlign,
    SankeyGraph, SankeyLinkColor, SankeyOptions, SunburstOptions, Tree, TreemapOptions,
};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

fn color4(v: &[f32]) -> Option<[f32; 4]> {
    match v {
        [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => Some([*r, *g, *b, *a]),
        _ => None,
    }
}

/// Option `at` of a flat array (missing / NaN = `None`).
fn opt(p: &[f64], at: usize) -> Option<f64> {
    p.get(at).copied().filter(|v| v.is_finite())
}

fn opt_u32(p: &[f64], at: usize, d: u32) -> u32 {
    opt(p, at).map_or(d, |v| v.clamp(0.0, u32::MAX as f64) as u32)
}

fn opt_f32(p: &[f64], at: usize, d: f32) -> f32 {
    opt(p, at).map_or(d, |v| v as f32)
}

fn opt_flag(p: &[f64], at: usize, d: bool) -> bool {
    opt(p, at).map_or(d, |v| v > 0.5)
}

fn err(e: String) -> JsValue {
    JsValue::from_str(&e)
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Renders a squarified treemap. `parents`: parent index per node (-1 = root; several roots
    /// get a virtual root at index `n`); `values`: leaf values, finite and >= 0 (NaN = 0; parent
    /// values are the sums of their children). Cycles / bad values are errors. `options`:
    /// `[max_depth (0 = all), padding_px, header_px, color_by (0 auto, 1 group, 2 value),
    /// labels (0 / 1)]`. Returns the node count (incl. a virtual root).
    pub fn set_treemap_chart(&mut self, parents: &[i32], values: &[f64], options: &[f64]) -> Result<usize, JsValue> {
        let tree = Tree::build(parents, values).map_err(err)?;
        let d = TreemapOptions::default();
        let opts = TreemapOptions {
            max_depth: opt_u32(options, 0, d.max_depth),
            padding_px: opt_f32(options, 1, d.padding_px),
            header_px: opt_f32(options, 2, d.header_px),
            color_by: HierarchyColorBy::from_u8(opt_u32(options, 3, 0) as u8),
            labels: opt_flag(options, 4, d.labels),
        };
        Ok(self.inner.set_chart_state(ChartState::new_treemap(tree, opts, HierarchyStyle::default())))
    }

    /// Renders a sunburst (same tree input as `set_treemap_chart`). `options`: `[max_depth
    /// (0 = all), color_by, labels (0 / 1), label_line_px]`.
    pub fn set_sunburst_chart(&mut self, parents: &[i32], values: &[f64], options: &[f64]) -> Result<usize, JsValue> {
        let tree = Tree::build(parents, values).map_err(err)?;
        let d = SunburstOptions::default();
        let opts = SunburstOptions {
            max_depth: opt_u32(options, 0, d.max_depth),
            color_by: HierarchyColorBy::from_u8(opt_u32(options, 1, 0) as u8),
            labels: opt_flag(options, 2, d.labels),
            label_line_px: opt_f32(options, 3, d.label_line_px),
        };
        Ok(self.inner.set_chart_state(ChartState::new_sunburst(tree, opts, HierarchyStyle::default())))
    }

    /// Renders a sankey diagram: links `sources[i] -> targets[i]` with `values[i]` (finite,
    /// >= 0) between `node_count` nodes; `columns`: empty or one per node (< 0 = computed);
    /// `groups`: empty or a color group per node (< 0 = none). Cycles are errors naming the node
    /// chain. `options`: `[node_width_px, node_padding_px, iterations, align (0 justify, 1 left,
    /// 2 right, 3 center), link_color (0 source, 1 target, 2 neutral), link_opacity, labels,
    /// label_line_px]`. Returns nodes + links.
    #[allow(clippy::too_many_arguments)]
    pub fn set_sankey_chart(
        &mut self,
        node_count: u32,
        sources: &[u32],
        targets: &[u32],
        values: &[f64],
        columns: &[i32],
        groups: &[i32],
        options: &[f64],
    ) -> Result<usize, JsValue> {
        let graph = SankeyGraph {
            node_count: node_count as usize,
            sources: sources.to_vec(),
            targets: targets.to_vec(),
            values: values.to_vec(),
            columns: columns.to_vec(),
            groups: groups.to_vec(),
        };
        validate_sankey(&graph).map_err(err)?;
        let d = SankeyOptions::default();
        let opts = SankeyOptions {
            node_width_px: opt_f32(options, 0, d.node_width_px),
            node_padding_px: opt_f32(options, 1, d.node_padding_px),
            iterations: opt_u32(options, 2, d.iterations),
            align: SankeyAlign::from_u8(opt_u32(options, 3, 0) as u8),
            link_color: SankeyLinkColor::from_u8(opt_u32(options, 4, 0) as u8),
            link_opacity: opt_f32(options, 5, d.link_opacity),
            labels: opt_flag(options, 6, d.labels),
            label_line_px: opt_f32(options, 7, d.label_line_px),
        };
        Ok(self.inner.set_chart_state(ChartState::new_sankey(graph, opts, HierarchyStyle::default())))
    }

    /// Hierarchy / sankey colors (RGBA floats): `palette` 4 per entry in fixed order; `colors`
    /// 4 per input node (NaN entry = automatic); `other` / `surface` / `highlight` empty =
    /// default; `colormap` = value-mode colormap (0 sequential, 1 viridis, 2 magma).
    pub fn set_chart_hierarchy_style(
        &mut self,
        palette: &[f32],
        colors: &[f32],
        other: &[f32],
        surface: &[f32],
        highlight: &[f32],
        colormap: u8,
    ) {
        let d = HierarchyStyle::default();
        let palette: Vec<[f32; 4]> = palette.as_chunks::<4>().0.iter().filter_map(|c| color4(c)).collect();
        let surface = color4(surface).unwrap_or(d.surface);
        let kind = match ColormapKind::from_u8(colormap) {
            // Diverging needs a center: not a hierarchy value scale
            ColormapKind::Diverging => ColormapKind::Sequential,
            k => k,
        };
        if let Some(chart) = self.inner.chart_mut() {
            chart.set_hierarchy_style(HierarchyStyle {
                palette: if palette.is_empty() { d.palette } else { palette },
                colors: colors.as_chunks::<4>().0.iter().map(|c| color4(c)).collect(),
                other_color: color4(other).unwrap_or(d.other_color),
                surface,
                highlight: color4(highlight).unwrap_or(d.highlight),
                colormap: HeatmapColormap { kind, surface, ..d.colormap },
            });
        }
    }

    /// `[node_count, tree root, virtual root (0 / 1), current root]` of a treemap / sunburst;
    /// empty otherwise.
    pub fn chart_hierarchy_info(&self) -> Vec<f64> {
        let Some(chart) = self.inner.chart() else {
            return Vec::new();
        };
        let (Some(t), Some(l)) = (chart.hierarchy_tree(), chart.hierarchy_layout()) else {
            return Vec::new();
        };
        vec![t.len() as f64, t.root as f64, if t.virtual_root { 1.0 } else { 0.0 }, l.root as f64]
    }

    /// Aggregated value per node (a virtual root last).
    pub fn chart_hierarchy_values(&self) -> Vec<f64> {
        self.inner.chart().and_then(|c| c.hierarchy_tree()).map_or_else(Vec::new, |t| t.value.clone())
    }

    /// Children of `node` with a positive value, largest first (drawing / keyboard order).
    pub fn chart_hierarchy_children(&self, node: u32) -> Vec<u32> {
        match self.inner.chart().and_then(|c| c.hierarchy_tree()) {
            Some(t) if (node as usize) < t.len() => t.shown_children(node).to_vec(),
            _ => Vec::new(),
        }
    }

    /// Display color per node, 4 floats each (treemap / sunburst / sankey nodes).
    pub fn chart_hierarchy_colors(&self) -> Vec<f32> {
        self.inner
            .chart()
            .and_then(|c| c.hierarchy_colors())
            .map_or_else(Vec::new, |c| c.iter().flatten().copied().collect())
    }

    /// Legend entries, 5 per entry: `[group node (-1 = Other), r, g, b, a]`.
    pub fn chart_hierarchy_legend(&self) -> Vec<f64> {
        let Some(legend) = self.inner.chart().and_then(|c| c.hierarchy_legend()) else {
            return Vec::new();
        };
        legend.iter().flat_map(|(g, c)| [*g as f64, c[0] as f64, c[1] as f64, c[2] as f64, c[3] as f64]).collect()
    }

    /// `[revision, count, (node, x, y, w, h, flags) * count]` label anchors of the last frame
    /// (CSS px). Treemap: text box, flags 1 = header, +2 = value line fits. Sunburst: text
    /// center + max width. Sankey: anchor beside the node, flags = side (1 right, -1 left).
    pub fn chart_hierarchy_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.hierarchy_labels()) else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(2 + labels.len() * 6);
        out.extend([rev as f64, labels.len() as f64]);
        for l in labels {
            out.extend([l.node as f64, l.x_css as f64, l.y_css as f64, l.w_css as f64, l.h_css as f64, l.flags as f64]);
        }
        out
    }

    /// `[current root, plot left, top, width, height, center x, center y, center radius,
    /// hovered series (-1 = none), hovered index]` of the last frame (CSS px).
    pub fn chart_hierarchy_layout(&self) -> Vec<f64> {
        let Some(l) = self.inner.chart().and_then(|c| c.hierarchy_layout()) else {
            return Vec::new();
        };
        let (hs, hi) = l.hovered.map_or((-1.0, -1.0), |(s, i)| (s as f64, i as f64));
        let p = l.plot_css;
        vec![
            l.root as f64,
            p[0] as f64,
            p[1] as f64,
            p[2] as f64,
            p[3] as f64,
            l.center_css.0 as f64,
            l.center_css.1 as f64,
            l.center_r_css as f64,
            hs,
            hi,
        ]
    }

    /// Node a click on `node` drills into (treemap: the current root's child containing it;
    /// sunburst: the arc itself, the center = up), or -1.
    pub fn chart_hierarchy_drill_target(&self, node: u32) -> i32 {
        self.inner.chart().and_then(|c| c.hierarchy_drill_target(node)).map_or(-1, |v| v as i32)
    }

    /// Shows the subtree of `node` (must have children). Returns true when the root changed.
    pub fn set_chart_hierarchy_root(&mut self, node: u32) -> bool {
        self.inner.chart_mut().is_some_and(|c| c.set_hierarchy_root(node))
    }

    /// Hovers node (`series` 0) or sankey link (`series` 1) `index` directly; same layout as
    /// `chart_hover_at_ndc` (keyboard focus).
    pub fn chart_hover_hierarchy_item(&mut self, series: u32, index: u32) -> Vec<f64> {
        crate::flat_hover(self.inner.chart_hover_hierarchy_item(series, index))
    }

    /// Sankey nodes, 8 each: `[column, value, inflow, outflow, x0, y0, x1, y1]` (value = the
    /// larger flow; positions in CSS px of the last frame, NaN before the first one).
    pub fn chart_sankey_nodes(&self) -> Vec<f64> {
        let Some(s) = self.inner.chart().and_then(|c| c.sankey()) else {
            return Vec::new();
        };
        let (values, flows, layers, laid) = (s.node_values(), s.node_flows(), s.node_layers(), s.nodes());
        let mut out = Vec::with_capacity(values.len() * 8);
        for (v, &value) in values.iter().enumerate() {
            out.extend([layers[v] as f64, value, flows[v].0, flows[v].1]);
            match laid.get(v) {
                Some(n) => out.extend([n.x0 as f64, n.y0 as f64, n.x1 as f64, n.y1 as f64]),
                None => out.extend([f64::NAN; 4]),
            }
        }
        out
    }

    /// Sankey links, 4 each: `[source, target, value, percent of the source's value]`.
    pub fn chart_sankey_links(&self) -> Vec<f64> {
        let Some(s) = self.inner.chart().and_then(|c| c.sankey()) else {
            return Vec::new();
        };
        s.link_shares().into_iter().flat_map(|(a, b, v, p)| [a as f64, b as f64, v, p]).collect()
    }
}
