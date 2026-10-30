//! GPU side of the opt-in HDR post-processing (`renderer::post`): the lazily built post
//! pipelines, this engine's HDR / bloom / exposure targets (created on enable, recreated on
//! resize and MSAA changes, dropped on disable) and the frame's pass sequence:
//!
//! 1. HDR pass: the scene meshes into `Rgba16Float` (x4 + resolve with MSAA), depth stored;
//! 2. auto exposure: metering (64 x 64), 4 x 4 reductions to 1 x 1, adaptation into the
//!    ping-ponged 1 x 1 state (read by the later passes: no readback);
//! 3. bloom: prefilter (exposure, Karis average, soft knee) into mip 0, 13-tap downsamples,
//!    additive tent upsamples back to mip 0;
//! 4. main pass: the composite (exposure, bloom, tone mapping, sRGB encode over the clear
//!    color) into the frame, then every chart / graph / overlay draw on the HDR pass's depth.

use super::*;
use crate::renderer::post::{
    bloom_mip_sizes, exposure_bytes, hdr_mesh_variant, post_target_bytes, PostFrame,
    PostUniformRaw, LUM_CHAIN, POST_WGSL,
};

/// HDR scene / bloom / luminance / exposure texture format.
pub(super) const HDR_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba16Float;

/// HDR variant of a PBR mesh module (linear output, no tone mapping / encode).
pub(super) fn hdr_source(module: String, hdr: bool) -> String {
    if hdr {
        hdr_mesh_variant(&module)
    } else {
        module
    }
}

/// Main-pass color format of the mesh pipelines: the surface, or the HDR target.
pub(super) fn mesh_format(surface: wgpu::TextureFormat, hdr: bool) -> wgpu::TextureFormat {
    if hdr {
        HDR_FORMAT
    } else {
        surface
    }
}

/// Lazily built pipeline slot of a sample count + output: 0 / 1 = surface 1x / MSAA, 2 / 3 = HDR.
pub(crate) fn mesh_slot(samples: u32, hdr: bool) -> usize {
    msaa_slot(samples) + 2 * usize::from(hdr)
}

/// Whether `Rgba16Float` can be the HDR target: renderable + blendable (the translucent meshes
/// blend), and `(1x, x4 with resolve)`. WebGL2 needs `EXT_color_buffer_half_float` /
/// `EXT_color_buffer_float`, which give both.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(super) fn hdr_targets_supported(
    adapter: &wgpu::Adapter,
    device: &wgpu::Device,
) -> (bool, bool) {
    use wgpu::TextureFormatFeatureFlags as F;
    if !msaa::float_targets_supported(adapter, device) {
        return (false, false);
    }
    let flags = msaa::device_format_flags(adapter, device, HDR_FORMAT);
    let single = flags.contains(F::BLENDABLE | F::FILTERABLE);
    let depth = msaa::device_format_flags(adapter, device, DEPTH_FORMAT);
    (single, single && msaa::renders_x4(flags, depth))
}

/// Post pipelines of a surface format (built on the first post frame; the composite per
/// sample count). Shared by the 1x and MSAA pipeline sets.
pub(crate) struct LazyPost {
    pub(super) format: wgpu::TextureFormat,
    pub(super) pipelines: OnceCell<PostPipelines>,
    pub(super) composite: [OnceCell<wgpu::RenderPipeline>; 2],
}

pub(super) struct PostPipelines {
    bgl: wgpu::BindGroupLayout,
    layout: wgpu::PipelineLayout,
    shader: wgpu::ShaderModule,
    sampler: wgpu::Sampler,
    prefilter: wgpu::RenderPipeline,
    down: wgpu::RenderPipeline,
    up: wgpu::RenderPipeline,
    lum: wgpu::RenderPipeline,
    reduce: wgpu::RenderPipeline,
    adapt: wgpu::RenderPipeline,
}

fn fullscreen_pipeline(
    device: &wgpu::Device,
    p: (&wgpu::PipelineLayout, &wgpu::ShaderModule),
    fs: &'static str,
    format: wgpu::TextureFormat,
    blend: Option<wgpu::BlendState>,
    samples: Option<u32>,
) -> wgpu::RenderPipeline {
    let (layout, shader) = p;
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(fs),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: shader,
            entry_point: Some("vs_post"),
            buffers: &[],
            compilation_options: Default::default(),
        },
        fragment: Some(wgpu::FragmentState {
            module: shader,
            entry_point: Some(fs),
            targets: &[Some(wgpu::ColorTargetState {
                format,
                blend,
                write_mask: wgpu::ColorWrites::ALL,
            })],
            compilation_options: Default::default(),
        }),
        primitive: wgpu::PrimitiveState::default(),
        // The composite runs in the main pass: its depth attachment, never tested / written
        depth_stencil: samples.map(|_| wgpu::DepthStencilState {
            format: DEPTH_FORMAT,
            depth_write_enabled: false,
            depth_compare: wgpu::CompareFunction::Always,
            stencil: wgpu::StencilState::default(),
            bias: wgpu::DepthBiasState::default(),
        }),
        multisample: ColorTarget {
            format,
            samples: samples.unwrap_or(1),
        }
        .multisample(),
        multiview: None,
        cache: None,
    })
}

impl LazyPost {
    pub(super) fn new(format: wgpu::TextureFormat) -> Self {
        Self {
            format,
            pipelines: OnceCell::new(),
            composite: Default::default(),
        }
    }

    pub(super) fn get(&self, device: &wgpu::Device) -> &PostPipelines {
        self.pipelines.get_or_init(|| {
            let texture = |binding| wgpu::BindGroupLayoutEntry {
                binding,
                visibility: wgpu::ShaderStages::FRAGMENT,
                ty: wgpu::BindingType::Texture {
                    sample_type: wgpu::TextureSampleType::Float { filterable: true },
                    view_dimension: wgpu::TextureViewDimension::D2,
                    multisampled: false,
                },
                count: None,
            };
            let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("post-bgl"),
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
                    texture(1),
                    wgpu::BindGroupLayoutEntry {
                        binding: 2,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                    texture(3),
                    texture(4),
                ],
            });
            let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                label: Some("post-layout"),
                bind_group_layouts: &[&bgl],
                push_constant_ranges: &[],
            });
            let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
                label: Some("post-shader"),
                source: wgpu::ShaderSource::Wgsl(POST_WGSL.into()),
            });
            let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
                label: Some("post-sampler"),
                address_mode_u: wgpu::AddressMode::ClampToEdge,
                address_mode_v: wgpu::AddressMode::ClampToEdge,
                address_mode_w: wgpu::AddressMode::ClampToEdge,
                mag_filter: wgpu::FilterMode::Linear,
                min_filter: wgpu::FilterMode::Linear,
                mipmap_filter: wgpu::FilterMode::Nearest,
                ..Default::default()
            });
            let p = (&layout, &shader);
            let pass = |fs, blend| fullscreen_pipeline(device, p, fs, HDR_FORMAT, blend, None);
            let additive = wgpu::BlendState {
                color: wgpu::BlendComponent {
                    src_factor: wgpu::BlendFactor::One,
                    dst_factor: wgpu::BlendFactor::One,
                    operation: wgpu::BlendOperation::Add,
                },
                alpha: wgpu::BlendComponent::REPLACE,
            };
            PostPipelines {
                prefilter: pass("fs_bloom_prefilter", None),
                down: pass("fs_bloom_down", None),
                up: pass("fs_bloom_up", Some(additive)),
                lum: pass("fs_lum", None),
                reduce: pass("fs_lum_reduce", None),
                adapt: pass("fs_adapt", None),
                bgl,
                layout,
                shader,
                sampler,
            }
        })
    }

    /// The composite into the surface format at `samples` (built on first use).
    pub(super) fn composite(&self, device: &wgpu::Device, samples: u32) -> &wgpu::RenderPipeline {
        let p = self.get(device);
        self.composite[msaa_slot(samples)].get_or_init(|| {
            fullscreen_pipeline(
                device,
                (&p.layout, &p.shader),
                "fs_post_composite",
                self.format,
                None,
                Some(samples),
            )
        })
    }
}

fn hdr_texture(
    device: &wgpu::Device,
    label: &str,
    (w, h): (u32, u32),
    samples: u32,
) -> wgpu::TextureView {
    let mut usage = wgpu::TextureUsages::RENDER_ATTACHMENT;
    if samples == 1 {
        usage |= wgpu::TextureUsages::TEXTURE_BINDING;
    }
    device
        .create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width: w.max(1),
                height: h.max(1),
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: samples,
            dimension: wgpu::TextureDimension::D2,
            format: HDR_FORMAT,
            usage,
            view_formats: &[],
        })
        .create_view(&wgpu::TextureViewDescriptor::default())
}

/// Frame-sized targets: the HDR scene (+ its x4 samples) and the bloom mips.
struct PostTargets {
    key: (u32, u32, u32, bool),
    hdr: wgpu::TextureView,
    hdr_msaa: Option<wgpu::TextureView>,
    mips: Vec<wgpu::TextureView>,
    bytes: u64,
}

impl PostTargets {
    fn new(device: &wgpu::Device, key: (u32, u32, u32, bool)) -> Self {
        let (w, h, samples, bloom) = key;
        let mips = if bloom {
            bloom_mip_sizes(w, h)
                .into_iter()
                .map(|size| hdr_texture(device, "post-bloom-mip", size, 1))
                .collect()
        } else {
            Vec::new()
        };
        Self {
            key,
            hdr: hdr_texture(device, "post-hdr", (w, h), 1),
            hdr_msaa: (samples > 1).then(|| hdr_texture(device, "post-hdr-msaa", (w, h), samples)),
            mips,
            bytes: post_target_bytes(w, h, samples, bloom),
        }
    }
}

/// Auto exposure textures (frame-size independent, kept across resizes): the luminance chain
/// and the two 1 x 1 states (`(EV, valid)`, zero-initialized: the first frame snaps).
struct ExposureTargets {
    lum: Vec<wgpu::TextureView>,
    state: [wgpu::TextureView; 2],
}

impl ExposureTargets {
    fn new(device: &wgpu::Device) -> Self {
        Self {
            lum: LUM_CHAIN
                .iter()
                .map(|&e| hdr_texture(device, "post-lum", (e, e), 1))
                .collect(),
            state: [0, 1].map(|_| hdr_texture(device, "post-exposure", (1, 1), 1)),
        }
    }
}

/// Bind groups of the current targets (`[parity]`: which exposure state this frame writes).
struct PostGroups {
    composite: [wgpu::BindGroup; 2],
    prefilter: [wgpu::BindGroup; 2],
    /// `down[i]` reads mip i and renders mip i + 1; `up[i]` reads mip i + 1 into mip i
    down: Vec<wgpu::BindGroup>,
    up: Vec<wgpu::BindGroup>,
    /// Metering of the scene, then each reduction's source
    lum: Vec<wgpu::BindGroup>,
    adapt: [wgpu::BindGroup; 2],
}

/// This engine's post-processing state while it is on.
pub(super) struct PostState {
    /// Parameters of the current frame
    frame: PostFrame,
    uniform: wgpu::Buffer,
    /// 1 x 1 stand-in for unused bindings
    dummy: wgpu::TextureView,
    targets: Option<PostTargets>,
    exposure: Option<ExposureTargets>,
    groups: Option<PostGroups>,
    parity: usize,
}

impl PostState {
    pub(super) fn bytes(&self) -> u64 {
        self.targets.as_ref().map_or(0, |t| t.bytes)
            + self.exposure.as_ref().map_or(0, |_| exposure_bytes())
            + crate::renderer::post::HDR_FORMAT_BYTES
    }
}

impl WgpuRenderBackend {
    /// The device renders the HDR targets at the current sample count.
    pub(super) fn post_supported(&self) -> bool {
        if self.samples > 1 {
            self.hdr_targets.1
        } else {
            self.hdr_targets.0
        }
    }

    /// Applies this frame's post parameters: (re)creates or drops the targets, builds the
    /// pipelines in use and writes the uniform. Before the shadow syncs (their receivers follow
    /// the HDR selection).
    pub(super) fn apply_post(&mut self, frame: Option<&PostFrame>) {
        let frame = frame.filter(|_| self.pbr && self.post_supported()).copied();
        let Some(frame) = frame else {
            self.post = None;
            return;
        };
        let device = &self.device;
        let pipes = self.post_pipes.get(device);
        self.post_pipes.composite(device, self.samples);
        self.mesh_pbr.get(device, self.samples, true);
        let state = self.post.get_or_insert_with(|| PostState {
            frame,
            uniform: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("post-uniform"),
                size: size_of::<PostUniformRaw>() as u64,
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                mapped_at_creation: false,
            }),
            dummy: hdr_texture(device, "post-dummy", (1, 1), 1),
            targets: None,
            exposure: None,
            groups: None,
            parity: 0,
        });
        state.frame = frame;
        let key = (
            self.config.width,
            self.config.height,
            self.samples,
            frame.bloom.is_some(),
        );
        if state.targets.as_ref().map(|t| t.key) != Some(key) {
            state.targets = Some(PostTargets::new(device, key));
            state.groups = None;
        }
        if frame.auto_exposure.is_some() != state.exposure.is_some() {
            state.exposure = frame.auto_exposure.map(|_| ExposureTargets::new(device));
            state.groups = None;
        }
        if state.groups.is_none() {
            state.groups = Some(build_groups(device, pipes, state));
        }
        let levels = state.targets.as_ref().map_or(0, |t| t.mips.len());
        let c = self.clear_color;
        let clear = [c.r as f32, c.g as f32, c.b as f32, c.a as f32];
        let uniform = PostUniformRaw::pack(&frame, clear, !self.config.format.is_srgb(), levels);
        self.queue
            .write_buffer(&state.uniform, 0, bytemuck::bytes_of(&uniform));
    }

    /// Post-processing renders this frame (targets match the frame size and sample count).
    pub(super) fn post_ready(&self) -> bool {
        let Some(state) = &self.post else {
            return false;
        };
        let size = (self.config.width, self.config.height, self.samples);
        let built = self.mesh_pbr.pipelines[mesh_slot(self.samples, true)]
            .get()
            .is_some()
            && self.post_pipes.composite[msaa_slot(self.samples)]
                .get()
                .is_some();
        self.pbr
            && built
            && state.groups.is_some()
            && state
                .targets
                .as_ref()
                .is_some_and(|t| (t.key.0, t.key.1, t.key.2) == size)
    }

    /// The HDR mesh pipelines are selected this frame.
    pub(super) fn hdr_meshes(&self) -> bool {
        self.post.is_some()
    }

    /// After a resize / sample count change: re-applies the current parameters (new targets,
    /// the pipelines of the new count; post turns off if the device lacks HDR at that count).
    pub(super) fn resize_post_targets(&mut self) {
        if let Some(frame) = self.post.as_ref().map(|s| s.frame) {
            self.apply_post(Some(&frame));
        }
    }

    /// Passes 1 - 4 of the module docs. `post_ready()` holds.
    pub(super) fn encode_post_frame(
        &mut self,
        encoder: &mut wgpu::CommandEncoder,
        frame_view: &wgpu::TextureView,
        resident_bind: Option<&wgpu::BindGroup>,
    ) {
        let Some(state) = &mut self.post else {
            return;
        };
        state.parity ^= 1;
        let this = &*self;
        let (Some(state), Some(pipes)) = (&this.post, this.post_pipes.pipelines.get()) else {
            return;
        };
        let (Some(t), Some(g)) = (&state.targets, &state.groups) else {
            return;
        };
        let p = state.parity;
        let depth_view = this.msaa.as_ref().map_or(&this.depth_view, |m| &m.depth);

        // 1. HDR meshes (premultiplied over transparent black; the composite adds the clear)
        {
            let (view, resolve_target) = match &t.hdr_msaa {
                Some(ms) => (ms, Some(&t.hdr)),
                None => (&t.hdr, None),
            };
            let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("charturbo-hdr-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view,
                    resolve_target,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                        store: if resolve_target.is_some() {
                            wgpu::StoreOp::Discard
                        } else {
                            wgpu::StoreOp::Store
                        },
                    },
                })],
                depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                    view: depth_view,
                    depth_ops: Some(wgpu::Operations {
                        load: wgpu::LoadOp::Clear(0.0),
                        store: wgpu::StoreOp::Store,
                    }),
                    stencil_ops: None,
                }),
                timestamp_writes: None,
                occlusion_query_set: None,
            });
            this.draw_meshes(&mut rpass, false, true);
            this.draw_meshes(&mut rpass, true, true);
        }

        // 2. Auto exposure: meter, reduce to 1 x 1, adapt into this frame's state
        if let Some(e) = &state.exposure {
            fullscreen(encoder, "post-lum", &e.lum[0], false, &pipes.lum, &g.lum[0]);
            for i in 1..e.lum.len() {
                fullscreen(
                    encoder,
                    "post-lum-reduce",
                    &e.lum[i],
                    false,
                    &pipes.reduce,
                    &g.lum[i],
                );
            }
            fullscreen(
                encoder,
                "post-adapt",
                &e.state[p],
                false,
                &pipes.adapt,
                &g.adapt[p],
            );
        }

        // 3. Bloom: prefilter, downsample chain, additive upsample chain
        if !t.mips.is_empty() {
            fullscreen(
                encoder,
                "post-bloom-prefilter",
                &t.mips[0],
                false,
                &pipes.prefilter,
                &g.prefilter[p],
            );
            for i in 1..t.mips.len() {
                fullscreen(
                    encoder,
                    "post-bloom-down",
                    &t.mips[i],
                    false,
                    &pipes.down,
                    &g.down[i - 1],
                );
            }
            for i in (0..t.mips.len() - 1).rev() {
                fullscreen(
                    encoder,
                    "post-bloom-up",
                    &t.mips[i],
                    true,
                    &pipes.up,
                    &g.up[i],
                );
            }
        }

        // 4. Composite + every other draw on the HDR pass's depth
        let Some(composite) = this.post_pipes.composite[msaa_slot(this.samples)].get() else {
            return;
        };
        let (color_view, resolve_target) = match &this.msaa {
            Some(m) => (&m.color, Some(frame_view)),
            None => (frame_view, None),
        };
        let store = if resolve_target.is_some() {
            wgpu::StoreOp::Discard
        } else {
            wgpu::StoreOp::Store
        };
        let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("charturbo-main-pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: color_view,
                resolve_target,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(this.clear_color),
                    store,
                },
            })],
            depth_stencil_attachment: Some(wgpu::RenderPassDepthStencilAttachment {
                view: depth_view,
                depth_ops: Some(wgpu::Operations {
                    load: wgpu::LoadOp::Load,
                    store,
                }),
                stencil_ops: None,
            }),
            timestamp_writes: None,
            occlusion_query_set: None,
        });
        rpass.set_pipeline(composite);
        rpass.set_bind_group(0, &g.composite[p], &[]);
        rpass.draw(0..3, 0..1);
        this.draw_scene(&mut rpass, resident_bind, false);
    }
}

/// One fullscreen triangle into `view` (cleared to black unless `additive`).
fn fullscreen(
    encoder: &mut wgpu::CommandEncoder,
    label: &str,
    view: &wgpu::TextureView,
    additive: bool,
    pipeline: &wgpu::RenderPipeline,
    group: &wgpu::BindGroup,
) {
    let load = if additive {
        wgpu::LoadOp::Load
    } else {
        wgpu::LoadOp::Clear(wgpu::Color::BLACK)
    };
    let mut rpass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
        label: Some(label),
        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
            view,
            resolve_target: None,
            ops: wgpu::Operations {
                load,
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
}

fn build_groups(device: &wgpu::Device, pipes: &PostPipelines, state: &PostState) -> PostGroups {
    let t = state.targets.as_ref().expect("targets before groups");
    let dummy = &state.dummy;
    let group = |src: &wgpu::TextureView, exposure: &wgpu::TextureView, aux: &wgpu::TextureView| {
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("post-bg"),
            layout: &pipes.bgl,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: state.uniform.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(src),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&pipes.sampler),
                },
                wgpu::BindGroupEntry {
                    binding: 3,
                    resource: wgpu::BindingResource::TextureView(exposure),
                },
                wgpu::BindGroupEntry {
                    binding: 4,
                    resource: wgpu::BindingResource::TextureView(aux),
                },
            ],
        })
    };
    let ev = |p: usize| state.exposure.as_ref().map_or(dummy, |e| &e.state[p]);
    let bloom = t.mips.first().unwrap_or(dummy);
    let n = t.mips.len();
    let lum: Vec<_> = match &state.exposure {
        Some(e) => std::iter::once(&t.hdr)
            .chain(&e.lum[..e.lum.len() - 1])
            .map(|src| group(src, dummy, dummy))
            .collect(),
        None => Vec::new(),
    };
    let adapt = [0, 1].map(|p| match &state.exposure {
        Some(e) => group(&e.lum[e.lum.len() - 1], dummy, &e.state[1 - p]),
        None => group(dummy, dummy, dummy),
    });
    PostGroups {
        composite: [0, 1].map(|p| group(&t.hdr, ev(p), bloom)),
        prefilter: [0, 1].map(|p| group(&t.hdr, ev(p), dummy)),
        down: (0..n.saturating_sub(1))
            .map(|i| group(&t.mips[i], dummy, dummy))
            .collect(),
        up: (0..n.saturating_sub(1))
            .map(|i| group(&t.mips[i + 1], dummy, dummy))
            .collect(),
        lum,
        adapt,
    }
}
