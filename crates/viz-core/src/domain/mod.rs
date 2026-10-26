use glam::Vec3;

/// Portable 32-bit XorShift PRNG so Rust and TypeScript generate identical sequences.
#[derive(Debug, Clone)]
pub struct DeterministicRng {
    state: u32,
}

impl DeterministicRng {
    pub fn new(seed: u32) -> Self {
        Self {
            state: if seed == 0 { 0x9E37_79B9 } else { seed },
        }
    }

    #[inline]
    pub fn next_u32(&mut self) -> u32 {
        let mut x = self.state;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.state = x;
        x
    }

    /// Returns a float in [0.0, 1.0)
    #[inline]
    pub fn next_f32(&mut self) -> f32 {
        (self.next_u32() as f64 / (u32::MAX as f64 + 1.0)) as f32
    }

    /// Returns a float in [min, max)
    #[inline]
    pub fn next_range(&mut self, min: f32, max: f32) -> f32 {
        min + (max - min) * self.next_f32()
    }
}

/// Represents a single node in the 3D embedding / graph space.
#[derive(Debug, Clone, PartialEq)]
pub struct NodeData {
    id: u32,
    position: Vec3,
    velocity: Vec3,
    cluster_id: u16,
    mass: f32,
    color: [f32; 4],
    pinned: bool,
    selected: bool,
}

impl NodeData {
    pub fn new(
        id: u32,
        position: Vec3,
        cluster_id: u16,
        mass: f32,
        color: [f32; 4],
    ) -> Self {
        Self {
            id,
            position,
            velocity: Vec3::ZERO,
            cluster_id,
            mass,
            color,
            pinned: false,
            selected: false,
        }
    }

    #[inline]
    pub fn id(&self) -> u32 {
        self.id
    }

    #[inline]
    pub fn position(&self) -> Vec3 {
        self.position
    }

    #[inline]
    pub fn set_position(&mut self, position: Vec3) {
        self.position = position;
    }

    #[inline]
    pub fn velocity(&self) -> Vec3 {
        self.velocity
    }

    #[inline]
    pub fn set_velocity(&mut self, velocity: Vec3) {
        self.velocity = velocity;
    }

    #[inline]
    pub fn cluster_id(&self) -> u16 {
        self.cluster_id
    }

    #[inline]
    pub fn set_cluster_id(&mut self, cluster_id: u16) {
        self.cluster_id = cluster_id;
    }

    #[inline]
    pub fn mass(&self) -> f32 {
        self.mass
    }

    #[inline]
    pub fn set_mass(&mut self, mass: f32) {
        self.mass = mass.max(0.05);
    }

    #[inline]
    pub fn color(&self) -> [f32; 4] {
        self.color
    }

    #[inline]
    pub fn set_color(&mut self, color: [f32; 4]) {
        self.color = color;
    }

    #[inline]
    pub fn is_pinned(&self) -> bool {
        self.pinned
    }

    #[inline]
    pub fn set_pinned(&mut self, pinned: bool) {
        self.pinned = pinned;
        if pinned {
            self.velocity = Vec3::ZERO;
        }
    }

    #[inline]
    pub fn is_selected(&self) -> bool {
        self.selected
    }

    #[inline]
    pub fn set_selected(&mut self, selected: bool) {
        self.selected = selected;
    }
}

/// Represents a weighted edge connecting two nodes in the graph.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct EdgeData {
    source: u32,
    target: u32,
    weight: f32,
}

impl EdgeData {
    pub fn new(source: u32, target: u32, weight: f32) -> Self {
        Self {
            source,
            target,
            weight,
        }
    }

    #[inline]
    pub fn source(&self) -> u32 {
        self.source
    }

    #[inline]
    pub fn target(&self) -> u32 {
        self.target
    }

    #[inline]
    pub fn weight(&self) -> f32 {
        self.weight
    }
}

/// Configuration for deterministic graph/embedding dataset generation.
#[derive(Debug, Clone, Copy)]
pub struct DatasetConfig {
    pub seed: u32,
    pub node_count: usize,
    pub edge_count: usize,
    pub cluster_count: usize,
    pub space_radius: f32,
}

impl Default for DatasetConfig {
    fn default() -> Self {
        Self {
            seed: 42,
            node_count: 1000,
            edge_count: 2000,
            cluster_count: 8,
            space_radius: 100.0,
        }
    }
}

/// Encapsulates the graph/embedding dataset and enforces integrity invariants.
#[derive(Debug, Clone)]
pub struct GraphDataset {
    nodes: Vec<NodeData>,
    edges: Vec<EdgeData>,
    selected_count: usize,
    embedding_dim: usize,
    normalized_embeddings: Vec<f32>,
    /// Globally unique revision, bumped by every mutation (renderers cache packed buffers by it)
    revision: u64,
}

static NEXT_DATASET_REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn next_dataset_revision() -> u64 {
    NEXT_DATASET_REVISION.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

const CLUSTER_PALETTE: [[f32; 4]; 8] = [
    [0.22, 0.74, 0.97, 1.0], // Cyan Blue
    [0.96, 0.45, 0.71, 1.0], // Neon Pink
    [0.20, 0.83, 0.60, 1.0], // Emerald Green
    [0.98, 0.75, 0.14, 1.0], // Amber Gold
    [0.65, 0.55, 0.98, 1.0], // Electric Violet
    [0.97, 0.44, 0.44, 1.0], // Coral Red
    [0.38, 0.65, 0.98, 1.0], // Royal Blue
    [0.64, 0.90, 0.21, 1.0], // Lime
];

impl GraphDataset {
    pub fn default_empty() -> Self {
        Self {
            nodes: Vec::new(),
            edges: Vec::new(),
            selected_count: 0,
            embedding_dim: 0,
            normalized_embeddings: Vec::new(),
            revision: next_dataset_revision(),
        }
    }

    pub fn new(nodes: Vec<NodeData>, edges: Vec<EdgeData>) -> Result<Self, &'static str> {
        let node_len = nodes.len();
        for edge in &edges {
            if (edge.source as usize) >= node_len || (edge.target as usize) >= node_len {
                return Err("Edge references node index out of bounds");
            }
        }
        let selected_count = nodes.iter().filter(|n| n.is_selected()).count();
        Ok(Self {
            nodes,
            edges,
            selected_count,
            embedding_dim: 0,
            normalized_embeddings: Vec::new(),
            revision: next_dataset_revision(),
        })
    }

    /// Bulk ingestion from flat TypedArray slices across WASM/FFI boundary.
    /// - `positions`: `[x0, y0, z0, x1, y1, z1, ...]` (len must be `3 * N`)
    /// - `masses`: optional `[m0, m1, ...]` (len `N`, defaults to `1.0`)
    /// - `colors`: optional `[r0, g0, b0, a0, ...]` (len `4 * N`, defaults to cluster palette)
    /// - `clusters`: optional `[c0, c1, ...]` (len `N`, defaults to `0`)
    /// - `edges`: `[src0, dst0, src1, dst1, ...]` (len `2 * E`)
    /// - `edge_weights`: optional `[w0, w1, ...]` (len `E`, defaults to `1.0`)
    pub fn from_raw_buffers(
        positions: &[f32],
        masses: Option<&[f32]>,
        colors: Option<&[f32]>,
        clusters: Option<&[u16]>,
        edges: &[u32],
        edge_weights: Option<&[f32]>,
    ) -> Result<Self, &'static str> {
        if positions.len() % 3 != 0 {
            return Err("positions buffer length must be a multiple of 3");
        }
        if edges.len() % 2 != 0 {
            return Err("edges buffer length must be a multiple of 2");
        }
        let node_count = positions.len() / 3;
        let edge_count = edges.len() / 2;

        if let Some(m) = masses {
            if m.len() != node_count {
                return Err("masses length must match node count");
            }
        }
        if let Some(c) = colors {
            if c.len() != node_count * 4 {
                return Err("colors length must be 4 * node count");
            }
        }
        if let Some(cl) = clusters {
            if cl.len() != node_count {
                return Err("clusters length must match node count");
            }
        }
        if let Some(ew) = edge_weights {
            if ew.len() != edge_count {
                return Err("edge_weights length must match edge count");
            }
        }

        // A single NaN / Infinity position would poison the octree and every force sum
        if positions.iter().any(|v| !v.is_finite()) {
            return Err("positions must be finite numbers (no NaN / Infinity)");
        }

        let mut node_vec = Vec::with_capacity(node_count);
        for i in 0..node_count {
            let pos = Vec3::new(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            let cluster_id = clusters.map(|cl| cl[i]).unwrap_or(0);
            let mass = masses
                .map(|m| m[i])
                .filter(|m| m.is_finite())
                .map(|m| m.max(0.05))
                .unwrap_or(1.0);
            let color = if let Some(c) = colors {
                [c[i * 4], c[i * 4 + 1], c[i * 4 + 2], c[i * 4 + 3]]
            } else {
                CLUSTER_PALETTE[(cluster_id as usize) % CLUSTER_PALETTE.len()]
            };
            node_vec.push(NodeData::new(i as u32, pos, cluster_id, mass, color));
        }

        let mut edge_vec = Vec::with_capacity(edge_count);
        for e in 0..edge_count {
            let src = edges[e * 2];
            let dst = edges[e * 2 + 1];
            if (src as usize) >= node_count || (dst as usize) >= node_count {
                return Err("Edge references node index out of bounds");
            }
            let weight = edge_weights
                .map(|ew| ew[e])
                .filter(|w| w.is_finite())
                .unwrap_or(1.0);
            edge_vec.push(EdgeData::new(src, dst, weight));
        }

        Ok(Self {
            nodes: node_vec,
            edges: edge_vec,
            selected_count: 0,
            embedding_dim: 0,
            normalized_embeddings: Vec::new(),
            revision: next_dataset_revision(),
        })
    }

    pub fn generate_seeded(config: &DatasetConfig) -> Self {
        let mut rng = DeterministicRng::new(config.seed);
        let cluster_count = config.cluster_count.max(1);
        let node_count = config.node_count;
        let radius = config.space_radius;

        // 1. Generate cluster centers in 3D embedding space
        let mut cluster_centers = Vec::with_capacity(cluster_count);
        for _ in 0..cluster_count {
            cluster_centers.push(Vec3::new(
                rng.next_range(-radius * 0.65, radius * 0.65),
                rng.next_range(-radius * 0.65, radius * 0.65),
                rng.next_range(-radius * 0.65, radius * 0.65),
            ));
        }

        // 2. Generate nodes distributed around their assigned cluster center
        let mut nodes = Vec::with_capacity(node_count);
        let spread = radius * 0.22;
        for id in 0..node_count {
            let cluster_idx = id % cluster_count;
            let center = cluster_centers[cluster_idx];
            let offset = Vec3::new(
                rng.next_range(-spread, spread),
                rng.next_range(-spread, spread),
                rng.next_range(-spread, spread),
            );
            let mass = rng.next_range(0.8, 1.5);
            let color = CLUSTER_PALETTE[cluster_idx % CLUSTER_PALETTE.len()];
            nodes.push(NodeData::new(
                id as u32,
                center + offset,
                cluster_idx as u16,
                mass,
                color,
            ));
        }

        // 3. Generate intra-cluster (80%) and inter-cluster (20%) graph edges
        let mut edges = Vec::with_capacity(config.edge_count);
        if node_count >= 2 {
            for _ in 0..config.edge_count {
                let src = (rng.next_u32() as usize) % node_count;
                let same_cluster = rng.next_f32() < 0.80;
                let mut dst = if same_cluster && node_count > cluster_count {
                    let cluster_idx = src % cluster_count;
                    let step = ((rng.next_u32() as usize) % (node_count / cluster_count).max(1))
                        .max(1);
                    (cluster_idx + step * cluster_count) % node_count
                } else {
                    (rng.next_u32() as usize) % node_count
                };
                if dst == src {
                    dst = (src + 1) % node_count;
                }
                let weight = rng.next_range(0.5, 1.5);
                edges.push(EdgeData::new(src as u32, dst as u32, weight));
            }
        }

        Self {
            nodes,
            edges,
            selected_count: 0,
            embedding_dim: 0,
            normalized_embeddings: Vec::new(),
            revision: next_dataset_revision(),
        }
    }

    /// Revision of the current contents; changes after any mutation.
    #[inline]
    pub fn revision(&self) -> u64 {
        self.revision
    }

    #[inline]
    fn touch(&mut self) {
        self.revision = next_dataset_revision();
    }

    #[inline]
    pub fn nodes(&self) -> &[NodeData] {
        &self.nodes
    }

    #[inline]
    pub fn nodes_mut(&mut self) -> &mut [NodeData] {
        self.touch();
        &mut self.nodes
    }

    #[inline]
    pub fn edges(&self) -> &[EdgeData] {
        &self.edges
    }

    #[inline]
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }

    #[inline]
    pub fn edge_count(&self) -> usize {
        self.edges.len()
    }

    pub fn total_kinetic_energy(&self) -> f32 {
        self.nodes
            .iter()
            .map(|n| 0.5 * n.mass * n.velocity.length_squared())
            .sum()
    }

    /// Exports flat `[x0, y0, z0, x1, y1, z1, ...]` coordinates for layout persistence or zero-copy readback.
    pub fn export_positions(&self) -> Vec<f32> {
        let mut out = Vec::with_capacity(self.nodes.len() * 3);
        for n in &self.nodes {
            out.push(n.position.x);
            out.push(n.position.y);
            out.push(n.position.z);
        }
        out
    }

    /// Imports flat `[x0, y0, z0, ...]` coordinates and zeroes velocities.
    pub fn import_positions(&mut self, positions: &[f32]) -> Result<(), &'static str> {
        self.touch();
        if positions.len() != self.nodes.len() * 3 {
            return Err("positions slice length must equal 3 * node_count");
        }
        if positions.iter().any(|v| !v.is_finite()) {
            return Err("positions must be finite numbers (no NaN / Infinity)");
        }
        for (i, node) in self.nodes.iter_mut().enumerate() {
            node.position = Vec3::new(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
            node.velocity = Vec3::ZERO;
        }
        Ok(())
    }

    pub fn add_node(&mut self, position: Vec3, cluster_id: u16, mass: f32, color: Option<[f32; 4]>) -> u32 {
        self.touch();
        let id = self.nodes.len() as u32;
        let resolved_color = color.unwrap_or_else(|| {
            CLUSTER_PALETTE[(cluster_id as usize) % CLUSTER_PALETTE.len()]
        });
        self.nodes.push(NodeData::new(id, position, cluster_id, mass, resolved_color));
        id
    }

    pub fn add_edge(&mut self, source: u32, target: u32, weight: f32) -> Result<(), &'static str> {
        self.touch();
        let len = self.nodes.len();
        if (source as usize) >= len || (target as usize) >= len {
            return Err("Edge references node index out of bounds");
        }
        self.edges.push(EdgeData::new(source, target, weight));
        Ok(())
    }

    pub fn set_node_pinned(&mut self, node_id: u32, pinned: bool) -> bool {
        self.touch();
        if let Some(node) = self.nodes.get_mut(node_id as usize) {
            node.set_pinned(pinned);
            true
        } else {
            false
        }
    }

    pub fn set_node_position(&mut self, node_id: u32, position: Vec3) -> bool {
        if !position.is_finite() {
            return false;
        }
        self.touch();
        if let Some(node) = self.nodes.get_mut(node_id as usize) {
            node.set_position(position);
            node.set_velocity(Vec3::ZERO);
            true
        } else {
            false
        }
    }

    #[inline]
    pub fn has_selection(&self) -> bool {
        self.selected_count > 0
    }

    pub fn clear_selection(&mut self) {
        self.touch();
        if self.selected_count == 0 {
            return;
        }
        for node in &mut self.nodes {
            node.set_selected(false);
        }
        self.selected_count = 0;
    }

    pub fn select_nodes(&mut self, ids: &[u32]) {
        self.touch();
        self.clear_selection();
        let mut count = 0;
        for &id in ids {
            if let Some(node) = self.nodes.get_mut(id as usize) {
                if !node.is_selected() {
                    node.set_selected(true);
                    count += 1;
                }
            }
        }
        self.selected_count = count;
    }

    pub fn selected_nodes(&self) -> Vec<u32> {
        if self.selected_count == 0 {
            return Vec::new();
        }
        self.nodes
            .iter()
            .filter(|n| n.is_selected())
            .map(|n| n.id())
            .collect()
    }

    pub fn select_cluster(&mut self, cluster_id: u16) -> Vec<u32> {
        self.touch();
        let mut selected = Vec::new();
        for node in &mut self.nodes {
            let matched = node.cluster_id() == cluster_id;
            node.set_selected(matched);
            if matched {
                selected.push(node.id());
            }
        }
        self.selected_count = selected.len();
        selected
    }

    /// Selects `center_id` and all nodes reachable within `hops` undirected edge traversals.
    pub fn select_neighbors(&mut self, center_id: u32, hops: usize) -> Vec<u32> {
        self.touch();
        self.clear_selection();
        let n = self.nodes.len();
        if (center_id as usize) >= n {
            return Vec::new();
        }

        let mut visited = vec![false; n];
        visited[center_id as usize] = true;
        let mut frontier = vec![center_id];
        let mut all_selected = vec![center_id];

        for _ in 0..hops {
            if frontier.is_empty() {
                break;
            }
            let mut next_frontier = Vec::new();
            for edge in &self.edges {
                let u = edge.source;
                let v = edge.target;
                let u_vis = visited[u as usize];
                let v_vis = visited[v as usize];
                if u_vis && !v_vis && frontier.contains(&u) {
                    visited[v as usize] = true;
                    next_frontier.push(v);
                    all_selected.push(v);
                } else if v_vis && !u_vis && frontier.contains(&v) {
                    visited[u as usize] = true;
                    next_frontier.push(u);
                    all_selected.push(u);
                }
            }
            frontier = next_frontier;
        }

        all_selected.sort_unstable();
        for &id in &all_selected {
            self.nodes[id as usize].set_selected(true);
        }
        self.selected_count = all_selected.len();
        all_selected
    }

    /// Computes `(center, radius)` of an enclosing bounding sphere for all nodes.
    pub fn compute_bounding_sphere(&self) -> (Vec3, f32) {
        if self.nodes.is_empty() {
            return (Vec3::ZERO, 10.0);
        }
        let mut min_p = self.nodes[0].position;
        let mut max_p = self.nodes[0].position;
        for n in self.nodes.iter().skip(1) {
            min_p = min_p.min(n.position);
            max_p = max_p.max(n.position);
        }
        let center = (min_p + max_p) * 0.5;
        let mut max_dist_sq = 1.0f32;
        for n in &self.nodes {
            let d_sq = (n.position - center).length_squared();
            if d_sq > max_dist_sq {
                max_dist_sq = d_sq;
            }
        }
        (center, max_dist_sq.sqrt())
    }

    /// Returns sorted unique 1-hop neighbor node IDs connected to `node_id`.
    pub fn neighbors_of(&self, node_id: u32) -> Vec<u32> {
        if (node_id as usize) >= self.nodes.len() {
            return Vec::new();
        }
        let mut neighbors = Vec::new();
        for edge in &self.edges {
            if edge.source == node_id {
                neighbors.push(edge.target);
            } else if edge.target == node_id {
                neighbors.push(edge.source);
            }
        }
        neighbors.sort_unstable();
        neighbors.dedup();
        neighbors
    }

    /// Returns the undirected degree (number of incident edges) of `node_id`.
    pub fn degree_of(&self, node_id: u32) -> usize {
        if (node_id as usize) >= self.nodes.len() {
            return 0;
        }
        self.edges
            .iter()
            .filter(|e| e.source == node_id || e.target == node_id)
            .count()
    }

    /// Updates the visual style (`color`, `mass`, `cluster_id`) of `node_id`.
    pub fn set_node_style(
        &mut self,
        node_id: u32,
        color: [f32; 4],
        mass: f32,
        cluster_id: u16,
    ) -> bool {
        self.touch();
        if let Some(node) = self.nodes.get_mut(node_id as usize) {
            node.color = color;
            node.mass = mass.max(0.05);
            node.cluster_id = cluster_id;
            true
        } else {
            false
        }
    }

    /// Finds an undirected shortest path between `start_id` and `end_id` via BFS,
    /// selects all nodes along the path, and returns the ordered path `[start_id, ..., end_id]`.
    pub fn select_shortest_path(&mut self, start_id: u32, end_id: u32) -> Vec<u32> {
        self.touch();
        self.clear_selection();
        let n = self.nodes.len();
        if (start_id as usize) >= n || (end_id as usize) >= n {
            return Vec::new();
        }
        if start_id == end_id {
            self.nodes[start_id as usize].set_selected(true);
            self.selected_count = 1;
            return vec![start_id];
        }

        // Build adjacency list for fast BFS
        let mut adj: Vec<Vec<u32>> = vec![Vec::new(); n];
        for e in &self.edges {
            adj[e.source as usize].push(e.target);
            adj[e.target as usize].push(e.source);
        }

        let mut parent: Vec<Option<u32>> = vec![None; n];
        let mut visited = vec![false; n];
        let mut queue = std::collections::VecDeque::new();

        visited[start_id as usize] = true;
        queue.push_back(start_id);

        let mut found = false;
        while let Some(curr) = queue.pop_front() {
            if curr == end_id {
                found = true;
                break;
            }
            for &next in &adj[curr as usize] {
                if !visited[next as usize] {
                    visited[next as usize] = true;
                    parent[next as usize] = Some(curr);
                    queue.push_back(next);
                }
            }
        }

        if !found {
            return Vec::new();
        }

        let mut path = Vec::new();
        let mut curr_opt = Some(end_id);
        while let Some(curr) = curr_opt {
            path.push(curr);
            if curr == start_id {
                break;
            }
            curr_opt = parent[curr as usize];
        }
        path.reverse();

        for &id in &path {
            self.nodes[id as usize].set_selected(true);
        }
        self.selected_count = path.len();
        path
    }

    /// Applies a deterministic 3D layout preset to all unpinned nodes:
    /// - `0`: Cluster Sphere Layout (Fibonacci cluster centers + spherical shells per cluster)
    /// - `1`: Radial Degree Shells Layout (high-degree hubs near origin, low-degree on outer shells)
    /// - `2`: 3D Helix / Spiral Layout (ordered by cluster & ID along a 3D double/single helix)
    /// - `3`: 3D Cubic Grid Lattice Layout
    pub fn apply_preset_layout(&mut self, layout_kind: u8, space_radius: f32) {
        self.touch();
        let n = self.nodes.len();
        if n == 0 {
            return;
        }
        let radius = space_radius.max(15.0);
        let golden_angle = std::f32::consts::PI * (3.0 - 5.0_f32.sqrt());

        match layout_kind {
            // 0: Cluster Sphere Layout
            0 => {
                let max_cluster = self
                    .nodes
                    .iter()
                    .map(|node| node.cluster_id as usize)
                    .max()
                    .unwrap_or(0)
                    + 1;
                let cluster_total = max_cluster.max(1);
                let mut cluster_centers = Vec::with_capacity(cluster_total);
                for c in 0..cluster_total {
                    let y = if cluster_total == 1 {
                        0.0
                    } else {
                        1.0 - (c as f32 / (cluster_total as f32 - 1.0)) * 2.0
                    };
                    let r_ring = (1.0 - y * y).max(0.0).sqrt();
                    let theta = golden_angle * c as f32;
                    cluster_centers.push(
                        Vec3::new(theta.cos() * r_ring, y, theta.sin() * r_ring) * (radius * 0.65),
                    );
                }

                let mut cluster_counts = vec![0usize; cluster_total];
                for node in &self.nodes {
                    cluster_counts[node.cluster_id as usize] += 1;
                }
                let mut cluster_seen = vec![0usize; cluster_total];
                let sub_radius = (radius * 0.28).max(6.0);

                for node in &mut self.nodes {
                    let c = node.cluster_id as usize;
                    let idx_in_c = cluster_seen[c];
                    cluster_seen[c] += 1;
                    if node.is_pinned() {
                        continue;
                    }
                    let total_in_c = cluster_counts[c].max(1);
                    let y = if total_in_c == 1 {
                        0.0
                    } else {
                        1.0 - (idx_in_c as f32 / (total_in_c as f32 - 1.0)) * 2.0
                    };
                    let r_ring = (1.0 - y * y).max(0.0).sqrt();
                    let theta = golden_angle * idx_in_c as f32;
                    let offset =
                        Vec3::new(theta.cos() * r_ring, y, theta.sin() * r_ring) * sub_radius;
                    node.position = cluster_centers[c] + offset;
                    node.velocity = Vec3::ZERO;
                }
            }
            // 1: Radial Degree Shells Layout (Centrality hierarchy)
            1 => {
                let mut degrees = vec![0usize; n];
                for e in &self.edges {
                    degrees[e.source as usize] += 1;
                    degrees[e.target as usize] += 1;
                }
                let max_deg = degrees.iter().copied().max().unwrap_or(1).max(1) as f32;

                for (i, node) in self.nodes.iter_mut().enumerate() {
                    if node.is_pinned() {
                        continue;
                    }
                    let deg_norm = (degrees[i] as f32 / max_deg).clamp(0.0, 1.0);
                    // High degree -> inner shell (0.15 * radius), low degree -> outer shell (1.0 * radius)
                    let shell_r = radius * (1.0 - deg_norm * 0.82);
                    let y = if n == 1 {
                        0.0
                    } else {
                        1.0 - (i as f32 / (n as f32 - 1.0)) * 2.0
                    };
                    let r_ring = (1.0 - y * y).max(0.0).sqrt();
                    let theta = golden_angle * i as f32;
                    node.position = Vec3::new(theta.cos() * r_ring, y, theta.sin() * r_ring) * shell_r;
                    node.velocity = Vec3::ZERO;
                }
            }
            // 2: 3D Helix / Spiral Layout
            2 => {
                let mut order: Vec<usize> = (0..n).collect();
                order.sort_by_key(|&i| (self.nodes[i].cluster_id, i));
                let height = radius * 1.6;
                let coil_radius = radius * 0.65;
                let turns = (n as f32 / 24.0).clamp(3.0, 18.0);

                for (rank, &node_idx) in order.iter().enumerate() {
                    let node = &mut self.nodes[node_idx];
                    if node.is_pinned() {
                        continue;
                    }
                    let t = if n <= 1 {
                        0.5
                    } else {
                        rank as f32 / (n as f32 - 1.0)
                    };
                    let angle = t * turns * std::f32::consts::TAU;
                    let strand_offset = if node.cluster_id % 2 == 0 {
                        0.0
                    } else {
                        std::f32::consts::PI * 0.35
                    };
                    let y = (t - 0.5) * height;
                    let x = (angle + strand_offset).cos() * coil_radius;
                    let z = (angle + strand_offset).sin() * coil_radius;
                    node.position = Vec3::new(x, y, z);
                    node.velocity = Vec3::ZERO;
                }
            }
            // 3 (or default): 3D Grid Lattice Layout
            _ => {
                let side = (n as f32).cbrt().ceil().max(1.0) as usize;
                let spacing = if side <= 1 {
                    1.0
                } else {
                    (radius * 1.4) / (side as f32 - 1.0)
                };
                let half = (side as f32 - 1.0) * 0.5 * spacing;

                for (i, node) in self.nodes.iter_mut().enumerate() {
                    if node.is_pinned() {
                        continue;
                    }
                    let ix = i % side;
                    let iy = (i / side) % side;
                    let iz = i / (side * side);
                    node.position = Vec3::new(
                        ix as f32 * spacing - half,
                        iy as f32 * spacing - half,
                        iz as f32 * spacing - half,
                    );
                    node.velocity = Vec3::ZERO;
                }
            }
        }
    }

    /// Returns the dimension `D` of the currently stored high-dimensional embeddings (`0` if loaded as raw 3D).
    #[inline]
    pub fn embedding_dim(&self) -> usize {
        self.embedding_dim
    }

    /// Projects an arbitrary `D`-dimensional embedding matrix (`vectors.len() == N * dim`, for any `dim >= 3`,
    /// e.g. 64D, 128D, 384D, 768D, 1024D, 1536D, 3072D, 4096D+) into 3D space `(x, y, z)` and constructs
    /// a cosine-similarity k-NN graph:
    /// - `projection_mode == 0`: Matrix-Free Power Iteration PCA (extracts top 3 orthogonal principal axes in O(N * D))
    /// - `projection_mode == 1`: Johnson-Lindenstrauss Orthogonal Random Projection in O(N * D)
    pub fn from_high_dim_embeddings(
        vectors: &[f32],
        dim: usize,
        projection_mode: u8,
        k_neighbors: usize,
        similarity_threshold: f32,
        clusters: Option<&[u16]>,
        space_radius: f32,
    ) -> Result<Self, &'static str> {
        if dim < 3 {
            return Err("Embedding dimension D must be at least 3");
        }
        if vectors.is_empty() || vectors.len() % dim != 0 {
            return Err("vectors length must be a non-zero multiple of dim");
        }
        if vectors.iter().any(|v| !v.is_finite()) {
            return Err("embedding vectors must be finite numbers (no NaN / Infinity)");
        }
        let n = vectors.len() / dim;
        if let Some(cl) = clusters {
            if !cl.is_empty() && cl.len() != n {
                return Err("clusters slice length must match vector count N");
            }
        }

        // 1. L2-normalize each D-dimensional vector for exact Cosine Similarity queries
        let mut normalized = vec![0.0f32; n * dim];
        for i in 0..n {
            let row = &vectors[i * dim..(i + 1) * dim];
            let mut norm_sq = 0.0f32;
            for &v in row {
                norm_sq += v * v;
            }
            let inv_norm = if norm_sq > 1e-12 {
                1.0 / norm_sq.sqrt()
            } else {
                0.0
            };
            let out_row = &mut normalized[i * dim..(i + 1) * dim];
            for d in 0..dim {
                out_row[d] = row[d] * inv_norm;
            }
        }

        // 2. Center the normalized vectors by subtracting the D-dimensional mean vector
        let mut mean = vec![0.0f32; dim];
        let inv_n = 1.0 / (n as f32);
        for i in 0..n {
            let row = &normalized[i * dim..(i + 1) * dim];
            for d in 0..dim {
                mean[d] += row[d] * inv_n;
            }
        }
        let mut centered = normalized.clone();
        for i in 0..n {
            let row = &mut centered[i * dim..(i + 1) * dim];
            for d in 0..dim {
                row[d] -= mean[d];
            }
        }

        // 3. Extract 3 orthonormal D-dimensional basis vectors (axes[0], axes[1], axes[2])
        let mut rng = DeterministicRng::new(1337 + dim as u32);
        let mut axes: Vec<Vec<f32>> = Vec::with_capacity(3);

        let normalize_vec = |v: &mut [f32]| {
            let mut s = 0.0f32;
            for &x in v.iter() {
                s += x * x;
            }
            let inv = if s > 1e-12 { 1.0 / s.sqrt() } else { 1.0 };
            for x in v.iter_mut() {
                *x *= inv;
            }
        };

        let orthogonalize = |v: &mut [f32], prev_axes: &[Vec<f32>]| {
            for prev in prev_axes {
                let mut dot = 0.0f32;
                for d in 0..v.len() {
                    dot += v[d] * prev[d];
                }
                for d in 0..v.len() {
                    v[d] -= dot * prev[d];
                }
            }
        };

        if projection_mode == 1 {
            // Mode 1: Johnson-Lindenstrauss Orthogonal Random Projection
            for _ in 0..3 {
                let mut axis: Vec<f32> = (0..dim).map(|_| rng.next_range(-1.0, 1.0)).collect();
                orthogonalize(&mut axis, &axes);
                normalize_vec(&mut axis);
                axes.push(axis);
            }
        } else {
            // Mode 0 (default): Matrix-Free Power Iteration PCA (O(N * D) per step, never allocates D x D)
            let power_iters = 10;
            let mut scores = vec![0.0f32; n];
            for _comp in 0..3 {
                let mut axis: Vec<f32> = (0..dim).map(|_| rng.next_range(-1.0, 1.0)).collect();
                orthogonalize(&mut axis, &axes);
                normalize_vec(&mut axis);

                for _ in 0..power_iters {
                    // scores = X_c * axis  (length N)
                    for i in 0..n {
                        let row = &centered[i * dim..(i + 1) * dim];
                        let mut dot = 0.0f32;
                        for d in 0..dim {
                            dot += row[d] * axis[d];
                        }
                        scores[i] = dot;
                    }
                    // next_axis = X_c^T * scores (length D)
                    axis.fill(0.0);
                    for i in 0..n {
                        let s = scores[i];
                        let row = &centered[i * dim..(i + 1) * dim];
                        for d in 0..dim {
                            axis[d] += row[d] * s;
                        }
                    }
                    orthogonalize(&mut axis, &axes);
                    normalize_vec(&mut axis);
                }
                axes.push(axis);
            }
        }

        // 4. Project all N vectors onto (axes[0], axes[1], axes[2]) and scale to `space_radius`
        let mut raw_coords = vec![Vec3::ZERO; n];
        let mut max_abs = 1e-5f32;
        for i in 0..n {
            let row = &centered[i * dim..(i + 1) * dim];
            let mut px = 0.0f32;
            let mut py = 0.0f32;
            let mut pz = 0.0f32;
            for d in 0..dim {
                let val = row[d];
                px += val * axes[0][d];
                py += val * axes[1][d];
                pz += val * axes[2][d];
            }
            let p = Vec3::new(px, py, pz);
            let len = p.length();
            if len > max_abs {
                max_abs = len;
            }
            raw_coords[i] = p;
        }

        let scale = space_radius.max(15.0) / max_abs;

        // 5. Determine cluster assignments (use provided `clusters` or auto-cluster via Spherical K-Means)
        let resolved_clusters: Vec<u16> = match clusters {
            Some(cl) if cl.len() == n => cl.to_vec(),
            _ => {
                let k_clusters = 8.min(n).max(1);
                let stride = (n / k_clusters).max(1);
                let mut centroids = vec![0.0f32; k_clusters * dim];
                for c in 0..k_clusters {
                    let seed_idx = (c * stride) % n;
                    centroids[c * dim..(c + 1) * dim]
                        .copy_from_slice(&normalized[seed_idx * dim..(seed_idx + 1) * dim]);
                }

                let mut assignments = vec![0u16; n];
                for _iter in 0..4 {
                    for i in 0..n {
                        let row = &normalized[i * dim..(i + 1) * dim];
                        let mut best_c = 0usize;
                        let mut best_sim = f32::NEG_INFINITY;
                        for c in 0..k_clusters {
                            let cent = &centroids[c * dim..(c + 1) * dim];
                            let mut dot = 0.0f32;
                            for d in 0..dim {
                                dot += row[d] * cent[d];
                            }
                            if dot > best_sim {
                                best_sim = dot;
                                best_c = c;
                            }
                        }
                        assignments[i] = best_c as u16;
                    }
                    centroids.fill(0.0);
                    for i in 0..n {
                        let c = assignments[i] as usize;
                        let row = &normalized[i * dim..(i + 1) * dim];
                        let cent = &mut centroids[c * dim..(c + 1) * dim];
                        for d in 0..dim {
                            cent[d] += row[d];
                        }
                    }
                    for c in 0..k_clusters {
                        normalize_vec(&mut centroids[c * dim..(c + 1) * dim]);
                    }
                }
                assignments
            }
        };

        // 6. Create NodeData instances
        let mut nodes = Vec::with_capacity(n);
        for i in 0..n {
            let cid = resolved_clusters[i];
            let color = CLUSTER_PALETTE[(cid as usize) % CLUSTER_PALETTE.len()];
            nodes.push(NodeData::new(
                i as u32,
                raw_coords[i] * scale,
                cid,
                1.2,
                color,
            ));
        }

        // 7. Build Cosine-Similarity k-NN Graph Edges in D-dimensional space
        let mut edges = Vec::new();
        let k = k_neighbors.min(n.saturating_sub(1));
        if k > 0 && n >= 2 {
            // To keep interactive ingestion super fast even for large N, cap candidate window if N > 1200
            let max_scan = 800.min(n);
            let step = (n / max_scan).max(1);
            let mut top_matches: Vec<(u32, f32)> = Vec::with_capacity(k + 1);

            for i in 0..n {
                top_matches.clear();
                let row_i = &normalized[i * dim..(i + 1) * dim];

                let mut idx = (i + 1) % n;
                let mut scanned = 0;
                while scanned < max_scan && idx != i {
                    let row_j = &normalized[idx * dim..(idx + 1) * dim];
                    let mut sim = 0.0f32;
                    for d in 0..dim {
                        sim += row_i[d] * row_j[d];
                    }
                    if sim >= similarity_threshold {
                        if top_matches.len() < k {
                            top_matches.push((idx as u32, sim));
                            top_matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                        } else if sim > top_matches[k - 1].1 {
                            top_matches[k - 1] = (idx as u32, sim);
                            top_matches.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
                        }
                    }
                    idx = (idx + step) % n;
                    scanned += 1;
                }

                for &(dst, sim) in &top_matches {
                    edges.push(EdgeData::new(i as u32, dst, sim.clamp(0.1, 2.0)));
                }
            }
        }

        Ok(Self {
            nodes,
            edges,
            selected_count: 0,
            embedding_dim: dim,
            normalized_embeddings: normalized,
            revision: next_dataset_revision(),
        })
    }

    /// Queries the top `top_k` most similar nodes to `node_id` using exact `D`-dimensional Cosine Similarity.
    /// Returns `Vec<(neighbor_id, cosine_similarity)>` sorted descending.
    pub fn query_cosine_similar(&self, node_id: u32, top_k: usize) -> Vec<(u32, f32)> {
        let n = self.nodes.len();
        let dim = self.embedding_dim;
        if (node_id as usize) >= n || dim == 0 || self.normalized_embeddings.len() != n * dim {
            return Vec::new();
        }
        let target = &self.normalized_embeddings[(node_id as usize) * dim..(node_id as usize + 1) * dim];
        let mut sims: Vec<(u32, f32)> = Vec::with_capacity(n.saturating_sub(1));
        for i in 0..n {
            if i as u32 == node_id {
                continue;
            }
            let row = &self.normalized_embeddings[i * dim..(i + 1) * dim];
            let mut dot = 0.0f32;
            for d in 0..dim {
                dot += target[d] * row[d];
            }
            sims.push((i as u32, dot));
        }
        sims.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
        sims.truncate(top_k);
        sims
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_rng_produces_repeatable_sequence() {
        let mut rng_a = DeterministicRng::new(42);
        let mut rng_b = DeterministicRng::new(42);

        let seq_a: Vec<u32> = (0..10).map(|_| rng_a.next_u32()).collect();
        let seq_b: Vec<u32> = (0..10).map(|_| rng_b.next_u32()).collect();

        assert_eq!(seq_a, seq_b);
        // Zero seed should safely fallback to non-zero internal state
        let mut rng_zero = DeterministicRng::new(0);
        assert_ne!(rng_zero.next_u32(), 0);
    }

    #[test]
    fn dataset_rejects_out_of_bounds_edges() {
        let nodes = vec![
            NodeData::new(0, Vec3::ZERO, 0, 1.0, [1.0, 0.0, 0.0, 1.0]),
            NodeData::new(1, Vec3::ONE, 0, 1.0, [0.0, 1.0, 0.0, 1.0]),
        ];
        let invalid_edges = vec![EdgeData::new(0, 5, 1.0)];

        let result = GraphDataset::new(nodes, invalid_edges);
        assert!(result.is_err());
    }

    #[test]
    fn generate_seeded_creates_identical_datasets_for_same_seed() {
        let config = DatasetConfig {
            seed: 1337,
            node_count: 500,
            edge_count: 1200,
            cluster_count: 6,
            space_radius: 80.0,
        };

        let ds1 = GraphDataset::generate_seeded(&config);
        let ds2 = GraphDataset::generate_seeded(&config);

        assert_eq!(ds1.node_count(), 500);
        assert_eq!(ds1.edge_count(), 1200);
        assert_eq!(ds1.nodes(), ds2.nodes());
        assert_eq!(ds1.edges(), ds2.edges());

        // Verify all edges reference valid node indices and are not self-loops
        for edge in ds1.edges() {
            assert!((edge.source() as usize) < ds1.node_count());
            assert!((edge.target() as usize) < ds1.node_count());
            assert_ne!(edge.source(), edge.target());
        }
    }

    #[test]
    fn total_kinetic_energy_computes_half_m_v_squared() {
        let mut node = NodeData::new(0, Vec3::ZERO, 0, 2.0, [1.0; 4]);
        node.set_velocity(Vec3::new(3.0, 4.0, 0.0)); // speed = 5, v^2 = 25, 0.5 * 2 * 25 = 25.0
        let ds = GraphDataset::new(vec![node], vec![]).unwrap();
        assert!((ds.total_kinetic_energy() - 25.0).abs() < 1e-5);
    }

    #[test]
    fn from_raw_buffers_ingests_flat_arrays_and_validates_lengths() {
        let positions = [0.0, 1.0, 2.0, 10.0, 20.0, 30.0, -5.0, 0.0, 5.0];
        let masses = [1.5, 2.0, 0.8];
        let clusters = [0u16, 1, 1];
        let edges = [0u32, 1, 1, 2];
        let weights = [0.5f32, 1.2];

        let ds = GraphDataset::from_raw_buffers(
            &positions,
            Some(&masses),
            None,
            Some(&clusters),
            &edges,
            Some(&weights),
        )
        .unwrap();

        assert_eq!(ds.node_count(), 3);
        assert_eq!(ds.edge_count(), 2);
        assert_eq!(ds.nodes()[1].position(), Vec3::new(10.0, 20.0, 30.0));
        assert_eq!(ds.nodes()[1].mass(), 2.0);
        assert_eq!(ds.nodes()[2].cluster_id(), 1);
        assert_eq!(ds.edges()[1].source(), 1);
        assert_eq!(ds.edges()[1].target(), 2);
        assert!((ds.edges()[1].weight() - 1.2).abs() < 1e-6);

        // Invalid position length (not divisible by 3) should fail
        assert!(GraphDataset::from_raw_buffers(&[1.0, 2.0], None, None, None, &[], None).is_err());
        // Out of bounds edge index should fail
        assert!(
            GraphDataset::from_raw_buffers(&positions, None, None, None, &[0, 99], None).is_err()
        );
    }

    #[test]
    fn export_and_import_positions_roundtrip_accurately() {
        let config = DatasetConfig {
            seed: 12,
            node_count: 5,
            edge_count: 4,
            cluster_count: 2,
            space_radius: 20.0,
        };
        let mut ds = GraphDataset::generate_seeded(&config);
        let exported = ds.export_positions();
        assert_eq!(exported.len(), 15);

        let new_coords: Vec<f32> = (0..15).map(|i| i as f32 * 2.0).collect();
        ds.import_positions(&new_coords).unwrap();
        assert_eq!(ds.nodes()[2].position(), Vec3::new(12.0, 14.0, 16.0));
        assert_eq!(ds.export_positions(), new_coords);
    }

    #[test]
    fn select_neighbors_collects_multi_hop_connected_subgraph() {
        // 0 -- 1 -- 2 -- 3, and 4 is isolated
        let positions = [0.0; 15]; // 5 nodes
        let edges = [0u32, 1, 1, 2, 2, 3];
        let mut ds =
            GraphDataset::from_raw_buffers(&positions, None, None, None, &edges, None).unwrap();

        assert!(!ds.has_selection());

        let hop1 = ds.select_neighbors(0, 1);
        assert_eq!(hop1, vec![0, 1]);
        assert!(ds.has_selection());
        assert!(ds.nodes()[0].is_selected());
        assert!(ds.nodes()[1].is_selected());
        assert!(!ds.nodes()[2].is_selected());

        let hop2 = ds.select_neighbors(0, 2);
        assert_eq!(hop2, vec![0, 1, 2]);
        assert!(ds.nodes()[2].is_selected());
        assert!(!ds.nodes()[3].is_selected());

        ds.clear_selection();
        assert!(!ds.has_selection());
    }

    #[test]
    fn compute_bounding_sphere_encloses_all_nodes() {
        let positions = [-10.0, 0.0, 0.0, 10.0, 0.0, 0.0, 0.0, 5.0, 0.0];
        let ds = GraphDataset::from_raw_buffers(&positions, None, None, None, &[], None).unwrap();
        let (center, radius) = ds.compute_bounding_sphere();
        for node in ds.nodes() {
            assert!((node.position() - center).length() <= radius + 1e-4);
        }
    }

    #[test]
    fn shortest_path_and_neighbors_and_preset_layouts_work() {
        // 0 -- 1 -- 2 -- 3, and 0 -- 4 -- 3
        let positions = [0.0; 15]; // 5 nodes
        let edges = [0u32, 1, 1, 2, 2, 3, 0, 4, 4, 3];
        let mut ds =
            GraphDataset::from_raw_buffers(&positions, None, None, None, &edges, None).unwrap();

        assert_eq!(ds.neighbors_of(0), vec![1, 4]);
        assert_eq!(ds.degree_of(0), 2);

        let path = ds.select_shortest_path(0, 3);
        assert_eq!(path, vec![0, 4, 3]);
        assert!(ds.nodes()[0].is_selected());
        assert!(ds.nodes()[4].is_selected());
        assert!(ds.nodes()[3].is_selected());
        assert!(!ds.nodes()[1].is_selected());

        assert!(ds.set_node_style(2, [0.2, 0.8, 0.4, 1.0], 3.5, 4));
        assert_eq!(ds.nodes()[2].cluster_id(), 4);
        assert!((ds.nodes()[2].mass() - 3.5).abs() < 1e-6);

        for kind in 0..=3 {
            ds.apply_preset_layout(kind, 60.0);
            for node in ds.nodes() {
                assert!(node.position().is_finite());
            }
        }
    }

    #[test]
    fn high_dim_embeddings_project_any_dimension_to_3d_and_support_exact_cosine_knn() {
        for &dim in &[128usize, 1536usize] {
            let n = 24;
            let mut vectors = vec![0.0f32; n * dim];
            for i in 0..n {
                let cluster = i % 3;
                for d in 0..dim {
                    // Create distinct high-dimensional topic signatures per cluster
                    vectors[i * dim + d] = if d % 3 == cluster {
                        1.0 + (i as f32) * 0.01
                    } else {
                        0.05
                    };
                }
            }

            let ds = GraphDataset::from_high_dim_embeddings(
                &vectors,
                dim,
                0, // Power Iteration PCA
                3,
                0.5,
                None,
                80.0,
            )
            .unwrap();

            assert_eq!(ds.node_count(), n);
            assert_eq!(ds.embedding_dim(), dim);
            assert!(ds.edge_count() > 0);
            for node in ds.nodes() {
                assert!(node.position().is_finite());
                assert!(node.position().length() <= 80.5);
            }

            let top = ds.query_cosine_similar(0, 3);
            assert_eq!(top.len(), 3);
            // Node 0 belongs to cluster 0 (indices 0, 3, 6, 9...), so top cosine match must also be in cluster 0
            assert_eq!(top[0].0 % 3, 0);
            assert!(top[0].1 > 0.98);
        }
    }

    #[test]
    fn non_finite_inputs_are_rejected_or_defaulted() {
        let bad = [0.0, f32::NAN, 0.0];
        assert!(GraphDataset::from_raw_buffers(&bad, None, None, None, &[], None).is_err());

        let pos = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        let mut ds = GraphDataset::from_raw_buffers(
            &pos,
            Some(&[f32::INFINITY, 2.0]),
            None,
            None,
            &[0, 1],
            Some(&[f32::NAN]),
        )
        .unwrap();
        assert_eq!(ds.nodes()[0].mass(), 1.0);
        assert_eq!(ds.edges()[0].weight(), 1.0);
        assert!(ds.import_positions(&[0.0, 0.0, f32::NAN, 0.0, 0.0, 0.0]).is_err());
        assert!(!ds.set_node_position(0, Vec3::new(f32::INFINITY, 0.0, 0.0)));
    }

    #[test]
    fn every_mutation_bumps_the_revision() {
        let pos = [0.0, 0.0, 0.0, 1.0, 0.0, 0.0];
        let mut ds = GraphDataset::from_raw_buffers(&pos, None, None, None, &[0, 1], None).unwrap();
        let mut last = ds.revision();
        let mut check = |ds: &GraphDataset| {
            assert_ne!(ds.revision(), last);
            last = ds.revision();
        };
        ds.select_nodes(&[0]);
        check(&ds);
        ds.set_node_position(1, Vec3::ONE);
        check(&ds);
        ds.nodes_mut();
        check(&ds);
        // A freshly built dataset never reuses an old revision
        let other = GraphDataset::from_raw_buffers(&pos, None, None, None, &[], None).unwrap();
        assert_ne!(other.revision(), ds.revision());
    }
}
