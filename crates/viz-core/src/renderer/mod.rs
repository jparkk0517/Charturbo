use crate::camera::OrbitCamera;
use crate::domain::GraphDataset;
use bytemuck::{Pod, Zeroable};

mod fill_style;
pub mod gpu_context;
mod heatmap;
pub mod shader;
mod stats;
pub mod wgpu_backend;

pub use fill_style::{fill_emphasis_tag, merge_ranges, with_lit, ChartFillPatch, ChartFillStyleRaw, FILL_EMPH_ALPHA, FILL_EMPH_FADE};
pub use heatmap::{ChartHeatmapGrid, ChartHeatmapStyleRaw, HEATMAP_LUT_SIZE};
pub use stats::{chart_layer_bytes, RenderStats};

/// 16-byte aligned uniform buffer payload for camera matrices, billboard vectors, and viewport (112 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct CameraUniformRaw {
    pub view_proj: [[f32; 4]; 4],
    pub camera_right: [f32; 4],
    pub camera_up: [f32; 4],
    /// `[width_px, height_px, pixel_ratio, 0]` of the render target (physical pixels).
    pub viewport: [f32; 4],
}

/// Screen-space thick line segment instance (48 bytes): world endpoints, stroke width in CSS px, color.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartSegmentRaw {
    /// `[x, y, z, width_css_px]`
    pub p0_width: [f32; 4],
    /// `[x, y, z, dash_css_px]` (dash 0 = solid; dashes and gaps are `dash` px long)
    pub p1_pad: [f32; 4],
    pub color: [f32; 4],
}

/// Screen-space marker instance (64 bytes) with a separating ring.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartMarkerRaw {
    /// `[x, y, z, radius_css_px]`
    pub center_radius: [f32; 4],
    pub fill: [f32; 4],
    pub ring: [f32; 4],
    /// `[ring_width_css_px, shape, 0, 0]`; shape 0 = circle, 1 = square, 2 = diamond, 3 = triangle
    pub params: [f32; 4],
}

/// Dashed screen-space segment instance (64 bytes) of a series polyline: like
/// `ChartSegmentRaw` plus a dash pattern and the pattern phase at `p0`, so dashes run on
/// continuously across the segments of a polyline.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartDashSegmentRaw {
    /// `[x, y, z, width_css_px]`
    pub p0_width: [f32; 4],
    /// `[x, y, z, phase_css_px]` (pattern offset at `p0`)
    pub p1_phase: [f32; 4],
    pub color: [f32; 4],
    /// `[on, off, on, off]` in CSS px (trailing zeros = shorter pattern)
    pub dash: [f32; 4],
}

/// Per-series line styles of a line / area chart (chart/linestyle.rs): dashed strokes and
/// data point markers, drawn right after the solid series strokes.
#[derive(Debug, Default, Clone, Copy)]
pub struct ChartSeriesStyleLayer<'a> {
    pub dashed: &'a [ChartDashSegmentRaw],
    pub markers: &'a [ChartMarkerRaw],
}

/// Flat 2D bar instance (48 bytes) with rounded data-end corners.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartBarRaw {
    /// `[x0, y0, x1, y1]` world-space rectangle in the plane `z`
    pub rect: [f32; 4],
    /// `[z, corner_radius_css_px, rounded_end (1 = top, -1 = bottom, 2 = right, -2 = left),
    /// gap_css_px]`; gap > 0 trims
    /// the data end (stack segments), gap < 0 trims `|gap| / 2` off each side (grouped bars)
    pub z_radius: [f32; 4],
    pub color: [f32; 4],
}

/// Series slots in `ChartPointStyleRaw::series_alpha`; scatter charts with more series fall
/// back to re-packing points on legend changes.
pub const MAX_POINT_SERIES: usize = 256;

/// Scatter point instance (20 bytes): base world position, series slot, radius in CSS px,
/// RGBA8 fill. Zoom / pan / legend emphasis / visibility never touch these: the layer
/// transform and per-series alpha live in `ChartPointStyleRaw`. Points lie in the plane z = 0.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartPointRaw {
    /// `[x, y, series_slot, radius_css_px]` (x / y before the layer transform; the slot is an
    /// integer `< MAX_POINT_SERIES` indexing `ChartPointStyleRaw::series_alpha`)
    pub center_radius: [f32; 4],
    /// Straight-alpha RGBA, 0..255 (`Unorm8x4`)
    pub color: [u8; 4],
}

/// Uniform of the scatter point layer (1072 bytes): zoom transform, separating ring, and the
/// alpha multiplier of every series slot (legend emphasis / visibility).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartPointStyleRaw {
    /// `[sx, sy, tx, ty]`: world xy = base xy * s + t
    pub transform: [f32; 4],
    /// Ring color (usually the chart surface); its alpha is scaled by the point alpha
    pub ring_color: [f32; 4],
    /// `[ring_width_css_px, emphasized_slot, 0, 0]` (ring 0 = none; slot < 0 = no emphasis).
    /// With an emphasized slot the layer is drawn twice: other slots first, then that one on top.
    pub params: [f32; 4],
    /// Alpha multiplier of slot `s` at `series_alpha[s / 4][s % 4]`; 0 = hidden (culled)
    pub series_alpha: [[f32; 4]; MAX_POINT_SERIES / 4],
}

impl ChartPointStyleRaw {
    /// Emphasized series slot, if any.
    pub fn emphasized_slot(&self) -> Option<usize> {
        (self.params[1] >= 0.0).then_some(self.params[1] as usize)
    }

    pub fn slot_alpha(&self, slot: usize) -> f32 {
        self.series_alpha[slot / 4][slot % 4]
    }
}

impl Default for ChartPointStyleRaw {
    fn default() -> Self {
        Self {
            transform: [1.0, 1.0, 0.0, 0.0],
            ring_color: [0.0; 4],
            params: [0.0, -1.0, 0.0, 0.0],
            series_alpha: [[1.0; 4]; MAX_POINT_SERIES / 4],
        }
    }
}

/// Filled-area vertex (32 bytes) of a triangle list (areas, bands); alpha blended.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartFillRaw {
    /// `[x, y, z, 0]` world position
    pub position: [f32; 4],
    pub color: [f32; 4],
}

/// Annotation marks of one depth layer (reference bands, lines, point markers).
#[derive(Debug, Default, Clone, Copy)]
pub struct ChartAnnotationLayer<'a> {
    /// Band rectangles (triangle list)
    pub fills: &'a [ChartFillRaw],
    pub lines: &'a [ChartSegmentRaw],
    pub markers: &'a [ChartMarkerRaw],
}

/// Chart layers to upload this frame; `None` keeps the previously uploaded GPU data untouched.
#[derive(Debug, Default, Clone, Copy)]
pub struct ChartLayers<'a> {
    /// Scissor rect `[x, y, w, h]` (physical px) for bars, fills, series and points while zoomed;
    /// `None` = none
    pub series_clip: Option<[u32; 4]>,
    /// Grid / baseline strokes drawn beneath bars and series
    pub underlay: Option<&'a [ChartSegmentRaw]>,
    pub bars: Option<&'a [ChartBarRaw]>,
    /// Filled areas (triangle list) drawn beneath the series strokes
    pub fills: Option<&'a [ChartFillRaw]>,
    /// Re-written vertex ranges of the uploaded fills (ignored when `fills` is set)
    pub fill_patch: Option<ChartFillPatch<'a>>,
    /// Hover / legend emphasis of tagged fill vertices (see fill_style.rs)
    pub fill_style: Option<ChartFillStyleRaw>,
    pub series: Option<&'a [ChartSegmentRaw]>,
    /// Dashed series strokes and series point markers (uploaded with `series`)
    pub series_style: Option<ChartSeriesStyleLayer<'a>>,
    /// Scatter points (instanced, uploaded only when the data / visibility changes)
    pub points: Option<&'a [ChartPointRaw]>,
    /// Point layer transform + ring + per-series alpha (changes on zoom / pan / legend emphasis /
    /// visibility without re-uploading points)
    pub point_style: Option<ChartPointStyleRaw>,
    /// Hover crosshair drawn above everything (no depth test)
    pub overlay: Option<&'a [ChartSegmentRaw]>,
    pub markers: Option<&'a [ChartMarkerRaw]>,
    /// Annotations drawn right after the gridlines (beneath bars, fills and series)
    pub annotations_below: Option<ChartAnnotationLayer<'a>>,
    /// Annotations drawn over the series (inside the series clip), beneath hover overlays
    pub annotations_above: Option<ChartAnnotationLayer<'a>>,
    /// Brush rectangle / committed selection band (chart/brush.rs), over the annotations
    pub brush: Option<ChartAnnotationLayer<'a>>,
    /// Navigator strip (background, series overview) below the plot: never clipped, no depth test
    pub navigator: Option<ChartAnnotationLayer<'a>>,
    /// Navigator zoom window (masks, window, handles) drawn over the strip
    pub navigator_window: Option<ChartAnnotationLayer<'a>>,
    /// Heatmap value grid (uploaded only when the data changes; empty = no heatmap)
    pub heatmap: Option<ChartHeatmapGrid<'a>>,
    /// Heatmap colormap (`HEATMAP_LUT_SIZE` RGBA8 entries, low -> high)
    pub heatmap_lut: Option<&'a [[u8; 4]]>,
    /// Heatmap zoom window / value scale (changes without re-uploading the grid)
    pub heatmap_style: Option<ChartHeatmapStyleRaw>,
}

/// How the graph renderer marks the hovered node.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NodeHoverStyle {
    pub enabled: bool,
    /// Radius multiplier applied to the hovered node
    pub scale: f32,
    /// Fixed hover color; `None` brightens the node's own color
    pub color: Option<[f32; 4]>,
}

impl Default for NodeHoverStyle {
    fn default() -> Self {
        Self {
            enabled: true,
            scale: 1.6,
            color: None,
        }
    }
}

/// 16-byte aligned per-node instance payload (32 bytes) for GPU instanced billboard sphere rendering.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct NodeInstanceRaw {
    pub position_radius: [f32; 4],
    pub color: [f32; 4],
}

/// 16-byte aligned vertex payload (32 bytes) for single-draw-call LineList edge rendering.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct EdgeVertexRaw {
    pub position_pad: [f32; 4],
    pub color: [f32; 4],
}

/// Object-space mesh vertex (32 bytes), uploaded once per geometry.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct MeshVertexRaw {
    /// `[x, y, z, 0]`
    pub position: [f32; 4],
    /// `[nx, ny, nz, 0]`
    pub normal: [f32; 4],
}

/// Per-object mesh instance (144 bytes): transform, normal matrix, and material.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct MeshInstanceRaw {
    /// World matrix columns
    pub model: [[f32; 4]; 4],
    /// Inverse-transpose of the world matrix's 3x3 part, as columns (`w` unused)
    pub normal: [[f32; 4]; 3],
    pub color: [f32; 4],
    /// `[metallic, roughness, emissive, 0]` (emissive is kept out of `color.a`)
    pub material: [f32; 4],
}

/// One instanced draw: `index_count` indices from `first_index` (absolute vertex ids) for
/// instances `[first_instance, first_instance + instance_count)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MeshDraw {
    pub first_index: u32,
    pub index_count: u32,
    pub first_instance: u32,
    pub instance_count: u32,
    /// Drawn after nodes without depth writes (back-to-front order)
    pub translucent: bool,
}

/// 16-byte aligned scene lighting uniform buffer (48 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct SceneLightUniformRaw {
    pub eye_pos_ambient: [f32; 4],
    pub dir_light_dir_intensity: [f32; 4],
    pub point_light_pos_intensity: [f32; 4],
}

impl Default for SceneLightUniformRaw {
    fn default() -> Self {
        Self {
            eye_pos_ambient: [0.0, 80.0, 180.0, 0.32],
            dir_light_dir_intensity: [0.45, 0.85, 0.55, 0.95],
            point_light_pos_intensity: [0.0, 45.0, 25.0, 0.65],
        }
    }
}

/// Responsible for converting domain state into GPU-ready byte-aligned instance buffers with zero reallocation.
#[derive(Default)]
pub struct InstancePacker {
    node_instances: Vec<NodeInstanceRaw>,
    translucent_scratch: Vec<NodeInstanceRaw>,
    edge_vertices: Vec<EdgeVertexRaw>,
    opaque_node_count: usize,
}

impl InstancePacker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn pack_camera(
        camera: &OrbitCamera,
        viewport_px: (u32, u32),
        pixel_ratio: f32,
    ) -> CameraUniformRaw {
        let vp = camera.view_proj_matrix();
        let (right, up) = camera.billboard_axes();
        CameraUniformRaw {
            view_proj: vp.to_cols_array_2d(),
            camera_right: [right.x, right.y, right.z, 0.0],
            camera_up: [up.x, up.y, up.z, 0.0],
            viewport: [
                viewport_px.0.max(1) as f32,
                viewport_px.1.max(1) as f32,
                pixel_ratio.max(0.1),
                0.0,
            ],
        }
    }

    pub fn pack_dataset(
        &mut self,
        dataset: &GraphDataset,
        hovered_node_id: Option<u32>,
    ) -> (&[NodeInstanceRaw], &[EdgeVertexRaw]) {
        self.pack_dataset_with_culling(dataset, hovered_node_id, None, &NodeHoverStyle::default())
    }

    /// Number of leading opaque instances in the last packed node slice; the rest are translucent
    /// and are drawn without depth writes so they never hide nodes behind them.
    pub fn opaque_node_count(&self) -> usize {
        self.opaque_node_count
    }

    /// Last packed `(nodes, opaque_node_count, edge_vertices)`.
    pub fn packed(&self) -> (&[NodeInstanceRaw], usize, &[EdgeVertexRaw]) {
        (&self.node_instances, self.opaque_node_count, &self.edge_vertices)
    }

    pub fn pack_dataset_with_culling(
        &mut self,
        dataset: &GraphDataset,
        hovered_node_id: Option<u32>,
        visible_mask: Option<&[bool]>,
        hover_style: &NodeHoverStyle,
    ) -> (&[NodeInstanceRaw], &[EdgeVertexRaw]) {
        self.node_instances.clear();
        self.translucent_scratch.clear();
        self.edge_vertices.clear();

        let nodes = dataset.nodes();
        let has_sel = dataset.has_selection();
        self.node_instances.reserve(nodes.len());

        for (idx, node) in nodes.iter().enumerate() {
            if let Some(mask) = visible_mask {
                if !mask.get(idx).copied().unwrap_or(true) {
                    continue;
                }
            }

            let pos = node.position();
            let is_hovered = hover_style.enabled && hovered_node_id == Some(node.id());
            let is_selected = node.is_selected();

            let radius = if is_hovered {
                node.mass() * 0.95 * hover_style.scale
            } else if has_sel && is_selected {
                node.mass() * 1.25
            } else {
                node.mass() * 0.95
            };

            let base_c = node.color();
            let color = if is_hovered {
                hover_style.color.unwrap_or([
                    base_c[0] + (1.0 - base_c[0]) * 0.35,
                    base_c[1] + (1.0 - base_c[1]) * 0.35,
                    base_c[2] + (1.0 - base_c[2]) * 0.35,
                    base_c[3],
                ])
            } else if has_sel && !is_selected {
                // Dim, but never make an intentionally transparent node visible
                [
                    base_c[0] * 0.35,
                    base_c[1] * 0.35,
                    base_c[2] * 0.35,
                    base_c[3].min(0.14),
                ]
            } else {
                base_c
            };

            let inst = NodeInstanceRaw {
                position_radius: [pos.x, pos.y, pos.z, radius],
                color,
            };
            if color[3] >= 0.999 {
                self.node_instances.push(inst);
            } else if color[3] > 0.001 {
                self.translucent_scratch.push(inst);
            }
            // Fully transparent nodes are skipped entirely
        }
        self.opaque_node_count = self.node_instances.len();
        self.node_instances.extend_from_slice(&self.translucent_scratch);

        let edges = dataset.edges();
        self.edge_vertices.reserve(edges.len() * 2);
        for edge in edges {
            let src_idx = edge.source() as usize;
            let dst_idx = edge.target() as usize;

            if let Some(mask) = visible_mask {
                let src_vis = mask.get(src_idx).copied().unwrap_or(true);
                let dst_vis = mask.get(dst_idx).copied().unwrap_or(true);
                // An edge leaving the screen is still visible: the GPU clips it
                if !src_vis && !dst_vis {
                    continue;
                }
            }

            let src = &nodes[src_idx];
            let dst = &nodes[dst_idx];
            let src_pos = src.position();
            let dst_pos = dst.position();

            let alpha = if has_sel {
                if src.is_selected() && dst.is_selected() {
                    0.65
                } else {
                    0.03
                }
            } else {
                (edge.weight() * 0.18).clamp(0.08, 0.35)
            };

            let mut c0 = src.color();
            c0[3] = alpha;
            let mut c1 = dst.color();
            c1[3] = alpha;

            self.edge_vertices.push(EdgeVertexRaw {
                position_pad: [src_pos.x, src_pos.y, src_pos.z, 1.0],
                color: c0,
            });
            self.edge_vertices.push(EdgeVertexRaw {
                position_pad: [dst_pos.x, dst_pos.y, dst_pos.z, 1.0],
                color: c1,
            });
        }

        (&self.node_instances, &self.edge_vertices)
    }
}

/// Hardware-agnostic rendering backend trait (Dependency Inversion Principle).
///
/// The engine only calls the `sync_*` methods when the corresponding data changed, so backends
/// keep the last uploaded buffers and redraw them as-is.
pub trait RenderBackend {
    /// Node instances (`opaque_nodes` leading opaque ones, then translucent) and graph edges.
    fn sync_graph(
        &mut self,
        nodes: &[NodeInstanceRaw],
        opaque_nodes: usize,
        edge_vertices: &[EdgeVertexRaw],
    );
    /// Static scene geometry (all meshes, object space); sent only when meshes are added / removed.
    fn sync_scene_geometry(&mut self, _vertices: &[MeshVertexRaw], _indices: &[u32]) {}
    /// Per-object instances and the draw list (opaque draws first, then translucent ones).
    fn sync_scene_instances(&mut self, _instances: &[MeshInstanceRaw], _draws: &[MeshDraw]) {}
    /// Grid / axes / selection wireframe lines.
    fn sync_helper_lines(&mut self, _lines: &[EdgeVertexRaw]) {}
    /// Scene lighting (changes with the camera eye, so it is sent every frame).
    fn sync_lighting(&mut self, _light: &SceneLightUniformRaw) {}
    /// Uploads changed chart layers (see `ChartLayers`); unchanged layers are passed as `None`.
    fn sync_chart(&mut self, _layers: &ChartLayers<'_>) {}
    /// Background color the frame is cleared to.
    fn set_clear_color(&mut self, _rgba: [f32; 4]) {}
    fn render_frame(&mut self, camera: &CameraUniformRaw);
    fn resize(&mut self, width: u32, height: u32);
    /// GPU memory / upload counters (benchmarks, diagnostics); zeros when not tracked.
    fn stats(&self) -> RenderStats {
        RenderStats::default()
    }
}

/// In-memory mock implementation of `RenderBackend` for deterministic unit & integration testing.
#[derive(Default, Debug)]
pub struct MockRenderBackend {
    pub synced_node_count: usize,
    pub synced_opaque_node_count: usize,
    pub synced_edge_vertex_count: usize,
    pub synced_helper_line_count: usize,
    /// Number of `sync_graph` calls (uploads of node / edge data)
    pub graph_uploads: usize,
    /// Number of `sync_scene_instances` calls
    pub mesh_uploads: usize,
    /// Number of `sync_scene_geometry` calls
    pub geometry_uploads: usize,
    pub synced_instance_count: usize,
    pub synced_draws: Vec<MeshDraw>,
    pub synced_mesh_vertex_count: usize,
    pub synced_mesh_index_count: usize,
    pub chart_underlay_count: usize,
    pub chart_bar_count: usize,
    pub chart_series_count: usize,
    pub chart_overlay_count: usize,
    pub chart_marker_count: usize,
    pub chart_fill_count: usize,
    /// Vertices re-written by fill patches since creation, and the last fill emphasis uniform
    pub chart_fill_patched: usize,
    pub chart_fill_style: Option<ChartFillStyleRaw>,
    pub chart_point_count: usize,
    /// `(dashed segments, series markers)` of the last series style upload
    pub chart_series_style: (usize, usize),
    /// Number of point instance uploads (zoom / pan / legend changes must not add to it)
    pub chart_point_uploads: usize,
    pub chart_point_style: Option<ChartPointStyleRaw>,
    /// Number of point style uniform uploads
    pub chart_point_style_uploads: usize,
    /// Total bytes sent for the point layer (instances + style uniform)
    pub chart_point_bytes: usize,
    /// `(fill vertices, lines, markers)` of the below / above annotation layers
    pub chart_annotations_below: (usize, usize, usize),
    pub chart_annotations_above: (usize, usize, usize),
    /// `(fill vertices, lines, markers)` of the brush layer
    pub chart_brush: (usize, usize, usize),
    /// `(fills, lines, markers)` of the navigator strip / window layers and their upload counts
    pub chart_navigator: (usize, usize, usize),
    pub chart_navigator_window: (usize, usize, usize),
    pub chart_navigator_uploads: usize,
    pub chart_navigator_window_uploads: usize,
    /// Cells of the last heatmap grid upload and the number of grid / LUT / style uploads
    pub chart_heatmap_cells: usize,
    pub chart_heatmap_uploads: usize,
    pub chart_heatmap_lut_uploads: usize,
    pub chart_heatmap_style: Option<ChartHeatmapStyleRaw>,
    pub chart_heatmap_style_uploads: usize,
    /// Number of `sync_chart` calls that actually uploaded at least one layer
    pub chart_uploads: usize,
    pub rendered_frames: usize,
    pub last_camera: Option<CameraUniformRaw>,
    pub viewport_size: (u32, u32),
}

impl RenderBackend for MockRenderBackend {
    fn sync_graph(
        &mut self,
        nodes: &[NodeInstanceRaw],
        opaque_nodes: usize,
        edge_vertices: &[EdgeVertexRaw],
    ) {
        self.synced_node_count = nodes.len();
        self.synced_opaque_node_count = opaque_nodes;
        self.synced_edge_vertex_count = edge_vertices.len();
        self.graph_uploads += 1;
    }

    fn sync_scene_geometry(&mut self, vertices: &[MeshVertexRaw], indices: &[u32]) {
        self.synced_mesh_vertex_count = vertices.len();
        self.synced_mesh_index_count = indices.len();
        self.geometry_uploads += 1;
    }

    fn sync_scene_instances(&mut self, instances: &[MeshInstanceRaw], draws: &[MeshDraw]) {
        self.synced_instance_count = instances.len();
        self.synced_draws = draws.to_vec();
        self.mesh_uploads += 1;
    }

    fn sync_helper_lines(&mut self, lines: &[EdgeVertexRaw]) {
        self.synced_helper_line_count = lines.len();
    }

    fn sync_chart(&mut self, layers: &ChartLayers<'_>) {
        let mut uploaded = false;
        if let Some(v) = layers.underlay {
            self.chart_underlay_count = v.len();
            uploaded = true;
        }
        if let Some(v) = layers.bars {
            self.chart_bar_count = v.len();
            uploaded = true;
        }
        if let Some(v) = layers.series {
            self.chart_series_count = v.len();
            uploaded = true;
        }
        if let Some(v) = layers.overlay {
            self.chart_overlay_count = v.len();
            uploaded = true;
        }
        if let Some(v) = layers.markers {
            self.chart_marker_count = v.len();
            uploaded = true;
        }
        if let Some(l) = &layers.series_style {
            self.chart_series_style = (l.dashed.len(), l.markers.len());
            uploaded = true;
        }
        if let Some(v) = layers.fills {
            self.chart_fill_count = v.len();
            uploaded = true;
        } else if let Some(p) = &layers.fill_patch {
            self.chart_fill_patched += p.ranges.iter().map(|&(a, b)| (b - a) as usize).sum::<usize>();
            uploaded |= !p.ranges.is_empty();
        }
        if let Some(s) = layers.fill_style {
            self.chart_fill_style = Some(s);
            uploaded = true;
        }
        if let Some(v) = layers.points {
            self.chart_point_count = v.len();
            self.chart_point_uploads += 1;
            self.chart_point_bytes += std::mem::size_of_val(v);
            uploaded = true;
        }
        if let Some(s) = layers.point_style {
            self.chart_point_style = Some(s);
            self.chart_point_style_uploads += 1;
            self.chart_point_bytes += std::mem::size_of_val(&s);
            uploaded = true;
        }
        let counts = |l: &ChartAnnotationLayer<'_>| (l.fills.len(), l.lines.len(), l.markers.len());
        if let Some(l) = &layers.annotations_below {
            self.chart_annotations_below = counts(l);
            uploaded = true;
        }
        if let Some(l) = &layers.annotations_above {
            self.chart_annotations_above = counts(l);
            uploaded = true;
        }
        if let Some(l) = &layers.brush {
            self.chart_brush = counts(l);
            uploaded = true;
        }
        if let Some(l) = &layers.navigator {
            self.chart_navigator = counts(l);
            self.chart_navigator_uploads += 1;
            uploaded = true;
        }
        if let Some(l) = &layers.navigator_window {
            self.chart_navigator_window = counts(l);
            self.chart_navigator_window_uploads += 1;
            uploaded = true;
        }
        if let Some(g) = &layers.heatmap {
            self.chart_heatmap_cells = g.values.len();
            self.chart_heatmap_uploads += 1;
            uploaded = true;
        }
        if layers.heatmap_lut.is_some() {
            self.chart_heatmap_lut_uploads += 1;
            uploaded = true;
        }
        if let Some(s) = layers.heatmap_style {
            self.chart_heatmap_style = Some(s);
            self.chart_heatmap_style_uploads += 1;
            uploaded = true;
        }
        if uploaded {
            self.chart_uploads += 1;
        }
    }

    fn render_frame(&mut self, camera: &CameraUniformRaw) {
        self.rendered_frames += 1;
        self.last_camera = Some(*camera);
    }

    fn resize(&mut self, width: u32, height: u32) {
        self.viewport_size = (width, height);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{DatasetConfig, GraphDataset};
    use std::mem::size_of;

    #[test]
    fn gpu_structs_satisfy_16_byte_alignment_and_size_invariants() {
        assert_eq!(size_of::<CameraUniformRaw>(), 112);
        assert_eq!(size_of::<ChartSegmentRaw>(), 48);
        assert_eq!(size_of::<ChartMarkerRaw>(), 64);
        assert_eq!(size_of::<ChartBarRaw>(), 48);
        assert_eq!(size_of::<ChartPointRaw>(), 20);
        assert_eq!(size_of::<ChartPointStyleRaw>(), 1072);
        assert_eq!(size_of::<ChartFillRaw>(), 32);
        assert_eq!(size_of::<ChartHeatmapStyleRaw>(), 80);
        assert_eq!(size_of::<NodeInstanceRaw>(), 32);
        assert_eq!(size_of::<EdgeVertexRaw>(), 32);
        assert_eq!(size_of::<MeshVertexRaw>(), 32);
        assert_eq!(size_of::<MeshInstanceRaw>(), 144);
        assert_eq!(size_of::<SceneLightUniformRaw>(), 48);
    }

    #[test]
    fn instance_packer_packs_nodes_and_edges_and_highlights_hovered_node() {
        let ds = GraphDataset::generate_seeded(&DatasetConfig {
            seed: 7,
            node_count: 10,
            edge_count: 15,
            cluster_count: 3,
            space_radius: 50.0,
        });

        let mut packer = InstancePacker::new();
        let normal_radius = packer.pack_dataset(&ds, None).0[3].position_radius[3];
        let normal_color = packer.pack_dataset(&ds, None).0[3].color;
        let (nodes, edges) = packer.pack_dataset(&ds, Some(3));

        assert_eq!(nodes.len(), 10);
        assert_eq!(edges.len(), 30); // 2 vertices per edge

        // Node 3 is hovered: same hue brightened (no fixed highlight color) and enlarged
        let hovered = nodes[3];
        assert!((hovered.position_radius[3] / normal_radius - 1.6).abs() < 1e-4);
        assert!(hovered.color[0] >= normal_color[0] && hovered.color[2] >= normal_color[2]);
        assert_ne!(hovered.color, [1.0, 0.95, 0.4, 1.0]);

        // Disabled hover style leaves the node untouched
        let off = NodeHoverStyle {
            enabled: false,
            ..Default::default()
        };
        let (nodes, _) = packer.pack_dataset_with_culling(&ds, Some(3), None, &off);
        assert_eq!(nodes[3].position_radius[3], normal_radius);
    }

    #[test]
    fn transparent_nodes_stay_hidden_under_selection_and_translucent_ones_sort_last() {
        let positions = [0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 10.0, 0.0, 0.0];
        let colors = [
            1.0, 0.0, 0.0, 0.0, // fully transparent
            0.0, 1.0, 0.0, 1.0, // opaque
            0.0, 0.0, 1.0, 0.5, // translucent
        ];
        let mut ds =
            GraphDataset::from_raw_buffers(&positions, None, Some(&colors), None, &[], None).unwrap();
        ds.select_nodes(&[1]);
        let mut packer = InstancePacker::new();
        packer.pack_dataset(&ds, None);
        let (nodes, opaque, _) = packer.packed();
        // Node 0 is skipped (alpha 0 never becomes visible), node 1 opaque first, node 2 dimmed last
        assert_eq!(nodes.len(), 2);
        assert_eq!(opaque, 1);
        assert_eq!(nodes[0].color, [0.0, 1.0, 0.0, 1.0]);
        assert!(nodes[1].color[3] <= 0.14);
    }

    #[test]
    fn instance_packer_dims_unselected_nodes_and_edges_when_selection_is_active() {
        let positions = [0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 10.0, 0.0, 0.0];
        let edges = [0u32, 1, 1, 2];
        let mut ds =
            GraphDataset::from_raw_buffers(&positions, None, None, None, &edges, None).unwrap();

        // Select nodes 0 and 1 (so edge 0-1 is active, node 2 and edge 1-2 are unselected)
        ds.select_nodes(&[0, 1]);

        let mut packer = InstancePacker::new();
        let (nodes, edge_verts) = packer.pack_dataset(&ds, None);

        // Selected node 0 has full alpha (1.0), unselected node 2 is dimmed (< 0.25)
        assert!((nodes[0].color[3] - 1.0).abs() < 1e-4);
        assert!(nodes[2].color[3] < 0.25);

        // Edge 0-1 (verts 0, 1) is highlighted compared to unselected edge 1-2 (verts 2, 3)
        assert!(edge_verts[0].color[3] > edge_verts[2].color[3] * 3.0);
    }

    #[test]
    fn instance_packer_culls_invisible_nodes_and_edges_when_mask_provided() {
        let positions = [0.0, 0.0, 0.0, 5.0, 0.0, 0.0, 10.0, 0.0, 0.0];
        let edges = [0u32, 1, 1, 2];
        let ds =
            GraphDataset::from_raw_buffers(&positions, None, None, None, &edges, None).unwrap();

        let visible_mask = [true, true, false]; // Node 2 is outside frustum
        let mut packer = InstancePacker::new();
        let (nodes, edge_verts) = packer.pack_dataset_with_culling(
            &ds,
            None,
            Some(&visible_mask),
            &NodeHoverStyle::default(),
        );

        assert_eq!(nodes.len(), 2); // Only nodes 0 and 1 packed
        // Edge 0-1 is on screen; edge 1-2 leaves the screen but stays (GPU clips it)
        assert_eq!(edge_verts.len(), 4);
    }
}
