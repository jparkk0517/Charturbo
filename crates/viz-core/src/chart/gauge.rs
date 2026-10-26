//! Gauge: arc geometry, threshold bands, needle / progress indicator, hover and label anchors.
//!
//! The arc sweeps clockwise from `start_angle_deg` to `end_angle_deg` (compass degrees, 0 = 12
//! o'clock) between `min` and `max`. Its pieces are tessellated like pie slices (pie.rs: chord
//! error <= 0.25 px, 2 px surface gaps, anti-aliased edges), so they are rebuilt when the
//! on-screen scale changes. Needle mode fills the ring with the threshold bands (track color
//! where no band covers it) and draws a needle (capsule segment) with a hub marker; progress mode
//! fills `[min, value]` in the color of the band containing the value (else the progress color),
//! leaves the rest as track, and shows the bands as a thin outer strip.
//!
//! `set_value` is cheap: the band geometry is cached per scale, so a value change re-tessellates
//! only the needle (series layer) or the two progress pieces (copied after the cached bands);
//! the label anchors keep their revision (the value text is DOM).

use super::pie::{polar, tessellate_slice, PieScreen, SliceShape};
use super::*;

/// World radius of the outer arc edge (the camera framing scales it to the plot).
pub(crate) const GAUGE_RADIUS: f32 = 50.0;
/// Progress mode: outer band strip offset / width beyond the arc (CSS px).
const STRIP_GAP_PX: f32 = 3.0;
const STRIP_PX: f32 = 4.0;
/// Needle stroke and hub radius (CSS px).
const NEEDLE_PX: f32 = 3.0;
const HUB_PX: f32 = 6.0;
/// Label anchor gaps (CSS px).
const LABEL_GAP_PX: f32 = 8.0;
/// Hover reaches this far beyond the ring (CSS px).
const HOVER_SLACK_PX: f32 = 8.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum GaugeIndicator {
    #[default]
    Needle,
    /// Filled arc from `min` to the value
    Progress,
}

impl GaugeIndicator {
    /// 0 = needle, 1 = progress
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::Progress
        } else {
            Self::Needle
        }
    }
}

/// Threshold band `[from, to]` in value units (clipped to `[min, max]`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GaugeBand {
    pub from: f64,
    pub to: f64,
    pub color: [f32; 4],
    /// Gets a label anchor (DOM text) beyond the arc
    pub labeled: bool,
    /// Input index (bands are re-ordered by `from`)
    pub source: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GaugeOptions {
    pub min: f64,
    pub max: f64,
    pub start_angle_deg: f32,
    pub end_angle_deg: f32,
    /// Ring thickness / outer radius (default 0.2; clamped to [0.04, 1])
    pub thickness: f32,
    pub indicator: GaugeIndicator,
    /// CSS px reserved beside (`[0]`) and below (`[1]`) the arc for band / min / max labels
    pub label_space_px: [f32; 2],
}

impl Default for GaugeOptions {
    fn default() -> Self {
        Self {
            min: 0.0,
            max: 100.0,
            start_angle_deg: -120.0,
            end_angle_deg: 120.0,
            thickness: 0.2,
            indicator: GaugeIndicator::Needle,
            label_space_px: [0.0, 0.0],
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GaugeStyle {
    /// Unfilled arc
    pub track: [f32; 4],
    /// Progress fill when the value is in no band
    pub progress: [f32; 4],
    pub needle: [f32; 4],
    /// Hub ring (chart surface)
    pub surface: [f32; 4],
}

impl Default for GaugeStyle {
    fn default() -> Self {
        Self {
            track: [0.13, 0.17, 0.24, 1.0],
            progress: [0.224, 0.529, 0.898, 1.0],
            needle: [0.94, 0.94, 0.93, 1.0],
            surface: CHART_SURFACE,
        }
    }
}

/// DOM label anchor (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GaugeLabel {
    /// 0 = min, 1 = max, 2 = value (center text), 3 = band (`index` = band)
    pub kind: u8,
    pub index: u32,
    pub x_css: f32,
    pub y_css: f32,
    /// -1 = text ends at the anchor, 0 = centered, 1 = starts there
    pub h_align: i8,
    /// -1 = text above the anchor, 0 = centered, 1 = below
    pub v_align: i8,
}

/// Screen layout and state of the gauge (DOM overlays).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GaugeLayoutInfo {
    pub center_css: (f32, f32),
    pub r_out_css: f32,
    pub r_in_css: f32,
    pub value: f64,
    /// Value clamped to `[min, max]` as a compass angle (degrees)
    pub angle_deg: f32,
    /// Band containing the value (the last one when bands overlap)
    pub band: Option<usize>,
    /// Hovered point id: 0 = value, `1 + k` = band `k`
    pub hovered: Option<usize>,
}

/// `min < max` (finite), the value finite or NaN (no value), bands finite with `from < to`.
pub fn validate_gauge(min: f64, max: f64, value: f64, bands: &[GaugeBand]) -> Result<(), String> {
    if !(min.is_finite() && max.is_finite() && min < max) {
        return Err(format!("gauge range must be finite with min < max (got {min}..{max})"));
    }
    if value.is_infinite() {
        return Err(format!("gauge value is {value}"));
    }
    match bands.iter().position(|b| !(b.from.is_finite() && b.to.is_finite() && b.from < b.to)) {
        Some(k) => Err(format!("gauge band {k} must be finite with from < to (got {}..{})", bands[k].from, bands[k].to)),
        None => Ok(()),
    }
}

#[derive(Debug, Clone)]
pub(crate) struct GaugeChart {
    pub(crate) opts: GaugeOptions,
    pub(crate) style: GaugeStyle,
    pub(crate) bands: Vec<GaugeBand>,
    pub(crate) value: f64,
    /// World center of the arc (the framed bounding box is centered on the origin)
    center: (f32, f32),
    /// Bounding box size of the arc and indicator (world)
    extent: (f32, f32),
    pub(crate) screen: Option<PieScreen>,
    /// Band / track pieces at `built` scale: fills and AA edges (needle mode: the whole ring)
    band_fills: Vec<ChartFillRaw>,
    band_edges: Vec<ChartSegmentRaw>,
    built: Option<f32>,
    labels: Vec<GaugeLabel>,
    labels_scratch: Vec<GaugeLabel>,
    labels_key: Option<([f32; 19], ChartPadding)>,
    labels_revision: u32,
}

impl GaugeChart {
    pub(crate) fn new(mut opts: GaugeOptions, mut bands: Vec<GaugeBand>, value: f64, style: GaugeStyle) -> Self {
        let clean = |v: f32, d: f32| if v.is_finite() { v } else { d };
        let d = GaugeOptions::default();
        opts.start_angle_deg = clean(opts.start_angle_deg, d.start_angle_deg);
        opts.end_angle_deg = clean(opts.end_angle_deg, d.end_angle_deg);
        if opts.end_angle_deg <= opts.start_angle_deg {
            opts.end_angle_deg = opts.start_angle_deg + 360.0;
        }
        opts.end_angle_deg = opts.end_angle_deg.min(opts.start_angle_deg + 360.0);
        opts.thickness = clean(opts.thickness, d.thickness).clamp(0.04, 1.0);
        opts.label_space_px = opts.label_space_px.map(|v| clean(v, 0.0).clamp(0.0, 2048.0));
        // Clip to the range, drop empty bands, sort by start (overlaps: the later band wins)
        let (lo, hi) = (opts.min, opts.max);
        bands.retain_mut(|b| {
            (b.from, b.to) = (b.from.max(lo), b.to.min(hi));
            b.from < b.to
        });
        bands.sort_by(|a, b| a.from.total_cmp(&b.from));
        let mut g = Self {
            opts,
            style,
            bands,
            value,
            center: (0.0, 0.0),
            extent: (2.0 * GAUGE_RADIUS, 2.0 * GAUGE_RADIUS),
            screen: None,
            band_fills: Vec::new(),
            band_edges: Vec::new(),
            built: None,
            labels: Vec::new(),
            labels_scratch: Vec::new(),
            labels_key: None,
            labels_revision: 0,
        };
        g.fit_extent();
        g
    }

    fn r_in(&self) -> f32 {
        GAUGE_RADIUS * (1.0 - self.opts.thickness)
    }

    /// Compass angle (radians) of value `v`, clamped to the arc.
    pub(crate) fn angle_of(&self, v: f64) -> f32 {
        let (a0, a1) = (self.opts.start_angle_deg.to_radians(), self.opts.end_angle_deg.to_radians());
        let t = if v.is_finite() { ((v - self.opts.min) / (self.opts.max - self.opts.min)).clamp(0.0, 1.0) as f32 } else { 0.0 };
        a0 + (a1 - a0) * t
    }

    /// Value at compass angle `phi` when it lies on the arc.
    fn value_at(&self, phi: f32) -> Option<f64> {
        let (a0, a1) = (self.opts.start_angle_deg.to_radians(), self.opts.end_angle_deg.to_radians());
        let a = a0 + (phi - a0).rem_euclid(std::f32::consts::TAU);
        (a <= a1 + 1e-6).then(|| self.opts.min + (self.opts.max - self.opts.min) * ((a - a0) / (a1 - a0)).clamp(0.0, 1.0) as f64)
    }

    /// Band containing value `v` (the last one, when bands overlap).
    pub(crate) fn band_of(&self, v: f64) -> Option<usize> {
        v.is_finite().then(|| self.bands.iter().rposition(|b| v >= b.from && v <= b.to)).flatten()
    }

    /// Bounding box of the ring (and the hub / value text area inside) centered on the origin.
    fn fit_extent(&mut self) {
        let (a0, a1) = (self.opts.start_angle_deg.to_radians(), self.opts.end_angle_deg.to_radians());
        let mut pts = Vec::new();
        for a in [a0, a1] {
            pts.push(polar((0.0, 0.0), a, GAUGE_RADIUS));
            pts.push(polar((0.0, 0.0), a, self.r_in()));
        }
        // Compass extremes (up / right / down / left) inside the sweep
        let first = (a0 / std::f32::consts::FRAC_PI_2).ceil() as i32;
        let last = (a1 / std::f32::consts::FRAC_PI_2).floor() as i32;
        for q in first..=last {
            pts.push(polar((0.0, 0.0), q as f32 * std::f32::consts::FRAC_PI_2, GAUGE_RADIUS));
        }
        // Hub / center value text
        pts.extend([(0.0, -0.18 * GAUGE_RADIUS), (0.0, 0.0)]);
        let (x0, x1) = pts.iter().fold((f32::MAX, f32::MIN), |(a, b), p| (a.min(p.0), b.max(p.0)));
        let (y0, y1) = pts.iter().fold((f32::MAX, f32::MIN), |(a, b), p| (a.min(p.1), b.max(p.1)));
        self.center = (-(x0 + x1) * 0.5, -(y0 + y1) * 0.5);
        self.extent = (x1 - x0, y1 - y0);
    }

    pub(crate) fn screen_of(&self, view: &ChartView) -> Option<PieScreen> {
        let c = view.project_css(Vec3::new(self.center.0, self.center.1, 0.0))?;
        let e = view.project_css(Vec3::new(self.center.0 + GAUGE_RADIUS, self.center.1, 0.0))?;
        let r = (e.0 - c.0).hypot(e.1 - c.1);
        (r > 1e-3).then_some(PieScreen { center_css: c, r_css: r, wpp: GAUGE_RADIUS / r })
    }

    /// Ring pieces `(from, to, color)` of needle mode: bands, and track where no band covers.
    /// Where bands overlap the one `band_of` reports (the later one) is painted, so the ring,
    /// hover and status always agree.
    fn ring_pieces(&self) -> Vec<(f64, f64, [f32; 4])> {
        let (lo, hi) = (self.opts.min, self.opts.max);
        let mut cuts: Vec<f64> = vec![lo, hi];
        cuts.extend(self.bands.iter().flat_map(|b| [b.from, b.to]));
        cuts.sort_by(f64::total_cmp);
        cuts.dedup();
        let mut out: Vec<(f64, f64, Option<usize>)> = Vec::new();
        for w in cuts.windows(2) {
            let k = self.band_of(0.5 * (w[0] + w[1]));
            match out.last_mut() {
                Some(last) if last.2 == k => last.1 = w[1],
                _ => out.push((w[0], w[1], k)),
            }
        }
        out.into_iter()
            .map(|(a, b, k)| (a, b, k.map_or(self.style.track, |k| self.bands[k].color)))
            .collect()
    }

    /// Tessellates value range `(from, to)` between radii `(r_out, r_in)`.
    fn piece(&self, (from, to): (f64, f64), (r_out, r_in): (f32, f32), wpp: f32, color: [f32; 4], fills: &mut Vec<ChartFillRaw>, edges: &mut Vec<ChartSegmentRaw>) {
        let full = (self.opts.end_angle_deg - self.opts.start_angle_deg) >= 359.99 && from <= self.opts.min && to >= self.opts.max;
        let shape = SliceShape { lo: self.angle_of(from), hi: self.angle_of(to), r_out, r_in, full };
        tessellate_slice(&shape, wpp, self.center, color, fills, edges);
    }

    /// Cached band geometry for scale `wpp` (needle: the ring; progress: the outer strip).
    fn build_bands(&mut self, wpp: f32) {
        let (mut fills, mut edges) = (std::mem::take(&mut self.band_fills), std::mem::take(&mut self.band_edges));
        fills.clear();
        edges.clear();
        match self.opts.indicator {
            GaugeIndicator::Needle => {
                for (from, to, c) in self.ring_pieces() {
                    self.piece((from, to), (GAUGE_RADIUS, self.r_in()), wpp, c, &mut fills, &mut edges);
                }
            }
            GaugeIndicator::Progress => {
                let r0 = GAUGE_RADIUS + STRIP_GAP_PX * wpp;
                for b in &self.bands {
                    self.piece((b.from, b.to), (r0 + STRIP_PX * wpp, r0), wpp, b.color, &mut fills, &mut edges);
                }
            }
        }
        self.band_fills = fills;
        self.band_edges = edges;
        self.built = Some(wpp);
    }

    /// Composes the layers from the cached bands plus the value-dependent marks. Without
    /// `with_fills` (needle mode value change) only the strokes / hub are rebuilt.
    fn build_value(
        &self,
        wpp: f32,
        with_fills: bool,
        fills: &mut Vec<ChartFillRaw>,
        edges: &mut Vec<ChartSegmentRaw>,
        markers: &mut Vec<ChartMarkerRaw>,
    ) {
        if with_fills {
            fills.clear();
            fills.extend_from_slice(&self.band_fills);
        }
        edges.clear();
        markers.clear();
        edges.extend_from_slice(&self.band_edges);
        let (lo, hi) = (self.opts.min, self.opts.max);
        match self.opts.indicator {
            GaugeIndicator::Progress => {
                let v = if self.value.is_finite() { self.value.clamp(lo, hi) } else { lo };
                let color = self.band_of(v).map_or(self.style.progress, |k| self.bands[k].color);
                if v > lo {
                    self.piece((lo, v), (GAUGE_RADIUS, self.r_in()), wpp, color, fills, edges);
                }
                if v < hi {
                    self.piece((v, hi), (GAUGE_RADIUS, self.r_in()), wpp, self.style.track, fills, edges);
                }
            }
            GaugeIndicator::Needle => {
                if !self.value.is_finite() {
                    return;
                }
                let r = self.r_in() + 0.6 * (GAUGE_RADIUS - self.r_in());
                let tip = polar(self.center, self.angle_of(self.value), r);
                let c = self.center;
                edges.push(ChartSegmentRaw { p0_width: [c.0, c.1, 0.05, NEEDLE_PX], p1_pad: [tip.0, tip.1, 0.05, 0.0], color: self.style.needle });
                markers.push(ChartMarkerRaw {
                    center_radius: [c.0, c.1, 0.05, HUB_PX],
                    fill: self.style.needle,
                    ring: self.style.surface,
                    params: [2.0, 0.0, 0.0, 0.0],
                });
            }
        }
    }

    /// Hover: a band under the pointer on the ring (id `1 + k`), else the value (id 0) anywhere
    /// inside the gauge.
    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let p = ray_hit_z_plane(&ray, 0.0)?;
        let wpp = self.screen_of(view)?.wpp;
        let (x, y) = (p.x - self.center.0, p.y - self.center.1);
        let r = x.hypot(y);
        let outer = GAUGE_RADIUS
            + if self.opts.indicator == GaugeIndicator::Progress && !self.bands.is_empty() { (STRIP_GAP_PX + STRIP_PX) * wpp } else { 0.0 }
            + HOVER_SLACK_PX * wpp;
        if r > outer {
            return None;
        }
        let on_arc = self.value_at(x.atan2(y));
        let id = match on_arc {
            Some(v) if r >= self.r_in() - HOVER_SLACK_PX * wpp => self.band_of(v).map_or(0, |k| k + 1),
            // Inside the ring (hub / value text) or the open side below the arc
            _ if r < self.r_in() => 0,
            _ => return None,
        };
        let value = if id == 0 { self.value } else { self.bands[id - 1].to };
        Some(HoverResult {
            is_bar: false,
            primary: 0,
            items: vec![HoverItem { series: 0, index: id as u32, value: value as f32, global_id: id as u32 }],
        })
    }

    /// `(0, id, value, point)`: id 0 = halfway along the needle (inside the ring, where the
    /// value hovers), `1 + k` = middle of band `k` on the ring.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let id = global_id as usize;
        let (v, at, r) = if id == 0 {
            (self.value, if self.value.is_finite() { self.value } else { self.opts.min }, 0.5 * self.r_in())
        } else {
            let b = self.bands.get(id - 1)?;
            (b.to, 0.5 * (b.from + b.to), 0.5 * (GAUGE_RADIUS + self.r_in()))
        };
        let p = polar(self.center, self.angle_of(at), r);
        Some((0, global_id, v as f32, Vec3::new(p.0, p.1, 0.0)))
    }

    pub(crate) fn len(&self) -> usize {
        1 + self.bands.len()
    }

    fn layout_labels(&mut self, screen: PieScreen) -> bool {
        let mut out = std::mem::take(&mut self.labels_scratch);
        out.clear();
        let (cx, cy) = screen.center_css;
        let (r, r_in) = (screen.r_css, screen.r_css * (1.0 - self.opts.thickness));
        let dir = |phi: f32| (phi.sin(), -phi.cos());
        let align = |c: f32| if c > 0.3 { 1 } else if c < -0.3 { -1 } else { 0 };
        let r_mid = 0.5 * (r + r_in);
        // Min / max under the ends of the arc
        for (kind, v) in [(0u8, self.opts.min), (1, self.opts.max)] {
            let d = dir(self.angle_of(v));
            out.push(GaugeLabel { kind, index: 0, x_css: cx + d.0 * r_mid, y_css: cy + d.1 * r_mid + 0.5 * (r - r_in) + 4.0, h_align: 0, v_align: 1 });
        }
        // Value: under the hub (needle) or centered in the ring (progress)
        let (vy, va) = match self.opts.indicator {
            GaugeIndicator::Needle => (cy + HUB_PX + LABEL_GAP_PX, 1),
            GaugeIndicator::Progress => (cy, if self.extent.1 < 1.6 * GAUGE_RADIUS { -1 } else { 0 }),
        };
        out.push(GaugeLabel { kind: 2, index: 0, x_css: cx, y_css: vy, h_align: 0, v_align: va });
        let strip = if self.opts.indicator == GaugeIndicator::Progress { STRIP_GAP_PX + STRIP_PX } else { 0.0 };
        for (k, b) in self.bands.iter().enumerate().filter(|(_, b)| b.labeled) {
            let d = dir(self.angle_of(0.5 * (b.from + b.to)));
            let rr = r + strip + LABEL_GAP_PX;
            out.push(GaugeLabel { kind: 3, index: k as u32, x_css: cx + d.0 * rr, y_css: cy + d.1 * rr, h_align: align(d.0), v_align: align(d.1) });
        }
        let changed = out != self.labels;
        if changed {
            self.labels_revision = self.labels_revision.wrapping_add(1);
            std::mem::swap(&mut self.labels, &mut out);
        }
        self.labels_scratch = out;
        changed
    }

    /// Plot rectangle = the ring's bounding box; no ticks.
    pub(crate) fn axes(&self, view: &ChartView, out: &mut AxisLayout) {
        out.ticks.clear();
        let (hw, hh) = (0.5 * self.extent.0, 0.5 * self.extent.1);
        out.plot_css = plot_rect_css(view, hw, -hh, hh, 0.0).unwrap_or([0.0; 4]);
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        let m = 4.0 + if self.opts.indicator == GaugeIndicator::Progress && !self.bands.is_empty() { STRIP_GAP_PX + STRIP_PX } else { 0.0 };
        let [sh, sv] = self.opts.label_space_px;
        let pad = [padding[0] + m + sv, padding[1] + m + sh, padding[2] + m + sv, padding[3] + m + sh];
        frame_flat(camera, css, self.extent.0, self.extent.1, &pad);
    }
}

impl ChartState {
    /// Creates a gauge from validated input (see `validate_gauge`).
    pub fn new_gauge(opts: GaugeOptions, bands: Vec<GaugeBand>, value: f64, style: GaugeStyle) -> Self {
        Self::with_kind(ChartKind::Gauge(GaugeChart::new(opts, bands, value, style)))
    }

    /// Moves the gauge to `value` (NaN = no value): rebuilds the needle / progress pieces only.
    /// Returns false without a gauge or for an infinite value.
    pub fn set_gauge_value(&mut self, value: f64) -> bool {
        let ChartKind::Gauge(g) = &mut self.kind else { return false };
        if value.is_infinite() {
            return false;
        }
        if g.value.to_bits() != value.to_bits() {
            g.value = value;
            self.dirty.series = true;
            self.dirty.fills |= g.opts.indicator == GaugeIndicator::Progress;
            // A hovered value item keeps its hover and reports the new value
            if let Some(item) = self.hover.as_mut().and_then(|h| h.items.first_mut()).filter(|i| i.global_id == 0) {
                item.value = value as f32;
            }
        }
        true
    }

    /// Band colors by input index (`GaugeBand::source`; missing = unchanged), e.g. palette
    /// bands on a theme change. Rebuilds the band geometry.
    pub fn set_gauge_band_colors(&mut self, colors: &[Option<[f32; 4]>]) {
        if let ChartKind::Gauge(g) = &mut self.kind {
            for b in &mut g.bands {
                if let Some(&Some(c)) = colors.get(b.source as usize) {
                    b.color = c;
                }
            }
            g.built = None;
        }
    }

    /// Track / progress / needle / surface colors of the gauge (theme change).
    pub fn set_gauge_style(&mut self, style: GaugeStyle) {
        if let ChartKind::Gauge(g) = &mut self.kind {
            g.style = style;
            g.built = None;
        }
    }

    pub fn gauge_labels(&self) -> Option<(&[GaugeLabel], u32)> {
        match &self.kind {
            ChartKind::Gauge(g) => Some((&g.labels, g.labels_revision)),
            _ => None,
        }
    }

    /// Bands after clipping / sorting (the order of `gauge_layout().band` and hover ids).
    pub fn gauge_bands(&self) -> Option<&[GaugeBand]> {
        match &self.kind {
            ChartKind::Gauge(g) => Some(&g.bands),
            _ => None,
        }
    }

    pub fn gauge_layout(&self) -> Option<GaugeLayoutInfo> {
        let ChartKind::Gauge(g) = &self.kind else { return None };
        let s = g.screen?;
        Some(GaugeLayoutInfo {
            center_css: s.center_css,
            r_out_css: s.r_css,
            r_in_css: s.r_css * (1.0 - g.opts.thickness),
            value: g.value,
            angle_deg: g.angle_of(g.value).to_degrees(),
            // The indicator pins out-of-range values to the ends: so does their band
            band: g.band_of(g.value.clamp(g.opts.min, g.opts.max)),
            hovered: self.hover.as_ref().and_then(|h| h.items.first()).map(|i| i.global_id as usize),
        })
    }

    /// Gauge part of `prepare_layers`: bands on scale / style changes, the indicator on value
    /// changes, label anchors when the view moved.
    pub(crate) fn prepare_gauge(&mut self, view: &ChartView) {
        let ChartKind::Gauge(g) = &mut self.kind else { return };
        let Some(screen) = g.screen_of(view) else { return };
        g.screen = Some(screen);
        let stale = g.built.is_none_or(|w| ((w - screen.wpp) / screen.wpp).abs() > 1e-4);
        if stale {
            g.build_bands(screen.wpp);
        }
        if stale || self.dirty.series || self.dirty.fills {
            // Progress pieces are fills: a progress value change sets `dirty.fills` as well
            let with_fills = stale || self.dirty.fills || g.opts.indicator == GaugeIndicator::Progress;
            g.build_value(screen.wpp, with_fills, &mut self.fills, &mut self.series, &mut self.styled.markers);
            self.styled.dashed.clear();
            self.dirty.series = true;
            self.dirty.fills = with_fills;
        }
        if self.dirty.underlay {
            self.underlay.clear();
        }
        if self.dirty.overlay {
            self.overlay.clear();
            self.markers.clear();
        }
        let key = (view.key(), self.padding);
        if g.labels_key != Some(key) {
            g.layout_labels(screen);
            g.labels_key = Some(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn band(from: f64, to: f64, c: f32) -> GaugeBand {
        GaugeBand { from, to, color: [c, 0.5, 0.5, 1.0], labeled: true, source: 0 }
    }

    fn gauge(opts: GaugeOptions, bands: Vec<GaugeBand>, value: f64) -> (ChartState, OrbitCamera) {
        validate_gauge(opts.min, opts.max, value, &bands).unwrap();
        let chart = ChartState::new_gauge(opts, bands, value, GaugeStyle::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(c: &ChartState) -> &GaugeChart {
        match &c.kind {
            ChartKind::Gauge(g) => g,
            _ => unreachable!(),
        }
    }

    fn ndc_at(cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let n = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        (n.x, n.y)
    }

    #[test]
    fn validation_angles_and_band_clipping() {
        assert!(validate_gauge(1.0, 1.0, 0.0, &[]).is_err());
        assert!(validate_gauge(0.0, 1.0, f64::INFINITY, &[]).is_err());
        assert!(validate_gauge(0.0, 1.0, f64::NAN, &[]).is_ok());
        assert!(validate_gauge(0.0, 1.0, 0.5, &[band(0.5, 0.2, 0.0)]).unwrap_err().contains("band 0"));
        let (c, _) = gauge(GaugeOptions::default(), vec![band(80.0, 140.0, 0.9), band(-10.0, 40.0, 0.1), band(200.0, 300.0, 0.5)], 50.0);
        let g = inner(&c);
        // Clipped to [0, 100], sorted, out-of-range band dropped
        assert_eq!(g.bands.iter().map(|b| (b.from, b.to)).collect::<Vec<_>>(), vec![(0.0, 40.0), (80.0, 100.0)]);
        // 240 degree sweep: 0 -> -120, 50 -> 0 (top), 100 -> 120
        assert!((g.angle_of(0.0).to_degrees() + 120.0).abs() < 1e-3);
        assert!(g.angle_of(50.0).abs() < 1e-5);
        assert!((g.angle_of(1000.0).to_degrees() - 120.0).abs() < 1e-3, "clamped");
        assert_eq!((g.band_of(30.0), g.band_of(60.0), g.band_of(90.0)), (Some(0), None, Some(1)));
        // Ring pieces: band, track gap, band
        let pieces = g.ring_pieces();
        assert_eq!(pieces.len(), 3);
        assert_eq!(pieces[1].2, GaugeStyle::default().track);
        // Overlapping bands: the later one is painted where `band_of` reports it
        let (o, _) = gauge(GaugeOptions::default(), vec![band(0.0, 60.0, 0.1), band(50.0, 100.0, 0.9)], 55.0);
        let g2 = inner(&o);
        assert_eq!(g2.band_of(55.0), Some(1));
        let p: Vec<(f64, f64, f32)> = g2.ring_pieces().iter().map(|p| (p.0, p.1, p.2[0])).collect();
        assert_eq!(p, vec![(0.0, 50.0, 0.1), (50.0, 100.0, 0.9)]);
        assert_eq!(o.gauge_layout(), None, "no frame yet");
        // Bounding box: 240 degree arc is wider than tall, centered on the origin
        assert!(g.extent.0 > g.extent.1);
        assert!((g.center.1 + 0.25 * GAUGE_RADIUS).abs() < 1e-3 && (g.extent.1 - 1.5 * GAUGE_RADIUS).abs() < 1e-3);
    }

    #[test]
    fn needle_value_updates_skip_the_band_geometry() {
        let (mut c, cam) = gauge(GaugeOptions::default(), vec![band(0.0, 60.0, 0.1), band(60.0, 100.0, 0.9)], 30.0);
        let v = view(&cam);
        let layers = c.prepare_layers(&v);
        let fills = layers.fills.unwrap().len();
        assert!(fills > 60);
        let series = layers.series.unwrap().to_vec();
        let needle = *series.last().unwrap();
        assert_eq!(needle.p0_width[3], NEEDLE_PX);
        assert_eq!(c.gauge_layout().unwrap().band, Some(0));
        let rev = c.gauge_labels().unwrap().1;
        // Value change: same fills (not re-uploaded), new needle, same labels
        assert!(c.set_gauge_value(75.0));
        let layers = c.prepare_layers(&v);
        assert!(layers.fills.is_none(), "needle mode: bands untouched");
        let moved = *layers.series.unwrap().last().unwrap();
        assert!(moved.p1_pad[0] > 0.0 && needle.p1_pad[0] < 0.0, "needle swung right");
        assert_eq!(c.gauge_labels().unwrap().1, rev);
        assert_eq!(c.gauge_layout().unwrap().band, Some(1));
        // Hub marker
        assert_eq!(c.styled.markers.len(), 1);
        // A hovered value keeps its hover and reports the new value
        let center = inner(&c).center;
        let mut scene = SceneWorld::new();
        c.hover_at(&v, &mut scene, ndc_at(&cam, center.0, center.1)).unwrap();
        c.set_gauge_value(12.0);
        assert_eq!(c.hover.as_ref().unwrap().items[0].value, 12.0);
        // Band recolor (theme): by input index, geometry rebuilt
        c.set_gauge_band_colors(&[Some([0.0, 0.0, 1.0, 1.0])]);
        assert!(c.prepare_layers(&v).fills.unwrap().iter().any(|f| f.color == [0.0, 0.0, 1.0, 1.0]));
        assert!(!c.set_gauge_value(f64::INFINITY));
    }

    #[test]
    fn progress_mode_fills_up_to_the_value_in_its_band_color() {
        let opts = GaugeOptions { indicator: GaugeIndicator::Progress, ..Default::default() };
        let (mut c, cam) = gauge(opts, vec![band(0.0, 50.0, 0.1), band(50.0, 100.0, 0.9)], 75.0);
        let v = view(&cam);
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        let in_band = fills.iter().filter(|f| f.color[0] == 0.9).count();
        c.set_gauge_value(25.0);
        let after = c.prepare_layers(&v).fills.unwrap().to_vec();
        // The strip keeps its geometry; the progress piece changed color with the band
        assert!(after.iter().filter(|f| f.color[0] == 0.1).count() > fills.iter().filter(|f| f.color[0] == 0.1).count());
        assert!(after.iter().filter(|f| f.color[0] == 0.9).count() < in_band);
        // Strip beyond the ring
        let max_r = after.iter().map(|f| (f.position[0] - inner(&c).center.0).hypot(f.position[1] - inner(&c).center.1)).fold(0.0f32, f32::max);
        assert!(max_r > GAUGE_RADIUS);
        // Value at the max: no track piece; at the min: no progress piece
        c.set_gauge_value(100.0);
        let full = c.prepare_layers(&v).fills.unwrap().to_vec();
        assert!(!full.iter().any(|f| f.color == GaugeStyle::default().track));
    }

    #[test]
    fn hover_bands_and_value_and_labels() {
        let (mut c, cam) = gauge(GaugeOptions::default(), vec![band(0.0, 50.0, 0.1), band(80.0, 100.0, 0.9)], 42.0);
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        c.prepare_layers(&v);
        let g = inner(&c).clone();
        let r_mid = 0.5 * (GAUGE_RADIUS + g.r_in());
        let at = |val: f64, r: f32| {
            let p = polar(g.center, g.angle_of(val), r);
            ndc_at(&cam, p.0, p.1)
        };
        assert_eq!(c.hover_at(&v, &mut scene, at(25.0, r_mid)).unwrap().items[0].global_id, 1);
        assert_eq!(c.hover_at(&v, &mut scene, at(90.0, r_mid)).unwrap().items[0].global_id, 2);
        // Track between the bands and the hub: the value
        let hit = c.hover_at(&v, &mut scene, at(65.0, r_mid)).unwrap();
        assert_eq!((hit.items[0].global_id, hit.items[0].value), (0, 42.0));
        assert_eq!(c.hover_at(&v, &mut scene, ndc_at(&cam, g.center.0, g.center.1)).unwrap().items[0].global_id, 0);
        // Outside
        assert!(c.hover_at(&v, &mut scene, at(50.0, GAUGE_RADIUS * 1.4)).is_none());
        // Samples hover themselves (keyboard)
        for id in 0..3u32 {
            let p = c.sample(id).unwrap().3;
            assert_eq!(c.hover_at(&v, &mut scene, ndc_at(&cam, p.x, p.y)).unwrap().items[0].global_id, id);
        }
        // Labels: min, max, value, two bands; min on the left below the arc end
        let (labels, _) = c.gauge_labels().unwrap();
        assert_eq!(labels.iter().map(|l| l.kind).collect::<Vec<_>>(), vec![0, 1, 2, 3, 3]);
        let lay = c.gauge_layout().unwrap();
        assert!(labels[0].x_css < lay.center_css.0 && labels[1].x_css > lay.center_css.0);
        assert!(labels[2].y_css > lay.center_css.1);
    }
}
