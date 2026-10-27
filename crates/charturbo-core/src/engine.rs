use crate::camera::OrbitCamera;
use crate::chart::AxisScale;
use crate::chart::{
    empty_chart_layers, AnnotationLabel, AreaMode, AxisLayout, BarLayout, BarSeriesLayout, ChartAnnotation,
    ChartFrameStyle, ChartHoverStyle, ChartPadding,
    ChartState, ChartView, HoverResult, LineLayout, LineSeries, LineYAxis, ScatterLayout, ScatterPoints,
    NavigatorHit, NavigatorOptions,
};
use crate::chart::{BrushMode, BrushStyle, ChartSelection};
use crate::chart::{CandleData, CandleLayout, CandleStyle, HistogramOptions};
use crate::chart::{HeatmapColormap, HeatmapDomain, HeatmapLayout};
use crate::chart::{BoxLayout, BoxPlotOptions};
use crate::chart::{PieOptions, PieStyle};
use crate::chart::{ComboLayout, ComboSeries};
use crate::chart::{AnimSnapshot, AnimationOptions, SvgExport};
use crate::domain::{DatasetConfig, GraphDataset};
use crate::physics::{ForceConfig, LayoutSimulator};
use crate::renderer::{InstancePacker, NodeHoverStyle, RenderBackend};
use crate::scene::{SceneHelpersConfig, SceneWorld};
use glam::Vec3;

/// Chart animation / zoom history / SVG export passthroughs (kept in their own file).
#[path = "engine_chart_ext.rs"]
mod chart_ext;

#[cfg(test)]
#[path = "engine_sleep_tests.rs"]
mod sleep_tests;

/// Per-frame telemetry produced by `VisualizationEngine`.
#[derive(Debug, Clone, Copy, Default)]
pub struct FrameTelemetry {
    pub node_count: usize,
    pub edge_count: usize,
    pub kinetic_energy: f32,
    pub hovered_node: Option<u32>,
}

/// Everything the packed graph instances depend on; repacking is skipped while it is unchanged.
#[derive(Debug, Clone, PartialEq)]
struct GraphPackKey {
    revision: u64,
    visible: bool,
    hovered: Option<u32>,
    hover_style: NodeHoverStyle,
    /// Camera matrix, only when frustum culling makes packing view-dependent
    cull_view: Option<[f32; 16]>,
}

/// Everything the packed scene meshes / helper lines depend on.
#[derive(Debug, Clone, PartialEq)]
struct ScenePackKey {
    revision: u64,
    hovered: Option<u32>,
    selected: Option<u32>,
    helpers: SceneHelpersConfig,
    /// Eye position, only while translucent objects need view-dependent sorting
    eye: Option<[f32; 3]>,
}

/// Consecutive calm layout steps (~0.5 s at 60 fps) before auto-sleep engages.
pub const SLEEP_CALM_STEPS: u32 = 30;

pub enum GpuPhysicsRequest {
    Immediate(f32),
    Pending(u32, crate::renderer::gpu_repulsion::GpuReadback),
}

struct PendingPhysics {
    ticket: u32,
    revision: u64,
    config: ForceConfig,
    dt: f32,
}

/// Share of the view `fit_to_view` fills (0.9 = 5 % margin on each side).
const FIT_VIEW_MARGIN: f32 = 0.9;

/// Facade coordinating `GraphDataset`, `SceneWorld`, `LayoutSimulator`, `OrbitCamera`, `InstancePacker`, and `RenderBackend`.
pub struct VisualizationEngine {
    dataset: GraphDataset,
    scene: SceneWorld,
    graph_visible: bool,
    simulator: Box<dyn LayoutSimulator>,
    camera: OrbitCamera,
    packer: InstancePacker,
    renderer: Box<dyn RenderBackend>,
    hovered_node: Option<u32>,
    frustum_culling: bool,
    visible_scratch_ids: Vec<u32>,
    visible_mask: Vec<bool>,
    graph_pack_key: Option<GraphPackKey>,
    scene_pack_key: Option<ScenePackKey>,
    auto_sleep_enabled: bool,
    sleep_threshold: f32,
    sleeping: bool,
    /// Consecutive layout steps whose mean per-node kinetic energy stayed under the threshold
    calm_steps: u32,
    viewport_px: (u32, u32),
    pixel_ratio: f32,
    node_hover_style: NodeHoverStyle,
    chart: Option<ChartState>,
    /// GPU still holds chart instances that must be cleared
    chart_gpu_stale: bool,
    /// Positions / masses changed since the spatial index was built (rebuilt lazily on query)
    index_dirty: bool,
    /// Chart animations (`None` = off) handed to every new chart (see chart/animation.rs)
    chart_animation: Option<AnimationOptions>,
    /// Last frame of the chart `clear_chart` removed: the next chart of the same kind / shape
    /// tweens from it
    chart_anim_prev: Option<AnimSnapshot>,
    physics_ticket: u32,
    pending_physics: Option<PendingPhysics>,
}

impl VisualizationEngine {
    pub fn new(
        dataset: GraphDataset,
        mut simulator: Box<dyn LayoutSimulator>,
        camera: OrbitCamera,
        renderer: Box<dyn RenderBackend>,
    ) -> Self {
        simulator.rebuild_spatial_index(&dataset);
        Self {
            dataset,
            scene: SceneWorld::new(),
            graph_visible: true,
            simulator,
            camera,
            packer: InstancePacker::new(),
            renderer,
            hovered_node: None,
            frustum_culling: false,
            visible_scratch_ids: Vec::new(),
            visible_mask: Vec::new(),
            graph_pack_key: None,
            scene_pack_key: None,
            auto_sleep_enabled: false,
            sleep_threshold: 0.01,
            sleeping: false,
            calm_steps: 0,
            viewport_px: (1, 1),
            pixel_ratio: 1.0,
            node_hover_style: NodeHoverStyle::default(),
            chart: None,
            chart_gpu_stale: false,
            index_dirty: false,
            chart_animation: None,
            chart_anim_prev: None,
            physics_ticket: 0,
            pending_physics: None,
        }
    }

    pub fn reload_dataset(&mut self, config: &DatasetConfig) {
        self.leave_chart_mode();
        self.dataset = GraphDataset::generate_seeded(config);
        self.simulator.rebuild_spatial_index(&self.dataset);
        self.index_dirty = false;
        self.hovered_node = None;
        self.wake_up();
    }

    pub fn load_raw_dataset(
        &mut self,
        positions: &[f32],
        masses: Option<&[f32]>,
        colors: Option<&[f32]>,
        clusters: Option<&[u16]>,
        edges: &[u32],
        edge_weights: Option<&[f32]>,
    ) -> Result<(), &'static str> {
        let ds = GraphDataset::from_raw_buffers(
            positions,
            masses,
            colors,
            clusters,
            edges,
            edge_weights,
        )?;
        self.leave_chart_mode();
        self.dataset = ds;
        self.simulator.rebuild_spatial_index(&self.dataset);
        self.index_dirty = false;
        self.hovered_node = None;
        self.wake_up();
        Ok(())
    }

    pub fn export_positions(&self) -> Vec<f32> {
        self.dataset.export_positions()
    }

    pub fn import_positions(&mut self, positions: &[f32]) -> Result<(), &'static str> {
        self.dataset.import_positions(positions)?;
        self.simulator.rebuild_spatial_index(&self.dataset);
        self.index_dirty = false;
        self.wake_up();
        Ok(())
    }

    /// Runs `ticks` simulation iterations headlessly without rendering, returning final kinetic energy.
    pub fn warmup(&mut self, ticks: usize, dt: f32) -> f32 {
        self.ensure_spatial_index();
        self.wake_up();
        for _ in 0..ticks {
            self.simulator.step(&mut self.dataset, dt);
        }
        self.dataset.total_kinetic_energy()
    }

    pub fn step_physics(&mut self, dt: f32) -> f32 {
        let scene_ke = self.scene.step_physics(dt);
        if !self.graph_visible || self.dataset.node_count() == 0 {
            return scene_ke;
        }
        if self.auto_sleep_enabled && self.sleeping {
            return scene_ke;
        }
        self.ensure_spatial_index();
        self.simulator.step(&mut self.dataset, dt);
        self.finish_physics_step(scene_ke)
    }

    /// GPU work holds a snapshot, never a borrow of the engine across an await.
    pub fn request_gpu_physics(&mut self, dt: f32) -> Result<GpuPhysicsRequest, String> {
        self.pending_physics = None;
        if !self.renderer.supports_gpu_physics() || !self.graph_visible || self.dataset.node_count() == 0
            || (self.auto_sleep_enabled && self.sleeping) || !dt.is_finite() || dt <= 0.0 {
            return Ok(GpuPhysicsRequest::Immediate(self.step_physics(dt)));
        }
        self.ensure_spatial_index();
        let Some(snapshot) = self.simulator.spatial_index().repulsion_snapshot() else {
            return Ok(GpuPhysicsRequest::Immediate(self.step_physics(dt)));
        };
        let config = self.simulator.force_config();
        let readback = self.renderer.gpu_repulsion(&snapshot, config)?;
        self.physics_ticket = self.physics_ticket.wrapping_add(1).max(1);
        self.pending_physics = Some(PendingPhysics {
            ticket: self.physics_ticket, revision: self.dataset.revision(), config, dt,
        });
        Ok(GpuPhysicsRequest::Pending(self.physics_ticket, readback))
    }

    pub fn complete_gpu_physics(&mut self, ticket: u32, forces: &[f32]) -> Result<f32, &'static str> {
        if self.pending_physics.as_ref().map(|p| p.ticket) != Some(ticket) {
            return Err("GPU physics request was superseded");
        }
        let pending = self.pending_physics.take().unwrap();
        // Revisions are globally unique, including after replacement by same-sized data.
        if !self.graph_visible || self.dataset.revision() != pending.revision || self.simulator.force_config() != pending.config {
            return Err("Graph changed while GPU physics was running; result discarded");
        }
        if !self.simulator.step_with_repulsion(&mut self.dataset, pending.dt, forces) {
            return Err("Invalid GPU repulsion result");
        }
        let scene_ke = self.scene.step_physics(pending.dt);
        Ok(self.finish_physics_step(scene_ke))
    }

    pub fn supports_gpu_physics(&self) -> bool { self.renderer.supports_gpu_physics() }

    fn finish_physics_step(&mut self, scene_ke: f32) -> f32 {
        let ke = self
            .simulator
            .kinetic_energy()
            .unwrap_or_else(|| self.dataset.total_kinetic_energy());
        if self.auto_sleep_enabled {
            // Per free node, so one threshold means the same "settled" at 50 or 50k nodes
            let free = self.dataset.nodes().iter().filter(|n| !n.is_pinned()).count();
            let mean_ke = if free == 0 { 0.0 } else { ke / free as f32 };
            if mean_ke < self.sleep_threshold {
                self.calm_steps += 1;
            } else {
                self.calm_steps = 0;
            }
            // A layout released from rest is briefly slow on its first steps: require a calm streak
            if self.calm_steps >= SLEEP_CALM_STEPS {
                self.sleeping = true;
            }
        }
        ke + scene_ke
    }

    /// `sleep_threshold` is the mean kinetic energy per free (unpinned) node, `0.5 * m * v^2`;
    /// the layout sleeps after `SLEEP_CALM_STEPS` consecutive steps below it.
    pub fn set_auto_sleep(&mut self, enabled: bool, sleep_threshold: f32) {
        let threshold = sleep_threshold.max(0.0);
        // Re-sending the same settings (e.g. every frame) must not keep the layout awake
        if enabled != self.auto_sleep_enabled || threshold != self.sleep_threshold {
            self.wake_up();
        }
        self.auto_sleep_enabled = enabled;
        self.sleep_threshold = threshold;
    }

    pub fn is_sleeping(&self) -> bool {
        self.sleeping
    }

    pub fn wake_up(&mut self) {
        self.sleeping = false;
        self.calm_steps = 0;
    }

    pub fn force_config(&self) -> ForceConfig {
        self.simulator.force_config()
    }

    pub fn set_force_config(&mut self, config: ForceConfig) {
        self.simulator.set_force_config(config);
        self.wake_up();
    }

    pub fn set_frustum_culling(&mut self, enabled: bool) {
        self.frustum_culling = enabled;
    }

    pub fn frustum_culling(&self) -> bool {
        self.frustum_culling
    }

    /// Rebuilds the spatial index if node positions / masses changed since the last build.
    /// Drags and style edits only mark it dirty, so a burst of edits costs one rebuild.
    fn ensure_spatial_index(&mut self) {
        if self.index_dirty {
            self.simulator.rebuild_spatial_index(&self.dataset);
            self.index_dirty = false;
        }
    }

    pub fn sync_and_render(&mut self) {
        if self.frustum_culling {
            self.ensure_spatial_index();
        }
        // Graph instances: repacked / re-uploaded only when the data, hover, or culling view changed
        let cull_view = (self.graph_visible && self.frustum_culling)
            .then(|| self.camera.view_proj_matrix().to_cols_array());
        let graph_key = GraphPackKey {
            revision: self.dataset.revision(),
            visible: self.graph_visible,
            hovered: self.hovered_node,
            hover_style: self.node_hover_style,
            cull_view,
        };
        if self.graph_pack_key.as_ref() != Some(&graph_key) {
            if !self.graph_visible {
                self.renderer.sync_graph(&[], 0, &[]);
            } else {
                let mask = if self.frustum_culling {
                    let frustum = self.camera.frustum();
                    self.simulator
                        .spatial_index()
                        .query_frustum(&frustum, &mut self.visible_scratch_ids);
                    self.visible_mask.clear();
                    self.visible_mask.resize(self.dataset.node_count(), false);
                    for &id in &self.visible_scratch_ids {
                        if let Some(slot) = self.visible_mask.get_mut(id as usize) {
                            *slot = true;
                        }
                    }
                    Some(self.visible_mask.as_slice())
                } else {
                    None
                };
                self.packer.pack_dataset_with_culling(
                    &self.dataset,
                    self.hovered_node,
                    mask,
                    &self.node_hover_style,
                );
                let (nodes, opaque, edges) = self.packer.packed();
                self.renderer.sync_graph(nodes, opaque, edges);
            }
            self.graph_pack_key = Some(graph_key);
        }

        // Scene meshes: repacked only when objects / hover / selection / helpers changed, or every
        // frame while translucent objects need back-to-front sorting for a moving eye
        let eye = self.camera.eye_position();
        let scene_key = ScenePackKey {
            revision: self.scene.revision(),
            hovered: self.scene.hovered_object,
            selected: self.scene.selected_object,
            helpers: self.scene.helpers,
            eye: self.scene.has_translucent_objects().then_some(eye.to_array()),
        };
        if self.scene_pack_key.as_ref() != Some(&scene_key) {
            let packed = self.scene.pack_render_data(eye);
            if let Some((vertices, indices)) = packed.geometry {
                self.renderer.sync_scene_geometry(vertices, indices);
            }
            self.renderer.sync_scene_instances(packed.instances, packed.draws);
            self.renderer.sync_helper_lines(packed.helper_lines);
            self.scene_pack_key = Some(scene_key);
        }
        self.renderer.sync_lighting(&self.scene.light_uniform(eye));

        if let Some(chart) = self.chart.as_mut() {
            // A new chart starts its enter / update animation (no-op once armed)
            chart.arm_animation(self.chart_animation, self.chart_anim_prev.take());
            let view = ChartView {
                camera: &self.camera,
                viewport_px: self.viewport_px,
                pixel_ratio: self.pixel_ratio,
            };
            let layers = chart.prepare_layers(&view);
            self.renderer.sync_chart(&layers);
        } else if self.chart_gpu_stale {
            self.renderer.sync_chart(&empty_chart_layers());
            self.chart_gpu_stale = false;
        }

        let cam_uniform =
            InstancePacker::pack_camera(&self.camera, self.viewport_px, self.pixel_ratio);
        self.renderer.render_frame(&cam_uniform);
    }

    pub fn step_and_render(&mut self, dt: f32, simulate: bool) -> FrameTelemetry {
        let kinetic_energy = if simulate {
            self.step_physics(dt)
        } else {
            self.dataset.total_kinetic_energy()
        };

        self.sync_and_render();

        FrameTelemetry {
            node_count: self.dataset.node_count(),
            edge_count: self.dataset.edge_count(),
            kinetic_energy,
            hovered_node: self.hovered_node,
        }
    }

    pub fn rotate_camera(&mut self, delta_yaw: f32, delta_pitch: f32) {
        self.camera.rotate(delta_yaw, delta_pitch);
    }

    pub fn zoom_camera(&mut self, delta: f32) {
        self.camera.zoom(delta);
    }

    pub fn pan_camera(&mut self, delta_right: f32, delta_up: f32) {
        self.camera.pan(delta_right, delta_up);
    }

    pub fn move_camera_local(&mut self, forward_delta: f32, right_delta: f32, up_delta: f32) {
        self.camera.move_local(forward_delta, right_delta, up_delta);
    }

    pub fn rotate_camera_look(&mut self, delta_yaw: f32, delta_pitch: f32) {
        self.camera.rotate_look(delta_yaw, delta_pitch);
    }

    pub fn set_camera_pose(&mut self, eye: Vec3, target: Vec3) {
        self.camera.set_pose(eye, target);
    }

    pub fn set_graph_visible(&mut self, visible: bool) {
        self.graph_visible = visible;
    }

    pub fn graph_visible(&self) -> bool {
        self.graph_visible
    }

    pub fn scene(&self) -> &SceneWorld {
        &self.scene
    }

    pub fn scene_mut(&mut self) -> &mut SceneWorld {
        &mut self.scene
    }

    pub fn pick_object_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> Option<u32> {
        let ray = self.camera.screen_to_ray(ndc_x, ndc_y);
        self.scene.pick_object(&ray)
    }

    pub fn raycast_object_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> Option<(u32, Vec3)> {
        let ray = self.camera.screen_to_ray(ndc_x, ndc_y);
        self.scene.raycast_object(&ray)
    }

    /// Frames every node from the current view direction, filling the view on its tighter axis
    /// (horizontal or vertical) with a 10 % margin.
    pub fn fit_to_view(&mut self) {
        let (center, radius) = self.dataset.compute_bounding_sphere();
        let points = self.dataset.nodes().iter().map(|n| n.position());
        self.camera.fit_to_points(center, points, radius, FIT_VIEW_MARGIN);
    }

    /// The orbit camera (pose, projection).
    pub fn camera(&self) -> &OrbitCamera {
        &self.camera
    }

    /// Centers the camera on a graph node, or on a chart data point (global id) in chart mode.
    pub fn focus_on_node(&mut self, node_id: u32) -> bool {
        if let Some(chart) = self.chart.as_ref() {
            return match chart.sample(node_id) {
                Some((_, _, _, p)) => {
                    self.camera.set_target(p);
                    true
                }
                None => false,
            };
        }
        if let Some(node) = self.dataset.nodes().get(node_id as usize) {
            self.camera.set_target(node.position());
            true
        } else {
            false
        }
    }

    pub fn project_node_to_ndc(&self, node_id: u32) -> Option<[f32; 3]> {
        let position = match self.chart.as_ref() {
            Some(chart) => chart.sample(node_id)?.3,
            None => self.dataset.nodes().get(node_id as usize)?.position(),
        };
        let ndc = self.camera.project_to_ndc(position)?;
        Some([ndc.x, ndc.y, ndc.z])
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        if (width, height) == self.viewport_px {
            return;
        }
        self.viewport_px = (width, height);
        self.camera.set_aspect(width as f32, height as f32);
        self.renderer.resize(width, height);
        // Keep the plot filling the (resized) canvas
        let css = self.css_size();
        if let Some(chart) = self.chart.as_ref() {
            chart.frame_camera(&mut self.camera, css);
        }
    }

    /// Canvas size in CSS px.
    fn css_size(&self) -> (f32, f32) {
        (
            self.viewport_px.0 as f32 / self.pixel_ratio,
            self.viewport_px.1 as f32 / self.pixel_ratio,
        )
    }

    pub fn set_clear_color(&mut self, rgba: [f32; 4]) {
        if rgba.iter().all(|c| c.is_finite()) {
            self.renderer.set_clear_color(rgba.map(|c| c.clamp(0.0, 1.0)));
        }
    }

    /// Physical pixels per CSS pixel; converts chart stroke / marker sizes to device pixels.
    pub fn set_pixel_ratio(&mut self, ratio: f32) {
        if ratio.is_finite() && ratio > 0.0 {
            self.pixel_ratio = ratio.clamp(0.25, 8.0);
        }
    }

    pub fn pixel_ratio(&self) -> f32 {
        self.pixel_ratio
    }

    pub fn set_node_hover_style(&mut self, style: NodeHoverStyle) {
        self.node_hover_style = NodeHoverStyle {
            scale: if style.scale.is_finite() { style.scale.clamp(0.5, 8.0) } else { 1.6 },
            ..style
        };
    }

    // -------------------------------------------------------------------------
    // Native charts
    // -------------------------------------------------------------------------

    /// Replaces graph content with a line chart and frames the camera on it.
    pub fn set_line_chart(&mut self, series: Vec<LineSeries>, layout: LineLayout) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_line(series, layout);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a 2D area chart (overlap / stacked / percent) and frames it.
    pub fn set_area_chart(
        &mut self,
        series: Vec<LineSeries>,
        layout: LineLayout,
        mode: AreaMode,
        fill_opacity: f32,
    ) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_area(series, layout, mode, fill_opacity);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a bar chart (3D view adds lit boxes to the scene).
    pub fn set_bar_chart(&mut self, values: Vec<f32>, colors: Vec<[f32; 4]>, layout: BarLayout) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_bar(values, colors, layout, &mut self.scene);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a grouped / stacked bar chart (values flat `[s * N + i]`).
    pub fn set_bar_chart_series(
        &mut self,
        values: Vec<f32>,
        colors: Vec<[f32; 4]>,
        layout: BarLayout,
        series: BarSeriesLayout,
    ) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_bar_series(values, colors, layout, series, &mut self.scene);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a 2D scatter / bubble chart (instanced points, grid-hash hover).
    pub fn set_scatter_chart(&mut self, points: ScatterPoints, layout: ScatterLayout) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_scatter(points, layout);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a 2D candlestick chart (optional volume pane) and frames it.
    pub fn set_candle_chart(&mut self, data: CandleData, layout: CandleLayout, style: CandleStyle) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_candle(data, layout, style);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a `cols x rows` heatmap (one textured quad) and frames it.
    pub fn set_heatmap_chart(&mut self, cols: usize, rows: usize, values: Vec<f32>, layout: HeatmapLayout) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_heatmap(cols, rows, values, layout);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a box plot / violin chart (per-group stats and KDE computed
    /// here; the raw samples are not kept) and frames it. Returns the finite sample count.
    #[allow(clippy::too_many_arguments)]
    pub fn set_box_chart(
        &mut self,
        values: &[f32],
        offsets: &[usize],
        series_count: usize,
        categories: usize,
        colors: Vec<[f32; 4]>,
        layout: BoxLayout,
        opts: BoxPlotOptions,
    ) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_box_plot(values, offsets, series_count, categories, colors, layout, opts);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a pie / donut chart (validated values) and frames it.
    /// Returns the displayed slice count (after "Other" folding).
    pub fn set_pie_chart(&mut self, values: &[f64], opts: PieOptions, style: PieStyle) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_pie(values, opts, style);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Replaces graph content with a 2D combo chart (bar / line / area series on shared x) and
    /// frames it. Returns the data point count (`series * categories`).
    pub fn set_combo_chart(
        &mut self,
        series: Vec<ComboSeries>,
        x: Option<Vec<f64>>,
        layout: ComboLayout,
        y_axes: [LineYAxis; 2],
    ) -> Result<usize, String> {
        let chart = ChartState::new_combo(series, x, layout, y_axes)?;
        self.begin_chart();
        let css = self.css_size();
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        Ok(n)
    }

    /// Replaces graph content with a prepared chart (radar / gauge / funnel / waterfall, see
    /// lib_business.rs; hierarchy / flow charts, lib_hierarchy.rs) and frames it. Returns its
    /// point count.
    pub fn set_chart_state(&mut self, chart: ChartState) -> usize {
        self.begin_chart();
        let css = self.css_size();
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Hovers a hierarchy / flow chart item directly (keyboard focus): series 0 = node,
    /// 1 = sankey link.
    pub fn chart_hover_hierarchy_item(&mut self, series: u32, index: u32) -> Option<HoverResult> {
        let chart = self.chart.as_mut()?;
        chart.hover_hierarchy_item(&mut self.scene, series, index)
    }

    /// Slice palette / colors of the current pie chart (no-op for other charts).
    pub fn set_chart_pie_style(&mut self, style: PieStyle) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_pie_style(style);
        }
    }

    /// Restyles the current candlestick chart (no-op for other charts).
    pub fn set_chart_candle_style(&mut self, style: CandleStyle) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_candle_style(style);
        }
    }

    /// Replaces graph content with a histogram of `values` (binned in Rust, drawn as bars).
    /// Returns the bin count.
    pub fn set_histogram_chart(
        &mut self,
        values: &[f32],
        opts: &HistogramOptions,
        color: [f32; 4],
        layout: BarLayout,
        gap_px: f32,
    ) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_histogram(values, opts, color, layout, gap_px, &mut self.scene);
        chart.frame_camera(&mut self.camera, css);
        let n = chart.point_count();
        self.chart = Some(chart);
        n
    }

    /// Colormap of the current heatmap (no-op for other charts).
    pub fn set_chart_heatmap_colormap(&mut self, map: HeatmapColormap) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_heatmap_colormap(map);
        }
    }

    /// Value domain overrides of the current heatmap.
    pub fn set_chart_heatmap_domain(&mut self, domain: HeatmapDomain) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_heatmap_domain(domain);
        }
    }

    fn begin_chart(&mut self) {
        self.clear_chart();
        // Charts never draw graph nodes: drop the dataset so nothing is packed or uploaded for it
        self.dataset = GraphDataset::default_empty();
        self.simulator.rebuild_spatial_index(&self.dataset);
        self.index_dirty = false;
        self.hovered_node = None;
        self.scene.hovered_object = None;
    }

    /// Removes the chart. Its last frame stays for an update animation of the next chart (the SDK
    /// clears before every render); loading graph data drops it (`leave_chart_mode`).
    pub fn clear_chart(&mut self) {
        self.take_chart(true);
    }

    /// Graph content replaces the chart: no later chart tweens from it.
    fn leave_chart_mode(&mut self) {
        self.take_chart(false);
    }

    /// Removes the chart; `keep_snapshot` (a new chart replaces it) keeps its last frame for an
    /// update animation of the next chart (only with animations on).
    fn take_chart(&mut self, keep_snapshot: bool) {
        if !keep_snapshot {
            self.chart_anim_prev = None;
        }
        if let Some(mut chart) = self.chart.take() {
            if keep_snapshot {
                // A chart replaced before its first frame keeps the older chart's snapshot
                if let Some(s) = chart.anim_snapshot() {
                    self.chart_anim_prev = Some(s);
                }
            }
            chart.release(&mut self.scene);
            self.chart_gpu_stale = true;
        }
    }

    pub fn has_chart(&self) -> bool {
        self.chart.is_some()
    }

    pub fn chart(&self) -> Option<&ChartState> {
        self.chart.as_ref()
    }

    /// Active chart, mutable (bindings kept in their own modules, e.g. `lib_sparkline.rs`).
    pub fn chart_mut(&mut self) -> Option<&mut ChartState> {
        self.chart.as_mut()
    }

    pub fn chart_hover_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> Option<HoverResult> {
        let chart = self.chart.as_mut()?;
        let view = ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        };
        chart.hover_at(&view, &mut self.scene, (ndc_x, ndc_y))
    }

    pub fn chart_clear_hover(&mut self) {
        if let Some(chart) = self.chart.as_mut() {
            chart.clear_hover(&mut self.scene);
        }
    }

    /// Hovers the chart at a data x (cursor sync with another chart); see `hover_at_data_x`.
    pub fn chart_hover_at_data_x(&mut self, x: f64) -> Option<HoverResult> {
        let chart = self.chart.as_mut()?;
        chart.hover_at_data_x(&mut self.scene, x)
    }

    /// Data x of the current chart hover (what synced charts hover at).
    pub fn chart_hover_data_x(&self) -> Option<f64> {
        self.chart.as_ref()?.hover_data_x()
    }

    pub fn set_chart_line_width(&mut self, series: Option<usize>, width_px: f32) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_line_width(series, width_px);
        }
    }

    pub fn set_chart_hover_style(&mut self, style: ChartHoverStyle) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_hover_style(style, &mut self.scene);
        }
    }

    pub fn set_chart_frame_style(&mut self, style: ChartFrameStyle) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_frame_style(style);
        }
    }

    /// Reserves CSS-px margins around the plot (axis labels, legend, title) and re-frames.
    pub fn set_chart_padding(&mut self, padding: ChartPadding) {
        let css = self.css_size();
        if let Some(chart) = self.chart.as_mut() {
            chart.set_padding(padding);
            chart.frame_camera(&mut self.camera, css);
        }
    }

    pub fn set_chart_series_visible(&mut self, series: usize, visible: bool) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_series_visible(series, visible, &mut self.scene);
        }
    }

    pub fn set_chart_emphasis(&mut self, series: Option<usize>) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_emphasis(series);
        }
    }

    pub fn chart_zoom_x(&mut self, factor: f32, anchor_ndc_x: f32) {
        if let Some(chart) = self.chart.as_mut() {
            let view = ChartView {
                camera: &self.camera,
                viewport_px: self.viewport_px,
                pixel_ratio: self.pixel_ratio,
            };
            chart.zoom_x(&view, factor, anchor_ndc_x);
        }
    }

    pub fn chart_pan_x(&mut self, delta_ndc_x: f32) {
        if let Some(chart) = self.chart.as_mut() {
            let view = ChartView {
                camera: &self.camera,
                viewport_px: self.viewport_px,
                pixel_ratio: self.pixel_ratio,
            };
            chart.pan_x(&view, delta_ndc_x);
        }
    }

    /// Zooms both axes of a scatter chart around the pointer (`factor` < 1 zooms in).
    pub fn chart_zoom_xy(&mut self, factor: f32, anchor_ndc_x: f32, anchor_ndc_y: f32) {
        if let Some(chart) = self.chart.as_mut() {
            let view = ChartView {
                camera: &self.camera,
                viewport_px: self.viewport_px,
                pixel_ratio: self.pixel_ratio,
            };
            chart.zoom_xy(&view, factor, (anchor_ndc_x, anchor_ndc_y));
        }
    }

    /// Pans both axes of a scatter chart by a pointer delta in NDC.
    pub fn chart_pan_xy(&mut self, delta_ndc_x: f32, delta_ndc_y: f32) {
        if let Some(chart) = self.chart.as_mut() {
            let view = ChartView {
                camera: &self.camera,
                viewport_px: self.viewport_px,
                pixel_ratio: self.pixel_ratio,
            };
            chart.pan_xy(&view, delta_ndc_x, delta_ndc_y);
        }
    }

    pub fn chart_reset_zoom(&mut self) {
        if let Some(chart) = self.chart.as_mut() {
            chart.reset_zoom();
        }
    }

    /// Visible x / y range in data units (`None`: no chart, bar chart, or y of a line chart).
    pub fn chart_x_range(&self) -> Option<(f64, f64)> {
        self.chart.as_ref().and_then(|c| c.x_range_data())
    }

    pub fn chart_y_range(&self) -> Option<(f64, f64)> {
        self.chart.as_ref().and_then(|c| c.y_range_data())
    }

    /// Zooms the x axis to a data range (2D line / scatter); true when the view moved.
    pub fn chart_set_x_range(&mut self, lo: f64, hi: f64) -> bool {
        self.chart.as_mut().is_some_and(|c| c.set_x_range_data(lo, hi))
    }

    /// Zooms the y axis of a scatter chart to a data range; true when the view moved.
    pub fn chart_set_y_range(&mut self, lo: f64, hi: f64) -> bool {
        self.chart.as_mut().is_some_and(|c| c.set_y_range_data(lo, hi))
    }

    /// Shows / hides the range selector strip of a 2D line / area chart and re-frames the plot
    /// above it.
    pub fn set_chart_navigator(&mut self, opts: NavigatorOptions) {
        let css = self.css_size();
        if let Some(chart) = self.chart.as_mut() {
            chart.set_navigator(opts);
            chart.frame_camera(&mut self.camera, css);
        }
    }

    /// Navigator region under the pointer (NDC).
    pub fn chart_navigator_hit(&self, ndc_x: f32, ndc_y: f32) -> NavigatorHit {
        let Some(chart) = self.chart.as_ref() else {
            return NavigatorHit::None;
        };
        let view = ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        };
        chart.navigator_hit(&view, (ndc_x, ndc_y))
    }

    /// Navigator strip `[left, top, width, height]` in CSS px (`None` without one).
    pub fn chart_navigator_rect(&self) -> Option<[f32; 4]> {
        let chart = self.chart.as_ref()?;
        let view = ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        };
        chart.navigator_rect_css(&view)
    }

    /// Moves (window / outside) or resizes (handles) the navigator window by a pointer delta.
    pub fn chart_navigator_drag(&mut self, hit: NavigatorHit, delta_ndc_x: f32) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        let view = ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        };
        chart.navigator_drag(&view, hit, delta_ndc_x)
    }

    /// Centers the navigator window on the strip x under the pointer.
    pub fn chart_navigator_center(&mut self, ndc_x: f32) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        let view = ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        };
        chart.navigator_center(&view, ndc_x)
    }

    /// Zooms the navigator window around the strip x under the pointer (`factor` < 1 = in).
    pub fn chart_navigator_zoom(&mut self, factor: f32, ndc_x: f32) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        let view = ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        };
        chart.navigator_zoom(&view, factor, ndc_x)
    }

    /// y domain options of the current line chart (fixed ends, autoscale, nice ends).
    pub fn set_chart_y_axis(&mut self, axis: LineYAxis) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_y_axis(axis);
        }
    }

    /// Axis scale (0 = x, 1 = left y, 2 = right y): linear / log, reversed, tick hint. Positions
    /// move, so the hover is re-picked at the resting pointer.
    pub fn set_chart_axis_scale(&mut self, axis: u8, scale: AxisScale) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_axis_scale(axis, scale);
        }
        self.refresh_chart_hover();
    }

    /// Assigns line series to y axes (0 = left, 1 = right).
    pub fn set_chart_series_axes(&mut self, axes: &[u8]) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_series_axes(axes);
        }
        self.refresh_chart_hover();
    }

    /// Right y axis domain options of a dual-axis line chart.
    pub fn set_chart_y2_axis(&mut self, axis: LineYAxis) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_y2_axis(axis);
        }
    }

    /// y axis of each annotation (0 = left, 1 = right).
    pub fn set_chart_annotation_y_axes(&mut self, axes: &[u8]) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_annotation_y_axes(axes);
        }
    }

    /// Replaces one line series' data in place (styles and zoom kept). Returns the new length.
    pub fn set_chart_series_data(&mut self, series: usize, values: Vec<f32>, x: Option<Vec<f64>>) -> Result<usize, String> {
        let chart = self.chart.as_mut().ok_or("no chart")?;
        let n = chart.set_series_data(series, values, x)?;
        self.refresh_chart_hover();
        Ok(n)
    }

    /// Appends samples to one line series (`max_points > 0` keeps the newest only). Returns
    /// the new length.
    pub fn append_chart_series_data(
        &mut self,
        series: usize,
        values: &[f32],
        x: Option<&[f64]>,
        max_points: usize,
    ) -> Result<usize, String> {
        let chart = self.chart.as_mut().ok_or("no chart")?;
        let n = chart.append_series_data(series, values, x, max_points)?;
        self.refresh_chart_hover();
        Ok(n)
    }

    /// Appends a validated, aligned batch to every area series in a single update.
    pub fn append_area_data(&mut self, values: &[&[f32]], xs: Option<&[&[f64]]>, max_points: usize) -> Result<Vec<usize>, String> {
        let lengths = self.chart.as_mut().ok_or("no chart")?.append_area_data(values, xs, max_points)?;
        self.refresh_chart_hover();
        Ok(lengths)
    }

    /// Re-picks the hover at the resting pointer after a data update.
    fn refresh_chart_hover(&mut self) {
        if let Some(chart) = self.chart.as_mut() {
            let view = ChartView {
                camera: &self.camera,
                viewport_px: self.viewport_px,
                pixel_ratio: self.pixel_ratio,
            };
            chart.refresh_hover(&view, &mut self.scene);
        }
    }

    /// Axis layout of the last rendered frame and its revision (changes when labels move).
    pub fn chart_axes(&self) -> Option<(&AxisLayout, u32)> {
        self.chart.as_ref().map(|c| (c.axes(), c.axes_revision()))
    }

    /// Replaces the annotations of the active chart (reference lines, bands, markers).
    pub fn set_chart_annotations(&mut self, items: Vec<ChartAnnotation>) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_annotations(items);
        }
    }

    pub fn clear_chart_annotations(&mut self) {
        if let Some(chart) = self.chart.as_mut() {
            chart.clear_annotations();
        }
    }

    /// Annotation label anchors of the last rendered frame and their revision.
    pub fn chart_annotation_labels(&self) -> Option<(&[AnnotationLabel], u32)> {
        self.chart
            .as_ref()
            .map(|c| (c.annotation_labels(), c.annotation_labels_revision()))
    }

    /// Live brush rectangle from NDC `a` (drag start) to `b` (pointer); false outside 2D charts.
    pub fn chart_brush(&mut self, mode: BrushMode, a: (f32, f32), b: (f32, f32)) -> bool {
        let Some(chart) = self.chart.as_mut() else {
            return false;
        };
        let view = ChartView {
            camera: &self.camera,
            viewport_px: self.viewport_px,
            pixel_ratio: self.pixel_ratio,
        };
        chart.brush_update(&view, mode, a, b)
    }

    /// Commits the live brush and returns its selection.
    pub fn chart_brush_end(&mut self) -> Option<&ChartSelection> {
        self.chart.as_mut()?.brush_end()
    }

    /// Selects a data rectangle (`y` `None` = whole y range).
    pub fn chart_select_data(&mut self, mode: BrushMode, x: (f64, f64), y: Option<(f64, f64)>) -> Option<&ChartSelection> {
        self.chart.as_mut()?.select_data(mode, x, y)
    }

    /// Committed brush selection (re-queried after data / visibility changes).
    pub fn chart_selection(&mut self) -> Option<&ChartSelection> {
        self.chart.as_mut()?.selection()
    }

    pub fn chart_clear_selection(&mut self) {
        if let Some(chart) = self.chart.as_mut() {
            chart.clear_selection();
        }
    }

    pub fn set_chart_brush_style(&mut self, style: BrushStyle) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_brush_style(style);
        }
    }

    /// Re-frames the camera on the current chart.
    pub fn chart_fit_view(&mut self) {
        let css = self.css_size();
        if let Some(chart) = self.chart.as_mut() {
            chart.reset_zoom();
            chart.frame_camera(&mut self.camera, css);
        }
    }

    pub fn pick_node_at_ndc(&mut self, ndc_x: f32, ndc_y: f32) -> Option<u32> {
        self.ensure_spatial_index();
        let ray = self.camera.screen_to_ray(ndc_x, ndc_y);
        self.hovered_node = self.simulator.spatial_index().query_ray(&ray, 2.5);
        self.hovered_node
    }

    pub fn select_box_ndc(
        &mut self,
        min_ndc_x: f32,
        min_ndc_y: f32,
        max_ndc_x: f32,
        max_ndc_y: f32,
    ) -> Vec<u32> {
        self.ensure_spatial_index();
        let box_frustum = self
            .camera
            .sub_frustum_from_ndc_box(min_ndc_x, min_ndc_y, max_ndc_x, max_ndc_y);
        let mut selected = Vec::new();
        self.simulator
            .spatial_index()
            .query_frustum(&box_frustum, &mut selected);
        selected.sort_unstable();
        self.dataset.select_nodes(&selected);
        selected
    }

    pub fn query_radius(&mut self, center: Vec3, radius: f32, max_results: usize) -> Vec<u32> {
        self.ensure_spatial_index();
        self.simulator
            .spatial_index()
            .query_sphere(center, radius, max_results)
    }

    pub fn select_node_and_neighbors(&mut self, node_id: u32, hops: usize) -> Vec<u32> {
        self.dataset.select_neighbors(node_id, hops)
    }

    pub fn select_cluster(&mut self, cluster_id: u16) -> Vec<u32> {
        self.dataset.select_cluster(cluster_id)
    }

    pub fn clear_selection(&mut self) {
        self.dataset.clear_selection();
    }

    pub fn set_node_pinned(&mut self, node_id: u32, pinned: bool) -> bool {
        let ok = self.dataset.set_node_pinned(node_id, pinned);
        if ok {
            self.wake_up();
        }
        ok
    }

    pub fn move_node_to(&mut self, node_id: u32, position: Vec3) -> bool {
        let ok = self.dataset.set_node_position(node_id, position);
        if ok {
            self.index_dirty = true;
            self.wake_up();
        }
        ok
    }

    /// Returns `[x, y, z, mass, cluster_id, r, g, b, a, degree, selected, pinned]` for `node_id`.
    pub fn get_node_info(&self, node_id: u32) -> Vec<f32> {
        if let Some(node) = self.dataset.nodes().get(node_id as usize) {
            let p = node.position();
            let c = node.color();
            let deg = self.dataset.degree_of(node_id);
            vec![
                p.x,
                p.y,
                p.z,
                node.mass(),
                node.cluster_id() as f32,
                c[0],
                c[1],
                c[2],
                c[3],
                deg as f32,
                if node.is_selected() { 1.0 } else { 0.0 },
                if node.is_pinned() { 1.0 } else { 0.0 },
            ]
        } else {
            Vec::new()
        }
    }

    pub fn get_node_neighbors(&self, node_id: u32) -> Vec<u32> {
        self.dataset.neighbors_of(node_id)
    }

    pub fn select_shortest_path(&mut self, start_id: u32, end_id: u32) -> Vec<u32> {
        self.dataset.select_shortest_path(start_id, end_id)
    }

    pub fn set_node_style(
        &mut self,
        node_id: u32,
        color: [f32; 4],
        mass: f32,
        cluster_id: u16,
    ) -> bool {
        let ok = self.dataset.set_node_style(node_id, color, mass, cluster_id);
        // Mass drives the pick radius and forces
        self.index_dirty |= ok;
        ok
    }

    pub fn apply_preset_layout(&mut self, layout_kind: u8, space_radius: f32) {
        self.dataset.apply_preset_layout(layout_kind, space_radius);
        self.simulator.rebuild_spatial_index(&self.dataset);
        self.index_dirty = false;
        self.wake_up();
    }

    #[allow(clippy::too_many_arguments)]
    pub fn load_high_dim_embeddings(
        &mut self,
        vectors: &[f32],
        dim: usize,
        projection_mode: u8,
        k_neighbors: usize,
        similarity_threshold: f32,
        clusters: Option<&[u16]>,
        warmup_ticks: usize,
        space_radius: f32,
    ) -> Result<(), &'static str> {
        let ds = GraphDataset::from_high_dim_embeddings(
            vectors,
            dim,
            projection_mode,
            k_neighbors,
            similarity_threshold,
            clusters,
            space_radius,
        )?;
        self.leave_chart_mode();
        self.dataset = ds;
        self.hovered_node = None;
        self.wake_up();
        self.simulator.rebuild_spatial_index(&self.dataset);
        self.index_dirty = false;
        if warmup_ticks > 0 {
            self.warmup(warmup_ticks, 0.016);
        }
        Ok(())
    }

    pub fn query_cosine_similar(&self, node_id: u32, top_k: usize) -> Vec<(u32, f32)> {
        self.dataset.query_cosine_similar(node_id, top_k)
    }

    pub fn embedding_dim(&self) -> usize {
        self.dataset.embedding_dim()
    }

    pub fn dataset(&self) -> &GraphDataset {
        &self.dataset
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::physics::{ForceConfig, ForceDirectedSimulator};
    use crate::renderer::MockRenderBackend;
    use crate::spatial::OctreeSpatialIndex;
    use std::cell::RefCell;
    use std::rc::Rc;

    struct SharedMockRenderer(Rc<RefCell<MockRenderBackend>>);

    impl RenderBackend for SharedMockRenderer {
        fn sync_graph(
            &mut self,
            nodes: &[crate::renderer::NodeInstanceRaw],
            opaque_nodes: usize,
            edge_vertices: &[crate::renderer::EdgeVertexRaw],
        ) {
            self.0
                .borrow_mut()
                .sync_graph(nodes, opaque_nodes, edge_vertices);
        }

        fn sync_scene_geometry(&mut self, vertices: &[crate::renderer::MeshVertexRaw], indices: &[u32]) {
            self.0.borrow_mut().sync_scene_geometry(vertices, indices);
        }

        fn sync_scene_instances(
            &mut self,
            instances: &[crate::renderer::MeshInstanceRaw],
            draws: &[crate::renderer::MeshDraw],
        ) {
            self.0.borrow_mut().sync_scene_instances(instances, draws);
        }

        fn sync_helper_lines(&mut self, lines: &[crate::renderer::EdgeVertexRaw]) {
            self.0.borrow_mut().sync_helper_lines(lines);
        }

        fn sync_chart(&mut self, layers: &crate::renderer::ChartLayers<'_>) {
            self.0.borrow_mut().sync_chart(layers);
        }

        fn render_frame(&mut self, camera: &crate::renderer::CameraUniformRaw) {
            self.0.borrow_mut().render_frame(camera);
        }

        fn resize(&mut self, width: u32, height: u32) {
            self.0.borrow_mut().resize(width, height);
        }
    }

    fn mock_engine(ds: GraphDataset) -> (VisualizationEngine, Rc<RefCell<MockRenderBackend>>) {
        let sim = Box::new(ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig::default(),
        ));
        let cam = OrbitCamera::new(150.0, 1.6);
        let state = Rc::new(RefCell::new(MockRenderBackend::default()));
        let renderer = Box::new(SharedMockRenderer(Rc::clone(&state)));
        let mut engine = VisualizationEngine::new(ds, sim, cam, renderer);
        engine.resize(1600, 900);
        (engine, state)
    }

    #[test]
    fn static_frames_do_not_repack_or_reupload_graph_and_scene() {
        let ds = GraphDataset::generate_seeded(&DatasetConfig {
            seed: 1,
            node_count: 200,
            edge_count: 300,
            cluster_count: 3,
            space_radius: 60.0,
        });
        let (mut engine, state) = mock_engine(ds);
        engine.scene_mut().add_primitive(
            crate::scene::PrimitiveKind::Box,
            Vec3::ZERO,
            Vec3::ONE,
            [1.0; 4],
            crate::scene::BodyType::Static,
        );
        engine.sync_and_render();
        engine.rotate_camera(0.3, 0.1); // camera-only change
        engine.sync_and_render();
        engine.sync_and_render();
        {
            let s = state.borrow();
            assert_eq!(s.rendered_frames, 3);
            assert_eq!(s.graph_uploads, 1);
            assert_eq!(s.mesh_uploads, 1);
        }
        // A physics step moves nodes: exactly one more graph upload
        engine.step_physics(0.016);
        engine.sync_and_render();
        assert_eq!(state.borrow().graph_uploads, 2);
        // Hover change repacks too
        engine.pick_node_at_ndc(5.0, 5.0);
        engine.sync_and_render();
        assert_eq!(state.borrow().graph_uploads, 2, "no hover -> no change");
    }

    #[test]
    fn line_chart_replaces_graph_and_uploads_layers_only_when_needed() {
        let ds = GraphDataset::generate_seeded(&DatasetConfig::default());
        let (mut engine, state) = mock_engine(ds);
        let series = (0..3)
            .map(|k| crate::chart::LineSeries {
                values: (0..10_000).map(|i| ((i + k * 100) as f32 * 0.01).sin()).collect(),
                x: None,
                color: [1.0, 0.5, 0.0, 1.0],
                width_px: 2.0,
            })
            .collect();
        let n = engine.set_line_chart(
            series,
            crate::chart::LineLayout {
                width: 160.0,
                height: 80.0,
                view: crate::chart::ChartViewMode::Flat,
                x_kind: crate::chart::LineXKind::Numeric,
            },
        );
        assert_eq!(n, 30_000);
        assert_eq!(engine.dataset().node_count(), 0);
        engine.sync_and_render();
        {
            let s = state.borrow();
            assert_eq!(s.synced_node_count, 0);
            assert!(s.chart_series_count > 0);
            assert_eq!(s.chart_underlay_count, 5); // nice ticks -1, -0.5, 0, 0.5, 1
        }
        let uploads = state.borrow().chart_uploads;
        engine.sync_and_render();
        assert_eq!(state.borrow().chart_uploads, uploads, "static chart frame uploads nothing");

        let c = engine
            .project_node_to_ndc(15_000)
            .expect("mid sample of series 1 is on screen");
        let hit = engine.chart_hover_at_ndc(c[0], c[1]).expect("hover");
        assert_eq!(hit.items.len(), 3);
        engine.sync_and_render();
        assert_eq!(state.borrow().chart_marker_count, 3);

        engine.set_chart_line_width(Some(0), 5.0);
        engine.sync_and_render();
        assert_eq!(state.borrow().chart_uploads, uploads + 2);

        // Loading a graph removes the chart from the GPU
        engine.reload_dataset(&DatasetConfig::default());
        engine.sync_and_render();
        assert_eq!(state.borrow().chart_series_count, 0);
        assert!(!engine.has_chart());
    }

    #[test]
    fn scatter_chart_uploads_points_once_and_zoom_only_moves_the_uniform() {
        let ds = GraphDataset::generate_seeded(&DatasetConfig::default());
        let (mut engine, state) = mock_engine(ds);
        let n = 250_000;
        let points = crate::chart::ScatterPoints {
            xs: (0..n).map(|i| (i as f32 * 0.37).sin() * 100.0).collect(),
            ys: (0..n).map(|i| (i as f32 * 0.11).cos() * 50.0).collect(),
            series: (0..n).map(|i| (i % 4) as u16).collect(),
            series_colors: vec![[1.0, 0.0, 0.0, 1.0]; 4],
            ..Default::default()
        };
        assert_eq!(engine.set_scatter_chart(points, crate::chart::ScatterLayout::default()), n);
        assert_eq!(engine.dataset().node_count(), 0);
        engine.sync_and_render();
        {
            let s = state.borrow();
            assert_eq!(s.chart_point_count, n);
            assert_eq!(s.chart_point_uploads, 1);
            assert!(s.chart_point_style.is_some());
            assert!(s.chart_underlay_count > 2);
        }
        assert_eq!(engine.chart().unwrap().series_count(), 4);

        engine.chart_zoom_xy(0.5, 0.1, 0.1);
        engine.chart_pan_xy(0.05, -0.05);
        engine.sync_and_render();
        let style = state.borrow().chart_point_style.unwrap();
        assert!((style.transform[0] - 2.0).abs() < 1e-4);
        assert_eq!(state.borrow().chart_point_uploads, 1, "zoom / pan never re-upload points");

        // Hover the point a sample projects to (inside the unzoomed plot); the marker follows
        engine.chart_reset_zoom();
        let c = engine.project_node_to_ndc(1234).expect("point on screen");
        let hit = engine.chart_hover_at_ndc(c[0], c[1]).expect("hover");
        assert_eq!(hit.items.len(), 1);
        engine.sync_and_render();
        assert_eq!(state.borrow().chart_marker_count, 1);

        // Legend toggles only rewrite the per-series alpha in the uniform
        engine.set_chart_series_visible(2, false);
        engine.sync_and_render();
        assert_eq!(state.borrow().chart_point_count, n);
        assert_eq!(state.borrow().chart_point_uploads, 1);
        assert_eq!(state.borrow().chart_point_style.unwrap().slot_alpha(2), 0.0);

        engine.clear_chart();
        engine.sync_and_render();
        assert_eq!(state.borrow().chart_point_count, 0);
    }

    #[test]
    fn engine_coordinates_simulation_packing_and_rendering_on_each_tick() {
        let ds = GraphDataset::generate_seeded(&DatasetConfig {
            seed: 42,
            node_count: 50,
            edge_count: 80,
            cluster_count: 4,
            space_radius: 60.0,
        });
        let sim = Box::new(ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig::default(),
        ));
        let cam = OrbitCamera::new(150.0, 1.6);
        let mock_state = Rc::new(RefCell::new(MockRenderBackend::default()));
        let renderer = Box::new(SharedMockRenderer(Rc::clone(&mock_state)));

        let mut engine = VisualizationEngine::new(ds, sim, cam, renderer);
        engine.resize(1280, 720);

        let telemetry = engine.step_and_render(0.016, true);

        assert_eq!(telemetry.node_count, 50);
        assert_eq!(telemetry.edge_count, 80);
        assert!(telemetry.kinetic_energy > 0.0);

        let state = mock_state.borrow();
        assert_eq!(state.viewport_size, (1280, 720));
        assert_eq!(state.synced_node_count, 50);
        assert_eq!(state.synced_edge_vertex_count, 160);
        assert_eq!(state.rendered_frames, 1);
        assert!(state.last_camera.is_some());
    }

    #[test]
    fn engine_supports_raw_dataset_loading_warmup_and_auto_sleep() {
        let ds = GraphDataset::default_empty();
        let sim = Box::new(ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig::default(),
        ));
        let cam = OrbitCamera::new(100.0, 1.0);
        let mock_state = Rc::new(RefCell::new(MockRenderBackend::default()));
        let renderer = Box::new(SharedMockRenderer(Rc::clone(&mock_state)));

        let mut engine = VisualizationEngine::new(ds, sim, cam, renderer);

        let positions = [-5.0, 0.0, 0.0, 5.0, 0.0, 0.0, 0.0, 5.0, 0.0];
        let edges = [0u32, 1, 1, 2];
        engine
            .load_raw_dataset(&positions, None, None, None, &edges, None)
            .unwrap();

        assert_eq!(engine.dataset().node_count(), 3);
        assert_eq!(engine.dataset().edge_count(), 2);

        // Warmup 5 ticks headlessly without invoking renderer
        let ke = engine.warmup(5, 0.016);
        assert!(ke > 0.0);
        assert_eq!(mock_state.borrow().rendered_frames, 0);

        // Enable auto-sleep with a very high threshold: sleeps once the calm streak completes
        engine.set_auto_sleep(true, 1e9);
        for _ in 0..SLEEP_CALM_STEPS {
            engine.step_physics(0.016);
        }
        assert!(engine.is_sleeping());

        // Moving a node wakes the engine back up
        engine.move_node_to(0, glam::Vec3::new(-10.0, 0.0, 0.0));
        assert!(!engine.is_sleeping());
    }

    #[test]
    fn engine_box_select_neighbor_highlight_and_frustum_culling_work_end_to_end() {
        let positions = [
            0.0, 0.0, 0.0, // Node 0 at origin (inside center NDC box)
            1.0, 0.0, 0.0, // Node 1 near origin
            900.0, 900.0, 900.0, // Node 2 far outside view frustum
        ];
        let edges = [0u32, 1, 1, 2];
        let ds =
            GraphDataset::from_raw_buffers(&positions, None, None, None, &edges, None).unwrap();
        let sim = Box::new(ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig::default(),
        ));
        let cam = OrbitCamera::new(100.0, 1.0);
        let mock_state = Rc::new(RefCell::new(MockRenderBackend::default()));
        let renderer = Box::new(SharedMockRenderer(Rc::clone(&mock_state)));

        let mut engine = VisualizationEngine::new(ds, sim, cam, renderer);

        // Box select around center screen should capture nodes 0 and 1, not 2
        let box_selected = engine.select_box_ndc(-0.3, -0.3, 0.3, 0.3);
        assert!(box_selected.contains(&0));
        assert!(box_selected.contains(&1));
        assert!(!box_selected.contains(&2));

        // Enable frustum culling: Node 2 (at 900, 900, 900) should be culled during sync_and_render
        engine.set_frustum_culling(true);
        engine.sync_and_render();
        assert_eq!(mock_state.borrow().synced_node_count, 2);
    }

    #[test]
    fn engine_renders_3d_scene_meshes_helpers_and_supports_raycast_picking() {
        use crate::scene::{BodyType, PrimitiveKind};

        let ds = GraphDataset::default_empty();
        let sim = Box::new(ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig::default(),
        ));
        let cam = OrbitCamera::new(100.0, 1.0);
        let mock_state = Rc::new(RefCell::new(MockRenderBackend::default()));
        let renderer = Box::new(SharedMockRenderer(Rc::clone(&mock_state)));

        let mut engine = VisualizationEngine::new(ds, sim, cam, renderer);
        engine.scene_mut().helpers.show_grid = true;
        engine.scene_mut().helpers.show_axes = true;

        let box_id = engine.scene_mut().add_primitive(
            PrimitiveKind::Box,
            Vec3::ZERO,
            Vec3::splat(10.0),
            [0.2, 0.7, 1.0, 1.0],
            BodyType::Static,
        );

        let picked = engine.pick_object_at_ndc(0.0, 0.0);
        assert_eq!(picked, Some(box_id));

        engine.sync_and_render();
        let state = mock_state.borrow();
        // One box instance drawn with the box mesh (36 indices) of the static geometry
        assert_eq!(state.synced_instance_count, 1);
        assert_eq!(state.synced_draws.len(), 1);
        assert_eq!(state.synced_draws[0].index_count, 36);
        assert_eq!(state.geometry_uploads, 1);
        assert!(state.synced_helper_line_count > 10); // Grid + Axes + hover wireframe
    }
}
