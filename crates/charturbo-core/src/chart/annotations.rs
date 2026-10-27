//! Chart annotations in data units: reference lines (hline / vline), bands (y / x ranges), point
//! markers, and text anchors (like ECharts markLine / markArea or Highcharts plotLines /
//! plotBands). Marks follow the zoom window, are clipped to the plot on the CPU, and are drawn
//! either beneath the series (with the gridlines) or above them (beneath hover overlays). Label
//! text lives in the DOM; the engine only reports one CSS-px anchor per annotation.

use super::scale::log_or_identity;
use super::*;
use crate::renderer::ChartAnnotationLayer;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnnotationKind {
    /// Horizontal line at `coords[0]` (y)
    HLine,
    /// Vertical line at `coords[0]` (x)
    VLine,
    /// Horizontal band between y `coords[0]` and `coords[1]` (±inf = plot edge)
    YBand,
    /// Vertical band between x `coords[0]` and `coords[1]` (±inf = plot edge)
    XBand,
    /// Marker at (`coords[0]`, `coords[1]`)
    Point,
    /// Label anchor only at (`coords[0]`, `coords[1]`)
    Text,
}

impl AnnotationKind {
    pub fn from_u8(v: u8) -> Option<Self> {
        Some(match v {
            0 => Self::HLine,
            1 => Self::VLine,
            2 => Self::YBand,
            3 => Self::XBand,
            4 => Self::Point,
            5 => Self::Text,
            _ => return None,
        })
    }

    /// Stroke width (lines, band borders) or marker radius (points) in CSS px.
    pub fn default_width(self) -> f32 {
        match self {
            Self::HLine | Self::VLine => 1.5,
            Self::Point => 5.0,
            Self::YBand | Self::XBand | Self::Text => 0.0,
        }
    }

    /// Multiplier of the color alpha (bands are translucent by default).
    pub fn default_opacity(self) -> f32 {
        match self {
            Self::YBand | Self::XBand => 0.18,
            _ => 1.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AnnotationLayer {
    /// With the gridlines: beneath bars, area fills and series strokes
    #[default]
    Below,
    /// Over the series and points, beneath the hover crosshair / markers
    Above,
}

impl AnnotationLayer {
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Above
        } else {
            Self::Below
        }
    }
}

/// Where the label anchor sits along a line / band: start = left / bottom, end = right / top.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum LabelPosition {
    Start,
    #[default]
    End,
    Center,
}

impl LabelPosition {
    pub fn from_u8(v: u8) -> Self {
        match v {
            0 => Self::Start,
            2 => Self::Center,
            _ => Self::End,
        }
    }
}

/// One annotation. x is the sample index (line charts without x), the x value (line charts with
/// x, epoch ms for time axes; scatter), or the category index (bars, fractional allowed).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChartAnnotation {
    pub kind: AnnotationKind,
    /// hline `[y]`, vline `[x]`, bands `[from, to]`, point / text `[x, y]`; the rest is unused
    pub coords: [f64; 4],
    pub color: [f32; 4],
    /// Stroke width (lines, band borders; 0 = no border) or marker radius (points), CSS px
    pub width_px: f32,
    /// Dash length of lines / band borders in CSS px (0 = solid)
    pub dash_px: f32,
    /// Multiplier of the color alpha
    pub opacity: f32,
    pub layer: AnnotationLayer,
    pub label: LabelPosition,
    /// y axis of the y coordinates: 0 = left, 1 = right (dual-axis line charts)
    pub y_axis: u8,
}

impl ChartAnnotation {
    /// Annotation with the kind's default width / opacity, solid, below the series.
    pub fn new(kind: AnnotationKind, coords: [f64; 4], color: [f32; 4]) -> Self {
        Self {
            kind,
            coords,
            color,
            width_px: kind.default_width(),
            dash_px: 0.0,
            opacity: kind.default_opacity(),
            layer: AnnotationLayer::Below,
            label: LabelPosition::End,
            y_axis: 0,
        }
    }
}

/// Label anchor of annotation `id` (its index) in CSS px from the canvas top-left; `visible` is
/// false when the annotation is outside the visible data range (or the view is not 2D).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnnotationLabel {
    pub id: u32,
    pub x_css: f32,
    pub y_css: f32,
    pub visible: bool,
}

/// Affine data -> world map of one axis: `world = (u - origin) * scale + offset` with `u = v`, or
/// `log10(v)` on a log axis (f64 until the last step so epoch-ms x keeps its precision).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct AxisMap {
    origin: f64,
    scale: f64,
    offset: f64,
    log: bool,
}

impl AxisMap {
    /// Map sending `t` in `[0, 1]` of the data domain `[origin, origin + span]` through the zoom
    /// `window` onto `[-size / 2, size / 2]` (same as the chart kinds' own layout).
    pub(crate) fn windowed(origin: f64, span: f64, window: (f32, f32), size: f32) -> Self {
        let (w0, w1) = (window.0 as f64, window.1 as f64);
        let ws = (w1 - w0).max(1e-9);
        let size = size as f64;
        Self {
            origin,
            scale: if span > 0.0 { size / (span * ws) } else { 0.0 },
            offset: (-w0 / ws - 0.5) * size,
            log: false,
        }
    }

    /// `world = (v - origin) * scale + offset`.
    pub(crate) fn new(origin: f64, scale: f64, offset: f64) -> Self {
        Self { origin, scale, offset, log: false }
    }

    /// Same map through `log10` (`log`) and mirrored (`sign` -1 = reversed axis).
    fn scaled(self, log: bool, sign: f32) -> Self {
        let sign = sign as f64;
        Self { scale: self.scale * sign, offset: self.offset * sign, log, ..self }
    }

    #[inline]
    pub(crate) fn map(&self, v: f64) -> f32 {
        ((log_or_identity(self.log, v) - self.origin) * self.scale + self.offset) as f32
    }

    /// Data value at world coordinate `w` (inverse of `map`, back through `10^` on a log axis; a
    /// degenerate axis maps to `origin`).
    #[inline]
    pub(crate) fn unmap(&self, w: f32) -> f64 {
        let u = if self.scale == 0.0 { self.origin } else { (w as f64 - self.offset) / self.scale + self.origin };
        if self.log {
            10f64.powf(u)
        } else {
            u
        }
    }
}

/// Data -> world mapping and visible plot rectangle of the active 2D chart.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct DataFrame {
    pub(crate) x: AxisMap,
    pub(crate) y: AxisMap,
    /// Right y axis (dual-axis line charts; else same as `y`)
    pub(crate) y2: AxisMap,
    /// Visible plot `[x0, x1, y0, y1]` in world units
    pub(crate) bounds: [f32; 4],
    /// Plane of label anchors / hit-tests (front series plane)
    pub(crate) z: f32,
    /// Depth of below / above marks: between the grid and the series, and in front of them
    pub(crate) z_below: f32,
    pub(crate) z_above: f32,
}

fn line_frame(l: &LineChart) -> Option<DataFrame> {
    if l.layout.view != ChartViewMode::Flat {
        return None;
    }
    let (w, h) = (l.layout.width, l.layout.height);
    let x = if l.has_x() {
        AxisMap::windowed(l.x_min, l.x_span, l.window, w).scaled(l.x_log, l.x_scale.sign())
    } else {
        // Sample index of the longest series (the x tick values); one sample sits at the centre
        let len = l.max_len();
        if len > 1 {
            AxisMap::windowed(0.0, (len - 1) as f64, l.window, w)
        } else {
            let mut m = AxisMap::windowed(0.0, 1.0, l.window, w);
            m.offset += 0.5 * m.scale;
            m.scale = 0.0;
            m
        }
    };
    let x = if l.has_x() { x } else { x.scaled(false, l.x_scale.sign()) };
    let y_map = |min: f32, span: f32, scale: AxisScale| {
        AxisMap {
            origin: min as f64,
            scale: (h / span) as f64,
            offset: -0.5 * h as f64,
            log: false,
        }
        .scaled(scale.is_log(), scale.sign())
    };
    let y = y_map(l.y_min, l.y_span, l.y_scale);
    // Without right-axis series, right-axis annotations fall back to the left axis
    let y2 = if l.has_right() { y_map(l.right.y_min, l.right.y_span, l.right.scale) } else { y };
    let z0 = l.z.first().copied().unwrap_or(0.0);
    let (z_lo, z_hi) = l.z.iter().fold((z0, z0), |(a, b), &z| (a.min(z), b.max(z)));
    Some(DataFrame {
        x,
        y,
        y2,
        bounds: [-w * 0.5, w * 0.5, -h * 0.5, h * 0.5],
        z: z0,
        z_below: z_lo - 0.25,
        z_above: z_hi + 0.25,
    })
}

fn bar_frame(b: &BarChart) -> Option<DataFrame> {
    if b.layout.view != ChartViewMode::Flat || b.slots.is_empty() {
        return None;
    }
    let w = b.layout.width;
    let bounds = [-w * 0.5, w * 0.5, -b.layout.max_height * 0.5, b.layout.max_height * 0.5];
    if b.horizontal() {
        // Horizontal bars: x = value, y = category (category 0 at the top)
        let x = AxisMap { origin: 0.0, scale: b.scale as f64, offset: b.zero_y as f64, log: false };
        let y = AxisMap { origin: (b.slots.len() as f64 - 1.0) * 0.5, scale: -b.spacing as f64, offset: 0.0, log: false };
        return Some(DataFrame { x, y, y2: y, bounds, z: 0.0, z_below: -0.25, z_above: 0.25 });
    }
    let y = AxisMap {
        origin: 0.0,
        scale: b.scale as f64,
        offset: b.zero_y as f64,
        log: false,
    };
    Some(DataFrame {
        // Category i is centred in slot i; the plot spans categories -0.5 .. n - 0.5
        x: AxisMap {
            origin: (b.slots.len() as f64 - 1.0) * 0.5,
            scale: b.spacing as f64,
            offset: 0.0,
            log: false,
        },
        y,
        y2: y,
        bounds,
        z: 0.0,
        z_below: -0.25,
        z_above: 0.25,
    })
}

fn scatter_frame(s: &ScatterChart) -> Option<DataFrame> {
    let (w, h) = (s.layout.width, s.layout.height);
    let (x0, x1) = s.x_domain;
    let (y0, y1) = s.y_domain;
    let y = AxisMap::windowed(y0, y1 - y0, s.window_y, h).scaled(s.y_scale.is_log(), s.y_scale.sign());
    Some(DataFrame {
        x: AxisMap::windowed(x0, x1 - x0, s.window_x, w).scaled(s.x_scale.is_log(), s.x_scale.sign()),
        y,
        y2: y,
        bounds: [-w * 0.5, w * 0.5, -h * 0.5, h * 0.5],
        z: 0.0,
        z_below: -0.25,
        z_above: 0.25,
    })
}

/// Staged marks of one depth layer.
#[derive(Debug, Clone, Default)]
struct Marks {
    fills: Vec<ChartFillRaw>,
    lines: Vec<ChartSegmentRaw>,
    markers: Vec<ChartMarkerRaw>,
}

impl Marks {
    fn clear(&mut self) {
        self.fills.clear();
        self.lines.clear();
        self.markers.clear();
    }

    fn layer(&self) -> ChartAnnotationLayer<'_> {
        ChartAnnotationLayer {
            fills: &self.fills,
            lines: &self.lines,
            markers: &self.markers,
        }
    }
}

/// Annotation list, staged GPU marks and DOM label anchors of a chart.
#[derive(Debug, Clone, Default)]
pub(crate) struct Annotations {
    items: Vec<ChartAnnotation>,
    /// Engine-generated marks drawn after `items` (sparkline markers); no labels, no ids
    extra: Vec<ChartAnnotation>,
    below: Marks,
    above: Marks,
    /// Mapping + marker ring color the marks were built for (`None` = rebuild)
    marks_key: Option<(Option<DataFrame>, [f32; 4])>,
    labels: Vec<AnnotationLabel>,
    labels_scratch: Vec<AnnotationLabel>,
    labels_key: Option<([f32; 19], Option<DataFrame>)>,
    labels_revision: u32,
}

/// Visible part `[lo, hi]` of the data range `[a, b]` (either order) inside `[min, max]`.
fn clamp_range(a: f32, b: f32, min: f32, max: f32) -> Option<(f32, f32)> {
    if a.is_nan() || b.is_nan() {
        return None;
    }
    let (lo, hi) = (a.min(b).max(min), a.max(b).min(max));
    (hi > lo).then_some((lo, hi))
}

/// Inside `[min, max]` with a little slack so lines on the plot edges stay visible.
#[inline]
fn inside(v: f32, min: f32, max: f32) -> bool {
    let eps = (max - min).abs() * 1e-4;
    v >= min - eps && v <= max + eps
}

impl Annotations {
    pub(crate) fn set(&mut self, items: Vec<ChartAnnotation>) {
        self.items = items;
        self.marks_key = None;
        self.labels_key = None;
    }

    pub(crate) fn items(&self) -> &[ChartAnnotation] {
        &self.items
    }

    /// Replaces the engine-generated marks (rebuilt on the next `prepare` only when they differ).
    pub(crate) fn set_extra(&mut self, extra: Vec<ChartAnnotation>) {
        if extra != self.extra {
            self.extra = extra;
            self.marks_key = None;
        }
    }

    pub(crate) fn labels(&self) -> &[AnnotationLabel] {
        &self.labels
    }

    pub(crate) fn labels_revision(&self) -> u32 {
        self.labels_revision
    }

    /// Rebuilds stale marks / labels; returns true when the marks must be uploaded.
    pub(crate) fn prepare(&mut self, frame: Option<DataFrame>, view: &ChartView, ring: [f32; 4]) -> bool {
        let marks_key = (frame, ring);
        let upload = self.marks_key != Some(marks_key);
        if upload {
            self.below.clear();
            self.above.clear();
            if let Some(f) = &frame {
                for a in self.items.iter().chain(&self.extra) {
                    let out = match a.layer {
                        AnnotationLayer::Below => &mut self.below,
                        AnnotationLayer::Above => &mut self.above,
                    };
                    build_marks(a, f, ring, out);
                }
            }
            self.marks_key = Some(marks_key);
        }

        let labels_key = (view.key(), frame);
        if self.labels_key != Some(labels_key) {
            let mut labels = std::mem::take(&mut self.labels_scratch);
            labels.clear();
            labels.extend(self.items.iter().enumerate().map(|(i, a)| {
                let anchor = frame.and_then(|f| {
                    let (x, y) = label_anchor(a, &f)?;
                    view.project_css(Vec3::new(x, y, f.z))
                });
                AnnotationLabel {
                    id: i as u32,
                    x_css: anchor.map_or(0.0, |p| p.0),
                    y_css: anchor.map_or(0.0, |p| p.1),
                    visible: anchor.is_some(),
                }
            }));
            // Only tell the DOM to re-lay out when an anchor actually moved
            if labels != self.labels {
                self.labels_revision = self.labels_revision.wrapping_add(1);
                std::mem::swap(&mut self.labels, &mut labels);
            }
            self.labels_scratch = labels;
            self.labels_key = Some(labels_key);
        }
        upload
    }

    pub(crate) fn layers(&self) -> (ChartAnnotationLayer<'_>, ChartAnnotationLayer<'_>) {
        (self.below.layer(), self.above.layer())
    }
}

impl DataFrame {
    /// This frame with `y` mapping onto y axis `axis` (1 = right).
    fn on_axis(&self, axis: u8) -> Self {
        if axis == 1 {
            Self { y: self.y2, ..*self }
        } else {
            *self
        }
    }
}

/// Appends the clipped marks of one annotation.
fn build_marks(a: &ChartAnnotation, f: &DataFrame, ring: [f32; 4], out: &mut Marks) {
    let f = &f.on_axis(a.y_axis);
    let [x0, x1, y0, y1] = f.bounds;
    let z = match a.layer {
        AnnotationLayer::Below => f.z_below,
        AnnotationLayer::Above => f.z_above,
    };
    let opacity = if a.opacity.is_finite() { a.opacity.clamp(0.0, 1.0) } else { 1.0 };
    let color = [a.color[0], a.color[1], a.color[2], a.color[3] * opacity];
    let width = if a.width_px.is_finite() { a.width_px.max(0.0) } else { 0.0 };
    let dash = if a.dash_px.is_finite() { a.dash_px.max(0.0) } else { 0.0 };
    let mut line = |p: [f32; 2], q: [f32; 2]| {
        if width > 0.0 {
            out.lines.push(ChartSegmentRaw {
                p0_width: [p[0], p[1], z, width],
                p1_pad: [q[0], q[1], z, dash],
                color,
            });
        }
    };
    let [c0, c1, ..] = a.coords;
    match a.kind {
        AnnotationKind::HLine => {
            let y = f.y.map(c0);
            if inside(y, y0, y1) {
                line([x0, y], [x1, y]);
            }
        }
        AnnotationKind::VLine => {
            let x = f.x.map(c0);
            if inside(x, x0, x1) {
                line([x, y0], [x, y1]);
            }
        }
        AnnotationKind::YBand | AnnotationKind::XBand => {
            let horizontal = a.kind == AnnotationKind::YBand;
            let map = |v: f64| if horizontal { f.y.map(v) } else { f.x.map(v) };
            let (a0, a1) = (map(c0), map(c1));
            let (min, max) = if horizontal { (y0, y1) } else { (x0, x1) };
            let Some((lo, hi)) = clamp_range(a0, a1, min, max) else {
                return;
            };
            // Band rectangle in (along, across) -> world xy
            let at = |along: f32, across: f32| if horizontal { [along, across] } else { [across, along] };
            let (s0, s1) = if horizontal { (x0, x1) } else { (y0, y1) };
            let v = |p: [f32; 2]| ChartFillRaw {
                position: [p[0], p[1], z, 0.0],
                color,
            };
            let (p00, p10, p11, p01) = (at(s0, lo), at(s1, lo), at(s1, hi), at(s0, hi));
            out.fills.extend([v(p00), v(p10), v(p11), v(p00), v(p11), v(p01)]);
            // Borders only on edges that are inside the plot (not clipped)
            let border = [color[0], color[1], color[2], a.color[3]];
            for edge in [a0, a1] {
                if width > 0.0 && inside(edge, min, max) {
                    let (p, q) = (at(s0, edge), at(s1, edge));
                    out.lines.push(ChartSegmentRaw {
                        p0_width: [p[0], p[1], z, width],
                        p1_pad: [q[0], q[1], z, dash],
                        color: border,
                    });
                }
            }
        }
        AnnotationKind::Point => {
            let (x, y) = (f.x.map(c0), f.y.map(c1));
            if width > 0.0 && inside(x, x0, x1) && inside(y, y0, y1) {
                out.markers.push(ChartMarkerRaw {
                    center_radius: [x, y, z, width],
                    fill: color,
                    ring,
                    params: [2.0, 0.0, 0.0, 0.0],
                });
            }
        }
        AnnotationKind::Text => {}
    }
}

/// World xy of the label anchor, or `None` when the annotation is not visible.
fn label_anchor(a: &ChartAnnotation, f: &DataFrame) -> Option<(f32, f32)> {
    let f = &f.on_axis(a.y_axis);
    let [x0, x1, y0, y1] = f.bounds;
    let pick = |lo: f32, hi: f32| match a.label {
        LabelPosition::Start => lo,
        LabelPosition::End => hi,
        LabelPosition::Center => (lo + hi) * 0.5,
    };
    let [c0, c1, ..] = a.coords;
    match a.kind {
        AnnotationKind::HLine => {
            let y = f.y.map(c0);
            inside(y, y0, y1).then(|| (pick(x0, x1), y.clamp(y0, y1)))
        }
        AnnotationKind::VLine => {
            let x = f.x.map(c0);
            inside(x, x0, x1).then(|| (x.clamp(x0, x1), pick(y0, y1)))
        }
        AnnotationKind::YBand => {
            let (lo, hi) = clamp_range(f.y.map(c0), f.y.map(c1), y0, y1)?;
            Some((pick(x0, x1), (lo + hi) * 0.5))
        }
        AnnotationKind::XBand => {
            let (lo, hi) = clamp_range(f.x.map(c0), f.x.map(c1), x0, x1)?;
            Some(((lo + hi) * 0.5, pick(y0, y1)))
        }
        AnnotationKind::Point | AnnotationKind::Text => {
            let (x, y) = (f.x.map(c0), f.y.map(c1));
            (inside(x, x0, x1) && inside(y, y0, y1)).then_some((x, y))
        }
    }
}

impl ChartState {
    /// Data -> world mapping of the active chart (2D views only).
    pub(crate) fn annotation_frame(&self) -> Option<DataFrame> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => line_frame(l),
            ChartKind::Bar(b) => bar_frame(b),
            ChartKind::Scatter(s) => scatter_frame(s),
            ChartKind::Candle(c) => Some(c.annotation_frame()),
            // Not supported on heatmaps yet
            ChartKind::Heatmap(_) => None,
            ChartKind::Box(_) => None,
            // Angular layout: no data frame
            ChartKind::Pie(_) => None,
            // Data x = category index / x, y on the left axis (like a line chart)
            ChartKind::Combo(c) => line_frame(&c.line),
            // Waterfalls map data like bars (category index, value)
            ChartKind::Waterfall(w) => bar_frame(&w.bar),
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) => None,
            ChartKind::Hierarchy(_) => None,
        }
    }

    /// World position of a data point under the current zoom window (`None` outside 2D views).
    /// x: sample index / x value (line), category index (bar), x (scatter). Not clipped.
    pub fn data_to_world(&self, x: f64, y: f64) -> Option<Vec3> {
        self.data_to_world_on(0, x, y)
    }

    /// `data_to_world` with y on y axis `axis` (1 = right axis of a dual-axis line chart).
    pub fn data_to_world_on(&self, axis: u8, x: f64, y: f64) -> Option<Vec3> {
        let f = self.annotation_frame()?.on_axis(axis);
        Some(Vec3::new(f.x.map(x), f.y.map(y), f.z))
    }

    /// Sets the y axis of each annotation (0 = left, 1 = right; missing entries = left).
    pub fn set_annotation_y_axes(&mut self, axes: &[u8]) {
        let mut items = self.annotations.items().to_vec();
        for (i, a) in items.iter_mut().enumerate() {
            a.y_axis = u8::from(axes.get(i) == Some(&1));
        }
        if items != self.annotations.items() {
            self.annotations.set(items);
        }
    }

    /// Replaces every annotation (drawn on the next `prepare_layers`).
    pub fn set_annotations(&mut self, items: Vec<ChartAnnotation>) {
        self.annotations.set(items);
    }

    pub fn clear_annotations(&mut self) {
        self.annotations.set(Vec::new());
    }

    pub fn annotations(&self) -> &[ChartAnnotation] {
        self.annotations.items()
    }

    /// Label anchors of the last prepared frame, one per annotation in list order.
    pub fn annotation_labels(&self) -> &[AnnotationLabel] {
        self.annotations.labels()
    }

    /// Bumped whenever a label anchor moves / appears / disappears.
    pub fn annotation_labels_revision(&self) -> u32 {
        self.annotations.labels_revision()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    /// 1001 samples 0..=1000 (index x): y domain is exactly [0, 1000].
    fn line_chart(x: Option<Vec<f64>>) -> ChartState {
        ChartState::new_line(
            vec![LineSeries {
                values: (0..1001).map(|i| i as f32).collect(),
                x,
                color: [1.0; 4],
                width_px: 2.0,
            }],
            LineLayout {
                width: 160.0,
                height: 80.0,
                view: ChartViewMode::Flat,
                x_kind: LineXKind::Numeric,
            },
        )
    }

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];

    fn ann(kind: AnnotationKind, coords: [f64; 4]) -> ChartAnnotation {
        ChartAnnotation::new(kind, coords, RED)
    }

    #[test]
    fn line_data_maps_to_world_and_follows_the_zoom_window() {
        let mut cam = flat_camera();
        let mut chart = line_chart(None);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        // Index 0 / 1000 on the plot edges, value 500 in the middle
        let p = chart.data_to_world(0.0, 500.0).unwrap();
        assert!((p.x + 80.0).abs() < 1e-4 && p.y.abs() < 1e-4, "{p:?}");
        assert!((chart.data_to_world(1000.0, 0.0).unwrap().x - 80.0).abs() < 1e-4);
        // Zoom 4x around the centre: index 500 stays put, index 375 moves to the left edge
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&view(&cam), 0.25, c.x);
        let (w0, w1) = chart.x_window();
        let left = (w0 as f64 * 1000.0, w1 as f64 * 1000.0);
        assert!((chart.data_to_world(left.0, 0.0).unwrap().x + 80.0).abs() < 1e-3);
        assert!((chart.data_to_world(left.1, 0.0).unwrap().x - 80.0).abs() < 1e-3);

        // Explicit epoch-ms x keeps sub-second precision
        let t0 = 1.7e12;
        let chart = line_chart(Some((0..1001).map(|i| t0 + i as f64 * 1000.0).collect()));
        let a = chart.data_to_world(t0 + 500_000.0, 0.0).unwrap();
        let b = chart.data_to_world(t0 + 500_500.0, 0.0).unwrap();
        assert!(a.x.abs() < 1e-4);
        assert!((b.x - a.x - 0.08).abs() < 1e-4, "half a sample = 0.08 world");
    }

    #[test]
    fn lines_bands_and_points_are_clipped_or_hidden_outside_the_plot() {
        let mut cam = flat_camera();
        let mut chart = line_chart(None);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let mut above = ann(AnnotationKind::Point, [500.0, 500.0, 0.0, 0.0]);
        above.layer = AnnotationLayer::Above;
        chart.set_annotations(vec![
            ann(AnnotationKind::HLine, [800.0, 0.0, 0.0, 0.0]),
            ann(AnnotationKind::HLine, [1500.0, 0.0, 0.0, 0.0]), // above the y domain: hidden
            ann(AnnotationKind::YBand, [900.0, f64::INFINITY, 0.0, 0.0]), // clamped to the top
            ann(AnnotationKind::XBand, [-200.0, 100.0, 0.0, 0.0]), // clamped to the left edge
            above,
            ann(AnnotationKind::Text, [2000.0, 0.0, 0.0, 0.0]), // right of the data: hidden
        ]);
        let v = view(&cam);
        let layers = chart.prepare_layers(&v);
        let below = layers.annotations_below.expect("uploaded");
        assert_eq!(below.lines.len(), 1);
        let hl = below.lines[0];
        assert_eq!((hl.p0_width[0], hl.p1_pad[0]), (-80.0, 80.0));
        assert!((hl.p0_width[1] - 24.0).abs() < 1e-4);
        assert_eq!(hl.color, RED);
        // Two bands, 6 vertices each, translucent by default
        assert_eq!(below.fills.len(), 12);
        assert!(below.fills.iter().all(|f| (f.color[3] - 0.18).abs() < 1e-6));
        let ys: Vec<f32> = below.fills[..6].iter().map(|f| f.position[1]).collect();
        assert!(ys.iter().all(|&y| (32.0 - 1e-4..=40.0 + 1e-4).contains(&y)), "{ys:?}");
        let xs: Vec<f32> = below.fills[6..].iter().map(|f| f.position[0]).collect();
        assert!(xs.iter().all(|&x| (-80.0..=-64.0 + 1e-4).contains(&x)), "{xs:?}");
        // Below marks sit between the grid and the series; above marks in front
        assert!(below.fills.iter().all(|f| f.position[2] < 0.0 && f.position[2] > -0.5));
        let up = layers.annotations_above.unwrap();
        assert_eq!((up.markers.len(), up.lines.len()), (1, 0));
        assert!(up.markers[0].center_radius[2] > 0.0);
        assert_eq!(up.markers[0].center_radius[3], 5.0);

        // Labels: one per annotation, hidden ones flagged
        let labels = chart.annotation_labels();
        assert_eq!(labels.len(), 6);
        let vis: Vec<bool> = labels.iter().map(|l| l.visible).collect();
        assert_eq!(vis, [true, false, true, true, true, false]);
        // hline label at the plot's right edge ('end'), on the line
        let plot = chart.axes().plot_css;
        assert!((labels[0].x_css - (plot[0] + plot[2])).abs() < 0.5);
        assert!(labels[0].y_css > plot[1] && labels[0].y_css < plot[1] + plot[3] * 0.5);

        // Nothing moved: no re-upload, same label revision
        let rev = chart.annotation_labels_revision();
        assert!(chart.prepare_layers(&v).annotations_below.is_none());
        assert_eq!(chart.annotation_labels_revision(), rev);
    }

    #[test]
    fn zooming_moves_and_hides_annotations() {
        let mut cam = flat_camera();
        let mut chart = line_chart(None);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.set_annotations(vec![
            ann(AnnotationKind::VLine, [100.0, 0.0, 0.0, 0.0]),
            ann(AnnotationKind::VLine, [500.0, 0.0, 0.0, 0.0]),
        ]);
        let v = view(&cam);
        assert_eq!(chart.prepare_layers(&v).annotations_below.unwrap().lines.len(), 2);
        let rev = chart.annotation_labels_revision();
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&v, 0.25, c.x);
        let layers = chart.prepare_layers(&v);
        let lines = layers.annotations_below.expect("window changed: rebuilt").lines;
        // Index 100 left the window; index 500 stays at the centre
        assert_eq!(lines.len(), 1);
        assert!(lines[0].p0_width[0].abs() < 0.5);
        assert_ne!(chart.annotation_labels_revision(), rev);
        assert!(!chart.annotation_labels()[0].visible && chart.annotation_labels()[1].visible);
    }

    #[test]
    fn dash_and_border_style_reach_the_segments() {
        let mut cam = flat_camera();
        let mut chart = line_chart(None);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let mut band = ann(AnnotationKind::YBand, [-100.0, 200.0, 0.0, 0.0]);
        band.width_px = 1.0;
        band.dash_px = 4.0;
        band.opacity = 0.5;
        chart.set_annotations(vec![band]);
        let below = chart.prepare_layers(&view(&cam)).annotations_below.unwrap();
        // Lower edge is clipped (below the domain): only the upper border is drawn
        assert_eq!(below.lines.len(), 1);
        assert_eq!(below.lines[0].p1_pad[3], 4.0);
        assert_eq!(below.lines[0].color[3], 1.0, "border keeps the full alpha");
        assert_eq!(below.fills[0].color[3], 0.5);
    }

    #[test]
    fn bar_and_scatter_charts_map_categories_and_values() {
        let mut scene = SceneWorld::new();
        let bar = ChartState::new_bar(
            vec![10.0, 20.0, 30.0, 40.0],
            vec![RED],
            BarLayout {
                width: 160.0,
                max_height: 80.0,
                bar_width: 0.0,
                corner_radius_px: 0.0,
                view: ChartViewMode::Flat,
            },
            &mut scene,
        );
        // 4 slots of 40: category 0 centred at -60; value 0 on the plot bottom, 40 on top
        let p = bar.data_to_world(0.0, 0.0).unwrap();
        assert!((p.x + 60.0).abs() < 1e-4 && (p.y + 40.0).abs() < 1e-4);
        assert!((bar.data_to_world(3.0, 40.0).unwrap().y - 40.0).abs() < 1e-4);
        // Half a category past the last one is the right edge
        assert!((bar.data_to_world(3.5, 0.0).unwrap().x - 80.0).abs() < 1e-4);

        let scatter = ChartState::new_scatter(
            ScatterPoints {
                xs: vec![0.0, 10.0],
                ys: vec![0.0, 100.0],
                ..Default::default()
            },
            ScatterLayout::default(),
        );
        let lo = scatter.data_to_world(0.0, 0.0).unwrap();
        let hi = scatter.data_to_world(10.0, 100.0).unwrap();
        let (w, h) = (ScatterLayout::default().width, ScatterLayout::default().height);
        assert!((lo.x + w * 0.5).abs() < 1e-3 && (hi.y - h * 0.5).abs() < 1e-3, "{lo:?} {hi:?}");

        // 3D views have no data plane: no marks, labels hidden
        let mut depth = ChartState::new_bar(
            vec![1.0; 4],
            vec![],
            BarLayout {
                width: 160.0,
                max_height: 80.0,
                bar_width: 0.0,
                corner_radius_px: 0.0,
                view: ChartViewMode::Depth,
            },
            &mut scene,
        );
        assert!(depth.data_to_world(0.0, 0.0).is_none());
        depth.set_annotations(vec![ann(AnnotationKind::HLine, [0.5, 0.0, 0.0, 0.0])]);
        let cam = flat_camera();
        let layers = depth.prepare_layers(&view(&cam));
        assert_eq!(layers.annotations_below.unwrap().lines.len(), 0);
        assert!(!depth.annotation_labels()[0].visible);
    }
}
