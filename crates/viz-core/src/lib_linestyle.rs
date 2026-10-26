//! WASM bindings of per-series line styles (markers, dashes, curves, null policies, range
//! bands; see chart/linestyle.rs). Kept apart from `lib.rs`; same `WasmVizEngine`.

use crate::chart::{LineCurve, LineSeriesStyle, MarkerShape, MarkerShow, NullPolicy, SeriesMarker};
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

/// Floats per series in `set_line_series_styles`.
pub const LINE_STYLE_STRIDE: usize = 18;

fn color4(v: &[f32]) -> Option<[f32; 4]> {
    match v {
        [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => Some([*r, *g, *b, *a]),
        _ => None,
    }
}

fn or(v: f32, default: f32) -> f32 {
    if v.is_finite() {
        v
    } else {
        default
    }
}

/// Style of one `LINE_STYLE_STRIDE` record (layout: see `set_line_series_styles`).
pub fn decode_line_style(r: &[f32]) -> LineSeriesStyle {
    let marker = MarkerShape::from_code(r[0]).map(|shape| {
        let d = SeriesMarker::default();
        SeriesMarker {
            shape,
            size_px: or(r[1], d.size_px).max(0.0),
            fill: color4(&r[2..6]),
            stroke: color4(&r[6..10]),
            stroke_px: or(r[10], d.stroke_px).max(0.0),
            show: match r[11] as i32 {
                1 => MarkerShow::Always,
                2 => MarkerShow::Never,
                _ => MarkerShow::Auto,
            },
        }
    });
    // `[on, off, on, off]` as sent (the SDK expands `[a]`); NaN = 0, zero ink / gap = solid
    let dash: Vec<f32> = r[12..16].iter().map(|&d| or(d, 0.0)).collect();
    LineSeriesStyle {
        marker,
        dash: crate::chart::normalize_dash(&dash),
        curve: LineCurve::from_u8(or(r[16], 0.0) as u8),
        nulls: NullPolicy::from_u8(or(r[17], 0.0) as u8),
    }
}

#[wasm_bindgen]
impl WasmVizEngine {
    /// Per-series styles of the active line / area chart, `LINE_STYLE_STRIDE` (18) floats per
    /// series: `[marker shape (0 circle, 1 square, 2 diamond, 3 triangle; else no markers),
    /// marker diameter px (NaN = 6), fill RGBA (NaN = series color), stroke RGBA (NaN = chart
    /// surface), stroke px (NaN = 1), show (0 auto, 1 always, 2 never), dash on / off / on / off
    /// CSS px (0 = unused; all 0 = solid), curve (0 linear, 1 step, 2 stepBefore, 3 stepAfter,
    /// 4 monotone), nulls (0 gap, 1 connect, 2 zero)]`. Missing series keep the defaults.
    /// False for other chart kinds or a malformed array.
    pub fn set_line_series_styles(&mut self, styles: &[f32]) -> bool {
        if !styles.len().is_multiple_of(LINE_STYLE_STRIDE) {
            return false;
        }
        let Some(chart) = self.inner.chart_mut() else {
            return false;
        };
        let (records, _) = styles.as_chunks::<LINE_STYLE_STRIDE>();
        chart.set_line_styles(records.iter().map(|r| decode_line_style(r)).collect())
    }

    /// Range band (error band) of series `series`: one `lower` / `upper` value per live sample
    /// (NaN = missing), filled beneath the stroke at `opacity` x the series color (NaN = 0.2).
    pub fn set_line_series_band(&mut self, series: u32, lower: &[f32], upper: &[f32], opacity: f32) -> Result<(), JsValue> {
        let Some(chart) = self.inner.chart_mut() else {
            return Err(JsValue::from_str("no chart"));
        };
        chart
            .set_line_band(series as usize, lower.to_vec(), upper.to_vec(), opacity)
            .map_err(|e| JsValue::from_str(&e))
    }

    pub fn clear_line_series_band(&mut self, series: u32) {
        if let Some(chart) = self.inner.chart_mut() {
            chart.clear_line_band(series as usize);
        }
    }

    /// `[lower, upper]` of the band of `series` at live sample `index` (tooltips), or empty.
    pub fn chart_line_band_at(&self, series: u32, index: u32) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.line_band_at(series as usize, index as usize))
            .map_or_else(Vec::new, |(lo, hi)| vec![lo as f64, hi as f64])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn style_records_decode_with_defaults() {
        let mut r = [f32::NAN; LINE_STYLE_STRIDE];
        let st = decode_line_style(&r);
        assert_eq!(st, LineSeriesStyle::default(), "all NaN = plain line");
        r[0] = 3.0;
        r[1] = 10.0;
        r[11] = 1.0;
        r[12..16].copy_from_slice(&[6.0, 3.0, 0.0, 0.0]);
        r[16] = 4.0;
        r[17] = 2.0;
        let st = decode_line_style(&r);
        let m = st.marker.unwrap();
        assert_eq!((m.shape, m.size_px, m.fill, m.stroke_px, m.show), (MarkerShape::Triangle, 10.0, None, 1.0, MarkerShow::Always));
        assert_eq!(st.dash, [6.0, 3.0, 0.0, 0.0]);
        assert_eq!((st.curve, st.nulls), (LineCurve::Monotone, NullPolicy::Zero));
        r[0] = -1.0;
        assert!(decode_line_style(&r).marker.is_none());
        // Zero ink or zero gap = solid (not re-expanded)
        r[12..16].copy_from_slice(&[4.0, 0.0, 0.0, 0.0]);
        assert_eq!(decode_line_style(&r).dash, [0.0; 4]);
        r[12..16].copy_from_slice(&[0.0, 4.0, 0.0, 0.0]);
        assert_eq!(decode_line_style(&r).dash, [0.0; 4]);
    }
}
