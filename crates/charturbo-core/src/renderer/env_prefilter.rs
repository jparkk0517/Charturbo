//! HDR environment maps, GPU side: the `Rgba16Float` upload and the one-time prefilter at
//! creation (`TextureRegistry::create_environment_rgb`). The source (downsampled to at most
//! `MAX_ENV_BASE_WIDTH`) gets a temporary box-filtered mip chain, then every mip `i` of the
//! stored chain is rendered by `fs_env_prefilter` for GGX roughness `i / (levels - 1)` and the
//! temporary source is destroyed. Devices that cannot render into `Rgba16Float` (WebGL2
//! without `EXT_color_buffer_float`) get a CPU box-filtered chain instead (blurrier, not GGX
//! shaped). The SH diffuse irradiance is computed on the CPU in both cases.

use super::env_map;
use super::shader::ENV_PREFILTER_WGSL;
use super::texture::{mip_level_count, GpuTexture, TextureRegistry};

/// Storage format of HDR environment maps: filterable on WebGPU and WebGL2 alike.
pub const ENV_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

/// Prefilter pipelines (built on the first HDR environment of an engine).
pub(crate) struct EnvPrefilter {
    downsample: wgpu::RenderPipeline,
    prefilter: wgpu::RenderPipeline,
    bgl: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

impl EnvPrefilter {
    fn new(device: &wgpu::Device) -> Self {
        let frag = wgpu::ShaderStages::FRAGMENT;
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("env-prefilter-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: frag,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: frag,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: frag,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
            ],
        });
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("env-prefilter-layout"),
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("env-prefilter-shader"),
            source: wgpu::ShaderSource::Wgsl(ENV_PREFILTER_WGSL.into()),
        });
        let pipeline = |label, fs| {
            device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
                label: Some(label),
                layout: Some(&layout),
                vertex: wgpu::VertexState {
                    module: &shader,
                    entry_point: Some("vs_env"),
                    buffers: &[],
                    compilation_options: Default::default(),
                },
                fragment: Some(wgpu::FragmentState {
                    module: &shader,
                    entry_point: Some(fs),
                    targets: &[Some(wgpu::ColorTargetState {
                        format: ENV_FORMAT,
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
            })
        };
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("env-prefilter-sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            downsample: pipeline("env-downsample-pipeline", "fs_env_downsample"),
            prefilter: pipeline("env-prefilter-pipeline", "fs_env_prefilter"),
            bgl,
            sampler,
        }
    }
}

fn create_env_texture(
    device: &wgpu::Device,
    label: &str,
    width: u32,
    height: u32,
    levels: u32,
    render: bool,
) -> wgpu::Texture {
    let mut usage = wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST;
    if render {
        usage |= wgpu::TextureUsages::RENDER_ATTACHMENT;
    }
    device.create_texture(&wgpu::TextureDescriptor {
        label: Some(label),
        size: wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        mip_level_count: levels,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: ENV_FORMAT,
        usage,
        view_formats: &[],
    })
}

fn write_level(
    queue: &wgpu::Queue,
    texture: &wgpu::Texture,
    level: u32,
    width: u32,
    height: u32,
    rgb: &[f32],
) {
    queue.write_texture(
        wgpu::TexelCopyTextureInfo {
            texture,
            mip_level: level,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &env_map::pack_rgba16f(rgb),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(width * 8),
            rows_per_image: Some(height),
        },
        wgpu::Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
    );
}

fn level_view(texture: &wgpu::Texture, base: u32, count: Option<u32>) -> wgpu::TextureView {
    texture.create_view(&wgpu::TextureViewDescriptor {
        label: Some("env-mip"),
        base_mip_level: base,
        mip_level_count: count,
        ..Default::default()
    })
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
impl TextureRegistry {
    /// HDR environment map from `width * height` linear RGB texels (equirect, top row = +y);
    /// see the module docs. Validation (size, rgb length, budget) happens before any GPU work.
    pub fn create_environment_rgb(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        rgb: &[f32],
    ) -> Result<u32, String> {
        env_map::check_env_source(width, height, rgb.len())?;
        let (bw, bh) = env_map::env_base_size(width, height);
        let levels = env_map::prefilter_levels(bw, bh);
        let bytes = env_map::env_byte_size(bw, bh, levels);
        self.ledger.plan_bytes(bw, bh, bytes)?;
        let (bw, bh, base) = env_map::env_base(width, height, rgb);
        let sh = env_map::irradiance_sh(bw, bh, &base);
        let texture = if self.float_targets {
            self.prefilter_gpu(device, queue, bw, bh, levels, &base)
        } else {
            Self::box_chain(device, queue, bw, bh, levels, base)
        };
        let bind_group = Self::create_bind_group(device, &self.layout, &self.sampler, &texture);
        // A cached material group may hold the white fallback for this (future) id
        self.materials.clear();
        Ok(self.ledger.insert(
            bw,
            bh,
            levels,
            bytes,
            GpuTexture {
                texture,
                bind_group,
                env_sh: Some(Box::new(sh)),
            },
        ))
    }

    /// CPU fallback: the 2 x 2 box chain of `base`, uploaded level by level.
    fn box_chain(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        levels: u32,
        base: Vec<f32>,
    ) -> wgpu::Texture {
        let texture = create_env_texture(device, "env-map-box", width, height, levels, false);
        let (mut w, mut h, mut data) = (width, height, base);
        for level in 0..levels {
            write_level(queue, &texture, level, w, h, &data);
            if level + 1 < levels {
                (w, h, data) = env_map::downsample_rgb(w, h, &data);
            }
        }
        texture
    }

    fn prefilter_gpu(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        levels: u32,
        base: &[f32],
    ) -> wgpu::Texture {
        use wgpu::util::DeviceExt;
        let pf = self
            .prefilter
            .get_or_insert_with(|| EnvPrefilter::new(device));
        let src_levels = mip_level_count(width, height);
        let src = create_env_texture(device, "env-map-source", width, height, src_levels, true);
        write_level(queue, &src, 0, width, height, base);
        let out = create_env_texture(device, "env-map-prefiltered", width, height, levels, true);
        let params = |p: [f32; 4]| {
            device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("env-prefilter-params"),
                contents: bytemuck::cast_slice(&p),
                usage: wgpu::BufferUsages::UNIFORM,
            })
        };
        let bind = |view: &wgpu::TextureView, buffer: &wgpu::Buffer| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("env-prefilter-bg"),
                layout: &pf.bgl,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&pf.sampler),
                    },
                    wgpu::BindGroupEntry {
                        binding: 2,
                        resource: buffer.as_entire_binding(),
                    },
                ],
            })
        };
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("env-prefilter"),
        });
        let mut pass = |target: &wgpu::TextureView,
                        pipeline: &wgpu::RenderPipeline,
                        group: &wgpu::BindGroup| {
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("env-prefilter-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: target,
                    resolve_target: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            rpass.set_pipeline(pipeline);
            rpass.set_bind_group(0, group, &[]);
            rpass.draw(0..3, 0..1);
        };
        // 1. Box mips of the source (each level read through a single-level view)
        let unused = params([0.0; 4]);
        for level in 1..src_levels {
            let group = bind(&level_view(&src, level - 1, Some(1)), &unused);
            pass(&level_view(&src, level, Some(1)), &pf.downsample, &group);
        }
        // 2. GGX convolution per stored mip, sampling the whole source chain
        let src_all = level_view(&src, 0, None);
        for level in 0..levels {
            let roughness = env_map::level_roughness(level, levels);
            let buffer = params([roughness, src_levels as f32, width as f32, height as f32]);
            let group = bind(&src_all, &buffer);
            pass(&level_view(&out, level, Some(1)), &pf.prefilter, &group);
        }
        queue.submit(Some(encoder.finish()));
        // Frees the temporary source once the submitted passes are done with it
        src.destroy();
        out
    }
}
