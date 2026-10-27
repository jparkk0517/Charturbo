//! Opt-in hybrid layout: parallel GPU Barnes-Hut repulsion, CPU springs/integration/index.
//! Readback completes before CPU positions change, preserving picking and export semantics.
use crate::physics::ForceConfig;
use crate::spatial::RepulsionSnapshot;
use wgpu::util::DeviceExt;

const SHADER: &str = include_str!("gpu_repulsion.wgsl");

struct Storage {
    buffer: wgpu::Buffer,
    bytes: u64,
}

impl Storage {
    fn new(device: &wgpu::Device, bytes: u64) -> Self {
        Self {
            buffer: device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("layout-storage"), size: bytes.max(32),
                usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }),
            bytes: bytes.max(32),
        }
    }

    fn ensure(&mut self, device: &wgpu::Device, bytes: u64, max: u64) {
        if bytes > self.bytes { *self = Self::new(device, bytes.next_power_of_two().min(max)); }
    }
}

pub struct GpuRepulsion {
    pipeline: wgpu::ComputePipeline,
    bodies: Storage,
    cells: Storage,
    forces: Storage,
    params: wgpu::Buffer,
}

pub struct GpuReadback {
    #[cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]
    buffer: wgpu::Buffer,
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
            bodies: Storage::new(device, 32), cells: Storage::new(device, 32), forces: Storage::new(device, 32),
            // WGSL vec3 padding starts at byte 32, giving the uniform a 48-byte footprint.
            params: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("layout-params"), contents: &[0; 48],
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            }),
        }
    }

    pub fn submit(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, snapshot: &RepulsionSnapshot, config: ForceConfig) -> Result<GpuReadback, String> {
        let limits = device.limits();
        let max = u64::from(limits.max_storage_buffer_binding_size).min(limits.max_buffer_size);
        let bodies = bytemuck::cast_slice(&snapshot.bodies);
        let cells = bytemuck::cast_slice(&snapshot.cells);
        let count = snapshot.bodies.len() as u32;
        let bytes = u64::from(count) * 16;
        let groups = count.div_ceil(64);
        if count == 0 || bodies.len() as u64 > max || cells.len() as u64 > max || bytes > max || groups > limits.max_compute_workgroups_per_dimension {
            return Err("Graph exceeds GPU layout buffer/dispatch limits".into());
        }
        self.bodies.ensure(device, bodies.len() as u64, max);
        self.cells.ensure(device, cells.len() as u64, max);
        self.forces.ensure(device, bytes, max);
        queue.write_buffer(&self.bodies.buffer, 0, bodies);
        queue.write_buffer(&self.cells.buffer, 0, cells);
        let params = [count, snapshot.cells.len() as u32, (config.theta * config.theta).to_bits(), config.repulsion_strength.to_bits(), config.softening.to_bits(), 0, 0, 0, 0, 0, 0, 0];
        queue.write_buffer(&self.params, 0, bytemuck::cast_slice(&params));
        let buffers = [&self.bodies.buffer, &self.cells.buffer, &self.forces.buffer, &self.params];
        let entries: Vec<_> = buffers.iter().enumerate().map(|(i, b)| wgpu::BindGroupEntry { binding: i as u32, resource: b.as_entire_binding() }).collect();
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("layout-bind"), layout: &self.pipeline.get_bind_group_layout(0), entries: &entries,
        });
        // A job owns its staging buffer: another request cannot reuse a mapped/in-flight readback.
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("layout-readback"), size: bytes,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("layout-repulsion"), timestamp_writes: None });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind, &[]);
            pass.dispatch_workgroups(groups, 1, 1);
        }
        encoder.copy_buffer_to_buffer(&self.forces.buffer, 0, &buffer, 0, bytes);
        queue.submit(Some(encoder.finish()));
        Ok(GpuReadback { buffer })
    }

    pub fn bytes(&self) -> u64 { self.bodies.bytes + self.cells.bytes + self.forces.bytes + 48 }
}

#[cfg(target_arch = "wasm32")]
impl GpuReadback {
    /// Resolve [ticket, Float32Array] without borrowing the engine while the GPU runs.
    pub fn into_promise(self, ticket: u32) -> js_sys::Promise {
        js_sys::Promise::new(&mut move |resolve, reject| {
            let buffer = self.buffer.clone();
            self.buffer.slice(..).map_async(wgpu::MapMode::Read, move |result| {
                match result {
                    Ok(()) => {
                        let mapped = buffer.slice(..).get_mapped_range();
                        let values = js_sys::Float32Array::from(bytemuck::cast_slice::<u8, f32>(&mapped));
                        drop(mapped);
                        buffer.unmap();
                        let response = js_sys::Array::new();
                        response.push(&ticket.into());
                        response.push(&values);
                        let _ = resolve.call1(&wasm_bindgen::JsValue::NULL, &response);
                    }
                    Err(e) => { let _ = reject.call1(&wasm_bindgen::JsValue::NULL, &js_sys::Error::new(&format!("GPU layout readback failed: {e}"))); }
                }
            });
        })
    }
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
