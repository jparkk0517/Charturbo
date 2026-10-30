//! Directional- and point-light shadow mapping on the GPU: the lazily compiled depth-only caster
//! pipeline and shadow-receiving mesh variants (shared per device + format, like `LazyMeshPbr`),
//! and the per-engine shadow map / point-light cube map, each created on enable, recreated on a
//! size change and dropped on disable.

use super::*;
use crate::renderer::shader::{mesh_shadow_depth_wgsl, mesh_shadowed_variant_wgsl};
use crate::renderer::{PointShadowFrame, PointShadowUniformRaw, ShadowFrame, ShadowUniformRaw};

/// Shadow map depth format (WebGPU and WebGL2 both sample it with a comparison sampler).
pub(super) const SHADOW_DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// Which lights' shadows the receivers sample: the shadow group holds the directional map at
/// bindings 0..2 and / or the point-light cube map at 3..5.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ShadowVariant {
    Dir = 0,
    Point = 1,
    Both = 2,
}

impl ShadowVariant {
    pub(super) fn of(dir: bool, point: bool) -> Option<Self> {
        match (dir, point) {
            (true, false) => Some(Self::Dir),
            (false, true) => Some(Self::Point),
            (true, true) => Some(Self::Both),
            (false, false) => None,
        }
    }

    fn dir(self) -> bool {
        self != Self::Point
    }

    fn point(self) -> bool {
        self != Self::Dir
    }
}

/// Bytes between the six face uniforms of the point-light depth passes (WebGPU's largest
/// allowed uniform offset alignment)
const POINT_FACE_STRIDE: u64 = 256;

/// Opaque / translucent receiving pipelines of one shading model.
pub(super) struct ShadowedMeshPipelines {
    pub opaque: wgpu::RenderPipeline,
    pub translucent: wgpu::RenderPipeline,
}

/// Bind group layouts + the depth pass (built on the first shadowed frame); the receivers of a
/// shading model, main-pass sample count (`msaa_slot`) and `ShadowVariant` on their first
/// shadowed frame. The depth passes are always single-sampled.
pub(super) struct ShadowPipelines {
    /// Depth pass group 0: the shadow uniform (vertex stage)
    pub pass_bgl: wgpu::BindGroupLayout,
    /// Receiver group (2 classic / 3 PBR) per `ShadowVariant`: directional uniform, depth map,
    /// comparison sampler (0..2) and / or point uniform, depth cube, comparison sampler (3..5)
    pub receive_bgl: [wgpu::BindGroupLayout; 3],
    pub depth: wgpu::RenderPipeline,
    /// `[variant][msaa slot]`
    pub classic: [[OnceCell<ShadowedMeshPipelines>; 2]; 3],
    pub pbr: [[OnceCell<ShadowedMeshPipelines>; 2]; 3],
}

fn fragment_entry(binding: u32, ty: wgpu::BindingType) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty,
        count: None,
    }
}

/// Receiver bindings of the directional map (0..2) or the point-light cube map (3..5).
fn receive_layout_entries(point: bool) -> [wgpu::BindGroupLayoutEntry; 3] {
    let first = if point { 3 } else { 0 };
    [
        fragment_entry(
            first,
            wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
        ),
        fragment_entry(
            first + 1,
            wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Depth,
                view_dimension: if point {
                    wgpu::TextureViewDimension::Cube
                } else {
                    wgpu::TextureViewDimension::D2
                },
                multisampled: false,
            },
        ),
        fragment_entry(
            first + 2,
            wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
        ),
    ]
}

/// Comparison sampler of both maps: linear filtering of the comparison results (bilinear PCF
/// per tap); reversed-Z, so lit where the reference is at least the stored depth.
fn comparison_sampler(device: &wgpu::Device, label: &str) -> wgpu::Sampler {
    device.create_sampler(&wgpu::SamplerDescriptor {
        label: Some(label),
        address_mode_u: wgpu::AddressMode::ClampToEdge,
        address_mode_v: wgpu::AddressMode::ClampToEdge,
        address_mode_w: wgpu::AddressMode::ClampToEdge,
        mag_filter: wgpu::FilterMode::Linear,
        min_filter: wgpu::FilterMode::Linear,
        mipmap_filter: wgpu::FilterMode::Nearest,
        compare: Some(wgpu::CompareFunction::GreaterEqual),
        ..Default::default()
    })
}

/// What `ShadowPipelines` are built from, plus the once-built pipelines.
pub(crate) struct LazyShadow {
    pub(super) format: wgpu::TextureFormat,
    pub(super) mesh_bgl: wgpu::BindGroupLayout,
    pub(super) texture_bgl: wgpu::BindGroupLayout,
    /// PBR receivers' group 1 (base + material maps)
    pub(super) material_bgl: wgpu::BindGroupLayout,
    pub(super) pipelines: OnceCell<ShadowPipelines>,
}

/// Vertex + instance buffers; the PBR shaders also read the map parameters / emission.
fn mesh_buffers(pbr: bool) -> [wgpu::VertexBufferLayout<'static>; 2] {
    let attrs: &'static [wgpu::VertexAttribute] = if pbr { &MESH_PBR_INSTANCE_ATTRS } else { &MESH_INSTANCE_ATTRS };
    [
        layout_of::<MeshVertexRaw>(wgpu::VertexStepMode::Vertex, &ATTRS_2),
        layout_of::<MeshInstanceRaw>(wgpu::VertexStepMode::Instance, attrs),
    ]
}

impl LazyShadow {
    pub(super) fn get(&self, device: &wgpu::Device) -> &ShadowPipelines {
        self.pipelines.get_or_init(|| {
            let pass_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("shadow-pass-bgl"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
            let [d0, d1, d2] = receive_layout_entries(false);
            let [p0, p1, p2] = receive_layout_entries(true);
            let bgl = |label, entries: &[wgpu::BindGroupLayoutEntry]| {
                device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some(label),
                    entries,
                })
            };
            let receive_bgl = [
                bgl("shadow-receive-bgl", &[d0, d1, d2]),
                bgl("point-shadow-receive-bgl", &[p0, p1, p2]),
                bgl("both-shadow-receive-bgl", &[d0, d1, d2, p0, p1, p2]),
            ];

            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("mesh-shadow-depth-shader"),
                source: wgpu::ShaderSource::Wgsl(mesh_shadow_depth_wgsl().into()),
            });
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("mesh-shadow-depth-layout"),
                bind_group_layouts: &[&pass_bgl, &self.texture_bgl],
                push_constant_ranges: &[],
            });
            let buffers = mesh_buffers(false);
            // Depth only (no color target), reversed-Z like the main pass, both faces drawn
            let depth = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("mesh-shadow-depth"),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_shadow"),
                    buffers: &buffers,
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs_shadow"),
                    targets: &[],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: Some(wgpu::DepthStencilState {
                    format: SHADOW_DEPTH_FORMAT,
                    depth_write_enabled: true,
                    depth_compare: DEPTH_TEST,
                    stencil: wgpu::StencilState::default(),
                    bias: wgpu::DepthBiasState::default(),
                }),
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            });
            ShadowPipelines {
                pass_bgl,
                receive_bgl,
                depth,
                classic: Default::default(),
                pbr: Default::default(),
            }
        })
    }

    /// Receiving pipelines: classic layout `[mesh, base map, shadow]`, PBR `[mesh, material
    /// maps, env map, shadow]` (4 groups: the WebGL2 limit).
    fn receivers(
        &self,
        device: &wgpu::Device,
        receive_bgl: &wgpu::BindGroupLayout,
        pbr: bool,
        samples: u32,
        variant: ShadowVariant,
    ) -> ShadowedMeshPipelines {
        let target = ColorTarget { format: self.format, samples };
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(if pbr {
                "mesh-pbr-shadowed-shader"
            } else {
                "mesh-shadowed-shader"
            }),
            source: wgpu::ShaderSource::Wgsl(
                mesh_shadowed_variant_wgsl(pbr, variant.dir(), variant.point()).into(),
            ),
        });
        let groups: Vec<&wgpu::BindGroupLayout> = if pbr {
            vec![
                &self.mesh_bgl,
                &self.material_bgl,
                &self.texture_bgl,
                receive_bgl,
            ]
        } else {
            vec![&self.mesh_bgl, &self.texture_bgl, receive_bgl]
        };
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("mesh-shadowed-layout"),
            bind_group_layouts: &groups,
            push_constant_ranges: &[],
        });
        let buffers = mesh_buffers(pbr);
        let spec = |label, depth_write| PipelineSpec {
            label,
            layout: &layout,
            shader: &shader,
            vs: "vs_mesh",
            fs: if pbr { "fs_mesh_pbr" } else { "fs_mesh" },
            buffers: &buffers,
            topology: wgpu::PrimitiveTopology::TriangleList,
            depth_write,
            depth_compare: DEPTH_TEST,
        };
        ShadowedMeshPipelines {
            opaque: create_pipeline(device, target, spec("mesh-shadowed-opaque", true)),
            translucent: create_pipeline(
                device,
                target,
                spec("mesh-shadowed-translucent", false),
            ),
        }
    }

    /// The receiving pipelines of a shading model, sample count and variant (built on first use).
    pub(super) fn receiving(
        &self,
        device: &wgpu::Device,
        pbr: bool,
        samples: u32,
        variant: ShadowVariant,
    ) -> &ShadowedMeshPipelines {
        let p = self.get(device);
        let v = variant as usize;
        let cells = if pbr { &p.pbr[v] } else { &p.classic[v] };
        cells[msaa_slot(samples)]
            .get_or_init(|| self.receivers(device, &p.receive_bgl[v], pbr, samples, variant))
    }
}

/// One engine's shadow map and its bind groups.
pub(super) struct ShadowMap {
    pub size: u32,
    _texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub uniform: wgpu::Buffer,
    sampler: wgpu::Sampler,
    /// Depth pass group 0
    pub pass_bind_group: wgpu::BindGroup,
    /// Receiver group (2 classic / 3 PBR) of `ShadowVariant::Dir`
    pub receive_bind_group: wgpu::BindGroup,
}

impl ShadowMap {
    pub(super) fn new(device: &wgpu::Device, pipes: &ShadowPipelines, size: u32) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("shadow-map"),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: SHADOW_DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("shadow-uniform"),
            size: size_of::<ShadowUniformRaw>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sampler = comparison_sampler(device, "shadow-sampler");
        let pass_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("shadow-pass-bg"),
            layout: &pipes.pass_bgl,
            entries: &[wgpu::BindGroupEntry {
                binding: 0,
                resource: uniform.as_entire_binding(),
            }],
        });
        let receive_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("shadow-receive-bg"),
            layout: &pipes.receive_bgl[ShadowVariant::Dir as usize],
            entries: &dir_receive_entries(&uniform, &view, &sampler),
        });
        Self {
            size,
            _texture: texture,
            view,
            uniform,
            sampler,
            pass_bind_group,
            receive_bind_group,
        }
    }

    /// Depth texture + uniform bytes.
    pub(super) fn bytes(&self) -> u64 {
        shadow_map_bytes(self.size)
    }
}

pub(super) fn shadow_map_bytes(size: u32) -> u64 {
    size as u64 * size as u64 * 4 + size_of::<ShadowUniformRaw>() as u64
}

fn receive_bind_entries<'a>(
    first: u32,
    uniform: &'a wgpu::Buffer,
    view: &'a wgpu::TextureView,
    sampler: &'a wgpu::Sampler,
) -> [wgpu::BindGroupEntry<'a>; 3] {
    [
        wgpu::BindGroupEntry {
            binding: first,
            resource: uniform.as_entire_binding(),
        },
        wgpu::BindGroupEntry {
            binding: first + 1,
            resource: wgpu::BindingResource::TextureView(view),
        },
        wgpu::BindGroupEntry {
            binding: first + 2,
            resource: wgpu::BindingResource::Sampler(sampler),
        },
    ]
}

fn dir_receive_entries<'a>(
    uniform: &'a wgpu::Buffer,
    view: &'a wgpu::TextureView,
    sampler: &'a wgpu::Sampler,
) -> [wgpu::BindGroupEntry<'a>; 3] {
    receive_bind_entries(0, uniform, view, sampler)
}

/// One engine's point-light depth cube map (`Depth32Float`, 6 square layers: a cube texture on
/// WebGPU and `TEXTURE_CUBE_MAP` on WebGL2) with its face cameras and bind groups.
pub(super) struct PointShadowMap {
    pub size: u32,
    _texture: wgpu::Texture,
    cube: wgpu::TextureView,
    /// Render attachment of each face (layer order +x, -x, +y, -y, +z, -z)
    faces: Vec<wgpu::TextureView>,
    /// The six face cameras, `POINT_FACE_STRIDE` apart
    face_uniforms: wgpu::Buffer,
    /// Depth pass group 0 of each face
    pass_bind_groups: Vec<wgpu::BindGroup>,
    uniform: wgpu::Buffer,
    sampler: wgpu::Sampler,
    /// Receiver group (2 classic / 3 PBR) of `ShadowVariant::Point`
    receive_bind_group: wgpu::BindGroup,
}

impl PointShadowMap {
    pub(super) fn new(device: &wgpu::Device, pipes: &ShadowPipelines, size: u32) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("point-shadow-cube"),
            size: wgpu::Extent3d {
                width: size,
                height: size,
                depth_or_array_layers: 6,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: SHADOW_DEPTH_FORMAT,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        });
        let cube = texture.create_view(&wgpu::TextureViewDescriptor {
            label: Some("point-shadow-cube-view"),
            dimension: Some(wgpu::TextureViewDimension::Cube),
            ..Default::default()
        });
        let faces = (0..6)
            .map(|layer| {
                texture.create_view(&wgpu::TextureViewDescriptor {
                    label: Some("point-shadow-face"),
                    dimension: Some(wgpu::TextureViewDimension::D2),
                    base_array_layer: layer,
                    array_layer_count: Some(1),
                    ..Default::default()
                })
            })
            .collect();
        let face_size = size_of::<ShadowUniformRaw>() as u64;
        let face_uniforms = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("point-shadow-face-uniforms"),
            size: POINT_FACE_STRIDE * 5 + face_size,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let pass_bind_groups = (0..6u64)
            .map(|face| {
                device.create_bind_group(&wgpu::BindGroupDescriptor {
                    label: Some("point-shadow-pass-bg"),
                    layout: &pipes.pass_bgl,
                    entries: &[wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                            buffer: &face_uniforms,
                            offset: face * POINT_FACE_STRIDE,
                            size: wgpu::BufferSize::new(face_size),
                        }),
                    }],
                })
            })
            .collect();
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("point-shadow-uniform"),
            size: size_of::<PointShadowUniformRaw>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        let sampler = comparison_sampler(device, "point-shadow-sampler");
        let receive_bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("point-shadow-receive-bg"),
            layout: &pipes.receive_bgl[ShadowVariant::Point as usize],
            entries: &receive_bind_entries(3, &uniform, &cube, &sampler),
        });
        Self {
            size,
            _texture: texture,
            cube,
            faces,
            face_uniforms,
            pass_bind_groups,
            uniform,
            sampler,
            receive_bind_group,
        }
    }

    /// Cube texture + face / receiver uniform bytes.
    pub(super) fn bytes(&self) -> u64 {
        point_shadow_map_bytes(self.size)
    }
}

pub(super) fn point_shadow_map_bytes(size: u32) -> u64 {
    6 * size as u64 * size as u64 * 4
        + POINT_FACE_STRIDE * 5
        + size_of::<ShadowUniformRaw>() as u64
        + size_of::<PointShadowUniformRaw>() as u64
}

/// Receiver group of `ShadowVariant::Both`: the directional map (0..2) and the cube map (3..5).
fn both_receive_bind_group(
    device: &wgpu::Device,
    pipes: &ShadowPipelines,
    dir: &ShadowMap,
    point: &PointShadowMap,
) -> wgpu::BindGroup {
    let [d0, d1, d2] = dir_receive_entries(&dir.uniform, &dir.view, &dir.sampler);
    let [p0, p1, p2] = receive_bind_entries(3, &point.uniform, &point.cube, &point.sampler);
    device.create_bind_group(&wgpu::BindGroupDescriptor {
        label: Some("both-shadow-receive-bg"),
        layout: &pipes.receive_bgl[ShadowVariant::Both as usize],
        entries: &[d0, d1, d2, p0, p1, p2],
    })
}

impl WgpuRenderBackend {
    /// Creates / resizes / drops the shadow map for this frame and uploads its uniform.
    pub(super) fn apply_shadows(&mut self, frame: Option<&ShadowFrame>) {
        let Some(frame) = frame else {
            if self.shadow_map.take().is_some() {
                self.shadow_both_bind_group = None;
            }
            return;
        };
        let size = frame
            .map_size
            .clamp(1, self.device.limits().max_texture_dimension_2d);
        if self.shadow_map.as_ref().map(|m| m.size) != Some(size) {
            self.shadow_map = None;
            self.shadow_both_bind_group = None;
            let pipes = self.shadow.get(&self.device);
            self.shadow_map = Some(ShadowMap::new(&self.device, pipes, size));
        }
        if let Some(map) = &self.shadow_map {
            self.queue
                .write_buffer(&map.uniform, 0, bytemuck::bytes_of(&frame.uniform));
        }
    }

    /// Creates / resizes / drops the point-light cube map for this frame and uploads its face
    /// cameras and receiver uniform.
    pub(super) fn apply_point_shadows(&mut self, frame: Option<&PointShadowFrame>) {
        let Some(frame) = frame else {
            if self.point_shadow_map.take().is_some() {
                self.shadow_both_bind_group = None;
            }
            return;
        };
        let size = frame
            .map_size
            .clamp(1, self.device.limits().max_texture_dimension_2d);
        if self.point_shadow_map.as_ref().map(|m| m.size) != Some(size) {
            self.point_shadow_map = None;
            self.shadow_both_bind_group = None;
            let pipes = self.shadow.get(&self.device);
            self.point_shadow_map = Some(PointShadowMap::new(&self.device, pipes, size));
        }
        if let Some(map) = &self.point_shadow_map {
            for (face, uniform) in frame.faces.iter().enumerate() {
                self.queue.write_buffer(
                    &map.face_uniforms,
                    face as u64 * POINT_FACE_STRIDE,
                    bytemuck::bytes_of(uniform),
                );
            }
            self.queue
                .write_buffer(&map.uniform, 0, bytemuck::bytes_of(&frame.uniform));
        }
    }

    /// Which maps the receivers sample this frame (`None` = shadows off).
    pub(super) fn shadow_variant(&self) -> Option<ShadowVariant> {
        ShadowVariant::of(self.shadow_map.is_some(), self.point_shadow_map.is_some())
    }

    /// After both maps are applied: the combined receiver group (if both are on) and the
    /// receivers of the selected shading model.
    pub(super) fn prepare_shadow_receivers(&mut self) {
        let Some(variant) = self.shadow_variant() else {
            return;
        };
        let pipes = self.shadow.get(&self.device);
        if let (ShadowVariant::Both, None, Some(dir), Some(point)) = (
            variant,
            &self.shadow_both_bind_group,
            &self.shadow_map,
            &self.point_shadow_map,
        ) {
            self.shadow_both_bind_group =
                Some(both_receive_bind_group(&self.device, pipes, dir, point));
        }
        self.shadow
            .receiving(&self.device, self.pbr, self.samples, variant);
    }

    /// Depth-only passes of the opaque casters (each draw's leading `shadow_instances`) into the
    /// shadow map and the six point-light cube faces; also clears them when nothing casts.
    pub(super) fn encode_shadow_pass(&self, encoder: &mut wgpu::CommandEncoder) {
        let Some(pipes) = self.shadow.pipelines.get() else {
            return;
        };
        if let Some(map) = &self.shadow_map {
            self.encode_casters(
                encoder,
                pipes,
                "charturbo-shadow-pass",
                &map.view,
                &map.pass_bind_group,
            );
        }
        if let Some(map) = &self.point_shadow_map {
            for (view, bind_group) in map.faces.iter().zip(&map.pass_bind_groups) {
                self.encode_casters(
                    encoder,
                    pipes,
                    "charturbo-point-shadow-pass",
                    view,
                    bind_group,
                );
            }
        }
    }

    /// One depth pass of the casters into `view`, seen by the camera of `pass_bind_group`.
    fn encode_casters(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        pipes: &ShadowPipelines,
        label: &str,
        view: &wgpu::TextureView,
        pass_bind_group: &wgpu::BindGroup,
    ) {
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view,
                depth_ops: Some(wgpu::Operations {
                    // Reversed-Z: 0 is the far plane (unshadowed)
                    load: wgpu::LoadOp::Clear(0.0),
                    store: wgpu::StoreOp::Store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        let stride = size_of::<MeshInstanceRaw>() as u64;
        let mut bound = false;
        let mut bound_texture = None;
        for d in self.mesh_draws.iter().filter(|d| !d.translucent) {
            let count = d.shadow_instances.min(d.instance_count);
            if count == 0 || d.index_count == 0 {
                continue;
            }
            if !bound {
                rpass.set_pipeline(&pipes.depth);
                rpass.set_bind_group(0, pass_bind_group, &[]);
                rpass.set_vertex_buffer(0, self.mesh_vertices.slice());
                rpass.set_index_buffer(self.mesh_indices.slice(), wgpu::IndexFormat::Uint32);
                bound = true;
            }
            // The base map's alpha cuts holes into alpha-tested casters
            if bound_texture != Some(d.texture) {
                rpass.set_bind_group(1, self.textures.bind_group(d.texture), &[]);
                bound_texture = Some(d.texture);
            }
            let from = d.first_instance as u64 * stride;
            rpass.set_vertex_buffer(
                1,
                self.mesh_instances
                    .buffer
                    .slice(from..from + count as u64 * stride),
            );
            rpass.draw_indexed(d.first_index..d.first_index + d.index_count, 0, 0..count);
        }
    }

    /// Receiving pipeline + its shadow bind group index while shadows are on.
    pub(super) fn shadowed_pipeline(
        &self,
        translucent: bool,
    ) -> Option<(&wgpu::RenderPipeline, u32, &wgpu::BindGroup)> {
        let variant = self.shadow_variant()?;
        let bind_group = match variant {
            ShadowVariant::Dir => &self.shadow_map.as_ref()?.receive_bind_group,
            ShadowVariant::Point => &self.point_shadow_map.as_ref()?.receive_bind_group,
            ShadowVariant::Both => self.shadow_both_bind_group.as_ref()?,
        };
        let pipes = self.shadow.pipelines.get()?;
        let (slot, v) = (msaa_slot(self.samples), variant as usize);
        let (p, group) = if self.pbr {
            (pipes.pbr[v][slot].get()?, 3)
        } else {
            (pipes.classic[v][slot].get()?, 2)
        };
        Some((
            if translucent {
                &p.translucent
            } else {
                &p.opaque
            },
            group,
            bind_group,
        ))
    }
}
