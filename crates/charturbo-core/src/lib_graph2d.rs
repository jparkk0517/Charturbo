//! WASM binding of the 2D graph (ECharts `graph`; kept apart from `lib.rs`, same
//! `WasmCharturboEngine`). Hover, legend, labels and style go through the hierarchy getters.

use crate::chart::{
    validate_graph, ChartState, GraphData, GraphEdgeColor, GraphLayout, GraphOptions,
    HierarchyStyle,
};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

/// Option `at` of a flat array (missing / NaN = `None`).
fn opt(p: &[f64], at: usize) -> Option<f64> {
    p.get(at).copied().filter(|v| v.is_finite())
}

fn opt_f32(p: &[f64], at: usize, d: f32) -> f32 {
    opt(p, at).map_or(d, |v| v as f32)
}

fn opt_u32(p: &[f64], at: usize, d: u32) -> u32 {
    opt(p, at).map_or(d, |v| v.clamp(0.0, u32::MAX as f64) as u32)
}

fn opt_flag(p: &[f64], at: usize, d: bool) -> bool {
    opt(p, at).map_or(d, |v| v > 0.5)
}

/// NaN when missing (a range end computed from the data).
fn opt_nan(p: &[f64], at: usize) -> f64 {
    opt(p, at).unwrap_or(f64::NAN)
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Renders a 2D graph: one entry of `values` per node (NaN = none); `x` / `y`, `categories`
    /// (< 0 = none, else `< category_count`), `sizes` (symbol diameter, CSS px), `fixed`
    /// (0 / 1, force: stay at x / y) and `label_px` (label width estimate) empty or one per node;
    /// edges `sources[i] -> targets[i]` with `edge_widths` empty or one per edge (NaN = default).
    /// Invalid input is an error and leaves the current chart in place. `options`: `[layout
    /// (0 force, 1 circular, 2 none, 3 cartesian), edge_width_px, curveness, arrow (0 / 1),
    /// arrow_px, edge_color (0 neutral, 1 source, 2 target), edge_opacity, symbol (0 circle,
    /// 1 square, 2 diamond, 3 triangle), labels (0 / 1), rotate_label (0 / 1), label_line_px,
    /// iterations, repulsion, edge_length, gravity, x_min, x_max, y_min, y_max, x_categories]`.
    /// Returns the node count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_graph_chart(
        &mut self,
        values: &[f64],
        x: &[f64],
        y: &[f64],
        categories: &[i32],
        category_count: u32,
        sizes: &[f32],
        fixed: &[u8],
        sources: &[u32],
        targets: &[u32],
        edge_widths: &[f32],
        label_px: &[f32],
        options: &[f64],
    ) -> Result<usize, JsValue> {
        let d = GraphOptions::default();
        let opts = GraphOptions {
            layout: GraphLayout::from_u8(opt_u32(options, 0, 0).min(255) as u8),
            edge_width_px: opt_f32(options, 1, d.edge_width_px),
            curveness: opt_f32(options, 2, d.curveness),
            arrow: opt_flag(options, 3, d.arrow),
            arrow_px: opt_f32(options, 4, d.arrow_px),
            edge_color: match opt_u32(options, 5, 0) {
                1 => GraphEdgeColor::Source,
                2 => GraphEdgeColor::Target,
                _ => GraphEdgeColor::Neutral,
            },
            edge_opacity: opt_f32(options, 6, d.edge_opacity),
            symbol: opt_u32(options, 7, 0).min(3) as u8,
            labels: opt_flag(options, 8, d.labels),
            rotate_label: opt_flag(options, 9, d.rotate_label),
            label_line_px: opt_f32(options, 10, d.label_line_px),
            iterations: opt_u32(options, 11, d.iterations),
            repulsion: opt_f32(options, 12, d.repulsion),
            edge_length: opt_f32(options, 13, d.edge_length),
            gravity: opt_f32(options, 14, d.gravity),
            x_range: (opt_nan(options, 15), opt_nan(options, 16)),
            y_range: (opt_nan(options, 17), opt_nan(options, 18)),
            x_categories: opt_u32(options, 19, 0).min(1 << 20),
        };
        let data = GraphData {
            value: values.to_vec(),
            x: x.to_vec(),
            y: y.to_vec(),
            category: categories.to_vec(),
            category_count: category_count.min(1 << 16),
            size_px: sizes.to_vec(),
            fixed: fixed.iter().map(|&f| f != 0).collect(),
            sources: sources.to_vec(),
            targets: targets.to_vec(),
            edge_width: edge_widths.to_vec(),
            label_px: label_px.to_vec(),
        };
        validate_graph(&data, opts.layout).map_err(|e| JsValue::from_str(&e))?;
        Ok(self
            .inner
            .set_chart_state(ChartState::new_graph(data, opts, HierarchyStyle::default())))
    }
}
