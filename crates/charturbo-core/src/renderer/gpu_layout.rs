//! GPU layout step: Barnes-Hut repulsion, center gravity, CSR spring gather and
//! semi-implicit Euler integration in one submission, matching `ForceDirectedSimulator::step`.
//! The octree is built on the GPU (`gpu_tree.rs`); the CPU applies the read-back state
//! (`apply_gpu_step`).
use super::gpu_repulsion::{GpuRepulsion, Storage};
use super::gpu_tree::GpuTree;
use crate::domain::{EdgeData, GraphDataset};
use crate::physics::ForceConfig;
use wgpu::util::DeviceExt;

const STEP_SHADER: &str = include_str!("gpu_layout_step.wgsl");

/// Per-node GPU state: xyz + mass, velocity + pinned flag (1 = pinned).
#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuNodeState {
    pub position_mass: [f32; 4],
    pub velocity_pinned: [f32; 4],
}

/// One layout step's inputs. The CSR (`offsets`, `edge_ids`, `edges`) is uploaded only when
/// `topology` differs from the last upload.
pub struct GpuLayoutStep<'a> {
    pub nodes: Vec<GpuNodeState>,
    pub offsets: &'a [u32],
    pub edge_ids: &'a [u32],
    pub edges: &'a [EdgeData],
    pub topology: u64,
    pub config: ForceConfig,
    pub dt: f32,
}

impl<'a> GpuLayoutStep<'a> {
    pub fn new(dataset: &'a GraphDataset, config: ForceConfig, dt: f32) -> Self {
        let adjacency = dataset.adjacency();
        let nodes = dataset.nodes().iter().map(|n| {
            let (p, v) = (n.position(), n.velocity());
            GpuNodeState { position_mass: [p.x, p.y, p.z, n.mass()], velocity_pinned: [v.x, v.y, v.z, if n.is_pinned() { 1.0 } else { 0.0 }] }
        }).collect();
        Self { nodes, offsets: &adjacency.offsets, edge_ids: &adjacency.edge_ids, edges: dataset.edges(), topology: dataset.topology_revision(), config, dt }
    }
}

pub struct GpuLayout {
    tree: GpuTree,
    repulsion: GpuRepulsion,
    pipeline: wgpu::ComputePipeline,
    state_in: Storage,
    state_out: Storage,
    energy: Storage,
    offsets: Storage,
    edge_ids: Storage,
    edges: Storage,
    params: wgpu::Buffer,
    topology: Option<u64>,
}

/// Staging copy of `[state_out (8 floats per node), energy (1 float per node)]`.
pub struct GpuReadback {
    #[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
    buffer: wgpu::Buffer,
}

impl GpuLayout {
    pub fn new(device: &wgpu::Device) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("layout-step"), source: wgpu::ShaderSource::Wgsl(STEP_SHADER.into()),
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("layout-step"), layout: None, module: &shader, entry_point: Some("main"),
            compilation_options: Default::default(), cache: None,
        });
        let storage = || Storage::new(device, 32);
        Self {
            tree: GpuTree::new(device), repulsion: GpuRepulsion::new(device), pipeline,
            state_in: storage(), state_out: storage(), energy: storage(), offsets: storage(), edge_ids: storage(), edges: storage(),
            params: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("layout-step-params"), contents: &[0; 32],
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            }),
            topology: None,
        }
    }

    pub fn submit(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, step: &GpuLayoutStep) -> Result<GpuReadback, String> {
        let limits = device.limits();
        let max = u64::from(limits.max_storage_buffer_binding_size).min(limits.max_buffer_size);
        let n = step.nodes.len() as u64;
        let (state_bytes, edge_bytes) = (n * 32, std::mem::size_of_val(step.edges) as u64);
        if n == 0 || step.offsets.len() as u64 != n + 1 || [state_bytes, edge_bytes, step.offsets.len() as u64 * 4, step.edge_ids.len() as u64 * 4].iter().any(|&b| b > max) {
            return Err("Graph exceeds GPU layout buffer/dispatch limits".into());
        }
        let dt = if step.dt.is_finite() { step.dt.clamp(0.0, 0.05) } else { 0.0 };
        let c = step.config;
        for s in [&mut self.state_in, &mut self.state_out] { s.ensure(device, state_bytes, max); }
        self.energy.ensure(device, n * 4, max);
        queue.write_buffer(&self.state_in.buffer, 0, bytemuck::cast_slice(&step.nodes));
        let mut encoder = device.create_command_encoder(&Default::default());
        self.tree.encode(device, queue, &mut encoder, &self.state_in.buffer, n as u32)?;
        self.repulsion.encode(device, queue, &mut encoder, &self.tree, n as u32, c)?;
        if self.topology != Some(step.topology) {
            for (storage, data) in [(&mut self.offsets, bytemuck::cast_slice(step.offsets)), (&mut self.edge_ids, bytemuck::cast_slice(step.edge_ids)), (&mut self.edges, bytemuck::cast_slice(step.edges))] {
                storage.ensure(device, data.len() as u64, max);
                if !data.is_empty() { queue.write_buffer(&storage.buffer, 0, data); }
            }
            self.topology = Some(step.topology);
        }
        let params = [n as u32, dt.to_bits(), c.spring_stiffness.to_bits(), c.spring_rest_length.to_bits(), c.center_gravity.to_bits(), c.damping.powf(dt * 60.0).to_bits(), c.max_speed.to_bits(), 0];
        queue.write_buffer(&self.params, 0, bytemuck::cast_slice(&params));
        let buffers = [&self.state_in.buffer, self.repulsion.forces(), &self.offsets.buffer, &self.edge_ids.buffer, &self.edges.buffer, &self.state_out.buffer, &self.energy.buffer, &self.params];
        let entries: Vec<_> = buffers.iter().enumerate().map(|(i, b)| wgpu::BindGroupEntry { binding: i as u32, resource: b.as_entire_binding() }).collect();
        let bind = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("layout-step-bind"), layout: &self.pipeline.get_bind_group_layout(0), entries: &entries,
        });
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("layout-step"), timestamp_writes: None });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, &bind, &[]);
            pass.dispatch_workgroups((n as u32).div_ceil(64), 1, 1);
        }
        // A job owns its staging buffer: another request cannot reuse a mapped/in-flight readback.
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("layout-readback"), size: state_bytes + n * 4,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
        });
        encoder.copy_buffer_to_buffer(&self.state_out.buffer, 0, &buffer, 0, state_bytes);
        encoder.copy_buffer_to_buffer(&self.energy.buffer, 0, &buffer, state_bytes, n * 4);
        queue.submit(Some(encoder.finish()));
        Ok(GpuReadback { buffer })
    }

    pub fn bytes(&self) -> u64 {
        self.tree.bytes() + self.repulsion.bytes() + [&self.state_in, &self.state_out, &self.energy, &self.offsets, &self.edge_ids, &self.edges].iter().map(|s| s.bytes).sum::<u64>() + 32
    }
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
impl GpuReadback {
    fn read_blocking(self, device: &wgpu::Device) -> Result<Vec<f32>, String> {
        let (tx, rx) = std::sync::mpsc::channel();
        self.buffer.slice(..).map_async(wgpu::MapMode::Read, move |r| { let _ = tx.send(r); });
        device.poll(wgpu::Maintain::Wait);
        rx.recv().map_err(|e| e.to_string())?.map_err(|e| e.to_string())?;
        let values = bytemuck::cast_slice::<u8, f32>(&self.buffer.slice(..).get_mapped_range()).to_vec();
        self.buffer.unmap();
        Ok(values)
    }
}

/// Native (Metal / Vulkan / DX12) device for GPU parity tests; None without an adapter.
#[cfg(test)]
pub(crate) mod test_device {
    use std::future::Future;
    use std::task::{Context, Poll, Waker};

    fn block_on<F: Future>(future: F) -> F::Output {
        let mut future = std::pin::pin!(future);
        let mut cx = Context::from_waker(Waker::noop());
        loop {
            if let Poll::Ready(v) = future.as_mut().poll(&mut cx) { return v; }
            std::thread::yield_now();
        }
    }

    pub fn get() -> Option<(wgpu::Device, wgpu::Queue)> {
        let instance = wgpu::Instance::new(&wgpu::InstanceDescriptor::default());
        let adapter = block_on(instance.request_adapter(&wgpu::RequestAdapterOptions::default()))?;
        block_on(adapter.request_device(&wgpu::DeviceDescriptor::default(), None)).ok()
    }
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{DatasetConfig, GraphDataset};
    use crate::physics::{ForceConfig, ForceDirectedSimulator, LayoutSimulator};
    use crate::spatial::OctreeSpatialIndex;
    use glam::Vec3;

    #[test]
    fn step_shader_is_valid() {
        let module = naga::front::wgsl::parse_str(STEP_SHADER).expect("parse step shader");
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all()).validate(&module).expect("validate step shader");
        assert_eq!(std::mem::size_of::<GpuNodeState>(), 32);
        assert_eq!(std::mem::size_of::<crate::domain::EdgeData>(), 12);
    }

    fn graph(n: usize) -> GraphDataset {
        let mut ds = GraphDataset::generate_seeded(&DatasetConfig { node_count: n, edge_count: n * 2, ..Default::default() });
        // Coincident pair, self-loop, duplicate edge and a pinned node exercise every branch.
        let p = ds.nodes()[0].position();
        ds.set_node_position(1, p);
        ds.add_edge(3, 3, 1.0).unwrap();
        ds.add_edge(4, 5, 1.0).unwrap();
        ds.add_edge(4, 5, 0.5).unwrap();
        ds.set_node_pinned(2, true);
        ds
    }

    /// Runs `steps` GPU steps fed back through `apply_gpu_step`, against the CPU simulator.
    fn compare(n: usize, steps: usize, theta: f32) {
        let Some((device, queue)) = test_device::get() else {
            eprintln!("skipping GPU layout parity: no native GPU adapter");
            return;
        };
        let config = ForceConfig { theta, ..ForceConfig::default() };
        let (mut cpu_ds, mut gpu_ds) = (graph(n), graph(n));
        let mut cpu = ForceDirectedSimulator::new(OctreeSpatialIndex::default(), config);
        let mut gpu = ForceDirectedSimulator::new(OctreeSpatialIndex::default(), config);
        cpu.rebuild_spatial_index(&cpu_ds);
        gpu.rebuild_spatial_index(&gpu_ds);
        let mut layout = GpuLayout::new(&device);
        let pinned = gpu_ds.nodes()[2].position();
        for _ in 0..steps {
            cpu.step(&mut cpu_ds, 0.016);
            let readback = layout.submit(&device, &queue, &GpuLayoutStep::new(&gpu_ds, config, 0.016)).unwrap();
            let values = readback.read_blocking(&device).unwrap();
            assert!(gpu.apply_gpu_step(&mut gpu_ds, &values));
        }
        let error = cpu_ds.nodes().iter().zip(gpu_ds.nodes()).map(|(a, b)| (a.position() - b.position()).abs().max_element()).fold(0.0, f32::max);
        let (ke_cpu, ke_gpu) = (cpu.kinetic_energy().unwrap(), gpu.kinetic_energy().unwrap());
        assert!(error < 0.02, "n={n} theta={theta}: max coordinate error {error}");
        assert!((ke_cpu - ke_gpu).abs() <= ke_cpu.abs() * 0.005, "n={n} theta={theta}: energy {ke_cpu} vs {ke_gpu}");
        assert_eq!(gpu_ds.nodes()[2].position(), pinned);
        assert_eq!(gpu_ds.nodes()[2].velocity(), Vec3::ZERO);
    }

    #[test]
    fn gpu_step_matches_cpu_exact_repulsion() { compare(64, 8, 0.0); }

    #[test]
    fn gpu_step_matches_cpu_barnes_hut() { compare(2_000, 16, 0.75); }
}
