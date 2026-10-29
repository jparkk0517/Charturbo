//! Cursor sync between charts (dashboards): hover at a data x reported by another chart, and the
//! data x of the current hover. Same data units as the x ranges in range.rs (line: series `x`,
//! epoch ms on time axes, else sample index; bar: category index; scatter: x values).

use super::area::AreaChart;
use super::bar::BarChart;
use super::line::LineChart;
use super::range::line_x_domain;
use super::scatter::ScatterChart;
use super::*;

/// Line / area: in index mode at data `x`, every visible series' sample nearest to `x` (series
/// with explicit x only where their samples reach it); the primary item is the one closest in x.
/// `None` outside the visible zoom window (plus half a sample at the edges).
fn line_at_x(l: &LineChart, x: f64) -> Option<HoverResult> {
    // Domain and stored x live in scale space (log10 units on a log x axis)
    let x = l.x_data_to_abs(x);
    let domain = line_x_domain(l);
    let span = domain.1 - domain.0;
    let t = (x - domain.0) / span;
    let edge_t = 0.5 * l.min_gap_t as f64;
    if !t.is_finite() || t < l.window.0 as f64 - edge_t || t > l.window.1 as f64 + edge_t {
        return None;
    }
    let mut items = Vec::new();
    let (mut primary, mut best) = (0, f64::INFINITY);
    for s in (0..l.series.len()).filter(|&s| l.visible[s]) {
        let len = l.len(s);
        if len == 0 {
            continue;
        }
        let (i, xi) = match l.xs(s) {
            // f64 search on the absolute x (epoch ms keep their precision)
            Some(xs) => {
                let target = x - l.x_origin;
                let edge = edge_t * l.x_span;
                if target < xs[0] - edge || target > xs[len - 1] + edge {
                    continue;
                }
                let k = xs.partition_point(|&v| v < target);
                let i = if k == 0 {
                    0
                } else if k >= len || target - xs[k - 1] <= xs[k] - target {
                    k - 1
                } else {
                    k
                };
                (i, xs[i] + l.x_origin)
            }
            // Index placement: each series spans the whole domain (like the pointer hover)
            None => {
                let last = (len - 1) as f64;
                let i = (t.clamp(0.0, 1.0) * last).round() as usize;
                let ti = if len == 1 { 0.5 } else { i as f64 / last };
                (i, domain.0 + ti * span)
            }
        };
        let v = l.vals(s)[i];
        if !v.is_finite() {
            continue;
        }
        let d = (xi - x).abs();
        if d < best {
            best = d;
            primary = items.len();
        }
        items.push(HoverItem { series: s as u32, index: i as u32, value: v, global_id: l.offsets[s] + i as u32 });
    }
    (!items.is_empty()).then_some(HoverResult { is_bar: false, primary, items })
}

/// Data x of a line sample: its explicit x, else its place in the index domain.
fn line_sample_x(l: &LineChart, s: usize, i: usize) -> Option<f64> {
    if s >= l.series.len() || i >= l.len(s) {
        return None;
    }
    let len = l.len(s);
    if let Some(xs) = l.xs(s) {
        return Some(l.x_abs_to_data(xs[i] + l.x_origin));
    }
    let domain = line_x_domain(l);
    let t = if len == 1 { 0.5 } else { i as f64 / (len - 1) as f64 };
    Some(domain.0 + t * (domain.1 - domain.0))
}

/// Bars: the category at `round(x)`, every visible series with a value there (primary = first).
fn bar_at_x(b: &BarChart, x: f64) -> Option<HoverResult> {
    let c = x.round();
    if !c.is_finite() || c < 0.0 || c >= b.categories as f64 {
        return None;
    }
    let c = c as usize;
    let items: Vec<HoverItem> = (0..b.series_count)
        .filter(|&s| b.visible[s] && b.values[s * b.categories + c].is_finite())
        .map(|s| {
            let g = s * b.categories + c;
            HoverItem { series: s as u32, index: c as u32, value: b.values[g], global_id: g as u32 }
        })
        .collect();
    (!items.is_empty()).then_some(HoverResult { is_bar: true, primary: 0, items })
}

/// Scatter: per visible series, the point inside the zoom window nearest to `x` (any y); the
/// primary item is the one closest in x. `None` outside the visible x range. Linear scan: it
/// runs once per synced pointer move, not per frame.
fn scatter_at_x(s: &ScatterChart, x: f64) -> Option<HoverResult> {
    let (d0, d1) = s.x_domain;
    let tx = ((s.x_scale.fwd(x) - d0) / (d1 - d0)) as f32;
    if !tx.is_finite() || tx < s.window_x.0 || tx > s.window_x.1 {
        return None;
    }
    // Per series: (point, |dt|)
    let mut best: Vec<Option<(usize, f32)>> = vec![None; s.visible.len()];
    for (i, t) in s.t.iter().enumerate() {
        let sid = s.series_of(i);
        let inside = (s.window_x.0..=s.window_x.1).contains(&t[0]) && (s.window_y.0..=s.window_y.1).contains(&t[1]);
        if !inside || !s.visible.get(sid).copied().unwrap_or(false) {
            continue;
        }
        let d = (t[0] - tx).abs();
        if best[sid].is_none_or(|(_, bd)| d < bd) {
            best[sid] = Some((i, d));
        }
    }
    let mut items = Vec::new();
    let (mut primary, mut nearest) = (0, f32::INFINITY);
    for (sid, (i, d)) in best.into_iter().enumerate().filter_map(|(sid, b)| Some((sid, b?))) {
        if d < nearest {
            nearest = d;
            primary = items.len();
        }
        items.push(HoverItem { series: sid as u32, index: i as u32, value: s.ys[i], global_id: i as u32 });
    }
    (!items.is_empty()).then_some(HoverResult { is_bar: false, primary, items })
}

impl ChartState {
    /// Hovers the chart at data `x` as if a pointer rested there in index mode (a synced chart's
    /// cursor): updates crosshair / markers / bar highlight and returns the hovered points like
    /// `hover_at`. Non-finite or out-of-range `x` clears the hover and returns `None`. Data
    /// updates re-pick at the same x (`refresh_hover`).
    pub fn hover_at_data_x(&mut self, scene: &mut SceneWorld, x: f64) -> Option<HoverResult> {
        self.hover_ndc = None;
        let result = if x.is_finite() {
            match &mut self.kind {
                ChartKind::Line(l) => line_at_x(l, x),
                ChartKind::Area(a) => line_at_x(&a.line, x).map(|mut hit| {
                    // Markers sit on the drawn tops; report the input values (like `AreaChart::hover`)
                    for item in &mut hit.items {
                        item.value = a.values(item.series as usize)[item.index as usize];
                    }
                    hit
                }),
                ChartKind::Bar(b) => bar_at_x(b, x),
                ChartKind::Scatter(s) => scatter_at_x(s, x),
                ChartKind::Candle(c) => c.hover_at_x(x),
                // A cell needs a row too: heatmaps do not follow a synced x cursor
                ChartKind::Heatmap(_) => None,
                ChartKind::Box(_) => None,
                // Slices have no x: pies do not follow a synced cursor
                ChartKind::Pie(_) => None,
                ChartKind::Combo(c) => c.category_near(x).and_then(|i| c.items_at(i, None, false)),
                // Waterfalls follow a synced category cursor like bars
                ChartKind::Waterfall(w) => bar_at_x(&w.bar, x),
                ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) => None,
                ChartKind::Hierarchy(_) | ChartKind::Scientific3D(_) => None,
                ChartKind::Calendar(_) => None,
            }
        } else {
            None
        };
        self.hover_x = result.as_ref().map(|_| x);
        self.set_hover(result.clone(), scene);
        result
    }

    /// Data x of the current hover's primary point (what a synced chart hovers at): line / area
    /// sample x, bar category index, scatter point x. `None` without a hover.
    pub fn hover_data_x(&self) -> Option<f64> {
        let hover = self.hover.as_ref()?;
        let item = hover.items.get(hover.primary)?;
        match &self.kind {
            ChartKind::Line(l) | ChartKind::Area(AreaChart { line: l, .. }) => {
                line_sample_x(l, item.series as usize, item.index as usize)
            }
            ChartKind::Bar(_) => Some(item.index as f64),
            ChartKind::Scatter(s) => {
                let t = s.t.get(item.index as usize)?[0];
                let (d0, d1) = s.x_domain;
                t.is_finite().then_some(s.x_scale.inv(d0 + t as f64 * (d1 - d0)))
            }
            ChartKind::Candle(c) => c.sample_x(item.index as usize),
            ChartKind::Heatmap(_) => None,
            ChartKind::Box(_) => None,
            ChartKind::Pie(_) => None,
            ChartKind::Combo(c) => c.xs.get(item.index as usize).copied(),
            ChartKind::Waterfall(_) => Some(item.index as f64),
            ChartKind::Radar(_) | ChartKind::Gauge(_) | ChartKind::Funnel(_) => None,
            ChartKind::Hierarchy(_) | ChartKind::Scientific3D(_) => None,
            ChartKind::Calendar(_) => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart::{BarLayout, LineLayout, LineSeries, LineXKind, ScatterLayout, ScatterPoints};

    fn line(values: Vec<Vec<f32>>, xs: Option<Vec<Vec<f64>>>) -> ChartState {
        let mut xs = xs.map(|v| v.into_iter());
        let series = values
            .into_iter()
            .map(|values| LineSeries { values, x: xs.as_mut().and_then(|it| it.next()), color: [1.0; 4], width_px: 2.0 })
            .collect();
        ChartState::new_line(
            series,
            LineLayout { width: 160.0, height: 80.0, view: ChartViewMode::Flat, x_kind: LineXKind::Time },
        )
    }

    fn ids(hit: &HoverResult) -> Vec<(u32, u32)> {
        hit.items.iter().map(|i| (i.series, i.index)).collect()
    }

    #[test]
    fn line_hover_at_x_picks_the_nearest_sample_per_series() {
        // Epoch-ms x, two series with different sampling (60 s vs 90 s)
        let t0 = 1.7e12;
        let a: Vec<f64> = (0..10).map(|i| t0 + i as f64 * 60_000.0).collect();
        let b: Vec<f64> = (0..6).map(|i| t0 + i as f64 * 90_000.0).collect();
        let mut c = line(vec![(0..10).map(|i| i as f32).collect(), vec![5.0; 6]], Some(vec![a, b]));
        let mut scene = SceneWorld::new();
        // 200 s: series 0 -> sample 3 (180 s), series 1 -> sample 2 (180 s); both 20 s away
        let hit = c.hover_at_data_x(&mut scene, t0 + 200_000.0).unwrap();
        assert_eq!(ids(&hit), vec![(0, 3), (1, 2)]);
        assert_eq!(hit.items[0].value, 3.0);
        assert_eq!(c.hover_data_x(), Some(t0 + 180_000.0));
        // 520 s: series 1 ends at 450 s (one 60 s gap of slack = 30 s): only series 0
        let hit = c.hover_at_data_x(&mut scene, t0 + 520_000.0).unwrap();
        assert_eq!(ids(&hit), vec![(0, 9)]);
        assert!(c.hover.is_some());
    }

    #[test]
    fn line_index_domain_maps_shorter_series_like_the_pointer() {
        // Longest series: indices 0..=10; the 3-sample series spans the same width
        let mut c = line(vec![vec![1.0; 11], vec![2.0, 3.0, 4.0]], None);
        let mut scene = SceneWorld::new();
        let hit = c.hover_at_data_x(&mut scene, 6.0).unwrap();
        assert_eq!(ids(&hit), vec![(0, 6), (1, 1)]);
        assert_eq!(hit.primary, 0, "series 0 sits exactly at x = 6");
        assert_eq!(c.hover_data_x(), Some(6.0));
    }

    #[test]
    fn out_of_range_or_bad_x_clears_the_hover() {
        let mut c = line(vec![vec![1.0; 11]], None);
        let mut scene = SceneWorld::new();
        assert!(c.hover_at_data_x(&mut scene, 4.0).is_some());
        assert!(c.hover_at_data_x(&mut scene, 11.0).is_none(), "past the last sample + half a gap");
        assert_eq!(c.hover_data_x(), None);
        assert!(c.hover_at_data_x(&mut scene, -0.4).is_some(), "within half a sample of the edge");
        assert!(c.hover_at_data_x(&mut scene, f64::NAN).is_none());
        // Zoomed in: x outside the visible window is out of range
        assert!(c.set_x_range_data(0.0, 8.0));
        assert!(c.hover_at_data_x(&mut scene, 9.0).is_none());
        assert!(c.hover_at_data_x(&mut scene, 7.0).is_some());
    }

    #[test]
    fn pointer_hover_and_clear_drop_the_synced_x() {
        let mut c = line(vec![vec![1.0; 11]], None);
        let mut scene = SceneWorld::new();
        c.hover_at_data_x(&mut scene, 4.0);
        assert_eq!(c.hover_x, Some(4.0));
        c.clear_hover(&mut scene);
        assert_eq!((c.hover_x, c.hover_data_x()), (None, None));
    }

    #[test]
    fn bar_categories_map_by_rounding() {
        let mut scene = SceneWorld::new();
        let layout = BarLayout { width: 100.0, max_height: 50.0, bar_width: 0.0, corner_radius_px: 4.0, view: ChartViewMode::Flat };
        // 2 series x 3 categories, one missing value
        let values = vec![1.0, 2.0, 3.0, 4.0, f32::NAN, 6.0];
        let series = BarSeriesLayout { series_count: 2, ..Default::default() };
        let mut c = ChartState::new_bar_series(values, vec![[1.0; 4]; 2], layout, series, &mut scene);
        let hit = c.hover_at_data_x(&mut scene, 2.3).unwrap();
        assert!(hit.is_bar);
        assert_eq!(ids(&hit), vec![(0, 2), (1, 2)]);
        assert_eq!(hit.items[1].global_id, 5);
        assert_eq!(c.hover_data_x(), Some(2.0));
        let hit = c.hover_at_data_x(&mut scene, 0.6).unwrap();
        assert_eq!(ids(&hit), vec![(0, 1)], "missing value skipped");
        assert!(c.hover_at_data_x(&mut scene, 2.6).is_none());
        assert!(c.hover_at_data_x(&mut scene, -0.6).is_none());
    }

    #[test]
    fn scatter_picks_the_nearest_x_per_series() {
        let points = ScatterPoints {
            xs: vec![0.0, 40.0, 100.0, 55.0, 90.0],
            ys: vec![1.0, 2.0, 3.0, 4.0, 5.0],
            series: vec![0, 0, 0, 1, 1],
            series_colors: vec![[1.0; 4]; 2],
            ..Default::default()
        };
        let mut c = ChartState::new_scatter(points, ScatterLayout::default());
        let mut scene = SceneWorld::new();
        let hit = c.hover_at_data_x(&mut scene, 50.0).unwrap();
        assert_eq!(ids(&hit), vec![(0, 1), (1, 3)]);
        assert_eq!(hit.primary, 1, "55 is closer than 40");
        assert!((c.hover_data_x().unwrap() - 55.0).abs() < 1e-3);
        c.set_series_visible(1, false, &mut scene);
        assert_eq!(ids(&c.hover_at_data_x(&mut scene, 50.0).unwrap()), vec![(0, 1)]);
        let (lo, hi) = c.x_range_data().unwrap();
        assert!(c.hover_at_data_x(&mut scene, lo - 1.0).is_none() && c.hover_at_data_x(&mut scene, hi + 1.0).is_none());
    }
}
