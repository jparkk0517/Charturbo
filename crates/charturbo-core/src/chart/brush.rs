//! Brush / box selection on 2D charts (like Plotly box select, ECharts brush, Vega interval
//! selections). A drag rectangle in NDC becomes a data-unit rectangle (so it follows zoom / pan),
//! drawn live as a translucent rectangle with a border. Committing it queries the data:
//! line / area series give runs of sample indices inside the x interval (the `XY` brush also
//! filters by value, O(range) per series), scatter gives point ids inside the rectangle (via the
//! spatial hash, O(candidates)), bars give the categories inside the x interval.
//! Selected scatter points are re-packed once on top at full strength while the others dim.

use super::annotations::DataFrame;
use super::*;
use crate::renderer::ChartAnnotationLayer;

/// Brush shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum BrushMode {
    /// x interval over the full plot height (time range)
    #[default]
    X,
    /// x / y rectangle (bar charts always brush x only)
    XY,
}

impl BrushMode {
    /// 0 = x, 1 = xy
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::XY
        } else {
            Self::X
        }
    }
}

/// Brush rectangle look. The live (dragging) border is dashed; the committed one is solid.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BrushStyle {
    pub fill: [f32; 4],
    pub border: [f32; 4],
    pub border_px: f32,
    /// Dash length of the live border in CSS px (0 = solid)
    pub dash_px: f32,
}

impl Default for BrushStyle {
    fn default() -> Self {
        Self {
            fill: [0.42, 0.56, 0.86, 0.14],
            border: [0.42, 0.56, 0.86, 0.9],
            border_px: 1.0,
            dash_px: 4.0,
        }
    }
}

/// What a selection holds: sample runs (line / area), category ids (bar), point ids (scatter),
/// candle indices (candlestick).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SelectionKind {
    #[default]
    Line,
    Bar,
    Scatter,
    Candle,
}

/// Committed selection in data units. Line indices count live samples (like hover indices), so
/// data updates re-run the query (`ChartState::selection`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ChartSelection {
    pub kind: SelectionKind,
    pub mode: BrushMode,
    pub x_range: (f64, f64),
    /// `None` = whole y range (`X` brush, bars)
    pub y_range: Option<(f64, f64)>,
    /// Line / area: `[series, start, end)` runs of selected samples, per visible series in order
    pub ranges: Vec<[u32; 3]>,
    /// Scatter: point ids (ascending, visible series only); bars: category indices
    pub ids: Vec<u32>,
}

impl ChartSelection {
    /// Selected samples (line), points (scatter) or categories (bar).
    pub fn count(&self) -> usize {
        self.ids.len() + self.ranges.iter().map(|r| (r[2] - r[1]) as usize).sum::<usize>()
    }
}

/// Brush rectangle in data units: x `(lo, hi)`, y `None` = full height.
type DataRect = ((f64, f64), Option<(f64, f64)>);

/// Brush state of a chart: live / committed rectangle, its selection, and staged marks.
#[derive(Debug, Clone, Default)]
pub(crate) struct Brush {
    rect: Option<DataRect>,
    mode: BrushMode,
    /// The rectangle is being dragged (not committed)
    live: bool,
    selection: Option<ChartSelection>,
    /// Data / visibility changed since the selection was computed
    stale: bool,
    /// Scatter: every point inside the committed rectangle (any series), for re-packing
    point_mask: Option<Vec<bool>>,
    style: BrushStyle,
    fills: Vec<ChartFillRaw>,
    lines: Vec<ChartSegmentRaw>,
    marks_key: Option<(Option<DataFrame>, Option<DataRect>, bool, BrushStyle)>,
}

impl Brush {
    /// Data / visibility changed: the committed selection is re-queried on its next read.
    pub(crate) fn invalidate(&mut self) {
        self.stale |= self.selection.is_some();
    }

    pub(crate) fn point_mask(&self) -> Option<&[bool]> {
        self.point_mask.as_deref()
    }

    /// Rebuilds the marks when the rectangle, style or data -> world mapping changed; returns
    /// true when they must be uploaded.
    pub(crate) fn prepare(&mut self, frame: Option<DataFrame>) -> bool {
        let key = (frame, self.rect, self.live, self.style);
        if self.marks_key == Some(key) {
            return false;
        }
        self.marks_key = Some(key);
        self.fills.clear();
        self.lines.clear();
        let (Some(f), Some(((x0, x1), y))) = (frame, self.rect) else {
            return true;
        };
        let [bx0, bx1, by0, by1] = f.bounds;
        // Clip to the visible plot (the rectangle stays put in data units while zooming)
        let (wx0, wx1) = (f.x.map(x0), f.x.map(x1));
        let (wy0, wy1) = y.map_or((by0, by1), |(y0, y1)| (f.y.map(y0), f.y.map(y1)));
        let (l, r) = (wx0.min(wx1).max(bx0), wx0.max(wx1).min(bx1));
        let (b, t) = (wy0.min(wy1).max(by0), wy0.max(wy1).min(by1));
        if !(r >= l && t >= b) {
            return true;
        }
        let z = f.z_above + 0.25;
        let st = &self.style;
        let v = |x: f32, y: f32| ChartFillRaw { position: [x, y, z, 0.0], color: st.fill };
        self.fills.extend([v(l, b), v(r, b), v(r, t), v(l, b), v(r, t), v(l, t)]);
        if st.border_px > 0.0 {
            let dash = if self.live { st.dash_px.max(0.0) } else { 0.0 };
            let eps = 1e-4 * (bx1 - bx0).abs().max(by1 - by0);
            let mut edge = |p: [f32; 2], q: [f32; 2]| {
                self.lines.push(ChartSegmentRaw {
                    p0_width: [p[0], p[1], z, st.border_px],
                    p1_pad: [q[0], q[1], z, dash],
                    color: st.border,
                });
            };
            // Only edges the clip did not move (an x brush has no top / bottom edge)
            if (l - wx0.min(wx1)).abs() <= eps {
                edge([l, b], [l, t]);
            }
            if (r - wx0.max(wx1)).abs() <= eps {
                edge([r, b], [r, t]);
            }
            if y.is_some() {
                if (b - wy0.min(wy1)).abs() <= eps {
                    edge([l, b], [r, b]);
                }
                if (t - wy0.max(wy1)).abs() <= eps {
                    edge([l, t], [r, t]);
                }
            }
        }
        true
    }

    pub(crate) fn layer(&self) -> ChartAnnotationLayer<'_> {
        ChartAnnotationLayer {
            fills: &self.fills,
            lines: &self.lines,
            markers: &[],
        }
    }
}

/// Normalized `[0, 1]` position of `v` in `domain`.
#[inline]
fn norm(v: f64, domain: (f64, f64)) -> f32 {
    ((v - domain.0) / (domain.1 - domain.0)) as f32
}

/// Ordered pair.
#[inline]
fn ordered((a, b): (f64, f64)) -> (f64, f64) {
    (a.min(b), a.max(b))
}

/// Appends `[series, start, end)` runs of the samples of `s` inside the x interval (and the y
/// interval for an `XY` brush).
fn line_ranges(l: &LineChart, s: usize, x: (f64, f64), y: Option<(f64, f64)>, out: &mut Vec<[u32; 3]>) {
    if l.style.sparse.get(s).is_some_and(Option::is_some) {
        let mut run = None;
        for i in 0..=l.len(s) {
            let hit = i < l.len(s) && l.sparse_selected(s, i, x, y);
            match (hit, run) {
                (true, None) => run = Some(i),
                (false, Some(start)) => { out.push([s as u32, start as u32, i as u32]); run = None; }
                _ => {}
            }
        }
        return;
    }
    let len = l.len(s);
    if len == 0 {
        return;
    }
    let (from, to) = match l.xs(s) {
        // Binary search on the stored (origin-relative, non-decreasing) x
        // Stored x is in scale space (log10 on a log x axis)
        Some(xs) => (
            xs.partition_point(|&v| v < l.x_data_to_abs(x.0) - l.x_origin),
            xs.partition_point(|&v| v <= l.x_data_to_abs(x.1) - l.x_origin),
        ),
        None => {
            // x = sample index of the longest series; series `s` spreads its samples over it
            let n = l.max_len();
            let (d0, d1) = if n > 1 { (0.0, (n - 1) as f64) } else { (-0.5, 0.5) };
            let t = |v: f64| (v - d0) / (d1 - d0);
            if len == 1 {
                let inside = (t(x.0)..=t(x.1)).contains(&0.5);
                (0, usize::from(inside))
            } else {
                let last = (len - 1) as f64;
                let eps = 1e-9 * last;
                let a = (t(x.0) * last - eps).ceil().max(0.0);
                let b = (t(x.1) * last + eps).floor().min(last);
                if b < a {
                    return;
                }
                (a as usize, b as usize + 1)
            }
        }
    };
    if from >= to {
        return;
    }
    let band = l.style.band(s).is_some_and(|b| b.edge_widths.is_some());
    if y.is_none() && !band {
        out.push([s as u32, from as u32, to as u32]);
        return;
    }
    // Value filter: O(range) scan, consecutive hits merged into runs
    let vals = l.vals(s);
    let (y0, y1) = y.map_or((f32::NEG_INFINITY, f32::INFINITY), |(a, b)| (a as f32, b as f32));
    let mut run: Option<usize> = None;
    for (i, &v) in vals.iter().enumerate().take(to).skip(from) {
        let hit = if band { l.band_interval(s, i).is_some_and(|(a, b)| a <= y1 && b >= y0) } else { v >= y0 && v <= y1 };
        match (hit, run) {
            (true, None) => run = Some(i),
            (false, Some(start)) => {
                out.push([s as u32, start as u32, i as u32]);
                run = None;
            }
            _ => {}
        }
    }
    if let Some(start) = run {
        out.push([s as u32, start as u32, to as u32]);
    }
}

impl ScatterChart {
    /// Ids of the points inside the data rectangle (`y` `None` = any y), any series, ascending.
    pub(crate) fn ids_in_rect(&self, x: (f64, f64), y: Option<(f64, f64)>) -> Vec<u32> {
        // Domains live in scale space (log10 units on a log axis)
        let (fx, fy) = (|v| self.x_scale.fwd(v), |v| self.y_scale.fwd(v));
        let (tx0, tx1) = (norm(fx(x.0), self.x_domain), norm(fx(x.1), self.x_domain));
        let (ty0, ty1) = y.map_or((f32::NEG_INFINITY, f32::INFINITY), |(a, b)| (norm(fy(a), self.y_domain), norm(fy(b), self.y_domain)));
        let mut ids = Vec::new();
        self.for_each_candidate([tx0, ty0], [tx1, ty1], |i, t| {
            if t[0] >= tx0 && t[0] <= tx1 && t[1] >= ty0 && t[1] <= ty1 {
                ids.push(i as u32);
            }
        });
        // Grid order is by cell: sort so ids are stable and binary-searchable
        ids.sort_unstable();
        ids
    }
}

impl ChartState {
    /// Data rectangle of an NDC drag from `a` to `b`, clamped to the plot (`None` outside 2D
    /// views or when the pointer misses the plot plane). Bars always brush x only.
    fn brush_rect(&self, view: &ChartView, mode: BrushMode, a: (f32, f32), b: (f32, f32)) -> Option<(BrushMode, DataRect)> {
        let f = self.annotation_frame()?;
        // Horizontal bars: no brush (categories run along y)
        if matches!(&self.kind, ChartKind::Bar(b) if b.horizontal()) {
            return None;
        }
        let [bx0, bx1, by0, by1] = f.bounds;
        let hit = |p: (f32, f32)| {
            let w = ray_hit_z_plane(&view.camera.screen_to_ray(p.0, p.1), f.z)?;
            Some((w.x.clamp(bx0, bx1), w.y.clamp(by0, by1)))
        };
        let (pa, pb) = (hit(a)?, hit(b)?);
        let mode = if matches!(self.kind, ChartKind::Bar(_)) { BrushMode::X } else { mode };
        let x = ordered((f.x.unmap(pa.0), f.x.unmap(pb.0)));
        let y = (mode == BrushMode::XY).then(|| ordered((f.y.unmap(pa.1), f.y.unmap(pb.1))));
        Some((mode, (x, y)))
    }

    /// Live brush from NDC `a` (drag start) to `b` (pointer): drawn as a dashed rectangle, not
    /// committed. Drops a previous selection. Returns false outside 2D views.
    pub fn brush_update(&mut self, view: &ChartView, mode: BrushMode, a: (f32, f32), b: (f32, f32)) -> bool {
        if ![a.0, a.1, b.0, b.1].iter().all(|v| v.is_finite()) {
            return false;
        }
        let Some((mode, rect)) = self.brush_rect(view, mode, a, b) else {
            return false;
        };
        self.drop_selection();
        self.brush.mode = mode;
        self.brush.rect = Some(rect);
        self.brush.live = true;
        true
    }

    /// Commits the live brush: runs the selection query and returns it (`None` without a brush).
    pub fn brush_end(&mut self) -> Option<&ChartSelection> {
        let (x, y) = self.brush.rect.filter(|_| self.brush.live)?;
        let mode = self.brush.mode;
        self.select_data(mode, x, y)
    }

    /// Selects a data rectangle (`y` `None` = whole y range; ignored by bars and `X` brushes).
    /// x is the sample index / x value (line), category index (bar), or x (scatter). Returns
    /// `None` outside 2D views or for non-finite input.
    pub fn select_data(&mut self, mode: BrushMode, x: (f64, f64), y: Option<(f64, f64)>) -> Option<&ChartSelection> {
        self.annotation_frame()?;
        if matches!(&self.kind, ChartKind::Bar(b) if b.horizontal()) {
            return None;
        }
        let x = ordered(x);
        let mode = if matches!(self.kind, ChartKind::Bar(_)) { BrushMode::X } else { mode };
        let y = y.filter(|_| mode == BrushMode::XY).map(ordered);
        if !x.0.is_finite() || !x.1.is_finite() || y.is_some_and(|(a, b)| !a.is_finite() || !b.is_finite()) {
            return None;
        }
        if mode == BrushMode::XY && y.is_none() {
            return None;
        }
        self.drop_selection();
        self.brush.mode = mode;
        self.brush.rect = Some((x, y));
        self.brush.live = false;
        if let ChartKind::Scatter(s) = &self.kind {
            let all = s.ids_in_rect(x, y);
            let mut mask = vec![false; s.len()];
            for &i in &all {
                mask[i as usize] = true;
            }
            self.brush.point_mask = Some(mask);
            self.dirty.points = true;
        }
        self.brush.selection = Some(self.query_selection(mode, x, y));
        self.brush.stale = false;
        self.brush.selection.as_ref()
    }

    /// Runs the selection query for a data rectangle on the current data / visibility.
    fn query_selection(&self, mode: BrushMode, x: (f64, f64), y: Option<(f64, f64)>) -> ChartSelection {
        let mut sel = ChartSelection { mode, x_range: x, y_range: y, ..Default::default() };
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                // `y` is in left-axis units: right-axis series compare the same screen band in
                // their own units
                let y_right = match (y, l.has_right(), self.annotation_frame()) {
                    (Some((a, b)), true, Some(f)) => {
                        let to_right = |v: f64| f.y2.unmap(f.y.map(v));
                        Some(ordered((to_right(a), to_right(b))))
                    }
                    _ => y,
                };
                for s in (0..l.series.len()).filter(|&s| l.visible.get(s).copied().unwrap_or(false)) {
                    let ys = if l.axis_of(s) == 1 { y_right } else { y };
                    line_ranges(l, s, x, ys, &mut sel.ranges);
                }
            }
            ChartKind::Bar(b) => {
                sel.kind = SelectionKind::Bar;
                // Category i is centred on x = i: selected when its centre is inside
                let n = b.categories as f64;
                let (lo, hi) = (x.0.ceil().max(0.0), x.1.floor().min(n - 1.0));
                if hi >= lo {
                    sel.ids.extend(lo as u32..=hi as u32);
                }
            }
            ChartKind::Scatter(s) => {
                sel.kind = SelectionKind::Scatter;
                let visible = |i: u32| s.visible.get(s.series_of(i as usize)).copied().unwrap_or(true);
                sel.ids = match &self.brush.point_mask {
                    Some(mask) => (0..mask.len() as u32).filter(|&i| mask[i as usize] && visible(i)).collect(),
                    None => s.ids_in_rect(x, y).into_iter().filter(|&i| visible(i)).collect(),
                };
            }
            ChartKind::Candle(c) => {
                sel.kind = SelectionKind::Candle;
                sel.ids = c.ids_in_range(x, y);
            }
            // No annotation frame on heatmaps yet, so no brush rectangle: nothing to select
            ChartKind::Heatmap(_) => {}
            // No annotation frame on box plots either
            ChartKind::Box(_) => {}
            // Brush disabled on pies (no data frame)
            ChartKind::Pie(_) => {}
            // Not supported on combo charts
            ChartKind::Combo(_) => {}
            // No brush on the business charts (the SDK never starts one there)
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) | ChartKind::Waterfall(_) => {}
            ChartKind::Hierarchy(_) => {}
        }
        sel
    }

    /// Forgets the selection (and the scatter highlight) but not the rectangle.
    fn drop_selection(&mut self) {
        self.brush.selection = None;
        self.brush.stale = false;
        if self.brush.point_mask.take().is_some() {
            self.dirty.points = true;
        }
    }

    /// Removes the brush rectangle and the selection.
    pub fn clear_selection(&mut self) {
        self.drop_selection();
        self.brush.rect = None;
        self.brush.live = false;
    }

    /// Committed selection, re-queried first when data / visibility changed since.
    pub fn selection(&mut self) -> Option<&ChartSelection> {
        if self.brush.stale {
            self.brush.stale = false;
            if let Some(old) = self.brush.selection.take() {
                self.brush.selection = Some(self.query_selection(old.mode, old.x_range, old.y_range));
            }
        }
        self.brush.selection.as_ref()
    }

    /// True while a live or committed brush rectangle is shown.
    pub fn has_brush(&self) -> bool {
        self.brush.rect.is_some()
    }

    pub fn set_brush_style(&mut self, style: BrushStyle) {
        self.brush.style = style;
    }

    pub fn brush_style(&self) -> BrushStyle {
        self.brush.style
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
        ChartView {
            camera: cam,
            viewport_px: (1600, 900),
            pixel_ratio: 1.0,
        }
    }

    fn line(values: Vec<Vec<f32>>, xs: Option<Vec<Vec<f64>>>) -> ChartState {
        let mut xs = xs.map(|v| v.into_iter());
        let series = values
            .into_iter()
            .map(|values| LineSeries {
                values,
                x: xs.as_mut().and_then(|it| it.next()),
                color: [1.0; 4],
                width_px: 2.0,
            })
            .collect();
        ChartState::new_line(
            series,
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Numeric },
        )
    }

    /// NDC of a world point.
    fn ndc(cam: &OrbitCamera, x: f32, y: f32) -> (f32, f32) {
        let c = cam.view_proj_matrix() * glam::Vec4::new(x, y, 0.0, 1.0);
        (c.x / c.w, c.y / c.w)
    }

    /// Deterministic pseudo-random sequence in [0, 1).
    fn lcg(seed: &mut u64) -> f32 {
        *seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        (*seed >> 40) as f32 / (1u64 << 24) as f32
    }

    #[test]
    fn line_x_brush_gives_one_index_range_per_visible_series() {
        // 101 samples (x = index 0..100) and 11 samples spread over the same domain
        let mut c = line(vec![(0..101).map(|i| i as f32).collect(), vec![0.0; 11]], None);
        let sel = c.select_data(BrushMode::X, (25.0, 50.0), None).unwrap().clone();
        assert_eq!(sel.ranges, vec![[0, 25, 51], [1, 3, 6]], "series 1: x = 30, 40, 50 -> indices 3..=5");
        assert_eq!(sel.count(), 26 + 3);
        assert!(sel.ids.is_empty() && sel.y_range.is_none());
        // Reversed input, hidden series dropped (lazily re-queried)
        let mut scene = SceneWorld::new();
        c.set_series_visible(1, false, &mut scene);
        assert_eq!(c.selection().unwrap().ranges, vec![[0, 25, 51]]);
        let sel = c.select_data(BrushMode::X, (50.0, 25.0), None).unwrap();
        assert_eq!(sel.ranges, vec![[0, 25, 51]]);
        // Outside the data: empty
        assert!(c.select_data(BrushMode::X, (200.0, 300.0), None).unwrap().ranges.is_empty());
    }

    #[test]
    fn line_explicit_x_binary_searches_epoch_ms() {
        let t0 = 1.7e12;
        let xs: Vec<f64> = (0..1000).map(|i| t0 + i as f64 * 60_000.0).collect();
        let mut c = line(vec![vec![1.0; 1000]], Some(vec![xs]));
        let sel = c.select_data(BrushMode::X, (t0 + 10.0 * 60_000.0, t0 + 20.5 * 60_000.0), None).unwrap();
        assert_eq!(sel.ranges, vec![[0, 10, 21]]);
    }

    #[test]
    fn xy_brush_filters_values_into_runs() {
        // Values cycle 0, 1, 2, ..., 9: y in [2, 4] hits 3 consecutive samples per cycle
        let values: Vec<f32> = (0..100).map(|i| (i % 10) as f32).collect();
        let mut c = line(vec![values.clone()], None);
        let sel = c.select_data(BrushMode::XY, (0.0, 29.0), Some((4.0, 2.0))).unwrap().clone();
        assert_eq!(sel.ranges, vec![[0, 2, 5], [0, 12, 15], [0, 22, 25]]);
        // Brute force over the same rectangle
        let brute: Vec<u32> = (0..30u32).filter(|&i| (2.0..=4.0).contains(&values[i as usize])).collect();
        let runs: Vec<u32> = sel.ranges.iter().flat_map(|r| r[1]..r[2]).collect();
        assert_eq!(runs, brute);
        assert_eq!(sel.y_range, Some((2.0, 4.0)));
        // A run reaching the end of the x interval is closed there
        let sel = c.select_data(BrushMode::XY, (0.0, 3.0), Some((2.0, 9.0))).unwrap();
        assert_eq!(sel.ranges, vec![[0, 2, 4]]);
        // XY without y is rejected
        assert!(c.select_data(BrushMode::XY, (0.0, 3.0), None).is_none());
    }

    #[test]
    fn scatter_ids_via_grid_match_brute_force() {
        let mut seed = 7u64;
        let n = 20_000;
        let xs: Vec<f32> = (0..n).map(|_| lcg(&mut seed) * 1000.0).collect();
        let ys: Vec<f32> = (0..n).map(|_| lcg(&mut seed) * 50.0 - 25.0).collect();
        let series: Vec<u16> = (0..n).map(|i| (i % 3) as u16).collect();
        let points = ScatterPoints {
            xs: xs.clone(),
            ys: ys.clone(),
            series: series.clone(),
            series_colors: vec![[1.0; 4]; 3],
            ..Default::default()
        };
        let mut c = ChartState::new_scatter(points, ScatterLayout::default());
        for (x, y) in [((120.0, 480.0), Some((-10.0, 3.5))), ((0.0, 1000.0), Some((24.0, 30.0))), ((990.5, 991.0), None)] {
            let got = c.select_data(if y.is_some() { BrushMode::XY } else { BrushMode::X }, x, y).unwrap().ids.clone();
            let brute: Vec<u32> = (0..n as u32)
                .filter(|&i| {
                    let (px, py) = (xs[i as usize] as f64, ys[i as usize] as f64);
                    px >= x.0 && px <= x.1 && y.is_none_or(|(a, b)| py >= a && py <= b)
                })
                .collect();
            assert_eq!(got, brute, "rect {x:?} {y:?}");
        }
        // Hidden series are not reported, but stay in the highlight mask
        let mut scene = SceneWorld::new();
        let all = c.select_data(BrushMode::XY, (0.0, 500.0), Some((-25.0, 25.0))).unwrap().ids.len();
        c.set_series_visible(1, false, &mut scene);
        let ids = c.selection().unwrap().ids.clone();
        assert!(ids.iter().all(|&i| series[i as usize] != 1) && ids.len() < all);
        assert_eq!(c.brush.point_mask().unwrap().iter().filter(|&&m| m).count(), all);
    }

    #[test]
    fn scatter_selection_repacks_selected_points_on_top() {
        let points = ScatterPoints { xs: vec![0.0, 50.0, 100.0], ys: vec![0.0, 1.0, 2.0], ..Default::default() };
        let mut c = ChartState::new_scatter(points, ScatterLayout::default());
        let cam = flat_camera();
        let v = view(&cam);
        c.prepare_layers(&v);
        let full: Vec<u8> = c.points.iter().map(|p| p.color[3]).collect();
        assert_eq!(c.select_data(BrushMode::X, (40.0, 60.0), None).unwrap().ids, vec![1]);
        let layers = c.prepare_layers(&v);
        let pts = layers.points.expect("re-packed once");
        assert!(layers.brush.is_some_and(|b| b.fills.len() == 6));
        // Unselected first (dimmed), the selected point last at full strength
        assert_eq!(pts.len(), 3);
        assert_eq!(pts[2].color[3], full[1]);
        assert!(pts[0].color[3] < full[0] && pts[1].color[3] < full[2]);
        assert!(c.prepare_layers(&v).points.is_none(), "no re-pack without changes");
        c.clear_selection();
        let layers = c.prepare_layers(&v);
        assert_eq!(layers.points.unwrap().iter().map(|p| p.color[3]).collect::<Vec<_>>(), full);
        assert!(layers.brush.is_some_and(|b| b.fills.is_empty()));
        assert!(c.selection().is_none());
    }

    #[test]
    fn bar_categories_in_the_x_interval() {
        let mut scene = SceneWorld::new();
        let layout = BarLayout { width: 100.0, max_height: 50.0, bar_width: 0.0, corner_radius_px: 4.0, view: ChartViewMode::Flat };
        let mut c = ChartState::new_bar(vec![1.0; 10], vec![[1.0; 4]; 10], layout, &mut scene);
        let sel = c.select_data(BrushMode::XY, (2.4, 6.6), Some((0.0, 1.0))).unwrap();
        assert_eq!(sel.ids, vec![3, 4, 5, 6]);
        assert_eq!((sel.mode, sel.y_range), (BrushMode::X, None), "bars brush x only");
        assert_eq!(c.select_data(BrushMode::X, (-5.0, 0.2), None).unwrap().ids, vec![0]);
        assert!(c.select_data(BrushMode::X, (9.2, 20.0), None).unwrap().ids.is_empty());
        assert_eq!(c.selection().unwrap().count(), 0);
    }

    #[test]
    fn ndc_drag_maps_to_data_and_draws_a_clamped_rectangle() {
        let cam = flat_camera();
        let v = view(&cam);
        // Index x 0..100 over world x -80..80; y domain [0, 100] over world y -40..40
        let mut c = line(vec![(0..101).map(|i| i as f32).collect()], None);
        let (_, y_max, _) = c.y_domain().unwrap();
        assert_eq!(y_max, 100.0);
        // World x -40 = index 25, world x 0 = index 50; y = 0.5 * 80 - 40 = 0 -> value 50
        let (a, b) = (ndc(&cam, -40.0, 0.0), ndc(&cam, 0.0, 20.0));
        assert!(c.brush_update(&v, BrushMode::XY, a, b));
        let layers = c.prepare_layers(&v);
        let brush = layers.brush.unwrap();
        assert_eq!((brush.fills.len(), brush.lines.len()), (6, 4));
        assert!(brush.lines.iter().all(|s| s.p1_pad[3] > 0.0), "live border is dashed");
        let sel = c.brush_end().unwrap().clone();
        assert!((sel.x_range.0 - 25.0).abs() < 1e-3 && (sel.x_range.1 - 50.0).abs() < 1e-3);
        let (y0, y1) = sel.y_range.unwrap();
        assert!((y0 - 50.0).abs() < 1e-3 && (y1 - 75.0).abs() < 1e-3);
        assert_eq!(sel.ranges, vec![[0, 50, 51]], "only sample 50 has x and y inside");
        let brush = c.prepare_layers(&v).brush.unwrap();
        assert!(brush.lines.iter().all(|s| s.p1_pad[3] == 0.0), "committed border is solid");
        assert!(c.brush_end().is_none(), "already committed");

        // Dragging past the plot clamps to it: an x brush over everything
        let (a, b) = (ndc(&cam, -500.0, 0.0), ndc(&cam, 500.0, 0.0));
        assert!(c.brush_update(&v, BrushMode::X, a, b));
        assert!(c.selection().is_none(), "a new drag drops the old selection");
        let sel = c.brush_end().unwrap();
        assert_eq!(sel.ranges, vec![[0, 0, 101]]);
        // x brush: left / right borders only (on the plot edges it was clamped to)
        let brush = c.prepare_layers(&v).brush.unwrap();
        assert_eq!((brush.fills.len(), brush.lines.len()), (6, 2));
        // Panned so the left edge leaves the plot: that border is clipped away
        c.set_x_range_data(50.0, 100.0);
        assert_eq!(c.prepare_layers(&v).brush.unwrap().lines.len(), 1);
        c.reset_zoom();

        // The committed rectangle follows zoom in data units; outside the window it vanishes
        c.select_data(BrushMode::X, (10.0, 20.0), None);
        c.set_x_range_data(50.0, 100.0);
        assert!(c.prepare_layers(&v).brush.unwrap().fills.is_empty());
        c.reset_zoom();
        assert_eq!(c.prepare_layers(&v).brush.unwrap().fills.len(), 6);
        c.clear_selection();
        assert!(!c.has_brush());
    }

    #[test]
    fn streaming_re_queries_the_selection_lazily() {
        let mut c = line(vec![(0..10).map(|i| i as f32).collect()], Some(vec![(0..10).map(|i| i as f64).collect()]));
        assert_eq!(c.select_data(BrushMode::X, (2.0, 4.0), None).unwrap().ranges, vec![[0, 2, 5]]);
        // Trim the 3 oldest samples: live indices shift
        c.append_series_data(0, &[10.0, 11.0, 12.0], Some(&[10.0, 11.0, 12.0]), 10).unwrap();
        assert_eq!(c.selection().unwrap().ranges, vec![[0, 0, 2]]);
    }

    #[test]
    fn depth_views_do_not_brush() {
        let cam = flat_camera();
        let v = view(&cam);
        let mut c = ChartState::new_line(
            vec![LineSeries { values: vec![1.0; 10], x: None, color: [1.0; 4], width_px: 2.0 }],
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Depth, x_kind: LineXKind::Numeric },
        );
        assert!(!c.brush_update(&v, BrushMode::X, (-0.5, 0.0), (0.5, 0.0)));
        assert!(c.select_data(BrushMode::X, (0.0, 5.0), None).is_none());
        assert!(!c.brush_update(&v, BrushMode::X, (f32::NAN, 0.0), (0.5, 0.0)));
    }
}
