//! Parallel GPU Barnes-Hut repulsion over the GPU-built octree (`gpu_tree.rs`), the first
//! force pass of the GPU layout step (`gpu_layout.rs`).
use super::gpu_tree::GpuTree;
use crate::physics::ForceConfig;
use wgpu::util::DeviceExt;

const SHADER: &str = include_str!("gpu_repulsion.wgsl");

pub(super) struct Storage {
    pub(super) buffer: wgpu::Buffer,
    pub(super) bytes: u64,
}

impl Storage {
    pub(super) fn new(device: &wgpu::Device, bytes: u64) -> Self {
        Self {
            buffer: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("layout-storage"), size: bytes.max(32),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            bytes: bytes.max(32),
        }
    }

    pub(super) fn ensure(&mut self, device: &wgpu::Device, bytes: u64, max: u64) {
        if bytes > self.bytes { *self = Self::new(device, bytes.next_power_of_two().min(max)); }
    }
}

pub struct GpuRepulsion {
    pipeline: wgpu::ComputePipeline,
    forces: Storage,
    params: wgpu::Buffer,
}

impl GpuRepulsion {
    pub fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("layout-repulsion"), source: wgpu::ShaderSource::Wgsl(SHADER.into()),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("layout-repulsion"), layout: None, module: &shader, entry_point: Some("main"),
            compilation_options: Default::default(), cache: None,
        });
        Self {
            pipeline,
            forces: Storage::new(device, 32),
            // WGSL vec3 padding starts at byte 32, giving the uniform a 48-byte footprint.
            params: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("layout-params"), contents: &[0; 48],
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            }),
        }
    }

    /// Records the repulsion pass over `tree` (built for `count` bodies); results land in
    /// `forces()` (xyzw per node).
    pub fn encode(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, tree: &GpuTree, count: u32, config: ForceConfig) -> Result<(), String> {
        let limits = device.limits();
        let max = u64::from(limits.max_storage_buffer_binding_size).min(limits.max_buffer_size);
        let bytes = u64::from(count) * 16;
        let groups = count.div_ceil(64);
        if count == 0 || bytes > max || groups > limits.max_compute_workgroups_per_dimension {
            return Err("Graph exceeds GPU layout buffer/dispatch limits".into());
        }
        self.forces.ensure(device, bytes, max);
        let params = [count, 0, (config.theta * config.theta).to_bits(), config.repulsion_strength.to_bits(), config.softening.to_bits(), 0, 0, 0, 0, 0, 0, 0];
        queue.write_buffer(&self.params, 0, bytemuck::cast_slice(&params));
        let buffers = [tree.bodies(), tree.cells(), &self.forces.buffer, &self.params, tree.header()];
        let entries: Vec<_> = buffers.iter().enumerate().map(|(i, b)| wgpu::BindGroupEntry { binding: i as u32, resource: b.as_entire_binding() }).collect();
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("layout-bind"), layout: &self.pipeline.get_bind_group_layout(0), entries: &entries,
        });
        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("layout-repulsion"), timestamp_writes: None });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &bind, &[]);
        pass.dispatch_workgroups(groups, 1, 1);
        Ok(())
    }

    pub fn forces(&self) -> &wgpu::Buffer { &self.forces.buffer }

    pub fn bytes(&self) -> u64 { self.forces.bytes + 48 }
}

#[cfg(test)]
mod tests {
    #[test]
    fn compute_shader_and_storage_layouts_are_valid() {
        let module = naga::front::wgsl::parse_str(super::SHADER).expect("parse layout shader");
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all()).validate(&module).expect("validate layout shader");
        assert_eq!(std::mem::size_of::<crate::spatial::GpuForceBody>(), 32);
        assert_eq!(std::mem::size_of::<crate::spatial::GpuForceCell>(), 32);
    }
}
