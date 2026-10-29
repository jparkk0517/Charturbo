//! Chord diagram: groups on a ring, ribbons between them (d3-chord / ECharts `chord`).
//!
//! The layout is d3's `chord()` / `chordDirected()` in f64: group `i` spans
//! `sum_j m[i][j]` (+ `m[j][i]` when directed) at `k = max(0, tau - pad n) / total` radians per
//! unit, groups `padAngle` apart, angles clockwise from 12 o'clock; subgroups and chords follow
//! d3's order, comparators and the undirected source / target swap exactly. Legend-hidden groups
//! drop their row and column (no span, no pad) and sit as a point in the middle of their gap, so
//! a toggle tweens them in and out.
//!
//! Outer arcs reuse the pie tessellation (`tessellate_slice`); ribbons are d3 `ribbon()` shapes:
//! source arc, quadratic curve through the center, target arc, curve back (self chords skip the
//! target). Ribbons are triangulated as a strip between the two curves plus two arc caps and
//! colored by the source / target group, a source-to-target gradient or a neutral color.
//!
//! Hover: the ring hits groups by angle; inside the ribbon radius the ribbon outlines are tested
//! last-drawn first. A hovered (or legend-emphasized) group keeps its ribbons and partner groups
//! lit and dims the rest; a hovered ribbon keeps itself and its two groups. Item ids: series 0 =
//! group `i` (global id `i`), series 1 = ribbon `source * n + target` (global id `n + index`).
//!
//! Labels: one DOM anchor per visible group just outside the ring. `HierarchyLabel` fields:
//! `w_css` = text rotation (radians, CSS clockwise; 0 unless `label_rotate`), `h_css` = room
//! (CSS px), `flags` = 1 text grows right of the anchor, -1 left, 2 centered above, 3 centered
//! below. Overlapping labels thin out (largest groups win); labels wait for a tween to land.

use super::hierarchy::*;
use super::pie::{arc_segments, polar, tessellate_slice, PieScreen, SliceShape};
use super::*;
use std::f32::consts::{FRAC_PI_2, PI, TAU};
use std::f64::consts::TAU as TAU64;

/// World radius of the ring (the camera framing scales it to the plot).
pub(crate) const CHORD_RADIUS: f32 = 50.0;
/// Most groups (ribbons grow with the square).
pub const MAX_CHORD_GROUPS: usize = 256;
/// Surface gap between the ribbons and the ring (CSS px).
const RIBBON_GAP_PX: f32 = 2.0;
/// Arrow head length of directed ribbons (CSS px, d3 `ribbonArrow().headRadius()` default)
const ARROW_HEAD_PX: f32 = 10.0;
/// Labels sit this far outside the ring (CSS px).
const LABEL_OFFSET_PX: f32 = 6.0;
/// Hover / emphasis: lit ribbons gain this much alpha, unlit ones keep this share.
const LIT_ALPHA_GAIN: f32 = 0.25;
const UNLIT_ALPHA: f32 = 0.2;

/// d3 comparator: `None` keeps input order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChordSort {
    #[default]
    None,
    Ascending,
    Descending,
}

impl ChordSort {
    /// 0 = none, 1 = ascending, 2 = descending
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Ascending,
            2 => Self::Descending,
            _ => Self::None,
        }
    }

    fn cmp(self, a: f64, b: f64) -> Option<std::cmp::Ordering> {
        match self {
            Self::None => None,
            Self::Ascending => Some(a.total_cmp(&b)),
            Self::Descending => Some(b.total_cmp(&a)),
        }
    }
}

/// `sortGroups`, `sortSubgroups`, `sortChords` of d3-chord.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ChordSorts {
    pub groups: ChordSort,
    pub subgroups: ChordSort,
    pub chords: ChordSort,
}

/// Ribbon fill.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ChordRibbonColor {
    /// Color of the source group
    #[default]
    Source,
    Target,
    /// Source color at the source end to the target color at the target end
    Gradient,
    /// The neutral "other" color of the style
    Neutral,
}

impl ChordRibbonColor {
    /// 0 = source, 1 = target, 2 = gradient, 3 = neutral
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Target,
            2 => Self::Gradient,
            3 => Self::Neutral,
            _ => Self::Source,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChordOptions {
    /// Gap between groups (radians, d3 `padAngle`)
    pub pad_angle: f64,
    /// Compass angle of the layout's zero (radians clockwise from 12 o'clock)
    pub start_angle: f32,
    pub clockwise: bool,
    pub sorts: ChordSorts,
    /// d3 `chordDirected`: a group spans its outgoing and incoming flows
    pub directed: bool,
    pub ribbon_color: ChordRibbonColor,
    pub ribbon_opacity: f32,
    /// Ring thickness (CSS px)
    pub arc_width_px: f32,
    pub labels: bool,
    /// Labels run radially instead of horizontally
    pub label_rotate: bool,
    /// Room reserved for a label outside the ring (CSS px)
    pub label_room_px: f32,
    pub label_line_px: f32,
}

impl Default for ChordOptions {
    fn default() -> Self {
        Self {
            pad_angle: 3f64.to_radians(),
            start_angle: 0.0,
            clockwise: true,
            sorts: ChordSorts::default(),
            directed: false,
            ribbon_color: ChordRibbonColor::Source,
            ribbon_opacity: 0.6,
            arc_width_px: 14.0,
            labels: true,
            label_rotate: false,
            label_room_px: 72.0,
            label_line_px: 14.0,
        }
    }
}

/// One group's span (d3 angles: radians clockwise from the layout zero).
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ChordGroup {
    pub index: u32,
    pub start: f64,
    pub end: f64,
    /// Group sum (0 when hidden)
    pub value: f64,
}

/// One end of a chord: the span on group `index` and the flow it stands for.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct ChordEnd {
    pub index: u32,
    pub start: f64,
    pub end: f64,
    pub value: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Chord {
    pub source: ChordEnd,
    pub target: ChordEnd,
}

impl Chord {
    /// Ribbon index `source * n + target`.
    pub fn key(&self, n: usize) -> usize {
        self.source.index as usize * n + self.target.index as usize
    }
}

/// Groups by input index and chords in d3 order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ChordLayout {
    pub groups: Vec<ChordGroup>,
    pub chords: Vec<Chord>,
}

/// Square `n x n` matrix (row-major): finite, >= 0, not all zero.
pub fn validate_chord(matrix: &[f64], n: usize) -> Result<(), String> {
    if n == 0 {
        return Err("chord diagram needs at least one group".into());
    }
    if n > MAX_CHORD_GROUPS {
        return Err(format!(
            "chord diagram supports at most {MAX_CHORD_GROUPS} groups, got {n}"
        ));
    }
    if matrix.len() != n * n {
        return Err(format!(
            "chord matrix must be {n} x {n} ({} values), got {}",
            n * n,
            matrix.len()
        ));
    }
    if let Some(i) = matrix.iter().position(|v| !v.is_finite() || *v < 0.0) {
        return Err(format!(
            "chord matrix value [{}][{}] must be finite and >= 0, got {}",
            i / n,
            i % n,
            matrix[i]
        ));
    }
    if matrix.iter().all(|&v| v == 0.0) {
        return Err("chord matrix needs at least one value > 0".into());
    }
    Ok(())
}

/// d3 `chord()` (or `chordDirected()`) of a row-major `n x n` matrix; `shown[i] == false` drops
/// group `i` (see the module docs).
pub fn chord_layout(
    matrix: &[f64],
    n: usize,
    pad: f64,
    directed: bool,
    sorts: ChordSorts,
    shown: &[bool],
) -> ChordLayout {
    let vis = |i: usize| shown.get(i).copied().unwrap_or(true);
    let m = |i: usize, j: usize| {
        if vis(i) && vis(j) {
            matrix[i * n + j]
        } else {
            0.0
        }
    };
    let both = if directed { 1.0 } else { 0.0 };
    let sums: Vec<f64> = (0..n)
        .map(|i| (0..n).map(|j| m(i, j) + both * m(j, i)).sum())
        .collect();
    let count = (0..n).filter(|&i| vis(i)).count();
    let mut groups: Vec<ChordGroup> = (0..n)
        .map(|i| ChordGroup {
            index: i as u32,
            ..Default::default()
        })
        .collect();
    if count == 0 {
        return ChordLayout {
            groups,
            chords: Vec::new(),
        };
    }
    let total: f64 = sums.iter().sum();
    // d3: k = max(0, tau - pad n) / total, dx = k ? pad : tau / n (a zero total spaces the
    // empty groups evenly instead of dividing by zero)
    let k = if total > 0.0 {
        (TAU64 - pad * count as f64).max(0.0) / total
    } else {
        0.0
    };
    let dx = if k > 0.0 { pad } else { TAU64 / count as f64 };
    let mut order: Vec<usize> = (0..n).collect();
    if sorts.groups != ChordSort::None {
        order.sort_by(|&a, &b| sorts.groups.cmp(sums[a], sums[b]).unwrap());
    }
    // Ends per d3 slot (undirected: min * n + max, directed: source * n + target)
    let mut src: Vec<Option<ChordEnd>> = vec![None; n * n];
    let mut tgt: Vec<Option<ChordEnd>> = vec![None; n * n];
    let mut x = 0.0f64;
    for &i in &order {
        if !vis(i) {
            let at = x - 0.5 * dx;
            groups[i] = ChordGroup {
                index: i as u32,
                start: at,
                end: at,
                value: 0.0,
            };
            continue;
        }
        let x0 = x;
        let mut end = |v: f64| {
            let e = ChordEnd {
                index: i as u32,
                start: x,
                end: x + v * k,
                value: v,
            };
            x += v * k;
            e
        };
        if directed {
            // Negative j = incoming from !j (n - 1 down to 0), then outgoing to 0 .. n - 1
            let flow = |j: i64| {
                if j < 0 {
                    m(!j as usize, i)
                } else {
                    m(i, j as usize)
                }
            };
            let mut sub: Vec<i64> = (-(n as i64)..n as i64)
                .filter(|&j| flow(j) != 0.0)
                .collect();
            if sorts.subgroups != ChordSort::None {
                let signed = |j: i64| if j < 0 { -flow(j) } else { flow(j) };
                sub.sort_by(|&a, &b| sorts.subgroups.cmp(signed(a), signed(b)).unwrap());
            }
            for j in sub {
                if j < 0 {
                    tgt[(!j as usize) * n + i] = Some(end(flow(j)));
                } else {
                    src[i * n + j as usize] = Some(end(flow(j)));
                }
            }
        } else {
            let mut sub: Vec<usize> = (0..n)
                .filter(|&j| m(i, j) != 0.0 || m(j, i) != 0.0)
                .collect();
            if sorts.subgroups != ChordSort::None {
                sub.sort_by(|&a, &b| sorts.subgroups.cmp(m(i, a), m(i, b)).unwrap());
            }
            for j in sub {
                let e = end(m(i, j));
                let slot = i.min(j) * n + i.max(j);
                if i < j {
                    src[slot] = Some(e);
                } else {
                    tgt[slot] = Some(e);
                    if i == j {
                        src[slot] = Some(e);
                    }
                }
                // The larger flow is the source
                if let (Some(s), Some(t)) = (src[slot], tgt[slot]) {
                    if s.value < t.value {
                        src[slot] = Some(t);
                        tgt[slot] = Some(s);
                    }
                }
            }
        }
        groups[i] = ChordGroup {
            index: i as u32,
            start: x0,
            end: x,
            value: sums[i],
        };
        x += dx;
    }
    let mut chords: Vec<Chord> = src
        .into_iter()
        .zip(tgt)
        .filter_map(|(s, t)| {
            Some(Chord {
                source: s?,
                target: t?,
            })
        })
        .collect();
    if sorts.chords != ChordSort::None {
        let sum = |c: &Chord| c.source.value + c.target.value;
        chords.sort_by(|a, b| sorts.chords.cmp(sum(a), sum(b)).unwrap());
    }
    ChordLayout { groups, chords }
}

/// Angles of one drawn frame: group spans, every ribbon slot (`source * n + target`; absent
/// ribbons collapse to their groups' midpoints) and the draw order.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct AngleFrame {
    groups: Vec<(f64, f64)>,
    chords: Vec<[f64; 4]>,
    present: Vec<bool>,
    order: Vec<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Focus {
    None,
    Group(u32),
    Ribbon(u32),
}

#[derive(Debug, Clone)]
pub(crate) struct ChordChart {
    pub(crate) n: usize,
    matrix: Vec<f64>,
    pub(crate) opts: ChordOptions,
    style: HierarchyStyle,
    pub(crate) colors: Vec<[f32; 4]>,
    pub(crate) shown: Vec<bool>,
    pub(crate) layout: ChordLayout,
    emphasis: Option<usize>,
    /// Layout revision (bumps on every relayout)
    rev: u32,
    screen: Option<PieScreen>,
    /// Scale, focus and layout revision the staged buffers were built for
    built: Option<(f32, Focus, u32)>,
    /// Frame on screen (the staged layout or the last tween frame)
    drawn: Option<AngleFrame>,
    /// Legend toggle: the frame to tween from (dropped once the animation lands)
    pub(crate) tween_from: Option<AngleFrame>,
    pub(crate) labels: Vec<HierarchyLabel>,
    pub(crate) labels_revision: u32,
    labels_key: Option<([f32; 19], u32, bool)>,
}

impl ChordChart {
    /// `matrix` must pass `validate_chord`.
    pub(crate) fn new(
        matrix: &[f64],
        n: usize,
        mut opts: ChordOptions,
        style: HierarchyStyle,
    ) -> Self {
        let d = ChordOptions::default();
        if !opts.pad_angle.is_finite() || opts.pad_angle < 0.0 {
            opts.pad_angle = d.pad_angle;
        }
        if !opts.start_angle.is_finite() {
            opts.start_angle = 0.0;
        }
        opts.ribbon_opacity = if opts.ribbon_opacity.is_finite() {
            opts.ribbon_opacity.clamp(0.0, 1.0)
        } else {
            d.ribbon_opacity
        };
        if !opts.arc_width_px.is_finite() || opts.arc_width_px < 1.0 {
            opts.arc_width_px = d.arc_width_px;
        }
        if !opts.label_room_px.is_finite() || opts.label_room_px < 0.0 {
            opts.label_room_px = d.label_room_px;
        }
        if !opts.label_line_px.is_finite() || opts.label_line_px < 1.0 {
            opts.label_line_px = d.label_line_px;
        }
        let mut c = Self {
            n,
            matrix: matrix.to_vec(),
            opts,
            style,
            colors: Vec::new(),
            shown: vec![true; n],
            layout: ChordLayout::default(),
            emphasis: None,
            rev: 0,
            screen: None,
            built: None,
            drawn: None,
            tween_from: None,
            labels: Vec::new(),
            labels_revision: 0,
            labels_key: None,
        };
        c.assign_colors();
        c.relayout();
        c
    }

    fn assign_colors(&mut self) {
        let pal = &self.style.palette;
        self.colors = (0..self.n)
            .map(|i| {
                let auto = if pal.is_empty() {
                    self.style.other_color
                } else {
                    pal[i % pal.len()]
                };
                self.style.colors.get(i).copied().flatten().unwrap_or(auto)
            })
            .collect();
        self.built = None;
    }

    fn relayout(&mut self) {
        let o = &self.opts;
        self.layout = chord_layout(
            &self.matrix,
            self.n,
            o.pad_angle,
            o.directed,
            o.sorts,
            &self.shown,
        );
        self.rev = self.rev.wrapping_add(1);
        self.built = None;
    }

    pub(crate) fn set_style(&mut self, style: HierarchyStyle) {
        self.style = style;
        self.assign_colors();
    }

    pub(crate) fn set_emphasis(&mut self, series: Option<usize>) -> bool {
        let series = series.filter(|&g| g < self.n && self.shown[g]);
        let changed = self.emphasis != series;
        if changed {
            self.emphasis = series;
            self.built = None;
        }
        changed
    }

    /// Legend toggle: re-lays out without the hidden groups and keeps the frame on screen to
    /// tween from. Returns false when unchanged.
    pub(crate) fn set_visible(&mut self, group: usize, visible: bool) -> bool {
        if group >= self.n || self.shown[group] == visible {
            return false;
        }
        let from = self.drawn.take().unwrap_or_else(|| self.frame_of());
        self.shown[group] = visible;
        if !visible && self.emphasis == Some(group) {
            self.emphasis = None;
        }
        self.relayout();
        self.tween_from = Some(from);
        true
    }

    /// Compass angle of a layout angle.
    fn compass(&self, a: f64) -> f32 {
        let a = a as f32;
        if self.opts.clockwise {
            self.opts.start_angle + a
        } else {
            self.opts.start_angle - a
        }
    }

    /// Ring inner radius and ribbon radius (world) at `wpp` world units per CSS px.
    fn radii(&self, wpp: f32) -> (f32, f32) {
        let r_in = CHORD_RADIUS - (self.opts.arc_width_px * wpp).min(0.5 * CHORD_RADIUS);
        (r_in, (r_in - RIBBON_GAP_PX * wpp).max(0.0))
    }

    fn frame_of(&self) -> AngleFrame {
        let n = self.n;
        let groups: Vec<(f64, f64)> = self
            .layout
            .groups
            .iter()
            .map(|g| (g.start, g.end))
            .collect();
        let mid = |g: usize| 0.5 * (groups[g].0 + groups[g].1);
        let mut chords: Vec<[f64; 4]> = (0..n * n)
            .map(|key| {
                let (s, t) = (mid(key / n), mid(key % n));
                [s, s, t, t]
            })
            .collect();
        let mut present = vec![false; n * n];
        let mut order = Vec::with_capacity(self.layout.chords.len());
        for c in &self.layout.chords {
            let key = c.key(n);
            chords[key] = [c.source.start, c.source.end, c.target.start, c.target.end];
            present[key] = true;
            order.push(key as u32);
        }
        AngleFrame {
            groups,
            chords,
            present,
            order,
        }
    }

    fn focus(&self, hovered: Option<(u32, u32)>) -> Focus {
        match hovered {
            Some((0, g)) => Focus::Group(g),
            Some((1, k)) => Focus::Ribbon(k),
            _ => self
                .emphasis
                .map_or(Focus::None, |g| Focus::Group(g as u32)),
        }
    }

    /// Fills (ring arcs, then unlit and lit ribbons) and arc outlines of `frame`.
    fn build(
        &self,
        frame: &AngleFrame,
        wpp: f32,
        focus: Focus,
        fills: &mut Vec<ChartFillRaw>,
        edges: &mut Vec<ChartSegmentRaw>,
    ) {
        fills.clear();
        edges.clear();
        let n = self.n;
        let (r_in, r_rib) = self.radii(wpp);
        let lit = self.lit_groups(frame, focus);
        for (g, &(a0, a1)) in frame.groups.iter().enumerate() {
            if a1 <= a0 {
                continue;
            }
            let (p, q) = (self.compass(a0), self.compass(a1));
            let shape = SliceShape {
                lo: p.min(q),
                hi: p.max(q),
                r_out: CHORD_RADIUS,
                r_in,
                full: false,
                corner: 0.0,
            };
            let color = match &lit {
                Some(l) if !l[g] => mix(self.colors[g], self.style.surface, EMPHASIS_FADE),
                _ => self.colors[g],
            };
            tessellate_slice(&shape, wpp, (0.0, 0.0), color, fills, edges);
        }
        // Lit ribbons last (on top)
        for pass in [false, true] {
            for &key in &frame.order {
                let key = key as usize;
                let on = ribbon_lit(focus, key, n);
                if on != pass {
                    continue;
                }
                let (s, t) = (key / n, key % n);
                let o = self.opts.ribbon_opacity;
                let alpha = match focus {
                    Focus::None => o,
                    _ if on => (o + LIT_ALPHA_GAIN).min(1.0),
                    _ => o * UNLIT_ALPHA,
                };
                let (cs, ct) = match self.opts.ribbon_color {
                    ChordRibbonColor::Source => (self.colors[s], self.colors[s]),
                    ChordRibbonColor::Target => (self.colors[t], self.colors[t]),
                    ChordRibbonColor::Gradient => (self.colors[s], self.colors[t]),
                    ChordRibbonColor::Neutral => (self.style.other_color, self.style.other_color),
                };
                let (cs, ct) = ([cs[0], cs[1], cs[2], alpha], [ct[0], ct[1], ct[2], alpha]);
                let r = self.ribbon(frame.chords[key], r_rib, wpp);
                r.triangulate(cs, ct, fills);
            }
        }
    }

    /// Groups kept at full color under `focus` (`None` = no focus: all of them).
    fn lit_groups(&self, frame: &AngleFrame, focus: Focus) -> Option<Vec<bool>> {
        let n = self.n;
        let mut lit = vec![false; n];
        match focus {
            Focus::None => return None,
            Focus::Group(g) => {
                if let Some(v) = lit.get_mut(g as usize) {
                    *v = true;
                }
                for &key in &frame.order {
                    let (s, t) = (key as usize / n, key as usize % n);
                    if s == g as usize || t == g as usize {
                        lit[s] = true;
                        lit[t] = true;
                    }
                }
            }
            Focus::Ribbon(k) if (k as usize) < n * n => {
                lit[k as usize / n] = true;
                lit[k as usize % n] = true;
            }
            Focus::Ribbon(_) => {}
        }
        Some(lit)
    }

    /// d3 `ribbon()` of layout angles `[s0, s1, t0, t1]` at world radius `r`.
    fn ribbon(&self, a: [f64; 4], r: f32, wpp: f32) -> Ribbon {
        let r_px = r / wpp.max(1e-6);
        let p = |x: f64| polar((0.0, 0.0), self.compass(x), r);
        let arc = |a0: f64, a1: f64| -> Vec<(f32, f32)> {
            let span = (self.compass(a1) - self.compass(a0)).abs();
            let k = arc_segments(span, r_px);
            if k == 0 {
                return vec![p(a0)];
            }
            (0..=k)
                .map(|i| p(a0 + (a1 - a0) * i as f64 / k as f64))
                .collect()
        };
        // Quadratic curves through the center: Q(u) = (1 - u)^2 P0 + u^2 P2
        let m = ((r_px / 6.0).ceil() as usize).clamp(8, 48) & !1;
        let curve = |p0: (f32, f32), p2: (f32, f32)| -> Vec<(f32, f32)> {
            (0..=m)
                .map(|i| {
                    let u = i as f32 / m as f32;
                    let (w0, w2) = ((1.0 - u) * (1.0 - u), u * u);
                    (w0 * p0.0 + w2 * p2.0, w0 * p0.1 + w2 * p2.1)
                })
                .collect()
        };
        let source = arc(a[0], a[1]);
        // d3 draws the target and the second curve only when the ends differ
        if a[0] == a[2] && a[1] == a[3] {
            return Ribbon {
                left: curve(p(a[1]), p(a[0])),
                right: Vec::new(),
                source,
                target: Vec::new(),
            };
        }
        if self.opts.directed {
            // d3 `ribbonArrow()`: the curves stop `head` short of the ring and a triangle tip
            // reaches it at the target's mid angle
            let rt = (r - ARROW_HEAD_PX * wpp).max(0.0);
            let q = |x: f64| polar((0.0, 0.0), self.compass(x), rt);
            let (t0, t1) = (q(a[2]), q(a[3]));
            return Ribbon {
                left: curve(p(a[1]), t0),
                right: curve(p(a[0]), t1),
                source,
                target: vec![t0, p(0.5 * (a[2] + a[3])), t1],
            };
        }
        Ribbon {
            left: curve(p(a[1]), p(a[2])),
            right: curve(p(a[0]), p(a[3])),
            source,
            target: arc(a[2], a[3]),
        }
    }

    /// Item `(series, index)` under world point `(x, y)`.
    fn item_at(&self, x: f32, y: f32, wpp: f32) -> Option<(u32, u32)> {
        let r = x.hypot(y);
        if r > CHORD_RADIUS {
            return None;
        }
        let (_, r_rib) = self.radii(wpp);
        if r >= r_rib {
            let phi = x.atan2(y) - self.opts.start_angle;
            let a = (if self.opts.clockwise { phi } else { -phi }).rem_euclid(TAU) as f64;
            return self
                .layout
                .groups
                .iter()
                .find(|g| {
                    g.end > g.start
                        && [a, a - TAU64, a + TAU64]
                            .iter()
                            .any(|&a| a >= g.start && a < g.end)
                })
                .map(|g| (0, g.index));
        }
        self.layout.chords.iter().rev().find_map(|c| {
            let a = [c.source.start, c.source.end, c.target.start, c.target.end];
            self.ribbon(a, r_rib, wpp)
                .contains((x, y))
                .then(|| (1, c.key(self.n) as u32))
        })
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let p = ray_hit_z_plane(&view.camera.screen_to_ray(ndc.0, ndc.1), 0.0)?;
        let wpp = screen_of(view)?.wpp;
        let (series, index) = self.item_at(p.x, p.y, wpp)?;
        let (value, id) = self.item(series, index)?;
        Some(hover_one(series, index, value, id))
    }

    /// Value and global id of item `(series, index)` (hidden groups / absent ribbons: none).
    pub(crate) fn item(&self, series: u32, index: u32) -> Option<(f64, u32)> {
        let i = index as usize;
        match series {
            0 if i < self.n && self.shown[i] => Some((self.layout.groups[i].value, index)),
            1 => {
                let c = self.layout.chords.iter().find(|c| c.key(self.n) == i)?;
                Some((c.source.value, (self.n + i) as u32))
            }
            _ => None,
        }
    }

    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let wpp = self.screen.map_or(0.0, |s| s.wpp);
        let (r_in, r_rib) = self.radii(wpp);
        let id = global_id as usize;
        if id < self.n {
            let (value, _) = self.item(0, global_id)?;
            let g = self.layout.groups[id];
            let p = polar(
                (0.0, 0.0),
                self.compass(0.5 * (g.start + g.end)),
                0.5 * (CHORD_RADIUS + r_in),
            );
            return Some((0, global_id, value as f32, Vec3::new(p.0, p.1, 0.0)));
        }
        let key = (id - self.n) as u32;
        let (value, _) = self.item(1, key)?;
        let c = self
            .layout
            .chords
            .iter()
            .find(|c| c.key(self.n) == key as usize)?;
        let s = polar(
            (0.0, 0.0),
            self.compass(0.5 * (c.source.start + c.source.end)),
            r_rib,
        );
        let t = polar(
            (0.0, 0.0),
            self.compass(0.5 * (c.target.start + c.target.end)),
            r_rib,
        );
        Some((
            1,
            key,
            value as f32,
            Vec3::new(0.25 * (s.0 + t.0), 0.25 * (s.1 + t.1), 0.0),
        ))
    }

    fn layout_labels(&mut self, screen: PieScreen, hide: bool) -> bool {
        let mut labels: Vec<HierarchyLabel> = Vec::new();
        if self.opts.labels && !hide {
            let (line, room) = (self.opts.label_line_px, self.opts.label_room_px);
            let r = screen.r_css + LABEL_OFFSET_PX;
            let (cx, cy) = screen.center_css;
            let mut cands: Vec<(f64, f32, HierarchyLabel)> = Vec::new();
            for g in &self.layout.groups {
                if g.end <= g.start || !self.shown[g.index as usize] {
                    continue;
                }
                let phi = self.compass(0.5 * (g.start + g.end));
                let (s, c) = phi.sin_cos();
                let (x_css, y_css) = (cx + r * s, cy - r * c);
                let (rot, flags) = if self.opts.label_rotate {
                    // Radial text reading left to right: flipped on the left half
                    let (rot, flags) = if s < 0.0 {
                        (phi + FRAC_PI_2, -1)
                    } else {
                        (phi - FRAC_PI_2, 1)
                    };
                    (rot - TAU * ((rot + PI) / TAU).floor(), flags)
                } else if s.abs() < 0.2 {
                    (0.0, if c > 0.0 { 2 } else { 3 })
                } else {
                    (0.0, if s > 0.0 { 1 } else { -1 })
                };
                cands.push((
                    g.value,
                    phi,
                    HierarchyLabel {
                        node: g.index,
                        x_css,
                        y_css,
                        w_css: rot,
                        h_css: room,
                        flags,
                    },
                ));
            }
            // Largest groups keep their label where neighbours would overlap
            cands.sort_by(|a, b| b.0.total_cmp(&a.0));
            let mut kept: Vec<(f32, HierarchyLabel)> = Vec::new();
            for (_, phi, l) in cands {
                let clash = kept.iter().any(|(q, k)| {
                    if self.opts.label_rotate {
                        let d = (phi - q).rem_euclid(TAU);
                        d.min(TAU - d) * r < line
                    } else {
                        (l.y_css - k.y_css).abs() < line && (l.x_css - k.x_css).abs() < room
                    }
                });
                if !clash {
                    kept.push((phi, l));
                }
            }
            labels = kept.into_iter().map(|(_, l)| l).collect();
            labels.sort_by_key(|l| l.node);
        }
        let changed = labels != self.labels;
        if changed {
            self.labels = labels;
            self.labels_revision = self.labels_revision.wrapping_add(1);
        }
        changed
    }

    pub(crate) fn layout_info(&self) -> HierarchyLayoutInfo {
        let (c, r) = self
            .screen
            .map_or(((0.0, 0.0), 0.0), |s| (s.center_css, s.r_css));
        HierarchyLayoutInfo {
            root: 0,
            plot_css: [c.0 - r, c.1 - r, 2.0 * r, 2.0 * r],
            center_css: c,
            center_r_css: r,
            hovered: None,
        }
    }

    pub(crate) fn plot_css(&self, view: &ChartView) -> [f32; 4] {
        match screen_of(view) {
            Some(s) => [
                s.center_css.0 - s.r_css,
                s.center_css.1 - s.r_css,
                2.0 * s.r_css,
                2.0 * s.r_css,
            ],
            None => [0.0; 4],
        }
    }

    /// Label room outside the ring (CSS px, horizontal and vertical).
    fn label_room(&self) -> (f32, f32) {
        if !self.opts.labels {
            return (0.0, 0.0);
        }
        let room = self.opts.label_room_px + LABEL_OFFSET_PX;
        if self.opts.label_rotate {
            (room, room)
        } else {
            (room, self.opts.label_line_px + LABEL_OFFSET_PX)
        }
    }

    pub(crate) fn frame_camera(
        &self,
        camera: &mut OrbitCamera,
        css: (f32, f32),
        padding: &ChartPadding,
    ) {
        let m = 4.0;
        let (rx, ry) = self.label_room();
        let pad = [
            padding[0] + m + ry,
            padding[1] + m + rx,
            padding[2] + m + ry,
            padding[3] + m + rx,
        ];
        frame_flat(camera, css, 2.0 * CHORD_RADIUS, 2.0 * CHORD_RADIUS, &pad);
    }

    /// Scale of the staged buffers (a tween builds at the same scale).
    pub(crate) fn tween_build(
        &mut self,
        e: f32,
        fills: &mut Vec<ChartFillRaw>,
        edges: &mut Vec<ChartSegmentRaw>,
    ) -> bool {
        let (Some(from), Some((wpp, focus, _))) = (&self.tween_from, self.built) else {
            return false;
        };
        let frame = lerp_frames(from, &self.frame_of(), e.clamp(0.0, 1.0) as f64);
        self.build(&frame, wpp, focus, fills, edges);
        self.drawn = Some(frame);
        true
    }

    #[allow(clippy::too_many_arguments)]
    pub(crate) fn prepare(
        &mut self,
        view: &ChartView,
        _padding: &ChartPadding,
        hovered: Option<(u32, u32)>,
        force: bool,
        animating: bool,
        out: HierFrame,
    ) -> HierChanged {
        let mut changed = HierChanged::default();
        let Some(screen) = screen_of(view) else {
            return changed;
        };
        self.screen = Some(screen);
        if !animating {
            self.tween_from = None;
        }
        let focus = self.focus(hovered);
        let stale = match self.built {
            Some((wpp, f, rev)) => {
                f != focus || rev != self.rev || ((wpp - screen.wpp) / screen.wpp).abs() > 1e-4
            }
            None => true,
        };
        if stale || force {
            let frame = self.frame_of();
            self.build(&frame, screen.wpp, focus, out.fills, out.edges);
            self.drawn = Some(frame);
            self.built = Some((screen.wpp, focus, self.rev));
            changed.fills = true;
        }
        let tweening = self.tween_from.is_some();
        let key = (view.key(), self.rev, tweening);
        if self.labels_key != Some(key) {
            changed.overlay |= self.layout_labels(screen, tweening);
            self.labels_key = Some(key);
        }
        if !out.overlay.is_empty() {
            out.overlay.clear();
            changed.overlay = true;
        }
        changed
    }
}

/// Ribbon `key` is lit under `focus`.
fn ribbon_lit(focus: Focus, key: usize, n: usize) -> bool {
    match focus {
        Focus::None => false,
        Focus::Group(g) => key / n == g as usize || key % n == g as usize,
        Focus::Ribbon(k) => key == k as usize,
    }
}

/// d3 ribbon outline pieces (world): source arc `s0 -> s1`, curve `s1 -> t0` (`left`), target
/// arc `t0 -> t1`, curve `s0 -> t1` (`right`, drawn back to `s0`). Self chords: one arc and the
/// curve `s1 -> s0` in `left`.
struct Ribbon {
    source: Vec<(f32, f32)>,
    target: Vec<(f32, f32)>,
    left: Vec<(f32, f32)>,
    right: Vec<(f32, f32)>,
}

impl Ribbon {
    /// Strip between the curves plus the convex arc caps (fans from their first point); colors
    /// run from `cs` at the source end to `ct` at the target end.
    fn triangulate(&self, cs: [f32; 4], ct: [f32; 4], fills: &mut Vec<ChartFillRaw>) {
        let vtx = |p: (f32, f32), color: [f32; 4]| ChartFillRaw {
            position: [p.0, p.1, 0.0, 0.0],
            color,
        };
        let fan = |arc: &[(f32, f32)], color: [f32; 4], fills: &mut Vec<ChartFillRaw>| {
            for w in arc.windows(2).skip(1) {
                fills.extend([vtx(arc[0], color), vtx(w[0], color), vtx(w[1], color)]);
            }
        };
        fan(&self.source, cs, fills);
        let m = self.left.len().saturating_sub(1);
        if self.right.is_empty() {
            // Self chord: the curve folds onto itself at its apex
            for i in 0..m / 2 {
                let (a0, a1, b0, b1) = (
                    self.left[i],
                    self.left[i + 1],
                    self.left[m - i],
                    self.left[m - i - 1],
                );
                fills.extend([
                    vtx(a0, cs),
                    vtx(b0, cs),
                    vtx(b1, cs),
                    vtx(a0, cs),
                    vtx(b1, cs),
                    vtx(a1, cs),
                ]);
            }
            return;
        }
        fan(&self.target, ct, fills);
        let at = |u: f32| lerp4(cs, ct, u);
        for i in 0..m {
            let (c0, c1) = (at(i as f32 / m as f32), at((i + 1) as f32 / m as f32));
            let (l0, l1, r0, r1) = (
                self.left[i],
                self.left[i + 1],
                self.right[i],
                self.right[i + 1],
            );
            fills.extend([
                vtx(l0, c0),
                vtx(r0, c0),
                vtx(r1, c1),
                vtx(l0, c0),
                vtx(r1, c1),
                vtx(l1, c1),
            ]);
        }
    }

    /// Closed outline (even-odd point test).
    fn contains(&self, p: (f32, f32)) -> bool {
        let m = self.left.len().saturating_sub(1);
        let mut poly: Vec<(f32, f32)> = self.source.clone();
        poly.extend_from_slice(&self.left[1.min(m)..m]);
        if !self.right.is_empty() {
            poly.extend_from_slice(&self.target);
            poly.extend(self.right[1..m].iter().rev());
        }
        let mut inside = false;
        let mut j = poly.len().saturating_sub(1);
        for i in 0..poly.len() {
            let (a, b) = (poly[i], poly[j]);
            if (a.1 > p.1) != (b.1 > p.1) && p.0 < a.0 + (p.1 - a.1) * (b.0 - a.0) / (b.1 - a.1) {
                inside = !inside;
            }
            j = i;
        }
        inside
    }
}

fn lerp4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
        a[3] + (b[3] - a[3]) * t,
    ]
}

/// Frame between `a` and `b` at `e`: ribbons of either frame (absent ones grow from / shrink
/// to their groups' midpoints), drawn in `b`'s order then `a`'s leftovers.
fn lerp_frames(a: &AngleFrame, b: &AngleFrame, e: f64) -> AngleFrame {
    let l = |x: f64, y: f64| x + (y - x) * e;
    let groups = a
        .groups
        .iter()
        .zip(&b.groups)
        .map(|(p, q)| (l(p.0, q.0), l(p.1, q.1)))
        .collect();
    let chords = a
        .chords
        .iter()
        .zip(&b.chords)
        .map(|(p, q)| std::array::from_fn(|i| l(p[i], q[i])))
        .collect();
    let present: Vec<bool> = a
        .present
        .iter()
        .zip(&b.present)
        .map(|(p, q)| *p || *q)
        .collect();
    let mut order = b.order.clone();
    order.extend(a.order.iter().filter(|&&k| !b.present[k as usize]));
    AngleFrame {
        groups,
        chords,
        present,
        order,
    }
}

/// Center / radius of the ring on screen (same mapping as the pie).
fn screen_of(view: &ChartView) -> Option<PieScreen> {
    let c = view.project_css(Vec3::ZERO)?;
    let e = view.project_css(Vec3::new(CHORD_RADIUS, 0.0, 0.0))?;
    let r = (e.0 - c.0).hypot(e.1 - c.1);
    (r > 1e-3).then_some(PieScreen {
        center_css: c,
        r_css: r,
        wpp: CHORD_RADIUS / r,
    })
}

impl ChartState {
    /// Creates a chord diagram from a row-major `n x n` matrix (see `validate_chord`).
    pub fn new_chord(
        matrix: &[f64],
        n: usize,
        opts: ChordOptions,
        style: HierarchyStyle,
    ) -> Result<Self, String> {
        validate_chord(matrix, n)?;
        Ok(Self::with_kind(ChartKind::Hierarchy(HierChart::Chord(
            ChordChart::new(matrix, n, opts, style),
        ))))
    }

    /// Layout and visibility of a chord diagram.
    pub fn chord_layout(&self) -> Option<(&ChordLayout, &[bool])> {
        match &self.kind {
            ChartKind::Hierarchy(HierChart::Chord(c)) => Some((&c.layout, &c.shown)),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: f64 = TAU64;
    /// Rows: 0 -> [0, 4, 1], 1 -> [2, 0, 2], 2 -> [3, 0, 0] (row / column sums 5 4 3 / 5 4 3)
    const M: [f64; 9] = [0.0, 4.0, 1.0, 2.0, 0.0, 2.0, 3.0, 0.0, 0.0];

    fn lay(pad: f64, directed: bool, sorts: ChordSorts) -> ChordLayout {
        chord_layout(&M, 3, pad, directed, sorts, &[true; 3])
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    /// Expected `(index, start, end, value)` of groups and `[source, target]` ends, angles
    /// already in radians.
    type End = (u32, f64, f64, f64);

    fn assert_layout(l: &ChordLayout, groups: &[(f64, f64)], chords: &[(End, End)]) {
        assert_eq!(l.groups.len(), groups.len());
        for (i, (g, &(a, b))) in l.groups.iter().zip(groups).enumerate() {
            assert!(
                g.index as usize == i && close(g.start, a) && close(g.end, b),
                "group {i}: {g:?} vs {a} {b}"
            );
        }
        assert_eq!(l.chords.len(), chords.len(), "{:?}", l.chords);
        let same = |e: &ChordEnd, x: &End| {
            e.index == x.0 && close(e.start, x.1) && close(e.end, x.2) && close(e.value, x.3)
        };
        for (k, (c, (s, t))) in l.chords.iter().zip(chords).enumerate() {
            assert!(
                same(&c.source, s) && same(&c.target, t),
                "chord {k}: {c:?} vs {s:?} {t:?}"
            );
        }
    }

    #[test]
    fn layout_matches_d3_chord() {
        // Hand-run of d3-chord `chord()(M)`, pad 0: k = tau / 12 per unit. Group 0 lays its
        // subgroups 1 [0, 4], 2 [4, 5]; group 1: 0 [5, 7], 2 [7, 9]; group 2: 0 [9, 12] (beats
        // 0 -> 2 = 1, so it becomes the source), 1 [12, 12] (zero-width end of 1 -> 2)
        let k = T / 12.0;
        let u = |a: f64| a * k;
        assert_layout(
            &lay(0.0, false, ChordSorts::default()),
            &[(0.0, u(5.0)), (u(5.0), u(9.0)), (u(9.0), u(12.0))],
            &[
                ((0, 0.0, u(4.0), 4.0), (1, u(5.0), u(7.0), 2.0)),
                ((2, u(9.0), u(12.0), 3.0), (0, u(4.0), u(5.0), 1.0)),
                ((1, u(7.0), u(9.0), 2.0), (2, u(12.0), u(12.0), 0.0)),
            ],
        );
        // padAngle 0.3: k = (tau - 0.9) / 12, group g shifts by 0.3 g
        let k = (T - 0.9) / 12.0;
        let a = |x: f64, g: u32| x * k + 0.3 * g as f64;
        assert_layout(
            &lay(0.3, false, ChordSorts::default()),
            &[
                (0.0, a(5.0, 0)),
                (a(5.0, 1), a(9.0, 1)),
                (a(9.0, 2), a(12.0, 2)),
            ],
            &[
                ((0, 0.0, a(4.0, 0), 4.0), (1, a(5.0, 1), a(7.0, 1), 2.0)),
                (
                    (2, a(9.0, 2), a(12.0, 2), 3.0),
                    (0, a(4.0, 0), a(5.0, 0), 1.0),
                ),
                (
                    (1, a(7.0, 1), a(9.0, 1), 2.0),
                    (2, a(12.0, 2), a(12.0, 2), 0.0),
                ),
            ],
        );
        assert!(close(
            lay(0.3, false, ChordSorts::default()).groups[2].end,
            T - 0.3
        ));
        // Pad eats the circle: k = 0, groups tau / n apart with no extent (d3 `dx = tau / n`)
        let l = lay(3.0, false, ChordSorts::default());
        assert!(l
            .groups
            .iter()
            .enumerate()
            .all(|(i, g)| close(g.start, T / 3.0 * i as f64) && g.start == g.end));
    }

    #[test]
    fn layout_follows_d3_sort_options() {
        let k = T / 12.0;
        let u = |a: f64| a * k;
        // sortGroups(ascending): sums 3 4 5 lay out as 2, 1, 0
        let sorts = ChordSorts {
            groups: ChordSort::Ascending,
            ..Default::default()
        };
        assert_layout(
            &lay(0.0, false, sorts),
            &[(u(7.0), u(12.0)), (u(3.0), u(7.0)), (0.0, u(3.0))],
            &[
                ((0, u(7.0), u(11.0), 4.0), (1, u(3.0), u(5.0), 2.0)),
                ((2, 0.0, u(3.0), 3.0), (0, u(11.0), u(12.0), 1.0)),
                ((1, u(5.0), u(7.0), 2.0), (2, u(3.0), u(3.0), 0.0)),
            ],
        );
        // sortSubgroups(ascending) by m[i][j]: group 0 lays 2 (1) before 1 (4); group 2 lays
        // 1 (0) before 0 (3); group 1's tie keeps input order
        let sorts = ChordSorts {
            subgroups: ChordSort::Ascending,
            ..Default::default()
        };
        assert_layout(
            &lay(0.0, false, sorts),
            &[(0.0, u(5.0)), (u(5.0), u(9.0)), (u(9.0), u(12.0))],
            &[
                ((0, u(1.0), u(5.0), 4.0), (1, u(5.0), u(7.0), 2.0)),
                ((2, u(9.0), u(12.0), 3.0), (0, 0.0, u(1.0), 1.0)),
                ((1, u(7.0), u(9.0), 2.0), (2, u(9.0), u(9.0), 0.0)),
            ],
        );
        // sortChords(ascending) by source + target value: 2 (1 -> 2), 4 (2 -> 0), 6 (0 -> 1)
        let sorts = ChordSorts {
            chords: ChordSort::Ascending,
            ..Default::default()
        };
        let order: Vec<u32> = lay(0.0, false, sorts)
            .chords
            .iter()
            .map(|c| c.source.index)
            .collect();
        assert_eq!(order, vec![1, 2, 0]);
        let sorts = ChordSorts {
            chords: ChordSort::Descending,
            ..Default::default()
        };
        let order: Vec<u32> = lay(0.0, false, sorts)
            .chords
            .iter()
            .map(|c| c.source.index)
            .collect();
        assert_eq!(order, vec![0, 2, 1]);
    }

    #[test]
    fn directed_layout_matches_d3_chord_directed() {
        // chordDirected: sums = row + column = 10 8 6, k = tau / 24. Each group lays incoming
        // flows (from n - 1 down to 0) then outgoing ones (0 up to n - 1)
        let k = T / 24.0;
        let u = |a: f64| a * k;
        assert_layout(
            &lay(0.0, true, ChordSorts::default()),
            &[(0.0, u(10.0)), (u(10.0), u(18.0)), (u(18.0), u(24.0))],
            &[
                ((0, u(5.0), u(9.0), 4.0), (1, u(10.0), u(14.0), 4.0)),
                ((0, u(9.0), u(10.0), 1.0), (2, u(20.0), u(21.0), 1.0)),
                ((1, u(14.0), u(16.0), 2.0), (0, u(3.0), u(5.0), 2.0)),
                ((1, u(16.0), u(18.0), 2.0), (2, u(18.0), u(20.0), 2.0)),
                ((2, u(21.0), u(24.0), 3.0), (0, 0.0, u(3.0), 3.0)),
            ],
        );
    }

    #[test]
    fn hidden_groups_drop_out_and_park_in_their_gap() {
        // Group 2 hidden: rows / columns zeroed, two groups share tau - 2 pad
        let l = chord_layout(
            &M,
            3,
            0.3,
            false,
            ChordSorts::default(),
            &[true, true, false],
        );
        let k = (T - 0.6) / 6.0;
        assert_layout(
            &l,
            &[
                (0.0, 4.0 * k),
                (4.0 * k + 0.3, 6.0 * k + 0.3),
                (T - 0.15, T - 0.15),
            ],
            &[(
                (0, 0.0, 4.0 * k, 4.0),
                (1, 4.0 * k + 0.3, 6.0 * k + 0.3, 2.0),
            )],
        );
        assert_eq!(l.groups[2].value, 0.0);
        // Nothing visible: no NaN
        let l = chord_layout(&M, 3, 0.3, false, ChordSorts::default(), &[false; 3]);
        assert!(l.chords.is_empty() && l.groups.iter().all(|g| g.start.is_finite()));
    }

    #[test]
    fn validation_rejects_bad_matrices() {
        assert!(validate_chord(&M, 3).is_ok());
        assert!(validate_chord(&M, 2).is_err(), "not square");
        assert!(validate_chord(&[], 0).is_err());
        assert!(validate_chord(&[1.0, -1.0, 0.0, 0.0], 2).is_err());
        assert!(validate_chord(&[1.0, f64::NAN, 0.0, 0.0], 2).is_err());
        assert!(validate_chord(&[0.0; 4], 2).is_err(), "all zero");
        assert!(ChartState::new_chord(
            &[0.0; 4],
            2,
            ChordOptions::default(),
            HierarchyStyle::default()
        )
        .is_err());
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn chart(opts: ChordOptions) -> (ChartState, OrbitCamera) {
        let chart = ChartState::new_chord(&M, 3, opts, HierarchyStyle::default()).unwrap();
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(chart: &ChartState) -> &ChordChart {
        match &chart.kind {
            ChartKind::Hierarchy(HierChart::Chord(c)) => c,
            _ => unreachable!(),
        }
    }

    fn ndc_polar(cam: &OrbitCamera, phi: f32, r: f32) -> (f32, f32) {
        let n = cam
            .project_to_ndc(Vec3::new(r * phi.sin(), r * phi.cos(), 0.0))
            .unwrap();
        (n.x, n.y)
    }

    fn pad0() -> ChordOptions {
        ChordOptions {
            pad_angle: 0.0,
            ..Default::default()
        }
    }

    #[test]
    fn hover_hits_groups_on_the_ring_and_ribbons_inside() {
        let (mut c, cam) = chart(pad0());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.prepare_layers(&v);
        let wpp = inner(&c).screen.unwrap().wpp;
        let (r_in, r_rib) = inner(&c).radii(wpp);
        let k = TAU / 12.0;
        let ring = 0.5 * (CHORD_RADIUS + r_in);
        // Group 0 spans [0, 5k]
        let hit = c
            .hover_at(&v, &mut scene, ndc_polar(&cam, 2.5 * k, ring))
            .unwrap();
        assert_eq!(
            (hit.items[0].series, hit.items[0].index, hit.items[0].value),
            (0, 0, 5.0)
        );
        let hit = c
            .hover_at(&v, &mut scene, ndc_polar(&cam, 10.5 * k, ring))
            .unwrap();
        assert_eq!((hit.items[0].series, hit.items[0].index), (0, 2));
        // Ribbon 0 -> 1 at its source end [0, 4k]; ribbon 2 -> 0 at its target end [4k, 5k]
        let hit = c
            .hover_at(&v, &mut scene, ndc_polar(&cam, 2.0 * k, 0.9 * r_rib))
            .unwrap();
        assert_eq!(
            (hit.items[0].series, hit.items[0].index, hit.items[0].value),
            (1, 1, 4.0)
        );
        assert_eq!(hit.items[0].global_id, 3 + 1);
        let hit = c
            .hover_at(&v, &mut scene, ndc_polar(&cam, 4.5 * k, 0.9 * r_rib))
            .unwrap();
        assert_eq!(
            (hit.items[0].series, hit.items[0].index, hit.items[0].value),
            (1, 6, 3.0)
        );
        assert!(c
            .hover_at(&v, &mut scene, ndc_polar(&cam, 1.0, CHORD_RADIUS * 1.2))
            .is_none());
        // Counter-clockwise from 3 o'clock: group 0 spans compass [pi/2 - 5k, pi/2]
        let (mut c, cam) = chart(ChordOptions {
            start_angle: FRAC_PI_2,
            clockwise: false,
            ..pad0()
        });
        let v = view(&cam);
        c.prepare_layers(&v);
        let hit = c
            .hover_at(&v, &mut scene, ndc_polar(&cam, FRAC_PI_2 - 2.5 * k, ring))
            .unwrap();
        assert_eq!((hit.items[0].series, hit.items[0].index), (0, 0));
    }

    fn rgb(c: [f32; 4]) -> [f32; 3] {
        [c[0], c[1], c[2]]
    }

    #[test]
    fn hover_and_emphasis_light_connected_ribbons_and_dim_the_rest() {
        let (mut c, cam) = chart(pad0());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        let colors = inner(&c).colors.clone();
        // Ribbons take their source color at the ribbon opacity; arcs are opaque
        let alphas = |fills: &[ChartFillRaw], g: usize| -> Vec<f32> {
            let mut a: Vec<f32> = fills
                .iter()
                .filter(|f| rgb(f.color) == rgb(colors[g]))
                .map(|f| f.color[3])
                .collect();
            a.sort_by(f32::total_cmp);
            a.dedup();
            a
        };
        assert_eq!(alphas(&fills, 2), vec![0.6, 1.0]);
        assert!(!c.series.is_empty(), "arc AA outlines");
        // Hover group 1: ribbons 0 -> 1 and 1 -> 2 lit, 2 -> 0 dimmed
        let wpp = inner(&c).screen.unwrap().wpp;
        let ring = 0.5 * (CHORD_RADIUS + inner(&c).radii(wpp).0);
        c.hover_at(&v, &mut scene, ndc_polar(&cam, 7.0 * TAU / 12.0, ring))
            .unwrap();
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        assert_eq!(alphas(&fills, 0), vec![0.85, 1.0]);
        assert_eq!(alphas(&fills, 1), vec![0.85, 1.0]);
        assert!((alphas(&fills, 2)[0] - 0.12).abs() < 1e-6);
        // Hover ribbon 1 -> 2: group 0 dims toward the surface
        c.hover_at(
            &v,
            &mut scene,
            ndc_polar(&cam, 8.0 * TAU / 12.0, 0.9 * inner(&c).radii(wpp).1),
        )
        .unwrap();
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        assert!(
            !alphas(&fills, 0).contains(&1.0),
            "group 0's arc faded (only its dimmed ribbons keep its color)"
        );
        let faded = mix(colors[0], HierarchyStyle::default().surface, EMPHASIS_FADE);
        assert!(fills.iter().any(|f| f.color == faded));
        // Legend emphasis without hover: group 0's ribbons (0 -> 1, 2 -> 0) lit
        c.set_hover(None, &mut scene);
        c.set_emphasis(Some(0));
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        assert_eq!(alphas(&fills, 0), vec![0.85, 1.0]);
        assert!((alphas(&fills, 1)[0] - 0.12).abs() < 1e-6, "1 -> 2 dimmed");
    }

    #[test]
    fn directed_ribbons_end_in_d3_arrow_tips() {
        let polar_r = |p: (f32, f32)| p.0.hypot(p.1);
        // Undirected: target end is an arc on the ribbon radius
        let (mut c, cam) = chart(pad0());
        c.prepare_layers(&view(&cam));
        let wpp = inner(&c).screen.unwrap().wpp;
        let r_rib = inner(&c).radii(wpp).1;
        let ch = inner(&c).layout.chords[0];
        let a = [
            ch.source.start,
            ch.source.end,
            ch.target.start,
            ch.target.end,
        ];
        let rb = inner(&c).ribbon(a, r_rib, wpp);
        assert!(rb.target.iter().all(|&p| (polar_r(p) - r_rib).abs() < 1e-3));
        // Directed (d3 ribbonArrow): curves stop at r - head, tip at r on the target mid angle
        let (mut c, cam) = chart(ChordOptions {
            directed: true,
            ..pad0()
        });
        c.prepare_layers(&view(&cam));
        let cc = inner(&c);
        let wpp = cc.screen.unwrap().wpp;
        let r_rib = cc.radii(wpp).1;
        let head = ARROW_HEAD_PX * wpp;
        let ch = *cc
            .layout
            .chords
            .iter()
            .find(|ch| ch.source.index != ch.target.index)
            .unwrap();
        let a = [
            ch.source.start,
            ch.source.end,
            ch.target.start,
            ch.target.end,
        ];
        let rb = cc.ribbon(a, r_rib, wpp);
        assert_eq!(rb.target.len(), 3, "arrow triangle");
        assert!((polar_r(rb.target[0]) - (r_rib - head)).abs() < 1e-3);
        assert!((polar_r(rb.target[2]) - (r_rib - head)).abs() < 1e-3);
        assert!((polar_r(rb.target[1]) - r_rib).abs() < 1e-3);
        let mid = cc.compass(0.5 * (a[2] + a[3]));
        let tip = polar((0.0, 0.0), mid, r_rib);
        assert!((rb.target[1].0 - tip.0).abs() < 1e-3 && (rb.target[1].1 - tip.1).abs() < 1e-3);
        assert_eq!(*rb.left.last().unwrap(), rb.target[0]);
        assert_eq!(*rb.right.last().unwrap(), rb.target[2]);
        // The tip is hit as part of its ribbon
        let near = polar((0.0, 0.0), mid, r_rib - 0.3 * head);
        assert_eq!(cc.item_at(near.0, near.1, wpp), Some((1, ch.key(3) as u32)));
    }

    #[test]
    fn gradient_ribbons_blend_source_to_target() {
        let (mut c, cam) = chart(ChordOptions {
            ribbon_color: ChordRibbonColor::Gradient,
            ..pad0()
        });
        let fills = c.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
        let colors = inner(&c).colors.clone();
        let between = |f: &ChartFillRaw| {
            (0..3).all(|ch| {
                f.color[ch] >= colors[0][ch].min(colors[1][ch]) - 1e-5
                    && f.color[ch] <= colors[0][ch].max(colors[1][ch]) + 1e-5
            })
        };
        let blended = fills
            .iter()
            .filter(|f| {
                f.color[3] < 1.0
                    && rgb(f.color) != rgb(colors[0])
                    && rgb(f.color) != rgb(colors[1])
                    && between(f)
            })
            .count();
        assert!(blended > 10, "{blended}");
    }

    #[test]
    fn legend_toggle_relays_out_and_tweens() {
        let (mut c, cam) = chart(ChordOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.set_animation(AnimationOptions::new(300.0, Easing::Linear));
        c.arm_animation(AnimationOptions::new(300.0, Easing::Linear), None);
        c.prepare_layers(&v);
        c.finish_animation();
        c.prepare_layers(&v);
        assert_eq!(c.hierarchy_labels().unwrap().0.len(), 3);
        let pad = ChordOptions::default().pad_angle;
        let k0 = (T - 3.0 * pad) / 12.0;
        let from2 = (9.0 * k0 + 2.0 * pad, 12.0 * k0 + 2.0 * pad);
        c.set_series_visible(2, false, &mut scene);
        assert!(!c.series_visible(2) && c.series_visible(0));
        let (l, _) = c.chord_layout().unwrap();
        assert_eq!(l.chords.len(), 1);
        let k = (T - 2.0 * pad) / 6.0;
        assert!(close(l.groups[0].end, 4.0 * k));
        let park = T - 0.5 * pad;
        assert!(close(l.groups[2].start, park) && close(l.groups[2].end, park));
        assert!(c.is_animating());
        c.animation_tick(0.0);
        c.prepare_layers(&v);
        assert!(c.anim_is_update());
        c.animation_tick(150.0);
        c.prepare_layers(&v);
        let fills = c.anim_fills().to_vec();
        assert!(
            !fills.is_empty()
                && fills.iter().all(|f| f
                    .position
                    .iter()
                    .chain(f.color.iter())
                    .all(|x| x.is_finite()))
        );
        // Halfway, group 2's arc still spans the midpoint of its old and parked spans
        let c2 = inner(&c).colors[2];
        let lo = 0.5 * (from2.0 + park) as f32;
        let hi = 0.5 * (from2.1 + park) as f32;
        let angles: Vec<f32> = fills
            .iter()
            .filter(|f| f.color == c2)
            .map(|f| f.position[0].atan2(f.position[1]).rem_euclid(TAU))
            .collect();
        assert!(!angles.is_empty());
        let (amin, amax) = angles
            .iter()
            .fold((f32::MAX, f32::MIN), |(a, b), &x| (a.min(x), b.max(x)));
        assert!(
            (amin - lo).abs() < 0.03 && (amax - hi).abs() < 0.03,
            "{amin} {amax} vs {lo} {hi}"
        );
        assert!(
            c.hierarchy_labels().unwrap().0.is_empty(),
            "labels wait for the tween"
        );
        // Toggle back mid-tween: tweens from the frame on screen, never NaN
        c.set_series_visible(2, true, &mut scene);
        c.animation_tick(160.0);
        c.prepare_layers(&v);
        c.animation_tick(300.0);
        c.prepare_layers(&v);
        let fills = c.anim_fills();
        assert!(
            !fills.is_empty()
                && fills
                    .iter()
                    .all(|f| f.position.iter().all(|x| x.is_finite()))
        );
        c.animation_tick(2000.0);
        c.prepare_layers(&v);
        assert!(!c.is_animating() && inner(&c).tween_from.is_none());
        assert_eq!(c.chord_layout().unwrap().0.chords.len(), 3);
        assert_eq!(c.hierarchy_labels().unwrap().0.len(), 3);
    }

    #[test]
    fn labels_sit_outside_the_ring_and_rotate_on_request() {
        let (mut c, cam) = chart(pad0());
        c.prepare_layers(&view(&cam));
        let s = inner(&c).screen.unwrap();
        let (labels, _) = c.hierarchy_labels().unwrap();
        assert_eq!(labels.len(), 3);
        for l in labels {
            let d = (l.x_css - s.center_css.0).hypot(l.y_css - s.center_css.1);
            assert!(d > s.r_css, "{l:?}");
        }
        // Group 0 centered at 75 degrees (right), 1 at 210 and 2 at 315 (left)
        let flags: Vec<i32> = labels.iter().map(|l| l.flags).collect();
        assert_eq!(flags, vec![1, -1, -1]);
        assert!(labels.iter().all(|l| l.w_css == 0.0));
        let (mut c, cam) = chart(ChordOptions {
            label_rotate: true,
            ..pad0()
        });
        c.prepare_layers(&view(&cam));
        let (labels, _) = c.hierarchy_labels().unwrap();
        assert!(
            (labels[0].w_css - (-15f32).to_radians()).abs() < 1e-4,
            "{:?}",
            labels[0]
        );
        assert_eq!(labels[0].flags, 1);
        // Left half reads left to right: 210 - 90 - 180 = -60 degrees, text ends at the anchor
        assert!(
            (labels[1].w_css - (-60f32).to_radians()).abs() < 1e-4,
            "{:?}",
            labels[1]
        );
        assert_eq!(labels[1].flags, -1);
    }

    #[test]
    fn self_chords_and_svg_export() {
        // 0 -> 0 = 2 is a self chord (one arc, curve back); 0 <-> 1 = 1
        let mut c =
            ChartState::new_chord(&[2.0, 1.0, 1.0, 0.0], 2, pad0(), HierarchyStyle::default())
                .unwrap();
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        c.frame_camera(&mut cam, (1600.0, 900.0));
        let v = view(&cam);
        c.prepare_layers(&v);
        let (l, _) = c.chord_layout().unwrap();
        assert_eq!(l.chords[0].source, l.chords[0].target);
        assert_eq!(c.point_count(), 2 + 4);
        let wpp = inner(&c).screen.unwrap().wpp;
        let r_rib = inner(&c).radii(wpp).1;
        let mut scene = SceneWorld::new();
        // Self chord spans [0, 2k] of k = tau / 4: its apex points at the center
        let hit = c
            .hover_at(&v, &mut scene, ndc_polar(&cam, TAU / 8.0, 0.8 * r_rib))
            .unwrap();
        assert_eq!((hit.items[0].series, hit.items[0].index), (1, 0));
        let svg = c.export_svg(&v, 0, "chord");
        assert_eq!(svg.support, SvgSupport::Vector);
        assert!(
            svg.marks > 0 && svg.markup.contains("<path"),
            "{}",
            svg.marks
        );
    }
}
