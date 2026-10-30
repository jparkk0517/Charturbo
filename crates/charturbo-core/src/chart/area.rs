//! Area charts (2D): overlapping, stacked, and percent-stacked fills over a wrapped `LineChart`.
//!
//! The inner line chart holds the drawn top edges (raw values, or cumulative / percent tops when
//! stacking), so strokes, x mapping (index or explicit / time x), zoom / pan, M4 LOD, hover, and
//! axes are all delegated to it. Fills are tessellated on the same M4 picks as the strokes, so
//! fill edges follow the decimated lines at any zoom.
//!
//! Stacking rules: a stacked series' band starts on the sum of the visible series below it.
//! Missing (`NaN`) samples count as 0 for the series above and leave a gap in their own stroke
//! and band. Stacked mode sums signed values (negative values pull the stack down; bands may
//! cross); percent mode clamps negatives to 0 and normalizes each sample to 100%.

use super::line::{LineChart, LodWindow, DIMMED_SERIES_ALPHA};
use super::linestyle::{apply_curve, band_between, fill_missing, CurveScratch, LineCurve, NullPolicy, Path};
use super::*;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum AreaMode {
    /// Every series filled down to the zero baseline (translucent, overlapping)
    #[default]
    Overlap,
    /// Series stacked on top of each other
    Stacked,
    /// Stacked, each sample normalized so the visible series sum to 100
    Percent,
}

impl AreaMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Stacked,
            2 => Self::Percent,
            _ => Self::Overlap,
        }
    }

    pub fn stacks(self) -> bool {
        self != Self::Overlap
    }

    /// Default fill alpha multiplier: translucent where areas overlap, near-opaque when stacked
    /// (stacked bands never overlap, so the top-edge stroke separates them).
    pub fn default_fill_opacity(self) -> f32 {
        if self.stacks() {
            0.8
        } else {
            0.2
        }
    }
}

/// Checks area input: line x rules, plus aligned samples for stacked modes (every series has
/// the same length and, with explicit x, the same x values).
pub fn validate_area(series: &[LineSeries], mode: AreaMode) -> Result<(), String> {
    validate_line_x(series)?;
    if !mode.stacks() {
        return Ok(());
    }
    let Some(first) = series.first() else {
        return Ok(());
    };
    for (i, s) in series.iter().enumerate().skip(1) {
        if s.values.len() != first.values.len() {
            return Err(format!(
                "stacked areas need aligned samples: series {i} has {} values, series 0 has {}",
                s.values.len(),
                first.values.len()
            ));
        }
        if s.x != first.x {
            return Err(format!("stacked areas need shared x: series {i} x differs from series 0"));
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub(crate) struct AreaChart {
    /// Drawn top edges (stacked modes: cumulative tops of the visible series)
    pub(crate) line: LineChart,
    pub(crate) mode: AreaMode,
    /// Stacked input, stored with the same head offsets as `line`. Overlap reads `line` directly.
    pub(crate) raw: Vec<Vec<f32>>,
    /// Stacked modes: bottom edge of each series' band (sum of the visible series below it, in
    /// percent units for `Percent`); empty in overlap mode
    pub(crate) base: Vec<Vec<f32>>,
    /// Fill alpha multiplier applied to the series color
    pub(crate) fill_opacity: f32,
    /// ThemeRiver: stacked around a moving baseline (see theme_river.rs); None = plain area
    pub(crate) stream: Option<super::theme_river::StreamLayout>,
}

impl AreaChart {
    /// `fill_opacity` outside [0, 1] or non-finite uses the mode default. Misaligned stacked input
    /// (callers are expected to validate first) falls back to overlap mode.
    pub(crate) fn new(series: Vec<LineSeries>, layout: LineLayout, mode: AreaMode, fill_opacity: f32) -> Self {
        let mode = if validate_area(&series, mode).is_ok() { mode } else { AreaMode::Overlap };
        let raw = if mode.stacks() { series.iter().map(|s| s.values.clone()).collect() } else { Vec::new() };
        // Areas are a 2D chart: the layered view is not supported
        let layout = LineLayout { view: ChartViewMode::Flat, ..layout };
        let mut chart = Self {
            line: LineChart::new(series, layout),
            mode,
            raw,
            base: Vec::new(),
            fill_opacity: if fill_opacity.is_finite() && (0.0..=1.0).contains(&fill_opacity) {
                fill_opacity
            } else {
                mode.default_fill_opacity()
            },
            stream: None,
        };
        chart.line.include_zero = true;
        if mode == AreaMode::Percent {
            chart.line.y_axis.min = Some(0.0);
            chart.line.y_axis.max = Some(100.0);
        }
        chart.restack();
        // Areas are measured from zero: the domain always includes the baseline. Computed with
        // every series visible and kept when series are toggled (like bars).
        let (lo, hi) = match mode {
            AreaMode::Percent => (0.0, 100.0),
            _ => chart
                .line
                .series
                .iter()
                .flat_map(|s| s.values.iter().copied())
                .filter(|v| v.is_finite())
                .fold((0.0f32, 0.0f32), |(lo, hi), v| (lo.min(v), hi.max(v))),
        };
        chart.line.data_min = lo;
        chart.line.data_max = if hi > lo { hi } else { lo + 1.0 };
        chart.line.set_tick_target(ChartFrameStyle::default().grid_rows);
        chart
    }

    /// Recomputes stacked tops / band bottoms from the visible series (no-op in overlap mode).
    pub(crate) fn restack(&mut self) {
        if !self.mode.stacks() {
            return;
        }
        if self.stream.is_some() {
            return self.restack_stream();
        }
        let n = self.line.max_len();
        let percent = self.mode == AreaMode::Percent;
        let share = |v: f32| if v.is_finite() { if percent { v.max(0.0) } else { v } } else { 0.0 };
        // Null policy: zero-filled / interpolated samples stack like data (see linestyle.rs)
        let raw: Vec<std::borrow::Cow<[f32]>> = (0..self.raw.len())
            .map(|s| match self.line.style.nulls(s) {
                NullPolicy::Gap => std::borrow::Cow::Borrowed(&self.raw[s][self.line.head[s]..]),
                nulls => std::borrow::Cow::Owned(fill_missing(&self.raw[s][self.line.head[s]..], nulls, self.line.xs(s))),
            })
            .collect();
        // Percent: per-sample scale so the visible series sum to 100 (all-zero samples stay 0)
        let mut scale = vec![1.0f32; n];
        if percent {
            scale.fill(0.0);
            for (values, _) in raw.iter().zip(&self.line.visible).filter(|&(_, &vis)| vis) {
                for (acc, &v) in scale.iter_mut().zip(values.iter()) {
                    *acc += share(v);
                }
            }
            for t in &mut scale {
                *t = if *t > 0.0 { 100.0 / *t } else { 0.0 };
            }
        }
        let mut acc = vec![0.0f32; n];
        self.base.resize(self.raw.len(), Vec::new());
        for (s, raw) in raw.iter().enumerate() {
            self.base[s].clear();
            self.base[s].extend_from_slice(&acc);
            let visible = self.line.visible[s];
            // Connected samples stack (series above sit on them) but keep a missing top, so the
            // stroke / fill join over them and no marker lands on an interpolated value
            let connect = self.line.style.nulls(s) == NullPolicy::Connect;
            let head = self.line.head[s];
            let top = &mut self.line.series[s].values[head..];
            for i in 0..n {
                let v = raw[i];
                let d = share(v) * scale[i];
                let missing = !v.is_finite() || (connect && !self.raw[s][head + i].is_finite());
                top[i] = if missing { f32::NAN } else { acc[i] + d };
                // Hidden series keep tops for a quick re-show but take no space in the stack
                if visible {
                    acc[i] += d;
                }
            }
        }
    }

    pub(crate) fn values(&self, s: usize) -> &[f32] {
        if self.mode.stacks() { &self.raw[s][self.line.head[s]..] } else { self.line.vals(s) }
    }

    pub(crate) fn set_series_data(&mut self, s: usize, values: Vec<f32>, x: Option<Vec<f64>>) -> Result<usize, String> {
        self.line.check_update(s, values.len(), x.as_deref(), false)?;
        if self.mode.stacks() && self.line.series.len() > 1 {
            let peer = if s == 0 { 1 } else { 0 };
            if values.len() != self.line.len(peer) {
                return Err("stacked areas need aligned samples".into());
            }
            if let (Some(x), Some(other)) = (x.as_deref(), self.line.xs(peer)) {
                if !x.iter().zip(other).all(|(&a, &b)| {
                    (self.line.x_data_to_abs(a) - self.line.x_origin - b).abs() <= f64::EPSILON * b.abs().max(1.0)
                }) {
                    return Err("stacked areas need shared x".into());
                }
            }
        }
        let raw = self.mode.stacks().then(|| values.clone());
        let n = self.line.set_series_data(s, values, x)?;
        if let Some(raw) = raw {
            self.raw[s] = raw;
            self.restack();
            self.line.refresh_extents();
            if self.stream.is_some() {
                self.fit_stream_domain();
            }
        }
        Ok(n)
    }

    pub(crate) fn append_series_data(&mut self, s: usize, values: &[f32], x: Option<&[f64]>, max_points: usize) -> Result<usize, String> {
        if self.mode.stacks() {
            return Err("stacked areas need aligned updates: use appendAreaData".into());
        }
        self.line.append_series_data(s, values, x, max_points)
    }

    /// Validates the entire batch before changing any series. Stacks remain sample-aligned;
    /// their drawn tops are recomputed once, O(retained samples), after the atomic update.
    pub(crate) fn append_data(&mut self, values: &[&[f32]], xs: Option<&[&[f64]]>, max_points: usize) -> Result<Vec<usize>, String> {
        if values.len() != self.line.series.len() || xs.is_some_and(|x| x.len() != values.len()) {
            return Err("appendAreaData: provide a chunk for every series".into());
        }
        for (s, v) in values.iter().enumerate() {
            self.line.check_update(s, v.len(), xs.map(|x| x[s]), true)?;
            if self.mode.stacks() && s > 0 {
                if v.len() != values[0].len() {
                    return Err("stacked areas need aligned samples".into());
                }
                if xs.is_some_and(|x| x[s] != x[0]) {
                    return Err("stacked areas need shared x".into());
                }
            }
        }
        let anchor = self.line.window_anchor();
        let longest = self.line.max_len();
        // Apply the index shift only once, not once for each series in a synchronized batch.
        let shift = if !self.line.has_x() && max_points > 0 {
            values.iter().enumerate().filter(|(s, _)| self.line.len(*s) == longest)
                .map(|(s, v)| (self.line.len(s) + v.len()).saturating_sub(max_points)).max().unwrap_or(0)
        } else { 0 };
        let mut lengths = Vec::with_capacity(values.len());
        for (s, v) in values.iter().enumerate() {
            // All validation above is read-only; these calls cannot reject the checked inputs.
            lengths.push(self.line.append_series_data(s, v, xs.map(|x| x[s]), max_points)?);
            if self.mode.stacks() {
                self.raw[s].extend_from_slice(v);
                let compacted = self.raw[s].len() - self.line.series[s].values.len();
                self.raw[s].drain(..compacted);
            }
        }
        self.line.restore_window(anchor, shift as f64);
        if self.mode.stacks() {
            self.restack();
            self.line.refresh_extents();
            if self.stream.is_some() {
                self.fit_stream_domain();
            }
        } else {
            self.line.update_y_domain(false);
        }
        Ok(lengths)
    }

    /// Shows / hides a series and restacks; returns whether anything changed.
    pub(crate) fn set_visible(&mut self, series: usize, visible: bool) -> bool {
        match self.line.visible.get_mut(series) {
            Some(v) if *v != visible => {
                *v = visible;
                self.restack();
                if self.stream.is_some() {
                    // ThemeRiver: the baseline moves, the domain follows the visible river
                    self.line.refresh_extents();
                    self.fit_stream_domain();
                    return true;
                }
                let (lo, hi) = (self.line.data_min, self.line.data_max);
                self.line.refresh_extents();
                // Keep the all-data domain stable on hide, but expand when a stream updated
                // behind a hidden series and showing it again creates a higher cumulative top.
                self.line.data_min = self.line.data_min.min(lo);
                self.line.data_max = self.line.data_max.max(hi);
                self.line.update_y_domain(false);
                true
            }
            _ => false,
        }
    }

    /// Appends the fill triangles of every visible series for `window` (same picks as strokes;
    /// stacked bands use the union of their top and bottom series' picks).
    /// `runs` = each series' vertices (decal.rs).
    pub(crate) fn build_fills(&self, window: &LodWindow, out: &mut Vec<ChartFillRaw>, runs: &mut Vec<super::decal::DecalRun>) {
        out.clear();
        runs.clear();
        let l = &self.line;
        let stacks = self.mode.stacks();
        let mut order = self.stream_stack();
        // Overlapping areas: the emphasized one is drawn last so it sits on top
        if let (false, Some(e)) = (stacks, l.emphasis) {
            if let Some(pos) = order.iter().position(|&s| s == e) {
                order.remove(pos);
                order.push(e);
            }
        }
        let baseline = l.y_baseline();
        let ppw = l.px_per_world(window);
        let (mut picks, mut below) = (Vec::new(), Vec::new());
        let mut sc = CurveScratch::default();
        let (mut rows, mut top, mut base_rows, mut bottom, mut edges) =
            (Path::default(), Path::default(), Path::default(), Path::default(), Path::default());
        let mut prev: Option<usize> = None;
        let mut tris = Vec::new();
        for s in order {
            // Top edge: the series' drawn stroke (M4 picks, null policy, curve; see linestyle.rs).
            // Missing samples are NaN tops: the band leaves a gap there.
            let curve = l.style_of(s).curve;
            l.lod_picks(s, window, &mut picks);
            l.stroke_rows(s, &picks, &mut rows);
            let top = if curve == LineCurve::Linear {
                &rows
            } else {
                apply_curve(curve, ppw, &rows, &mut top, &mut sc);
                &top
            };
            // ThemeRiver: the bottom stream sits on the baseline (its own base, its own picks)
            match prev.filter(|_| stacks).or(self.stream.as_ref().map(|_| s)) {
                Some(p) => {
                    // Bottom edge: the band base at the picks of the series below, shaped by its
                    // curve, so the band meets that series' stroke
                    l.lod_picks(p, window, &mut below);
                    base_rows.x.clear();
                    base_rows.y.clear();
                    for &i in &below {
                        base_rows.x.push(l.x_at(p, i));
                        base_rows.y.push(l.y_of_or_base(self.base[s][i]));
                    }
                    let curve_below = l.style_of(p).curve;
                    let bottom = if curve_below == LineCurve::Linear {
                        &base_rows
                    } else {
                        apply_curve(curve_below, ppw, &base_rows, &mut bottom, &mut sc);
                        &bottom
                    };
                    band_between(top, bottom, &mut edges);
                }
                None => {
                    edges.x.clone_from(&top.x);
                    edges.y.clone_from(&top.y);
                    edges.y2.clear();
                    edges.y2.resize(top.x.len(), baseline);
                }
            }
            prev = Some(s);
            let fill = |mut c: [f32; 4]| {
                c[3] *= self.fill_opacity;
                if l.emphasis.is_some_and(|e| e != s) {
                    c[3] *= DIMMED_SERIES_ALPHA;
                }
                c
            };
            let color = fill(l.series[s].color);
            let at = out.len();
            match l.world_pieces(s) {
                // Piecewise colors: the fill is clipped into the slabs between piece bounds
                Some(wp) => {
                    tris.clear();
                    band_triangles(&edges.x, &edges.y, &edges.y2, l.z[s], color, &mut tris);
                    wp.clip_fill(&tris, |c| c.map_or(color, fill), out);
                }
                None => band_triangles(&edges.x, &edges.y, &edges.y2, l.z[s], color, out),
            }
            super::decal::push_run(runs, at, out.len(), s as u32);
        }
    }

    /// Line hover (markers sit on the drawn tops) reporting the raw series values.
    pub(crate) fn hover(&self, view: &ChartView, ndc: (f32, f32), style: &ChartHoverStyle) -> Option<HoverResult> {
        let mut hit = self.line.hover(view, ndc, style)?;
        // ThemeRiver: the primary item is the stream whose band holds the pointer; above / below
        // the river nothing is hovered (ECharts)
        if self.stream.is_some() {
            let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
            let p = ray_hit_z_plane(&ray, 0.0)?;
            hit.primary = self.stream_at(&hit.items, p.y)?;
        }
        for item in &mut hit.items {
            item.value = self.values(item.series as usize)[item.index as usize];
        }
        Some(hit)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];

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

    fn series(values: Vec<Vec<f32>>) -> Vec<LineSeries> {
        values
            .into_iter()
            .map(|values| LineSeries { values, x: None, color: RED, width_px: 2.0 })
            .collect()
    }

    const LAYOUT: LineLayout = LineLayout {
        width: 160.0,
        height: 80.0,
        view: ChartViewMode::Flat,
        x_kind: LineXKind::Numeric,
    };

    fn state(values: Vec<Vec<f32>>, mode: AreaMode) -> (OrbitCamera, ChartState) {
        let chart = ChartState::new_area(series(values), LAYOUT, mode, f32::NAN);
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    fn area(chart: &ChartState) -> &AreaChart {
        match &chart.kind {
            ChartKind::Area(a) => a,
            _ => unreachable!(),
        }
    }

    fn tops(chart: &ChartState) -> Vec<Vec<f32>> {
        area(chart).line.series.iter().map(|s| s.values.clone()).collect()
    }

    fn same(a: &[f32], b: &[f32]) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x.is_nan() && y.is_nan()) || (x - y).abs() < 1e-4)
    }

    #[test]
    fn stacked_tops_are_cumulative_and_missing_samples_count_as_zero_below() {
        let nan = f32::NAN;
        let (_, chart) = state(
            vec![vec![1.0, 2.0, 3.0], vec![10.0, nan, 30.0], vec![5.0, 5.0, 5.0]],
            AreaMode::Stacked,
        );
        let t = tops(&chart);
        assert!(same(&t[0], &[1.0, 2.0, 3.0]));
        assert!(same(&t[1], &[11.0, nan, 33.0]), "{:?}", t[1]);
        // Series 1 is missing at index 1: series 2 sits on series 0 there
        assert!(same(&t[2], &[16.0, 7.0, 38.0]), "{:?}", t[2]);
        assert!(same(&area(&chart).base[2], &[11.0, 2.0, 33.0]));
        // Domain spans zero to the top of the stack (nice ticks)
        let l = &area(&chart).line;
        assert_eq!((l.y_min, l.y_min + l.y_span), (0.0, 40.0));
    }

    #[test]
    fn fills_emit_two_triangles_per_segment_and_skip_gaps() {
        // Overlap: 2 series x 4 spans x 6 vertices
        let (cam, mut chart) = state(vec![vec![1.0, 3.0, 2.0, 4.0, 5.0], vec![2.0; 5]], AreaMode::Overlap);
        let fills = chart.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
        assert_eq!(fills.len(), 2 * 4 * 6);
        // Translucent default; bottoms on the zero baseline (= bottom of the 0..5 domain)
        assert!(fills.iter().all(|v| (v.color[3] - 0.2).abs() < 1e-6));
        let min_y = fills.iter().map(|v| v.position[1]).fold(f32::MAX, f32::min);
        assert!((min_y + 40.0).abs() < 1e-4, "baseline at {min_y}");

        // Stacked with a missing sample in the top series: its band loses the 2 spans touching it
        let (cam, mut chart) =
            state(vec![vec![1.0; 5], vec![1.0, 1.0, f32::NAN, 1.0, 1.0]], AreaMode::Stacked);
        let fills = chart.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
        assert_eq!(fills.len(), (4 + 2) * 6);
        assert!(fills.iter().all(|v| (v.color[3] - 0.8).abs() < 1e-6));
        // Unchanged frame: fills are not re-uploaded
        assert!(chart.prepare_layers(&view(&cam)).fills.is_none());
    }

    #[test]
    fn stacked_bands_meet_without_overlap() {
        let (cam, mut chart) = state(vec![vec![2.0, 4.0], vec![3.0, 1.0]], AreaMode::Stacked);
        let fills = chart.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
        let l = &area(&chart).line;
        // Band 1's bottom edge is band 0's top edge
        let ys = |tri: &[ChartFillRaw]| tri.iter().map(|v| v.position[1]).collect::<Vec<_>>();
        let band0 = ys(&fills[..6]);
        let band1 = ys(&fills[6..]);
        assert!(band0.iter().any(|&y| (y - l.y_of(4.0)).abs() < 1e-4));
        assert!(band1.iter().any(|&y| (y - l.y_of(4.0)).abs() < 1e-4), "band 1 starts on top of band 0");
        assert!(band1.iter().any(|&y| (y - l.y_of(5.0)).abs() < 1e-4));
        assert!(band1.iter().all(|&y| y >= l.y_of(2.0) - 1e-4), "band 1 never dips into band 0");
    }

    #[test]
    fn percent_mode_normalizes_each_sample_to_100() {
        let (_, chart) = state(vec![vec![1.0, 3.0, 0.0], vec![3.0, 1.0, 0.0], vec![-5.0, 0.0, 0.0]], AreaMode::Percent);
        let t = tops(&chart);
        assert!(same(&t[0], &[25.0, 75.0, 0.0]));
        assert!(same(&t[1], &[100.0, 100.0, 0.0]));
        // Negative values take no share; all-zero samples stay at 0
        assert!(same(&t[2], &[100.0, 100.0, 0.0]));
        let l = &area(&chart).line;
        assert_eq!((l.y_min, l.y_min + l.y_span), (0.0, 100.0));
    }

    #[test]
    fn hiding_a_series_restacks_and_keeps_the_domain() {
        let (cam, mut chart) = state(vec![vec![1.0, 2.0], vec![10.0, 20.0], vec![1.0, 1.0]], AreaMode::Stacked);
        let span = area(&chart).line.y_span;
        let mut scene = SceneWorld::new();
        chart.set_series_visible(0, false, &mut scene);
        let t = tops(&chart);
        assert!(same(&t[1], &[10.0, 20.0]));
        assert!(same(&t[2], &[11.0, 21.0]));
        assert_eq!(area(&chart).line.y_span, span);
        let layers = chart.prepare_layers(&view(&cam));
        assert_eq!(layers.fills.unwrap().len(), 2 * 6, "hidden series has no band");
        // Percent: the remaining series fill 100% on their own
        let (_, mut chart) = state(vec![vec![1.0], vec![3.0]], AreaMode::Percent);
        chart.set_series_visible(0, false, &mut scene);
        assert!(same(&tops(&chart)[1], &[100.0]));
        chart.set_series_visible(0, true, &mut scene);
        assert!(same(&tops(&chart)[1], &[100.0]) && same(&tops(&chart)[0], &[25.0]));
    }

    #[test]
    fn index_hover_reports_raw_values_with_markers_on_the_stacked_tops() {
        let (cam, mut chart) = state(
            vec![(0..101).map(|_| 10.0).collect(), (0..101).map(|_| 5.0).collect()],
            AreaMode::Stacked,
        );
        let mut scene = SceneWorld::new();
        let v = view(&cam);
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (c.x, c.y)).expect("hover at centre");
        let values: Vec<f32> = hit.items.iter().map(|i| i.value).collect();
        assert_eq!(values, vec![10.0, 5.0], "raw values, not cumulative");
        assert_eq!(hit.items[1].global_id, 101 + 50);
        let markers = chart.prepare_layers(&v).markers.unwrap().to_vec();
        let l = &area(&chart).line;
        assert!((markers[1].center_radius[1] - l.y_of(15.0)).abs() < 1e-4, "marker on the cumulative top");
        // Samples (keyboard navigation) report raw values too
        assert_eq!(chart.sample(151).unwrap().2, 5.0);
        // A restack moves the markers: the stale hover is dropped
        chart.set_series_visible(0, false, &mut scene);
        assert_eq!(chart.prepare_layers(&v).markers.unwrap().len(), 0);
    }

    #[test]
    fn emphasis_dims_other_fills_and_strokes() {
        let (cam, mut chart) = state(vec![vec![1.0, 2.0], vec![2.0, 1.0]], AreaMode::Overlap);
        chart.set_emphasis(Some(1));
        let layers = chart.prepare_layers(&view(&cam));
        let fills = layers.fills.unwrap().to_vec();
        let segs = layers.series.unwrap().to_vec();
        assert!((fills[0].color[3] - 0.2 * DIMMED_SERIES_ALPHA).abs() < 1e-6);
        // Emphasized fill drawn last at its full fill opacity
        assert!((fills.last().unwrap().color[3] - 0.2).abs() < 1e-6);
        assert!(segs.iter().any(|s| s.color[3] < 0.5));
    }

    #[test]
    fn large_stacked_areas_are_decimated_with_the_strokes() {
        let n = 200_000;
        let a: Vec<f32> = (0..n).map(|i| 1.0 + (i as f32 * 0.01).sin()).collect();
        let b: Vec<f32> = (0..n).map(|i| 1.0 + (i as f32 * 0.003).cos()).collect();
        let (cam, mut chart) = state(vec![a, b], AreaMode::Stacked);
        let v = view(&cam);
        let fills = chart.prepare_layers(&v).fills.unwrap().len();
        // At most (picks of both edges) x 6 vertices per band, ~4 picks per pixel column each
        assert!(fills > 0 && fills < 2 * 2 * 4 * 1600 * 6, "fills {fills} not decimated");
        // Zooming re-decimates the fills with the strokes
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&v, 0.01, c.x);
        let layers = chart.prepare_layers(&v);
        assert!(layers.fills.is_some() && layers.series.is_some() && layers.series_clip.is_some());
    }

    #[test]
    fn stacked_input_must_be_aligned() {
        let s = |len: usize, x: Option<Vec<f64>>| LineSeries { values: vec![1.0; len], x, color: RED, width_px: 1.0 };
        assert!(validate_area(&[s(3, None), s(2, None)], AreaMode::Overlap).is_ok());
        assert!(validate_area(&[s(3, None), s(2, None)], AreaMode::Stacked).is_err());
        let x = |v: [f64; 2]| Some(v.to_vec());
        assert!(validate_area(&[s(2, x([0.0, 1.0])), s(2, x([0.0, 1.0]))], AreaMode::Percent).is_ok());
        let err = validate_area(&[s(2, x([0.0, 1.0])), s(2, x([0.0, 2.0]))], AreaMode::Stacked).unwrap_err();
        assert!(err.contains("shared x"), "{err}");
        // Unvalidated misaligned input degrades to overlapping areas
        let chart = ChartState::new_area(vec![s(3, None), s(2, None)], LAYOUT, AreaMode::Stacked, 0.5);
        assert_eq!(area(&chart).mode, AreaMode::Overlap);
        assert_eq!(area(&chart).fill_opacity, 0.5);
    }

    #[test]
    fn time_x_axes_and_zoom_delegate_to_the_line_chart() {
        const DAY: f64 = 86_400_000.0;
        let x: Vec<f64> = (0..60).map(|d| 1_767_225_600_000.0 + d as f64 * DAY).collect();
        let mk = |v: f32| LineSeries { values: vec![v; 60], x: Some(x.clone()), color: RED, width_px: 2.0 };
        let mut chart = ChartState::new_area(
            vec![mk(1.0), mk(2.0)],
            LineLayout { x_kind: LineXKind::Time, ..LAYOUT },
            AreaMode::Stacked,
            f32::NAN,
        );
        let mut cam = flat_camera();
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        let v = view(&cam);
        chart.prepare_layers(&v);
        assert!(chart.axes().ticks.iter().any(|t| t.axis == 0 && t.granularity >= 5));
        let ys: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 1).map(|t| t.value).collect();
        assert_eq!(ys.first(), Some(&0.0));
        let c = cam.project_to_ndc(Vec3::ZERO).unwrap();
        chart.zoom_x(&v, 0.5, c.x);
        assert!((chart.x_window().1 - chart.x_window().0 - 0.5).abs() < 1e-4);
        chart.reset_zoom();
        assert_eq!(chart.x_window(), (0.0, 1.0));
    }

    #[test]
    fn y_axis_options_apply_to_areas_but_keep_the_zero_baseline() {
        use crate::chart::{LineYAxis, YAutoscale};
        let (_, mut chart) = state(vec![vec![40.0, 60.0, 80.0, 50.0]; 2], AreaMode::Stacked);
        chart.set_y_axis(LineYAxis { max: Some(500.0), ..Default::default() });
        let (lo, hi, _) = chart.y_domain().expect("areas report their y domain");
        assert_eq!((lo, hi), (0.0, 500.0));
        // Visible autoscale never lifts the bottom off zero (fills start at the baseline)
        chart.set_y_axis(LineYAxis { autoscale: YAutoscale::Visible, ..Default::default() });
        assert_eq!(chart.y_domain().unwrap().0, 0.0);
        // Percent areas stay at 0..100
        let (_, mut pct) = state(vec![vec![1.0, 2.0, 3.0]; 2], AreaMode::Percent);
        pct.set_y_axis(LineYAxis { max: Some(50.0), ..Default::default() });
        assert_eq!(pct.y_domain().unwrap().1, 100.0);
    }

    #[test]
    fn overlap_streaming_keeps_raw_samples_ids_and_zero_baseline() {
        let (cam, mut chart) = state(vec![vec![10.0, 20.0], vec![7.0, 8.0]], AreaMode::Overlap);
        chart.prepare_layers(&view(&cam));
        assert_eq!(chart.append_series_data(0, &[30.0, 40.0], None, 3).unwrap(), 3);
        assert_eq!(chart.line_values(0).unwrap(), &[20.0, 30.0, 40.0]);
        assert_eq!(chart.sample(0).unwrap().2, 20.0);
        assert_eq!(chart.sample(3).unwrap().2, 7.0);
        assert_eq!(chart.point_count(), 5);
        assert_eq!(chart.y_domain().unwrap().0, 0.0);
        assert!(chart.prepare_layers(&view(&cam)).fills.is_some());
        assert!(chart.prepare_layers(&view(&cam)).fills.is_none());
        // Expired positive values cannot keep a newly negative stream off-screen.
        chart.set_y_axis(LineYAxis { autoscale: YAutoscale::Visible, ..Default::default() });
        chart.append_series_data(0, &[-30.0, -20.0, -10.0], None, 3).unwrap();
        assert!(chart.y_domain().unwrap().0 <= -30.0);
    }

    #[test]
    fn overlap_streaming_compacts_without_stale_hover_or_readback() {
        let (_, mut chart) = state(vec![vec![0.0; 8]], AreaMode::Overlap);
        for i in 1..2200 {
            chart.append_series_data(0, &[i as f32], None, 8).unwrap();
        }
        assert_eq!(chart.line_values(0).unwrap(), &[2192.0, 2193.0, 2194.0, 2195.0, 2196.0, 2197.0, 2198.0, 2199.0]);
        assert_eq!(chart.sample(0).unwrap().2, 2192.0);
        assert_eq!(chart.sample(7).unwrap().2, 2199.0);
        assert!(chart.sample(8).is_none());
        assert!(area(&chart).line.series[0].values.len() < 1100);
    }

    #[test]
    fn replacing_stacked_values_rebuilds_tops_but_exports_raw_values() {
        let (cam, mut chart) = state(vec![vec![1.0, 2.0], vec![10.0, 20.0]], AreaMode::Stacked);
        chart.prepare_layers(&view(&cam));
        chart.set_series_data(0, vec![30.0, 40.0], None).unwrap();
        assert_eq!(tops(&chart), vec![vec![30.0, 40.0], vec![40.0, 60.0]]);
        assert_eq!(chart.line_values(1).unwrap(), &[10.0, 20.0]);
        assert_eq!(chart.sample(3).unwrap().2, 20.0);
        assert!(chart.y_domain().unwrap().1 >= 60.0);
        assert!(chart.prepare_layers(&view(&cam)).fills.is_some());
        chart.set_series_visible(0, false, &mut SceneWorld::new());
        chart.set_series_data(1, vec![50.0, 70.0], None).unwrap();
        assert_eq!(tops(&chart)[1], vec![50.0, 70.0]);
        assert!(!area(&chart).line.visible[0]);
    }

    #[test]
    fn percent_replacement_normalizes_and_keeps_its_fixed_domain() {
        let (_, mut chart) = state(vec![vec![1.0, 1.0], vec![3.0, 3.0]], AreaMode::Percent);
        chart.set_series_data(0, vec![9.0, 0.0], None).unwrap();
        assert!(same(&tops(&chart)[0], &[75.0, 0.0]));
        assert!(same(&tops(&chart)[1], &[100.0, 100.0]));
        assert_eq!(chart.y_domain().unwrap().0, 0.0);
        assert_eq!(chart.y_domain().unwrap().1, 100.0);
    }

    #[test]
    fn misaligned_single_series_updates_leave_stacks_unchanged() {
        let (_, mut chart) = state(vec![vec![1.0, 2.0], vec![3.0, 4.0]], AreaMode::Stacked);
        let before = tops(&chart);
        assert!(chart.set_series_data(0, vec![5.0], None).unwrap_err().contains("aligned"));
        assert!(chart.append_series_data(0, &[5.0], None, 0).unwrap_err().contains("appendAreaData"));
        assert_eq!(tops(&chart), before);
        assert_eq!(chart.line_values(0).unwrap(), &[1.0, 2.0]);
    }

    #[test]
    fn batch_append_restacks_fifo_and_keeps_percent_domain() {
        for mode in [AreaMode::Overlap, AreaMode::Stacked, AreaMode::Percent] {
            let (cam, mut chart) = state(vec![vec![1.0, 2.0], vec![3.0, 6.0]], mode);
            chart.prepare_layers(&view(&cam));
            assert_eq!(chart.append_area_data(&[&[3.0, 4.0], &[9.0, 12.0]], None, 3).unwrap(), vec![3, 3]);
            assert_eq!(chart.line_values(0).unwrap(), &[2.0, 3.0, 4.0]);
            assert_eq!(chart.line_values(1).unwrap(), &[6.0, 9.0, 12.0]);
            assert_eq!(chart.sample(3).unwrap().2, 6.0);
            let a = area(&chart);
            let expected = match mode {
                AreaMode::Overlap => vec![6.0, 9.0, 12.0],
                AreaMode::Stacked => vec![8.0, 12.0, 16.0],
                AreaMode::Percent => vec![100.0; 3],
            };
            assert!(same(a.line.vals(1), &expected));
            assert!(chart.prepare_layers(&view(&cam)).fills.is_some());
            assert!(chart.prepare_layers(&view(&cam)).fills.is_none());
            if mode == AreaMode::Percent {
                assert_eq!(chart.y_domain().unwrap().1, 100.0);
            }
        }
    }

    #[test]
    fn invalid_batch_is_atomic_and_time_windows_keep_their_absolute_span() {
        let t0 = 1_767_225_600_000.0;
        let x: Vec<f64> = (0..100).map(|i| t0 + i as f64).collect();
        let mut input = series(vec![vec![1.0; 100], vec![2.0; 100]]);
        for s in &mut input { s.x = Some(x.clone()); }
        let mut chart = ChartState::new_area(input, LAYOUT, AreaMode::Stacked, f32::NAN);
        let ChartKind::Area(a) = &mut chart.kind else { unreachable!() };
        a.line.set_window(0.5, 1.0);
        let before = tops(&chart);
        // The second series is bad: the first must not have been appended either.
        assert!(chart.append_area_data(&[&[3.0], &[4.0]], Some(&[&[t0 + 100.0], &[t0 + 98.0]]), 100).is_err());
        assert_eq!(tops(&chart), before);
        assert_eq!(chart.line_x(0).unwrap(), x);
        assert!(chart.append_area_data(&[&[3.0], &[4.0, 5.0]], None, 100).is_err());
        assert!(chart.append_area_data(&[&[3.0]], None, 100).is_err());
        let next = [t0 + 100.0, t0 + 101.0];
        chart.append_area_data(&[&[3.0, 4.0], &[6.0, 8.0]], Some(&[&next, &next]), 100).unwrap();
        let l = &area(&chart).line;
        assert!((l.window.1 - 1.0).abs() < 1e-6);
        assert!(((l.window.1 - l.window.0) as f64 * l.x_span - 49.5).abs() < 1e-4);
        assert_eq!(chart.line_x(0).unwrap()[0], t0 + 2.0);
        assert_eq!(chart.line_x(1).unwrap()[99], t0 + 101.0);
        assert_eq!(chart.line_values(0).unwrap()[99], 4.0);
        assert_eq!(chart.line_values(1).unwrap()[99], 8.0);
        assert_eq!(area(&chart).line.vals(1)[99], 12.0);
    }

    #[test]
    fn stacked_fifo_compaction_preserves_raw_values_and_visibility() {
        let (_, mut chart) = state(vec![vec![1.0; 8], vec![3.0; 8]], AreaMode::Stacked);
        chart.set_series_visible(0, false, &mut SceneWorld::new());
        for i in 1..2200 {
            chart.append_area_data(&[&[i as f32], &[2.0 * i as f32]], None, 8).unwrap();
        }
        assert_eq!(chart.line_values(0).unwrap()[0], 2192.0);
        assert_eq!(chart.line_values(1).unwrap()[7], 4398.0);
        assert_eq!(area(&chart).line.vals(1)[7], 4398.0);
        assert!(area(&chart).raw[0].len() < 1100);
        chart.set_series_visible(0, true, &mut SceneWorld::new());
        assert_eq!(area(&chart).line.vals(1)[7], 6597.0);
        assert!(chart.y_domain().unwrap().1 >= 6597.0, "re-shown stack must not be clipped");
        // Replacing after compaction must reset the raw head along with the drawn head.
        chart.set_series_data(0, vec![10.0; 8], None).unwrap();
        assert_eq!(chart.sample(0).unwrap().2, 10.0);
        assert_eq!(area(&chart).line.vals(1)[7], 4408.0);
    }
}
