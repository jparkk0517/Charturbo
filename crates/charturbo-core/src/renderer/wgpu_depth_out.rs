//! GPU side of the depth output pass (`renderer::depth_out`): the lazily built pipeline (shared
//! by the engines of a device + surface format), this engine's uniform + bind group (rebuilt
//! when the depth texture is recreated) and the pass itself: after the main pass (non-post and
//! post paths alike), one fullscreen triangle into the frame, cleared first, reading the 1x
//! `Depth32Float` buffer texel by texel (NEAREST sampler at pixel centers; see `DEPTH_OUT_WGSL`). A separate pass: the depth texture is never attached
//! and sampled at once (no WebGL2 feedback loop). Only at sample count 1 (the engine refuses the
//! depth output with MSAA: WebGL2 cannot sample a multisampled depth buffer).

use super::*;
use crate::renderer::depth_out::{DepthOutFrame, DepthOutUniformRaw, DEPTH_OUT_WGSL};

/// Depth output pipeline of a surface format (built on the first depth output frame).
pub(crate) struct LazyDepthOut {
    format: wgpu::TextureFormat,
    pipeline: OnceCell<DepthOutPipeline>,
}

pub(super) struct DepthOutPipeline {
    bgl: wgpu::BindGroupLayout,
    pipeline: wgpu::RenderPipeline,
    sampler: wgpu::Sampler,
}

impl LazyDepthOut {
    pub(super) fn new(format: wgpu::TextureFormat) -> Self {
        Self {
            format,
            pipeline: OnceCell::new(),
        }
    }

    fn get(&self, device: &wgpu::Device) -> &DepthOutPipeline {
        self.pipeline.get_or_init(|| {
            let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("depth-out-bgl"),
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
                            // Not `Depth`: see `DEPTH_OUT_WGSL` (WebGL2 GLSL translation)
                            sample_type: wgpu::TextureSampleType::Float { filterable: false },
                            view_dimension: wgpu::TextureViewDimension::D2,
                            multisampled: false,
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::NonFiltering),
                        count: None,
                    },
                ],
            });
            // NEAREST everywhere (WebGL2: makes the depth texture complete without comparison)
            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("depth-out-sampler"),
                address_mode_u: wgpu::AddressMode::ClampToEdge,
                address_mode_v: wgpu::AddressMode::ClampToEdge,
                address_mode_w: wgpu::AddressMode::ClampToEdge,
                mag_filter: wgpu::FilterMode::Nearest,
                min_filter: wgpu::FilterMode::Nearest,
                mipmap_filter: wgpu::FilterMode::Nearest,
                ..Default::default()
            });
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("depth-out-layout"),
                bind_group_layouts: &[&bgl],
                push_constant_ranges: &[],
            });
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("depth-out-shader"),
                source: wgpu::ShaderSource::Wgsl(DEPTH_OUT_WGSL.into()),
            });
            let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some("depth-out"),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_depth_out"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some("fs_depth_out"),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: self.format,
                        blend: None,
                        write_mask: wgpu::ColorWrites::ALL,
                    })],
                    compilation_options: Default::default(),
                }),
                primitive: wgpu::PrimitiveState::default(),
                depth_stencil: None,
                multisample: wgpu::MultisampleState::default(),
                multiview: None,
                cache: None,
            });
            DepthOutPipeline { bgl, pipeline, sampler }
        })
    }
}

/// This engine's depth output state while it is on.
pub(super) struct DepthOutState {
    uniform: wgpu::Buffer,
    /// Uniform + the current depth texture (`None` after a resize recreated it)
    group: Option<wgpu::BindGroup>,
}

impl WgpuRenderBackend {
    /// Applies this frame's depth output (`None` = off: the state is dropped). Ignored at a sample
    /// count above 1 (the engine never sends it then).
    pub(super) fn apply_depth_output(&mut self, frame: Option<&DepthOutFrame>) {
        let Some(frame) = frame.filter(|_| self.samples == 1) else {
            self.depth_out = None;
            return;
        };
        self.depth_out_pipes.get(&self.device);
        let device = &self.device;
        let state = self.depth_out.get_or_insert_with(|| DepthOutState {
            uniform: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("depth-out-uniform"),
                size: size_of::<DepthOutUniformRaw>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            group: None,
        });
        let uniform = DepthOutUniformRaw::pack(frame, self.config.format.is_srgb());
        self.queue
            .write_buffer(&state.uniform, 0, bytemuck::bytes_of(&uniform));
    }

    /// The depth texture was recreated (resize): rebind it on the next depth output frame.
    pub(super) fn invalidate_depth_out_group(&mut self) {
        if let Some(state) = &mut self.depth_out {
            state.group = None;
        }
    }

    /// The depth output pass into `frame_view` (after the main pass) when it is on.
    pub(super) fn encode_depth_out(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        frame_view: &wgpu::TextureView,
    ) {
        if self.samples != 1 {
            return;
        }
        let Some(pipes) = self.depth_out_pipes.pipeline.get() else {
            return;
        };
        let Some(state) = &mut self.depth_out else {
            return;
        };
        let device = &self.device;
        let depth_view = &self.depth_view;
        let group = state.group.get_or_insert_with(|| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("depth-out-bg"),
                layout: &pipes.bgl,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: state.uniform.as_entire_binding(),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::TextureView(depth_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: wgpu::BindingResource::Sampler(&pipes.sampler),
                    },
                ],
            })
        });
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("charturbo-depth-out-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: frame_view,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::BLACK),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        rpass.set_pipeline(&pipes.pipeline);
        rpass.set_bind_group(0, &*group, &[]);
        rpass.draw(0..3, 0..1);
    }
}
