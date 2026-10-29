//! ThemeRiver (streamgraph): stacked areas around a moving baseline.
//!
//! A ThemeRiver is an `AreaChart` in stacked mode plus a `StreamLayout`: the bottom stream sits on
//! a baseline `g0(x)` instead of zero, every stream above sits on the one below. Strokes, fills
//! (curves included), x mapping, zoom / pan, LOD, index hover and the legend are the area chart's.
//!
//! Baselines (same numbers as d3-shape, which the tests check):
//! - `Wiggle` (default): Byron & Wattenberg 2008 minimized weighted wiggle, d3 `stackOffsetWiggle`.
//!   `g0(0) = 0`, `g0(j) = g0(j-1) - Σᵢ fᵢ(j)·(Δfᵢ/2 + Σ_{k<i} Δfₖ) / Σᵢ fᵢ(j)`, Δ = f(j) - f(j-1).
//! - `Silhouette`: centred on zero, `g0 = -Σ f / 2` (d3 `stackOffsetSilhouette`).
//! - `Zero`: a plain stack on zero (d3 `stackOffsetNone`).
//!
//! Orders: `None` keeps the input order (bottom first), `InsideOut` is d3 `stackOrderInsideOut`
//! (streams sorted by the index of their peak, alternately added to the bottom / top group).
//! Only visible streams take part: hiding one (legend) re-orders and recomputes the baseline.
//!
//! Values are magnitudes: missing (`NaN`) and negative samples count as 0 for the baseline and the
//! streams above (a missing sample leaves a gap in its own band, like stacked areas).

use super::area::AreaChart;
use super::line::LineChart;
use super::linestyle::fill_missing;
use super::*;
use std::borrow::Cow;

/// Baseline (`g0`) of a ThemeRiver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StreamOffset {
    /// d3 `stackOffsetWiggle` (Byron & Wattenberg 2008)
    #[default]
    Wiggle,
    /// d3 `stackOffsetSilhouette`: centred on zero
    Silhouette,
    /// d3 `stackOffsetNone`: stacked on zero
    Zero,
}

impl StreamOffset {
    /// 0 wiggle, 1 silhouette, 2 zero
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Silhouette,
            2 => Self::Zero,
            _ => Self::Wiggle,
        }
    }
}

/// Stacking order of a ThemeRiver.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum StreamOrder {
    /// Input order, first stream at the bottom
    #[default]
    None,
    /// d3 `stackOrderInsideOut`: early-peaking streams in the middle, late ones outside
    InsideOut,
}

impl StreamOrder {
    /// 0 none, 1 inside-out
    pub fn from_u8(v: u8) -> Self {
        if v == 1 {
            Self::InsideOut
        } else {
            Self::None
        }
    }
}

/// Stream label anchor: the left end of a visible stream, in CSS px from the canvas top-left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct StreamLabel {
    pub series: u32,
    /// Left plot edge (or the stream's first sample, whichever is further right)
    pub x_css: f32,
    /// Middle of the band at that sample
    pub y_css: f32,
    /// Band thickness there
    pub height_css: f32,
}

/// ThemeRiver state of an `AreaChart`.
#[derive(Debug, Clone, Default)]
pub(crate) struct StreamLayout {
    pub(crate) offset: StreamOffset,
    pub(crate) order: StreamOrder,
    /// Visible streams, bottom first (recomputed by every restack)
    pub(crate) stack: Vec<usize>,
    /// Stream under the pointer (faded others) and the legend's emphasis; the line's emphasis is
    /// the legend's, else the hovered stream
    pub(crate) hovered: Option<usize>,
    pub(crate) legend: Option<usize>,
    pub(crate) labels: Vec<StreamLabel>,
    pub(crate) labels_revision: u32,
}

/// Share of a sample in the stack: missing / negative = 0.
#[inline]
fn share(v: f32) -> f64 {
    if v.is_finite() && v > 0.0 {
        v as f64
    } else {
        0.0
    }
}

/// Stack order of `layers` (one value slice per layer, all the same length): indices into
/// `layers`, bottom first.
pub fn stream_order(layers: &[&[f32]], order: StreamOrder) -> Vec<usize> {
    let n = layers.len();
    if order == StreamOrder::None {
        return (0..n).collect();
    }
    // d3 `stackOrderAppearance`: by index of the (first) peak; stable sort keeps ties in order
    let peak = |l: &[f32]| {
        let (mut at, mut best) = (0usize, f64::NEG_INFINITY);
        for (i, &v) in l.iter().enumerate() {
            let v = share(v);
            if v > best {
                (at, best) = (i, v);
            }
        }
        at
    };
    let peaks: Vec<usize> = layers.iter().map(|l| peak(l)).collect();
    let mut by_peak: Vec<usize> = (0..n).collect();
    by_peak.sort_by_key(|&i| peaks[i]);
    let sums: Vec<f64> = layers
        .iter()
        .map(|l| l.iter().map(|&v| share(v)).sum())
        .collect();
    let (mut top, mut bottom) = (0.0f64, 0.0f64);
    let (mut tops, mut bottoms) = (Vec::new(), Vec::new());
    for j in by_peak {
        if top < bottom {
            top += sums[j];
            tops.push(j);
        } else {
            bottom += sums[j];
            bottoms.push(j);
        }
    }
    bottoms.reverse();
    bottoms.extend(tops);
    bottoms
}

/// Baseline `g0` of `layers` given bottom first (one value per sample). `Wiggle` is O(samples ×
/// layers) with a running sum of the deltas below each layer.
pub fn stream_baseline(layers: &[&[f32]], offset: StreamOffset, out: &mut Vec<f64>) {
    let m = layers.iter().map(|l| l.len()).max().unwrap_or(0);
    out.clear();
    out.resize(m, 0.0);
    let at = |l: &[f32], j: usize| l.get(j).map_or(0.0, |&v| share(v));
    match offset {
        StreamOffset::Zero => {}
        StreamOffset::Silhouette => {
            for (j, g) in out.iter_mut().enumerate() {
                *g = -0.5 * layers.iter().map(|l| at(l, j)).sum::<f64>();
            }
        }
        StreamOffset::Wiggle => {
            let mut y = 0.0f64;
            for j in 1..m {
                let (mut s1, mut s2, mut below) = (0.0f64, 0.0f64, 0.0f64);
                for l in layers {
                    let (v, d) = (at(l, j), at(l, j) - at(l, j - 1));
                    s1 += v;
                    s2 += (d * 0.5 + below) * v;
                    below += d;
                }
                if s1 != 0.0 {
                    y -= s2 / s1;
                }
                out[j] = y;
            }
        }
    }
}

impl AreaChart {
    /// Visible streams, bottom first.
    pub(crate) fn stream_stack(&self) -> Vec<usize> {
        match &self.stream {
            Some(st) => st.stack.clone(),
            None => (0..self.line.series.len())
                .filter(|&s| self.line.visible[s])
                .collect(),
        }
    }

    /// Restacks a ThemeRiver: order and baseline of the visible streams, then their tops / bottoms.
    /// Hidden streams get `NaN` tops (no band, no hover) until shown again.
    pub(crate) fn restack_stream(&mut self) {
        let Some(st) = self.stream.as_mut() else {
            return;
        };
        let l = &mut self.line;
        let n = l.max_len();
        let raw: Vec<Cow<[f32]>> = (0..self.raw.len())
            .map(|s| match l.style.nulls(s) {
                NullPolicy::Gap => Cow::Borrowed(&self.raw[s][l.head[s]..]),
                nulls => Cow::Owned(fill_missing(&self.raw[s][l.head[s]..], nulls, l.xs(s))),
            })
            .collect();
        let visible: Vec<usize> = (0..raw.len()).filter(|&s| l.visible[s]).collect();
        let layers: Vec<&[f32]> = visible.iter().map(|&s| &raw[s][..]).collect();
        st.stack = stream_order(&layers, st.order)
            .into_iter()
            .map(|k| visible[k])
            .collect();
        let stacked: Vec<&[f32]> = st.stack.iter().map(|&s| &raw[s][..]).collect();
        let mut acc = Vec::new();
        stream_baseline(&stacked, st.offset, &mut acc);
        acc.resize(n, 0.0);
        self.base.resize(raw.len(), Vec::new());
        for (s, b) in self.base.iter_mut().enumerate() {
            if !l.visible[s] {
                b.clear();
                b.resize(n, f32::NAN);
                let head = l.head[s];
                l.series[s].values[head..].fill(f32::NAN);
            }
        }
        for &s in &st.stack {
            let connect = l.style.nulls(s) == NullPolicy::Connect;
            let head = l.head[s];
            let base = &mut self.base[s];
            base.clear();
            base.extend(acc.iter().map(|&g| g as f32));
            let top = &mut l.series[s].values[head..];
            for i in 0..n.min(top.len()) {
                let v = raw[s].get(i).copied().unwrap_or(f32::NAN);
                let missing = !v.is_finite() || (connect && !self.raw[s][head + i].is_finite());
                acc[i] += share(v);
                top[i] = if missing { f32::NAN } else { acc[i] as f32 };
            }
        }
    }

    /// Fits the y domain to the visible streams (bottom of the baseline to the top of the stack).
    pub(crate) fn fit_stream_domain(&mut self) {
        let l = &mut self.line;
        let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
        for s in (0..l.series.len()).filter(|&s| l.visible[s]) {
            for (&b, &t) in self.base[s].iter().zip(l.vals(s)) {
                if t.is_finite() && b.is_finite() {
                    lo = lo.min(b);
                    hi = hi.max(t);
                }
            }
        }
        if !(lo <= hi) {
            (lo, hi) = (0.0, 1.0);
        }
        l.data_min = lo;
        l.data_max = if hi > lo { hi } else { lo + 1.0 };
        l.update_y_domain(true);
    }

    /// Stream whose band holds world `y` at its hover sample (`items` from the line hover); None
    /// above / below the river. Edges get a hair of slack (keyboard focus points sit on the tops).
    pub(crate) fn stream_at(&self, items: &[HoverItem], y: f32) -> Option<usize> {
        let eps = 1e-3 * self.line.layout.height;
        items.iter().position(|it| {
            let (s, i) = (it.series as usize, it.index as usize);
            let (b, t) = (
                self.base[s].get(i).copied().unwrap_or(f32::NAN),
                self.line.vals(s).get(i).copied().unwrap_or(f32::NAN),
            );
            let (y0, y1) = (self.line.y_of(b), self.line.y_of(t));
            y0.is_finite() && y1.is_finite() && y >= y0.min(y1) - eps && y <= y0.max(y1) + eps
        })
    }

    /// Records the hovered / legend-emphasized stream; true when the drawn emphasis changed.
    pub(crate) fn set_stream_emphasis(
        &mut self,
        hovered: Option<Option<usize>>,
        legend: Option<Option<usize>>,
    ) -> bool {
        let Some(st) = self.stream.as_mut() else {
            return false;
        };
        if let Some(h) = hovered {
            st.hovered = h;
        }
        if let Some(e) = legend {
            st.legend = e;
        }
        let n = self.line.series.len();
        let e = st.legend.or(st.hovered).filter(|&s| s < n);
        let changed = self.line.emphasis != e;
        self.line.emphasis = e;
        changed
    }

    /// Recomputes the label anchors; true when they changed (revision bumped).
    fn layout_stream_labels(&mut self, view: &ChartView) -> bool {
        let l: &LineChart = &self.line;
        let Some(st) = self.stream.as_ref() else {
            return false;
        };
        let half = l.layout.width * 0.5;
        let mut out = Vec::with_capacity(st.stack.len());
        for &s in &st.stack {
            let Some(i) = l.sample_index_at_t(s, l.window.0) else {
                continue;
            };
            let (b, t) = (
                self.base[s].get(i).copied().unwrap_or(f32::NAN),
                l.vals(s)[i],
            );
            if !b.is_finite() || !t.is_finite() {
                continue;
            }
            let x = l.x_at(s, i).clamp(-half, half);
            let (Some(p0), Some(p1)) = (
                view.project_css(Vec3::new(x, l.y_of(b), 0.0)),
                view.project_css(Vec3::new(x, l.y_of(t), 0.0)),
            ) else {
                continue;
            };
            out.push(StreamLabel {
                series: s as u32,
                x_css: p0.0,
                y_css: 0.5 * (p0.1 + p1.1),
                height_css: (p0.1 - p1.1).abs(),
            });
        }
        let st = self.stream.as_mut().expect("stream");
        if out == st.labels {
            return false;
        }
        st.labels = out;
        st.labels_revision = st.labels_revision.wrapping_add(1);
        true
    }
}

impl ChartState {
    /// Creates a ThemeRiver from aligned streams (see `validate_area` with `AreaMode::Stacked`);
    /// `fill_opacity` NaN = the stacked default.
    pub fn new_theme_river(
        series: Vec<LineSeries>,
        layout: LineLayout,
        offset: StreamOffset,
        order: StreamOrder,
        fill_opacity: f32,
    ) -> Self {
        let mut a = AreaChart::new(series, layout, AreaMode::Stacked, fill_opacity);
        a.stream = Some(StreamLayout {
            offset,
            order,
            ..Default::default()
        });
        a.line.include_zero = offset == StreamOffset::Zero;
        a.restack();
        a.line.refresh_extents();
        a.fit_stream_domain();
        Self::with_kind(ChartKind::Area(a))
    }

    /// Stream offset and order of the current ThemeRiver.
    pub fn theme_river_layout(&self) -> Option<(StreamOffset, StreamOrder)> {
        match &self.kind {
            ChartKind::Area(AreaChart {
                stream: Some(st), ..
            }) => Some((st.offset, st.order)),
            _ => None,
        }
    }

    /// Visible streams of the current ThemeRiver, bottom first.
    pub fn theme_river_stack(&self) -> Option<Vec<usize>> {
        match &self.kind {
            ChartKind::Area(a) if a.stream.is_some() => Some(a.stream_stack()),
            _ => None,
        }
    }

    /// Band bottoms (`g0` plus the streams below) of one stream, data units (NaN = hidden).
    pub fn theme_river_base(&self, series: usize) -> Option<&[f32]> {
        match &self.kind {
            ChartKind::Area(a) if a.stream.is_some() => a.base.get(series).map(|b| &b[..]),
            _ => None,
        }
    }

    /// Label anchors and their revision (laid out by `prepare_layers`).
    pub fn theme_river_labels(&self) -> Option<(&[StreamLabel], u32)> {
        match &self.kind {
            ChartKind::Area(AreaChart {
                stream: Some(st), ..
            }) => Some((&st.labels, st.labels_revision)),
            _ => None,
        }
    }

    /// ThemeRiver part of `prepare_layers`: label anchors follow the view, zoom and restacks.
    pub(crate) fn prepare_theme_river(&mut self, view: &ChartView) {
        if let ChartKind::Area(a) = &mut self.kind {
            if a.stream.is_some() {
                a.layout_stream_labels(view);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RED: [f32; 4] = [1.0, 0.0, 0.0, 1.0];
    const LAYOUT: LineLayout = LineLayout {
        width: 160.0,
        height: 80.0,
        view: ChartViewMode::Flat,
        x_kind: LineXKind::Numeric,
    };

    fn close(a: &[f64], b: &[f64]) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-9)
    }

    fn close32(a: &[f32], b: &[f64]) -> bool {
        a.len() == b.len() && a.iter().zip(b).all(|(&x, &y)| (x as f64 - y).abs() < 1e-5)
    }

    // Reference numbers: d3-shape `stack().offset(stackOffsetWiggle)` on
    // [[1, 2, 3], [2, 2, 1], [1, 3, 2]] (bottom first), worked by hand:
    // j = 1: Δ = (1, 0, 2), Σf = 7, Σ f·(Δ/2 + Δbelow) = 2·0.5 + 2·1 + 3·2 = 9 → g0 = -9/7
    // j = 2: Δ = (1, -1, -1), Σf = 6, Σ = 3·0.5 + 1·0.5 + 2·(-0.5) = 1 → g0 = -9/7 - 1/6 = -61/42
    const A: [f32; 3] = [1.0, 2.0, 3.0];
    const B: [f32; 3] = [2.0, 2.0, 1.0];
    const C: [f32; 3] = [1.0, 3.0, 2.0];

    #[test]
    fn wiggle_matches_d3_stack_offset_wiggle() {
        let mut g = Vec::new();
        stream_baseline(&[&A, &B, &C], StreamOffset::Wiggle, &mut g);
        assert!(close(&g, &[0.0, -9.0 / 7.0, -61.0 / 42.0]), "{g:?}");
        // Missing samples count as 0 (d3 `|| 0`); an all-zero sample keeps the baseline
        stream_baseline(
            &[&[1.0, f32::NAN, 0.0], &[0.0, 0.0, 0.0]],
            StreamOffset::Wiggle,
            &mut g,
        );
        assert!(close(&g, &[0.0, 0.0, 0.0]), "{g:?}");
        stream_baseline(&[], StreamOffset::Wiggle, &mut g);
        assert!(g.is_empty());
    }

    #[test]
    fn silhouette_and_zero_match_d3() {
        let mut g = Vec::new();
        stream_baseline(&[&A, &B, &C], StreamOffset::Silhouette, &mut g);
        assert!(close(&g, &[-2.0, -3.5, -3.0]), "{g:?}");
        stream_baseline(&[&A, &B, &C], StreamOffset::Zero, &mut g);
        assert!(close(&g, &[0.0; 3]));
    }

    #[test]
    fn inside_out_matches_d3_stack_order_inside_out() {
        // Peaks at 2, 0, 1, 1; sums 5, 5, 5, 1: by peak [1, 2, 3, 0] → bottoms [1, 3], tops [2, 0]
        let l: [&[f32]; 4] = [
            &[0.0, 0.0, 5.0],
            &[5.0, 0.0, 0.0],
            &[0.0, 5.0, 0.0],
            &[0.0, 1.0, 0.0],
        ];
        assert_eq!(stream_order(&l, StreamOrder::InsideOut), vec![3, 1, 2, 0]);
        assert_eq!(stream_order(&l, StreamOrder::None), vec![0, 1, 2, 3]);
        // d3 wiggle on that order: g0 = [0, 7/6, 14/3]
        let ordered: Vec<&[f32]> = [3, 1, 2, 0].iter().map(|&i| l[i]).collect();
        let mut g = Vec::new();
        stream_baseline(&ordered, StreamOffset::Wiggle, &mut g);
        assert!(close(&g, &[0.0, 7.0 / 6.0, 14.0 / 3.0]), "{g:?}");
    }

    fn chart(values: Vec<Vec<f32>>, offset: StreamOffset, order: StreamOrder) -> ChartState {
        let series = values
            .into_iter()
            .map(|values| LineSeries {
                values,
                x: None,
                color: RED,
                width_px: 1.0,
            })
            .collect();
        ChartState::new_theme_river(series, LAYOUT, offset, order, f32::NAN)
    }

    fn area(c: &ChartState) -> &AreaChart {
        match &c.kind {
            ChartKind::Area(a) => a,
            _ => unreachable!(),
        }
    }

    #[test]
    fn streams_stack_on_the_wiggle_baseline() {
        let c = chart(
            vec![A.to_vec(), B.to_vec(), C.to_vec()],
            StreamOffset::Wiggle,
            StreamOrder::None,
        );
        let g = [0.0, -9.0 / 7.0, -61.0 / 42.0];
        assert!(close32(c.theme_river_base(0).unwrap(), &g));
        // d3: series 0 = [[0,1],[-9/7,5/7],[-61/42,65/42]], 1 tops [3, 19/7, 107/42], 2 tops [4, 40/7, 191/42]
        let a = area(&c);
        assert!(close32(a.line.vals(0), &[1.0, 5.0 / 7.0, 65.0 / 42.0]));
        assert!(close32(a.line.vals(1), &[3.0, 19.0 / 7.0, 107.0 / 42.0]));
        assert!(close32(a.line.vals(2), &[4.0, 40.0 / 7.0, 191.0 / 42.0]));
        assert!(close32(
            c.theme_river_base(2).unwrap(),
            &[3.0, 19.0 / 7.0, 107.0 / 42.0]
        ));
        // Raw values stay the data behind hover / keyboard / CSV
        assert_eq!(c.line_values(1).unwrap(), &B);
        assert_eq!(c.sample(4).unwrap().2, 2.0);
        // Domain fits the river (bottom of the baseline .. top of the stack), not zero
        let (lo, hi, _) = c.y_domain().unwrap();
        assert!(
            lo <= -61.0 / 42.0 && lo > -3.0 && hi >= 40.0 / 7.0 && hi <= 7.0,
            "{lo} {hi}"
        );
        assert_eq!(
            c.theme_river_layout(),
            Some((StreamOffset::Wiggle, StreamOrder::None))
        );
    }

    #[test]
    fn inside_out_reorders_the_stack() {
        let c = chart(
            vec![
                vec![0.0, 0.0, 5.0],
                vec![5.0, 0.0, 0.0],
                vec![0.0, 5.0, 0.0],
                vec![0.0, 1.0, 0.0],
            ],
            StreamOffset::Wiggle,
            StreamOrder::InsideOut,
        );
        assert_eq!(c.theme_river_stack().unwrap(), vec![3, 1, 2, 0]);
        assert!(close32(
            c.theme_river_base(3).unwrap(),
            &[0.0, 7.0 / 6.0, 14.0 / 3.0]
        ));
        // Series 1 sits on series 3, series 0 is on top
        assert!(close32(
            area(&c).line.vals(3),
            &[0.0, 13.0 / 6.0, 14.0 / 3.0]
        ));
        assert!(close32(
            c.theme_river_base(1).unwrap(),
            &[0.0, 13.0 / 6.0, 14.0 / 3.0]
        ));
        assert!(close32(
            area(&c).line.vals(0),
            &[5.0, 43.0 / 6.0, 29.0 / 3.0]
        ));
    }

    #[test]
    fn hiding_a_stream_recomputes_order_baseline_and_domain() {
        let mut c = chart(
            vec![A.to_vec(), B.to_vec(), C.to_vec()],
            StreamOffset::Silhouette,
            StreamOrder::None,
        );
        let mut scene = SceneWorld::new();
        c.set_series_visible(1, false, &mut scene);
        // Silhouette of A + C: sums [2, 5, 5]
        assert!(close32(c.theme_river_base(0).unwrap(), &[-1.0, -2.5, -2.5]));
        assert!(close32(c.theme_river_base(2).unwrap(), &[0.0, -0.5, 0.5]));
        assert_eq!(c.theme_river_stack().unwrap(), vec![0, 2]);
        assert!(
            area(&c).line.vals(1).iter().all(|v| v.is_nan()),
            "hidden stream has no band"
        );
        let (lo, hi, _) = c.y_domain().unwrap();
        assert!(
            lo >= -3.0 && hi <= 3.0,
            "domain refits the visible river: {lo} {hi}"
        );
        c.set_series_visible(1, true, &mut scene);
        assert!(close32(c.theme_river_base(0).unwrap(), &[-2.0, -3.5, -3.0]));
    }

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

    #[test]
    fn fills_start_on_the_baseline_and_bands_meet() {
        let mut c = chart(
            vec![vec![2.0, 2.0], vec![2.0, 2.0]],
            StreamOffset::Silhouette,
            StreamOrder::None,
        );
        let mut cam = flat_camera();
        c.frame_camera(&mut cam, (1600.0, 900.0));
        let fills = c.prepare_layers(&view(&cam)).fills.unwrap().to_vec();
        assert_eq!(fills.len(), 2 * 6);
        let l = &area(&c).line;
        let ys: Vec<f32> = fills[..6].iter().map(|v| v.position[1]).collect();
        // Bottom band spans -2 .. 0 (not down to a zero baseline), the top one 0 .. 2
        assert!(
            ys.iter().any(|&y| (y - l.y_of(-2.0)).abs() < 1e-4)
                && ys.iter().all(|&y| y <= l.y_of(0.0) + 1e-4),
            "{ys:?}"
        );
        let ys: Vec<f32> = fills[6..].iter().map(|v| v.position[1]).collect();
        assert!(
            ys.iter().all(|&y| y >= l.y_of(0.0) - 1e-4)
                && ys.iter().any(|&y| (y - l.y_of(2.0)).abs() < 1e-4)
        );
    }

    #[test]
    fn hover_lists_every_stream_and_emphasizes_the_one_under_the_pointer() {
        let n = 101;
        let mut c = chart(
            vec![vec![10.0; n], vec![10.0; n]],
            StreamOffset::Silhouette,
            StreamOrder::None,
        );
        let mut cam = flat_camera();
        c.frame_camera(&mut cam, (1600.0, 900.0));
        let mut scene = SceneWorld::new();
        let v = view(&cam);
        c.prepare_layers(&v);
        // Streams span -10..0 (series 0) and 0..10 (series 1): point at y = 5
        let y = area(&c).line.y_of(5.0);
        let p = cam.project_to_ndc(Vec3::new(0.0, y, 0.0)).unwrap();
        let hit = c.hover_at(&v, &mut scene, (p.x, p.y)).expect("hover");
        assert_eq!(hit.items.len(), 2);
        assert_eq!(hit.items[hit.primary].series, 1);
        assert_eq!(
            hit.items.iter().map(|i| i.value).collect::<Vec<_>>(),
            vec![10.0, 10.0]
        );
        assert_eq!(area(&c).line.emphasis, Some(1));
        let fills = c.prepare_layers(&v).fills.unwrap().to_vec();
        assert!(
            fills[0].color[3] < fills.last().unwrap().color[3],
            "non-hovered stream fades"
        );
        // Legend emphasis wins; leaving the plot clears the hover emphasis
        c.set_emphasis(Some(0));
        assert_eq!(area(&c).line.emphasis, Some(0));
        c.set_emphasis(None);
        assert_eq!(area(&c).line.emphasis, Some(1));
        c.clear_hover(&mut scene);
        assert_eq!(area(&c).line.emphasis, None);
        // A data update drops the hover without the funnel: leaving afterwards still clears
        c.hover_at(&v, &mut scene, (p.x, p.y)).expect("hover");
        c.append_area_data(&[&[10.0], &[10.0]], None, 0).unwrap();
        c.clear_hover(&mut scene);
        assert_eq!(area(&c).line.emphasis, None);
    }

    #[test]
    fn hover_outside_the_river_band_hits_nothing() {
        let n = 101;
        let mut c = chart(
            vec![vec![10.0; n], vec![10.0; n]],
            StreamOffset::Silhouette,
            StreamOrder::None,
        );
        let mut cam = flat_camera();
        c.frame_camera(&mut cam, (1600.0, 900.0));
        let mut scene = SceneWorld::new();
        let v = view(&cam);
        c.prepare_layers(&v);
        let ndc = |c: &ChartState, value: f32| {
            let p = cam
                .project_to_ndc(Vec3::new(0.0, area(c).line.y_of(value), 0.0))
                .unwrap();
            (p.x, p.y)
        };
        // The river spans -10..10: inside the plot but above / below it there is no stream
        let (above, below) = (ndc(&c, 10.5), ndc(&c, -10.5));
        assert!(above.1 < 1.0 && below.1 > -1.0, "still inside the plot");
        c.hover_at(&v, &mut scene, ndc(&c, 5.0)).expect("hover");
        assert_eq!(area(&c).line.emphasis, Some(1));
        assert!(c.hover_at(&v, &mut scene, above).is_none());
        assert_eq!(
            area(&c).line.emphasis,
            None,
            "leaving the band clears the emphasis"
        );
        assert!(c.hover_at(&v, &mut scene, below).is_none());
        // Edges (keyboard focus points sit on the stream tops) still hit
        let top = c.hover_at(&v, &mut scene, ndc(&c, 10.0)).expect("top edge");
        assert_eq!(top.items[top.primary].series, 1);
        let bottom = c
            .hover_at(&v, &mut scene, ndc(&c, -10.0))
            .expect("bottom edge");
        assert_eq!(bottom.items[bottom.primary].series, 0);
    }

    #[test]
    fn labels_anchor_on_the_left_end_of_each_stream() {
        let mut c = chart(
            vec![vec![2.0, 4.0], vec![6.0, 4.0]],
            StreamOffset::Silhouette,
            StreamOrder::None,
        );
        let mut cam = flat_camera();
        c.frame_camera(&mut cam, (1600.0, 900.0));
        let v = view(&cam);
        c.prepare_layers(&v);
        let (labels, rev) = c.theme_river_labels().unwrap();
        assert_eq!(labels.len(), 2);
        let l = &area(&c).line;
        let left = v.project_css(Vec3::new(-80.0, 0.0, 0.0)).unwrap().0;
        assert!((labels[0].x_css - left).abs() < 1e-3);
        // Stream 0 spans -4..-2 at x0, stream 1 -2..4
        let mid = |a: f32, b: f32| {
            0.5 * (v.project_css(Vec3::new(0.0, l.y_of(a), 0.0)).unwrap().1
                + v.project_css(Vec3::new(0.0, l.y_of(b), 0.0)).unwrap().1)
        };
        assert!(
            (labels[0].y_css - mid(-4.0, -2.0)).abs() < 1e-3
                && (labels[1].y_css - mid(-2.0, 4.0)).abs() < 1e-3
        );
        assert!(labels[1].height_css > labels[0].height_css * 2.5);
        // Unchanged view: same revision; a legend toggle moves them
        c.prepare_layers(&v);
        assert_eq!(c.theme_river_labels().unwrap().1, rev);
        c.set_series_visible(0, false, &mut SceneWorld::new());
        c.prepare_layers(&v);
        let (labels, rev2) = c.theme_river_labels().unwrap();
        assert_ne!(rev2, rev);
        assert_eq!(labels.iter().map(|l| l.series).collect::<Vec<_>>(), vec![1]);
    }

    #[test]
    fn streaming_restacks_atomically() {
        let mut c = chart(
            vec![vec![1.0, 2.0], vec![2.0, 2.0]],
            StreamOffset::Zero,
            StreamOrder::None,
        );
        assert_eq!(
            c.append_area_data(&[&[3.0], &[1.0]], None, 3).unwrap(),
            vec![3, 3]
        );
        assert!(close32(area(&c).line.vals(1), &[3.0, 4.0, 4.0]));
        assert!(c.append_area_data(&[&[3.0], &[1.0, 2.0]], None, 3).is_err());
        assert!(c.y_domain().unwrap().1 >= 4.0);
    }

    #[test]
    fn non_stream_areas_are_unaffected() {
        let series = vec![
            LineSeries {
                values: vec![1.0, 2.0],
                x: None,
                color: RED,
                width_px: 1.0
            };
            2
        ];
        let c = ChartState::new_area(series, LAYOUT, AreaMode::Stacked, f32::NAN);
        assert!(
            c.theme_river_layout().is_none()
                && c.theme_river_labels().is_none()
                && c.theme_river_base(0).is_none()
        );
    }
}
