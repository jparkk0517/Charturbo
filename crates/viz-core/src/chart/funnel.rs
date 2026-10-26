//! Funnel chart: stage widths, conversion rates, tessellation, hover and label anchors in Rust.
//!
//! Stages run top to bottom (vertical) or left to right (horizontal) in equal steps along the
//! flow axis; across it each stage spans its value's share of the largest value (at least
//! `min_width`). A trapezoid stage narrows from its own width to the next stage's (the last one
//! keeps its width); a bar stage is a centered rectangle. Every stage is a convex polygon
//! filled with anti-aliased edges (shape.rs) and a 2 px surface gap to its neighbours, so stages
//! are rebuilt when the on-screen scale or the hovered stage changes. Conversion rates (of the
//! first and of the previous stage) are computed here; the DOM only places the label text.

use super::shape::aa_polygon;
use super::*;

/// World size of the funnel: `(across, along the flow)` of a vertical funnel (swapped for a
/// horizontal one).
const FUNNEL_SIZE_V: (f32, f32) = (100.0, 80.0);
const FUNNEL_SIZE_H: (f32, f32) = (70.0, 160.0);
/// Surface gap between stages (CSS px).
pub const FUNNEL_GAP_PX: f32 = 2.0;
/// Label anchor distance from the funnel (CSS px).
const LABEL_GAP_PX: f32 = 12.0;
/// Hover reaches this far beside a stage (CSS px), so thin stages stay easy to hit.
const HOVER_SLACK_PX: f32 = 6.0;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FunnelOrientation {
    /// First stage on top
    #[default]
    Vertical,
    /// First stage on the left
    Horizontal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum FunnelShape {
    /// Each stage narrows to the next stage's width
    #[default]
    Trapezoid,
    /// Centered rectangles
    Bar,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FunnelOptions {
    pub orientation: FunnelOrientation,
    pub shape: FunnelShape,
    /// Narrowest stage as a fraction of the widest (default 0.02)
    pub min_width: f32,
    /// CSS px reserved for labels: right of a vertical funnel / below a horizontal one
    pub label_space_px: f32,
}

impl Default for FunnelOptions {
    fn default() -> Self {
        Self { orientation: FunnelOrientation::Vertical, shape: FunnelShape::Trapezoid, min_width: 0.02, label_space_px: 0.0 }
    }
}

/// One stage with its conversion rates.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FunnelStage {
    pub value: f64,
    /// Percent of the first stage (NaN when the first stage is 0)
    pub pct_first: f64,
    /// Percent of the previous stage (100 for the first; NaN after a 0 stage)
    pub pct_prev: f64,
    pub color: [f32; 4],
}

/// DOM label anchor of a stage (CSS px from the canvas top-left).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct FunnelLabel {
    pub stage: u32,
    pub x_css: f32,
    pub y_css: f32,
    /// Vertical funnels: 1 = text starts at the anchor (right of the funnel); horizontal: 0
    pub h_align: i8,
    /// Horizontal funnels: 1 = text below the anchor; vertical: 0 (centered)
    pub v_align: i8,
}

/// Every value must be finite and >= 0.
pub fn validate_funnel(values: &[f64]) -> Result<(), String> {
    match values.iter().position(|v| !v.is_finite() || *v < 0.0) {
        Some(i) => Err(format!("funnel value {i} is {} (values must be finite and >= 0)", values[i])),
        None => Ok(()),
    }
}

/// Stages with conversion rates (percent of the first / previous stage).
pub fn funnel_stages(values: &[f64], colors: &[[f32; 4]]) -> Vec<FunnelStage> {
    let first = values.first().copied().unwrap_or(0.0);
    let pct = |v: f64, of: f64| if of > 0.0 { v / of * 100.0 } else { f64::NAN };
    values
        .iter()
        .enumerate()
        .map(|(i, &value)| FunnelStage {
            value,
            pct_first: pct(value, first),
            pct_prev: if i == 0 { 100.0 } else { pct(value, values[i - 1]) },
            color: colors.get(i).or(colors.last()).copied().unwrap_or([0.224, 0.529, 0.898, 1.0]),
        })
        .collect()
}

#[derive(Debug, Clone)]
pub(crate) struct FunnelChart {
    pub(crate) opts: FunnelOptions,
    pub(crate) stages: Vec<FunnelStage>,
    /// Cross-axis width of each stage's top / start (world)
    widths: Vec<f32>,
    /// `(across, along)` world size
    size: (f32, f32),
    /// Scale and hovered stage the buffers were built for
    built: Option<(f32, Option<usize>)>,
    labels: Vec<FunnelLabel>,
    labels_scratch: Vec<FunnelLabel>,
    labels_key: Option<([f32; 19], ChartPadding)>,
    labels_revision: u32,
}

impl FunnelChart {
    pub(crate) fn new(values: &[f64], colors: &[[f32; 4]], mut opts: FunnelOptions) -> Self {
        opts.min_width = if opts.min_width.is_finite() { opts.min_width.clamp(0.0, 1.0) } else { 0.02 };
        opts.label_space_px = if opts.label_space_px.is_finite() { opts.label_space_px.clamp(0.0, 2048.0) } else { 0.0 };
        let size = match opts.orientation {
            FunnelOrientation::Vertical => FUNNEL_SIZE_V,
            FunnelOrientation::Horizontal => FUNNEL_SIZE_H,
        };
        let max = values.iter().copied().fold(0.0f64, f64::max);
        let widths = values
            .iter()
            .map(|&v| {
                let share = if max > 0.0 { (v / max) as f32 } else { 0.0 };
                share.max(opts.min_width) * size.0
            })
            .collect();
        Self {
            opts,
            stages: funnel_stages(values, colors),
            widths,
            size,
            built: None,
            labels: Vec::new(),
            labels_scratch: Vec::new(),
            labels_key: None,
            labels_revision: 0,
        }
    }

    pub(crate) fn len(&self) -> usize {
        self.stages.len()
    }

    pub(crate) fn set_colors(&mut self, colors: &[[f32; 4]]) {
        for (i, s) in self.stages.iter_mut().enumerate() {
            s.color = colors.get(i).or(colors.last()).copied().unwrap_or(s.color);
        }
        self.built = None;
    }

    /// Flow-axis step per stage (world).
    fn step(&self) -> f32 {
        self.size.1 / self.len().max(1) as f32
    }

    /// World point of flow position `f` (0 = start of the first stage) and cross position `c`
    /// (0 = the funnel's axis).
    fn world(&self, f: f32, c: f32) -> (f32, f32) {
        let half = 0.5 * self.size.1;
        match self.opts.orientation {
            FunnelOrientation::Vertical => (c, half - f),
            FunnelOrientation::Horizontal => (f - half, c),
        }
    }

    /// Inverse of `world`: `(flow, cross)`.
    fn logical(&self, x: f32, y: f32) -> (f32, f32) {
        let half = 0.5 * self.size.1;
        match self.opts.orientation {
            FunnelOrientation::Vertical => (half - y, x),
            FunnelOrientation::Horizontal => (x + half, y),
        }
    }

    /// Cross-axis widths at the start and end of stage `i`.
    fn stage_widths(&self, i: usize) -> (f32, f32) {
        let w0 = self.widths[i];
        match self.opts.shape {
            FunnelShape::Bar => (w0, w0),
            FunnelShape::Trapezoid => (w0, self.widths.get(i + 1).copied().unwrap_or(w0)),
        }
    }

    /// Half-width of stage `i` at fraction `t` (0..1) along it.
    fn half_at(&self, i: usize, t: f32) -> f32 {
        let (a, b) = self.stage_widths(i);
        0.5 * (a + (b - a) * t)
    }

    /// Stage fills and AA outlines at scale `wpp`; the hovered stage is lightened.
    pub(crate) fn build(&self, wpp: f32, hovered: Option<usize>, fills: &mut Vec<ChartFillRaw>, edges: &mut Vec<ChartSegmentRaw>) {
        fills.clear();
        edges.clear();
        let step = self.step();
        // Half the gap off both flow ends, as a fraction of the stage
        let g = (0.5 * FUNNEL_GAP_PX * wpp / step).min(0.45);
        for (i, s) in self.stages.iter().enumerate() {
            let f0 = i as f32 * step;
            let (ta, tb) = if self.len() == 1 { (0.0, 1.0) } else { (if i == 0 { 0.0 } else { g }, if i + 1 == self.len() { 1.0 } else { 1.0 - g }) };
            let (fa, fb) = (f0 + ta * step, f0 + tb * step);
            let (ha, hb) = (self.half_at(i, ta), self.half_at(i, tb));
            let pts = [self.world(fa, -ha), self.world(fa, ha), self.world(fb, hb), self.world(fb, -hb)];
            let color = if hovered == Some(i) { lighten(s.color, 0.22) } else { s.color };
            aa_polygon(&pts, wpp, 0.0, color, fills, edges);
        }
    }

    /// Stage under world point `(x, y)` (`wpp` = world per CSS px).
    pub(crate) fn stage_at(&self, x: f32, y: f32, wpp: f32) -> Option<usize> {
        let (f, c) = self.logical(x, y);
        if f < 0.0 || f >= self.size.1 || self.stages.is_empty() {
            return None;
        }
        let step = self.step();
        let i = ((f / step) as usize).min(self.len() - 1);
        let t = (f - i as f32 * step) / step;
        (c.abs() <= self.half_at(i, t) + HOVER_SLACK_PX * wpp).then_some(i)
    }

    fn wpp(view: &ChartView) -> Option<f32> {
        let a = view.project_css(Vec3::ZERO)?;
        let b = view.project_css(Vec3::new(10.0, 0.0, 0.0))?;
        let d = (b.0 - a.0).hypot(b.1 - a.1);
        (d > 1e-6).then_some(10.0 / d)
    }

    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let p = ray_hit_z_plane(&ray, 0.0)?;
        let i = self.stage_at(p.x, p.y, Self::wpp(view)?)?;
        Some(HoverResult {
            is_bar: true,
            primary: 0,
            items: vec![HoverItem { series: 0, index: i as u32, value: self.stages[i].value as f32, global_id: i as u32 }],
        })
    }

    /// `(0, stage, value, stage center)`.
    pub(crate) fn sample(&self, global_id: u32) -> Option<(u32, u32, f32, Vec3)> {
        let i = global_id as usize;
        let s = self.stages.get(i)?;
        let (x, y) = self.world((i as f32 + 0.5) * self.step(), 0.0);
        Some((0, global_id, s.value as f32, Vec3::new(x, y, 0.0)))
    }

    /// One anchor per stage beside (vertical) / below (horizontal) the funnel's widest extent.
    fn layout_labels(&mut self, view: &ChartView) -> bool {
        let mut out = std::mem::take(&mut self.labels_scratch);
        out.clear();
        let step = self.step();
        let edge = 0.5 * self.size.0;
        for i in 0..self.len() {
            let mid = (i as f32 + 0.5) * step;
            let (x, y) = self.world(mid, edge);
            let Some((cx, cy)) = view.project_css(Vec3::new(x, y, 0.0)) else { continue };
            out.push(match self.opts.orientation {
                FunnelOrientation::Vertical => FunnelLabel { stage: i as u32, x_css: cx + LABEL_GAP_PX, y_css: cy, h_align: 1, v_align: 0 },
                // Cross axis is world +y: the label goes below the bottom (-y) edge
                FunnelOrientation::Horizontal => {
                    let (bx, by) = self.world(mid, -edge);
                    let (bx, by) = view.project_css(Vec3::new(bx, by, 0.0)).unwrap_or((cx, cy));
                    FunnelLabel { stage: i as u32, x_css: bx, y_css: by + LABEL_GAP_PX * 0.5, h_align: 0, v_align: 1 }
                }
            });
        }
        let changed = out != self.labels;
        if changed {
            self.labels_revision = self.labels_revision.wrapping_add(1);
            std::mem::swap(&mut self.labels, &mut out);
        }
        self.labels_scratch = out;
        changed
    }

    fn rect(&self) -> (f32, f32) {
        match self.opts.orientation {
            FunnelOrientation::Vertical => (self.size.0, self.size.1),
            FunnelOrientation::Horizontal => (self.size.1, self.size.0),
        }
    }

    pub(crate) fn axes(&self, view: &ChartView, out: &mut AxisLayout) {
        out.ticks.clear();
        let (w, h) = self.rect();
        out.plot_css = plot_rect_css(view, 0.5 * w, -0.5 * h, 0.5 * h, 0.0).unwrap_or([0.0; 4]);
    }

    /// Fits the funnel into the padded plot, keeping the label room right / below.
    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        let mut pad = *padding;
        match self.opts.orientation {
            FunnelOrientation::Vertical => pad[1] += self.opts.label_space_px,
            FunnelOrientation::Horizontal => pad[2] += self.opts.label_space_px,
        }
        let (w, h) = self.rect();
        frame_flat(camera, css, w, h, &pad);
    }
}

impl ChartState {
    /// Creates a funnel from validated values (see `validate_funnel`); `colors` one per stage
    /// (the last repeats).
    pub fn new_funnel(values: &[f64], colors: &[[f32; 4]], opts: FunnelOptions) -> Self {
        Self::with_kind(ChartKind::Funnel(FunnelChart::new(values, colors, opts)))
    }

    pub fn set_funnel_colors(&mut self, colors: &[[f32; 4]]) {
        if let ChartKind::Funnel(f) = &mut self.kind {
            f.set_colors(colors);
        }
    }

    pub fn funnel_stages(&self) -> Option<&[FunnelStage]> {
        match &self.kind {
            ChartKind::Funnel(f) => Some(&f.stages),
            _ => None,
        }
    }

    pub fn funnel_labels(&self) -> Option<(&[FunnelLabel], u32)> {
        match &self.kind {
            ChartKind::Funnel(f) => Some((&f.labels, f.labels_revision)),
            _ => None,
        }
    }

    /// Funnel part of `prepare_layers`.
    pub(crate) fn prepare_funnel(&mut self, view: &ChartView) {
        let hovered = self.hover.as_ref().and_then(|h| h.items.first()).map(|i| i.index as usize);
        let ChartKind::Funnel(f) = &mut self.kind else { return };
        let Some(wpp) = FunnelChart::wpp(view) else { return };
        let stale = f.built.is_none_or(|(w, h)| h != hovered || ((w - wpp) / wpp).abs() > 1e-4);
        if stale || self.dirty.fills {
            f.build(wpp, hovered, &mut self.fills, &mut self.series);
            f.built = Some((wpp, hovered));
            self.styled.dashed.clear();
            self.styled.markers.clear();
            self.dirty.fills = true;
            self.dirty.series = true;
        }
        if self.dirty.underlay {
            self.underlay.clear();
        }
        if self.dirty.overlay {
            self.overlay.clear();
            self.markers.clear();
        }
        let key = (view.key(), self.padding);
        if f.labels_key != Some(key) {
            f.layout_labels(view);
            f.labels_key = Some(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn funnel(values: &[f64], opts: FunnelOptions) -> (ChartState, OrbitCamera) {
        validate_funnel(values).unwrap();
        let chart = ChartState::new_funnel(values, &[[0.2, 0.5, 0.9, 1.0]], opts);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn inner(c: &ChartState) -> &FunnelChart {
        match &c.kind {
            ChartKind::Funnel(f) => f,
            _ => unreachable!(),
        }
    }

    fn ndc_at(cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let n = cam.project_to_ndc(Vec3::new(x, y, 0.0)).unwrap();
        (n.x, n.y)
    }

    #[test]
    fn conversion_rates_of_first_and_previous() {
        assert!(validate_funnel(&[1.0, -1.0]).unwrap_err().contains("value 1"));
        assert!(validate_funnel(&[f64::NAN]).is_err());
        let s = funnel_stages(&[1000.0, 400.0, 100.0, 0.0, 0.0], &[]);
        assert_eq!(s.iter().map(|x| x.pct_first).collect::<Vec<_>>()[..4], [100.0, 40.0, 10.0, 0.0]);
        assert_eq!(s[1].pct_prev, 40.0);
        assert_eq!(s[2].pct_prev, 25.0);
        assert!(s[4].pct_prev.is_nan(), "after a zero stage");
        assert!(funnel_stages(&[0.0, 0.0], &[])[1].pct_first.is_nan());
    }

    #[test]
    fn stages_narrow_with_two_pixel_gaps_and_hover_follows_the_shape() {
        let (mut c, cam) = funnel(&[100.0, 60.0, 30.0], FunnelOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let layers = c.prepare_layers(&v);
        let fills = layers.fills.unwrap().to_vec();
        assert_eq!(fills.len(), 3 * 6, "one quad per stage");
        assert_eq!(layers.series.unwrap().len(), 12, "AA outlines");
        let f = inner(&c).clone();
        let wpp = FunnelChart::wpp(&v).unwrap();
        // Gap between stage 0 bottom and stage 1 top: 2 px of surface (+ the AA insets)
        let bottom0 = fills[..6].iter().map(|p| p.position[1]).fold(f32::MAX, f32::min);
        let top1 = fills[6..12].iter().map(|p| p.position[1]).fold(f32::MIN, f32::max);
        assert!((((bottom0 - top1) / wpp) - (FUNNEL_GAP_PX + 1.0)).abs() < 1e-2, "{}", (bottom0 - top1) / wpp);
        // Stage 0 narrows from 100% to 60% of the width
        let top_w = fills[..6].iter().filter(|p| p.position[1] > bottom0 + 1.0).map(|p| p.position[0]).fold(f32::MIN, f32::max);
        assert!((top_w - 0.5 * FUNNEL_SIZE_V.0).abs() < 1.0);
        // Hover: inside stage 1, and the slanted edge (outside the narrow end) misses
        let (x, y) = f.world(1.5 * f.step(), 0.0);
        let hit = c.hover_at(&v, &mut scene, ndc_at(&cam, x, y)).unwrap();
        assert_eq!((hit.items[0].index, hit.items[0].value), (1, 60.0));
        let (x, y) = f.world(2.9 * f.step(), 0.45 * FUNNEL_SIZE_V.0);
        assert!(c.hover_at(&v, &mut scene, ndc_at(&cam, x, y)).is_none());
        // The hovered stage is re-tinted
        let (x, y) = f.world(0.5 * inner(&c).step(), 0.0);
        c.hover_at(&v, &mut scene, ndc_at(&cam, x, y));
        let after = c.prepare_layers(&v).fills.unwrap().to_vec();
        assert_ne!(after[0].color, fills[0].color);
        assert_eq!(after[6].color, fills[6].color);
        // Samples hover their own stage
        for i in 0..3u32 {
            let p = c.sample(i).unwrap().3;
            assert_eq!(c.hover_at(&v, &mut scene, ndc_at(&cam, p.x, p.y)).unwrap().items[0].index, i);
        }
    }

    #[test]
    fn horizontal_and_bar_shapes_and_labels() {
        let (mut c, cam) = funnel(&[10.0, 5.0], FunnelOptions { orientation: FunnelOrientation::Horizontal, shape: FunnelShape::Bar, ..Default::default() });
        let v = view(&cam);
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        // Stage 0 on the left, a full-height bar; stage 1 half as tall
        let h = |r: &[ChartFillRaw]| r.iter().map(|p| p.position[1]).fold(f32::MIN, f32::max) - r.iter().map(|p| p.position[1]).fold(f32::MAX, f32::min);
        assert!((h(&fills[..6]) / h(&fills[6..]) - 2.0).abs() < 0.05);
        assert!(fills[0].position[0] < fills[6].position[0]);
        let (labels, _) = c.funnel_labels().unwrap();
        assert_eq!(labels.len(), 2);
        assert!(labels.iter().all(|l| l.v_align == 1 && l.h_align == 0));
        assert!(labels[0].x_css < labels[1].x_css);
        let plot = c.axes().plot_css;
        assert!(labels[0].y_css > plot[1] + plot[3]);
        // Vertical labels sit right of the widest stage
        let (mut vc, cam) = funnel(&[10.0, 5.0], FunnelOptions { label_space_px: 160.0, ..Default::default() });
        vc.prepare_layers(&view(&cam));
        let plot = vc.axes().plot_css;
        let (labels, _) = vc.funnel_labels().unwrap();
        assert!(labels.iter().all(|l| l.x_css > plot[0] + plot[2] && l.h_align == 1));
        assert!(labels[0].y_css < labels[1].y_css);
        // Zero stages keep a sliver (min width)
        let (z, _) = funnel(&[10.0, 0.0], FunnelOptions::default());
        assert!(inner(&z).widths[1] > 0.0);
    }
}
