//! Range selector (navigator / minimap) of 2D line and area charts, like the Highcharts Stock
//! navigator or the ECharts dataZoom slider: a strip below the plot shows every visible series
//! over the full x domain (M4-decimated at strip resolution), a translucent window marks the
//! zoom window, the rest is dimmed, and handles resize it.
//!
//! The strip lives in world space under the plot (the camera framing reserves its height below
//! the user padding) and is drawn unclipped by the series scissor. Its marks are rebuilt only
//! when the data / visibility or the view changes; the window overlay is a handful of quads
//! rebuilt when the zoom window moves. Pointer hit-testing and window dragging run here too, so
//! the SDK only forwards pointer deltas.

use super::*;
use crate::renderer::ChartAnnotationLayer;

/// Default strip height in CSS px.
pub const DEFAULT_NAVIGATOR_HEIGHT_PX: f32 = 48.0;
/// Space between the strip and the canvas bottom edge (CSS px).
const NAVIGATOR_MARGIN_PX: f32 = 8.0;
/// Pointer tolerance around a window edge that grabs its handle (CSS px).
const HANDLE_HIT_PX: f32 = 8.0;
const HANDLE_WIDTH_PX: f32 = 7.0;
/// Handle height as a fraction of the strip height.
const HANDLE_HEIGHT_FRAC: f32 = 0.5;
/// Vertical inset of the series inside the strip (CSS px).
const STRIP_INSET_PX: f32 = 3.0;
const STRIP_STROKE_PX: f32 = 1.0;
/// While data streams in, the strip is rebuilt at most once per this many frames (each rebuild
/// scans every sample: O(N)); view, visibility, and option changes rebuild it immediately.
const STREAM_REBUILD_FRAMES: u32 = 6;
/// Alpha multipliers of the strip marks (series color)
const STRIP_LINE_ALPHA: f32 = 0.85;
const STRIP_FILL_ALPHA: f32 = 0.18;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NavigatorStyle {
    /// Strip background
    pub background: [f32; 4],
    /// Dims the strip outside the zoom window
    pub mask: [f32; 4],
    /// Zoom window fill
    pub window: [f32; 4],
    /// Window outline and handle borders
    pub outline: [f32; 4],
    pub handle: [f32; 4],
}

impl Default for NavigatorStyle {
    fn default() -> Self {
        Self {
            background: [0.5, 0.6, 0.75, 0.05],
            mask: [CHART_SURFACE[0], CHART_SURFACE[1], CHART_SURFACE[2], 0.6],
            window: [0.55, 0.65, 0.85, 0.12],
            outline: [0.58, 0.64, 0.72, 0.9],
            handle: [0.78, 0.82, 0.88, 1.0],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct NavigatorOptions {
    pub enabled: bool,
    /// Strip height in CSS px
    pub height_px: f32,
    pub style: NavigatorStyle,
}

impl Default for NavigatorOptions {
    fn default() -> Self {
        Self { enabled: false, height_px: DEFAULT_NAVIGATOR_HEIGHT_PX, style: NavigatorStyle::default() }
    }
}

/// Navigator region under a pointer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigatorHit {
    None = 0,
    /// Inside the zoom window (drag moves it)
    Window = 1,
    /// Left / right window edge (drag resizes)
    LeftHandle = 2,
    RightHandle = 3,
    /// On the strip outside the window (click centers the window there)
    Outside = 4,
}

impl NavigatorHit {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Window,
            2 => Self::LeftHandle,
            3 => Self::RightHandle,
            4 => Self::Outside,
            _ => Self::None,
        }
    }
}

/// Placement of the strip for one view.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct StripGeom {
    /// World rect: `x0 < x1`, `y0` bottom < `y1` top, in the plane `z`
    pub(crate) x0: f32,
    pub(crate) x1: f32,
    pub(crate) y0: f32,
    pub(crate) y1: f32,
    pub(crate) z: f32,
    /// World units per CSS px
    pub(crate) world_per_css: f32,
    /// `[left, top, width, height]` in CSS px from the canvas top-left
    pub(crate) css: [f32; 4],
    /// Reversed x axis: the strip mirrors like the plot (`t = 0` on the right)
    pub(crate) flip: bool,
}

impl StripGeom {
    /// Under the plot of `l`, below the user bottom padding (x axis labels / title).
    fn of(l: &LineChart, view: &ChartView, bottom_pad: f32, height_px: f32) -> Option<Self> {
        if l.layout.view != ChartViewMode::Flat {
            return None;
        }
        let z = l.z.first().copied().unwrap_or(0.0);
        let (hw, hh) = (l.layout.width * 0.5, l.layout.height * 0.5);
        let plot = plot_rect_css(view, hw, -hh, hh, z)?;
        if plot[2] < 1.0 {
            return None;
        }
        // Head-on view of one plane: a uniform scale
        let world_per_css = l.layout.width / plot[2];
        let y1 = -hh - bottom_pad * world_per_css;
        let y0 = y1 - height_px * world_per_css;
        Some(Self {
            x0: -hw,
            x1: hw,
            y0,
            y1,
            z,
            world_per_css,
            css: [plot[0], plot[1] + plot[3] + bottom_pad, plot[2], height_px],
            flip: l.x_scale.sign() < 0.0,
        })
    }

    /// Left-to-right strip fraction of a full-domain `t` (and back: the map is an involution).
    #[inline]
    fn screen_t(&self, t: f32) -> f32 {
        if self.flip {
            1.0 - t
        } else {
            t
        }
    }

    /// World x of a full-domain `t`.
    #[inline]
    fn x_of_t(&self, t: f32) -> f32 {
        self.x0 + self.screen_t(t) * (self.x1 - self.x0)
    }

    /// Full-domain `t` of a CSS x (clamped to the strip).
    #[inline]
    fn t_of_css(&self, x: f32) -> f32 {
        self.screen_t(((x - self.css[0]) / self.css[2].max(1.0)).clamp(0.0, 1.0))
    }

    /// Window edges in CSS px, left to right.
    fn window_css(&self, window: (f32, f32)) -> (f32, f32) {
        let (a, b) = (self.screen_t(window.0), self.screen_t(window.1));
        (self.css[0] + a.min(b) * self.css[2], self.css[0] + a.max(b) * self.css[2])
    }

    /// Region under a CSS-px point. Handles grab a few px on both sides of each edge (less
    /// inside a narrow window, so its middle still drags the window).
    pub(crate) fn hit(&self, window: (f32, f32), x: f32, y: f32) -> NavigatorHit {
        let [l, t, w, h] = self.css;
        if !(y >= t && y <= t + h && x >= l - HANDLE_HIT_PX && x <= l + w + HANDLE_HIT_PX) {
            return NavigatorHit::None;
        }
        let (xa, xb) = self.window_css(window);
        // Screen-left / right handles are the window end / start on a reversed axis
        let (left, right) = if self.flip {
            (NavigatorHit::RightHandle, NavigatorHit::LeftHandle)
        } else {
            (NavigatorHit::LeftHandle, NavigatorHit::RightHandle)
        };
        let inner = HANDLE_HIT_PX.min((xb - xa) / 3.0);
        let near_a = x >= xa - HANDLE_HIT_PX && x <= xa + inner;
        let near_b = x >= xb - inner && x <= xb + HANDLE_HIT_PX;
        match (near_a, near_b) {
            (true, true) => {
                if (x - xa).abs() <= (x - xb).abs() {
                    left
                } else {
                    right
                }
            }
            (true, false) => left,
            (false, true) => right,
            _ if x >= xa && x <= xb => NavigatorHit::Window,
            _ if x >= l && x <= l + w => NavigatorHit::Outside,
            _ => NavigatorHit::None,
        }
    }
}

/// CSS px from the canvas top-left of an NDC point.
fn ndc_to_css(view: &ChartView, ndc: (f32, f32)) -> (f32, f32) {
    let pr = view.pixel_ratio.max(0.1);
    let (w, h) = (view.viewport_px.0 as f32 / pr, view.viewport_px.1 as f32 / pr);
    ((ndc.0 + 1.0) * 0.5 * w, (1.0 - ndc.1) * 0.5 * h)
}

/// Appends an axis-aligned rectangle as two triangles.
fn push_rect(out: &mut Vec<ChartFillRaw>, x0: f32, y0: f32, x1: f32, y1: f32, z: f32, color: [f32; 4]) {
    if x1 <= x0 || y1 <= y0 {
        return;
    }
    let v = |x: f32, y: f32| ChartFillRaw { position: [x, y, z, 0.0], color };
    out.extend([v(x0, y0), v(x1, y0), v(x1, y1), v(x0, y0), v(x1, y1), v(x0, y1)]);
}

fn push_line(out: &mut Vec<ChartSegmentRaw>, a: (f32, f32), b: (f32, f32), z: f32, color: [f32; 4]) {
    out.push(ChartSegmentRaw {
        p0_width: [a.0, a.1, z, STRIP_STROKE_PX],
        p1_pad: [b.0, b.1, z, 0.0],
        color,
    });
}

/// Outline of a rectangle (four 1 px strokes).
fn push_outline(out: &mut Vec<ChartSegmentRaw>, x0: f32, y0: f32, x1: f32, y1: f32, z: f32, color: [f32; 4]) {
    push_line(out, (x0, y0), (x1, y0), z, color);
    push_line(out, (x1, y0), (x1, y1), z, color);
    push_line(out, (x1, y1), (x0, y1), z, color);
    push_line(out, (x0, y1), (x0, y0), z, color);
}

/// Navigator state and CPU staging of its two layers.
#[derive(Debug, Clone)]
pub(crate) struct Navigator {
    pub(crate) opts: NavigatorOptions,
    strip_fills: Vec<ChartFillRaw>,
    strip_lines: Vec<ChartSegmentRaw>,
    window_fills: Vec<ChartFillRaw>,
    window_lines: Vec<ChartSegmentRaw>,
    /// View key the strip was built for (`None` = rebuild: data / visibility / options changed)
    strip_key: Option<[f32; 19]>,
    /// View key + zoom window the window overlay was built for
    window_key: Option<([f32; 19], (f32, f32))>,
    /// The GPU may hold navigator marks (cleared once when the navigator goes away). Starts true:
    /// the GPU buffers outlive charts, so a new chart clears a previous chart's strip.
    shown: bool,
    /// Data changed since the strip was built (rebuild throttled, see `STREAM_REBUILD_FRAMES`)
    data_stale: bool,
    /// `prepare_navigator` calls since the strip was last built
    frames_since_build: u32,
}

impl Default for Navigator {
    fn default() -> Self {
        Self {
            opts: NavigatorOptions::default(),
            strip_fills: Vec::new(),
            strip_lines: Vec::new(),
            window_fills: Vec::new(),
            window_lines: Vec::new(),
            strip_key: None,
            window_key: None,
            shown: true,
            data_stale: false,
            frames_since_build: 0,
        }
    }
}

impl Navigator {
    /// Strip marks must be rebuilt now (visibility or options changed).
    pub(crate) fn invalidate(&mut self) {
        self.strip_key = None;
        self.window_key = None;
    }

    /// Samples changed (set / append): the strip follows within a few frames.
    pub(crate) fn data_changed(&mut self) {
        self.data_stale = true;
    }

    /// Background, then a light fill under the first visible series and thin strokes of every
    /// visible series over the full x domain, M4-decimated at the strip's pixel width.
    fn build_strip(&mut self, l: &LineChart, g: &StripGeom, pixel_ratio: f32) {
        self.strip_fills.clear();
        self.strip_lines.clear();
        let style = self.opts.style;
        push_rect(&mut self.strip_fills, g.x0, g.y0, g.x1, g.y1, g.z, style.background);
        let window = LodWindow {
            t0: 0.0,
            t1: 1.0,
            px_per_t: (g.css[2] * pixel_ratio).max(1.0),
            reversed: false,
        };
        let inset = STRIP_INSET_PX * g.world_per_css;
        let (lo, hi) = (g.y0 + inset, g.y1 - inset);
        // Each series maps through its own y axis (left / right) and scale (log): extents come
        // from the M4 picks, which keep every pixel column's min / max, so they equal the full
        // data extent in scale space (stacked tops for areas) and stay stable while zooming
        let scales = [l.y_scale, l.right.scale];
        let axis_of = |s: usize| usize::from(l.series_axis.get(s).copied().unwrap_or(0) == 1);
        let mut runs: Vec<(usize, Vec<usize>)> = Vec::new();
        let mut ext = [(f32::INFINITY, f32::NEG_INFINITY); 2];
        for s in (0..l.series.len()).filter(|&s| l.visible[s]) {
            let mut picks = Vec::new();
            l.lod_picks(s, &window, &mut picks);
            let (a, values) = (axis_of(s), l.vals(s));
            for &i in &picks {
                let u = scales[a].fwd32(values[i]);
                if u.is_finite() {
                    ext[a] = (ext[a].0.min(u), ext[a].1.max(u));
                }
            }
            runs.push((s, picks));
        }
        // Non-finite = not drawable (gap, or <= 0 on a log axis)
        let y_of = |a: usize, v: f32| {
            let u = scales[a].fwd32(v);
            let (d0, d1) = ext[a];
            if !u.is_finite() {
                f32::NAN
            } else if d1 > d0 {
                lo + (u - d0) / (d1 - d0) * (hi - lo)
            } else {
                0.5 * (lo + hi)
            }
        };
        let (mut xs, mut tops, mut bottoms) = (Vec::new(), Vec::new(), Vec::new());
        let mut filled = false;
        for (s, picks) in &runs {
            let (s, a) = (*s, axis_of(*s));
            let values = l.vals(s);
            let base = l.series[s].color;
            if !filled && picks.len() > 1 {
                filled = true;
                xs.clear();
                tops.clear();
                for &i in picks {
                    xs.push(g.x_of_t(l.t_at(s, i)));
                    let y = y_of(a, values[i]);
                    tops.push(if y.is_finite() { y } else { lo });
                }
                bottoms.clear();
                bottoms.resize(xs.len(), lo);
                let fill = [base[0], base[1], base[2], base[3] * STRIP_FILL_ALPHA];
                band_triangles(&xs, &tops, &bottoms, g.z, fill, &mut self.strip_fills);
            }
            let color = [base[0], base[1], base[2], base[3] * STRIP_LINE_ALPHA];
            for pair in picks.windows(2) {
                let (ia, ib) = (pair[0], pair[1]);
                let (ya, yb) = (y_of(a, values[ia]), y_of(a, values[ib]));
                if !ya.is_finite() || !yb.is_finite() {
                    continue;
                }
                let pa = (g.x_of_t(l.t_at(s, ia)), ya);
                let pb = (g.x_of_t(l.t_at(s, ib)), yb);
                push_line(&mut self.strip_lines, pa, pb, g.z, color);
            }
        }
    }

    /// Dimmed sides, window fill + outline, and the two handles.
    fn build_window(&mut self, g: &StripGeom, window: (f32, f32)) {
        self.window_fills.clear();
        self.window_lines.clear();
        let style = self.opts.style;
        let (xa, xb) = (g.x_of_t(window.0), g.x_of_t(window.1));
        let (xa, xb) = (xa.min(xb), xa.max(xb));
        let fills = &mut self.window_fills;
        push_rect(fills, g.x0, g.y0, xa, g.y1, g.z, style.mask);
        push_rect(fills, xb, g.y0, g.x1, g.y1, g.z, style.mask);
        push_rect(fills, xa, g.y0, xb, g.y1, g.z, style.window);
        push_outline(&mut self.window_lines, xa, g.y0, xb, g.y1, g.z, style.outline);
        let half_w = 0.5 * HANDLE_WIDTH_PX * g.world_per_css;
        let half_h = 0.5 * HANDLE_HEIGHT_FRAC * (g.y1 - g.y0);
        let yc = 0.5 * (g.y0 + g.y1);
        for x in [xa, xb] {
            push_rect(fills, x - half_w, yc - half_h, x + half_w, yc + half_h, g.z, style.handle);
            push_outline(&mut self.window_lines, x - half_w, yc - half_h, x + half_w, yc + half_h, g.z, style.outline);
        }
    }

    fn clear(&mut self) {
        self.strip_fills.clear();
        self.strip_lines.clear();
        self.window_fills.clear();
        self.window_lines.clear();
    }

    pub(crate) fn strip_layer(&self) -> ChartAnnotationLayer<'_> {
        ChartAnnotationLayer { fills: &self.strip_fills, lines: &self.strip_lines, markers: &[] }
    }

    pub(crate) fn window_layer(&self) -> ChartAnnotationLayer<'_> {
        ChartAnnotationLayer { fills: &self.window_fills, lines: &self.window_lines, markers: &[] }
    }
}

impl ChartState {
    /// Shows / hides the navigator and sets its height (non-finite = default, clamped to
    /// 16..=240 CSS px). Only 2D line / area charts draw one; re-frame the camera afterwards
    /// (the plot makes room for the strip).
    pub fn set_navigator(&mut self, opts: NavigatorOptions) {
        let height_px = if opts.height_px.is_finite() { opts.height_px.clamp(16.0, 240.0) } else { DEFAULT_NAVIGATOR_HEIGHT_PX };
        self.navigator.opts = NavigatorOptions { height_px, ..opts };
        self.navigator.invalidate();
        // The plot rectangle moves: labels re-lay out
        self.axes_key = None;
    }

    pub fn navigator_options(&self) -> NavigatorOptions {
        self.navigator.opts
    }

    /// Line of a chart that draws a navigator (enabled, 2D line / area).
    fn navigator_line(&self) -> Option<&LineChart> {
        if !self.navigator.opts.enabled {
            return None;
        }
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if l.layout.view == ChartViewMode::Flat => {
                Some(l)
            }
            _ => None,
        }
    }

    /// Padding the camera frames with: the user padding plus the strip below it.
    pub(crate) fn frame_padding(&self) -> ChartPadding {
        let mut p = self.padding;
        if self.navigator_line().is_some() {
            p[2] += self.navigator.opts.height_px + NAVIGATOR_MARGIN_PX;
        }
        p
    }

    fn navigator_geom(&self, view: &ChartView) -> Option<StripGeom> {
        let l = self.navigator_line()?;
        StripGeom::of(l, view, self.padding[2], self.navigator.opts.height_px)
    }

    /// Strip rectangle `[left, top, width, height]` in CSS px (`None` without a navigator).
    pub fn navigator_rect_css(&self, view: &ChartView) -> Option<[f32; 4]> {
        self.navigator_geom(view).map(|g| g.css)
    }

    /// Navigator region under the pointer (NDC).
    pub fn navigator_hit(&self, view: &ChartView, ndc: (f32, f32)) -> NavigatorHit {
        if !ndc.0.is_finite() || !ndc.1.is_finite() {
            return NavigatorHit::None;
        }
        let Some(g) = self.navigator_geom(view) else {
            return NavigatorHit::None;
        };
        let (x, y) = ndc_to_css(view, ndc);
        g.hit(self.x_window(), x, y)
    }

    /// Drags the region grabbed at pointer-down by a pointer delta in NDC: the window (or
    /// `Outside`, after `navigator_center`) moves keeping its span, a handle moves one edge
    /// (clamped to the domain and the minimum zoom span). True when the window moved.
    pub fn navigator_drag(&mut self, view: &ChartView, hit: NavigatorHit, delta_ndc_x: f32) -> bool {
        if !delta_ndc_x.is_finite() || hit == NavigatorHit::None {
            return false;
        }
        let Some(g) = self.navigator_geom(view) else {
            return false;
        };
        let pr = view.pixel_ratio.max(0.1);
        let dt = delta_ndc_x * 0.5 * (view.viewport_px.0 as f32 / pr) / g.css[2].max(1.0);
        // Dragging right moves toward smaller t on a reversed axis
        let dt = if g.flip { -dt } else { dt };
        let (ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. })) = &mut self.kind else {
            return false;
        };
        let before = l.window;
        let (w0, w1) = before;
        let min = l.min_window_span();
        match hit {
            NavigatorHit::Window | NavigatorHit::Outside => l.set_window(w0 + dt, w1 + dt),
            NavigatorHit::LeftHandle => l.window = ((w0 + dt).clamp(0.0, (w1 - min).max(0.0)), w1),
            NavigatorHit::RightHandle => l.window = (w0, (w1 + dt).clamp((w0 + min).min(1.0), 1.0)),
            NavigatorHit::None => {}
        }
        let changed = l.window != before;
        if changed {
            self.on_window_changed();
        }
        changed
    }

    /// Centers the zoom window (same span) on the strip x under the pointer. True when it moved.
    pub fn navigator_center(&mut self, view: &ChartView, ndc_x: f32) -> bool {
        if !ndc_x.is_finite() {
            return false;
        }
        let Some(g) = self.navigator_geom(view) else {
            return false;
        };
        let t = g.t_of_css(ndc_to_css(view, (ndc_x, 0.0)).0);
        let (ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. })) = &mut self.kind else {
            return false;
        };
        let before = l.window;
        let half = 0.5 * (before.1 - before.0);
        l.set_window(t - half, t + half);
        let changed = l.window != before;
        if changed {
            self.on_window_changed();
        }
        changed
    }

    /// Zooms the window around the strip x under the pointer (`factor` < 1 zooms in; the anchor
    /// is clamped into the window). True when it moved.
    pub fn navigator_zoom(&mut self, view: &ChartView, factor: f32, ndc_x: f32) -> bool {
        if !factor.is_finite() || factor <= 0.0 || !ndc_x.is_finite() {
            return false;
        }
        let Some(g) = self.navigator_geom(view) else {
            return false;
        };
        let t = g.t_of_css(ndc_to_css(view, (ndc_x, 0.0)).0);
        let (ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. })) = &mut self.kind else {
            return false;
        };
        let before = l.window;
        l.zoom_x(factor, t);
        let changed = l.window != before;
        if changed {
            self.on_window_changed();
        }
        changed
    }

    /// Rebuilds stale navigator staging; returns which layers to upload `(strip, window)`.
    pub(crate) fn prepare_navigator(&mut self, view: &ChartView) -> (bool, bool) {
        let geom = self.navigator_geom(view);
        let Self { kind, navigator: nav, .. } = self;
        let (Some(g), ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. })) = (geom, &*kind) else {
            if !nav.shown {
                return (false, false);
            }
            nav.clear();
            nav.invalidate();
            nav.shown = false;
            return (true, true);
        };
        let key = view.key();
        nav.frames_since_build = nav.frames_since_build.saturating_add(1);
        let strip = nav.strip_key != Some(key) || (nav.data_stale && nav.frames_since_build >= STREAM_REBUILD_FRAMES);
        if strip {
            nav.build_strip(l, &g, view.pixel_ratio);
            nav.strip_key = Some(key);
            nav.data_stale = false;
            nav.frames_since_build = 0;
        }
        let window = nav.window_key != Some((key, l.window));
        if window {
            nav.build_window(&g, l.window);
            nav.window_key = Some((key, l.window));
        }
        nav.shown = true;
        (strip, window)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::SceneWorld;

    const CSS: (f32, f32) = (1600.0, 900.0);

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, CSS.0 / CSS.1);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn series(values: Vec<Vec<f32>>) -> Vec<LineSeries> {
        values
            .into_iter()
            .map(|values| LineSeries { values, x: None, color: [0.2, 0.5, 0.9, 1.0], width_px: 2.0 })
            .collect()
    }

    fn layout() -> LineLayout {
        LineLayout { width: 168.0, height: 86.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric }
    }

    /// Line chart with the navigator enabled, framed on the 1600 x 900 canvas.
    fn nav_chart(values: Vec<Vec<f32>>) -> (OrbitCamera, ChartState) {
        let mut chart = ChartState::new_line(series(values), layout());
        chart.set_navigator(NavigatorOptions { enabled: true, ..Default::default() });
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, CSS);
        (cam, chart)
    }

    fn ramp(n: usize) -> Vec<f32> {
        (0..n).map(|i| i as f32).collect()
    }

    /// NDC of a CSS point.
    fn ndc(x: f32, y: f32) -> (f32, f32) {
        (x / CSS.0 * 2.0 - 1.0, 1.0 - y / CSS.1 * 2.0)
    }

    fn window(chart: &ChartState) -> (f32, f32) {
        chart.x_window()
    }

    #[test]
    fn reversed_x_mirrors_the_strip_hit_regions_and_drags() {
        use crate::chart::AxisScale;
        let (cam, mut chart) = nav_chart(vec![ramp(1000)]);
        chart.set_axis_scale(0, AxisScale { reverse: true, ..AxisScale::LINEAR });
        assert!(chart.set_x_range_data(500.0, 750.0));
        let v = view(&cam);
        chart.prepare_layers(&v);
        let g = chart.navigator_geom(&v).unwrap();
        let (w0, w1) = window(&chart);
        // Data t 0.5..0.75 sits at strip fraction 0.25..0.5 (left half), like the mirrored plot
        let css = |f: f32| (g.css[0] + f * g.css[2], g.css[1] + 0.5 * g.css[3]);
        let to_ndc = |(x, y): (f32, f32)| ndc(x, y);
        let mid = 1.0 - 0.5 * (w0 + w1);
        assert_eq!(chart.navigator_hit(&v, to_ndc(css(mid))), NavigatorHit::Window);
        // The screen-left edge is the window end
        assert_eq!(chart.navigator_hit(&v, to_ndc(css(1.0 - w1))), NavigatorHit::RightHandle);
        assert_eq!(chart.navigator_hit(&v, to_ndc(css(1.0 - w0))), NavigatorHit::LeftHandle);
        // Strip: sample 0 at the right end
        let first = chart.navigator.strip_lines.first().unwrap().p0_width[0];
        assert!((first - g.x1).abs() < 1e-3, "{first} vs {}", g.x1);
        // Dragging right moves the window toward smaller t
        assert!(chart.navigator_drag(&v, NavigatorHit::Window, 0.05));
        assert!(window(&chart).0 < w0);
        // Centering under a strip point picks the mirrored t
        assert!(chart.navigator_center(&v, to_ndc(css(0.6)).0));
        let (a, b) = window(&chart);
        assert!((0.5 * (a + b) - 0.4).abs() < 1e-3, "{a} {b}");
    }

    #[test]
    fn strip_maps_each_series_through_its_own_axis_and_scale() {
        use crate::chart::{AxisScale, ScaleType};
        // Right-axis series 100x the left one, on a log scale with non-positive samples
        let mut right: Vec<f32> = (0..1000).map(|i| 100.0 + 50.0 * i as f32).collect();
        right[10] = 0.0;
        let (cam, mut chart) = nav_chart(vec![ramp(1000), right]);
        chart.set_series_axes(&[0, 1]);
        chart.set_axis_scale(2, AxisScale { kind: ScaleType::Log, ..AxisScale::LINEAR });
        let v = view(&cam);
        chart.prepare_layers(&v);
        let g = chart.navigator_geom(&v).unwrap();
        let lines = &chart.navigator.strip_lines;
        assert!(!lines.is_empty());
        let (mut y_min, mut y_max) = (f32::INFINITY, f32::NEG_INFINITY);
        for seg in lines {
            for y in [seg.p0_width[1], seg.p1_pad[1]] {
                assert!(y.is_finite() && y >= g.y0 - 1e-3 && y <= g.y1 + 1e-3, "{y} outside [{}, {}]", g.y0, g.y1);
                (y_min, y_max) = (y_min.min(y), y_max.max(y));
            }
        }
        // Both series use the strip height (each normalized on its own axis)
        assert!(y_max - y_min > 0.8 * (g.y1 - g.y0));
    }

    #[test]
    fn strip_sits_below_the_plot_and_the_padding_and_spans_the_plot_width() {
        let (cam, mut chart) = nav_chart(vec![ramp(1000)]);
        let v = view(&cam);
        chart.prepare_layers(&v);
        let plot = chart.axes().plot_css;
        let strip = chart.navigator_rect_css(&v).expect("navigator");
        let pad = DEFAULT_CHART_PADDING[2];
        assert!((strip[0] - plot[0]).abs() < 1e-3 && (strip[2] - plot[2]).abs() < 1e-3);
        assert!((strip[1] - (plot[1] + plot[3] + pad)).abs() < 1e-2, "{strip:?} {plot:?}");
        assert_eq!(strip[3], DEFAULT_NAVIGATOR_HEIGHT_PX);
        // Inside the canvas, above the bottom margin
        assert!(strip[1] + strip[3] <= CSS.1 - NAVIGATOR_MARGIN_PX + 0.5, "{strip:?}");

        // The world-space strip projects onto the reported CSS rect
        let g = chart.navigator_geom(&v).unwrap();
        let (_, top) = v.project_css(Vec3::new(g.x0, g.y1, g.z)).unwrap();
        let (_, bottom) = v.project_css(Vec3::new(g.x0, g.y0, g.z)).unwrap();
        assert!((top - strip[1]).abs() < 0.05 && (bottom - (strip[1] + strip[3])).abs() < 0.05);

        // Disabled: the plot takes the space back (this canvas is width-bound, so it moves down)
        let mut plain = ChartState::new_line(series(vec![ramp(1000)]), layout());
        let mut cam2 = flat_camera();
        plain.frame_camera(&mut cam2, CSS);
        plain.prepare_layers(&view(&cam2));
        let p = plain.axes().plot_css;
        assert!(p[1] + p[3] > plot[1] + plot[3] + 20.0, "{p:?} {plot:?}");
        assert!(plain.navigator_rect_css(&view(&cam2)).is_none());
    }

    #[test]
    fn strip_is_decimated_at_strip_resolution_and_keeps_spikes() {
        let mut values: Vec<f32> = (0..1_000_000).map(|i| (i as f32 * 0.001).sin()).collect();
        values[654_321] = 40.0;
        let (cam, mut chart) = nav_chart(vec![values]);
        let v = view(&cam);
        let g = chart.navigator_geom(&v).unwrap();
        let w = g.css[2] as usize;
        let layers = chart.prepare_layers(&v);
        let strip = layers.navigator.expect("strip uploaded");
        assert!(strip.lines.len() < 4 * (w + 2), "strip lines {} for {w} px", strip.lines.len());
        assert!(!strip.fills.is_empty());
        let top = strip.lines.iter().map(|s| s.p0_width[1].max(s.p1_pad[1])).fold(f32::MIN, f32::max);
        // The spike is the data max: it reaches the inset top of the strip
        assert!((top - (g.y1 - STRIP_INSET_PX * g.world_per_css)).abs() < 1e-3, "spike lost");
        assert!(strip.lines.iter().all(|s| s.p0_width[1] >= g.y0 && s.p0_width[1] <= g.y1));
    }

    #[test]
    fn strip_rebuilds_on_data_and_visibility_window_overlay_on_zoom() {
        let (cam, mut chart) = nav_chart(vec![ramp(5000), ramp(5000)]);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let first = chart.prepare_layers(&v);
        assert!(first.navigator.is_some() && first.navigator_window.is_some());
        let again = chart.prepare_layers(&v);
        assert!(again.navigator.is_none() && again.navigator_window.is_none());

        // Zoom: only the cheap window overlay is rebuilt
        chart.zoom_x(&v, 0.5, 0.0);
        let zoomed = chart.prepare_layers(&v);
        assert!(zoomed.navigator.is_none() && zoomed.navigator_window.is_some());

        // Streaming data rebuilds the strip, throttled to one rebuild per few frames
        let rebuilt = |chart: &mut ChartState| {
            (0..STREAM_REBUILD_FRAMES).filter(|_| chart.prepare_layers(&v).navigator.is_some()).count()
        };
        rebuilt(&mut chart);
        // After a quiet period the first change lands at once, the next ones are throttled
        chart.append_series_data(0, &[1.0, 2.0, 3.0], None, 0).unwrap();
        assert!(chart.prepare_layers(&v).navigator.is_some());
        chart.append_series_data(0, &[4.0], None, 0).unwrap();
        assert!(chart.prepare_layers(&v).navigator.is_none(), "throttled");
        let mut builds = 0;
        for k in 0..60 {
            chart.append_series_data(0, &[k as f32], None, 0).unwrap();
            builds += usize::from(chart.prepare_layers(&v).navigator.is_some());
        }
        assert_eq!(builds, 60 / STREAM_REBUILD_FRAMES as usize);
        assert_eq!(rebuilt(&mut chart), 1, "the last append still lands");
        assert_eq!(rebuilt(&mut chart), 0);

        // Hiding a series drops its strokes
        let both = chart.prepare_layers(&v);
        assert!(both.navigator.is_none());
        let n_before = chart.navigator.strip_lines.len();
        chart.set_series_visible(1, false, &mut scene);
        let hidden = chart.prepare_layers(&v).navigator.expect("strip rebuilt").lines.len();
        assert!(hidden < n_before);

        // Disabling clears the GPU marks once
        chart.set_navigator(NavigatorOptions::default());
        let off = chart.prepare_layers(&v);
        assert_eq!(off.navigator.map(|l| l.lines.len()), Some(0));
        assert_eq!(off.navigator_window.map(|l| l.fills.len()), Some(0));
        assert!(chart.prepare_layers(&v).navigator.is_none());
    }

    #[test]
    fn window_rect_follows_the_zoom_window() {
        let (cam, mut chart) = nav_chart(vec![ramp(10_000)]);
        let v = view(&cam);
        chart.set_x_range_data(2500.0, 5000.0);
        let g = chart.navigator_geom(&v).unwrap();
        let (w0, w1) = window(&chart);
        let layers = chart.prepare_layers(&v);
        let win = layers.navigator_window.unwrap();
        assert!((w0 - 0.25).abs() < 1e-3 && (w1 - 0.5).abs() < 1e-3);
        // Mask left, mask right, window: 3 rects, then 2 handles
        assert_eq!(win.fills.len(), 5 * 6);
        let window_rect = &win.fills[12..18];
        let xs: Vec<f32> = window_rect.iter().map(|p| p.position[0]).collect();
        let (lo, hi) = xs.iter().fold((f32::MAX, f32::MIN), |(a, b), &x| (a.min(x), b.max(x)));
        assert!((lo - g.x_of_t(w0)).abs() < 1e-3 && (hi - g.x_of_t(w1)).abs() < 1e-3);
        // Full view: no masks
        chart.reset_zoom();
        let full = chart.prepare_layers(&v).navigator_window.unwrap();
        assert_eq!(full.fills.len(), 3 * 6);
    }

    #[test]
    fn hit_regions_cover_handles_window_and_outside() {
        let (cam, mut chart) = nav_chart(vec![ramp(10_000)]);
        let v = view(&cam);
        chart.set_x_range_data(2500.0, 5000.0);
        let [l, t, w, h] = chart.navigator_rect_css(&v).unwrap();
        let y = t + h * 0.5;
        let (xa, xb) = (l + 0.25 * w, l + 0.5 * w);
        let hit = |x: f32, y: f32| chart.navigator_hit(&v, ndc(x, y));
        assert_eq!(hit(xa, y), NavigatorHit::LeftHandle);
        assert_eq!(hit(xa - 5.0, y), NavigatorHit::LeftHandle);
        assert_eq!(hit(xb + 5.0, y), NavigatorHit::RightHandle);
        assert_eq!(hit(0.5 * (xa + xb), y), NavigatorHit::Window);
        assert_eq!(hit(l + 0.1 * w, y), NavigatorHit::Outside);
        assert_eq!(hit(l + 0.9 * w, y), NavigatorHit::Outside);
        // Above / below the strip, on the plot, outside the canvas
        assert_eq!(hit(0.5 * (xa + xb), t - 2.0), NavigatorHit::None);
        assert_eq!(hit(0.5 * (xa + xb), t + h + 2.0), NavigatorHit::None);
        assert_eq!(hit(l - 20.0, y), NavigatorHit::None);
        assert_eq!(chart.navigator_hit(&v, (f32::NAN, 0.0)), NavigatorHit::None);
        // Codes round-trip through the binding
        for h in [NavigatorHit::None, NavigatorHit::Window, NavigatorHit::LeftHandle, NavigatorHit::RightHandle, NavigatorHit::Outside] {
            assert_eq!(NavigatorHit::from_u8(h as u8), h);
        }
    }

    #[test]
    fn pointer_over_the_strip_never_hovers_data() {
        let (cam, mut chart) = nav_chart(vec![ramp(1000)]);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        let plot = chart.axes().plot_css;
        let [l, t, w, _] = chart.navigator_rect_css(&v).unwrap();
        let x = l + 0.5 * w;
        assert!(chart.hover_at(&v, &mut scene, ndc(x, plot[1] + plot[3] - 2.0)).is_some());
        assert!(chart.hover_at(&v, &mut scene, ndc(x, t + 1.0)).is_none());
        assert_eq!(chart.prepare_layers(&v).markers.map(|m| m.len()), Some(0));
    }

    #[test]
    fn a_new_chart_clears_a_previous_charts_strip_once() {
        let mut chart = ChartState::new_line(series(vec![ramp(10)]), layout());
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, CSS);
        let v = view(&cam);
        let first = chart.prepare_layers(&v);
        assert_eq!(first.navigator.map(|l| l.lines.len() + l.fills.len()), Some(0));
        assert_eq!(first.navigator_window.map(|l| l.fills.len()), Some(0));
        assert!(chart.prepare_layers(&v).navigator.is_none());
    }

    #[test]
    fn narrow_window_keeps_its_middle_draggable() {
        let (cam, mut chart) = nav_chart(vec![ramp(100_000)]);
        let v = view(&cam);
        let [l, t, w, h] = chart.navigator_rect_css(&v).unwrap();
        // ~12 px wide window
        let span = 12.0 / w;
        chart.set_x_range_data(50_000.0, 50_000.0 + span as f64 * 99_999.0);
        let (w0, w1) = window(&chart);
        let mid = l + 0.5 * (w0 + w1) * w;
        assert_eq!(chart.navigator_hit(&v, ndc(mid, t + h * 0.5)), NavigatorHit::Window);
    }

    #[test]
    fn drag_moves_and_resizes_with_clamps_and_min_span() {
        let (cam, mut chart) = nav_chart(vec![ramp(1001)]);
        let v = view(&cam);
        chart.set_x_range_data(200.0, 400.0);
        let strip_w = chart.navigator_rect_css(&v).unwrap()[2];
        // NDC delta of a strip fraction
        let d = |f: f32| f * strip_w / CSS.0 * 2.0;

        assert!(chart.navigator_drag(&v, NavigatorHit::Window, d(0.1)));
        let (w0, w1) = window(&chart);
        assert!((w0 - 0.3).abs() < 1e-4 && (w1 - 0.5).abs() < 1e-4, "{w0} {w1}");
        // Past the right end: clamped, span kept
        chart.navigator_drag(&v, NavigatorHit::Window, d(5.0));
        let (w0, w1) = window(&chart);
        assert!((w1 - 1.0).abs() < 1e-6 && (w1 - w0 - 0.2).abs() < 1e-4);
        assert!(!chart.navigator_drag(&v, NavigatorHit::Window, d(0.5)), "already at the end");

        // Left handle resizes; it cannot cross the right edge (min span)
        chart.navigator_drag(&v, NavigatorHit::LeftHandle, d(-0.3));
        let (w0, w1) = window(&chart);
        assert!((w0 - 0.5).abs() < 1e-4 && w1 == 1.0);
        chart.navigator_drag(&v, NavigatorHit::LeftHandle, d(2.0));
        let (w0, w1) = window(&chart);
        let min = 8.0 / 1000.0;
        assert!((w1 - w0 - min).abs() < 1e-4, "min span {}", w1 - w0);

        // Right handle: clamped to the domain end and the min span from the left edge
        chart.reset_zoom();
        chart.navigator_drag(&v, NavigatorHit::RightHandle, d(-0.75));
        let (w0, w1) = window(&chart);
        assert!(w0 == 0.0 && (w1 - 0.25).abs() < 1e-4);
        chart.navigator_drag(&v, NavigatorHit::RightHandle, d(-3.0));
        assert!((window(&chart).1 - min).abs() < 1e-4);
        chart.navigator_drag(&v, NavigatorHit::LeftHandle, d(-1.0));
        assert_eq!(window(&chart).0, 0.0);
        assert!(!chart.navigator_drag(&v, NavigatorHit::None, d(0.2)));
        assert!(!chart.navigator_drag(&v, NavigatorHit::Window, f32::NAN));
    }

    #[test]
    fn click_centers_and_wheel_zooms_around_the_strip_pointer() {
        let (cam, mut chart) = nav_chart(vec![ramp(1001)]);
        let v = view(&cam);
        chart.set_x_range_data(0.0, 100.0);
        let [l, t, w, h] = chart.navigator_rect_css(&v).unwrap();
        let y = t + h * 0.5;
        assert_eq!(chart.navigator_hit(&v, ndc(l + 0.6 * w, y)), NavigatorHit::Outside);
        assert!(chart.navigator_center(&v, ndc(l + 0.6 * w, y).0));
        let (w0, w1) = window(&chart);
        assert!((0.5 * (w0 + w1) - 0.6).abs() < 1e-4 && (w1 - w0 - 0.1).abs() < 1e-4);
        // Near the end: clamped inside the domain
        chart.navigator_center(&v, ndc(l + w, y).0);
        assert_eq!(window(&chart).1, 1.0);

        // Wheel over the window: the pointer t stays put
        chart.set_x_range_data(400.0, 600.0);
        let at = l + 0.45 * w;
        assert!(chart.navigator_zoom(&v, 0.5, ndc(at, y).0));
        let (w0, w1) = window(&chart);
        assert!((w1 - w0 - 0.1).abs() < 1e-4);
        assert!(((0.45 - w0) / (w1 - w0) - 0.25).abs() < 1e-3);
        assert!(!chart.navigator_zoom(&v, f32::NAN, 0.0));
    }

    #[test]
    fn drags_feed_the_range_and_y_autoscale_like_pan() {
        let (cam, mut chart) = nav_chart(vec![ramp(1001)]);
        let v = view(&cam);
        chart.set_y_axis(LineYAxis { autoscale: YAutoscale::Visible, ..Default::default() });
        chart.set_x_range_data(0.0, 100.0);
        chart.prepare_layers(&v);
        let before = chart.y_domain().unwrap();
        chart.navigator_drag(&v, NavigatorHit::Window, 1.0);
        let r = chart.x_range_data().unwrap();
        assert!(r.0 > 100.0, "{r:?}");
        assert_ne!(chart.y_domain().unwrap(), before, "visible autoscale follows the navigator");
        // The series layer is rebuilt for the new window
        assert!(chart.prepare_layers(&v).series.is_some());
    }

    #[test]
    fn area_charts_get_a_navigator_and_other_kinds_do_not() {
        let mut area = ChartState::new_area(series(vec![ramp(100), ramp(100)]), layout(), AreaMode::Stacked, f32::NAN);
        area.set_navigator(NavigatorOptions { enabled: true, ..Default::default() });
        let mut cam = flat_camera();
        area.frame_camera(&mut cam, CSS);
        let v = view(&cam);
        assert!(area.prepare_layers(&v).navigator.is_some_and(|l| !l.lines.is_empty()));

        let mut depth = ChartState::new_line(series(vec![ramp(100)]), LineLayout { view: ChartViewMode::Depth, ..layout() });
        depth.set_navigator(NavigatorOptions { enabled: true, ..Default::default() });
        assert_eq!(depth.frame_padding(), DEFAULT_CHART_PADDING);
        let mut cam = flat_camera();
        depth.frame_camera(&mut cam, CSS);
        let v = view(&cam);
        assert!(depth.navigator_rect_css(&v).is_none());
        // Only the one-time clear of a previous chart's strip
        assert_eq!(depth.prepare_layers(&v).navigator.map(|l| l.lines.len()), Some(0));
        assert!(depth.prepare_layers(&v).navigator.is_none());
        assert_eq!(depth.navigator_hit(&v, (0.0, -0.9)), NavigatorHit::None);
    }

    #[test]
    fn height_option_is_sanitized_and_reserved_in_the_padding() {
        let mut chart = ChartState::new_line(series(vec![ramp(10)]), layout());
        chart.set_navigator(NavigatorOptions { enabled: true, height_px: 80.0, ..Default::default() });
        assert_eq!(chart.frame_padding()[2], DEFAULT_CHART_PADDING[2] + 80.0 + NAVIGATOR_MARGIN_PX);
        chart.set_navigator(NavigatorOptions { enabled: true, height_px: f32::NAN, ..Default::default() });
        assert_eq!(chart.navigator_options().height_px, DEFAULT_NAVIGATOR_HEIGHT_PX);
        chart.set_navigator(NavigatorOptions { enabled: true, height_px: 1.0, ..Default::default() });
        assert_eq!(chart.navigator_options().height_px, 16.0);
    }
}
