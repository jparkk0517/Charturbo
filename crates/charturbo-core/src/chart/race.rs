//! Races: bar races (`realtimeSort`) and line end labels.
//!
//! - Bar race: a single-series 2D bar chart re-rendered with re-ordered data tweens each bar
//!   from where its *key* (mark keys, see `ChartState::set_mark_keys`) was drawn in the previous
//!   chart, not from its index. Bars of new keys slide in from just past the last slot and fade
//!   in; keys that left the data slide out there and fade out. The frame is laid out before the
//!   data labels and axes so labels and category ticks ride with their bars. Hit-testing uses the
//!   final layout.
//! - Line race: `line_end_labels` anchors one label per visible series at the line end: the last
//!   drawn sample, or during the left -> right reveal the point under the reveal front.

use super::bar::{BarChart, BarMode, BarSeg};
use super::*;
use std::collections::HashMap;

/// One bar of a race snapshot: its key, drawn segment and color.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct RaceBar {
    pub(crate) key: u32,
    pub(crate) seg: BarSeg,
    pub(crate) color: [f32; 4],
}

/// Interpolated bar race frame (by global id) plus the bars of keys that left the data.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct BarRaceFrame {
    pub(crate) segs: Vec<Option<BarSeg>>,
    pub(crate) alpha: Vec<f32>,
    /// Leaving bars: segment and faded color
    pub(crate) exits: Vec<(BarSeg, [f32; 4])>,
}

/// End label anchor of a line series (CSS px from the canvas top-left) and the value there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LineEndLabel {
    pub series: u32,
    pub x_css: f32,
    pub y_css: f32,
    pub value: f32,
}

fn finite_seg(s: &BarSeg) -> bool {
    s.x0.is_finite() && s.x1.is_finite() && s.y0.is_finite() && s.y1.is_finite()
}

fn lerp_seg(a: BarSeg, b: BarSeg, e: f32) -> BarSeg {
    let l = |p: f32, q: f32| p + (q - p) * e;
    BarSeg {
        x0: l(a.x0, b.x0),
        x1: l(a.x1, b.x1),
        y0: l(a.y0, b.y0),
        y1: l(a.y1, b.y1),
        outer: b.outer,
    }
}

impl BarChart {
    /// The race applies: flag on, single-series 2D bars without pictorial / histogram / floats.
    pub(crate) fn race_eligible(&self) -> bool {
        self.race_sort
            && self.series_count == 1
            && self.mode == BarMode::Grouped
            && self.layout.view == ChartViewMode::Flat
            && self.pictorial.is_none()
            && self.histogram.is_none()
            && self.bases.is_empty()
    }

    /// Segments on screen: the race frame mid-race, else the layout.
    pub(crate) fn shown_segs(&self) -> &[Option<BarSeg>] {
        self.race.as_ref().map_or(&self.segs, |r| &r.segs)
    }

    /// Fill of bar `global` (faded while it enters mid-race).
    pub(crate) fn race_color(&self, global: usize) -> [f32; 4] {
        let mut c = self.color_of(global);
        if let Some(r) = &self.race {
            c[3] *= r.alpha.get(global).copied().unwrap_or(1.0);
        }
        c
    }

    /// Category-axis center of category `i`'s tick: its bar mid-race, else the slot.
    pub(crate) fn race_slot(&self, i: usize) -> f32 {
        self.race
            .as_ref()
            .and_then(|r| r.segs.get(i).copied().flatten())
            .map_or(self.slots[i].0, |s| 0.5 * (s.x0 + s.x1))
    }

    /// Keyed bars on screen (`keys` by global id; empty unless the race applies).
    pub(crate) fn race_snapshot(&self, keys: &[u32]) -> Vec<RaceBar> {
        if !self.race_eligible() || keys.len() != self.values.len() {
            return Vec::new();
        }
        let mut out: Vec<RaceBar> = self
            .shown_segs()
            .iter()
            .enumerate()
            .filter_map(|(g, s)| {
                let seg = s.filter(finite_seg)?;
                Some(RaceBar {
                    key: keys[g],
                    seg,
                    color: self.race_color(g),
                })
            })
            .collect();
        // Bars still leaving keep leaving from where they are (key unused by the new data)
        if let Some(r) = &self.race {
            out.extend(r.exits.iter().map(|&(seg, color)| RaceBar {
                key: u32::MAX,
                seg,
                color,
            }));
        }
        out
    }

    /// `seg` moved along the category axis to one slot past the last (where bars enter / leave).
    fn parked(&self, seg: BarSeg) -> BarSeg {
        let Some(last) = self.slots.last() else {
            return seg;
        };
        let d = last.0 + self.spacing - 0.5 * (seg.x0 + seg.x1);
        BarSeg {
            x0: seg.x0 + d,
            x1: seg.x1 + d,
            ..seg
        }
    }

    /// Race frame at eased progress `e`: keys found in `from` tween from their old bar, new keys
    /// slide in from past the last slot while fading in, keys gone from the data slide out there
    /// while fading out.
    pub(crate) fn race_frame(&self, from: &[RaceBar], keys: &[u32], e: f32) -> BarRaceFrame {
        let e = if e.is_finite() {
            e.clamp(0.0, 1.0)
        } else {
            1.0
        };
        let mut by_key: HashMap<u32, usize> = HashMap::with_capacity(from.len());
        for (i, b) in from.iter().enumerate() {
            by_key.entry(b.key).or_insert(i);
        }
        let n = self.segs.len();
        let mut frame = BarRaceFrame {
            segs: vec![None; n],
            alpha: vec![1.0; n],
            exits: Vec::new(),
        };
        let mut used = vec![false; from.len()];
        for (g, to) in self.segs.iter().enumerate() {
            let Some(to) = to.filter(finite_seg) else {
                continue;
            };
            match keys.get(g).and_then(|k| by_key.get(k)).copied() {
                Some(i) if !used[i] && from[i].key != u32::MAX => {
                    used[i] = true;
                    frame.segs[g] = Some(lerp_seg(from[i].seg, to, e));
                }
                _ => {
                    frame.segs[g] = Some(lerp_seg(self.parked(to), to, e));
                    frame.alpha[g] = e;
                }
            }
        }
        for (b, _) in from.iter().zip(&used).filter(|(_, u)| !**u) {
            let mut color = b.color;
            color[3] *= 1.0 - e;
            frame
                .exits
                .push((lerp_seg(b.seg, self.parked(b.seg), e), color));
        }
        frame
    }
}

impl ChartState {
    /// Turns the bar race on / off (single-series 2D bars; needs mark keys). Returns false
    /// without a bar chart.
    pub fn set_bar_race(&mut self, on: bool) -> bool {
        let ChartKind::Bar(b) = &mut self.kind else {
            return false;
        };
        b.race_sort = on;
        true
    }

    /// Lays out this frame's bar race (run by `prepare_layers` before the labels and axes, which
    /// then follow the interpolated frame).
    pub(crate) fn prepare_bar_race(&mut self) {
        let frame = match (&self.kind, self.race_source()) {
            (ChartKind::Bar(b), Some((from, e)))
                if b.race_eligible() && self.anim.keys.len() == b.values.len() =>
            {
                Some(b.race_frame(from, &self.anim.keys, e))
            }
            _ => None,
        };
        let ChartKind::Bar(b) = &mut self.kind else {
            return;
        };
        if frame.is_none() && b.race.is_none() {
            return;
        }
        b.race = frame.map(Box::new);
        b.labels.key = None;
        self.axes_key = None;
        self.dirty.bars = true;
    }

    /// Drops the race frame (the animation ended): the final layout shows on the next frame.
    pub(crate) fn end_bar_race(&mut self) {
        if let ChartKind::Bar(b) = &mut self.kind {
            if b.race.take().is_some() {
                b.labels.key = None;
                self.axes_key = None;
                self.dirty.bars = true;
            }
        }
    }

    /// End label anchors of the visible series of a 2D line chart (empty otherwise): the last
    /// drawable sample in the zoom window, or during the reveal enter the point under the reveal
    /// front (interpolated between samples). A reversed x axis anchors at the last sample.
    pub fn line_end_labels(&self, view: &ChartView) -> Vec<LineEndLabel> {
        let ChartKind::Line(l) = &self.kind else {
            return Vec::new();
        };
        let (w0, w1) = (l.window.0 as f64, l.window.1 as f64);
        let front = match self.anim.reveal_front_px {
            Some(px) if l.x_scale.sign() > 0.0 => {
                let Some(screen) = super::hierarchy::FlatScreen::of(view) else {
                    return Vec::new();
                };
                let (x, _) = screen.world(px / screen.pixel_ratio, 0.0);
                Some(l.t_of_x64(x).min(w1))
            }
            _ => None,
        };
        let t_lim = front.unwrap_or(w1);
        let mut out = Vec::new();
        for s in 0..l.series.len() {
            if !l.visible.get(s).copied().unwrap_or(true) {
                continue;
            }
            let n = l.len(s);
            if n == 0 || !t_lim.is_finite() {
                continue;
            }
            // Last sample at or before the limit
            let last = match l.xs(s) {
                Some(x) => {
                    let target = t_lim * l.x_span + l.x_shift();
                    x.partition_point(|&v| v <= target + 1e-9 * l.x_span.abs())
                        .checked_sub(1)
                }
                None if n == 1 => (t_lim >= 0.5).then_some(0),
                None => {
                    let f = (t_lim * (n - 1) as f64 + 1e-6).floor();
                    (f >= 0.0).then(|| (f as usize).min(n - 1))
                }
            };
            let Some(mut i) = last else { continue };
            let vals = l.vals(s);
            while !l.drawable(s, vals[i]) && i > 0 {
                i -= 1;
            }
            let t_i = l.t_at64(s, i);
            if !l.drawable(s, vals[i]) || t_i < w0 - 1e-9 {
                continue;
            }
            let (mut t, mut v) = (t_i, vals[i]);
            if front.is_some() && i + 1 < n && l.drawable(s, vals[i + 1]) {
                let t_n = l.t_at64(s, i + 1);
                if t_n > t_lim && t_n > t_i {
                    let f = (((t_lim - t_i) / (t_n - t_i)) as f32).clamp(0.0, 1.0);
                    v += (vals[i + 1] - v) * f;
                    t = t_lim;
                }
            }
            let p = Vec3::new(l.x_of_t(t), l.y_of_axis(l.axis_of(s), v), l.z[s]);
            let Some((x_css, y_css)) = view.project_css(p) else {
                continue;
            };
            if x_css.is_finite() && y_css.is_finite() && v.is_finite() {
                out.push(LineEndLabel {
                    series: s as u32,
                    x_css,
                    y_css,
                    value: v,
                });
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::SceneWorld;

    fn flat_camera() -> OrbitCamera {
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

    /// Horizontal race chart of `values` keyed by `keys`, labels on, framed.
    fn race(
        values: &[f32],
        keys: &[u32],
        cam: &mut OrbitCamera,
        scene: &mut SceneWorld,
    ) -> ChartState {
        let mut c = ChartState::new_bar(
            values.to_vec(),
            vec![[0.2, 0.4, 0.8, 1.0]],
            BarLayout {
                width: 160.0,
                max_height: 80.0,
                bar_width: 0.0,
                corner_radius_px: 0.0,
                view: ChartViewMode::Flat,
            },
            scene,
        );
        let style = BarStyle {
            orientation: super::super::bar_style::BarOrientation::Horizontal,
            ..Default::default()
        };
        assert!(c.set_bar_style(style));
        let sizes = vec![[20.0, 10.0]; values.len()];
        let opts = BarLabelOptions {
            mode: BarLabelMode::Show,
            position: BarLabelPosition::Outside,
            pad_px: 4.0,
        };
        assert!(c.set_bar_labels(opts, sizes));
        c.set_mark_keys(keys.to_vec());
        assert!(c.set_bar_race(true));
        c.frame_camera(cam, (1600.0, 900.0));
        c
    }

    fn final_bars(c: &ChartState, cam: &OrbitCamera) -> Vec<ChartBarRaw> {
        let mut done = c.clone();
        done.finish_animation();
        done.prepare_layers(&view(cam)).bars.unwrap().to_vec()
    }

    fn mid(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
        [
            0.5 * (a[0] + b[0]),
            0.5 * (a[1] + b[1]),
            0.5 * (a[2] + b[2]),
            0.5 * (a[3] + b[3]),
        ]
    }

    fn close(a: [f32; 4], b: [f32; 4]) -> bool {
        a.iter().zip(&b).all(|(x, y)| (x - y).abs() < 1e-3)
    }

    fn category_ticks(c: &ChartState) -> Vec<(f64, f32)> {
        c.axes()
            .ticks
            .iter()
            .filter(|t| t.axis == 1)
            .map(|t| (t.value, t.y_css))
            .collect()
    }

    #[test]
    fn bar_race_tweens_by_key_and_labels_and_category_ticks_ride_along() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        // Old order: a b c; new order (sorted desc): c b a
        let mut old = race(&[30.0, 20.0, 10.0], &[1, 2, 3], &mut cam, &mut scene);
        old.arm_animation(opts(), None);
        let from = final_bars(&old, &cam);
        old.finish_animation();
        old.prepare_layers(&view(&cam));
        let old_ticks = category_ticks(&old);
        let snap = old.anim_snapshot().expect("snapshot");

        let mut next = race(&[40.0, 25.0, 15.0], &[3, 2, 1], &mut cam, &mut scene);
        next.arm_animation(opts(), Some(snap));
        let to = final_bars(&next, &cam);
        let mut done = next.clone();
        done.finish_animation();
        done.prepare_layers(&view(&cam));
        let new_ticks = category_ticks(&done);
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        let bars = next.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert_eq!(bars.len(), 3);
        // New bar 0 is key 3: halfway between old bar 2 and its new place (rect and color)
        for (g, old_g) in [(0usize, 2usize), (1, 1), (2, 0)] {
            assert!(
                close(bars[g].rect, mid(from[old_g].rect, to[g].rect)),
                "bar {g}: {:?}",
                bars[g].rect
            );
            assert!(bars[g].rect.iter().all(|v| v.is_finite()));
        }
        // Category ticks (value = new category index) move with the bars
        let ticks = category_ticks(&next);
        assert_eq!(ticks.len(), 3);
        for (value, y) in &ticks {
            let i = *value as usize;
            let old_i = 2 - i;
            let want = 0.5 * (old_ticks[old_i].1 + new_ticks[i].1);
            assert!((y - want).abs() < 0.5, "tick {i}: {y} vs {want}");
        }
        // Data labels follow the interpolated bar ends
        let (labels, _) = next.bar_labels().expect("labels");
        let (done_labels, _) = done.bar_labels().expect("labels");
        let l0 = labels.iter().find(|l| l.global == 0).unwrap();
        let d0 = done_labels.iter().find(|l| l.global == 0).unwrap();
        assert!(
            (l0.y_css - d0.y_css).abs() > 5.0,
            "label 0 still on its way: {} vs {}",
            l0.y_css,
            d0.y_css
        );

        // Ends on the final layout
        assert!(!next.animation_tick(100.0));
        let end = next.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert_eq!(end, to);
        assert_eq!(category_ticks(&next), new_ticks);
    }

    #[test]
    fn bar_race_slides_entering_and_leaving_keys_in_and_out_with_fades() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut old = race(&[20.0, 10.0], &[1, 2], &mut cam, &mut scene);
        old.arm_animation(opts(), None);
        old.finish_animation();
        let from = final_bars(&old, &cam);
        let snap = old.anim_snapshot().expect("snapshot");
        // Key 1 leaves, key 3 enters
        let mut next = race(&[30.0, 15.0], &[2, 3], &mut cam, &mut scene);
        next.arm_animation(opts(), Some(snap));
        let to = final_bars(&next, &cam);
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        let bars = next.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert_eq!(bars.len(), 3, "two bars + one leaving");
        // Key 2 moved from old slot 1 to new slot 0
        let moving = bars
            .iter()
            .find(|b| close(b.rect, mid(from[1].rect, to[0].rect)))
            .expect("key 2 tweens");
        assert!((moving.color[3] - 1.0).abs() < 1e-6);
        // Entering key 3 fades in at half strength; the leaving bar fades out at half strength
        let faded: Vec<_> = bars
            .iter()
            .filter(|b| (b.color[3] - 0.5).abs() < 1e-4)
            .collect();
        assert_eq!(faded.len(), 2, "{bars:?}");
        // Entering / leaving bars stay below the last slot's top edge (they slide past the end)
        let last_top = to[1].rect[3];
        assert!(
            faded.iter().all(|b| b.rect[3] <= last_top + 1e-3),
            "{faded:?}"
        );
        assert!(!next.animation_tick(100.0));
        assert_eq!(next.prepare_layers(&view(&cam)).bars.unwrap().to_vec(), to);
    }

    #[test]
    fn bar_race_is_opt_in_and_restarts_from_the_shown_frame() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut old = race(&[30.0, 20.0], &[1, 2], &mut cam, &mut scene);
        old.arm_animation(opts(), None);
        old.finish_animation();
        let snap = old.anim_snapshot().unwrap();
        let mut next = race(&[40.0, 25.0], &[2, 1], &mut cam, &mut scene);
        next.arm_animation(opts(), Some(snap.clone()));
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        let shown = next.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        // Re-rendered mid-race: the next race starts from the bars on screen
        let snap2 = next.anim_snapshot().unwrap();
        let mut third = race(&[40.0, 25.0], &[2, 1], &mut cam, &mut scene);
        third.arm_animation(opts(), Some(snap2));
        third.animation_tick(0.0);
        let start = third.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert!(
            start.iter().zip(&shown).all(|(a, b)| close(a.rect, b.rect)),
            "{start:?} vs {shown:?}"
        );

        // Without the race flag the same re-render tweens by index (existing behavior)
        let mut plain = race(&[40.0, 25.0], &[2, 1], &mut cam, &mut scene);
        assert!(plain.set_bar_race(false));
        let mut prev = race(&[30.0, 20.0], &[1, 2], &mut cam, &mut scene);
        assert!(prev.set_bar_race(false));
        prev.arm_animation(opts(), None);
        prev.finish_animation();
        let from = final_bars(&prev, &cam);
        prev.prepare_layers(&view(&cam)); // rendered once before the re-render (engine order)
        plain.arm_animation(opts(), Some(prev.anim_snapshot().unwrap()));
        let to = final_bars(&plain, &cam);
        plain.animation_tick(0.0);
        plain.animation_tick(50.0);
        let bars = plain.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        for g in 0..2 {
            assert!(
                close(bars[g].rect, mid(from[g].rect, to[g].rect)),
                "index tween {g}"
            );
        }
    }

    #[test]
    fn non_finite_race_values_leave_instead_of_poisoning_the_frame() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut old = race(&[30.0, 20.0], &[1, 2], &mut cam, &mut scene);
        old.arm_animation(opts(), None);
        old.finish_animation();
        let snap = old.anim_snapshot().unwrap();
        let mut next = race(&[25.0, f32::NAN], &[2, 1], &mut cam, &mut scene);
        next.arm_animation(opts(), Some(snap));
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        let bars = next.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert_eq!(bars.len(), 2, "key 2 tweens, key 1 (now NaN) leaves");
        assert!(bars
            .iter()
            .all(|b| b.rect.iter().chain(&b.color).all(|v| v.is_finite())));
    }

    fn line_chart(values: Vec<Vec<f32>>) -> ChartState {
        ChartState::new_line(
            values
                .into_iter()
                .map(|v| LineSeries {
                    values: v,
                    x: None,
                    color: [1.0; 4],
                    width_px: 2.0,
                })
                .collect(),
            LineLayout {
                width: 160.0,
                height: 80.0,
                view: ChartViewMode::Flat,
                x_kind: LineXKind::Numeric,
            },
        )
    }

    #[test]
    fn line_end_labels_sit_on_the_last_sample_and_follow_the_reveal_front() {
        let mut cam = flat_camera();
        let mut chart = line_chart(vec![
            (0..=100).map(|i| i as f32).collect(),
            (0..=100).map(|i| 100.0 - i as f32).collect(),
        ]);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        // Idle: the last sample of every series
        chart.prepare_layers(&view(&cam));
        let end = chart.line_end_labels(&view(&cam));
        assert_eq!(end.len(), 2);
        assert_eq!((end[0].series, end[0].value), (0, 100.0));
        assert_eq!((end[1].series, end[1].value), (1, 0.0));
        let plot = chart.axes().plot_css;
        assert!(
            (end[0].x_css - (plot[0] + plot[2])).abs() < 0.5,
            "{:?} vs {plot:?}",
            end[0]
        );
        assert!((end[0].y_css - plot[1]).abs() < 1.0);

        // Mid reveal: at the reveal front (half the plot), interpolated between samples
        let mut anim = chart.clone();
        anim.arm_animation(opts(), None);
        anim.animation_tick(0.0);
        anim.animation_tick(50.0);
        anim.prepare_layers(&view(&cam));
        let half = anim.line_end_labels(&view(&cam));
        assert_eq!(half.len(), 2);
        assert!((half[0].value - 50.0).abs() < 6.0, "{half:?}");
        assert!(
            (half[0].value + half[1].value - 100.0).abs() < 1e-3,
            "same front for both series"
        );
        assert!(half[0].x_css < end[0].x_css - 100.0 && half[0].x_css > plot[0]);
        assert!(half
            .iter()
            .all(|l| l.x_css.is_finite() && l.y_css.is_finite() && l.value.is_finite()));
        // Start: nothing revealed, no labels
        let mut start = chart.clone();
        start.arm_animation(opts(), None);
        start.animation_tick(0.0);
        start.prepare_layers(&view(&cam));
        assert!(start.line_end_labels(&view(&cam)).is_empty());
        // Hidden series and trailing gaps: the last finite sample of the visible series
        let mut gaps = line_chart(vec![vec![1.0, 2.0, 3.0, f32::NAN], vec![5.0, 6.0]]);
        gaps.frame_camera(&mut cam, (1600.0, 900.0));
        gaps.set_series_visible(1, false, &mut SceneWorld::new());
        gaps.prepare_layers(&view(&cam));
        let g = gaps.line_end_labels(&view(&cam));
        assert_eq!(g.len(), 1);
        assert_eq!((g[0].series, g[0].value), (0, 3.0));
    }
}
