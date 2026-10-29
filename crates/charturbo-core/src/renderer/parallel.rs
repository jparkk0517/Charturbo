//! GPU payloads of the parallel coordinates layer: one segment instance per polyline piece
//! (`ChartSegmentRaw` with the row index in `p1_pad[3]`), a per-row flag texture and a style
//! uniform. Brushing / legend toggles rewrite only the flags (4 bytes per row) and the uniform;
//! the segment geometry stays on the GPU.

use bytemuck::{Pod, Zeroable};

/// Row flag: drawn at full color (no brush, or inside every brushed interval).
pub const PARALLEL_ACTIVE: f32 = 1.0;
/// Row flag: outside a brushed interval (drawn dimmed, beneath the active rows).
pub const PARALLEL_INACTIVE: f32 = 0.0;
/// Row flag: series hidden by the legend (not drawn).
pub const PARALLEL_HIDDEN: f32 = -1.0;

/// Uniform of the parallel layer (32 bytes).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartParallelStyleRaw {
    /// Inactive rows: `rgb` blended into the row color by `a` (0 = keep the row color)
    pub inactive: [f32; 4],
    /// `[inactive opacity, brushed (1 = draw the inactive pass), flag texture width, layer
    /// opacity (enter fade)]`; the backend fills the texture width (flags are packed row-major,
    /// wrapped at that width)
    pub params: [f32; 4],
}

impl Default for ChartParallelStyleRaw {
    fn default() -> Self {
        Self {
            inactive: [0.0; 4],
            params: [0.05, 0.0, 1.0, 1.0],
        }
    }
}

impl ChartParallelStyleRaw {
    pub fn brushed(&self) -> bool {
        self.params[1] > 0.5
    }

    /// Displayed color of a segment of a row with `flag` (`None` = not drawn); mirrors the
    /// shader (SVG export).
    pub fn resolve(&self, color: [f32; 4], flag: f32) -> Option<[f32; 4]> {
        if flag < -0.5 {
            return None;
        }
        let fade = if self.params[3].is_finite() { self.params[3].clamp(0.0, 1.0) } else { 1.0 };
        if flag > 0.5 || !self.brushed() {
            return Some([color[0], color[1], color[2], color[3] * fade]);
        }
        let k = self.inactive[3].clamp(0.0, 1.0);
        let mix = |a: f32, b: f32| a + (b - a) * k;
        Some([
            mix(color[0], self.inactive[0]),
            mix(color[1], self.inactive[1]),
            mix(color[2], self.inactive[2]),
            color[3] * self.params[0].clamp(0.0, 1.0) * fade,
        ])
    }
}

/// GPU state of the parallel layer: R32Float row flags (wrapped like the heatmap grid), the style
/// uniform and their bind group. The vertex shader reads the flag of each segment's row.
pub(super) struct ParallelGpu {
    layout: wgpu::BindGroupLayout,
    style_buffer: wgpu::Buffer,
    flags: wgpu::Texture,
    pub(super) bind_group: wgpu::BindGroup,
    style: ChartParallelStyleRaw,
}

impl ParallelGpu {
    /// Bind group layout: camera (0), style (1), flags (2, read in the vertex stage).
    pub(super) fn bind_group_layout(device: &wgpu::Device) -> wgpu::BindGroupLayout {
        let uniform = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
            ty: wgpu::BindingType::Buffer {
                ty: wgpu::BufferBindingType::Uniform,
                has_dynamic_offset: false,
                min_binding_size: None,
            },
            count: None,
        };
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("chart-parallel-bgl"),
            entries: &[
                uniform(0),
                uniform(1),
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::VERTEX,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        })
    }

    pub(super) fn new(
        device: &wgpu::Device,
        layout: wgpu::BindGroupLayout,
        camera: &wgpu::Buffer,
    ) -> Self {
        use wgpu::util::DeviceExt;
        let style = ChartParallelStyleRaw::default();
        let style_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("chart-parallel-style-buffer"),
            contents: bytemuck::bytes_of(&style),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let flags = Self::texture(device, (1, 1));
        let bind_group = Self::bind(device, &layout, camera, &style_buffer, &flags);
        Self {
            layout,
            style_buffer,
            flags,
            bind_group,
            style,
        }
    }

    pub(super) fn brushed(&self) -> bool {
        self.style.brushed()
    }

    pub(super) fn texture_bytes(&self) -> u64 {
        u64::from(self.flags.width()) * u64::from(self.flags.height()) * 4
    }

    fn texture(device: &wgpu::Device, size: (u32, u32)) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some("chart-parallel-flags"),
            size: wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::R32Float,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    fn bind(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        camera: &wgpu::Buffer,
        style: &wgpu::Buffer,
        flags: &wgpu::Texture,
    ) -> wgpu::BindGroup {
        let flags = flags.create_view(&Default::default());
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("chart-parallel-bg"),
            layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: style.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::TextureView(&flags),
                },
            ],
        })
    }

    fn write(
        queue: &wgpu::Queue,
        texture: &wgpu::Texture,
        origin_y: u32,
        values: &[f32],
        size: (u32, u32),
    ) {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d {
                    x: 0,
                    y: origin_y,
                    z: 0,
                },
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(values),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(size.0 * 4),
                rows_per_image: None,
            },
            wgpu::Extent3d {
                width: size.0,
                height: size.1,
                depth_or_array_layers: 1,
            },
        );
    }

    /// Uploads the row flags; the texture (and bind group) is recreated only when its size
    /// changes. Rows beyond `max_dim x max_dim` texels read as active.
    pub(super) fn upload_flags(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        camera: &wgpu::Buffer,
        flags: &[f32],
    ) {
        let max_dim = device.limits().max_texture_dimension_2d.max(1) as usize;
        let rows = flags.len().min(max_dim * max_dim);
        let width = rows.clamp(1, max_dim);
        let height = rows.div_ceil(width).max(1);
        let size = self.flags.size();
        if (size.width as usize, size.height as usize) != (width, height) {
            self.flags = Self::texture(device, (width as u32, height as u32));
            self.bind_group = Self::bind(
                device,
                &self.layout,
                camera,
                &self.style_buffer,
                &self.flags,
            );
        }
        let flags = &flags[..rows];
        let full = rows / width;
        if full > 0 {
            Self::write(
                queue,
                &self.flags,
                0,
                &flags[..full * width],
                (width as u32, full as u32),
            );
        }
        let rest = rows - full * width;
        if rest > 0 {
            Self::write(
                queue,
                &self.flags,
                full as u32,
                &flags[full * width..],
                (rest as u32, 1),
            );
        }
        self.style.params[2] = width as f32;
        queue.write_buffer(&self.style_buffer, 0, bytemuck::bytes_of(&self.style));
    }

    pub(super) fn upload_style(&mut self, queue: &wgpu::Queue, style: ChartParallelStyleRaw) {
        let width = self.flags.width() as f32;
        self.style = ChartParallelStyleRaw {
            params: [style.params[0], style.params[1], width, style.params[3]],
            ..style
        };
        queue.write_buffer(&self.style_buffer, 0, bytemuck::bytes_of(&self.style));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn style_is_32_bytes_and_resolves_like_the_shader() {
        assert_eq!(std::mem::size_of::<ChartParallelStyleRaw>(), 32);
        let c = [1.0, 0.0, 0.0, 0.5];
        let mut s = ChartParallelStyleRaw {
            inactive: [0.0, 0.0, 1.0, 0.5],
            params: [0.2, 0.0, 1.0, 1.0],
        };
        // No brush: every visible row keeps its color
        assert_eq!(s.resolve(c, PARALLEL_INACTIVE), Some(c));
        assert_eq!(s.resolve(c, PARALLEL_HIDDEN), None);
        s.params[1] = 1.0;
        assert_eq!(s.resolve(c, PARALLEL_ACTIVE), Some(c));
        assert_eq!(s.resolve(c, PARALLEL_INACTIVE), Some([0.5, 0.0, 0.5, 0.1]));
        // Enter fade scales both passes; a NaN fade draws at full opacity
        s.params[3] = 0.5;
        assert_eq!(s.resolve(c, PARALLEL_ACTIVE), Some([1.0, 0.0, 0.0, 0.25]));
        s.params[3] = f32::NAN;
        assert_eq!(s.resolve(c, PARALLEL_ACTIVE), Some(c));
    }
}
