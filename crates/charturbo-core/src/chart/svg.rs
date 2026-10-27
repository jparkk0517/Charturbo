//! SVG export of the current 2D chart view: the staged GPU instances (what is on screen, LOD
//! picks included) written as vector markup in CSS px from the canvas top-left.
//!
//! Draw order and clipping mirror `render_frame`: gridlines, annotations below, then (scissored
//! to the plot while zoomed / animating, like the GPU) bars, fills, series strokes, dashed
//! strokes, series markers, scatter points, annotations above and the brush; the navigator strip
//! last. Hover overlays are left out. Consecutive stroke segments of the same style become one
//! `<path>` polyline, fill triangles of one color one `<path>`, bars rounded `<path>`s, markers /
//! points `<circle>`s (other marker shapes `<path>`s). DOM text (ticks, legend, titles) is added
//! by the SDK.
//!
//! Large data: the export walks what is staged (decimated lines stay decimated); points outside
//! the plot are culled and the rest are strided down to the mark budget (`truncated` is set).

use super::*;
use crate::renderer::{ChartAnnotationLayer, ChartDashSegmentRaw, ChartPointStyleRaw, MAX_POINT_SERIES};
use std::fmt::Write;

/// Default mark budget of `export_svg` (about 10-20 MB of markup).
pub const SVG_DEFAULT_MAX_MARKS: usize = 200_000;

/// How a chart exports to SVG.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SvgSupport {
    /// Every mark is vector
    Vector,
    /// Vector frame / annotations, but the plot content is a texture (heatmap): the SDK embeds
    /// the plot rectangle of the canvas as an `<image>`
    RasterPlot,
    /// Not exportable as vector (3D / 2.5D views, kinds without an SVG writer): the SDK embeds
    /// the whole canvas as an `<image>`
    Raster,
}

impl SvgSupport {
    /// 0 = vector, 1 = raster plot, 2 = raster
    pub fn code(self) -> u8 {
        match self {
            Self::Vector => 0,
            Self::RasterPlot => 1,
            Self::Raster => 2,
        }
    }
}

/// Result of `ChartState::export_svg`.
#[derive(Debug, Clone, PartialEq)]
pub struct SvgExport {
    /// `<defs>` + `<g>` layers (no `<svg>` root), CSS px
    pub markup: String,
    pub support: SvgSupport,
    /// Instances written
    pub marks: usize,
    /// Marks were dropped to stay within the budget
    pub truncated: bool,
    /// Plot rectangle `[left, top, width, height]` in CSS px
    pub plot_css: [f32; 4],
}

/// `rgb(...)` of a 0..1 color plus its alpha.
fn rgb(c: [f32; 4]) -> (String, f32) {
    let ch = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    (format!("rgb({},{},{})", ch(c[0]), ch(c[1]), ch(c[2])), c[3].clamp(0.0, 1.0))
}

/// ` fill="rgb(..)"[ fill-opacity=".."]` (`attr` = fill / stroke).
fn paint(out: &mut String, attr: &str, c: [f32; 4]) {
    let (col, a) = rgb(c);
    let _ = write!(out, " {attr}=\"{col}\"");
    if a < 0.999 {
        let _ = write!(out, " {attr}-opacity=\"{}\"", num(a));
    }
}

/// Compact decimal (2 places, trailing zeros trimmed).
fn num(v: f32) -> String {
    let s = format!("{:.2}", if v.is_finite() { v } else { 0.0 });
    let s = s.trim_end_matches('0').trim_end_matches('.');
    if s == "-0" || s.is_empty() {
        "0".into()
    } else {
        s.into()
    }
}

/// Mark budget bookkeeping.
struct Budget {
    left: usize,
    used: usize,
    truncated: bool,
}

impl Budget {
    /// Takes one mark; false (and `truncated`) once exhausted.
    fn take(&mut self) -> bool {
        if self.left == 0 {
            self.truncated = true;
            return false;
        }
        self.left -= 1;
        self.used += 1;
        true
    }
}

/// Writer of one export: projection + budget + output.
struct Svg<'a> {
    view: &'a ChartView<'a>,
    out: String,
    budget: Budget,
}

impl Svg<'_> {
    fn css(&self, x: f32, y: f32, z: f32) -> Option<(f32, f32)> {
        self.view.project_css(Vec3::new(x, y, z))
    }

    /// Strokes: consecutive segments sharing an end point and style form one polyline.
    fn segments(&mut self, segs: &[ChartSegmentRaw]) {
        let mut d = String::new();
        let mut key: Option<([f32; 4], f32, f32)> = None;
        let mut last: Option<(f32, f32)> = None;
        for s in segs {
            if !self.budget.take() {
                break;
            }
            let (Some(a), Some(b)) = (
                self.css(s.p0_width[0], s.p0_width[1], s.p0_width[2]),
                self.css(s.p1_pad[0], s.p1_pad[1], s.p1_pad[2]),
            ) else {
                continue;
            };
            let k = (s.color, s.p0_width[3], s.p1_pad[3]);
            let joined = key == Some(k) && last.is_some_and(|l| (l.0 - a.0).abs() < 0.01 && (l.1 - a.1).abs() < 0.01);
            if !joined {
                self.flush_stroke(&mut d, key, None);
                key = Some(k);
                let _ = write!(d, "M{} {}", num(a.0), num(a.1));
            }
            let _ = write!(d, "L{} {}", num(b.0), num(b.1));
            last = Some(b);
        }
        self.flush_stroke(&mut d, key, None);
    }

    /// Dashed strokes: like `segments`, plus the `[on, off, on, off]` pattern and start phase.
    fn dashed(&mut self, segs: &[ChartDashSegmentRaw]) {
        let mut d = String::new();
        let mut key: Option<([f32; 4], f32, [f32; 4])> = None;
        let mut phase = 0.0;
        let mut last: Option<(f32, f32)> = None;
        for s in segs {
            if !self.budget.take() {
                break;
            }
            let (Some(a), Some(b)) = (
                self.css(s.p0_width[0], s.p0_width[1], s.p0_width[2]),
                self.css(s.p1_phase[0], s.p1_phase[1], s.p1_phase[2]),
            ) else {
                continue;
            };
            let k = (s.color, s.p0_width[3], s.dash);
            let joined = key == Some(k) && last.is_some_and(|l| (l.0 - a.0).abs() < 0.01 && (l.1 - a.1).abs() < 0.01);
            if !joined {
                self.flush_stroke(&mut d, key.map(|(c, w, _)| (c, w, 0.0)), key.map(|k| (k.2, phase)));
                key = Some(k);
                phase = s.p1_phase[3];
                let _ = write!(d, "M{} {}", num(a.0), num(a.1));
            }
            let _ = write!(d, "L{} {}", num(b.0), num(b.1));
            last = Some(b);
        }
        self.flush_stroke(&mut d, key.map(|(c, w, _)| (c, w, 0.0)), key.map(|k| (k.2, phase)));
    }

    /// Writes the pending polyline `d` (if any) with stroke `(color, width, dash px)` and an
    /// optional `(pattern, phase)` dash.
    fn flush_stroke(&mut self, d: &mut String, key: Option<([f32; 4], f32, f32)>, pattern: Option<([f32; 4], f32)>) {
        let Some((color, width, dash)) = key else {
            d.clear();
            return;
        };
        if d.is_empty() {
            return;
        }
        let _ = write!(self.out, "<path d=\"{d}\" fill=\"none\"");
        paint(&mut self.out, "stroke", color);
        // Dashes end square-cut (as the dash shaders cut them), solid strokes round
        let pattern = pattern
            .map(|(p, phase)| (p.iter().copied().filter(|v| *v > 0.0).map(num).collect::<Vec<_>>().join(" "), phase))
            .filter(|(p, _)| !p.is_empty());
        let cap = if dash > 0.0 || pattern.is_some() { "butt" } else { "round" };
        let _ = write!(self.out, " stroke-width=\"{}\" stroke-linecap=\"{cap}\" stroke-linejoin=\"round\"", num(width.max(0.5)));
        if dash > 0.0 {
            let _ = write!(self.out, " stroke-dasharray=\"{0} {0}\"", num(dash));
        } else if let Some((p, phase)) = pattern {
            let _ = write!(self.out, " stroke-dasharray=\"{p}\" stroke-dashoffset=\"{}\"", num(phase));
        }
        self.out.push_str("/>");
        d.clear();
    }

    /// Fill triangles: runs of one color become one path.
    fn fills(&mut self, tris: &[ChartFillRaw]) {
        let mut d = String::new();
        let mut color: Option<[f32; 4]> = None;
        for t in tris.as_chunks::<3>().0 {
            if !self.budget.take() {
                break;
            }
            let p: Vec<(f32, f32)> = t.iter().filter_map(|v| self.css(v.position[0], v.position[1], v.position[2])).collect();
            if p.len() != 3 {
                continue;
            }
            if color != Some(t[0].color) {
                self.flush_fill(&mut d, color);
                color = Some(t[0].color);
            }
            let _ = write!(d, "M{} {}L{} {}L{} {}Z", num(p[0].0), num(p[0].1), num(p[1].0), num(p[1].1), num(p[2].0), num(p[2].1));
        }
        self.flush_fill(&mut d, color);
    }

    fn flush_fill(&mut self, d: &mut String, color: Option<[f32; 4]>) {
        if let (Some(c), false) = (color, d.is_empty()) {
            let _ = write!(self.out, "<path d=\"{d}\"");
            paint(&mut self.out, "fill", c);
            self.out.push_str("/>");
        }
        d.clear();
    }

    /// Bars with the data end rounded and gap trims, as the bar shader cuts them.
    fn bars(&mut self, bars: &[ChartBarRaw]) {
        for b in bars {
            if !self.budget.take() {
                break;
            }
            let z = b.z_radius[0];
            let (Some(p0), Some(p1)) = (self.css(b.rect[0], b.rect[1], z), self.css(b.rect[2], b.rect[3], z)) else {
                continue;
            };
            let (l, r) = (p0.0.min(p1.0), p0.0.max(p1.0));
            let (t, btm) = (p0.1.min(p1.1), p0.1.max(p1.1));
            let end = b.z_radius[2];
            let horizontal = end.abs() > 1.5;
            // Local frame: u across the bar, v along it towards the data end
            let (thick, len) = if horizontal { (btm - t, r - l) } else { (r - l, btm - t) };
            let gap = b.z_radius[3];
            let side = (-gap * 0.5).clamp(0.0, thick * 0.25);
            let trim = gap.clamp(0.0, len * 0.5);
            let (w, h) = (thick - 2.0 * side, len - trim);
            if w <= 0.0 || h <= 0.0 {
                continue;
            }
            let rad = b.z_radius[1].max(0.0).min(w * 0.5).min(h);
            // CSS point of local (u, v)
            let at = |u: f32, v: f32| -> (f32, f32) {
                let u = side + u;
                if end > 1.5 {
                    (l + v, t + u)
                } else if end < -1.5 {
                    (r - v, t + u)
                } else if end < -0.5 {
                    (l + u, t + v)
                } else {
                    (l + u, btm - v)
                }
            };
            let mut d = String::new();
            let pt = |d: &mut String, cmd: char, u: f32, v: f32| {
                let (x, y) = at(u, v);
                let _ = write!(d, "{cmd}{} {}", num(x), num(y));
            };
            pt(&mut d, 'M', 0.0, 0.0);
            pt(&mut d, 'L', w, 0.0);
            if rad > 0.25 {
                // Quarter circles as cubic Beziers
                let k = 0.552_284_8 * rad;
                pt(&mut d, 'L', w, h - rad);
                pt(&mut d, 'C', w, h - rad + k);
                pt(&mut d, ' ', w - rad + k, h);
                pt(&mut d, ' ', w - rad, h);
                pt(&mut d, 'L', rad, h);
                pt(&mut d, 'C', rad - k, h);
                pt(&mut d, ' ', 0.0, h - rad + k);
                pt(&mut d, ' ', 0.0, h - rad);
            } else {
                pt(&mut d, 'L', w, h);
                pt(&mut d, 'L', 0.0, h);
            }
            d.push('Z');
            let _ = write!(self.out, "<path d=\"{d}\"");
            paint(&mut self.out, "fill", b.color);
            self.out.push_str("/>");
        }
    }

    /// Marker of `shape` (0 circle, 1 square, 2 diamond, 3 triangle) with fill radius `r` and a
    /// ring `ring` px wide (outline stroked over the outer part).
    fn marker(&mut self, c: (f32, f32), r: f32, ring: f32, shape: f32, fill: [f32; 4], ring_color: [f32; 4]) {
        let m = r + ring * 0.5;
        if shape < 0.5 {
            let _ = write!(self.out, "<circle cx=\"{}\" cy=\"{}\" r=\"{}\"", num(c.0), num(c.1), num(m));
        } else {
            let pts: Vec<(f32, f32)> = if shape < 1.5 {
                let h = 0.85 * m;
                vec![(-h, -h), (h, -h), (h, h), (-h, h)]
            } else if shape < 2.5 {
                let h = 1.2 * m;
                vec![(0.0, -h), (h, 0.0), (0.0, h), (-h, 0.0)]
            } else {
                vec![(0.0, -1.25 * m), (1.0825 * m, 0.625 * m), (-1.0825 * m, 0.625 * m)]
            };
            let mut d = String::new();
            for (i, (x, y)) in pts.iter().enumerate() {
                let _ = write!(d, "{}{} {}", if i == 0 { 'M' } else { 'L' }, num(c.0 + x), num(c.1 + y));
            }
            let _ = write!(self.out, "<path d=\"{d}Z\"");
        }
        paint(&mut self.out, "fill", fill);
        if ring > 0.0 && ring_color[3] > 0.0 {
            paint(&mut self.out, "stroke", ring_color);
            let _ = write!(self.out, " stroke-width=\"{}\" stroke-linejoin=\"round\"", num(ring));
        }
        self.out.push_str("/>");
    }

    fn markers(&mut self, markers: &[ChartMarkerRaw]) {
        for m in markers {
            if !self.budget.take() {
                break;
            }
            let p = m.center_radius;
            if let Some(c) = self.css(p[0], p[1], p[2]) {
                self.marker(c, p[3], m.params[0].max(0.0), m.params[1], m.fill, m.ring);
            }
        }
    }

    /// Scatter / outlier points under the layer transform: culled to `bounds` (CSS), strided to
    /// the remaining budget, emphasized slot last.
    fn points(&mut self, points: &[ChartPointRaw], style: &ChartPointStyleRaw, bounds: [f32; 4]) {
        let [sx, sy, tx, ty] = style.transform;
        let ring = style.params[0].max(0.0);
        let [bl, bt, bw, bh] = bounds;
        let place = |p: &ChartPointRaw| -> Option<((f32, f32), f32)> {
            let slot = (p.center_radius[2].max(0.0) as usize).min(MAX_POINT_SERIES - 1);
            let alpha = style.slot_alpha(slot).min(1.0) * p.color[3] as f32 / 255.0;
            if alpha <= 0.0 {
                return None;
            }
            let c = self.view.project_css(Vec3::new(p.center_radius[0] * sx + tx, p.center_radius[1] * sy + ty, 0.0))?;
            let r = p.center_radius[3] + ring;
            let inside = c.0 + r >= bl && c.0 - r <= bl + bw && c.1 + r >= bt && c.1 - r <= bt + bh;
            inside.then_some((c, alpha))
        };
        let visible = points.iter().filter(|p| place(p).is_some()).count();
        if visible == 0 {
            return;
        }
        let stride = visible.div_ceil(self.budget.left.max(1)).max(1);
        if stride > 1 {
            self.budget.truncated = true;
        }
        let emphasized = style.emphasized_slot();
        for pass in 0..2 {
            let mut k = 0usize;
            for p in points {
                let slot = p.center_radius[2].max(0.0) as usize;
                if (emphasized == Some(slot)) != (pass == 1) {
                    continue;
                }
                let Some((c, alpha)) = place(p) else {
                    continue;
                };
                k += 1;
                if !(k - 1).is_multiple_of(stride) || !self.budget.take() {
                    continue;
                }
                let fill = [p.color[0] as f32 / 255.0, p.color[1] as f32 / 255.0, p.color[2] as f32 / 255.0, alpha];
                let rc = style.ring_color;
                self.marker(c, p.center_radius[3], ring, 0.0, fill, [rc[0], rc[1], rc[2], rc[3] * alpha]);
            }
        }
    }

    fn annotation_layer(&mut self, layer: &ChartAnnotationLayer, name: &str) {
        if layer.fills.is_empty() && layer.lines.is_empty() && layer.markers.is_empty() {
            return;
        }
        let _ = write!(self.out, "<g data-layer=\"{name}\">");
        self.fills(layer.fills);
        self.segments(layer.lines);
        self.markers(layer.markers);
        self.out.push_str("</g>");
    }

    fn group(&mut self, name: &str, body: impl FnOnce(&mut Self)) {
        let at = self.out.len();
        let _ = write!(self.out, "<g data-layer=\"{name}\">");
        let open = self.out.len();
        body(self);
        if self.out.len() == open {
            // Nothing written: drop the empty group
            self.out.truncate(at);
        } else {
            self.out.push_str("</g>");
        }
    }
}

impl ChartState {
    /// How this chart exports to SVG.
    #[allow(unreachable_patterns)]
    pub fn svg_support(&self) -> SvgSupport {
        match &self.kind {
            ChartKind::Scientific3D(_) => SvgSupport::Raster,
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) if l.layout.view == ChartViewMode::Flat => SvgSupport::Vector,
            ChartKind::Line(_) | ChartKind::Area(_) => SvgSupport::Raster,
            ChartKind::Bar(b) if b.layout.view == ChartViewMode::Flat => SvgSupport::Vector,
            ChartKind::Bar(_) => SvgSupport::Raster,
            ChartKind::Scatter(_) | ChartKind::Pie(_) | ChartKind::Box(_) | ChartKind::Candle(_) => SvgSupport::Vector,
            ChartKind::Heatmap(_) => SvgSupport::RasterPlot,
            // Built from the same staged layers (bars, strokes, fills, markers) as the kinds above
            ChartKind::Combo(_)
            | ChartKind::Radar(_)
            | ChartKind::Gauge(_)
            | ChartKind::Funnel(_)
            | ChartKind::Waterfall(_)
            | ChartKind::Hierarchy(_) => SvgSupport::Vector,
            // Kinds without an SVG writer yet embed the canvas (add them above once their marks
            // live in the staged layers this module writes)
            #[allow(unreachable_patterns)]
            _ => SvgSupport::Raster,
        }
    }

    /// Writes the staged marks of the last prepared frame as SVG (see the module docs).
    /// `max_marks` caps the instances written (0 = `SVG_DEFAULT_MAX_MARKS`); `id` prefixes
    /// element ids (clip path) so several exports can share a document.
    pub fn export_svg(&self, view: &ChartView, max_marks: usize, id: &str) -> SvgExport {
        let support = self.svg_support();
        let plot_css = self.axes.plot_css;
        let budget = Budget { left: if max_marks == 0 { SVG_DEFAULT_MAX_MARKS } else { max_marks }, used: 0, truncated: false };
        let mut w = Svg { view, out: String::new(), budget };
        if support == SvgSupport::Raster {
            return SvgExport { markup: String::new(), support, marks: 0, truncated: false, plot_css };
        }
        let id: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_').collect();
        let id = if id.is_empty() { "viz".to_string() } else { id };

        // Scissor of the clipped layers (CSS px), as the renderer applies it
        let clip = match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => l.clip_px(view),
            ChartKind::Scatter(s) => s.clip_px(view),
            ChartKind::Candle(c) => c.clip_px(view),
            _ => None,
        };
        let pr = view.pixel_ratio.max(0.1);
        let clip_css = clip.map(|[x, y, cw, ch]| [x as f32 / pr, y as f32 / pr, cw as f32 / pr, ch as f32 / pr]);
        if let Some([x, y, cw, ch]) = clip_css {
            let _ = write!(
                w.out,
                "<defs><clipPath id=\"{id}-plot\"><rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"{}\"/></clipPath></defs>",
                num(x),
                num(y),
                num(cw),
                num(ch)
            );
        }

        w.group("grid", |w| w.segments(&self.underlay));
        let (below, above) = self.annotations.layers();
        w.annotation_layer(&below, "annotations-below");

        let at = w.out.len();
        match clip_css {
            Some(_) => {
                let _ = write!(w.out, "<g data-layer=\"plot\" clip-path=\"url(#{id}-plot)\">");
            }
            None => w.out.push_str("<g data-layer=\"plot\">"),
        }
        let open = w.out.len();
        w.group("bars", |w| w.bars(&self.bars));
        // Hover / legend emphasis of tagged fills is applied by the GPU: resolve it the same way
        let fills = self.fill_style.resolved(&self.fills);
        w.group("fills", |w| w.fills(&fills));
        w.group("series", |w| {
            w.segments(&self.series);
            w.dashed(&self.styled.dashed);
            w.markers(&self.styled.markers);
        });
        let point_style = match &self.kind {
            ChartKind::Scatter(s) => Some(s.point_style(&self.hover_style)),
            ChartKind::Box(b) => Some(b.point_style(&self.hover_style)),
            _ => None,
        };
        if let Some(style) = point_style {
            let bounds = clip_css.unwrap_or([0.0, 0.0, view.viewport_px.0 as f32 / pr, view.viewport_px.1 as f32 / pr]);
            w.group("points", |w| w.points(&self.points, &style, bounds));
        }
        w.annotation_layer(&above, "annotations-above");
        w.annotation_layer(&self.brush.layer(), "brush");
        if w.out.len() == open {
            w.out.truncate(at);
        } else {
            w.out.push_str("</g>");
        }
        w.annotation_layer(&self.navigator.strip_layer(), "navigator");
        w.annotation_layer(&self.navigator.window_layer(), "navigator-window");

        SvgExport { markup: w.out, support, marks: w.budget.used, truncated: w.budget.truncated, plot_css }
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
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn count(s: &str, pat: &str) -> usize {
        s.matches(pat).count()
    }

    #[test]
    fn number_format_is_compact() {
        assert_eq!(num(1.0), "1");
        assert_eq!(num(1.256), "1.26");
        assert_eq!(num(-0.001), "0");
        assert_eq!(num(f32::NAN), "0");
        assert_eq!(rgb([1.0, 0.0, 0.5, 0.25]), ("rgb(255,0,128)".to_string(), 0.25));
    }

    #[test]
    fn line_series_merge_into_one_polyline_per_series() {
        let mut cam = flat_camera();
        let mut chart = ChartState::new_line(
            vec![
                LineSeries { values: (0..50).map(|i| i as f32).collect(), x: None, color: [1.0, 0.0, 0.0, 1.0], width_px: 2.0 },
                LineSeries { values: (0..50).map(|i| 50.0 - i as f32).collect(), x: None, color: [0.0, 0.0, 1.0, 0.5], width_px: 3.0 },
            ],
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.prepare_layers(&view(&cam));
        let svg = chart.export_svg(&view(&cam), 0, "t");
        assert_eq!(svg.support, SvgSupport::Vector);
        assert!(!svg.truncated);
        let series = svg.markup.split("data-layer=\"series\">").nth(1).unwrap().split("</g>").next().unwrap();
        assert_eq!(count(series, "<path"), 2, "{series}");
        assert!(series.contains("stroke=\"rgb(255,0,0)\" stroke-width=\"2\" stroke-linecap=\"round\""));
        assert!(series.contains("stroke=\"rgb(0,0,255)\" stroke-opacity=\"0.5\" stroke-width=\"3\""));
        assert_eq!(count(series, "L"), 2 * 49, "one vertex per segment end");
        // Gridlines: one path per line (not joined)
        assert!(svg.markup.contains("data-layer=\"grid\""));
        // Not zoomed: no clip path
        assert!(!svg.markup.contains("clipPath"));
        // Polyline endpoints sit inside the plot rectangle
        let [l, t, w, h] = svg.plot_css;
        let first = series.split("d=\"M").nth(1).unwrap();
        let mut xy = first.split(['L', ' ', '"']).take(2).map(|v| v.parse::<f32>().unwrap());
        let (x, y) = (xy.next().unwrap(), xy.next().unwrap());
        assert!((x - l).abs() < 0.5, "{x} vs {l}");
        assert!((y - (t + h)).abs() < 0.5 && w > 0.0, "{y}");
    }

    #[test]
    fn zoomed_line_is_clipped_to_the_scissor_rect() {
        let mut cam = flat_camera();
        let mut chart = ChartState::new_line(
            vec![LineSeries { values: (0..500).map(|i| (i as f32).sin()).collect(), x: None, color: [1.0; 4], width_px: 2.0 }],
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&view(&cam), 0.3, c.x);
        chart.prepare_layers(&view(&cam));
        let svg = chart.export_svg(&view(&cam), 0, "z1");
        assert!(svg.markup.contains("<clipPath id=\"z1-plot\">"));
        assert!(svg.markup.contains("clip-path=\"url(#z1-plot)\""));
    }

    #[test]
    fn bars_become_rounded_paths_and_the_budget_truncates() {
        let mut cam = flat_camera();
        let mut scene = SceneWorld::new();
        let mut chart = ChartState::new_bar(
            vec![10.0, 20.0, -5.0],
            vec![[0.2, 0.4, 0.8, 1.0]],
            BarLayout { width: 160.0, max_height: 80.0, bar_width: 0.0, corner_radius_px: 4.0, view: ChartViewMode::Flat },
            &mut scene,
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.prepare_layers(&view(&cam));
        let svg = chart.export_svg(&view(&cam), 0, "b");
        let bars = svg.markup.split("data-layer=\"bars\">").nth(1).unwrap().split("</g>").next().unwrap();
        assert_eq!(count(bars, "<path"), 3);
        assert_eq!(count(bars, "C"), 6, "two rounded corners per bar");
        assert!(bars.contains("fill=\"rgb(51,102,204)\""));
        let small = chart.export_svg(&view(&cam), 2, "b");
        assert!(small.truncated);
        assert_eq!(small.marks, 2);
    }

    #[test]
    fn scatter_points_are_culled_to_the_view_and_strided_to_the_budget() {
        let mut cam = flat_camera();
        let n = 1000;
        let mut chart = ChartState::new_scatter(
            ScatterPoints {
                xs: (0..n).map(|i| (i % 100) as f32).collect(),
                ys: (0..n).map(|i| (i / 100) as f32).collect(),
                ..Default::default()
            },
            ScatterLayout { width: 160.0, height: 80.0, ..Default::default() },
        );
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.prepare_layers(&view(&cam));
        let all = chart.export_svg(&view(&cam), 0, "s");
        let pts = |m: &str| count(m.split("data-layer=\"points\">").nth(1).unwrap_or(""), "<circle");
        assert_eq!(pts(&all.markup), n);
        let capped = chart.export_svg(&view(&cam), 100, "s");
        assert!(capped.truncated);
        assert!(pts(&capped.markup) <= 100 && pts(&capped.markup) >= 50);
        // Zoomed into a corner: points outside the plot are not written
        let c = cam.project_to_ndc(Vec3::new(-80.0, -40.0, 0.0)).unwrap();
        chart.zoom_xy(&view(&cam), 0.25, (c.x, c.y));
        chart.prepare_layers(&view(&cam));
        let zoomed = chart.export_svg(&view(&cam), 0, "s");
        assert!(pts(&zoomed.markup) < n / 4, "{}", pts(&zoomed.markup));
    }

    #[test]
    fn pie_slices_are_filled_paths_and_unsupported_views_fall_back() {
        let mut cam = flat_camera();
        let mut chart = ChartState::new_pie(&[3.0, 1.0], PieOptions::default(), PieStyle::default());
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        chart.prepare_layers(&view(&cam));
        let svg = chart.export_svg(&view(&cam), 0, "p");
        let fills = svg.markup.split("data-layer=\"fills\">").nth(1).unwrap().split("</g>").next().unwrap();
        assert_eq!(count(fills, "<path"), 2, "one path per slice color");
        let mut scene = SceneWorld::new();
        let depth = ChartState::new_bar(
            vec![1.0; 4],
            vec![],
            BarLayout { width: 100.0, max_height: 50.0, bar_width: 0.0, corner_radius_px: 0.0, view: ChartViewMode::Depth },
            &mut scene,
        );
        let out = depth.export_svg(&view(&cam), 0, "d");
        assert_eq!(out.support, SvgSupport::Raster);
        assert!(out.markup.is_empty());
    }
}
