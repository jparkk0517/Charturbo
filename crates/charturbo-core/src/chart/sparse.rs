//! Independent error bars and impulses on the shared Cartesian axes. Never use line M4:
//! each sample owns its marks, with no connections to neighbouring samples.
use super::*;
use super::line::DIMMED_SERIES_ALPHA;

#[derive(Debug, Clone)]
pub(crate) struct SparseSeries {
    pub(crate) low: Vec<f32>,
    pub(crate) high: Vec<f32>,
    pub(crate) baseline: Option<f32>,
    pub(crate) horizontal: bool,
    mode: u8,
    cap: f32,
    fraction: bool,
    step: f64,
    whiskers: bool,
    connector: bool,
    marker: bool,
    size: f32,
}

impl SparseSeries {
    pub(crate) fn y_extent(&self, from: usize, to: usize, positive: bool) -> (f32, f32) {
        let none = (f32::INFINITY, f32::NEG_INFINITY);
        if let Some(base) = self.baseline {
            return if positive && base <= 0.0 { none } else { (base, base) };
        }
        if self.horizontal { return none; }
        (from..to.min(self.low.len())).filter_map(|i| {
            let (a, b) = (self.low[i], self.high[i]);
            match self.mode {
                1 => Some([b, b]),
                2 => Some([a, a]),
                _ => (a.is_finite() && b.is_finite()).then_some([a, b]),
            }
        }).flatten().filter(|v| v.is_finite() && (!positive || *v > 0.0))
            .fold(none, |(lo, hi), v| (lo.min(v), hi.max(v)))
    }

    fn ends(&self, i: usize, center: f32) -> Option<(f32, f32)> {
        if !center.is_finite() { return None; }
        if let Some(base) = self.baseline { return Some((base, center)); }
        let (lo, hi) = (*self.low.get(i)?, *self.high.get(i)?);
        let ends = match self.mode { 1 => (center, hi), 2 => (lo, center), _ => (lo, hi) };
        (ends.0.is_finite() && ends.1.is_finite()).then_some(ends)
    }
}

#[derive(Default)]
struct Marks {
    segments: [Option<[f32; 4]>; 3],
    marker: Option<[f32; 2]>,
}

impl LineChart {
    fn sparse_x(&self, x: f64) -> f32 {
        self.x_of_t((self.x_data_to_abs(x) - self.x_min) / self.x_span)
    }

    fn sparse_marks(&self, s: usize, i: usize, css_world: f32) -> Marks {
        let mut out = Marks::default();
        let Some(st) = self.style.sparse.get(s).and_then(Option::as_ref) else { return out; };
        let v = self.vals(s)[i];
        let Some((a, b)) = st.ends(self.head[s] + i, v) else { return out; };
        if !self.drawable(s, v) { return out; }
        let (x, y) = (self.x_at(s, i), self.y_of_axis(self.axis_of(s), v));
        let value = |v: f32| if st.horizontal { self.sparse_x(v as f64) } else {
            if self.drawable(s, v) { self.y_of_axis(self.axis_of(s), v) } else { f32::NAN }
        };
        let (a, b) = (value(a), value(b));
        let cap = if st.fraction {
            if st.horizontal {
                (self.y_of_axis(self.axis_of(s), v + st.step as f32) - y).abs() * st.cap
            } else {
                let dx = if self.has_x() { st.step / self.x_span } else { 1.0 / self.len(s).saturating_sub(1).max(1) as f64 };
                (self.x_of_t(self.t_at64(s, i) + dx) - x).abs() * st.cap
            }
        } else { st.cap * css_world } * 0.5;
        if st.connector && a.is_finite() && b.is_finite() && a != b && self.series[s].width_px > 0.0 {
            out.segments[0] = Some(if st.horizontal { [a, y, b, y] } else { [x, a, x, b] });
        }
        if st.whiskers && cap > 0.0 && self.series[s].width_px > 0.0 {
            for (slot, end, show) in [(1, b, st.mode != 2), (2, a, st.mode != 1)] {
                if show && end.is_finite() {
                    out.segments[slot] = Some(if st.horizontal { [end, y - cap, end, y + cap] } else { [x - cap, end, x + cap, end] });
                }
            }
        }
        if st.marker && st.size > 0.0 { out.marker = Some([x, y]); }
        out
    }

    pub(crate) fn build_sparse(&self, s: usize, window: &LodWindow, ctx: &StyleCtx, out: &mut Vec<ChartSegmentRaw>, markers: &mut Vec<ChartMarkerRaw>) {
        let st = self.style.sparse[s].as_ref().unwrap();
        let css_world = ctx.pixel_ratio / self.px_per_world(window).max(1e-6);
        let z = self.z[s];
        let mut color = self.series[s].color;
        if self.emphasis.is_some_and(|e| e != s) { color[3] *= DIMMED_SERIES_ALPHA; }
        for i in 0..self.len(s) {
            let marks = self.sparse_marks(s, i, css_world);
            for p in marks.segments.into_iter().flatten() {
                if p[0].min(p[2]) > self.layout.width * 0.5 || p[0].max(p[2]) < -self.layout.width * 0.5 { continue; }
                out.push(ChartSegmentRaw { p0_width: [p[0], p[1], z, self.series[s].width_px], p1_pad: [p[2], p[3], z, 0.0], color });
            }
            if let Some([x, y]) = marks.marker {
                if x.abs() <= self.layout.width * 0.5 {
                    markers.push(ChartMarkerRaw { center_radius: [x, y, z, st.size * 0.5], fill: color, ring: color,
                        params: [0.0, if st.baseline.is_some() { 0.0 } else { 1.0 }, 0.0, 0.0] });
                }
            }
        }
    }

    /// Hit the actual enabled marks, including caps. Hidden connectors are not pickable.
    pub(crate) fn sparse_hover(&self, view: &ChartView, ndc: (f32, f32), style: &ChartHoverStyle) -> Option<HoverResult> {
        let window = self.view_window(view)?;
        let css_world = view.pixel_ratio / self.px_per_world(&window).max(1e-6);
        let cursor = view.ndc_to_px(ndc.0, ndc.1);
        let mut best: Option<(HoverItem, f32)> = None;
        for s in (0..self.series.len()).filter(|&s| self.visible[s]) {
            let Some(st) = self.style.sparse.get(s).and_then(Option::as_ref) else { continue; };
            for i in 0..self.len(s) {
                let marks = self.sparse_marks(s, i, css_world);
                let mut distance = f32::INFINITY;
                for p in marks.segments.into_iter().flatten() {
                    let Some(a) = view.project_px(Vec3::new(p[0], p[1], self.z[s])) else { continue; };
                    let Some(b) = view.project_px(Vec3::new(p[2], p[3], self.z[s])) else { continue; };
                    let (dx, dy) = (b.0 - a.0, b.1 - a.1);
                    let t = (((cursor.0 - a.0) * dx + (cursor.1 - a.1) * dy) / (dx * dx + dy * dy).max(1e-12)).clamp(0.0, 1.0);
                    distance = distance.min(((cursor.0 - a.0 - t * dx).powi(2) + (cursor.1 - a.1 - t * dy).powi(2)).sqrt() - self.series[s].width_px * view.pixel_ratio * 0.5);
                }
                if let Some([x, y]) = marks.marker {
                    if let Some(p) = view.project_px(Vec3::new(x, y, self.z[s])) {
                        distance = distance.min(((cursor.0 - p.0).powi(2) + (cursor.1 - p.1).powi(2)).sqrt() - st.size * view.pixel_ratio * 0.5);
                    }
                }
                if distance <= style.hit_radius_px * view.pixel_ratio && best.as_ref().is_none_or(|(_, d)| distance < *d) {
                    best = Some((HoverItem { series: s as u32, index: i as u32, value: self.vals(s)[i], global_id: self.offsets[s] + i as u32 }, distance));
                }
            }
        }
        best.map(|(item, _)| HoverResult { is_bar: false, primary: 0, items: vec![item] })
    }

    pub(crate) fn sparse_selected(&self, s: usize, i: usize, x: (f64, f64), y: Option<(f64, f64)>) -> bool {
        let st = self.style.sparse[s].as_ref().unwrap();
        let v = self.vals(s)[i];
        let Some((a, b)) = st.ends(self.head[s] + i, v) else { return false; };
        if !self.drawable(s, v) { return false; }
        let px = self.xs(s).map_or(i as f64, |xs| self.x_data(xs[i]));
        let (y0, y1) = y.unwrap_or((f64::NEG_INFINITY, f64::INFINITY));
        let inside = |xx: f64, yy: f64| xx >= x.0 && xx <= x.1 && yy >= y0 && yy <= y1;
        let end = |e: f32| if st.horizontal { inside(e as f64, v as f64) } else { inside(px, e as f64) };
        let stem = if st.horizontal { (a.min(b) as f64) <= x.1 && (a.max(b) as f64) >= x.0 && v as f64 >= y0 && v as f64 <= y1 }
            else { px >= x.0 && px <= x.1 && (a.min(b) as f64) <= y1 && (a.max(b) as f64) >= y0 };
        (st.connector && self.series[s].width_px > 0.0 && a != b && stem)
            || (st.whiskers && st.cap > 0.0 && self.series[s].width_px > 0.0 && ((st.mode != 1 && end(a)) || (st.mode != 2 && end(b))))
            || (st.marker && st.size > 0.0 && inside(px, v as f64))
    }
}

impl ChartState {
    pub fn set_impulse_series(&mut self, s: usize, baseline: f32, marker: bool, size: f32) -> Result<(), String> {
        if !baseline.is_finite() || !size.is_finite() || size < 0.0 { return Err("invalid impulse style".into()); }
        self.set_sparse(s, SparseSeries { low: vec![], high: vec![], baseline: Some(baseline), horizontal: false, mode: 0,
            cap: 0.0, fraction: false, step: 1.0, whiskers: false, connector: true, marker, size })
    }

    /// Style: direction, error mode, cap width, fractional cap, whiskers, connector, center, marker size.
    pub fn set_error_bar_series(&mut self, s: usize, mut low: Vec<f32>, mut high: Vec<f32>, style: &[f32]) -> Result<(), String> {
        if style.len() != 8 || style.iter().any(|v| !v.is_finite() || *v < 0.0) || style[0] > 1.0 || style[1] > 2.0 {
            return Err("invalid error bar style".into());
        }
        let ChartKind::Line(l) = &self.kind else { return Err("error bars need a line chart".into()); };
        if s >= l.series.len() || low.len() != l.len(s) || high.len() != l.len(s) { return Err("error bar length mismatch".into()); }
        for (lo, hi) in low.iter_mut().zip(&mut high) {
            if lo.is_finite() && hi.is_finite() && *lo > *hi { std::mem::swap(lo, hi); }
        }
        let horizontal = style[0] == 1.0;
        let categories: Vec<f64> = (0..l.len(s)).map(|i| if horizontal { l.vals(s)[i] as f64 } else { l.xs(s).map_or(i as f64, |xs| l.x_data(xs[i])) }).filter(|v| v.is_finite()).collect();
        let (min, max) = categories.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), &v| (a.min(v), b.max(v)));
        let step = if categories.len() > 1 && max > min { (max - min) / (categories.len() - 1) as f64 } else { 1.0 };
        self.set_sparse(s, SparseSeries { low, high, baseline: None, horizontal, mode: style[1] as u8,
            cap: style[2], fraction: style[3] != 0.0, step, whiskers: style[4] != 0.0, connector: style[5] != 0.0, marker: style[6] != 0.0, size: style[7] })
    }

    fn set_sparse(&mut self, s: usize, st: SparseSeries) -> Result<(), String> {
        let ChartKind::Line(l) = &mut self.kind else { return Err("sparse series need a line chart".into()); };
        if s >= l.series.len() || l.head[s] != 0 { return Err("invalid sparse series".into()); }
        l.style.sparse.resize(l.series.len(), None);
        l.style.sparse[s] = Some(st);
        l.style.rescan(s, &l.series[s].values);
        l.update_x_domain();
        l.update_min_gap();
        self.on_line_style_changed();
        Ok(())
    }
}
