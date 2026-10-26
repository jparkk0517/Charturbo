//! Perf note / benchmark: CPU memory of one sparkline engine (`VisualizationEngine` + chart
//! state + staging, `MockRenderBackend` instead of the GPU). A dashboard of 200 sparklines on a
//! shared device must stay cheap; GPU-side bytes per engine are covered by
//! `wgpu_backend::engine_gpu_bytes` (compact buffers, see its unit test).
//!
//! Measured (60 points): ~67 KB per engine = ~28 KB engine shell (scene unit primitives),
//! ~35 KB first frame (scene geometry pack + chart staging), <1 KB chart data. The octree of
//! shared-device engines is `OctreeSpatialIndex::compact` (the default reserves ~300 KB).
//!
//! Own test binary: the counting global allocator only sees this file's allocations.

use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicIsize, Ordering};

use viz_core::camera::OrbitCamera;
use viz_core::chart::{ChartFrameStyle, ChartViewMode, LineLayout, LineSeries, LineXKind, SparklineMarks};
use viz_core::domain::{DatasetConfig, GraphDataset};
use viz_core::engine::VisualizationEngine;
use viz_core::physics::{ForceConfig, ForceDirectedSimulator};
use viz_core::renderer::MockRenderBackend;
use viz_core::spatial::OctreeSpatialIndex;

struct Counting;

static LIVE: AtomicIsize = AtomicIsize::new(0);

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LIVE.fetch_add(layout.size() as isize, Ordering::Relaxed);
        System.alloc(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size() as isize, Ordering::Relaxed);
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        LIVE.fetch_add(new_size as isize - layout.size() as isize, Ordering::Relaxed);
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static ALLOC: Counting = Counting;

/// Sparkline engine as the SDK builds it on a shared device: no graph nodes, 2D line chart,
/// 2 px padding, no grid, last / min / max markers, one rendered frame.
fn sparkline_engine(seed: u32, points: usize) -> VisualizationEngine {
    let dataset = GraphDataset::generate_seeded(&DatasetConfig {
        seed,
        node_count: 0,
        edge_count: 0,
        cluster_count: 1,
        space_radius: 100.0,
    });
    let simulator = Box::new(ForceDirectedSimulator::new(OctreeSpatialIndex::compact(10), ForceConfig::default()));
    let mut engine = VisualizationEngine::new(dataset, simulator, OrbitCamera::new(220.0, 4.0), Box::<MockRenderBackend>::default());
    engine.set_pixel_ratio(2.0);
    engine.resize(240, 60);
    let values: Vec<f32> = (0..points).map(|i| ((i as u32 ^ seed) % 17) as f32).collect();
    let series = vec![LineSeries { values, x: None, color: [0.2, 0.5, 1.0, 1.0], width_px: 1.5 }];
    engine.set_line_chart(series, LineLayout { width: 120.0, height: 30.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric });
    engine.set_chart_padding([2.0; 4]);
    engine.set_chart_frame_style(ChartFrameStyle { show_grid: false, ..Default::default() });
    let red = Some([1.0, 0.2, 0.2, 1.0]);
    engine
        .chart_mut()
        .unwrap()
        .set_sparkline(Some(SparklineMarks { last: red, min: red, max: red, ..Default::default() }));
    engine.sync_and_render();
    engine
}

#[test]
fn two_hundred_sparkline_engines_stay_small() {
    // Warm up lazily initialized statics outside the measurement
    drop(sparkline_engine(0, 60));
    let before = LIVE.load(Ordering::Relaxed);
    let engines: Vec<VisualizationEngine> = (0..200).map(|i| sparkline_engine(i, 60)).collect();
    let per_engine = (LIVE.load(Ordering::Relaxed) - before) / engines.len() as isize;
    println!("CPU bytes per 60-point sparkline engine: {per_engine}");
    assert!(per_engine > 0);
    assert!(per_engine < 96 * 1024, "{per_engine} bytes per sparkline engine");
    drop(engines);
    // Everything is released with the engines
    assert!(LIVE.load(Ordering::Relaxed) - before < 4096);
}

