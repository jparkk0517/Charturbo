//! GPU payloads of the heatmap layer: the value grid (uploaded once as a float texture) and
//! the per-frame style uniform (zoom window, value scale) that the fragment shader reads.

use bytemuck::{Pod, Zeroable};

/// Entries of the colormap lookup table (one 256 x 1 RGBA8 texture row).
pub const HEATMAP_LUT_SIZE: usize = 256;

/// Row-major `cols x rows` heatmap values (NaN / infinite = empty cell). Empty = no heatmap.
#[derive(Debug, Default, Clone, Copy)]
pub struct ChartHeatmapGrid<'a> {
    pub cols: u32,
    pub rows: u32,
    pub values: &'a [f32],
}

/// Uniform of the heatmap layer (80 bytes). Zoom / pan / domain changes rewrite only this.
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Pod, Zeroable)]
pub struct ChartHeatmapStyleRaw {
    /// World rect of the plot `[x0, y0, x1, y1]`: the quad, in the plane z = 0
    pub rect: [f32; 4],
    /// Visible part of the grid, normalized `[x0, x1, y0, y1]` (y counts from the bottom)
    pub window: [f32; 4],
    /// `[cols, rows, texture_width, row0_top]`: the backend fills `texture_width` (the grid is
    /// packed row-major into a texture wrapped at that width, see `WgpuRenderBackend`)
    pub grid: [u32; 4],
    /// `[lo, hi, center, diverging]`: value -> [0, 1] as in `chart::ValueScale::normalize`
    pub scale: [f32; 4],
    /// Color of empty (NaN) cells (alpha 0 = the surface shows through)
    pub empty: [f32; 4],
}

impl Default for ChartHeatmapStyleRaw {
    fn default() -> Self {
        Self {
            rect: [0.0; 4],
            window: [0.0, 1.0, 0.0, 1.0],
            grid: [0; 4],
            scale: [0.0, 1.0, 0.0, 0.0],
            empty: [0.0; 4],
        }
    }
}

/// GPU state of the heatmap layer (the codebase's only textures): the value grid packed
/// row-major into an R32Float texture wrapped at `width` texels per row (so grids wider or taller
/// than the device's 2D texture limit still fit), the 256 x 1 RGBA8 colormap LUT, the style
/// uniform and their bind group. Both textures are read with `textureLoad` (no sampler: R32Float
/// is not filterable on every device and nearest cells must stay crisp).
pub(super) struct HeatmapGpu {
    layout: wgpu::BindGroupLayout,
    style_buffer: wgpu::Buffer,
    values: wgpu::Texture,
    lut: wgpu::Texture,
    pub(super) bind_group: wgpu::BindGroup,
    /// Last style from the chart; `grid[2]` is rewritten with the texture width
    style: ChartHeatmapStyleRaw,
    /// Grid has at least one cell (else nothing is drawn)
    pub(super) active: bool,
}

impl HeatmapGpu {
    /// Bind group layout: camera (0), style (1), values (2), LUT (3).
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
        let texture = |binding| wgpu::BindGroupLayoutEntry {
            binding,
            visibility: wgpu::ShaderStages::FRAGMENT,
            ty: wgpu::BindingType::Texture {
                sample_type: wgpu::TextureSampleType::Float { filterable: false },
                view_dimension: wgpu::TextureViewDimension::D2,
                multisampled: false,
            },
            count: None,
        };
        device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("chart-heatmap-bgl"),
            entries: &[uniform(0), uniform(1), texture(2), texture(3)],
        })
    }

    pub(super) fn new(device: &wgpu::Device, layout: wgpu::BindGroupLayout, camera: &wgpu::Buffer) -> Self {
        use wgpu::util::DeviceExt;
        let style = ChartHeatmapStyleRaw::default();
        let style_buffer = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("chart-heatmap-style-buffer"),
            contents: bytemuck::bytes_of(&style),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let values = Self::texture(device, "chart-heatmap-values", wgpu::TextureFormat::R32Float, (1, 1));
        let lut = Self::texture(device, "chart-heatmap-lut", wgpu::TextureFormat::Rgba8Unorm, (HEATMAP_LUT_SIZE as u32, 1));
        let bind_group = Self::bind(device, &layout, camera, &style_buffer, &values, &lut);
        Self { layout, style_buffer, values, lut, bind_group, style, active: false }
    }

    /// Bytes of the value grid and LUT textures (4 bytes per texel).
    pub(super) fn texture_bytes(&self) -> u64 {
        [&self.values, &self.lut].iter().map(|t| u64::from(t.width()) * u64::from(t.height()) * 4).sum()
    }

    fn texture(device: &wgpu::Device, label: &'static str, format: wgpu::TextureFormat, size: (u32, u32)) -> wgpu::Texture {
        device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        })
    }

    fn bind(
        device: &wgpu::Device,
        layout: &wgpu::BindGroupLayout,
        camera: &wgpu::Buffer,
        style: &wgpu::Buffer,
        values: &wgpu::Texture,
        lut: &wgpu::Texture,
    ) -> wgpu::BindGroup {
        let values = values.create_view(&Default::default());
        let lut = lut.create_view(&Default::default());
        device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("chart-heatmap-bg"),
            layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: camera.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: style.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&values) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&lut) },
            ],
        })
    }

    fn write(queue: &wgpu::Queue, texture: &wgpu::Texture, origin_y: u32, bytes: &[u8], texel: u32, size: (u32, u32)) {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x: 0, y: origin_y, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            bytes,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(size.0 * texel), rows_per_image: None },
            wgpu::Extent3d { width: size.0, height: size.1, depth_or_array_layers: 1 },
        );
    }

    /// Uploads the value grid; the texture (and bind group) is recreated only when its size
    /// changes. Cells beyond `max_dim x max_dim` texels are dropped (the shader draws them empty).
    pub(super) fn upload_grid(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, camera: &wgpu::Buffer, grid: &ChartHeatmapGrid<'_>) {
        let max_dim = device.limits().max_texture_dimension_2d.max(1) as usize;
        let cells = grid.values.len().min(max_dim * max_dim);
        self.active = cells > 0 && grid.cols > 0 && grid.rows > 0;
        let width = cells.clamp(1, max_dim);
        let height = cells.div_ceil(width).max(1);
        let size = self.values.size();
        if (size.width as usize, size.height as usize) != (width, height) {
            self.values = Self::texture(device, "chart-heatmap-values", wgpu::TextureFormat::R32Float, (width as u32, height as u32));
            self.bind_group = Self::bind(device, &self.layout, camera, &self.style_buffer, &self.values, &self.lut);
        }
        if self.active {
            // Full rows in one copy, then the partial last row (no padded copy of 16M cells)
            let full = cells / width;
            let values = &grid.values[..cells];
            if full > 0 {
                Self::write(queue, &self.values, 0, bytemuck::cast_slice(&values[..full * width]), 4, (width as u32, full as u32));
            }
            let rest = cells - full * width;
            if rest > 0 {
                Self::write(queue, &self.values, full as u32, bytemuck::cast_slice(&values[full * width..]), 4, (rest as u32, 1));
            }
        }
        self.style.grid[2] = width as u32;
        queue.write_buffer(&self.style_buffer, 0, bytemuck::bytes_of(&self.style));
    }

    pub(super) fn upload_lut(&mut self, queue: &wgpu::Queue, lut: &[[u8; 4]]) {
        let n = lut.len().min(HEATMAP_LUT_SIZE);
        if n > 0 {
            Self::write(queue, &self.lut, 0, bytemuck::cast_slice(&lut[..n]), 4, (n as u32, 1));
        }
    }

    pub(super) fn upload_style(&mut self, queue: &wgpu::Queue, style: ChartHeatmapStyleRaw) {
        let width = self.values.width();
        self.style = ChartHeatmapStyleRaw { grid: [style.grid[0], style.grid[1], width, style.grid[3]], ..style };
        queue.write_buffer(&self.style_buffer, 0, bytemuck::bytes_of(&self.style));
    }
}
