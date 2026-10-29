//! WASM bindings of parallel coordinates (kept apart from `lib.rs`; same `WasmCharturboEngine`).
//! Color-by-dimension colormap / domain / colorbar reuse the heatmap bindings
//! (`set_chart_heatmap_colormap`, `set_chart_heatmap_domain`, `chart_heatmap_colorbar` ..).

use crate::chart::{
    validate_parallel, ChartState, ParallelAxisKind, ParallelDim, ParallelOptions, ParallelOrient,
    ParallelStyle,
};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

fn color4(v: &[f32], fallback: [f32; 4]) -> [f32; 4] {
    match v {
        [r, g, b, a, ..] if [r, g, b, a].iter().all(|c| c.is_finite()) => [*r, *g, *b, *a],
        _ => fallback,
    }
}

fn finite(v: Option<f64>) -> Option<f64> {
    v.filter(|v| v.is_finite())
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Parallel coordinates. Per dimension: `kinds` (0 = value, 1 = category, 2 = time epoch
    /// ms), `ranges` = `[min, max]` pairs (NaN = from the data), `inverse` (0 / 1), `categories`
    /// (category axes). `values` row-major `rows x dims` (NaN = missing); `series` one index per
    /// row (empty = all 0). `options` = `[orient (0 = horizontal, 1 = vertical), line width px,
    /// opacity, smooth (0 / 1), color dim (-1 = by series), series count]`. Returns the row count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_parallel_chart(
        &mut self,
        kinds: &[u8],
        ranges: &[f64],
        inverse: &[u8],
        categories: &[u32],
        values: &[f64],
        series: &[u32],
        options: &[f64],
    ) -> Result<usize, JsValue> {
        let dims: Vec<ParallelDim> = (0..kinds.len())
            .map(|i| ParallelDim {
                kind: match kinds[i] {
                    1 => ParallelAxisKind::Category,
                    2 => ParallelAxisKind::Time,
                    _ => ParallelAxisKind::Value,
                },
                min: finite(ranges.get(2 * i).copied()),
                max: finite(ranges.get(2 * i + 1).copied()),
                inverse: inverse.get(i).is_some_and(|&v| v != 0),
                categories: categories.get(i).copied().unwrap_or(0),
            })
            .collect();
        let d = ParallelOptions::default();
        let opt = |k: usize| options.get(k).copied().filter(|v| v.is_finite());
        let opts = ParallelOptions {
            orient: if opt(0) == Some(1.0) {
                ParallelOrient::Vertical
            } else {
                ParallelOrient::Horizontal
            },
            line_width: opt(1).map_or(d.line_width, |v| v as f32),
            opacity: opt(2).map_or(d.opacity, |v| v as f32),
            smooth: opt(3).is_some_and(|v| v != 0.0),
            color_dim: opt(4).filter(|&v| v >= 0.0).map(|v| v as usize),
            series_count: opt(5).map_or(d.series_count, |v| v.clamp(1.0, 1e6) as usize),
        };
        validate_parallel(&dims, values, series, &opts).map_err(|e| JsValue::from_str(&e))?;
        let chart = ChartState::new_parallel(&dims, values, series, opts, ParallelStyle::default());
        self.inner.set_chart_state(chart);
        Ok(values.len() / dims.len())
    }

    /// Theme colors of the current parallel chart: `series_rgba` flat RGBA per series (cycled),
    /// axis line, brush band, inactive (brushed-out) blend color (`a` = blend amount), their
    /// widths (CSS px) and the inactive row opacity.
    #[allow(clippy::too_many_arguments)]
    pub fn set_chart_parallel_style(
        &mut self,
        series_rgba: &[f32],
        axis_rgba: &[f32],
        axis_width: f32,
        brush_rgba: &[f32],
        brush_width: f32,
        inactive_rgba: &[f32],
        inactive_opacity: f32,
        hover_width: f32,
    ) {
        let d = ParallelStyle::default();
        let mut series_colors: Vec<[f32; 4]> = series_rgba
            .chunks_exact(4)
            .map(|c| color4(c, d.series_colors[0]))
            .collect();
        if series_colors.is_empty() {
            series_colors = d.series_colors.clone();
        }
        let style = ParallelStyle {
            series_colors,
            axis_color: color4(axis_rgba, d.axis_color),
            axis_width,
            brush_color: color4(brush_rgba, d.brush_color),
            brush_width,
            inactive_color: color4(inactive_rgba, d.inactive_color),
            inactive_opacity,
            hover_width,
        };
        if let Some(c) = self.inner.chart_mut() {
            c.set_parallel_style(style);
        }
    }

    /// Replaces the brush: flat `[axis, lo, hi, ...]` (empty = clear). Returns the active row
    /// count; invalid intervals leave the brush unchanged and throw.
    pub fn set_chart_parallel_brush(&mut self, intervals: &[f64]) -> Result<usize, JsValue> {
        if intervals.len() % 3 != 0 {
            return Err(JsValue::from_str(
                "parallel brush intervals are [axis, lo, hi] triples",
            ));
        }
        let list: Vec<(usize, f64, f64)> = intervals
            .chunks_exact(3)
            .map(|c| {
                (
                    if c[0].is_finite() && c[0] >= 0.0 {
                        c[0] as usize
                    } else {
                        usize::MAX
                    },
                    c[1],
                    c[2],
                )
            })
            .collect();
        self.inner
            .chart_set_parallel_brush(&list)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Current brush as flat `[axis, lo, hi, ...]`.
    pub fn chart_parallel_brush(&self) -> Vec<f64> {
        self.inner
            .chart()
            .map(|c| {
                c.parallel_brush()
                    .into_iter()
                    .flat_map(|(a, lo, hi)| [a as f64, lo, hi])
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Visible rows inside the brush (every visible row without one).
    pub fn chart_parallel_active_count(&self) -> usize {
        self.inner.chart().map_or(0, |c| c.parallel_active_count())
    }

    /// Indices of the active rows.
    pub fn chart_parallel_active_rows(&self) -> Vec<u32> {
        self.inner
            .chart()
            .map(|c| c.parallel_active_rows())
            .unwrap_or_default()
    }

    /// `[axis, value]` of the axis under an NDC pointer (empty = none).
    pub fn chart_parallel_axis_hit(&self, ndc_x: f32, ndc_y: f32) -> Vec<f64> {
        self.inner
            .chart_parallel_axis_hit((ndc_x, ndc_y))
            .map(|(a, v)| vec![a as f64, v])
            .unwrap_or_default()
    }

    /// Hovers row `row` by index (keyboard focus): the hover result like `chart_hover_at_ndc`
    /// (empty for hidden rows / no parallel chart).
    pub fn chart_hover_parallel_row(&mut self, row: u32) -> Vec<f64> {
        crate::flat_hover(self.inner.chart_hover_parallel_row(row))
    }

    /// Data value of `axis` at an NDC pointer, clamped to the axis (NaN = none).
    pub fn chart_parallel_value_at(&self, axis: u32, ndc_x: f32, ndc_y: f32) -> f64 {
        self.inner
            .chart_parallel_value_at(axis as usize, (ndc_x, ndc_y))
            .unwrap_or(f64::NAN)
    }

    /// `[lo, hi]` per axis (category axes: `[0, categories - 1]`).
    pub fn chart_parallel_domains(&self) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.parallel_domains())
            .map(|d| d.into_iter().flat_map(|(lo, hi)| [lo, hi]).collect())
            .unwrap_or_default()
    }

    /// `[revision, count, (kind, axis, value, x_css, y_css, h_align, v_align, gran) * count]`:
    /// kind 0 = tick (value in data units; time ticks carry their granularity), 1 = axis name.
    pub fn chart_parallel_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.parallel_labels()) else {
            return Vec::new();
        };
        let mut out = vec![rev as f64, labels.len() as f64];
        for l in labels {
            out.extend([
                l.kind as f64,
                l.axis as f64,
                l.value,
                l.x_css as f64,
                l.y_css as f64,
                l.h_align as f64,
                l.v_align as f64,
                l.gran as f64,
            ]);
        }
        out
    }
}
