//! WASM bindings of bar chart styling: orientation, error bars, data labels (kept apart from
//! `lib.rs`; same `WasmVizEngine`).

use crate::chart::{BarLabelMode, BarLabelOptions, BarLabelPosition, BarOrientation, BarStyle};
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmVizEngine {
    /// Orientation (0 = vertical, 1 = horizontal) and error bars of the current 2D bar chart
    /// (call right after `set_bar_chart` / `set_bar_chart_multi`; the domain and layout are
    /// rebuilt). `error_minus` / `error_plus`: value-unit errors by bar id (`series * categories +
    /// category`; empty / NaN = none). `error_color` RGBA (empty = default), `error_width_px` /
    /// `error_cap` (cap length / bar thickness) NaN = default. Returns false for 3D bars,
    /// histograms, or without a bar chart.
    pub fn set_bar_style(
        &mut self,
        orientation: u8,
        error_minus: &[f32],
        error_plus: &[f32],
        error_color: &[f32],
        error_width_px: f32,
        error_cap: f32,
    ) -> bool {
        let d = BarStyle::default();
        let color = match error_color {
            [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => [*r, *g, *b, *a],
            _ => d.error_color,
        };
        let style = BarStyle {
            orientation: BarOrientation::from_u8(orientation),
            error_minus: error_minus.to_vec(),
            error_plus: error_plus.to_vec(),
            error_color: color,
            error_width_px: if error_width_px.is_finite() { error_width_px.clamp(0.0, 16.0) } else { d.error_width_px },
            error_cap: if error_cap.is_finite() { error_cap.clamp(0.0, 1.0) } else { d.error_cap },
        };
        self.inner.chart_mut().is_some_and(|c| c.set_bar_style(style))
    }

    /// Data labels of the current bar chart: `mode` 0 = off, 1 = show, 2 = auto (hide what does
    /// not fit / collides); `position` 0 = outside, 1 = inside (data end), 2 = inside base,
    /// 3 = center. `widths`: text width (CSS px) per bar id, NaN = no label; `height`: text
    /// height; `pad_px` NaN = 4. Anchors are laid out on the next frame (`chart_bar_labels`).
    pub fn set_bar_labels(&mut self, mode: u8, position: u8, widths: &[f32], height: f32, pad_px: f32) -> bool {
        let opts = BarLabelOptions {
            mode: BarLabelMode::from_u8(mode),
            position: BarLabelPosition::from_u8(position),
            pad_px: if pad_px.is_finite() { pad_px } else { 4.0 },
        };
        let sizes = widths.iter().map(|&w| [w, height]).collect();
        self.inner.chart_mut().is_some_and(|c| c.set_bar_labels(opts, sizes))
    }

    /// `[revision, count, (bar id, center_x, center_y, inside) * count]` of the shown data labels
    /// (CSS px from the canvas top-left; inside 1 = over the bar fill), empty without a bar chart.
    pub fn chart_bar_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.bar_labels()) else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(2 + labels.len() * 4);
        out.extend([rev as f64, labels.len() as f64]);
        for l in labels {
            out.extend([l.global as f64, l.x_css as f64, l.y_css as f64, if l.inside { 1.0 } else { 0.0 }]);
        }
        out
    }
}
