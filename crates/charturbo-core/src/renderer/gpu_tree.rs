//! GPU octree for Barnes-Hut repulsion, built every layout step from GPU-resident positions.
//! Equivalent to `OctreeSpatialIndex` (default max depth 10); see `gpu_tree.wgsl`.
use super::gpu_repulsion::Storage;

const SHADER: &str = include_str!("gpu_tree.wgsl");
const TILE: u32 = 256;
/// 4-bit digits over 32-bit keys (30-bit codes + sentinels)
const SORT_PASSES: u32 = 8;

struct Pipelines {
    bounds_partial: wgpu::ComputePipeline,
    bounds_final: wgpu::ComputePipeline,
    codes: wgpu::ComputePipeline,
    sort_local: wgpu::ComputePipeline,
    sort_scan: wgpu::ComputePipeline,
    sort_scatter: wgpu::ComputePipeline,
    build: wgpu::ComputePipeline,
    reduce: wgpu::ComputePipeline,
    cells: wgpu::ComputePipeline,
    bodies: wgpu::ComputePipeline,
}

pub struct GpuTree {
    pipes: Pipelines,
    header: Storage,
    partials: Storage,
    keys: [Storage; 2],
    vals: [Storage; 2],
    tmp_keys: Storage,
    tmp_vals: Storage,
    hist: Storage,
    tile_start: Storage,
    nodes: Storage,
    leaf_parent: Storage,
    sums: Storage,
    done: [Storage; 2],
    cells: Storage,
    bodies: Storage,
    /// One uniform per radix pass (`shift = 4 * pass`); [0] also serves the other kernels.
    params: Vec<wgpu::Buffer>,
}

fn bind(device: &wgpu::Device, pipeline: &wgpu::ComputePipeline, entries: &[(u32, &wgpu::Buffer)]) -> wgpu::BindGroup {
    let entries: Vec<_> = entries.iter().map(|&(binding, b)| wgpu::BindGroupEntry { binding, resource: b.as_entire_binding() }).collect();
    device.create_bind_group(&wgpu::BindGroupDescriptor { label: Some("layout-tree-bind"), layout: &pipeline.get_bind_group_layout(0), entries: &entries })
}

impl GpuTree {
    pub fn new(device: &wgpu::Device) -> Self {
        let module = device.create_shader_module(wgpu::ShaderModuleDescriptor { label: Some("layout-tree"), source: wgpu::ShaderSource::Wgsl(SHADER.into()) });
        let pipeline = |entry: &str| device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some(entry), layout: None, module: &module, entry_point: Some(entry), compilation_options: Default::default(), cache: None,
        });
        let pipes = Pipelines {
            bounds_partial: pipeline("bounds_partial"), bounds_final: pipeline("bounds_final"), codes: pipeline("codes"),
            sort_local: pipeline("sort_local"), sort_scan: pipeline("sort_scan"), sort_scatter: pipeline("sort_scatter"),
            build: pipeline("tree_build"), reduce: pipeline("tree_reduce"), cells: pipeline("tree_cells"), bodies: pipeline("tree_bodies"),
        };
        let s = || Storage::new(device, 32);
        Self {
            pipes, header: s(), partials: s(), keys: [s(), s()], vals: [s(), s()], tmp_keys: s(), tmp_vals: s(), hist: s(), tile_start: s(),
            nodes: s(), leaf_parent: s(), sums: s(), done: [s(), s()], cells: s(), bodies: s(),
            params: (0..SORT_PASSES).map(|_| device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("layout-tree-params"), size: 16, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false,
            })).collect(),
        }
    }

    /// Records the build for the first `n` records of `state` (`GpuNodeState`).
    pub fn encode(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, state: &wgpu::Buffer, n: u32) -> Result<(), String> {
        let limits = device.limits();
        let max = u64::from(limits.max_storage_buffer_binding_size).min(limits.max_buffer_size);
        let tiles = n.div_ceil(TILE);
        let padded = u64::from(tiles * TILE);
        let (n64, inner) = (u64::from(n), u64::from(n.max(2) - 1));
        let sizes = [
            (&mut self.header, 32), (&mut self.partials, u64::from(tiles) * 32), (&mut self.tmp_keys, padded * 4), (&mut self.tmp_vals, padded * 4),
            (&mut self.hist, u64::from(tiles) * 64), (&mut self.tile_start, u64::from(tiles) * 64), (&mut self.nodes, inner * 32),
            (&mut self.leaf_parent, n64 * 4), (&mut self.sums, inner * 16), (&mut self.cells, n64 * 64), (&mut self.bodies, n64 * 32),
        ];
        if n == 0 || (2 * n64 - 1).div_ceil(64) > u64::from(limits.max_compute_workgroups_per_dimension) || sizes.iter().any(|(_, b)| *b > max) || padded * 4 > max {
            return Err("Graph exceeds GPU layout buffer/dispatch limits".into());
        }
        for (storage, bytes) in sizes { storage.ensure(device, bytes, max); }
        for s in self.keys.iter_mut().chain(&mut self.vals) { s.ensure(device, padded * 4, max); }
        for s in &mut self.done { s.ensure(device, inner * 4, max); }
        for (pass, buffer) in self.params.iter().enumerate() {
            queue.write_buffer(buffer, 0, bytemuck::cast_slice(&[n, 4 * pass as u32, tiles, 0]));
        }
        encoder.clear_buffer(&self.done[0].buffer, 0, None);

        let p = &self.pipes;
        let params = &self.params[0];
        let groups = |count: u32| count.div_ceil(64);
        let mut steps: Vec<(&wgpu::ComputePipeline, wgpu::BindGroup, u32)> = vec![
            (&p.bounds_partial, bind(device, &p.bounds_partial, &[(0, state), (2, &self.partials.buffer), (18, params)]), tiles),
            (&p.bounds_final, bind(device, &p.bounds_final, &[(1, &self.header.buffer), (2, &self.partials.buffer), (18, params)]), 1),
            (&p.codes, bind(device, &p.codes, &[(0, state), (1, &self.header.buffer), (9, &self.keys[0].buffer), (10, &self.vals[0].buffer), (18, params)]), tiles),
        ];
        for pass in 0..SORT_PASSES as usize {
            let (src, dst) = (pass % 2, (pass + 1) % 2);
            let params = &self.params[pass];
            steps.push((&p.sort_local, bind(device, &p.sort_local, &[(3, &self.keys[src].buffer), (4, &self.vals[src].buffer), (5, &self.tmp_keys.buffer), (6, &self.tmp_vals.buffer), (7, &self.hist.buffer), (8, &self.tile_start.buffer), (18, params)]), tiles));
            steps.push((&p.sort_scan, bind(device, &p.sort_scan, &[(7, &self.hist.buffer), (18, params)]), 1));
            steps.push((&p.sort_scatter, bind(device, &p.sort_scatter, &[(5, &self.tmp_keys.buffer), (6, &self.tmp_vals.buffer), (7, &self.hist.buffer), (8, &self.tile_start.buffer), (9, &self.keys[dst].buffer), (10, &self.vals[dst].buffer), (18, params)]), tiles));
        }
        let (keys, ids) = (&self.keys[0].buffer, &self.vals[0].buffer);
        if n >= 2 {
            steps.push((&p.build, bind(device, &p.build, &[(3, keys), (11, &self.nodes.buffer), (12, &self.leaf_parent.buffer), (18, params)]), groups(n - 1)));
            // Binary-node prefix lengths grow strictly downward: at most 30 distinct-code levels
            // plus ceil(log2 n) index bits for equal codes bound the tree height.
            let waves = 31 + (32 - (n - 1).leading_zeros());
            let reduce = |from: usize| bind(device, &p.reduce, &[(0, state), (4, ids), (11, &self.nodes.buffer), (12, &self.leaf_parent.buffer), (13, &self.sums.buffer), (14, &self.done[from].buffer), (15, &self.done[1 - from].buffer), (18, params)]);
            let pair = [reduce(0), reduce(1)];
            for wave in 0..waves as usize { steps.push((&p.reduce, pair[wave % 2].clone(), groups(n - 1))); }
        }
        steps.push((&p.cells, bind(device, &p.cells, &[(0, state), (1, &self.header.buffer), (4, ids), (11, &self.nodes.buffer), (12, &self.leaf_parent.buffer), (13, &self.sums.buffer), (16, &self.cells.buffer), (18, params)]), groups(2 * n - 1)));
        steps.push((&p.bodies, bind(device, &p.bodies, &[(0, state), (3, keys), (4, ids), (17, &self.bodies.buffer), (18, params)]), groups(n)));

        let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor { label: Some("layout-tree"), timestamp_writes: None });
        for (pipeline, bind, groups) in &steps {
            pass.set_pipeline(pipeline);
            pass.set_bind_group(0, bind, &[]);
            pass.dispatch_workgroups(*groups, 1, 1);
        }
        Ok(())
    }

    /// `[center xyz, half, cell count, 0, 0, 0]`
    pub fn header(&self) -> &wgpu::Buffer { &self.header.buffer }
    /// `GpuForceCell` records in DFS order (count in the header)
    pub fn cells(&self) -> &wgpu::Buffer { &self.cells.buffer }
    /// `GpuForceBody` records in node order
    pub fn bodies(&self) -> &wgpu::Buffer { &self.bodies.buffer }
    #[cfg(test)]
    fn keys(&self) -> &wgpu::Buffer { &self.keys[0].buffer }
    #[cfg(test)]
    fn ids(&self) -> &wgpu::Buffer { &self.vals[0].buffer }

    pub fn bytes(&self) -> u64 {
        [&self.header, &self.partials, &self.tmp_keys, &self.tmp_vals, &self.hist, &self.tile_start, &self.nodes, &self.leaf_parent, &self.sums, &self.cells, &self.bodies]
            .into_iter().chain(&self.keys).chain(&self.vals).chain(&self.done).map(|s| s.bytes).sum::<u64>() + 16 * u64::from(SORT_PASSES)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::DeterministicRng;
    use crate::renderer::gpu_layout::{test_device, GpuNodeState};
    use crate::spatial::{pair_repulsion, GpuForceBody, GpuForceCell, OctreeSpatialIndex, SpatialBody, SpatialIndex};
    use glam::Vec3;
    use wgpu::util::DeviceExt;

    #[test]
    fn tree_shader_is_valid() {
        let module = naga::front::wgsl::parse_str(SHADER).expect("parse tree shader");
        naga::valid::Validator::new(naga::valid::ValidationFlags::all(), naga::valid::Capabilities::all()).validate(&module).expect("validate tree shader");
    }

    /// CPU reference: the octree's root cube and per-depth octant comparisons, stably sorted.
    fn cpu_codes(bodies: &[SpatialBody]) -> Vec<(u32, u32)> {
        let (mut lo, mut hi) = (bodies[0].position, bodies[0].position);
        for b in bodies { lo = lo.min(b.position); hi = hi.max(b.position); }
        let (center, half) = ((lo + hi) * 0.5, (hi - lo).max_element() * 0.5 + 1.0);
        let mut out: Vec<(u32, u32)> = bodies.iter().enumerate().map(|(i, b)| {
            let (mut c, mut h, mut key) = (center, half, 0u32);
            for _ in 0..10 {
                let step = h * 0.5;
                let mut oct = 0;
                for a in 0..3 {
                    if b.position[a] >= c[a] { oct |= 1 << a; c[a] += step; } else { c[a] += -step; }
                }
                key = (key << 3) | oct;
                h = step;
            }
            (key, i as u32)
        }).collect();
        out.sort_by_key(|&(k, _)| k);
        out
    }

    fn bodies(n: usize, seed: u32) -> Vec<SpatialBody> {
        let mut rng = DeterministicRng::new(seed);
        let mut out: Vec<SpatialBody> = (0..n).map(|i| SpatialBody {
            id: i as u32,
            position: Vec3::new(rng.next_range(-80.0, 80.0), rng.next_range(-30.0, 30.0), rng.next_range(-50.0, 50.0)),
            mass: rng.next_range(0.5, 2.5),
        }).collect();
        if n >= 64 {
            // Coincident bodies chain at max depth; exact cell-center coordinates exercise `>=` ties.
            for i in 1..12 { out[i].position = out[0].position; }
            for i in 20..30 { out[i].position = Vec3::new(0.0, out[i].position.y, 0.0); }
        }
        out
    }

    struct Built { keys: Vec<u32>, ids: Vec<u32>, cells: Vec<GpuForceCell>, bodies: Vec<GpuForceBody> }

    fn build(device: &wgpu::Device, queue: &wgpu::Queue, bodies: &[SpatialBody]) -> Built {
        let state: Vec<GpuNodeState> = bodies.iter().map(|b| GpuNodeState { position_mass: [b.position.x, b.position.y, b.position.z, b.mass], velocity_pinned: [0.0; 4] }).collect();
        let state = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: None, contents: bytemuck::cast_slice(&state), usage: wgpu::BufferUsages::STORAGE,
        });
        let mut tree = GpuTree::new(device);
        let mut encoder = device.create_command_encoder(&Default::default());
        tree.encode(device, queue, &mut encoder, &state, bodies.len() as u32).unwrap();
        queue.submit(Some(encoder.finish()));
        let n = bodies.len();
        let header: Vec<u32> = read(device, queue, tree.header(), 32);
        Built {
            keys: read(device, queue, tree.keys(), n * 4),
            ids: read(device, queue, tree.ids(), n * 4),
            cells: read(device, queue, tree.cells(), header[4] as usize * 32),
            bodies: read(device, queue, tree.bodies(), n * 32),
        }
    }

    fn read<T: bytemuck::Pod>(device: &wgpu::Device, queue: &wgpu::Queue, buffer: &wgpu::Buffer, bytes: usize) -> Vec<T> {
        let staging = device.create_buffer(&wgpu::BufferDescriptor { label: None, size: bytes as u64, usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        let mut encoder = device.create_command_encoder(&Default::default());
        encoder.copy_buffer_to_buffer(buffer, 0, &staging, 0, bytes as u64);
        queue.submit(Some(encoder.finish()));
        staging.slice(..).map_async(wgpu::MapMode::Read, |r| r.unwrap());
        device.poll(wgpu::Maintain::Wait);
        let out = bytemuck::cast_slice(&staging.slice(..).get_mapped_range()).to_vec();
        out
    }

    /// The WGSL repulsion traversal over GPU-built records.
    fn traverse(cells: &[GpuForceCell], bodies: &[GpuForceBody], i: usize, theta: f32, strength: f32, softening: f32) -> Vec3 {
        let body = |b: &GpuForceBody| SpatialBody { id: b.id, position: Vec3::from_slice(&b.position_mass[..3]), mass: b.position_mass[3] };
        let subject = body(&bodies[i]);
        let mut force = Vec3::ZERO;
        let mut index = 0;
        while index < cells.len() {
            let cell = &cells[index];
            if cell.com_mass[3] <= 0.0 { index = cell.escape as usize; continue; }
            if cell.body != u32::MAX {
                let mut b = cell.body;
                while b != u32::MAX {
                    if bodies[b as usize].id != subject.id { force += pair_repulsion(subject.id, subject.position, &body(&bodies[b as usize]), strength, softening); }
                    b = bodies[b as usize].next;
                }
                index = cell.escape as usize;
            } else {
                let com = Vec3::from_slice(&cell.com_mass[..3]);
                let delta = subject.position - com;
                let d2 = delta.length_squared();
                if cell.size_sq < theta * theta * d2 {
                    let softened = d2 + softening;
                    force += delta * (softened.sqrt().recip() * (strength * cell.com_mass[3] / softened));
                    index = cell.escape as usize;
                } else { index += 1; }
            }
        }
        force
    }

    #[test]
    fn gpu_morton_codes_and_stable_sort_match_the_cpu_octree() {
        let Some((device, queue)) = test_device::get() else { return eprintln!("skipping GPU tree: no native GPU adapter") };
        for (n, seed) in [(1, 1), (2, 2), (300, 3), (3000, 4)] {
            let b = bodies(n, seed);
            let built = build(&device, &queue, &b);
            let expected = cpu_codes(&b);
            assert_eq!(built.keys, expected.iter().map(|e| e.0).collect::<Vec<_>>(), "keys n={n}");
            assert_eq!(built.ids, expected.iter().map(|e| e.1).collect::<Vec<_>>(), "ids n={n}");
        }
    }

    #[test]
    fn gpu_octree_forces_match_the_cpu_octree() {
        let Some((device, queue)) = test_device::get() else { return eprintln!("skipping GPU tree: no native GPU adapter") };
        for (n, seed) in [(1, 5), (2, 6), (300, 7), (5000, 8)] {
            let b = bodies(n, seed);
            let built = build(&device, &queue, &b);
            assert!(built.cells.len() <= 2 * n, "n={n}: {} cells", built.cells.len());
            assert_eq!(built.cells[0].escape as usize, built.cells.len());
            let mut cpu = OctreeSpatialIndex::default();
            cpu.rebuild(&b);
            for (i, body) in b.iter().enumerate() {
                assert_eq!(built.bodies[i].id, i as u32);
                let want = cpu.compute_repulsion(body.id, body.position, 0.75, 25.0, 1.5);
                let got = traverse(&built.cells, &built.bodies, i, 0.75, 25.0, 1.5);
                assert!((got - want).length() <= 1e-3 * want.length().max(1e-3), "n={n} body {i}: {got} vs {want}");
            }
        }
    }
}
