use crate::camera::OrbitCamera;
use crate::chart::{AxisBreaks, AxisScale};
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
use crate::chart::{PieOptions, PieRing, PieStyle};
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

/// Parallel coordinates brush passthroughs.
#[path = "engine_parallel_ext.rs"]
mod parallel_ext;

// Base-color textures of scene meshes (registry in the render backend, maps in the scene)
#[path = "engine_texture_ext.rs"]
mod texture_ext;
/// Point editing passthroughs (drag / click to add).
#[path = "engine_edit_ext.rs"]
mod edit_ext;

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
    /// Node indexes into the GPU-resident layout instead of CPU positions
    resident: bool,
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
    /// Done now: energy of the newest adopted layout (the GPU may still be stepping)
    Immediate(f32),
    /// Full-state readback for `complete_physics_sync(ticket)`
    Pending(u32, crate::renderer::gpu_layout::GpuSync),
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
    sync_ticket: Option<u32>,
    /// The GPU holds the authoritative layout (WebGPU `request_gpu_physics`); the CPU copy
    /// trails it through asynchronous readbacks until the CPU steps or edits it again.
    gpu_resident: bool,
    /// Kinetic energy of the newest adopted GPU readback
    gpu_energy: f32,
    /// A wake-up the GPU sleep counter has not seen yet
    gpu_sleep_reset: bool,
    /// Unpinned node count sent with GPU steps (refreshed with every layout upload)
    gpu_free: u32,
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
            sync_ticket: None,
            gpu_resident: false,
            gpu_energy: 0.0,
            gpu_sleep_reset: false,
            gpu_free: 0,
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
        self.gpu_resident = false;
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
        // A real CPU step makes the CPU copy authoritative; the next GPU step re-uploads it
        self.gpu_resident &= !(dt.is_finite() && dt > 0.0);
        self.finish_physics_step(scene_ke)
    }

    /// One layout step on the GPU-resident layout (WebGPU), else a CPU step. Returns at
    /// submission: the CPU copy, picking and energy follow through asynchronous readbacks.
    /// Pending CPU layout edits are uploaded first (one node at a time, or whole).
    pub fn request_gpu_physics(&mut self, dt: f32) -> Result<GpuPhysicsRequest, String> {
        use crate::renderer::gpu_layout::{node_state, node_states, GpuLayoutStep, GpuSleep, GpuStateWrite};
        self.adopt_gpu_readback();
        if self.gpu_resident && !(dt.is_finite() && dt > 0.0) {
            return Ok(GpuPhysicsRequest::Immediate(self.gpu_energy + self.scene.step_physics(0.0)));
        }
        if !self.renderer.supports_gpu_physics() || !self.graph_visible || self.dataset.node_count() == 0
            || (self.auto_sleep_enabled && self.sleeping) || !dt.is_finite() || dt <= 0.0 {
            return Ok(GpuPhysicsRequest::Immediate(self.step_physics(dt)));
        }
        let dirty = self.dataset.take_layout_dirty();
        let full = dirty.full || !self.gpu_resident;
        let (states, nodes): (Vec<_>, Vec<_>) = if full {
            (node_states(&self.dataset), Vec::new())
        } else {
            (Vec::new(), dirty.nodes.iter().map(|&id| (id, node_state(&self.dataset.nodes()[id as usize]))).collect())
        };
        let write = if full { GpuStateWrite::Full(&states) } else if nodes.is_empty() { GpuStateWrite::Keep } else { GpuStateWrite::Nodes(&nodes) };
        if full || !nodes.is_empty() {
            self.gpu_free = self.dataset.nodes().iter().filter(|n| !n.is_pinned()).count() as u32;
        }
        let sleep = GpuSleep {
            enabled: self.auto_sleep_enabled, threshold: self.sleep_threshold, free: self.gpu_free,
            reset: std::mem::take(&mut self.gpu_sleep_reset) || full,
        };
        let step = GpuLayoutStep::new(&self.dataset, write, self.simulator.force_config(), dt, sleep);
        if let Err(e) = self.renderer.gpu_layout_step(&step) {
            // The edits taken above were not uploaded: the next GPU step re-uploads everything
            self.gpu_resident = false;
            return Err(e);
        }
        self.gpu_resident = true;
        let scene_ke = self.scene.step_physics(dt);
        Ok(GpuPhysicsRequest::Immediate(self.gpu_energy + scene_ke))
    }

    /// Writes pending CPU node edits into the GPU-resident layout. False when the GPU copy is not
    /// current: not resident, a pending whole-layout edit (the next step uploads it), or a failed write.
    fn flush_layout_edits(&mut self) -> bool {
        use crate::renderer::gpu_layout::{node_state, GpuStateWrite};
        if !self.gpu_resident || self.dataset.layout_dirty().full {
            return false;
        }
        let dirty = self.dataset.take_layout_dirty();
        if dirty.nodes.is_empty() {
            return true;
        }
        let nodes: Vec<_> = dirty.nodes.iter().map(|&id| (id, node_state(&self.dataset.nodes()[id as usize]))).collect();
        self.gpu_free = self.dataset.nodes().iter().filter(|n| !n.is_pinned()).count() as u32;
        if self.renderer.gpu_layout_write(GpuStateWrite::Nodes(&nodes)).is_err() {
            // The taken edits never reached the GPU: the next step re-uploads everything
            self.gpu_resident = false;
            return false;
        }
        true
    }

    /// Adopts the newest periodic GPU readback into the CPU copy (no-op unless GPU-resident).
    fn adopt_gpu_readback(&mut self) {
        if !self.gpu_resident { return; }
        if let Some(r) = self.renderer.gpu_layout_readback() { self.adopt_gpu_layout(r); }
    }

    fn adopt_gpu_layout(&mut self, r: crate::renderer::gpu_layout::GpuLayoutReadback) {
        // Pending CPU edits win: whole-layout edits reject the readback, node edits keep their nodes
        if !self.dataset.adopt_gpu_layout(&r.state) { return; }
        self.index_dirty = true;
        self.gpu_energy = r.energy;
        // A wake-up after this readback was submitted outranks its sleep state
        if self.auto_sleep_enabled && !self.gpu_sleep_reset {
            self.calm_steps = r.calm_steps;
            self.sleeping = r.sleeping;
        }
    }

    /// Reads back the full GPU-resident layout (after pushing pending CPU node edits);
    /// `Immediate` when the CPU copy is already authoritative.
    pub fn request_physics_sync(&mut self) -> Result<GpuPhysicsRequest, String> {
        if !self.flush_layout_edits() {
            return Ok(GpuPhysicsRequest::Immediate(self.gpu_energy));
        }
        let sync = self.renderer.gpu_layout_sync()?;
        self.physics_ticket = self.physics_ticket.wrapping_add(1).max(1);
        self.sync_ticket = Some(self.physics_ticket);
        Ok(GpuPhysicsRequest::Pending(self.physics_ticket, sync))
    }

    pub fn complete_physics_sync(&mut self, ticket: u32) -> Result<(), &'static str> {
        if self.sync_ticket != Some(ticket) {
            return Err("GPU physics sync was superseded");
        }
        self.sync_ticket = None;
        if let Some(r) = self.renderer.gpu_layout_take_sync() { self.adopt_gpu_layout(r); }
        Ok(())
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
        self.gpu_sleep_reset = true;
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
        self.adopt_gpu_readback();
        // GPU-resident layouts are drawn from GPU positions once pending node edits (drags) are
        // written; a pending whole-layout edit draws the authoritative CPU copy instead
        let resident = self.gpu_resident && self.graph_visible && self.flush_layout_edits();
        // The CPU index trails a GPU-resident layout by a frame or two: draw every node instead
        let culling = self.frustum_culling && !resident;
        if culling {
            self.ensure_spatial_index();
        }
        // Graph instances: repacked / re-uploaded only when the data, hover, or culling view changed
        let cull_view = (self.graph_visible && culling)
            .then(|| self.camera.view_proj_matrix().to_cols_array());
        let graph_key = GraphPackKey {
            revision: self.dataset.revision(),
            visible: self.graph_visible,
            hovered: self.hovered_node,
            hover_style: self.node_hover_style,
            cull_view,
            resident,
        };
        if self.graph_pack_key.as_ref() != Some(&graph_key) {
            if !self.graph_visible {
                self.renderer.sync_graph(false, &[], 0, &[]);
            } else {
                let mask = if culling {
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
                self.packer.resident = resident;
                self.packer.pack_dataset_with_culling(
                    &self.dataset,
                    self.hovered_node,
                    mask,
                    &self.node_hover_style,
                );
                let (nodes, opaque, edges) = self.packer.packed();
                self.renderer.sync_graph(resident, nodes, opaque, edges);
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
        self.renderer.sync_environment_map(self.scene.shading.env_map);
        self.renderer.sync_lighting(&self.scene.light_uniform(eye));
        self.renderer.sync_shadows(self.scene.shadow_frame().as_ref());

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

    pub fn set_camera_fov(&mut self, degrees: f32) {
        self.camera.set_fov_y_degrees(degrees);
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

    /// Mesh shading model + PBR tone mapping / environment (fields are clamped).
    pub fn set_shading(&mut self, shading: crate::scene::ShadingConfig) {
        self.scene.shading = shading.sanitized();
    }

    pub fn shading(&self) -> crate::scene::ShadingConfig {
        self.scene.shading
    }

    /// Directional-light shadows (fields are clamped; the map edge also to the device limit).
    pub fn set_shadows(&mut self, shadows: crate::scene::ShadowConfig) {
        self.scene.shadows = shadows.clamped_to_device(self.renderer.max_texture_size());
    }

    pub fn shadows(&self) -> crate::scene::ShadowConfig {
        self.scene.shadows
    }

    /// Main-pass MSAA: 4 = x4, anything else = off; devices without x4 support for the surface
    /// format stay at 1. Returns the applied sample count.
    pub fn set_antialias(&mut self, samples: u32) -> u32 {
        self.renderer.set_sample_count(samples)
    }

    /// Applied main-pass sample count (1 = off).
    pub fn antialias(&self) -> u32 {
        self.renderer.sample_count()
    }

    /// Whether an object casts / receives shadows.
    pub fn set_object_shadow_flags(&mut self, object_id: u32, cast: bool, receive: bool) -> bool {
        self.scene.set_object_shadow_flags(object_id, cast, receive)
    }

    /// `(cast, receive)`, or `None` when the object does not exist.
    pub fn object_shadow_flags(&self, object_id: u32) -> Option<(bool, bool)> {
        self.scene.find_object(object_id).map(|o| (o.cast_shadow, o.receive_shadow))
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
            if !chart.is_scientific3d() { chart.frame_camera(&mut self.camera, css); }
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

    pub fn set_scientific3d(&mut self, series: Vec<crate::chart::Scientific3DSeries>) -> Result<usize, String> {
        self.set_scientific3d_with_options(series, crate::chart::Scientific3DOptions::default(), None)
    }

    /// Orthographic Some(0) auto-fits; a positive value fixes the initial half-height.
    pub fn set_scientific3d_with_options(&mut self, series: Vec<crate::chart::Scientific3DSeries>, options: crate::chart::Scientific3DOptions, orthographic: Option<f32>) -> Result<usize, String> {
        if orthographic.is_some_and(|v| !v.is_finite() || v < 0.) { return Err("invalid 3D orthographic size".into()); }
        let chart = ChartState::new_scientific3d_with_options(series, options)?;
        let n = chart.point_count();
        self.begin_chart();
        self.camera.set_orthographic(orthographic.map(|s| s.max(1.)));
        let css = self.css_size();
        chart.frame_camera(&mut self.camera, css);
        if let Some(size) = orthographic.filter(|s| *s > 0.) { self.camera.set_orthographic(Some(size)); }
        self.chart = Some(chart);
        Ok(n)
    }

    pub fn update_scientific3d_series(&mut self, series: usize, xyz: Vec<[f32; 3]>, colors: Vec<[f32; 4]>, grid: Option<(usize, usize)>, contours: Option<crate::chart::Scientific3DContours>) -> Result<usize, String> {
        let n = self.chart.as_mut().ok_or("no chart")?.update_scientific3d_series(series, xyz, colors, grid, contours)?;
        self.refresh_chart_hover();
        Ok(n)
    }

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

    /// Replaces graph content with a ThemeRiver (streamgraph; see `chart::theme_river`).
    pub fn set_theme_river_chart(
        &mut self,
        series: Vec<LineSeries>,
        layout: LineLayout,
        offset: crate::chart::StreamOffset,
        order: crate::chart::StreamOrder,
        fill_opacity: f32,
    ) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_theme_river(series, layout, offset, order, fill_opacity);
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
        self.set_pie_rings_chart(values, opts, style, &[], &[])
    }

    /// `set_pie_chart` with several rings (see `validate_pie_rings`).
    pub fn set_pie_rings_chart(&mut self, values: &[f64], opts: PieOptions, style: PieStyle, rings: &[PieRing], groups: &[u32]) -> usize {
        self.begin_chart();
        let css = self.css_size();
        let chart = ChartState::new_pie_rings(values, opts, style, rings, groups);
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
        y_axes: impl AsRef<[LineYAxis]>,
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
            if chart.is_scientific3d() { self.camera.set_orthographic(None); }
            if keep_snapshot {
                // A chart replaced before its first frame keeps the older chart's snapshot; the
                // morph polygons (transitions) are measured with the camera it was drawn with
                let view = ChartView { camera: &self.camera, viewport_px: self.viewport_px, pixel_ratio: self.pixel_ratio };
                if let Some(s) = chart.anim_snapshot_in(&view) {
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

    /// Breaks of one value axis (validated first: an error leaves the chart unchanged). Positions
    /// move, so the hover is re-picked at the resting pointer.
    pub fn set_chart_axis_breaks(&mut self, axis: u8, breaks: AxisBreaks) -> Result<bool, String> {
        let changed = match self.chart.as_mut() {
            Some(chart) => chart.set_axis_breaks(axis, breaks)?,
            None => return Err("no chart".into()),
        };
        self.refresh_chart_hover();
        Ok(changed)
    }

    /// Domain options of y axis `k` (0 = left, 1 = right, 2.. = extra) of a line chart.
    pub fn set_chart_y_axis_at(&mut self, k: u8, axis: LineYAxis) {
        if let Some(chart) = self.chart.as_mut() {
            chart.set_y_axis_at(k, axis);
        }
    }

    /// Assigns line series to y axes (0 = left, 1 = right, 2.. = extra).
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
            resident: bool,
            nodes: &[crate::renderer::NodeInstanceRaw],
            opaque_nodes: usize,
            edge_vertices: &[crate::renderer::EdgeVertexRaw],
        ) {
            self.0
                .borrow_mut()
                .sync_graph(resident, nodes, opaque_nodes, edge_vertices);
        }

        fn supports_gpu_physics(&self) -> bool {
            self.0.borrow().supports_gpu_physics()
        }

        fn gpu_layout_step(&mut self, step: &crate::renderer::gpu_layout::GpuLayoutStep) -> Result<(), String> {
            self.0.borrow_mut().gpu_layout_step(step)
        }

        fn gpu_layout_write(&mut self, write: crate::renderer::gpu_layout::GpuStateWrite) -> Result<(), String> {
            self.0.borrow_mut().gpu_layout_write(write)
        }

        fn gpu_layout_readback(&mut self) -> Option<crate::renderer::gpu_layout::GpuLayoutReadback> {
            self.0.borrow_mut().gpu_layout_readback()
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

        fn max_texture_size(&self) -> u32 {
            self.0.borrow().max_texture_size()
        }

        fn create_texture_rgba8(&mut self, width: u32, height: u32, rgba: &[u8], mipmaps: bool) -> Result<u32, String> {
            self.0.borrow_mut().create_texture_rgba8(width, height, rgba, mipmaps)
        }

        fn create_environment_rgb(&mut self, width: u32, height: u32, rgb: &[f32]) -> Result<u32, String> {
            self.0.borrow_mut().create_environment_rgb(width, height, rgb)
        }

        fn dispose_texture(&mut self, texture_id: u32) -> bool {
            self.0.borrow_mut().dispose_texture(texture_id)
        }

        fn sync_lighting(&mut self, light: &crate::renderer::SceneLightUniformRaw) {
            self.0.borrow_mut().sync_lighting(light);
        }

        fn sync_environment_map(&mut self, texture_id: u32) {
            self.0.borrow_mut().sync_environment_map(texture_id);
        }

        fn sync_shadows(&mut self, shadows: Option<&crate::renderer::ShadowFrame>) {
            self.0.borrow_mut().sync_shadows(shadows);
        }

        fn set_sample_count(&mut self, samples: u32) -> u32 {
            self.0.borrow_mut().set_sample_count(samples)
        }

        fn sample_count(&self) -> u32 {
            self.0.borrow().sample_count()
        }

        fn texture_count(&self) -> u32 {
            self.0.borrow().texture_count()
        }

        fn texture_bytes(&self) -> u64 {
            self.0.borrow().texture_bytes()
        }
    }

    #[test]
    fn gpu_resident_layout_draws_gpu_positions_without_repacking_readbacks() {
        use crate::renderer::gpu_layout::GpuLayoutReadback;
        let ds = GraphDataset::generate_seeded(&DatasetConfig { node_count: 6, edge_count: 6, ..Default::default() });
        let (mut engine, state) = mock_engine(ds);
        state.borrow_mut().gpu_physics = true;
        engine.sync_and_render();
        assert!(!state.borrow().graph_resident, "CPU-packed until a GPU step owns the layout");
        assert!(matches!(engine.request_gpu_physics(0.016), Ok(GpuPhysicsRequest::Immediate(_))));
        assert_eq!(state.borrow().gpu_steps, vec![(true, 6)]);
        engine.sync_and_render();
        assert!(state.borrow().graph_resident);
        let uploads = state.borrow().graph_uploads;
        // Adopted readbacks move the CPU copy (picking) but the GPU already draws them
        let moved: Vec<f32> = (0..6).flat_map(|_| [5.0, 5.0, 5.0, 1.0, 0.0, 0.0, 0.0, 0.0]).collect();
        state.borrow_mut().gpu_readbacks.push(GpuLayoutReadback { epoch: 0, step: 1, state: moved, energy: 2.0, calm_steps: 0, sleeping: false });
        engine.sync_and_render();
        assert_eq!(engine.dataset().nodes()[0].position(), Vec3::splat(5.0));
        assert_eq!(state.borrow().graph_uploads, uploads);
        // A drag between steps reaches the GPU at render time
        engine.move_node_to(2, Vec3::ONE);
        engine.sync_and_render();
        assert_eq!(state.borrow().gpu_writes, vec![vec![2]]);
        assert!(state.borrow().graph_resident);
        engine.request_gpu_physics(0.016).unwrap();
        assert_eq!(state.borrow().gpu_steps.last(), Some(&(false, 6)), "the drag was already uploaded");
        // A whole-layout CPU edit draws CPU positions until the next step uploads them
        engine.import_positions(&[0.0; 18]).unwrap();
        engine.sync_and_render();
        assert!(!state.borrow().graph_resident);
        engine.request_gpu_physics(0.016).unwrap();
        assert_eq!(state.borrow().gpu_steps.last(), Some(&(true, 6)));
        engine.sync_and_render();
        assert!(state.borrow().graph_resident);
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
    fn scientific3d_resize_preserves_orbit_pose() {
        let ds = GraphDataset::generate_seeded(&DatasetConfig { node_count: 0, edge_count: 0, ..Default::default() });
        let (mut engine, _) = mock_engine(ds);
        engine.set_scientific3d(vec![]).unwrap();
        engine.rotate_camera(0.4, 0.2);
        let eye = engine.camera.eye_position();
        engine.resize(390, 600);
        assert!((engine.camera.eye_position() - eye).length() < 1e-4);
    }

    #[test]
    fn scientific3d_orthographic_survives_resize_and_resets_when_leaving_chart() {
        let ds = GraphDataset::generate_seeded(&DatasetConfig { node_count: 0, edge_count: 0, ..Default::default() });
        let (mut engine, _) = mock_engine(ds);
        engine.set_scientific3d_with_options(vec![], Default::default(), Some(120.)).unwrap();
        engine.rotate_camera(0.4, 0.2);
        let eye = engine.camera.eye_position();
        engine.resize(390, 600);
        assert_eq!(engine.camera.orthographic_size(), Some(120.));
        assert!((engine.camera.eye_position() - eye).length() < 1e-4);
        let bad = crate::chart::Scientific3DOptions { ticks: [1; 3], ..Default::default() };
        assert!(engine.set_scientific3d_with_options(vec![], bad, None).is_err());
        assert_eq!(engine.camera.orthographic_size(), Some(120.));
        engine.clear_chart();
        assert_eq!(engine.camera.orthographic_size(), None);
    }

    #[test]
    fn scientific3d_updates_preserve_camera_and_repick_resting_pointer() {
        use crate::chart::Scientific3DSeries;
        let ds = GraphDataset::generate_seeded(&DatasetConfig { node_count: 0, edge_count: 0, ..Default::default() });
        let (mut engine, _) = mock_engine(ds);
        engine.set_scientific3d(vec![Scientific3DSeries { xyz: vec![[0.; 3]], colors: vec![], color: [1.; 4], size: 8., grid: None, wireframe: false, lighting: 0., contours: None }]).unwrap();
        engine.rotate_camera(0.4, 0.2);
        let eye = engine.camera.eye_position();
        let view = ChartView { camera: &engine.camera, viewport_px: engine.viewport_px, pixel_ratio: engine.pixel_ratio };
        engine.chart.as_mut().unwrap().hover_at(&view, &mut engine.scene, (0., 0.)).unwrap();
        engine.update_scientific3d_series(0, vec![[10., 20., 30.]], vec![], None, None).unwrap();
        assert!((engine.camera.eye_position() - eye).length() < 1e-4);
        let p = engine.chart().unwrap().scientific_hit().unwrap();
        assert_eq!(&p[..3], &[10., 20., 30.]);
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
    fn textures_are_created_mapped_and_disposed_through_the_backend() {
        use crate::scene::{BodyType, PrimitiveKind, TextureMap};
        let (mut engine, state) = mock_engine(GraphDataset::default_empty());
        assert_eq!(engine.max_texture_size(), 4096);
        let a = engine.create_texture_rgba8(2, 2, &[255; 16], true).unwrap();
        let b = engine.create_texture_rgba8(1, 1, &[0, 0, 0, 255], false).unwrap();
        assert_eq!((a, b), (1, 2));
        // Rejected before reaching the backend registry: bad length / size
        assert!(engine.create_texture_rgba8(2, 2, &[255; 15], false).is_err());
        assert!(engine.create_texture_rgba8(5000, 1, &[255; 20000], false).is_err());
        assert_eq!(engine.texture_count(), 2);
        assert_eq!(engine.texture_bytes(), (16 + 4) + 4);

        let obj = engine.scene_mut().add_primitive(PrimitiveKind::Box, Vec3::ZERO, Vec3::splat(10.0), [1.0; 4], BodyType::Static);
        let map = TextureMap { texture: a, repeat: [2.0, 2.0], offset: [0.0, 0.0], alpha_test: 0.5 };
        assert!(engine.set_object_map(obj, map));
        assert_eq!(engine.object_map(obj), Some(map));
        engine.sync_and_render();
        assert_eq!(state.borrow().synced_draws[0].texture, a);

        assert!(engine.dispose_texture(a));
        assert!(!engine.dispose_texture(a), "double dispose");
        assert_eq!(engine.object_map(obj).map(|m| m.texture), Some(0));
        engine.sync_and_render();
        assert_eq!(state.borrow().synced_draws[0].texture, 0, "disposed map renders white");
        // PBR map slots are cleared on disposal too
        use crate::scene::MaterialMaps;
        let maps = MaterialMaps { metal_rough: b, normal: b, emissive: b, emissive_color: [1.0; 3], ..MaterialMaps::default() };
        assert!(engine.set_object_material_maps(obj, maps));
        assert_eq!(engine.object_material_maps(obj), Some(maps));
        engine.sync_and_render();
        assert_eq!(state.borrow().synced_draws[0].maps, [b, b, 0, b]);
        assert!(engine.dispose_texture(b));
        assert_eq!(engine.object_material_maps(obj).map(|m| m.textures()), Some([0; 4]));
        engine.sync_and_render();
        assert_eq!(state.borrow().synced_draws[0].maps, [0; 4]);
        let c = engine.create_texture_rgba8(1, 1, &[1, 2, 3, 4], false).unwrap();
        assert_eq!(c, 3, "ids are never reused");
        let st = state.borrow();
        assert_eq!(st.texture_creates, vec![(2, 2, true), (1, 1, false), (1, 1, false)]);
        assert_eq!(st.texture_disposes, vec![a, b]);
    }

    #[test]
    fn antialias_is_off_by_default_and_falls_back_without_device_support() {
        let (mut engine, state) = mock_engine(GraphDataset::default_empty());
        assert_eq!(engine.antialias(), 1, "off by default");
        // No x4 support for the surface format: stays at 1
        assert_eq!(engine.set_antialias(4), 1);
        assert_eq!(engine.antialias(), 1);
        state.borrow_mut().msaa_x4 = true;
        assert_eq!(engine.set_antialias(4), 4);
        assert_eq!(engine.antialias(), 4);
        engine.sync_and_render();
        assert_eq!(state.borrow().rendered_frames, 1);
        // Counts other than 4 switch it off
        assert_eq!(engine.set_antialias(2), 1);
        assert_eq!(engine.set_antialias(4), 4);
        assert_eq!(engine.set_antialias(1), 1);
        assert_eq!(engine.antialias(), 1);
    }

    #[test]
    fn shadows_are_off_by_default_and_reach_the_backend_when_enabled() {
        use crate::scene::{BodyType, PrimitiveKind, ShadowBounds, ShadowConfig};
        let (mut engine, state) = mock_engine(GraphDataset::default_empty());
        let floor = engine.scene_mut().add_primitive(
            PrimitiveKind::Plane,
            Vec3::ZERO,
            Vec3::new(20.0, 1.0, 20.0),
            [0.8, 0.8, 0.8, 1.0],
            BodyType::Static,
        );
        let cube = engine.scene_mut().add_primitive(
            PrimitiveKind::Box,
            Vec3::new(0.0, 1.0, 0.0),
            Vec3::ONE,
            [1.0, 0.2, 0.2, 1.0],
            BodyType::Static,
        );
        engine.sync_and_render();
        assert_eq!(state.borrow().last_shadows, None, "off by default");
        assert_eq!(engine.object_shadow_flags(cube), Some((true, true)));
        let off_instances = state.borrow().synced_instance_count;

        engine.set_shadows(ShadowConfig {
            enabled: true,
            map_size: 4096,
            softness: 50.0,
            ..ShadowConfig::default()
        });
        assert_eq!(engine.shadows().softness, crate::scene::MAX_SHADOW_SOFTNESS);
        engine.sync_and_render();
        {
            let st = state.borrow();
            let f = st.last_shadows.expect("enabled");
            // The mock ledger's texture limit clamps the map edge
            let max = st.textures.max_edge();
            assert_eq!(f.map_size, if max >= 512 { 4096.min(crate::scene::snap_map_size(max)) } else { 4096 });
            assert_eq!(st.synced_instance_count, off_instances);
            assert!(st.synced_draws.iter().all(|d| d.shadow_instances == d.instance_count));
        }

        assert!(engine.set_object_shadow_flags(cube, false, true));
        assert_eq!(engine.object_shadow_flags(cube), Some((false, true)));
        assert!(!engine.set_object_shadow_flags(999, true, true));
        engine.sync_and_render();
        let casters: u32 = state.borrow().synced_draws.iter().map(|d| d.shadow_instances).sum();
        assert_eq!(casters, 1, "only the floor casts");

        engine.set_shadows(ShadowConfig {
            enabled: true,
            bounds: ShadowBounds::Sphere { center: Vec3::ZERO, radius: 5.0 },
            ..ShadowConfig::default()
        });
        engine.sync_and_render();
        let expected = engine.scene().shadows.frame(engine.scene().lighting.dir_light_dir, None);
        assert_eq!(state.borrow().last_shadows, expected, "user bounds ignore the scene");

        engine.set_shadows(ShadowConfig::default());
        engine.sync_and_render();
        assert_eq!(state.borrow().last_shadows, None, "disabled again");
        let _ = floor;
    }

    #[test]
    fn shading_reaches_the_backend_and_env_map_is_cleared_on_dispose() {
        use crate::scene::{ShadingConfig, ShadingModel, ToneMapping};
        let (mut engine, state) = mock_engine(GraphDataset::default_empty());
        engine.sync_and_render();
        assert!(!state.borrow().last_light.unwrap().is_pbr(), "classic by default");
        assert_eq!(state.borrow().environment_map, 0);

        let env = engine.create_texture_rgba8(4, 2, &[128; 32], true).unwrap();
        engine.set_shading(ShadingConfig {
            model: ShadingModel::Pbr,
            tone_mapping: ToneMapping::Reinhard,
            exposure: 100.0,
            env_map: env,
            ..ShadingConfig::default()
        });
        assert_eq!(engine.shading().exposure, crate::scene::MAX_EXPOSURE, "clamped");
        engine.sync_and_render();
        {
            let st = state.borrow();
            let light = st.last_light.unwrap();
            assert!(light.is_pbr());
            assert_eq!(light.shading[1], 2.0);
            assert_eq!(st.environment_map, env);
        }
        assert!(engine.dispose_texture(env));
        assert_eq!(engine.shading().env_map, 0);
        engine.sync_and_render();
        assert_eq!(state.borrow().environment_map, 0, "disposed env map is no longer sent");
        assert!(state.borrow().last_light.unwrap().is_pbr(), "model survives the dispose");
    }

    #[test]
    fn hdr_environments_are_counted_rotated_and_freed() {
        use crate::scene::{ShadingConfig, ShadingModel};
        let ds = GraphDataset::default_empty();
        let sim = Box::new(ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig::default(),
        ));
        let state = Rc::new(RefCell::new(MockRenderBackend::default()));
        let renderer = Box::new(SharedMockRenderer(Rc::clone(&state)));
        let mut engine = VisualizationEngine::new(ds, sim, OrbitCamera::new(100.0, 1.0), renderer);

        let rgb = vec![2.0f32; 64 * 32 * 3];
        let env = engine.create_environment_rgb(64, 32, &rgb).unwrap();
        // 64 x 32 -> 3 prefiltered levels (heights 32, 16, 8) of 8-byte texels
        assert_eq!(engine.texture_bytes(), (64 * 32 + 32 * 16 + 16 * 8) * 8);
        assert!(engine.create_environment_rgb(64, 32, &rgb[3..]).unwrap_err().contains("rgb length"));
        assert!(engine.create_environment_rgb(8192, 32, &[]).unwrap_err().contains("4096x2048"));

        // A tiny flat .hdr (8 x 2, all texels 1.0) goes through the decoder
        let mut file = b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y 2 +X 8\n".to_vec();
        file.extend(std::iter::repeat([128u8, 128, 128, 129]).take(16).flatten());
        let (hdr, w, h) = engine.create_environment_hdr(&file).unwrap();
        assert_eq!((w, h), (8, 2));
        assert!(engine.create_environment_hdr(b"P6 nope").unwrap_err().contains("Radiance"));

        engine.set_shading(ShadingConfig {
            model: ShadingModel::Pbr,
            env_map: env,
            env_rotation: std::f32::consts::PI,
            ..ShadingConfig::default()
        });
        engine.sync_and_render();
        {
            let st = state.borrow();
            assert_eq!(st.environment_map, env);
            let light = st.last_light.unwrap();
            assert!((light.env_params[1] + 1.0).abs() < 1e-6, "cos(pi)");
        }
        assert!(engine.dispose_texture(env));
        assert!(engine.dispose_texture(hdr));
        assert_eq!(engine.texture_bytes(), 0, "prefiltered chains are freed");
        assert_eq!(engine.shading().env_map, 0);
        assert_eq!(engine.shading().env_rotation, std::f32::consts::PI, "rotation survives");
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
