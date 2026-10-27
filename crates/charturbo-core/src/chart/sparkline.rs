//! Sparkline preset: a chrome-free line / area / bar chart (the SDK hides axes, grid, legend)
//! whose last / min / max markers, reference band and zero line are built here from the live
//! data of the first series and drawn by the annotation layers (GPU only, no DOM, no label
//! anchors). Marks are rebuilt only when the data or the marks change.

use super::*;

/// Marks of a sparkline. A `None` color = mark not drawn; colors are straight RGBA.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SparklineMarks {
    pub last: Option<[f32; 4]>,
    pub min: Option<[f32; 4]>,
    pub max: Option<[f32; 4]>,
    /// Marker radius in CSS px (the surface-colored ring is drawn inside it)
    pub marker_radius_px: f32,
    /// Reference band `(lo, hi, color)` in data units, beneath the series
    pub band: Option<(f64, f64, [f32; 4])>,
    /// Horizontal line at y = 0 (win / loss bars), beneath the series
    pub zero_line: Option<[f32; 4]>,
}

impl Default for SparklineMarks {
    fn default() -> Self {
        Self {
            last: None,
            min: None,
            max: None,
            marker_radius_px: 3.0,
            band: None,
            zero_line: None,
        }
    }
}

/// Trend of a sparkline's first series over its finite samples. Indices are live sample indices
/// (line / area) or category indices (bars); min / max report the first occurrence.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SparklineSummary {
    pub count: usize,
    pub first: f32,
    pub last: f32,
    pub min: f32,
    pub max: f32,
    pub first_index: usize,
    pub last_index: usize,
    pub min_index: usize,
    pub max_index: usize,
}

impl SparklineSummary {
    /// One pass over `values` (non-finite samples skipped); `None` without a finite sample.
    pub fn of(values: &[f32]) -> Option<Self> {
        let mut out: Option<Self> = None;
        for (i, &v) in values.iter().enumerate() {
            if !v.is_finite() {
                continue;
            }
            let s = out.get_or_insert(Self {
                count: 0,
                first: v,
                last: v,
                min: v,
                max: v,
                first_index: i,
                last_index: i,
                min_index: i,
                max_index: i,
            });
            s.count += 1;
            (s.last, s.last_index) = (v, i);
            if v < s.min {
                (s.min, s.min_index) = (v, i);
            }
            if v > s.max {
                (s.max, s.max_index) = (v, i);
            }
        }
        out
    }

    /// Change from the first to the last sample in percent of `|first|` (NaN when first is 0).
    pub fn change_pct(&self) -> f64 {
        let (a, b) = (self.first as f64, self.last as f64);
        if a == 0.0 {
            f64::NAN
        } else {
            (b - a) / a.abs() * 100.0
        }
    }
}

/// Sparkline state of a chart: the marks and whether they must be rebuilt.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Sparkline {
    marks: SparklineMarks,
    pub(super) stale: bool,
}

/// Annotation list of `marks` for `s` (`x_of(index)` = annotation x of a sample index).
fn sparkline_annotations(marks: &SparklineMarks, s: Option<SparklineSummary>, x_of: impl Fn(usize) -> f64) -> Vec<ChartAnnotation> {
    let mut out = Vec::with_capacity(5);
    if let Some((lo, hi, color)) = marks.band {
        let mut band = ChartAnnotation::new(AnnotationKind::YBand, [lo, hi, 0.0, 0.0], color);
        // Full color as given (the SDK passes its band opacity in the alpha), no border
        (band.opacity, band.width_px) = (1.0, 0.0);
        out.push(band);
    }
    if let Some(color) = marks.zero_line {
        let mut line = ChartAnnotation::new(AnnotationKind::HLine, [0.0; 4], color);
        line.width_px = 1.0;
        out.push(line);
    }
    let Some(s) = s else {
        return out;
    };
    let radius = if marks.marker_radius_px.is_finite() { marks.marker_radius_px.clamp(0.5, 16.0) } else { 3.0 };
    // The last marker goes last: drawn on top where it coincides with the min / max
    for (color, index, value) in [(marks.min, s.min_index, s.min), (marks.max, s.max_index, s.max), (marks.last, s.last_index, s.last)] {
        if let Some(color) = color {
            let mut m = ChartAnnotation::new(AnnotationKind::Point, [x_of(index), value as f64, 0.0, 0.0], color);
            m.width_px = radius;
            m.layer = AnnotationLayer::Above;
            out.push(m);
        }
    }
    out
}

impl ChartState {
    /// Turns the sparkline marks on (`Some`) or off; drawn on the next `prepare_layers`.
    pub fn set_sparkline(&mut self, marks: Option<SparklineMarks>) {
        match marks {
            Some(marks) => self.sparkline = Some(Sparkline { marks, stale: true }),
            None => {
                self.sparkline = None;
                self.annotations.set_extra(Vec::new());
            }
        }
    }

    pub fn sparkline_marks(&self) -> Option<SparklineMarks> {
        self.sparkline.map(|s| s.marks)
    }

    /// Trend of the first series (line / area) or of the first bar series; `None` for other
    /// kinds or without finite data.
    pub fn sparkline_summary(&self) -> Option<SparklineSummary> {
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                (!l.series.is_empty()).then(|| SparklineSummary::of(l.vals(0))).flatten()
            }
            ChartKind::Bar(b) => SparklineSummary::of(&b.values[..b.categories.min(b.values.len())]),
            _ => None,
        }
    }

    /// Rebuilds the marks after data changes (`on_data_changed` marks them stale; bar values
    /// re-layout with `dirty.bars`) or new marks. Not on pan / zoom: the summary is O(N).
    pub(super) fn prepare_sparkline(&mut self) {
        let Some(sp) = self.sparkline else {
            return;
        };
        if !(sp.stale || (self.dirty.bars && matches!(self.kind, ChartKind::Bar(_)))) {
            return;
        }
        let summary = self.sparkline_summary();
        let items = match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                // Annotation x: the data x of the sample, or its live index without x
                let xs = if l.series.is_empty() { None } else { l.xs(0) };
                sparkline_annotations(&sp.marks, summary, |i| xs.map_or(i as f64, |x| l.x_data(x[i])))
            }
            ChartKind::Bar(_) => sparkline_annotations(&sp.marks, summary, |i| i as f64),
            _ => Vec::new(),
        };
        self.annotations.set_extra(items);
        if let Some(sp) = self.sparkline.as_mut() {
            sp.stale = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const GREEN: [f32; 4] = [0.0, 1.0, 0.0, 1.0];
    const BLUE: [f32; 4] = [0.0, 0.0, 1.0, 1.0];

    fn flat_camera() -> OrbitCamera {
        let mut cam = OrbitCamera::new(150.0, 4.0);
        cam.set_pose(Vec3::new(0.0, 0.0, 150.0), Vec3::ZERO);
        cam
    }

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (120, 30), pixel_ratio: 1.0 }
    }

    fn line(values: Vec<f32>, x: Option<Vec<f64>>) -> ChartState {
        ChartState::new_line(
            vec![LineSeries { values, x, color: [1.0; 4], width_px: 1.5 }],
            LineLayout { width: 120.0, height: 30.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        )
    }

    fn all_marks() -> SparklineMarks {
        SparklineMarks { last: Some(RED), min: Some(GREEN), max: Some(BLUE), ..Default::default() }
    }

    #[test]
    fn summary_skips_gaps_and_reports_first_occurrences() {
        let s = SparklineSummary::of(&[f32::NAN, 10.0, 4.0, 12.0, 4.0, 12.0, 11.2, f32::NAN]).unwrap();
        assert_eq!((s.count, s.first, s.last), (6, 10.0, 11.2));
        assert_eq!((s.first_index, s.last_index, s.min_index, s.max_index), (1, 6, 2, 3));
        assert!((s.change_pct() - 12.0).abs() < 1e-4, "{}", s.change_pct());
        // Falling from a negative start: the sign follows the direction of the move
        let down = SparklineSummary::of(&[-10.0, -12.0]).unwrap();
        assert!((down.change_pct() + 20.0).abs() < 1e-9);
        assert!(SparklineSummary::of(&[0.0, 5.0]).unwrap().change_pct().is_nan());
        assert_eq!(SparklineSummary::of(&[f32::NAN]), None);
        assert_eq!(SparklineSummary::of(&[]), None);
    }

    #[test]
    fn markers_land_on_the_last_min_and_max_samples_above_the_series() {
        let mut cam = flat_camera();
        let mut chart = line(vec![5.0, 1.0, 9.0, 3.0, 6.0], None);
        chart.set_padding([2.0; 4]);
        chart.frame_camera(&mut cam, (120.0, 30.0));
        chart.set_sparkline(Some(all_marks()));
        let v = view(&cam);
        let up = chart.prepare_layers(&v).annotations_above.expect("uploaded").markers.to_vec();
        assert_eq!(up.len(), 3);
        // min, max, last (last on top), at the world positions of samples 1, 2 and 4
        let want = [(1.0, 1.0, GREEN), (2.0, 9.0, BLUE), (4.0, 6.0, RED)];
        for (m, (i, y, color)) in up.iter().zip(want) {
            let p = chart.data_to_world(i, y).unwrap();
            assert!((m.center_radius[0] - p.x).abs() < 1e-4 && (m.center_radius[1] - p.y).abs() < 1e-4);
            assert_eq!((m.fill, m.center_radius[3]), (color, 3.0));
        }
        // No DOM anchors for engine marks
        assert!(chart.annotation_labels().is_empty());
        // Nothing changed: nothing re-uploaded
        assert!(chart.prepare_layers(&v).annotations_above.is_none());
    }

    #[test]
    fn markers_follow_data_updates_and_turn_off() {
        let mut cam = flat_camera();
        let mut chart = line(vec![1.0, 2.0, 3.0], None);
        chart.frame_camera(&mut cam, (120.0, 30.0));
        chart.set_sparkline(Some(SparklineMarks { last: Some(RED), ..Default::default() }));
        let v = view(&cam);
        let first = chart.prepare_layers(&v).annotations_above.unwrap().markers[0];
        chart.set_series_data(0, vec![1.0, 2.0, 3.0, 0.5], None).unwrap();
        let moved = chart.prepare_layers(&v).annotations_above.expect("rebuilt").markers[0];
        assert_ne!(first.center_radius, moved.center_radius);
        let p = chart.data_to_world(3.0, 0.5).unwrap();
        assert!((moved.center_radius[0] - p.x).abs() < 1e-4 && (moved.center_radius[1] - p.y).abs() < 1e-4);
        assert_eq!(chart.sparkline_summary().unwrap().last, 0.5);

        chart.set_sparkline(None);
        let layers = chart.prepare_layers(&v);
        assert_eq!(layers.annotations_above.expect("cleared").markers.len(), 0);
    }

    #[test]
    fn explicit_x_band_and_zero_line() {
        let mut cam = flat_camera();
        let xs: Vec<f64> = (0..4).map(|i| 1000.0 + i as f64 * 10.0).collect();
        let mut chart = line(vec![-2.0, 4.0, 1.0, 3.0], Some(xs));
        chart.frame_camera(&mut cam, (120.0, 30.0));
        chart.set_sparkline(Some(SparklineMarks {
            max: Some(BLUE),
            band: Some((0.0, 2.0, [0.5, 0.5, 0.5, 0.2])),
            zero_line: Some(GREEN),
            ..Default::default()
        }));
        let layers = chart.prepare_layers(&view(&cam));
        let m = layers.annotations_above.unwrap().markers[0];
        let below = layers.annotations_below.unwrap();
        let (fills, lines) = (below.fills.to_vec(), below.lines.to_vec());
        // Max (4.0) at x = 1010
        let p = chart.data_to_world(1010.0, 4.0).unwrap();
        assert!((m.center_radius[0] - p.x).abs() < 1e-3, "{m:?} {p:?}");
        // One band rectangle (no border) in the given color, one zero line
        assert_eq!((fills.len(), lines.len()), (6, 1));
        assert!(fills.iter().all(|f| f.color == [0.5, 0.5, 0.5, 0.2]));
        let y0 = chart.data_to_world(1000.0, 0.0).unwrap().y;
        assert!((lines[0].p0_width[1] - y0).abs() < 1e-4);
    }

    #[test]
    fn bars_mark_categories_and_other_kinds_have_no_summary() {
        let mut scene = SceneWorld::new();
        let mut cam = flat_camera();
        let layout = BarLayout { width: 120.0, max_height: 30.0, bar_width: 0.0, corner_radius_px: 1.0, view: ChartViewMode::Flat };
        let mut chart = ChartState::new_bar(vec![3.0, -1.0, 2.0], vec![[1.0; 4]; 3], layout, &mut scene);
        chart.frame_camera(&mut cam, (120.0, 30.0));
        chart.set_sparkline(Some(SparklineMarks { min: Some(GREEN), ..Default::default() }));
        let s = chart.sparkline_summary().unwrap();
        assert_eq!((s.min_index, s.max_index, s.count), (1, 0, 3));
        let m = chart.prepare_layers(&view(&cam)).annotations_above.unwrap().markers[0];
        let p = chart.data_to_world(1.0, -1.0).unwrap();
        assert!((m.center_radius[0] - p.x).abs() < 1e-4 && (m.center_radius[1] - p.y).abs() < 1e-4);

        let pts = ScatterPoints {
            xs: vec![1.0],
            ys: vec![1.0],
            sizes: vec![],
            series: vec![],
            colors: vec![],
            series_colors: vec![[1.0; 4]],
        };
        let scatter = ChartState::new_scatter(pts, ScatterLayout::default());
        assert_eq!(scatter.sparkline_summary(), None);
    }
}
