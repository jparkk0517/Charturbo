//! WASM bindings of the business charts: radar, gauge, funnel, waterfall (kept apart from
//! `lib.rs`; same `WasmVizEngine`). Colors are RGBA floats, 4 per entry; NaN = default for
//! optional floats.

use crate::chart::{
    validate_funnel, validate_gauge, validate_radar, validate_waterfall, BarLayout, BarOrientation, ChartState, ChartViewMode,
    FunnelOptions, FunnelOrientation, FunnelShape, GaugeBand, GaugeIndicator, GaugeOptions, GaugeStyle, RadarGridShape,
    RadarOptions, WaterfallOptions, WaterfallStyle,
};
use crate::WasmVizEngine;
use wasm_bindgen::prelude::*;

fn color4(v: &[f32]) -> Option<[f32; 4]> {
    match v {
        [r, g, b, a] if [r, g, b, a].iter().all(|c| c.is_finite()) => Some([*r, *g, *b, *a]),
        _ => None,
    }
}

/// Colors of a flat RGBA array (invalid entries = `fallback`).
fn colors(v: &[f32], fallback: [f32; 4]) -> Vec<[f32; 4]> {
    v.as_chunks::<4>().0.iter().map(|c| color4(c).unwrap_or(fallback)).collect()
}

/// Entry `k` (4 floats) of a flat RGBA array, else `d`.
fn color_at(v: &[f32], k: usize, d: [f32; 4]) -> [f32; 4] {
    v.get(k * 4..k * 4 + 4).and_then(color4).unwrap_or(d)
}

const BLUE: [f32; 4] = [0.224, 0.529, 0.898, 1.0];

/// `[revision, count, (fields...) * count]` label exports.
fn labels_out<T>(labels: &[T], rev: u32, fields: impl Fn(&T) -> Vec<f64>) -> Vec<f64> {
    let mut out = vec![rev as f64, labels.len() as f64];
    for l in labels {
        out.extend(fields(l));
    }
    out
}

#[wasm_bindgen]
impl WasmVizEngine {
    /// Radar chart: `values` flat `[series * axes + axis]` (finite >= 0, NaN = missing; at least
    /// 3 axes, else an error), `colors` one RGBA per series. `max` NaN = nice max of the data;
    /// `axis_max` per axis (NaN = shared); `rings` 0 = default (4); `fill_opacity` /
    /// `stroke_px` / `marker_radius_px` NaN = default; `start_angle_deg` clockwise from 12
    /// o'clock; `grid` 0 = polygon, 1 = circle; `label_space_x` / `label_space_y` CSS px kept
    /// beside / above and below the outer ring for axis labels. Returns the point count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_radar_chart(
        &mut self,
        axes: u32,
        series: u32,
        values: &[f64],
        colors_rgba: &[f32],
        max: f64,
        axis_max: &[f64],
        rings: u32,
        fill_opacity: f32,
        stroke_px: f32,
        marker_radius_px: f32,
        start_angle_deg: f32,
        grid: u8,
        label_space_x: f32,
        label_space_y: f32,
    ) -> Result<usize, JsValue> {
        let (axes, series) = (axes as usize, series as usize);
        validate_radar(axes, series, values).map_err(|e| JsValue::from_str(&e))?;
        let opts = RadarOptions {
            max: max.is_finite().then_some(max),
            axis_max: axis_max.to_vec(),
            rings,
            fill_opacity,
            stroke_px,
            marker_radius_px,
            start_angle_deg,
            grid: RadarGridShape::from_u8(grid),
            label_space_px: [label_space_x, label_space_y],
        };
        let chart = ChartState::new_radar(axes, series, values.to_vec(), colors(colors_rgba, BLUE), opts);
        Ok(self.inner.set_chart_state(chart))
    }

    /// Series colors of the current radar (theme change).
    pub fn set_chart_radar_colors(&mut self, colors_rgba: &[f32]) {
        if let Some(c) = self.inner.chart_mut() {
            c.set_radar_colors(colors(colors_rgba, BLUE));
        }
    }

    /// `[max, ring step, ring count, rings..., axis max * axes]` of the radar; empty otherwise.
    pub fn chart_radar_scale(&self) -> Vec<f64> {
        let Some((max, step, axis_max, rings)) = self.inner.chart().and_then(|c| c.radar_scale()) else {
            return Vec::new();
        };
        let mut out = vec![max, step, rings.len() as f64];
        out.extend_from_slice(rings);
        out.extend_from_slice(axis_max);
        out
    }

    /// `[revision, count, (kind, index, value, x_css, y_css, h_align, v_align) * count]`: kind 0
    /// = axis name (index = axis), 1 = ring value; h_align -1 / 0 / 1 = text ends / centered /
    /// starts at x, v_align -1 / 0 / 1 = above / centered / below y.
    pub fn chart_radar_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.radar_labels()) else {
            return Vec::new();
        };
        labels_out(labels, rev, |l| {
            vec![l.kind as f64, l.index as f64, l.value, l.x_css as f64, l.y_css as f64, l.h_align as f64, l.v_align as f64]
        })
    }

    /// `[center_x, center_y, radius (CSS px), hovered axis (-1 = none)]` of the last frame.
    pub fn chart_radar_layout(&self) -> Vec<f64> {
        let Some(l) = self.inner.chart().and_then(|c| c.radar_layout()) else {
            return Vec::new();
        };
        vec![l.center_css.0 as f64, l.center_css.1 as f64, l.r_css as f64, l.hovered.map_or(-1.0, |k| k as f64)]
    }

    /// Gauge: `value` (NaN = none) on `[min, max]`; the arc sweeps clockwise from
    /// `start_angle_deg` to `end_angle_deg` (compass degrees, NaN = -120 / 120); `thickness` =
    /// ring width / radius (NaN = 0.2); `indicator` 0 = needle, 1 = progress arc. Bands:
    /// `band_ranges` `[from, to] * n`, `band_colors` RGBA * n, `band_labeled` 1 = gets a label
    /// anchor. `style` = track, progress, needle, surface RGBA (missing = default).
    /// `label_space_x` / `label_space_y` CSS px kept beside / below the arc. Errors on invalid
    /// ranges. Returns `1 + bands` (point ids: 0 = value, `1 + k` = band `k`).
    #[allow(clippy::too_many_arguments)]
    pub fn set_gauge_chart(
        &mut self,
        value: f64,
        min: f64,
        max: f64,
        start_angle_deg: f32,
        end_angle_deg: f32,
        thickness: f32,
        indicator: u8,
        band_ranges: &[f64],
        band_colors: &[f32],
        band_labeled: &[u8],
        style: &[f32],
        label_space_x: f32,
        label_space_y: f32,
    ) -> Result<usize, JsValue> {
        let d = GaugeStyle::default();
        let bands: Vec<GaugeBand> = band_ranges
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
            .map(|(k, r)| GaugeBand {
                from: r[0],
                to: r[1],
                color: color_at(band_colors, k, d.progress),
                labeled: band_labeled.get(k).is_some_and(|&l| l != 0),
                source: k as u32,
            })
            .collect();
        validate_gauge(min, max, value, &bands).map_err(|e| JsValue::from_str(&e))?;
        let opts = GaugeOptions {
            min,
            max,
            start_angle_deg,
            end_angle_deg,
            thickness,
            indicator: GaugeIndicator::from_u8(indicator),
            label_space_px: [label_space_x, label_space_y],
        };
        let style = GaugeStyle {
            track: color_at(style, 0, d.track),
            progress: color_at(style, 1, d.progress),
            needle: color_at(style, 2, d.needle),
            surface: color_at(style, 3, d.surface),
        };
        Ok(self.inner.set_chart_state(ChartState::new_gauge(opts, bands, value, style)))
    }

    /// Moves the current gauge to `value` (NaN = none): only the needle / progress arc are
    /// rebuilt. Returns false without a gauge or for an infinite value.
    pub fn set_chart_gauge_value(&mut self, value: f64) -> bool {
        self.inner.chart_mut().is_some_and(|c| c.set_gauge_value(value))
    }

    /// Track / progress / needle / surface colors of the current gauge (theme change).
    pub fn set_chart_gauge_style(&mut self, style: &[f32]) {
        let d = GaugeStyle::default();
        if let Some(c) = self.inner.chart_mut() {
            c.set_gauge_style(GaugeStyle {
                track: color_at(style, 0, d.track),
                progress: color_at(style, 1, d.progress),
                needle: color_at(style, 2, d.needle),
                surface: color_at(style, 3, d.surface),
            });
        }
    }

    /// Band colors by input index (RGBA * n; invalid entries keep their color), e.g. palette
    /// bands on a theme change.
    pub fn set_chart_gauge_band_colors(&mut self, colors_rgba: &[f32]) {
        let colors: Vec<Option<[f32; 4]>> = colors_rgba.as_chunks::<4>().0.iter().map(|c| color4(c)).collect();
        if let Some(c) = self.inner.chart_mut() {
            c.set_gauge_band_colors(&colors);
        }
    }

    /// Bands in drawing order after clipping to the range: `[(input index, from, to) * n]`.
    pub fn chart_gauge_bands(&self) -> Vec<f64> {
        let Some(bands) = self.inner.chart().and_then(|c| c.gauge_bands()) else {
            return Vec::new();
        };
        bands.iter().flat_map(|b| [b.source as f64, b.from, b.to]).collect()
    }

    /// `[revision, count, (kind, index, x_css, y_css, h_align, v_align) * count]`: kind 0 = min,
    /// 1 = max, 2 = value, 3 = band (index = drawing-order band).
    pub fn chart_gauge_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.gauge_labels()) else {
            return Vec::new();
        };
        labels_out(labels, rev, |l| vec![l.kind as f64, l.index as f64, l.x_css as f64, l.y_css as f64, l.h_align as f64, l.v_align as f64])
    }

    /// `[center_x, center_y, outer_radius, inner_radius (CSS px), value, angle_deg, band of the
    /// value (-1 = none), hovered id (-1 = none)]` of the last frame.
    pub fn chart_gauge_layout(&self) -> Vec<f64> {
        let Some(l) = self.inner.chart().and_then(|c| c.gauge_layout()) else {
            return Vec::new();
        };
        vec![
            l.center_css.0 as f64,
            l.center_css.1 as f64,
            l.r_out_css as f64,
            l.r_in_css as f64,
            l.value,
            l.angle_deg as f64,
            l.band.map_or(-1.0, |k| k as f64),
            l.hovered.map_or(-1.0, |k| k as f64),
        ]
    }

    /// Funnel: `values` finite >= 0 (else an error), `colors` RGBA per stage (the last repeats);
    /// `orientation` 0 = vertical (first stage on top), 1 = horizontal; `shape` 0 = trapezoid,
    /// 1 = bars; `min_width` narrowest stage / widest (NaN = 0.02); `label_space` CSS px kept
    /// right of (vertical) / below (horizontal) the funnel for labels. Returns the stage count.
    pub fn set_funnel_chart(
        &mut self,
        values: &[f64],
        colors_rgba: &[f32],
        orientation: u8,
        shape: u8,
        min_width: f32,
        label_space: f32,
    ) -> Result<usize, JsValue> {
        validate_funnel(values).map_err(|e| JsValue::from_str(&e))?;
        let opts = FunnelOptions {
            orientation: if orientation == 1 { FunnelOrientation::Horizontal } else { FunnelOrientation::Vertical },
            shape: if shape == 1 { FunnelShape::Bar } else { FunnelShape::Trapezoid },
            min_width,
            label_space_px: label_space,
        };
        Ok(self.inner.set_chart_state(ChartState::new_funnel(values, &colors(colors_rgba, BLUE), opts)))
    }

    /// Stage colors of the current funnel (theme change).
    pub fn set_chart_funnel_colors(&mut self, colors_rgba: &[f32]) {
        if let Some(c) = self.inner.chart_mut() {
            c.set_funnel_colors(&colors(colors_rgba, BLUE));
        }
    }

    /// `[(value, percent of first, percent of previous) * stages]` (NaN = undefined).
    pub fn chart_funnel_stages(&self) -> Vec<f64> {
        let Some(stages) = self.inner.chart().and_then(|c| c.funnel_stages()) else {
            return Vec::new();
        };
        stages.iter().flat_map(|s| [s.value, s.pct_first, s.pct_prev]).collect()
    }

    /// `[revision, count, (stage, x_css, y_css, h_align, v_align) * count]`.
    pub fn chart_funnel_labels(&self) -> Vec<f64> {
        let Some((labels, rev)) = self.inner.chart().and_then(|c| c.funnel_labels()) else {
            return Vec::new();
        };
        labels_out(labels, rev, |l| vec![l.stage as f64, l.x_css as f64, l.y_css as f64, l.h_align as f64, l.v_align as f64])
    }

    /// Waterfall: `values` = deltas (finite; NaN allowed on total items), `totals[i]` 1 = a
    /// subtotal / total bar from zero to the running total. `orientation` 0 = vertical, 1 =
    /// horizontal; `style` = increase, decrease, total, connector RGBA (missing = default);
    /// `connector_dash_px` NaN = 3, 0 = solid. Data labels: `set_bar_labels` / `chart_bar_labels`
    /// (bar id = item). Returns the item count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_waterfall_chart(
        &mut self,
        values: &[f64],
        totals: &[u8],
        orientation: u8,
        connectors: bool,
        corner_radius_px: f32,
        style: &[f32],
        connector_dash_px: f32,
        width: f32,
        height: f32,
    ) -> Result<usize, JsValue> {
        let totals: Vec<bool> = totals.iter().map(|&t| t != 0).collect();
        validate_waterfall(values, &totals).map_err(|e| JsValue::from_str(&e))?;
        let layout = BarLayout {
            width: if width.is_finite() { width.max(1.0) } else { 164.0 },
            max_height: if height.is_finite() { height.max(1.0) } else { 78.0 },
            bar_width: 0.0,
            corner_radius_px: 0.0,
            view: ChartViewMode::Flat,
        };
        let opts = WaterfallOptions {
            orientation: BarOrientation::from_u8(orientation),
            connectors,
            corner_radius_px: if corner_radius_px.is_finite() { corner_radius_px } else { 0.0 },
        };
        let chart = ChartState::new_waterfall(values, &totals, layout, opts, waterfall_style(style, connector_dash_px));
        Ok(self.inner.set_chart_state(chart))
    }

    /// Increase / decrease / total / connector colors of the current waterfall (theme change).
    pub fn set_chart_waterfall_style(&mut self, style: &[f32], connector_dash_px: f32) {
        if let Some(c) = self.inner.chart_mut() {
            c.set_waterfall_style(waterfall_style(style, connector_dash_px));
        }
    }

    /// `[(kind 0 = increase / 1 = decrease / 2 = total, value, start, end) * items]` (value =
    /// the delta, or the running total of a total item).
    pub fn chart_waterfall_items(&self) -> Vec<f64> {
        let Some(items) = self.inner.chart().and_then(|c| c.waterfall_items()) else {
            return Vec::new();
        };
        items.iter().flat_map(|i| [i.kind.code() as f64, i.value, i.start, i.end]).collect()
    }
}

fn waterfall_style(style: &[f32], dash: f32) -> WaterfallStyle {
    let d = WaterfallStyle::default();
    WaterfallStyle {
        increase: color_at(style, 0, d.increase),
        decrease: color_at(style, 1, d.decrease),
        total: color_at(style, 2, d.total),
        connector: color_at(style, 3, d.connector),
        connector_dash_px: if dash.is_finite() { dash.max(0.0) } else { d.connector_dash_px },
    }
}
