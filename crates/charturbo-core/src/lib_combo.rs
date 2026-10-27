//! WASM bindings of the combo chart (bars + lines + areas on one plot; kept apart from `lib.rs`;
//! same `WasmCharturboEngine`). Line styles of line / area series go through `set_line_series_styles`
//! in line-local order (the combo's line / area series without the bars).

use crate::chart::{BarMode, ComboLayout, ComboSeries, ComboSeriesKind, LineXKind, LineYAxis, YAutoscale};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

fn or(v: f32, default: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        default
    }
}

/// `set_combo_chart` layout array (NaN / missing = default).
fn combo_layout(v: &[f32]) -> ComboLayout {
    let d = ComboLayout::default();
    let at = |i: usize| v.get(i).copied().unwrap_or(f32::NAN);
    ComboLayout {
        width: or(at(0), d.width).max(1.0),
        height: or(at(1), d.height).max(1.0),
        bar_mode: BarMode::from_u8(or(at(2), 0.0) as u8),
        group_gap: or(at(3), d.group_gap).clamp(0.0, 0.95),
        gap_px: or(at(4), d.gap_px).max(0.0),
        corner_radius_px: or(at(5), d.corner_radius_px).max(0.0),
        fill_opacity: or(at(6), d.fill_opacity).clamp(0.0, 1.0),
        x_kind: LineXKind::from_u8(or(at(7), 0.0) as u8),
    }
}

/// `[min, max, nice]` of one y axis (NaN end = from the data, NaN nice = true).
fn y_axis(v: &[f64]) -> LineYAxis {
    let at = |i: usize| v.get(i).copied().filter(|x| x.is_finite());
    LineYAxis { min: at(0), max: at(1), autoscale: YAutoscale::None, nice: at(2).is_none_or(|n| n != 0.0) }
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Renders a 2D combo chart: `series_count` series of `values.len() / series_count` values
    /// each (flat `[series * categories + category]`, NaN = missing) sharing one x. `kinds`: per
    /// series 0 = bar, 1 = line, 2 = area; `axes`: 0 = left, 1 = right y axis (bars all use the
    /// first bar series' axis); `colors`: RGBA per series; `widths`: stroke px per series (line
    /// / area, NaN = 2); `x`: one strictly increasing value per category, or empty = category
    /// index placement.
    ///
    /// `layout` (NaN / missing = default): `[width, height, bar_mode (0 grouped, 1 stacked,
    /// 2 percent), group_gap, gap_px, corner_radius_px, fill_opacity, x_kind (0 numeric, 1 time)]`.
    /// `y_axes`: `[left_min, left_max, left_nice, right_min, right_max, right_nice]` (NaN end =
    /// from the data; nice 0 = keep data ends). Returns the data point count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_combo_chart(
        &mut self,
        values: &[f32],
        series_count: u32,
        kinds: &[u8],
        axes: &[u8],
        colors: &[f32],
        widths: &[f32],
        x: &[f64],
        layout: &[f32],
        y_axes: &[f64],
    ) -> Result<u32, JsValue> {
        let count = series_count as usize;
        if count == 0 || !values.len().is_multiple_of(count) {
            return Err(JsValue::from_str("values must hold series_count equal-length series"));
        }
        let n = values.len() / count;
        let series = (0..count)
            .map(|s| ComboSeries {
                kind: ComboSeriesKind::from_u8(kinds.get(s).copied().unwrap_or(1)),
                values: values[s * n..(s + 1) * n].to_vec(),
                axis: axes.get(s).copied().unwrap_or(0),
                color: colors
                    .get(s * 4..s * 4 + 4)
                    .map(|c| [c[0], c[1], c[2], c[3]].map(|v| if v.is_finite() { v.clamp(0.0, 1.0) } else { 1.0 }))
                    .unwrap_or([0.224, 0.529, 0.898, 1.0]),
                width_px: or(widths.get(s).copied().unwrap_or(f32::NAN), 2.0),
            })
            .collect();
        let x = (!x.is_empty()).then(|| x.to_vec());
        let y_axes = [y_axis(y_axes.get(..3).unwrap_or(&[])), y_axis(y_axes.get(3..6).unwrap_or(&[]))];
        self.inner
            .set_combo_chart(series, x, combo_layout(layout), y_axes)
            .map(|n| n as u32)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// `[min, max]` of the combo chart's left (`axis` 0) or right (1) y domain; empty without a
    /// combo chart or when no series uses that axis.
    pub fn chart_combo_y_domain(&self, axis: u8) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.combo_y_domain(axis))
            .map_or_else(Vec::new, |(lo, hi)| vec![lo, hi])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_and_axis_arrays_decode_with_defaults() {
        let l = combo_layout(&[]);
        assert_eq!(l, ComboLayout::default());
        let l = combo_layout(&[100.0, 50.0, 1.0, 0.5, f32::NAN, 0.0, 0.4, 1.0]);
        assert_eq!((l.width, l.height, l.bar_mode, l.group_gap), (100.0, 50.0, BarMode::Stacked, 0.5));
        assert_eq!((l.gap_px, l.corner_radius_px, l.fill_opacity, l.x_kind), (2.0, 0.0, 0.4, LineXKind::Time));
        let y = y_axis(&[0.0, f64::NAN, 0.0]);
        assert_eq!((y.min, y.max, y.nice), (Some(0.0), None, false));
        assert!(y_axis(&[]).nice);
    }
}
