use crate::domain::GraphDataset;
use crate::spatial::{SpatialBody, SpatialIndex};
use glam::Vec3;

/// Configuration parameters for 3D Force-Directed graph & embedding layout simulation.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ForceConfig {
    pub repulsion_strength: f32,
    pub spring_stiffness: f32,
    pub spring_rest_length: f32,
    pub center_gravity: f32,
    pub damping: f32,
    pub theta: f32,
    pub softening: f32,
    pub max_speed: f32,
}

impl Default for ForceConfig {
    fn default() -> Self {
        Self {
            repulsion_strength: 25.0,
            spring_stiffness: 0.08,
            spring_rest_length: 8.0,
            center_gravity: 0.03,
            damping: 0.88,
            theta: 0.75,
            softening: 1.5,
            max_speed: 60.0,
        }
    }
}

impl ForceConfig {
    /// Clamps parameters to stable ranges; non-finite values fall back to the defaults.
    pub fn sanitized(self) -> Self {
        let d = Self::default();
        let pick = |v: f32, def: f32, lo: f32, hi: f32| if v.is_finite() { v.clamp(lo, hi) } else { def };
        Self {
            repulsion_strength: pick(self.repulsion_strength, d.repulsion_strength, 0.0, 1e6),
            spring_stiffness: pick(self.spring_stiffness, d.spring_stiffness, 0.0, 10.0),
            spring_rest_length: pick(self.spring_rest_length, d.spring_rest_length, 0.0, 1e4),
            center_gravity: pick(self.center_gravity, d.center_gravity, 0.0, 10.0),
            damping: pick(self.damping, d.damping, 0.0, 1.0),
            // theta = 0 is the exact O(N^2) path; keep it reachable but never negative
            theta: pick(self.theta, d.theta, 0.0, 2.0),
            softening: pick(self.softening, d.softening, 1e-3, 1e3),
            max_speed: pick(self.max_speed, d.max_speed, 0.1, 1e5),
        }
    }
}

/// Strategy trait for graph/embedding layout simulation.
pub trait LayoutSimulator {
    fn step(&mut self, dataset: &mut GraphDataset, dt: f32);
    /// Kinetic energy after the last `step`, if the simulator tracks it (saves an O(N) pass).
    fn kinetic_energy(&self) -> Option<f32> {
        None
    }
    fn rebuild_spatial_index(&mut self, dataset: &GraphDataset);
    fn spatial_index(&self) -> &dyn SpatialIndex;
    fn force_config(&self) -> ForceConfig;
    fn set_force_config(&mut self, config: ForceConfig);
}

/// Force-directed simulator collaborating with an injected `SpatialIndex` implementation.
pub struct ForceDirectedSimulator<S: SpatialIndex> {
    spatial_index: S,
    config: ForceConfig,
    scratch_bodies: Vec<SpatialBody>,
    scratch_forces: Vec<Vec3>,
    last_kinetic_energy: f32,
}

impl<S: SpatialIndex> ForceDirectedSimulator<S> {
    pub fn new(spatial_index: S, config: ForceConfig) -> Self {
        Self {
            spatial_index,
            config: config.sanitized(),
            scratch_bodies: Vec::new(),
            scratch_forces: Vec::new(),
            last_kinetic_energy: 0.0,
        }
    }

    pub fn config(&self) -> &ForceConfig {
        &self.config
    }

    pub fn set_config(&mut self, config: ForceConfig) {
        self.config = config.sanitized();
    }

    fn populate_and_rebuild_index(&mut self, dataset: &GraphDataset) {
        self.scratch_bodies.clear();
        for node in dataset.nodes() {
            self.scratch_bodies.push(SpatialBody {
                id: node.id(),
                position: node.position(),
                mass: node.mass(),
            });
        }
        self.spatial_index.rebuild(&self.scratch_bodies);
    }
}

impl<S: SpatialIndex> LayoutSimulator for ForceDirectedSimulator<S> {
    fn step(&mut self, dataset: &mut GraphDataset, dt: f32) {
        let node_count = dataset.node_count();
        // Large frame gaps (tab switch) must not explode the integration
        let dt = if dt.is_finite() { dt.clamp(0.0, 0.05) } else { 0.0 };
        if node_count == 0 || dt <= 0.0 {
            return;
        }

        // 1. The index is rebuilt at the end of every step (and on every external position
        //    change), so it already matches the current positions unless the dataset was swapped
        if self.scratch_bodies.len() != node_count {
            self.populate_and_rebuild_index(dataset);
        }
        self.scratch_forces.clear();
        self.scratch_forces.resize(node_count, Vec3::ZERO);

        // 2. Compute Barnes-Hut repulsive forces + center gravity
        let cfg = self.config;
        for (i, body) in self.scratch_bodies.iter().enumerate() {
            let rep = self.spatial_index.compute_repulsion(
                body.id,
                body.position,
                cfg.theta,
                cfg.repulsion_strength,
                cfg.softening,
            );
            let gravity = -body.position * cfg.center_gravity * body.mass;
            self.scratch_forces[i] = rep + gravity;
        }

        // 3. Compute spring attractive forces along graph edges
        for edge in dataset.edges() {
            let src_idx = edge.source() as usize;
            let dst_idx = edge.target() as usize;
            let delta = self.scratch_bodies[dst_idx].position - self.scratch_bodies[src_idx].position;
            let dist = delta.length();
            if dist > 1e-5 {
                let displacement = dist - cfg.spring_rest_length;
                let force_mag = cfg.spring_stiffness * displacement * edge.weight();
                let force_vec = (delta / dist) * force_mag;
                self.scratch_forces[src_idx] += force_vec;
                self.scratch_forces[dst_idx] -= force_vec;
            }
        }

        // 4. Semi-implicit Euler integration with velocity damping, clamping, and pinned check.
        //    Damping is per 1/60 s so the layout settles the same at any frame rate.
        let max_speed_sq = cfg.max_speed * cfg.max_speed;
        let damping = cfg.damping.powf(dt * 60.0);
        let mut kinetic = 0.0f32;
        for (i, node) in dataset.nodes_mut().iter_mut().enumerate() {
            if node.is_pinned() {
                node.set_velocity(Vec3::ZERO);
                continue;
            }
            let accel = self.scratch_forces[i] / node.mass().max(0.1);
            let mut vel = (node.velocity() + accel * dt) * damping;
            let speed_sq = vel.length_squared();
            if speed_sq > max_speed_sq {
                vel = vel * (cfg.max_speed / speed_sq.sqrt());
            }
            let new_pos = node.position() + vel * dt;
            if !vel.is_finite() || !new_pos.is_finite() {
                // Never let one bad force poison the octree for every other node
                node.set_velocity(Vec3::ZERO);
                continue;
            }
            node.set_velocity(vel);
            node.set_position(new_pos);
            kinetic += 0.5 * node.mass() * vel.length_squared();
        }
        self.last_kinetic_energy = kinetic;

        // 5. Rebuild the index on the new positions so picking / culling are never a frame stale
        self.populate_and_rebuild_index(dataset);
    }

    fn kinetic_energy(&self) -> Option<f32> {
        Some(self.last_kinetic_energy)
    }

    fn rebuild_spatial_index(&mut self, dataset: &GraphDataset) {
        self.populate_and_rebuild_index(dataset);
    }

    fn spatial_index(&self) -> &dyn SpatialIndex {
        &self.spatial_index
    }

    fn force_config(&self) -> ForceConfig {
        self.config
    }

    fn set_force_config(&mut self, config: ForceConfig) {
        self.config = config.sanitized();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{EdgeData, NodeData};
    use crate::spatial::OctreeSpatialIndex;

    #[test]
    fn unconnected_close_nodes_push_apart() {
        let nodes = vec![
            NodeData::new(0, Vec3::new(-1.0, 0.0, 0.0), 0, 1.0, [1.0; 4]),
            NodeData::new(1, Vec3::new(1.0, 0.0, 0.0), 0, 1.0, [1.0; 4]),
        ];
        let mut ds = GraphDataset::new(nodes, vec![]).unwrap();
        let initial_dist = (ds.nodes()[0].position() - ds.nodes()[1].position()).length();

        let mut sim = ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig {
                center_gravity: 0.0,
                repulsion_strength: 50.0,
                ..ForceConfig::default()
            },
        );

        sim.step(&mut ds, 0.05);
        let new_dist = (ds.nodes()[0].position() - ds.nodes()[1].position()).length();
        assert!(
            new_dist > initial_dist,
            "Expected unconnected close nodes to repel (initial={}, new={})",
            initial_dist,
            new_dist
        );
    }

    #[test]
    fn distant_connected_nodes_pull_together() {
        let nodes = vec![
            NodeData::new(0, Vec3::new(-50.0, 0.0, 0.0), 0, 1.0, [1.0; 4]),
            NodeData::new(1, Vec3::new(50.0, 0.0, 0.0), 0, 1.0, [1.0; 4]),
        ];
        let edges = vec![EdgeData::new(0, 1, 2.0)];
        let mut ds = GraphDataset::new(nodes, edges).unwrap();
        let initial_dist = (ds.nodes()[0].position() - ds.nodes()[1].position()).length();

        let mut sim = ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig {
                repulsion_strength: 1.0,
                spring_stiffness: 0.5,
                spring_rest_length: 5.0,
                ..ForceConfig::default()
            },
        );

        sim.step(&mut ds, 0.05);
        let new_dist = (ds.nodes()[0].position() - ds.nodes()[1].position()).length();
        assert!(
            new_dist < initial_dist,
            "Expected distant connected nodes to pull closer (initial={}, new={})",
            initial_dist,
            new_dist
        );
    }

    #[test]
    fn pinned_node_remains_stationary_while_exerting_force_on_neighbors() {
        let mut n0 = NodeData::new(0, Vec3::new(0.0, 0.0, 0.0), 0, 1.0, [1.0; 4]);
        n0.set_pinned(true);
        let n1 = NodeData::new(1, Vec3::new(1.5, 0.0, 0.0), 0, 1.0, [1.0; 4]);

        let mut ds = GraphDataset::new(vec![n0, n1], vec![]).unwrap();
        let mut sim = ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig {
                center_gravity: 0.0,
                repulsion_strength: 60.0,
                ..ForceConfig::default()
            },
        );

        sim.step(&mut ds, 0.05);
        // Node 0 is pinned at origin -> must not move
        assert_eq!(ds.nodes()[0].position(), Vec3::ZERO);
        assert_eq!(ds.nodes()[0].velocity(), Vec3::ZERO);
        // Node 1 is free -> must be pushed in +X direction by pinned Node 0
        assert!(ds.nodes()[1].position().x > 1.5);
    }

    #[test]
    fn huge_or_invalid_time_steps_and_parameters_stay_stable() {
        let nodes = vec![
            NodeData::new(0, Vec3::new(-1.0, 0.0, 0.0), 0, 1.0, [1.0; 4]),
            NodeData::new(1, Vec3::new(1.0, 0.0, 0.0), 0, 1.0, [1.0; 4]),
        ];
        let mut ds = GraphDataset::new(nodes, vec![EdgeData::new(0, 1, 1.0)]).unwrap();
        let mut sim = ForceDirectedSimulator::new(
            OctreeSpatialIndex::default(),
            ForceConfig {
                damping: f32::NAN,
                theta: -3.0,
                ..ForceConfig::default()
            },
        );
        assert!(sim.config().damping.is_finite() && sim.config().theta >= 0.0);
        sim.step(&mut ds, 10.0); // a 10 s gap (backgrounded tab) is clamped
        sim.step(&mut ds, f32::NAN);
        for n in ds.nodes() {
            assert!(n.position().is_finite());
            assert!(n.position().length() < 50.0);
        }
    }
}
