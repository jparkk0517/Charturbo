//! Opt-in multisample anti-aliasing of the main pass: the engine's multisampled color + depth
//! targets (created on enable, recreated on resize, dropped on disable) and the switch between
//! the single-sampled and MSAA pipeline sets. The shadow pass, mip generation and every other
//! offscreen pass stay single-sampled; the main pass resolves into the frame texture, so
//! presentation and canvas readback (`drawImage`, `toDataURL`) see the resolved image.

use super::*;

/// MSAA sample count: the only count above 1 that WebGPU and WebGL2 both guarantee.
pub const MSAA_SAMPLES: u32 = 4;

/// Sample count applied for a request: `MSAA_SAMPLES` when requested and supported, else 1.
pub fn resolve_sample_count(requested: u32, x4_supported: bool) -> u32 {
    if requested == MSAA_SAMPLES && x4_supported {
        MSAA_SAMPLES
    } else {
        1
    }
}

/// Bytes of the multisampled color (`color_texel_bytes` per sample) + Depth32Float targets of
/// a `width x height` frame (0 at 1 sample: nothing is allocated).
pub fn msaa_target_bytes(width: u32, height: u32, samples: u32, color_texel_bytes: u32) -> u64 {
    if samples <= 1 {
        return 0;
    }
    width.max(1) as u64 * height.max(1) as u64 * samples as u64 * (color_texel_bytes as u64 + 4)
}

/// x4 rendering of the surface format (with resolve) and of the depth format.
pub(super) fn renders_x4(
    color: wgpu::TextureFormatFeatureFlags,
    depth: wgpu::TextureFormatFeatureFlags,
) -> bool {
    color.sample_count_supported(MSAA_SAMPLES)
        && color.contains(wgpu::TextureFormatFeatureFlags::MULTISAMPLE_RESOLVE)
        && depth.sample_count_supported(MSAA_SAMPLES)
}

/// Format features the device validates against: the adapter's own on downlevel (WebGL2)
/// adapters or with adapter-specific format features, else the WebGPU-guaranteed ones.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
fn device_format_flags(
    adapter: &wgpu::Adapter,
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
) -> wgpu::TextureFormatFeatureFlags {
    let adapter_flags = adapter.get_texture_format_features(format).flags;
    let specific = device
        .features()
        .contains(wgpu::Features::TEXTURE_ADAPTER_SPECIFIC_FORMAT_FEATURES)
        || !adapter.get_downlevel_capabilities().is_webgpu_compliant();
    if specific {
        adapter_flags
    } else {
        adapter_flags & format.guaranteed_format_features(device.features()).flags
    }
}

/// Whether the main pass can render x4 into `format` (+ the depth format) on this device.
#[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
pub(super) fn msaa_x4_supported(
    adapter: &wgpu::Adapter,
    device: &wgpu::Device,
    format: wgpu::TextureFormat,
) -> bool {
    renders_x4(
        device_format_flags(adapter, device, format),
        device_format_flags(adapter, device, DEPTH_FORMAT),
    )
}

/// Multisampled color (surface format) + depth attachments of the main pass.
pub(super) struct MsaaTargets {
    pub color: wgpu::TextureView,
    pub depth: wgpu::TextureView,
    pub bytes: u64,
}

impl MsaaTargets {
    pub(super) fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        samples: u32,
        width: u32,
        height: u32,
    ) -> Self {
        let (width, height) = (width.max(1), height.max(1));
        let texture = |label, format| {
            device
                .create_texture(&wgpu::TextureDescriptor {
                    label: Some(label),
                    size: wgpu::Extent3d {
                        width,
                        height,
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: samples,
                    dimension: wgpu::TextureDimension::D2,
                    format,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                })
                .create_view(&wgpu::TextureViewDescriptor::default())
        };
        Self {
            color: texture("msaa-color", format),
            depth: texture("msaa-depth", DEPTH_FORMAT),
            bytes: msaa_target_bytes(
                width,
                height,
                samples,
                format.block_copy_size(None).unwrap_or(4),
            ),
        }
    }
}

impl WgpuRenderBackend {
    /// The pipeline set rendering into `samples`-sample targets: the base set at 1, else the
    /// shared context's cached set or this engine's own (both derived from the base set).
    fn pipeline_set(&mut self, samples: u32) -> Rc<GpuPipelines> {
        if samples <= 1 {
            return self.base_pipes.clone();
        }
        if let Some(ctx) = &self._shared {
            let key = (self.config.format, samples);
            return ctx
                .pipelines
                .get_or_build(key, || self.base_pipes.with_samples(&self.device, samples));
        }
        if let Some(p) = self
            .msaa_pipes
            .as_ref()
            .filter(|p| p.target().samples == samples)
        {
            return p.clone();
        }
        let p = Rc::new(self.base_pipes.with_samples(&self.device, samples));
        self.msaa_pipes = Some(p.clone());
        p
    }

    fn install_pipelines(&mut self, p: &GpuPipelines) {
        let p = p.clone();
        self.mesh_pipeline = p.mesh_pipeline;
        self.mesh_translucent_pipeline = p.mesh_translucent_pipeline;
        self.mesh_pbr = p.mesh_pbr;
        self.shadow = p.shadow;
        self.node_pipeline = p.node_pipeline;
        self.node_translucent_pipeline = p.node_translucent_pipeline;
        self.edge_pipeline = p.edge_pipeline;
        self.segment_pipeline = p.segment_pipeline;
        self.segment_overlay_pipeline = p.segment_overlay_pipeline;
        self.dash_segment_pipeline = p.dash_segment_pipeline;
        self.bar_pipeline = p.bar_pipeline;
        self.marker_pipeline = p.marker_pipeline;
        self.fill_pipeline = p.fill_pipeline;
        self.bar_decal_pipeline = p.bar_decal_pipeline;
        self.fill_decal_pipeline = p.fill_decal_pipeline;
        self.marker_3d_pipeline = p.marker_3d_pipeline;
        self.fill_3d_pipeline = p.fill_3d_pipeline;
        self.contour_3d_pipeline = p.contour_3d_pipeline;
        self.fill_overlay_pipeline = p.fill_overlay_pipeline;
        self.point_pipeline = p.point_pipeline;
        self.heatmap_pipeline = p.heatmap_pipeline;
        self.parallel_pipeline = p.parallel_pipeline;
    }

    /// Switches the main pass to `requested` samples (unsupported counts apply 1): swaps the
    /// pipeline set, (re)creates or drops the MSAA targets, rebuilds the lazily built pipelines
    /// in use for the new count. Returns the applied count.
    pub(super) fn apply_sample_count(&mut self, requested: u32) -> u32 {
        let samples = resolve_sample_count(requested, self.msaa_x4);
        if samples == self.samples {
            return samples;
        }
        let pipes = self.pipeline_set(samples);
        self.install_pipelines(&pipes);
        self.samples = samples;
        // Rebuilt for the new count on the next resident draw
        self.resident_pipelines = None;
        self.msaa = (samples > 1).then(|| {
            MsaaTargets::new(
                &self.device,
                self.config.format,
                samples,
                self.config.width,
                self.config.height,
            )
        });
        if self.pbr {
            self.mesh_pbr.get(&self.device, samples);
        }
        if self.shadow_map.is_some() {
            self.shadow.receiving(&self.device, self.pbr, samples);
        }
        samples
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use wgpu::TextureFormatFeatureFlags as F;

    #[test]
    fn sample_count_requests_fall_back_to_one() {
        assert_eq!(resolve_sample_count(4, true), 4);
        assert_eq!(resolve_sample_count(4, false), 1);
        for other in [0, 1, 2, 8, 16] {
            assert_eq!(resolve_sample_count(other, true), 1, "{other}");
        }
        assert_eq!((msaa_slot(1), msaa_slot(4)), (0, 1));
    }

    #[test]
    fn single_sample_pipelines_keep_the_default_multisample_state() {
        let format = wgpu::TextureFormat::Bgra8Unorm;
        assert_eq!(
            ColorTarget { format, samples: 1 }.multisample(),
            wgpu::MultisampleState::default()
        );
        let x4 = ColorTarget { format, samples: 4 }.multisample();
        assert_eq!(
            (x4.count, x4.mask, x4.alpha_to_coverage_enabled),
            (4, !0, false)
        );
    }

    #[test]
    fn msaa_targets_bytes() {
        assert_eq!(msaa_target_bytes(480, 300, 1, 4), 0);
        // 4 samples x (RGBA8 color + Depth32Float)
        assert_eq!(msaa_target_bytes(480, 300, 4, 4), 480 * 300 * 4 * 8);
        assert_eq!(msaa_target_bytes(0, 0, 4, 4), 4 * 8);
        assert_eq!(msaa_target_bytes(10, 10, 4, 8), 10 * 10 * 4 * 12);
    }

    #[test]
    fn x4_needs_color_resolve_and_depth() {
        let x4 = F::MULTISAMPLE_X4;
        assert!(renders_x4(x4 | F::MULTISAMPLE_RESOLVE, x4));
        assert!(!renders_x4(x4, x4), "no resolve");
        assert!(!renders_x4(F::MULTISAMPLE_X2 | F::MULTISAMPLE_RESOLVE, x4));
        assert!(!renders_x4(x4 | F::MULTISAMPLE_RESOLVE, F::empty()));
        // The surface formats charturbo picks are x4-renderable on every WebGPU device
        for format in [
            wgpu::TextureFormat::Bgra8Unorm,
            wgpu::TextureFormat::Rgba8Unorm,
        ] {
            let f = |t: wgpu::TextureFormat| {
                t.guaranteed_format_features(wgpu::Features::empty()).flags
            };
            assert!(renders_x4(f(format), f(DEPTH_FORMAT)), "{format:?}");
        }
    }
}
