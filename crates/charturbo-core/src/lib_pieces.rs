//! WASM bindings of piecewise line / area series colors (chart/pieces.rs). Kept apart from
//! `lib.rs`; same `WasmCharturboEngine`.

use crate::chart::{ColorPiece, PieceDim, SeriesPieces};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

/// Floats per piece in `set_line_series_pieces`.
pub const LINE_PIECE_STRIDE: usize = 8;

/// Pieces of `LINE_PIECE_STRIDE` records (layout: see `set_line_series_pieces`); `None` when the
/// array is malformed.
pub fn decode_line_pieces(by: u8, records: &[f64]) -> Option<SeriesPieces> {
    if !records.len().is_multiple_of(LINE_PIECE_STRIDE) {
        return None;
    }
    let (records, _) = records.as_chunks::<LINE_PIECE_STRIDE>();
    let bound = |v: f64, none: f64| if v.is_nan() { none } else { v };
    let pieces = records
        .iter()
        .map(|r| ColorPiece {
            lo: bound(r[0], f64::NEG_INFINITY),
            lo_closed: r[1] != 0.0,
            hi: bound(r[2], f64::INFINITY),
            hi_closed: r[3] != 0.0,
            color: [r[4] as f32, r[5] as f32, r[6] as f32, r[7] as f32],
        })
        .collect();
    Some(SeriesPieces { dim: if by == 1 { PieceDim::X } else { PieceDim::Y }, pieces })
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Piecewise colors of line / area series `series` (ECharts visualMap `pieces`): by y
    /// (`by` 0) or x (1: data x, sample index without x), `LINE_PIECE_STRIDE` (8) floats per
    /// piece: `[lower bound (NaN = none), lower closed (1 = gte, 0 = gt), upper bound (NaN =
    /// none), upper closed (1 = lte, 0 = lt), r, g, b, a]`. The first matching piece colors a
    /// value, values outside every piece keep the series color; empty = none.
    pub fn set_line_series_pieces(&mut self, series: u32, by: u8, pieces: &[f64]) -> Result<(), JsValue> {
        let pieces = decode_line_pieces(by, pieces).ok_or_else(|| JsValue::from_str("pieces: malformed array"))?;
        self.inner.set_chart_line_pieces(series as usize, Some(pieces)).map_err(|e| JsValue::from_str(&e))
    }

    /// RGBA piece color of live sample `index` of series `series` at its drawn position (tooltip
    /// swatch), or empty for the series color.
    pub fn chart_line_piece_color(&self, series: u32, index: u32) -> Vec<f32> {
        self.inner.chart_line_piece_color(series as usize, index as usize).map_or_else(Vec::new, |c| c.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn piece_records_decode_open_ends_and_closedness() {
        let r = [f64::NAN, 0.0, 50.0, 0.0, 0.0, 1.0, 0.0, 1.0, 50.0, 1.0, f64::NAN, 1.0, 1.0, 0.0, 0.0, 0.5];
        let p = decode_line_pieces(0, &r).unwrap();
        assert_eq!(p.dim, PieceDim::Y);
        assert_eq!(
            p.pieces,
            vec![
                ColorPiece { lo: f64::NEG_INFINITY, lo_closed: false, hi: 50.0, hi_closed: false, color: [0.0, 1.0, 0.0, 1.0] },
                ColorPiece { lo: 50.0, lo_closed: true, hi: f64::INFINITY, hi_closed: true, color: [1.0, 0.0, 0.0, 0.5] },
            ]
        );
        assert_eq!(decode_line_pieces(1, &[]).unwrap(), SeriesPieces { dim: PieceDim::X, pieces: vec![] });
        assert!(decode_line_pieces(0, &r[..7]).is_none());
    }
}
