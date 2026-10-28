//! WASM bindings of the scatter point styles (kept apart from `lib.rs`; same
//! `WasmCharturboEngine`): series symbol shapes, jitter, the ripple effect and trendlines.

use crate::chart::{RippleOptions, ScatterTrendline, TrendModel, MAX_TREND_ORDER};
use crate::WasmCharturboEngine;
use wasm_bindgen::prelude::*;

/// f64 per trendline of `set_chart_scatter_trendlines`.
const TRENDLINE_STRIDE: usize = 12;
/// f64 per fit of `chart_scatter_trend_fits`: used, skipped, R², coefficient count, coefficients.
const TREND_FIT_STRIDE: usize = 4 + MAX_TREND_ORDER as usize + 1;

#[wasm_bindgen]
impl WasmCharturboEngine {
    /// Symbol shape per scatter series id: 0 circle, 1 square, 2 diamond, 3 triangle (unknown
    /// codes and series beyond the list = circle). True when the points were rebuilt.
    pub fn set_chart_scatter_shapes(&mut self, shapes: &[u8]) -> bool {
        self.inner.set_chart_scatter_shapes(shapes)
    }

    /// Rippling scatter series (`flags[id] != 0`; empty = none): rings grow to `scale` point radii
    /// and fade over `period_s` seconds, `count` rings, `fill` = filled discs instead of 1.5 px
    /// strokes (NaN = defaults 4 s / 2.5; clamped). True when the points were rebuilt.
    pub fn set_chart_scatter_ripple(&mut self, flags: &[u8], period_s: f32, scale: f32, count: u32, fill: bool) -> bool {
        let d = RippleOptions::default();
        let opts = RippleOptions {
            period_s: if period_s.is_finite() { period_s } else { d.period_s },
            scale: if scale.is_finite() { scale } else { d.scale },
            count: if count == 0 { d.count } else { count },
            fill,
        };
        self.inner.set_chart_scatter_ripple(flags, opts)
    }

    /// Jitter: uniform offsets in [-x, x] / [-y, y] data units per point (scale space on log axes;
    /// 0 = none), fixed per point index and `seed`. True when the points were re-laid out.
    pub fn set_chart_scatter_jitter(&mut self, x: f64, y: f64, seed: u32) -> bool {
        self.inner.set_chart_scatter_jitter(x, y, seed)
    }

    /// Trendlines, 12 f64 each: `[series, model (0 linear, 1 exponential, 2 logarithmic,
    /// 3 polynomial), order (polynomial, clamped 2..6), r, g, b, a, width (CSS px), dash on, off,
    /// on, off (CSS px; zeros = solid)]`; records with unknown models are dropped. Each is fitted
    /// to its series by least squares. True when they changed.
    pub fn set_chart_scatter_trendlines(&mut self, lines: &[f64]) -> bool {
        let lines: Vec<ScatterTrendline> = lines
            .chunks_exact(TRENDLINE_STRIDE)
            .filter_map(|r| {
                let model = TrendModel::from_code(r[1] as u8, r[2] as u8)?;
                Some(ScatterTrendline {
                    series: r[0].clamp(0.0, u16::MAX as f64) as u16,
                    model,
                    color: [r[3] as f32, r[4] as f32, r[5] as f32, r[6] as f32],
                    width_px: r[7] as f32,
                    dash: [r[8] as f32, r[9] as f32, r[10] as f32, r[11] as f32],
                })
            })
            .collect();
        self.inner.set_chart_scatter_trendlines(&lines)
    }

    /// Fits of the trendlines in order, 11 f64 each: `[used points, skipped points (outside the
    /// model's domain), R², coefficient count (0 = no fit), coefficients (NaN-padded to 7)]`.
    /// Coefficients: linear `y = c0 + c1 x`, exponential `y = c0 e^(c1 x)`, logarithmic
    /// `y = c0 + c1 ln x`, polynomial `y = c0 + c1 x + .. + ck x^k`.
    pub fn chart_scatter_trend_fits(&self) -> Vec<f64> {
        let fits = self.inner.chart_scatter_trend_fits();
        let mut out = Vec::with_capacity(fits.len() * TREND_FIT_STRIDE);
        for fit in fits {
            out.extend([fit.used as f64, fit.skipped as f64, fit.r2, fit.coeffs.len() as f64]);
            out.extend((0..TREND_FIT_STRIDE - 4).map(|k| fit.coeffs.get(k).copied().unwrap_or(f64::NAN)));
        }
        out
    }

    /// Ripple clock in seconds (only the point uniform changes); false when nothing ripples, so
    /// the caller can stop its frame loop.
    pub fn set_chart_effect_time(&mut self, seconds: f32) -> bool {
        self.inner.set_chart_effect_time(seconds)
    }
}
