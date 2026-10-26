//! WASM bindings of the pie / donut chart (kept apart from `lib.rs`; same `WasmVizEngine`).

use crate::chart::{validate_pie, PieLabelMode, PieOptions, PieSort, PieStyle};
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

fn color4(v: &[f32]) -> Option<[f32; 4]> {
    match v {
        [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => Some([*r, *g, *b, *a]),
        _ => None,
    }
}

#[wasm_bindgen]
impl WasmVizEngine {
    /// Renders a pie (`inner_ratio` 0) or donut chart. `values` must be finite and >= 0 (else an
    /// error). `sort` 0 = input order, 1 = descending; `max_slices` < 0 = default (8), 0 = no
    /// "Other" folding; `start_angle_deg` clockwise from 12 o'clock (NaN = 0); `labels` 0 = none,
    /// 1 = outside with leader lines, 2 = inside; `label_min_angle_deg` / `label_line_px` NaN =
    /// default; `label_space_x` / `label_space_y` CSS px reserved beside / above and below the pie
    /// for outside labels. Returns the displayed slice count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_pie_chart(
        &mut self,
        values: &[f64],
        sort: u8,
        max_slices: i32,
        start_angle_deg: f32,
        clockwise: bool,
        inner_ratio: f32,
        labels: u8,
        label_min_angle_deg: f32,
        label_line_px: f32,
        label_space_x: f32,
        label_space_y: f32,
    ) -> Result<usize, JsValue> {
        validate_pie(values).map_err(|e| JsValue::from_str(&e))?;
        let d = PieOptions::default();
        let opts = PieOptions {
            sort: PieSort::from_u8(sort),
            max_slices: usize::try_from(max_slices).unwrap_or(d.max_slices),
            start_angle_deg,
            clockwise,
            inner_ratio,
            labels: PieLabelMode::from_u8(labels),
            label_min_angle_deg,
            label_line_px,
            label_space_px: [label_space_x, label_space_y],
        };
        Ok(self.inner.set_pie_chart(values, opts, PieStyle::default()))
    }

    /// Pie colors (RGBA floats): `palette` 4 per entry in fixed display order; `colors` 4 per
    /// input value (NaN entry = palette); `other` / `leader` / `surface` empty = default.
    pub fn set_chart_pie_style(&mut self, palette: &[f32], colors: &[f32], other: &[f32], leader: &[f32], surface: &[f32]) {
        let d = PieStyle::default();
        let palette: Vec<[f32; 4]> = palette.as_chunks::<4>().0.iter().filter_map(|c| color4(c)).collect();
        self.inner.set_chart_pie_style(PieStyle {
            palette: if palette.is_empty() { d.palette } else { palette },
            colors: colors.as_chunks::<4>().0.iter().map(|c| color4(c)).collect(),
            other_color: color4(other).unwrap_or(d.other_color),
            leader_color: color4(leader).unwrap_or(d.leader_color),
            surface: color4(surface).unwrap_or(d.surface),
        });
    }

    /// Displayed slices, 8 per slice: `[source (-1 = Other), value, percent (NaN = hidden),
    /// visible, r, g, b, a]`; empty without a pie.
    pub fn chart_pie_slices(&self) -> Vec<f64> {
        let Some(slices) = self.inner.chart().and_then(|c| c.pie_slices()) else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(slices.len() * 8);
        for s in slices {
            let source = s.source.map_or(-1.0, |i| i as f64);
            out.extend([source, s.value, s.percent, if s.visible { 1.0 } else { 0.0 }]);
            out.extend(s.color.iter().map(|&c| c as f64));
        }
        out
    }

    /// Input indices folded into the "Other" slice.
    pub fn chart_pie_other(&self) -> Vec<u32> {
        self.inner
            .chart()
            .and_then(|c| c.pie_other())
            .map_or_else(Vec::new, |o| o.iter().map(|&i| i as u32).collect())
    }

    /// `[revision, count, (slice, x_css, y_css, side) * count]` label anchors of the last frame
    /// (side 1 = right, -1 = left: text grows away from the pie; 0 = inside, centered).
    pub fn chart_pie_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.pie_labels()) else {
            return Vec::new();
        };
        let mut out = vec![rev as f64, labels.len() as f64];
        for l in labels {
            out.extend([l.slice as f64, l.x_css as f64, l.y_css as f64, l.side as f64]);
        }
        out
    }

    /// `[center_x, center_y, outer_radius, inner_radius (CSS px), visible total, hovered slice
    /// (-1 = none)]` of the last frame; empty without a pie.
    pub fn chart_pie_layout(&self) -> Vec<f64> {
        let Some(l) = self.inner.chart().and_then(|c| c.pie_layout()) else {
            return Vec::new();
        };
        vec![
            l.center_css.0 as f64,
            l.center_css.1 as f64,
            l.r_out_css as f64,
            l.r_in_css as f64,
            l.total,
            l.hovered.map_or(-1.0, |k| k as f64),
        ]
    }
}
