//! WASM bindings of the ThemeRiver (streamgraph), kept apart from `lib.rs`; same
//! `WasmCharturboEngine`. Streams reuse the area chart's packed line input.

use crate::chart::{
    validate_area, AreaMode, ChartViewMode, LineLayout, LineXKind, StreamOffset, StreamOrder,
};
use crate::{line_series_from, WasmCharturboEngine};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// ThemeRiver: streams packed like `set_area_chart` (aligned samples, shared x; values are
    /// magnitudes, NaN / negative = 0 in the stack). `offset` 0 = wiggle (d3
    /// `stackOffsetWiggle`), 1 = silhouette, 2 = zero; `order` 0 = input, 1 = inside-out.
    /// `fill_opacity` NaN = 0.8. Hover, legend, zoom, streaming (`append_area_data`) and CSV are
    /// the area chart's; label anchors: `chart_theme_river_labels`.
    #[allow(clippy::too_many_arguments)]
    pub fn set_theme_river_chart(
        &mut self,
        values: Vec<f32>,
        lengths: &[u32],
        xs: Vec<f64>,
        colors: &[f32],
        widths_px: &[f32],
        width: f32,
        height: f32,
        fill_opacity: f32,
        x_kind: u8,
        offset: u8,
        order: u8,
    ) -> Result<usize, JsValue> {
        let series = line_series_from(values, lengths, xs, colors, widths_px)?;
        validate_area(&series, AreaMode::Stacked).map_err(|e| JsValue::from_str(&e))?;
        Ok(self.inner.set_theme_river_chart(
            series,
            LineLayout {
                width: width.max(1.0),
                height: height.max(1.0),
                view: ChartViewMode::Flat,
                x_kind: LineXKind::from_u8(x_kind),
            },
            StreamOffset::from_u8(offset),
            StreamOrder::from_u8(order),
            fill_opacity,
        ))
    }

    /// `[revision, count, (series, x_css, y_css, height_css) * count]`: the left end of each
    /// visible stream (bottom first), laid out by the last frame. Empty when not a ThemeRiver.
    pub fn chart_theme_river_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.theme_river_labels()) else {
            return Vec::new();
        };
        let mut out = vec![rev as f64, labels.len() as f64];
        for l in labels {
            out.extend([
                l.series as f64,
                l.x_css as f64,
                l.y_css as f64,
                l.height_css as f64,
            ]);
        }
        out
    }
}
