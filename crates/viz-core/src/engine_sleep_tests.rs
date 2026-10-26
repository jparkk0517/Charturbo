//! Graph auto-sleep: per-node threshold semantics (N-independent) and the calm-streak guard.

use super::*;
use crate::domain::{DatasetConfig, NodeData};
use crate::physics::{ForceConfig, ForceDirectedSimulator};
use crate::renderer::MockRenderBackend;
use crate::spatial::{OctreeSpatialIndex, SpatialIndex};

/// Scales every node velocity by `factor` and adds `boost` speed along +x per step.
struct ScriptedSimulator {
    factor: f32,
    boost: f32,
    index: OctreeSpatialIndex,
    ke: f32,
}

impl LayoutSimulator for ScriptedSimulator {
    fn step(&mut self, dataset: &mut GraphDataset, dt: f32) {
        let mut ke = 0.0;
        for n in dataset.nodes_mut() {
            let v = n.velocity() * self.factor + Vec3::X * self.boost;
            n.set_velocity(v);
            n.set_position(n.position() + v * dt);
            ke += 0.5 * n.mass() * v.length_squared();
        }
        self.ke = ke;
    }
    fn kinetic_energy(&self) -> Option<f32> {
        Some(self.ke)
    }
    fn rebuild_spatial_index(&mut self, _dataset: &GraphDataset) {}
    fn spatial_index(&self) -> &dyn SpatialIndex {
        &self.index
    }
    fn force_config(&self) -> ForceConfig {
        ForceConfig::default()
    }
    fn set_force_config(&mut self, _config: ForceConfig) {}
}

fn moving_dataset(n: usize, speed: f32) -> GraphDataset {
    let nodes = (0..n)
        .map(|i| {
            let mut node = NodeData::new(i as u32, Vec3::new(i as f32, 0.0, 0.0), 0, 1.0, [1.0; 4]);
            node.set_velocity(Vec3::Y * speed);
            node
        })
        .collect();
    GraphDataset::new(nodes, vec![]).unwrap()
}

fn engine_with(ds: GraphDataset, sim: Box<dyn LayoutSimulator>) -> VisualizationEngine {
    VisualizationEngine::new(ds, sim, OrbitCamera::new(100.0, 1.0), Box::new(MockRenderBackend::default()))
}

fn scripted(factor: f32, boost: f32) -> Box<dyn LayoutSimulator> {
    Box::new(ScriptedSimulator { factor, boost, index: OctreeSpatialIndex::default(), ke: 0.0 })
}

/// Steps until asleep; `None` if still awake after `max_steps`.
fn steps_to_sleep(engine: &mut VisualizationEngine, max_steps: usize) -> Option<usize> {
    (1..=max_steps).find(|_| {
        engine.step_physics(1.0 / 60.0);
        engine.is_sleeping()
    })
}

#[test]
fn same_per_node_motion_sleeps_at_the_same_step_for_any_node_count() {
    let mut small = engine_with(moving_dataset(3, 1.0), scripted(0.9, 0.0));
    let mut large = engine_with(moving_dataset(20_000, 1.0), scripted(0.9, 0.0));
    small.set_auto_sleep(true, 0.01);
    large.set_auto_sleep(true, 0.01);
    let s = steps_to_sleep(&mut small, 500).expect("small graph sleeps");
    let l = steps_to_sleep(&mut large, 500).expect("large graph sleeps");
    assert_eq!(s, l);
    // 0.5 * 0.81^k < 0.01 first at k = 19, then the calm streak
    assert_eq!(s, 18 + SLEEP_CALM_STEPS as usize);
    // A total-energy threshold could never have slept the large graph here
    assert!(large.dataset().total_kinetic_energy() > 0.01);
}

#[test]
fn layout_accelerating_from_rest_does_not_sleep_on_its_slow_first_steps() {
    // Mean KE is under the threshold for the first few steps, then grows past it
    let mut engine = engine_with(moving_dataset(100, 0.0), scripted(1.0, 0.02));
    engine.set_auto_sleep(true, 0.01);
    assert_eq!(steps_to_sleep(&mut engine, 300), None);
}

#[test]
fn real_layout_released_from_rest_stays_awake_at_the_default_threshold() {
    // Mean KE after the first step is ~0.0098 (< 0.01): a single-step check would sleep at once
    let ds = GraphDataset::generate_seeded(&DatasetConfig { node_count: 500, edge_count: 1000, ..DatasetConfig::default() });
    let sim = Box::new(ForceDirectedSimulator::new(OctreeSpatialIndex::default(), ForceConfig::default()));
    let mut engine = engine_with(ds, sim);
    engine.set_auto_sleep(true, 0.01);
    assert_eq!(steps_to_sleep(&mut engine, 120), None);
}

#[test]
fn real_layouts_of_small_and_large_graphs_both_reach_sleep() {
    // The default center gravity contracts the layout over minutes; a stiffer one settles in
    // ~1000 steps at both sizes (measured: 30 nodes -> 807, 1500 nodes -> 1030 steps)
    let cfg = ForceConfig { center_gravity: 2.0, ..ForceConfig::default() };
    for (n, max_steps) in [(30usize, 1500usize), (600, 1500)] {
        let ds = GraphDataset::generate_seeded(&DatasetConfig { node_count: n, edge_count: n * 2, ..DatasetConfig::default() });
        let sim = Box::new(ForceDirectedSimulator::new(OctreeSpatialIndex::default(), cfg));
        let mut engine = engine_with(ds, sim);
        engine.set_auto_sleep(true, 0.05);
        let steps = steps_to_sleep(&mut engine, max_steps);
        assert!(steps.is_some(), "{n} nodes never slept within {max_steps} steps");
        let mean = engine.dataset().total_kinetic_energy() / n as f32;
        assert!(mean < 0.05, "{n} nodes slept while still moving (mean KE {mean})");
    }
}

#[test]
fn waking_restarts_the_calm_streak() {
    let mut engine = engine_with(moving_dataset(10, 0.0), scripted(0.0, 0.0));
    engine.set_auto_sleep(true, 0.01);
    assert_eq!(steps_to_sleep(&mut engine, 100), Some(SLEEP_CALM_STEPS as usize));
    assert!(engine.move_node_to(0, Vec3::new(5.0, 0.0, 0.0)));
    engine.step_physics(1.0 / 60.0);
    assert!(!engine.is_sleeping(), "a drag must not fall straight back asleep");
    assert_eq!(steps_to_sleep(&mut engine, 100), Some(SLEEP_CALM_STEPS as usize - 1));
}

#[test]
fn pinned_nodes_do_not_dilute_the_mean() {
    // 1 moving node + 999 pinned ones: the mean is over the single free node
    let mut ds = moving_dataset(1000, 0.0);
    for i in 1..1000 {
        ds.set_node_pinned(i, true);
    }
    ds.nodes_mut()[0].set_velocity(Vec3::Y);
    let mut engine = engine_with(ds, scripted(1.0, 0.0));
    engine.set_auto_sleep(true, 0.01);
    assert_eq!(steps_to_sleep(&mut engine, 200), None);
}

#[test]
fn resending_the_same_settings_keeps_the_layout_asleep() {
    let mut engine = engine_with(moving_dataset(10, 0.0), scripted(0.0, 0.0));
    engine.set_auto_sleep(true, 0.01);
    assert!(steps_to_sleep(&mut engine, 100).is_some());
    engine.set_auto_sleep(true, 0.01);
    assert!(engine.is_sleeping());
    engine.set_auto_sleep(true, 0.02);
    assert!(!engine.is_sleeping(), "new settings re-evaluate from awake");
}
