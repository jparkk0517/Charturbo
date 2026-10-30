//! WASM bindings of the polar coordinate system (kept apart from `lib.rs`; same
//! `WasmCharturboEngine`). Colors go through `set_chart_hierarchy_style`, the heatmap colormap
//! through `set_heatmap_colormap` / `set_heatmap_domain`; hover / labels / layout through the
//! hierarchy getters (`chart_hierarchy_labels`, `chart_hierarchy_layout`,
//! `chart_hover_hierarchy_item`).

use crate::chart::{
    ChartState, HierarchyStyle, PolarAxis, PolarOptions, PolarSeries, PolarSeriesKind,
};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

/// Values per series in `set_polar_chart`'s `series`.
const SERIES_STRIDE: usize = 9;
/// Values per axis in `set_polar_chart`'s `options`.
const AXIS_STRIDE: usize = 6;

/// Option `at` of a flat array (missing / NaN = `None`).
fn opt(p: &[f64], at: usize) -> Option<f64> {
    p.get(at).copied().filter(|v| v.is_finite())
}

fn opt_flag(p: &[f64], at: usize, d: bool) -> bool {
    opt(p, at).map_or(d, |v| v > 0.5)
}

/// Axis at `at`: `[categories (0 = value), min, max, split, labels, split_lines]`.
fn axis(p: &[f64], at: usize) -> PolarAxis {
    let d = PolarAxis::default();
    PolarAxis {
        categories: opt(p, at).map_or(0, |v| v.max(0.0).min(u32::MAX as f64) as usize),
        // An infinite bound reaches validation (NaN = unset)
        min: p.get(at + 1).copied().filter(|v| !v.is_nan()),
        max: p.get(at + 2).copied().filter(|v| !v.is_nan()),
        split: opt(p, at + 3).map_or(d.split, |v| v.clamp(1.0, 100.0) as u32),
        labels: opt_flag(p, at + 4, d.labels),
        split_lines: opt_flag(p, at + 5, d.split_lines),
    }
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Renders a polar chart (the scene is kept on error). `options`: `[start_angle_rad
    /// (compass), clockwise (0 / 1), inner_radius (fraction of the rim), bar_category_gap,
    /// bar_gap, label_room_px, label_line_px, angle axis (6), radius axis (6)]`, an axis being
    /// `[categories (0 = value axis), min, max, split, labels (0 / 1), split_lines (0 / 1)]`
    /// (NaN = default). `series`: 9 per series `[kind (0 bar, 1 line, 2 scatter, 3 heatmap),
    /// stack (-1 = none), round_cap, smooth, area, closed, symbol_px, line_px, item count]`.
    /// `data`: `[radius, angle, value]` per item, series after series. Returns the series count.
    pub fn set_polar_chart(
        &mut self,
        options: &[f64],
        series: &[f64],
        data: &[f64],
    ) -> Result<usize, JsValue> {
        let err = |m: String| JsValue::from_str(&m);
        if series.len() % SERIES_STRIDE != 0 {
            return Err(err(format!(
                "polar series meta must hold {SERIES_STRIDE} values per series, got {}",
                series.len()
            )));
        }
        if data.len() % 3 != 0 {
            return Err(err(format!(
                "polar data must hold 3 values per item, got {}",
                data.len()
            )));
        }
        let d = PolarOptions::default();
        let o = |at: usize| opt(options, at);
        let opts = PolarOptions {
            start_angle: o(0).map_or(d.start_angle, |v| v as f32),
            clockwise: opt_flag(options, 1, d.clockwise),
            inner_radius: o(2).map_or(d.inner_radius, |v| v as f32),
            bar_category_gap: o(3).map_or(d.bar_category_gap, |v| v as f32),
            bar_gap: o(4).map_or(d.bar_gap, |v| v as f32),
            label_room_px: o(5).map_or(d.label_room_px, |v| v as f32),
            label_line_px: o(6).map_or(d.label_line_px, |v| v as f32),
            angle: axis(options, 7),
            radius: axis(options, 7 + AXIS_STRIDE),
        };
        let mut out = Vec::with_capacity(series.len() / SERIES_STRIDE);
        let mut at = 0usize;
        for (s, m) in series.chunks_exact(SERIES_STRIDE).enumerate() {
            let kind = opt(m, 0)
                .filter(|v| v.fract() == 0.0 && *v >= 0.0)
                .and_then(|v| PolarSeriesKind::from_u8(v.min(255.0) as u8))
                .ok_or_else(|| err(format!("polar series {s}: unknown kind {}", m[0])))?;
            let count = opt(m, 8)
                .filter(|v| v.fract() == 0.0 && *v >= 0.0)
                .map(|v| v as usize);
            let Some(count) = count.filter(|&c| at + c <= data.len() / 3) else {
                return Err(err(format!(
                    "polar series {s}: item count {} exceeds the data",
                    m[8]
                )));
            };
            let items = data[at * 3..(at + count) * 3]
                .chunks_exact(3)
                .map(|c| [c[0], c[1], c[2]])
                .collect();
            at += count;
            let mut ser = PolarSeries::new(kind, items);
            ser.stack = opt(m, 1).map_or(-1, |v| {
                if v >= 0.0 {
                    v.min(i32::MAX as f64) as i32
                } else {
                    -1
                }
            });
            ser.round_cap = opt_flag(m, 2, false);
            ser.smooth = opt_flag(m, 3, false);
            ser.area = opt_flag(m, 4, false);
            ser.closed = opt_flag(m, 5, false);
            ser.symbol_px = opt(m, 6).map_or(ser.symbol_px, |v| v as f32);
            ser.line_px = opt(m, 7).map_or(ser.line_px, |v| v as f32);
            out.push(ser);
        }
        if at * 3 != data.len() {
            return Err(err(format!(
                "polar series item counts cover {at} of {} items",
                data.len() / 3
            )));
        }
        let n = out.len();
        let chart = ChartState::new_polar(opts, out, HierarchyStyle::default())
            .map_err(|e| JsValue::from_str(&e))?;
        self.inner.set_chart_state(chart);
        Ok(n)
    }

    /// Resolved polar axes: `[angle lo, hi, categories, radius lo, hi, categories, angle label
    /// count, ..angle labels, radius label count, ..radius labels]` (labels: category index or
    /// tick value, in label `node` order).
    pub fn chart_polar_axes(&self) -> Vec<f64> {
        let Some((al, rl, a, r)) = self.inner.chart().and_then(|c| c.polar_axes()) else {
            return Vec::new();
        };
        let mut out = vec![
            a.lo,
            a.hi,
            a.categories as f64,
            r.lo,
            r.hi,
            r.categories as f64,
        ];
        out.push(al.len() as f64);
        out.extend_from_slice(al);
        out.push(rl.len() as f64);
        out.extend_from_slice(rl);
        out
    }
}
