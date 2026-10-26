//! Hierarchy hover / legend emphasis through the fill emphasis uniform: a change uploads the
//! uniform plus the re-tagged vertices only, the geometry stays, and the colors the shader draws
//! (`ChartFillStyleRaw::resolve`) equal the old full CPU recolor on random sankeys / treemaps.

use super::*;
use super::treemap::CellKind;
use crate::renderer::{chart_layer_bytes, MockRenderBackend, RenderBackend};

fn view(cam: &OrbitCamera) -> ChartView<'_> {
    ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
}

fn camera(chart: &ChartState) -> OrbitCamera {
    let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
    cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
    chart.frame_camera(&mut cam, (1600.0, 900.0));
    cam
}

/// Deterministic xorshift in [0, 1).
fn rng(seed: u64) -> impl FnMut() -> f64 {
    let mut s = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15) | 1;
    move || {
        s ^= s << 13;
        s ^= s >> 7;
        s ^= s << 17;
        (s >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Layered DAG like the `sankey-10k` bench: `layers` columns, ~2 links per node to the next.
fn layered_sankey(nodes: usize, layers: usize, seed: u64) -> SankeyGraph {
    let mut r = rng(seed);
    let per = nodes.div_ceil(layers);
    let mut g = SankeyGraph { node_count: nodes, ..Default::default() };
    for i in 0..nodes {
        let layer = i / per;
        let next0 = (layer + 1) * per;
        if layer + 1 >= layers || next0 >= nodes {
            continue;
        }
        let next_n = (next0 + per).min(nodes) - next0;
        for _ in 0..2 {
            g.sources.push(i as u32);
            g.targets.push((next0 + (r() * next_n as f64) as usize) as u32);
            g.values.push(1.0 + r() * 9.0);
        }
    }
    g
}

fn assert_colors_eq(got: &[ChartFillRaw], want: &[ChartFillRaw], what: &str) {
    assert_eq!(got.len(), want.len(), "{what}");
    for (i, (g, w)) in got.iter().zip(want).enumerate() {
        let d = (0..4).map(|k| (g.color[k] - w.color[k]).abs()).fold(0.0f32, f32::max);
        assert!(d < 1e-6, "{what}: vertex {i} drawn {:?}, old recolor {:?}", g.color, w.color);
    }
}

/// Positions (xyz) of the staged fills.
fn positions(chart: &ChartState) -> Vec<[f32; 3]> {
    chart.fills.iter().map(|f| [f.position[0], f.position[1], f.position[2]]).collect()
}

/// Syncs one frame into `backend`; returns the bytes it wrote.
fn frame(chart: &mut ChartState, v: &ChartView, backend: &mut MockRenderBackend) -> u64 {
    let layers = chart.prepare_layers(v);
    let bytes = chart_layer_bytes(&layers);
    backend.sync_chart(&layers);
    bytes
}

/// Hovered `(series, index)` of the chart (what `prepare_hierarchy` passes down).
fn hovered(chart: &ChartState) -> Option<(u32, u32)> {
    chart.hover.as_ref().and_then(|h| h.items.get(h.primary)).map(|i| (i.series, i.index))
}

#[test]
fn sankey_hover_matches_the_full_recolor_and_uploads_only_flipped_items() {
    for (seed, link_color) in [(1, SankeyLinkColor::Source), (2, SankeyLinkColor::Target), (3, SankeyLinkColor::Neutral)] {
        let g = layered_sankey(60, 5, seed);
        validate_sankey(&g).unwrap();
        let opts = SankeyOptions { link_color, link_opacity: 0.4 + 0.1 * seed as f32, ..Default::default() };
        let mut chart = ChartState::new_sankey(g, opts, HierarchyStyle::default());
        let cam = camera(&chart);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let mut backend = MockRenderBackend::default();
        let full = frame(&mut chart, &v, &mut backend);
        let geometry = positions(&chart);
        let (nodes, links) = { let s = chart.sankey().unwrap(); (s.node_count() as u32, s.link_count() as u32) };
        let mut r = rng(seed + 100);
        for step in 0..80 {
            // Nodes, links and "nothing" in random order (None every 7th step)
            if step % 7 == 6 {
                chart.clear_hover(&mut scene);
            } else if r() < 0.5 {
                chart.hover_hierarchy_item(&mut scene, 0, (r() * nodes as f64) as u32);
            } else {
                chart.hover_hierarchy_item(&mut scene, 1, (r() * links as f64) as u32);
            }
            let layers = chart.prepare_layers(&v);
            assert!(layers.fills.is_none() && layers.series.is_none(), "step {step}: no full re-upload");
            let bytes = chart_layer_bytes(&layers);
            backend.sync_chart(&layers);
            assert!(bytes * 4 < full, "step {step}: {bytes} B vs full {full} B");
            assert_eq!(positions(&chart), geometry, "geometry unchanged");
            // What the GPU draws == what the old CPU recolor wrote
            let drawn = chart.fill_style.resolved(&chart.fills).to_vec();
            let mut want = chart.fills.clone();
            chart.sankey().unwrap().recolor_reference(hovered(&chart), &mut want);
            assert_colors_eq(&drawn, &want, &format!("seed {seed} step {step}"));
            assert_eq!(backend.chart_fill_style, Some(chart.fill_style), "uniform synced");
        }
    }
}

#[test]
fn sankey_10k_hover_sweep_stays_under_100_kb_per_frame() {
    let g = layered_sankey(10_000, 8, 71);
    validate_sankey(&g).unwrap();
    let mut chart = ChartState::new_sankey(g, SankeyOptions { iterations: 6, labels: false, ..Default::default() }, HierarchyStyle::default());
    let cam = camera(&chart);
    let v = view(&cam);
    let mut scene = SceneWorld::new();
    let mut backend = MockRenderBackend::default();
    let full = frame(&mut chart, &v, &mut backend);
    let vertices = backend.chart_fill_count;
    // Sweep the pointer across the plot like the bench (rows of hover points)
    let (mut max, mut total, mut hits) = (0u64, 0u64, 0u32);
    for k in 0..400 {
        let x = -0.95 + 1.9 * (k % 40) as f32 / 39.0;
        let y = 0.9 - 1.8 * (k / 40) as f32 / 9.0;
        hits += chart.hover_at(&v, &mut scene, (x, y)).is_some() as u32;
        let bytes = frame(&mut chart, &v, &mut backend);
        max = max.max(bytes);
        total += bytes;
    }
    println!("sankey-10k: {vertices} fill vertices, full {full} B, hover max {max} B, mean {} B over 400 moves ({hits} hits)", total / 400);
    assert!(hits > 100, "{hits}");
    assert!(full > 10_000_000, "{full}");
    assert!(max < 100_000, "{max} B per hover frame");
    assert_eq!(backend.chart_fill_count, vertices, "never re-uploaded whole");
}

#[test]
fn treemap_legend_emphasis_is_a_uniform_change() {
    for seed in 1..4u64 {
        // Random tree: 6 groups, random depth
        let mut r = rng(seed);
        let mut parents = vec![-1i32];
        for i in 1..400 {
            parents.push(if i <= 6 { 0 } else { (1.0 + r() * (i - 1) as f64) as i32 });
        }
        let values: Vec<f64> = (0..400).map(|_| 1.0 + r() * 50.0).collect();
        let tree = Tree::build(&parents, &values).unwrap();
        let mut chart = ChartState::new_treemap(tree, TreemapOptions::default(), HierarchyStyle::default());
        let cam = camera(&chart);
        let v = view(&cam);
        let mut backend = MockRenderBackend::default();
        frame(&mut chart, &v, &mut backend);
        let geometry = positions(&chart);
        for e in [Some(0), Some(3), None, Some(5), Some(1), None] {
            chart.set_emphasis(e);
            let layers = chart.prepare_layers(&v);
            assert!(layers.fills.is_none() && layers.fill_patch.is_none(), "{e:?}: no fill upload");
            let bytes = chart_layer_bytes(&layers);
            backend.sync_chart(&layers);
            assert!(bytes <= std::mem::size_of::<ChartFillStyleRaw>() as u64, "{e:?}: {bytes} B");
            assert_eq!(positions(&chart), geometry);
            // Old path: display color (emphasis fade on the CPU), headers faded further
            let ChartKind::Hierarchy(HierChart::Treemap(t)) = &chart.kind else { unreachable!() };
            let surface = HierarchyStyle::default().surface;
            let mut want = chart.fills.clone();
            for (c, tri) in t.cells.iter().zip(want.chunks_mut(6)) {
                let base = t.display_color(c.node as usize);
                let color = if c.kind == CellKind::Header { hierarchy::mix(base, surface, 0.5) } else { base };
                tri.iter_mut().for_each(|f| f.color = color);
            }
            assert_eq!(t.cells.len() * 6, want.len());
            let drawn = chart.fill_style.resolved(&chart.fills).to_vec();
            assert_colors_eq(&drawn, &want, &format!("seed {seed} emphasis {e:?}"));
        }
    }
}

#[test]
fn sunburst_fills_stay_untagged() {
    // Sunburst hover still re-tessellates (arcs + AA edges): its fills never follow the uniform
    let tree = Tree::build(&[-1, 0, 0, 1, 1, 2], &[0.0, 0.0, 0.0, 3.0, 2.0, 4.0]).unwrap();
    let mut chart = ChartState::new_sunburst(tree, SunburstOptions::default(), HierarchyStyle::default());
    let cam = camera(&chart);
    let mut scene = SceneWorld::new();
    chart.prepare_layers(&view(&cam));
    chart.hover_hierarchy_item(&mut scene, 0, 3);
    chart.set_emphasis(Some(0));
    chart.prepare_layers(&view(&cam));
    assert!(!chart.fills.is_empty());
    assert!(chart.fills.iter().all(|f| f.position[3] == 0.0));
    assert!(!chart.fill_style.is_on());
}
