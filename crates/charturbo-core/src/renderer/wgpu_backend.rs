//! WebGPU / WebGL2 hardware rendering backend implementation.

use crate::renderer::shader::{
    chart_bar_wgsl, chart_fill_wgsl, chart_line_wgsl, chart_marker_wgsl, chart_point_wgsl,
    EDGE_LINE_WGSL, MESH_LIT_WGSL, NODE_BILLBOARD_WGSL,
};
use crate::renderer::{
    CameraUniformRaw, ChartAnnotationLayer, ChartBarRaw, ChartFillRaw, ChartFillStyleRaw, ChartLayers, ChartMarkerRaw, ChartPointRaw,
    ChartPointStyleRaw, ChartSegmentRaw, EdgeVertexRaw, MeshDraw, MeshInstanceRaw, MeshVertexRaw,
    NodeInstanceRaw, RenderBackend, SceneLightUniformRaw,
};
use crate::renderer::heatmap::HeatmapGpu;
use crate::renderer::shader::chart_heatmap_wgsl;
use crate::renderer::shader::chart_dash_line_wgsl;
use crate::renderer::ChartDashSegmentRaw;
use crate::renderer::gpu_context::GpuContext;
use crate::renderer::{chart_layer_bytes, RenderStats};
use bytemuck::Pod;
use std::mem::size_of;
use std::rc::Rc;
use wgpu::util::DeviceExt;

/// Float depth for reversed-Z (supported by WebGPU and WebGL2).
const DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;
/// Reversed-Z depth test: nearer fragments have larger depth.
const DEPTH_TEST: wgpu::CompareFunction = wgpu::CompareFunction::GreaterEqual;

/// Growable GPU array: recreated at the next power of two when it overflows, written in place
/// otherwise. Uploads that exceed the device's max buffer size are truncated instead of losing
/// the device.
struct GpuArray {
    buffer: wgpu::Buffer,
    capacity_bytes: u64,
    len: u32,
    label: &'static str,
    usage: wgpu::BufferUsages,
}

impl GpuArray {
    fn new(device: &wgpu::Device, label: &'static str, usage: wgpu::BufferUsages, bytes: u64) -> Self {
        let usage = usage | wgpu::BufferUsages::COPY_DST;
        let capacity_bytes = bytes.max(256);
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size: capacity_bytes,
            usage,
            mapped_at_creation: false,
        });
        Self {
            buffer,
            capacity_bytes,
            len: 0,
            label,
            usage,
        }
    }

    fn upload<T: Pod>(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, data: &[T], max_bytes: u64) {
        let elem = size_of::<T>() as u64;
        let max_elems = (max_bytes / elem.max(1)) as usize;
        let data = &data[..data.len().min(max_elems)];
        let bytes = data.len() as u64 * elem;
        if bytes > self.capacity_bytes {
            let grown = bytes.next_power_of_two().min(max_bytes - max_bytes % elem);
            self.capacity_bytes = grown.max(bytes);
            self.buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some(self.label),
                size: self.capacity_bytes,
                usage: self.usage,
                mapped_at_creation: false,
            });
        }
        if !data.is_empty() {
            queue.write_buffer(&self.buffer, 0, bytemuck::cast_slice(data));
        }
        self.len = data.len() as u32;
    }

    /// Re-writes `data[a..b]` at its offset for every range (the uploaded length is unchanged;
    /// ranges past it are skipped).
    fn write_ranges<T: Pod>(&mut self, queue: &wgpu::Queue, data: &[T], ranges: &[(u32, u32)]) {
        let elem = size_of::<T>() as u64;
        let end = (self.len as usize).min(data.len());
        for &(a, b) in ranges {
            let (a, b) = (a as usize, (b as usize).min(end));
            if a < b {
                queue.write_buffer(&self.buffer, a as u64 * elem, bytemuck::cast_slice(&data[a..b]));
            }
        }
    }

    fn slice(&self) -> wgpu::BufferSlice<'_> {
        self.buffer.slice(..)
    }
}

pub struct WgpuRenderBackend {
    target: PresentTarget,
    /// Shared device this engine was created on (`from_context`): keeps it alive, counts engines
    _shared: Option<Rc<GpuContext>>,
    device: wgpu::Device,
    queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    max_buffer_bytes: u64,
    depth_view: wgpu::TextureView,
    camera_buffer: wgpu::Buffer,
    camera_bind_group: wgpu::BindGroup,
    light_buffer: wgpu::Buffer,
    mesh_bind_group: wgpu::BindGroup,
    point_style_buffer: wgpu::Buffer,
    /// Camera + point style uniforms (same layout as the mesh bind group)
    point_bind_group: wgpu::BindGroup,
    fill_style_buffer: wgpu::Buffer,
    /// Camera + fill emphasis uniforms (every fill layer; untagged vertices ignore the emphasis)
    fill_bind_group: wgpu::BindGroup,

    mesh_pipeline: wgpu::RenderPipeline,
    mesh_translucent_pipeline: wgpu::RenderPipeline,
    node_pipeline: wgpu::RenderPipeline,
    node_translucent_pipeline: wgpu::RenderPipeline,
    edge_pipeline: wgpu::RenderPipeline,
    segment_pipeline: wgpu::RenderPipeline,
    segment_overlay_pipeline: wgpu::RenderPipeline,
    /// Dashed series strokes (`ChartDashSegmentRaw`)
    dash_segment_pipeline: wgpu::RenderPipeline,
    bar_pipeline: wgpu::RenderPipeline,
    marker_pipeline: wgpu::RenderPipeline,
    fill_pipeline: wgpu::RenderPipeline,
    marker_3d_pipeline: wgpu::RenderPipeline,
    fill_3d_pipeline: wgpu::RenderPipeline,
    /// Scientific 3D isolines (fill vertices as a line list, depth-tested, no depth write)
    contour_3d_pipeline: wgpu::RenderPipeline,
    depth_3d: bool,
    /// Fills without depth test (annotation bands above the series)
    fill_overlay_pipeline: wgpu::RenderPipeline,
    point_pipeline: wgpu::RenderPipeline,
    /// One textured quad per heatmap (value grid + colormap LUT textures)
    heatmap_pipeline: wgpu::RenderPipeline,
    heatmap: HeatmapGpu,

    nodes: GpuArray,
    opaque_nodes: u32,
    edges: GpuArray,
    helper_lines: GpuArray,
    mesh_vertices: GpuArray,
    mesh_indices: GpuArray,
    mesh_instances: GpuArray,
    mesh_draws: Vec<MeshDraw>,
    chart_underlay: GpuArray,
    chart_bars: GpuArray,
    chart_series: GpuArray,
    /// Dashed series strokes / series point markers (`ChartSeriesStyleLayer`)
    chart_series_dashed: GpuArray,
    chart_series_markers: GpuArray,
    chart_overlay: GpuArray,
    chart_markers: GpuArray,
    chart_fills: GpuArray,
    chart_contours_3d: GpuArray,
    chart_points: GpuArray,
    /// A series is emphasized: points draw twice (others, then that series on top)
    point_emphasis: bool,
    annotations_below: AnnotationArrays,
    annotations_above: AnnotationArrays,
    /// Brush rectangle / selection band (drawn over the above annotations)
    brush: AnnotationArrays,
    navigator: AnnotationArrays,
    navigator_window: AnnotationArrays,
    series_clip: Option<[u32; 4]>,
    clear_color: wgpu::Color,
    /// Upload / frame counters of `stats` (byte totals are computed on demand)
    counters: RenderStats,
    gpu_physics: Option<super::gpu_layout::GpuLayout>,
}

/// GPU buffers of one annotation layer (see `ChartAnnotationLayer`).
struct AnnotationArrays {
    fills: GpuArray,
    lines: GpuArray,
    markers: GpuArray,
}

impl AnnotationArrays {
    /// Initial bytes of the fills / lines / markers arrays.
    const fn initial_bytes() -> [u64; 3] {
        [
            12 * size_of::<ChartFillRaw>() as u64,
            4 * size_of::<ChartSegmentRaw>() as u64,
            4 * size_of::<ChartMarkerRaw>() as u64,
        ]
    }

    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    fn new(device: &wgpu::Device, label: &'static str) -> Self {
        let vb = wgpu::BufferUsages::VERTEX;
        let [fills, lines, markers] = Self::initial_bytes();
        Self {
            fills: GpuArray::new(device, label, vb, fills),
            lines: GpuArray::new(device, label, vb, lines),
            markers: GpuArray::new(device, label, vb, markers),
        }
    }

    fn upload(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, layer: &ChartAnnotationLayer<'_>, max: u64) {
        self.fills.upload(device, queue, layer.fills, max);
        self.lines.upload(device, queue, layer.lines, max);
        self.markers.upload(device, queue, layer.markers, max);
    }
}

struct PipelineSpec<'a> {
    label: &'static str,
    layout: &'a wgpu::PipelineLayout,
    shader: &'a wgpu::ShaderModule,
    vs: &'static str,
    fs: &'static str,
    buffers: &'a [wgpu::VertexBufferLayout<'a>],
    topology: wgpu::PrimitiveTopology,
    depth_write: bool,
    depth_compare: wgpu::CompareFunction,
}

fn create_pipeline(device: &wgpu::Device, format: wgpu::TextureFormat, spec: PipelineSpec) -> wgpu::RenderPipeline {
    create_biased_pipeline(device, format, spec, wgpu::DepthBiasState::default())
}

fn create_biased_pipeline(device: &wgpu::Device, format: wgpu::TextureFormat, spec: PipelineSpec, bias: wgpu::DepthBiasState) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(spec.label),
        layout: Some(spec.layout),
        vertex: wgpu::VertexState {
            module: spec.shader,
            entry_point: Some(spec.vs),
            buffers: spec.buffers,
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: spec.shader,
            entry_point: Some(spec.fs),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState {
            topology: spec.topology,
            ..Default::default()
        },
        depth_stencil: Some(wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: spec.depth_write,
            depth_compare: spec.depth_compare,
            stencil: wgpu::StencilState::default(),
            bias,
        }),
        multisample: wgpu::MultisampleState::default(),
        multiview: None,
        cache: None,
    })
}

const fn vec4_attrs<const N: usize>() -> [wgpu::VertexAttribute; N] {
    let mut attrs = [wgpu::VertexAttribute {
        format: wgpu::VertexFormat::Float32x4,
        offset: 0,
        shader_location: 0,
    }; N];
    let mut i = 0;
    while i < N {
        attrs[i].offset = (i * 16) as u64;
        attrs[i].shader_location = i as u32;
        i += 1;
    }
    attrs
}

const ATTRS_2: [wgpu::VertexAttribute; 2] = vec4_attrs::<2>();
const ATTRS_3: [wgpu::VertexAttribute; 3] = vec4_attrs::<3>();
const ATTRS_4: [wgpu::VertexAttribute; 4] = vec4_attrs::<4>();

/// Scatter point instance: `[x, y, series_slot, radius]` then RGBA8 color.
const POINT_ATTRS: [wgpu::VertexAttribute; 2] = [
    wgpu::VertexAttribute {
        format: wgpu::VertexFormat::Float32x4,
        offset: 0,
        shader_location: 0,
    },
    wgpu::VertexAttribute {
        format: wgpu::VertexFormat::Unorm8x4,
        offset: 16,
        shader_location: 1,
    },
];

/// Mesh instance attributes at shader locations 2..=10 (after the 2 per-vertex attributes).
const MESH_INSTANCE_ATTRS: [wgpu::VertexAttribute; 9] = {
    let mut attrs = vec4_attrs::<9>();
    let mut i = 0;
    while i < 9 {
        attrs[i].shader_location = 2 + i as u32;
        i += 1;
    }
    attrs
};

fn layout_of<T>(step_mode: wgpu::VertexStepMode, attributes: &'static [wgpu::VertexAttribute]) -> wgpu::VertexBufferLayout<'static> {
    wgpu::VertexBufferLayout {
        array_stride: size_of::<T>() as wgpu::BufferAddress,
        step_mode,
        attributes,
    }
}

/// Initial elements per growable chart array of compact engines (shared-device dashboards):
/// `GpuArray` grows on the first upload that needs more, so sparklines never reserve the
/// default 8192-segment / 4096-vertex buffers.
const COMPACT_ARRAY_ELEMS: u64 = 16;

/// `(label, default initial elements, element bytes)` of every per-engine growable GPU array.
const ENGINE_ARRAYS: [(&str, u64, usize); 15] = [
    ("node-instances", 1024, size_of::<NodeInstanceRaw>()),
    ("edge-vertices", 2048, size_of::<EdgeVertexRaw>()),
    ("helper-lines", 512, size_of::<EdgeVertexRaw>()),
    ("mesh-vertices", 4096, size_of::<MeshVertexRaw>()),
    ("mesh-indices", 8192, 4),
    ("mesh-instances", 64, size_of::<MeshInstanceRaw>()),
    ("chart-underlay", 16, size_of::<ChartSegmentRaw>()),
    ("chart-bars", 256, size_of::<ChartBarRaw>()),
    ("chart-series", 8192, size_of::<ChartSegmentRaw>()),
    ("chart-overlay", 4, size_of::<ChartSegmentRaw>()),
    ("chart-markers", 16, size_of::<ChartMarkerRaw>()),
    ("chart-fills", 1024, size_of::<ChartFillRaw>()),
    ("chart-points", 1024, size_of::<ChartPointRaw>()),
    ("chart-series-dashed", 16, size_of::<ChartDashSegmentRaw>()),
    ("chart-series-markers", 16, size_of::<ChartMarkerRaw>()),
];

/// Annotation-style layers (`AnnotationArrays`): below, above, brush, navigator, window.
const ANNOTATION_LAYERS: u64 = 5;

/// Initial bytes of the growable array `label` (`GpuArray` rounds up to 256).
fn initial_array_bytes(label: &str, compact: bool) -> u64 {
    let (_, elems, size) = ENGINE_ARRAYS
        .iter()
        .copied()
        .find(|(l, ..)| *l == label)
        .unwrap_or((label, COMPACT_ARRAY_ELEMS, 16));
    let elems = if compact { elems.min(COMPACT_ARRAY_ELEMS) } else { elems };
    elems * size as u64
}

/// GPU memory one engine allocates at creation for a `width x height` px target, excluding
/// the shared pipelines and the swap chain: growable arrays, annotation layers, uniforms,
/// the depth texture and the heatmap textures. Compact engines start every array small.
pub fn engine_gpu_bytes(compact: bool, width: u32, height: u32) -> u64 {
    let arrays: u64 = ENGINE_ARRAYS.iter().map(|(l, ..)| initial_array_bytes(l, compact).max(256)).sum();
    let annotation = AnnotationArrays::initial_bytes().iter().map(|b| b.max(&256)).sum::<u64>() * ANNOTATION_LAYERS;
    let uniforms = (size_of::<CameraUniformRaw>()
        + size_of::<SceneLightUniformRaw>()
        + size_of::<ChartPointStyleRaw>()
        + size_of::<crate::renderer::ChartHeatmapStyleRaw>()) as u64;
    // Heatmap value texel (R32Float 1 x 1) + colormap LUT (RGBA8 256 x 1)
    let heatmap_textures = 4 + 4 * crate::renderer::HEATMAP_LUT_SIZE as u64;
    let depth = width.max(1) as u64 * height.max(1) as u64 * 4;
    arrays + annotation + uniforms + heatmap_textures + depth
}

/// Bind group layouts and render pipelines for one surface format. Built once per device and
/// format and shared by every engine of a `GpuContext` (wgpu handles are reference counted:
/// engines hold cheap clones).
#[derive(Clone)]
pub struct GpuPipelines {
    camera_bgl: wgpu::BindGroupLayout,
    mesh_bgl: wgpu::BindGroupLayout,
    heatmap_bgl: wgpu::BindGroupLayout,
    mesh_pipeline: wgpu::RenderPipeline,
    mesh_translucent_pipeline: wgpu::RenderPipeline,
    node_pipeline: wgpu::RenderPipeline,
    node_translucent_pipeline: wgpu::RenderPipeline,
    edge_pipeline: wgpu::RenderPipeline,
    segment_pipeline: wgpu::RenderPipeline,
    segment_overlay_pipeline: wgpu::RenderPipeline,
    dash_segment_pipeline: wgpu::RenderPipeline,
    bar_pipeline: wgpu::RenderPipeline,
    marker_pipeline: wgpu::RenderPipeline,
    fill_pipeline: wgpu::RenderPipeline,
    marker_3d_pipeline: wgpu::RenderPipeline,
    fill_3d_pipeline: wgpu::RenderPipeline,
    contour_3d_pipeline: wgpu::RenderPipeline,
    fill_overlay_pipeline: wgpu::RenderPipeline,
    point_pipeline: wgpu::RenderPipeline,
    heatmap_pipeline: wgpu::RenderPipeline,
}

/// Where frames go: the engine's own canvas surface, or (WebGL2 shared device) the device's
/// hidden GL canvas, copied into this engine's 2D canvas after every frame.
enum PresentTarget {
    Surface(wgpu::Surface<'static>),
    #[cfg(all(target_arch = "wasm32", feature = "webgl"))]
    Blit {
        gl: Rc<crate::renderer::gpu_context::SharedGlCanvas>,
        ctx2d: web_sys::CanvasRenderingContext2d,
    },
}

/// Surface configuration of a canvas surface: first non-sRGB format, FIFO, first alpha mode.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(crate) fn surface_config(
    surface: &wgpu::Surface<'_>,
    adapter: &wgpu::Adapter,
    width: u32,
    height: u32,
) -> Result<wgpu::SurfaceConfiguration, String> {
    let caps = surface.get_capabilities(adapter);
    let format = caps
        .formats
        .iter()
        .copied()
        .find(|f| !f.is_srgb())
        .or_else(|| caps.formats.first().copied())
        .ok_or_else(|| "Surface has no supported texture formats".to_string())?;

    let present_mode = caps
        .present_modes
        .iter()
        .copied()
        .find(|&m| m == wgpu::PresentMode::Fifo)
        .or_else(|| caps.present_modes.first().copied())
        .unwrap_or(wgpu::PresentMode::Fifo);

    Ok(wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width,
        height,
        present_mode,
        alpha_mode: caps
            .alpha_modes
            .first()
            .copied()
            .unwrap_or(wgpu::CompositeAlphaMode::Auto),
        view_formats: vec![],
        desired_maximum_frame_latency: 2,
    })
}

impl WgpuRenderBackend {
    #[cfg(target_arch = "wasm32")]
    pub async fn from_canvas(canvas: web_sys::HtmlCanvasElement) -> Result<Self, String> {
        let width = canvas.width().max(1);
        let height = canvas.height().max(1);

        #[cfg(feature = "webgl")]
        let backends = wgpu::Backends::BROWSER_WEBGPU | wgpu::Backends::GL;
        #[cfg(not(feature = "webgl"))]
        let backends = wgpu::Backends::BROWSER_WEBGPU;
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor {
            backends,
            ..Default::default()
        });

        let surface = instance
            .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
            .map_err(|e| format!("Failed to create wgpu surface: {e:?}"))?;

        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: Some(&surface),
                force_fallback_adapter: false,
            })
            .await
            .ok_or_else(|| "No suitable GPU adapter found".to_string())?;

        let limits = super::gpu_context::device_limits(&adapter);

        let (device, queue) = adapter
            .request_device(
                &wgpu::DeviceDescriptor {
                    label: Some("charturbo-core-device"),
                    required_features: wgpu::Features::empty(),
                    required_limits: limits,
                    memory_hints: wgpu::MemoryHints::Performance,
                },
                None,
            )
            .await
            .map_err(|e| format!("Failed to request device: {e:?}"))?;

        let config = surface_config(&surface, &adapter, width, height)?;
        surface.configure(&device, &config);

        Ok(Self::build_pipelines(surface, device, queue, config))
    }

    /// Engine on a shared device: its own surface (WebGPU) or a 2D context the shared GL canvas
    /// is copied into (WebGL2; the canvas must not have another context yet). Pipelines come
    /// from the context's cache; buffers start compact.
    #[cfg(target_arch = "wasm32")]
    pub fn from_context(ctx: &Rc<GpuContext>, canvas: web_sys::HtmlCanvasElement) -> Result<Self, String> {
        let width = canvas.width().max(1);
        let height = canvas.height().max(1);
        #[cfg(feature = "webgl")]
        let (target, config) = {
            use wasm_bindgen::JsCast;
            match &ctx.gl {
                None => {
                    let surface = ctx
                        .instance
                        .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
                        .map_err(|e| format!("Failed to create wgpu surface: {e:?}"))?;
                    let config = surface_config(&surface, &ctx.adapter, width, height)?;
                    surface.configure(&ctx.device, &config);
                    (PresentTarget::Surface(surface), config)
                }
                Some(gl) => {
                    let ctx2d: web_sys::CanvasRenderingContext2d = canvas
                        .get_context("2d")
                        .ok()
                        .flatten()
                        .and_then(|c| c.dyn_into().ok())
                        .ok_or_else(|| {
                            "Failed to create wgpu surface: WebGL2 shared device needs a canvas without another context (2d)"
                                .to_string()
                        })?;
                    let config = wgpu::SurfaceConfiguration { width, height, ..gl.base_config.clone() };
                    (PresentTarget::Blit { gl: gl.clone(), ctx2d }, config)
                }
            }
        };
        #[cfg(not(feature = "webgl"))]
        let (target, config) = {
            let surface = ctx
                .instance
                .create_surface(wgpu::SurfaceTarget::Canvas(canvas))
                .map_err(|e| format!("Failed to create wgpu surface: {e:?}"))?;
            let config = surface_config(&surface, &ctx.adapter, width, height)?;
            surface.configure(&ctx.device, &config);
            (PresentTarget::Surface(surface), config)
        };
        let pipes = ctx.pipelines.get_or_build(config.format, || GpuPipelines::new(&ctx.device, config.format));
        let mut backend = Self::assemble(target, ctx.device.clone(), ctx.queue.clone(), config, &pipes, true);
        backend._shared = Some(ctx.clone());
        Ok(backend)
    }

    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    fn build_pipelines(
        surface: wgpu::Surface<'static>,
        device: wgpu::Device,
        queue: wgpu::Queue,
        config: wgpu::SurfaceConfiguration,
    ) -> Self {
        let pipes = GpuPipelines::new(&device, config.format);
        Self::assemble(PresentTarget::Surface(surface), device, queue, config, &pipes, false)
    }

    /// Per-engine resources (depth texture, uniforms, bind groups, instance buffers) around
    /// the given pipelines. `compact`: growable arrays start at `COMPACT_ARRAY_ELEMS`.
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    fn assemble(
        target: PresentTarget,
        device: wgpu::Device,
        queue: wgpu::Queue,
        config: wgpu::SurfaceConfiguration,
        pipes: &GpuPipelines,
        compact: bool,
    ) -> Self {
        let depth_view = Self::create_depth_view(&device, config.width, config.height);
        let max_buffer_bytes = device.limits().max_buffer_size;

        let initial_cam = CameraUniformRaw {
            view_proj: [
                [1.0, 0.0, 0.0, 0.0],
                [0.0, 1.0, 0.0, 0.0],
                [0.0, 0.0, 1.0, 0.0],
                [0.0, 0.0, 0.0, 1.0],
            ],
            camera_right: [1.0, 0.0, 0.0, 0.0],
            camera_up: [0.0, 1.0, 0.0, 0.0],
            viewport: [config.width as f32, config.height as f32, 1.0, 0.0],
        };

        let camera_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("camera-uniform-buffer"),
            contents: bytemuck::bytes_of(&initial_cam),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let camera_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("camera-bg"),
            layout: &pipes.camera_bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: camera_buffer.as_entire_binding(),
            }],
        });

        let initial_light = SceneLightUniformRaw::default();
        let light_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("scene-light-uniform-buffer"),
            contents: bytemuck::bytes_of(&initial_light),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });

        let mesh_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mesh-bg"),
            layout: &pipes.mesh_bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: light_buffer.as_entire_binding(),
                },
            ],
        });

        let point_style_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("chart-point-style-buffer"),
            contents: bytemuck::bytes_of(&ChartPointStyleRaw::default()),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let point_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("chart-point-bg"),
            layout: &pipes.mesh_bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: point_style_buffer.as_entire_binding(),
                },
            ],
        });

        let fill_style_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("chart-fill-style-buffer"),
            contents: bytemuck::bytes_of(&ChartFillStyleRaw::default()),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let fill_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("chart-fill-bg"),
            layout: &pipes.mesh_bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera_buffer.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: fill_style_buffer.as_entire_binding(),
                },
            ],
        });

        let heatmap = HeatmapGpu::new(&device, pipes.heatmap_bgl.clone(), &camera_buffer);

        let vb = wgpu::BufferUsages::VERTEX;
        let arr = |label, usage| GpuArray::new(&device, label, usage, initial_array_bytes(label, compact));
        let nodes = arr("node-instances", vb);
        let edges = arr("edge-vertices", vb);
        let helper_lines = arr("helper-lines", vb);
        let mesh_vertices = arr("mesh-vertices", vb);
        let mesh_indices = arr("mesh-indices", wgpu::BufferUsages::INDEX);
        let mesh_instances = arr("mesh-instances", vb);
        let chart_underlay = arr("chart-underlay", vb);
        let chart_bars = arr("chart-bars", vb);
        let chart_series = arr("chart-series", vb);
        let chart_series_dashed = arr("chart-series-dashed", vb);
        let chart_series_markers = arr("chart-series-markers", vb);
        let chart_overlay = arr("chart-overlay", vb);
        let chart_markers = arr("chart-markers", vb);
        let chart_fills = arr("chart-fills", vb);
        let chart_contours_3d = arr("chart-contours-3d", vb);
        let chart_points = arr("chart-points", vb);
        let annotations_below = AnnotationArrays::new(&device, "chart-annotations-below");
        let annotations_above = AnnotationArrays::new(&device, "chart-annotations-above");
        let brush = AnnotationArrays::new(&device, "chart-brush");
        let navigator = AnnotationArrays::new(&device, "chart-navigator");
        let navigator_window = AnnotationArrays::new(&device, "chart-navigator-window");

        let p = pipes.clone();
        Self {
            target,
            _shared: None,
            device,
            queue,
            config,
            max_buffer_bytes,
            depth_view,
            camera_buffer,
            camera_bind_group,
            light_buffer,
            mesh_bind_group,
            point_style_buffer,
            point_bind_group,
            fill_style_buffer,
            fill_bind_group,
            mesh_pipeline: p.mesh_pipeline,
            mesh_translucent_pipeline: p.mesh_translucent_pipeline,
            node_pipeline: p.node_pipeline,
            node_translucent_pipeline: p.node_translucent_pipeline,
            edge_pipeline: p.edge_pipeline,
            segment_pipeline: p.segment_pipeline,
            segment_overlay_pipeline: p.segment_overlay_pipeline,
            dash_segment_pipeline: p.dash_segment_pipeline,
            bar_pipeline: p.bar_pipeline,
            marker_pipeline: p.marker_pipeline,
            fill_pipeline: p.fill_pipeline,
            marker_3d_pipeline: p.marker_3d_pipeline,
            fill_3d_pipeline: p.fill_3d_pipeline,
            contour_3d_pipeline: p.contour_3d_pipeline,
            depth_3d: false,
            fill_overlay_pipeline: p.fill_overlay_pipeline,
            point_pipeline: p.point_pipeline,
            heatmap_pipeline: p.heatmap_pipeline,
            heatmap,
            nodes,
            opaque_nodes: 0,
            edges,
            helper_lines,
            mesh_vertices,
            mesh_indices,
            mesh_instances,
            mesh_draws: Vec::new(),
            chart_underlay,
            chart_bars,
            chart_series,
            chart_series_dashed,
            chart_series_markers,
            chart_overlay,
            chart_markers,
            chart_fills,
            chart_contours_3d,
            chart_points,
            point_emphasis: false,
            annotations_below,
            annotations_above,
            brush,
            navigator,
            navigator_window,
            series_clip: None,
            clear_color: wgpu::Color {
                r: 0.035,
                g: 0.045,
                b: 0.08,
                a: 1.0,
            },
            counters: RenderStats::default(),
            gpu_physics: None,
        }
    }

    fn create_depth_view(device: &wgpu::Device, width: u32, height: u32) -> wgpu::TextureView {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("depth-texture"),
            size: wgpu::Extent3d {
                width: width.max(1),
                height: height.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        });
        texture.create_view(&wgpu::TextureViewDescriptor::default())
    }

    /// Next frame texture of the present target (`None` = skip this frame).
    #[cfg_attr(not(target_arch = "wasm32"), allow(clippy::infallible_destructuring_match))]
    fn acquire_frame(&self) -> Option<wgpu::SurfaceTexture> {
        let surface = match &self.target {
            PresentTarget::Surface(s) => s,
            #[cfg(all(target_arch = "wasm32", feature = "webgl"))]
            PresentTarget::Blit { gl, .. } => {
                gl.ensure_size(&self.device, &self.config);
                &gl.surface
            }
        };
        match surface.get_current_texture() {
            Ok(tex) => Some(tex),
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                surface.configure(&self.device, &self.config);
                #[cfg(all(target_arch = "wasm32", feature = "webgl"))]
                if let PresentTarget::Blit { gl, .. } = &self.target {
                    gl.invalidate();
                }
                None
            }
            Err(_) => None,
        }
    }

    /// After `present`: the WebGL2 shared canvas holds this frame until the task ends, so it is
    /// copied into the engine's 2D canvas now.
    fn finish_frame(&self) {
        #[cfg(all(target_arch = "wasm32", feature = "webgl"))]
        if let PresentTarget::Blit { gl, ctx2d } = &self.target {
            let (w, h) = (self.config.width as f64, self.config.height as f64);
            ctx2d.clear_rect(0.0, 0.0, w, h);
            let _ = ctx2d.draw_image_with_html_canvas_element(&gl.canvas, 0.0, 0.0);
        }
    }
}

impl GpuPipelines {
    /// Compiles every shader and pipeline for `format`.
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let uniform_entry = |binding: u32| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };

        let camera_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("camera-bgl"),
                entries: &[uniform_entry(0)],
            });

        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("charturbo-pipeline-layout"),
            bind_group_layouts: &[&camera_bind_group_layout],
            push_constant_ranges: &[],
        });

        let mesh_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("mesh-bgl"),
                entries: &[uniform_entry(0), uniform_entry(1)],
            });

        let mesh_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("mesh-pipeline-layout"),
            bind_group_layouts: &[&mesh_bind_group_layout],
            push_constant_ranges: &[],
        });

        // Fills: camera + emphasis uniform. Same bind group layout as the meshes / points but its own
        // pipeline layout: wgpu re-reads the shader's expected uniform sizes only when the layout
        // object changes, so point (1088 B) -> fill (48 B) draws must not share one
        let fill_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("chart-fill-pipeline-layout"),
            bind_group_layouts: &[&mesh_bind_group_layout],
            push_constant_ranges: &[],
        });

        let shader = |label: &'static str, src: String| {
            device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some(label),
                source: wgpu::ShaderSource::Wgsl(src.into()),
            })
        };
        let mesh_shader = shader("mesh-lit-shader", MESH_LIT_WGSL.to_string());
        let node_shader = shader("node-billboard-shader", NODE_BILLBOARD_WGSL.to_string());
        let edge_shader = shader("edge-line-shader", EDGE_LINE_WGSL.to_string());
        let segment_shader = shader("chart-line-shader", chart_line_wgsl());
        let bar_shader = shader("chart-bar-shader", chart_bar_wgsl());
        let marker_shader = shader("chart-marker-shader", chart_marker_wgsl());
        let point_shader = shader("chart-point-shader", chart_point_wgsl());
        let fill_shader = shader("chart-fill-shader", chart_fill_wgsl());

        use wgpu::CompareFunction::Always;
        use wgpu::PrimitiveTopology::{LineList, TriangleList};
        use wgpu::VertexStepMode::{Instance, Vertex};

        let mesh_buffers = [
            layout_of::<MeshVertexRaw>(Vertex, &ATTRS_2),
            layout_of::<MeshInstanceRaw>(Instance, &MESH_INSTANCE_ATTRS),
        ];
        let mesh_spec = |label, depth_write| PipelineSpec {
            label,
            layout: &mesh_pipeline_layout,
            shader: &mesh_shader,
            vs: "vs_mesh",
            fs: "fs_mesh",
            buffers: &mesh_buffers,
            topology: TriangleList,
            depth_write,
            depth_compare: DEPTH_TEST,
        };
        let mesh_pipeline = create_pipeline(device, format, mesh_spec("mesh-opaque", true));
        let mesh_translucent_pipeline =
            create_pipeline(device, format, mesh_spec("mesh-translucent", false));

        let node_buffers = [layout_of::<NodeInstanceRaw>(Instance, &ATTRS_2)];
        let node_spec = |label, depth_write| PipelineSpec {
            label,
            layout: &pipeline_layout,
            shader: &node_shader,
            vs: "vs_node",
            fs: "fs_node",
            buffers: &node_buffers,
            topology: TriangleList,
            depth_write,
            depth_compare: DEPTH_TEST,
        };
        let node_pipeline = create_pipeline(device, format, node_spec("node-opaque", true));
        let node_translucent_pipeline =
            create_pipeline(device, format, node_spec("node-translucent", false));

        let edge_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "edge-lines",
                layout: &pipeline_layout,
                shader: &edge_shader,
                vs: "vs_edge",
                fs: "fs_edge",
                buffers: &[layout_of::<EdgeVertexRaw>(Vertex, &ATTRS_2)],
                topology: LineList,
                depth_write: false,
                depth_compare: DEPTH_TEST,
            },
        );

        let segment_buffers = [layout_of::<ChartSegmentRaw>(Instance, &ATTRS_3)];
        let segment_spec = |label, depth_write, depth_compare| PipelineSpec {
            label,
            layout: &pipeline_layout,
            shader: &segment_shader,
            vs: "vs_segment",
            fs: "fs_segment",
            buffers: &segment_buffers,
            topology: TriangleList,
            depth_write,
            depth_compare,
        };
        // Strokes are depth-tested but never write depth: their anti-aliased edges would occlude
        // neighbouring segments. The chart orders series back-to-front instead.
        let segment_pipeline =
            create_pipeline(device, format, segment_spec("chart-segments", false, DEPTH_TEST));
        let segment_overlay_pipeline =
            create_pipeline(device, format, segment_spec("chart-overlay", false, Always));
        let dash_shader = shader("chart-dash-line-shader", chart_dash_line_wgsl());
        let dash_segment_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "chart-dash-segments",
                layout: &pipeline_layout,
                shader: &dash_shader,
                vs: "vs_dash",
                fs: "fs_dash",
                buffers: &[layout_of::<ChartDashSegmentRaw>(Instance, &ATTRS_4)],
                topology: TriangleList,
                depth_write: false,
                depth_compare: DEPTH_TEST,
            },
        );

        let bar_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "chart-bars",
                layout: &pipeline_layout,
                shader: &bar_shader,
                vs: "vs_bar",
                fs: "fs_bar",
                buffers: &[layout_of::<ChartBarRaw>(Instance, &ATTRS_3)],
                topology: TriangleList,
                depth_write: true,
                depth_compare: DEPTH_TEST,
            },
        );
        let marker_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "chart-markers",
                layout: &pipeline_layout,
                shader: &marker_shader,
                vs: "vs_marker",
                fs: "fs_marker",
                buffers: &[layout_of::<ChartMarkerRaw>(Instance, &ATTRS_4)],
                topology: TriangleList,
                depth_write: false,
                depth_compare: Always,
            },
        );

        // Areas and points blend over the grid without writing depth (like strokes)
        let fill_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "chart-fills",
                layout: &fill_pipeline_layout,
                shader: &fill_shader,
                vs: "vs_fill",
                fs: "fs_fill",
                buffers: &[layout_of::<ChartFillRaw>(Vertex, &ATTRS_2)],
                topology: TriangleList,
                depth_write: false,
                depth_compare: DEPTH_TEST,
            },
        );
        let marker_3d_pipeline = create_pipeline(device, format, PipelineSpec {
            label: "chart-3d-markers", layout: &pipeline_layout, shader: &marker_shader,
            vs: "vs_marker", fs: "fs_marker", buffers: &[layout_of::<ChartMarkerRaw>(Instance, &ATTRS_4)],
            topology: TriangleList, depth_write: true, depth_compare: DEPTH_TEST,
        });
        // Polygon offset (glPolygonOffset factor 1, units 1; negative under reverse-Z) pushes
        // surfaces behind coplanar contour lines so line rasterization never loses depth ties.
        let surface_offset = wgpu::DepthBiasState { constant: -1, slope_scale: -1.0, clamp: 0.0 };
        let fill_3d_pipeline = create_biased_pipeline(device, format, PipelineSpec {
            label: "chart-3d-fills", layout: &fill_pipeline_layout, shader: &fill_shader,
            vs: "vs_fill", fs: "fs_fill", buffers: &[layout_of::<ChartFillRaw>(Vertex, &ATTRS_2)],
            topology: TriangleList, depth_write: true, depth_compare: DEPTH_TEST,
        }, surface_offset);
        // Untagged fill vertices (w = 0) as 1 px lines lying in the surface triangles' planes.
        let contour_3d_pipeline = create_pipeline(device, format, PipelineSpec {
            label: "chart-3d-contours", layout: &fill_pipeline_layout, shader: &fill_shader,
            vs: "vs_fill", fs: "fs_fill", buffers: &[layout_of::<ChartFillRaw>(Vertex, &ATTRS_2)],
            topology: LineList, depth_write: false, depth_compare: DEPTH_TEST,
        });
        let fill_overlay_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "chart-fills-overlay",
                layout: &fill_pipeline_layout,
                shader: &fill_shader,
                vs: "vs_fill",
                fs: "fs_fill",
                buffers: &[layout_of::<ChartFillRaw>(Vertex, &ATTRS_2)],
                topology: TriangleList,
                depth_write: false,
                depth_compare: Always,
            },
        );
        // Camera (binding 0) + point style (binding 1): same layout as the mesh pipelines
        let point_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "chart-points",
                layout: &mesh_pipeline_layout,
                shader: &point_shader,
                vs: "vs_point",
                fs: "fs_point",
                buffers: &[layout_of::<ChartPointRaw>(Instance, &POINT_ATTRS)],
                topology: TriangleList,
                depth_write: false,
                depth_compare: DEPTH_TEST,
            },
        );

        // Heatmap: camera + style uniforms and the value / LUT textures, no vertex buffers
        let heatmap_bgl = HeatmapGpu::bind_group_layout(device);
        let heatmap_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("chart-heatmap-pipeline-layout"),
            bind_group_layouts: &[&heatmap_bgl],
            push_constant_ranges: &[],
        });
        let heatmap_shader = shader("chart-heatmap-shader", chart_heatmap_wgsl());
        let heatmap_pipeline = create_pipeline(
            device,
            format,
            PipelineSpec {
                label: "chart-heatmap",
                layout: &heatmap_pipeline_layout,
                shader: &heatmap_shader,
                vs: "vs_heatmap",
                fs: "fs_heatmap",
                buffers: &[],
                topology: TriangleList,
                depth_write: false,
                depth_compare: DEPTH_TEST,
            },
        );

        Self {
            camera_bgl: camera_bind_group_layout,
            mesh_bgl: mesh_bind_group_layout,
            heatmap_bgl,
            mesh_pipeline,
            mesh_translucent_pipeline,
            node_pipeline,
            node_translucent_pipeline,
            edge_pipeline,
            segment_pipeline,
            segment_overlay_pipeline,
            dash_segment_pipeline,
            bar_pipeline,
            marker_pipeline,
            fill_pipeline,
            marker_3d_pipeline,
            fill_3d_pipeline,
            contour_3d_pipeline,
            fill_overlay_pipeline,
            point_pipeline,
            heatmap_pipeline,
        }
    }
}

impl WgpuRenderBackend {
    /// Issues the opaque or translucent mesh draws. Instances are addressed by slicing the
    /// instance buffer (no `first_instance` / base-vertex support needed, so WebGL2 works).
    fn draw_meshes<'a>(&'a self, rpass: &mut wgpu::RenderPass<'a>, translucent: bool) {
        let mut bound = false;
        let stride = size_of::<MeshInstanceRaw>() as u64;
        for d in self.mesh_draws.iter().filter(|d| d.translucent == translucent) {
            if d.instance_count == 0 || d.index_count == 0 {
                continue;
            }
            if !bound {
                rpass.set_pipeline(if translucent {
                    &self.mesh_translucent_pipeline
                } else {
                    &self.mesh_pipeline
                });
                rpass.set_bind_group(0, &self.mesh_bind_group, &[]);
                rpass.set_vertex_buffer(0, self.mesh_vertices.slice());
                rpass.set_index_buffer(self.mesh_indices.slice(), wgpu::IndexFormat::Uint32);
                bound = true;
            }
            let from = d.first_instance as u64 * stride;
            let to = from + d.instance_count as u64 * stride;
            rpass.set_vertex_buffer(1, self.mesh_instances.buffer.slice(from..to));
            rpass.draw_indexed(d.first_index..d.first_index + d.index_count, 0, 0..d.instance_count);
        }
    }
}

/// Draws a triangle list of `ChartFillRaw` vertices.
fn draw_fills<'a>(rpass: &mut wgpu::RenderPass<'a>, pipeline: &'a wgpu::RenderPipeline, bind: &'a wgpu::BindGroup, array: &'a GpuArray) {
    if array.len == 0 {
        return;
    }
    rpass.set_pipeline(pipeline);
    rpass.set_bind_group(0, bind, &[]);
    rpass.set_vertex_buffer(0, array.slice());
    rpass.draw(0..array.len, 0..1);
}

/// Draws `count` instances of a 6-vertex quad from `array`.
fn draw_quads<'a>(rpass: &mut wgpu::RenderPass<'a>, pipeline: &'a wgpu::RenderPipeline, bind: &'a wgpu::BindGroup, array: &'a GpuArray) {
    if array.len == 0 {
        return;
    }
    rpass.set_pipeline(pipeline);
    rpass.set_bind_group(0, bind, &[]);
    rpass.set_vertex_buffer(0, array.slice());
    rpass.draw(0..6, 0..array.len);
}

impl RenderBackend for WgpuRenderBackend {
    fn supports_gpu_physics(&self) -> bool {
        self.device.limits().max_compute_workgroups_per_dimension > 0
    }

    fn gpu_layout_step(&mut self, step: &super::gpu_layout::GpuLayoutStep) -> Result<(), String> {
        if !self.supports_gpu_physics() { return Err("GPU physics requires WebGPU".into()); }
        self.gpu_physics.get_or_insert_with(|| super::gpu_layout::GpuLayout::new(&self.device))
            .submit(&self.device, &self.queue, step)
    }

    fn gpu_layout_write(&mut self, write: super::gpu_layout::GpuStateWrite) -> Result<(), String> {
        let layout = self.gpu_physics.as_mut().ok_or("GPU layout has no resident state")?;
        layout.write(&self.device, &self.queue, write)
    }

    fn gpu_layout_readback(&mut self) -> Option<super::gpu_layout::GpuLayoutReadback> {
        self.gpu_physics.as_mut()?.take_readback()
    }

    fn gpu_layout_sync(&mut self) -> Result<super::gpu_layout::GpuSync, String> {
        let layout = self.gpu_physics.as_mut().ok_or("GPU layout has no resident state")?;
        layout.request_sync(&self.device, &self.queue)
    }

    fn gpu_layout_take_sync(&mut self) -> Option<super::gpu_layout::GpuLayoutReadback> {
        self.gpu_physics.as_mut()?.take_sync()
    }

    fn sync_graph(&mut self, nodes: &[NodeInstanceRaw], opaque_nodes: usize, edge_vertices: &[EdgeVertexRaw]) {
        let max = self.max_buffer_bytes;
        self.nodes.upload(&self.device, &self.queue, nodes, max);
        self.opaque_nodes = (opaque_nodes as u32).min(self.nodes.len);
        self.edges.upload(&self.device, &self.queue, edge_vertices, max);
    }

    fn sync_scene_geometry(&mut self, vertices: &[MeshVertexRaw], indices: &[u32]) {
        let max = self.max_buffer_bytes;
        self.mesh_vertices.upload(&self.device, &self.queue, vertices, max);
        self.mesh_indices.upload(&self.device, &self.queue, indices, max);
    }

    fn sync_scene_instances(&mut self, instances: &[MeshInstanceRaw], draws: &[MeshDraw]) {
        let max = self.max_buffer_bytes;
        self.mesh_instances.upload(&self.device, &self.queue, instances, max);
        // Drop draws referencing geometry / instances that did not fit the device limits
        let (n_inst, n_idx) = (self.mesh_instances.len, self.mesh_indices.len);
        self.mesh_draws.clear();
        self.mesh_draws.extend(draws.iter().copied().filter(|d| {
            d.first_instance + d.instance_count <= n_inst && d.first_index + d.index_count <= n_idx
        }));
    }

    fn sync_helper_lines(&mut self, lines: &[EdgeVertexRaw]) {
        let max = self.max_buffer_bytes;
        self.helper_lines.upload(&self.device, &self.queue, lines, max);
    }

    fn sync_lighting(&mut self, light: &SceneLightUniformRaw) {
        self.queue
            .write_buffer(&self.light_buffer, 0, bytemuck::bytes_of(light));
    }

    fn set_clear_color(&mut self, rgba: [f32; 4]) {
        self.clear_color = wgpu::Color {
            r: rgba[0] as f64,
            g: rgba[1] as f64,
            b: rgba[2] as f64,
            a: rgba[3] as f64,
        };
    }

    fn sync_chart(&mut self, layers: &ChartLayers<'_>) {
        self.depth_3d = layers.depth_3d;
        self.series_clip = layers.series_clip;
        let written = chart_layer_bytes(layers);
        self.counters.chart_upload_bytes = written;
        self.counters.chart_upload_total += written;
        self.counters.chart_uploads += u64::from(written > 0);
        let (device, queue, max) = (&self.device, &self.queue, self.max_buffer_bytes);
        if let Some(v) = layers.underlay {
            self.chart_underlay.upload(device, queue, v, max);
        }
        if let Some(v) = layers.bars {
            self.chart_bars.upload(device, queue, v, max);
        }
        if let Some(v) = layers.series {
            self.chart_series.upload(device, queue, v, max);
        }
        if let Some(l) = &layers.series_style {
            self.chart_series_dashed.upload(device, queue, l.dashed, max);
            self.chart_series_markers.upload(device, queue, l.markers, max);
        }
        if let Some(v) = layers.overlay {
            self.chart_overlay.upload(device, queue, v, max);
        }
        if let Some(v) = layers.markers {
            self.chart_markers.upload(device, queue, v, max);
        }
        if let Some(v) = layers.fills {
            self.chart_fills.upload(device, queue, v, max);
        } else if let Some(p) = &layers.fill_patch {
            self.chart_fills.write_ranges(queue, p.fills, p.ranges);
        }
        if let Some(v) = layers.contours_3d {
            self.chart_contours_3d.upload(device, queue, v, max);
        }
        if let Some(style) = &layers.fill_style {
            queue.write_buffer(&self.fill_style_buffer, 0, bytemuck::bytes_of(style));
        }
        if let Some(v) = layers.points {
            self.chart_points.upload(device, queue, v, max);
        }
        if let Some(l) = &layers.annotations_below {
            self.annotations_below.upload(device, queue, l, max);
        }
        if let Some(l) = &layers.annotations_above {
            self.annotations_above.upload(device, queue, l, max);
        }
        if let Some(l) = &layers.brush {
            self.brush.upload(device, queue, l, max);
        }
        if let Some(l) = &layers.navigator {
            self.navigator.upload(device, queue, l, max);
        }
        if let Some(l) = &layers.navigator_window {
            self.navigator_window.upload(device, queue, l, max);
        }
        // Grid before style: the style's texture width comes from the (re)created grid texture
        if let Some(grid) = &layers.heatmap {
            self.heatmap.upload_grid(device, queue, &self.camera_buffer, grid);
        }
        if let Some(lut) = layers.heatmap_lut {
            self.heatmap.upload_lut(queue, lut);
        }
        if let Some(style) = layers.heatmap_style {
            self.heatmap.upload_style(queue, style);
        }
        if let Some(style) = &layers.point_style {
            queue.write_buffer(&self.point_style_buffer, 0, bytemuck::bytes_of(style));
            self.point_emphasis = style.emphasized_slot().is_some();
        }
    }

    fn render_frame(&mut self, camera: &CameraUniformRaw) {
        self.counters.frames += 1;
        self.queue
            .write_buffer(&self.camera_buffer, 0, bytemuck::bytes_of(camera));

        let Some(output) = self.acquire_frame() else {
            return;
        };

        let view = output
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("charturbo-render-encoder"),
            });

        {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("charturbo-main-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &view,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(self.clear_color),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: &self.depth_view,
                    depth_ops: Some(wgpu::Operations {
                        // Reversed-Z clears to the far plane (0)
                        load: wgpu::LoadOp::Clear(0.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });

            let cam = &self.camera_bind_group;
            let fill = &self.fill_bind_group;

            // 1. Opaque scene meshes (one instanced draw per mesh)
            self.draw_meshes(&mut rpass, false);

            // 2. Chart marks: gridlines, bars, fills, series strokes, scatter points
            draw_quads(&mut rpass, &self.segment_pipeline, cam, &self.chart_underlay);
            // Heatmap cells: one quad, every cell resolved in the fragment shader
            if self.heatmap.active {
                rpass.set_pipeline(&self.heatmap_pipeline);
                rpass.set_bind_group(0, &self.heatmap.bind_group, &[]);
                rpass.draw(0..6, 0..1);
            }
            // Annotations below the series: bands, reference lines, markers (clipped on the CPU)
            let below = &self.annotations_below;
            draw_fills(&mut rpass, &self.fill_pipeline, fill, &below.fills);
            draw_quads(&mut rpass, &self.segment_pipeline, cam, &below.lines);
            draw_quads(&mut rpass, &self.marker_pipeline, cam, &below.markers);
            // Zoomed bars (candlesticks) / fills / series / points are clipped to the plot rectangle
            let (vw, vh) = (self.config.width, self.config.height);
            let clip = self.series_clip.and_then(|[x, y, w, h]| {
                let (x, y) = (x.min(vw), y.min(vh));
                let (w, h) = (w.min(vw - x), h.min(vh - y));
                (w > 0 && h > 0).then_some((x, y, w, h))
            });
            if let Some((x, y, w, h)) = clip {
                rpass.set_scissor_rect(x, y, w, h);
            }
            draw_quads(&mut rpass, &self.bar_pipeline, cam, &self.chart_bars);
            draw_fills(&mut rpass, if self.depth_3d { &self.fill_3d_pipeline } else { &self.fill_pipeline }, fill, &self.chart_fills);
            draw_fills(&mut rpass, &self.contour_3d_pipeline, fill, &self.chart_contours_3d);
            draw_quads(&mut rpass, &self.segment_pipeline, cam, &self.chart_series);
            // Dashed series strokes, then series point markers over the strokes
            draw_quads(&mut rpass, &self.dash_segment_pipeline, cam, &self.chart_series_dashed);
            draw_quads(&mut rpass, if self.depth_3d { &self.marker_3d_pipeline } else { &self.marker_pipeline }, cam, &self.chart_series_markers);
            draw_quads(&mut rpass, &self.point_pipeline, &self.point_bind_group, &self.chart_points);
            if self.point_emphasis && self.chart_points.len > 0 {
                // Second pass (vertices 6..12): only the emphasized series, on top
                rpass.draw(6..12, 0..self.chart_points.len);
            }
            // Annotations above the series (no depth test: always over bars / strokes / points)
            let above = &self.annotations_above;
            draw_fills(&mut rpass, &self.fill_overlay_pipeline, fill, &above.fills);
            draw_quads(&mut rpass, &self.segment_overlay_pipeline, cam, &above.lines);
            draw_quads(&mut rpass, &self.marker_pipeline, cam, &above.markers);
            // Brush / selection band over everything in the plot (no depth test)
            draw_fills(&mut rpass, &self.fill_overlay_pipeline, fill, &self.brush.fills);
            draw_quads(&mut rpass, &self.segment_overlay_pipeline, cam, &self.brush.lines);
            if clip.is_some() {
                rpass.set_scissor_rect(0, 0, vw, vh);
            }
            // Navigator below the plot (unclipped): strip, then the zoom window over it
            for nav in [&self.navigator, &self.navigator_window] {
                draw_fills(&mut rpass, &self.fill_overlay_pipeline, fill, &nav.fills);
                draw_quads(&mut rpass, &self.segment_overlay_pipeline, cam, &nav.lines);
            }

            // 3. Opaque nodes write depth first, so edges are hidden only where a node is in front
            if self.opaque_nodes > 0 {
                rpass.set_pipeline(&self.node_pipeline);
                rpass.set_bind_group(0, cam, &[]);
                rpass.set_vertex_buffer(0, self.nodes.slice());
                rpass.draw(0..6, 0..self.opaque_nodes);
            }

            // 4. Graph edges and scene helper lines (depth-tested, no depth writes)
            for lines in [&self.edges, &self.helper_lines] {
                if lines.len > 0 {
                    rpass.set_pipeline(&self.edge_pipeline);
                    rpass.set_bind_group(0, cam, &[]);
                    rpass.set_vertex_buffer(0, lines.slice());
                    rpass.draw(0..lines.len, 0..1);
                }
            }

            // 5. Translucent nodes without depth writes
            if self.nodes.len > self.opaque_nodes {
                rpass.set_pipeline(&self.node_translucent_pipeline);
                rpass.set_bind_group(0, cam, &[]);
                rpass.set_vertex_buffer(0, self.nodes.slice());
                rpass.draw(0..6, self.opaque_nodes..self.nodes.len);
            }

            // 6. Translucent scene meshes (sorted back-to-front on the CPU)
            self.draw_meshes(&mut rpass, true);

            // 7. Chart hover overlays always on top
            draw_quads(&mut rpass, &self.segment_overlay_pipeline, cam, &self.chart_overlay);
            draw_quads(&mut rpass, &self.marker_pipeline, cam, &self.chart_markers);
        }

        self.queue.submit(std::iter::once(encoder.finish()));
        output.present();
        self.finish_frame();
    }

    fn stats(&self) -> RenderStats {
        let arrays = [
            &self.nodes,
            &self.edges,
            &self.helper_lines,
            &self.mesh_vertices,
            &self.mesh_indices,
            &self.mesh_instances,
            &self.chart_underlay,
            &self.chart_bars,
            &self.chart_series,
            &self.chart_series_dashed,
            &self.chart_series_markers,
            &self.chart_overlay,
            &self.chart_markers,
            &self.chart_fills,
            &self.chart_contours_3d,
            &self.chart_points,
        ];
        let layers = [&self.annotations_below, &self.annotations_above, &self.brush, &self.navigator, &self.navigator_window];
        let gpu_bytes = arrays.iter().map(|a| a.capacity_bytes).sum::<u64>()
            + layers.iter().map(|l| l.fills.capacity_bytes + l.lines.capacity_bytes + l.markers.capacity_bytes).sum::<u64>()
            + self.heatmap.texture_bytes()
            + self.gpu_physics.as_ref().map_or(0, |g| g.bytes());
        RenderStats {
            gpu_bytes,
            series_segments: self.chart_series.len + self.chart_series_dashed.len,
            points: self.chart_points.len,
            bars: self.chart_bars.len,
            fill_vertices: self.chart_fills.len,
            markers: self.chart_markers.len + self.chart_series_markers.len,
            ..self.counters
        }
    }

    fn resize(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 || (width == self.config.width && height == self.config.height) {
            return;
        }
        self.config.width = width;
        self.config.height = height;
        // The WebGL2 shared canvas is resized lazily, right before this engine's next frame
        match &self.target {
            PresentTarget::Surface(surface) => surface.configure(&self.device, &self.config),
            #[cfg(all(target_arch = "wasm32", feature = "webgl"))]
            PresentTarget::Blit { .. } => {}
        }
        self.depth_view = Self::create_depth_view(&self.device, width, height);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_engines_start_with_small_buffers() {
        let labels: Vec<&str> = ENGINE_ARRAYS.iter().map(|(l, ..)| *l).collect();
        let mut unique = labels.clone();
        unique.dedup();
        assert_eq!(unique.len(), labels.len(), "labels are unique");
        // Default engines keep their previous initial capacities (e.g. 8192 series segments)
        assert_eq!(initial_array_bytes("chart-series", false), 8192 * 48);
        assert_eq!(initial_array_bytes("chart-series", true), 16 * 48);
        // A 120 x 30 px sparkline at DPR 2 (240 x 60 backing pixels)
        let compact = engine_gpu_bytes(true, 240, 60);
        let full = engine_gpu_bytes(false, 240, 60);
        println!("GPU bytes per 240x60 engine: compact {compact}, default {full}");
        assert!(compact < 96 * 1024, "compact engine: {compact} bytes");
        assert!(full > 10 * compact, "default {full} vs compact {compact}");
        // 200 sparklines on one shared device stay around 16 MB of per-engine GPU memory
        assert!(200 * compact < 20 * 1024 * 1024);
    }
}
