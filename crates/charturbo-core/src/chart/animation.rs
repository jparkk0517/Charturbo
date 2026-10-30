//! Opt-in enter / update animations of 2D charts, applied at the staged-layer level so every
//! chart kind gets them without per-kind code paths.
//!
//! - Enter (a chart was rendered): lines / areas / candles reveal left -> right through the
//!   series scissor rect (no geometry change), bars grow from the zero baseline, scatter points
//!   and pie slices fade + scale in, other marks fade in.
//! - Update (`set_series_data`, or a chart re-rendered with data of the same shape): each staged
//!   layer whose instance count is unchanged is interpolated element-wise from the previous
//!   frame's instances (line vertices = y values, bar rects = heights, scatter centers); pie
//!   slices tween their angles. Layers whose shape changed snap.
//!
//! Cost: one eased CPU lerp per frame over the *staged* instances (LOD picks, never the raw
//! samples), so a 1M-point line animates its few thousand decimated vertices. Charts with more
//! than `MAX_ANIMATED_MARKS` staged marks (e.g. 1M scatter points) skip the animation. Time is
//! driven by the host (`animation_tick(now_ms)`, one call per animation frame); nothing ticks
//! while idle.

use super::*;
use crate::renderer::ChartDashSegmentRaw;
use std::mem::Discriminant;

/// Charts with more staged marks than this skip animations (the per-frame lerp is O(marks)).
pub const MAX_ANIMATED_MARKS: usize = 50_000;

/// Timing curve of an animation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Easing {
    Linear,
    /// Fast start, gentle stop (default)
    #[default]
    CubicOut,
    CubicInOut,
    CubicIn,
}

impl Easing {
    /// 0 = linear, 1 = cubic-out, 2 = cubic-in-out, 3 = cubic-in
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Linear,
            2 => Self::CubicInOut,
            3 => Self::CubicIn,
            _ => Self::CubicOut,
        }
    }

    /// Eased progress of linear progress `t` (clamped to `[0, 1]`).
    pub fn apply(self, t: f32) -> f32 {
        let t = if t.is_finite() { t.clamp(0.0, 1.0) } else { 1.0 };
        match self {
            Self::Linear => t,
            Self::CubicOut => 1.0 - (1.0 - t).powi(3),
            Self::CubicIn => t * t * t,
            Self::CubicInOut => {
                if t < 0.5 {
                    4.0 * t * t * t
                } else {
                    1.0 - (-2.0 * t + 2.0).powi(3) * 0.5
                }
            }
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnimationOptions {
    pub duration_ms: f32,
    pub easing: Easing,
    /// Morph into a re-rendered chart of another family (bar <-> pie, treemap <-> sunburst;
    /// transition.rs)
    pub transition: bool,
}

impl AnimationOptions {
    /// `None` when the duration is not a positive finite number (animations off).
    pub fn new(duration_ms: f32, easing: Easing) -> Option<Self> {
        (duration_ms.is_finite() && duration_ms > 0.0).then_some(Self { duration_ms: duration_ms.min(60_000.0), easing, transition: false })
    }

    pub fn with_transition(mut self, on: bool) -> Self {
        self.transition = on;
        self
    }
}

/// How a freshly rendered chart enters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum EnterStyle {
    /// Left -> right through the scissor rect (lines, areas, candles)
    Reveal,
    /// Bars grow from the zero baseline; other marks fade in
    Grow,
    /// Points / slices fade in while scaling up
    Pop,
    /// Everything fades in
    Fade,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Phase {
    Enter,
    /// Interpolate from `Animator::from`; decided against the new layers on the first frame
    Update,
    /// Morph from the polygons of a chart of another family (transition.rs)
    Morph,
}

/// Staged instances of the layers animations touch.
#[derive(Debug, Clone, Default)]
pub(crate) struct LayerSnapshot {
    series: Vec<ChartSegmentRaw>,
    dashed: Vec<ChartDashSegmentRaw>,
    markers: Vec<ChartMarkerRaw>,
    bars: Vec<ChartBarRaw>,
    /// Background tracks leading `bars` (a tween pairs tracks with tracks only)
    bar_tracks: usize,
    fills: Vec<ChartFillRaw>,
    points: Vec<ChartPointRaw>,
    /// Pie slice angles `(start, end)`
    pie: Vec<(f32, f32)>,
    /// Pictorial bar segments (symbols are rebuilt per frame from them)
    pictorial: Vec<Option<super::bar::BarSeg>>,
    /// Keyed bars of a bar race (race.rs)
    race: Vec<super::race::RaceBar>,
    /// Morph polygons and family of the marks (transition.rs; only `anim_snapshot_in` fills them)
    morph: Vec<super::transition::MorphShape>,
    morph_family: u8,
}

/// Last frame of a chart that was replaced, so the next chart of the same kind and shape can
/// tween from it (`VisualizationEngine::clear_chart` keeps it).
#[derive(Debug, Clone)]
pub struct AnimSnapshot {
    kind: Discriminant<ChartKind>,
    layers: LayerSnapshot,
}

/// Animation state of a chart: options, phase / clock, source instances and output buffers.
#[derive(Debug, Clone, Default)]
pub(crate) struct Animator {
    opts: Option<AnimationOptions>,
    /// The engine handed this chart its options / previous frame (`arm_animation`)
    armed: bool,
    phase: Option<Phase>,
    /// Update phase checked against the new layers (shape match) yet
    decided: bool,
    start_ms: Option<f64>,
    /// Eased progress in `[0, 1]`
    progress: f32,
    from: LayerSnapshot,
    out: LayerSnapshot,
    /// Layers the last frame took from `out` (what is on screen mid-animation)
    shown: AnimLayers,
    /// Mark keys by global id (`set_mark_keys`)
    pub(crate) keys: Vec<u32>,
    /// Physical px (from the viewport left) the reveal enter shows up to this frame
    pub(crate) reveal_front_px: Option<f32>,
    /// Morph polygons on screen this frame (a re-render mid-morph starts from them)
    morph_shown: Vec<super::transition::MorphShape>,
}

/// Which `ChartLayers` slots `prepare_animation` filled from the animator's buffers.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct AnimLayers {
    pub(crate) series: bool,
    pub(crate) series_style: bool,
    pub(crate) bars: bool,
    pub(crate) fills: bool,
    pub(crate) points: bool,
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[inline]
fn lerp4(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), lerp(a[3], b[3], t)]
}

/// xyz lerped, w (width / radius / dash) taken from `b`.
#[inline]
fn lerp_xyz(a: [f32; 4], b: [f32; 4], t: f32) -> [f32; 4] {
    [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t), b[3]]
}

#[inline]
fn fade(mut c: [f32; 4], e: f32) -> [f32; 4] {
    c[3] *= e;
    c
}

/// Copies `src` into `out` with `f` applied to each element.
fn map_into<T: Copy>(src: &[T], out: &mut Vec<T>, f: impl Fn(T) -> T) {
    out.clear();
    out.extend(src.iter().map(|&v| f(v)));
}

/// Element-wise tween of `from` -> `to` into `out`; false (nothing written) when the shapes differ.
fn tween_into<T: Copy>(from: &[T], to: &[T], out: &mut Vec<T>, f: impl Fn(T, T) -> T) -> bool {
    if from.len() != to.len() || to.is_empty() {
        return false;
    }
    out.clear();
    out.extend(from.iter().zip(to).map(|(&a, &b)| f(a, b)));
    true
}

/// Baselines bars grow from: `[up, down, right, left]` (rounded end +1 / -1 / +2 / -2). The
/// zero line is where the stacks start: the lowest bottom of upward bars, the highest top of
/// downward ones (and likewise in x for horizontal bars).
fn bar_baselines(bars: &[ChartBarRaw]) -> [f32; 4] {
    let mut b = [f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY];
    for bar in bars {
        let [x0, y0, x1, y1] = bar.rect;
        let end = bar.z_radius[2];
        if end > 1.5 {
            b[2] = b[2].min(x0.min(x1));
        } else if end < -1.5 {
            b[3] = b[3].max(x0.max(x1));
        } else if end < -0.5 {
            b[1] = b[1].max(y0.max(y1));
        } else {
            b[0] = b[0].min(y0.min(y1));
        }
    }
    b
}

/// `bar` grown to `e` of its length from the baselines.
fn grow_bar(mut bar: ChartBarRaw, base: &[f32; 4], e: f32) -> ChartBarRaw {
    let end = bar.z_radius[2];
    let r = &mut bar.rect;
    let (axis, b) = if end > 1.5 {
        (0, base[2])
    } else if end < -1.5 {
        (0, base[3])
    } else if end < -0.5 {
        (1, base[1])
    } else {
        (1, base[0])
    };
    r[axis] = b + (r[axis] - b) * e;
    r[axis + 2] = b + (r[axis + 2] - b) * e;
    bar
}

/// Center of the world bounding box of `fills` and `series` (pie center for a full pie).
fn layer_center(fills: &[ChartFillRaw], series: &[ChartSegmentRaw]) -> (f32, f32) {
    let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    let mut add = |x: f32, y: f32| {
        lo = [lo[0].min(x), lo[1].min(y)];
        hi = [hi[0].max(x), hi[1].max(y)];
    };
    fills.iter().for_each(|f| add(f.position[0], f.position[1]));
    series.iter().for_each(|s| {
        add(s.p0_width[0], s.p0_width[1]);
        add(s.p1_pad[0], s.p1_pad[1]);
    });
    if lo[0] > hi[0] {
        return (0.0, 0.0);
    }
    ((lo[0] + hi[0]) * 0.5, (lo[1] + hi[1]) * 0.5)
}

#[inline]
fn scale_about(p: [f32; 4], c: (f32, f32), e: f32) -> [f32; 4] {
    [c.0 + (p[0] - c.0) * e, c.1 + (p[1] - c.1) * e, p[2], p[3]]
}

impl ChartState {
    /// Sets (or with `None` turns off) animations of this chart; turning them off mid-way jumps
    /// to the final frame.
    pub fn set_animation(&mut self, opts: Option<AnimationOptions>) {
        self.anim.opts = opts;
        if opts.is_none() {
            self.finish_animation();
        }
    }

    pub fn animation(&self) -> Option<AnimationOptions> {
        self.anim.opts
    }

    /// Stable key of each mark by global id (bars, pie inputs, hierarchy nodes): bar races and
    /// transitions pair marks by key instead of by index. Empty = by index.
    pub fn set_mark_keys(&mut self, keys: Vec<u32>) {
        self.anim.keys = keys;
    }

    /// Source bars and eased progress of a running bar race (`None` otherwise).
    pub(crate) fn race_source(&self) -> Option<(&[super::race::RaceBar], f32)> {
        (self.anim.phase == Some(Phase::Update) && !self.anim.from.race.is_empty())
            .then(|| (self.anim.from.race.as_slice(), self.anim.progress))
    }

    /// First call per chart (the engine calls it before every frame / tick): adopts the engine's
    /// animation options and starts the enter animation, or an update from `prev` when it is the
    /// last frame of a replaced chart of the same kind. Later calls do nothing.
    pub fn arm_animation(&mut self, opts: Option<AnimationOptions>, prev: Option<AnimSnapshot>) {
        if self.anim.armed {
            return;
        }
        self.anim.armed = true;
        self.anim.opts = opts;
        if opts.is_none() {
            return;
        }
        // Transition on and the previous chart is the paired family: morph (transition.rs)
        let family = super::transition::morph_family(&self.kind);
        if let Some(p) = prev.as_ref().filter(|p| {
            opts.is_some_and(|o| o.transition) && !p.layers.morph.is_empty() && super::transition::morph_pair(p.layers.morph_family, family)
        }) {
            self.anim.from = p.layers.clone();
            self.start_phase(Phase::Morph);
            return;
        }
        // Gauges / hierarchy charts are angular: an element-wise lerp of segment ends would
        // shrink a swinging needle or arc mid-tween, so they enter instead of tweening
        let angular = matches!(self.kind, ChartKind::Gauge(_) | ChartKind::Hierarchy(_));
        let same_kind = !angular && prev.as_ref().is_some_and(|p| p.kind == std::mem::discriminant(&self.kind));
        match prev {
            Some(p) if same_kind => {
                self.anim.from = p.layers;
                self.start_phase(Phase::Update);
            }
            _ => self.start_phase(Phase::Enter),
        }
    }

    fn start_phase(&mut self, phase: Phase) {
        let a = &mut self.anim;
        a.phase = Some(phase);
        a.decided = false;
        a.start_ms = None;
        a.progress = 0.0;
    }

    /// Staged instances of the current frame (`None` with animations off or too many marks).
    pub fn anim_snapshot(&self) -> Option<AnimSnapshot> {
        self.anim.opts?;
        // Count before cloning: a 1M-point chart must not copy its layers just to drop them
        if self.staged_marks() > MAX_ANIMATED_MARKS {
            return None;
        }
        Some(AnimSnapshot { kind: std::mem::discriminant(&self.kind), layers: self.staged_snapshot() })
    }

    fn staged_marks(&self) -> usize {
        self.series.len() + self.styled.dashed.len() + self.styled.markers.len() + self.bars.len() + self.fills.len() / 3 + self.points.len()
    }

    fn staged_snapshot(&self) -> LayerSnapshot {
        LayerSnapshot {
            series: self.series.clone(),
            dashed: self.styled.dashed.clone(),
            markers: self.styled.markers.clone(),
            bars: self.bars.clone(),
            bar_tracks: self.bar_track_count(),
            fills: self.fills.clone(),
            points: self.points.clone(),
            pie: match &self.kind {
                ChartKind::Pie(p) => p.angles(),
                _ => Vec::new(),
            },
            pictorial: super::pictorial::pictorial_segs(&self.kind),
            race: match &self.kind {
                ChartKind::Bar(b) => b.race_snapshot(&self.anim.keys),
                _ => Vec::new(),
            },
            morph: Vec::new(),
            morph_family: 0,
        }
    }

    /// `anim_snapshot` plus the morph polygons of the marks on screen (transition.rs; `view` = the
    /// camera this chart was drawn with).
    pub fn anim_snapshot_in(&self, view: &ChartView) -> Option<AnimSnapshot> {
        let mut s = self.anim_snapshot()?;
        let family = super::transition::morph_family(&self.kind);
        if family != 0 {
            s.layers.morph_family = family;
            s.layers.morph = if self.anim.phase == Some(Phase::Morph) { self.anim.morph_shown.clone() } else { self.morph_shapes(view) };
        }
        Some(s)
    }

    /// The running animation morphs from a chart of another family (transition.rs).
    pub fn anim_is_morph(&self) -> bool {
        self.anim.phase == Some(Phase::Morph)
    }

    /// Data of the same shape is about to replace the current data: tween from the current frame.
    pub(crate) fn begin_update_animation(&mut self) {
        if self.anim.opts.is_none() || !self.anim.armed {
            return;
        }
        if self.staged_marks() > MAX_ANIMATED_MARKS {
            self.finish_animation();
            return;
        }
        let mut from = self.staged_snapshot();
        // Mid-animation: start from the interpolated frame on screen, not the old target
        if self.anim.phase.is_some() {
            let (shown, out) = (self.anim.shown, &self.anim.out);
            if shown.series {
                from.series.clone_from(&out.series);
            }
            if shown.series_style {
                from.dashed.clone_from(&out.dashed);
                from.markers.clone_from(&out.markers);
            }
            if shown.bars {
                from.bars.clone_from(&out.bars);
            }
            if shown.fills {
                from.fills.clone_from(&out.fills);
                if !out.pictorial.is_empty() {
                    from.pictorial.clone_from(&out.pictorial);
                }
            }
            if shown.points {
                from.points.clone_from(&out.points);
            }
        }
        self.anim.from = from;
        self.start_phase(Phase::Update);
    }

    /// Advances the clock to `now_ms` (any monotonic ms clock; the first tick starts it). Returns
    /// true while the animation still runs (the caller renders this frame either way).
    pub fn animation_tick(&mut self, now_ms: f64) -> bool {
        if self.anim.phase.is_none() {
            return false;
        }
        let Some(opts) = self.anim.opts else {
            self.finish_animation();
            return false;
        };
        let now = if now_ms.is_finite() { now_ms } else { 0.0 };
        let start = *self.anim.start_ms.get_or_insert(now);
        let raw = ((now - start) / opts.duration_ms as f64) as f32;
        if raw >= 1.0 {
            self.finish_animation();
            return false;
        }
        self.anim.progress = opts.easing.apply(raw);
        true
    }

    /// Jumps to the final frame: the staged layers are uploaded again on the next frame.
    pub fn finish_animation(&mut self) {
        if self.anim.phase.take().is_none() {
            return;
        }
        self.anim.from = LayerSnapshot::default();
        self.anim.shown = AnimLayers::default();
        self.anim.progress = 1.0;
        self.anim.reveal_front_px = None;
        self.anim.morph_shown = Vec::new();
        self.end_bar_race();
        self.dirty.series = true;
        self.dirty.bars = true;
        self.dirty.fills = true;
        self.dirty.points = true;
        self.dirty.point_style = true;
    }

    /// The running animation tweens from a previous frame (update) rather than entering.
    pub fn anim_is_update(&self) -> bool {
        self.anim.phase == Some(Phase::Update)
    }

    pub fn is_animating(&self) -> bool {
        self.anim.phase.is_some()
    }

    /// Eased progress of the running animation (1 when idle).
    pub fn animation_progress(&self) -> f32 {
        if self.anim.phase.is_some() {
            self.anim.progress
        } else {
            1.0
        }
    }

    #[allow(unreachable_patterns)]
    fn enter_style(&self) -> EnterStyle {
        match &self.kind {
            ChartKind::Line(_) | ChartKind::Area(_) | ChartKind::Candle(_) => EnterStyle::Reveal,
            ChartKind::Bar(_) => EnterStyle::Grow,
            ChartKind::Scatter(_) | ChartKind::Pie(_) => EnterStyle::Pop,
            ChartKind::Box(_) | ChartKind::Heatmap(_) => EnterStyle::Fade,
            // Kinds without their own entry: bars grow, the other marks fade in
            _ => EnterStyle::Grow,
        }
    }

    /// Fills the animator's buffers for this frame (called by `prepare_layers` after the staged
    /// layers are built, before they are handed out) and narrows `clip` for reveals. Returns the
    /// layers to take from the animator instead of the staging vectors.
    pub(crate) fn prepare_animation(&mut self, view: &ChartView, clip: &mut Option<[u32; 4]>) -> AnimLayers {
        let mut used = AnimLayers::default();
        self.anim.reveal_front_px = None;
        let Some(phase) = self.anim.phase else {
            return used;
        };
        let marks = self.series.len()
            + self.styled.dashed.len()
            + self.styled.markers.len()
            + self.bars.len()
            + self.fills.len() / 3
            + self.points.len();
        if marks > MAX_ANIMATED_MARKS {
            self.finish_animation();
            return used;
        }
        let mut phase = phase;
        if phase == Phase::Update && !self.anim.decided {
            // A re-rendered chart of another shape enters instead
            let f = &self.anim.from;
            let pie_match = matches!(&self.kind, ChartKind::Pie(p) if p.len() == f.pie.len() && !f.pie.is_empty());
            let chord_match = matches!(&self.kind, ChartKind::Hierarchy(HierChart::Chord(c)) if c.tween_from.is_some());
            let race_match = matches!(&self.kind, ChartKind::Bar(b) if b.race.is_some());
            let matched = pie_match
                || race_match
                || super::pictorial::pictorial_matches(&self.kind, &f.pictorial)
                || chord_match
                || (!f.series.is_empty() && f.series.len() == self.series.len())
                || (!f.bars.is_empty() && f.bars.len() == self.bars.len() && f.bar_tracks == self.bar_track_count())
                || (!f.fills.is_empty() && f.fills.len() == self.fills.len())
                || (!f.points.is_empty() && f.points.len() == self.points.len());
            if !matched {
                phase = Phase::Enter;
                self.anim.phase = Some(Phase::Enter);
                self.anim.from = LayerSnapshot::default();
            }
        }
        self.anim.decided = true;
        let e = self.anim.progress;
        match phase {
            Phase::Update => self.tween_layers(e, &mut used),
            Phase::Enter => self.enter_layers(view, e, clip, &mut used),
            Phase::Morph => self.morph_layers(view, e, &mut used),
        }
        self.anim.shown = used;
        used
    }

    /// Morph frame (transition.rs): the lerped polygons replace every mark layer.
    fn morph_layers(&mut self, view: &ChartView, e: f32, used: &mut AnimLayers) {
        let to = self.morph_shapes(view);
        let Some(screen) = super::hierarchy::FlatScreen::of(view).filter(|_| !to.is_empty()) else {
            self.finish_animation();
            return;
        };
        let frame = super::transition::morph_frame(&self.anim.from.morph, &to, e);
        let a = &mut self.anim;
        super::transition::push_morph_fills(&screen, &frame, &mut a.out.fills);
        a.morph_shown = frame;
        a.out.series.clear();
        a.out.dashed.clear();
        a.out.markers.clear();
        a.out.bars.clear();
        a.out.points.clear();
        *used = AnimLayers { series: true, series_style: true, bars: true, fills: true, points: true };
    }

    fn tween_layers(&mut self, e: f32, used: &mut AnimLayers) {
        let a = &mut self.anim;
        let seg = |p: ChartSegmentRaw, q: ChartSegmentRaw| ChartSegmentRaw {
            p0_width: lerp_xyz(p.p0_width, q.p0_width, e),
            p1_pad: lerp_xyz(p.p1_pad, q.p1_pad, e),
            color: lerp4(p.color, q.color, e),
        };
        if let ChartKind::Hierarchy(HierChart::Chord(c)) = &mut self.kind {
            // Chord groups / ribbons tween their angles (rebuilt per frame)
            if c.tween_build(e, &mut a.out.fills, &mut a.out.series) {
                used.fills = true;
                used.series = true;
            }
            return;
        }
        if let ChartKind::Pie(p) = &self.kind {
            // Slices tween their angles (tessellation counts follow the angles)
            match p.built_wpp() {
                Some(wpp) if a.from.pie.len() == p.len() => {
                    let to = p.angles();
                    let angles: Vec<(f32, f32)> =
                        a.from.pie.iter().zip(&to).map(|(&(s0, e0), &(s1, e1))| (lerp(s0, s1, e), lerp(e0, e1, e))).collect();
                    p.build_with_angles(wpp, &angles, &mut a.out.fills, &mut a.out.series);
                    used.fills = true;
                    used.series = true;
                }
                _ => {}
            }
            return;
        }
        let pictorial = super::pictorial::pictorial_tween(&self.kind, &a.from.pictorial, e);
        used.series = tween_into(&a.from.series, &self.series, &mut a.out.series, seg);
        let dashed = tween_into(&a.from.dashed, &self.styled.dashed, &mut a.out.dashed, |p, q| ChartDashSegmentRaw {
            p0_width: lerp_xyz(p.p0_width, q.p0_width, e),
            p1_phase: lerp_xyz(p.p1_phase, q.p1_phase, e),
            color: lerp4(p.color, q.color, e),
            dash: q.dash,
        });
        let markers = tween_into(&a.from.markers, &self.styled.markers, &mut a.out.markers, |p, q| ChartMarkerRaw {
            center_radius: lerp_xyz(p.center_radius, q.center_radius, e),
            fill: lerp4(p.fill, q.fill, e),
            ..q
        });
        if dashed || markers {
            // The style layer uploads both slices: complete the one that did not tween
            if !dashed {
                a.out.dashed.clone_from(&self.styled.dashed);
            }
            if !markers {
                a.out.markers.clone_from(&self.styled.markers);
            }
            used.series_style = true;
            if !used.series {
                a.out.series.clone_from(&self.series);
                used.series = true;
            }
        }
        // A bar race lays out its own frame (race.rs): the staged bars are already tweened
        let race = matches!(&self.kind, ChartKind::Bar(b) if b.race.is_some());
        used.bars = !race
            && tween_into(&a.from.bars, &self.bars, &mut a.out.bars, |p, q| ChartBarRaw {
                rect: lerp4(p.rect, q.rect, e),
                color: lerp4(p.color, q.color, e),
                ..q
            });
        let hovered = super::hovered_bar(self.hover.as_ref());
        used.fills = match pictorial {
            // Pictorial bars: the symbols are re-laid out along the tweened bars
            Some(segs) if super::pictorial::pictorial_frame(&self.kind, hovered, &self.hover_style, &segs, &mut a.out.fills) => {
                a.out.pictorial = segs;
                true
            }
            _ => tween_into(&a.from.fills, &self.fills, &mut a.out.fills, |p, q| ChartFillRaw {
                position: lerp_xyz(p.position, q.position, e),
                color: lerp4(p.color, q.color, e),
            }),
        };
        used.points = tween_into(&a.from.points, &self.points, &mut a.out.points, |p, q| {
            let c = |i: usize| lerp(p.color[i] as f32, q.color[i] as f32, e).round().clamp(0.0, 255.0) as u8;
            ChartPointRaw {
                center_radius: [
                    lerp(p.center_radius[0], q.center_radius[0], e),
                    lerp(p.center_radius[1], q.center_radius[1], e),
                    q.center_radius[2],
                    lerp(p.center_radius[3], q.center_radius[3], e),
                ],
                color: [c(0), c(1), c(2), c(3)],
            }
        });
    }

    fn enter_layers(&mut self, view: &ChartView, e: f32, clip: &mut Option<[u32; 4]>, used: &mut AnimLayers) {
        let style = self.enter_style();
        let tracks = self.bar_track_count();
        let a = &mut self.anim;
        if style == EnterStyle::Reveal {
            if let Some(rect) = reveal_clip(view, &self.series, &self.fills, &self.bars, e) {
                a.reveal_front_px = Some((rect[0] + rect[2]) as f32);
                *clip = Some(match *clip {
                    Some(c) => intersect(c, rect),
                    None => rect,
                });
            }
            return;
        }
        let pop_center = (style == EnterStyle::Pop).then(|| layer_center(&self.fills, &self.series));
        // Bars: grow (Grow), else fade
        if !self.bars.is_empty() {
            if style == EnterStyle::Grow {
                // Background tracks lead the layer and stay at full length
                let (tracks, bars) = self.bars.split_at(tracks.min(self.bars.len()));
                let base = bar_baselines(bars);
                a.out.bars.clear();
                a.out.bars.extend_from_slice(tracks);
                a.out.bars.extend(bars.iter().map(|&b| grow_bar(b, &base, e)));
            } else {
                map_into(&self.bars, &mut a.out.bars, |b| ChartBarRaw { color: fade(b.color, e), ..b });
            }
            used.bars = true;
        }
        let seg = |s: ChartSegmentRaw| match pop_center {
            Some(c) => ChartSegmentRaw {
                p0_width: scale_about(s.p0_width, c, e),
                p1_pad: scale_about(s.p1_pad, c, e),
                color: fade(s.color, e),
            },
            None => ChartSegmentRaw { color: fade(s.color, e), ..s },
        };
        if !self.series.is_empty() || !self.styled.markers.is_empty() || !self.styled.dashed.is_empty() {
            map_into(&self.series, &mut a.out.series, seg);
            map_into(&self.styled.dashed, &mut a.out.dashed, |s| ChartDashSegmentRaw { color: fade(s.color, e), ..s });
            map_into(&self.styled.markers, &mut a.out.markers, |m| ChartMarkerRaw {
                fill: fade(m.fill, e),
                ring: fade(m.ring, e),
                ..m
            });
            used.series = true;
            used.series_style = true;
        }
        let hovered = super::hovered_bar(self.hover.as_ref());
        let grown = (style == EnterStyle::Grow).then(|| super::pictorial::pictorial_grow(&self.kind, e)).flatten();
        if let Some(segs) = grown.filter(|s| super::pictorial::pictorial_frame(&self.kind, hovered, &self.hover_style, s, &mut a.out.fills)) {
            // Pictorial bars: the symbols are re-laid out along the growing bars
            a.out.pictorial = segs;
            used.fills = true;
        } else if !self.fills.is_empty() {
            map_into(&self.fills, &mut a.out.fills, |f| ChartFillRaw {
                position: pop_center.map_or(f.position, |c| scale_about(f.position, c, e)),
                color: fade(f.color, e),
            });
            used.fills = true;
        }
        if !self.points.is_empty() {
            let r = if style == EnterStyle::Pop { e } else { 1.0 };
            map_into(&self.points, &mut a.out.points, |p| {
                let mut p = p;
                p.center_radius[3] *= r;
                p.color[3] = (p.color[3] as f32 * e).round() as u8;
                p
            });
            used.points = true;
        }
    }

    /// Animator buffers handed to the renderer this frame.
    pub(crate) fn anim_series(&self) -> &[ChartSegmentRaw] {
        &self.anim.out.series
    }

    pub(crate) fn anim_series_style(&self) -> crate::renderer::ChartSeriesStyleLayer<'_> {
        crate::renderer::ChartSeriesStyleLayer { dashed: &self.anim.out.dashed, markers: &self.anim.out.markers }
    }

    pub(crate) fn anim_bars(&self) -> &[ChartBarRaw] {
        &self.anim.out.bars
    }

    pub(crate) fn anim_fills(&self) -> &[ChartFillRaw] {
        &self.anim.out.fills
    }

    pub(crate) fn anim_points(&self) -> &[ChartPointRaw] {
        &self.anim.out.points
    }
}

/// Intersection of two `[x, y, w, h]` rects (at least 1 px wide / high: a zero-size scissor
/// would disable clipping).
fn intersect(a: [u32; 4], b: [u32; 4]) -> [u32; 4] {
    let x0 = a[0].max(b[0]);
    let y0 = a[1].max(b[1]);
    let x1 = (a[0] + a[2]).min(b[0] + b[2]);
    let y1 = (a[1] + a[3]).min(b[1] + b[3]);
    [x0, y0, x1.saturating_sub(x0).max(1), y1.saturating_sub(y0).max(1)]
}

/// Scissor rect (physical px) showing the left `e` of the marks' screen x extent.
fn reveal_clip(view: &ChartView, series: &[ChartSegmentRaw], fills: &[ChartFillRaw], bars: &[ChartBarRaw], e: f32) -> Option<[u32; 4]> {
    let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
    let (mut y, mut z) = (0.0, 0.0);
    let mut add = |p: [f32; 4]| {
        if p[0] < lo {
            (y, z) = (p[1], p[2]);
        }
        lo = lo.min(p[0]);
        hi = hi.max(p[0]);
    };
    series.iter().for_each(|s| {
        add(s.p0_width);
        add(s.p1_pad);
    });
    fills.iter().for_each(|f| add(f.position));
    bars.iter().for_each(|b| {
        add([b.rect[0], b.rect[1], b.z_radius[0], 0.0]);
        add([b.rect[2], b.rect[3], b.z_radius[0], 0.0]);
    });
    if lo > hi {
        return None;
    }
    let (vw, vh) = (view.viewport_px.0 as f32, view.viewport_px.1 as f32);
    let a = view.project_px(Vec3::new(lo, y, z))?.0 + 0.5 * vw;
    let b = view.project_px(Vec3::new(hi, y, z))?.0 + 0.5 * vw;
    // Stroke caps reach a few px past the extreme vertices
    let pad = 8.0 * view.pixel_ratio;
    let (x0, x1) = ((a.min(b) - pad).clamp(0.0, vw), (a.max(b) + pad).clamp(0.0, vw));
    let w = ((x1 - x0) * e).round().max(1.0);
    Some([x0 as u32, 0, w as u32, vh.max(1.0) as u32])
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
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn opts() -> Option<AnimationOptions> {
        AnimationOptions::new(100.0, Easing::Linear)
    }

    fn line(values: Vec<f32>) -> ChartState {
        ChartState::new_line(
            vec![LineSeries { values, x: None, color: [1.0; 4], width_px: 2.0 }],
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        )
    }

    fn bars(values: Vec<f32>, scene: &mut SceneWorld) -> ChartState {
        ChartState::new_bar(
            values,
            vec![[0.2, 0.4, 0.8, 1.0]],
            BarLayout { width: 160.0, max_height: 80.0, bar_width: 0.0, corner_radius_px: 0.0, view: ChartViewMode::Flat },
            scene,
        )
    }

    #[test]
    fn easing_curves_hit_their_ends_and_are_monotonic() {
        for ease in [Easing::Linear, Easing::CubicOut, Easing::CubicInOut, Easing::CubicIn] {
            assert_eq!(ease.apply(0.0), 0.0);
            assert!((ease.apply(1.0) - 1.0).abs() < 1e-6);
            assert_eq!(ease.apply(2.0), ease.apply(1.0), "clamped");
            let mut last = 0.0;
            for k in 1..=20 {
                let v = ease.apply(k as f32 / 20.0);
                assert!(v >= last, "{ease:?} not monotonic");
                last = v;
            }
        }
        assert!(Easing::CubicOut.apply(0.5) > 0.5 && Easing::CubicIn.apply(0.5) < 0.5);
        assert!(AnimationOptions::new(0.0, Easing::Linear).is_none());
        assert!(AnimationOptions::new(f32::NAN, Easing::Linear).is_none());
    }

    #[test]
    fn disabled_animations_never_start() {
        let cam = flat_camera();
        let mut chart = line((0..10).map(|i| i as f32).collect());
        chart.arm_animation(None, None);
        assert!(!chart.is_animating());
        assert!(!chart.animation_tick(0.0));
        let layers = chart.prepare_layers(&view(&cam));
        assert_eq!(layers.series.unwrap().len(), 9);
    }

    #[test]
    fn line_enter_reveals_through_the_scissor_and_stops() {
        let mut cam = flat_camera();
        let mut chart = line((0..100).map(|i| (i % 7) as f32).collect());
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.arm_animation(opts(), None);
        assert!(chart.animation_tick(1000.0), "first tick starts the clock");
        let clip0 = chart.prepare_layers(&view(&cam)).series_clip.expect("reveal clip");
        assert!(clip0[2] <= 1, "nothing revealed at t = 0: {clip0:?}");
        assert!(chart.animation_tick(1050.0));
        assert!((chart.animation_progress() - 0.5).abs() < 1e-6);
        let layers = chart.prepare_layers(&view(&cam));
        let clip = layers.series_clip.unwrap();
        assert!(layers.series.is_none(), "geometry untouched by a reveal");
        // Half the plot (plus cap padding) is visible
        let plot = chart.axes().plot_css;
        assert!((clip[2] as f32 - (plot[2] + 16.0) * 0.5).abs() <= 2.0, "{clip:?} vs {plot:?}");
        // Ends: the clock passes the duration, no clip, the staged series is uploaded again
        assert!(!chart.animation_tick(1100.0));
        assert!(!chart.is_animating());
        let layers = chart.prepare_layers(&view(&cam));
        assert!(layers.series_clip.is_none());
        assert_eq!(layers.series.unwrap().len(), 99);
        // Stays stopped: no work on later frames
        assert!(!chart.animation_tick(5000.0));
        assert!(chart.prepare_layers(&view(&cam)).series.is_none());
    }

    #[test]
    fn set_series_data_interpolates_the_staged_vertices() {
        let mut cam = flat_camera();
        let mut chart = line(vec![0.0, 10.0, 0.0, 10.0]);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.arm_animation(opts(), None);
        chart.finish_animation();
        let before = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        chart.set_series_data(0, vec![10.0, 0.0, 10.0, 0.0], None).unwrap();
        assert!(chart.is_animating());
        chart.animation_tick(0.0);
        chart.animation_tick(25.0);
        let mid = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        let after_target = {
            let mut c = chart.clone();
            c.finish_animation();
            c.prepare_layers(&view(&cam)).series.unwrap().to_vec()
        };
        assert_eq!(mid.len(), before.len());
        for k in 0..mid.len() {
            let want = before[k].p0_width[1] + (after_target[k].p0_width[1] - before[k].p0_width[1]) * 0.25;
            assert!((mid[k].p0_width[1] - want).abs() < 1e-4, "segment {k}: {} vs {want}", mid[k].p0_width[1]);
            assert_eq!(mid[k].p0_width[0], after_target[k].p0_width[0], "x does not move");
        }
        assert!(!chart.animation_tick(100.0));
        assert_eq!(chart.prepare_layers(&view(&cam)).series.unwrap(), &after_target[..]);

        // Retargeted mid-tween: the next tween starts at the frame on screen; rejected updates
        // start nothing
        chart.set_series_data(0, vec![0.0, 10.0, 0.0, 10.0], None).unwrap();
        chart.animation_tick(1000.0);
        chart.animation_tick(1050.0);
        let shown = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        chart.set_series_data(0, vec![5.0, 5.0, 5.0, 5.0], None).unwrap();
        chart.animation_tick(2000.0);
        let first = chart.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        assert_eq!(first, shown, "no jump back to the old target");
        chart.finish_animation();
        assert!(chart.set_series_data(0, vec![1.0], Some(vec![0.0])).is_err());
        assert!(!chart.is_animating());
    }

    #[test]
    fn bars_grow_from_the_zero_baseline_and_rerenders_tween_heights() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut chart = bars(vec![10.0, 20.0, -5.0], &mut scene);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.arm_animation(opts(), None);
        chart.animation_tick(0.0);
        chart.animation_tick(50.0);
        let half = chart.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        let mut done = chart.clone();
        done.finish_animation();
        let full = done.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        let zero = full[0].rect[1];
        assert!((full[2].rect[3] - zero).abs() < 1e-4, "negative bar hangs from the same zero line");
        for (h, f) in half.iter().zip(&full) {
            let (len_h, len_f) = (h.rect[3] - h.rect[1], f.rect[3] - f.rect[1]);
            assert!((len_h - 0.5 * len_f).abs() < 1e-4);
        }
        assert!((half[2].rect[3] - zero).abs() < 1e-4, "grows down from zero");

        // Same-shape re-render: heights tween from the previous chart's last frame
        let snap = done.anim_snapshot().expect("snapshot");
        let mut next = bars(vec![20.0, 10.0, -5.0], &mut scene);
        next.frame_camera(&mut cam, (1600.0, 900.0));
        next.arm_animation(opts(), Some(snap));
        next.animation_tick(0.0);
        next.animation_tick(50.0);
        let mid = next.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        let mut target = next.clone();
        target.finish_animation();
        let to = target.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        for k in 0..3 {
            let want = 0.5 * (full[k].rect[3] + to[k].rect[3]);
            assert!((mid[k].rect[3] - want).abs() < 1e-3, "bar {k}");
        }
    }

    #[test]
    fn background_tracks_stay_put_while_the_bars_grow() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut chart = bars(vec![10.0, 20.0, -5.0], &mut scene);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        assert!(chart.set_bar_background(Some([0.5, 0.5, 0.5, 0.2])));
        chart.arm_animation(opts(), None);
        chart.animation_tick(0.0);
        chart.animation_tick(50.0);
        let half = chart.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        let mut done = chart.clone();
        done.finish_animation();
        let full = done.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert_eq!(half.len(), 6);
        assert_eq!(half[..3], full[..3], "tracks at full length");
        // The bars grow from the zero line (not from the track bottom)
        let zero = full[3].rect[1];
        for (h, f) in half[3..].iter().zip(&full[3..]) {
            assert!(((h.rect[3] - h.rect[1]) - 0.5 * (f.rect[3] - f.rect[1])).abs() < 1e-4);
        }
        assert!((half[5].rect[3] - zero).abs() < 1e-4, "negative bar grows down from zero");
    }

    #[test]
    fn another_shape_or_kind_enters_instead_of_tweening() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut a = bars(vec![1.0, 2.0], &mut scene);
        a.frame_camera(&mut cam, (1600.0, 900.0));
        a.arm_animation(opts(), None);
        a.finish_animation();
        a.prepare_layers(&view(&cam));
        let snap = a.anim_snapshot();
        let mut b = bars(vec![1.0, 2.0, 3.0], &mut scene);
        b.arm_animation(opts(), snap.clone());
        b.animation_tick(0.0);
        let first = b.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert!(first.iter().all(|r| (r.rect[3] - r.rect[1]).abs() < 1e-6), "grows from zero height");
        // A line after bars: enter (reveal), not a tween
        let mut l = line(vec![1.0, 2.0, 3.0]);
        l.frame_camera(&mut cam, (1600.0, 900.0));
        l.arm_animation(opts(), snap);
        l.animation_tick(0.0);
        assert!(l.prepare_layers(&view(&cam)).series_clip.is_some());
    }

    #[test]
    fn bar_layers_with_other_track_counts_enter_instead_of_pairing_tracks_with_bars() {
        // 3 tracks + 3 bars, then 6 bars without tracks: same instance count, other content
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut a = bars(vec![1.0, 2.0, 3.0], &mut scene);
        a.frame_camera(&mut cam, (1600.0, 900.0));
        assert!(a.set_bar_background(Some([0.5, 0.5, 0.5, 0.2])));
        a.arm_animation(opts(), None);
        a.finish_animation();
        assert_eq!(a.prepare_layers(&view(&cam)).bars.unwrap().len(), 6);
        let snap = a.anim_snapshot();
        let mut b = bars(vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0], &mut scene);
        b.arm_animation(opts(), snap);
        b.animation_tick(0.0);
        let first = b.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert_eq!(first.len(), 6);
        assert!(first.iter().all(|r| (r.rect[3] - r.rect[1]).abs() < 1e-6), "enters (grows from zero), no tween from the tracks");
    }

    #[test]
    fn too_many_marks_skip_the_animation() {
        let mut cam = flat_camera();
        let n = MAX_ANIMATED_MARKS + 10;
        let xs: Vec<f32> = (0..n).map(|i| (i % 1000) as f32).collect();
        let ys: Vec<f32> = (0..n).map(|i| (i / 1000) as f32).collect();
        let mut chart = ChartState::new_scatter(
            ScatterPoints { xs, ys, ..Default::default() },
            ScatterLayout { width: 160.0, height: 80.0, ..Default::default() },
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.arm_animation(opts(), None);
        assert!(chart.animation_tick(0.0));
        let layers = chart.prepare_layers(&view(&cam));
        assert_eq!(layers.points.unwrap().len(), n, "full points, not animated copies");
        assert!(!chart.is_animating());
        assert!(chart.anim_snapshot().is_none());
    }

    #[test]
    fn scatter_points_pop_in() {
        let mut cam = flat_camera();
        let mut chart = ChartState::new_scatter(
            ScatterPoints { xs: vec![0.0, 1.0], ys: vec![0.0, 1.0], ..Default::default() },
            ScatterLayout { width: 160.0, height: 80.0, ..Default::default() },
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let full = chart.prepare_layers(&view(&cam)).points.unwrap().to_vec();
        chart.arm_animation(opts(), None);
        chart.animation_tick(0.0);
        chart.animation_tick(50.0);
        let half = chart.prepare_layers(&view(&cam)).points.unwrap().to_vec();
        assert!((half[0].center_radius[3] - 0.5 * full[0].center_radius[3]).abs() < 1e-5);
        assert_eq!(half[0].center_radius[..2], full[0].center_radius[..2]);
        assert!(half[0].color[3] < full[0].color[3]);
    }

    #[test]
    fn pie_update_tweens_slice_angles() {
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        let mut a = ChartState::new_pie(&[1.0, 1.0], PieOptions::default(), PieStyle::default());
        a.frame_camera(&mut cam, (1600.0, 900.0));
        a.arm_animation(opts(), None);
        a.finish_animation();
        a.prepare_layers(&view(&cam));
        let snap = a.anim_snapshot().unwrap();
        let mut b = ChartState::new_pie(&[3.0, 1.0], PieOptions::default(), PieStyle::default());
        b.frame_camera(&mut cam, (1600.0, 900.0));
        b.arm_animation(opts(), Some(snap));
        b.animation_tick(0.0);
        b.prepare_layers(&view(&cam)); // first frame builds the slices
        b.animation_tick(50.0);
        let fills = b.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
        assert!(!fills.is_empty());
        // Angles halfway: slice 0 spans (pi + 1.5 pi) / 2 = 1.25 pi; its triangles carry color 0
        let c0 = fills[0].color;
        let ChartKind::Pie(p) = &b.kind else { unreachable!() };
        assert_eq!(p.angles()[0], (0.0, 1.5 * std::f32::consts::PI));
        let max_angle = fills
            .iter()
            .filter(|f| f.color == c0)
            .map(|f| {
                let a = f.position[0].atan2(f.position[1]);
                if a < -1e-3 { a + std::f32::consts::TAU } else { a }
            })
            .fold(0.0f32, f32::max);
        assert!((max_angle - 1.25 * std::f32::consts::PI).abs() < 0.05, "{max_angle}");
    }
}
