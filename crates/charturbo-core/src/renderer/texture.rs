//! Base-color textures of 3D scene objects: id / budget accounting (`TextureLedger`, pure and
//! GPU-free so it is unit tested natively) and the per-engine GPU registry (`TextureRegistry`:
//! RGBA8 textures, mip chain, sampler and cached bind groups).
//!
//! Ids start at 1 and are never reused; id 0 is the built-in 1 x 1 white texture, so an
//! object without a map (or pointing at a disposed / unknown id) renders exactly untextured.
//! Device loss is out of scope: textures are not restored.

use std::collections::{BTreeMap, HashMap};

/// Largest texture edge accepted (further capped by the device's `max_texture_dimension_2d`).
pub const MAX_TEXTURE_EDGE: u32 = 4096;
/// Texture memory one engine may hold (all mip levels).
pub const TEXTURE_BUDGET_BYTES: u64 = 256 * 1024 * 1024;
/// Gamma-space pipeline on a non-sRGB surface: texels are used as stored (no sRGB decode).
pub const TEXTURE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

/// Full mip chain length of a `width x height` texture: `floor(log2(max edge)) + 1`.
pub fn mip_level_count(width: u32, height: u32) -> u32 {
    32 - width.max(height).max(1).leading_zeros()
}

/// Bytes of an RGBA8 texture with `levels` mip levels.
pub fn texture_byte_size(width: u32, height: u32, levels: u32) -> u64 {
    (0..levels)
        .map(|l| u64::from((width >> l).max(1)) * u64::from((height >> l).max(1)) * 4)
        .sum()
}

/// `rgba` must hold exactly `width * height` RGBA8 texels.
pub fn check_rgba_len(width: u32, height: u32, len: usize) -> Result<(), String> {
    let expected = u128::from(width) * u128::from(height) * 4;
    if len as u128 != expected {
        return Err(format!(
            "rgba length must be width * height * 4 ({expected}), got {len}"
        ));
    }
    Ok(())
}

#[derive(Debug)]
pub struct LedgerEntry<T> {
    pub width: u32,
    pub height: u32,
    pub levels: u32,
    pub bytes: u64,
    pub value: T,
}

/// Texture id allocation, size limit and memory budget, independent of the GPU (`T` is the
/// backend's per-texture payload).
#[derive(Debug)]
pub struct TextureLedger<T> {
    next_id: u32,
    max_edge: u32,
    budget: u64,
    used: u64,
    entries: BTreeMap<u32, LedgerEntry<T>>,
}

impl<T> Default for TextureLedger<T> {
    fn default() -> Self {
        Self::new(MAX_TEXTURE_EDGE, TEXTURE_BUDGET_BYTES)
    }
}

impl<T> TextureLedger<T> {
    pub fn new(max_edge: u32, budget: u64) -> Self {
        Self {
            next_id: 1,
            max_edge: max_edge.clamp(1, MAX_TEXTURE_EDGE),
            budget,
            used: 0,
            entries: BTreeMap::new(),
        }
    }

    pub fn max_edge(&self) -> u32 {
        self.max_edge
    }

    /// Validates a new texture: `(mip levels, bytes)` or an error (size, budget, ids).
    pub fn plan(&self, width: u32, height: u32, mipmaps: bool) -> Result<(u32, u64), String> {
        let levels = if mipmaps {
            mip_level_count(width, height)
        } else {
            1
        };
        let bytes = texture_byte_size(width, height, levels);
        self.plan_bytes(width, height, bytes)?;
        Ok((levels, bytes))
    }

    /// Validates a new texture of a known byte size (any format / mip chain).
    pub fn plan_bytes(&self, width: u32, height: u32, bytes: u64) -> Result<(), String> {
        if width == 0 || height == 0 {
            return Err("texture width and height must be > 0".into());
        }
        if width > self.max_edge || height > self.max_edge {
            return Err(format!(
                "texture {width}x{height} exceeds the max texture size {}",
                self.max_edge
            ));
        }
        if self.next_id == u32::MAX {
            return Err("texture ids exhausted".into());
        }
        if self.used + bytes > self.budget {
            return Err("texture memory budget exceeded".into());
        }
        Ok(())
    }

    /// Records a texture validated by `plan` and returns its new id.
    pub fn insert(&mut self, width: u32, height: u32, levels: u32, bytes: u64, value: T) -> u32 {
        let id = self.next_id;
        self.next_id += 1;
        self.used += bytes;
        self.entries.insert(
            id,
            LedgerEntry {
                width,
                height,
                levels,
                bytes,
                value,
            },
        );
        id
    }

    pub fn remove(&mut self, id: u32) -> Option<LedgerEntry<T>> {
        let entry = self.entries.remove(&id)?;
        self.used -= entry.bytes;
        Some(entry)
    }

    pub fn get(&self, id: u32) -> Option<&LedgerEntry<T>> {
        self.entries.get(&id)
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn bytes(&self) -> u64 {
        self.used
    }
}

/// GPU side of one texture: kept for explicit destruction, bind group cached for draws.
pub(crate) struct GpuTexture {
    pub(super) texture: wgpu::Texture,
    pub(super) bind_group: wgpu::BindGroup,
    /// HDR environment maps (`Rgba16Float`, prefiltered): SH diffuse irradiance terms
    pub(super) env_sh: Option<Box<[[f32; 4]; 9]>>,
}

/// Texture ids of a PBR material bind group: base color, metallic-roughness, normal,
/// occlusion, emissive (`MeshDraw::texture` + `MeshDraw::maps`).
pub type MaterialKey = [u32; 5];

/// Bind group slots of `MaterialKey` (binding 1 is the sampler).
const MATERIAL_BINDINGS: [u32; 5] = [0, 2, 3, 4, 5];
/// Slot of the normal map in `MaterialKey` (falls back to the flat texture, not white).
const NORMAL_SLOT: usize = 2;

/// Lazily built mip generation pipeline (render-pass blit chain).
struct MipBlit {
    pipeline: wgpu::RenderPipeline,
    bgl: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
}

/// Per-engine mesh textures, their shared sampler, the default white texture and the PBR
/// material bind groups.
pub(crate) struct TextureRegistry {
    pub(super) ledger: TextureLedger<GpuTexture>,
    pub(super) layout: wgpu::BindGroupLayout,
    pub(super) sampler: wgpu::Sampler,
    /// PBR environment maps: u wraps (longitude), v clamps at the poles
    env_sampler: wgpu::Sampler,
    white: wgpu::Texture,
    white_bind_group: wgpu::BindGroup,
    blit: Option<MipBlit>,
    /// PBR material group layout (base map, sampler, 4 material maps)
    material_layout: wgpu::BindGroupLayout,
    /// 1 x 1 flat normal (128, 128, 255), created with the first material bind group
    flat_normal: Option<wgpu::Texture>,
    /// Material bind groups of the drawn texture combinations (`prepare_materials`); cleared
    /// whenever a texture is created or disposed, so none outlives / misses its textures
    pub(super) materials: HashMap<MaterialKey, wgpu::BindGroup>,
    /// The device renders into `Rgba16Float` (HDR prefiltering on the GPU; else box mips)
    pub(super) float_targets: bool,
    /// Lazily built HDR environment prefilter pipelines
    pub(super) prefilter: Option<super::env_prefilter::EnvPrefilter>,
}

#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
impl TextureRegistry {
    /// Bytes of the built-in 1 x 1 white texture (counted in `engine_gpu_bytes`; the 1 x 1 flat
    /// normal of the first PBR material frame is not).
    pub const WHITE_BYTES: u64 = 4;

    /// `layout`: the mesh texture bind group layout (b0 texture, b1 sampler) of the pipelines;
    /// `material_layout`: the PBR material group (b0 base map, b1 sampler, b2..b5 maps);
    /// `float_targets`: `Rgba16Float` is renderable (GPU prefiltering of HDR environments).
    pub fn new(
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        layout: wgpu::BindGroupLayout,
        material_layout: wgpu::BindGroupLayout,
        float_targets: bool,
    ) -> Self {
        let max_edge = device
            .limits()
            .max_texture_dimension_2d
            .min(MAX_TEXTURE_EDGE);
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("mesh-texture-sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::Repeat,
            address_mode_w: wgpu::AddressMode::Repeat,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            // wgpu clamps this to 1 when anisotropic filtering is unsupported
            anisotropy_clamp: 8,
            ..Default::default()
        });
        let env_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("env-map-sampler"),
            address_mode_u: wgpu::AddressMode::Repeat,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let white = Self::create_gpu_texture(device, "mesh-texture-white", 1, 1, 1);
        Self::write_rgba8(queue, &white, 1, 1, &[255, 255, 255, 255]);
        let white_bind_group = Self::create_bind_group(device, &layout, &sampler, &white);
        Self {
            ledger: TextureLedger::new(max_edge, TEXTURE_BUDGET_BYTES),
            layout,
            sampler,
            env_sampler,
            white,
            white_bind_group,
            blit: None,
            material_layout,
            flat_normal: None,
            materials: HashMap::new(),
            float_targets,
            prefilter: None,
        }
    }

    /// Builds the missing material bind groups of `keys` (PBR frames, before the pass).
    pub fn prepare_materials(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        keys: impl IntoIterator<Item = MaterialKey>,
    ) {
        for key in keys {
            if self.materials.contains_key(&key) {
                continue;
            }
            let flat = self.flat_normal.get_or_insert_with(|| {
                let t = Self::create_gpu_texture(device, "mesh-texture-flat-normal", 1, 1, 1);
                Self::write_rgba8(queue, &t, 1, 1, &[128, 128, 255, 255]);
                t
            });
            // Unknown / disposed ids: white (no effect), the normal slot flat
            let views: Vec<wgpu::TextureView> = key
                .iter()
                .enumerate()
                .map(|(slot, id)| {
                    let fallback = if slot == NORMAL_SLOT {
                        &*flat
                    } else {
                        &self.white
                    };
                    // HDR environment maps are not object maps: same fallback
                    let live = self.ledger.get(*id).filter(|e| e.value.env_sh.is_none());
                    let texture = live.map_or(fallback, |e| &e.value.texture);
                    texture.create_view(&wgpu::TextureViewDescriptor::default())
                })
                .collect();
            let mut entries: Vec<wgpu::BindGroupEntry> = views
                .iter()
                .zip(MATERIAL_BINDINGS)
                .map(|(view, binding)| wgpu::BindGroupEntry {
                    binding,
                    resource: wgpu::BindingResource::TextureView(view),
                })
                .collect();
            entries.push(wgpu::BindGroupEntry {
                binding: 1,
                resource: wgpu::BindingResource::Sampler(&self.sampler),
            });
            let group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("mesh-material-bg"),
                layout: &self.material_layout,
                entries: &entries,
            });
            self.materials.insert(key, group);
        }
    }

    /// Material bind group of `key` built by `prepare_materials` this frame.
    pub fn material_bind_group(&self, key: &MaterialKey) -> Option<&wgpu::BindGroup> {
        self.materials.get(key)
    }

    pub fn max_edge(&self) -> u32 {
        self.ledger.max_edge()
    }

    pub fn count(&self) -> u32 {
        self.ledger.len() as u32
    }

    pub fn bytes(&self) -> u64 {
        self.ledger.bytes()
    }

    /// Bind group of `id`; unknown / disposed ids (and 0) and HDR environment maps get the
    /// white texture.
    pub fn bind_group(&self, id: u32) -> &wgpu::BindGroup {
        self.ledger
            .get(id)
            .filter(|e| e.value.env_sh.is_none())
            .map_or(&self.white_bind_group, |e| &e.value.bind_group)
    }

    /// SH irradiance terms of a live HDR environment map (`None` for LDR / unknown ids).
    pub fn env_sh(&self, id: u32) -> Option<&[[f32; 4]; 9]> {
        self.ledger.get(id)?.value.env_sh.as_deref()
    }

    /// Mip levels of a live texture (0 for unknown / disposed ids and 0).
    pub fn levels(&self, id: u32) -> u32 {
        self.ledger.get(id).map_or(0, |e| e.levels)
    }

    /// Environment-map bind group of `id` (same layout as the base-color group, env sampler);
    /// unknown / disposed ids get the white texture (the shader then uses the hemisphere).
    pub fn env_bind_group(&self, device: &wgpu::Device, id: u32) -> wgpu::BindGroup {
        let texture = self
            .ledger
            .get(id)
            .map_or(&self.white, |e| &e.value.texture);
        Self::create_bind_group(device, &self.layout, &self.env_sampler, texture)
    }

    /// Creates a texture from tightly packed RGBA8 texels (top row first).
    pub fn create_rgba8(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        rgba: &[u8],
        mipmaps: bool,
    ) -> Result<u32, String> {
        check_rgba_len(width, height, rgba.len())?;
        self.create(device, queue, width, height, mipmaps, |texture| {
            Self::write_rgba8(queue, texture, width, height, rgba)
        })
    }

    /// Validates, allocates the texture, lets `upload` fill mip level 0, then builds the mip
    /// chain and the bind group. Nothing reaches the GPU when validation fails.
    pub fn create(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        width: u32,
        height: u32,
        mipmaps: bool,
        upload: impl FnOnce(&wgpu::Texture),
    ) -> Result<u32, String> {
        let (levels, bytes) = self.ledger.plan(width, height, mipmaps)?;
        let texture = Self::create_gpu_texture(device, "mesh-texture", width, height, levels);
        upload(&texture);
        if levels > 1 {
            self.generate_mips(device, queue, &texture, levels);
        }
        let bind_group = Self::create_bind_group(device, &self.layout, &self.sampler, &texture);
        // A cached material group may hold the white fallback for this (future) id
        self.materials.clear();
        Ok(self.ledger.insert(
            width,
            height,
            levels,
            bytes,
            GpuTexture {
                texture,
                bind_group,
                env_sh: None,
            },
        ))
    }

    /// Creates a texture from a decoded `ImageBitmap` (`copy_external_image_to_texture`). WebGL2
    /// lacks unrestricted external copies, so the copy is always full size, origin 0, no
    /// flip and not premultiplied (the SDK decodes with `premultiplyAlpha: 'none'`).
    #[cfg(target_arch = "wasm32")]
    pub fn create_from_bitmap(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        bitmap: &web_sys::ImageBitmap,
        mipmaps: bool,
    ) -> Result<u32, String> {
        // A closed / detached bitmap reports 0 x 0 and is rejected by `plan`
        let (width, height) = (bitmap.width(), bitmap.height());
        self.create(device, queue, width, height, mipmaps, |texture| {
            queue.copy_external_image_to_texture(
                &wgpu::CopyExternalImageSourceInfo {
                    source: wgpu::ExternalImageSource::ImageBitmap(bitmap.clone()),
                    origin: wgpu::Origin2d::ZERO,
                    flip_y: false,
                },
                wgpu::CopyExternalImageDestInfo {
                    texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                    color_space: wgpu::PredefinedColorSpace::Srgb,
                    premultiplied_alpha: false,
                },
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
            )
        })
    }

    pub fn dispose(&mut self, id: u32) -> bool {
        match self.ledger.remove(id) {
            Some(entry) => {
                // Material groups must not outlive the texture
                self.materials.clear();
                // Frees the memory now; already submitted frames that sampled it stay valid
                entry.value.texture.destroy();
                true
            }
            None => false,
        }
    }

    fn create_gpu_texture(
        device: &wgpu::Device,
        label: &str,
        width: u32,
        height: u32,
        levels: u32,
    ) -> wgpu::Texture {
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
            format: TEXTURE_FORMAT,
            // RENDER_ATTACHMENT: mip blits and `copy_external_image_to_texture` need it
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
    }

    fn write_rgba8(
        queue: &wgpu::Queue,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
        rgba: &[u8],
    ) {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            rgba,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
    }

    pub(super) fn create_bind_group(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        sampler: &wgpu::Sampler,
        texture: &wgpu::Texture,
    ) -> wgpu::BindGroup {
        let view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("mesh-texture-bg"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(sampler),
                },
            ],
        })
    }

    /// Fills levels `1..levels` by linearly downsampling the previous level (one render pass
    /// per level, each source bound as a single-level view).
    fn generate_mips(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        texture: &wgpu::Texture,
        levels: u32,
    ) {
        let blit = self.blit.get_or_insert_with(|| MipBlit::new(device));
        let level_view = |level: u32| {
            texture.create_view(&wgpu::TextureViewDescriptor {
                label: Some("mesh-texture-mip"),
                base_mip_level: level,
                mip_level_count: Some(1),
                ..Default::default()
            })
        };
        let mut encoder = device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("mesh-texture-mips"),
        });
        for level in 1..levels {
            let src = level_view(level - 1);
            let dst = level_view(level);
            let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("mesh-texture-mip-bg"),
                layout: &blit.bgl,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&src),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(&blit.sampler),
                    },
                ],
            });
            let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("mesh-texture-mip-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &dst,
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
            pass.set_pipeline(&blit.pipeline);
            pass.set_bind_group(0, &bind_group, &[]);
            pass.draw(0..3, 0..1);
        }
        queue.submit(Some(encoder.finish()));
    }
}

impl MipBlit {
    fn new(device: &wgpu::Device) -> Self {
        let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("mesh-texture-mip-bgl"),
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
        let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("mesh-texture-mip-layout"),
            bind_group_layouts: &[&bgl],
            push_constant_ranges: &[],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("mesh-texture-mip-shader"),
            source: wgpu::ShaderSource::Wgsl(super::shader::MIPMAP_BLIT_WGSL.into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("mesh-texture-mip-pipeline"),
            layout: Some(&layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_blit"),
                buffers: &[],
                compilation_options: Default::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_blit"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: TEXTURE_FORMAT,
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
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("mesh-texture-mip-sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        Self {
            pipeline,
            bgl,
            sampler,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mip_chain_length_and_bytes() {
        assert_eq!(mip_level_count(1, 1), 1);
        assert_eq!(mip_level_count(2, 1), 2);
        assert_eq!(mip_level_count(256, 256), 9);
        assert_eq!(mip_level_count(300, 20), 9);
        assert_eq!(mip_level_count(4096, 4096), 13);
        assert_eq!(texture_byte_size(4, 2, 1), 32);
        // 4x2 + 2x1 + 1x1 texels
        assert_eq!(texture_byte_size(4, 2, 3), (8 + 2 + 1) * 4);
    }

    #[test]
    fn ledger_rejects_bad_sizes_and_rgba_lengths() {
        let ledger: TextureLedger<()> = TextureLedger::new(8192, TEXTURE_BUDGET_BYTES);
        // The device limit is capped at 4096
        assert_eq!(ledger.max_edge(), MAX_TEXTURE_EDGE);
        assert!(ledger.plan(0, 4, false).is_err());
        assert!(ledger.plan(4, 0, false).is_err());
        assert!(ledger
            .plan(4097, 4, false)
            .unwrap_err()
            .contains("max texture size"));
        assert_eq!(ledger.plan(4096, 1, false), Ok((1, 4096 * 4)));
        let small: TextureLedger<()> = TextureLedger::new(2048, TEXTURE_BUDGET_BYTES);
        assert!(small.plan(2049, 1, false).is_err());
        assert!(check_rgba_len(2, 2, 16).is_ok());
        assert!(check_rgba_len(2, 2, 15).is_err());
        assert!(check_rgba_len(2, 2, 0).is_err());
    }

    #[test]
    fn ledger_enforces_the_budget_and_never_reuses_ids() {
        let mut ledger: TextureLedger<()> = TextureLedger::new(4096, 1000);
        let (levels, bytes) = ledger.plan(10, 10, false).unwrap();
        assert_eq!((levels, bytes), (1, 400));
        let a = ledger.insert(10, 10, levels, bytes, ());
        let b = ledger.insert(10, 10, levels, bytes, ());
        assert_eq!((a, b), (1, 2));
        assert_eq!(ledger.bytes(), 800);
        assert_eq!(
            ledger.plan(10, 10, false).unwrap_err(),
            "texture memory budget exceeded"
        );
        assert!(ledger.remove(a).is_some());
        assert!(ledger.remove(a).is_none(), "double dispose");
        assert_eq!(ledger.bytes(), 400);
        let (levels, bytes) = ledger.plan(10, 10, false).unwrap();
        let c = ledger.insert(10, 10, levels, bytes, ());
        assert_eq!(c, 3, "ids are never reused");
        assert_eq!(ledger.len(), 2);
        assert!(ledger.get(a).is_none());
        assert_eq!(ledger.get(c).map(|e| (e.width, e.height)), Some((10, 10)));
    }
}
