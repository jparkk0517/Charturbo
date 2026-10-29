//! WASM bindings of the calendar heatmap (kept apart from `lib.rs`; same `WasmCharturboEngine`).
//! Colors / colormap / value domain / colorbar reuse the heatmap bindings
//! (`set_chart_heatmap_colormap`, `set_chart_heatmap_domain`, `chart_heatmap_colorbar` ..).

use crate::chart::{validate_calendar, CalendarOptions, CalendarOrient, ChartState};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

fn color4(v: &[f32]) -> [f32; 4] {
    match v {
        [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => [*r, *g, *b, *a],
        _ => [0.0, 0.0, 0.0, 1.0],
    }
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Calendar heatmap. `ranges` = `[start, end]` civil day pairs (days since 1970-01-01,
    /// inclusive), one calendar block each; `days` / `values` one entry per data day (NaN value
    /// = empty; days outside every range are dropped). `orient` 0 = horizontal (week columns),
    /// 1 = vertical; `cell_size` largest cell side in CSS px (0 = fit); `cell_gap` CSS px;
    /// `first_day` 0 = Sunday .. 6; `label_px` = `[year, day of week, month]` CSS px reserved
    /// for labels (0 = hidden); `split_rgba` + `split_width` month boundary lines (width 0 =
    /// none). Returns the day count (global ids = day offsets over the blocks).
    #[allow(clippy::too_many_arguments)]
    pub fn set_calendar_chart(
        &mut self,
        ranges: &[f64],
        days: &[f64],
        values: &[f64],
        orient: u8,
        cell_size: f32,
        cell_gap: f32,
        first_day: u8,
        label_px: &[f32],
        split_rgba: &[f32],
        split_width: f32,
    ) -> Result<usize, JsValue> {
        validate_calendar(ranges, days, values.len()).map_err(|e| JsValue::from_str(&e))?;
        let px = |k: usize| label_px.get(k).copied().unwrap_or(0.0);
        let opts = CalendarOptions {
            orient: if orient == 1 {
                CalendarOrient::Vertical
            } else {
                CalendarOrient::Horizontal
            },
            cell_size,
            cell_gap,
            first_day: first_day % 7,
            year_label_px: px(0),
            day_label_px: px(1),
            month_label_px: px(2),
            split_color: color4(split_rgba),
            split_width,
        };
        Ok(self
            .inner
            .set_chart_state(ChartState::new_calendar(ranges, days, values, opts)))
    }

    /// Month split line color / width of the current calendar (theme change).
    pub fn set_chart_calendar_split_line(&mut self, rgba: &[f32], width: f32) {
        if let Some(c) = self.inner.chart_mut() {
            c.set_calendar_split_line(color4(rgba), width);
        }
    }

    /// `[revision, count, (kind, a, b, x_css, y_css, h_align, v_align) * count]`: kind 0 = day
    /// of week (a = weekday, 0 = Sunday), 1 = month (a = year, b = month 1..12), 2 = year (a =
    /// first, b = last year of the block).
    pub fn chart_calendar_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.calendar_labels()) else {
            return Vec::new();
        };
        let mut out = vec![rev as f64, labels.len() as f64];
        for l in labels {
            out.extend([
                l.kind as f64,
                l.a as f64,
                l.b as f64,
                l.x_css as f64,
                l.y_css as f64,
                l.h_align as f64,
                l.v_align as f64,
            ]);
        }
        out
    }

    /// `[(start day, end day, first global id) * blocks]`.
    pub fn chart_calendar_blocks(&self) -> Vec<f64> {
        let Some(blocks) = self.inner.chart().and_then(|c| c.calendar_blocks()) else {
            return Vec::new();
        };
        blocks
            .iter()
            .flat_map(|&(s, e, o)| [s as f64, e as f64, o as f64])
            .collect()
    }
}
