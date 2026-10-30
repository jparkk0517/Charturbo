//! Morphing chart transitions (`universalTransition`-like): with `AnimationOptions::transition`
//! on, a chart re-rendered as another family of the same data morphs mark by mark, bar <-> pie
//! (matched by category / slice key) and treemap <-> sunburst (matched by node key).
//!
//! Every mark is reduced to the same polygon: an *inner* and an *outer* edge of `MORPH_K` CSS-px
//! points each (bar: base edge -> value end; slice / ring arc: inner arc -> outer arc; treemap
//! cell: bottom edge -> top edge). A rect and an annular sector share that (inner edge, outer
//! edge) parameterization, so a point-wise lerp of the two edges is again a valid strip of quads
//! at every frame and no resampling, correspondence search or triangulation runs per frame; the
//! frame is a quad strip between the lerped edges. Keys pair marks (`set_mark_keys`; index when
//! absent); a mark without a partner fades in / out in place.
//!
//! Mid-morph the strips have no corner rounding or anti-aliased outlines, data labels / axes are
//! already at the final layout, and hit-testing uses the final layout.

use super::hierarchy::FlatScreen;
use super::*;
use std::collections::HashMap;

/// Key of the sunburst center disk (the current root) and of the folded "Other" pie slice.
const ROOT_KEY: u32 = u32::MAX - 2;
const OTHER_KEY: u32 = u32::MAX - 1;

/// Points per edge of a morph polygon.
pub(crate) const MORPH_K: usize = 24;
/// Charts with more marks than this do not morph (they enter instead).
pub(crate) const MAX_MORPH_SHAPES: usize = 2_000;

/// One mark as a morph polygon: inner / outer edge in CSS px from the canvas top-left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct MorphShape {
    pub(crate) key: u32,
    pub(crate) color: [f32; 4],
    pub(crate) inner: [[f32; 2]; MORPH_K],
    pub(crate) outer: [[f32; 2]; MORPH_K],
}

/// Morph family of a chart: 1 = 2D bars, 2 = pie, 3 = treemap, 4 = sunburst, 0 = none.
pub(crate) fn morph_family(kind: &ChartKind) -> u8 {
    match kind {
        ChartKind::Bar(b)
            if b.layout.view == ChartViewMode::Flat
                && b.pictorial.is_none()
                && b.histogram.is_none() =>
        {
            1
        }
        ChartKind::Pie(_) => 2,
        ChartKind::Hierarchy(HierChart::Treemap(_)) => 3,
        ChartKind::Hierarchy(HierChart::Sunburst(_)) => 4,
        _ => 0,
    }
}

/// Families that morph into each other: bar <-> pie and treemap <-> sunburst.
pub(crate) fn morph_pair(a: u8, b: u8) -> bool {
    matches!((a.min(b), a.max(b)), (1, 2) | (3, 4))
}

fn lerp2(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// `MORPH_K` points from `a` to `b`.
fn edge_line(a: [f32; 2], b: [f32; 2]) -> [[f32; 2]; MORPH_K] {
    std::array::from_fn(|j| lerp2(a, b, j as f32 / (MORPH_K - 1) as f32))
}

/// `MORPH_K` points along the arc of CSS radius `r` around `c` over compass angles `lo..hi`
/// (0 = up, clockwise; CSS y points down).
fn edge_arc(c: [f32; 2], lo: f32, hi: f32, r: f32) -> [[f32; 2]; MORPH_K] {
    std::array::from_fn(|j| {
        let phi = lo + (hi - lo) * j as f32 / (MORPH_K - 1) as f32;
        [c[0] + r * phi.sin(), c[1] - r * phi.cos()]
    })
}

fn push_shape(
    out: &mut Vec<MorphShape>,
    key: u32,
    color: [f32; 4],
    inner: [[f32; 2]; MORPH_K],
    outer: [[f32; 2]; MORPH_K],
) {
    let finite = inner
        .iter()
        .chain(&outer)
        .flatten()
        .chain(&color)
        .all(|v| v.is_finite());
    if finite {
        out.push(MorphShape {
            key,
            color,
            inner,
            outer,
        });
    }
}

impl ChartState {
    /// Mark key of input / node `i` (`set_mark_keys`; the index when absent).
    fn morph_key(&self, i: usize) -> u32 {
        self.anim.keys.get(i).copied().unwrap_or(i as u32)
    }

    /// Morph polygons of the marks on screen (empty for kinds that do not morph, without a flat
    /// view, or past `MAX_MORPH_SHAPES`).
    pub(crate) fn morph_shapes(&self, view: &ChartView) -> Vec<MorphShape> {
        let Some(screen) = FlatScreen::of(view) else {
            return Vec::new();
        };
        let css = |x: f32, y: f32| {
            let (cx, cy) = screen.css(x, y);
            [cx, cy]
        };
        let center = css(0.0, 0.0);
        // Large charts never morph: skip building their polygons (every replacement snapshots)
        let marks = match &self.kind {
            ChartKind::Bar(b) => b.shown_segs().len(),
            ChartKind::Hierarchy(HierChart::Treemap(t)) => t.cells.len(),
            _ => 0,
        };
        if marks > MAX_MORPH_SHAPES {
            return Vec::new();
        }
        let mut out = Vec::new();
        match &self.kind {
            ChartKind::Bar(b) if morph_family(&self.kind) == 1 => {
                for (g, seg) in b.shown_segs().iter().enumerate() {
                    let Some(s) = seg else { continue };
                    let p = |c: f32, v: f32| {
                        let (x, y) = b.world(c, v);
                        css(x, y)
                    };
                    let (inner, outer) = (
                        edge_line(p(s.x0, s.y0), p(s.x1, s.y0)),
                        edge_line(p(s.x0, s.y1), p(s.x1, s.y1)),
                    );
                    push_shape(&mut out, self.morph_key(g), b.race_color(g), inner, outer);
                }
            }
            ChartKind::Pie(p) => {
                for (source, (lo, hi), r_in, r_out, color) in p.morph_slices() {
                    let key = source.map_or(OTHER_KEY, |i| self.morph_key(i));
                    let (inner, outer) = (
                        edge_arc(center, lo, hi, r_in / screen.wpp),
                        edge_arc(center, lo, hi, r_out / screen.wpp),
                    );
                    push_shape(&mut out, key, color, inner, outer);
                }
            }
            ChartKind::Hierarchy(HierChart::Treemap(t)) => {
                for c in &t.cells {
                    let [l, top, w, h] = c.rect;
                    let (inner, outer) = (
                        edge_line([l, top + h], [l + w, top + h]),
                        edge_line([l, top], [l + w, top]),
                    );
                    push_shape(
                        &mut out,
                        self.morph_key(c.node as usize),
                        t.cell_color(c),
                        inner,
                        outer,
                    );
                }
            }
            ChartKind::Hierarchy(HierChart::Sunburst(s)) => {
                for (i, (node, lo, hi, r_in, r_out, color)) in
                    s.morph_arcs(screen.wpp).into_iter().enumerate()
                {
                    let key = if i == 0 {
                        ROOT_KEY
                    } else {
                        self.morph_key(node as usize)
                    };
                    let (inner, outer) = (
                        edge_arc(center, lo, hi, r_in / screen.wpp),
                        edge_arc(center, lo, hi, r_out / screen.wpp),
                    );
                    push_shape(&mut out, key, color, inner, outer);
                }
            }
            _ => {}
        }
        if out.len() > MAX_MORPH_SHAPES {
            out.clear();
        }
        out
    }
}

/// Morph frame at eased progress `e`: shapes of `from` and `to` paired by key are lerped, the
/// others fade (leaving shapes first, then the targets in order).
pub(crate) fn morph_frame(from: &[MorphShape], to: &[MorphShape], e: f32) -> Vec<MorphShape> {
    let e = if e.is_finite() {
        e.clamp(0.0, 1.0)
    } else {
        1.0
    };
    let mut by_key: HashMap<u32, usize> = HashMap::with_capacity(from.len());
    for (i, s) in from.iter().enumerate() {
        by_key.entry(s.key).or_insert(i);
    }
    let mut used = vec![false; from.len()];
    let mut targets = Vec::with_capacity(to.len());
    for t in to {
        let mut s = *t;
        match by_key.get(&t.key).copied() {
            Some(i) if !used[i] => {
                used[i] = true;
                let f = &from[i];
                s.inner = std::array::from_fn(|j| lerp2(f.inner[j], t.inner[j], e));
                s.outer = std::array::from_fn(|j| lerp2(f.outer[j], t.outer[j], e));
                s.color = std::array::from_fn(|c| f.color[c] + (t.color[c] - f.color[c]) * e);
            }
            _ => s.color[3] *= e,
        }
        targets.push(s);
    }
    let mut out: Vec<MorphShape> = from
        .iter()
        .zip(&used)
        .filter(|(_, u)| !**u)
        .map(|(s, _)| {
            let mut s = *s;
            s.color[3] *= 1.0 - e;
            s
        })
        .collect();
    out.extend(targets);
    out
}

/// Quad strips between the inner and outer edge of each shape (world coordinates, no emphasis).
pub(crate) fn push_morph_fills(
    screen: &FlatScreen,
    shapes: &[MorphShape],
    fills: &mut Vec<ChartFillRaw>,
) {
    fills.clear();
    fills.reserve(shapes.len() * (MORPH_K - 1) * 6);
    for s in shapes {
        let v = |p: [f32; 2]| {
            let (x, y) = screen.world(p[0], p[1]);
            ChartFillRaw {
                position: [x, y, 0.0, 0.0],
                color: s.color,
            }
        };
        for j in 0..MORPH_K - 1 {
            let (a, b, c, d) = (
                v(s.inner[j]),
                v(s.inner[j + 1]),
                v(s.outer[j + 1]),
                v(s.outer[j]),
            );
            fills.extend([a, b, c, a, c, d]);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::hierarchy::FlatScreen;
    use super::*;
    use crate::scene::SceneWorld;

    const PER_SHAPE: usize = (MORPH_K - 1) * 6;

    fn cam() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn opts() -> Option<AnimationOptions> {
        AnimationOptions::new(100.0, Easing::Linear)
    }

    fn morph_opts() -> Option<AnimationOptions> {
        opts().map(|o| o.with_transition(true))
    }

    fn bars(values: &[f32], cam: &mut OrbitCamera, scene: &mut SceneWorld) -> ChartState {
        let layout = BarLayout {
            width: 160.0,
            max_height: 80.0,
            bar_width: 0.0,
            corner_radius_px: 0.0,
            view: ChartViewMode::Flat,
        };
        let c = ChartState::new_bar(values.to_vec(), vec![[0.2, 0.4, 0.8, 1.0]], layout, scene);
        c.frame_camera(cam, (1600.0, 900.0));
        c
    }

    fn pie(values: &[f64], cam: &mut OrbitCamera) -> ChartState {
        let opts = PieOptions {
            max_slices: 0,
            labels: PieLabelMode::None,
            ..Default::default()
        };
        let c = ChartState::new_pie(values, opts, PieStyle::default());
        c.frame_camera(cam, (1600.0, 900.0));
        c
    }

    fn hier(sunburst: bool, cam: &mut OrbitCamera) -> ChartState {
        let tree = Tree::build(&[-1, 0, 0, 1, 1, 2], &[0.0, 0.0, 0.0, 3.0, 2.0, 4.0]).unwrap();
        let c = if sunburst {
            ChartState::new_sunburst(tree, SunburstOptions::default(), HierarchyStyle::default())
        } else {
            ChartState::new_treemap(tree, TreemapOptions::default(), HierarchyStyle::default())
        };
        c.frame_camera(cam, (1600.0, 900.0));
        c
    }

    /// Renders `c` once (animation done) and snapshots it the way a replaced chart is.
    fn replaced(
        c: &mut ChartState,
        cam: &OrbitCamera,
        opts: Option<AnimationOptions>,
    ) -> AnimSnapshot {
        c.arm_animation(opts, None);
        c.finish_animation();
        c.prepare_layers(&view(cam));
        c.anim_snapshot_in(&view(cam)).unwrap()
    }

    fn css(cam: &OrbitCamera, f: &ChartFillRaw) -> [f32; 2] {
        let s = FlatScreen::of(&view(cam)).unwrap();
        let (x, y) = s.css(f.position[0], f.position[1]);
        [x, y]
    }

    fn near(a: [f32; 2], b: [f32; 2]) -> bool {
        (a[0] - b[0]).abs() < 0.05 && (a[1] - b[1]).abs() < 0.05
    }

    fn mid2(a: [f32; 2], b: [f32; 2]) -> [f32; 2] {
        [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])]
    }

    fn finite(fills: &[ChartFillRaw]) -> bool {
        fills
            .iter()
            .all(|f| f.position.iter().chain(&f.color).all(|v| v.is_finite()))
    }

    fn by_key(shapes: &[MorphShape], key: u32) -> MorphShape {
        *shapes.iter().find(|s| s.key == key).unwrap()
    }

    #[test]
    fn bar_to_pie_morph_lerps_matched_shapes_on_interpolated_frames() {
        let (mut ca, mut cb) = (cam(), cam());
        let mut scene = SceneWorld::new();
        let mut old = bars(&[4.0, 3.0, 2.0, 1.0], &mut ca, &mut scene);
        let snap = replaced(&mut old, &ca, morph_opts());
        let from = old.morph_shapes(&view(&ca));
        let mut next = pie(&[4.0, 3.0, 2.0, 1.0], &mut cb);
        next.arm_animation(morph_opts(), Some(snap));
        assert!(next.anim_is_morph());
        next.animation_tick(0.0);
        let first = next.prepare_layers(&view(&cb)).fills.unwrap().to_vec();
        next.animation_tick(50.0);
        let layers = next.prepare_layers(&view(&cb));
        assert_eq!(
            layers.bars.map(|b| b.len()),
            Some(0),
            "the pie's own layers wait"
        );
        let mid = layers.fills.unwrap().to_vec();
        let to = next.morph_shapes(&view(&cb));
        assert_eq!((from.len(), to.len()), (4, 4));
        assert_eq!((first.len(), mid.len()), (4 * PER_SHAPE, 4 * PER_SHAPE));
        assert!(finite(&first) && finite(&mid));
        for (k, (a, b)) in from.iter().zip(&to).enumerate() {
            let at = k * PER_SHAPE;
            // Quad 0 = (inner[0], inner[1], outer[1]), (inner[0], outer[1], outer[0])
            assert!(
                near(css(&cb, &first[at]), a.inner[0]),
                "e = 0: bar {k}'s base"
            );
            assert!(
                near(css(&cb, &first[at + 5]), a.outer[0]),
                "e = 0: bar {k}'s end"
            );
            assert!(
                near(css(&cb, &mid[at]), mid2(a.inner[0], b.inner[0])),
                "e = 0.5: inner edge of {k}"
            );
            assert!(
                near(css(&cb, &mid[at + 5]), mid2(a.outer[0], b.outer[0])),
                "e = 0.5: outer edge of {k}"
            );
            let c = mid[at].color;
            assert!(
                (0..4).all(|i| (c[i] - 0.5 * (a.color[i] + b.color[i])).abs() < 1e-4),
                "color of {k}"
            );
        }
        // The bar's base edge is a straight segment, the slice's outer edge an arc
        let j = MORPH_K / 2;
        let on_chord = |e: &[[f32; 2]; MORPH_K]| {
            near(
                e[j],
                lerp2(e[0], e[MORPH_K - 1], j as f32 / (MORPH_K - 1) as f32),
            )
        };
        assert!(on_chord(&from[0].inner) && on_chord(&from[0].outer));
        assert!(!on_chord(&to[0].outer));
        next.finish_animation();
        assert!(!next.anim_is_morph());
        assert_ne!(
            next.prepare_layers(&view(&cb)).fills.map(|f| f.len()),
            Some(4 * PER_SHAPE)
        );
    }

    #[test]
    fn treemap_to_sunburst_matches_nodes_by_key_and_fades_the_rest() {
        let (mut ca, mut cb) = (cam(), cam());
        let mut old = hier(false, &mut ca);
        old.set_mark_keys(vec![10, 11, 12, 13, 14, 15]);
        let snap = replaced(&mut old, &ca, morph_opts());
        let from = old.morph_shapes(&view(&ca));
        let mut next = hier(true, &mut cb);
        next.set_mark_keys(vec![10, 11, 12, 13, 14, 99]);
        next.arm_animation(morph_opts(), Some(snap));
        assert!(next.anim_is_morph());
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        let mid = next.prepare_layers(&view(&cb)).fills.unwrap().to_vec();
        let to = next.morph_shapes(&view(&cb));
        assert!(from.iter().any(|s| s.key == 15) && !from.iter().any(|s| s.key == 99));
        assert!(to.iter().any(|s| s.key == 99) && !to.iter().any(|s| s.key == 15));
        let frame = morph_frame(&from, &to, 0.5);
        assert_eq!(mid.len(), frame.len() * PER_SHAPE);
        assert!(finite(&mid));
        for (i, s) in frame.iter().enumerate() {
            assert!(
                near(css(&cb, &mid[i * PER_SHAPE]), s.inner[0]),
                "shape {i} drawn from the frame"
            );
        }
        // Node 3 (key 13): rect -> ring arc, half way
        let (a, b, m) = (by_key(&from, 13), by_key(&to, 13), by_key(&frame, 13));
        for j in [0, MORPH_K / 2, MORPH_K - 1] {
            assert!(
                near(m.inner[j], mid2(a.inner[j], b.inner[j]))
                    && near(m.outer[j], mid2(a.outer[j], b.outer[j]))
            );
        }
        // Renamed node: the old one fades out where it was, the new one fades in where it lands
        let (gone, out) = (by_key(&from, 15), by_key(&frame, 15));
        assert_eq!((out.inner, out.outer), (gone.inner, gone.outer));
        assert!((out.color[3] - 0.5 * gone.color[3]).abs() < 1e-5);
        let (new, inn) = (by_key(&to, 99), by_key(&frame, 99));
        assert_eq!((inn.inner, inn.outer), (new.inner, new.outer));
        assert!((inn.color[3] - 0.5 * new.color[3]).abs() < 1e-5);
    }

    #[test]
    fn transitions_are_opt_in_and_only_morph_across_paired_families() {
        let (mut ca, mut cb) = (cam(), cam());
        let mut scene = SceneWorld::new();
        let values = [4.0, 3.0, 2.0, 1.0];
        // Transition off: bar -> pie enters (existing behavior)
        let snap = replaced(&mut bars(&values, &mut ca, &mut scene), &ca, opts());
        let mut p = pie(&[4.0, 3.0, 2.0, 1.0], &mut cb);
        p.arm_animation(opts(), Some(snap));
        assert!(p.is_animating() && !p.anim_is_morph() && !p.anim_is_update());
        // On, same family: bar -> bar tweens as before
        let snap = replaced(&mut bars(&values, &mut ca, &mut scene), &ca, morph_opts());
        let mut b = bars(&[2.0, 3.0, 4.0, 5.0], &mut cb, &mut scene);
        b.arm_animation(morph_opts(), Some(snap));
        assert!(b.anim_is_update() && !b.anim_is_morph());
        // On, unpaired families: bar -> treemap enters
        let snap = replaced(&mut bars(&values, &mut ca, &mut scene), &ca, morph_opts());
        let mut t = hier(false, &mut cb);
        t.arm_animation(morph_opts(), Some(snap));
        assert!(t.is_animating() && !t.anim_is_morph());
        // Animations off on the new chart: nothing runs
        let snap = replaced(&mut bars(&values, &mut ca, &mut scene), &ca, morph_opts());
        let mut p = pie(&[4.0, 3.0, 2.0, 1.0], &mut cb);
        p.arm_animation(None, Some(snap));
        assert!(!p.is_animating());
    }

    #[test]
    fn a_morph_restarts_from_the_shown_shapes_and_drops_non_finite_marks() {
        let (mut ca, mut cb, mut cc) = (cam(), cam(), cam());
        let mut scene = SceneWorld::new();
        let snap = replaced(
            &mut bars(&[4.0, f32::NAN, 2.0, 1.0], &mut ca, &mut scene),
            &ca,
            morph_opts(),
        );
        let mut next = pie(&[4.0, 3.0, 2.0, 1.0], &mut cb);
        next.arm_animation(morph_opts(), Some(snap));
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        let shown = next.prepare_layers(&view(&cb)).fills.unwrap().to_vec();
        assert_eq!(shown.len(), 4 * PER_SHAPE, "3 bars morph, slice 1 fades in");
        assert!(finite(&shown));
        assert!((shown[PER_SHAPE].color[3] - 0.5).abs() < 1e-4);
        // Re-rendered mid-morph: the next morph starts from the shapes on screen
        let snap2 = next.anim_snapshot_in(&view(&cb)).unwrap();
        let mut third = bars(&[4.0, 3.0, 2.0, 1.0], &mut cc, &mut scene);
        third.arm_animation(morph_opts(), Some(snap2));
        third.animation_tick(0.0);
        let start = third.prepare_layers(&view(&cc)).fills.unwrap().to_vec();
        assert_eq!(start.len(), shown.len());
        for k in 0..4 {
            assert!(
                near(
                    css(&cc, &start[k * PER_SHAPE]),
                    css(&cb, &shown[k * PER_SHAPE])
                ),
                "shape {k}"
            );
            assert_eq!(start[k * PER_SHAPE].color, shown[k * PER_SHAPE].color);
        }
        // Once done, a snapshot holds the final shapes, not the stale mid-morph ones
        third.finish_animation();
        third.prepare_layers(&view(&cc));
        let snap3 = third.anim_snapshot_in(&view(&cc)).unwrap();
        let mut fourth = pie(&[4.0, 3.0, 2.0, 1.0], &mut cb);
        fourth.arm_animation(morph_opts(), Some(snap3));
        fourth.animation_tick(0.0);
        let begin = fourth.prepare_layers(&view(&cb)).fills.unwrap().to_vec();
        let fin = third.morph_shapes(&view(&cc));
        for (k, s) in fin.iter().enumerate() {
            assert!(
                near(css(&cb, &begin[k * PER_SHAPE]), s.inner[0]),
                "final bar {k}"
            );
        }
    }
}
