//! HDR environment maps, GPU side: the `Rgba16Float` upload and the one-time prefilter at
//! creation (`TextureRegistry::create_environment_rgb`). The source (downsampled to at most
//! `MAX_ENV_BASE_WIDTH`) gets a temporary box-filtered mip chain, then every mip `i` of the
//! stored chain is rendered by `fs_env_prefilter` for GGX roughness `i / (levels - 1)` and the
//! temporary source is destroyed. Devices that cannot render into `Rgba16Float` (WebGL2
//! without `EXT_color_buffer_float`) get a CPU box-filtered chain instead (blurrier, not GGX
//! shaped). The SH diffuse irradiance is computed on the CPU in both cases.
//!
//! All GPU work of a creation runs inside validation + out-of-memory error scopes. wgpu-core
//! (native, WebGL2) reports them synchronously: the texture is destroyed and the creation
//! fails. Browser WebGPU resolves them later: the map is created and its pending check is
//! handed out by `take_env_check` (the wasm `environment_ready` promise); the caller disposes
//! the map when it fails.

use super::env_map;
use super::shader::ENV_PREFILTER_WGSL;
use super::texture::{mip_level_count, GpuTexture, TextureRegistry};
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Poll};

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
    // Tests read the uploaded / prefiltered mips back
    #[cfg(test)]
    {
        usage |= wgpu::TextureUsages::COPY_SRC;
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

/// GPU errors of an environment map creation still in flight (browser WebGPU reports error
/// scopes asynchronously): resolves to the error message, `None` when the map is valid.
pub type EnvCheck = Pin<Box<dyn Future<Output = Option<String>>>>;

/// Polls `check` once without a waker: wgpu-core (native, WebGL2) pops error scopes
/// synchronously, so only browser WebGPU stays pending.
fn poll_now(check: &mut EnvCheck) -> Poll<Option<String>> {
    check
        .as_mut()
        .poll(&mut Context::from_waker(std::task::Waker::noop()))
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
impl TextureRegistry {
    /// HDR environment map from `width * height` linear RGB texels (equirect, top row = +y);
    /// see the module docs. Validation (size, rgb length, budget) happens before any GPU work.
    /// The GPU work (upload, prefilter passes, bind group) runs inside validation and
    /// out-of-memory error scopes: an error reported synchronously destroys the texture and
    /// returns `Err` (nothing is counted); one still pending is kept for `take_env_check`.
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
        device.push_error_scope(wgpu::ErrorFilter::OutOfMemory);
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        #[cfg(test)]
        if self.inject_env_error {
            // A zero-sized texture is a validation error
            let _ = create_env_texture(device, "env-map-invalid", 0, 0, 1, false);
        }
        let texture = if self.float_targets {
            self.prefilter_gpu(device, queue, bw, bh, levels, &base)
        } else {
            Self::box_chain(device, queue, bw, bh, levels, base)
        };
        let bind_group = Self::create_bind_group(device, &self.layout, &self.sampler, &texture);
        let (validation, oom) = (device.pop_error_scope(), device.pop_error_scope());
        let mut check: EnvCheck = Box::pin(async move {
            let error = match validation.await {
                Some(e) => Some(e),
                None => oom.await,
            };
            error.map(|e| format!("GPU error while creating the environment map: {e}"))
        });
        let pending = match poll_now(&mut check) {
            Poll::Ready(Some(error)) => {
                texture.destroy();
                // The prefilter pipelines may be the invalid objects: rebuilt on the next map
                self.prefilter = None;
                return Err(error);
            }
            Poll::Ready(None) => None,
            Poll::Pending => Some(check),
        };
        // A cached material group may hold the white fallback for this (future) id
        self.materials.clear();
        let id = self.ledger.insert(
            bw,
            bh,
            levels,
            bytes,
            GpuTexture {
                texture,
                bind_group,
                env_sh: Some(Box::new(sh)),
            },
        );
        if let Some(check) = pending {
            self.env_checks.insert(id, check);
        }
        Ok(id)
    }

    /// The still pending GPU error check of environment map `id` (taken once; `None` when it
    /// was already resolved at creation, taken before or the id is unknown).
    pub fn take_env_check(&mut self, id: u32) -> Option<EnvCheck> {
        self.env_checks.remove(&id)
    }

    /// CPU fallback: the 2 x 2 box chain of `base` (`env_map::box_chain_levels`), uploaded
    /// level by level.
    fn box_chain(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        levels: u32,
        base: Vec<f32>,
    ) -> wgpu::Texture {
        let texture = create_env_texture(device, "env-map-box", width, height, levels, false);
        for (level, (w, h, data)) in env_map::box_chain_levels(width, height, levels, base)
            .iter()
            .enumerate()
        {
            write_level(queue, &texture, level as u32, *w, *h, data);
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

#[cfg(test)]
mod tests {
    use super::super::gpu_layout::test_device;
    use super::*;

    fn registry(device: &wgpu::Device, queue: &wgpu::Queue, float_targets: bool) -> TextureRegistry {
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("test-mesh-bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let material = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("test-material-bgl"),
            entries: &[],
        });
        TextureRegistry::new(device, queue, layout, material, float_targets)
    }

    fn f16_to_f32(h: u16) -> f32 {
        let (exp, man) = ((h >> 10) & 0x1f, (h & 0x3ff) as f32);
        let v = match exp {
            0 => man * 2f32.powi(-24),
            0x1f => f32::INFINITY,
            e => (1.0 + man / 1024.0) * 2f32.powi(e as i32 - 15),
        };
        if h & 0x8000 != 0 {
            -v
        } else {
            v
        }
    }

    /// Raw `Rgba16Float` bytes of mip `level` of environment map `id` (rows unpadded).
    fn read_level(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        reg: &TextureRegistry,
        id: u32,
        level: u32,
    ) -> Vec<u8> {
        let entry = reg.ledger.get(id).expect("live map");
        let (w, h) = ((entry.width >> level).max(1), (entry.height >> level).max(1));
        let row = w * 8;
        let padded = row.div_ceil(256) * 256;
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("test-env-readback"),
            size: (padded * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture: &entry.value.texture,
                mip_level: level,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded),
                    rows_per_image: Some(h),
                },
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        queue.submit(Some(encoder.finish()));
        buffer.slice(..).map_async(wgpu::MapMode::Read, |r| r.unwrap());
        device.poll(wgpu::Maintain::Wait);
        let data = buffer.slice(..).get_mapped_range();
        data.chunks(padded as usize)
            .flat_map(|r| r[..row as usize].to_vec())
            .collect()
    }

    /// 64 x 32 source: gradients (not constant, so every box mip differs).
    fn gradient() -> Vec<f32> {
        (0..32u32)
            .flat_map(|y| (0..64u32).flat_map(move |x| [y as f32 * 0.25, x as f32 / 64.0, 1.5]))
            .collect()
    }

    #[test]
    fn forced_cpu_fallback_uploads_the_box_chain() {
        let Some((device, queue)) = test_device::get() else {
            return eprintln!("skipping env box fallback: no native GPU adapter");
        };
        // float_targets = false selects the CPU path (WebGL2 without EXT_color_buffer_float)
        let mut reg = registry(&device, &queue, false);
        let rgb = gradient();
        let id = reg.create_environment_rgb(&device, &queue, 64, 32, &rgb).unwrap();
        assert!(reg.prefilter.is_none(), "fallback never builds the prefilter pipelines");
        assert!(reg.take_env_check(id).is_none(), "wgpu-core settles the error scopes");
        let levels = env_map::prefilter_levels(64, 32);
        assert_eq!(reg.levels(id), levels);
        assert_eq!(reg.bytes(), env_map::env_byte_size(64, 32, levels));
        let chain = env_map::box_chain_levels(64, 32, levels, env_map::env_base(64, 32, &rgb).2);
        assert_eq!(chain.len(), levels as usize);
        for (level, (_, _, data)) in chain.iter().enumerate() {
            assert_eq!(
                read_level(&device, &queue, &reg, id, level as u32),
                env_map::pack_rgba16f(data),
                "mip {level}"
            );
        }
    }

    #[test]
    fn gpu_prefilter_keeps_a_constant_environment_constant() {
        let Some((device, queue)) = test_device::get() else {
            return eprintln!("skipping env prefilter: no native GPU adapter");
        };
        let mut reg = registry(&device, &queue, true);
        let id = reg
            .create_environment_rgb(&device, &queue, 64, 32, &vec![2.0; 64 * 32 * 3])
            .unwrap();
        assert!(reg.prefilter.is_some());
        assert!(reg.take_env_check(id).is_none());
        let last = reg.levels(id) - 1;
        let texels = read_level(&device, &queue, &reg, id, last);
        for px in texels.chunks_exact(8) {
            let r = f16_to_f32(u16::from_le_bytes([px[0], px[1]]));
            assert!((r - 2.0).abs() < 0.02, "roughness 1 of a constant sky: {r}");
        }
    }

    #[test]
    fn gpu_errors_fail_the_creation_and_release_everything() {
        let Some((device, queue)) = test_device::get() else {
            return eprintln!("skipping env error scopes: no native GPU adapter");
        };
        for float_targets in [true, false] {
            let mut reg = registry(&device, &queue, float_targets);
            let rgb = vec![1.0; 64 * 32 * 3];
            let kept = reg.create_environment_rgb(&device, &queue, 64, 32, &rgb).unwrap();
            let (count, bytes) = (reg.count(), reg.bytes());
            reg.inject_env_error = true;
            let err = reg
                .create_environment_rgb(&device, &queue, 64, 32, &rgb)
                .unwrap_err();
            assert!(
                err.starts_with("GPU error while creating the environment map: "),
                "{err}"
            );
            assert_eq!((reg.count(), reg.bytes()), (count, bytes), "nothing counted");
            assert!(reg.prefilter.is_none(), "pipelines are rebuilt after an error");
            assert!(reg.env_checks.is_empty());
            // The scopes were popped: the next creation works and the old map is intact
            reg.inject_env_error = false;
            let next = reg.create_environment_rgb(&device, &queue, 64, 32, &rgb).unwrap();
            assert!(next > kept && reg.levels(kept) > 0 && reg.count() == count + 1);
            assert!(reg.dispose(next) && reg.dispose(kept) && reg.bytes() == 0);
        }
    }
}
