//! Waterfall chart: running totals as floating bars on a category axis, connector lines and
//! subtotal / total items, built on the 2D bar chart (bar.rs floating bars: per-bar bases).
//!
//! Each delta bar floats from the running total before it to the total after it; a total item
//! (subtotal or the final total) is a full bar from zero to the running total. The bars, value
//! domain, gridlines, axes, hover, horizontal orientation and data-label anchors are the bar
//! chart's; this module computes the running totals, colors bars by kind (increase / decrease /
//! total: palette slots, never red / green alone; labels carry the sign) and draws dashed
//! connectors from each bar's end level to the next bar.

use super::bar::{BarChart, BarSeriesLayout};
use super::bar_style::{BarOrientation, BarStyle};
use super::*;

/// Depth of the connectors over the bars, under hover overlays.
const CONNECTOR_Z: f32 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WaterfallKind {
    Increase,
    Decrease,
    /// Subtotal / total: a bar from zero to the running total
    Total,
}

impl WaterfallKind {
    pub fn code(self) -> u8 {
        match self {
            Self::Increase => 0,
            Self::Decrease => 1,
            Self::Total => 2,
        }
    }
}

/// One bar: its kind, delta (the running total for total items), and value-axis extent.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaterfallItem {
    pub kind: WaterfallKind,
    pub value: f64,
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaterfallStyle {
    pub increase: [f32; 4],
    pub decrease: [f32; 4],
    pub total: [f32; 4],
    pub connector: [f32; 4],
    /// Connector dash length (CSS px; 0 = solid)
    pub connector_dash_px: f32,
}

impl Default for WaterfallStyle {
    fn default() -> Self {
        Self {
            increase: [0.224, 0.529, 0.898, 1.0],
            decrease: [0.851, 0.349, 0.149, 1.0],
            total: [0.42, 0.44, 0.48, 1.0],
            connector: [0.36, 0.42, 0.52, 1.0],
            connector_dash_px: 3.0,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WaterfallOptions {
    pub orientation: BarOrientation,
    pub connectors: bool,
    pub corner_radius_px: f32,
}

impl Default for WaterfallOptions {
    fn default() -> Self {
        Self { orientation: BarOrientation::Vertical, connectors: true, corner_radius_px: 0.0 }
    }
}

/// Delta values must be finite; total items may be NaN (their value is the running total).
pub fn validate_waterfall(values: &[f64], totals: &[bool]) -> Result<(), String> {
    match values.iter().enumerate().position(|(i, v)| !v.is_finite() && !totals.get(i).copied().unwrap_or(false)) {
        Some(i) => Err(format!("waterfall value {i} is {} (deltas must be finite)", values[i])),
        None => Ok(()),
    }
}

/// Running totals: a delta item floats from the total before it to the total after it; a
/// total item (`totals[i]`) spans zero to the running total and does not change it.
pub fn compute_waterfall(values: &[f64], totals: &[bool]) -> Vec<WaterfallItem> {
    let mut run = 0.0f64;
    values
        .iter()
        .enumerate()
        .map(|(i, &v)| {
            if totals.get(i).copied().unwrap_or(false) {
                WaterfallItem { kind: WaterfallKind::Total, value: run, start: 0.0, end: run }
            } else {
                let start = run;
                run += v;
                let kind = if v < 0.0 { WaterfallKind::Decrease } else { WaterfallKind::Increase };
                WaterfallItem { kind, value: v, start, end: run }
            }
        })
        .collect()
}

#[derive(Debug, Clone)]
pub(crate) struct WaterfallChart {
    pub(crate) bar: BarChart,
    pub(crate) items: Vec<WaterfallItem>,
    style: WaterfallStyle,
    connectors: bool,
}

impl WaterfallChart {
    pub(crate) fn new(values: &[f64], totals: &[bool], layout: BarLayout, opts: WaterfallOptions, style: WaterfallStyle) -> Self {
        let items = compute_waterfall(values, totals);
        let ends: Vec<f32> = items.iter().map(|it| it.end as f32).collect();
        let layout = BarLayout { corner_radius_px: opts.corner_radius_px.max(0.0), view: ChartViewMode::Flat, ..layout };
        let mut bar = BarChart::new(ends, Vec::new(), layout, BarSeriesLayout::default());
        bar.bases = items.iter().map(|it| it.start as f32).collect();
        let mut chart = Self { bar, items, style, connectors: opts.connectors };
        chart.apply_colors();
        // Re-shapes the domain with the bases and lays out the floating bars
        chart.bar.set_style(BarStyle { orientation: opts.orientation, ..Default::default() });
        chart
    }

    fn apply_colors(&mut self) {
        let s = self.style;
        self.bar.colors = self
            .items
            .iter()
            .map(|it| match it.kind {
                WaterfallKind::Increase => s.increase,
                WaterfallKind::Decrease => s.decrease,
                WaterfallKind::Total => s.total,
            })
            .collect();
    }

    pub(crate) fn set_style(&mut self, style: WaterfallStyle) {
        self.style = style;
        self.apply_colors();
    }

    /// Dashed connectors at each bar's end level, from its far edge to the next bar's near edge.
    pub(crate) fn build_connectors(&self, out: &mut Vec<ChartSegmentRaw>) {
        if !self.connectors {
            return;
        }
        let b = &self.bar;
        for i in 1..self.items.len() {
            let (Some(a), Some(c)) = (b.segs[i - 1], b.segs[i]) else { continue };
            let level = b.zero_y + self.items[i - 1].end as f32 * b.scale;
            let (p, q) = (b.world(a.x1, level), b.world(c.x0, level));
            out.push(ChartSegmentRaw {
                p0_width: [p.0, p.1, CONNECTOR_Z, 1.0],
                p1_pad: [q.0, q.1, CONNECTOR_Z, self.style.connector_dash_px.max(0.0)],
                color: self.style.connector,
            });
        }
    }
}

impl ChartState {
    /// Creates a waterfall chart from validated values (see `validate_waterfall`).
    pub fn new_waterfall(values: &[f64], totals: &[bool], layout: BarLayout, opts: WaterfallOptions, style: WaterfallStyle) -> Self {
        Self::with_kind(ChartKind::Waterfall(WaterfallChart::new(values, totals, layout, opts, style)))
    }

    pub fn set_waterfall_style(&mut self, style: WaterfallStyle) {
        if let ChartKind::Waterfall(w) = &mut self.kind {
            w.set_style(style);
            self.dirty.bars = true;
        }
    }

    pub fn waterfall_items(&self) -> Option<&[WaterfallItem]> {
        match &self.kind {
            ChartKind::Waterfall(w) => Some(&w.items),
            _ => None,
        }
    }

    /// Waterfall part of `prepare_layers` (after `prepare_bar_style`, which rebuilt the series
    /// layer for the bars): bars, connectors, grid.
    pub(crate) fn prepare_waterfall(&mut self) {
        let ChartKind::Waterfall(w) = &self.kind else { return };
        if self.dirty.bars {
            w.bar.build_bars(self.hover.as_ref().and_then(|h| h.items.get(h.primary)).map(|i| i.global_id as usize), &self.hover_style, &mut self.bars);
            self.series.clear();
            w.build_connectors(&mut self.series);
            self.styled.dashed.clear();
            self.styled.markers.clear();
            self.dirty.series = true;
        }
        if self.dirty.underlay {
            w.bar.build_grid(&self.frame_style, &mut self.underlay);
        }
        if self.dirty.overlay {
            self.overlay.clear();
            self.markers.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn layout() -> BarLayout {
        BarLayout { width: 160.0, max_height: 80.0, bar_width: 0.0, corner_radius_px: 0.0, view: ChartViewMode::Flat }
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    fn waterfall(values: &[f64], totals: &[bool], opts: WaterfallOptions) -> (ChartState, OrbitCamera) {
        validate_waterfall(values, totals).unwrap();
        let chart = ChartState::new_waterfall(values, totals, layout(), opts, WaterfallStyle::default());
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (chart, cam)
    }

    fn bar(c: &ChartState) -> &BarChart {
        match &c.kind {
            ChartKind::Waterfall(w) => &w.bar,
            _ => unreachable!(),
        }
    }

    #[test]
    fn running_totals_kinds_and_subtotals() {
        let items = compute_waterfall(&[100.0, 30.0, -50.0, f64::NAN, 20.0, 0.0], &[false, false, false, true, false, true]);
        let ext: Vec<(f64, f64)> = items.iter().map(|i| (i.start, i.end)).collect();
        assert_eq!(ext, vec![(0.0, 100.0), (100.0, 130.0), (130.0, 80.0), (0.0, 80.0), (80.0, 100.0), (0.0, 100.0)]);
        let kinds: Vec<u8> = items.iter().map(|i| i.kind.code()).collect();
        assert_eq!(kinds, vec![0, 0, 1, 2, 0, 2]);
        assert_eq!(items[3].value, 80.0, "a total reports the running total");
        assert!(validate_waterfall(&[1.0, f64::NAN], &[false, false]).unwrap_err().contains("value 1"));
        assert!(validate_waterfall(&[1.0, f64::NAN], &[false, true]).is_ok());
    }

    #[test]
    fn floating_bars_connectors_and_hover() {
        let (mut c, cam) = waterfall(&[100.0, 30.0, -50.0, 0.0], &[false, false, false, true], WaterfallOptions::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        let layers = c.prepare_layers(&v);
        let bars = layers.bars.unwrap().to_vec();
        let series = layers.series.unwrap().to_vec();
        let b = bar(&c).clone();
        let y = |v: f32| b.zero_y + v * b.scale;
        assert_eq!(bars.len(), 4);
        // Bar 1 floats 100 -> 130, bar 2 hangs 130 -> 80 (rounded end down), total 0 -> 80
        assert!((bars[1].rect[1] - y(100.0)).abs() < 1e-3 && (bars[1].rect[3] - y(130.0)).abs() < 1e-3);
        assert!((bars[2].rect[1] - y(80.0)).abs() < 1e-3 && (bars[2].rect[3] - y(130.0)).abs() < 1e-3);
        assert_eq!(bars[2].z_radius[2], -1.0);
        assert!((bars[3].rect[1] - y(0.0)).abs() < 1e-3);
        // Kind colors
        let st = WaterfallStyle::default();
        assert_eq!([bars[0].color, bars[2].color, bars[3].color], [st.increase, st.decrease, st.total]);
        // Domain covers the peak (130) and zero
        assert!(b.v_max >= 130.0 && b.v_min <= 0.0);
        // Connectors at each end level, dashed, between neighbours
        assert_eq!(series.len(), 3);
        assert!((series[1].p0_width[1] - y(130.0)).abs() < 1e-3 && series[1].p1_pad[3] == 3.0);
        assert!(series[0].p0_width[0] < series[0].p1_pad[0]);
        // Hover: the bar slot, value = its end
        let p = c.sample(2).unwrap().3;
        let ndc = cam.project_to_ndc(p).unwrap();
        let hit = c.hover_at(&v, &mut scene, (ndc.x, ndc.y - 0.01)).unwrap();
        assert_eq!((hit.items[0].index, hit.items[0].value), (2, 80.0));
        // Hover re-tints the bar and keeps the connectors
        let layers = c.prepare_layers(&v);
        assert_ne!(layers.bars.unwrap()[2].color, st.decrease);
        assert_eq!(layers.series.unwrap().len(), 3);
        // Legend toggles do nothing
        c.set_series_visible(0, false, &mut scene);
        assert!(c.series_visible(0));
    }

    #[test]
    fn horizontal_waterfall_and_labels_use_the_bar_machinery() {
        let opts = WaterfallOptions { orientation: BarOrientation::Horizontal, ..Default::default() };
        let (mut c, cam) = waterfall(&[50.0, -20.0], &[false, false], opts);
        let v = view(&cam);
        assert_eq!(c.bar_orientation(), Some(BarOrientation::Horizontal));
        assert!(c.set_bar_labels(BarLabelOptions { mode: BarLabelMode::Show, ..Default::default() }, vec![[30.0, 14.0]; 2]));
        let layers = c.prepare_layers(&v);
        let bars = layers.bars.unwrap().to_vec();
        let s = layers.series.unwrap()[0];
        let b = bar(&c);
        // Values along x: bar 1 spans 30..50
        assert!((bars[1].rect[0] - (b.zero_y + 30.0 * b.scale)).abs() < 1e-3);
        assert!((bars[1].rect[2] - (b.zero_y + 50.0 * b.scale)).abs() < 1e-3);
        // Connector is vertical (category axis runs down)
        assert!((s.p0_width[0] - s.p1_pad[0]).abs() < 1e-4 && s.p0_width[1] > s.p1_pad[1]);
        let (labels, _) = c.bar_labels().unwrap();
        assert_eq!(labels.len(), 2);
        // Decrease label sits at the data end (left of the bar: it went down)
        assert!(labels[1].x_css < c.axes().plot_css[0] + c.axes().plot_css[2]);
    }
}
