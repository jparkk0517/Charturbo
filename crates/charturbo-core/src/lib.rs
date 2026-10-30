pub mod camera;
pub mod chart;
pub mod domain;
pub mod engine;
mod lib_device;
mod lib_boxplot;
mod lib_business;
mod lib_theme_river;
mod lib_heatmap;
mod lib_calendar;
mod lib_chord;
mod lib_polar;
mod lib_parallel;
mod lib_sparkline;
mod lib_pie;
mod lib_hierarchy;
mod lib_graph2d;
mod lib_timezone;
mod lib_barstyle;
mod lib_pictorial;
mod lib_decal;
mod lib_linestyle;
mod lib_scientific3d;
mod lib_combo;
mod lib_animation;
mod lib_svg;
mod lib_zoom;
mod lib_stats;
mod lib_texture;
mod lib_camera;
mod lib_scatter;
mod lib_edit;
mod lib_pieces;
pub mod physics;
pub mod renderer;
pub mod scene;
pub mod spatial;

use crate::chart::{
    validate_area, validate_line_x, AnnotationKind, AnnotationLayer, AreaMode, BarLayout, BarMode,
    BarSeriesLayout, ChartAnnotation, ChartFrameStyle, ChartHoverStyle, LabelPosition,
    ChartViewMode, HoverMode, LineLayout, LineSeries, LineXKind, LineYAxis, ScatterLayout, ScatterPoints,
    YAutoscale,
};
use crate::chart::{BrushMode, BrushStyle, ChartSelection, SelectionKind};
use crate::chart::{NavigatorHit, NavigatorOptions, NavigatorStyle};
use crate::chart::{validate_candles, BinRule, CandleData, CandleLayout, CandleMode, CandleStyle, HistogramBins, HistogramOptions};
use crate::chart::{AxisBreaks, AxisScale, ScaleType};
use crate::domain::DatasetConfig;
use crate::engine::VisualizationEngine;
use crate::physics::ForceConfig;
use crate::scene::{BodyType, Material, PrimitiveKind};
use glam::Vec3;
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use crate::{
    camera::OrbitCamera,
    domain::GraphDataset,
    physics::ForceDirectedSimulator,
    spatial::OctreeSpatialIndex,
};

/// WASM-exposed handle wrapping `VisualizationEngine` for browser integration, SDK usage, and benchmarking.
#[wasm_bindgen]
pub struct WasmCharturboEngine {
    inner: VisualizationEngine,
    /// Kept to derive the device pixel ratio (backing size / CSS size) on resize
    #[cfg(target_arch = "wasm32")]
    canvas: web_sys::HtmlCanvasElement,
}

/// Splits concatenated line / area series input (`values`, optional `xs`, `lengths`, `4 * S`
/// colors, `S` widths) into series. The buffers are owned (wasm-bindgen copies the JS arrays in
/// once): a single series keeps them without a second copy.
fn line_series_from(
    values: Vec<f32>,
    lengths: &[u32],
    xs: Vec<f64>,
    colors: &[f32],
    widths_px: &[f32],
) -> Result<Vec<LineSeries>, JsValue> {
    let total: usize = lengths.iter().map(|&l| l as usize).sum();
    if total != values.len() {
        return Err(JsValue::from_str("sum of lengths must equal values.length"));
    }
    if !xs.is_empty() && xs.len() != values.len() {
        return Err(JsValue::from_str("xs must be empty or the same length as values"));
    }
    if colors.len() != lengths.len() * 4 || widths_px.len() != lengths.len() {
        return Err(JsValue::from_str("colors must be 4 * series and widths 1 * series"));
    }
    if lengths.len() == 1 {
        return Ok(vec![LineSeries {
            values,
            x: (!xs.is_empty()).then_some(xs),
            color: rgba(colors, 0),
            width_px: param(widths_px, 0, 2.0).max(0.25),
        }]);
    }
    let mut series = Vec::with_capacity(lengths.len());
    let mut at = 0usize;
    for (i, &len) in lengths.iter().enumerate() {
        let len = len as usize;
        series.push(LineSeries {
            values: values[at..at + len].to_vec(),
            x: (!xs.is_empty()).then(|| xs[at..at + len].to_vec()),
            color: rgba(colors, i * 4),
            width_px: param(widths_px, i, 2.0).max(0.25),
        });
        at += len;
    }
    Ok(series)
}

/// `[kind (0 line / area, 1 bar, 2 scatter), mode (0 x, 1 xy), x0, x1, y0, y1 (NaN = whole y),
/// count, n_ranges, (series, start, end) * n_ranges]`; empty without a selection.
fn encode_selection(sel: Option<&ChartSelection>) -> Vec<f64> {
    let Some(sel) = sel else {
        return Vec::new();
    };
    let kind = match sel.kind {
        SelectionKind::Line => 0.0,
        SelectionKind::Bar => 1.0,
        SelectionKind::Scatter => 2.0,
        SelectionKind::Candle => 3.0,
    };
    let (y0, y1) = sel.y_range.unwrap_or((f64::NAN, f64::NAN));
    let mut out = Vec::with_capacity(8 + sel.ranges.len() * 3);
    out.extend([kind, if sel.mode == BrushMode::XY { 1.0 } else { 0.0 }, sel.x_range.0, sel.x_range.1, y0, y1]);
    out.push(sel.count() as f64);
    out.push(sel.ranges.len() as f64);
    for r in &sel.ranges {
        out.extend(r.map(|v| v as f64));
    }
    out
}

fn rgba(v: &[f32], at: usize) -> [f32; 4] {
    [v[at], v[at + 1], v[at + 2], v[at + 3]]
}

/// Hover result as `[is_bar, primary_slot, count, (series, index, value, global_id) * count]`, or
/// empty without a hit.
fn flat_hover(hit: Option<crate::chart::HoverResult>) -> Vec<f64> {
    let Some(hit) = hit else {
        return Vec::new();
    };
    let mut out = Vec::with_capacity(3 + hit.items.len() * 4);
    out.push(if hit.is_bar { 1.0 } else { 0.0 });
    out.push(hit.primary as f64);
    out.push(hit.items.len() as f64);
    for item in &hit.items {
        out.push(item.series as f64);
        out.push(item.index as f64);
        out.push(item.value as f64);
        out.push(item.global_id as f64);
    }
    out
}

/// `set_candle_chart` style array (NaN / missing entries = defaults).
fn candle_style_from(p: &[f32]) -> CandleStyle {
    let d = CandleStyle::default();
    let color = |at: usize, def: [f32; 4]| [0, 1, 2, 3].map(|k| param(p, at + k, def[k]));
    let flag = |at: usize, def: bool| param(p, at, if def { 1.0 } else { 0.0 }) > 0.5;
    CandleStyle {
        mode: if flag(16, false) { CandleMode::Ohlc } else { CandleMode::Candlestick },
        up_color: color(0, d.up_color),
        down_color: color(4, d.down_color),
        hollow_up: flag(8, d.hollow_up),
        wick_px: param(p, 9, d.wick_px),
        body_ratio: param(p, 10, d.body_ratio),
        corner_radius_px: param(p, 11, d.corner_radius_px),
        show_volume: flag(12, d.show_volume),
        volume_alpha: param(p, 13, d.volume_alpha),
        volume_fraction: param(p, 14, d.volume_fraction),
        fit_visible: flag(15, d.fit_visible),
    }
}

/// Reads a flat `f32` slice with a default for missing / non-finite entries.
fn param(v: &[f32], at: usize, default: f32) -> f32 {
    v.get(at).copied().filter(|x| x.is_finite()).unwrap_or(default)
}

#[wasm_bindgen]
impl WasmCharturboEngine {
    #[cfg(target_arch = "wasm32")]
    pub async fn create(
        canvas: web_sys::HtmlCanvasElement,
        seed: u32,
        node_count: usize,
        edge_count: usize,
        cluster_count: usize,
    ) -> Result<WasmCharturboEngine, JsValue> {
        console_error_panic_hook::set_once();

        let width = canvas.width().max(1);
        let height = canvas.height().max(1);

        let dataset = GraphDataset::generate_seeded(&DatasetConfig {
            seed,
            node_count,
            edge_count,
            cluster_count,
            space_radius: 100.0,
        });

        let simulator = Box::new(ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig::default(),
        ));

        let camera = OrbitCamera::new(220.0, width as f32 / height as f32);
        let renderer = crate::renderer::wgpu_backend::WgpuRenderBackend::from_canvas(canvas.clone())
            .await
            .map_err(|e| JsValue::from_str(&e))?;

        let mut engine = WasmCharturboEngine {
            inner: VisualizationEngine::new(dataset, simulator, camera, Box::new(renderer)),
            canvas,
        };
        engine.resize(width, height);
        Ok(engine)
    }

    pub fn reload_dataset(
        &mut self,
        seed: u32,
        node_count: usize,
        edge_count: usize,
        cluster_count: usize,
    ) {
        self.inner.reload_dataset(&DatasetConfig {
            seed,
            node_count,
            edge_count,
            cluster_count,
            space_radius: 100.0,
        });
    }

    /// Loads custom graph/embedding dataset from flat TypedArray slices.
    /// Pass empty slices `&[]` for optional buffers (`masses`, `colors`, `clusters`, `edge_weights`) to use defaults.
    pub fn load_raw_dataset(
        &mut self,
        positions: &[f32],
        masses: &[f32],
        colors: &[f32],
        clusters: &[u16],
        edges: &[u32],
        edge_weights: &[f32],
    ) -> Result<(), JsValue> {
        let opt_masses = if masses.is_empty() { None } else { Some(masses) };
        let opt_colors = if colors.is_empty() { None } else { Some(colors) };
        let opt_clusters = if clusters.is_empty() { None } else { Some(clusters) };
        let opt_weights = if edge_weights.is_empty() {
            None
        } else {
            Some(edge_weights)
        };

        self.inner
            .load_raw_dataset(
                positions,
                opt_masses,
                opt_colors,
                opt_clusters,
                edges,
                opt_weights,
            )
            .map_err(JsValue::from_str)
    }

    pub fn export_positions(&self) -> Vec<f32> {
        self.inner.export_positions()
    }

    pub fn import_positions(&mut self, positions: &[f32]) -> Result<(), JsValue> {
        self.inner
            .import_positions(positions)
            .map_err(JsValue::from_str)
    }

    pub fn warmup(&mut self, ticks: usize, dt: f32) -> f32 {
        self.inner.warmup(ticks, dt)
    }

    pub fn step_physics(&mut self, dt: f32) -> f32 {
        self.inner.step_physics(dt)
    }

    pub fn supports_gpu_physics(&self) -> bool { self.inner.supports_gpu_physics() }

    #[cfg(target_arch = "wasm32")]
    pub fn request_gpu_physics(&mut self, dt: f32) -> Result<js_sys::Promise, JsValue> {
        match self.inner.request_gpu_physics(dt).map_err(|e| JsValue::from_str(&e))? {
            engine::GpuPhysicsRequest::Immediate(energy) => {
                let response = js_sys::Array::new();
                response.push(&0.into());
                response.push(&energy.into());
                Ok(js_sys::Promise::resolve(&JsValue::from(response)))
            }
            engine::GpuPhysicsRequest::Pending(ticket, sync) => Ok(sync.into_promise(ticket)),
        }
    }

    /// Resolves to a ticket for `complete_physics_sync` (0: the CPU copy is already current).
    #[cfg(target_arch = "wasm32")]
    pub fn request_physics_sync(&mut self) -> Result<js_sys::Promise, JsValue> {
        match self.inner.request_physics_sync().map_err(|e| JsValue::from_str(&e))? {
            engine::GpuPhysicsRequest::Immediate(_) => Ok(js_sys::Promise::resolve(&JsValue::from(0))),
            engine::GpuPhysicsRequest::Pending(ticket, sync) => Ok(sync.into_promise(ticket)),
        }
    }

    /// Adopts the readback of `request_physics_sync` into the CPU copy (picking, exports).
    pub fn complete_physics_sync(&mut self, ticket: u32) -> Result<(), JsValue> {
        self.inner.complete_physics_sync(ticket).map_err(JsValue::from_str)
    }

    /// Auto-sleep for the graph layout. `sleep_threshold` is the MEAN kinetic energy per free
    /// (unpinned) node, `0.5 * mass * speed^2`, so the same value works at any node count; the
    /// layout sleeps after 30 consecutive steps below it and wakes on any edit / `wake_up`.
    pub fn set_auto_sleep(&mut self, enabled: bool, sleep_threshold: f32) {
        self.inner.set_auto_sleep(enabled, sleep_threshold);
    }

    pub fn is_sleeping(&self) -> bool {
        self.inner.is_sleeping()
    }

    pub fn wake_up(&mut self) {
        self.inner.wake_up();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_force_params(
        &mut self,
        repulsion_strength: f32,
        spring_stiffness: f32,
        spring_rest_length: f32,
        center_gravity: f32,
        damping: f32,
        theta: f32,
    ) {
        let mut cfg: ForceConfig = self.inner.force_config();
        cfg.repulsion_strength = repulsion_strength;
        cfg.spring_stiffness = spring_stiffness;
        cfg.spring_rest_length = spring_rest_length;
        cfg.center_gravity = center_gravity;
        cfg.damping = damping;
        cfg.theta = theta;
        self.inner.set_force_config(cfg);
    }

    pub fn set_frustum_culling(&mut self, enabled: bool) {
        self.inner.set_frustum_culling(enabled);
    }

    pub fn sync_and_render(&mut self) {
        self.inner.sync_and_render();
    }

    pub fn rotate_camera(&mut self, delta_yaw: f32, delta_pitch: f32) {
        self.inner.rotate_camera(delta_yaw, delta_pitch);
    }

    pub fn zoom_camera(&mut self, delta: f32) {
        self.inner.zoom_camera(delta);
    }

    pub fn pan_camera(&mut self, delta_right: f32, delta_up: f32) {
        self.inner.pan_camera(delta_right, delta_up);
    }

    pub fn fit_to_view(&mut self) {
        self.inner.fit_to_view();
    }

    pub fn focus_on_node(&mut self, node_id: u32) -> bool {
        self.inner.focus_on_node(node_id)
    }

    /// Resizes the render target (physical pixels). The pixel ratio used for CSS-pixel chart
    /// strokes is derived from the canvas' CSS width unless set explicitly afterwards.
    pub fn resize(&mut self, width: u32, height: u32) {
        #[cfg(target_arch = "wasm32")]
        {
            let css_width = self.canvas.client_width();
            if css_width > 0 {
                self.inner.set_pixel_ratio(width as f32 / css_width as f32);
            }
        }
        self.inner.resize(width, height);
    }

    /// Overrides the physical-pixels-per-CSS-pixel ratio (e.g. `window.devicePixelRatio`).
    pub fn set_pixel_ratio(&mut self, ratio: f32) {
        self.inner.set_pixel_ratio(ratio);
    }

    /// Graph node hover look: `enabled`, radius `scale`, and an optional fixed color
    /// (`use_color = false` brightens the node's own color).
    #[allow(clippy::too_many_arguments)]
    pub fn set_node_hover_style(
        &mut self,
        enabled: bool,
        scale: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        use_color: bool,
    ) {
        self.inner
            .set_node_hover_style(crate::renderer::NodeHoverStyle {
                enabled,
                scale,
                color: use_color.then_some([r, g, b, a]),
            });
    }

    // -------------------------------------------------------------------------
    // Native charts
    // -------------------------------------------------------------------------

    /// Renders a multi-series line chart.
    /// - `values`: all series concatenated; `lengths[i]` = sample count of series `i`
    /// - `colors`: `4 * S` RGBA; `widths_px`: `S` stroke widths in CSS px
    /// - `view_mode`: 0 = 2D, 1 = 2.5D layered
    #[allow(clippy::too_many_arguments)]
    pub fn set_line_chart(
        &mut self,
        values: Vec<f32>,
        lengths: &[u32],
        colors: &[f32],
        widths_px: &[f32],
        width: f32,
        height: f32,
        view_mode: u8,
    ) -> Result<usize, JsValue> {
        self.set_line_chart_xy(values, lengths, Vec::new(), colors, widths_px, width, height, view_mode, 0)
    }

    /// `set_line_chart` with explicit x per sample.
    /// - `xs`: concatenated like `values` (same lengths), each series finite and sorted ascending
    ///   (irregular spacing is fine); empty = place samples by index
    /// - `x_kind`: 0 = numeric ticks, 1 = time (x = epoch ms, ticks on UTC calendar boundaries)
    #[allow(clippy::too_many_arguments)]
    pub fn set_line_chart_xy(
        &mut self,
        values: Vec<f32>,
        lengths: &[u32],
        xs: Vec<f64>,
        colors: &[f32],
        widths_px: &[f32],
        width: f32,
        height: f32,
        view_mode: u8,
        x_kind: u8,
    ) -> Result<usize, JsValue> {
        let series = line_series_from(values, lengths, xs, colors, widths_px)?;
        validate_line_x(&series).map_err(|e| JsValue::from_str(&e))?;
        Ok(self.inner.set_line_chart(
            series,
            LineLayout {
                width: width.max(1.0),
                height: height.max(1.0),
                view: ChartViewMode::from_u8(view_mode),
                x_kind: LineXKind::from_u8(x_kind),
            },
        ))
    }

    /// Renders a 2D area chart; series are laid out like `set_line_chart_xy` (`xs` may be empty).
    /// - `mode`: 0 = overlapping areas filled to zero, 1 = stacked, 2 = percent-stacked (stacked
    ///   modes need equal lengths and, with `xs`, identical x per series; `NaN` counts as 0 below)
    /// - `fill_opacity`: fill alpha multiplier of the series color (`NaN` = 0.2 overlap / 0.8 stacked)
    #[allow(clippy::too_many_arguments)]
    pub fn set_area_chart(
        &mut self,
        values: Vec<f32>,
        lengths: &[u32],
        xs: Vec<f64>,
        colors: &[f32],
        widths_px: &[f32],
        width: f32,
        height: f32,
        mode: u8,
        fill_opacity: f32,
        x_kind: u8,
    ) -> Result<usize, JsValue> {
        let series = line_series_from(values, lengths, xs, colors, widths_px)?;
        let mode = AreaMode::from_u8(mode);
        validate_area(&series, mode).map_err(|e| JsValue::from_str(&e))?;
        Ok(self.inner.set_area_chart(
            series,
            LineLayout {
                width: width.max(1.0),
                height: height.max(1.0),
                view: ChartViewMode::Flat,
                x_kind: LineXKind::from_u8(x_kind),
            },
            mode,
            fill_opacity,
        ))
    }

    /// Renders a bar chart. `colors`: `4 * N` per bar, or 4 for all bars.
    /// `bar_width` 0 = automatic; `view_mode`: 0 = 2D, 1 = 3D matrix.
    #[allow(clippy::too_many_arguments)]
    pub fn set_bar_chart(
        &mut self,
        values: &[f32],
        colors: &[f32],
        width: f32,
        max_height: f32,
        bar_width: f32,
        corner_radius_px: f32,
        view_mode: u8,
    ) -> usize {
        let colors = colors.chunks_exact(4).map(|c| rgba(c, 0)).collect();
        self.inner.set_bar_chart(
            values.to_vec(),
            colors,
            BarLayout {
                width: width.max(1.0),
                max_height: max_height.max(1.0),
                bar_width: bar_width.max(0.0),
                corner_radius_px: corner_radius_px.max(0.0),
                view: ChartViewMode::from_u8(view_mode),
            },
        )
    }

    /// Renders a multi-series bar chart. `values`: flat `[s * N + i]` for `series_count` series of
    /// `N` categories (`NaN` = missing); `colors`: `4 * series_count`. `mode`: 0 = grouped,
    /// 1 = stacked, 2 = percent-stacked. `group_gap`: empty fraction of a slot between groups when
    /// `bar_width` is 0; `gap_px`: CSS px between grouped bars / stack segments (NaN = defaults).
    /// The 3D matrix (`view_mode` 1) shows the first series only.
    #[allow(clippy::too_many_arguments)]
    pub fn set_bar_chart_multi(
        &mut self,
        values: &[f32],
        series_count: u32,
        colors: &[f32],
        mode: u8,
        width: f32,
        max_height: f32,
        bar_width: f32,
        corner_radius_px: f32,
        group_gap: f32,
        gap_px: f32,
        view_mode: u8,
    ) -> Result<usize, JsValue> {
        let s = series_count as usize;
        if s == 0 || !values.len().is_multiple_of(s) {
            return Err(JsValue::from_str("values.length must be a multiple of series_count"));
        }
        if colors.len() != s * 4 {
            return Err(JsValue::from_str("colors must be 4 * series_count"));
        }
        let d = BarSeriesLayout::default();
        Ok(self.inner.set_bar_chart_series(
            values.to_vec(),
            (0..s).map(|k| rgba(colors, k * 4)).collect(),
            BarLayout {
                width: width.max(1.0),
                max_height: max_height.max(1.0),
                bar_width: bar_width.max(0.0),
                corner_radius_px: corner_radius_px.max(0.0),
                view: ChartViewMode::from_u8(view_mode),
            },
            BarSeriesLayout {
                series_count: s,
                mode: BarMode::from_u8(mode),
                group_gap: if group_gap.is_finite() { group_gap } else { d.group_gap },
                gap_px: if gap_px.is_finite() { gap_px } else { d.gap_px },
            },
        ))
    }

    /// Renders a 2D scatter / bubble chart. Optional channels are empty or one entry per point:
    /// - `sizes`: radius in CSS px per point (else `radius_px`)
    /// - `series_ids`: series id per point (legend / visibility / palette); else all series 0
    /// - `colors`: `4 * N` RGBA per point (else the series color)
    /// - `series_colors`: `4 * K` RGBA palette indexed by series id (wraps around)
    /// - `opacity`: fill alpha multiplier; `ring_px`: separating ring width in CSS px (0 = none)
    #[allow(clippy::too_many_arguments)]
    pub fn set_scatter_chart(
        &mut self,
        xs: &[f32],
        ys: &[f32],
        sizes: &[f32],
        series_ids: &[u16],
        colors: &[f32],
        series_colors: &[f32],
        width: f32,
        height: f32,
        radius_px: f32,
        opacity: f32,
        ring_px: f32,
        grid_x: bool,
    ) -> Result<usize, JsValue> {
        let n = xs.len();
        if ys.len() != n {
            return Err(JsValue::from_str("xs and ys must have the same length"));
        }
        if !(sizes.is_empty() || sizes.len() == n) || !(series_ids.is_empty() || series_ids.len() == n) {
            return Err(JsValue::from_str("sizes / series_ids must be empty or one per point"));
        }
        if !(colors.is_empty() || colors.len() == n * 4) {
            return Err(JsValue::from_str("colors must be empty or 4 * points"));
        }
        let d = ScatterLayout::default();
        let points = ScatterPoints {
            xs: xs.to_vec(),
            ys: ys.to_vec(),
            sizes: sizes.to_vec(),
            series: series_ids.to_vec(),
            colors: colors.chunks_exact(4).map(|c| rgba(c, 0)).collect(),
            series_colors: series_colors.chunks_exact(4).map(|c| rgba(c, 0)).collect(),
        };
        let layout = ScatterLayout {
            width: width.max(1.0),
            height: height.max(1.0),
            radius_px: if radius_px.is_finite() { radius_px.clamp(0.25, 512.0) } else { d.radius_px },
            opacity: if opacity.is_finite() { opacity.clamp(0.0, 1.0) } else { d.opacity },
            ring_px: if ring_px.is_finite() { ring_px.clamp(0.0, 16.0) } else { d.ring_px },
            grid_x,
        };
        Ok(self.inner.set_scatter_chart(points, layout))
    }

    /// Renders a 2D candlestick (OHLC) chart. `t`: one x per candle (epoch ms with `x_kind` 1,
    /// numbers with 0; finite, ascending) or empty for index placement; `volume` empty = none.
    /// A candle with a non-finite open / high / low / close is a gap. `style` (NaN / short =
    /// defaults): `[up rgba (4), down rgba (4), hollow_up (0/1), wick_px, body_ratio,
    /// corner_radius_px (0..1), show_volume (0/1), volume_alpha, volume_fraction, fit_visible (0/1),
    /// mode (0 = candlestick, 1 = OHLC)]`. Missing mode keeps legacy candlesticks.
    /// Candles narrower than ~2 px are aggregated per ~3 px bucket (OHLC of the bucket).
    #[allow(clippy::too_many_arguments)]
    pub fn set_candle_chart(
        &mut self,
        t: &[f64],
        open: &[f32],
        high: &[f32],
        low: &[f32],
        close: &[f32],
        volume: &[f32],
        style: &[f32],
        width: f32,
        height: f32,
        x_kind: u8,
    ) -> Result<usize, JsValue> {
        let data = CandleData {
            t: (!t.is_empty()).then(|| t.to_vec()),
            open: open.to_vec(),
            high: high.to_vec(),
            low: low.to_vec(),
            close: close.to_vec(),
            volume: (!volume.is_empty()).then(|| volume.to_vec()),
        };
        validate_candles(&data).map_err(|e| JsValue::from_str(&e))?;
        let style = candle_style_from(style);
        let layout = CandleLayout {
            width: width.max(1.0),
            height: height.max(1.0),
            x_kind: LineXKind::from_u8(x_kind),
        };
        Ok(self.inner.set_candle_chart(data, layout, style))
    }

    /// Renders OHLC stems with left open / right close ticks. Same data and style layout as
    /// `set_candle_chart`; slot 9 is line width, 10 is tick span / spacing, 16 is mode (1).
    #[allow(clippy::too_many_arguments)]
    pub fn set_ohlc_chart(
        &mut self, t: &[f64], open: &[f32], high: &[f32], low: &[f32], close: &[f32],
        volume: &[f32], style: &[f32], width: f32, height: f32, x_kind: u8,
    ) -> Result<usize, JsValue> {
        let mut style = style.to_vec();
        style.resize(style.len().max(17), f32::NAN);
        style[16] = 1.0;
        self.set_candle_chart(t, open, high, low, close, volume, &style, width, height, x_kind)
    }

    /// Restyles the financial chart in place; slot 16 selects candlestick (0) or OHLC (1).
    pub fn set_chart_candle_style(&mut self, style: &[f32]) {
        self.inner.set_chart_candle_style(candle_style_from(style));
    }

    /// `[x, open, high, low, close, volume, first, last]` of candle `index`, or of the bucket
    /// aggregate drawn for it while candles are aggregated (`first..=last` = its candles;
    /// volume NaN without volume data); empty without a candlestick chart.
    pub fn chart_candle(&self, index: u32) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.candle_at(index as usize))
            .map(|s| vec![s.x, s.open, s.high, s.low, s.close, s.volume, s.first as f64, s.last as f64])
            .unwrap_or_default()
    }

    /// Renders a histogram of `values` binned in Rust (O(n); non-finite values are ignored).
    /// `bins` 0 = automatic (Freedman–Diaconis, Sturges when the IQR is 0), else the bin count;
    /// `range_min` / `range_max` NaN = data extent; `density` = bar heights integrate to 1.
    /// Bars fill their bins `gap_px` CSS px apart (NaN = 1). Returns the bin count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_histogram_chart(
        &mut self,
        values: &[f32],
        bins: u32,
        range_min: f64,
        range_max: f64,
        density: bool,
        color: &[f32],
        width: f32,
        max_height: f32,
        corner_radius_px: f32,
        gap_px: f32,
    ) -> usize {
        let opts = HistogramOptions {
            bins: if bins == 0 { HistogramBins::Auto } else { HistogramBins::Count(bins as usize) },
            range: (range_min.is_finite() && range_max.is_finite()).then_some((range_min, range_max)),
            density,
        };
        let d = CandleStyle::default().up_color;
        let color = [0, 1, 2, 3].map(|k| param(color, k, d[k]));
        let layout = BarLayout {
            width: width.max(1.0),
            max_height: max_height.max(1.0),
            bar_width: 0.0,
            corner_radius_px: corner_radius_px.max(0.0),
            view: ChartViewMode::Flat,
        };
        self.inner.set_histogram_chart(values, &opts, color, layout, gap_px)
    }

    /// `[bins, total, rule, edges (bins + 1), heights (bins), counts (bins)]` of the histogram
    /// chart (`rule` 0 = Freedman–Diaconis, 1 = Sturges, 2 = fixed count), or empty.
    pub fn chart_histogram(&self) -> Vec<f64> {
        let Some(h) = self.inner.chart().and_then(|c| c.histogram()) else {
            return Vec::new();
        };
        let rule = match h.rule {
            BinRule::FreedmanDiaconis => 0.0,
            BinRule::Sturges => 1.0,
            BinRule::Fixed => 2.0,
        };
        let mut out = Vec::with_capacity(3 + h.edges.len() + 2 * h.counts.len());
        out.extend([h.counts.len() as f64, h.total as f64, rule]);
        out.extend(h.edges.iter().copied());
        out.extend(h.heights.iter().map(|&v| v as f64));
        out.extend(h.counts.iter().map(|&c| c as f64));
        out
    }

    pub fn clear_chart(&mut self) {
        self.inner.clear_chart();
    }

    /// Number of line series / scatter series ids of the current chart.
    pub fn chart_series_count(&self) -> u32 {
        self.inner.chart().map_or(0, |c| c.series_count() as u32)
    }

    /// Hit-tests the chart and updates hover overlays. Returns
    /// `[is_bar, primary_slot, count, (series, index, value, global_id) * count]` or empty.
    pub fn chart_hover_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> Vec<f64> {
        flat_hover(self.inner.chart_hover_at_ndc(ndc_x, ndc_y))
    }

    pub fn chart_clear_hover(&mut self) {
        self.inner.chart_clear_hover();
    }

    /// Cursor sync: hovers the chart at data `x` (line: series `x` / sample index, epoch ms on
    /// time axes; bar: category index; scatter: x) in index mode. Same layout as
    /// `chart_hover_at_ndc`; empty (and hover cleared) when `x` is outside the visible range.
    pub fn chart_hover_at_data_x(&mut self, x: f64) -> Vec<f64> {
        flat_hover(self.inner.chart_hover_at_data_x(x))
    }

    /// Data x of the current chart hover's primary point (NaN = no hover).
    pub fn chart_hover_x(&self) -> f64 {
        self.inner.chart_hover_data_x().unwrap_or(f64::NAN)
    }

    /// Stroke width (CSS px) of series `series`, or of all series when `series < 0`.
    pub fn set_chart_line_width(&mut self, series: i32, width_px: f32) {
        let target = usize::try_from(series).ok();
        self.inner.set_chart_line_width(target, width_px);
    }

    /// Hover style as a flat array (missing / non-finite entries use defaults):
    /// `[mode (0 index, 1 nearest), crosshair (0/1), crosshair rgba (4), crosshair_width_px,
    ///   marker (0/1), marker_radius_px, ring rgba (4), ring_px, bar_highlight (0/1),
    ///   bar rgba (4), hit_radius_px]` (20 values)
    pub fn set_chart_hover_style(&mut self, p: &[f32]) {
        let d = ChartHoverStyle::default();
        let color = |at: usize, def: [f32; 4]| {
            [
                param(p, at, def[0]),
                param(p, at + 1, def[1]),
                param(p, at + 2, def[2]),
                param(p, at + 3, def[3]),
            ]
        };
        let flag = |at: usize, def: bool| param(p, at, if def { 1.0 } else { 0.0 }) > 0.5;
        self.inner.set_chart_hover_style(ChartHoverStyle {
            mode: if param(p, 0, 0.0) > 0.5 {
                HoverMode::Nearest
            } else {
                HoverMode::Index
            },
            crosshair: flag(1, d.crosshair),
            crosshair_color: color(2, d.crosshair_color),
            crosshair_width_px: param(p, 6, d.crosshair_width_px).max(0.25),
            marker: flag(7, d.marker),
            marker_radius_px: param(p, 8, d.marker_radius_px).max(0.5),
            marker_ring_color: color(9, d.marker_ring_color),
            marker_ring_px: param(p, 13, d.marker_ring_px).max(0.0),
            bar_highlight_color: flag(14, false).then(|| color(15, [1.0; 4])),
            hit_radius_px: param(p, 19, d.hit_radius_px).max(1.0),
        });
    }

    /// Grid style as a flat array:
    /// `[show_grid (0/1), rows, grid rgba (4), baseline rgba (4), stroke_px]` (11 values)
    pub fn set_chart_frame_style(&mut self, p: &[f32]) {
        let d = ChartFrameStyle::default();
        let color = |at: usize, def: [f32; 4]| {
            [
                param(p, at, def[0]),
                param(p, at + 1, def[1]),
                param(p, at + 2, def[2]),
                param(p, at + 3, def[3]),
            ]
        };
        self.inner.set_chart_frame_style(ChartFrameStyle {
            show_grid: param(p, 0, 1.0) > 0.5,
            grid_rows: param(p, 1, d.grid_rows as f32).clamp(1.0, 100.0) as u32,
            grid_color: color(2, d.grid_color),
            baseline_color: color(6, d.baseline_color),
            stroke_px: param(p, 10, d.stroke_px).max(0.25),
        });
    }

    /// `[series, index, value, x, y, z, data_x]` of a chart data point, or empty. `x, y, z` is
    /// the world position; `data_x` the line sample's x (its index without x; NaN for bars /
    /// scatter).
    pub fn chart_sample(&self, global_id: u32) -> Vec<f64> {
        let Some(chart) = self.inner.chart() else {
            return Vec::new();
        };
        chart
            .sample(global_id)
            .map(|(s, i, v, p)| {
                let data_x = chart.sample_x(global_id).unwrap_or(f64::NAN);
                vec![s as f64, i as f64, v as f64, p.x as f64, p.y as f64, p.z as f64, data_x]
            })
            .unwrap_or_default()
    }

    /// Replaces the samples of one line series, keeping styles and the zoom window. `xs`: one
    /// per value when the chart has x (finite, sorted), else empty. Returns the new length.
    /// Global ids (`offset + index`) of every series are re-based.
    pub fn set_chart_series_data(&mut self, series: u32, values: &[f32], xs: &[f64]) -> Result<u32, JsValue> {
        let x = (!xs.is_empty()).then(|| xs.to_vec());
        self.inner
            .set_chart_series_data(series as usize, values.to_vec(), x)
            .map(|n| n as u32)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Streams samples onto one line series: `xs` like `set_chart_series_data`, not before the
    /// series' last x. `max_points > 0` drops the oldest samples beyond it (ids re-based). A
    /// zoom window touching the right edge follows the latest data. Returns the new length.
    pub fn append_chart_series_data(
        &mut self,
        series: u32,
        values: &[f32],
        xs: &[f64],
        max_points: u32,
    ) -> Result<u32, JsValue> {
        let x = (!xs.is_empty()).then_some(xs);
        self.inner
            .append_chart_series_data(series as usize, values, x, max_points as usize)
            .map(|n| n as u32)
            .map_err(|e| JsValue::from_str(&e))
    }

    /// Atomic area append. Buffers are series-major; `lengths` contains one entry per series.
    /// `xs` is empty for index placement, otherwise one coordinate per appended value.
    pub fn append_area_data(&mut self, values: &[f32], lengths: &[u32], xs: &[f64], max_points: u32) -> Result<Vec<u32>, JsValue> {
        let total = lengths.iter().try_fold(0usize, |n, &len| n.checked_add(len as usize));
        if total != Some(values.len()) || (!xs.is_empty() && xs.len() != values.len()) {
            return Err(JsValue::from_str("appendAreaData: buffer lengths do not match"));
        }
        let mut at = 0;
        let chunks: Vec<&[f32]> = lengths.iter().map(|&len| {
            let start = at;
            at += len as usize;
            &values[start..at]
        }).collect();
        let mut at = 0;
        let x_chunks: Option<Vec<&[f64]>> = (!xs.is_empty()).then(|| lengths.iter().map(|&len| {
            let start = at;
            at += len as usize;
            &xs[start..at]
        }).collect());
        self.inner.append_area_data(&chunks, x_chunks.as_deref(), max_points as usize)
            .map(|lengths| lengths.into_iter().map(|n| n as u32).collect())
            .map_err(|e| JsValue::from_str(&e))
    }

    /// y domain of the line chart: `min` / `max` fixed ends (NaN = from the data); `autoscale`
    /// 0 = all data (default), 1 = visible x window (hysteresis), 2 = none (kept as data
    /// changes); `nice` expands data-derived ends to whole tick steps.
    pub fn set_chart_y_domain(&mut self, min: f64, max: f64, autoscale: u8, nice: bool) {
        let end = |v: f64| v.is_finite().then_some(v);
        self.inner.set_chart_y_axis(LineYAxis {
            min: end(min),
            max: end(max),
            autoscale: YAutoscale::from_u8(autoscale),
            nice,
        });
    }

    /// `[min, max, step]` of the line chart's y domain, or empty.
    pub fn chart_y_domain(&self) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.y_domain())
            .map(|(lo, hi, step)| vec![lo, hi, step])
            .unwrap_or_default()
    }

    /// Axis scale: `axis` 0 = x (line: numeric x only for log; scatter), 1 = left y, 2 = right y
    /// (dual-axis line charts); `kind` 0 = linear, 1 = log10 (non-positive values not drawn);
    /// `reverse` inverts the axis; `tick_count` 0 = default tick density.
    pub fn set_chart_axis_scale(&mut self, axis: u8, kind: u8, reverse: bool, tick_count: u32) {
        // Breaks are set apart (`set_chart_axis_breaks`): keep them
        let breaks = self.inner.chart().map_or(AxisBreaks::NONE, |c| c.axis_breaks(axis));
        self.inner.set_chart_axis_scale(axis, AxisScale { kind: ScaleType::from_u8(kind), reverse, tick_count, breaks });
    }

    /// `[kind, reverse, tick_count]` of one axis (see `set_chart_axis_scale`), or empty.
    pub fn chart_axis_scale(&self, axis: u8) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.axis_scale(axis))
            .map(|s| vec![s.is_log() as u8 as f64, s.reverse as u8 as f64, s.tick_count as f64])
            .unwrap_or_default()
    }

    /// Breaks of a value axis (`axis` as in `set_chart_axis_scale`; extra y axis k >= 2 =
    /// `16 + k`; bar charts: 1 = the value axis): flat `[start, end, gap]` triples in data
    /// units, ascending and disjoint, at most 8; empty clears. Linear axes only (log is an
    /// error). Validated before anything changes. Returns true when the mapping changed.
    pub fn set_chart_axis_breaks(&mut self, axis: u8, breaks: &[f64]) -> Result<bool, JsValue> {
        let breaks = AxisBreaks::from_flat(breaks).map_err(|e| JsValue::from_str(&e))?;
        self.inner.set_chart_axis_breaks(axis, breaks).map_err(|e| JsValue::from_str(&e))
    }

    /// Flat `[start, end, gap]` triples of one axis' breaks (see `set_chart_axis_breaks`).
    pub fn chart_axis_breaks(&self, axis: u8) -> Vec<f64> {
        self.inner
            .chart()
            .map(|c| c.axis_breaks(axis).list().iter().flat_map(|b| [b.start, b.end, b.gap]).collect())
            .unwrap_or_default()
    }

    /// Domain options of y axis `k` (0 = left, 1 = right, 2.. = extra; arguments as
    /// `set_chart_y_domain`) of a line chart.
    pub fn set_chart_y_axis_at(&mut self, k: u8, min: f64, max: f64, autoscale: u8, nice: bool) {
        let end = |v: f64| v.is_finite().then_some(v);
        self.inner.set_chart_y_axis_at(k, LineYAxis { min: end(min), max: end(max), autoscale: YAutoscale::from_u8(autoscale), nice });
    }

    /// `[min, max, step]` of y axis `k`'s domain, or empty when no series uses it.
    pub fn chart_y_domain_at(&self, k: u8) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.y_domain_at(k))
            .map(|(lo, hi, step)| vec![lo, hi, step])
            .unwrap_or_default()
    }

    /// y axis of each line series: 0 = left, 1 = right, 2..7 = extra (missing entries = left).
    pub fn set_chart_series_axes(&mut self, axes: &[u8]) {
        self.inner.set_chart_series_axes(axes);
    }

    /// Right y domain of a dual-axis line chart (arguments as `set_chart_y_domain`).
    pub fn set_chart_y2_domain(&mut self, min: f64, max: f64, autoscale: u8, nice: bool) {
        let end = |v: f64| v.is_finite().then_some(v);
        self.inner.set_chart_y2_axis(LineYAxis {
            min: end(min),
            max: end(max),
            autoscale: YAutoscale::from_u8(autoscale),
            nice,
        });
    }

    /// `[min, max, step]` of the right y domain (step 0 on a log scale), or empty without
    /// right-axis series.
    pub fn chart_y2_domain(&self) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.y2_domain())
            .map(|(lo, hi, step)| vec![lo, hi, step])
            .unwrap_or_default()
    }

    /// y axis of each annotation (0 = left, 1 = right); call after `set_chart_annotations`.
    pub fn set_chart_annotation_y_axes(&mut self, axes: &[u8]) {
        self.inner.set_chart_annotation_y_axes(axes);
    }

    /// Live samples of a line series (after appends / trims), or empty.
    pub fn chart_series_values(&self, series: u32) -> Vec<f32> {
        self.inner
            .chart()
            .and_then(|c| c.line_values(series as usize))
            .map(<[f32]>::to_vec)
            .unwrap_or_default()
    }

    /// Absolute x of a line series' live samples, or empty (no x / no such series).
    pub fn chart_series_x(&self, series: u32) -> Vec<f64> {
        self.inner
            .chart()
            .and_then(|c| c.line_x(series as usize))
            .unwrap_or_default()
    }

    /// Resets the x zoom and re-frames the camera on the current chart.
    pub fn chart_fit_view(&mut self) {
        self.inner.chart_fit_view();
    }

    /// Background color the canvas is cleared to.
    pub fn set_clear_color(&mut self, r: f32, g: f32, b: f32, a: f32) {
        self.inner.set_clear_color([r, g, b, a]);
    }

    /// Plot margins in CSS px reserved for axis labels / legend / title; re-frames the camera.
    pub fn set_chart_padding(&mut self, top: f32, right: f32, bottom: f32, left: f32) {
        self.inner.set_chart_padding([top, right, bottom, left]);
    }

    /// Shows / hides a line / bar series (legend toggle).
    pub fn set_chart_series_visible(&mut self, series: u32, visible: bool) {
        self.inner.set_chart_series_visible(series as usize, visible);
    }

    /// Emphasizes a series (others fade); `series < 0` clears the emphasis.
    pub fn set_chart_emphasis(&mut self, series: i32) {
        self.inner.set_chart_emphasis(usize::try_from(series).ok());
    }

    /// Zooms the 2D line chart's x axis around `anchor_ndc_x` (`factor` < 1 zooms in).
    pub fn chart_zoom_x(&mut self, factor: f32, anchor_ndc_x: f32) {
        self.inner.chart_zoom_x(factor, anchor_ndc_x);
    }

    /// Pans the 2D line chart's x axis by a pointer delta in NDC.
    pub fn chart_pan_x(&mut self, delta_ndc_x: f32) {
        self.inner.chart_pan_x(delta_ndc_x);
    }

    /// Zooms both axes of a scatter chart around the pointer (`factor` < 1 zooms in).
    pub fn chart_zoom_xy(&mut self, factor: f32, anchor_ndc_x: f32, anchor_ndc_y: f32) {
        self.inner.chart_zoom_xy(factor, anchor_ndc_x, anchor_ndc_y);
    }

    /// Pans both axes of a scatter chart by a pointer delta in NDC (+y = up).
    pub fn chart_pan_xy(&mut self, delta_ndc_x: f32, delta_ndc_y: f32) {
        self.inner.chart_pan_xy(delta_ndc_x, delta_ndc_y);
    }

    pub fn chart_reset_zoom(&mut self) {
        self.inner.chart_reset_zoom();
    }

    /// Visible `[x_min, x_max, y_min, y_max]` in data units (line x: series `x` or sample index;
    /// NaN y for line charts, whose y domain is fixed), or empty without a line / scatter chart.
    pub fn chart_range(&self) -> Vec<f64> {
        let Some((x0, x1)) = self.inner.chart_x_range() else {
            return Vec::new();
        };
        let (y0, y1) = self.inner.chart_y_range().unwrap_or((f64::NAN, f64::NAN));
        vec![x0, x1, y0, y1]
    }

    /// Zooms the x axis to `[lo, hi]` in data units (2D line / scatter), clamped like wheel zoom.
    /// Returns true when the view moved.
    pub fn chart_set_x_range(&mut self, lo: f64, hi: f64) -> bool {
        self.inner.chart_set_x_range(lo, hi)
    }

    /// Zooms the y axis of a scatter chart to `[lo, hi]` in data units; true when the view moved.
    pub fn chart_set_y_range(&mut self, lo: f64, hi: f64) -> bool {
        self.inner.chart_set_y_range(lo, hi)
    }

    /// Range selector (navigator) of a 2D line / area chart: `height_px` NaN = 48; `style` flat
    /// `[background rgba, mask rgba, window rgba, outline rgba, handle rgba]` (20 values,
    /// missing / non-finite = defaults). Re-frames the plot above the strip.
    pub fn set_chart_navigator(&mut self, enabled: bool, height_px: f32, style: &[f32]) {
        let d = NavigatorStyle::default();
        let color = |at: usize, def: [f32; 4]| {
            [
                param(style, at, def[0]),
                param(style, at + 1, def[1]),
                param(style, at + 2, def[2]),
                param(style, at + 3, def[3]),
            ]
        };
        self.inner.set_chart_navigator(NavigatorOptions {
            enabled,
            height_px,
            style: NavigatorStyle {
                background: color(0, d.background),
                mask: color(4, d.mask),
                window: color(8, d.window),
                outline: color(12, d.outline),
                handle: color(16, d.handle),
            },
        });
    }

    /// Navigator region under the pointer: 0 none, 1 window, 2 left handle, 3 right handle,
    /// 4 strip outside the window.
    pub fn chart_navigator_hit(&self, ndc_x: f32, ndc_y: f32) -> u8 {
        self.inner.chart_navigator_hit(ndc_x, ndc_y) as u8
    }

    /// Drags the region `code` (from `chart_navigator_hit`) by a pointer delta in NDC: 1 / 4
    /// move the window, 2 / 3 resize it (clamped, minimum span). True when the window moved.
    pub fn chart_navigator_drag(&mut self, code: u8, delta_ndc_x: f32) -> bool {
        self.inner.chart_navigator_drag(NavigatorHit::from_u8(code), delta_ndc_x)
    }

    /// Centers the zoom window (same span) on the strip x under the pointer.
    pub fn chart_navigator_center(&mut self, ndc_x: f32) -> bool {
        self.inner.chart_navigator_center(ndc_x)
    }

    /// Zooms the zoom window around the strip x under the pointer (`factor` < 1 zooms in).
    pub fn chart_navigator_zoom(&mut self, factor: f32, ndc_x: f32) -> bool {
        self.inner.chart_navigator_zoom(factor, ndc_x)
    }

    /// Navigator strip `[left, top, width, height]` in CSS px, or empty without one.
    pub fn chart_navigator_rect(&self) -> Vec<f32> {
        self.inner.chart_navigator_rect().map_or_else(Vec::new, |r| r.to_vec())
    }

    /// Revision of the axis layout; it changes only when tick positions / values change.
    pub fn chart_axes_revision(&self) -> u32 {
        self.inner.chart_axes().map_or(0, |(_, rev)| rev)
    }

    /// `[plot_left, plot_top, plot_width, plot_height, count, (axis, value, x, y) * count,
    /// granularity * count]` in CSS px from the canvas top-left (axis 0 = x, 1 = y, 2 = right y), or empty
    /// without a chart. The trailing granularity block (appended so older readers of the prefix
    /// keep working) is 0 for non-time ticks, else 1 = ms, 2 = s, 3 = min, 4 = h, 5 = day,
    /// 6 = month, 7 = year: the coarsest UTC boundary the tick lands on. Then (also appended)
    /// `break_count, (axis, from, to) * break_count`: visible axis breaks, `from` / `to` the css
    /// x (axis 0) or y of each break's start / end (extra y axis k >= 2 = axis `16 + k`).
    pub fn chart_axes(&self) -> Vec<f64> {
        let Some((axes, _)) = self.inner.chart_axes() else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(5 + axes.ticks.len() * 5);
        out.extend(axes.plot_css.iter().map(|&v| v as f64));
        out.push(axes.ticks.len() as f64);
        for t in &axes.ticks {
            out.extend([t.axis as f64, t.value, t.x_css as f64, t.y_css as f64]);
        }
        out.extend(axes.ticks.iter().map(|t| t.granularity as f64));
        out.push(axes.breaks.len() as f64);
        for b in &axes.breaks {
            out.extend([b.axis as f64, b.from_css as f64, b.to_css as f64]);
        }
        out
    }

    /// Replaces the chart annotations. Per annotation `i`: `kinds[i]` (0 = hline, 1 = vline,
    /// 2 = y band, 3 = x band, 4 = point, 5 = text), `coords[4i..4i + 4]` in data units (hline
    /// `[y]`, vline `[x]`, bands `[from, to]` with ±Infinity = plot edge, point / text `[x, y]`),
    /// `colors[4i..4i + 4]` RGBA; `widths` (stroke / marker radius px), `dash` (px, 0 = solid),
    /// `opacity` (alpha multiplier) use NaN or a short array for the kind's default; `layers[i]`
    /// 0 = below the series, 1 = above; `label_positions[i]` 0 = start, 1 = end, 2 = center.
    /// x is the sample index / x value (line), category index (bar), or x (scatter).
    #[allow(clippy::too_many_arguments)]
    pub fn set_chart_annotations(
        &mut self,
        kinds: &[u8],
        coords: &[f64],
        colors: &[f32],
        widths: &[f32],
        dash: &[f32],
        opacity: &[f32],
        layers: &[u8],
        label_positions: &[u8],
    ) -> Result<(), JsValue> {
        let n = kinds.len();
        if coords.len() != n * 4 || colors.len() != n * 4 {
            return Err(JsValue::from_str("coords and colors must be 4 * kinds.length"));
        }
        let mut items = Vec::with_capacity(n);
        for (i, &k) in kinds.iter().enumerate() {
            let kind = AnnotationKind::from_u8(k).ok_or_else(|| JsValue::from_str("unknown annotation kind"))?;
            let c = [coords[i * 4], coords[i * 4 + 1], coords[i * 4 + 2], coords[i * 4 + 3]];
            let mut a = ChartAnnotation::new(kind, c, rgba(colors, i * 4));
            a.width_px = param(widths, i, a.width_px).max(0.0);
            a.dash_px = param(dash, i, 0.0).max(0.0);
            a.opacity = param(opacity, i, a.opacity).clamp(0.0, 1.0);
            a.layer = AnnotationLayer::from_u8(layers.get(i).copied().unwrap_or(0));
            a.label = LabelPosition::from_u8(label_positions.get(i).copied().unwrap_or(1));
            items.push(a);
        }
        self.inner.set_chart_annotations(items);
        Ok(())
    }

    pub fn clear_chart_annotations(&mut self) {
        self.inner.clear_chart_annotations();
    }

    /// Changes whenever an annotation label anchor moves (poll it per frame, like the axes).
    pub fn chart_annotation_labels_revision(&self) -> u32 {
        self.inner.chart_annotation_labels().map_or(0, |(_, rev)| rev)
    }

    /// `[count, (id, x_css, y_css, visible) * count]`: one label anchor per annotation in list
    /// order, CSS px from the canvas top-left (`visible` 0 = outside the visible range / 3D view).
    pub fn chart_annotation_labels(&self) -> Vec<f64> {
        let Some((labels, _)) = self.inner.chart_annotation_labels() else {
            return Vec::new();
        };
        let mut out = Vec::with_capacity(1 + labels.len() * 4);
        out.push(labels.len() as f64);
        for l in labels {
            out.extend([l.id as f64, l.x_css as f64, l.y_css as f64, if l.visible { 1.0 } else { 0.0 }]);
        }
        out
    }

    /// Live brush rectangle (dashed) from NDC `(ax, ay)` (drag start) to `(bx, by)`; `mode` 0 =
    /// x interval, 1 = x / y rectangle (bars: always x). Drops the previous selection; false
    /// outside 2D charts.
    pub fn chart_brush(&mut self, mode: u8, ax: f32, ay: f32, bx: f32, by: f32) -> bool {
        self.inner.chart_brush(BrushMode::from_u8(mode), (ax, ay), (bx, by))
    }

    /// Commits the live brush and returns the selection (see `chart_selection`), or empty.
    pub fn chart_brush_end(&mut self) -> Vec<f64> {
        encode_selection(self.inner.chart_brush_end())
    }

    /// Selects a data rectangle: x `[x0, x1]`, y `[y0, y1]` (NaN = whole y range, i.e. an x
    /// brush). x is the sample index / x value (line), category index (bar), or x (scatter).
    /// Returns the selection (see `chart_selection`), or empty outside 2D charts.
    pub fn chart_select_range(&mut self, x0: f64, x1: f64, y0: f64, y1: f64) -> Vec<f64> {
        let y = (!y0.is_nan() && !y1.is_nan()).then_some((y0, y1));
        let mode = if y.is_some() { BrushMode::XY } else { BrushMode::X };
        encode_selection(self.inner.chart_select_data(mode, (x0, x1), y))
    }

    /// `[kind (0 line / area, 1 bar, 2 scatter), mode (0 x, 1 xy), x0, x1, y0, y1 (NaN = whole
    /// y), count, n_ranges, (series, start, end) * n_ranges]` of the committed selection (line
    /// runs `[start, end)` of live sample indices), or empty. Scatter / bar ids: `chart_selection_ids`.
    pub fn chart_selection(&mut self) -> Vec<f64> {
        encode_selection(self.inner.chart_selection())
    }

    /// Selected scatter point ids (ascending, visible series) or bar category indices.
    pub fn chart_selection_ids(&mut self) -> Vec<u32> {
        self.inner.chart_selection().map_or_else(Vec::new, |s| s.ids.clone())
    }

    pub fn chart_clear_selection(&mut self) {
        self.inner.chart_clear_selection();
    }

    /// Brush look `[fill rgba (4), border rgba (4), border_px, live dash_px]`; missing /
    /// non-finite entries keep the defaults.
    pub fn set_chart_brush_style(&mut self, params: &[f32]) {
        let d = BrushStyle::default();
        let at = |i: usize, def: f32| param(params, i, def);
        let style = BrushStyle {
            fill: std::array::from_fn(|i| at(i, d.fill[i])),
            border: std::array::from_fn(|i| at(4 + i, d.border[i])),
            border_px: at(8, d.border_px).max(0.0),
            dash_px: at(9, d.dash_px).max(0.0),
        };
        self.inner.set_chart_brush_style(style);
    }

    pub fn pick_node_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> i32 {
        self.inner
            .pick_node_at_ndc(ndc_x, ndc_y)
            .map(|id| id as i32)
            .unwrap_or(-1)
    }

    pub fn select_box_ndc(
        &mut self,
        min_ndc_x: f32,
        min_ndc_y: f32,
        max_ndc_x: f32,
        max_ndc_y: f32,
    ) -> Vec<u32> {
        self.inner
            .select_box_ndc(min_ndc_x, min_ndc_y, max_ndc_x, max_ndc_y)
    }

    pub fn query_radius(&mut self, x: f32, y: f32, z: f32, radius: f32, max_results: usize) -> Vec<u32> {
        self.inner
            .query_radius(Vec3::new(x, y, z), radius, max_results)
    }

    pub fn select_node_and_neighbors(&mut self, node_id: u32, hops: usize) -> Vec<u32> {
        self.inner.select_node_and_neighbors(node_id, hops)
    }

    pub fn select_cluster(&mut self, cluster_id: u16) -> Vec<u32> {
        self.inner.select_cluster(cluster_id)
    }

    pub fn clear_selection(&mut self) {
        self.inner.clear_selection();
    }

    pub fn set_node_pinned(&mut self, node_id: u32, pinned: bool) -> bool {
        self.inner.set_node_pinned(node_id, pinned)
    }

    pub fn move_node_to(&mut self, node_id: u32, x: f32, y: f32, z: f32) -> bool {
        self.inner.move_node_to(node_id, Vec3::new(x, y, z))
    }

    /// Returns `[x, y, z, mass, cluster_id, r, g, b, a, degree, selected, pinned]` or empty slice.
    pub fn get_node_info(&self, node_id: u32) -> Vec<f32> {
        self.inner.get_node_info(node_id)
    }

    pub fn get_node_neighbors(&self, node_id: u32) -> Vec<u32> {
        self.inner.get_node_neighbors(node_id)
    }

    /// Returns `[ndc_x, ndc_y, ndc_z]` if `node_id` is in front of the camera, or empty slice.
    pub fn project_node_to_ndc(&self, node_id: u32) -> Vec<f32> {
        self.inner
            .project_node_to_ndc(node_id)
            .map(|ndc| ndc.to_vec())
            .unwrap_or_default()
    }

    pub fn select_shortest_path(&mut self, start_id: u32, end_id: u32) -> Vec<u32> {
        self.inner.select_shortest_path(start_id, end_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_node_style(
        &mut self,
        node_id: u32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        mass: f32,
        cluster_id: u16,
    ) -> bool {
        self.inner
            .set_node_style(node_id, [r, g, b, a], mass, cluster_id)
    }

    pub fn apply_preset_layout(&mut self, layout_kind: u8, space_radius: f32) {
        self.inner.apply_preset_layout(layout_kind, space_radius);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn load_high_dim_embeddings(
        &mut self,
        vectors: &[f32],
        dim: usize,
        projection_mode: u8,
        k_neighbors: usize,
        similarity_threshold: f32,
        clusters: &[u16],
        warmup_ticks: usize,
        space_radius: f32,
    ) -> Result<(), JsValue> {
        let opt_clusters = if clusters.is_empty() {
            None
        } else {
            Some(clusters)
        };
        self.inner
            .load_high_dim_embeddings(
                vectors,
                dim,
                projection_mode,
                k_neighbors,
                similarity_threshold,
                opt_clusters,
                warmup_ticks,
                space_radius,
            )
            .map_err(JsValue::from_str)
    }

    /// Batch projection: `[ndc_x, ndc_y, ndc_z] * ids.len()` (NaN for points behind the camera).
    /// One WASM call instead of one per label.
    pub fn project_nodes_to_ndc(&self, ids: &[u32]) -> Vec<f32> {
        let mut out = Vec::with_capacity(ids.len() * 3);
        for &id in ids {
            match self.inner.project_node_to_ndc(id) {
                Some(p) => out.extend_from_slice(&p),
                None => out.extend_from_slice(&[f32::NAN; 3]),
            }
        }
        out
    }

    /// `[node_id_0, cosine_0, node_id_1, cosine_1, ...]` as f64 (ids exact beyond 2^24).
    pub fn query_cosine_similar_f64(&self, node_id: u32, top_k: usize) -> Vec<f64> {
        self.inner
            .query_cosine_similar(node_id, top_k)
            .into_iter()
            .flat_map(|(id, sim)| [id as f64, sim as f64])
            .collect()
    }

    /// Returns flat `[node_id_0, cosine_sim_0, node_id_1, cosine_sim_1, ...]` for top-K cosine similar nodes.
    pub fn query_cosine_similar(&self, node_id: u32, top_k: usize) -> Vec<f32> {
        let pairs = self.inner.query_cosine_similar(node_id, top_k);
        let mut flat = Vec::with_capacity(pairs.len() * 2);
        for (id, sim) in pairs {
            flat.push(id as f32);
            flat.push(sim);
        }
        flat
    }

    pub fn embedding_dim(&self) -> usize {
        self.inner.embedding_dim()
    }

    pub fn node_count(&self) -> usize {
        self.inner.dataset().node_count()
    }

    pub fn edge_count(&self) -> usize {
        self.inner.dataset().edge_count()
    }

    // -------------------------------------------------------------------------
    // 3D Scene & Spatial World API (Three.js-style Primitives, Meshes, Physics)
    // -------------------------------------------------------------------------

    pub fn set_graph_visible(&mut self, visible: bool) {
        self.inner.set_graph_visible(visible);
    }

    pub fn move_camera_local(&mut self, forward_delta: f32, right_delta: f32, up_delta: f32) {
        self.inner
            .move_camera_local(forward_delta, right_delta, up_delta);
    }

    pub fn rotate_camera_look(&mut self, delta_yaw: f32, delta_pitch: f32) {
        self.inner.rotate_camera_look(delta_yaw, delta_pitch);
    }

    pub fn set_camera_pose(
        &mut self,
        eye_x: f32,
        eye_y: f32,
        eye_z: f32,
        target_x: f32,
        target_y: f32,
        target_z: f32,
    ) {
        self.inner.set_camera_pose(
            Vec3::new(eye_x, eye_y, eye_z),
            Vec3::new(target_x, target_y, target_z),
        );
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_primitive(
        &mut self,
        kind: u8,
        px: f32,
        py: f32,
        pz: f32,
        sx: f32,
        sy: f32,
        sz: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        body_type: u8,
    ) -> u32 {
        self.inner.scene_mut().add_primitive(
            PrimitiveKind::from_u8(kind),
            Vec3::new(px, py, pz),
            Vec3::new(sx, sy, sz),
            [r, g, b, a],
            BodyType::from_u8(body_type),
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_custom_mesh(
        &mut self,
        positions: &[f32],
        normals: &[f32],
        indices: &[u32],
        px: f32,
        py: f32,
        pz: f32,
        sx: f32,
        sy: f32,
        sz: f32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        body_type: u8,
    ) -> Result<u32, JsValue> {
        self.inner
            .scene_mut()
            .add_custom_mesh(
                positions,
                normals,
                indices,
                Vec3::new(px, py, pz),
                Vec3::new(sx, sy, sz),
                [r, g, b, a],
                BodyType::from_u8(body_type),
            )
            .map_err(JsValue::from_str)
    }

    pub fn remove_object(&mut self, object_id: u32) -> bool {
        self.inner.scene_mut().remove_object(object_id)
    }

    /// Removes every scene object and the active chart.
    pub fn clear_scene_objects(&mut self) {
        self.inner.clear_chart();
        self.inner.scene_mut().clear_objects();
    }

    pub fn object_count(&self) -> usize {
        self.inner.scene().object_count()
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_object_transform(
        &mut self,
        object_id: u32,
        px: f32,
        py: f32,
        pz: f32,
        rx: f32,
        ry: f32,
        rz: f32,
        sx: f32,
        sy: f32,
        sz: f32,
    ) -> bool {
        self.inner.scene_mut().set_object_transform(
            object_id,
            Vec3::new(px, py, pz),
            Vec3::new(rx, ry, rz),
            Vec3::new(sx, sy, sz),
        )
    }

    /// Returns `[px, py, pz, rx, ry, rz, sx, sy, sz]` for `object_id`, or empty slice if not found.
    pub fn get_object_transform(&self, object_id: u32) -> Vec<f32> {
        if let Some(obj) = self.inner.scene().find_object(object_id) {
            let p = obj.transform.position;
            let r = obj.transform.euler_radians;
            let s = obj.transform.scale;
            vec![p.x, p.y, p.z, r.x, r.y, r.z, s.x, s.y, s.z]
        } else {
            Vec::new()
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_object_material(
        &mut self,
        object_id: u32,
        r: f32,
        g: f32,
        b: f32,
        a: f32,
        metallic: f32,
        roughness: f32,
        emissive: f32,
    ) -> bool {
        self.inner.scene_mut().set_object_material(
            object_id,
            Material {
                color: [r, g, b, a],
                metallic: metallic.clamp(0.0, 1.0),
                roughness: roughness.clamp(0.04, 1.0),
                emissive: emissive.clamp(0.0, 2.0),
            },
        )
    }

    pub fn set_object_physics(
        &mut self,
        object_id: u32,
        body_type: u8,
        vx: f32,
        vy: f32,
        vz: f32,
        mass: f32,
        restitution: f32,
    ) -> bool {
        self.inner.scene_mut().set_object_physics(
            object_id,
            BodyType::from_u8(body_type),
            Vec3::new(vx, vy, vz),
            mass,
            restitution,
        )
    }

    pub fn set_object_angular_velocity(
        &mut self,
        object_id: u32,
        wx: f32,
        wy: f32,
        wz: f32,
    ) -> bool {
        if let Some(obj) = self.inner.scene_mut().find_object_mut(object_id) {
            obj.body.angular_velocity = Vec3::new(wx, wy, wz);
            true
        } else {
            false
        }
    }

    pub fn set_object_parent(&mut self, object_id: u32, parent_id: i32) -> bool {
        let opt_parent = if parent_id > 0 {
            Some(parent_id as u32)
        } else {
            None
        };
        self.inner.scene_mut().set_object_parent(object_id, opt_parent)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn set_scene_lighting(
        &mut self,
        ambient_intensity: f32,
        dir_x: f32,
        dir_y: f32,
        dir_z: f32,
        dir_intensity: f32,
        point_x: f32,
        point_y: f32,
        point_z: f32,
        point_intensity: f32,
    ) {
        let l = &mut self.inner.scene_mut().lighting;
        l.ambient_intensity = ambient_intensity.clamp(0.0, 2.0);
        l.dir_light_dir = Vec3::new(dir_x, dir_y, dir_z).normalize_or_zero();
        l.dir_light_intensity = dir_intensity.clamp(0.0, 4.0);
        l.point_light_pos = Vec3::new(point_x, point_y, point_z);
        l.point_light_intensity = point_intensity.clamp(0.0, 4.0);
    }

    pub fn set_scene_helpers(
        &mut self,
        show_grid: bool,
        grid_size: f32,
        grid_divisions: u32,
        show_axes: bool,
        axes_length: f32,
    ) {
        let h = &mut self.inner.scene_mut().helpers;
        h.show_grid = show_grid;
        h.grid_size = grid_size.max(10.0);
        h.grid_divisions = grid_divisions.clamp(2, 200);
        h.show_axes = show_axes;
        h.axes_length = axes_length.max(1.0);
    }

    pub fn set_rigid_physics(&mut self, enabled: bool, gx: f32, gy: f32, gz: f32) {
        let s = self.inner.scene_mut();
        s.rigid_physics_enabled = enabled;
        s.gravity = Vec3::new(gx, gy, gz);
    }

    pub fn pick_object_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> i32 {
        self.inner
            .pick_object_at_ndc(ndc_x, ndc_y)
            .map(|id| id as i32)
            .unwrap_or(-1)
    }

    /// Returns `[object_id as f32, hit_x, hit_y, hit_z]` if hit, or empty slice if no object hit.
    pub fn raycast_object_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> Vec<f32> {
        if let Some((id, pt)) = self.inner.raycast_object_at_ndc(ndc_x, ndc_y) {
            vec![id as f32, pt.x, pt.y, pt.z]
        } else {
            Vec::new()
        }
    }

    pub fn select_object(&mut self, object_id: i32) {
        let opt = if object_id > 0 {
            Some(object_id as u32)
        } else {
            None
        };
        self.inner.scene_mut().select_object(opt);
    }
}
