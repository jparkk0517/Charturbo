//! WASM bindings of the box plot / violin chart (kept apart from `lib.rs`; same `WasmCharturboEngine`).

use crate::chart::{
    validate_box_plot, BoxLayout, BoxPlotOptions, ViolinOptions, ViolinScale, WhiskerRule, DEFAULT_MAX_OUTLIERS,
};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

/// Values per group in `chart_box_stats`.
const STATS_STRIDE: usize = 11;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Renders a box plot (or violins) of `series_count x categories` groups. `values` holds every
    /// group's raw samples back to back, group `g = series * categories + category` owning
    /// `counts[g]` of them (NaN / inf ignored). `colors`: RGBA per series. Stats, whiskers,
    /// outliers and the KDE are computed in Rust; the samples are not kept.
    ///
    /// `layout` (NaN / missing = default): `[width, height, group_gap, gap_px, corner_radius_px,
    /// whisker_px, outlier_radius_px]`.
    /// `options`: `[whiskers (0 = Tukey, 1 = min / max, 2 = percentiles), a, b, show_outliers,
    /// show_mean, outline, max_outliers, violin, bandwidth, show_box, scale (0 = area, 1 = width),
    /// fill_opacity]`; Tukey `a` = IQR factor (default 1.5), percentiles `a` / `b` in `[0, 1]`
    /// (default 0.05 / 0.95); flags are 0 / 1; bandwidth NaN = Silverman. Returns the finite
    /// sample count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_box_chart(
        &mut self,
        values: &[f32],
        counts: &[u32],
        series_count: u32,
        categories: u32,
        colors: &[f32],
        layout: &[f32],
        options: &[f64],
    ) -> Result<usize, JsValue> {
        let (series_count, categories) = (series_count as usize, categories as usize);
        let mut offsets = Vec::with_capacity(counts.len() + 1);
        offsets.push(0usize);
        for &c in counts {
            offsets.push(offsets[offsets.len() - 1].saturating_add(c as usize));
        }
        validate_box_plot(series_count, categories, &offsets, values.len()).map_err(|e| JsValue::from_str(&e))?;
        let colors = colors
            .as_chunks::<4>()
            .0
            .iter()
            .map(|c| c.map(|v| if v.is_finite() { v.clamp(0.0, 1.0) } else { 1.0 }))
            .collect();
        Ok(self.inner.set_box_chart(
            values,
            &offsets,
            series_count,
            categories,
            colors,
            box_layout(layout),
            box_options(options),
        ))
    }

    /// `[n, min, q1, median, q3, max, mean, std, whisker_lo, whisker_hi, outliers] * groups`
    /// (group `g = series * categories + category`; an empty group is `0` then NaN), or empty
    /// without a box plot.
    pub fn chart_box_stats(&self) -> Vec<f64> {
        let Some(chart) = self.inner.chart() else { return Vec::new() };
        let Some((s, c)) = chart.box_shape() else { return Vec::new() };
        let mut out = Vec::with_capacity(s * c * STATS_STRIDE);
        for g in 0..s * c {
            match chart.box_stats(g) {
                Some(st) => out.extend([
                    st.n as f64,
                    st.min,
                    st.q1,
                    st.median,
                    st.q3,
                    st.max,
                    st.mean,
                    st.std,
                    st.whisker_lo,
                    st.whisker_hi,
                    st.outliers as f64,
                ]),
                None => {
                    out.push(0.0);
                    out.extend([f64::NAN; STATS_STRIDE - 1]);
                }
            }
        }
        out
    }

    /// Drawn (sampled, ascending) outliers of group `g`, or empty.
    pub fn chart_box_outliers(&self, group: u32) -> Vec<f32> {
        self.inner.chart().map_or_else(Vec::new, |c| c.box_outliers(group as usize).to_vec())
    }

    /// `[lo, hi, bandwidth, density * KDE_POINTS]` of a violin group, or empty.
    pub fn chart_box_kde(&self, group: u32) -> Vec<f64> {
        let Some((lo, hi, h, d)) = self.inner.chart().and_then(|c| c.box_kde(group as usize)) else {
            return Vec::new();
        };
        let mut out = vec![lo, hi, h];
        out.extend(d.iter().map(|&v| v as f64));
        out
    }

    /// `[min, max, step]` of the box plot value axis, or empty.
    pub fn chart_box_domain(&self) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.box_domain())
            .map_or_else(Vec::new, |(a, b, s)| vec![a, b, s])
    }
}

fn box_layout(p: &[f32]) -> BoxLayout {
    let d = BoxLayout::default();
    let at = |i: usize, def: f32| p.get(i).copied().filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(def);
    BoxLayout {
        width: at(0, d.width).max(1e-3),
        height: at(1, d.height).max(1e-3),
        group_gap: at(2, d.group_gap),
        gap_px: at(3, d.gap_px),
        corner_radius_px: at(4, d.corner_radius_px),
        whisker_px: at(5, d.whisker_px),
        outlier_radius_px: at(6, d.outlier_radius_px),
    }
}

fn box_options(p: &[f64]) -> BoxPlotOptions {
    let d = BoxPlotOptions::default();
    let num = |i: usize| p.get(i).copied().filter(|v| v.is_finite());
    let flag = |i: usize, def: bool| num(i).map_or(def, |v| v != 0.0);
    let whiskers = match num(0).map(|v| v as u8) {
        Some(1) => WhiskerRule::MinMax,
        Some(2) => WhiskerRule::Percentile(num(1).unwrap_or(0.05), num(2).unwrap_or(0.95)),
        _ => WhiskerRule::Tukey(num(1).filter(|k| *k >= 0.0).unwrap_or(1.5)),
    };
    let v = ViolinOptions::default();
    BoxPlotOptions {
        whiskers,
        show_outliers: flag(3, d.show_outliers),
        show_mean: flag(4, d.show_mean),
        outline: flag(5, d.outline),
        max_outliers: num(6).filter(|v| *v >= 0.0).map_or(DEFAULT_MAX_OUTLIERS, |v| v as usize),
        violin: flag(7, false).then(|| ViolinOptions {
            bandwidth: num(8).filter(|h| *h > 0.0),
            show_box: flag(9, v.show_box),
            scale: if num(10) == Some(1.0) { ViolinScale::Width } else { ViolinScale::Area },
            fill_opacity: num(11).map_or(v.fill_opacity, |o| o.clamp(0.0, 1.0) as f32),
        }),
    }
}
