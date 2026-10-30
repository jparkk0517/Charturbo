//! Directional-light shadow mapping on the GPU: the lazily compiled depth-only caster pipeline
//! and shadow-receiving mesh variants (shared per device + format, like `LazyMeshPbr`), and the
//! per-engine shadow map, created on enable, recreated on a size change and dropped on disable.

use super::*;
use crate::renderer::shader::{mesh_shadow_depth_wgsl, mesh_shadowed_wgsl};
use crate::renderer::{ShadowFrame, ShadowUniformRaw};

/// Shadow map depth format (WebGPU and WebGL2 both sample it with a comparison sampler).
pub(super) const SHADOW_DEPTH_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Depth32Float;

/// Opaque / translucent receiving pipelines of one shading model.
pub(super) struct ShadowedMeshPipelines {
    pub opaque: wgpu::RenderPipeline,
    pub translucent: wgpu::RenderPipeline,
}

/// Bind group layouts + the depth pass and classic receivers (built on the first shadowed
/// frame); the PBR receivers are built on the first shadowed PBR frame.
pub(super) struct ShadowPipelines {
    /// Depth pass group 0: the shadow uniform (vertex stage)
    pub pass_bgl: wgpu::BindGroupLayout,
    /// Receiver group (2 classic / 3 PBR): uniform, depth map, comparison sampler
    pub receive_bgl: wgpu::BindGroupLayout,
    pub depth: wgpu::RenderPipeline,
    pub classic: ShadowedMeshPipelines,
    pub pbr: OnceCell<ShadowedMeshPipelines>,
}

/// What `ShadowPipelines` are built from, plus the once-built pipelines.
pub(crate) struct LazyShadow {
    pub(super) format: wgpu::TextureFormat,
    pub(super) mesh_bgl: wgpu::BindGroupLayout,
    pub(super) texture_bgl: wgpu::BindGroupLayout,
    pub(super) pipelines: OnceCell<ShadowPipelines>,
}

fn mesh_buffers() -> [wgpu::VertexBufferLayout<'static>; 2] {
    [
        layout_of::<MeshVertexRaw>(wgpu::VertexStepMode::Vertex, &ATTRS_2),
        layout_of::<MeshInstanceRaw>(wgpu::VertexStepMode::Instance, &MESH_INSTANCE_ATTRS),
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
            let receive_bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("shadow-receive-bgl"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Buffer {
                            ty: wgpu::BufferBindingType::Uniform,
                            has_dynamic_offset: false,
                            min_binding_size: None,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            sample_type: wgpu::TextureSampleType::Depth,
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Comparison),
                        count: None,
                    },
                ],
            });

            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("mesh-shadow-depth-shader"),
                source: wgpu::ShaderSource::Wgsl(mesh_shadow_depth_wgsl().into()),
            });
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("mesh-shadow-depth-layout"),
                bind_group_layouts: &[&pass_bgl, &self.texture_bgl],
                push_constant_ranges: &[],
            });
            let buffers = mesh_buffers();
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
            let classic = self.receivers(device, &receive_bgl, false);
            ShadowPipelines {
                pass_bgl,
                receive_bgl,
                depth,
                classic,
                pbr: OnceCell::new(),
            }
        })
    }

    /// Receiving pipelines: classic layout `[mesh, base map, shadow]`, PBR `[mesh, base map,
    /// env map, shadow]` (4 groups: the WebGL2 limit).
    fn receivers(
        &self,
        device: &wgpu::Device,
        receive_bgl: &wgpu::BindGroupLayout,
        pbr: bool,
    ) -> ShadowedMeshPipelines {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some(if pbr {
                "mesh-pbr-shadowed-shader"
            } else {
                "mesh-shadowed-shader"
            }),
            source: wgpu::ShaderSource::Wgsl(mesh_shadowed_wgsl(pbr).into()),
        });
        let groups: Vec<&wgpu::BindGroupLayout> = if pbr {
            vec![
                &self.mesh_bgl,
                &self.texture_bgl,
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
        let buffers = mesh_buffers();
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
            opaque: create_pipeline(device, self.format, spec("mesh-shadowed-opaque", true)),
            translucent: create_pipeline(
                device,
                self.format,
                spec("mesh-shadowed-translucent", false),
            ),
        }
    }

    /// The receiving pipelines of a shading model (PBR built on first use).
    pub(super) fn receiving(&self, device: &wgpu::Device, pbr: bool) -> &ShadowedMeshPipelines {
        let p = self.get(device);
        if pbr {
            p.pbr
                .get_or_init(|| self.receivers(device, &p.receive_bgl, true))
        } else {
            &p.classic
        }
    }
}

/// One engine's shadow map and its bind groups.
pub(super) struct ShadowMap {
    pub size: u32,
    _texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub uniform: wgpu::Buffer,
    /// Depth pass group 0
    pub pass_bind_group: wgpu::BindGroup,
    /// Receiver group (2 classic / 3 PBR)
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
        // Linear filtering of the comparison results: bilinear PCF per tap
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("shadow-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Nearest,
            compare: Some(wgpu::CompareFunction::GreaterEqual),
            ..Default::default()
        });
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
            layout: &pipes.receive_bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        Self {
            size,
            _texture: texture,
            view,
            uniform,
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

impl WgpuRenderBackend {
    /// Creates / resizes / drops the shadow map for this frame and uploads its uniform.
    pub(super) fn apply_shadows(&mut self, frame: Option<&ShadowFrame>) {
        let Some(frame) = frame else {
            self.shadow_map = None;
            return;
        };
        let size = frame
            .map_size
            .clamp(1, self.device.limits().max_texture_dimension_2d);
        if self.shadow_map.as_ref().map(|m| m.size) != Some(size) {
            self.shadow_map = None;
            let pipes = self.shadow.get(&self.device);
            self.shadow_map = Some(ShadowMap::new(&self.device, pipes, size));
        }
        if let Some(map) = &self.shadow_map {
            self.queue
                .write_buffer(&map.uniform, 0, bytemuck::bytes_of(&frame.uniform));
        }
    }

    /// Depth-only pass of the opaque casters (each draw's leading `shadow_instances`) into the
    /// shadow map; also clears it when nothing casts.
    pub(super) fn encode_shadow_pass(&self, encoder: &mut wgpu::CommandEncoder) {
        let (Some(map), Some(pipes)) = (&self.shadow_map, self.shadow.pipelines.get()) else {
            return;
        };
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("charturbo-shadow-pass"),
            color_attachments: &[],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: &map.view,
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
                rpass.set_bind_group(0, &map.pass_bind_group, &[]);
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
        let map = self.shadow_map.as_ref()?;
        let pipes = self.shadow.pipelines.get()?;
        let (p, group) = if self.pbr {
            (pipes.pbr.get()?, 3)
        } else {
            (&pipes.classic, 2)
        };
        Some((
            if translucent {
                &p.translucent
            } else {
                &p.opaque
            },
            group,
            &map.receive_bind_group,
        ))
    }
}
