//! Radar (spider) chart: radial scale, polygons, grid, hover and label anchors, all in Rust.
//!
//! `N` axes (categories) run clockwise from the start angle around a circle of world radius
//! `RADAR_RADIUS`; every series is a closed polygon through its values on a shared nice radial
//! scale `[0, max]` (or a per-axis max), drawn as a translucent fill (triangle fan from the
//! center: the polygon is star-shaped around it, so the fan never overlaps itself), a stroke
//! (capsule segments: round joins) and vertex markers with a surface ring. Strokes and markers
//! are CSS-px sized on the GPU, so the marks are only rebuilt on data / visibility / emphasis /
//! color changes; the circular grid (if any) follows the on-screen radius like pie arcs.
//!
//! Hover picks the axis nearest to the pointer angle and reports every visible series there
//! (primary = the vertex closest to the pointer); the overlay highlights that spoke and its
//! vertices. Axis and ring labels are DOM text placed at anchors exported from here.

use super::line::DIMMED_SERIES_ALPHA;
use super::pie::{arc_segments, polar, PieScreen};
use super::*;
use std::f32::consts::TAU;

/// World radius of the outer ring (the camera framing scales it to the plot).
pub(crate) const RADAR_RADIUS: f32 = 50.0;
/// Default polygon fill opacity.
pub const DEFAULT_RADAR_FILL_OPACITY: f32 = 0.2;
/// Ring value labels sit this far inside their ring (CSS px), centered on the spoke bisector.
const RING_LABEL_INSET_PX: f32 = 7.0;

/// Axis label anchor distance beyond the outer ring (CSS px).
const AXIS_LABEL_GAP_PX: f32 = 10.0;
/// Hover reaches this far beyond the outer ring (CSS px).
const HOVER_SLACK_PX: f32 = 24.0;
/// Depth of strokes / markers over the fills, hover spoke under the markers.
const STROKE_Z: f32 = 0.02;

/// Shape of the concentric grid.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum RadarGridShape {
    /// Straight segments between the axes (spider web)
    #[default]
    Polygon,
    Circle,
}

impl RadarGridShape {
    /// 0 = polygon, 1 = circle
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Circle
        } else {
            Self::Polygon
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RadarOptions {
    /// Shared radial max (`None` = nice max of the data)
    pub max: Option<f64>,
    /// Per-axis max (missing / non-finite / <= 0 = the shared max)
    pub axis_max: Vec<f64>,
    /// Target ring count (nice ticks; default 4)
    pub rings: u32,
    pub fill_opacity: f32,
    /// Polygon stroke width (CSS px)
    pub stroke_px: f32,
    /// Vertex marker radius (CSS px; 0 = none)
    pub marker_radius_px: f32,
    /// First axis, degrees clockwise from 12 o'clock
    pub start_angle_deg: f32,
    pub grid: RadarGridShape,
    /// CSS px reserved beside (`[0]`, each side) and above / below (`[1]`) the outer ring for axis
    /// labels
    pub label_space_px: [f32; 2],
}

impl Default for RadarOptions {
    fn default() -> Self {
        Self {
            max: None,
            axis_max: Vec::new(),
            rings: 4,
            fill_opacity: DEFAULT_RADAR_FILL_OPACITY,
            stroke_px: 2.0,
            marker_radius_px: 3.5,
            start_angle_deg: 0.0,
            grid: RadarGridShape::Polygon,
            label_space_px: [0.0, 0.0],
        }
    }
}

/// DOM label anchor (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RadarLabel {
    /// 0 = axis name (`index` = axis), 1 = ring value (`index` = ring, `value` = its value)
    pub kind: u8,
    pub index: u32,
    pub value: f64,
    pub x_css: f32,
    pub y_css: f32,
    /// Horizontal alignment of the text at the anchor: -1 = ends there, 0 = centered, 1 = starts there
    pub h_align: i8,
    /// Vertical: -1 = text above the anchor, 0 = centered, 1 = below
    pub v_align: i8,
}

/// Screen layout of the radar (DOM overlays).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RadarLayoutInfo {
    pub center_css: (f32, f32),
    pub r_css: f32,
    /// Hovered axis
    pub hovered: Option<usize>,
}

/// Values flat `[series * axes + axis]`: finite and >= 0, or NaN (missing); at least 3 axes.
pub fn validate_radar(axes: usize, series: usize, values: &[f64]) -> Result<(), String> {
    if axes < 3 {
        return Err(format!("radar charts need at least 3 axes (got {axes})"));
    }
    if values.len() != axes * series {
        return Err(format!("radar values: expected {} ({series} series x {axes} axes), got {}", axes * series, values.len()));
    }
    match values.iter().position(|v| v.is_infinite() || *v < 0.0) {
        Some(i) => Err(format!(
            "radar series {} axis {} is {} (values must be finite and >= 0, or NaN for missing)",
            i / axes,
            i % axes,
            values[i]
        )),
        None => Ok(()),
    }
}

/// Shared radial domain: `(max, ring step)`. A fixed `max` keeps its value; the rings step
/// through it at a nice step (the last ring is the max).
pub(crate) fn radar_scale(values: &[f64], max: Option<f64>, rings: u32) -> (f64, f64) {
    let target = rings.clamp(1, 12);
    match max.filter(|m| m.is_finite() && *m > 0.0) {
        Some(m) => (m, nice_step(m, target)),
        None => {
            let hi = values.iter().copied().filter(|v| v.is_finite()).fold(0.0f64, f64::max);
            if hi <= 0.0 {
                return (1.0, nice_step(1.0, target));
            }
            let (_, top, step) = nice_domain(0.0, hi, target);
            (top.max(hi), step)
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct RadarChart {
    pub(crate) opts: RadarOptions,
    pub(crate) axes: usize,
    pub(crate) series: usize,
    values: Vec<f64>,
    colors: Vec<[f32; 4]>,
    pub(crate) visible: Vec<bool>,
    pub(crate) emphasis: Option<usize>,
    /// Shared max / ring step and the max of every axis
    pub(crate) max: f64,
    pub(crate) step: f64,
    pub(crate) axis_max: Vec<f64>,
    /// Ring values on the shared scale (ascending, the last is `max`)
    pub(crate) rings: Vec<f64>,
    pub(crate) screen: Option<PieScreen>,
    /// Scale (world per CSS px) the circular grid was built for
    grid_built: Option<f32>,
    labels: Vec<RadarLabel>,
    labels_scratch: Vec<RadarLabel>,
    labels_key: Option<([f32; 19], ChartPadding)>,
    labels_revision: u32,
}

impl RadarChart {
    /// Builds a radar from validated values (see `validate_radar`).
    pub(crate) fn new(axes: usize, series: usize, values: Vec<f64>, colors: Vec<[f32; 4]>, mut opts: RadarOptions) -> Self {
        let d = RadarOptions::default();
        let clean = |v: f32, d: f32| if v.is_finite() { v } else { d };
        opts.fill_opacity = clean(opts.fill_opacity, d.fill_opacity).clamp(0.0, 1.0);
        opts.stroke_px = clean(opts.stroke_px, d.stroke_px).max(0.0);
        opts.marker_radius_px = clean(opts.marker_radius_px, d.marker_radius_px).max(0.0);
        opts.start_angle_deg = clean(opts.start_angle_deg, 0.0);
        opts.label_space_px = opts.label_space_px.map(|v| clean(v, 0.0).clamp(0.0, 2048.0));
        if opts.rings == 0 {
            opts.rings = d.rings;
        }
        let (max, step) = radar_scale(&values, opts.max, opts.rings);
        let axis_max = (0..axes)
            .map(|k| opts.axis_max.get(k).copied().filter(|m| m.is_finite() && *m > 0.0).unwrap_or(max))
            .collect();
        let mut rings: Vec<f64> = ticks_between(0.0, max, step).into_iter().filter(|&v| v > 0.0 && v < max * (1.0 - 1e-9)).collect();
        rings.push(max);
        Self {
            opts,
            axes,
            series,
            values,
            colors,
            visible: vec![true; series],
            emphasis: None,
            max,
            step,
            axis_max,
            rings,
            screen: None,
            grid_built: None,
            labels: Vec::new(),
            labels_scratch: Vec::new(),
            labels_key: None,
            labels_revision: 0,
        }
    }

    /// Every axis uses the shared scale (ring labels are meaningful).
    pub(crate) fn shared_scale(&self) -> bool {
        self.axis_max.iter().all(|&m| m == self.max)
    }

    pub(crate) fn value(&self, s: usize, k: usize) -> f64 {
        self.values.get(s * self.axes + k).copied().unwrap_or(f64::NAN)
    }

    /// Compass angle (radians clockwise from 12 o'clock) of axis `k`.
    pub(crate) fn angle(&self, k: usize) -> f32 {
        self.opts.start_angle_deg.to_radians() + TAU * k as f32 / self.axes as f32
    }

    /// World radius of value `v` on axis `k` (clamped to the outer ring; NaN = missing).
    fn radius(&self, k: usize, v: f64) -> Option<f32> {
        v.is_finite().then(|| ((v / self.axis_max[k]).clamp(0.0, 1.0) as f32) * RADAR_RADIUS)
    }

    /// World vertex of series `s` at axis `k` (missing values sit at the center).
    pub(crate) fn vertex(&self, s: usize, k: usize) -> (f32, f32) {
        polar((0.0, 0.0), self.angle(k), self.radius(k, self.value(s, k)).unwrap_or(0.0))
    }

    pub(crate) fn set_colors(&mut self, colors: Vec<[f32; 4]>) {
        self.colors = colors;
    }

    fn color(&self, s: usize) -> [f32; 4] {
        let mut c = self.colors.get(s).or(self.colors.last()).copied().unwrap_or([0.224, 0.529, 0.898, 1.0]);
        if self.emphasis.is_some_and(|e| e != s) {
            c[3] *= DIMMED_SERIES_ALPHA;
        }
        c
    }

    /// `(series, axis, value, world point)` of `global_id = series * axes + axis`. The point of a
    /// vertex at the center moves out along its axis so keyboard focus hovers the right axis.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let g = global_id as usize;
        let (s, k) = (g / self.axes, g % self.axes);
        if s >= self.series {
            return None;
        }
        let v = self.value(s, k);
        let r = self.radius(k, v).unwrap_or(0.0).max(0.08 * RADAR_RADIUS);
        let (x, y) = polar((0.0, 0.0), self.angle(k), r);
        Some((s as u32, k as u32, v as f32, Vec3::new(x, y, 0.0)))
    }

    /// Axis nearest to the pointer angle and the visible series with a value there; `None`
    /// beyond the outer ring (plus slack).
    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let p = ray_hit_z_plane(&ray, 0.0)?;
        let wpp = PieChart::screen_of(view)?.wpp;
        let r = p.x.hypot(p.y);
        if r > RADAR_RADIUS + HOVER_SLACK_PX * wpp {
            return None;
        }
        let step = TAU / self.axes as f32;
        let a = (p.x.atan2(p.y) - self.opts.start_angle_deg.to_radians()).rem_euclid(TAU);
        let k = ((a / step).round() as usize) % self.axes;
        let mut items = Vec::new();
        let (mut primary, mut best) = (0, f32::INFINITY);
        for s in (0..self.series).filter(|&s| self.visible[s]) {
            let v = self.value(s, k);
            if !v.is_finite() {
                continue;
            }
            let (x, y) = self.vertex(s, k);
            let d = (x - p.x).hypot(y - p.y);
            if d < best {
                best = d;
                primary = items.len();
            }
            items.push(HoverItem { series: s as u32, index: k as u32, value: v as f32, global_id: (s * self.axes + k) as u32 });
        }
        (!items.is_empty()).then_some(HoverResult { is_bar: false, primary, items })
    }

    /// Fills (fan from the center), strokes and vertex markers of the visible series; hidden
    /// series are skipped, the emphasized one is drawn last (on top).
    pub(crate) fn build_marks(
        &self,
        ring: [f32; 4],
        fills: &mut Vec<ChartFillRaw>,
        strokes: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        fills.clear();
        strokes.clear();
        markers.clear();
        let mut order: Vec<usize> = (0..self.series).filter(|&s| self.visible[s]).collect();
        if let Some(e) = self.emphasis {
            if let Some(pos) = order.iter().position(|&s| s == e) {
                let e = order.remove(pos);
                order.push(e);
            }
        }
        for s in order {
            let c = self.color(s);
            let fill = [c[0], c[1], c[2], c[3] * self.opts.fill_opacity];
            let pts: Vec<(f32, f32)> = (0..self.axes).map(|k| self.vertex(s, k)).collect();
            let v = |p: (f32, f32)| ChartFillRaw { position: [p.0, p.1, 0.0, 0.0], color: fill };
            for k in 0..self.axes {
                let (a, b) = (pts[k], pts[(k + 1) % self.axes]);
                if fill[3] > 0.0 {
                    fills.extend([v((0.0, 0.0)), v(a), v(b)]);
                }
                if self.opts.stroke_px > 0.0 {
                    strokes.push(ChartSegmentRaw {
                        p0_width: [a.0, a.1, STROKE_Z, self.opts.stroke_px],
                        p1_pad: [b.0, b.1, STROKE_Z, 0.0],
                        color: c,
                    });
                }
            }
            if self.opts.marker_radius_px > 0.0 {
                let mut ring = ring;
                ring[3] *= c[3];
                for (k, p) in pts.iter().enumerate() {
                    if self.value(s, k).is_finite() {
                        markers.push(ChartMarkerRaw {
                            center_radius: [p.0, p.1, STROKE_Z, self.opts.marker_radius_px],
                            fill: c,
                            ring,
                            params: [1.5, 0.0, 0.0, 0.0],
                        });
                    }
                }
            }
        }
    }

    /// Rings (grid color; the outer ring in the baseline color) and spokes. Circular rings use
    /// `arc_segments` at the on-screen radius (`wpp` = world per CSS px).
    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, wpp: f32, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if !style.show_grid {
            return;
        }
        let w = style.stroke_px;
        let mut seg = |a: (f32, f32), b: (f32, f32), color: [f32; 4]| {
            out.push(ChartSegmentRaw { p0_width: [a.0, a.1, -0.5, w], p1_pad: [b.0, b.1, -0.5, 0.0], color });
        };
        for k in 0..self.axes {
            seg((0.0, 0.0), polar((0.0, 0.0), self.angle(k), RADAR_RADIUS), style.grid_color);
        }
        for (j, &v) in self.rings.iter().enumerate() {
            let r = (v / self.max) as f32 * RADAR_RADIUS;
            let color = if j + 1 == self.rings.len() { style.baseline_color } else { style.grid_color };
            match self.opts.grid {
                RadarGridShape::Polygon => {
                    for k in 0..self.axes {
                        seg(polar((0.0, 0.0), self.angle(k), r), polar((0.0, 0.0), self.angle(k + 1), r), color);
                    }
                }
                RadarGridShape::Circle => {
                    let n = arc_segments(TAU, r / wpp.max(1e-6)).max(12);
                    let a0 = self.angle(0);
                    for i in 0..n {
                        let (t0, t1) = (a0 + TAU * i as f32 / n as f32, a0 + TAU * (i + 1) as f32 / n as f32);
                        seg(polar((0.0, 0.0), t0, r), polar((0.0, 0.0), t1, r), color);
                    }
                }
            }
        }
    }

    /// Hovered spoke (crosshair style) and enlarged vertex markers of the hovered axis.
    pub(crate) fn build_overlay(&self, hover: &HoverResult, style: &ChartHoverStyle, lines: &mut Vec<ChartSegmentRaw>, markers: &mut Vec<ChartMarkerRaw>) {
        lines.clear();
        markers.clear();
        let Some(first) = hover.items.first() else { return };
        let k = first.index as usize;
        if style.crosshair {
            let e = polar((0.0, 0.0), self.angle(k), RADAR_RADIUS);
            lines.push(ChartSegmentRaw {
                p0_width: [0.0, 0.0, 0.0, style.crosshair_width_px],
                p1_pad: [e.0, e.1, 0.0, 0.0],
                color: style.crosshair_color,
            });
        }
        if style.marker {
            for it in &hover.items {
                let (x, y) = self.vertex(it.series as usize, k);
                markers.push(ChartMarkerRaw {
                    center_radius: [x, y, 0.0, style.marker_radius_px.max(self.opts.marker_radius_px + 1.0)],
                    fill: self.color(it.series as usize),
                    ring: style.marker_ring_color,
                    params: [style.marker_ring_px, 0.0, 0.0, 0.0],
                });
            }
        }
    }

    /// Axis name anchors beyond the outer ring and ring value anchors between the first two
    /// spokes (data vertices only sit on spokes, so the values never collide with markers).
    fn layout_labels(&mut self, screen: PieScreen) -> bool {
        let mut out = std::mem::take(&mut self.labels_scratch);
        out.clear();
        let (cx, cy) = screen.center_css;
        let r = screen.r_css;
        // CSS direction (y down) of a compass angle
        let dir = |phi: f32| (phi.sin(), -phi.cos());
        let align = |c: f32| if c > 0.3 { 1 } else if c < -0.3 { -1 } else { 0 };
        for k in 0..self.axes {
            let d = dir(self.angle(k));
            let rr = r + AXIS_LABEL_GAP_PX;
            out.push(RadarLabel {
                kind: 0,
                index: k as u32,
                value: f64::NAN,
                x_css: cx + d.0 * rr,
                y_css: cy + d.1 * rr,
                h_align: align(d.0),
                v_align: align(d.1),
            });
        }
        if self.shared_scale() {
            // Ring values on the bisector of the first two spokes, just inside each ring (a
            // polygon ring is closer to the center there), centered: clear of the spokes, the
            // data vertices on them and the axis names beyond the outer ring
            let half = std::f32::consts::PI / self.axes.max(3) as f32;
            let d = dir(self.angle(0) + half);
            let ring_at_bisector = match self.opts.grid {
                RadarGridShape::Polygon => half.cos(),
                RadarGridShape::Circle => 1.0,
            };
            for (j, &v) in self.rings.iter().enumerate() {
                let rr = ((v / self.max) as f32 * r * ring_at_bisector - RING_LABEL_INSET_PX).max(0.0);
                out.push(RadarLabel {
                    kind: 1,
                    index: j as u32,
                    value: v,
                    x_css: cx + d.0 * rr,
                    y_css: cy + d.1 * rr,
                    h_align: 0,
                    v_align: 0,
                });
            }
        }
        let changed = out != self.labels;
        if changed {
            self.labels_revision = self.labels_revision.wrapping_add(1);
            std::mem::swap(&mut self.labels, &mut out);
        }
        self.labels_scratch = out;
        changed
    }

    /// Plot rectangle = the outer ring's bounding box; no axis ticks (labels are radar labels).
    pub(crate) fn axes(&self, view: &ChartView, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = match PieChart::screen_of(view) {
            Some(s) => [s.center_css.0 - s.r_css, s.center_css.1 - s.r_css, 2.0 * s.r_css, 2.0 * s.r_css],
            None => [0.0; 4],
        };
    }

    /// Fits the outer ring into the padded plot with room for the axis labels and markers.
    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        let m = self.opts.marker_radius_px + 4.0;
        let [sh, sv] = self.opts.label_space_px;
        let pad = [padding[0] + m + sv, padding[1] + m + sh, padding[2] + m + sv, padding[3] + m + sh];
        frame_flat(camera, css, 2.0 * RADAR_RADIUS, 2.0 * RADAR_RADIUS, &pad);
    }

    pub(crate) fn set_visible(&mut self, s: usize, visible: bool) -> bool {
        match self.visible.get_mut(s) {
            Some(v) if *v != visible => {
                *v = visible;
                true
            }
            _ => false,
        }
    }

    pub(crate) fn set_emphasis(&mut self, s: Option<usize>) -> bool {
        let s = s.filter(|&s| s < self.series);
        let changed = self.emphasis != s;
        self.emphasis = s;
        changed
    }
}

impl ChartState {
    /// Creates a radar chart from validated values (see `validate_radar`); `colors` one per series.
    pub fn new_radar(axes: usize, series: usize, values: Vec<f64>, colors: Vec<[f32; 4]>, opts: RadarOptions) -> Self {
        Self::with_kind(ChartKind::Radar(RadarChart::new(axes, series, values, colors, opts)))
    }

    /// Series colors of the radar (theme change); rebuilds the marks.
    pub fn set_radar_colors(&mut self, colors: Vec<[f32; 4]>) {
        if let ChartKind::Radar(r) = &mut self.kind {
            r.set_colors(colors);
            self.dirty.series = true;
            self.dirty.fills = true;
            self.dirty.overlay = true;
        }
    }

    /// `(shared max, ring step, per-axis max, ring values)` of the radar.
    pub fn radar_scale(&self) -> Option<(f64, f64, &[f64], &[f64])> {
        match &self.kind {
            ChartKind::Radar(r) => Some((r.max, r.step, &r.axis_max, &r.rings)),
            _ => None,
        }
    }

    /// Label anchors of the last prepared frame and their revision.
    pub fn radar_labels(&self) -> Option<(&[RadarLabel], u32)> {
        match &self.kind {
            ChartKind::Radar(r) => Some((&r.labels, r.labels_revision)),
            _ => None,
        }
    }

    pub fn radar_layout(&self) -> Option<RadarLayoutInfo> {
        let ChartKind::Radar(r) = &self.kind else { return None };
        let s = r.screen?;
        Some(RadarLayoutInfo {
            center_css: s.center_css,
            r_css: s.r_css,
            hovered: self.hover.as_ref().and_then(|h| h.items.first()).map(|i| i.index as usize),
        })
    }

    /// Radar part of `prepare_layers`: marks on data / style changes, grid / overlay / labels as
    /// needed.
    pub(crate) fn prepare_radar(&mut self, view: &ChartView) {
        let ChartKind::Radar(r) = &mut self.kind else { return };
        let Some(screen) = PieChart::screen_of(view) else { return };
        r.screen = Some(screen);
        if self.dirty.series || self.dirty.fills {
            r.build_marks(self.hover_style.marker_ring_color, &mut self.fills, &mut self.series, &mut self.styled.markers);
            self.styled.dashed.clear();
            self.dirty.series = true;
            self.dirty.fills = true;
        }
        let circle_stale = r.opts.grid == RadarGridShape::Circle
            && r.grid_built.is_none_or(|w| ((w - screen.wpp) / screen.wpp).abs() > 1e-3);
        if self.dirty.underlay || circle_stale {
            r.build_grid(&self.frame_style, screen.wpp, &mut self.underlay);
            r.grid_built = Some(screen.wpp);
            self.dirty.underlay = true;
        }
        if self.dirty.overlay {
            match &self.hover {
                Some(h) => r.build_overlay(h, &self.hover_style, &mut self.overlay, &mut self.markers),
                None => {
                    self.overlay.clear();
                    self.markers.clear();
                }
            }
        }
        let key = (view.key(), self.padding);
        if r.labels_key != Some(key) {
            r.layout_labels(screen);
            r.labels_key = Some(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn radar(axes: usize, values: Vec<Vec<f64>>, opts: RadarOptions) -> (ChartState, OrbitCamera) {
        let series = values.len();
        let flat: Vec<f64> = values.into_iter().flatten().collect();
        validate_radar(axes, series, &flat).unwrap();
        let colors = (0..series).map(|s| [s as f32 * 0.3, 0.5, 0.8, 1.0]).collect();
        let chart = ChartState::new_radar(axes, series, flat, colors, opts);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(c: &ChartState) -> &RadarChart {
        match &c.kind {
            ChartKind::Radar(r) => r,
            _ => unreachable!(),
        }
    }

    fn ndc_at(cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let n = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        (n.x, n.y)
    }

    #[test]
    fn validation_and_nice_shared_scale() {
        assert!(validate_radar(2, 1, &[1.0, 2.0]).is_err());
        assert!(validate_radar(3, 1, &[1.0, 2.0]).unwrap_err().contains("expected 3"));
        assert!(validate_radar(3, 1, &[1.0, -2.0, 0.0]).unwrap_err().contains("axis 1"));
        assert!(validate_radar(3, 1, &[1.0, f64::NAN, 0.0]).is_ok());
        // Data max 87 with 4 rings: nice top 100, step 20 or 25
        let (max, step) = radar_scale(&[10.0, 87.0, f64::NAN], None, 4);
        assert_eq!(max, 100.0);
        assert!(step == 20.0 || step == 25.0);
        // Fixed max is kept exactly
        assert_eq!(radar_scale(&[10.0], Some(7.5), 4).0, 7.5);
        let (c, _) = radar(5, vec![vec![10.0, 87.0, 40.0, 0.0, 55.0]], RadarOptions::default());
        let r = inner(&c);
        assert_eq!(*r.rings.last().unwrap(), 100.0);
        assert!(r.rings.windows(2).all(|w| w[1] > w[0]) && r.rings[0] > 0.0);
        assert!(r.shared_scale());
    }

    #[test]
    fn vertices_follow_values_on_their_axes_and_per_axis_max() {
        let opts = RadarOptions { max: Some(100.0), axis_max: vec![f64::NAN, 50.0], ..Default::default() };
        let (c, _) = radar(4, vec![vec![100.0, 25.0, 50.0, f64::NAN]], opts);
        let r = inner(&c);
        assert!(!r.shared_scale());
        // Axis 0 points up, axis 1 right (clockwise), axis 2 down
        let v0 = r.vertex(0, 0);
        assert!(v0.0.abs() < 1e-4 && (v0.1 - RADAR_RADIUS).abs() < 1e-4);
        let v1 = r.vertex(0, 1);
        assert!((v1.0 - 0.5 * RADAR_RADIUS).abs() < 1e-3 && v1.1.abs() < 1e-3, "25 of axis max 50: {v1:?}");
        let v2 = r.vertex(0, 2);
        assert!((v2.1 + 0.5 * RADAR_RADIUS).abs() < 1e-3);
        // Missing value: the polygon passes through the center, no marker there
        assert_eq!(r.vertex(0, 3), (0.0, 0.0));
        let (mut f, mut s, mut m) = (Vec::new(), Vec::new(), Vec::new());
        r.build_marks(CHART_SURFACE, &mut f, &mut s, &mut m);
        assert_eq!((f.len(), s.len(), m.len()), (12, 4, 3));
        assert!(f.iter().all(|v| (v.color[3] - DEFAULT_RADAR_FILL_OPACITY).abs() < 1e-6));
        // Values beyond the max clamp to the outer ring
        let (c, _) = radar(3, vec![vec![500.0, 1.0, 1.0]], RadarOptions { max: Some(10.0), ..Default::default() });
        assert!((inner(&c).vertex(0, 0).1 - RADAR_RADIUS).abs() < 1e-4);
    }

    #[test]
    fn hover_reports_every_visible_series_at_the_nearest_axis() {
        let (mut c, cam) = radar(4, vec![vec![80.0, 40.0, 60.0, 20.0], vec![30.0, 90.0, f64::NAN, 50.0]], RadarOptions { max: Some(100.0), ..Default::default() });
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.prepare_layers(&v);
        // Pointer near axis 1 (right), closest to series 1's vertex (radius 45)
        let hit = c.hover_at(&v, &mut scene, ndc_at(&cam, 44.0, 3.0)).unwrap();
        assert_eq!(hit.items.iter().map(|i| (i.series, i.index)).collect::<Vec<_>>(), vec![(0, 1), (1, 1)]);
        assert_eq!(hit.items[hit.primary].series, 1);
        assert_eq!(hit.items[1].global_id, 5);
        // Axis 2 (down): series 1 is missing there
        let hit = c.hover_at(&v, &mut scene, ndc_at(&cam, 2.0, -20.0)).unwrap();
        assert_eq!(hit.items.len(), 1);
        // Overlay: spoke + one marker per item
        let layers = c.prepare_layers(&v);
        assert_eq!(layers.overlay.unwrap().len(), 1);
        assert_eq!(layers.markers.unwrap().len(), 1);
        // Far outside: nothing
        assert!(c.hover_at(&v, &mut scene, ndc_at(&cam, 90.0, 0.0)).is_none());
        // Hidden series drop out of the hover
        c.set_series_visible(1, false, &mut scene);
        let hit = c.hover_at(&v, &mut scene, ndc_at(&cam, 44.0, 3.0)).unwrap();
        assert_eq!(hit.items.len(), 1);
        // Keyboard: every sample point hovers its own axis (a zero value sits on its axis too)
        let (mut z, cam) = radar(3, vec![vec![0.0, 5.0, 10.0]], RadarOptions::default());
        let v = view(&cam);
        z.prepare_layers(&v);
        for k in 0..3u32 {
            let p = z.sample(k).unwrap().3;
            assert_eq!(z.hover_at(&v, &mut scene, ndc_at(&cam, p.x, p.y)).unwrap().items[0].index, k);
        }
    }

    #[test]
    fn grid_rings_spokes_and_labels() {
        let (mut c, cam) = radar(6, vec![vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]], RadarOptions { max: Some(6.0), rings: 3, ..Default::default() });
        let v = view(&cam);
        let layers = c.prepare_layers(&v);
        let (under, fills, series) = (layers.underlay.unwrap().len(), layers.fills.unwrap().len(), layers.series.unwrap().len());
        let rings = inner(&c).rings.len();
        assert_eq!(under, 6 + 6 * rings, "spokes + polygon rings");
        assert!(fills == 18 && series == 6);
        let (labels, rev) = c.radar_labels().unwrap();
        let axis: Vec<&RadarLabel> = labels.iter().filter(|l| l.kind == 0).collect();
        assert_eq!(axis.len(), 6);
        let lay = c.radar_layout().unwrap();
        // Axis 0 label above the top, centered; axis 1 (60 deg) to the right
        assert!(axis[0].y_css < lay.center_css.1 - lay.r_css && axis[0].h_align == 0 && axis[0].v_align == -1);
        assert_eq!(axis[1].h_align, 1);
        assert_eq!(labels.iter().filter(|l| l.kind == 1).count(), rings);
        // Ring values sit between spokes 0 and 1 (right of the top spoke), inside their ring
        for l in labels.iter().filter(|l| l.kind == 1) {
            let (dx, dy) = (l.x_css - lay.center_css.0, l.y_css - lay.center_css.1);
            assert!(dx > 1.0 && dy < -1.0, "{dx} {dy}");
            assert!(dx.hypot(dy) < lay.r_css * (l.value / 6.0) as f32);
        }
        // Same view: nothing rebuilt, same revision
        let again = c.prepare_layers(&v);
        assert!(again.fills.is_none() && again.underlay.is_none());
        assert_eq!(c.radar_labels().unwrap().1, rev);
        // Circle grid: segment count follows the on-screen radius
        let (mut circ, cam) = radar(3, vec![vec![1.0, 2.0, 3.0]], RadarOptions { grid: RadarGridShape::Circle, ..Default::default() });
        let n = circ.prepare_layers(&view(&cam)).underlay.unwrap().len();
        assert!(n > 3 + 24, "{n}");
        // Emphasis dims the other series
        let (mut two, cam) = radar(3, vec![vec![1.0, 2.0, 3.0], vec![3.0, 2.0, 1.0]], RadarOptions::default());
        two.prepare_layers(&view(&cam));
        two.set_emphasis(Some(1));
        let s = two.prepare_layers(&view(&cam)).series.unwrap().to_vec();
        assert!(s[..3].iter().all(|x| x.color[3] < 0.5) && s[3..].iter().all(|x| x.color[3] == 1.0), "emphasized last, others faded");
    }
}
