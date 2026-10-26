//! WASM bindings of the heatmap chart (kept apart from `lib.rs`; same `WasmVizEngine`).

use crate::chart::{validate_heatmap, ColormapKind, HeatmapColormap, HeatmapDomain, HeatmapLayout};
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

/// `[a, b]` of a 2-entry array with finite, distinct ends, else `None`.
fn extent(v: &[f64]) -> Option<(f64, f64)> {
    match v {
        [a, b] if a.is_finite() && b.is_finite() && a != b => Some((*a, *b)),
        _ => None,
    }
}

fn color4(v: &[f32]) -> Option<[f32; 4]> {
    match v {
        [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => Some([*r, *g, *b, *a]),
        _ => None,
    }
}

#[wasm_bindgen]
impl WasmVizEngine {
    /// Renders a `cols x rows` heatmap from row-major `values` (NaN = empty cell, at most
    /// `MAX_HEATMAP_CELLS`) as one textured quad. `x_extent` / `y_extent`: empty = categorical
    /// (tick value = column / row index), else `[left, right]` / `[bottom, top]` data units of
    /// the grid edges. `row0_top`: row 0 drawn at the top (matrix order).
    #[allow(clippy::too_many_arguments)]
    pub fn set_heatmap_chart(
        &mut self,
        cols: u32,
        rows: u32,
        values: &[f32],
        width: f32,
        height: f32,
        row0_top: bool,
        x_extent: &[f64],
        y_extent: &[f64],
    ) -> Result<usize, JsValue> {
        let (cols, rows) = (cols as usize, rows as usize);
        validate_heatmap(cols, rows, values.len()).map_err(|e| JsValue::from_str(&e))?;
        let d = HeatmapLayout::default();
        let size = |v: f32, def: f32| if v.is_finite() && v > 0.0 { v } else { def };
        let layout = HeatmapLayout {
            width: size(width, d.width),
            height: size(height, d.height),
            row0_top,
            x_extent: extent(x_extent),
            y_extent: extent(y_extent),
        };
        Ok(self.inner.set_heatmap_chart(cols, rows, values.to_vec(), layout))
    }

    /// Heatmap colormap: `kind` 0 = sequential (one hue light -> dark), 1 = viridis, 2 = magma,
    /// 3 = diverging; `hue` empty or RGBA (sequential hue source); `surface` RGBA of the chart
    /// background (dark surfaces flip the sequential / diverging lightness anchors); `empty`
    /// RGBA of NaN cells (empty = transparent).
    pub fn set_chart_heatmap_colormap(&mut self, kind: u8, hue: &[f32], reverse: bool, surface: &[f32], empty: &[f32]) {
        let d = HeatmapColormap::default();
        self.inner.set_chart_heatmap_colormap(HeatmapColormap {
            kind: ColormapKind::from_u8(kind),
            hue: color4(hue),
            reverse,
            surface: color4(surface).unwrap_or(d.surface),
            empty: color4(empty).unwrap_or(d.empty),
        });
    }

    /// Heatmap value domain overrides (NaN = from the data / automatic diverging center).
    pub fn set_chart_heatmap_domain(&mut self, min: f64, max: f64, center: f64) {
        let some = |v: f64| v.is_finite().then_some(v);
        self.inner.set_chart_heatmap_domain(HeatmapDomain { min: some(min), max: some(max), center: some(center) });
    }

    /// `[lo, hi, center (NaN = sequential), count, (value, position in [0, 1]) * count]` of the
    /// heatmap colorbar, or empty without a heatmap.
    pub fn chart_heatmap_colorbar(&self) -> Vec<f64> {
        let Some(bar) = self.inner.chart().and_then(|c| c.heatmap_colorbar()) else {
            return Vec::new();
        };
        let s = bar.scale;
        let mut out = vec![s.lo as f64, s.hi as f64, s.center.map_or(f64::NAN, |c| c as f64), bar.ticks.len() as f64];
        for (v, t) in bar.ticks {
            out.extend([v, t as f64]);
        }
        out
    }

    /// Colormap LUT as `256 * 4` RGBA8 bytes (low -> high), or empty without a heatmap.
    pub fn chart_heatmap_lut(&self) -> Vec<u8> {
        self.inner
            .chart()
            .and_then(|c| c.heatmap_lut())
            .map_or_else(Vec::new, |lut| lut.iter().flatten().copied().collect())
    }

    /// Displayed RGBA8 color of `value` (the empty-cell color for NaN), or empty.
    pub fn chart_heatmap_color(&self, value: f32) -> Vec<u8> {
        self.inner.chart().and_then(|c| c.heatmap_color(value)).map_or_else(Vec::new, |c| c.to_vec())
    }

    /// `[cols, rows]` of the heatmap grid, or empty.
    pub fn chart_heatmap_shape(&self) -> Vec<u32> {
        self.inner
            .chart()
            .and_then(|c| c.heatmap_shape())
            .map_or_else(Vec::new, |(c, r)| vec![c as u32, r as u32])
    }
}
