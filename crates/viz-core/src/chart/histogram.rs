//! Histogram: O(n) binning (Freedman–Diaconis with a Sturges fallback, or a fixed bin count) of
//! raw values into a numeric-axis bar chart (zero-gap bars, x ticks on bin edges).

use super::bar::BarChart;
use super::*;

/// Bin count cap of the automatic rules (heavy tails would otherwise ask for millions of bins).
pub const MAX_AUTO_BINS: usize = 1_000;
/// Bin count cap of an explicit count.
pub const MAX_BINS: usize = 10_000;

/// How the bin count is chosen.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistogramBins {
    /// Freedman–Diaconis width `2 IQR n^(-1/3)`; Sturges (`ceil(log2 n) + 1`) when the IQR is 0
    Auto,
    Count(usize),
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HistogramOptions {
    pub bins: HistogramBins,
    /// Binned range `[min, max]`; values outside it are ignored (`None` = finite data extent)
    pub range: Option<(f64, f64)>,
    /// Bar heights are a density (`count / (total * width)`, integrating to 1) instead of counts
    pub density: bool,
}

impl Default for HistogramOptions {
    fn default() -> Self {
        Self { bins: HistogramBins::Auto, range: None, density: false }
    }
}

/// Rule that produced the bin count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinRule {
    FreedmanDiaconis,
    Sturges,
    Fixed,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Histogram {
    /// `bins + 1` ascending edges, equally spaced (`edges[0]` = range min, last = range max)
    pub edges: Vec<f64>,
    /// Count per bin (`[edges[i], edges[i + 1])`, the last bin also includes its right edge)
    pub counts: Vec<u32>,
    /// Bar heights: counts, or densities with `density`
    pub heights: Vec<f32>,
    /// Finite values inside the range
    pub total: usize,
    pub rule: BinRule,
}

/// Finite (min, max) of `values`, `None` without finite values.
fn finite_range(values: &[f32]) -> Option<(f64, f64)> {
    let (lo, hi) = values
        .iter()
        .filter(|v| v.is_finite())
        .fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), &v| (lo.min(v), hi.max(v)));
    (lo <= hi).then_some((lo as f64, hi as f64))
}

/// Linear-interpolated quantile `q` (numpy's default) of `v`, reordering `v` (O(n) average).
pub(crate) fn quantile(v: &mut [f32], q: f64) -> f64 {
    let pos = q * (v.len() - 1) as f64;
    let k = pos.floor() as usize;
    let (_, &mut a, right) = v.select_nth_unstable_by(k, f32::total_cmp);
    let frac = pos - k as f64;
    if frac == 0.0 || right.is_empty() {
        return a as f64;
    }
    // The next order statistic is the minimum of the upper partition
    let b = right.iter().copied().fold(f32::INFINITY, f32::min);
    a as f64 + frac * (b as f64 - a as f64)
}

/// Freedman–Diaconis bin width `2 IQR n^(-1/3)` of `values` (finite, in range); 0 when the
/// IQR is 0 or there are fewer than 2 values. Reorders `values`.
pub fn fd_bin_width(values: &mut [f32]) -> f64 {
    let n = values.len();
    if n < 2 {
        return 0.0;
    }
    let q1 = quantile(values, 0.25);
    let q3 = quantile(values, 0.75);
    2.0 * (q3 - q1) / (n as f64).cbrt()
}

/// Sturges bin count `ceil(log2 n) + 1`.
pub fn sturges_bins(n: usize) -> usize {
    (n.max(1) as f64).log2().ceil() as usize + 1
}

/// Bins `values` (non-finite values and values outside the range are ignored). O(n): one extent
/// pass, two selections for the IQR (auto rule only, on a copy of the in-range values), one
/// counting pass.
pub fn compute_histogram(values: &[f32], opts: &HistogramOptions) -> Histogram {
    let range = opts
        .range
        .filter(|(a, b)| a.is_finite() && b.is_finite())
        .map(|(a, b)| (a.min(b), a.max(b)))
        .or_else(|| finite_range(values));
    let (mut lo, mut hi) = range.unwrap_or((0.0, 1.0));
    if hi <= lo {
        // Single value: one unit-wide bin around it
        (lo, hi) = (lo - 0.5, hi + 0.5);
    }
    let inside = |v: f32| v.is_finite() && (v as f64) >= lo && (v as f64) <= hi;

    let (bins, rule) = match opts.bins {
        HistogramBins::Count(k) => (k.clamp(1, MAX_BINS), BinRule::Fixed),
        HistogramBins::Auto => {
            let mut sample: Vec<f32> = values.iter().copied().filter(|&v| inside(v)).collect();
            let n = sample.len();
            let h = fd_bin_width(&mut sample);
            if h > 0.0 {
                ((((hi - lo) / h).ceil() as usize).clamp(1, MAX_AUTO_BINS), BinRule::FreedmanDiaconis)
            } else {
                (sturges_bins(n).min(MAX_AUTO_BINS), BinRule::Sturges)
            }
        }
    };

    let span = hi - lo;
    let edges: Vec<f64> = (0..=bins).map(|k| lo + span * k as f64 / bins as f64).collect();
    let mut counts = vec![0u32; bins];
    let scale = bins as f64 / span;
    let mut total = 0usize;
    for &v in values {
        if !inside(v) {
            continue;
        }
        // The right edge belongs to the last bin
        let k = (((v as f64 - lo) * scale) as usize).min(bins - 1);
        counts[k] = counts[k].saturating_add(1);
        total += 1;
    }
    let width = span / bins as f64;
    let heights = counts
        .iter()
        .map(|&c| {
            if opts.density {
                if total > 0 { (c as f64 / (total as f64 * width)) as f32 } else { 0.0 }
            } else {
                c as f32
            }
        })
        .collect();
    Histogram { edges, counts, heights, total, rule }
}

impl BarChart {
    /// x ticks of a histogram: "nice" values (1 / 2 / 5 x 10^n, about one per 72 px) over the
    /// binned range, placed on the value axis the edges span (bin edges are rarely round numbers).
    pub(crate) fn edge_ticks(&self, edges: &[f64], view: &ChartView, plot: [f32; 4], out: &mut AxisLayout) {
        let bins = edges.len().saturating_sub(1);
        let (Some(&lo), Some(&hi)) = (edges.first(), edges.last()) else {
            return;
        };
        if bins == 0 || hi <= lo {
            return;
        }
        let target = ((plot[2] / 72.0).floor() as u32).max(2);
        let step = nice_step(hi - lo, target);
        let half_w = self.layout.width * 0.5;
        let world_span = bins as f32 * self.spacing;
        let bottom = plot[1] + plot[3];
        for v in ticks_between(lo, hi, step) {
            let x = -half_w + ((v - lo) / (hi - lo)) as f32 * world_span;
            if let Some((cx, _)) = view.project_css(Vec3::new(x, self.bottom, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value: v, x_css: cx, y_css: bottom, granularity: 0 });
            }
        }
    }
}

impl ChartState {
    /// Bins `values` (see `compute_histogram`) and lays the bins out as single-series 2D bars
    /// filling their slots, `gap_px` CSS px apart, on a numeric x axis ticked at bin edges.
    pub fn new_histogram(
        values: &[f32],
        opts: &HistogramOptions,
        color: [f32; 4],
        layout: BarLayout,
        gap_px: f32,
        scene: &mut SceneWorld,
    ) -> Self {
        let hist = compute_histogram(values, opts);
        let layout = BarLayout { bar_width: 0.0, view: ChartViewMode::Flat, ..layout };
        let series = BarSeriesLayout {
            series_count: 1,
            mode: BarMode::Grouped,
            group_gap: 0.0,
            gap_px: if gap_px.is_finite() { gap_px.clamp(0.0, 8.0) } else { 1.0 },
        };
        let mut state = Self::new_bar_series(hist.heights.clone(), vec![color], layout, series, scene);
        if let ChartKind::Bar(b) = &mut state.kind {
            b.histogram = Some(hist);
        }
        state
    }

    /// Bins of a histogram chart.
    pub fn histogram(&self) -> Option<&Histogram> {
        match &self.kind {
            ChartKind::Bar(b) => b.histogram.as_ref(),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts(bins: HistogramBins) -> HistogramOptions {
        HistogramOptions { bins, ..Default::default() }
    }

    /// Deterministic uniform values in [0, 1) (xorshift).
    fn uniform(n: usize, mut seed: u64) -> Vec<f32> {
        (0..n)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 7;
                seed ^= seed << 17;
                (seed >> 40) as f32 / (1u64 << 24) as f32
            })
            .collect()
    }

    #[test]
    fn fixed_bins_count_every_value_once_with_the_right_edge_in_the_last_bin() {
        let values = [0.0, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, f32::NAN, f32::INFINITY];
        let h = compute_histogram(&values, &opts(HistogramBins::Count(4)));
        assert_eq!(h.edges, vec![0.0, 1.0, 2.0, 3.0, 4.0]);
        // [0,1): 0, 0.5  [1,2): 1, 1.5  [2,3): 2, 2.5  [3,4]: 3, 4
        assert_eq!(h.counts, vec![2, 2, 2, 2]);
        assert_eq!(h.total, 8);
        assert_eq!(h.rule, BinRule::Fixed);
        assert_eq!(h.heights, vec![2.0; 4]);
    }

    #[test]
    fn range_drops_outside_values_and_density_integrates_to_one() {
        let values: Vec<f32> = (0..100).map(|i| i as f32).collect();
        let h = compute_histogram(
            &values,
            &HistogramOptions { bins: HistogramBins::Count(5), range: Some((50.0, 10.0)), density: true },
        );
        assert_eq!((h.edges[0], *h.edges.last().unwrap()), (10.0, 50.0));
        assert_eq!(h.total, 41); // 10..=50
        assert_eq!(h.counts, vec![8, 8, 8, 8, 9]);
        let area: f64 = h.heights.iter().map(|&d| d as f64 * 8.0).sum();
        assert!((area - 1.0).abs() < 1e-6, "density area {area}");
    }

    #[test]
    fn auto_bins_follow_freedman_diaconis() {
        // 1..=1000: q1 = 250.75, q3 = 750.25 (numpy linear) -> h = 2 * 499.5 / 10 = 99.9
        let mut values: Vec<f32> = (1..=1000).map(|i| i as f32).collect();
        let w = fd_bin_width(&mut values.clone());
        assert!((w - 99.9).abs() < 1e-9);
        values.reverse(); // order must not matter
        let h = compute_histogram(&values, &opts(HistogramBins::Auto));
        assert_eq!(h.rule, BinRule::FreedmanDiaconis);
        assert_eq!(h.counts.len(), (999.0 / w).ceil() as usize);
        assert!((10..=11).contains(&h.counts.len()));
        assert_eq!(h.counts.iter().sum::<u32>(), 1000);
    }

    #[test]
    fn zero_iqr_falls_back_to_sturges() {
        // 90% identical values: IQR = 0
        let mut values = vec![5.0f32; 900];
        values.extend((0..100).map(|i| i as f32));
        let h = compute_histogram(&values, &opts(HistogramBins::Auto));
        assert_eq!(h.rule, BinRule::Sturges);
        assert_eq!(h.counts.len(), sturges_bins(1000)); // ceil(log2 1000) + 1 = 11
        assert_eq!(sturges_bins(1000), 11);
        // One value: a unit bin around it
        let h = compute_histogram(&[3.0], &opts(HistogramBins::Auto));
        assert_eq!((h.edges[0], h.edges[1], h.counts[0]), (2.5, 3.5, 1));
        // No finite values: one empty bin
        let h = compute_histogram(&[f32::NAN], &opts(HistogramBins::Auto));
        assert_eq!((h.counts.clone(), h.total), (vec![0], 0));
    }

    #[test]
    fn a_million_values_bin_in_linear_time_and_match_the_uniform_shape() {
        let values = uniform(1_000_000, 0x9e37_79b9_7f4a_7c15);
        let h = compute_histogram(&values, &opts(HistogramBins::Auto));
        assert_eq!(h.rule, BinRule::FreedmanDiaconis);
        assert_eq!(h.total, 1_000_000);
        // Uniform: IQR ~ 0.5 -> h ~ 1 / 100, about 100 bins of ~10,000 each
        assert!((95..=105).contains(&h.counts.len()), "bins {}", h.counts.len());
        let expect = 1_000_000.0 / h.counts.len() as f64;
        assert!(h.counts.iter().all(|&c| (c as f64 - expect).abs() < expect * 0.1));
    }

    #[test]
    fn histogram_chart_draws_zero_gap_bars_and_ticks_bin_edges() {
        let mut scene = SceneWorld::new();
        let values: Vec<f32> = (0..400).map(|i| (i % 40) as f32 * 0.25).collect();
        let layout = BarLayout { width: 160.0, max_height: 80.0, bar_width: 0.0, corner_radius_px: 1.0, view: ChartViewMode::Flat };
        let mut state = ChartState::new_histogram(
            &values,
            &opts(HistogramBins::Count(20)),
            [0.2, 0.5, 0.9, 1.0],
            layout,
            1.0,
            &mut scene,
        );
        let hist = state.histogram().expect("histogram").clone();
        assert_eq!(hist.counts.len(), 20);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        state.frame_camera(&mut cam, (1600.0, 900.0));
        let view = ChartView { camera: &cam, viewport_px: (1600, 900), pixel_ratio: 1.0 };
        let layers = state.prepare_layers(&view);
        let bars = layers.bars.unwrap();
        assert_eq!(bars.len(), 20);
        // Bars fill their slot (edge to edge), the 1 px gap is cut on the GPU from both sides
        for w in bars.windows(2) {
            assert!((w[0].rect[2] - w[1].rect[0]).abs() < 1e-4);
        }
        assert!((bars[0].rect[0] + 80.0).abs() < 1e-4 && (bars[19].rect[2] - 80.0).abs() < 1e-4);
        assert!(bars.iter().all(|b| b.z_radius[3] == -1.0));
        // x ticks are nice values on the binned value axis (not category indices or raw edges)
        let x: Vec<&AxisTick> = state.axes().ticks.iter().filter(|t| t.axis == 0).collect();
        assert!(x.len() >= 3);
        let step = x[1].value - x[0].value;
        assert!([1.0, 2.0, 5.0].iter().any(|m| (step / 10f64.powf(step.log10().floor()) - m).abs() < 1e-9), "{step}");
        assert!(x.iter().all(|t| (t.value / step - (t.value / step).round()).abs() < 1e-9));
        // Placed linearly between the first / last edge (= plot left / right)
        let plot = state.axes().plot_css;
        let (lo, hi) = (hist.edges[0], *hist.edges.last().unwrap());
        for t in &x {
            let want = plot[0] + ((t.value - lo) / (hi - lo)) as f32 * plot[2];
            assert!((t.x_css - want).abs() < 0.5, "{} at {} want {want}", t.value, t.x_css);
        }
        // Hover reports the bin index and its count
        let p = cam.project_to_ndc(Vec3::new(-80.0 + 8.0 * 3.5, -39.0, 0.0)).unwrap();
        let hit = state.hover_at(&view, &mut scene, (p.x, p.y)).expect("bin 3");
        assert_eq!((hit.items[0].index, hit.items[0].value), (3, hist.counts[3] as f32));
    }
}
