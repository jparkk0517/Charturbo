//! Candlestick (OHLC) chart: bodies as bars, wicks as strokes, per-pixel-column OHLC aggregation
//! once candles get narrower than ~2 px, optional volume pane, x zoom / pan, nearest-candle hover.

use super::annotations::{AxisMap, DataFrame};
use super::time_zone::{time_ticks_tz, TimeZone};
use super::finite::{max_f32, min_f32};
use super::*;

/// Narrowest raw candle body (CSS px); below it candles are aggregated per bucket.
const MIN_BODY_CSS: f64 = 2.0;
/// Aggregation bucket width in CSS px (bodies take `body_ratio` of it).
const BUCKET_CSS: f64 = 3.0;
/// Rising candles are only drawn hollow when their body is at least this wide (CSS px).
const HOLLOW_MIN_CSS: f64 = 5.0;
/// Depth of wicks / outlines (in front of the bodies, which write depth) and of the crosshair.
const WICK_Z: f32 = 0.01;
const CROSSHAIR_Z: f32 = 0.02;
/// Gap between the price and volume panes, as a fraction of the plot height.
const PANE_GAP: f32 = 0.04;

/// OHLC input. Every array has one entry per candle; a candle with a non-finite open / high /
/// low / close is a gap.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct CandleData {
    /// x of each candle (epoch ms or numbers; finite, ascending); `None` places candles by index
    pub t: Option<Vec<f64>>,
    pub open: Vec<f32>,
    pub high: Vec<f32>,
    pub low: Vec<f32>,
    pub close: Vec<f32>,
    pub volume: Option<Vec<f32>>,
}

impl CandleData {
    pub fn len(&self) -> usize {
        self.close.len()
    }

    pub fn is_empty(&self) -> bool {
        self.close.is_empty()
    }
}

/// Checks lengths and `t` (finite, sorted ascending).
pub fn validate_candles(d: &CandleData) -> Result<(), String> {
    let n = d.close.len();
    for (name, len) in [("open", d.open.len()), ("high", d.high.len()), ("low", d.low.len())] {
        if len != n {
            return Err(format!("{name} length {len} != close length {n}"));
        }
    }
    if let Some(v) = &d.volume {
        if v.len() != n {
            return Err(format!("volume length {} != close length {n}", v.len()));
        }
    }
    if let Some(t) = &d.t {
        if t.len() != n {
            return Err(format!("t length {} != close length {n}", t.len()));
        }
        if let Some(k) = t.iter().position(|v| !v.is_finite()) {
            return Err(format!("t[{k}] is not finite"));
        }
        if let Some(k) = t.windows(2).position(|w| w[1] < w[0]) {
            return Err(format!("t must be sorted ascending (t[{}] < t[{k}])", k + 1));
        }
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CandleStyle {
    /// Close >= open
    pub up_color: [f32; 4],
    pub down_color: [f32; 4],
    /// Rising candles drawn as outlines (a shape cue besides color); narrow bodies stay filled
    pub hollow_up: bool,
    /// Wick / outline stroke width in CSS px
    pub wick_px: f32,
    /// Body width as a fraction of the candle spacing
    pub body_ratio: f32,
    /// Rounded top corners of the bodies in CSS px (0..1)
    pub corner_radius_px: f32,
    /// Volume bars in the bottom pane (needs volume data)
    pub show_volume: bool,
    /// Alpha multiplier of the volume bars (candle color)
    pub volume_alpha: f32,
    /// Height of the volume pane as a fraction of the plot
    pub volume_fraction: f32,
    /// The price axis fits the visible candles (re-derived on zoom / pan); false = all data
    pub fit_visible: bool,
}

impl Default for CandleStyle {
    fn default() -> Self {
        Self {
            // Blue / orange: distinguishable under color-vision deficiency (not red / green)
            up_color: [0.224, 0.529, 0.898, 1.0],
            down_color: [0.851, 0.349, 0.149, 1.0],
            hollow_up: true,
            wick_px: 1.0,
            body_ratio: 0.7,
            corner_radius_px: 0.0,
            show_volume: true,
            volume_alpha: 0.45,
            volume_fraction: 0.2,
            fit_visible: true,
        }
    }
}

impl CandleStyle {
    /// Clamps every field to its valid range (non-finite = default).
    pub fn sanitized(self) -> Self {
        let d = Self::default();
        let f = |v: f32, def: f32, lo: f32, hi: f32| if v.is_finite() { v.clamp(lo, hi) } else { def };
        Self {
            wick_px: f(self.wick_px, d.wick_px, 0.25, 8.0),
            body_ratio: f(self.body_ratio, d.body_ratio, 0.05, 1.0),
            corner_radius_px: f(self.corner_radius_px, d.corner_radius_px, 0.0, 1.0),
            volume_alpha: f(self.volume_alpha, d.volume_alpha, 0.0, 1.0),
            volume_fraction: f(self.volume_fraction, d.volume_fraction, 0.05, 0.6),
            ..self
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CandleLayout {
    pub width: f32,
    pub height: f32,
    /// Tick scale of `t` (ignored without `t`)
    pub x_kind: LineXKind,
}

/// One candle, or the aggregate of the candles sharing a bucket (`first..=last`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CandleSample {
    /// x of the first candle (`t`, else its index)
    pub x: f64,
    pub open: f64,
    pub high: f64,
    pub low: f64,
    pub close: f64,
    /// Sum over the bucket; NaN without volume data
    pub volume: f64,
    pub first: usize,
    pub last: usize,
}

/// OHLC accumulator of one bucket: open = first, high = max, low = min, close = last, volume = sum.
#[derive(Debug, Clone, Copy)]
struct Agg {
    open: f32,
    high: f32,
    low: f32,
    close: f32,
    volume: f64,
    count: usize,
}

impl Agg {
    const EMPTY: Self = Self {
        open: f32::NAN,
        high: f32::NEG_INFINITY,
        low: f32::INFINITY,
        close: f32::NAN,
        volume: 0.0,
        count: 0,
    };

    fn push(&mut self, o: f32, h: f32, l: f32, c: f32, v: f32) {
        if !(o.is_finite() && h.is_finite() && l.is_finite() && c.is_finite()) {
            return;
        }
        if self.count == 0 {
            self.open = o;
        }
        // Finite after the check above: plain compares (chart/finite.rs)
        self.high = max_f32(max_f32(self.high, h), max_f32(o, c));
        self.low = min_f32(min_f32(self.low, l), min_f32(o, c));
        self.close = c;
        if v.is_finite() {
            self.volume += v as f64;
        }
        self.count += 1;
    }
}

#[derive(Debug, Clone)]
pub(crate) struct CandleChart {
    /// Candle x relative to `x_origin` (sample index without `t`)
    pub(crate) x: Vec<f64>,
    pub(crate) x_origin: f64,
    pub(crate) has_t: bool,
    pub(crate) open: Vec<f32>,
    pub(crate) high: Vec<f32>,
    pub(crate) low: Vec<f32>,
    pub(crate) close: Vec<f32>,
    pub(crate) volume: Option<Vec<f32>>,
    pub(crate) layout: CandleLayout,
    pub(crate) style: CandleStyle,
    /// Typical candle spacing in x units (median gap; 1 without `t`)
    pub(crate) slot: f64,
    /// x domain `[dom0, dom0 + dom_span]` (relative): every candle's full slot
    pub(crate) dom0: f64,
    pub(crate) dom_span: f64,
    /// Visible part of the domain in normalized `t` (zoom / pan)
    pub(crate) window: (f32, f32),
    /// Finite low / high extent of all candles and the largest volume
    ext_all: (f32, f32),
    vol_all: f32,
    /// Nice price domain and tick step
    pub(crate) y_min: f64,
    pub(crate) y_span: f64,
    pub(crate) y_step: f64,
    /// Top of the volume scale (largest visible volume)
    pub(crate) vol_max: f64,
    /// Volume scale of the last build: `vol_max`, or the largest bucket sum while aggregated
    vol_scale: f64,
    pub(crate) tick_target: u32,
    /// Aggregation bucket width (x units) of the last build; 0 = raw candles
    pub(crate) bucket: f64,
    /// Pointer world y of the last hover (horizontal crosshair)
    pub(crate) hover_y: Option<f32>,
}

/// True when a cached LOD build no longer covers `window` or its density drifted.
pub(crate) fn lod_stale(built: Option<LodWindow>, window: &LodWindow) -> bool {
    built.is_none_or(|b| {
        let ratio = window.px_per_t / b.px_per_t;
        window.t0 < b.t0 || window.t1 > b.t1 || !(0.8..=1.25).contains(&ratio)
    })
}

impl CandleChart {
    /// Builds the chart; invalid input (callers validate first) is truncated / placed by index.
    pub(crate) fn new(mut d: CandleData, layout: CandleLayout, style: CandleStyle) -> Self {
        let n = d.open.len().min(d.high.len()).min(d.low.len()).min(d.close.len());
        for v in [&mut d.open, &mut d.high, &mut d.low, &mut d.close] {
            v.truncate(n);
        }
        let volume = d.volume.filter(|v| v.len() >= n).map(|mut v| {
            v.truncate(n);
            v
        });
        let t = d.t.filter(|t| t.len() == n && t.iter().all(|v| v.is_finite()) && t.windows(2).all(|w| w[1] >= w[0]));
        let has_t = t.is_some() && n > 0;
        let (x_origin, x) = match t {
            Some(t) if n > 0 => (t[0], t.iter().map(|v| v - t[0]).collect()),
            _ => (0.0, (0..n).map(|i| i as f64).collect::<Vec<f64>>()),
        };
        let slot = if has_t { median_gap(&x) } else { 1.0 };
        let (dom0, dom_span) = match (x.first(), x.last()) {
            (Some(&a), Some(&b)) => (a - slot * 0.5, (b - a) + slot),
            _ => (-0.5, 1.0),
        };
        let mut ext_all = (f32::INFINITY, f32::NEG_INFINITY);
        for i in 0..n {
            let (lo, hi) = candle_extent(d.open[i], d.high[i], d.low[i], d.close[i]);
            ext_all = (ext_all.0.min(lo), ext_all.1.max(hi));
        }
        let vol_all = volume
            .as_deref()
            .map_or(0.0, |v| v.iter().copied().filter(|v| v.is_finite()).fold(0.0f32, f32::max));
        let mut chart = Self {
            x,
            x_origin,
            has_t,
            open: d.open,
            high: d.high,
            low: d.low,
            close: d.close,
            volume,
            layout,
            style: style.sanitized(),
            slot,
            dom0,
            dom_span,
            window: (0.0, 1.0),
            ext_all,
            vol_all,
            y_min: 0.0,
            y_span: 1.0,
            y_step: 1.0,
            vol_max: 1.0,
            vol_scale: 1.0,
            tick_target: ChartFrameStyle::default().grid_rows,
            bucket: 0.0,
            hover_y: None,
        };
        chart.update_y_domain();
        chart
    }

    pub(crate) fn len(&self) -> usize {
        self.close.len()
    }

    fn volume_shown(&self) -> bool {
        self.style.show_volume && self.volume.is_some()
    }

    /// `(price pane bottom, price pane height, volume pane height)` in world units.
    fn panes(&self) -> (f32, f32, f32) {
        let h = self.layout.height;
        if self.volume_shown() {
            let vol_h = h * self.style.volume_fraction;
            let gap = h * PANE_GAP;
            (-h * 0.5 + vol_h + gap, h - vol_h - gap, vol_h)
        } else {
            (-h * 0.5, h, 0.0)
        }
    }

    #[inline]
    pub(crate) fn y_of(&self, v: f64) -> f32 {
        let (bottom, h, _) = self.panes();
        bottom + ((v - self.y_min) / self.y_span) as f32 * h
    }

    #[inline]
    fn vol_y(&self, v: f64) -> f32 {
        let (_, _, vol_h) = self.panes();
        -self.layout.height * 0.5 + (v / self.vol_scale.max(f64::MIN_POSITIVE)).min(1.0) as f32 * vol_h
    }

    /// World x of relative x `rel` under the zoom window (f64 until the last step).
    #[inline]
    pub(crate) fn world_x(&self, rel: f64) -> f32 {
        let (w0, w1) = (self.window.0 as f64, self.window.1 as f64);
        let t = (rel - self.dom0) / self.dom_span;
        (((t - w0) / (w1 - w0).max(1e-9) - 0.5) * self.layout.width as f64) as f32
    }

    /// Relative x under world x.
    #[inline]
    fn rel_of_world(&self, x: f32) -> f64 {
        let (w0, w1) = (self.window.0 as f64, self.window.1 as f64);
        let t = w0 + (x as f64 / self.layout.width as f64 + 0.5) * (w1 - w0);
        self.dom0 + t * self.dom_span
    }

    /// World units per unit of relative x.
    #[inline]
    fn world_per_x(&self) -> f64 {
        self.layout.width as f64 / (self.dom_span * (self.window.1 - self.window.0).max(1e-9) as f64)
    }

    /// Absolute data domain (x of `t = 0` and `t = 1`).
    pub(crate) fn x_domain(&self) -> (f64, f64) {
        let a = self.x_origin + self.dom0;
        (a, a + self.dom_span)
    }

    /// Candles whose slot overlaps `[t0, t1]` (normalized), `None` when there are none.
    pub(crate) fn visible_range(&self, t0: f32, t1: f32) -> Option<(usize, usize)> {
        let half = self.slot * 0.5;
        let a = self.dom0 + t0 as f64 * self.dom_span - half;
        let b = self.dom0 + t1 as f64 * self.dom_span + half;
        let i0 = self.x.partition_point(|&v| v < a);
        let i1 = self.x.partition_point(|&v| v <= b);
        (i0 < i1).then(|| (i0, i1 - 1))
    }

    /// Re-derives the nice price domain and the volume scale (visible candles with `fit_visible`,
    /// else all). O(visible) while zoomed, O(1) otherwise. True when anything moved.
    pub(crate) fn update_y_domain(&mut self) -> bool {
        let full = self.window == (0.0, 1.0) || !self.style.fit_visible;
        let (ext, vol) = if full {
            (self.ext_all, self.vol_all)
        } else {
            let mut ext = (f32::INFINITY, f32::NEG_INFINITY);
            let mut vol = 0.0f32;
            if let Some((i0, i1)) = self.visible_range(self.window.0, self.window.1) {
                for i in i0..=i1 {
                    let (lo, hi) = candle_extent(self.open[i], self.high[i], self.low[i], self.close[i]);
                    ext = (min_f32(ext.0, lo), max_f32(ext.1, hi));
                }
                if let Some(v) = &self.volume {
                    vol = v[i0..=i1].iter().copied().filter(|v| v.is_finite()).fold(0.0, f32::max);
                }
            }
            if ext.0 > ext.1 {
                // Nothing finite in view: keep the current domain
                return false;
            }
            (ext, vol)
        };
        let (lo, hi) = if ext.0 <= ext.1 { (ext.0 as f64, ext.1 as f64) } else { (0.0, 1.0) };
        let (y0, y1, step) = nice_domain(lo, hi, self.tick_target);
        let vol_max = if vol > 0.0 { vol as f64 } else { 1.0 };
        let next = (y0, (y1 - y0).max(1e-9), step, vol_max);
        if next == (self.y_min, self.y_span, self.y_step, self.vol_max) {
            return false;
        }
        (self.y_min, self.y_span, self.y_step, self.vol_max) = next;
        true
    }

    pub(crate) fn set_tick_target(&mut self, target: u32) {
        self.tick_target = target;
        self.update_y_domain();
    }

    /// Smallest zoom window: about 8 candles.
    fn min_window_span(&self) -> f32 {
        ((8.0 * self.slot / self.dom_span) as f32).clamp(32.0 * f32::EPSILON, 1.0)
    }

    pub(crate) fn set_window(&mut self, w0: f32, w1: f32) {
        let span = (w1 - w0).clamp(self.min_window_span(), 1.0);
        let start = w0.clamp(0.0, 1.0 - span);
        self.window = (start, start + span);
    }

    /// Zooms around the pointer (`factor` < 1 zooms in); true when the window moved.
    pub(crate) fn zoom_at(&mut self, view: &ChartView, factor: f32, anchor_ndc_x: f32) -> bool {
        let (w0, w1) = self.window;
        let half = self.layout.width * 0.5;
        let ray = view.camera.screen_to_ray(anchor_ndc_x, 0.0);
        let anchor = ray_hit_z_plane(&ray, 0.0)
            .map(|p| w0 + (p.x.clamp(-half, half) / self.layout.width + 0.5) * (w1 - w0))
            .unwrap_or((w0 + w1) * 0.5);
        let span = w1 - w0;
        let new_span = (span * factor).clamp(self.min_window_span(), 1.0);
        let start = anchor - (anchor - w0) * (new_span / span.max(1e-9));
        self.set_window(start, start + new_span);
        self.window != (w0, w1)
    }

    /// Pans by a pointer delta in NDC (content follows the pointer); true when the window moved.
    pub(crate) fn pan_by(&mut self, view: &ChartView, delta_ndc_x: f32) -> bool {
        let half = self.layout.width * 0.5;
        let (Some(a), Some(b)) = (
            view.project_px(Vec3::new(-half, 0.0, 0.0)),
            view.project_px(Vec3::new(half, 0.0, 0.0)),
        ) else {
            return false;
        };
        let plot_px = (b.0 - a.0).abs().max(1.0);
        let (w0, w1) = self.window;
        let shift = -delta_ndc_x * 0.5 * view.viewport_px.0 as f32 / plot_px * (w1 - w0);
        self.set_window(w0 + shift, w1 + shift);
        self.window != (w0, w1)
    }

    /// Visible normalized-x window and screen density (physical px per unit `t`).
    pub(crate) fn view_window(&self, view: &ChartView) -> Option<LodWindow> {
        let half = self.layout.width * 0.5;
        let a = view.project_px(Vec3::new(-half, 0.0, 0.0))?;
        let b = view.project_px(Vec3::new(half, 0.0, 0.0))?;
        let dx = b.0 - a.0;
        let dx = if dx.abs() < 1e-3 { 1e-3 } else { dx };
        let half_vw = 0.5 * view.viewport_px.0 as f32;
        let fa = ((-half_vw - a.0) / dx).clamp(0.0, 1.0);
        let fb = ((half_vw - a.0) / dx).clamp(0.0, 1.0);
        let (w0, w1) = self.window;
        let span_t = (w1 - w0).max(1e-9);
        Some(LodWindow {
            t0: w0 + fa.min(fb) * span_t,
            t1: w0 + fa.max(fb) * span_t,
            px_per_t: dx.abs().max(1.0) / span_t,
            reversed: false,
        })
    }

    /// Bodies / volume bars into `bars`, wicks / hollow outlines into `segs` for the candles in
    /// `window`. Raw candles while their bodies are at least `MIN_BODY_CSS` wide, else OHLC
    /// aggregates of `BUCKET_CSS`-wide buckets aligned to absolute x (open = first, high = max,
    /// low = min, close = last), so the output is bounded by the plot width. O(visible candles).
    pub(crate) fn build(&mut self, window: &LodWindow, view: &ChartView, bars: &mut Vec<ChartBarRaw>, segs: &mut Vec<ChartSegmentRaw>) {
        bars.clear();
        segs.clear();
        let pr = view.pixel_ratio.max(0.1) as f64;
        // Physical px per unit of relative x and per world unit
        let px_per_x = window.px_per_t.max(1e-6) as f64 / self.dom_span;
        let px_per_world_x = px_per_x / self.world_per_x();
        let px_per_world_y = match (view.project_px(Vec3::ZERO), view.project_px(Vec3::Y)) {
            (Some(a), Some(b)) => ((b.1 - a.1).abs() as f64).max(1e-6),
            _ => px_per_world_x,
        };
        let Some((i0, i1)) = self.visible_range(window.t0, window.t1) else {
            self.bucket = 0.0;
            return;
        };
        let px = Px {
            min_body: (pr / px_per_world_y) as f32,
            inset_x: (0.5 * self.style.wick_px as f64 * pr / px_per_world_x) as f32,
            inset_y: (0.5 * self.style.wick_px as f64 * pr / px_per_world_y) as f32,
        };
        let ratio = self.style.body_ratio as f64;
        let body_css = self.slot * ratio * px_per_x / pr;
        let vol = self.volume.as_deref();
        let vol_at = |i: usize| vol.map_or(f32::NAN, |v| v[i]);
        if body_css >= MIN_BODY_CSS {
            self.bucket = 0.0;
            self.vol_scale = self.vol_max;
            let hollow = self.style.hollow_up && body_css >= HOLLOW_MIN_CSS;
            for i in i0..=i1 {
                let mut a = Agg::EMPTY;
                a.push(self.open[i], self.high[i], self.low[i], self.close[i], vol_at(i));
                self.emit(self.x[i], self.slot * ratio, &a, hollow, &px, bars, segs);
            }
        } else {
            let bw = BUCKET_CSS * pr / px_per_x;
            self.bucket = bw;
            // Aggregate first: bucket volumes are sums, so they get their own scale
            let mut aggs: Vec<(f64, Agg)> = Vec::new();
            let mut i = i0;
            while i <= i1 {
                let key = (self.x[i] / bw).floor();
                let mut a = Agg::EMPTY;
                while i <= i1 && (self.x[i] / bw).floor() == key {
                    a.push(self.open[i], self.high[i], self.low[i], self.close[i], vol_at(i));
                    i += 1;
                }
                aggs.push((key, a));
            }
            let top = aggs.iter().map(|(_, a)| a.volume).fold(0.0, f64::max);
            self.vol_scale = if top > 0.0 { top } else { 1.0 };
            for (key, a) in &aggs {
                self.emit((key + 0.5) * bw, bw * ratio, a, false, &px, bars, segs);
            }
        }
    }

    /// One candle (raw or aggregate) centred on relative x `xc`, `body_w` x units wide.
    #[allow(clippy::too_many_arguments)]
    fn emit(&self, xc: f64, body_w: f64, a: &Agg, hollow: bool, px: &Px, bars: &mut Vec<ChartBarRaw>, segs: &mut Vec<ChartSegmentRaw>) {
        if a.count == 0 {
            return;
        }
        let up = a.close >= a.open;
        let color = if up { self.style.up_color } else { self.style.down_color };
        let x = self.world_x(xc);
        let hw = (body_w * self.world_per_x() * 0.5) as f32;
        let (x0, x1) = (x - hw, x + hw);
        let (yo, yc) = (self.y_of(a.open as f64), self.y_of(a.close as f64));
        let (mut b0, mut b1) = (yo.min(yc), yo.max(yc));
        // Dojis (open == close) keep a 1 px body
        if b1 - b0 < px.min_body {
            let m = 0.5 * (b0 + b1);
            (b0, b1) = (m - 0.5 * px.min_body, m + 0.5 * px.min_body);
        }
        let (yh, yl) = (self.y_of(a.high as f64), self.y_of(a.low as f64));
        let w = self.style.wick_px;
        let seg = |xa: f32, ya: f32, xb: f32, yb: f32| ChartSegmentRaw {
            p0_width: [xa, ya, WICK_Z, w],
            p1_pad: [xb, yb, WICK_Z, 0.0],
            color,
        };
        // Wicks stop at the body so hollow bodies stay empty
        if yh > b1 {
            segs.push(seg(x, b1, x, yh));
        }
        if yl < b0 {
            segs.push(seg(x, yl, x, b0));
        }
        if hollow && up {
            // Outline inset by half a stroke so it covers the same rectangle as a filled body
            let (l, r) = (x0 + px.inset_x, x1 - px.inset_x);
            let (b, t) = (b0 + px.inset_y, (b1 - px.inset_y).max(b0 + px.inset_y));
            segs.push(seg(l, b0, l, b1));
            segs.push(seg(r, b0, r, b1));
            segs.push(seg(l, t, r, t));
            segs.push(seg(l, b, r, b));
        } else {
            bars.push(ChartBarRaw {
                rect: [x0, b0, x1, b1],
                z_radius: [0.0, self.style.corner_radius_px, 1.0, 0.0],
                color,
            });
        }
        if self.volume_shown() && a.volume > 0.0 {
            let mut c = color;
            c[3] *= self.style.volume_alpha;
            bars.push(ChartBarRaw {
                rect: [x0, -self.layout.height * 0.5, x1, self.vol_y(a.volume)],
                z_radius: [0.0, 0.0, 1.0, 0.0],
                color: c,
            });
        }
    }

    /// Price gridlines; the plot bottom is the baseline.
    pub(crate) fn build_grid(&self, style: &ChartFrameStyle, out: &mut Vec<ChartSegmentRaw>) {
        out.clear();
        if !style.show_grid {
            return;
        }
        let half_w = self.layout.width * 0.5;
        let z = -0.5;
        let line = |y: f32, color| ChartSegmentRaw {
            p0_width: [-half_w, y, z, style.stroke_px],
            p1_pad: [half_w, y, z, 0.0],
            color,
        };
        let volume = self.volume_shown();
        for (k, v) in ticks_between(self.y_min, self.y_min + self.y_span, self.y_step).into_iter().enumerate() {
            let color = if k == 0 && !volume { style.baseline_color } else { style.grid_color };
            out.push(line(self.y_of(v), color));
        }
        if volume {
            out.push(line(-self.layout.height * 0.5, style.baseline_color));
        }
    }

    /// Plot rectangle, price ticks, and x ticks (calendar in `tz` / nice numbers / indices).
    pub(crate) fn axes(&self, view: &ChartView, tz: &TimeZone, out: &mut AxisLayout) {
        out.ticks.clear();
        out.plot_css = [0.0; 4];
        let (half_w, half_h) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let Some(plot) = plot_rect_css(view, half_w, -half_h, half_h, 0.0) else {
            return;
        };
        out.plot_css = plot;
        for v in ticks_between(self.y_min, self.y_min + self.y_span, self.y_step) {
            if let Some((_, y)) = view.project_css(Vec3::new(-half_w, self.y_of(v), 0.0)) {
                out.ticks.push(AxisTick { axis: 1, value: v, x_css: plot[0], y_css: y, granularity: 0 });
            }
        }
        if self.x.is_empty() {
            return;
        }
        let target = ((plot[2] / 90.0).floor() as u32).max(2);
        let bottom = plot[1] + plot[3];
        let (d0, d1) = self.x_domain();
        let span = d1 - d0;
        let (lo, hi) = (d0 + self.window.0 as f64 * span, d0 + self.window.1 as f64 * span);
        let ticks: Vec<(f64, u8)> = if !self.has_t {
            let step = nice_step(hi - lo, target).max(1.0).round();
            let last = (self.x.len() - 1) as f64;
            ticks_between(lo.max(0.0), hi.min(last), step).into_iter().map(|v| (v, 0)).collect()
        } else {
            match self.layout.x_kind {
                LineXKind::Time => time_ticks_tz(lo, hi, target, tz),
                LineXKind::Numeric => ticks_between(lo, hi, nice_step(hi - lo, target)).into_iter().map(|v| (v, 0)).collect(),
            }
        };
        for (value, granularity) in ticks {
            let x = self.world_x(value - self.x_origin);
            if let Some((cx, _)) = view.project_css(Vec3::new(x, -half_h, 0.0)) {
                out.ticks.push(AxisTick { axis: 0, value, x_css: cx, y_css: bottom, granularity });
            }
        }
    }

    /// Plot rect in physical px for scissoring zoomed candles.
    pub(crate) fn clip_px(&self, view: &ChartView) -> Option<[u32; 4]> {
        if self.window == (0.0, 1.0) {
            return None;
        }
        let (half_w, half_h) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let plot = plot_rect_css(view, half_w, -half_h, half_h, 0.0)?;
        let pr = view.pixel_ratio;
        let (vw, vh) = (view.viewport_px.0 as f32, view.viewport_px.1 as f32);
        let x0 = (plot[0] * pr).clamp(0.0, vw);
        let y0 = (plot[1] * pr - 2.0 * pr).clamp(0.0, vh);
        let x1 = ((plot[0] + plot[2]) * pr).clamp(0.0, vw);
        let y1 = ((plot[1] + plot[3]) * pr + 2.0 * pr).clamp(0.0, vh);
        Some([x0 as u32, y0 as u32, (x1 - x0).max(1.0) as u32, (y1 - y0).max(1.0) as u32])
    }

    /// Candle nearest to relative x `rel` (binary search).
    fn nearest(&self, rel: f64) -> Option<usize> {
        let n = self.x.len();
        if n == 0 {
            return None;
        }
        let i = self.x.partition_point(|&v| v < rel);
        Some(if i == 0 {
            0
        } else if i >= n || rel - self.x[i - 1] <= self.x[i] - rel {
            i - 1
        } else {
            i
        })
    }

    /// Nearest candle under the pointer (x only; anywhere over the plot). Remembers the pointer
    /// height for the horizontal crosshair.
    pub(crate) fn hover(&mut self, view: &ChartView, ndc: (f32, f32)) -> Option<HoverResult> {
        self.hover_y = None;
        let ray = view.camera.screen_to_ray(ndc.0, ndc.1);
        let hit = ray_hit_z_plane(&ray, 0.0)?;
        let (half_w, half_h) = (self.layout.width * 0.5, self.layout.height * 0.5);
        if hit.y.abs() > half_h * (1.0 + HOVER_Y_SLACK * 2.0) || hit.x.abs() > half_w {
            return None;
        }
        let i = self.nearest(self.rel_of_world(hit.x))?;
        let close = self.close[i];
        if !close.is_finite() {
            return None;
        }
        self.hover_y = Some(hit.y.clamp(-half_h, half_h));
        Some(HoverResult {
            is_bar: false,
            primary: 0,
            items: vec![HoverItem { series: 0, index: i as u32, value: close, global_id: i as u32 }],
        })
    }

    /// Synced cursor at data x (`t`, else index): nearest candle, no horizontal crosshair.
    /// `None` outside the zoom window (the domain is padded by half a slot) or on a gap candle.
    pub(crate) fn hover_at_x(&mut self, x: f64) -> Option<HoverResult> {
        self.hover_y = None;
        let (d0, _) = self.x_domain();
        let t = (x - d0) / self.dom_span;
        if !(t >= self.window.0 as f64 && t <= self.window.1 as f64) {
            return None;
        }
        let i = self.nearest(x - self.x_origin)?;
        let close = self.close[i];
        close.is_finite().then(|| HoverResult {
            is_bar: false,
            primary: 0,
            items: vec![HoverItem { series: 0, index: i as u32, value: close, global_id: i as u32 }],
        })
    }

    /// Indices of candles with data x in `x` (and close in `y` when given), ascending.
    pub(crate) fn ids_in_range(&self, x: (f64, f64), y: Option<(f64, f64)>) -> Vec<u32> {
        let (a, b) = (x.0 - self.x_origin, x.1 - self.x_origin);
        let i0 = self.x.partition_point(|&v| v < a);
        let i1 = self.x.partition_point(|&v| v <= b);
        (i0..i1.max(i0))
            .filter(|&i| {
                let c = self.close[i] as f64;
                c.is_finite() && y.is_none_or(|(lo, hi)| (lo..=hi).contains(&c))
            })
            .map(|i| i as u32)
            .collect()
    }

    /// Candles sharing the current aggregation bucket with candle `i` (just `i` when raw).
    fn bucket_of(&self, i: usize) -> (usize, usize) {
        let bw = self.bucket;
        if bw <= 0.0 {
            return (i, i);
        }
        let key = (self.x[i] / bw).floor();
        let first = self.x.partition_point(|&v| (v / bw).floor() < key);
        let last = self.x.partition_point(|&v| (v / bw).floor() <= key) - 1;
        (first, last)
    }

    /// Candle `i`, or the aggregate drawn for its bucket while candles are aggregated.
    pub(crate) fn candle_at(&self, i: usize) -> Option<CandleSample> {
        if i >= self.len() {
            return None;
        }
        let (first, last) = self.bucket_of(i);
        let mut a = Agg::EMPTY;
        for k in first..=last {
            a.push(self.open[k], self.high[k], self.low[k], self.close[k], self.volume.as_ref().map_or(f32::NAN, |v| v[k]));
        }
        if a.count == 0 {
            // A gap candle: report its raw values
            a = Agg {
                open: self.open[i],
                high: self.high[i],
                low: self.low[i],
                close: self.close[i],
                volume: self.volume.as_ref().map_or(0.0, |v| v[i] as f64),
                count: 1,
            };
        }
        Some(CandleSample {
            x: self.x_origin + self.x[first],
            open: a.open as f64,
            high: a.high as f64,
            low: a.low as f64,
            close: a.close as f64,
            volume: if self.volume.is_some() { a.volume } else { f64::NAN },
            first,
            last,
        })
    }

    /// World x of the drawn candle / bucket containing candle `i`.
    fn drawn_x(&self, i: usize) -> f32 {
        if self.bucket > 0.0 {
            self.world_x(((self.x[i] / self.bucket).floor() + 0.5) * self.bucket)
        } else {
            self.world_x(self.x[i])
        }
    }

    /// Crosshair: vertical through the hovered candle, horizontal at the pointer.
    pub(crate) fn build_overlay(&self, hover: &HoverResult, style: &ChartHoverStyle, overlay: &mut Vec<ChartSegmentRaw>, markers: &mut Vec<ChartMarkerRaw>) {
        overlay.clear();
        markers.clear();
        let Some(item) = hover.items.get(hover.primary) else {
            return;
        };
        if !style.crosshair || item.index as usize >= self.len() {
            return;
        }
        let (half_w, half_h) = (self.layout.width * 0.5, self.layout.height * 0.5);
        let line = |p0: [f32; 2], p1: [f32; 2]| ChartSegmentRaw {
            p0_width: [p0[0], p0[1], CROSSHAIR_Z, style.crosshair_width_px],
            p1_pad: [p1[0], p1[1], CROSSHAIR_Z, 0.0],
            color: style.crosshair_color,
        };
        let x = self.drawn_x(item.index as usize).clamp(-half_w, half_w);
        overlay.push(line([x, -half_h], [x, half_h]));
        if let Some(y) = self.hover_y {
            overlay.push(line([-half_w, y], [half_w, y]));
        }
    }

    /// `(series, index, close, world position)` of candle `i`.
    pub(crate) fn sample(&self, i: usize) -> Option<(u32, u32, f32, Vec3)> {
        let c = *self.close.get(i)?;
        Some((0, i as u32, c, Vec3::new(self.world_x(self.x[i]), self.y_of(c as f64), 0.0)))
    }

    /// Data x of candle `i` (`t`, else its index).
    pub(crate) fn sample_x(&self, i: usize) -> Option<f64> {
        self.x.get(i).map(|v| v + self.x_origin)
    }

    /// Data -> world map for annotations (x in `t` / index units, y in price units).
    pub(crate) fn annotation_frame(&self) -> DataFrame {
        let (w, h) = (self.layout.width, self.layout.height);
        let (bottom, price_h, _) = self.panes();
        let (d0, _) = self.x_domain();
        let y = AxisMap::new(self.y_min, price_h as f64 / self.y_span, bottom as f64);
        DataFrame {
            x: AxisMap::windowed(d0, self.dom_span, self.window, w),
            y,
            y2: y,
            bounds: [-w * 0.5, w * 0.5, -h * 0.5, h * 0.5],
            z: 0.0,
            z_below: -0.25,
            z_above: 0.25,
        }
    }

    pub(crate) fn frame_camera(&self, camera: &mut OrbitCamera, css: (f32, f32), padding: &ChartPadding) {
        frame_flat(camera, css, self.layout.width, self.layout.height, padding);
    }
}

/// Pixel sizes converted to world units for one build.
struct Px {
    /// 1 CSS px of body height
    min_body: f32,
    /// Half a stroke, horizontally / vertically
    inset_x: f32,
    inset_y: f32,
}

/// Finite (low, high) of one candle including its open / close; `(INF, -INF)` for a gap.
fn candle_extent(o: f32, h: f32, l: f32, c: f32) -> (f32, f32) {
    if !(o.is_finite() && h.is_finite() && l.is_finite() && c.is_finite()) {
        return (f32::INFINITY, f32::NEG_INFINITY);
    }
    (min_f32(min_f32(l, o), c), max_f32(max_f32(h, o), c))
}

/// Median positive gap between sorted `x` (1 when every gap is 0). O(n).
fn median_gap(x: &[f64]) -> f64 {
    let mut gaps: Vec<f64> = x.windows(2).map(|w| w[1] - w[0]).filter(|&g| g > 0.0).collect();
    if gaps.is_empty() {
        return 1.0;
    }
    let mid = gaps.len() / 2;
    let (_, &mut m, _) = gaps.select_nth_unstable_by(mid, f64::total_cmp);
    m
}

impl ChartState {
    /// Creates a 2D candlestick chart (validate with `validate_candles` first).
    pub fn new_candle(data: CandleData, layout: CandleLayout, style: CandleStyle) -> Self {
        Self::with_kind(ChartKind::Candle(CandleChart::new(data, layout, style)))
    }

    /// Restyles a candlestick chart in place (colors, hollow / volume / fit options); data and
    /// zoom are kept.
    pub fn set_candle_style(&mut self, style: CandleStyle) {
        if let ChartKind::Candle(c) = &mut self.kind {
            c.style = style.sanitized();
            c.update_y_domain();
            self.dirty.series = true;
            self.dirty.underlay = true;
            self.dirty.overlay = true;
            self.axes_key = None;
        }
    }

    /// Candle `index`, or the aggregate drawn for its bucket while zoomed out (tooltips).
    pub fn candle_at(&self, index: usize) -> Option<CandleSample> {
        match &self.kind {
            ChartKind::Candle(c) => c.candle_at(index),
            _ => None,
        }
    }

    /// Rebuilds candle layers (bodies + volume into `bars`, wicks into `series`) when the view or
    /// data moved; returns whether the series request must stay pending (view unresolvable).
    pub(crate) fn prepare_candles(&mut self, view: &ChartView) -> bool {
        let ChartKind::Candle(c) = &mut self.kind else {
            return false;
        };
        let mut pending = false;
        if let Some(window) = c.view_window(view) {
            if lod_stale(self.lod, &window) || self.dirty.series {
                // Pad by half the span on both sides so camera moves reuse the build
                let pad = (window.t1 - window.t0) * 0.5;
                let padded = LodWindow { t0: (window.t0 - pad).max(0.0), t1: (window.t1 + pad).min(1.0), ..window };
                let bucket = c.bucket;
                c.build(&padded, view, &mut self.bars, &mut self.series);
                self.lod = Some(padded);
                self.dirty.series = true;
                self.dirty.bars = true;
                // The hovered bucket moves with the aggregation level
                self.dirty.overlay |= c.bucket != bucket;
            }
        } else if self.dirty.series {
            pending = true;
        }
        if self.dirty.underlay {
            c.build_grid(&self.frame_style, &mut self.underlay);
        }
        if self.dirty.overlay {
            match &self.hover {
                Some(h) => c.build_overlay(h, &self.hover_style, &mut self.overlay, &mut self.markers),
                None => {
                    self.overlay.clear();
                    self.markers.clear();
                }
            }
        }
        pending
    }

    /// Candle hover: like `hover_at`, but the horizontal crosshair also follows the pointer.
    pub(crate) fn hover_candle(&mut self, view: &ChartView, scene: &mut SceneWorld, ndc: (f32, f32)) -> Option<HoverResult> {
        let ChartKind::Candle(c) = &mut self.kind else {
            return None;
        };
        let before = c.hover_y;
        let result = c.hover(view, ndc);
        let moved = c.hover_y != before;
        self.set_hover(result.clone(), scene);
        self.dirty.overlay |= moved;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 2026-01-01T00:00:00Z in epoch ms
    const T0: f64 = 1_767_225_600_000.0;
    const DAY: f64 = 86_400_000.0;

    fn view(cam: &OrbitCamera) -> ChartView<'_> {
        ChartView { camera: cam, viewport_px: (1600, 900), pixel_ratio: 1.0 }
    }

    impl ChartState {
        /// Price domain `(min, max)` of a candlestick chart.
        fn y_domain_candle(&self) -> (f64, f64) {
            match &self.kind {
                ChartKind::Candle(c) => (c.y_min, c.y_min + c.y_span),
                _ => (f64::NAN, f64::NAN),
            }
        }
    }

    /// Daily candles: open = 100 + i, close = open +/- 2 alternating, wicks +/- 5.
    fn daily(n: usize, volume: bool) -> CandleData {
        let open: Vec<f32> = (0..n).map(|i| 100.0 + i as f32).collect();
        let close: Vec<f32> = (0..n).map(|i| open[i] + if i % 2 == 0 { 2.0 } else { -2.0 }).collect();
        CandleData {
            t: Some((0..n).map(|i| T0 + i as f64 * DAY).collect()),
            high: open.iter().map(|o| o + 5.0).collect(),
            low: open.iter().map(|o| o - 5.0).collect(),
            volume: volume.then(|| (0..n).map(|i| 1000.0 + i as f32).collect()),
            open,
            close,
        }
    }

    fn layout() -> CandleLayout {
        CandleLayout { width: 160.0, height: 80.0, x_kind: LineXKind::Time }
    }

    fn state(data: CandleData, style: CandleStyle) -> (OrbitCamera, ChartState) {
        let chart = ChartState::new_candle(data, layout(), style);
        let mut cam = OrbitCamera::new(150.0, 16.0 / 9.0);
        chart.frame_camera(&mut cam, (1600.0, 900.0));
        (cam, chart)
    }

    #[test]
    fn brush_selects_candle_indices_and_sync_hovers_by_data_x() {
        use crate::chart::{BrushMode, SelectionKind};
        let (_cam, mut chart) = state(daily(10, false), CandleStyle::default());
        // Days 2..=4; with a y range only closes inside it (104, 101, 106 -> 104, 101)
        let sel = chart.select_data(BrushMode::X, (T0 + 2.0 * DAY, T0 + 4.0 * DAY), None).unwrap();
        assert_eq!((sel.kind, sel.ids.as_slice()), (SelectionKind::Candle, &[2, 3, 4][..]));
        let sel = chart.select_data(BrushMode::XY, (T0 + 2.0 * DAY, T0 + 4.0 * DAY), Some((100.0, 105.0))).unwrap();
        assert_eq!(sel.ids, vec![2, 3]);

        let mut scene = SceneWorld::new();
        let hit = chart.hover_at_data_x(&mut scene, T0 + 6.4 * DAY).unwrap();
        assert_eq!(hit.items[0].index, 6);
        assert_eq!(chart.hover_data_x(), Some(T0 + 6.0 * DAY));
        assert!(chart.hover_at_data_x(&mut scene, T0 + 30.0 * DAY).is_none());
        // Zoomed to days 0..=12 of 40: a synced cursor on day 30 is off screen
        let (_cam, mut chart) = state(daily(40, false), CandleStyle::default());
        assert!(chart.set_x_range_data(T0, T0 + 12.0 * DAY));
        assert!(chart.hover_at_data_x(&mut scene, T0 + 30.0 * DAY).is_none());
        assert_eq!(chart.hover_at_data_x(&mut scene, T0 + 5.0 * DAY).unwrap().items[0].index, 5);
    }

    #[test]
    fn validation_rejects_mismatched_lengths_and_unsorted_t() {
        let mut d = daily(5, true);
        assert!(validate_candles(&d).is_ok());
        d.high.pop();
        assert!(validate_candles(&d).unwrap_err().contains("high length"));
        let mut d = daily(5, false);
        d.t.as_mut().unwrap().swap(1, 2);
        assert!(validate_candles(&d).unwrap_err().contains("sorted"));
        let mut d = daily(5, false);
        d.volume = Some(vec![1.0]);
        assert!(validate_candles(&d).unwrap_err().contains("volume"));
    }

    #[test]
    fn raw_candles_draw_bodies_wicks_volume_and_a_nice_price_domain() {
        let style = CandleStyle { hollow_up: false, ..Default::default() };
        let (cam, mut chart) = state(daily(40, true), style);
        let layers = chart.prepare_layers(&view(&cam));
        // 40 bodies + 40 volume bars; 2 wicks each
        let bars = layers.bars.unwrap().to_vec();
        assert_eq!(bars.len(), 80);
        assert_eq!(layers.series.unwrap().len(), 80);
        let ChartKind::Candle(c) = &chart.kind else { unreachable!() };
        assert_eq!(c.bucket, 0.0, "40 candles over ~1400 px stay raw");
        // Price 95..=144 -> nice domain [90, 150]
        assert_eq!((c.y_min, c.y_min + c.y_span), (90.0, 150.0));
        assert_eq!(c.slot, DAY);
        // Candle 0 rises (blue), candle 1 falls (orange)
        let d = CandleStyle::default();
        assert_eq!(bars[0].color, d.up_color);
        assert_eq!(bars[2].color, d.down_color);
        // Body spans open..close, volume bar sits on the plot bottom with alpha
        assert!((bars[0].rect[1] - c.y_of(100.0)).abs() < 1e-4 && (bars[0].rect[3] - c.y_of(102.0)).abs() < 1e-4);
        assert_eq!(bars[1].rect[1], -40.0);
        assert!((bars[1].color[3] - d.volume_alpha).abs() < 1e-6);
        // Body width = 70% of the slot; first candle fully inside the plot
        let slot_w = 160.0 / 40.0;
        assert!((bars[0].rect[2] - bars[0].rect[0] - 0.7 * slot_w).abs() < 1e-3);
        assert!(bars[0].rect[0] > -80.0);
        // Wicks reach high / low and stop at the body
        let segs = chart.series.clone();
        assert!((segs[0].p1_pad[1] - c.y_of(105.0)).abs() < 1e-4 && (segs[0].p0_width[1] - c.y_of(102.0)).abs() < 1e-4);
        assert!((segs[1].p0_width[1] - c.y_of(95.0)).abs() < 1e-4);
        // Volume pane: price gridlines stay above it
        assert!(chart.underlay.iter().all(|s| s.p0_width[1] >= -40.0));
    }

    #[test]
    fn hollow_up_candles_are_outlines_and_dojis_keep_a_body() {
        let mut d = daily(10, false);
        d.close[3] = d.open[3]; // doji: counts as rising (close >= open)
        let (cam, mut chart) = state(d.clone(), CandleStyle::default());
        let layers = chart.prepare_layers(&view(&cam));
        // 6 rising candles drawn as 4-segment outlines, the 4 falling ones filled
        assert_eq!(layers.bars.unwrap().len(), 4);
        assert_eq!(chart.series.len(), 10 * 2 + 6 * 4);
        // Filled: the doji body keeps 1 px of height, in the up color
        let style = CandleStyle { hollow_up: false, ..Default::default() };
        let (cam, mut chart) = state(d, style);
        let bars = chart.prepare_layers(&view(&cam)).bars.unwrap().to_vec();
        assert_eq!(bars.len(), 10);
        let doji = bars[3];
        assert!(doji.rect[3] - doji.rect[1] > 0.0, "doji body has height");
        assert_eq!(doji.color, CandleStyle::default().up_color);
    }

    #[test]
    fn dense_candles_aggregate_per_bucket_and_preserve_extremes() {
        let n = 200_000;
        let mut d = daily(n, true);
        // Spikes inside one bucket must survive aggregation
        d.high[123_457] = 1_000_000.0;
        d.low[54_321] = -1_000_000.0;
        let (cam, mut chart) = state(d.clone(), CandleStyle::default());
        let layers = chart.prepare_layers(&view(&cam));
        let bars = layers.bars.unwrap().len();
        let ChartKind::Candle(c) = &chart.kind else { unreachable!() };
        assert!(c.bucket > 0.0);
        // ~1400 px / 3 px per bucket, body + volume each
        assert!(bars < 2 * 600, "bars {bars} not aggregated");
        // Bucket volume sums are scaled to the largest bucket (not clamped to the pane top)
        let vol: Vec<f32> = chart.bars.iter().filter(|b| b.rect[1] == -40.0).map(|b| b.rect[3]).collect();
        let (lo, hi) = vol.iter().fold((f32::MAX, f32::MIN), |(a, b), &v| (a.min(v), b.max(v)));
        assert!(vol.len() > 100 && hi - lo > 1.0, "volume bars flat: {lo}..{hi}");
        let segs = &chart.series;
        let max_y = segs.iter().map(|s| s.p0_width[1].max(s.p1_pad[1])).fold(f32::MIN, f32::max);
        let min_y = segs.iter().map(|s| s.p0_width[1].min(s.p1_pad[1])).fold(f32::MAX, f32::min);
        assert!((max_y - c.y_of(1_000_000.0)).abs() < 1e-3, "high spike lost");
        assert!((min_y - c.y_of(-1_000_000.0)).abs() < 1e-3, "low spike lost");

        // The bucket aggregate: open = first, close = last, high = max, low = min, volume = sum
        let s = chart.candle_at(123_457).unwrap();
        assert!(s.first < s.last && (s.first..=s.last).contains(&123_457));
        assert_eq!(s.open, d.open[s.first] as f64);
        assert_eq!(s.close, d.close[s.last] as f64);
        assert_eq!(s.high, 1_000_000.0);
        let lo = (s.first..=s.last).map(|k| d.low[k]).fold(f32::INFINITY, f32::min);
        assert_eq!(s.low, lo as f64);
        let vol: f64 = (s.first..=s.last).map(|k| d.volume.as_ref().unwrap()[k] as f64).sum();
        assert!((s.volume - vol).abs() < 1e-6 * vol);
        assert_eq!(s.x, T0 + s.first as f64 * DAY);
    }

    #[test]
    fn zoom_rebuilds_raw_candles_and_fits_the_visible_price_range() {
        let n = 50_000;
        let (cam, mut chart) = state(daily(n, false), CandleStyle::default());
        let v = view(&cam);
        chart.prepare_layers(&v);
        let full = chart.y_domain_candle();
        // Zoom in hard around the centre until candles are raw
        for _ in 0..40 {
            chart.zoom_x(&v, 0.7, 0.0);
        }
        let layers = chart.prepare_layers(&v);
        assert!(layers.series.is_some() && layers.series_clip.is_some());
        let ChartKind::Candle(c) = &chart.kind else { unreachable!() };
        assert_eq!(c.bucket, 0.0, "zoomed in: raw candles");
        let (i0, i1) = c.visible_range(c.window.0, c.window.1).unwrap();
        assert!(i1 - i0 < 100);
        // Visible-fit price axis: narrower than the full domain and covering the visible candles
        let (lo, hi) = chart.y_domain_candle();
        assert!(hi - lo < (full.1 - full.0) * 0.05);
        assert!(lo <= 95.0 + i0 as f64 && hi >= 105.0 + i1 as f64);
        // Pan right moves the window; reset restores everything
        let before = chart.x_window();
        chart.pan_x(&v, -0.2);
        assert!(chart.x_window().0 > before.0);
        chart.reset_zoom();
        assert_eq!(chart.x_window(), (0.0, 1.0));
        assert_eq!(chart.y_domain_candle(), full);
    }

    #[test]
    fn hover_picks_the_nearest_candle_by_x_and_draws_a_crosshair() {
        let (cam, mut chart) = state(daily(20, true), CandleStyle::default());
        let v = view(&cam);
        let mut scene = SceneWorld::new();
        chart.prepare_layers(&v);
        // Slot 160 / 20 = 8 world units: candle 7 is centred at -80 + 7.5 * 8 = -20
        let p = cam.project_to_ndc(Vec3::new(-20.0 + 2.0, 10.0, 0.0)).unwrap();
        let hit = chart.hover_at(&v, &mut scene, (p.x, p.y)).expect("candle 7");
        assert_eq!(hit.items.len(), 1);
        assert_eq!((hit.items[0].index, hit.items[0].value), (7, 105.0));
        let layers = chart.prepare_layers(&v);
        let overlay = layers.overlay.unwrap();
        assert_eq!(overlay.len(), 2, "vertical + horizontal crosshair");
        assert!((overlay[0].p0_width[0] + 20.0).abs() < 1e-3);
        assert!((overlay[1].p0_width[1] - 10.0).abs() < 1e-2);
        // Same candle, pointer lower: only the horizontal line moves
        let p = cam.project_to_ndc(Vec3::new(-20.0, -5.0, 0.0)).unwrap();
        chart.hover_at(&v, &mut scene, (p.x, p.y));
        assert!(chart.prepare_layers(&v).overlay.is_some());
        // Tooltip data and samples
        let s = chart.candle_at(7).unwrap();
        assert_eq!((s.open, s.high, s.low, s.close, s.volume), (107.0, 112.0, 102.0, 105.0, 1007.0));
        assert_eq!(chart.sample_x(7), Some(T0 + 7.0 * DAY));
        assert_eq!(chart.sample(7).map(|s| s.2), Some(105.0));
        // Outside the plot: no hover
        assert!(chart.hover_at(&v, &mut scene, (0.0, 0.99)).is_none());
    }

    #[test]
    fn axes_tick_time_and_price_and_ranges_use_data_units() {
        let (cam, mut chart) = state(daily(60, false), CandleStyle::default());
        let v = view(&cam);
        chart.prepare_layers(&v);
        let x: Vec<&AxisTick> = chart.axes().ticks.iter().filter(|t| t.axis == 0).collect();
        assert!(x.len() >= 2 && x.iter().all(|t| t.granularity >= 5), "day / month ticks");
        assert!(x.iter().all(|t| (t.value - T0) % DAY == 0.0));
        assert!(chart.axes().ticks.iter().any(|t| t.axis == 1));
        // Data range: half a slot of padding around the first / last candle
        let (lo, hi) = chart.x_range_data().unwrap();
        assert_eq!((lo, hi), (T0 - 0.5 * DAY, T0 + 59.5 * DAY));
        assert!(chart.set_x_range_data(T0 + 10.0 * DAY, T0 + 20.0 * DAY));
        let (lo, hi) = chart.x_range_data().unwrap();
        assert!((lo - (T0 + 10.0 * DAY)).abs() < DAY * 0.01 && (hi - (T0 + 20.0 * DAY)).abs() < DAY * 0.01);
        // Annotations map data -> world through the same window
        let p = chart.data_to_world(T0 + 15.0 * DAY, 120.0).unwrap();
        let ChartKind::Candle(c) = &chart.kind else { unreachable!() };
        assert!((p.x - c.world_x(15.0 * DAY)).abs() < 1e-3 && (p.y - c.y_of(120.0)).abs() < 1e-3);
    }

    #[test]
    fn index_placement_without_t() {
        let mut d = daily(30, false);
        d.t = None;
        let (cam, mut chart) = state(d, CandleStyle::default());
        chart.prepare_layers(&view(&cam));
        assert_eq!(chart.sample_x(4), Some(4.0));
        let x: Vec<f64> = chart.axes().ticks.iter().filter(|t| t.axis == 0).map(|t| t.value).collect();
        assert!(!x.is_empty() && x.iter().all(|v| v.fract() == 0.0 && (0.0..=29.0).contains(v)));
        assert_eq!(chart.point_count(), 30);
        assert_eq!(chart.series_count(), 1);
    }
}

