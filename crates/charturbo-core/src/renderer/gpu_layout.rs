//! GPU-resident layout: positions and velocities live in GPU buffers across steps. Each step
//! builds the octree (`gpu_tree.rs`), applies Barnes-Hut repulsion, center gravity, CSR spring
//! gather and semi-implicit Euler integration (matching `ForceDirectedSimulator::step`), and
//! counts auto-sleep calm steps. The CPU uploads only its own layout edits and adopts
//! asynchronous readbacks; readbacks submitted before the latest CPU write are discarded.
use super::gpu_repulsion::{GpuRepulsion, Storage};
use super::gpu_tree::GpuTree;
use crate::domain::{EdgeData, GraphDataset, NodeData};
use crate::physics::ForceConfig;
use std::sync::{Arc, Mutex};
use wgpu::util::DeviceExt;

const STEP_SHADER: &str = include_str!("gpu_layout_step.wgsl");
const STATS_BYTES: u64 = 16;

/// Per-node GPU state: xyz + mass, velocity + pinned flag (1 = pinned).
#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, bytemuck::Pod, bytemuck::Zeroable)]
pub struct GpuNodeState {
    pub position_mass: [f32; 4],
    pub velocity_pinned: [f32; 4],
}

pub fn node_state(n: &NodeData) -> GpuNodeState {
    let (p, v) = (n.position(), n.velocity());
    GpuNodeState { position_mass: [p.x, p.y, p.z, n.mass()], velocity_pinned: [v.x, v.y, v.z, if n.is_pinned() { 1.0 } else { 0.0 }] }
}

pub fn node_states(dataset: &GraphDataset) -> Vec<GpuNodeState> {
    dataset.nodes().iter().map(node_state).collect()
}

/// CPU layout edits to push before a step.
#[derive(Clone, Copy)]
pub enum GpuStateWrite<'a> {
    Keep,
    /// Replace every node (also resizes the resident layout)
    Full(&'a [GpuNodeState]),
    /// Overwrite individual nodes
    Nodes(&'a [(u32, GpuNodeState)]),
}

/// Auto-sleep inputs; `reset` restarts the calm streak and wakes the layout.
#[derive(Debug, Clone, Copy)]
pub struct GpuSleep {
    pub enabled: bool,
    pub threshold: f32,
    /// Unpinned node count (the energy mean's divisor)
    pub free: u32,
    pub reset: bool,
}

/// One layout step. The CSR (`offsets`, `edge_ids`, `edges`) is uploaded only when `topology`
/// differs from the last upload.
pub struct GpuLayoutStep<'a> {
    pub write: GpuStateWrite<'a>,
    pub count: u32,
    pub offsets: &'a [u32],
    pub edge_ids: &'a [u32],
    pub edges: &'a [EdgeData],
    pub topology: u64,
    pub config: ForceConfig,
    pub dt: f32,
    pub sleep: GpuSleep,
}

impl<'a> GpuLayoutStep<'a> {
    pub fn new(dataset: &'a GraphDataset, write: GpuStateWrite<'a>, config: ForceConfig, dt: f32, sleep: GpuSleep) -> Self {
        let adjacency = dataset.adjacency();
        Self {
            write, count: dataset.node_count() as u32, offsets: &adjacency.offsets, edge_ids: &adjacency.edge_ids,
            edges: dataset.edges(), topology: dataset.topology_revision(), config, dt, sleep,
        }
    }
}

/// Layout state read back from the GPU: 8 floats per node (`GpuNodeState`) and sleep stats.
#[derive(Debug, Clone, PartialEq)]
pub struct GpuLayoutReadback {
    /// CPU write generation the readback was submitted under
    pub epoch: u64,
    /// Steps submitted when it was captured (readbacks may complete out of order)
    pub step: u64,
    pub state: Vec<f32>,
    /// Kinetic energy of the last step
    pub energy: f32,
    pub calm_steps: u32,
    pub sleeping: bool,
}

#[derive(Default)]
struct Slot {
    in_flight: bool,
    result: Option<GpuLayoutReadback>,
}

type SharedSlot = Arc<Mutex<Slot>>;

/// Maps `buffer` (`count` node states + stats) and stores the parsed readback in `slot`.
fn map_into(buffer: wgpu::Buffer, slot: SharedSlot, (epoch, step): (u64, u64), count: usize, done: impl FnOnce(Result<(), String>) + wgpu::WasmNotSend + 'static) {
    let mapped = buffer.clone();
    buffer.slice(..).map_async(wgpu::MapMode::Read, move |result| {
        let mut s = slot.lock().unwrap();
        s.in_flight = false;
        let outcome = result.map_err(|e| format!("GPU layout readback failed: {e}")).map(|()| {
            let data = mapped.slice(..).get_mapped_range();
            let floats: &[f32] = bytemuck::cast_slice(&data);
            let stats: &[u32] = bytemuck::cast_slice(&floats[count * 8..]);
            s.result = Some(GpuLayoutReadback {
                epoch, step, state: floats[..count * 8].to_vec(), energy: floats[count * 8], calm_steps: stats[1], sleeping: stats[2] != 0,
            });
        });
        if outcome.is_ok() { mapped.unmap(); }
        drop(s);
        done(outcome);
    });
}

/// An explicit full-state readback (`syncPhysicsPositions`), resolved into `take_sync`.
#[cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
pub struct GpuSync {
    buffer: wgpu::Buffer,
    slot: SharedSlot,
    /// (epoch, step) at submission
    at: (u64, u64),
    count: usize,
}

impl GpuSync {
    /// Resolves to `ticket` once `take_sync` holds the result.
    #[cfg(target_arch = "wasm32")]
    pub fn into_promise(self, ticket: u32) -> js_sys::Promise {
        let mut sync = Some(self);
        js_sys::Promise::new(&mut move |resolve, reject| {
            let Some(Self { buffer, slot, at, count }) = sync.take() else { return };
            map_into(buffer, slot, at, count, move |r| {
                let _ = match r {
                    Ok(()) => resolve.call1(&wasm_bindgen::JsValue::NULL, &ticket.into()),
                    Err(e) => reject.call1(&wasm_bindgen::JsValue::NULL, &js_sys::Error::new(&e)),
                };
            });
        })
    }

    #[cfg(test)]
    fn wait(self, device: &wgpu::Device) -> Result<(), String> {
        let result = Arc::new(Mutex::new(None));
        let out = result.clone();
        map_into(self.buffer, self.slot, self.at, self.count, move |r| { *out.lock().unwrap() = Some(r); });
        device.poll(wgpu::Maintain::Wait);
        let r = result.lock().unwrap().take();
        r.unwrap_or_else(|| Err("GPU layout readback did not complete".into()))
    }
}

pub struct GpuLayout {
    tree: GpuTree,
    repulsion: GpuRepulsion,
    step: wgpu::ComputePipeline,
    stats_partial: wgpu::ComputePipeline,
    stats_final: wgpu::ComputePipeline,
    /// `state[current]` holds the latest layout; a step writes the other buffer, then swaps.
    state: [Storage; 2],
    current: usize,
    energy: Storage,
    partials: Storage,
    stats: Storage,
    offsets: Storage,
    edge_ids: Storage,
    edges: Storage,
    params: wgpu::Buffer,
    count: u32,
    topology: Option<u64>,
    /// Bumped by every CPU write; readbacks carry the epoch they were submitted under.
    epoch: u64,
    /// Submitted steps, and the step of the newest readback handed out
    steps: u64,
    taken: u64,
    periodic: SharedSlot,
    periodic_buffer: Option<wgpu::Buffer>,
    sync: SharedSlot,
}

impl GpuLayout {
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("layout-step"), source: wgpu::ShaderSource::Wgsl(STEP_SHADER.into()),
        });
        let pipeline = |entry: &str| device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(entry), layout: None, module: &module, entry_point: Some(entry), compilation_options: Default::default(), cache: None,
        });
        let storage = || Storage::new(device, 32);
        Self {
            tree: GpuTree::new(device), repulsion: GpuRepulsion::new(device),
            step: pipeline("main"), stats_partial: pipeline("stats_partial"), stats_final: pipeline("stats_final"),
            state: [storage(), storage()], current: 0, energy: storage(), partials: storage(), stats: storage(),
            offsets: storage(), edge_ids: storage(), edges: storage(),
            params: device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
                label: Some("layout-step-params"), contents: &[0; 48],
                usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            }),
            count: 0, topology: None, epoch: 0, steps: 0, taken: 0,
            periodic: Default::default(), periodic_buffer: None, sync: Default::default(),
        }
    }

    fn max_bytes(device: &wgpu::Device) -> u64 {
        let limits = device.limits();
        u64::from(limits.max_storage_buffer_binding_size).min(limits.max_buffer_size)
    }

    /// Pushes CPU layout edits into the resident state; supersedes in-flight readbacks.
    pub fn write(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, write: GpuStateWrite) -> Result<(), String> {
        match write {
            GpuStateWrite::Keep => return Ok(()),
            GpuStateWrite::Full(nodes) => {
                let (bytes, max) = (std::mem::size_of_val(nodes) as u64, Self::max_bytes(device));
                if nodes.is_empty() || bytes > max { return Err("Graph exceeds GPU layout buffer/dispatch limits".into()); }
                for s in &mut self.state { s.ensure(device, bytes, max); }
                queue.write_buffer(&self.state[self.current].buffer, 0, bytemuck::cast_slice(nodes));
                self.count = nodes.len() as u32;
            }
            GpuStateWrite::Nodes(nodes) => {
                if self.count == 0 { return Err("GPU layout has no resident state".into()); }
                for (id, state) in nodes.iter().filter(|(id, _)| *id < self.count) {
                    queue.write_buffer(&self.state[self.current].buffer, u64::from(*id) * 32, bytemuck::bytes_of(state));
                }
            }
        }
        self.epoch += 1;
        Ok(())
    }

    pub fn submit(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, step: &GpuLayoutStep) -> Result<(), String> {
        self.write(device, queue, step.write)?;
        if step.count != self.count || self.count == 0 { return Err("GPU layout state does not match the graph".into()); }
        let max = Self::max_bytes(device);
        let n = u64::from(self.count);
        let edge_bytes = std::mem::size_of_val(step.edges) as u64;
        if step.offsets.len() as u64 != n + 1 || [edge_bytes, step.offsets.len() as u64 * 4, step.edge_ids.len() as u64 * 4].iter().any(|&b| b > max) {
            return Err("Graph exceeds GPU layout buffer/dispatch limits".into());
        }
        if step.sleep.reset {
            queue.write_buffer(&self.stats.buffer, 0, &[0; STATS_BYTES as usize]);
            self.epoch += 1;
        }
        if self.topology != Some(step.topology) {
            for (storage, data) in [(&mut self.offsets, bytemuck::cast_slice(step.offsets)), (&mut self.edge_ids, bytemuck::cast_slice(step.edge_ids)), (&mut self.edges, bytemuck::cast_slice(step.edges))] {
                storage.ensure(device, data.len() as u64, max);
                if !data.is_empty() { queue.write_buffer(&storage.buffer, 0, data); }
            }
            self.topology = Some(step.topology);
        }
        let tiles = self.count.div_ceil(256);
        self.energy.ensure(device, n * 4, max);
        self.partials.ensure(device, u64::from(tiles) * 4, max);
        let dt = if step.dt.is_finite() { step.dt.clamp(0.0, 0.05) } else { 0.0 };
        let (c, sleep) = (step.config, step.sleep);
        let params = [
            self.count, dt.to_bits(), c.spring_stiffness.to_bits(), c.spring_rest_length.to_bits(), c.center_gravity.to_bits(),
            c.damping.powf(dt * 60.0).to_bits(), c.max_speed.to_bits(), u32::from(sleep.enabled), sleep.threshold.to_bits(), sleep.free, tiles, 0,
        ];
        queue.write_buffer(&self.params, 0, bytemuck::cast_slice(&params));

        let (from, to) = (self.current, 1 - self.current);
        let mut encoder = device.create_command_encoder(&Default::default());
        self.tree.encode(device, queue, &mut encoder, &self.state[from].buffer, self.count)?;
        self.repulsion.encode(device, queue, &mut encoder, &self.tree, self.count, c)?;
        let bind = |pipeline: &wgpu::ComputePipeline, entries: &[(u32, &wgpu::Buffer)]| {
            let entries: Vec<_> = entries.iter().map(|&(binding, b)| wgpu::BindGroupEntry { binding, resource: b.as_entire_binding() }).collect();
            device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("layout-step-bind"), layout: &pipeline.get_bind_group_layout(0), entries: &entries })
        };
        let passes = [
            (&self.step, bind(&self.step, &[(0, &self.state[from].buffer), (1, self.repulsion.forces()), (2, &self.offsets.buffer), (3, &self.edge_ids.buffer), (4, &self.edges.buffer), (5, &self.state[to].buffer), (6, &self.energy.buffer), (7, &self.params), (9, &self.stats.buffer)]), self.count.div_ceil(64)),
            (&self.stats_partial, bind(&self.stats_partial, &[(6, &self.energy.buffer), (7, &self.params), (8, &self.partials.buffer)]), tiles),
            (&self.stats_final, bind(&self.stats_final, &[(7, &self.params), (8, &self.partials.buffer), (9, &self.stats.buffer)]), 1),
        ];
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("layout-step"), timestamp_writes: None });
            for (pipeline, bind, groups) in &passes {
                pass.set_pipeline(pipeline);
                pass.set_bind_group(0, bind, &[]);
                pass.dispatch_workgroups(*groups, 1, 1);
            }
        }
        self.current = to;
        self.steps += 1;
        // At most one periodic readback in flight: the CPU copy trails by a frame or two.
        let issue = {
            let mut slot = self.periodic.lock().unwrap();
            let free = !slot.in_flight;
            slot.in_flight = true;
            free
        };
        let readback = issue.then(|| {
            let size = n * 32 + STATS_BYTES;
            if self.periodic_buffer.as_ref().map(|b| b.size()) != Some(size) {
                self.periodic_buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
                    label: Some("layout-readback"), size, usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
                }));
            }
            let buffer = self.periodic_buffer.clone().unwrap();
            self.copy_state(&mut encoder, &buffer);
            buffer
        });
        queue.submit(Some(encoder.finish()));
        if let Some(buffer) = readback {
            map_into(buffer, self.periodic.clone(), (self.epoch, self.steps), self.count as usize, |_| {});
        }
        Ok(())
    }

    fn copy_state(&self, encoder: &mut wgpu::CommandEncoder, to: &wgpu::Buffer) {
        let bytes = u64::from(self.count) * 32;
        encoder.copy_buffer_to_buffer(&self.state[self.current].buffer, 0, to, 0, bytes);
        encoder.copy_buffer_to_buffer(&self.stats.buffer, 0, to, bytes, STATS_BYTES);
    }

    /// Readbacks newer than any handed out before and not superseded by a CPU write.
    fn accept(&mut self, result: Option<GpuLayoutReadback>) -> Option<GpuLayoutReadback> {
        let r = result.filter(|r| r.epoch == self.epoch && r.step >= self.taken)?;
        self.taken = r.step;
        Some(r)
    }

    /// Latest periodic readback (see `accept`).
    pub fn take_readback(&mut self) -> Option<GpuLayoutReadback> {
        let result = self.periodic.lock().unwrap().result.take();
        self.accept(result)
    }

    /// Full-state readback ordered after every submitted step and write.
    pub fn request_sync(&mut self, device: &wgpu::Device, queue: &wgpu::Queue) -> Result<GpuSync, String> {
        if self.count == 0 { return Err("GPU layout has no resident state".into()); }
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("layout-sync"), size: u64::from(self.count) * 32 + STATS_BYTES,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
        });
        let mut encoder = device.create_command_encoder(&Default::default());
        self.copy_state(&mut encoder, &buffer);
        queue.submit(Some(encoder.finish()));
        Ok(GpuSync { buffer, slot: self.sync.clone(), at: (self.epoch, self.steps), count: self.count as usize })
    }

    pub fn take_sync(&mut self) -> Option<GpuLayoutReadback> {
        let result = self.sync.lock().unwrap().result.take();
        self.accept(result)
    }

    pub fn bytes(&self) -> u64 {
        self.tree.bytes() + self.repulsion.bytes() + self.periodic_buffer.as_ref().map_or(0, |b| b.size())
            + self.state.iter().chain([&self.energy, &self.partials, &self.stats, &self.offsets, &self.edge_ids, &self.edges]).map(|s| s.bytes).sum::<u64>() + 48
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

    const OFF: GpuSleep = GpuSleep { enabled: false, threshold: 0.0, free: 0, reset: false };

    fn step<'a>(ds: &'a GraphDataset, write: GpuStateWrite<'a>, config: ForceConfig, sleep: GpuSleep) -> GpuLayoutStep<'a> {
        GpuLayoutStep::new(ds, write, config, 0.016, sleep)
    }

    fn sync(layout: &mut GpuLayout, device: &wgpu::Device, queue: &wgpu::Queue) -> GpuLayoutReadback {
        layout.request_sync(device, queue).unwrap().wait(device).unwrap();
        layout.take_sync().expect("sync readback")
    }

    /// GPU-resident steps (one upload, no per-step readback) against the CPU simulator.
    fn compare(n: usize, steps: usize, theta: f32) {
        let Some((device, queue)) = test_device::get() else { return eprintln!("skipping GPU layout parity: no native GPU adapter") };
        let config = ForceConfig { theta, ..ForceConfig::default() };
        let (mut cpu_ds, mut gpu_ds) = (graph(n), graph(n));
        let mut cpu = ForceDirectedSimulator::new(OctreeSpatialIndex::default(), config);
        cpu.rebuild_spatial_index(&cpu_ds);
        let mut layout = GpuLayout::new(&device);
        let pinned = gpu_ds.nodes()[2].position();
        gpu_ds.take_layout_dirty();
        let states = node_states(&gpu_ds);
        for i in 0..steps {
            cpu.step(&mut cpu_ds, 0.016);
            let write = if i == 0 { GpuStateWrite::Full(&states) } else { GpuStateWrite::Keep };
            layout.submit(&device, &queue, &step(&gpu_ds, write, config, OFF)).unwrap();
        }
        let result = sync(&mut layout, &device, &queue);
        assert!(gpu_ds.adopt_gpu_layout(&result.state));
        let error = cpu_ds.nodes().iter().zip(gpu_ds.nodes()).map(|(a, b)| (a.position() - b.position()).abs().max_element()).fold(0.0, f32::max);
        let ke = cpu.kinetic_energy().unwrap();
        assert!(error < 0.02, "n={n} theta={theta}: max coordinate error {error}");
        assert!((ke - result.energy).abs() <= ke.abs() * 0.005, "n={n} theta={theta}: energy {ke} vs {}", result.energy);
        assert_eq!(gpu_ds.nodes()[2].position(), pinned);
        assert_eq!(gpu_ds.nodes()[2].velocity(), Vec3::ZERO);
    }

    #[test]
    fn resident_steps_match_cpu_exact_repulsion() { compare(64, 8, 0.0); }

    #[test]
    fn resident_steps_match_cpu_barnes_hut() { compare(2_000, 16, 0.75); }

    #[test]
    fn node_writes_supersede_in_flight_readbacks_and_reach_the_next_step() {
        let Some((device, queue)) = test_device::get() else { return eprintln!("skipping GPU layout writes: no native GPU adapter") };
        let ds = graph(200);
        let config = ForceConfig::default();
        let mut layout = GpuLayout::new(&device);
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Full(&node_states(&ds)), config, OFF)).unwrap();
        // That step issued a periodic readback; a CPU edit after it makes the readback stale.
        let moved = GpuNodeState { position_mass: [500.0, 0.0, 0.0, 1.0], velocity_pinned: [0.0, 0.0, 0.0, 1.0] };
        layout.write(&device, &queue, GpuStateWrite::Nodes(&[(7, moved)])).unwrap();
        device.poll(wgpu::Maintain::Wait);
        assert!(layout.take_readback().is_none());
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, OFF)).unwrap();
        device.poll(wgpu::Maintain::Wait);
        let periodic = layout.take_readback().expect("fresh periodic readback");
        assert_eq!(&periodic.state[7 * 8..7 * 8 + 3], &[500.0, 0.0, 0.0], "pinned write survives the step");
        assert_eq!(sync(&mut layout, &device, &queue).state, periodic.state);
    }

    #[test]
    fn readbacks_older_than_an_adopted_one_are_dropped() {
        let Some((device, queue)) = test_device::get() else { return eprintln!("skipping GPU readback order: no native GPU adapter") };
        let ds = graph(200);
        let config = ForceConfig::default();
        let mut layout = GpuLayout::new(&device);
        // Step 1 issues the periodic readback; step 2 cannot (one in flight).
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Full(&node_states(&ds)), config, OFF)).unwrap();
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, OFF)).unwrap();
        let synced = sync(&mut layout, &device, &queue);
        assert_eq!(synced.step, 2);
        device.poll(wgpu::Maintain::Wait);
        assert!(layout.take_readback().is_none(), "step 1 readback arrived after the step 2 sync");
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, OFF)).unwrap();
        device.poll(wgpu::Maintain::Wait);
        assert_eq!(layout.take_readback().map(|r| r.step), Some(3));
    }

    #[test]
    fn gpu_sleep_counts_calm_steps_and_freezes_the_layout() {
        let Some((device, queue)) = test_device::get() else { return eprintln!("skipping GPU sleep: no native GPU adapter") };
        let ds = graph(100);
        let config = ForceConfig::default();
        let calm = GpuSleep { enabled: true, threshold: f32::MAX, free: 99, reset: false };
        let mut layout = GpuLayout::new(&device);
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Full(&node_states(&ds)), config, calm)).unwrap();
        for _ in 1..29 { layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, calm)).unwrap(); }
        let awake = sync(&mut layout, &device, &queue);
        assert_eq!((awake.calm_steps, awake.sleeping), (29, false));
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, calm)).unwrap();
        let asleep = sync(&mut layout, &device, &queue);
        assert_eq!((asleep.calm_steps, asleep.sleeping), (30, true));
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, calm)).unwrap();
        assert_eq!(sync(&mut layout, &device, &queue).state, asleep.state, "a sleeping layout must not move");
        let woken = GpuSleep { reset: true, ..calm };
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, woken)).unwrap();
        let moving = sync(&mut layout, &device, &queue);
        assert_eq!((moving.calm_steps, moving.sleeping), (1, false));
        assert_ne!(moving.state, asleep.state);
        // Disabled auto-sleep leaves the streak untouched, like the CPU engine.
        layout.submit(&device, &queue, &step(&ds, GpuStateWrite::Keep, config, GpuSleep { enabled: false, ..calm })).unwrap();
        assert_eq!(sync(&mut layout, &device, &queue).calm_steps, 1);
    }
}
